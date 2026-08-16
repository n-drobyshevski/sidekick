// The durable layer under resolveAiResourceTypes.
//
// CacheService is evictable — 6 h ceiling, 1,000-item FIFO — and every eviction used to cost
// a fresh resolution: 1 POST where introspection is allowed, up to 14 `first: 1` probes where
// it is not. The Script Property makes that eviction free for a week.
//
// The gate that matters is `!log`: wizDiagnostic passes a logger precisely to see what the
// tenant says now, so neither stored layer may answer it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.UrlFetchApp;

interface Harness {
  posts: string[];
  props: Record<string, string>;
  cache: Record<string, string>;
}

/**
 * @param introspects whether the tenant serves __type introspection; when false every
 *   candidate is probed one by one and only AI_AGENT is accepted.
 * @param acceptAnything models a gateway that does NOT reject unknown enum values — the
 *   case the negative control exists to catch, where the probe stops being a measurement.
 */
function stubWiz(introspects: boolean, acceptAnything = false): Harness {
  const h: Harness = { posts: [], props: {}, cache: {} };
  (globalThis as Record<string, unknown>).PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k: string) =>
        h.props[k] ??
        ({
          WIZ_API_URL: "https://api.test/graphql",
          WIZ_CLIENT_ID: "id",
          WIZ_CLIENT_SECRET: "secret",
        } as Record<string, string>)[k] ??
        null,
      setProperty: (k: string, v: string) => {
        h.props[k] = v;
      },
      deleteProperty: (k: string) => {
        delete h.props[k];
      },
    }),
  };
  (globalThis as Record<string, unknown>).CacheService = {
    getScriptCache: () => ({
      get: (k: string) => (k === "wiz_ai_token" ? "test-token" : h.cache[k] ?? null),
      put: (k: string, v: string) => {
        h.cache[k] = v;
      },
    }),
  };
  (globalThis as Record<string, unknown>).Utilities = { sleep: () => undefined };
  (globalThis as Record<string, unknown>).UrlFetchApp = {
    fetch: (_url: string, opts: { payload: string }) => {
      const sent = JSON.parse(opts.payload) as { query: string; variables: Record<string, unknown> };
      h.posts.push(sent.query);
      if (/SidekickEnumProbe/.test(sent.query)) {
        return {
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify(
              introspects
                ? { data: { __type: { enumValues: [{ name: "AI_AGENT" }, { name: "AI_MODEL" }, { name: "BUCKET" }] } } }
                : { data: { __type: null } },
            ),
        };
      }
      // A candidate probe. Only AI_AGENT exists in this tenant; the rest are rejected in
      // the HTTP-200 errors-only form.
      // Quoted, so AI_AGENT_REGISTRY does not read as AI_AGENT.
      const types = JSON.stringify(sent.variables["filterBy"] ?? {});
      const ok = acceptAnything || /"AI_AGENT"/.test(types);
      return {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify(
            ok
              ? { data: { cloudResourcesV2: { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 0 } } }
              : { errors: [{ message: "failed to parse object type [X]" }] },
          ),
      };
    },
  };
  return h;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  (globalThis as Record<string, unknown>).UrlFetchApp = ORIGINAL_FETCH;
  vi.resetModules();
});

