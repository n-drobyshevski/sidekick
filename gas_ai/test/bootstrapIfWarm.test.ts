// doGet inlines the bootstrap only when its core is already cached (gas_shared/server/
// inlineBoot.ts via api.bootstrapIfWarm): computing a cold core inside doGet would hold the
// whole page, splash hidden, for as long as the core takes — measured in gas/ at 20+ s after a
// deploy. So the inline path PEEKS (L1, then the durable file) and never computes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSyncedServer, resetToSynced, teardownServer } from "./gasEnv";

function flushL1(): void {
  const f = (globalThis as Record<string, unknown>)["__gasFakes"] as {
    snapshot(): { cache: Map<string, string> }; restore(s: unknown): void;
  };
  const snap = f.snapshot();
  snap.cache.clear();
  f.restore(snap);
}

async function mods() {
  return {
    api: await import("../src/server/api"),
    store: await import("../src/server/readModelStore"),
    archive: await import("../src/server/archiveStore"),
  };
}

beforeAll(async () => {
  await bootSyncedServer();
});
afterAll(() => teardownServer());

describe("durablyPeek", () => {
  it("answers undefined when neither level holds the entry, and computes nothing", async () => {
    await resetToSynced();
    const { store, archive } = await mods();
    archive.trashReadModels();
    flushL1();
    expect(store.durablyPeek("peekProbe", null)).toBeUndefined();
  });

  it("answers from the durable file once CacheService has lapsed, and promotes it to L1", async () => {
    await resetToSynced();
    const { store } = await mods();
    store.duringWarm(() => store.durablyCached("peekProbe", null, () => ({ n: 1 })));
    flushL1();
    expect(store.durablyPeek("peekProbe", null)).toEqual({ n: 1 });
    // Promoted: a read-through now hits L1 without calling its compute.
    let computed = false;
    expect(store.durablyCached("peekProbe", null, () => { computed = true; return { n: 2 }; }))
      .toEqual({ n: 1 });
    expect(computed).toBe(false);
  });
});

describe("bootstrapIfWarm", () => {
  it("fails soft on a cold core, so doGet ships the page and the client asks", async () => {
    await resetToSynced();
    const { api, archive } = await mods();
    archive.trashReadModels();
    flushL1();
    const res = api.bootstrapIfWarm();
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("cold");
  });

  it("answers what the RPC answers once the core is cached", async () => {
    await resetToSynced();
    const { api } = await mods();
    const viaRpc = api.bootstrap();
    expect(viaRpc.ok).toBe(true);
    const inline = api.bootstrapIfWarm();
    expect(inline.ok).toBe(true);
    expect(inline.data).toEqual(viaRpc.data);
  });
});
