// The security-graph renderer: positioned SVG over the server-computed layered
// layout. Zero dependencies — DOM nodes give native focus/keyboard semantics, CSS
// tokens style everything, and nothing animates (reduced-motion safe by default).
//
// Non-color signals everywhere: toxic-combo membership = crimson halo + "TC" badge +
// aria-label suffix; missing guardrail = dashed amber stub + text label; severity =
// dot + label chip. Kind = icon + text label.

import { kindIcon, kindLabel } from "./icons.js";
import { el } from "./ui.js";

// No literal `//` (middlebox guard) — see icons.js for the full note.
const SVG_NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");

const NODE_W = 196;
const NODE_H = 56;

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

function nodeAriaLabel(node) {
  const parts = [kindLabel(node.kind), node.name];
  if (node.severity) parts.push(`severity ${node.severity}`);
  if (node.aars !== undefined && node.aars !== null) {
    parts.push(`AARS ${node.aars}${node.aarsBand ? " " + node.aarsBand : ""}`);
  }
  if ((node.comboGroups || []).length) parts.push("toxic combination member");
  if (node.guardrailMissing) parts.push("no guardrail");
  if (node.kind === "SUMMARY") {
    parts.length = 0;
    parts.push(`${node.summaryCount} more ${kindLabel(node.summaryOf)} nodes, press Enter to expand`);
  }
  return parts.join(", ");
}

/**
 * Render the projection into `container`. `data` is the getGraph payload
 * ({nodes, edges, layout, counts}); handlers: onNodeOpen(node), onSummaryExpand
 * (summaryNode), onEscape(). Returns { focusFirst() }.
 */
