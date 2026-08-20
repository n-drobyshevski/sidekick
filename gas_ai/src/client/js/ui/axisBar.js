// What an axis ACTUALLY read across the landscape, as one bar per axis.
//
// The four-axes section says how each axis is derived. This says what that derivation
// produced — which is the half an operator cannot get from prose and cannot get from the
// single "N% unknown" figure either. A knob that decides nothing looks exactly like a knob
// that decides everything until you draw the distribution.
//
// NO SEVERITY TONES HERE, DELIBERATELY. The four `.pill` kinds mean something on this page:
// they are the outcome and tier palettes. An axis VALUE is not a verdict — ACTIVE is not
// "bad" and PARTIAL is not "ok" — so painting these segments in that palette would invent a
// severity the model does not claim and would spend colour PRODUCT.md rations for real
// risk. The ramp is monotone ink instead, dark to light in the axis's own declared order,
// which is the one ordering these values genuinely have.
//
// THE HATCH IS THE SAME HATCH. A portion of a segment that came from a reading nobody could
// establish is hatched, exactly as `claimRail` hatches a row that claims nothing: in both
// places the mark means "this is not a real measurement", and having it mean one thing in
// two places is worth more than a bespoke mark here.
//
// The bar is `aria-hidden` and the legend beside it carries every number in words — the
// decorative-meter contract `ui/data.js` sets and `claimRail` follows.

import { el, clear } from "./dom.js";

/**
 * How the decided population fell across one axis, and how much of each value was a
 * fallback rather than a reading.
 *
 * `decided` is `treeDiscrimination.decided` — already on the wire for the impact pane, so
 * this costs one pass over an array the page has anyway and no new endpoint.
 *
 * `unknown` is counted PER VALUE rather than as its own segment because for three of the
 * four axes it is not a value at all: an impact reading is TOTAL or PARTIAL whether or not
 * anything established it, and a mission of MEDIUM may be Wiz's answer or the operator's
 * fallback. Splitting it out as a fifth segment would say those rows had no value, which is
 * false; hatching part of the value they DID get says the true thing.
 */
export function axisTally(decided, key, values) {
  const counts = {};
  const unknowns = {};
  for (const v of values) {
    counts[v] = 0;
    unknowns[v] = 0;
  }
  let total = 0;
  for (const row of decided || []) {
    const value = row && row.vector ? row.vector[key] : null;
    if (value === null || value === undefined || !(value in counts)) continue;
    counts[value] += 1;
    total += 1;
    if (row.unknowns && row.unknowns.indexOf(key) >= 0) unknowns[value] += 1;
  }
  return {
    total,
    segments: values.map((value, rank) => ({
      value,
      rank,
      count: counts[value],
      unknown: unknowns[value],
      share: total ? counts[value] / total : 0,
      /** Of THIS value's rows, the share nothing established — what the hatch covers. */
      unknownShare: counts[value] ? unknowns[value] / counts[value] : 0,
    })),
  };
}

/**
 * The bar and its legend. Built once and repainted in place on every preview, like every
 * other control on the AARS Rules page.
 *
 * The handle carries `.paint(tally)` and `.light(what)`, where `what` is an axis value, the
 * string `"unknown"` (light the hatched portions), `"known"` (light everything else), or
 * null to clear. That is what lets a step in the ladder above light the part of the bar it
 * produced — the same picture-to-row link the lattice and the cascade already have, so the
 * gesture means the same thing in a third place.
 */
export function axisBar({ values, unit = "rows" }) {
  const track = el("div", { class: "axis-bar__track", "aria-hidden": "true" });
  const legend = el("p", { class: "axis-bar__legend small" });
  const node = el("div", { class: "axis-bar" }, track, legend);
  const segs = new Map();

  for (const value of values) {
    const hatch = el("i", { class: "axis-bar__hatch" });
    const seg = el("span", { class: "axis-bar__seg" }, hatch);
    seg.dataset.value = value;
    seg.dataset.rank = String(values.indexOf(value));
    track.append(seg);
    segs.set(value, { seg, hatch });
  }

  node.paint = (tally) => {
    clear(legend);
    if (!tally || !tally.total) {
      node.classList.add("axis-bar--empty");
      for (const { seg, hatch } of segs.values()) {
        seg.style.width = "0%";
        hatch.style.width = "0%";
        seg.dataset.zero = "";
      }
      legend.append(el("span", { class: "muted" }, "not measured yet"));
      return;
    }
    node.classList.remove("axis-bar--empty");
    for (const s of tally.segments) {
      const hit = segs.get(s.value);
      if (!hit) continue;
      hit.seg.style.width = `${s.share * 100}%`;
      hit.hatch.style.width = `${s.unknownShare * 100}%`;
      // Unlike the legend below it, the BAR has nothing to say about a value nothing
      // reached: a zero-width segment still carrying its separator would print two pixels
      // of page colour and read as a boundary between fills that are not there. The zero
      // is a finding and it is reported — in words, in the key, where it can be read.
      if (s.count) delete hit.seg.dataset.zero;
      else hit.seg.dataset.zero = "";
      // A value nothing reached still keeps its legend entry — a zero here is a finding
      // ("no reading on this axis ever came out ACTIVE"), not an absence to hide.
      const key = el(
        "span",
        { class: "axis-bar__key" },
        el("i", { class: "axis-bar__swatch", "aria-hidden": "true", "data-rank": String(s.rank) }),
        el("span", { class: "axis-bar__keyname" }, s.value),
        el("b", { class: "axis-bar__keyn" }, String(s.count)),
        s.unknown
          ? el("span", { class: "axis-bar__keyunk" }, `${s.unknown} unestablished`)
          : null,
      );
      key.dataset.value = s.value;
      legend.append(key);
    }
    legend.append(el("span", { class: "axis-bar__total muted" }, `of ${tally.total} ${unit}`));
    // A separator sits BETWEEN fills, so the last one that actually draws does not get one.
    // `:last-child` cannot say this when the trailing values are empty — the bar would stop
    // two pixels short of its track and read as not reaching the end.
    const drawn = [...segs.values()].map((h) => h.seg);
    for (const seg of drawn) delete seg.dataset.lastFill;
    const lastFill = drawn.filter((n) => n.dataset.zero === undefined).pop();
    if (lastFill) lastFill.dataset.lastFill = "";
  };

  node.light = (what) => {
    node.classList.toggle("axis-bar--lighting", what !== null && what !== undefined);
    node.classList.toggle("axis-bar--lit-unknown", what === "unknown");
    node.classList.toggle("axis-bar--lit-known", what === "known");
    for (const [value, { seg }] of segs.entries()) {
      seg.classList.toggle("is-lit", what === value);
    }
    legend.querySelectorAll(".axis-bar__key").forEach((k) => {
      k.classList.toggle("is-lit", k.dataset.value === what);
    });
  };

  node.paint(null);
  return node;
}
