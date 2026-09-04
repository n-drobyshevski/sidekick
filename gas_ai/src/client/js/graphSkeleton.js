// The ghost graph: what the canvas shows before the first answer lands, and — as the same
// module's status region — what the top-edge bar and pill say on every refetch after that.
// Split into a pure half and a DOM half so the geometry that makes the ghost look like THIS
// product's graph (not a generic grey rectangle) can be unit-tested without a browser.
//
// The five arrangements below are wireframe APPROXIMATIONS of graphLayout.ts's real engines,
// not ports of them — the client bundle cannot import the domain layer (the reason every
// client-side layout copy in this codebase, egoLayout.js included, keeps its own numbers), and
// a ghost only has to predict the SHAPE of what is coming, not compute it. Node COUNT is no
// exception: the real count is the one fact a loading state cannot know yet, but unlike the
// arrangement it is not a fixed guess either — `skeletonLayout` is handed the pane's own
// measured pixel size and derives however many cards actually fit it, the same way the DOM
// half below measures its container rather than assuming one (see that half's own comment for
// why, and why the pure half only ever takes width/height as arguments instead of touching the
// DOM to find them itself).
//
// GROUPING gets a second, separate algorithm rather than a variant of the five arrangements.
// graphView.js:36-47 documents that grouping is orthogonal to arrangement — a grouped picture
// is boxes packed in two dimensions with no left-to-right flow — and the five arrangements
// above are all interleaved (a node's neighbours in the picture are not its neighbours in its
// category), so bounding-boxing one after the fact draws overlapping boxes in every mode but
// "lanes". `groupedLayout` instead builds each of the five category lanes as its own
// self-contained block (a small dense grid of its members, `blockFor`) and packs the blocks
// with a toy-scale twin of graphLayout.ts's own `packBlocks` shelf packer — boxes are pairwise
// disjoint by construction, not by bounding a layout that was never block-shaped to begin with.
// `mode` is ignored once grouped: a block of a handful of members has no room to read as
// organic jitter, row bands, or rings differently from a plain grid, and the real engine's own
// block-interior code makes the identical simplification for ITS "grid" mode
// (graphLayout.ts's `blockFor`, the `mode === "grid"` branch) — this just makes it the only
// choice instead of one of several.

import { NODE_H, NODE_W } from "./graphNode.js";
import { svgEl } from "../../../../gas_shared/icons.js";
import { el } from "./ui.js";

// Five category bands, mirroring CATEGORY_ORDER's split in icons.js (AI assets/compute, data,
// IAM, vulnerabilities, exposure) — so a grouped ghost's boxes read as the same five buckets
// the legend and the real canvas both use, even though the ghost never names them.
const LANES = 5;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 22;
const CANVAS_PAD = 32;
const GROUP_PAD = 16;
// Gap between packed blocks in a grouped picture — roughly twice GROUP_PAD, the same ratio
// graphLayout.ts's own GROUP_PAD (24) to BLOCK_GAP_X (48) keeps at canvas scale.
const BLOCK_GAP = 32;

// A node count too low doesn't read as a graph (chainEdges needs 2+ nodes to draw anything,
// and 1-3 cards look like a stray fragment rather than a preview); one too high costs paint
// time for zero legibility gain and, at real card size, would visually swamp the pane it is
// meant to be a light preview of. 30 isn't arbitrary: it is config.ts's MAX_NODES_FLOOR, the
// smallest node budget a real query can be configured to use — so the ghost never promises
// more cards than even the sparsest real result already shows by default.
const MIN_COUNT = 4;
const MAX_COUNT = 30;

// The DOM half's fallback pane size (see renderGraphSkeleton) and this half's fallback when a
// caller asks for a layout without measuring anything (tests, mainly) — a plausible canvas
// pane, not a magic number tied to any one screen.
const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 700;

// The one thing an axis-aligned card's bounding box needs to prove two cards never touch: if
// the distance between two same-size rectangles' centers is at least their shared diagonal,
// the rectangles cannot overlap on either axis, whatever direction separates them. Every mode
// below that isn't a plain grid (radial's rings, in particular) leans on this rather than on
// per-pair overlap checks, which is what keeps the geometry provably collision-free instead of
// merely collision-free for the counts someone happened to try.
const CARD_DIAGONAL = Math.sqrt(NODE_W * NODE_W + NODE_H * NODE_H);

