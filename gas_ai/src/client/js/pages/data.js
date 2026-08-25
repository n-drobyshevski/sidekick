// Data: sync history, storage stats, and the reset control.

import { call, } from "../api.js";
import { bootstrapCached, swrCall } from "../store.js";
import {
  absent, appendAll, clear, confirmDialog, dataTable, el, emptyState, fmtDateTime,
  prunePanel, registerWideNote, statRow,
  sectionLabel, skeleton, statusPill, toast,
} from "../ui.js";

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

  // Seed each host with a skeleton until its RPC resolves; paintHistory()/paintStats() clear.
  historyHost.append(el("div", {
    role: "status", "aria-label": "Loading sync history",
    style: "display:flex; flex-direction:column; gap:12px",
  }, ...Array.from({ length: 4 }, () => skeleton("line", { height: "18px" }))));
  // Shape-matched to what lands: a stat strip, not three cards.
  statsHost.append(el("div", { class: "stat-list", role: "status", "aria-label": "Loading storage" },
    ...Array.from({ length: 3 }, () => el("div", { class: "stat-row" },
      skeleton("line", { width: "60%" }),
      skeleton("stat", { width: "45%" })))));

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
  // Escalating order: the scoped subtraction first, the whole-register wipe last. The prune
  // reads the bootstrap payload the router has already fetched rather than calling for it —
  // the project list and the sync scope both ride on it, and a second fetch here could only
  // disagree with the sidebar switcher reading the same fields.
  main.append(prunePanel(bootstrapCached(), { refresh: ctx.refresh, call }));
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
    // A sync is a register-wide operation and its row records register-wide totals.
    appendAll(historyHost,
      registerWideNote(bootstrapCached(), "a sync collects for the whole register"));
    // A count Wiz never reported is `absent()`, not a plain dash: a sync row that failed
    // before it counted anything must not read in the same ink as one that counted zero.
    const count = (n) => (n === null || n === undefined ? absent() : String(n));
    historyHost.append(dataTable({
      columns: [
        { key: "finished", label: "Finished", cell: (r) => fmtDateTime(r.finished_at) },
        {
          key: "status", label: "Status",
          cell: (r) => (r.status === "SUCCESS"
            ? statusPill("ok", "Success")
            : statusPill("bad", String(r.status || "Failed"))),
        },
        { key: "mode", label: "Mode", cell: (r) => r.mode || absent() },
        { key: "nodes", label: "Nodes", className: "num", cell: (r) => count(r.node_count) },
        { key: "edges", label: "Edges", className: "num", cell: (r) => count(r.edge_count) },
        { key: "issues", label: "Issues", className: "num", cell: (r) => count(r.issue_count) },
        { key: "calls", label: "API calls", className: "num", cell: (r) => count(r.api_calls) },
      ],
      rows: payload.rows,
    }));
  }

  function paintStats(stats) {
    clear(statsHost);
    // Storage is the ledger's own size, and this page carries the control that wipes it.
    // Scoping any of it would be actively wrong: someone checking headroom against the 10M
    // cell ceiling, or about to clear everything, has to see everything.
    appendAll(statsHost,
      registerWideNote(bootstrapCached(), "storage describes the ledger, not a project"),
      // These three were hand-built .kpi-card divs rather than calls to kpiCard(), which is
      // how a page drifts off the shared vocabulary without anyone deciding to. They are
      // three readings of one thing (how big the ledger is), not three headlines, so they are
      // a stat strip: same figures, hairlines instead of three competing boxes.
      el("div", { class: "stat-list" },
        statRow("Spreadsheet cells", Number(stats.cellCount).toLocaleString(), "10M ceiling"),
        statRow("Drive archive", fmtBytes(Number(stats.archiveBytes)), ""),
        statRow("Rows",
          `${stats.rows.assets} / ${stats.rows.edges} / ${stats.rows.issues}`,
          "assets / edges / issues"),
      ),
    );
  }
}
