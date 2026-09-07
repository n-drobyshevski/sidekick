// A 2x2 as a 2x2 — two yes/no questions crossed, and the four counts that answer them.
//
// WHAT IT REPLACES. Both registers that ask two boolean questions about the same population
// were drawing the answer as a five-column table with a prose "Reading" column: one row per
// corner, a count, a share, and a sentence explaining what that corner MEANS. That is a
// picture rendered as prose — the reader has to rebuild the cross in their head from four
// rows, and the sentences repeat the axis names four times each. A cross drawn as a cross
// says the same thing in one glance, and the sentence that was in the Reading column becomes
// the corner's `help`, one level down (DESIGN.md's ladder: the figure and the picture on the
// surface, the words behind a signifier).
//
// ABSENT IS NEVER ZERO, AND IT IS THE WHOLE REASON THE MODEL IS PURE. A corner whose count
// nobody measured is `absentText`, not `0`, and it contributes NO share — a zero in one
// corner of a 2x2 is a strong claim ("nothing is here"), and printing it over an unmeasured
// cell is exactly the substitution CLAUDE.md's `Number(null)` entries name. `figures.js`'s
// `num()` does the refusing, before any cast; nothing in this file casts.
//
// TONE NEVER TRAVELS ALONE. `data-tone` paints a corner ok / warn / bad, and DESIGN.md's
// accessibility bar is explicit that state is never carried by colour alone. So a corner
// without a `label` is REFUSED here rather than drawn — the same shape of refusal
// `appConfig()` and the diagnostics panel's `missingTone` already use, and the reason it is
// a throw and not a lint is that the defect it catches (a coloured cell whose meaning is the
// colour) is invisible in review and invisible on a screenshot.
//
// UNIT-FREE OF SEVERITY, ON PURPOSE. Nothing here names a severity level, imports
// `severity.js` or emits a `sev*` class: `gas_devsecops`'s secrets page is gated by
// `test/pagesLit.test.js` (4/7) against any severity spelling in its executable code, and
// the secrets triage cross is the first thing this module was written for. A severity axis
// crossed with anything else would be a different component.
//
// ONE DEFINITION CONTROL, ONE ACTION CONTROL, PER CORNER — never more. The corner's `label`
// is its one DEFINITION: what the cell means, carried as a `tipLabel` trigger and never as
// anything else. `quadTable`'s `cellAction` is the corner's one ACTION: what a reader can DO
// with what it counts — open the findings behind it, typically — appended after the share
// line and before the caller's own alarm chip. A fixed 2x2 stays bounded at two tab stops
// per corner (eight, worst case) whether or not a page uses the second one, which is why
// `cellAction` is additive rather than a reason to reconsider the one-control argument the
// label already made for itself.

import { el } from "./dom.js";
import { absentText, fmtCount, num, pct1 } from "./figures.js";
import { tipLabel } from "./tip.js";

/** The four corners, in the order they are drawn: row-yes first, column-yes first. */
const CORNERS = [
  { row: true, col: true },
  { row: true, col: false },
  { row: false, col: true },
  { row: false, col: false },
];

const TONES = new Set(["neutral", "ok", "warn", "bad"]);

