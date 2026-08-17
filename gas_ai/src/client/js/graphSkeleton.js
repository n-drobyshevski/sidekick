// The ghost graph: what the canvas shows before the first answer lands, and — as the same
// module's status region — what the top-edge bar and pill say on every refetch after that.
// Split into a pure half and a DOM half so the geometry that makes the ghost look like THIS
// product's graph (not a generic grey rectangle) can be unit-tested without a browser.
//
// The five arrangements below are wireframe APPROXIMATIONS of graphLayout.ts's real engines,
// not ports of them — the client bundle cannot import the domain layer (the reason every
// client-side layout copy in this codebase, egoLayout.js included, keeps its own numbers), and
// a ghost only has to predict the SHAPE of what is coming, not compute it. `count` is fixed
// rather than read from the query, because the real node count is exactly the one fact a
// loading state cannot know yet.

import { NODE_H, NODE_W } from "./graphNode.js";
import { svgEl } from "./icons.js";
import { el } from "./ui.js";

// Five category bands, mirroring CATEGORY_ORDER's split in icons.js (AI assets/compute, data,
// IAM, vulnerabilities, exposure) — so a grouped ghost's boxes read as the same five buckets
// the legend and the real canvas both use, even though the ghost never names them.
const LANES = 5;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 22;
const CANVAS_PAD = 32;
const GROUP_PAD = 16;
const DEFAULT_COUNT = 9;

// The one thing an axis-aligned card's bounding box needs to prove two cards never touch: if
// the distance between two same-size rectangles' centers is at least their shared diagonal,
// the rectangles cannot overlap on either axis, whatever direction separates them. Every mode
// below that isn't a plain grid (radial's rings, in particular) leans on this rather than on
// per-pair overlap checks, which is what keeps the geometry provably collision-free instead of
// merely collision-free for the counts someone happened to try.
const CARD_DIAGONAL = Math.sqrt(NODE_W * NODE_W + NODE_H * NODE_H);

/**
 * The lane (0..LANES-1) node `i` of `count` falls into: non-decreasing in `i`, so any
 * arrangement that reads lane as a flow position (rows' bands, lanes' columns, radial's rings)
 * draws that flow left-to-right / centre-out rather than scrambled.
 */
function laneOf(i, count) {
  return Math.min(LANES - 1, Math.floor((i * LANES) / Math.max(1, count)));
}

/**
 * A small integer hash, not `Math.random()` — the whole point of "organic" is that its jitter
 * is byte-identical on every render (and in the unit test), not merely bounded. Knuth's
 * multiplicative hash followed by a XOR-shift; there is no requirement beyond "looks
 * unpredictable and never repeats across the handful of seeds this module calls it with".
 */
function hash32(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

/** hash32 as a 0..1 fraction, for turning a seed into a jitter offset. */
function frac(n) {
  return hash32(n) / 4294967296;
}

/**
 * A generic connective skeleton for the ghost's edges — a spanning chain plus the occasional
 * cross-link for texture. These do not correspond to any real relationship (the ghost draws
 * before a query has run, so there is no graph to be faithful to yet); they exist only to make
 * the canvas read as connected rather than as a bag of cards.
 */
function chainEdges(count) {
  const edges = [];
  for (let i = 1; i < count; i++) {
    edges.push([i - 1, i]);
    if (i >= 2 && i % 3 === 0) edges.push([Math.floor(i / 2), i]);
  }
  return edges;
}

/** One bounding box per lane present, inset by `GROUP_PAD` — mirrors `.ggroup-box`. */
function groupBoxesFor(nodes, pad) {
  const byLane = new Map();
  for (const n of nodes) {
    if (!byLane.has(n.lane)) byLane.set(n.lane, []);
    byLane.get(n.lane).push(n);
  }
  // Never wider than the canvas margin reserved for it — `pad` already grew by GROUP_PAD when
  // grouping is on (see skeletonLayout), so insetting by the smaller of the two never pushes a
  // box past the edge CANVAS_PAD alone would have allowed.
  const inset = Math.min(GROUP_PAD, pad);
  return [...byLane.keys()].sort((a, b) => a - b).map((lane) => {
    const members = byLane.get(lane);
    const minX = Math.min(...members.map((m) => m.x));
    const maxX = Math.max(...members.map((m) => m.x + NODE_W));
    const minY = Math.min(...members.map((m) => m.y));
    const maxY = Math.max(...members.map((m) => m.y + NODE_H));
    return {
      lane,
      x: minX - inset,
      y: minY - inset,
      width: maxX - minX + inset * 2,
      height: maxY - minY + inset * 2,
    };
  });
}

function finish(nodes, width, height, grouped, pad) {
  return {
    width: Math.round(width),
    height: Math.round(height),
    nodes,
    edges: chainEdges(nodes.length),
    groups: grouped ? groupBoxesFor(nodes, pad) : [],
  };
}

/** "grid" (dense, categories ignored) and "organic" (the same pack, lightly jittered). */
function packLayout(count, grouped, pad, jittered) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const cellW = NODE_W + NODE_GAP_X;
  const cellH = NODE_H + NODE_GAP_Y;
  // Bounded to less than half the gutter: two adjacent cells jittering toward each other can
  // close at most JITTER_RANGE of the gap between them, so keeping it under the gutter itself
  // guarantees clearance survives, and the /2 leaves headroom rather than cutting it exactly.
  const jitterRange = jittered ? Math.min(NODE_GAP_X, NODE_GAP_Y) * 0.5 : 0;
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    let x = pad + col * cellW;
    let y = pad + row * cellH;
    if (jittered) {
      x += (frac(i * 2 + 1) - 0.5) * jitterRange;
      y += (frac(i * 2 + 2) - 0.5) * jitterRange;
    }
    nodes.push({ x, y, lane: laneOf(i, count) });
  }
  const width = pad * 2 + cols * NODE_W + (cols - 1) * NODE_GAP_X;
  const height = pad * 2 + rows * NODE_H + (rows - 1) * NODE_GAP_Y;
  return finish(nodes, width, height, grouped, pad);
}

