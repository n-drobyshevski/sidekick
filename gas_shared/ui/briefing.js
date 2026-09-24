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

import { el, motionOk } from "./dom.js";
import { skeleton } from "./feedback.js";
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

/**
 * The briefing's loading stubs, drawn IN ITS OWN GRID: four figure columns with their rules,
 * two splits with a track, a ranked list's rows. The stub is the layout — a stub shaped like
 * some other page makes the real content jump when it lands. Everything is `aria-hidden`
 * (`skeleton()`); the figures stub carries the one `role="status"` a screen reader hears.
 */
export function briefSkeleton() {
  const line = (width, height) => skeleton("line", { width, height });
  const figures = el("div", { class: "brief-figures brief-skel", role: "status",
    "aria-label": "Computing the headline figures" },
    ...[0, 1, 2, 3].map((i) => el("div", { class: "brief-fig" },
      line(i % 2 ? "72px" : "96px"),
      skeleton("stat", { width: i % 2 ? "150px" : "110px", height: "52px", radius: "8px" }),
      skeleton("", { width: "70%", height: "56px" }),
      line("88%"), line("56%"))));
  const splits = el("div", { class: "brief-splits brief-skel" },
    ...[0, 1].map(() => el("div", { class: "brief-split" },
      line("96px"), skeleton("", { height: "28px", radius: "4px" }),
      el("div", { class: "brief-skel__keys" }, ...[0, 1, 2, 3].map(() => line("48px"))),
      line("40%"))));
  const list = el("div", { class: "brief-skel" },
    line("120px", "16px"),
    el("div", { class: "brief-skel__rows" }, ...[0, 1, 2].map((i) => el("div", { class: "brief-skel__row" },
      skeleton("", { width: "10px", height: "10px", radius: "3px" }),
      line(["180px", "220px", "160px"][i]), line("140px"), el("span", {}), line("64px"), line("72px")))));
  return { figures, splits, list };
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

// ------------------------------------------------------------------ the clock by severity

/** The time axis the clocks share: log-scaled, 1 day to the first round span past the data. */
const CLOCK_SPANS = [30, 90, 180, 365, 730, 1095];
const CLOCK_TICKS = [
  { days: 1, label: "1d" }, { days: 7, label: "7d" }, { days: 30, label: "30d" },
  { days: 90, label: "90d" }, { days: 180, label: "180d" }, { days: 365, label: "1y" },
  { days: 730, label: "2y" }, { days: 1095, label: "3y" },
];

/**
 * Each severity's half-life against its own SLA target, on one shared axis.
 *
 * WHY THIS PICTURE. An aggregated MTTR hides whether the CRITICAL clock meets its target —
 * the question a remediation page exists to answer — so the MTTR briefing leads with the
 * per-severity reading, drawn so the gap between "how long it takes" and "how long it may
 * take" is the first thing seen, not a pair of numbers in two table columns.
 *
 * LOG-SCALED ON PURPOSE. Targets run from 7 to 180 days and half-lives past a year; on a
 * linear axis every CRITICAL target is a hairline at the left edge. On a log axis 7 days and
 * 180 days are both legible, and "twice the target" is the same distance at every severity.
 *
 * A LOWER BOUND IS DRAWN AS ONE: a hollow marker at the bound with an open arrow to the
 * right ("at least this far"), never a filled dot at a value the estimator did not produce.
 * A severity with no reading has no marker at all — absence is not a position on the axis.
 *
 * THE OPEN-AGE MARKER IS OPTIONAL AND SECOND. `age` (the median age of what is still open)
 * is how old the running backlog already is — a reading that exists even where the half-life
 * does not ("Not reached"), so a register whose curve never halved still shows its gap to the
 * target. It never decides the verdict: that is the half-life's alone.
 *
 * @param {Array<{days: number|null, bounded?: boolean, target: number|null,
 *                age?: number|null}>} rows
 * @returns {{max: number, ticks: Array<{days: number, label: string, pos: number}>,
 *   rows: Array<{halfPos: number|null, targetPos: number|null, agePos: number|null,
 *                verdict: "over"|"within"|null}>}}
 */
export function clockModel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const values = [];
  list.forEach((r) => {
    const d = num(r.days);
    const t = num(r.target);
    const a = num(r.age);
    if (d !== null && d > 0) values.push(d);
    if (t !== null && t > 0) values.push(t);
    if (a !== null && a > 0) values.push(a);
  });
  const top = values.length ? Math.max(...values) : 30;
  const max = CLOCK_SPANS.find((s) => s >= top * 1.15) || Math.ceil(top * 1.15);
  const pos = (d) => {
    const v = Math.min(Math.max(d, 1), max);
    return Math.round((Math.log(v) / Math.log(max)) * 10000) / 100;
  };
  return {
    max,
    ticks: CLOCK_TICKS.filter((t) => t.days <= max).map((t) => ({ ...t, pos: pos(t.days) })),
    rows: list.map((r) => {
      const d = num(r.days);
      const t = num(r.target);
      const a = num(r.age);
      const halfPos = d !== null && d > 0 ? pos(d) : null;
      const targetPos = t !== null && t > 0 ? pos(t) : null;
      const agePos = a !== null && a > 0 ? pos(a) : null;
      // A lower bound past the target is over for certain; one inside it says nothing.
      const verdict = halfPos === null || targetPos === null
        ? null
        : d > t ? "over" : r.bounded ? null : "within";
      return { halfPos, targetPos, agePos, verdict };
    }),
  };
}

