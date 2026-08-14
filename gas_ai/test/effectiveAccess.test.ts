// Effective permissions, and the invariant that makes them safe to add: the DATA vocabulary
// and the ADMIN/HIGH_PRIVILEGE one never share a field.
//
// riskConditions.ts opens with the story of two consumers reading one condition differently
// and disagreeing about the answer. This is the same shape of hazard one level up — two roots
// that both call something `accessType` and mean different axes — so the tests below are as
// much about what must stay separate as about what must be collected.

import { describe, expect, it } from "vitest";

import {
  EFFECTIVE_ACCESS_TYPES,
  effectiveAccessFilter,
  toEffectiveAccessRow,
} from "../src/domain/effectiveAccess";
import { withHumanAccess } from "../src/domain/graphEnrich";
import { normalizeEffectiveAccessPage } from "../src/domain/syncNormalize";
import { Q_EFFECTIVE_ACCESS } from "../src/server/wizQueriesAi";
import type { GEdge, GNode, GraphDoc, IdentityFindingRow } from "../src/domain/graphTypes";
import type { Rec } from "../src/domain/util";

const AI_TYPES = ["AI_AGENT", "AI_MODEL", "MCP_SERVER"];

describe("the document", () => {
  it("drops the ungated issues join the console spreads at six sites", () => {
    // The one field in the capture that is NOT behind an @include, multiplied by every place
    // the entity fragment spreads. Q_ISSUES already warns about this class of join.
    expect(Q_EFFECTIVE_ACCESS).not.toContain("issueAnalytics");
    expect(Q_EFFECTIVE_ACCESS).not.toContain("userMetadata");
    expect(Q_EFFECTIVE_ACCESS).not.toContain("hasOriginalObject");
  });

  it("keeps the permissions and the policies — the reason to run it at all", () => {
    expect(Q_EFFECTIVE_ACCESS).toContain("permissions");
    expect(Q_EFFECTIVE_ACCESS).toContain("principalPolicies");
    expect(Q_EFFECTIVE_ACCESS).toContain("resourcePolicies");
  });

  it("reads through the connection transport with no special case", () => {
    expect(Q_EFFECTIVE_ACCESS).toContain("entityEffectiveAccessEntries(");
  });
});

describe("effectiveAccessFilter", () => {
  it("asks the capture's question: which people can reach AI asset DATA", () => {
    expect(effectiveAccessFilter(AI_TYPES, null)).toEqual({
      grantedEntity: {},
      grantedEntityType: { equals: ["USER_ACCOUNT"] },
      resource: {},
      resourceType: { equals: AI_TYPES },
      accessTypes: { equals: ["DATA"] },
    });
  });

  it("scopes to a project only when one is configured", () => {
    expect(effectiveAccessFilter(AI_TYPES, ["p1"])["projectId"]).toEqual(["p1"]);
  });

  it("asks for DATA and nothing wider, because that is what the page claims", () => {
    expect([...EFFECTIVE_ACCESS_TYPES]).toEqual(["DATA"]);
  });
});

