// reach.ts — the estate-grain coverage roll-up. Every assertion here is either a stage's
// PREDICATE (does the right asset land on the right side of the pair), the never-zero-for-
// unknown rule (an axis with no decided items reads 0% known, never 100%), the empty-estate
// case (nothing throws, everything reads 0 of 0), or the covered<=total invariant that
// makes every pair honest regardless of what fed it.

import { describe, expect, it } from "vitest";
import { estateReach, type EstateReachInput, READ_TIME_EDGE_TYPES } from "../src/domain/reach";
import { treeDiscrimination } from "../src/domain/problemRule";
import { EDGE_TYPES, type GEdge, type GNode } from "../src/domain/graphTypes";
import { findingFixture, issueFixture, nodeFixture } from "./problem.fixture";

function edge(src: string, dst: string, type: GEdge["type"]): GEdge {
  return { id: `${src}|${type}|${dst}`, src, dst, type };
}

function stageOf(out: ReturnType<typeof estateReach>, key: string) {
  const s = out.stages.find((s) => s.key === key);
  if (!s) throw new Error(`no stage ${key}`);
  return s;
}

describe("estateReach — empty estate", () => {
  const empty: EstateReachInput = { assets: [], issues: [], findings: [], edges: [] };

  it("throws on nothing, and every stage reads 0 of 0", () => {
    const out = estateReach(empty);
    expect(out.stages).toHaveLength(5);
    for (const s of out.stages) {
      expect(s.covered, s.key).toBe(0);
      expect(s.total, s.key).toBe(0);
    }
  });

  it("the kind histogram and edge census are both empty, against the full declared vocabulary", () => {
    const out = estateReach(empty);
    expect(out.kinds).toEqual([]);
    expect(out.edges.declared).toBe(EDGE_TYPES.length);
    expect(out.edges.populated).toEqual([]);
    // Every declared type is unseen on an empty estate, but they split by WHERE each is
    // built: the read-time folds are `synthetic` (absent by design), the rest are `dead`.
    expect([...out.edges.dead, ...out.edges.synthetic].sort())
      .toEqual([...EDGE_TYPES].sort());
    expect(out.edges.synthetic).toEqual([...READ_TIME_EDGE_TYPES]);
  });

  it("every axis reads 0 — never 1 — when nothing was ever decided, and axesPopulation says so", () => {
    const out = estateReach(empty);
    for (const axis of ["exploitation", "impact", "exposure", "mission"]) {
      expect(out.axes[axis], axis).toBe(0);
    }
    expect(out.axesPopulation).toBe(0);
  });
});

