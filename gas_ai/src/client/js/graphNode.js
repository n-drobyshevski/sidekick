// Node-card construction, split out of graphView.js: the drag/zoom/keyboard-walking
// mechanics in that file don't need to scroll past the SVG layout to get to the wiring, and
// a second (compact) card can now exist without duplicating the halo/accent/severity logic.
// Two geometries, one attribute contract (class names, data-category, data-combo) — so
// graph.css's selectors don't care which card is on screen.

import { categoryOf, kindIcon, kindLabel, svgEl } from "./icons.js";
import { sevEntries, sevSpoken } from "./ui/severity.js";
import { tierLabel } from "./ui/posture.js";

// Mirrors SEVERITY_ORDER in src/domain/config.ts, for the same reason egoLayout.js,
// assetQuery.js and comboView.js each keep their own copy: the client bundle cannot import
// the domain layer, and the order must still agree with it.
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

export const NODE_W = 196;
export const NODE_H = 56;
// Compact trades height for width the way scans.js's diagram rows do (see the nodeH
// comment there): one node is a two-line strip instead of a stacked card, so a dense graph
// (grouped mode, a big result set) reads a lot more of it per screen without scrolling.
export const NODE_W_SM = 200;
export const NODE_H_SM = 40;

export function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/** "1 critical, 2 high" — a severity mix in words, worst first. Empty when there is none. */
export function severityMixText(mix) {
  return sevSpoken(sevEntries(mix, SEVERITY_ORDER), { lower: true });
}

export function nodeAriaLabel(node) {
  const parts = [kindLabel(node.kind), node.name];
  if (node.severity) parts.push("severity " + node.severity);
  if (node.aars !== undefined && node.aars !== null) {
    // Posture tier, not the AARS band: a graph node's neighbourhood is a different, smaller
    // population every time the seed changes, so a percentile computed against it would not
    // mean what the Inventory table's percentile means, and the band is the population-
    // dependent read this whole change exists to stop asserting about one asset. The tier is
    // neither — a lattice read (capability × containment), true independent of population size.
    const tier = tierLabel(node.postureTier);
    parts.push("AARS " + node.aars + (tier ? ", posture " + tier : ""));
  }
  if ((node.comboGroups || []).length) parts.push("toxic combination member");
  if (node.guardrailMissing) parts.push("no guardrail");
  if (node.kind === "DATA_FINDING") {
    // The count badge is a number in a box; on its own it says nothing about how bad. The
    // mix is what makes the card readable without colour, which the design system requires.
    parts.length = 0;
    const mix = severityMixText(node.dataFindingSeverities);
    parts.push(node.summaryCount + " data findings" + (mix ? " — " + mix : ""));
    parts.push("press Enter for details");
  }
  if (node.dataFindingCount) {
    parts.push(node.dataFindingCount + " data findings");
  }
  if (node.kind === "SUMMARY") {
    parts.length = 0;
    parts.push(node.summaryCount + " more " + kindLabel(node.summaryOf) + " nodes, press Enter to expand");
  }
  return parts.join(", ");
}

