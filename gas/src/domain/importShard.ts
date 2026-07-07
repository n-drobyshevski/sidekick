// Pure per-shard migration import. For a FRESH GAS ledger (no scans, no compaction —
// the migration target), importBundleCore (importMerge.ts) degenerates to a per-row
// transform: replayScans is empty, and settledEpisodeRows decides each row independently
// (live === checkpoint on a fresh import). So a large bundle can be split into shards,
// each coerced+applied in its own execution, and the accumulated result is bit-identical
// to the one-shot importBundleCore — the property gas/test/importSharded.test.ts locks.
//
// This module has zero I/O; the server (ledgerStore) drives it and does the chunked
// Sheet appends. The one-shot path (importMerge.ts) and its golden fixtures are untouched.

import { CHECKPOINT_VERSION } from "./compaction";
import { scansAsc, type EpisodeRow, type ScanRow } from "./ledgerCore";
import { toEpisodeRow } from "./maintenance";
import { coerceEpisode, coerceLedger, coerceScan, ImportValidationError } from "./importMerge";
import type { LedgerRow } from "./reconcile";
import { parseTs, type Rec } from "./util";

export const MANIFEST_KIND = "wiz-sidekick-migration-manifest";
export const SHARD_KIND = "wiz-sidekick-migration-shard";
export const MANIFEST_VERSION = 1;

export interface ImportManifest {
  scans: Rec[];
  mttr_history: Rec[];
  shard_count: number;
  session_id: string | null;
  totals: { ledger: number; episodes: number };
}

export interface BeganSession {
  manifest: ImportManifest;
  sealedScans: ScanRow[]; // deduped, ts-ascending, all sealed
  sealedIds: Set<string>;
  floorScanId: string | null;
  floorTs: string | null;
}

/**
 * Validate a shard manifest and derive the whole-import inputs the per-row rule needs:
 * the deduped sealed scan set, the sealed-id set, and the checkpoint floor (last flat
 * scan). Mirrors the scan dedup + floor logic of importBundleCore (importMerge.ts).
 */
export function beginImportSession(rawManifest: unknown): BeganSession {
  if (rawManifest === null || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
    throw new ImportValidationError("The uploaded file is not a migration manifest.");
  }
  const rec = rawManifest as Rec;
  if (rec["kind"] !== MANIFEST_KIND) {
    throw new ImportValidationError(
      `Not a migration manifest (kind ${JSON.stringify(rec["kind"] ?? null)}).`,
    );
  }
  const shardCount = Number(rec["shard_count"]);
  if (!Number.isInteger(shardCount) || shardCount < 0) {
    throw new ImportValidationError(`Manifest shard_count ${rec["shard_count"]} is invalid.`);
  }
  const rawScans = Array.isArray(rec["scans"]) ? (rec["scans"] as Rec[]) : [];
  const rawHistory = Array.isArray(rec["mttr_history"]) ? (rec["mttr_history"] as Rec[]) : [];

  // Dedup by scan_id (first wins), coerce to sealed rows, sort ascending — exactly the
  // importBundleCore prefix (importMerge.ts:222-236).
  const seen = new Set<string>();
  const sealed: ScanRow[] = [];
  for (const raw of rawScans) {
    if (typeof raw["scan_id"] !== "string" || !raw["scan_id"] ||
        typeof raw["ts"] !== "string" || !raw["ts"]) {
      throw new ImportValidationError("Every manifest scan needs string scan_id and ts.");
    }
    if (seen.has(raw["scan_id"])) continue;
    seen.add(raw["scan_id"]);
    sealed.push(coerceScan(raw));
  }
  const sealedAsc = scansAsc(sealed);
  const badTs = sealedAsc.filter((r) => parseTs(r.ts) === null).map((r) => r.scan_id);
  if (badTs.length) {
    throw new ImportValidationError(`Manifest scan(s) ${badTs.join(", ")} have unparseable timestamps.`);
  }

  const flats = sealedAsc.filter((r) => r.shape === "flat");
  const floorRow = flats.length ? flats[flats.length - 1] : null;

  return {
    manifest: {
      scans: rawScans,
      mttr_history: rawHistory,
      shard_count: shardCount,
      session_id: typeof rec["session_id"] === "string" ? rec["session_id"] : null,
      totals: {
        ledger: Number((rec["totals"] as Rec)?.["ledger"] ?? 0),
        episodes: Number((rec["totals"] as Rec)?.["episodes"] ?? 0),
      },
    },
    sealedScans: sealedAsc,
    sealedIds: new Set(sealedAsc.map((r) => r.scan_id)),
    floorScanId: floorRow ? floorRow.scan_id : null,
    floorTs: floorRow ? floorRow.ts : null,
  };
}

export interface ShardOutcome {
  ledgerRows: LedgerRow[]; // OPEN (or RESOLVED not sealed here) → vuln_ledger
  episodeRows: EpisodeRow[]; // settled-at-floor conversions + bundle episodes → resolved_episodes
  checkpointRows: LedgerRow[]; // ALL coerced ledger rows of this shard (pre-conversion) → checkpoint part
  vulnsImported: number; // = checkpointRows.length (matches importBundleCore vulns_imported)
  episodesImported: number; // = bundle episodes in this shard
  episodesConverted: number; // = settled rows moved to episodes
}

/**
 * Apply one shard's rows with the per-row rule. `ctx` (sealedIds + compactionId) is fixed
 * for the whole import (from the manifest), so shards are independent and order-free.
 */
export function applyShardCore(
  shard: { ledger?: Rec[]; episodes?: Rec[] },
  ctx: { sealedIds: Set<string>; compactionId: string },
): ShardOutcome {
  const ledgerRows: LedgerRow[] = [];
  const episodeRows: EpisodeRow[] = [];
  const checkpointRows: LedgerRow[] = [];
  let converted = 0;

  for (const raw of shard.ledger ?? []) {
    const row = coerceLedger(raw);
    checkpointRows.push(row);
    // settledEpisodeRows (maintenance.ts:111) on a fresh import: a RESOLVED baseline row
    // whose last_scan_id is one of the imported (sealed) scans converts to an episode.
    if (row.status === "RESOLVED" && ctx.sealedIds.has(row.last_scan_id ?? "")) {
      episodeRows.push(toEpisodeRow(row, ctx.compactionId));
      converted += 1;
    } else {
      ledgerRows.push(row);
    }
  }
  for (const raw of shard.episodes ?? []) {
    episodeRows.push(coerceEpisode(raw));
  }

  return {
    ledgerRows,
    episodeRows,
    checkpointRows,
    vulnsImported: checkpointRows.length,
    episodesImported: (shard.episodes ?? []).length,
    episodesConverted: converted,
  };
}

/** The checkpoint manifest written at finalize; readCheckpoint concats `parts`. */
export interface CheckpointManifest {
  version: number;
  floor_scan_id: string | null;
  floor_ts: string | null;
  parts: string[]; // Drive file ids of checkpoint-part rows
}

export function checkpointManifest(
  floorScanId: string | null,
  floorTs: string | null,
  parts: string[],
): CheckpointManifest {
  return { version: CHECKPOINT_VERSION, floor_scan_id: floorScanId, floor_ts: floorTs, parts };
}
