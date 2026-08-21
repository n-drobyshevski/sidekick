// Pure, DOM-free geometry and paint logic for the Problem tree's 54-leaf lattice and the
// Posture rule's 27-cell lattice — the "where does each vector sit, and what does it look
// like" half of lattice.css's design. This file computes rects, keys and paint descriptors;
// it never touches `document`, never builds a node, and is safe to import from a plain
// vitest run with no jsdom, same as decideMirror.js and egoLayout.js. Whichever surface
// eventually renders this (a future problem/posture pane in pages/aars.js, out of scope for
// this file) turns these numbers into a CSS grid of `<button>`s or, for the icicle view, an
// inline SVG — see lattice.css's own header for why a grid of buttons beats an SVG here and
// an icicle needs one anyway.
//
// EVERYTHING KEYS OFF `keyOf(vector)`, NEVER OFF POSITION. The two lattices are laid out
// differently on purpose: PROBLEM's grid rows/cols happen to nest in the same order
// `enumerateDecisionVectors` enumerates (exploitation, impact outer; exposure, mission
// inner — see PROBLEM_LATTICE below), so row-major reading order and enumeration order
// agree there by coincidence, not by design. POSTURE nests `consequence` OUTSIDE
// `containment` in its columns, which means its grid order — capability rows, then
// consequence, then containment — does NOT match `enumeratePostureVectors`'s own
// nesting (capability, containment, consequence). A caller that inferred a cell's identity
// from its position in the returned array, or from its row/col indices, would get PROBLEM
// right and POSTURE silently wrong the first time anyone reordered a loop. So every cell
// this file emits carries its own `key` (from the lattice-appropriate `leafKey` /
// `postureKey`) and its own `enumIndex` (explicit, computed independently of grid
// position) — nothing downstream may ever compute either from where a cell happens to sit.
//
// THE FOUR-TONE PALETTE IS DUPLICATED HERE, NOT IMPORTED, AND THAT IS DELIBERATE.
// `ui/outcome.js` and `ui/posture.js` already carry the ACT/ATTEND/TRACK_STAR/TRACK and
// tier-4..1 → bad/warn/neutral/ok mapping this file needs, but both modules build DOM nodes
// (`el()` from `ui/dom.js`) at their exported entry points, and importing either one here
// would put a `document`-touching module one `import` away from a file that is supposed to
// run happily under plain Node with no jsdom (vitest's environment for this repo — see
// test/lattice.test.js). egoLayout.js keeps its own copy of `SEVERITY_RANK` for the
// identical reason (that file's own comment: "the client bundle cannot import the domain
// layer, and the order must still agree with it") — this is the same discipline applied to
// a DOM boundary instead of a TS/JS one. TONE_BY_OUTCOME / TONE_BY_TIER below must be kept
// byte-for-byte in sync with OUTCOME_META (ui/outcome.js) and TIER_META (ui/posture.js).
//
// BOTH MAPS POINT AT ONE RAMP, AND THAT IS THE WHOLE POINT. An outcome and a tier are the
// same kind of scale — four steps, worst first, and both sorted on in the domain (see
// problems.ts's compareProblems and actions.ts's pickAction, which agree that
// ACT < ATTEND < TRACK_STAR < TRACK). So they share the ordinal ramp (--rank-N-* in
// tokens.css) rather than each minting a palette. "Do not invent a fifth palette" is
// honoured by there being ONE new scale here, not two: what changed is that the app now
// separates ORDINAL scales from CATEGORICAL marks, instead of separating outcomes from
// tiers. ui/outcome.js carries the argument, including why the previous neutral grey for
// `Track ★` inverted the ranking it sat next to.

import {
  OUTCOME_VALUES,
  EXPLOITATION_VALUES, IMPACT_VALUES, EXPOSURE_VALUES, MISSION_VALUES,
  CAPABILITY_VALUES, CONTAINMENT_VALUES, CONSEQUENCE_VALUES,
  leafKey, postureKey,
} from "./decideMirror.js";

