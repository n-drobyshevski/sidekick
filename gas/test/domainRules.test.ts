import { describe, expect, it } from "vitest";
import {
  assignDomain,
  compileDomains,
  domainNames,
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
