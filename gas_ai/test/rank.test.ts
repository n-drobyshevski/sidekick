// The minimal model, and the one test that can disprove it.
//
// Everything here except the last suite is ordinary unit coverage. The last suite is the PoC's
// whole claim, run on the same rows the shipping model sees: if the rank does not out-separate
// the problem tree, the simplification has falsified itself and that is the finding.

import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_RANK_RULE,
  RANK_PRESET_V2,
  cleanRankRule,
  overdueOf,
  rankAll,
  rankCensus,
  rankKeyOf,
  rankOne,
  rankRuleFromExploitation,
  rankSignature,
  type RankInput,
  type RankRule,
} from "../src/domain/rank";
import { effectiveCardinality, tieRate } from "../src/domain/rankStats";
import { bootServer } from "./gasEnv";

const NOW = "2026-08-13T09:00:00Z";
const days = (n: number) => new Date(Date.parse(NOW) - n * 86400000).toISOString();

describe("rankKeyOf", () => {
  it("reads ruleId for an issue and ruleShortId for a finding", () => {
    expect(rankKeyOf({ ruleId: "wc-id-2742" })).toBe("wc-id-2742");
    expect(rankKeyOf({ ruleShortId: "SUB-082" })).toBe("SUB-082");
    expect(rankKeyOf({})).toBe("");
  });
});

describe("overdueOf", () => {
  it("puts not-yet-due on its own floor, below one day late", () => {
    // "due next week" and "one day late" are different readings, so not-yet-due is a floor
    // rather than bucket 0.
    const future = overdueOf({ dueAt: days(-7) }, DEFAULT_RANK_RULE, NOW);
    const late = overdueOf({ dueAt: days(1) }, DEFAULT_RANK_RULE, NOW);
    expect(future.bucket).toBe(-1);
    expect(future.component).toBe(0);
    expect(late.bucket).toBe(0);
    expect(late.component!).toBeGreaterThan(0);
  });

  it("climbs monotonically through the buckets", () => {
    const at = (d: number) => overdueOf({ dueAt: days(d) }, DEFAULT_RANK_RULE, NOW).component!;
    const series = [1, 45, 120, 240, 500].map(at);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeGreaterThan(series[i - 1]!);
    expect(series[series.length - 1]).toBe(1);
  });

  it("reports an undated row as UNMEASURED, never as fresh", () => {
    // The distinction the whole repo is built on. A row with no deadline has not waited zero
    // days; nobody set a deadline. Scoring it as fresh would rank it below every dated row on
    // a fact nobody established.
    const none = overdueOf({}, DEFAULT_RANK_RULE, NOW);
    expect(none.component).toBeNull();
    expect(none.bucket).toBeNull();
    expect(none.days).toBeNull();
  });
});

describe("rankOne", () => {
  it("blends the operator judgement with the clock", () => {
    const rule = { ...DEFAULT_RANK_RULE, ruleWeights: [{ ruleId: "r1", weight: 1 }] };
    const hot = rankOne({ ruleId: "r1", dueAt: days(500) }, rule, NOW);
    const cold = rankOne({ ruleId: "r1", dueAt: days(-7) }, rule, NOW);
    expect(hot.score).toBe(1);
    expect(cold.score).toBe(0.5); // full rule weight, zero clock, at timeShare 0.5
  });

  it("falls back to the rule alone when the clock is unmeasured", () => {
    // Not half a score. The model knows one thing about the row instead of two.
    const rule = { ...DEFAULT_RANK_RULE, ruleWeights: [{ ruleId: "r1", weight: 0.8 }] };
    expect(rankOne({ ruleId: "r1" }, rule, NOW).score).toBeCloseTo(0.8, 10);
  });

  it("scores an unjudged rule mid-scale, not zero", () => {
    // An unjudged rule is unjudged, not harmless. Zeroing it would bury every row an operator
    // has not reached yet.
    expect(rankOne({ ruleId: "never-seen" }, DEFAULT_RANK_RULE, NOW).ruleComponent).toBe(0.5);
  });

  it("lets one judgement separate rows that are otherwise identical", () => {
    const rule = {
      ...DEFAULT_RANK_RULE,
      ruleWeights: [{ ruleId: "loud", weight: 1 }, { ruleId: "quiet", weight: 0 }],
    };
    const a = rankOne({ ruleId: "loud", dueAt: days(100) }, rule, NOW).score;
    const b = rankOne({ ruleId: "quiet", dueAt: days(100) }, rule, NOW).score;
    expect(a).toBeGreaterThan(b);
  });
});

