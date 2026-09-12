// Live readouts for the Settings page — what a control is currently doing to the register,
// computed from the api_getSettingsImpact payload and the in-memory draft. Pure DOM builders
// (no RPC, no page state) so settings.js stays readable: it fetches the payload once, and
// re-renders these into fixed host nodes as the draft changes.
//
// P2 MOVED THE REUSABLE HALF OF THIS FILE INTO gas_shared/ui/settingsReadouts.js:
// `impactSplitModel`/`impactSplit` (the with/without split every toggle draws — pages/settings.js
// calls these directly now, once per toggle), `severitySplitModel` (the shared half of
// `severityScopeReadout` below), `tickTimeline` (`retentionTicks` below builds the pure state;
// `tickTimeline` only draws it) and `createCutHistogram` (the EPSS threshold histogram's
// generalised shape, min/max/step/format rather than a hard-coded 0..1). `openAndTotal` moved to
// gas_shared/ui/figures.js, beside `fmtCount`/`pct1`/`days1` — it is a number formatter, not a
// DOM builder, and `severitySplitModel` uses it too now.
//
// WHAT IS LEFT HERE IS THE PART THAT READS GAS'S OWN DOMAIN: the severity-scope adapter that
// resolves `draft.fetchSeverities` into a predicate (`severitySplitModel` takes a predicate,
// never a selected array — see that function's own header for why), `createRiskReadout`'s
// clause table, `ruleSentence`/`ruleIsEmpty` and the overlap caveat (they read gas's own
// `RiskRule`), and `retentionTicks`, the arithmetic that decides which state a scan's tick is in
// — `tickTimeline` itself refuses to know that.
//
// The risk classifier is still the one control with a persistent interactive element: it owns
// the `<input type=range>` EPSS slider (now inside the cut histogram it composes), which the
// reader may be actively dragging when a change elsewhere triggers a repaint. See
// `createRiskReadout`'s own comment, and `createCutHistogram`'s in gas_shared, for why that
// element is built once and never recreated.

import {
  clear, createCutHistogram, el, openAndTotal, severitySplitModel, splitBar, tickTimeline,
} from "./ui.js";
import {
  breakdownFromCube, epssHistogram, openSlice, ruleIsEmpty, ruleSentence,
} from "./riskCube.js";

function fmt(n) {
  return (n || 0).toLocaleString();
}

// THIS `pct` IS DELIBERATELY NOT THE ONE THE BRIEF'S FIX TOUCHED. `impactSplitModel`
// (gas_shared) now returns `absentText` for a zero-denominator share and drops the
// parenthetical — P2's one deliberate pixel — but that fix is scoped to the two display-toggle
// headlines it replaced (`toggleHeadline`, deleted from this file). The risk classifier's own
// summary sentence below was a THIRD call site the old shared `pct()` covered, which the brief
// never named as part of the fix, so it keeps the old zero-denominator shape rather than
// picking up an unreviewed second pixel change.
function pct(n, total) {
  return total ? `${((n / total) * 100).toFixed(1)}%` : "0.0%";
}

/**
 * Severity scope readout: a splitBar over `census.bySeverity`, one segment per severity in the
 * draft's scan scope (the `--sev-*` fill tokens, same as everywhere else severity appears) plus
 * a single "Not scanned" segment for the rest. The caption repeats every severity's count in
 * words — including the out-of-scope ones, named as such — so the bar is never the only way to
 * read the numbers.
 *
 * The shared half is `severitySplitModel` (gas_shared/ui/settingsReadouts.js); this function is
 * gas's own adapter from `draft.fetchSeverities` — an ARRAY — to the PREDICATE that module
 * requires, which is the one thing it may not do generically (see that module's own header).
 */
export function severityScopeReadout(census, draft, selectable) {
  // The bar is drawn over OPEN findings: choosing a scan scope is a decision about the backlog
  // you are going to work, and a segment sized by resolved history would misstate it. The
  // all-time figure rides along in the caption where it differs.
  const model = severitySplitModel({
    selectable,
    bySeverityOpen: (census && census.bySeverity && census.bySeverity.open) || {},
    bySeverityAll: (census && census.bySeverity && census.bySeverity.all) || {},
    inScope: (sev) => draft.fetchSeverities.includes(sev),
    openTotal: (census && census.openTotal) || 0,
    total: (census && census.total) || 0,
    outLabel: "Not scanned",
    unit: "findings",
  });
  return splitBar(model);
}

