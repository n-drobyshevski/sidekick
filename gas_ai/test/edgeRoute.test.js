// Edge routing: no link may run through a card that is not its own endpoint.
//
// The direct analogue of graphLayout.test.ts's "no two node cards (196x56) overlap anywhere on
// the canvas" — that one pins the placement, this one pins what is drawn between the placements.
//
// The path is checked by PARSING THE EMITTED `d` STRING and walking it, rather than by trusting
// the polyline the router hands back. The renderer draws the string; if the string and the
// polyline ever disagree, this suite has to fail rather than agree with the bug.

import { describe, expect, it } from "vitest";
import { buildField, directGeometry, edgePath } from "../src/client/js/edgeRoute.js";
import { enrichGraphDoc, withOpenCounts } from "../src/domain/graphEnrich";
import { LAYOUT_MODES, layoutGraph } from "../src/domain/graphLayout";
import { projectGraph } from "../src/domain/graphProject";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

const NODE_W = 196;
const NODE_H = 56;

const ENRICHED = enrichGraphDoc(seedGraphDoc("2026-06-28T05:00:00Z"), SEED_ISSUES, SEED_AARS_HINTS);
const DOC = { ...ENRICHED, nodes: withOpenCounts(ENRICHED.nodes, SEED_ISSUES, []) };
const AGENTS = DOC.nodes.filter((n) => n.kind === "AI_AGENT").map((n) => n.id);
const MANY = projectGraph(DOC, { seedIds: AGENTS, depth: 1, maxNodes: 120 });
const ONE = projectGraph(DOC, { seedIds: ["agent-h-chatbot", "agent-autogen"], depth: 3 });

/** `freeForm` as graphView.js computes it — the two have to agree or this tests another canvas. */
const freeFormOf = (layout) =>
  (layout.groups || []).length > 0 || layout.mode === "radial" || layout.mode === "organic"
  || layout.mode === "grid";

