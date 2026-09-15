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

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
// `fmtPct`, `denominatorNode`, `rateCell` and `scopeParam` used to be DEFINED here — see
// `./_rates.js`'s header for why one copy now serves this page and mttr.js both.
import { denominatorNode, fmtPct, rateCell, scopeParam } from "./_rates.js";
import { SCOPE_LABELS_LONG as SCOPE_LABELS } from "./_scopeLabels.js";
import {
  absentText, chartTable, chartTableModel, clear, dataTable, disclosure, el, emptyState,
  errorState, figureCard, firstRunNotice, heroStat, kpiCard, meter, num, onPageTeardown,
  pageHeader, pluralize, quadModel, quadTable, sectionLabel, skeleton, statRow, statusPill,
  tipLabel,
} from "../ui.js";
import { fmtCount, fmtDays } from "./mttr.js";
// `chartCard` — the chart-card shell with its eager data-table alternative and its
// bundle-refused fallback — is `pages/sca.js`'s, the same way `fmtCount`/`fmtDays` above are
// `pages/mttr.js`'s. The capacity section is the first chart on this page that has a table
// worth reading behind it, and re-typing the shell here would be the fourth copy of a
// `.chart-card > h3 + note + chart-box + chartTable` block in this package.
import { chartCard } from "./sca.js";
// `verdictMark` moved out to its own module in Wave C: `pages/repos.js` needed the identical
// dot-and-word for its own Capacity column, and two pages wanting the same shape is what
// promotes a helper. See ui/verdict.js's header for the DOM and the tone mapping this page no
// longer carries a private copy of.
import { verdictMark } from "../ui/verdict.js";

// ---------------------------------------------------------------------------- formatting

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

/**
 * The percentage a signal's coverage meter may be filled to — or NULL, which draws no meter.
 *
 * PURE AND EXPORTED BECAUSE THE DECISION IS WHAT CAN BE WRONG, not the `<span>` around it.
 * `signalBreakdownView` publishes THREE states and this page's own header insists they are
 * drawn as three things:
 *
 *   "measured"        a share was taken over the rows the signal applies to — INCLUDING a
 *                     real, measured 0%. `ai_verdict` reads 0% in this tenant and that IS
 *                     the finding: it separates "the AI agreed with nothing" from "nobody
 *                     asked the AI". A measured zero gets its meter, empty.
 *   "always-present"  the clause rests on a column that is never missing, so there is no
 *                     share to take at all.
 *   "not-applicable"  no row in scope has such a column.
 *
 * The last two get NO meter. `ui/data.js`'s `meter(value)` opens with `Number(value) || 0`,
 * so the one-line version — `meter(Number(row.coveragePct))` — draws an empty 0% track beside
 * the words "always present", which is a picture asserting that nothing was captured on a
 * clause that is never missing. The state is checked BEFORE the cast and the percentage is
 * refused after it, in that order.
 *
 * @param {{coverageState?: string, coveragePct?: *}|null|undefined} row  a signalBreakdownView row
 * @returns {number|null}
 */
export function signalMeterPct(row) {
  if (!row || row.coverageState !== "measured") return null;
  return num(row.coveragePct);
}

/**
 * A net movement with its sign always shown — "+12", "0", "−7".
 *
 * `fmtCount` carries the locale's own minus sign, so only the plus has to be added. Refused
 * before the cast: a null net is a zero the server declared, never `Number(undefined)`.
 */
function signedCount(v) {
  const n = num(v, 0);
  return (n > 0 ? "+" : "") + fmtCount(n);
}

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
 * Which corner of the matrix is good news, which is bad, and which is neither.
 *
 * TONE IS THE THIRD CUE. `quadModel` refuses a toned corner with no label, and every one of
 * these is paired with `confusionView`'s own reading — "Work that mattered", "Unremediated
 * risk" — so the word carries the state and the wash only repeats it.
 *
 * `fp` IS "warn", NOT "bad". Effort spent on a finding the rule did not rate high is not a
 * failure, it is the cost side of the pair this page publishes: efficiency is exactly that
 * corner's share, and calling it an error in colour would make a verdict the arithmetic does
 * not.
 */
