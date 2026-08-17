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
  currentEntryId, entriesForTab, kindList, literalFor, mergeVocab, paletteEntries, paletteRail,
  searchEntries, stepForPick, stepsFromKinds,
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
    // A second kind with its own relationships, one of which — HAS_ISSUE → ISSUE — the agent has
    // too. That overlap is what makes the union's dedup and its summed count observable.
    BUCKET: [
      { edge: "ALLOWS_ACCESS_TO", reverse: true, kind: "SERVICE_ACCOUNT", count: 20 },
      { edge: "HAS_ISSUE", reverse: false, kind: "ISSUE", count: 5 },
    ],
  },
};

const ROOT_ROW = { path: [], group: false };
const STEP_ROW = { path: [0], group: false, negate: false, optional: false };

function entries(kind, row) {
  return paletteEntries({ kind, vocab: VOCAB, row: row === undefined ? ROOT_ROW : row });
}

function inMode(mode, kind, row) {
  return paletteEntries({ kind, vocab: VOCAB, row: row === undefined ? ROOT_ROW : row, mode });
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

  it("offers NOT only where the domain would accept it", () => {
    // `validateQuery` refuses a negated step that carries further steps ("nothing to walk from")
    // and one that is also optional. This used to offer NOT on any relationship at all, so
    // negating a row with a hop under it built a query the server threw on — a load failure for
    // something the builder had just offered.
    const withHop = { ...STEP_ROW, hasSteps: true };
    expect(entries("SERVICE_ACCOUNT", withHop).map((e) => e.id)).not.toContain("op-negate");
    const opt = { ...STEP_ROW, optional: true };
    expect(entries("SERVICE_ACCOUNT", opt).map((e) => e.id)).not.toContain("op-negate");
    // Taking it back OFF stays reachable, or a row negated by an older link would be stuck.
    const stuck = { ...STEP_ROW, negate: true, hasSteps: true };
    expect(entries("SERVICE_ACCOUNT", stuck).find((e) => e.id === "op-negate").pick)
      .toEqual({ type: "flag", flag: "negate", value: false });
  });

  it("no longer offers a boolean block — the row's keyword owns that now", () => {
    // "Either of — OR" appended a group seeded with two BRAND-NEW relationships, which is not
    // what anyone wants when they want an OR: they want two conditions already on screen to
    // become alternatives. The keyword pill does that, on the row it describes.
    for (const mode of ["add", "replace", "entity"]) {
      const ids = inMode(mode, "AI_AGENT", STEP_ROW).map((e) => e.id);
      expect(ids, mode).not.toContain("op-or");
      expect(ids, mode).not.toContain("op-and");
    }
    // `stepForPick` keeps its group branch regardless: a block from an older shared link still
    // has to render, and a hand-edited one still has to parse.
    expect(stepForPick({ type: "group", op: "or", steps: [] })).toEqual({ op: "or", steps: [] });
  });
});

// The two modes that replaced the builder's caret dropdowns. What they must NOT offer is as
// load-bearing as what they must: the whole point of routing the term pill here was that one
// control should do one job, and a stray operator or shortcut leaking into a replace would put
// the second editing model back in a different costume.
describe("entity mode — what to FIND", () => {
  it("offers every kind the tenant holds, plus the wildcard, and nothing else", () => {
    const list = inMode("entity", "AI_AGENT");
    expect(list.map((e) => e.pick.kind)).toEqual([
      "AI_AGENT", "SERVICE_ACCOUNT", "AI_GUARDRAIL", "BUCKET", "ANY",
    ]);
    // Declaration order, the way the vocabulary hands them over and the way the legend reads —
    // not resorted by count, which would reshuffle the picker between two tenants.
    expect(list.every((e) => e.pick.type === "kind")).toBe(true);
    expect(list.every((e) => e.section === "entities")).toBe(true);
  });

  it("says how many of each this landscape holds, so an empty corner is visible", () => {
    const agent = inMode("entity", "AI_AGENT").find((e) => e.pick.kind === "AI_AGENT");
    expect(agent.count).toBe(12);
    // The tally is the row's count column; the sub-line names the category instead, so the two
    // are not the same number printed twice.
    expect(agent.sub).toBe("AI assets & compute");
    expect(agent.detail.blurb).toContain("12 AI Agent nodes in this tenant");
    // The literal is what `find=` actually carries for a root, from the real serializer.
    expect(agent.detail.literal).toBe("AI_AGENT");
    expect(literalFor(agent.pick)).toBe("AI_AGENT");
  });

  it("warns rather than staying silent about a kind the graph holds none of", () => {
    const [only] = paletteEntries({
      kind: "AI_AGENT", row: ROOT_ROW, mode: "entity",
      vocab: { kinds: [{ kind: "AI_AGENT", count: 0 }], stepsFrom: {} },
    });
    expect(only.detail.blurb).toContain("will answer nothing");
  });

  it("carries no relationship, operator, property or shortcut", () => {
    const sections = new Set(inMode("entity", "AI_AGENT").map((e) => e.section));
    expect([...sections]).toEqual(["entities"]);
  });

  it("offers the same one list when the row already names several kinds", () => {
    // A multi-select adds no section and no second mode — it adds PRESSED STATE, which lives in
    // the DOM. One mode, one job, however many kinds are on.
    const sections = new Set(inMode("entity", ["AI_AGENT", "BUCKET"]).map((e) => e.section));
    expect([...sections]).toEqual(["entities"]);
    expect(inMode("entity", ["AI_AGENT", "BUCKET"]).map((e) => e.id))
      .toEqual(inMode("entity", "AI_AGENT").map((e) => e.id));
  });
});

