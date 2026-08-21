// Wiz Scans: the coverage instrument. What Wiz is asked for on every sync, how much of it
// this tenant actually reports, and which screen each answer lands on.
//
// The page reads in three parts. A posture header states coverage as one number. A
// provenance diagram draws the path — every scan area, one sync, the screens they land on
// — with each node carrying the state its resolver earned. A register underneath carries
// the auditable detail, one row per area, opening a detail sheet with the prose and the
// query. (Counts are deliberately absent from the prose in this file; see the note on the
// header sentence below for what happens when they are not.)
//
// Two deliberate calls worth knowing before you edit this file:
//
// 1. THE DIAGRAM IS role="img", AND THE REGISTER IS ITS KEYBOARD PATH. The register holds
//    every tab stop; the SVG is a labelled picture that a screen reader never enters. The
//    graph page earns its roving-tabindex canvas because the thing it draws is unbounded
//    and is the only view of that data. Here the whole content is one row per area, and
//    those rows are already on screen as a table — a second, different keyboard model for
//    the same facts is the invented control PRODUCT.md warns about. The link runs the
//    other way instead:
//    hovering or focusing a register row lights its node and its edges.
//
// 2. COVERAGE IS NOT SEVERITY, so it does not borrow the severity components. sevSegmentBar
//    and sevKeyRow emit `sev-fill-X` / `sev-X` classes and print the level as the key's
//    label; feeding them "live"/"partial"/"unscanned" would mint three fake severity levels
//    in a codebase where `sev-*` means exactly one thing. The bar and keys here are ~20
//    lines of page-local markup on the same visual recipe, which is cheaper than the
//    confusion.

import { call } from "../api.js";
import { bootstrap, bootstrapCached, swrCall } from "../store.js";
import {
  COVERAGE, COVERAGE_ORDER, DESTINATIONS, SCAN_AREAS,
  coverageTally, destinationOf, rankAreas, resolveAreas,
} from "../scanContent.js";
import { svgEl } from "../icons.js";
import { openAreaSheet } from "./scanSheet.js";
import {
  clear, closeActiveSheet, dataTable, el, emptyState, errorState, fmtDate, fmtDateTime,
  meter, motionOk, onPageTeardown, plural, registerWideNote, sectionLabel, skeleton, statRow,
} from "../ui.js";
import { AXIS_KNOWN_WARNING, REACH_AXES, REACH_VS_SCAN_AREA_NOTE } from "../reachContent.js";

// Only the whole-landscape head of api_getAssets is read (kpis, total) — never `rows`. Past
// the server's row ceiling the payload downgrades to a single page, but the head still
// describes the landscape, so a small pageSize keeps this page correct AND cheap at any size.
const ASSETS_PARAMS = { all: true, pageSize: 25 };

