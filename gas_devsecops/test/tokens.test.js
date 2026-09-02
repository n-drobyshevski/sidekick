// The design tokens that are NOT this app's to change, and the one set that is.
//
// Two different jobs in one file because they are two halves of the same rule (PRODUCT.md):
// a severity means the same thing in every sidekick, and the brand deliberately does not.
//
// The accent assertions are not decoration. Variant C was chosen knowing #ffcb13 fails
// every contrast floor on its own — 1.52:1 on white, 1.30:1 on the meter track — so the
// design is only legal while the split holds. A later edit that "simplified" a focus ring
// back onto var(--accent) would look tidy and would be unreadable.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEVERITY_COLORS, SEVERITY_TEXT, SLA_TARGETS } from "../src/domain/config";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const TOKENS = read("../src/client/styles/tokens.css");
const STYLES = ["base", "components", "tables", "sheet", "feedback", "settings", "overrides"]
  .map((n) => [n, read(`../src/client/styles/${n}.css`)]);

/** WCAG 2.1 relative luminance contrast between two #rrggbb strings. */
function ratio(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const tokenValue = (name) => TOKENS.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim();

describe("severity is shared, not branded", () => {
  // Byte-identical to gas/src/domain/config.ts and gas_ai/src/domain/config.ts.
  it("keeps the six fills every sidekick agrees on", () => {
    expect(SEVERITY_COLORS).toEqual({
      CRITICAL: "#dc2626", HIGH: "#ea580c", MEDIUM: "#d97706",
      LOW: "#2563eb", INFO: "#64748b", UNKNOWN: "#475569",
    });
  });

  it("keeps the darkened text twins, and they really are darker", () => {
    expect(SEVERITY_TEXT).toEqual({
      CRITICAL: "#b91c1c", HIGH: "#c2410c", MEDIUM: "#b45309",
      LOW: "#1d4ed8", INFO: "#475569", UNKNOWN: "#334155",
    });
    for (const sev of Object.keys(SEVERITY_COLORS)) {
      if (sev === "INFO" || sev === "UNKNOWN") continue;
      expect(
        ratio(SEVERITY_TEXT[sev], "#ffffff"),
        `${sev} text is not darker than its fill`,
      ).toBeGreaterThan(ratio(SEVERITY_COLORS[sev], "#ffffff"));
    }
  });

  it("clears 3:1 on white for every fill, since a fill is a graphical mark", () => {
    for (const [sev, hex] of Object.entries(SEVERITY_COLORS)) {
      expect(ratio(hex, "#ffffff"), `${sev} fill`).toBeGreaterThanOrEqual(3);
    }
  });

  // charts.js (severityBar, stackedAgeBar, severityTrendLines) draws these same six fills
  // straight from SEVERITY_COLORS as canvas ink (borderColor/backgroundColor on a line or
  // point, not just a bar swatch) — a fill clearing only the 3:1 graphical-mark floor above
  // is not enough there; TEXT usage needs 4.5:1, and every severity's LABEL (the coloured
  // word beside its dot, e.g. `.sev-CRITICAL`) is real text on white/near-white. All six
  // pairs, by name, so a seventh level or a renamed key fails loudly here rather than
  // silently missing this check.
  it("clears 4.5:1 on white for all six text tokens, named individually", () => {
    const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
    expect(Object.keys(SEVERITY_TEXT).sort()).toEqual([...SEVERITIES].sort());
    for (const sev of SEVERITIES) {
      expect(SEVERITY_TEXT[sev], `${sev} has no text token`).toBeTruthy();
      expect(
        ratio(SEVERITY_TEXT[sev], "#ffffff"),
        `${sev} text (${SEVERITY_TEXT[sev]}) on white`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the remediation windows the other three surfaces use", () => {
    expect(SLA_TARGETS).toEqual({ CRITICAL: 7, HIGH: 14, MEDIUM: 30, LOW: 90, INFO: 180 });
  });
});

describe("the accent, and the split that makes it legal", () => {
  it("is the yellow this register chose", () => {
    expect(tokenValue("accent")).toBe("#ffcb13");
    expect(tokenValue("accent-text")).toBe("#7c4a0a");
    expect(tokenValue("accent-edge")).toBe("rgba(0, 0, 0, 0.40)");
  });

  it("keeps a text token that can actually carry text", () => {
    expect(ratio(tokenValue("accent-text"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("records that the identity token cannot — which is WHY the split exists", () => {
    expect(ratio(tokenValue("accent"), "#ffffff")).toBeLessThan(3);
  });

  it("never lets the identity token carry text or a focus ring", () => {
    for (const [name, css] of STYLES) {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(stripped, `${name}.css sets colour from --accent`)
        .not.toMatch(/[^-]color:\s*var\(--accent\)\s*[;}]/);
      expect(stripped, `${name}.css draws a focus ring in --accent`)
        .not.toMatch(/outline:\s*[^;]*var\(--accent\)\s*[;}]/);
    }
  });

  it("keeps the primary button graphite — white on this accent is 1.52:1", () => {
    const base = STYLES.find(([n]) => n === "base")[1];
    const block = base.slice(base.indexOf("button.primary {"), base.indexOf("button.danger"));
    expect(block).toContain("background: var(--graphite)");
    expect(block).not.toContain("var(--accent)");
  });

  it("puts near-black on an accent fill, never white", () => {
    const A = tokenValue("accent");
    expect(ratio("#171717", A)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", A)).toBeLessThan(3);
  });

  it("draws the chart series in the text token, since canvas cannot read a CSS var", () => {
    const charts = read("../src/client/js/charts.js");
    expect(charts).toContain(`export const ACCENT = "${tokenValue("accent-text")}"`);
  });
});
