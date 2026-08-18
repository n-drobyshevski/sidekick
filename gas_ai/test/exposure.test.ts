// Network exposure: the two traversals, their normalizers, and the join that decides what
// counts as an exposure.
//
// The regression this file exists for is one line of the capture. In
// exemples/ai_exposure_host_response.js a Cloud Run revision is `accessibleFrom.internet:
// true`, `openToAllInternet: true`, ports 80 and 443 open to 0.0.0.0/0 — and BOTH endpoints
// it serves come back `exposureLevel_name: "Low"`, matched by the rule "2XX HTTP status
// codes with SSO authentication". Reachable, and not a validated exposure.
//
// Those endpoints arrive through the HOST query, which does not filter on exposure level.
// Anything that inferred "this row came back, so it is an exposure" would relabel them, and
// the number most likely to be read off this app would be wrong in the direction that
// matters. So the bar is applied to the payload, and this file pins that.

import { describe, expect, it } from "vitest";

import {
  endpointExposureSpec,
  hostExposureSpec,
  isRatedExposure,
  worseExposureLevel,
} from "../src/domain/exposureQuery";
import { toGraphEntityQuery } from "../src/domain/graphExpand";
import { withExposureEvidence, withInternetExposureNodes } from "../src/domain/graphEnrich";
import { conditionState } from "../src/domain/riskConditions";
import type { GEdge, GNode, GraphDoc } from "../src/domain/graphTypes";
import {
  normalizeEndpointExposurePage,
  normalizeHostExposurePage,
} from "../src/domain/syncNormalize";
import {
  endpointExposureVariables,
  hostExposureVariables,
  Q_AI_EXPOSURE,
} from "../src/server/wizQueriesAi";
import type { Rec } from "../src/domain/util";

const AI_TYPES = [
  "AI_AGENT", "AI_MODEL", "AI_GUARDRAIL", "AI_PIPELINE", "AI_DATASET", "MCP_SERVER",
];

// ------------------------------------------------------------------- the traversals

describe("exposure query specs", () => {
  it("renders the host traversal as the console sends it", () => {
    // Transcribed from exemples/ai_exposure_host_request.js. `as: "scoped_entity"` is the
    // console's own alias for the node in its UI and carries nothing over the wire, so it
    // is the one key deliberately absent.
    expect(toGraphEntityQuery(hostExposureSpec(AI_TYPES))).toEqual({
      type: AI_TYPES,
      select: true,
      relationships: [
        {
          type: [{ type: "RUNS", reverse: true }],
          with: {
            type: ["VIRTUAL_MACHINE", "SERVERLESS"],
            select: true,
            where: { "accessibleFrom.internet": { EQUALS: true } },
          },
        },
      ],
    });
  });

  it("renders the endpoint traversal as the console sends it", () => {
    expect(toGraphEntityQuery(endpointExposureSpec(AI_TYPES))).toEqual({
      type: AI_TYPES,
      select: true,
      relationships: [
        {
          type: [{ type: "SERVES" }],
          with: {
            type: ["ENDPOINT"],
            select: true,
            where: {
              exposureLevel_name: { EQUALS: ["High", "Medium"] },
              portValidationResult: { EQUALS: "Open" },
            },
          },
        },
      ],
    });
  });

  it("sends the capture's @include flags, and only those", () => {
    // The gates are what keep issueAnalytics and threatAnalytics off. Selecting them plainly
    // (this file's habit everywhere else) would add two issues() joins per path entity on the
    // widest selection set the app sends.
    for (const vars of [
      hostExposureVariables(AI_TYPES, null),
      endpointExposureVariables(AI_TYPES, null),
    ]) {
      expect(vars["fetchPublicExposurePaths"]).toBe(true);
      expect(vars["fetchLateralMovement"]).toBe(true);
      expect(vars["fetchCodeSource"]).toBe(true);
      expect(vars["fetchIssueAnalytics"]).toBe(false);
      expect(vars["fetchThreatAnalytics"]).toBe(false);
      expect(vars["fetchInternalExposurePaths"]).toBe(false);
      expect(vars["fetchKubernetes"]).toBe(false);
      expect(vars["fetchCost"]).toBe(false);
      expect(vars["fetchTotalCount"]).toBe(false);
    }
  });

  it("runs tenant-wide unless a project scope is configured", () => {
    expect(hostExposureVariables(AI_TYPES, null)["projectId"]).toBeNull();
    expect(hostExposureVariables(AI_TYPES, ["proj-1"])["projectId"]).toBe("proj-1");
  });

  it("declares $projectId nullable, unlike the console's String!", () => {
    // The one deliberate deviation from verbatim, and the same one Q_AGENT_EXPANSION makes:
    // the console sends it non-null because the operator had a project open.
    expect(Q_AI_EXPOSURE).toContain("$projectId: String,");
    expect(Q_AI_EXPOSURE).not.toContain("$projectId: String!");
  });

  it("keeps both named fragments the selection set spreads", () => {
    expect(Q_AI_EXPOSURE).toContain("fragment PathGraphEntityFragment on GraphEntity");
    expect(Q_AI_EXPOSURE).toContain("fragment NetworkExposureFragment on NetworkExposure");
  });
});

