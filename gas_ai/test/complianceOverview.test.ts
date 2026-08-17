// The Compliance Overview page's cross-framework rollups.
//
// Three invariants carry this file, layered on top of the two compliancePosture.test.ts
// already pins:
//
//   1. A posture that does not exist is never a zero, EVEN AFTER IT HAS BEEN ROLLED UP.
//      An unscored framework must not slide to the top of a "worst first" rail, an
//      unscored subcategory must not slide into the middle of a "weakest first" list by
//      comparing as 0, and neither may be silently dropped either — it is a finding about
//      the programme, just not a rankable one.
//   2. `frameworkRail` and `weakestAreas` never re-sort what compliancePosture.ts already
//      decided. Only `sort` itself belongs to this file — a policy's SEVERITY / worst-face
//      metadata across every framework it is mapped into does not.
//   3. `sharedControls` dedupes at landscape scope (distinct policyId across every
//      framework), which is a WIDER scope than buildFrameworkTree's within-one-framework
//      dedupe. failCount is the MAX across a control's mapping rows, never the sum — one
//      control is evaluated once, and its counts are simply repeated on every
//      (framework, subcategory) row it maps to. The reconciliation test at the bottom
//      (sharedControls().length === complianceKpis().failingPolicies) is what catches the
//      two dedupes drifting apart if either one is ever rewritten.

import { describe, expect, it } from "vitest";

import { buildAllFrameworkTrees, complianceKpis } from "../src/domain/compliancePosture";
import {
  coverageSummary, frameworkRail, sharedControls, weakestAreas,
} from "../src/domain/complianceOverview";
import type { FrameworkRow } from "../src/domain/graphTypes";
import {
  normalizeCompliancePosturePage,
  normalizeFrameworksPage,
} from "../src/domain/syncNormalize";
import {
  AGENTIC_FRAMEWORK, FIVE_RS_FRAMEWORK, FRAMEWORK_CATALOGUE, SHARED_CONTROL_ID,
} from "./frameworkPosture.fixture";

// Set up exactly like compliancePosture.test.ts:31-35: both fixture frameworks,
// normalized and concatenated, then rebuilt into the trees this whole file projects.
const agentic = normalizeCompliancePosturePage([AGENTIC_FRAMEWORK]);
const fiveRs = normalizeCompliancePosturePage([FIVE_RS_FRAMEWORK]);
const posture = [...agentic.posture, ...fiveRs.posture];
const policies = [...agentic.frameworkPolicies, ...fiveRs.frameworkPolicies];
const frameworks = normalizeFrameworksPage(FRAMEWORK_CATALOGUE).frameworks;
const trees = buildAllFrameworkTrees(posture, policies, frameworks);

