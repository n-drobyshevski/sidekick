// WHAT MOVED THE NUMBER — the sentence, and the two tables that keep it honest.
//
// The domain half is `program.movementDecomposition`; this is the reading of it. The whole
// point of the section is a distinction a trend line cannot draw: an open count that fell
// because findings were fixed, and an open count that fell because the register stopped
// looking. So the sentence names both halves in the same breath — "N is measured remediation
// and N is administrative" — and the two tables below it are separate rather than one table
// with a column, because a total across them is the number this section exists to refuse.
//
// `outsideGate` RIDES IN THE ASIDE, NEVER IN A TABLE ROW. It is a stock (open findings
// currently outside the gate), not a flow over the window, so it cannot be added to either
// half without double-counting it on every subsequent window. It still has to be said out
// loud, because it is the exact quantity a narrowed gate hides.
//
// Pure and lifted out of the page for the reason overviewModel.js and mttrPaintPlan.js
// already are: the interesting cases here are payload shapes — an older cached payload with
// no movement block, a server that refused to compute one, a gap that must appear only when
// it is non-zero — and those are enumerable in node.
//
// ---------------------------------------------------------------------------------------
// THE FOUR KPI CARDS' SPARKLINES, below, are ported from
// gas_devsecops/src/client/js/pages/history.js (its `kpiView`/`kpiSparkSeries`/
// `sparkCaption`/`kmSparkCaption`) — same reasoning, same refuse-before-cast shape, the one
// difference stated where it happens (`kmSparkCaption` names the actual scan date here rather
// than a generic "as of each saved scan").
//
// `kmHalfLifeView` FROM `./mttr.js`, NOT A SECOND COPY OF THE DECISION. The MTTR page's hero
// already turns a shipped KM result into the three honest outcomes (a measured median, a
// lower bound, or "Not measured"); this page's fourth KPI card publishes the same statistic
// over the same population (src/server/api.ts's `getScanHistory` reuses `cachedMttrData()`'s
// own KM estimate rather than computing a second one), so it takes the same chooser. Reaching
// across a page module for it is the established shape here (CLAUDE.md: "Reaching across a
// page module is the established shape here"); mttr.js has no module-level side effects and
// no import path back to this file — `test/mttrViews.test.js` already imports it under plain
// vitest with no DOM.

import { fmtCount, fmtDays, num } from "../../../../../gas_shared/ui/figures.js";
import { fmtDate, pluralize } from "../../../../../gas_shared/ui/format.js";
import { sparkPath } from "../../../../../gas_shared/ui/sparkline.js";
import { kmHalfLifeView } from "./mttr.js";

/** The five figures the sentence cannot be written without. */
const REQUIRED = ["arrivals", "observed", "bounded", "reopened", "netChange"];

/** A signed movement: direction is the point, so 0 stays bare and the minus is a real one. */
function signed(n) {
  if (n === 0) return "0";
  return (n > 0 ? "+" : "−") + Math.abs(n).toLocaleString();
}

/**
 * The section's whole content, or `{ empty }` with the server's own reason.
 *
 * The refusal comes FIRST and it is an allowlist: every figure in the sentence must already
 * be a finite number. A payload cached before this figure existed carries none of them, and
 * `Number(undefined)`-style coercion would render that as a confident "Arrivals 0, closed by
 * observation 0 … the open count moved 0" — four claims about a window nobody decomposed.
 * `movementNote` travels VERBATIM from the server because the server is the only thing that
 * knows why it declined (one scan only, no scan far enough back); a note invented here would
 * be a guess printed in the same ink as a measurement.
 */
