// src/domain/problems.ts — the union invariant and the five-level tiebreak, each level
// pinned in isolation so a future edit that reorders the cascade fails here rather than
// only showing up as a shuffled Priorities page nobody can explain.

import { describe, expect, it } from "vitest";
import {
  buildProblemRows,
  compareProblems,
  compareProblemsBy,
  countProblemRowsByOutcome,
  findingToProblemRow,
  issueToProblemRow,
  rankProblems,
  withRankScores,
  type ProblemRow,
} from "../src/domain/problems";
import { DEFAULT_RANK_RULE, RANK_PRESET_V2 } from "../src/domain/rank";
import { findingFixture, issueFixture, nodeFixture } from "./problem.fixture";
import type { FindingRow, IssueRow } from "../src/domain/graphTypes";

function row(over: Partial<ProblemRow> = {}): ProblemRow {
  return {
    id: "p-1",
    kind: "ISSUE",
    title: "Rule",
    assetId: "asset-1",
    assetName: "Asset",
    domain: null,
    problemOutcome: "TRACK",
    vector: null,
    unknowns: [],
    dueAt: null,
    postureTier: null,
    postureState: null,
    amplification: { tools: null, identity: null, persistence: null, multiAgent: null, context: null, language: null },
    severity: null,
    iac: false,
    ignored: false,
    ...over,
  };
}

describe("the union invariant", () => {
  it("carries every unresolved issue and every open finding, and nothing else", () => {
    const issues: IssueRow[] = [
      issueFixture({ status: "OPEN" }),
      issueFixture({ status: "IN_PROGRESS" }),
      issueFixture({ status: "RESOLVED" }), // must NOT appear
    ];
    const findings: FindingRow[] = [
      findingFixture({ result: "FAIL", status: "OPEN" }),
      findingFixture({ result: "PASS", status: "OPEN" }), // must NOT appear
      findingFixture({ result: "FAIL", status: "REJECTED" }), // must NOT appear
    ];
    const rows = buildProblemRows(issues, findings, new Map());
    expect(rows.length).toBe(2 + 1);
    // Same "nothing vanishes" guarantee comboSummary documents in toxicCombos.ts — every
    // row that satisfies the two eligibility gates lands in the union exactly once.
    const expectedCount =
      issues.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS").length +
      findings.filter((f) => f.result === "FAIL" && f.status !== "REJECTED").length;
    expect(rows.length).toBe(expectedCount);
  });

  it("keeps a row with no verdict rather than dropping it", () => {
    const issue = issueFixture({ status: "OPEN" });
    delete issue.problemOutcome;
    delete issue.problemInput;
    const rows = buildProblemRows([issue], [], new Map());
    expect(rows.length).toBe(1);
    expect(rows[0]!.problemOutcome).toBe("");
    expect(rows[0]!.vector).toBeNull();
  });
});

describe("issueToProblemRow / findingToProblemRow", () => {
  it("reads the asset's posture tier and amplification off the linked node", () => {
    const node = nodeFixture({ id: "asset-9", hasAdminPrivileges: true, postureTier: 3 });
    const issue = issueFixture({ assetId: node.id, assetName: node.name, problemOutcome: "ACT" });
    const r = issueToProblemRow(issue, node);
    expect(r.postureTier).toBe(3);
    expect(r.amplification.identity).toBe(1); // hasAdminPrivileges → 1, via nodeAmplificationVector
    expect(r.kind).toBe("ISSUE");
  });

  it("reports an unlinked finding's assetId as null but keeps a readable name", () => {
    const finding = findingFixture({ resourceId: "raw-policy-1", resourceName: "Some IAM policy" });
    const r = findingToProblemRow(finding, undefined);
    expect(r.assetId).toBeNull();
    expect(r.assetName).toBe("Some IAM policy");
    expect(r.dueAt).toBeNull(); // FindingRow carries no SLA deadline at all
  });

  it("links a finding to the graph node when its resource is one", () => {
    const node = nodeFixture({ id: "asset-7", name: "Linked Asset" });
    const finding = findingFixture({ resourceId: node.id });
    const r = findingToProblemRow(finding, node);
    expect(r.assetId).toBe(node.id);
    expect(r.assetName).toBe("Linked Asset");
  });
});

