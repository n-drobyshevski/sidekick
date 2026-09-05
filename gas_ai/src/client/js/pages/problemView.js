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
// `src/domain/problems.ts`'s `compareProblems` — severity, then SLA urgency, then age,
// then id — is the one true order, computed
// server-side in `getProblems` and shipped already sorted. The client bundle cannot
// import that TS module (the same wall `comboView.js`'s own header names for
// `DUE_SOON_DAYS` and `CONDITION_KEYS`), so rather than hand-copy a five-level cascade
// here and risk the two silently disagreeing, this file offers only INDEPENDENT
// single-column sorts — the same relationship `pages/comboView.js`'s `ISSUE_COMPARATORS`
// has to the toxic-combination ranking `rankGroups` already applied. "No sort selected"
// means "trust the order the server sent."

import { dueRank } from "../ui/format.js";

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
 *  pages server-side and this page forwards the severity filter and the page number to it. */
export const PAGE_SIZE = 25;

// ------------------------------------------------------------------------ URL state

/** Read the hash params into view state, dropping anything this page doesn't offer. */
export function readProblemParams(params) {
  const p = params || {};
  const severity = String(p.severity || "").toUpperCase();
  const kind = String(p.kind || "").toUpperCase();
  const mode = String(p.mode || "").toLowerCase();
  const page = Number(p.page);
  return {
    mode: MODE_VALUES.indexOf(mode) >= 0 ? mode : "actions",
    severity: SEVERITY_RANK.indexOf(severity) >= 0 ? severity : "",
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
    severity: s.severity || "",
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
 * the severity half is already applied server-side (so this is a no-op re-check on that
 * axis) and `kind`/`q` narrow only the current page — the same degrade
 * `getConfigFindings`'s paged path accepts for its own client-only affordances.
 */
export function applyProblemFilters(rows, state) {
  const s = state || {};
  const q = String(s.q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (s.severity && String(r.severity || "").toUpperCase() !== s.severity) return false;
    if (s.kind && r.kind !== s.kind) return false;
    if (q) {
      const hay = [r.title, r.assetName].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/** The severity and kind values actually present, for the filter pills — worst-first. */
export function problemFilterOptions(rows) {
  const severities = new Set();
  const kinds = new Set();
  for (const r of rows || []) {
    if (r.severity) severities.add(String(r.severity).toUpperCase());
    if (r.kind) kinds.add(r.kind);
  }
  return {
    severities: SEVERITY_RANK.filter((sv) => severities.has(sv)),
    kinds: KIND_VALUES.filter((k) => kinds.has(k)),
  };
}

// -------------------------------------------------------------------------- sorting

function sevIndex(sev) {
  const i = SEVERITY_RANK.indexOf(String(sev || "").toUpperCase());
  return i < 0 ? SEVERITY_RANK.length : i;
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
  severity: (a, b) => sevIndex(a.severity) - sevIndex(b.severity),
  due: (a, b) => dueRank(a) - dueRank(b),
  // The minimal model's order. The number is computed SERVER-SIDE and arrives on the row —
  // this only reads it, which is the distinction actionView.js's header insists on. An
  // unscored row sorts last rather than as zero.
  //
  // THE COLUMN IS SURFACED NOW, and this comment used to say it was not — "not surfaced
  // while the scoring models sit behind the experimental gate". That reasoning was about
  // the three DERIVED VERDICTS (the AARS band, the posture tier, the ACT/ATTEND outcome),
  // which measured a whole landscape into one band and are confined to the workbench by
  // test/verdictIsolation.test.ts. The rank is not one of them: it is an order over one
  // queue, computed from the operator's own judgement table and a clock, and it ships with
  // the clauses that produced it (`rankReasons`) so the number can be interrogated rather
  // than taken. Whether it LEADS the register's order is a separate question, and its
  // answer is the `rank_leads_sort` setting, off by default.
  rank: (a, b) => rankValue(b) - rankValue(a),
  firstSeen: (a, b) => {
    const x = String((a && a.firstSeenAt) || "");
    const y = String((b && b.firstSeenAt) || "");
    if (x === y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : 1;
  },
};

/** `-1` for a row the server never scored, so it lands after every scored one either way. */
function rankValue(row) {
  const v = row && typeof row.rankScore === "number" ? row.rankScore : -1;
  return v;
}

/** Columns whose natural order reads as descending — for aria-sort and the glyph. */
/**
 * Columns whose natural order reads as descending — for aria-sort and the glyph.
 *
 * `rank` is here for the reason `severity` is: a higher score is a WORSE row, so the first
 * click has to show the worst first. `due` and `firstSeen` stay out — both open at the near
 * end (soonest, oldest), which is already ascending.
 */
export const PROBLEM_SORT_DESC = { severity: true, rank: true };

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

// ----------------------------------------------------------------------- the rank cell

/** The disclosure's label, in one place: the page draws it and the test asserts it. */
export const RANK_REASON_LABEL = "Why this rank";

/**
 * The rank cell as data — the number, and whether the clock behind it was measured.
 *
 * TWO DP RATHER THAN THE RAW FLOAT. The score is a blend of four 0..1 readings and lands on
 * long tails (`0.6000000000000001` is an ordinary value of it); printing that would offer a
 * precision the model does not have and make two equal rows look different. Two places is
 * more than the ladders can distinguish and enough to read an order by.
 *
 * `untimed` is NOT a formatting flag. `rankTimed === false` means the clock term was
 * UNMEASURED and dropped from both halves of the blend, so the score beside it was computed
 * from fewer terms than the rule asked for — a different claim about a similar-looking
 * number, which is exactly the pair a surface has to keep apart. It carries a WORD (`note`),
 * never a tint or a glyph alone: severity and status never carry meaning by colour alone
 * here, and neither does this.
 *
 * A row the server never scored reads `—` rather than `0.00`: an unscored row has not scored
 * zero, and the comparator already sorts it last for the same reason.
 */
export function rankCellModel(row) {
  const r = row || {};
  const scored = typeof r.rankScore === "number" && isFinite(r.rankScore);
  const untimed = scored && r.rankTimed === false;
  return {
    scored,
    score: scored ? r.rankScore.toFixed(2) : "—",
    untimed,
    // The basis is named where there is one, because "overdue by 40 days" and "born 40 days
    // ago with no deadline set" are both a measured clock and are not the same reading.
    basis: scored && r.rankTimed !== false ? String(r.rankTimeBasis || "") : "",
    note: untimed ? "no deadline on this row, so the clock term was not read" : "",
  };
}

/**
 * The clauses behind the score, as plain lines. One per term that ENTERED the blend, in the
 * model's own order — `rank.ts` emits `reasons` and `measuredTerms` the same length and the
 * same order, and this reads the first without re-deriving it.
 *
 * Empty for a row that was never scored, and empty is not a failure to explain: there is
 * nothing to explain about a number that was never computed. The page draws no disclosure
 * at all in that case rather than an empty one.
 */
export function rankReasonLines(row) {
  const list = (row && row.rankReasons) || [];
  return list.map((line) => String(line || "")).filter(Boolean);
}

/**
 * Which column the table shows as its active sort when the reader has chosen none.
 *
 * "No sort selected" means "trust the order the server sent" (this file's own header), and
 * the server now sends one of TWO orders. Naming the rank column when it led is the header
 * saying which — a reader who cannot tell a severity-led order from a rank-led one is being
 * asked to trust an order they cannot name. `""` keeps today's unmarked header exactly.
 */
export function defaultProblemSort(rankLeadsSort) {
  return rankLeadsSort === true ? "rank" : "";
}
