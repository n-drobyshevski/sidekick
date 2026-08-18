// Grouped (cluster) layout: bucket assignment, deterministic group ordering,
// within-group grid placement, non-overlapping hulls, and sort variants.

import { describe, expect, it } from "vitest";
import { SEVERITY_ORDER } from "../src/domain/config";
import {
  enrichGraphDoc,
  withDataFindingNodes,
  withExcessivePrivilegeNodes,
  withInternetExposureNodes,
  withMissingGuardrailNodes,
  withSensitiveDataNodes,
} from "../src/domain/graphEnrich";
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

/**
 * One grouping level in the GRID arrangement — the shape every case below this line was written
 * against. The scalar is wrapped rather than the cases rewritten: that is the guarantee a second
 * level changed nothing about what one level means.
 *
 * `mode: "grid"` is what "grouped" used to be. Grouping stopped being one of the arrangements and
 * became a dimension any of them composes with; the compact row-major interior it always drew is
 * now named `grid`, so these cases pin the same pictures they always did. The other four
 * interiors are covered by the composition suite in graphLayout.test.ts.
 */
function grouped(groupBy: GroupKey, sort: SortKey = "smart", p: Projection = PROJECTION): Layout {
  return layoutGraph(p, { mode: "grid", groupBy: [groupBy], sort });
}

/**
 * One grouping level in the RADIAL arrangement — hub at the centre of each box, satellites on
 * concentric rings. This is the interior `groupBy=asset` used to be hard-wired to, back when
 * grouping was an arrangement and chose the interior itself; it is now one of five a reader picks,
 * and the pairing is what an `asset` grouping still means.
 */
function hubbed(groupBy: GroupKey, sort: SortKey = "smart", p: Projection = PROJECTION): Layout {
  return layoutGraph(p, { mode: "radial", groupBy: [groupBy], sort });
}

/** Two levels, the outer one first. */
function nested(outer: GroupKey, inner: GroupKey, p: Projection = PROJECTION): Layout {
  return layoutGraph(p, { mode: "grid", groupBy: [outer, inner], sort: "smart" });
}

const ALL_KEYS: GroupKey[] = ["asset", "combo", "project", "cloud", "kind", "severity"];

/** The outer boxes. With one level that is all of them. */
const tops = (l: Layout) => l.groups!.filter((g) => g.depth === 0);

