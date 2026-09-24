// The Executive briefing: four figures, two splits, a short list — one screen, read at a glance.
//
// WHAT THIS REPLACES. Every sidekick's front door was the shared `pageHeader()` shape plus a
// stack of one-glance sections (severity strip, cold card, remediation table, last-scan block,
// Fix next). Each block was honest; together they were a scroll of prose a leader had to read
// top to bottom to get four facts. The briefing keeps the facts and the honesty rules and drops
// the scroll: every figure gets a picture that makes its claim before its caption does.
//
// THE PICTURES ARE DOM AND SVG, NEVER CANVAS. The front door still pays nothing for Chart.js
// (gas/src/client/js/pages/executive.js's header rule, held by its own test): each mark here
// is a handful of nodes. And every picture is a SECOND encoding of a figure already printed in
// words beside it — the `role="img"` name repeats it for a screen reader, the number is on the
// surface for everybody else. No picture here is ever the only place a value lives.
//
// THE MODELS ARE PURE. Geometry (`slopeModel`, `ringModel`, `splitModel`, `dotGridModel`) is
// computed without a DOM so the claims — zero-based slope, a share that never rounds a real
// part to nothing, a split that refuses a zero total — are testable in node.

import { el } from "./dom.js";
import { svgEl } from "../icons.js";
import { figureCardModel, fmtCount, num } from "./figures.js";
import { tipLabel } from "./tip.js";

// ------------------------------------------------------------------------------ models

/**
 * Two readings as one line, on a ZERO-BASED scale.
 *
 * ZERO-BASED ON PURPOSE. Scaling the box to [min, max] turns 87 -> 76 into a cliff and
 * 420 -> 413 into the same cliff; the slope would then be a picture of "it moved" rather
 * than of how much. Against zero, a 2% drop reads as nearly flat, which is what it is.
 *
 * @returns {{show: boolean, y1: number, y2: number, direction: "up"|"down"|"flat"}}
 */
export function slopeModel(from, to, { h = 64, top = 10, bottom = 30 } = {}) {
  const a = num(from);
  const b = num(to);
  if (a === null || b === null || a < 0 || b < 0) return { show: false, y1: 0, y2: 0, direction: "flat" };
  const max = Math.max(a, b);
  const span = h - top - bottom;
  const y = (v) => (max === 0 ? top + span : Math.round((top + (1 - v / max) * span) * 100) / 100);
  return { show: true, y1: y(a), y2: y(b), direction: b > a ? "up" : b < a ? "down" : "flat" };
}

/**
 * A part of a whole as a ring's arc length.
 *
 * A REAL PART NEVER DRAWS AS NOTHING, and a zero part never draws as something: 1 of 10,000
 * still gets a visible sliver (`minArc`), while 0 of anything is an empty track.
 */
export function ringModel(part, whole, { r = 26, minArc = 3 } = {}) {
  const p = num(part);
  const w = num(whole);
  const c = 2 * Math.PI * r;
  if (p === null || w === null || w <= 0) return { show: false, arc: 0, circumference: c, share: null };
  const share = Math.min(Math.max(p / w, 0), 1);
  const raw = share * c;
  const arc = p > 0 ? Math.max(raw, minArc) : 0;
  return { show: true, arc: Math.round(arc * 10) / 10, circumference: Math.round(c * 10) / 10, share };
}

/**
 * A share as filled cells out of a fixed grid (100 by default).
 *
 * THE SAME NON-ROUNDING RULE AS THE RING: a positive share below half a cell still fills one,
 * so "0.7% of the backlog is cold" never draws as "none of it is".
 */
export function dotGridModel(sharePct, cells = 100) {
  const s = num(sharePct);
  if (s === null) return { show: false, filled: 0, cells };
  const exact = (Math.min(Math.max(s, 0), 100) / 100) * cells;
  const filled = s > 0 ? Math.max(1, Math.round(exact)) : 0;
  return { show: true, filled, cells };
}