// ------------------------------------------------------------------------ the two specs

const PROBLEM_AXES = [
  { key: "exploitation", label: "Exploitation", values: EXPLOITATION_VALUES },
  { key: "impact", label: "Technical impact", shortLabel: "Impact", values: IMPACT_VALUES },
  { key: "exposure", label: "System exposure", shortLabel: "Exposure", values: EXPOSURE_VALUES },
  { key: "mission", label: "Mission", values: MISSION_VALUES },
];

const POSTURE_AXES = [
  { key: "capability", label: "Capability", values: CAPABILITY_VALUES },
  { key: "containment", label: "Containment", values: CONTAINMENT_VALUES },
  { key: "consequence", label: "Consequence", values: CONSEQUENCE_VALUES },
];

/**
 * The width of the empty track a renderer puts between two bands of an outer axis. It lives
 * here rather than in `ui/lattice.js` (which is the only thing that draws it) because the two
 * specs' `rowPx` are chosen against it — a gutter is height a grid spends without spending a
 * row — and that arithmetic has to be checkable from the DOM-free side. See POSTURE_LATTICE.
 */
export const LATTICE_GUTTER_PX = 9;

/**
 * The Problem tree's 54 leaves as a 6×9 grid: exploitation (3) × impact (2) = 6 rows,
 * exposure (3) × mission (3) = 9 columns, no panel — every leaf fits on one screen at once.
 * `axes` is in ENUMERATION order (matches `enumerateDecisionVectors`'s own nesting), which
 * is what makes this spec's row-major cell order and enumeration order coincide — see this
 * file's own header.
 */
export const PROBLEM_LATTICE = {
  axes: PROBLEM_AXES,
  rows: ["exploitation", "impact"],
  cols: ["exposure", "mission"],
  panel: null,
  // Stated rather than defaulted, because POSTURE_LATTICE's own row height is derived from
  // this one and a silent default is a poor thing to derive from.
  rowPx: 38,
  keyOf: leafKey,
  unit: "leaf",
  unitPlural: "leaves",
};

/**
 * The Posture lattice's 27 cells as one 3×9 grid: capability (3) = 3 rows, consequence (3) ×
 * containment (3) = 9 columns, no panel — the same shape, and the same header grammar, as
 * PROBLEM_LATTICE above. One component draws both tabs, and this is what makes them look
 * like it.
 *
 * IT USED TO BE THREE 3×3 PANELS, one per consequence reading, on a "small multiples on one
 * shared scale" argument that ended with: better this than "flattened into one 3×9 or 9×3
 * grid that buries the panel structure". Two things were wrong with it. A panelled grid
 * cannot fill its row — each panel is a shrink-to-fit flex item, so `minmax(42px, 1fr)` never
 * spreads — and the corner key and the capability labels were reprinted once per panel, which
 * is the one thing small multiples exist to avoid. Measured in the dev harness at a 1070px
 * column: 822px used, 248px dead, and 49px cells beside the Problem tree's 98px ones. Two
 * tabs mounting the same component read as two different-sized pictures.
 *
 * And the flattening buries nothing, because the grouping the panels drew is exactly what an
 * outer column band already draws: three bands, a gutter between them, and the axis name
 * riding along inside each (`bandLevels`' span rule below). That is how PROBLEM separates its
 * three exposure bands one tab over, and it is legible there.
 */
export const POSTURE_LATTICE = {
  axes: POSTURE_AXES,
  rows: ["capability"],
  cols: ["consequence", "containment"],
  panel: null,
  // 3 × 82 = 246 = 6 × 38 + 2 × LATTICE_GUTTER_PX, which is PROBLEM's cell band exactly. Half
  // the rows have to be twice the height for the two grids to end at the same line; the
  // gutters are in it because PROBLEM spends height on two of them and this grid spends none.
  // The number that matters is 246, not the 292 the whole block comes to — that total also
  // counts a header band, and both headers are the same two `auto` rows only because both
  // specs now have two column levels. test/lattice.test.js pins the 246 so a later edit to
  // either track fails there rather than quietly desynchronising the tabs again.
  rowPx: 82,
  keyOf: postureKey,
  unit: "cell",
  unitPlural: "cells",
};

