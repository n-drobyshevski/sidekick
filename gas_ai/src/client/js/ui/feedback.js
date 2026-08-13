// What the app says when it is loading, empty, broken, or asking — plus the help tip that
// replaces `title=` wherever the explanation matters.

import { el } from "./dom.js";

export function toast(message, kind) {
  let host = document.getElementById("toasts");
  if (!host) {
    host = el("div", { id: "toasts" });
    document.body.append(host);
  }
  const t = el("div", { class: `toast ${kind || ""}`, role: "status" }, message);
  host.append(t);
  setTimeout(() => t.remove(), 6000);
}

/** Modal confirm dialog; resolves true/false. */
export function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dlg = el(
      "dialog",
      {},
      el("h3", {}, title),
      typeof body === "string" ? el("p", { class: "muted" }, body) : body,
      el(
        "div",
        { class: "dialog-actions" },
        el("button", { onclick: () => done(false) }, "Cancel"),
        el(
          "button",
          { class: danger ? "danger" : "primary", onclick: () => done(true) },
          confirmLabel,
        ),
      ),
    );
    function done(v) {
      dlg.close();
      dlg.remove();
      resolve(v);
    }
    dlg.addEventListener("cancel", () => done(false));
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * Failure, not emptiness: announced, retryable in place, and the raw exception demoted
 * into a disclosure instead of printed at the reader as body copy.
 */
export function errorState(message, o) {
  const p = o || {};
  return el(
    "div",
    { class: "empty empty--error", role: "alert" },
    el("div", {}, message),
    p.onRetry
      ? el("div", { class: "empty-actions" },
          el("button", { class: "primary", onclick: p.onRetry }, "Try again"))
      : null,
    p.detail
      ? el("details", { class: "empty-detail" },
          el("summary", {}, "Technical details"),
          el("div", { class: "small" }, String(p.detail)))
      : null,
  );
}

/**
 * Loading placeholder block: a calm opacity pulse (no shimmer sweep — DESIGN.md forbids the
 * SaaS tell), aria-hidden so screen readers hear the page's role=status label instead. Variants
 * (line/title/stat/pill/chart) set default height/radius; width/height/radius override inline.
 * Reduced motion drops the pulse for a static hairline block (in styles.css).
 */
export function skeleton(variant = "", { width, height, radius } = {}) {
  const node = el("div", {
    class: `skeleton${variant ? " skeleton--" + variant : ""}`,
    "aria-hidden": "true",
  });
  if (width) node.style.width = width;
  if (height) node.style.height = height;
  if (radius) node.style.borderRadius = radius;
  return node;
}

export function emptyState(message, hint) {
  return el(
    "div",
    { class: "empty", role: "status" },
    el("div", {}, message),
    hint ? el("div", { class: "small", style: "margin-top:6px" }, hint) : null,
  );
}

let _helpTipSeq = 0;

/**
 * Wrap `content` so hovering or focusing it reveals a quiet card explaining `lines`.
 * Reveal is pure CSS (`:hover` / `:focus-within`); the wrapper is focusable so keyboard
 * users get it too, and is `aria-describedby` a bubble that stays in the DOM at opacity 0
 * so screen readers announce the text either way. Escape blurs to dismiss.
 *
 * This replaces `title=` for anything that matters. A native tooltip is unreachable by
 * keyboard, invisible on touch, and truncated by the OS — fine for a hint, wrong for the
 * page's central disclaimer about what it is not showing you.
 */
export function helpTip(content, lines, { label, className } = {}) {
  const items = Array.isArray(lines) ? lines : [lines];
  const id = `helptip-${++_helpTipSeq}`;
  const bubble = el(
    "span",
    { class: "helptip-bubble", role: "tooltip", id },
    ...items.map((t) => el("span", { class: "helptip-line" }, t)),
  );
  // Pinned to the viewport just before each reveal. Absolutely positioned inside the
  // trigger it would be clipped by any overflow ancestor — and this one lives inside
  // .workbench-body, which is overflow:hidden, so an in-flow bubble would be cut off
  // entirely. Coordinates are recomputed on every reveal, so there is nothing to clean up
  // on hide (an opacity-0 fixed bubble cannot affect layout). Below by default, flipped
  // above when it would cross the viewport bottom, clamped to the side edges.
  const place = (wrapper) => {
    const r = wrapper.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 8);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8));
    bubble.style.position = "fixed";
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };
  const attrs = {
    class: `helptip${className ? " " + className : ""}`,
    tabindex: "0",
    "aria-describedby": id,
    onkeydown: (e) => { if (e.key === "Escape") e.currentTarget.blur(); },
    onmouseenter: (e) => place(e.currentTarget),
    onfocusin: (e) => place(e.currentTarget),
  };
  if (label) attrs["aria-label"] = label;
  const kids = Array.isArray(content) ? content : [content];
  return el("span", attrs, ...kids, bubble);
}
