// The shared half of "what is this control doing to the register, right now" — the live
// read-outs a Settings page draws beside a toggle, a severity-scope picker, a retention
// window or a threshold slider, computed from a snapshot payload and the in-memory draft.
//
// PROMOTED FROM gas/src/client/js/settingsReadouts.js (P2), the only app that had this whole
// vocabulary before this package — gas is the only register whose Settings page states, beside
// each control, what that control is doing to the ledger. P3 onward extend the same vocabulary
// to gas_ai and gas_devsecops; this file is the reusable HALF of it, and it draws that line the
// same way every other shared component in this directory does: pure model, thin DOM, because
// no app here runs jsdom and the half that can be WRONG has to be the half a contract can hold
// without a browser.
//
// FOUR EXPORTS, AND EACH ONE DRAWS THE SEAM IN A DIFFERENT PLACE:
//
//   impactSplitModel() / impactSplit()   the with/without split a display toggle draws — how
//     many rows a switch would hide, and what is on either side of it. Returns STRINGS and a
//     segment list, not one assembled node, because gas's own page holds three separate hosts
//     (a headline span, a bar div, a note paragraph) and writes into two of them independently
//     on every draft edit. `unit` is refused, not defaulted — "findings" is right in gas and
//     gas_devsecops and wrong in gas_ai, the same shape of refusal `diagnostics.js`'s
//     `missingTone` and `settingsForm.js`'s `defaultTab` already use for a word that is never
//     safe to guess.
//
//   severitySplitModel()   the shared half of a severity scan-scope bar: one segment per
//     severity that is in scope, one for the rest. `inScope` is a caller-supplied PREDICATE
//     `(sev) => boolean`, never a selected array — see the function's own header for why an
//     `Array.prototype.includes` shim would silently invert gas_devsecops's `[]`-means-all
//     default the moment this module reached that register.
//
//   tickTimeline()   a labelled tick sequence — a glyph AND a fill per tick, never fill alone,
//     a legend and a summary in words beneath it. It never computes a tick's own state: gas's
//     retention window arithmetic (`wouldSeal`) is a domain decision and stays in gas's own
//     client mirror, in a new pure `retentionTicks()` this file does not know exists.
//
//   createCutHistogram()   a bucketed distribution with a draggable cut line, generalised from
//     gas's EPSS threshold histogram. Built EXACTLY ONCE; `update()` only ever rewrites what is
//     already there and never recreates the `<input type="range">` — see that function's own
//     header for why that is load-bearing rather than a style preference.
//
// THE ONE DELIBERATE BEHAVIOUR CHANGE LIVES IN impactSplitModel(). gas's original `pct(n,
// total)` returned `"0.0%"` when `total` was 0. Zero of zero is not zero percent — it is
// unmeasured, and this codebase's whole argument (figures.js's refuse-before-cast formatters,
// quad.js's "an unmeasured count is absent, never a zero") is that an unmeasured quantity is
// never a confident zero. So when `total` is 0 the share is `absentText` and the headline drops
// its parenthetical entirely, rather than printing "(—)"  — a percent sign with nothing beside
// it reads as a broken figure, and the sentence is complete without it. This is the only pixel
// that moves in gas; gas_shared/test/contracts/settingsReadouts.js pins it as its own case.
//
// NOT IN THIS FILE: `openAndTotal`, gas's "N (M all time)" pair-formatter. It moved to
// figures.js instead, beside `fmtCount`/`pct1`/`days1` — it is a number formatter, not a DOM
// builder, and it is not gas's alone any more: `severitySplitModel` below uses it too.

import { clear, el } from "./dom.js";
import { absentText, openAndTotal } from "./figures.js";
import { splitBar } from "./splitBar.js";
import { tipAnchor } from "./tip.js";

function fmt(n) {
  return (n || 0).toLocaleString();
}

// ============================================================================== impact split