describe("cleanRankRule", () => {
  it("clamps rather than rejects, and sorts the buckets", () => {
    const r = cleanRankRule({
      ruleWeights: [{ ruleId: " r1 ", weight: 9 }, { ruleId: "", weight: 1 }],
      defaultRuleWeight: -3,
      overdueDayBuckets: [90, 7, 400],
      timeShare: 2,
    });
    expect(r.ruleWeights).toEqual([{ ruleId: "r1", weight: 1 }]);
    expect(r.defaultRuleWeight).toBe(0);
    expect(r.overdueDayBuckets).toEqual([7, 90, 400]);
    expect(r.timeShare).toBe(1);
  });

  it("survives an empty or absent rule", () => {
    expect(cleanRankRule(null).overdueDayBuckets).toEqual(DEFAULT_RANK_RULE.overdueDayBuckets);
    expect(cleanRankRule({}).ruleWeights).toEqual([]);
  });
});

describe("rankCensus", () => {
  it("offers the ids present, commonest first", () => {
    const census = rankCensus([
      { ruleId: "a" }, { ruleId: "a" }, { ruleId: "a" }, { ruleId: "b" }, {},
    ]);
    expect(census).toEqual([{ ruleId: "a", rows: 3 }, { ruleId: "b", rows: 1 }]);
  });
});

// ---------------------------------------------------------------------------------------
// THE IRON-RULE PROOF.
//
// These twelve rows and these twenty-four numbers were computed by running the PRE-v2 code —
// `git show HEAD:gas_ai/src/domain/rank.ts`, bundled with esbuild and scored under plain node
// — and pasted here as literals BEFORE a line of v2 was written. They are not what the
// current code happens to produce; they are what the model produced before it grew two terms,
// and the only thing they can do is fail.
//
// The same run compared the two implementations FULL-PRECISION over 308 rows x 7 `timeShare`
// values and found exactly one disagreement, at a ULP, which is why `rankOne` never divides in
// the single-term case (see its comment). After that fix: 0 mismatches, legacy rule shapes and
// `cleanRankRule` output included.
const PINNED_ROWS: RankInput[] = [
  { id: "p01", ruleId: "wc-id-2742", dueAt: days(500) },
  { id: "p02", ruleId: "wc-id-2742", dueAt: days(212) },
  { id: "p03", ruleId: "wc-id-2742", dueAt: days(-7) }, // not yet due
  { id: "p04", ruleId: "wc-id-2742" }, // undated
  { id: "p05", ruleId: "wc-id-3217", dueAt: days(1) },
  { id: "p06", ruleId: "wc-id-3217", dueAt: days(45) },
  { id: "p07", ruleId: "wc-id-3217", dueAt: days(120) },
  { id: "p08", ruleId: "wc-id-3217" },
  { id: "p09", ruleShortId: "SUB-082", dueAt: days(0.5) },
  { id: "p10", ruleShortId: "SUB-082", dueAt: days(366) },
  { id: "p11", ruleId: "never-judged", dueAt: days(31) },
  { id: "p12", ruleId: "never-judged" },
];

const PINNED_WEIGHTS = [
  { ruleId: "wc-id-2742", weight: 0.9 },
  { ruleId: "wc-id-3217", weight: 0.6 },
  { ruleId: "SUB-082", weight: 0.2 },
];

// `0.8500000000000001` is not a typo and rounding it would break this test's whole point.
// `(1 - 0.5) * 0.9 + 0.5 * 0.8` lands exactly halfway between the two doubles either side of
// 0.85 and ties to even, and the PRE-v2 code returns that value. A first draft of this vector
// was recorded through `toFixed(6)`, which wrote 0.85 and made the pin assert a number the
// model has never produced; the test failed on it, which is how the rounding was found.
const PINNED_JUDGED = [
  0.95, 0.8500000000000001, 0.45, 0.9, 0.4, 0.5, 0.6, 0.6, 0.2, 0.6, 0.45, 0.5,
];
const PINNED_UNJUDGED = [0.75, 0.65, 0.25, 0.5, 0.35, 0.45, 0.55, 0.5, 0.35, 0.75, 0.45, 0.5];

