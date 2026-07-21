// Shared value/time helpers used across the domain port. The Python side leans on
// pandas NaN/NaT semantics; here "missing" is null/undefined/NaN/blank-string, gated
// through present()/clean() exactly like lifecycle._present / reconcile._clean.

export type Rec = Record<string, unknown>;

/** True when a value is a real, non-empty scalar (null/undefined/NaN/'' are missing). */
export function present(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "number" && Number.isNaN(v)) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

/** null for missing scalars, else the value unchanged (reconcile._clean). */
export function clean<T>(v: T): T | null {
  return present(v) ? v : null;
}

/** Python str() semantics for the scalars that reach string fields (True/False). */
export function pyStr(v: unknown): string {
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/**
 * Parse an ISO timestamp ("Z" or offset; date-only allowed) to epoch milliseconds,
 * or null. Naive timestamps are treated as UTC, matching reconcile._parse.
 */
export function parseTs(v: unknown): number | null {
  const c = clean(v);
  if (c === null) return null;
  if (c instanceof Date) return isNaN(c.getTime()) ? null : c.getTime();
  if (typeof c === "number" && Number.isFinite(c)) return c;
  let s = String(c).trim();
  if (!s) return null;
  // Normalize "YYYY-MM-DD HH:MM:SS" to ISO T-separated.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T");
  // Date.parse treats a bare "YYYY-MM-DDTHH:MM:SS" as LOCAL time; Python treats it as
  // naive → UTC. Append Z when no timezone is present so both agree.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Canonical UTC ISO ("...Z", second precision) — the port of reconcile._iso. */
export function toIso(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** Earliest of the given timestamps as canonical ISO (null if none parse). */
export function minIso(...values: unknown[]): string | null {
  const parsed = values.map(parseTs).filter((t): t is number => t !== null);
  return parsed.length ? toIso(minNum(parsed)) : null;
}

/** Canonical ISO halfway between two timestamps (falls back to whichever parses). */
export function midpointIso(a: unknown, b: unknown): string | null {
  const da = parseTs(a);
  const db = parseTs(b);
  if (da === null || db === null) return toIso(db) ?? toIso(da);
  return toIso(da + (db - da) / 2);
}

/** Current instant as canonical ISO (ledger._now_iso). */
export function nowIso(now?: number): string {
  return toIso(now ?? Date.now())!;
}

/** Arithmetic mean, or null for an empty list. */
export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Max of a numeric list WITHOUT spreading it into function arguments. `Math.max(...arr)`
 * turns every element into a call argument, so it overflows the stack ("Maximum call stack
 * size exceeded") once `arr` is large — fatal on findings-scale inputs like a Kaplan–Meier
 * risk set or the per-finding first-seen times. This reduces with the two-argument Math.max,
 * so it's O(n) with constant stack depth and NaN propagates exactly as the spread form did.
 * Returns -Infinity for an empty list (callers guard `.length` first, as with the spreads).
 */
export function maxNum(values: number[]): number {
  return values.reduce((m, v) => Math.max(m, v), -Infinity);
}

/** Min counterpart of maxNum — see its note on why this avoids `Math.min(...arr)`. */
export function minNum(values: number[]): number {
  return values.reduce((m, v) => Math.min(m, v), Infinity);
}

/**
 * Linear-interpolation quantile, matching pandas Series.quantile / .median exactly
 * (numpy "linear" method): index = q * (n - 1), interpolate between neighbors.
 */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}
