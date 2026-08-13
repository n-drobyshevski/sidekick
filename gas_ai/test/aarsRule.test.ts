// The AARS rule as a configurable object: pricing cascade, coercion, validation, and the
// prose the page reads it back in. The defaults must stay bit-identical to the model in
// ai/custom_score.md — aars.test.ts proves the scores, these prove the rule that makes them.

import { describe, expect, it } from "vitest";
import { DEFAULT_AARS_RULE, gapPointsFor, type AarsRule } from "../src/domain/aars";
import {
  bandRanges,
  cleanAarsRule,
  cleanGapCode,
  MAX_GAP_RULES,
  gapMatchTally,
  ruleDiscrimination,
  ruleSummary,
  rulesEqual,
  scoringEqual,
  shadowedGapRules,
  unreachableGapRules,
  validateAarsRule,
} from "../src/domain/aarsRule";

function withRule(over: Partial<AarsRule>): AarsRule {
  return cleanAarsRule({ ...DEFAULT_AARS_RULE, ...over });
}

/**
 * The pricing cascade as it was written before it became data — the `if` chain from
 * ai/custom_score.md. The default cascade must agree with it on every code, or the port
 * quietly changed the model it claims to implement.
 */
function legacyDefaultGapPoints(code: string): number {
  const c = code.toUpperCase();
  if (c === "NO_GUARDRAIL") return 10;
  if (c === "DEPRECATED_MODEL") return 5;
  if (c === "LLM04" || c === "LLM05") return 5;
  if (c.startsWith("LLM")) return 10;
  if (c.startsWith("ASI")) return 10;
  if (c.startsWith("ML")) return 5;
  if (c === "FIVE_RS" || c.startsWith("5R")) return 5;
  return 5;
}

describe("gapPointsFor — the default cascade IS the documented table", () => {
  const codes = [
    "NO_GUARDRAIL", "DEPRECATED_MODEL",
    "LLM01", "LLM02", "LLM04", "LLM05", "LLM06", "LLM10",
    "ASI01", "ASI02", "ASI03", "ASI10",
    "ML_DATA_POISONING", "ML01",
    "FIVE_RS", "5RS", "5R_RESTRICT",
    "SUB-082", "", "wct-id-1998", "unknown",
  ];
  it.each(codes)("prices %s exactly as the pre-config chain did", (code) => {
    expect(gapPointsFor(code)).toBe(legacyDefaultGapPoints(code));
  });

  it("matches case- and whitespace-insensitively", () => {
    expect(gapPointsFor(" llm06 ")).toBe(10);
    expect(gapPointsFor("no_guardrail")).toBe(10);
  });

  it("takes the FIRST matching row, so order is the model", () => {
    // LLM04 above the LLM family scores 5; drop it below and the family claims it at 10.
    expect(gapPointsFor("LLM04")).toBe(5);
    const reordered = withRule({
      gapPoints: DEFAULT_AARS_RULE.gapPoints.filter((g) => g.code !== "LLM04"),
    });
    expect(gapPointsFor("LLM04", reordered)).toBe(10);
  });

  it("falls back for a code no row matches — the tenant-shortId path", () => {
    expect(gapPointsFor("SUB-082", withRule({ gapFallbackPoints: 15 }))).toBe(15);
  });
});

