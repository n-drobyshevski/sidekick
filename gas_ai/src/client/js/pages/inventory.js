// AI Inventory: KPI cards, AARS-band distribution chart, and the sortable asset
// table. Row click opens the shared asset sheet; "Open in graph" deep-links.

import { bootstrap, navigate, swrCall } from "../store.js";
import { openAssetSheet } from "../detailSheets.js";
import { categoryBar } from "../charts.js";
import { kindLabel } from "../icons.js";
import { aarsChip, clear, el, emptyState, kpiCard, sectionLabel, sevBadge } from "../ui.js";

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

    // AARS band distribution.
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

    // Table.
    const sortKey = SORTS[params.sort] ? params.sort : "aars";
    const sorted = [...rows].sort(SORTS[sortKey]);
    const tbody = el("tbody", {});
    for (const row of sorted) {
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

    host.append(
      sectionLabel(`Assets (${rows.length})`),
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
}
