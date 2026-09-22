// The landscape's derived compliance posture — the Assurance hero's percentage, over the
// controls that APPLY rather than as a mean of Wiz's per-framework scores.
//
// Five invariants carry this file, and every one of them fails silently if it breaks:
//
//   1. THE POPULATION IS DISTINCT CONTROLS. One control mapped by six subcategories across
//      three frameworks is ONE control, and its counts are repeated on every mapping row —
//      so the walk dedupes by policyId across the whole landscape and takes the MAX, never
//      the sum. Summing is the regression that would inflate the denominator quietly and
//      make this figure impossible to reconcile with `complianceKpis.failingPolicies`.
//   2. NULL, NEVER 0. compliancePosture.ts's governing rule, one scope up. No applicable
//      control, or applicable controls that have evaluated nothing, is an ABSENT posture —
//      not a failing one, and not the biggest red bar on the page.
//   3. A REAL ZERO SURVIVES. `controlPassPct` of 0 over a non-empty population means every
//      applicable control is failing something, which is a true answer; collapsing it to
//      null is invariant 2 run backwards.
//   4. "APPLICABLE" EXCLUDES ONLY `enabled === false`. The flag is tri-state optional, so an
//      undefined one leaves a control in — the harder fact (real counts) outranks a missing
//      signal — and a control disabled on ANY mapping row is disabled on all of them.
//   5. BOTH CLAIMS TRAVEL TOGETHER. Wiz's mean is carried through untouched, because the
//      trend line beside the hero still draws it and the hero's own disclosure names it.

import { describe, expect, it } from "vitest";

import { buildAllFrameworkTrees, complianceKpis } from "../src/domain/compliancePosture";
import type {
  CategoryNode, FrameworkTree, SubcategoryNode,
} from "../src/domain/compliancePosture";
import type { FrameworkPolicyRow } from "../src/domain/graphTypes";
import { isApplicableControl, landscapeDerivedPosture } from "../src/domain/landscapePosture";
import {
  normalizeCompliancePosturePage,
  normalizeFrameworksPage,
} from "../src/domain/syncNormalize";
import {
  AGENTIC_FRAMEWORK,
  FIVE_RS_FRAMEWORK,
  FRAMEWORK_CATALOGUE,
  SHARED_CONTROL_ID,
} from "./frameworkPosture.fixture";

/** Wiz's own figures, as `complianceKpis` reports them — the second argument every time. */
const NO_WIZ = { averagePosture: null, scoredFrameworks: 0 };

function policy(
  overrides: Partial<FrameworkPolicyRow> & Pick<FrameworkPolicyRow, "policyId">,
): FrameworkPolicyRow {
  return {
    frameworkId: "fw-1",
    categoryExternalId: "1",
    subcategoryExternalId: "1.1",
    policyKind: "CLOUD_RULE",
    name: "Test rule",
    severity: "MEDIUM",
    passCount: 0,
    failCount: 0,
    assessedCount: 0,
    rejectedCount: 0,
    noResourceToAssess: false,
    ...overrides,
  };
}

/**
 * A tree holding one category of one subcategory holding `policies`.
 *
 * Hand-built rather than routed through `buildFrameworkTree`, because several cases below
 * are about what happens when the SAME policy appears in two frameworks with counts that
 * disagree — a shape the builder would never produce from one page of Wiz rows, and
 * precisely the shape `landscapeDerivedPosture`'s MAX reconciliation exists for. The
 * fixture-backed block at the bottom covers the real construction.
 */
