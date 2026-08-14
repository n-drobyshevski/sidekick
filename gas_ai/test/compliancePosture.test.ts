// The Compliance page's read model.
//
// Two invariants carry this whole feature, and both are the kind that fail silently:
//
//   1. A posture that does not exist is never a zero. `posture ?? 0` reads perfectly and
//      inverts the meaning of every empty cell — "nothing to assess" becomes "everything
//      failed". Half the assertions here exist to make that regression loud.
//   2. Distinctness has a SCOPE. The same policy legitimately appears under several
//      subcategories, so counting policy rows double-counts and deduping globally destroys
//      the mapping. The right answer is different per question, and each one is pinned.

import { describe, expect, it } from "vitest";

import {
  buildAllFrameworkTrees,
  buildFrameworkTree,
  complianceKpis,
  postureState,
  titleRepeatsExternalId,
} from "../src/domain/compliancePosture";
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

const agentic = normalizeCompliancePosturePage([AGENTIC_FRAMEWORK]);
const fiveRs = normalizeCompliancePosturePage([FIVE_RS_FRAMEWORK]);
const posture = [...agentic.posture, ...fiveRs.posture];
const policies = [...agentic.frameworkPolicies, ...fiveRs.frameworkPolicies];
const frameworks = normalizeFrameworksPage(FRAMEWORK_CATALOGUE).frameworks;

describe("postureState — emptiness is decided before the number", () => {
  it("a real percentage is scored", () => {
    expect(postureState(93, null)).toBe("scored");
    // Zero is a REAL score: everything assessed, everything failed. It is not emptiness.
    expect(postureState(0, null)).toBe("scored");
  });

  it("names the two kinds of emptiness apart", () => {
    expect(postureState(null, "NO_RESOURCES")).toBe("noResources");
    expect(postureState(null, "NO_POLICIES")).toBe("noPolicies");
  });

  it("a null with no reason is 'not reported', never a zero", () => {
    expect(postureState(null, null)).toBe("unknown");
  });

  it("trusts the reason over a contradictory number", () => {
    // A row carrying both is contradictory; declining to state a score Wiz disowned is the
    // conservative read of the two.
    expect(postureState(88, "NO_RESOURCES")).toBe("noResources");
  });

  it("an unrecognised reason is still not a score", () => {
    expect(postureState(null, "SOMETHING_NEW")).toBe("unknown");
  });
});

describe("buildFrameworkTree", () => {
  const tree = buildFrameworkTree("wf-id-275", posture, policies, frameworks)!;

  it("rebuilds the hierarchy from the flat rows", () => {
    expect(tree.name).toBe("OWASP Top 10 For Agentic Applications 2026");
    expect(tree.posturePct).toBe(97);
    expect(tree.categories).toHaveLength(4);
    expect(tree.categories.map((c) => c.externalId)).toEqual(["ASI01", "ASI02", "ASI08", "ASI10"]);
    expect(tree.categories.every((c) => c.subcategories.length === 1)).toBe(true);
  });

  it("holds ONE framework's rows, not the other's", () => {
    expect(tree.categories.some((c) => c.externalId === "1")).toBe(false);
    expect(
      tree.categories.every((c) => c.subcategories.every((s) => s.frameworkId === "wf-id-275")),
    ).toBe(true);
  });

  it("counts subcategories by state — the header strip", () => {
    expect(tree.stateCounts.scored).toBe(3);
    expect(tree.stateCounts.noResources).toBe(1);
    expect(tree.stateCounts.noPolicies).toBe(0);
    expect(tree.stateCounts.unknown).toBe(0);
  });

  it("counts DISTINCT policies across the framework, not policy rows", () => {
    // 5 rows in this framework, but the shared control appears in three of them. Reporting
    // 5 would say the framework covers five things when it covers three.
    expect(tree.policyCount).toBe(3);
    expect(tree.failingPolicyCount).toBe(1);
  });

  it("keeps the same policy under EVERY subcategory it maps to", () => {
    // The opposite scope from the count above, and both are right: the register has to
    // show the control under each subcategory it governs.
    const withShared = tree.categories
      .flatMap((c) => c.subcategories)
      .filter((s) => s.policies.some((p) => p.policyId === SHARED_CONTROL_ID));
    expect(withShared.map((s) => s.externalId).sort()).toEqual(["ASI01", "ASI02", "ASI10"]);
  });

  it("orders a subcategory's policies worst severity first", () => {
    const asi01 = tree.categories.find((c) => c.externalId === "ASI01")!.subcategories[0];
    const ranks = asi01.policies.map((p) => p.severity);
    expect(ranks[0]).toBe("MEDIUM");
    expect(asi01.policies).toHaveLength(3);
  });

  it("carries the empty reason all the way to the leaf", () => {
    const asi08 = tree.categories.find((c) => c.externalId === "ASI08")!;
    expect(asi08.state).toBe("noResources");
    expect(asi08.posturePct).toBeNull();
    expect(asi08.subcategories[0].state).toBe("noResources");
  });

  it("returns null for a framework with no stored posture", () => {
    expect(buildFrameworkTree("wf-id-999", posture, policies, frameworks)).toBeNull();
  });
});