// ------------------------------------------------------------------------------ latticeCells

/** Cartesian product of a list of axis defs, preserving axis order outer-to-inner. */
function cartesian(axes) {
  let combos = [[]];
  for (const axis of axes) {
    const next = [];
    for (const combo of combos) {
      for (const v of axis.values) next.push([...combo, v]);
    }
    combos = next;
  }
  return combos;
}

/**
 * A vector's position in `spec.axes`' own nesting order — the SAME index
 * `enumerateDecisionVectors` / `enumeratePostureVectors` would assign it, computed
 * independently of how this grid's `rows` / `cols` / `panel` happen to group those axes.
 * Mixed-radix: each axis contributes its own value's index times the product of every
 * axis's cardinality that comes after it in `spec.axes`.
 */
function enumIndexOf(spec, vector) {
  let idx = 0;
  for (let i = 0; i < spec.axes.length; i++) {
    const axis = spec.axes[i];
    const valueIndex = axis.values.indexOf(vector[axis.key]);
    let trailing = 1;
    for (let j = i + 1; j < spec.axes.length; j++) trailing *= spec.axes[j].values.length;
    idx += valueIndex * trailing;
  }
  return idx;
}

/**
 * Whether `vals` (one axis-combination, outer-to-inner) is the LAST combination of every
 * axis after the first — i.e. whether a gutter belongs right after this row/column, because
 * the NEXT one starts a new value of the outermost grouping axis. With fewer than two axes
 * there is nothing to group (a single axis has no "outer" distinct from itself), so no
 * boundary is ever reported — a `rowGroupEnd` that fired after every row would not be a
 * gutter marker, it would be noise.
 */
function groupEnd(axes, vals) {
  if (axes.length < 2) return false;
  return axes.slice(1).every((axis, i) => vals[i + 1] === axis.values[axis.values.length - 1]);
}

/**
 * One entry per vector in the lattice — 54 for PROBLEM_LATTICE, 27 for POSTURE_LATTICE,
 * `panel` included but never multiplying the count (a panelled lattice still names one
 * entry per leaf, just tagged with which panel it belongs to). Grid order is panel
 * (outermost, when the spec has one), then `rows` combinations, then `cols` combinations —
 * a caller building a `<div class="lat-panels">` of per-panel grids, each row-major, gets
 * exactly this array's order for free. See this file's own header for why `enumIndex` is
 * computed here rather than left for a caller to infer from position.
 */
export function latticeCells(spec) {
  const axisMap = Object.fromEntries(spec.axes.map((a) => [a.key, a]));
  const rowAxes = spec.rows.map((k) => axisMap[k]);
  const colAxes = spec.cols.map((k) => axisMap[k]);
  const panelAxis = spec.panel ? axisMap[spec.panel] : null;
  const panelValues = panelAxis ? panelAxis.values : [null];

  const rowCombos = cartesian(rowAxes);
  const colCombos = cartesian(colAxes);

  const cells = [];
  for (const panelValue of panelValues) {
    for (const rowVals of rowCombos) {
      for (const colVals of colCombos) {
        const vector = {};
        spec.rows.forEach((k, i) => { vector[k] = rowVals[i]; });
        spec.cols.forEach((k, i) => { vector[k] = colVals[i]; });
        if (panelAxis) vector[spec.panel] = panelValue;
        cells.push({
          key: spec.keyOf(vector),
          vector,
          panel: panelValue,
          row: rowVals.join("|"),
          col: colVals.join("|"),
          enumIndex: enumIndexOf(spec, vector),
          rowGroupEnd: groupEnd(rowAxes, rowVals),
          colGroupEnd: groupEnd(colAxes, colVals),
        });
      }
    }
  }
  return cells;
}

// --------------------------------------------------------------------------- latticeHeaders

