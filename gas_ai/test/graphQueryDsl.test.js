// The client half of the query: the hash DSL, the where param, the builder row model, the
// structural edits, and the translation of the params other pages still send.
//
// The DSL lives only here — the parsed tree is what goes over the wire — so this file is the
// only thing standing between a shared link and the query it was supposed to carry.

import { describe, expect, it } from "vitest";
import {
  addStep,
  applyWhere,
  defaultQuery,
  migrateLegacyParams,
  nodeAt,
  parseQuery,
  parseWhere,
  pathAfterRemoval,
  queryRows,
  remapWhere,
  removeStep,
  serializeQuery,
  serializeWhere,
  setEdge,
  setHidden,
  setKind,
  isGroup,
  replaceStep,
  wrapInGroup,
} from "../src/client/js/pages/graphQuery.js";

const AGENT_RUNS_AS_SA = {
  kind: "AI_AGENT",
  steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
};

describe("parseQuery / serializeQuery", () => {
  it("reads the screenshot's query and writes it back unchanged", () => {
    expect(parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)")).toEqual(AGENT_RUNS_AS_SA);
    expect(serializeQuery(AGENT_RUNS_AS_SA)).toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
  });

  it("an empty param is the default lens, not an error", () => {
    expect(parseQuery("")).toEqual(defaultQuery());
    expect(parseQuery(null)).toEqual({ kind: "AI_AGENT" });
  });

  it("round-trips every flag", () => {
    const cases = [
      "AI_AGENT",
      "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)",
      "AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL)",
      "SERVICE_ACCOUNT(~RUNS_AS.AI_AGENT)",
      "AI_AGENT(*RUNS_AS.SERVICE_ACCOUNT)",
      "AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT)",
      "AI_AGENT(ANY.BUCKET)",
      "AI_AGENT(ANY3.BUCKET)",
      "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'HOSTED_ON.SERVERLESS)",
      "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))",
      "AI_AGENT(~*!RUNS_AS.SERVICE_ACCOUNT)",
    ];
    for (const s of cases) expect(serializeQuery(parseQuery(s))).toBe(normalizeFlags(s));
  });

  it("reads hop counts and treats a bare ANY as one hop", () => {
    expect(parseQuery("AI_AGENT(ANY.BUCKET)").steps[0]).toMatchObject({ edge: "ANY", hops: 1 });
    expect(parseQuery("AI_AGENT(ANY2.BUCKET)").steps[0]).toMatchObject({ edge: "ANY", hops: 2 });
    // One hop is the default, so it is not spelled out on the way back.
    expect(serializeQuery(parseQuery("AI_AGENT(ANY1.BUCKET)"))).toBe("AI_AGENT(ANY.BUCKET)");
  });

  it("survives encodeURIComponent untouched, which is the whole point of the character set", () => {
    const s = "AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL'~*RUNS_AS.!SERVICE_ACCOUNT)";
    expect(encodeURIComponent(s)).toBe(s);
  });

  it("throws on garbage rather than guessing", () => {
    expect(() => parseQuery("AI_AGENT(")).toThrow();
    expect(() => parseQuery("AI_AGENT(RUNS_AS)")).toThrow(/names no target/);
    expect(() => parseQuery("ai_agent")).toThrow();
    expect(() => parseQuery("AI_AGENT)")).toThrow();
    expect(() => parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT")).toThrow(/unclosed/);
  });
});

/** Flags serialize in a fixed order; the parser accepts any. */
function normalizeFlags(s) {
  return s.replace(/([(']|^)([!~*]+)/g, (_m, lead, flags) => {
    const order = ["!", "~", "*"].filter((f) => flags.includes(f)).join("");
    return lead + order;
  });
}

describe("where", () => {
  it("round-trips, ORs repeats of one key, and sorts deterministically", () => {
    const parsed = parseWhere("0.cloud.GCP,0.cloud.AWS,1.inactive.true");
    expect(parsed.get(0).get("cloud")).toEqual({ values: ["GCP", "AWS"], op: "eq" });
    expect(parsed.get(1).get("inactive")).toEqual({ values: ["true"], op: "eq" });
    expect(serializeWhere(parsed)).toBe("0.cloud.GCP,0.cloud.AWS,1.inactive.true");
  });

  it("reads the separator as the OPERATOR, and round-trips it", () => {
    // `.` is whole-value equality, `~` is a substring. It has to be in the grammar rather than
    // inferred from the field's type: `id` is a text field too, and a deep link to one asset
    // must not also open every asset whose id contains it.
    const parsed = parseWhere("0.name~prod,0.id.agent-h-chatbot");
    expect(parsed.get(0).get("name")).toEqual({ values: ["prod"], op: "contains" });
    expect(parsed.get(0).get("id")).toEqual({ values: ["agent-h-chatbot"], op: "eq" });
    expect(serializeWhere(parsed)).toBe("0.id.agent-h-chatbot,0.name~prod");
  });

  it("carries `contains` onto the tree, and omits `op` where it is the default", () => {
    const wire = applyWhere({ kind: "AI_AGENT" }, parseWhere("0.name~prod,0.cloud.GCP"));
    expect(wire.where).toEqual([
      { key: "cloud", values: ["GCP"] },
      { key: "name", values: ["prod"], op: "contains" },
    ]);
  });

  it("encodes values that would otherwise re-split wrong", () => {
    const m = new Map([[0, new Map([["projects", { values: ["CE-DPCP, PORTAL"], op: "eq" }]])]]);
    const text = serializeWhere(m);
    expect(text).not.toContain(", ");
    expect(parseWhere(text).get(0).get("projects"))
      .toEqual({ values: ["CE-DPCP, PORTAL"], op: "eq" });
  });

  it("skips an unreadable entry instead of losing the whole query", () => {
    // A link that lost a fragment to a chat client's line wrapping should still draw.
    const parsed = parseWhere("0.cloud.GCP,garbage,,9,1.inactive.true");
    expect([...parsed.keys()].sort()).toEqual([0, 1]);
  });

  it("folds onto the tree by pre-order index", () => {
    const wire = applyWhere(AGENT_RUNS_AS_SA, parseWhere("0.cloud.GCP,1.inactive.true"));
    expect(wire.where).toEqual([{ key: "cloud", values: ["GCP"] }]);
    expect(wire.steps[0].node.where).toEqual([{ key: "inactive", values: ["true"] }]);
  });

  it("does not count a negated step's subtree, which binds no slot", () => {
    // The evaluator skips it too; if these two walks disagree every later filter lands on the
    // wrong node and the query quietly answers a different question.
    const q = parseQuery("AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL'RUNS_AS.SERVICE_ACCOUNT)");
    const wire = applyWhere(q, parseWhere("1.inactive.true"));
    expect(wire.steps[0].node.where).toBeUndefined();
    expect(wire.steps[1].node.where).toEqual([{ key: "inactive", values: ["true"] }]);
  });
});

describe("queryRows", () => {
  it("gives FIND for the root and THAT for every step, with nesting levels", () => {
    const rows = queryRows(parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))"));
    expect(rows.map((r) => [r.keyword, r.level, r.kind])).toEqual([
      ["FIND", 0, "AI_AGENT"],
      ["THAT", 1, "SERVICE_ACCOUNT"],
      ["THAT", 2, "BUCKET"],
    ]);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.path)).toEqual([[], [0], [0, 0]]);
  });

  it("the root cannot be hidden or removed; a step can", () => {
    const rows = queryRows(AGENT_RUNS_AS_SA);
    expect(rows[0]).toMatchObject({ canHide: false, canRemove: false });
    expect(rows[1]).toMatchObject({ canHide: true, canRemove: true });
  });

  it("a negated step is one row with no slot and no children", () => {
    const rows = queryRows(parseQuery("AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL)"));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ negate: true, index: null, canHide: false });
  });
});

