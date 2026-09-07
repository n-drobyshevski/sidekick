// What the OS register SAYS, separated from how it draws it.
//
// DOM-free on purpose, so the claims below can be tested in node — the same split
// `pages/overviewModel.js`, `pages/mttrPaintPlan.js` and `pages/historyModel.js` already
// make here. `test/registerModel.test.js` imports this file and never the page.
//
// THE ONE THING THIS REGISTER HAS TO SAY, and the reason this file exists rather than a
// column array inside `overview.js`: a resolved finding's death date is not always a
// measurement. Where `resolution_src` is "disappeared" the date is THE SCAN THAT FIRST
// STOPPED SEEING IT (`domain/reconcile.ts`'s disappearance pass) — an upper bound whose
// error is the scan interval, not an observed event. Both are printed in the same column
// and would otherwise look identical, so the provenance travels in the WORD rather than
// living in a footnote nobody reads. It applies to every row of this register, not only to
// the ones a reader happens to open.
//
// Ported from `gas_devsecops/src/client/js/pages/registerModel.js`, which states the same
// rule for the three code registers. What is NOT ported: that file's `REGISTERS` table
// (three scopes; this app has one), `headerFigures`, `facetEntries`, `readFilters`,
// `activeFilterCount`, `executiveHeadline`, `scopeSummaries` and `populationLine` — the
// last of which already exists here, in `overviewModel.js`, and must not grow a second copy.

import { TIER_LABELS, TIER_ORDER } from "../charts.js";
import { absentText, num } from "../../../../../gas_shared/ui/figures.js";

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
 * A non-resolved row is not automatically plain OPEN: `reconcile.ts`'s reopen path sets
 * status back to OPEN and increments `reopened_count`, so a row that was once resolved and
 * came back reads as RETURNED rather than as though it had never left.
 *
 * `reopened_count` REFUSES null/undefined/""/[]/false BEFORE any cast. `Number(null)` is `0`
 * and finite, so a cast-first form reads an absent count as "never reopened" by accident —
 * the trap CLAUDE.md names three times. The `typeof rc === "number"` gate is what makes the
 * refusal bite on the one input where the two readings genuinely differ: a STRING `"2"`,
 * which `Number("2") > 0` would accept as a reopen the wire never reported.
 */
export function provenance(row) {
  const r = row && typeof row === "object" ? row : null;
  if (!r || r.status !== "RESOLVED") {
    const rc = r ? r.reopened_count : null;
    if (typeof rc === "number" && Number.isFinite(rc) && rc > 0) return PROVENANCE.RETURNED;
    return PROVENANCE.OPEN;
  }
  if (r.resolution_src === "api") return PROVENANCE.OBSERVED;
  if (r.resolution_src === "disappeared") return PROVENANCE.BOUNDED;
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

/** The pill tone each provenance takes. A bounded date is `warn`, never `ok`: a green tick
 *  over "it went at some unknown point in the last scan interval" overstates the ledger. */
export const PROVENANCE_KIND = {
  [PROVENANCE.OPEN]: "neutral",
  [PROVENANCE.OBSERVED]: "ok",
  [PROVENANCE.BOUNDED]: "warn",
  [PROVENANCE.UNKNOWN]: "warn",
  [PROVENANCE.RETURNED]: "warn",
};

export const PROVENANCE_HELP = {
  [PROVENANCE.OBSERVED]:
    "The API reported this resolution date. An observed event.",
  [PROVENANCE.BOUNDED]:
    "This finding stopped being returned. The date is the scan that first missed it, so the "
    + "fix happened at some point between the previous scan and this one — an upper bound, "
    + "not a measurement.",
  [PROVENANCE.UNKNOWN]:
    "Resolved, but nothing recorded how. Treat the date as unverified.",
  [PROVENANCE.RETURNED]:
    "Seen again after it had been resolved. Its clock restarted on this sighting; the "
    + "earlier episode is not in this figure.",
};

/**
 * The share of a set whose death date is a bound rather than a measurement.
 *
 * `pct` is `null`, not `0`, when nothing is resolved — an empty denominator is "we cannot
 * say", never "none of them". Printed beside any aggregate over resolved rows, because
 * "median 12 d" over a population that is mostly bounded dates is a different claim from
 * the same number over observed ones.
 */
export function boundedShare(rows) {
  let resolved = 0;
  let bounded = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.status !== "RESOLVED") continue;
    resolved += 1;
    if (provenance(r) === PROVENANCE.BOUNDED) bounded += 1;
  }
  return { resolved, bounded, pct: resolved ? (bounded / resolved) * 100 : null };
}

