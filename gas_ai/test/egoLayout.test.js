// The ego-graph mini-diagram as pure data — same split as recordSections.test.js: the
// logic is tested here, the pixels are checked in the dev harness.

import { describe, it, expect } from "vitest";
import {
  EGO, egoLayout, expansionStatus, mergeLiveRels, pickEgoNeighbours, shouldAutoExpand,
} from "../src/client/js/egoLayout.js";

function rel(overrides) {
  var base = {
    edge: { id: "e1", src: "focal", dst: "n1", type: "USES" },
    node: { id: "n1", name: "n1", kind: "SERVERLESS" },
    direction: "out",
  };
  var r = Object.assign({}, base, overrides);
  if (overrides && overrides.edge) r.edge = Object.assign({}, base.edge, overrides.edge);
  if (overrides && overrides.node) r.node = Object.assign({}, base.node, overrides.node);
  return r;
}

// Extracts every number in an SVG path "d" string, in order — [x1,y1,cx1,cy1,cx2,cy2,x2,y2]
// for the M/C form curve() emits. Used to assert on the drawn start and end points without
// depending on the exact "M "/" C "/", " punctuation.
function pathPoints(d) {
  var nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  return {
    first: [nums[0], nums[1]],
    last: [nums[nums.length - 2], nums[nums.length - 1]],
  };
}

// ---------------------------------------------------------------------- pickEgoNeighbours

