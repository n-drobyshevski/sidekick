// The card shell for the standalone pages doGet serves INSTEAD of the app — the denial page
// and the entry screen.
//
// It exists as one module because one person can see both in sequence: turned away on the
// wrong Google account, then welcomed after switching. Two hand-maintained copies of the same
// card would drift, and the drift would show up precisely in that sequence.
//
// These pages carry their own inline CSS rather than the `styles` partial. That partial is
// ~84KB of the whole design system, inlined into every response — worth it for the app, absurd
// for a card with two sentences on it, and in the denial case it would ship the design system
// to someone being turned away. The handful of rules below are the DESIGN.md tokens the card
// actually uses, and nothing else.

// THE MARK, A THIRD TIME — and copied rather than imported, deliberately.
//
// src/client/js/brandMark.js is the source; src/client/index.html already carries a second
// copy because the splash paints before any JavaScript runs, and test/brandMark.test.js pins
// that copy to the module's constants. These pages need a third for a different reason: they
// are served by the SERVER bundle, and the module lives in the client one.
//
// Importing it across that line was tried and rejected on two counts. tsc refuses (`allowJs`
// is off, so the .js has no declarations) and would need a hand-written .d.ts shim. Worse,
// brandMark.js imports svgEl from uiIcons.js, which calls document.createElementNS — today
// only inside a function, so tree-shaking drops it, but it would put a DOM module in the
// server bundle's graph, one refactor away from evaluating `document` inside doGet. That is a
// total outage traded for a decorative glyph.
//
// So the geometry below is duplicated and pinned by the same test that pins index.html — the
// pattern that file already documents: a duplication forced by the platform, held by a test
// rather than by a comment. Only the COMPACT crop is here: it is a viewBox over the same
// artwork with the globe left out, which is ~500 bytes instead of ~5KB, and it is the crop the
// app header uses at this size for the reason brandMark.js gives — 307 dots inside a 22px
// glyph read as grey noise.
//
// The literal hex is on the presentation attributes, exactly as in the module, which is what
// lets the mark draw correctly on these pages with no stylesheet behind it.
const MARK_COMPACT_VIEWBOX = "12.2 8.4 52.7 74";
const MARK_COMPACT_RATIO = 52.7 / 74;
const MARK_ORBIT =
  "M47.64 80.58A32.1 32.1 0 0 1 17.83 52.04M19.82 36.92A32.1 32.1 0 0 1 54.21 16.76";
const MARK_ORBIT_WIDTH = 2.41;
const MARK_NODES: number[][] = [[17.22, 44.33, 4.41], [45.96, 16.55, 7.56]];
const MARK_SHIELD =
  "M48.56 29.88C52.79 34.78 58.69 37.87 64.33 37.81C64.44 45.48 63.64 48.51 62.11 51.96" +
  "C61.32 54.62 56.36 61.55 48.56 64.18C40.76 61.55 35.8 54.62 35.01 51.96" +
  "C33.48 48.51 32.68 45.48 32.79 37.81C38.43 37.87 44.33 34.78 48.56 29.88Z";
const MARK_CHECK = "M42.3 48.81 46.19 52.7 54.89 43.99";
const MARK_CHECK_WIDTH = 3.04;

/**
 * The compact mark as markup. `height` is the height in px; the crop is taller than it is
 * wide, so the width follows from the ratio — the same contract brandMark() keeps.
 *
 * aria-hidden, never labelled: it sits beside the words "Wiz Sidekick OS" here exactly as it
 * does in the app header, and a labelled copy would announce the product name twice.
 */
