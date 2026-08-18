// The Priorities page as pure functions of state — filter/facet state, URL
// round-tripping, and the DISPLAY-column sort a reader can layer on top of the server's
// own rank.
//
// Split out of problems.js for the same reason comboView.js was split out of combos.js —
// the same reasoning, verbatim: this is the part that is wrong in ways a screenshot won't
// show, and it is the part testable without a DOM. problems.js turns what these return
// into elements and does nothing else clever.
//
// One thing this file deliberately does NOT do: re-derive the page's default ranking.
// `src/domain/problems.ts`'s `compareProblems` — outcome, then posture tier, then SLA
// urgency, then the amplification vector, then id — is the one true order, computed
// server-side in `getProblems` and shipped already sorted. The client bundle cannot
// import that TS module (the same wall `comboView.js`'s own header names for
// `DUE_SOON_DAYS` and `CONDITION_KEYS`), so rather than hand-copy a five-level cascade
// here and risk the two silently disagreeing, this file offers only INDEPENDENT
// single-column sorts — the same relationship `pages/comboView.js`'s `ISSUE_COMPARATORS`
// has to the toxic-combination ranking `rankGroups` already applied. "No sort selected"
// means "trust the order the server sent."

export const OUTCOME_RANK = ["ACT", "ATTEND", "TRACK_STAR", "TRACK"];
export const KIND_VALUES = ["ISSUE", "FINDING"];
export const SEVERITY_RANK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/**
 * The page's two register modes — collapsed-to-actions (P1b) or the original one-row-per-
 * problem table. "actions" is the DEFAULT: the self-evidencing "N problems collapse to M
 * actions" headline is the thing worth opening on, the same reason `config.js` opens on
 * BY CONTROL rather than BY FINDING. Because it is the default, it serializes to `null` in
 * `problemParamPatch` below — exactly how `config.js:113` keeps ITS default mode out of the
 * URL — so the common case never grows a `?mode=actions` nobody chose. An unknown or absent
 * value reads as "actions", never as an error.
 */
export const MODE_VALUES = ["actions", "problems"];

/** Rows fetched, filtered and sorted entirely client-side under this ceiling — mirrors the
 *  server's own `PROBLEMS_CLIENT_ALL_MAX` (src/domain/problems.ts). Past it `getProblems`
 *  pages server-side and this page forwards the outcome filter and the page number to it. */
export const PAGE_SIZE = 25;

// ------------------------------------------------------------------------ URL state

/** Read the hash params into view state, dropping anything this page doesn't offer. */
export function readProblemParams(params) {
  const p = params || {};
  const outcome = String(p.outcome || "").toUpperCase();
  const kind = String(p.kind || "").toUpperCase();
  const mode = String(p.mode || "").toLowerCase();
  const page = Number(p.page);
  return {
    mode: MODE_VALUES.indexOf(mode) >= 0 ? mode : "actions",
    outcome: OUTCOME_RANK.indexOf(outcome) >= 0 ? outcome : "",
    kind: KIND_VALUES.indexOf(kind) >= 0 ? kind : "",
    q: p.q || "",
    sort: PROBLEM_COMPARATORS[p.sort] ? p.sort : "",
    dir: String(p.dir) === "-1" ? -1 : 1,
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0,
  };
}

/**
 * The inverse, shaped for setParams. Every key is present — buildHash drops the empty
 * ones — so clearing a filter actually removes it from the URL instead of leaving a
 * stale value behind. Mirrors `comboParamPatch` in comboView.js.
 */
export function problemParamPatch(state) {
  const s = state || {};
  return {
    // Same "the default is null" rule config.js:113 states for its own mode param — the
    // whole reason problems mode carries a URL param at all is so an "actions" reader's
    // link never grows one.
    mode: s.mode && s.mode !== "actions" ? s.mode : "",
    outcome: s.outcome || "",
    kind: s.kind || "",
    q: s.q || "",
    sort: s.sort || "",
    dir: s.sort && s.dir === -1 ? "-1" : "",
    page: s.page ? String(s.page + 1) : "",
  };
}

// -------------------------------------------------------------------------- filtering

