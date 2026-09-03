// MTTR & SLA — how long a finding actually lives, once you stop discarding everything that
// is still open.
//
// THE CLOCK IS THE PRODUCT, AND A CLOCK HAS TO SAY WHERE IT STARTED (PRODUCT.md's sixth
// principle). Every figure on this page states what it measured from and what it did with
// the rows it could not measure:
//
//   * the survival estimate keeps still-open findings as RIGHT-CENSORED observations rather
//     than dropping them, and the censored count is printed beside the estimate;
//   * where the curve never falls to half there is no median, so `medianLowerBound` is
//     published as "at least N days" and flagged as a bound — `kmHalfLifeView` below is the
//     one place that decision is made, for this page AND for Executive, which imports it;
//   * every rate carries a visible denominator node, because a percentage whose base is
//     invisible is the failure this register exists to avoid.
//
// THE SECOND CLOCK IS SCA-ONLY AND SAYS SO IN ITS OWN HEADING. `ledgerCore.baseRows`
// collapses `fix_available_at` onto `first_seen` for sast and secrets — they have no vendor
// to wait on — so `mttr_actionable_days === mttr_days` and `awaiting_vendor_fix === false`
// there BY CONSTRUCTION. The server already refuses to average it across three scopes
// (`readModels.buildMttr` computes `remediation.actionable` over sca rows only and ships
// `scope`, `rowCount` and `notMeasured` with it); `actionableClockView` refuses the same
// framing on the client, loudly, rather than trusting a caller to remember.
//
// WHAT THIS PAYLOAD DOES NOT CARRY. `remediation.kmMedianPerSev` / `kmP90PerSev` /
// `kmLowerBoundPerSev` are per-severity STATISTICS; there is no per-severity `curve` in the
// payload, so the per-severity view here is a table of those three statistics and not a fan
// of curves. `shipKM` also drops `naiveMedian` / `naiveMean`, so the survival chart draws the
// two Kaplan-Meier markers and no closed-only comparison.

import { swrCall } from "../store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  clear, dataTable, el, emptyState, heroStat, kpiCard, onPageTeardown, pageHeader, pluralize,
  sectionLabel, sevBadge, sevEntries, sevSegmentBar, skeleton, statRow,
} from "../ui.js";

// ---------------------------------------------------------------------------- formatting

/**
 * A day count as words. Null / undefined / NaN is an em dash — never a zero, because a zero
 * here would be a measurement and an absent value is not one.
 *
 * Lives on this page rather than in `ui/format.js` because that module is not this package's
 * to edit; see the report. Executive imports it from here rather than keeping a second copy.
 */
export function fmtDays(days) {
  const d = Number(days);
  if (days === null || days === undefined || !Number.isFinite(d)) return "—";
  const n = d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
  return n + " " + pluralize(n, "day");
}

/** A count as a grouped figure; absent is a dash rather than a 0. */
export function fmtCount(n) {
  return n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString();
}

/** A percentage to one decimal. Only ever called through `rateView`, which owns the nulls. */
function fmtPct(p) {
  const n = Number(p);
  return (Math.round(n * 10) / 10) + "%";
}

// ------------------------------------------------------------------------- view models

/**
 * The half-life decision, in ONE place, for every surface that draws it.
 *
 * Three outcomes, three different claims:
 *
 *   median present         "41 days"           a measured median
 *   median null + bound    "at least 41 days"  the curve never reached half. The bound is the
 *                                              longest observation, so the median is at LEAST
 *                                              that far out. `isLowerBound` is true.
 *   neither                "Not measured"      nothing to rest on. NOT zero.
 *
 * Rendering the middle case as a bare number would publish a median nobody observed;
 * collapsing it to a dash would throw away a true statement. So it is published, prefixed,
 * and flagged — and the flag is what a caller styles or captions off, never the string.
 *
 * @param {object|null|undefined} km  a shipped KMResult (`{median, medianLowerBound, …}`)
 * @returns {{measured: boolean, value: string, isLowerBound: boolean, days: number|null}}
 */
