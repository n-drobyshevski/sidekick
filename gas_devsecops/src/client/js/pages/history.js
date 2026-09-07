// Scan History — the durable ledger's own log: what was actually measured, when, and how the
// register moved between measurements.
//
// VOCABULARY: a sync is the act; a scan is the record it wrote. The rule is written once, in
// README.md above the Pages table, and `test/vocabulary.test.js` holds this package to it.
//
// THREE ROWS PER SYNC, ONE PER SCOPE. One job walks all three registers (sca, sast, secrets)
// and each gets its own `scans` row, sharing the sync's id (`scan_id`) with `scope` as the
// other half of the key (readModels.ts's `buildHistory`, `api.ts`'s module header). So the
// table below is deliberately flat, one row per (scan_id, scope) pair, rather than one row
// per sync with the scope folded away — folding it away is exactly what would make a
// partial three-scope sweep look identical to a full one.
//
// A NULL `severities` READS AS "ALL", NEVER AS "NONE" — this is the one thing on this page
// that inverts if it is read backwards. `secrets` is collected with the severity gate
// OFF (`DEFAULT_FETCH_SEVERITIES.secrets = []`), and ledgerCore.ts's `serializeSeverities`
// turns that empty selection into a stored `severities: null` — "unscoped", not "nothing
// requested". `sca`/`sast` normally carry a real list (`'["CRITICAL","HIGH"]'`). A reader
// told only WHEN a scan was saved cannot tell a partial sweep from a full one; `severitiesLabel`
// below is the one function that has to get the null case right.
//
// THE KM-MEDIAN TREND ALREADY RESPECTS `kmSkipMask` — SERVER-SIDE. `historyModel`'s trend
// comes from `ledgerStore.loadTrend`, which runs `trend.withKmMedian(..., {maxReconstructed:
// KM_TREND_MAX_RECONSTRUCTED})`; a point that mask skips arrives here with
// `km_median_days: null` already. So this page's job is exactly gas/'s: filter the nulls out
// of the KM line and let the real + sampled points draw a continuous curve. Importing
// `domain/trend.ts`'s `kmSkipMask` itself would pull a server/domain module into the client
// bundle for a mask this payload has already applied.
//
// THE OPEN-PAST-SLA TREND IS NOT IN THIS PAYLOAD. `historyTrendSlice` (domain/pagePayload.ts)
// narrows `getScanHistory`'s trend to `["date", "reconstructed", "open", "resolved",
// "km_median_days"]` — `open_past_sla` is on `MTTR_TREND_KEYS` (the MTTR page's slice) only.
// So this page draws the two series it was actually sent and says, in words, where the third
// one lives, rather than drawing an empty axis under a promise nothing here can keep.

// `fmtCount` WAS MISSING FROM THIS IMPORT LIST and the whole page threw on every render.
// The figure-module consolidation moved `num`/`fmtCount`/`days1`/`denomNote` out of this file
// into `ui/figures.js` (see the note below) and re-imported three of the four; `fmtCount` is
// called four times in `renderKpis` and `renderPerScope` and was never brought back, so
// `renderKpis` raised `ReferenceError: fmtCount is not defined` before drawing a single card
// and the page rendered its fetch-failure box instead — seeded and empty alike. Nothing
// caught it because the catch printed "Couldn't load scan history." in a calm `role="status"`
// box that looks like an empty register, which is the exact confusion the first-run package
// was opened to end. Swapping that box for `errorState` is what made it visible.
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
// The SVG element builder, straight from the shared icons module: `el()` is
// `document.createElement`, which produces an HTML <svg> in the wrong namespace — it parses,
// it appends, and it renders nothing at all. `svgEl` is `createElementNS`, and it is what
// `ui/brandMark.js` and `ui/uiIcons.js` already draw with. It is not on the ui barrel (nothing
// but those two needed it), so this page reaches the shared module by path, the same way it
// already reaches `store.js`.
import { svgEl } from "../../../../../gas_shared/icons.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { showExperimental, subscribeExperimental } from "../experimental.js";
import {
  DEFAULT_PAGE_SIZE, absentText, chartTable, chartTableModel, clear, dataTable,
  denomNote, el, emptyState, errorState, firstRunNotice, fmtCount, fmtDate, fmtDateTime,
  fmtDays, glossaryTip, kpiCard, num,
  onPageTeardown, pageHeader, pageOf, pluralize, sectionLabel, skeletonStack,
  sortRows, sparkLabel, sparkPath, sparkline, statusPill, tableFooter, tipLabel,
} from "../ui.js";
import { SCOPE_LABELS_LONG as SCOPE_LABELS } from "./_scopeLabels.js";
import { movementBarsModel, movementBlocks } from "./historyModel.js";
// The chart-card shell with its eager data-table alternative and its "chart unavailable"
// fallback, reached ACROSS a page module the way `program.js` already reaches for it. It is
// declared in sca.js because that is where it was first needed; a fourth copy here would be
// the fourth place `loadCharts().catch(chartUnavailable)` has to stay right.
import { chartCard } from "./sca.js";
import { spiralLayout } from "./spiralLayout.js";

// ---------------------------------------------------------------------------- formatting
//
// `num`, `fmtCount`, `days1` and `denomNote` used to be DEFINED here — this file had the
// corrected refuse-before-cast shape from the start, which is why `ui/figures.js` (the one
// shared implementation every page in this package now imports) is a copy of THIS file's
// shape and not `sca.js`'s. See that module's header for the defect it replaces.

/**
 * A scan row's severity coverage, in words. `null` means the scan looked at EVERY severity
 * (the gate was off, or nothing narrowed it); an array names exactly what it looked at. Never
 * collapse the two — see the module header.
 */
export function severitiesLabel(raw) {
  if (raw === null || raw === undefined || raw === "") return "All severities";
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "All severities";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed.join(", ");
  } catch (e) {
    /* not JSON — fall through to the honest default below */
  }
  return "All severities";
}

// ------------------------------------------------------------------------- pure view models

/** Whether a scan row is unscoped by severity — the exact predicate `severitiesLabel` uses. */
export function isAllSeverities(raw) {
  if (raw === null || raw === undefined || raw === "") return true;
  const arr = Array.isArray(raw) ? raw : (() => {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  })();
  return !Array.isArray(arr) || arr.length === 0;
}