/** Full-size card: the original graphView.js node drawing, unchanged. */
function drawFullCard(node, palette) {
  const isSummary = node.kind === "SUMMARY";
  const g = svgEl("g", {
    class: "gnode" + (isSummary ? " summary" : ""),
    tabindex: "-1",
    role: "button",
    "aria-label": nodeAriaLabel(node),
    "data-id": node.id,
    "data-category": categoryOf(node.kind),
  });

  // Toxic-combo halo (behind the card).
  if ((node.comboGroups || []).length && !isSummary) {
    g.append(svgEl("rect", {
      class: "gnode-halo",
      x: -4, y: -4, width: NODE_W + 8, height: NODE_H + 8, rx: 14,
    }));
  }

  g.append(svgEl("rect", {
    class: "gnode-box", x: 0, y: 0, width: NODE_W, height: NODE_H, rx: 10,
  }));

  // The medallion: a pale category-tinted disc with a saturated ring, carrying the kind
  // icon. It replaces both the bare 16px glyph and the 3px left accent stripe — the stripe
  // was a colored side-rule wider than a hairline, which DESIGN.md forbids outright, and
  // the card ground goes neutral so the tint lives in one place instead of two.
  g.append(svgEl("circle", { class: "gnode-medallion", cx: 24, cy: 28, r: 14 }));

  // Kind icon + labels.
  const icon = kindIcon(node.kind === "SUMMARY" ? "SUMMARY" : node.kind);
  icon.setAttribute("transform", "translate(16, 20)");
  g.append(icon);

  const name = svgEl("text", { class: "gnode-name", x: 46, y: 22 });
  name.textContent = truncate(isSummary ? node.name + " " + kindLabel(node.summaryOf) : node.name, 20);
  g.append(name);

  const kind = svgEl("text", { class: "gnode-kind", x: 46, y: 36 });
  kind.textContent = isSummary ? "Enter to expand" : kindLabel(node.kind).toUpperCase();
  g.append(kind);

  // Severity dot + label (bottom-left) and AARS score (bottom-right).
  // Two-token severity: the dot keeps the server palette's vivid FILL (a graphical mark,
  // >=3:1, and a deployment may retint it), while the label takes the darkened TEXT token
  // via CSS so it clears 4.5:1 on the pale category tint behind it. Painting the label in
  // the fill — as this did — failed contrast on every tinted card.
  if (node.severity && !isSummary) {
    const sevColor = (palette && palette.colors && palette.colors[node.severity]) || "#475569";
    g.append(svgEl("circle", { cx: 52, cy: 46, r: 3.5, fill: sevColor }));
    const sevText = svgEl("text", {
      class: "gnode-chip-text gnode-sev-" + node.severity, x: 59, y: 49.5,
    });
    sevText.textContent = node.severity;
    g.append(sevText);
  }
  if (node.aars !== undefined && node.aars !== null && !isSummary) {
    const aars = svgEl("text", {
      class: "gnode-aars",
      x: NODE_W - 10, y: 49.5, "text-anchor": "end",
    });
    aars.textContent = "AARS " + node.aars;
    g.append(aars);
  }

  // "TC" toxic-combination badge (top-right corner, on the halo).
  if ((node.comboGroups || []).length && !isSummary) {
    g.append(svgEl("rect", { class: "gnode-tc-badge", x: NODE_W - 26, y: -10, width: 22, height: 15, rx: 4 }));
    const tc = svgEl("text", { class: "gnode-tc-text", x: NODE_W - 15, y: 1, "text-anchor": "middle" });
    tc.textContent = "TC";
    g.append(tc);
  }

  // Data-finding count badge — the "3" Wiz puts on the same node. It takes the TC slot,
  // which is free here: an aggregate hangs off a datastore and carries no combo membership
  // of its own. The number never stands alone — the card also prints the worst severity as
  // a dot and a word, and nodeAriaLabel reads out the whole mix.
  if (node.kind === "DATA_FINDING" && node.summaryCount) {
    g.append(svgEl("circle", { class: "gnode-count-badge", cx: NODE_W - 12, cy: -2, r: 11 }));
    const count = svgEl("text", {
      class: "gnode-count-text", x: NODE_W - 12, y: 2.5, "text-anchor": "middle",
    });
    count.textContent = String(node.summaryCount);
    g.append(count);
  }

  // (Missing guardrail used to draw a dashed stub here. It is now a real
  // MISSING_GUARDRAIL node joined by a negated PROTECTED_BY edge, which the edge
  // renderer already draws dashed and labels "(ABSENT)" — drawing both would show
  // one gap twice, in two different visual languages.)

  return g;
}

/**
 * Compact card: two text rows instead of a stacked card, for views with too many nodes to
 * give each one 56px of height. No TC halo/badge — both overhang the card bounds (halo at
 * -4, badge at y:-10) and would clip against a small viewBox — so toxic-combo membership
 * instead retints the medallion ring via data-combo (CSS rule lives in recordSheet.css).
 */