export async function renderScans(main, params, ctx) {
  // A sheet left open by the previous render of this route belongs to that render.
  closeActiveSheet();

  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Wiz Scans"),
    el("p", { class: "page-sub" },
      // Counted, not typed. This sentence said "nine" while the page rendered ten areas —
      // the exact class of drift the rest of this page exists to refuse, and it only takes
      // one area being added anywhere for a hand-typed number to start lying.
      "Every figure in this dashboard traces back to one of " + SCAN_AREAS.length +
      " Wiz scan areas. This is what each one is asked for, what it reported, and where " +
      "the answer lands."),
    // "what it reported in this tenant" used to end that sentence, and a project view made it
    // false — the figures below come from scoped endpoints. The split is the point and it is
    // not obvious: the STEPS are a description of the sync battery and never move, while the
    // FIGURES beside them follow the switcher like every other page.
    registerWideNote(bootstrapCached(),
      "the steps describe the sync battery; the figures beside them follow the project view"),
  );

  if (!boot.latestSync) {
    main.append(emptyState(
      "No sync yet.",
      "Run “Sync now” in the sidebar — without credentials it loads the sample dataset.",
    ));
    return;
  }

  const host = el("div", {});
  main.append(host);
  host.append(scansSkeleton());

  let assets = null;
  let combos = null;
  let queries = null;
  let combosError = "";
  let anchored = false;

  const settled = await Promise.allSettled([
    swrCall("api_getAssets", ASSETS_PARAMS, (fresh) => { assets = fresh; paint(); }),
    swrCall("api_getToxicCombos", {}, (fresh) => { combos = fresh; paint(); }),
    // Not SWR: this describes the battery as configured right now, and the panel states it
    // to the operator as fact. A cached answer is a claim about a query that may have moved.
    call("api_getScanQueries", {}),
  ]);

  if (settled[0].status === "rejected") {
    const e = settled[0].reason;
    clear(host).append(errorState("Couldn't load scan coverage.", {
      detail: String((e && e.message) || e),
      onRetry: () => renderScans(clear(main), params, ctx),
    }));
    return;
  }
  assets = settled[0].value;

  // A page about coverage that blanks itself because one of its areas failed is telling
  // the wrong story. The toxic area resolves to `partial` on its own, and the failure is
  // named in its detail sheet rather than swallowed.
  if (settled[1].status === "fulfilled") combos = settled[1].value;
  else combosError = String((settled[1].reason && settled[1].reason.message) || settled[1].reason);
  // The queries are drill-down detail, not the page. Losing them costs the panel its query
  // sections and nothing else, so a failure here must not blank the coverage picture.
  if (settled[2].status === "fulfilled") queries = settled[2].value;

  paint();

  function paint() {
    if (!assets) return;
    const payload = {
      boot,
      kpis: assets.kpis || null,
      total: assets.total || 0,
      digest: (combos && combos.digest) || null,
    };
    const resolved = resolveAreas(payload);
    const tally = coverageTally(resolved);
    const ranked = rankAreas(resolved);

    clear(host);
    const diagram = provenanceDiagram(ranked, tally);
    host.append(
      postureHeader(resolved, tally),
      sectionLabel("How a scan becomes a screen"),
      diagram.node,
      diagramLegend(tally),
      sectionLabel("The register"),
      register(ranked, diagram),
      el("p", { class: "small muted", style: "margin-top:14px" },
        "Sync cadence: daily at 05:00 UTC plus on-demand “Sync now”. Every figure above " +
        "is the one the last sync produced, read through the project view currently set; " +
        "an area with no figure says so rather than carrying a number from somewhere else."),
      el("p", { class: "small muted cov-diagram-note" }, REACH_VS_SCAN_AREA_NOTE),
      reachSection(assets.reach),
    );
    // A link from AI Inventory's headline figure sends the reader here with ?anchor=reach —
    // only worth honouring once, on the render that actually has the section to jump to,
    // not on every SWR repaint that follows it.
    if (params && params.anchor === "reach" && !anchored) {
      anchored = true;
      const target = document.getElementById("scan-reach-section");
      if (target) {
        target.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "start" });
        target.focus({ preventScroll: true });
      }
    }
  }

  // ---------------------------------------------------------------- posture header
  function postureHeader(resolved, tally) {
    const sync = boot.latestSync || {};
    const dryRun = String(sync.mode || "") === "dry-run";

    const hero = el("div", { class: "cov-hero" },
      el("div", { class: "kpi-label" }, "Reporting"),
      el("div", { class: "hero-value num" }, tally.live + " of " + resolved.length),
      el("div", { class: "cov-hero-sub" }, "scan areas returning a live figure"),
    );

    const strip = el("div", { class: "cov-strip" },
      el("div", { class: "kpi-label" }, "Coverage"),
      coverageBar(tally, resolved.length),
      coverageKeys(tally),
      el("p", { class: "cov-strip-note" },
        "Every state is inferred from whether the last sync produced a figure — not from " +
        "a per-step record of what ran."),
    );

    const stats = el("div", { class: "stat-list" },
      statRow("Last sync", fmtDate(sync.finished_at),
        fmtDateTime(sync.finished_at)),
      statRow("Mode", dryRun ? "Dry-run" : "Live",
        dryRun ? "bundled sample dataset" : "against the configured Wiz tenant"),
      statRow("Records written", String(sync.node_count || 0),
        "assets · " + (sync.edge_count || 0) + " edges · " + (sync.issue_count || 0) + " issues"),
      statRow("Wiz API calls", String(sync.api_calls || 0), "in that sync"),
    );

    return el("div", { class: "cov-header" }, hero, strip, stats);
  }

  // The bar is decoration — the keys beneath carry the same three numbers as text — so it
  // is aria-hidden rather than a second announcement of what was just read out.
  function coverageBar(tally, total) {
    const bar = el("div", { class: "cov-bar", "aria-hidden": "true" });
    for (const state of COVERAGE_ORDER) {
      if (!tally[state]) continue;
      const seg = el("div", { class: "cov-bar-seg", "data-state": state });
      seg.style.flexGrow = String(tally[state]);
      bar.append(seg);
    }
    if (!total) bar.append(el("div", { class: "cov-bar-seg", "data-state": "empty" }));
    return bar;
  }

  function coverageKeys(tally) {
    const row = el("div", { class: "cov-keys" });
    for (const state of COVERAGE_ORDER) {
      const meta = COVERAGE[state];
      row.append(el("span", { class: "cov-key", "data-state": state },
        el("span", { class: "cov-key-glyph", "aria-hidden": "true" }, meta.glyph),
        el("span", {}, meta.label),
        el("span", { class: "cov-key-num num" }, String(tally[state])),
      ));
    }
    return row;
  }

  function diagramLegend(tally) {
    return el("p", { class: "small muted cov-diagram-note" },
      COVERAGE.live.glyph + " " + COVERAGE.live.blurb + " · " +
      COVERAGE.partial.glyph + " " + COVERAGE.partial.blurb + " · " +
      COVERAGE.unscanned.glyph + " " + COVERAGE.unscanned.blurb +
      ". A dashed node and edge mark a path that would exist if the query ran. " +
      plural(tally.live + tally.partial, "area") + " feed the sync.");
  }

  // ------------------------------------------------------------------- the register
  function register(ranked, diagram) {
    const table = dataTable({
      className: "cov-register",
      columns: [
        { key: "area", label: "Scan area", cell: (a) => el("span", { class: "cov-area" }, a.title) },
        { key: "query", label: "Wiz query", cell: (a) => el("span", { class: "cov-q" }, a.query) },
        { key: "figure", label: "Reported here", cell: figureCell },
        {
          key: "lands", label: "Lands in",
          cell: (a) => {
            const dest = destinationOf(a);
            return dest && a.state !== "unscanned"
              ? el("span", { class: "cov-lands" }, dest.title)
              : el("span", { class: "cov-none" }, "—");
          },
        },
        { key: "state", label: "State", cell: (a) => statePill(a.state) },
      ],
      rows: ranked,
      onRowOpen: (a) => openAreaSheet(a, sheetContext()),
      rowLabel: (a) => a.title + ", " + COVERAGE[a.state].label +
        (a.figure ? ", " + a.figure.value + " " + a.figure.unit : ""),
    });

    // The register drives the diagram, not the other way round: one keyboard model, and
    // the picture reacts to whatever already has focus.
    const rows = table.querySelectorAll("tbody tr");
    ranked.forEach((area, i) => {
      const row = rows[i];
      if (!row) return;
      const light = () => diagram.light(area.id);
      const dim = () => diagram.light("");
      row.addEventListener("mouseenter", light);
      row.addEventListener("mouseleave", dim);
      row.addEventListener("focusin", light);
      row.addEventListener("focusout", dim);
    });
    return table;
  }

  function figureCell(area) {
    if (!area.figure) {
      return el("span", { class: "cov-none" }, "—");
    }
    return el("span", { class: "cov-figure" },
      el("span", { class: "cov-figure-value num" }, area.figure.value),
      el("span", { class: "cov-figure-unit" }, area.figure.unit),
    );
  }

  function statePill(state) {
    const meta = COVERAGE[state];
    return el("span", { class: "pill " + meta.pill + " cov-state" },
      el("span", { class: "cov-state-glyph", "aria-hidden": "true" }, meta.glyph),
      meta.label);
  }

  // ------------------------------------------------------------------ landscape reach
  function reachSection(reach) {
    const wrap = el("div", {
      id: "scan-reach-section", class: "reach-wrap", tabindex: "-1",
      "aria-label": "Landscape reach",
    });
    if (!reach) {
      wrap.append(
        sectionLabel("Landscape reach"),
        emptyState("Not available.", "This server build did not report a reach payload."),
      );
      return wrap;
    }

    wrap.append(
      sectionLabel("Landscape reach"),
      el("p", { class: "page-sub" },
        "Of everything on the AI register, how much did the pipeline actually touch — five " +
        "paired counts, never a bare percentage, because an empty denominator is a fact " +
        "worth showing, not a number to divide by."),
      reachLadder(reach.stages),
      sectionLabel("By kind"),
      reachKindSummary(reach),
      reachKindTable(reach.kinds),
      sectionLabel("Edge census"),
      reachEdgeCensus(reach.edges),
      reachImpactTagged(reach.impactTagged),
      sectionLabel("Decision-tree axis coverage"),
      el("p", { class: "cov-note" }, AXIS_KNOWN_WARNING),
      reachAxes(reach.axes, reach.axesPopulation),
    );
    return wrap;
  }

  function reachLadder(stages) {
    const rows = stages.map((s) => {
      const known = s.total > 0;
      const pct = known ? Math.round((s.covered / s.total) * 100) : null;
      return el("div", { class: "reach-stage" },
        el("div", { class: "reach-stage-label" }, s.label),
        el("div", { class: "reach-stage-figure" },
          el("span", { class: "reach-stage-count num" },
            known ? s.covered + " of " + s.total : "—"),
          known
            ? meter(pct, {
              decorative: true, className: "meter--flex",
              label: s.label + ", " + pct + " percent",
            })
            : el("span", { class: "reach-stage-bar-empty", "aria-hidden": "true" }),
        ),
        el("div", { class: "reach-stage-pct" }, known ? pct + "%" : "no data"),
      );
    });
    return el("div", { class: "reach-ladder" }, ...rows);
  }

  /**
   * Business-impact tagging, BESIDE the ladder rather than in it.
   *
   * It was a fifth stage until a live tenant printed 95% attributed directly above 1%
   * observed. businessImpact is folded from the asset's own projects on the mandatory
   * inventory hop, so it needs no traversal and reads high on a landscape where nothing was
   * traversed at all — a stage that does not depend on the ones above it is not a funnel
   * stage, and rendering it as one made the panel claim work the pipeline had not done.
   */
  function reachImpactTagged(tagged) {
    if (!tagged) return null;
    const known = tagged.total > 0;
    const pct = known ? Math.round((tagged.covered / tagged.total) * 100) : null;
    return el("div", { class: "card stat-list" },
      statRow(
        "Impact-tagged",
        known ? tagged.covered + " of " + tagged.total : "—",
        "carry a Wiz business-impact tier — read off the asset's own projects on the "
        + "inventory hop, so this measures the tenant's tagging discipline, not what this "
        + "pipeline reached",
        pct,
      ),
    );
  }

  function reachKindSummary(reach) {
    const register = reach.stages.find((s) => s.key === "register");
    const aiKinds = reach.kinds.filter((k) => k.ai).sort((a, b) => b.total - a.total);
    const largest = aiKinds[0];
    const share = register && register.total
      ? Math.round((register.covered / register.total) * 100)
      : null;
    const parts = [
      register
        ? (share === null ? "—" : share + "%") + " of every register row is AI-kinded"
          + (register.total ? " (" + register.covered + " of " + register.total + ")" : "")
        : null,
      largest
        ? "the largest AI kind is " + largest.kind + " at " + largest.total + " rows, "
          + largest.signal + " of them carrying signal"
        : "no AI-kinded row is on the register",
    ].filter(Boolean);
    return el("p", { class: "page-sub" }, parts.join(" — ") + ".");
  }

  function reachKindTable(kinds) {
    return dataTable({
      className: "reach-kinds",
      columns: [
        {
          key: "kind", label: "Kind",
          cell: (k) => el("span", { class: k.ai ? "reach-kind-ai" : "" }, k.kind),
        },
        { key: "total", label: "Rows", cell: (k) => el("span", { class: "num" }, String(k.total)) },
        {
          key: "signal", label: "Carrying signal",
          cell: (k) => el("span", { class: "num" }, k.signal + " of " + k.total),
        },
        {
          key: "ai", label: "AI landscape",
          cell: (k) => (k.ai
            ? el("span", { class: "pill ok" }, "AI")
            : el("span", { class: "cov-none" }, "substrate")),
        },
      ],
      rows: kinds,
      rowLabel: (k) => k.kind + ", " + k.total + " rows, " + k.signal + " carrying signal, "
        + (k.ai ? "AI-kinded" : "substrate"),
    });
  }

  function reachEdgeCensus(edges) {
    const wrap = el("div", { class: "reach-edges" });
    wrap.append(
      el("p", { class: "page-sub" },
        edges.populated.length + " of " + edges.declared + " relationship types populated " +
        "on this landscape's persisted graph."),
      el("div", { class: "chipset" },
        ...edges.populated.map((t) => el("span", { class: "chip" }, t)),
        !edges.populated.length ? el("span", { class: "chipset-empty" }, "none populated") : null,
      ),
    );
    // Two lists, deliberately not one. A type drawn at graph-read time is correctly absent
    // from the persisted tab and its absence is not a gap; showing it beside a type nothing
    // anywhere constructs would inflate the finding and teach a reader to discount the
    // number — the same false reading this panel exists to refuse, pointed the other way.
    if (edges.dead.length) {
      wrap.append(
        el("p", { class: "small muted", style: "margin-top:8px" },
          "Declared but produced by nothing — each one is a class of question this product " +
          "looks able to answer and cannot:"),
        el("div", { class: "chipset" },
          ...edges.dead.map((t) => el("span", { class: "chip reach-chip-dead" }, t)),
        ),
      );
    }
    if (edges.synthetic.length) {
      wrap.append(
        el("p", { class: "small muted", style: "margin-top:8px" },
          "Drawn at read time rather than stored, so absent here by design — not a gap:"),
        el("div", { class: "chipset" },
          ...edges.synthetic.map((t) => el("span", { class: "chip" }, t)),
        ),
      );
    }
    return wrap;
  }

  function reachAxes(axes, population) {
    const list = el("div", { class: "card stat-list" });
    for (const axis of REACH_AXES) {
      const known = population > 0;
      const pct = known ? Math.round(axes[axis.key] * 100) : null;
      list.append(statRow(
        axis.label,
        known ? pct + "%" : "—",
        known ? "known, of " + population + " decided" : "nothing decided yet",
        known ? pct : null,
      ));
    }
    return list;
  }

  /**
   * What the drill-down needs that the page already has. Rebuilt per open so a sheet always
   * describes the payload on screen, and `refresh` re-reads after a variables save.
   */
  function sheetContext() {
    return {
      steps: (queries && queries.steps) || [],
      specs: (queries && queries.specs) || [],
      skippedSteps: (queries && queries.skippedSteps) || [],
      truncatedSteps: (queries && queries.truncatedSteps) || [],
      // Left as an EMPTY OBJECT when absent, never defaulted per-step to 0: an id missing
      // from this map means the last sync predates the recording, which is a different
      // statement from "this step returned no rows". See settingsLogic.getStepRows.
      stepRows: (queries && queries.stepRows) || {},
      skipReasons: (queries && queries.skipReasons) || {},
      transportVariables: (queries && queries.transportVariables) || [],
      hasCredentials: queries ? queries.hasCredentials : boot.hasCredentials,
      combosError,
      destinationOf,
      refresh: () => renderScans(clear(main), params, ctx),
    };
  }
}