describe("isRatedExposure", () => {
  it("needs BOTH a validated port and a High/Medium rating", () => {
    expect(isRatedExposure("High", "Open")).toBe(true);
    expect(isRatedExposure("Medium", "Open")).toBe(true);
    // The capture's own endpoints: open, and rated Low because they redirect to SSO.
    expect(isRatedExposure("Low", "Open")).toBe(false);
    expect(isRatedExposure("High", "Closed")).toBe(false);
    expect(isRatedExposure(undefined, undefined)).toBe(false);
  });
});

describe("worseExposureLevel", () => {
  it("prefers High, and tolerates either side being absent", () => {
    expect(worseExposureLevel("Medium", "High")).toBe("High");
    expect(worseExposureLevel("High", "Medium")).toBe("High");
    expect(worseExposureLevel(undefined, "Medium")).toBe("Medium");
    expect(worseExposureLevel("High", undefined)).toBe("High");
  });
});

// -------------------------------------------------------------------- the normalizers

/** One entity in the console's shape: interface fields flat, everything else in the bag. */
function entity(id: string, type: string, properties: Rec = {}, extra: Rec = {}): Rec {
  return { providerUniqueId: null, id, name: id, type, properties, ...extra };
}

/** The capture's row, trimmed to the fields the normalizer reads. */
function hostRow(): Rec {
  return {
    entities: [
      entity("agent-7c4c", "AI_AGENT", {
        cloudPlatform: "GCP",
        region: "europe-west1",
        status: "Active",
        nativeType: "hostedAiAgent",
      }),
      entity(
        "revision-330a",
        "SERVERLESS",
        {
          "accessibleFrom.internet": true,
          openToAllInternet: true,
          cloudPlatform: "GCP",
          region: "europe-west1",
          status: "Active",
          validatedOpenPorts: [80, 443],
        },
        {
          publicExposures: {
            nodes: [
              {
                id: "exposure-443",
                portRange: "443",
                sourceIpRange: "0.0.0.0/0",
                destinationIpRange: "datacost-agent-beta.a.run.app",
                applicationEndpoints: [
                  entity("endpoint-443", "ENDPOINT", {
                    exposureLevel_name: "Low",
                    portValidationResult: "Open",
                    region: "europe-west1",
                  }),
                ],
              },
              {
                id: "exposure-80",
                portRange: "80",
                sourceIpRange: "0.0.0.0/0",
                destinationIpRange: "datacost-agent-beta.a.run.app",
                applicationEndpoints: [
                  entity("endpoint-80", "ENDPOINT", {
                    exposureLevel_name: "Low",
                    portValidationResult: "Open",
                  }),
                ],
              },
            ],
          },
          lateralMovementPaths: { nodes: [] },
          codeSourcePath: { totalCount: 0, nodes: null },
        },
      ),
    ],
  };
}