describe("frameworkRail — the rail never re-sorts, and unscored is never a zero", () => {
  it("keeps an unscored framework's posturePct null and its reason, not.toBe(0)", () => {
    // Same synthetic row compliancePosture.test.ts uses for the identical purpose
    // (buildAllFrameworkTrees, "sorts an UNSCORED framework last").
    const withUnscored = [
      ...posture,
      {
        frameworkId: "wf-id-000", level: "framework" as const, title: "Never assessed",
        posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
      },
    ];
    const treesWithUnscored = buildAllFrameworkTrees(withUnscored, policies, frameworks);
    const rail = frameworkRail(treesWithUnscored);
    const row = rail.find((r) => r.frameworkId === "wf-id-000")!;

    expect(row.posturePct).toBeNull();
    // Loud on purpose: `posture ?? 0` would pass a bare `.toBe(0)` check by accident if
    // the reader forgot why this assertion is here at all.
    expect(row.posturePct).not.toBe(0);
    expect(row.emptyPostureReason).toBe("NO_RESOURCES");
    expect(row.state).toBe("noResources");
  });

  it("orders rows EXACTLY as buildAllFrameworkTrees ordered the trees — worst first, unscored last", () => {
    const withUnscored = [
      ...posture,
      {
        frameworkId: "wf-id-000", level: "framework" as const, title: "Never assessed",
        posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
      },
    ];
    const treesWithUnscored = buildAllFrameworkTrees(withUnscored, policies, frameworks);
    const rail = frameworkRail(treesWithUnscored);

    expect(rail.map((r) => r.frameworkId)).toEqual(treesWithUnscored.map((t) => t.frameworkId));
    // 75 (5Rs) worse than 97 (Agentic); the never-assessed framework is unknown, not
    // "worse than both", so it lands last rather than first.
    expect(rail.map((r) => r.frameworkId)).toEqual(["wf-id-214", "wf-id-275", "wf-id-000"]);
  });

  it("projects the counts a FrameworkTree already carries, without recomputing them", () => {
    const rail = frameworkRail(trees);
    const agenticRow = rail.find((r) => r.frameworkId === "wf-id-275")!;
    // THREE categories listed — ASI08's only subcategory is NO_RESOURCES, so the tree drops
    // it (compliancePosture.ts). categoryCount follows the list, because that is what the
    // rail's own row expands into.
    expect(agenticRow.categoryCount).toBe(3); // ASI01, ASI02, ASI10
    // subcategoryCount does NOT follow the list: it comes off stateCounts, so the rail
    // still reports the framework's size rather than the part of it that scored. Four
    // subcategories, one per ASI category in the capture, three of them scored.
    expect(agenticRow.subcategoryCount).toBe(4);
    expect(agenticRow.stateCounts.scored).toBe(3);
    // Distinct policies, not policy rows — and not the one that evaluated nothing.
    expect(agenticRow.policyCount).toBe(2);
  });

  it("carries worstFailingSeverity through unchanged, for every row — a projection, not a rollup", () => {
    const rail = frameworkRail(trees);
    // Every row present, and every one of them equal to the SAME tree's own field — not
    // recomputed here, not defaulted, not dropped for the unscored case.
    expect(rail).toHaveLength(trees.length);
    for (const tree of trees) {
      const row = rail.find((r) => r.frameworkId === tree.frameworkId)!;
      expect(row.worstFailingSeverity).toBe(tree.worstFailingSeverity);
    }
    // Both fixture frameworks' only failing control is MEDIUM — pinned concretely too, so
    // a projection that silently coerced the field (e.g. to null or "UNKNOWN") still fails
    // this test even if the loop above were somehow satisfied by accident.
    expect(rail.find((r) => r.frameworkId === "wf-id-275")!.worstFailingSeverity).toBe("MEDIUM");
    expect(rail.find((r) => r.frameworkId === "wf-id-214")!.worstFailingSeverity).toBe("MEDIUM");
  });

  it("carries a null worstFailingSeverity through unchanged for an unscored framework", () => {
    const withUnscored = [
      ...posture,
      {
        frameworkId: "wf-id-000", level: "framework" as const, title: "Never assessed",
        posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
      },
    ];
    const treesWithUnscored = buildAllFrameworkTrees(withUnscored, policies, frameworks);
    const rail = frameworkRail(treesWithUnscored);
    const row = rail.find((r) => r.frameworkId === "wf-id-000")!;
    expect(row.worstFailingSeverity).toBeNull();
  });
});