// ------------------------------------------------------------------------ the diagram
//
// Geometry is a function of the area list and the destination list, so adding a tenth
// scan area moves everything without a coordinate edit anywhere.

const DIA = {
  // The narrowest the picture stays legible at. Below this the container scrolls rather
  // than scaling the labels down.
  minWidth: 700,
  top: 14,
  bottom: 12,
  // One line per source. The figure sits on the title's row, right-aligned, so a node is a
  // row rather than a card — which is what takes the height out: a two-line card ran 46px
  // of node before any padding, a row runs 22. Stated PER NODE rather than as a total,
  // because a total is a number that goes stale the next time an area is added.
  nodeH: 22,
  gap: 4,
  destH: 40,
  // The spine is a WAIST, not a wall. It stands shorter than the run of sources and takes
  // their edges through the middle of its face, so the picture reads as many things
  // converging into one — which is what a sync is. Distributing the entry points across
  // the full height instead drew a row of parallel lines that happened to stop at a box.
  spineSpan: 0.62,
  spineMinH: 92,
  inFan: 0.62,
  outFan: 0.36,
  destSpan: 0.9,
};

const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));

/** Height is a function of the area count alone, so the skeleton can reserve it exactly. */
export function diagramHeight(count) {
  return DIA.top + count * (DIA.nodeH + DIA.gap) - DIA.gap + DIA.bottom;
}

