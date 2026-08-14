// The ego-graph mini-diagram on an asset/issue detail sheet: which neighbours it draws,
// and where every box and edge lands. No DOM here — whichever surface paints this (a
// detail-sheet section, same family as recordSections.js) turns these numbers into an
// inline SVG; this module only decides them.

import { sevRank as rankSeverity } from "./ui/format.js";

// Mirrors SEVERITY_ORDER in src/domain/config.ts. assetQuery.js and comboView.js each
// keep their own copy of this same list for the same reason: the client bundle cannot
// import the domain layer, and the order must still agree with it.
const SEVERITY_RANK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
const sevRank = (sev) => rankSeverity(sev, SEVERITY_RANK);

// ------------------------------------------------------------------------- neighbour pick

// The risk-topology kinds, in the order they should draw. These nodes carry no cloud or
// project of their own (graphTypes.ts) — they exist only to say something is wrong with the
// asset they hang off, and that IS the security story, so they always outrank an ordinary
// asset neighbour, and rank against each other in this order.
//
// DATA_FINDING outranks SENSITIVE_DATA: a confirmed classification finding is stronger
// evidence than the stub that stands in for one where no path could be walked.
const RISK_KIND_ORDER = [
  "MISSING_GUARDRAIL", "INTERNET_EXPOSURE", "DATA_FINDING", "SENSITIVE_DATA",
  "EXCESSIVE_PRIVILEGE",
];

/** 0..3 for the risk kinds in declared order, 4 for RUNS_AS, 5 for everything else. */
function bucket(rel) {
  var node = rel.node || {};
  var kindIdx = RISK_KIND_ORDER.indexOf(node.kind);
  if (kindIdx !== -1) return kindIdx;
  var edge = rel.edge || {};
  if (edge.type === "RUNS_AS") return RISK_KIND_ORDER.length;
  return RISK_KIND_ORDER.length + 1;
}

/**
 * Worst-and-most-structural first: risk kind, then RUNS_AS (the execution identity), then
 * everything else by severity/AARS/name. That last rule doubles as the tiebreak WITHIN a
 * bucket too (two MISSING_GUARDRAIL neighbours, say), so the order stays fully
 * deterministic instead of falling back to whatever order the server happened to send.
 */
function compareRels(a, b) {
  var d = bucket(a) - bucket(b);
  if (d !== 0) return d;

  var an = a.node || {};
  var bn = b.node || {};
  d = sevRank(an.severity) - sevRank(bn.severity);
  if (d !== 0) return d;

  var aHasAars = an.aars !== null && an.aars !== undefined;
  var bHasAars = bn.aars !== null && bn.aars !== undefined;
  if (aHasAars !== bHasAars) return aHasAars ? -1 : 1; // present beats absent (null last)
  if (aHasAars && bHasAars && an.aars !== bn.aars) return bn.aars - an.aars; // higher first

  return String(an.name || "").localeCompare(String(bn.name || ""));
}

/**
 * Which neighbours the ego picture shows. The map is a summary and a summary chooses;
 * the full relationship list lives elsewhere (the record's own Relationships section)
 * and keeps the server's own order, so this reads "rels" but never mutates it.
 *
 * Under the cap, everything shows and "hiddenCount" is 0. Over it, the last slot is
 * freed for a "+N more" stub: "shown" holds the first "cap - 1" (worst-and-most-
 * structural-first) and "hiddenCount" covers the rest.
 */
/**
 * A live per-agent expansion folded into the stored neighbour list, one hop only.
 *
 * `live` is api_expandAsset's payload: nodes and edges decoded positionally from a
 * graphSearch traversal that reaches several hops out — a service account's data
 * resources, a deployment's cluster. This list feeds a ONE-HOP map, so only edges incident
 * on the focal node become rels; the deeper nodes are counted and reported in the card's
 * provenance line, and the graph page is where they are actually walkable.
 *
 * Deduped against the stored rels by (node id, edge type). A relationship the last sync
 * already knew about must not appear twice because Wiz confirmed it again — the map would
 * draw two identical spokes and the count above it would be wrong.
 */