describe("layoutGrouped: structure", () => {
  it("positions every projected node exactly once, for every group key", () => {
    for (const key of ALL_KEYS) {
      const layout = grouped(key);
      // The ARRANGEMENT, not "grouped" — grouping is orthogonal now and `groups` is what says a
      // picture is grouped. `grid` is the interior these cases were all written against.
      expect(layout.mode).toBe("grid");
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

  // Siblings, not all pairs. A sub-group overlaps its parent by construction — that IS
  // the nesting — so the invariant is per depth, and containment is asserted separately.
  it("group bounding boxes are pairwise non-overlapping within a level", () => {
    for (const key of ALL_KEYS) {
      const groups = grouped(key).groups!;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i];
          const b = groups[j];
          if (a.depth !== b.depth) continue;
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
      // Outer boxes only: a nested layout counts each node twice over, once in its
      // sub-group and once in the parent that holds it.
      const total = tops(layout).reduce((acc, g) => acc + g.count, 0);
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

describe("layoutGrouped: two levels", () => {
  const PAIRS: Array<[GroupKey, GroupKey]> = [
    ["cloud", "kind"], ["severity", "cloud"], ["project", "severity"], ["combo", "kind"],
  ];

  it("still places every node exactly once, in one leaf", () => {
    for (const [a, b] of PAIRS) {
      const layout = nested(a, b);
      expect(layout.nodes).toHaveLength(PROJECTION.nodes.length);
      expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(PROJECTION.nodes.length);
      expect(new Set(layout.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(layout.nodes.length);
      // The partition stays hard: the outer boxes alone account for every node, and so
      // do the leaves. Nesting subdivides a bucket, it does not duplicate into two.
      const outer = tops(layout).reduce((acc, g) => acc + g.count, 0);
      const leaves = layout.groups!.filter((g) => g.depth === 1)
        .reduce((acc, g) => acc + g.count, 0);
      expect(outer).toBe(PROJECTION.nodes.length);
      expect(leaves).toBe(PROJECTION.nodes.length);
    }
  });

  it("labels each box with the dimension it actually partitions", () => {
    for (const [a, b] of PAIRS) {
      const groups = nested(a, b).groups!;
      expect(groups.some((g) => g.depth === 1)).toBe(true);
      for (const g of groups) expect(g.by).toBe(g.depth === 0 ? a : b);
    }
  });

  it("sits every sub-group wholly inside its parent, and points back at it", () => {
    for (const [a, b] of PAIRS) {
      const groups = nested(a, b).groups!;
      groups.forEach((g, i) => {
        if (g.depth !== 1) return;
        expect(g.parent).toBeDefined();
        // Backwards, so a client can paint the array in order and get the layering.
        expect(g.parent!).toBeLessThan(i);
        const p = groups[g.parent!];
        expect(p.depth).toBe(0);
        expect(g.x).toBeGreaterThanOrEqual(p.x);
        expect(g.y).toBeGreaterThanOrEqual(p.y);
        expect(g.x + g.width).toBeLessThanOrEqual(p.x + p.width);
        expect(g.y + g.height).toBeLessThanOrEqual(p.y + p.height);
      });
    }
  });

  it("points `lane` at the leaf, not the outer box", () => {
    for (const [a, b] of PAIRS) {
      const layout = nested(a, b);
      const groups = layout.groups!;
      for (const n of layout.nodes) {
        const g = groups[n.lane];
        expect(g.depth).toBe(1);
        expect(n.x).toBeGreaterThan(g.x);
        expect(n.x).toBeLessThan(g.x + g.width);
        expect(n.y).toBeGreaterThan(g.y);
        expect(n.y).toBeLessThan(g.y + g.height);
      }
    }
  });

  it("gives every group a unique id naming both levels", () => {
    const groups = nested("cloud", "kind").groups!;
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
    const sub = groups.find((g) => g.depth === 1)!;
    expect(sub.id).toMatch(/^cloud:[^/]*\/kind:/);
  });

  it("ignores a second level under `asset`, which is an arrangement and not a partition", () => {
    const one = layoutGraph(PROJECTION, { mode: "grid", groupBy: ["asset"], sort: "smart" });
    const two = layoutGraph(PROJECTION, {
      mode: "grid", groupBy: ["asset", "cloud"], sort: "smart",
    });
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it("treats a repeated dimension as the one grouping it is", () => {
    expect(JSON.stringify(nested("cloud", "cloud"))).toBe(JSON.stringify(grouped("cloud")));
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
      // Among the outer boxes — "last" is a statement about the group order, and a
      // nested layout interleaves each parent's children right behind it.
      const groups = tops(grouped(key));
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
    const keys = tops(grouped("severity")).map((g) => g.key).filter((k) => k !== GROUP_NONE);
    const ranks = keys.map((k) => (SEVERITY_ORDER as readonly string[]).indexOf(k));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("kind groups follow NODE_KINDS declaration order", () => {
    const keys = tops(grouped("kind")).map((g) => g.key);
    const ranks = keys.map((k) => (NODE_KINDS as readonly string[]).indexOf(k));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("combo groups follow COMBO_GROUPS order and use shortLabel", () => {
    const groups = tops(grouped("combo")).filter((g) => g.key !== GROUP_NONE);
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
    const groups = tops(layout).filter((g) => g.key !== GROUP_NONE);
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
  const layout = hubbed("asset");
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

// ---------------------------------------------------------------------------
// Risk evidence follows its asset into the asset's bucket. Without this, the
// derived nodes (which carry no combo, project, or cloud of their own) all fell
// into the "Ungrouped" block at the far end of the canvas — so switching the
// arrangement to "grouped: toxic combo" tore the attack path apart.

const RISK_DOC = withMissingGuardrailNodes(
  withExcessivePrivilegeNodes(withInternetExposureNodes(withSensitiveDataNodes(DOC))),
);
const RISK_PROJECTION = projectGraph(RISK_DOC, { seedIds: ["agent-h-chatbot"], depth: 2 });

describe("layoutGrouped: risk evidence", () => {
  /**
   * The group block a node was placed inside — the OUTER one.
   *
   * Found by containment, and with nesting a node sits inside two boxes, so the depth
   * has to be named: a bare `find` would return whichever came first in the array and
   * be quietly right for one level and quietly wrong for two.
   */
  function blockOf(layout: Layout, id: string) {
    const node = layout.nodes.find((n) => n.id === id);
    if (!node) return undefined;
    return (layout.groups ?? []).find(
      (g) =>
        g.depth === 0 &&
        node.x >= g.x && node.x <= g.x + g.width && node.y >= g.y && node.y <= g.y + g.height,
    );
  }

  // No `sensitive|agent-h-chatbot`: that agent runs as sa-agent-h-chatbot, which reaches
  // db-customer-core, so its data exposure is drawn as the real chain and the stub is
  // suppressed. The stub's own behaviour is covered directly in graphEnrich.test.ts; what
  // this file tests is that a derived node inherits its asset's block, and the two
  // remaining kinds prove that as well as three did.
  const evidence = [
    "excessive|agent-h-chatbot",
    "noguardrail|agent-h-chatbot",
  ];

  it("keeps the derived nodes in their asset's block, not Ungrouped", () => {
    for (const key of ["combo", "project", "cloud"] as GroupKey[]) {
      const layout = grouped(key, "smart", RISK_PROJECTION);
      const host = blockOf(layout, "agent-h-chatbot");
      expect(host, `no host block for ${key}`).toBeDefined();
      expect(host!.key).not.toBe(GROUP_NONE);
      for (const id of evidence) {
        expect(blockOf(layout, id)?.key, `${id} under ${key}`).toBe(host!.key);
      }
    }
  });

  it("still groups the derived nodes by their own kind under 'kind'", () => {
    const layout = grouped("kind", "smart", RISK_PROJECTION);
    expect(blockOf(layout, "excessive|agent-h-chatbot")?.key).toBe("EXCESSIVE_PRIVILEGE");
    expect(blockOf(layout, "noguardrail|agent-h-chatbot")?.key).toBe("MISSING_GUARDRAIL");
  });

  it("files a data-finding aggregate under its own kind, and in its STORE's block", () => {
    // The aggregate's parent is the datastore, not the agent — so under an inventory
    // grouping it inherits the store's bucket, and under 'kind' it stands on its own.
    // Its own fixture rather than the seed landscape: what is asserted is the grouping rule,
    // and pinning it to whichever seed bucket happens to carry findings would make this
    // test fail for reasons that have nothing to do with layout.
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
    const projection = projectGraph(doc, { seedIds: ["sa"], depth: 2 });
    expect(projection.nodes.some((n) => n.id === "datafinding|store")).toBe(true);

    expect(blockOf(grouped("kind", "smart", projection), "datafinding|store")?.key)
      .toBe("DATA_FINDING");
    const byCloud = grouped("cloud", "smart", projection);
    expect(blockOf(byCloud, "datafinding|store")?.key).toBe(blockOf(byCloud, "store")?.key);
  });

  it("an ISSUE keeps its OWN combo group rather than inheriting its asset's first", () => {
    const layout = grouped("combo", "smart", RISK_PROJECTION);
    const issues = RISK_PROJECTION.nodes.filter((n) => n.kind === "ISSUE" && n.comboGroups?.length);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(blockOf(layout, issue.id)?.key).toBe(issue.comboGroups![0]);
    }
  });
});