/**
 * Row-level filters, applied to whatever rows the page currently holds. When the server
 * answered `all: true` this runs over the whole ranked union; past `PROBLEMS_CLIENT_ALL_MAX`
 * the outcome half is already applied server-side (so this is a no-op re-check on that
 * axis) and `kind`/`q` narrow only the current page — the same degrade
 * `getConfigFindings`'s paged path accepts for its own client-only affordances.
 */
export function applyProblemFilters(rows, state) {
  const s = state || {};
  const q = String(s.q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (s.outcome && String(r.problemOutcome || "").toUpperCase() !== s.outcome) return false;
    if (s.kind && r.kind !== s.kind) return false;
    if (q) {
      const hay = [r.title, r.assetName].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/** The outcome and kind values actually present, for the filter pills — worst-outcome-first. */
export function problemFilterOptions(rows) {
  const outcomes = new Set();
  const kinds = new Set();
  for (const r of rows || []) {
    if (r.problemOutcome) outcomes.add(String(r.problemOutcome).toUpperCase());
    if (r.kind) kinds.add(r.kind);
  }
  return {
    outcomes: OUTCOME_RANK.filter((o) => outcomes.has(o)),
    kinds: KIND_VALUES.filter((k) => kinds.has(k)),
  };
}

// -------------------------------------------------------------------------- sorting

/** Position on the outcome scale, worst first; undecided (`""`) sorts last — mirrors
 *  `configView.js`'s `priorityRank` and `src/domain/problems.ts`'s `outcomeRank`. */
function outcomeIndex(o) {
  const i = OUTCOME_RANK.indexOf(String(o || "").toUpperCase());
  return i < 0 ? OUTCOME_RANK.length : i;
}

/** Worse tier (4) first, unscored (`null`) last — mirrors the domain layer's `postureRank`. */
function postureIndex(t) {
  return t === null || t === undefined ? 0 : Number(t);
}

function sevIndex(sev) {
  const i = SEVERITY_RANK.indexOf(String(sev || "").toUpperCase());
  return i < 0 ? SEVERITY_RANK.length : i;
}

/**
 * Deadline as a sortable number; a row with no readable date sorts last either way.
 * `Number.MAX_SAFE_INTEGER`, not `Infinity` — two rows that both lack a deadline must
 * subtract to `0`, or the comparator returns `NaN` and the sort silently stops moving that
 * pair. See `src/domain/problems.ts`'s `slaRank` for the same fix and the fuller reasoning.
 */
function dueRank(row) {
  const t = Date.parse((row && row.dueAt) || "");
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * Each comparator is the column's natural FIRST-click order — worst first for the risk
 * columns, A-first for the identity columns. `dir` flips it. Mirrors the shape
 * `comboView.js`'s `ISSUE_COMPARATORS` and `assetTable.ts`'s comparators both use.
 */
export const PROBLEM_COMPARATORS = {
  asset: (a, b) => String(a.assetName || "").localeCompare(String(b.assetName || "")),
  title: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
  kind: (a, b) => String(a.kind || "").localeCompare(String(b.kind || "")),
  priority: (a, b) => outcomeIndex(a.problemOutcome) - outcomeIndex(b.problemOutcome),
  posture: (a, b) => postureIndex(b.postureTier) - postureIndex(a.postureTier),
  severity: (a, b) => sevIndex(a.severity) - sevIndex(b.severity),
  due: (a, b) => dueRank(a) - dueRank(b),
};

/** Columns whose natural order reads as descending — for aria-sort and the glyph. */
export const PROBLEM_SORT_DESC = { priority: true, posture: true, severity: true };

export function sortProblems(rows, key, dir) {
  const cmp = PROBLEM_COMPARATORS[key];
  const list = (rows || []).slice();
  if (!cmp) return list;
  const sign = dir === -1 ? -1 : 1;
  return list.sort((a, b) => {
    const d = cmp(a, b) * sign;
    if (d !== 0) return d;
    // A stable tiebreak, so a re-sort of equal rows never reshuffles them under the eye —
    // same idiom `sortIssues` (comboView.js) closes with.
    return String(a.assetName || "").localeCompare(String(b.assetName || ""))
      || String(a.id || "").localeCompare(String(b.id || ""));
  });
}
