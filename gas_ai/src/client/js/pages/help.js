// Help: the key sheet. What every word and mark on these screens means, and how much of
// each this tenant holds.
//
// THE PAGE IS A REFERENCE, NOT A TOUR. Three deliberate calls worth knowing before editing:
//
// 1. NO PIPELINE DIAGRAM BELONGS HERE. Wiz Scans owns provenance — nine queries into one
//    sync spine, out to the screens the results land on, with every area's state derived
//    from what the last sync actually produced. A second drawing of that path on this page
//    would be a second address for the same fact, and the two would disagree the first time
//    either changed. Any diagram added here is rejected on sight; link to #/scans instead.
//
// 2. THE FIGURE IS role="img" AND THE CALLOUT LIST IS ITS KEYBOARD PATH. The SVG holds no
//    tab stops at all. This is the same call pages/scans.js documents for its provenance
//    diagram: the whole content of the picture is six facts that are also on screen as
//    text, so a second, different keyboard model for them is the invented control
//    PRODUCT.md warns about. The link runs the other way — focusing a callout lights its
//    part of the drawing.
//
// 3. PROSE PAINTS SYNCHRONOUSLY; ONLY COUNTS ARRIVE LATE. The reader most likely to open
//    Help is the one who has not synced yet, and a page of skeletons is the worst possible
//    first impression. Everything except the count cells is known from the bootstrap
//    payload app.js has already awaited, so it is painted before the first await and the
//    counts fill in place. There are deliberately no height-reserving skeletons here: the
//    layout does not move when the numbers land.
//
// 4. THE STRUCTURE IS BUILT ONCE; ONLY THE ROWS ARE REPAINTED. paint() used to do
//    `clear(lexHost).append(lexicon(...))`, which rebuilt all six family headings two or
//    three times per visit — destroying the very ids the index rail and the ?term= link
//    scroll to, and silently dropping focus if the reader had tabbed onto a count link
//    while a read was still in flight. So the section wrappers, the family headings and
//    the index are built from ENTRIES before the first await (their counts are lengths,
//    not figures, so they are known then and never change), and paint() only clears the
//    per-family lists. Anything that has an id, or that the rail points at, must be built
//    in the shell — never inside paint().

import { COVERAGE, coverageTally, resolveAreas } from "../scanContent.js";
import {
  ENTRIES, ROUTE_TITLES, findEntry, groupByFamily, lexTally, resolveEntries,
} from "../helpContent.js";
import { CATEGORY_LABELS, kindIcon, svgEl } from "../icons.js";
import { ROUTE_ICONS } from "../routeIcons.js";
import { bootstrap, bootstrapCached, navigate, setParams, swrCall } from "../store.js";
import {
  clear, el, fmtDateTime, motionOk, onPageTeardown, sectionLabel, statusPill, tip,
  uiIcon,
} from "../ui.js";

// Byte-identical to the constants pages/scans.js, pages/inventory.js and pages/combos.js
// call with, so swrCall's key is shared: arriving here from any of them costs no round
// trip at all. Only the HEAD of the assets payload is read (kpis), never `rows`, so a
// small pageSize keeps this correct AND cheap at any landscape size.
const ASSETS_PARAMS = { all: true, pageSize: 25 };
const COMBOS_PARAMS = {};

// The five questions, one per page, phrased as the question rather than the feature.
const PAGE_MAP = [
  ["graph", "Which paths reach a sensitive asset?"],
  ["inventory", "What do we have, and what scores worst?"],
  ["combos", "Which risks only matter when they combine?"],
  ["aars", "How is the score calculated? What does LLM06 mean?"],
  ["scans", "Where did this figure come from?"],
];

// The page's own sections, named once. renderHelp() lays them out and pageIndex() lists
// them, both from this array, so the rail can never name a heading the page does not have
// (or miss one it does).
const SECTIONS = [
  ["help-sec-map", "Where each question is answered"],
  ["help-sec-limits", "What this app cannot tell you"],
  ["help-sec-anatomy", "Anatomy of a node"],
  ["help-sec-lexicon", "The vocabulary"],
];

