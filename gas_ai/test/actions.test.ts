// src/domain/actions.ts — ranking remediation ACTIONS rather than problems. The invariant
// that matters most is set-cover completeness (the same "nothing vanishes, nothing
// double-counted" guarantee `toxicCombos.ts`'s `comboSummary` documents at ~line 220-227,
// applied here at the action grain); the trap that matters most is scoring the greedy
// round by ASSET coverage instead of PROBLEM coverage, which this file's overlap fixture
// exists to catch.

import { describe, expect, it } from "vitest";
import {
  actionKeyOf,
  concentrationRatio,
  coverCurve,
  rankActionsByCover,
  withAutoRemediation,
  type ActionRow,
} from "../src/domain/actions";
import { buildProblemRows, type ProblemRow } from "../src/domain/problems";
import { isOpenGap, isUnresolvedIssue } from "../src/domain/config";
import { OUTCOME_VALUES } from "../src/domain/problem";
import { findingFixture, issueFixture } from "./problem.fixture";
import { SEED_FINDINGS, SEED_FRAMEWORK_POLICIES, SEED_ISSUES } from "../src/server/sampleData";
import type { FindingRow, GNode, IssueRow } from "../src/domain/graphTypes";

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
    postureState: null,
    amplification: {
      tools: null, identity: null, persistence: null, multiAgent: null, context: null, language: null,
    },
    severity: null,
    iac: false,
    ignored: false,
    ...over,
  };
}

describe("actionKeyOf", () => {
  it("keeps kind in the key so an issue rule and a finding rule sharing an id never collide", () => {
    const issueKey = actionKeyOf({ kind: "ISSUE", ruleId: "shared-id", ruleShortId: undefined });
    const findingKey = actionKeyOf({ kind: "FINDING", ruleId: "shared-id", ruleShortId: undefined });
    expect(issueKey).not.toBe(findingKey);
  });

  it("both id fields participate, so an absent shortId and an absent ruleId key differently", () => {
    const a = actionKeyOf({ kind: "FINDING", ruleId: "r1", ruleShortId: undefined });
    const b = actionKeyOf({ kind: "FINDING", ruleId: undefined, ruleShortId: "r1" });
    expect(a).not.toBe(b);
  });
});

describe("set-cover completeness", () => {
  it("Σ problems across ALL ranked actions equals the union total — nothing vanishes, "
    + "nothing double-counted, the same guarantee comboSummary documents", () => {
    const issues: IssueRow[] = [
      issueFixture({ ruleId: "rule-a", status: "OPEN" }),
      issueFixture({ ruleId: "rule-a", status: "IN_PROGRESS" }),
      issueFixture({ ruleId: "rule-b", status: "OPEN" }),
      issueFixture({ ruleId: "rule-a", status: "RESOLVED" }), // must not appear anywhere
    ];
    const findings: FindingRow[] = [
      findingFixture({ ruleShortId: "SUB-001", result: "FAIL", status: "OPEN" }),
      findingFixture({ ruleShortId: "SUB-001", result: "FAIL", status: "OPEN" }),
      findingFixture({ ruleShortId: "SUB-002", result: "PASS", status: "OPEN" }), // excluded
    ];
    const rows = buildProblemRows(issues, findings, new Map());
    const expectedTotal =
      issues.filter(isUnresolvedIssue).length + findings.filter(isOpenGap).length;
    expect(rows.length).toBe(expectedTotal);

    const ranked = rankActionsByCover(rows);
    const sum = ranked.reduce((n, a) => n + a.problems, 0);
    expect(sum).toBe(expectedTotal);

    // Every ranked action's problems are also mutually exclusive by id — the stronger
    // claim behind "nothing double-counted", not just that the totals happen to agree.
    const seenIds = new Set<string>();
    for (const action of ranked) {
      const membersOfThisAction = rows.filter((r) => actionKeyOf(r) === action.key);
      for (const m of membersOfThisAction) {
        expect(seenIds.has(m.id), `${m.id} counted under more than one action`).toBe(false);
        seenIds.add(m.id);
      }
    }
    expect(seenIds.size).toBe(expectedTotal);
  });

  it("keeps a row with no verdict in the union, and reports it under its own action", () => {
    const issue = issueFixture({ ruleId: "rule-undecided", status: "OPEN" });
    delete issue.problemOutcome;
    delete issue.problemInput;
    const rows = buildProblemRows([issue], [], new Map());
    const ranked = rankActionsByCover(rows);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.problems).toBe(1);
    expect(ranked[0]!.worstOutcome).toBe("");
  });
});

