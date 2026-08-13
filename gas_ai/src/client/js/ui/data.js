// Quantity display: the progress/meter track and the table pager.

import { el } from "./dom.js";

/**
 * A track/fill progress bar. `pct` 0–100 renders a determinate fill; `null` renders an
 * indeterminate (animated, with a static reduced-motion fallback) bar. `state` tints
 * the fill ("" | "failed" | "cancelled" | "done").
 */
export function progressBar(pct, state = "") {
  const determinate = typeof pct === "number" && !Number.isNaN(pct);
  const attrs = {
    class: `progress-track${determinate ? "" : " indeterminate"}${state ? " " + state : ""}`,
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
  };
  if (determinate) attrs["aria-valuenow"] = String(Math.round(pct));
  const fill = el("div", { class: "progress-fill" });
  if (determinate) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return el("div", attrs, fill);
}

/**
 * Prev/Next controls, or a bare row count when a single page fits. The buttons carry
 * `data-nav` so a caller that rebuilds the pager on every page change can put keyboard
 * focus back on the control that was just used.
 */
export function pager(page, pageCount, total, onPage) {
  if (pageCount <= 1) {
    return el("div", { class: "pager" },
      `${total.toLocaleString()} row${total === 1 ? "" : "s"}`);
  }
  return el(
    "div",
    { class: "pager" },
    el("button", {
      "data-nav": "prev",
      onclick: () => onPage(page - 1),
      disabled: page <= 0,
    }, "‹ Prev"),
    `Page ${page + 1} of ${pageCount} — ${total.toLocaleString()} rows`,
    el("button", {
      "data-nav": "next",
      onclick: () => onPage(page + 1),
      disabled: page >= pageCount - 1,
    }, "Next ›"),
  );
}
