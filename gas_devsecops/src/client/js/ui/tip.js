// One hover vocabulary, for a register that already writes the words and shows them to
// nobody.
//
// This app composes real prose for assistive technology and then paints a glyph. Every
// lattice cell holds its whole vector sentence in an aria-label; every graph node holds kind,
// severity, score, percentile and toxic-combination membership in one; the compliance rail
// holds several sentences including the 5Rs derived-vs-Wiz arithmetic; the toxic-combination
// matrix writes "tested by the rule, carried by 9 of 12 assets" into an .sr-only span and
// draws a dot. So this module is mostly not about writing tooltips. It is about letting the
// POINTER reach prose the app already wrote.
//
// It replaces three vocabularies at once: ~40 native `title=` attributes (keyboard-
// unreachable, invisible on touch, truncated by the OS, half a second late), the SVG <title>
// on every graph edge (worse on all four counts), and the old helpTip. `el()` now throws on a
// `title` attribute so the first two cannot come back.
//
// WHAT THE OLD helpTip GOT WRONG, since this is a rewrite and not a rename:
//
//   1. It failed WCAG 2.1 SC 1.4.13 (Dismissible). The reveal was CSS `:hover` and Escape
//      called blur(), which does nothing for a pointer user — the card could not be dismissed
//      without moving the mouse, which is the one thing the criterion asks for.
//   2. It placed once, on mouseenter, with no scroll listener, so scrolling stranded the card
//      while the trigger moved out from under it.
//   3. It used `position: fixed` INSIDE the trigger. `.sheet` carries a transform, and a
//      transform makes an element the containing block for fixed descendants — so a tip in a
//      record sheet would place against the sheet, not the window. Under reduced motion the
//      sheet's transform is `none` and the bug disappears, which would have made it look
//      reader-dependent. The card is portaled to <body> now, which settles that and the
//      overflow clipping in .table-wrap, .lat-scroll and .workbench-body along with it.
//
// ONE CARD, ONE SET OF LISTENERS. There is a single .tip node on <body> and five delegated
// document listeners, whatever the anchor count. The alternative — a hidden bubble per
// trigger, as helpTip did — puts hundreds of nodes on a dense table page and hundreds more
// strings in the accessibility tree.
//
// THE ACCESSIBILITY SPLIT. The card itself is aria-hidden, always. The text reaches assistive
// technology one of two ways, and choosing right at each call site is the judgement this
// module asks for:
//
//   spoken: false   the anchor already says it (an aria-label, an .sr-only sibling). The tip
//                   is purely visual and adds nothing, so nothing double-announces. Every
//                   anchor in the paragraph at the top of this file is this mode.
//   default         a .sr-only span is emitted beside the trigger and named by
//                   aria-describedby, so the text is there whether or not a card is showing.
//
// NO FOCUSABLE CONTENT IN A CARD, EVER. The old glossary bubble held a "Full definition" link,
// which is why it had to drop role="tooltip", and which would have fought the sheet's Tab trap
// the moment a tip appeared inside a sheet. A glossary trigger NAVIGATES instead: hover or
// focus shows the definition, Enter or a tap opens the entry. That is also why this module
// never calls portalOpened() — there is nothing in the card for the trap to stand down for.

import { coarse, el } from "./dom.js";
import { popoverDismiss } from "./popover.js";
import { navigate } from "../store.js";
import { findEntry } from "../helpContent.js";
import { CLOSE_GRACE, glossaryTipLines, tipDelay, tipPlacement } from "./tipPlace.js";

/** Anchor element -> a function returning its copy, so dynamic anchors stay current. */
const COPY = new WeakMap();
/** Anchor element -> what activating it should do (glossary triggers navigate). */
const ACTIVATE = new WeakMap();

let host = null;
let arrow = null;
let bodyEl = null;
let wired = false;

let current = null; // the anchor whose card is showing
let openTimer = 0;
let closeTimer = 0;
let lastClosed = -Infinity;
let release = null;
// The anchor an Escape dismissed. It stays muted until the pointer leaves it, so the card
// does not reopen underneath a cursor that has not moved — SC 1.4.13 again, from the other
// side: dismissing has to mean something.
let muted = null;

let seq = 0;

function ensureHost() {
  if (host) return host;
  arrow = el("span", { class: "tip-arrow" });
  bodyEl = el("span", { class: "tip-body" });
  host = el("div", { class: "tip", "aria-hidden": "true" }, arrow, bodyEl);
  document.body.append(host);
  host.addEventListener("pointerenter", () => {
    if (host.classList.contains("passive")) return;
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  });
  host.addEventListener("pointerleave", () => {
    if (host.classList.contains("passive")) return;
    scheduleClose();
  });
  return host;
}