describe("greedy removal — the asset-overlap trap", () => {
  // Action A (ISSUE, rule-a): 5 problems, worst outcome ACT, on assets x1..x5.
  // Action B (FINDING, rule-b): 3 problems, worst outcome ATTEND, on assets x1, x2, x6 —
  // TWO of which (x1, x2) A also touches. Coverage must be scored by PROBLEM ID, never by
  // ASSET: fixing rule-a's issues does nothing for rule-b's findings even though they sit
  // on the same buckets. A naive "independent sort" that marked an ASSET covered once any
  // action touched it (rather than removing exactly the covered problem ids) would shrink
  // B's remaining count to 1 (only x6 left) once A is picked first — this fixture is
  // written so that bug fails it.
  const actionARows: ProblemRow[] = ["x1", "x2", "x3", "x4", "x5"].map((asset, i) =>
    row({
      id: `a-${i}`, kind: "ISSUE", ruleId: "rule-a", ruleShortId: undefined,
      assetId: asset, problemOutcome: "ACT",
    }));
  const actionBRows: ProblemRow[] = ["x1", "x2", "x6"].map((asset, i) =>
    row({
      id: `b-${i}`, kind: "FINDING", ruleId: undefined, ruleShortId: "rule-b",
      assetId: asset, problemOutcome: "ATTEND",
    }));

  it("ranks the worse-outcome action first, and the second action's count is its own "
    + "full count — unaffected by the assets it shares with the first", () => {
    const rows = [...actionARows, ...actionBRows];
    const ranked = rankActionsByCover(rows);

    expect(ranked).toHaveLength(2);
    const [first, second] = ranked as [ActionRow, ActionRow];

    // Before: what each action's OWN group looks like, computed independently of order.
    expect(actionARows.length).toBe(5);
    expect(actionBRows.length).toBe(3);

    // After greedy removal: A (worse outcome) is picked first and closes all 5 of its own
    // problems; B is picked second and closes all 3 of ITS OWN problems — not 1, which is
    // what an asset-scoped removal would have left after x1/x2 were marked "handled" by A.
    expect(first.ruleId).toBe("rule-a");
    expect(first.problems).toBe(5);
    expect(second.ruleShortId).toBe("rule-b");
    expect(second.problems).toBe(3); // the trap: an asset-scoped bug would report 1 here

    expect(first.problems + second.problems).toBe(rows.length);
  });

  it("assets touched can still legitimately overlap between two actions' OWN counts, "
    + "even though their PROBLEM counts never do", () => {
    const ranked = rankActionsByCover([...actionARows, ...actionBRows]);
    const [first, second] = ranked as [ActionRow, ActionRow];
    expect(first.assets).toBe(5); // x1..x5
    expect(second.assets).toBe(3); // x1, x2, x6 — x1/x2 legitimately recur here too
  });
});

describe("determinism", () => {
  it("same input, same order, twice — and independent of the input array's own order", () => {
    const rows: ProblemRow[] = [
      row({ id: "z", kind: "ISSUE", ruleId: "r1", problemOutcome: "ACT", assetId: "a1" }),
      row({ id: "a", kind: "ISSUE", ruleId: "r1", problemOutcome: "ATTEND", assetId: "a2" }),
      row({ id: "m", kind: "FINDING", ruleShortId: "r2", problemOutcome: "TRACK", assetId: "a3" }),
    ];
    const once = rankActionsByCover(rows).map((a) => [a.key, a.problems]);
    const twice = rankActionsByCover(rows).map((a) => [a.key, a.problems]);
    expect(twice).toEqual(once);

    const reversed = rankActionsByCover([...rows].reverse()).map((a) => [a.key, a.problems]);
    expect(reversed).toEqual(once);
  });
});

