// The security-graph renderer: positioned SVG over the server-computed layered
// layout. Zero dependencies — DOM nodes give native focus/keyboard semantics, CSS
// tokens style everything, and nothing animates (reduced-motion safe by default).
//
// Non-color signals everywhere: toxic-combo membership = crimson halo + "TC" badge +
// aria-label suffix; missing guardrail = dashed amber stub + text label; severity =
// dot + label chip. Kind = icon + text label.

import { kindLabel, svgEl } from "./icons.js";
import { el, uiIcon } from "./ui.js";
import { NODE_H, NODE_W, drawNodeCard, truncate } from "./graphNode.js";

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
  // GROUPING IS ORTHOGONAL to the arrangement, so `mode` never says "grouped" — the presence of
  // boxes does. Both facts matter here and they are separate: the boxes decide how edges leave a
  // card, the arrangement decides which way the picture flows.
  const grouped = (layout.groups || []).length > 0;
  // Bands across, and only when they span the canvas. Grouped, they span a box instead and the
  // boxes are packed in two dimensions, so the picture as a whole has no left-to-right flow and
  // keyboard walking takes the same branch every other grouped layout takes.
  const horizontal = layout.mode === "rows" && !grouped;
  // No dominant flow direction: nodes sit all around each other rather than in bands, so an edge
  // can leave a card on any side. True of the free-form arrangements, and true of ANY arrangement
  // once it is inside boxes — an edge between two boxes runs whichever way they were packed.
  const freeForm = grouped
    || layout.mode === "radial" || layout.mode === "organic" || layout.mode === "grid";

  const width = Math.max(layout.width, 640);
  const height = Math.max(layout.height, 360);

  // Nesting is drawn as a box inside a box and announced nowhere else, so the one label
  // that describes the canvas has to say it.
  const nested = grouped && (layout.groups || []).some((g) => g.depth === 1);
  /**
   * The ARRANGEMENT AND THE GROUPING, in the one label that describes the canvas.
   *
   * A sighted reader gets both from the picture; a screen-reader user gets them from here or not
   * at all — and the arrangement changes what the arrow keys mean, since two of them walk its own
   * axis (bands in rows/columns, rings in radial/organic, group members when grouped).
   *
   * TWO CLAUSES, not one sentence chosen from a list. The two are independent now, so any
   * arrangement can be grouped and a fixed list of five sentences would have to spell out ten
   * combinations — and would still say only one of the two things about each.
   */
  const arrangement = layout.mode === "radial"
    ? "nodes on rings by their distance from the highest-risk asset"
    : layout.mode === "organic"
      ? "nodes positioned by their connections so clusters sit together"
      : layout.mode === "grid"
        ? "nodes packed into a dense grid"
        : layout.mode === "lanes"
          ? "nodes in category columns"
          : "nodes in category bands";
  // A third clause for the outlines, when there are any. They are the only thing on the canvas
  // saying which nodes hang together by their edges, and a reader who cannot see them has no other
  // route to it — the count beside each one is decoration to a screen reader, not information.
  const outlined = (layout.clusters || []).length;
  const shape = "Security graph, " + arrangement
    + (nested
      ? ", clustered into labelled groups nested two levels deep"
      : grouped ? ", clustered into labelled groups" : "")
    + (outlined ? `, with ${outlined} connected clusters outlined. ` : ". ");
  const svg = svgEl("svg", {
    role: "application",
    "aria-label": shape +
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
    // Array order is paint order, and the layout emits every parent before the children
    // nested in it — so an inner box lands on top of its parent's wash without either
    // side sorting anything.
    for (const grp of layout.groups) {
      const sub = grp.depth === 1;
      hullLayer.append(svgEl("rect", {
        class: sub ? "ggroup-box is-sub" : "ggroup-box",
        x: grp.x, y: grp.y, width: grp.width, height: grp.height, rx: sub ? 10 : 14,
      }));
      const label = svgEl("text", {
        class: sub ? "ggroup-label is-sub" : "ggroup-label",
        x: grp.x + (sub ? 12 : 16), y: grp.y + (sub ? 17 : 20),
      });
      // Asked of the box, not of the page: the two levels can be different dimensions,
      // so one page-level `groupBy` cannot say how to format both.
      const name = grp.by === "kind" && grp.key !== "__none__" ? kindLabel(grp.key) : grp.label;
      label.textContent = `${truncate(name, sub ? 18 : 26)} · ${grp.count}`;
      hullLayer.append(label);
    }
  }

  // ----------------------------------------------------------- cluster outlines
  // One dashed outline per connected component — the only structure here that is about the EDGES
  // rather than a property or a position. Grouping's boxes partition by cloud or kind and cut
  // straight across connectivity; these say "this much of the picture hangs together".
  //
  // BELOW THE EDGES, deliberately. The evaluation this follows found group overlays are the best
  // encoding for judging membership and cost about a quarter of the accuracy on tasks that mean
  // following a path — which is what this canvas is for. Painting under the links, hairline and
  // unfilled, is the cheapest way to keep the second without giving up the first. The domain does
  // the rest by refusing to emit an outline that would not earn its ink.
  if (Array.isArray(layout.clusters) && layout.clusters.length) {
    const clusterLayer = svgEl("g");
    world.append(clusterLayer);
    for (const cl of layout.clusters) {
      clusterLayer.append(svgEl("path", { class: "gcluster-hull", d: roundedPolygon(cl.points, 14) }));
      // The count, at the polygon's topmost vertex. No name: a component has no name to give —
      // unlike a group box, which is a dimension's value — and "10" beside an outline says the one
      // thing the outline cannot, which is how much of the picture it holds.
      const top = cl.points.reduce((a, b) => (b[1] < a[1] ? b : a));
      const count = svgEl("text", { class: "gcluster-count", x: top[0], y: top[1] - 5 });
      count.textContent = String(cl.count);
      clusterLayer.append(count);
    }
  }

  // ------------------------------------------------------------------- edges
  // Lanes flow left-to-right, so edges anchor on the sides. Where there is no such flow — the
  // free-form arrangements, and anything inside boxes — a mostly-vertical edge anchors top/bottom
  // instead, so it leaves the card through the nearest face rather than looping around it. Radial
  // in particular has edges running in every direction by construction, so side-anchoring alone
  // would send half of them back around the cards they start from.
  function edgeGeometry(a, b) {
    if (freeForm && Math.abs(b.y - a.y) > Math.abs(b.x - a.x)) {
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
    const g = drawNodeCard(node, { palette: data.palette });
    g.setAttribute("transform", "translate(" + (p.x - NODE_W / 2) + ", " + (p.y - NODE_H / 2) + ")");

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
  // True while the view is exactly what fit() produced — i.e. the user has not zoomed or
  // panned since. It decides what a container resize should do: an untouched view refits
  // (docking the filter panel must not slice the picture in half), while a view someone
  // has framed themselves keeps its scale and centre.
  let atFit = false;
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
    atFit = false;
    applyView();
    paintZoom();
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
    atFit = true;
    applyView();
    paintZoom();
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
    atFit = false;
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

  function nearestByX(id, candidates) {
    const me = pos.get(id);
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const p = pos.get(c);
      if (!p) continue;
      const d = Math.abs(p.x - me.x);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  }

  svg.addEventListener("keydown", (e) => {
    // Zoom keys sit ABOVE the focusedId guard: the canvas is zoomable whether or not a
    // node happens to hold the roving tabindex, and `+` needs Shift on most layouts, so
    // `=` counts too. The graph was walkable and nudgeable by keyboard but not zoomable.
    if (!e.shiftKey || e.key === "+") {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1 / 1.3); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoom(1.3); return; }
      if (e.key === "0") { e.preventDefault(); fit(); return; }
    }
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
    if (horizontal) {
      if (e.key === "ArrowDown") {
        next = nearestByX(focusedId, adj.out.filter((id) => pos.get(id) && pos.get(id).y >= pos.get(focusedId).y))
          || nearestByX(focusedId, adj.out);
      } else if (e.key === "ArrowUp") {
        next = nearestByX(focusedId, adj.in.filter((id) => pos.get(id) && pos.get(id).y <= pos.get(focusedId).y))
          || nearestByX(focusedId, adj.in);
      } else if (e.key === "ArrowRight") {
        next = laneSibling(focusedId, 1);
      } else if (e.key === "ArrowLeft") {
        next = laneSibling(focusedId, -1);
      } else if (e.key === "Escape") {
        handlers.onEscape && handlers.onEscape();
        return;
      } else {
        return;
      }
    } else {
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
    }
    e.preventDefault();
    if (next) focusNode(next);
  });

  // Make the first node tabbable so Tab enters the graph.
  if (focusedId) nodeEls.get(focusedId).setAttribute("tabindex", "0");

  // Zoom rail (HTML overlay, focusable before the SVG): a column of round icon buttons at the
  // canvas's bottom-left, with Fit set off below the scale as the separate thing it is. `+`
  // above `−` is the way every map puts it, and the way the reference does.
  //
  // The scale keeps its `role="group"` because the readout's accessible name hangs off it (see
  // paintZoom). It does NOT keep the `segmented` class: that recipe joins its children into one
  // capsule with `overflow: hidden`, a shared radius and hairline dividers, and styles an
  // `aria-pressed` state these buttons never set — none of which a rail of separate circles
  // wants, and it is shared with five real `segmented()` controls that must not inherit the fix.
  //
  // The percent is the on-screen scale, not the viewBox ratio — preserveAspectRatio letterboxes,
  // so the two disagree whenever the container and the view have different aspects.
  const zoomPct = el("span", { class: "graph-zoom-pct num" }, "100%");
  const zoomGroup = el("div", { class: "graph-zoom-scale", role: "group" },
    el("button", {
      "aria-label": "Zoom in", title: "Zoom in (+)", onclick: () => zoom(1 / 1.3),
    }, uiIcon("plus", 15)),
    zoomPct,
    el("button", {
      "aria-label": "Zoom out", title: "Zoom out (−)", onclick: () => zoom(1.3),
    }, uiIcon("minus", 15)),
  );
  const zoomBar = el("div", { class: "graph-zoom" },
    zoomGroup,
    // An explicit name, not just the title: the glyph is `aria-hidden`, so without this the
    // button that used to be called "Fit" by its own text would have no accessible name at all.
    el("button", {
      class: "graph-zoom-fit", "aria-label": "Fit graph to view",
      title: "Fit graph to view (0)", onclick: fit,
    }, uiIcon("fit", 15)),
  );

  /**
   * Repaint the readout. Called from zoom() and fit() only — never from applyView(),
   * which runs on every pointermove during a pan. The value rides the group's accessible
   * name rather than a live region for the same reason: a polite region on a wheel-zoom
   * would queue one announcement per tick.
   */
  function paintZoom() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !view.w) return;
    const scale = Math.min(rect.width / view.w, rect.height / view.h);
    const pct = Math.round(scale * 100);
    zoomPct.textContent = `${pct}%`;
    zoomGroup.setAttribute("aria-label", `Zoom, ${pct} percent`);
  }

  // The rail can be hosted OUTSIDE this container. It has to be, for anything on it that
  // opens a popover: every layout change repaints the canvas, `container.textContent = ""`
  // detaches the anchor, and an anchored popover measures a detached rect and dismisses
  // itself — so a live-apply control in the rail would die on its own first click.
  // Hosted: the page owns the rail and we refill our slot. Unhosted: as before, and the
  // zoom buttons alone are safe either way because they open nothing.
  if (handlers.railZoomHost) {
    handlers.railZoomHost.textContent = "";
    handlers.railZoomHost.append(zoomBar);
    container.append(svg);
  } else {
    container.append(zoomBar, svg);
  }
  fit();

  // The viewBox is fixed at first paint, so every later geometry change — window resize,
  // the rail collapsing, the filter panel docking — left it stale and let
  // preserveAspectRatio letterbox the picture off its framing. Re-derive the view's height
  // from the container's new aspect around the current centre, which preserves the
  // on-screen scale rather than snapping back to fit and fighting a user who has zoomed in.
  let lastW = 0;
  let lastH = 0;
  const ro = new ResizeObserver((entries) => {
    const box = entries[0] && entries[0].contentRect;
    if (!box || !box.width || !box.height) return;
    // The observer fires once on observe(), immediately after fit() — nothing to correct.
    if (!lastW) { lastW = box.width; lastH = box.height; return; }
    if (Math.abs(box.width - lastW) < 1 && Math.abs(box.height - lastH) < 1) return;
    const scale = Math.min(lastW / view.w, lastH / view.h);
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    lastW = box.width;
    lastH = box.height;
    if (atFit) { fit(); return; }
    view.w = box.width / scale;
    view.h = box.height / scale;
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
    applyView();
    paintZoom();
  });
  ro.observe(container);

  return {
    focusFirst() {
      if (focusedId) focusNode(focusedId);
    },
    focusNode,
    /**
     * Release the ResizeObserver. The page clears and re-renders the canvas on every
     * filter change; without this each render leaves an observer attached to a container
     * that outlives it, holding the whole payload behind it.
     */
    destroy() { ro.disconnect(); },
  };
}