export async function renderHelp(main, params, _ctx) {
  const boot = bootstrapCached() || (await bootstrap());

  // The page spans the pane, like every other page here. It used to stop at 1080px, on the
  // argument that a document is not a canvas and "a definition whose count sits 900px to
  // its right is two facts, not one row". The observation was right and the remedy was too
  // blunt: the thing that comes apart at width is a ROW, so the row is where it is fixed —
  // each one caps its content column at --measure and keeps its right-hand cell beside it,
  // with a trailing gutter taking the surplus (see help.css). That holds at 1920px, which a
  // page-level cap never did; it only postponed the problem to the width it allowed.
  //
  // The index rail is FIRST in the DOM and second in the grid on purpose: it is a jump
  // control, so a keyboard reader has to meet it before the ~2500px it exists to skip.
  // Below its breakpoint it is display:none and costs no tab stop.
  const page = el("div", { class: "help-page" });
  const doc = el("div", { class: "help-doc" });
  const index = pageIndex();
  page.append(index, doc);
  main.append(page);

  doc.append(
    el("h1", {}, "Help"),
    el("p", { class: "page-sub" },
      "What every word and mark on these screens means, and how much of each this tenant " +
      "holds. Every figure below is the one the last sync produced."),
  );

  const headHost = el("div", { class: "help-head" });
  const limitsHost = el("div", { class: "help-limits" });
  const lex = lexiconShell();

  doc.append(
    headHost,
    section(0, pageMap()),
    section(1, limitsHost),
    section(2, anatomy()),
    section(3, lex.node),
  );

  index.wire(page);

  // Painted once from the bootstrap alone, then repainted as each RPC lands. Both reads
  // are optional: a failure leaves the entries in their "not counted here" state, which
  // is the honest reading of a payload that did not arrive.
  let kpis = null;
  let digest = null;

  paint();

  const reads = await Promise.allSettled([
    swrCall("api_getAssets", ASSETS_PARAMS, (fresh) => {
      kpis = fresh.kpis || null;
      paint();
    }),
    swrCall("api_getToxicCombos", COMBOS_PARAMS, (fresh) => {
      digest = (fresh && fresh.digest) || null;
      paint();
    }),
  ]);
  if (reads[0].status === "fulfilled") kpis = reads[0].value.kpis || null;
  if (reads[1].status === "fulfilled") digest = (reads[1].value && reads[1].value.digest) || null;
  paint();

  // A ?term= deep link, from a term trigger anywhere in the app. Runs after the first
  // paint so the entry exists to scroll to; a term the book does not carry is simply
  // ignored rather than reported, because a stale bookmark is not an error state.
  const wanted = findEntry(params.term);
  if (wanted) revealEntry(wanted.id);

  function paint() {
    const ctx = {
      boot,
      kpis,
      digest,
      total: (kpis && kpis.aiAssets) || 0,
      tally: null,
    };
    // resolveAreas wants the same payload shape the coverage page hands it, so the limits
    // block and Wiz Scans read one implementation and cannot disagree about what this
    // deployment does not collect.
    const areas = resolveAreas({ boot, kpis, total: ctx.total, digest });
    ctx.tally = coverageTally(areas);

    // Resolved once and read twice — the header states how the book answers, the rows
    // state how each term does, and they are the same array.
    const resolved = resolveEntries(ctx);

    clear(headHost).append(header(boot, lexTally(resolved)));
    clear(limitsHost).append(limits(areas));
    lex.fill(resolved);
  }
}

/**
 * One top-level section: its h2 heading, carrying the id the rail scrolls to, over its
 * body. `tabIndex = -1` makes the heading a focus target for jumpTo() without adding a tab
 * stop — a fragment destination should be focusable, not tabbable.
 */
function section(i, body) {
  const head = sectionLabel(SECTIONS[i][1]);
  head.id = SECTIONS[i][0];
  head.tabIndex = -1;
  return el("div", { class: "help-section" }, head, body);
}

// --------------------------------------------------------------------------- the header
//
// The two-level posture header every other page in this app opens with — the shape of
// scans.js's postureHeader() and the inventory's `.inv-header`, minus their third level.
// The obvious third level would carry "last sync" and "mode", and both are already IN this
// header: the strip note says the first in words and the pill says the second. A stat
// strip repeating them would be the same fact at three addresses.
//
// Two levels, one added fact. The hero says how much of this key sheet the deployment can
// actually put a number on — which is the second half of the page's own subtitle, and is
// stated nowhere else — and the strip says how the rest divides.

// The four states a term's count column can be in, in the order the bar stacks them: an
// answer, an answer that is zero, no answer, and no question. They are the branches
// countCell() takes, and lexTally() counts them — see the note on lexTally in
// helpContent.js for why the three must stay in step.
const LEX_STATES = [
  { key: "figure", glyph: "●", label: "carry a figure" },
  { key: "zero", glyph: "◐", label: "none in this tenant" },
  { key: "uncounted", glyph: "○", label: "not counted here" },
  { key: "convention", glyph: "–", label: "conventions, not quantities" },
];