/** Normalise whatever a caller passed as copy into the card's own shape. */
function asCopy(value) {
  if (!value) return null;
  if (Array.isArray(value)) return { lines: value };
  if (typeof value === "string") return { lines: [value] };
  if (value.lines) return value;
  return { lines: [value] };
}

function paint(copy) {
  const node = ensureHost();
  while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
  if (copy.aka) bodyEl.append(el("span", { class: "tip-aka" }, copy.aka));
  for (const line of copy.lines) {
    if (line === null || line === undefined || line === false || line === "") continue;
    bodyEl.append(el("span", { class: "tip-line" }, line));
  }
  if (copy.more) {
    bodyEl.append(el(
      "span",
      { class: "tip-more" },
      coarse() ? "Tap again for the full definition" : copy.more,
    ));
  }
  return node;
}

function place(rect) {
  const box = host.getBoundingClientRect();
  const p = tipPlacement(
    rect,
    { width: box.width, height: box.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  host.style.left = p.left + "px";
  host.style.top = p.top + "px";
  host.setAttribute("data-side", p.side);
  arrow.style.left = p.arrow + "px";
}

function show(anchor, copy, opts) {
  const { passive = false, rect = null } = opts || {};
  if (release) { release(); release = null; }
  paint(copy);
  host.classList.toggle("passive", passive);
  current = passive ? null : anchor;
  // Measured with the content in place but before .open, so the card is sized and invisible
  // rather than sized and in the wrong spot for one frame.
  place(anchor ? anchor.getBoundingClientRect() : rect);
  host.classList.add("open");
  if (passive || !anchor) return;

  const reposition = () => {
    if (!anchor.isConnected) { closeTip(); return; }
    place(anchor.getBoundingClientRect());
  };
  release = popoverDismiss({
    pop: host,
    anchor,
    isInside: (node) => !!node && (host.contains(node) || anchor.contains(node) || node === anchor),
    close: () => closeTip(),
    // Escape is the pointer user's only way out, and popoverDismiss stops it propagating so
    // the sheet underneath survives the same keystroke.
    onEscape: () => { muted = anchor; closeTip(); },
    onFocusOut: () => closeTip(),
    onReposition: reposition,
    hosts: [host],
  });
}

function scheduleOpen(anchor, viaFocus) {
  if (muted === anchor) return;
  const get = COPY.get(anchor);
  if (!get) return;
  window.clearTimeout(closeTimer);
  closeTimer = 0;
  if (current === anchor && host && host.classList.contains("open")) return;
  const delay = tipDelay({ viaFocus, sinceLastClose: Date.now() - lastClosed });
  window.clearTimeout(openTimer);
  const run = () => {
    openTimer = 0;
    if (!anchor.isConnected) return;
    const copy = asCopy(get());
    if (!copy || !copy.lines.length) return;
    show(anchor, copy, {});
  };
  if (delay === 0) run();
  else openTimer = window.setTimeout(run, delay);
}

function scheduleClose() {
  window.clearTimeout(openTimer);
  openTimer = 0;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(closeTip, CLOSE_GRACE);
}

/** Close whatever is showing. Called on route change so a card never outlives its page. */
export function closeTip() {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  openTimer = 0;
  closeTimer = 0;
  if (release) { release(); release = null; }
  if (!host) return;
  if (host.classList.contains("open")) lastClosed = Date.now();
  host.classList.remove("open");
  host.classList.remove("passive");
  current = null;
}

// ------------------------------------------------------------------ delegated listeners
// Five listeners for the whole app. pointerover/pointerout bubble (pointerenter/leave do
// not), which is what makes one pair enough for several hundred table cells.

function anchorFrom(node) {
  if (!node || !node.closest) return null;
  return node.closest("[data-tip]");
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("pointerover", (e) => {
    const anchor = anchorFrom(e.target);
    if (!anchor || anchor.contains(e.relatedTarget)) return;
    scheduleOpen(anchor, false);
  });
  document.addEventListener("pointerout", (e) => {
    const anchor = anchorFrom(e.target);
    if (!anchor || anchor.contains(e.relatedTarget)) return;
    if (muted === anchor) muted = null;
    if (host && host.contains(e.relatedTarget)) return;
    scheduleClose();
  });
  document.addEventListener("focusin", (e) => {
    const anchor = anchorFrom(e.target);
    if (anchor) scheduleOpen(anchor, true);
  });
  document.addEventListener("focusout", (e) => {
    const anchor = anchorFrom(e.target);
    if (!anchor) return;
    if (muted === anchor) muted = null;
    if (current === anchor) closeTip();
  });
  document.addEventListener("click", (e) => {
    const anchor = anchorFrom(e.target);
    if (!anchor) return;
    // Where there is no hover, the first tap has to do the hovering. A glossary trigger
    // therefore reveals on the first tap and follows through on the second.
    if (coarse() && current !== anchor) {
      e.preventDefault();
      muted = null;
      scheduleOpen(anchor, true);
      return;
    }
    const act = ACTIVATE.get(anchor);
    if (act) act(e);
  });
}

/**
 * Make `node` an anchor. `getCopy` is called at reveal time, so an anchor whose numbers
 * change between renders never serves a stale card.
 */
function anchorTip(node, getCopy) {
  wire();
  COPY.set(node, typeof getCopy === "function" ? getCopy : () => getCopy);
  node.setAttribute("data-tip", "");
  return node;
}

const INTERACTIVE = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1 };

/** A term-backed trigger: underlined so it reads as defined, and it leads to the entry. */
function markTerm(trigger, term) {
  trigger.classList.add("tip-trigger--term");
  ACTIVATE.set(trigger, () => navigate("help", { term }));
}

/**
 * A caller's own copy, plus the line that says the book has more.
 *
 * Several triggers say something sharper in place than the entry's blurb does — the query
 * builder's three lines are about THIS control, not about queries in general — so `term` adds
 * the route without taking the words away. `glossaryTip` is the other direction: when the book
 * already says it, say it once.
 */
function withTerm(lines) {
  const more = "Enter for the full definition";
  if (typeof lines === "function") {
    return () => {
      const c = asCopy(lines());
      return c ? { ...c, more: c.more || more } : c;
    };
  }
  const copy = asCopy(lines);
  return copy ? { ...copy, more: copy.more || more } : copy;
}

/**
 * The general description tip.
 *
 * `content` becomes a real `<button class="tip-trigger">` unless it is already an interactive
 * element, in which case the tip attaches to it in place — nesting a second control inside a
 * button would put two things in the tab order where the reader sees one.
 *
 * Attaching in place ALWAYS implies `spoken: false`: those anchors are the icon buttons and
 * grid cells that already carry an aria-label, and a describedby on top of it would say the
 * same sentence twice.
 */
export function tip(content, lines, opts) {
  const {
    className = "", spoken = true, label = null, term = null, describeIn = null,
  } = opts || {};
  const copy = term ? withTerm(lines) : lines;
  const first = Array.isArray(content) ? content[0] : content;
  const inPlace = first instanceof Element && INTERACTIVE[first.tagName] === 1;

  if (inPlace) {
    for (const c of className.split(" ")) if (c) first.classList.add(c);
    anchorTip(first, copy);
    if (term) markTerm(first, term);
    // Attaching in place leaves nowhere to put a description: inside the control it would be
    // folded into the control's own name and read out twice. `describeIn` is the escape hatch
    // for a caller that owns a container the span can live in beside the control — the toggle
    // group in segmented(), say. Without it the tip is visual and the control's existing
    // accessible name is what assistive technology gets, which is the honest arrangement.
    if (spoken && describeIn) describe(first, copy, describeIn);
    return first;
  }

  const trigger = el(
    "button",
    {
      type: "button",
      class: "tip-trigger" + (className ? " " + className : ""),
      "aria-label": label,
    },
    ...(Array.isArray(content) ? content : [content]),
  );
  anchorTip(trigger, copy);
  if (term) markTerm(trigger, term);
  if (!spoken) return trigger;

  // The description is a SIBLING, never a child: inside the button it would be folded into
  // the button's own accessible name and read out twice in a row.
  const wrap = el("span", { class: "tip-wrap" }, trigger);
  describe(trigger, copy, wrap);
  return wrap;
}

/** Say the card's text to assistive technology, from a node that is not inside the control. */
function describe(trigger, copy, into) {
  const c = asCopy(typeof copy === "function" ? copy() : copy);
  const said = c ? c.lines.filter((l) => typeof l === "string").join(" ") : "";
  if (!said) return;
  const id = "tip-d-" + ++seq;
  trigger.setAttribute("aria-describedby", id);
  into.append(el("span", { class: "sr-only", id }, said));
}

/**
 * Put a definition on a label, from whatever the caller happens to have.
 *
 * The shared primitives below (kpiCard, statRow, statusPill, the segmented options) all want
 * the same three shapes: a string or lines of their own, a term from the book, or both. This
 * is the one place that decides between them, so a `help` argument means the same thing on
 * every primitive that takes one.
 */
/**
 * Any `help` shape as plain lines, for a caller that has to place the card itself.
 *
 * tipLabel() builds a trigger; a sortable column heading already IS a control and only wants
 * the words. Both go through the same three shapes so `help` means one thing everywhere.
 */
export function tipLines(help) {
  if (!help) return null;
  if (typeof help === "string") return [help];
  if (Array.isArray(help)) return help;
  if (help.lines) return help.lines;
  if (help.term) {
    const copy = glossaryTipLines(findEntry(help.term));
    return copy ? copy.lines : null;
  }
  return null;
}

export function tipLabel(content, help) {
  if (!help) return content;
  if (typeof help === "string" || Array.isArray(help)) return tip(content, help);
  if (help.lines) return tip(content, help.lines, { term: help.term || null });
  if (help.term) return glossaryTip(content, help.term);
  return content;
}

/** The bare "?" affordance, for a control whose explanation has no chip to ride on. */
export function tipMark() {
  return el("span", { class: "tip-mark", "aria-hidden": "true" }, "?");
}

/**
 * A term from the book, read where it is drawn.
 *
 * The definition is written once, in helpContent.js, and the trigger leads to the whole entry
 * rather than carrying a link inside the card. An id the book no longer holds degrades to the
 * plain label; test/helpContent.test.js is what catches the rename, at build time.
 */
export function glossaryTip(content, entryId, opts) {
  const copy = glossaryTipLines(findEntry(entryId));
  if (!copy) {
    const kids = Array.isArray(content) ? content : [content];
    return el("span", {}, ...kids);
  }
  return tip(content, { aka: copy.aka, lines: copy.lines }, { ...(opts || {}), term: entryId });
}

/**
 * A hover card backed by the book, on something that is NOT a control.
 *
 * The badges this serves — an outcome, a tier, a score chip — sit one per row inside table
 * rows that are themselves focusable buttons. Making each of them a button too would nest an
 * interactive element inside an interactive row and put four hundred new stops in the tab
 * order of a page whose rows already announce every one of these values. So the DEFINITION
 * with its route to the entry lives on the column header, which is asked once; the badge
 * itself just answers "what does this word mean" where the pointer already is.
 *
 * `lead` is the specific reading ("Priority: Act"); the book supplies the general one.
 */
export function bookTip(node, entryId, lead) {
  const copy = glossaryTipLines(findEntry(entryId));
  // `lead` may be a function, for an anchor whose specific reading changes between paints
  // without the node being rebuilt — the pillar segments repaint on every keystroke.
  return anchorTip(node, () => {
    const l = typeof lead === "function" ? lead() : lead;
    const lines = [];
    if (l) lines.push(l);
    if (copy) for (const x of copy.lines) lines.push(x);
    return lines.length ? { aka: l ? null : (copy && copy.aka), lines } : null;
  });
}

/**
 * The full value of something the layout clipped — and only when it actually clipped it.
 *
 * Measured at reveal time rather than at build time, so a column that fits says nothing and a
 * window resize is respected without re-rendering the table. Deliberately NOT a button: the
 * table rows this sits in are already focusable with an aria-label that carries the row, so
 * turning several hundred cells into controls would wreck the table for a value assistive
 * technology already has. The aria-label below is how a screen reader gets it instead.
 */
export function truncTip(node, fullText) {
  const text = String(fullText === null || fullText === undefined ? "" : fullText);
  if (!text) return node;
  // An aria-label ONLY when the DOM text is short too. A CSS ellipsis clips the pixels and
  // leaves the text node whole, so assistive technology already has the value and a label
  // here would only shadow a richer one on a badge inside the cell. A JS truncation — the
  // graph card cutting a name to fifteen characters — really did lose it, and this is where
  // it comes back.
  if (node.textContent !== text) node.setAttribute("aria-label", text);
  anchorTip(node, () => (node.scrollWidth > node.clientWidth + 1 ? [text] : null));
  return node;
}

/**
 * An anchor that cannot host an HTML wrapper: an SVG edge, an icicle band, an ego spoke.
 *
 * The card is positioned from a rectangle, so SVG is not a special case — SVGElement answers
 * getBoundingClientRect() like anything else. This is what replaces the SVG <title> on every
 * edge of the security graph.
 */
export function tipAnchor(node, getCopy) {
  return anchorTip(node, getCopy);
}

/**
 * Chart.js draws its own dark box on a canvas; this draws ours instead.
 *
 * Passive: the card takes no pointer events, because the canvas underneath is still doing the
 * hit-testing that decides what the card says. Chart.js owns show and hide here, so the intent
 * delay and the dismissal contract stay out of it.
 */
export function chartTipHandler(ctx) {
  const model = ctx.tooltip;
  if (!model || model.opacity === 0) {
    if (host && host.classList.contains("passive")) closeTip();
    return;
  }
  const lines = [];
  for (const t of model.title || []) lines.push(t);
  for (const b of model.body || []) for (const l of b.lines || []) lines.push(l);
  if (!lines.length) return;
  const canvas = ctx.chart.canvas.getBoundingClientRect();
  const x = canvas.left + model.caretX;
  const y = canvas.top + model.caretY;
  show(null, { lines }, {
    passive: true,
    rect: { left: x - 1, right: x + 1, top: y - 1, bottom: y + 1, width: 2, height: 2 },
  });
}
