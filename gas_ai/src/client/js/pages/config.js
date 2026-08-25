// Cloud Configuration: the failing-control register.
//
// Two levels, and the order matters. A configuration finding is one evaluation of one
// rule against one resource, so a single misconfiguration pattern arrives as N
// near-identical rows — in the sample tenant, one Bedrock confused-deputy rule failing on
// sixteen IAM roles with the same name, severity and remediation. Listing those sixteen
// answers "how many rows do I have". Grouping them answers "what is wrong", which is the
// question, and it is also the unit of work: one trust-policy fix pattern closes all
// sixteen. So BY CONTROL is the default view and BY FINDING is the drill-down.
//
// The other thing this page exists to say out loud: most of these findings are not on an
// AI asset at all. They are evaluated against a region, an IAM policy or a service
// account no agent runs as, none of which the AI inventory holds — so they are real
// compliance gaps that appear on no asset's row. The inventory's stat tile can only report
// the number; here it is a column, a filter and a chip.
//
// All view state (mode, filters, sort, page) lives in `view`, outside paint(), and is
// mirrored into the hash — the same discipline combos.js documents, so a background SWR
// revalidation cannot collapse the table you have open.

import { bootstrapCached, setParams, swrCall } from "../store.js";
import { openConfigFindingSheet } from "../detailSheets.js";
import {
  clear, dataTable, debounce, el, emptyState, errorState, fmtDate, heroStat, outcomeBadge,
  pageHeader, statRow,
  pager, plural, sectionLabel, segmented, sevBadge, sevEntries, sevKeyRow, sevSegmentBar,
  skeletonStack, statusPill, togglePills,
  scopeNote,
} from "../ui.js";
import {
  CONFIG_SORTS, CONFIG_SORT_DESC, FLAG_LABELS, LINKAGE_LABELS,
  SEVERITY_ORDER, SEVERITY_RANK, activeConfigFilters, applyConfigFilters, configFacetCounts,
  configScopeLossView, readConfigParams, sortConfigRows,
} from "./configView.js";

import { tipAnchor } from "../ui.js";
const PAGE_SIZE = 50;

/**
 * Worst-first rank. Local rather than ui.js's sevRank, which counts the other way — the
 * two have already been confused once (see the note on assetTable.ts's own sevRank), and
 * a comparator that silently inverts sorts the register best-first with no error.
 */
function sevRank(sev) {
  const r = SEVERITY_RANK[sev];
  return r === undefined ? SEVERITY_RANK.UNKNOWN : r;
}

const FACET_KEYS = [
  "severities", "statuses", "clouds", "resourceTypes", "rules", "projects",
  "linkage", "flags",
];

const FACET_LABELS = {
  severities: "Severity",
  statuses: "Status",
  clouds: "Cloud",
  resourceTypes: "Resource type",
  rules: "Control",
  projects: "Project",
  domains: "Domain",
  linkage: "AI asset",
  flags: "Signals",
};

function optionLabel(key, value) {
  if (key === "flags") return FLAG_LABELS[value] || value;
  if (key === "linkage") return LINKAGE_LABELS[value] || value;
  return value;
}

