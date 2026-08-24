// The client bundle can't import the TypeScript domain module, so the browser carries a
// hand-kept copy of the Cloud Configuration filter/sort logic in
// src/client/js/pages/configView.js. Under CONFIG_CLIENT_ALL_MAX — which is every tenant
// the AI framework filter produces in practice — that copy is the ONLY implementation
// that runs: the server ships every row and never sees the filter change.
//
// So "added a dimension server-side and forgot the browser" would ship a deep link that
// resolves to different rows depending on how big the register is, and nothing would
// catch it: client JS is neither typechecked nor linted here. This runs one table of
// cases through both implementations and requires identical answers.
//
// Same shape, and same reasoning, as assetQueryMirror.test.ts.

import { describe, expect, it } from "vitest";
import * as ts from "../src/domain/configFindings";
import * as js from "../src/client/js/pages/configView.js";

/** Register rows as toConfigView emits them — the only shape either side ever sees. */
const ROWS = [
  {
    id: "a", name: "Bedrock role missing conditions", severity: "HIGH", status: "OPEN",
    result: "FAIL", ruleShortId: "IAM-236", ruleName: "Bedrock confused deputy",
    resourceId: "sa-1", resourceName: "BIGDATA-AI-PP", resourceType: "SERVICE_ACCOUNT",
    cloud: "AWS", subscriptionName: "aws-prod", projects: ["PROJECT-ALPHA"],
    businessImpact: "LBI", firstSeenAt: "2026-01-06T10:48:24Z", analyzedAt: "2026-08-07T07:37:39Z",
    risks: ["AI_SECURITY"], linked: false, ignored: false, iac: false, gap: true,
    problemOutcome: "ATTEND",
  },
  {
    id: "b", name: "Metadata store not encrypted", severity: "MEDIUM", status: "OPEN",
    result: "FAIL", ruleShortId: "SUB-082", ruleName: "Vertex CMEK",
    resourceId: "region-1", resourceName: "europe-west1", resourceType: "REGION",
    cloud: "GCP", subscriptionName: "gcp-01", projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    businessImpact: "MBI", firstSeenAt: "2026-06-12T19:42:35Z", analyzedAt: "2026-06-19T10:27:22Z",
    risks: ["AI_SECURITY", "UNPROTECTED_DATA"], linked: false, ignored: true, iac: false, gap: true,
    problemOutcome: "ACT",
  },
  {
    id: "c", name: "Agent host open to internet", severity: "HIGH", status: "OPEN",
    result: "FAIL", ruleShortId: "SUB-114", ruleName: "Agent host exposure",
    resourceId: "agent-h", resourceName: "agent-H-chatbot", resourceType: "AI_AGENT",
    cloud: "GCP", subscriptionName: "gcp-05", projects: ["PROJECT-ALPHA"],
    businessImpact: "LBI", firstSeenAt: "2026-05-02T08:15:00Z", analyzedAt: "2026-07-13T21:52:08Z",
    risks: ["AI_SECURITY"], linked: true, ignored: false, iac: true, gap: true,
    problemOutcome: "TRACK_STAR",
  },
  {
    id: "d", name: "Agent host open to internet", severity: "HIGH", status: "RESOLVED",
    result: "PASS", ruleShortId: "SUB-114", ruleName: "Agent host exposure",
    resourceId: "agent-a", resourceName: "Agent A", resourceType: "AI_AGENT",
    cloud: "GCP", subscriptionName: "gcp-01", projects: [],
    businessImpact: "", firstSeenAt: "2026-03-11T09:00:00Z", analyzedAt: "2026-08-07T07:37:41Z",
    risks: ["AI_SECURITY"], linked: true, ignored: false, iac: false, gap: false,
    problemOutcome: "",
  },
  {
    id: "e", name: "Policy without guardrail condition", severity: "LOW", status: "REJECTED",
    result: "FAIL", ruleShortId: "IAM-267", ruleName: "Bedrock guardrail condition",
    resourceId: "policy-1", resourceName: "AIF-IAM-V2-2", resourceType: "RAW_ACCESS_POLICY",
    cloud: "AWS", subscriptionName: "aws-prod", projects: ["PROJECT-GAMMA"],
    businessImpact: "LBI", firstSeenAt: "2026-07-21T16:03:20Z", analyzedAt: "2026-08-03T23:20:36Z",
    risks: ["AI_SECURITY"], linked: false, ignored: true, iac: true, gap: false,
    // No verdict at all — the "never decided" case, distinct from row d's stored "".
  },
];

