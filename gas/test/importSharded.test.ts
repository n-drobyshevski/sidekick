// The sharded import must be bit-identical to the one-shot importBundleCore on a fresh
// ledger. This locks that invariant: accumulating applyShardCore over any partition of a
// bundle's ledger+episodes equals importBundleCore(emptyState(), bundle, ...). The one-shot
// path and its Python-fixture parity (importMerge.test.ts) are untouched.

import { describe, expect, it } from "vitest";
import { importBundleCore, validateBundle } from "../src/domain/importMerge";
import {
  applyShardCore,
  beginImportSession,
  MANIFEST_KIND,
  MANIFEST_VERSION,
} from "../src/domain/importShard";
import { emptyState, type EpisodeRow } from "../src/domain/ledgerCore";
import type { LedgerRow } from "../src/domain/reconcile";
import { fixture } from "./helpers";

const CMP = "imp-test";

function manifestOf(bundle: any) {
  return {
    kind: MANIFEST_KIND,
    version: MANIFEST_VERSION,
    exported_at: bundle.exported_at ?? null,
    session_id: "sess-test",
    shard_count: 0, // set by caller per partition
    scans: bundle.scans,
    mttr_history: bundle.mttr_history ?? [],
    totals: { ledger: bundle.ledger.length, episodes: bundle.episodes.length },
  };
}

/** Split ledger+episodes into `n` shards, round-robin so both tables straddle boundaries. */
function shardsOf(bundle: any, n: number) {
  const shards = Array.from({ length: n }, () => ({ ledger: [] as any[], episodes: [] as any[] }));
  bundle.ledger.forEach((r: any, i: number) => shards[i % n].ledger.push(r));
  bundle.episodes.forEach((r: any, i: number) => shards[i % n].episodes.push(r));
  return shards;
}

/** Drive the pure sharded path and assemble a comparable {ledger, episodes, checkpoint}. */
function runSharded(bundle: any, shards: { ledger: any[]; episodes: any[] }[]) {
  const session = beginImportSession({ ...manifestOf(bundle), shard_count: shards.length });
  const ledger: Record<string, LedgerRow> = {};
  const episodes: EpisodeRow[] = [];
  const checkpoint: LedgerRow[] = [];
  let vulns = 0, eps = 0, conv = 0;
  for (const shard of shards) {
    const out = applyShardCore(shard, { sealedIds: session.sealedIds, compactionId: CMP });
    for (const row of out.ledgerRows) ledger[row.vuln_key] = row;
    episodes.push(...out.episodeRows);
    checkpoint.push(...out.checkpointRows);
    vulns += out.vulnsImported;
    eps += out.episodesImported;
    conv += out.episodesConverted;
  }
  return { ledger, episodes, checkpoint, session, counts: { vulns, eps, conv } };
}

const keyed = (rows: { vuln_key: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.vuln_key, r]));

describe("sharded import equals the one-shot importBundleCore (fresh ledger)", () => {
  const bundle = validateBundle(fixture("migration_bundle").scenario_a.bundle);
  const oneShot = importBundleCore(emptyState(), bundle, () => null, { compactionId: CMP });

  for (const n of [1, 2, 3, bundle.ledger.length + bundle.episodes.length + 2]) {
    it(`matches over ${n} shard(s)`, () => {
      const s = runSharded(bundle, shardsOf(bundle, n));
      // Live ledger (keyed) identical.
      expect(keyed(Object.values(s.ledger))).toEqual(keyed(Object.values(oneShot.state.ledger)));
      // Episodes identical as a set (accumulation order differs).
      expect(keyed(s.episodes)).toEqual(keyed(oneShot.state.episodes));
      expect(s.episodes.length).toBe(oneShot.state.episodes.length);
      // Checkpoint baseline (all pre-conversion rows) + floor identical.
      expect(keyed(s.checkpoint)).toEqual(keyed(oneShot.checkpoint.ledger));
      expect(s.session.floorScanId).toBe(oneShot.checkpoint.floor_scan_id);
      expect(s.session.floorTs).toBe(oneShot.checkpoint.floor_ts);
      // Counts line up with the one-shot ImportCounts.
      expect(s.counts.vulns).toBe(oneShot.counts.vulns_imported);
      expect(s.counts.eps).toBe(oneShot.counts.episodes_imported);
      expect(s.counts.conv).toBe(oneShot.counts.episodes_converted);
    });
  }

  it("handles an empty shard in the partition", () => {
    const shards = shardsOf(bundle, 2);
    shards.push({ ledger: [], episodes: [] });
    const s = runSharded(bundle, shards);
    expect(keyed(Object.values(s.ledger))).toEqual(keyed(Object.values(oneShot.state.ledger)));
    expect(keyed(s.episodes)).toEqual(keyed(oneShot.state.episodes));
  });

  it("a slimmed open row {vuln_key, first_seen} stays a live vuln", () => {
    const session = beginImportSession({
      kind: MANIFEST_KIND, version: MANIFEST_VERSION, shard_count: 1, session_id: "s",
      scans: [{ scan_id: "2020-01-01T00:00:00Z", ts: "2020-01-01T00:00:00Z" }],
      mttr_history: [], totals: { ledger: 1, episodes: 0 },
    });
    const out = applyShardCore(
      { ledger: [{ vuln_key: "id:lean", first_seen: "2019-01-01T00:00:00Z" }], episodes: [] },
      { sealedIds: session.sealedIds, compactionId: CMP },
    );
    expect(out.ledgerRows).toHaveLength(1);
    expect(out.ledgerRows[0].status).toBe("OPEN");
    expect(out.ledgerRows[0].first_seen).toBe("2019-01-01T00:00:00Z");
    expect(out.episodeRows).toHaveLength(0);
    expect(out.checkpointRows).toHaveLength(1);
  });

  it("rejects a manifest that is not a shard manifest", () => {
    expect(() => beginImportSession({ kind: "wiz-sidekick-migration", shard_count: 1 })).toThrow();
    expect(() => beginImportSession(null)).toThrow();
  });
});