describe("pickEgoNeighbours", () => {
  it("puts the four risk kinds first, in their declared order", () => {
    const input = [
      rel({ node: { id: "a", name: "a", kind: "EXCESSIVE_PRIVILEGE" } }),
      rel({ node: { id: "b", name: "b", kind: "SENSITIVE_DATA" } }),
      rel({ node: { id: "c", name: "c", kind: "MISSING_GUARDRAIL" } }),
      rel({ node: { id: "d", name: "d", kind: "INTERNET_EXPOSURE" } }),
      rel({ node: { id: "e", name: "e", kind: "VIRTUAL_MACHINE" } }),
    ];
    const { shown } = pickEgoNeighbours(input, 10);
    expect(shown.map((r) => r.node.id)).toEqual(["c", "d", "b", "a", "e"]);
  });

  it("breaks a tie between two neighbours of the same risk kind by name", () => {
    const input = [
      rel({ node: { id: "z", name: "zeta", kind: "MISSING_GUARDRAIL" } }),
      rel({ node: { id: "a", name: "alpha", kind: "MISSING_GUARDRAIL" } }),
    ];
    const { shown } = pickEgoNeighbours(input, 10);
    expect(shown.map((r) => r.node.id)).toEqual(["a", "z"]);
  });

  it("ranks RUNS_AS after the risk kinds and before everything else", () => {
    const input = [
      rel({ node: { id: "svc", name: "svc", kind: "SERVICE_ACCOUNT" }, edge: { type: "RUNS_AS" } }),
      rel({ node: { id: "vm", name: "vm", kind: "VIRTUAL_MACHINE", severity: "CRITICAL" } }),
      rel({ node: { id: "risk", name: "risk", kind: "SENSITIVE_DATA" } }),
    ];
    const { shown } = pickEgoNeighbours(input, 10);
    expect(shown.map((r) => r.node.id)).toEqual(["risk", "svc", "vm"]);
  });

  it("sorts the remainder by severity first, ahead of either count", () => {
    // Severity leads for the same reason it leads the register's tie-break: a quiet
    // CRITICAL still outranks a noisy LOW. `few-but-worse` carries one issue against
    // `many-but-milder`'s four and still comes first.
    const input = [
      rel({ node: { id: "many-but-milder", name: "a", kind: "VIRTUAL_MACHINE", severity: "LOW", openIssues: 4 } }),
      rel({ node: { id: "few-but-worse", name: "c", kind: "VIRTUAL_MACHINE", severity: "HIGH", openIssues: 1 } }),
      rel({ node: { id: "same-sev-quieter", name: "b", kind: "VIRTUAL_MACHINE", severity: "HIGH" } }),
    ];
    const { shown } = pickEgoNeighbours(input, 10);
    expect(shown.map((r) => r.node.id)).toEqual([
      "few-but-worse", "same-sev-quieter", "many-but-milder",
    ]);
  });

  it("orders equal severities by open issues, then findings, then name", () => {
    // An absent count reads as 0 and sorts last, which is the same shape the old AARS leg
    // had — but 0 is now a real answer ("counted, and there are none") rather than "this
    // asset is outside the scoring model's coverage".
    const input = [
      rel({ node: { id: "quiet", name: "a", kind: "VIRTUAL_MACHINE", severity: "MEDIUM" } }),
      rel({ node: { id: "busy", name: "z", kind: "VIRTUAL_MACHINE", severity: "MEDIUM", openIssues: 3 } }),
      rel({ node: { id: "findings-only", name: "b", kind: "VIRTUAL_MACHINE", severity: "MEDIUM", openFindings: 2 } }),
    ];
    const { shown } = pickEgoNeighbours(input, 10);
    expect(shown.map((r) => r.node.id)).toEqual(["busy", "findings-only", "quiet"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      rel({ node: { id: "b", name: "b", kind: "VIRTUAL_MACHINE" } }),
      rel({ node: { id: "a", name: "a", kind: "VIRTUAL_MACHINE" } }),
    ];
    const snapshot = input.slice();
    pickEgoNeighbours(input, 10);
    expect(input).toEqual(snapshot);
    expect(input[0].node.id).toBe("b");
    expect(input[1].node.id).toBe("a");
  });

  it("shows everything under the cap, with hiddenCount 0", () => {
    const input = [rel({ node: { id: "a", name: "a" } }), rel({ node: { id: "b", name: "b" } })];
    const { shown, hiddenCount } = pickEgoNeighbours(input, 5);
    expect(shown.length).toBe(2);
    expect(hiddenCount).toBe(0);
  });

  it("shows everything exactly at the cap, with hiddenCount 0", () => {
    const input = [rel({ node: { id: "a", name: "a" } }), rel({ node: { id: "b", name: "b" } })];
    const { shown, hiddenCount } = pickEgoNeighbours(input, 2);
    expect(shown.length).toBe(2);
    expect(hiddenCount).toBe(0);
  });

  it("shows cap - 1 and accounts for the rest in hiddenCount when over the cap", () => {
    const input = [];
    for (let i = 0; i < 10; i++) input.push(rel({ node: { id: "n" + i, name: "n" + i } }));
    const { shown, hiddenCount } = pickEgoNeighbours(input, 5);
    expect(shown.length).toBe(4); // cap - 1
    expect(hiddenCount).toBe(6); // 10 - 4
    expect(shown.length + hiddenCount).toBe(10);
  });

  it("tolerates an empty array", () => {
    expect(pickEgoNeighbours([], 5)).toEqual({ shown: [], hiddenCount: 0 });
  });

  it("tolerates null and undefined rels", () => {
    expect(pickEgoNeighbours(null, 5)).toEqual({ shown: [], hiddenCount: 0 });
    expect(pickEgoNeighbours(undefined, 5)).toEqual({ shown: [], hiddenCount: 0 });
  });

  it("tolerates a cap of 0, hiding everything without throwing", () => {
    const input = [rel({ node: { id: "a", name: "a" } }), rel({ node: { id: "b", name: "b" } })];
    const { shown, hiddenCount } = pickEgoNeighbours(input, 0);
    expect(shown).toEqual([]);
    expect(hiddenCount).toBe(2);
  });

  it("tolerates a negative cap the same way as 0", () => {
    const input = [rel({ node: { id: "a", name: "a" } }), rel({ node: { id: "b", name: "b" } })];
    const { shown, hiddenCount } = pickEgoNeighbours(input, -3);
    expect(shown).toEqual([]);
    expect(hiddenCount).toBe(2);
  });

  it("tolerates a cap of 0 on an empty list", () => {
    expect(pickEgoNeighbours([], 0)).toEqual({ shown: [], hiddenCount: 0 });
  });
});

// ------------------------------------------------------------------------------ egoLayout

describe("egoLayout", () => {
  it("lays out at minWidth, and reports that as the width, when the container is narrower", () => {
    const layout = egoLayout([], 0, 100);
    expect(layout.width).toBe(EGO.minWidth);
  });

  it("right-aligns the neighbour column at width - pad - nodeW when wider than minWidth", () => {
    const wide = EGO.minWidth + 400;
    const layout = egoLayout([rel()], 0, wide);
    expect(layout.width).toBe(wide);
    expect(layout.nodes[0].x).toBe(wide - EGO.pad - EGO.nodeW);
  });

  it("places the neighbour column at the same x whether the width sits exactly at minWidth or below it", () => {
    const atFloor = egoLayout([rel()], 0, EGO.minWidth);
    const belowFloor = egoLayout([rel()], 0, EGO.minWidth - 200);
    expect(atFloor.nodes[0].x).toBe(belowFloor.nodes[0].x);
    expect(atFloor.width).toBe(belowFloor.width);
  });

  it("grows height by exactly one nodeH + rowGap per additional row", () => {
    const h1 = egoLayout([rel()], 0, EGO.minWidth).height;
    const h2 = egoLayout([rel(), rel()], 0, EGO.minWidth).height;
    const h3 = egoLayout([rel(), rel(), rel()], 0, EGO.minWidth).height;
    expect(h2 - h1).toBe(EGO.nodeH + EGO.rowGap);
    expect(h3 - h2).toBe(EGO.nodeH + EGO.rowGap);
  });

  it("matches the height formula exactly, including the summary stub as a row", () => {
    const shown = [rel(), rel(), rel()];
    const layout = egoLayout(shown, 4, EGO.minWidth);
    const rows = shown.length + 1; // +1 for the "+N more" stub
    const expected = rows * EGO.nodeH + (rows - 1) * EGO.rowGap + EGO.pad * 2;
    expect(layout.height).toBe(expected);
  });

  it("still returns a sane, floored box with zero neighbours and nothing hidden", () => {
    const layout = egoLayout([], 0, EGO.minWidth);
    const expectedHeight = 1 * EGO.nodeH + 0 * EGO.rowGap + EGO.pad * 2; // rows floored to 1
    expect(layout.height).toBe(expectedHeight);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.focal.w).toBe(EGO.nodeW);
    expect(layout.focal.h).toBe(EGO.nodeH);
  });

  it("vertically centres the focal box against the whole column", () => {
    const layout = egoLayout([rel(), rel(), rel()], 2, EGO.minWidth);
    expect(layout.focal.y + layout.focal.h / 2).toBe(layout.height / 2);
  });

  it("lands edge endpoints exactly on the facing faces of the focal and neighbour boxes", () => {
    const layout = egoLayout([rel({ direction: "out" })], 0, EGO.minWidth + 100);
    const { focal, nodes, edges } = layout;
    const focalFace = [focal.x + focal.w, focal.y + focal.h / 2];
    const nodeFace = [nodes[0].x, nodes[0].y + nodes[0].h / 2];
    const pts = pathPoints(edges[0].d);
    expect(pts.first).toEqual(focalFace);
    expect(pts.last).toEqual(nodeFace);
  });

  it("draws direction 'in' from the neighbour to the focal, and sets toFocal", () => {
    const layout = egoLayout([rel({ direction: "in" })], 0, EGO.minWidth);
    const { focal, nodes, edges } = layout;
    const focalFace = [focal.x + focal.w, focal.y + focal.h / 2];
    const nodeFace = [nodes[0].x, nodes[0].y + nodes[0].h / 2];
    const pts = pathPoints(edges[0].d);
    expect(pts.first).toEqual(nodeFace); // starts at the neighbour
    expect(pts.last).toEqual(focalFace); // ends at the focal
    expect(edges[0].toFocal).toBe(true);
  });

  it("draws direction 'out' from the focal to the neighbour, and clears toFocal", () => {
    const layout = egoLayout([rel({ direction: "out" })], 0, EGO.minWidth);
    const { focal, nodes, edges } = layout;
    const focalFace = [focal.x + focal.w, focal.y + focal.h / 2];
    const nodeFace = [nodes[0].x, nodes[0].y + nodes[0].h / 2];
    const pts = pathPoints(edges[0].d);
    expect(pts.first).toEqual(focalFace); // starts at the focal
    expect(pts.last).toEqual(nodeFace); // ends at the neighbour
    expect(edges[0].toFocal).toBe(false);
  });

  it("carries edge type, negated and accessType through from the relationship", () => {
    const layout = egoLayout(
      [rel({ edge: { type: "ALLOWS_ACCESS_TO", accessType: "ADMIN" }, direction: "out" })],
      0,
      EGO.minWidth,
    );
    expect(layout.edges[0].type).toBe("ALLOWS_ACCESS_TO");
    expect(layout.edges[0].accessType).toBe("ADMIN");
    expect(layout.edges[0].negated).toBe(false);
  });

  it("carries a negated PROTECTED_BY edge through as negated: true", () => {
    const layout = egoLayout(
      [rel({ edge: { type: "PROTECTED_BY", negated: true }, direction: "out" })],
      0,
      EGO.minWidth,
    );
    expect(layout.edges[0].negated).toBe(true);
  });

  it("puts the summary stub last, carrying the hidden count and a null type", () => {
    const shown = [rel({ node: { id: "a" } }), rel({ node: { id: "b" } })];
    const layout = egoLayout(shown, 7, EGO.minWidth);
    expect(layout.nodes.length).toBe(3);
    const stub = layout.nodes[2];
    expect(stub.summary).toBe(true);
    expect(stub.count).toBe(7);
    expect(stub.rel).toBe(null);
    expect(layout.edges[2].type).toBe(null);
  });

  it("omits the summary stub entirely when hiddenCount is 0", () => {
    const shown = [rel(), rel()];
    const layout = egoLayout(shown, 0, EGO.minWidth);
    expect(layout.nodes.length).toBe(2);
    expect(layout.nodes.every((n) => n.summary === false)).toBe(true);
  });

  it("rounds every coordinate to at most 2 decimals", () => {
    // An odd width forces fractional midpoints through the /2 divisions in the layout.
    const layout = egoLayout([rel(), rel(), rel()], 1, 777);
    const decimals = (n) => {
      const s = String(n);
      const i = s.indexOf(".");
      return i === -1 ? 0 : s.length - i - 1;
    };
    expect(decimals(layout.focal.y)).toBeLessThanOrEqual(2);
    for (const node of layout.nodes) {
      expect(decimals(node.x)).toBeLessThanOrEqual(2);
      expect(decimals(node.y)).toBeLessThanOrEqual(2);
    }
    for (const edge of layout.edges) {
      expect(decimals(edge.labelX)).toBeLessThanOrEqual(2);
      expect(decimals(edge.labelY)).toBeLessThanOrEqual(2);
      const nums = edge.d.match(/-?\d+(\.\d+)?/g).map(Number);
      for (const n of nums) expect(decimals(n)).toBeLessThanOrEqual(2);
    }
  });

  it("places the edge label past halfway along the run, lifted above the line", () => {
    const layout = egoLayout([rel({ direction: "out" })], 0, EGO.minWidth);
    const { focal, nodes, edges } = layout;
    const x1 = focal.x + focal.w;
    const x2 = nodes[0].x;
    // Past the midpoint (that is the whole point of EGO.labelAt) but still clear of the
    // neighbour column it would otherwise sit on top of.
    expect(edges[0].labelX).toBeGreaterThan((x1 + x2) / 2);
    expect(edges[0].labelX).toBeLessThan(x2 - 10);
  });

  it("evaluates the label point on the curve, not on the chord between its ends", () => {
    // One row above the focal, so the curve and its chord genuinely diverge.
    const layout = egoLayout([rel({ direction: "out" }), rel({ direction: "out" })], 0, EGO.minWidth);
    const { focal, nodes, edges } = layout;
    const y1 = focal.y + focal.h / 2;
    const y2 = nodes[0].y + nodes[0].h / 2;
    const t = EGO.labelAt;
    const u = 1 - t;
    // The control points share their own endpoint's y, so the exact cubic collapses to
    // this weighting of the two ends.
    const onCurve = (u * u * u + 3 * u * u * t) * y1 + (3 * u * t * t + t * t * t) * y2;
    expect(edges[0].labelY).toBe(Math.round((onCurve - EGO.labelLift) * 100) / 100);
    // The chord at the same t would be somewhere else entirely.
    expect(edges[0].labelY).not.toBe(Math.round((y1 + (y2 - y1) * t - EGO.labelLift) * 100) / 100);
  });
});