export function kmHalfLifeView(km) {
  const median = km && km.median !== null && km.median !== undefined ? Number(km.median) : null;
  const bound = km && km.medianLowerBound !== null && km.medianLowerBound !== undefined
    ? Number(km.medianLowerBound)
    : null;
  if (median !== null && Number.isFinite(median)) {
    return { measured: true, value: fmtDays(median), isLowerBound: false, days: median };
  }
  if (bound !== null && Number.isFinite(bound)) {
    return {
      measured: true,
      value: "at least " + fmtDays(bound),
      isLowerBound: true,
      days: bound,
    };
  }
  return { measured: false, value: "Not measured", isLowerBound: false, days: null };
}

/**
 * A rate and the base it was taken over, as one object.
 *
 * A DENOMINATOR OF ZERO IS NOT A ZERO PERCENT. `num / 0` is not a rate at all, and both
 * `NaN%` and a confident `0%` would be claims about a population that does not exist. So the
 * text degrades to "not measured" and `measured` is false, while `denominator` and
 * `denominatorLabel` still travel — the reader is told what the figure would have been taken
 * over, which is the part that makes the absence legible.
 *
 * Every rate on this page goes through here, and every rendered rate puts
 * `denominator`/`denominatorLabel` into a `[data-denominator]` node beside the figure.
 *
 * @param {number|null|undefined} pct  a percentage the server already computed, or null
 * @param {number} denominator         the base it was taken over
 * @param {string} denominatorLabel    what that base counts, in words
 */
export function rateView(pct, denominator, denominatorLabel) {
  const den = Number(denominator);
  const value = pct === null || pct === undefined ? null : Number(pct);
  const usable = Number.isFinite(den) && den > 0 && value !== null && Number.isFinite(value);
  return {
    measured: usable,
    value: usable ? value : null,
    text: usable ? fmtPct(value) : "not measured",
    denominator: Number.isFinite(den) ? den : null,
    denominatorLabel,
  };
}

/** The hero: the register's half-life, with the estimator's own three counts beside it. */
export function mttrHeroView(mttr) {
  const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
  const half = kmHalfLifeView(km);
  const events = Number((km && km.events) || 0);
  const censored = Number((km && km.censored) || 0);
  const total = Number((km && km.total) || 0);
  return {
    ...half,
    events,
    censored,
    total,
    rowCount: Number((mttr && mttr.rowCount) || 0),
    // The censored count IS the qualifier — the estimate is only honest because those rows
    // stayed in, so the page never prints the number without them.
    qualifier: total
      ? fmtCount(total) + " observations · " + fmtCount(events) + " closed (events) · "
        + fmtCount(censored) + " still open (censored)"
      : "No observations yet.",
  };
}

/** The restricted mean, and the "≥" it earns when survival never reached zero. */
export function rmstView(km) {
  const mean = km && km.mean !== null && km.mean !== undefined ? Number(km.mean) : null;
  if (mean === null || !Number.isFinite(mean)) {
    return { measured: false, text: "Not measured", truncated: false, restrictionTime: null };
  }
  const truncated = !!(km && km.meanTruncated);
  return {
    measured: true,
    truncated,
    text: (truncated ? "≥ " : "") + fmtDays(mean),
    restrictionTime: km && km.restrictionTime !== null && km.restrictionTime !== undefined
      ? Number(km.restrictionTime)
      : null,
  };
}

/**
 * The remediation clock per severity: the Kaplan-Meier statistics, not the naive closed-only
 * ones. `kmLowerBoundPerSev` is shipped alongside `kmMedianPerSev`, so a severity whose curve
 * never falls to half gets "at least N days" here too rather than a dash.
 */
export function mttrSeverityRows(mttr, order) {
  const rem = (mttr && mttr.remediation) || {};
  const perSev = (mttr && mttr.perSev) || {};
  const medians = rem.kmMedianPerSev || {};
  const bounds = rem.kmLowerBoundPerSev || {};
  const p90s = rem.kmP90PerSev || {};
  const levels = (order || []).concat(["UNKNOWN"]).filter((s, i, a) => a.indexOf(s) === i);
  return levels
    .filter((sev) => perSev[sev] || medians[sev] !== undefined)
    .map((sev) => {
      const s = perSev[sev] || {};
      const half = kmHalfLifeView({
        median: medians[sev] === undefined ? null : medians[sev],
        medianLowerBound: bounds[sev] === undefined ? null : bounds[sev],
      });
      return {
        sev,
        half,
        p90: p90s[sev] === undefined ? null : p90s[sev],
        resolved: Number(s.resolved || 0),
        open: Number(s.open || 0),
      };
    });
}

