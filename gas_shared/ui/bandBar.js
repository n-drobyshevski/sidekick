// A distribution across ordered bands, at the size of a table cell.
//
// WHAT IT REPLACES. Both registers drew a subject x band matrix as its own full-width table,
// one screen below a roll-up table keyed on the SAME subject: `gas`'s support-group table and
// its support-group x idle-bucket grid, `gas_devsecops`'s product roll-up and its per-repo
// grid. Two tables over one key means a reader cross-references them by scrolling. A bar in
// the row the distribution belongs to says the same thing in one glance, and the matrix's
// five-figures-per-row become the cell's `aria-label` and its tip — one level down, which is
// DESIGN.md's ladder, rather than gone.
//
// THE TIP IS POINTER-ONLY, ON PURPOSE. Each segment anchors its own band's figures, and the
// bar anchors its whole sentence so the unfilled track still answers. `tipAnchor` adds no tab
// stop and no role, and the card is aria-hidden: a keyboard or screen-reader user already has
// every figure in the `aria-label`, so the tip hands the pointer the same words and says
// nothing twice.
//
// THE TIP CARRIES THE SEGMENT'S OWN MARK. A swatch on the same `data-rank` ramp opens the band
// line, so the card names its band by colour as well as by word — and the whole-bar card is
// the row's legend, one marked line per band. The mark is never the only carrier: the word is
// always beside it.
//
// THE SCALE IS A PROPERTY OF THE TABLE, NEVER OF A ROW, and this is the defect the component
// exists to refuse. A bar normalised to its own row's total draws 280 subjects and 30 subjects
// at the same length, so a reader comparing two rows compares two different units — the exact
// mistake `unitChart.js`'s `unitScale` is written against ("one unit per TABLE: a per-row unit
// draws 401 with fewer marks than 400"). Here the row's SHARE of `max` sets how much of the
// track it fills, and the segments divide that fill. Both readings survive: composition
// across a row, magnitude down a column.
//
// THE BAR IS NOT A CONTROL. Five buttons per row times N rows is 5N new tab stops, which is
// the arity rule `quad.js` states ("a badge repeated once per row does not become a control
// (four hundred new stops)"). It is one `role="img"` carrying the whole distribution as a
// sentence. A page that wants the bands selectable spends five stops ONCE on a key row above
// the table, and one per row on the row itself — both of which a table already has — and
// passes `selected` here so the bar reflects a choice it never captures.
//
// `data-rank`, NOT `data-tone`. `tone` is the fixed neutral/ok/warn/bad vocabulary of
// `unitChart` and `quad`, and it is CATEGORICAL: four kinds, no order. A band is a STEP.
// gas_ai/DESIGN.md's Ordinal-Fork Rule keeps the two instruments off each other's tokens, so
// the ranks take the `--rank-N-*` ramp and nothing here can be mistaken for a status.
//
// ABSENT IS NEVER ZERO. A band whose count nobody measured contributes no width and no
// sentence clause; it is not drawn as an empty segment, because an empty segment in an ordered
// row reads as "nothing is in this band", which is a measurement. Every count is refused BY
// TYPE before any arithmetic — `Number(null)`, `Number("")`, `Number([])` and `Number(false)`
// are all 0 and finite, so a cast-first version silently plots missing readings as real zeros.

import { el } from "./dom.js";
import { tipAnchor } from "./tip.js";

/**
 * The bands of one row, reshaped into what the bar draws.
 *
 * @param {object} spec
 * @param {Array<{key: string, label: string, count: *, rank: number|null, extra: string}>}
 *   spec.bands  the bands IN ORDER. `rank` is 1..4 for a step on the ordinal ramp, or null for
 *   a band that is not a point on the scale at all (drawn as `--hatch`: "not a measurement").
 *   `extra` is an optional second figure per band, carried into the sentence only.
 * @param {number} spec.max  the largest row total in the TABLE. 0 or absent means every row
 *   fills its track, which is the single-row case and not a scale.
 * @param {string} spec.unit  what the counts count, plural ("assets"), for the sentence.
 * @param {string} [spec.unitOne]  the same noun for a count of exactly 1 ("asset"). Spelled
 *   out by the caller rather than derived: an -s rule writes "repositorys". Without it a 1
 *   keeps the plural, which is the old reading rather than a wrong one.
 * @param {string} spec.name  the row's own label, opening the sentence.
 * @returns {{total: number, fillPct: number, segments: Array, aria: string, empty: boolean}}
 *   Each segment carries `tip` (the lines its hover card shows) and `phrase` (its clause of the
 *   sentence); `name` is the row's label.
 */
