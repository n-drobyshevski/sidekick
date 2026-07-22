// AI Inventory: KPI cards, AARS-band distribution chart, and the sortable asset
// table. Row click opens the shared asset sheet; "Open in graph" deep-links.
// A compact client-side filter bar (name search + kind/cloud/AARS-band selects)
// sits above the table; it re-filters the already-loaded `rows` in place and
// never touches the KPIs or chart above it, which always summarize all rows.

import { bootstrap, navigate, setParams, swrCall } from "../store.js";
import { openAssetSheet } from "../detailSheets.js";
import { categoryBar } from "../charts.js";
import { kindLabel } from "../icons.js";
import { aarsChip, clear, el, emptyState, kpiCard, sectionLabel, sevBadge, skeleton } from "../ui.js";

// Synchronous placeholder shown until api_getAssets resolves — mirrors the KPI row, the
// distribution chart and the table so the boot splash reveals a laid-out page (not a blank
// pane), and later navigations show structure under the route-overlay veil. paint() clears
// the host and swaps in the real content.
function inventorySkeleton() {
  const kpis = el("div", { class: "kpi-row" });
  for (let i = 0; i < 5; i++) {
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

const SORTS = {
  aars: (a, b) => Number(b.aars ?? -1) - Number(a.aars ?? -1),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
  kind: (a, b) => String(a.kind).localeCompare(String(b.kind)) || SORTS.aars(a, b),
  cloud: (a, b) => String(a.cloud ?? "").localeCompare(String(b.cloud ?? "")) || SORTS.aars(a, b),
};

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

  // Filter + sort state lives here (outside paint) so it survives SWR repaints;
  // it's seeded from the URL so a filtered view is shareable/reloadable.
  const filters = {
    q: params.q || "", kind: params.kind || "",
    cloud: params.cloud || "", band: params.band || "",
  };
  let sortKey = SORTS[params.sort] ? params.sort : "aars";

  let data;
  try {
    data = await swrCall("api_getAssets", {}, (fresh) => paint(fresh));
  } catch (e) {
    host.append(emptyState("Couldn't load the inventory.", String(e.message || e)));
    return;
  }
  paint(data);

  function paint(payload) {
    clear(host);
    const { rows, kpis } = payload;
    const bandSeverity = boot.palette?.aarsBandSeverity || {};

    host.append(
      el("div", { class: "kpi-row" },
        kpiCard("AI assets", String(kpis.aiAssets), `${kpis.agents} agents`),
        kpiCard("Critical AARS", String(kpis.criticalBand), "score 70–100"),
        kpiCard("High AARS", String(kpis.highBand), "score 50–69"),
        kpiCard("Guardrail coverage",
          kpis.guardrailCoveragePct === null ? "—" : `${kpis.guardrailCoveragePct}%`,
          "agents protected by a guardrail"),
        kpiCard("Sensitive data access", String(kpis.sensitiveAccess), "AI assets"),
        kpiCard("Open issues", String(kpis.openIssues), "toxic-combination instances"),
        kpiCard("Compliance gaps", String(kpis.complianceGaps ?? 0), "failing config findings"),
        kpiCard("Agentic identities", String(kpis.agenticIdentities ?? 0), "AGENTIC service accounts / keys"),
      ),
    );

    // AARS band distribution — always the full set, never the filtered subset.
    const bandCounts = {};
    for (const r of rows) {
      if (r.aarsBand) bandCounts[r.aarsBand] = (bandCounts[r.aarsBand] ?? 0) + 1;
    }
    const bandColors = {};
    for (const band of boot.palette?.aarsBands || []) {
      bandColors[band] = boot.palette.colors[bandSeverity[band] || "INFO"];
    }
    const canvas = el("canvas", { "aria-label": "Assets by AARS band", role: "img" });
    host.append(
      el("div", { class: "chart-card", style: "margin-bottom:20px" },
        el("h3", {}, "Assets by AARS band"),
        el("div", { class: "chart-box", style: "height:200px" }, canvas),
      ),
    );
    requestAnimationFrame(() => {
      categoryBar(canvas, boot.palette?.aarsBands || [], bandCounts, bandColors);
    });

    // ---- Filter bar: name search + kind/cloud/AARS-band selects, all client-side
    // over `rows`. Only renderTable() below reacts to a change; KPIs and the chart
    // above are built once per paint from the full row set.
    const searchInput = el("input", {
      type: "search",
      "aria-label": "Search assets by name",
      placeholder: "Search name…",
      value: filters.q,
    });
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.q = searchInput.value;
        onFilterChange();
      }, 150);
    });
    const searchField = el("div", { class: "workbench-search" }, searchInput);

    // A seeded value that no longer exists as an option (stale/hand-edited link, or
    // a facet value gone after a re-sync) is dropped, so the control can't show
    // "All …" while silently filtering to a confusing subset.
    const kinds = [...new Set(rows.map((r) => r.kind).filter(Boolean))].sort();
    if (filters.kind && !kinds.includes(filters.kind)) filters.kind = "";
    const kindSel = el("select", { "aria-label": "Filter by kind" },
      el("option", { value: "" }, "All kinds"),
      ...kinds.map((k) => el("option", { value: k }, kindLabel(k))),
    );
    kindSel.value = filters.kind;
    kindSel.addEventListener("change", () => {
      filters.kind = kindSel.value;
      onFilterChange();
    });

    const clouds = [...new Set(rows.map((r) => r.cloud).filter(Boolean))].sort();
    if (filters.cloud && !clouds.includes(filters.cloud)) filters.cloud = "";
    const cloudSel = el("select", { "aria-label": "Filter by cloud" },
      el("option", { value: "" }, "All clouds"),
      ...clouds.map((c) => el("option", { value: c }, c)),
    );
    cloudSel.value = filters.cloud;
    cloudSel.addEventListener("change", () => {
      filters.cloud = cloudSel.value;
      onFilterChange();
    });

    // Band options follow the palette's canonical order when available, filtered
    // down to bands actually present; otherwise fall back to an alphabetical list.
    const bandsPresent = new Set(rows.map((r) => r.aarsBand).filter(Boolean));
    const bandOrder = boot.palette?.aarsBands || [];
    const bands = bandOrder.length
      ? bandOrder.filter((b) => bandsPresent.has(b))
      : [...bandsPresent].sort();
    if (filters.band && !bands.includes(filters.band)) filters.band = "";
    const bandSel = el("select", { "aria-label": "Filter by AARS band" },
      el("option", { value: "" }, "All bands"),
      ...bands.map((b) => el("option", { value: b }, b)),
    );
    bandSel.value = filters.band;
    bandSel.addEventListener("change", () => {
      filters.band = bandSel.value;
      onFilterChange();
    });

    const countText = el("span", { class: "count" });
    const clearBtn = el("button", {
      class: "link",
      onclick: () => {
        filters.q = ""; filters.kind = ""; filters.cloud = ""; filters.band = "";
        searchInput.value = "";
        kindSel.value = "";
        cloudSel.value = "";
        bandSel.value = "";
        persistParams();
        renderTable();
      },
    }, "Clear");
    const filterMeta = el("div", { class: "filter-meta" }, countText, clearBtn);

    host.append(
      el("div", { class: "filter-bar" }, searchField, kindSel, cloudSel, bandSel, filterMeta),
    );

    const tableHost = el("div", {});
    host.append(tableHost);

    function onFilterChange() {
      persistParams();
      renderTable();
    }

    function persistParams() {
      setParams({ sort: sortKey, q: filters.q, kind: filters.kind, cloud: filters.cloud, band: filters.band });
    }

    function renderTable() {
      clear(tableHost);

      const q = filters.q.trim().toLowerCase();
      const filtered = rows.filter((r) =>
        (!q || String(r.name).toLowerCase().includes(q)) &&
        (!filters.kind || r.kind === filters.kind) &&
        (!filters.cloud || (r.cloud || "") === filters.cloud) &&
        (!filters.band || r.aarsBand === filters.band));
      filtered.sort(SORTS[sortKey]);

      countText.textContent = `${filtered.length} of ${rows.length}`;
      clearBtn.hidden = !(filters.q || filters.kind || filters.cloud || filters.band);

      tableHost.append(sectionLabel("Assets"));

      if (!filtered.length) {
        tableHost.append(emptyState(
          "No assets match these filters.",
          "Clear the filters to see all assets.",
        ));
        return;
      }

      const tbody = el("tbody", {});
      for (const row of filtered) {
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
            row.identityPurpose === "AGENTIC"
              ? el("span", { class: "pill", style: "margin-left:6px" }, "Agentic")
              : null),
          el("td", {}, kindLabel(row.kind)),
          el("td", {}, row.cloud || "—"),
          el("td", {}, row.region || "—"),
          el("td", {}, aarsChip(row.aars, row.aarsBand, bandSeverity)),
          el("td", {}, row.severity ? sevBadge(row.severity) : "—"),
          el("td", {}, (row.comboGroups || []).length
            ? el("span", { class: "pill bad" }, `TC ×${row.comboGroups.length}`)
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
    }

    renderTable();
  }
}
