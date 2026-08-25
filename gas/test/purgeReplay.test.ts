// The load-bearing test for Data → Maintenance.
//
// The whole reason the severity purge rewrites Drive archives — rather than just deleting
// rows from two tabs — is that the ledger is DERIVED state: `deleteScansCore` rebuilds it from
// the compaction checkpoint plus a replay of the surviving archives. Each `describe` below
// pairs the real behaviour with a NEGATIVE CONTROL that shows the resurrection actually
// happens when a step is skipped. The controls are the point: if someone later "optimises"
// the archive walk or the checkpoint rewrite away, the positive test alone would still pass
// against a stale fixture, while these fail loudly and name what broke.

import { describe, expect, it } from "vitest";
import {
  emptyState,
  persistFlatScan,
  type LedgerState,
  type ScanRow,
} from "../src/domain/ledgerCore";
import { deleteScansCore } from "../src/domain/maintenance";
import {
  purgeCheckpointByKeys,
  purgeCheckpointBySeverity,
  purgePayloadBySeverity,
  pruneEpisodesCore,
  purgeStateBySeverity,
} from "../src/domain/purge";
import type { Checkpoint } from "../src/domain/compaction";

const envelope = (nodes: unknown[]) => ({ data: { vulnerabilityFindings: { nodes } } });

function node(id: string, severity: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `CVE-2026-${id}`,
    severity,
    firstDetectedAt: "2026-01-01T00:00:00Z",
    status: "OPEN",
    vulnerableAsset: { id: `asset-${id}`, name: `host-${id}`, type: "VIRTUAL_MACHINE" },
    ...extra,
  };
}

/** Three scans over a mixed-severity estate, with their archives kept beside the state. */
function buildRegister(): { state: LedgerState; archives: Record<string, unknown> } {
  const state = emptyState();
  const archives: Record<string, unknown> = {};
  const scans = [
    { id: "2026-01-01T00:00:00Z", records: [node("a", "CRITICAL"), node("b", "LOW"), node("c", "MEDIUM")] },
    { id: "2026-02-01T00:00:00Z", records: [node("a", "CRITICAL"), node("b", "LOW"), node("d", "LOW")] },
    { id: "2026-03-01T00:00:00Z", records: [node("a", "CRITICAL"), node("d", "LOW")] },
  ];
  for (const s of scans) {
    persistFlatScan(state, s.records, { mode: "live", scanId: s.id });
    archives[s.id] = envelope(s.records);
  }
  return { state, archives };
}

const readerFor = (archives: Record<string, unknown>) => (row: ScanRow) =>
  archives[row.scan_id] ?? null;

/** Severities present across a rebuilt state's live rows and episodes. */
function severitiesIn(state: LedgerState): Set<string> {
  const out = new Set<string>();
  for (const r of Object.values(state.ledger)) out.add(String(r.severity));
  for (const e of state.episodes) out.add(String(e.severity));
  return out;
}

describe("severity purge survives a scan deletion", () => {
  it("purging state AND archives leaves nothing for the replay to resurrect", () => {
    const { state, archives } = buildRegister();
    expect(severitiesIn(state).has("LOW")).toBe(true);

    // What the feature actually does: tabs first, then every archive.
    const purged = purgeStateBySeverity(state, ["LOW"]).state;
    const rewritten: Record<string, unknown> = {};
    for (const [id, payload] of Object.entries(archives)) {
      rewritten[id] = purgePayloadBySeverity(payload, ["LOW"]).payload;
    }

    const rebuilt = deleteScansCore(
      purged, ["2026-02-01T00:00:00Z"], readerFor(rewritten), null,
    ).state;

    expect(severitiesIn(rebuilt).has("LOW")).toBe(false);
    expect(Object.keys(rebuilt.ledger).length).toBeGreaterThan(0); // the rest survived
  });

  it("NEGATIVE CONTROL: purging state only lets the replay bring LOW straight back", () => {
    const { state, archives } = buildRegister();
    const purged = purgeStateBySeverity(state, ["LOW"]).state;
    expect(severitiesIn(purged).has("LOW")).toBe(false);

    // Same delete, but against the ORIGINAL archives — this is what shipping without the
    // archive walk would do, and it is why the walk exists.
    const rebuilt = deleteScansCore(
      purged, ["2026-02-01T00:00:00Z"], readerFor(archives), null,
    ).state;

    expect(severitiesIn(rebuilt).has("LOW")).toBe(true);
  });

  it("NEGATIVE CONTROL: an un-purged checkpoint re-seeds the purged rows", () => {
    const { state, archives } = buildRegister();
    // A checkpoint built before the purge still carries every LOW lifecycle.
    const checkpoint: Checkpoint = {
      version: 1,
      floor_scan_id: "2026-01-01T00:00:00Z",
      floor_ts: "2026-01-01T00:00:00Z",
      ledger: Object.values(state.ledger).map((r) => ({ ...r })),
    };
    const purged = purgeStateBySeverity(state, ["LOW"]).state;
    const rewritten: Record<string, unknown> = {};
    for (const [id, payload] of Object.entries(archives)) {
      rewritten[id] = purgePayloadBySeverity(payload, ["LOW"]).payload;
    }

    const withStale = deleteScansCore(
      purged, ["2026-02-01T00:00:00Z"], readerFor(rewritten), checkpoint,
    ).state;
    expect(severitiesIn(withStale).has("LOW")).toBe(true);

    // Purging the checkpoint too — what ledgerStore.rewriteCheckpoints does — closes it.
    const clean = purgeCheckpointBySeverity(checkpoint, ["LOW"]).checkpoint;
    const withClean = deleteScansCore(
      purged, ["2026-02-01T00:00:00Z"], readerFor(rewritten), clean,
    ).state;
    expect(severitiesIn(withClean).has("LOW")).toBe(false);
  });

  it("an archive emptied of every record still replays as a readable scan", () => {
    // Every page filtered to zero nodes must remain a page. A null payload for a flat
    // survivor makes deleteScansCore throw LedgerRebuildError, permanently blocking scan
    // deletion — a worse failure than not purging.
    const { state, archives } = buildRegister();
    const purged = purgeStateBySeverity(state, ["CRITICAL", "LOW", "MEDIUM"]).state;
    const rewritten: Record<string, unknown> = {};
    for (const [id, payload] of Object.entries(archives)) {
      rewritten[id] = purgePayloadBySeverity(payload, ["CRITICAL", "LOW", "MEDIUM"]).payload;
    }
    expect(() =>
      deleteScansCore(purged, ["2026-02-01T00:00:00Z"], readerFor(rewritten), null),
    ).not.toThrow();
  });
});

