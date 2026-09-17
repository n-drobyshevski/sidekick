// Countable quantity, drawn as countable marks — Neurath's rule, in two layouts.
//
// WHAT IT REPLACES. The density wave's finding was that these registers are correct and wordy;
// this module names the part of that which is neither a caveat nor a definition, but a COUNT
// written out as a sentence. Three shapes recur across all three registers: "632 (77%)" in a
// table cell, "27 open, was 36" beside a pill, and "N re-rated by the amplifier · M outside the
// four patterns · K in progress" under a hero. Each is a part-to-whole fact the reader has to
// rebuild arithmetically. Marks they can count say it at a glance, and — this is the part that
// keeps it honest — the figure stays beside them in words, so nothing here is the only carrier
// of anything.
//
// TWO LAYOUTS, ONE FILE, TWO MODELS. `unitRow` is a tally: one mark per N, laid out inline, for
// a magnitude read against the row above it. `unitGrid` is a waffle: a lattice of cells, for a
// count read against a stated whole. They share the MARK — its box, its `--ink` fill, its
// forced-colors substitution — which is why one file, and the same reason `severity.js` carries
// four exports rather than four files. They keep two models, because their failure modes are
// genuinely different: a tally goes wrong when the unit is per-row instead of per-table, a
// waffle when the cells do not sum to the lattice or the denominator is the parts' own sum.
//
// THE CLASS IS `.isotype`, AND THAT IS DELIBERATE. `gas_devsecops`'s Executive page shipped the
// first one of these, and `gas_devsecops/dev/densityModel.mjs`'s VISUAL_PREDICATES already
// counts `hasClass("isotype")` as a picture. Naming this module's wrapper anything else would
// have meant editing the measuring instrument in the same wave that uses it to prove a change —
// a before-column and an after-column measured by two different rulers. The grid is the same
// class with a modifier for that reason and no other, and it is why this package needs no edit
// to the walker at all.
//
// WHERE THIS FORM STOPS WORKING, stated because the ladder below encodes it: a reader counts
// marks accurately up to roughly seven, tolerably to a dozen, and not at all past forty — past
// that the row is a bar with its axis deleted. `unitScale` picks the finest unit that keeps the
// biggest row inside MAX_MARKS, and a population too large for the finest rung gets a coarser
// one rather than a truncated row. A partial mark is CLIPPED, never scaled: two halves of a
// scaled glyph do not add to a whole, and a mark of a different size is a different unit a
// reader would be counting alongside the first. This is also why the marks are plain rectangles
// and not pictograms of the thing counted — PRODUCT.md's anti-references rule out the
// illustration, and the arithmetic rules out the asymmetric glyph independently.
//
// A TALLY IS THE WRONG PICTURE FOR A SPAN OF ORDERS OF MAGNITUDE, and the module refuses rather
// than fakes it. A rung of 30 against an open backlog of 200,000 rounds to zero tenths, so
// `unitRow` returns `null` and the caller draws nothing. That is correct: the honest encoding of
// a continuous share of one denominator is a proportional bar with a minimum-width floor, which
// `gas`'s triage funnel already has. DO NOT add a `minMark` option to make such a caller work —
// a mark drawn below the resolution of its own unit is not a measurement, and an option that
// draws one is a licence to lie in exactly the register that must not.
//
// ABSENT IS NEVER ZERO. A count nobody measured is `absentText`, contributes no cells and no
// share, and draws nothing — a filled cell for an unmeasured population is the same confident
// zero these registers suppress everywhere else, except in picture form, which is harder to
// argue with. Every refusal below happens BY TYPE, BEFORE any cast, for the reason CLAUDE.md
// has now recorded four times: `Number(null)`, `Number("")`, `Number([])` and `Number(false)`
// are all `0` and all finite, and `Number(["3"])` is `3`.
//
// SHARES ARE READ AGAINST THE STATED TOTAL, never against the sum of the segments. Those are
// the same number only when the segments partition the population, and every register here has
// a population they do not partition — gas_ai's out-of-scope assets, gas's unattributable rows,
// gas_devsecops's unobserved repositories. Renormalising would quietly promote a three-quarters
// share to a whole one. Segments summing PAST the stated total throws, because that is a caller
// bug (two overlapping populations read as one partition) whose only silent outcomes are a
// truncated category or a meaningless grid.
//
// TWO NON-COLOUR CHANNELS, NOT ONE. `data-tone` paints a segment neutral/ok/warn/bad; `data-fill`
// gives it a SILHOUETTE — solid, ring, or hatch. Two adjacent segments therefore differ by shape
// as well as by fill, which is DESIGN.md's "pair every severity or status colour with a text,
// icon, dot, or shape cue" applied INSIDE the picture rather than only in the key beneath it.
// PRODUCT.md is explicit that the red/orange/amber proximity makes the redundant cue
// load-bearing rather than decorative. Four tones by three fills is twelve distinguishable
// segment styles and zero new colour tokens.
//
// SEVERITY-FREE, the same way `quad.js` is. Nothing here names a severity, imports
// `severity.js` or emits a `sev*` class, and a tone outside the four is refused — so a severity
// distribution structurally cannot be smuggled through this module. `gas_devsecops`'s secrets
// page is gated against a severity axis in its executable code, and a shared component is
// exactly the back door such a gate cannot see through. A severity distribution already has a
// component: `sevSegmentBar` plus `sevKeyRow`.
//
// NOTHING ANIMATES, so no `prefers-reduced-motion` alternative is owed — the same line
// `sparkline.js` carries, for the same reason.

