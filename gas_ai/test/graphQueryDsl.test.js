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
  kindsOverlap,
  setKind,
  setKinds,
  isGroup,
  pathAfterRegroup,
  replaceStep,
  setConjunction,
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
      // Several kinds at one position, joined by `-`: one node asking for either, at the root
      // and at the far end of a step, hidden and with steps of its own hanging off it.
      "AI_AGENT-AI_DEPLOYMENT",
      "AI_AGENT-AI_DEPLOYMENT-AI_TOOL(RUNS_AS.SERVICE_ACCOUNT)",
      "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT-USER_ACCOUNT)",
      "AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT-USER_ACCOUNT)",
      "AI_AGENT-AI_DEPLOYMENT(RUNS_AS.!SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))",
    ];
    for (const s of cases) expect(serializeQuery(parseQuery(s))).toBe(normalizeFlags(s));
  });

  it("reads several kinds at one position as ONE node, not as two steps", () => {
    // The user's question — "AI agents AND AI deployments that reach sensitive data" — is one
    // node looking for either kind. Two nodes would be two columns, two slots and two `where`
    // indices for what the reader sees as one term.
    const q = parseQuery("AI_AGENT-AI_DEPLOYMENT(RUNS_AS.SERVICE_ACCOUNT)");
    expect(q.kind).toEqual(["AI_AGENT", "AI_DEPLOYMENT"]);
    expect(q.steps).toHaveLength(1);
    expect(queryRows(q).map((r) => r.index)).toEqual([0, 1]);
    // One kind stays the bare string it has always been, so every existing query — and every
    // golden payload — is the same object it was before multi-kind existed.
    expect(parseQuery("AI_AGENT").kind).toBe("AI_AGENT");
  });

  it("keeps a written order rather than normalising it", () => {
    // `kindKey` is compared across the wire by value (graphQueryWalk.test.js), and the server's
    // validator keeps what it is sent for exactly this reason. Reordering on one side alone
    // would make a shared link describe two different nodes to the two halves of the app.
    expect(serializeQuery(parseQuery("AI_DEPLOYMENT-AI_AGENT"))).toBe("AI_DEPLOYMENT-AI_AGENT");
  });

  it("rejects a kind list the parser cannot read", () => {
    expect(() => parseQuery("AI_AGENT-")).toThrow();
    expect(() => parseQuery("AI_AGENT-ai_model")).toThrow();
    expect(() => parseQuery("-AI_AGENT")).toThrow();
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
    // `-` joins a kind list, and it is the ONLY character left that survives this: the spared set
    // is `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, the grammar has spent `. ' ( ) ! ~ *`, `_` lives inside
    // tokens, and lowercase has to stay a parse error. A comma would have encoded to %2C.
    const many = "AI_AGENT-AI_DEPLOYMENT(RUNS_AS.!SERVICE_ACCOUNT-USER_ACCOUNT)";
    expect(encodeURIComponent(many)).toBe(many);
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

  it("reads the quantifier flags off the key, and round-trips them in one order", () => {
    // The same two characters `find=` puts on a step, in the same order-free prefix set.
    const parsed = parseWhere("0.!cloud.GCP,0.*projects.A,1.!*tags.env:prod,1.!name~x");
    expect(parsed.get(0).get("cloud")).toEqual({ values: ["GCP"], op: "eq", negate: true });
    expect(parsed.get(0).get("projects")).toEqual({ values: ["A"], op: "eq", all: true });
    expect(parsed.get(1).get("tags"))
      .toEqual({ values: ["env:prod"], op: "eq", all: true, negate: true });
    // Orthogonal to the separator: a substring match negates the same way.
    expect(parsed.get(1).get("name")).toEqual({ values: ["x"], op: "contains", negate: true });
    // Written back in ONE fixed order, so a link that differs only in flag order cannot exist.
    expect(serializeWhere(parsed))
      .toBe("0.!cloud.GCP,0.*projects.A,1.!name~x,1.!*tags.env%3Aprod");
    expect(serializeWhere(parseWhere("0.*!cloud.GCP"))).toBe("0.!*cloud.GCP");
  });

  it("leaves a link written before the flags existed meaning what it meant", () => {
    // The guarantee that matters most: no flags is the old reading, everywhere.
    const parsed = parseWhere("0.cloud.GCP,0.cloud.AWS,0.name~prod");
    expect(parsed.get(0).get("cloud")).toEqual({ values: ["GCP", "AWS"], op: "eq" });
    expect(parsed.get(0).get("name")).toEqual({ values: ["prod"], op: "contains" });
    expect(applyWhere({ kind: "AI_AGENT" }, parsed).where).toEqual([
      { key: "cloud", values: ["GCP", "AWS"] },
      { key: "name", values: ["prod"], op: "contains" },
    ]);
  });

  it("carries the flags onto the tree instead of dropping them at the wire", () => {
    // `applyWhere` rebuilds the payload field by field, so a flag parsed out of the URL and not
    // named there vanishes silently — the query answers a different question than the chip says.
    const wire = applyWhere({ kind: "AI_AGENT" }, parseWhere("0.!*projects.A,0.*tags.env:prod"));
    expect(wire.where).toEqual([
      { key: "projects", values: ["A"], all: true, negate: true },
      { key: "tags", values: ["env:prod"], all: true },
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

  // Entity mode is a live multi-select: widening a selection is now the COMMON edit, so the
  // drop rule that used to fire on any kind change has to tell widening from replacing.
  describe("setKinds", () => {
    const NESTED = "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))";

    it("keeps the steps below when the old and new sets OVERLAP", () => {
      // Widening. The relationships already there are still traversable by the kind still there,
      // and wiping the query every time someone adds a second kind would make the multi-select
      // unusable — you would rebuild from scratch after every toggle.
      const wider = setKinds(parseQuery(NESTED), [], ["AI_AGENT", "AI_DEPLOYMENT"]);
      expect(serializeQuery(wider)).toBe("AI_AGENT-AI_DEPLOYMENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
      // And narrowing back, which is the same edit run the other way.
      expect(serializeQuery(setKinds(wider, [], ["AI_DEPLOYMENT"]))).toBe(NESTED
        .replace("AI_AGENT", "AI_DEPLOYMENT"));
    });

    it("drops them when the sets are DISJOINT, which is the old rule", () => {
      const q = setKinds(parseQuery(NESTED), [], ["BUCKET", "DATABASE"]);
      expect(serializeQuery(q)).toBe("BUCKET-DATABASE");
    });

    it("treats ANY as overlapping everything, in both directions", () => {
      // ANY is the union of every kind, so AI_AGENT is INSIDE it — by tokens alone the two look
      // disjoint, and reading them that way meant switching a query to "Any node" deleted the
      // steps below. Widening a question must never lose work, and `FIND ANY THAT runs as
      // Service Account` is a shape the app writes for itself.
      expect(serializeQuery(setKinds(parseQuery(NESTED), [], ["ANY"])))
        .toBe("ANY(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
      expect(serializeQuery(setKinds(parseQuery("ANY(RUNS_AS.SERVICE_ACCOUNT)"), [], ["AI_AGENT"])))
        .toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
      expect(kindsOverlap(["ANY"], ["BUCKET"])).toBe(true);
      expect(kindsOverlap("AI_AGENT", ["BUCKET", "AI_AGENT"])).toBe(true);
      expect(kindsOverlap(["AI_AGENT"], ["BUCKET"])).toBe(false);
    });

    it("normalises what it writes so the tree still round-trips", () => {
      // One kind is a bare string, duplicates drop, and ANY swallows the rest — the same three
      // rules the parser and the server's validator apply, applied here so no edit can produce a
      // tree `parseQuery(serializeQuery(q))` would not reproduce.
      const one = setKinds(parseQuery("AI_AGENT"), [], ["AI_DEPLOYMENT"]);
      expect(one.kind).toBe("AI_DEPLOYMENT");
      expect(setKinds(parseQuery("AI_AGENT"), [], ["BUCKET", "BUCKET"]).kind).toBe("BUCKET");
      expect(setKinds(parseQuery("AI_AGENT"), [], ["ANY", "BUCKET"]).kind).toBe("ANY");
      const many = setKinds(parseQuery("AI_AGENT"), [], ["AI_AGENT", "AI_DEPLOYMENT"]);
      expect(parseQuery(serializeQuery(many))).toEqual(many);
    });

    it("is a no-op on the same set however it is ordered, and on an empty one", () => {
      // A re-pick has to be identity: the bar returns before committing, and the page clears
      // `columns` and `page` on every patch, so an "edit" that changed nothing would still
      // reset the table.
      const q = parseQuery("AI_AGENT-AI_DEPLOYMENT(RUNS_AS.SERVICE_ACCOUNT)");
      // The same set in the other order writes NOTHING — so the node keeps the order it had,
      // rather than a reorder-only "edit" changing the URL and the node's identity with it.
      expect(setKinds(q, [], ["AI_DEPLOYMENT", "AI_AGENT"])).toEqual(q);
      expect(setKinds(q, [], [])).toBe(q);
    });

    it("edits a kind list on a nested node, not only the root", () => {
      const q = setKinds(parseQuery(NESTED), [0], ["SERVICE_ACCOUNT", "USER_ACCOUNT"]);
      expect(serializeQuery(q))
        .toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT-USER_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
    });

    it("never mutates the tree it was given", () => {
      const before = JSON.stringify(AGENT_RUNS_AS_SA);
      setKinds(AGENT_RUNS_AS_SA, [], ["AI_AGENT", "AI_DEPLOYMENT"]);
      setKinds(AGENT_RUNS_AS_SA, [0], ["BUCKET"]);
      expect(JSON.stringify(AGENT_RUNS_AS_SA)).toBe(before);
    });
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

  it("folds the retired panel's params into where, where they always belonged", () => {
    // They were never anything but `where` filters on node 0 — `rpcParams` folded them onto it
    // on every request, from their own hash params. With the panel gone they are folded once,
    // here, so there is one copy of the question and it is the one the builder shows.
    const out = migrateLegacyParams({ kinds: "AI_AGENT", severities: "CRITICAL,HIGH", clouds: "GCP" });
    expect(out.find).toBe("AI_AGENT");
    expect(out.where).toBe("0.cloud.GCP,0.severity.CRITICAL,0.severity.HIGH");
  });

  it("folds them even when the link already carries a query", () => {
    // THE GUARD THAT USED TO STOP THIS. Every saved view carries `find`, so an early return on
    // it left the panel's params behind — and with nothing folding them any more, a saved view
    // would have silently reopened WIDER than it was saved, with nothing on screen saying so.
    const out = migrateLegacyParams({ find: "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)", severities: "HIGH" });
    expect(out.find).toBeUndefined();          // the query it already had is left alone
    expect(out.where).toBe("0.severity.HIGH");
    // Nothing to fold and a query already present: nothing to do at all.
    expect(migrateLegacyParams({ find: "AI_AGENT", where: "0.cloud.GCP" })).toBeNull();
  });

  it("folds ONTO an existing where rather than over it", () => {
    const out = migrateLegacyParams({ find: "AI_AGENT", where: "0.name~prod", clouds: "GCP" });
    expect(out.where).toBe("0.cloud.GCP,0.name~prod");
  });

  it("lets the visible filter win where both name one field", () => {
    // A filter written in the builder is on screen and editable; a panel param was neither.
    // The old `rpcParams` fold went the other way and silently overwrote the visible one, so
    // the bar displayed a filter that was not the one being applied.
    const out = migrateLegacyParams({ find: "AI_AGENT", where: "0.!severity.HIGH", severities: "CRITICAL" });
    expect(out.where).toBe("0.!severity.HIGH");
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
      "AI_AGENT-AI_DEPLOYMENT(OR(RUNS_AS.SERVICE_ACCOUNT-USER_ACCOUNT'USES_MODEL.AI_MODEL))",
    ];
    for (const s of cases) expect(serializeQuery(parseQuery(s))).toBe(s);
  });

  it("stays inside the character set encodeURIComponent leaves alone", () => {
    const s = "AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'!PROTECTED_BY.AI_GUARDRAIL))";
    expect(encodeURIComponent(s)).toBe(s);
    const many = "AI_AGENT-AI_DEPLOYMENT(*OR(RUNS_AS.SERVICE_ACCOUNT-USER_ACCOUNT'HOSTED_ON.SERVERLESS))";
    expect(encodeURIComponent(many)).toBe(many);
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

  it("writes a run down the rows instead of giving it a header and indenting under it", () => {
    // The group keeps its place in the TREE — it is what the server evaluates and what `find=`
    // carries — but it gets no row, and its branches rise to the level it occupied so they line
    // up with the ordinary conditions around them.
    const rows = queryRows(OR_Q);
    expect(rows.map((r) => [r.keyword, r.conj, r.level, r.index])).toEqual([
      ["FIND", null, 0, 0],
      ["THAT", null, 1, 1],
      ["THAT", "or", 1, 2],
    ]);
    expect(rows.some((r) => r.group)).toBe(false);
    // Both branches name the run they belong to, so the bar can bracket them together.
    expect(rows.slice(1).map((r) => r.runOf)).toEqual(["0", "0"]);
    // The first branch joins nothing above it; the second joins the first.
    expect(rows.map((r) => r.canJoin)).toEqual([false, false, true]);
  });

  it("reads a conjunction off each row, and lets the runs be read straight down", () => {
    const conj = (text) => queryRows(parseQuery(text)).map((r) => r.conj);
    // Plain siblings are ANDed — the domain says so and the evaluator agrees.
    expect(conj("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)"))
      .toEqual([null, null, "and"]);
    // `(A OR B) AND C` reads exactly as written, top to bottom, with no precedence to know.
    expect(conj("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)'HAS_ISSUE.ISSUE)"))
      .toEqual([null, null, "or", "and"]);
    // A run's FIRST branch stands where the run stands, so it inherits the run's own join.
    expect(conj("AI_AGENT(HAS_ISSUE.ISSUE'OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))"))
      .toEqual([null, null, "and", "or"]);
    // A nested hop starts a new level: its first step is the first thing said about that
    // entity, and joins nothing above it.
    expect(conj("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET'HAS_ISSUE.ISSUE))"))
      .toEqual([null, null, null, "and"]);
  });

  it("keeps drawing a block for the two shapes a run cannot say", () => {
    // `optional` is about the SET — "match one of these, or keep the row anyway" — and a run has
    // no line of its own to carry it.
    const opt = queryRows(parseQuery("AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))"));
    expect(opt.map((r) => [r.keyword, r.level])).toEqual([
      ["FIND", 0], ["OR", 1], ["THAT", 2], ["THAT", 2],
    ]);
    expect(opt[1]).toMatchObject({ group: true, branches: 2, optional: true });
    // Nesting is the one thing a flat column of AND/OR prefixes genuinely cannot say without
    // precedence rules, so it stays indented, where the nesting is visible.
    const nested = queryRows(parseQuery(
      "AI_AGENT(OR(AND(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)'HAS_ISSUE.ISSUE))"));
    expect(nested.map((r) => [r.keyword, r.level])).toEqual([
      ["FIND", 0], ["OR", 1], ["AND", 2], ["THAT", 3], ["THAT", 3], ["THAT", 2],
    ]);
    expect(nested.every((r) => r.runOf === null)).toBe(true);
  });

  it("marks OR branches as alternatives and leaves AND children alone", () => {
    expect(queryRows(OR_Q).slice(1).map((r) => r.alt.index)).toEqual([0, 1]);
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

  it("unwraps a group down to one branch, and prunes one down to none", () => {
    // `OR(a)` matches exactly what `a` matches, and costs a level of the depth budget to say so.
    // It used to be left standing because a block was built empty and filled afterwards; nothing
    // builds one that way now, so a leftover would put a run on screen that reads as a single
    // plain condition.
    let q = removeStep(OR_Q, [0, 1]);
    expect(serializeQuery(q)).toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    q = removeStep(q, [0]);
    expect(serializeQuery(q)).toBe("AI_AGENT");
    // An optional block is the exception: the flag is the reason it exists, and unwrapping it
    // would throw the flag away.
    expect(serializeQuery(removeStep(
      parseQuery("AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))"), [0, 1])))
      .toBe("AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT))");
  });

  it("never mutates the tree it was given", () => {
    const before = JSON.stringify(OR_Q);
    addStep(OR_Q, [0], { edge: "HOSTED_ON", node: { kind: "SERVERLESS" } });
    removeStep(OR_Q, [0, 0]);
    setConjunction(OR_Q, [0, 1], "and");
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

    it("compares the target by SET, so a multi-kind row keeps what it should", () => {
      // `s.node.kind === next.node.kind` would have compared an array to a string and answered
      // false every time, quietly demolishing the query below any node naming several kinds.
      const q = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT-USER_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
      // Order-insensitive, because the two spellings are the same question — the replacement
      // node's own order is what gets written, since nothing here reorders a caller's set.
      const same = replaceStep(q, [0],
        { edge: "USES", node: { kind: ["USER_ACCOUNT", "SERVICE_ACCOUNT"] } });
      expect(serializeQuery(same))
        .toBe("AI_AGENT(USES.USER_ACCOUNT-SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))");
      // A set that merely OVERLAPS is still a different question at the far end of this hop, so
      // the steps chosen against the old one go.
      const narrower = replaceStep(q, [0], { edge: "USES", node: { kind: "SERVICE_ACCOUNT" } });
      expect(serializeQuery(narrower)).toBe("AI_AGENT(USES.SERVICE_ACCOUNT)");
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

  // The keyword pill's edit. One level of a query is a sequence of conditions, each joined to
  // the previous by AND or OR; consecutive ORs form a run of alternatives and runs are ANDed.
  // These pin that reading both ways: what the rows say, and what the tree does.
  describe("setConjunction", () => {
    const AB = "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)";
    const ABC = "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL'HAS_ISSUE.ISSUE))";

    it("joins a row to the one above it, and lets go again", () => {
      const or = setConjunction(parseQuery(AB), [1], "or");
      expect(serializeQuery(or))
        .toBe("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))");
      // The path moved with the wrap, so letting go again addresses the branch, not the step.
      expect(serializeQuery(setConjunction(or, [0, 1], "and"))).toBe(AB);
    });

    it("splits a run where the AND lands, keeping what was ORed below it", () => {
      // `c` was joined to `b` by OR and still is — so `A|B|C` with `b` set to AND is
      // `A AND (B OR C)`, which is what the rows read top to bottom.
      const split = setConjunction(parseQuery(ABC), [0, 1], "and");
      expect(serializeQuery(split))
        .toBe("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'OR(USES_MODEL.AI_MODEL'HAS_ISSUE.ISSUE))");
      expect(queryRows(split).map((r) => r.conj)).toEqual([null, null, "and", "or"]);
      // And back: the third row rejoins the first run.
      expect(serializeQuery(setConjunction(split, [1, 0], "or"))).toBe(ABC);
    });

    it("extends an existing run rather than nesting a second one", () => {
      const q = parseQuery("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)'HAS_ISSUE.ISSUE)");
      expect(serializeQuery(setConjunction(q, [1], "or"))).toBe(ABC);
    });

    it("leaves alone a row that joins nothing", () => {
      const q = parseQuery(AB);
      // The first condition at its level has nothing above it to be an alternative to.
      expect(setConjunction(q, [0], "or")).toBe(q);
      expect(setConjunction(q, [], "or")).toBe(q);
    });

    it("round-trips through the DSL, leaving no key the parser would not produce", () => {
      for (const text of [AB, ABC]) {
        for (const path of [[1], [0, 1], [0, 2]]) {
          for (const conj of ["and", "or"]) {
            const next = setConjunction(parseQuery(text), path, conj);
            expect(parseQuery(serializeQuery(next)), text + " " + path + " " + conj).toEqual(next);
          }
        }
      }
    });
  });

  describe("pathAfterRegroup", () => {
    it("carries a filter across a wrap and a dissolve, rather than dropping it", () => {
      // Wrapping moves no SLOT — a group binds nothing — but it does move PATHS, and `where` is
      // remapped by path. Without this the filter would silently vanish on the way through.
      const q = parseQuery("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)");
      const where = parseWhere("2.name.gpt");
      const or = setConjunction(q, [1], "or");
      expect(serializeWhere(remapWhere(q, or, where, pathAfterRegroup(q, or))))
        .toBe("2.name.gpt");
      const back = setConjunction(or, [0, 1], "and");
      expect(serializeWhere(remapWhere(or, back, where, pathAfterRegroup(or, back))))
        .toBe("2.name.gpt");
      // The proof that the guard is load-bearing: without it the path lookup misses.
      expect(serializeWhere(remapWhere(q, or, where))).toBe("");
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