/**
 * SLA per severity: the share met, the overdue count, and how old the open backlog is.
 *
 * TWO DIFFERENT DENOMINATORS SIT IN ONE ROW and mixing them is the mistake this shape stops.
 * "In SLA" is taken over RESOLVED findings — of the ones that closed, how many closed inside
 * the window. "Open past SLA" is taken over OPEN findings — of the ones still running, how
 * many have already blown it. A single "SLA %" over everything would be neither.
 */
export function slaSeverityRows(mttr, order) {
  const perSev = (mttr && mttr.perSev) || {};
  const past = ((mttr && mttr.remediation && mttr.remediation.openPastSla) || {}).perSev || {};
  const levels = (order || []).concat(["UNKNOWN"]).filter((s, i, a) => a.indexOf(s) === i);
  return levels
    .filter((sev) => perSev[sev] || past[sev])
    .map((sev) => {
      const s = perSev[sev] || {};
      const p = past[sev] || {};
      const resolved = Number(s.resolved || 0);
      const open = Number(p.open === undefined ? s.open || 0 : p.open);
      return {
        sev,
        target: s.sla_target === null || s.sla_target === undefined ? null : Number(s.sla_target),
        inSla: rateView(s.sla_pct, resolved, fmtCount(resolved) + " resolved"),
        breached: Number(p.breached || 0),
        pastSla: rateView(p.pct, open, fmtCount(open) + " open"),
        openP50: s.open_age_p50 === undefined ? null : s.open_age_p50,
        openP90: s.open_age_p90 === undefined ? null : s.open_age_p90,
        resolved,
        open,
      };
    });
}

/**
 * Time-to-close as a distribution, with each bucket's share taken over the resolved
 * population the histogram actually covers.
 *
 * `buckets.total` is the count of RESOLVED lifecycles that landed in a bucket — open
 * findings are not in this figure at all, which is exactly why the survival curve above it
 * exists. The caption says so; the share's denominator node says so again next to the number.
 */
export function resolutionBucketView(buckets) {
  const labels = (buckets && buckets.labels) || [];
  const perSev = (buckets && buckets.perSev) || {};
  const total = Number((buckets && buckets.total) || 0);
  const rows = labels.map((label, i) => {
    const counts = {};
    let count = 0;
    for (const [sev, arr] of Object.entries(perSev)) {
      const n = Number((arr && arr[i]) || 0);
      if (n) counts[sev] = n;
      count += n;
    }
    return {
      label,
      count,
      counts,
      share: rateView(total > 0 ? (count / total) * 100 : null, total, fmtCount(total) + " resolved"),
    };
  });
  return { show: labels.length > 0, labels, rows, total };
}

/**
 * The awaiting-a-vendor-fix segment: open SCA findings with no published fix.
 *
 * `notApplicable` is the count of open sast/secrets rows whose flag read true anyway — the
 * server refuses to trust it, and so does this. Rendering it keeps "we did not count these"
 * distinct from "there were none".
 */
export function awaitingView(mttr) {
  const a = (mttr && mttr.remediation && mttr.remediation.awaiting) || null;
  if (!a) return { show: false };
  const openTotal = Number(a.openTotal || 0);
  return {
    show: true,
    overall: Number(a.overall || 0),
    notApplicable: Number(a.notApplicable || 0),
    share: rateView(a.pctOfOpen, openTotal, fmtCount(openTotal) + " open findings"),
  };
}

