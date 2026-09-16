// src/domain/projectGrain.ts — the tenant's project vocabulary.
//
// Wiz reports a flat `projects[]` with an `isFolder` flag and no parent links. It does not
// report that `CE-TRANSPORT` is a support group, that `product-TATTOO-idp` is a product, or
// that the second sits inside the first. These cases pin the name rules that learn all three,
// and the two fallbacks that let a row written before the `projects_json` column still answer.

import { describe, expect, it } from "vitest";
import {
  isProduct,
  isSupportGroup,
  PRODUCT_SEGMENT,
  productOf,
  projectKind,
  SUPPORT_GROUP_PREFIXES,
  supportGroupOf,
} from "../src/domain/projectGrain";

// --------------------------------------------------------------------------- #
//  the two name rules
// --------------------------------------------------------------------------- #

describe("isSupportGroup — the first segment, not a bare prefix", () => {
  it("the tenant's three prefixes, and the list is exactly those three", () => {
    expect(SUPPORT_GROUP_PREFIXES).toEqual(["CS", "CE", "LU"]);
    expect(isSupportGroup("CS-LOG-ZEN-ECOM")).toBe(true);
    expect(isSupportGroup("CE-TRANSPORT")).toBe(true);
    expect(isSupportGroup("LU-OPS")).toBe(true);
  });

  it("case-insensitive, and padding is trimmed — a display name can be re-typed", () => {
    expect(isSupportGroup("ce-transport")).toBe(true);
    expect(isSupportGroup("  CE-TRANSPORT  ")).toBe(true);
  });

  it("REJECTS a bare prefix match: CENTRAL-OPS is not a CE support group", () => {
    // The case that kills `startsWith("CE")`.
    expect(isSupportGroup("CENTRAL-OPS")).toBe(false);
    expect(isSupportGroup("CSUITE")).toBe(false);
  });

  it("REJECTS the prefix in the middle of a compound name", () => {
    // The case that kills `includes("CE")`.
    expect(isSupportGroup("owner-CE-INDUS-cloud")).toBe(false);
  });

  it("nothing at all is not a support group", () => {
    expect(isSupportGroup("")).toBe(false);
    expect(isSupportGroup(null)).toBe(false);
    expect(isSupportGroup(undefined)).toBe(false);
    expect(isSupportGroup("   ")).toBe(false);
  });
});

describe("isProduct — the SAME splitter, a second vocabulary", () => {
  it("the tenant's product marker", () => {
    expect(PRODUCT_SEGMENT).toBe("product");
    expect(isProduct("product-TATTOO-idp")).toBe(true);
    expect(isProduct("product-RetBox-front")).toBe(true);
  });

  it("case-insensitive and trimmed, like the support-group rule", () => {
    expect(isProduct("PRODUCT-TATTOO-idp")).toBe(true);
    expect(isProduct("  product-x  ")).toBe(true);
  });

  it("REJECTS the marker in the middle of a compound name — one splitter, both rules", () => {
    // The product twin of `owner-CE-INDUS-cloud`. `startsWith`/`includes` would take it.
    expect(isProduct("owner-product-x")).toBe(false);
    expect(isProduct("legacy-product")).toBe(false);
  });

  it("REJECTS a bare prefix match", () => {
    expect(isProduct("production-tools")).toBe(false);
    expect(isProduct("productivity")).toBe(false);
  });

  it("a real leaf that follows neither convention is neither", () => {
    expect(isProduct("checkout-svc")).toBe(false);
    expect(isSupportGroup("checkout-svc")).toBe(false);
  });
});

// --------------------------------------------------------------------------- #
//  projectKind — the branch ORDER is the assertion
// --------------------------------------------------------------------------- #

describe("projectKind", () => {
  it("THE NAME RULES WIN OVER isFolder — a support group that nests is still a support group", () => {
    expect(projectKind({ name: "CS-LOG-ZEN-ECOM", isFolder: true })).toBe("support");
    expect(projectKind({ name: "CE-TRANSPORT", isFolder: false })).toBe("support");
  });

  it("a product is a product whatever isFolder says, INCLUDING when it says nothing", () => {
    // The flip this module exists for: before it, a `product-…` project whose isFolder Wiz
    // omitted was classified "unknown" and shown under "Not yet recorded".
    expect(projectKind({ name: "product-TATTOO-idp", isFolder: false })).toBe("product");
    expect(projectKind({ name: "product-KCONNECT" })).toBe("product");
    expect(projectKind({ name: "product-legacy", isFolder: true })).toBe("product");
  });

  it("isFolder still decides everything neither name rule claimed — tri-state, all three", () => {
    expect(projectKind({ name: "VALUE-CHAIN", isFolder: true })).toBe("unit");
    expect(projectKind({ name: "checkout-svc", isFolder: false })).toBe("project");
    // ABSENT, never coerced to false: "we have not recorded it" is its own answer.
    expect(projectKind({ name: "checkout-svc" })).toBe("unknown");
  });
});