/**
 * The clock-by-severity block.
 *
 * @param {{label: Node|string, rows: Array<{sev: string, badge: Node, days: number|null,
 *          bounded?: boolean, halfText: string, target: number|null, age?: number|null,
 *          ageText?: string|null,
 *          rate: {text: string, value: number|null, denominator: number|null,
 *                 denominatorLabel: string, baseEmpty: boolean, emptyLabel: string},
 *          past: string|Node|null}>, foot?: Node|string|null,
 *          after?: Array<Node|null>}} c
 */
export function briefClocks(c) {
  const m = clockModel(c.rows);
  const box = el("section", { class: "brief-clocks" },
    el("div", { class: "brief-list__head" }, el("h2", { class: "brief-label" }, c.label)));
  if (!c.rows.length) {
    box.append(el("p", { class: "brief-caption" }, "No severity has findings in scope."));
    return box;
  }
  const axis = el("div", { class: "brief-clocks__axis", "aria-hidden": "true" },
    ...m.ticks.map((t) => el("span", {
      // 1 day, 180 days and the multi-year ticks are MINOR: a phone drops them so 90d and 1y
      // do not collide, and the axis still reads left to right.
      class: "brief-clocks__tick" + ([1, 180, 730, 1095].includes(t.days) ? " brief-clocks__tick--minor" : ""),
      style: "left: " + t.pos + "%",
    }, t.label)));
  const head = el("div", { class: "brief-clocks__row brief-clocks__row--head" },
    el("span", {}, ""),
    axis,
    el("span", { class: "brief-clocks__col" }, "MTTR"),
    el("span", { class: "brief-clocks__col" }, "In SLA"),
    el("span", { class: "brief-clocks__col" }, "Open past SLA"));
  box.append(head);
  c.rows.forEach((r, i) => {
    const g = m.rows[i];
    const track = el("span", {
      class: "brief-clocks__track",
      role: "img",
      "aria-label": r.sev + ": MTTR " + (r.bounded ? "at least " : "") + r.halfText
        + (r.target ? ", against a " + fmtCount(r.target) + "-day target" : ", no target")
        + (r.ageText ? "; open findings' median age " + r.ageText : ""),
    });
    if (g.targetPos !== null) {
      track.append(el("span", { class: "brief-clocks__target", style: "left: " + g.targetPos + "%" }));
    }
    if (g.agePos !== null) {
      track.append(el("span", { class: "brief-clocks__age", style: "left: " + g.agePos + "%" }));
    }
    if (g.halfPos !== null) {
      track.append(el("span", {
        class: "brief-clocks__half" + (r.bounded ? " brief-clocks__half--bound" : "")
          + (g.verdict ? " brief-clocks__half--" + g.verdict : ""),
        style: "left: " + g.halfPos + "%",
      }));
      if (r.bounded) {
        track.append(el("span", {
          class: "brief-clocks__reach", style: "left: " + g.halfPos + "%; right: 0",
        }));
      }
    }
    const rate = r.rate;
    box.append(el("div", { class: "brief-clocks__row" },
      el("span", { class: "brief-clocks__sev" }, r.badge),
      track,
      el("span", { class: "brief-clocks__col num" + (g.verdict === "over" ? " brief-clocks__over" : "") },
        r.halfText),
      el("span", {
        class: "brief-clocks__col num",
        "data-denominator": rate.denominator === null ? "none" : String(rate.denominator),
        "aria-label": rate.baseEmpty
          ? "In SLA not measured: " + rate.emptyLabel
          : rate.text + " of " + rate.denominatorLabel + " closed in SLA",
      }, rate.baseEmpty ? "—" : rate.text),
      el("span", { class: "brief-clocks__col num" }, r.past === null ? "—" : r.past)));
  });
  box.append(el("div", { class: "brief-clocks__key" },
    el("span", {}, el("span", { class: "brief-clocks__key-target", "aria-hidden": "true" }), " SLA target"),
    el("span", {}, el("span", { class: "brief-clocks__key-half", "aria-hidden": "true" }), " MTTR"),
    el("span", {}, el("span", { class: "brief-clocks__key-bound", "aria-hidden": "true" }), " at least (curve never fell to half)"),
    m.rows.some((g) => g.agePos !== null)
      ? el("span", {}, el("span", { class: "brief-clocks__key-age", "aria-hidden": "true" }), " median age of what is open")
      : null,
    el("span", {}, "Log scale — 7 days and a year both stay legible.")));
  if (c.foot) box.append(el("p", { class: "brief-caption" }, c.foot));
  (c.after || []).forEach((n) => { if (n) box.append(n); });
  return box;
}

