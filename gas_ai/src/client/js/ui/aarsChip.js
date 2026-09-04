// The AARS score, worn as a chip.
//
// THE ONE SEVERITY RENDERER THAT IS NOT SHARED. `ui/severity.js` moved to `gas_shared/ui/`
// with the rest of the component base; this stayed behind because an AARS score is this
// register's own vocabulary — a 0-100 agent-risk figure with a severity band derived from
// it — and no sibling register has one to draw. It borrows the shared severity PALETTE
// (`sev-*` classes, the `sev-dot` mark) rather than a shared component, so the colour still
// means what it means everywhere; only the arithmetic behind the band is local.
//
// Absent is never zero here either: a null score is an em dash, not a 0 chip in the LOW
// band, because a score nobody computed is not a low risk.
import { el } from "../../../../../gas_shared/ui/dom.js";

export function aarsChip(score, severity) {
  if (score === null || score === undefined || !severity) {
    return el("span", { class: "muted small" }, "—");
  }
  return el(
    "span",
    {
      class: `aars-chip sev-${severity}`,
      role: "img",
      "aria-label": `AARS ${score}, ${severity}`,
    },
    el("span", { class: "sev-dot", "aria-hidden": "true" }),
    String(score),
    el("span", {}, severity),
  );
}