describe("edits", () => {
  it("never mutates the tree it was given", () => {
    const before = JSON.stringify(AGENT_RUNS_AS_SA);
    removeStep(AGENT_RUNS_AS_SA, [0]);
    addStep(AGENT_RUNS_AS_SA, [], { edge: "USES_MODEL", node: { kind: "AI_MODEL" } });
    setKind(AGENT_RUNS_AS_SA, [0], "ACCESS_KEY");
    setHidden(AGENT_RUNS_AS_SA, [0], true);
    expect(JSON.stringify(AGENT_RUNS_AS_SA)).toBe(before);
  });

  it("adds, removes and addresses nested steps", () => {
    let q = defaultQuery();
    q = addStep(q, [], { edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } });
    q = addStep(q, [0], { edge: "ALLOWS_ACCESS_TO", node: { kind: "BUCKET" } });
    expect(serializeQuery(q)).toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
    expect(nodeAt(q, [0, 0]).kind).toBe("BUCKET");
    q = removeStep(q, [0, 0]);
    expect(serializeQuery(q)).toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    q = removeStep(q, [0]);
    expect(serializeQuery(q)).toBe("AI_AGENT");
  });

  it("changing a kind drops the steps chosen against the old one", () => {
    // They were picked from that kind's vocabulary; keeping them builds a query that cannot
    // match and says nothing about why.
    const q = setKind(parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))"), [0], "ACCESS_KEY");
    expect(serializeQuery(q)).toBe("AI_AGENT(RUNS_AS.ACCESS_KEY)");
  });

  it("toggles hidden and rewrites a relationship in place", () => {
    let q = setHidden(AGENT_RUNS_AS_SA, [0], true);
    expect(serializeQuery(q)).toBe("AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT)");
    q = setHidden(q, [0], false);
    expect(serializeQuery(q)).toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    q = setEdge(q, [0], { negate: true });
    expect(serializeQuery(q)).toBe("AI_AGENT(!RUNS_AS.SERVICE_ACCOUNT)");
  });
});

