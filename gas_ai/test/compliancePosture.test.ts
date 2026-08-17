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
//   3. What the tree LISTS and what it COUNTS are different sets, on purpose. Unscored
//      subcategories and never-evaluated policies are dropped from the lists and kept in
//      the counts (`stateCounts`, `unassessedPolicyCount`), because a register that
//      silently shows a subset of the estate is invariant 1 wearing a tidier face. Every
//      assertion below that pairs a shortened list with an unchanged count is pinning that.

import { describe, expect, it } from "vitest";

import {
  buildAllFrameworkTrees,
  buildFrameworkTree,
  complianceKpis,
  postureState,
  titleRepeatsExternalId,
} from "../src/domain/compliancePosture";
import type { Severity } from "../src/domain/config";
import type { FrameworkPolicyRow, PostureRow } from "../src/domain/graphTypes";
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
    // FOUR categories are in the capture; three are listed. ASI08's only subcategory is
    // NO_RESOURCES, so the subcategory goes and the category goes with it — an expander
    // over nothing is not a row. The one that left is still counted, in stateCounts.
    expect(tree.categories).toHaveLength(3);
    expect(tree.categories.map((c) => c.externalId)).toEqual(["ASI01", "ASI02", "ASI10"]);
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
    // 5 would say the framework covers five things when it covers three — and of those
    // three, AIAgent-002 evaluated nothing at all, so two are listed and the third is
    // reported as dropped rather than silently missing.
    expect(tree.policyCount).toBe(2);
    expect(tree.unassessedPolicyCount).toBe(1);
    expect(tree.failingPolicyCount).toBe(1);
  });

  it("carries the worst failing severity — here the framework's one failing control, MEDIUM", () => {
    // The only policy that actually fails in this fixture (AIService-003) is MEDIUM. The
    // shared CONTROL is MEDIUM too but never fails (failCount null → 0), so it must not be
    // ABLE to move this even though it shares the same severity here — see the synthetic
    // "worstFailingSeverity" cases below for that distinction pinned on purpose.
    expect(tree.worstFailingSeverity).toBe("MEDIUM");
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
    // Three policies map here; the capture's unassessed cloud rule is not one of the two
    // listed, and the subcategory says so rather than reading as a two-rule subcategory.
    expect(asi01.policies).toHaveLength(2);
    expect(asi01.unassessedPolicyCount).toBe(1);
  });

  it("drops the unscored category from the list and keeps it in the counts", () => {
    // ASI08 is the capture's all-empty branch: NO_RESOURCES at the category level, one
    // NO_RESOURCES subcategory under it. Nothing was evaluated there, so nothing is listed
    // — but the strip still reports it, which is the whole reason the drop is allowed.
    expect(tree.categories.find((c) => c.externalId === "ASI08")).toBeUndefined();
    expect(tree.stateCounts.noResources).toBe(1);
    expect(tree.categories.flatMap((c) => c.subcategories).every((s) => s.state === "scored"))
      .toBe(true);
  });

  it("returns null for a framework with no stored posture", () => {
    expect(buildFrameworkTree("wf-id-999", posture, policies, frameworks)).toBeNull();
  });
});

