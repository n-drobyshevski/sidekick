// src/domain/problems.ts — the union invariant and the five-level tiebreak, each level
// pinned in isolation so a future edit that reorders the cascade fails here rather than
// only showing up as a shuffled Priorities page nobody can explain.

import { describe, expect, it } from "vitest";
import {
  buildProblemRows,
  compareProblems,
  countProblemRowsByOutcome,
  findingToProblemRow,
  issueToProblemRow,
  rankProblems,
  type ProblemRow,
} from "../src/domain/problems";
import { findingFixture, issueFixture, nodeFixture } from "./problem.fixture";
import type { FindingRow, IssueRow } from "../src/domain/graphTypes";

function row(over: Partial<ProblemRow> = {}): ProblemRow {
  return {
    id: "p-1",
    kind: "ISSUE",
    title: "Rule",
    assetId: "asset-1",
    assetName: "Asset",
    problemOutcome: "TRACK",
    vector: null,
    unknowns: [],
    dueAt: null,
    postureTier: null,
    amplification: { tools: null, identity: null, persistence: null, multiAgent: null, context: null, language: null },
    severity: null,
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
  it("1. orders by outcome, worst (ACT) first, undecided last", () => {
    const rows = [
      row({ id: "a", problemOutcome: "TRACK" }),
      row({ id: "b", problemOutcome: "" }),
      row({ id: "c", problemOutcome: "ACT" }),
      row({ id: "d", problemOutcome: "ATTEND" }),
      row({ id: "e", problemOutcome: "TRACK_STAR" }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("2. within one outcome, orders by posture tier, worst (4) first, unscored last", () => {
    const rows = [
      row({ id: "a", postureTier: 2 }),
      row({ id: "b", postureTier: null }),
      row({ id: "c", postureTier: 4 }),
      row({ id: "d", postureTier: 1 }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
  });

  it("3. within one outcome and tier, orders by SLA urgency, no-deadline last", () => {
    const rows = [
      row({ id: "future", dueAt: "2026-09-01T00:00:00Z" }),
      row({ id: "none", dueAt: null }),
      row({ id: "overdue", dueAt: "2026-08-01T00:00:00Z" }),
      row({ id: "soon", dueAt: "2026-08-14T00:00:00Z" }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["overdue", "soon", "future", "none"]);
  });

  it("4. within one outcome, tier and SLA, orders by the amplification vector lexicographically", () => {
    const base = { problemOutcome: "TRACK", postureTier: null, dueAt: null } as const;
    const rows = [
      row({ id: "low", ...base, amplification: { tools: null, identity: 0, persistence: null, multiAgent: null, context: null, language: null } }),
      row({ id: "high", ...base, amplification: { tools: null, identity: 1, persistence: null, multiAgent: null, context: null, language: null } }),
      // Unmeasured (null) must not outrank an explicit 0 on the same axis.
      row({ id: "unmeasured", ...base, amplification: { tools: null, identity: null, persistence: null, multiAgent: null, context: null, language: null } }),
    ];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["high", "low", "unmeasured"]);
  });

  it("5. ties on everything else break on id, ascending, for stability", () => {
    const base = row({ id: "z" });
    const rows = [{ ...base, id: "z" }, { ...base, id: "a" }, { ...base, id: "m" }];
    expect(rankProblems(rows).map((r) => r.id)).toEqual(["a", "m", "z"]);
  });

  it("is a total, deterministic order — re-sorting a ranked list is a no-op", () => {
    const rows = [
      row({ id: "a", problemOutcome: "ACT", postureTier: 4, dueAt: "2026-08-01T00:00:00Z" }),
      row({ id: "b", problemOutcome: "ACT", postureTier: 2 }),
      row({ id: "c", problemOutcome: "TRACK" }),
      row({ id: "d", problemOutcome: "" }),
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