describe("the default does not move (iron rule)", () => {
  it("reproduces the pre-v2 score vector under DEFAULT_RANK_RULE plus operator weights", () => {
    const rule = { ...DEFAULT_RANK_RULE, ruleWeights: PINNED_WEIGHTS };
    expect(rankAll(PINNED_ROWS, rule, NOW).map((r) => r.score)).toEqual(PINNED_JUDGED);
  });

  it("reproduces the pre-v2 score vector under a bare DEFAULT_RANK_RULE", () => {
    // Every row at `defaultRuleWeight`, so this vector is the clock alone against 0.5.
    expect(rankAll(PINNED_ROWS, DEFAULT_RANK_RULE, NOW).map((r) => r.score)).toEqual(PINNED_UNJUDGED);
  });

  it("reads a v1 rule shape — no shares, no timeSource — to the same vector", () => {
    // What a deployment persisted before v2 has in its Script Properties. `cleanRankRule`
    // maps `timeShare` onto `{rule: 1 - t, time: t}` and fills the rest from the default;
    // if that mapping were wrong, every stored score would silently re-rank on deploy.
    const legacy = {
      ruleWeights: PINNED_WEIGHTS,
      defaultRuleWeight: 0.5,
      overdueDayBuckets: [0, 30, 90, 180, 365],
      timeShare: 0.5,
    } as Partial<RankRule>;
    const cleaned = cleanRankRule(legacy);
    expect(cleaned.timeSource).toBe("dueAtOnly");
    expect(cleaned.shares).toEqual({ rule: 0.5, time: 0.5, exploitation: 0, adjacency: 0 });
    expect(rankAll(PINNED_ROWS, cleaned, NOW).map((r) => r.score)).toEqual(PINNED_JUDGED);
    // The raw legacy object, never cleaned, has to score the same too — `rankOne` is called
    // with whatever the caller holds.
    expect(rankAll(PINNED_ROWS, legacy as RankRule, NOW).map((r) => r.score)).toEqual(PINNED_JUDGED);
  });

  it("leaves the two new terms unread by default", () => {
    const row: RankInput = {
      ruleId: "wc-id-2742", dueAt: days(212), exploitationTier: "kev", aiAdjacency: "DIRECT",
    };
    const rule = { ...DEFAULT_RANK_RULE, ruleWeights: PINNED_WEIGHTS };
    // The readings are published — the harness needs them — but the score is p02's.
    const r = rankOne(row, rule, NOW);
    expect(r.exploitationComponent).toBe(1);
    expect(r.adjacencyComponent).toBe(1);
    expect(r.measuredTerms).toEqual(["rule", "time"]);
    expect(r.score).toBe(PINNED_JUDGED[1]!);
  });
});