describe("normalizeHostExposurePage", () => {
  it("emits the asset, the host and the HOSTED_ON edge the traversal implies", () => {
    const part = normalizeHostExposurePage([hostRow()]);
    const ids = part.nodes.map((n) => n.id);
    expect(ids).toContain("agent-7c4c");
    expect(ids).toContain("revision-330a");
    expect(part.edges).toContainEqual(
      expect.objectContaining({ src: "agent-7c4c", dst: "revision-330a", type: "HOSTED_ON" }),
    );
  });

  it("reads the host's reachability out of the properties bag, not the filter", () => {
    const part = normalizeHostExposurePage([hostRow()]);
    const host = part.nodes.find((n) => n.id === "revision-330a");
    // `accessibleFrom.internet` / `openToAllInternet` — the two names Wiz uses on this root.
    expect(host?.isAccessibleFromInternet).toBe(true);
    expect(host?.isOpenToAllInternet).toBe(true);
  });

  it("puts the public-exposure ports and source ranges on the HOST", () => {
    const part = normalizeHostExposurePage([hostRow()]);
    const host = part.nodes.find((n) => n.id === "revision-330a");
    expect(host?.exposureEvidence?.ports).toEqual(["443", "80"]);
    // Deduped: both exposures came from the same range.
    expect(host?.exposureEvidence?.sourceIpRanges).toEqual(["0.0.0.0/0"]);
    // Never on the agent — the agent does not listen on those ports, the revision does.
    const agent = part.nodes.find((n) => n.id === "agent-7c4c");
    expect(agent?.exposureEvidence).toBeUndefined();
  });

  it("keeps the application endpoints with their OWN rating, unfiltered", () => {
    const part = normalizeHostExposurePage([hostRow()]);
    const endpoints = part.nodes.filter((n) => n.kind === "ENDPOINT");
    expect(endpoints).toHaveLength(2);
    // This is the whole point: they came back through a query that filtered on nothing, and
    // they are rated Low. Storing what Wiz said is what stops them counting later.
    for (const endpoint of endpoints) {
      expect(endpoint.exposureLevel).toBe("Low");
      expect(endpoint.portValidation).toBe("Open");
    }
    expect(part.edges).toContainEqual(
      expect.objectContaining({ src: "revision-330a", dst: "endpoint-443", type: "SERVES" }),
    );
  });

  it("normalizes no edges from the lateral-movement or code-source legs", () => {
    // Both are fetched (the console's own flags) and both land whole in the Drive page
    // archive. Turning them into edges is what is refused: a lateral-movement path is an
    // ordered list of hops with no declared relationship between them, and the only capture
    // returns an empty code-source path.
    const part = normalizeHostExposurePage([hostRow()]);
    for (const edge of part.edges) {
      expect(["HOSTED_ON", "SERVES"]).toContain(edge.type);
    }
  });

  it("survives a row with no host at all", () => {
    const part = normalizeHostExposurePage([{ entities: [entity("a", "AI_AGENT")] }]);
    expect(part.edges).toHaveLength(0);
  });
});

describe("normalizeEndpointExposurePage", () => {
  it("emits the asset, the endpoint and the SERVES edge", () => {
    const part = normalizeEndpointExposurePage([
      {
        entities: [
          entity("agent-x", "AI_AGENT"),
          entity("endpoint-x", "ENDPOINT", {
            exposureLevel_name: "High",
            portValidationResult: "Open",
          }),
        ],
      },
    ]);
    const endpoint = part.nodes.find((n) => n.id === "endpoint-x");
    expect(endpoint?.exposureLevel).toBe("High");
    expect(endpoint?.portValidation).toBe("Open");
    expect(part.edges).toContainEqual(
      expect.objectContaining({ src: "agent-x", dst: "endpoint-x", type: "SERVES" }),
    );
  });
});

// --------------------------------------------------------------------------- the join

function node(id: string, kind: GNode["kind"], extra: Partial<GNode> = {}): GNode {
  return { id, kind, name: id, ...extra };
}

function doc(nodes: GNode[], edges: GEdge[]): GraphDoc {
  return { nodes, edges, syncedAt: "2026-08-14T00:00:00Z" };
}

function edge(src: string, type: GEdge["type"], dst: string): GEdge {
  return { id: `${src}|${type}|${dst}`, src, dst, type };
}

