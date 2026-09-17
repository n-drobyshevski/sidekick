// Cold zone — where the backlog has stopped moving, and which assets the scanner has lost
// sight of.
//
// EVERY OTHER PAGE IN THIS REGISTER ANSWERS "HOW FAST IS RISK CLOSING". This one answers the
// other question: WHERE HAS IT STOPPED. An asset can carry a small backlog and still be the
// worst thing on the screen if nobody has touched it since January; an asset with a thousand
// findings and a fix landing every week is not a problem of engagement. Backlog size cannot
// tell those two apart, so this page reads IDLE TIME instead of volume.
//
// TWO STATES, NOT ONE, AND THE SECOND ONE IS WHY THE PAGE IS CAREFUL. `cold` is a fact about a
// support group: the asset is still being scanned, it still has open findings, and nothing on
// it has been resolved for at least the window. `unobserved` is a fact about the SCANNER, and
// `src/domain/coldZone.ts` tests it FIRST — `reconcile` resolves findings absent from the
// newest scan BY DISAPPEARANCE, so an asset that drops out of coverage looks mass-remediated
// in exactly one scan. Reading that as warmth would reward losing sight of an asset. The two
// share the second table and are counted apart in the cards, and the verdict column says which
// kind each row is.
//
// THE LINE CAN BE DRAWN TWO WAYS, AND NOTHING HERE BRANCHES ON WHICH. The operator either
// names a WINDOW (fixed: cold after 90 idle days) or names a SHARE (relative: the idlest 20%
// of the assets with open findings are cold, floored so a healthy estate is not slandered).
// Both produce ONE effective threshold in days, and `cold_after_days` is always that threshold
// — so every figure, bucket and cell below reads one number and no renderer asks which mode it
// came from. What the mode changes is the SENTENCE: `coldModeCaption` heads the page with
// where the line came from, the cold-assets card's denominator repeats it one level down, the
// support-group table grows a relative rank beside the absolute verdict, and the scatter's
// rule says "(relative)" when the line was derived.
//
// THE DECISIONS ARE NEXT DOOR. `pages/coldZoneModel.js` is the DOM-free twin — every view
// model, every sentence and every row shape — for the reason `overviewModel.js` and
// `historyModel.js` already are: the interesting cases are payload shapes, not pixels. This
// file is the DOM half and nothing else.

import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  applyColdSelection, coldBandKeyModel, coldBandScale, coldCensusModel, coldGroupRows,
  coldGroupScatterPoints, coldKpiCards, coldModeCaption, coldScatterPoints, coldSelection,
  coldSelectionNote, coldZoneView, coldestShareNote, groupCountNote, severitiesNote,
  unmeasurableNote,
} from "./coldZoneModel.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  DEFAULT_PAGE_SIZE, absent, absentText, bandBar, bandBarModel, chartTable, chartTableModel,
  clear, dataTable, days1, denomNote, el, emptyState, errorState, figureCard, filterChipRow,
  firstRunNotice, fmtCount, meter, onPageTeardown, pageHeader, pageOf, pct1, scopeBar,
  sectionLabel, segmented, skeletonStack, sortRows, statusPill, tableFooter, tipLabel,
  unitGrid, unitKeyRow, verdictMark,
} from "../ui.js";

// ------------------------------------------------------------------------- local helpers
//
// Two of them, and neither is a component this app was missing: both are one-page shapes the
// sibling register already worked out, ported rather than promoted because a second consumer
// is what promotes a helper and this is the first.

/**
 * A paged, sortable table with its footer — `dataTable` + `tableFooter` + `sortRows` +
 * `pageOf`, wired the way every table in the sibling register is.
 *
 * PRIVATE ON PURPOSE. It is four shared primitives in the arrangement this page's two tables
 * both want; the day a third page here wants the same arrangement is the day it moves to
 * `gas_shared/ui`, and not before.
 */
function pagedTable(spec) {
  const { columns, rows, sortSpec, emptyText } = spec;
  let page = 0;
  let pageSize = DEFAULT_PAGE_SIZE;

  const host = el("div", { class: "table-host" });
  const sorted = sortRows(rows, sortSpec || {});

  function paint() {
    const cut = pageOf(sorted, page, pageSize);
    page = cut.page;
    const table = dataTable({
      columns,
      rows: cut.rows,
      emptyText: emptyText || "Nothing to show.",
    });
    const footer = tableFooter({
      page,
      pageCount: cut.pageCount,
      total: sorted.length,
      pageSize,
      onPage: (p) => { page = p; paint(); },
      onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; paint(); },
    });
    host.replaceChildren(table, footer);
  }
  paint();
  return host;
}

// `VERDICT_KINDS` and `verdictMark` USED TO LIVE HERE, as a copy of gas_devsecops's
// `ui/verdict.js` — the same table, the same DOM, and a byte-identical ruleset in pages.css.
// Both halves are `gas_shared` now (`ui/verdict.js`, `styles/components.css`); this page
// imports the mark like any other component. The local copy's own comment named the trigger
// for the move and then did not take it: "a second consumer is what promotes a rule".

