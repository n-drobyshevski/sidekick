// Coverage & efficiency — did the effort land where it mattered, and can it keep up.
//
// A RATE WITHOUT ITS INTERVAL IS THE THING THIS PAGE EXISTS NOT TO DO. Coverage and
// efficiency are conditional on a classification that does not reach every row: a secret
// cannot be scored by the risk rule at all, and a CVE with no KEV / EPSS / exploit signal
// captured is unclassified rather than low. `domain/program.ts` therefore publishes each rate
// as `{point, lo, hi}`, where the bounds are the extreme re-labellings of the unclassified
// rows — "every unclassified-open row was really high risk" against "every
// unclassified-remediated row was". The WIDTH of that bracket IS the size of the doubt, and
// `boundedRateView` below never renders `point` without it.
//
// THE UNCLASSIFIED ROW STAYS OUTSIDE THE 2x2. Folding it into a corner would make it
// indistinguishable from a measurement, and it is the opposite of one. `confusionView` returns
// exactly four cells and a separate `unclassified` block; the four cells sum to `classified`,
// never to `total`.
//
// ABSENT IS NEVER ZERO, AND 0% IS NOT ABSENT. `signalCoverage.ai_verdict` reads 0% in this
// tenant — the field is not being returned, or the verdict strings do not match — and that is
// a MEASUREMENT of an unverified signal, so it is rendered rather than hidden. A signal with
// no applicable rows at all is a third state again (`coveragePct: null`), and reads "not
// applicable", not "0%". The three are drawn as three things.
//
// CAPACITY MONTHS THAT WERE NOT WATCHED SAY SO. `partial` is the current month, still
// running; `reconstructed` is a month that ended before this register started watching, so
// its figures were rebuilt from first-detection dates rather than observed. Both are marked
// and both are excluded from the headline close rate by the server — `monthsCounted` is
// published beside it so the sample can be checked.

import { bootstrap, swrCall } from "../store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  chartTable, chartTableModel, clear, dataTable, el, emptyState, errorState, firstRunNotice,
  glossaryTip, heroStat, kpiCard,
  onPageTeardown, pageHeader, pluralize, sectionLabel, skeleton, statRow, statusPill,
} from "../ui.js";
import { fmtCount, fmtDays } from "./mttr.js";

// ---------------------------------------------------------------------------- formatting

function fmtPct(p) {
  const n = Number(p);
  return (Math.round(n * 10) / 10) + "%";
}

const SCOPE_LABELS = { sca: "Dependencies (SCA)", sast: "Code (SAST)", secrets: "Secrets" };

/** The six risk clauses, in the order `domain/program.ts` fixes them, with their labels and
 *  the `signalCoverage` key each one rests on. `cwe` and `critical` rest on columns that are
 *  always present, so they have no coverage key — which is a different statement from a
 *  coverage of zero, and the table prints it as one. */
const SIGNALS = [
  { name: "kev", label: "Known exploited (KEV)", coverageKey: "has_kev" },
  { name: "exploit", label: "Public exploit", coverageKey: "has_exploit" },
  { name: "epss", label: "Likely exploited (EPSS)", coverageKey: "epss" },
  { name: "cwe", label: "CWE Top 25 weakness class", coverageKey: null, term: "cwe-top-25" },
  { name: "aiVerdict", label: "AI triage: exploitable", coverageKey: "ai_verdict" },
  { name: "critical", label: "Rated critical", coverageKey: null },
];

const VERDICT_LABELS = {
  gaining: "Gaining",
  "keeping-up": "Keeping up",
  "falling-behind": "Falling behind",
};

const VERDICT_KINDS = { gaining: "ok", "keeping-up": "neutral", "falling-behind": "bad" };

// ------------------------------------------------------------------------- view models

/**
 * A `{point, lo, hi}` rate, its interval, and the base it was taken over.
 *
 * A ZERO DENOMINATOR IS NOT A ZERO PERCENT. `pct()` in the domain already returns null rather
 * than dividing by zero; this keeps that null a null all the way to the screen — "not
 * measured", never `NaN%` and never a confident `0%`. `denominator` and `denominatorLabel`
 * travel either way, because what the figure WOULD have been taken over is the part that
 * makes its absence legible.
 *
 * `hasBounds` is false only when `lo === point === hi`, which happens exactly when nothing was
 * unclassified. That is the one case where a bare number is the whole truth, and the domain's
 * own comment says so.
 */
