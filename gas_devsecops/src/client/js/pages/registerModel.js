// What the three registers SAY, separated from how they draw it.
//
// DOM-free on purpose, so the claims below can be tested in node — the split
// gas/src/client/js/pages/executive.js already uses ("the two view functions below are pure
// and exported so the claims they encode are testable"). test/registerModel.test.js imports
// this file and never the page.
//
// THE ONE THING EVERY REGISTER HAS TO SAY, and the reason this file exists rather than three
// column arrays: a resolved finding's death date is not always a measurement. Where
// `resolution_src` is "disappeared", the date is THE SCAN THAT FIRST STOPPED SEEING IT — an
// upper bound whose error is the scan interval, not an observed event. Both are printed in
// the same column and would otherwise look identical, so the provenance travels with the
// date rather than living in a footnote nobody reads.

import { fmtCount } from "../../../../../gas_shared/ui/figures.js";

/* ------------------------------------------------------------------ provenance */

export const PROVENANCE = {
  /** Still in the register. No death date to qualify. */
  OPEN: "open",
  /** Wiz handed back a resolution date. An observed event. */
  OBSERVED: "observed",
  /** The finding stopped being returned. The date is the scan, and it is an upper bound. */
  BOUNDED: "bounded",
  /** Resolved, but nothing recorded how. Older rows, or a source that did not say. */
  UNKNOWN: "unknown",
  /** Seen again after it had been resolved. Its clock restarted on this sighting. */
  RETURNED: "returned",
};

/**
 * How a row's death date came to be, and therefore how much it can be trusted.
 *
 * Deliberately NOT scope-specific. SAST is the scope where this is ALWAYS bounded (§2: the
 * API exposes no resolution date and returns no resolved rows), which is why the caveat was
 * first written for it — but SCA and secrets resolve by disappearance too, and a page that
 * qualified only SAST would be implying the other two dates are exact when a third of them
 * are not.
 *
 * A non-resolved row is not automatically plain OPEN, either: `reconcile.ts`'s reopen path
 * sets status back to OPEN and increments `reopened_count`, so a row that was once resolved
 * and came back reads as RETURNED rather than as though it had never left. `reopened_count`
 * refuses null/undefined/""/[]/false BEFORE any cast — `Number(null)` is `0` and finite, so
 * casting first would read an absent count as "never reopened" by accident, the same trap
 * CLAUDE.md names for `cleanSettings` and the client's `num()` helper.
 */
export function provenance(row) {
  if (!row || row.status !== "RESOLVED") {
    const rc = row ? row.reopened_count : null;
    if (typeof rc === "number" && Number.isFinite(rc) && rc > 0) return PROVENANCE.RETURNED;
    return PROVENANCE.OPEN;
  }
  if (row.resolution_src === "api") return PROVENANCE.OBSERVED;
  if (row.resolution_src === "disappeared") return PROVENANCE.BOUNDED;
  return PROVENANCE.UNKNOWN;
}

/** The words each provenance gets. Short enough for a cell, honest enough to stand alone. */
export const PROVENANCE_LABEL = {
  [PROVENANCE.OPEN]: "Open",
  [PROVENANCE.OBSERVED]: "Resolved",
  [PROVENANCE.BOUNDED]: "Gone by",
  [PROVENANCE.UNKNOWN]: "Resolved",
  [PROVENANCE.RETURNED]: "Returned",
};

export const PROVENANCE_HELP = {
  [PROVENANCE.OBSERVED]:
    "The API reported this resolution date. An observed event.",
  [PROVENANCE.BOUNDED]:
    "This finding stopped being returned. The date is the scan that first missed it, so the "
    + "true fix happened at some point between the previous scan and this one — an upper "
    + "bound, not a measurement.",
  [PROVENANCE.UNKNOWN]:
    "Resolved, but nothing recorded how. Treat the date as unverified.",
  [PROVENANCE.RETURNED]:
    "Seen again after it had been resolved. Its clock restarted on this sighting; the "
    + "earlier episode is not in this figure.",
};

/**
 * The share of a set whose death date is a bound rather than a measurement.
 *
 * The page prints this beside any aggregate over resolved rows, because "median 12 d" over a
 * population that is mostly bounded dates is a different claim from the same number over
 * observed ones.
 */
export function boundedShare(rows) {
  let resolved = 0;
  let bounded = 0;
  for (const r of rows ?? []) {
    if (r.status !== "RESOLVED") continue;
    resolved += 1;
    if (provenance(r) === PROVENANCE.BOUNDED) bounded += 1;
  }
  return { resolved, bounded, pct: resolved ? (bounded / resolved) * 100 : null };
}

