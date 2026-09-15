// The chart-table helpers this register's four chart-bearing pages share: the
// `chartTableModel` builders each of gas/charts.js's wrappers needs.
//
// `chartCard` USED TO LIVE HERE AND IS GONE. It was ported from
// gas_devsecops/src/client/js/pages/sca.js "for parity", and this file's own header then
// recorded that none of this app's four chart pages could call it without dropping a feature
// — a toggle, a conditional branch, a two-canvas lens swap, or `renderCharts`'s single
// batched `loadCharts()` pass. It stayed exported and uncalled for a whole wave. Two
// functions of one name in one package, one of them dead, is how a later reader reaches for
// the wrong one; `pages/mttr.js`'s own `chartCard` is the survivor and its header says why it
// was the one that fit. `headingDenominator` went with it — it existed only to build that
// card's heading.
//
// THE DEFECT THIS FILE EXISTS TO REMOVE. Every chart on mttr.js, overview.js, program.js and
// history.js used to be `<canvas role="img">` and nothing else — no table a screen reader
// could read cell by cell, no rows a reviewer could copy into a spreadsheet, no long
// description for a keyboard user who cannot hover a Chart.js tooltip. `gas_shared/ui/
// chartTable.js` is the fix (read its header first — the one rule it exists to enforce: the
// table is built from the SAME array reference the chart wrapper is handed, named once at the
// call site). What is missing there is register-specific: the shape each of THIS app's
// `charts.js` wrappers takes is not one `chartTableModel` already knows how to build, the way
// `survivalTableModel` already does for the Kaplan–Meier curve both this app and
// gas_devsecops share.
//
// `agingTableModel` / `severityCountsTableModel` are PORTED, byte-for-byte in shape, from
// gas_devsecops/src/client/js/pages/sca.js — this register draws the identical
// stacked-age-bar and severity-bar charts, over the identical `{labels, perSev}` /
// `{counts, order}` shapes, so a second implementation would be a second place for the two to
// drift.
//
// `trendTableModel` / `pieTableModel` / `barsTableModel` / `scatterTableModel` /
// `sparkTableModel` are new here — gas draws chart shapes gas_devsecops does not (a group pie,
// a coverage/efficiency scatter, per-group diverging bars, a bare sparkline) and none of them
// had a table-model builder anywhere yet. Every one of them is a thin `chartTableModel` call:
// the null-vs-zero refusal, the column formatting and the row-for-row fidelity all come from
// there, so this file adds no formatter of its own (`gas/test/figures.test.js`'s sweep forbids
// a page-local `num`/`fmtCount`/`pct` — this file lives under `pages/` and is swept too).

import { chartTableModel, num } from "../ui.js";

/**
 * The stacked age bar's series as a table model — ported unchanged from
 * gas_devsecops/src/client/js/pages/sca.js. `labels` and `perSev` are the SAME two arrays
 * `charts.js::stackedAgeBar` is handed, read once here and once there.
 *
 * The severity columns are filtered exactly the way `stackedAgeBar` filters its datasets
 * (`order.filter((s) => perSev[s])`), so the table lists the bars that were drawn and no
 * others. NO TOTAL COLUMN: a stacked total looks obvious and is not, because a null bucket
 * count would have to be summed as a zero to produce one, which is the exact move
 * `ui/figures.js` exists to refuse.
 *
 * `bucketLabel` NAMES THE X AXIS: this register uses the same builder for open-age buckets
 * (`overview.js`, `mttr.js`'s resolution-bucket histogram) and for the SLA-window-consumed
 * deciles (`mttr.js`), and a first column headed "Age bucket" over "0".."9" would name a
 * quantity the table does not hold — this table is the non-visual reader's ONLY copy of the
 * chart, so the wrong word there is the wrong figure rather than a cosmetic slip.
 */
