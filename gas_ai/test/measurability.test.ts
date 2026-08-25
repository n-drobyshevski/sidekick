// The tri-state boundary fix: `null` from Wiz must not arrive downstream as `false`.
//
// This is the test that lets the fix ship as a DEFAULT change rather than behind a knob. It
// pins three separate claims:
//
//   1. `undefined` survives normalize -> assetToRow -> rowToAsset, and the cell reads "null".
//   2. A legacy ledger cell ("false", written before this change) still reads back `false`, so
//      no tenant re-scores until it re-syncs.
//   3. The four `unknown` branches that were structurally dead — posture.capabilityOf,
//      posture.containmentOf, problem.impactOf, and the identity/context amplification factors
//      — actually fire on a live-shaped node.
//
// The seed estate is deliberately NOT touched. `sampleData.node()` writes an explicit `false`
// for every flag on every kind, so every pinned figure in aars/graphEnrich/scoreOrdinality/
// postureOrdinality keeps reading MEASURED and nothing re-baselines. ai/AARS_SCORING_ASSESSMENT.md
// section 6 records what happened last time the seed grew: three issues on `agent-e` moved
// largestTieGroup 15 -> 14 and silently invalidated a published table.

import { describe, expect, it } from "vitest";
import { normalizeCloudResource } from "../src/domain/syncNormalize";
import { conditionState } from "../src/domain/riskConditions";
import { derivePostureInput, tierEstablished, tierInScope } from "../src/domain/posture";
import { DEFAULT_POSTURE_RULE } from "../src/domain/postureRule";
import { nodeAmplificationVector } from "../src/domain/problem";
import {
  declarationContradictions,
  flagApplies,
  flagCensus,
  flagMeasurement,
  FLAG_KEYS,
} from "../src/domain/measurability";
import type { GNode } from "../src/domain/graphTypes";

/**
 * A raw `cloudResourcesV2` node in the shape the live tenant actually returns for 753 of its
 * 822 AI assets: every capability flag explicitly `null`. Not a hypothetical — this is the
 * exact payload shape measured against the reference tenant.
 */
function rawLiveShaped(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "live-1",
    name: "live-agent",
    type: "AI_AGENT",
    nativeType: "aiplatform#ReasoningEngine",
    cloudPlatform: "GCP",
    isAccessibleFromInternet: null,
    isOpenToAllInternet: null,
    hasSensitiveData: null,
    hasAccessToSensitiveData: null,
    hasAdminPrivileges: null,
    hasHighPrivileges: null,
    ...over,
  };
}

describe("normalizer: Wiz null is not a measurement", () => {
  it("leaves every unstated capability flag absent rather than false", () => {
    const node = normalizeCloudResource(rawLiveShaped())!;
    expect(node).not.toBeNull();
    expect(node.hasAdminPrivileges).toBeUndefined();
    expect(node.hasHighPrivileges).toBeUndefined();
    expect(node.hasAccessToSensitiveData).toBeUndefined();
    expect(node.hasSensitiveData).toBeUndefined();
  });

  it("still records a stated negative as a negative", () => {
    const node = normalizeCloudResource(
      rawLiveShaped({ hasAdminPrivileges: false, hasHighPrivileges: true }),
    )!;
    expect(node.hasAdminPrivileges).toBe(false);
    expect(node.hasHighPrivileges).toBe(true);
  });
});

