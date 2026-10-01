// A bounded ring buffer of recent server-side errors, persisted in Script Properties so a
// failure survives the request that produced it and is viewable in-app instead of only in the
// Apps Script execution log — which the operator can't reach from the deployed web app.
//
// ONE IMPLEMENTATION, TWO REGISTERS. gas/ and gas_devsecops/ each carried a copy of this file,
// the second ported from the first and then given `markRecorded`; the copies had drifted to
// "near-identical", which is the state in which a fix lands in one and not the other. Each
// app's `src/server/errorLog.ts` is now a thin module that binds its own Script Properties
// accessors into `createErrorLog` and re-exports the same API, so no call site changed. The
// contract both apps register is `gas_shared/test/contracts/errorLog.js`.
//
// PROPERTY ACCESS IS INJECTED rather than imported, the way `inlineBoot.ts` takes the app's
// bootstrap: nothing under gas_shared/ reaches into an app's `props.ts`.
//
// Best-effort by design: recording never throws (it must not mask the error it is logging)
// and is not lock-guarded (a lost entry under a rare concurrent write is acceptable for a
// diagnostic log; the ledger lock is far too heavy for an error path). One Script Property
// holds the whole JSON array, so the entry count and message length are capped to stay well
// under the 9 KB per-value quota.
//
// RECORDED ONCE PER THROWN VALUE. A job hop that fails writes its job row and then RETHROWS,
// so the same Error object goes on to reach the RPC wrapper (`api.run()`, when the first hop
// runs inside the "Run" RPC) or the continuation trigger's catch. Each of those records what
// reaches it, so without a way to say "this one already has a home" one failure would be
// listed twice. `recordError` remembers every object it records, and `markRecorded` lets a
// caller whose failure has a durable record elsewhere (gas_devsecops lists failed job rows
// beside this log) say so without adding an entry.

const KEY = "RECENT_ERRORS";
const MAX_ENTRIES = 25;
const MAX_MESSAGE_LEN = 500;
// Script Properties cap a single value at ~9 KB. 25 long messages can exceed that, so the
// serialized blob is trimmed (oldest first) to stay under this ceiling — otherwise setProperty
// throws and recordError silently drops the write, defeating the whole log. MEASURED IN UTF-8
// BYTES, the unit the quota counts, not in string length: a localized exception message
// (Cyrillic is two bytes a character) fit a character ceiling at nearly twice the quota.
const MAX_BLOB_BYTES = 8500;

/** The Script Properties accessors an app binds in (its own `props.ts`). */
export interface ErrorLogProps {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface ErrorEntry {
  ts: string; // ISO-Z of when it was recorded
  op: string; // operation label, e.g. "scan", "cacheWarm", "api"
  kind: string; // "error", or "warning" for a condition that is not a fault (shown as such)
  message: string; // the error message, truncated
}

export interface ErrorLog {
  /** The recorded errors, newest first. Tolerates a missing / malformed blob (returns []). */
  recentErrors(): ErrorEntry[];
  /**
   * Record one error (newest first, capped at MAX_ENTRIES). `err` may be any thrown value; its
   * `.message` is preferred over String(err). Swallows every failure of its own — a diagnostic
   * write must never break, or mask, the operation that raised the error. A thrown value
   * already recorded in this execution (by this function or through `markRecorded`) is skipped.
   */
  recordError(op: string, err: unknown, kind?: string, now?: number): void;
  /**
   * Say that `err`'s failure already has a durable record elsewhere, so a caller further up
   * that catches the same thrown value does not add it to this log as well. Never throws.
   */
  markRecorded(err: unknown): void;
  /** Drop the whole recent-errors log (the in-app "Clear" action). */
  clearErrors(): void;
}

/**
 * The UTF-8 encoded length of `s`, without encoding it. A surrogate pair is one four-byte code
 * point; a lone surrogate counts as the three-byte replacement character it is written as.
 */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) + "…" : s;
}

/** Whole-second ISO-Z, the stamp both registers' `nowIso` writes. */
function isoSeconds(now?: number): string {
  const ms = now ?? Date.now();
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** The error log over one app's Script Properties. */
export function createErrorLog(props: ErrorLogProps): ErrorLog {
  // Thrown values whose failure is already recorded, for the life of this execution only
  // (module state does not outlive an Apps Script execution). A WeakSet, so it pins nothing; a
  // primitive throw cannot be held and is simply never deduplicated.
  const alreadyRecorded = new WeakSet<object>();

  function recentErrors(): ErrorEntry[] {
    const raw = props.get(KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e): e is Record<string, unknown> =>
            Boolean(e) && typeof e === "object" && !Array.isArray(e),
        )
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

  function markRecorded(err: unknown): void {
    try {
      if (err !== null && typeof err === "object") alreadyRecorded.add(err);
    } catch {
      // best-effort, like everything else here
    }
  }

  function recordError(op: string, err: unknown, kind = "error", now?: number): void {
    try {
      if (err !== null && typeof err === "object") {
        if (alreadyRecorded.has(err)) return;
        alreadyRecorded.add(err);
      }
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
      const entry: ErrorEntry = { ts: isoSeconds(now), op, kind, message: truncate(message) };
      const next = [entry, ...recentErrors()].slice(0, MAX_ENTRIES);
      // Trim oldest-first until the blob fits a Script Property (always keep the just-added one).
      let blob = JSON.stringify(next);
      while (next.length > 1 && utf8ByteLength(blob) > MAX_BLOB_BYTES) {
        next.pop();
        blob = JSON.stringify(next);
      }
      props.set(KEY, blob);
    } catch {
      // Diagnostics are best-effort — never let logging an error raise one.
    }
  }

  function clearErrors(): void {
    props.delete(KEY);
  }

  return { recentErrors, recordError, markRecorded, clearErrors };
}
