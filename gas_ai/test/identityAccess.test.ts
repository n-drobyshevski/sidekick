// Human identity access: the widened traversal, the identity facts Wiz already returned, and
// the join that finally totals reach.
//
// The Wiz Scans page declared this area `partial` with the note "access paths are synced and
// drawn, but nothing totals them. MFA and inactivity signals on those accounts are not
// collected at all — no query selects them and no column stores them."
//
// Half of that was a missing KPI and half of it was wrong: the capture in
// exemples/agentic_identities_response.js returns `inactiveInLast90Days`, `inactiveTimeframe`
// and the real `identityPurpose` — in `graphEntity.properties`, one level below the flat
// fields the query asked for. This file pins both halves, plus the two ways the total could
// have been quietly wrong.

import { describe, expect, it } from "vitest";

import {
  BOUND_IDENTITY_KINDS,
  HUMAN_ACCESS_TYPES,
  identityAccessSpec,
  normalizeAccessType,
  normalizeIdentityPurpose,
} from "../src/domain/identityQuery";
import { toGraphEntityQuery } from "../src/domain/graphExpand";
import { withHumanAccess, withIdentityAccessNodes } from "../src/domain/graphEnrich";
import { entityField, type GEdge, type GNode, type GraphDoc } from "../src/domain/graphTypes";
import {
  normalizeCloudResource,
  normalizeIdentityAccessPage,
  normalizePrincipalsPage,
} from "../src/domain/syncNormalize";
import { identityAccessVariables, Q_IDENTITY_ACCESS, Q_PRINCIPALS } from "../src/server/wizQueriesAi";
import type { Rec } from "../src/domain/util";

const AI_TYPES = ["AI_AGENT", "AI_MODEL", "MCP_SERVER"];