/**
 * One dimension's (rows' or cols') header, as a list of BAND LEVELS outer-to-inner —
 * `spec.rows` / `spec.cols` in their declared order. A single-axis dimension (POSTURE's
 * rows or cols) produces one level; a two-axis dimension (PROBLEM's) produces two, an outer
 * grouping level whose cells each span every value of the inner axis, and an inner level
 * with one cell per row/column. `start` / `span` are cell-index offsets along this
 * dimension (0-based), so a caller can size a header cell as `grid-column: span N` (or the
 * row equivalent) without recomputing the nesting itself.
 */
function bandLevels(axisKeys, axisMap, canInline) {
  return axisKeys.map((key, levelIdx) => {
    const axis = axisMap[key];
    const outerAxes = axisKeys.slice(0, levelIdx).map((k) => axisMap[k]);
    const innerAxes = axisKeys.slice(levelIdx + 1).map((k) => axisMap[k]);
    const outerSize = outerAxes.reduce((n, a) => n * a.values.length, 1);
    const innerSize = innerAxes.reduce((n, a) => n * a.values.length, 1);
    const cells = [];
    for (let o = 0; o < outerSize; o++) {
      axis.values.forEach((value, vi) => {
        cells.push({
          axisKey: key,
          value,
          label: axisValueWord(key, value),
          start: o * axis.values.length * innerSize + vi * innerSize,
          span: innerSize,
        });
      });
    }
    /**
     * Whether this band can carry its own axis name inline, e.g. "Exposure Open".
     *
     * THE RULE IS ABOUT SPAN, NOT ABOUT WHICH SIDE IT IS ON. Inlining a name is free only
     * when the band spans more than one cell, because then it borrows width the grid had
     * already committed. Both lattices' OUTER column band spans three — one exposure over
     * three missions, one consequence over three containments — so both carry their own name
     * for nothing. Both INNER bands span exactly one, where "Containment Weak" would widen
     * every column in the grid to buy room for a word nine columns share, so those are named
     * in the corner key instead.
     *
     * ROWS NEVER INLINE, whatever their span, and that is not an inconsistency: a row band
     * spans VERTICALLY, and vertical span buys no horizontal room. A row header column
     * auto-sizes to its longest label, so inlining there is exactly the widening this rule
     * exists to avoid. Anything not inlined is named in the key instead.
     */
    const inlineName = !!canInline && cells.length > 0 && cells[0].span > 1;
    return { axisKey: key, label: axis.label, shortLabel: axis.shortLabel || axis.label, inlineName, cells };
  });
}

/**
 * `{rowBands, colBands}` — one- or two-level header descriptors for `spec.rows` /
 * `spec.cols`. Word lookup goes through `axisValueWord`, the SAME table `vectorSentence`
 * reads, so a header cell's word and a popover's sentence can never drift apart into two
 * spellings of "Active".
 */
export function latticeHeaders(spec) {
  const axisMap = Object.fromEntries(spec.axes.map((a) => [a.key, a]));
  const rowBands = bandLevels(spec.rows, axisMap, false);
  const colBands = bandLevels(spec.cols, axisMap, true);
  return {
    rowBands,
    colBands,
    /**
     * What the grid does NOT say inline, for the corner key — the row axes always, and any
     * column axis whose band was too narrow to hold its own name. Nothing is listed twice:
     * between the inline names and this key, every axis is named exactly once.
     */
    key: {
      rows: rowBands.map((b) => b.shortLabel),
      cols: colBands.filter((b) => !b.inlineName).map((b) => b.shortLabel),
    },
  };
}

// --------------------------------------------------------------------------- vectorSentence

/**
 * The ONLY place an axis value's word (e.g. `"ACTIVE"` → `"Active"`) is spelled out for
 * display. `latticeHeaders` (via `axisValueWord` below) and `vectorSentence` both read this
 * one table, so a future axis value can never read correctly in a header and wrong in a
 * sentence, or vice versa, because there is exactly one place to update.
 */
