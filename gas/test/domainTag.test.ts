// The business domain read off a resource's `Wiz/Domain` tag.
//
// A tiny module with three decisions in it, and every one of them is the kind that renders
// perfectly while being wrong: a key match that is case-sensitive silently selects nothing, a
// value that gets case-folded prints something the Wiz console does not, and a tag present with
// a blank value becomes a domain named "" that the switcher would offer as a scope.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOMAIN_TAG_KEY,
  domainOfTags,
  resolveDomainTagKey,
} from "../src/domain/domainTag";
import { bizDomainOf } from "../src/server/bizDomains";

describe("domainOfTags", () => {
  it("reads the value of the configured key", () => {
    expect(domainOfTags({ env: "prod", "Wiz/Domain": "SAP" })).toBe("SAP");
  });

  // The captures say `Wiz/Domain` while every human writing about it says `Wiz/domain`, and an
  // operator who types the latter into a Script Property must not silently select nothing.
  it("matches the key case-insensitively, and ignores surrounding space", () => {
    expect(domainOfTags({ "wiz/domain": "SAP" })).toBe("SAP");
    expect(domainOfTags({ "WIZ/DOMAIN": "SAP" })).toBe("SAP");
    expect(domainOfTags({ "Wiz/Domain": "SAP" }, "  wiz/DOMAIN  ")).toBe("SAP");
  });

  // It is a label a person chose. Folding its case would print something the Wiz console does
  // not, and the switcher's rows are read beside that console.
  it("returns the value as written, only trimmed", () => {
    expect(domainOfTags({ "Wiz/Domain": "  Example Domain  " })).toBe("Example Domain");
    expect(domainOfTags({ "Wiz/Domain": "sap" })).toBe("sap");
  });

  // An empty string is not an owner, and a switcher row with no name is not a scope.
  it("treats a blank value as no domain at all", () => {
    expect(domainOfTags({ "Wiz/Domain": "" })).toBeNull();
    expect(domainOfTags({ "Wiz/Domain": "   " })).toBeNull();
    expect(domainOfTags({ "Wiz/Domain": null as unknown as string })).toBeNull();
  });

  it("returns null for a bag that has no such key, or no bag at all", () => {
    expect(domainOfTags({ env: "prod" })).toBeNull();
    expect(domainOfTags({})).toBeNull();
    expect(domainOfTags(null)).toBeNull();
    expect(domainOfTags(undefined)).toBeNull();
  });

  // A blank key selects nothing rather than matching the first tag it sees — an operator who
  // cleared WIZ_DOMAIN_TAG_KEY should get no domains, not an arbitrary one.
  it("returns null for a blank key", () => {
    expect(domainOfTags({ "Wiz/Domain": "SAP" }, "")).toBeNull();
    expect(domainOfTags({ "Wiz/Domain": "SAP" }, "   ")).toBeNull();
  });

  it("reads a non-default key when one is configured", () => {
    expect(domainOfTags({ "cost-centre": "RETAIL" }, "cost-centre")).toBe("RETAIL");
    expect(domainOfTags({ "cost-centre": "RETAIL" })).toBeNull();
  });
});

describe("resolveDomainTagKey", () => {
  it("falls back to the captured spelling", () => {
    expect(resolveDomainTagKey(null)).toBe(DEFAULT_DOMAIN_TAG_KEY);
    expect(resolveDomainTagKey(undefined)).toBe(DEFAULT_DOMAIN_TAG_KEY);
    expect(resolveDomainTagKey("")).toBe(DEFAULT_DOMAIN_TAG_KEY);
    expect(resolveDomainTagKey("   ")).toBe(DEFAULT_DOMAIN_TAG_KEY);
  });

  it("takes a configured key, trimmed", () => {
    expect(resolveDomainTagKey("  cost-centre ")).toBe("cost-centre");
  });
});

// `domainCoverage` USED TO BE TESTED HERE, and its removal is deliberate rather than a lapse
// in coverage: it counted "how many rows carry a domain tag" over a set handed to it, and both
// production readers of that figure now count it inside a pass they already make — the
// bootstrap's `scopeCounts.noBizDomain` and `attribution.coverage()`'s `bySource.tag`. Keeping
// it would have meant a helper with no caller and a second traversal for anyone who used it.
// The behaviour it asserted is covered by `domainOfTags` above and by `attribution.test.ts`.

// bizDomainOf leans on domainRules.recordTags, which is what lets one scope read the same tags
// from a raw node, a flattened frame record and a ledger row alike. All three shapes are live in
// this app at once — the frame is flattened, the base rows come out of the sheet — so a scope
// that only understood one of them would filter one page and not the next.
describe("bizDomainOf, across the three shapes a record can carry", () => {
  const KEY = "Wiz/Domain";

  it("reads a nested vulnerableAsset.tags object", () => {
    expect(bizDomainOf({ vulnerableAsset: { tags: { "Wiz/Domain": "SAP" } } }, KEY)).toBe("SAP");
  });

  it("reads the flattened frame's dotted tag columns", () => {
    expect(bizDomainOf({ "vulnerableAsset.tags.Wiz/Domain": "CROSS" }, KEY)).toBe("CROSS");
  });

  it("reads a ledger row's tags_json string", () => {
    expect(bizDomainOf({ tags_json: '{"env":"prod","Wiz/Domain":"RETAIL"}' }, KEY)).toBe("RETAIL");
  });

  it("returns null for malformed tags_json rather than throwing", () => {
    expect(bizDomainOf({ tags_json: "not json" }, KEY)).toBeNull();
    expect(bizDomainOf({ tags_json: "[1,2,3]" }, KEY)).toBeNull();
    expect(bizDomainOf({}, KEY)).toBeNull();
  });
});