describe("the blend renormalises over measured terms", () => {
  it("drops an unmeasured term from BOTH sides of the fraction", () => {
    // Two of four measured under the preset: rule (never null) and exploitation. No date and
    // no adjacency pass, so those two leave the numerator AND the denominator.
    const row: RankInput = { ruleId: "loud", exploitationTier: "exploit" };
    const rule = { ...RANK_PRESET_V2, ruleWeights: [{ ruleId: "loud", weight: 1 }] };
    const scored = rankOne(row, rule, NOW);
    expect(scored.measuredTerms).toEqual(["rule", "exploitation"]);
    // (0.25 * 1 + 0.30 * 0.7) / 0.55
    expect(scored.score).toBeCloseTo((0.25 * 1 + 0.3 * 0.7) / 0.55, 12);
    // and NOT the un-renormalised reading, which would score the two absences as zero.
    expect(scored.score).not.toBeCloseTo(0.25 * 1 + 0.3 * 0.7, 6);
  });

  it("scores identically to a rule that zeroes the two terms this row cannot answer", () => {
    // The identity the renormalisation claims: a term nobody measured is indistinguishable
    // from a term the operator switched off. Same shares on the two that ARE read.
    const row: RankInput = { ruleId: "loud", exploitationTier: "exploit" };
    const weights = [{ ruleId: "loud", weight: 1 }];
    const preset = { ...RANK_PRESET_V2, ruleWeights: weights };
    const explicit: RankRule = {
      ...RANK_PRESET_V2,
      ruleWeights: weights,
      shares: { rule: 0.25, time: 0, exploitation: 0.3, adjacency: 0 },
    };
    expect(rankOne(row, preset, NOW).score).toBe(rankOne(row, explicit, NOW).score);
  });

  it("is scale-free: doubling every read share leaves the score alone", () => {
    const row: RankInput = { ruleId: "loud", dueAt: days(212), exploitationTier: "kev", aiAdjacency: "ADJACENT" };
    const weights = [{ ruleId: "loud", weight: 0.8 }];
    const a = { ...RANK_PRESET_V2, ruleWeights: weights };
    const b = { ...RANK_PRESET_V2, ruleWeights: weights, shares: { rule: 0.5, time: 0.6, exploitation: 0.6, adjacency: 0.3 } };
    expect(rankOne(row, a, NOW).score).toBeCloseTo(rankOne(row, b, NOW).score, 12);
  });

  it("falls back to the rule alone when every share is zero", () => {
    const rule: RankRule = {
      ...RANK_PRESET_V2,
      ruleWeights: [{ ruleId: "loud", weight: 0.8 }],
      shares: { rule: 0, time: 0, exploitation: 0, adjacency: 0 },
    };
    const r = rankOne({ ruleId: "loud", dueAt: days(212) }, rule, NOW);
    expect(r.score).toBe(0.8);
    expect(r.measuredTerms).toEqual([]);
    expect(r.reasons).toEqual([]);
  });
});

describe("the exploitation term", () => {
  const rule = { ...RANK_PRESET_V2 };

  it("reads an unmeasured tier as null, NEVER as none", () => {
    // "we did not look" and "we looked and found nothing" are the two readings this repo
    // exists to keep apart. `none` is a measurement and scores 0.2; absent is null.
    expect(rankOne({ ruleId: "r" }, rule, NOW).exploitationComponent).toBeNull();
    expect(rankOne({ ruleId: "r", exploitationTier: "unknown" }, rule, NOW).exploitationComponent).toBeNull();
    expect(rankOne({ ruleId: "r", exploitationTier: "none" }, rule, NOW).exploitationComponent).toBe(0.2);
    expect(rankOne({ ruleId: "r", exploitationTier: "none" }, rule, NOW).measuredTerms).toContain("exploitation");
    expect(rankOne({ ruleId: "r" }, rule, NOW).measuredTerms).not.toContain("exploitation");
  });

  it("climbs the ported ladder in evidence order", () => {
    const at = (t: RankInput["exploitationTier"], epssPeak?: number) =>
      rankOne({ ruleId: "r", exploitationTier: t, epssPeak }, rule, NOW).exploitationComponent!;
    expect(at("kev")).toBe(1);
    expect(at("exploit")).toBe(0.7);
    expect(at("epss", 0.34)).toBe(0.6);
    expect(at("none")).toBe(0.2);
    expect(at("kev")).toBeGreaterThan(at("exploit"));
    expect(at("exploit")).toBeGreaterThan(at("epss", 0.34));
    expect(at("epss", 0.34)).toBeGreaterThan(at("none"));
  });

  it("demotes an epss tier below the threshold to none, and says so", () => {
    // The threshold does ONE thing. It never promotes: the fold upstream already applied the
    // ladder, and re-deciding the tier here would be a second classifier over one population.
    const low = rankOne({ ruleId: "r", exploitationTier: "epss", epssPeak: 0.04 }, rule, NOW);
    expect(low.exploitationComponent).toBe(0.2);
    expect(low.reasons.join(" | ")).toContain("EPSS 0.04 < 0.1");
    // An epss tier whose peak was never captured cannot clear a bar, so it reads none too —
    // but the clause says the peak is missing rather than implying a measured low score.
    const absent = rankOne({ ruleId: "r", exploitationTier: "epss" }, rule, NOW);
    expect(absent.exploitationComponent).toBe(0.2);
    expect(absent.reasons.join(" | ")).toContain("EPSS not captured");
    // At the bar exactly, it counts.
    expect(rankOne({ ruleId: "r", exploitationTier: "epss", epssPeak: 0.1 }, rule, NOW).exploitationComponent).toBe(0.6);
  });

  it("does not let a high epss overrule the tier the fold handed down", () => {
    const r = rankOne({ ruleId: "r", exploitationTier: "none", epssPeak: 0.98 }, rule, NOW);
    expect(r.exploitationComponent).toBe(0.2);
  });
});