describe("compareProblems — each level in isolation", () => {
  it("1. orders by Wiz severity, worst first, unrated last", () => {
    const rows = [
      row({ id: "a", severity: "LOW" }),
      row({ id: "b", severity: null }),
      row({ id: "c", severity: "CRITICAL" }),
      row({ id: "d", severity: "HIGH" }),
      row({ id: "e", severity: "MEDIUM" }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("2. within one severity, orders by SLA urgency, no-deadline last", () => {
    const rows = [
      row({ id: "future", dueAt: "2026-09-01T00:00:00Z" }),
      row({ id: "none", dueAt: null }),
      row({ id: "overdue", dueAt: "2026-08-01T00:00:00Z" }),
      row({ id: "soon", dueAt: "2026-08-14T00:00:00Z" }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["overdue", "soon", "future", "none"]);
  });

  it("3. within one severity and SLA, orders by age — oldest first, undated last", () => {
    // Replaces the amplification level, which ranked by the problem model's own input
    // vector. "Open since April" is a fact in the row; an amplification reading was a
    // fact about a model.
    const rows = [
      row({ id: "newer", firstSeenAt: "2026-06-01T00:00:00Z" }),
      row({ id: "undated" }),
      row({ id: "older", firstSeenAt: "2026-04-01T00:00:00Z" }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["older", "newer", "undated"]);
  });

  it("4. ties on everything else break on id, ascending, for stability", () => {
    const base = row({ id: "z" });
    const rows = [{ ...base, id: "z" }, { ...base, id: "a" }, { ...base, id: "m" }];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["a", "m", "z"]);
  });

  it("is a total, deterministic order — re-sorting a ranked list is a no-op", () => {
    const rows = [
      row({ id: "a", severity: "CRITICAL", dueAt: "2026-08-01T00:00:00Z" }),
      row({ id: "b", severity: "CRITICAL" }),
      row({ id: "c", severity: "LOW" }),
      row({ id: "d", severity: null }),
    ];
    const once = rankProblems(rows).map((r) => r.id);
    const twice = rankProblems(rankProblems(rows)).map((r) => r.id);
    expect(twice).toEqual(once);
  });
});

describe("countProblemRowsByOutcome", () => {
  it("keeps every outcome including undecided, zeros kept", () => {
    const rows = [row({ problemOutcome: "ACT" }), row({ problemOutcome: "ACT" }), row({ problemOutcome: "" })];
    expect(countProblemRowsByOutcome(rows)).toEqual({
      ACT: 2, ATTEND: 0, TRACK_STAR: 0, TRACK: 0, "": 1,
    });
  });
});

// --------------------------------------------------------------------------- WP6: rank

const NOW = "2026-08-13T09:00:00.000Z";

describe("withRankScores fills the WHOLE RankInput, not two fields of it", () => {
  // The failure this pins is silent by construction: the blend renormalises over the terms
  // it can READ, so an input the projection never carried is dropped from both halves of
  // the fraction rather than scored low. A half-filled RankInput does not under-read the
  // model — it runs a DIFFERENT model, on some rows, with nothing saying so.
  const rich = row({
    id: "rich",
    ruleId: "wc-id-2742",
    dueAt: "2026-07-01T00:00:00Z",
    firstSeenAt: "2026-01-01T00:00:00Z",
    exploitationTier: "kev",
    exploitationFindingCount: 3,
    aiAdjacency: "ADJACENT",
    adjacencyVia: "RUNS_AS",
  });

  it("reads four terms under RANK_PRESET_V2 and two under the shipped default", () => {
    const [v2] = withRankScores([rich], RANK_PRESET_V2, NOW);
    expect(v2!.rankMeasured).toEqual(["rule", "time", "exploitation", "adjacency"]);
    // The default zeroes the two graph-fed shares, so they are NOT READ — they leave
    // measuredTerms and reasons as well as the fraction (rank.ts's own rule).
    const [v1] = withRankScores([rich], DEFAULT_RANK_RULE, NOW);
    expect(v1!.rankMeasured).toEqual(["rule", "time"]);
  });

  it("carries one reason clause per measured term, in blend order", () => {
    const [scored] = withRankScores([rich], RANK_PRESET_V2, NOW);
    expect(scored!.rankReasons).toHaveLength(scored!.rankMeasured!.length);
    expect(scored!.rankReasons![0]).toContain("wc-id-2742");
    expect(scored!.rankReasons![1]).toContain("overdue");
    expect(scored!.rankReasons![2]).toContain("KEV");
    expect(scored!.rankReasons![2]).toContain("3 linked findings");
    expect(scored!.rankReasons![3]).toContain("RUNS_AS");
  });

  it("publishes the exploitation and adjacency readings EVEN AT SHARE 0", () => {
    // A reading the score did not use is still a reading — rank.ts's header, and the reason
    // the evaluation harness can decide whether a share should move at all.
    const [scored] = withRankScores([rich], DEFAULT_RANK_RULE, NOW);
    expect(scored!.rankMeasured).toEqual(["rule", "time"]);
    expect(scored!.rankExploitation).toBe(DEFAULT_RANK_RULE.exploitationWeights.kev);
    expect(scored!.rankAdjacency).toBe(DEFAULT_RANK_RULE.adjacencyWeights.ADJACENT);
  });

  it("keeps an unmeasured term NULL rather than zero", () => {
    const [scored] = withRankScores([row({ id: "bare" })], RANK_PRESET_V2, NOW);
    expect(scored!.rankExploitation).toBeNull();
    expect(scored!.rankAdjacency).toBeNull();
  });

  it("reads firstSeenAt as the birth date, which is the only clock a FINDING has", () => {
    // FindingRow carries no createdAt at all; findingToProblemRow maps its firstSeenAt into
    // the same field an issue's createdAt lands in, and dueAtElseAge reads that.
    const undated = row({ id: "undated", dueAt: null, firstSeenAt: "2025-01-01T00:00:00Z" });
    const [v2] = withRankScores([undated], RANK_PRESET_V2, NOW);
    expect(v2!.rankTimed).toBe(true);
    expect(v2!.rankTimeBasis).toBe("createdAt");
    // The shipped default reads dueAt ONLY, so the same row's clock is unmeasured there.
    const [v1] = withRankScores([undated], DEFAULT_RANK_RULE, NOW);
    expect(v1!.rankTimed).toBe(false);
    expect(v1!.rankTimeBasis).toBeNull();
  });

  it("prefers the deadline over the birth date where a row carries both", () => {
    const [scored] = withRankScores([rich], RANK_PRESET_V2, NOW);
    expect(scored!.rankTimeBasis).toBe("dueAt");
  });
});

describe("the rank inputs reach the projection", () => {
  it("carries the exploitation fold and the adjacency stamp off an issue row", () => {
    const issue = issueFixture({ status: "OPEN" }) as unknown as Record<string, unknown>;
    issue["aiAdjacency"] = "DIRECT";
    issue["exploitationTier"] = "epss";
    issue["epssPeak"] = 0.42;
    issue["exploitationFindingCount"] = 2;
    const r = issueToProblemRow(issue as unknown as IssueRow, undefined);
    expect(r.aiAdjacency).toBe("DIRECT");
    expect(r.exploitationTier).toBe("epss");
    expect(r.epssPeak).toBe(0.42);
    expect(r.exploitationFindingCount).toBe(2);
  });

  it("drops a tier that is not on the ladder rather than passing it through", () => {
    // rank.exploitationOf would read an unrecognised tier as null anyway, so dropping it
    // here keeps the two in agreement instead of relying on a downstream coincidence.
    const issue = issueFixture({ status: "OPEN" }) as unknown as Record<string, unknown>;
    issue["exploitationTier"] = "VERY_BAD";
    issue["aiAdjacency"] = "SOMEWHERE";
    const r = issueToProblemRow(issue as unknown as IssueRow, undefined);
    expect(r.exploitationTier).toBeUndefined();
    expect(r.aiAdjacency).toBeUndefined();
  });
});

describe("compareProblemsBy — the optional level 0", () => {
  const SHUFFLED = [
    row({ id: "d", severity: "LOW", rankScore: 0.9 }),
    row({ id: "a", severity: "CRITICAL", dueAt: "2026-08-01T00:00:00Z", rankScore: 0.1 }),
    row({ id: "c", severity: "HIGH", rankScore: 0.5 }),
    row({ id: "b", severity: "CRITICAL", rankScore: 0.5 }),
    row({ id: "e", severity: "MEDIUM" }),
  ];

  it("false IS compareProblems — the same reference, not a lookalike", () => {
    expect(compareProblemsBy(false)).toBe(compareProblems);
  });

  it("false leaves a shuffled fixture in exactly today's order", () => {
    const today = [...SHUFFLED].sort(compareProblems).map((r) => r.id);
    expect([...SHUFFLED].sort(compareProblemsBy(false)).map((r) => r.id)).toEqual(today);
    expect(rankProblems(SHUFFLED).map((r) => r.id)).toEqual(today);
    expect(rankProblems(SHUFFLED, false).map((r) => r.id)).toEqual(today);
  });

  it("true puts the higher score first and an unscored row LAST", () => {
    // 0.9, then the 0.5 pair (severity separates them), then 0.1, then the row the model
    // never scored — last, because an unscored row has not scored zero.
    expect(rankProblems(SHUFFLED, true).map((r) => r.id)).toEqual(["d", "b", "c", "a", "e"]);
  });

  it("true falls through to today's four levels on a tie", () => {
    // b and c both score 0.5; severity then separates them, CRITICAL first.
    const tied = rankProblems(SHUFFLED, true).map((r) => r.id);
    expect(tied.indexOf("b")).toBeLessThan(tied.indexOf("c"));
  });
});
