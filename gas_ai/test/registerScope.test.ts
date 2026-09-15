// The issue register's own scope: which categories it collects, which perimeters it collects
// them from, and the token each sync stamps itself with.
//
// Both knobs widen what EVERY published issue figure counts, so the things pinned here are
// the ones that keep that honest: each default is today's behaviour and nothing else, the
// signature is stable under a reorder but not under a different set, and the perimeter
// suffix appears if and only if the battery actually sent no project filter.

import { describe, expect, it } from "vitest";
import {
  CANDIDATE_CATEGORIES,
  cleanCategoryIds,
  cleanSyncScope,
  DEFAULT_CATEGORY_IDS,
  DEFAULT_SYNC_SCOPE,
  describeRegisterScope,
  formatRegisterScope,
  registerScopeSignature,
  resolveProjectScope,
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

describe("the perimeter scope", () => {
  it("defaults to the configured project — today's behaviour, not a preference", () => {
    // The same iron rule the category default follows: a knob ships doing what shipped
    // before it, so no tenant's published figures move because the app was upgraded.
    expect(DEFAULT_SYNC_SCOPE).toBe("project");
    expect(cleanSyncScope(undefined)).toBe("project");
  });

  it("folds anything unrecognised back to the narrow answer", () => {
    // A hand-edited settings cell must degrade to collecting LESS than asked, never to a
    // third state and never to a throw on every read.
    for (const junk of [null, "", "Tenant", "all", 1, true, {}, ["tenant"]]) {
      expect(cleanSyncScope(junk)).toBe("project");
    }
    expect(cleanSyncScope("tenant")).toBe("tenant");
  });
});

describe("resolveProjectScope", () => {
  it("applies the property under `project`", () => {
    expect(resolveProjectScope("project", "proj-value-chain")).toEqual(["proj-value-chain"]);
    // Trimmed, because a property pasted from a console carries whitespace and a filter of
    // " proj-x" matches nothing while looking exactly like a filter that does.
    expect(resolveProjectScope("project", "  proj-value-chain  "))
      .toEqual(["proj-value-chain"]);
  });

  it("applies nothing under `project` when the property is blank", () => {
    // Not an error. A blank property has always meant "query every project", and throwing
    // here would break the dry run and every tenant that never set one.
    expect(resolveProjectScope("project", null)).toBeNull();
    expect(resolveProjectScope("project", "")).toBeNull();
    expect(resolveProjectScope("project", "   ")).toBeNull();
  });

  it("ignores the property entirely under `tenant`", () => {
    // The whole point of the setting: collect every perimeter even though WHICH project is
    // still configured, so turning it back off needs no property edit.
    expect(resolveProjectScope("tenant", "proj-value-chain")).toBeNull();
    expect(resolveProjectScope("tenant", null)).toBeNull();
  });
});

describe("registerScopeSignature", () => {
  const A = ["wct-id-1998", "wct-id-3", "861eb856-54f6-4d1b-8ca1-1d6130841d20"];
  const P = ["proj-value-chain"];

  it("is stable under a reorder — the order picks which step runs first and nothing else", () => {
    expect(registerScopeSignature(A, P)).toBe(registerScopeSignature([...A].reverse(), P));
  });

  it("differs for a different set", () => {
    expect(registerScopeSignature(A, P)).not.toBe(registerScopeSignature(A.slice(0, 2), P));
    expect(registerScopeSignature(["wct-id-3"], P))
      .not.toBe(registerScopeSignature(["wct-id-4"], P));
  });

  it("is readable, not a hash — it lands in a sheet cell and in a notice", () => {
    // Same argument as problemRule.vectorSignature: a human has to be able to see WHAT
    // changed, and a hash says only that something did.
    expect(registerScopeSignature(["wct-id-3", RISK_CATEGORY_ID], P))
      .toBe(`${RISK_CATEGORY_ID}|wct-id-3`);
  });

  it("cleans before signing, so junk and the default sign identically", () => {
    expect(registerScopeSignature([], P)).toBe(RISK_CATEGORY_ID);
    expect(registerScopeSignature([" wct-id-3 ", "wct-id-3"], P)).toBe("wct-id-3");
  });

  it("IS BYTE-IDENTICAL to the pre-perimeter token whenever a project filter applied", () => {
    // THE COMPATIBILITY CLAIM, and it is pinned against literals rather than against the
    // function, because the only thing that can check it is a string written down before the
    // second argument existed. A ledger already on disk carries these exact bytes; if this
    // moved, the next sync would read the whole register as a scope break and date no
    // departure for one interval.
    expect(registerScopeSignature([RISK_CATEGORY_ID], P)).toBe("wct-id-1998");
    expect(registerScopeSignature([RISK_CATEGORY_ID, "wct-id-3"], P))
      .toBe("wct-id-1998|wct-id-3");
    expect(registerScopeSignature(A, P))
      .toBe("861eb856-54f6-4d1b-8ca1-1d6130841d20|wct-id-1998|wct-id-3");
  });

  it("stamps #tenant if and only if no project filter reached the wire", () => {
    expect(registerScopeSignature([RISK_CATEGORY_ID], null)).toBe("wct-id-1998#tenant");
    // An empty list sends no filter either, so it stamps the same thing: the token describes
    // what Wiz was ASKED, not which branch of the resolver produced it.
    expect(registerScopeSignature([RISK_CATEGORY_ID], [])).toBe("wct-id-1998#tenant");
    expect(registerScopeSignature([RISK_CATEGORY_ID], P)).toBe("wct-id-1998");
  });

  it("makes a perimeter flip a scope CHANGE, which is what the ledger guard reads", () => {
    const scoped = registerScopeSignature([RISK_CATEGORY_ID], P);
    const wide = registerScopeSignature([RISK_CATEGORY_ID], null);
    expect(scoped).not.toBe(wide);
    // And moving WIZ_PROJECT_ID_V2 from one project to another does NOT — the accepted cost
    // of stamping only the widening, stated here so it cannot be discovered by surprise.
    expect(registerScopeSignature([RISK_CATEGORY_ID], ["proj-a"]))
      .toBe(registerScopeSignature([RISK_CATEGORY_ID], ["proj-b"]));
  });
});

describe("reading a signature back", () => {
  it("splits the perimeter off the last category id rather than gluing it on", () => {
    // The defect this exists to prevent: a reader splitting on "|" alone prints a category
    // called "wct-id-3#tenant", which is not a category at all.
    expect(describeRegisterScope("wct-id-1998|wct-id-3#tenant"))
      .toEqual({ categories: ["wct-id-1998", "wct-id-3"], tenantWide: true });
    expect(describeRegisterScope("wct-id-1998|wct-id-3"))
      .toEqual({ categories: ["wct-id-1998", "wct-id-3"], tenantWide: false });
  });

  it("reads an absent or unreadable stamp as no categories rather than as one blank", () => {
    // Every row written before the column existed carries "", and a [""] there would draw a
    // category whose name is the empty string.
    for (const nothing of ["", null, undefined, 42]) {
      expect(describeRegisterScope(nothing)).toEqual({ categories: [], tenantWide: false });
    }
  });

  it("names the perimeter in words, and says nothing about it when one project applied", () => {
    expect(formatRegisterScope("wct-id-1998|wct-id-3")).toBe("wct-id-1998, wct-id-3");
    expect(formatRegisterScope("wct-id-1998|wct-id-3#tenant"))
      .toBe("wct-id-1998, wct-id-3 (all perimeters)");
    // Silence in the project case is accurate, not lazy: the token records that SOME project
    // filter applied and never which one, so naming a project would over-claim.
    expect(formatRegisterScope("wct-id-1998")).toBe("wct-id-1998");
    // A stamp with the suffix and nothing else still has something to say.
    expect(formatRegisterScope("#tenant")).toBe("all perimeters");
    expect(formatRegisterScope("")).toBe("");
  });
});
