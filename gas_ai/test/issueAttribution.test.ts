// RUNS_AS attribution: the join that was not being made.
//
// The measurement that motivated it, on the reference tenant: 691 of 840 AI-category issues
// land on a SERVICE_ACCOUNT and only 120 on an AI_AGENT, because the rule that fires most
// (wc-id-2742, 659 of them) is about an identity's permission to invoke a model rather than
// about the agent. Only 22 of 99 in-scope issues resolved to a synced AI asset, so
// deriveProblemInput was handed `node: undefined` for the other 77 and forced impact -> unknown
// and exposure -> UNVERIFIED on every one. The measured impact-unknown rate was exactly 77 of
// 99 — the same number — and row 7 of DEFAULT_PROBLEM_RULE then decided 83 of 99.
//
// Four things this file pins, and the first two are what let the knob ship:
//
//   1. assetId is NEVER rewritten. The register keeps naming what the console names.
//   2. Under "direct" the grouping is byte-identical to the groupBy it replaced.
//   3. Fan-out is real and reported, not deduplicated away.
//   4. Attribution is strictly ADDITIVE — flipping the knob can never lower a score.

import { describe, expect, it } from "vitest";
import { issuesByAssetFor, withIssueAttribution } from "../src/domain/graphEnrich";
import { DEFAULT_AARS_RULE, AARS_V2_RULE, derivationSignature } from "../src/domain/aars";
import { DEFAULT_PROBLEM_RULE, vectorSignature } from "../src/domain/problemRule";
import { cleanAarsRule } from "../src/domain/aarsRule";
import { cleanProblemRule } from "../src/domain/problemRule";
import type { GEdge, GNode, GraphDoc, IssueRow } from "../src/domain/graphTypes";

const node = (id: string, kind: GNode["kind"]): GNode => ({ id, kind, name: id });
const runsAs = (agent: string, sa: string): GEdge => ({
  id: `${agent}|RUNS_AS|${sa}`, src: agent, dst: sa, type: "RUNS_AS",
});

/** One identity, three agents running as it — the fan-out case. */
function fanOutDoc(): GraphDoc {
  return {
    nodes: [
      node("agent-1", "AI_AGENT"), node("agent-2", "AI_AGENT"), node("agent-3", "AI_AGENT"),
      node("sa-shared", "SERVICE_ACCOUNT"),
      node("sa-orphan", "SERVICE_ACCOUNT"),
    ],
    edges: [runsAs("agent-1", "sa-shared"), runsAs("agent-2", "sa-shared"), runsAs("agent-3", "sa-shared")],
    syncedAt: "2026-08-13T09:00:00.000Z",
  };
}

let seq = 0;
function issue(assetId: string, over: Partial<IssueRow> = {}): IssueRow {
  seq += 1;
  return {
    id: `i-${seq}`, ruleId: "wc-id-2742", ruleName: "Allow model invoke without Guardrail",
    comboGroup: "bedrock-no-guardrail", nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH",
    status: "OPEN", assetId, assetName: assetId, ...over,
  } as IssueRow;
}

describe("withIssueAttribution", () => {
  it("never rewrites assetId — the register keeps naming what the console names", () => {
    const rows = withIssueAttribution(fanOutDoc(), [issue("sa-shared")]);
    expect(rows[0]!.assetId).toBe("sa-shared");
  });

  it("attributes an identity's issue to every AI asset that runs as it", () => {
    const rows = withIssueAttribution(fanOutDoc(), [issue("sa-shared")]);
    expect(rows[0]!.attributedAssetIds).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(rows[0]!.attributionHop).toBe("RUNS_AS");
  });

  it("marks an issue already on an AI asset as direct, listing itself", () => {
    const rows = withIssueAttribution(fanOutDoc(), [issue("agent-1")]);
    expect(rows[0]!.attributedAssetIds).toEqual(["agent-1"]);
    expect(rows[0]!.attributionHop).toBe("direct");
  });

  it("says `none` when the hop reaches nothing — we looked, as against we never ran", () => {
    const rows = withIssueAttribution(fanOutDoc(), [issue("sa-orphan")]);
    expect(rows[0]!.attributedAssetIds).toEqual([]);
    expect(rows[0]!.attributionHop).toBe("none");
    // Absent is the fourth state and means the fold never ran; `none` must not be confused
    // with it, which is why the hop is written even when the list is empty.
    expect(rows[0]!.attributionHop).not.toBeUndefined();
  });

  it("walks ONE hop, never transitively", () => {
    // agent -> sa-a -> sa-b. An issue on sa-b must NOT reach the agent: two hops would make
    // the register transitive-blame, charging an agent for whatever its identity can reach.
    const doc: GraphDoc = {
      nodes: [node("agent-1", "AI_AGENT"), node("sa-a", "SERVICE_ACCOUNT"), node("sa-b", "SERVICE_ACCOUNT")],
      edges: [runsAs("agent-1", "sa-a"), runsAs("sa-a", "sa-b")],
      syncedAt: "2026-08-13T09:00:00.000Z",
    };
    const rows = withIssueAttribution(doc, [issue("sa-b")]);
    expect(rows[0]!.attributedAssetIds).toEqual([]);
  });

  it("only AI-kinded runners count as an attribution target", () => {
    // A SERVICE_ACCOUNT running as another identity is not an AI asset and must not become one.
    const doc: GraphDoc = {
      nodes: [node("sa-a", "SERVICE_ACCOUNT"), node("sa-b", "SERVICE_ACCOUNT")],
      edges: [runsAs("sa-a", "sa-b")],
      syncedAt: "2026-08-13T09:00:00.000Z",
    };
    expect(withIssueAttribution(doc, [issue("sa-b")])[0]!.attributedAssetIds).toEqual([]);
  });

  it("sorts the ids, so a re-run cannot look like a change", () => {
    const doc = fanOutDoc();
    doc.edges.reverse();
    expect(withIssueAttribution(doc, [issue("sa-shared")])[0]!.attributedAssetIds)
      .toEqual(["agent-1", "agent-2", "agent-3"]);
  });
});

