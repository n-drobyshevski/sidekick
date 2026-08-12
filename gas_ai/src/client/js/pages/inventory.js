// AI Inventory: KPI cards, AARS-severity distribution chart, and the sortable, paged asset
// table. Row click opens the shared asset sheet; "Open in graph" deep-links.
//
// The page never holds the whole estate unless it's cheap to. api_getAssets answers with
// every row (`all: true`) only while the inventory fits under the server's row ceiling —
// then the filter bar, the sort and the pager all run in the browser with no further RPCs,
// which is what a Google Apps Script round trip per keystroke deserves. Past the ceiling
// it answers one page at a time and the same controls become server round trips: search is
// debounced harder, a filter change resets to page 1, and each page is fetched on demand.
//
// Either way the KPI row, the severity chart and the filter options describe the WHOLE
// inventory, not the page and not the filtered subset — the server aggregates them once
// per sync, so they stay honest when the client is holding 50 rows out of 5,000.

import { bootstrap, navigate, setParams, swrCall } from "../store.js";
import { openAssetSheet } from "../detailSheets.js";
import { categoryBar, trendLine } from "../charts.js";
import { kindLabel } from "../icons.js";
import {
  aarsChip, clear, el, emptyState, fmtDate, kpiCard, pager, sectionLabel, sevBadge, skeleton,
} from "../ui.js";

// Synchronous placeholder shown until api_getAssets resolves — mirrors the KPI row, the
// distribution chart and the table so the boot splash reveals a laid-out page (not a blank
// pane), and later navigations show structure under the route-overlay veil. paint() clears
// the host and swaps in the real content.
function inventorySkeleton() {
  const kpis = el("div", { class: "kpi-row" });
  // One placeholder per real KPI (see the kpi-row in paint()). The row is an auto-fit
  // grid, so the count IS the layout: fewer stubs than cards and each stub stretches,
  // then the row reflows the moment data lands. Keep the two in step.
  for (let i = 0; i < 8; i++) {
    kpis.append(el("div", { class: "kpi-card" },
      el("div", { style: "display:flex; flex-direction:column; gap:9px" },
        skeleton("line", { width: "62%" }),
        skeleton("stat", { width: "45%" }),
        skeleton("line", { width: "78%" }))));
  }
  const chart = el("div", { class: "chart-card", style: "margin-bottom:20px" },
    skeleton("line", { width: "180px" }),
    el("div", { class: "chart-box", style: "height:200px; position:relative; margin-top:10px" },
      skeleton("chart")));
  const rows = el("div", { style: "display:flex; flex-direction:column; gap:12px" });
  for (let i = 0; i < 6; i++) rows.append(skeleton("line", { height: "18px" }));
  return el("div", { role: "status", "aria-label": "Loading inventory" }, kpis, chart, rows);
}

// Keep in sync with ASSET_COMPARATORS / PAGE_SIZES in src/domain/assetTable.ts, which the
// server uses for the paged path (the client bundle can't import the TS module). The two
// must agree or a filtered deep link would show a different page depending on the size of
// the tenant it was opened against.
const SORTS = {
  aars: (a, b) => Number(b.aars ?? -1) - Number(a.aars ?? -1),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
  kind: (a, b) => String(a.kind).localeCompare(String(b.kind)) || SORTS.aars(a, b),
  cloud: (a, b) => String(a.cloud ?? "").localeCompare(String(b.cloud ?? "")) || SORTS.aars(a, b),
};
// Mirrors normalizeAarsSeverity in src/domain/config.ts — MINIMAL was the old name for
// the bottom of the AARS scale, so a link saved before the rename still resolves.
const AARS_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
function normalizeAarsSeverity(v) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "MINIMAL") return "INFO";
  return AARS_SEVERITIES.indexOf(s) >= 0 ? s : "";
}

// The AARS levels the charts draw. Mirrors TREND_SEVERITIES in src/domain/aarsTrend.ts
// (the client bundle can't import the TS module) — INFO is recorded but never charted.
const CHARTED_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** How many assets the charts leave out, so the totals never look like they disagree. */
function infoNote(counts) {
  const info = Number((counts || {}).INFO || 0);
  return info ? `${info} INFO asset${info === 1 ? "" : "s"} excluded` : "no INFO assets";
}

const PAGE_SIZES = [25, 50, 100, 250];
const DEFAULT_PAGE_SIZE = 50;

