// MTTR & SLA — the first page in this register that shows a real number.
//
// EVERY FIGURE HERE NAMES ITS DENOMINATOR, and that is not decoration. "Median 12 d" over
// 400 resolved of 20,076 findings is a statement about 2% of the estate, and a page that
// prints it alone has misled its reader more effectively than one that printed nothing.
//
// The headline is the Kaplan-Meier estimate, not the closed-only median, because open
// findings are EVIDENCE: a CRITICAL that has been open 300 days tells you more about
// remediation speed than one that closed in a day. They enter as right-censored
// observations. Where survival never falls to half, the page publishes "> X d" — the lower
// bound — rather than an invented number or a shrug. The naive median is shown BESIDE it,
// labelled, so the gap between the two is visible rather than hidden by whichever is quoted.
//
// THE SURVIVAL CURVE IS INLINE SVG rather than Chart.js, deliberately. chartsLoader.js
// documents an unsettled question — whether HtmlService's sandbox permits executing a script
// fetched at runtime — and answers it with three fallbacks and an honest failure state. A
// step function is a `<path>` with two commands per point and needs none of that, so the
// first wired page in this register does not depend on the one mechanism the codebase says
// it cannot yet verify. A page whose whole subject is honest measurement should not open on
// a chart that might not draw.

import { swrCall } from "../store.js";
import { el, clear } from "../ui.js";
import { heroStat, kpiCard, pageHeader, statusPill } from "../ui/controls.js";
import { dataTable } from "../ui/data.js";
import { emptyState, errorState, skeletonStack } from "../ui/feedback.js";
import { sevBadge } from "../ui/severity.js";
// The namespace is assembled rather than written out: esbuild.config.mjs's middlebox
// guard fails the build on a bare `//` surviving comment stripping, and a URL in a
// string is exactly that. icons.js hit this first and SVG_NS is its answer.
import { SVG_NS } from "../icons.js";

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/** Days, to one decimal below 10 and whole above — a 0.4-day difference is not a finding. */
function days(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v < 10 ? `${v.toFixed(1)} d` : `${Math.round(v).toLocaleString()} d`;
}

function pct(v) {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`;
}

function count(n) {
  return Number(n || 0).toLocaleString();
}

/**
 * The survival staircase, as an SVG path.
 *
 * KM survival is a STEP function: it holds flat between event times and drops at each one.
 * Drawing it as a smooth line would claim intermediate values nobody observed — the estimate
 * genuinely does not change between two deaths.
 */
function survivalChart(curve, tau) {
  const W = 720;
  const H = 220;
  const PAD = { l: 44, r: 12, t: 12, b: 30 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const maxT = Math.max(tau || 0, ...curve.map((p) => p.t), 1);
  const x = (t) => PAD.l + (t / maxT) * plotW;
  const y = (s) => PAD.t + (1 - s) * plotH;

  // Start at S(0)=1, which the curve does not store because it is not an event.
  let d = `M ${x(0)} ${y(1)}`;
  let prevS = 1;
  for (const p of curve) {
    d += ` L ${x(p.t)} ${y(prevS)} L ${x(p.t)} ${y(p.s)}`;
    prevS = p.s;
  }
  d += ` L ${x(maxT)} ${y(prevS)}`;

  const svg = (tag, attrs, ...kids) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== null && v !== undefined) n.setAttribute(k, String(v));
    }
    for (const kid of kids.flat()) if (kid) n.append(kid);
    return n;
  };
  const text = (tx, ty, s, anchor) =>
    svg("text", { x: tx, y: ty, "text-anchor": anchor || "middle",
      "font-size": 11, fill: "var(--ink-2, #52525b)" }, document.createTextNode(s));

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    // Sizing lives in `style`, not in the width/height ATTRIBUTES. Those are SVG lengths and
    // Chromium throws on "auto" — measured: `Error: <svg> attribute height: Expected length,
    // "auto"`. viewBox plus a CSS width is what makes it scale.
    style: "width:100%;height:auto;display:block",
    role: "img",
    "aria-label":
      `Survival curve: the share of findings still open over time, ending at ${pct(prevS * 100)}`
      + ` still open after ${days(maxT)}.`,
  });

  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    root.append(svg("line", {
      x1: PAD.l, x2: W - PAD.r, y1: y(g), y2: y(g),
      stroke: g === 0.5 ? "var(--border-strong, #d4d4d8)" : "var(--border, #e4e4e7)",
      "stroke-dasharray": g === 0.5 ? "4 3" : null,
    }));
    root.append(text(PAD.l - 8, y(g) + 4, `${Math.round(g * 100)}%`, "end"));
  }
  root.append(svg("path", {
    d: `${d} L ${x(maxT)} ${y(0)} L ${x(0)} ${y(0)} Z`,
    fill: "rgba(124, 74, 10, 0.10)", stroke: "none",
  }));
  // --accent-text, never --accent: the fill token is 1.52:1 on white and cannot carry a line.
  root.append(svg("path", { d, fill: "none", stroke: "#7c4a0a", "stroke-width": 2 }));
  root.append(text(PAD.l, H - 8, "0 d", "start"));
  root.append(text(W - PAD.r, H - 8, days(maxT), "end"));
  return root;
}

