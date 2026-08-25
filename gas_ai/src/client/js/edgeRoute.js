// Edge routing: a link that would run through a card goes around it instead.
//
// Edges used to be one cubic Bézier between two cards' face centres, with the control points at
// the midpoint and nothing consulted in between. The edge layer paints UNDER the node layer, so a
// link crossing a card vanished behind it and re-emerged, and the reader could not tell what
// connected to what — the one thing this canvas exists to show. Measured on the seeded fixtures,
// the share of edges passing through a card that is not their own endpoint, before this module
// and after it:
//
//     arrangement   69 nodes / 57 edges     42 nodes / 41 edges
//     lanes             5% ->  0%              10% ->  0%
//     rows             19% ->  0%              54% ->  0%
//     grid (default)   56% ->  0%              85% ->  0%
//     organic          39% ->  0%              83% ->  0%
//     radial           65% ->  0%              54% ->  0%
//
// Zero, grouped and ungrouped alike, and `edgeRoute.test.js` is what keeps it there. Grouping had
// made every row worse (grid by cloud 60%, radial by cloud 74%). The cause is exact and
// it is geometry, not layout: cards one lattice step apart NEVER collide, cards further apart
// almost always do — 100% of same-row and same-column pairs with a card between them, 73–92% of
// the far diagonals.
//
// REORDERING CANNOT FIX IT, which is worth stating because it is the obvious first idea. Laying
// each component out in adjacency (BFS) order rather than severity order lifts the share of edges
// that are crossing-free purely by being adjacent from 37% to 46% on one fixture and 10% to 27%
// on the other, and no further: a lattice cell has four orthogonal neighbours (eight counting
// diagonals), so any node with more edges than that MUST have non-adjacent links, and these
// graphs are hub-and-spoke agents. It would also cost the severity reading inside a rectangle.
// So the edges move, not the cards.
//
// THE PIPELINE is the standard one — a shortest path over a grid of "interesting coordinates"
// taken from the obstacle rectangles, then the spline-beautification pass (shortcut, then fit
// curves into the corners) that recovers a smooth line from the staircase:
//
//   1. every card becomes a rectangle, inflated as far as the layout leaves room for;
//   2. the grid is every inflated rectangle's edges plus every card's centre line;
//   3. A* from one card's port to the other, cost = length + a penalty per turn;
//   4. the path is straightened wherever a straight segment still clears the cards;
//   5. corners are rounded, and every rounded corner is re-checked against the cards.
//
// WHY THE GRID IS EXACT rather than a sampling: its lines sit exactly on rectangle boundaries, so
// a segment between two consecutive coordinates lies wholly inside or wholly outside each
// rectangle. Testing its midpoint is a complete blocking test. That is also why the card centres
// have to be in the grid — without them a rectangle spans a single cell, no grid line passes
// through its interior, nothing is ever blocked, and the router would happily send a link down
// the column of card centres it is supposed to avoid.
//
// TWO CLEARANCES, and they are different jobs. `ROUTE_PAD` inflates a card toward its full
// lattice cell, which puts the grid lines down the CENTRE of the gutters between cards — a route
// on them is as far from its neighbours on both sides as the layout allows. How much of it a
// given canvas can afford is `inflationFor`'s problem, and on the free-form arrangements the
// answer is "not much". `CLEAR_PAD` is the real "do not touch a card" margin, and it is the one
// the straightening and the corner-rounding are checked against. Using the routing pad for those
// would forbid every diagonal, since on a lattice the inflated cells tile the plane, and the
// result would be pure right angles rather than the curves this canvas draws.
//
// Nothing here animates and nothing is random: the same layout always yields the same path, which
// `graphLayout.ts` guarantees for positions and this file has to preserve for the links.

import { NODE_H, NODE_W } from "./graphNode.js";

/** Card half-extents, and the inflation that turns a card into its lattice cell.
 *
 *  240x84 is the grid arrangement's cell (`laneGap`/`rowGap` in the layout payload) against a
 *  196x56 card, so these are exactly half the gutter: a grid line inflated by them falls midway
 *  between two neighbouring cards. */
const HALF_W = NODE_W / 2;
const HALF_H = NODE_H / 2;
const ROUTE_PAD_X = 22;
const ROUTE_PAD_Y = 14;

