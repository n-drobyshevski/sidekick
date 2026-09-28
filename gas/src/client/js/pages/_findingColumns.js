// The register's finding columns — one definition, shared by every table that lists findings
// straight off `api_getRegisterRows`: the Overview's register and the MTTR page's split-row
// sheet (`mttr.js` `openSplitSheet`).
//
// WHY A SHARED MODULE. Both tables draw the same server rows, sorted by the same server, under
// the same headings. Two copies of fifteen column definitions — each with its own help copy —
// is two answers to "what does the Reachable column mean", and the first edit to one of them
// makes the other wrong. `scopedRoutes.js` keeps its own reduced list on purpose (a scoped
// viewer's table, no help copy); this is the full register's.
//
// WHY `pages/`, NOT `ui/`: the reason `_groupSplit.js` gives — `shared.test.js`'s parity
// contract pins `src/client/js/ui/` to a fixed list of register primitives, and this is one
// register's vocabulary, not a design-system part.

import { TIER_LABELS } from "../charts.js";
import { PROVENANCE_HELP, PROVENANCE_LABEL, fixLabel, provenance } from "./registerModel.js";
import { wizLinkColumn } from "../../../../../gas_shared/ui/wizLinks.js";
import { absent, days1, el, fmtDate, nvdUrl, pct1, sevBadge, triCell } from "../ui.js";

/** The columns, with a definition on every heading. Every `sortable` key is a member of
 *  `REGISTER_ROW_COLUMNS`, so the server never falls back to its default order behind a
 *  heading a reader just pressed. */
export function findingColumns() {
  return [
    {
      // SEVERITY SORTS BY MEANING, and the server ranks it against `SEVERITY_ORDER` where
      // CRITICAL is 0 — so ASCENDING is worst-first. A register that defaulted this column
      // to descending would open on LOW.
      key: "severity", label: "Severity", sortable: true,
      help: ["The finding's severity as the scan assigned it. Sorted by MEANING rather "
        + "than alphabetically: ascending is worst-first."],
      cell: (r) => sevBadge(r.severity),
    },
    {
      key: "cve", label: "CVE", sortable: true,
      help: ["The finding's CVE identifier. The link opens its NVD entry."],
      cell: (r) => (r.cve
        ? el("a", { href: nvdUrl(r.cve), target: "_blank", rel: "noopener" }, r.cve)
        : absent()),
    },
    {
      key: "risk_tier", label: "Tier", sortable: true,
      help: { term: "unclassified", lines: [
        "Which exploit signal put this finding where it is, under the rule in force.",
        "Unclassified is a measurement gap, not a low score.",
      ] },
      cell: (r) => (r.risk_tier ? (TIER_LABELS[r.risk_tier] || r.risk_tier) : absent()),
    },
    {
      key: "asset_name", label: "Asset", sortable: true,
      help: ["The host workload carrying this finding."],
      cell: (r) => r.asset_name || absent(),
    },
    {
      key: "subscription_name", label: "Subscription", sortable: true,
      help: ["The cloud subscription the asset belongs to."],
      cell: (r) => r.subscription_name || absent(),
    },
    {
      key: "support_group", label: "Support group", sortable: true,
      help: ["The owning group, from the subscription map. A dash is a gap in attribution, "
        + "not a finding nobody owns."],
      cell: (r) => r.support_group || absent(),
    },
    {
      key: "first_seen", label: "First seen", sortable: true,
      help: ["The first scan that returned this finding, where the detection clock starts."],
      cell: (r) => fmtDate(r.first_seen),
    },
    {
      key: "awaiting_vendor_fix", label: "Fix", sortable: true,
      help: { term: "awaiting-fix" },
      cell: (r) => fixLabel(r.awaiting_vendor_fix),
    },
    {
      key: "has_kev", label: "KEV", sortable: true,
      help: { term: "kev" },
      cell: (r) => triCell(r.has_kev),
    },
    {
      key: "has_exploit", label: "Exploit", sortable: true,
      help: { term: "known-exploit" },
      cell: (r) => triCell(r.has_exploit),
    },
    {
      key: "epss", label: "EPSS", className: "num", sortable: true,
      help: { term: "epss" },
      cell: (r) => (r.epss === null || r.epss === undefined
        ? absent() : pct1(Number(r.epss) * 100)),
    },
    {
      key: "internet_exposed", label: "Reachable", sortable: true,
      help: { term: "internet-exposed", lines: [
        "A dash is not a No.",
        "Either the scan carried no exposure field, or the finding has left the frame.",
      ] },
      cell: (r) => triCell(r.internet_exposed),
    },
    {
      key: "age_days", label: "Age", className: "num", sortable: true,
      help: { term: "age" },
      cell: (r) => days1(r.age_days),
    },
    {
      // The server sorts the raw `status` column; the word below is a rendering of it and
      // of `resolution_src` / `reopened_count`, which ride the same row unsorted.
      key: "status", label: "State", sortable: true,
      help: { term: "returned", lines: [
        PROVENANCE_HELP.bounded,
        PROVENANCE_HELP.returned,
      ] },
      cell: (r) => PROVENANCE_LABEL[provenance(r)],
    },
    // Wiz's own link to the finding, in a new tab — the register reads, Wiz is where a
    // finding is acted on. Nothing drawn where the ledger holds no link (ui/wizLinks.js).
    wizLinkColumn((r) => r.cve),
  ];
}

/** The resolution pair — NOT in `findingColumns()`, so the Overview register draws exactly the
 *  table it always did. The MTTR row sheet lists resolved findings too, and for those the two
 *  dates are the answer: a sheet about time-to-remediation with no time-to-remediation column
 *  would send the reader into each finding to read it. Both keys are in `REGISTER_ROW_COLUMNS`,
 *  so both sort on the server like every other heading. */
function resolutionColumns() {
  return [
    {
      key: "resolved_at", label: "Resolved", sortable: true,
      help: ["When this finding was resolved. Blank while it is still open."],
      cell: (r) => (r.resolved_at ? fmtDate(r.resolved_at) : absent()),
    },
    {
      key: "mttr_days", label: "Time to fix", className: "num", sortable: true,
      help: ["Days from first detection to resolution, for a resolved finding. Blank while it "
        + "is still open — an open finding's clock is its Age."],
      cell: (r) => days1(r.mttr_days),
    },
  ];
}

/**
 * The columns named by `keys`, in the order given (the Wiz link column is `"portal_url"`). An
 * unknown key is dropped rather than thrown on — a caller naming a column that does not exist
 * gets a narrower table, never a broken one.
 */
export function pickFindingColumns(keys) {
  const byKey = new Map([...findingColumns(), ...resolutionColumns()].map((c) => [c.key, c]));
  return keys.map((k) => byKey.get(k)).filter(Boolean);
}