describe("cleanAarsRule", () => {
  it("leaves the defaults untouched", () => {
    expect(cleanAarsRule(DEFAULT_AARS_RULE)).toEqual(DEFAULT_AARS_RULE);
  });

  it("returns the spec model for junk rather than a broken one", () => {
    for (const junk of [null, undefined, 7, "nope", [], {}]) {
      expect(cleanAarsRule(junk)).toEqual(DEFAULT_AARS_RULE);
    }
  });

  it("clamps points, multipliers and bands into range", () => {
    const r = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      severityPoints: { CRITICAL: 9999, HIGH: -40, MEDIUM: 20.6, LOW: "x" },
      multiIssueMultiplier: 12,
      dataAmplifier: 0.1,
      bands: { critical: 500, high: 50, medium: 30, low: -3 },
    });
    expect(r.severityPoints).toEqual({ CRITICAL: 100, HIGH: 0, MEDIUM: 21, LOW: 8 });
    expect(r.multiIssueMultiplier).toBe(3);
    expect(r.dataAmplifier).toBe(1);
    expect(r.bands).toEqual({ critical: 100, high: 50, medium: 30, low: 1 });
  });

  it("keeps multipliers at two decimals — the spec's own precision", () => {
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, dataAmplifier: 1.10499 }).dataAmplifier).toBe(1.1);
  });

  it("normalizes gap codes and drops the empty ones", () => {
    const r = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      gapPoints: [
        { match: "prefix", code: " llm ", points: 10 },
        { match: "bogus", code: "ASI01", points: "7" },
        { match: "exact", code: "   ", points: 5 },
      ],
    });
    expect(r.gapPoints).toEqual([
      { match: "prefix", code: "LLM", points: 10 },
      { match: "exact", code: "ASI01", points: 7 }, // unknown match type reads as exact
    ]);
  });

  it("caps the cascade so the rule still fits one settings cell", () => {
    const many = Array.from({ length: MAX_GAP_RULES + 20 }, (_, i) => ({
      match: "exact", code: `C${i}`, points: 1,
    }));
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, gapPoints: many }).gapPoints).toHaveLength(
      MAX_GAP_RULES,
    );
  });

  it("keeps an explicitly empty cascade empty, so validate can report it", () => {
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, gapPoints: [] }).gapPoints).toEqual([]);
  });
});

describe("cleanGapCode", () => {
  it("upper-cases, trims and bounds the length", () => {
    expect(cleanGapCode(" llm06 ")).toBe("LLM06");
    expect(cleanGapCode(null)).toBe("");
    expect(cleanGapCode("x".repeat(200))).toHaveLength(64);
  });
});

