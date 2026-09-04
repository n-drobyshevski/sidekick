// The record's one-hop neighbourhood, as a picture, for the detail sheet's Connections card.
//
// Not renderGraph: that one is a workbench. It wires wheel-zoom with preventDefault (which
// would swallow the scroll of the pane it sits in), pointer pan, node drag, a document
// keydown handler, a floating zoom toolbar and role="application" — none of it optional —
// and it clears its host. A card wants a picture, so this draws the same node cards
// (graphNode.js, so graph.css dresses both identically) over its own measured layout and
// stops there.
//
// Measured, not scaled, exactly as the scans provenance diagram is: the viewBox is drawn at
// the container's own pixel width and the SVG carries a matching width in px, so the render
// is 1:1 and the labels never shrink. Below the layout's minimum the wrapper scrolls.

import { edgeLabel, svgEl } from "../../../../gas_shared/icons.js";
import { EGO, egoLayout, pickEgoNeighbours } from "./egoLayout.js";
import { drawNodeCard, nodeAriaLabel, truncate } from "./graphNode.js";
import { clear, el } from "./ui.js";

/** Six spokes plus the focal is what stays readable in a card; the rest go behind "+N more". */
const EGO_CAP = 6;
// Marker refs resolve document-wide and the workbench canvas owns "gv-arrow" — the graph
// page can be mounted behind an open sheet.
const ARROW_ID = "ego-arrow";
// Sub-pixel churn and a scrollbar appearing are not resizes worth a rebuild.
const RESIZE_EPSILON = 8;

/**
 * The collapse stub. drawNodeCard's SUMMARY path prints "+N more <kind>" from `summaryOf`,
 * and this stub collapses a mixed set of kinds, so there is no honest value to hand it —
 * drawing the two rows here beats inventing one.
 */
function summaryCard(count) {
  const g = svgEl("g", {
    class: "gnode summary",
    tabindex: "0",
    role: "button",
    "aria-label": count + " more connections, press Enter to see them all",
  });
  g.append(svgEl("rect", {
    class: "gnode-box", x: 0, y: 0, width: EGO.nodeW, height: EGO.nodeH, rx: 8,
  }));
  const name = svgEl("text", { class: "gnode-name", x: 14, y: 17 });
  name.textContent = "+" + count + " more";
  g.append(name);
  const hint = svgEl("text", { class: "gnode-kind", x: 14, y: 31 });
  hint.textContent = "See all relationships";
  g.append(hint);
  return g;
}

/** name, kind, severity … and then what it is to the record this sheet is about. */
function relAriaLabel(rel) {
  const dir = rel.direction === "out" ? "outbound" : "inbound";
  const access = rel.edge.accessType ? " " + rel.edge.accessType : "";
  const absent = rel.edge.negated ? " absent" : "";
  return nodeAriaLabel(rel.node) + ", " + dir + " " + edgeLabel(rel.edge.type) + access + absent;
}

/**
 * A one-hop map of `focal` and `rels` (getAssetDetail's neighbours, uncapped).
 *
 * `onOpen(rel)` steps into a neighbour; `onShowAll()` is where the "+N more" stub leads.
 * Returns the element plus a `destroy` the caller must run on teardown — the sheet's
 * ctx.onDispose does it, since a sheet closes without the route change ui/timing.js waits for.
 */
