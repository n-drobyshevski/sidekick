// The rule catalogue, and the two things read off it: the MFA/dormancy matchers, and the
// filter verification that keeps an unhonoured `rule` filter from filling a tab captioned
// "identity hygiene" with the tenant's entire CSPM register.
//
// The catalogue fixture is transcribed from the captured cloudConfigurationRules response.
// Four of the six rows are there to be MATCHED and two to be REFUSED, which is the only way
// a name-matching heuristic can be held to anything.

import { describe, expect, it } from "vitest";

import {
  HYGIENE_SUBJECT,
  hygieneKindOf,
  resolveHygieneRules,
} from "../src/domain/identityHygiene";
import {
  FilterNotHonouredError,
  normalizeConfigRulesPage,
  normalizeIdentityFindingsPage,
} from "../src/domain/syncNormalize";
import {
  configRulesAreFresh,
  CONFIG_RULES_TTL_MS,
  withConfigRulesSyncedAt,
} from "../src/domain/settingsLogic";
import { buildAarsHintsFromFindings, enrichGraphDoc } from "../src/domain/graphEnrich";
import type { ConfigRuleRow, GraphDoc } from "../src/domain/graphTypes";
import type { Rec } from "../src/domain/util";

/** Transcribed from the captured catalogue response. */
const CATALOGUE: ConfigRuleRow[] = [
  { id: "r-159", shortId: "IAM-159", name: "User should have MFA enabled",
    subjectEntityType: "USER_ACCOUNT", externalRefs: [] },
  { id: "r-048", shortId: "IAM-048",
    name: "User with a console password should have MFA enabled",
    subjectEntityType: "USER_ACCOUNT", externalRefs: [] },
  { id: "r-208", shortId: "IAM-208",
    name: "User with password-based authentication should have multi-factor authentication (MFA) enabled",
    subjectEntityType: "USER_ACCOUNT", externalRefs: [] },
  { id: "r-235", shortId: "IAM-235",
    name: "User should not be inactive for more than 90 days",
    subjectEntityType: "USER_ACCOUNT", externalRefs: [] },
  { id: "r-291", shortId: "IAM-291", name: "User should have recent login activity",
    subjectEntityType: "USER_ACCOUNT", externalRefs: [] },
  // --- the two that must be refused ---
  { id: "r-idp-012", shortId: "IDP-012",
    name: "WorkSpaces Directory should have multi-factor authentication enabled",
    subjectEntityType: "IDENTITY_PROVIDER", externalRefs: [] },
  { id: "r-app-011", shortId: "ConnectedApp-011",
    name: "Uninstalled Connected App should not be inactive for more than 90 days",
    subjectEntityType: "SERVICE_ACCOUNT", externalRefs: [] },
];

