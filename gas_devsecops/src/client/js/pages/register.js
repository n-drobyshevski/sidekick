// One register page, three configurations.
//
// Dependencies, Code and Secrets differ in what they hold and in the one thing a generic
// table would get wrong about each — but they are the same page: a filtered, sorted, paged
// view over the ledger with a drill-down. Three copies would drift, and the honesty rules
// are exactly the part that must not.
//
// WHAT THIS FILE DOES NOT DECIDE. The columns, the facets, the caveats and above all the
// provenance verdict live in registerModel.js, which is DOM-free and tested. This file draws.
// That split is what lets "a bounded date is not a measurement" be a test rather than a
// comment.
//
// PAGING AND FILTERING ARE SERVER-SIDE. SCA is 17,991 rows; the reader looks at fifty. The
// endpoint caches the filtered set and slices it (src/server/registers.ts), so Next is a
// slice rather than a second pass over the ledger.

import { swrCall, parseHash, setParams } from "../store.js";
import { clear, el } from "../ui.js";
import { heroStat, kpiCard, pageHeader, statusPill } from "../ui/controls.js";
import { dataTable, tableFooter } from "../ui/data.js";
import { emptyState, errorState, skeletonStack } from "../ui/feedback.js";
import { absent, triCell } from "../ui/cells.js";
import { sevBadge } from "../ui/severity.js";
import { fmtDate } from "../ui/format.js";
import { openSheet, sheetSection, sheetRow } from "../ui/sheet.js";
import { tip } from "../ui/tip.js";
import {
  PROVENANCE, PROVENANCE_HELP, PROVENANCE_LABEL, activeFilterCount, facetEntries,
  headerFigures, provenance, readFilters,
} from "./registerModel.js";

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

function count(n) {
  return Number(n || 0).toLocaleString();
}