describe("what the tree lists vs. what it counts", () => {
  const frameworkId = "wf-id-listing";
  const rows: PostureRow[] = [
    {
      frameworkId, level: "framework", title: "Listing fixture",
      posturePct: 60, passCount: 6, failCount: 4, emptyPostureReason: null,
    },
    {
      frameworkId, level: "category", categoryExternalId: "C1", title: "Scored category",
      posturePct: 60, passCount: 6, failCount: 4, emptyPostureReason: null,
    },
    {
      frameworkId, level: "subcategory", categoryExternalId: "C1",
      subcategoryExternalId: "C1.1", title: "Scored subcategory",
      posturePct: 60, passCount: 6, failCount: 4, emptyPostureReason: null,
    },
    // The two emptinesses, under a category of their own so the category-drop rule is
    // exercised as well as the subcategory one.
    {
      frameworkId, level: "category", categoryExternalId: "C2", title: "Empty category",
      posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
    },
    {
      frameworkId, level: "subcategory", categoryExternalId: "C2",
      subcategoryExternalId: "C2.1", title: "Nothing written for this",
      posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_POLICIES",
    },
    {
      frameworkId, level: "subcategory", categoryExternalId: "C2",
      subcategoryExternalId: "C2.2", title: "Nothing to assess",
      posturePct: null, passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
    },
  ];

  function policy(
    policyId: string,
    over: Partial<FrameworkPolicyRow> = {},
  ): FrameworkPolicyRow {
    return {
      frameworkId,
      categoryExternalId: "C1",
      subcategoryExternalId: "C1.1",
      policyId,
      policyKind: "CONTROL",
      name: policyId,
      severity: "MEDIUM" as Severity,
      passCount: 0,
      failCount: 0,
      assessedCount: 0,
      rejectedCount: 0,
      noResourceToAssess: false,
      ...over,
    };
  }

  it("lists only the scored subcategories, and counts every one Wiz reported", () => {
    const tree = buildFrameworkTree(frameworkId, rows, [])!;
    expect(tree.categories.map((c) => c.externalId)).toEqual(["C1"]);
    expect(tree.categories[0].subcategories.map((s) => s.externalId)).toEqual(["C1.1"]);
    // One listed, three reported — SUBCATEGORIES only, which is what the strip counts. The
    // empty category itself is not a fourth entry here; it is dropped as the container of
    // the two that are. The denominator is what makes the omission honest.
    expect(tree.stateCounts).toEqual({
      scored: 1, noResources: 1, noPolicies: 1, unknown: 0,
    });
  });

  it("drops a policy Wiz evaluated against nothing, and says how many went", () => {
    const tree = buildFrameworkTree(frameworkId, rows, [
      policy("p-ran", { passCount: 4, assessedCount: 4 }),
      policy("p-never-ran", { noResourceToAssess: true }),
    ])!;
    const sub = tree.categories[0].subcategories[0];
    expect(sub.policies.map((p) => p.policyId)).toEqual(["p-ran"]);
    expect(sub.unassessedPolicyCount).toBe(1);
    expect(tree.policyCount).toBe(1);
    expect(tree.unassessedPolicyCount).toBe(1);
  });

  it("keeps a policy with a real count even when Wiz's flag says there was nothing", () => {
    // The contradictory row: `noResourceToAssess` true beside ten failures. The number is
    // the harder fact, and hiding a failing control on the strength of a flag that
    // disagrees with it is the one mistake this filter must never make.
    const tree = buildFrameworkTree(frameworkId, rows, [
      policy("p-contradictory", { failCount: 10, noResourceToAssess: true }),
    ])!;
    expect(tree.categories[0].subcategories[0].policies).toHaveLength(1);
    expect(tree.unassessedPolicyCount).toBe(0);
    expect(tree.worstFailingSeverity).toBe("MEDIUM");
  });

  it("counts a rule whose every finding was rejected as having run", () => {
    // Exempted findings are still an evaluation. Dropping the row would hide the exemption
    // rather than the rule.
    const tree = buildFrameworkTree(frameworkId, rows, [
      policy("p-all-rejected", { rejectedCount: 3 }),
    ])!;
    expect(tree.categories[0].subcategories[0].policies).toHaveLength(1);
    expect(tree.unassessedPolicyCount).toBe(0);
  });

  it("counts a policy dropped in one place and listed in another as listed, once", () => {
    // The many-to-many, at the edge: the same control maps to two subcategories and only
    // ran under one. It is a rule this framework covers — reporting it as both listed and
    // dropped would describe one control twice, in two contradictory ways.
    const withSecondScored: PostureRow[] = [
      ...rows,
      {
        frameworkId, level: "subcategory", categoryExternalId: "C1",
        subcategoryExternalId: "C1.2", title: "Second scored subcategory",
        posturePct: 90, passCount: 9, failCount: 1, emptyPostureReason: null,
      },
    ];
    const tree = buildFrameworkTree(frameworkId, withSecondScored, [
      policy("p-shared", { passCount: 4, assessedCount: 4 }),
      policy("p-shared", { subcategoryExternalId: "C1.2", noResourceToAssess: true }),
    ])!;
    expect(tree.policyCount).toBe(1);
    expect(tree.unassessedPolicyCount).toBe(0);
    // Still absent from the subcategory it did not run under: this is a fact about the
    // framework's coverage, not a licence to re-list the row where it evaluated nothing.
    const c12 = tree.categories[0].subcategories.find((s) => s.externalId === "C1.2")!;
    expect(c12.policies).toHaveLength(0);
    expect(c12.unassessedPolicyCount).toBe(1);
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

  it("never has to answer for a childless category — one cannot reach the tree", () => {
    // This used to assert `mirrorsCategory === false` on a category with no subcategories.
    // A childless category no longer survives the build at all, which is the stronger
    // guarantee: the register's mirrored-category branch reads `subcategories[0]`
    // unguarded, and this is what makes that safe.
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
    expect(tree.categories).toHaveLength(0);
    // The framework itself still exists and still scores — a tree with nothing to list is
    // not a tree that failed to build, and the rail must still be able to draw its 10%.
    expect(tree.posturePct).toBe(10);
  });
});

describe("worstFailingSeverity — what colours the posture bar", () => {
  // A minimal single-framework fixture, built by hand rather than through the fixture file
  // — none of the three cases below (a naive first-wins bug, a severe-but-passing policy,
  // an all-clean framework) exist in frameworkPosture.fixture.ts, and the file is not to be
  // edited.
  //
  // ALL THREE LEVELS are spelled out, and that is not boilerplate. The walk used to iterate
  // the `policies` argument directly, so a framework row alone was enough; it now rolls up
  // off the built nodes instead, because the header has to count what the register lists.
  // A policy mapped to a subcategory that is not in the tree contributes to neither — which
  // is the point, and which this fixture has to satisfy to test anything at all.
  const frameworkId = "wf-id-worst";
  const framework: PostureRow[] = [
    {
      frameworkId, level: "framework", title: "Worst-severity fixture",
      posturePct: 80, passCount: 8, failCount: 2, emptyPostureReason: null,
    },
    {
      frameworkId, level: "category", categoryExternalId: "C1", title: "One category",
      posturePct: 80, passCount: 8, failCount: 2, emptyPostureReason: null,
    },
    {
      frameworkId, level: "subcategory", categoryExternalId: "C1",
      subcategoryExternalId: "C1.1", title: "One subcategory",
      posturePct: 80, passCount: 8, failCount: 2, emptyPostureReason: null,
    },
  ];

  function policy(policyId: string, severity: Severity, failCount: number): FrameworkPolicyRow {
    return {
      frameworkId,
      categoryExternalId: "C1",
      subcategoryExternalId: "C1.1",
      policyId,
      policyKind: "CONTROL",
      name: policyId,
      severity,
      passCount: failCount > 0 ? 0 : 1,
      failCount,
      assessedCount: 1,
      rejectedCount: 0,
      noResourceToAssess: false,
    };
  }

  it("is the WORST rank across every failing policy, not the first one the loop visits", () => {
    // LOW is listed first; a "first failing policy wins" bug would report LOW even though
    // CRITICAL, listed second, is strictly worse.
    const policies = [
      policy("p-low", "LOW", 3),
      policy("p-critical", "CRITICAL", 1),
    ];
    const tree = buildFrameworkTree(frameworkId, framework, policies)!;
    expect(tree.worstFailingSeverity).toBe("CRITICAL");
  });

  it("never lets a PASSING policy's severity contribute, however severe", () => {
    // The CRITICAL policy here has failCount 0 — it passed. If failCount were ignored, the
    // framework would read CRITICAL for a control that raised nothing; only the LOW policy
    // actually failed, so LOW is the honest answer.
    const policies = [
      policy("p-critical-passing", "CRITICAL", 0),
      policy("p-low-failing", "LOW", 5),
    ];
    const tree = buildFrameworkTree(frameworkId, framework, policies)!;
    expect(tree.worstFailingSeverity).toBe("LOW");
    expect(tree.worstFailingSeverity).not.toBe("CRITICAL");
  });

  it("is null when nothing is failing — and null, never 'UNKNOWN' or 'INFO', stands in for it", () => {
    const policies = [
      policy("p-passing-critical", "CRITICAL", 0),
      policy("p-passing-info", "INFO", 0),
    ];
    const tree = buildFrameworkTree(frameworkId, framework, policies)!;
    expect(tree.worstFailingSeverity).toBeNull();
    // Loud on purpose: coercing the empty case to a real severity level is the exact class
    // of mistake `posture ?? 0` is for a percentage — painting a mark for a fact that does
    // not exist.
    expect(tree.worstFailingSeverity).not.toBe("UNKNOWN");
    expect(tree.worstFailingSeverity).not.toBe("INFO");
  });

  it("is null on a framework with no policies mapped to it at all", () => {
    const tree = buildFrameworkTree(frameworkId, framework, [])!;
    expect(tree.worstFailingSeverity).toBeNull();
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
