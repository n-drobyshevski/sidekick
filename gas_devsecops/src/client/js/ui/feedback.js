// What the app says when it is loading, empty, broken, or asking.
//
// The help tip that used to live here is now ui/tip.js: it outgrew this file the moment it
// stopped being a bubble parked inside its trigger.

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

/**
 * A column of placeholder lines — the `flex-column + N skeleton lines` idiom that every
 * page's loading stub had written out inline, with its own gap and its own array literal.
 *
 * `widths` cycles, so a stack can look like text rather than like a stack of identical
 * bars. Each page keeps its own SHAPE (the stub IS the layout, and a stub that predicts
 * the wrong page makes the real content jump); only this repetition is shared.
 */
export function skeletonStack(count, { gap = "12px", height, widths, variant = "line" } = {}) {
  const stack = el("div", { class: "skeleton-stack" });
  stack.style.gap = gap;
  for (let i = 0; i < count; i++) {
    stack.append(skeleton(variant, {
      height,
      width: widths ? widths[i % widths.length] : undefined,
    }));
  }
  return stack;
}

export function emptyState(message, hint) {
  return el(
    "div",
    { class: "empty", role: "status" },
    el("div", {}, message),
    hint ? el("div", { class: "small", style: "margin-top:6px" }, hint) : null,
  );
}
