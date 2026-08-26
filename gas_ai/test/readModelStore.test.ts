// The durable second level, and the three things that make it either work or silently not.
//
// An L2 that never hits is the worst failure mode available here: no error, no wrong answer,
// nothing on screen, just a feature quietly doing nothing while every cost it was built to
// remove is still being paid. Every spec below exists because some plausible mistake produces
// exactly that.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSyncedServer, measure, resetToSynced, teardownServer } from "./gasEnv";

let server: Awaited<ReturnType<typeof bootSyncedServer>>;

async function mods() {
  return {
    store: await import("../src/server/readModelStore"),
    cache: await import("../src/server/serverCache"),
    archive: await import("../src/server/archiveStore"),
    warm: await import("../src/server/warm"),
  };
}

function flushL1(): void {
  const f = (globalThis as Record<string, unknown>)["__gasFakes"] as {
    snapshot(): { cache: Map<string, string> }; restore(s: unknown): void;
  };
  const snap = f.snapshot();
  snap.cache.clear();
  f.restore(snap);
}

beforeAll(async () => {
  server = await bootSyncedServer();
});
afterAll(() => teardownServer());

describe("key parity with the L1 cache", () => {
  // THE FILENAME MUST DERIVE FROM THE SAME HASH THE L1 KEY USES. Two call sites computing
  // "the same" hash is exactly how they drift, and a drift here is undetectable at runtime.
  it("names a file from the same params hash serverCache keys with", async () => {
    const { store, cache } = await mods();
    for (const params of [null, {}, { group: "" }, { kind: "AI_AGENT" }, { a: 1, b: [2, 3] }]) {
      expect(store.readModelFileName("x", params)).toBe(`rm-x-${cache.paramsHash(params)}.json.gz`);
    }
  });

  // THE STAMP MUST FOLLOW THE VERSION NAMESPACE THE ENTRY OPTED INTO. This project has two —
  // DATA_VERSION for anything derived from the sheet, WIZ_DATA_VERSION for a held Wiz
  // response — and an envelope stamped under the wrong one would never match.
  it("stamps under whichever version namespace was asked for", async () => {
    const { cache } = await mods();
    const dataStamp = cache.currentStamp();
    const wizStamp = cache.currentStamp(cache.wizDataVersion());
    expect(dataStamp).not.toBe(wizStamp);
    expect(cache.currentStamp(cache.dataVersion())).toBe(dataStamp);
  });

  // The two above are unit properties of `currentStamp`. THIS one is the integration: that
  // `durablyCached` actually threads its `version` into the envelope AND into the L1 key.
  // Added because a mutation that dropped the argument from the L2 stamp passed every other
  // spec here — no L2-eligible model opts into WIZ_DATA_VERSION today (the two that do are
  // excluded for carrying a liveness claim), so nothing else exercised the path.
  it("threads an explicit version into the stored envelope, not just into the L1 key", async () => {
    server = await resetToSynced();
    const { store, cache, archive } = await mods();
    const WIZ = cache.wizDataVersion();

    const written = store.duringWarm(() =>
      store.durablyCached("versionProbe", null, () => ({ n: 1 }), undefined, WIZ));
    expect(written).toEqual({ n: 1 });

    const raw = archive.readGzJsonNamed("readmodels", store.readModelFileName("versionProbe", null));
    expect(raw).toBeTruthy();
    const env = raw as { stamp: string };
    expect(env.stamp).toBe(cache.currentStamp(WIZ));
    expect(env.stamp).not.toBe(cache.currentStamp());
  });

  // A DEPLOY MUST INVALIDATE THE DURABLE LEVEL TOO. This project folds BUILD_ID into
  // KEY_PREFIX rather than into the version prefix, so a `currentStamp` that returned only
  // `version.configStamp` would leave Drive serving payloads computed by the old code after
  // every push — the exact trap KEY_PREFIX closes for L1.
  it("carries the build stamp, so a deploy is treated like a data change", async () => {
    const { cache } = await mods();
    const { BUILD_ID } = await import("../src/server/buildInfo");
    expect(cache.currentStamp()).toContain(BUILD_ID);
  });
});

describe("writes are restricted to the warm", () => {
  it("a plain read never mints a durable file", async () => {
    server = await resetToSynced();
    const { archive } = await mods();
    for (const n of archive.listNames("readmodels")) archive.trashNamed("readmodels", n);
    flushL1();

    // A read with params no warm asks for. If reads could write, every distinct params object
    // would mint a file — and a file for a scope later renamed is orphaned permanently AND
    // indistinguishable from a legitimate cold one, so no sweep could clean it up.
    server.api.getIssues({ group: "bedrock-no-guardrail" });
    expect(archive.listNames("readmodels")).toEqual([]);
  });

  it("a warm does write, and the answer survives losing CacheService entirely", async () => {
    server = await resetToSynced();
    const { archive, warm } = await mods();
    for (const n of archive.listNames("readmodels")) archive.trashNamed("readmodels", n);
    flushL1();

    warm.warmReadModels();
    const files = archive.listNames("readmodels");
    expect(files.length).toBeGreaterThan(5);
    expect(files.every((n) => /^rm-.+\.json\.gz$/.test(n))).toBe(true);

    // The six-hourly lapse: L1 gone, Drive intact, no ledger read.
    flushL1();
    const after = measure(() => server.api.bootstrap({}));
    expect(after.counters.cellsRead).toBe(0);
  });
});