function header(boot, tally) {
  const sync = boot.latestSync || null;
  const dryRun = !!sync && String(sync.mode || "") === "dry-run";
  // A zero is an answer. "None in this tenant" is a figure the last sync produced, so it
  // counts toward what the page can put a number on; only "not counted here" does not.
  const answered = tally.figure + tally.zero;

  const hero = el("div", { class: "help-hero" },
    el("div", { class: "kpi-label" }, "Carrying a figure"),
    el("div", { class: "hero-value num" }, answered + " of " + ENTRIES.length),
    el("p", { class: "help-hero-sub" },
      "terms this key sheet can put a number on right now"),
    sync
      ? (dryRun
          ? statusPill("neutral", "Dry-run · sample data")
          : statusPill("ok", "Live · this tenant"))
      : statusPill("neutral", "No sync yet"),
  );

  // Two different kinds of number appear in the count column and this note has to keep
  // them apart. A MEASUREMENT comes from the last sync and needs one. A SETTING — the
  // depth, the node budget, the pillar caps, the band thresholds — is the model in force
  // right now and is just as true before the first sync as after it. Saying "no term
  // below carries a count" while four of them show a figure is the kind of small
  // over-claim PRODUCT.md's honest-state principle is aimed at. Both sentences are the
  // ones the dateline carried; they are moved here verbatim, not rewritten.
  const note = sync
    ? "Figures are from the sync of " + fmtDateTime(sync.finished_at) +
      "; the scoring model and view settings are the ones in force now."
    : "Nothing has been collected, so no term below carries a figure from your landscape — " +
      "the scoring model and view settings shown are still the ones in force. Run " +
      "“Sync now” in the sidebar; without credentials it loads the sample dataset.";

  const strip = el("div", { class: "help-strip" },
    el("div", { class: "kpi-label" }, "The key sheet"),
    lexBar(tally),
    lexKeys(tally),
    el("p", { class: "help-strip-note" }, note),
  );

  return el("div", { class: "help-header" }, hero, strip);
}

/**
 * The distribution as one bar. `aria-hidden` because the keys under it carry the same four
 * numbers as text — the call scans.js makes for its coverage bar, for the same reason.
 * Empty buckets are skipped rather than drawn at zero width, so the bar never carries a
 * seam that means nothing.
 */
function lexBar(tally) {
  const bar = el("div", { class: "help-lexbar", "aria-hidden": "true" });
  for (const state of LEX_STATES) {
    const n = tally[state.key] || 0;
    if (!n) continue;
    const seg = el("div", { class: "help-lexbar-seg" });
    seg.dataset.bucket = state.key;
    seg.style.flexGrow = String(n);
    bar.append(seg);
  }
  return bar;
}

/** The key, always all four, so the row's width does not change when a count lands. */
function lexKeys(tally) {
  const row = el("div", { class: "help-lexkeys" });
  for (const state of LEX_STATES) {
    const chip = el("span", { class: "help-lexkey" },
      el("span", { class: "help-lexkey-glyph", "aria-hidden": "true" }, state.glyph),
      el("span", { class: "help-lexkey-num num" }, String(tally[state.key] || 0)),
      state.label);
    chip.dataset.bucket = state.key;
    row.append(chip);
  }
  return row;
}

// ---------------------------------------------------------------------- the index rail
//
// A nav over ONE scrolling document, deliberately not the record sheet's `.sheet-rail`:
// that one is a real `tablist` over hidden panes, with a roving tabindex and activation
// following focus, and inheriting those semantics here would promise a pane swap that
// never happens. The visual recipe IS borrowed — accent bar plus weight, never a tint
// alone — because that is the app's own rule for an active nav item.
//
// Buttons, not anchors: the app is hash-routed, so an href="#help-family-graph" would
// clobber the route rather than scroll to the heading.

function pageIndex() {
  const nav = el("nav", { class: "help-index", "aria-label": "On this page" });
  const items = [];

  const add = (id, label, count, ariaLabel) => {
    const btn = el("button", {
      class: "help-index-item",
      type: "button",
      "aria-label": ariaLabel || null,
      onclick: () => jumpTo(id),
    },
      el("span", { class: "help-index-item-label" }, label),
      count === null ? null : el("span", { class: "help-index-count num" }, String(count)),
    );
    btn.dataset.target = id;
    nav.append(btn);
    items.push(btn);
  };

  nav.append(el("div", { class: "help-index-label" }, "On this page"));
  for (const [id, title] of SECTIONS) add(id, title, null);

  // The per-family counts are lengths of ENTRIES, not resolved figures — structural, known
  // before the first await, and unchanged by any payload. That is what lets the rail paint
  // once and never repaint, which is what lets its scroll targets stay put.
  nav.append(el("div", { class: "help-index-label" }, "The vocabulary"));
  for (const g of groupByFamily(ENTRIES)) {
    add("help-family-" + g.family.id, g.family.title, g.entries.length,
      g.family.title + ", " + g.entries.length + " terms");
  }

  nav.wire = (page) => wireIndex(nav, page, items);
  return nav;
}