export function mergeLiveRels(focal, storedRels, live) {
  var stored = storedRels || [];
  if (!focal || !live || !live.nodes || !live.nodes.length) return stored;
  var byId = new Map(live.nodes.map(function (n) { return [n.id, n]; }));
  var seen = new Set(stored.map(function (r) { return r.node.id + "|" + r.edge.type; }));
  var extra = [];
  for (var e of live.edges || []) {
    if (e.src !== focal.id && e.dst !== focal.id) continue;
    var otherId = e.src === focal.id ? e.dst : e.src;
    var other = byId.get(otherId);
    if (!other || otherId === focal.id) continue;
    var key = otherId + "|" + e.type;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({
      edge: { id: e.id, src: e.src, dst: e.dst, type: e.type },
      node: other,
      direction: e.src === focal.id ? "out" : "in",
    });
  }
  return stored.concat(extra);
}

export function pickEgoNeighbours(rels, cap) {
  var ranked = (rels || []).slice().sort(compareRels);

  var c = Number(cap);
  if (!Number.isFinite(c)) c = 0;

  if (ranked.length <= c) {
    return { shown: ranked, hiddenCount: 0 };
  }
  var shownCount = Math.max(0, c - 1);
  return {
    shown: ranked.slice(0, shownCount),
    hiddenCount: ranked.length - shownCount,
  };
}

// ----------------------------------------------------------------------------- layout

