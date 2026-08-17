// Geometry only: no DOM in this suite (vitest has no jsdom here), which is also why this file
// stays plain .js — tsconfig has no allowJs, so a .ts test importing a client .js module fails
// `tsc --noEmit` and `npm run check` never reaches vitest at all. See test/graphChips.test.js.

import { describe, expect, it } from "vitest";

import { skeletonLayout } from "../src/client/js/graphSkeleton.js";
import { NODE_H, NODE_W } from "../src/client/js/graphNode.js";

const MODES = ["grid", "rows", "lanes", "radial", "organic"];
// rows' bands, lanes' columns and radial's rings all read the node's lane as a position along
// a flow; grid (categories deliberately ignored) and organic (clusters, not a sequence) do not
// promise the same thing and are not asserted here.
const FLOW_MODES = ["rows", "lanes", "radial"];
const COUNTS = [1, 2, 5, 9, 17];
// A range of pane sizes for the measured/fit path (no explicit `count`): a roomy desktop pane,
// something mid-sized, and — the case Defect 2 specifically calls for — one too small to hold
// even a modest arrangement comfortably, to prove the layout degrades gracefully instead of
// producing an invalid or overlapping picture.
const VIEWPORTS = [
  { width: 1400, height: 700 },
  { width: 900, height: 500 },
  { width: 600, height: 420 },
  { width: 260, height: 200 }, // very small
];

function overlaps(a, b) {
  return a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H;
}

/** Generic AABB overlap for the `groups` boxes, which carry their own width/height rather than
 *  the fixed NODE_W/NODE_H `overlaps` above assumes. */
function boxesOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("skeletonLayout", () => {
  for (const mode of MODES) {
    for (const count of COUNTS) {
      it(`${mode} @ ${count}: every card sits fully inside the canvas`, () => {
        const { width, height, nodes } = skeletonLayout(mode, { count });
        expect(nodes).toHaveLength(count);
        for (const n of nodes) {
          expect(n.x).toBeGreaterThanOrEqual(0);
          expect(n.y).toBeGreaterThanOrEqual(0);
          expect(n.x + NODE_W).toBeLessThanOrEqual(width);
          expect(n.y + NODE_H).toBeLessThanOrEqual(height);
        }
      });

      it(`${mode} @ ${count}: no two cards overlap`, () => {
        const { nodes } = skeletonLayout(mode, { count });
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            expect(overlaps(nodes[i], nodes[j])).toBe(false);
          }
        }
      });

      it(`${mode} @ ${count}: byte-identical across two calls`, () => {
        const a = skeletonLayout(mode, { count, grouped: true });
        const b = skeletonLayout(mode, { count, grouped: true });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      });

      it(`${mode} @ ${count}: edges reference distinct, in-range nodes`, () => {
        const { nodes, edges } = skeletonLayout(mode, { count });
        for (const [from, to] of edges) {
          expect(from).not.toBe(to);
          expect(from).toBeGreaterThanOrEqual(0);
          expect(to).toBeGreaterThanOrEqual(0);
          expect(from).toBeLessThan(nodes.length);
          expect(to).toBeLessThan(nodes.length);
        }
      });

      it(`${mode} @ ${count}: grouped emits boxes that contain their members`, () => {
        const { nodes, groups } = skeletonLayout(mode, { count, grouped: true });
        expect(groups.length).toBeGreaterThan(0);
        const byLane = new Map();
        for (const n of nodes) {
          if (!byLane.has(n.lane)) byLane.set(n.lane, []);
          byLane.get(n.lane).push(n);
        }
        for (const g of groups) {
          const members = byLane.get(g.lane) || [];
          expect(members.length).toBeGreaterThan(0);
          for (const m of members) {
            expect(m.x).toBeGreaterThanOrEqual(g.x);
            expect(m.y).toBeGreaterThanOrEqual(g.y);
            expect(m.x + NODE_W).toBeLessThanOrEqual(g.x + g.width);
            expect(m.y + NODE_H).toBeLessThanOrEqual(g.y + g.height);
          }
        }
      });

      // Regression for the defect where every mode but "lanes" drew overlapping group boxes:
      // grouped picks one block per lane and packs the blocks in 2D (see graphSkeleton.js's
      // module comment), which promises boxes are pairwise disjoint in EVERY mode — not just
      // contained around their own members, which the test above already covered and which
      // overlapping boxes can still satisfy.
      it(`${mode} @ ${count}: grouped boxes never overlap each other`, () => {
        const { groups } = skeletonLayout(mode, { count, grouped: true });
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            expect(boxesOverlap(groups[i], groups[j])).toBe(false);
          }
        }
      });

      it(`${mode} @ ${count}: ungrouped emits no boxes`, () => {
        expect(skeletonLayout(mode, { count, grouped: false }).groups).toEqual([]);
      });
    }
  }

  for (const mode of FLOW_MODES) {
    for (const count of COUNTS) {
      it(`${mode} @ ${count}: lane is non-decreasing along the flow`, () => {
        const { nodes } = skeletonLayout(mode, { count });
        for (let i = 1; i < nodes.length; i++) {
          expect(nodes[i].lane).toBeGreaterThanOrEqual(nodes[i - 1].lane);
        }
      });
    }
  }

  it("falls back to grid for an unrecognised mode, same as the page's own layout.layout fallback", () => {
    expect(skeletonLayout("nonsense", { count: 6 })).toEqual(skeletonLayout("grid", { count: 6 }));
  });

  it("defaults count when none is given, rather than laying out zero nodes", () => {
    expect(skeletonLayout("grid").nodes.length).toBeGreaterThan(0);
  });

  // The measured/fit path: no explicit `count`, so the node count is derived from `width` /
  // `height` and the canvas itself is expected to come back at (close to) the size asked for —
  // the whole point of the fix being that a ghost card is exactly NODE_W x NODE_H at whatever
  // size the pane turns out to be, never scaled by the SVG to make a mismatched viewBox fit.
  for (const mode of MODES) {
    for (const viewport of VIEWPORTS) {
      const label = `${mode} @ ${viewport.width}x${viewport.height}`;

      it(`${label}: every card sits fully inside the canvas`, () => {
        const { width, height, nodes } = skeletonLayout(mode, viewport);
        expect(nodes.length).toBeGreaterThan(0);
        for (const n of nodes) {
          expect(n.x).toBeGreaterThanOrEqual(0);
          expect(n.y).toBeGreaterThanOrEqual(0);
          expect(n.x + NODE_W).toBeLessThanOrEqual(width);
          expect(n.y + NODE_H).toBeLessThanOrEqual(height);
        }
      });

      it(`${label}: no two cards overlap`, () => {
        const { nodes } = skeletonLayout(mode, viewport);
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            expect(overlaps(nodes[i], nodes[j])).toBe(false);
          }
        }
      });

      it(`${label}: byte-identical across two calls`, () => {
        const a = skeletonLayout(mode, { ...viewport, grouped: true });
        const b = skeletonLayout(mode, { ...viewport, grouped: true });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      });

      it(`${label}: grouped boxes never overlap each other`, () => {
        const { groups } = skeletonLayout(mode, { ...viewport, grouped: true });
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            expect(boxesOverlap(groups[i], groups[j])).toBe(false);
          }
        }
      });
    }
  }

  for (const mode of FLOW_MODES) {
    for (const viewport of VIEWPORTS) {
      it(`${mode} @ ${viewport.width}x${viewport.height}: lane is non-decreasing along the flow`, () => {
        const { nodes } = skeletonLayout(mode, viewport);
        for (let i = 1; i < nodes.length; i++) {
          expect(nodes[i].lane).toBeGreaterThanOrEqual(nodes[i - 1].lane);
        }
      });
    }
  }

  // The core promise of the measured contract: at a plausible pane size (not the degenerate
  // very-small one above, where growing past the pane is the documented, acceptable fallback),
  // the layout fits the space it was given exactly rather than needing to grow past it — which
  // is what guarantees the SVG never has anything left to rescale.
  for (const mode of MODES) {
    for (const viewport of VIEWPORTS.slice(0, 3)) {
      it(`${mode} @ ${viewport.width}x${viewport.height}: canvas matches the pane exactly, not padded past it`, () => {
        const { width, height } = skeletonLayout(mode, viewport);
        expect(width).toBe(viewport.width);
        expect(height).toBe(viewport.height);
      });
    }
  }
});