/**
 * The lane (0..lanes-1) node `i` of `count` falls into: non-decreasing in `i`, so any
 * arrangement that reads lane as a flow position (rows' bands, lanes' columns, radial's rings)
 * draws that flow left-to-right / centre-out rather than scrambled. `lanes` defaults to the
 * full five category bands; band/ring layouts pass a smaller value when the pane can't hold
 * all five (see bandLayout and radialFit below) — reducing the count of *bands*, never
 * touching this formula's shape.
 */
function laneOf(i, count, lanes = LANES) {
  return Math.min(lanes - 1, Math.floor((i * lanes) / Math.max(1, count)));
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

/** Package the geometry every arrangement below ends with. `groups` defaults to none — only
 *  `groupedLayout` ever supplies them, already built (see the module comment for why boxes are
 *  never derived from an interleaved arrangement's node positions any more). */
function finish(nodes, width, height, groups) {
  return {
    width: Math.round(width),
    height: Math.round(height),
    nodes,
    edges: chainEdges(nodes.length),
    groups: groups || [],
  };
}

/**
 * Resolve the node count for one call: an explicit `override` always wins (rounded, floored at
 * 1) — the "how big a canvas does exactly N nodes need" question the unit tests mostly ask.
 * With no override, `capacity` (however many cards the caller's own arrangement worked out fit
 * the measured pane) stands in, clamped to [MIN_COUNT, MAX_COUNT] — the "how many cards does
 * this pane's own size suggest" question the real DOM path asks.
 */
function deriveCount(override, capacity) {
  const n = Math.round(Number(override));
  if (Number.isFinite(n) && n > 0) return n;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, capacity));
}

/** How many NODE_W x NODE_H cells (with their gaps) fit in `inner` on one axis. */
function gridCols(innerW) {
  return Math.max(1, Math.floor((innerW + NODE_GAP_X) / (NODE_W + NODE_GAP_X)));
}
function gridRows(innerH) {
  return Math.max(1, Math.floor((innerH + NODE_GAP_Y) / (NODE_H + NODE_GAP_Y)));
}
/** A plain grid's capacity for the available space — the density ceiling every other
 *  arrangement below is at most as dense as, so it also serves as their upper estimate. */
function capacityOf(innerW, innerH) {
  return gridCols(innerW) * gridRows(innerH);
}

/** "grid" (dense, categories ignored) and "organic" (the same pack, lightly jittered).
 *
 * `countOverride == null` is the measured/fit path: `cols` comes from how many cards the
 * available width can hold, so the returned canvas is `Math.max(width, contentW)` — content is
 * never wider than what was asked for, and equals it exactly whenever that many cards fit
 * (which capacity-derived `count` guarantees for anything but a pane too small to hold
 * MIN_COUNT). An explicit override instead sizes `cols` off `count` alone (a tight square,
 * as before) — the legacy "how big does N need" question, unconcerned with any given pane. */
function packLayout(width, height, pad, jittered, countOverride) {
  const innerW = Math.max(NODE_W, width - pad * 2);
  const innerH = Math.max(NODE_H, height - pad * 2);
  const count = deriveCount(countOverride, capacityOf(innerW, innerH));
  const cols = countOverride != null
    ? Math.max(1, Math.ceil(Math.sqrt(count)))
    : Math.max(1, Math.min(count, gridCols(innerW)));
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
  const rows = Math.ceil(count / cols);
  const contentW = pad * 2 + cols * NODE_W + (cols - 1) * NODE_GAP_X;
  const contentH = pad * 2 + rows * NODE_H + (rows - 1) * NODE_GAP_Y;
  return finish(nodes, Math.max(width, contentW), Math.max(height, contentH));
}

/** "rows" (bands across) and "lanes" (the same bands, running down instead).
 *
 * Reserves only as many of the five category bands as the pane can actually hold along the
 * axis they stack on (`lanes`, floored at 1) — a pane too short for "rows" or too narrow for
 * "lanes" gets fewer, still fully populated bands rather than five bands it cannot afford the
 * height/width for. The same "shrink the picture, not the cards" move radial's ring count
 * takes below. As with packLayout, an explicit override sizes the canvas to its content
 * instead of fitting a given one — and since that path is always handed the generous
 * DEFAULT_WIDTH/HEIGHT (see skeletonLayout), `lanes` comes out to the full five anyway. */
