// The 5Rs derived posture — a different question from Wiz's own, answered over the ACTIVE
// policies only.
//
// Four invariants carry this file:
//
//   1. "Active" is `selected AND enabled !== false` — `enabled: undefined` is active
//      (Wiz declining to state the flag is not evidence the rule is off), only an explicit
//      `false` excludes.
//   2. NULL, NEVER 0 — no active policy, or active policies with zero evaluations, is an
//      absent posture, not a failing one. Same for controlPassPct with no active policy.
//      Conversely, a REAL zero (every active policy failing) must survive as 0, not collapse
//      to null.
//   3. The rounding clamp never lets a rounded 100 or 0 misstate a non-empty "other side":
//      100 with any failure clamps to 99, 0 with any pass clamps to 1.
//   4. `fiveRsDerivedPosture` returns null, not an empty object, when there is no 5Rs
//      framework at all (`frameworkId === null`) — the same contract `scopeFiveRs` keeps.

import { describe, expect, it } from "vitest";

import { postureBandOf } from "../src/domain/compliancePosture";
import type { FiveRsScope, PolicyScope } from "../src/domain/complianceScope";
import { fiveRsDerivedPosture, isActiveFiveRsPolicy } from "../src/domain/fiveRsPosture";

function policyScope(
  overrides: Partial<PolicyScope> & Pick<PolicyScope, "policyId">,
): PolicyScope {
  return {
    shortId: undefined,
    name: "Test rule",
    policyKind: "CLOUD_RULE",
    severity: "MEDIUM",
    categoryExternalId: "2",
    subcategoryExternalId: "2.1",
    subcategoryTitle: "Test subcategory",
    selected: true,
    reason: "crossMapped",
    mappedBy: [],
    aiFindingCount: 0,
    failCount: 0,
    passCount: 0,
    enabled: undefined,
    ...overrides,
  };
}

function fiveRsScope(
  policies: PolicyScope[],
  frameworkId: string | null = "wf-id-214",
): FiveRsScope {
  return {
    frameworkId,
    frameworkName: "5Rs - Wiz for Data Security",
    policies,
    selected: policies.filter((p) => p.selected).length,
    total: policies.length,
  };
}

describe("isActiveFiveRsPolicy", () => {
  it("is active when selected and enabled is undefined (tri-state, not stated)", () => {
    expect(isActiveFiveRsPolicy(policyScope({ policyId: "p1", selected: true, enabled: undefined })))
      .toBe(true);
  });

  it("is active when selected and enabled is explicitly true", () => {
    expect(isActiveFiveRsPolicy(policyScope({ policyId: "p1", selected: true, enabled: true })))
      .toBe(true);
  });

  it("is NOT active when enabled is explicitly false, even if selected", () => {
    expect(isActiveFiveRsPolicy(policyScope({ policyId: "p1", selected: true, enabled: false })))
      .toBe(false);
  });

  it("is not active when not selected, regardless of enabled", () => {
    expect(isActiveFiveRsPolicy(policyScope({ policyId: "p1", selected: false, enabled: true })))
      .toBe(false);
  });
});

describe("fiveRsDerivedPosture — no 5Rs framework at all", () => {
  it("returns null, not an empty object", () => {
    expect(fiveRsDerivedPosture(fiveRsScope([], null), 85)).toBeNull();
  });
});

describe("fiveRsDerivedPosture — activePolicyCount and disabledPolicyCount", () => {
  it("counts an enabled:undefined policy as active, not disabled", () => {
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: true, enabled: undefined, passCount: 5, failCount: 0 }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.activePolicyCount).toBe(1);
    expect(posture.disabledPolicyCount).toBe(0);
  });

  it("excludes an enabled:false policy from active and counts it disabled", () => {
    const scope = fiveRsScope([
      policyScope({
        policyId: "p1", selected: true, enabled: false, passCount: 5, failCount: 0,
      }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.activePolicyCount).toBe(0);
    expect(posture.disabledPolicyCount).toBe(1);
  });

  it("does not count an out-of-scope (unselected) policy as disabled", () => {
    // disabledPolicyCount names rules IN scope but excluded — a rule never in scope to begin
    // with was never dropped from anything this feature scopes.
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: false, enabled: false }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.activePolicyCount).toBe(0);
    expect(posture.disabledPolicyCount).toBe(0);
  });
});

describe("fiveRsDerivedPosture — null, never 0", () => {
  it("posturePct and controlPassPct are both null when no policy is active", () => {
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: false }),
      policyScope({ policyId: "p2", selected: true, enabled: false }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.posturePct).toBeNull();
    expect(posture.controlPassPct).toBeNull();
    expect(posture.postureBand).toBeNull();
  });

  it("posturePct is null (not 0) when active policies have zero evaluations", () => {
    const scope = fiveRsScope([
      policyScope({
        policyId: "p1", selected: true, enabled: true, passCount: 0, failCount: 0,
      }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.posturePct).toBeNull();
    expect(posture.postureBand).toBeNull();
    // controlPassPct has an active-policy denominator regardless of evaluation counts, and a
    // policy with zero failures is, by that field's own definition, "clean".
    expect(posture.controlPassPct).toBe(100);
  });
});

