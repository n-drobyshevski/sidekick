// Tags survive from every root Wiz sends them on — and `Wiz/Domain` in particular.
//
// This is a regression file with a specific defect behind it. `normalizeCloudResource` used
// to read `raw["tags"]` directly and guard on `Array.isArray`, making tags the ONE fact in
// that function that never consulted the properties bag. Since the bag is where a
// graphSearch entity keeps everything, every node reached by a traversal — buckets,
// databases, service accounts, hosts, endpoints — arrived with no tags at all. And since
// the bag spells tags as an object map rather than an array, even a reader that found it
// would have rejected the shape.
//
// The combination is why every `Wiz/Domain` value in the committed captures was discarded
// while the inventory's own assets looked fine: the flat root does send an array, so the
// one root that worked was the one anybody would have checked.
//
// Rows are transcribed from the captures named in each case, the way
// test/riskIssuesCapture.test.ts and test/syncNormalize.test.ts inline theirs — the
// exemples/*.js files are raw captures, not modules.

import { describe, expect, it } from "vitest";
import { entityTags, tagPairs } from "../src/domain/graphTypes";
import {
  mergeParts,
  normalizeCloudResource,
  normalizeHostExposurePage,
  normalizeInventoryPage,
  normalizeSensitiveDataAccessPage,
} from "../src/domain/syncNormalize";
import type { Rec } from "../src/domain/util";

/** The tag value for a key, or null — what the domain fold will ask for. */
function tag(node: { tags?: Array<{ key: string; value: string }> } | null, key: string) {
  return node?.tags?.find((t) => t.key === key)?.value ?? null;
}

describe("tagPairs", () => {
  it("reads the flat array shape — exemples/get_ai_agents_reponse.js:4517", () => {
    expect(tagPairs([{ key: "goog-terraform-provisioned", value: "true" }])).toEqual([
      { key: "goog-terraform-provisioned", value: "true" },
    ]);
  });

  it("reads the object-map shape — exemples/ai_agent_expand_response.js:316", () => {
    expect(tagPairs({ "Wiz/Domain": "CROSS" })).toEqual([{ key: "Wiz/Domain", value: "CROSS" }]);
  });

  it("keeps a tag whose value is empty, which is not the same as an absent tag", () => {
    expect(tagPairs({ "Wiz/Domain": "" })).toEqual([{ key: "Wiz/Domain", value: "" }]);
  });

  it("coerces a non-string tag value rather than dropping it", () => {
    expect(tagPairs({ managed: true, replicas: 3 })).toEqual([
      { key: "managed", value: "true" },
      { key: "replicas", value: "3" },
    ]);
  });

  it("drops entries with no key, in either shape", () => {
    expect(tagPairs([{ key: "", value: "x" }, { value: "y" }])).toBeUndefined();
    expect(tagPairs({ "   ": "x" })).toBeUndefined();
  });

  // THE SUBTLEST ONE IN THE FILE. mergeParts copies any value that is not
  // undefined/null/false, and `[]` is truthy — so a normalizer answering `[]` for "this row
  // carried no tags" would ERASE the tags an earlier step had already established on the
  // same node. Absent has to stay absent all the way to the merge.
  it("answers undefined, never [], when there is nothing — mergeParts would treat [] as a value", () => {
    expect(tagPairs(null)).toBeUndefined();
    expect(tagPairs(undefined)).toBeUndefined();
    expect(tagPairs([])).toBeUndefined();
    expect(tagPairs({})).toBeUndefined();
    expect(tagPairs("Wiz/Domain=CROSS")).toBeUndefined();
  });
});

describe("entityTags", () => {
  // The reason entityTags exists instead of a call to entityField: entityField returns the
  // flat value as soon as it is not `undefined`, and the real inventory capture sends flat
  // `"tags": null` on 39 of its 40 nodes — exactly the nodes whose bag carries Wiz/Domain.
  it("falls through an explicit flat null into the bag", () => {
    expect(entityTags({ tags: null, graphEntity: { properties: { tags: { "Wiz/Domain": "SAP" } } } }))
      .toEqual([{ key: "Wiz/Domain", value: "SAP" }]);
  });

  it("reads a graphSearch entity's own properties bag", () => {
    expect(entityTags({ properties: { tags: { "Wiz/Domain": "CROSS" } } }))
      .toEqual([{ key: "Wiz/Domain", value: "CROSS" }]);
  });

  it("unions both sources, the bag winning a collision, because the bag is the richer one", () => {
    const tags = entityTags({
      tags: [{ key: "env", value: "prod" }, { key: "team", value: "ml" }],
      graphEntity: { properties: { tags: { team: "search", "Wiz/Domain": "CROSS" } } },
    });
    expect(tags).toEqual([
      { key: "env", value: "prod" },
      { key: "team", value: "search" },
      { key: "Wiz/Domain", value: "CROSS" },
    ]);
  });

  it("answers undefined for an entity with no tags anywhere", () => {
    expect(entityTags({ id: "x", properties: { region: "europe-west1" } })).toBeUndefined();
    expect(entityTags({} as Rec)).toBeUndefined();
  });
});

