// The element builder everything else is made of, plus the two environment probes
// (reduced motion, client-side download) that are DOM concerns rather than components.

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    // THE `title` BAN. A native tooltip cannot be reached by keyboard, does not exist on
    // touch, is truncated by the OS and arrives half a second late — and this app had ~40 of
    // them carrying real content: codebook definitions, the provenance of a delta, why a
    // button is disabled. ui/tip.js is the replacement, and this throw is what stops the
    // habit coming back: the dev loop is edit-and-refresh, so a reintroduced `title` fails on
    // the first render rather than shipping as a tooltip nobody can read.
    // (No backticks in the message: the middlebox guard in esbuild.config.mjs fails the build
    // on any that survive into the bundle, and a string is the one place minify cannot strip
    // them.)
    if (k === "title") {
      throw new Error("el(): the title attribute is banned, use tip() instead. Tag: " + tag);
    }
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v; // trusted, builder-side strings only
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * `host.append(...)` with el()'s child rule, for the case el() cannot cover: appending to a
 * node that already exists (main, a host div, a panel) rather than building a new one.
 *
 * THE TRAP THIS CLOSES. el() drops null / undefined / false children, so
 * `el("div", {}, maybeNothing)` is safe and reads as safe. Node.append does not: it runs
 * every argument through String(), so the same value reaching a raw .append() renders the
 * literal text "null". Several builders here return null to mean "there is no note" —
 * registerWideNote() is the common one, null whenever no project view is set — and four call
 * sites passed that straight to .append(). The word "null" was rendering above the hero on
 * Wiz Scans, above the sync history on Data, and in the AARS impact rail.
 *
 * The asymmetry is the bug, not the four call sites, so this restores the symmetry.
 */
export function appendAll(host, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    host.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return host;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Marks a figure that does not follow the view-project scope — a hairline note, not a warning:
 * the number beside it is correct, it just answers a wider question than the header is asking.
 * `data.js`'s Storage page and `history.js`'s Scan history use this for exactly the two models
 * that say so out loud (`storageModel`'s `scopeApplies: false`, `historyModel`'s
 * `scanScopeApplies: false` on `scans`/`perScope`) — see each page for where it is gated on the
 * scope actually being narrowed, since an always-on note on an unscoped register is noise.
 *
 * Lives here rather than in ui/projectScope.js because it is a plain DOM builder with no scope
 * logic of its own — the caller decides the text and whether to call it at all — and because
 * this file already anticipated it: the comment on `appendAll` above names the exact bug a
 * caller passing this straight to a raw `.append()` produces.
 *
 * @param {string} text  what this figure covers, and what it does not
 * @param {{tag?: string, live?: boolean}} [opts]  `tag` defaults to "Whole register"; `live`
 *   marks the OTHER state — the figure DOES follow the scope because it was priced again for
 *   the selected project — with the same chip, a darker ink, and no tag override needed here.
 */
export function registerWideNote(text, opts) {
  const o = opts || {};
  return el("p", { class: "register-wide-note" },
    el("span", { class: `register-wide-tag${o.live ? " scope-live-tag" : ""}` }, o.tag || "Whole register"),
    el("span", {}, text),
  );
}

/** False when the reader asked for reduced motion — every animation checks this. */
export function motionOk() {
  return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/**
 * True where there is no hover at all, so a tap has to do the work a hover would.
 *
 * Here rather than in tip.js because the nav flyout needs the same answer: two surfaces that
 * open on hover must agree on what "no hover" means, and a second copy of the query is how
 * they would quietly stop agreeing.
 */
export function coarse() {
  return !!(window.matchMedia && window.matchMedia("(hover: none)").matches);
}

/** Client-side file download from a text payload. */
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
