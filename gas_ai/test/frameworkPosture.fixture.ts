// Transcribed from a real tenant capture of the console's CompliancePageTable operation
// (the `securityFramework` half of the response, `fetchControlQuery: false`).
//
// Abridged in BREADTH, never in SHAPE: every structural fact the normalizer depends on is
// preserved verbatim — null counts beside a real assessedCount, `noResourceToAsses` true
// with all four counts null, the three mutually exclusive policy shapes, a category with
// emptyPostureReason NO_RESOURCES, and — the one that matters most — the SAME control id
// appearing under three different subcategories across three different categories.

import type { Rec } from "../src/domain/util";

/** Control f6f5494d appears under ASI01, ASI02 and ASI10. The many-to-many, as captured. */
export const SHARED_CONTROL_ID = "f6f5494d-eeaf-49ef-9691-a6183e814b0f";

const sharedControl = {
  failCount: null,
  passCount: 72,
  rejectedCount: 0,
  assessedCount: 72,
  noResourceToAsses: false,
  control: {
    id: SHARED_CONTROL_ID,
    name: "Privileged Bedrock Agent without prompt injection guardrail",
    description: "This highly privileged AI agent operates with elevated permissions…",
    enabled: true,
    builtin: true,
    severity: "MEDIUM",
    scopeQuery: { type: ["AI_AGENT"] },
  },
  cloudConfigurationRule: null,
  hostConfigurationRule: null,
};

/** A cloud rule with nothing to evaluate — every count null, noResourceToAsses true. */
const unassessedCloudRule = {
  failCount: null,
  passCount: null,
  rejectedCount: 0,
  assessedCount: null,
  noResourceToAsses: true,
  control: null,
  cloudConfigurationRule: {
    id: "9c835e98-a846-4eed-bdbe-96794c72a03c",
    name: "Bedrock Agent should be associated with Bedrock Guardrails",
    description: "This rule checks whether AWS Bedrock agents are associated with guardrails.",
    shortId: "AIAgent-002",
    enabled: true,
    builtin: true,
    targetNativeType: "bedrock#agent",
    severity: "MEDIUM",
    subjectEntityType: "AI_AGENT",
    hasAutoRemediation: false,
    cloudProvider: "AWS",
  },
  hostConfigurationRule: null,
};

/** A failing cloud rule — the shape that becomes a compliance gap. */
const failingCloudRule = {
  failCount: 10,
  passCount: null,
  rejectedCount: 0,
  assessedCount: 10,
  noResourceToAsses: false,
  control: null,
  cloudConfigurationRule: {
    id: "763ebc07-852e-40bd-abc9-e8e38d2d1308",
    name: "Vertex AI Chat Agent App should be configured with security settings",
    description: "This rule checks whether Vertex AI Chat Agent App is configured…",
    shortId: "AIService-003",
    enabled: true,
    builtin: true,
    targetNativeType: "discoveryengine#Engine",
    severity: "MEDIUM",
    subjectEntityType: "AI_SERVICE",
    hasAutoRemediation: false,
    cloudProvider: "GCP",
  },
  hostConfigurationRule: null,
};

function subCategory(
  externalId: string,
  title: string,
  posture: number | null,
  passCount: number,
  failCount: number,
  policyAnalytics: unknown[],
  emptyPostureReason: string | null = null,
): Rec {
  return {
    passCount,
    failCount,
    compliancePosture: posture,
    emptyPostureReason,
    subCategory: {
      id: `wsct-id-${externalId}`,
      title,
      description: `${title} — description.`,
      mappingRationale: null,
      tags: [],
      externalId,
      assessmentScope: null,
    },
    policyAnalytics,
  } as Rec;
}