/**
 * The share of open rows that are back after a prior resolution, mirroring `boundedShare`'s
 * null-not-zero rule: `pct` is `null`, not `0`, when nothing is open — an empty denominator
 * is "we cannot say", never "none of them".
 */
export function returnedShare(rows) {
  let open = 0;
  let returned = 0;
  for (const r of rows ?? []) {
    if (r.status === "RESOLVED") continue;
    open += 1;
    if (provenance(r) === PROVENANCE.RETURNED) returned += 1;
  }
  return { open, returned, pct: open ? (returned / open) * 100 : null };
}

/* --------------------------------------------------------------- the three scopes */

/**
 * Per-scope configuration: what the register is, what it shows, and the one thing about it
 * that a generic table would get wrong.
 *
 * `columns` are keys into the row plus a `kind` the page maps to a renderer. Keeping them as
 * DATA rather than as render functions is what lets this file stay DOM-free — and it makes
 * the column set itself testable, which matters because a column silently missing from a
 * register is the kind of thing nobody notices until someone needs it.
 */
export const REGISTERS = {
  sca: {
    scope: "sca",
    title: "Dependencies",
    lede: "Known vulnerabilities in third-party packages — and whether there is anything to upgrade to.",
    identifierLabel: "CVE",
    componentLabel: "Package",
    columns: [
      { key: "severity", label: "Severity", kind: "severity", sortable: true },
      { key: "identifier", label: "CVE", kind: "text", sortable: true },
      { key: "component", label: "Package", kind: "text", sortable: true },
      { key: "fixed_version", label: "Fixed in", kind: "text" },
      { key: "awaiting_vendor_fix", label: "Fix available", kind: "vendorFix", sortable: true },
      { key: "has_kev", label: "KEV", kind: "tri" },
      { key: "has_exploit", label: "Exploit", kind: "tri" },
      { key: "epss", label: "EPSS", kind: "epss", sortable: true },
      { key: "repo_name", label: "Repository", kind: "text", sortable: true },
      { key: "first_seen", label: "First seen", kind: "date", sortable: true },
      { key: "status", label: "State", kind: "provenance", sortable: true },
    ],
    // The facets a reader of THIS register reaches for. Severity and repository are common;
    // the vendor-fix toggle is not, and it is the one that separates "waiting on a vendor"
    // from "waiting on a team".
    facets: ["severity", "repo", "status", "awaitingVendor"],
    caveat:
      "The three exploitation signals are TRI-STATE. Wiz returns null for a signal it never "
      + "evaluated, and about one row in eight arrives that way — so this register shows "
      + "measured-yes, measured-no and never-measured as three different answers. Collapsing "
      + "the third into the second is what makes an unassessed finding look clean.",
  },

  sast: {
    scope: "sast",
    title: "Code",
    lede: "Weaknesses in our own source: the class, the file, and the line.",
    identifierLabel: "Rule",
    componentLabel: "Location",
    columns: [
      { key: "severity", label: "Severity", kind: "severity", sortable: true },
      { key: "identifier", label: "Rule", kind: "text", sortable: true },
      { key: "cwe", label: "CWE", kind: "text", sortable: true },
      { key: "component", label: "Location", kind: "text", sortable: true },
      { key: "language", label: "Language", kind: "text", sortable: true },
      { key: "repo_name", label: "Repository", kind: "text", sortable: true },
      { key: "owner_project", label: "Owner", kind: "text", sortable: true },
      { key: "first_seen", label: "Created", kind: "date", sortable: true },
      { key: "status", label: "State", kind: "provenance", sortable: true },
    ],
    facets: ["severity", "repo", "status"],
    caveat:
      "SAST is the one register the API can never resolve: the finding type carries a "
      + "creation date but no resolution date, and this tenant returns no resolved SAST rows "
      + "at all. So EVERY closed row here is dated by the scan that first stopped seeing it. "
      + "The birth is measured; the death is bounded by the scan interval. This page keeps "
      + "them apart rather than averaging them into one confident number.",
  },

  secrets: {
    scope: "secrets",
    title: "Secrets",
    lede: "Credentials committed to source: removing one is not the same as fixing it.",
    identifierLabel: "Credential",
    componentLabel: "Location",
    columns: [
      { key: "severity", label: "Severity", kind: "severity", sortable: true },
      { key: "secret_kind", label: "Kind", kind: "text", sortable: true },
      { key: "component", label: "Location", kind: "text", sortable: true },
      { key: "repo_name", label: "Repository", kind: "text", sortable: true },
      { key: "first_seen", label: "First seen", kind: "date", sortable: true },
      // State BESIDE the date rather than instead of it, and the pair is the point: "Left
      // HEAD" says WHEN the string went, "State" says how we know — observed, or dated by
      // the scan that first missed it. On a register where leaving HEAD is the only thing
      // Wiz will ever report, an unqualified date is the easiest number here to over-read.
      { key: "status", label: "State", kind: "provenance", sortable: true },
      { key: "removed_at", label: "Left HEAD", kind: "date", sortable: true },
      { key: "validation_state", label: "Credential", kind: "validation", sortable: true },
      { key: "rotated_at", label: "Observed dead", kind: "date", sortable: true },
      { key: "twin_count", label: "Rows folded", kind: "twin" },
    ],
    facets: ["severity", "repo", "status", "validation"],
    caveat:
      "REMOVED IS NOT ROTATED, and this register is the only one where a RESOLVED status "
      + "from Wiz does not mean the risk is gone. A resolved secret means the string left "
      + "HEAD; the credential is live until something observes it dead. Those are two "
      + "columns because they are two events — and on this tenant 99.6% of instances have "
      + "never been checked at all, so the credential column is a tri-state and mostly "
      + "reads unmeasured.",
  },
};