const AXIS_VALUE_WORDS = {
  exploitation: { ACTIVE: "Active", SUSPECTED: "Suspected", UNKNOWN: "Unknown" },
  impact: { TOTAL: "Total", PARTIAL: "Partial" },
  exposure: { OPEN: "Open", CONTROLLED: "Controlled", UNVERIFIED: "Unverified" },
  mission: { HIGH: "High", MEDIUM: "Medium", LOW: "Low" },
  capability: { BROAD: "Broad", SCOPED: "Scoped", MINIMAL: "Minimal" },
  containment: { WEAK: "Weak", PARTIAL: "Partial", STRONG: "Strong" },
  consequence: { SEVERE: "Severe", MODERATE: "Moderate", LIMITED: "Limited" },
};

function axisValueWord(axisKey, value) {
  const table = AXIS_VALUE_WORDS[axisKey];
  return (table && table[value]) || String(value);
}

/**
 * A full vector in words — e.g. `"Exploitation Active, technical impact Total, system
 * exposure Open, mission High"` — walking `spec.axes` in their declared order, axis LABEL
 * then VALUE word, comma-joined. Only the first axis label keeps its natural capital; every
 * later one is lower-cased at its first letter so the sentence reads as one clause instead
 * of a list of capitalised fragments ("Exploitation Active, Technical impact Total, ..."
 * reads as four sentence fragments; the lower-cased join reads as one). This is the
 * accessible name a lattice cell's `aria-label` is built from and the heading a
 * click-to-inspect popover uses — see `paintCells`'s own header for the cell-level
 * "changed / count" fragment that gets appended to it, and this file's own top comment for
 * why the axis→word mapping lives in exactly one table.
 */
export function vectorSentence(spec, vector) {
  return spec.axes
    .map((axis, i) => {
      const label = i === 0 ? axis.label : axis.label.charAt(0).toLowerCase() + axis.label.slice(1);
      return `${label} ${axisValueWord(axis.key, vector[axis.key])}`;
    })
    .join(", ");
}

// ------------------------------------------------------------------------------ paintCells

// Byte-for-byte the same mapping `ui/outcome.js`'s OUTCOME_META and `ui/posture.js`'s
// TIER_META carry — see this file's top comment for why it is duplicated rather than
// imported. `word` matches those modules' own labels exactly (so an aria-label built from
// this table reads identically to a badge built from theirs); `glyph` is new to this file —
// a short in-cell mark for a 34px-tall grid square (lattice.css's `.lat-cell__mark`) where
// the full word does not fit next to the leaf's occupancy count. TRACK_STAR keeps its
// asterisk in the glyph, same as `outcomeBadge`'s "Track*" label does, so the same shape
// reads the same way at both sizes. The asterisk is CISA's own notation for "may require
// closer monitoring" — ui/outcome.js carries the provenance and the definitions.
const TONE_BY_OUTCOME = {
  ACT: { tone: "rank4", word: "Act", glyph: "ACT" },
  ATTEND: { tone: "rank3", word: "Attend", glyph: "ATT" },
  TRACK_STAR: { tone: "rank2", word: "Track*", glyph: "TR*" },
  TRACK: { tone: "rank1", word: "Track", glyph: "TRK" },
};
const TONE_BY_TIER = {
  4: { tone: "rank4", word: "Tier 4", glyph: "T4" },
  3: { tone: "rank3", word: "Tier 3", glyph: "T3" },
  2: { tone: "rank2", word: "Tier 2", glyph: "T2" },
  1: { tone: "rank1", word: "Tier 1", glyph: "T1" },
};

/**
 * The tone/word/glyph triple for one outcome or tier key, for callers that hold a key
 * rather than a decision — the outcome-mass strip, whose segments come from a coverage
 * tally and never from a per-vector decision. Reads the SAME two tables `toneOf` does, so
 * a strip segment and the cells it summarises can never disagree about which of the four
 * pill kinds an outcome wears.
 */
export function toneForKey(key) {
  return TONE_BY_OUTCOME[key] || TONE_BY_TIER[key] || null;
}

