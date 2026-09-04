// The Toxic Combinations page as pure functions of state — ranking, URL round-tripping,
// issue filtering/sorting, and the SLA verdict.
//
// Split out of combos.js for the same reason graphChips.js was split out of graph.js:
// this is the part that is wrong in ways a screenshot won't show, and it is the part
// testable without a DOM. combos.js turns what these return into elements and does
// nothing else clever.
//
// Two thresholds here mirror the domain layer, which the client bundle cannot import:
// DUE_SOON_DAYS (src/domain/comboDigest.ts) and CONDITION_KEYS (src/domain/toxicCombos.ts).
// They must be changed in both places or the KPI row and the row pills start telling
// different stories about the same deadline.

import { dueRank, sevRank as rankSeverity } from "../../../../../gas_shared/ui/format.js";

export const CONDITION_KEYS = [
  "MISSING_GUARDRAIL", "EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "INTERNET_EXPOSURE",
];

export const SEVERITY_RANK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];


export const DUE_SOON_DAYS = 7;

const DAY_MS = 86400000;

const sevRank = (sev) => rankSeverity(sev, SEVERITY_RANK);

// ------------------------------------------------------------------------- ranking

/**
 * Worst-first: adjusted severity, then the bigger population, then the title so the
 * order is stable. The page used to render COMBO_GROUPS declaration order, which put a
 * LOW-native pattern above HIGH ones on a page whose whole job is triage.
 */
