// Pure migration-import logic: merge a bundle exported by the legacy Streamlit app
// (wiz_dashboard/data/migrate.py) into a LedgerState.
//
// The merge is defined as "the unified history compacted at the import floor":
// imported scans become the sealed prefix (their raw archives stay on the old
// machine), the bundle's ledger/episodes seed the baseline, the existing GAS scans
// are replayed over it (the deleteScansCore machinery), and a synthetic compaction
// checkpoint pins the floor so later delete-rebuilds and compactions stay correct.
// Field-level smart-merge semantics (first_seen backdating, reopens, resolution by
// disappearance) all fall out of reconcile during the replay.

import { CHECKPOINT_VERSION, type Checkpoint } from "./compaction";
import { scansAsc, type EpisodeRow, type LedgerState, type ScanRow } from "./ledgerCore";
import {
  loadReplayPayloads,
  replayScans,
  settledEpisodeRows,
  toEpisodeRow,
  type PayloadReader,
} from "./maintenance";
import type { LedgerRow, Observation } from "./reconcile";
import { normalizeSeverity } from "./severity";
import { parseTs, type Rec } from "./util";

export const MIGRATION_KIND = "wiz-sidekick-migration";
export const MIGRATION_VERSION = 1;

// Generous sanity caps — a bundle past these is either corrupt or beyond what a
// single GAS execution can absorb anyway.
const MAX_SCANS = 500;
const MAX_LEDGER_ROWS = 200_000;
const MAX_EPISODES = 200_000;
const MAX_HISTORY_ROWS = 5_000;

export class ImportValidationError extends Error {}

export interface MigrationBundle {
  kind: string;
  version: number;
  exported_at: string | null;
  scans: Rec[];
  ledger: Rec[];
  episodes: Rec[];
  mttr_history: Rec[];
}

function asArray(value: unknown, name: string): Rec[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ImportValidationError(`Bundle field "${name}" must be a list.`);
  }
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ImportValidationError(`Bundle field "${name}" must contain objects.`);
    }
  }
  return value as Rec[];
}

/** Structural validation of an uploaded bundle (throws ImportValidationError). */
export function validateBundle(data: unknown): MigrationBundle {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ImportValidationError("The uploaded file is not a migration bundle.");
  }
  const rec = data as Rec;
  if (rec["kind"] !== MIGRATION_KIND) {
    throw new ImportValidationError(
      `Not a migration bundle (kind ${JSON.stringify(rec["kind"] ?? null)}).`,
    );
  }
  const version = Number(rec["version"]);
  if (version !== MIGRATION_VERSION) {
    throw new ImportValidationError(
      `Unsupported bundle version ${rec["version"]} — this app understands version ` +
        `${MIGRATION_VERSION}. The bundle may come from a newer exporter.`,
    );
  }
  const scans = asArray(rec["scans"], "scans");
  const ledger = asArray(rec["ledger"], "ledger");
  const episodes = asArray(rec["episodes"], "episodes");
  const mttrHistory = asArray(rec["mttr_history"], "mttr_history");
  if (scans.length > MAX_SCANS) {
    throw new ImportValidationError(
      `Bundle has ${scans.length} scans — over the ${MAX_SCANS}-scan import limit.`,
    );
  }
  if (ledger.length > MAX_LEDGER_ROWS) {
    throw new ImportValidationError(
      `Bundle has ${ledger.length} ledger rows — over the ${MAX_LEDGER_ROWS}-row limit.`,
    );
  }
  if (episodes.length > MAX_EPISODES) {
    throw new ImportValidationError(
      `Bundle has ${episodes.length} episodes — over the ${MAX_EPISODES}-row limit.`,
    );
  }
  if (mttrHistory.length > MAX_HISTORY_ROWS) {
    throw new ImportValidationError(
      `Bundle has ${mttrHistory.length} history rows — over the ${MAX_HISTORY_ROWS}-row limit.`,
    );
  }
  for (const s of scans) {
    if (typeof s["scan_id"] !== "string" || !s["scan_id"] || typeof s["ts"] !== "string" || !s["ts"]) {
      throw new ImportValidationError("Every bundle scan needs string scan_id and ts.");
    }
  }
  for (const [name, rows] of [["ledger", ledger], ["episodes", episodes]] as const) {
    for (const r of rows) {
      if (typeof r["vuln_key"] !== "string" || !r["vuln_key"]) {
        throw new ImportValidationError(`Every bundle ${name} row needs a string vuln_key.`);
      }
    }
  }
  return {
    kind: MIGRATION_KIND,
    version,
    exported_at: typeof rec["exported_at"] === "string" ? rec["exported_at"] : null,
    scans,
    ledger,
    episodes,
    mttr_history: mttrHistory,
  };
}

// ------------------------------------------------------------------ row coercions

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/** An imported scan row: always sealed, never carrying storage refs. */
export function coerceScan(r: Rec): ScanRow {
  return {
    scan_id: String(r["scan_id"]),
    ts: String(r["ts"]),
    mode: String(r["mode"] ?? "import"),
    shape: (r["shape"] === "grouped" ? "grouped" : "flat") as "flat" | "grouped",
    total: Number(r["total"] ?? 0),
    new_count: Number(r["new_count"] ?? 0),
    resolved_count: Number(r["resolved_count"] ?? 0),
    reopened_count: Number(r["reopened_count"] ?? 0),
    raw_ref: null,
    obs_ref: null,
    severities: str(r["severities"]),
    sealed: 1,
  };
}

