// The depth-limited projection: horizons, per-kind caps with SUMMARY collapse,
// global budgets, expandIds, filters (seeds exempt), and determinism.

import { describe, expect, it } from "vitest";
import { MAX_NODES_DEFAULT } from "../src/domain/config";
import {
  enrichGraphDoc,
  withDataFindingNodes,
  withExcessivePrivilegeNodes,
  withInternetExposureNodes,
  withMissingGuardrailNodes,
  withSensitiveDataNodes,
} from "../src/domain/graphEnrich";
import { projectGraph } from "../src/domain/graphProject";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

const DOC = enrichGraphDoc(seedGraphDoc("2026-06-28T05:00:00Z"), SEED_ISSUES, SEED_AARS_HINTS);

function ids(p: ReturnType<typeof projectGraph>): Set<string> {
  return new Set(p.nodes.map((n) => n.id));
}

describe("projectGraph", () => {
  it("depth 1 from one agent: seed + direct neighbors only", () => {
    const p = projectGraph(DOC, { seedIds: ["agent-a"], depth: 1 });
    const shown = ids(p);
    expect(shown.has("agent-a")).toBe(true);
    expect(shown.has("sa-agent-a")).toBe(true); // RUNS_AS, 1 hop
    expect(shown.has("bucket-customer-pii")).toBe(false); // 2 hops via the SA
  });

  it("depth 2 reaches the data behind the execution identity", () => {
    const p = projectGraph(DOC, { seedIds: ["agent-a"], depth: 2 });
    const shown = ids(p);
    expect(shown.has("bucket-customer-pii")).toBe(true);
    expect(shown.has("db-customer-core")).toBe(true);
  });

  it("deeper horizons never shrink the node set", () => {
    const d1 = projectGraph(DOC, { seedIds: ["agent-a"], depth: 1 }).counts.shownNodes;
    const d2 = projectGraph(DOC, { seedIds: ["agent-a"], depth: 2 }).counts.shownNodes;
    const d3 = projectGraph(DOC, { seedIds: ["agent-a"], depth: 3 }).counts.shownNodes;
    expect(d2).toBeGreaterThanOrEqual(d1);
    expect(d3).toBeGreaterThanOrEqual(d2);
  });

  it("per-kind cap collapses the autogen scratch buckets into one SUMMARY", () => {
    // sa-agent-autogen reaches 14 scratch buckets + 2 real ones; BUCKET cap is 6.
    const p = projectGraph(DOC, { seedIds: ["agent-autogen"], depth: 2 });
    const summary = p.summaries.find(
      (s) => s.parentId === "sa-agent-autogen" && s.of === "BUCKET",
    );
    expect(summary).toBeDefined();
    expect(summary!.count).toBeGreaterThan(0);
    expect(summary!.memberIds.length).toBe(summary!.count);
    // The summary appears as a node and a stub edge to its parent exists.
    expect(p.nodes.some((n) => n.id === summary!.id && n.kind === "SUMMARY")).toBe(true);
    expect(p.edges.some((e) => e.dst === summary!.id && e.src === "sa-agent-autogen")).toBe(true);
  });

  it("expandIds lifts the parent's caps (no BUCKET summary once expanded)", () => {
    const p = projectGraph(DOC, {
      seedIds: ["agent-autogen"],
      depth: 2,
      expandIds: ["sa-agent-autogen"],
    });
    const summary = p.summaries.find(
      (s) => s.parentId === "sa-agent-autogen" && s.of === "BUCKET",
    );
    expect(summary).toBeUndefined();
    const buckets = p.nodes.filter((n) => n.kind === "BUCKET");
    expect(buckets.length).toBeGreaterThanOrEqual(14);
  });

  it("maxNodes budget caps admission and sets counts.capped", () => {
    const p = projectGraph(DOC, {
      seedIds: ["agent-autogen", "agent-h-chatbot", "agent-i"],
      depth: 3,
      maxNodes: 20,
    });
    expect(p.counts.shownNodes).toBeLessThanOrEqual(20);
    expect(p.counts.capped).toBe(true);
  });

  // The budget is a promise about the payload, so the "+N more" stubs — which the browser
  // draws, focuses and lays out like any other node — have to be inside it.
  it("the SUMMARY stubs count against maxNodes, not on top of it", () => {
    for (const maxNodes of [4, 7, 12, 20, 45]) {
      const p = projectGraph(DOC, {
        seedIds: ["agent-autogen", "agent-h-chatbot", "agent-i"],
        depth: 3,
        maxNodes,
      });
      expect(p.nodes.length).toBeLessThanOrEqual(maxNodes);
      expect(p.counts.shownNodes + p.summaries.length).toBe(p.nodes.length);
    }
  });

  it("a budget too small for a stub still flags the view as capped", () => {
    // Enough room for the seed and its first neighbors, never enough to also stub the
    // collapsed buckets — the pill is then the only thing that says rows are missing.
    const p = projectGraph(DOC, { seedIds: ["agent-autogen"], depth: 2, maxNodes: 5 });
    expect(p.nodes.length).toBeLessThanOrEqual(5);
    expect(p.counts.capped).toBe(true);
  });

  it("the stub edges come out of maxEdges too", () => {
    for (const maxEdges of [1, 3, 8, 30]) {
      const p = projectGraph(DOC, {
        seedIds: ["agent-autogen", "agent-h-chatbot"],
        depth: 3,
        maxEdges,
      });
      expect(p.edges.length).toBeLessThanOrEqual(maxEdges);
    }
  });

  it("the default budget holds the whole-landscape view to 100 nodes", () => {
    // The default view (every toxic-combination asset, depth 2) with no explicit budget.
    const seedIds = [...new Set(SEED_ISSUES.filter((i) => i.status === "OPEN")
      .map((i) => i.assetId))].filter(Boolean) as string[];
    const p = projectGraph(DOC, { seedIds, depth: 2 });
    expect(p.nodes.length).toBeLessThanOrEqual(MAX_NODES_DEFAULT);
    expect(MAX_NODES_DEFAULT).toBe(100);
  });

  it("filters exclude non-matching neighbors but never the seeds", () => {
    const p = projectGraph(DOC, {
      seedIds: ["agent-a"],
      depth: 2,
      filters: { kinds: ["AI_AGENT", "ISSUE"] },
    });
    const shown = ids(p);
    expect(shown.has("agent-a")).toBe(true);
    expect(shown.has("sa-agent-a")).toBe(false); // filtered kind
    // Seed survives even when it wouldn't match a filter.
    const p2 = projectGraph(DOC, {
      seedIds: ["agent-a"],
      depth: 1,
      filters: { severities: ["CRITICAL"] }, // agent-a is HIGH
    });
    expect(ids(p2).has("agent-a")).toBe(true);
  });

  it("includes induced edges between admitted nodes", () => {
    const p = projectGraph(DOC, { seedIds: ["agent-h-chatbot"], depth: 2 });
    const shown = ids(p);
    for (const e of p.edges) {
      expect(shown.has(e.src) || e.src.startsWith("sum|")).toBe(true);
      expect(shown.has(e.dst) || e.dst.startsWith("sum|")).toBe(true);
    }
  });

  it("is deterministic: two identical runs produce identical projections", () => {
    const opts = { seedIds: ["agent-autogen", "agent-a"], depth: 3 as const };
    const a = projectGraph(DOC, opts);
    const b = projectGraph(DOC, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("unknown seed ids are ignored gracefully", () => {
    const p = projectGraph(DOC, { seedIds: ["nope", "agent-a"], depth: 1 });
    expect(ids(p).has("agent-a")).toBe(true);
    expect(p.counts.shownNodes).toBeGreaterThan(0);
  });

  it("expandIds reaches past the depth frontier, one hop and no further", () => {
    // sa-agent-a sits AT depth 1, so before this it could never be expanded: the
    // depth check fired before the caps expandIds was lifting, and the button that
    // sets expandIds did nothing at all.
    const plain = ids(projectGraph(DOC, { seedIds: ["agent-a"], depth: 1 }));
    expect(plain.has("sa-agent-a")).toBe(true);
    expect(plain.has("bucket-customer-pii")).toBe(false);

    const expanded = ids(
      projectGraph(DOC, { seedIds: ["agent-a"], depth: 1, expandIds: ["sa-agent-a"] }),
    );
    expect(expanded.has("bucket-customer-pii")).toBe(true); // 2 hops, admitted by the expand
    // The hop does not cascade: the bucket's own neighbors stay out unless it is
    // expanded in turn.
    const depth2 = ids(projectGraph(DOC, { seedIds: ["agent-a"], depth: 2 }));
    for (const id of expanded) expect(depth2.has(id)).toBe(true);
  });

  it("filterSeeds narrows the scored bulk-seed set by the active filters", () => {
    // agent-a is AI_AGENT, role-finance-admin-01 is ACCESS_ROLE; both are seeds.
    const withFilterSeeds = projectGraph(DOC, {
      seedIds: ["agent-a", "role-finance-admin-01"],
      depth: 1,
      filters: { kinds: ["AI_AGENT"] },
      filterSeeds: true,
    });
    const shownFiltered = ids(withFilterSeeds);
    expect(shownFiltered.has("agent-a")).toBe(true);
    expect(shownFiltered.has("role-finance-admin-01")).toBe(false);

    // Same filter, but filterSeeds unset: current always-admitted behavior preserved.
    const withoutFilterSeeds = projectGraph(DOC, {
      seedIds: ["agent-a", "role-finance-admin-01"],
      depth: 1,
      filters: { kinds: ["AI_AGENT"] },
    });
    const shownUnfiltered = ids(withoutFilterSeeds);
    expect(shownUnfiltered.has("agent-a")).toBe(true);
    expect(shownUnfiltered.has("role-finance-admin-01")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Risk evidence vs. the inventory filters. This is the defect that made finding
// nodes invisible on the Security Graph page: the page seeds `kinds=AI_AGENT`
// into the hash on a fresh visit, and passesFilters applied it to every traversed
// neighbor — so the default view could only ever contain AI agents, and neither
// "Expand neighbors" nor a regrouping could bring the attack path back.

const RISK_DOC = withMissingGuardrailNodes(
  withExcessivePrivilegeNodes(withInternetExposureNodes(withSensitiveDataNodes(DOC))),
);

describe("projectGraph risk-node filtering", () => {
  // agent-h-chatbot is flagged for high privilege and no guardrail. It is flagged for
  // sensitive access too, but that is now drawn as the real chain to db-customer-core, so
  // the `sensitive|` stub is suppressed and cannot be the vehicle here — see
  // graphEnrich.test.ts for the suppression itself.
  const SEED = "agent-h-chatbot";
  const evidence = [
    `excessive|${SEED}`,
    `noguardrail|${SEED}`,
  ];

  it("a kinds filter for AI agents keeps their risk evidence attached", () => {
    const shown = ids(
      projectGraph(RISK_DOC, { seedIds: [SEED], depth: 1, filters: { kinds: ["AI_AGENT"] } }),
    );
    for (const id of evidence) expect(shown.has(id)).toBe(true);
    expect(shown.has(`sa-${SEED}`)).toBe(false); // real inventory is still filtered out
  });

  it("severity, cloud and project filters do not strip risk evidence either", () => {
    for (const filters of [
      { severities: ["CRITICAL"] },
      { clouds: ["AWS"] },
      { projects: ["PROJECT-NOPE"] },
    ]) {
      const shown = ids(projectGraph(RISK_DOC, { seedIds: [SEED], depth: 1, filters }));
      for (const id of evidence) expect(shown.has(id)).toBe(true);
    }
  });

  it("naming a risk kind is curation, and is honored verbatim", () => {
    const shown = ids(
      projectGraph(RISK_DOC, {
        seedIds: [SEED],
        depth: 1,
        filters: { kinds: ["AI_AGENT", "EXCESSIVE_PRIVILEGE"] },
      }),
    );
    expect(shown.has(`excessive|${SEED}`)).toBe(true);
    expect(shown.has(`noguardrail|${SEED}`)).toBe(false);
  });

  it("a data-finding aggregate rides through a cloud filter; its STORE does not", () => {
    // The line this asserts: DATA_FINDING is risk evidence (no cloud of its own, so a cloud
    // filter must not sever it from the store it describes), while BUCKET is inventory the
    // tenant owns (filtering to AWS *should* drop a GCP bucket). Filtering the store out
    // takes the finding with it, because BFS only reaches neighbours of admitted nodes.
    const doc = withDataFindingNodes({
      nodes: [
        { id: "sa", kind: "SERVICE_ACCOUNT", name: "sa", cloudPlatform: "GCP" },
        {
          id: "store", kind: "BUCKET", name: "store", cloudPlatform: "GCP",
          hasSensitiveData: true, dataFindingCount: 3, dataFindingSeverities: { HIGH: 3 },
        },
      ],
      edges: [{ id: "e1", src: "sa", dst: "store", type: "ALLOWS_ACCESS_TO" }],
      syncedAt: "2026-06-28T05:00:00Z",
    });

    const kept = ids(projectGraph(doc, { seedIds: ["sa"], depth: 2, filters: { clouds: ["GCP"] } }));
    expect(kept.has("store")).toBe(true);
    expect(kept.has("datafinding|store")).toBe(true);

    const dropped = ids(
      projectGraph(doc, { seedIds: ["sa"], depth: 2, filters: { clouds: ["AWS"] } }),
    );
    expect(dropped.has("store")).toBe(false);
    expect(dropped.has("datafinding|store")).toBe(false);
  });
});