/** OWASP Top 10 for Agentic Applications 2026 — externalIds ASI01…ASI10. */
export const AGENTIC_FRAMEWORK: Rec = {
  id: "wf-id-275",
  name: "OWASP Top 10 For Agentic Applications 2026",
  description: null,
  builtin: true,
  enabled: true,
  complianceAnalytics: {
    passSubCategoryCount: 5,
    failSubCategoryCount: 4,
    averageCompliancePosture: 97,
    emptyPostureReason: null,
    categoryAnalytics: [
      {
        category: {
          id: "wct-id-3772", description: "", name: "ASI01 Agent Goal Hijack", externalId: "ASI01",
        },
        passCount: 144,
        failCount: 10,
        passSubCategoryCount: 0,
        failSubCategoryCount: 1,
        averageCompliancePosture: 93,
        emptyPostureReason: null,
        subCategoryAnalytics: [
          subCategory("ASI01", "ASI01 Agent Goal Hijack", 93, 144, 10, [
            unassessedCloudRule,
            failingCloudRule,
            sharedControl,
          ]),
        ],
      },
      {
        category: {
          id: "wct-id-3773", description: "", name: "ASI02 Tool Misuse and Exploitation",
          externalId: "ASI02",
        },
        passCount: 465,
        failCount: 70,
        passSubCategoryCount: 0,
        failSubCategoryCount: 1,
        averageCompliancePosture: 86,
        emptyPostureReason: null,
        subCategoryAnalytics: [
          subCategory("ASI02", "ASI02 Tool Misuse and Exploitation", 86, 465, 70, [sharedControl]),
        ],
      },
      // The all-empty category: nothing in the estate to assess. Its posture is null and
      // its reason says why — the case a page must never render as 0%.
      {
        category: {
          id: "wct-id-3779", description: "", name: "ASI08 Cascading Failures", externalId: "ASI08",
        },
        passCount: 0,
        failCount: 0,
        passSubCategoryCount: 0,
        failSubCategoryCount: 0,
        averageCompliancePosture: null,
        emptyPostureReason: "NO_RESOURCES",
        subCategoryAnalytics: [
          subCategory("ASI08", "ASI08 Cascading Failures", null, 0, 0, [unassessedCloudRule],
            "NO_RESOURCES"),
        ],
      },
      {
        category: {
          id: "wct-id-3781", description: "", name: "ASI10 Rogue Agents", externalId: "ASI10",
        },
        passCount: 16703,
        failCount: 87,
        passSubCategoryCount: 0,
        failSubCategoryCount: 1,
        averageCompliancePosture: 99,
        emptyPostureReason: null,
        subCategoryAnalytics: [
          subCategory("ASI10", "ASI10 Rogue Agents", 99, 16703, 87, [
            sharedControl,
            failingCloudRule,
          ]),
        ],
      },
    ],
  },
};

/**
 * 5Rs - Wiz for Data Security. Categories are named (Reduce, Restrict) with NUMERIC
 * externalIds, and subcategories are dotted (1.1, 2.1) — which is why the 5Rs gap code is
 * built from the category NAME and not from the external id.
 */
export const FIVE_RS_FRAMEWORK: Rec = {
  id: "wf-id-214",
  name: "5Rs - Wiz for Data Security",
  description: null,
  builtin: true,
  enabled: true,
  complianceAnalytics: {
    passSubCategoryCount: 4,
    failSubCategoryCount: 6,
    averageCompliancePosture: 75,
    emptyPostureReason: null,
    categoryAnalytics: [
      {
        category: { id: "wct-id-3073", description: "", name: "Reduce", externalId: "1" },
        passCount: 0,
        failCount: 0,
        passSubCategoryCount: 0,
        failSubCategoryCount: 0,
        averageCompliancePosture: null,
        emptyPostureReason: "NO_RESOURCES",
        subCategoryAnalytics: [
          // NO_POLICIES is a different emptiness from NO_RESOURCES: nothing was written to
          // assess, rather than nothing existing to assess it against.
          subCategory("1.1", "Stale data resources", null, 0, 0, [], "NO_POLICIES"),
        ],
      },
      {
        category: { id: "wct-id-3074", description: "", name: "Restrict", externalId: "2" },
        passCount: 194309,
        failCount: 71,
        passSubCategoryCount: 4,
        failSubCategoryCount: 3,
        averageCompliancePosture: 85,
        emptyPostureReason: null,
        subCategoryAnalytics: [
          subCategory("2.1", "Public data exposure", 100, 46272, 0, [failingCloudRule]),
        ],
      },
    ],
  },
};

/** The catalogue rows the FRAMEWORKS_LIST step returns for the two frameworks above. */
export const FRAMEWORK_CATALOGUE: Rec[] = [
  {
    id: "wf-id-275",
    name: "OWASP Top 10 For Agentic Applications 2026",
    description: null,
    builtin: true,
    enabled: true,
    policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
  },
  {
    id: "wf-id-214",
    name: "5Rs - Wiz for Data Security",
    description: null,
    builtin: true,
    enabled: true,
    policyTypes: ["CONTROL"],
  },
];