/**
 * The second clock, and the framing it refuses.
 *
 * `remediation.actionable` is computed over SCA rows ONLY (readModels.buildMttr) and carries
 * `scope: "sca"`, its own `rowCount`, and `notMeasured` — the rows it declined to price. SAST
 * and secrets have no vendor to wait on, so their `fix_available_at` collapses onto
 * `first_seen`: their actionable clock is their MTTR, identically, by construction. A
 * register-wide "actionable MTTR" would therefore be two-thirds a restatement of the figure
 * in the hero, dressed as a second measurement.
 *
 * So this THROWS on `{registerWide: true}` rather than quietly obliging. The server already
 * scopes the computation; a client that relabels it is the remaining way the mistake could
 * ship, and a caller who wants a register-wide actionable figure is asking for something that
 * does not exist rather than for a different presentation of something that does.
 */
export function actionableClockView(mttr, opts) {
  if (opts && opts.registerWide) {
    throw new Error(
      "The actionable clock is SCA-only. sast and secrets have no vendor to wait on, so their "
      + "actionable clock is identical to their MTTR by construction and a register-wide "
      + "figure would be two thirds a restatement of it.",
    );
  }
  const a = (mttr && mttr.remediation && mttr.remediation.actionable) || null;
  const base = {
    appliesTo: "sca",
    coversRegister: false,
    scopeLabel: "SCA only",
    heading: "The two clocks — SCA only",
    note: "SAST and secrets have no vendor to wait on, so their fix-available date collapses "
      + "onto first detection: their actionable clock is identical to their MTTR by "
      + "construction. Only SCA can leave a fix date unknown, and a null there is what puts a "
      + "finding in the awaiting-a-vendor bucket rather than in the actionable one.",
  };
  if (!a) return { ...base, show: false };
  const rowCount = Number(a.rowCount || 0);
  const notMeasured = Number(a.notMeasured || 0);
  const half = kmHalfLifeView(a.km);
  const latency = a.vendorLatency || null;
  const segments = (latency && latency.segments) || null;
  return {
    ...base,
    show: true,
    rowCount,
    notMeasured,
    half,
    // Deliberately a rate view like every other: the denominator is the SCA population, not
    // the register, and the node beside the figure has to say which.
    coverage: rateView(
      rowCount + notMeasured > 0 ? (rowCount / (rowCount + notMeasured)) * 100 : null,
      rowCount + notMeasured,
      fmtCount(rowCount + notMeasured) + " findings in scope, " + fmtCount(notMeasured)
        + " of them outside this clock",
    ),
    latency: latency ? kmHalfLifeView(latency) : null,
    segments,
  };
}

// ----------------------------------------------------------------------------- the page

function scopeParam(params) {
  const s = params && params.scope;
  return s === "sca" || s === "sast" || s === "secrets" ? s : null;
}

/** A `[data-denominator]` node — every rate on this page is followed by one of these. */
function denominatorNode(rate) {
  return el("span", {
    class: "small muted",
    "data-denominator": rate.denominator === null ? "none" : String(rate.denominator),
  }, rate.denominatorLabel);
}

/** A rate and its base as one cell: the figure, then the base under it. */
function rateCell(rate) {
  return el("span", {}, el("span", { class: "num" }, rate.text), " ", denominatorNode(rate));
}