describe("migrateLegacyParams", () => {
  it("leaves a query-carrying link alone", () => {
    expect(migrateLegacyParams({ find: "AI_AGENT", seed: "agent-a" })).toBeNull();
    expect(migrateLegacyParams({})).toBeNull();
  });

  it("turns the inventory's Graph button into a neighbourhood query", () => {
    // inventory.js navigates with { seed: row.id } and nothing else; that link has to keep
    // landing on that asset's surroundings.
    const out = migrateLegacyParams({ seed: "agent-a" });
    expect(out.find).toBe("ANY(*ANY2.ANY)");
    expect(out.where).toBe("0.id.agent-a");
  });

  it("carries depth, and the old node-type lens", () => {
    const out = migrateLegacyParams({ seed: "agent-a", seedKind: "asset", depth: "3", kinds: "AI_AGENT" });
    expect(out.find).toBe("AI_AGENT(*ANY3.ANY)");
    const many = migrateLegacyParams({ kinds: "AI_AGENT,AI_MODEL" });
    expect(many.find).toBe("ANY");
    expect(many.where).toBe("0.kind.AI_AGENT,0.kind.AI_MODEL");
  });

  it("leaves severity, cloud and project as their own params rather than copying them", () => {
    // They are still live hash params that the filter panel writes and rpcParams folds onto
    // node 0. Copying them into `where` too would leave a second, invisible filter that
    // clearing the chip does not touch — the view would stay narrowed by something nothing on
    // screen admits to.
    const out = migrateLegacyParams({ kinds: "AI_AGENT", severities: "CRITICAL,HIGH", clouds: "GCP" });
    expect(out.find).toBe("AI_AGENT");
    expect(out.where).toBe("");
  });

  it("clamps a depth the builder cannot express, the way the old page did", () => {
    expect(migrateLegacyParams({ seed: "a", depth: "9" }).find).toBe("ANY(*ANY3.ANY)");
    // `depth=0` is falsy, so it falls through to the default of 2 rather than clamping up to 1
    // — which is exactly what graphParams did before this, and a saved link must not change
    // the view it opens just because the page behind it was rewritten.
    expect(migrateLegacyParams({ seed: "a", depth: "0" }).find).toBe("ANY(*ANY2.ANY)");
  });
});