/**
 * A closed polygon path with its corners cut by quadratic curves.
 *
 * A convex hull over card corners is all right angles and long straight runs, and drawn as-is it
 * reads as a BOX — which is what the group boxes already are, and the two would then say the same
 * thing in the same shape. Rounding is the whole visual difference between "the cloud you grouped
 * by" and "these happen to be connected".
 *
 * The radius is clamped per corner to a third of the shorter adjacent edge, so a short edge between
 * two corners cannot have both of them eat past its middle and invert the curve. Same bezier idiom
 * as `edgeGeometry` above and `egoLayout.js`.
 */
function roundedPolygon(points, radius) {
  const n = points.length;
  if (n < 3) return "";
  const at = (i) => points[(i + n) % n];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const parts = [];
  for (let i = 0; i < n; i++) {
    const prev = at(i - 1);
    const cur = at(i);
    const next = at(i + 1);
    const lenPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    const lenNext = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    const r = Math.min(radius, lenPrev / 3, lenNext / 3);
    const from = lerp(cur, prev, r / lenPrev);
    const to = lerp(cur, next, r / lenNext);
    parts.push(`${i === 0 ? "M" : "L"} ${round1(from[0])} ${round1(from[1])}`);
    parts.push(`Q ${round1(cur[0])} ${round1(cur[1])}, ${round1(to[0])} ${round1(to[1])}`);
  }
  return parts.join(" ") + " Z";
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
