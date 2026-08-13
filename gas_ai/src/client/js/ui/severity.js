// Severity marks. Every one of these pairs its colour with a dot and a word — the
// severity channel is never carried by colour alone (DESIGN.md), and the --sev-* fill /
// --sev-*-text split is what keeps the label legible on the pale tint.

import { el } from "./dom.js";

/**
 * Severity badge: tinted pill + dot + label (never color alone).
 *
 * `role="img"`, not `role="status"`: a status is an aria-live region, and the detail sheet
 * paints one badge per issue and per finding — a dozen insertions into a dozen live regions
 * is an announcement storm, not information. The badge is a static graphic with a name.
 */
export function sevBadge(sev) {
  const s = String(sev || "UNKNOWN").toUpperCase();
  return el(
    "span",
    { class: `sev-badge sev-${s}`, role: "img", "aria-label": `Severity ${s}` },
    el("span", { class: "sev-dot", "aria-hidden": "true" }),
    s,
  );
}

/**
 * AARS chip: score + its severity, styled with that severity's token — dot + number +
 * label, never color alone. The AARS scale carries the same values as the Wiz severity
 * scale, so the token needs no translation.
 */
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