import { el } from "./dom.js";
import { absentText, fmtCount, pct1 } from "./figures.js";

/**
 * The default ladder — the one `gas_devsecops`'s Executive shipped, kept as the default so that
 * page's picture is unchanged by this module's arrival.
 *
 * It starts at 10 because a register counts findings in the hundreds and thousands; a finer
 * rung would draw forty marks for forty findings and nothing readable for four thousand.
 */
export const COUNT_UNITS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/**
 * The ladder for a population a reader could plausibly enumerate — frameworks, scan areas,
 * repositories in a team. One mark per item is the whole point at this size, and the coarse
 * ladder above would draw a single tenth-clipped mark for all of them.
 *
 * Named rather than derived: which ladder a table is on is a claim about what its rows count,
 * and that is the caller's to make, not this module's to guess.
 */
export const FINE_UNITS = [1, 2, 5, 10, 20, 50, 100];

/** Past this many marks a row is a bar with its axis deleted. See the header. */
export const MAX_MARKS = 40;

/** A waffle's default lattice: 10x10, so one cell is one percentage point. */
export const GRID_CELLS = 100;

/**
 * The ceiling on `cells: "exact"`. Above this, one-cell-per-member is a promise nobody can keep
 * — the reader cannot count 200 cells, and a grid that looks countable and is not is worse than
 * one that never claimed to be.
 */
export const MAX_EXACT_CELLS = 144;

/** The tone vocabulary, byte-identical to `quad.js`'s. A fifth tone would be a severity. */
export const TONES = ["neutral", "ok", "warn", "bad"];

/** The silhouette vocabulary. `hatch` carries `--hatch`'s own meaning: not a measurement. */
export const FILLS = ["solid", "ring", "hatch"];

/**
 * Six, because `--chart-cat-1..5` plus `--chart-cat-other` is the bound the design system has
 * already reserved for a categorical set, and because a reader cannot hold more than that many
 * keys against one lattice.
 */
export const MAX_SEGMENTS = 6;

/**
 * The unit, chosen ONCE PER TABLE — the smallest rung of `units` that keeps `max` inside
 * `maxMarks`.
 *
 * A row's marks are readable against the row above it only if both count in the same unit, so
 * the unit is a property of the TABLE and never of a row. Two tidier-looking alternatives are
 * both wrong and worth naming: a per-row unit makes 280 and 30 draw the same picture, which is
 * a bar chart with the axis deleted; a cap truncates the largest row, which is the one most
 * worth reading.
 *
 * A non-finite or non-positive maximum falls back to the finest rung rather than throwing —
 * with no rows to size against there is nothing to compare, and every caller draws no marks for
 * such a row anyway. The fallback is reached because the input was REFUSED, not because a cast
 * invented a zero.
 *
 * @param {unknown} max     the largest count in the table
 * @param {{units?: number[], maxMarks?: number}} opts
 * @returns {number} one rung of the ladder
 */
