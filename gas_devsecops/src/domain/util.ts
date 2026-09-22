// Shared value/time helpers used across the domain port. The Python side leans on
// pandas NaN/NaT semantics; here "missing" is null/undefined/NaN/blank-string, gated
// through present()/clean() exactly like lifecycle._present / reconcile._clean.
//
// Two populations live here and it matters which is which:
//
//   PARITY — present, clean, pyStr, parseTs, toIso, minIso, midpointIso, nowIso, mean,
//   quantile, median. These mirror named functions in wiz_dashboard/domain/, and several
//   have no caller in this tree. They are carried so the port stays complete and legible
//   against its Python twin; do not delete them for being unused, and do not change their
//   behaviour without changing the Python side.
//
//   LOCAL — everything under "collection and value helpers" below. These have no Python
//   twin and exist because the domain layer was re-deriving them: the same comparator
//   ternary written out six times, the same index-building expression eight times, the
//   same clamp under three different names.

export type Rec = Record<string, unknown>;

// ------------------------------------------------- collection and value helpers (LOCAL)

/** "" for missing, else String(v). The miss value is the whole point — pick one. */
export function toStr(v: unknown, fallback = ""): string {
  return v === null || v === undefined ? fallback : String(v);
}

/** `fallback` for anything that isn't a finite number. */
export function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Round, then clamp into [min, max], falling back for anything unparseable.
 *
 * clampDepth and clampMaxNodes in settingsLogic.ts were literal instances of this, and
 * aarsRule.ts had it under this name — three names for one function.
 */
export function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Three-way compare for sortables — the `a < b ? -1 : a > b ? 1 : 0` written once. */
export function cmp<T>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compare two values by a derived key. Chain with `||` for tie-breaks. */
export function cmpBy<T, K>(key: (v: T) => K): (a: T, b: T) => number {
  return (a, b) => cmp(key(a), key(b));
}

/** `new Map(xs.map(x => [key(x), x]))`, which the layer wrote out eight times. */
export function indexBy<T, K>(xs: readonly T[], key: (v: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const x of xs) out.set(key(x), x);
  return out;
}

/** Append to a map of arrays, creating the bucket on first use. */
export function pushInto<K, V>(map: Map<K, V[]>, key: K, ...values: V[]): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(...values);
  else map.set(key, [...values]);
}

/** Group by a derived key, preserving input order within each bucket. */
export function groupBy<T, K>(xs: readonly T[], key: (v: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of xs) pushInto(out, key(x), x);
  return out;
}