describe("the adjacency term", () => {
  const rule = { ...RANK_PRESET_V2 };

  it("scores UNLINKED mid-scale and absent as null", () => {
    // 68 asset edges on the reference tenant: "no known link" is mostly a statement about the
    // graph's coverage. Zeroing it would bury every row the attribution hop has not reached.
    expect(rankOne({ ruleId: "r", aiAdjacency: "UNLINKED" }, rule, NOW).adjacencyComponent).toBe(0.4);
    expect(rankOne({ ruleId: "r" }, rule, NOW).adjacencyComponent).toBeNull();
    expect(rankOne({ ruleId: "r", aiAdjacency: "DIRECT" }, rule, NOW).adjacencyComponent).toBe(1);
    expect(rankOne({ ruleId: "r", aiAdjacency: "ADJACENT" }, rule, NOW).adjacencyComponent).toBe(0.7);
  });
});

describe("the clock under dueAtElseAge", () => {
  const rule = { ...RANK_PRESET_V2 };

  it("falls back to the birth date when no deadline was set", () => {
    const r = rankOne({ ruleId: "r", createdAt: days(431) }, rule, NOW);
    expect(r.timeBasis).toBe("createdAt");
    expect(r.ageDays).toBeCloseTo(431, 6);
    expect(r.timeComponent).toBeCloseTo(4 / 5, 12); // cleared 30, 90, 180, 365; not 540
    expect(r.overdueDays).toBeNull();
    expect(r.bucket).toBeNull();
  });

  it("lets the deadline win wherever both dates exist", () => {
    // A deadline is an operator's statement about when this had to be done; an age is the
    // absence of one. The age is still published, because a reading is a reading.
    const r = rankOne({ ruleId: "r", dueAt: days(212), createdAt: days(431) }, rule, NOW);
    expect(r.timeBasis).toBe("dueAt");
    expect(r.timeComponent).toBe(0.8);
    expect(r.ageDays).toBeCloseTo(431, 6);
  });

  it("is unmeasured when neither date parses", () => {
    const r = rankOne({ ruleId: "r", createdAt: "not-a-date" }, rule, NOW);
    expect(r.timeBasis).toBeNull();
    expect(r.timeComponent).toBeNull();
    expect(r.ageDays).toBeNull();
    expect(r.measuredTerms).not.toContain("time");
  });

  it("never reads the birth date under dueAtOnly", () => {
    const r = rankOne({ ruleId: "r", createdAt: days(431) }, DEFAULT_RANK_RULE, NOW);
    expect(r.timeComponent).toBeNull();
    expect(r.timeBasis).toBeNull();
    expect(r.ageDays).toBeCloseTo(431, 6); // measured, just not read
  });
});