/**
 * Geometry for a given rendered width, in CSS pixels — the viewBox is then set to that same
 * width, so the picture draws 1:1 and its labels are the size the stylesheet asked for. A
 * fixed viewBox with width:100% scaled the whole schematic up on a wide pane instead, which
 * bought no extra information and cost a screen of height.
 *
 * Everything derives from the area and destination lists, so a tenth scan area moves the
 * whole picture with no coordinate edit anywhere.
 */
export function diagramLayout(areas, destinations, width) {
  const step = DIA.nodeH + DIA.gap;
  const span = areas.length * step - DIA.gap;
  const mid = DIA.top + span / 2;

  // The bands breathe with the width rather than pinning to it: past ~1500px more room for
  // a nine-word label buys nothing, so the extra goes into the gaps the edges run through.
  const srcW = clamp(300, width * 0.36, 520);
  const destW = clamp(230, width * 0.27, 400);
  const spineW = clamp(132, width * 0.14, 210);
  const destX = width - destW;
  const spineX = srcW + (destX - srcW - spineW) / 2;

  const sources = areas.map((area, i) => ({
    area, x: 0, y: DIA.top + i * step, w: srcW, h: DIA.nodeH,
  }));

  const spineH = Math.max(DIA.spineMinH, span * DIA.spineSpan);
  const spine = { x: spineX, y: mid - spineH / 2, w: spineW, h: spineH };

  // Both fans are spread symmetrically about the middle, so a single item sits centred and
  // the run stays balanced however many areas or screens there turn out to be.
  const spread = (i, count, extent) =>
    mid + (count > 1 ? i / (count - 1) - 0.5 : 0) * extent;

  const destSpan = span * DIA.destSpan;
  const dests = destinations.map((dest, j) => ({
    dest,
    x: destX,
    y: spread(j, destinations.length, destSpan - DIA.destH) - DIA.destH / 2,
    w: destW,
    h: DIA.destH,
  }));

  const inAt = (i) => spread(i, sources.length, spineH * DIA.inFan);
  const outAt = (j) => spread(j, dests.length, spineH * DIA.outFan);

  const edges = [];
  sources.forEach((s, i) => {
    edges.push({
      id: "in-" + s.area.id, areaId: s.area.id, state: s.area.state,
      x1: s.x + s.w, y1: s.y + s.h / 2, x2: spine.x, y2: inAt(i),
    });
  });
  dests.forEach((d, j) => {
    // A destination's edge carries the best state feeding it: if anything reports a live
    // figure into this screen, the path to it is a live path.
    const feeders = sources.filter((s) => s.area.lands === d.dest.id && s.area.state !== "unscanned");
    if (!feeders.length) return;
    const best = feeders.reduce(
      (acc, s) => (COVERAGE[s.area.state].rank < COVERAGE[acc].rank ? s.area.state : acc),
      "unscanned",
    );
    edges.push({
      id: "out-" + d.dest.id, destId: d.dest.id, state: best,
      areaIds: feeders.map((s) => s.area.id),
      x1: spine.x + spine.w, y1: outAt(j), x2: d.x, y2: d.y + d.h / 2,
    });
  });

  return { sources, spine, dests, edges, width, height: diagramHeight(areas.length) };
}