describe("worstOutcome", () => {
  it("is a typed outcome string — never a number, never a mean of the group", () => {
    const rows = [
      row({ id: "p1", ruleId: "r1", problemOutcome: "ACT" }),
      row({ id: "p2", ruleId: "r1", problemOutcome: "TRACK" }),
    ];
    const [action] = rankActionsByCover(rows) as [ActionRow];
    expect(typeof action.worstOutcome).toBe("string");
    expect([...OUTCOME_VALUES, ""]).toContain(action.worstOutcome);
    // MAX (worst), never a mean: two problems averaging ACT(0) and TRACK(3) is NOT
    // ATTEND(1) or TRACK_STAR(2) — it is ACT, the worse of the two readings.
    expect(action.worstOutcome).toBe("ACT");
  });

  it("reports \"\" only when every problem in the action is undecided", () => {
    const rows = [
      row({ id: "p1", ruleId: "r1", problemOutcome: "" }),
      row({ id: "p2", ruleId: "r1", problemOutcome: "" }),
    ];
    const [action] = rankActionsByCover(rows) as [ActionRow];
    expect(action.worstOutcome).toBe("");
  });

  it("a single decided reading always outranks the undecided rows beside it", () => {
    const rows = [
      row({ id: "p1", ruleId: "r1", problemOutcome: "" }),
      row({ id: "p2", ruleId: "r1", problemOutcome: "TRACK" }),
    ];
    const [action] = rankActionsByCover(rows) as [ActionRow];
    expect(action.worstOutcome).toBe("TRACK");
  });
});

describe("remediation — the per-rule field, never the per-instance one", () => {
  it("aggregates on remediationInstructions even when the per-instance remediation "
    + "genuinely diverges within one rule — the SUB-082 trap sampleData.ts already shows", () => {
    const findings: FindingRow[] = [
      findingFixture({
        id: "cfg-a", ruleShortId: "SUB-082",
        remediation: "Encrypt the metadata store with a customer-managed key.",
        remediationInstructions: "Delete and recreate the store with a customer-managed key.",
      }),
      findingFixture({
        id: "cfg-b", ruleShortId: "SUB-082",
        remediation: "A completely different per-instance note for this one resource.",
        remediationInstructions: "Delete and recreate the store with a customer-managed key.",
      }),
    ];
    const rows = buildProblemRows([], findings, new Map());
    const [action] = rankActionsByCover(rows) as [ActionRow];
    expect(action.remediation).toBe("Delete and recreate the store with a customer-managed key.");
    // Neither per-instance string ever surfaces on the action.
    expect(action.remediation).not.toBe(findings[0]!.remediation);
    expect(action.remediation).not.toBe(findings[1]!.remediation);
  });

  it("falls back to resolutionRecommendation for an ISSUE action, never reads IssueRow.remediation "
    + "(a permanently empty column no normalizer writes)", () => {
    const issue = issueFixture({
      ruleId: "rule-c", status: "OPEN",
      resolutionRecommendation: "Rotate the exposed credential.",
    });
    (issue as unknown as { remediation?: string }).remediation = "should never be read";
    const rows = buildProblemRows([issue], [], new Map());
    const [action] = rankActionsByCover(rows) as [ActionRow];
    expect(action.remediation).toBe("Rotate the exposed credential.");
  });

  it("is undefined, not empty string, when no member row carries a rule-level remediation", () => {
    const rows = [row({ id: "p1", ruleId: "r1", problemOutcome: "TRACK" })];
    const [action] = rankActionsByCover(rows) as [ActionRow];
    expect(action.remediation).toBeUndefined();
  });
});