describe("estateReach — covered <= total, always", () => {
  it("holds across a mixed estate", () => {
    const assets: GNode[] = [
      nodeFixture({ id: "a1", kind: "AI_AGENT", guardrailMissing: true }),
      nodeFixture({ id: "a2", kind: "AI_MODEL", businessImpact: "HBI", aars: 40 }),
      nodeFixture({ id: "sub1", kind: "BUCKET", hasSensitiveData: true }),
    ];
    const issues = [issueFixture({ assetId: "a1", status: "OPEN" })];
    const findings = [findingFixture({ resourceId: "a2", result: "FAIL", status: "OPEN" })];
    const edges = [edge("a2", "sub1", "STORED_IN")];
    const out = estateReach({ assets, issues, findings, edges });
    for (const s of out.stages) {
      expect(s.covered, s.key).toBeLessThanOrEqual(s.total);
      expect(s.covered, s.key).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("estateReach — stage 1, in register", () => {
  it("covers the AI-kinded rows against the WHOLE register, substrate included", () => {
    const assets: GNode[] = [
      nodeFixture({ id: "agent-1", kind: "AI_AGENT" }),
      nodeFixture({ id: "model-1", kind: "AI_MODEL" }),
      nodeFixture({ id: "sa-1", kind: "SERVICE_ACCOUNT" }),
      nodeFixture({ id: "bucket-1", kind: "BUCKET" }),
    ];
    const out = estateReach({ assets, issues: [], findings: [], edges: [] });
    const stage = stageOf(out, "register");
    expect(stage.covered).toBe(2); // AI_AGENT + AI_MODEL
    expect(stage.total).toBe(4); // every row, substrate included
  });
});

describe("estateReach — stage 2, observed", () => {
  it("counts an AI asset with an unresolved issue, an open finding, or a held condition — never one with none", () => {
    const withIssue = nodeFixture({ id: "has-issue", kind: "AI_AGENT" });
    const withFinding = nodeFixture({ id: "has-finding", kind: "AI_AGENT" });
    const withCondition = nodeFixture({ id: "has-condition", kind: "AI_AGENT", guardrailMissing: true });
    const withNothing = nodeFixture({ id: "has-nothing", kind: "AI_AGENT" });
    const assets = [withIssue, withFinding, withCondition, withNothing];
    const issues = [issueFixture({ assetId: "has-issue", status: "OPEN" })];
    const findings = [findingFixture({ resourceId: "has-finding", result: "FAIL", status: "OPEN" })];
    const out = estateReach({ assets, issues, findings, edges: [] });
    const stage = stageOf(out, "observed");
    expect(stage.covered).toBe(3);
    expect(stage.total).toBe(4);
  });

  it("does not count a RESOLVED issue or a PASSing finding as signal", () => {
    const a = nodeFixture({ id: "closed-out", kind: "AI_AGENT" });
    const issues = [issueFixture({ assetId: "closed-out", status: "RESOLVED" })];
    const findings = [findingFixture({ resourceId: "closed-out", result: "PASS", status: "RESOLVED" })];
    const out = estateReach({ assets: [a], issues, findings, edges: [] });
    expect(stageOf(out, "observed").covered).toBe(0);
  });
});

describe("estateReach — stage 3, enriched", () => {
  it("counts an AI asset touched by an edge, by exposure evidence, or by human-access evidence", () => {
    const viaEdge = nodeFixture({ id: "via-edge", kind: "AI_AGENT" });
    const viaExposure = nodeFixture({
      id: "via-exposure", kind: "AI_AGENT",
      exposureEvidence: { hostIds: ["vm-1"] },
    });
    const viaHuman = nodeFixture({
      id: "via-human", kind: "AI_AGENT",
      humanAccess: { identityIds: ["user-1"] },
    });
    const untouched = nodeFixture({ id: "untouched", kind: "AI_AGENT" });
    const assets = [viaEdge, viaExposure, viaHuman, untouched];
    const edges = [edge("via-edge", "sa-1", "RUNS_AS")];
    const out = estateReach({ assets, issues: [], findings: [], edges });
    const stage = stageOf(out, "enriched");
    expect(stage.covered).toBe(3);
    expect(stage.total).toBe(4);
  });

  it("an asset appearing only as an edge's DESTINATION still counts", () => {
    const dst = nodeFixture({ id: "dst-only", kind: "AI_MODEL" });
    const edges = [edge("role-1", "dst-only", "CAN_INVOKE")];
    const out = estateReach({ assets: [dst], issues: [], findings: [], edges });
    expect(stageOf(out, "enriched").covered).toBe(1);
  });

  it("an empty exposureEvidence object (no ids) does not count as enrichment", () => {
    const a = nodeFixture({ id: "empty-evidence", kind: "AI_AGENT", exposureEvidence: {} });
    const out = estateReach({ assets: [a], issues: [], findings: [], edges: [] });
    expect(stageOf(out, "enriched").covered).toBe(0);
  });
});

describe("estateReach — stage 4, attributed", () => {
  it("counts an AI asset with a business-impact tier, never one with none", () => {
    const hbi = nodeFixture({ id: "hbi", kind: "AI_AGENT", businessImpact: "HBI" });
    const none = nodeFixture({ id: "none", kind: "AI_AGENT" });
    const out = estateReach({ assets: [hbi, none], issues: [], findings: [], edges: [] });
    const stage = stageOf(out, "attributed");
    expect(stage.covered).toBe(1);
    expect(stage.total).toBe(2);
  });
});

describe("estateReach — stage 5, decided", () => {
  it("counts an AI asset with a persisted AARS score, or a folded problem verdict — never neither", () => {
    const scored = nodeFixture({ id: "scored", kind: "AI_AGENT", aars: 62 });
    const routed = nodeFixture({ id: "routed", kind: "AI_AGENT", worstOpenProblem: "ACT" });
    const neither = nodeFixture({ id: "neither", kind: "AI_AGENT" });
    const out = estateReach({
      assets: [scored, routed, neither], issues: [], findings: [], edges: [],
    });
    const stage = stageOf(out, "decided");
    expect(stage.covered).toBe(2);
    expect(stage.total).toBe(3);
  });
});

describe("estateReach — kind histogram", () => {
  it("flags AI_ASSET_KINDS membership per kind and counts every row, substrate included", () => {
    const assets = [
      nodeFixture({ id: "a1", kind: "AI_AGENT" }),
      nodeFixture({ id: "a2", kind: "AI_AGENT" }),
      nodeFixture({ id: "b1", kind: "BUCKET" }),
    ];
    const out = estateReach({ assets, issues: [], findings: [], edges: [] });
    const byKind = new Map(out.kinds.map((k) => [k.kind, k]));
    expect(byKind.get("AI_AGENT")).toMatchObject({ total: 2, ai: true });
    expect(byKind.get("BUCKET")).toMatchObject({ total: 1, ai: false });
  });
});

describe("estateReach — edge census", () => {
  it("reports populated/dead against the DECLARED vocabulary, not merely what was found", () => {
    const out = estateReach({
      assets: [], issues: [], findings: [],
      edges: [edge("x", "y", "RUNS_AS"), edge("x", "z", "HOSTED_ON")],
    });
    expect(out.edges.declared).toBe(EDGE_TYPES.length);
    expect(out.edges.populated.sort()).toEqual(["HOSTED_ON", "RUNS_AS"]);
    expect(out.edges.dead).not.toContain("RUNS_AS");
    // Minus the two seen here, and minus the read-time folds, which are never `dead`.
    expect(out.edges.dead.length)
      .toBe(EDGE_TYPES.length - 2 - READ_TIME_EDGE_TYPES.length);
  });
});

describe("estateReach — per-axis known%", () => {
  it("is exactly 1 - treeDiscrimination.unknownRate over the same decided population", () => {
    const decidedIssue = issueFixture({
      assetId: "a1", status: "OPEN",
      problemOutcome: "ACT",
      problemInput: {
        vector: { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
        unknowns: [],
        evidenced: true,
        exploitationSource: "validated",
      },
    });
    const undecidedAxisIssue = issueFixture({
      assetId: "a2", status: "OPEN",
      problemOutcome: "TRACK",
      problemInput: {
        vector: { exploitation: "UNKNOWN", impact: "PARTIAL", exposure: "UNVERIFIED", mission: "LOW" },
        unknowns: ["exploitation", "exposure"],
        evidenced: false,
        exploitationSource: "none",
      },
    });
    const out = estateReach({
      assets: [], issues: [decidedIssue, undecidedAxisIssue], findings: [], edges: [],
    });
    const td = treeDiscrimination([
      {
        outcome: "ACT",
        vector: decidedIssue.problemInput!.vector,
        unknowns: decidedIssue.problemInput!.unknowns,
      },
      {
        outcome: "TRACK",
        vector: undecidedAxisIssue.problemInput!.vector,
        unknowns: undecidedAxisIssue.problemInput!.unknowns,
      },
    ]);
    for (const axis of ["exploitation", "impact", "exposure", "mission"] as const) {
      expect(out.axes[axis]).toBeCloseTo(1 - td.unknownRate[axis], 10);
    }
    // Half the population is unknown on exploitation, so known% is exactly 0.5 — a concrete
    // sanity check beside the structural one above.
    expect(out.axes["exploitation"]).toBeCloseTo(0.5, 10);
    expect(out.axesPopulation).toBe(2);
  });

  it("ignores a row with an outcome but no persisted problemInput — never decided", () => {
    const half = issueFixture({
      assetId: "a1", status: "OPEN", problemOutcome: "ACT", problemInput: undefined,
    });
    const out = estateReach({ assets: [], issues: [half], findings: [], edges: [] });
    for (const axis of ["exploitation", "impact", "exposure", "mission"]) {
      expect(out.axes[axis], axis).toBe(0);
    }
    expect(out.axesPopulation).toBe(0);
  });
});

describe("edge census — dead vs synthetic", () => {
  // The census splits two very different claims that both look like "absent from ai_edges".
  // A read-time type is absent BY DESIGN and says nothing about coverage; a genuinely
  // unconstructed type is the finding. Collapsing them inflated the seed's gap from four to
  // ten, which is the same false reading this panel exists to refuse — pointed the other way.
  it("never reports a read-time type as a coverage gap", () => {
    const r = estateReach({ assets: [], issues: [], findings: [], edges: [] });
    for (const t of READ_TIME_EDGE_TYPES) {
      expect(r.edges.dead, `${t} is drawn at read time and must not read as dead`)
        .not.toContain(t);
      expect(r.edges.synthetic).toContain(t);
    }
  });

  it("partitions the declared vocabulary exactly — nothing lost, nothing counted twice", () => {
    const r = estateReach({ assets: [], issues: [], findings: [], edges: [] });
    const seen = [...r.edges.populated, ...r.edges.dead, ...r.edges.synthetic];
    expect(seen.length).toBe(r.edges.declared);
    expect(new Set(seen).size).toBe(r.edges.declared);
  });

  it("still reports a genuinely unconstructed type as dead", () => {
    // USES_TOOL is declared in EDGE_TYPES and built by nothing anywhere in the product.
    const r = estateReach({ assets: [], issues: [], findings: [], edges: [] });
    expect(r.edges.dead).toContain("USES_TOOL");
  });
});
