// Persistent register history: one ledger-stats snapshot per UTC day, latest wins.
//
// The Drive-backed analogue of gas's `mttr_history` Sheets tab (wiz_dashboard/data/history.py)
// — same contract (one row per UTC day, a same-day rewrite replaces rather than accumulating,
// read back sorted ascending by date) but stored as an opaque `stats` object per day under
// archiveStore's `history/` folder rather than as named Sheets columns. This register's
// remediation-analytics domain layer (the source of what "stats" actually contains) is a
// separate Phase 2 package and had not landed when this was written, so the shape is left to
// the caller rather than pinned to fields (median_days, sla_pct, ...) that may not apply to
// three scopes (SAST/SCA/secrets) the way they did to one.
//
// Idempotent by construction, not by a filter-and-rewrite pass: the file NAME is the UTC day
// (`history/<YYYY-MM-DD>.json.gz`), and `writeGzJson` always trashes any same-name file before
// writing — so a second `recordDaily()` call on the same day overwrites the one file rather
// than requiring an in-memory row list to be de-duplicated, the way the Sheets-tab version
// needed to filter its own rows by date before every write.

import { listNames, readGzJson, subfolder, writeGzJson } from "./archiveStore";

const FOLDER = "history" as const;
const NAME_RE = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function fileName(day: string): string {
  return `${day}.json.gz`;
}

export interface HistoryEntry {
  date: string;
  stats: unknown;
}

/**
 * Upsert the ledger-stats snapshot for `now`'s UTC day (defaults to the current time).
 * Never throws: same behaviour as gas's `recordSnapshot` on this point — a history problem
 * must not fail whatever pipeline is recording it. `writeGzJson` itself only throws on a
 * genuine Drive failure (e.g. a missing archive folder), which the caller is free to let
 * propagate; nothing here catches it a second time.
 */
export function recordDaily(stats: unknown, now: number = Date.now()): void {
  writeGzJson(subfolder(FOLDER), fileName(utcDay(now)), stats);
}

/** Every recorded day's stats, ascending by date. Malformed file names are skipped. */
export function listHistory(): HistoryEntry[] {
  const days = listNames(FOLDER)
    .map((n) => NAME_RE.exec(n)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort();
  return days.map((date) => ({ date, stats: readGzJson(subfolder(FOLDER), fileName(date)) }));
}
