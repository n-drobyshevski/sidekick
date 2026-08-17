// The invariant the whole query design rests on: the CLIENT's pre-order over a query tree and
// the SERVER's are the same pre-order.
//
// They are two implementations by necessity — the client bundle cannot import the TypeScript
// domain — and they address each other by slot NUMBER. `where=1.inactive.true` means "the
// second node the walk reaches"; the client counts that number and the evaluator binds against
// it. If the two ever count differently there is no error, no exception and no failing type:
// the filter lands on a different node and the page answers a question nobody asked, with the
// full confidence of a working feature.
//
// Neither side's own unit tests can see that. This one holds both at once — it parses with the
// client parser, sends the result through the real booted server, and checks the shapes line
// up. Plain .js so it can import the client module: tsconfig has no allowJs, so a .ts test
// importing client code fails `tsc --noEmit`, and `npm run check` would never reach vitest.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import {
  applyWhere,
  parseQuery,
  parseWhere,
  queryRows,
  serializeQuery,
} from "../src/client/js/pages/graphQuery.js";

let server;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({});
  if (!res.ok) throw new Error("seed sync failed: " + res.error);
});

afterAll(() => teardownServer());

/**
 * Every shape the grammar can make, including the three that carry the slot rules: a negated
 * step (no slot, no descent), a hidden node (a slot, but no column), and an OR group (no slot
 * of its own, every branch reserving one).
 *
 * The multi-kind shapes are here for a second reason as well. A node naming several kinds is
 * still ONE node — one slot, one column group — and the two sides derive its column's `kind`
 * from their own trees by joining the list. That string is compared below, so these shapes are
 * what stops the client and the server from spelling one node's identity two ways.
 */
const SHAPES = [
  "AI_AGENT",
  "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)",
  "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))",
  "AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL)",
  "AI_AGENT(*RUNS_AS.SERVICE_ACCOUNT)",
  "AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT)",
  "AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))",
  "AI_AGENT(ANY2.BUCKET)",
  "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL)",
  "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))",
  "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'!PROTECTED_BY.AI_GUARDRAIL))",
  "AI_AGENT(USES_MODEL.AI_MODEL'OR(RUNS_AS.SERVICE_ACCOUNT'HOSTED_ON.SERVERLESS))",
  "AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET)'USES_MODEL.AI_MODEL))",
  "AI_AGENT(*OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))",
  "SERVICE_ACCOUNT(~RUNS_AS.AI_AGENT)",
  "AI_AGENT-AI_DEPLOYMENT",
  "AI_AGENT-AI_DEPLOYMENT(RUNS_AS.SERVICE_ACCOUNT)",
  "AI_AGENT(RUNS_AS.SERVICE_ACCOUNT-USER_ACCOUNT)",
  "AI_AGENT-AI_DEPLOYMENT(RUNS_AS.!SERVICE_ACCOUNT-USER_ACCOUNT(ALLOWS_ACCESS_TO.BUCKET))",
  // Written in the order NODE_KINDS does not declare them in. Neither side reorders, so both
  // spell this node's identity "AI_DEPLOYMENT-AI_AGENT" and the column group still matches.
  "AI_DEPLOYMENT-AI_AGENT",
];

/** The rows that earn a column group: real nodes, bound, not hidden. */
function shownRows(query) {
  return queryRows(query).filter((r) => !r.group && r.index !== null && !r.hidden);
}

function run(dsl, where) {
  const query = parseQuery(dsl);
  const wire = applyWhere(query, parseWhere(where || ""));
  const res = server.api.runGraphQuery({ query: wire });
  if (!res.ok) throw new Error(dsl + " → " + res.error);
  return { query, data: res.data };
}

describe("the client walk and the server walk agree", () => {
  for (const dsl of SHAPES) {
    it(dsl, () => {
      const { query, data } = run(dsl);

      // One column group per shown row, and every row exactly that wide. These are the two
      // numbers that slide apart when the walks disagree.
      expect(data.groups.length).toBe(shownRows(query).length);
      for (const row of data.rows) expect(row.cells.length).toBe(data.groups.length);

      // ...and in the same ORDER. Equal counts with swapped kinds is the subtler failure.
      expect(data.groups.map((g) => g.kind)).toEqual(shownRows(query).map((r) => r.kind));
    });
  }

  it("round-trips every shape through the serializer unchanged", () => {
    // A shape the client can parse but not write back is one a saved link silently rewrites.
    for (const dsl of SHAPES) expect(serializeQuery(parseQuery(dsl))).toBe(dsl);
  });
});

describe("where lands on the node the client counted", () => {
  it("filters the second node, not the first", () => {
    // `1.` is the service account. If the walks disagreed by one this would filter the AGENT
    // by an identity-only field and return everything, which is exactly the silent failure.
    const open = run("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)");
    const filtered = run("AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)", "1.identityPurpose.AGENTIC");
    expect(filtered.data.total).toBeGreaterThan(0);
    expect(filtered.data.total).toBeLessThanOrEqual(open.data.total);
    for (const row of filtered.data.rows) {
      expect(row.cells[1]).not.toBeNull();
    }
  });

  it("skips a negated subtree when numbering, so a later filter is not off by one", () => {
    // The negated guardrail step takes no slot, so the service account is still node 1. Get
    // this wrong and the filter silently lands on the guardrail the query says is absent.
    const res = run("AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL'RUNS_AS.SERVICE_ACCOUNT)",
      "1.identityPurpose.AGENTIC");
    expect(res.data.groups.map((g) => g.kind)).toEqual(["AI_AGENT", "SERVICE_ACCOUNT"]);
    expect(res.data.total).toBeGreaterThan(0);
  });

  it("numbers across OR branches in source order", () => {
    const res = run("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))",
      "1.identityPurpose.AGENTIC");
    expect(res.data.groups.map((g) => g.kind)).toEqual(["AI_AGENT", "SERVICE_ACCOUNT", "AI_MODEL"]);
    // Every returned row either bound the filtered identity or came from the other branch.
    for (const row of res.data.rows) {
      expect(row.cells[1] === null || row.cells[2] === null).toBe(true);
    }
  });
});

describe("alternation is reported the same way on both sides", () => {
  it("marks exactly the OR branches, on the client rows and the server groups", () => {
    const { query, data } = run("AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))");
    const clientAlt = shownRows(query).map((r) => (r.alt ? r.alt.index : null));
    const serverAlt = data.groups.map((g) => (g.altOf === undefined ? null : g.altIndex));
    expect(clientAlt).toEqual([null, 0, 1]);
    expect(serverAlt).toEqual(clientAlt);
  });

  it("leaves an AND group's children unmarked — they are a sequence, not alternatives", () => {
    const { query, data } = run("AI_AGENT(AND(RUNS_AS.SERVICE_ACCOUNT'USES_MODEL.AI_MODEL))");
    expect(shownRows(query).every((r) => !r.alt)).toBe(true);
    expect(data.groups.every((g) => g.altOf === undefined)).toBe(true);
  });
});
