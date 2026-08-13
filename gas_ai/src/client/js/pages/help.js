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

import { COVERAGE, coverageTally, resolveAreas } from "../scanContent.js";
import {
  ROUTE_TITLES, findEntry, groupByFamily, resolveEntries,
} from "../helpContent.js";
import { CATEGORY_LABELS, kindIcon, svgEl } from "../icons.js";
import { bootstrap, bootstrapCached, navigate, swrCall } from "../store.js";
import {
  clear, el, fmtDateTime, helpTip, motionOk, sectionLabel, statusPill,
} from "../ui.js";

// Byte-identical to the constants pages/scans.js, pages/inventory.js and pages/combos.js
// call with, so swrCall's key is shared: arriving here from any of them costs no round
// trip at all. Only the HEAD of the assets payload is read (kpis), never `rows`, so a
// small pageSize keeps this correct AND cheap at any estate size.
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

export async function renderHelp(main, params, _ctx) {
  const boot = bootstrapCached() || (await bootstrap());

  // One column with a reading width, rather than letting a reference page run out to the
  // full 1800px the pane can offer. The graph and the inventory earn the whole width
  // because their content is a canvas and a register; this page is a document, and a
  // definition whose count sits 900px to its right is two facts, not one row.
  const page = el("div", { class: "help-page" });
  main.append(page);

  page.append(
    el("h1", {}, "Help"),
    el("p", { class: "page-sub" },
      "What every word and mark on these screens means, and how much of each this tenant " +
      "holds. Every figure below is the one the last sync produced."),
    dateline(boot),
  );

  const limitsHost = el("div", { class: "help-limits" });
  const lexHost = el("div", { class: "help-lex" });

  page.append(
    sectionLabel("Where each question is answered"),
    pageMap(),
    sectionLabel("What this app cannot tell you"),
    limitsHost,
    sectionLabel("Anatomy of a node"),
    anatomy(),
    sectionLabel("The vocabulary"),
    lexHost,
  );

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

  // A ?term= deep link, from a helpTip's "full definition" link. Runs after the first
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

    clear(limitsHost).append(limits(areas));
    clear(lexHost).append(lexicon(resolveEntries(ctx)));
  }
}

// ------------------------------------------------------------------------- the dateline

function dateline(boot) {
  const sync = boot.latestSync || null;
  const dryRun = !!sync && String(sync.mode || "") === "dry-run";
  const row = el("p", { class: "help-dateline" });

  // Two different kinds of number appear in the count column and the dateline has to keep
  // them apart. A MEASUREMENT comes from the last sync and needs one. A SETTING — the
  // depth, the node budget, the pillar caps, the band thresholds — is the model in force
  // right now and is just as true before the first sync as after it. Saying "no term
  // below carries a count" while four of them show a figure is the kind of small
  // over-claim PRODUCT.md's honest-state principle is aimed at.
  if (!sync) {
    row.append(
      statusPill("neutral", "No sync yet"),
      el("span", {},
        "Nothing has been collected, so no term below carries a figure from your estate — " +
        "the scoring model and view settings shown are still the ones in force. Run " +
        "“Sync now” in the sidebar; without credentials it loads the sample dataset."),
    );
    return row;
  }
  row.append(
    dryRun
      ? statusPill("neutral", "Dry-run · sample data")
      : statusPill("ok", "Live · this tenant"),
    el("span", {},
      "Figures are from the sync of " + fmtDateTime(sync.finished_at) +
      "; the scoring model and view settings are the ones in force now."),
  );
  return row;
}

// -------------------------------------------------------------------------- the page map