/** The headline: KM median, or its lower bound when the curve never reaches half. */
function headline(km) {
  if (km.median !== null) return { value: days(km.median), qualifier: null };
  if (km.medianLowerBound !== null) {
    return {
      value: `> ${days(km.medianLowerBound)}`,
      qualifier: "the curve never falls to half — this is a lower bound, not a median",
    };
  }
  return { value: "—", qualifier: "nothing measurable yet" };
}

function section(title, ...kids) {
  return el("section", { class: "card" },
    el("h2", { class: "section-label" }, title),
    ...kids);
}

function render(host, data) {
  clear(host);
  const { km, percentiles, openAge, buckets, sla, vendor, population } = data;
  const head = headline(km);

  const scopeName = data.scope
    ? { sca: "Dependencies", sast: "Code", secrets: "Secrets" }[data.scope]
    : "All three registers";

  host.append(pageHeader({
    hero: heroStat(
      "Time to remediate (Kaplan–Meier)",
      head.value,
      // The qualifier rides WITH the number rather than floating below the header. It is
      // not a footnote: "> 479 d" is a different KIND of answer from "479 d", and a reader
      // who takes the first for the second has been told something untrue.
      el("span", {},
        head.qualifier ? el("strong", { class: "hero-qualifier" }, head.qualifier) : null,
        head.qualifier ? el("br", {}) : null,
        `${scopeName} · ${count(km.events)} closed and ${count(km.censored)} still open, `
        + `all ${count(km.total)} in the estimate`,
      ),
    ),
    stats: [
      kpiCard("Closed-only median", days(km.naiveMedian),
        `over ${count(percentiles.overall.count)} resolved — the biased comparison`),
      kpiCard("Mean (RMST)", `${km.meanTruncated ? "≥ " : ""}${days(km.mean)}`,
        km.meanTruncated
          ? `truncated at ${days(km.restrictionTime)} — a lower bound`
          : `restricted to ${days(km.restrictionTime)}`),
      kpiCard("Open past SLA", count(sla.overall.breached),
        `${pct(sla.overall.pct)} of ${count(sla.overall.open)} open findings`),
      kpiCard("Awaiting a vendor", count(vendor.count),
        vendor.openWithVendor
          ? `${pct(vendor.pct)} of ${count(vendor.openWithVendor)} open dependencies`
          : "no open dependencies"),
    ],
  }));

  // --- the curve
  host.append(section(
    "Survival: the share still open over time",
    km.curve.length
      ? survivalChart(km.curve, km.restrictionTime)
      : emptyState("Nothing has closed yet.",
          "Every open finding is still in the estimate as a censored observation."),
    el("p", { class: "stub-note" },
      `${count(km.events)} closed findings are events; ${count(km.censored)} open findings `
      + "enter as right-censored observations rather than being discarded. "
      + "Discarding them is what makes a closed-only median describe only the things that "
      + "had time to close."),
  ));

  // --- SLA and ages, per severity
  const sevRows = SEV_ORDER
    .map((sev) => ({
      sev,
      slaStat: sla.perSev[sev] || null,
      closed: percentiles.perSev[sev] || null,
      open: openAge.perSev[sev] || null,
    }))
    .filter((r) => r.slaStat || r.closed || r.open);

  host.append(section(
    "By severity",
    sevRows.length
      ? dataTable({
          panel: true,
          columns: [
            { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
            { key: "target", label: "SLA", className: "num",
              cell: (r) => (r.slaStat && r.slaStat.target !== null
                ? `${r.slaStat.target} d`
                : el("span", { class: "muted" }, "no target")) },
            { key: "open", label: "Open", className: "num",
              cell: (r) => count(r.open ? r.open.count : 0) },
            { key: "breached", label: "Past SLA", className: "num",
              cell: (r) => (r.slaStat && r.slaStat.target !== null
                ? `${count(r.slaStat.breached)} (${pct(r.slaStat.pct)})`
                : el("span", { class: "muted" }, "—")) },
            { key: "openp50", label: "Open age p50", className: "num",
              cell: (r) => days(r.open ? r.open.p50 : null) },
            { key: "openp90", label: "Open age p90", className: "num",
              cell: (r) => days(r.open ? r.open.p90 : null) },
            { key: "closedn", label: "Closed", className: "num",
              cell: (r) => count(r.closed ? r.closed.count : 0) },
            { key: "closedp50", label: "Closed p50", className: "num",
              cell: (r) => days(r.closed ? r.closed.p50 : null) },
            { key: "closedp90", label: "Closed p90", className: "num",
              cell: (r) => days(r.closed ? r.closed.p90 : null) },
          ],
          rows: sevRows,
        })
      : emptyState("No findings in the ledger."),
    el("p", { class: "stub-note" },
      "Open counts and closed counts are different denominators and are printed separately "
      + "on purpose. A severity with no SLA target is shown as having none rather than "
      + "scored at 100% — an unset target is not a met one."),
  ));

  // --- time to close, bucketed
  const bucketRows = SEV_ORDER
    .filter((sev) => buckets.perSev[sev])
    .map((sev) => ({ sev, cells: buckets.perSev[sev] }));

  host.append(section(
    "Time to close",
    bucketRows.length
      ? dataTable({
          panel: true,
          columns: [
            { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
            ...buckets.labels.map((label, i) => ({
              key: `b${i}`, label, className: "num", cell: (r) => count(r.cells[i]),
            })),
          ],
          rows: bucketRows,
        })
      : emptyState("Nothing has closed yet.", "There is no distribution to draw."),
    el("p", { class: "stub-note" },
      `${count(buckets.total)} closed findings, of ${count(population.total)} in the ledger. `
      + "This distribution describes only what closed."),
  ));

  // --- what the page measured from
  const scopeCounts = Object.entries(population.byScope)
    .map(([s, n]) => `${s} ${count(n)}`)
    .join(" · ");
  const freshness = Object.entries(data.lastScanByScope)
    .map(([s, v]) => `${s} ${v ? v.ts.slice(0, 10) : "never scanned"}`)
    .join(" · ");
  host.append(section(
    "What this measured",
    el("p", {}, `${count(population.total)} findings — ${scopeCounts}. `
      + `${count(population.open)} open, ${count(population.resolved)} resolved.`),
    el("p", { class: "stub-note" }, `Last scan per register: ${freshness}.`),
    el("p", { class: "stub-note" },
      "SAST findings can only be resolved by disappearing between two scans — the API "
      + "exposes no resolution date for them — so their clock has a measured birth and an "
      + "estimated death. Secrets leaving the register means the string left HEAD; it does "
      + "not mean the credential was rotated."),
  ));
}

/** Time-to-remediate, and the honest qualifiers around it. */
export function renderMttr(host) {
  host.append(pageHeader({
    hero: heroStat("MTTR & SLA", "…", "Reading the ledger"),
  }));
  host.append(el("section", { class: "card" }, skeletonStack(4)));

  // swrCall, not a bare call: the cached payload paints immediately and the fresh one
  // repaints over it, so navigating back to this page does not blank it while an RPC runs.
  // Every page in both sibling apps reads this way; this one did not, and was the odd one.
  const paint = (data) => {
    if (!data) return;
      if (!data.population.total) {
        clear(host);
        host.append(pageHeader({
          hero: heroStat("MTTR & SLA", "—",
            "How long a finding actually lives, once you stop discarding everything still open."),
        }));
        host.append(el("section", { class: "card" },
          emptyState(
            "The ledger is empty.",
            "Nothing has been synced yet — and an empty ledger is shown as empty rather than "
            + "as a set of zeroes, because zero remediation time and no measurement are not "
            + "the same answer.",
          ),
          el("p", { class: "stub-note" },
            statusPill("neutral", "Dev"),
            " Run the sample sync from the dev console: "
            + "await google.script.run.api_runSampleSync({})"),
        ));
        return;
      }
    render(host, data);
  };

  swrCall("api_getMttr", {}, paint)
    .then(paint)
    .catch((err) => {
      clear(host);
      host.append(errorState(String(err && err.message ? err.message : err)));
    });
}