/**
 * The scan log's rows, one per (scan_id, scope) — exactly the payload's shape, sorted newest
 * first. `groupBySync` below is what proves three rows share one sync; this stays flat
 * because that IS the table.
 */
export function scanRowsView(scans) {
  return (Array.isArray(scans) ? scans : []).map((s) => ({
    scanId: s.scan_id,
    ts: s.ts,
    scope: s.scope,
    scopeLabel: SCOPE_LABELS[s.scope] || String(s.scope || absentText),
    mode: s.mode,
    total: num(s.total, 0),
    newCount: num(s.new_count, 0),
    resolvedCount: num(s.resolved_count, 0),
    reopenedCount: num(s.reopened_count, 0),
    sealed: s.sealed === 1 || s.sealed === true,
    severitiesRaw: s.severities ?? null,
    severitiesText: severitiesLabel(s.severities),
    allSeverities: isAllSeverities(s.severities),
  }));
}

/**
 * Scan rows grouped by `scan_id` — the sync. On a healthy register every group has exactly
 * three members (sca, sast, secrets); a group with fewer is a partial sweep, and `scopes`
 * says which registers it actually covered.
 */
export function groupBySync(scans) {
  const bySync = new Map();
  for (const s of Array.isArray(scans) ? scans : []) {
    const key = s.scan_id;
    const list = bySync.get(key);
    if (list) list.push(s);
    else bySync.set(key, [s]);
  }
  return [...bySync.entries()].map(([scanId, rows]) => ({
    scanId,
    rows,
    scopes: rows.map((r) => r.scope).sort(),
    ts: rows.reduce((max, r) => (max && max > r.ts ? max : r.ts), null),
  }));
}

/** The headline KPIs: tracked / open / resolved, plus the derived resolved SHARE with its
 *  own denominator — the one rate this page's KPI band can honestly publish. */
export function kpiView(kpis) {
  const k = kpis || {};
  const tracked = num(k.tracked, 0);
  const resolved = num(k.resolvedAllTime, 0);
  return {
    tracked,
    open: num(k.open, 0),
    resolvedAllTime: resolved,
    medianMttr: k.medianMttr === null || k.medianMttr === undefined ? null : num(k.medianMttr),
    resolvedSharePct: tracked > 0 ? (resolved / tracked) * 100 : null,
  };
}

/**
 * THE THREE KPI SERIES, AS SLOTS — one entry per trend point, a non-number left as a GAP.
 *
 * WHY THE CARDS GET A LINE AT ALL. Three of the four figures in the band say where a number
 * IS and none of them said where it is GOING, while the series they are the last point of sat
 * at the foot of the same page in a Chart.js line. "416 open" over a count that has been
 * falling for four scans is a different reading from the same 416 over one that has doubled.
 *
 * `tracked` IS `open + resolved`, AND THAT IS THE PAYLOAD'S OWN ARITHMETIC, not a second
 * derivation of it. `domain/trend.ts` builds each point's `open` as "first seen by this date
 * and not resolved by it" and `resolved` as "resolved by this date", so their sum is exactly
 * the rows first seen by that date — the definition of `kpis.tracked`, and it lands on it: on
 * the dev seed the last point reads 416 + 138 and the card above reads 554.
 *
 * REFUSED BY TYPE, BEFORE ANY CAST, and the sum inherits the refusal: if EITHER half of a
 * point is missing, the tracked slot is a gap rather than a half-total. `openResolvedPoints`
 * above deliberately does the opposite (`num(p.open, 0)`) because the Chart.js line it feeds
 * has always plotted a zero there; changing that is a behaviour change to a shipped chart and
 * is not this function's business. A gap here KEEPS ITS X POSITION and breaks the line —
 * `ui/sparkline.js`'s whole contract, and the reason `Number(null)` is refused rather than
 * filtered: dropping the slot would compress time and get the slope wrong.
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
  };
}

/**
 * What a sparkline's caption says, in the register's own words — pure, so the wording is
 * testable without a DOM.
 *
 * THE GAPS ARE IN THE CAPTION, NOT ONLY IN THE aria-label. A caption reading "3 readings" over
 * a 120px box lets a reader take the empty 97% for a flat line rather than for dates nobody
 * could measure; `sparkPath` counts the gaps and this prints them. Same decision, same
 * wording, as `mttr.js`'s header aside.
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

/** The KM-median line, nulls filtered — the client half of "kmSkipMask respected" (see the
 *  module header: the skip is already baked into `km_median_days: null` server-side). */
export function kmMedianPoints(trend) {
  return (Array.isArray(trend) ? trend : [])
    .filter((p) => p.km_median_days !== null && p.km_median_days !== undefined)
    .map((p) => ({ x: p.date, y: num(p.km_median_days), reconstructed: !!p.reconstructed }));
}

/** The open/resolved dual line, as `openResolvedLines` reads it — verbatim, reconstructed
 *  flag included. */
export function openResolvedPoints(trend) {
  return (Array.isArray(trend) ? trend : []).map((p) => ({
    date: p.date,
    open: num(p.open, 0),
    resolved: num(p.resolved, 0),
    reconstructed: !!p.reconstructed,
  }));
}

/**
 * Whether the scan-side tables owe the reader a register-wide note. `scans` and `perScope` are
 * per-scan/per-day facts with no project dimension (`readModels.ts::buildHistory`'s own
 * comment) — they never narrow to the view-project scope even though `kpis` and `trends`
 * beside them do. The server sets `scanScopeNote` to a non-null string exactly when a project
 * view is set (and to `null` otherwise), so its own presence — not a second client-side scope
 * check — is the gate.
 */
export function scanScopeNoteShown(payload) {
  return !!(payload && payload.scanScopeNote);
}

/** One scope's row for the "what was measured" strip. */
export function perScopeView(perScope) {
  const out = [];
  for (const scope of ["sca", "sast", "secrets"]) {
    const s = (perScope && perScope[scope]) || {};
    out.push({
      scope,
      label: SCOPE_LABELS[scope] || scope,
      scans: num(s.scans, 0),
      sealed: num(s.sealed, 0),
      firstScanTs: s.firstScanTs ?? null,
      lastScanTs: s.lastScanTs ?? null,
      lastTotal: s.lastTotal === null || s.lastTotal === undefined ? null : num(s.lastTotal),
    });
  }
  return out;
}