/**
 * The with/without split a display toggle draws, as data rather than as one assembled node.
 *
 * @param {object} spec
 * @param {number} spec.count            how many rows the excluded side holds
 * @param {number} spec.total            the open population this is read against
 * @param {string} spec.unit             what a row IS ("findings", "secrets", …) — REQUIRED,
 *   see this module's header for why it is refused rather than defaulted
 * @param {string} spec.phrase           completes the headline: "N of M open UNIT (P%) PHRASE."
 * @param {string} spec.includedLabel    the segment/caption label for the kept side
 * @param {string} spec.excludedLabel    the segment/caption label for the excluded side
 * @param {boolean} spec.on              the switch's current state
 * @param {string} spec.onNote           the note when `on` is true (the switch counts everyone)
 * @param {string} spec.offNote          the note when `on` is false (the excluded side is hidden)
 * @returns {{headline: string, caption: string, ariaLabel: string, note: string,
 *   segments: {label: string, value: number, tone: string}[]}}
 */
export function impactSplitModel({
  count, total, unit, phrase, includedLabel, excludedLabel, on, onNote, offNote,
}) {
  if (!unit) {
    throw new Error(
      "impactSplitModel(): unit is required — \"findings\" is right in some registers and "
      + "wrong in others, so it is never defaulted.",
    );
  }
  const included = Math.max(0, total - count);
  // THE ONE DELIBERATE BEHAVIOUR CHANGE — see this module's header. Zero of zero is unmeasured,
  // not zero percent, and the headline drops its parenthetical entirely rather than print a
  // percent sign over an em dash.
  const share = total ? `${((count / total) * 100).toFixed(1)}%` : absentText;
  const headline = share === absentText
    ? `${fmt(count)} of ${fmt(total)} open ${unit} ${phrase}.`
    : `${fmt(count)} of ${fmt(total)} open ${unit} (${share}) ${phrase}.`;
  const caption = `${includedLabel} ${fmt(included)} · ${excludedLabel} ${fmt(count)} `
    + `— ${fmt(total)} open.`;
  const ariaLabel = `${fmt(count)} of ${fmt(total)} open ${unit}, ${String(excludedLabel).toLowerCase()}`;
  return {
    headline,
    caption,
    ariaLabel,
    note: on ? onNote : offNote,
    segments: [
      { label: includedLabel, value: included, tone: "in" },
      { label: excludedLabel, value: count, tone: "out" },
    ],
  };
}

/** `splitBar({segments, caption, ariaLabel})`, over an `impactSplitModel()` result. */
export function impactSplit(model) {
  return splitBar({ segments: model.segments, caption: model.caption, ariaLabel: model.ariaLabel });
}

// =========================================================================== severity split

/**
 * The shared half of a severity scan-scope bar: one segment per severity that is in scope, a
 * trailing segment for the rest, and a caption naming every severity's figures in words —
 * including the out-of-scope ones.
 *
 * `inScope` IS A PREDICATE, `(sev) => boolean`, NEVER A SELECTED ARRAY. This is load-bearing,
 * not a style choice: gas_devsecops's `fetchSeverities.secrets === []` means ALL severities,
 * never none (see that register's own `registerFieldView` and `domain/config.ts`'s
 * `DEFAULT_FETCH_SEVERITIES`). A shared `(sev) => selected.includes(sev)` baked into this
 * module would read an empty selection as "nothing in scope" and invert that register's most
 * carefully argued default the moment it adopted this component — so the naive shim stays OUT
 * of this file and lives only as the perturbation in gas_shared/test/contracts/settingsReadouts.js,
 * reproduced there and shown drawing the wrong bar.
 *
 * Knowing about severities is legitimate here — `ui/severity.js` and the `--sev-*` tokens are
 * already shared vocabulary. Knowing what a DRAFT is, is not: the caller resolves `inScope`
 * (and whatever "draft" means in its own register) before calling this.
 *
 * @param {object} spec
 * @param {string[]} spec.selectable        every severity this register can scope by, in order
 * @param {object} spec.bySeverityOpen      `{SEV: openCount}`
 * @param {object} spec.bySeverityAll       `{SEV: allTimeCount}`
 * @param {(sev: string) => boolean} spec.inScope
 * @param {number} spec.openTotal
 * @param {number} spec.total               the all-time total; only printed when it differs
 * @param {string} spec.outLabel            the trailing segment's label ("Not scanned", …)
 * @param {string} spec.unit                REQUIRED, same refusal as impactSplitModel's
 * @returns {{segments: object[], caption: string, ariaLabel: string, inScopeCount: number}}
 */