/** The register configs, in the order the nav lists them. */
export const REGISTER_ORDER = ["sca", "sast", "secrets"];

/* ---------------------------------------------------------------- the header figures */

/**
 * What the register's header says about the set the reader is looking at.
 *
 * `total` is the FILTERED count and `scopeTotal` the unfiltered one, kept apart because a
 * page showing "1,204 findings" while a filter is on has told the reader the size of the
 * register wrongly. When they differ the header says so.
 */
export function headerFigures(payload) {
  if (!payload) return null;
  const { total, scopeTotal, summary } = payload;
  return {
    total,
    scopeTotal,
    filtered: total !== scopeTotal,
    open: summary.open,
    resolved: summary.resolved,
    // Of the resolved rows, how many carry a bounded date rather than an observed one.
    bounded: summary.disappeared,
    boundedPct: summary.resolved ? (summary.disappeared / summary.resolved) * 100 : null,
    awaitingVendor: summary.awaitingVendor,
  };
}

/**
 * Facet entries for one dimension, ordered by count and carrying their own totals.
 *
 * Counted over the SCOPE rather than the filtered set: a facet whose count shrank as you
 * selected it would be describing your selection rather than the register, and you could
 * never tell what selecting a second value would give you.
 */
export function facetEntries(facets, dimension, order) {
  const counts = (facets ?? {})[dimension] ?? {};
  const keys = Object.keys(counts);
  if (order) {
    keys.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    });
  } else {
    keys.sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1));
  }
  return keys.map((k) => ({ value: k, count: counts[k] }));
}

/**
 * The filter state carried in the URL hash, normalized.
 *
 * In the hash rather than in a closure, so a filtered register is a LINK someone can send.
 * Unknown keys are dropped rather than passed through — a hash is user-editable, and
 * forwarding whatever it holds into an RPC is how a query param becomes an injection point.
 */