describe("the sweep", () => {
  // THE BUG THIS SHAPE OF STORE INVITES, and the reason `touched` is recorded OUTSIDE the
  // compute callback: `cached()` skips that callback entirely on an L1 hit — the common case
  // for a warm running against a still-live six-hour entry — so recording inside it would
  // leave the keep-list empty and the sweep would delete every live file.
  it("keeps what a warm touched even when every entry was already warm in L1", async () => {
    server = await resetToSynced();
    const { archive, warm } = await mods();

    warm.warmReadModels();               // populates Drive and L1
    const first = archive.listNames("readmodels").length;
    expect(first).toBeGreaterThan(5);

    // Second pass with L1 STILL WARM: every cached() call short-circuits, no compute runs.
    const res = warm.warmReadModels();
    expect(res.swept).toBe(0);
    expect(archive.listNames("readmodels")).toHaveLength(first);

    // And a third, because the observed failure was a decay — 9 files, then 8, then 0.
    warm.warmReadModels();
    expect(archive.listNames("readmodels")).toHaveLength(first);
  });

  it("trashes a file no warm asks for any more, such as a bumped namespace", async () => {
    server = await resetToSynced();
    const { archive, warm } = await mods();
    warm.warmReadModels();
    const before = archive.listNames("readmodels").length;

    // What a cache-namespace bump leaves behind: a file nothing will ever ask for again.
    archive.writeGzJson(archive.subfolder("readmodels"), "rm-assetsModel1-deadbeef.json.gz", {
      v: 1, stamp: "old", name: "assetsModel1", hash: "deadbeef", writtenAtMs: 0, value: {},
    });
    expect(archive.listNames("readmodels")).toHaveLength(before + 1);

    const res = warm.warmReadModels();
    expect(res.swept).toBe(1);
    expect(archive.listNames("readmodels")).toHaveLength(before);
  });

  // Called from outside a warm there IS no keep-list, and an empty one means "keep nothing".
  // Added because a mutation replacing the null guard with `touched ?? new Set()` passed
  // every other spec: they all sweep from inside `duringWarm`, where it is never null.
  it("trashes nothing when called outside a warm", async () => {
    server = await resetToSynced();
    const { archive, warm, store } = await mods();
    warm.warmReadModels();
    const before = archive.listNames("readmodels").length;
    expect(before).toBeGreaterThan(5);

    expect(store.sweepReadModels()).toBe(0);
    expect(archive.listNames("readmodels")).toHaveLength(before);
  });

  it("does not sweep after a budget cut-out, when the keep-list is short by definition", async () => {
    server = await resetToSynced();
    const { archive, warm } = await mods();
    warm.warmReadModels();
    const before = archive.listNames("readmodels").length;

    // Nothing ran, so nothing was touched. Sweeping against that would trash every live file
    // only to rewrite it on the next pass.
    const res = warm.warmReadModels(0);
    expect(res.skipped).toBeGreaterThan(0);
    expect(res.swept).toBe(-1);
    expect(archive.listNames("readmodels")).toHaveLength(before);
  });
});

describe("failure semantics", () => {
  it("a stale envelope is a miss, not an answer", async () => {
    server = await resetToSynced();
    const { archive, warm, store } = await mods();
    warm.warmReadModels();

    // Rewrite one file under a stamp from another build.
    const name = store.readModelFileName("getStorageStats", null);
    archive.writeGzJson(archive.subfolder("readmodels"), name, {
      v: 1, stamp: "wsk.someotherbuild:0.0", name: "getStorageStats",
      hash: "x", writtenAtMs: Date.now(), value: { archiveBytes: -1 },
    });

    flushL1();
    const res = server.api.getStorageStats({}) as { ok: boolean; data: { archiveBytes: number } };
    // Recomputed rather than served: -1 was never a real answer.
    expect(res.data.archiveBytes).not.toBe(-1);
  });

  it("keeps answering when Drive is unavailable", async () => {
    server = await resetToSynced();
    const { warm } = await mods();
    warm.warmReadModels();
    flushL1();

    const realDrive = (globalThis as Record<string, unknown>)["DriveApp"];
    (globalThis as Record<string, unknown>)["DriveApp"] = {
      getFolderById: () => { throw new Error("scope revoked"); },
      getFileById: () => { throw new Error("scope revoked"); },
      createFolder: () => { throw new Error("scope revoked"); },
    };
    try {
      // Caching is an optimization, never a correctness dependency.
      const res = server.api.getStorageStats({}) as { ok: boolean };
      expect(res.ok).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>)["DriveApp"] = realDrive;
    }
  });
});