describe("weakestAreas — scored ascending, and nothing that cannot be ranked", () => {
  it("sorts every scored subcategory ascending by posturePct", () => {
    const weak = weakestAreas(trees);
    const scored = weak.filter((w) => w.state === "scored");
    // ASI02 86, ASI01 93, ASI10 99, 5Rs 2.1 100 — the two subcategories with no posture
    // (ASI08 NO_RESOURCES, 5Rs 1.1 NO_POLICIES) are not in this list at all.
    expect(scored.map((w) => w.externalId)).toEqual(["ASI02", "ASI01", "ASI10", "2.1"]);
    expect(scored.map((w) => w.posturePct)).toEqual([86, 93, 99, 100]);
  });

  it("carries each subcategory's postureBand through the flattening", () => {
    // postureCell() tints this row and the register's row from the same field. If the
    // flattening dropped it, one subcategory would be tinted in the per-framework table
    // and plain in the landscape-wide one — the same fact, drawn two ways.
    const weak = weakestAreas(trees);
    for (const row of weak) {
      const tree = trees.find((t) => t.frameworkId === row.frameworkId)!;
      const sub = tree.categories
        .flatMap((c) => c.subcategories)
        .find((s) => s.externalId === row.externalId)!;
      expect(row.postureBand).toBe(sub.postureBand);
    }
    // Concretely, and on the row that makes the encoding's point. 5Rs 2.1 scores 100% while
    // the cloud rule mapped to it reports ten failures — the case that used to paint a full
    // bar in a MEDIUM wash. The band reads the number, so it is `strong`, and the failing
    // rule is reported by the Failing policies column beside it instead.
    expect(weak.find((w) => w.externalId === "ASI01")!.postureBand).toBe("strong");
    const publicExposure = weak.find((w) => w.externalId === "2.1")!;
    expect(publicExposure.posturePct).toBe(100);
    expect(publicExposure.postureBand).toBe("strong");
    expect(publicExposure.failingPolicyCount).toBeGreaterThan(0);
  });

  it("contains no row it cannot rank — every one carries a number", () => {
    // This band used to list the unscored rows unranked at the bottom. They no longer
    // reach it: the trees carry only scored subcategories, and weakestAreas drops anything
    // else rather than appending a row with no number to a list titled "weakest". Where
    // those subcategories ARE still reported is the header's state strip, which counts
    // every one Wiz sent — see compliancePosture's stateCounts.
    const weak = weakestAreas(trees);
    expect(weak.every((w) => w.state === "scored")).toBe(true);
    expect(weak.every((w) => w.posturePct !== null)).toBe(true);
    expect(weak).toHaveLength(4);
  });

  it("limit caps the row count and keeps the same relative order", () => {
    const all = weakestAreas(trees);
    const top2 = weakestAreas(trees, 2);
    expect(top2).toHaveLength(2);
    expect(top2).toEqual(all.slice(0, 2));

    // A limit past the end returns everything; a limit of 0 returns nothing, not an
    // error and not "all of them" by some off-by-one.
    expect(weakestAreas(trees, 100)).toEqual(all);
    expect(weakestAreas(trees, 0)).toEqual([]);
  });
});