/** Every dimension, alone and in combination, plus the ones that AND rather than OR. */
const QUERIES = [
  {},
  { q: "bedrock" },
  { q: "EUROPE" },
  { severities: "HIGH" },
  { severities: "HIGH,MEDIUM" },
  { statuses: "OPEN" },
  { statuses: "RESOLVED,REJECTED" },
  { clouds: "AWS" },
  { resourceTypes: "REGION,RAW_ACCESS_POLICY" },
  { rules: "SUB-114" },
  { projects: "PROJECT-ALPHA" },
  { projects: "PROJECT-BETA,PROJECT-GAMMA" },
  { linkage: "unlinked" },
  { linkage: "linked" },
  { linkage: "linked,unlinked" },
  { flags: "gap" },
  { flags: "ignored" },
  { flags: "gap,ignored" },
  { flags: "gap,iac" },
  { flags: "gap,ignored,iac" },
  { severities: "HIGH", clouds: "GCP", flags: "gap" },
  { severities: "HIGH", linkage: "unlinked" },
  { q: "agent", statuses: "OPEN", flags: "iac" },
  // The retired outcome facet: a link carrying it resolves to no filter, and both sides
  // must drop it the same way or a shared link would answer differently by register size.
  { outcomes: "ACT" },
  { outcomes: "ACT,ATTEND" },
  { severities: "HIGH", outcomes: "ATTEND" },
  // Values outside the vocabulary, which both sides must drop rather than match on.
  { linkage: "sideways" },
  { flags: "nonsense" },
  { outcomes: "SOMEDAY" },
  // A selection that matches nothing.
  { severities: "CRITICAL" },
];

const FACET_KEYS = [
  "severities", "statuses", "clouds", "resourceTypes", "rules", "projects",
  "linkage", "flags",
];

describe("configView mirrors src/domain/configFindings", () => {
  it("resolves the same query from the same params", () => {
    for (const params of QUERIES) {
      expect(js.readConfigParams(params), JSON.stringify(params))
        .toEqual(ts.resolveConfigQuery(params));
    }
  });

  it("filters to the same rows", () => {
    for (const params of QUERIES) {
      const tsRows = ts.filterConfigRows(ROWS, ts.resolveConfigQuery(params)).map((r) => r.id);
      const jsRows = js.applyConfigFilters(ROWS, js.readConfigParams(params)).map((r) => r.id);
      expect(jsRows, JSON.stringify(params)).toEqual(tsRows);
    }
  });

  it("agrees per row on the predicate itself, not just on the filtered set", () => {
    for (const params of QUERIES) {
      const tsQ = ts.resolveConfigQuery(params);
      const jsQ = js.readConfigParams(params);
      for (const row of ROWS) {
        expect(js.matchesConfigRow(row, jsQ), `${row.id} ${JSON.stringify(params)}`)
          .toBe(ts.matchesConfigQuery(row, tsQ));
      }
    }
  });

  it("sorts to the same order on every column, both directions", () => {
    for (const sort of ts.CONFIG_SORTS) {
      for (const dir of ["asc", "desc"]) {
        const tsRows = ts.sortConfigRows(ROWS, sort, dir).map((r) => r.id);
        const jsRows = js.sortConfigRows(ROWS, sort, dir === "desc").map((r) => r.id);
        expect(jsRows, `${sort} ${dir}`).toEqual(tsRows);
      }
    }
  });

  it("counts the same facets", () => {
    for (const params of QUERIES) {
      const tsCounts = ts.configFacetCounts(ROWS, ts.resolveConfigQuery(params));
      const jsCounts = js.configFacetCounts(ROWS, js.readConfigParams(params), FACET_KEYS);
      for (const key of FACET_KEYS) {
        expect(jsCounts[key], `${key} ${JSON.stringify(params)}`).toEqual(tsCounts[key]);
      }
    }
  });

  it("agrees on the default sort direction per column", () => {
    for (const sort of ts.CONFIG_SORTS) {
      expect(js.CONFIG_SORT_DESC[sort], sort)
        .toBe(ts.DEFAULT_CONFIG_SORT_DIR[sort] === "desc");
    }
  });

  it("carries the same vocabularies", () => {
    expect(js.CONFIG_SORTS).toEqual(ts.CONFIG_SORTS);
    expect(js.LINKAGE_VALUES).toEqual([...ts.LINKAGE_VALUES]);
    expect(js.CONFIG_FLAGS).toEqual([...ts.CONFIG_FLAGS]);
    // Phase 5: the problem tree's outcome scale, worst (ACT) first.
    // The outcome vocabulary is gone from both sides, not merely unused on one.
    expect(js.OUTCOME_RANK).toBeUndefined();
  });
});