export function boundedRateView(rate, denominator, denominatorLabel, emptyLabel) {
  const r = rate || {};
  const den = Number(denominator);
  const point = r.point === null || r.point === undefined ? null : Number(r.point);
  const lo = r.lo === null || r.lo === undefined ? null : Number(r.lo);
  const hi = r.hi === null || r.hi === undefined ? null : Number(r.hi);
  const measured = Number.isFinite(den) && den > 0 && point !== null && Number.isFinite(point);
  const hasBounds = measured
    && lo !== null && hi !== null && Number.isFinite(lo) && Number.isFinite(hi)
    && (Math.abs(lo - point) > 1e-9 || Math.abs(hi - point) > 1e-9);
  return {
    measured,
    point: measured ? point : null,
    lo,
    hi,
    text: measured ? fmtPct(point) : "not measured",
    boundsText: hasBounds ? fmtPct(lo) + " to " + fmtPct(hi) : null,
    hasBounds,
    denominator: Number.isFinite(den) ? den : null,
    denominatorLabel,
    // See `rateView` in mttr.js. A base of zero is not a base, and its LABEL must not restate
    // the zero next to "not measured" — that pairing reads as a measurement of nothing.
    baseEmpty: !(Number.isFinite(den) && den > 0),
    emptyLabel: emptyLabel || "nothing has been measured to take it over",
  };
}

/**
 * The pair, never one without the other.
 *
 * Coverage is "of everything that deserved remediation, the share that was remediated";
 * efficiency is "of everything that was remediated, the share that deserved it". Either one
 * alone can be bought by moving the rule — widen it and coverage climbs while efficiency
 * falls — which is why the two carry each other's context and why `prevalence` is here too:
 * it is the efficiency a program picking findings at RANDOM would score, so an efficiency at
 * or below it is a program that is not prioritising at all.
 */
export function coverageEfficiencyView(matrix) {
  const m = matrix || {};
  const coverageDen = Number(m.tp || 0) + Number(m.fn || 0);
  const efficiencyDen = Number(m.tp || 0) + Number(m.fp || 0);
  const coverage = boundedRateView(
    m.coverage,
    coverageDen,
    fmtCount(coverageDen) + " classified high-risk findings",
    "no finding has been classified high risk",
  );
  const efficiency = boundedRateView(
    m.efficiency,
    efficiencyDen,
    fmtCount(efficiencyDen) + " classified remediations",
    "no classified finding has been remediated",
  );
  const prevalence = m.prevalence === null || m.prevalence === undefined
    ? null
    : Number(m.prevalence);
  const classified = Number(m.classified || 0);
  const total = Number(m.total || 0);
  return {
    coverage,
    efficiency,
    prevalence,
    prevalenceText: prevalence === null ? "not measured" : fmtPct(prevalence),
    // Only a verdict where both figures exist. "Not prioritising" is a strong claim and it
    // needs both halves of the comparison to have been measured.
    beatsRandom: efficiency.measured && prevalence !== null
      ? efficiency.point > prevalence
      : null,
    classified,
    total,
    classifiedShare: boundedRateView(
      { point: m.signalCoveragePct, lo: m.signalCoveragePct, hi: m.signalCoveragePct },
      total,
      fmtCount(total) + " findings in scope",
      "no finding is in scope to be scored",
    ),
  };
}

/**
 * The 2x2, and the rows that are not in it.
 *
 * `cells` is exactly four and sums to `classified`. `unclassified` is a SIBLING of that
 * array, never a fifth cell and never folded into a corner — a reader who glances at the grid
 * has to be unable to mistake "we could not score this" for "we scored it and it was low".
 */
export function confusionView(matrix) {
  const m = matrix || {};
  const cells = [
    {
      key: "tp",
      row: "High risk",
      column: "Remediated",
      label: "Work that mattered",
      value: Number(m.tp || 0),
    },
    {
      key: "fn",
      row: "High risk",
      column: "Still open",
      label: "Unremediated risk",
      value: Number(m.fn || 0),
    },
    {
      key: "fp",
      row: "Not high risk",
      column: "Remediated",
      label: "Effort that could have gone elsewhere",
      value: Number(m.fp || 0),
    },
    {
      key: "tn",
      row: "Not high risk",
      column: "Still open",
      label: "Correctly deprioritised",
      value: Number(m.tn || 0),
    },
  ];
  const unknownRemediated = Number(m.unknownRemediated || 0);
  const unknownOpen = Number(m.unknownOpen || 0);
  const total = Number(m.total || 0);
  return {
    cells,
    cellTotal: cells.reduce((a, c) => a + c.value, 0),
    classified: Number(m.classified || 0),
    total,
    unclassified: {
      // Named and placed outside on purpose — see the module header.
      insideMatrix: false,
      remediated: unknownRemediated,
      open: unknownOpen,
      total: unknownRemediated + unknownOpen,
      share: boundedRateView(
        {
          point: total > 0 ? ((unknownRemediated + unknownOpen) / total) * 100 : null,
          lo: null,
          hi: null,
        },
        total,
        fmtCount(total) + " findings in scope",
      ),
    },
  };
}

