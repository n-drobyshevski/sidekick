// getGraph parameter resolution: depth clamping, list coercion, and seed
// resolution (asset / combo group / default all-combo-assets).

import { describe, expect, it } from "vitest";
import {
  graphCacheParams,
  resolveGraphParams,
  resolveLayoutParams,
  toList,
} from "../src/domain/graphApiParams";
import { SEED_ISSUES } from "../src/server/sampleData";

const CTX = { defaultDepth: 2, maxNodes: 120, issues: SEED_ISSUES };

describe("toList", () => {
  it("accepts arrays, comma strings, and garbage", () => {
    expect(toList(["a", "b"])).toEqual(["a", "b"]);
    expect(toList("a,b,,c")).toEqual(["a", "b", "c"]);
    expect(toList(undefined)).toEqual([]);
    expect(toList(42)).toEqual([]);
  });
});

describe("resolveGraphParams", () => {
  it("clamps depth into 1..3 and defaults from settings", () => {
    expect(resolveGraphParams({}, CTX).depth).toBe(2);
    expect(resolveGraphParams({ depth: 0 }, CTX).depth).toBe(1);
    expect(resolveGraphParams({ depth: 99 }, CTX).depth).toBe(3);
    expect(resolveGraphParams({ depth: "3" }, CTX).depth).toBe(3);
    expect(resolveGraphParams({ depth: "junk" }, CTX).depth).toBe(2);
    // "" means "use the configured default" (raw hash value), not depth 0.
    expect(resolveGraphParams({ depth: "" }, CTX).depth).toBe(2);
  });

  it("default seed = every asset participating in any toxic combination", () => {
    const opts = resolveGraphParams({}, CTX);
    expect(opts.seedIds).toContain("agent-a");
    expect(opts.seedIds).toContain("agent-h-chatbot");
    expect(opts.seedIds).toContain("role-finance-admin-01");
    expect(opts.seedIds).not.toContain("agent-l-support"); // no issues
    // Distinct: agent-autogen has 4 issues but appears once.
    expect(opts.seedIds.filter((id) => id === "agent-autogen")).toHaveLength(1);
  });

  it("combo seed resolves to that group's assets", () => {
    const opts = resolveGraphParams({ seed: "gcp-hosted-privileged", seedKind: "combo" }, CTX);
    expect(opts.seedIds.sort()).toEqual(["agent-h-chatbot", "agent-i"]);
    // A bare combo-group id works without seedKind too.
    const opts2 = resolveGraphParams({ seed: "bedrock-no-guardrail" }, CTX);
    expect(opts2.seedIds).toHaveLength(8);
  });

  it("asset seed passes through verbatim", () => {
    expect(resolveGraphParams({ seed: "agent-a" }, CTX).seedIds).toEqual(["agent-a"]);
  });

  it("filters only materialize when at least one is set", () => {
    expect(resolveGraphParams({}, CTX).filters).toBeUndefined();
    const opts = resolveGraphParams({ severities: "HIGH,CRITICAL", kinds: [] }, CTX);
    expect(opts.filters?.severities).toEqual(["HIGH", "CRITICAL"]);
  });

  it("expand + maxNodes clamp", () => {
    const opts = resolveGraphParams({ expand: "a,b", maxNodes: 9999 }, CTX);
    expect(opts.expandIds).toEqual(["a", "b"]);
    expect(opts.maxNodes).toBe(400); // clamped ceiling
  });
});

describe("graphCacheParams", () => {
  it("is a pure function of the raw request (no issues/settings inputs)", () => {
    const key = graphCacheParams({ seed: "agent-a", depth: "3", severities: "HIGH,CRITICAL" });
    expect(key["seed"]).toBe("agent-a");
    expect(key["depth"]).toBe("3");
    expect(key["view"]).toEqual({ mode: "lanes", groupBy: "combo", sort: "smart" });
  });

  it("sorts list params so either order shares one cache entry", () => {
    const a = graphCacheParams({ severities: "HIGH,CRITICAL", expand: ["b", "a"] });
    const b = graphCacheParams({ severities: "CRITICAL,HIGH", expand: ["a", "b"] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("treats empty and absent depth identically, distinct from explicit", () => {
    expect(graphCacheParams({ depth: "" })["depth"]).toBe(graphCacheParams({})["depth"]);
    expect(graphCacheParams({ depth: "2" })["depth"]).toBe("2");
  });

  it("differs when any request knob differs", () => {
    const base = JSON.stringify(graphCacheParams({}));
    expect(JSON.stringify(graphCacheParams({ layout: "grouped" }))).not.toBe(base);
    expect(JSON.stringify(graphCacheParams({ seed: "x" }))).not.toBe(base);
    expect(JSON.stringify(graphCacheParams({ kinds: "BUCKET" }))).not.toBe(base);
  });
});

describe("resolveLayoutParams", () => {
  it("defaults to lanes / combo / smart", () => {
    expect(resolveLayoutParams({})).toEqual({ mode: "lanes", groupBy: "combo", sort: "smart" });
  });

  it("whitelists known values and normalizes case", () => {
    expect(resolveLayoutParams({ layout: "grouped", groupBy: "project", sort: "aars" }))
      .toEqual({ mode: "grouped", groupBy: "project", sort: "aars" });
    expect(resolveLayoutParams({ layout: "GROUPED", groupBy: "Severity", sort: "NAME" }))
      .toEqual({ mode: "grouped", groupBy: "severity", sort: "name" });
  });

  it("garbage falls back to defaults", () => {
    expect(resolveLayoutParams({ layout: "spiral", groupBy: 42, sort: null }))
      .toEqual({ mode: "lanes", groupBy: "combo", sort: "smart" });
  });
});
