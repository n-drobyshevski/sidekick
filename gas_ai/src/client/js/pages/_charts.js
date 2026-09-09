// The chart-table helpers this register's two chart-bearing pages share: the
// `chartTableModel` builders `pages/inventory.js`'s two canvases and `pages/problems.js`'s
// one canvas need. Read `gas_shared/ui/chartTable.js`'s own header first — the one rule this
// file exists to keep faith with: the table is built from the SAME array the chart wrapper
// reads, named once at the call site and handed to both in the same statement. This file
// only builds the MODEL; the DOM half (`chartTable`) stays at each call site, so the array
// that reaches this file's builders is always the identifier the page itself already named.
//
// THIN ON PURPOSE, and DOM-free on purpose. `chartTableModel` already does the
// refuse-before-cast formatting (`gas_shared/ui/figures.js`'s `num`/`fmtCount`/`pct1`), so
// neither builder below declares a second copy — `test/figures.test.js`'s declaration sweep
// covers every file under `pages/`, this one included, and would fail the moment either did.
// And nothing here imports `../ui.js` or `../chartsLoader.js`: `postureTrendModel.js`'s own
// header explains why — `pages/inventory.js` transitively imports `charts.js`, which reads
// `window` at module scope, so anything that pulls that chain in can only be exercised
// inside a DOM environment. This file's two builders are read straight off
// `gas_shared/ui/chartTable.js` and `./postureTrendModel.js`, neither of which touches
// `window`/`document` at module scope, so `test/chartTable.test.js` can import and call them
// directly in the "pure" vitest project (no jsdom) rather than only reading them as text.
//
// `trendTableModel` covers BOTH of inventory.js's canvas sites: the counts-over-time trend
// and each of the three posture-trend cards (adjacency, exploitation, category) plot the
// identical shape — one point per sync (`{at, counts, annotations?}`), a caller-supplied list
// of `{key, label}` series, a value that reads `null` when the sync recorded no figure for
// that series. `valueAt` (imported from `./postureTrendModel.js`, not reimplemented here) is
// the SAME null-vs-absent read the chart itself is built on, so a point the line breaks at
// is a point this table prints as an em dash — never a confident 0, and never a second,
// differently-behaved copy of the rule the chart already applies.
//
// `coverTableModel` is `problems.js`'s own shape: `src/domain/actions.ts`'s
// `coverCurve`, `[{rank, cumulative, share}]`, already ranked and flattened by the server —
// this is a straight column mapping with one refusal. `share` is a 0..1 fraction and `pct1`
// (chartTableModel's `"pct"` format) wants a percentage, so the multiply happens AFTER
// `num()` refuses a null share, never before — `null * 100` is a confident `0`, the exact
// trap `problems.js`'s own `actionHeadline` already sidesteps for this identical field.

import { chartTableModel } from "../../../../../gas_shared/ui/chartTable.js";
import { num } from "../../../../../gas_shared/ui/figures.js";
import { fmtDate } from "../../../../../gas_shared/ui/format.js";
import { valueAt } from "../postureTrendModel.js";

/**
 * A per-sync series as a table model: one row per point, one column per series, the sync
 * date first.
 *
 *   points   THE ARRAY THE CHART WRAPPER WAS GIVEN — inventory.js's `trend` (`countTrend`) or
 *            one posture card's own `points` (adjacency / exploitation / categoryPoints).
 *            One model row per entry, in order — no filtering, no truncation.
 *   series   [{key, label}], already narrowed to the series worth drawing
 *            (`postureTrendModel.js`'s `presentSeries`) — this builder does not re-derive
 *            that filter, it only reads whichever list the caller hands it.
 *   xLabel   the first column's heading; every call site here draws one point per sync.
 *   xValue   reads a row's x-column text; defaults to the sync date (`fmtDate(row.at)`).
 */
export function trendTableModel(points, series, { xLabel = "Sync", xValue } = {}) {
  const rows = Array.isArray(points) ? points : [];
  const readX = typeof xValue === "function" ? xValue : (row) => fmtDate(row && row.at);
  return chartTableModel({
    columns: [
      { key: "x", label: xLabel, format: "text", value: readX },
      ...(series || []).map((s) => ({
        key: s.key,
        label: s.label,
        format: "count",
        // `valueAt` refuses undefined AND null to the same `null` the chart itself reads as
        // a gap — a series absent at this point stays absent here, never a plotted zero.
        value: (row) => valueAt(row, s.key),
      })),
    ],
    rows,
  });
}

/**
 * The cover curve as a table model — `src/domain/actions.ts`'s `coverCurve`,
 * `[{rank, cumulative, share}]`, one row per point `charts.js::coverCurve` plots, in the
 * same rank order.
 */
export function coverTableModel(curve) {
  const rows = Array.isArray(curve) ? curve : [];
  return chartTableModel({
    columns: [
      { key: "rank", label: "Rank", format: "count" },
      { key: "cumulative", label: "Problems closed, cumulative", format: "count" },
      {
        key: "share",
        label: "Share",
        format: "pct",
        value: (row) => {
          const v = num(row && row.share);
          return v === null ? null : v * 100;
        },
      },
    ],
    rows,
  });
}