function curve(e) {
  const dx = (e.x2 - e.x1) * 0.45;
  return "M " + e.x1 + " " + e.y1 +
    " C " + (e.x1 + dx) + " " + e.y1 + ", " + (e.x2 - dx) + " " + e.y2 +
    ", " + e.x2 + " " + e.y2;
}

/**
 * The picture, plus a stable `light(areaId)` the register drives.
 *
 * It rebuilds on resize because the layout is measured, not scaled: the observer hands back
 * the container's content width, the SVG is drawn at exactly that width, and the labels
 * never grow or shrink. `light` survives each rebuild — the register wires its rows once.
 */
function provenanceDiagram(ranked, tally) {
  const scroll = el("div", {
    class: "cov-diagram-scroll",
    tabindex: "0",
    role: "group",
    "aria-label": "Provenance diagram, scrollable",
  });

  let lit = "";
  let apply = () => {};
  let lastWidth = 0;

  function build(width) {
    const drawn = buildDiagram(ranked, tally, width);
    clear(scroll).append(drawn.svg);
    apply = drawn.light;
    apply(lit);
  }

  // Drawn once before insertion so the container is never an empty box the register can
  // jump into; the first observer callback then corrects it to the real width.
  build(1080);

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].contentRect;
      if (!box || !box.width) return;
      const width = Math.max(DIA.minWidth, Math.round(box.width));
      // Sub-pixel churn and the scrollbar appearing are not resizes worth a rebuild.
      if (Math.abs(width - lastWidth) < 8) return;
      lastWidth = width;
      build(width);
    });
    ro.observe(scroll);
    // Without this each visit leaves an observer attached to a container that outlives it,
    // holding the resolved area list behind it — the leak graphView.js's destroy() closes.
    onPageTeardown(() => ro.disconnect());
  }

  return {
    node: scroll,
    light: (areaId) => { lit = areaId; apply(areaId); },
  };
}

