// Text at scale: a monospace block you can read, scroll and copy.
//
// Nothing in this app had ever rendered a text blob before — the longest editable string
// was a 64-character gap code in a 178px input. A Wiz GraphQL document is forty lines, and
// the Wiz Scans panel shows it verbatim precisely so that what it claims the tenant is
// asked cannot drift from what the tenant is actually asked. That needs a real container.

import { el } from "./dom.js";

/**
 * Copy `text`, resolving to whether it actually landed.
 *
 * Two paths, and the fallback is not paranoia. The app runs inside HtmlService's sandboxed
 * iframe, where `navigator.clipboard` is frequently absent or rejects: the async Clipboard
 * API needs a permissions-policy grant the host frame does not hand down. `execCommand` is
 * deprecated and still the only thing that works there, so it is the fallback rather than
 * the other way round.
 *
 * The boolean matters. A copy button that says "Copied" when nothing was copied is worse
 * than one that admits it and tells you to select the text yourself.
 */
export async function copyText(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (e) {
      // Fall through — a rejected promise here is the sandbox, not a bad value.
    }
  }

  // The offscreen-textarea trick. Kept out of the layout and out of the tab order, and
  // positioned rather than hidden because `display:none` cannot hold a selection.
  const ta = el("textarea", {
    "aria-hidden": "true",
    tabindex: "-1",
    style: "position:fixed; top:-1000px; left:-1000px; opacity:0",
  });
  ta.value = value;
  document.body.append(ta);
  let ok = false;
  try {
    ta.focus();
    ta.select();
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  ta.remove();
  return ok;
}

/**
 * A read-only monospace block.
 *
 * `tabindex="0"` with a label because it scrolls: a keyboard user who cannot reach a
 * scrollable region cannot read past its first screen. It is not a widget and takes no
 * other keys, so this adds a stop, not a second keyboard model.
 */
export function codeBlock(text, { label = "", maxHeight = "" } = {}) {
  const pre = el("pre", {
    class: "code-block",
    tabindex: "0",
    role: "region",
    "aria-label": label || null,
  }, String(text ?? ""));
  if (maxHeight) pre.style.maxHeight = maxHeight;
  return pre;
}

/**
 * A button that copies `getText()` and then says what happened, in place.
 *
 * `getText` is a function rather than a string so the button can sit beside content that
 * changes — an edited variables blob — without being rebuilt and losing focus.
 */
export function copyButton(getText, { label = "Copy", copiedLabel = "Copied", title = "" } = {}) {
  let timer = null;
  const btn = el("button", {
    class: "copy-btn",
    type: "button",
    title: title || null,
  }, label);

  btn.addEventListener("click", async () => {
    const ok = await copyText(getText());
    clearTimeout(timer);
    btn.textContent = ok ? copiedLabel : "Press Ctrl+C";
    btn.classList.toggle("is-done", ok);
    // Announced as well as shown: the label change is the only feedback, and a button
    // whose text changes silently tells a screen-reader user nothing.
    btn.setAttribute("aria-live", "polite");
    if (!ok) btn.title = "Copying was blocked here — select the text and copy it yourself.";
    timer = setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove("is-done");
    }, 2000);
  });

  return btn;
}
