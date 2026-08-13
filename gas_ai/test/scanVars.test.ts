// Editable sync-step variables: the containment, the overlay, and what a human is told.
//
// The safety argument for this feature is that an override can only ever move the knobs its
// spec names — never the selection set, which is what every normalizer couples to. That is
// a property of `cleanStepVars`, so it is pinned here rather than trusted.

import { describe, expect, it } from "vitest";
import {
  changedPaths,
  cleanStepVars,
  effectiveStepVars,
  isEditableStep,
  MAX_LIST_VALUES,
  readPath,
  STEP_VAR_SPECS,
  validateStepVars,
  varSpecFor,
  writePath,
} from "../src/domain/scanVars";
import { getScanVars, withScanVars } from "../src/domain/settingsLogic";
import { aiIssuesVariables } from "../src/server/wizQueriesAi";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";

const INV = "INVENTORY_AI";
const ISS = "ISSUES_TOXIC";

describe("containment — an override moves only what its spec offers", () => {
  it("keeps a path the spec names", () => {
    const clean = cleanStepVars(INV, { filterBy: { type: { equals: ["AI_AGENT"] } } });
    expect(readPath(clean, "filterBy.type.equals")).toEqual(["AI_AGENT"]);
  });

  it("drops a sibling path the spec does not name", () => {
    const clean = cleanStepVars(INV, {
      filterBy: { type: { equals: ["AI_AGENT"] }, subscriptionId: { equals: ["sneaky"] } },
    });
    expect(readPath(clean, "filterBy.subscriptionId")).toBeUndefined();
  });

  it("drops transport variables outright — first/after are the client's, not the operator's", () => {
    const clean = cleanStepVars(INV, {
      first: 10000, after: "cursor", quick: false,
      filterBy: { type: { equals: ["AI_AGENT"] } },
    });
    expect(readPath(clean, "first")).toBeUndefined();
    expect(readPath(clean, "after")).toBeUndefined();
    expect(readPath(clean, "quick")).toBeUndefined();
  });

  it("cannot widen the AI risk category — the filter that makes these AI issues", () => {
    // frameworkCategory is deliberately absent from the ISSUES_TOXIC spec: nothing in the
    // response says "this is an AI issue", so the category filter IS the claim, and
    // widening it would relabel the whole register rather than extend it. cleanStepVars
    // drops any path the spec does not name, and effectiveStepVars overlays BY PATH, so
    // the builder's value survives whatever is stored. Asserted rather than trusted.
    const stored = { filterBy: { frameworkCategory: ["wct-id-9999"] } };
    expect(readPath(cleanStepVars(ISS, stored) ?? {}, "filterBy.frameworkCategory"))
      .toBeUndefined();
    const effective = effectiveStepVars(
      ISS,
      aiIssuesVariables(null) as Record<string, unknown>,
      stored,
    );
    expect(readPath(effective, "filterBy.frameworkCategory")).toEqual([RISK_CATEGORY_ID]);
    expect(varSpecFor(ISS)?.locked).toContain("wct-id-1998");
  });

  it("offers the issue-type filter, and refuses to empty it", () => {
    const paths = (varSpecFor(ISS)?.fields ?? []).map((f) => f.path);
    expect(paths).toContain("filterBy.type");
    expect(validateStepVars(ISS, { filterBy: { type: [] } }).length).toBeGreaterThan(0);
    const clean = cleanStepVars(ISS, { filterBy: { type: ["TOXIC_COMBINATION"] } });
    expect(readPath(clean ?? {}, "filterBy.type")).toEqual(["TOXIC_COMBINATION"]);
  });

  it("refuses a step with no spec, however well-formed the value", () => {
    expect(cleanStepVars("GUARDRAIL_GAPS", { filterBy: { anything: 1 } })).toBeNull();
    expect(isEditableStep("GUARDRAIL_GAPS")).toBe(false);
  });

  it("returns null for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "x", [], { nothing: "here" }]) {
      expect(cleanStepVars(INV, junk)).toBeNull();
    }
  });
});

describe("cleaning values", () => {
  it("trims, dedupes and caps a list", () => {
    const many = Array.from({ length: MAX_LIST_VALUES + 20 }, (_, i) => `T${i}`);
    const clean = cleanStepVars(INV, { filterBy: { type: { equals: [" A ", "A", "", ...many] } } });
    const list = readPath(clean, "filterBy.type.equals") as string[];
    expect(list[0]).toBe("A");
    expect(list.filter((v) => v === "A")).toHaveLength(1);
    expect(list.length).toBeLessThanOrEqual(MAX_LIST_VALUES);
  });

  it("uppercases an enum and drops one outside its options", () => {
    expect(readPath(cleanStepVars(ISS, { orderBy: { direction: "asc" } }), "orderBy.direction"))
      .toBe("ASC");
    // No "nearest" direction exists, so an unrecognised one is dropped, not guessed at.
    expect(readPath(cleanStepVars(ISS, { orderBy: { direction: "SIDEWAYS" } }), "orderBy.direction"))
      .toBeUndefined();
  });
});