describe("mergeLiveRels", () => {
  var focal = { id: "agent", name: "agent", kind: "AI_AGENT" };
  var stored = [{
    edge: { id: "e0", src: "agent", dst: "sa", type: "RUNS_AS" },
    node: { id: "sa", name: "sa", kind: "SERVICE_ACCOUNT" },
    direction: "out",
  }];

  function live(nodes, edges) {
    return { source: "live", nodes: nodes, edges: edges };
  }

  it("leaves the stored list alone when there is nothing live", () => {
    expect(mergeLiveRels(focal, stored, null)).toBe(stored);
    expect(mergeLiveRels(focal, stored, live([], []))).toBe(stored);
  });

  it("adds one-hop neighbours the last sync did not have", () => {
    var out = mergeLiveRels(focal, stored, live(
      [{ id: "mcp", name: "mcp-1", kind: "MCP_SERVER" }],
      [{ id: "e1", src: "agent", dst: "mcp", type: "USES" }],
    ));
    expect(out).toHaveLength(2);
    expect(out[1].node.id).toBe("mcp");
    expect(out[1].direction).toBe("out");
  });

  it("reads direction off the edge, not off the traversal", () => {
    // RUNS is a reverse edge: the compute runs the agent, so it is INBOUND here.
    var out = mergeLiveRels(focal, [], live(
      [{ id: "vm", name: "vm-1", kind: "VIRTUAL_MACHINE" }],
      [{ id: "e1", src: "vm", dst: "agent", type: "RUNS" }],
    ));
    expect(out[0].direction).toBe("in");
    expect(out[0].node.id).toBe("vm");
  });

  it("does not re-add a relationship the sync already knew about", () => {
    var out = mergeLiveRels(focal, stored, live(
      [{ id: "sa", name: "sa", kind: "SERVICE_ACCOUNT" }],
      [{ id: "e1", src: "agent", dst: "sa", type: "RUNS_AS" }],
    ));
    expect(out).toHaveLength(1);
  });

  it("keeps the same neighbour under a DIFFERENT edge type", () => {
    // Wiz's vocabulary and the model's are not the same set; ACTING_AS is a real second
    // fact about this pair, not a duplicate of RUNS_AS.
    var out = mergeLiveRels(focal, stored, live(
      [{ id: "sa", name: "sa", kind: "SERVICE_ACCOUNT" }],
      [{ id: "e1", src: "agent", dst: "sa", type: "ACTING_AS" }],
    ));
    expect(out).toHaveLength(2);
    expect(out[1].edge.type).toBe("ACTING_AS");
  });

  it("drops edges that do not touch the focal node", () => {
    // The expansion is multi-hop; a service account's data resource is real but is not a
    // neighbour of the agent, and drawing it as one would misstate the topology.
    var out = mergeLiveRels(focal, [], live(
      [
        { id: "sa", name: "sa", kind: "SERVICE_ACCOUNT" },
        { id: "bucket", name: "b", kind: "BUCKET" },
      ],
      [
        { id: "e1", src: "agent", dst: "sa", type: "ACTING_AS" },
        { id: "e2", src: "sa", dst: "bucket", type: "ALLOWS_ACCESS_TO" },
      ],
    ));
    expect(out).toHaveLength(1);
    expect(out[0].node.id).toBe("sa");
  });

  it("ignores an edge whose node the payload did not carry, and self-edges", () => {
    var out = mergeLiveRels(focal, [], live(
      [{ id: "agent", name: "agent", kind: "AI_AGENT" }],
      [
        { id: "e1", src: "agent", dst: "ghost", type: "USES" },
        { id: "e2", src: "agent", dst: "agent", type: "INVOKES" },
      ],
    ));
    expect(out).toHaveLength(0);
  });
});

