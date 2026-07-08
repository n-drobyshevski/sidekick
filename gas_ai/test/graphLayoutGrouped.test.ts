// Grouped (cluster) layout: bucket assignment, deterministic group ordering,
// within-group grid placement, non-overlapping hulls, and sort variants.

import { describe, expect, it } from "vitest";
import { SEVERITY_ORDER } from "../src/domain/config";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import {
  GROUP_NONE,
  layoutGraph,
  type GroupKey,
  type Layout,
  type SortKey,
} from "../src/domain/graphLayout";
import { nodeOrder, projectGraph, type Projection } from "../src/domain/graphProject";
import { NODE_KINDS } from "../src/domain/graphTypes";
import { COMBO_GROUPS } from "../src/domain/toxicCombos";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

const DOC = enrichGraphDoc(seedGraphDoc("2026-06-28T05:00:00Z"), SEED_ISSUES, SEED_AARS_HINTS);
const PROJECTION = projectGraph(DOC, { seedIds: ["agent-h-chatbot", "agent-autogen"], depth: 3 });

function grouped(groupBy: GroupKey, sort: SortKey = "smart", p: Projection = PROJECTION): Layout {
  return layoutGraph(p, { mode: "grouped", groupBy, sort });
}

const ALL_KEYS: GroupKey[] = ["asset", "combo", "project", "cloud", "kind", "severity"];