describe("sharedControls — landscape-wide dedupe, failCount is MAX not sum", () => {
  // The only policy in this fixture that is BOTH cross-framework AND actually failing is
  // the cloud rule AIService-003 (`failingCloudRule` in the fixture): it is mapped under
  // ASI01 and ASI10 in the Agentic framework and under 5Rs' "2.1", each row reporting
  // failCount 10. SHARED_CONTROL_ID (the CONTROL f6f5494d…) is genuinely shared too — ASI01,
  // ASI02, ASI10 — but every one of those mapping rows has a null (zero) failCount, so it
  // has nothing to fix and no leverage to report; it must NOT appear here.
  const shared = sharedControls(trees);

  it("yields exactly one row, for the control that is both shared AND failing", () => {
    expect(shared).toHaveLength(1);
    expect(shared[0].shortId).toBe("AIService-003");
  });

  it("counts DISTINCT frameworks and DISTINCT (framework, subcategory) pairs, not mapping rows", () => {
    const row = shared[0];
    // In the order the frameworks appear in `trees`: 5Rs (75%) sorts worse than Agentic
    // (97%), so wf-id-214 is visited first.
    expect(row.frameworkIds).toEqual(["wf-id-214", "wf-id-275"]);
    expect(row.frameworkNames).toEqual([
      "5Rs - Wiz for Data Security",
      "OWASP Top 10 For Agentic Applications 2026",
    ]);
    expect(row.frameworkCount).toBe(2);
    // ASI01, ASI10 (Agentic) + "2.1" (5Rs) — three mapping rows, three distinct pairs.
    expect(row.subcategoryCount).toBe(3);
  });

  it("reports failCount as the MAX across the three mapping rows, not their sum", () => {
    // Every mapping row for this control independently reports failCount 10 (it is the
    // SAME evaluation, repeated). Summing would read 30 — "fix it three times" — for a
    // control that needs fixing exactly once.
    expect(shared[0].failCount).toBe(10);
    expect(shared[0].failCount).not.toBe(30);
  });

  it("excludes every policy whose failCount is 0, shared or not", () => {
    // SHARED_CONTROL_ID: genuinely shared across three subcategories, but every mapping
    // row has failCount null → 0. Nothing to fix, so it is not a "shared control" here.
    expect(shared.some((r) => r.policyId === SHARED_CONTROL_ID)).toBe(false);
    // AIAgent-002: an unassessed cloud rule (noResourceToAssess), also failCount 0.
    expect(shared.some((r) => r.shortId === "AIAgent-002")).toBe(false);
  });

  it("agrees with complianceKpis().failingPolicies — the two dedupes must not drift", () => {
    const kpis = complianceKpis(posture, policies);
    expect(kpis.failingPolicies).toBe(1);
    expect(shared.length).toBe(kpis.failingPolicies);
  });

  it("takes severity/name/kind from the row with the worst severity when it is inconsistent", () => {
    // Both this control's fixture appearances describe it identically (MEDIUM,
    // "Vertex AI Chat Agent App should be configured with security settings", CLOUD_RULE),
    // so the worst-face rule has nothing to override — pinning it anyway documents which
    // fields the row is expected to carry.
    const row = shared[0];
    expect(row.severity).toBe("MEDIUM");
    expect(row.policyKind).toBe("CLOUD_RULE");
    expect(row.name).toBe("Vertex AI Chat Agent App should be configured with security settings");
  });
});

describe("coverageSummary — what the landscape is and is not measuring", () => {
  it("counts a catalogue entry with no tree as catalogued but not collected", () => {
    const extendedCatalogue: FrameworkRow[] = [
      ...frameworks,
      {
        id: "wf-id-999", name: "PCI DSS v4.0", builtin: false, enabled: true,
        policyTypes: [], selected: true,
      },
    ];
    const coverage = coverageSummary(trees, extendedCatalogue);

    // PCI DSS is `selected` yet has no tree, so it counts toward `catalogued` and not
    // toward `collected`. The gap between the two numbers IS the report — this used to
    // name the missing frameworks as well, until a real tenant turned that into a
    // thirty-seven-item transcription of its own catalogue.
    expect(coverage.collected).toBe(2); // trees: wf-id-275, wf-id-214
    expect(coverage.catalogued).toBe(3); // catalogue: those two plus PCI DSS
    expect(coverage.scoredFrameworks).toBe(2); // both collected frameworks scored (97, 75)

    const summed = Object.values(coverage.stateCounts).reduce((a, b) => a + b, 0);
    expect(summed).toBe(coverage.subcategoryCount);
    // ASI01, ASI02, ASI08, ASI10, 5Rs 1.1, 5Rs 2.1.
    expect(coverage.subcategoryCount).toBe(6);
    expect(coverage.stateCounts).toEqual({
      scored: 4, noResources: 1, noPolicies: 1, unknown: 0,
    });
  });

  it("counts a framework by its TREE, not by whether it was selected", () => {
    // Every catalogue entry here has a tree, so nothing is missing however the selection
    // reads — what was asked for and what has landed are different questions.
    const coverage = coverageSummary(trees, frameworks);
    expect(coverage.collected).toBe(coverage.catalogued);
  });

  it("is safe on an empty landscape — nothing collected, nothing to sum a division by zero into", () => {
    const coverage = coverageSummary([], []);
    expect(coverage).toEqual({
      collected: 0,
      catalogued: 0,
      scoredFrameworks: 0,
      stateCounts: {
        scored: 0, noResources: 0, noPolicies: 0, unknown: 0,
      },
      subcategoryCount: 0,
    });
  });
});
