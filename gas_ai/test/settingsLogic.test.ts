// Settings semantics over the `settings` tab dict: the graph clamps, and the AARS rule
// blob with its version — the token that decides whether persisted scores are stale.

import { describe, expect, it } from "vitest";
import { DEFAULT_AARS_RULE } from "../src/domain/aars";
import {
  clampDepth,
  clampMaxNodes,
  getAarsRule,
  getDefaultDepth,
  getMaxNodes,
  getScoredRuleVersion,
  withAarsRule,
  withDefaultDepth,
  withMaxNodes,
  withScoredRuleVersion,
} from "../src/domain/settingsLogic";
import {
  DEPTH_DEFAULT,
  MAX_NODES_CEILING,
  MAX_NODES_DEFAULT,
  MAX_NODES_FLOOR,
} from "../src/domain/config";
import type { Rec } from "../src/domain/util";

describe("clampDepth", () => {
  it("holds the slider inside 1–3", () => {
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(9)).toBe(3);
    expect(clampDepth(2)).toBe(2);
    expect(clampDepth(2.4)).toBe(2);
  });

  it("falls back to the default for anything non-numeric", () => {
    for (const junk of [undefined, "deep", NaN, {}]) {
      expect(clampDepth(junk)).toBe(DEPTH_DEFAULT);
    }
  });

  it("treats null and empty string as the 0 Number() makes of them, so they clamp to 1", () => {
    expect(clampDepth(null)).toBe(1);
    expect(clampDepth("")).toBe(1);
  });

  it("but an empty settings cell still reads as the default, because the getter guards it", () => {
    // loadSettings turns a blank value_json into null, and getDefaultDepth's `??` catches
    // it before clampDepth ever sees the 0 above. Pinned because the two halves have to
    // stay in step: drop the `??` and a blank cell silently becomes depth 1.
    expect(getDefaultDepth({ default_depth: null })).toBe(DEPTH_DEFAULT);
    expect(getDefaultDepth({})).toBe(DEPTH_DEFAULT);
  });
});

describe("clampMaxNodes", () => {
  it("holds the budget inside the floor and ceiling", () => {
    expect(clampMaxNodes(1)).toBe(MAX_NODES_FLOOR);
    expect(clampMaxNodes(99999)).toBe(MAX_NODES_CEILING);
    expect(clampMaxNodes(150)).toBe(150);
  });

  it("falls back to the default for anything unreadable", () => {
    expect(clampMaxNodes("lots")).toBe(MAX_NODES_DEFAULT);
  });
});

describe("depth / node-budget round trip", () => {
  it("stores the clamped value, not the value asked for", () => {
    const s = withMaxNodes(withDefaultDepth({}, 42), 5);
    expect(getDefaultDepth(s)).toBe(3);
    expect(getMaxNodes(s)).toBe(MAX_NODES_FLOOR);
  });

  it("leaves the other keys alone", () => {
    const s = withDefaultDepth({ max_nodes: 200, other: "keep" }, 1) as Rec;
    expect(s["max_nodes"]).toBe(200);
    expect(s["other"]).toBe("keep");
  });
});

describe("getAarsRule", () => {
  it("reads an untouched deployment as version 0 on the spec model", () => {
    expect(getAarsRule({})).toEqual({ version: 0, rule: DEFAULT_AARS_RULE });
  });

  it("repairs an unreadable stored blob instead of scoring with it", () => {
    for (const junk of [null, "", 7, "{}"]) {
      expect(getAarsRule({ aars_rule: junk }).rule).toEqual(DEFAULT_AARS_RULE);
    }
    expect(getAarsRule({ aars_rule: { version: 3, rule: "nonsense" } })).toEqual({
      version: 3,
      rule: DEFAULT_AARS_RULE,
    });
  });

  it("reads a nonsense version as 0 rather than propagating it", () => {
    expect(getAarsRule({ aars_rule: { version: -4, rule: DEFAULT_AARS_RULE } }).version).toBe(0);
    expect(getAarsRule({ aars_rule: { version: "x", rule: DEFAULT_AARS_RULE } }).version).toBe(0);
  });
});

describe("withAarsRule", () => {
  it("bumps the version on every save — it is the staleness token", () => {
    let s: Rec = {};
    s = withAarsRule(s, DEFAULT_AARS_RULE);
    expect(getAarsRule(s).version).toBe(1);
    s = withAarsRule(s, DEFAULT_AARS_RULE);
    expect(getAarsRule(s).version).toBe(2);
  });

  it("stores the cleaned rule, so a bad value can never reach the score", () => {
    const s = withAarsRule({}, { ...DEFAULT_AARS_RULE, pillarACap: 9999 });
    expect(getAarsRule(s).rule.pillarACap).toBe(100);
  });

  it("leaves the other settings alone", () => {
    const s = withAarsRule({ default_depth: 3 }, DEFAULT_AARS_RULE) as Rec;
    expect(s["default_depth"]).toBe(3);
  });
});

describe("scored rule version", () => {
  it("reads an unset marker as 0, matching an unedited rule", () => {
    expect(getScoredRuleVersion({})).toBe(0);
    expect(getScoredRuleVersion({ aars_scored_version: "junk" })).toBe(0);
  });

  it("round-trips, so scores can be compared against the rule that made them", () => {
    expect(getScoredRuleVersion(withScoredRuleVersion({}, 5))).toBe(5);
    expect(getScoredRuleVersion(withScoredRuleVersion({}, -2))).toBe(0);
  });

  it("goes out of step the moment a rule is saved — that IS the stale signal", () => {
    let s: Rec = withScoredRuleVersion({}, 0);
    expect(getScoredRuleVersion(s)).toBe(getAarsRule(s).version);
    s = withAarsRule(s, { ...DEFAULT_AARS_RULE, gapFallbackPoints: 15 });
    expect(getScoredRuleVersion(s)).not.toBe(getAarsRule(s).version);
  });
});