describe("validateAarsRule", () => {
  it("passes the defaults", () => {
    expect(validateAarsRule(DEFAULT_AARS_RULE)).toEqual([]);
  });

  it("rejects bands that are not strictly descending, and names both levels", () => {
    const errors = validateAarsRule(withRule({ bands: { critical: 70, high: 80, medium: 30, low: 10 } }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("CRITICAL");
    expect(errors[0]).toContain("HIGH");
  });

  it("rejects equal thresholds too — a level nothing can reach is not a level", () => {
    expect(validateAarsRule(withRule({ bands: { critical: 70, high: 70, medium: 30, low: 10 } })))
      .toHaveLength(1);
  });

  it("reports every broken boundary, not just the first", () => {
    expect(validateAarsRule(withRule({ bands: { critical: 10, high: 30, medium: 50, low: 70 } })))
      .toHaveLength(3);
  });

  it("rejects a repeated cascade row", () => {
    const errors = validateAarsRule(
      withRule({
        gapPoints: [
          { match: "exact", code: "LLM06", points: 10 },
          { match: "exact", code: "LLM06", points: 5 },
        ],
      }),
    );
    expect(errors.join(" ")).toContain("repeats");
  });

  it("allows the same code under different match types — they are different rules", () => {
    expect(
      validateAarsRule(
        withRule({
          gapPoints: [
            { match: "exact", code: "LLM", points: 10 },
            { match: "prefix", code: "LLM", points: 5 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("reports an empty cascade", () => {
    expect(validateAarsRule(withRule({ gapPoints: [] })).join(" ")).toContain("no rules");
  });
});

describe("shadowedGapRules", () => {
  it("finds none in the defaults — every documented row can fire", () => {
    expect(shadowedGapRules(DEFAULT_AARS_RULE)).toEqual([]);
  });

  it("flags an exact row sitting under the prefix that already claims it", () => {
    const rule = withRule({
      gapPoints: [...DEFAULT_AARS_RULE.gapPoints, { match: "exact", code: "LLM06", points: 99 }],
    });
    expect(shadowedGapRules(rule)).toEqual([DEFAULT_AARS_RULE.gapPoints.length]);
  });

  it("does not flag the same row moved ABOVE the prefix", () => {
    const rule = withRule({
      gapPoints: [{ match: "exact", code: "LLM06", points: 99 }, ...DEFAULT_AARS_RULE.gapPoints],
    });
    expect(shadowedGapRules(rule)).toEqual([]);
  });

  it("does not treat an exact row as shadowing a whole prefix family", () => {
    const rule = withRule({
      gapPoints: [
        { match: "exact", code: "LLM", points: 1 },
        { match: "prefix", code: "LLM", points: 2 },
      ],
    });
    expect(shadowedGapRules(rule)).toEqual([]);
  });
});

describe("bandRanges", () => {
  it("describes the default scale exactly as the doc's level table does", () => {
    expect(bandRanges(DEFAULT_AARS_RULE.bands).map((b) => `${b.severity} ${b.min}-${b.max}`)).toEqual([
      "CRITICAL 70-100", "HIGH 50-69", "MEDIUM 30-49", "LOW 10-29", "INFO 0-9",
    ]);
  });

  it("follows a moved threshold into the neighbouring ranges", () => {
    const ranges = bandRanges({ critical: 60, high: 50, medium: 30, low: 10 });
    expect(ranges[0].label).toBe("score 60–100");
    expect(ranges[1].label).toBe("score 50–59");
  });
});

describe("unreachableGapRules", () => {
  it("names the three default rows nothing can raise", () => {
    const dead = unreachableGapRules(DEFAULT_AARS_RULE).map((i) => DEFAULT_AARS_RULE.gapPoints[i]!);
    expect(dead.map((r) => `${r.match} ${r.code}`))
      .toEqual(["exact DEPRECATED_MODEL", "exact FIVE_RS", "prefix 5R"]);
  });

  it("is not the same claim as shadowedGapRules — these rows are not shadowed", () => {
    expect(shadowedGapRules(DEFAULT_AARS_RULE)).toEqual([]);
    expect(unreachableGapRules(DEFAULT_AARS_RULE).length).toBe(3);
  });

  it("switching a gap source on brings its rows back to life", () => {
    const rule = withRule({ gapSources: { fiveRs: true, deprecatedModel: true } });
    const dead = unreachableGapRules(rule).map((i) => rule.gapPoints[i]!.code);
    expect(dead).not.toContain("DEPRECATED_MODEL");
    expect(dead).not.toContain("5R");
    // FIVE_RS stays unreachable: the source always names WHICH of the five, so the
    // unnamed form can only ever arrive on a tenant finding.
    expect(dead).toContain("FIVE_RS");
  });

  it("leaves the OWASP family rows alone — they are always live", () => {
    const codes = unreachableGapRules(DEFAULT_AARS_RULE).map((i) => DEFAULT_AARS_RULE.gapPoints[i]!.code);
    for (const live of ["LLM", "ASI", "ML", "LLM04", "LLM05", "NO_GUARDRAIL"]) {
      expect(codes).not.toContain(live);
    }
  });
});

describe("ruleDiscrimination", () => {
  const asset = (aars: number, sev: string, pillars: { toxic: number; compliance: number; data: number; exposure?: number }) =>
    ({ aars, aarsSeverity: sev, aarsPillars: pillars });

  it("reports nothing measurable for an unscored estate", () => {
    const d = ruleDiscrimination([{ }, { }], DEFAULT_AARS_RULE);
    expect(d.scored).toBe(0);
    expect(d.distinctScores).toBe(0);
    // The bands are still enumerated, all at zero — an absent level and an empty one
    // must render the same way.
    expect(d.bandOccupancy).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });
  });

  it("counts distinct scores and the largest tie group", () => {
    const d = ruleDiscrimination(
      [62, 62, 62, 66, 76].map((s) => asset(s, "HIGH", { toxic: 20, compliance: 20, data: 22 })),
      DEFAULT_AARS_RULE,
    );
    expect(d.scored).toBe(5);
    expect(d.distinctScores).toBe(3);
    expect(d.largestTieGroup).toBe(3);
    expect(d.range).toEqual({ min: 62, max: 76 });
  });

  it("catches the failure this whole diagnostic exists for: a pillar at cap for everyone", () => {
    // The live-path shape: pillar B pinned at 30 for every asset, so the cascade is
    // contributing nothing and the score collapses onto two values.
    const estate = [72, 72, 72, 76, 76].map((s) =>
      asset(s, "CRITICAL", { toxic: s === 72 ? 20 : 24, compliance: 30, data: 22 }));
    const d = ruleDiscrimination(estate, DEFAULT_AARS_RULE);
    expect(d.saturated.compliance).toBe(5);
    expect(d.saturated.compliance).toBe(d.scored); // 100% — no discrimination left
    expect(d.distinctScores).toBe(2);
    expect(d.bandOccupancy["MEDIUM"]).toBe(0); // a whole band unreachable
  });

  it("does not report a switched-off pillar as saturated", () => {
    // Pillar D is off in the spec rule, so every asset sits at its zero ceiling —
    // reporting that as saturation would flag every tenant.
    const d = ruleDiscrimination(
      [asset(62, "HIGH", { toxic: 20, compliance: 20, data: 22, exposure: 0 })],
      DEFAULT_AARS_RULE,
    );
    expect(d.saturated.exposure).toBe(0);
    expect(d.saturated.data).toBe(1); // pillar C IS at its ceiling, and that is real
  });

  it("counts the 0–100 ceiling separately from the pillar caps", () => {
    const d = ruleDiscrimination(
      [asset(100, "CRITICAL", { toxic: 50, compliance: 30, data: 22 })],
      DEFAULT_AARS_RULE,
    );
    expect(d.saturated.score).toBe(1);
    expect(d.saturated.toxic).toBe(1);
  });
});

describe("ruleSummary", () => {
  it("states each pillar's cap and the level thresholds", () => {
    const text = ruleSummary(DEFAULT_AARS_RULE).join(" ");
    expect(text).toContain("capped at 50");
    expect(text).toContain("capped at 30");
    expect(text).toContain("×1.2");
    expect(text).toContain("×1.1");
    expect(text).toContain("→ 22 / 11 / 0");
    expect(text).toContain("CRITICAL at 70 and above");
  });

  it("reports the amplified exposure points, which is what actually scores", () => {
    const text = ruleSummary(withRule({ dataAmplifier: 2 })).join(" ");
    expect(text).toContain("→ 40 / 20 / 0");
  });

  it("counts the cascade rows and names the fallback", () => {
    const text = ruleSummary(withRule({ gapFallbackPoints: 1 })).join(" ");
    expect(text).toContain("9 pricing rules");
    expect(text).toContain("1 point"); // singular, not "1 points"
  });
});

describe("rulesEqual / scoringEqual", () => {
  it("rulesEqual sees a band move", () => {
    const moved = withRule({ bands: { critical: 60, high: 50, medium: 30, low: 10 } });
    expect(rulesEqual(DEFAULT_AARS_RULE, moved)).toBe(false);
  });

  it("scoringEqual does NOT — bands rename a score, they never change one", () => {
    const moved = withRule({ bands: { critical: 60, high: 50, medium: 30, low: 10 } });
    expect(scoringEqual(DEFAULT_AARS_RULE, moved)).toBe(true);
  });

  it("scoringEqual sees any change to the point model", () => {
    expect(scoringEqual(DEFAULT_AARS_RULE, withRule({ gapFallbackPoints: 15 }))).toBe(false);
    expect(scoringEqual(DEFAULT_AARS_RULE, withRule({ dataAmplifier: 1.2 }))).toBe(false);
    expect(
      scoringEqual(
        DEFAULT_AARS_RULE,
        withRule({ severityPoints: { ...DEFAULT_AARS_RULE.severityPoints, MEDIUM: 30 } }),
      ),
    ).toBe(false);
  });
});

describe("gapMatchTally", () => {
  // Two agents from the sample estate's shape: over-privileged, unguardrailed, one of them
  // also carrying the secondary LLM04 carve-out and a tenant finding shortId.
  const ESTATE = [
    ["LLM06", "NO_GUARDRAIL"],
    ["LLM04", "LLM06", "NO_GUARDRAIL"],
    ["ASI03", "SUB-082"],
  ];

  it("credits each gap to the FIRST row that matches it, exactly as pricing does", () => {
    const t = gapMatchTally(DEFAULT_AARS_RULE, ESTATE);
    const at = (code: string, match: "exact" | "prefix") =>
      DEFAULT_AARS_RULE.gapPoints.findIndex((r) => r.match === match && r.code === code);

    expect(t.perRule[at("NO_GUARDRAIL", "exact")]).toBe(2);
    expect(t.perRule[at("LLM04", "exact")]).toBe(1);
    // LLM06 twice — LLM04 was taken by its own exact row above the family.
    expect(t.perRule[at("LLM", "prefix")]).toBe(2);
    expect(t.perRule[at("ASI", "prefix")]).toBe(1);
    expect(t.fallback).toBe(1); // SUB-082
    expect(t.total).toBe(7);
    expect(t.perRule.reduce((a, b) => a + b, 0) + t.fallback).toBe(t.total);
  });

  it("moves a carve-out's count to the family when the carve-out drops below it", () => {
    // The page's central claim — that order is meaning — as a number rather than a lede.
    const rows = DEFAULT_AARS_RULE.gapPoints.slice();
    const exactAt = rows.findIndex((r) => r.match === "exact" && r.code === "LLM04");
    const [carveOut] = rows.splice(exactAt, 1);
    rows.push(carveOut!);
    const reordered = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapPoints: rows });

    const t = gapMatchTally(reordered, ESTATE);
    const famAt = reordered.gapPoints.findIndex((r) => r.match === "prefix" && r.code === "LLM");
    const nowAt = reordered.gapPoints.findIndex((r) => r.match === "exact" && r.code === "LLM04");
    expect(t.perRule[nowAt]).toBe(0);
    expect(t.perRule[famAt]).toBe(3);
    // And the rule is now provably dead, not merely unexercised.
    expect(shadowedGapRules(reordered)).toContain(nowAt);
  });

  it("scores an unexercised row at zero too — the page must tell the two apart", () => {
    const t = gapMatchTally(DEFAULT_AARS_RULE, ESTATE);
    const at = DEFAULT_AARS_RULE.gapPoints.findIndex(
      (r) => r.match === "exact" && r.code === "DEPRECATED_MODEL",
    );
    expect(t.perRule[at]).toBe(0);
    expect(shadowedGapRules(DEFAULT_AARS_RULE)).not.toContain(at);
  });

  it("counts an asset carrying a code twice once — pillar B prices the gap, not the row", () => {
    const t = gapMatchTally(DEFAULT_AARS_RULE, [["LLM06", "llm06", " LLM06 "]]);
    expect(t.total).toBe(1);
    expect(t.byCode["LLM06"]).toBe(1);
  });

  it("counts distinct assets per code, which is what the picker's prevalence means", () => {
    const t = gapMatchTally(DEFAULT_AARS_RULE, ESTATE);
    expect(t.byCode).toEqual({
      LLM06: 2, NO_GUARDRAIL: 2, LLM04: 1, ASI03: 1, "SUB-082": 1,
    });
  });

  it("normalises codes the way the matcher does, so a lookup cannot disagree", () => {
    const t = gapMatchTally(DEFAULT_AARS_RULE, [[" llm06 "]]);
    expect(t.perRule[DEFAULT_AARS_RULE.gapPoints.findIndex((r) => r.code === "LLM")]).toBe(1);
  });

  it("survives an empty estate, a missing list and a junk row", () => {
    expect(gapMatchTally(DEFAULT_AARS_RULE, []).total).toBe(0);
    expect(gapMatchTally(DEFAULT_AARS_RULE, undefined as never).total).toBe(0);
    expect(gapMatchTally(DEFAULT_AARS_RULE, [null as never, ["", "  "]]).total).toBe(0);
  });

  it("agrees with gapPointsFor about which row won, for every gap in the estate", () => {
    const t = gapMatchTally(DEFAULT_AARS_RULE, ESTATE);
    let priced = 0;
    DEFAULT_AARS_RULE.gapPoints.forEach((row, i) => {
      priced += t.perRule[i]! * row.points;
    });
    priced += t.fallback * DEFAULT_AARS_RULE.gapFallbackPoints;
    const direct = ESTATE.flat().reduce((sum, c) => sum + gapPointsFor(c, DEFAULT_AARS_RULE), 0);
    expect(priced).toBe(direct);
  });
});