/** `decideProblem`'s `{outcome,...}` or `decidePosture`'s `{tier,...}` → the tone/word/glyph triple. */
function toneOf(decideResult) {
  return "outcome" in decideResult ? TONE_BY_OUTCOME[decideResult.outcome] : TONE_BY_TIER[decideResult.tier];
}

/**
 * A comparable "how bad" rank for a decide result, LOWER IS WORSE — `OUTCOME_VALUES`'s own
 * worst-first order for an outcome, and `4 - tier` for a posture tier (so tier 4, the worst
 * tier, ranks 0, the same worst-is-0 convention the outcome side already uses). Only used to
 * pick a `"better"` / `"worse"` direction in `"change"` / `"impact"` mode — never surfaced
 * on its own, and never used to average or sum anything (see decideMirror.js's own header
 * for why an ordinal rank must never be treated as an interval-scaled number).
 */
function rankOf(decideResult) {
  return "outcome" in decideResult ? OUTCOME_VALUES.indexOf(decideResult.outcome) : 4 - decideResult.tier;
}

function readOccupancy(occupancy, occupancyKnown, key) {
  if (!occupancyKnown) return { count: null, hatched: false, unmeasured: true };
  const count = (occupancy && occupancy[key]) || 0;
  return { count, hatched: count === 0, unmeasured: false };
}

function compareDecide(current, saved) {
  const currentValue = "outcome" in current ? current.outcome : current.tier;
  const savedValue = "outcome" in saved ? saved.outcome : saved.tier;
  if (currentValue === savedValue) return { changed: false, direction: null };
  return { changed: true, direction: rankOf(current) < rankOf(saved) ? "worse" : "better" };
}

function ariaFor(mode, meta, cell) {
  const parts = [meta.word];
  if (mode === "landscape" || mode === "impact") {
    parts.push(cell.unmeasured ? "not yet measured" : `${cell.count} ${cell.count === 1 ? "asset" : "assets"}`);
  }
  if (mode === "change" || mode === "impact") {
    parts.push(cell.changed ? `changed, ${cell.direction}` : "unchanged");
  }
  if (mode === "rule") {
    parts.push(cell.ruleIndex === -1 ? "fallback rule" : `rule ${cell.ruleIndex + 1}`);
  }
  return parts.join(", ");
}

/**
 * Pure paint descriptors for `latticeCells(spec)`'s output — no DOM, no CSS class strings,
 * just the four facts a renderer needs (`tone`, and the mode-specific extras) plus an
 * `aria` fragment. `tone` is ALWAYS one of the four existing `.pill` kinds —
 * `"bad"|"warn"|"neutral"|"ok"` — the exact mapping `ui/outcome.js` and `ui/posture.js`
 * already use for ACT/ATTEND/TRACK_STAR/TRACK and tiers 4..1. Do not invent a fifth
 * palette; if a future mode needs to say something a tint cannot, that is what `hatched`,
 * `unmeasured`, `changed` and `direction` are already for.
 *
 * `opts.decide(vector)` is required in every mode — it is what makes this a projection of a
 * RULE (typically `decideProblem` / `decidePosture` from decideMirror.js, bound to a draft
 * or saved rule), never a re-decision of anything: this function paints whatever `decide`
 * says, and never inspects a rule's rows itself.
 *
 * Four modes, and exactly the fields each one actually populates (every field is always
 * present on every cell; the ones a mode has nothing to say about hold their default):
 *
 *   "rule"     — tone/word/glyph/ruleIndex from `decide` alone. What THIS rule, with no
 *                landscape behind it, would do to every leaf. `count` stays null: this mode
 *                counts nothing, on purpose — a "how many leaves" number belongs to
 *                `leafCoverage`/`cellCoverage`, not to a per-cell paint.
 *   "landscape"   — adds `count` / `hatched` / `unmeasured` from `opts.occupancy`, read
 *                through `opts.occupancyKnown`. Three states, not two: `occupancyKnown ===
 *                false` means no preview has landed at all (`unmeasured: true`, `count:
 *                null`); a landed preview with nothing in this leaf is `count: 0, hatched:
 *                true`; anything else is a real, printed count. "Not measured yet" and
 *                "zero" are different claims and this mode is the reason this file exists
 *                to keep them apart — see lattice.css's own "a ledger, not a heat map"
 *                header for why landscape counts are the one place a quantity appears at all.
 *   "change"   — adds `changed` / `direction` by comparing `opts.decide(vector)` (the
 *                draft) against `opts.savedDecide(vector)` (the last-saved rule). `count`
 *                stays null — this mode answers "did the OUTCOME move", not "how many real
 *                assets sit here"; that combination is "impact" below.
 *   "impact"   — both of the above at once: which leaves have real occupancy AND would move
 *                under the draft. This is the "what would actually change if I saved this"
 *                view — a cell can be `changed` with zero `count` (the rule would move that
 *                leaf, nothing lives there today) or have a real `count` and be unchanged;
 *                only the intersection is the set an operator needs to react to before
 *                saving, and this mode is what lets a caller compute that intersection
 *                without re-deciding anything itself.
 */
