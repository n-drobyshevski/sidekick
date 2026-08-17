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

function overlaps(a, b) {
  return a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H;
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
});