function riskRow(name, open, missing) {
  return el(
    "div",
    { class: "risk-row" },
    el("span", { class: "risk-row__name" }, name),
    el(
      "span",
      {},
      // No "fired" suffix: the column header says "Fired on open (all time)" once, and
      // repeating it on every row is noise under a heading that already carries it.
      el("span", { class: "risk-row__count num" },
        openAndTotal(open.count, open.countAll)),
      open.missing || missing
        ? el("span", { class: "risk-row__missing" },
          `${openAndTotal(open.missing, open.missingAll)} never measured`)
        : null,
    ),
  );
}

/**
 * The high-risk classifier's live readout: one row per ENABLED clause, the rule as a sentence,
 * the total, the overlap caveat, and the EPSS histogram with its own threshold slider.
 *
 * Returns `{ node, update(cube, rule, { onThresholdChange }) }`. Composes
 * `createCutHistogram()` for the histogram block — built exactly once, including its
 * `<input type="range">` — for the reason that module's own header gives: the range fires
 * `input` continuously while being dragged, and if `update()` (which every draft edit calls)
 * tore down and rebuilt that element, dragging it would silently stop moving after the first
 * pixel — the node the browser is delivering pointer events to would no longer be attached to
 * the document.
 */
export function createRiskReadout() {
  // The clause rows sit ABOVE the summary sentence, so they are where a reader meets these
  // figures first — and "1 (6 all time)" is not self-describing on its own. One header line
  // says what the pair is, rather than repeating "open" on every row.
  const rowsHead = el(
    "div",
    { class: "risk-row risk-row--head" },
    el("span", { class: "risk-row__name label" }, "Clause"),
    el("span", { class: "risk-row__headnote label" }, "Fired on open (all time)"),
  );
  const rowsHost = el("div", { class: "risk-breakdown" }, rowsHead);
  const sentenceEl = el("p", { class: "risk-sentence" });
  const emptyEl = el(
    "p",
    { class: "risk-empty muted small" },
    "No signals enabled — every finding will read as unclassified.",
  );
  const caveatEl = el(
    "p",
    { class: "risk-caveat muted small" },
    "The clauses above can overlap on the same finding, so they do not sum to the total.",
  );

  // `onThreshold` is declared before the histogram is built, not after: `onCut` below closes
  // over it by reference, and every call to it happens on a later `input` event, well after
  // `update()` has had its first chance to set it — but declaring it first keeps that plain to
  // read rather than relying on hoisting to make it true.
  let onThreshold = null;
  const cutHist = createCutHistogram({
    min: 0, max: 1, step: 0.01, buckets: 20,
    ariaLabel: "EPSS threshold slider",
    format: (v) => v.toFixed(2),
    axisNote: "Bar height is the square root of the count — EPSS is skewed hard enough that a "
      + "linear scale would flatten everything above 0.25 to nothing. Hover a bar for its exact "
      + "figure.",
    // A native `title` used to carry the bucket's exact figure — the one place this histogram
    // states a number at all — which put it out of reach of touch entirely and truncated it at
    // the OS's discretion. Twenty bars in the tab order would cost more than the figure is
    // worth, so this stays a pointer affordance (as the note beside it says) and the counts a
    // reader must have are in the clause rows above.
    barTip: (start, end, n) => `${start.toFixed(2)}–${end.toFixed(2)}: ${fmt(n)} finding(s)`,
    onCut: (v) => { if (onThreshold) onThreshold(v); },
  });

  const node = el(
    "div", { class: "risk-readout" },
    rowsHost, sentenceEl, emptyEl, caveatEl, cutHist.node,
  );

  function update(cube, rule, { onThresholdChange } = {}) {
    onThreshold = onThresholdChange || null;
    // Two passes of the SAME function over two populations, rather than one pass and a
    // subtraction: every figure here is a union over the enabled clauses, and unions do not
    // subtract. openSlice is what makes the open pass possible from a single payload.
    const all = breakdownFromCube(cube, rule);
    const openCube = openSlice(cube);
    const open = breakdownFromCube(openCube, rule);
    const openTotal = openCube.total;
    const empty = ruleIsEmpty(rule);

    const clause = (k) => ({
      count: open[k], countAll: all[k],
      missing: open[`${k}Missing`], missingAll: all[`${k}Missing`],
    });

    clear(rowsHost);
    rowsHost.append(rowsHead);
    if (rule.kev) rowsHost.append(riskRow("CISA KEV", clause("kev")));
    if (rule.exploit) rowsHost.append(riskRow("Public exploit", clause("exploit")));
    if (rule.epss) {
      rowsHost.append(riskRow(`EPSS ≥ ${rule.epssThreshold.toFixed(2)}`, clause("epss")));
    }

    emptyEl.hidden = !empty;
    sentenceEl.hidden = empty;
    caveatEl.hidden = empty;
    if (!empty) {
      clear(sentenceEl);
      sentenceEl.append(
        `${ruleSentence(rule)} → `,
        el("strong", { class: "num" }, fmt(open.anyOf)),
        ` of ${fmt(openTotal)} open findings in scan scope are high risk `
        + `(${pct(open.anyOf, openTotal)}).`,
      );
      // Only when it adds something. If nothing in scope is resolved the two sentences are the
      // same sentence, and printing it twice invites the reader to hunt for a difference.
      if (cube.total > openTotal) {
        sentenceEl.append(
          el("span", { class: "muted" },
            ` ${fmt(all.anyOf)} of ${fmt(cube.total)} including resolved.`),
        );
      }
    }

    // Drawn over the OPEN population, because that is what the rest of this card now reports.
    // A histogram of every row the register ever held, under a headline about open findings,
    // would be two different questions sharing one axis.
    const hist = epssHistogram(openCube, 20);
    const histAll = epssHistogram(cube, 20);
    cutHist.update({
      counts: hist.buckets,
      cut: rule.epssThreshold,
      unmeasuredNote: `${openAndTotal(hist.unmeasured, histAll.unmeasured)} findings have no `
        + "EPSS score and are never flagged by this clause.",
    });
  }

  return { node, update };
}