export function renderGraph(container, data, handlers = {}) {
  container.textContent = "";
  const { nodes, edges, layout } = data;
  // Displayed positions = computed layout + manual per-node offsets (drag /
  // Shift+arrows). Entries are copies: the layout objects may be shared with
  // the SWR cache and must never be mutated.
  const offsets = data.offsets || new Map();
  const layoutById = new Map(layout.nodes.map((n) => [n.id, n]));
  const pos = new Map(layout.nodes.map((n) => {
    const off = offsets.get(n.id);
    return [n.id, {
      id: n.id,
      lane: n.lane,
      x: n.x + (off ? off.dx : 0),
      y: n.y + (off ? off.dy : 0),
    }];
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const grouped = layout.mode === "grouped";
  const groupBy = (data.options && data.options.groupBy) || "";

  const width = Math.max(layout.width, 640);
  const height = Math.max(layout.height, 360);

  const svg = svgEl("svg", {
    role: "application",
    "aria-label":
      (grouped
        ? "Security graph, nodes clustered into labelled groups. "
        : "Security graph. ") +
      "Tab to enter, arrow keys move between connected nodes, " +
      "Shift plus arrow keys nudge the focused node, " +
      "Enter opens details, Escape leaves the graph.",
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "xMidYMid meet",
  });

  // Arrowhead marker (neutral; inherits nothing meaningful — direction only).
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "gv-arrow", viewBox: "0 0 8 8", refX: "7", refY: "4",
    markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
  });
  marker.append(svgEl("path", { class: "gv-arrow-head", d: "M0 0 L8 4 L0 8 z" }));
  defs.append(marker);
  svg.append(defs);

  const world = svgEl("g");
  svg.append(world);

  // ------------------------------------------------------------- group hulls
  // Grouped mode: a hairline box + muted uppercase label behind each cluster.
  // Quiet by design (Audit Ledger): structure, not color.
  if (grouped && Array.isArray(layout.groups)) {
    const hullLayer = svgEl("g");
    world.append(hullLayer);
    for (const grp of layout.groups) {
      hullLayer.append(svgEl("rect", {
        class: "ggroup-box",
        x: grp.x, y: grp.y, width: grp.width, height: grp.height, rx: 14,
      }));
      const label = svgEl("text", { class: "ggroup-label", x: grp.x + 16, y: grp.y + 20 });
      const name = groupBy === "kind" && grp.key !== "__none__" ? kindLabel(grp.key) : grp.label;
      label.textContent = `${truncate(name, 26)} · ${grp.count}`;
      hullLayer.append(label);
    }
  }

  // ------------------------------------------------------------------- edges
  // Lanes flow left-to-right, so edges anchor on the sides. In grouped mode a
  // mostly-vertical edge anchors top/bottom instead, so it leaves the card
  // through the nearest face rather than looping around it.
  function edgeGeometry(a, b) {
    if (grouped && Math.abs(b.y - a.y) > Math.abs(b.x - a.x)) {
      const topToBottom = a.y <= b.y;
      const y1 = a.y + (topToBottom ? NODE_H / 2 : -NODE_H / 2);
      const y2 = b.y + (topToBottom ? -NODE_H / 2 : NODE_H / 2);
      const midY = (y1 + y2) / 2;
      return {
        d: `M ${a.x} ${y1} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${y2}`,
        labelX: (a.x + b.x) / 2,
        labelY: midY - 4,
      };
    }
    const leftToRight = a.x <= b.x;
    const x1 = a.x + (leftToRight ? NODE_W / 2 : -NODE_W / 2);
    const x2 = b.x + (leftToRight ? -NODE_W / 2 : NODE_W / 2);
    const midX = (x1 + x2) / 2;
    return {
      d: `M ${x1} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${x2} ${b.y}`,
      labelX: midX,
      labelY: (a.y + b.y) / 2 - 4,
    };
  }

  const edgeLayer = svgEl("g");
  world.append(edgeLayer);
  const edgeEls = [];
  const edgesByNode = new Map();
  for (const edge of edges) {
    const a = pos.get(edge.src);
    const b = pos.get(edge.dst);
    if (!a || !b) continue;
    const geo = edgeGeometry(a, b);
    const path = svgEl("path", {
      class: `gedge${edge.negated ? " negated" : ""}`,
      d: geo.d,
      "marker-end": "url(#gv-arrow)",
    });
    const title = svgEl("title");
    title.textContent =
      `${byId.get(edge.src)?.name ?? edge.src} ${edge.type}` +
      `${edge.negated ? " (ABSENT)" : ""}${edge.accessType ? " [" + edge.accessType + "]" : ""} ` +
      `${byId.get(edge.dst)?.name ?? edge.dst}`;
    path.append(title);
    edgeLayer.append(path);

    let labelEl = null;
    if (edge.accessType === "ADMIN" || edge.accessType === "HIGH_PRIVILEGE") {
      labelEl = svgEl("text", {
        class: "gedge-label",
        x: geo.labelX,
        y: geo.labelY,
        "text-anchor": "middle",
      });
      labelEl.textContent = edge.accessType;
      edgeLayer.append(labelEl);
    }

    const rec = { el: path, labelEl, src: edge.src, dst: edge.dst };
    edgeEls.push(rec);
    for (const endpoint of [edge.src, edge.dst]) {
      if (!edgesByNode.has(endpoint)) edgesByNode.set(endpoint, []);
      edgesByNode.get(endpoint).push(rec);
    }
  }

  /** Re-route the edges touching one node after its position changed. */
  function refreshEdges(id) {
    for (const rec of edgesByNode.get(id) ?? []) {
      const a = pos.get(rec.src);
      const b = pos.get(rec.dst);
      if (!a || !b) continue;
      const geo = edgeGeometry(a, b);
      rec.el.setAttribute("d", geo.d);
      if (rec.labelEl) {
        rec.labelEl.setAttribute("x", String(geo.labelX));
        rec.labelEl.setAttribute("y", String(geo.labelY));
      }
    }
  }

  // ------------------------------------------------------------------- nodes
  const nodeLayer = svgEl("g");
  world.append(nodeLayer);
  const nodeEls = new Map();

  for (const node of nodes) {
    const p = pos.get(node.id);
    if (!p) continue;
    const isSummary = node.kind === "SUMMARY";
    const g = svgEl("g", {
      class: `gnode${isSummary ? " summary" : ""}`,
      transform: `translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`,
      tabindex: "-1",
      role: "button",
      "aria-label": nodeAriaLabel(node),
      "data-id": node.id,
    });

    // Toxic-combo halo (behind the card).
    if ((node.comboGroups || []).length && !isSummary) {
      g.append(svgEl("rect", {
        class: "gnode-halo",
        x: -4, y: -4, width: NODE_W + 8, height: NODE_H + 8, rx: 14,
      }));
    }

    g.append(svgEl("rect", {
      class: "gnode-box", x: 0, y: 0, width: NODE_W, height: NODE_H, rx: 10,
    }));

    // Kind icon + labels.
    const icon = kindIcon(node.kind === "SUMMARY" ? "SUMMARY" : node.kind);
    icon.setAttribute("transform", "translate(10, 12)");
    g.append(icon);

    const name = svgEl("text", { class: "gnode-name", x: 34, y: 22 });
    name.textContent = truncate(isSummary ? `${node.name} ${kindLabel(node.summaryOf)}` : node.name, 22);
    g.append(name);

    const kind = svgEl("text", { class: "gnode-kind", x: 34, y: 36 });
    kind.textContent = isSummary ? "Enter to expand" : kindLabel(node.kind).toUpperCase();
    g.append(kind);

    // Severity dot + label (bottom-left) and AARS score (bottom-right).
    if (node.severity && !isSummary) {
      const sevColor = (data.palette && data.palette.colors && data.palette.colors[node.severity]) || "#475569";
      g.append(svgEl("circle", { cx: 40, cy: 46, r: 3.5, fill: sevColor }));
      const sevText = svgEl("text", { class: "gnode-chip-text", x: 47, y: 49.5, fill: sevColor });
      sevText.textContent = node.severity;
      g.append(sevText);
    }
    if (node.aars !== undefined && node.aars !== null && !isSummary) {
      const aars = svgEl("text", {
        class: "gnode-chip-text",
        x: NODE_W - 10, y: 49.5, "text-anchor": "end", fill: "rgba(0,0,0,0.6)",
      });
      aars.textContent = `AARS ${node.aars}`;
      g.append(aars);
    }

    // "TC" toxic-combination badge (top-right corner, on the halo).
    if ((node.comboGroups || []).length && !isSummary) {
      g.append(svgEl("rect", { class: "gnode-tc-badge", x: NODE_W - 26, y: -10, width: 22, height: 15, rx: 4 }));
      const tc = svgEl("text", { class: "gnode-tc-text", x: NODE_W - 15, y: 1, "text-anchor": "middle" });
      tc.textContent = "TC";
      g.append(tc);
    }

    // Missing-guardrail stub: dashed tail + open ring + text (never color-only).
    if (node.guardrailMissing && !isSummary) {
      g.append(svgEl("path", {
        class: "gedge negated",
        d: `M ${NODE_W} ${NODE_H / 2 - 10} h 26`,
      }));
      g.append(svgEl("circle", {
        cx: NODE_W + 32, cy: NODE_H / 2 - 10, r: 5,
        fill: "none", stroke: "var(--sev-high)", "stroke-dasharray": "2 2",
      }));
      const t = svgEl("text", { class: "gnode-noguard-text", x: NODE_W + 4, y: NODE_H / 2 - 16 });
      t.textContent = "no guardrail";
      g.append(t);
    }

    const open = () => {
      if (isSummary) handlers.onSummaryExpand && handlers.onSummaryExpand(node);
      else handlers.onNodeOpen && handlers.onNodeOpen(node);
    };
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      if (suppressClick) return; // the pointerup ended a drag, not a click
      focusNode(node.id);
      open();
    });
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    nodeLayer.append(g);
    nodeEls.set(node.id, g);
  }

  function positionNode(id) {
    const p = pos.get(id);
    nodeEls.get(id).setAttribute("transform", `translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`);
  }

  /** Report a node's displacement from its computed layout position. */
  function commitMove(id) {
    if (!handlers.onNodeMove) return;
    const p = pos.get(id);
    const base = layoutById.get(id);
    handlers.onNodeMove(id, Math.round(p.x - base.x), Math.round(p.y - base.y));
  }

  // --------------------------------------------------------------- node drag
  // Pointer drag repositions a node (a small threshold keeps plain clicks
  // opening the detail sheet); Shift+arrows is the keyboard equivalent below.
  let drag = null;
  let suppressClick = false;

  nodeLayer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const g = e.target.closest(".gnode");
    if (!g) return;
    const id = g.getAttribute("data-id");
    const p = pos.get(id);
    if (!p) return;
    drag = { id, g, sx: e.clientX, sy: e.clientY, baseX: p.x, baseY: p.y, moved: false };
  });
  nodeLayer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dxc = e.clientX - drag.sx;
    const dyc = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dxc, dyc) < 4) return;
      drag.moved = true;
      try { drag.g.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      drag.g.classList.add("dragging");
      nodeLayer.append(drag.g); // paint the dragged node above its siblings
    }
    const rect = svg.getBoundingClientRect();
    const p = pos.get(drag.id);
    p.x = drag.baseX + dxc * (view.w / rect.width);
    p.y = drag.baseY + dyc * (view.h / rect.height);
    positionNode(drag.id);
    refreshEdges(drag.id);
  });
  const endDrag = () => {
    if (!drag) return;
    const { id, g, moved } = drag;
    drag = null;
    g.classList.remove("dragging");
    if (!moved) return;
    suppressClick = true; // the click event fires right after this pointerup
    setTimeout(() => { suppressClick = false; }, 0);
    commitMove(id);
  };
  nodeLayer.addEventListener("pointerup", endDrag);
  nodeLayer.addEventListener("pointercancel", endDrag);

  // ------------------------------------------------------------- zoom & pan
  const view = { x: 0, y: 0, w: width, h: height };
  function applyView() {
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  }
  function zoom(factor, cx, cy) {
    const px = cx === undefined ? view.x + view.w / 2 : cx;
    const py = cy === undefined ? view.y + view.h / 2 : cy;
    const w = Math.max(320, Math.min(width * 3, view.w * factor));
    const h = w * (view.h / view.w);
    view.x = px - ((px - view.x) / view.w) * w;
    view.y = py - ((py - view.y) / view.h) * h;
    view.w = w;
    view.h = h;
    applyView();
  }
  function fit() {
    // Layout bounds, stretched to include manually displaced nodes. With no
    // offsets this is exactly (0, 0, width, height): the layout margin (120)
    // already clears every card's half-extents.
    let x0 = 0;
    let y0 = 0;
    let x1 = width;
    let y1 = height;
    for (const p of pos.values()) {
      x0 = Math.min(x0, p.x - NODE_W / 2 - 20);
      y0 = Math.min(y0, p.y - NODE_H / 2 - 20);
      x1 = Math.max(x1, p.x + NODE_W / 2 + 20);
      y1 = Math.max(y1, p.y + NODE_H / 2 + 20);
    }
    view.x = x0; view.y = y0; view.w = x1 - x0; view.h = y1 - y0;
    applyView();
  }

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const cx = view.x + ((e.clientX - rect.left) / rect.width) * view.w;
    const cy = view.y + ((e.clientY - rect.top) / rect.height) * view.h;
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy);
  }, { passive: false });

  let panFrom = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".gnode")) return;
    panFrom = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add("panning");
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!panFrom) return;
    const rect = svg.getBoundingClientRect();
    view.x = panFrom.vx - ((e.clientX - panFrom.x) / rect.width) * view.w;
    view.y = panFrom.vy - ((e.clientY - panFrom.y) / rect.height) * view.h;
    applyView();
  });
  const endPan = () => {
    panFrom = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointercancel", endPan);

  // ------------------------------------------------------- keyboard walking
  // Roving tabindex: one node is tabbable; arrows walk edges/lanes.
  const orderedIds = layout.nodes.map((n) => n.id).filter((id) => nodeEls.has(id));
  let focusedId = orderedIds[0] || null;

  const adjacency = new Map();
  for (const e2 of edges) {
    if (!adjacency.has(e2.src)) adjacency.set(e2.src, { out: [], in: [] });
    if (!adjacency.has(e2.dst)) adjacency.set(e2.dst, { out: [], in: [] });
    adjacency.get(e2.src).out.push(e2.dst);
    adjacency.get(e2.dst).in.push(e2.src);
  }

  function ensureVisible(id) {
    const p = pos.get(id);
    if (!p) return;
    const margin = NODE_W;
    if (p.x < view.x + margin || p.x > view.x + view.w - margin ||
        p.y < view.y + margin || p.y > view.y + view.h - margin) {
      view.x = p.x - view.w / 2;
      view.y = p.y - view.h / 2;
      applyView();
    }
  }

  function focusNode(id) {
    if (!nodeEls.has(id)) return;
    if (focusedId && nodeEls.has(focusedId)) {
      nodeEls.get(focusedId).setAttribute("tabindex", "-1");
    }
    focusedId = id;
    const g = nodeEls.get(id);
    g.setAttribute("tabindex", "0");
    g.focus();
    ensureVisible(id);
  }

  function laneSibling(id, delta) {
    const me = pos.get(id);
    const lane = orderedIds.filter((other) => pos.get(other).lane === me.lane);
    const idx = lane.indexOf(id);
    return lane[idx + delta] || null;
  }

  function nearestByY(id, candidates) {
    const me = pos.get(id);
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const p = pos.get(c);
      if (!p) continue;
      const d = Math.abs(p.y - me.y);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  svg.addEventListener("keydown", (e) => {
    if (!focusedId) return;
    // Shift+arrows nudge the focused node — the keyboard path for drag.
    const isArrow = e.key === "ArrowRight" || e.key === "ArrowLeft" ||
      e.key === "ArrowUp" || e.key === "ArrowDown";
    if (e.shiftKey && isArrow) {
      e.preventDefault();
      const p = pos.get(focusedId);
      const step = 20;
      if (e.key === "ArrowRight") p.x += step;
      else if (e.key === "ArrowLeft") p.x -= step;
      else if (e.key === "ArrowDown") p.y += step;
      else p.y -= step;
      positionNode(focusedId);
      refreshEdges(focusedId);
      ensureVisible(focusedId);
      commitMove(focusedId);
      return;
    }
    const adj = adjacency.get(focusedId) || { out: [], in: [] };
    let next = null;
    if (e.key === "ArrowRight") {
      next = nearestByY(focusedId, adj.out.filter((id) => pos.get(id) && pos.get(id).x >= pos.get(focusedId).x))
        || nearestByY(focusedId, adj.out);
    } else if (e.key === "ArrowLeft") {
      next = nearestByY(focusedId, adj.in.filter((id) => pos.get(id) && pos.get(id).x <= pos.get(focusedId).x))
        || nearestByY(focusedId, adj.in);
    } else if (e.key === "ArrowDown") {
      next = laneSibling(focusedId, 1);
    } else if (e.key === "ArrowUp") {
      next = laneSibling(focusedId, -1);
    } else if (e.key === "Escape") {
      handlers.onEscape && handlers.onEscape();
      return;
    } else {
      return;
    }
    e.preventDefault();
    if (next) focusNode(next);
  });

  // Make the first node tabbable so Tab enters the graph.
  if (focusedId) nodeEls.get(focusedId).setAttribute("tabindex", "0");

  // Zoom toolbar (HTML overlay, focusable before the SVG).
  const zoomBar = el("div", { class: "graph-zoom" },
    el("button", { "aria-label": "Zoom in", onclick: () => zoom(1 / 1.3) }, "+"),
    el("button", { "aria-label": "Zoom out", onclick: () => zoom(1.3) }, "−"),
    el("button", { "aria-label": "Fit graph to view", onclick: fit }, "Fit"),
  );

  container.append(zoomBar, svg);
  fit();

  // Search highlight: dim non-matching nodes (and edges touching them). The
  // dimming of everything else is the signal; matches keep full treatment.
  function setHighlight(matchIds) {
    for (const [id, g] of nodeEls) {
      g.classList.toggle("dimmed", !!matchIds && !matchIds.has(id));
    }
    for (const e2 of edgeEls) {
      const dim = !!matchIds && (!matchIds.has(e2.src) || !matchIds.has(e2.dst));
      e2.el.classList.toggle("dimmed", dim);
    }
  }

  return {
    focusFirst() {
      if (focusedId) focusNode(focusedId);
    },
    focusNode,
    setHighlight,
  };
}

/**
 * Accessible fallback: the same projection as a sortable table (name, kind,
 * severity, AARS, toxic-combo membership, connection count). Column headers
 * toggle ascending/descending; severity sorts by rank, ties break on name.
 */
export function graphTable(data, handlers = {}) {
  const { nodes, edges } = data;
  const sevOrder = (data.palette && data.palette.order) || [];
  const sevRank = (s) => {
    const i = sevOrder.indexOf(s || "");
    return i === -1 ? sevOrder.length : i;
  };
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
  }
  const rows = nodes
    .filter((n) => n.kind !== "SUMMARY")
    .map((n) => ({
      node: n,
      degree: degree.get(n.id) || 0,
    }));

  // dir: 1 = the column's natural first-click order (worst severity / highest
  // score first, names A-first); -1 flips it. `desc: true` marks columns whose
  // natural order reads as descending (for aria-sort and the glyph).
  const COLS = [
    { key: "name", label: "Name", value: (r) => r.node.name },
    { key: "kind", label: "Kind", value: (r) => kindLabel(r.node.kind) },
    { key: "severity", label: "Severity", value: (r) => sevRank(r.node.severity), desc: true },
    { key: "aars", label: "AARS", value: (r) => -(r.node.aars ?? -1), desc: true },
    { key: "combo", label: "Toxic combo", value: (r) => ((r.node.comboGroups || []).length ? 0 : 1) },
    { key: "guardrail", label: "Guardrail", value: (r) => (r.node.guardrailMissing ? 0 : 1) },
    { key: "degree", label: "Connections", value: (r) => -r.degree, desc: true },
  ];
  let sortKey = null;
  let sortDir = 1;

  const tbody = el("tbody", {});
  const headCells = new Map();

  function rowEl({ node, degree: deg }) {
    return el("tr", {
      class: "clickable",
      tabindex: "0",
      role: "button",
      "aria-label": nodeAriaLabel(node),
      onclick: () => handlers.onNodeOpen && handlers.onNodeOpen(node),
      onkeydown: (e) => {
        if (e.key === "Enter") handlers.onNodeOpen && handlers.onNodeOpen(node);
      },
    },
      el("td", {}, node.name),
      el("td", {}, kindLabel(node.kind)),
      el("td", {}, node.severity || "—"),
      el("td", { class: "num" }, node.aars !== undefined && node.aars !== null
        ? `${node.aars} ${node.aarsBand || ""}` : "—"),
      el("td", {}, (node.comboGroups || []).length ? "TC member" : "—"),
      el("td", {}, node.guardrailMissing ? "missing" : "—"),
      el("td", { class: "num" }, String(deg)),
    );
  }

  function paintRows() {
    let list = rows;
    if (sortKey) {
      const col = COLS.find((c) => c.key === sortKey);
      list = [...rows].sort((a, b) => {
        const va = col.value(a);
        const vb = col.value(b);
        const d = (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
        if (d !== 0) return d;
        return a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0;
      });
    }
    tbody.textContent = "";
    for (const r of list) tbody.append(rowEl(r));
    for (const [key, th] of headCells) {
      const col = COLS.find((c) => c.key === key);
      const descending = col.desc ? sortDir === 1 : sortDir === -1;
      if (key === sortKey) th.setAttribute("aria-sort", descending ? "descending" : "ascending");
      else th.removeAttribute("aria-sort");
      const glyph = th.querySelector(".th-sort-glyph");
      if (glyph) glyph.textContent = key === sortKey ? (descending ? "▼" : "▲") : "";
    }
  }

  const headRow = el("tr", {});
  for (const col of COLS) {
    const th = el("th", { scope: "col" },
      el("button", {
        class: "th-sort",
        onclick: () => {
          if (sortKey === col.key) sortDir = -sortDir;
          else {
            sortKey = col.key;
            sortDir = 1;
          }
          paintRows();
        },
      },
        col.label,
        el("span", { class: "th-sort-glyph", "aria-hidden": "true" }),
      ),
    );
    headCells.set(col.key, th);
    headRow.append(th);
  }
  paintRows();

  return el("div", { class: "table-wrap" },
    el("table", { class: "data" },
      el("thead", {}, headRow),
      tbody,
    ));
}
