// Program performance — remediation coverage, efficiency, and capacity, the metric family
// from the Cisco Kenna / Cyentia "Prioritization to Prediction" research.
//
// MTTR & SLA answers "how fast are we closing risk". This page answers "are we closing the
// RIGHT risk", and it is built to be *checked*, not just read: every figure is traceable from
// the hero down to the individual finding. The confusion matrix carries real counts and each
// cell opens the findings behind it; the classifier that produced those counts is stated in
// words and editable in Settings; the share of the register that could not be classified at
// all is shown beside every rate rather than quietly dropped; and the whole classified set
// exports as CSV so a reader can recompute the page in a spreadsheet.

import { capacityHindcastView, VERDICT } from "./programCapacity.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { meterPctFor, rateView } from "./mttr.js";
import { denominatorNode, rateCell } from "./_rates.js";
import { scatterTableModel, trendTableModel } from "./_charts.js";
import { call } from "../../../../../gas_shared/api.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  DEFAULT_PAGE_SIZE, PAGE_SIZES, absent, absentText, bookTip, chartTable, clear, dataTable,
  downloadText, el, emptyState, errorState, fmtDate, glossaryTip, meter, num, openSheet,
  pageHeader, pct1, quadModel, quadTable, scopeBar, sectionLabel, sevBadge, skeleton,
  statusPill, tableFooter, tip, tipLabel, toast,
} from "../ui.js";

// Matrix cells, in reading order. `key` matches the server's `matrix_cell` / cohort quadrant
// so a cell button and its drill-down can't drift apart. `word` is the plain-English label
// that sits beside the TP/FP/FN/TN shorthand — the shorthand alone is jargon, and a leader
// reading this page should not have to decode it.
// `term`, NOT `help`, AND THE SENTENCES MOVED RATHER THAN BEING DELETED. Each cell's one
// help line is a glossary entry in helpContent.js now, which is what lets the key sheet list
// all six beside the two rates they move. The cell reads its entry through `bookTip`.
//
// BOOKTIP RATHER THAN `tip(..., { term })`, AND THE REASON IS MEASURED. A term tip registers
// the anchor in tip.js's ACTIVATE map, and tip.js's delegated click handler then runs
// `navigate("help", { term })` WITHOUT preventDefault or stopPropagation. Every cell here is
// already a button that opens its cohort drill-down, so a term tip would open the sheet AND
// route away from it on one click. bookTip attaches the card and no activation, so the
// sentence still lives once and the button still does the one thing it says. What it gives up
// is the "Enter for the full definition" affordance — which is exactly the trade
// gas_shared/ui/tip.js's own bookTip header describes for a badge inside a focusable row.
const CELLS = {
  tp: { abbr: "TP", word: "Fixed, and it mattered", term: "cell-tp" },
  fp: { abbr: "FP", word: "Fixed, but low risk", term: "cell-fp" },
  fn: { abbr: "FN", word: "High risk, still open", term: "cell-fn" },
  tn: { abbr: "TN", word: "Correctly deprioritized", term: "cell-tn" },
  unknownRemediated: {
    abbr: "", word: "Unclassified, remediated", term: "cell-unclassified-remediated",
  },
  unknownOpen: { abbr: "", word: "Unclassified, still open", term: "cell-unclassified-open" },
};

/**
 * Percent to one decimal, or the shared muted dash — `ui/figures.js`'s `pct1`, not a second
 * copy. `pct` USED TO BE its own function here, checking `v === null || v === undefined` before
 * casting (already correct — this page never had the `Number(null)` defect) and hand-typing the
 * dash it returned. `pct1` does the identical arithmetic through the shared `num()` allowlist
 * (a superset: it also refuses `""`/`[]`/`false` rather than only `null`/`undefined` by
 * identity) and returns the ONE spelling of the dash (`ui/figures.js`'s `absentText`) instead of
 * a hand-typed literal — the port this page had not yet made.
 */
const pct = pct1;

/**
 * Percent with no decimals, for dense table cells — the monthly capacity table, the hero's
 * "Monthly close rate" mini, and the methodology's unclassified-share clause. Kept as its own
 * format rather than collapsing onto `pct1` (one decimal) or `./_rates.js`'s `fmtPct` (also one
 * decimal): a close rate read to a tenth of a percent is false precision at these row counts,
 * and the rounding grain is the whole reason this page has never used `pct1` for it. Refuses
 * through the shared `num()` allowlist and returns the shared `absentText` rather than the
 * hand-typed "—" this used to carry — see `pct` above for why that swap is safe.
 */
function pct0(v) {
  const n = num(v);
  return n === null ? absentText : Math.round(n) + "%";
}

/**
 * The same percent, in a position that can hold a Node.
 *
 * `pct` and `pct0` above have to keep returning STRINGS: three call sites each concatenate them
 * into a sentence (the range beside a rate, the hero source line, the methodology arithmetic),
 * and `absent()` is a Node, which `+` would render as "[object HTMLSpanElement]". So the muted
 * dash arrives here instead, at the two call sites that are real cells (the hero's "Monthly
 * close rate" mini and the unclassified-share pill's own wording).
 *
 * NOT `rateCell` (`./_rates.js`, imported below for the one cell that does fit its shape — see
 * the "Close rate" column in `renderCapacity`). `capOverall.mmcrMean` and the unclassified share
 * are bare percentages with no single count attached at this call site to serve as
 * `rateView`'s denominator: the mean's own base ("N complete month(s)") is a sentence in the
 * note paragraph below the table, not a count sitting beside the mini, and the unclassified
 * share's base is `m.total`, already stated in the same sentence this value is embedded in.
 * Forcing either through `rateCell`'s figure-then-denominator-line shape would either need a
 * denominator slot this page's compact minis do not have, or repeat a count the sentence
 * already gives.
 */
function pct0Cell(v) {
  const n = num(v);
  return n === null ? absent() : pct0(n);
}

/**
 * A `{point, lo, hi}` rate, its interval, and the base it was taken over — ported from
 * `gas_devsecops/src/client/js/pages/program.js`, unchanged in shape. `src/domain/program.ts`'s
 * `finalize()` already hands this page `m.coverage` / `m.efficiency` in exactly that shape
 * (a `NO_RATE` of `{point: null, lo: null, hi: null}` when the denominator was empty), so this
 * is the one place that turns it into text and a bounds sentence rather than every call site
 * doing the null-before-cast dance by hand.
 *
 * `hasBounds` is false only when `lo === point === hi`, which happens exactly when nothing was
 * unclassified — the one case where the bare point is the whole truth and no bracket is drawn.
 */