/** The margin a drawn line actually has to keep off a card. Small — it is about not touching,
 *  where ROUTE_PAD is about picking a lane. */
const CLEAR_PAD = 6;

/** What a turn costs, in pixels of path length. High enough that a route with one bend beats a
 *  staircase of the same length, low enough that it will still bend to get out of the way. */
const BEND_COST = 40;

/** Corner rounding, and the floor below which a corner is simply left sharp rather than rounded
 *  into a card. */
const CORNER_R = 16;
const MIN_CORNER_R = 2.5;

/** The caps. A lattice arrangement collapses to a grid of a few hundred vertices; organic and
 *  radial place cards at arbitrary coordinates and do not, so the grid is quantised and then,
 *  past a budget, routing is abandoned in favour of the plain Bézier. Sized against the graph
 *  ceilings the domain enforces (MAX_NODES_CEILING 400, MAX_EDGES_DEFAULT 250). */
const MAX_GRID_CELLS = 90000;
const QUANTISE_STEP = 4;
const MAX_EXPANSIONS = 250000;
/** How far outside an edge's own bounding box a route may wander before the search gives up and
 *  is retried against the whole canvas. Three cards' width — enough to step around a neighbour or
 *  two, short of trekking across the picture. */
const SEARCH_MARGIN = 600;

const round2 = (n) => Math.round(n * 100) / 100;

/** The card, as an obstacle. */
function cardRect(p) {
  return { x0: p.x - HALF_W, y0: p.y - HALF_H, x1: p.x + HALF_W, y1: p.y + HALF_H };
}

function inflate(r, px, py) {
  return { x0: r.x0 - px, y0: r.y0 - py, x1: r.x1 + px, y1: r.y1 + py };
}

/**
 * Does the segment p→q cut into any rectangle, ignoring the two the edge belongs to?
 *
 * Liang–Barsky clipping: the segment meets the box when the entry parameter is still below the
 * exit parameter over both slabs. Used for straightening and for validating a rounded corner,
 * both of which need a real answer rather than a sampled one.
 */
function segmentHits(px, py, qx, qy, rects, skipA, skipB) {
  const dx = qx - px;
  const dy = qy - py;
  for (let k = 0; k < rects.length; k++) {
    const r = rects[k];
    if (r.id === skipA || r.id === skipB) continue;
    let t0 = 0;
    let t1 = 1;
    let out = false;
    for (let axis = 0; axis < 2 && !out; axis++) {
      const d = axis === 0 ? dx : dy;
      const s = axis === 0 ? px : py;
      const lo = axis === 0 ? r.x0 : r.y0;
      const hi = axis === 0 ? r.x1 : r.y1;
      if (Math.abs(d) < 1e-9) {
        if (s <= lo || s >= hi) out = true;
        continue;
      }
      let a = (lo - s) / d;
      let b = (hi - s) / d;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 >= t1) out = true;
    }
    if (!out) return true;
  }
  return false;
}

/** A cubic, sampled. Only the corner arcs need this; everything else is straight. */
function cubicHits(p0, p1, p2, p3, rects, skipA, skipB) {
  let prevX = p0[0];
  let prevY = p0[1];
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    if (segmentHits(prevX, prevY, x, y, rects, skipA, skipB)) return true;
    prevX = x;
    prevY = y;
  }
  return false;
}

/**
 * The unrouted edge — exactly the geometry this canvas has always drawn.
 *
 * Kept verbatim, and used for every edge that does not need routing, so the picture changes only
 * where it has to. Lanes flow left-to-right and anchor on the sides; where there is no such flow
 * a mostly-vertical edge anchors top/bottom instead, so it leaves through the nearest face rather
 * than looping around the card it starts from.
 */
export function directGeometry(a, b, freeForm) {
  if (freeForm && Math.abs(b.y - a.y) > Math.abs(b.x - a.x)) {
    const topToBottom = a.y <= b.y;
    const y1 = a.y + (topToBottom ? HALF_H : -HALF_H);
    const y2 = b.y + (topToBottom ? -HALF_H : HALF_H);
    const midY = (y1 + y2) / 2;
    return {
      d: `M ${a.x} ${y1} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${y2}`,
      labelX: (a.x + b.x) / 2,
      labelY: midY - 4,
      cubic: [[a.x, y1], [a.x, midY], [b.x, midY], [b.x, y2]],
      vertical: true,
      routed: false,
    };
  }
  const leftToRight = a.x <= b.x;
  const x1 = a.x + (leftToRight ? HALF_W : -HALF_W);
  const x2 = b.x + (leftToRight ? -HALF_W : HALF_W);
  const midX = (x1 + x2) / 2;
  return {
    d: `M ${x1} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${x2} ${b.y}`,
    labelX: midX,
    labelY: (a.y + b.y) / 2 - 4,
    cubic: [[x1, a.y], [midX, a.y], [midX, b.y], [x2, b.y]],
    vertical: false,
    routed: false,
  };
}

