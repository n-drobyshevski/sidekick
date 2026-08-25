// Pure migration-bundle export: a whole LedgerState as the portable JSON file the
// importer on the other side already understands.
//
// This is the missing half of importMerge.ts. `wiz_dashboard/data/migrate.py` writes
// this format and GAS ingests it; nothing wrote it *from* GAS, so a deployment that had
// been collecting for a month could not hand its history to anything else. The
// Databricks rebuild (`brick/`) needs exactly that, and so does anyone wanting a
// storage-independent backup of the register.
//
// `kind` and `version` deliberately stay MIGRATION_KIND / MIGRATION_VERSION, so a bundle
// this module writes is re-importable by GAS's own importer. That is what makes the
// export a disaster-recovery dump rather than a one-way door, and it is what the
// round-trip test asserts.
//
// Two departures from the column lists in migrate.py, which predate the vendor-fix and
// exploit-intelligence columns:
//
//   * ledger rows carry all of reconcile.LEDGER_COLUMNS, not the legacy 18. fix_date,
//     fix_observed_at, has_kev, has_exploit, epss and risk_observed_at cannot be
//     recovered from anywhere else once a finding stops being returned by the API, so
//     an export that dropped them would be lossy in exactly the fields that matter for
//     coverage and efficiency.
//   * episode rows carry all of EpisodeRow for the same reason — `tags_json` included, or
//     an export/import round-trip would re-lose the domain attribution compaction was just
//     taught to keep.
//
// What stays behind is storage-specific and meaningless off this deployment: `raw_ref`
// and `obs_ref` are Drive ids. Same call migrate.py makes, and importMerge.coerceScan
// nulls them on the way back in regardless.

import { scansAsc, type EpisodeRow, type LedgerState, type ScanRow } from "./ledgerCore";
import { MIGRATION_KIND, MIGRATION_VERSION, type MigrationBundle } from "./importMerge";
import { LEDGER_COLUMNS, type LedgerRow } from "./reconcile";
import type { Rec } from "./util";

/** `scans` minus the Drive references. Matches migrate.BUNDLE_SCAN_COLUMNS. */
export const BUNDLE_SCAN_COLUMNS: (keyof ScanRow)[] = [
  "scan_id", "ts", "mode", "shape", "total",
  "new_count", "resolved_count", "reopened_count", "severities", "sealed",
];

/** Every EpisodeRow field — wider than migrate.BUNDLE_EPISODE_COLUMNS, see the header. */
export const BUNDLE_EPISODE_COLUMNS: (keyof EpisodeRow)[] = [
  "vuln_key", "cve", "severity", "first_seen", "resolved_at",
  "resolution_src", "reopened_count", "compaction_id", "superseded_by_scan",
  "fix_date", "fix_observed_at",
  "has_kev", "has_exploit", "epss", "risk_observed_at",
  "tags_json",
];

/** mttr_history, including `open_past_sla` which the legacy Python export lacks. */
export const BUNDLE_HISTORY_COLUMNS = [
  "date", "median_days", "resolved", "open", "total",
  "sla_pct", "oldest_open_days", "open_past_sla",
] as const;

function project<T>(row: T, columns: readonly (keyof T)[]): Rec {
  const out: Rec = {};
  // `?? null` rather than a skip: a reader that column-maps by name must be able to tell
  // "the exporter had no value" from "this exporter did not know the column". Only the
  // second is a version signal, and an absent key would conflate them.
  for (const c of columns) out[String(c)] = (row[c] ?? null) as unknown;
  return out;
}

export interface BundleCounts {
  scans: number;
  ledger: number;
  episodes: number;
  mttr_history: number;
}

export function bundleCounts(bundle: MigrationBundle): BundleCounts {
  return {
    scans: bundle.scans.length,
    ledger: bundle.ledger.length,
    episodes: bundle.episodes.length,
    mttr_history: bundle.mttr_history.length,
  };
}

/**
 * Assemble the bundle from an in-memory state. Pure: no Drive, no Sheets, no clock —
 * `exportedAt` is passed in so the result is reproducible under test.
 *
 * Row order is deterministic (scans ts ASC then scan_id, ledger and episodes by
 * vuln_key), mirroring migrate.py's ORDER BY clauses, so two exports of an unchanged
 * register are byte-identical and a diff between them is real movement.
 */
export function buildMigrationBundle(
  state: LedgerState,
  // `object` rather than `Rec`: historyStore.HistoryPoint is a declared interface with no
  // index signature, and widening it here beats making the pure domain layer import a
  // server type just to name it.
  history: readonly object[],
  opts: { exportedAt: string; schemaVersion?: number },
): MigrationBundle & { schema_version: number | null } {
  const ledgerRows: LedgerRow[] = Object.keys(state.ledger)
    .sort()
    .map((k) => state.ledger[k]);
  const episodes = [...state.episodes].sort((a, b) =>
    a.vuln_key < b.vuln_key ? -1 : a.vuln_key > b.vuln_key ? 1 : 0,
  );
  return {
    kind: MIGRATION_KIND,
    version: MIGRATION_VERSION,
    exported_at: opts.exportedAt,
    schema_version: opts.schemaVersion ?? null,
    scans: scansAsc(state.scans).map((s) => project(s, BUNDLE_SCAN_COLUMNS)),
    ledger: ledgerRows.map((r) => project(r, LEDGER_COLUMNS)),
    episodes: episodes.map((e) => project(e, BUNDLE_EPISODE_COLUMNS)),
    mttr_history: history.map((h) => {
      const src = h as Rec;
      const out: Rec = {};
      for (const c of BUNDLE_HISTORY_COLUMNS) out[c] = src[c] ?? null;
      return out;
    }),
  };
}