describe("buildAllFrameworkTrees", () => {
  const trees = buildAllFrameworkTrees(posture, policies, frameworks);

  it("returns one tree per framework with posture", () => {
    expect(trees.map((t) => t.frameworkId).sort()).toEqual(["wf-id-214", "wf-id-275"]);
  });

  it("sorts worst-scored first, because the page's job is to say what needs attention", () => {
    expect(trees[0].frameworkId).toBe("wf-id-214"); // 75 before 97
  });

  it("sorts an UNSCORED framework last rather than as a zero", () => {
    const unscored = [
      ...posture,
      {
        frameworkId: "wf-id-000", level: "framework" as const, title: "Never assessed",
        posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
      },
    ];
    const sorted = buildAllFrameworkTrees(unscored, policies, frameworks);
    // Not first: a framework nobody scored is not the worst-performing one.
    expect(sorted[sorted.length - 1].frameworkId).toBe("wf-id-000");
  });
});

describe("complianceKpis", () => {
  it("averages only the frameworks that actually scored, and says how many that was", () => {
    const kpis = complianceKpis(posture, policies);
    expect(kpis.frameworks).toBe(2);
    expect(kpis.scoredFrameworks).toBe(2);
    expect(kpis.averagePosture).toBe(86); // (97 + 75) / 2
  });

  it("excludes an unscored framework from the mean instead of counting it as zero", () => {
    const withEmpty = [
      ...posture,
      {
        frameworkId: "wf-id-000", level: "framework" as const, title: "Never assessed",
        posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
      },
    ];
    const kpis = complianceKpis(withEmpty, policies);
    expect(kpis.frameworks).toBe(3);
    expect(kpis.scoredFrameworks).toBe(2);
    // Still 86. Counting the empty one as 0 would give 57 and describe an estate that
    // does not exist.
    expect(kpis.averagePosture).toBe(86);
  });

  it("returns a null average — never 0 — when nothing scored at all", () => {
    const kpis = complianceKpis([
      {
        frameworkId: "wf-id-000", level: "framework" as const, title: "Never assessed",
        posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
      },
    ], []);
    expect(kpis.averagePosture).toBeNull();
    expect(kpis.scoredFrameworks).toBe(0);
  });

  it("counts distinct failing policies across frameworks, not failing rows", () => {
    const kpis = complianceKpis(posture, policies);
    // AIService-003 fails and is mapped under three subcategories across two frameworks.
    // It is one thing to fix.
    expect(kpis.failingPolicies).toBe(1);
    // ASI01, ASI02, ASI10. ASI08 has nothing to assess and 5Rs 2.1 passes clean, so
    // neither is a failure — the count is of subcategories with a failing check, not of
    // subcategories that are not perfect.
    expect(kpis.failingSubcategories).toBe(3);
  });

  it("is safe on an estate with no posture at all", () => {
    expect(complianceKpis([], [])).toEqual({
      frameworks: 0,
      scoredFrameworks: 0,
      averagePosture: null,
      failingSubcategories: 0,
      failingPolicies: 0,
    });
  });
});