/** A row of secondary figures — smaller than the four, for the ones a leader reads second. */
export function briefExtras(...items) {
  const list = items.flat().filter(Boolean);
  if (!list.length) return null;
  return el("div", { class: "brief-extras" }, ...list);
}

// --------------------------------------------------------- shared by the briefing pages
//
// These were written four times — once per Executive and MTTR page in each register — before
// they moved here. Each is the ONE place its rule lives now.

/** A severity word for a split key or a caption: "CRITICAL" -> "Critical". */
export function sevWord(sev) {
  const t = String(sev || "");
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/** First letter up, the rest as written — for a view's lower-case `secondary` sentence. */
export function sentenceStart(s) {
  const t = String(s || "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * A Fix-next tier as a briefing tone. Tier 1 is the most urgent; anything past the three the
 * ramp colours clamps to its ends rather than drawing nothing.
 */
export function tierTone(tier) {
  const n = Number(tier);
  return "t" + Math.min(Math.max(Number.isFinite(n) ? n : 3, 1), 3);
}

/**
 * How many ranked groups sit in each tier, most urgent first — the Act-now figure's legend.
 *
 * @param {Array<{tier: number, tierLabel: string}>} items
 * @returns {{counts: Array<{tier: number, label: string, n: number}>, legend: string[]}}
 */
export function tierCounts(items) {
  const byTier = new Map();
  (Array.isArray(items) ? items : []).forEach((it) => {
    if (!byTier.has(it.tier)) byTier.set(it.tier, { tier: it.tier, label: it.tierLabel, n: 0 });
    byTier.get(it.tier).n += 1;
  });
  const counts = [...byTier.values()].sort((a, b) => a.tier - b.tier);
  return {
    counts,
    legend: counts.map((c) => fmtCount(c.n) + " " + String(c.label || "").toLowerCase()),
  };
}

/**
 * Whether the reading every figure rests on is stale, and the status-line tone that says so.
 * A scan or sync older than `days` (a week by default) turns the dot amber.
 */
export function staleness(ts, now = Date.now(), days = 7) {
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  const stale = Number.isFinite(t) && now - t > days * 86400000;
  return { stale, tone: stale ? "warn" : "ok" };
}

/**
 * The half-life's own change beside the figure, from an `executiveMovementView`-shaped
 * reading: `{show, direction, magnitude, label}`. A LONGER half-life is the bad direction.
 */
export function briefTrendDelta(half) {
  if (!half || !half.show) return null;
  const kind = half.direction === "flat" ? "neutral" : half.direction === "up" ? "bad" : "ok";
  return el("span", { class: "brief-delta brief-delta--" + kind, "aria-label": half.label },
    half.magnitude);
}

/**
 * The notes that qualify EVERY figure on a page — a tracking window, a stale sync, end-of-life
 * repositories still counted. They are honesty statements, so they stay on the surface as a
 * list, never in a tip. Null when there is nothing to say.
 */
export function briefNotes(notes, label = "Read with care") {
  const list = (Array.isArray(notes) ? notes : []).filter(Boolean);
  if (!list.length) return null;
  return el("section", { class: "brief-notes" },
    el("h2", { class: "brief-label" }, label),
    el("ul", { class: "brief-notes__list" }, ...list.map((n) => el("li", { class: "small muted" }, n))));
}

/**
 * Opens the folded section inside `host` (a `collapsibleSection`) and brings it into view.
 * Returns whether there was one to open, so the caller can record its own open flag.
 */
export function openFolded(host) {
  const details = host && host.querySelector("details");
  if (!details) return false;
  details.open = true;
  if (typeof details.scrollIntoView === "function") {
    // No glide for a reader who asked for less motion — the rule every scroll here follows.
    details.scrollIntoView({ block: "start", behavior: motionOk() ? "smooth" : "auto" });
  }
  return true;
}

/** The "take me there" button a figure or list head carries: text, then an arrow. */
export function briefMore(text, onClick) {
  return el("button", { type: "button", class: "brief-more", onclick: onClick },
    text, el("span", { "aria-hidden": "true" }, " →"));
}

// ------------------------------------------------------------- a rate with its bounds

/**
 * A percentage with its uncertainty and a reference line, as positions on a 0-100 track.
 *
 * WHY THE BAND IS DRAWN. Coverage and efficiency re-label the unclassified findings both ways,
 * so each is a point inside [lo, hi] — and the WIDTH of that interval is the doubt. A bar
 * that stops at the point alone would claim a precision the estimator does not have.
 *
 * THE REFERENCE is what a program picking at random would score (prevalence). Efficiency at
 * or below it is "no better than random", and a line on the same track says so faster than a
 * sentence. `verdict` compares the POINT; the caller decides the words.
 *
 * @returns {{show: boolean, point: number|null, lo: number|null, hi: number|null,
 *   ref: number|null, band: boolean, verdict: "above"|"at-or-below"|null}}
 */
export function boundedTrackModel({ point, lo, hi, reference } = {}) {
  const clamp = (v) => (v === null ? null : Math.min(Math.max(v, 0), 100));
  const p = clamp(num(point));
  if (p === null) return { show: false, point: null, lo: null, hi: null, ref: null, band: false, verdict: null };
  let l = clamp(num(lo));
  let h = clamp(num(hi));
  if (l !== null && h !== null && l > h) [l, h] = [h, l];
  const band = l !== null && h !== null && (Math.abs(l - p) > 1e-9 || Math.abs(h - p) > 1e-9);
  const ref = clamp(num(reference));
  return {
    show: true,
    point: p,
    lo: band ? l : null,
    hi: band ? h : null,
    ref,
    band,
    verdict: ref === null ? null : p > ref ? "above" : "at-or-below",
  };
}

/** The bounded-rate track: the point filled, the bounds a lighter band, the reference a tick. */
export function boundedTrack({ point, lo, hi, reference, label }) {
  const m = boundedTrackModel({ point, lo, hi, reference });
  if (!m.show) return null;
  const track = el("span", { class: "brief-bounded", role: "img", "aria-label": label },
    el("span", { class: "brief-bounded__fill", style: "width: " + m.point.toFixed(2) + "%" }));
  if (m.band) {
    track.append(el("span", {
      class: "brief-bounded__band",
      style: "left: " + m.lo.toFixed(2) + "%; width: " + Math.max(m.hi - m.lo, 0.6).toFixed(2) + "%",
    }));
  }
  if (m.ref !== null) {
    track.append(el("span", { class: "brief-bounded__ref", style: "left: " + m.ref.toFixed(2) + "%" }));
  }
  return track;
}