function tree(frameworkId: string, policies: FrameworkPolicyRow[]): FrameworkTree {
  const sub: SubcategoryNode = {
    frameworkId,
    externalId: "1.1",
    showExternalId: true,
    title: "Test subcategory",
    posturePct: 50,
    state: "scored",
    postureBand: "weak",
    passCount: 0,
    failCount: 0,
    emptyPostureReason: null,
    worstFailingSeverity: null,
    policies,
    failingPolicyCount: policies.filter((p) => p.failCount > 0).length,
    unassessedPolicyCount: 0,
  };
  const category: CategoryNode = {
    frameworkId,
    externalId: "1",
    showExternalId: true,
    title: "Test category",
    posturePct: 50,
    state: "scored",
    postureBand: "weak",
    passCount: 0,
    failCount: 0,
    emptyPostureReason: null,
    worstFailingSeverity: null,
    subcategories: [sub],
    mirrorsCategory: false,
  };
  return {
    frameworkId,
    name: frameworkId,
    posturePct: 50,
    state: "scored",
    postureBand: "weak",
    emptyPostureReason: null,
    passSubCategoryCount: 0,
    failSubCategoryCount: 0,
    categories: [category],
    stateCounts: { scored: 1, noResources: 0, noPolicies: 0, unknown: 0 },
    policyCount: policies.length,
    failingPolicyCount: policies.filter((p) => p.failCount > 0).length,
    unassessedPolicyCount: 0,
    worstFailingSeverity: null,
  };
}

describe("isApplicableControl — only an explicit false excludes", () => {
  it("an unstated flag leaves the control in", () => {
    // `enabled` is tri-state optional (syncNormalize does `triBool(...) ?? undefined`).
    // Dropping a control carrying real counts because Wiz declined to state a flag would
    // shrink the denominator on no evidence at all.
    expect(isApplicableControl(undefined)).toBe(true);
  });

  it("an explicit true leaves it in, an explicit false takes it out", () => {
    expect(isApplicableControl(true)).toBe(true);
    expect(isApplicableControl(false)).toBe(false);
  });
});

describe("landscapeDerivedPosture — the population is distinct controls", () => {
  it("counts a control once across every framework that maps it, at its MAX counts", () => {
    // THE REGRESSION THIS PINS: summing. The same control, filed by two frameworks, with
    // the counts Wiz repeats on each mapping row. Summed it would read 18 pass / 2 fail
    // over 2 controls; deduped it is 9 / 1 over one.
    const shared = { policyId: "shared", passCount: 9, failCount: 1 };
    const result = landscapeDerivedPosture(
      [
        tree("fw-1", [policy({ ...shared, frameworkId: "fw-1" })]),
        tree("fw-2", [policy({ ...shared, frameworkId: "fw-2" })]),
      ],
      NO_WIZ,
    );

    expect(result.applicablePolicyCount).toBe(1);
    expect(result.passCount).toBe(9);
    expect(result.failCount).toBe(1);
    expect(result.posturePct).toBe(90);
    // Both frameworks still count as contributing it — the control is one, its reach is two.
    expect(result.frameworkCount).toBe(2);
  });

  it("takes the MAX when two mapping rows disagree, never the later one", () => {
    // Wiz repeats one evaluation's counts per mapping row, so a disagreement is a defect in
    // the capture rather than two facts. MAX is the reconciliation that cannot be reordered
    // into a different answer by whichever tree the caller listed first.
    const forward = landscapeDerivedPosture(
      [
        tree("fw-1", [policy({ policyId: "p", passCount: 9, failCount: 1 })]),
        tree("fw-2", [policy({ policyId: "p", passCount: 2, failCount: 0 })]),
      ],
      NO_WIZ,
    );
    const reversed = landscapeDerivedPosture(
      [
        tree("fw-2", [policy({ policyId: "p", passCount: 2, failCount: 0 })]),
        tree("fw-1", [policy({ policyId: "p", passCount: 9, failCount: 1 })]),
      ],
      NO_WIZ,
    );

    expect(forward.passCount).toBe(9);
    expect(forward.failCount).toBe(1);
    expect(reversed).toEqual(forward);
  });

  it("weights by checks, not by framework — which is what makes it not the mean", () => {
    // A tiny clean framework and a large failing one. The mean of two framework scores
    // would sit halfway; this figure follows the checks.
    const result = landscapeDerivedPosture(
      [
        tree("small", [policy({ policyId: "a", passCount: 1, failCount: 0 })]),
        tree("large", [policy({ policyId: "b", passCount: 10, failCount: 90 })]),
      ],
      { averagePosture: 55, scoredFrameworks: 2 },
    );

    expect(result.posturePct).toBe(11);
    // And the mean it is NOT is carried through beside it, untouched.
    expect(result.wizAveragePosture).toBe(55);
    expect(result.scoredFrameworks).toBe(2);
  });
});

