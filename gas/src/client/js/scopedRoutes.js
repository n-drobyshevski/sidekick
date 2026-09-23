// The scoped viewer's route table: two read-only pages instead of the whole app.
//
// A boot payload with `role: "scoped"` (server/api.ts `scopedBootData`) swaps PAGES for this
// table through the shell's `pagesFor` hook (app.js). Every other route — Settings included —
// resolves to `scope` and is rewritten in the address bar. The server is the boundary; this
// is only what gets drawn: a scoped caller asking for anything else over google.script.run is
// answered `forbidden` (server/access.ts `SCOPED_RPCS`).
//
// Kept apart from pages.js so the navGroups contract, which reads PAGES as THE IA, keeps
// reading exactly that.

import { call } from "../../../../gas_shared/api.js";
import { renderScopeSummary, renderScopedFindings } from "../../../../gas_shared/ui/scopedPages.js";
import { absent, el, fmtDate, sevBadge, triCell } from "./ui.js";
import { nvdUrl } from "./ui/nvd.js";
import { TIER_LABELS } from "./charts.js";
import {
  fixLabel, PROVENANCE_LABEL, provenance, REGISTER_DEFAULT_DIR, REGISTER_DEFAULT_SORT,
} from "./pages/registerModel.js";
import { findingRowLabel, openFindingSheet } from "./pages/findingSheet.js";
import { wizLinkColumn } from "../../../../gas_shared/ui/wizLinks.js";

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

function days(v) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : null;
  return n === null ? absent() : `${Math.round(n)} d`;
}

/** The register's own columns, less the ones that only mean something across teams. */
const FINDING_COLUMNS = [
  { key: "severity", label: "Severity", sortable: true, cell: (r) => sevBadge(r.severity) },
  {
    key: "cve", label: "CVE", sortable: true,
    cell: (r) => (r.cve ? el("a", { href: nvdUrl(r.cve), target: "_blank", rel: "noopener" }, r.cve) : absent()),
  },
  {
    key: "risk_tier", label: "Tier", sortable: true,
    cell: (r) => (r.risk_tier ? (TIER_LABELS[r.risk_tier] || r.risk_tier) : absent()),
  },
  { key: "asset_name", label: "Asset", sortable: true, cell: (r) => r.asset_name || absent() },
  { key: "support_group", label: "Support group", sortable: true, cell: (r) => r.support_group || absent() },
  { key: "first_seen", label: "First seen", sortable: true, cell: (r) => fmtDate(r.first_seen) },
  { key: "awaiting_vendor_fix", label: "Fix", sortable: true, cell: (r) => fixLabel(r.awaiting_vendor_fix) },
  { key: "has_kev", label: "KEV", sortable: true, cell: (r) => triCell(r.has_kev) },
  { key: "internet_exposed", label: "Reachable", sortable: true, cell: (r) => triCell(r.internet_exposed) },
  { key: "age_days", label: "Age", className: "num", sortable: true, cell: (r) => days(r.age_days) },
  { key: "status", label: "State", sortable: true, cell: (r) => PROVENANCE_LABEL[provenance(r)] },
  // Straight to the finding in Wiz, where the owning team acts on it.
  wizLinkColumn((r) => r.cve),
];

// The two routes' rail marks, on the entries themselves: the manifest's ROUTE_ICONS is held to
// PAGES exactly (the navGroups contract), and these are not PAGES.
const SUMMARY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5h16"/><path d="M7 16v-5"/><path d="M12 16V6.5"/><path d="M17 16v-3"/></svg>';
const LIST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6.5h11"/><path d="M9 12h11"/><path d="M9 17.5h11"/><path d="M4.5 6.5h.01"/><path d="M4.5 12h.01"/><path d="M4.5 17.5h.01"/></svg>';

export const SCOPED_PAGES = {
  scope: {
    title: "My scope", group: null, icon: SUMMARY_ICON,
    render: (main, params) => renderScopeSummary(main, params, { sevOrder: SEV_ORDER, findingsRoute: "findings" }),
  },
  findings: {
    title: "My findings", group: null, icon: LIST_ICON,
    render: (main, params) => renderScopedFindings(main, params, {
      rpc: "api_getRegisterRows",
      columns: FINDING_COLUMNS,
      defaultSort: REGISTER_DEFAULT_SORT,
      defaultDir: REGISTER_DEFAULT_DIR,
      // Scope params are the SERVER's to set; nothing sent here can widen them.
      baseParams: () => ({}),
      csv: () => call("api_getExportCsv", { source: "findings" }),
      // The categorical columns, in the order a reader reaches for them. The server holds the
      // same allowlist (api.ts REGISTER_GROUP_COLUMNS) and ignores anything else.
      groupable: [
        { key: "severity", label: "Severity" },
        { key: "asset_name", label: "Asset" },
        { key: "cve", label: "CVE" },
        { key: "risk_tier", label: "Tier" },
        { key: "support_group", label: "Support group" },
        { key: "domain", label: "Domain" },
        { key: "subscription_name", label: "Subscription" },
        { key: "awaiting_vendor_fix", label: "Fix availability" },
      ],
      onRowOpen: (r, rows) => openFindingSheet(r, { rows }),
      rowLabel: findingRowLabel,
    }),
  },
};

/** The shell's `pagesFor`: the reduced table for a scoped payload, else null (PAGES). */
export function pagesFor(data) {
  return data && data.role === "scoped" ? { pages: SCOPED_PAGES, defaultRoute: "scope" } : null;
}