describe("Wiz/Domain survives the normalizers", () => {
  // exemples/ai_agent_expand_response.js:305-320 — a GEBucket reached by the data-exposure
  // traversal. Nothing but graphSearch ever returns this resource, so before the fix its
  // domain was unreachable by any code path.
  const BUCKET: Rec = {
    id: "bucket-1",
    name: "example-ai-a1b2-agent-staging",
    type: "BUCKET",
    properties: {
      cloudPlatform: "GCP",
      region: "europe-west1",
      status: "Active",
      subscriptionExternalId: "example-ai-a1b2",
      providerUniqueId: "https://www.googleapis.com/storage/v1/b/example-ai-a1b2-agent-staging",
      hasSensitiveData: true,
      tags: { "Wiz/Domain": "CROSS" },
    },
  };

  // exemples/ai_exposure_host_response.js:80-98 — a hosted AI agent, reached by the
  // host-exposure traversal rather than by the inventory.
  const HOSTED_AGENT: Rec = {
    id: "agent-1",
    name: "datacost_agent",
    type: "AI_AGENT",
    properties: {
      nativeType: "hostedAiAgent",
      cloudPlatform: "GCP",
      region: "europe-west1",
      status: "Active",
      subscriptionExternalId: "example-proj",
      tags: { "Wiz/Domain": "EXAMPLE DOMAIN" },
    },
  };

  it("keeps a bucket's Wiz/Domain through the sensitive-data traversal", () => {
    const part = normalizeSensitiveDataAccessPage([{ entities: [BUCKET] }]);
    const bucket = part.nodes.find((n) => n.id === "bucket-1") ?? null;
    expect(bucket).not.toBeNull();
    expect(tag(bucket, "Wiz/Domain")).toBe("CROSS");
  });

  it("keeps a hosted agent's Wiz/Domain through the host-exposure traversal", () => {
    const part = normalizeHostExposurePage([{ entities: [HOSTED_AGENT] }]);
    const agent = part.nodes.find((n) => n.id === "agent-1") ?? null;
    expect(tag(agent, "Wiz/Domain")).toBe("EXAMPLE DOMAIN");
  });

  it("keeps the flat inventory array — the one root that already worked", () => {
    const part = normalizeInventoryPage([{
      id: "agent-2",
      name: "loggy-agent",
      type: "AI_AGENT",
      tags: [{ key: "goog-terraform-provisioned", value: "true" }],
    }]);
    expect(tag(part.nodes[0], "goog-terraform-provisioned")).toBe("true");
  });

  // The AI_ASSET_PROPERTIES step reuses normalizeInventoryPage over a cloudResourcesV2 root
  // that also selects `graphEntity { properties }`. For an AI asset that is the ONLY way
  // Wiz/Domain arrives — the flat array does not carry it in any capture.
  it("reads Wiz/Domain off graphEntity.properties on the cloudResourcesV2 root", () => {
    const node = normalizeCloudResource({
      id: "agent-3",
      name: "gemini-cli",
      type: "AI_AGENT",
      tags: null,
      graphEntity: { properties: { tags: { "Wiz/Domain": "SAP" } } },
    });
    expect(tag(node, "Wiz/Domain")).toBe("SAP");
  });

  // mergeParts merges field-wise on any truthy value, and the traversals run after the
  // inventory. A step that saw the same node without tags must not blank the ones the
  // inventory established — which is the whole reason tagPairs answers undefined for empty.
  it("a later tagless step cannot erase tags an earlier step established", () => {
    const withTags = normalizeInventoryPage([{
      id: "agent-4", name: "a", type: "AI_AGENT", tags: [{ key: "env", value: "prod" }],
    }]);
    const withoutTags = normalizeHostExposurePage([{
      entities: [{ id: "agent-4", name: "a", type: "AI_AGENT", properties: { region: "eu" } }],
    }]);
    const merged = mergeParts([withTags, withoutTags], "2026-08-24T00:00:00Z");
    const agent = merged.doc.nodes.find((n) => n.id === "agent-4") ?? null;
    expect(tag(agent, "env")).toBe("prod");
  });
});