describe("landscapeDerivedPosture — applicable excludes only what Wiz switched off", () => {
  it("drops a disabled control from the arithmetic and names it instead", () => {
    const result = landscapeDerivedPosture(
      [tree("fw-1", [
        policy({ policyId: "on", passCount: 3, failCount: 1 }),
        policy({ policyId: "off", passCount: 0, failCount: 99, enabled: false }),
      ])],
      NO_WIZ,
    );

    expect(result.applicablePolicyCount).toBe(1);
    expect(result.disabledPolicyCount).toBe(1);
    // The 99 failures of the disabled rule reach neither the numerator nor the denominator.
    expect(result.passCount).toBe(3);
    expect(result.failCount).toBe(1);
    expect(result.posturePct).toBe(75);
  });

  it("is sticky-false: disabled on any mapping row is disabled on all of them", () => {
    // The conservative direction, matching `scopeFiveRs`'s own accumulation — a control Wiz
    // has switched off somewhere is not one this landscape can claim credit for passing.
    const result = landscapeDerivedPosture(
      [
        tree("fw-1", [policy({ policyId: "p", passCount: 4, failCount: 0, enabled: true })]),
        tree("fw-2", [policy({ policyId: "p", passCount: 4, failCount: 0, enabled: false })]),
      ],
      NO_WIZ,
    );

    expect(result.applicablePolicyCount).toBe(0);
    expect(result.disabledPolicyCount).toBe(1);
    expect(result.posturePct).toBeNull();
  });

  it("counts a framework only where it contributes an APPLICABLE control", () => {
    const result = landscapeDerivedPosture(
      [
        tree("fw-1", [policy({ policyId: "a", passCount: 1, failCount: 0 })]),
        tree("fw-2", [policy({ policyId: "b", passCount: 1, failCount: 0, enabled: false })]),
      ],
      NO_WIZ,
    );

    // fw-2 is on the page and contributes nothing to the number, so the hero must not name
    // it in the denominator beside it.
    expect(result.frameworkCount).toBe(1);
  });
});

describe("landscapeDerivedPosture — a posture that does not exist is never a zero", () => {
  it("has no posture when there is no applicable control at all", () => {
    const result = landscapeDerivedPosture([], NO_WIZ);

    expect(result.posturePct).toBeNull();
    expect(result.postureBand).toBeNull();
    expect(result.controlPassPct).toBeNull();
    expect(result.applicablePolicyCount).toBe(0);
    expect(result.frameworkCount).toBe(0);
  });

  it("has no posture when the applicable controls evaluated nothing", () => {
    // Reachable: `isAssessedPolicy` admits a row on `assessedCount` or `rejectedCount`
    // alone, so a control can be listed with no pass and no fail behind it. `0%` here would
    // be the `posture ?? 0` mistake wearing the largest number on the page.
    const result = landscapeDerivedPosture(
      [tree("fw-1", [policy({ policyId: "p", assessedCount: 2 })])],
      NO_WIZ,
    );

    expect(result.posturePct).toBeNull();
    expect(result.postureBand).toBeNull();
    // The control-weighted reading still stands: the control is listed and nothing under it
    // is failing, which is a different question and one this population CAN answer.
    expect(result.applicablePolicyCount).toBe(1);
    expect(result.controlPassPct).toBe(100);
  });

  it("keeps a REAL zero for controlPassPct — every applicable control failing", () => {
    const result = landscapeDerivedPosture(
      [tree("fw-1", [
        policy({ policyId: "a", passCount: 0, failCount: 5 }),
        policy({ policyId: "b", passCount: 0, failCount: 7 }),
      ])],
      NO_WIZ,
    );

    expect(result.controlPassPct).toBe(0);
    expect(result.cleanPolicyCount).toBe(0);
    expect(result.failingPolicyCount).toBe(2);
    // And the check-weighted figure is a real zero too: nothing passed anywhere.
    expect(result.posturePct).toBe(0);
    expect(result.postureBand).toBe("weak");
  });
});

