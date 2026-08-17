// The evidence a filtered query draws, and the budget that keeps a cluster whole.
//
// TWO HALVES OF ONE COMPLAINT: "searching for AI agents with sensitive data access loads only
// agent nodes". Measured on the sample estate before any of this, `FIND AI_AGENT WHERE
// sensitiveAccess is true` answered 11 agents, 0 edges, 11 isolated components — the answer to a
// question about a path, drawn with no path in it. And the shortcut carrying the very same label
// ("Reaches classified data") answered 39 nodes in 5 clusters, so one name gave two pictures.
//
// The first half is the witness: a filter naming a risk property also names, implicitly, the
// subgraph that proves it. The second is the canvas budget, which used to slice a severity-sorted
// node list — and `severityRank(undefined)` is the WORST rank, so the unscored connective tissue
// of every path sorted last and was cut first. Dropping 39 wanted nodes into a 30-node budget kept
// 2 of 34 edges and left 27 of 30 cards isolated.

import { beforeAll, describe, expect, it } from "vitest";
import {
  QUERY_FIELDS,
  QUERY_SHORTCUTS,
  WITNESS_FANOUT_CAP,
  type QueryNode,
  runQuery,
  validateQuery,
} from "../src/domain/graphQuery";
import type { GraphDoc } from "../src/domain/graphTypes";
import { bootServer } from "./gasEnv";

/**
 * ONE BOOT for the whole file, and the doc read back through the real path.
 *
 * `enrichGraphDoc(seedGraphDoc(...))` — what every other unit test here builds — is NOT enough,
 * and getting that wrong cost a whole measurement pass: the derived stubs (MISSING_GUARDRAIL,
 * INTERNET_EXPOSURE, EXCESSIVE_PRIVILEGE, SENSITIVE_DATA) and the data-finding aggregates are
 * applied ON READ by `syncStore.withRiskNodes`, so a fixture stopping at enrichment contains none
 * of the nodes any witness here is looking for and every assertion below would pass vacuously.
 *
 * So the doc comes from `loadGraphDoc()` itself, imported into the registry `bootServer` just
 * created — the shims are global once it has run. No fixture to drift out of step with the server,
 * and no export added to production code to make a test reachable.
 *
 * `bootServer` calls `vi.resetModules()`, so this must be the file's only boot: a second one would
 * strand the doc and the `api` handle taken from the first.
 */
let DOC: GraphDoc;
let api: Awaited<ReturnType<typeof bootServer>>["api"];

beforeAll(async () => {
  const server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  if (!res.ok) throw new Error(`sync failed: ${res.error}`);
  api = server.api;
  const syncStore = await import("../src/server/syncStore");
  const doc = syncStore.loadGraphDoc();
  if (!doc) throw new Error("no graph doc after sync");
  DOC = doc;
});

const agents = (where: unknown[], negate?: boolean): QueryNode =>
  validateQuery({
    kind: "AI_AGENT",
    where: where.map((w) => (negate ? { ...(w as object), negate: true } : w)),
  });

const F = (key: string, ...values: string[]) => ({ key, values });

