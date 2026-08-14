// The ai_findings row mapper, both directions.
//
// Cells are plain text, so every value crosses a string boundary on the way to the sheet
// and back. Three distinctions have to survive that crossing, and each one is a real
// number somewhere if it does not:
//
//   - absent vs empty vs false, for `deleted` — isOpenGap only tombstones on an explicit
//     true, so an absent field read back as false would be harmless, but an absent field
//     read back as TRUE would silently drop the finding out of every gap count.
//   - absent vs empty, for the text columns — a legacy row has no cell at all where a new
//     row has "", and both must read back as "not recorded" rather than as "".
//   - the arrays, which are JSON in one cell and must come back as the same list.

import { describe, expect, it } from "vitest";
import { findingToRow, rowToFinding } from "../src/server/syncStore";
import type { FindingRow } from "../src/domain/graphTypes";

/** What sheetsDb.fromCell does to a written row: '' becomes null on the way back. */
function throughSheet(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = v === "" || v === null || v === undefined ? null : v;
  }
  return out;
}

const FULL: FindingRow = {
  id: "cfg-1",
  resourceId: "res-1",
  ruleShortId: "IAM-236",
  severity: "HIGH",
  remediation: "Add an aws:SourceAccount condition to the trust policy.",
  frameworkCodes: ["IAM-236", "LLM06"],
  name: "Bedrock Service Role missing conditions",
  status: "OPEN",
  result: "FAIL",
  deleted: false,
  firstSeenAt: "2026-01-06T10:48:24Z",
  analyzedAt: "2026-08-07T07:37:39Z",
  ruleId: "1a1b2762-dee3-434f-b5b4-41597c48052b",
  ruleGraphId: "9e94fa8d-3afd-5229-86a5-4b5453f8d99c",
  ruleName: "Bedrock Service Roles should prevent confused deputy attacks",
  ruleDescription: "Fails when a role trusted by bedrock.amazonaws.com has no Condition.",
  remediationInstructions: "aws iam update-assume-role-policy --role-name {{roleName}}",
  opaPolicy: "package wiz\n\ndefault result := \"pass\"\n",
  risks: ["AI_SECURITY"],
  threats: [],
  resourceName: "BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
  resourceType: "SERVICE_ACCOUNT",
  resourceStatus: "Active",
  targetExternalId: "arn:aws:iam::614303399241:role/BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
  source: "WIZ_CSPM",
  subscriptionId: "sub-1",
  subscriptionName: "aws-account-prod-01",
  cloudProvider: "AWS",
  projects: [{ id: "p1", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
  businessImpact: "LBI",
  ignoreRuleIds: ["ig-1"],
  iacFindingIds: ["iac-1"],
};

describe("findingToRow / rowToFinding", () => {
  it("round-trips a full record", () => {
    expect(rowToFinding(throughSheet(findingToRow(FULL)))).toEqual(FULL);
  });

  it("round-trips the six-field record the previous version wrote", () => {
    const minimal: FindingRow = {
      id: "cfg-2",
      resourceId: "res-2",
      ruleShortId: "SUB-082",
      severity: "MEDIUM",
      remediation: "Recreate the store with a customer-managed key.",
      frameworkCodes: ["SUB-082"],
    };
    const back = rowToFinding(throughSheet(findingToRow(minimal)));
    expect(back.id).toBe("cfg-2");
    expect(back.remediation).toBe("Recreate the store with a customer-managed key.");
    expect(back.frameworkCodes).toEqual(["SUB-082"]);
    // Nothing invented: the fields the record never had stay absent.
    expect(back.name).toBeUndefined();
    expect(back.status).toBeUndefined();
    expect(back.result).toBeUndefined();
    expect(back.deleted).toBeUndefined();
  });

  it("reads a row from a tab that predates the new columns entirely", () => {
    // Not just empty cells — the columns do not exist, so readAll never emits the keys.
    const legacy = {
      id: "cfg-3", resource_id: "res-3", rule_short_id: "SUB-047",
      severity: "MEDIUM", remediation: "Enable audit logging.", framework_codes: "SUB-047",
    };
    const back = rowToFinding(legacy);
    expect(back.status).toBeUndefined();
    expect(back.deleted).toBeUndefined();
    expect(back.projects).toEqual([]);
    expect(back.risks).toEqual([]);
  });

  it("keeps deleted tri-state: absent, false and true are three answers", () => {
    const absent = rowToFinding(throughSheet(findingToRow({ ...FULL, deleted: undefined })));
    expect(absent.deleted).toBeUndefined();
    expect(rowToFinding(throughSheet(findingToRow({ ...FULL, deleted: false }))).deleted).toBe(false);
    expect(rowToFinding(throughSheet(findingToRow({ ...FULL, deleted: true }))).deleted).toBe(true);
  });

  it("writes empty arrays as null rather than '[]', so an absent list reads absent", () => {
    const row = findingToRow({ ...FULL, risks: [], ignoreRuleIds: [], projects: [] });
    expect(row["risks_json"]).toBeNull();
    expect(row["ignore_rule_ids_json"]).toBeNull();
    expect(row["projects_json"]).toBeNull();
  });

  // A Sheets cell rejects the whole write past 50,000 characters, and opa_policy is the
  // one column here carrying an unbounded document. Losing the tail of one Rego policy is
  // recoverable; failing the sync's findings write is not.
  it("clamps an oversized policy instead of failing the write", () => {
    const huge = "x".repeat(60000);
    const row = findingToRow({ ...FULL, opaPolicy: huge });
    const stored = String(row["opa_policy"]);
    expect(stored.length).toBeLessThanOrEqual(50000);
    expect(stored.endsWith("… truncated for storage")).toBe(true);
  });

  it("leaves a policy under the cap byte-identical", () => {
    const row = findingToRow(FULL);
    expect(row["opa_policy"]).toBe(FULL.opaPolicy);
  });
});