export function unitScale(max, opts = {}) {
  const { units, maxMarks = MAX_MARKS } = opts;
  const ladder = Array.isArray(units) && units.length ? units : COUNT_UNITS;
  const ceiling = typeof maxMarks === "number" && Number.isFinite(maxMarks) && maxMarks > 0
    ? maxMarks
    : MAX_MARKS;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return ladder[0];
  for (const unit of ladder) {
    if (max / unit <= ceiling) return unit;
  }
  return ladder[ladder.length - 1];
}

/**
 * How many whole marks, and how much of one more.
 *
 * The remainder is drawn as a mark clipped to its TENTHS rather than as a smaller mark — see
 * the header on why a differently sized mark is a second unit. Ten tenths is a whole mark, so a
 * remainder rounding up to 10 carries into `full` rather than drawing a "partial" nobody could
 * tell from a whole one.
 *
 * @param {unknown} n     the count to draw
 * @param {unknown} unit  items per mark
 * @returns {{full: number, partialTenths: number}}
 */
export function unitCounts(n, unit) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    return { full: 0, partialTenths: 0 };
  }
  if (typeof unit !== "number" || !Number.isFinite(unit) || unit <= 0) {
    return { full: 0, partialTenths: 0 };
  }
  const full = Math.floor(n / unit);
  const tenths = Math.round((10 * (n % unit)) / unit);
  return tenths >= 10
    ? { full: full + 1, partialTenths: 0 }
    : { full, partialTenths: Math.max(0, tenths) };
}

function refuse(message) {
  throw new Error("unitChartModel: " + message);
}

/**
 * The part-to-whole model behind `unitGrid`.
 *
 * `unit` is REQUIRED and throws without it. "findings" is right in `gas` and `gas_devsecops` and
 * wrong in `gas_ai`; "repositories" is right on one page of one register and wrong on every
 * other. It is the same refusal `severitySplitModel`'s own `unit`, `diagnostics.js`'s
 * `missingTone` and `appConfig()` already use for a word that is never safe to guess, and for
 * the same reason: a default would put one register's noun under another register's figure and
 * never say so.
 *
 * A segment with no `label` is REFUSED, not drawn. Colour and silhouette are the second and
 * third cues and never the first; a cell whose only meaning is its fill is invisible in review
 * and invisible on a screenshot, which is why this is a throw and not a lint.
 *
 * TWO MODES, AND THE MODE IS THE HONESTY.
 *   `cells: "exact"` — one cell per member, no rounding at all. The grid is a CENSUS. Throws
 *                      above MAX_EXACT_CELLS rather than silently becoming an approximation.
 *   `cells: <n>`     — a fixed lattice (default 100). The grid is a PROPORTION, and
 *                      `model.rounded` plus the aria sentence say so.
 *
 * THE ROUNDING POLICY IS STATED, not left for a reader to infer. Cells are allocated by largest
 * remainder so the lattice sums exactly; then any segment with a real count that rounded to zero
 * cells is given one, taken from the largest segment, because a present-but-small population
 * drawn as nothing reads as absent — `sparkline.js`'s cast-first defect in grid form.
 *
 * @param {{segments: Array, total: unknown, unit: string, cells?: number|"exact",
 *          remainderLabel?: string}} spec
 */
