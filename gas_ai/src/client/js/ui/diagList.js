// The "how well is this rule actually working" read-out, shared by all three cascades on
// the AARS Rules page.
//
// The markup was written three times — once for the AARS pane's separation read-out, once
// for the Problem tree's per-axis unknown rates, once for Posture's — and the three copies
// were identical down to the `▲` glyph and the `small muted` on the hint. Nothing about a
// row of {label, value, optional hint} is specific to which model is being diagnosed, so it
// lives here once and the three panes supply their own sentences.
//
// THE GLYPH IS NOT DECORATION. A warning here is a claim that a rule may be quietly failing
// — an axis nothing populates, a pillar pinned at its cap, a level nothing reaches — and
// those are the findings a reader most needs to not skim past. It is marked with a shape as
// well as a colour (DESIGN.md's rule, and the same call `sevBadge` and the coverage dots
// already make), and the glyph is `aria-hidden` because the sentence beside it already says
// what it means; announcing "up-pointing triangle" first would only delay that.

import { el } from "./dom.js";

/**
 * One diagnostic row: what is being measured, what it reads, and — only when it is worth
 * saying — a short hint about why that reading matters. The hint is deliberately optional
 * rather than empty-string-able, so a row with nothing to add renders two cells and not
 * three, and the column does not gain a ragged empty gutter.
 */
export function diagRow(label, value, hint) {
  return el(
    "div",
    { class: "diag-row" },
    el("span", { class: "diag-row__label" }, label),
    el("span", { class: "diag-row__value" }, value),
    hint ? el("span", { class: "diag-row__hint small muted" }, hint) : null,
  );
}

/**
 * A named failure, stated in the words of the model it belongs to. `role="status"` rather
 * than `role="alert"`: these appear as a consequence of a draft the operator is actively
 * editing, and an assertive live region would interrupt them mid-keystroke on every pass
 * through a threshold.
 */
export function diagWarn(text) {
  return el(
    "p",
    { class: "diag-warn small", role: "status" },
    el("span", { class: "diag-warn__mark", "aria-hidden": "true" }, "▲"),
    text,
  );
}

/**
 * The whole per-axis unknown-rate block, which the Problem tree and Posture panes both
 * render and which differs between them only in the axes and the noun.
 *
 * `unknownRate` is the finding the preview endpoints exist to surface — problemRule.ts's
 * own header says so — so a high rate gets both a hint on its row AND a warning card. An
 * axis that reads UNKNOWN most of the time is not a rule that is working on hard cases; it
 * is a rule deciding on the minority it can actually read, and the outcome counts above it
 * will look perfectly reasonable the whole time.
 */
export function paintUnknownRates({ listHost, warnHost, axes, rates, threshold, rowNoun }) {
  for (const axis of axes) {
    const rate = (rates && rates[axis.key]) || 0;
    const pct = Math.round(rate * 1000) / 10;
    const high = rate >= threshold;
    listHost.append(diagRow(
      axis.label,
      `${pct}% unknown`,
      high ? "most reads on this axis could not be established" : null,
    ));
    if (high) {
      warnHost.append(diagWarn(
        `${axis.label} reads UNKNOWN on ${pct}% of decided ${rowNoun}. This axis is not `
        + "populated on this tenant, and every rule keyed on it is deciding on the "
        + "minority it could actually read.",
      ));
    }
  }
}