/**
 * The obstacle field and the routing grid, built once per render.
 *
 * `positions` is whatever the renderer is actually drawing — layout plus any drag offsets — so a
 * dragged card is an obstacle where it now sits, not where it was placed.
 *
 * Returns `null` when the grid would be too large to search, which is the cap: every edge then
 * falls back to `directGeometry` and the canvas behaves exactly as it did before this file.
 */
/**
 * How far a card may be inflated before the inflation itself seals the canvas.
 *
 * ROUTE_PAD assumes the grid arrangement's lattice, where the cells tile exactly and inflating to
 * them costs nothing. The free-form arrangements do not oblige: organic only guarantees that two
 * CARDS do not overlap, and it routinely stacks two of them with no gap at all, so inflating both
 * to a 240x84 cell merges them into one blob. Measured on the seeded fixtures, that sealed 32 of
 * organic's pairs and left A* with no way out of a card at all — 22 of the 28 links that needed a
 * route could not be given one, and organic barely improved.
 *
 * So the pad is the largest fraction of ROUTE_PAD that keeps every pair of inflated rectangles
 * disjoint. Two rectangles miss each other when they are clear on EITHER axis, so a pair permits
 * `max(slackX / ROUTE_PAD_X, slackY / ROUTE_PAD_Y)` and the canvas takes the smallest of those.
 * A lattice yields 1 and keeps its gutter-centre lanes; organic yields ~0 and gets lanes that
 * hug the cards, which is the most that layout leaves room for.
 */
function inflationFor(positions) {
  let f = 1;
  for (let i = 0; i < positions.length && f > 0; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const sx = (Math.abs(positions[i].x - positions[j].x) - NODE_W) / 2;
      const sy = (Math.abs(positions[i].y - positions[j].y) - NODE_H) / 2;
      if (sx >= ROUTE_PAD_X || sy >= ROUTE_PAD_Y) continue;
      const allow = Math.max(sx / ROUTE_PAD_X, sy / ROUTE_PAD_Y);
      if (allow < f) f = Math.max(0, allow);
      if (f === 0) break;
    }
  }
  return { px: ROUTE_PAD_X * f, py: ROUTE_PAD_Y * f };
}

