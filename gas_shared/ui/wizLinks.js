// Links out to Wiz, from wherever a register draws a finding.
//
// TWO KINDS OF LINK, AND ONLY TWO, because only two are something this register can stand
// behind:
//
//   the FINDING  — Wiz's own `portalUrl` for it, stored as `portal_url` and re-checked here by
//                  `safeWizUrl` (gas_shared/wizUrl.js) at the last moment before it becomes
//                  an href. The register never BUILDS a console link: the console's filter
//                  URLs are an undocumented hash format, and a link that silently opens the
//                  wrong view is worse than no link. Absent → no link, never a dead one.
//   the CVE      — Wiz's public vulnerability database page for a CVE id. Built, but from an
//                  id that has passed a strict pattern, onto a fixed public origin — nothing
//                  a spreadsheet cell can steer anywhere else.
//
// Both open in a new tab (`_blank` + `noopener`). A row link STOPS PROPAGATION, because the
// row it sits in opens the finding sheet on click: one click, one destination.

import { el } from "./dom.js";
import { uiIcon } from "./uiIcons.js";
import { safeWizUrl } from "../wizUrl.js";

const CVE_ID = /^CVE-\d{4}-\d{4,}$/i;
// Built, never written: each app's esbuild config refuses a bare double slash in the bundle.
const WIZ_CVE_DB = ["https:", "", "www.wiz.io", "vulnerability-database", "cve", ""].join("/");

/** Wiz's public page for a CVE id, or "" when the id is not a CVE (a GHSA, a rule id, …). */
export function wizCveUrl(id) {
  const s = typeof id === "string" ? id.trim() : "";
  return CVE_ID.test(s) ? WIZ_CVE_DB + s.toLowerCase() : "";
}

/** The finding's own Wiz console link, or "" — `safeWizUrl` is the gate. */
export function wizFindingUrl(row) {
  return safeWizUrl(row && row.portal_url);
}

/**
 * A table cell: a small "Wiz ↗" link to the finding in the console, or nothing at all.
 *
 * NOTHING, NOT A DASH, when there is no link — the same call the finding sheets make: a
 * missing link is a fact about this register's record (a row older than the column, a scope
 * whose query carries no portalUrl), not a property of the finding a dash would claim.
 *
 * @param {object} row       a register row carrying `portal_url`
 * @param {string} [name]    what the link opens, for its accessible name ("CVE-2024-1234")
 */
export function wizLinkCell(row, name) {
  const href = wizFindingUrl(row);
  if (!href) return "";
  const a = el("a", {
    class: "wiz-link",
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": `Open ${name || "this finding"} in Wiz (new tab)`,
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); },
  }, "Wiz", uiIcon("external", 12));
  return a;
}

/** The dataTable column that carries `wizLinkCell`, for any register's table. */
export function wizLinkColumn(nameOf) {
  return {
    key: "portal_url",
    label: "Wiz",
    // Unsortable on purpose: ordering by a URL orders by nothing a reader means.
    sortable: false,
    cell: (r) => wizLinkCell(r, nameOf ? nameOf(r) : ""),
  };
}

/**
 * The finding sheet's primary action: "Open in Wiz", or null when the record holds no link.
 * First in the sheet's action row, ahead of the copy buttons, because it is the step a
 * reader takes next — the register tells them which finding, Wiz is where it is acted on.
 */
export function wizOpenButton(row) {
  const href = wizFindingUrl(row);
  if (!href) return null;
  return el("a", {
    class: "btn wiz-open",
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Open this finding in Wiz (new tab)",
  }, "Open in Wiz", uiIcon("external", 14));
}