describe("toEffectiveAccessRow", () => {
  const entry = (extra: Rec = {}): Rec => ({
    grantedEntity: { id: "user-1", name: "ops@example.com", type: "USER_ACCOUNT" },
    accessibleResource: { id: "agent-1", name: "agent", type: "AI_AGENT" },
    accessTypes: ["DATA"],
    permissions: ["storage.objects.get"],
    ...extra,
  });

  it("unions permissions from the entry and its paths", () => {
    // A tenant that returns the top-level list empty while populating the paths would
    // otherwise produce "reachable, with no permissions", which is not a sentence this app
    // should print.
    const row = toEffectiveAccessRow(entry({
      permissions: [],
      paths: [{ permissions: ["aiplatform.endpoints.predict"], accessTypes: ["DATA"] }],
    }))!;
    expect(row.permissions).toEqual(["aiplatform.endpoints.predict"]);
  });

  it("collects both principal and resource policies, deduped", () => {
    const row = toEffectiveAccessRow(entry({
      paths: [
        { principalPolicies: [{ policy: { id: "p1", name: "admin-binding" } }] },
        { resourcePolicies: [{ policy: { id: "p2", name: "bucket-policy" } }] },
        { principalPolicies: [{ policy: { id: "p1", name: "admin-binding" } }] },
      ],
    }))!;
    expect(row.policyIds).toEqual(["p1", "p2"]);
    expect(row.policyNames).toEqual(["admin-binding", "bucket-policy"]);
  });

  it("drops an entry that names no pair", () => {
    expect(toEffectiveAccessRow({ grantedEntity: { id: "u" } })).toBeNull();
    expect(toEffectiveAccessRow({ accessibleResource: { id: "a" } })).toBeNull();
  });

  it("survives paths that are absent, empty or malformed", () => {
    expect(toEffectiveAccessRow(entry({ paths: null }))!.policyIds).toEqual([]);
    expect(toEffectiveAccessRow(entry({ paths: [null, {}] }))!.policyIds).toEqual([]);
  });
});

describe("normalizeEffectiveAccessPage", () => {
  it("emits rows and NEVER an edge", () => {
    // Drawing an ALLOWS_ACCESS_TO edge here would need an accessType, and the only one
    // available is DATA — a value from the other vocabulary that the graph's own filters and
    // withHumanAccess would then have to interpret. The pair rides as evidence instead.
    const part = normalizeEffectiveAccessPage([{
      grantedEntity: { id: "u1" }, accessibleResource: { id: "a1" },
      accessTypes: ["DATA"], permissions: ["x"],
    }]);
    expect(part.effectiveAccess).toHaveLength(1);
    expect(part.edges).toHaveLength(0);
    expect(part.nodes).toHaveLength(0);
  });
});

// ------------------------------------------------------------------- the join

function node(id: string, kind: GNode["kind"], extra: Partial<GNode> = {}): GNode {
  return { id, kind, name: id, ...extra };
}
function edge(src: string, dst: string, accessType?: GEdge["accessType"]): GEdge {
  return { id: `${src}|ALLOWS_ACCESS_TO|${dst}`, src, dst, type: "ALLOWS_ACCESS_TO", accessType };
}
function doc(nodes: GNode[], edges: GEdge[]): GraphDoc {
  return { nodes, edges, syncedAt: "2026-08-14T00:00:00Z" };
}

describe("withHumanAccess — the two vocabularies", () => {
  const base = doc(
    [node("agent", "AI_AGENT"), node("u-bind", "USER_ACCOUNT"), node("u-eff", "USER_ACCOUNT")],
    [edge("u-bind", "agent", "ADMIN")],
  );

  it("keeps binding reach and effective reach in separate lists", () => {
    const out = withHumanAccess(base, {
      effectiveAccess: [{
        identityId: "u-eff", resourceId: "agent",
        accessTypes: ["DATA"], permissions: ["storage.objects.get"],
        policyIds: ["p1"], policyNames: ["reader"],
      }],
    });
    const access = out.nodes.find((n) => n.id === "agent")!.humanAccess!;
    // Never merged. `identityIds` means "holds a role granting access"; `effectiveIds` means
    // "Wiz computed that they can reach the data". A single list could be captioned neither.
    expect(access.identityIds).toEqual(["u-bind"]);
    expect(access.effectiveIds).toEqual(["u-eff"]);
    expect(access.permissionCount).toBe(1);
    expect(access.policyIds).toEqual(["p1"]);
  });

  it("counts an asset only effective access reaches", () => {
    // The point of running it: an entry here can name a pair the binding traversal missed.
    const out = withHumanAccess(
      doc([node("agent", "AI_AGENT"), node("u-eff", "USER_ACCOUNT")], []),
      {
        effectiveAccess: [{
          identityId: "u-eff", resourceId: "agent", accessTypes: ["DATA"],
          permissions: [], policyIds: [], policyNames: [],
        }],
      },
    );
    const access = out.nodes.find((n) => n.id === "agent")!.humanAccess!;
    expect(access.identityIds).toEqual([]);
    expect(access.effectiveIds).toEqual(["u-eff"]);
  });

  it("counts a person reached by BOTH routes once", () => {
    const findings: IdentityFindingRow[] = [{
      id: "f1", resourceId: "u-bind", ruleShortId: "IAM-159", severity: "HIGH",
      status: "OPEN", result: "FAIL", hygiene: "MFA",
    }];
    const out = withHumanAccess(base, {
      identityFindings: findings,
      effectiveAccess: [{
        identityId: "u-bind", resourceId: "agent", accessTypes: ["DATA"],
        permissions: [], policyIds: [], policyNames: [],
      }],
    });
    const access = out.nodes.find((n) => n.id === "agent")!.humanAccess!;
    // One person whose MFA is missing, not two.
    expect(access.noMfaCount).toBe(1);
  });

  it("ignores effective access to something that is not an AI asset", () => {
    const out = withHumanAccess(
      doc([node("bucket", "BUCKET"), node("u", "USER_ACCOUNT")], []),
      {
        effectiveAccess: [{
          identityId: "u", resourceId: "bucket", accessTypes: ["DATA"],
          permissions: [], policyIds: [], policyNames: [],
        }],
      },
    );
    expect(out.nodes.find((n) => n.id === "bucket")!.humanAccess).toBeUndefined();
  });
});

