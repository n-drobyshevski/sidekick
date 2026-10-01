// A bounded ring buffer of recent server-side errors, persisted in Script Properties so a
// failure survives the request that produced it and is viewable in-app (Data → Recent errors)
// instead of only in the Apps Script execution log — which the operator can't reach from the
// deployed web app. PORTED FROM gas/src/server/errorLog.ts, same key, caps and contract.
//
// WHY THIS REGISTER NEEDS IT AS WELL AS THE `jobs` TAB. A failed sync leaves its message in
// the job row's `error` column, and `api.getRecentErrors` still reads that. Everything else
// that fails here does so SILENTLY: a read RPC that throws, the post-commit chores (history
// entry, auto-compaction, read-model warm), a durable read-model level that Drive refused, an
// unreadable repository-tag tab, a daily trigger that found no credentials. Each of those used
// to be a console.warn in an execution transcript nobody opens.
//
// Best-effort by design: recording never throws (it must not mask the error it is logging)
// and is not lock-guarded (a lost entry under a rare concurrent write is acceptable for a
// diagnostic log; the ledger lock is far too heavy for an error path). One Script Property
// holds the whole JSON array, so the entry count and message length are capped to stay well
// under the 9 KB per-value quota.
//
// DIVERGENCE (gas/): `markRecorded`. A sync hop that fails writes the job row's `error` column
// and then RETHROWS, so the same Error object goes on to reach `api.run()` (the first hop runs
// inside the "Run sync" RPC) or `scanJobs.continueJob`'s catch. Both record what reaches them,
// and `getRecentErrors` merges the job rows with this log — so without a way to say "this one
// already has a home", one failure would be listed twice.

import { nowIso, type Rec } from "../domain/util";
import { deleteProp, getProp, setProp } from "./props";

const KEY = "RECENT_ERRORS";
const MAX_ENTRIES = 25;
const MAX_MESSAGE_LEN = 500;
// Script Properties cap a single value at ~9 KB. 25 long messages can exceed that, so the
// serialized blob is trimmed (oldest first) to stay under this ceiling — otherwise setProperty
// throws and recordError silently drops the write, defeating the whole log.
const MAX_BLOB_CHARS = 8500;

export interface ErrorEntry {
  ts: string; // ISO-Z of when it was recorded
  op: string; // operation label, e.g. "cacheWarm", "autoCompact", "api"
  kind: string; // error kind — "error" for every entry this register records today
  message: string; // the error message, truncated
}

// Thrown values whose failure is already recorded elsewhere, for the life of this execution
// only (module state does not outlive an Apps Script execution). A WeakSet, so it pins nothing;
// a primitive throw cannot be held and is simply never deduplicated.
const alreadyRecorded = new WeakSet<object>();

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) + "…" : s;
}

/** The recorded errors, newest first. Tolerates a missing / malformed blob (returns []). */
export function recentErrors(): ErrorEntry[] {
  const raw = getProp(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Rec => Boolean(e) && typeof e === "object" && !Array.isArray(e))
      .map((e) => ({
        ts: String(e["ts"] ?? ""),
        op: String(e["op"] ?? "api"),
        kind: String(e["kind"] ?? "error"),
        message: String(e["message"] ?? ""),
      }));
  } catch {
    return [];
  }
}

/**
 * Say that `err`'s failure already has a durable record (a job row's `error` column), so a
 * caller further up that catches the same thrown value does not add it to this log as well.
 * Never throws.
 */
export function markRecorded(err: unknown): void {
  try {
    if (err !== null && typeof err === "object") alreadyRecorded.add(err);
  } catch {
    // best-effort, like everything else here
  }
}

/**
 * Record one error (newest first, capped at MAX_ENTRIES). `err` may be any thrown value; its
 * `.message` is preferred over String(err). Swallows every failure of its own — a diagnostic
 * write must never break, or mask, the operation that raised the error. A thrown value already
 * recorded in this execution (by this function or through `markRecorded`) is skipped.
 */
export function recordError(op: string, err: unknown, kind = "error", now?: number): void {
  try {
    if (err !== null && typeof err === "object") {
      if (alreadyRecorded.has(err)) return;
      alreadyRecorded.add(err);
    }
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    const entry: ErrorEntry = { ts: nowIso(now), op, kind, message: truncate(message) };
    const next = [entry, ...recentErrors()].slice(0, MAX_ENTRIES);
    // Trim oldest-first until the blob fits a Script Property (always keep the just-added one).
    let blob = JSON.stringify(next);
    while (next.length > 1 && blob.length > MAX_BLOB_CHARS) {
      next.pop();
      blob = JSON.stringify(next);
    }
    setProp(KEY, blob);
  } catch {
    // Diagnostics are best-effort — never let logging an error raise one.
  }
}

/** Drop the whole recent-errors log (the Data page's "Clear log" action). */
export function clearErrors(): void {
  deleteProp(KEY);
}