/** Scroll a section heading into view and land focus on it. */
function jumpTo(id) {
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "start" });
  // preventScroll: the smooth scroll above is still in flight, and an unguarded focus()
  // would cancel it with a jump to the same place.
  node.focus({ preventScroll: true });
}

/**
 * Light the item whose section the reader is in.
 *
 * `main` owns the scroll on desktop (height:100vh; overflow-y:auto) and the body owns it
 * at the <=800px top-bar layout, so the scroller is resolved from the computed overflow
 * rather than from a width guess.
 *
 * A scroll listener rather than an IntersectionObserver, which is the usual advice and is
 * wrong here. An observer fires when an element CROSSES a boundary, and that is a strict
 * subset of when the answer changes: the family headings are `position: sticky`, so once
 * one is pinned at the top of the pane it never crosses anything again, and a jump that
 * lands between two crossings leaves the rail pointing at the section before the one the
 * reader is looking at. This was measurable — jumping to "The vocabulary" left "Anatomy of
 * a node" lit. The listener is passive and coalesced onto one animation frame, and the work
 * per frame is ten getBoundingClientRect reads, which is what the observer callback did
 * anyway.
 *
 * The current section is then the LAST anchor at or above a band near the top of the pane,
 * read in document order — deterministic at any scroll speed.
 */
function wireIndex(nav, page, items) {
  const targets = items
    .map((btn) => ({ btn, node: document.getElementById(btn.dataset.target) }))
    .filter((t) => t.node);
  if (!targets.length) return;

  const root = page.closest("main");
  const scroller = root && getComputedStyle(root).overflowY === "auto" ? root : window;
  let active = null;
  let queued = false;

  const pick = () => {
    queued = false;
    // Hidden below its breakpoint: offsetParent is null, and there is nothing to light.
    // This is why the media query hides the rail with `display: none` rather than
    // `visibility: hidden`, which would leave an offsetParent and light an unseen item.
    if (!nav.offsetParent) return;
    const band = (root ? root.getBoundingClientRect().top : 0) + 96;
    let chosen = targets[0];
    for (const t of targets) {
      if (t.node.getBoundingClientRect().top <= band) chosen = t;
    }
    if (chosen.btn === active) return;
    if (active) active.removeAttribute("aria-current");
    active = chosen.btn;
    active.setAttribute("aria-current", "true");
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(pick);
  };

  // Resize covers the breakpoint too: a reader who widens past it reveals a rail that has
  // never been lit, and would otherwise see no current section until they scrolled.
  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  // app.js runs the teardown right before it clears the pane. Without this the listeners
  // outlive the page and keep its whole DOM alive across every later route change.
  onPageTeardown(() => {
    scroller.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
  });

  pick();
}

// -------------------------------------------------------------------------- the page map

// The question leads and the page name follows, which is the way round the reader has
// them: they arrived with a question and do not yet know what the five pages are called.
// The whole row is the button — a 40px "Open →" stranded at the far end of a 1000px row is
// a target nobody can hit and a control nested inside a row that is not one.
//
// The glyph is the route's OWN sidebar mark, from routeIcons.js. A reader who follows this
// row is going to look for that page in the nav next time, and finding the same mark there
// is the whole of PRODUCT.md's "earned familiarity".
function pageMap() {
  const list = el("div", { class: "help-map" });
  for (const [route, question] of PAGE_MAP) {
    list.append(el("button", {
      class: "help-map-item",
      type: "button",
      "aria-label": question + " — open " + ROUTE_TITLES[route],
      onclick: () => navigate(route, {}),
    },
      el("span", {
        class: "help-map-icon", "aria-hidden": "true", html: ROUTE_ICONS[route] || "",
      }),
      el("span", { class: "help-map-text" },
        el("span", { class: "help-map-q" }, question),
        el("span", { class: "help-map-page" }, ROUTE_TITLES[route])),
      el("span", { class: "help-map-go", "aria-hidden": "true" }, uiIcon("chevron-right", 14)),
    ));
  }
  return list;
}