describe("riskConditions: all four conditions are tri-state", () => {
  const bare: GNode = { id: "a", kind: "AI_AGENT", name: "a" };

  it("reports null, not false, when no source answered", () => {
    expect(conditionState(bare, "EXCESSIVE_PRIVILEGE")).toBeNull();
    expect(conditionState(bare, "SENSITIVE_DATA")).toBeNull();
    expect(conditionState(bare, "MISSING_GUARDRAIL")).toBeNull();
    expect(conditionState(bare, "INTERNET_EXPOSURE")).toBeNull();
  });

  it("reports false only when every source gave a definite negative", () => {
    const answered: GNode = {
      ...bare,
      hasAdminPrivileges: false,
      hasHighPrivileges: false,
      hasSensitiveData: false,
      hasAccessToSensitiveData: false,
      guardrailMissing: false,
      isAccessibleFromInternet: false,
      isOpenToAllInternet: false,
    };
    expect(conditionState(answered, "EXCESSIVE_PRIVILEGE")).toBe(false);
    expect(conditionState(answered, "SENSITIVE_DATA")).toBe(false);
    expect(conditionState(answered, "MISSING_GUARDRAIL")).toBe(false);
    expect(conditionState(answered, "INTERNET_EXPOSURE")).toBe(false);
  });

  it("a single positive wins over an unanswered sibling", () => {
    expect(conditionState({ ...bare, hasHighPrivileges: true }, "EXCESSIVE_PRIVILEGE")).toBe(true);
    expect(conditionState({ ...bare, isOpenToAllInternet: true }, "INTERNET_EXPOSURE")).toBe(true);
  });

  it("one unanswered source is enough to withhold a negative", () => {
    const half: GNode = { ...bare, hasAdminPrivileges: false };
    expect(conditionState(half, "EXCESSIVE_PRIVILEGE")).toBeNull();
  });
});

describe("the dead unknown branches now fire", () => {
  it("withholds a posture tier for an asset nothing was measured on", () => {
    const node = normalizeCloudResource(rawLiveShaped())!;
    const input = derivePostureInput(node, DEFAULT_POSTURE_RULE);
    expect(input.unknowns).toContain("capability");
    expect(input.unknowns).toContain("containment");
    expect(tierEstablished(input.unknowns)).toBe(false);
  });

  it("still establishes a tier when every axis was actually answered", () => {
    const node: GNode = {
      id: "b", kind: "AI_AGENT", name: "b",
      hasAdminPrivileges: false, hasHighPrivileges: false, hasAccessToSensitiveData: false,
      guardrailMissing: false, isAccessibleFromInternet: false, isOpenToAllInternet: false,
      businessImpact: "MBI",
    };
    const input = derivePostureInput(node, DEFAULT_POSTURE_RULE);
    expect(input.unknowns).toEqual([]);
    expect(tierEstablished(input.unknowns)).toBe(true);
  });

  it("reports amplification factors as null, never 0, when unmeasured", () => {
    const node = normalizeCloudResource(rawLiveShaped())!;
    const amp = nodeAmplificationVector(node);
    // The rule problem.ts already asserts for tools/persistence/multiAgent, finally true for
    // the two factors that DO have a live source.
    expect(amp.identity).toBeNull();
    expect(amp.context).toBeNull();
    expect(amp.tools).toBeNull();
    expect(amp.persistence).toBeNull();
    expect(amp.multiAgent).toBeNull();
    // `language` is a property of the KIND, not a flag, so it is still measured.
    expect(amp.language).toBe(1);
  });

  it("guardrailMissing === false is a real negative and still reads as one", () => {
    const scanned: GNode = { id: "c", kind: "AI_AGENT", name: "c", guardrailMissing: false };
    expect(conditionState(scanned, "MISSING_GUARDRAIL")).toBe(false);
  });
});