export function coerceLedger(r: Rec): LedgerRow {
  return {
    vuln_key: String(r["vuln_key"]),
    cve: str(r["cve"]),
    // Normalize at ingest (blank/null/unrecognized → explicit "UNKNOWN"), not str() — the
    // legacy migrate export stored raw values that could reach the ledger as literal null
    // and never self-heal for out-of-fetch-scope severities. UNKNOWN is auditable.
    severity: normalizeSeverity(r["severity"]),
    asset_id: str(r["asset_id"]),
    asset_name: str(r["asset_name"]),
    asset_type: str(r["asset_type"]),
    cloud: str(r["cloud"]),
    first_seen: str(r["first_seen"]),
    last_seen: str(r["last_seen"]),
    status: String(r["status"] ?? "OPEN"),
    resolved_at: str(r["resolved_at"]),
    resolution_src: str(r["resolution_src"]),
    reopened_count: Number(r["reopened_count"] ?? 0),
    first_scan_id: str(r["first_scan_id"]),
    last_scan_id: str(r["last_scan_id"]),
    subscription_name: str(r["subscription_name"]),
    subscription_ext_id: str(r["subscription_ext_id"]),
    tags_json: str(r["tags_json"]),
    fix_date: str(r["fix_date"]),
    fix_observed_at: str(r["fix_observed_at"]),
  };
}

export function coerceEpisode(r: Rec): EpisodeRow {
  return {
    vuln_key: String(r["vuln_key"]),
    cve: str(r["cve"]),
    severity: normalizeSeverity(r["severity"]),
    first_seen: str(r["first_seen"]),
    resolved_at: str(r["resolved_at"]),
    resolution_src: str(r["resolution_src"]),
    reopened_count: Number(r["reopened_count"] ?? 0),
    compaction_id: String(r["compaction_id"] ?? "import"),
    superseded_by_scan: str(r["superseded_by_scan"]),
    fix_date: str(r["fix_date"]),
    fix_observed_at: str(r["fix_observed_at"]),
  };
}

// ------------------------------------------------------------------------ the merge

export interface ImportCounts {
  scans_imported: number;
  scans_skipped: number;
  vulns_imported: number;
  episodes_imported: number;
  episodes_converted: number;
  scans_replayed: number;
  // Imported ledger + episode rows whose severity normalized to UNKNOWN — a data-quality
  // signal surfaced in the import toast so an operator sees how much of the seed is
  // unclassified rather than discovering it silently in the register weeks later.
  unclassified_severity: number;
}

/**
 * Merge a validated bundle into `state` (not mutated). Throws ImportValidationError /
 * LedgerRebuildError BEFORE producing any state change. The returned checkpoint is
 * the imported baseline pinned at the import floor — the caller must persist it as a
 * compaction record, or the sealed prefix can never be rebuilt around.
 */