// --------------------------------------------------------------------------- #
//  supportGroupOf — the projects, then owner_path
// --------------------------------------------------------------------------- #

describe("supportGroupOf", () => {
  const PROBE = [
    { name: "VALUE-CHAIN", isFolder: true },
    { name: "product-TATTOO-idp", isFolder: false },
    { name: "CE-TRANSPORT", isFolder: true },
  ];

  it("reads the support group off the row's own projects", () => {
    expect(supportGroupOf(PROBE)).toBe("CE-TRANSPORT");
  });

  it("LOWEST NAME WINS when a row carries two — the bucket has to be stable across scans", () => {
    const two = [
      { name: "LU-OPS" },
      { name: "CE-TRANSPORT" },
      { name: "product-x" },
    ];
    expect(supportGroupOf(two)).toBe("CE-TRANSPORT");
    // Same set, opposite API order: the answer must not move.
    expect(supportGroupOf([...two].reverse())).toBe("CE-TRANSPORT");
  });

  it("falls back to the owner_path bag for a row written before projects_json existed", () => {
    expect(supportGroupOf([], "CE-TRANSPORT / VALUE-CHAIN")).toBe("CE-TRANSPORT");
    // owner_path is sorted alphabetically, so the support group is not reliably first.
    expect(supportGroupOf([], "ALPHA-UNIT / CS-LOG-ZEN-ECOM")).toBe("CS-LOG-ZEN-ECOM");
  });

  it("the fallback is only reached when the projects answer nothing", () => {
    // A row carrying both must not be re-answered from the staler field.
    expect(supportGroupOf([{ name: "CE-TRANSPORT" }], "CS-OTHER / VALUE-CHAIN"))
      .toBe("CE-TRANSPORT");
  });

  it("no support group anywhere is null, never a placeholder", () => {
    expect(supportGroupOf([])).toBeNull();
    expect(supportGroupOf([{ name: "product-x" }, { name: "VALUE-CHAIN" }])).toBeNull();
    expect(supportGroupOf([], "VALUE-CHAIN / PLATFORM")).toBeNull();
    expect(supportGroupOf([], "")).toBeNull();
    expect(supportGroupOf([], null)).toBeNull();
    // A sealed episode: compaction writes owner_path null, so it answers no support group.
    expect(supportGroupOf([], undefined)).toBeNull();
  });
});

// --------------------------------------------------------------------------- #
//  productOf — the projects, then owner_project, MINUS the case it can prove wrong
// --------------------------------------------------------------------------- #

describe("productOf", () => {
  it("reads the product off the row's own projects", () => {
    expect(productOf([
      { name: "VALUE-CHAIN", isFolder: true },
      { name: "product-TATTOO-idp", isFolder: false },
      { name: "CE-TRANSPORT", isFolder: true },
    ])).toBe("product-TATTOO-idp");
  });

  it("lowest name wins on two, for supportGroupOf's reason", () => {
    const two = [{ name: "product-zeta" }, { name: "product-alpha" }];
    expect(productOf(two)).toBe("product-alpha");
    expect(productOf([...two].reverse())).toBe("product-alpha");
  });

  it("falls back to owner_project — the ONLY grain a sealed episode carries", () => {
    expect(productOf([], "product-TATTOO-idp")).toBe("product-TATTOO-idp");
  });

  it("the fallback does NOT require the product- marker — a repo outside the convention "
    + "keeps naming its leaf", () => {
    expect(productOf([], "checkout-svc")).toBe("checkout-svc");
    expect(productOf([], "payments-core")).toBe("payments-core");
  });

  it("BUT IT REFUSES A SUPPORT GROUP — the one case it can prove is the wrong grain", () => {
    // This is the whole point. `owner_project` holds a support group for any row where Wiz
    // reported one as a leaf ahead of the product; taking it here would put a support group in
    // a field named "product" and rank it against real products in every breakdown.
    expect(productOf([], "CE-TRANSPORT")).toBeNull();
    expect(productOf([], "CS-LOG-ZEN-ECOM")).toBeNull();
    expect(productOf([], "  ce-transport  ")).toBeNull();
  });

  it("the fallback is only reached when the projects answer nothing", () => {
    expect(productOf([{ name: "product-real" }], "CE-TRANSPORT")).toBe("product-real");
  });

  it("no product anywhere is null", () => {
    expect(productOf([])).toBeNull();
    expect(productOf([], "")).toBeNull();
    expect(productOf([], "   ")).toBeNull();
    expect(productOf([], null)).toBeNull();
    expect(productOf([{ name: "VALUE-CHAIN", isFolder: true }])).toBeNull();
  });
});