export function movementView(movement, note) {
  const fallback = typeof note === "string" && note.trim()
    ? note
    : "No movement decomposition in this payload.";
  if (!movement || typeof movement !== "object") return { empty: fallback };
  const v = {};
  for (const k of REQUIRED) {
    const n = num(movement[k]);
    if (n === null) return { empty: fallback };
    v[k] = n;
  }
  const measured = num(movement.measured) ?? v.observed;
  const administrative = num(movement.administrative) ?? v.bounded;
  const gap = num(movement.identityGap) ?? 0;
  const outsideGate = num(movement.outsideGate) ?? 0;
  const unattributed = num(movement.unattributed) ?? 0;
  const partialCounts = num(movement.partialCounts) ?? 0;
  const skippedScans = num(movement.skippedScans) ?? 0;
  const unplacedRows = num(movement.unplacedRows) ?? 0;

  const sentences = [
    `Arrivals ${fmtCount(v.arrivals)}, closed by observation ${fmtCount(v.observed)}, `
    + `dated gone by absence ${fmtCount(v.bounded)}, returned ${fmtCount(v.reopened)}; `
    + `the open count moved ${signed(v.netChange)}. Of that movement, `
    + `${fmtCount(measured)} is measured remediation and ${fmtCount(administrative)} `
    + "is administrative.",
  ];
  // Only when it is non-zero: "the books do not balance by 0" is a sentence that trains a
  // reader to skip the line that matters.
  if (gap !== 0) {
    sentences.push(
      `The books do not balance by ${signed(gap)} — that gap is published, not hidden.`,
    );
  }
  if (outsideGate > 0) {
    sentences.push(outsideGate === 1
      ? "1 open finding sits outside the current gate and was not measured by the last scan."
      : `${fmtCount(outsideGate)} open findings sit outside the current gate and were not `
        + "measured by the last scan.");
  }

  const asideRows = [];
  const aside = (n, label) => { if (n > 0) asideRows.push({ label, count: n }); };
  aside(outsideGate, "Open, outside the last scan's severity gate");
  aside(unattributed, "Resolved in the window with no recorded provenance");
  aside(partialCounts, "Scan counts refused — not a number, so not a zero");
  aside(skippedScans, "Scans with an unreadable timestamp, placed in no window");
  aside(unplacedRows, "Rows with no readable first_seen, absent from the replay");

  return {
    sentence: sentences.join(" "),
    sentences,
    measuredRows: [{
      cause: "Closed by observation",
      basis: "the API reported the finding resolved",
      count: v.observed,
    }],
    administrativeRows: [{
      cause: "Dated gone by absence",
      basis: "the scan stopped seeing it — an upper bound on the date, not a measurement",
      count: v.bounded,
    }],
    asideRows,
  };
}

// =========================================================================================
//  The KPI band — four cards, each with its own sparkline
// =========================================================================================

/**
 * The Resolved card's own denominator: the resolved share of everything ever tracked.
 *
 * REFUSES A ZERO BASE, rather than rendering a fake "0.0%". `Number(null)` and `Number(0)`
 * are both finite, so a payload that has tracked nothing yet must be caught BEFORE the
 * division, not after — the same rule CLAUDE.md's `Number(null)` entries keep restating.
 */
export function resolvedSharePct(kpis) {
  const k = kpis || {};
  const tracked = num(k.tracked, 0);
  const resolved = num(k.resolvedAllTime, 0);
  return tracked > 0 ? (resolved / tracked) * 100 : null;
}

/**
 * The four KPI cards' figures: tracked / open / resolved / the remediation half-life.
 *
 * THE FOURTH CARD NEVER PRINTS THE NAIVE MEDIAN — this used to be `kpis.medianMttr`
 * (`overall.mttr_median`, domain/lifecycle.ts), the plain median over CLOSED rows only,
 * rendered under a card whose own sparkline plots `km_median_days` — the Kaplan–Meier
 * estimate, which keeps every still-open row in as a right-censored observation. Those are
 * two different statistics over two different populations (the naive figure drops whichever
 * findings have not resolved yet), and reading `medianMttr` under a "Remediation half-life"
 * label — the KM entry's own title (see `helpContent.js`'s `half-life` entry) — publishes a
 * real number under the wrong name. `src/server/api.ts`'s `scanHistoryData` no longer ships
 * `medianMttr` at all; this reads `kpis.kmMedian` / `kpis.kmMedianLowerBound` — the SAME
 * estimate the MTTR page's own hero renders, over the SAME population (see `getScanHistory`'s
 * reuse of `cachedMttrData()`) — through the one chooser both pages now share.
 */
export function kpiView(kpis) {
  const k = kpis || {};
  const tracked = num(k.tracked, 0);
  const resolved = num(k.resolvedAllTime, 0);
  return {
    tracked,
    open: num(k.open, 0),
    resolvedAllTime: resolved,
    halfLife: kmHalfLifeView({
      median: k.kmMedian ?? null,
      medianLowerBound: k.kmMedianLowerBound ?? null,
    }),
    resolvedSharePct: resolvedSharePct(k),
  };
}

