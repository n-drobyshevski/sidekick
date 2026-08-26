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
  /** The small uppercase label above the heading. */
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
    ".eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;",
    "color:#64748b;margin:0 0 12px}",
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
    '<p class="eyebrow">' + escapeHtml(spec.eyebrow) + "</p>",
    "<h1>" + escapeHtml(spec.heading) + "</h1>",
    body,
    actions,
    "</main></body></html>",
  ].join("");
}
