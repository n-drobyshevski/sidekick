// The entry point for the SECOND client bundle, `dist/js_charts.html`.
//
// It exists so Chart.js is not in the first paint. Chart.js is the largest single
// dependency in the client bundle and no route needs it before it draws its first
// chart, so it is built separately and fetched over google.script.run on the route that
// does. See chartsLoader.js for the whole argument, including the part that cannot be
// verified from here (which of the three ways to run fetched source a deployment's
// HtmlService sandbox actually permits).
//
// A GLOBAL, not an ES module export. This file is executed from source text at runtime —
// see chartsLoader.js — and the three mechanisms it may end up executed by have no module
// plumbing between them. A global is the one handoff all three share. It cannot go stale:
// the source arrives from the deployment that is answering, on the call that needs it,
// and nothing caches it between loads.
//
// This is also the ONLY place "chart.js" is imported. charts.js itself never imports the
// package (see its header) — it receives the constructor through installChartRuntime,
// called here, so the copy of charts.js bundled into the MAIN app.js (for its Chart.js-free
// exports: TIER_*, tierPalette, groupPalette, fmtDuration) never drags Chart.js along.

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
} from "chart.js";

import {
  destroyChart,
  groupPie,
  groupTrendLines,
  installChartRuntime,
  mttrContributionBars,
  mttrImpactBars,
  openResolvedLines,
  severityBar,
  severityTrendLines,
  sparkline,
  stackedAgeBar,
  survivalCurve,
  coverageEfficiencyLines,
  coverageEfficiencyScatter,
  trendLine,
} from "./charts.js";

installChartRuntime(Chart, [
  ArcElement, BarController, BarElement, CategoryScale, Filler, Legend,
  LinearScale, LineController, LineElement, PieController, PointElement, Tooltip,
]);

window.__WSK_CHARTS__ = {
  destroyChart,
  groupPie,
  groupTrendLines,
  mttrContributionBars,
  mttrImpactBars,
  openResolvedLines,
  severityBar,
  severityTrendLines,
  sparkline,
  stackedAgeBar,
  survivalCurve,
  coverageEfficiencyLines,
  coverageEfficiencyScatter,
  trendLine,
};