/**
 * One track split into parts, widths in percent of the total.
 *
 * REFUSES A ZERO TOTAL rather than dividing by it, and drops zero parts from the TRACK (a
 * zero-width segment is a gap with a label nobody can place) while keeping them nowhere else
 * — the caller's legend is the place a zero is stated.
 */
export function splitModel(parts) {
  const rows = (Array.isArray(parts) ? parts : [])
    .map((p) => ({ ...p, value: num(p.value) }))
    .filter((p) => p.value !== null && p.value > 0);
  const total = rows.reduce((s, p) => s + p.value, 0);
  if (!total) return { show: false, total: 0, rows: [] };
  return {
    show: true,
    total,
    rows: rows.map((p) => ({ ...p, pct: Math.round((p.value / total) * 10000) / 100 })),
  };
}

/** Folds everything past the first `keep` parts into one "N others" part. */
export function foldTail(parts, keep, label = (n) => fmtCount(n) + " others") {
  const list = Array.isArray(parts) ? parts : [];
  if (list.length <= keep + 1) return list;
  const head = list.slice(0, keep);
  const tail = list.slice(keep);
  const value = tail.reduce((s, p) => s + (num(p.value) || 0), 0);
  return [...head, { label: label(tail.length), value, tone: "rest", folded: tail.length }];
}

// --------------------------------------------------------------------------- the marks

/** Zero-based slope between two readings, labelled at both ends. */
export function slopeMark({ from, to, fromLabel, toLabel, label }) {
  const m = slopeModel(from, to);
  if (!m.show) return null;
  const svg = svgEl("svg", {
    class: "brief-slope", viewBox: "0 0 220 64", width: "220", height: "64",
    role: "img", "aria-label": label,
  });
  svg.append(
    svgEl("line", { class: "brief-slope__base", x1: 12, y1: 60, x2: 208, y2: 60 }),
    svgEl("line", { class: "brief-slope__line", x1: 12, y1: m.y1, x2: 208, y2: m.y2 }),
    svgEl("circle", { class: "brief-slope__from", cx: 12, cy: m.y1, r: 4 }),
    svgEl("circle", { class: "brief-slope__to", cx: 208, cy: m.y2, r: 5 }),
  );
  const t1 = svgEl("text", { class: "brief-slope__lbl", x: 12, y: 54 });
  t1.textContent = fromLabel;
  const t2 = svgEl("text", { class: "brief-slope__lbl brief-slope__lbl--now", x: 208, y: 54, "text-anchor": "end" });
  t2.textContent = toLabel;
  svg.append(t1, t2);
  return svg;
}

/** A part of a whole as a ring. */
export function ringMark({ part, whole, label }) {
  const m = ringModel(part, whole);
  if (!m.show) return null;
  const svg = svgEl("svg", {
    class: "brief-ring", viewBox: "0 0 64 64", width: "64", height: "64", role: "img", "aria-label": label,
  });
  svg.append(
    svgEl("circle", { class: "brief-ring__track", cx: 32, cy: 32, r: 26 }),
    svgEl("circle", {
      class: "brief-ring__arc", cx: 32, cy: 32, r: 26,
      "stroke-dasharray": m.arc + " " + m.circumference, transform: "rotate(-90 32 32)",
    }),
  );
  return svg;
}

/** A share as filled cells out of a grid of 100. */
export function dotGrid({ sharePct, label, cells = 100 }) {
  const m = dotGridModel(sharePct, cells);
  if (!m.show) return null;
  const grid = el("span", { class: "brief-dots", role: "img", "aria-label": label });
  for (let i = 0; i < m.cells; i += 1) {
    grid.append(el("span", { class: "brief-dot" + (i < m.filled ? " brief-dot--on" : "") }));
  }
  return grid;
}