/**
 * What each clause of the risk rule actually fired on, and how much of it was ever captured.
 *
 * THE COUNTS DO NOT SUM TO `anyOf`. The clauses are OR'd and a row can fire several, so the
 * table says so rather than presenting itself as a partition.
 *
 * `ai_verdict` IS ALWAYS A ROW. Its coverage is 0% in this tenant, which is the measured
 * statement that nobody asked the AI — and it is the only thing separating that from "the AI
 * agreed with nothing". Omitting the row because the number is zero would delete the finding.
 */
export function signalBreakdownView(signals, coverage, rowCount) {
  const fired = (signals && signals.fired) || {};
  const missing = (signals && signals.missing) || {};
  const cov = coverage || {};
  return {
    rows: SIGNALS.map((s) => {
      const c = s.coverageKey ? cov[s.coverageKey] : null;
      const applicable = c ? Number(c.applicable || 0) : null;
      const pct = c && c.coveragePct !== null && c.coveragePct !== undefined
        ? Number(c.coveragePct)
        : null;
      return {
        name: s.name,
        label: s.label,
        term: s.term || null,
        fired: Number(fired[s.name] || 0),
        missing: Number(missing[s.name] || 0),
        // Three distinct states, and the text keeps them apart:
        //   a number  the signal applies to some rows and this much of it was captured —
        //             INCLUDING a real, measured 0%;
        //   "not applicable"  no row in scope has such a column at all;
        //   "always present"  the clause rests on a column that is never missing.
        coverageState: !s.coverageKey
          ? "always-present"
          : applicable === null || applicable === 0
            ? "not-applicable"
            : "measured",
        coveragePct: pct,
        coverageText: !s.coverageKey
          ? "always present"
          : applicable === null || applicable === 0
            ? "not applicable"
            : pct === null ? "not measured" : fmtPct(pct),
        applicable,
        measured: c ? Number(c.measured || 0) : null,
        notApplicable: c ? Number(c.notApplicable || 0) : null,
        denominator: applicable,
        denominatorLabel: applicable === null
          ? "no denominator — the column is always present"
          : fmtCount(applicable) + " findings the signal applies to",
      };
    }),
    anyOf: Number((signals && signals.anyOf) || 0),
    cweUnmapped: Number((signals && signals.cweUnmapped) || 0),
    rowCount: Number(rowCount || 0),
  };
}

/**
 * Capacity month by month, with every month that was not directly observed marked as such.
 *
 * `marks` is what a row is NOT: "partial" (the current month, still running) or
 * "reconstructed" (ended before this register started watching, so it was rebuilt rather than
 * measured). `measured` is false for either, and the headline close rate excludes both — the
 * server does that, and `monthsCounted` says over how many months the headline was taken.
 */
export function capacityView(capacity) {
  const c = capacity || {};
  const months = (Array.isArray(c.months) ? c.months : []).map((m) => {
    const marks = [];
    if (m.partial) marks.push("partial");
    if (m.reconstructed) marks.push("reconstructed");
    const openAtStart = Number(m.openAtStart || 0);
    return {
      month: String(m.month || ""),
      openAtStart,
      opened: Number(m.opened || 0),
      closed: Number(m.closed || 0),
      net: Number(m.net || 0),
      verdict: m.verdict || null,
      verdictLabel: VERDICT_LABELS[m.verdict] || "—",
      marks,
      measured: marks.length === 0,
      scanClosed: m.scanClosed === null || m.scanClosed === undefined ? null : Number(m.scanClosed),
      mmcr: boundedRateView(
        { point: m.mmcr === null || m.mmcr === undefined ? null : Number(m.mmcr), lo: null, hi: null },
        openAtStart,
        fmtCount(openAtStart) + " open at the start of the month",
      ),
    };
  });
  const monthsCounted = Number(c.monthsCounted || 0);
  return {
    show: months.length > 0,
    months,
    monthsCounted,
    mmcrMean: boundedRateView(
      { point: c.mmcrMean === null || c.mmcrMean === undefined ? null : Number(c.mmcrMean), lo: null, hi: null },
      monthsCounted,
      fmtCount(monthsCounted) + " fully observed " + pluralize(monthsCounted, "month"),
    ),
    oneInN: c.oneInN === null || c.oneInN === undefined ? null : Number(c.oneInN),
    netTotal: Number(c.netTotal || 0),
    verdict: c.verdict || null,
    verdictLabel: VERDICT_LABELS[c.verdict] || "—",
    unmeasuredCount: months.filter((m) => !m.measured).length,
  };
}