describe("fiveRsDerivedPosture — controlPassPct real zero vs null", () => {
  it("is a real 0 when every active policy is failing something", () => {
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: true, passCount: 10, failCount: 1 }),
      policyScope({ policyId: "p2", selected: true, passCount: 20, failCount: 2 }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.controlPassPct).toBe(0);
    expect(posture.cleanPolicyCount).toBe(0);
    expect(posture.failingPolicyCount).toBe(2);
    expect(posture.activePolicyCount).toBe(2);
  });

  it("is null only when no policy is active, never merely because none are clean", () => {
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: false, passCount: 10, failCount: 1 }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.controlPassPct).toBeNull();
    expect(posture.activePolicyCount).toBe(0);
  });
});

describe("fiveRsDerivedPosture — rounding clamps", () => {
  it("clamps a rounded 100 to 99 while failCount is non-zero", () => {
    // 999 / 1000 rounds to 100.
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: true, passCount: 999, failCount: 1 }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.posturePct).toBe(99);
  });

  it("clamps a rounded 0 to 1 while passCount is non-zero", () => {
    // 1 / 1000 rounds to 0.
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: true, passCount: 1, failCount: 999 }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.posturePct).toBe(1);
  });

  it("clamps controlPassPct the same way: a rounded 100 with a failing policy present", () => {
    // 99 clean of 100 active rounds to 99, not 100 — this case pins the OTHER direction: a
    // count that legitimately rounds to 99 must not be pushed to 100 by the clamp either.
    const policies: PolicyScope[] = [];
    for (let i = 0; i < 99; i += 1) {
      policies.push(policyScope({ policyId: `clean-${i}`, selected: true, passCount: 1, failCount: 0 }));
    }
    policies.push(policyScope({ policyId: "dirty", selected: true, passCount: 1, failCount: 1 }));
    const posture = fiveRsDerivedPosture(fiveRsScope(policies), 85)!;
    expect(posture.controlPassPct).toBe(99);
    expect(posture.failingPolicyCount).toBe(1);
  });
});

describe("fiveRsDerivedPosture — postureBand", () => {
  it("agrees with postureBandOf(posturePct) for a scored posture", () => {
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: true, passCount: 95, failCount: 5 }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.postureBand).toBe(postureBandOf(posture.posturePct));
    expect(posture.postureBand).toBe("strong");
  });

  it("is null when posturePct is null", () => {
    const scope = fiveRsScope([policyScope({ policyId: "p1", selected: false })]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.posturePct).toBeNull();
    expect(posture.postureBand).toBeNull();
  });
});

describe("fiveRsDerivedPosture — wizPosturePct travels through unchanged", () => {
  it("carries whatever wizPosturePct the caller passes, scored or null", () => {
    const scope = fiveRsScope([
      policyScope({ policyId: "p1", selected: true, passCount: 10, failCount: 0 }),
    ]);
    expect(fiveRsDerivedPosture(scope, 85)!.wizPosturePct).toBe(85);
    expect(fiveRsDerivedPosture(scope, null)!.wizPosturePct).toBeNull();
  });
});

describe("fiveRsDerivedPosture — the seed tenant", () => {
  // wf-id-214, default pins: IAM-236 (1718/18, cross-mapped via ASI03), SUB-047 (30/1),
  // SUB-082 (21/2, cross-mapped via ASI01/ASI10) are in scope; DATA-311, DATA-318, DATA-402,
  // DATA-514 are out. All seeded enabled:true, so 3 active of 7, 0 disabled — see
  // sampleData.ts's SEED_FRAMEWORK_POLICIES and the "three orders of magnitude" note there.
  it("matches the expected seed figures", () => {
    const scope = fiveRsScope([
      policyScope({
        policyId: "pol-IAM-236", shortId: "IAM-236", selected: true, enabled: true,
        passCount: 1718, failCount: 18,
      }),
      policyScope({
        policyId: "pol-SUB-047", shortId: "SUB-047", selected: true, enabled: true,
        passCount: 30, failCount: 1,
      }),
      policyScope({
        policyId: "pol-SUB-082", shortId: "SUB-082", selected: true, enabled: true,
        passCount: 21, failCount: 2,
      }),
      policyScope({ policyId: "pol-DATA-311", shortId: "DATA-311", selected: false }),
      policyScope({ policyId: "pol-DATA-318", shortId: "DATA-318", selected: false }),
      policyScope({ policyId: "pol-DATA-402", shortId: "DATA-402", selected: false }),
      policyScope({ policyId: "pol-DATA-514", shortId: "DATA-514", selected: false }),
    ]);
    const posture = fiveRsDerivedPosture(scope, 85)!;
    expect(posture.passCount).toBe(1769);
    expect(posture.failCount).toBe(21);
    expect(posture.posturePct).toBe(99);
    expect(posture.postureBand).toBe("strong");
    expect(posture.controlPassPct).toBe(0);
    expect(posture.cleanPolicyCount).toBe(0);
    expect(posture.failingPolicyCount).toBe(3);
    expect(posture.activePolicyCount).toBe(3);
    expect(posture.disabledPolicyCount).toBe(0);
    expect(posture.wizPosturePct).toBe(85);
  });
});
