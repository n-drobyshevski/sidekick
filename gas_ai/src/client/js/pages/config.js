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
  absent, clear, dataTable, debounce, el, emptyState, errorState, fmtDate, heroStat, outcomeBadge,
  pageHeader, statRow,
  pager, plural, sectionLabel, segmented, sevBadge, sevEntries, sevKeyRow, sevSegmentBar,
  skeletonStack, statusPill, togglePills,
  scopeNote,
} from "../ui.js";
import {
  CONFIG_SORTS, CONFIG_SORT_DESC, FLAG_LABELS, LINKAGE_LABELS,
  SEVERITY_ORDER, activeConfigFilters,
  configPageView, configQueryParams, configScopeLossView, readConfigParams,
} from "./configView.js";

import { tipAnchor } from "../ui.js";
const PAGE_SIZE = 50;

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
  let model;

  /**
   * Fetch for the CURRENT view state.
   *
   * The params ride on every call, including the first, because the page cannot know which
   * mode it is in until the answer arrives — and a deep link into a filtered, sorted, paged
   * view has to resolve to those rows on a large tenant. Under CONFIG_CLIENT_ALL_MAX the
   * server ignores all of them and ships the register whole, so a small tenant still makes
   * exactly one call and every affordance after it is local; `model.refetches` is what says
   * which of the two happened.
   */
  async function load() {
    data = await swrCall("api_getConfigFindings", configQueryParams(view, PAGE_SIZE), (fresh) => {
      // The background revalidation. It repaints on its own, so the caller's paint below is
      // for the awaited answer only.
      data = fresh;
      paint();
    });
  }

  /** Act on a filter/sort/page change: a repaint when the browser holds the register. */
  function apply() {
    if (model && model.refetches) refetch();
    else paint();
  }

  async function refetch() {
    clear(bodyHost).append(skeletonStack(6, { height: "34px" }));
    try {
      await load();
      paint();
    } catch (e) {
      clear(bodyHost).append(errorState("Couldn't load configuration findings.", {
        detail: e && e.message ? e.message : e,
        onRetry: () => refetch(),
      }));
    }
  }

  try {
    await load();
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
    apply();
  }

  function paint() {
    if (!data) return;
    // The payload's own `all` discriminator, read at last. Everything below asks `model`
    // rather than the row array: past CONFIG_CLIENT_ALL_MAX `data.rows` is ONE PAGE, and
    // counting it is how this page came to label a body of fifty under a header describing
    // thousands. See configPageView.
    model = configPageView(data, view, PAGE_SIZE);
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
          // `apply`, not `paint`: both views are served by the same payload, but this resets
          // the page, and on the paged branch page 0 is a different fifty rows.
          view.page = 0;
          pushParams();
          apply();
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
          apply();
        }, 200),
      }),
    ));

    // ------------------------------------------------------------------- the facets
    // Counted over the WHOLE register in both modes — locally when the browser holds it,
    // by the server when it does not. A count taken over one page would tell a reader that
    // narrowing to a cloud leaves four findings when it leaves four hundred.
    const counts = model.facetCounts;
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
            apply();
          },
        }, "Clear " + plural(applied.length, "filter"))));
    }

    // --------------------------------------------------------------------- the body
    clear(bodyHost);
    // `model.total` is the REGISTER, never the page. On the paged branch `data.rows` is empty
    // whenever the filter matches nothing on this page, and answering that with "no findings
    // in the register" would report an empty tenant to someone holding thousands.
    if (!model.total) {
      bodyHost.append(emptyState(
        "No configuration findings in the register.",
        "The last sync returned none, or the CONFIG_FINDINGS step was skipped by the tenant.",
      ));
      return;
    }
    if (view.mode === "controls") paintControls();
    else paintFindings();
  }

  /**
   * One row per control.
   *
   * The grouping runs where the rows are. Under CONFIG_CLIENT_ALL_MAX the browser holds the
   * whole register, so a filtered view regroups what it still has rather than showing counts
   * the table below no longer contains; past it the server rolls up the FILTERED set and
   * ships that. `configPageView` picks, and both arrive in one shape — which matters because
   * the server's own ControlRollup uses `gaps` for failing FINDINGS where this table means
   * failing RESOURCES. See adoptControlRollups.
   */
  function paintControls() {
    const groups = model.controls;
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
            : absent()),
        },
        {
          // Which domains one fix would touch. The by-control view's argument is that N
          // near-identical rows are one piece of work; this says how many owners that work
          // needs. Empty for an all-unlinked control, which is most of them here.
          key: "domains", label: "Domain", sortable: false,
          cell: (g) => ((g.domains || []).length
            ? el("span", {}, g.domains.join(", "))
            : absent()),
        },
        {
          key: "since", label: "Oldest", sortable: false,
          cell: (g) => (g.firstSeenAt
            ? el("span", { class: "small" }, fmtDate(g.firstSeenAt))
            : el("span", { class: "small muted" }, "—")),
        },
        {
          key: "iac", label: "IaC", sortable: false,
          cell: (g) => (g.iac ? statusPill("neutral", String(g.iac)) : absent()),
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
        apply();
      },
      emptyText: "No controls match these filters.",
    }));
  }

  /**
   * The flat list.
   *
   * `model.filtered` is the count the label states and the pager totals, and it is the whole
   * point of this pass: it is the FILTERED REGISTER in both modes — every matching row when
   * the browser holds them, the server's own count of matching rows when it does not. It
   * used to be `sorted.length`, which past CONFIG_CLIENT_ALL_MAX is the length of one page,
   * so the page said "50 findings" and offered a pager ending at 1 while the header above it
   * counted thousands.
   *
   * `ids` seeds the drill-down's prev/next, and on the paged branch it is honestly one page
   * long — the sheet steps through the rows the browser has, which is what it has always
   * done.
   */
  function paintFindings() {
    const sorted = model.sorted;
    const slice = model.slice;
    const page = model.page;
    const pageCount = model.pageCount;
    const ids = sorted.map((r) => r.id);

    bodyHost.append(sectionLabel(plural(model.filtered, "finding")));
    const table = dataTable({
      stickyHeader: true,
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
        // The sort is the server's on the paged branch — sorting fifty rows inside an order
        // the other pages do not share is the thing this page used to do.
        apply();
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
    bodyHost.append(pager(page, pageCount, model.filtered, (p) => {
      view.page = p;
      pushParams();
      apply();
    }));
  }
}