/**
 * The sweep across every non-empty subset of the risk signals, per scope.
 *
 * PER SCOPE, because `ruleSensitivity` needs one active rule and `ruleForScope` gives sca a
 * `RiskRule` and sast a `SastRiskRule`. Forcing one across both would classify half the
 * register under a rule built for the other half; secrets has no rule at all and is not here.
 */
export function sensitivityView(sensitivity) {
  const byScope = sensitivity || {};
  const groups = Object.keys(byScope).map((scope) => {
    const block = byScope[scope] || {};
    const points = (Array.isArray(block.points) ? block.points : []).map((p) => ({
      label: String(p.label || ""),
      active: !!p.active,
      coverage: p.coverage === null || p.coverage === undefined ? null : Number(p.coverage),
      efficiency: p.efficiency === null || p.efficiency === undefined ? null : Number(p.efficiency),
      highRisk: Number(p.highRisk || 0),
      unknown: Number(p.unknown || 0),
      sentence: String(p.sentence || ""),
    }));
    return {
      scope,
      label: SCOPE_LABELS[scope] || scope,
      sentence: String(block.sentence || ""),
      points,
    };
  });
  return { show: groups.some((g) => g.points.length), groups };
}

// ----------------------------------------------------------------------------- the page

function scopeParam(params) {
  const s = params && params.scope;
  return s === "sca" || s === "sast" || s === "secrets" ? s : null;
}

/**
 * A `[data-denominator]` node — every rate on this page is followed by one of these.
 *
 * The ATTRIBUTE always carries the number, a zero included. The visible text does not restate
 * a zero base beside "not measured" — see `rateView` in mttr.js, which this page's rates come
 * from, for why that pairing is the failure and not the disclosure.
 */
function denominatorNode(rate) {
  return el("span", {
    class: "small muted",
    "data-denominator": rate.denominator === null ? "none" : String(rate.denominator),
  }, rate.baseEmpty ? "— " + rate.emptyLabel : rate.denominatorLabel);
}

/** The figure, its interval, and its base — the three things a rate is never published
 *  without on this page. */
function rateCell(rate) {
  return el("span", {},
    el("span", { class: "num" }, rate.text),
    rate.boundsText ? el("span", { class: "small muted" }, " (" + rate.boundsText + ") ") : " ",
    denominatorNode(rate));
}

