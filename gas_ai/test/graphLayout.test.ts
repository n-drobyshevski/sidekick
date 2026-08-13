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
    // The data-exposure chain reads left to right and ends here, one band past the store it
    // describes — so the edge from bucket to findings is short, not a run back to band 0.
    expect(laneOf("DATA_FINDING")).toBe(4);
    expect(laneOf("VIRTUAL_MACHINE")).toBe(5);
    expect(laneOf("REPOSITORY")).toBe(5);
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
    // A lane repeats on every shelf, so a lane's x is fixed per shelf, not globally.
    const xByLane = new Map<string, number>();
    for (const n of layout.nodes) {
      const key = `${n.shelf ?? 0}:${n.lane}`;
      const existing = xByLane.get(key);
      if (existing === undefined) xByLane.set(key, n.x);
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

  it("bands stack top-to-bottom within a shelf, and shelves stack below one another", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const yByBand = new Map<string, number>();
    for (const n of layout.nodes) {
      const key = `${n.shelf ?? 0}:${n.lane}`;
      const existing = yByBand.get(key);
      if (existing === undefined) yByBand.set(key, n.y);
      else expect(n.y).toBe(existing);
    }
    const bands = [...yByBand.keys()]
      .map((k) => ({ shelf: Number(k.split(":")[0]), lane: Number(k.split(":")[1]), y: yByBand.get(k)! }))
      .sort((a, b) => a.shelf - b.shelf || a.lane - b.lane);
    for (let i = 1; i < bands.length; i++) {
      // Reading order is shelf then band, and y only ever moves down.
      expect(bands[i].y).toBeGreaterThan(bands[i - 1].y);
    }
    // A shelf boundary must open a wider gap than the bands inside a shelf do.
    const shelves = new Set(bands.map((b) => b.shelf));
    if (shelves.size > 1) {
      const firstOfShelf1 = bands.find((b) => b.shelf === 1)!;
      const lastOfShelf0 = [...bands].reverse().find((b) => b.shelf === 0)!;
      expect(firstOfShelf1.y - lastOfShelf0.y).toBeGreaterThan(150);
    }
  });

  it("cards step by 260 (ROW_COL_STEP) inside a cluster and further between clusters", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const byLane = new Map<string, Array<{ x: number; cluster?: number }>>();
    for (const n of layout.nodes) {
      const key = `${n.shelf ?? 0}:${n.lane}`;
      if (!byLane.has(key)) byLane.set(key, []);
      byLane.get(key)!.push({ x: n.x, cluster: n.cluster });
    }
    let sawGutter = false;
    for (const row of byLane.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const delta = row[i].x - row[i - 1].x;
        if (row[i].cluster === row[i - 1].cluster) {
          expect(delta).toBe(260);
        } else {
          // Grouping only reads if the gap between clusters beats the step inside one.
          expect(delta).toBeGreaterThanOrEqual(260 + 140);
          sawGutter = true;
        }
      }
    }
    expect(sawGutter).toBe(true); // the fixture must actually exercise the gutter
  });

  it("a cluster's cards are contiguous in every band — nothing foreign between them", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const byLane = new Map<string, Array<{ x: number; cluster?: number }>>();
    for (const n of layout.nodes) {
      const key = `${n.shelf ?? 0}:${n.lane}`;
      if (!byLane.has(key)) byLane.set(key, []);
      byLane.get(key)!.push({ x: n.x, cluster: n.cluster });
    }
    for (const row of byLane.values()) {
      row.sort((a, b) => a.x - b.x);
      const seen = new Set<number | undefined>();
      let prev: number | undefined = -1;
      for (const cell of row) {
        if (cell.cluster === prev) continue;
        expect(seen.has(cell.cluster)).toBe(false); // a cluster may not resume later
        seen.add(cell.cluster);
        prev = cell.cluster;
      }
    }
  });

  it("clusters claim disjoint stripes, in rank order along each shelf", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const spans = new Map<number, { shelf: number; min: number; max: number }>();
    for (const n of layout.nodes) {
      const span = spans.get(n.cluster!);
      if (!span) spans.set(n.cluster!, { shelf: n.shelf ?? 0, min: n.x, max: n.x });
      else {
        // A cluster never straddles a shelf boundary.
        expect(n.shelf ?? 0).toBe(span.shelf);
        span.min = Math.min(span.min, n.x);
        span.max = Math.max(span.max, n.x);
      }
    }
    const ordered = [...spans.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1][1];
      const cur = ordered[i][1];
      // Ranks run left-to-right along a shelf, and no stripe reaches into its neighbor;
      // a new shelf starts over at the left margin.
      expect(cur.shelf).toBeGreaterThanOrEqual(prev.shelf);
      if (cur.shelf === prev.shelf) expect(cur.min).toBeGreaterThan(prev.max);
    }
  });

  it("wrapping lands the canvas near the viewport's shape instead of a ribbon", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows" });
    const shelves = new Set(layout.nodes.map((n) => n.shelf ?? 0)).size;
    expect(shelves).toBeGreaterThan(1); // the fixture is wide enough to wrap
    const aspect = layout.width / layout.height;
    expect(aspect).toBeGreaterThan(0.8);
    expect(aspect).toBeLessThan(4);
    // Unwrapped, the same clusters would have been one band-tall ribbon.
    const flat = layoutGraph(PROJECTION, { mode: "rows", sort: "name" });
    expect(layout.width).toBeLessThan(flat.width);
  });

  it("an explicit order turns clustering off and spaces every card evenly", () => {
    const layout = layoutGraph(PROJECTION, { mode: "rows", sort: "name" });
    expect(layout.nodes.every((n) => n.cluster === undefined)).toBe(true);
    const byLane = new Map<number, number[]>();
    for (const n of layout.nodes) {
      if (!byLane.has(n.lane)) byLane.set(n.lane, []);
      byLane.get(n.lane)!.push(n.x);
    }
    for (const xs of byLane.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(260);
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