// ----------------------------------------------------------------------- the limits block
//
// Derived, never authored. Wiz Scans ranks best-informed FIRST, so the areas this
// deployment cannot back with a figure sit at the bottom of a nine-row register there.
// They are the first thing a new reader should know, so they lead here — resolved by the
// coverage page's own resolvers, which is what makes the two structurally unable to
// disagree.

function limits(areas) {
  const gaps = areas.filter((a) => a.state !== "live");
  const host = el("div", {});

  if (!gaps.length) {
    host.append(el("p", { class: "help-limits-none" },
      statusPill("ok", COVERAGE.live.glyph + " Complete"),
      el("span", {},
        "Every scan area this app queries is currently reporting a figure."),
    ));
    return host;
  }

  for (const area of gaps) {
    const meta = COVERAGE[area.state];
    // The state wears the app's own status pill rather than a hand-rolled glyph plus a
    // bolded word — `COVERAGE[state].pill` has carried the right kind all along and this
    // was the one block on the page reporting STATE without using the state component.
    // The glyph rides inside the pill, so the non-colour cue survives and the state's WORD
    // still leads the row: the reader never has to learn that a half-filled circle means
    // "partial" before the row makes sense.
    host.append(el("div", { class: "help-limit-row", "data-state": area.state },
      statusPill(meta.pill, meta.glyph + " " + meta.label),
      el("span", { class: "help-limit-name" }, area.title),
      el("span", { class: "help-limit-note" },
        area.note || (meta.blurb.charAt(0).toUpperCase() + meta.blurb.slice(1) + ".")),
    ));
  }
  host.append(el("p", { class: "help-limits-src" },
    el("span", {},
      "Resolved by the same code the coverage page uses, so this list and the register " +
      "cannot disagree. "),
    el("button", {
      class: "linklike",
      type: "button",
      onclick: () => navigate("scans", {}),
    }, "Wiz Scans →"),
  ));
  return host;
}

// ------------------------------------------------------------------------- the anatomy
//
// Fixed geometry and a fixed subject. A real tenant asset would need a fourth RPC — the
// risk topology is derived on read and never persisted, and assetTableRow strips the
// condition flags — and it still might not exhibit the marks the callouts label. A
// teaching figure has to be complete, so this one is a stated example.
//
// The node styling borrows scans.css's approach rather than the graph's classes: .gnode
// sets `cursor: pointer` and styles :focus-visible, which would signal a clickability
// this picture does not have. The `.help-node` family in help.css mirrors the same tints.

const CALLOUTS = [
  {
    parts: ["halo", "tc"],
    title: "The halo and the TC badge",
    text: "This asset is in a toxic combination. Crimson is identity here, never a severity.",
    term: "tc-halo",
  },
  {
    parts: ["kind"],
    title: "Tint, icon and word",
    text: "The tint is the category. The icon and the word are the kind — colour is never the only cue.",
    term: "node-kind",
  },
  {
    parts: ["sev"],
    title: "The severity dot and word",
    text: "The worst adjusted severity on the asset. Always the dot and the label, never one alone.",
    term: "severity",
  },
  {
    parts: ["aars"],
    title: "The findings score",
    text: "0 to 100 across four pillars. The card shows p<N>, its percentile among the scored " +
      "assets — the number is on the detail sheet. Levels are set on the AARS Rules page.",
    term: "aars",
  },
  {
    parts: ["absent"],
    title: "A dashed edge is an absence",
    text: "Wiz looked for a PROTECTED_BY link and found none, so the edge is drawn and labelled rather than left off.",
    term: "negated-edge",
  },
  {
    parts: ["signal"],
    title: "Risk is a node on the path",
    text: "Not a flag on a card. Signals hang off the asset they describe, where an attack path can be read.",
    term: "risk-as-node",
  },
];

const FIG_LABEL =
  "A worked example of a security graph node. An AI agent named checkout-bot sits inside a " +
  "dashed crimson halo carrying a TC badge, which marks toxic-combination membership. The " +
  "node shows a High severity dot and label and p92, the findings-score percentile. A dashed edge labelled " +
  "PROTECTED_BY, absent, joins it to a No Guardrail risk node.";

