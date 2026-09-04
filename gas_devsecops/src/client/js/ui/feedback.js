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

/**
 * Absence, announced — and never a stand-in for failure.
 *
 * THIS IS NOT `errorState`. A render that THREW is a defect the reader can report and often
 * retry; an empty section is a state the register is legitimately in. They were the same
 * component here until the first-run pass, which is how five pages came to print "Couldn't
 * render the half-life." inside a `role="status"` box a screen reader announces as calm news.
 *
 * THE THIRD ARGUMENT IS THE FIRST-RUN CASE, and it exists rather than a fourth component
 * because "nothing here yet" and "nothing here yet, and here is what would put something
 * here" are the same claim with the second half filled in. `items` is a list of
 * `{figure, unlock, route, routeLabel}`: WHAT is missing, WHAT would unlock it, and WHERE the
 * action lives. `route` is a hash route (`"#/settings"`); a null route means the control is
 * not a page — it is the rail's scan zone — and `routeLabel` then renders as plain text
 * rather than as a link that would go nowhere.
 *
 * Both older call shapes still work: `emptyState(msg)` and `emptyState(msg, hint)`.
 */
export function emptyState(message, hint, opts) {
  const o = opts || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const node = el(
    "div",
    { class: "empty" + (o.variant ? " empty--" + o.variant : ""), role: "status" },
    el("div", {}, message),
    hint ? el("div", { class: "small", style: "margin-top:6px" }, hint) : null,
  );
  if (items.length) {
    node.append(el("ul", { class: "empty-items" }, ...items.map((it) => el(
      "li",
      { class: "empty-item" },
      el("span", { class: "empty-item-figure" }, String(it.figure)),
      el("span", { class: "empty-item-unlock small" }, String(it.unlock)),
      it.route
        ? el("a", { class: "linklike empty-item-action", href: it.route },
            String(it.routeLabel || "Open settings"))
        : el("span", { class: "empty-item-action small muted" },
            String(it.routeLabel || "No control — it unlocks itself")),
    ))));
  }
  return node;
}

/**
 * The one line every page owes a reader whose ledger has never been read.
 *
 * WHY THIS IS ONE SENTENCE AND NOT A PANEL. Executive earns the full unlock list because it
 * is the page a leader is allowed to read alone. Every other page is already one click deep
 * and its own sections say what they are missing; what those pages owed a reader was the
 * ORIGIN — a page of dashes with no line saying "nothing has been read yet" leaves the reader
 * to decide between a broken app and an empty one.
 *
 * `synced` distinguishes two genuinely different states. No sync at all is a first run. A
 * sync that ran and saved nothing is a MEASUREMENT — the tenant answered and had nothing to
 * report — and saying "no sync has run yet" there would be false.
 */
export function firstRunNotice({ synced, hint }) {
  return emptyState(
    synced
      ? "The last sync saved no findings, so there is nothing here to measure yet."
      : "No sync has run yet, so nothing on this page has been measured.",
    hint,
    { variant: "notice" },
  );
}