/** Tokenise "M x y L x y C x y, x y, x y ..." into a flat list of points along the path. */
function samplePath(d, per = 24) {
  const parts = d.match(/[MLC][^MLC]*/g) || [];
  const pts = [];
  let cur = null;
  for (const part of parts) {
    const nums = (part.slice(1).match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (part[0] === "M") {
      cur = [nums[0], nums[1]];
      pts.push(cur);
    } else if (part[0] === "L") {
      const next = [nums[0], nums[1]];
      for (let i = 1; i <= per; i++) {
        pts.push([cur[0] + (next[0] - cur[0]) * (i / per), cur[1] + (next[1] - cur[1]) * (i / per)]);
      }
      cur = next;
    } else {
      const [c1x, c1y, c2x, c2y, ex, ey] = nums;
      for (let i = 1; i <= per; i++) {
        const t = i / per;
        const u = 1 - t;
        pts.push([
          u * u * u * cur[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * cur[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ]);
      }
      cur = [ex, ey];
    }
  }
  return pts;
}

/** Every drawn link for one arrangement, with the cards it walks through. */
function draw(projection, opts) {
  const layout = layoutGraph(projection, opts);
  const positions = layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const field = buildField(positions);
  const freeForm = freeFormOf(layout);
  const byId = new Map(positions.map((p) => [p.id, p]));
  const out = [];
  for (const e of projection.edges) {
    const a = byId.get(e.src);
    const b = byId.get(e.dst);
    if (!a || !b) continue;
    const geo = edgePath(a, b, field, freeForm);
    const through = [];
    for (const pt of samplePath(geo.d)) {
      for (const p of positions) {
        if (p.id === e.src || p.id === e.dst) continue;
        if (pt[0] > p.x - NODE_W / 2 && pt[0] < p.x + NODE_W / 2
          && pt[1] > p.y - NODE_H / 2 && pt[1] < p.y + NODE_H / 2) {
          if (!through.includes(p.id)) through.push(p.id);
        }
      }
    }
    out.push({ edge: e, geo, through });
  }
  return { layout, out, field, positions, freeForm };
}

const CASES = [];
for (const mode of LAYOUT_MODES) {
  for (const groupBy of [[], ["cloud"]]) {
    CASES.push({ mode, groupBy, label: `${mode}${groupBy.length ? " by cloud" : ""}` });
  }
}

describe("edgeRoute: a routed link never crosses a card", () => {
  for (const fixture of [{ name: "MANY", p: MANY }, { name: "ONE", p: ONE }]) {
    for (const c of CASES) {
      it(`${fixture.name} / ${c.label}: every routed path clears every foreign card`, () => {
        const { out } = draw(fixture.p, { mode: c.mode, groupBy: c.groupBy });
        const bad = out.filter((r) => r.geo.routed && r.through.length);
        expect(bad.map((r) => `${r.edge.src}->${r.edge.dst} through ${r.through.join(",")}`)).toEqual([]);
      });
    }
  }

  it("the fixtures really do exercise the router", () => {
    // Guards every assertion above: if nothing were routed they would all pass vacuously.
    const { out } = draw(MANY, { mode: "grid", groupBy: [] });
    expect(out.filter((r) => r.geo.routed).length).toBeGreaterThan(10);
  });
});

describe("edgeRoute: a rounded corner is shrunk rather than cut through a card", () => {
  // ROUNDING A CORNER MOVES THE LINE INTO THE INSIDE OF THE TURN, which is exactly where the card
  // the route just went around is standing. A radius chosen from the leg lengths alone therefore
  // puts the smoothed curve back through the obstacle the router avoided, and `smoothPath` halves
  // it until it clears.
  //
  // The seeded fixtures cannot show this: they sit on the 240x84 lattice, whose 44x28 gutters are
  // wider than the corner radius, so the naive radius happens to be safe and the guard never
  // fires. Deleting the re-check leaves all of them passing. A tighter lattice is where it bites —
  // at these gaps the same routes come out 34/62 crossing without it, and 0 with it — and the
  // free-form arrangements pack cards this close in practice.
  const tight = (gapX, gapY) => {
    const positions = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        positions.push({ id: `n${r}-${c}`, x: c * (NODE_W + gapX), y: r * (NODE_H + gapY) });
      }
    }
    return positions;
  };

  for (const [gapX, gapY] of [[8, 6], [4, 4], [24, 2]]) {
    it(`clears every card on a lattice with ${gapX}x${gapY} gutters`, () => {
      const positions = tight(gapX, gapY);
      const field = buildField(positions);
      expect(field).not.toBeNull();
      const byId = new Map(positions.map((p) => [p.id, p]));
      const offenders = [];
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          for (const [tr, tc] of [[r + 3, c], [r, c + 3], [r + 2, c + 2], [r + 4, c + 1]]) {
            const a = byId.get(`n${r}-${c}`);
            const b = byId.get(`n${tr}-${tc}`);
            if (!a || !b) continue;
            const geo = edgePath(a, b, field, true);
            for (const pt of samplePath(geo.d, 40)) {
              const through = positions.find((p) => p.id !== a.id && p.id !== b.id
                && pt[0] > p.x - NODE_W / 2 && pt[0] < p.x + NODE_W / 2
                && pt[1] > p.y - NODE_H / 2 && pt[1] < p.y + NODE_H / 2);
              if (through) { offenders.push(`${a.id}->${b.id} through ${through.id}`); break; }
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("edgeRoute: what it leaves alone", () => {
  it("an edge that was already clear keeps its exact Bezier", () => {
    // The picture changes only where it must. Well over a third of these links never had a
    // problem, and a router that redrew them too would be a restyling rather than a fix — so this
    // compares the emitted path against the untouched geometry character for character.
    const { out, positions, freeForm } = draw(MANY, { mode: "grid", groupBy: [] });
    const byId = new Map(positions.map((p) => [p.id, p]));
    const untouched = out.filter((r) => !r.geo.routed);
    expect(untouched.length).toBeGreaterThan(0);
    for (const r of untouched) {
      const want = directGeometry(byId.get(r.edge.src), byId.get(r.edge.dst), freeForm);
      expect(r.geo.d, `${r.edge.src}->${r.edge.dst}`).toBe(want.d);
      expect(r.geo.labelX).toBe(want.labelX);
      expect(r.geo.labelY).toBe(want.labelY);
    }
  });

  it("is deterministic", () => {
    const first = draw(MANY, { mode: "grid", groupBy: [] }).out.map((r) => r.geo.d);
    const second = draw(MANY, { mode: "grid", groupBy: [] }).out.map((r) => r.geo.d);
    expect(second).toEqual(first);
  });

  it("falls back to the plain Bezier when there is no field", () => {
    // The cap: past the grid budget `buildField` answers null and every edge is drawn the way it
    // was before this module existed.
    const a = { id: "a", x: 0, y: 0 };
    const b = { id: "b", x: 0, y: 400 };
    expect(edgePath(a, b, null, true)).toEqual(directGeometry(a, b, true));
  });
});
