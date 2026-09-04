// Severity marks. Every one of these pairs its colour with a dot and a word — the
// severity channel is never carried by colour alone (DESIGN.md), and the --sev-* fill /
// --sev-*-text split is what keeps the label legible on the pale tint.

import { el } from "./dom.js";
import { plural } from "./format.js";

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

// ------------------------------------------------------- severity distributions

/**
 * A `{CRITICAL: 3, HIGH: 0, …}` tally as `[{sev, count}]` in `order`, with the empty
 * levels dropped — a level with nothing in it is not a segment and not a key.
 */
export function sevEntries(counts, order) {
  const c = counts || {};
  return (order || []).map((sev) => ({ sev, count: Number(c[sev] || 0) }))
    .filter((e) => e.count > 0);
}

/** "3 CRITICAL, 2 HIGH" — the spoken form of a distribution, for an aria-label. */
export function sevSpoken(entries, { lower = false } = {}) {
  if (!entries.length) return "";
  return entries.map((e) => `${e.count} ${lower ? e.sev.toLowerCase() : e.sev}`).join(", ");
}

/**
 * A severity distribution drawn as one bar: a segment per level, grown by its count.
 *
 * Three of these existed independently — the inventory's AARS strip and its per-row issue
 * bars, and the combos page's before/after amplifier bars. They differ in size and in
 * whether they speak for themselves, which is what `size` and `label` are for; the
 * geometry, the flex-grow weighting and the severity fill classes are the same everywhere
 * and now live here.
 *
 * opts:
 *   size    "xs" (in-row, 5px, inline) | "md" (10px) | "lg" (22px, boxed) — default "md"
 *   label   the accessible name. Omit it for a bar whose numbers are already written out
 *           beside it (the inventory strip): the bar is then aria-hidden decoration
 *           rather than a second, redundant announcement of the same figures.
 *   width   an inline CSS width, for a bar whose LENGTH carries the total (issue bars)
 *   selected  a Set of levels; when given, the levels outside it recede but stay visible
 *   emptyHatch  draw a hatched full-width segment when there is nothing to show
 */
export function sevSegmentBar(entries, opts = {}) {
  const { size = "md", label = "", width = "", selected = null, emptyHatch = false } = opts;
  // Dimming the unselected only means anything once something IS selected: an empty
  // selection would otherwise recede the entire bar to 22% and read as "no data".
  const dim = !!selected && selected.size > 0;
  const attrs = { class: `sevbar sevbar--${size}${dim ? " sevbar--dim" : ""}` };
  if (label) {
    attrs.role = "img";
    attrs["aria-label"] = label;
  } else {
    attrs["aria-hidden"] = "true";
  }
  const bar = el("div", attrs);
  if (width) bar.style.width = width;

  for (const e of entries) {
    const seg = el("div", { class: `sevbar-seg sev-fill-${e.sev}` });
    seg.style.flexGrow = String(e.count);
    if (selected) seg.dataset.on = selected.has(e.sev) ? "true" : "false";
    bar.append(seg);
  }
  if (!entries.length && emptyHatch) {
    bar.append(el("div", { class: "sevbar-seg sevbar-seg--empty" }));
  }
  return bar;
}

/**
 * The keys under a distribution bar: dot + level + count, per level present.
 *
 * Two variants, because these do two different jobs and collapsing them into one look
 * would be a regression, not a unification:
 *
 *   "legend"  static tinted chips that name the bar's segments (the combos amplifier)
 *   "toggle"  neutral aria-pressed buttons that ARE the cross-filter, and the
 *             keyboard-reachable twin of clicking a segment (the inventory strip)
 *
 * opts:
 *   variant   "legend" (default) | "toggle"
 *   onToggle  (sev) => void — required for "toggle"
 *   isOn      (sev) => boolean — which keys read as pressed
 *   suffix    (entry) => Node|null — an extra mark per key (the inventory's change chip)
 *   describe  (entry) => string — the key's accessible name, for "toggle"
 *   ariaLabel names the group, for "toggle"
 */
export function sevKeyRow(entries, opts = {}) {
  const {
    variant = "legend", onToggle = null, isOn = () => false,
    suffix = null, describe = null, ariaLabel = "",
  } = opts;
  const toggle = variant === "toggle";
  const row = el("div", {
    class: `sevkey-row sevkey-row--${variant}`,
    role: toggle ? "group" : null,
    "aria-label": toggle ? (ariaLabel || null) : null,
  });

  for (const e of entries) {
    // A legend key takes the level's tint and darkened text token, and colours its dot
    // through the shared `.sev-X .sev-dot` rule — the two-token pair, unchanged. A toggle
    // key stays neutral so "selected" reads as an interactive state, not as a severity.
    const kids = [
      el("span", { class: "sev-dot", "aria-hidden": "true" }),
      el("span", {}, e.sev),
      el("span", { class: "sevkey-num num" }, String(e.count)),
      suffix ? suffix(e) : null,
    ];
    if (!toggle) {
      row.append(el("span", { class: `sevkey sev-${e.sev}` }, ...kids));
      continue;
    }
    row.append(el("button", {
      class: "sevkey",
      "aria-pressed": isOn(e.sev) ? "true" : "false",
      "aria-label": describe ? describe(e) : `${e.sev}, ${plural(e.count, "item")}`,
      onclick: () => onToggle(e.sev),
    }, ...kids));
  }
  return row;
}