export function bandBarModel(spec) {
  const p = spec || {};
  const bands = Array.isArray(p.bands) ? p.bands : [];
  const unit = typeof p.unit === "string" && p.unit ? p.unit : "";
  const unitOne = typeof p.unitOne === "string" && p.unitOne ? p.unitOne : unit;
  const counted = (n) => String(n) + (unit ? " " + (n === 1 ? unitOne : unit) : "");
  const name = typeof p.name === "string" ? p.name : "";

  const kept = [];
  let total = 0;
  for (const b of bands) {
    if (!b || typeof b.label !== "string" || b.label === "") continue;
    // REFUSED BY TYPE, before any arithmetic. See the header.
    const count = typeof b.count === "number" && Number.isFinite(b.count) && b.count > 0
      ? b.count
      : null;
    if (count === null) continue;
    total += count;
    kept.push({
      key: typeof b.key === "string" ? b.key : b.label,
      label: b.label,
      count,
      rank: typeof b.rank === "number" && b.rank >= 1 && b.rank <= 4 ? b.rank : null,
      extra: typeof b.extra === "string" ? b.extra : "",
    });
  }

  const max = typeof p.max === "number" && Number.isFinite(p.max) && p.max > 0 ? p.max : 0;
  // The row's share of the table's biggest row. No `max` means one row, and one row is not a
  // comparison — it fills its track rather than being drawn against a scale it has no peer on.
  const fillPct = total <= 0 ? 0 : max > 0 ? Math.min(100, (total / max) * 100) : 100;

  const segments = kept.map((b) => {
    // Within the row's own fill, so the segments always sum to it.
    const pct = total > 0 ? (b.count / total) * 100 : 0;
    return {
      key: b.key,
      label: b.label,
      count: b.count,
      rank: b.rank,
      extra: b.extra,
      pct,
      tip: segmentTip(b, pct, total, counted, name),
      phrase: counted(b.count) + " at " + b.label + (b.extra ? " (" + b.extra + ")" : ""),
    };
  });

  const clauses = segments.map((s) => s.phrase);
  const body = clauses.length ? clauses.join(", ") + "." : "nothing to show.";
  const aria = name ? name + ": " + body : body;

  return { total, fillPct, segments, aria, name, empty: segments.length === 0 };
}

/**
 * One segment's hover card: the band, its count with its share OF THE ROW (the reading the
 * segment's width encodes), and the band's second figure when it has one.
 *
 * A share that rounds to 0 is written "<1%": the segment exists, so "0%" would contradict it.
 */
function segmentTip(b, pct, total, counted, name) {
  const rounded = Math.round(pct);
  const share = rounded === 0 && pct > 0 ? "<1%" : String(rounded) + "%";
  const whole = "the " + String(total) + (name ? " in " + name : "");
  const lines = [
    b.label,
    counted(b.count) + " · " + share + " of " + whole,
  ];
  if (b.extra) lines.push(b.extra);
  return lines;
}

/** A band's swatch for the tip card, on the bar's own ramp. Decorative: the word is beside it. */
function tipMarked(rank, text) {
  return el("span", { class: "bandbar-tip__band" },
    el("span", {
      class: "bandbar-tip__mark",
      "data-rank": rank === null ? "none" : String(rank),
      "aria-hidden": "true",
    }),
    text);
}

/**
 * The bar itself: one `role="img"` whose label is the model's whole sentence.
 *
 * @param {ReturnType<typeof bandBarModel>} model
 * @param {object} [opts]
 * @param {string|null} [opts.selected]  a band key. When set, every OTHER band is dimmed —
 *   which is how the column-wise read that the matrix gave up is handed back: one press lights
 *   the same band in every row of the table.
 * @param {string} [opts.className]  an extra class on the wrapper.
 */
export function bandBar(model, opts) {
  const o = opts || {};
  const selected = typeof o.selected === "string" && o.selected ? o.selected : null;
  const cls = "bandbar" + (o.className ? " " + o.className : "");
  if (!model || model.empty) {
    // NOT AN EMPTY TRACK. A drawn track with nothing in it asserts that every band is zero;
    // a row with nothing to distribute gets no picture at all.
    return el("span", { class: cls + " bandbar--empty", "aria-hidden": "true" });
  }
  const fill = el("span", {
    class: "bandbar__fill",
    style: "width:" + model.fillPct.toFixed(2) + "%",
  });
  for (const s of model.segments) {
    const seg = el("span", {
      class: "bandbar__seg",
      "data-rank": s.rank === null ? "none" : String(s.rank),
      "data-on": selected === null ? "true" : String(s.key === selected),
      style: "width:" + s.pct.toFixed(2) + "%",
    });
    if (Array.isArray(s.tip) && s.tip.length) {
      // Built on each reveal: the card empties itself between anchors.
      tipAnchor(seg, () => [tipMarked(s.rank, s.tip[0]), ...s.tip.slice(1)]);
    }
    fill.append(seg);
  }
  // The innermost anchor wins (`closest("[data-tip]")`), so this answers only over the track
  // a segment does not cover — with the row's legend, one marked line per band.
  return tipAnchor(
    el("span", { class: cls, role: "img", "aria-label": model.aria }, fill),
    () => ({
      aka: model.name || null,
      lines: model.segments.map((s) => tipMarked(s.rank, s.phrase)),
    }),
  );
}
