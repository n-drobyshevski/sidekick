// A bounded ring buffer of recent server-side errors, persisted in Script Properties so a
// failure survives the request that produced it and is viewable in-app (Settings →
// Diagnostics) instead of only in the Apps Script execution log — which the operator can't
// reach from the deployed web app. The motivating case is a *silent* background failure
// (the post-scan support-group refresh only console.warn'd), which now leaves a durable trace.
//
// Best-effort by design: recording never throws (it must not mask the error it is logging)
// and is not lock-guarded (a lost entry under a rare concurrent write is acceptable for a
// diagnostic log; the ledger lock is far too heavy for an error path). One Script Property
// holds the whole JSON array, so the entry count and message length are capped to stay well
// under the 9 KB per-value quota.

import { nowIso, type Rec } from "../domain/util";
import { getProp, setProp, deleteProp } from "./props";

const KEY = "RECENT_ERRORS";
const MAX_ENTRIES = 25;
const MAX_MESSAGE_LEN = 500;
// Script Properties cap a single value at ~9 KB. 25 long messages can exceed that, so the
// serialized blob is trimmed (oldest first) to stay under this ceiling — otherwise setProperty
// throws and recordError silently drops the write, defeating the whole log.
const MAX_BLOB_CHARS = 8500;

export interface ErrorEntry {
  ts: string; // ISO-Z of when it was recorded
  op: string; // operation label, e.g. "supportGroupRefresh", "scan", "api"
  kind: string; // error kind, e.g. "error", "sealed", "rebuild"
  message: string; // the error message, truncated
}

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
 * Record one error (newest first, capped at MAX_ENTRIES). `err` may be any thrown value; its
 * `.message` is preferred over String(err). Swallows every failure of its own — a diagnostic
 * write must never break, or mask, the operation that raised the error.
 */
export function recordError(op: string, err: unknown, kind = "error", now?: number): void {
  try {
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

/** Drop the whole recent-errors log (the Diagnostics "Clear" action). */
export function clearErrors(): void {
  deleteProp(KEY);
}
