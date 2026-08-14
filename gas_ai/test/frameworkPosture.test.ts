// The compliance-posture normalizer and the authoritative framework-code join.
//
// Two things are load-bearing here and neither is obvious from the types:
//   1. The posture tree's many-to-many policy edge must SURVIVE flattening. One control
//      mapping to three subcategories is three facts, and the whole AARS half of this
//      feature is that mapping.
//   2. A null posture must never become a zero. "Nothing to assess" and "everything failed"
//      both arrive as an absent percentage.

import { describe, expect, it } from "vitest";

import {
  frameworkCodeLookup,
  frameworkFamily,
  frameworkGapCode,
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

describe("normalizeCompliancePosturePage — the tree", () => {
  it("emits one level-tagged row per framework, category and subcategory", () => {
    const levels = agentic.posture.map((p) => p.level);
    expect(levels.filter((l) => l === "framework")).toHaveLength(1);
    expect(levels.filter((l) => l === "category")).toHaveLength(4);
    expect(levels.filter((l) => l === "subcategory")).toHaveLength(4);
  });

  it("carries Wiz's posture percentage through unchanged, never recomputed", () => {
    const framework = agentic.posture.find((p) => p.level === "framework")!;
    // 97 is Wiz's averageCompliancePosture. The categories are 93/86/null/99, whose mean
    // is not 97 — which is exactly why this is stored rather than derived.
    expect(framework.posturePct).toBe(97);
    const asi02 = agentic.posture.find((p) => p.categoryExternalId === "ASI02" && p.level === "category")!;
    expect(asi02.posturePct).toBe(86);
  });

  it("rebuilds the hierarchy from external ids", () => {
    const sub = agentic.posture.find((p) => p.level === "subcategory" && p.subcategoryExternalId === "ASI10")!;
    expect(sub.categoryExternalId).toBe("ASI10");
    expect(sub.title).toBe("ASI10 Rogue Agents");
    expect(sub.frameworkId).toBe("wf-id-275");
  });

  it("keeps the framework-level subcategory counts out of the policy count fields", () => {
    const framework = agentic.posture.find((p) => p.level === "framework")!;
    expect(framework.passSubCategoryCount).toBe(5);
    expect(framework.failSubCategoryCount).toBe(4);
    // passCount/failCount at framework level count nothing Wiz sent — they stay 0 rather
    // than borrowing the subcategory unit.
    expect(framework.passCount).toBe(0);
    expect(framework.failCount).toBe(0);
  });
});

describe("normalizeCompliancePosturePage — emptiness is not zero", () => {
  it("keeps a null posture null and records why", () => {
    const cat = agentic.posture.find((p) => p.level === "category" && p.categoryExternalId === "ASI08")!;
    expect(cat.posturePct).toBeNull();
    expect(cat.emptyPostureReason).toBe("NO_RESOURCES");
  });

  it("distinguishes NO_POLICIES from NO_RESOURCES", () => {
    const sub = fiveRs.posture.find((p) => p.subcategoryExternalId === "1.1")!;
    expect(sub.posturePct).toBeNull();
    expect(sub.emptyPostureReason).toBe("NO_POLICIES");
    const cat = fiveRs.posture.find((p) => p.level === "category" && p.categoryExternalId === "1")!;
    expect(cat.emptyPostureReason).toBe("NO_RESOURCES");
  });

  it("a real posture carries no empty reason", () => {
    const sub = fiveRs.posture.find((p) => p.subcategoryExternalId === "2.1")!;
    expect(sub.posturePct).toBe(100);
    expect(sub.emptyPostureReason).toBeNull();
  });
});

describe("normalizeCompliancePosturePage — the many-to-many policy edge", () => {
  it("emits the SAME control once per subcategory it maps to, not once overall", () => {
    const rows = agentic.frameworkPolicies.filter((p) => p.policyId === SHARED_CONTROL_ID);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.subcategoryExternalId).sort()).toEqual(["ASI01", "ASI02", "ASI10"]);
  });

  it("keys every row by the (framework, subcategory, policy) triple", () => {
    const keys = agentic.frameworkPolicies.map(
      (p) => `${p.frameworkId}|${p.subcategoryExternalId}|${p.policyId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("picks whichever of the three policy shapes was non-null", () => {
    const control = agentic.frameworkPolicies.find((p) => p.policyId === SHARED_CONTROL_ID)!;
    expect(control.policyKind).toBe("CONTROL");
    expect(control.shortId).toBeUndefined();

    const rule = agentic.frameworkPolicies.find((p) => p.shortId === "AIService-003")!;
    expect(rule.policyKind).toBe("CLOUD_RULE");
    expect(rule.cloudProvider).toBe("GCP");
    expect(rule.subjectEntityType).toBe("AI_SERVICE");
  });

  it("reads null counts as zero but keeps 'nothing to assess' as its own fact", () => {
    const unassessed = agentic.frameworkPolicies.find((p) => p.shortId === "AIAgent-002")!;
    expect(unassessed.passCount).toBe(0);
    expect(unassessed.failCount).toBe(0);
    expect(unassessed.assessedCount).toBe(0);
    expect(unassessed.noResourceToAssess).toBe(true);

    const failing = agentic.frameworkPolicies.find((p) => p.shortId === "AIService-003")!;
    expect(failing.failCount).toBe(10);
    expect(failing.passCount).toBe(0); // null passCount, but it WAS assessed
    expect(failing.assessedCount).toBe(10);
    expect(failing.noResourceToAssess).toBe(false);
  });
});

describe("frameworkFamily", () => {
  it("reads the codebook vocabulary off the framework name, not its tenant-local id", () => {
    expect(frameworkFamily("OWASP Top 10 For Agentic Applications 2026")).toBe("OWASP_ASI");
    expect(frameworkFamily("5Rs - Wiz for Data Security")).toBe("WIZ_5RS");
    expect(frameworkFamily("OWASP ML Security Top 10")).toBe("OWASP_ML");
    expect(frameworkFamily("OWASP Top 10 for LLM Applications 2025")).toBe("OWASP_LLM");
  });

  it("a framework this app has no vocabulary for is OTHER", () => {
    expect(frameworkFamily("CIS Amazon Web Services Foundations Benchmark")).toBe("OTHER");
    expect(frameworkFamily("PCI DSS v4.0")).toBe("OTHER");
  });
});

describe("frameworkGapCode — one spelling per family, per the codebook", () => {
  it("OWASP LLM and Agentic external ids ARE the code", () => {
    expect(frameworkGapCode({ family: "OWASP_ASI", subcategoryExternalId: "ASI01" })).toBe("ASI01");
    expect(frameworkGapCode({ family: "OWASP_LLM", subcategoryExternalId: "LLM03" })).toBe("LLM03");
  });

  it("OWASP ML derives from the TITLE — the codebook says the ordinal is not in the data", () => {
    expect(frameworkGapCode({
      family: "OWASP_ML",
      subcategoryExternalId: "ML02",
      subcategoryTitle: "Data Poisoning Attack",
    })).toBe("ML_DATA_POISONING_ATTACK");
  });

  it("Wiz 5Rs derives from the CATEGORY NAME, not the numeric external id", () => {
    expect(frameworkGapCode({
      family: "WIZ_5RS",
      categoryName: "Restrict",
      subcategoryExternalId: "2.1",
      subcategoryTitle: "Public data exposure",
    })).toBe("5R_RESTRICT");
  });

  it("mints NOTHING for a framework it has no vocabulary for", () => {
    // Deliberate: the finding's own shortId is still raised as a gap, so the asset is not
    // under-counted, and a made-up prefix would be a code no rule can be written against.
    expect(frameworkGapCode({ family: "OTHER", subcategoryExternalId: "1.1" })).toBe("");
  });
});

describe("frameworkCodeLookup", () => {
  const frameworks = normalizeFrameworksPage(FRAMEWORK_CATALOGUE).frameworks;
  const policies = [...agentic.frameworkPolicies, ...fiveRs.frameworkPolicies];
  const posture = [...agentic.posture, ...fiveRs.posture];
  const lookup = frameworkCodeLookup(policies, posture, frameworks);

  it("maps a control to every framework code it carries, by uuid", () => {
    expect(lookup[SHARED_CONTROL_ID].sort()).toEqual(["ASI01", "ASI02", "ASI10"]);
  });

  it("maps a cloud rule by BOTH its uuid and its shortId", () => {
    // A configuration finding carries rule.id and rule.shortId; which one matches depends
    // on the policy kind, so both are keys.
    expect(lookup["AIService-003"]).toContain("ASI01");
    expect(lookup["763ebc07-852e-40bd-abc9-e8e38d2d1308"]).toContain("ASI01");
  });

  it("gives a policy that spans two frameworks the codes of both", () => {
    // AIService-003 sits under ASI01/ASI10 in the Agentic framework and under Restrict in
    // the 5Rs one — these are exactly the codes the cascade's dormant rows name.
    expect(lookup["AIService-003"].sort()).toEqual(["5R_RESTRICT", "ASI01", "ASI10"]);
  });

  it("resolves the family from the posture tree when no catalogue was synced", () => {
    const noCatalogue = frameworkCodeLookup(policies, posture, []);
    expect(noCatalogue[SHARED_CONTROL_ID].sort()).toEqual(["ASI01", "ASI02", "ASI10"]);
  });
});

describe("normalizeFrameworksPage", () => {
  it("reads the catalogue and defaults `selected` to false", () => {
    const part = normalizeFrameworksPage(FRAMEWORK_CATALOGUE);
    expect(part.frameworks).toHaveLength(2);
    expect(part.frameworks[0].id).toBe("wf-id-275");
    expect(part.frameworks[0].policyTypes).toContain("CONTROL");
    // Selection is this app's decision, resolved from settings — never something Wiz says.
    expect(part.frameworks.every((f) => f.selected === false)).toBe(true);
  });

  it("skips rows with no id rather than inventing one", () => {
    expect(normalizeFrameworksPage([{ name: "nameless" }]).frameworks).toHaveLength(0);
  });
});