// ------------------------------------------------------------------- the time spiral (SVG)
//
// EXPERIMENTAL, AND OFF LEAVES NO TRACE. The whole section — heading, lede, drawing and its
// table — exists only while Settings -> Show experimental content is on. An unfinished shape
// that leaves a heading behind with nothing under it is worse than one that is simply not
// there: the reader is told a figure exists and denied it.
//
// GEOMETRY IS IN `spiralLayout.js`, which is DOM-free and tested; everything here is
// drawing. The split is the same one `chartTableModel` / `chartTable` already use, and for the
// same reason — this project's vitest run has no jsdom.
//
// SHAPE, NOT COLOUR, CARRIES THE REGISTER. Every mark is drawn in one ink (`--accent-text`,
// 7.39:1 — never `--accent`, which is a 1.52:1 FILL token); which register a scan belongs to
// is in the shape of the mark and repeated in words in the legend and in the table below, so
// nothing on this chart means anything by colour alone. No animation: there is nothing here
// that a movement would explain.

const SPIRAL_R0 = 24;
const SPIRAL_DR = 14;
/** Room outside the last ring for its own quarter label. */
const SPIRAL_PAD = 18;

/** One mark per register, and its glyph twin for the legend. */
const SPIRAL_SHAPES = { sca: "circle", sast: "square", secrets: "diamond" };
const SPIRAL_GLYPHS = { circle: "●", square: "■", diamond: "◆" };

/** Two decimals is a tenth of a pixel at the size this draws — enough for the geometry and
 *  small enough that a diff of the DOM is readable. */
function r2(n) {
  return Math.round(n * 100) / 100;
}

/** One scan, as its register's mark. */
function spiralMark(p) {
  const shape = SPIRAL_SHAPES[p.scope] || "circle";
  const style = "fill: var(--accent-text)";
  if (shape === "circle") return svgEl("circle", { cx: r2(p.x), cy: r2(p.y), r: 2.4, style });
  // A diamond is the square, turned — one code path, so the two can never drift in size.
  const half = shape === "diamond" ? 2.8 : 2.2;
  return svgEl("rect", {
    x: r2(p.x - half), y: r2(p.y - half), width: r2(half * 2), height: r2(half * 2), style,
    transform: shape === "diamond" ? `rotate(45 ${r2(p.x)} ${r2(p.y)})` : null,
  });
}

/**
 * The drawing: one thin ring per quarter with its key at 12 o'clock, the scans in time order
 * joined by a polyline, and a mark per scan.
 *
 * The `aria-label` says what the picture IS and how much of it there is; what it SAYS is in
 * the table `chartTable` hangs off it (`aria-details`), which is the same arrangement every
 * canvas on this page already has.
 */
function spiralSvg(layout) {
  const outer = SPIRAL_R0 + SPIRAL_DR * layout.turns + SPIRAL_PAD;
  const n = layout.points.length;
  const svg = svgEl("svg", {
    class: "spiral",
    viewBox: `${r2(-outer)} ${r2(-outer)} ${r2(outer * 2)} ${r2(outer * 2)}`,
    role: "img",
    focusable: "false",
    "aria-label": `Open findings per scan on a quarterly spiral; ${n} ${pluralize(n, "scan")}, `
      + `${layout.turns} ${pluralize(layout.turns, "quarter")}`,
  });
  for (const q of layout.quarters) {
    svg.append(svgEl("circle", {
      cx: 0, cy: 0, r: r2(q.r), fill: "none",
      style: "stroke: currentColor", "stroke-width": 0.5, "stroke-opacity": 0.22,
    }));
    const label = svgEl("text", {
      x: 0, y: r2(-q.r - 2.5), "text-anchor": "middle", "font-size": 6.5,
      style: "fill: currentColor", "fill-opacity": 0.55,
    });
    label.textContent = q.key;
    svg.append(label);
  }
  svg.append(svgEl("polyline", {
    fill: "none", style: "stroke: var(--accent-text)", "stroke-width": 1,
    "stroke-linejoin": "round", "stroke-opacity": 0.75,
    points: layout.points.map((p) => `${r2(p.x)},${r2(p.y)}`).join(" "),
  }));
  for (const p of layout.points) svg.append(spiralMark(p));
  return svg;
}

// ------------------------------------------------ what moved the number: the shared columns
//
// MODULE SCOPE, AND THAT IS A FIX RATHER THAN TIDYING. This array used to be a `const` inside
// `renderHistory`, declared BELOW the `try { paint(await promise) }` that eventually reads it
// — and a `const` is not hoisted-initialized, so the first paint reached it while it was still
// in its temporal dead zone. Every path into it ran through `movementBlock`, which returns
// early when the register has no decomposition, which is the ONLY state the dev seed can
// reach (its saved scans span 14 days and the window is 28), so nothing here ever saw it. On
// a tenant where one register really has a movement, `#/history` threw `ReferenceError:
// Cannot access 'CAUSE_COLUMNS' before initialization` out of `paint`, the catch around the
// fetch swallowed it, and the WHOLE PAGE rendered "Couldn't load scan history." — a fetch
// failure reported for a rendering bug. Measured by shortening the window to 7 days in a
// throwaway edit to `readModels.ts` and loading the page; `test/historyMovement.test.js`
// holds the structure rather than the instance (no `const` inside `renderHistory` after the
// await), because the next one of these will have a different name.

// ---- what moved the number (see pages/historyModel.js for the reading, and
// domain/movementDecomposition.ts for the arithmetic).
//
// ONE CHART PER REGISTER, WHERE THERE WERE A SENTENCE AND TWO TABLES. What was here, three
// times over: a 32-word sentence naming six figures, then two three-column tables of ONE
// ROW EACH — one headed "Measured remediation", one "Administrative" — and a bulleted aside
// of up to five more labels. Eighteen table cells to carry two numbers, and the question
// the section asks ("which way did the count go, and how much of that move did anybody
// observe?") is a shape none of them draws. Four bars about a zero line is that shape:
// arrivals and returns to the right, closures and disappearances to the left, the net
// direct-labelled on the rule itself.
//
// THE SPLIT THE TWO TABLES EXISTED TO PROTECT IS STILL PROTECTED, and not by colour. The
// two halves are two of the four y-axis labels — "Closed by observation" is the measured
// one and "Dated gone by absence" the administrative one — the card's own line above the
// canvas prints both subtotals in words, and nothing here stacks or totals them. On this
// register the administrative half is the majority case by construction for two of the
// three scopes (SAST has no resolved state to fetch and secrets has none either), so
// keeping the halves apart is not a corner case.
//
// ONE ARRAY, TWO READINGS: `bars.rows` goes to the wrapper and to `chartTableModel` in the
// same statement (`ui/chartTable.js`'s one rule), and every column the two tables published
// is still in it — plus the signed effect, which is what the picture adds.
const CAUSE_COLUMNS = [
  { key: "cause", label: "Cause", format: "text", align: "text" },
  { key: "half", label: "Which half", format: "text", align: "text" },
  {
    key: "value",
    label: "Effect on the open count",
    format: "text",
    value: (r) => (r.value > 0 ? "+" : "") + fmtCount(r.value),
  },
  { key: "count", label: "Findings", format: "count" },
  { key: "basis", label: "How it was counted", format: "text", align: "text" },
];

