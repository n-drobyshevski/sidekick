// The client bundle cannot import the TypeScript domain modules, so `pages/overview.js`
// keeps hand-copied constants. Every one of them is a silent-drift hazard: if the domain
// value changes, the page keeps rendering, just wrongly — a mislabelled SLA edge, a tier
// the card never draws, a concentration toggle that asks the server for a dimension it
// does not serve. Nothing throws and no existing test notices.
//
// So the copies are asserted against their sources here rather than trusted to a comment.
// Same argument as test/entryPoints.test.ts: parity that a human would have to re-audit by
// hand on every change is parity that eventually stops holding.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SLA_TARGETS } from "../src/domain/config";
import { AGE_BUCKET_EDGES, AGE_BUCKET_LABELS } from "../src/domain/insights";
import { RISK_TIER_LABELS, RISK_TIER_ORDER } from "../src/domain/program";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const overview = readFileSync(join(root, "src/client/js/pages/overview.js"), "utf8");
const charts = readFileSync(join(root, "src/client/js/charts.js"), "utf8");
const api = readFileSync(join(root, "src/server/api.ts"), "utf8");

/** Parse `const NAME = <literal>;` out of a client module. */
function literal(src: string, name: string): unknown {
  const m = new RegExp(`const ${name}\\s*=\\s*([^;]+);`, "s").exec(src);
  if (!m) throw new Error(`${name} not found`);
  return JSON.parse(
    m[1]!
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, "$1"),
  );
}

describe("overview.js constants track the domain", () => {
  it("SLA_TARGETS_DAYS mirrors SLA_TARGETS", () => {
    expect(literal(overview, "SLA_TARGETS_DAYS")).toEqual(SLA_TARGETS);
  });

  it("AGE_BUCKET_FIRST_EDGE mirrors AGE_BUCKET_EDGES[0]", () => {
    // These two being equal is the ONLY reason the aging chart may draw a single SLA edge
    // at a bucket boundary. If the Critical SLA or the first bucket edge ever moves apart,
    // the line would sit mid-bucket and silently mislabel which bars are breaches.
    const edge = Number(/const AGE_BUCKET_FIRST_EDGE\s*=\s*(\d+)/.exec(overview)![1]);
    expect(edge).toBe(AGE_BUCKET_EDGES[0]);
    expect(SLA_TARGETS.CRITICAL).toBe(edge);
  });

  it("AGE_LABELS mirrors AGE_BUCKET_LABELS", () => {
    expect(literal(overview, "AGE_LABELS")).toEqual([...AGE_BUCKET_LABELS]);
  });

  it("every concentration dimension is one the server is asked to compute", () => {
    // The page's toggles and the `dims` argument api.ts passes to insights.concentration
    // have to agree, or a toggle renders an empty list for a dimension nobody computed.
    const dims = (literal(overview, "CONCENTRATION_DIMS") as string[][]).map((d) => d[0]);
    const served = /insights\.concentration\(recsVisible,\s*\[([^\]]+)\]/s.exec(api)![1]!
      .split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    expect(dims.slice().sort()).toEqual(served.slice().sort());
  });
});

describe("charts.js tier palette tracks program.ts", () => {
  it("TIER_ORDER mirrors RISK_TIER_ORDER", () => {
    expect(literal(charts, "TIER_ORDER")).toEqual(RISK_TIER_ORDER);
  });

  it("every tier has a colour, a text ink, a label and a non-colour glyph", () => {
    // The glyph is the accessibility contract: severity and status never carry meaning by
    // colour alone (DESIGN.md / WCAG 1.4.1), and two tiers share the same neutral fill, so
    // without a distinct glyph they would be genuinely indistinguishable.
    const colors = literal(charts, "TIER_COLORS") as Record<string, string>;
    const text = literal(charts, "TIER_TEXT") as Record<string, string>;
    const labels = literal(charts, "TIER_LABELS") as Record<string, string>;
    const glyphs = literal(charts, "TIER_GLYPHS") as Record<string, string>;
    for (const tier of RISK_TIER_ORDER) {
      expect(colors[tier], `colour for ${tier}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(text[tier], `text ink for ${tier}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(labels[tier], `label for ${tier}`).toBe(RISK_TIER_LABELS[tier]);
      expect(glyphs[tier], `glyph for ${tier}`).toBeTruthy();
    }
    expect(new Set(Object.values(glyphs)).size).toBe(RISK_TIER_ORDER.length);
  });

  it("only tier 1 is saturated — the rest are a neutral ramp", () => {
    // The measured constraint: the severity ramp fails as a tier palette (#d97706 vs
    // #ea580c is ΔE 6.7 for normal vision), and DESIGN.md rejects a wall of red. Tier 1
    // carries the page's single status colour; every other tier is a grey whose channels
    // sit within a few points of each other.
    const colors = literal(charts, "TIER_COLORS") as Record<string, string>;
    const spread = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
    };
    expect(spread(colors.kev!)).toBeGreaterThan(80); // saturated
    for (const tier of ["exploit", "epss", "none", "unknown"]) {
      expect(spread(colors[tier]!), `${tier} should be neutral`).toBeLessThan(25);
    }
  });

  it("the neutral ramp is monotone, so the tiers read as an order", () => {
    const colors = literal(charts, "TIER_COLORS") as Record<string, string>;
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    expect(lum(colors.exploit!)).toBeLessThan(lum(colors.epss!));
    expect(lum(colors.epss!)).toBeLessThan(lum(colors.none!));
  });
});
