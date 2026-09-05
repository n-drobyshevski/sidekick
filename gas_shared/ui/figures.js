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
// `boundedDays` LIVES HERE FOR THE SAME REASON THE REST OF THIS FILE DOES. It was defined
// twice — `pages/repos.js` and `pages/sca.js` — in two shapes, and the two spellings of a
// lower bound are exactly the drift this module exists to end. It is a figure formatter:
// it turns a number and a flag into the string a cell shows.
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
 * The em dash these formatters print, AS A STRING — the one spelling, exported.
 *
 * There are now two ways to say "we were never told" and they are not interchangeable:
 * `absent()` (ui/cells.js) is a MUTED NODE, and it is the right answer everywhere a DOM node
 * can go, because the grey is what stops an absence reading in the same ink as a measured
 * value. This is the other case — a canvas tooltip, a chart axis tick, an `aria-label`
 * fragment, a `textContent` assignment, a Map key — where a node renders as
 * `[object HTMLSpanElement]` or breaks the key. `gas/src/client/js/charts.js`'s
 * `fmtDuration` and `TIER_GLYPHS.none` are the canvas half; `pages/mttr.js`'s
 * `fmtKmMedian` is the sentence half, and it already keeps a Node twin beside it.
 *
 * Exported so those call sites stop spelling a bare "—" of their own: the character is
 * written six ways across these three apps, and a hyphen or an en dash slipping into one of
 * them is invisible in review and obvious on screen.
 *
 * The formatters below keep returning THIS rather than a node, deliberately — a formatter
 * that returned DOM could not be interpolated into a sentence. `dataTable` is where the two
 * meet: it promotes exactly this string to `absent()` when a cell returns it, so a table
 * gets the muted dash without every column having to ask (see ui/data.js).
 */
export const absentText = "—";

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
  return n === null ? absentText : n.toLocaleString();
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
  return n === null ? absentText : `${n.toFixed(1)}%`;
}

/** Days, or the em dash — one decimal, unit letter. See the module header for how this
 *  differs from `fmtDays` and why both exist. */
export function days1(v) {
  const n = num(v);
  return n === null ? absentText : `${n.toFixed(1)} d`;
}

/**
 * A duration that may only be a LOWER BOUND, and the flag that says which it is.
 *
 * PRODUCT.md's sixth principle: "where the curve never reaches half, the page publishes a
 * lower bound rather than a number". A bound and a median are different claims, so the
 * string carries the difference and `bounded` carries it again for anything that styles or
 * captions off it — never off the string.
 *
 * "≥", NOT ">". README.md, above the Pages table, fixes one notation per context: prose
 * says "at least N" (`mttr.js`'s `kmHalfLifeView`) and a numeric cell or tile says "≥ N"
 * (`mttr.js`'s `rmstView`, and here). The bound is INCLUSIVE — the median is at least this
 * far out — and ">" claims it is strictly beyond, which is a different and weaker fact.
 *
 * ONE IMPLEMENTATION, promoted from `pages/repos.js` and `pages/sca.js`, which each had
 * their own. The repos copy refused before casting and the sca copy cast first, so
 * `boundedDays("", [])` disagreed between two pages showing the same kind of figure; this
 * is the repos shape, the one `ui/figures.js` was written to hold (see the module header).
 */
export function boundedDays(value, lowerBound) {
  const median = num(value);
  if (median !== null) return { text: days1(median), bounded: false };
  const bound = num(lowerBound);
  if (bound !== null) return { text: `≥ ${days1(bound)}`, bounded: true };
  return { text: absentText, bounded: false };
}

/**
 * A day count as prose, or the em dash — rounded and pluralised. See the module header for
 * how this differs from `days1` and why both exist.
 */
export function fmtDays(days) {
  const n = num(days);
  if (n === null) return absentText;
  const rounded = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${rounded} ${pluralize(rounded, "day")}`;
}

/**
 * "3 hours ago" / "2 days ago" / "just now" — the one clock-relative label across the three
 * apps, promoted from a private helper `pages/history.js` (gas) had for its Scan History
 * freshness line and a second, coarser inline calculation (days only, gated at `age >= 2`) in
 * both siblings' rail captions — three shapes of the same sentence, one of them silently
 * dropping the "N hours ago" / "N min ago" granularity gas's own history page already had.
 *
 * REFUSED BEFORE THE CAST, the same allowlist `num()` above uses and for the reason CLAUDE.md
 * names directly: `Date.parse(null)` and `Date.parse(undefined)` are `NaN` (safe), but
 * `Date.parse()` given an already-numeric epoch needed a stated answer, not a bare cast run
 * without checking what arrived first. Only a real `number` (already epoch ms) or a
 * non-empty `string` (parsed by `Date.parse`) are even candidates; `null`, `undefined`, `""`,
 * and anything else typed here — an object, an array, `false` — fall straight to `absentText`,
 * matching every other formatter in this file. Returned AS A STRING, not a node: every call
 * site interpolates this into a sentence (`` `Last sync ${fmtDateTime(ts)} · ${relativeAge(ts)}`
 * ``), the same reason `days1`/`pct1`/`fmtCount` return `absentText` rather than `absent()`.
 *
 * A NON-EMPTY STRING THAT DOES NOT PARSE reads the same way: `Date.parse` returning `NaN` is
 * "we cannot say", not "zero elapsed" — the exact substitution CLAUDE.md's working discipline
 * warns about — so it takes the same `absentText` branch as never having been told at all,
 * rather than surfacing as "NaN days ago".
 *
 * A FUTURE TIMESTAMP reads as "just now", never as a negative age. Every call site measures a
 * "last sync/scan" clock reading against the READER'S OWN `Date.now()`; the only realistic way
 * that clock sits behind a timestamp the server just wrote is skew between the two clocks, not
 * an event that has not happened yet. There is no more informative way to say "the two clocks
 * do not quite agree" than to call the event current, so `ms <= 0` collapses into the same
 * "just now" branch a few seconds of ordinary lag already reaches, rather than growing a
 * second, more alarming word for the same non-event.
 */
export function relativeAge(ts) {
  let t;
  if (typeof ts === "number") t = ts;
  else if (typeof ts === "string" && ts !== "") t = Date.parse(ts);
  else return absentText;
  if (!Number.isFinite(t)) return absentText;
  const ms = Date.now() - t;
  if (ms <= 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const d = Math.floor(hr / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
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
