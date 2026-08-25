// The graph and the Toxic Combinations matrix must answer the same question the same way.
//
// They did not. graphEnrich's topology builder treated `isOpenToAllInternet === true` as
// exposure; comboDigest.carriesCondition read only `isAccessibleFromInternet`. An asset
// open to the whole internet with `isAccessibleFromInternet: false` was therefore drawn as
// a definite INTERNET_EXPOSURE node on the Security Graph and reported as definitely NOT
// exposed in the matrix — the strongest exposure signal Wiz has, silently dropped on the
// page whose whole job is to count risk conditions.
//
// sampleData.ts cannot express this: it defaults both flags to false and no seed sets
// `openInternet` without `internet`, so neither the golden snapshot nor any existing test
// could see it. Hence hand-built fixtures.

import { describe, expect, it } from "vitest";
import { comboDigest } from "../src/domain/comboDigest";
import type { GNode, IssueRow } from "../src/domain/graphTypes";
import { conditionHolds, conditionState } from "../src/domain/riskConditions";
import { withInternetExposureNodes } from "../src/domain/graphEnrich";
import { CONDITION_KEYS } from "../src/domain/toxicCombos";

function asset(over: Partial<GNode> = {}): GNode {
  return { id: "a1", kind: "AI_AGENT", name: "Agent-A", ...over } as GNode;
}

const NOW = "2026-08-13T09:00:00.000Z";

describe("INTERNET_EXPOSURE reads both flags", () => {
  it("open to all the internet counts, even when reachability says false", () => {
    const node = asset({ isOpenToAllInternet: true, isAccessibleFromInternet: false });
    expect(conditionState(node, "INTERNET_EXPOSURE")).toBe(true);
  });

  it("reachable from the internet counts on its own", () => {
    expect(conditionState(asset({ isAccessibleFromInternet: true }), "INTERNET_EXPOSURE"))
      .toBe(true);
  });

  it("both explicitly false is a definite no", () => {
    const node = asset({ isAccessibleFromInternet: false, isOpenToAllInternet: false });
    expect(conditionState(node, "INTERNET_EXPOSURE")).toBe(false);
  });

  it("an unknown flag stays undetermined rather than collapsing to no", () => {
    // A hosted agent inherits exposure from the compute underneath it; Wiz reports null.
    const node = asset({ isAccessibleFromInternet: null, isOpenToAllInternet: false });
    expect(conditionState(node, "INTERNET_EXPOSURE")).toBeNull();
  });
});

describe("the graph and the matrix agree", () => {
  // The regression this file exists for: the same node, through both code paths.
  const DIVERGENT = asset({ isOpenToAllInternet: true, isAccessibleFromInternet: false });

  it("draws an exposure node exactly when the matrix counts one as carried", () => {
    const doc = { nodes: [DIVERGENT], edges: [], syncedAt: NOW };
    const drawn = withInternetExposureNodes(doc).nodes
      .some((n) => n.kind === "INTERNET_EXPOSURE");

    const issues: IssueRow[] = [{
      id: "i1", assetId: DIVERGENT.id, status: "OPEN",
      nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH",
      comboGroup: "gcp-managed-privileged",
    } as IssueRow];
    const digest = comboDigest(issues, [DIVERGENT], NOW);
    const group = digest.groups.find((g) => g.conditions.INTERNET_EXPOSURE.total > 0);

    expect(drawn).toBe(true);
    expect(group?.conditions.INTERNET_EXPOSURE.carried).toBe(1);
    expect(group?.conditions.INTERNET_EXPOSURE.unknown).toBe(0);
  });

  it("neither draws nor counts a node with both flags false", () => {
    const safe = asset({ id: "a2", isAccessibleFromInternet: false, isOpenToAllInternet: false });
    const doc = { nodes: [safe], edges: [], syncedAt: NOW };
    expect(withInternetExposureNodes(doc).nodes.some((n) => n.kind === "INTERNET_EXPOSURE"))
      .toBe(false);
    expect(conditionState(safe, "INTERNET_EXPOSURE")).toBe(false);
  });
});

