import { describe, expect, it } from "vitest";
import { field, mttrFromLedger, vulnKey } from "../src/domain/lifecycle";
import { sha1Hex } from "../src/domain/sha1";
import { expectParity, fixture } from "./helpers";

describe("sha1Hex", () => {
  it("matches known digests", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("ünïcode")).toBe(sha1Hex("ünïcode")); // stable
  });
});

describe("vulnKey (fixture parity)", () => {
  const { cases } = fixture("vuln_key");
  cases.forEach((c: any, i: number) => {
    it(`case ${i}: ${c.expected}`, () => {
      expect(vulnKey(c.input)).toBe(c.expected);
    });
  });
});

describe("field (fixture parity)", () => {
  const { cases } = fixture("field");
  cases.forEach((c: any, i: number) => {
    it(`case ${i}`, () => {
      expect(field(c.input.record, ...c.input.keys)).toBe(c.expected);
    });
  });
});

describe("mttrFromLedger (fixture parity)", () => {
  const fx = fixture("mttr_from_ledger");
  it("matches the Python summary", () => {
    const { perSev, overall } = mttrFromLedger(fx.rows, { now: Date.parse(fx.now) });
    expectParity(perSev, fx.expected.per_sev);
    expectParity(overall, fx.expected.overall);
  });
  it("returns empty for no rows", () => {
    expect(mttrFromLedger([])).toEqual({ perSev: {}, overall: {} });
  });
});