/** The one place that decides whether a caller gave us a real word. */
function word(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * The 2x2, ordered and priced — pure, so the half that can be WRONG is the half vitest holds.
 *
 * @param {object} spec
 * @param {{label: string, yes: string, no: string}} spec.rows  the row axis: what it asks,
 *   and the two words its answers wear. "Yes"/"No" is a legal pair; a pair that says what the
 *   answer MEANS ("Out of HEAD" / "Still in HEAD") is a better one, because those two words
 *   are what a screen reader announces as the row header.
 * @param {{label: string, yes: string, no: string}} spec.cols  the column axis, same shape.
 * @param {Array<{row: boolean, col: boolean, count: *, label: string, tone?: string,
 *                alarm?: *, help?: *}>} spec.cells
 *   exactly four, one per corner, in any order. `count` is refused before any cast (null /
 *   undefined / "" / [] / false are all ABSENT, never 0). `label` is the corner's short
 *   reading and is MANDATORY on every corner. `alarm` is the caller's own chip NODE, passed
 *   through untouched — this module appends it and never builds one, because what counts as
 *   an alarm is the page's claim, not the grid's. `help` is any `tipLabel` shape and rides
 *   through to the DOM half.
 * @param {*} spec.total  the population every share is read against. Refused before the cast
 *   the same way a count is; a null or a zero total means NO corner gets a share, because a
 *   share of an unknown population is not a measurement.
 * @param {string} [spec.unit]  the noun the counts are counted in ("secrets", "findings").
 *   Appears in every corner's short text and in the aria sentence; omitted cleanly.
 * @returns {{rows, cols, unit, total, corners, aria}}
 */
export function quadModel({ rows, cols, cells, total, unit = "" }) {
  const rowAxis = axis(rows, "rows");
  const colAxis = axis(cols, "cols");
  const noun = word(unit) || "";
  const populace = num(total);

  const given = Array.isArray(cells) ? cells : [];
  const corners = CORNERS.map(({ row, col }) => {
    const hits = given.filter((c) => c && !!c.row === row && !!c.col === col);
    if (hits.length !== 1) {
      throw new Error(
        "quadModel(): expected exactly one cell for row=" + row + " col=" + col
        + ", got " + hits.length + ". A 2x2 with a missing corner draws an empty box, which"
        + " reads as a measured zero.",
      );
    }
    const cell = hits[0];
    const tone = word(cell.tone) || "neutral";
    if (!TONES.has(tone)) {
      throw new Error("quadModel(): unknown tone " + JSON.stringify(cell.tone)
        + " — one of neutral, ok, warn, bad.");
    }
    const label = word(cell.label);
    // THE PERTURBABLE GUARD. Colour is the third cue in this design system, never the first;
    // a toned corner with no word is a cell whose only meaning is its fill. Every corner
    // owes a word, toned or not — `data-tone` is written on all four, and a neutral corner
    // with only a number makes the reader rebuild the cross from the axes anyway — but the
    // toned case gets its own sentence, because that is the one where the missing word is
    // an accessibility defect rather than a legibility one.
    if (!label) {
      throw new Error(tone !== "neutral"
        ? "quadModel(): a cell with tone \"" + tone + "\" must carry a label — tone is never"
          + " the only carrier of a state."
        : "quadModel(): every cell needs a short label — a corner holding only a number"
          + " makes the reader rebuild its reading from the two axes.");
    }
    const count = num(cell.count);
    const measured = count !== null;
    const share = measured && populace !== null && populace !== 0 ? count / populace : null;
    return {
      row, col, label, tone, count, measured, share,
      alarm: cell.alarm || null,
      help: cell.help || null,
      countText: measured ? fmtCount(count) : absentText,
      shareText: share === null ? absentText : pct1(share * 100),
      text: shortText(count, populace, noun),
    };
  });

  return {
    rows: rowAxis,
    cols: colAxis,
    unit: noun,
    total: populace,
    corners,
    aria: ariaSentence(rowAxis, colAxis, corners, populace, noun),
  };
}

function axis(spec, which) {
  const label = word(spec && spec.label);
  const yes = word(spec && spec.yes);
  const no = word(spec && spec.no);
  if (!label || !yes || !no) {
    throw new Error("quadModel(): " + which + " needs a label and both answer words — the"
      + " two words are what a screen reader announces as this axis's header.");
  }
  return { label, yes, no };
}

/**
 * "12 of 40 secrets" — the corner's own short form, and the sentence a reader gets instead
 * of a bare percentage. An unmeasured corner says so in words rather than borrowing the
 * denominator it was never counted against.
 */
function shortText(count, total, unit) {
  const tail = unit ? " " + unit : "";
  if (count === null) return "not measured";
  if (total === null) return fmtCount(count) + tail;
  return fmtCount(count) + " of " + fmtCount(total) + tail;
}

/**
 * The whole grid as one sentence, every corner in words.
 *
 * Deliberately NOT rendered into the table by default — the table is already the text
 * alternative, with real `<th scope>` axes, and repeating the same four readings in a
 * visually-hidden caption would announce every figure twice. `quadTable` falls back to it
 * only when the caller supplies no short name for the table, and a page that wants the
 * sentence somewhere else (a tip, a summary line, a test reading what a reader reads) has it
 * on the model.
 */
function ariaSentence(rows, cols, corners, total, unit) {
  const head = rows.label + " against " + cols.label
    + (total === null ? "" : ", over " + fmtCount(total) + (unit ? " " + unit : ""))
    + ".";
  const parts = corners.map((c) => {
    const where = rows.label + " " + (c.row ? rows.yes : rows.no)
      + ", " + cols.label + " " + (c.col ? cols.yes : cols.no);
    const share = c.share === null ? "" : ", " + (c.share * 100).toFixed(1) + " percent";
    return where + ": " + c.label + ", " + c.text + share + ".";
  });
  return [head, ...parts].join(" ");
}

/**
 * The grid itself: a real table, because it is one.
 *
 * `<th scope="col">` / `<th scope="row">` rather than a grid of divs with an aria-label — a
 * 2x2 read cell by cell is exactly what table semantics are for, and the axis words are then
 * announced with each figure instead of the reader having to hold them.
 *
 * ONE TAB STOP PER CORNER IS ACCEPTABLE HERE, and that is a judgement about arity rather
 * than a relaxation of the rule `ui/tip.js` states: a badge repeated once per row does not
 * become a control (four hundred new stops), but a fixed grid of four corners whose readings
 * are the point does. The trigger sits on the corner's LABEL, never on its number: a
 * definition is a control, a value is not.
 *
 * `cellAction` KEEPS THAT SPLIT RATHER THAN BLURRING IT: the label stays the corner's one
 * DEFINITION control (what does this cell mean), and `cellAction` is the corner's one ACTION
 * control (do something with what it counts — open the findings behind it, typically). Two
 * tab stops per corner, eight worst case, is still bounded for a grid that is always 2x2 —
 * the same arity argument the paragraph above already makes for the label alone, extended by
 * exactly one control rather than relaxed.
 *
 * @param {object} model  the output of `quadModel`
 * @param {object} [opts]
 * @param {string} [opts.ariaLabel]  a short name for the table ("Removed is not rotated").
 *   Falls back to `model.aria`, so a table always has an accessible name.
 * @param {Function} [opts.cellHelp]  `(corner) => help` in any `tipLabel` shape. Defaults to
 *   whatever `help` the corner already carries from the model.
 * @param {Function} [opts.cellAction]  `(corner) => Node | null`. Appended after the share
 *   line and before the caller's own alarm chip. Returning `null` — an empty corner with
 *   nothing to open, say — draws nothing. Omitted entirely, the default, draws nothing
 *   either: the DOM this function produces with no `cellAction` given is byte-identical to
 *   what it produced before this option existed.
 */
export function quadTable(model, opts = {}) {
  const { ariaLabel = "", cellHelp = (c) => c.help, cellAction = null } = opts;
  const { rows, cols, corners } = model;
  const at = (row, col) => corners.find((c) => c.row === row && c.col === col);

  const head = el("tr", {},
    // The empty corner of a two-way table names the two axes and heads nothing, so it is a
    // `td`: a `th` here would be announced as a header for the row and column beneath it.
    el("td", { class: "quad-axes" },
      el("span", { class: "quad-axes__col" }, cols.label),
      el("span", { class: "quad-axes__row" }, rows.label)),
    el("th", { scope: "col" }, cols.yes),
    el("th", { scope: "col" }, cols.no),
  );

  const body = [true, false].map((row) => el("tr", {},
    el("th", { scope: "row" }, row ? rows.yes : rows.no),
    cellNode(at(row, true), cellHelp, cellAction),
    cellNode(at(row, false), cellHelp, cellAction),
  ));

  return el("table", { class: "quad", "aria-label": ariaLabel || model.aria },
    el("thead", {}, head),
    el("tbody", {}, ...body),
  );
}

function cellNode(corner, cellHelp, cellAction) {
  const help = cellHelp ? cellHelp(corner) : null;
  const cell = el("td", { class: "quad-cell", "data-tone": corner.tone },
    el("span", { class: "quad-num num" }, corner.countText),
    el("span", { class: "quad-label" }, help ? tipLabel(corner.label, help) : corner.label),
    el("span", { class: "quad-share num" }, corner.shareText),
  );
  // The corner's own action, between its reading and the caller's state — after `cellHelp`
  // (a chip is a value; the action opens the values behind it), before `alarm`. `cellAction`
  // is null by default, so a caller that never passes it gets exactly the three children
  // above, unchanged — this is the one line the default path adds, and it is a no-op.
  const action = cellAction ? cellAction(corner) : null;
  if (action) cell.append(action);
  // The caller's own chip, appended rather than built: whether a corner is an ALARM is the
  // page's claim about its own population, and the chip already carries that page's word for
  // it. Nothing here invents a second vocabulary for the same state.
  if (corner.alarm) cell.append(corner.alarm);
  return cell;
}