export function unitChartModel(spec) {
  const {
    segments, total, unit, cells = GRID_CELLS, remainderLabel = "",
  } = spec || {};

  if (typeof unit !== "string" || !unit.trim()) {
    // NO BACKTICKS IN A THROWN STRING. esbuild lowers template literals, but a backtick
    // CHARACTER inside a string literal survives minification and the middlebox guard in
    // every app's esbuild.config.mjs fails the build on it — the proxy that guard replays
    // strips comments with a tokenizer that does not understand backticks and would leave
    // the bundle unbalanced. Quoting a parameter name is not worth a broken deploy.
    refuse("unit is required — what one item IS differs per register");
  }

  const rows = Array.isArray(segments) ? segments : [];
  if (rows.length > MAX_SEGMENTS) {
    refuse("at most " + MAX_SEGMENTS + " segments — a reader cannot hold more keys than that "
      + "against one lattice");
  }
  for (const s of rows) {
    if (!s || typeof s.label !== "string" || !s.label.trim()) {
      refuse("every segment needs a label — a fill is never the first cue");
    }
    if (s.tone !== undefined && !TONES.includes(s.tone)) {
      refuse("unknown tone " + JSON.stringify(s.tone) + " — a fifth tone would be a severity, "
        + "and a severity distribution has its own component");
    }
    if (s.fill !== undefined && !FILLS.includes(s.fill)) {
      refuse("unknown fill " + JSON.stringify(s.fill) + " — one of " + FILLS.join(", "));
    }
  }

  // Refused by type before any arithmetic. A `total` that is not a positive finite number is an
  // unmeasured denominator, and zero of zero is unmeasured rather than zero percent.
  const measured = typeof total === "number" && Number.isFinite(total) && total > 0;
  const whole = measured ? total : null;

  const exact = cells === "exact";
  if (exact && measured && total > MAX_EXACT_CELLS) {
    refuse("cells: exact over " + fmtCount(total) + " " + unit + " — one cell per member "
      + "stops being countable past " + MAX_EXACT_CELLS + "; state a lattice size instead");
  }
  const lattice = exact
    ? (measured ? Math.round(total) : 0)
    : (typeof cells === "number" && Number.isFinite(cells) && cells > 0
      ? Math.floor(cells)
      : GRID_CELLS);

  const built = rows.map((s) => {
    const counted = typeof s.count === "number" && Number.isFinite(s.count) && s.count >= 0;
    const share = counted && measured ? (s.count / whole) * 100 : null;
    return {
      key: s.key || s.label,
      label: s.label,
      tone: s.tone || "neutral",
      fill: s.fill || "solid",
      count: counted ? s.count : null,
      countText: counted ? fmtCount(s.count) : absentText,
      share,
      shareText: share === null ? absentText : pct1(share),
      cells: 0,
    };
  });

  // Overlapping populations read as one partition is a caller bug with no silent outcome worth
  // having: either a category is truncated or the grid means nothing. See the header.
  const counted = built.reduce((a, b) => a + (b.count === null ? 0 : b.count), 0);
  if (measured && counted > whole) {
    refuse("segments sum to " + fmtCount(counted) + " against a stated total of "
      + fmtCount(whole) + " — these populations overlap, so they are not a part-to-whole");
  }

  let rounded = false;
  if (measured && lattice > 0) {
    // Largest remainder: floor every share, then hand the leftover cells to the segments with
    // the biggest discarded fractions. A naive round-each-then-sum both overshoots the lattice
    // (a hole, which reads as an unmeasured remainder) and rounds a small-but-real segment to
    // nothing (a measured category drawn as absent).
    const want = built.map((b) => (b.count === null ? 0 : (b.count / whole) * lattice));
    const floors = want.map((v) => Math.floor(v));
    let used = floors.reduce((a, b) => a + b, 0);
    const byFraction = want
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    let k = 0;
    while (used < lattice && k < byFraction.length) {
      const { i, frac } = byFraction[k];
      if (built[i].count !== null && frac > 0) { floors[i] += 1; used += 1; rounded = true; }
      k += 1;
    }
    built.forEach((b, i) => { b.cells = floors[i]; });

    for (const b of built) {
      if (b.count !== null && b.count > 0 && b.cells === 0) {
        const donor = built.reduce((m, c) => (c.cells > (m ? m.cells : 0) ? c : m), null);
        if (donor && donor.cells > 1) { donor.cells -= 1; b.cells = 1; rounded = true; }
      }
    }
  }

  const filled = built.reduce((a, b) => a + b.cells, 0);
  const restCells = Math.max(0, lattice - filled);
  const restCount = measured ? Math.max(0, whole - counted) : null;
  const remainder = restCells > 0
    ? {
      cells: restCells,
      count: restCount,
      countText: restCount === null ? absentText : fmtCount(restCount),
      label: remainderLabel || "not accounted for",
    }
    : null;

  const spoken = built
    .map((b) => b.label + " " + b.countText + (b.share === null ? "" : " (" + b.shareText + ")"))
    .join(", ");
  const restSpoken = remainder ? ", " + remainder.label + " " + remainder.countText : "";
  const aria = measured
    ? "Of " + fmtCount(whole) + " " + unit + ": " + (spoken || "nothing counted") + restSpoken
      // NO SINGULARISATION. `unit` is the caller's own word and this module does not speak its
      // language: stripping a trailing "s" turned "repositories" into "repositorie" on the very
      // first render, and English is not the only way that guess fails. Phrasing it so the
      // plural stays plural costs nothing and cannot be wrong.
      + (exact ? ". Each cell is one of the " + unit + "."
        : rounded ? ". Cells are rounded to the nearest whole cell." : "")
    : "Not measured: no " + unit + " counted, so no share is drawn.";

  return {
    segments: built, remainder, total: whole, unit, measured, exact,
    filled, cells: lattice, rounded, aria,
  };
}