// ----------------------------------------------------------------------------- the page

export async function renderHistory(host, _params, _ctx) {
  const boot = await bootstrap();
  host.append(pageHeader({
    route: "history",
    lede: "What was actually measured and when, and how the register moved between "
      + "measurements.",
  }));

  // A DIV, not a <p>: on the first run this slot holds the shared first-run notice, which is
  // a block with its own children, and a <p> cannot legally contain one.
  const observedHost = el("div", { class: "small muted" });
  const kpiHost = el("div", { class: "kpi-row" });
  const perScopeHost = el("div", {});
  // HELD, NOT REBUILT: the two scan-side headings each carry a state the payload decides —
  // "Register-wide" on both, and the saved-scan denominator on the second — so the render
  // functions reach for the heading rather than for a paragraph under their table. Coverage's
  // heading is stable text and is built once; Saved scans' tip has COUNTS in it, so that one
  // lives in a host and is rebuilt per paint.
  const perScopeLabel = sectionLabel("Coverage by register", { term: "rail-status" });
  const scansLabelHost = el("div", {});
  const tableHost = el("div", {});
  const movementHost = el("div", {});
  // EMPTY UNLESS THE EXPERIMENT IS ON. The heading and the lede are built inside
  // `renderSpiral`, not here, so that an off toggle leaves nothing behind at all — a host div
  // with no children renders as nothing.
  const spiralHost = el("div", {});
  const chartsHost = el("div", { class: "chart-row" });
  // ONE WRAPPER FOR EVERY SECTION BELOW THE KPI ROW, so a first run can clear four headings
  // and their content together in one call rather than leaving them standing over an empty
  // box — the same "label lives with its box" shape mttr.js/executive.js's own `paint` use,
  // adapted here because these headings are static text appended once rather than something a
  // renderX function draws itself. `ensureSections()` (re)populates it the first time a paint
  // call is NOT a first run; `paint`'s own first-run branch clears it, which detaches
  // `perScopeHost`/`tableHost`/`movementHost`/`spiralHost`/`chartsHost` from the DOM (their
  // own children survive the detach, but `ensureSections()` re-attaches them before the next
  // non-first paint repopulates those children).
  const sectionsHost = el("div", {});

  function ensureSections() {
    if (sectionsHost.childNodes.length) return;
    sectionsHost.append(
      // The table the rail's one status dot is a summary of: a "Last scan" of "—" here is the
      // never-measured state that outranks every stale one on the dot. `rail-status` is where
      // that precedence is written down.
      perScopeLabel,
      perScopeHost,
      scansLabelHost,
      tableHost,
      // DISCLOSE. The 65-word note under this heading said three things: what the window is,
      // what the section splits it into, and that the window is PER REGISTER. All three are
      // definitions of the section rather than qualifiers on any figure in it, which is the
      // one kind of prose a tip is for — and the trigger routes on to the book's `movement`
      // entry, so the general reading is one keystroke further down and never a third level.
      sectionLabel("What moved the number", {
        term: "movement",
        lines: [
          "The change in each register's open count over the last 28-day window bounded by two"
          + " of its own saved scans, split into the causes that moved it — and which of them"
          + " are remediation the register actually observed.",
          "The window is per register: three registers share one scan log, and a scan of one of"
          + " them looked at none of the others.",
        ],
      }),
      movementHost,
      spiralHost,
      sectionLabel("Trends"),
      chartsHost,
    );
  }

  host.append(observedHost, kpiHost, sectionsHost);

  kpiHost.append(skeletonStack(4, { variant: "stat" }));

  let sortSpec = { key: "ts", descending: true, value: (r) => Date.parse(r.ts) || 0 };
  let page = 0;
  let pageSize = DEFAULT_PAGE_SIZE;

  let paint = null;
  const promise = swrCall("api_getScanHistory", {}, (fresh) => paint && paint(fresh));

  // What the spiral was last drawn from. Held because the experimental toggle can flip while
  // this page is on screen and the redraw has no payload of its own to reach for; `first` is
  // held beside it so a flip cannot re-open the first-run gate on the wrong answer.
  let lastPayload = null;
  let lastFirst = true;

  paint = (payload) => {
    // `observedFrom` is the page's own honest signal and it is already what `renderObserved`
    // gates on: it is the first saved scan's date, so a null there means nothing has ever
    // been measured and every figure below is a count over a window that does not exist.
    const first = !(payload && payload.observedFrom);
    lastPayload = payload;
    lastFirst = first;
    renderObserved(payload);
    // FIRST RUN STOPS HERE — one notice above (`renderObserved`), not five below it: a KPI
    // row of zeros, "No register has a saved scan yet.", "No scans saved yet.", "Nothing has
    // moved yet…" and a heading over an empty trends chart used to print separately, each in
    // its own words, for the one fact `renderObserved`'s notice already states. Clearing
    // `sectionsHost` detaches its headings AND the five content hosts nested inside it in one
    // call; `ensureSections()` re-attaches them the next time this runs non-first.
    if (first) {
      [kpiHost, perScopeHost, scansLabelHost, tableHost, movementHost, spiralHost, chartsHost,
        sectionsHost].forEach(clear);
      return;
    }
    ensureSections();
    // ONE ARRAY, TWO PICTURES. The KPI band's sparklines and the two Chart.js lines at the
    // foot of the page are readings of the SAME series, so it is read off the payload once,
    // here, and handed to both — `ui/chartTable.js`'s rule applied to a pair of pictures
    // rather than to a picture and its table. Deriving it twice is how a card and a chart
    // that are supposed to end on the same number start disagreeing.
    const trend = (payload && payload.trends && payload.trends.trend) || [];
    renderKpis(payload, trend);
    renderPerScope(payload);
    renderTable(payload);
    renderMovement(payload);
    renderSpiral(payload, first);
    renderTrends(payload, trend);
  };

  // THE GATE HAS ONE LISTENER SLOT AND IT IS THE SHELL'S (gas_shared/shell/experimental.js
  // holds a single `listener`, claimed by createAppShell for the rail rebuild). Calling
  // `onExperimentalChange` from here would TAKE it, and the rail would stop redrawing on a
  // flip for the rest of the session with nothing on screen to say so. `experimental.js`'s
  // fan-out is this app's answer: app.js claims the slot once with the shell's rebuild as the
  // base, page subscriptions ride alongside it, and unsubscribing restores exactly what was
  // there — the base listener is never touched. The teardown is not optional: a subscriber
  // left behind would redraw into a DOM the router has already discarded.
  onPageTeardown(subscribeExperimental(() => renderSpiral(lastPayload, lastFirst)));

  try {
    paint(await promise);
  } catch (e) {
    console.error("[history] api_getScanHistory failed:", e);
    // A failure, not an absence — this page's whole subject is what HAS been measured, so
    // announcing a fetch failure in the same voice as "nothing measured yet" was the worst
    // place in the register to confuse the two.
    clear(kpiHost).append(errorState(
      "Couldn't load scan history.",
      { detail: String((e && e.message) || e) },
    ));
  }

  function renderObserved(payload) {
    const from = payload && payload.observedFrom;
    clear(observedHost);
    if (from) {
      observedHost.append(el("p", { class: "small muted" },
        `Watching since ${fmtDate(from)} — the first saved scan dates the observation window.`));
      return;
    }
    // The SAME notice every other page carries, rather than this page's own wording for the
    // same state. A reader moving between pages should meet one sentence, not four.
    observedHost.append(firstRunNotice({
      synced: !!boot.latestSync,
      at: boot.latestSync ? boot.latestSync.ts : null,
      hint: "Nothing dates when watching began, so there is no observation window for the"
        + " figures below to sit inside. Run a sync with the Run sync button in the rail.",
    }));
  }

  /**
   * A card, and the series it is the last reading of.
   *
   * BORDERLESS AND BELOW THE SUB, so the line qualifies the figure rather than competing with
   * it — `.kpi-spark`, pages.css. `sparkline` is inline SVG with `role="img"` and an
   * `aria-label` that always states first / last / low / high / how many readings, so the
   * picture has its own text alternative and the caption is not carrying that job alone.
   *
   * FEWER THAN TWO MEASURED READINGS DRAWS THE WORDS, NEVER AN EMPTY BOX. `sparkPath` returns
   * `d: ""` for one reading and for none — one point is not a trend, and a line through it
   * would claim a direction nothing measured — so the caption is printed on its own and the
   * card says "Not measured" where that is what happened.
   */
  function sparkCard(card, values, name) {
    const model = sparkPath(values, { w: 120, h: 28 });
    const strip = el("div", { class: "kpi-spark" });
    if (model.n >= 2) {
      strip.append(sparkline(values, { label: name, w: 120, h: 28 }));
    }
    strip.append(el("span", { class: "kpi-spark__cap" }, sparkCaption(model)));
    card.append(strip);
    return card;
  }

  function renderKpis(payload, trend) {
    const v = kpiView(payload && payload.kpis);
    const series = kpiSparkSeries(trend);
    clear(kpiHost);
    kpiHost.append(
      sparkCard(kpiCard("Tracked (all-time)", fmtCount(v.tracked)),
        series.tracked, "Findings tracked over time"),
      sparkCard(kpiCard("Currently open", fmtCount(v.open)),
        series.open, "Open findings over time"),
      sparkCard((() => {
        const card = kpiCard("Resolved (all-time)", fmtCount(v.resolvedAllTime));
        card.append(denomNote(
          v.resolvedSharePct === null
            ? "No findings tracked yet."
            : `${v.resolvedSharePct.toFixed(1)}% of ${fmtCount(v.tracked)} tracked.`,
        ));
        return card;
      })(), series.resolved, "Findings resolved over time"),
      // NO SPARKLINE ON THIS ONE, AND THE REASON IS A DEFECT RATHER THAN A GAP IN THE PAYLOAD.
      // The obvious series to draw here is `km_median_days`, which this page already plots at
      // its foot — but that is the KAPLAN-MEIER median, and this card's value is
      // `kpis.medianMttr`, which is `overall.mttr_median`: the plain median over resolved rows
      // only. On the dev seed the card reads 93 days while the last measured KM point reads
      // 198.5, because the KM estimate keeps the 416 still-open findings as censored
      // observations and the plain median drops them. A line under the figure is read as
      // "where this number is going", so drawing one statistic under another would make an
      // existing inconsistency louder rather than saying anything true. Recorded here, not
      // fixed: which of the two this card should publish is a server-side decision.
      //
      // KPI TILE, NOT A TABLE CELL — `fmtDays` is the prose/KPI-tile duration format
      // ("93 days"), `days1` the table-cell one ("92.8 d"); this card had the two crossed.
      kpiCard(glossaryTip("Median MTTR", "half-life"), fmtDays(v.medianMttr)),
    );
  }

  /**
   * "Register-wide", ON THE TABLE'S OWN HEADING — the state as a pill, the sentence behind it.
   *
   * WHAT IT REPLACES: two paragraphs, 21 words and 34, one under each scan-side table, saying
   * the same thing in two sets of words. The FACT is a qualifier on every figure in the table
   * below — a task constraint, not a definition — so it stays on the surface; what moves is
   * the sentence explaining it, which is exactly what a pill with a tip is for. The pill is
   * rebuilt on every paint rather than toggled, because `scanScopeNoteShown` is a fact about
   * the payload in hand: a reader who clears the project view must not be left with a pill
   * from the previous one.
   *
   * IT TAKES THE DECISION, NOT THE PAYLOAD. The gate is the SERVER's own `scanScopeNote` (see
   * `scanScopeNoteShown`'s doc comment for why the note's presence is the signal), and it is
   * read in the render function that owns the table — a DOM builder that re-derived it would
   * be a second place the gate lives, and the two tables' wording would drift apart from it.
   * `lines` null is the same decision said once: no lines, no pill.
   */
  function registerWidePill(heading, lines) {
    const existing = heading.querySelector(".heading-pill");
    if (existing) existing.remove();
    if (!lines) return;
    heading.append(el("span", { class: "heading-pill" },
      statusPill("neutral", "Register-wide", { lines })));
  }

  function renderPerScope(payload) {
    const rows = perScopeView(payload && payload.perScope);
    clear(perScopeHost);
    perScopeHost.append(dataTable({
      columns: [
        { key: "label", label: "Register", cell: (r) => r.label },
        { key: "scans", label: "Scans", className: "num", cell: (r) => fmtCount(r.scans) },
        { key: "sealed", label: "Sealed", className: "num", cell: (r) => fmtCount(r.sealed) },
        { key: "first", label: "First scan", cell: (r) => (r.firstScanTs ? fmtDateTime(r.firstScanTs) : absentText) },
        { key: "last", label: "Last scan", cell: (r) => (r.lastScanTs ? fmtDateTime(r.lastScanTs) : absentText) },
        { key: "total", label: "Last total", className: "num", cell: (r) => fmtCount(r.lastTotal) },
      ],
      rows,
      emptyText: "No scans saved yet.",
    }));
    // `perScope` (`loadScanRows()` counted per register) carries no project dimension — see
    // scanScopeNoteShown's doc comment. Worded for THIS table specifically, not a copy of the
    // KPI band's own scope.
    registerWidePill(perScopeLabel, scanScopeNoteShown(payload) ? [
      "Scan counts across every register, not narrowed to the selected project — a sync"
      + " carries no project dimension to narrow by.",
    ] : null);
  }

  /**
   * The saved-scan heading, and the denominator ONE LEVEL DOWN.
   *
   * WHAT WAS HERE: a 20-word `denomNote` paragraph under the pager. R3's contract splits it —
   * the counts stay visible under the table as a short line ("9 scan rows across 1 sync"),
   * because a table without its own row count is a table a reader cannot check; the SENTENCE
   * saying why there are three rows per sync moves to this heading's tip and is written to
   * `data-denominator` on the heading node, so a test can read what a reader reads. Same
   * mechanism `sca.js`'s `sectionCard`/`chartCard` use, spelled out here because this page
   * builds its own headings.
   *
   * NO DENOMINATOR ON AN EMPTY REGISTER. "0 scan rows across 0 syncs" is a sentence about a
   * population nobody has saved; the empty state under it already says so in one line.
   */
  function scansHeading(rowCount, syncCount, wideLines) {
    const denominator = rowCount
      ? `${fmtCount(rowCount)} scan ${pluralize(rowCount, "row")} across `
        + `${fmtCount(syncCount)} ${pluralize(syncCount, "sync")} — three rows per sync, one `
        + "per register, unless a sweep was partial."
      : null;
    // THE TERM IS WHAT MAKES THE TRIGGER VISIBLE. `.tip-trigger--term` (components.css) is
    // the dotted underline, and it is added only where a trigger routes to the book — so a
    // `{lines}`-only tip on a heading is a hidden affordance, which is exactly what R1's "the
    // trigger is the signifier" forbids. `scan` is the right entry anyway: this heading names
    // the record a sync wrote, and that is the word the table's three-rows-per-sync ratio is
    // a fact about. The denominator still LEADS the card; the entry is where Enter goes.
    const heading = denominator
      ? sectionLabel("Saved scans", { term: "scan", lines: [denominator] })
      : sectionLabel("Saved scans", { term: "scan" });
    if (denominator) heading.setAttribute("data-denominator", denominator);
    registerWidePill(heading, wideLines);
    return heading;
  }

  function renderTable(payload) {
    const scans = scanRowsView(payload && payload.scans);
    const groups = groupBySync(scans);
    const partial = groups.filter((g) => g.scopes.length < 3);
    clear(tableHost);
    // THIS TABLE SPECIFICALLY, not the KPI band or the trend below it — `scans` is a per-scan
    // fact with no project dimension, so it never narrows with the view-project scope even
    // while a project is selected; the KPIs above and the trend below both do, and the second
    // line says so where the first could otherwise be read as covering the whole page.
    const wideLines = scanScopeNoteShown(payload) ? [
      "This table lists every scan ever saved, not narrowed to the selected project — a sync"
      + " carries no project dimension to narrow by.",
      "The KPIs above and the trend below ARE scoped to it.",
    ] : null;
    clear(scansLabelHost).append(scansHeading(scans.length, groups.length, wideLines));
    if (!scans.length) {
      tableHost.append(emptyState(
        "No scans saved yet.",
        "Every figure on this page is empty until one runs.",
      ));
      return;
    }
    const sorted = sortRows(scans, sortSpec);

    function draw() {
      const cut = pageOf(sorted, page, pageSize);
      page = cut.page;
      const table = dataTable({
        columns: [
          { key: "ts", label: "When", sortable: true, cell: (r) => fmtDateTime(r.ts) },
          { key: "scope", label: "Register", sortable: true, cell: (r) => r.scopeLabel },
          {
            key: "severities", label: "Severities covered", help: { term: "coverage" },
            cell: (r) => (r.allSeverities
              ? el("span", {}, "All severities", el("span", { class: "domain-chip" }, "gate off"))
              : r.severitiesText),
          },
          { key: "total", label: "Findings", className: "num", sortable: true, cell: (r) => fmtCount(r.total) },
          { key: "new", label: "+New", className: "num", cell: (r) => fmtCount(r.newCount) },
          { key: "resolved", label: "−Resolved", className: "num", cell: (r) => fmtCount(r.resolvedCount) },
          { key: "reopened", label: "Reopened", className: "num", cell: (r) => fmtCount(r.reopenedCount) },
          { key: "sealed", label: "Sealed", cell: (r) => (r.sealed ? "Sealed" : "") },
        ],
        rows: cut.rows,
        sort: sortSpec,
        onSort: (key) => {
          const value = key === "scope" ? (r) => r.scopeLabel
            : key === "ts" ? (r) => Date.parse(r.ts) || 0
            : key === "total" ? (r) => r.total
            : (r) => r[key];
          sortSpec = sortSpec.key === key
            ? { key, descending: !sortSpec.descending, value }
            : { key, descending: true, value };
          renderTable(payload);
        },
        emptyText: "No scans saved yet.",
      });
      const footer = tableFooter({
        page,
        pageCount: cut.pageCount,
        total: sorted.length,
        pageSize,
        onPage: (p) => { page = p; draw(); },
        onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; draw(); },
      });
      // THE COUNTS STAY VISIBLE, THE SENTENCE DOES NOT (R3). "9 scan rows across 1 sync" is
      // the arithmetic a reader checks the pager against; "three rows per sync, one per
      // register, unless a sweep was partial" is why that ratio is what it is, and it is on
      // the heading's tip and in its `data-denominator`. Never "row(s)" — pluralize is the
      // one place this register decides a plural.
      clear(tableHost).append(table, footer, el("p", { class: "small muted" },
        `${fmtCount(sorted.length)} scan ${pluralize(sorted.length, "row")} across `
        + `${fmtCount(groups.length)} ${pluralize(groups.length, "sync")}`));
      if (partial.length) {
        tableHost.append(el("p", { class: "small muted" },
          `${partial.length.toLocaleString()} sync(s) covered fewer than all three registers: `
          + partial.map((g) => `${fmtDate(g.ts)} (${g.scopes.join(", ")})`).join("; ") + "."));
      }
      // The register-wide qualifier is on this table's own HEADING now (`scansHeading`), as
      // a pill with the two sentences behind it — a paragraph under the pager and a second
      // one under the coverage table above said the same thing twice.
    }
    draw();
  }

  function movementBlock(block, movement) {
    const host = el("section", { class: "movement-block" });
    if (block.view.empty) {
      // The server's own words, verbatim: it is the only thing that knows WHY it declined for
      // THIS register, and a reason invented here would print in the same ink as a
      // measurement. The heading stays, so a reader is told which register is silent.
      host.append(
        el("h3", { class: "section-label" }, block.label),
        emptyState(
          block.view.empty,
          "The decomposition compares two of this register's own saved scans, at least 28 days"
          + " apart.",
        ),
      );
      return host;
    }
    // The two refuse on the SAME allowlist (`readFigures`), so this branch cannot be reached
    // with a view that is not empty — the guard is here because a null model would otherwise
    // reach the wrapper as an empty chart rather than as a refusal.
    const bars = movementBarsModel(movement);
    if (!bars) {
      host.append(
        el("h3", { class: "section-label" }, block.label),
        emptyState("No movement decomposition in this payload."),
      );
      return host;
    }
    const rows = bars.rows;
    host.append(chartCard(
      block.label,
      bars.headline,
      (api, canvas) => api.movementBars(canvas, rows, {
        // NOT A POSSESSIVE: two of the three register labels end in "s" ("Code (SAST)",
        // "Secrets"), and "Secrets's open count" is what a possessive built by concatenation
        // reads as in the text alternative.
        subject: `${block.label} — what moved the open count`,
        net: bars.net,
      }),
      {
        caption: "Every bar above as a row: the cause, which half of the movement it belongs"
          + " to, what it did to the open count, how many findings that was, and how the"
          + " count was arrived at.",
        model: chartTableModel({ columns: CAUSE_COLUMNS, rows }),
      },
    ));
    // KEPT ON THE SURFACE, BOTH OF THEM. These are the section's two honesty statements and
    // neither is a definition: the first publishes a disagreement between two independent
    // measurements of the same movement, the second names the population the last scan could
    // not have seen at all. A tip is where a reader goes to settle a word; a figure that is
    // wrong by a stated amount, and a count that was never measured, are what the reader came
    // for. `movementView` builds both, verbatim, and prints neither when it is zero.
    for (const sentence of block.view.sentences.slice(1)) {
      host.append(el("p", { class: "small muted" }, sentence));
    }
    // COMPRESSED, NOT DELETED. Up to five labelled counts that were a bulleted list under the
    // tables — every one of them a population the decomposition could not place. As pills they
    // read as the row of exceptions they are, and each still carries its own count.
    if (block.view.asideRows.length) {
      host.append(el("div", { class: "pill-row" }, ...block.view.asideRows.map((r) =>
        statusPill("neutral", `${r.label}: ${fmtCount(r.count)}`))));
    }
    return host;
  }

  function renderMovement(payload) {
    const movement = (payload && payload.movement) || {};
    clear(movementHost);
    for (const block of movementBlocks(payload, SCOPE_LABELS)) {
      movementHost.append(movementBlock(block, movement[block.scope]));
    }
  }

  // ---- the time spiral (experimental). Geometry: pages/spiralLayout.js.
  function renderSpiral(payload, first) {
    clear(spiralHost);
    // AN OFF EXPERIMENT LEAVES NO TRACE — not a heading, not a placeholder, not a note saying
    // something is hidden. This is also the redraw the toggle's own subscription runs, so
    // flipping it off empties the host rather than leaving the last drawing behind.
    if (!showExperimental()) return;
    // The page's first-run gate, the same one every section above uses: a spiral over a
    // register nobody has scanned is a picture of a population nobody has looked at. `paint`'s
    // own top-level gate already keeps this function from ever being CALLED with `first: true`
    // during the initial paint (`spiralHost` is not even attached to the page until
    // `ensureSections()` runs); this is the backstop for the toggle subscription below, which
    // can still fire while a first-run page is on screen.
    if (first) return;

    const layout = spiralLayout((payload && payload.scans) || [],
      { r0: SPIRAL_R0, dr: SPIRAL_DR });
    // THE WORD "EXPERIMENTAL" STAYS ON THE SURFACE; HOW TO READ THE SPIRAL DOES NOT. The
    // first is a qualifier on the picture — the reader is looking at something unfinished and
    // is entitled to know it without hovering — and it is a state, which is what a pill is
    // for. The other 21 words are how to read an unfamiliar geometry: a definition, and the
    // one kind of prose that belongs one level down.
    const spiralLabel = sectionLabel("Open count, one turn per quarter", {
      lines: [
        "Each turn is a calendar quarter, starting at the top; the radius grows with time.",
        "Read the angle as the day of the quarter.",
      ],
    });
    spiralLabel.append(el("span", { class: "heading-pill" },
      statusPill("neutral", "Experimental")));
    spiralHost.append(spiralLabel);
    if (!layout.points.length) {
      spiralHost.append(emptyState(
        "No saved scan carries both a date and a count, so there is nothing to place.",
        "A scan row reaches this chart only through its own timestamp — an undated row is not"
        + " drawn at the epoch, it is left off.",
      ));
      return;
    }

    const svg = spiralSvg(layout);
    const card = el("div", { class: "chart-card" }, svg);
    // The registers actually on the chart, in the register's own order — a legend naming a
    // shape nothing drew would be a fourth claim about a population.
    const scopes = ["sca", "sast", "secrets"]
      .filter((sc) => layout.points.some((p) => p.scope === sc));
    if (scopes.length > 1) {
      card.append(el("p", { class: "small muted" }, "Marks: " + scopes
        .map((sc) => `${SPIRAL_GLYPHS[SPIRAL_SHAPES[sc]]} ${SCOPE_LABELS[sc]}`)
        .join(" · ") + "."));
    }
    // THE SAME ARRAY the drawing was handed, not a second walk over the payload — chartTable's
    // one rule (see gas_shared/ui/chartTable.js's header).
    card.append(chartTable({
      canvas: svg,
      caption: "Every point on the spiral as a row: the scan, when it ran, which register it"
        + " covered, and the open count it saved. Ordered oldest first, the way the line is"
        + " drawn.",
      model: chartTableModel({
        columns: [
          { key: "scanId", label: "Scan", format: "text" },
          {
            key: "ts", label: "Date", format: "text", value: (p) => fmtDateTime(p.ts),
          },
          {
            key: "scope",
            label: "Register",
            format: "text",
            value: (p) => SCOPE_LABELS[p.scope] || p.scope,
          },
          { key: "open", label: "Open", format: "count" },
        ],
        rows: layout.points,
      }),
    }));
    if (layout.skipped) {
      // THE OUTSIDE, named rather than rounded away: these rows are in the table above this
      // section and not on this chart, and a reader comparing the two counts is owed the
      // reason.
      card.append(el("p", { class: "small muted" },
        `${fmtCount(layout.skipped)} scan `
        + `${pluralize(layout.skipped, "row")} could not be placed — no usable timestamp or no `
        + "count saved. They are unplaced, not zero."));
    }
    spiralHost.append(card);
  }

  function renderTrends(payload, trend) {
    clear(chartsHost);
    if (!trend.length) {
      chartsHost.append(emptyState("Not enough scan history yet to chart trends."));
      return;
    }
    const kmPoints = kmMedianPoints(trend);
    const openResolved = openResolvedPoints(trend);

    const orCanvas = el("canvas");
    const kmCanvas = el("canvas");
    chartsHost.append(
      el("div", { class: "chart-card" },
        el("h3", { class: "section-label" }, "Open vs resolved"),
        el("div", { class: "chart-box" }, orCanvas),
        // `openResolved` — the array handed to the wrapper below — listed, not re-derived.
        chartTable({
          canvas: orCanvas,
          caption: "Both lines as figures: open and resolved counts at each date. A"
            + " reconstructed row predates the first saved scan, where closures are"
            + " under-counted.",
          model: chartTableModel({
            columns: [
              {
                key: "date",
                label: "Date",
                format: "text",
                value: (p) => String(p.date).slice(0, 10),
              },
              { key: "open", label: "Open", format: "count" },
              { key: "resolved", label: "Resolved", format: "count" },
              {
                key: "reconstructed",
                label: "Reconstructed",
                format: "text",
                align: "text",
                value: (p) => (p.reconstructed ? "yes" : "no"),
              },
            ],
            rows: openResolved,
          }),
        })),
      el("div", { class: "chart-card" },
        // THE FOOTNOTE UNDER THIS CHART IS ITS HEADING'S DEFINITION. What the 24-word note
        // said — still-open findings stay in the curve behind the line rather than being
        // dropped, which is what makes the median honest as of each replayed date — is what
        // `censoring` MEANS on this chart, and it qualified nothing that is printed. The term
        // moves from `half-life` to `censoring` for the same reason: `half-life` is what the
        // figure IS and it is already reachable from the Median MTTR card two sections up,
        // while nothing on this page routed to the method that makes the line trustworthy.
        el("h3", { class: "section-label" }, tipLabel("MTTR trend (KM median)", {
          term: "censoring",
          lines: [
            "Still-open findings stay in the curve behind this line rather than being dropped,"
            + " which is what makes the median honest as of each replayed date.",
          ],
        })),
        kmPoints.length > 1
          ? el("div", { class: "chart-box" }, kmCanvas)
          : el("p", { class: "chart-empty muted" },
              "Not enough remediation history to estimate a KM median trend yet."),
        kmPoints.length > 1
          ? chartTable({
            canvas: kmCanvas,
            caption: "The Kaplan-Meier median, in days, as of each replayed date — the same"
              + " points the line above plots.",
            model: chartTableModel({
              columns: [
                {
                  key: "x",
                  label: "Date",
                  format: "text",
                  value: (p) => String(p.x).slice(0, 10),
                },
                { key: "y", label: "Half-life", format: "days" },
                {
                  key: "reconstructed",
                  label: "Reconstructed",
                  format: "text",
                  align: "text",
                  value: (p) => (p.reconstructed ? "yes" : "no"),
                },
              ],
              rows: kmPoints,
            }),
          })
          : null),
    );
    // A CROSS-LINK IS A LINK. 30 words said which five keys this page's trend slice ships and
    // that the sixth is elsewhere; the first half is provenance and rides on the phrase, the
    // second half is the link. `historyTrendSlice` (domain/pagePayload.ts) is why the series
    // is absent at all — see this file's header.
    chartsHost.append(el("p", { class: "small muted", style: "grid-column:1/-1" },
      tipLabel("The open-past-SLA series is not published on this page", {
        lines: [
          "This page's trend slice ships date, reconstructed, open, resolved and the KM"
          + " median only.",
        ],
      }),
      " → ",
      el("a", { class: "linklike", href: "#/mttr" }, "MTTR & SLA")));

    loadCharts()
      .then((api) => {
        api.openResolvedLines(orCanvas, openResolved);
        onPageTeardown(() => { try { api.destroyChart(orCanvas); } catch (e) { /* detached */ } });
        if (kmPoints.length > 1) {
          api.trendLine(kmCanvas, kmPoints, { yLabel: "days" });
          onPageTeardown(() => { try { api.destroyChart(kmCanvas); } catch (e) { /* detached */ } });
        }
      })
      .catch(() => {
        chartUnavailable(orCanvas);
        if (kmPoints.length > 1) chartUnavailable(kmCanvas);
      });
  }
}