export function buildField(positions) {
  const rects = [];
  const clear = [];
  const xs = [];
  const ys = [];
  const pad = inflationFor(positions);
  for (const p of positions) {
    const card = cardRect(p);
    const cell = inflate(card, pad.px, pad.py);
    cell.id = p.id;
    rects.push(cell);
    const near = inflate(card, CLEAR_PAD, CLEAR_PAD);
    near.id = p.id;
    clear.push(near);
    // The cell's own edges, and the card's centre lines. The centres are not decoration: without
    // them an inflated cell spans exactly one grid cell, no line crosses its interior, and the
    // blocking test below has nothing to find.
    xs.push(cell.x0, cell.x1, p.x);
    ys.push(cell.y0, cell.y1, p.y);
  }
  if (!rects.length) return null;

  const axis = (raw) => {
    const seen = new Set();
    const out = [];
    for (const v of raw) {
      const q = round2(v);
      if (!seen.has(q)) { seen.add(q); out.push(q); }
    }
    out.sort((m, n) => m - n);
    return out;
  };
  let gx = axis(xs);
  let gy = axis(ys);
  if (gx.length * gy.length > MAX_GRID_CELLS) {
    // Organic and radial put every card at its own coordinate, so the grid does not collapse the
    // way a lattice does. Snapping to a few pixels merges the near-duplicates without moving any
    // line far enough to matter at this scale.
    const snap = (v) => Math.round(v / QUANTISE_STEP) * QUANTISE_STEP;
    gx = axis(xs.map(snap));
    gy = axis(ys.map(snap));
    if (gx.length * gy.length > MAX_GRID_CELLS) return null;
  }

  const W = gx.length;
  const H = gy.length;
  const ix = new Map(gx.map((v, i) => [v, i]));
  const iy = new Map(gy.map((v, i) => [v, i]));
  const at = (map, coords, v) => {
    const hit = map.get(round2(v));
    if (hit !== undefined) return hit;
    // Only reachable after quantisation moved a boundary. Nearest line is close enough to keep
    // the blocking conservative.
    let lo = 0;
    let hi = coords.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (coords[mid] < v) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  // A segment of the grid is blocked when it runs through a rectangle's interior. Because every
  // rectangle's own edges are grid lines, "interior" is a matter of index arithmetic rather than
  // of geometry: a horizontal line strictly between the rectangle's top and bottom, spanning
  // columns it covers, is inside it; one lying on its boundary is not.
  const blockH = new Uint8Array(W * H);
  const blockV = new Uint8Array(W * H);
  for (const r of rects) {
    const x0 = at(ix, gx, r.x0);
    const x1 = at(ix, gx, r.x1);
    const y0 = at(iy, gy, r.y0);
    const y1 = at(iy, gy, r.y1);
    for (let j = y0 + 1; j < y1; j++) {
      for (let i = x0; i < x1; i++) blockH[j * W + i] = 1;
    }
    for (let i = x0 + 1; i < x1; i++) {
      for (let j = y0; j < y1; j++) blockV[j * W + i] = 1;
    }
  }

  const size = W * H * 2;
  const buf = {
    g: new Float64Array(size),
    came: new Int32Array(size),
    done: new Int32Array(size),
    stamp: new Int32Array(size),
    epoch: 0,
  };
  return { rects, clear, gx, gy, W, H, ix, iy, blockH, blockV, at, pad, buf };
}

/** Where a link leaves a card: the middle of a face, one routing pad out.
 *
 *  The pad is the field's own — the adaptive one, not the constant — so the port always lands on
 *  a grid line. Computing it from ROUTE_PAD instead would put the start vertex off the grid on
 *  every free-form canvas, and `at()` would snap it to a neighbouring line inside the card. */
function port(p, face, pad) {
  if (face === "top") return [p.x, p.y - HALF_H - pad.py];
  if (face === "bottom") return [p.x, p.y + HALF_H + pad.py];
  if (face === "left") return [p.x - HALF_W - pad.px, p.y];
  return [p.x + HALF_W + pad.px, p.y];
}

/**
 * A* over the grid, with a turn charged as extra length.
 *
 * The direction a vertex was entered from is part of the state, not a decoration: charging for a
 * bend while ignoring how you arrived would let the search under-report the cost of a path and
 * stop being optimal. Two directions, so the state space is twice the grid.
 */
function search(field, from, to, margin) {
  const { W, H, gx, gy, blockH, blockV } = field;
  const si = field.at(field.ix, gx, from[0]);
  const sj = field.at(field.iy, gy, from[1]);
  const ti = field.at(field.ix, gx, to[0]);
  const tj = field.at(field.iy, gy, to[1]);
  if (si === ti && sj === tj) return [[gx[si], gy[sj]]];

  // THE SEARCH WINDOW, and it is what makes a free-form canvas affordable. A lattice grid is a
  // few hundred vertices; organic gives every card its own coordinate, so 87 nodes came out
  // 246x260 and A* spent 667ms walking all of it for edges that end two cards away. Almost every
  // route stays near the straight line between its endpoints, so the search is confined to their
  // bounding box plus a margin, and only widened if that finds nothing.
  let i0 = 0;
  let i1 = W - 1;
  let j0 = 0;
  let j1 = H - 1;
  if (margin > 0) {
    const lox = Math.min(from[0], to[0]) - margin;
    const hix = Math.max(from[0], to[0]) + margin;
    const loy = Math.min(from[1], to[1]) - margin;
    const hiy = Math.max(from[1], to[1]) + margin;
    while (i0 < si && gx[i0] < lox) i0++;
    while (i1 > ti && gx[i1] > hix) i1--;
    if (i1 < ti) i1 = ti;
    while (j0 < sj && gy[j0] < loy) j0++;
    while (j1 > tj && gy[j1] > hiy) j1--;
    if (j1 < tj) j1 = tj;
    i0 = Math.min(i0, si, ti);
    j0 = Math.min(j0, sj, tj);
    i1 = Math.max(i1, si, ti);
    j1 = Math.max(j1, sj, tj);
  }

  // Buffers live on the field and are reused: allocating a Float64Array per edge meant a
  // megabyte of churn per link on the bigger canvases. `stamp` marks which epoch last wrote a
  // cell, so nothing has to be cleared between searches.
  const buf = field.buf;
  const epoch = ++buf.epoch;
  const g = buf.g;
  const came = buf.came;
  const done = buf.done;
  const stamp = buf.stamp;
  const heapV = [];
  const heapK = [];
  const push = (state, key) => {
    heapV.push(state);
    heapK.push(key);
    let c = heapV.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapK[p] <= heapK[c]) break;
      const tv = heapV[p]; heapV[p] = heapV[c]; heapV[c] = tv;
      const tk = heapK[p]; heapK[p] = heapK[c]; heapK[c] = tk;
      c = p;
    }
  };
  const pop = () => {
    const top = heapV[0];
    const lastV = heapV.pop();
    const lastK = heapK.pop();
    if (heapV.length) {
      heapV[0] = lastV;
      heapK[0] = lastK;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let s = p;
        if (l < heapK.length && heapK[l] < heapK[s]) s = l;
        if (r < heapK.length && heapK[r] < heapK[s]) s = r;
        if (s === p) break;
        const tv = heapV[p]; heapV[p] = heapV[s]; heapV[s] = tv;
        const tk = heapK[p]; heapK[p] = heapK[s]; heapK[s] = tk;
        p = s;
      }
    }
    return top;
  };
  const h = (i, j) => Math.abs(gx[i] - gx[ti]) + Math.abs(gy[j] - gy[tj]);

  for (const dir of [0, 1]) {
    const s = (sj * W + si) * 2 + dir;
    g[s] = 0;
    stamp[s] = epoch;
    came[s] = -1;
    done[s] = 0;
    push(s, h(si, sj));
  }
  let expansions = 0;
  let goal = -1;
  while (heapV.length) {
    const state = pop();
    if (done[state] === epoch) continue;
    done[state] = epoch;
    if (++expansions > MAX_EXPANSIONS) return null;
    const dir = state & 1;
    const cell = state >> 1;
    const i = cell % W;
    const j = (cell - i) / W;
    if (i === ti && j === tj) { goal = state; break; }
    const base = g[state];
    // Right, left, down, up. Fixed order, so two runs on the same input expand the same way.
    for (let move = 0; move < 4; move++) {
      const horiz = move < 2;
      let ni = i;
      let nj = j;
      if (move === 0) { if (i + 1 > i1 || blockH[j * W + i]) continue; ni = i + 1; }
      else if (move === 1) { if (i - 1 < i0 || blockH[j * W + i - 1]) continue; ni = i - 1; }
      else if (move === 2) { if (j + 1 > j1 || blockV[j * W + i]) continue; nj = j + 1; }
      else { if (j - 1 < j0 || blockV[(j - 1) * W + i]) continue; nj = j - 1; }
      const step = horiz ? Math.abs(gx[ni] - gx[i]) : Math.abs(gy[nj] - gy[j]);
      const ndir = horiz ? 0 : 1;
      const cost = base + step + (ndir === dir ? 0 : BEND_COST);
      const ns = (nj * W + ni) * 2 + ndir;
      if (stamp[ns] !== epoch || cost < g[ns]) {
        stamp[ns] = epoch;
        g[ns] = cost;
        came[ns] = state;
        push(ns, cost + h(ni, nj));
      }
    }
  }
  if (goal < 0) return null;

  const path = [];
  for (let s = goal; s >= 0; s = came[s]) {
    const cell = s >> 1;
    const i = cell % W;
    const j = (cell - i) / W;
    const pt = [gx[i], gy[j]];
    if (!path.length || path[0][0] !== pt[0] || path[0][1] !== pt[1]) path.unshift(pt);
    if (came[s] < 0) break;
  }
  return path;
}

