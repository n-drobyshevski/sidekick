// The whole lattice section — hero, paint-mode control, outcome-mass strip with its
// ceiling marker, cell popover, and the server reconciliation — as ONE component both the
// Problem tree and the Posture tabs mount.
//
// It exists because the second tab proved the first one's wiring was the abstraction.
// Mounting the lattice on the Problem tab took about 360 lines inside pages/aars.js, and
// every one of them would have been repeated verbatim for Posture except for which rule
// object they read, which badge they draw and whether a verdict is called an outcome or a
// tier. That is not two features, it is one feature with a `kind`; and pages/aars.js is
// already the longest file in the app, so the copy would have been the worse of two
// mistakes. `problem.ts` and `posture.ts` make exactly this argument about themselves —
// the second is a structural port of the first — and this is that argument applied to
// their editors.
//
// WHAT IS PARAMETERISED, AND WHY EACH ONE HAS TO BE. The two tabs differ in more than
// labels: they decide against different rule objects held in different closures, their
// verdicts live on different fields (`outcome` vs `tier`), their coverage tallies are keyed
// differently (`byOutcome` vs `byTier`), their ceilings are named after different bands, and
// their cascades cap at limits the server reports separately. Everything else — the grid,
// the three paint modes, the popover, the legend sentences, the reconciliation and its
// degrade-the-picture behaviour — is identical, and lives here once.
//
// WHAT IS NOT PARAMETERISED: the caller never gets to change how divergence is handled, or
// to skip the reconciliation. A lattice that can be mounted without its guard is a lattice
// that will eventually be mounted without its guard.

import { el, clear } from "./dom.js";
import { segmented, select } from "./controls.js";
import { openPopover } from "./popover.js";
import { outcomeBadge, outcomeLabel } from "./outcome.js";
import { tierBadge, tierLabel } from "./posture.js";
import { latticeGrid } from "./lattice.js";
import { latticeIcicle } from "./latticeIcicle.js";
import { latticeCells, outcomeMass, paintCells, toneForKey, vectorSentence } from "../lattice.js";
import { OUTCOME_VALUES } from "../decideMirror.js";

/**
 * The two lattices' display vocabularies. Worst-first in both cases, because `outcomeMass`
 * reads `order[0]` as the band the ceiling applies to — ACT is already first in
 * `OUTCOME_VALUES`, while `TIER_VALUES` is ascending and has to be reversed here rather
 * than at each call site.
 */
const KINDS = {
  problem: {
    verdictKey: "outcome",
    order: OUTCOME_VALUES,
    badge: outcomeBadge,
    label: outcomeLabel,
    ceilingWord: "Act",
    tallyKey: "byOutcome",
  },
  posture: {
    verdictKey: "tier",
    order: [4, 3, 2, 1],
    badge: tierBadge,
    label: tierLabel,
    ceilingWord: "Tier 4",
    tallyKey: "byTier",
  },
};