export function paintCells(cells, opts) {
  const { mode, decide, savedDecide, occupancy, occupancyKnown } = opts;
  return cells.map((cell) => {
    const result = decide(cell.vector);
    const meta = toneOf(result);

    const painted = {
      key: cell.key,
      tone: meta.tone,
      word: meta.word,
      glyph: meta.glyph,
      count: null,
      ruleIndex: result.matchedRuleIndex,
      hatched: false,
      unmeasured: false,
      changed: false,
      direction: null,
    };

    if (mode === "landscape" || mode === "impact") {
      const occ = readOccupancy(occupancy, occupancyKnown, cell.key);
      painted.count = occ.count;
      painted.hatched = occ.hatched;
      painted.unmeasured = occ.unmeasured;
    }

    if (mode === "change" || mode === "impact") {
      const cmp = compareDecide(result, savedDecide(cell.vector));
      painted.changed = cmp.changed;
      painted.direction = cmp.direction;
    }

    painted.aria = ariaFor(mode, meta, painted);
    return painted;
  });
}

// ------------------------------------------------------------------------------ icicleLayout

/**
 * Nested band rects for the icicle view (lattice.css's `.lat-icicle`), as ONE COLUMN per
 * axis in `spec.axes` order plus one more column for the outcome/tier swatches — computed
 * as fractions of the unit square and then scaled by `width`/`height`, so a caller wanting
 * raw fractions can simply pass `1, 1`. Columns are equal width
 * (`width / (axes.length + 1)`); within a column, a band's HEIGHT is `1 / N` of its
 * parent's height, where `N` is that axis's own cardinality — because every branch of this
 * tree has the same children regardless of its parent (a fixed axis value list, not a
 * weighted/observed count), a perfectly balanced partition is not an approximation of the
 * "real" icicle algorithm, it computes the identical result an area-weighted one would,
 * with none of the accumulated rounding.
 *
 * Every band's `path` is the ordered list of `{key, value}` pairs that reach it from the
 * root — the general-purpose way to describe a node at ANY depth, aggregate or leaf alike.
 * Only bands whose `path` already names every axis (the LAST axis's own column, and the
 * outcome column one step past it — both are, by construction, one full vector) additionally
 * carry `vector` and `key` (via `spec.keyOf`), so a caller can align a `paintCells` result
 * to the matching outcome-column swatch by key alone, with no positional assumptions. An
 * aggregate band (any earlier column) carries `vector: null, key: null` — it groups several
 * leaves, and has no single vector or key of its own to report.
 *
 * `bands` at any single level (all bands sharing the same `level`) partition `[0, height]`
 * exactly, with no gaps or overlaps — true by induction from the same property holding one
 * level up, down to the root's single band covering the whole height — and the same holds
 * column-wise: each band's own `x`/`w` exactly abuts its column neighbours across `[0,
 * width]`. `test/lattice.test.js` checks both directly rather than trusting the argument.
 */