describe("episode prune survives a scan deletion", () => {
  // deleteScansCore seeds the rebuilt ledger from the checkpoint MINUS the keys present in
  // resolved_episodes (maintenance.ts:216-220). So removing an episode row un-masks its
  // checkpoint entry — the pruned lifecycle returns as a live RESOLVED vuln_ledger row. This
  // is the non-obvious half of an operation that reads as inert.
  function setup() {
    const { state, archives } = buildRegister();
    const checkpoint: Checkpoint = {
      version: 1,
      floor_scan_id: "2026-01-01T00:00:00Z",
      floor_ts: "2026-01-01T00:00:00Z",
      ledger: Object.values(state.ledger).map((r) => ({ ...r })),
    };
    // Seal 'b' (resolved by disappearance in scan 3) as an episode, as compaction would.
    const bRow = state.ledger["" + Object.keys(state.ledger).find((k) => state.ledger[k].severity === "LOW")!];
    const withEpisode: LedgerState = {
      scans: state.scans.map((s) => ({ ...s })),
      ledger: Object.fromEntries(
        Object.entries(state.ledger).filter(([k]) => k !== bRow.vuln_key),
      ),
      episodes: [{
        vuln_key: bRow.vuln_key, cve: bRow.cve, severity: bRow.severity,
        first_seen: bRow.first_seen, resolved_at: "2026-02-15T00:00:00Z",
        resolution_src: "disappeared", reopened_count: 0, compaction_id: "cmp-1",
        superseded_by_scan: null, fix_date: null, fix_observed_at: null,
        has_kev: null, has_exploit: null, epss: null, risk_observed_at: null,
      }],
    };
    return { withEpisode, checkpoint, archives, key: bRow.vuln_key };
  }

  it("NEGATIVE CONTROL: pruning the tab alone restores the lifecycle as a live row", () => {
    const { withEpisode, checkpoint, archives, key } = setup();
    const pruned = pruneEpisodesCore(withEpisode, {
      resolvedBeforeMs: Date.parse("2026-06-01T00:00:00Z"), severities: null,
    }).state;
    expect(pruned.episodes).toHaveLength(0);

    const rebuilt = deleteScansCore(
      pruned, ["2026-02-01T00:00:00Z"], readerFor(archives), checkpoint,
    ).state;
    expect(Object.keys(rebuilt.ledger)).toContain(key);
  });

  it("pruning the checkpoint with it keeps the lifecycle gone", () => {
    const { withEpisode, checkpoint, archives, key } = setup();
    const out = pruneEpisodesCore(withEpisode, {
      resolvedBeforeMs: Date.parse("2026-06-01T00:00:00Z"), severities: null,
    });
    const cleanCp = purgeCheckpointByKeys(checkpoint, new Set(out.prunedKeys)).checkpoint;

    // The archives no longer carry it either (scan 3 dropped it), so nothing re-adds it.
    const trimmed: Record<string, unknown> = {};
    for (const [id, payload] of Object.entries(archives)) {
      trimmed[id] = purgePayloadBySeverity(payload, ["LOW"]).payload;
    }
    const rebuilt = deleteScansCore(
      out.state, ["2026-02-01T00:00:00Z"], readerFor(trimmed), cleanCp,
    ).state;
    expect(Object.keys(rebuilt.ledger)).not.toContain(key);
  });
});
