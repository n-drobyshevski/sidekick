import { describe, expect, it } from "vitest";
import {
  assignDomain,
  compileDomains,
  domainNames,
  hasDomainInputs,
  validateDomains,
} from "../src/domain/domainRules";
import { fixture } from "./helpers";

describe("domain rules (fixture parity)", () => {
  const fx = fixture("domain_rules");
  const compiled = compileDomains(fx.items);

  fx.records.forEach((rec: any, i: number) => {
    it(`record ${i} -> ${fx.expected.assignments[i]}`, () => {
      expect(assignDomain(rec, compiled)).toBe(fx.expected.assignments[i]);
    });
  });

  it("domainNames parity", () => {
    expect(domainNames(fx.items)).toEqual(fx.expected.names);
  });
});

describe("validateDomains (fixture parity)", () => {
  const fx = fixture("domain_rules_validate");
  it("emits the same errors (regex-compile detail excluded)", () => {
    // Python's re.error text differs from V8's SyntaxError text; compare messages
    // truncated at the "does not compile" detail.
    const trim = (msgs: string[]) =>
      msgs.map((m) => m.replace(/pattern does not compile \(.*\)\.$/, "pattern does not compile."));
    expect(trim(validateDomains(fx.items))).toEqual(trim(fx.expected));
  });
  it("accepts a well-formed list", () => {
    expect(
      validateDomains([
        { name: "A", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }] }] },
      ]),
    ).toEqual([]);
  });
});

describe("hasDomainInputs", () => {
  // A compacted resolved episode as ledgerCore.baseRows surfaces it: '(compacted)' asset name,
  // every other rule input null. Can only ever read as Unassigned — not attributable.
  it("compacted episode has no inputs", () => {
    expect(
      hasDomainInputs({
        vuln_key: "k",
        asset_name: "(compacted)",
        subscription_name: null,
        subscription_ext_id: null,
        tags_json: null,
      }),
    ).toBe(false);
  });

  it("a bare row with everything null has no inputs", () => {
    expect(hasDomainInputs({ vuln_key: "k" })).toBe(false);
  });

  it("tags_json alone counts as an input", () => {
    expect(hasDomainInputs({ vuln_key: "k", tags_json: '{"env":"prod"}' })).toBe(true);
  });

  it("a nested vulnerableAsset.tags value counts as an input", () => {
    expect(hasDomainInputs({ vulnerableAsset: { tags: { env: "prod" } } })).toBe(true);
  });

  it("subscription_name alone counts as an input", () => {
    expect(hasDomainInputs({ vuln_key: "k", subscription_name: "sub-a" })).toBe(true);
  });

  it("a real asset name counts as an input", () => {
    expect(hasDomainInputs({ asset_name: "web-01" })).toBe(true);
    expect(hasDomainInputs({ "vulnerableAsset.name": "web-01" })).toBe(true);
  });

  it("a resolved support group counts as an input", () => {
    expect(hasDomainInputs({ vuln_key: "k", _supportGroup: "platform" })).toBe(true);
  });

  it("tags present but empty-valued do not count", () => {
    expect(hasDomainInputs({ vulnerableAsset: { tags: { env: null } } })).toBe(false);
  });
});
