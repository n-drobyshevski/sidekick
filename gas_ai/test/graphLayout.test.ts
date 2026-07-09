// The layered layout: lane assignment per kind, no coordinate collisions,
// positive bounds, and determinism.

import { describe, expect, it } from "vitest";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import { laneOf, layoutGraph } from "../src/domain/graphLayout";
import { projectGraph } from "../src/domain/graphProject";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

const DOC = enrichGraphDoc(seedGraphDoc("2026-06-28T05:00:00Z"), SEED_ISSUES, SEED_AARS_HINTS);
const PROJECTION = projectGraph(DOC, { seedIds: ["agent-h-chatbot", "agent-autogen"], depth: 3 });

describe("laneOf", () => {
  it("assigns the Wiz-style left-to-right lanes", () => {
    expect(laneOf("ISSUE")).toBe(0);
    expect(laneOf("EXCESSIVE_ACCESS_FINDING")).toBe(0);
    expect(laneOf("AI_AGENT")).toBe(1);
    expect(laneOf("AI_GUARDRAIL")).toBe(1);
    expect(laneOf("SERVICE_ACCOUNT")).toBe(2);
    expect(laneOf("USER_ACCOUNT")).toBe(2);
    expect(laneOf("BUCKET")).toBe(3);
    expect(laneOf("DATABASE")).toBe(3);
    expect(laneOf("VIRTUAL_MACHINE")).toBe(4);
    expect(laneOf("REPOSITORY")).toBe(4);
  });

  it("SUMMARY nodes inherit the lane of the kind they collapse", () => {
    expect(laneOf("SUMMARY", "BUCKET")).toBe(3);
    expect(laneOf("SUMMARY", "USER_ACCOUNT")).toBe(2);
  });
});

describe("layoutGraph", () => {
  it("positions every projected node exactly once", () => {
    const layout = layoutGraph(PROJECTION);
    expect(layout.nodes).toHaveLength(PROJECTION.nodes.length);
    const seen = new Set(layout.nodes.map((n) => n.id));
    expect(seen.size).toBe(PROJECTION.nodes.length);
  });

  it("no two nodes share coordinates", () => {
    const layout = layoutGraph(PROJECTION);
    const coords = new Set(layout.nodes.map((n) => `${n.x},${n.y}`));
    expect(coords.size).toBe(layout.nodes.length);
  });

  it("lane x-positions are consistent and bounds are positive", () => {
    const layout = layoutGraph(PROJECTION, { mode: "lanes" });
    const xByLane = new Map<number, number>();
    for (const n of layout.nodes) {
      const existing = xByLane.get(n.lane);
      if (existing === undefined) xByLane.set(n.lane, n.x);
      else expect(n.x).toBe(existing);
    }
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(layout.width);
      expect(n.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("is deterministic", () => {
    const a = layoutGraph(PROJECTION);
    const b = layoutGraph(PROJECTION);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("declares its mode", () => {
    expect(layoutGraph(PROJECTION, { mode: "lanes" }).mode).toBe("lanes");
    expect(layoutGraph(PROJECTION, { mode: "lanes" }).groups).toBeUndefined();
  });

  // Back-compat lock: explicit defaults must be byte-identical to a bare
  // mode="lanes" call, so shared URLs and cached payloads never shift when the
  // knobs are spelled out.
  it("mode=lanes sort=smart is byte-identical to a bare mode=lanes call", () => {
    const bare = layoutGraph(PROJECTION, { mode: "lanes" });
    const explicit = layoutGraph(PROJECTION, { mode: "lanes", sort: "smart" });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(bare));
  });
});

describe("layoutGraph rows mode (horizontal transpose of lanes, the default)", () => {
  it("is the default mode for a bare call", () => {
    expect(layoutGraph(PROJECTION).mode).toBe("rows");
  });

  it("declares its mode and has no groups", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    expect(layout.mode).toBe("rows");
    expect(layout.groups).toBeUndefined();
  });

  it("bands stack top-to-bottom: one y per lane index, increasing with lane", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const yByLane = new Map<number, number>();
    for (const n of layout.nodes) {
      const existing = yByLane.get(n.lane);
      if (existing === undefined) yByLane.set(n.lane, n.y);
      else expect(n.y).toBe(existing);
    }
    const lanes = [...yByLane.keys()].sort((a, b) => a - b);
    for (let i = 1; i < lanes.length; i++) {
      expect(yByLane.get(lanes[i])!).toBeGreaterThan(yByLane.get(lanes[i - 1])!);
    }
  });

  it("nodes within a band share y and differ in x by 260 (ROW_COL_STEP)", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const byLane = new Map<number, number[]>();
    for (const n of layout.nodes) {
      if (!byLane.has(n.lane)) byLane.set(n.lane, []);
      byLane.get(n.lane)!.push(n.x);
    }
    for (const xs of byLane.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBe(260);
      }
    }
  });

  it("no two node cards (196×56) overlap anywhere on the canvas", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const pts = layout.nodes;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = Math.abs(pts[i].x - pts[j].x);
        const dy = Math.abs(pts[i].y - pts[j].y);
        expect(dx >= 196 || dy >= 56).toBe(true);
      }
    }
  });
});

describe("layoutGraph lanes-mode sort variants", () => {
  const byId = new Map(PROJECTION.nodes.map((n) => [n.id, n]));

  function laneOrders(sort: "severity" | "aars" | "name") {
    const layout = layoutGraph(PROJECTION, { sort });
    const lanes = new Map<number, string[]>();
    // layout.nodes is emitted lane-by-lane in row order.
    for (const n of layout.nodes) {
      if (!lanes.has(n.lane)) lanes.set(n.lane, []);
      lanes.get(n.lane)!.push(n.id);
    }
    return lanes;
  }

  it("sort=name orders every lane alphabetically", () => {
    for (const ids of laneOrders("name").values()) {
      for (let i = 1; i < ids.length; i++) {
        expect(byId.get(ids[i - 1])!.name <= byId.get(ids[i])!.name).toBe(true);
      }
    }
  });

  it("sort=aars orders every lane by descending score", () => {
    for (const ids of laneOrders("aars").values()) {
      for (let i = 1; i < ids.length; i++) {
        const prev = byId.get(ids[i - 1])!.aars ?? -1;
        const cur = byId.get(ids[i])!.aars ?? -1;
        expect(prev).toBeGreaterThanOrEqual(cur);
      }
    }
  });

  it("explicit sorts are deterministic", () => {
    const a = layoutGraph(PROJECTION, { sort: "severity" });
    const b = layoutGraph(PROJECTION, { sort: "severity" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
