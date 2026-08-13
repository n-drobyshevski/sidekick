// Ledger capacity: how much of the spreadsheet's 10M-cell ceiling is spent, what is spending
// it, and how much room is left. `capacityView` is pure (no DOM) so it is unit-tested; the
// renderer wraps it in the design-system primitives.
//
// Form follows the data's job. The headline is a single ratio against a hard limit, which is
// a meter — not a gauge (PRODUCT.md rules those out) and not a one-bar chart. The per-tab
// breakdown is nine classes, past the point where color can carry identity, so it is a table
// with one thin accent bar per row: the reader's job there is "which tab is biggest", a
// magnitude comparison, so every bar is the same hue and the numbers stay authoritative.

import { el, usageMeter } from "./ui.js";

// Warn at the Settings panel's long-standing 6M-of-10M line; bad once so little headroom is
// left that the next large scan could hit the wall mid-persist.
export const WARN_AT = 0.6;
export const BAD_AT = 0.85;

/** "" | "warn" | "bad" for a used/total ratio. One definition, shared by Data and Settings. */
export function capacityState(used, total) {
  if (!(total > 0)) return "";
  const ratio = used / total;
  if (ratio >= BAD_AT) return "bad";
  if (ratio >= WARN_AT) return "warn";
  return "";
}

const NOTES = {
  warn:
    "Past 60% of the 10M-cell ceiling. Lower the retention window or compact sealed scans " +
    "in Settings to reclaim room.",
  bad:
    "Past 85% of the 10M-cell ceiling. A spreadsheet refuses new rows once it is reached, " +
    "so a scan would fail mid-save. Lower the retention window or compact sealed scans in " +
    "Settings.",
};

/**
 * Storage-stats payload → the view model for the capacity section.
 *
 * `cellsByTab` / `ledgerRowCells` are additive fields; a stale pre-rollout cache simply omits
 * them, so the breakdown and headroom collapse to null rather than rendering zeroes.
 */
export function capacityView(stats) {
  const used = Number(stats?.cellCount ?? 0);
  const total = Number(stats?.cellLimit ?? 0);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const state = capacityState(used, total);
  const free = Math.max(0, total - used);

  const rowCells = Number(stats?.ledgerRowCells ?? 0);
  // Deliberately in vulnerabilities, not cells: "3.9M cells free" is not a number anyone can
  // act on, and one more tracked vulnerability is exactly one more ledger row.
  const headroomVulns = rowCells > 0 ? Math.floor(free / rowCells) : null;

  const raw = Array.isArray(stats?.cellsByTab) ? stats.cellsByTab : [];
  const tabs = raw
    .map((t) => ({
      name: String(t?.name ?? ""),
      rows: Number(t?.rows ?? 0),
      cols: Number(t?.cols ?? 0),
      cells: Number(t?.cells ?? 0),
      share: used > 0 ? (Number(t?.cells ?? 0) / used) * 100 : 0,
    }))
    .sort((a, b) => b.cells - a.cells);
  // Bars are read against the biggest tab, not against the 10M ceiling: at a few percent of
  // the limit every row would otherwise render as an identical hairline.
  const peak = tabs.length ? tabs[0].cells : 0;
  for (const t of tabs) t.barPct = peak > 0 ? (t.cells / peak) * 100 : 0;

  return {
    used, total, free, pct, state,
    note: NOTES[state] ?? null,
    rowCells,
    headroomVulns,
    tabs,
  };
}

/**
 * Capacity meter + per-tab breakdown. Returns the view model so callers can assert on it.
 *
 * The bars are `aria-hidden`: nine stacked progressbar roles would be read out one by one for
 * no gain, and the table's own numbers already carry every value they encode.
 */
export function renderCapacity(host, stats) {
  const v = capacityView(stats);

  host.append(usageMeter({
    used: v.used, total: v.total, label: "Spreadsheet cells",
    state: v.state, note: v.note,
  }));

  if (v.headroomVulns !== null) {
    host.append(el("p", { class: "muted small", style: "margin:10px 0 0" },
      `Room for about ${v.headroomVulns.toLocaleString()} more tracked ` +
      `vulnerabilit${v.headroomVulns === 1 ? "y" : "ies"} — ${v.rowCells} cells per ledger row.`));
  }

  if (!v.tabs.length) return v;

  const body = el("tbody");
  for (const t of v.tabs) {
    const fill = el("i");
    fill.style.width = `${t.barPct}%`;
    body.append(el("tr", {},
      el("td", {}, el("code", { class: "small" }, t.name)),
      el("td", { class: "num" }, `${t.rows.toLocaleString()} × ${t.cols}`),
      el("td", { class: "num" }, t.cells.toLocaleString()),
      el("td", { class: "capacity-share" },
        el("span", { class: "capacity-bar", "aria-hidden": "true" }, fill),
        el("span", { class: "num" }, `${t.share.toFixed(1)}%`)),
    ));
  }

  host.append(
    el("table", { class: "data capacity-table" },
      el("thead", {},
        el("tr", {},
          el("th", {}, "Tab"),
          el("th", { class: "num" }, "Grid"),
          el("th", { class: "num" }, "Cells"),
          el("th", {}, "Share of used"))),
      body),
    el("p", { class: "muted small" },
      "Counted as allocated grid cells — rows × columns — which is the measure the 10M-cell " +
      "limit enforces, so empty rows inside a tab's grid still count against it."),
  );
  return v;
}
