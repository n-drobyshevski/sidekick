// The scoped viewer's route table: two read-only pages instead of the whole app.
//
// A boot payload with `role: "scoped"` (server/api.ts `scopedBoot`) swaps PAGES for this table
// through the shell's `pagesFor` hook (app.js). Every other route — Settings included —
// resolves to `scope` and is rewritten in the address bar. The server is the boundary: a scoped
// caller asking for anything else is answered `forbidden` (server/access.ts `SCOPED_RPCS`).
//
// Kept apart from pages.js so the navGroups contract, which reads PAGES as THE IA, keeps
// reading exactly that.

import { call } from "../../../../gas_shared/api.js";
import { renderScopeSummary, renderScopedFindings } from "../../../../gas_shared/ui/scopedPages.js";
import { fmtDate, sevBadge, triCell } from "./ui.js";
import { epssPct, textCell, yesNo } from "./pages/sca.js";
import { PROVENANCE_LABEL, provenance, REGISTER_ORDER, REGISTERS } from "./pages/registerModel.js";
import { findingRowLabel, openFindingSheet } from "./pages/findingSheet.js";

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/** One renderer per column KIND — the register configs keep columns as data for this reason. */
const CELL = {
  severity: (v) => sevBadge(v),
  text: (v) => textCell(v),
  date: (v) => fmtDate(v),
  tri: (v) => triCell(v),
  epss: (v) => epssPct(v),
  vendorFix: (v) => yesNo(!v),
  validation: (v) => textCell(v),
  twin: (v) => textCell(v),
};

function columnsFor(kind) {
  const reg = REGISTERS[kind] || REGISTERS.sca;
  return reg.columns.map((c) => ({
    key: c.key,
    label: c.label,
    sortable: !!c.sortable,
    className: c.kind === "epss" ? "num" : undefined,
    cell: c.kind === "provenance"
      ? (r) => PROVENANCE_LABEL[provenance(r)]
      : (r) => (CELL[c.kind] || CELL.text)(r[c.key]),
  }));
}

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
      kinds: REGISTER_ORDER.map((k) => ({ value: k, label: REGISTERS[k].title })),
      columns: columnsFor,
      // No default sort: each register's own default is the server's to apply.
      defaultSort: undefined,
      // Scope params are the SERVER's to set; only the register is chosen here.
      baseParams: (kind) => ({ scope: kind }),
      csv: (kind) => call("api_getExportCsv", { scope: kind }),
      onRowOpen: (r, rows, kind) => openFindingSheet(kind, r, { rows }),
      rowLabel: (r, kind) => findingRowLabel(kind, r),
    }),
  },
};

/** The shell's `pagesFor`: the reduced table for a scoped payload, else null (PAGES). */
export function pagesFor(data) {
  return data && data.role === "scoped" ? { pages: SCOPED_PAGES, defaultRoute: "scope" } : null;
}