describe("withHumanAccess — identity hygiene", () => {
  const base = doc(
    [node("agent", "AI_AGENT"), node("u1", "USER_ACCOUNT"), node("u2", "USER_ACCOUNT")],
    [edge("u1", "agent", "ADMIN"), edge("u2", "agent", "ADMIN")],
  );
  const mfa = (resourceId: string, extra: Partial<IdentityFindingRow> = {}): IdentityFindingRow => ({
    id: "f-" + resourceId, resourceId, ruleShortId: "IAM-159", severity: "HIGH",
    status: "OPEN", result: "FAIL", hygiene: "MFA", ...extra,
  });

  it("counts the reachable identities carrying an open finding", () => {
    const out = withHumanAccess(base, { identityFindings: [mfa("u1")] });
    expect(out.nodes.find((n) => n.id === "agent")!.humanAccess!.noMfaCount).toBe(1);
  });

  it("ignores a finding on someone who cannot reach the asset", () => {
    // The intersection IS the feature. "How many people lack MFA" is an IAM question; this
    // register only answers it for the people who can reach an AI asset.
    const out = withHumanAccess(base, { identityFindings: [mfa("stranger")] });
    expect(out.nodes.find((n) => n.id === "agent")!.humanAccess!.noMfaCount).toBeUndefined();
  });

  it("ignores a finding that has been resolved", () => {
    const out = withHumanAccess(base, {
      identityFindings: [mfa("u1", { status: "RESOLVED", result: "PASS" })],
    });
    expect(out.nodes.find((n) => n.id === "agent")!.humanAccess!.noMfaCount).toBeUndefined();
  });

  it("keeps the dormancy FLAG and the dormancy FINDING in separate fields", () => {
    // Two routes to the same conclusion about one person — the identity's own
    // inactiveInLast90Days, and Wiz's IAM-235 rule. Summing them into one number would report
    // that person twice.
    const withFlag = doc(
      [node("agent", "AI_AGENT"), node("u1", "USER_ACCOUNT", { inactive: true })],
      [edge("u1", "agent", "ADMIN")],
    );
    const out = withHumanAccess(withFlag, {
      identityFindings: [mfa("u1", { hygiene: "DORMANT", ruleShortId: "IAM-235" })],
    });
    const access = out.nodes.find((n) => n.id === "agent")!.humanAccess!;
    expect(access.inactiveCount).toBe(1);
    expect(access.dormantFindingCount).toBe(1);
  });
});
