// The layered layout: lane assignment per kind, no coordinate collisions,
// positive bounds, and determinism.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import { LAYOUT_MODES, type GroupKey, laneOf, layoutGraph } from "../src/domain/graphLayout";
import { resolveLayoutParams } from "../src/domain/graphApiParams";
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

// ------------------------------------------------- the two free-form layouts
//
// "radial" and "organic" carry no bands, so almost nothing in the suites above applies to them —
// and the two invariants that DO apply to every layout in this file (every node placed once, no
// two cards overlapping) are exactly the ones a new engine is most likely to break. Radial can
// break them by mis-deriving a ring radius; organic by design, since Fruchterman–Reingold treats
// nodes as points and knows nothing about the 196×56 card drawn around each one.

/** Every pair of node cards that would visually collide. Empty is the invariant. */
function collisions(nodes: Array<{ id: string; x: number; y: number }>): string[] {
  const bad: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = Math.abs(nodes[i].x - nodes[j].x);
      const dy = Math.abs(nodes[i].y - nodes[j].y);
      if (dx < 196 && dy < 56) bad.push(`${nodes[i].id}/${nodes[j].id}`);
    }
  }
  return bad;
}

describe.each(["radial", "organic"] as const)("layoutGraph %s mode", (mode) => {
  const layout = layoutGraph(PROJECTION, { mode });

  it("places every projected node exactly once", () => {
    expect(layout.nodes).toHaveLength(PROJECTION.nodes.length);
    expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(PROJECTION.nodes.length);
  });

  it("declares its mode and draws no group boxes", () => {
    expect(layout.mode).toBe(mode);
    expect(layout.groups).toBeUndefined();
  });

  it("keeps every card clear of every other", () => {
    expect(collisions(layout.nodes)).toEqual([]);
  });

  it("fits inside its own declared bounds", () => {
    // The canvas is what "fit to view" scales by, so a node outside it is a node that cannot be
    // reached at any zoom.
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(layout.width);
      expect(n.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("is deterministic, forces or not", () => {
    // The property the file header trades on. Organic runs a force simulation and still has to
    // answer this: its seed is a computed order, never Math.random.
    expect(JSON.stringify(layoutGraph(PROJECTION, { mode })))
      .toBe(JSON.stringify(layoutGraph(PROJECTION, { mode })));
  });

  it("reports hops from the hub as the lane, so the keyboard has an axis to walk", () => {
    // graphView.js walks `lane` with two of its four arrows. A layout answering 0 for everything
    // would leave those two keys stepping through the whole graph in array order.
    const lanes = [...new Set(layout.nodes.map((n) => n.lane))].sort((a, b) => a - b);
    expect(lanes.length).toBeGreaterThan(2);
    // Contiguous from the centre out: a gap would mean an empty ring was sized and drawn.
    expect(lanes).toEqual(lanes.map((_, i) => i));
    // Exactly one node at the centre — the estate's worst-risk asset.
    expect(layout.nodes.filter((n) => n.lane === 0)).toHaveLength(1);
  });

  it("responds to the sort, so the Order control still means something", () => {
    // Both modes order by the comparator — radial for its angular sequence, organic for the seed
    // that sequence becomes. A control that changed nothing would be a lie on the screen.
    expect(JSON.stringify(layoutGraph(PROJECTION, { mode, sort: "name" })))
      .not.toBe(JSON.stringify(layoutGraph(PROJECTION, { mode, sort: "aars" })));
  });
});

describe("layoutGraph radial mode geometry", () => {
  const layout = layoutGraph(PROJECTION, { mode: "radial" });
  const centre = layout.nodes.find((n) => n.lane === 0)!;
  const radius = (n: { x: number; y: number }) =>
    Math.sqrt((n.x - centre.x) ** 2 + (n.y - centre.y) ** 2);

  it("puts the highest-risk AI agent at the centre", () => {
    const byId = new Map(PROJECTION.nodes.map((n) => [n.id, n]));
    expect(byId.get(centre.id)!.kind).toBe("AI_AGENT");
  });

  it("holds one ring per hop, each at a single radius", () => {
    const byLane = new Map<number, number[]>();
    for (const n of layout.nodes) {
      if (n.lane === 0) continue;
      if (!byLane.has(n.lane)) byLane.set(n.lane, []);
      byLane.get(n.lane)!.push(radius(n));
    }
    for (const [lane, radii] of byLane) {
      const first = radii[0];
      // Equidistant to within rounding — round2 is the only thing separating them.
      for (const r of radii) expect(Math.abs(r - first), `lane ${lane}`).toBeLessThan(0.5);
    }
  });

  it("orders the rings outward, so a ring is readable as a distance", () => {
    const radiusOf = new Map<number, number>();
    for (const n of layout.nodes) if (n.lane > 0) radiusOf.set(n.lane, radius(n));
    const lanes = [...radiusOf.keys()].sort((a, b) => a - b);
    for (let i = 1; i < lanes.length; i++) {
      expect(radiusOf.get(lanes[i])!).toBeGreaterThan(radiusOf.get(lanes[i - 1])!);
    }
  });

  it("sizes a busy ring by its occupancy rather than by a constant", () => {
    // The chord between neighbours has to clear a card width, which is what makes the mode
    // overlap-free at any ring size. A constant radius could not — and the arc-length formula,
    // the tempting one, over-estimates the gap on a small ring by up to π/2.
    const crowded = { syncedAt: DOC.syncedAt, nodes: [{ id: "hub", kind: "AI_AGENT", name: "hub" }],
      edges: [] as Array<{ id: string; src: string; dst: string; type: string }> };
    for (let i = 0; i < 40; i++) {
      crowded.nodes.push({ id: "b" + i, kind: "BUCKET", name: "b" + i });
      crowded.edges.push({ id: "e" + i, src: "hub", dst: "b" + i, type: "ALLOWS_ACCESS_TO" });
    }
    // The per-kind fan-out cap collapses 40 buckets into a SUMMARY stub, which is the
    // projection's job and not this layout's — lifted here so the ring under test is the crowded
    // one the formula exists for.
    const wide = layoutGraph(
      projectGraph(crowded as never, {
        seedIds: ["hub"], depth: 2, maxNodes: 60, maxEdges: 60, perKindCap: { BUCKET: 60 },
      }),
      { mode: "radial" });
    expect(wide.nodes).toHaveLength(41);
    expect(collisions(wide.nodes)).toEqual([]);
    // 40 cards on one ring need far more room than the sparse-ring floor would have given them.
    const hub = wide.nodes.find((n) => n.lane === 0)!;
    const ring = wide.nodes.filter((n) => n.lane === 1)[0];
    expect(Math.sqrt((ring.x - hub.x) ** 2 + (ring.y - hub.y) ** 2)).toBeGreaterThan(1400);
  });

  it("puts unreachable nodes on the outermost ring, not at the centre", () => {
    // A node with no path to the hub is the furthest thing from it, and filing it at distance 0
    // would put it in the position the layout reserves for its source.
    const split = { syncedAt: DOC.syncedAt,
      nodes: [
        { id: "hub", kind: "AI_AGENT", name: "hub" },
        { id: "near", kind: "SERVICE_ACCOUNT", name: "near" },
        { id: "lonely", kind: "BUCKET", name: "lonely" },
      ],
      edges: [{ id: "e0", src: "hub", dst: "near", type: "RUNS_AS" }] };
    const out = layoutGraph(
      projectGraph(split as never, { seedIds: ["hub", "lonely"], depth: 2, maxNodes: 10, maxEdges: 10 }),
      { mode: "radial" });
    const laneOfId = new Map(out.nodes.map((n) => [n.id, n.lane]));
    expect(laneOfId.get("hub")).toBe(0);
    expect(laneOfId.get("near")).toBe(1);
    expect(laneOfId.get("lonely")).toBe(2);
  });
});

describe("layoutGraph organic mode forces", () => {
  it("pulls connected nodes closer than the ring seed put them", () => {
    // Otherwise this is the radial layout with extra steps. Mean edge length is the honest
    // measure: individual edges can lengthen as a cluster rotates into place.
    const mean = (mode: "radial" | "organic") => {
      const layout = layoutGraph(PROJECTION, { mode });
      const at = new Map(layout.nodes.map((n) => [n.id, n]));
      const lengths = PROJECTION.edges
        .filter((e) => at.has(e.src) && at.has(e.dst))
        .map((e) => Math.hypot(at.get(e.src)!.x - at.get(e.dst)!.x, at.get(e.src)!.y - at.get(e.dst)!.y));
      return lengths.reduce((a, b) => a + b, 0) / lengths.length;
    };
    expect(mean("organic")).toBeLessThan(mean("radial"));
  });

  it("keeps disconnected nodes on the canvas instead of letting them fly", () => {
    // Fruchterman–Reingold says nothing about a node with no springs: repulsion alone pushes it
    // outward forever, and the bounds — and therefore the zoom — follow it. The gravity term is
    // what holds it, and this is the case that proves the term is doing its job.
    const strays = { syncedAt: DOC.syncedAt,
      nodes: [
        { id: "hub", kind: "AI_AGENT", name: "hub" },
        { id: "sa", kind: "SERVICE_ACCOUNT", name: "sa" },
        { id: "x1", kind: "BUCKET", name: "x1" },
        { id: "x2", kind: "BUCKET", name: "x2" },
        { id: "x3", kind: "BUCKET", name: "x3" },
      ],
      edges: [{ id: "e0", src: "hub", dst: "sa", type: "RUNS_AS" }] };
    const p = projectGraph(strays as never,
      { seedIds: ["hub", "x1", "x2", "x3"], depth: 2, maxNodes: 10, maxEdges: 10 });
    const out = layoutGraph(p, { mode: "organic" });
    expect(out.nodes).toHaveLength(p.nodes.length);
    expect(collisions(out.nodes)).toEqual([]);
    for (const n of out.nodes) {
      expect(n.x).toBeLessThanOrEqual(out.width);
      expect(n.y).toBeLessThanOrEqual(out.height);
    }
    // Nothing has run away: the canvas stays within a few screens rather than a few thousand.
    expect(out.width).toBeLessThan(6000);
    expect(out.height).toBeLessThan(6000);
  });

  it("stays inside its budget at the node ceiling", () => {
    // Repulsion is all-pairs, so one pass costs n². The iteration count is traded against that
    // (FR_PAIR_BUDGET) precisely so the 400-node ceiling stays usable; without the trade this is
    // where the mode would quietly time out a request.
    const big = { syncedAt: DOC.syncedAt,
      nodes: [{ id: "hub", kind: "AI_AGENT", name: "hub" }] as Array<Record<string, string>>,
      edges: [] as Array<Record<string, string>> };
    for (let i = 0; i < 399; i++) {
      big.nodes.push({ id: "n" + i, kind: i % 3 ? "BUCKET" : "SERVICE_ACCOUNT", name: "n" + i });
      big.edges.push({
        id: "e" + i, type: "ALLOWS_ACCESS_TO",
        src: i < 8 ? "hub" : "n" + Math.floor(i / 8 - 1), dst: "n" + i,
      });
    }
    const p = projectGraph(big as never,
      { seedIds: ["hub"], depth: 12, maxNodes: 400, maxEdges: 800 });
    expect(p.nodes.length).toBe(400);
    const started = Date.now();
    const out = layoutGraph(p, { mode: "organic" });
    const ms = Date.now() - started;
    expect(out.nodes).toHaveLength(400);
    expect(collisions(out.nodes)).toEqual([]);
    // Generous — this is a ceiling that catches an O(n³) regression, not a benchmark.
    expect(ms).toBeLessThan(3000);
  });
});

// ANTI-ROT. A layout lives in five places: the domain's LAYOUT_MODES, the engine's dispatch, the
// page's LAYOUTS table (the list, and the whitelist derived from it), the renderer's free-form
// test, and the resolver. Adding "radial" and "organic" to four of them and missing the fifth is
// exactly what happened: `graphParams` carried a hand-written `=== "grouped" || === "lanes"`, so
// the URL kept the new mode, the domain understood it, and the page quietly rewrote it to rows on
// the way to the request. No error, no failing type — just a layout that never appeared.
//
// graph.js cannot be imported here (it is DOM-shaped and there is no jsdom), so its table is read
// as source, the way test/icons.test.js reads help.js for its glyph names.
describe("the page's layout list and the domain agree", () => {
  const PAGE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/client/js/pages/graph.js"), "utf8");

  /** The `mode:` values in graph.js's LAYOUTS table. "" is Rows — the absent hash value. */
  function pageModes(): string[] {
    const table = PAGE.slice(PAGE.indexOf("const LAYOUTS = ["));
    const body = table.slice(0, table.indexOf("\n];"));
    return [...body.matchAll(/mode:\s*"([^"]*)"/g)].map((m) => m[1]);
  }

  it("offers one row per engine, and no row for an engine that does not exist", () => {
    const listed = pageModes();
    expect(listed).toContain("");                          // Rows, as the absent value
    expect(new Set(listed.filter(Boolean))).toEqual(new Set(LAYOUT_MODES.filter((m) => m !== "rows")));
  });

  it("keeps the picker's whitelist derived from that table, never hand-written", () => {
    // The literal that caused the bug. If a comparison against a specific mode name reappears in
    // graphParams, this is the test that says so.
    const fn = PAGE.slice(PAGE.indexOf("function graphParams("));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("normalizeLayout(params.layout)");
    for (const mode of LAYOUT_MODES) {
      expect(body, `graphParams must not name ${mode} directly`).not.toContain(`=== "${mode}"`);
    }
    const norm = PAGE.slice(PAGE.indexOf("function normalizeLayout("));
    expect(norm.slice(0, norm.indexOf("\n}"))).toContain("LAYOUT_MODES.includes");
  });

  it("agrees with the resolver about what a retired layout value becomes", () => {
    // The client maps old `layout=` values for the row it marks; the resolver maps them for the
    // picture it draws. Two copies, because the client bundle cannot import the domain — so the
    // one thing worth pinning is that they map to the SAME arrangement. Diverge, and a legacy
    // link would mark one row in the list while the canvas drew another.
    const alias = PAGE.slice(PAGE.indexOf("const LAYOUT_ALIAS = {"));
    const pairs = [...alias.slice(0, alias.indexOf("};")).matchAll(/(\w+):\s*"([^"]+)"/g)];
    expect(pairs.length).toBeGreaterThan(0);
    for (const [, from, to] of pairs) {
      expect(LAYOUT_MODES, `${to} must be a real arrangement`).toContain(to);
      expect(LAYOUT_MODES, `${from} must be retired, not live`).not.toContain(from);
      expect(resolveLayoutParams({ layout: from }).mode, `resolver maps ${from}`).toBe(to);
    }
  });
});

// ------------------------------------------- grouping × arrangement, the whole grid
//
// The two are independent controls, so the claim this suite has to hold up is that EVERY pair
// works — not that grouping works and the arrangements work. The failure mode of a composed
// feature is one cell of the grid: "organic grouped by cloud" placing nodes outside their own
// box, or "rows grouped by cloud, kind" reserving six band gaps inside a two-band group and
// overlapping the box beside it.
//
// Grouping used to BE one of the arrangements, so this grid could not be written at all — naming
// a layout meant giving up grouping and vice versa.
describe.each(LAYOUT_MODES)("%s, grouped", (mode) => {
  const boxes = (l: ReturnType<typeof layoutGraph>) => l.groups ?? [];
  /** The leaf boxes — the ones a node actually sits in. With one level, all of them. */
  const leaves = (l: ReturnType<typeof layoutGraph>) => {
    const all = boxes(l);
    const nested = all.some((g) => g.depth === 1);
    return all.filter((g) => (nested ? g.depth === 1 : g.depth === 0));
  };

  for (const groupBy of [["cloud"], ["cloud", "kind"]] as GroupKey[][]) {
    const label = groupBy.join(" then ");
    const layout = layoutGraph(PROJECTION, { mode, groupBy });

    it(`by ${label}: places every node once, and reports the arrangement`, () => {
      expect(layout.nodes).toHaveLength(PROJECTION.nodes.length);
      expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(PROJECTION.nodes.length);
      // `mode` is the ARRANGEMENT even when grouped — the boxes are what say it is grouped.
      expect(layout.mode).toBe(mode);
      expect(boxes(layout).length).toBeGreaterThan(0);
    });

    it(`by ${label}: keeps every node inside its own box`, () => {
      const at = new Map(layout.nodes.map((n) => [n.id, n]));
      // Every leaf box has to contain each of its members' centres. A block form that measured
      // its own extent wrongly shows up here and nowhere else.
      let checked = 0;
      for (const g of leaves(layout)) {
        const inside = layout.nodes.filter((n) => n.x >= g.x && n.x <= g.x + g.width
          && n.y >= g.y && n.y <= g.y + g.height);
        expect(inside.length, `${g.id} holds ${g.count}`).toBe(g.count);
        checked += g.count;
      }
      expect(checked).toBe(at.size);
    });

    it(`by ${label}: draws no two boxes over each other, per level`, () => {
      for (const depth of [0, 1]) {
        const level = boxes(layout).filter((g) => g.depth === depth);
        for (let i = 0; i < level.length; i++) {
          for (let j = i + 1; j < level.length; j++) {
            const a = level[i];
            const b = level[j];
            const apart = a.x + a.width <= b.x || b.x + b.width <= a.x
              || a.y + a.height <= b.y || b.y + b.height <= a.y;
            expect(apart, `${a.id} vs ${b.id}`).toBe(true);
          }
        }
      }
    });

    it(`by ${label}: keeps every card clear of every other`, () => {
      expect(collisions(layout.nodes)).toEqual([]);
    });

    it(`by ${label}: conserves the counts and is deterministic`, () => {
      expect(leaves(layout).reduce((n, g) => n + g.count, 0)).toBe(PROJECTION.nodes.length);
      expect(JSON.stringify(layoutGraph(PROJECTION, { mode, groupBy })))
        .toBe(JSON.stringify(layout));
    });
  }
});

describe("grouping and the arrangement do not constrain each other", () => {
  it("draws boxes for every arrangement, and none for any of them ungrouped", () => {
    for (const mode of LAYOUT_MODES) {
      expect(layoutGraph(PROJECTION, { mode }).groups, `${mode} ungrouped`).toBeUndefined();
      expect(layoutGraph(PROJECTION, { mode, groupBy: ["cloud"] }).groups, `${mode} grouped`)
        .toBeDefined();
    }
  });

  it("changes the interior when the arrangement changes, boxes and all held still", () => {
    // If the arrangement were ignored while grouping was on — which is what the old design did,
    // structurally — every one of these would be the same picture.
    const seen = new Set(LAYOUT_MODES.map((mode) =>
      JSON.stringify(layoutGraph(PROJECTION, { mode, groupBy: ["cloud"] }).nodes)));
    expect(seen.size).toBe(LAYOUT_MODES.length);
  });

  it("changes the boxes when the grouping changes, the arrangement held still", () => {
    const keys = (groupBy: GroupKey[]) =>
      (layoutGraph(PROJECTION, { mode: "rows", groupBy }).groups ?? []).map((g) => g.by);
    expect(keys(["cloud"])).toContain("cloud");
    expect(keys(["kind"])).toContain("kind");
    expect(keys(["cloud", "kind"])).toEqual(expect.arrayContaining(["cloud", "kind"]));
  });

  it("compacts the bands inside a box, and only inside a box", () => {
    // Six category bands are a fixed frame of reference on the whole canvas — an empty one says
    // "no compute in view". Inside a group they are dead air, so occupied bands close up. A box
    // holding two categories must be nowhere near six band-gaps tall.
    const flat = layoutGraph(PROJECTION, { mode: "rows" });
    const bandsUsed = [...new Set(flat.nodes.map((n) => n.lane))].sort((a, b) => a - b);
    expect(bandsUsed.length).toBeLessThan(6);      // the sample estate leaves a band empty…
    // …and the canvas still spaces bands by their TRUE index, so the empty one leaves its gap.
    // Read within one shelf, since a wrap adds a whole band set below.
    const firstShelf = flat.nodes.filter((n) => (n.shelf ?? 0) === 0);
    const yOf = new Map(firstShelf.map((n) => [n.lane, n.y]));
    const base = Math.min(...yOf.keys());
    for (const lane of yOf.keys()) {
      expect(yOf.get(lane)! - yOf.get(base)!, `band ${lane}`).toBe((lane - base) * 150);
    }
    // The gap the empty band leaves — the thing `compactBands` closes up inside a box.
    expect(bandsUsed.some((l, i) => i > 0 && l - bandsUsed[i - 1] > 1)).toBe(true);
    const grouped = layoutGraph(PROJECTION, { mode: "rows", groupBy: ["kind"] });
    // Grouped by kind, every box holds ONE category, so every box is a single band tall.
    for (const g of grouped.groups ?? []) {
      const ys = new Set(grouped.nodes.filter((n) => n.x >= g.x && n.x <= g.x + g.width
        && n.y >= g.y && n.y <= g.y + g.height).map((n) => n.y));
      expect(ys.size, `${g.id} band count`).toBe(1);
    }
  });
});