export function boundedRateView(rate, denominator, denominatorLabel, emptyLabel) {
  const r = rate || {};
  const den = num(denominator);
  const point = num(r.point);
  const lo = num(r.lo);
  const hi = num(r.hi);
  const measured = den !== null && den > 0 && point !== null;
  const hasBounds = measured && lo !== null && hi !== null
    && (Math.abs(lo - point) > 1e-9 || Math.abs(hi - point) > 1e-9);
  return {
    measured,
    point: measured ? point : null,
    lo,
    hi,
    text: measured ? pct(point) : "not measured",
    boundsText: hasBounds ? pct(lo) + " to " + pct(hi) : null,
    hasBounds,
    denominator: den,
    denominatorLabel,
    baseEmpty: !(den !== null && den > 0),
    emptyLabel: emptyLabel || "nothing has been measured to take it over",
  };
}

/**
 * The 2x2, and the rows that are not in it — ported from gas_devsecops's `confusionView`,
 * unchanged in shape. `cells` sums to `classified` by construction; `unclassified` is a
 * SIBLING of that array, never a fifth cell, so `confusionQuadModel` below cannot mistake
 * "the rule could not place this" for "the rule placed this and called it low risk".
 *
 * LABELS COME FROM `CELLS` ABOVE, gas's own — not gas_devsecops's wording. The four corners
 * keep the readings the hand-built table already drew ("Fixed, and it mattered", …), so the
 * glossary entries those readings link to (`cell-tp` etc.) keep describing what is on screen.
 */
export function confusionView(matrix) {
  const m = matrix || {};
  const cells = [
    { key: "tp", row: "High risk", column: "Remediated", label: CELLS.tp.word,
      value: Number(m.tp || 0) },
    { key: "fn", row: "High risk", column: "Still open", label: CELLS.fn.word,
      value: Number(m.fn || 0) },
    { key: "fp", row: "Not high risk", column: "Remediated", label: CELLS.fp.word,
      value: Number(m.fp || 0) },
    { key: "tn", row: "Not high risk", column: "Still open", label: CELLS.tn.word,
      value: Number(m.tn || 0) },
  ];
  const unknownRemediated = Number(m.unknownRemediated || 0);
  const unknownOpen = Number(m.unknownOpen || 0);
  const classified = Number(m.classified || 0);
  const total = Number(m.total || 0);
  return {
    cells,
    cellTotal: cells.reduce((a, c) => a + c.value, 0),
    classified,
    total,
    unclassified: {
      // Named and placed outside on purpose — see the module header above `confusionView`.
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
        total.toLocaleString() + " findings in scope",
      ),
    },
  };
}

/**
 * Which corner of the matrix is good news, which is bad, and which is neither.
 *
 * `fp` IS "warn", NOT "bad" — effort spent on a finding the rule did not rate high is the cost
 * side of the pair this page publishes (efficiency is exactly that corner's share), not a
 * failure, so colouring it an error would make a verdict the arithmetic does not.
 */
const CONFUSION_TONES = { tp: "ok", fn: "bad", fp: "warn", tn: "neutral" };

// A LOOKUP, NOT `"cell-" + key` AT THE CALL SITE. `test/helpContent.test.js`'s
// `referencedGlossaryIds` sweep matches the FIRST double-quoted literal after `term:` to
// check it against the book — a concatenation would have hung the literal `"cell-"` in front
// of it, which the sweep reads as a (non-existent) id of its own. `CELLS` above already
// carries these same four ids as `.term`; this is a second, tiny map rather than a reach
// into that one, because `CELLS` also holds the two unclassified-pair keys this map does not.
const CELL_TERMS = { tp: "cell-tp", fn: "cell-fn", fp: "cell-fp", tn: "cell-tn" };

/**
 * The confusion matrix as a `quadModel` — ported from gas_devsecops's `confusionQuadModel`.
 *
 * THE SHARES ARE TAKEN AGAINST `classified`, NOT `total`, and that is the one arithmetic
 * decision in this function. The four corners sum to `classified` by construction; the
 * unclassified rows are a SIBLING of the array, drawn beside the grid under a hatch — passing
 * `total` here would leave four shares summing to less than 100% with nothing on the grid
 * explaining the missing share. `test/quadPages.test.js` reproduces that rewrite inline.
 *
 * `help` REUSES GAS'S OWN cell-tp/cell-fp/cell-fn/cell-tn GLOSSARY IDS — the same entries the
 * hand-built table drew through `bookTip` before this package, not a second copy of them.
 */
