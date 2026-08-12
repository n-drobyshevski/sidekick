// The Security Graph's applied-filter chip layer. Plain .js on purpose: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would
// never run. Vitest picks up **/*.test.{js,ts} either way, and the module is pure, so
// this needs no jsdom and no new devDependency.

import { describe, expect, it } from "vitest";
import {
  appliedCount, filterEntries, isNarrowingSet, sectionOf,
} from "../src/client/js/pages/graphChips.js";

const DEFAULTS = { defaultDepth: 2, maxNodes: 100 };
const CTX = { comboLegend: [], defaultSeedKind: "scored", defaultKinds: "AI_AGENT" };

/** The resolved state a fresh visit produces, with `over` applied on top. */
function stateOf(over = {}) {
  return {
    seed: "", seedKind: "", depth: 2, maxNodes: 100, maxNodesRaw: "",
    severities: "", kinds: "", projects: "", clouds: "",
    ...over,
  };
}

const keys = (entries) => entries.map((e) => e.key);
const byKey = (entries, k) => entries.find((e) => e.key === k);

describe("filterEntries", () => {
  it("reports nothing on a wide-open view", () => {
    const entries = filterEntries(stateOf(), DEFAULTS, CTX);
    expect(entries).toEqual([]);
    expect(appliedCount(entries)).toBe(0);
    expect(isNarrowingSet(entries)).toBe(false);
  });

  it("carries the severity token on a severity chip, one chip per level", () => {
    const entries = filterEntries(stateOf({ severities: "CRITICAL,HIGH" }), DEFAULTS, CTX);
    expect(keys(entries)).toEqual(["sev-CRITICAL", "sev-HIGH"]);
    expect(entries.map((e) => e.sev)).toEqual(["CRITICAL", "HIGH"]);
    expect(entries.every((e) => e.isNarrowing)).toBe(true);
  });

  describe("the lens a fresh visit seeds itself", () => {
    // The page writes seedKind=scored and kinds=AI_AGENT into the hash on first visit.
    // Both are real chips — visible, clearable — but neither is a filter the user chose,
    // so the count badge must not report them. The page used to open announcing
    // "2 filters applied" that nobody had applied.
    const fresh = filterEntries(
      stateOf({ seedKind: "scored", kinds: "AI_AGENT" }), DEFAULTS, CTX,
    );

    it("shows both as chips", () => {
      expect(keys(fresh)).toEqual(["seed", "kind-AI_AGENT"]);
    });

    it("marks both as defaults and counts neither", () => {
      expect(fresh.every((e) => e.isDefault)).toBe(true);
      expect(appliedCount(fresh)).toBe(0);
    });

    it("still reports the view as narrowed, because it is", () => {
      // The empty state reads this, not the badge: a default-narrowed view that comes
      // back with no nodes is an empty FILTERED view, and must say so rather than
      // blaming the starting point for having no connections.
      expect(isNarrowingSet(fresh)).toBe(true);
    });

    it("stops calling a kind a default once the user adds another", () => {
      const widened = filterEntries(
        stateOf({ seedKind: "scored", kinds: "AI_AGENT,AI_MODEL" }), DEFAULTS, CTX,
      );
      expect(byKey(widened, "kind-AI_AGENT").isDefault).toBe(false);
      expect(appliedCount(widened)).toBe(2);
    });

    it("treats a seed the user chose as a real filter", () => {
      const seeded = filterEntries(
        stateOf({ seed: "asset-1", seedKind: "asset" }), DEFAULTS, CTX,
      );
      expect(byKey(seeded, "seed").isDefault).toBeFalsy();
      expect(appliedCount(seeded)).toBe(1);
    });
  });

  it("names a combo seed from the legend, and falls back to the id", () => {
    const ctx = { ...CTX, comboLegend: [{ id: "c1", shortLabel: "Privileged agent" }] };
    const named = filterEntries(stateOf({ seed: "c1", seedKind: "combo" }), DEFAULTS, ctx);
    expect(byKey(named, "seed").value).toBe("Privileged agent");

    const unknown = filterEntries(stateOf({ seed: "c9", seedKind: "combo" }), DEFAULTS, ctx);
    expect(byKey(unknown, "seed").value).toBe("c9");
  });

  it("chips depth only when it differs from the deployment default", () => {
    expect(keys(filterEntries(stateOf({ depth: 2 }), DEFAULTS, CTX))).toEqual([]);
    const deep = filterEntries(stateOf({ depth: 3 }), DEFAULTS, CTX);
    expect(byKey(deep, "depth").value).toBe("3");
    // Depth is a reach, not a narrowing — an empty view at depth 3 is not "over-filtered".
    expect(byKey(deep, "depth").isNarrowing).toBeFalsy();
  });

  it("treats a widened node budget as view state, not a filter on the data", () => {
    const wide = filterEntries(
      stateOf({ maxNodes: 200, maxNodesRaw: "200" }), DEFAULTS, CTX,
    );
    expect(byKey(wide, "maxNodes").value).toBe("200 nodes");
    // Raising the budget can only ever show MORE, so it must never make the empty state
    // read "nothing matches these filters".
    expect(isNarrowingSet(wide)).toBe(false);
  });

  it("omits the budget chip when the view is on the configured budget", () => {
    const same = filterEntries(stateOf({ maxNodes: 100, maxNodesRaw: "100" }), DEFAULTS, CTX);
    expect(keys(same)).toEqual([]);
  });

  describe("each patch clears exactly its own filter", () => {
    const state = stateOf({
      seed: "asset-1", seedKind: "asset", depth: 3,
      severities: "CRITICAL,HIGH", kinds: "AI_AGENT,VM",
      projects: "prod", clouds: "AWS",
    });
    const entries = filterEntries(state, DEFAULTS, CTX);

    it("covers every set filter", () => {
      expect(keys(entries)).toEqual([
        "seed", "depth", "sev-CRITICAL", "sev-HIGH",
        "kind-AI_AGENT", "kind-VM", "projects", "clouds",
      ]);
    });

    it("removes one severity and leaves the other standing", () => {
      expect(byKey(entries, "sev-CRITICAL").patch).toEqual({ severities: "HIGH" });
      expect(byKey(entries, "sev-HIGH").patch).toEqual({ severities: "CRITICAL" });
    });

    it("removes one kind and leaves the other standing", () => {
      expect(byKey(entries, "kind-AI_AGENT").patch).toEqual({ kinds: "VM" });
      expect(byKey(entries, "kind-VM").patch).toEqual({ kinds: "AI_AGENT" });
    });

    it("returns depth to the default rather than blanking it", () => {
      expect(byKey(entries, "depth").patch).toEqual({ depth: "2", expand: "" });
    });

    it("drops the expansion set along with the seed it was expanded from", () => {
      expect(byKey(entries, "seed").patch).toEqual({ seed: "", seedKind: "", expand: "" });
    });

    it("touches nothing else", () => {
      const touched = new Set(entries.flatMap((e) => Object.keys(e.patch)));
      expect([...touched].sort()).toEqual([
        "clouds", "depth", "expand", "kinds", "projects", "seed", "seedKind", "severities",
      ]);
    });
  });
});

describe("sectionOf", () => {
  it("routes each chip to the field group that owns it", () => {
    const cases = {
      seed: "start", maxNodes: "start",
      "sev-CRITICAL": "severity", "kind-VM": "kinds",
      depth: "depth", projects: "projects", clouds: "clouds",
    };
    for (const [key, expected] of Object.entries(cases)) {
      expect(sectionOf({ key })).toBe(expected);
    }
  });
});