function brandMarkSvg(height: number): string {
  const width = Math.round(height * MARK_COMPACT_RATIO * 100) / 100;
  const nodes = MARK_NODES.map(
    (n) => '<circle cx="' + n[0] + '" cy="' + n[1] + '" r="' + n[2] + '" fill="#0a0a0a"/>',
  ).join("");
  return [
    '<svg class="brand-mark" viewBox="' + MARK_COMPACT_VIEWBOX + '"',
    ' width="' + width + '" height="' + height + '" focusable="false" aria-hidden="true">',
    '<path d="' + MARK_ORBIT + '" fill="none" stroke="#0a0a0a" stroke-width="' + MARK_ORBIT_WIDTH,
    '" stroke-linecap="round"/>',
    nodes,
    '<path d="' + MARK_SHIELD + '" fill="#0a0a0a"/>',
    '<path d="' + MARK_CHECK + '" fill="none" stroke="#ffffff" stroke-width="' + MARK_CHECK_WIDTH,
    '" stroke-linecap="round" stroke-linejoin="round"/>',
    "</svg>",
  ].join("");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CardPageSpec {
  /** Browser tab title. */
  title: string;
  /** The wordmark beside the glyph, above the heading. */
  eyebrow: string;
  /** The one-line statement the page exists to make. */
  heading: string;
  /**
   * Body paragraphs, as HTML FRAGMENTS — `<strong>` and friends are allowed, so anything
   * originating outside this module (an email address, a URL) must already have been through
   * escapeHtml(). Same contract for `actions`.
   */
  paragraphs: string[];
  /** Optional action row: a primary link-button and/or a secondary text link. */
  actions?: string;
}

/** A primary action, styled as DESIGN.md's one committing action per context. */
export function primaryAction(href: string, label: string): string {
  // target="_top" is not decoration: HtmlService serves these pages inside a sandbox iframe on
  // googleusercontent.com, so a link without it navigates the FRAME and dead-ends on a page
  // that cannot reach the app. The <base> below covers anchors that forget, this makes it
  // explicit on the one link the page exists to offer.
  return (
    '<a class="btn" target="_top" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>"
  );
}

/** A secondary text link, beside or below the primary action. */
export function secondaryAction(href: string, label: string): string {
  return (
    '<a class="alt" target="_top" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>"
  );
}

export function cardPage(spec: CardPageSpec): string {
  const body = spec.paragraphs.map((p) => "<p>" + p + "</p>").join("");
  const actions = spec.actions ? '<div class="actions">' + spec.actions + "</div>" : "";
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    // Every link on these pages has to break out of the HtmlService sandbox iframe; the app's
    // own index.html carries the same base tag for the same reason.
    '<base target="_top">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + escapeHtml(spec.title) + "</title><style>",
    "*{box-sizing:border-box}",
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
    "background:#f8fafc;color:#0a0a0a;",
    "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
    ".card{max-width:32rem;margin:24px;padding:32px;background:#fff;border:1px solid #e2e8f0;",
    "border-radius:14px;box-shadow:0 1px 2px rgba(10,10,10,.06)}",
    ".lockup{display:flex;align-items:center;gap:8px;margin:0 0 16px}",
    // Mirrors .appbar-name in styles.css (600 / 1rem / -0.02em) so the wordmark is the same
    // object here as in the header, not a near-miss of it.
    ".lockup span{font-weight:600;font-size:1rem;letter-spacing:-0.02em;color:#0a0a0a;",
    "white-space:nowrap}",
    ".brand-mark{display:block;flex:0 0 auto}",
    "h1{font-size:20px;line-height:1.3;margin:0 0 12px;font-weight:650}",
    "p{margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155}",
    ".actions{margin-top:24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}",
    // Graphite, not the blue accent: DESIGN.md keeps Signal Blue for data, focus and links, and
    // fills the one committing action with the neutral near-black.
    ".btn{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;",
    "border-radius:8px;background:#0a0a0a;color:#fafafa;font-size:14px;font-weight:500;",
    "text-decoration:none}",
    ".btn:hover{background:#27272a}",
    "a{color:#2563eb}",
    // Never remove: CLAUDE.md names the focus-ring rules load-bearing, and these pages are
    // reachable by keyboard only.
    "a:focus-visible{outline:2px solid #2563eb;outline-offset:2px;border-radius:4px}",
    "</style></head><body><main class=\"card\">",
    // The same lockup as the app header — mark then wordmark — so the door and the room
    // behind it are recognisably one product.
    '<div class="lockup">' + brandMarkSvg(22) +
      "<span>" + escapeHtml(spec.eyebrow) + "</span></div>",
    "<h1>" + escapeHtml(spec.heading) + "</h1>",
    body,
    actions,
    "</main></body></html>",
  ].join("");
}