function buildDiagram(ranked, tally, width) {
  const layout = diagramLayout(ranked, DESTINATIONS, width);
  const svg = svgEl("svg", {
    class: "cov-diagram",
    viewBox: "0 0 " + width + " " + layout.height,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    focusable: "false",
    "aria-label":
      "Provenance diagram. " + ranked.length + " Wiz scan areas feed one sync, which writes " +
      "to " + DESTINATIONS.length + " screens. " + tally.live + " areas report a live figure, " +
      tally.partial + " partial, " + tally.unscanned + " not scanned here. " +
      "The register below lists every area with the same information.",
  });
  // In pixels, matching the viewBox, so the render is exactly 1:1. Past the container's
  // width this overflows and the wrapper scrolls, which is the intended narrow behaviour.
  svg.style.width = width + "px";

  const edgeLayer = svgEl("g", { class: "cov-edges" });
  const nodeLayer = svgEl("g", { class: "cov-nodes" });
  svg.append(edgeLayer, nodeLayer);

  const byArea = new Map();
  const touch = (areaId, node) => {
    if (!areaId) return;
    if (!byArea.has(areaId)) byArea.set(areaId, []);
    byArea.get(areaId).push(node);
  };

  for (const e of layout.edges) {
    const path = svgEl("path", { class: "cov-edge", d: curve(e), "data-state": e.state });
    edgeLayer.append(path);
    touch(e.areaId, path);
    for (const id of e.areaIds || []) touch(id, path);
  }

  // The spine: what happens to everything between the query and the screen.
  const spine = layout.spine;
  nodeLayer.append(
    svgEl("rect", {
      class: "cov-spine", x: spine.x, y: spine.y, width: spine.w, height: spine.h, rx: 10,
    }),
  );
  const spineCx = spine.x + spine.w / 2;
  const spineMid = spine.y + spine.h / 2;
  nodeLayer.append(text("cov-spine-title", spineCx, spineMid - 28, "Sync", "middle"));
  ["normalize", "enrich", "score", "persist"].forEach((line, i) => {
    nodeLayer.append(text("cov-spine-step", spineCx, spineMid - 9 + i * 14, line, "middle"));
  });

  // One row per source: dot, title, and the figure right-aligned against the far edge, so
  // the numbers line up down the column and the row reads left to right as a sentence.
  for (const s of layout.sources) {
    const g = svgEl("g", { class: "cov-node", "data-state": s.area.state });
    const baseline = s.y + s.h / 2 + 4;
    g.append(
      svgEl("rect", { class: "cov-node-box", x: s.x, y: s.y, width: s.w, height: s.h, rx: 7 }),
      dot(s.x + 13, s.y + s.h / 2, s.area.state),
      text("cov-node-name", s.x + 25, baseline, s.area.title),
      text("cov-node-fig", s.x + s.w - 11, baseline, nodeCaption(s.area), "end"),
    );
    nodeLayer.append(g);
    touch(s.area.id, g);
  }

  for (const d of layout.dests) {
    const g = svgEl("g", { class: "cov-dest" });
    g.append(
      svgEl("rect", { class: "cov-dest-box", x: d.x, y: d.y, width: d.w, height: d.h, rx: 7 }),
      text("cov-dest-name", d.x + 14, d.y + 18, d.dest.title),
      text("cov-dest-sub", d.x + 14, d.y + 32, d.dest.sub),
    );
    nodeLayer.append(g);
  }

  let litIds = [];
  function light(areaId) {
    for (const node of litIds) node.classList.remove("is-lit");
    litIds = areaId ? (byArea.get(areaId) || []) : [];
    for (const node of litIds) node.classList.add("is-lit");
    svg.classList.toggle("is-dimmed", litIds.length > 0);
  }

  return { svg, light };
}