// THE CONTRACT THESE THREE USED TO KEEP WAS WITHDRAWN, and this block records why rather
// than quietly re-baselining. It read: "are strictly boolean — only exposure can be
// undetermined", on the stated grounds that "the other three read a flag on the resource
// itself, where an unset value is a definite no — a bucket has no guardrail to be missing."
//
// The live tenant falsified it. Wiz returns `null` — never evaluated — for the privilege and
// sensitive-data flags on 753 of 822 assets, and `guardrailMissing` is only ever set TRUE (the
// coverage scan is a negated traversal), so an unset value there had never once meant "we
// looked and a guardrail is attached". The old contract held only because `syncNormalize.bool`
// and `syncStore.boolCell` collapsed every `null` to `false` before it could reach this
// predicate — so the assertion was true of the pipeline while being false of the tenant.
//
// The measured consequence: `guardrailMissing === false` paired with a non-exposed flag let
// `posture.containmentOf` read STRONG containment for assets nothing had ever been checked on.
// All four conditions are tri-state now, on one shared rule.
describe("all four conditions are tri-state", () => {
  it("answers null — not false — when no source was ever evaluated", () => {
    const blank = asset();
    for (const key of CONDITION_KEYS) {
      expect(conditionState(blank, key), key).toBeNull();
    }
  });

  it("answers false only when every source gave a definite negative", () => {
    const answered = asset({
      guardrailMissing: false,
      hasAdminPrivileges: false, hasHighPrivileges: false,
      hasSensitiveData: false, hasAccessToSensitiveData: false,
      isAccessibleFromInternet: false, isOpenToAllInternet: false,
    });
    for (const key of CONDITION_KEYS) {
      expect(conditionState(answered, key), key).toBe(false);
    }
  });

  it("withholds a negative while any one source is still unanswered", () => {
    // Half-answered is not answered: a positive could still be hiding in the flag nobody read.
    expect(conditionState(asset({ hasAdminPrivileges: false }), "EXCESSIVE_PRIVILEGE")).toBeNull();
    expect(conditionState(asset({ hasSensitiveData: false }), "SENSITIVE_DATA")).toBeNull();
  });

  it("MISSING_GUARDRAIL distinguishes scanned-and-clean from never-scanned", () => {
    expect(conditionState(asset({ guardrailMissing: true }), "MISSING_GUARDRAIL")).toBe(true);
    // The scan reached this asset and found a guardrail.
    expect(conditionState(asset({ guardrailMissing: false }), "MISSING_GUARDRAIL")).toBe(false);
    // The scan never reached it — which is NOT the same claim, and used to be reported as one.
    expect(conditionState(asset(), "MISSING_GUARDRAIL")).toBeNull();
  });

  it("conditionHolds still means strictly true, so no topology builder moved", () => {
    // The whole tri-state widening is invisible to every consumer that asks "does this hold",
    // which is what let it ship without moving a score, a verdict or a drawn node.
    for (const key of CONDITION_KEYS) {
      expect(conditionHolds(asset(), key), key).toBe(false);
    }
    expect(conditionHolds(asset({ guardrailMissing: true }), "MISSING_GUARDRAIL")).toBe(true);
  });

  it("EXCESSIVE_PRIVILEGE and SENSITIVE_DATA take either of their two flags", () => {
    expect(conditionState(asset({ hasAdminPrivileges: true }), "EXCESSIVE_PRIVILEGE")).toBe(true);
    expect(conditionState(asset({ hasHighPrivileges: true }), "EXCESSIVE_PRIVILEGE")).toBe(true);
    expect(conditionState(asset({ hasSensitiveData: true }), "SENSITIVE_DATA")).toBe(true);
    expect(conditionState(asset({ hasAccessToSensitiveData: true }), "SENSITIVE_DATA")).toBe(true);
  });
});

describe("conditionHolds is the strict reading the topology builders need", () => {
  it("undetermined does not draw a node", () => {
    const unknown = asset({ isAccessibleFromInternet: null, isOpenToAllInternet: null });
    expect(conditionState(unknown, "INTERNET_EXPOSURE")).toBeNull();
    expect(conditionHolds(unknown, "INTERNET_EXPOSURE")).toBe(false);
  });
});