export async function renderMttr(host, params, _ctx) {
  const scope = scopeParam(params);

  let paint = null;
  const data = swrCall(
    "api_getMttrPage",
    scope ? { scope } : {},
    (fresh) => paint && paint(fresh),
  );

  const heroHost = el("div", {});
  const curveHost = el("div", {});
  const sevHost = el("div", {});
  const slaHost = el("div", {});
  const bucketHost = el("div", {});
  const clockHost = el("div", {});
  const trendHost = el("div", {});
  host.append(heroHost, curveHost, sevHost, slaHost, bucketHost, clockHost, trendHost);

  let live = true;
  onPageTeardown(() => { live = false; });

  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[mttr] " + label + " render failed:", e);
      clear(target).append(emptyState("Couldn't render " + label + "."));
    }
  }

  clear(heroHost).append(
    el("div", { role: "status", "aria-label": "Computing the remediation clock" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );

  paint = (payload) => {
    const mttr = payload && payload.mttr;
    guard("the half-life", heroHost, () => renderHero(mttr));
    guard("the survival curve", curveHost, () => renderCurve(mttr));
    guard("the per-severity clock", sevHost, () => renderSeverity(mttr));
    guard("SLA by severity", slaHost, () => renderSla(mttr));
    guard("the time-to-close distribution", bucketHost, () => renderBuckets(mttr));
    guard("the two clocks", clockHost, () => renderClocks(mttr));
    guard("the half-life trend", trendHost, () => renderTrend(payload && payload.trends));
  };

  try {
    paint(await data);
  } catch (e) {
    console.error("[mttr] api_getMttrPage failed:", e);
    clear(heroHost).append(emptyState(
      "Couldn't load remediation data.",
      String((e && e.message) || e),
    ));
  }

  // ------------------------------------------------------------------------------ hero

  function renderHero(mttr) {
    const view = mttrHeroView(mttr);
    const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
    const rmst = rmstView(km);
    const overallSla = rateView(
      mttr && mttr.slaPct,
      Number((mttr && mttr.overall && mttr.overall.resolved) || 0),
      fmtCount(Number((mttr && mttr.overall && mttr.overall.resolved) || 0)) + " resolved",
    );

    clear(heroHost);
    heroHost.append(pageHeader({
      hero: heroStat("Remediation half-life", view.value, view.qualifier, { term: "half-life" }),
      stats: [
        statRow(
          "Censored",
          fmtCount(view.censored),
          "open findings kept in as evidence",
          null,
          { term: "censoring" },
        ),
        statRow("P90 (KM)", fmtDays(km && km.p90), "nine in ten close by here"),
        statRow(
          "Restricted mean",
          rmst.text,
          rmst.truncated
            ? "a lower bound — survival had not reached zero at " + fmtDays(rmst.restrictionTime)
            : "area under the curve to " + fmtDays(rmst.restrictionTime),
        ),
      ],
    }));

    const slaLine = el("p", { class: "small muted" },
      "Resolved inside the SLA window: ",
      el("span", { class: "num" }, overallSla.text),
      " ",
      denominatorNode(overallSla),
      ". ",
    );
    slaLine.append(el("span", {}, "The comparison is inclusive — on or before the target."));
    heroHost.append(slaLine);

    if (view.isLowerBound) {
      heroHost.append(el("p", { class: "small muted" },
        "The curve never falls to half within the observed window, so there is no median to"
        + " publish. More than half of what is tracked is still open; the bound above is what"
        + " is actually true."));
    }
    const awaiting = awaitingView(mttr);
    if (awaiting.show) {
      heroHost.append(el("p", { class: "small muted" },
        "Awaiting a vendor fix: ",
        el("span", { class: "num" }, fmtCount(awaiting.overall)),
        " open SCA findings — ",
        el("span", { class: "num" }, awaiting.share.text),
        " ",
        denominatorNode(awaiting.share),
        ". Those sit outside every deadline until a fix exists."
        + (awaiting.notApplicable
          ? " " + fmtCount(awaiting.notApplicable) + " open findings outside SCA carried the"
            + " flag anyway and were refused rather than counted."
          : "")));
    }
  }

  // ------------------------------------------------------------------- the survival curve

  function renderCurve(mttr) {
    const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
    clear(curveHost);
    curveHost.append(sectionLabel("Survival curve", { term: "censoring" }));

    if (!km || !Array.isArray(km.curve) || !km.curve.length) {
      curveHost.append(el("div", { class: "card" }, emptyState(
        "No curve yet.",
        "The estimator needs at least one closed finding with a readable clock. Open findings"
        + " alone give a censored population and no event to step down on.",
      )));
      return;
    }

    const canvas = el("canvas", { "aria-label": "Kaplan-Meier survival curve" });
    const card = el("section", { class: "chart-card" },
      el("p", { class: "chart-note" },
        "Closed findings are events; open findings enter as right-censored observations at"
        + " their current age. " + fmtCount(km.events) + " " + pluralize(km.events, "event")
        + ", " + fmtCount(km.censored) + " censored. The closed-only comparison markers are not"
        + " in this payload, so the two markers drawn are both Kaplan-Meier."),
      el("div", { class: "chart-box" }, canvas));
    curveHost.append(card);

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.survivalCurve(canvas, km.curve, { median: km.median, mean: km.mean }, {});
    }).catch(() => {
      if (live) chartUnavailable(canvas);
    });
  }

  // ------------------------------------------------------------ the clock, per severity

  function renderSeverity(mttr) {
    const rows = mttrSeverityRows(mttr, SEVERITY_ORDER);
    clear(sevHost);
    sevHost.append(sectionLabel("The clock, by severity"));
    if (!rows.length) {
      sevHost.append(emptyState("No per-severity clock yet."));
      return;
    }
    sevHost.append(dataTable({
      columns: [
        { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
        {
          key: "half",
          label: "Half-life",
          className: "num",
          help: { term: "half-life" },
          cell: (r) => r.half.value,
        },
        { key: "p90", label: "P90", className: "num", cell: (r) => fmtDays(r.p90) },
        { key: "resolved", label: "Resolved", className: "num", cell: (r) => fmtCount(r.resolved) },
        { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
      ],
      rows,
    }));
    sevHost.append(el("p", { class: "small muted" },
      "Each severity gets its own curve; what the payload carries is that curve's median, its"
      + " lower bound and its P90, not the curve itself. \"at least N days\" in the half-life"
      + " column means that severity's curve never fell to half."));
  }

  // ------------------------------------------------------------------------------- SLA

  function renderSla(mttr) {
    const rows = slaSeverityRows(mttr, SEVERITY_ORDER);
    clear(slaHost);
    slaHost.append(sectionLabel("SLA by severity", { term: "sla-target" }));
    if (!rows.length) {
      slaHost.append(emptyState("No SLA figures yet."));
      return;
    }
    slaHost.append(dataTable({
      columns: [
        { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
        {
          key: "target",
          label: "Target",
          className: "num",
          help: { term: "sla-target" },
          cell: (r) => fmtDays(r.target),
        },
        { key: "inSla", label: "Resolved in SLA", cell: (r) => rateCell(r.inSla) },
        {
          key: "breached",
          label: "Open past SLA",
          // The count AND the rate AND the base. The count alone hides how big the backlog
          // it came out of is; the rate alone hides how many findings that actually is.
          cell: (r) => el("span", {},
            el("span", { class: "num" }, fmtCount(r.breached)),
            el("span", { class: "small muted" }, " (" + r.pastSla.text + ") "),
            denominatorNode(r.pastSla)),
        },
        { key: "p50", label: "Open age P50", className: "num", cell: (r) => fmtDays(r.openP50) },
        { key: "p90", label: "Open age P90", className: "num", cell: (r) => fmtDays(r.openP90) },
      ],
      rows,
    }));
    slaHost.append(el("p", { class: "small muted" },
      "Two denominators sit in this table and they are not interchangeable. \"Resolved in"
      + " SLA\" is taken over what closed; \"Open past SLA\" is taken over what is still"
      + " running. A single SLA percentage over everything would be neither."));
  }

  // ------------------------------------------------------------------- time to close

  function renderBuckets(mttr) {
    const view = resolutionBucketView(mttr && mttr.remediation && mttr.remediation.buckets);
    clear(bucketHost);
    bucketHost.append(sectionLabel("Time to close"));
    if (!view.show || !view.total) {
      bucketHost.append(emptyState(
        "Nothing has closed yet.",
        "This histogram covers resolved lifecycles only — which is exactly why the survival"
        + " curve above it exists.",
      ));
      return;
    }
    bucketHost.append(dataTable({
      columns: [
        { key: "label", label: "Closed within", cell: (r) => r.label },
        { key: "count", label: "Findings", className: "num", cell: (r) => fmtCount(r.count) },
        { key: "share", label: "Share", cell: (r) => rateCell(r.share) },
        {
          key: "mix",
          label: "Severity mix",
          cell: (r) => {
            const entries = sevEntries(r.counts, SEVERITY_ORDER);
            return sevSegmentBar(entries, {
              size: "md",
              label: entries.length
                ? entries.map((e) => e.count + " " + e.sev).join(", ")
                : "no findings in this bucket",
              emptyHatch: true,
            });
          },
        },
      ],
      rows: view.rows,
    }));
    bucketHost.append(el("p", { class: "small muted" },
      "Resolved lifecycles only. Open findings are not in this distribution at any bucket —"
      + " they are in the curve above, as censored observations."));
  }

  // ------------------------------------------------------------------- the two clocks

  function renderClocks(mttr) {
    const view = actionableClockView(mttr);
    clear(clockHost);
    clockHost.append(sectionLabel(view.heading, { term: "two-clocks" }));
    if (!view.show) {
      clockHost.append(emptyState("No actionable clock in this payload."));
      clockHost.append(el("p", { class: "small muted" }, view.note));
      return;
    }

    const row = el("div", { class: "kpi-row" });
    row.append(kpiCard(
      "Actionable half-life",
      view.half.value,
      "measured from the day a fix became available — " + view.scopeLabel,
      null,
      { term: "two-clocks" },
    ));
    row.append(kpiCard(
      "Waiting for a vendor",
      view.latency ? view.latency.value : "—",
      "detection to a fix existing, over the pre-toggle SCA population",
      null,
      { term: "awaiting-fix" },
    ));
    row.append(kpiCard(
      "Measured here",
      fmtCount(view.rowCount),
      "SCA lifecycles",
    ));
    clockHost.append(row);

    clockHost.append(el("p", { class: "small muted" },
      "Coverage of this clock: ",
      el("span", { class: "num" }, view.coverage.text),
      " ",
      denominatorNode(view.coverage),
      "."));
    clockHost.append(el("p", { class: "small muted" }, view.note));

    if (view.segments) {
      const s = view.segments;
      clockHost.append(el("p", { class: "small muted" },
        "The vendor-wait population divides as: " + fmtCount(s.events) + " fixes observed ("
        + fmtCount(s.zeroAtOrigin) + " of them already available at detection), "
        + fmtCount(s.censored) + " still open with no fix, " + fmtCount(s.closedBeforeFix)
        + " closed before any fix was seen, and " + fmtCount(s.unmeasured)
        + " with no readable origin — outside the estimate entirely rather than counted as"
        + " zero."));
    }
  }

  // ---------------------------------------------------------------- half-life over time

  function renderTrend(trends) {
    const points = (trends && Array.isArray(trends.trend) ? trends.trend : [])
      .filter((p) => p && p.date);
    clear(trendHost);
    trendHost.append(sectionLabel("Half-life over time"));
    if (points.length < 2) {
      trendHost.append(el("div", { class: "card" }, emptyState(
        "Not enough history to draw a line.",
        "The backbone emits one point per saved scan plus one per day of pre-scan history;"
        + " two points are the minimum.",
      )));
      return;
    }
    const reconstructed = points.filter((p) => p.reconstructed).length;
    const canvas = el("canvas", { "aria-label": "Remediation half-life over time, in days" });
    trendHost.append(el("section", { class: "chart-card" },
      el("p", { class: "chart-note" },
        "Kaplan-Meier median days, evaluated as of each date."
        + (reconstructed
          ? " The first " + fmtCount(reconstructed) + " "
            + pluralize(reconstructed, "point") + " " + (reconstructed === 1 ? "is" : "are")
            + " reconstructed from first-detection dates before the first saved scan, where"
            + " closures are under-counted — read those as not measured."
          : "")),
      el("div", { class: "chart-box" }, canvas)));

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.trendLine(
        canvas,
        points.map((p) => ({ x: p.date, y: p.km_median_days })),
        {
          yLabel: "days",
          series: [{
            label: "Half-life (KM)",
            color: charts.ACCENT,
            data: points.map((p) => p.km_median_days),
          }],
        },
      );
    }).catch(() => {
      if (live) chartUnavailable(canvas);
    });
  }
}

/**
 * The severity order this page ranks by.
 *
 * Hard-coded rather than read off `bootstrap()` on purpose: this page's only use for it is
 * ROW ORDER, and a table that silently reordered itself because a bootstrap key moved would
 * be worse than one that states its order. `src/domain/config.ts` holds the same list and
 * `test/tokens.test.js` pins it there.
 */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