describe("shouldAutoExpand", () => {
  var agent = { id: "a", kind: "AI_AGENT" };
  function boot(over) {
    return Object.assign({ hasCredentials: true, settings: {} }, over || {});
  }

  it("expands an agent when credentials exist and the flag is not off", () => {
    expect(shouldAutoExpand(agent, boot())).toBe(true);
    expect(shouldAutoExpand(agent, boot({ settings: { autoExpand: true } }))).toBe(true);
  });

  it("defaults to ON when bootstrap has not landed yet", () => {
    // bootstrapCached() legitimately returns null before the first bootstrap resolves, and
    // settings may be absent from an older payload. The client default has to match the
    // server's, or the two disagree for the length of the boot.
    expect(shouldAutoExpand(agent, boot({ settings: undefined }))).toBe(true);
    expect(shouldAutoExpand(agent, boot({ settings: { autoExpand: undefined } }))).toBe(true);
  });

  it("does not expand when the operator turned it off", () => {
    expect(shouldAutoExpand(agent, boot({ settings: { autoExpand: false } }))).toBe(false);
  });

  it("does not expand without credentials", () => {
    // The endpoint would answer "stored" locally, so firing is a pointless round trip on
    // every sheet open in a dry-run checkout.
    expect(shouldAutoExpand(agent, boot({ hasCredentials: false }))).toBe(false);
    expect(shouldAutoExpand(agent, null)).toBe(false);
  });

  it("does not expand a non-agent, whatever the flag says", () => {
    // AGENT_EXPANSION is rooted at type AI_AGENT: pinning _vertexID to anything else asks
    // a question that cannot match, so it would spend a call to learn nothing.
    for (var kind of ["SERVICE_ACCOUNT", "BUCKET", "AI_MODEL", "MCP_SERVER", "SUMMARY"]) {
      expect(shouldAutoExpand({ id: "x", kind: kind }, boot())).toBe(false);
    }
    expect(shouldAutoExpand(null, boot())).toBe(false);
    expect(shouldAutoExpand({ id: "x" }, boot())).toBe(false);
  });
});

