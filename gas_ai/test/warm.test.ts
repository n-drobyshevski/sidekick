// Keeping the read-models warm between syncs.
//
// Three properties worth pinning: that a pass actually populates the entries a page load
// would otherwise compute, that it degrades rather than dies when it runs out of budget, and
// that it refuses to run while a sync is mid-persist. The last one is correctness, not
// courtesy — a warm reading a half-written ledger caches a torn read under the pre-bump
// version and serves it for the rest of the window.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSyncedServer, measure, resetToSynced, teardownServer } from "./gasEnv";

let server: Awaited<ReturnType<typeof bootSyncedServer>>;

async function warmMod() {
  return await import("../src/server/warm");
}

/** Drop every CacheService entry, leaving the ledger alone: a cold cache over warm data. */
function flushCache(): void {
  const f = (globalThis as Record<string, unknown>)["__gasFakes"] as {
    snapshot(): { cache: Map<string, string> }; restore(s: unknown): void;
  };
  const snap = f.snapshot();
  snap.cache.clear();
  f.restore(snap);
}

/**
 * Drop BOTH cache levels — a genuinely cold read.
 *
 * `flushCache` alone models a CacheService expiry, which the durable level is specifically
 * built to absorb, so it no longer produces a cold read of anything durable.
 */
async function flushBoth(): Promise<void> {
  flushCache();
  const { trashReadModels } = await import("../src/server/archiveStore");
  trashReadModels();
}

beforeAll(async () => {
  server = await bootSyncedServer();
});
afterAll(() => teardownServer());

describe("warmReadModels", () => {
  it("populates the entries a first page load would otherwise compute", async () => {
    server = await resetToSynced();
    const { warmReadModels } = await warmMod();

    // A GENUINELY cold read now needs BOTH levels flushed, and that is the durable store
    // doing its job rather than an inconvenience: dropping CacheService alone is exactly the
    // six-hourly lapse the L2 exists to absorb. This spec used to flush L1 and call the
    // result cold; once the L2 landed that read cost 0 ledger cells and the assertion
    // became `expect(0).toBeLessThan(0)`.
    await flushBoth();
    const cold = measure(() => server.api.bootstrap({}));
    expect(cold.counters.cellsRead).toBeGreaterThan(0);

    await flushBoth();
    const res = warmReadModels();
    expect(res.warmed).toBeGreaterThan(8);
    expect(res.failed).toBe(0);
    expect(res.skipped).toBe(0);

    // Warm: no ledger read at all.
    const warm = measure(() => server.api.bootstrap({}));
    expect(warm.counters.cellsRead).toBe(0);
    expect((warm.value as { ok: boolean }).ok).toBe(true);
  });

  it("survives the six-hour lapse: L1 gone, Drive answers, the ledger is untouched", async () => {
    server = await resetToSynced();
    const { warmReadModels } = await warmMod();

    await flushBoth();
    warmReadModels();

    // What a CacheService expiry looks like: entries gone, Drive intact.
    flushCache();
    const after = measure(() => server.api.bootstrap({}));
    expect(after.counters.cellsRead).toBe(0);
    expect((after.value as { ok: boolean }).ok).toBe(true);
  });

  it("answers identically warm and cold — a warm changes cost, never content", async () => {
    server = await resetToSynced();
    const { warmReadModels } = await warmMod();

    flushCache();
    const coldBoot = JSON.stringify(server.api.bootstrap({}));
    const coldProblems = JSON.stringify(server.api.getProblems({}));

    flushCache();
    warmReadModels();
    expect(JSON.stringify(server.api.bootstrap({}))).toBe(coldBoot);
    expect(JSON.stringify(server.api.getProblems({}))).toBe(coldProblems);
  });

  it("stops at the budget and reports what it left cold, rather than dying", async () => {
    server = await resetToSynced();
    const { warmReadModels } = await warmMod();
    flushCache();
    // A budget nothing can fit inside: every target is skipped, and that is a REPORT rather
    // than an exception. A killed execution warms nothing and says nothing about why.
    const res = warmReadModels(0);
    expect(res.warmed).toBe(0);
    expect(res.skipped).toBeGreaterThan(8);
    expect(res.failed).toBe(0);
  });

  // THE MEASUREMENT THAT JUSTIFIES THE serverCache MEMO, and the reason it landed with the
  // warm rather than earlier. Every read endpoint resolves exactly ONE cached entry, so on a
  // page load — where each RPC is its own GAS execution — a per-execution memo can never
  // deduplicate anything. The warm is the first caller that resolves a dozen entries inside
  // one execution, and without the memo it would re-read DATA_VERSION and the domain tag key
  // once per entry.
  it("reads each cache-key property once for the whole pass, not once per entry", async () => {
    server = await resetToSynced();
    const { warmReadModels } = await warmMod();
    const serverCache = await import("../src/server/serverCache");

    flushCache();
    serverCache.__resetMemosForTest();
    const { value: res, counters } = measure(() => warmReadModels());
    expect(res.warmed).toBeGreaterThan(8);

    // ONE read of the version for a pass that resolved twelve entries. Measured against the
    // same pass with the memos dropped before each entry: DATA_VERSION 12 -> 1, and total
    // PropertiesService reads 39 -> 21.
    expect(res.warmed).toBe(12);
    expect(counters.propGetKeys["DATA_VERSION"] ?? 0).toBe(1);

    // THE DOMAIN TAG KEY IS NOT 1, AND THAT IS CORRECT RATHER THAN A GAP IN THE MEMO. The
    // stamp memo covers the cache-KEY use of it; the fold that reads a domain off a resource
    // calls props.domainTagKey() directly on every compute that needs it, and those are real
    // reads of a real input. What the memo removed is the dozen made purely to rebuild a key
    // prefix: 24 -> 15 across this pass. Asserted as a bound rather than an exact figure,
    // because that number properly moves when a read-model changes what it folds.
    expect(counters.propGetKeys["WIZ_DOMAIN_TAG_KEY"] ?? 0).toBeLessThan(res.warmed * 2);
    expect(counters.propGet).toBeLessThan(30);
  });
});

describe("warmReadModelsScheduled", () => {
  it("refuses to run while a job is in flight", async () => {
    server = await resetToSynced();
    const { warmReadModelsScheduled } = await warmMod();
    const { createJob } = await import("../src/server/jobsStore");

    createJob({
      job_id: "sync-inflight", kind: "sync", phase: "PERSISTING", sync_id: "s1",
      step_index: 0, cursor: null, page: 0, nodes_so_far: 0, total_count: 0,
      part_refs_json: null, params_json: null, error: null,
    });

    // Null, not an empty result: the caller can tell "skipped" from "warmed nothing".
    expect(warmReadModelsScheduled()).toBeNull();
  });

  it("runs when no job is in flight", async () => {
    server = await resetToSynced();
    const { warmReadModelsScheduled } = await warmMod();
    PropertiesService.getScriptProperties().deleteProperty("ACTIVE_JOB_ID");
    const res = warmReadModelsScheduled();
    expect(res).not.toBeNull();
    expect(res!.warmed).toBeGreaterThan(8);
  });
});