export function egoGraph(o) {
  const opts = o || {};
  const focal = opts.focal;
  const picked = pickEgoNeighbours(opts.rels, EGO_CAP);
  const total = (opts.rels || []).length;

  const scroll = el("div", { class: "ego-scroll" });

  function build(width) {
    const view = egoLayout(picked.shown, picked.hiddenCount, width);
    const svg = svgEl("svg", {
      class: "ego-map",
      viewBox: "0 0 " + view.width + " " + view.height,
      role: "group",
      focusable: "false",
      "aria-label": "Connection map. " + focal.name + " and " +
        (total === 1 ? "1 connection" : total + " connections") +
        (picked.hiddenCount ? ", " + picked.shown.length + " of them drawn" : "") +
        ". The Relationships section lists every connection with the same information.",
    });
    // In pixels, matching the viewBox, so the render is exactly 1:1. Past the container's
    // width this overflows and the wrapper scrolls, which is the intended narrow behaviour.
    svg.style.width = view.width + "px";

    const marker = svgEl("marker", {
      id: ARROW_ID,
      viewBox: "0 0 8 8",
      refX: "7", refY: "4",
      markerWidth: "7", markerHeight: "7",
      orient: "auto-start-reverse",
    });
    marker.append(svgEl("path", { class: "gv-arrow-head", d: "M0 0 L8 4 L0 8 Z" }));
    const defs = svgEl("defs");
    defs.append(marker);

    const edgeLayer = svgEl("g", { class: "ego-edges" });
    const nodeLayer = svgEl("g", { class: "ego-nodes" });
    svg.append(defs, edgeLayer, nodeLayer);

    for (const e of view.edges) {
      edgeLayer.append(svgEl("path", {
        class: "gedge" + (e.negated ? " negated" : ""),
        d: e.d,
        "marker-end": "url(#" + ARROW_ID + ")",
      }));
      if (!e.type) continue;
      // A negated PROTECTED_BY is the guardrail that ISN'T there; the dashed stroke says so
      // graphically and this says it in words, because a dash pattern alone would not.
      const full = edgeLabel(e.type) +
        (e.accessType ? " [" + e.accessType + "]" : "") +
        (e.negated ? " (absent)" : "");
      const text = svgEl("text", {
        class: "gedge-label", x: e.labelX, y: e.labelY, "text-anchor": "middle",
      });
      // At the narrowest layout the run between the two columns is ~130px, which
      // "has access to sensitive data" overruns into the cards at either end. Clip it there
      // and keep the whole phrase on the tooltip; the node's aria-label carries it too.
      text.textContent = truncate(full, 24);
      if (text.textContent !== full) {
        const title = svgEl("title");
        title.textContent = full;
        text.append(title);
      }
      edgeLayer.append(text);
    }

    // The record the sheet is already about: labelled, but not a control — there is nowhere
    // for it to lead.
    const focalCard = drawNodeCard(focal, { palette: opts.palette, compact: true });
    focalCard.classList.add("is-focal");
    focalCard.setAttribute("role", "img");
    focalCard.setAttribute("transform", "translate(" + view.focal.x + ", " + view.focal.y + ")");
    nodeLayer.append(focalCard);

    for (const n of view.nodes) {
      const card = n.summary
        ? summaryCard(n.count)
        : drawNodeCard(n.rel.node, { palette: opts.palette, compact: true });
      if (!n.summary) {
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", relAriaLabel(n.rel));
      }
      card.setAttribute("transform", "translate(" + n.x + ", " + n.y + ")");
      const open = () => {
        if (n.summary) {
          if (opts.onShowAll) opts.onShowAll();
        } else if (opts.onOpen) {
          opts.onOpen(n.rel);
        }
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        open();
      });
      nodeLayer.append(card);
    }

    clear(scroll).append(svg);

    // A region that scrolls needs its own way in for a keyboard, the way the coverage
    // diagram's wrapper has one — but only when it actually scrolls. The node cards are
    // focusable here (that diagram's are not), so an always-on stop would be a second,
    // usually pointless landing before them.
    const overflows = scroll.scrollWidth > scroll.clientWidth + 1;
    if (overflows) {
      scroll.setAttribute("tabindex", "0");
      scroll.setAttribute("role", "group");
      scroll.setAttribute("aria-label", "Connection map, scrollable");
    } else {
      scroll.removeAttribute("tabindex");
      scroll.removeAttribute("role");
      scroll.removeAttribute("aria-label");
    }
  }

  // Drawn once before insertion so the card is never an empty box the pane can jump into;
  // the first observer callback then corrects it to the real width.
  build(EGO.minWidth);

  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    let lastWidth = 0;
    ro = new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].contentRect;
      if (!box || !box.width) return;
      const width = Math.round(box.width);
      if (Math.abs(width - lastWidth) < RESIZE_EPSILON) return;
      lastWidth = width;
      build(width);
    });
    ro.observe(scroll);
  }

  return {
    node: scroll,
    destroy() {
      if (ro) ro.disconnect();
      ro = null;
    },
  };
}