/** The share of open rows that are back after a prior resolution. Same null-not-zero rule. */
export function returnedShare(rows) {
  let open = 0;
  let returned = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.status === "RESOLVED") continue;
    open += 1;
    if (provenance(r) === PROVENANCE.RETURNED) returned += 1;
  }
  return { open, returned, pct: open ? (returned / open) * 100 : null };
}

/* ------------------------------------------------------------- the register's columns */

/**
 * The columns the findings table draws, as DATA.
 *
 * Keeping the set out of the render function is what lets a test check it: every `key` here
 * must be a member of `REGISTER_ROW_COLUMNS` (`domain/pagePayload.ts`) — the allowlist the
 * server slices a row down to — because a column keyed on something the wire does not carry
 * would print a dash on every row of the register for the life of the page, which claims the
 * register looked and found nothing.
 *
 * `sortable` is the second half of the same claim: the SERVER sorts (the register is the
 * whole ledger, not a page the browser holds), and `getRegisterRows` falls back to the
 * default order SILENTLY for a column it does not recognise — so a stray key here would look
 * like a header that simply stopped working.
 */
export const REGISTER_COLUMNS = [
  { key: "severity", label: "Severity", sortable: true },
  { key: "cve", label: "CVE", sortable: true },
  { key: "risk_tier", label: "Tier", sortable: true },
  { key: "asset_name", label: "Asset", sortable: true },
  { key: "subscription_name", label: "Subscription", sortable: true },
  { key: "support_group", label: "Support group", sortable: true },
  { key: "first_seen", label: "First seen", sortable: true },
  { key: "awaiting_vendor_fix", label: "Fix", sortable: true },
  { key: "has_kev", label: "KEV", sortable: true },
  { key: "has_exploit", label: "Exploit", sortable: true },
  { key: "epss", label: "EPSS", sortable: true },
  { key: "internet_exposed", label: "Reachable", sortable: true },
  { key: "age_days", label: "Age", sortable: true },
  { key: "status", label: "State", sortable: true },
];

/** Which order the register opens in — mirrors `REGISTER_ROW_DEFAULT_SORT` on the server, so
 *  the FIRST paint's header already reflects what the server actually sent. */
export const REGISTER_DEFAULT_SORT = "age_days";
export const REGISTER_DEFAULT_DIR = "desc";

/** The sort keys the toolbar may ask for: exactly the columns drawn as sortable. */
export const REGISTER_SORT_KEYS = REGISTER_COLUMNS
  .filter((c) => c.sortable).map((c) => c.key);

/**
 * The vendor-fix cell's word, in one place so the table and the finding sheet cannot spell
 * it two ways.
 *
 * `awaiting_vendor_fix` is a DERIVED boolean (`ledgerCore.baseRows` always computes it), so
 * a null here is a payload that never carried the column rather than a measured "no" — and
 * "Available" over that would claim a fix nobody looked for.
 */
export function fixLabel(v) {
  if (v === null || v === undefined) return absentText;
  return v ? "Awaiting vendor" : "Available";
}

/* ------------------------------------------------------------------- the URL params */

export const REGISTER_STATUSES = ["open", "resolved", "all"];
export const REGISTER_FIX_MODES = ["all", "fixable", "awaiting"];

/** The largest page the shared pager can ask for — `REGISTER_ROWS_PAGE_SIZE_CAP`. */
export const REGISTER_PAGE_SIZE_CAP = 250;

/**
 * The register's filter state, read out of the URL hash and NORMALIZED.
 *
 * In the hash rather than in a closure, so a filtered register is a LINK somebody can send —
 * which is also what lets the Executive page's fix-next list land on a filtered table.
 * Unknown keys are DROPPED rather than passed through: a hash is user-editable, and
 * forwarding whatever it holds into an RPC is how a query param becomes an injection point.
 *
 * AN UNRECOGNISED VALUE FALLS BACK TO THE DEFAULT, NEVER TO AN EMPTY PAGE, mirroring
 * `registerRowFilters` on the server — answering a typo with "0 findings" would state a
 * measurement about a population nobody asked for. `status` defaults to `open` for the same
 * reason it does there: the register's question is what is still outstanding.
 *
 * `page` refuses null/blank/non-numeric BEFORE the cast. `Number(null)` is 0 and finite, so
 * a cast-first form cannot tell "no page asked for" from "page 0" — harmless here by luck,
 * and the same shape that is not harmless one field over.
 */
