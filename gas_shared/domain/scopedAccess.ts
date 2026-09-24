// The scoped-viewer roster: who may open an app but see only their own slice of the register.
//
// ONE JSON SCRIPT PROPERTY, SHAPED FOR THE ~9KB CEILING. A Script Property value tops out around
// 9KB, so the stored form is as terse as it can be while still reading sensibly in Project
// Settings: `{"a@x.com":{"d":["Payments"],"g":["CS-core"]}}`. The one-letter keys are the
// app's scope DIMENSIONS — `d` (domain) in both apps, `g` (support group) in gas, `p`
// (project) in gas_devsecops — and each app names its own set, so this module never has to
// know what a support group or a project is.
//
// FAIL CLOSED, LIKE THE ALLOWLISTS. Unparseable JSON, a non-object, an entry without an `@` or
// an entry whose scope is empty all read as NOBODY — never as "scoped to everything". An empty
// scope is the one value that would be dangerous to read generously: every filter in both apps
// treats "no domain, no group" as the whole register.
//
// Pure: no GAS global, so both apps' unit tests exercise it directly.

/** One viewer's scope: dimension key → the values they may see (union across dimensions). */
export type Scope = Record<string, string[]>;

/** Lowercased address → scope. */
export type ScopedRoster = Record<string, Scope>;

export const SCOPED_MAX_BYTES = 8000;
export const SCOPED_MAX_ENTRIES = 200;

function cleanValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const v of raw) {
    // Values are NOT lowercased: domain and group names are compared exactly, as the scope
    // filters compare them, and "Payments" and "payments" are two different buckets there.
    const s = typeof v === "string" ? v.trim() : "";
    if (!s || seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out.sort();
}

/** A scope reduced to the app's own dimensions, deduped and sorted; `null` when empty. */
export function cleanScope(raw: unknown, dims: readonly string[]): Scope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Scope = {};
  let total = 0;
  for (const d of dims) {
    const vals = cleanValues(src[d]);
    out[d] = vals;
    total += vals.length;
  }
  return total > 0 ? out : null;
}

/** The stored property, parsed. Anything malformed reads as an empty roster. */
export function parseScoped(raw: string | null | undefined, dims: readonly string[]): ScopedRoster {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ScopedRoster = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const email = k.trim().toLowerCase();
    if (!email || email.indexOf("@") < 0) continue;
    const scope = cleanScope(v, dims);
    if (scope) out[email] = scope;
  }
  return out;
}

/** The roster as it is stored: addresses sorted, empty dimensions dropped. */
export function serializeScoped(roster: ScopedRoster): string {
  const out: Record<string, Scope> = {};
  for (const email of Object.keys(roster).sort()) {
    const s: Scope = {};
    for (const [d, vals] of Object.entries(roster[email]!)) if (vals.length) s[d] = vals;
    out[email] = s;
  }
  return JSON.stringify(out);
}

/**
 * A stable string for one scope — the cache-key parameter, and the identity used to warm each
 * distinct scope set once however many viewers share it.
 */
export function scopeKey(scope: Scope): string {
  return Object.keys(scope)
    .sort()
    .filter((d) => (scope[d] || []).length)
    .map((d) => d + "=" + (scope[d] || []).slice().sort().join("\u001f"))
    .join("\u001e");
}

/** The distinct scope sets in a roster, keyed by `scopeKey`. */
export function distinctScopes(roster: ScopedRoster): Map<string, Scope> {
  const out = new Map<string, Scope>();
  for (const scope of Object.values(roster)) {
    const k = scopeKey(scope);
    if (!out.has(k)) out.set(k, scope);
  }
  return out;
}

export interface ScopedEntryInput {
  email?: unknown;
  scope?: unknown;
}

/**
 * The editor's list, validated for storage. Throws a sentence a person can act on — the same
 * contract as the allowlists' `validateAddresses`: a silently dropped row would leave someone
 * convinced they had granted access.
 */
export function validateScoped(raw: unknown, dims: readonly string[]): ScopedRoster {
  const list = Array.isArray(raw) ? (raw as ScopedEntryInput[]) : [];
  const out: ScopedRoster = {};
  const bad: string[] = [];
  const empty: string[] = [];
  for (const item of list) {
    const email = String(item?.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (email.indexOf("@") < 0 || /[,;\s]/.test(email)) {
      bad.push(email);
      continue;
    }
    const scope = cleanScope(item?.scope, dims);
    if (!scope) {
      empty.push(email);
      continue;
    }
    // A repeated address merges rather than silently keeping the last row.
    const prev = out[email];
    out[email] = prev
      ? (cleanScope(Object.fromEntries(dims.map((d) => [d, (prev[d] || []).concat(scope[d] || [])])), dims) as Scope)
      : scope;
  }
  if (bad.length) throw new Error(`Not an email address: ${bad.join(", ")}`);
  if (empty.length) throw new Error(`Pick at least one domain or team for: ${empty.join(", ")}`);
  const n = Object.keys(out).length;
  if (n > SCOPED_MAX_ENTRIES) {
    throw new Error(`Too many scoped viewers (${n}); the limit is ${SCOPED_MAX_ENTRIES}.`);
  }
  const bytes = serializeScoped(out).length;
  if (bytes > SCOPED_MAX_BYTES) {
    throw new Error(`That list is too long to store (${bytes} of ${SCOPED_MAX_BYTES} bytes).`);
  }
  return out;
}

/** The roster as the editor draws it: one row per viewer, sorted by address. */
export function rosterRows(roster: ScopedRoster): Array<{ email: string; scope: Scope }> {
  return Object.keys(roster)
    .sort()
    .map((email) => ({ email, scope: roster[email]! }));
}