export function severitySplitModel({
  selectable, bySeverityOpen, bySeverityAll, inScope, openTotal, total, outLabel, unit,
}) {
  if (!unit) {
    throw new Error(
      "severitySplitModel(): unit is required — \"findings\" is right in some registers and "
      + "wrong in others, so it is never defaulted.",
    );
  }
  if (typeof inScope !== "function") {
    throw new Error(
      "severitySplitModel(): inScope must be a predicate (sev) => boolean, never a selected "
      + "array — see this module's own header for why a shared includes() shim would silently "
      + "invert an empty-selection-means-all register.",
    );
  }
  const byOpen = bySeverityOpen || {};
  const byAll = bySeverityAll || {};
  const segments = [];
  const parts = [];
  let inScopeCount = 0;
  for (const sev of selectable || []) {
    const n = byOpen[sev] || 0;
    if (inScope(sev)) {
      inScopeCount += n;
      segments.push({ label: sev, value: n, tone: sev });
      parts.push(`${sev} ${openAndTotal(n, byAll[sev] || 0)}`);
    } else {
      // A comma, not a second parenthetical: two bracketed asides on one item stop a reader
      // scanning cleanly. The list separator is "·", so a comma inside an item is
      // unambiguous.
      parts.push(`${sev} ${openAndTotal(n, byAll[sev] || 0)}, ${String(outLabel).toLowerCase()}`);
    }
  }
  segments.push({ label: outLabel, value: Math.max(0, (openTotal || 0) - inScopeCount), tone: "out" });
  const caption = `${parts.join(" · ")} — ${fmt(inScopeCount)} of ${fmt(openTotal)} `
    + `open ${unit} scanned${total > openTotal ? `, ${fmt(total)} in the register all time` : ""}.`;
  const ariaLabel = `${fmt(inScopeCount)} of ${fmt(openTotal)} open ${unit} are in the scan scope`;
  return { segments, caption, ariaLabel, inScopeCount };
}

// ============================================================================= tick timeline

/**
 * A labelled tick sequence, drawn whole on every call — nothing in it is interactive.
 *
 * IT NEVER COMPUTES A TICK'S STATE. `ticks` arrives pre-resolved (`{state, hint}` per tick);
 * `wouldSeal`-shaped arithmetic is a domain decision and stays in each app's own client
 * mirror (gas's `retentionTicks(scans, retentionDays)`).
 *
 * REFUSAL: a state carrying a glyph but no word throws — the same rule `quadTable` applies to
 * a corner with a tone and no label. Fill is never the only cue.
 *
 * @param {object} spec
 * @param {{state: string, hint?: string}[]} spec.ticks
 * @param {object} spec.states    `{stateKey: {glyph: string, word: string}}` — a state absent
 *   from this map (or carrying no glyph) draws a bare, unlabelled tick
 * @param {string} [spec.legend]   the words under the ticks naming every glyph
 * @param {string} [spec.summary]  the sentence under the legend
 * @param {string} [spec.ariaLabel]
 * @returns {Node}
 */
export function tickTimeline({ ticks, states, legend, summary, ariaLabel }) {
  const list = ticks || [];
  const st = states || {};
  for (const [key, s] of Object.entries(st)) {
    if (s && s.glyph && !s.word) {
      throw new Error(
        `tickTimeline(): state ${JSON.stringify(key)} carries a glyph but no word — fill is `
        + "never the only cue.",
      );
    }
  }
  const track = el("div", {
    class: "tick-timeline", role: "img", "aria-label": ariaLabel || "",
  });
  for (const t of list) {
    const s = st[t.state] || {};
    const tick = el(
      "div",
      { class: `tick-timeline__tick${t.state ? ` tick-timeline__tick--${t.state}` : ""}` },
      el("span", { class: "tick-timeline__glyph", "aria-hidden": "true" }, s.glyph || ""),
      el("span", { class: "tick-timeline__bar" }),
    );
    if (t.hint) tipAnchor(tick, () => [t.hint]);
    track.append(tick);
  }
  return el(
    "div", {},
    el("div", { class: "tick-timeline-scroll" }, track),
    legend ? el("p", { class: "muted small" }, legend) : null,
    summary ? el("p", { class: "muted small" }, summary) : null,
  );
}

// ============================================================================ cut histogram