/**
 * Which state each scan's retention tick is in, and the two summary counts — pure, so
 * `test/settingsReadouts.test.js` can finally hold it. `tickTimeline` (gas_shared) only draws
 * whatever this returns; it does not know what "sealed" or "pinned" mean.
 */
export function retentionTicks(scans, retentionDays) {
  const list = scans || [];
  let sealedCount = 0;
  let wouldSeal = 0;
  const ticks = list.map((s) => {
    if (s.sealed) sealedCount += 1;
    const willSeal = !s.sealed && !s.pinned
      && retentionDays !== null && s.ageDays > retentionDays;
    if (willSeal) wouldSeal += 1;
    const state = s.sealed ? "sealed" : willSeal ? "would" : s.pinned ? "pinned" : "plain";
    const why = s.sealed ? "already sealed"
      : willSeal ? `would seal at ${retentionDays}d`
        : s.pinned ? "always kept (most recent)"
          : "within the retention window";
    return { state, hint: `${s.ageDays}d old — ${why}` };
  });
  return { ticks, sealedCount, wouldSeal };
}

/**
 * The retention timeline: one tick per scan (newest first, matching the payload), sealed/
 * would-seal/pinned each carrying a distinct fill AND a glyph — the legend beneath states both
 * in words, including that a pinned scan is held back regardless of the window. Rebuilt whole on
 * every call; nothing in it is interactive.
 */
export function renderRetentionReadout(scans, draft) {
  const { ticks, sealedCount, wouldSeal } = retentionTicks(scans, draft.retentionDays);
  const total = (scans || []).length;
  const summary = draft.retentionDays === null
    ? `${fmt(sealedCount)} of ${fmt(total)} scans are already sealed. Sealing is off — no ` +
      "more will seal automatically."
    : `${fmt(sealedCount)} of ${fmt(total)} scans are already sealed. At ${draft.retentionDays} ` +
      `days, ${fmt(wouldSeal)} more would seal on the next pass.`;
  return tickTimeline({
    ticks,
    states: {
      sealed: { glyph: "✓", word: "sealed" },
      would: { glyph: "→", word: "would seal" },
      pinned: { glyph: "•", word: "pinned" },
    },
    legend: "✓ sealed · → would seal · • pinned — held back regardless of " +
      "the window (the two most recent scans).",
    summary,
    ariaLabel: `${fmt(sealedCount)} of ${fmt(total)} scans are sealed`,
  });
}