/** One square per item, toned — e.g. one per team to chase, coloured by tier. */
export function unitSquares({ tones, label }) {
  const list = Array.isArray(tones) ? tones : [];
  if (!list.length) return null;
  return el("span", { class: "brief-units", role: "img", "aria-label": label },
    ...list.map((t) => el("span", { class: "brief-unit brief-tone--" + t })));
}

/** A small proportion track: `part` of `whole` filled. */
export function shareTrack({ part, whole, label }) {
  const p = num(part);
  const w = num(whole);
  if (p === null || w === null || w <= 0) return null;
  const pct = Math.min(Math.max((p / w) * 100, p > 0 ? 1.5 : 0), 100);
  return el("span", { class: "brief-track", role: "img", "aria-label": label },
    el("span", { class: "brief-track__fill", style: "width: " + pct.toFixed(2) + "%" }));
}

/**
 * The direction of a change, in words and glyph — never colour alone.
 * `chip` is a `deltaChipView` shape: {direction, pct, delta, kind, aria}.
 */
export function briefDelta(chip, { form = "pct" } = {}) {
  if (!chip) return null;
  const glyph = chip.direction === "up" ? "▲" : chip.direction === "down" ? "▼" : "=";
  const mag = Math.abs(num(chip.delta, 0));
  const text = chip.direction === "flat"
    ? "±0"
    : form === "count" || chip.pct === null || chip.pct === undefined
      ? fmtCount(mag)
      : chip.pct + "%";
  return el("span", { class: "brief-delta brief-delta--" + (chip.kind || "neutral"), "aria-label": chip.aria },
    el("span", { "aria-hidden": "true" }, glyph + " " + text));
}

// --------------------------------------------------------------------------- the blocks

/**
 * One of the four headline figures.
 *
 * @param {{label: Node|string, value: string, unit?: string|null, delta?: Node|null,
 *          visual?: Node|null, caption?: Node|string|null, link?: {href: string, text: string}|null,
 *          action?: Node|null, valueClass?: string|null, wide?: boolean,
 *          help?: *, denominator?: string|null}} f
 *
 * `denominator` IS figureCard's CONTRACT, CARRIED OVER. A figure that is a rate names what
 * it is a rate OF: the sentence leads the label's tip (the book's definition follows it) and
 * rides on the node as `data-denominator`, exactly as `figureCard` does — so a briefing figure
 * is never a percentage with its base stripped off. With `help`/`denominator`, `label` is the
 * plain text and the tip is built here; without them `label` may be any node.
 */
export function briefFigure(f) {
  let label = f.label;
  let denominator = null;
  if ((f.help || f.denominator) && typeof f.label === "string") {
    const m = figureCardModel({ help: f.help, denominator: f.denominator });
    denominator = m.denominator;
    label = m.lines
      ? tipLabel(f.label, { lines: m.lines, term: m.term })
      : m.term ? tipLabel(f.label, { term: m.term }) : f.label;
  }
  return el("section", {
    class: "brief-fig" + (f.wide ? " brief-fig--wide" : ""),
    "data-denominator": denominator,
  },
    el("h2", { class: "brief-label" }, label),
    el("div", { class: "brief-value-row" },
      el("span", { class: "brief-value num" + (f.valueClass ? " " + f.valueClass : "") }, f.value),
      f.unit ? el("span", { class: "brief-unit-word" }, f.unit) : null,
      f.delta || null),
    f.visual ? el("div", { class: "brief-visual" }, f.visual) : null,
    f.caption ? el("p", { class: "brief-caption" }, f.caption) : null,
    f.link ? el("a", { class: "brief-link", href: f.link.href }, f.link.text, el("span", { "aria-hidden": "true" }, " →")) : null,
    f.action || null);
}

/** The row the four figures sit in. */
export function briefFigures(...figures) {
  return el("div", { class: "brief-figures" }, ...figures.flat());
}

/**
 * A labelled split: the track, and under each part its number, an optional note (a delta)
 * and its name, aligned to the part it names.
 *
 * @param {{label: Node|string, parts: Array<{label: string, value: number, tone: string,
 *          note?: Node|null}>, aria: string, foot?: Node|string|null,
 *          after?: Array<Node|null>}} s   `after` is appended below the foot as-is — for a
 *          caveat that must keep its own paragraph (a cap note), not merge into a caption.
 */
