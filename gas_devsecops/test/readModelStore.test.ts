// The durable second level under the read-model cache, and the invariants that make it safe
// rather than merely faster.
//
// CacheService caps TTLs at six hours, so a daily-scan tenant goes cold three or four times
// between scans and recomputes a byte-identical answer each time. This store keeps that answer
// on Drive. What makes it correct is not the caching — it is the boundaries: only time-invariant
// models go in, only the warm may write, every file is overwritten rather than accumulated, and
// every Drive failure degrades to a plain recompute.
//
// The failure this file mostly guards is silent. A drifted params hash, a sweep with the wrong
// keep-list or a missing envelope all produce correct-looking pages that are simply slower — or,
// worse, a sweep that deletes live entries and rewrites them forever.
//
// Port of gas/test/readModelStore.test.ts. The names in the fixtures are this register's
// (`dsProgram1`, `dsHistory1`) rather than gas/'s `mttrTrend5/6`; the contract is identical.

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Drive: name -> parsed payload, plus call counters.
const files = new Map<string, unknown>();
const calls = { create: 0, read: 0, trash: 0, list: 0 };
let driveThrows = false;

vi.mock("../src/server/archiveStore", () => ({
  subfolder: () => ({ __fake: true }),
  readGzJsonNamed: (_f: string, name: string) => {
    calls.read += 1;
    if (driveThrows) throw new Error("drive unavailable");
    return files.has(name) ? files.get(name) : null;
  },
  writeGzJson: (_folder: unknown, name: string, payload: unknown) => {
    calls.create += 1;
    if (driveThrows) throw new Error("drive unavailable");
    files.set(name, JSON.parse(JSON.stringify(payload)));
    return { getId: () => name };
  },
  listNames: () => { calls.list += 1; return [...files.keys()]; },
  trashNamed: (_f: string, name: string) => { calls.trash += 1; files.delete(name); },
}));

let stamp = "build1.100.tagA";
// A REAL L1, not a pass-through. It was a pass-through in the sibling project, and that is
// exactly why those specs missed the worst bug in this file: `cached()` skips its callback on
// a hit — the COMMON case for a warm running against a still-live six-hour entry — so anything
// recorded inside that callback is not recorded then, and the sweep deleted every durable file.
// A fake that can hit is the only kind that could have caught it.
const l1 = new Map<string, unknown>();
vi.mock("../src/server/serverCache", () => ({
  cached: (n: string, p: unknown, compute: () => unknown) => {
    const k = n + JSON.stringify(p ?? null) + stamp;
    if (l1.has(k)) return l1.get(k);
    const v = compute();
    l1.set(k, v);
    return v;
  },
  currentStamp: () => stamp,
  paramsHash: (p: unknown) => "h" + JSON.stringify(p ?? null).length,
}));

// Re-imported per test: `disabled` and `touched` are module state that lives for one GAS
// execution, which is correct in production and would leak between specs here.
const load = () => import("../src/server/readModelStore");
let durablyCached: Awaited<ReturnType<typeof load>>["durablyCached"];
let duringWarm: Awaited<ReturnType<typeof load>>["duringWarm"];
let readModelFileName: Awaited<ReturnType<typeof load>>["readModelFileName"];
let sweepReadModels: Awaited<ReturnType<typeof load>>["sweepReadModels"];

beforeEach(async () => {
  vi.resetModules();
  ({ durablyCached, duringWarm, readModelFileName, sweepReadModels } = await load());
  files.clear();
  l1.clear();
  calls.create = 0; calls.read = 0; calls.trash = 0; calls.list = 0;
  driveThrows = false;
  stamp = "build1.100.tagA";
  vi.stubGlobal("console", { ...console, warn: () => {} });
});

const P = { scope: null, severities: null, showNoFix: true };

describe("the read path: L2 hit means no recompute", () => {
  it("serves a stored value whose stamp matches, without computing", () => {
    duringWarm(() => durablyCached("m", P, () => "first"));
    const compute = vi.fn(() => "second");
    expect(durablyCached("m", P, compute)).toBe("first");
    expect(compute).not.toHaveBeenCalled();
  });

  it("recomputes when the stamp has moved on", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    stamp = "build1.101.tagA"; // a scan landed
    expect(durablyCached("m", P, () => "new")).toBe("new");
  });

  // BUILD_ID is a source hash, so every deploy moves the stamp and every file goes stale at
  // once. Bounded by the warm trigger; pinned here so the behaviour is deliberate.
  it("treats a code deploy the same as a data change", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    stamp = "build2.100.tagA";
    expect(durablyCached("m", P, () => "new")).toBe("new");
  });

  // readGzJsonNamed returns null for an unreadable file too, so without the envelope a
  // legitimately-null payload would be indistinguishable from a failure and recompute forever.
  it("round-trips a null payload as a hit, not a miss", () => {
    duringWarm(() => durablyCached("m", P, () => null));
    const compute = vi.fn(() => "recomputed");
    expect(durablyCached("m", P, compute)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });
});