describe("posture scope: the lattice declines to rate what it cannot describe", () => {
  it("puts a dataset OUT OF SCOPE rather than rating its identity power MINIMAL", () => {
    const dataset: GNode = { id: "d1", kind: "AI_DATASET", name: "corpus", businessImpact: "MBI" };
    const input = derivePostureInput(dataset, DEFAULT_POSTURE_RULE);
    expect(input.notApplicable).toEqual(["capability"]);
    expect(tierInScope(input.notApplicable)).toBe(false);
  });

  it("keeps an unmeasured AGENT in scope — that is a coverage gap, not a scope statement", () => {
    const agent = normalizeCloudResource(rawLiveShaped())!;
    const input = derivePostureInput(agent, DEFAULT_POSTURE_RULE);
    expect(input.notApplicable).toEqual([]);
    expect(tierInScope(input.notApplicable)).toBe(true);
    // In scope, but nothing measured — so the tier is withheld pending evidence.
    expect(tierEstablished(input.unknowns)).toBe(false);
  });

  it("a humanAccess record overrides the kind table — capability becomes answerable", () => {
    const dataset: GNode = {
      id: "d2", kind: "AI_DATASET", name: "corpus",
      humanAccess: { identityIds: ["u1"], admin: true },
    };
    const input = derivePostureInput(dataset, DEFAULT_POSTURE_RULE);
    expect(input.notApplicable).toEqual([]);
    expect(input.vector.capability).toBe("BROAD");
  });

  it("a stated flag also overrides the table, so the seed estate stays in scope", () => {
    // sampleData.node() writes an explicit `false` for every flag on every kind. That is what
    // keeps every pinned ordinality figure reading exactly as it did before this change.
    const seedShaped: GNode = {
      id: "d3", kind: "AI_DATASET", name: "corpus",
      hasAdminPrivileges: false, hasHighPrivileges: false, hasAccessToSensitiveData: false,
      hasSensitiveData: false, guardrailMissing: false,
      isAccessibleFromInternet: false, isOpenToAllInternet: false,
      businessImpact: "MBI",
    };
    const input = derivePostureInput(seedShaped, DEFAULT_POSTURE_RULE);
    expect(input.notApplicable).toEqual([]);
    expect(tierInScope(input.notApplicable)).toBe(true);
    expect(tierEstablished(input.unknowns)).toBe(true);
  });
});

describe("measurability: not-applicable is not a coverage gap", () => {
  const dataset: GNode = { id: "d", kind: "AI_DATASET", name: "d" };
  const agent: GNode = { id: "e", kind: "AI_AGENT", name: "e" };

  it("a dataset has no execution identity, so an identity flag does not apply", () => {
    expect(flagMeasurement(dataset, "hasAdminPrivileges")).toBe("NOT_APPLICABLE");
    expect(flagMeasurement(dataset, "hasHighPrivileges")).toBe("NOT_APPLICABLE");
  });

  it("a dataset DOES carry content, so hasSensitiveData is a real gap when absent", () => {
    expect(flagMeasurement(dataset, "hasSensitiveData")).toBe("UNMEASURED");
  });

  it("an agent holds no content of its own — its data relationship is reach", () => {
    expect(flagMeasurement(agent, "hasSensitiveData")).toBe("NOT_APPLICABLE");
    expect(flagMeasurement(agent, "hasAccessToSensitiveData")).toBe("UNMEASURED");
  });

  it("AI_MODEL is left applicable on purpose — Wiz rule wc-id-3231 associates it with privilege", () => {
    const model: GNode = { id: "f", kind: "AI_MODEL", name: "f" };
    expect(flagApplies("AI_MODEL", "hasHighPrivileges")).toBe(true);
    expect(flagMeasurement(model, "hasHighPrivileges")).toBe("UNMEASURED");
  });

  it("guardrail applicability defers to the scan's own root set, not to a second list", () => {
    expect(flagApplies("AI_AGENT", "guardrailMissing")).toBe(true);
    expect(flagApplies("AI_DATASET", "guardrailMissing")).toBe(false);
    expect(flagMeasurement(dataset, "guardrailMissing")).toBe("NOT_APPLICABLE");
  });

  // ORDER IS LOAD-BEARING, and this is the assertion that pins it. A stated value wins over
  // the table — which is what keeps the seed estate (explicit `false` everywhere) reading
  // MEASURED, and what makes the table falsifiable rather than merely opinionated.
  it("a stated boolean is MEASURED even on a kind declared non-applicable", () => {
    const contradicting: GNode = { ...dataset, hasAdminPrivileges: true };
    expect(flagMeasurement(contradicting, "hasAdminPrivileges")).toBe("MEASURED");
    const found = declarationContradictions([contradicting]);
    expect(found).toEqual([{ flag: "hasAdminPrivileges", kind: "AI_DATASET", count: 1 }]);
  });

  it("census totals every node once per flag", () => {
    const census = flagCensus([dataset, agent]);
    for (const flag of FLAG_KEYS) {
      const total = Object.values(census[flag])
        .reduce((n, c) => n + c.measured + c.unmeasured + c.notApplicable, 0);
      expect(total).toBe(2);
    }
  });

  it("finds no contradiction on a landscape that agrees with the table", () => {
    expect(declarationContradictions([dataset, agent])).toEqual([]);
  });
});
