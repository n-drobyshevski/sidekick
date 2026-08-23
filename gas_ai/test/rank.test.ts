// The minimal model, and the one test that can disprove it.
//
// Everything here except the last suite is ordinary unit coverage. The last suite is the PoC's
// whole claim, run on the same rows the shipping model sees: if the rank does not out-separate
// the problem tree, the simplification has falsified itself and that is the finding.

import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_RANK_RULE,
  cleanRankRule,
  overdueOf,
  rankAll,
  rankCensus,
  rankKeyOf,
  rankOne,
  type RankInput,
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
describe("the claim: does the rank out-separate the tree?", () => {
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