/** "rows" (bands across) and "lanes" (the same bands, running down instead). */
function bandLayout(count, grouped, pad, acrossRows) {
  const perLane = new Array(LANES).fill(0);
  const placedLane = [];
  const placedPos = [];
  for (let i = 0; i < count; i++) {
    const lane = laneOf(i, count);
    placedLane.push(lane);
    placedPos.push(perLane[lane]++);
  }
  const maxPerLane = Math.max(1, ...perLane);
  const cellW = NODE_W + NODE_GAP_X;
  const cellH = NODE_H + NODE_GAP_Y;
  const nodes = placedLane.map((lane, i) => (acrossRows
    ? { x: pad + placedPos[i] * cellW, y: pad + lane * cellH, lane }
    : { x: pad + lane * cellW, y: pad + placedPos[i] * cellH, lane }));
  const width = acrossRows
    ? pad * 2 + maxPerLane * NODE_W + (maxPerLane - 1) * NODE_GAP_X
    : pad * 2 + LANES * NODE_W + (LANES - 1) * NODE_GAP_X;
  const height = acrossRows
    ? pad * 2 + LANES * NODE_H + (LANES - 1) * NODE_GAP_Y
    : pad * 2 + maxPerLane * NODE_H + (maxPerLane - 1) * NODE_GAP_Y;
  return finish(nodes, width, height, grouped, pad);
}

/**
 * "radial": concentric rings, node 0 alone at the centre (the root the real layout would pick
 * by worst risk — the ghost has no risk to rank, so it just always seeds ring 0 with the first
 * node), the rest spread outward across the remaining `LANES - 1` rings.
 *
 * Ring radii grow by at least `CARD_DIAGONAL` per step, which is sufficient — not merely
 * typical — for every node on ring N to clear every node on every other ring regardless of
 * angle (see CARD_DIAGONAL's comment); within a ring, radius is also floored at the distance
 * that keeps adjacent cards' chord at least `CARD_DIAGONAL` apart.
 */
function ringOf(i, count) {
  if (i === 0 || count <= 1) return 0;
  return 1 + Math.min(LANES - 2, Math.floor(((i - 1) * (LANES - 1)) / (count - 1)));
}

function radialLayout(count, grouped, pad) {
  const perRing = new Array(LANES).fill(0);
  for (let i = 0; i < count; i++) perRing[ringOf(i, count)]++;

  const radius = new Array(LANES).fill(0);
  let prev = 0;
  for (let r = 0; r < LANES; r++) {
    const m = perRing[r];
    if (!m) { radius[r] = prev; continue; }
    const chordFloor = m > 1 ? CARD_DIAGONAL / (2 * Math.sin(Math.PI / m)) : 0;
    radius[r] = r === 0 ? chordFloor : Math.max(prev + CARD_DIAGONAL, chordFloor);
    prev = Math.max(prev, radius[r]);
  }
  const maxR = Math.max(...radius, 0);
  const cx = maxR + NODE_W / 2 + pad;
  const cy = maxR + NODE_H / 2 + pad;

  const angleSeen = new Array(LANES).fill(0);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const ring = ringOf(i, count);
    const k = angleSeen[ring]++;
    const m = perRing[ring];
    // Each ring's start angle is nudged so consecutive rings don't stack their first node on
    // the same spoke — decorative only, since the radial-gap proof above holds at any angle.
    const theta = (k / m) * Math.PI * 2 + ring * 0.4;
    nodes.push({
      x: cx + radius[ring] * Math.cos(theta) - NODE_W / 2,
      y: cy + radius[ring] * Math.sin(theta) - NODE_H / 2,
      lane: ring,
    });
  }
  const width = 2 * maxR + NODE_W + pad * 2;
  const height = 2 * maxR + NODE_H + pad * 2;
  return finish(nodes, width, height, grouped, pad);
}