describe("landscapeDerivedPosture — the rounding never states a false extreme", () => {
  it("clamps a rounded 100 to 99 while anything is failing", () => {
    // 1996 of 1997 rounds to 100. A hero reading 100% beside a failing control is exactly
    // the implied confidence PRODUCT.md forbids.
    const result = landscapeDerivedPosture(
      [tree("fw-1", [
        policy({ policyId: "a", passCount: 1996, failCount: 0 }),
        policy({ policyId: "b", passCount: 0, failCount: 1 }),
      ])],
      NO_WIZ,
    );

    expect(result.posturePct).toBe(99);
    // The control-weighted reading is clamped by the same helper: 1 of 2 clean is 50, well
    // clear of the clamp, but the failing count is what would have triggered it.
    expect(result.controlPassPct).toBe(50);
  });

  it("clamps a rounded 0 to 1 while anything is passing", () => {
    const result = landscapeDerivedPosture(
      [tree("fw-1", [policy({ policyId: "a", passCount: 1, failCount: 1000 })])],
      NO_WIZ,
    );

    expect(result.posturePct).toBe(1);
  });

  it("clamps controlPassPct's own extremes over a large population", () => {
    const clean = Array.from({ length: 400 }, (_, i) =>
      policy({ policyId: `clean-${i}`, passCount: 1, failCount: 0 }));
    const result = landscapeDerivedPosture(
      [tree("fw-1", [...clean, policy({ policyId: "dirty", passCount: 0, failCount: 1 })])],
      NO_WIZ,
    );

    // 400 of 401 clean rounds to 100 — clamped, because one control IS failing.
    expect(result.controlPassPct).toBe(99);
    expect(result.failingPolicyCount).toBe(1);
  });
});

describe("landscapeDerivedPosture — over the seeded landscape", () => {
  const agentic = normalizeCompliancePosturePage([AGENTIC_FRAMEWORK]);
  const fiveRs = normalizeCompliancePosturePage([FIVE_RS_FRAMEWORK]);
  const posture = [...agentic.posture, ...fiveRs.posture];
  const policies = [...agentic.frameworkPolicies, ...fiveRs.frameworkPolicies];
  const frameworks = normalizeFrameworksPage(FRAMEWORK_CATALOGUE).frameworks;
  const trees = buildAllFrameworkTrees(posture, policies, frameworks);
  const kpis = complianceKpis(posture, policies);
  const result = landscapeDerivedPosture(trees, kpis);

  it("reports a posture over the controls the register lists", () => {
    expect(result.posturePct).not.toBeNull();
    expect(result.applicablePolicyCount).toBeGreaterThan(0);
    expect(result.passCount + result.failCount).toBeGreaterThan(0);
  });

  it("counts the cross-framework control once, not once per framework", () => {
    // The fixture files SHARED_CONTROL_ID under both frameworks on purpose. The distinct
    // population must therefore be smaller than the sum of the two trees' own counts.
    const summed = trees.reduce((sum, t) => sum + t.policyCount, 0);
    expect(result.applicablePolicyCount + result.disabledPolicyCount).toBeLessThan(summed);
    expect(SHARED_CONTROL_ID).toBeTruthy();
  });

  it("splits the population into clean and failing with nothing left over", () => {
    expect(result.cleanPolicyCount + result.failingPolicyCount)
      .toBe(result.applicablePolicyCount);
  });

  it("carries Wiz's mean through untouched rather than replacing it", () => {
    // THE ASSERTION THAT KEEPS BOTH CLAIMS ON THE PAGE. The trend line beside the hero draws
    // the mean, and the Wiz Scans page reports it; this figure is a different question, not
    // a correction, so the mean must survive the derivation byte for byte.
    expect(result.wizAveragePosture).toBe(kpis.averagePosture);
    expect(result.scoredFrameworks).toBe(kpis.scoredFrameworks);
  });

  it("is banded by the same breaks every other bar on the page uses", () => {
    // Banded server-side rather than in the browser, so the biggest bar on the page reads
    // the same 90/70/50 the small ones do.
    expect(["strong", "fair", "poor", "weak"]).toContain(result.postureBand);
  });
});