export function readFilters(params, config) {
  const out = {};
  const allowed = new Set(config.facets);
  if (allowed.has("severity") && params.severities) {
    out.severities = String(params.severities).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  if (allowed.has("repo") && params.repo) out.repo = String(params.repo);
  if (allowed.has("status") && params.status) out.status = String(params.status);
  if (allowed.has("validation") && params.validation) out.validation = String(params.validation);
  if (allowed.has("awaitingVendor") && (params.awaitingVendor === "1" || params.awaitingVendor === true)) {
    out.awaitingVendor = true;
  }
  return out;
}

/** How many filters are on — the number the filter button shows. */
export function activeFilterCount(filters) {
  let n = 0;
  if (filters.severities && filters.severities.length) n += 1;
  if (filters.repo) n += 1;
  if (filters.status) n += 1;
  if (filters.validation) n += 1;
  if (filters.awaitingVendor) n += 1;
  return n;
}

/* ------------------------------------------------------------------ the front door */

/**
 * The executive hero: the KM half-life, and whether it is a number or a floor.
 *
 * Same rule the MTTR page applies, restated here rather than imported because the two pages
 * must not be able to disagree about it — the front door quoting a median where MTTR & SLA
 * quotes a lower bound would be the same register saying two things.
 */
export function executiveHeadline(km) {
  if (!km) return { value: null, bound: false, censored: 0 };
  if (km.median !== null && km.median !== undefined) {
    return { value: km.median, bound: false, censored: km.censored ?? 0 };
  }
  return { value: km.medianLowerBound ?? null, bound: true, censored: km.censored ?? 0 };
}

/**
 * Open counts per scope as an ordered list, with the severity split each carries.
 *
 * A scope with no rows is INCLUDED, carrying zero. A register that simply omits an empty
 * scope reads as though that scope does not exist, and "we have no secrets findings" and
 * "we never looked for secrets" are answers a leader must be able to tell apart — which is
 * what `lastScan` beside it settles.
 */
export function scopeSummaries(payload, order) {
  if (!payload) return [];
  return (order ?? REGISTER_ORDER).map((scope) => ({
    scope,
    title: (REGISTERS[scope] ?? {}).title ?? scope,
    totals: (payload.totals ?? {})[scope] ?? { open: 0, resolved: 0, total: 0 },
    bySeverity: (payload.openBySeverity ?? {})[scope] ?? {},
    lastScan: (payload.lastScan ?? {})[scope] ?? null,
    movement: (payload.movement ?? {})[scope] ?? null,
  }));
}


/* ------------------------------------------- what was measured, and what was never looked at */

/**
 * THE ONE LINE UNDER A REGISTER'S HERO THAT SAYS WHAT THE FIGURES ABOVE WERE MEASURED OVER.
 *
 * Three things narrow a register before any figure on its page is computed: the rows
 * themselves, the severity gate THE LAST SCAN OF THAT SCOPE APPLIED, and the base Wiz filter
 * that scope's query carries. A reader who does not know that reads "1,324 open" as a fact
 * about the estate rather than about a filtered slice of it — and on `secrets` the slice is
 * 1,933 rows out of 394,927.
 *
 * NOTHING HERE PRINTS A ZERO FOR WHAT THE GATE EXCLUDED, which is the whole reason this is a
 * function and not a template literal in three pages. The obvious version counts the rows the
 * gate kept out; nothing counted them. A sync gated to CRITICAL/HIGH never fetched a MEDIUM
 * row, so "0 below the gate" would be a confident measurement of a population nobody looked
 * at. The words are "below the gate: not counted".
 */

/** The separator between parts. One line, read left to right. */
const POPULATION_JOINER = " · ";

/**
 * A gate as WORDS, or null for "this scan looked at every severity".
 *
 * `null`, `[]` and `""` all mean the same thing — the gate was off — and all three arrive in
 * practice: `parseSeverities` answers null for a full or unparseable gate, a payload written
 * before this block existed carries neither, and `DEFAULT_FETCH_SEVERITIES.secrets` is `[]`
 * BY DESIGN, so the empty case is the secrets register's normal state rather than an edge.
 * Refused BEFORE anything is joined, because `[].join(", ")` is `""` and an empty string reads
 * on screen as a gate whose severities went missing.
 *
 * THIS IS THE ONLY PLACE THAT REFUSAL LIVES, deliberately rather than tidily. The sibling
 * register's first draft ALSO tested the result for truthiness at the call site, so deleting
 * the length check here changed nothing — the whole suite still passed, because the empty
 * string the defect produced was absorbed by the second test. The caller below asks
 * `=== null`, so there is exactly one refusal and perturbing it fails a test.
 */
function gateWords(gate) {
  if (!Array.isArray(gate)) return null;
  const kept = gate.filter((s) => typeof s === "string" && s.trim() !== "");
  return kept.length ? kept.join(", ") : null;
}

/**
 * The provenance line for a register hero: `{ text, parts }`, or null when the payload cannot
 * support one.
 *
 * Null rather than half a sentence: a warm payload written before `population` existed has no
 * gate and no filter words, and a line reading "In scope 1,324" alone would state the count as
 * if it were the whole story — the exact reading this line exists to prevent.
 */
export function populationLine(model) {
  const p = model && typeof model === "object" ? model.population : null;
  if (!p || typeof p !== "object") return null;

  const parts = [];
  // `fmtCount` refuses null/undefined/""/[]/false BEFORE the cast and renders the em dash, so
  // an unmeasured count says "—" instead of the confident zero `Number(null)` would give.
  parts.push(`In scope ${fmtCount(p.inScope)}`);

  const gate = gateWords(p.gate);
  parts.push(gate === null ? "gate: all severities" : `gate ${gate}`);

  for (const w of Array.isArray(p.filters) ? p.filters : []) {
    if (typeof w === "string" && w.trim() !== "") parts.push(w.trim());
  }

  // Only where a gate was actually applied is there anything below it to speak of — and what
  // is below it is UNKNOWN, not none.
  if (gate !== null) parts.push("below the gate: not counted");

  return { text: parts.join(POPULATION_JOINER), parts };
}
