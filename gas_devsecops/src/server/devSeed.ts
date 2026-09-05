// The seeding entry point — closes the gap between `dev/sampleData.dev.ts`'s generated
// battery and a ledger a dev-harness page can actually render against.
//
// THE GAP THIS CLOSES. Two things stood between the sample data and the browser:
//
//   1. Nothing under `src/server` imported the specifier `./sampleData`, so `dev/serve.mjs`'s
//      esbuild alias (which rewrites that exact specifier to `dev/sampleData.dev.ts` on every
//      dev build) never fired. THIS file is that import site — see `./sampleData`, below.
//   2. `ledgerStore` was not exported onto the GAS global `Server`, so `persistSync` was
//      unreachable from `dev/boot.js`. `src/server/index.ts` now re-exports THIS module
//      (`devSeed`) instead of `ledgerStore` directly, because the dev harness needs "seed the
//      sample battery", not raw access to the ledger's persistence internals.
//
// WHY THIS IS SAFE IN A DEPLOYED BUILD. `./sampleData` resolves to `src/server/sampleData.ts`
// in every build except the dev one — and that file ships with `SAMPLE_SYNCS: []` on
// principle (see its own header). `seedSampleLedger` checks that FIRST, before touching
// `scanJobs` or `ledgerStore` at all, so a deployed build's `Server.devSeed.seedSampleLedger()`
// is a documented no-op rather than a code path that merely happens not to run today.
//
// THE PIPELINE, IN ORDER — the same one `scanJobs.step` runs in production, never hand-rolled:
//
//   for each entry in SAMPLE_SYNCS:
//     for each scope battery in entry.scopes:
//       records = battery.rawRecords.map(node => scanJobs.slimRecord(battery.scope, node))
//     ledgerStore.persistSync(jobId, entry.syncId, perScope)
//
// `dev/sampleData.dev.ts` generates RAW Wiz-shaped nodes on purpose (see that file's header):
// hand-writing ledger rows would bypass `domain/reconcile.ts`'s twin fold and resolve-by-
// disappearance, and the whole point of the sample battery is to exercise those for real.
// `test/sampleData.test.ts` already proves this exact sequence reconciles to the counts it
// claims; `test/devSeed.test.ts` proves this function is the thing that runs it.

import * as scanJobs from "./scanJobs";
import * as ledgerStore from "./ledgerStore";
import type { ScopePersist } from "./ledgerStore";
import { SAMPLE_SYNCS } from "./sampleData";
import type { Scope } from "../domain/config";

export interface SeedResult {
  /** Ledger rows the store holds for these scopes after seeding — not merely rows added. */
  seeded: number;
  /** SAMPLE_SYNCS entries processed (attempted, including idempotent replays). */
  syncs: number;
  /** Raw nodes fed through slimRecord across every scope of every sync. */
  rows: number;
  /** Set only when nothing was seeded — e.g. a production build, where SAMPLE_SYNCS is empty. */
  reason?: string;
}

export function seedSampleLedger(): SeedResult {
  // First thing this function checks, deliberately: a production build's ./sampleData ships
  // SAMPLE_SYNCS empty, and that must be the whole story — no partial work, no side effect.
  if (SAMPLE_SYNCS.length === 0) {
    return { seeded: 0, syncs: 0, rows: 0, reason: "no sample data in this build" };
  }

  let rows = 0;
  // Every scope the battery ever mentions — tracked up front, not from `committed_scopes`,
  // because a replay against an already-seeded store (persistSync's per-(scan_id, scope)
  // idempotency) commits nothing on its second run but the ledger rows from the first run
  // are still genuinely there; `seeded` below has to keep counting them either way.
  const scopesTouched = new Set<Scope>();

  for (let i = 0; i < SAMPLE_SYNCS.length; i++) {
    const sync = SAMPLE_SYNCS[i]!;
    const perScope: ScopePersist[] = sync.scopes.map((battery) => {
      rows += battery.rawRecords.length;
      scopesTouched.add(battery.scope);
      return {
        scope: battery.scope,
        records: battery.rawRecords.map((node) => scanJobs.slimRecord(battery.scope, node)),
        mode: battery.mode,
        scannedSeverities: battery.scannedSeverities,
        rawRef: null,
      };
    });
    const jobId = `dev-seed-${i + 1}`;
    ledgerStore.persistSync(jobId, sync.syncId, perScope);
  }

  const seeded = Object.values(ledgerStore.loadState().ledger).filter((row) =>
    scopesTouched.has(row.scope),
  ).length;

  return { seeded, syncs: SAMPLE_SYNCS.length, rows };
}
