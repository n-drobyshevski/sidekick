// Where a tip lands, when it opens, and how the book's prose becomes tip copy.
//
// The DOM-free half of ui/tip.js, split out for the reason prunePanelView.js states: the
// assembly is a handful of el() calls verified by eye in the dev harness, but WHERE a card
// goes when the trigger is 40px off the bottom of the window is a decision, and decisions
// belong in vitest. There is no jsdom in this repo, so a module that touched `document`
// could not be tested at all.
//
// Everything here is pure: it takes rectangles and numbers and returns rectangles and
// numbers. `tipPlacement` never reads the window; the caller passes the viewport in.

/** The gap between the trigger and the card, and the card's keep-out from the window edge. */
export const TIP_GAP = 8;
export const TIP_MARGIN = 8;
/** Caret width, and the corner radius it must not sit on (--radius-lg). */
export const TIP_ARROW = 10;
export const TIP_RADIUS = 10;

/**
 * Cold open delay. Long enough that a pointer crossing the page does not strobe every
 * definition it passes; short enough that a reader who meant to hover is not kept waiting.
 */
export const OPEN_COLD = 220;
/**
 * After a tip closes, the next one opens instantly for this long. Scanning a row of column
 * headers is one gesture, not eight, and re-serving the cold delay on each would read as
 * the interface lagging.
 */
export const WARM_WINDOW = 400;
/**
 * The grace between leaving the trigger and the card closing. This is WCAG 2.1 SC 1.4.13's
 * "hoverable" requirement: the card is portaled to <body>, so the pointer crosses real dead
 * space on its way to it and a zero-grace close would make the card unreachable.
 */
export const CLOSE_GRACE = 120;

/**
 * Place a card of `size` against `anchor` inside `viewport`.
 *
 * Below by default. Flips above only when the card genuinely does not fit below AND there is
 * more room above — flipping toward the smaller gap would only trade one clipped edge for
 * another. Horizontally it centres on the anchor and clamps to the margins, which is why the
 * caret has to be computed rather than fixed: a card clamped against the right edge of the
 * window would otherwise point at nothing.
 *
 * `viewport.left` is the left edge of the CONTENT area — `main`'s scrollport, not the
 * window's own x=0 — and defaults to 0 for a caller with no rail to keep clear of. Below the
 * icon rail (`--rail-icon-w`, 76px) a trigger sitting near main's own left edge centres a
 * card whose left edge then clamps only against the window: at 1568px, hovering the MTTR
 * hero's "Censored" label (anchor.left=124) computed `left=8` — inside the RAIL's 0-76px
 * band, not inside the content column the card is explaining. Reusing this SAME clamp shape
 * (`Math.max(floor, Math.min(left, ceiling))`) with a content-aware floor is what
 * `ui/popover.js`'s `positionPopover` already does against the plain window edge; there is
 * no third clamp implementation here, only a floor that now knows where the content starts.
 *
 * Returns viewport coordinates for `position: fixed`, the side it chose, and the caret's
 * offset from the card's own left edge.
 */
export function tipPlacement(anchor, size, viewport, opts) {
  const { gap = TIP_GAP, margin = TIP_MARGIN } = opts || {};
  const w = size.width;
  const h = size.height;
  const vw = viewport.width;
  const vh = viewport.height;
  const contentLeft = viewport.left || 0;
  const aLeft = anchor.left;
  const aWidth = anchor.width === undefined ? anchor.right - anchor.left : anchor.width;

  const roomBelow = vh - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;
  const side = h > roomBelow && roomAbove > roomBelow ? "above" : "below";

  let top = side === "above" ? anchor.top - gap - h : anchor.bottom + gap;
  // Last-resort clamp for a card taller than either gap: it is better to overlap the trigger
  // than to run off the window, where the reader cannot follow it at all.
  top = Math.max(margin, Math.min(top, vh - h - margin));
  if (vh - margin * 2 < h) top = margin;

  const centre = aLeft + aWidth / 2;
  let left = centre - w / 2;
  // The floor is the content area's own left edge plus the margin, not the window's — the
  // ceiling stays the window's right edge minus the card, since nothing sits to main's right.
  left = Math.max(contentLeft + margin, Math.min(left, vw - w - margin));
  if (vw - contentLeft - margin * 2 < w) left = contentLeft + margin;

  // The caret stays off both corners so it never overlaps the border radius, and it is
  // pinned to the anchor's centre in between.
  const inset = TIP_RADIUS + TIP_ARROW / 2;
  let arrow = centre - left;
  if (w < inset * 2) arrow = w / 2;
  else arrow = Math.max(inset, Math.min(arrow, w - inset));

  return { left, top, side, arrow };
}

/**
 * How long to wait before showing a tip.
 *
 * Focus is instant: a keyboard user spent a Tab to get here and has already committed. A
 * pointer gets the cold delay unless another tip closed inside the warm window.
 */
export function tipDelay(state) {
  const { viaFocus = false, sinceLastClose = Infinity } = state || {};
  if (viaFocus) return 0;
  if (sinceLastClose <= WARM_WINDOW) return 0;
  return OPEN_COLD;
}

/**
 * The lead of a blurb, cut on a sentence where one is close enough and on a word otherwise.
 *
 * A tip is a reminder, not the entry. The book keeps the whole thing and the trigger leads
 * to it, so a card that ran to eight lines would be the Help page in the wrong place.
 */
export function tipLead(text, max) {
  const cap = max === undefined ? 240 : max;
  const s = String(text === null || text === undefined ? "" : text).trim();
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap);
  const stop = cut.lastIndexOf(". ");
  if (stop > cap * 0.5) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > 0 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "");
  // A word cut that happens to land on a sentence end IS a sentence. Appending an ellipsis
  // to it would read as a full stop followed by a truncation mark, which is neither.
  return /[.!?]$/.test(head) ? head : head + "\u2026";
}

/**
 * One helpContent entry as tip copy.
 *
 * `aka` is a real second name for the thing ("TC", "membership, never severity"), not a
 * restated heading, so it earns its own line. The term itself does NOT appear: the trigger
 * is the term, and a card that opens by repeating the word under the pointer is noise.
 *
 * READS `entry.lines` — helpContent.js's own shape, an array of 2-3 whole sentences — and
 * shows the FIRST TWO, which is the two-line rule stated at the top of helpContent.js ("The
 * tip card shows the first two lines") and pinned by test/helpContent.test.js's own
 * MAX_TIP_LINE_LENGTH check on exactly those two. This used to read `entry.blurb`, a field no
 * entry in the book has carried since helpContent.js moved to multi-line entries — so every
 * glossary tip in the app showed an empty card, nothing above the "Enter for the full
 * definition" line. `entry.blurb` is kept as a fallback for a caller that still hands this a
 * single-string shape rather than `lines`.
 *
 * Returns null for an entry the book does not carry, so a renamed id degrades to a plain
 * label rather than throwing on the page. test/helpContent.test.js is what catches the
 * rename itself, at build time, where it belongs.
 */
export function glossaryTipLines(entry, opts) {
  if (!entry) return null;
  const { max } = opts || {};
  const lines = Array.isArray(entry.lines) && entry.lines.length
    ? entry.lines.slice(0, 2).map((line) => tipLead(line, max))
    : [tipLead(entry.blurb, max)];
  return {
    aka: entry.aka || null,
    lines,
    term: entry.id,
    more: "Enter for the full definition",
  };
}