export async function renderProgram(host, params, _ctx) {
  const boot = await bootstrap();
  const scope = scopeParam(params);

  let paint = null;
  const data = swrCall(
    "api_getProgramPage",
    scope ? { scope } : {},
    (fresh) => paint && paint(fresh),
  );

  const noticeHost = el("div", {});
  const heroHost = el("div", {});
  const matrixHost = el("div", {});
  const signalHost = el("div", {});
  const sensitivityHost = el("div", {});
  const capacityHost = el("div", {});
  const trendHost = el("div", {});
  host.append(noticeHost, heroHost, matrixHost, signalHost, sensitivityHost, capacityHost, trendHost);

  let live = true;
  onPageTeardown(() => { live = false; });

  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[program] " + label + " render failed:", e);
      // A render that THREW is a defect, not an absence — see feedback.js.
      clear(target).append(errorState(
        "Couldn't render " + label + ".",
        { detail: String((e && e.message) || e) },
      ));
    }
  }

  clear(heroHost).append(
    el("div", { role: "status", "aria-label": "Computing coverage and efficiency" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );

  paint = (payload) => {
    const program = (payload && payload.program) || null;
    const first = Number((program && program.rowCount) || 0) === 0;
    guard("the first-run notice", noticeHost, () => renderFirstRun(first));
    guard("coverage and efficiency", heroHost, () => renderHero(program, first));
    guard("the confusion matrix", matrixHost, () => renderMatrix(program, first));
    guard("the signal breakdown", signalHost, () => renderSignals(program, first));
    guard("rule sensitivity", sensitivityHost, () => renderSensitivity(program));
    guard("monthly capacity", capacityHost, () => renderCapacity(program));
    guard("the coverage trend", trendHost, () => renderTrend(payload, program));
  };

  try {
    paint(await data);
  } catch (e) {
    console.error("[program] api_getProgramPage failed:", e);
    clear(heroHost).append(errorState(
      "Couldn't load programme data.",
      { detail: String((e && e.message) || e) },
    ));
  }

  function renderFirstRun(first) {
    clear(noticeHost);
    if (!first) return;
    noticeHost.append(firstRunNotice({
      synced: !!boot.latestSync,
      hint: "Coverage and efficiency are both taken over findings the risk rule has scored,"
        + " so this page waits on a sync that saves rows for it to score. Run one with the"
        + " Run sync button in the rail.",
    }));
  }

  // ------------------------------------------------------------------------------ hero

  function renderHero(program, first) {
    clear(heroHost);
    if (!program) {
      heroHost.append(emptyState("No programme figures yet."));
      return;
    }
    const view = coverageEfficiencyView(program.matrix);

    // Efficiency rides in the header's aside slot rather than in a second hero: DESIGN.md
    // allows one hero per page, and the point of this pair is that neither figure means
    // anything alone. Coverage leads because it is the P2P convention, not because it wins.
    const aside = el("div", { class: "page-strip" },
      el("div", { class: "kpi-label" },
        glossaryTip("Remediation efficiency", "efficiency")),
      el("div", { class: "kpi-value num" }, view.efficiency.text),
      view.efficiency.boundsText
        ? el("div", { class: "small muted" }, "Bounds " + view.efficiency.boundsText)
        : el("div", { class: "small muted" },
          view.efficiency.measured
            ? "No unclassified rows, so the point estimate is the whole interval."
            : "Nothing was remediated under a classification, so there is no rate to take."),
      denominatorNode(view.efficiency));

    heroHost.append(pageHeader({
      hero: heroStat(
        "Remediation coverage",
        view.coverage.text,
        view.coverage.boundsText
          ? "Bounds " + view.coverage.boundsText + " — the width is the size of the doubt"
          : (view.coverage.measured
            ? "No unclassified rows, so the point estimate is the whole interval."
            : "Nothing classified high risk, so there is no rate to take."),
        { term: "coverage" },
      ),
      aside,
      // "Classified: not measured — 0 of 0 findings scored" is the same zero-glued-to-an
      // -absence the SLA line carried. On an unread ledger the notice above already says
      // what the whole page waits on, so the stat row is dropped rather than dashed.
      stats: first ? [] : [
        statRow(
          "Prevalence",
          view.prevalenceText,
          "what a program picking at random would score",
        ),
        statRow(
          "Classified",
          view.classifiedShare.text,
          fmtCount(view.classified) + " of " + fmtCount(view.total) + " findings scored",
        ),
        statRow(
          "Observation window",
          fmtDays(program.observationDays),
          program.asOfSource === "scan"
            ? "dated by the newest scan"
            : "dated by the wall clock — no scan on record",
        ),
      ],
    }));

    heroHost.append(el("p", { class: "small muted" },
      "Coverage: ",
      el("span", { class: "num" }, view.coverage.text),
      " ",
      denominatorNode(view.coverage),
      ". Efficiency: ",
      el("span", { class: "num" }, view.efficiency.text),
      " ",
      denominatorNode(view.efficiency),
      ". The two are published together because either one alone can be bought by moving the"
      + " rule — widen it and coverage climbs while efficiency falls."));

    if (view.beatsRandom === false) {
      heroHost.append(el("p", { class: "small muted" },
        "Efficiency is at or below prevalence (" + view.prevalenceText + "), which is what a"
        + " program selecting findings at random would score. That is a verdict on the rule,"
        + " not on the team."));
    }
    if (Number(program.excludedSecrets || 0)) {
      heroHost.append(el("p", { class: "small muted" },
        fmtCount(program.excludedSecrets) + " secret " + pluralize(Number(program.excludedSecrets), "finding")
        + " are excluded from every figure on this page. The risk rule refuses to score them"
        + " rather than inventing a classification — severity on that register grades a"
        + " detection, not whether a credential is live."));
    }
  }

  // -------------------------------------------------------------------- confusion matrix

  function renderMatrix(program, first) {
    clear(matrixHost);
    matrixHost.append(sectionLabel("The confusion matrix"));
    if (!program) {
      matrixHost.append(emptyState("No matrix yet."));
      return;
    }
    // The SECTION STAYS, its figures do not. Four cells of `0` and an `Unclassified 0` beside
    // them describe a rule that has been run against nothing — and a reader cannot tell that
    // apart from a rule that placed every row. The heading is kept so the page is not
    // silently shorter than itself.
    if (first) {
      matrixHost.append(emptyState(
        "The rule has not been run against a finding yet.",
        "Each of the four cells counts findings by what the rule said and what happened to"
        + " them, so all four wait on the first sync that saves a row.",
      ));
      return;
    }
    const view = confusionView(program.matrix);
    const cell = (key) => view.cells.filter((c) => c.key === key)[0] || { value: 0, label: "" };

    const rows = [
      { risk: "High risk", remediated: cell("tp"), open: cell("fn") },
      { risk: "Not high risk", remediated: cell("fp"), open: cell("tn") },
    ];
    matrixHost.append(dataTable({
      columns: [
        { key: "risk", label: "Classified", cell: (r) => r.risk },
        {
          key: "remediated",
          label: "Remediated",
          className: "num",
          cell: (r) => el("span", {},
            el("span", { class: "num" }, fmtCount(r.remediated.value)),
            el("span", { class: "small muted" }, " " + r.remediated.label)),
        },
        {
          key: "open",
          label: "Still open",
          className: "num",
          cell: (r) => el("span", {},
            el("span", { class: "num" }, fmtCount(r.open.value)),
            el("span", { class: "small muted" }, " " + r.open.label)),
        },
      ],
      rows,
    }));

    // OUTSIDE the grid, in its own card, and labelled as what it is. This is the block the
    // whole page's honesty rests on.
    matrixHost.append(el("section", { class: "card" },
      el("div", { class: "kpi-label" }, glossaryTip("Unclassified", "unclassified")),
      el("div", { class: "kpi-value num" }, fmtCount(view.unclassified.total)),
      el("p", { class: "small muted" },
        fmtCount(view.unclassified.remediated) + " remediated · "
        + fmtCount(view.unclassified.open) + " still open — ",
        el("span", { class: "num" }, view.unclassified.share.text),
        " ",
        denominatorNode(view.unclassified.share),
        "."),
      el("p", { class: "small muted" },
        "Held outside the four cells above, not folded into a corner. The four cells sum to "
        + fmtCount(view.cellTotal) + " classified findings; these "
        + fmtCount(view.unclassified.total) + " are the ones the rule could not place, and"
        + " they are what the coverage and efficiency bounds are computed from.")));
  }

  // -------------------------------------------------------------------- signal breakdown

  function renderSignals(program, first) {
    clear(signalHost);
    signalHost.append(sectionLabel("What the rule fired on"));
    if (!program) {
      signalHost.append(emptyState("No signal breakdown yet."));
      return;
    }
    // "Fired on 0 · Never captured 0" is a VERDICT on a clause, and this page argues in its
    // own caption that a coverage of 0% is a measurement — it separates "the AI agreed with
    // nothing" from "nobody asked the AI". Neither of those is true over an unread ledger,
    // and printing twelve zeros here would make a third thing look like both.
    if (first) {
      signalHost.append(emptyState(
        "No clause has had a finding to fire on.",
        "Each row here is a clause of the risk rule; the counts beside it appear once a sync"
        + " has saved findings for the rule to read.",
      ));
      return;
    }
    const view = signalBreakdownView(program.signals, program.signalCoverage, program.rowCount);
    signalHost.append(dataTable({
      columns: [
        {
          key: "label",
          label: "Signal",
          cell: (r) => (r.term ? glossaryTip(r.label, r.term) : r.label),
        },
        { key: "fired", label: "Fired on", className: "num", cell: (r) => fmtCount(r.fired) },
        { key: "missing", label: "Never captured", className: "num", cell: (r) => fmtCount(r.missing) },
        {
          key: "coverage",
          label: "Coverage",
          cell: (r) => el("span", {},
            el("span", { class: "num" }, r.coverageText),
            " ",
            el("span", {
              class: "small muted",
              "data-denominator": r.denominator === null ? "none" : String(r.denominator),
            }, r.denominatorLabel)),
        },
      ],
      rows: view.rows,
    }));
    signalHost.append(el("p", { class: "small muted" },
      "The clauses are OR'd and overlap, so these do not sum to the "
      + fmtCount(view.anyOf) + " " + pluralize(view.anyOf, "finding")
      + " classified high risk. A coverage of 0% is a measurement — it says the signal was"
      + " never captured on any row it applies to, which is what separates \"the AI agreed"
      + " with nothing\" from \"nobody asked the AI\". \"Not applicable\" is a different"
      + " statement again: no row in scope has such a column."));
    if (view.cweUnmapped) {
      signalHost.append(el("p", { class: "small muted" },
        fmtCount(view.cweUnmapped) + " " + pluralize(view.cweUnmapped, "finding")
        + " carry a CWE that matched neither the Top 25 nor a documented ancestor of one."
        + " Those classify low, so this is the size of the ancestry gap measured in findings."));
    }
  }

  // --------------------------------------------------------------------- rule sensitivity

  function renderSensitivity(program) {
    clear(sensitivityHost);
    sensitivityHost.append(sectionLabel("Rule sensitivity"));
    const view = sensitivityView(program && program.sensitivity);
    if (!view.show) {
      sensitivityHost.append(emptyState(
        "No sweep yet.",
        "It needs at least one scored finding on a register that has a risk rule — sca or"
        + " sast. Secrets has none by design.",
      ));
      return;
    }
    for (const group of view.groups) {
      if (!group.points.length) continue;
      sensitivityHost.append(el("h3", {}, group.label));
      if (group.sentence) {
        sensitivityHost.append(el("p", { class: "small muted" },
          "Active rule: " + group.sentence));
      }
      sensitivityHost.append(dataTable({
        columns: [
          {
            key: "label",
            label: "Signals",
            cell: (p) => el("span", {},
              p.label,
              p.active ? el("span", { class: "small muted" }, " · active") : null),
          },
          {
            key: "coverage",
            label: "Coverage",
            cell: (p) => rateCell(boundedRateView(
              { point: p.coverage, lo: null, hi: null },
              p.highRisk,
              fmtCount(p.highRisk) + " flagged high risk",
            )),
          },
          {
            key: "efficiency",
            label: "Efficiency",
            cell: (p) => rateCell(boundedRateView(
              { point: p.efficiency, lo: null, hi: null },
              p.highRisk,
              fmtCount(p.highRisk) + " flagged high risk",
            )),
          },
          {
            key: "unknown",
            label: "Unclassified",
            className: "num",
            cell: (p) => fmtCount(p.unknown),
          },
        ],
        rows: group.points,
      }));

      const canvas = el("canvas", {
        "aria-label": "Coverage against efficiency for every subset of the "
          + group.label + " risk signals",
      });
      sensitivityHost.append(el("section", { class: "chart-card" },
        el("p", { class: "chart-note" },
          "Coverage on the x axis, efficiency on the y — up and to the right is better. Each"
          + " point is one non-empty subset of the rule's signals; the active rule is"
          + " direct-labelled like every other."),
        el("div", { class: "chart-box" }, canvas),
        chartTable({
          canvas,
          caption: "Each plotted point as a row — coverage is the x axis, efficiency the y,"
            + " both in percent. This is the same population as the table above, read in the"
            + " axes the chart puts it on.",
          model: chartTableModel({
            columns: [
              { key: "label", label: "Signals", format: "text" },
              { key: "coverage", label: "Coverage %", format: "pct" },
              { key: "efficiency", label: "Efficiency %", format: "pct" },
              { key: "highRisk", label: "High risk", format: "count" },
              { key: "unknown", label: "Unclassified", format: "count" },
            ],
            rows: group.points,
          }),
        })));

      const points = group.points;
      loadCharts().then((charts) => {
        if (!live) return;
        onPageTeardown(() => charts.destroyChart(canvas));
        charts.coverageEfficiencyScatter(canvas, points);
      }).catch(() => {
        if (live) chartUnavailable(canvas);
      });
    }
  }

  // ---------------------------------------------------------------------------- capacity

  function renderCapacity(program) {
    clear(capacityHost);
    capacityHost.append(sectionLabel("Monthly capacity", { term: "capacity" }));
    const view = capacityView(program && program.capacity);
    if (!view.show) {
      capacityHost.append(emptyState(
        "No monthly capacity yet.",
        "It needs at least one finding with a readable first-detection date.",
      ));
      return;
    }

    const row = el("div", { class: "kpi-row" });
    row.append(kpiCard(
      "Monthly mean closure rate",
      view.mmcrMean.text,
      view.monthsCounted
        ? "averaged over " + fmtCount(view.monthsCounted) + " fully observed "
          + pluralize(view.monthsCounted, "month")
        : "no month was fully observed, so there is nothing to average",
      null,
      { term: "mmcr" },
    ));
    row.append(kpiCard(
      "Roughly",
      view.oneInN === null ? "—" : "1 in " + Math.round(view.oneInN),
      "of what was open at the start of a month gets closed in it",
    ));
    row.append(kpiCard(
      "Verdict",
      view.verdictLabel,
      "closures against arrivals, with a two-percent dead band around zero",
    ));
    capacityHost.append(row);
    capacityHost.append(el("p", { class: "small muted" },
      "Mean close rate base: ", denominatorNode(view.mmcrMean), "."));

    capacityHost.append(dataTable({
      columns: [
        { key: "month", label: "Month", cell: (m) => m.month },
        { key: "openAtStart", label: "Open at start", className: "num", cell: (m) => fmtCount(m.openAtStart) },
        { key: "opened", label: "Arrived", className: "num", cell: (m) => fmtCount(m.opened) },
        { key: "closed", label: "Closed", className: "num", cell: (m) => fmtCount(m.closed) },
        { key: "net", label: "Net", className: "num", cell: (m) => (m.net > 0 ? "+" : "") + fmtCount(m.net) },
        { key: "mmcr", label: "Close rate", cell: (m) => rateCell(m.mmcr) },
        {
          key: "verdict",
          label: "Verdict",
          cell: (m) => statusPill(VERDICT_KINDS[m.verdict] || "neutral", m.verdictLabel),
        },
        {
          key: "state",
          label: "Measured",
          // Asked once, on the heading, rather than once per row: a definition parked in
          // every cell would add a tab stop per month for one sentence.
          help: { term: "reconstructed" },
          // The mark is the whole point of this column: a month nobody was watching must not
          // read as a month that was measured and happened to look like this.
          cell: (m) => {
            if (m.measured) return el("span", { class: "small muted" }, "observed");
            const wrap = el("span", { class: "pill-row" });
            for (const mark of m.marks) {
              wrap.append(mark === "reconstructed"
                ? statusPill("warn", "Reconstructed — rebuilt, not observed")
                : statusPill("neutral", "Partial — month still running"));
            }
            return wrap;
          },
        },
      ],
      rows: view.months,
    }));
    capacityHost.append(el("p", { class: "small muted" },
      view.unmeasuredCount
        ? fmtCount(view.unmeasuredCount) + " of " + fmtCount(view.months.length) + " "
          + pluralize(view.months.length, "month") + " here were not directly observed and are"
          + " excluded from the headline rate above. A reconstructed month ends before this"
          + " register started watching, so its backlog is real but nobody was looking in real"
          + " time; a partial month is simply not over yet."
        : "Every month here was directly observed."));
  }

  // ------------------------------------------------------------- coverage over time

  function renderTrend(payload, program) {
    clear(trendHost);
    trendHost.append(sectionLabel("Coverage and efficiency over time"));
    if (program && program.trendSupported === false) {
      trendHost.append(emptyState(
        "No series under a secrets scope.",
        "Coverage and efficiency are rates over a high-risk population, and that register has"
        + " none — an empty series is the honest answer rather than a line of zeroes.",
      ));
      return;
    }
    const points = ((payload && payload.trends && payload.trends.trend) || [])
      .filter((p) => p && p.date);
    if (points.length < 2) {
      trendHost.append(el("div", { class: "card" }, emptyState(
        "Not enough history to draw a line.",
        "The backbone emits one point per saved scan plus one per day of pre-scan history.",
      )));
      return;
    }
    const reconstructed = points.filter((p) => p.reconstructed).length;
    const canvas = el("canvas", {
      "aria-label": "Remediation coverage and efficiency over time, in percent",
    });
    trendHost.append(el("section", { class: "chart-card" },
      el("p", { class: "chart-note" },
        "Both rates on one axis, because the trade-off between them is the story."
        + (reconstructed
          ? " The first " + fmtCount(reconstructed) + " "
            + pluralize(reconstructed, "point") + " " + (reconstructed === 1 ? "is" : "are")
            + " reconstructed, where closures are under-counted — the shaded band marks them."
          : "")
        + " A gap is a date where nothing was high risk yet, drawn as a gap rather than as a"
        + " zero."),
      el("div", { class: "chart-box" }, canvas),
      // `points` again — one array, plotted below and listed here.
      chartTable({
        canvas,
        caption: "Both series, one row per date, in percent. An em dash is a date where the"
          + " rate had no denominator — the gap the line draws, not a zero.",
        model: chartTableModel({
          columns: [
            {
              key: "date",
              label: "Date",
              format: "text",
              value: (p) => String(p.date).slice(0, 10),
            },
            { key: "coverage_pct", label: "Coverage %", format: "pct" },
            { key: "efficiency_pct", label: "Efficiency %", format: "pct" },
            {
              key: "reconstructed",
              label: "Reconstructed",
              format: "text",
              align: "text",
              value: (p) => (p.reconstructed ? "yes" : "no"),
            },
          ],
          rows: points,
        }),
      })));

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.coverageEfficiencyLines(canvas, points, {});
    }).catch(() => {
      if (live) chartUnavailable(canvas);
    });
  }
}
