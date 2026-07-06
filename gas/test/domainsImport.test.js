// Client-side import parsing for domain-rules JSON. Plain .js on purpose: the
// module under test is client JS, and tsconfig has no allowJs — vitest picks
// .test.js up fine while tsc --noEmit ignores it.

import { describe, expect, it } from "vitest";
import { EXPORT_KIND, parseDomainsImport } from "../src/client/js/domainsImport.js";

const WEB = {
  name: "Web",
  rules: [{ conditions: [{ type: "tag", key: "team", value: "web" }] }],
};
const LEGACY = {
  name: "Legacy",
  rules: [{ conditions: [{ type: "name_regex", pattern: "^legacy-" }] }],
};

describe("parseDomainsImport", () => {
  it("accepts the canonical export shape", () => {
    const res = parseDomainsImport(JSON.stringify({ kind: EXPORT_KIND, items: [WEB, LEGACY] }));
    expect(res.error).toBeUndefined();
    expect(res.items).toEqual([WEB, LEGACY]);
  });

  it("accepts a raw settings wrapper and a bare array", () => {
    const wrapped = parseDomainsImport(JSON.stringify({ version: 7, items: [WEB] }));
    expect(wrapped.items).toEqual([WEB]);
    const bare = parseDomainsImport(JSON.stringify([LEGACY]));
    expect(bare.items).toEqual([LEGACY]);
  });

  it("strips Streamlit editor ids and unknown keys", () => {
    const res = parseDomainsImport(
      JSON.stringify({ items: [{ ...WEB, id: "dom-abcd1234", extra: true }] }),
    );
    expect(res.items).toEqual([WEB]);
    expect(res.items[0].id).toBeUndefined();
  });

  it("defaults missing rules to an empty list (server validation rejects later)", () => {
    const res = parseDomainsImport(JSON.stringify({ items: [{ name: "Bare" }] }));
    expect(res.items).toEqual([{ name: "Bare", rules: [] }]);
  });

  it("rejects invalid JSON", () => {
    expect(parseDomainsImport("{nope").error).toMatch(/^Not valid JSON: /);
  });

  it("rejects unrecognized top-level shapes", () => {
    for (const bad of ["{}", '{"items": 3}', '"str"', "42", "null"]) {
      expect(parseDomainsImport(bad).error).toMatch(/^Unrecognized format/);
    }
  });

  it("rejects non-object and nameless entries with a 1-based position", () => {
    expect(parseDomainsImport(JSON.stringify([WEB, 5])).error).toBe("Item 2: expected an object.");
    expect(parseDomainsImport(JSON.stringify([{ name: "  " }])).error).toBe("Item 1: missing name.");
    expect(parseDomainsImport(JSON.stringify([{ rules: [] }])).error).toBe("Item 1: missing name.");
  });
});
