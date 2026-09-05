// A capacity meter: a used/total caption with its own numerals, over a proportion bar that
// changes colour as it approaches a ceiling.
//
// PROMOTED FROM gas/src/client/js/ui/usageMeter.js, WHERE ITS OWN HEADER MISDESCRIBED WHY IT
// WAS LOCAL. That header said the ceiling is "a hard wall with no equivalent in any sibling";
// `gas_devsecops/src/server/readModels.ts:1484` publishes `cellLimit: 10_000_000` too, and its
// Data page computes the same ratio off it (`pages/data.js`'s `cellsSummary`). What was
// genuinely gas-only was the WIDGET, not the fact. `gas_ai`'s `getStorageStats` really does
// carry no `cellLimit`, so that app cannot compute a ratio — which is a reason it draws no
// meter, not a reason the meter belongs to one app.
//
// WHAT THIS ADDS OVER `meter()` AND `progressBar()` in `ui/data.js`, and the only reason it is
// a third widget rather than a flag on one of those: a numeral caption reading `used / total
// (pct%)`, and two named warn/bad states that tint the fill AND the note. Neither of the other
// two carries either. It is built ON the shared progress recipe (`.progress-track` /
// `.progress-fill`), so the bar itself is the family's; the caption and the two states are
// this module's.
//
// WHERE THE THRESHOLDS LIVE: not here. `state` arrives already decided, because what counts as
// "nearly full" is a property of the store being measured — `gas/src/client/js/capacity.js`
// holds gas's (`WARN_AT = 0.6`, `BAD_AT = 0.85`) so its Data page and its Settings panel can
// never disagree. A sibling adopting the meter brings its own line.

import { el } from "./dom.js";

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