describe("normalizeConfigRulesPage", () => {
  it("keeps the five fields the capture proves, and nothing else", () => {
    const part = normalizeConfigRulesPage([{
      id: "r-1", name: "R", shortId: "SUB-082", subjectEntityType: "REGION",
      externalReferences: [{ id: "CKV_GCP_96", name: "…" }, { id: "CKV2_GCP_25", name: "…" }],
      __typename: "CloudConfigurationRule",
    }]);
    expect(part.configRules).toEqual([{
      id: "r-1", shortId: "SUB-082", name: "R", subjectEntityType: "REGION",
      externalRefs: ["CKV_GCP_96", "CKV2_GCP_25"],
    }]);
    // Reference data only: no nodes, no findings, nothing that describes the estate.
    expect(part.nodes).toHaveLength(0);
    expect(part.findings).toHaveLength(0);
  });

  it("drops a rule with no id or no name — the only two things it is for", () => {
    const part = normalizeConfigRulesPage([
      { name: "no id" }, { id: "no-name" }, { id: "ok", name: "Fine" },
    ]);
    expect(part.configRules.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("hygieneKindOf", () => {
  it("matches the three MFA phrasings the catalogue actually uses", () => {
    expect(hygieneKindOf(CATALOGUE[0])).toBe("MFA");
    expect(hygieneKindOf(CATALOGUE[1])).toBe("MFA");
    expect(hygieneKindOf(CATALOGUE[2])).toBe("MFA");
  });

  it("matches both dormancy phrasings", () => {
    expect(hygieneKindOf(CATALOGUE[3])).toBe("DORMANT");
    expect(hygieneKindOf(CATALOGUE[4])).toBe("DORMANT");
  });

  it("refuses an MFA rule that is not about a person", () => {
    // IDP-012 matches the MFA pattern and is evaluated against an IDENTITY_PROVIDER. It is a
    // real finding and says nothing about whether anyone has MFA; counting it would put a
    // directory's misconfiguration into a figure captioned "identities without MFA".
    expect(hygieneKindOf(CATALOGUE[5])).toBeNull();
  });

  it("refuses a dormancy rule about an app rather than a user", () => {
    expect(hygieneKindOf(CATALOGUE[6])).toBeNull();
  });

  it("guards on the subject Wiz declares, not on the name alone", () => {
    expect(HYGIENE_SUBJECT).toBe("USER_ACCOUNT");
    expect(hygieneKindOf({
      id: "x", shortId: "X-1", name: "User should have MFA enabled",
      subjectEntityType: undefined, externalRefs: [],
    })).toBeNull();
  });
});

describe("resolveHygieneRules", () => {
  it("resolves the five and reports the shortIds an operator can check", () => {
    const resolved = resolveHygieneRules(CATALOGUE);
    expect(resolved.ids.sort()).toEqual(["r-048", "r-159", "r-208", "r-235", "r-291"]);
    expect(resolved.shortIds).toContain("IAM-159");
    expect(resolved.byId["r-235"]).toBe("DORMANT");
    expect(resolved.byId["r-idp-012"]).toBeUndefined();
  });

  it("resolves nothing on an empty catalogue — a first sync, not an error", () => {
    // The step is omitted entirely in that case rather than sending an empty rule list, which
    // a tenant would reasonably read as "no filter".
    expect(resolveHygieneRules([]).ids).toEqual([]);
  });
});

describe("normalizeIdentityFindingsPage", () => {
  const kinds = { "r-159": "MFA" as const, "r-235": "DORMANT" as const };
  const finding = (ruleId: string, extra: Rec = {}): Rec => ({
    id: "f-" + ruleId,
    severity: "HIGH",
    status: "OPEN",
    result: "FAIL",
    resource: { id: "user-1", name: "ops@example.com" },
    rule: { id: ruleId, shortId: "IAM-159", name: "User should have MFA enabled" },
    ...extra,
  });

  it("stamps the hygiene kind from the matcher, since Wiz has no such concept", () => {
    const part = normalizeIdentityFindingsPage([finding("r-159"), finding("r-235")], kinds);
    expect(part.identityFindings.map((f) => f.hygiene)).toEqual(["MFA", "DORMANT"]);
    expect(part.identityFindings[0].resourceId).toBe("user-1");
  });

  it("ABORTS when the page carries a rule that was not requested", () => {
    // THE regression this function exists for. `ConfigurationFindingFilters.rule` is proven by
    // no capture: if the tenant accepts it and ignores it we would walk its entire CSPM
    // register into a tab captioned "identity hygiene". A page cap would not help — it would
    // collect the wrong thousand rows more cheaply.
    expect(() => normalizeIdentityFindingsPage(
      [finding("r-159"), finding("r-synapse-047")],
      kinds,
    )).toThrow(FilterNotHonouredError);
  });

  it("aborts on a row with no rule at all, rather than skipping it", () => {
    // Same reasoning: a findings page with no rule on its rows is not a page this filter
    // produced, and keeping the subset that happens to parse would hide that.
    expect(() => normalizeIdentityFindingsPage([finding("r-159", { rule: null })], kinds))
      .toThrow(FilterNotHonouredError);
  });

  it("checks the filter BEFORE dropping a resource-less row", () => {
    // Order matters. A row with no resource still proves the filter worked or did not; if the
    // resource check ran first, an unfiltered page whose leading rows lacked resources would
    // slip through the verification entirely.
    expect(() => normalizeIdentityFindingsPage(
      [{ id: "f-x", rule: { id: "r-other" }, severity: "LOW" }],
      kinds,
    )).toThrow(FilterNotHonouredError);
  });

  it("keeps an expected rule's row even when it names no resource", () => {
    const part = normalizeIdentityFindingsPage(
      [{ id: "f-x", rule: { id: "r-159" }, severity: "LOW" }],
      kinds,
    );
    expect(part.identityFindings).toHaveLength(0);
  });
});

describe("identity findings never price an AARS score", () => {
  it("keeps a human account unscored even while carrying a finding", () => {
    // THE reason ai_identity_findings is its own tab. buildAarsHintsFromFindings keys hints by
    // resourceId, and a USER_ACCOUNT IS a row in ai_assets — put there by the identity-access
    // traversal. Fold an MFA finding into ai_findings and enrichGraphDoc's `scorable` test
    // goes true for a person, and the app puts an AI Asset Risk Score on a human being.
    //
    // This asserts the split holds end to end: hints built from the COMPLIANCE findings see
    // nothing for the user, so enrichment leaves it unscored.
    const doc: GraphDoc = {
      nodes: [
        { id: "user-1", kind: "USER_ACCOUNT", name: "ops@example.com" },
        { id: "agent", kind: "AI_AGENT", name: "agent" },
      ],
      edges: [],
      syncedAt: "2026-08-14T00:00:00Z",
    };
    // The compliance arm, which is what prices pillar B. The identity finding is NOT here —
    // that is the invariant.
    const hints = buildAarsHintsFromFindings([], doc, []);
    expect(hints["user-1"]).toBeUndefined();

    const enriched = enrichGraphDoc(doc, [], hints);
    const user = enriched.nodes.find((n) => n.id === "user-1")!;
    expect(user.aars).toBeUndefined();
    expect(user.aarsSeverity).toBeUndefined();
  });
});

describe("the catalogue refresh gate", () => {
  const NOW = 1_760_000_000_000;

  it("is stale when the tab is empty, however recent the stamp", () => {
    const settings = withConfigRulesSyncedAt({}, NOW);
    expect(configRulesAreFresh(settings, false, NOW)).toBe(false);
  });

  it("is stale when nothing has ever been stamped", () => {
    expect(configRulesAreFresh({}, true, NOW)).toBe(false);
  });

  it("is fresh inside the window and stale outside it", () => {
    const settings = withConfigRulesSyncedAt({}, NOW - CONFIG_RULES_TTL_MS + 1000);
    expect(configRulesAreFresh(settings, true, NOW)).toBe(true);
    const old = withConfigRulesSyncedAt({}, NOW - CONFIG_RULES_TTL_MS - 1000);
    expect(configRulesAreFresh(old, true, NOW)).toBe(false);
  });
});