export function readRegisterParams(params) {
  const p = params && typeof params === "object" ? params : {};

  const askedStatus = String(p.status ?? "").toLowerCase();
  const status = REGISTER_STATUSES.includes(askedStatus) ? askedStatus : "open";

  const askedFix = String(p.fix ?? "").toLowerCase();
  const fix = REGISTER_FIX_MODES.includes(askedFix) ? askedFix : "all";

  // Returned in TIER_ORDER, not in the order it was asked in, so two links narrowing to the
  // same set produce one request and one cache entry on the server.
  const wanted = new Set(
    (Array.isArray(p.tier) ? p.tier.map(String) : String(p.tier ?? "").split(","))
      .map((v) => v.trim().toLowerCase())
      .filter((v) => TIER_ORDER.includes(v)),
  );
  const tier = TIER_ORDER.filter((t) => wanted.has(t));

  const exposed = p.exposed === true || p.exposed === "1" || p.exposed === "true";

  const askedSort = String(p.sort ?? "");
  const sort = REGISTER_SORT_KEYS.includes(askedSort) ? askedSort : REGISTER_DEFAULT_SORT;
  const askedDir = String(p.dir ?? "").toLowerCase();
  const dir = askedDir === "asc" || askedDir === "desc"
    ? askedDir
    : sort === REGISTER_DEFAULT_SORT ? REGISTER_DEFAULT_DIR : "asc";

  const rawPage = num(p.page);
  const page = rawPage === null ? 0 : Math.max(0, Math.floor(rawPage));

  return { status, fix, tier, exposed, page, sort, dir };
}

/** The params those filters write back into the hash. Empty strings are dropped by
 *  `buildHash`, so a default view is a bare URL and a shared link never carries a filter
 *  nobody chose. */
export function registerParamPatch(filters) {
  const f = filters || {};
  return {
    status: f.status === "open" ? "" : f.status || "",
    fix: f.fix === "all" ? "" : f.fix || "",
    tier: (f.tier || []).join(","),
    exposed: f.exposed ? "1" : "",
    sort: f.sort === REGISTER_DEFAULT_SORT ? "" : f.sort || "",
    dir: f.sort === REGISTER_DEFAULT_SORT && f.dir === REGISTER_DEFAULT_DIR
      ? "" : f.dir || "",
    page: f.page ? String(f.page) : "",
  };
}

/** How many of the register's own filters are on. */
export function activeRegisterFilters(filters) {
  const f = filters || {};
  let n = 0;
  if (f.status && f.status !== "all") n += 1;
  if (f.fix && f.fix !== "all") n += 1;
  if (f.tier && f.tier.length) n += 1;
  if (f.exposed) n += 1;
  return n;
}

/**
 * The sentence a filter-emptied table gets, naming WHICH filters narrowed it.
 *
 * Null when nothing is on — an unfiltered register with no rows is not a filter's doing, and
 * `dataTable`'s own `emptyText` is the right thing to say there. A shared string reading
 * "nothing matched the current filters" over an unfiltered table would name controls that
 * are not doing anything.
 */
export function filterSentence(filters) {
  const f = filters || {};
  const parts = [];
  if (f.status === "open") parts.push("open only");
  else if (f.status === "resolved") parts.push("resolved only");
  if (f.fix === "fixable") parts.push("fix available");
  else if (f.fix === "awaiting") parts.push("awaiting vendor fix");
  if (f.tier && f.tier.length) {
    parts.push("tier " + f.tier.map((t) => TIER_LABELS[t] || t).join(", "));
  }
  if (f.exposed) parts.push("internet-reachable only");
  if (!parts.length) return null;
  return "Nothing matched: " + parts.join(", ") + ".";
}

/* ------------------------------------------------------------------- the first run */

/**
 * The first-run decision for a register: has anything ever been written to it at all.
 *
 * `num(rowCount, 0)` rather than a bare `=== 0`: a malformed payload with no count degrades
 * to the SAME safe default — nothing here to show — rather than to a page that assumes data
 * it does not have. An UNMEASURED REGISTER IS NOT A REGISTER OF ZEROES: a hero of 0 over
 * three stat rows of 0 states four facts about a population nobody has looked at.
 *
 * `synced` distinguishes "no scan has ever run" from "a scan ran and saved nothing", and
 * `at` is passed straight through to `firstRunNotice`, which is the one place that decides
 * whether it is usable.
 */
export function registerFirstRunView(rowCount, synced, at) {
  return { show: num(rowCount, 0) === 0, synced: !!synced, at };
}