describe("issuesByAssetFor", () => {
  const attributed = () => withIssueAttribution(fanOutDoc(), [issue("sa-shared")]);

  it("direct is byte-identical to grouping on assetId alone — the knob is spec-neutral", () => {
    const rows = attributed();
    const map = issuesByAssetFor(rows, "direct");
    expect([...map.keys()]).toEqual(["sa-shared"]);
    expect(map.get("agent-1")).toBeUndefined();
  });

  it("runsAs charges every runner — fan-out is real and is not deduplicated away", () => {
    const map = issuesByAssetFor(attributed(), "runsAs");
    for (const agent of ["agent-1", "agent-2", "agent-3"]) {
      expect(map.get(agent)!.length, agent).toBe(1);
    }
  });

  it("is strictly ADDITIVE — the direct asset keeps its charge", () => {
    // The property that makes the knob safe to flip: it can only ever add. Keying on the
    // attributed ids alone would have REMOVED this charge from sa-shared, turning a coverage
    // widening into something that can lower a score.
    const map = issuesByAssetFor(attributed(), "runsAs");
    expect(map.get("sa-shared")!.length).toBe(1);
  });

  it("counts one issue against four assets, so the per-asset sum exceeds the issue count", () => {
    // Stated rather than discovered: the estate-wide sum is no longer the issue count.
    const map = issuesByAssetFor(attributed(), "runsAs");
    const perAsset = [...map.values()].reduce((n, rows) => n + rows.length, 0);
    expect(perAsset).toBe(4);
    expect(map.size).toBe(4);
  });

  it("falls back to assetId when the fold never ran, rather than to nothing", () => {
    const raw = [issue("sa-shared")]; // no attribution fields at all
    expect(issuesByAssetFor(raw, "runsAs").get("sa-shared")!.length).toBe(1);
  });
});

describe("the knobs are derivation knobs, and both default to direct", () => {
  it("every shipped AARS preset defaults to direct", () => {
    expect(DEFAULT_AARS_RULE.issueAttribution).toBe("direct");
    expect(AARS_V2_RULE.issueAttribution).toBe("direct");
  });

  it("DEFAULT_PROBLEM_RULE defaults to direct", () => {
    expect(DEFAULT_PROBLEM_RULE.attributionJoin).toBe("direct");
  });

  it("issueAttribution joins derivationSignature, so a flip re-derives rather than reuses", () => {
    // It changes WHICH ISSUES an asset is scored from — more radical than any pricing change.
    // Without this, enrichFromTabs would reuse a persisted aarsInput across the flip and the
    // knob would appear to do nothing until the next full sync. gapSources learned this once.
    const a = derivationSignature(DEFAULT_AARS_RULE);
    const b = derivationSignature({ ...DEFAULT_AARS_RULE, issueAttribution: "runsAs" });
    expect(a).not.toBe(b);
  });

  it("attributionJoin joins vectorSignature, for the same reason", () => {
    const a = vectorSignature(DEFAULT_PROBLEM_RULE);
    const b = vectorSignature({ ...DEFAULT_PROBLEM_RULE, attributionJoin: "runsAs" });
    expect(a).not.toBe(b);
  });

  it("an unreadable value cleans to direct, never to runsAs", () => {
    // Same convention as gapUnit: a stored rule must never silently WIDEN what it scores.
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, issueAttribution: "nonsense" }).issueAttribution)
      .toBe("direct");
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, attributionJoin: "nonsense" }).attributionJoin)
      .toBe("direct");
  });

  it("a valid runsAs survives cleaning", () => {
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, issueAttribution: "runsAs" }).issueAttribution)
      .toBe("runsAs");
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, attributionJoin: "runsAs" }).attributionJoin)
      .toBe("runsAs");
  });
});