export function importBundleCore(
  state: LedgerState,
  bundle: MigrationBundle,
  readPayload: PayloadReader,
  options: { compactionId: string },
): {
  state: LedgerState;
  checkpoint: Checkpoint;
  observationsByScan: Record<string, Observation[]>;
  counts: ImportCounts;
} {
  const existingRows = scansAsc(state.scans);
  const sealedExisting = existingRows.filter((r) => r.sealed).map((r) => r.scan_id);
  if (sealedExisting.length) {
    throw new ImportValidationError(
      `This ledger already has compacted (sealed) history (${sealedExisting.join(", ")}) — ` +
        `two compacted histories can't be merged. Import into a ledger that has never ` +
        `been compacted.`,
    );
  }

  // Dedupe: within the bundle by scan_id (first wins), then against existing rows.
  const existingIds = new Set(existingRows.map((r) => r.scan_id));
  const seen = new Set<string>();
  const imported: ScanRow[] = [];
  let skipped = 0;
  for (const raw of bundle.scans) {
    const row = coerceScan(raw);
    if (seen.has(row.scan_id) || existingIds.has(row.scan_id)) {
      skipped += 1;
      continue;
    }
    seen.add(row.scan_id);
    imported.push(row);
  }
  const importedAsc = scansAsc(imported);

  // Strict ordering: the sealed prefix must be a ts-contiguous prefix of all scans,
  // so every imported scan must predate every existing one.
  const badTs = importedAsc.filter((r) => parseTs(r.ts) === null).map((r) => r.scan_id);
  if (badTs.length) {
    throw new ImportValidationError(
      `Bundle scan(s) ${badTs.join(", ")} have unparseable timestamps.`,
    );
  }
  if (importedAsc.length && existingRows.length) {
    const newestImported = importedAsc[importedAsc.length - 1];
    const oldestExisting = existingRows[0];
    const newestMs = parseTs(newestImported.ts);
    const oldestMs = parseTs(oldestExisting.ts);
    if (oldestMs === null || newestMs === null || newestMs >= oldestMs) {
      throw new ImportValidationError(
        `Imported history must be strictly older than this ledger's: bundle scan ` +
          `${newestImported.scan_id} is not older than existing scan ` +
          `${oldestExisting.scan_id}. Delete the overlapping scans on one side first.`,
      );
    }
  }

  // Captured before replay pushes the GAS rows onto rebuilt.scans.
  const importedIds = new Set(importedAsc.map((r) => r.scan_id));
  const importedCount = importedAsc.length;

  // Seed the baseline from the bundle. Episodes keep their supersessions verbatim —
  // unlike delete-rebuild, the superseding scans are part of the imported history.
  const rebuilt: LedgerState = {
    scans: importedAsc,
    ledger: {},
    episodes: bundle.episodes.map(coerceEpisode),
  };
  for (const raw of bundle.ledger) {
    const row = coerceLedger(raw);
    rebuilt.ledger[row.vuln_key] = row;
  }
  const vulnsImported = Object.keys(rebuilt.ledger).length;

  // Data-quality tally over the raw seed (ledger + episodes) — rows whose severity can't be
  // classified. Counted over the bundle rows so it lines up with Σ of the sharded path's
  // per-shard counts (importSharded.ts partitions exactly these two tables).
  const unclassifiedSeverity =
    bundle.ledger.filter((r) => normalizeSeverity(r["severity"]) === "UNKNOWN").length +
    bundle.episodes.filter((r) => normalizeSeverity(r["severity"]) === "UNKNOWN").length;

  // The checkpoint captures the baseline BEFORE replay mutates it.
  const flats = importedAsc.filter((r) => r.shape === "flat");
  const floorRow = flats.length ? flats[flats.length - 1] : null;
  const checkpoint: Checkpoint = {
    version: CHECKPOINT_VERSION,
    floor_scan_id: floorRow ? floorRow.scan_id : null,
    floor_ts: floorRow ? floorRow.ts : null,
    ledger: Object.values(rebuilt.ledger).map((r) => ({ ...r })),
  };

  // Replay the existing GAS scans over the imported baseline (payloads validated
  // first — a missing archive throws before anything is returned to the caller).
  const replay = loadReplayPayloads(
    existingRows,
    readPayload,
    (scanId) =>
      `Cannot import: the archived payload for existing scan ${scanId} is missing, ` +
      `so it can't be replayed over the imported history.`,
  );
  const observationsByScan = replayScans(rebuilt, replay);

  // Episode conversion at the import floor — same rule as compaction: baseline rows
  // whose lifecycle was settled before the GAS era leave the live ledger.
  const converted = settledEpisodeRows(checkpoint.ledger, rebuilt.ledger, importedIds);
  for (const live of converted) {
    rebuilt.episodes.push(toEpisodeRow(live, options.compactionId));
    delete rebuilt.ledger[live.vuln_key];
  }

  return {
    state: rebuilt,
    checkpoint,
    observationsByScan,
    counts: {
      scans_imported: importedCount,
      scans_skipped: skipped,
      vulns_imported: vulnsImported,
      episodes_imported: bundle.episodes.length,
      episodes_converted: converted.length,
      scans_replayed: replay.length,
      unclassified_severity: unclassifiedSeverity,
    },
  };
}

// -------------------------------------------------------------------- MTTR history

/**
 * Merge imported MTTR history into the existing rows: keyed by date, the existing
 * (GAS) row wins, imported rows fill missing dates, result sorted by date. Rows with
 * unparseable dates are skipped.
 */
export function mergeMttrHistory(
  existing: Rec[],
  imported: Rec[],
): { rows: Rec[]; added: number; skipped: number } {
  const byDate = new Map<string, Rec>();
  for (const r of existing) {
    const date = r["date"];
    if (typeof date === "string" && !Number.isNaN(Date.parse(date))) {
      byDate.set(date.slice(0, 10), r);
    }
  }
  let added = 0;
  let skipped = 0;
  for (const r of imported) {
    const date = r["date"];
    if (typeof date !== "string" || Number.isNaN(Date.parse(date))) {
      skipped += 1;
      continue;
    }
    const key = date.slice(0, 10);
    if (byDate.has(key)) {
      skipped += 1;
      continue;
    }
    byDate.set(key, {
      date: key,
      median_days: Number(r["median_days"] ?? 0),
      resolved: Number(r["resolved"] ?? 0),
      open: Number(r["open"] ?? 0),
      total: Number(r["total"] ?? 0),
      sla_pct: r["sla_pct"] === null || r["sla_pct"] === undefined ? null : Number(r["sla_pct"]),
      oldest_open_days:
        r["oldest_open_days"] === null || r["oldest_open_days"] === undefined
          ? null
          : Number(r["oldest_open_days"]),
      open_past_sla: r["open_past_sla"] ?? null,
    });
    added += 1;
  }
  const rows = [...byDate.values()].sort((a, b) =>
    String(a["date"]) < String(b["date"]) ? -1 : String(a["date"]) > String(b["date"]) ? 1 : 0,
  );
  return { rows, added, skipped };
}