function pct(v) {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`;
}

function days(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v < 10 ? `${v.toFixed(1)} d` : `${Math.round(v).toLocaleString()} d`;
}

/* ------------------------------------------------------------------ cell renderers */

/**
 * The state cell, and the reason this page has a model file.
 *
 * "Resolved 12 Aug" and "Gone by 12 Aug" are the same pixel width and mean different things:
 * the first is an event the API reported, the second is the scan that first stopped seeing
 * the finding — so the fix happened at some unknown point in the preceding interval. The
 * distinction rides in the WORD, with the explanation one hover away, because a reader
 * skimming a column of dates will not go looking for a footnote.
 */
function provenanceCell(row) {
  const p = provenance(row);
  if (p === PROVENANCE.OPEN) return statusPill("neutral", "Open");
  const label = PROVENANCE_LABEL[p];
  const when = row.resolved_at ? fmtDate(row.resolved_at) : null;
  // warn, not ok, for a bounded date: the pill's colour is the first thing read, and a
  // green tick over "we think it went sometime in the last month" overstates the finding.
  const kind = p === PROVENANCE.BOUNDED ? "warn" : "ok";
  return statusPill(kind, when ? `${label} ${when}` : label, PROVENANCE_HELP[p]);
}

/**
 * Whether a fix exists to take. SCA only — the other two scopes have no vendor, and
 * `baseRows` guarantees the flag is false there rather than meaningful.
 */
function vendorFixCell(row) {
  if (row.status !== "OPEN") return absent();
  return row.awaiting_vendor_fix
    ? statusPill("warn", "Awaiting vendor",
        "Open, and no fixed version exists yet. This row is waiting on a vendor rather than "
        + "on a team, so it sits outside the actionable clock while staying in the exposure "
        + "count.")
    : statusPill("ok", "Available",
        `A fix has been available since ${fmtDate(row.fix_available_at) || "an unrecorded date"}.`);
}

/** The credential's own state — measured live, measured dead, or never checked. */
function validationCell(row) {
  const v = row.validation_state;
  if (v === "VALID") {
    // A LIVE credential is the bad outcome here, whatever the finding's status says.
    return statusPill("bad", "Live",
      "Checked, and the credential still works. Removing it from HEAD does not change this.");
  }
  if (v === "INVALID") {
    return statusPill("ok", "Dead", "Checked, and the credential no longer works.");
  }
  return tip(absent(),
    v === "ERROR"
      ? "The check failed, so nothing is known about this credential."
      : "Never checked. On this tenant 99.6% of secret instances are in this state — which "
        + "is not the same as the credential being safe.");
}

/** The twin fold, and what it discarded. */
function twinCell(row) {
  const n = row.twin_count;
  if (!n || n < 2) return absent();
  const spread = row.twin_first_seen_spread_days;
  return tip(
    el("span", {}, `${n} rows`),
    `Wiz returned this one finding ${n} times — once per indexed entity — and the register `
    + `folded them. Their first-seen dates disagreed by ${days(spread)}; the earliest was `
    + "kept.",
  );
}

function epssCell(row) {
  if (row.epss === null || row.epss === undefined) {
    return tip(absent(), "Wiz never evaluated an EPSS score for this finding.");
  }
  return `${(row.epss * 100).toFixed(1)}%`;
}

/** Map a column's declared `kind` to how it draws. */
function cellFor(col) {
  switch (col.kind) {
    case "severity": return (r) => sevBadge(r.severity);
    case "provenance": return provenanceCell;
    case "vendorFix": return vendorFixCell;
    case "validation": return validationCell;
    case "twin": return twinCell;
    case "epss": return epssCell;
    case "tri": return (r) => {
      const v = r[col.key];
      return v === null || v === undefined
        ? tip(absent(), "Wiz never evaluated this signal. Not the same as a measured no.")
        : triCell(v);
    };
    case "date": return (r) => fmtDate(r[col.key]) || absent();
    default: return (r) => {
      const v = r[col.key];
      return v === null || v === undefined || v === "" ? absent() : String(v);
    };
  }
}

/* ---------------------------------------------------------------------- the drill-down */

function detailSheet(config, row) {
  openSheet((body) => {
    const line = (label, value) =>
      sheetRow({ title: label, note: value === null || value === undefined || value === "" ? "—" : String(value) });

    body.append(sheetSection("Identity",
      line(config.identifierLabel, row.identifier),
      line(config.componentLabel, row.component),
      line("Repository", row.repo_name),
      row.branch ? line("Branch", row.branch) : null,
      line("Owner", row.owner_project),
      line("Key", row.finding_key)));

    body.append(sheetSection("Clock",
      line("First seen", fmtDate(row.first_seen)),
      line("Last seen", fmtDate(row.last_seen)),
      sheetRow({
        title: "State",
        note: PROVENANCE_LABEL[provenance(row)]
          + (row.resolved_at ? ` ${fmtDate(row.resolved_at)}` : ""),
        // The provenance explanation, in full, where there is room for it.
        fix: provenance(row) === PROVENANCE.OPEN ? null : PROVENANCE_HELP[provenance(row)],
      }),
      row.mttr_days !== null ? line("Time to remediate", days(row.mttr_days)) : null,
      row.age_days !== null ? line("Age", days(row.age_days)) : null,
      row.reopened_count ? line("Reopened", `${row.reopened_count} time(s)`) : null));

    if (row.scope === "sca") {
      body.append(sheetSection("The second clock",
        line("Fix available", fmtDate(row.fix_available_at)),
        line("Fixed version", row.fixed_version),
        line("Actionable from", fmtDate(row.actionable_from)),
        row.mttr_actionable_days !== null
          ? line("Actionable time to remediate", days(row.mttr_actionable_days)) : null));
      body.append(sheetSection("Exploitation",
        sheetRow({
          title: "Signals",
          note: "Null means Wiz never evaluated the signal — not that the answer was no.",
        }),
        line("KEV", row.has_kev === null ? "never evaluated" : row.has_kev ? "yes" : "no"),
        line("Known exploit",
          row.has_exploit === null ? "never evaluated" : row.has_exploit ? "yes" : "no"),
        line("EPSS", row.epss === null ? "never evaluated" : `${(row.epss * 100).toFixed(1)}%`),
        line("First witnessed", fmtDate(row.risk_observed_at))));
    }

    if (row.scope === "sast") {
      body.append(sheetSection("Code",
        line("CWE", row.cwe),
        line("File", row.file_path),
        line("Line", row.start_line),
        line("Language", row.language),
        line("Introduced by commit", row.origin)));
    }

    if (row.scope === "secrets") {
      body.append(sheetSection("Removed is not rotated",
        sheetRow({
          title: "Two events, two dates",
          note: "Leaving HEAD takes the string out of the current tree. It does not "
            + "invalidate the credential, and it does not remove it from history.",
        }),
        line("Left HEAD", fmtDate(row.removed_at)),
        line("Credential state", row.validation_state ?? "never checked"),
        line("Last checked", fmtDate(row.validated_at)),
        line("Observed dead", fmtDate(row.rotated_at)),
        line("Kind", row.secret_kind),
        line("Confidence", row.confidence),
        line("Introduced by commit", row.origin)));
      if (row.twin_count && row.twin_count > 1) {
        body.append(sheetSection("The twin fold",
          sheetRow({
            title: `${row.twin_count} API rows became this one finding`,
            note: `Wiz indexes one secret against several entities. Their first-seen dates `
              + `disagreed by ${days(row.twin_first_seen_spread_days)}; the earliest was kept.`,
          }),
          line("Source ids", row.source_external_ids)));
      }
    }
  }, { title: row.identifier || row.component || "Finding", subtitle: config.title });
}

/* ------------------------------------------------------------------------- the page */

/** Read the paging/sort state out of the hash so a view is a link someone can send. */
function readView(params) {
  return {
    page: Math.max(0, Number(params.page ?? 0) || 0),
    pageSize: Math.min(500, Math.max(10, Number(params.pageSize ?? 50) || 50)),
    // "severity" ASCENDING, and that is not a typo. The comparator sorts on the rank in
    // SEVERITY_ORDER (registers.ts), where CRITICAL is 0 — so ascending is worst-first,
    // which is the only order a register should open in. Descending would open on LOW.
    sort: params.sort ? String(params.sort) : "severity",
  };
}

function filterDrawer(config, filters, facets, apply) {
  const chips = [];
  const chip = (label, onClear) =>
    el("button", {
      class: "filter-chip", type: "button", onclick: onClear,
      "aria-label": `Clear filter ${label}`,
    }, label, el("span", { class: "filter-chip-x", "aria-hidden": "true" }, "×"));

  if (filters.severities && filters.severities.length) {
    chips.push(chip(`Severity: ${filters.severities.join(", ")}`, () => apply({ severities: null })));
  }
  if (filters.repo) chips.push(chip(`Repo: ${filters.repo}`, () => apply({ repo: null })));
  if (filters.status) chips.push(chip(`State: ${filters.status}`, () => apply({ status: null })));
  if (filters.validation) {
    chips.push(chip(`Credential: ${filters.validation}`, () => apply({ validation: null })));
  }
  if (filters.awaitingVendor) {
    chips.push(chip("Awaiting a vendor", () => apply({ awaitingVendor: null })));
  }

  const group = (label, dimension, order, current, param) => {
    const entries = facetEntries(facets, dimension, order);
    if (!entries.length) return null;
    return el("div", { class: "facet-group" },
      el("h3", { class: "label" }, label),
      el("div", { class: "facet-list" },
        ...entries.map((e) => {
          const on = Array.isArray(current) ? current.includes(e.value) : current === e.value;
          return el("button", {
            class: "facet-item" + (on ? " is-on" : ""),
            type: "button",
            "aria-pressed": on ? "true" : "false",
            onclick: () => {
              if (Array.isArray(current)) {
                const next = on ? current.filter((v) => v !== e.value) : [...current, e.value];
                apply({ [param]: next.length ? next.join(",") : null });
              } else {
                apply({ [param]: on ? null : e.value });
              }
            },
          }, e.value, el("span", { class: "facet-count" }, count(e.count)));
        })));
  };

  const open = () => openSheet((body) => {
    body.append(el("p", { class: "stub-note" },
      "Counts are over the whole register, not over your current selection — a facet that "
      + "shrank as you picked it would be describing the selection rather than the data."));
    body.append(group("Severity", "severity", SEV_ORDER, filters.severities ?? [], "severities"));
    body.append(group("Repository", "repo", null, filters.repo ?? null, "repo"));
    body.append(group("State", "status", null, filters.status ?? null, "status"));
    if (config.facets.includes("validation")) {
      body.append(group("Credential", "validation", null, filters.validation ?? null, "validation"));
    }
    if (config.facets.includes("awaitingVendor")) {
      body.append(sheetSection("Fix availability",
        el("button", {
          class: "facet-item" + (filters.awaitingVendor ? " is-on" : ""),
          type: "button",
          "aria-pressed": filters.awaitingVendor ? "true" : "false",
          onclick: () => apply({ awaitingVendor: filters.awaitingVendor ? null : "1" }),
        }, "Awaiting a vendor only")));
    }
  }, { title: "Filters", subtitle: "Changes apply immediately" });

  const n = activeFilterCount(filters);
  return el("div", { class: "filter-bar" },
    el("button", { class: "filter-trigger", type: "button", onclick: open },
      "Filters",
      n ? el("span", { class: "filter-count" }, String(n)) : null),
    ...chips,
    n ? el("button", { class: "btn-link", type: "button",
      onclick: () => apply({ severities: null, repo: null, status: null, validation: null, awaitingVendor: null }),
    }, "Clear all") : null);
}

function render(host, config, payload, apply) {
  clear(host);
  const fig = headerFigures(payload);
  const params = parseHash().params ?? {};
  const filters = readFilters(params, config);
  const view = readView(params);

  // AN UNMEASURED REGISTER IS NOT A REGISTER OF ZEROES, and the difference has to survive
  // into the rendering. Drawing the hero as "0" over three stat cards reading 0 states four
  // facts about a population nobody has looked at — which is the exact failure the MTTR page
  // and the Executive page already avoid, and which this page had until `?noseed` was pointed
  // at it. Filtering to nothing is a different case and keeps the figures: there the zero IS
  // a measurement.
  if (!fig.scopeTotal) {
    host.append(pageHeader({ hero: heroStat(config.title, "—", config.lede) }));
    host.append(el("section", { class: "card" },
      emptyState(
        "This register has never been measured.",
        "No scan has covered it, so there is nothing here to count — which is not the same "
        + "as having no findings.",
      )));
    host.append(el("section", { class: "card" },
      el("p", { class: "register-caveat" }, config.caveat)));
    return;
  }

  host.append(pageHeader({
    hero: heroStat(
      config.title,
      count(fig.total),
      fig.filtered
        ? el("span", {},
            el("strong", { class: "hero-qualifier" },
              `filtered from ${count(fig.scopeTotal)}`),
            el("br", {}),
            config.lede)
        : config.lede,
    ),
    stats: [
      kpiCard("Open", count(fig.open),
        fig.total ? `${pct((fig.open / fig.total) * 100)} of this view` : "nothing here"),
      kpiCard("Resolved", count(fig.resolved),
        fig.boundedPct === null
          ? "nothing has closed"
          : `${count(fig.bounded)} of them dated by absence (${pct(fig.boundedPct)})`),
      ...(config.facets.includes("awaitingVendor")
        ? [kpiCard("Awaiting a vendor", count(fig.awaitingVendor),
            "open, with no fixed version yet")]
        : []),
    ],
  }));

  host.append(el("section", { class: "card" },
    el("p", { class: "register-caveat" }, config.caveat)));

  const card = el("section", { class: "card" });
  card.append(filterDrawer(config, filters, payload.facets, apply));

  if (!payload.rows.length) {
    card.append(fig.scopeTotal
      ? emptyState("No findings match this filter.", "Clear a filter to widen the view.")
      : emptyState("This register is empty.",
          "Nothing has been synced into it — which is not the same as having no findings."));
    host.append(card);
    return;
  }

  card.append(dataTable({
    stickyHeader: true,
    columns: config.columns.map((col) => ({
      key: col.key,
      label: col.label,
      className: col.kind === "epss" ? "num" : null,
      sortable: col.sortable === true,
      cell: cellFor(col),
    })),
    rows: payload.rows,
    sort: { key: view.sort.replace(/^-/, ""), descending: view.sort.startsWith("-") },
    onSort: (key) => apply({ sort: view.sort === key ? `-${key}` : key, page: null }),
    onRowOpen: (row) => detailSheet(config, row),
    rowLabel: (row) => `${row.identifier ?? ""} ${row.component ?? ""}`.trim(),
  }));

  card.append(tableFooter({
    page: payload.page,
    pageCount: payload.pageCount,
    total: payload.total,
    pageSize: payload.pageSize,
    onPage: (p) => apply({ page: p ? String(p) : null }),
    onPageSize: (size, page) => apply({ pageSize: String(size), page: page ? String(page) : null }),
  }));

  host.append(card);
}

/**
 * Render one register.
 *
 * `swrCall` rather than a bare `call`: the cached payload paints immediately and the fresh
 * one repaints over it, so navigating back to a register you were just on does not blank the
 * table while an RPC runs.
 */
export function renderRegister(host, config) {
  host.append(pageHeader({ hero: heroStat(config.title, "…", config.lede) }));
  host.append(el("section", { class: "card" }, skeletonStack(5)));

  const paint = (payload) => {
    if (payload) render(host, config, payload, apply);
  };

  function apply(patch) {
    setParams(patch);
    load();
  }

  function load() {
    const params = parseHash().params ?? {};
    const filters = readFilters(params, config);
    const view = readView(params);
    swrCall("api_getRegister", {
      scope: config.scope,
      page: view.page,
      pageSize: view.pageSize,
      sort: view.sort,
      severities: (filters.severities ?? []).join(","),
      repo: filters.repo ?? "",
      status: filters.status ?? "",
      validation: filters.validation ?? "",
      awaitingVendor: filters.awaitingVendor ? "1" : "",
    }, paint)
      .then(paint)
      .catch((err) => {
        clear(host);
        host.append(errorState(String(err && err.message ? err.message : err)));
      });
  }

  load();
}