// Ego-graph geometry: the focal record sits at the left, vertically centred; every
// neighbour stacks in ONE column to its right rather than splitting inbound left /
// outbound right, so the picture's width is constant and predictable however many
// neighbours there are. Direction is carried by which end of the curve gets the
// arrowhead instead (see edgeFor's "toFocal"), exactly as the relationship list carries
// it with an arrow glyph.
export const EGO = {
  nodeW: 200,
  nodeH: 40,
  // Applies on all four sides: left/right padding sets minWidth below, top/bottom sets
  // the height floor through the row formula in egoLayout.
  pad: 20,
  // Room for an edge label between the focal box and the neighbour column.
  colGap: 130,
  rowGap: 16,
  // How far a curve's label lifts above the line it annotates.
  labelLift: 6,
  // Where along the curve the label sits. Not the midpoint: every edge leaves the focal
  // box from the same point, so at t=0.5 the labels bunch into the middle third of the
  // height however far apart their rows are. Pushed past halfway they inherit more of the
  // row spacing and land nearer the neighbour each one describes, while still clearing the
  // neighbour column.
  labelAt: 0.62,
  // The narrowest the picture stays legible at: one focal box, the edge-label gap, one
  // neighbour box. Below this the container scrolls rather than the labels shrinking —
  // the same rule scans.js's DIA.minWidth states for the coverage diagram.
  minWidth: 570, // pad*2 + nodeW*2 + colGap = 20*2 + 200*2 + 130
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Horizontal cubic Bézier, same form as scans.js's curve(e): control points pulled in by
// 0.45 of the run so the line leaves and arrives level, with an S-bend between. The label
// point is the curve evaluated at EGO.labelAt — evaluated rather than interpolated along
// the chord, because at that t the S-bend has already carried the curve well clear of the
// straight line between the endpoints, and a label off its own line is worse than none.
function curve(x1, y1, x2, y2) {
  var dx = (x2 - x1) * 0.45;
  var d = "M " + round2(x1) + " " + round2(y1) +
    " C " + round2(x1 + dx) + " " + round2(y1) + ", " + round2(x2 - dx) + " " + round2(y2) +
    ", " + round2(x2) + " " + round2(y2);
  var t = EGO.labelAt;
  var u = 1 - t;
  var b0 = u * u * u;
  var b1 = 3 * u * u * t;
  var b2 = 3 * u * t * t;
  var b3 = t * t * t;
  return {
    d: d,
    labelX: round2(b0 * x1 + b1 * (x1 + dx) + b2 * (x2 - dx) + b3 * x2),
    labelY: round2(b0 * y1 + b1 * y1 + b2 * y2 + b3 * y2 - EGO.labelLift),
  };
}

/**
 * One edge, focal <-> one neighbour box. direction: "in" means the arrow should point
 * AT the focal, so the path is drawn neighbour -> focal (toFocal: true); "out" draws
 * focal -> neighbour. The renderer puts marker-end on the path either way, so the
 * endpoint order alone carries the direction. "rel" is null for the "+N more" summary
 * stub, which draws focal -> stub (there is more of the graph out that way) and carries
 * no edge type.
 */
function edgeFor(rel, fx, fy, nx, ny) {
  var edge = (rel && rel.edge) || {};
  var toFocal = !!rel && rel.direction === "in";

  var x1 = toFocal ? nx : fx;
  var y1 = toFocal ? ny : fy;
  var x2 = toFocal ? fx : nx;
  var y2 = toFocal ? fy : ny;
  var path = curve(x1, y1, x2, y2);

  return {
    d: path.d,
    labelX: path.labelX,
    labelY: path.labelY,
    type: rel ? (edge.type || null) : null,
    negated: rel ? !!edge.negated : false,
    accessType: rel ? (edge.accessType || null) : null,
    toFocal: toFocal,
  };
}

/**
 * Boxes and edges for the ego picture at a given container width. "shown"/"hiddenCount"
 * are pickEgoNeighbours's output; "width" is the container's measured content width in
 * CSS pixels — same convention as scans.js's diagramLayout. The layout is measured, not
 * scaled: below EGO.minWidth this still lays out AT minWidth and hands that back as the
 * result width, so the caller's container scrolls instead of shrinking a label; above it,
 * the neighbour column right-aligns so the extra room lengthens the edges rather than
 * leaving a blank margin.
 *
 * Height is a function of the row count alone, so a skeleton can reserve it exactly
 * before the real data arrives. "rows" counts the shown neighbours plus the "+N more"
 * stub when there is one, and is never less than 1.
 */
export function egoLayout(shown, hiddenCount, width) {
  var neighbours = shown || [];
  var hidden = Number(hiddenCount);
  if (!Number.isFinite(hidden) || hidden < 0) hidden = 0;

  var rows = neighbours.length + (hidden > 0 ? 1 : 0);
  if (rows < 1) rows = 1;
  var height = rows * EGO.nodeH + (rows - 1) * EGO.rowGap + EGO.pad * 2;

  var w = Number(width);
  var layoutWidth = (!Number.isFinite(w) || w < EGO.minWidth) ? EGO.minWidth : w;

  // Right-aligned at layoutWidth - pad - nodeW in both branches: at exactly minWidth
  // that is already where the column sits, so one formula covers "too narrow, scroll"
  // and "wider than needed, stretch the edges" with no separate case for either.
  var neighborX = round2(layoutWidth - EGO.pad - EGO.nodeW);

  var focalY = round2(height / 2 - EGO.nodeH / 2);
  var focal = { x: EGO.pad, y: focalY, w: EGO.nodeW, h: EGO.nodeH };
  var fx = EGO.pad + EGO.nodeW;
  var fy = focalY + EGO.nodeH / 2;

  var nodes = [];
  var edges = [];
  neighbours.forEach(function (rel, i) {
    var y = round2(EGO.pad + i * (EGO.nodeH + EGO.rowGap));
    nodes.push({
      rel: rel, summary: false, count: null, x: neighborX, y: y, w: EGO.nodeW, h: EGO.nodeH,
    });
    edges.push(edgeFor(rel, fx, fy, neighborX, y + EGO.nodeH / 2));
  });

  if (hidden > 0) {
    var sy = round2(EGO.pad + neighbours.length * (EGO.nodeH + EGO.rowGap));
    nodes.push({
      rel: null, summary: true, count: hidden, x: neighborX, y: sy, w: EGO.nodeW, h: EGO.nodeH,
    });
    edges.push(edgeFor(null, fx, fy, neighborX, sy + EGO.nodeH / 2));
  }

  return {
    width: round2(layoutWidth),
    height: round2(height),
    focal: focal,
    nodes: nodes,
    edges: edges,
  };
}
