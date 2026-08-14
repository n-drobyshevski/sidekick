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
  queryRows,
  removeStep,
  serializeQuery,
  serializeWhere,
  setEdge,
  setHidden,
  setKind,
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
    expect(parsed.get(0).get("cloud")).toEqual(["GCP", "AWS"]);
    expect(parsed.get(1).get("inactive")).toEqual(["true"]);
    expect(serializeWhere(parsed)).toBe("0.cloud.GCP,0.cloud.AWS,1.inactive.true");
  });

  it("encodes values that would otherwise re-split wrong", () => {
    const m = new Map([[0, new Map([["projects", ["CE-DPCP, PORTAL"]]])]]);
    const text = serializeWhere(m);
    expect(text).not.toContain(", ");
    expect(parseWhere(text).get(0).get("projects")).toEqual(["CE-DPCP, PORTAL"]);
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

  it("turns the old facets into filters on the found node", () => {
    const out = migrateLegacyParams({ kinds: "AI_AGENT", severities: "CRITICAL,HIGH", clouds: "GCP" });
    expect(out.find).toBe("AI_AGENT");
    expect(out.where).toBe("0.cloud.GCP,0.severity.CRITICAL,0.severity.HIGH");
  });

  it("clamps a depth the builder cannot express, the way the old page did", () => {
    expect(migrateLegacyParams({ seed: "a", depth: "9" }).find).toBe("ANY(*ANY3.ANY)");
    // `depth=0` is falsy, so it falls through to the default of 2 rather than clamping up to 1
    // — which is exactly what graphParams did before this, and a saved link must not change
    // the view it opens just because the page behind it was rewritten.
    expect(migrateLegacyParams({ seed: "a", depth: "0" }).find).toBe("ANY(*ANY2.ANY)");
  });
});