/**
 * A bucketed distribution with a draggable cut line. Built EXACTLY ONCE; `update()` only ever
 * rewrites bar heights, the `above` modifier, the cutline offset, the slider's own value, the
 * axis label and the unmeasured line — it NEVER re-creates the `<input type="range">`.
 *
 * THIS IS LOAD-BEARING, NOT A STYLE CHOICE. The range fires `input` continuously while being
 * dragged, and replacing that element mid-drag silently aborts it: the browser stops
 * delivering `input` events to a node once it is removed from the document. gas's own EPSS
 * threshold slider carried this exact comment before the move; gas_shared/test/contracts/
 * settingsReadouts.js pins the same claim as an identity assertion, not just a comment.
 *
 * TWO GENERALISATIONS FROM THE EPSS ORIGINAL. The cutline offset is `((cut-min)/(max-min))*100`
 * rather than assuming a 0..1 domain and multiplying the cut by 100; a bar's `above` state
 * compares its own bucket start to the cut IN THE VALUE DOMAIN, not against an index. `format`
 * is the caller's own number vocabulary for the axis ends and the cut label ("0.29" for EPSS,
 * "14 d" for a day count); `scale` picks how a count becomes a bar height.
 *
 * @param {object} spec
 * @param {number} spec.min
 * @param {number} spec.max
 * @param {number} spec.step
 * @param {number} spec.buckets
 * @param {string} spec.ariaLabel
 * @param {(v: number) => string} spec.format
 * @param {"sqrt"|"linear"} [spec.scale]   default "sqrt"
 * @param {string} [spec.axisNote]         a static line under the axis, written once
 * @param {(start: number, end: number, n: number) => string} [spec.barTip]
 * @param {(v: number) => void} [spec.onCut]  fires on every `input` event while dragging
 * @returns {{node: Node, update: (state: {counts: number[], cut: number,
 *   unmeasuredNote?: string}) => void}}
 */
export function createCutHistogram({
  min, max, step, buckets, ariaLabel, format, scale = "sqrt", axisNote, barTip, onCut,
}) {
  if (scale !== "sqrt" && scale !== "linear") {
    throw new Error(
      `createCutHistogram(): scale must be "sqrt" or "linear", got ${JSON.stringify(scale)}`,
    );
  }
  const bars = el("div", { class: "cut-hist" });
  const cutline = el("div", { class: "cut-hist__cutline", "aria-hidden": "true" });
  const wrap = el("div", { class: "cut-hist-wrap" }, bars, cutline);
  const range = el("input", {
    type: "range", class: "cut-hist__range",
    min: String(min), max: String(max), step: String(step),
    "aria-label": ariaLabel,
  });
  const cutLabel = el("span", { class: "num" });
  const axis = el(
    "div", { class: "cut-hist__axis small muted" },
    el("span", {}, format(min)), cutLabel, el("span", {}, format(max)),
  );
  const noteEl = axisNote ? el("p", { class: "cut-hist__note muted small" }, axisNote) : null;
  const unmeasuredEl = el("p", { class: "cut-hist__unmeasured muted small" });

  const node = el(
    "div", {},
    el("div", { class: "cut-hist-scroll" }, wrap),
    range, axis, noteEl, unmeasuredEl,
  );

  range.addEventListener("input", () => {
    if (onCut) onCut(Number(range.value));
  });

  function update({ counts, cut, unmeasuredNote }) {
    const list = counts || [];
    range.value = String(cut);
    cutLabel.textContent = `${format(cut)} (current cut)`;

    clear(bars);
    const maxCount = Math.max(...list, 1);
    const scaleFn = scale === "linear"
      ? (n) => (maxCount ? (n / maxCount) * 100 : 0)
      : (n) => (maxCount ? (Math.sqrt(n) / Math.sqrt(maxCount)) * 100 : 0);
    const per = (max - min) / (list.length || buckets || 1);
    list.forEach((n, i) => {
      const start = min + i * per;
      const above = start >= cut;
      const bar = el("div", { class: `cut-hist__bar${above ? " cut-hist__bar--above" : ""}` });
      if (barTip) tipAnchor(bar, () => [barTip(start, start + per, n)]);
      bar.style.height = n === 0 ? "0%" : `${Math.max(2, scaleFn(n))}%`;
      bars.append(bar);
    });
    cutline.style.left = `${((cut - min) / (max - min)) * 100}%`;

    unmeasuredEl.textContent = unmeasuredNote || "";
  }

  return { node, update };
}