describe("the write path: only the warm may write", () => {
  // If arbitrary reads minted files the key space becomes names x scopes x severity selections
  // x toggle states, and a file for a scope later renamed is orphaned permanently — the sweep
  // cannot tell it from a legitimately cold scoped entry.
  it("writes nothing on a miss outside the warm", () => {
    expect(durablyCached("m", P, () => "value")).toBe("value");
    expect(files.size).toBe(0);
    expect(calls.create).toBe(0);
  });

  // The other half of that contract, and the half a "writes nothing" spec alone does not pin:
  // a read OUTSIDE the warm still CONSULTS L2 and still hits.
  it("still reads L2 outside the warm", () => {
    duringWarm(() => durablyCached("m", P, () => "warmed"));
    const compute = vi.fn(() => "cold");
    l1.clear(); // force the read past L1 and into Drive
    expect(durablyCached("m", P, compute)).toBe("warmed");
    expect(compute).not.toHaveBeenCalled();
    expect(calls.create).toBe(1); // the warm's write, and no second one
  });

  it("writes one file on a miss inside the warm", () => {
    duringWarm(() => durablyCached("m", P, () => "value"));
    expect([...files.keys()]).toEqual([readModelFileName("m", P)]);
  });

  // writeGzJson trashes and recreates, so an unconditional write would churn a set of files
  // into Drive Trash on every fire of the warm trigger — and trashing frees no quota.
  it("does not rewrite when a re-warm finds the stamp unchanged", () => {
    duringWarm(() => durablyCached("m", P, () => "value"));
    expect(calls.create).toBe(1);
    duringWarm(() => durablyCached("m", P, () => "value"));
    expect(calls.create).toBe(1);
  });

  it("overwrites in place when the stamp moved — one file, not two", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    stamp = "build1.101.tagA";
    duringWarm(() => durablyCached("m", P, () => "new"));
    expect(files.size).toBe(1);
    expect(durablyCached("m", P, () => "unused")).toBe("new");
  });
});

describe("the sweep: bounded file count across namespace bumps", () => {
  // The deterministic-name scheme alone does NOT bound garbage. This codebase bumps read-model
  // namespaces whenever a payload shape changes, and nothing will ever ask for the old name
  // again to overwrite it.
  it("trashes a leftover from a previous namespace and keeps the current one", () => {
    files.set("rm-dsProgram0-hXX.json.gz", { v: 1, stamp, name: "dsProgram0", value: 1 });
    duringWarm(() => {
      durablyCached("dsProgram1", P, () => "v");
      sweepReadModels();
    });
    expect([...files.keys()]).toEqual([readModelFileName("dsProgram1", P)]);
  });

  // The keep-list is what the warm touched, never a restatement of the call sites' params — a
  // drifted restatement would trash live entries and rewrite them every single pass.
  it("keeps every entry the warm touched, including ones that only hit", () => {
    duringWarm(() => { durablyCached("a", P, () => 1); durablyCached("b", P, () => 2); });
    expect(files.size).toBe(2);
    duringWarm(() => {
      durablyCached("a", P, () => 1); // hits, writes nothing
      durablyCached("b", P, () => 2);
      sweepReadModels();
    });
    expect(files.size).toBe(2);
  });

  it("refuses to sweep when no warm ran in this execution", () => {
    files.set("rm-x-h1.json.gz", { v: 1, stamp, name: "x", value: 1 });
    sweepReadModels();
    expect(files.size).toBe(1);
  });
});

describe("failure semantics: an optimization, never a correctness dependency", () => {
  it("returns the computed value when Drive is unreachable", () => {
    driveThrows = true;
    expect(durablyCached("m", P, () => "computed")).toBe("computed");
  });

  // A missing ARCHIVE_FOLDER_ID or a revoked scope should cost ONE failed call, not one per
  // durable read-model per request.
  it("stops trying after the first Drive failure in an execution", () => {
    driveThrows = true;
    for (const n of ["a", "b", "c", "d"]) durablyCached(n, P, () => n);
    expect(calls.read).toBe(1);
  });
});

describe("the filename derives from the same hash as the L1 key", () => {
  // A drift here means the L2 never hits: no error, no wrong answer, a feature quietly doing
  // nothing. This is the only assertion that would catch it.
  it("names the file from paramsHash(params)", () => {
    expect(readModelFileName("dsProgram1", P)).toBe(
      `rm-dsProgram1-h${JSON.stringify(P).length}.json.gz`,
    );
  });

  it("distinguishes different params and shares one name for identical params", () => {
    expect(readModelFileName("m", { a: 1 })).toBe(readModelFileName("m", { a: 1 }));
    expect(readModelFileName("m", { a: 1 })).not.toBe(readModelFileName("m", { ab: 12 }));
  });

  // NO STAMP IN THE FILENAME, deliberately — BUILD_ID is a source hash, so a stamped name
  // would orphan an entire generation of files on every push.
  it("keeps one name across a stamp move", () => {
    const before = readModelFileName("m", P);
    stamp = "build9.999.tagZ";
    expect(readModelFileName("m", P)).toBe(before);
  });
});

describe("the sweep survives a warm that only hits L1", () => {
  // The regression that shipped past a pass-through mock: with a trigger fired more often than
  // the six-hour TTL, most warms find L1 warm and never reach the L2 layer at all. If the
  // keep-list is only built inside that callback it comes back empty and the sweep deletes
  // everything.
  it("keeps the durable files when the second warm is served entirely from L1", () => {
    duringWarm(() => { durablyCached("a", P, () => 1); durablyCached("b", P, () => 2); });
    expect(files.size).toBe(2);
    duringWarm(() => {
      durablyCached("a", P, () => 1); // L1 hit — compute callback never runs
      durablyCached("b", P, () => 2);
      sweepReadModels();
    });
    expect(files.size).toBe(2);
  });
});
