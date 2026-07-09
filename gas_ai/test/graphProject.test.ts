// The depth-limited projection: horizons, per-kind caps with SUMMARY collapse,
// global budgets, expandIds, filters (seeds exempt), and determinism.

import { describe, expect, it } from "vitest";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
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