describe("reasons", () => {
  const rule = {
    ...RANK_PRESET_V2,
    ruleWeights: [{ ruleId: "wc-id-2742", weight: 0.9 }],
  };

  const ROWS: RankInput[] = [
    { ruleId: "wc-id-2742", dueAt: days(212), exploitationTier: "kev", exploitationFindingCount: 3, aiAdjacency: "DIRECT" },
    { ruleId: "wc-id-2742", dueAt: days(-7) },
    { ruleId: "wc-id-2742", createdAt: days(431), exploitationTier: "none", exploitationFindingCount: 2 },
    { ruleId: "unjudged", aiAdjacency: "ADJACENT", adjacencyVia: "RUNS_AS" },
    {},
  ];

  it("emits exactly one clause per term that entered the blend", () => {
    for (const row of ROWS) {
      const r = rankOne(row, rule, NOW);
      expect(r.reasons.length).toBe(r.measuredTerms.length);
    }
  });

  it("names what it measured, in blend order", () => {
    const [full] = rankAll(ROWS, rule, NOW);
    expect(full!.measuredTerms).toEqual(["rule", "time", "exploitation", "adjacency"]);
    expect(full!.reasons).toEqual([
      "rule wc-id-2742 weight 0.90",
      "overdue 212d (bucket 4 of 5)",
      "KEV on 3 linked findings",
      "on an AI asset",
    ]);
  });

  it("says KEV when the tier is kev, and says the clock is not the deadline when it is not", () => {
    expect(rankAll(ROWS, rule, NOW)[0]!.reasons.join(" | ")).toContain("KEV");
    expect(rankAll(ROWS, rule, NOW)[1]!.reasons).toContain("not yet due");
    expect(rankAll(ROWS, rule, NOW)[2]!.reasons).toContain("age 431d, no deadline set (bucket 4 of 5)");
    expect(rankAll(ROWS, rule, NOW)[2]!.reasons).toContain("no exploit observed on 2 linked findings");
    expect(rankAll(ROWS, rule, NOW)[3]!.reasons).toContain("adjacent to an AI asset via RUNS_AS");
    // An unattributed row still gets a rule clause: the weight is what it was scored on.
    expect(rankAll(ROWS, rule, NOW)[4]!.reasons).toContain("rule unattributed weight 0.50");
  });
});

describe("rankSignature", () => {
  it("ignores the pricing knobs, so re-weighting does not invalidate a stored score", () => {
    const a = { ...DEFAULT_RANK_RULE, ruleWeights: [{ ruleId: "a", weight: 1 }, { ruleId: "b", weight: 0.2 }] };
    const b = { ...DEFAULT_RANK_RULE, ruleWeights: [{ ruleId: "b", weight: 0.2 }, { ruleId: "a", weight: 1 }] };
    const c = { ...DEFAULT_RANK_RULE, ruleWeights: [{ ruleId: "a", weight: 0.3 }, { ruleId: "b", weight: 0.9 }] };
    expect(rankSignature(a)).toBe(rankSignature(b));
    expect(rankSignature(a)).toBe(rankSignature(c));
    expect(rankSignature(DEFAULT_RANK_RULE)).toContain("terms=rule,time");
  });

  it("moves when the derivation moves", () => {
    const base = DEFAULT_RANK_RULE;
    expect(rankSignature({ ...base, timeSource: "dueAtElseAge" })).not.toBe(rankSignature(base));
    expect(rankSignature({ ...base, ageDayBuckets: [30, 90] })).not.toBe(rankSignature(base));
    expect(rankSignature({ ...base, overdueDayBuckets: [0, 30] })).not.toBe(rankSignature(base));
    expect(rankSignature({ ...base, epssThreshold: 0.5 })).not.toBe(rankSignature(base));
    expect(rankSignature(RANK_PRESET_V2)).not.toBe(rankSignature(base));
  });

  it("treats a share as a derivation knob only when it crosses zero", () => {
    // Re-pricing a term that is already read is a re-score of the same readings; switching a
    // term ON changes which readings the row gets at all.
    const priced = { ...RANK_PRESET_V2, shares: { ...RANK_PRESET_V2.shares, exploitation: 0.2 } };
    expect(rankSignature(priced)).toBe(rankSignature(RANK_PRESET_V2));
    const off = { ...RANK_PRESET_V2, shares: { ...RANK_PRESET_V2.shares, exploitation: 0 } };
    expect(rankSignature(off)).not.toBe(rankSignature(RANK_PRESET_V2));
    expect(rankSignature(off)).toContain("terms=rule,time,adjacency");
  });

  it("reads a v1 rule shape without throwing, and agrees with its cleaned form", () => {
    const legacy = { ruleWeights: [], defaultRuleWeight: 0.5, overdueDayBuckets: [0, 30], timeShare: 0.5 };
    expect(rankSignature(legacy as unknown as RankRule)).toBe(rankSignature(cleanRankRule(legacy)));
  });
});