function bandLayout(width, height, pad, acrossRows, countOverride) {
  const innerW = Math.max(NODE_W, width - pad * 2);
  const innerH = Math.max(NODE_H, height - pad * 2);
  const cellW = NODE_W + NODE_GAP_X;
  const cellH = NODE_H + NODE_GAP_Y;
  const stackAxis = acrossRows ? innerH : innerW;
  const stackGap = acrossRows ? NODE_GAP_Y : NODE_GAP_X;
  const stackCell = acrossRows ? cellH : cellW;
  const acrossAxis = acrossRows ? innerW : innerH;
  const acrossGap = acrossRows ? NODE_GAP_X : NODE_GAP_Y;
  const acrossCell = acrossRows ? cellW : cellH;
  const lanes = Math.max(1, Math.min(LANES, Math.floor((stackAxis + stackGap) / stackCell)));
  const perLaneCapacity = Math.max(1, Math.floor((acrossAxis + acrossGap) / acrossCell));
  const count = deriveCount(countOverride, lanes * perLaneCapacity);

  const perLane = new Array(lanes).fill(0);
  const placedLane = [];
  const placedPos = [];
  for (let i = 0; i < count; i++) {
    const lane = laneOf(i, count, lanes);
    placedLane.push(lane);
    placedPos.push(perLane[lane]++);
  }
  const maxPerLane = Math.max(1, ...perLane);
  const nodes = placedLane.map((lane, i) => (acrossRows
    ? { x: pad + placedPos[i] * cellW, y: pad + lane * cellH, lane }
    : { x: pad + lane * cellW, y: pad + placedPos[i] * cellH, lane }));
  const contentW = acrossRows
    ? pad * 2 + maxPerLane * NODE_W + (maxPerLane - 1) * NODE_GAP_X
    : pad * 2 + lanes * NODE_W + (lanes - 1) * NODE_GAP_X;
  const contentH = acrossRows
    ? pad * 2 + lanes * NODE_H + (lanes - 1) * NODE_GAP_Y
    : pad * 2 + maxPerLane * NODE_H + (maxPerLane - 1) * NODE_GAP_Y;
  return finish(nodes, Math.max(width, contentW), Math.max(height, contentH));
}

/**
 * "radial": concentric rings, node 0 alone at the centre (the root the real layout would pick
 * by worst risk — the ghost has no risk to rank, so it just always seeds ring 0 with the first
 * node), the rest spread outward across the remaining `rings - 1` rings.
 *
 * Ring radii grow by at least `CARD_DIAGONAL` per populated step, which is sufficient — not
 * merely typical — for every node on ring N to clear every node on every other ring regardless
 * of angle (see CARD_DIAGONAL's comment); within a ring, radius is also floored at the
 * distance that keeps adjacent cards' chord at least `CARD_DIAGONAL` apart.
 */
function ringOf(i, count, rings) {
  if (rings <= 1 || i === 0 || count <= 1) return 0;
  return 1 + Math.min(rings - 2, Math.floor(((i - 1) * (rings - 1)) / (count - 1)));
}

/** The geometry `count` nodes settle into on `rings` rings: how many land on each ring, each
 *  ring's radius, and the farthest any of them sits from the centre. */
function ringGeometry(count, rings) {
  const perRing = new Array(rings).fill(0);
  for (let i = 0; i < count; i++) perRing[ringOf(i, count, rings)]++;
  const radius = new Array(rings).fill(0);
  let prev = 0;
  for (let r = 0; r < rings; r++) {
    const m = perRing[r];
    if (!m) { radius[r] = prev; continue; }
    const chordFloor = m > 1 ? CARD_DIAGONAL / (2 * Math.sin(Math.PI / m)) : 0;
    radius[r] = r === 0 ? chordFloor : Math.max(prev + CARD_DIAGONAL, chordFloor);
    prev = Math.max(prev, radius[r]);
  }
  return { perRing, radius, maxR: Math.max(...radius, 0) };
}

/**
 * The largest node count (up to MAX_COUNT) that SOME ring count between 1 and LANES clears
 * `radiusBudget` with, preferring more rings at each count tried (closer to the real five
 * category rings, and spreading occupancy keeps any one ring's own chord requirement down).
 *
 * This is a search rather than an area estimate on purpose: radial's real footprint depends on
 * how many rings end up populated, which depends on the count, which is exactly what a plain
 * "cards per unit area" guess (packLayout's approach) cannot see — the full CARD_DIAGONAL step
 * every additional populated ring costs is what actually blew the canvas up past the pane (see
 * the module/call-site comments), and only a search over the real geometry reliably lands
 * under a given budget instead of hoping a guess happens to.
 */