/** The one-line caption inside a node: its headline figure, or what it has instead. */
function nodeCaption(area) {
  if (area.figure) return area.figure.short || area.figure.value;
  return COVERAGE[area.state].short;
}

function text(cls, x, y, content, anchor) {
  const node = svgEl("text", { class: cls, x, y, "text-anchor": anchor || null });
  node.textContent = content;
  return node;
}

/** Filled / half / hollow, so the state reads without its colour. */
function dot(cx, cy, state) {
  const g = svgEl("g", { class: "cov-dot", "data-state": state });
  g.append(svgEl("circle", { class: "cov-dot-ring", cx, cy, r: 4.5 }));
  if (state === "live") {
    g.append(svgEl("circle", { class: "cov-dot-fill", cx, cy, r: 4.5 }));
  } else if (state === "partial") {
    // The left half only — a half-filled dot reads as "some of this" at 9px, where a
    // different colour alone would not.
    g.append(svgEl("path", {
      class: "cov-dot-fill",
      d: "M " + cx + " " + (cy - 4.5) + " A 4.5 4.5 0 0 0 " + cx + " " + (cy + 4.5) + " Z",
    }));
  }
  return g;
}

// ---------------------------------------------------------------------------- skeleton
//
// The stub IS the layout: it reserves the diagram's exact height, so the register does not
// jump several hundred pixels when the payload lands.