describe("identityAccessSpec", () => {
  it("roots at the tenant-resolved AI types, not the literal AI_AGENT", () => {
    // The narrowing this replaced: a model carrying an admin binding, or an MCP server a
    // contractor could reach, was never collected and nothing said so.
    expect(toGraphEntityQuery(identityAccessSpec(AI_TYPES))).toEqual({
      type: AI_TYPES,
      select: true,
      relationships: [
        {
          type: [{ type: "ALLOWS_ACCESS_TO", reverse: true }],
          // The binding is the mechanism; the two things worth having are at its ends, so it
          // takes no slot in the response's positional entities array.
          with: {
            type: ["ACCESS_ROLE_BINDING"],
            relationships: [
              {
                type: [{ type: "BOUND_TO" }],
                with: { type: [...BOUND_IDENTITY_KINDS], select: true },
              },
              {
                type: [{ type: "PERMITS_ACCESS_ROLE" }],
                with: {
                  type: ["ACCESS_ROLE"],
                  select: true,
                  where: { accessType: { EQUALS: ["ADMIN", "HIGH_PRIVILEGE"] } },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("takes its traversal as a variable, so no resolved type reaches GraphQL source", () => {
    expect(Q_IDENTITY_ACCESS).toContain("$query: GraphEntityQueryInput");
    expect(Q_IDENTITY_ACCESS).toContain("query: $query");
    expect(Q_IDENTITY_ACCESS).not.toContain("AI_AGENT");
    expect(Q_IDENTITY_ACCESS).not.toContain("ALLOWS_ACCESS_TO");
    const vars = identityAccessVariables(AI_TYPES, null);
    expect(vars["projectId"]).toBeNull();
    expect(identityAccessVariables(AI_TYPES, ["p1"])["projectId"]).toBe("p1");
  });
});

describe("the identity vocabulary Wiz actually returns", () => {
  it("strips the IdentityPurpose prefix the response uses but the filter does not", () => {
    // The capture returns `IdentityPurposeAgentic`; the filter takes `AGENTIC`. Same shape as
    // DataFindingSeverityCritical.
    expect(normalizeIdentityPurpose("IdentityPurposeAgentic")).toBe("AGENTIC");
    expect(normalizeIdentityPurpose("AGENTIC")).toBe("AGENTIC");
    expect(normalizeIdentityPurpose("")).toBeUndefined();
    expect(normalizeIdentityPurpose(null)).toBeUndefined();
  });

  it("accepts only the access levels the traversal asks for", () => {
    expect(normalizeAccessType("ADMIN")).toBe("ADMIN");
    expect(normalizeAccessType("High Privilege")).toBe("HIGH_PRIVILEGE");
    // Undefined is what makes the normalizer's fallback safe rather than a silent downgrade.
    expect(normalizeAccessType("READ")).toBeUndefined();
    expect(normalizeAccessType(undefined)).toBeUndefined();
  });
});

describe("entityField across all three roots", () => {
  it("reads the bag under graphEntity, where a cloudResourcesV2 identity keeps it", () => {
    // The reason inactivity looked uncollectable: the flat fields are on the node, the
    // identity facts are one level down. Transcribed from the capture.
    const row: Rec = {
      id: "sa-1",
      type: "SERVICE_ACCOUNT",
      hasHighPrivileges: true,
      graphEntity: {
        id: "sa-1",
        properties: {
          identityPurpose: "IdentityPurposeAgentic",
          inactiveInLast90Days: false,
          inactiveTimeframe: "Active",
          userDirectory: "GCP",
        },
      },
    };
    expect(entityField(row, "inactiveInLast90Days")).toBe(false);
    expect(entityField(row, "identityPurpose")).toBe("IdentityPurposeAgentic");
    // Flat still wins, so nothing that worked before changes.
    expect(entityField(row, "hasHighPrivileges")).toBe(true);
  });

  it("still reads a graphSearch entity's flat properties bag", () => {
    expect(entityField({ id: "x", properties: { region: "eu" } }, "region")).toBe("eu");
  });

  it("Q_PRINCIPALS selects that bag — the one field the whole area was missing", () => {
    expect(Q_PRINCIPALS).toContain("graphEntity { properties }");
  });
});

describe("normalizeCloudResource — identity facts", () => {
  const row: Rec = {
    id: "sa-1",
    name: "vertex-agent-sa",
    type: "SERVICE_ACCOUNT",
    graphEntity: {
      properties: {
        identityPurpose: "IdentityPurposeAgentic",
        inactiveInLast90Days: true,
        inactiveTimeframe: "Inactive90Days",
      },
    },
  };

  it("reads dormancy and the real purpose out of the nested bag", () => {
    const node = normalizeCloudResource(row)!;
    expect(node.identityPurpose).toBe("AGENTIC");
    expect(node.inactive).toBe(true);
    expect(node.inactiveTimeframe).toBe("Inactive90Days");
  });

  it("leaves dormancy UNSET when the tenant reported none", () => {
    // Not false. "Never asked" and "in use" are different answers, and the KPI only counts
    // what was actually reported.
    const node = normalizeCloudResource({ id: "sa-2", type: "SERVICE_ACCOUNT" })!;
    expect(node.inactive).toBeUndefined();
    expect(node.inactiveTimeframe).toBeUndefined();
  });
});

describe("normalizePrincipalsPage", () => {
  it("uses the identity's own purpose when the response carries it", () => {
    const part = normalizePrincipalsPage([
      { id: "sa-1", type: "SERVICE_ACCOUNT",
        graphEntity: { properties: { identityPurpose: "IdentityPurposeAgentic" } } },
    ]);
    expect(part.nodes[0].identityPurpose).toBe("AGENTIC");
  });

  it("still stamps AGENTIC when it does not — the fallback the lock exists for", () => {
    const part = normalizePrincipalsPage([{ id: "sa-2", type: "SERVICE_ACCOUNT" }]);
    expect(part.nodes[0].identityPurpose).toBe("AGENTIC");
  });
});

describe("normalizeIdentityAccessPage", () => {
  const row = (assetType: string, accessType?: string): Rec => ({
    entities: [
      { id: "asset-1", name: "asset-1", type: assetType },
      { id: "user-1", name: "ops@example.com", type: "USER_ACCOUNT" },
      { id: "role-1", name: "admin-role", type: "ACCESS_ROLE",
        properties: accessType ? { accessType } : {} },
    ],
  });

  it("binds access to any AI asset kind, not only agents", () => {
    const part = normalizeIdentityAccessPage([row("AI_MODEL", "ADMIN")]);
    expect(part.edges).toContainEqual(
      expect.objectContaining({ src: "user-1", dst: "asset-1", type: "ALLOWS_ACCESS_TO" }),
    );
  });

  it("reads the role's real access level rather than stamping the filter's", () => {
    const admin = normalizeIdentityAccessPage([row("AI_AGENT", "ADMIN")]);
    expect(admin.edges[0].accessType).toBe("ADMIN");
    const high = normalizeIdentityAccessPage([row("AI_AGENT", "HIGH_PRIVILEGE")]);
    expect(high.edges[0].accessType).toBe("HIGH_PRIVILEGE");
  });

  it("falls back to HIGH_PRIVILEGE when the bag carries no level", () => {
    // Exactly the old behaviour, so a tenant that does not return accessType sees no change.
    expect(normalizeIdentityAccessPage([row("AI_AGENT")])[
      "edges"
    ][0].accessType).toBe("HIGH_PRIVILEGE");
  });
});

// ---------------------------------------------------------------------- the total

function node(id: string, kind: GNode["kind"], extra: Partial<GNode> = {}): GNode {
  return { id, kind, name: id, ...extra };
}
function edge(src: string, dst: string, accessType?: GEdge["accessType"]): GEdge {
  return { id: `${src}|ALLOWS_ACCESS_TO|${dst}`, src, dst, type: "ALLOWS_ACCESS_TO", accessType };
}
function doc(nodes: GNode[], edges: GEdge[]): GraphDoc {
  return { nodes, edges, syncedAt: "2026-08-14T00:00:00Z" };
}

describe("withHumanAccess", () => {
  it("counts admin and high-privilege reach, and nothing else", () => {
    const out = withHumanAccess(doc(
      [
        node("agent", "AI_AGENT"),
        node("u-admin", "USER_ACCOUNT"),
        node("u-high", "USER_ACCOUNT"),
        node("u-read", "USER_ACCOUNT"),
      ],
      [
        edge("u-admin", "agent", "ADMIN"),
        edge("u-high", "agent", "HIGH_PRIVILEGE"),
        // A read-only grant is real and is not what this figure is about. The traversal never
        // returns one from a live tenant; the seed carries ten so this stays tested.
        edge("u-read", "agent", "READ"),
      ],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    expect(agent?.humanAccess?.identityIds).toEqual(["u-admin", "u-high"]);
    expect(agent?.humanAccess?.admin).toBe(true);
  });

  it("ignores a service account reaching the asset it runs for", () => {
    // An agent's own execution identity reaching it is normal operation, not a finding — the
    // same rule withIdentityAccessNodes applies when it decides whether to draw a stub.
    const out = withHumanAccess(doc(
      [node("agent", "AI_AGENT"), node("sa", "SERVICE_ACCOUNT")],
      [edge("sa", "agent", "ADMIN")],
    ));
    expect(out.nodes.find((n) => n.id === "agent")?.humanAccess).toBeUndefined();
  });

  it("counts reach from the EDGES, not from the stubs the graph draws", () => {
    // THE regression. withIdentityAccessNodes suppresses an asset that already carries a real
    // EXCESSIVE_ACCESS_FINDING so one problem is not drawn twice — right for a picture, and
    // silently wrong for a number. An asset with a CIEM finding on it draws no stub and must
    // still be counted as reachable.
    const base = doc(
      [
        node("agent", "AI_AGENT"),
        node("u1", "USER_ACCOUNT"),
        node("ciem", "EXCESSIVE_ACCESS_FINDING"),
      ],
      [
        edge("u1", "agent", "ADMIN"),
        { id: "agent|HAS_FINDING|ciem", src: "agent", dst: "ciem", type: "HAS_FINDING" },
      ],
    );
    const drawn = withIdentityAccessNodes(base);
    expect(drawn.nodes.some((n) => n.kind === "IDENTITY_ACCESS_FINDING")).toBe(false);

    const totalled = withHumanAccess(base);
    expect(totalled.nodes.find((n) => n.id === "agent")?.humanAccess?.identityIds).toEqual(["u1"]);
  });

  it("counts only the identities the tenant actually reported dormant", () => {
    const out = withHumanAccess(doc(
      [
        node("agent", "AI_AGENT"),
        node("u-dormant", "USER_ACCOUNT", { inactive: true }),
        node("u-active", "USER_ACCOUNT", { inactive: false }),
        node("u-unknown", "USER_ACCOUNT"),
      ],
      [
        edge("u-dormant", "agent", "ADMIN"),
        edge("u-active", "agent", "ADMIN"),
        edge("u-unknown", "agent", "ADMIN"),
      ],
    ));
    const access = out.nodes.find((n) => n.id === "agent")?.humanAccess;
    expect(access?.identityIds).toHaveLength(3);
    // One, not two: an identity the tenant said nothing about is unknown, not dormant.
    expect(access?.inactiveCount).toBe(1);
  });

  it("leaves an estate with no human bindings byte-identical", () => {
    const before = doc([node("agent", "AI_AGENT"), node("sa", "SERVICE_ACCOUNT")], []);
    expect(withHumanAccess(before)).toBe(before);
  });

  it("marks high-privilege-only reach without claiming admin", () => {
    const out = withHumanAccess(doc(
      [node("agent", "AI_AGENT"), node("u1", "USER_ACCOUNT")],
      [edge("u1", "agent", "HIGH_PRIVILEGE")],
    ));
    const access = out.nodes.find((n) => n.id === "agent")?.humanAccess;
    expect(access?.identityIds).toEqual(["u1"]);
    expect(access?.admin).toBeUndefined();
  });
});

describe("HUMAN_ACCESS_TYPES", () => {
  it("is the one list the query, the total and the drawn stub all read", () => {
    expect([...HUMAN_ACCESS_TYPES]).toEqual(["ADMIN", "HIGH_PRIVILEGE"]);
  });
});