function anatomy() {
  const svg = anatomySvg();
  const list = el("div", { class: "help-callouts" });

  const setLit = (parts) => {
    svg.querySelectorAll("[data-part]").forEach((g) => g.classList.remove("lit"));
    if (!parts) {
      svg.classList.remove("dimming");
      return;
    }
    svg.classList.add("dimming");
    for (const p of parts) {
      const g = svg.querySelector('[data-part="' + p + '"]');
      if (g) g.classList.add("lit");
    }
  };

  CALLOUTS.forEach((c, i) => {
    const btn = el("button", {
      class: "help-callout",
      type: "button",
      onmouseenter: () => setLit(c.parts),
      onmouseleave: () => setLit(null),
      onfocus: () => setLit(c.parts),
      onblur: () => setLit(null),
      onclick: () => revealEntry(c.term),
    },
      el("span", { class: "help-callout-n num", "aria-hidden": "true" }, String(i + 1)),
      el("span", { class: "help-callout-t" },
        el("b", {}, c.title),
        el("span", {}, c.text)),
    );
    list.append(btn);
  });

  return el("div", { class: "help-anatomy" },
    el("div", { class: "help-figure" },
      el("div", { class: "help-figure-scroll", tabindex: "0", role: "group",
        "aria-label": "Node anatomy figure, scrollable" }, svg),
      el("p", { class: "help-figure-note" },
        "A fixed example, not an asset in this tenant — so every mark it teaches is " +
        "always present. Selecting a callout opens that term below."),
    ),
    list,
  );
}

/**
 * The drawing. Fixed geometry: unlike the coverage diagram there is nothing here whose
 * size depends on the data, so there is no ResizeObserver and no measured layout — below
 * its minimum width the container scrolls rather than shrinking 10px labels into
 * illegibility, which is the call scans.css already made.
 */
function anatomySvg() {
  // 640 wide, not 520: the negated edge carries a 20-character label and the gap has to
  // hold it. At 520 the label ran under the risk node — a picture whose whole subject is
  // "the edge is labelled" cannot have the label collide with what it points at.
  const svg = svgEl("svg", {
    class: "help-scene",
    // Height is the drawing's own extent (the TC badge at y=6 down to the halo at y=118),
    // not a round number — a viewBox taller than its content is dead space inside a frame.
    viewBox: "0 0 640 126",
    role: "img",
    focusable: "false",
    "aria-label": FIG_LABEL,
  });

  const add = (parent, tag, attrs, text) => {
    const node = svgEl(tag, attrs);
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };
  const group = (part) => {
    const g = svgEl("g", {});
    g.dataset.part = part;
    svg.append(g);
    return g;
  };
  /**
   * The real mark, positioned — never a copy of its path data.
   *
   * This figure used to re-type AI_AGENT's and MISSING_GUARDRAIL's `d` strings byte for
   * byte, against the rule helpContent.js states for the whole Help surface: a mark is
   * RENDERED, never redrawn, so a specimen cannot drift into being a picture of a component
   * that no longer looks like that. It had already drifted. kindIcon() hardcodes
   * `class="gnode-icon"`, so the class is re-set to the figure's own; test/icons.test.js
   * fails if any glyph's path data reappears in this file.
   */
  const specimenMark = (kind, category, transform) => {
    const g = kindIcon(kind);
    g.setAttribute("class", "help-node-icon");
    g.setAttribute("transform", transform);
    g.dataset.category = category;
    return g;
  };

  // The halo: crimson, dashed, drawn around the node rather than on it.
  const halo = group("halo");
  add(halo, "rect", {
    class: "help-halo-ring", x: 8, y: 14, width: 252, height: 104, rx: 16,
  });

  const tc = group("tc");
  add(tc, "rect", { class: "help-tc-badge", x: 226, y: 6, width: 30, height: 17, rx: 8 });
  add(tc, "text", { class: "help-tc-text", x: 241, y: 18, "text-anchor": "middle" }, "TC");

  // The node itself: neutral card, category medallion, name, kind.
  const kind = group("kind");
  add(kind, "rect", {
    class: "help-node-box", x: 24, y: 30, width: 220, height: 72, rx: 10,
    "data-category": "asset",
  });
  add(kind, "circle", {
    class: "help-node-medallion", cx: 46, cy: 66, r: 18, "data-category": "asset",
  });
  kind.append(specimenMark("AI_AGENT", "asset", "translate(38,58)"));
  add(kind, "text", { class: "help-node-name", x: 74, y: 60 }, "checkout-bot");
  add(kind, "text", { class: "help-node-kind", x: 74, y: 76, "data-category": "asset" }, "AI AGENT");

  const sev = group("sev");
  add(sev, "circle", { class: "help-node-dot", cx: 80, cy: 90, r: 4 });
  add(sev, "text", { class: "help-node-sev", x: 89, y: 94 }, "High");

  const aars = group("aars");
  add(aars, "text", { class: "help-node-aars", x: 230, y: 94, "text-anchor": "end" }, "p92");

  // The negated edge, and the node it raises.
  const absent = group("absent");
  add(absent, "path", { class: "help-edge absent", d: "M244 66 H414" });
  add(absent, "text", {
    class: "help-edge-label", x: 329, y: 58, "text-anchor": "middle",
  }, "PROTECTED_BY (ABSENT)");

  const signal = group("signal");
  add(signal, "rect", {
    class: "help-node-box", x: 414, y: 42, width: 208, height: 48, rx: 10,
    "data-category": "vuln",
  });
  add(signal, "circle", {
    class: "help-node-medallion", cx: 436, cy: 66, r: 15, "data-category": "vuln",
  });
  signal.append(specimenMark("MISSING_GUARDRAIL", "vuln", "translate(428,58)"));
  add(signal, "text", { class: "help-node-name", x: 458, y: 62 }, "No Guardrail");
  add(signal, "text", {
    class: "help-node-kind", x: 458, y: 76, "data-category": "vuln",
  }, "RISK SIGNAL");

  return svg;
}