/**
 * The tally — `value` as marks, one per `unit`, as ONE `role="img"`.
 *
 * One node, not N. A screen reader walking forty empty spans learns nothing the label does not
 * already say, and says it forty times. The label carries the figure and the unit, so the
 * picture is never the only carrier; the caller keeps printing the number beside it, which is
 * what the marks are a second encoding OF.
 *
 * Returns `null` — draws nothing at all — where there is nothing to draw: a refused count, a
 * refused unit, or a count below one tenth of a mark. A caller appending `null` gets no node,
 * which is the correct picture for "not measured" and for "below this table's resolution".
 *
 * @param {unknown} value
 * @param {{unit: number, noun?: string, label?: string, className?: string}} opts
 * @returns {HTMLElement|null}
 */
export function unitRow(value, opts = {}) {
  const { unit, noun = "", label = "", className = "" } = opts;
  const { full, partialTenths } = unitCounts(value, unit);
  if (full === 0 && partialTenths === 0) return null;

  const marks = [];
  for (let i = 0; i < full; i++) marks.push(el("span", { class: "isotype-mark" }));
  if (partialTenths > 0) {
    marks.push(el("span", {
      class: "isotype-mark isotype-mark--part",
      style: "--tenths:" + partialTenths,
    }));
  }
  return el("span", {
    class: className ? "isotype " + className : "isotype",
    role: "img",
    "aria-label": label || (fmtCount(value) + (noun ? " " + noun : "")
      + ", one mark per " + fmtCount(unit)),
  }, ...marks);
}

/**
 * The waffle — a `unitChartModel` as a lattice, as ONE `role="img"`.
 *
 * The remainder cells are drawn EMPTY and named in the label; a segment the caller knows is a
 * coverage gap passes `fill: "hatch"` and gets a label like every other segment. Collapsing the
 * two would make "not measured" indistinguishable from "measured, and in none of these".
 *
 * Draws no lattice at all when the denominator was never measured — an empty 10x10 grid is a
 * picture of zero, and zero of zero is not zero.
 *
 * @param {ReturnType<typeof unitChartModel>} model
 * @param {{className?: string, caption?: Node|string}} opts
 */