/** Drop the vertices a straight line can skip. This is what turns a staircase back into a line. */
function straighten(points, clear, skipA, skipB) {
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && segmentHits(points[i][0], points[i][1], points[j][0], points[j][1], clear, skipA, skipB)) j--;
    out.push(points[j]);
    i = j;
  }
  return out;
}

/**
 * The polyline as a smooth path: a curve inscribed into each corner, shrunk until it clears.
 *
 * The re-check is the whole point. Rounding a corner moves the line INTO the inside of the turn,
 * which is exactly where the card it just went around is — so a radius chosen from the leg
 * lengths alone can put the smoothed curve back through the obstacle the route avoided. Halving
 * until it clears, and leaving the corner sharp below a floor, is what makes "smooth" and
 * "does not cross a card" hold at the same time.
 */
function smoothPath(points, clear, skipA, skipB) {
  if (points.length < 3) {
    return `M ${round2(points[0][0])} ${round2(points[0][1])} L ${round2(points[points.length - 1][0])} ${round2(points[points.length - 1][1])}`;
  }
  let d = `M ${round2(points[0][0])} ${round2(points[0][1])}`;
  for (let k = 1; k < points.length - 1; k++) {
    const prev = points[k - 1];
    const cur = points[k];
    const next = points[k + 1];
    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    let r = Math.min(CORNER_R, inLen / 2, outLen / 2);
    let entry = null;
    let exit = null;
    while (r >= MIN_CORNER_R) {
      const e = [cur[0] + (prev[0] - cur[0]) * (r / inLen), cur[1] + (prev[1] - cur[1]) * (r / inLen)];
      const x = [cur[0] + (next[0] - cur[0]) * (r / outLen), cur[1] + (next[1] - cur[1]) * (r / outLen)];
      // Control points pulled toward the corner: the standard rounded join, and its bulge stays
      // inside the triangle (entry, corner, exit), which is what the check below relies on.
      const c1 = [e[0] + (cur[0] - e[0]) * 0.55, e[1] + (cur[1] - e[1]) * 0.55];
      const c2 = [x[0] + (cur[0] - x[0]) * 0.55, x[1] + (cur[1] - x[1]) * 0.55];
      if (!cubicHits(e, c1, c2, x, clear, skipA, skipB)) { entry = { e, c1, c2, x }; break; }
      r /= 2;
    }
    if (!entry) {
      d += ` L ${round2(cur[0])} ${round2(cur[1])}`;
      continue;
    }
    exit = entry;
    d += ` L ${round2(exit.e[0])} ${round2(exit.e[1])}`;
    d += ` C ${round2(exit.c1[0])} ${round2(exit.c1[1])}, ${round2(exit.c2[0])} ${round2(exit.c2[1])}, ${round2(exit.x[0])} ${round2(exit.x[1])}`;
  }
  const end = points[points.length - 1];
  d += ` L ${round2(end[0])} ${round2(end[1])}`;
  return d;
}

