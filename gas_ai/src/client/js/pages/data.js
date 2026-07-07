// Data: sync history, storage stats, and the reset control.

import { call, } from "../api.js";
import { swrCall } from "../store.js";
import { clear, confirmDialog, el, emptyState, fmtDateTime, sectionLabel, statusPill, toast } from "../ui.js";

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function renderData(main, _params, ctx) {
  main.append(
    el("h1", {}, "Data"),
    el("p", { class: "page-sub" },
      "Sync history, storage footprint, and maintenance."),
  );

  const historyHost = el("div", {});
  const statsHost = el("div", {});
  main.append(sectionLabel("Sync history"), historyHost, sectionLabel("Storage"), statsHost);

  try {
    const history = await swrCall("api_getSyncHistory", {}, (fresh) => paintHistory(fresh));
    paintHistory(history);
  } catch (e) {
    historyHost.append(emptyState("Couldn't load sync history.", String(e.message || e)));
  }

  try {
    const stats = await swrCall("api_getStorageStats", {}, (fresh) => paintStats(fresh));
    paintStats(stats);
  } catch (e) {
    statsHost.append(emptyState("Couldn't load storage stats.", String(e.message || e)));
  }

  main.append(sectionLabel("Maintenance"));
  main.append(
    el("div", { class: "card", style: "display:flex; gap:12px; align-items:center" },
      el("div", { style: "flex:1" },
        el("strong", {}, "Reset synced data"),
        el("div", { class: "small muted" },
          "Clears assets, edges, issues and sync history. The next sync repopulates " +
          "everything; settings are kept."),
      ),
      el("button", {
        class: "danger",
        onclick: async () => {
          const yes = await confirmDialog({
            title: "Reset synced data?",
            body: "All synced assets, edges, issues and the sync history are cleared. " +
              "Settings are kept. This cannot be undone.",
            confirmLabel: "Reset",
            danger: true,
          });
          if (!yes) return;
          try {
            const res = await call("api_resetData", {});
            toast(res.message || "Data cleared.");
            ctx.refresh();
          } catch (e) {
            toast(String(e.message || e), "error");
          }
        },
      }, "Reset…"),
    ),
  );

  function paintHistory(payload) {
    clear(historyHost);
    if (!payload.rows.length) {
      historyHost.append(emptyState("No syncs yet."));
      return;
    }
    const tbody = el("tbody", {});
    for (const row of payload.rows) {
      tbody.append(el("tr", {},
        el("td", {}, fmtDateTime(row.finished_at)),
        el("td", {}, row.status === "SUCCESS"
          ? statusPill("ok", "Success")
          : statusPill("bad", String(row.status || "Failed"))),
        el("td", {}, String(row.mode || "—")),
        el("td", { class: "num" }, String(row.node_count ?? "—")),
        el("td", { class: "num" }, String(row.edge_count ?? "—")),
        el("td", { class: "num" }, String(row.issue_count ?? "—")),
        el("td", { class: "num" }, String(row.api_calls ?? "—")),
      ));
    }
    historyHost.append(
      el("div", { class: "table-wrap" },
        el("table", { class: "data" },
          el("thead", {},
            el("tr", {},
              el("th", {}, "Finished"),
              el("th", {}, "Status"),
              el("th", {}, "Mode"),
              el("th", {}, "Nodes"),
              el("th", {}, "Edges"),
              el("th", {}, "Issues"),
              el("th", {}, "API calls"),
            )),
          tbody,
        )),
    );
  }

  function paintStats(stats) {
    clear(statsHost);
    statsHost.append(
      el("div", { class: "kpi-row" },
        el("div", { class: "kpi-card" },
          el("div", { class: "kpi-label" }, "Spreadsheet cells"),
          el("div", { class: "kpi-value num" }, Number(stats.cellCount).toLocaleString()),
          el("div", { class: "kpi-sub" }, "10M ceiling")),
        el("div", { class: "kpi-card" },
          el("div", { class: "kpi-label" }, "Drive archive"),
          el("div", { class: "kpi-value num" }, fmtBytes(Number(stats.archiveBytes)))),
        el("div", { class: "kpi-card" },
          el("div", { class: "kpi-label" }, "Rows"),
          el("div", { class: "kpi-value num" },
            `${stats.rows.assets} / ${stats.rows.edges} / ${stats.rows.issues}`),
          el("div", { class: "kpi-sub" }, "assets / edges / issues")),
      ),
    );
  }
}
