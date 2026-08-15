// The `+` palette's entry model, held to the tree it has to produce.
//
// Plain .js for the reason graphChips.test.js writes out: tsconfig has no allowJs, so a .ts
// test importing a client .js module fails `tsc --noEmit` and `npm run check` never reaches
// vitest at all.
//
// Only `paletteEntries` and its three helpers are exercised — everything DOM-shaped in
// queryPalette.js is deliberately on the other side of that line, because there is no jsdom
// here. The contract this pins is the one that can silently go wrong: a pick that does not
// round-trip through the DSL builds a link that opens a different query than the palette
// promised, and nothing on screen would say so.

import { describe, expect, it } from "vitest";

import {
  entriesForTab, literalFor, paletteEntries, paletteRail, searchEntries, stepForPick,
} from "../src/client/js/pages/queryPalette.js";
import {
  addStep, parseQuery, serializeQuery, setEdge,
} from "../src/client/js/pages/graphQuery.js";

/** A vocabulary shaped like the server's, commonest first, as `queryVocabulary` sorts it. */
const VOCAB = {
  kinds: [
    { kind: "AI_AGENT", count: 12 },
    { kind: "SERVICE_ACCOUNT", count: 9 },
    { kind: "AI_GUARDRAIL", count: 4 },
    { kind: "BUCKET", count: 6 },
  ],
  stepsFrom: {
    AI_AGENT: [
      { edge: "RUNS_AS", reverse: false, kind: "SERVICE_ACCOUNT", count: 11 },
      { edge: "USES_MODEL", reverse: false, kind: "AI_MODEL", count: 8 },
      { edge: "PROTECTED_BY", reverse: false, kind: "AI_GUARDRAIL", count: 4 },
      { edge: "ALLOWS_ACCESS_TO", reverse: false, kind: "BUCKET", count: 3 },
      { edge: "HAS_ISSUE", reverse: false, kind: "ISSUE", count: 2 },
      { edge: "USES_TOOL", reverse: false, kind: "AI_TOOL", count: 2 },
      { edge: "CAN_INVOKE", reverse: true, kind: "AI_AGENT", count: 1 },
    ],
    LONE_KIND: [],
  },
};

const ROOT_ROW = { path: [], group: false };
const STEP_ROW = { path: [0], group: false, negate: false, optional: false };

function entries(kind, row) {
  return paletteEntries({ kind, vocab: VOCAB, row: row === undefined ? ROOT_ROW : row });
}

describe("paletteEntries", () => {
  it("offers one entry per relationship the tenant actually holds, commonest first", () => {
    const rel = entries("AI_AGENT").filter((e) => e.section === "relations" && e.count);
    expect(rel.map((e) => e.pick.edge)).toEqual([
      "RUNS_AS", "USES_MODEL", "PROTECTED_BY", "ALLOWS_ACCESS_TO", "HAS_ISSUE", "USES_TOOL",
      "CAN_INVOKE",
    ]);
    // The count is the vocabulary's, not a number this file invented.
    expect(rel[0].count).toBe(11);
    expect(rel[0].label).toBe("Service Account");
    expect(rel[0].pick).toEqual({
      type: "relation", edge: "RUNS_AS", reverse: false, hops: 1, target: "SERVICE_ACCOUNT",
    });
  });

  it("states the direction rather than conjugating the gloss backwards", () => {
    const incoming = entries("AI_AGENT").find((e) => e.pick.reverse);
    expect(incoming.sub).toBe("can invoke (incoming)");
  });

  it("always offers the neighbourhood question, which is no single edge", () => {
    const any = entries("LONE_KIND").filter((e) => e.pick.type === "relation");
    // A kind the vocabulary has nothing to say about still gets a usable palette.
    expect(any).toHaveLength(3);
    expect(any.map((e) => e.pick.hops)).toEqual([1, 2, 3]);
    expect(any.every((e) => e.pick.target === "ANY")).toBe(true);
  });

  it("seeds a boolean block with real relationships, never an empty one", () => {
    const or = entries("AI_AGENT").find((e) => e.id === "op-or");
    expect(or.pick.op).toBe("or");
    expect(or.pick.steps).toHaveLength(2);
    expect(or.pick.steps.map((s) => s.edge)).toEqual(["RUNS_AS", "USES_MODEL"]);
    // This builder has no empty-branch row, so an OR of nothing would be unfinishable.
    const thin = entries("LONE_KIND").find((e) => e.id === "op-or");
    expect(thin.pick.steps).toEqual([{ edge: "ANY", hops: 1, node: { kind: "ANY" } }]);
  });

  it("offers the two step modifiers only where there is a step to modify", () => {
    const onRoot = entries("AI_AGENT", ROOT_ROW).map((e) => e.id);
    // FIND is a starting point, not a relationship: neither flag means anything on it.
    expect(onRoot).not.toContain("op-negate");
    expect(onRoot).not.toContain("op-optional");

    const onStep = entries("SERVICE_ACCOUNT", STEP_ROW);
    expect(onStep.find((e) => e.id === "op-negate").pick)
      .toEqual({ type: "flag", flag: "negate", value: true });
    expect(onStep.find((e) => e.id === "op-optional").pick)
      .toEqual({ type: "flag", flag: "optional", value: true });
  });

  it("reads as its own undo once the flag is set", () => {
    const set = entries("SERVICE_ACCOUNT", { path: [0], group: false, negate: true, optional: true });
    const negate = set.find((e) => e.id === "op-negate");
    expect(negate.pick.value).toBe(false);
    expect(negate.label).toBe("Require this relationship");
    const optional = set.find((e) => e.id === "op-optional");
    expect(optional.pick.value).toBe(false);
    expect(optional.label).toContain("Require");
  });

  it("does not offer NOT on a boolean block, which negating means nothing on", () => {
    const onGroup = entries("AI_AGENT", { path: [0], group: true, op: "or", optional: false });
    expect(onGroup.map((e) => e.id)).not.toContain("op-negate");
    // Optional DOES apply to a group — it is the reason to group a set rather than each member.
    expect(onGroup.find((e) => e.id === "op-optional").sub).toContain("keep the row");
  });
});

