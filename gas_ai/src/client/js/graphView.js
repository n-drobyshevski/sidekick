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
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const width = Math.max(layout.width, 640);
  const height = Math.max(layout.height, 360);

  const svg = svgEl("svg", {
    role: "application",
    "aria-label":
      "Security graph. Tab to enter, arrow keys move between connected nodes, " +
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
  marker.append(svgEl("path", { d: "M0 0 L8 4 L0 8 z", fill: "rgba(0,0,0,0.3)" }));
  defs.append(marker);
  svg.append(defs);

  const world = svgEl("g");
  svg.append(world);

  // ------------------------------------------------------------------- edges
  const edgeLayer = svgEl("g");
  world.append(edgeLayer);
  for (const edge of edges) {
    const a = pos.get(edge.src);
    const b = pos.get(edge.dst);
    if (!a || !b) continue;
    const leftToRight = a.x <= b.x;
    const x1 = a.x + (leftToRight ? NODE_W / 2 : -NODE_W / 2);
    const x2 = b.x + (leftToRight ? -NODE_W / 2 : NODE_W / 2);
    const midX = (x1 + x2) / 2;
    const path = svgEl("path", {
      class: `gedge${edge.negated ? " negated" : ""}`,
      d: `M ${x1} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${x2} ${b.y}`,
      "marker-end": "url(#gv-arrow)",
    });
    const title = svgEl("title");
    title.textContent =
      `${byId.get(edge.src)?.name ?? edge.src} ${edge.type}` +
      `${edge.negated ? " (ABSENT)" : ""}${edge.accessType ? " [" + edge.accessType + "]" : ""} ` +
      `${byId.get(edge.dst)?.name ?? edge.dst}`;
    path.append(title);
    edgeLayer.append(path);

    if (edge.accessType === "ADMIN" || edge.accessType === "HIGH_PRIVILEGE") {
      const label = svgEl("text", {
        class: "gedge-label",
        x: midX,
        y: (a.y + b.y) / 2 - 4,
        "text-anchor": "middle",
      });
      label.textContent = edge.accessType;
      edgeLayer.append(label);
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
    view.x = 0; view.y = 0; view.w = width; view.h = height;
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

  return {
    focusFirst() {
      if (focusedId) focusNode(focusedId);
    },
  };
}

/**
 * Accessible fallback: the same projection as a sortable table (name, kind,
 * severity, AARS, toxic-combo membership, connection count).
 */
export function graphTable(data, handlers = {}) {
  const { nodes, edges } = data;
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

  const tbody = el("tbody", {});
  for (const { node, degree: deg } of rows) {
    const tr = el("tr", {
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
    tbody.append(tr);
  }

  return el("div", { class: "table-wrap" },
    el("table", { class: "data" },
      el("thead", {},
        el("tr", {},
          el("th", {}, "Name"),
          el("th", {}, "Kind"),
          el("th", {}, "Severity"),
          el("th", {}, "AARS"),
          el("th", {}, "Toxic combo"),
          el("th", {}, "Guardrail"),
          el("th", {}, "Connections"),
        )),
      tbody,
    ));
}