// -------------------------------------------------------------------------- the lexicon

/**
 * The lexicon's structure, built once, plus a fill() that repaints only the rows.
 *
 * The six headings carry the ids the index rail and the ?term= link scroll to, so they
 * cannot be rebuilt on every count arrival — see rule 4 in this file's header. Their counts
 * are `entries.length`, a property of the book rather than of the landscape, so they are known
 * from the synchronous first paint and never move.
 *
 * groupByFamily reads only `.family`, a static field, so the raw ENTRIES give exactly the
 * group set the resolved entries will.
 */
function lexiconShell() {
  const host = el("div", {});
  const lists = new Map();

  for (const g of groupByFamily(ENTRIES)) {
    const head = el("h3", { class: "help-family", id: "help-family-" + g.family.id },
      el("span", { class: "help-family-t" }, g.family.title),
      el("span", { class: "help-family-n num" }, String(g.entries.length)));
    head.tabIndex = -1;
    const list = el("div", { class: "help-entries" });
    lists.set(g.family.id, list);
    // Each family is its own block, because a sticky element cannot leave its containing
    // block. As siblings of one host all six headings would pin against the whole lexicon
    // and stack — the newest opaque one happens to cover the rest, so it LOOKS right, but
    // the last family's heading would then stay pinned over the footer that follows it.
    // One block per family means each heading is released exactly when its own rows end.
    host.append(el("div", { class: "help-family-block" }, head, list));
  }

  host.append(el("p", { class: "help-lex-foot" },
    el("span", {},
      "Framework codes — LLM06, ASI03, ML_DATA_POISONING and the rest — are defined in " +
      "full on the AARS Rules code reference, which also says what this draft prices each " +
      "one at and how many live assets carry it. "),
    el("button", {
      class: "linklike",
      type: "button",
      onclick: () => navigate("aars", {}),
    }, "Open the code reference →"),
  ));

  return {
    node: host,
    fill(resolved) {
      for (const g of groupByFamily(resolved)) {
        const list = lists.get(g.family.id);
        if (!list) continue;
        clear(list);
        for (const entry of g.entries) list.append(entryRow(entry));
      }
    },
  };
}

function entryRow(entry) {
  // tabindex="-1" adds no tab stop; it makes the row a focus target for revealEntry(),
  // which is what a fragment destination has to be if following a "Full definition →" link
  // is to move the reader rather than just the scrollbar.
  const row = el("div", { class: "help-entry", id: entryDomId(entry.id), tabindex: "-1" });

  row.append(el("div", { class: "help-entry-mark" }, entry.mark()));

  const body = el("div", { class: "help-entry-body" },
    el("div", { class: "help-entry-term" },
      entry.term,
      entry.aka ? el("em", {}, " · " + entry.aka) : null),
    el("p", { class: "help-entry-def" }, entry.blurb),
  );
  if (entry.strip) body.append(categoryStrip(entry.strip()));
  if (entry.more) body.append(el("p", { class: "help-entry-more" }, entry.more));
  // Each destination keeps its word and gains the route's own sidebar mark, so the page
  // names one set of pages in one vocabulary rather than two. Deliberately NOT links: the
  // count cell and `entry.link` already own this row's destinations, and 33 rows carrying
  // up to three more buttons each would triple the page's tab stops to reach places the
  // row can already reach.
  if (entry.drawnOn && entry.drawnOn.length) {
    const where = el("div", { class: "help-entry-where" },
      el("span", { class: "help-where-lead" }, "Drawn on"));
    for (const route of entry.drawnOn) {
      where.append(el("span", { class: "help-where-item" },
        el("span", {
          class: "help-where-icon", "aria-hidden": "true", html: ROUTE_ICONS[route] || "",
        }),
        ROUTE_TITLES[route] || route));
    }
    body.append(where);
  }
  row.append(body);
  row.append(countCell(entry));
  return row;
}

