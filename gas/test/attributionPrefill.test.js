// Client-side prefill handoff for the Attribution "Attribute…" action. Plain .js
// on purpose, same rationale as domainsImport.test.js: the module under test is
// client JS, tsconfig has no allowJs, and vitest picks up .test.js regardless.

import { describe, expect, it } from "vitest";
import {
  PREFILL_KEY,
  buildPrefillRule,
  decodePrefill,
  encodePrefill,
  escapeRegex,
} from "../src/client/js/attributionPrefill.js";

describe("PREFILL_KEY", () => {
  it("is a stable, namespaced sessionStorage key", () => {
    expect(PREFILL_KEY).toBe("wsk-attribution-prefill");
  });
});

describe("escapeRegex", () => {
  it("escapes every JS regex metacharacter", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\",
    );
  });

  it("leaves ordinary characters untouched", () => {
    expect(escapeRegex("web-01")).toBe("web-01");
  });
});

describe("buildPrefillRule", () => {
  it("prefers a subscription condition when subscription is present", () => {
    const rule = buildPrefillRule({ asset: "web-01", subscription: "Prod Sub" });
    expect(rule).toEqual({ conditions: [{ type: "subscription", values: ["Prod Sub"] }] });
  });

  it("falls back to an anchored, escaped name_regex when only asset is present", () => {
    const rule = buildPrefillRule({ asset: "web-01" });
    expect(rule).toEqual({ conditions: [{ type: "name_regex", pattern: "^web-01$" }] });
  });

  it("produces a pattern that matches only the exact asset name, metacharacters included", () => {
    const asset = "web-01 (prod).eu";
    const rule = buildPrefillRule({ asset });
    const re = new RegExp(rule.conditions[0].pattern);
    expect(re.test(asset)).toBe(true);
    expect(re.test("web-01 Xprod)Yeu")).toBe(false);
  });

  it("ignores a blank/whitespace-only subscription and falls back to asset", () => {
    const rule = buildPrefillRule({ asset: "web-01", subscription: "   " });
    expect(rule).toEqual({ conditions: [{ type: "name_regex", pattern: "^web-01$" }] });
  });

  it("returns null when neither subscription nor asset is a usable string", () => {
    expect(buildPrefillRule({})).toBeNull();
    expect(buildPrefillRule({ asset: "", subscription: "" })).toBeNull();
    expect(buildPrefillRule({ asset: 5, subscription: null })).toBeNull();
    expect(buildPrefillRule(null)).toBeNull();
    expect(buildPrefillRule(undefined)).toBeNull();
  });
});

describe("encodePrefill / decodePrefill", () => {
  it("round-trips a resource object", () => {
    const resource = { asset: "web-01", subscription: "Prod Sub", supportGroup: "Platform" };
    const decoded = decodePrefill(encodePrefill(resource));
    expect(decoded).toEqual(resource);
  });

  it("returns null on garbage input", () => {
    expect(decodePrefill("{not json")).toBeNull();
    expect(decodePrefill("42")).toBeNull();
    expect(decodePrefill('"a string"')).toBeNull();
    expect(decodePrefill("null")).toBeNull();
  });

  it("returns null on a version mismatch", () => {
    expect(decodePrefill(JSON.stringify({ v: 2, resource: { asset: "x" } }))).toBeNull();
    expect(decodePrefill(JSON.stringify({ resource: { asset: "x" } }))).toBeNull();
  });

  it("returns null when resource is missing or not an object", () => {
    expect(decodePrefill(JSON.stringify({ v: 1 }))).toBeNull();
    expect(decodePrefill(JSON.stringify({ v: 1, resource: "x" }))).toBeNull();
    expect(decodePrefill(JSON.stringify({ v: 1, resource: null }))).toBeNull();
    expect(decodePrefill(JSON.stringify({ v: 1, resource: [1, 2] }))).toBeNull();
  });

  it("returns null on undefined/null input without throwing", () => {
    expect(decodePrefill(undefined)).toBeNull();
    expect(decodePrefill(null)).toBeNull();
  });
});
