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
 * @param {string} spec.unit  what one count counts ("assets"), for the sentence.
 * @param {string} spec.name  the row's own label, opening the sentence.
 * @returns {{total: number, fillPct: number, segments: Array, aria: string, empty: boolean}}
 */
export function bandBarModel(spec) {
  const p = spec || {};
  const bands = Array.isArray(p.bands) ? p.bands : [];
  const unit = typeof p.unit === "string" && p.unit ? p.unit : "";
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

  const segments = kept.map((b) => ({
    key: b.key,
    label: b.label,
    count: b.count,
    rank: b.rank,
    extra: b.extra,
    // Within the row's own fill, so the segments always sum to it.
    pct: total > 0 ? (b.count / total) * 100 : 0,
  }));

  const clauses = segments.map((s) => {
    const head = String(s.count) + (unit ? " " + unit : "") + " at " + s.label;
    return s.extra ? head + " (" + s.extra + ")" : head;
  });
  const body = clauses.length ? clauses.join(", ") + "." : "nothing to show.";
  const aria = name ? name + ": " + body : body;

  return { total, fillPct, segments, aria, empty: segments.length === 0 };
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
    fill.append(el("span", {
      class: "bandbar__seg",
      "data-rank": s.rank === null ? "none" : String(s.rank),
      "data-on": selected === null ? "true" : String(s.key === selected),
      style: "width:" + s.pct.toFixed(2) + "%",
    }));
  }
  return el("span", { class: cls, role: "img", "aria-label": model.aria }, fill);
}
