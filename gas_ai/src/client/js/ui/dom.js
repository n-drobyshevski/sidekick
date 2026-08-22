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

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** False when the reader asked for reduced motion — every animation checks this. */
export function motionOk() {
  return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