describe("withAutoRemediation — the dual-key join", () => {
  it("matches by ruleId first, then ruleShortId, mirroring complianceScope.ts's own join", () => {
    const actions: ActionRow[] = [
      { key: "k1", kind: "ISSUE", ruleId: "policy-1", title: "t", problems: 1, assets: 1,
        worstOutcome: "ACT", outcomeMix: {}, severityMix: {}, businessImpacts: [],
        autoRemediable: false, iac: 0, ignored: 0 },
      { key: "k2", kind: "FINDING", ruleShortId: "SUB-999", title: "t", problems: 1, assets: 1,
        worstOutcome: "ACT", outcomeMix: {}, severityMix: {}, businessImpacts: [],
        autoRemediable: false, iac: 0, ignored: 0 },
      { key: "k3", kind: "FINDING", ruleShortId: "SUB-000", title: "t", problems: 1, assets: 1,
        worstOutcome: "ACT", outcomeMix: {}, severityMix: {}, businessImpacts: [],
        autoRemediable: false, iac: 0, ignored: 0 },
    ];
    const policies = [
      { frameworkId: "f", categoryExternalId: "c", subcategoryExternalId: "s",
        policyId: "policy-1", policyKind: "CONTROL" as const, name: "n", severity: "HIGH" as const,
        passCount: 0, failCount: 1, assessedCount: 1, rejectedCount: 0, noResourceToAssess: false,
        hasAutoRemediation: true },
      { frameworkId: "f", categoryExternalId: "c", subcategoryExternalId: "s",
        policyId: "some-other-id", shortId: "SUB-999", policyKind: "CLOUD_RULE" as const,
        name: "n", severity: "HIGH" as const, passCount: 0, failCount: 1, assessedCount: 1,
        rejectedCount: 0, noResourceToAssess: false, hasAutoRemediation: true },
    ];
    const enriched = withAutoRemediation(actions, policies);
    expect(enriched.find((a) => a.key === "k1")!.autoRemediable).toBe(true);
    expect(enriched.find((a) => a.key === "k2")!.autoRemediable).toBe(true);
    // No match, and no false claim of remediability either.
    expect(enriched.find((a) => a.key === "k3")!.autoRemediable).toBe(false);
  });
});

describe("coverCurve and concentrationRatio", () => {
  it("cumulative is monotonic and the last point equals the ranked total", () => {
    const rows = [
      row({ id: "p1", ruleId: "r1", problemOutcome: "ACT" }),
      row({ id: "p2", ruleId: "r1", problemOutcome: "ACT" }),
      row({ id: "p3", ruleId: "r2", problemOutcome: "TRACK" }),
    ];
    const ranked = rankActionsByCover(rows);
    const curve = coverCurve(ranked, rows.length);
    expect(curve.map((c) => c.rank)).toEqual([1, 2]);
    expect(curve[curve.length - 1]!.cumulative).toBe(rows.length);
    expect(curve[curve.length - 1]!.share).toBeCloseTo(1);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.cumulative).toBeGreaterThanOrEqual(curve[i - 1]!.cumulative);
    }
  });

  it("concentrationRatio's top10Share is 1 when 10 or fewer actions exist and cover everything", () => {
    const rows = [
      row({ id: "p1", ruleId: "r1" }),
      row({ id: "p2", ruleId: "r2" }),
    ];
    const ranked = rankActionsByCover(rows);
    const c = concentrationRatio(ranked, rows.length);
    expect(c.actions).toBe(2);
    expect(c.problems).toBe(2);
    expect(c.top10Share).toBe(1);
  });
});

describe("the seed landscape's concentration", () => {
  it("38 open problems collapse to 12 distinct actions, and the top action alone closes 13", () => {
    const assetsById = new Map<string, GNode>();
    const rows = buildProblemRows(SEED_ISSUES, SEED_FINDINGS, assetsById);
    const totalProblems =
      SEED_ISSUES.filter(isUnresolvedIssue).length + SEED_FINDINGS.filter(isOpenGap).length;
    expect(rows.length).toBe(totalProblems);

    const ranked = rankActionsByCover(rows);
    const withAuto = withAutoRemediation(ranked, SEED_FRAMEWORK_POLICIES);
    const concentration = concentrationRatio(withAuto, rows.length);

    expect(rows.length).toBe(38);
    expect(concentration.actions).toBe(12);
    expect(concentration.problems).toBe(38);
    expect(withAuto[0]!.problems).toBe(13);
    expect(withAuto[0]!.ruleId).toBe("wc-id-3217");

    console.log(
      `seed landscape: ${totalProblems} problems -> ${concentration.actions} actions, `
      + `top10Share=${concentration.top10Share.toFixed(3)}, `
      + `top3=${withAuto.slice(0, 3).map((a) => `${a.key} (${a.problems})`).join(", ")}`,
    );
  });
});