describe("effectiveStepVars — overlay by path, never replace", () => {
  // The real builder output, so this suite cannot go on describing a filter shape the
  // query stopped sending.
  const base = aiIssuesVariables(null) as Record<string, unknown>;

  it("moves the overridden path", () => {
    const out = effectiveStepVars(ISS, base, { filterBy: { status: ["OPEN"] } });
    expect(out.filterBy).toMatchObject({ status: ["OPEN"] });
  });

  it("keeps the builder's other keys — including ones the operator never sees", () => {
    const out = effectiveStepVars(ISS, base, { filterBy: { status: ["OPEN"] } }) as Record<string, Record<string, unknown>>;
    // The category filter is what scopes this query to AI at all. An override that
    // replaced `filterBy` wholesale would silently drop it and collect the whole tenant.
    expect(out.filterBy.frameworkCategory).toEqual([RISK_CATEGORY_ID]);
    expect(out.filterBy.type).toEqual(["CLOUD_CONFIGURATION", "TOXIC_COMBINATION"]);
    expect(out.orderBy.field).toBe("SEVERITY_EXPLOITABLE");
  });

  it("returns the base untouched when there is no override", () => {
    expect(effectiveStepVars(ISS, base, null)).toEqual(base);
    expect(effectiveStepVars(ISS, base, {})).toEqual(base);
  });

  it("does not mutate the base it was given", () => {
    const snapshot = JSON.stringify(base);
    effectiveStepVars(ISS, base, { filterBy: { status: ["REJECTED"] } });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("validation — what a human got wrong, in their words", () => {
  it("passes an untouched override", () => {
    expect(validateStepVars(INV, null)).toEqual([]);
  });

  it("rejects emptying a required filter, and says why it matters", () => {
    const errs = validateStepVars(INV, { filterBy: { type: { equals: [] } } });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/cannot be empty/i);
    expect(errs[0]).toMatch(/everything/i);
  });

  it("rejects a step that takes no variables", () => {
    expect(validateStepVars("RUNS_AS", null)[0]).toMatch(/does not take editable variables/i);
  });
});

describe("changedPaths", () => {
  const base = { filterBy: { type: { equals: ["AI_AGENT"] } } };

  it("is empty when the override matches the default", () => {
    expect(changedPaths(INV, base, { filterBy: { type: { equals: ["AI_AGENT"] } } })).toEqual([]);
  });

  it("names the path that actually moved", () => {
    expect(changedPaths(INV, base, { filterBy: { type: { equals: ["AI_MODEL"] } } }))
      .toEqual(["filterBy.type.equals"]);
  });
});

describe("settings round trip", () => {
  it("stores an override under its step and reads it back cleaned", () => {
    const next = withScanVars({}, INV, { filterBy: { type: { equals: ["AI_AGENT"] } }, junk: 1 });
    const read = getScanVars(next);
    expect(Object.keys(read)).toEqual([INV]);
    expect(readPath(read[INV], "filterBy.type.equals")).toEqual(["AI_AGENT"]);
    expect(readPath(read[INV], "junk")).toBeUndefined();
  });

  it("treats an empty override as a removal, which is how reset is expressed", () => {
    const stored = withScanVars({}, INV, { filterBy: { type: { equals: ["AI_AGENT"] } } });
    expect(Object.keys(getScanVars(stored))).toEqual([INV]);
    expect(Object.keys(getScanVars(withScanVars(stored, INV, null)))).toEqual([]);
  });

  it("drops a stored key for a step that no longer takes variables", () => {
    expect(getScanVars({ scan_vars: { GONE_STEP: { filterBy: { x: 1 } } } })).toEqual({});
  });

  it("degrades a corrupted cell to no overrides rather than breaking a sync", () => {
    for (const junk of [null, "nope", 7, []]) {
      expect(getScanVars({ scan_vars: junk })).toEqual({});
    }
  });
});

describe("the specs themselves", () => {
  it("only names steps that exist, and gives every field a label and help", () => {
    for (const spec of STEP_VAR_SPECS) {
      expect(spec.fields.length, `${spec.stepId} has no fields`).toBeGreaterThan(0);
      for (const f of spec.fields) {
        expect(f.label, `${spec.stepId}.${f.path} has no label`).toBeTruthy();
        expect(f.help, `${spec.stepId}.${f.path} has no help`).toBeTruthy();
        if (f.kind === "enum") expect(f.options, `${f.path} is an enum with no options`).toBeTruthy();
      }
    }
  });

  it("does not offer the agentic-purpose filter, and says why it is locked", () => {
    const spec = varSpecFor("AGENTIC_IDENTITIES");
    expect(spec!.fields.some((f) => f.path.includes("identityPurpose"))).toBe(false);
    expect(spec!.locked).toMatch(/mislabel/i);
  });
});

describe("path helpers", () => {
  it("writes through missing branches and reads back", () => {
    const obj = {};
    writePath(obj, "a.b.c", ["x"]);
    expect(readPath(obj, "a.b.c")).toEqual(["x"]);
  });

  it("replaces a non-object branch rather than throwing through it", () => {
    const obj = { a: 5 } as Record<string, unknown>;
    writePath(obj, "a.b", 1);
    expect(readPath(obj, "a.b")).toBe(1);
  });

  it("reads a missing path as undefined", () => {
    expect(readPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(readPath(null, "a")).toBeUndefined();
  });
});