function pageMap() {
  const list = el("div", { class: "help-map" });
  for (const [route, question] of PAGE_MAP) {
    list.append(el("div", { class: "help-map-row" },
      el("span", { class: "help-map-page" }, ROUTE_TITLES[route]),
      el("span", { class: "help-map-q" }, question),
      el("button", {
        class: "linklike",
        type: "button",
        onclick: () => navigate(route, {}),
      }, "Open →"),
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
      "Every scan area this app queries is currently reporting a figure."));
    return host;
  }

  for (const area of gaps) {
    const meta = COVERAGE[area.state];
    // The glyph is the non-colour cue, but a glyph nobody has a key for is a decoration.
    // The state's WORD leads the note, so the row says what it means without the reader
    // having to learn that a half-filled circle is "partial" first.
    host.append(el("div", { class: "help-limit-row", "data-state": area.state },
      el("span", { class: "help-limit-glyph", "aria-hidden": "true" }, meta.glyph),
      el("span", { class: "help-limit-name" }, area.title),
      el("span", { class: "help-limit-note" },
        el("b", { class: "help-limit-state" }, meta.label + " — "),
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
    title: "The AARS score",
    text: "0 to 100 across four pillars. Its band is set on the AARS Rules page and applies retroactively.",
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
  "node shows a High severity dot and label and an AARS score of 78. A dashed edge labelled " +
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

  // The node itself: pale category tint, saturated left stripe, icon, name, kind.
  const kind = group("kind");
  add(kind, "rect", {
    class: "help-node-box", x: 24, y: 30, width: 220, height: 72, rx: 10,
    "data-category": "asset",
  });
  add(kind, "rect", {
    class: "help-node-accent", x: 24, y: 38, width: 3, height: 56, rx: 1.5,
    "data-category": "asset",
  });
  kind.append(specimenMark("AI_AGENT", "asset", "translate(38,42)"));
  add(kind, "text", { class: "help-node-name", x: 62, y: 54 }, "checkout-bot");
  add(kind, "text", { class: "help-node-kind", x: 62, y: 68, "data-category": "asset" }, "AI AGENT");

  const sev = group("sev");
  add(sev, "circle", { class: "help-node-dot", cx: 41, cy: 85, r: 4 });
  add(sev, "text", { class: "help-node-sev", x: 50, y: 89 }, "High");

  const aars = group("aars");
  add(aars, "text", { class: "help-node-aars", x: 230, y: 89, "text-anchor": "end" }, "AARS 78");

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
  signal.append(specimenMark("MISSING_GUARDRAIL", "vuln", "translate(428,58)"));
  add(signal, "text", { class: "help-node-name", x: 452, y: 62 }, "No Guardrail");
  add(signal, "text", {
    class: "help-node-kind", x: 452, y: 76, "data-category": "vuln",
  }, "RISK SIGNAL");

  return svg;
}

// -------------------------------------------------------------------------- the lexicon

function lexicon(resolved) {
  const host = el("div", {});
  const groups = groupByFamily(resolved);

  for (const g of groups) {
    host.append(el("h3", { class: "help-family", id: "help-family-" + g.family.id },
      g.family.title));
    const list = el("div", { class: "help-entries" });
    for (const entry of g.entries) list.append(entryRow(entry));
    host.append(list);
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
  return host;
}

function entryRow(entry) {
  const row = el("div", { class: "help-entry", id: entryDomId(entry.id) });

  row.append(el("div", { class: "help-entry-mark" }, entry.mark()));

  const body = el("div", { class: "help-entry-body" },
    el("div", { class: "help-entry-term" },
      entry.term,
      entry.aka ? el("em", {}, " · " + entry.aka) : null),
    el("p", { class: "help-entry-def" }, entry.blurb),
  );
  if (entry.strip) body.append(categoryStrip(entry.strip()));
  if (entry.more) body.append(el("p", { class: "help-entry-more" }, entry.more));
  if (entry.drawnOn && entry.drawnOn.length) {
    body.append(el("div", { class: "help-entry-where" },
      "Drawn on: " + entry.drawnOn.map((r) => ROUTE_TITLES[r] || r).join(" · ")));
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
    cell.append(helpTip(
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
 * Scroll a term into view and mark it, for a ?term= link off a helpTip.
 *
 * The highlight is a class the stylesheet fades out, not a scripted animation, so the
 * reduced-motion block in overrides.css already governs it. The scroll asks for smooth
 * behaviour only when motion is welcome.
 */
function revealEntry(id) {
  const node = document.getElementById(entryDomId(id));
  if (!node) return;
  node.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "center" });
  node.classList.remove("revealed");
  // Force a reflow so re-selecting the same term restarts the fade instead of doing
  // nothing because the class never left.
  void node.offsetWidth;
  node.classList.add("revealed");
}