export function agingTableModel(labels, perSev, order, bucketLabel = "Age bucket") {
  const buckets = Array.isArray(labels) ? labels : [];
  const perSevOf = perSev || {};
  const sevs = (order || []).filter((s) => perSevOf[s]);
  return chartTableModel({
    columns: [
      { key: "bucket", label: bucketLabel, format: "text", value: (_row, i) => buckets[i] },
      ...sevs.map((s) => ({
        key: s,
        label: s,
        format: "count",
        value: (_row, i) => perSevOf[s][i],
      })),
    ],
    rows: buckets,
  });
}

/**
 * The severity bar's counts as a table model — ported unchanged from
 * gas_devsecops/src/client/js/pages/sca.js. Same `counts` object and same `order` the wrapper
 * gets, and the same zero-drop rule `charts.js::severityBar` applies — a level with nothing in
 * it is not a bar, so it is not a row either.
 */
export function severityCountsTableModel(counts, order, valueLabel) {
  const tally = counts || {};
  return chartTableModel({
    columns: [
      { key: "sev", label: "Severity", format: "text", value: (s) => s },
      { key: "count", label: valueLabel || "Open findings", format: "count", value: (s) => tally[s] },
    ],
    rows: (order || []).filter((s) => tally[s]),
  });
}

/**
 * A time series as a table model: one date column, one column per series — the shape
 * `charts.js::trendLine` / `openResolvedLines` / `groupTrendLines` / `severityTrendLines` /
 * `coverageEfficiencyLines` all plot, generalized over the different point shapes those five
 * wrappers actually take (`{x,y}`, `{date,open,resolved}`, `{date,byGroup}`, `{date,bySev}`,
 * `{date,coverage_pct,efficiency_pct}`).
 *
 *   points   THE ARRAY THE CHART WRAPPER WAS GIVEN — one model row per point, in order, no
 *            filtering (`ui/chartTable.js`'s one rule).
 *   series   [{ key, label, format, value }] — one column per plotted line. `value` defaults
 *            to `row[key]`, so a wrapper whose point already carries the field by that name
 *            (`{x,y}` -> `{key:"y", ...}`) needs no reader at all; a wrapper whose values sit
 *            inside a nested object (`{date,byGroup:{name:count}}`) passes an explicit
 *            `value: (row) => row.byGroup[name]`. A point missing the field reads as `null`
 *            through the same reader, and `chartTableModel`'s formatters print that as the em
 *            dash — NEVER as a plotted zero, which is the one rule this model exists to keep
 *            (a chart line has a gap there; the table must say the same thing).
 *   opts     `dateKey` (default `"date"`, `"x"` for `trendLine`/`openResolvedLines`'s point
 *            shape) and `dateLabel` (default `"Date"`).
 */
export function trendTableModel(points, series, opts = {}) {
  const rows = Array.isArray(points) ? points : [];
  const dateKey = (opts && opts.dateKey) || "date";
  const dateLabel = (opts && opts.dateLabel) || "Date";
  const columns = [
    {
      key: dateKey,
      label: dateLabel,
      format: "text",
      value: (row) => {
        const v = row ? row[dateKey] : null;
        return v === null || v === undefined || v === "" ? null : String(v).slice(0, 10);
      },
    },
    ...(series || []).map((s) => {
      const key = s.key || s.name;
      return {
        key,
        label: s.label || s.name,
        format: s.format || "count",
        value: typeof s.value === "function"
          ? s.value
          : (row) => (row && typeof row === "object" ? row[key] : null),
      };
    }),
  ];
  return chartTableModel({ columns, rows });
}

/**
 * A pie's slices as a table model — group, count, and each slice's OWN share of the total, so
 * a reader gets the same percentage `charts.js::groupPie`'s on-arc labels and tooltip already
 * carry, in a form that survives a screen reader or a copy-paste. The total is summed through
 * `num(v, 0)` (an explicit arithmetic fallback, never the bare `Number(v) || 0` CLAUDE.md's
 * working discipline names — a slice missing its own `value` still refuses to render a share).
 */
