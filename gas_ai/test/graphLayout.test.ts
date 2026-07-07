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
    const layout = layoutGraph(PROJECTION);
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
});