/**
 * The wireframe for one of the five arrangements `state.layout` can name. Pure and
 * deterministic — two calls with the same arguments return byte-identical output, which is
 * what lets the unit test assert on "organic" instead of merely eyeballing it.
 *
 * `mode` is taken as given: the "" -> DEFAULT_LAYOUT collapse lives in graph.js alongside
 * every other reader of `state.layout`, not here, so this module has exactly one idea of what
 * a layout name looks like. An unrecognised mode falls back to "grid" the same way an
 * unrecognised `state.layout` does everywhere else on the page.
 */
export function skeletonLayout(mode, opts = {}) {
  const count = Math.max(1, Math.round(Number(opts.count)) || DEFAULT_COUNT);
  const grouped = !!opts.grouped;
  // Grouping widens the margin so a bounding box inset by GROUP_PAD around edge nodes never
  // has to reach past the canvas edge to draw itself.
  const pad = CANVAS_PAD + (grouped ? GROUP_PAD : 0);
  switch (mode) {
    case "rows": return bandLayout(count, grouped, pad, true);
    case "lanes": return bandLayout(count, grouped, pad, false);
    case "radial": return radialLayout(count, grouped, pad);
    case "organic": return packLayout(count, grouped, pad, true);
    case "grid":
    default: return packLayout(count, grouped, pad, false);
  }
}

// ---------------------------------------------------------------------------------- the DOM

/**
 * Mount the ghost in `container` and return the handle graph.js holds beside `lastData` /
 * `seq` / `graphApi`. `opts.mode` is a resolved layout name (already defaulted by the caller,
 * per skeletonLayout's own comment); `opts.grouped` mirrors `groupLevels().length > 0`.
 *
 * The SVG is `aria-hidden`: it is a picture of what is coming, not information, and the one
 * thing here worth announcing — which phase the load is in — lives in the status region below
 * it. Node cards draw an outer box plus an inner title bar and subtitle rect so each one reads
 * as a CARD rather than a blank rectangle; nothing on them carries category or severity color
 * (the Rationed Ink Rule spends color on risk answers, and a loading state has none yet).
 */
export function renderGraphSkeleton(container, opts = {}) {
  const layout = skeletonLayout(opts.mode, { grouped: opts.grouped });
  const host = el("div", { class: "graph-skeleton" });

  const svg = svgEl("svg", {
    class: "gs-canvas",
    "aria-hidden": "true",
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    preserveAspectRatio: "xMidYMid meet",
  });

  for (const g of layout.groups) {
    svg.append(svgEl("rect", {
      class: "gs-group", x: g.x, y: g.y, width: g.width, height: g.height, rx: 14,
    }));
  }

  const centers = layout.nodes.map((n) => [n.x + NODE_W / 2, n.y + NODE_H / 2]);
  layout.edges.forEach(([a, b], i) => {
    const [x1, y1] = centers[a];
    const [x2, y2] = centers[b];
    // The draw-in animation is `stroke-dashoffset` walking from the line's own length to 0, so
    // the dash length has to be the real segment length — a shared constant would either
    // overshoot short edges (finishing early, snapping into place) or undershoot long ones
    // (never fully drawing). Carried in as a custom property rather than a literal
    // `stroke-dasharray`/`stroke-dashoffset` pair: an inline STYLE ATTRIBUTE value outranks
    // any class rule regardless of specificity, and the reduced-motion override below has to
    // be able to force `stroke-dashoffset` back to 0 the ordinary way.
    const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
    svg.append(svgEl("line", {
      class: "gs-edge", x1, y1, x2, y2, style: `--i:${i}; --gs-len:${len}`,
    }));
  });

  layout.nodes.forEach((n) => {
    const g = svgEl("g", { class: "gs-node", style: `--i:${n.lane}`, transform: `translate(${n.x}, ${n.y})` });
    g.append(svgEl("rect", { class: "gs-node-box", x: 0, y: 0, width: NODE_W, height: NODE_H, rx: 10 }));
    g.append(svgEl("rect", { class: "gs-node-title", x: 14, y: 15, width: NODE_W * 0.42, height: 10, rx: 3 }));
    g.append(svgEl("rect", { class: "gs-node-sub", x: 14, y: 33, width: NODE_W * 0.26, height: 8, rx: 3 }));
    svg.append(g);
  });

  // Reuses the app's one indeterminate-progress component (base.css) rather than a second
  // implementation — it already carries the static-striped reduced-motion fallback.
  const track = el("div", { class: "progress-track indeterminate", "aria-hidden": "true" },
    el("div", { class: "progress-fill" }));
  const phase = el("span", { class: "gs-phase" }, "Running the graph query…");
  const status = el("div", { class: "gs-status", role: "status", "aria-live": "polite" }, track, phase);

  host.append(svg, status);
  container.append(host);

  // An unbounded wait reads as stuck; this is the one thing the client can honestly add once
  // 8s have passed without inventing a percentage or an ETA it has no basis for.
  const longWait = setTimeout(() => {
    phase.textContent = "Still running — larger queries can take a little longer.";
  }, 8000);

  return {
    setPhase(text) { phase.textContent = text; },
    destroy() {
      clearTimeout(longWait);
      host.remove();
    },
  };
}