const CONFUSION_TONES = { tp: "ok", fn: "bad", fp: "warn", tn: "neutral" };

/**
 * The confusion matrix as a `quadModel` — the 2x2 that used to be a three-column table.
 *
 * WHAT IT REPLACES. `dataTable` with a "Classified" column and two outcome columns, each cell
 * a count with its reading appended as muted prose. Read left to right it is a table; read as
 * a cross it is the thing it actually is, and only the cross makes the diagonal legible —
 * `tp` and `tn` against `fn` and `fp` — which is the whole point of publishing coverage and
 * efficiency together.
 *
 * THE SHARES ARE TAKEN AGAINST `classified`, NOT `total`, and that is the one arithmetic
 * decision in this function. The four corners sum to `classified` by construction
 * (`confusionView` asserts it and `test/pagesProgram.test.js` pins it); the unclassified rows
 * are a SIBLING of the array, drawn beside the grid under a hatch, so passing `total` here
 * would leave four shares summing to 75% with nothing on the grid explaining the missing
 * quarter. The hatched note beside it is that explanation.
 */
export function confusionQuadModel(view) {
  const cells = (view && view.cells) || [];
  const at = (key) => cells.filter((c) => c.key === key)[0] || {};
  const corner = (key, row, col) => {
    const c = at(key);
    // NO FALLBACK LABEL, and that is the point rather than an omission: `quadModel` REFUSES a
    // corner with no word, and "tp" is a word only in the sense that it is a string — a
    // toned cell reading "tp" would pass the refusal while defeating what it protects. A
    // matrix missing a cell should throw here, where a test can see it, not render.
    return {
      row,
      col,
      count: c.value === undefined ? null : c.value,
      label: c.label,
      tone: CONFUSION_TONES[key] || "neutral",
    };
  };
  return quadModel({
    rows: { label: "Classified", yes: "High risk", no: "Not high risk" },
    cols: { label: "Outcome", yes: "Remediated", no: "Still open" },
    cells: [
      corner("tp", true, true),
      corner("fn", true, false),
      corner("fp", false, true),
      corner("tn", false, false),
    ],
    total: view && view.classified,
    unit: "classified findings",
  });
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
      verdictLabel: VERDICT_LABELS[m.verdict] || absentText,
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
    verdictLabel: VERDICT_LABELS[c.verdict] || absentText,
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
//
// `scopeParam`, `denominatorNode` and `rateCell` moved to `./_rates.js` (imported above) —
// `rateCell` there renders a `boundsText` when present, exactly as this page's copy did.

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
  // THE TITLE BLOCK IS STATIC, AND THE h1 DOES NOT WAIT ON AN RPC. The metric header below is
  // built inside `renderHero`, which runs only once the fetch resolves — so the loading
  // skeleton, the fetch-failure errorState and (on Coverage & efficiency) the no-figures empty
  // state each rendered a page with NO `<h1>` in it at all. Appended here instead, once, ahead
  // of every host: the page's name is not a function of its data. Two stacked `.page-header`
  // blocks is the shape gas_ai's `problems` / `combos` / `config` already have — a title
  // header, then the figure and its stat strip.
  host.append(
    pageHeader({ route: "program" }),
    noticeHost, heroHost, matrixHost, signalHost, sensitivityHost, capacityHost, trendHost,
  );

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
    // FIRST RUN STOPS HERE — one notice above (`renderFirstRun`), not a page of section
    // headings each over their own "nothing yet". `renderMatrix`/`renderSignals` already gate
    // themselves to nothing on `first` (see their own `if (first) return;`); sensitivity,
    // capacity and the trend used to reach this point regardless and print their OWN generic
    // empty message ("No sweep yet.", "No monthly capacity yet.", "Not enough history…") —
    // three more sentences beside the one at the top of the page, for the same fact.
    if (first) {
      [sensitivityHost, capacityHost, trendHost].forEach(clear);
      return;
    }
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
      at: boot.latestSync ? boot.latestSync.ts : null,
      hint: "Coverage and efficiency are both taken over findings the risk rule has scored,"
        + " so this page waits on a sync that saves rows for it to score. Run one with the"
        + " Run sync button in the rail.",
    }));
  }

  // ------------------------------------------------------------------------------ hero

  function renderHero(program, first) {
    clear(heroHost);
    if (!program) {
      heroHost.append(emptyState(
        "No programme figures yet.",
        "They appear once a sync has saved findings for the risk rule to score.",
      ));
      return;
    }
    const view = coverageEfficiencyView(program.matrix);

    // Efficiency rides in the header's aside slot rather than in a second hero: DESIGN.md
    // allows one hero per page, and the point of this pair is that neither figure means
    // anything alone. Coverage leads because it is the P2P convention, not because it wins.
    //
    // A `kpiCard` NOW, not a hand-built `.page-strip` of `.kpi-label`/`.kpi-value` divs — the
    // same component this page already uses for every other figure, so this is the one figure
    // that no longer draws its own copy of a card the shared module already owns.
    // `denominatorNode` is appended after, exactly as `mmcrMean`'s card does below, because
    // `kpiCard`'s own `sub` slot is the one line the bounds/measured sentence needs.
    // A `figureCard` NOW, so the sentence goes where R3 puts it: `data-denominator` on the
    // card and the first line of the tip on its own label, rather than a `denominatorNode`
    // appended under the value. The card is still `.page-header > .kpi-card`, so pages.css's
    // 22rem cap still holds it under the hero beside it.
    //
    // THE VERDICT IS THE CARD'S CHIP. "Efficiency is at or below prevalence (12.5%), which is
    // what a program selecting findings at random would score. That is a verdict on the rule,
    // not on the team." was 32 words in a paragraph below the header — a verdict about THIS
    // figure, drawn further from it than any other sentence on the page. A pill on the card
    // says it in four words, with the whole sentence behind it; and it is drawn only when
    // `beatsRandom` is FALSE, never when it is null, because "not prioritising" needs both
    // halves of the comparison to have been measured.
    const aside = figureCard({
      label: "Remediation efficiency",
      value: view.efficiency.text,
      sub: rateSub(view.efficiency),
      chip: view.beatsRandom === false
        ? statusPill("warn", "At or below random", {
          lines: [
            "Efficiency is at or below prevalence (" + view.prevalenceText + "), which is"
            + " what a program selecting findings at random would score.",
            "That is a verdict on the rule, not on the team.",
          ],
        })
        : null,
      help: { term: "efficiency" },
      denominator: view.efficiency.baseEmpty
        ? "Not measured: " + view.efficiency.emptyLabel + "."
        : "Of everything that was remediated under a classification, the share that deserved"
          + " it — taken over " + view.efficiency.denominatorLabel + ".",
    });

    // NO `route`: the h1 is in the title block appended once at the top of renderProgram.
    heroHost.append(pageHeader({
      hero: heroStat(
        "Remediation coverage",
        view.coverage.text,
        rateSub(view.coverage),
        // THE 48-WORD METHOD PARAGRAPH IS HERE. It printed both rates a second time — each
        // with its own `denominatorNode` — under a header that had just drawn them, and then
        // said why they are published together. The two figures are above; what a reader
        // cannot get from them is the rule the pair enforces, and that is a definition.
        {
          term: "coverage",
          lines: [
            "Of everything that deserved remediation, the share that was remediated — taken"
            + " over " + view.coverage.denominatorLabel + ".",
            "The bounds are the two extreme re-labellings of the unclassified rows, so the"
            + " WIDTH of the interval is the size of the doubt.",
            "Coverage and efficiency are published together because either one alone can be"
            + " bought by moving the rule — widen it and coverage climbs while efficiency"
            + " falls.",
          ],
        },
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

    // AN EXCLUSION IS A STATE, so it is drawn as one. The 42-word paragraph said which
    // population is outside every figure on this page and why the rule refuses to score it;
    // the COUNT and the word "excluded" are what a reader has to see without hovering
    // anything (R2's KEEP case), and the reason is a definition of the refusal.
    const excluded = num(program.excludedSecrets, 0);
    if (excluded > 0) {
      heroHost.append(el("p", { class: "small muted" }, statusPill(
        "neutral",
        "Secrets excluded (" + fmtCount(excluded) + ")",
        {
          lines: [
            fmtCount(excluded) + " secret " + pluralize(excluded, "finding")
            + " are outside every figure on this page.",
            "The risk rule refuses to score them rather than inventing a classification —"
            + " severity on that register grades a detection, not whether a credential is"
            + " live.",
          ],
        },
      )));
    }
  }

  /**
   * A bounded rate's one visible sub-line: the denominator short form, then the interval.
   *
   * R3's contract in one function, for the two figures the header carries. What was here
   * before named only the interval ("Bounds 32.1% to 46.7% — the width is the size of the
   * doubt") and left the base to a `denominatorNode` under the card or to a paragraph below
   * the header; the base is the half a rate cannot be read without, so it leads. The
   * explanation of what the width MEANS is one level down, on the label, where the rest of
   * the method went — the two numbers themselves never leave the surface.
   *
   * A base of zero says what is missing rather than printing the zero beside "not measured",
   * which is `boundedRateView`'s own rule and the reason `emptyLabel` exists.
   */
  function rateSub(rate) {
    if (rate.baseEmpty) return rate.emptyLabel;
    const base = "of " + rate.denominatorLabel;
    if (rate.boundsText) return base + " · bounds " + rate.boundsText;
    return base + " · no unclassified rows, so this point is the whole interval";
  }

  // -------------------------------------------------------------------- confusion matrix

  function renderMatrix(program, first) {
    clear(matrixHost);
    // GATED WHOLESALE, HEADING INCLUDED — one notice already covers this page (see `paint`'s
    // own gate below `renderSignals`); a heading with nothing under it is a dangling section,
    // and `!program` is unreachable past this point (it implies `first`, since `first` reads
    // `program && program.rowCount`).
    if (first) return;
    matrixHost.append(sectionLabel("The confusion matrix"));
    const view = confusionView(program.matrix);

    matrixHost.append(quadTable(confusionQuadModel(view), {
      ariaLabel: "Classified risk against remediation outcome, over "
        + fmtCount(view.classified) + " classified findings",
    }));

    // OUTSIDE the grid, and now MARKED as outside it. This is the block the whole page's
    // honesty rests on, and it used to be a card carrying two paragraphs — one of figures,
    // one 48-word explanation of what "outside" means. The explanation is the `unclassified`
    // entry's own definition plus this page's two extra facts, so it rides on the label; the
    // hatch is the mark this design system reserves for "this part is not a measurement",
    // which is exactly what an unclassified row is. A texture is not a fact, so the word
    // "Unclassified" sits beside it and the count is printed in ink.
    matrixHost.append(el("section", { class: "card unclassified-card" },
      el("div", { class: "kpi-label" },
        el("i", { class: "hatch unclassified-swatch", "aria-hidden": "true" }),
        tipLabel("Unclassified", {
          term: "unclassified",
          lines: [
            "Held outside the four corners above, never folded into one: those sum to "
            + fmtCount(view.cellTotal) + " classified findings, and these "
            + fmtCount(view.unclassified.total) + " are the rows the rule could not place.",
            "They are what the coverage and efficiency bounds are computed from — the two"
            + " extreme re-labellings are of exactly these rows.",
          ],
        })),
      el("div", { class: "kpi-value num" }, fmtCount(view.unclassified.total)),
      el("p", { class: "small muted" },
        fmtCount(view.unclassified.remediated) + " remediated · "
        + fmtCount(view.unclassified.open) + " still open · ",
        el("span", { class: "num" }, view.unclassified.share.text),
        " ",
        denominatorNode(view.unclassified.share))));
  }

  // -------------------------------------------------------------------- signal breakdown

  function renderSignals(program, first) {
    clear(signalHost);
    // GATED WHOLESALE, HEADING INCLUDED — same shape as `renderMatrix` above. "Fired on 0 ·
    // Never captured 0" is a VERDICT on a clause, and this page argues in its own caption that
    // a coverage of 0% is a measurement — it separates "the AI agreed with nothing" from
    // "nobody asked the AI". Neither of those is true over an unread ledger, and printing
    // twelve zeros here (or a heading with nothing under it) would make a third thing look
    // like one of the other two.
    if (first) return;
    const view = signalBreakdownView(program.signals, program.signalCoverage, program.rowCount);
    // THE 72-WORD NOTE IS THE HEADING'S DEFINITION. It said three things and every one of
    // them is about how to READ this table rather than about a figure in it: that the clauses
    // overlap, that a measured 0% is a measurement, and that "not applicable" is a third
    // state. `signal-coverage` is the book's entry for the column those three describe.
    signalHost.append(sectionLabel("What the rule fired on", {
      term: "signal-coverage",
      lines: [
        "The clauses are OR'd and overlap, so these do not sum to the " + fmtCount(view.anyOf)
        + " " + pluralize(view.anyOf, "finding") + " classified high risk.",
      ],
    }));
    signalHost.append(dataTable({
      columns: [
        {
          key: "label",
          label: "Signal",
          cell: (r) => (r.term ? tipLabel(r.label, { term: r.term }) : r.label),
        },
        { key: "fired", label: "Fired on", className: "num", cell: (r) => fmtCount(r.fired) },
        { key: "missing", label: "Never captured", className: "num", cell: (r) => fmtCount(r.missing) },
        {
          key: "coverage",
          label: "Coverage",
          // THE THREE STATES ARE WHY THE METER IS CONDITIONAL — see `signalMeter`.
          help: {
            term: "signal-coverage",
            lines: [
              "How much of the column this clause rests on was ever captured, over the rows"
              + " the signal applies to.",
              "A bar is drawn only where a share was measured: \"always present\" and"
              + " \"not applicable\" are not zeroes and get no track.",
            ],
          },
          cell: (r) => el("span", { class: "rate-with-meter" },
            el("span", { class: "num" }, r.coverageText),
            signalMeter(r),
            el("span", {
              class: "small muted",
              "data-denominator": r.denominator === null ? "none" : String(r.denominator),
            }, r.denominatorLabel)),
        },
      ],
      rows: view.rows,
    }));
    // COMPRESSED TO ITS FIGURE. The 38-word sentence carried one number and a definition of
    // what that number is the size OF; the number and the word stay, the definition moves.
    if (view.cweUnmapped) {
      signalHost.append(el("p", { class: "small muted" }, tipLabel(
        fmtCount(view.cweUnmapped) + " unmapped " + pluralize(view.cweUnmapped, "CWE"),
        {
          term: "cwe-top-25",
          lines: [
            fmtCount(view.cweUnmapped) + " " + pluralize(view.cweUnmapped, "finding")
            + " carry a CWE that matched neither the Top 25 nor a documented ancestor of one.",
            "Those classify low, so this is the size of the ancestry gap measured in findings.",
          ],
        },
      )));
    }
  }

  /**
   * The `meter--stat` beside a signal's coverage — the DOM half of `signalMeterPct`.
   *
   * `decorative`, because `r.coverageText` prints the figure right beside it. The decision
   * about WHETHER there is a bar at all lives at module scope, pure: see that function.
   */
  function signalMeter(row) {
    const pct = signalMeterPct(row);
    return pct === null ? null : meter(pct, { className: "meter--stat", decorative: true });
  }

  // --------------------------------------------------------------------- rule sensitivity

  function renderSensitivity(program) {
    clear(sensitivityHost);
    // THE 40-WORD CHART NOTE, LESS ITS ONE CLAUSE THAT IS A READING. What the axes are and
    // which way is better stays under the canvas, in eleven words; what a POINT is, and that
    // the rule in force is the direct-labelled one, is a definition of the whole section.
    sensitivityHost.append(sectionLabel("Rule sensitivity", {
      lines: [
        "Every non-empty subset of that register's risk signals, scored exactly the way the"
        + " headline pair above is — one point per candidate rule.",
        "The rule actually in force is direct-labelled on the chart and marked “active” in"
        + " the table behind it.",
      ],
    }));
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
      // THE SWEEP IS A DISCLOSURE, NOT A PAGE. On the dev seed this table is 4 rows per
      // scope; on a register with all six signals it is 63, twice — 126 rows of coverage and
      // efficiency between the chart above them and the capacity section below. The chart IS
      // the reading (up and to the right), and the rows behind it are what a reader opens
      // when they want the number for one particular subset. `disclosure`'s summary is the
      // visible signifier R1 requires, and it names the count so nothing is hidden silently.
      sensitivityHost.append(disclosure(
        "All " + fmtCount(group.points.length) + " "
        + pluralize(group.points.length, "subset") + ", as a table",
        dataTable({
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
        }),
      ));

      const canvas = el("canvas", {
        "aria-label": "Coverage against efficiency for every subset of the "
          + group.label + " risk signals",
      });
      sensitivityHost.append(el("section", { class: "chart-card" },
        // One clause: which axis is which and which way is better. The rest is on the
        // section's own heading above.
        el("p", { class: "chart-note" },
          "Coverage (x) against efficiency (y) — up and to the right is better."),
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
    row.append(figureCard({
      label: "Monthly mean closure rate",
      value: view.mmcrMean.text,
      sub: view.monthsCounted
        ? "over " + fmtCount(view.monthsCounted) + " fully observed "
          + pluralize(view.monthsCounted, "month")
        : "no month was fully observed, so there is nothing to average",
      help: { term: "mmcr" },
      // The "Mean close rate base:" line under this row was one denominator drawn as a
      // sentence of its own; `figureCard` puts it on this card's label and into
      // `data-denominator`, which is where every other denominator on this page now is.
      denominator: view.mmcrMean.baseEmpty
        ? "Not measured: " + view.mmcrMean.emptyLabel + "."
        : "Averaged over " + view.mmcrMean.denominatorLabel
          + ". Reconstructed and partial months are excluded by the server rather than"
          + " averaged in, which is what makes this a rate over months anybody watched.",
    }));
    row.append(kpiCard(
      "Roughly",
      view.oneInN === null ? absentText : "1 in " + Math.round(view.oneInN),
      "of what was open at the start of a month gets closed in it",
    ));
    // THE VERDICT IS A WORD, AND THE DOT ONLY REPEATS IT — gas_ai's `.cap-verdict` rule,
    // ported. Three states told apart by hue alone survive neither greyscale nor a dichromat,
    // and this is the one figure on the card a reader takes away.
    row.append(kpiCard(
      "Verdict",
      verdictMark(view.verdict, view.verdictLabel),
      "closures against arrivals, with a two-percent dead band around zero",
      null,
      { term: "capacity" },
    ));
    capacityHost.append(row);

    // THE EIGHT-COLUMN TABLE IS A CHART WITH THAT TABLE BEHIND IT.
    //
    // What was here: one row per month with Open at start, Arrived, Closed, Net, Close rate
    // (a figure, an interval and a base), a Verdict pill and a Measured cell carrying up to
    // two more pills — 8 columns over every month the register has, and the question the
    // section asks ("is remediation keeping up with arrivals?") is a SHAPE across those rows
    // that no column answers. Arrivals against closures per month is that shape.
    //
    // ONE ARRAY, TWO READINGS: `view.months` is handed to the wrapper and to
    // `chartTableModel` in the same statement, which is `ui/chartTable.js`'s one rule — a
    // table derived a second time from the payload is how a chart and its "equivalent" table
    // start disagreeing. Every column the old table had is still in it.
    const months = view.months;
    capacityHost.append(chartCard(
      "Arrivals against closures, by month",
      "Net " + signedCount(view.netTotal) + " over " + fmtCount(months.length) + " "
        + pluralize(months.length, "month"),
      (api, canvas) => api.monthlyCapacityBars(canvas, months, {}),
      {
        caption: "Every month above as a row: what was open when it started, what arrived,"
          + " what closed, the net movement, that month's own close rate against its starting"
          + " backlog, its verdict, and whether anybody was watching at the time.",
        model: chartTableModel({
          columns: [
            { key: "month", label: "Month", format: "text", align: "text" },
            { key: "openAtStart", label: "Open at start", format: "count" },
            { key: "opened", label: "Arrived", format: "count" },
            { key: "closed", label: "Closed", format: "count" },
            {
              key: "net",
              label: "Net",
              format: "text",
              value: (m) => signedCount(m.net),
            },
            {
              key: "mmcr",
              label: "Close rate",
              format: "text",
              value: (m) => m.mmcr.text,
            },
            { key: "verdict", label: "Verdict", format: "text", align: "text",
              value: (m) => m.verdictLabel },
            {
              key: "state",
              label: "Measured",
              format: "text",
              align: "text",
              // The mark is the whole point of this column: a month nobody was watching must
              // not read as a month that was measured and happened to look like this.
              value: (m) => (m.measured ? "observed" : m.marks.join(", ")),
            },
          ],
          rows: months,
        }),
      },
      { term: "capacity" },
    ));

    // COMPRESSED TO ITS TWO FIGURES. 55 words said how many months were not observed, that
    // they are out of the headline rate, and what each of the two marks means. The count and
    // the words "reconstructed or partial" are the honesty statement and stay on the surface;
    // the two definitions are the `reconstructed` entry's own job.
    capacityHost.append(el("p", { class: "small muted" },
      view.unmeasuredCount
        ? tipLabel(
          fmtCount(view.unmeasuredCount) + " of " + fmtCount(months.length) + " "
          + pluralize(months.length, "month") + " reconstructed or partial",
          {
            term: "reconstructed",
            lines: [
              "Those months are excluded from the headline close rate above rather than"
              + " averaged into it.",
              "A reconstructed month ended before this register started watching, so its"
              + " backlog is real but nobody was looking in real time; a partial month is"
              + " simply not over yet.",
            ],
          },
        )
        : "Every month here was directly observed."));
  }

  // ------------------------------------------------------------- coverage over time

  function renderTrend(payload, program) {
    clear(trendHost);
    // THE 48-WORD CHART NOTE, SPLIT THE WAY R2 SPLITS ONE. Two of its three clauses are
    // method — why the pair shares an axis, and what the shaded band is — so they are on the
    // heading. The third is an honesty statement about what a GAP in the line means, and a
    // gap is the one thing on this chart a reader could take for a zero, so it stays on the
    // surface with the reconstructed count beside it.
    trendHost.append(sectionLabel("Coverage and efficiency over time", {
      term: "reconstructed",
      lines: [
        "Both rates on one axis, because the trade-off between them is the story: a coverage"
        + " line climbing while efficiency falls is legible only when they share a scale.",
        "The shaded band marks the reconstructed prefix — one point per day of pre-scan"
        + " history rebuilt from first-detection dates, where closures are under-counted.",
      ],
    }));
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
      // The two figures and the one word a gap has to carry. "Drawn as a gap rather than as
      // a zero" is R2's KEEP case in its purest form: the line's own absence is the claim,
      // and a reader who takes it for a zero reads a failure that did not happen.
      el("p", { class: "chart-note" },
        (reconstructed
          ? fmtCount(reconstructed) + " of " + fmtCount(points.length) + " "
            + pluralize(points.length, "point") + " reconstructed · "
          : "")
        + "a gap is a date with nothing high risk, drawn as a gap and never as a zero"),
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