export async function renderInventory(main, params) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "AI Inventory"),
    el("p", { class: "page-sub" },
      "Every AI asset and its supporting identity/data surface from the last sync, " +
      "scored with the AI Asset Risk Score (AARS)."),
  );

  if (!boot.latestSync) {
    main.append(emptyState(
      "No sync yet.",
      "Run “Sync now” in the sidebar — without credentials it loads the sample dataset.",
    ));
    return;
  }

  const host = el("div", {});
  main.append(host);
  host.append(inventorySkeleton()); // replaced by paint() once api_getAssets resolves

  // Filter, sort and page state lives here (outside paint) so it survives SWR repaints;
  // it's seeded from the URL so a filtered page is shareable/reloadable.
  const filters = {
    q: params.q || "", kind: params.kind || "",
    // `band` is the pre-rename param, still read so shared links keep working.
    cloud: params.cloud || "",
    aarsSeverity: normalizeAarsSeverity(params.aarsSeverity || params.band),
  };
  let sortKey = SORTS[params.sort] ? params.sort : "aars";
  let pageSize = PAGE_SIZES.indexOf(Number(params.size)) >= 0
    ? Number(params.size) : DEFAULT_PAGE_SIZE;
  let page = Math.max(0, (Number(params.page) || 1) - 1); // 1-based in the URL, 0-based here

  // Every fetch takes a ticket. A response — including a background SWR revalidation of an
  // older request — is dropped unless it's still the newest, so a slow page 2 can't land
  // on top of the page 3 the user has already asked for.
  let ticket = 0;

  function requestParams() {
    return {
      all: true, // the server downgrades this to one page when the estate is too big
      q: filters.q, kind: filters.kind, cloud: filters.cloud,
      aarsSeverity: filters.aarsSeverity,
      sort: sortKey, page, pageSize,
    };
  }

  const firstTicket = ++ticket;
  let data;
  try {
    data = await swrCall("api_getAssets", requestParams(), (fresh) => {
      // A revalidation that landed before any interaction: the data itself changed, so
      // repaint the aggregates too.
      if (ticket === firstTicket) paint(fresh);
    });
  } catch (e) {
    clear(host).append(emptyState("Couldn't load the inventory.", String(e.message || e)));
    return;
  }
  paint(data);

  function paint(payload) {
    clear(host);
    const { kpis } = payload;
    // `all` absent means an old server; treating that as all-mode keeps the page working
    // against a deployment whose client bundle is newer than its server bundle.
    const allMode = payload.all !== false;

    // Band captions come from the AARS rule in force, so tuning a threshold on the AARS
    // Rules page renames these cards instead of leaving them quoting the old model.
    const bandLabel = (sev) => {
      const found = (boot.aarsRule?.bandRanges || []).find((b) => b.severity === sev);
      return found ? found.label : "";
    };

    if (boot.aarsRule?.stale) {
      host.append(
        el("div", { class: "notice warn", role: "status" },
          el("span", {}, "The AARS rule has changed since these scores were computed. " +
            "Recompute them on the AARS Rules page."),
          el("a", { class: "link", href: "#/aars", target: "_self" }, "Open AARS Rules")),
      );
    }
    host.append(
      el("div", { class: "kpi-row" },
        kpiCard("AI assets", String(kpis.aiAssets), `${kpis.agents} agents`),
        kpiCard("Critical AARS", String(kpis.criticalAars), bandLabel("CRITICAL")),
        kpiCard("High AARS", String(kpis.highAars), bandLabel("HIGH")),
        kpiCard("Guardrail coverage",
          kpis.guardrailCoveragePct === null ? "—" : `${kpis.guardrailCoveragePct}%`,
          "agents protected by a guardrail"),
        kpiCard("Sensitive data access", String(kpis.sensitiveAccess), "AI assets"),
        kpiCard("Open issues", String(kpis.openIssues), "toxic-combination instances"),
        kpiCard("Compliance gaps", String(kpis.complianceGaps ?? 0), "failing config findings"),
        kpiCard("Agentic identities", String(kpis.agenticIdentities ?? 0), "AGENTIC service accounts / keys"),
      ),
    );

    // Both charts describe the WHOLE inventory (counted server-side), whatever the table
    // below is currently showing, and both plot CHARTED_SEVERITIES only — INFO is "no
    // action required" and is the biggest bucket in a healthy estate, so charting it
    // flattens the levels worth watching. The KPI row still counts everything, so the
    // exclusion is stated on each card rather than left for someone to work out.
    const aarsCounts = payload.aarsSeverityCounts || {};
    // The AARS scale shares the severity values, so it shares their colors directly.
    const colorOf = (sev) => (boot.palette?.colors || {})[sev];
    const aarsColors = {};
    for (const sev of CHARTED_SEVERITIES) aarsColors[sev] = colorOf(sev);

    const distCanvas = el("canvas", {
      "aria-label": "Assets by AARS severity, excluding INFO", role: "img",
    });
    const distCard = el("div", { class: "chart-card" },
      el("h3", {}, "Assets by AARS severity"),
      el("p", { class: "chart-note" }, `INFO (${bandLabel("INFO")}) not charted · ${infoNote(aarsCounts)}`),
      el("div", { class: "chart-box", style: "height:200px" }, distCanvas),
    );

    // The trend is recorded one point per sync and cannot be backfilled, so a fresh or
    // just-upgraded ledger has too few points to draw a line — say that plainly instead
    // of rendering an empty axis that reads like a loading failure.
    const trend = payload.aarsTrend || [];
    const trendCanvas = el("canvas", {
      "aria-label": "AARS severity over time, one line per level, excluding INFO", role: "img",
    });
    // Points scored under different AARS rules are not on the same scale. Rather than let
    // a threshold edit read as the estate moving, the note names the breaks.
    const ruleChanges = payload.aarsTrendRuleChanges || [];
    const trendCard = el("div", { class: "chart-card" },
      el("h3", {}, "AARS severity over time"),
      el("p", { class: "chart-note" },
        trend.length >= 2
          ? `${trend.length} sync${trend.length === 1 ? "" : "s"} · INFO not charted`
          : "One point per sync"),
      trend.length >= 2
        ? el("div", { class: "chart-box", style: "height:200px" }, trendCanvas)
        : el("div", { class: "chart-empty", role: "status" },
            trend.length === 1
              ? "One sync recorded so far — the trend draws from the second."
              : "No history yet. Each sync adds a point; earlier syncs can't be recovered."),
      trend.length >= 2 && ruleChanges.length
        ? el("p", { class: "chart-note warn" },
            `The scoring rule changed ${ruleChanges.length} time` +
            `${ruleChanges.length === 1 ? "" : "s"} in this window ` +
            `(${ruleChanges.map((i) => fmtDate(trend[i].at)).join(", ")}). ` +
            "Points either side of a change were scored by different models.")
        : null,
    );

    host.append(el("div", { class: "chart-row" }, distCard, trendCard));
    requestAnimationFrame(() => {
      categoryBar(distCanvas, CHARTED_SEVERITIES, aarsCounts, aarsColors);
      if (trend.length >= 2) {
        trendLine(trendCanvas, trend.map((pt) => ({ x: pt.at })), {
          yLabel: "assets",
          series: CHARTED_SEVERITIES.map((sev) => ({
            label: sev,
            color: colorOf(sev),
            data: trend.map((pt) => (pt.counts || {})[sev] ?? 0),
          })),
        });
      }
    });

    // ---- Filter bar: name search + kind/cloud/AARS-severity selects. The options come from
    // the server's facets (the full inventory), never from the rows in hand — a select
    // built from one page would hide the values that page happens to miss.
    const facets = payload.facets || { kinds: [], clouds: [], aarsSeverities: [] };

    const searchInput = el("input", {
      type: "search",
      "aria-label": "Search assets by name",
      placeholder: "Search name…",
      value: filters.q,
    });
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      // Local filtering can keep up with typing; a server round trip per keystroke can't.
      searchTimer = setTimeout(() => {
        filters.q = searchInput.value;
        onFilterChange();
      }, allMode ? 150 : 400);
    });
    const searchField = el("div", { class: "workbench-search" }, searchInput);

    // A seeded value that no longer exists as an option (stale/hand-edited link, or
    // a facet value gone after a re-sync) is dropped, so the control can't show
    // "All …" while silently filtering to a confusing subset.
    const kinds = facets.kinds || [];
    if (filters.kind && kinds.indexOf(filters.kind) < 0) filters.kind = "";
    const kindSel = el("select", { "aria-label": "Filter by kind" },
      el("option", { value: "" }, "All kinds"),
      ...kinds.map((k) => el("option", { value: k }, kindLabel(k))),
    );
    kindSel.value = filters.kind;
    kindSel.addEventListener("change", () => {
      filters.kind = kindSel.value;
      onFilterChange();
    });

    const clouds = facets.clouds || [];
    if (filters.cloud && clouds.indexOf(filters.cloud) < 0) filters.cloud = "";
    const cloudSel = el("select", { "aria-label": "Filter by cloud" },
      el("option", { value: "" }, "All clouds"),
      ...clouds.map((c) => el("option", { value: c }, c)),
    );
    cloudSel.value = filters.cloud;
    cloudSel.addEventListener("change", () => {
      filters.cloud = cloudSel.value;
      onFilterChange();
    });

    const aarsSeverities = facets.aarsSeverities || [];
    if (filters.aarsSeverity && aarsSeverities.indexOf(filters.aarsSeverity) < 0) {
      filters.aarsSeverity = "";
    }
    const aarsSel = el("select", { "aria-label": "Filter by AARS severity" },
      el("option", { value: "" }, "All AARS severities"),
      ...aarsSeverities.map((sev) => el("option", { value: sev }, sev)),
    );
    aarsSel.value = filters.aarsSeverity;
    aarsSel.addEventListener("change", () => {
      filters.aarsSeverity = aarsSel.value;
      onFilterChange();
    });

    // role=status so the result count is announced when a filter changes the table.
    const countText = el("span", { class: "count", role: "status" });
    const clearBtn = el("button", {
      class: "link",
      onclick: () => {
        filters.q = ""; filters.kind = ""; filters.cloud = ""; filters.aarsSeverity = "";
        searchInput.value = "";
        kindSel.value = "";
        cloudSel.value = "";
        aarsSel.value = "";
        onFilterChange();
      },
    }, "Clear");
    const filterMeta = el("div", { class: "filter-meta" }, countText, clearBtn);

    host.append(
      el("div", { class: "filter-bar" }, searchField, kindSel, cloudSel, aarsSel, filterMeta),
    );

    const tableHost = el("div", { class: "table-host" });
    host.append(tableHost);

    function persistParams() {
      setParams({
        sort: sortKey, q: filters.q, kind: filters.kind, cloud: filters.cloud,
        aarsSeverity: filters.aarsSeverity,
        band: "", // clear the pre-rename param if the link carried one
        page: page ? page + 1 : "",
        size: pageSize === DEFAULT_PAGE_SIZE ? "" : pageSize,
      });
    }

    function onFilterChange() {
      page = 0; // a narrower set makes the old page number meaningless
      persistParams();
      if (allMode) renderTable(payload);
      else reload(null);
    }

    /** Server-mode page/filter change: refetch, keeping the rest of the page in place. */
    function reload(navFocus) {
      const mine = ++ticket;
      tableHost.setAttribute("aria-busy", "true");
      const settle = (fresh) => {
        if (mine !== ticket) return; // superseded while in flight
        tableHost.removeAttribute("aria-busy");
        renderTable(fresh);
        restoreNav(navFocus);
      };
      swrCall("api_getAssets", requestParams(), settle)
        .then(settle)
        .catch((e) => {
          if (mine !== ticket) return;
          tableHost.removeAttribute("aria-busy");
          clear(tableHost).append(
            emptyState("Couldn't load this page.", String(e.message || e)));
        });
    }

    /**
     * Paging replaces the footer, so the button that was just clicked stops existing and
     * keyboard focus falls back to the document. Put it on the same control afterwards,
     * or on its neighbor when the move disabled it (first/last page).
     */
    function restoreNav(nav) {
      if (!nav) return;
      const same = tableHost.querySelector('[data-nav="' + nav + '"]');
      const other = tableHost.querySelector(
        '[data-nav="' + (nav === "prev" ? "next" : "prev") + '"]');
      const target = same && !same.disabled ? same : (other && !other.disabled ? other : null);
      if (target) target.focus();
    }

    function goToPage(next) {
      const nav = document.activeElement && document.activeElement.getAttribute
        ? document.activeElement.getAttribute("data-nav")
        : null;
      page = Math.max(0, next);
      persistParams();
      if (allMode) {
        renderTable(payload);
        restoreNav(nav);
      } else {
        reload(nav);
      }
    }

    function renderTable(current) {
      clear(tableHost);
      const requested = page;

      // All-mode holds every row and slices locally; server-mode is handed exactly the
      // page it asked for, already filtered and sorted by the shared domain module.
      let pageRows;
      let shown;
      let pageCount;
      if (allMode) {
        const q = filters.q.trim().toLowerCase();
        const filtered = current.rows.filter((r) =>
          (!q || String(r.name).toLowerCase().includes(q)) &&
          (!filters.kind || r.kind === filters.kind) &&
          (!filters.cloud || (r.cloud || "") === filters.cloud) &&
          (!filters.aarsSeverity || r.aarsSeverity === filters.aarsSeverity));
        filtered.sort(SORTS[sortKey]);
        shown = filtered.length;
        pageCount = Math.max(1, Math.ceil(shown / pageSize));
        if (page >= pageCount) page = pageCount - 1; // a filter can strand the page number
        pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
      } else {
        pageRows = current.rows;
        shown = current.filtered;
        pageCount = current.pageCount;
        page = current.page; // the server clamps out-of-range pages; mirror it back
      }

      // Either path can land on a different page than was asked for (a filter narrowed
      // the set, or the server clamped a deep link); keep the URL on the page in view.
      if (page !== requested) persistParams();

      countText.textContent = `${shown} of ${current.total}`;
      clearBtn.hidden = !(filters.q || filters.kind || filters.cloud || filters.aarsSeverity);

      tableHost.append(sectionLabel("Assets"));

      if (!shown) {
        tableHost.append(emptyState(
          "No assets match these filters.",
          "Clear the filters to see all assets.",
        ));
        return;
      }

      const tbody = el("tbody", {});
      for (const row of pageRows) {
        tbody.append(el("tr", {
          class: "clickable",
          tabindex: "0",
          role: "button",
          "aria-label": `${row.name}, ${kindLabel(row.kind)}`,
          onclick: () => openAssetSheet(row.id, { title: row.name }),
          onkeydown: (e) => {
            if (e.key === "Enter") openAssetSheet(row.id, { title: row.name });
          },
        },
          el("td", {}, row.name,
            row.agentic
              ? el("span", { class: "pill", style: "margin-left:6px" }, "Agentic")
              : null),
          el("td", {}, kindLabel(row.kind)),
          el("td", {}, row.cloud || "—"),
          el("td", {}, row.region || "—"),
          el("td", {}, aarsChip(row.aars, row.aarsSeverity)),
          el("td", {}, row.severity ? sevBadge(row.severity) : "—"),
          el("td", {}, row.combos
            ? el("span", { class: "pill bad" }, `TC ×${row.combos}`)
            : "—"),
          el("td", {}, row.guardrailMissing ? el("span", { class: "pill warn" }, "missing") : "—"),
          el("td", {}, (row.projects || []).join(", ") || "—"),
          el("td", {},
            el("button", {
              class: "link",
              onclick: (e) => {
                e.stopPropagation();
                navigate("graph", { seed: row.id });
              },
            }, "Graph")),
        ));
      }

      tableHost.append(
        el("div", { class: "table-wrap" },
          el("table", { class: "data" },
            el("thead", {},
              el("tr", {},
                el("th", {}, "Name"),
                el("th", {}, "Kind"),
                el("th", {}, "Cloud"),
                el("th", {}, "Region"),
                el("th", {}, "AARS"),
                el("th", {}, "Severity"),
                el("th", {}, "Toxic combo"),
                el("th", {}, "Guardrail"),
                el("th", {}, "Projects"),
                el("th", {}, ""),
              )),
            tbody,
          )),
      );

      const sizeSel = el("select", { "aria-label": "Rows per page" },
        ...PAGE_SIZES.map((n) => el("option", { value: String(n) }, `${n} / page`)));
      sizeSel.value = String(pageSize);
      sizeSel.addEventListener("change", () => {
        const firstRow = page * pageSize; // keep the top of the current page in view
        pageSize = Number(sizeSel.value);
        goToPage(Math.floor(firstRow / pageSize));
      });

      tableHost.append(
        el("div", { class: "table-footer" },
          sizeSel,
          pager(page, pageCount, shown, goToPage)),
      );
    }

    renderTable(payload);
  }
}