/** Halfway along the polyline, by length — where a routed edge's label goes. */
function midpointOf(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (run + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - run) / seg;
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
    }
    run += seg;
  }
  return points[points.length - 1];
}

/**
 * The geometry for one link: the plain Bézier when it is already clear, a route around the cards
 * when it is not, and the plain Bézier again whenever routing cannot answer.
 *
 * Checking first is not only an optimisation. Roughly half these edges never had a problem, and
 * leaving those untouched is what keeps the canvas looking like itself.
 */
export function edgePath(a, b, field, freeForm) {
  const direct = directGeometry(a, b, freeForm);
  if (!field) return direct;
  const c = direct.cubic;
  if (!cubicHits(c[0], c[1], c[2], c[3], field.clear, a.id, b.id)) return direct;

  const from = direct.vertical
    ? port(a, a.y <= b.y ? "bottom" : "top", field.pad)
    : port(a, a.x <= b.x ? "right" : "left", field.pad);
  const to = direct.vertical
    ? port(b, a.y <= b.y ? "top" : "bottom", field.pad)
    : port(b, a.x <= b.x ? "left" : "right", field.pad);

  const raw = search(field, from, to, SEARCH_MARGIN) || search(field, from, to, 0);
  if (!raw || raw.length < 2) return direct;
  const points = straighten(raw, field.clear, a.id, b.id);
  const label = midpointOf(points);
  return {
    d: smoothPath(points, field.clear, a.id, b.id),
    labelX: label[0],
    labelY: label[1] - 4,
    cubic: null,
    vertical: direct.vertical,
    routed: true,
    points,
  };
}