export function latticeSection(opts) {
  const {
    spec, kind, unit, unitOne,
    decide, decideSaved, coverageOf,
    // `getRule` is the WHOLE rule object (what a coverage walk needs); `getRules` is just
    // its ordered row array (what a cap check and a row lookup need). Keeping them apart
    // matters: handing the array to a coverage function silently tallies nothing.
    getCeiling, getOccupancy, getRule, getRules, getRuleCap,
    whenWords, onAddRule, onRowLight, onTrace,
  } = opts;
  const K = KINDS[kind];

  let mode = "rule";
  let pop = null;
  let lastPainted = [];

  function closePop() {
    if (pop) {
      pop.close();
      pop = null;
    }
  }

  /**
   * The two painters share one handle shape, so a view switch is a swap and never a fork.
   *
   * `views: false` suppresses the switch entirely, and Posture passes it. The reason is no
   * longer the one it used to be — "three consequence panels have no nesting a tree could
   * show" stopped being true when that lattice was flattened, and its three axes now nest
   * exactly as the Problem tree's four do. `latticeIcicle` would draw it; `icicleLayout`
   * reads only `spec.axes`. It stays off because nobody has yet argued that a second view of
   * 27 cells says anything the matrix does not, and a control that offers a view for the sake
   * of symmetry is a control the reader has to rule out. Turning it on is deleting one line
   * in pages/aars.js, and should follow that argument rather than stand in for it.
   */
  const painterHooks = {
    onCellEnter: (cell) => {
      const d = grid.descriptorFor(cell.key);
      const idx = d ? d.ruleIndex : null;
      grid.light(idx);
      if (onRowLight) onRowLight(idx);
    },
    onCellLeave: () => {
      grid.light(null);
      if (onRowLight) onRowLight(null);
    },
    onActivate: (cell, anchor) => {
      closePop();
      pop = openCellPopover(cell, anchor);
    },
  };

  const gridAriaLabel = `Decision lattice, ${latticeCells(spec).length} ${unit}`;
  const painters = {
    matrix: () => latticeGrid({ spec, ariaLabel: gridAriaLabel, hooks: painterHooks }),
    tree: () => latticeIcicle({ spec, ariaLabel: `Decision tree, ${latticeCells(spec).length} ${unit}`, hooks: painterHooks }),
  };
  let view = "matrix";
  let grid = painters.matrix();
  const painterHost = el("div", {});
  painterHost.append(grid.node);

  /**
   * Switching painters is the ONE structural rebuild this component does, so it restores
   * focus explicitly — the same discipline focusRow keeps in pages/aars.js. Without it the
   * caret lands on <body> and a keyboard user loses their place mid-comparison.
   */
  function setView(next) {
    if (next === view) return;
    const focused = document.activeElement;
    const focusedKey = focused && focused.dataset ? focused.dataset.key : null;
    view = next;
    grid = painters[next]();
    painterHost.replaceChildren(grid.node);
    repaint();
    if (focusedKey) grid.focusCell(focusedKey);
  }

  const modeTabs = segmented({
    options: [
      { value: "rule", label: "Rule", title: `What this draft does to every ${unitOne}` },
      { value: "landscape", label: "Landscape", title: "Where this tenant's records actually land" },
      { value: "change", label: "Change", title: `Only the ${unit} this draft moves` },
    ],
    value: "rule",
    ariaLabel: "What the lattice shows",
    onChange: (v) => {
      mode = v;
      closePop();
      // `segmented` reports the choice but does not move `aria-pressed` itself — the caller
      // owns that, the same way selectModelTab calls modelTabs.set(). Without this the
      // buttons keep announcing the previous mode as the active one.
      modeTabs.set(v);
      repaint();
    },
  });

  // ----------------------------------------------------------------------------- tracer
  /**
   * Walk one vector through the cascade and show the walk, not just its answer.
   *
   * The cascade table can say WHAT each row decides but never why a particular record got
   * the verdict it did — that requires reading the rows in order and stopping at the first
   * match, which is exactly the work a reader should not have to do in their head. Setting
   * the axes here pulses the cell the vector lands on, lights the row that won, and dims
   * the rows the walk stepped past with a marker saying they were tried.
   *
   * `.rule-tried` must not look like `.rule-dead`: "tried and did not match this vector" is
   * a fact about ONE walk, while "never fires" is a fact about the rule. Dimming alone would
   * conflate them, so a tried row carries its own marker.
   */
  const traceState = {};
  for (const axis of spec.axes) traceState[axis.key] = axis.values[axis.values.length - 1];

  const traceReadout = el("p", {
    class: "small",
    style: "margin:10px 0 0",
    role: "status",
    "aria-live": "polite",
  });
  const traceControls = el("div", { class: "lat-trace__axes" });
  for (const axis of spec.axes) {
    const ctl = select({
      options: axis.values,
      value: traceState[axis.key],
      ariaLabel: axis.label,
      onChange: (v) => { traceState[axis.key] = v; runTrace(); },
    });
    traceControls.append(el("label", { class: "lat-trace__axis" },
      el("span", {}, axis.label), ctl));
  }
  const traceBox = el(
    "details",
    { class: "rule-disclosure lat-trace" },
    el("summary", {}, `Trace one ${unitOne} through the cascade`),
    traceControls,
    traceReadout,
  );
  traceBox.addEventListener("toggle", () => {
    if (traceBox.open) runTrace();
    else {
      grid.pulse(null);
      if (onTrace) onTrace(null);
    }
  });

  function runTrace() {
    if (!traceBox.open) return;
    const vector = { ...traceState };
    const decided = decide(vector);
    const idx = decided.matchedRuleIndex;
    const verdict = decided[K.verdictKey];
    const key = spec.keyOf(vector);

    grid.pulse(key);
    grid.light(idx === -1 ? null : idx);
    if (onTrace) onTrace(idx);

    const words = vectorSentence(spec, vector);
    if (idx === -1) {
      traceReadout.textContent =
        `${words} → no rule matches, so the fallback decides: ${K.label(verdict)}.`;
      return;
    }
    // The winning row is always named; the rows before it are only mentioned when there
    // ARE any, because "rules 1–0 were tried" is how the first sentence read before this.
    const skipped = idx === 0
      ? ""
      : idx === 1
        ? "rule 1 was tried and did not match; "
        : `rules 1–${idx} were tried and did not match; `;
    traceReadout.textContent =
      `${words} → ${skipped}rule ${idx + 1} is the first that matches — `
      + `${whenWords(getRules()[idx])} → ${K.label(verdict)}.`;
  }

  const massHost = el("div", { class: "lat-mass" });
  const legend = el("p", { class: "small muted", style: "margin:12px 0 0" });
  const note = el("div", {});

  // The switch appears only where a second view says something the first does not; the
  // `views` note on painterHooks above carries why Posture still declines it.
  const viewTabs = opts.views === false ? null : segmented({
    options: [
      { value: "matrix", label: "Matrix", title: "Every leaf on one grid" },
      { value: "tree", label: "Tree", title: "The axes nested, branch by branch" },
    ],
    value: "matrix",
    ariaLabel: "How the lattice is drawn",
    onChange: (v) => { viewTabs.set(v); setView(v); },
  });

  const node = el(
    "div",
    { class: "model-hero" },
    el(
      "div",
      { class: "model-hero__head" },
      el("span", { class: "label" }, "The decision space"),
      el("span", { style: "flex:1 1 auto" }),
      viewTabs,
      modeTabs,
    ),
    painterHost,
    massHost,
    legend,
    note,
    traceBox,
  );

  // ------------------------------------------------------------------------------ paint

  /**
   * Repaint from the MIRROR — no server round-trip, so this runs on every keystroke.
   *
   * Only LANDSCAPE depends on the server, and it is the only mode `.is-updating` may dim: Rule
   * and Change are mirror-driven and already current the instant a key goes down, so dimming
   * them while a preview is in flight would say "this is stale" about the one thing on the
   * page that is not.
   */
  function repaint() {
    const occ = getOccupancy();
    grid.setMode(mode);
    const painted = paintCells(grid.cells, {
      mode,
      decide,
      savedDecide: decideSaved,
      occupancy: occ.map || {},
      // Three states, not two: no preview has landed at all, versus a preview that landed
      // and found nothing in this cell.
      occupancyKnown: occ.known,
    });
    lastPainted = painted;
    grid.paint(painted);
    // Change mode recedes what the draft does not move, so the unchanged shape stays
    // legible behind the diff instead of competing with it.
    grid.recede(mode === "change" ? painted.filter((d) => !d.changed).map((d) => d.key) : []);
    paintLegend(painted, occ.known);
    paintMass();
    runTrace(); // the rule may have moved under an open trace
  }

  function paintLegend(painted, occupancyKnown) {
    if (mode === "rule") {
      legend.textContent =
        `Every ${unitOne} this draft could ever decide, tinted by the verdict it would get. `
        + "Hover or focus a cascade row below to light the ones it claims.";
      return;
    }
    if (mode === "change") {
      const moved = painted.filter((d) => d.changed).length;
      legend.textContent = moved
        ? `${moved} of ${painted.length} ${unit} would change verdict if you saved this draft.`
        : `This draft moves no ${unitOne}. Nothing here would decide differently after a save.`;
      return;
    }
    if (!occupancyKnown) {
      legend.textContent =
        "Not measured yet — no preview has landed. That is different from nothing reaching a "
        + `${unitOne}.`;
      return;
    }
    const reached = painted.filter((d) => d.count > 0).length;
    legend.textContent =
      `${reached} of ${painted.length} ${unit} carry at least one record in this tenant. `
      + `A hatched ${unitOne} is one the landscape never reaches — which is not the same as a `
      + "rule that cannot fire.";
  }

  /**
   * The verdict distribution over the whole lattice, with the ceiling drawn ON the axis.
   *
   * The ceiling used to speak only as a thrown string AFTER a save was refused, or one
   * debounced round-trip later through `preview.validation`. Drawn as a reference marker —
   * the idiom the compliance rail already uses for its landscape mean — it answers while the
   * rule that would breach it is still being dragged. Fed from the mirror, so the marker
   * moves on the same keystroke as the field.
   */
  function paintMass() {
    const coverage = coverageOf(getRule());
    const ceiling = getCeiling();
    const mass = outcomeMass(coverage[K.tallyKey], K.order, ceiling);
    clear(massHost);

    const bar = el("div", {
      class: "lat-mass__bar",
      role: "img",
      "aria-label": mass.segments.map((s) => `${s.count} ${K.label(s.key)}`).join(", ")
        + `, of ${coverage.total} ${unit}; ceiling at ${Math.round(ceiling * 100)} percent`,
    });
    const bands = [];
    for (const seg of mass.segments) {
      const tone = toneForKey(seg.key);
      const band = el("span", { class: "lat-mass__seg", "data-tone": tone ? tone.tone : "neutral" });
      band.style.width = `${seg.share * 100}%`;
      // A tier with nothing in it must not leave a sliver. `min-width` keeps a real but
      // tiny share visible; on a zero it would print two pixels of colour that read as
      // "a little", and with the separator on, two pixels of white that read as a seam.
      // The legend below already prints the 0, which is where a zero belongs.
      if (!seg.count) band.dataset.zero = "";
      bands.push(band);
      bar.append(band);
    }
    // The separator belongs BETWEEN fills, so the last one that actually draws must not
    // carry it — otherwise a bar whose trailing tiers are all empty ends two pixels short
    // of its own frame and reads as if it did not reach the end. `:last-child` cannot say
    // this: the last element is often a zero-width band, not the last visible fill.
    const lastFill = bands.filter((n) => n.dataset.zero === undefined).pop();
    if (lastFill) lastFill.dataset.lastFill = "";
    const mark = el("div", {
      class: "lat-mass__mark",
      "data-label": `${K.ceilingWord} ceiling ${Math.round(ceiling * 100)}%`,
    });
    mark.style.left = `calc(${mass.ceilingShare * 100}% - 1px)`;

    const key = el("div", { class: "lat-mass__legend" });
    for (const seg of mass.segments) {
      key.append(el("span", {}, K.badge(seg.key), el("b", {}, ` ${seg.count}`)));
    }
    massHost.append(el("div", { class: "lat-mass__frame" }, bar, mark), key);

    // Over the ceiling is a refusal to save, so it says so here rather than waiting to be
    // discovered by pressing Save.
    if (mass.over) {
      massHost.append(el("div", { class: "diag-warn", role: "status" }, mass.sentence));
    }
  }

  // ---------------------------------------------------------------------------- popover

  /**
   * What decided this cell, and the one edit that most often follows from reading it.
   *
   * "Add a rule for this cell" hands back a FULLY specified `when` — every axis named, so
   * the new row claims exactly the cell that was clicked and nothing else. The caller
   * prepends it, because "new rows go on top" is the cascade's own convention and belongs
   * to the cascade, not to the picture.
   */
  function openCellPopover(cell, anchor) {
    const d = grid.descriptorFor(cell.key);
    const claimed = d && d.ruleIndex >= 0;
    const occ = getOccupancy();
    const count = occ.known ? (occ.map[cell.key] || 0) : null;
    const cap = getRuleCap();
    const atCap = getRules().length >= cap;
    // The raw verdict comes straight from the mirror; `paintCells` deliberately emits
    // display fields (tone/word/glyph), not the enum, so read the decision itself.
    const decided = decide(cell.vector);
    const verdict = decided[K.verdictKey];

    return openPopover({
      anchor,
      className: "popover--lattice",
      ariaLabel: vectorSentence(spec, cell.vector),
      build: (api) => {
        const body = el("div", { class: "lat-pop" });
        body.append(el("p", { class: "lat-pop__vector" }, vectorSentence(spec, cell.vector)));
        body.append(el("p", { class: "lat-pop__row" }, K.badge(verdict)));
        body.append(el(
          "p", { class: "small muted", style: "margin:0 0 8px" },
          claimed
            ? `Claimed by rule ${d.ruleIndex + 1} — ${whenWords(getRules()[d.ruleIndex])}.`
            : `No rule matches this ${unitOne}, so the fallback decides it.`,
        ));
        body.append(el(
          "p", { class: "small muted", style: "margin:0 0 10px" },
          count === null
            ? "Not measured yet — no preview has landed."
            : count === 0
              ? "Nothing in this tenant lands here."
              : `${count} ${count === 1 ? "record" : "records"} in this tenant land here.`,
        ));
        const add = el("button", {}, "Add a rule for this cell");
        add.disabled = atCap;
        if (atCap) add.title = `The cascade is limited to ${cap} rules.`;
        add.addEventListener("click", () => {
          api.close(true);
          pop = null;
          onAddRule({ ...cell.vector }, verdict);
        });
        body.append(add);
        return body;
      },
      onClose: () => { pop = null; },
    });
  }

  // ---------------------------------------------------------------------- reconciliation

  /**
   * Guard 2: reconcile the drawn cascade against the server's own walk of the SAME rule.
   *
   * `sentRule` must be the draft as it stood when the request LEFT, never the live one —
   * the preview is debounced, so a live comparison would fire on every keystroke made while
   * a request was in flight and report a race as a disagreement.
   *
   * What this catches is a per-ROW disagreement, not a per-cell one: a pathological rule
   * could in principle tie on every count and still place a cell differently. byRow,
   * byFallback and the total agreeing together makes that vanishingly unlikely, and
   * test/decideMirror.test.js closes the gap properly by comparing the decisions themselves.
   * When they do disagree the picture stops claiming anything — hatched, not merely
   * captioned, because a confident wrong lattice beside a small note is worse than none.
   */
  function reconcile(sentRule, serverCoverage) {
    clear(note);
    if (!serverCoverage) {
      grid.setDiverged(false);
      return;
    }
    const mine = coverageOf(sentRule);
    const rowsDisagree = mine.byRow.length !== serverCoverage.byRow.length
      || mine.byRow.some((n, i) => n !== serverCoverage.byRow[i]);
    const agrees = !rowsDisagree
      && mine.byFallback === serverCoverage.byFallback
      && mine.total === serverCoverage.total;
    grid.setDiverged(!agrees);
    if (agrees) return;
    const bad = mine.byRow.findIndex((n, i) => n !== serverCoverage.byRow[i]);
    note.append(el(
      "div",
      { class: "diag-warn", role: "status" },
      "The lattice drawn here and the server's own walk of this rule disagree"
        + (bad >= 0
          ? ` — rule ${bad + 1} claims ${mine.byRow[bad]} ${unit} here and `
            + `${serverCoverage.byRow[bad]} there. `
          : ". ")
        + "The server decides; this picture has stopped claiming anything until they agree.",
    ));
  }

  return {
    node,
    repaint,
    reconcile,
    close: closePop,
    light: (i) => grid.light(i),
    setUpdating: (on) => grid.setUpdating(on),
    descriptorFor: (key) => grid.descriptorFor(key),
    painted: () => lastPainted,
  };
}