function radialFit(radiusBudget) {
  let best = null;
  for (let count = MIN_COUNT; count <= MAX_COUNT; count++) {
    for (let rings = LANES; rings >= 1; rings--) {
      if (ringGeometry(count, rings).maxR <= radiusBudget) {
        best = { count, rings };
        break;
      }
    }
  }
  return best || { count: MIN_COUNT, rings: 1 };
}

function radialLayout(width, height, pad, countOverride) {
  const innerW = Math.max(NODE_W, width - pad * 2);
  const innerH = Math.max(NODE_H, height - pad * 2);
  let count;
  let rings;
  if (countOverride != null) {
    // The legacy "how big does N need" path: fixed at all five category rings, canvas grows
    // to whatever that costs — unconcerned with any given pane, same as the other two modes'
    // override branch.
    count = Math.max(1, Math.round(Number(countOverride)) || 1);
    rings = LANES;
  } else {
    // The picture grows equally in every direction from the centre: a ring at radius R needs
    // 2R + NODE_W of width and 2R + NODE_H of height (the farthest card's own footprint past
    // the ring line, on whichever side it lands), so the true ceiling on R is the tighter of
    // the two axes once each has given up its own card size — not, as it's tempting to write,
    // half of whichever side is shorter.
    const radiusBudget = Math.min((innerW - NODE_W) / 2, (innerH - NODE_H) / 2);
    ({ count, rings } = radialFit(radiusBudget));
  }
  const geo = ringGeometry(count, rings);
  const cx = geo.maxR + NODE_W / 2 + pad;
  const cy = geo.maxR + NODE_H / 2 + pad;

  const angleSeen = new Array(rings).fill(0);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const ring = ringOf(i, count, rings);
    const k = angleSeen[ring]++;
    const m = geo.perRing[ring];
    // Each ring's start angle is nudged so consecutive rings don't stack their first node on
    // the same spoke — decorative only, since the radial-gap proof above holds at any angle.
    const theta = (k / m) * Math.PI * 2 + ring * 0.4;
    nodes.push({
      x: cx + geo.radius[ring] * Math.cos(theta) - NODE_W / 2,
      y: cy + geo.radius[ring] * Math.sin(theta) - NODE_H / 2,
      lane: ring,
    });
  }
  const contentW = 2 * geo.maxR + NODE_W + pad * 2;
  const contentH = 2 * geo.maxR + NODE_H + pad * 2;
  return finish(nodes, Math.max(width, contentW), Math.max(height, contentH));
}

// ------------------------------------------------------------------ grouped: blocks, packed

/**
 * One lane's block: its members in a small dense grid, positions relative to the block's own
 * top-left corner. `cols` caps at 4 (mirrors graphLayout.ts's `gridBlock`, its default block
 * interior) — a box is one item in a shelf-packed row, and a wide one pushes every box after it
 * onto the next shelf.
 */
function blockFor(indices) {
  const n = indices.length;
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const cellW = NODE_W + NODE_GAP_X;
  const cellH = NODE_H + NODE_GAP_Y;
  const cells = indices.map((idx, i) => ({
    idx,
    x: GROUP_PAD + (i % cols) * cellW,
    y: GROUP_PAD + Math.floor(i / cols) * cellH,
  }));
  return {
    cells,
    width: GROUP_PAD * 2 + cols * NODE_W + (cols - 1) * NODE_GAP_X,
    height: GROUP_PAD * 2 + rows * NODE_H + (rows - 1) * NODE_GAP_Y,
  };
}

/**
 * Greedy first-fit shelf pack: left to right, wrapping at `wrapW`. The toy-scale twin of
 * graphLayout.ts's `packBlocks` (identical recipe — blocks keep their incoming order, a shelf
 * is as tall as its tallest member) — so a grouped ghost previews the real packer's own
 * behaviour rather than a different one invented for the preview. Placements are relative to
 * the pack's own origin (0,0); callers translate by the canvas margin afterwards.
 */
function packBlocks(blocks, wrapW) {
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let maxX = 0;
  const placed = [];
  for (const block of blocks) {
    if (shelfX > 0 && shelfX + block.width > wrapW) {
      shelfY += shelfH + BLOCK_GAP;
      shelfX = 0;
      shelfH = 0;
    }
    placed.push({ block, x: shelfX, y: shelfY });
    shelfX += block.width + BLOCK_GAP;
    shelfH = Math.max(shelfH, block.height);
    maxX = Math.max(maxX, shelfX - BLOCK_GAP);
  }
  return { placed, width: maxX, height: shelfY + shelfH };
}