/**
 * THE FOUR KPI SERIES, AS SLOTS — one entry per trend point, a non-number left as a GAP.
 *
 * Ported from gas_devsecops/src/client/js/pages/history.js; see that module's header for the
 * full account of why the band gets a line at all. The one fact worth restating here:
 * `tracked` is `open + resolved` computed FROM THE SAME TWO SERIES the payload ships, not a
 * field of its own — `domain/trend.ts`'s per-point `open` ("first seen by this date, not
 * resolved by it") and `resolved` ("resolved by this date") sum to exactly the rows first
 * seen by that date, the definition of `kpis.tracked`.
 *
 * REFUSED BY TYPE, BEFORE ANY CAST, and the sum inherits the refusal: if EITHER half of a
 * point is missing, the tracked slot is a gap rather than a half-total — `(open||0)+
 * (resolved||0)` would print a confident 0 exactly where nothing was measured, the trap
 * `sparkPath`'s own header names. A gap here keeps its x position and breaks the line rather
 * than compressing time.
 */
export function kpiSparkSeries(trend) {
  const points = Array.isArray(trend) ? trend : [];
  return {
    tracked: points.map((p) => {
      const open = num(p.open);
      const resolved = num(p.resolved);
      return open === null || resolved === null ? null : open + resolved;
    }),
    open: points.map((p) => num(p.open)),
    resolved: points.map((p) => num(p.resolved)),
    // `km_median_days` arrives already masked server-side (a date whose curve never reached
    // half carries `null`) — kept as null here, never cast, so the line breaks rather than
    // reads as a measured zero.
    halfLife: points.map((p) => num(p.km_median_days)),
  };
}

/**
 * What a sparkline's caption says, in the register's own words — pure, so the wording is
 * testable without a DOM. `format` defaults to `fmtCount` (the three findings-count cards);
 * the half-life card passes `fmtDays` through `kmSparkCaption` below.
 *
 * A FLAT SERIES SAYS IT IS FLAT rather than restating one endpoint twice, and a series with
 * fewer than two measured readings says so instead of describing a shape nothing drew.
 */
export function sparkCaption(model, format) {
  const fmt = typeof format === "function" ? format : fmtCount;
  if (!model || model.n === 0) return "Not measured";
  if (model.n === 1) return "One reading, " + fmt(model.first);
  const readings = model.gaps
    ? fmtCount(model.n) + " of " + fmtCount(model.n + model.gaps) + " readings measured"
    : fmtCount(model.n) + " " + pluralize(model.n, "reading");
  const range = model.first === model.last
    ? "flat at " + fmt(model.first)
    : fmt(model.first) + " to " + fmt(model.last);
  return readings + ", " + range;
}

/**
 * The half-life card's caption — the series' own shape, PLUS THE SCAN IT WAS READ AS OF.
 *
 * THE FIGURE ABOVE AND THE LINE BELOW ARE NOT THE SAME INSTANT: the card's value is
 * `kpis.kmMedian`, a curve fitted at REQUEST TIME over every visible row; each reading on the
 * line is `km_median_days`, the register replayed as it stood on ONE SAVED SCAN. Naming the
 * anchor is what keeps that legible instead of implied — and this anchors to the actual DATE
 * of the last MEASURED reading (walking back from the end, since the mask can leave the
 * trend's own final point null), not to a generic "as of each saved scan" — the ledger
 * already has the date, so printing a placeholder phrase over it would throw away a fact
 * the register can state.
 *
 * TAKES THE RAW TREND ROWS, not a `sparkPath` model — unlike `sparkCaption` above, which never
 * sees a date. `points` is `trend` itself (`{date, km_median_days, ...}[]`); the model is
 * built here, once, from the same values `kpiSparkSeries(trend).halfLife` would produce.
 *
 * NOTHING TO ANCHOR WHEN NOTHING WAS READ — `sparkCaption` already answers "Not measured" for
 * an all-gap series, and dating that would put a scan behind a figure no scan produced.
 */
export function kmSparkCaption(points) {
  const rows = Array.isArray(points) ? points : [];
  const model = sparkPath(rows.map((p) => num(p && p.km_median_days)), { w: 120, h: 28 });
  const caption = sparkCaption(model, fmtDays);
  if (model.n === 0) return caption;
  let anchorDate = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (num(rows[i] && rows[i].km_median_days) !== null) {
      anchorDate = rows[i].date;
      break;
    }
  }
  return anchorDate ? caption + " — as of " + fmtDate(anchorDate) : caption;
}