export async function renderConfigFindings(main, params, ctx) {
  const view = {
    mode: params.mode === "findings" ? "findings" : "controls",
    query: readConfigParams(params),
    sort: CONFIG_SORTS.indexOf(params.sort) >= 0 ? params.sort : "severity",
    descending: params.dir ? params.dir === "desc" : CONFIG_SORT_DESC.severity,
    page: Math.max(0, Number(params.page) || 0),
  };

  main.append(
    el("h1", {}, "Cloud Configuration"),
    el("p", { class: "page-sub" },
      "Wiz configuration findings for the AI security framework — what is failing, " +
      "grouped by the control that failed."),
  );

  const headHost = el("div", {});
  const bodyHost = el("div", {});
  main.append(headHost, bodyHost);

  headHost.append(skeletonStack(3, { height: "62px" }));
  bodyHost.append(skeletonStack(6, { height: "34px" }));

  let data;
  try {
    data = await swrCall("api_getConfigFindings", {}, (fresh) => {
      data = fresh;
      paint();
    });
  } catch (e) {
    clear(headHost);
    clear(bodyHost).append(errorState("Couldn't load configuration findings.", {
      detail: e && e.message ? e.message : e,
      onRetry: () => ctx.refresh(),
    }));
    return;
  }

  paint();

  /** Mirror the whole view into the hash, so any state here is a shareable link. */
  function pushParams(patch) {
    setParams(Object.assign({
      mode: view.mode === "controls" ? null : view.mode,
      q: view.query.q || null,
      severities: view.query.severities.join(",") || null,
      statuses: view.query.statuses.join(",") || null,
      clouds: view.query.clouds.join(",") || null,
      resourceTypes: view.query.resourceTypes.join(",") || null,
      rules: view.query.rules.join(",") || null,
      projects: view.query.projects.join(",") || null,
      domains: view.query.domains.join(",") || null,
      linkage: view.query.linkage.join(",") || null,
      flags: view.query.flags.join(",") || null,
      sort: view.sort === "severity" ? null : view.sort,
      dir: view.descending === CONFIG_SORT_DESC[view.sort] ? null : (view.descending ? "desc" : "asc"),
      page: view.page ? String(view.page) : null,
    }, patch || {}));
  }

  function toggleFacet(key, value) {
    const list = view.query[key];
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
    view.page = 0;
    pushParams();
    paint();
  }

  function paint() {
    if (!data) return;
    const rows = data.rows || [];
    const totals = data.totals || {};

    // ------------------------------------------------------------------ the header
    clear(headHost);

    // Failing controls is the headline, not the row count: a resolved finding is stored
    // for its lifecycle date and must not read as outstanding risk.
    // The comment above already said which of these four is the headline; it just was not
    // drawn as one. Four equal tiles is the hero-metric template PRODUCT.md rejects, so the
    // headline becomes the hero and the other three become the strip beneath it.
    const headerStats = [
      statRow("Resources affected", String(totals.resources ?? 0),
        "evaluated against these rules"),
      statRow("Not on an AI asset", String(totals.unlinkedGaps ?? 0),
        "regions, policies and unattached identities", null,
        ["A configuration finding is keyed to the resource it was evaluated against, and most "
          + "AI-security rules fail on a region, an IAM policy or a service account no agent "
          + "runs as. None of those are AI assets, so none of them appear on an asset's row."]),
      statRow("Traced to IaC", String(totals.iac ?? 0), "fixable at source"),
    ];

    // The strip is also the page's severity filter — its keys are toggle buttons, the
    // same affordance the inventory header uses, so the bar is not a picture you have to
    // read a separate control to act on.
    const mix = sevEntries(totals.severityMix || {}, SEVERITY_ORDER);
    // The strip qualifies the headline, so it belongs in the header's second column rather
    // than in a card of its own below it. It stays the page's severity filter either way.
    let strip = null;
    if (mix.length) {
      const selected = new Set(view.query.severities);
      strip = el("div", { class: "page-strip" },
        el("div", { class: "kpi-label" }, "By severity"),
        sevSegmentBar(mix, { size: "md", label: "Failing controls by severity", selected }),
        sevKeyRow(mix, {
          variant: "toggle",
          ariaLabel: "Filter by severity",
          isOn: (sev) => selected.has(sev),
          describe: (e) => e.sev + ", " + plural(e.count, "failing control"),
          onToggle: (sev) => toggleFacet("severities", sev),
        }));
    }
    headHost.append(pageHeader({
      hero: heroStat("Failing controls", String(totals.gaps ?? 0),
        plural(totals.controls ?? 0, "distinct control")),
      aside: strip,
      stats: headerStats,
    }));

    // What the scope costs this register. Printed with the figures rather than as a footnote,
    // which is the discipline registerWideNote already states: a footnote is read after the
    // reader has decided, and the decision here is whether a short list means a clean
    // landscape. Null and absent when nothing is scoped away.
    const loss = configScopeLossView(data.scopeLoss, (bootstrapCached() || {}).scope);
    if (loss) headHost.append(scopeNote(loss));

    headHost.append(el("div", {
      class: "toolbar",
      style: "margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center",
    },
      segmented({
        options: [
          { value: "controls", label: "By control" },
          { value: "findings", label: "By finding" },
        ],
        value: view.mode,
        ariaLabel: "Register view",
        onChange: (v) => {
          view.mode = v;
          view.page = 0;
          pushParams();
          paint();
        },
      }),
      el("input", {
        type: "search",
        class: "input",
        value: view.query.q,
        placeholder: "Search rule, resource, subscription…",
        "aria-label": "Search configuration findings",
        oninput: debounce((e) => {
          view.query.q = String(e.target.value || "").trim().toLowerCase();
          view.page = 0;
          pushParams();
          paint();
        }, 200),
      }),
    ));

    // ------------------------------------------------------------------- the facets
    const filtered = applyConfigFilters(rows, view.query);
    const counts = configFacetCounts(rows, view.query, FACET_KEYS);
    // Not a card. A row of filters is chrome, and DESIGN.md is explicit that a card is for
    // content that is genuinely distinct and actionable, not a container to put things in.
    const facetHost = el("div", { class: "config-facets" });
    for (const key of ["linkage", "flags", "statuses", "clouds", "resourceTypes"]) {
      const options = (counts[key] || []).filter((o) => o.count > 0 || view.query[key].indexOf(o.value) >= 0);
      if (options.length < 2) continue;
      // NOT .facet-row. That class belongs to the filter drawer (sheet.css) and is a FOUR
      // COLUMN GRID — `14px 1fr 44px auto` — sized for a checkbox, a label, a count and a
      // chevron. Borrowing the name here dropped this label into the 14px checkbox column,
      // which is why "AI asset" was rendering as "Al as". One class name, two layouts.
      facetHost.append(el("div", { class: "config-facet" },
        el("span", { class: "config-facet-name" }, FACET_LABELS[key]),
        togglePills({
          options: options.map((o) => ({
            value: o.value,
            // The count is what makes narrowing a decision rather than a guess.
            label: optionLabel(key, o.value) + " · " + o.count,
          })),
          selected: view.query[key],
          sevClass: key === "severities",
          ariaLabel: FACET_LABELS[key],
          onToggle: (v) => toggleFacet(key, v),
        })));
    }
    if (facetHost.childNodes.length) headHost.append(facetHost);

    const applied = activeConfigFilters(view.query);
    if (applied.length) {
      headHost.append(el("div", { style: "margin-top:10px" },
        el("button", {
          class: "sheet-tool",
          onclick: () => {
            view.query = readConfigParams({});
            view.page = 0;
            pushParams();
            paint();
          },
        }, "Clear " + plural(applied.length, "filter"))));
    }

    // --------------------------------------------------------------------- the body
    clear(bodyHost);
    if (!rows.length) {
      bodyHost.append(emptyState(
        "No configuration findings in the register.",
        "The last sync returned none, or the CONFIG_FINDINGS step was skipped by the tenant.",
      ));
      return;
    }
    if (view.mode === "controls") paintControls(filtered);
    else paintFindings(filtered);
  }

  /**
   * One row per control. The rollup arrives from the server computed over the WHOLE
   * register, but the filters are client-side, so a filtered view regroups the rows it
   * still has rather than showing counts the table no longer contains.
   */
  function paintControls(rows) {
    const byRule = new Map();
    for (const row of rows) {
      const key = row.ruleShortId || row.ruleName || "—";
      const bucket = byRule.get(key);
      if (bucket) bucket.push(row);
      else byRule.set(key, [row]);
    }
    const groups = Array.from(byRule, ([ruleShortId, group]) => {
      // All three are DISTINCT-resource counts, so the table's numbers are commensurable:
      // gapResources of resources are failing, and unlinkedGapResources of those are not
      // AI assets. Counting failures in findings against a denominator in resources would
      // read as a ratio between two different units.
      const resources = new Set();
      const gapResources = new Set();
      const unlinkedGapResources = new Set();
      // Mirrors ControlRollup.domains in src/domain/configFindings.ts — under
      // CONFIG_CLIENT_ALL_MAX this loop is the ONLY rollup that runs, so a field added
      // there and not here is a column that reads empty on every small tenant.
      const domains = new Set();
      let worst = "UNKNOWN";
      let iac = 0;
      let firstSeenAt = "";
      const mix = {};
      for (const r of group) {
        resources.add(r.resourceId);
        mix[r.severity] = (mix[r.severity] || 0) + 1;
        if (sevRank(r.severity) < sevRank(worst)) worst = r.severity;
        if (r.gap) {
          gapResources.add(r.resourceId);
          if (!r.linked) unlinkedGapResources.add(r.resourceId);
        }
        if (r.domain) domains.add(r.domain);
        if (r.iac) iac += 1;
        if (r.firstSeenAt && (!firstSeenAt || r.firstSeenAt < firstSeenAt)) {
          firstSeenAt = r.firstSeenAt;
        }
      }
      return {
        ruleShortId,
        ruleName: group[0].ruleName || group[0].name || "",
        severity: worst,
        findings: group.length,
        gaps: gapResources.size,
        resources: resources.size,
        unlinked: unlinkedGapResources.size,
        domains: Array.from(domains).sort(),
        iac,
        firstSeenAt,
        mix,
        rows: group,
      };
    }).sort((a, b) =>
      sevRank(a.severity) - sevRank(b.severity)
      || b.gaps - a.gaps
      || b.resources - a.resources
      || String(a.ruleShortId).localeCompare(String(b.ruleShortId)));

    bodyHost.append(sectionLabel(plural(groups.length, "control") + " with findings"));
    bodyHost.append(dataTable({
      columns: [
        {
          key: "severity", label: "Severity", sortable: false,
          cell: (g) => sevBadge(g.severity),
        },
        {
          key: "rule", label: "Control", sortable: false,
          cell: (g) => el("div", {},
            el("div", {}, g.ruleName || g.ruleShortId),
            el("div", { class: "small muted" }, g.ruleShortId)),
        },
        {
          key: "gaps", label: "Failing", sortable: false, className: "num",
          cell: (g) => {
            const said = g.gaps + " of " + plural(g.resources, "resource") + " currently failing";
            return tipAnchor(
              el("span", {}, String(g.gaps), el("span", { class: "sr-only" }, ", " + said)),
              said);
          },
        },
        {
          key: "resources", label: "Resources", sortable: false, className: "num",
          cell: (g) => String(g.resources),
        },
        {
          key: "unlinked", label: "Off-inventory", sortable: false, className: "num",
          // Not a warning — a fact about where the control applies. It is the reason the
          // register's gap total and the inventory's per-asset counts differ.
          cell: (g) => (g.unlinked
            ? tipAnchor(
              el("span", {}, String(g.unlinked),
                el("span", { class: "sr-only" }, ", not on an AI asset")),
              g.unlinked + " not on an AI asset")
            : el("span", { class: "muted" }, "—")),
        },
        {
          // Which domains one fix would touch. The by-control view's argument is that N
          // near-identical rows are one piece of work; this says how many owners that work
          // needs. Empty for an all-unlinked control, which is most of them here.
          key: "domains", label: "Domain", sortable: false,
          cell: (g) => ((g.domains || []).length
            ? el("span", {}, g.domains.join(", "))
            : el("span", { class: "muted" }, "—")),
        },
        {
          key: "since", label: "Oldest", sortable: false,
          cell: (g) => (g.firstSeenAt
            ? el("span", { class: "small" }, fmtDate(g.firstSeenAt))
            : el("span", { class: "small muted" }, "—")),
        },
        {
          key: "iac", label: "IaC", sortable: false,
          cell: (g) => (g.iac ? statusPill("neutral", String(g.iac)) : el("span", { class: "muted" }, "—")),
        },
      ],
      rows: groups,
      rowLabel: (g) => (g.ruleName || g.ruleShortId) + ", " + g.severity + ", "
        + plural(g.resources, "resource"),
      onRowOpen: (g) => {
        // Opening a control filters the finding list to it — the drill-down IS the
        // by-finding view, so there is one table to learn rather than two.
        view.mode = "findings";
        view.query.rules = [g.ruleShortId];
        view.page = 0;
        pushParams();
        paint();
      },
      emptyText: "No controls match these filters.",
    }));
  }

  function paintFindings(rows) {
    const sorted = sortConfigRows(rows, view.sort, view.descending);
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const page = Math.min(view.page, pageCount - 1);
    const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const ids = sorted.map((r) => r.id);

    bodyHost.append(sectionLabel(plural(sorted.length, "finding")));
    const table = dataTable({
      columns: [
        { key: "severity", label: "Severity", sortable: true, cell: (r) => sevBadge(r.severity) },
        {
          key: "rule", label: "Control", sortable: true,
          cell: (r) => el("div", {},
            el("div", {}, r.ruleName || r.name),
            el("div", { class: "small muted" }, r.ruleShortId)),
        },
        {
          key: "resource", label: "Resource", sortable: true,
          cell: (r) => el("div", {},
            el("div", {}, r.resourceName || r.resourceId),
            el("div", { class: "small muted" }, r.resourceType)),
        },
        {
          key: "domain", label: "Domain", sortable: false,
          // Blank for an unlinked finding, and it reads as the same em dash every other
          // absent cell uses. The AI asset column beside it says WHY.
          cell: (r) => (r.domain
            ? el("span", {}, r.domain)
            : el("span", { class: "small muted" }, "—")),
        },
        {
          key: "linked", label: "AI asset", sortable: false,
          cell: (r) => (r.linked
            ? statusPill("neutral", "On inventory")
            : el("span", { class: "small muted" }, "—")),
        },
        {
          key: "status", label: "Status", sortable: true,
          cell: (r) => (r.gap
            ? statusPill("bad", "Failing")
            : statusPill("neutral", r.status || "—")),
        },
        {
          key: "firstSeen", label: "First seen", sortable: true,
          cell: (r) => (r.firstSeenAt
            ? el("span", { class: "small" }, fmtDate(r.firstSeenAt))
            : el("span", { class: "small muted" }, "—")),
        },
      ],
      rows: slice,
      sort: { key: view.sort, descending: view.descending },
      onSort: (key) => {
        if (view.sort === key) view.descending = !view.descending;
        else {
          view.sort = key;
          view.descending = CONFIG_SORT_DESC[key];
        }
        view.page = 0;
        pushParams();
        paint();
      },
      rowLabel: (r) => (r.ruleName || r.name) + " on " + (r.resourceName || r.resourceId)
        + ", " + r.severity,
      onRowOpen: (r) => openConfigFindingSheet(r.id, {
        seed: r,
        records: { ids, index: ids.indexOf(r.id) },
      }),
      emptyText: "No findings match these filters.",
    });
    bodyHost.append(table);
    bodyHost.append(pager(page, pageCount, sorted.length, (p) => {
      view.page = p;
      pushParams();
      paint();
    }));
  }
}