export function rankGroups(groups) {
  return (groups || []).slice().sort((a, b) => {
    const d = sevRank(a.adjustedSeverity) - sevRank(b.adjustedSeverity);
    if (d !== 0) return d;
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

// ------------------------------------------------------------------------ URL state

/** Read the hash params into view state, dropping anything this page doesn't offer. */
export function readComboParams(params) {
  const p = params || {};
  const sev = String(p.sev || "").toUpperCase();
  const cond = String(p.cond || "").toUpperCase();
  const page = Number(p.page);
  return {
    open: p.open || "",
    cond: CONDITION_KEYS.indexOf(cond) >= 0 ? cond : "",
    sev: SEVERITY_RANK.indexOf(sev) >= 0 ? sev : "",
    q: p.q || "",
    acct: p.acct || "",
    proj: p.proj || "",
    sort: ISSUE_COMPARATORS[p.sort] ? p.sort : "",
    dir: String(p.dir) === "-1" ? -1 : 1,
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0,
  };
}

/**
 * The inverse, shaped for setParams. Every key is present — buildHash drops the empty
 * ones — so clearing a filter actually removes it from the URL instead of leaving a
 * stale value behind.
 */
export function comboParamPatch(state) {
  const s = state || {};
  return {
    open: s.open || "",
    cond: s.cond || "",
    sev: s.sev || "",
    q: s.q || "",
    acct: s.acct || "",
    proj: s.proj || "",
    sort: s.sort || "",
    dir: s.sort && s.dir === -1 ? "-1" : "",
    page: s.page ? String(s.page + 1) : "",
  };
}

// ---------------------------------------------------------------- pattern filtering

/**
 * Is this condition present for a pattern at all — either because the rule tests it, or
 * because its assets carry it anyway? The second half is what makes the matrix's
 * exposure column worth clicking: no rule tests it, so every mark there is extra risk.
 */
export function conditionPresent(tally) {
  if (!tally) return false;
  return !!tally.required || (tally.carried || 0) > 0 || (tally.unknown || 0) > 0;
}

/**
 * Whether a group re-rates its issues. The server sends the flag; the `!== false` reading
 * means a payload cached before the flag existed still treats the four modelled patterns
 * as amplified, which is what they are.
 */
export function isAmplified(group) {
  return !!group && group.amplified !== false;
}

/** Page-level filters, applied to the pattern cards and the matrix rows alike. */
export function groupMatches(group, digestGroup, state) {
  const s = state || {};
  if (s.sev) {
    // Filter on what the group HOLDS when the digest says, not on its declared level. A
    // modelled pattern declares one severity for all its rows, but a residual bucket
    // holds a mix — comparing its single declared level would hide the card under a
    // filter its own rows match, while applyIssueFilters below happily kept them.
    const mix = (digestGroup && digestGroup.adjustedMix) || group.adjustedMix;
    if (mix) {
      if (!mix[s.sev]) return false;
    } else if (String(group.adjustedSeverity || "").toUpperCase() !== s.sev) {
      return false;
    }
  }
  if (s.cond) {
    const conditions = digestGroup && digestGroup.conditions;
    if (!conditionPresent(conditions && conditions[s.cond])) return false;
  }
  return true;
}

// ------------------------------------------------------------- issue rows: filter…

/**
 * Row-level filters. Severity is the page-level one applied again: a pattern that
 * survives it can still hold rows that don't, and showing those would make the count
 * above the table disagree with the rows inside it.
 */
export function applyIssueFilters(rows, state) {
  const s = state || {};
  const q = String(s.q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (s.sev && String(r.adjustedSeverity || "").toUpperCase() !== s.sev) return false;
    if (s.acct && String(r.account || "") !== s.acct) return false;
    if (s.proj && (r.projects || []).indexOf(s.proj) === -1) return false;
    if (q) {
      const hay = [r.assetName, r.region, r.account, (r.projects || []).join(" ")]
        .join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/** The account, project and priority values actually present, for the filter fields. */
export function issueFilterOptions(rows) {
  const accounts = new Set();
  const projects = new Set();
  for (const r of rows || []) {
    if (r.account) accounts.add(String(r.account));
    for (const p of r.projects || []) if (p) projects.add(String(p));
  }
  const sorted = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));
  return {
    accounts: sorted(accounts),
    projects: sorted(projects),
    // Worst first, like the column itself — not alphabetical like accounts/projects,
    // which carry no inherent order.
  };
}

// -------------------------------------------------------------- …and sort the rows

/**
 * Each comparator is the column's natural FIRST-click order — worst severity first,
 * soonest deadline first, names A-first. `dir` flips it. Mirrors the shape graphTable
 * uses in graphView.js so the two sortable tables behave identically.
 */

export const ISSUE_COMPARATORS = {
  asset: (a, b) => String(a.assetName || "").localeCompare(String(b.assetName || "")),
  severity: (a, b) => sevRank(a.adjustedSeverity) - sevRank(b.adjustedSeverity),
  native: (a, b) => sevRank(a.nativeSeverity) - sevRank(b.nativeSeverity),
  // Phase 5: the problem tree's outcome (ACT/ATTEND/TRACK*/TRACK), not a Wiz severity —
  // a separate scale that can disagree with the two above by design.
  region: (a, b) => String(a.region || "").localeCompare(String(b.region || "")),
  account: (a, b) => String(a.account || "").localeCompare(String(b.account || "")),
  due: (a, b) => dueRank(a) - dueRank(b),
  status: (a, b) => String(a.status || "").localeCompare(String(b.status || "")),
};

/** Columns whose natural order reads as descending — for aria-sort and the glyph. */
export const ISSUE_SORT_DESC = { severity: true, native: true, priority: true };

export function sortIssues(rows, key, dir) {
  const cmp = ISSUE_COMPARATORS[key];
  const list = (rows || []).slice();
  if (!cmp) return list;
  const sign = dir === -1 ? -1 : 1;
  return list.sort((a, b) => {
    const d = cmp(a, b) * sign;
    if (d !== 0) return d;
    // A stable tiebreak, so a re-sort of equal rows never reshuffles them under the eye.
    return String(a.assetName || "").localeCompare(String(b.assetName || ""))
      || String(a.id || "").localeCompare(String(b.id || ""));
  });
}

// ----------------------------------------------------------------------------- SLA

/**
 * The SLA deadline as a verdict, never as a raw ISO string. `kind` is a .pill class, so
 * the row pill, the sort and the KPI row all read the deadline the same way.
 */
export function slaState(dueAt, nowMs) {
  const t = Date.parse(dueAt || "");
  if (Number.isNaN(t)) return null;
  const days = Math.round((t - nowMs) / DAY_MS);
  const kind = days < 0 ? "bad" : days <= DUE_SOON_DAYS ? "warn" : "neutral";
  const label = days < 0
    ? "Overdue " + Math.abs(days) + "d"
    : days === 0 ? "Due today" : "Due in " + days + "d";
  return { days, kind, label };
}

// -------------------------------------------------------------- severity-shift bars

/**
 * A severity mix as ordered bar segments. `total` is passed in rather than summed so the
 * native and adjusted bars share one scale — the whole point of drawing them stacked is
 * that the widths compare, and a mix that lost a row to an unknown level would otherwise
 * silently rescale itself.
 */
export function shiftSegments(mix, total) {
  const counts = mix || {};
  const denom = total || SEVERITY_RANK.reduce((sum, s) => sum + (counts[s] || 0), 0);
  return SEVERITY_RANK
    .filter((sev) => counts[sev])
    .map((sev) => ({ sev: sev, count: counts[sev], pct: denom ? counts[sev] / denom : 0 }));
}

/** "27 of 29 issues re-rated" — the amplifier's effect, in words, for the bar caption. */
export function shiftSummary(totals) {
  const t = totals || {};
  const reRated = t.reRated || 0;
  const total = t.totalOpen || 0;
  if (!total) return "";
  if (!reRated) return "No issue was re-rated: Wiz severity is carried through as-is.";
  return reRated + " of " + total + " open issue" + (total === 1 ? "" : "s")
    + " re-rated up one level.";
}