/** Increment a counter in a Map — `counts.set(k, (counts.get(k) ?? 0) + 1)`. */
export function tally<K>(counts: Map<K, number>, key: K, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

// ------------------------------------------------------------ Python-port helpers (PARITY)

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

/**
 * Earliest of the given timestamps as canonical ISO (null if none parse).
 *
 * Folded rather than `Math.min(...parsed)`: spreading a large array into a call blows the
 * argument limit and throws RangeError. The sibling OS-vulns tool hit this at scale and
 * removed the spread from its copy of this file; this one still carried it.
 */
export function minIso(...values: unknown[]): string | null {
  let min: number | null = null;
  for (const v of values) {
    const t = parseTs(v);
    if (t !== null && (min === null || t < min)) min = t;
  }
  return min === null ? null : toIso(min);
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

const ENTRY_DAY_MS = 86_400_000;

/**
 * Delayed-entry offset, in days: how old a row already was, ON ITS OWN CLOCK, the day tracking
 * for it started — `max(0, trackingStart - origin) / DAY_MS`, or 0 when either timestamp is
 * missing or unparseable (remediation.ts's RemediationRow.entry_days carries the same
 * absent/null/<=0-means-0 rule; this is the formula that rule is computed BY).
 *
 * ONE FORMULA, THREE ORIGINS. Every clock this register measures needs this same delayed-entry
 * correction, but each measures a different origin: `ledgerCore.ts`'s `withDerived` calls it
 * with `origin = first_seen` for the DETECTION clock (which `remediation.ts`'s `latencyView`
 * also rides on, since its own `t` is first_seen-relative too — see that function's comment);
 * `remediation.ts`'s `actionableView` calls it with `origin = actionable_from` for the
 * ACTIONABLE clock; `secretsLifecycle.ts`'s `timeToRevoke` calls it with `origin = first_seen`
 * again, because that register's own clock starts there too. Keeping the arithmetic in exactly
 * one place means a future fourth clock gets this rule by calling it, not by copying it.
 */
export function entryDaysFrom(trackingStart: unknown, origin: unknown): number {
  const t = parseTs(trackingStart);
  const o = parseTs(origin);
  if (t === null || o === null) return 0;
  return Math.max(0, (t - o) / ENTRY_DAY_MS);
}

/** Arithmetic mean, or null for an empty list. */
export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
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

/**
 * Max of a numeric list WITHOUT spreading it into function arguments. `Math.max(...arr)`
 * turns every element into a call argument, so it overflows the stack ("Maximum call stack
 * size exceeded") once `arr` is large — fatal on findings-scale inputs. This reduces with the
 * two-argument Math.max, so it's O(n) with constant stack depth and NaN propagates exactly as
 * the spread form did. Returns -Infinity for an empty list (callers guard `.length` first, as
 * with the spreads). Ported from gas/src/domain/util.ts; see that file's note and
 * test/util.test.ts for the measured argument-limit ceiling.
 */
export function maxNum(values: number[]): number {
  return values.reduce((m, v) => Math.max(m, v), -Infinity);
}

/** Min counterpart of maxNum — see its note on why this avoids `Math.min(...arr)`. */
export function minNum(values: number[]): number {
  return values.reduce((m, v) => Math.min(m, v), Infinity);
}

/**
 * Count of elements strictly less than `value` in a SORTED ASCENDING array, by binary search
 * (bisect-left). `remediation.ts`'s delayed-entry Kaplan–Meier sweep is built on this: the risk
 * set at an event time t is `#{entry < t} - #{exit < t}`, and doing that as a linear `.filter()`
 * per distinct event time is the O(n * events) scan the register-scale (50k row) requirement
 * rules out. Binary search makes each query O(log n), so a curve with m distinct event times
 * costs O(m log n) atop the O(n log n) sort — no different in order from the sort itself.
 */
export function countBelow(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Append every item of `items` onto `target` in place, WITHOUT spreading into arguments.
 * `target.push(...items)` makes each item a call argument, so it overflows the call stack
 * once `items` is large — the same failure class as `Math.max(...arr)` (see maxNum). Accepts
 * any iterable (arrays and Map value iterators alike).
 */
export function pushAll<T>(target: T[], items: Iterable<T>): void {
  for (const item of items) target.push(item);
}

/**
 * First present value among dotted keys, tolerating a nested `vulnerableAsset` dict. Accepts
 * both flattened "vulnerableAsset.name" keys and the raw nested node shape. Returns "" when
 * nothing matches. Literal port of gas/src/domain/lifecycle.ts's field() — including the
 * hardcoded `vulnerableAsset` unwrap, unchanged, because SCA reads the same
 * `vulnerabilityFindings` connection the OS-vuln register does (brick/config.py's
 * `sca` scope) and so its nodes carry `vulnerableAsset` exactly like gas/'s do. Moved here
 * from lifecycle.ts because it is a general value-access helper, not lifecycle logic — this
 * mirrors the D1 brief's "Add ... field" instruction for util.ts.
 */
export function field(record: Rec, ...keys: string[]): string {
  for (const k of keys) {
    const v = record[k];
    if (present(v)) return pyStr(v);
  }
  const va = record["vulnerableAsset"];
  if (va && typeof va === "object" && !Array.isArray(va)) {
    for (const k of keys) {
      const leaf = k.split(".").pop()!;
      const v = (va as Rec)[leaf];
      if (present(v)) return pyStr(v);
    }
  }
  return "";
}