describe("a filter's evidence", () => {
  it("draws the four-hop chain behind “reaches classified data”", () => {
    const r = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    expect(r.rows.length).toBeGreaterThan(0);
    const kinds = new Set(r.witnessNodeIds
      .map((id) => DOC.nodes.find((n) => n.id === id)!.kind));
    // The identity hop and the store, which is the whole point: the data end is four hops out, so
    // a one-hop evidence rule would have found only the SENSITIVE_DATA stub — and enrich emits
    // that stub precisely where the real chain could NOT be traced.
    expect(kinds).toContain("SERVICE_ACCOUNT");
    expect([...kinds].some((k) => k === "BUCKET" || k === "DATABASE")).toBe(true);
  });

  it("reaches past the shortcut's own last hop, to the findings", () => {
    // `reaches-classified` stops at the bucket because that is where its table column stops. A
    // canvas has no such reason, so the witness carries one hop further.
    const shortcut = QUERY_SHORTCUTS.find((s) => s.id === "reaches-classified")!;
    expect(JSON.stringify(shortcut.steps)).not.toContain("HAS_DATA_FINDING");
    const r = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    const kinds = r.witnessNodeIds.map((id) => DOC.nodes.find((n) => n.id === id)!.kind);
    expect(kinds).toContain("DATA_FINDING");
  });

  it("draws the exposure node, the privilege stub and the guardrail gap", () => {
    for (const [filter, kind] of [
      [F("internet", "true"), "INTERNET_EXPOSURE"],
      [F("adminPriv", "true"), "EXCESSIVE_PRIVILEGE"],
      [F("guardrail", "missing"), "MISSING_GUARDRAIL"],
    ] as Array<[ReturnType<typeof F>, string]>) {
      const r = runQuery(DOC, agents([filter]));
      expect(r.rows.length, `${filter.key} matches nothing — fixture problem`).toBeGreaterThan(0);
      const kinds = r.witnessNodeIds.map((id) => DOC.nodes.find((n) => n.id === id)!.kind);
      expect(kinds, `${filter.key} must witness ${kind}`).toContain(kind);
    }
  });

  it("reaches the guardrail gap through the NEGATED edge, which every ordinary step skips", () => {
    // The regression this exists for. `stepTargets` drops negated edges on purpose — "protected
    // by" must not match a guardrail specifically NOT attached — so this witness armed correctly
    // and drew nothing until `viaAbsence` existed. And the exclusion must stay exact rather than
    // becoming a union: an ordinary PROTECTED_BY step must still find no gap.
    const withGap = runQuery(DOC, agents([F("guardrail", "missing")]));
    expect(withGap.witnessNodeIds.length).toBeGreaterThan(0);

    const asStep = runQuery(DOC, validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "PROTECTED_BY", node: { kind: "MISSING_GUARDRAIL" } }],
    }));
    expect(asStep.rows).toHaveLength(0);
  });

  it("hangs evidence off the node the filter is on, not off the root", () => {
    const r = runQuery(DOC, validateQuery({
      kind: "AI_AGENT",
      steps: [{
        edge: "RUNS_AS",
        node: { kind: "SERVICE_ACCOUNT", where: [F("highPriv", "true")] },
      }],
    }));
    if (!r.rows.length) return;                     // fixture has no such identity; nothing to say
    const byId = new Map(DOC.nodes.map((n) => [n.id, n]));
    const agentIds = new Set(DOC.nodes.filter((n) => n.kind === "AI_AGENT").map((n) => n.id));
    // Whatever it found, the evidence edges must touch the identity, never the agent — that is
    // what "slot i's witness runs from slot i's bound node" means in practice.
    for (const id of r.witnessEdgeIds) {
      const e = DOC.edges.find((x) => x.id === id)!;
      expect(agentIds.has(e.src), `${id} hangs off the agent, not the identity`).toBe(false);
      expect(byId.has(e.dst)).toBe(true);
    }
  });
});

describe("what does NOT arm a witness", () => {
  it("a negated filter draws nothing extra — an absent path has no evidence", () => {
    const bare = runQuery(DOC, agents([F("sensitiveAccess", "true")], true));
    expect(bare.rows.length).toBeGreaterThan(0);
    expect(bare.witnessNodeIds).toHaveLength(0);
    expect(bare.witnessEdgeIds).toHaveLength(0);
  });

  it("`is false` and `is unknown` are the same case as negation", () => {
    for (const value of ["false", "unknown"]) {
      const r = runQuery(DOC, agents([F("sensitiveAccess", value)]));
      expect(r.witnessNodeIds, `sensitiveAccess is ${value}`).toHaveLength(0);
    }
    // And the choice field's other value: "present" is the absence of a finding.
    expect(runQuery(DOC, agents([F("guardrail", "present")])).witnessNodeIds).toHaveLength(0);
  });

  it("a field with no topological witness arms nothing", () => {
    // Most fields are inventory, not risk. `cloud` has no node that proves it.
    const r = runQuery(DOC, agents([F("cloud", "AWS")]));
    expect(r.witnessNodeIds).toHaveLength(0);
  });

  it("an unfiltered query is untouched — the default lens still draws bare cards", () => {
    const r = runQuery(DOC, validateQuery({ kind: "AI_AGENT" }));
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.witnessNodeIds).toHaveLength(0);
    expect(r.paths.every((p) => p.length === 1)).toBe(true);
  });

  it("case does not matter, because `matchesFilter` compares lowercased", () => {
    // A filter written TRUE matches nodes, so it must also arm the witness that explains them.
    const upper = runQuery(DOC, agents([F("sensitiveAccess", "TRUE")]));
    const lower = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    expect(upper.witnessNodeIds.length).toBe(lower.witnessNodeIds.length);
    expect(upper.witnessNodeIds.length).toBeGreaterThan(0);
  });
});