describe("groups in the DSL", () => {
  it("round-trips OR and AND blocks, and nests them", () => {
    const cases = [
      "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))",
      "AI_AGENT(AND(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))",
      "AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))",
      "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'!PROTECTED_BY.AI_GUARDRAIL))",
      "AI_AGENT(USES_MODEL.AI_MODEL'OR(A.X'B.Y))".replace("A.X", "RUNS_AS.SERVICE_ACCOUNT").replace("B.Y", "HOSTED_ON.SERVERLESS"),
      "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET)'USES_MODEL.AI_MODEL))",
      "AI_AGENT(OR(AND(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)'HOSTED_ON.SERVERLESS))",
    ];
    for (const s of cases) expect(serializeQuery(parseQuery(s))).toBe(s);
  });

  it("stays inside the character set encodeURIComponent leaves alone", () => {
    const s = "AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'!PROTECTED_BY.AI_GUARDRAIL))";
    expect(encodeURIComponent(s)).toBe(s);
  });

  it("reads a group as a step, not as a relationship called OR", () => {
    const q = parseQuery("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT))");
    expect(isGroup(q.steps[0])).toBe(true);
    expect(q.steps[0]).toEqual({ op: "or", steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }] });
  });

  it("rejects a group that is malformed or wears a flag it cannot mean", () => {
    expect(() => parseQuery("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT)")).toThrow();
    expect(() => parseQuery("AI_AGENT(!OR(RUNS_AS.SERVICE_ACCOUNT))")).toThrow(/takes no ! or ~/);
    expect(() => parseQuery("AI_AGENT(~OR(RUNS_AS.SERVICE_ACCOUNT))")).toThrow(/takes no ! or ~/);
  });

  it("tells a group from a relationship by what FOLLOWS the token, not by the token", () => {
    // `OR(` is a group; `OR.` is a relationship that happens to be spelled OR. This parser is
    // a SYNTAX parser and does not know the edge vocabulary — `validateQuery` on the server is
    // the one that rejects a relationship no graph has, and it does so by name so the message
    // says which. Parsing it here rather than guessing keeps that boundary honest.
    const asEdge = parseQuery("AI_AGENT(OR.SERVICE_ACCOUNT)");
    expect(isGroup(asEdge.steps[0])).toBe(false);
    expect(asEdge.steps[0].edge).toBe("OR");
    expect(isGroup(parseQuery("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT))").steps[0])).toBe(true);
    expect(serializeQuery(parseQuery("AI_AGENT(ANY.BUCKET)"))).toBe("AI_AGENT(ANY.BUCKET)");
  });
});