/**
 * The count cell, in exactly three states.
 *
 * A number that IS the link, a muted "none in this tenant", or "not counted here" naming
 * the page that does count it. Never a fourth: in particular a zero is never linked,
 * because a count-as-link that opens an empty filtered view teaches the reader that the
 * link is broken rather than that the number is zero.
 */
function countCell(entry) {
  const cell = el("div", { class: "help-entry-count" });

  if (!entry.count) {
    if (entry.link) {
      cell.append(el("button", {
        class: "linklike",
        type: "button",
        onclick: () => navigate(entry.link.route, entry.link.params || {}),
      }, entry.link.label + " →"));
    }
    return cell;
  }

  const res = entry.resolved;
  if (!res) {
    const owner = entry.drawnOn && entry.drawnOn.length ? ROUTE_TITLES[entry.drawnOn[0]] : "";
    cell.append(tip(
      el("span", { class: "help-count-none" }, "not counted here"),
      [
        "No figure for this term in this deployment — an area that is queried but not " +
        "totalled, a payload that did not arrive, or nothing synced yet.",
        owner ? "The " + owner + " page is where this one is read." : "",
      ].filter(Boolean),
      { label: "Why there is no figure" },
    ));
    return cell;
  }

  if (!res.n) {
    cell.append(
      el("span", { class: "help-count-none" }, "none in this tenant"),
      el("span", { class: "help-count-unit" }, res.unit),
    );
    return cell;
  }

  const openable = !!res.route;
  cell.append(
    openable
      ? el("button", {
          class: "help-count-link linklike num",
          type: "button",
          "aria-label": res.value + " " + res.unit + ", open in " + (ROUTE_TITLES[res.route] || res.route),
          onclick: () => navigate(res.route, res.params || {}),
        }, res.value + " →")
      : el("span", { class: "help-count-value num" }, res.value),
    el("span", { class: "help-count-unit" }, res.unit),
  );
  return cell;
}

/** The five category tints, so a colour on screen can be matched to a word. */
function categoryStrip(items) {
  const strip = el("div", { class: "help-catstrip" });
  for (const { cat, label } of items) {
    const chip = el("span", { class: "help-cat" },
      el("span", { class: "help-cat-swatch", "aria-hidden": "true" }),
      label || CATEGORY_LABELS[cat] || cat);
    chip.dataset.category = cat;
    strip.append(chip);
  }
  return strip;
}

// ------------------------------------------------------------------------ deep linking

function entryDomId(id) {
  return "help-term-" + id;
}

/**
 * Scroll a term into view, land on it, and mark it — for a ?term= link off a term trigger, and
 * for a callout naming the term it teaches.
 *
 * The highlight is a class the stylesheet fades out, not a scripted animation, so the
 * reduced-motion block in overrides.css already governs it. The scroll asks for smooth
 * behaviour only when motion is welcome.
 *
 * Focus moves too. Scrolling alone leaves a keyboard or screen-reader reader who followed
 * "Full definition →" sitting at the top of a document that silently jumped somewhere
 * else; `preventScroll` keeps the smooth scroll already in flight from being cancelled by
 * the focus call. And the term goes into the URL, so arriving at a definition by any route
 * leaves an address bar that links back to it — the ?term= deep link has always worked and
 * has never been discoverable.
 */
function revealEntry(id) {
  const node = document.getElementById(entryDomId(id));
  if (!node) return;
  node.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "center" });
  node.focus({ preventScroll: true });
  setParams({ term: id });
  node.classList.remove("revealed");
  // Force a reflow so re-selecting the same term restarts the fade instead of doing
  // nothing because the class never left.
  void node.offsetWidth;
  node.classList.add("revealed");
  // Under prefers-reduced-motion the highlight is a static tint rather than a fade (see
  // help.css), so something has to end it. Leaving the row is the honest end: the reader
  // has arrived and moved on. `once` keeps repeated reveals from stacking listeners.
  node.addEventListener("blur", () => node.classList.remove("revealed"), { once: true });
}