describe("the witness stays out of the table", () => {
  it("adds no row and no column group", () => {
    const plain = runQuery(DOC, validateQuery({ kind: "AI_AGENT" }));
    const filtered = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    // One row per matching agent either way — the evidence is drawn, never listed. This is why
    // the witness is not grafted onto the query tree: the `reaches-classified` shortcut returns
    // 24 rows for 10 agents, because an agent reaching three buckets is three paths.
    expect(filtered.groups).toHaveLength(plain.groups.length);
    expect(filtered.rows.length).toBe(filtered.total);
    for (const row of filtered.rows) {
      expect(row.cells).toHaveLength(plain.rows[0].cells.length);
    }
  });

  it("is deterministic", () => {
    const a = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    const b = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("bounds one node's fan-out, so one cluster cannot spend a whole canvas", () => {
    const r = runQuery(DOC, agents([F("sensitiveAccess", "true")]));
    // `paths` is per binding, and a binding is one matched agent here (no steps), so each path
    // holds that agent plus at most WITNESS_FANOUT_CAP witness bindings' worth of nodes.
    for (const path of r.paths) {
      expect(path.length).toBeLessThanOrEqual(1 + WITNESS_FANOUT_CAP * 4);
    }
  });

  it("every witnessed field is a real field, and every witness a real path", () => {
    // Anti-rot: a witness keyed on a field that no longer exists would arm silently never.
    const keys = new Set(QUERY_FIELDS.map((f) => f.key));
    for (const key of ["sensitiveAccess", "sensitiveData", "internet", "guardrail",
      "highPriv", "adminPriv"]) {
      expect(keys, `${key} must be a QUERY_FIELDS key`).toContain(key);
      // And it must actually witness something on this estate, or the row is decoration.
      const armed = key === "guardrail" ? "missing" : "true";
      const r = runQuery(DOC, agents([F(key, armed)]));
      if (r.rows.length) {
        expect(r.witnessNodeIds.length, `${key} arms but witnesses nothing`).toBeGreaterThan(0);
      }
    }
  });
});

// --------------------------------------------------- the budget, through the real server

describe("the canvas budget admits clusters, not nodes", () => {
  interface Payload {
    nodes: Array<{ id: string }>;
    edges: Array<{ src: string; dst: string }>;
    rows: unknown[];
    counts: { capped: boolean; shownNodes: number; totalNodes: number };
  }
  const draw = (query: unknown, maxNodes: number): Payload => {
    const res = api.runGraphQuery({ query, maxNodes }) as
      { ok: boolean; error?: string; data: Payload };
    if (!res.ok) throw new Error(String(res.error));
    return res.data;
  };

  /** Cards touching no edge. In a query whose answer IS paths, every one is a cut cluster. */
  const isolated = (p: Payload): number => {
    const touched = new Set<string>();
    for (const e of p.edges) { touched.add(e.src); touched.add(e.dst); }
    return p.nodes.filter((n) => !touched.has(n.id)).length;
  };

  const SHORTCUT = {
    kind: "AI_AGENT",
    steps: [{
      edge: "RUNS_AS",
      node: {
        kind: "SERVICE_ACCOUNT", show: false,
        steps: [{ edge: "ALLOWS_ACCESS_TO", node: { kind: "BUCKET" } }],
      },
    }],
  };

  it("keeps every admitted card connected when the budget bites", () => {
    const whole = draw(SHORTCUT, 200);
    const cut = draw(SHORTCUT, 30);
    expect(whole.counts.capped).toBe(false);
    expect(isolated(whole)).toBe(0);
    // The regression, in one number. Node-wise truncation left 27 of 30 cards isolated here and
    // kept 2 of 34 edges; cluster-atomic admission drops whole paths instead.
    expect(cut.counts.capped).toBe(true);
    expect(cut.nodes.length).toBeLessThan(whole.nodes.length);
    expect(isolated(cut)).toBe(0);
    expect(cut.edges.length).toBeGreaterThan(whole.edges.length / 2);
  });

  it("never exceeds the budget it was given", () => {
    // The ceiling is a documented promise of every payload, so a cluster that will not fit is a
    // reason to stop rather than to overspend.
    for (const maxNodes of [30, 40, 50, 100, 200]) {
      const p = draw(SHORTCUT, maxNodes);
      expect(p.nodes.length, `maxNodes ${maxNodes}`).toBeLessThanOrEqual(maxNodes);
    }
  });

  it("draws something whenever the table has rows", () => {
    // The invariant: a populated table never sits beside an empty canvas.
    //
    // `runGraphQuery` clamps to MAX_NODES_FLOOR (30), so a budget too small for even one cluster
    // CANNOT be asked for here — a request of 2 comes back as 30. Which means the branch that
    // truncates a first cluster rather than admitting nothing is defensive, not exercised: no
    // single path on the sample estate reaches 30 nodes (the widest is one match plus
    // WITNESS_FANOUT_CAP bindings of a three-node chain). It stays because a real tenant can build
    // one — a deep ANY-hops query, or a wider fan-out — and without it that query would answer
    // with rows and a blank canvas.
    const floored = draw(SHORTCUT, 2);
    expect(floored.nodes.length).toBeLessThanOrEqual(30);
    for (const maxNodes of [2, 30, 200]) {
      const p = draw(SHORTCUT, maxNodes);
      expect(p.rows.length, `maxNodes ${maxNodes}`).toBeGreaterThan(0);
      expect(p.nodes.length, `maxNodes ${maxNodes}`).toBeGreaterThan(0);
    }
  });

  it("draws the evidence for a filtered query, and keeps it connected under the cap", () => {
    const filtered = { kind: "AI_AGENT", where: [{ key: "sensitiveAccess", values: ["true"] }] };
    const whole = draw(filtered, 200);
    // The complaint, answered: 11 bare agents with no edges before this existed.
    expect(whole.nodes.length).toBeGreaterThan(whole.rows.length);
    expect(whole.edges.length).toBeGreaterThan(0);
    expect(isolated(whole)).toBe(0);
    expect(isolated(draw(filtered, 30))).toBe(0);
  });

  it("the filter and the shortcut sharing a label now agree on the canvas", () => {
    // Both are called "Reaches classified data". They still differ in the TABLE — the shortcut
    // makes the bucket a column, the filter keeps one row per agent — which is why neither was
    // renamed. What they must not do any more is disagree about whether there is a path.
    const byFilter = draw({ kind: "AI_AGENT", where: [{ key: "sensitiveAccess", values: ["true"] }] }, 200);
    const byShortcut = draw(SHORTCUT, 200);
    for (const p of [byFilter, byShortcut]) {
      expect(p.edges.length).toBeGreaterThan(0);
      expect(isolated(p)).toBe(0);
    }
  });

  it("an unfiltered query is unchanged — still one card per agent", () => {
    const p = draw({ kind: "AI_AGENT" }, 200);
    expect(p.nodes.length).toBe(p.rows.length);
    expect(p.edges).toHaveLength(0);
  });
});