describe("expansionStatus", () => {
  function liveResult(over) {
    return Object.assign({
      source: "live", fetchedAt: "2026-08-14T09:00:00Z",
      nodes: [{ id: "a" }, { id: "b" }], edges: [],
      arityMismatches: 0, truncated: false,
    }, over || {});
  }

  it("an expansion in flight outranks everything else", () => {
    // The bug this exists to prevent: the card paints stored neighbours at once and the
    // live result lands a moment later, and in that gap it read "Neighborhood from the
    // last sync" — a finished-sounding sentence about a job still running.
    expect(expansionStatus(null, 0, true).state).toBe("expanding");
    expect(expansionStatus(liveResult(), 2, true).state).toBe("expanding");
    expect(expansionStatus({ source: "error", error: "boom" }, 0, true).state).toBe("expanding");
  });

  it("says nothing has happened yet before an expansion is asked for", () => {
    expect(expansionStatus(null, 0, false).state).toBe("stored-only");
  });

  it("distinguishes the three ways a live read can decline to say anything", () => {
    expect(expansionStatus({ source: "error", error: "boom" }, 0, false))
      .toEqual({ state: "error", error: "boom" });
    expect(expansionStatus({ source: "stored" }, 0, false).state).toBe("no-credentials");
    expect(expansionStatus({ source: "unsupported" }, 0, false).state).toBe("unsupported");
  });

  it("carries the counts and the two warnings on a real result", () => {
    const s = expansionStatus(liveResult({ truncated: true, arityMismatches: 3 }), 2, false);
    expect(s.state).toBe("live");
    expect(s.added).toBe(2);
    expect(s.total).toBe(2);
    expect(s.truncated).toBe(true);
    expect(s.arityMismatches).toBe(3);
    expect(s.fetchedAt).toBe("2026-08-14T09:00:00Z");
  });

  it("never reports a negative added count", () => {
    // merged.length - rels.length is the caller's arithmetic; a dedupe that removed more
    // than it added must not surface as "-1 connections not in the last sync".
    expect(expansionStatus(liveResult(), -2, false).added).toBe(0);
    expect(expansionStatus(liveResult(), undefined, false).added).toBe(0);
  });

  it("tolerates a result with no nodes array", () => {
    expect(expansionStatus({ source: "live" }, 0, false).total).toBe(0);
  });
});
