// The Security Graph's applied-filter chip layer. Plain .js on purpose: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would
// never run. Vitest picks up **/*.test.{js,ts} either way, and the module is pure, so
// this needs no jsdom and no new devDependency.
//
// The seed, the depth and the node-type lens used to be chips here and are now the QUERY,
// spelled out in the builder above the row. The `isDefault` machinery went with them: it
// existed so the page could show a lens it had seeded itself without claiming the user had
// applied two filters, and a builder reading `FIND [AI Agent]` needs no such apology. What is
// left is what narrows the ANSWER rather than shaping the question.

import { describe, expect, it } from "vitest";
import {
  appliedCount, filterEntries, isNarrowingSet, sectionOf,
} from "../src/client/js/pages/graphChips.js";

const DEFAULTS = { maxNodes: 100 };

/** The resolved state a fresh visit produces, with `over` applied on top. */
function stateOf(over = {}) {
  return {
    maxNodes: 100, maxNodesRaw: "",
    severities: "", projects: "", clouds: "",
    ...over,
  };
}

const keys = (entries) => entries.map((e) => e.key);
const byKey = (entries, k) => entries.find((e) => e.key === k);

describe("filterEntries", () => {
  it("reports nothing on a wide-open view", () => {
    const entries = filterEntries(stateOf(), DEFAULTS);
    expect(entries).toEqual([]);
    expect(appliedCount(entries)).toBe(0);
    expect(isNarrowingSet(entries)).toBe(false);
  });

  it("says nothing about the query — that is the builder's job, not a chip's", () => {
    // A state carrying a three-step query still has no filters applied. Restating the query
    // as chips would be two controls answering one question.
    const entries = filterEntries(
      stateOf({ find: "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)", where: "0.id.agent-a" }),
      DEFAULTS,
    );
    expect(entries).toEqual([]);
  });

  it("carries the severity token on a severity chip, one chip per level", () => {
    const entries = filterEntries(stateOf({ severities: "CRITICAL,HIGH" }), DEFAULTS);
    expect(keys(entries)).toEqual(["sev-CRITICAL", "sev-HIGH"]);
    expect(entries.map((e) => e.sev)).toEqual(["CRITICAL", "HIGH"]);
    expect(entries.every((e) => e.isNarrowing)).toBe(true);
    expect(appliedCount(entries)).toBe(2);
  });

  it("chips a widened node budget, and does not call it narrowing", () => {
    // Raising the budget can only ever show more, so an empty view is never its fault.
    const entries = filterEntries(stateOf({ maxNodes: 200, maxNodesRaw: "200" }), DEFAULTS);
    expect(keys(entries)).toEqual(["maxNodes"]);
    expect(byKey(entries, "maxNodes").value).toBe("200 nodes");
    expect(isNarrowingSet(entries)).toBe(false);
  });

  it("leaves the budget unchipped when it matches the deployment default", () => {
    expect(filterEntries(stateOf({ maxNodesRaw: "100" }), DEFAULTS)).toEqual([]);
  });

  it("chips project and cloud, both narrowing", () => {
    const entries = filterEntries(stateOf({ projects: "PROJECT-ALPHA", clouds: "GCP" }), DEFAULTS);
    expect(keys(entries)).toEqual(["projects", "clouds"]);
    expect(isNarrowingSet(entries)).toBe(true);
  });

  describe("each patch clears exactly its own filter", () => {
    it("covers every set filter", () => {
      const state = stateOf({
        severities: "CRITICAL,HIGH", projects: "PROJECT-ALPHA", clouds: "GCP",
        maxNodes: 200, maxNodesRaw: "200",
      });
      const entries = filterEntries(state, DEFAULTS);
      const touched = new Set();
      for (const e of entries) for (const k of Object.keys(e.patch)) touched.add(k);
      expect([...touched].sort()).toEqual(["clouds", "maxNodes", "projects", "severities"]);
    });

    it("removes one severity and leaves the other standing", () => {
      const entries = filterEntries(stateOf({ severities: "CRITICAL,HIGH" }), DEFAULTS);
      expect(byKey(entries, "sev-CRITICAL").patch).toEqual({ severities: "HIGH" });
      expect(byKey(entries, "sev-HIGH").patch).toEqual({ severities: "CRITICAL" });
    });
  });
});

describe("sectionOf", () => {
  it("routes a chip to the panel section that owns it", () => {
    expect(sectionOf({ key: "sev-CRITICAL" })).toBe("severity");
    expect(sectionOf({ key: "projects" })).toBe("projects");
    expect(sectionOf({ key: "clouds" })).toBe("clouds");
  });
});