// ----------------------------------------------------------------------------- the page

export async function renderColdZone(main, _params, ctx) {
  const boot = await bootstrap();

  // Which severities every figure on this page reflects — the app-wide "Display severity"
  // setting, so the page opens scoped exactly like Overview, MTTR and Program performance.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  const severities = sevScope.length === boot.palette.selectable.length ? null : sevScope;

  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";

  main.append(pageHeader({
    route: "coldZone",
    help: { term: "cold-zone" },
    lede: "Where the backlog has stopped moving, and which assets the scanner has lost sight"
      + " of.",
  }));

  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);

  // FIRST-RUN GATE BEFORE ANY CARD OR CANVAS. Nothing below this point exists yet — the hosts
  // are appended after it — so a first run leaves one notice and no dashed figures over a
  // population nobody has looked at (CLAUDE.md: an unmeasured register is not a register of
  // zeroes). test/emptyStates.test.js holds this return ahead of the first el("canvas".
  if (!boot.latestScan) {
    main.append(firstRunNotice({
      synced: false,
      hint: "Idle time is counted back from the last scan, so this page appears once one has"
        + " been taken. Use “Run scan” in the sidebar.",
    }));
    return;
  }

  const host = el("div", {});
  main.append(host);
  host.append(skeletonStack(4, { variant: "stat" }));

  // OUTSIDE `paint`, WHICH REBUILDS EVERY SECTION. An SWR refresh repaints this page from the
  // fresh payload, and a reader who switched the scatter to support groups a second earlier
  // meant it about the section, not about the one paint that happened to be on screen. It is
  // deliberately not in the URL: `setParams` replaces the whole query string and does not
  // re-render, and a lens on one chart is not a different question being asked of the server.
  let scatterGrain = "asset";

  // The same reasoning, for the assets table's cut. A reader who narrowed to the backlog left
  // behind means it about the section, not about the paint that happened to be on screen.
  //
  // THE BAND RIDES INSIDE THIS VALUE rather than beside it: "all" | "cold" | "lost" |
  // "band:N". `coldSelection` reads the two apart. Fusing them is what removes the corner a
  // reader could otherwise ask for and never get — an unobserved asset has no bucket, so "out
  // of sight" crossed with an idle band is empty by construction.
  let assetCut = "all";

  // The other axis. A support group, or null. Same argument as the cut for why it is a
  // module-local `let` and not a URL parameter — `setParams` replaces the whole query string
  // and does not re-render, and every asset a selection can reach is already in the payload
  // this page holds, so a selection repaints and never refetches. A group in the URL would
  // also be a SECOND spelling of "which support group", beside the header scope chip that
  // really does refetch, and the two could disagree.
  let coldGroup = null;

  // Set by `renderAssets`, called by whichever control changed the selection.
  let repaintAssets = null;

  let paint = null;
  const promise = swrCall(
    "api_getColdZonePage",
    { domain, supportGroup, severities },
    (fresh) => paint && paint(fresh),
  );

  /**
   * Four figures, a census, one table, a list and a scatter — or one notice.
   *
   * NEITHER ABSENCE IS AN ERROR, and both are drawn with `emptyState(…, {variant:"notice"})`
   * rather than `errorState`. A register with no flat scan on record has no clock to measure
   * idleness against, and a register whose assets are all clear and all still returned by the
   * newest scan has nothing to be idle. Both are states this page renders correctly; a red
   * role="alert" box would tell a reader the page is broken. `errorState` is for the one thing
   * that IS a failure — the RPC not answering — and it lives in the catch below.
   */
  paint = (model) => {
    const view = coldZoneView(model);
    clear(host);
    // FIRST, IN ALL THREE BRANCHES. Every figure below is read off one line in days, and the
    // same number means different things depending on which mode drew it — so the sentence
    // that says which one goes ABOVE the figures rather than under them, and it is printed on
    // the two notice branches too, where the line is the only thing there is to say.
    host.append(denomNote(coldModeCaption(view)));
    if (!view.measurable) {
      host.append(emptyState(
        "The cold zone is not measured yet.",
        "Idle time is counted from the last scan back to the movement before it, and no flat"
        + " scan has been saved, so there is no clock to measure idleness against.",
        { variant: "notice" },
      ));
      return;
    }
    if (!view.populated) {
      host.append(emptyState(
        "No asset is sitting still.",
        "Nothing has an open finding to go quiet on, and the scanner has not lost sight of any"
        + " asset. This page fills in when one of those two things is true.",
        { variant: "notice" },
      ));
      return;
    }
    renderKpis(view);
    renderGroups(view);
    renderAssets(view);
    renderChart(view);
  };

  try {
    paint(await promise);
  } catch (e) {
    console.error("[coldZone] api_getColdZonePage failed:", e);
    // errorState, because this IS a failure: the RPC did not answer. Every other absence on
    // this page — an unmeasured cold zone, an estate with nothing idle, a scatter with no
    // point to plot — renders through `emptyState` instead.
    clear(host).append(errorState("Couldn't load the cold zone.", {
      detail: String((e && e.message) || e),
      onRetry: () => ctx.refresh(),
    }));
  }

  /**
   * The four figures and the census they give a shape to, side by side.
   *
   * ONE BAND INSTEAD OF TWO. The figures and the lattice answer the same question at two
   * grains — how much of the estate has gone quiet, and what the whole estate looks like — and
   * stacking them put a screen of scroll between a number and the picture of it. `.card-pair`
   * is the shared two-column grid (components.css), with its own 1100px breakpoint, so this
   * costs no layout rule and collapses to the old stack on a narrow viewport.
   *
   * THE FIGURES ARE NOT IN A CARD. `.card-pair` gives its `.card` children their surface, and
   * the census is the one that has content genuinely distinct from the page around it; a card
   * around the figure strip as well would be a card inside a card, which DESIGN.md forbids
   * outright, and `.kpi-card` already carries its own border.
   */
  function renderKpis(view) {
    const row = el("div", { class: "kpi-row cold-figures" });
    for (const card of coldKpiCards(view)) {
      row.append(figureCard({
        label: card.label,
        value: card.value,
        sub: card.sub,
        help: card.help || null,
        denominator: card.denominator,
      }));
    }
    const census = censusCard(view);
    // No census to draw — an unmeasured denominator — leaves the figures the full width rather
    // than a half-width column beside an empty track.
    host.append(census ? el("div", { class: "card-pair" }, row, census) : row);
    // The assets none of the four figures can speak for, said out loud rather than left to a
    // column of the distribution to imply. Null when there are none — an always-printed
    // sentence about zero assets is noise. It stays on the SURFACE: it is an honesty
    // statement about what the figures above it cannot speak for, not an explanation of one.
    const note = unmeasurableNote(view);
    if (note) host.append(denomNote(note));
    // The severities observation could not be decided for. The rail here is single-scope, so
    // this is the analogue of the sibling register's per-scope caveat.
    const sevs = severitiesNote(view);
    if (sevs) host.append(denomNote(sevs));
  }

  /**
   * The census, beside the four figures it gives a shape to. Drawn only where the register has
   * assets to count: `coldCensusModel` returns null otherwise, and a lattice over an unmeasured
   * denominator is the confident zero this page refuses everywhere else.
   *
   * The key row carries every figure in words, which is why this owes no `chartTable`
   * disclosure the way a canvas on this page does.
   */
  function censusCard(view) {
    const model = coldCensusModel(view);
    if (!model || !model.measured) return null;
    // THE CLASS IS ON THE CARD, not only on the lattice inside it: the key row is a SIBLING
    // of the grid, and its swatches have to take the same field-grade fills or the key and
    // the picture stop being obviously one vocabulary.
    return el("div", { class: "card cold-census" },
      sectionLabel("Every asset, by what the clock can say"),
      unitGrid(model, { className: "cold-census" }),
      unitKeyRow(model));
  }

  /**
   * One row per support group, with its idle distribution in the row rather than in a second
   * table a screen below.
   *
   * THE GRID FOLDED INTO THIS TABLE. `renderHeat` drew a support-group x idle-band matrix,
   * keyed on exactly the same support group as the roll-up above it, so a reader comparing
   * "who is coldest" with "where is their idle time" did it by scrolling between two tables.
   * `bandBar` puts the distribution in the row it describes.
   *
   * WHAT THE FOLD COST, AND WHERE IT WENT. A matrix can be read DOWN a column ("who else is
   * past 90 days?"); a column of bars cannot. Three things buy that back. The bars share ONE
   * scale (`coldBandScale`), so length still compares down the table. The grid's totals row is
   * still on the surface, as the band key row above — which is also the control. And pressing
   * a band dims every other band in every row at once, which is the column read as an action
   * rather than as a layout. The per-cell figures the grid printed are in each bar's
   * `aria-label` and its tip: one level down, not gone.
   */
  function renderGroups(view) {
    const rows = coldGroupRows(view);
    // THE DENOMINATOR RIDES ON THE HEADING rather than as a paragraph under the table. It
    // explains a count the footer already prints on the surface — "6 support groups, including
    // the 1 asset with no support group recorded" — and `gas_devsecops/DESIGN.md`'s rule is
    // that an honesty statement stays on the surface and an EXPLANATION goes one level down.
    // This is the second kind. The unmapped-map warning below is the first, and it stays.
    host.append(el("h3", { class: "section-label" },
      tipLabel("By support group", { lines: [groupCountNote(view, rows.length)] })));
    if (!rows.length) {
      host.append(emptyState(
        "No support group has an asset to report on yet.",
        "A support group appears here as soon as one of its assets carries a finding.",
        { variant: "notice" },
      ));
      return;
    }

    // ONE SCALE FOR THE WHOLE TABLE. See `coldBandScale`, and gas_shared/ui/bandBar.js for the
    // defect it refuses: a bar normalised to its own row draws 280 assets and 30 assets the
    // same length, and the column stops being readable — which is what the fold was paid for.
    const scale = coldBandScale(rows);
    renderBandKeys(view);

    host.append(pagedTable({
      columns: [
        {
          key: "label", label: "Support group",
          // THE ROW'S NAME IS THE CONTROL, and it is one tab stop per row — the stop a
          // clickable row already costs. The bars are NOT controls: five segments per row
          // times N rows is 5N new stops, which is the arity rule `quad.js` states and
          // `bandBar`'s own contract holds it to.
          cell: (r) => el("button", {
            type: "button", class: "linklike group-pick", "data-group-pick": r.key,
            "aria-pressed": coldGroup === r.key ? "true" : "false",
            onclick: () => pickGroup(r.key),
          }, r.label),
        },
        {
          key: "verdict", label: "Verdict",
          // The dot AND the word, never the dot alone.
          cell: (r) => verdictMark(r.verdict, r.verdictWord),
        },
        { key: "assets", label: "Assets", className: "num", cell: (r) => fmtCount(r.assets) },
        {
          // THE OLD HEAT ROW, IN ONE CELL. `assets` stays a real column beside it: `buckets`
          // sums only to the assets that HAVE an idle reading, and an unobserved or clear
          // asset sits in no band at all, so deriving the count from the distribution would be
          // wrong by exactly the population this page exists to talk about.
          key: "bands", label: "Idle profile",
          help: {
            term: "idle",
            lines: [
              "Every asset with an idle reading, in the band that reading falls in.",
              "Assets the scanner has lost sight of, and ones with nothing open, are in no"
                + " band.",
            ],
          },
          cell: (r) => {
            const model = bandBarModel({
              bands: r.bands, max: scale, unit: "assets", name: r.label,
            });
            const wrap = el("span", { class: "bandcell" });
            // Kept on the node so a selection change repaints the bar without rebuilding the
            // table under the reader's focus.
            wrap.bandModel = model;
            wrap.append(bandBar(model, { selected: selectedBand() }));
            return wrap;
          },
        },
        {
          // COUNT AND SHARE IN ONE COLUMN, because they are one fact at two grains and the
          // distribution beside them needs the width more. Two columns of four characters each
          // squeezed the share's meter onto its own line, where a decorative track under a
          // number reads as a second figure rather than as a picture of the first.
          key: "cold", label: "Cold", className: "num",
          help: { term: "cold-zone" },
          cell: (r) => {
            const count = fmtCount(r.coldAssets);
            // A null share draws NO meter and no percentage: see `coldGroupRows` for the
            // refusal, and why an empty track would be a claim rather than a blank.
            if (r.sharePct === null) return el("span", {}, count, " ", absent());
            return el("span", { class: "rate-with-meter" },
              count + " · " + pct1(r.sharePct),
              meter(r.sharePct, { className: "meter--stat", decorative: true }));
          },
        },
        {
          // THE RELATIVE POSITION, beside the absolute verdict rather than instead of it. The
          // rank is computed in both modes so the column always reads; the BADGE is a claim
          // about a target share and only relative mode names one, so it appears only there.
          // `warn` rather than `bad` on purpose: being the coldest support group on a healthy
          // estate is a POSITION, not a verdict, and the Verdict column earlier in the same
          // row is where the absolute reading lives.
          // THE CLAMP THAT DECIDES WHO IS MARKED, on the column that carries the mark, rather
          // than as a fifth paragraph under the table. Null in fixed mode, where nothing is
          // marked and there is no claim to explain.
          key: "coldestRank",
          label: "Coldest rank",
          help: {
            term: "coldest-share",
            lines: coldestShareNote(view) ? [coldestShareNote(view)] : [],
          },
          cell: (r) => {
            const rank = r.relativeRank === null ? absentText : fmtCount(r.relativeRank);
            if (!r.inColdestShare) return rank;
            return el("span", {},
              rank,
              " ",
              statusPill("warn", "Coldest " + fmtCount(view.targetSharePct) + "%"));
          },
        },
        {
          key: "openInCold", label: "Open in cold", className: "num",
          cell: (r) => fmtCount(r.openInCold),
        },
        {
          key: "highRiskInCold", label: "High-risk in cold", className: "num",
          cell: (r) => fmtCount(r.highRiskInCold),
        },
        {
          // A DATE, not a figure — left-aligned like every other date column in this app.
          key: "lastMovement", label: "Last movement",
          help: {
            term: "idle",
            lines: [
              "The most recent finding resolved anywhere in the support group, over the assets"
              + " the scanner still returns.",
            ],
          },
          cell: (r) => r.lastMovementText,
        },
      ],
      rows,
      // NO SORT SPEC — see `coldGroupRows`: the payload's own order is the published one, and
      // `sortRows` leaves a list untouched when it is given no value function.
      emptyText: "No support group has an asset to report on yet.",
    }));
    // UNDER AN ACTIVE SUPPORT-GROUP SCOPE THIS TABLE IS ONE ROW, and that is the scope doing
    // its job rather than a group having vanished. Said here because a one-row roll-up with no
    // explanation reads as a broken join — the header chip is several inches away and answers
    // a different question ("what am I looking at") from this one ("why is there one row").
    if (supportGroup) {
      host.append(denomNote("The header scope is one support group, so this roll-up has one"
        + " row. Clear the scope to compare it with the others."));
    }
    // THE MAP IS A LIVE JOIN, AND AN UNREFRESHED ONE PUTS EVERY ASSET IN ONE BUCKET. Same
    // finding pages/attribution.js states for the same map, in the same voice: the two failure
    // modes an operator otherwise cannot tell apart are "never built" and "built but not
    // joining", and a page that silently rolled the whole estate up under "(no support group)"
    // would look like the second while being the first.
    const t = view.totals;
    const noGroup = t ? t.assets_no_support_group : 0;
    if (t && noGroup > 0 && noGroup === t.assets) {
      host.append(denomNote("Every asset is in the (no support group) row — support groups"
        + " aren’t mapped yet. Use “Refresh support groups” in Settings to build the map;"
        + " Attribution shows what the map currently joins."));
    }
  }

  /** The band currently selected, as a key, or null. */
  function selectedBand() {
    return assetCut.indexOf("band:") === 0 ? assetCut : null;
  }

  /**
   * The band key row: the heat grid's totals row, still on the surface, now doing a second job.
   *
   * WHERE THE FIVE TAB STOPS GO. The bars below refuse to be controls because five per row
   * times N rows is 5N stops; this row spends five ONCE, for the whole table. It is the
   * `sevKeyRow({variant:"toggle"})` recipe: an `aria-pressed` button per band, carrying the
   * band's word and its estate-wide count, so the row reads as information whether or not
   * anyone presses it.
   */
  function renderBandKeys(view) {
    const keys = coldBandKeyModel(view);
    if (!keys.length) return;
    const row = el("div", { class: "bandkeys", role: "group", "aria-label": "Filter by idle band" });
    for (const k of keys) {
      row.append(el("button", {
        type: "button", class: "bandkey", "data-band-key": k.key,
        "data-rank": k.rank === null ? "none" : String(k.rank),
        "aria-pressed": selectedBand() === k.key ? "true" : "false",
        onclick: () => pickBand(k.key),
      },
      el("span", { class: "bandkey__swatch", "aria-hidden": "true" }),
      el("span", { class: "bandkey__label" }, k.label),
      el("span", { class: "bandkey__num num" }, fmtCount(k.count))));
    }
    host.append(row);
  }

  /**
   * Pressing a band, and pressing it again to let go.
   *
   * IT MOVES THE CUT rather than setting a second state beside it, so the three-way control
   * below and the band can never disagree. Choosing All / Cold / Out-of-sight clears the band
   * for the same reason, and neither control is ever disabled.
   */
  function pickBand(key) {
    assetCut = assetCut === key ? "all" : key;
    syncSelection();
  }

  function pickGroup(key) {
    coldGroup = coldGroup === key ? null : key;
    syncSelection();
  }

  /**
   * Repaint what the selection changed, and nothing else.
   *
   * MARKED IN PLACE, NEVER REBUILT. The controls are the band key row and the group name
   * buttons; rebuilding either would tear the focused button out from under the reader
   * mid-press. So the buttons keep their nodes and only their `aria-pressed` moves, the bars
   * are redrawn inside cells nobody is focused in, and the assets table — which holds no
   * control that could have started this — is the one thing rebuilt wholesale.
   */
  function syncSelection() {
    const band = selectedBand();
    for (const btn of host.querySelectorAll("[data-band-key]")) {
      btn.setAttribute("aria-pressed",
        btn.getAttribute("data-band-key") === band ? "true" : "false");
    }
    for (const btn of host.querySelectorAll("[data-group-pick]")) {
      const on = btn.getAttribute("data-group-pick") === coldGroup;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const row = btn.closest("tr");
      if (row) row.classList.toggle("is-picked", on);
    }
    for (const cell of host.querySelectorAll(".bandcell")) {
      if (!cell.bandModel) continue;
      clear(cell).append(bandBar(cell.bandModel, { selected: band }));
    }
    if (repaintAssets) repaintAssets();
  }
  /**
   * Cold assets and the ones the scanner has lost sight of, over one table with three cuts.
   *
   * THE CUT EXISTS BECAUSE THE CENSUS CREATED A QUESTION IT COULD NOT ANSWER. "Out of sight,
   * backlog open" is the one segment on this page that is unambiguously work — findings
   * stranded on assets nobody is scanning any more — and a reader who saw the figure had a
   * list of hundreds to go and find them in. Every row is already here; what was missing was a
   * way to ask for the ones that matter.
   *
   * ALL THREE CUTS COME OFF ONE ARRAY. The rows are in the payload the page already holds, so
   * the switch repaints and never refetches, and the counts sit on the option labels so a
   * reader can see what each cut holds before choosing it.
   *
   * THE COLUMNS FOLLOW THE CUT, WHICH IS THIS FILE'S OWN ANSWER TO A PROBLEM IT ALREADY NAMES.
   * `hideableColumn` / `columnsButton` exist in gas_shared and no page in this app wires the
   * chooser, because that needs a column-choice store and a repaint path — a table-state
   * feature rather than a cold-zone one, and still true. A cut that knows its own columns costs
   * nothing and says more: on the out-of-sight cut the idle reading LEAVES (it measures a
   * silence the scanner can no longer see) and the two observation columns arrive in its place.
   */
  function renderAssets(view) {
    const countOf = (cut) => applyColdSelection(view, coldSelection(cut, coldGroup)).length;

    const toggle = segmented({
      options: ["all", "cold", "lost"].map((value) => ({
        value,
        // THE COUNT RIDES ON THE LABEL. A cut a reader cannot size before opening it is a cut
        // they open to find out, and the interesting one here is often empty — which is good
        // news they should be able to read without a click.
        label: (value === "all" ? "All" : value === "cold" ? "Cold" : "Out of sight, backlog open")
          + " " + fmtCount(countOf(value)),
        title: value === "lost"
          ? "Assets the newest scan no longer returns that still carry open findings. Nobody"
            + " will be told about that backlog again."
          : value === "cold"
            ? "Assets the scanner still returns, still carrying open findings, with nothing"
              + " resolved for at least the window."
            : "Both: every cold asset and every one the scanner has lost sight of.",
      })),
      value: assetCut,
      ariaLabel: "Which assets to list",
      onChange: (v) => {
        if (v === assetCut) return;
        // CHOOSING ONE OF THE THREE CLEARS THE BAND, because the band lives in this same
        // value. Nothing is disabled and nothing is hidden: the two readings cannot disagree
        // because there is only one of them.
        assetCut = v;
        syncSelection();
      },
    });

    // WHAT IS CURRENTLY BEING ASKED FOR, said where the answer is. A reader who pressed a band
    // four sections up needs the narrowing named beside the list it narrowed, and needs to be
    // able to let go of it without hunting back for the control. `filterChipRow` already moves
    // focus correctly when a chip is removed.
    const chips = filterChipRow({
      onPatch: (patch) => {
        if (patch.band) assetCut = "all";
        if (patch.group) coldGroup = null;
        syncSelection();
      },
      onClearAll: () => { assetCut = "all"; coldGroup = null; syncSelection(); },
      emptyText: "Showing every asset this page is about.",
      ariaLabel: "Applied filters",
    });

    // THE LIST MOVED, SAID OUT LOUD. A selection made three sections away changes this table
    // silently for a reader who cannot see it; one polite live region is the whole fix, and it
    // speaks the same sentence the count under the table prints.
    const live = el("p", { class: "sr-only", role: "status", "aria-live": "polite" });

    host.append(el("div", { class: "section-head" },
      el("h3", { class: "section-label" }, "Cold and unobserved assets"),
      el("div", { class: "toolbar-group" },
        el("span", { class: "small muted" }, "Show"),
        toggle)));
    host.append(chips);
    host.append(live);

    const tableHost = el("div", {});
    host.append(tableHost);
    repaintAssets = paintAssets;
    paintAssets();

    function paintAssets() {
      const sel = coldSelection(assetCut, coldGroup);
      const lost = sel.cut === "lost";
      const rows = applyColdSelection(view, sel);
      toggle.set(["all", "cold", "lost"].indexOf(sel.cut) === -1 ? "all" : sel.cut);
      const entries = [];
      if (sel.band !== null) {
        const def = coldBandKeyModel(view).find((k) => k.key === sel.cut);
        if (def) entries.push({ label: "Idle band", value: def.label, patch: { band: true } });
      }
      if (sel.group !== null) {
        entries.push({ label: "Support group", value: sel.group, patch: { group: true } });
      }
      chips.sync(entries);
      live.textContent = coldSelectionNote(view, sel, rows.length);
      clear(tableHost);
      if (!rows.length) {
        // EACH CUT'S ABSENCE IS ITS OWN SENTENCE, and the important one is GOOD NEWS. An empty
        // out-of-sight cut means no backlog has been left behind anywhere, which is the best
        // reading this page can produce; phrasing it as a bare "nothing to show" would file it
        // beside a failure.
        // A NARROWED CUT THAT IS EMPTY IS A DIFFERENT SENTENCE from an estate that has nothing
        // to report. "No asset is cold" over a support group the reader just picked would be a
        // claim about the whole register, read off a filtered list.
        const narrowed = sel.band !== null || sel.group !== null;
        tableHost.append(emptyState(
          narrowed
            ? "Nothing in this cut."
            : lost
              ? "No backlog has been left behind."
              : sel.cut === "cold"
                ? "No asset is cold."
                : "No asset is cold, and none has dropped out of the scanner.",
          narrowed
            ? coldSelectionNote(view, sel, 0) + " Clear the filter to see the whole list."
            : lost
              ? "Every asset the scanner has lost sight of had already been cleared when it"
                + " went."
              : "Every asset with an open finding has moved inside the window.",
          { variant: "notice" },
        ));
        return;
      }
      const columns = [
        { key: "label", label: "Asset", cell: (r) => r.label },
        { key: "group", label: "Support group", cell: (r) => r.group },
        { key: "verdict", label: "Verdict", cell: (r) => verdictMark(r.verdict, r.verdictWord) },
      ];
      if (lost) {
        // WHY IT WENT QUIET, IN EVIDENCE RATHER THAN IN A VERDICT. Every asset in this cut is
        // out of sight for the same structural reason — no finding of its reached the newest
        // flat scan covering its severity — so there is no cause to name and naming one would
        // be an invention. What differs is WHEN it stopped being returned and HOW, and these
        // two columns are exactly that: a date with the silence since it, and the size of the
        // exit. A big "closed at once" is the whole asset leaving in one scan; a 1 is an asset
        // that faded as its last finding closed.
        columns.push(
          {
            key: "lastSeen", label: "Last seen",
            help: {
              term: "unobserved",
              lines: [
                "The last time any finding on this asset reached a scan.",
                "Nothing on it has reached the newest scan of any severity it has rows in since.",
              ],
            },
            cell: (r) => {
              if (r.unobservedForDays === null) return r.lastObservedText;
              return el("span", {},
                r.lastObservedText,
                el("span", { class: "small muted" },
                  " — " + days1(r.unobservedForDays) + " ago"));
            },
          },
          {
            key: "vanished", label: "Closed at once", className: "num",
            help: {
              term: "unobserved",
              lines: [
                "How many findings closed by disappearance at the same instant.",
                "A large number is the whole asset leaving in one scan; a single one faded.",
              ],
            },
            cell: (r) => {
              if (!r.disappearedCount) return absent();
              return el("span", {},
                fmtCount(r.disappearedCount),
                el("span", { class: "small muted" }, " on " + r.disappearedText));
            },
          },
        );
      } else {
        columns.push({
          key: "idle", label: "Idle", className: "num", help: { term: "idle" },
          cell: (r) => r.idleText,
        });
      }
      columns.push(
        {
          key: "movement", label: "Last movement",
          // THE TERM OF ART IN THIS COLUMN IS "returned", not "movement": the date needs no
          // glossary, and the suffix beside it does — an asset reading "—" here may have had
          // its movement CLEARED by a reopen rather than never having moved.
          help: {
            term: "returned",
            lines: [
              "The most recent finding resolved on this asset.",
              "N returned counts open findings that have come back at least once.",
              "A return clears the resolved date, so an asset with returns can show none.",
            ],
          },
          cell: (r) => {
            if (!r.reopenedOpen) return r.movementText;
            return el("span", {},
              r.movementText,
              el("span", { class: "small muted" },
                " — " + fmtCount(r.reopenedOpen) + " returned"));
          },
        },
        { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
        { key: "highRisk", label: "High-risk", className: "num", cell: (r) => fmtCount(r.highRisk) },
        {
          key: "oldest", label: "Oldest open", className: "num",
          cell: (r) => (r.oldestOpenAgeDays === null ? absentText : days1(r.oldestOpenAgeDays)),
        },
        // TYPE AND CLOUD AS PLAIN COLUMNS, NOT HIDEABLE ONES — see the cut note above on why
        // this page is not the place to become the app's first reader of the column chooser.
        // Last, because they describe the asset rather than say anything about its silence.
        { key: "assetType", label: "Type", cell: (r) => r.assetType },
        { key: "cloud", label: "Cloud", cell: (r) => r.cloud },
      );
      tableHost.append(pagedTable({
        columns,
        rows,
        // NO SORT SPEC — `coldAssetRows` publishes cold first, then unobserved, biggest backlog
        // first inside each, and that order is this page's whole argument.
        emptyText: "No asset is cold, and none has dropped out of the scanner.",
      }));
      tableHost.append(el("p", { class: "small muted" }, tipLabel(
        lost
          ? fmtCount(rows.length) + " listed: out of sight, backlog open"
          : sel.band !== null || sel.group !== null
            ? coldSelectionNote(view, sel, rows.length)
            : sel.cut === "cold"
              ? fmtCount(rows.length) + " listed: cold"
              : fmtCount(rows.length) + " listed: cold, and out of sight",
        {
          lines: lost
            ? [
              "Assets the newest scan no longer returns that still carry open findings.",
              "The ones it lost after they were already clear are counted in the census and"
                + " not listed here.",
            ]
            : [
              "Every cold asset and every one the scanner has lost sight of.",
              "Warm, clear and not-yet-measurable assets are counted above and not listed here.",
            ],
        },
      )));
    }
  }

  /**
   * Idle time against backlog — one dot per asset, or one per support group.
   *
   * THE SWITCH IS A SWITCH BECAUSE BOTH GRAINS PLOT THE SAME TWO QUANTITIES over the same
   * population: idle days against open findings, for the observed assets that still carry an
   * open finding. A group's dot is an aggregation of the asset dots beside it — its backlog is
   * their backlog added up, and its idle reading is its median member's — so a reader can check
   * one grain against the other by eye rather than taking two pictures on trust.
   * `coldGroupScatterPoints` is where that is argued and measured.
   *
   * ONE CANVAS, REPAINTED, not two canvases hidden past each other: the grain changes the data
   * and never the chart type, and `coldZoneScatter` destroys whatever chart is already on the
   * canvas before it draws. Nothing is refetched — both grains come off the payload this page
   * already holds — and nothing is written to the URL, because the choice is a lens on one
   * section rather than a different question being asked of the server.
   *
   * The loader dance every chart in this app does: Chart.js is a second bundle fetched on
   * demand, a deployment whose CSP refuses it falls back to `chartUnavailable` rather than to a
   * blank box, and the chart is destroyed on teardown so a route change does not leave a live
   * Chart bound to a detached canvas. `chartUnavailable` REPLACES the chart box for good, so it
   * stays on the first build's catch and is never the answer to a grain switch.
   */
  function renderChart(view) {
    const byAsset = coldScatterPoints(view);
    const byGroup = coldGroupScatterPoints(view);
    const toggle = segmented({
      options: [
        {
          value: "asset",
          label: "Asset",
          title: "One dot per asset the newest scan still returns, at its own idle time.",
        },
        {
          value: "group",
          label: "Support group",
          title: "One dot per support group, at its median asset's idle time and its whole"
            + " backlog. Past the line, at least half of its assets are cold.",
        },
      ],
      value: scatterGrain,
      ariaLabel: "Plot one dot per",
      onChange: (v) => {
        if (v === scatterGrain) return;
        scatterGrain = v;
        toggle.set(v);
        paintScatter();
      },
    });
    // NAMED FOR WHAT A DOT IS, so the control, the lead-in and the table's first column agree
    // word for word — and drawn ABOVE the empty branch, so a reader is never shown a control
    // that vanished with the thing it controls.
    host.append(el("div", { class: "section-head" },
      el("h3", { class: "section-label" }, "Idle time against backlog"),
      el("div", { class: "toolbar-group" },
        el("span", { class: "small muted" }, "One dot per"),
        toggle)));
    // ONE EMPTY STATE FOR BOTH GRAINS, and it is not a shortcut: the group points are folded
    // out of exactly the assets the other grain plots, so the two are empty together and there
    // is no grain a reader could be stranded on.
    if (!byAsset.length) {
      host.append(emptyState(
        "No asset to plot yet.",
        "The scatter needs an asset the scanner still returns that has at least one open"
        + " finding.",
        { variant: "notice" },
      ));
      return;
    }
    const canvas = el("canvas");
    const tableHost = el("div", {});
    host.append(el("div", { class: "chart-card" },
      el("div", { class: "chart-box" }, canvas),
      tableHost));

    let bound = false;
    paintScatter();

    function paintScatter() {
      const group = scatterGrain === "group";
      const points = group ? byGroup : byAsset;
      clear(tableHost).append(chartTable({
        canvas,
        caption: group
          ? "Every support group that still has an open finding, its median asset's idle time"
            + " and the backlog of all of them. \"at least\" marks a group whose median asset"
            + " has no movement on record — that figure is a lower bound counted from when"
            + " this register started watching, not a measured silence."
          : "Every asset the newest scan still returns that has an open finding, its idle"
            + " time and its backlog. \"at least\" marks an asset with no movement on record —"
            + " that figure is a lower bound counted from when this register started watching,"
            + " not a measured silence.",
        model: chartTableModel({
          columns: [
            { key: "label", label: group ? "Support group" : "Asset", format: "text" },
            { key: "idleDays", label: "Idle days", format: "days" },
            { key: "open", label: "Open", format: "count" },
            {
              key: "bounded",
              label: "Reading",
              format: "text",
              align: "text",
              value: (p) => (p.bounded ? "at least" : "measured"),
            },
          ],
          rows: points,
        }),
      }));
      loadCharts()
        .then((api) => {
          api.coldZoneScatter(canvas, points, {
            thresholdDays: view.coldAfterDays,
            // The rule's label says "(relative)" when the line was derived, because a dashed
            // rule at 47 days is a different claim depending on where 47 came from.
            mode: view.mode,
            // Only the alt text moves with the grain: a description naming assets over a canvas
            // of support groups would mislead exactly the reader who cannot check it.
            unit: scatterGrain,
          });
          // ONCE PER CANVAS, not once per paint. The canvas outlives every switch, and a second
          // registration would only destroy an already-destroyed chart on the way out.
          if (bound) return;
          bound = true;
          onPageTeardown(() => {
            try {
              api.destroyChart(canvas);
            } catch (e) {
              /* already detached */
            }
          });
        })
        .catch(() => chartUnavailable(canvas));
    }
  }
}