export function pieTableModel(slices) {
  const rows = Array.isArray(slices) ? slices : [];
  const total = rows.reduce((a, s) => a + num(s && s.value, 0), 0);
  return chartTableModel({
    columns: [
      { key: "label", label: "Group", format: "text" },
      { key: "value", label: "Count", format: "count" },
      {
        key: "share",
        label: "Share",
        format: "pct",
        value: (s) => {
          const v = num(s && s.value);
          return v === null || !total ? null : (v / total) * 100;
        },
      },
    ],
    rows,
  });
}

/**
 * A ranked-bar chart's rows as a table model — the shape `charts.js::mttrContributionBars`
 * (each group's KM median, ranked against the overall) and `mttrImpactBars` (each group's
 * signed excess finding·days) both take: `[{label, value, ...}]`, already sorted the way the
 * bars are drawn. `valueLabel` names the one measured column (a duration, a signed count); the
 * default `"count"` format handles a negative `mttrImpactBars` value (finding·days pulling MTTR
 * down) exactly the way it handles a positive one — `fmtCount`'s grouping applies to the sign
 * too, and there is no separate "signed count" format to reach for.
 */
export function barsTableModel(rows, valueLabel = "Value", opts = {}) {
  const format = (opts && opts.format) || "count";
  const labelHeading = (opts && opts.labelHeading) || "Group";
  return chartTableModel({
    columns: [
      { key: "label", label: labelHeading, format: "text" },
      { key: "value", label: valueLabel, format },
    ],
    rows: Array.isArray(rows) ? rows : [],
  });
}

/**
 * The coverage/efficiency scatter's points as a table model — `charts.js::
 * coverageEfficiencyScatter`'s own shape, `[{label, coverage, efficiency, highRisk, active}]`.
 * `coverage` / `efficiency` can be `null` (a rule scored against too few labelled rows to
 * measure either rate) — the wrapper drops those points from the plotted set entirely
 * (`points.filter((p) => p.coverage !== null && p.efficiency !== null)`) but this table lists
 * EVERY row it was handed, `null` and all, because `ui/chartTable.js`'s rule is no filtering —
 * a rule the chart could not plot is still a rule the reader asked about, and "not measurable"
 * is a different fact from "0%".
 */
export function scatterTableModel(points) {
  return chartTableModel({
    columns: [
      { key: "label", label: "Rule", format: "text" },
      { key: "coverage", label: "Coverage", format: "pct" },
      { key: "efficiency", label: "Efficiency", format: "pct" },
      { key: "highRisk", label: "Flagged high risk", format: "count" },
    ],
    rows: Array.isArray(points) ? points : [],
  });
}

/**
 * A bare sparkline's values as a table model — `charts.js::sparkline`'s own shape, one plain
 * number per point with no companion date/label array of its own. `labels`, when given, names
 * each point (a date, a scan index); absent one, points are numbered "1", "2", … so a row is
 * never presented as unlabelled.
 *
 * NOT what overview.js's per-tier trend grid uses, on purpose: `insights.tierTrend` carries a
 * real per-point DATE shared by all five tiers, so that grid's own table is a `trendTableModel`
 * over the shared trend array (one date column, one column per tier) rather than five of this
 * model side by side — see `pages/overview.js`'s `tierTrendCard` for the reasoning. This
 * builder stays for the shape `sparkline` itself actually takes: a lone `values` array with no
 * natural row object to key columns off, wherever the chart is a single unaccompanied series.
 */
export function sparkTableModel(values, labels) {
  const vals = Array.isArray(values) ? values : [];
  const labs = Array.isArray(labels) ? labels : [];
  return chartTableModel({
    columns: [
      {
        key: "label",
        label: "Point",
        format: "text",
        value: (_v, i) => (labs[i] !== undefined && labs[i] !== null ? labs[i] : String(i + 1)),
      },
      { key: "value", label: "Value", format: "count" },
    ],
    rows: vals,
  });
}