describe("withExposureEvidence", () => {
  it("resolves a hosted asset from the compute underneath it", () => {
    const out = withExposureEvidence(doc(
      [
        // No flags of its own — the state every hosted AI asset is in, and the reason this
        // whole feature exists.
        node("agent", "AI_AGENT", { isAccessibleFromInternet: null, isOpenToAllInternet: null }),
        node("host", "SERVERLESS", { isAccessibleFromInternet: true }),
      ],
      [edge("agent", "HOSTED_ON", "host")],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    expect(agent?.exposureEvidence?.hostIds).toEqual(["host"]);
    expect(conditionState(agent!, "INTERNET_EXPOSURE")).toBe(true);
  });

  it("does NOT resolve one whose host is not itself reachable", () => {
    const out = withExposureEvidence(doc(
      [
        node("agent", "AI_AGENT", { isAccessibleFromInternet: null }),
        node("host", "VIRTUAL_MACHINE", { isAccessibleFromInternet: false }),
      ],
      [edge("agent", "HOSTED_ON", "host")],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    expect(agent?.exposureEvidence).toBeUndefined();
    // Still undetermined, which is the honest answer — not downgraded to "not exposed".
    expect(conditionState(agent!, "INTERNET_EXPOSURE")).toBeNull();
  });

  it("refuses a Low-rated endpoint, however open its port is", () => {
    // The capture's own shape, and the single most important assertion here.
    const out = withExposureEvidence(doc(
      [
        node("agent", "AI_AGENT", { isAccessibleFromInternet: null }),
        node("host", "SERVERLESS", { isAccessibleFromInternet: true }),
        node("ep", "ENDPOINT", { exposureLevel: "Low", portValidation: "Open" }),
      ],
      [edge("agent", "HOSTED_ON", "host"), edge("host", "SERVES", "ep")],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    // Reachable through the host, and NOT a validated exposure. Both facts, kept apart.
    expect(agent?.exposureEvidence?.hostIds).toEqual(["host"]);
    expect(agent?.exposureEvidence?.endpointIds).toBeUndefined();
  });

  it("accepts a validated endpoint reached through the host", () => {
    // The host query hangs applicationEndpoints off the WORKLOAD, never off the agent, so
    // the two-hop walk is the normal path rather than an edge case.
    const out = withExposureEvidence(doc(
      [
        node("agent", "AI_AGENT", { isAccessibleFromInternet: null }),
        node("host", "SERVERLESS", { isAccessibleFromInternet: true }),
        node("ep", "ENDPOINT", { exposureLevel: "High", portValidation: "Open" }),
      ],
      [edge("agent", "HOSTED_ON", "host"), edge("host", "SERVES", "ep")],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    expect(agent?.exposureEvidence?.endpointIds).toEqual(["ep"]);
    expect(agent?.exposureEvidence?.exposureLevel).toBe("High");
  });

  it("carries the host's ports and source ranges up to the asset", () => {
    const out = withExposureEvidence(doc(
      [
        node("agent", "AI_AGENT", { isAccessibleFromInternet: null }),
        node("host", "SERVERLESS", {
          isAccessibleFromInternet: true,
          exposureEvidence: { ports: ["443", "80"], sourceIpRanges: ["0.0.0.0/0"] },
        }),
      ],
      [edge("agent", "HOSTED_ON", "host")],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    expect(agent?.exposureEvidence?.ports).toEqual(["443", "80"]);
    expect(agent?.exposureEvidence?.sourceIpRanges).toEqual(["0.0.0.0/0"]);
  });

  it("keeps the worst level when several endpoints qualify", () => {
    const out = withExposureEvidence(doc(
      [
        node("agent", "AI_AGENT"),
        node("ep-med", "ENDPOINT", { exposureLevel: "Medium", portValidation: "Open" }),
        node("ep-high", "ENDPOINT", { exposureLevel: "High", portValidation: "Open" }),
      ],
      [edge("agent", "SERVES", "ep-med"), edge("agent", "SERVES", "ep-high")],
    ));
    const agent = out.nodes.find((n) => n.id === "agent");
    expect(agent?.exposureEvidence?.endpointIds).toEqual(["ep-med", "ep-high"]);
    expect(agent?.exposureEvidence?.exposureLevel).toBe("High");
  });

  it("leaves an untouched landscape byte-identical", () => {
    // An asset the steps never reached must score and render exactly as it did before they
    // existed — "never asked" is not "asked and found nothing".
    const before = doc([node("agent", "AI_AGENT", { isAccessibleFromInternet: false })], []);
    expect(withExposureEvidence(before)).toBe(before);
  });
});

describe("conditionState — INTERNET_EXPOSURE with evidence", () => {
  it("only ever upgrades: no evidence falls straight through to the flags", () => {
    expect(conditionState(node("a", "AI_AGENT", { isAccessibleFromInternet: false,
      isOpenToAllInternet: false }), "INTERNET_EXPOSURE")).toBe(false);
    expect(conditionState(node("a", "AI_AGENT", { isAccessibleFromInternet: null }),
      "INTERNET_EXPOSURE")).toBeNull();
    expect(conditionState(node("a", "AI_AGENT", { isOpenToAllInternet: true }),
      "INTERNET_EXPOSURE")).toBe(true);
  });

  it("an empty evidence record is not evidence", () => {
    // withExposureEvidence never writes one, but a hand-edited ledger cell can.
    expect(conditionState(
      node("a", "AI_AGENT", { isAccessibleFromInternet: null, exposureEvidence: {} }),
      "INTERNET_EXPOSURE",
    )).toBeNull();
    expect(conditionState(
      node("a", "AI_AGENT", { isAccessibleFromInternet: null, exposureEvidence: { hostIds: [] } }),
      "INTERNET_EXPOSURE",
    )).toBeNull();
  });
});

describe("withInternetExposureNodes", () => {
  it("names which evidence drew the stub", () => {
    const out = withInternetExposureNodes(doc(
      [
        node("a", "AI_AGENT", { exposureEvidence: { endpointIds: ["ep"] } }),
        node("b", "AI_AGENT", { exposureEvidence: { hostIds: ["h"] } }),
        node("c", "AI_AGENT", { isOpenToAllInternet: true }),
      ],
      [],
    ));
    const nameOf = (id: string) =>
      out.nodes.find((n) => n.kind === "INTERNET_EXPOSURE" && n.id === `internet|${id}`)?.name;
    expect(nameOf("a")).toBe("Internet exposure · validated endpoint");
    expect(nameOf("b")).toBe("Internet exposure · exposed host");
    expect(nameOf("c")).toBe("Internet exposure");
  });
});