describe("mirrorsCategory — the one-level frameworks", () => {
  it("is true for an OWASP category whose only subcategory restates it", () => {
    const tree = buildFrameworkTree("wf-id-275", posture, policies, frameworks)!;
    // Every ASI category holds exactly one subcategory carrying the category's own id.
    expect(tree.categories.every((c) => c.mirrorsCategory)).toBe(true);
  });

  it("is false for a 5Rs category with genuinely distinct numbered subcategories", () => {
    const tree = buildFrameworkTree("wf-id-214", posture, policies, frameworks)!;
    // Reduce (1) → 1.1, Restrict (2) → 2.1: the child is a different thing from the parent.
    expect(tree.categories.every((c) => c.mirrorsCategory)).toBe(false);
    expect(tree.categories.find((c) => c.externalId === "2")!.mirrorsCategory).toBe(false);
  });

  it("is false when a category has more than one subcategory, id match or not", () => {
    const extra = [
      ...posture,
      {
        frameworkId: "wf-id-275", level: "subcategory" as const,
        categoryExternalId: "ASI01", subcategoryExternalId: "ASI01-b",
        title: "A second child", posturePct: 50,
        passCount: 1, failCount: 1, emptyPostureReason: null,
      },
    ];
    const tree = buildFrameworkTree("wf-id-275", extra, policies, frameworks)!;
    expect(tree.categories.find((c) => c.externalId === "ASI01")!.mirrorsCategory).toBe(false);
  });

  it("is false for a category with no subcategories at all — nothing to collapse into", () => {
    const orphan = [
      {
        frameworkId: "wf-id-777", level: "framework" as const, title: "Orphan",
        posturePct: 10, passCount: 0, failCount: 0, emptyPostureReason: null,
      },
      {
        frameworkId: "wf-id-777", level: "category" as const, categoryExternalId: "C1",
        title: "Childless", posturePct: 10, passCount: 1, failCount: 9,
        emptyPostureReason: null,
      },
    ];
    const tree = buildFrameworkTree("wf-id-777", orphan, [], [])!;
    expect(tree.categories[0].mirrorsCategory).toBe(false);
  });
});

describe("titleRepeatsExternalId — the duplicated number", () => {
  it("is true when the title opens with its own id, as OWASP LLM names do", () => {
    expect(titleRepeatsExternalId("1", "1 LLM01:2025 Prompt Injection")).toBe(true);
    expect(titleRepeatsExternalId("1.1", "1.1  Prompt Injection")).toBe(true);
    expect(titleRepeatsExternalId("ASI01", "ASI01 Agent Goal Hijack")).toBe(true);
  });

  it("is false when the title is a bare name, as the 5Rs are", () => {
    expect(titleRepeatsExternalId("2", "Restrict")).toBe(false);
    expect(titleRepeatsExternalId("2.1", "Public data exposure")).toBe(false);
  });

  it("only matches a WHOLE token — a prefix that is not the id does not count", () => {
    // "1" must not suppress the chip on "1.1 …", or the row loses its only number.
    expect(titleRepeatsExternalId("1", "1.1 Prompt Injection")).toBe(false);
    expect(titleRepeatsExternalId("ASI1", "ASI10 Rogue Agents")).toBe(false);
  });

  it("is false for empty input rather than throwing", () => {
    expect(titleRepeatsExternalId("", "Anything")).toBe(false);
    expect(titleRepeatsExternalId("1", "")).toBe(false);
  });

  it("drives showExternalId on every node of the tree", () => {
    const asi = buildFrameworkTree("wf-id-275", posture, policies, frameworks)!;
    // ASI titles repeat their id, so the chip is suppressed.
    expect(asi.categories.every((c) => c.showExternalId === false)).toBe(true);
    const fiveRsTree = buildFrameworkTree("wf-id-214", posture, policies, frameworks)!;
    // 5Rs titles are bare names, so the chip carries the only number on the row.
    expect(fiveRsTree.categories.every((c) => c.showExternalId === true)).toBe(true);
  });
});