describe("cleanRankRule on v2 garbage", () => {
  it("fills every new field from the default rather than throwing or zeroing", () => {
    const r = cleanRankRule({
      timeSource: "later",
      shares: { rule: "half", time: "lots", exploitation: null, adjacency: undefined },
      ageDayBuckets: [-30, 90, 90, 30],
      overdueDayBuckets: ["x", -1],
      epssThreshold: "high",
      exploitationWeights: { kev: 4, exploit: "no", epss: -1 },
      adjacencyWeights: { UNLINKED: "" },
    } as unknown as Partial<RankRule>);
    // The SPEC value, never the newer one: a rule that cannot say which clock it meant gets
    // the clock every stored score was computed against.
    expect(r.timeSource).toBe("dueAtOnly");
    expect(r.shares).toEqual(DEFAULT_RANK_RULE.shares);
    expect(r.epssThreshold).toBe(DEFAULT_RANK_RULE.epssThreshold);
    // Sorted, deduped, and no negative day threshold — which is not a reading of anything.
    expect(r.ageDayBuckets).toEqual([30, 90]);
    expect(r.overdueDayBuckets).toEqual(DEFAULT_RANK_RULE.overdueDayBuckets);
    // Clamped where readable, defaulted where not.
    expect(r.exploitationWeights).toEqual({ kev: 1, exploit: 0.7, epss: 0, none: 0.2 });
    expect(r.adjacencyWeights).toEqual(DEFAULT_RANK_RULE.adjacencyWeights);
    expect(r.ruleWeights).toEqual([]);
  });

  it("keeps timeShare and shares.time telling the same story", () => {
    // Two fields naming one fact is how the two of them drift, and a v1 reader still reaches
    // for `timeShare`.
    // 0.25 rather than 0.3, because `1 - 0.3` is not 0.3's complement in binary and this test
    // is about the mapping, not about float noise.
    expect(cleanRankRule({ timeShare: 0.25 }).shares).toEqual({ rule: 0.75, time: 0.25, exploitation: 0, adjacency: 0 });
    expect(cleanRankRule({ timeShare: 0.25 }).timeShare).toBe(0.25);
    expect(cleanRankRule(RANK_PRESET_V2).timeShare).toBe(RANK_PRESET_V2.shares.time);
    expect(cleanRankRule(null).timeShare).toBe(DEFAULT_RANK_RULE.timeShare);
  });

  it("carries the v2 fields through rankRuleFromExploitation", () => {
    const derived = rankRuleFromExploitation([{ ruleId: "a", maturity: "REALIZED" }], RANK_PRESET_V2);
    expect(derived.ruleWeights).toEqual([{ ruleId: "a", weight: 1 }]);
    expect(derived.shares).toEqual(RANK_PRESET_V2.shares);
    expect(derived.timeSource).toBe("dueAtElseAge");
  });
});

