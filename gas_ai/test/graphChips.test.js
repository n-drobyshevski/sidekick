// What the applied-chip row still claims, now that one chip is left.
//
// The seed, the depth and the node-type lens went into the builder first; severity, cloud and
// project followed once it grew a WHERE segment. They were only ever `where` filters on node 0 —
// `rpcParams` folded them onto it — so they are chips on the row they narrow now, with counts
// and operators the panel never had. What is left is the node budget, which was never part of
// the question, and the `isDefault`/`isNarrowing` machinery went with the filters it apologised
// for.
//
// Plain .js: tsconfig has no allowJs, so a .ts test importing a client .js module fails
// `tsc --noEmit` and `npm run check` never reaches vitest at all.

import { describe, expect, it } from "vitest";

import { filterEntries } from "../src/client/js/pages/graphChips.js";

const DEFAULTS = { maxNodes: 60 };
const state = (over) => ({ maxNodes: 60, maxNodesRaw: "", where: "", ...over });

describe("filterEntries", () => {
  it("says nothing when nothing is applied", () => {
    expect(filterEntries(state(), DEFAULTS)).toEqual([]);
  });

  it("says nothing about the query — that is the builder's job, not a chip's", () => {
    // A filter narrows which nodes bind at a step, so it belongs beside the step. Restating it
    // here would be the second control answering one question that this row keeps shedding.
    const entries = filterEntries(
      state({ find: "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)", where: "0.severity.CRITICAL,0.cloud.GCP" }),
      DEFAULTS,
    );
    expect(entries).toEqual([]);
  });

  it("shows a widened budget, and does not call it narrowing", () => {
    const [chip, ...rest] = filterEntries(state({ maxNodes: 120, maxNodesRaw: "120" }), DEFAULTS);
    expect(rest).toEqual([]);
    expect(chip).toMatchObject({ key: "maxNodes", label: "Budget", value: "120 nodes" });
    // Raising the budget can only ever show MORE of a match set; it never changes what matches.
    expect(chip.isNarrowing).toBeUndefined();
    expect(chip.patch).toEqual({ maxNodes: "" });
  });

  it("keeps quiet when the budget is merely the configured one", () => {
    expect(filterEntries(state({ maxNodes: 60, maxNodesRaw: "60" }), DEFAULTS)).toEqual([]);
    expect(filterEntries(state({ maxNodes: 60, maxNodesRaw: "" }), DEFAULTS)).toEqual([]);
  });
});
