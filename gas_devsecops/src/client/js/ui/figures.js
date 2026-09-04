// The register vocabulary's numeric core — ONE implementation of `num`, `fmtCount`, `days1`,
// `pct1`, `denomNote` and `fmtDays`, promoted out of `pages/sca.js` (which had `num`/`fmtCount`)
// and `pages/history.js` (which had the corrected shape) after they drifted into THREE
// different refusal disciplines across `pages/{sca,history,repos,data,mttr}.js`.
//
// THE DEFECT THIS FILE FIXES. `pages/sca.js`'s `num(v, fallback = 0)` called `Number(v)`
// BEFORE refusing null:
//
//   export function num(v, fallback = 0) {
//     const n = Number(v);
//     return Number.isFinite(n) ? n : fallback;
//   }
//
// `Number(null)` is `0`, and `0` is finite — so a null SCA figure never reached the fallback
// branch at all; it read as a confident, rendered `0`. `sast.js` and `secrets.js` imported
// this same `num`/`fmtCount` pair, so the defect was three pages wide, not one. CLAUDE.md's
// working discipline names the exact shape of the bug: "refuse null/undefined/blank BEFORE
// the cast, never after, and let `Number.isFinite` guard only the values that were really
// numbers." `history.js`'s `num`/`fmtCount`/`days1` and `repos.js`'s `num`/`fmtCount`/`pct1`/
// `days1` already had the right shape — refuse first, cast second, default fallback `null`
// so a caller has to ask for `0` on purpose. This file is that shape, copied once.
//
// WHY THE DEFAULT FALLBACK IS `null`, NOT `0`. A figure that flows to a rendered cell should
// let null reach `fmtCount`/`days1`/`pct1` and come out as the em dash "—" — never a zero
// nobody measured. A figure that feeds ARITHMETIC (a sum, a subtraction, a comparison) needs
// an explicit `num(v, 0)` at that one call site, so the "treat missing as zero" decision is
// visible in the diff instead of buried in a default parameter every caller inherits whether
// they meant it or not.
//
// TWO DAY FORMATTERS, ON PURPOSE. `days1` (ex-`history.js`/`sca.js`) always prints one decimal
// plus a lower-case "d" — `"41.0 d"` — and is what every register/repository page and the scan
// history chart axis use. `fmtDays` (ex-`mttr.js`) prints a word, not a unit letter, rounds to
// one decimal only below 10 days and to a whole day at or above it, and pluralises — `"3.2
// days"`, `"41 days"`, `"1 day"` — because the MTTR/SLA and Executive prose reads as a
// sentence ("closes in about 41 days") rather than a table cell. The two payloads are read by
// different eyes in different places; collapsing them to one format would either put a stray
// unit letter in a sentence or drop the pluralisation a reader expects from prose. Both stay,
// under their own names, and neither one is the other's fallback.

import { el } from "./dom.js";
import { pluralize } from "./format.js";

/**
 * A number from an untrusted payload, with a stated fallback — and NEVER a silent zero.
 *
 * `Number(null)`, `Number(undefined)`, `Number("")`, `Number([])` and `Number(false)` are all
 * `0`, and all finite — CLAUDE.md names that exact set. `history.js`'s original `num` only
 * excluded `null`/`undefined`/`""` by identity; that is enough for every value this app's own
 * payloads actually carry (a JSON `null` or a real number), but it is not enough to refuse
 * an array or a boolean before the cast, and this file's own test (`num([])`, `num(false)`)
 * pins both. So the refusal here is an ALLOWLIST rather than a blocklist: only `number` and
 * non-empty `string` are even candidates for the `Number()` cast; everything else — `null`,
 * `undefined`, `""`, `[]`, `{}`, `false`, `true` — goes straight to the fallback. Only a value
 * that WAS a real number to begin with (a bad numeric string, `NaN`, `Infinity`) ever reaches
 * `Number.isFinite` as the final guard.
 */
export function num(v, fallback = null) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** A count, grouped for reading. Null (never measured) prints as an em dash, never a `0`. */
export function fmtCount(v) {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString();
}

/**
 * A percentage, or the em dash.
 *
 * `null` IS AN ANSWER HERE and it is never 0. Every rate in the domain layer returns null
 * when its denominator is empty (`pct()` in secretsLifecycle.ts, `coveragePct` in
 * readModels.ts, `pctOfOpen` in remediation.ts), precisely so a page cannot print "0%" over
 * nothing measured. Collapsing that back to a zero here would undo the decision.
 */
export function pct1(v) {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

/** Days, or the em dash — one decimal, unit letter. See the module header for how this
 *  differs from `fmtDays` and why both exist. */
export function days1(v) {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(1)} d`;
}

/**
 * A day count as prose, or the em dash — rounded and pluralised. See the module header for
 * how this differs from `days1` and why both exist.
 */
export function fmtDays(days) {
  const n = num(days);
  if (n === null) return "—";
  const rounded = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${rounded} ${pluralize(rounded, "day")}`;
}

/**
 * The denominator node every rate on these pages carries.
 *
 * A RATE WITHOUT ITS DENOMINATOR IS NOT A MEASUREMENT — "99.6% unvalidated" and "3-day
 * median over four rows" are the two cases this register was built after. The sentence is
 * ALSO written into the attribute so a test can read what a reader reads, rather than
 * asserting that some node happens to sit nearby.
 */
export function denomNote(sentence) {
  return el("p", { class: "small muted", "data-denominator": sentence }, sentence);
}
