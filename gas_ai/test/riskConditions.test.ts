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

describe("the other three keep the contract they had", () => {
  it("are strictly boolean — only exposure can be undetermined", () => {
    const blank = asset();
    for (const key of CONDITION_KEYS) {
      if (key === "INTERNET_EXPOSURE") continue;
      expect(conditionState(blank, key), key).toBe(false);
    }
  });

  it("MISSING_GUARDRAIL needs the flag explicitly set", () => {
    expect(conditionState(asset({ guardrailMissing: true }), "MISSING_GUARDRAIL")).toBe(true);
    expect(conditionState(asset({ guardrailMissing: false }), "MISSING_GUARDRAIL")).toBe(false);
    expect(conditionState(asset(), "MISSING_GUARDRAIL")).toBe(false);
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