describe("resolveAiResourceTypes durability", () => {
  it("writes the resolution to a Script Property, and answers from it after a cache eviction", async () => {
    const h = stubWiz(true);
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");

    expect(resolveAiResourceTypes().types).toEqual(["AI_AGENT", "AI_MODEL"]);
    expect(h.posts).toHaveLength(1);
    expect(h.props["WIZ_AI_RESOURCE_TYPES_RESOLVED"]).toBeTruthy();

    // The whole point: CacheService drops the entry and nothing goes back to Wiz.
    h.cache = {};
    expect(resolveAiResourceTypes().types).toEqual(["AI_AGENT", "AI_MODEL"]);
    expect(h.posts).toHaveLength(1);
    // ...and the hot layer is re-warmed, so the next read does not even touch Properties.
    expect(h.cache["wiz_ai_resource_types_v2"]).toBeTruthy();
  });

  it("saves the expensive path: probing 14 candidates once, not once per eviction", async () => {
    const h = stubWiz(false);
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    const { AI_RESOURCE_TYPE_CANDIDATES } = await import("../src/server/wizQueriesAi");

    expect(resolveAiResourceTypes().types).toEqual(["AI_AGENT"]);
    // One failed introspection + the negative control + one probe per candidate. Before the
    // narrowed size-fallback each rejected candidate cost two, so this also pins that fix.
    expect(h.posts).toHaveLength(2 + AI_RESOURCE_TYPE_CANDIDATES.length);

    h.cache = {};
    const before = h.posts.length;
    expect(resolveAiResourceTypes().types).toEqual(["AI_AGENT"]);
    expect(h.posts).toHaveLength(before);
  });

  it("runs a negative control before trusting the probe at all", async () => {
    const h = stubWiz(false);
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    const lines: string[] = [];
    const got = resolveAiResourceTypes((m) => lines.push(m));
    // The sentinel is rejected, so the oracle discriminates and the answer is a measurement.
    expect(got.source).toBe("probe");
    expect(lines.join("\n")).not.toMatch(/negative control/);
  });

  it("says so when the gateway accepts anything, instead of reporting a guess as a list", async () => {
    // A gateway that never rejects an unknown type makes every candidate read as accepted —
    // indistinguishable, in the log, from a tenant that genuinely carries all fourteen.
    const h = stubWiz(false, true);
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    const { AI_RESOURCE_TYPE_CANDIDATES } = await import("../src/server/wizQueriesAi");
    const lines: string[] = [];
    const got = resolveAiResourceTypes((m) => lines.push(m));

    expect(lines.join("\n")).toMatch(/negative control .* was ACCEPTED/);
    expect(lines.join("\n")).toMatch(/WIZ_AI_RESOURCE_TYPES/);
    expect(got.source).toBe("probe (unverified)");
    // The list is still used — breaking a running sync over a diagnostic finding would be
    // the worse trade — it is just no longer presented as a measurement.
    expect(got.types).toEqual([...AI_RESOURCE_TYPE_CANDIDATES]);
    expect(h.posts.length).toBeGreaterThan(0);
  });

  it("expires after the 7-day window rather than pinning a stale schema forever", async () => {
    const h = stubWiz(true);
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    resolveAiResourceTypes();
    const stored = JSON.parse(h.props["WIZ_AI_RESOURCE_TYPES_RESOLVED"]) as { resolvedAt: number };
    h.props["WIZ_AI_RESOURCE_TYPES_RESOLVED"] = JSON.stringify({
      ...stored,
      resolvedAt: stored.resolvedAt - 8 * 86_400_000,
    });
    h.cache = {};
    const before = h.posts.length;
    resolveAiResourceTypes();
    expect(h.posts.length).toBeGreaterThan(before);
  });

  it("does NOT answer the diagnostic — a logger bypasses both stored layers", async () => {
    const h = stubWiz(true);
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    resolveAiResourceTypes();
    const before = h.posts.length;
    const lines: string[] = [];
    resolveAiResourceTypes((m) => lines.push(m));
    // It went back to the tenant, which is the diagnostic's entire contract.
    expect(h.posts.length).toBeGreaterThan(before);
    expect(lines.join("\n")).toMatch(/CloudResourceTypeFilter has 3 members/);
  });

  it("the operator override still wins over both stored layers", async () => {
    const h = stubWiz(true);
    h.props["WIZ_AI_RESOURCE_TYPES"] = "AI_TOOL, MCP_SERVER";
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    const got = resolveAiResourceTypes();
    expect(got.types).toEqual(["AI_TOOL", "MCP_SERVER"]);
    expect(got.source).toBe("override");
    expect(h.posts).toHaveLength(0);
  });

  it("ignores a corrupt stored value instead of failing on it", async () => {
    const h = stubWiz(true);
    h.props["WIZ_AI_RESOURCE_TYPES_RESOLVED"] = "{not json";
    const { resolveAiResourceTypes } = await import("../src/server/wizClientAi");
    expect(resolveAiResourceTypes().types).toEqual(["AI_AGENT", "AI_MODEL"]);
  });
});