describe("group rows and edits", () => {
  const OR_Q = parseQuery("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))");

  it("gives the group its own row, taking no slot, with its branches beneath it", () => {
    const rows = queryRows(OR_Q);
    expect(rows.map((r) => [r.keyword, r.level, r.index])).toEqual([
      ["FIND", 0, 0],
      ["OR", 1, null],
      ["THAT", 2, 1],
      ["THAT", 2, 2],
    ]);
    expect(rows[1].group).toBe(true);
    expect(rows[1].branches).toBe(2);
  });

  it("marks OR branches as alternatives and leaves AND children alone", () => {
    expect(queryRows(OR_Q).slice(2).map((r) => r.alt.index)).toEqual([0, 1]);
    const andRows = queryRows(parseQuery("AI_AGENT(AND(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))"));
    expect(andRows.every((r) => !r.alt)).toBe(true);
  });

  it("addresses a branch by path, and reports a group path as having no node", () => {
    expect(nodeAt(OR_Q, [0, 0]).kind).toBe("SERVICE_ACCOUNT");
    expect(nodeAt(OR_Q, [0, 1]).kind).toBe("AI_MODEL");
    // The group itself is punctuation — it has no kind to report.
    expect(nodeAt(OR_Q, [0])).toBeNull();
  });

  it("adds a branch to a group rather than a step to a node", () => {
    const next = addStep(OR_Q, [0], { edge: "HOSTED_ON", node: { kind: "SERVERLESS" } });
    expect(serializeQuery(next))
      .toBe("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL'HOSTED_ON.SERVERLESS))");
  });

  it("prunes a group left with no branches instead of leaving empty punctuation", () => {
    let q = removeStep(OR_Q, [0, 1]);
    expect(serializeQuery(q)).toBe("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT))");
    q = removeStep(q, [0, 0]);
    expect(serializeQuery(q)).toBe("AI_AGENT");
  });

  it("wraps an existing step so a second branch can join it", () => {
    const plain = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    const wrapped = wrapInGroup(plain, [0], "or");
    expect(serializeQuery(wrapped)).toBe("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT))");
    expect(serializeQuery(addStep(wrapped, [0], { edge: "USES_MODEL", node: { kind: "AI_MODEL" } })))
      .toBe("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))");
  });

  it("never mutates the tree it was given", () => {
    const before = JSON.stringify(OR_Q);
    addStep(OR_Q, [0], { edge: "HOSTED_ON", node: { kind: "SERVERLESS" } });
    removeStep(OR_Q, [0, 0]);
    wrapInGroup(OR_Q, [0], "and");
    setKind(OR_Q, [0, 0], "ACCESS_KEY");
    replaceStep(OR_Q, [0, 0], { edge: "USES", node: { kind: "AI_TOOL" } });
    expect(JSON.stringify(OR_Q)).toBe(before);
  });

  // The term pill's edit. It stands in for the two dropdowns the builder used to carry, and
  // the thing those got wrong is exactly what these pin: a relationship and its target are one
  // choice, so changing them is one edit with one rule about what survives it.
  describe("replaceStep", () => {
    const NESTED = "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))";

    it("keeps the steps below when the target kind is unchanged", () => {
      const next = replaceStep(parseQuery(NESTED), [0],
        { edge: "USES", node: { kind: "SERVICE_ACCOUNT" } });
      expect(serializeQuery(next))
        .toBe("AI_AGENT(USES.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
    });

    it("drops them when it changes, for the reason setKind drops them", () => {
      // They were chosen against a vocabulary that no longer applies; keeping them would build
      // a query that cannot match and give no hint why.
      const next = replaceStep(parseQuery(NESTED), [0],
        { edge: "USES_TOOL", node: { kind: "AI_TOOL" } });
      expect(serializeQuery(next)).toBe("AI_AGENT(USES_TOOL.AI_TOOL)");
    });

    it("carries the row's own modifiers across, rather than silently undoing them", () => {
      const q = parseQuery("AI_AGENT(*!RUNS_AS.SERVICE_ACCOUNT)");
      const next = replaceStep(q, [0], { edge: "USES", node: { kind: "SERVICE_ACCOUNT" } });
      // NOT and optional were the reader's assertions about this row, not part of which
      // relationship it names — changing the relationship must not also un-negate it.
      expect(serializeQuery(next)).toBe("AI_AGENT(!*USES.SERVICE_ACCOUNT)");
      // The eye's state belongs to the node and survives the same way.
      const hidden = replaceStep(parseQuery("AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT)"), [0],
        { edge: "USES", node: { kind: "SERVICE_ACCOUNT" } });
      expect(serializeQuery(hidden)).toBe("AI_AGENT(USES.!SERVICE_ACCOUNT)");
    });

    it("leaves no key behind that the parser would not have produced", () => {
      // `parseQuery(serializeQuery(q))` deep-equals `q` is a documented property of this tree.
      // A merging edit would leave the old ANY step's `hops` on a named relationship; this
      // builds the step fresh, so the round trip still holds on the in-memory tree.
      const next = replaceStep(parseQuery("AI_AGENT(ANY3.BUCKET)"), [0],
        { edge: "USES_MODEL", node: { kind: "AI_MODEL" } });
      expect(next.steps[0].hops).toBeUndefined();
      expect(parseQuery(serializeQuery(next))).toEqual(next);
    });

    it("leaves the root and a boolean block alone — neither is a relationship", () => {
      const q = parseQuery(NESTED);
      expect(replaceStep(q, [], { edge: "USES", node: { kind: "AI_TOOL" } })).toBe(q);
      expect(serializeQuery(replaceStep(OR_Q, [0], { edge: "USES", node: { kind: "AI_TOOL" } })))
        .toBe(serializeQuery(OR_Q));
    });
  });

  it("folds where onto branch nodes by their slot, skipping the group", () => {
    const wire = applyWhere(OR_Q, parseWhere("0.cloud.GCP,2.name.gpt"));
    expect(wire.where).toEqual([{ key: "cloud", values: ["GCP"] }]);
    expect(wire.steps[0].steps[0].node.where).toBeUndefined();
    expect(wire.steps[0].steps[1].node.where).toEqual([{ key: "name", values: ["gpt"] }]);
  });
});

/**
 * `where` is keyed by pre-order SLOT, and almost every structural edit renumbers slots. These
 * are the cases where a filter would otherwise slide onto a node nobody put it on — which is
 * the worst failure this param has, because every chip still reads correctly while the query
 * answers something else.
 */
describe("remapWhere", () => {
  const w = (text) => parseWhere(text);
  const flat = (map) => [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, m]) => i + ":" + [...m.keys()].sort().join("+"));

  it("holds a filter on its node when a step is inserted ABOVE it", () => {
    // slots: 0 agent, 1 model. Add a step under the agent BEFORE the model? Appends land last,
    // so the interesting case is a step added under an EARLIER node, which pushes the later
    // node's slot up.
    const before = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)");
    expect(flat(w("2.name.gpt"))).toEqual(["2:name"]);          // the model is slot 2
    const after = addStep(before, [0], { edge: "ALLOWS_ACCESS_TO", node: { kind: "BUCKET" } });
    // The bucket takes slot 2 and the model moves to 3; the filter has to follow the model.
    expect(flat(remapWhere(before, after, w("2.name.gpt")))).toEqual(["3:name"]);
  });

  it("follows a node when an earlier step is negated and its slot disappears", () => {
    const before = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)");
    const after = setEdge(before, [0], { negate: true });
    // A negated step binds nothing, so the service account's slot goes and the model drops
    // from 2 to 1. The filter on the service account itself has nowhere to live and is dropped.
    expect(flat(remapWhere(before, after, w("2.name.gpt")))).toEqual(["1:name"]);
    expect(flat(remapWhere(before, after, w("1.inactive.true")))).toEqual([]);
  });

  it("drops a removed subtree's filters and shifts its later siblings' down", () => {
    const before = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)");
    const after = removeStep(before, [0]);
    const moved = remapWhere(before, after, w("0.cloud.GCP,1.inactive.true,2.name.gpt"),
      pathAfterRemoval([0]));
    // The agent keeps slot 0, the removed identity's filter goes, the model lands on 1.
    expect(flat(moved)).toEqual(["0:cloud", "1:name"]);
  });

  it("keeps a filter on the root through every edit", () => {
    const before = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    for (const after of [
      addStep(before, [], { edge: "USES_MODEL", node: { kind: "AI_MODEL" } }),
      setEdge(before, [0], { negate: true }),
      removeStep(before, [0]),
    ]) {
      expect(flat(remapWhere(before, after, w("0.cloud.GCP"), pathAfterRemoval([0]))))
        .toEqual(["0:cloud"]);
    }
  });

  it("drops rather than guesses when a path cannot be placed", () => {
    // Changing a node's kind drops its steps, so anything filtered below it is gone. Dropping
    // is the safe direction: the chip disappears, which is visible, where a filter silently
    // re-pointed at another node is not.
    const before = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    const after = setKind(before, [], "BUCKET");
    expect(flat(remapWhere(before, after, w("0.cloud.GCP,1.inactive.true")))).toEqual(["0:cloud"]);
  });

  it("survives a hidden node, which still binds and still takes a slot", () => {
    const before = parseQuery("AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
    const after = addStep(before, [], { edge: "USES_MODEL", node: { kind: "AI_MODEL" } });
    // Hidden drops COLUMNS, not the binding — slots 0/1/2 are agent, identity, bucket.
    expect(flat(remapWhere(before, after, w("1.inactive.true,2.name.logs"))))
      .toEqual(["1:inactive", "2:name"]);
  });
});

describe("parseWhere is unbreakable by a mangled link", () => {
  it("skips a truncated percent-escape instead of throwing", () => {
    // It runs on the first line of the page's render, so a throw here is not a lost filter —
    // it is a blank workbench. `where` is the half a link most often loses to a chat client.
    expect(() => parseWhere("0.name~prod%2")).not.toThrow();
    const parsed = parseWhere("0.cloud.GCP,0.name~prod%2,1.inactive.true");
    expect([...parsed.keys()].sort()).toEqual([0, 1]);
    expect(parsed.get(0).get("cloud")).toEqual({ values: ["GCP"], op: "eq" });
    expect(parsed.get(0).get("name")).toBeUndefined();
  });
});