export function confusionQuadModel(view) {
  const cells = (view && view.cells) || [];
  const at = (key) => cells.filter((c) => c.key === key)[0] || {};
  const corner = (key, row, col) => {
    const c = at(key);
    // NO FALLBACK LABEL, and that is the point rather than an omission: `quadModel` REFUSES a
    // corner with no word, and "tp" is a word only in the sense that it is a string — a toned
    // cell reading "tp" would pass the refusal while defeating what it protects.
    return {
      row,
      col,
      count: c.value === undefined ? null : c.value,
      label: c.label,
      tone: CONFUSION_TONES[key] || "neutral",
      help: { term: CELL_TERMS[key] },
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
 * Which cohort quadrant a matrix corner opens, and whether it should — pure, so the guard is
 * testable with no DOM (`quadTable`'s `cellAction` calls this and builds the button itself).
 *
 * THE GUARD IS `corner.count > 0`. An empty corner has no findings behind it, so its action
 * would open a cohort sheet with nothing in it — an unopenable-looking control that opens
 * anyway. `gas/test/quadAction.test.js` drops this guard and captures the result.
 */
export function matrixCellActionSpec(corner) {
  if (!corner || !(corner.count > 0)) return null;
  const quadrant = corner.row
    ? (corner.col ? "tp" : "fn")
    : (corner.col ? "fp" : "tn");
  return {
    quadrant,
    count: corner.count,
    ariaLabel: corner.label + ": open the " + corner.count.toLocaleString() + " findings",
  };
}

/**
 * A `rateView` whose visible TEXT goes through this page's own `pct` (`pct1`, one guaranteed
 * decimal) rather than `./_rates.js`'s `fmtPct` (a decimal only when rounding produces one —
 * `fmtPct(0)` is "0%", not "0.0%"). Every other percentage on this page already reads through
 * `pct`; the by-severity table is the one place `rateView`'s own formatter would otherwise
 * print a measured zero one way here and every other rate on the page another way. The
 * measured / baseEmpty / denominator machinery is `rateView`'s, unchanged.
 */
function severityRateView(point, denominator, denominatorLabel) {
  const view = rateView(point, denominator, denominatorLabel);
  return view.measured ? { ...view, text: pct(view.value) } : view;
}

/**
 * Coverage and efficiency per severity, from `confusionBySeverity`'s `perSev` half of the
 * payload — shipped by `api_getProgramPage` (src/server/api.ts) since the cross above was
 * first ported, and drawn nowhere until this package.
 *
 * EACH RATE READS AGAINST `classified` FOR THAT SEVERITY, not against the sub-denominator
 * (tp+fn for coverage, tp+fp for efficiency) the top-of-page bounded rates use — a coarser,
 * single base that lets one row hold both figures against one denominator instead of two
 * different populations per row.
 */
export function confusionSeverityRows(perSev) {
  const bySev = perSev || {};
  return Object.keys(bySev).map((sev) => {
    const m = bySev[sev] || {};
    const classified = num(m.classified, 0);
    const label = "of " + classified.toLocaleString() + " classified";
    return {
      sev,
      classified,
      unclassified: num(m.unknown, 0),
      coverage: severityRateView(m.coverage && m.coverage.point, classified, label),
      efficiency: severityRateView(m.efficiency && m.efficiency.point, classified, label),
    };
  });
}

/** The `meter--stat` beside a by-severity coverage/efficiency figure — the DOM half of
 *  `meterPctFor`. Decorative: the rate's own text already prints the figure beside it. */
function severityMeter(rate) {
  const pctVal = meterPctFor(rate);
  return pctVal === null ? null : meter(pctVal, { className: "meter--stat", decorative: true });
}

/**
 * Cell content at caption size, as a span rather than as a class on the cell.
 *
 * `dataTable` lands `col.className` on the <th> as well as on every <td>, which is exactly what
 * the numeric columns here want — a right-aligned heading over right-aligned figures. `.small`
 * is the opposite case: it is 12px where a table heading is 11px, so putting it on the column
 * would enlarge the heading in order to shrink the column. A span keeps the two apart.
 */
function small(...kids) {
  return el("span", { class: "small" }, ...kids);
}

/**
 * The hero rate's own bare value, or the muted dash — the DOM half of `boundedRateView`'s
 * `measured` flag. A Node child position (the coverage hero value and the efficiency stat
 * beside it), so an unmeasured rate draws `absent()` rather than the plain-ink string
 * `boundedRateView` itself returns for a table cell.
 */
function rateNode(rate) {
  return rate.measured ? rate.text : absent();
}

/**
 * The uncertainty the unclassified population implies, as a subordinate clause beside the
 * rate: "bounds 50.0% to 66.7%" — `boundedRateView`'s own `boundsText`, worded as a clause
 * rather than a bare range. Rendered only when there is real doubt (`hasBounds`); with every
 * finding classified the bounds collapse onto the point and the figure stands bare.
 *
 * This is the honest-state device the whole page hangs on: the width of the bracket IS the
 * size of the unclassified bucket, so missing data cannot hide behind a confident-looking
 * number.
 */
function boundsNode(rate) {
  return rate.hasBounds ? el("span", { class: "prog-range" }, "bounds " + rate.boundsText) : null;
}

/**
 * Net-capacity verdict as a pill carrying a glyph and a word — never colour alone.
 *
 * `VERDICT` moved to programCapacity.js rather than being copied into it: the track-record
 * table below prints the same three words, and two maps would let the pill and the table
 * disagree about what a verdict is called.
 */
function verdictPill(v) {
  const spec = VERDICT[v];
  // `absent()` IS this span, written once — same tag, same class, same dash. Spelling it out
  // here was one of the six hand-typed em dashes the shared helper was promoted to end.
  if (!spec) return absent();
  return statusPill(spec.pill, spec.glyph + " " + spec.text);
}

export async function renderProgram(main, _params, ctx) {
  const boot = await bootstrap();

  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  const severities =
    sevScope.length === boot.palette.selectable.length ? null : sevScope;

  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";
  const params = { domain, supportGroup, severities };

  let paint;
  const dataPromise = swrCall("api_getProgramPage", params, (fresh) => paint && paint(fresh));

  main.append(pageHeader({
    route: "program",
    help: { term: "coverage" },
    lede: "Whether remediation effort lands on the findings that matter. Coverage and "
      + "efficiency pull against each other, so neither means anything alone.",
  }));

  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);

  const heroHost = el("div", {});
  const matrixHost = el("div", {});
  const trendHost = el("div", {});
  const ruleHost = el("div", {});
  const capacityHost = el("div", {});
  const methodHost = el("div", {});
  main.append(heroHost, matrixHost, trendHost, ruleHost, capacityHost, methodHost);

  renderSkeleton();

  // One failing section must not blank the page — same guard pattern as the executive view.
  function guard(label, host, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[program] " + label + " render failed:", e);
      // errorState, NOT emptyState — see the same guard on the executive page: a section
      // that threw is a defect, not an absence, and the exception belongs in a disclosure
      // rather than on the floor.
      if (host) {
        clear(host).append(errorState("Couldn't render " + label + ".",
          { detail: String((e && e.message) || e) }));
      }
    }
  }

  paint = (data) => {
    const p = data && data.program;
    const trends = (data && data.trends && data.trends.trend) || [];
    if (!p || !p.rowCount) {
      clear(heroHost).append(emptyState(
        "No lifecycle data yet.",
        "Coverage and efficiency need at least one saved scan.",
      ));
      [matrixHost, trendHost, ruleHost, capacityHost, methodHost].forEach((h) => clear(h));
      return;
    }
    guard("headline", heroHost, () => renderHero(p));
    guard("confusion matrix", matrixHost, () => renderMatrix(p));
    guard("trend", trendHost, () => renderTrend(trends));
    guard("classifier", ruleHost, () => renderRule(p));
    guard("capacity", capacityHost, () => renderCapacity(p));
    guard("methodology", methodHost, () => renderMethodology(p, trends));
  };

  try {
    paint(await dataPromise);
  } catch (e) {
    console.error("[program] getProgramPage failed:", e);
    // errorState, NOT emptyState — the same correction the per-section `guard` above already
    // carries. An RPC that THREW was being announced through emptyState's role="status", in the
    // same dashed box this register uses for "no scan saved yet", so a screen reader heard a
    // crash as calm news; and the exception itself went nowhere but the console. The hint
    // sentence goes with it: a disclosure carrying the real message beats advice that may not
    // apply. gas_shared/test/contracts/emptyStates.js is what now holds the distinction.
    clear(heroHost).append(errorState("Couldn't load program performance.",
      { detail: String((e && e.message) || e) }));
    [matrixHost, trendHost, ruleHost, capacityHost, methodHost].forEach((h) => clear(h));
  }

  function renderSkeleton() {
    clear(heroHost).append(
      el("div", { class: "hero", role: "status", "aria-label": "Computing coverage" },
        el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
          skeleton("title", { width: "150px" }),
          skeleton("stat", { width: "96px" })),
        el("div", { style: "margin-top:10px" }, skeleton("line", { width: "60%" })),
        el("div", { class: "hero-minis" },
          ...[0, 1, 2, 3].map(() => el("div", {},
            el("div", { style: "margin-bottom:8px" }, skeleton("line", { width: "84px" })),
            skeleton("stat", { width: "56px" }))))),
    );
    clear(matrixHost).append(
      el("div", { style: "margin:28px 0 12px" }, skeleton("line", { width: "180px" })),
      el("div", { class: "table-wrap", style: "padding:14px" },
        ...[0, 1, 2].map(() => el("div", { style: "margin:10px 0" }, skeleton("line")))),
    );
  }

  // ------------------------------------------------------------------------ hero

  /**
   * One hero value (DESIGN.md allows exactly one per page): coverage — the risk-facing
   * number. Efficiency sits beside it a step down, the same `metric` + secondary-stat
   * pairing the MTTR page uses for its KM and naive medians, so the pair reads together
   * without a second 2rem figure competing.
   */
  function renderHero(p) {
    clear(heroHost);
    const m = p.matrix;
    // `boundedRateView` — ported from gas_devsecops — replaces the ad hoc `rateText`/
    // `rangeNode` pair this page carried before this package: the same refuse-before-cast
    // logic, but shared with the by-severity table below rather than typed twice.
    const covRate = boundedRateView(
      m.coverage, m.tp + m.fn,
      (m.tp + m.fn).toLocaleString() + " classified high-risk findings",
      "no finding has been classified high risk",
    );
    const effRate = boundedRateView(
      m.efficiency, m.tp + m.fp,
      (m.tp + m.fp).toLocaleString() + " classified remediations",
      "no classified finding has been remediated",
    );
    // `tip(..., { term })` RATHER THAN `glossaryTip`, AND THE ONE LINE THAT STAYS IS WHY.
    // Each of these tips opened with THIS scan's arithmetic — "TP / (TP + FN) — here 412 of
    // 1,204" — which no glossary entry can carry and which is the part that makes the rate
    // checkable rather than asserted. So the figure-bearing line stays in place and `term`
    // adds the route; the two general lines each tip used to carry (what the bracketed range
    // means, why the pair is never published apart) moved into helpContent.js, where the
    // Efficiency entry can finally state the prevalence floor without restating it here.
    const cov = tip(
      [
        el("div", { class: "label" }, "Remediation coverage"),
        el("div", { class: "hero-value num" }, rateNode(covRate), boundsNode(covRate)),
        denominatorNode(covRate),
      ],
      [
        "Of every finding the active rule calls high risk, the share that has been " +
          "remediated. TP / (TP + FN) — here " + m.tp.toLocaleString() + " of " +
          (m.tp + m.fn).toLocaleString() + ".",
      ],
      { term: "coverage" },
    );
    const eff = tip(
      [
        el("div", { class: "label" }, "Efficiency"),
        el("div", { class: "kpi-value num" }, rateNode(effRate), boundsNode(effRate)),
        denominatorNode(effRate),
      ],
      [
        "Of everything remediated, the share that was actually high risk. TP / (TP + FP) — " +
          "here " + m.tp.toLocaleString() + " of " + (m.tp + m.fp).toLocaleString() + ".",
        m.prevalence !== null
          ? "Picking findings at random would score about " + pct(m.prevalence) +
            " here, because that is the share of classified findings that are high risk."
          : null,
      ].filter(Boolean),
      { term: "efficiency" },
    );

    const minis = el("div", { class: "hero-minis" });
    const capOverall = p.capacity || {};
    const capHigh = p.capacityHighRisk || {};
    const miniDefs = [
      ["High risk, still open", m.fn.toLocaleString(), null],
      ["High risk, remediated", m.tp.toLocaleString(), null],
      [
        "Monthly close rate",
        pct0Cell(capOverall.mmcrMean),
        capOverall.oneInN
          ? el("span", { class: "prog-range" }, "1 in " + capOverall.oneInN.toFixed(1))
          : null,
      ],
      ["Net capacity (high risk)", verdictPill(capHigh.verdict), null],
    ];
    for (const [label, value, extra] of miniDefs) {
      minis.append(el("div", {},
        el("div", { class: "mini-label" }, label),
        el("div", { class: "mini-value num" }, value, extra || null)));
    }

    heroHost.append(
      el("div", { class: "hero" },
        el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
          cov, eff),
        el("div", { class: "hero-src" },
          m.total.toLocaleString() + " tracked lifecycle(s) · " +
          m.classified.toLocaleString() + " classified (" + pct0(m.signalCoveragePct) + ") · " +
          m.unknown.toLocaleString() + " with no captured exploit signal"),
        minis),
    );

    // Honest state, stated where it cannot be missed rather than buried in the methodology
    // block: a rate computed over a thin slice of the register is not a rate for the
    // register, and the reader has to know that before acting on the number above.
    if (m.signalCoveragePct !== null && m.signalCoveragePct < 80) {
      heroHost.append(el("p", { class: "note note--warn" },
        statusPill("warn", "⚠ " + pct0(100 - m.signalCoveragePct) + " unclassified"),
        " These rates describe only the " + m.classified.toLocaleString() +
        " lifecycle(s) that carry a captured exploit signal. Findings recorded before " +
        "exploit intelligence was stored in the ledger cannot be scored; run the risk " +
        "backfill from Settings to recover what the scan archives still hold."));
    }
  }

  // -------------------------------------------------------------- confusion matrix

  /**
   * The transparency centrepiece: the 2×2 with real counts, every corner a button into the
   * findings behind it — `gas_shared/ui/quad.js`'s cross, ported in for this page the way the
   * secrets and program lanes already draw it in `gas_devsecops`. The unclassified counts sit
   * OUTSIDE the grid, in their own hatched card below it, never a fifth quadrant.
   *
   * Deliberately uncoloured beyond the design system's own tone washes. These are counts, not
   * severities, and DESIGN.md's Rationed Ink rule reserves saturation for real risk signal —
   * a red-washed FN cell would be exactly the "security-vendor theater" the product explicitly
   * steers away from. `quadModel`'s tones (`CONFUSION_TONES` above) are a 12% wash on the
   * diagonal, not a severity palette.
   */
  function renderMatrix(p) {
    clear(matrixHost);
    const m = p.matrix;
    matrixHost.append(el("div", { class: "section-head" },
      sectionLabel("What the effort landed on"),
      el("button", {
        class: "linklike",
        onclick: () => exportCsv(""),
      }, "Download classified rows (CSV)")));

    const view = confusionView(m);
    const model = confusionQuadModel(view);
    matrixHost.append(quadTable(model, {
      ariaLabel: "Classified risk against remediation outcome, over "
        + view.classified.toLocaleString() + " classified findings",
      // The corner's own drill-down — reuses the SAME `openCohort`/`api_getRiskCohort` path
      // the hand-built table used, paging and errorState included. `matrixCellActionSpec`
      // is the pure half (the count > 0 guard); this is only the DOM half of it.
      cellAction: (corner) => {
        const spec = matrixCellActionSpec(corner);
        if (!spec) return null;
        return el("button", {
          type: "button",
          class: "linklike quad-action",
          onclick: () => openCohort(spec.quadrant, spec.count),
          "aria-label": spec.ariaLabel,
        }, "Open list");
      },
    }));

    // OUTSIDE the grid, never a fifth cell — the unclassified pair as its own hatched card,
    // each half its own cohort drill-down (the SAME `unknownRemediated`/`unknownOpen`
    // quadrants the old table's bottom row opened, via the same `CELLS`/`openCohort`).
    const u = view.unclassified;
    const unkBtn = (key, count, word) => {
      const spec = CELLS[key];
      const btn = el("button", {
        type: "button",
        class: "linklike",
        onclick: () => openCohort(key, count),
        disabled: count ? null : true,
      }, count.toLocaleString() + " " + word);
      return bookTip(btn, spec.term);
    };
    matrixHost.append(el("section", { class: "card unclassified-card" },
      el("div", { class: "kpi-label" },
        el("i", { class: "hatch unclassified-swatch", "aria-hidden": "true" }),
        // `no-captured-signal`, NOT the generic `unclassified` entry — this card IS the old
        // unclassified row, and that glossary id is written specifically for it ("outside
        // the 2×2 on purpose", the coverage/efficiency inflation it would cause folded in).
        tipLabel("Unclassified", { term: "no-captured-signal" })),
      el("div", { class: "kpi-value num" }, u.total.toLocaleString()),
      el("p", { class: "small muted" },
        unkBtn("unknownRemediated", u.remediated, "remediated"),
        " · ",
        unkBtn("unknownOpen", u.open, "still open"),
        " · ",
        el("span", { class: "num" }, u.share.text),
        " ",
        denominatorNode(u.share))));

    matrixHost.append(el("p", { class: "note" },
      "Coverage reads across the top row (" + m.tp.toLocaleString() + " of " +
      m.highRisk.toLocaleString() + "). Efficiency reads down the Remediated column (" +
      m.tp.toLocaleString() + " of " + (m.tp + m.fp).toLocaleString() +
      "). Select \"Open list\" on any corner, or the figures below it, for the findings " +
      "behind them."));

    renderSeverityBreakdown(p);
  }

  /**
   * `confusionBySeverity`'s `perSev` half of `p` (src/server/api.ts), drawn as its own table
   * under the cross — shipped since the matrix above was first ported, and drawn nowhere
   * until this package. Each row's coverage and efficiency read against `classified` for
   * THAT severity (`confusionSeverityRows`'s own header explains why that denominator, not
   * the tp+fn/tp+fp sub-denominators the hero above uses).
   */
  function renderSeverityBreakdown(p) {
    const rows = confusionSeverityRows(p.perSev);
    if (!rows.length) return;
    matrixHost.append(sectionLabel("By severity"));
    matrixHost.append(dataTable({
      columns: [
        {
          key: "sev",
          label: "Severity",
          help: ["The finding's severity, as assigned by the scan."],
          cell: (r) => sevBadge(r.sev),
        },
        {
          key: "coverage",
          label: "Coverage",
          className: "num",
          help: { term: "coverage" },
          cell: (r) => el("span", { class: "rate-with-meter" },
            rateCell(r.coverage), severityMeter(r.coverage)),
        },
        {
          key: "efficiency",
          label: "Efficiency",
          className: "num",
          help: { term: "efficiency" },
          cell: (r) => el("span", { class: "rate-with-meter" },
            rateCell(r.efficiency), severityMeter(r.efficiency)),
        },
        {
          key: "classified",
          label: "Classified",
          className: "num",
          help: ["How many findings of this severity carried a captured exploit signal and "
            + "could be scored either way."],
          cell: (r) => r.classified.toLocaleString(),
        },
        {
          key: "unclassified",
          label: "Unclassified",
          className: "num",
          help: { term: "unclassified" },
          cell: (r) => r.unclassified.toLocaleString(),
        },
      ],
      rows,
    }));
  }

  /** Drill-down: the actual findings in one matrix cell, paged, from the durable ledger. */
  function openCohort(quadrant, total) {
    const spec = CELLS[quadrant];
    let page = 0;
    // The size the sheet opens at, and now also a size the reader can change. It has to be a
    // member of the `sizes` list handed to tableFooter below or the <select> renders blank —
    // `sizeSelect.value = String(pageSize)` matches no option and the browser falls back to the
    // first entry, which would then lie about how many rows are on screen.
    let pageSize = DEFAULT_PAGE_SIZE;
    openSheet((body) => {
      const host = el("div", {});
      body.append(host);
      const load = async () => {
        clear(host).append(el("div", { class: "muted" }, "Loading…"));
        try {
          const res = await call("api_getRiskCohort", {
            ...params, quadrant, page, pageSize,
          });
          clear(host);
          if (!res.rows.length) {
            host.append(emptyState("No findings in this cell."));
            return;
          }
          host.append(dataTable({
            columns: [
              {
                key: "finding",
                label: "Finding",
                help: ["The CVE (or vuln key) and the asset it was found on."],
                cell: (r) => el("div", {},
                  el("div", {}, r.cve || r.vuln_key),
                  el("div", { class: "muted small" }, r.asset_name || "")),
              },
              {
                key: "severity",
                label: "Severity",
                help: ["The finding's severity, as assigned by the scan."],
                cell: (r) => sevBadge(r.severity),
              },
              // `.small` rides on a span inside the cell rather than on `className`, and the
              // three columns below do the same. `dataTable` puts `col.className` on the <th>
              // too — which is what the numeric tables on this page WANT — but `.small` is
              // 12px against the heading's own 11px, so spending it there would enlarge three
              // headings to shrink three columns.
              {
                key: "signals",
                label: "Signals",
                help: ["Which exploitation signals fired on this finding — CISA KEV, a known "
                  + "exploit, or EPSS above the rule's threshold."],
                cell: (r) => small(signalText(r)),
              },
              {
                key: "first_seen",
                label: "First seen",
                help: ["When this finding was first detected."],
                cell: (r) => small(fmtDate(r.first_seen)),
              },
              {
                key: "resolved_at",
                label: "Resolved",
                help: ["When this finding was resolved. Blank while it is still open."],
                // A row still open has no resolution date, and the black dash that used to
                // stand here read as a value in the same ink as the dates above it. `absent()`
                // is a Node, so it replaces the whole cell content rather than being wrapped.
                cell: (r) => (r.resolved_at ? small(fmtDate(r.resolved_at)) : absent()),
              },
            ],
            rows: res.rows,
          }));
          // tableFooter, and UNCONDITIONALLY, where `pager` was drawn only above one page.
          // Two things were wrong with that. A cohort that fitted on one page printed no count
          // at all, so the sheet's subtitle was the only place the size of the cell appeared —
          // and the shared pager's single-page branch is the one that pluralises ("1 row", not
          // the "1 rows" a hand-built count gives), so gating it off threw away the correct
          // spelling along with the number. Second, fifty rows was the only page size on offer.
          // `onPageSize` is handed a page already recomputed to hold the row that was on top, so
          // widening the page does not also move the reader somewhere else.
          host.append(tableFooter({
            page: res.page,
            pageCount: res.pageCount,
            total: res.total,
            pageSize,
            sizes: PAGE_SIZES,
            onPage: (n) => { page = n; load(); },
            onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; load(); },
          }));
        } catch (e) {
          clear(host).append(errorState("Couldn't load these findings.",
            { detail: String((e && e.message) || e) }));
        }
      };
      body.append(el("div", { style: "margin-bottom:12px" },
        el("button", { class: "linklike", onclick: () => exportCsv(quadrant) },
          "Download this cell as CSV")));
      load();
    }, {
      title: spec.word,
      // NOT `spec.help` — a pre-existing, out-of-scope defect this package's own browser
      // check exposed rather than fixed here: `CELLS` carries `abbr`/`word`/`term` (its own
      // header explains the sentences moved to helpContent.js's glossary), and `.help` has
      // not existed on it since that move — every drill-down sheet's subtitle read "N
      // finding(s) · undefined". `spec.word` is already the sheet's own `title`, so the
      // subtitle states only the count.
      subtitle: total.toLocaleString() + " finding(s)",
      width: "min(720px, 96vw)",
      // `resizable: true` replaces `storageKey: "programCohortWidth"`, the same substitution the
      // MTTR by-domain sheet needed and for the same reason: `storageKey` was one of gas's own
      // sheet options and the shared `openSheet` destructures a fixed set, ignoring anything
      // else without complaint — so this drawer had quietly stopped being resizable at all. The
      // shared sheet persists the width itself, under one key for every resizable sheet.
      resizable: true,
    });
  }

  /** Why a row landed where it did — the per-finding justification, in words. */
  function signalText(r) {
    if (r.risk_class === "unknown") return "not captured";
    if (r.risk_class === "low") return "none fired";
    const names = { kev: "CISA KEV", exploit: "exploit", epss: "EPSS" };
    return String(r.fired_signals || "")
      .split(" ")
      .filter(Boolean)
      .map((s) => names[s] || s)
      .join(", ");
  }

  async function exportCsv(quadrant) {
    try {
      const res = await call("api_getExportCoverageCsv", { ...params, quadrant });
      downloadText(res.filename, res.content, "text/csv;charset=utf-8");
      toast(res.rows.toLocaleString() + " row(s) exported.");
    } catch (e) {
      toast("Export failed: " + e.message, "error");
    }
  }

  // ----------------------------------------------------------------------- trend

  function renderTrend(points) {
    clear(trendHost);
    if (!points.length) return;
    trendHost.append(sectionLabel("Over time"));
    const box = el("div", { class: "chart-box" }, el("canvas", {}));
    const card = el("div", { class: "chart-card" },
      el("h3", {}, glossaryTip("Coverage & efficiency over time",
        "coverage-efficiency-trend")),
      box);
    const canvas = box.querySelector("canvas");
    // `points` — the same array the wrapper below is handed — read once, into both.
    card.append(chartTable({
      canvas,
      caption: "Every point of the lines above: date, coverage and efficiency, in percent.",
      model: trendTableModel(points, [
        { key: "coverage_pct", label: "Coverage", format: "pct" },
        { key: "efficiency_pct", label: "Efficiency", format: "pct" },
      ]),
    }));
    trendHost.append(card);
    loadCharts().then((charts) => {
      charts.coverageEfficiencyLines(canvas, points);
    }).catch((e) => {
      console.error("[program] trend chart failed:", e);
      chartUnavailable(canvas);
    });
  }

  // ------------------------------------------------------------------- classifier

  function renderRule(p) {
    clear(ruleHost);
    const s = p.signals || {};
    ruleHost.append(el("div", { class: "section-head" },
      sectionLabel("How high risk is decided"),
      el("a", { href: "#/settings", target: "_self", class: "linklike" }, "Edit the rule →")));

    const clauses = el("ul", { class: "prog-clauses" });
    const clauseRow = (on, label, fired, missing) => {
      if (!on) return null;
      return el("li", {},
        el("span", { class: "prog-clause-name" }, label),
        el("span", { class: "num" }, fired.toLocaleString()),
        missing
          ? el("span", { class: "muted small" },
            " · " + missing.toLocaleString() + " never captured")
          : null);
    };
    const rule = p.rule || {};
    [
      clauseRow(rule.kev, "Listed in the CISA KEV catalog", s.kev || 0, s.kevMissing || 0),
      clauseRow(rule.exploit, "A public exploit exists", s.exploit || 0, s.exploitMissing || 0),
      clauseRow(rule.epss,
        "EPSS at or above " + (rule.epssThreshold ?? 0).toFixed(2),
        s.epss || 0, s.epssMissing || 0),
    ].filter(Boolean).forEach((n) => clauses.append(n));

    ruleHost.append(el("div", { class: "prog-rule-card" },
      el("p", { class: "prog-rule-sentence" },
        // The muted dash rather than a bold black one: with no rule sentence in the payload the
        // sentence has no predicate, and setting that absence in the same bold ink as a real
        // rule claims the register has one.
        "A finding is high risk when ", el("strong", {}, p.ruleSentence || absent()), "."),
      clauses,
      el("p", { class: "note" },
        "The clauses overlap — a finding can satisfy several — so these counts do not sum to " +
        "the " + (s.anyOf || 0).toLocaleString() + " findings flagged high risk overall."),
    ));

    const sens = (p.sensitivity || []).filter(
      (x) => x.coverage !== null && x.efficiency !== null,
    );
    if (sens.length > 1) {
      const box = el("div", { class: "chart-box chart-box--tall" }, el("canvas", {}));
      const canvas = box.querySelector("canvas");
      const card = el("div", { class: "chart-card" },
        el("h3", {}, glossaryTip("How much the rule choice matters",
          "rule-sensitivity")),
        box,
        // `sens` — the same array the wrapper below is handed — read once, into both.
        chartTable({
          canvas,
          caption: "Every point plotted above: the rule, its coverage and efficiency in "
            + "percent, and how many findings it flags high risk.",
          model: scatterTableModel(sens),
        }));
      ruleHost.append(card);
      // The one caveat that must not depend on a hover: each point is scored against its OWN
      // definition of high risk, so a narrow rule can post high coverage simply by flagging
      // few findings. Without this the chart invites the reading that KEV-only "wins".
      ruleHost.append(el("p", { class: "note" },
        "Each point is scored against its own definition of high risk, so the points are not " +
        "competing on a common yardstick: a narrow rule reaches high coverage by flagging " +
        "little. Read this as how sensitive the headline is to the rule, not as which rule " +
        "is right."));
      loadCharts().then((charts) => {
        charts.coverageEfficiencyScatter(canvas, sens);
      }).catch((e) => {
        console.error("[program] scatter failed:", e);
        chartUnavailable(canvas);
      });
    }
  }

  // --------------------------------------------------------------------- capacity

  function renderCapacity(p) {
    clear(capacityHost);
    const cap = p.capacity || {};
    const capHigh = p.capacityHighRisk || {};
    const months = (cap.months || []).slice(-12);
    if (!months.length) return;

    capacityHost.append(sectionLabel("Remediation capacity", { term: "capacity" }));
    capacityHost.append(el("p", { class: "note" },
      "How much of the open backlog the program closes per month, and whether high-risk work " +
      "is arriving faster than it is being cleared. The research benchmark is that a typical " +
      "organization closes about one in ten open findings per month, largely regardless of size."));

    const highByMonth = {};
    for (const m of capHigh.months || []) highByMonth[m.month] = m;

    // `dataTable`: a static seven-column list, one header row, no colspan. The three column
    // definitions that carried a `tip` become `help`, which the component attaches the same way
    // — and the six numeric columns now carry `num` on the heading as well as the cells, so each
    // label sits over its own figures instead of adrift to the left of them.
    capacityHost.append(dataTable({
      columns: [
        {
          key: "month",
          label: "Month",
          help: {
            lines: [
              "The calendar month this row summarizes.",
              "'In progress' means the month is still running; 'reconstructed' predates the "
              + "first saved scan.",
            ],
            term: "reconstructed",
          },
          cell: (m) => {
            const tags = [];
            if (m.partial) tags.push("in progress");
            if (m.reconstructed) tags.push("reconstructed");
            return el("span", {},
              m.month,
              tags.length ? el("span", { class: "muted small" }, " " + tags.join(", ")) : null);
          },
        },
        {
          key: "openAtStart",
          label: "Open at start",
          className: "num",
          help: ["The open backlog at the start of the month."],
          cell: (m) => m.openAtStart.toLocaleString(),
        },
        {
          key: "opened",
          label: "Opened",
          className: "num",
          help: ["Findings that became open during the month."],
          cell: (m) => m.opened.toLocaleString(),
        },
        {
          key: "closed",
          label: "Closed",
          className: "num",
          help: ["Findings that were resolved during the month."],
          cell: (m) => m.closed.toLocaleString(),
        },
        {
          key: "mmcr",
          label: "Close rate",
          className: "num num--key",
          help: ["Closed during the month as a share of the backlog open at its start."],
          // `rateView`/`rateCell` (./mttr.js, ./_rates.js), not `pct0Cell` — this is the one
          // percent on this page with an already-computed single-count denominator sitting in
          // the very same row (`openAtStart`), so a reader can see what the rate was taken over
          // without the arithmetic living only in the help tip above. `rateView(null, 0, …)`
          // is exactly "a month with no backlog at its start has no close rate" — the same
          // absence `pct0Cell` used to draw as a bare muted dash — but now with the population
          // named ("0 open at start") instead of just a figure with nothing beside it. One
          // visible change from the old cell: `rateView`'s `fmtPct` prints one decimal
          // (./_rates.js), where `pct0` printed none — a reader now sees "45.0%" rather than
          // "45%" in this one column.
          cell: (m) => rateCell(rateView(
            m.mmcr, m.openAtStart, m.openAtStart.toLocaleString() + " open at start",
            "no backlog was open at the start of the month",
          )),
        },
        {
          key: "highRiskNet",
          label: "High-risk net",
          className: "num",
          help: ["High-risk findings closed minus high-risk findings opened, that month. " +
            "Positive means the program gained ground on the work that matters."],
          cell: (m) => {
            const hi = highByMonth[m.month];
            // No high-risk row for this month is "we never scored it", not "net zero".
            if (!hi) return absent();
            return (hi.net > 0 ? "+" : "") + hi.net.toLocaleString();
          },
        },
        {
          key: "scanClosed",
          label: "Cross-check",
          className: "num",
          help: ["Resolutions reported independently by the scans that ran in this month " +
            "(reconcile's own per-scan deltas). It should track the Closed column; where it " +
            "does not, the scan cadence crossed a month boundary or the scans were severity-" +
            "scoped."],
          // `.muted` stays on a span inside the cell rather than on the column: it would
          // otherwise repaint this heading a different grey from the six beside it.
          cell: (m) => (m.scanClosed === null || m.scanClosed === undefined
            ? absent()
            : el("span", { class: "muted" }, m.scanClosed.toLocaleString())),
        },
      ],
      rows: months,
    }));
    if (cap.monthsCounted) {
      capacityHost.append(el("p", { class: "note" },
        "Mean close rate " + pct(cap.mmcrMean) +
        (cap.oneInN ? " (about one in " + cap.oneInN.toFixed(1) + ")" : "") +
        " over " + cap.monthsCounted + " complete month(s). Months still in progress, and " +
        "months before the first saved scan, are excluded from that mean."));
    } else {
      // Say why the headline figure is absent rather than leaving an em dash to be
      // misread as zero. Every month here is either still running or predates the scan
      // history, and a mean over reconstructed months would understate the close rate
      // (closures before the first scan are systematically under-counted).
      capacityHost.append(el("p", { class: "note" },
        "No complete month has been fully observed yet, so there is no mean close rate. " +
        "Months marked reconstructed predate the first saved scan and under-count closures; " +
        "the month in progress is not over. The per-month figures above are still exact for " +
        "what was observed."));
    }
    renderHindcast(p);
  }

  /**
   * How the verdict above has actually done — each saved scan, the verdict this page would
   * have shown that day, and what the month after it did.
   *
   * The empty state is not a fallback for a missing payload; it is the honest answer while a
   * register is young, and it goes through `emptyState` for the same reason every other
   * "nothing to show yet" on this page does. `capacityHindcastView` decides which branch it
   * is — this function only draws.
   */
  function renderHindcast(p) {
    const view = capacityHindcastView(p.capacityHindcast);
    capacityHost.append(sectionLabel("Verdict track record"));
    capacityHost.append(el("p", { class: "note" },
      "For each saved scan, the verdict this page would have shown that day, beside what the " +
      "following month actually did. The verdict is the net capacity figure in the header — " +
      "high-risk findings closed against high-risk findings arriving."));
    if (view.empty) {
      capacityHost.append(emptyState(view.empty));
      return;
    }
    capacityHost.append(dataTable({
      columns: [
        {
          key: "asOf",
          label: "As of",
          help: ["The scan this projection was made as of."],
          cell: (r) => fmtDate(r.asOf),
        },
        {
          key: "verdictText",
          label: "Projected",
          help: ["The net-capacity verdict this page would have shown on that scan — gaining "
            + "ground, keeping up or falling behind."],
          cell: (r) => r.verdictText,
        },
        {
          key: "realisedText",
          label: "What happened",
          className: "num",
          help: ["High-risk findings closed minus high-risk findings opened that month, as a " +
            "share of the backlog open at its start. Positive means ground was gained."],
          cell: (r) => r.realisedText,
        },
        {
          key: "agreedText",
          label: "Agreed",
          help: ["Whether the following month's real outcome matched the projected verdict."],
          cell: (r) => r.agreedText,
        },
      ],
      rows: view.rows,
    }));
    capacityHost.append(el("p", { class: "note" }, view.sentence + " " + view.capNote));
  }

  // ------------------------------------------------------------------ methodology

  /**
   * Always present, collapsed by default. Everything a reader needs to reproduce or dispute
   * the figures above: the arithmetic with this register's own numbers substituted in, what
   * "remediated" means here, which global filters were in force, and the known limits.
   */
  function renderMethodology(p, points) {
    clear(methodHost);
    const m = p.matrix;
    const t = p.toggles || {};
    const details = el("details", { class: "prog-method" });
    details.append(el("summary", {}, "How these numbers are calculated"));

    const dl = el("dl", { class: "prog-method-list" });
    const item = (term, ...body) => {
      dl.append(el("dt", {}, term));
      dl.append(el("dd", {}, ...body));
    };

    item("Coverage",
      el("code", {}, "TP / (TP + FN)"),
      " = " + m.tp.toLocaleString() + " / " + (m.tp + m.fn).toLocaleString() +
      " = " + pct(m.coverage.point) + ". Of the findings the rule calls high risk, the " +
      "share already remediated.");
    item("Efficiency",
      el("code", {}, "TP / (TP + FP)"),
      " = " + m.tp.toLocaleString() + " / " + (m.tp + m.fp).toLocaleString() +
      " = " + pct(m.efficiency.point) + ". Of everything remediated, the share that was " +
      "high risk.");
    item("Random baseline",
      pct(m.prevalence) + " of classified findings are high risk, so a program choosing " +
      "findings at random would score about that efficiency. Anything at or below it is " +
      "not prioritizing.");
    item("The high-risk rule",
      p.ruleSentence + ". Editable in Settings; changing it re-derives every figure on this " +
      "page, including the historical series, because only the raw signals are stored — the " +
      "verdict is computed at read time.");
    item("What counts as remediated",
      "A finding whose status is resolved, remediated, fixed or closed — including one that " +
      "simply stopped appearing in scans, which is dated to the scan that noticed. That is a " +
      "slightly generous reading of 'remediated', and it is the same one MTTR uses.");
    item("Unclassified findings",
      m.unknown.toLocaleString() + " of " + m.total.toLocaleString() + " (" +
      pct0(100 - (m.signalCoveragePct ?? 0)) + ") carry no captured exploit signal. They are " +
      "excluded from both rates rather than assumed harmless — assuming harmless would " +
      "inflate efficiency and deflate coverage simultaneously. The bracketed range beside " +
      "each rate is what it would become if all of them turned out one way or the other.");
    item("Sticky signals",
      "Exploit signals accumulate and never reverse: once a finding has been seen on the KEV " +
      "catalog or with a public exploit, it stays high risk, and its EPSS is the peak ever " +
      "observed. This keeps the trend from rewriting its own history, and it errs toward " +
      "counting more work as high risk rather than less.");
    item("Filters in force",
      (t.showNoFix === false
        ? "Findings with no vendor fix available are EXCLUDED, so they are absent from both " +
          "denominators. "
        : "Findings with no vendor fix available are included. ") +
      (t.includeEol === false
        ? "End-of-life OS findings are EXCLUDED."
        : "End-of-life OS findings are included.") +
      " Both are global settings and both move these denominators.");
    if (points.length) {
      const recon = points.filter((x) => x.reconstructed).length;
      item("History",
        points.length.toLocaleString() + " point(s)" +
        (recon
          ? ", of which " + recon.toLocaleString() + " precede the first saved scan and are " +
            "reconstructed from first-detection dates. Closures in that region are " +
            "under-counted, so early coverage reads low."
          : ", all from saved scans."));
    }
    item("Checking this yourself",
      "Export the classified rows and count them. The CSV carries each finding's raw signals, " +
      "the verdict derived from them, and the matrix cell it landed in, so " +
      "'high risk AND remediated' in a spreadsheet should equal the " + m.tp.toLocaleString() +
      " shown above.");

    details.append(dl);
    details.append(el("div", { style: "margin-top:12px" },
      el("button", { class: "linklike", onclick: () => exportCsv("") },
        "Download classified rows (CSV)")));
    methodHost.append(details);
  }
}
