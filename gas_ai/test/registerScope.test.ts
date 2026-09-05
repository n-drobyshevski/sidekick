// The issue register's own scope: which categories it collects, and the token each sync
// stamps itself with.
//
// The knob widens what EVERY published issue figure counts, so the two things pinned here
// are the two that keep that honest: the default is today's behaviour and nothing else, and
// the signature is stable under a reorder but not under a different set.

import { describe, expect, it } from "vitest";
import {
  CANDIDATE_CATEGORIES,
  cleanCategoryIds,
  DEFAULT_CATEGORY_IDS,
  registerScopeSignature,
} from "../src/domain/registerScope";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";

describe("the candidate set", () => {
  it("defaults to the AI category alone — the behaviour that shipped before the knob", () => {
    // The iron rule for a tuning change: the default does not move. Every pinned score
    // vector, golden payload and page that says "AI" is true of this one category.
    expect(DEFAULT_CATEGORY_IDS).toEqual([RISK_CATEGORY_ID]);
  });

  it("offers the six measured candidates, AI first and with no duplicates", () => {
    expect(CANDIDATE_CATEGORIES).toHaveLength(6);
    expect(CANDIDATE_CATEGORIES[0].id).toBe(RISK_CATEGORY_ID);
    const ids = CANDIDATE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every candidate carries a readable name: an id alone cannot be rendered in a picker,
    // and a second copy of these names in the client would be a second place to drift.
    for (const c of CANDIDATE_CATEGORIES) expect(c.name.length).toBeGreaterThan(0);
  });

  it("is a candidate list, not a permitted set", () => {
    // Wiz's securityCategories returns 500+ rows including UUID-keyed custom categories, so
    // a whitelist would lock a tenant out of its own register.
    expect(cleanCategoryIds(["some-tenant-custom-id"])).toEqual(["some-tenant-custom-id"]);
  });
});

describe("cleanCategoryIds", () => {
  it("trims, dedupes and keeps the given order", () => {
    expect(cleanCategoryIds([" wct-id-3 ", "wct-id-1998", "wct-id-3"]))
      .toEqual(["wct-id-3", RISK_CATEGORY_ID]);
  });

  it("drops non-strings and empties rather than throwing on them", () => {
    expect(cleanCategoryIds(["wct-id-3", "", "   ", 42, null, undefined, {}, ["x"]]))
      .toEqual(["wct-id-3"]);
  });

  it("falls back to the default for junk, and for a list that cleans to nothing", () => {
    // An empty frameworkCategory is NOT an empty register — it is no filter at all, which
    // collects the whole project. The fallback is what stops a hand-edited cell doing that.
    for (const junk of [null, undefined, 42, "wct-id-3", {}, [], ["", "  "], [1, 2]]) {
      expect(cleanCategoryIds(junk)).toEqual([RISK_CATEGORY_ID]);
    }
  });
});

describe("registerScopeSignature", () => {
  const A = ["wct-id-1998", "wct-id-3", "861eb856-54f6-4d1b-8ca1-1d6130841d20"];

  it("is stable under a reorder — the order picks which step runs first and nothing else", () => {
    expect(registerScopeSignature(A)).toBe(registerScopeSignature([...A].reverse()));
  });

  it("differs for a different set", () => {
    expect(registerScopeSignature(A)).not.toBe(registerScopeSignature(A.slice(0, 2)));
    expect(registerScopeSignature(["wct-id-3"])).not.toBe(registerScopeSignature(["wct-id-4"]));
  });

  it("is readable, not a hash — it lands in a sheet cell and in a notice", () => {
    // Same argument as problemRule.vectorSignature: a human has to be able to see WHAT
    // changed, and a hash says only that something did.
    expect(registerScopeSignature(["wct-id-3", RISK_CATEGORY_ID]))
      .toBe(`${RISK_CATEGORY_ID}|wct-id-3`);
  });

  it("cleans before signing, so junk and the default sign identically", () => {
    expect(registerScopeSignature([])).toBe(RISK_CATEGORY_ID);
    expect(registerScopeSignature([" wct-id-3 ", "wct-id-3"])).toBe("wct-id-3");
  });
});