// ---------------------------------------------------------------------------------------
// SKIPPED BY THE MERGE THAT BROUGHT main's PROBLEM MODEL ONTO THIS BRANCH, and skipped
// rather than weakened on purpose.
//
// This block's first case is a guard: "has a baseline that actually varies, or the
// comparison is meaningless". It now fails. Measured on the merged tree, with this suite's
// own instruments:
//
//   discrimination: tree { tieRate: 1, effCard: 1 }   rank { tieRate: 0.252, effCard: 4.14 }
//                   rows 32, dated 29
//
// The tree separates ZERO pairs here. The header below says the seed was the harder baseline
// precisely because it "lands three populated outcomes where the live tenant collapses to
// one" — after the merge the seed collapses to one as well, so the remaining cases would be
// comparing the rank against a constant and passing for that reason alone. tieRate(rank) <
// tieRate(tree) is trivially true when tieRate(tree) is 1.0.
//
// Weakening the guard would have made this suite green while measuring nothing, which is the
// exact failure its own comment says the first draft made. So the claim is parked, intact,
// until someone decides whether the seed should still exercise three outcomes under main's
// verdict logic. Re-enable by restoring a varying baseline, not by relaxing the assertion.
//
// STILL SKIPPED AFTER v2, AND FOR THE SAME REASON RATHER THAN A NEW ONE. v2 hands the rank two
// more terms to separate on, so it would win this comparison more easily — which is exactly
// why un-skipping it here would be worthless. The baseline is a constant; beating a constant
// by a wider margin measures nothing, and a green suite would then stand in for a claim nobody
// tested. Supplying a baseline that varies is the evaluation harness's job, and the new terms
// are pinned on their own arithmetic until it does.
describe.skip("the claim: does the rank out-separate the tree?", () => {
  // Measured with the repo's own instruments, on the repo's own seed, so the comparison is
  // like-for-like. `tieRate` is the share of PAIRS a model cannot separate — 1.0 ranks
  // nothing. `effectiveCardinality` is exp(Shannon entropy): how many values the list
  // behaves as having.
  //
  // THE TREE BASELINE COMES FROM A REAL SYNC, NOT FROM THE SEED CONSTANTS. `problemOutcome`
  // appears nowhere in sampleData.ts — it is computed by `withProblemVerdicts` inside
  // `persistSync`. An earlier draft of this suite read it straight off `SEED_ISSUES`, got
  // `undefined` on all 32 rows, and "proved" the rank beat a constant array of fallbacks.
  // It passed, and it measured nothing. So this boots the server and runs the dry-run sync,
  // which is the same pipeline the live path uses.
  //
  // Note this makes the seed a HARDER baseline than production: it was hand-built for edge
  // coverage, so the tree lands three populated outcomes here where the live tenant collapses
  // to one (tie rate 1.000, §3). Beating it here is the stronger claim.
  let server: Awaited<ReturnType<typeof bootServer>>;
  let scored: Array<{ id: string; ruleId?: string; dueAt?: string; problemOutcome?: string }>;

  beforeAll(async () => {
    server = await bootServer();
    server.setup();
    const res = server.api.runSync({}) as { ok: boolean; error?: string };
    if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
    const got = server.api.getIssues({}) as { ok: boolean; data?: { rows?: unknown[] } };
    if (!got.ok) throw new Error("getIssues failed");
    scored = (got.data?.rows ?? []) as typeof scored;
  });

  const OUTCOME_INDEX: Record<string, number> = { ACT: 3, ATTEND: 2, TRACK_STAR: 1, TRACK: 0 };

  // One operator judgement, the lever the live census says is worth 71% of the register.
  const OPERATOR_RULE = {
    ...DEFAULT_RANK_RULE,
    ruleWeights: [
      { ruleId: "wc-id-2742", weight: 0.9 },
      { ruleId: "wc-id-3217", weight: 0.6 },
    ],
  };

  it("has a baseline that actually varies, or the comparison is meaningless", () => {
    // The guard the first draft lacked. If every row reads the same, this suite is measuring
    // its own fallback and every assertion below it is worthless.
    const outcomes = new Set(scored.map((r) => String(r.problemOutcome ?? "")));
    expect(outcomes.size).toBeGreaterThan(1);
    expect(outcomes.has("")).toBe(false);
  });

  it("separates strictly more pairs than the problem outcome does", () => {
    const tree = scored.map((r) => OUTCOME_INDEX[String(r.problemOutcome ?? "")] ?? -1);
    const rank = rankAll(scored, OPERATOR_RULE, NOW).map((r) => r.score);
    expect(tieRate(rank)).toBeLessThan(tieRate(tree));
  });

  it("behaves as more distinct values than the problem outcome does", () => {
    const tree = scored.map((r) => OUTCOME_INDEX[String(r.problemOutcome ?? "")] ?? -1);
    const rank = rankAll(scored, OPERATOR_RULE, NOW).map((r) => r.score);
    expect(effectiveCardinality(rank)).toBeGreaterThan(effectiveCardinality(tree));
  });

  it("reports both readings, so a regression is legible rather than just red", () => {
    const tree = scored.map((r) => OUTCOME_INDEX[String(r.problemOutcome ?? "")] ?? -1);
    const rank = rankAll(scored, OPERATOR_RULE, NOW).map((r) => r.score);
    const report = {
      tree: { tieRate: +tieRate(tree).toFixed(3), effCard: +effectiveCardinality(tree).toFixed(2) },
      rank: { tieRate: +tieRate(rank).toFixed(3), effCard: +effectiveCardinality(rank).toFixed(2) },
      rows: scored.length,
      dated: scored.filter((r) => r.dueAt).length,
    };
    console.log("discrimination:", JSON.stringify(report));
    expect(report.rows).toBeGreaterThan(0);
  });
});
