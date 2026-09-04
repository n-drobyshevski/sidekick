// The spreadsheet-cell ceiling, drawn.
//
// LOCAL BECAUSE THE CEILING IS. This register's ledger is a Google Sheet, and a Sheet stops
// at ten million cells — a hard wall with no equivalent in any sibling, and the one figure on
// the Data page that is about the STORE rather than about security. `meter()` and
// `progressBar()` in the shared core draw a proportion; neither carries a used/total caption
// with its own numerals, and giving one of them that would be this app's storage model
// leaking into the design system.
//
// It is built ON the shared progress recipe (`.progress-track` / `.progress-fill`), so the
// bar itself is the family's; only the caption and the two warning states are ours.

import { el } from "../../../../../gas_shared/ui/dom.js";

/**
 * A labelled capacity meter: a caption ("`used` / `total` (pct%)") over a track/fill bar
 * reusing the progress-bar recipe. `state` ("" | "warn" | "bad") tints the fill near a ceiling;
 * meaning is also carried by the number and any note text, never color alone. `note` appends an
 * extra muted line under the bar (e.g. the "approaching the ceiling" warning).
 */
export function usageMeter({ used, total, label, state = "", note } = {}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const fill = el("div", { class: "progress-fill" });
  fill.style.width = `${pct}%`;
  const track = el("div", {
    class: `progress-track usage-meter__track${state ? " " + state : ""}`,
    role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100",
    "aria-valuenow": String(Math.round(pct)),
    "aria-label": label || "Usage",
  }, fill);
  return el("div", { class: "usage-meter" },
    el("div", { class: "usage-meter__head" },
      label ? el("span", { class: "usage-meter__label label" }, label) : null,
      el("span", { class: "usage-meter__caption num" },
        `${used.toLocaleString()} / ${total.toLocaleString()} (${pct.toFixed(1)}%)`)),
    track,
    note ? el("p", { class: `usage-meter__note small${state ? " " + state : ""}` }, note) : null);
}