function scansSkeleton() {
  // Height depends only on how many areas there are, never on the width, so the stub can
  // reserve the diagram's exact box and the register cannot jump when the payload lands.
  const reserve = diagramHeight(SCAN_AREAS.length);
  const stats = el("div", { class: "stat-list" });
  for (let i = 0; i < 4; i++) {
    stats.append(el("div", { class: "stat-row" },
      skeleton("line", { width: "62%", height: "10px" }),
      skeleton("line", { width: "44%", height: "18px" }),
      skeleton("line", { width: "80%", height: "9px" })));
  }
  return el("div", { role: "status", "aria-label": "Loading scan coverage" },
    el("div", { class: "cov-header" },
      el("div", { class: "cov-hero" },
        skeleton("line", { width: "70px", height: "10px" }),
        skeleton("stat", { width: "120px" }),
        skeleton("line", { width: "150px", height: "10px" })),
      el("div", { class: "cov-strip" },
        skeleton("line", { width: "64px", height: "10px" }),
        skeleton("line", { width: "100%", height: "14px", radius: "999px" }),
        skeleton("pill", { width: "320px" })),
      stats),
    skeleton("title", { width: "220px" }),
    skeleton("chart", { height: reserve + "px" }),
    skeleton("title", { width: "130px" }),
    el("div", { class: "skeleton-stack", style: "gap:10px; margin-top:8px" },
      ...Array.from({ length: 9 }, () => skeleton("line", { height: "22px" }))),
    el("div", { style: "margin-top:20px" }, skeleton("title", { width: "150px" })),
    el("div", { class: "skeleton-stack", style: "gap:10px; margin-top:8px" },
      ...Array.from({ length: 5 }, () => skeleton("line", { height: "26px" }))),
  );
}