/** The wrap width the legacy override path packs at: a roughly-square target derived from the
 *  blocks' own total area, the same `shelfWidth` heuristic graphLayout.ts uses when it has no
 *  pane to fit and is instead asking "how wide should this content make itself". */
function shelfWidthFor(blocks) {
  const area = blocks.reduce((acc, b) => acc + (b.width + BLOCK_GAP) * (b.height + BLOCK_GAP), 0);
  return Math.max(NODE_W + GROUP_PAD * 2, Math.ceil(Math.sqrt(area * 1.8)));
}

/** `count` nodes, sorted into the five category lanes and built into one block per populated
 *  lane — the pre-pack half of groupedLayout, split out so the fit search below can build and
 *  discard candidates without duplicating this. */
function buildBlocks(count) {
  const byLane = new Map();
  for (let i = 0; i < count; i++) {
    const lane = laneOf(i, count);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(i);
  }
  return [...byLane.keys()].sort((a, b) => a - b).map((lane) => ({ lane, ...blockFor(byLane.get(lane)) }));
}

/**
 * The grouped picture: see the module comment for why this bypasses `mode` and the five
 * arrangements entirely rather than bounding-boxing one of them.
 *
 * A block's own footprint depends on how many members land in its lane, which depends on the
 * count — the same reason radialLayout above searches instead of estimating from area — so the
 * measured/fit path (no override) searches for the largest count (up to MAX_COUNT) whose
 * packed blocks actually fit the pane, rather than guessing a count and hoping the resulting
 * boxes happen to.
 */
function groupedLayout(width, height, pad, countOverride) {
  const innerW = Math.max(NODE_W, width - pad * 2);
  const innerH = Math.max(NODE_H, height - pad * 2);

  let count;
  let wrapW;
  if (countOverride != null) {
    count = Math.max(1, Math.round(Number(countOverride)) || 1);
    wrapW = shelfWidthFor(buildBlocks(count));
  } else {
    let best = MIN_COUNT;
    for (let c = MIN_COUNT; c <= MAX_COUNT; c++) {
      const packed = packBlocks(buildBlocks(c), innerW);
      if (packed.width <= innerW && packed.height <= innerH) best = c;
    }
    count = best;
    wrapW = innerW;
  }

  const blocks = buildBlocks(count);
  const packed = packBlocks(blocks, wrapW);

  const nodes = new Array(count);
  const groups = [];
  for (const { block, x: bx, y: by } of packed.placed) {
    for (const cell of block.cells) {
      nodes[cell.idx] = { x: pad + bx + cell.x, y: pad + by + cell.y, lane: block.lane };
    }
    groups.push({
      lane: block.lane, x: pad + bx, y: pad + by, width: block.width, height: block.height,
    });
  }

  const contentW = pad * 2 + packed.width;
  const contentH = pad * 2 + packed.height;
  return finish(nodes, Math.max(width, contentW), Math.max(height, contentH), groups);
}

/**
 * The wireframe for one of the five arrangements `state.layout` can name, at the pane size the
 * caller measured — or, when grouped, the block-packed picture above (which ignores `mode`;
 * see the module comment). Pure and deterministic — two calls with the same arguments return
 * byte-identical output, which is what lets the unit test assert on "organic" instead of
 * merely eyeballing it.
 *
 * `opts`: `width`/`height` are the pane's own pixel size (defaulting to a plausible pane when
 * omitted, mainly for tests that only care about `count`); `grouped` selects the block-packed
 * path; `count`, when given, pins the node count exactly instead of deriving it from the pane
 * — the tests use this to ask "how does mode X arrange exactly N nodes" independent of any
 * particular viewport, while the real DOM path (renderGraphSkeleton) never passes it, since
 * the whole point there is to fill whatever pane it was actually handed.
 *
 * `mode` is taken as given: the "" -> DEFAULT_LAYOUT collapse lives in graph.js alongside
 * every other reader of `state.layout`, not here, so this module has exactly one idea of what
 * a layout name looks like. An unrecognised mode falls back to "grid" the same way an
 * unrecognised `state.layout` does everywhere else on the page.
 */