describe("the rail", () => {
  it("carries only categories that have something under them", () => {
    const rail = paletteRail(entries("AI_AGENT"));
    const keys = rail.map((t) => t.key);
    expect(keys.slice(0, 2)).toEqual(["popular", "operators"]);
    // Five categories exist; a tab promising relationships this kind does not have would be
    // theatre, so only the ones with entries appear.
    expect(keys).toContain("cat-asset");
    expect(keys).toContain("cat-iam");
    expect(keys).not.toContain("cat-exposure");
  });

  it("counts what each tab will actually show", () => {
    const list = entries("AI_AGENT");
    for (const tab of paletteRail(list)) {
      expect(entriesForTab(list, tab.key).length, tab.key).toBe(tab.count);
    }
  });
});

describe("search", () => {
  it("crosses every tab at once, and matches the literal as well as the words", () => {
    const list = entries("AI_AGENT");
    expect(searchEntries(list, "")).toBeNull();          // no query means "show the tab"
    const byWord = searchEntries(list, "guardrail");
    expect(byWord.map((e) => e.pick.edge)).toEqual(["PROTECTED_BY"]);
    // Someone who knows the DSL can type the edge name itself.
    expect(searchEntries(list, "RUNS_AS").length).toBeGreaterThan(0);
  });
});

describe("what a pick actually does", () => {
  const query = parseQuery("AI_AGENT");

  it("round-trips every relation and group pick through the DSL", () => {
    for (const entry of entries("AI_AGENT")) {
      const pick = entry.pick;
      if (pick.type === "flag") continue;
      const next = addStep(query, [], stepForPick(pick));
      const text = serializeQuery(next);
      expect(parseQuery(text), entry.id).toEqual(next);
      // The detail pane promises a fragment; the URL has to carry that exact fragment, or the
      // pane is describing a query the app does not run.
      expect(text, entry.id).toBe("AI_AGENT(" + entry.detail.literal + ")");
    }
  });

  it("writes a flag onto the step the row names", () => {
    const withStep = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    const negated = setEdge(withStep, [0], { negate: true });
    expect(serializeQuery(negated)).toBe("AI_AGENT(!RUNS_AS.SERVICE_ACCOUNT)");
    const optionalGroup = setEdge(
      parseQuery("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))"), [0],
      { optional: true },
    );
    expect(serializeQuery(optionalGroup))
      .toBe("AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))");
  });

  it("builds the literal with the real serializer, hops and direction included", () => {
    expect(literalFor({ type: "relation", edge: "RUNS_AS", reverse: true, hops: 1, target: "AI_AGENT" }))
      .toBe("~RUNS_AS.AI_AGENT");
    expect(literalFor({ type: "relation", edge: "ANY", reverse: false, hops: 3, target: "ANY" }))
      .toBe("ANY3.ANY");
    expect(literalFor({ type: "flag", flag: "negate", value: true })).toBe("");
  });
});

describe("the detail pane's prose", () => {
  it("borrows the help book where the book has an entry for the target", () => {
    const sa = entries("AI_AGENT").find((e) => e.pick.target === "SERVICE_ACCOUNT");
    expect(sa.detail.blurb).toContain("11 such relationships in this tenant");
    // `agentic-identity` — the app's own words, not a second gloss written in the palette.
    expect(sa.detail.blurb.length).toBeGreaterThan(120);
  });

  it("says how many, and gets the singular right", () => {
    const one = entries("AI_AGENT").find((e) => e.count === 1);
    expect(one.detail.blurb).toContain("1 such relationship in this tenant");
  });
});