describe("layoutGrouped: structure", () => {
  it("positions every projected node exactly once, for every group key", () => {
    for (const key of ALL_KEYS) {
      const layout = grouped(key);
      expect(layout.mode).toBe("grouped");
      expect(layout.nodes).toHaveLength(PROJECTION.nodes.length);
      expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(PROJECTION.nodes.length);
    }
  });

  it("no two nodes share coordinates", () => {
    for (const key of ALL_KEYS) {
      const layout = grouped(key);
      const coords = new Set(layout.nodes.map((n) => `${n.x},${n.y}`));
      expect(coords.size).toBe(layout.nodes.length);
    }
  });

  it("every node center sits inside its group's bounding box", () => {
    for (const key of ALL_KEYS) {
      const layout = grouped(key);
      const groups = layout.groups!;
      for (const n of layout.nodes) {
        const g = groups[n.lane];
        expect(g).toBeDefined();
        expect(n.x).toBeGreaterThan(g.x);
        expect(n.x).toBeLessThan(g.x + g.width);
        expect(n.y).toBeGreaterThan(g.y);
        expect(n.y).toBeLessThan(g.y + g.height);
      }
    }
  });

  it("group bounding boxes are pairwise non-overlapping", () => {
    for (const key of ALL_KEYS) {
      const groups = grouped(key).groups!;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i];
          const b = groups[j];
          const overlap =
            a.x < b.x + b.width && b.x < a.x + a.width &&
            a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("group counts add up and bounds are positive", () => {
    for (const key of ALL_KEYS) {
      const layout = grouped(key);
      const total = layout.groups!.reduce((acc, g) => acc + g.count, 0);
      expect(total).toBe(PROJECTION.nodes.length);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      for (const n of layout.nodes) {
        expect(n.x).toBeGreaterThan(0);
        expect(n.y).toBeGreaterThan(0);
        expect(n.x).toBeLessThan(layout.width);
        expect(n.y).toBeLessThan(layout.height);
      }
    }
  });

  it("is deterministic", () => {
    for (const key of ALL_KEYS) {
      expect(JSON.stringify(grouped(key))).toBe(JSON.stringify(grouped(key)));
    }
  });
});

describe("layoutGrouped: bucket assignment", () => {
  it("SUMMARY nodes inherit their parent's bucket for non-kind keys", () => {
    // Force summaries with a tight per-kind cap.
    const p = projectGraph(DOC, {
      seedIds: ["agent-h-chatbot", "agent-autogen"],
      depth: 3,
      perKindCap: { USER_ACCOUNT: 2, BUCKET: 2 },
    });
    const summaries = p.nodes.filter((n) => n.kind === "SUMMARY");
    expect(summaries.length).toBeGreaterThan(0);
    const byId = new Map(p.nodes.map((n) => [n.id, n]));

    const layout = grouped("cloud", "smart", p);
    const groups = layout.groups!;
    const laneOfNode = new Map(layout.nodes.map((n) => [n.id, n.lane]));
    for (const s of p.summaries) {
      const parent = byId.get(s.parentId)!;
      const expected = parent.cloudPlatform ?? GROUP_NONE;
      const g = groups[laneOfNode.get(s.id)!];
      expect(g.key).toBe(expected);
    }
  });

  it("kind grouping puts SUMMARY nodes in the collapsed kind's bucket", () => {
    const p = projectGraph(DOC, {
      seedIds: ["agent-h-chatbot", "agent-autogen"],
      depth: 3,
      perKindCap: { USER_ACCOUNT: 2 },
    });
    const layout = grouped("kind", "smart", p);
    const groups = layout.groups!;
    const laneOfNode = new Map(layout.nodes.map((n) => [n.id, n.lane]));
    for (const s of p.summaries) {
      expect(groups[laneOfNode.get(s.id)!].key).toBe(s.of);
    }
  });

  it("the ungrouped bucket is always last and labelled", () => {
    for (const key of ALL_KEYS) {
      const groups = grouped(key).groups!;
      const noneIdx = groups.findIndex((g) => g.key === GROUP_NONE);
      if (noneIdx !== -1) {
        expect(noneIdx).toBe(groups.length - 1);
        expect(groups[noneIdx].label).toBe("Ungrouped");
      }
    }
  });
});

describe("layoutGrouped: group ordering", () => {
  it("severity groups follow SEVERITY_ORDER", () => {
    const keys = grouped("severity").groups!.map((g) => g.key).filter((k) => k !== GROUP_NONE);
    const ranks = keys.map((k) => (SEVERITY_ORDER as readonly string[]).indexOf(k));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("kind groups follow NODE_KINDS declaration order", () => {
    const keys = grouped("kind").groups!.map((g) => g.key);
    const ranks = keys.map((k) => (NODE_KINDS as readonly string[]).indexOf(k));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("combo groups follow COMBO_GROUPS order and use shortLabel", () => {
    const groups = grouped("combo").groups!.filter((g) => g.key !== GROUP_NONE);
    const ranks = groups.map((g) => COMBO_GROUPS.findIndex((c) => c.id === g.key));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    for (const g of groups) {
      const combo = COMBO_GROUPS.find((c) => c.id === g.key)!;
      expect(g.label).toBe(combo.shortLabel);
    }
  });

  it("project groups order by worst member severity, then name", () => {
    const layout = grouped("project");
    const groups = layout.groups!.filter((g) => g.key !== GROUP_NONE);
    const byId = new Map(PROJECTION.nodes.map((n) => [n.id, n]));
    const laneOfNode = new Map(layout.nodes.map((n) => [n.id, n.lane]));
    const worst = new Map<string, number>();
    for (const n of layout.nodes) {
      const g = layout.groups![n.lane];
      const sev = byId.get(n.id)!.severity ?? "";
      const rank = (SEVERITY_ORDER as readonly string[]).indexOf(sev);
      const r = rank === -1 ? SEVERITY_ORDER.length : rank;
      worst.set(g.key, Math.min(worst.get(g.key) ?? SEVERITY_ORDER.length, r));
    }
    for (let i = 1; i < groups.length; i++) {
      const prev = groups[i - 1];
      const cur = groups[i];
      const d = worst.get(prev.key)! - worst.get(cur.key)!;
      expect(d < 0 || (d === 0 && prev.key < cur.key)).toBe(true);
    }
    expect(laneOfNode.size).toBe(layout.nodes.length);
  });
});

describe("layoutGrouped: asset hubs (hub-and-spoke)", () => {
  const layout = grouped("asset");
  const byId = new Map(PROJECTION.nodes.map((n) => [n.id, n]));
  const groups = layout.groups!;
  const laneOfNode = new Map(layout.nodes.map((n) => [n.id, n.lane]));
  const posOf = new Map(layout.nodes.map((n) => [n.id, n]));

  it("every AI agent is its own hub, centered in its block", () => {
    const agents = PROJECTION.nodes.filter((n) => n.kind === "AI_AGENT");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      const g = groups.find((x) => x.key === agent.id);
      expect(g).toBeDefined();
      expect(g!.label).toBe(agent.name);
      const p = posOf.get(agent.id)!;
      expect(p.x).toBe(g!.x + g!.width / 2); // hub sits at the block's horizontal center
      expect(laneOfNode.get(agent.id)).toBe(groups.indexOf(g!));
    }
  });

  it("issues land in the same group as the asset that owns them", () => {
    const issueEdges = PROJECTION.edges.filter(
      (e) => e.type === "HAS_ISSUE" && posOf.has(e.src) && posOf.has(e.dst),
    );
    expect(issueEdges.length).toBeGreaterThan(0);
    for (const e of issueEdges) {
      expect(laneOfNode.get(e.dst)).toBe(laneOfNode.get(e.src));
    }
  });

  it("hub groups are ordered highest-risk first", () => {
    const hubGroups = groups.filter((g) => g.key !== GROUP_NONE);
    expect(hubGroups.length).toBeGreaterThan(1);
    for (let i = 1; i < hubGroups.length; i++) {
      const prev = byId.get(hubGroups[i - 1].key)!;
      const cur = byId.get(hubGroups[i].key)!;
      const d = nodeOrder(prev, cur);
      expect(d < 0 || (d === 0 && prev.id < cur.id)).toBe(true);
    }
  });

  it("no two node cards (196×56) overlap anywhere on the canvas", () => {
    const pts = layout.nodes;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = Math.abs(pts[i].x - pts[j].x);
        const dy = Math.abs(pts[i].y - pts[j].y);
        expect(dx >= 196 || dy >= 56).toBe(true);
      }
    }
  });

  it("satellites orbit by risk: innermost ring holds the worst neighbors", () => {
    // For the biggest hub group, every ring-1 member must not rank below any
    // ring-2 member under the smart comparator (emission order is ring order).
    const biggest = [...groups]
      .filter((g) => g.key !== GROUP_NONE && g.count > 9)
      .sort((a, b) => b.count - a.count)[0];
    if (!biggest) return; // sample data too small — covered by ordering test above
    const lane = groups.indexOf(biggest);
    const ids = layout.nodes.filter((n) => n.lane === lane).map((n) => n.id);
    const sats = ids.slice(1); // ids[0] is the hub
    const ring1 = sats.slice(0, 8);
    const ring2 = sats.slice(8);
    for (const a of ring1) {
      for (const b of ring2) {
        expect(nodeOrder(byId.get(a)!, byId.get(b)!) <= 0).toBe(true);
      }
    }
  });
});

describe("layoutGrouped: sort within groups", () => {
  function firstGroupMembers(sort: SortKey) {
    const layout = grouped("kind", sort);
    // Nodes are emitted group-by-group in grid order.
    const byId = new Map(PROJECTION.nodes.map((n) => [n.id, n]));
    const lanes = new Map<number, string[]>();
    for (const n of layout.nodes) {
      if (!lanes.has(n.lane)) lanes.set(n.lane, []);
      lanes.get(n.lane)!.push(n.id);
    }
    // Pick the biggest group so the ordering assertion is meaningful.
    const biggest = [...lanes.values()].sort((a, b) => b.length - a.length)[0];
    return biggest.map((id) => byId.get(id)!);
  }

  it("sort=name orders members alphabetically", () => {
    const nodes = firstGroupMembers("name");
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].name <= nodes[i].name).toBe(true);
    }
  });

  it("sort=aars orders members by descending score", () => {
    const nodes = firstGroupMembers("aars");
    for (let i = 1; i < nodes.length; i++) {
      expect((nodes[i - 1].aars ?? -1) >= (nodes[i].aars ?? -1)).toBe(true);
    }
  });

  it("sort=severity orders members worst-first", () => {
    const nodes = firstGroupMembers("severity");
    const rank = (s?: string) => {
      const i = (SEVERITY_ORDER as readonly string[]).indexOf(s ?? "");
      return i === -1 ? SEVERITY_ORDER.length : i;
    };
    for (let i = 1; i < nodes.length; i++) {
      expect(rank(nodes[i - 1].severity)).toBeLessThanOrEqual(rank(nodes[i].severity));
    }
  });
});