export function skeletonLayout(mode, opts = {}) {
  const width = Number(opts.width) > 0 ? Number(opts.width) : DEFAULT_WIDTH;
  const height = Number(opts.height) > 0 ? Number(opts.height) : DEFAULT_HEIGHT;
  const grouped = !!opts.grouped;
  const pad = CANVAS_PAD;
  if (grouped) return groupedLayout(width, height, pad, opts.count);
  switch (mode) {
    case "rows": return bandLayout(width, height, pad, true, opts.count);
    case "lanes": return bandLayout(width, height, pad, false, opts.count);
    case "radial": return radialLayout(width, height, pad, opts.count);
    case "organic": return packLayout(width, height, pad, true, opts.count);
    case "grid":
    default: return packLayout(width, height, pad, false, opts.count);
  }
}

// ---------------------------------------------------------------------------------- the DOM

// Mirrors `.graph-skeleton`'s own `inset: 12px` in graph.css — the host sits inset from its
// container by this much on every side, and the status pill is an absolute overlay INSIDE that
// box rather than a flex sibling that would eat into it, specifically so the host's measured
// box is exactly the svg's box with nothing else to account for (see renderGraphSkeleton).
const GS_INSET = 12;

/**
 * Mount the ghost in `container` and return the handle graph.js holds beside `lastData` /
 * `seq` / `graphApi`. `opts.mode` is a resolved layout name (already defaulted by the caller,
 * per skeletonLayout's own comment); `opts.grouped` mirrors `groupLevels().length > 0`.
 *
 * MEASURED, NOT SCALED — the same house pattern the record-sheet connection map and the scan
 * coverage diagram both use (egoGraph.js, scans.js's provenanceDiagram): `container` is
 * measured at mount and the viewBox is drawn at exactly that pixel size, so
 * `preserveAspectRatio="xMidYMid meet"` never has anything to actually rescale and one SVG
 * unit is one CSS pixel — a ghost card is always exactly NODE_W x NODE_H on screen, in every
 * arrangement, whatever size the pane happens to be. (Those two components re-measure on
 * resize via ResizeObserver; this one doesn't need to; it is torn down within moments of
 * mounting, either by the first answer landing or by the query failing, never long enough to
 * outlive a resize worth reacting to.)
 *
 * `clientWidth`/`clientHeight` can read 0 if this runs before the stylesheet has resolved (a
 * cold first boot racing its own `<link>`) — a 0x0 viewBox would draw a graph nobody can see,
 * so a plausible pane size (skeletonLayout's own DEFAULT_WIDTH/HEIGHT) stands in rather than
 * trusting an unresolved layout.
 *
 * The SVG is `aria-hidden`: it is a picture of what is coming, not information, and the one
 * thing here worth announcing — which phase the load is in — lives in the status region below
 * it. Node cards draw an outer box plus an inner title bar and subtitle rect so each one reads
 * as a CARD rather than a blank rectangle; nothing on them carries category or severity color
 * (the Rationed Ink Rule spends color on risk answers, and a loading state has none yet).
 */
export function renderGraphSkeleton(container, opts = {}) {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const width = cw > GS_INSET * 2 ? cw - GS_INSET * 2 : undefined;
  const height = ch > GS_INSET * 2 ? ch - GS_INSET * 2 : undefined;
  const layout = skeletonLayout(opts.mode, { width, height, grouped: opts.grouped });
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
    // TWO nested groups, and they cannot be collapsed into one. An SVG `transform` ATTRIBUTE
    // and the CSS `transform` PROPERTY are the same property, so the rise animation's
    // `transform: none` end state does not merely finish — with `animation-fill-mode: both` it
    // holds, overwriting the `translate()` that positions the card and stacking every node at
    // the origin. Collapsed into one element this renders as a single smear in the top-left
    // corner with the edges still fanning out to where the cards should have been.
    // So: the OUTER group positions (attribute only, never animated), the INNER one animates
    // (CSS only, never positioned).
    const at = svgEl("g", { transform: `translate(${n.x}, ${n.y})` });
    const g = svgEl("g", { class: "gs-node", style: `--i:${n.lane}` });
    g.append(svgEl("rect", { class: "gs-node-box", x: 0, y: 0, width: NODE_W, height: NODE_H, rx: 10 }));
    g.append(svgEl("rect", { class: "gs-node-title", x: 14, y: 15, width: NODE_W * 0.42, height: 10, rx: 3 }));
    g.append(svgEl("rect", { class: "gs-node-sub", x: 14, y: 33, width: NODE_W * 0.26, height: 8, rx: 3 }));
    at.append(g);
    svg.append(at);
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