function drawCompactCard(node, palette) {
  const isSummary = node.kind === "SUMMARY";
  const g = svgEl("g", {
    class: "gnode" + (isSummary ? " summary" : ""),
    tabindex: "-1",
    role: "button",
    "aria-label": nodeAriaLabel(node),
    "data-id": node.id,
    "data-category": categoryOf(node.kind),
  });
  if ((node.comboGroups || []).length && !isSummary) g.setAttribute("data-combo", "1");

  g.append(svgEl("rect", {
    class: "gnode-box", x: 0, y: 0, width: NODE_W_SM, height: NODE_H_SM, rx: 8,
  }));

  g.append(svgEl("circle", { class: "gnode-medallion", cx: 22, cy: 20, r: 12 }));

  const icon = kindIcon(node.kind === "SUMMARY" ? "SUMMARY" : node.kind);
  icon.setAttribute("transform", "translate(14, 12)");
  g.append(icon);

  // Line 1: name, AARS right-aligned against it. The two share the row, so the name's
  // budget depends on whether a score is coming to sit beside it — at a flat 16 the two
  // collided on any scored node.
  const hasAars = node.aars !== undefined && node.aars !== null && !isSummary;
  const name = svgEl("text", { class: "gnode-name", x: 42, y: 17 });
  // The count rides in the NAME here rather than as a badge: the full card's badge sits at
  // y:-2, outside the card bounds, which clips against the compact viewBox — the same
  // reason the TC badge became the word "TC" on line 2.
  const label = node.kind === "DATA_FINDING" && node.summaryCount
    ? node.name + " ×" + node.summaryCount
    : isSummary ? node.name + " " + kindLabel(node.summaryOf) : node.name;
  name.textContent = truncate(label, hasAars ? 12 : 19);
  g.append(name);
  if (hasAars) {
    const aars = svgEl("text", {
      class: "gnode-aars", x: NODE_W_SM - 10, y: 17, "text-anchor": "end",
    });
    aars.textContent = "AARS " + node.aars;
    g.append(aars);
  }

  // Line 2: kind label, severity dot + word. Toxic-combination membership rides here as
  // the word TC rather than on the retinted stripe alone — the stripe is a colour, and
  // colour is never allowed to be the only thing saying something.
  const inCombo = (node.comboGroups || []).length > 0 && !isSummary;
  // Same row-sharing arithmetic as line 1: the kind gets the whole row when no severity
  // chip follows it, which is the common case for the synthetic risk nodes.
  const hasSev = !!node.severity && !isSummary;
  let kindRoom = hasSev ? 13 : 22;
  if (inCombo) kindRoom -= 3;
  const kind = svgEl("text", { class: "gnode-kind", x: 42, y: 31 });
  kind.textContent = isSummary
    ? "Enter to expand"
    : truncate(kindLabel(node.kind).toUpperCase(), kindRoom) + (inCombo ? " · TC" : "");
  g.append(kind);
  if (hasSev) {
    const sevColor = (palette && palette.colors && palette.colors[node.severity]) || "#475569";
    g.append(svgEl("circle", { cx: 122, cy: 27.5, r: 3.5, fill: sevColor }));
    const sevText = svgEl("text", {
      class: "gnode-chip-text gnode-sev-" + node.severity, x: 129, y: 31,
    });
    sevText.textContent = node.severity;
    g.append(sevText);
  }

  return g;
}

/**
 * Build a node card's <g class="gnode">, everything but the transform and the click/keydown
 * listeners — those stay with the loop in graphView.js because they close over its
 * per-render state (suppressClick, focusNode, handlers).
 */
export function drawNodeCard(node, opts) {
  const o = opts || {};
  return o.compact ? drawCompactCard(node, o.palette) : drawFullCard(node, o.palette);
}