export function unitGrid(model, opts = {}) {
  const { className = "", caption = null } = opts;
  const wrap = el("div", { class: className ? "isotype-wrap " + className : "isotype-wrap" });
  if (!model || !model.measured || model.cells <= 0) {
    wrap.append(el("p", { class: "small muted" }, model ? model.aria : absentText));
    return wrap;
  }

  // THE LATTICE'S SHAPE AND ITS CELL SIZE ARE BOTH FUNCTIONS OF HOW MANY CELLS THERE ARE, and
  // both are written as instance custom properties the way `--tenths` is — a lattice width is a
  // property of one picture, not of the design system, so neither belongs in tokens.base.css.
  //
  // A SMALL CENSUS IS A STRIP, A LARGE ONE IS A BLOCK. Eleven repositories laid out as a 4x3
  // lump reads as a shape to decode; eleven in a row reads as eleven things, which is the whole
  // reason exact mode exists. Past ROW_MAX a row stops being countable and a square block is the
  // better form — that is also where `cells` is a proportion rather than a census.
  //
  // AND A CELL THAT IS ONE OF ELEVEN CAN AFFORD TO BE BIGGER THAN ONE OF A HUNDRED. 9px is sized
  // for a 10x10 waffle, where the block is the figure; at eleven cells it renders a census as a
  // smudge in the corner of its own card (measured on the shipped page before this rule).
  //
  // THAT RULE STOPPED AT ROW_MAX AND LEFT A CLIFF BEHIND IT. Twenty-four cells drew a 318px
  // strip; twenty-five drew a 53px square, because one cell over the edge fell back to BOTH the
  // square shape and the 9px waffle cell. A census does not stop being a census at 25 — thirty
  // assets rendered as a 64px smudge in a 704px card, which is the very defect the rule above
  // was written to fix, one size class along. So the two knobs part company here:
  //
  //   SHAPE — a block is as FLAT as ROW_MAX allows: as few rows as will hold it, balanced
  //   across them. It replaces a square, and the square was never carrying what it looked like
  //   it carried. ONE CELL IS ONE PERCENTAGE POINT IN A PROPORTION WHATEVER THE SHAPE IS — only
  //   the COLUMN COUNT changes what a ROW reads as, from a tenth to a fifth, and a fifth is no
  //   harder to read than a tenth. What a square does carry is its own height: a lattice that
  //   fills the width of a card fills that much height too, and 10x10 at a size worth looking
  //   at is a banner. Flat is the shape that can grow sideways without growing down. For a
  //   CENSUS the shape carried nothing to begin with, and rows a reader can scan beat a lump
  //   they have to decode.
  //
  //   SIZE — the floor is the one thing that still knows the two modes apart, and it is doing
  //   real work: a proportion has more columns (20 for a hundred cells) than a census of the
  //   same block, so it keeps the waffle's 9px where a census keeps the strip's 14px. Twenty
  //   columns at 14px is 318px and does not fit a 360px card; at 9px it is 218px and does.
  //   From that floor `isotype--block` lets the stylesheet grow the cell to the width on offer.
  //   The column count is a decision about the picture and stays here; how much room those
  //   columns are given is a fact about the viewport, and CSS is the only one of the two that
  //   can see it.
  const ROW_MAX = 24;
  const block = model.cells > ROW_MAX;
  const rows = block ? Math.ceil(model.cells / ROW_MAX) : 1;
  const cols = block ? Math.ceil(model.cells / rows) : model.cells;
  const cell = block && !model.exact ? 9 : 14;
  const grid = el("div", {
    class: block ? "isotype isotype--grid isotype--block" : "isotype isotype--grid",
    role: "img",
    "aria-label": model.aria,
    style: "--isotype-cols:" + cols + ";--isotype-cell:" + cell + "px",
  });
  for (const seg of model.segments) {
    for (let i = 0; i < seg.cells; i++) {
      grid.append(el("span", {
        class: "isotype-cell", "data-seg": seg.key, "data-tone": seg.tone, "data-fill": seg.fill,
      }));
    }
  }
  if (model.remainder) {
    for (let i = 0; i < model.remainder.cells; i++) {
      grid.append(el("span", { class: "isotype-cell isotype-cell--empty" }));
    }
  }
  wrap.append(grid);
  if (caption) {
    wrap.append(typeof caption === "string"
      ? el("p", { class: "isotype-caption small muted" }, caption)
      : caption);
  }
  return wrap;
}

/**
 * The key row — label, count and share for every segment, in real DOM text beneath the grid.
 *
 * THIS IS WHY A WAFFLE OWES NO `chartTable` DISCLOSURE. `chartTable.js` exists because a
 * `<canvas>` has no DOM to read and a Chart.js tooltip answers only a pointer, so the figures
 * are literally unreachable. A waffle's figures are never only in the grid: this row prints
 * every one of them on the surface, and `unitChartModel` refuses a segment with no label, so
 * there is no configuration in which the lattice is the sole carrier. That is `splitBar`'s
 * caption argument and `sevKeyRow`'s key-row argument, and it is stronger than the canvas case
 * because the numbers are beside the picture rather than one disclosure down.
 *
 * @param {ReturnType<typeof unitChartModel>} model
 */
export function unitKeyRow(model) {
  const row = el("div", { class: "isotype-keys" });
  if (!model) return row;
  for (const seg of model.segments) {
    row.append(el("span", { class: "isotype-key" },
      el("span", {
        class: "isotype-key-swatch", "aria-hidden": "true",
        "data-tone": seg.tone, "data-fill": seg.fill,
      }),
      el("span", { class: "isotype-key-label" }, seg.label),
      el("span", { class: "isotype-key-num num" }, seg.countText),
      seg.share === null ? null : el("span", { class: "isotype-key-share small muted" },
        seg.shareText)));
  }
  if (model.remainder) {
    row.append(el("span", { class: "isotype-key" },
      el("span", { class: "isotype-key-swatch isotype-key-swatch--empty", "aria-hidden": "true" }),
      el("span", { class: "isotype-key-label" }, model.remainder.label),
      el("span", { class: "isotype-key-num num" }, model.remainder.countText)));
  }
  return row;
}