export function briefSplit(s) {
  const m = splitModel(s.parts);
  const box = el("section", { class: "brief-split" }, el("h2", { class: "brief-label" }, s.label));
  if (!m.show) {
    box.append(el("p", { class: "brief-caption" }, "Nothing open to split."));
    return box;
  }
  box.append(
    el("div", { class: "brief-split__track", role: "img", "aria-label": s.aria },
      ...m.rows.map((p) => el("span", {
        class: "brief-split__seg " + toneClass(p.tone),
        style: "flex-basis: " + p.pct + "%",
      }))),
    el("div", { class: "brief-split__keys" },
      ...m.rows.map((p) => el("span", { class: "brief-split__key", style: "flex-basis: " + p.pct + "%" },
        el("span", { class: "brief-split__n num" }, fmtCount(p.value), p.note ? " " : null, p.note || null),
        el("span", { class: "brief-split__name" }, p.label)))),
  );
  if (s.foot) box.append(el("p", { class: "brief-caption" }, s.foot));
  (s.after || []).forEach((n) => { if (n) box.append(n); });
  return box;
}

/** Severity tones map onto the shared `sev-fill-*` classes; everything else is a brief tone. */
function toneClass(tone) {
  return /^[A-Z]+$/.test(String(tone)) ? "sev-fill-" + tone : "brief-tone--" + tone;
}

/** The row the two splits sit in. */
export function briefSplits(...splits) {
  return el("div", { class: "brief-splits" }, ...splits.flat());
}

/**
 * A short ranked list: tone mark, primary, secondary, a figure, a meta figure.
 *
 * `label: null` draws no head — for a list that sits under a heading of its own, such as the
 * Executive page's Fix next preview under its collapsible section's summary.
 *
 * @param {{label: Node|string|null, action?: Node|null, rows: Array<{tone: string, primary: string,
 *          secondary?: string|null, figure?: string|null, meta?: string|null,
 *          href?: string|null, aria?: string|null}>}} l
 */
export function briefList(l) {
  const list = el("ol", { class: "brief-list__rows" },
    ...l.rows.map((r) => {
      const inner = [
        el("span", { class: "brief-list__mark brief-tone--" + r.tone, "aria-hidden": "true" }),
        el("span", { class: "brief-list__primary" }, r.primary),
        el("span", { class: "brief-list__secondary" }, r.secondary || ""),
        el("span", { class: "brief-list__figure num" }, r.figure || ""),
        el("span", { class: "brief-list__meta num" }, r.meta || ""),
      ];
      return el("li", {},
        r.href
          ? el("a", { class: "brief-list__row", href: r.href, "aria-label": r.aria || null }, ...inner)
          : el("div", { class: "brief-list__row" }, ...inner));
    }));
  const head = l.label || l.action
    ? el("div", { class: "brief-list__head" },
      l.label ? el("h2", { class: "brief-label" }, l.label) : null, l.action || null)
    : null;
  return el("section", { class: "brief-list" }, head, list);
}

/**
 * The one status line under the title: when the figures were measured, and anything that
 * qualifies all of them at once (a dry run, a stale sync).
 *
 * @param {{tone: "ok"|"warn"|"neutral", parts: Array<Node|string|null>}} s
 */
export function briefStatus(s) {
  const parts = (s.parts || []).filter((p) => p !== null && p !== undefined && p !== "");
  const line = el("p", { class: "brief-status" },
    el("span", { class: "brief-status__dot brief-status__dot--" + (s.tone || "neutral"), "aria-hidden": "true" }));
  parts.forEach((p, i) => {
    if (i) line.append(el("span", { class: "brief-status__sep", "aria-hidden": "true" }, "·"));
    line.append(p);
  });
  return line;
}