// "AI agents and AI deployments that reach sensitive data" — one node, several kinds. Everything
// the palette offers such a node is arithmetic on the vocabulary it already holds, so none of
// this needed a wire change; what it needs is the union/intersection split to be the right way
// round in each place.
describe("a palette opened on several kinds", () => {
  it("unions the relationships, dedupes the shared one and adds its counts up", () => {
    const rel = stepsFromKinds(VOCAB, ["AI_AGENT", "BUCKET"]);
    const id = (e) => e.edge + (e.reverse ? "<" : ">") + e.kind;
    // Deduped by (edge, direction, target) — the same identity the server builds stepsFrom with.
    expect(rel.filter((e) => id(e) === "HAS_ISSUE>ISSUE")).toHaveLength(1);
    // ...and the count is the sum, because it answers "how many nodes will this find" for the
    // whole selection rather than for whichever kind was picked first.
    expect(rel.find((e) => id(e) === "HAS_ISSUE>ISSUE").count).toBe(7);
    // A reverse hop is NOT the same relationship as the forward one, even on the same edge.
    expect(rel.map(id)).toContain("ALLOWS_ACCESS_TO<SERVICE_ACCOUNT");
    expect(rel.map(id)).toContain("ALLOWS_ACCESS_TO>BUCKET");
    // Commonest first over the MERGED set: the bucket's busiest hop now leads, and HAS_ISSUE has
    // climbed past PROTECTED_BY on the strength of the two kinds together.
    expect(rel.map(id)).toEqual([
      "ALLOWS_ACCESS_TO<SERVICE_ACCOUNT", "RUNS_AS>SERVICE_ACCOUNT", "USES_MODEL>AI_MODEL",
      "HAS_ISSUE>ISSUE", "PROTECTED_BY>AI_GUARDRAIL", "ALLOWS_ACCESS_TO>BUCKET",
      "USES_TOOL>AI_TOOL", "CAN_INVOKE<AI_AGENT",
    ]);
    // One kind is the list the server sent, untouched — so nothing about a single-kind palette
    // is routed through the merge.
    expect(stepsFromKinds(VOCAB, ["AI_AGENT"])).toBe(VOCAB.stepsFrom.AI_AGENT);
  });

  it("offers every union'd relationship as a real, round-trippable step", () => {
    // The union is only useful if each entry still builds a query the DSL can carry — a merged
    // entry that lost its `reverse` would append a step pointing the wrong way.
    for (const e of inMode("add", ["AI_AGENT", "BUCKET"]).filter((x) => x.pick.type === "relation")) {
      const next = addStep(parseQuery("AI_AGENT"), [], stepForPick(e.pick));
      expect(parseQuery(serializeQuery(next))).toEqual(next);
    }
  });

  it("INTERSECTS the fields and UNIONS their values, counts added up", () => {
    // The asymmetry the domain documents: a field only some kinds can answer would silently
    // exclude the rest, but where a field IS common every kind's values belong in the list.
    const merged = mergeVocab([
      {
        fields: [{ key: "cloud", label: "Cloud", type: "choice" }, { key: "publisher", label: "Publisher", type: "text" }],
        values: [{ key: "cloud", values: [{ value: "gcp", count: 3 }, { value: "aws", count: 1 }] }],
      },
      {
        fields: [{ key: "cloud", label: "Cloud", type: "choice" }, { key: "email", label: "Email", type: "text" }],
        values: [{ key: "cloud", values: [{ value: "gcp", count: 4 }, { value: "azure", count: 2 }] }],
      },
    ]);
    expect(merged.fields.map((f) => f.key)).toEqual(["cloud"]);
    expect(merged.values[0].values).toEqual([
      { value: "gcp", count: 7 }, { value: "aws", count: 1 }, { value: "azure", count: 2 },
    ]);
    // One kind is passed straight back, not rebuilt — the single-kind path is unchanged.
    const one = { fields: [], values: [] };
    expect(mergeVocab([one])).toBe(one);
    expect(mergeVocab([])).toBeNull();
  });

  it("reads a bare kind, a list, and an empty list as something askable", () => {
    expect(kindList("AI_AGENT")).toEqual(["AI_AGENT"]);
    expect(kindList(["AI_AGENT", "BUCKET"])).toEqual(["AI_AGENT", "BUCKET"]);
    // No kind at all is the wildcard, never an empty offer: a palette with nothing in it is a
    // dead end, and "every kind" is the honest reading of "unspecified".
    expect(kindList([])).toEqual(["ANY"]);
    expect(kindList(null)).toEqual(["ANY"]);
  });

  it("opens on the first selected kind, and on nothing for a multi-kind target", () => {
    // Entity mode marks EVERY selected kind as pressed; `currentEntryId` is only the row the
    // panel opens ON, so the first is as good an anchor as any.
    expect(currentEntryId("entity", { kinds: ["BUCKET", "AI_AGENT"] })).toBe("kind-BUCKET");
    expect(currentEntryId("entity", { kind: "AI_AGENT" })).toBe("kind-AI_AGENT");
  });
});