export function icicleLayout(spec, width, height) {
  const axes = spec.axes;
  const levels = axes.length + 1; // + the outcome/tier column
  const colW = width / levels;

  const bands = [];

  function descend(levelIdx, y0, y1, path) {
    if (levelIdx === axes.length) {
      const vector = Object.fromEntries(path.map((p) => [p.key, p.value]));
      bands.push({
        level: levelIdx,
        kind: "outcome",
        axisKey: null,
        value: null,
        path,
        vector,
        key: spec.keyOf(vector),
        x: colW * levelIdx,
        y: y0,
        w: colW,
        h: y1 - y0,
      });
      return;
    }
    const axis = axes[levelIdx];
    const span = (y1 - y0) / axis.values.length;
    axis.values.forEach((value, i) => {
      const by0 = y0 + i * span;
      const by1 = by0 + span;
      const nextPath = [...path, { key: axis.key, value }];
      const isLeafColumn = nextPath.length === axes.length;
      const vector = isLeafColumn ? Object.fromEntries(nextPath.map((p) => [p.key, p.value])) : null;
      bands.push({
        level: levelIdx,
        kind: "axis",
        axisKey: axis.key,
        value,
        path: nextPath,
        vector,
        key: vector ? spec.keyOf(vector) : null,
        x: colW * levelIdx,
        y: by0,
        w: colW,
        h: by1 - by0,
      });
      descend(levelIdx + 1, by0, by1, nextPath);
    });
  }
  descend(0, 0, height, []);

  return { width, height, bands };
}

// -------------------------------------------------------------------------- outcomeMass

/**
 * The whole lattice's outcome (or tier) distribution, against a ceiling — the same
 * arithmetic `problemRule.validateProblemRule` runs for its ACT-share check and
 * `postureRule.validatePostureRule` runs for its tier-4 share, generalised over which band
 * is being ceilinged instead of hardcoding ACT or tier 4.
 *
 * `coverage` is a tally map keyed by outcome or tier value — `leafCoverage(rule).byOutcome`
 * or `cellCoverage(rule).byTier` from decideMirror.js, or the equivalent from a server
 * preview response. `order` is the FULL, worst-first list of every value the tally can hold
 * — `OUTCOME_VALUES` as-is for the problem tree, or `[4, 3, 2, 1]` for posture (TIER_VALUES
 * itself is ascending; the caller reverses it once, the same way aars.js's own
 * `TIER_OPTIONS` already lists tiers worst-first for display). `order[0]` is always the band
 * the ceiling applies to — ACT is `OUTCOME_VALUES[0]`, and passing `[4,3,2,1]` puts tier 4
 * in that same slot — so this function never needs to be told separately which key is
 * "the top band"; the same worst-first list callers already build for display doubles as
 * the answer.
 *
 * `total` is the sum of `coverage` over `order` rather than a separately-passed field,
 * because `order` is already guaranteed (by both `leafCoverage` and `cellCoverage`) to name
 * every value the tally can hold — summing it IS `coverage.total` by construction, and
 * computing it here rather than trusting a caller-supplied total means a mismatched
 * `coverage`/`order` pairing fails by producing an obviously wrong share, not a hidden bug.
 */
export function outcomeMass(coverage, order, ceiling) {
  const total = order.reduce((sum, k) => sum + (coverage[k] || 0), 0);
  const segments = order.map((k) => {
    const count = coverage[k] || 0;
    return { key: k, count, share: total ? count / total : 0 };
  });
  const worstKey = order[0];
  const worstCount = coverage[worstKey] || 0;
  const worstShare = total ? worstCount / total : 0;
  const over = worstShare > ceiling;
  const pct = (share) => `${(share * 100).toFixed(1)}%`;
  const sentence =
    `${worstKey} claims ${worstCount} of ${total} (${pct(worstShare)}), ` +
    `against a ceiling of ${pct(ceiling)}.`;

  return { segments, ceilingShare: ceiling, over, sentence };
}
