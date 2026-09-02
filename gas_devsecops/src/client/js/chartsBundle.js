// The entry point for the SECOND client bundle, `dist/js_charts.html`.
//
// It exists so Chart.js is not in the first paint. Chart.js accounts for 170,785 bytes of the
// 732,267-byte client bundle, and `doGet` also inlines styles.html (172,848 bytes), so the
// document a reader waits for is ~906 KB and Chart.js is ~19% of it — on every route,
// including the eight that draw no chart. It cannot be made smaller: `charts.js`'s own header
// records the measurement, and the reason is that the chart.js package ships one pre-bundled
// 131 KB module with no per-component files for a bundler to drop. Not shipping it on the
// critical path is the only lever left.
//
// A GLOBAL, not an ES module export. This file is executed from source text at runtime — see
// chartsLoader.js — and the three mechanisms it may end up executed by have no module
// plumbing between them. A global is the one handoff all three share. It cannot go stale: the
// source arrives from the deployment that is answering, on the call that needs it, and
// nothing caches it between loads.

import {
  ACCENT,
  coverageEfficiencyLines,
  coverageEfficiencyScatter,
  coverCurve,
  destroyChart,
  fmtDuration,
  groupPalette,
  groupPie,
  groupTrendLines,
  mttrContributionBars,
  mttrImpactBars,
  openResolvedLines,
  setChartTipHandler,
  severityBar,
  severityTrendLines,
  sparkline,
  stackedAgeBar,
  survivalCurve,
  trendLine,
} from "./charts.js";

window.__WSK_CHARTS__ = {
  ACCENT,
  coverageEfficiencyLines,
  coverageEfficiencyScatter,
  coverCurve,
  destroyChart,
  fmtDuration,
  groupPalette,
  groupPie,
  groupTrendLines,
  mttrContributionBars,
  mttrImpactBars,
  openResolvedLines,
  setChartTipHandler,
  severityBar,
  severityTrendLines,
  sparkline,
  stackedAgeBar,
  survivalCurve,
  trendLine,
};