describe("replace mode — what this relationship is", () => {
  it("offers the same relationships add mode does", () => {
    const rel = (mode) => inMode(mode, "AI_AGENT", STEP_ROW)
      .filter((e) => e.pick.type === "relation").map((e) => e.id);
    expect(rel("replace")).toEqual(rel("add"));
  });

  it("offers nothing additive — those belong to the +", () => {
    const sections = new Set(inMode("replace", "AI_AGENT", STEP_ROW).map((e) => e.section));
    // A shortcut expands to several steps and a replace has one step to give it; a property
    // narrows a node rather than swapping a hop; NOT and Optional are one button to the right.
    expect([...sections]).toEqual(["relations"]);
  });

  it("keeps a named target reachable through the neighbourhood question", () => {
    // `ANY2.BUCKET` — "a bucket somewhere within two hops" — is in the DSL's own documented
    // grammar, and the retired dropdowns could build it because their target picker went wide
    // for any ANY edge. A replace starting from a step that already names a target must be
    // able to loosen the relationship without throwing the target away.
    const row = { ...STEP_ROW, edge: "RUNS_AS", reverse: false, hops: 0, kind: "SERVICE_ACCOUNT" };
    const aimed = inMode("replace", "AI_AGENT", row)
      .filter((e) => e.pick.edge === "ANY" && e.pick.target === "SERVICE_ACCOUNT");
    expect(aimed.map((e) => e.pick.hops)).toEqual([1, 2, 3]);
    expect(aimed[1].detail.literal).toBe("ANY2.SERVICE_ACCOUNT");
    expect(aimed[1].label).toBe("Service Account");
  });

  it("offers only the wide hop question where nothing has been aimed yet", () => {
    // The `+` starts from a node, not from a step, so there is no target to preserve — and add
    // mode has never offered the aimed variant.
    const wide = entries("AI_AGENT", STEP_ROW).filter((e) => e.pick.edge === "ANY");
    expect(wide).toHaveLength(3);
    expect(wide.every((e) => e.pick.target === "ANY")).toBe(true);
  });
});

describe("opening on what the row already says", () => {
  // The id scheme is minted in paletteEntries and read back by currentEntryId. Spelled out
  // twice it would drift, and the failure is silent — a palette that opens on the wrong row
  // still works, so nothing else would ever report it.
  const has = (list, id) => list.some((e) => e.id === id);

  it("names an entry paletteEntries actually produces, for every shape of step", () => {
    const add = entries("AI_AGENT", STEP_ROW);
    expect(has(add, currentEntryId("replace", {
      path: [0], edge: "RUNS_AS", reverse: false, kind: "SERVICE_ACCOUNT",
    }))).toBe(true);
    // A reversed edge and a hop wildcard are the two shapes with their own id spelling.
    expect(has(add, currentEntryId("replace", {
      path: [0], edge: "CAN_INVOKE", reverse: true, kind: "AI_AGENT",
    }))).toBe(true);
    expect(has(add, currentEntryId("replace", {
      path: [0], edge: "ANY", hops: 2, kind: "ANY",
    }))).toBe(true);
    expect(has(inMode("entity", "AI_AGENT"),
      currentEntryId("entity", { path: [], kind: "BUCKET" }))).toBe(true);
  });

  it("tells an aimed hop step apart from a wide one", () => {
    // `ANY2.BUCKET` and `ANY2.ANY` are two different questions, so they are two entries and
    // two ids — otherwise a replace opened on a step aimed at a bucket would highlight the
    // wildcard and read as though the target had already been thrown away.
    const row = { path: [0], edge: "ANY", hops: 2, kind: "SERVICE_ACCOUNT" };
    expect(currentEntryId("replace", row)).toBe("rel-any-2-SERVICE_ACCOUNT");
    expect(has(inMode("replace", "AI_AGENT", row), currentEntryId("replace", row))).toBe(true);
  });

  it("reads a bare ANY as one hop, the way the tree does", () => {
    expect(currentEntryId("replace", { edge: "ANY" })).toBe("rel-any-1");
  });

  it("answers empty where there is nothing to open on", () => {
    expect(currentEntryId("replace", null)).toBe("");
    expect(currentEntryId("add", ROOT_ROW)).toBe("");   // the root has no step
  });
});

describe("the rail", () => {
  it("carries only categories that have something under them", () => {
    const rail = paletteRail(entries("AI_AGENT"));
    const keys = rail.map((t) => t.key);
    // No Operators tab on the ROOT: the blocks are gone and the two step modifiers need a step.
    expect(keys.slice(0, 2)).toEqual(["popular", "properties"]);
    expect(paletteRail(entries("AI_AGENT", STEP_ROW)).map((t) => t.key)).toContain("operators");
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
