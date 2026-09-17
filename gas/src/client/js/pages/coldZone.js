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
  coldAssetRows, coldCensusModel, coldGroupRows, coldGroupScatterPoints, coldKpiCards,
  coldModeCaption, coldScatterPoints, coldZoneView, coldestShareNote, groupCountNote, heatModel,
  severitiesNote, unmeasurableNote,
} from "./coldZoneModel.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  DEFAULT_PAGE_SIZE, absent, absentText, chartTable, chartTableModel, clear, dataTable, days1,
  denomNote, el, emptyState, errorState, figureCard, firstRunNotice, fmtCount, meter,
  onPageTeardown, pageHeader, pageOf, pct1, scopeBar, sectionLabel, segmented, skeletonStack,
  sortRows, statusPill, tableFooter, tipLabel, unitGrid, unitKeyRow,
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

/**
 * verdict slug -> the dot's tone.
 *
 * WHY `unobserved` AND `watching` ARE NEUTRAL RATHER THAN BAD. Neither is a statement about a
 * support group. `unobserved` says the SCANNER stopped returning the asset — a fact about the
 * pipeline, which `coldZone.ts` tests first precisely so a drop-out is never read as
 * remediation — and `watching` says the clock has not run long enough to say anything yet.
 * Painting either of them red would publish a verdict nobody measured; both are still counted,
 * separately, and the word says which.
 *
 * `partly-cold` IS THE ONE `warn` TONE: a support group where SOME assets have gone quiet is
 * not the same claim as one where every asset with open findings has, and collapsing the two
 * into `bad` would lose the only distinction the group table's verdict column is there to
 * draw. The three capacity slugs ride along in the same table because the dot vocabulary is
 * one vocabulary — the word beside the dot is what says which question is being answered.
 */
const VERDICT_KINDS = {
  gaining: "ok",
  "keeping-up": "neutral",
  "falling-behind": "bad",
  cold: "bad",
  "fully-cold": "bad",
  "partly-cold": "warn",
  unobserved: "neutral",
  watching: "neutral",
  warm: "ok",
  clear: "ok",
};

/**
 * A verdict as a dot AND a word.
 *
 * THE WORD IS THE SIGNAL AND THE DOT IS THE REDUNDANCY, never the other way round. States told
 * apart by hue alone survive neither greyscale nor a dichromat, which DESIGN.md's
 * accessibility bar forbids outright; the dot is `aria-hidden` for the same reason — it says
 * nothing the word beside it does not. A verdict of null or unrecognised still draws: a
 * neutral dot beside an em dash is the honest picture of a verdict nobody could reach.
 */
function verdictMark(verdict, word) {
  const kind = VERDICT_KINDS[verdict] || "neutral";
  return el("span", { class: "verdict-mark" },
    el("span", { class: "verdict-dot verdict-dot--" + kind, "aria-hidden": "true" }),
    el("span", { class: "verdict-word" }, word === absentText ? absent() : word));
}

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
  let assetCut = "all";

  let paint = null;
  const promise = swrCall(
    "api_getColdZonePage",
    { domain, supportGroup, severities },
    (fresh) => paint && paint(fresh),
  );

  /**
   * Four figures, two tables, a grid and a scatter — or one notice.
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
    renderHeat(view);
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

  function renderKpis(view) {
    const row = el("div", { class: "kpi-row" });
    for (const card of coldKpiCards(view)) {
      row.append(figureCard({
        label: card.label,
        value: card.value,
        sub: card.sub,
        help: card.help || null,
        denominator: card.denominator,
      }));
    }
    host.append(row);
    // The assets none of the four figures can speak for, said out loud rather than left to the
    // heat table's fifth column to imply. Null when there are none — an always-printed
    // sentence about zero assets is noise.
    const note = unmeasurableNote(view);
    if (note) host.append(denomNote(note));
    // The severities observation could not be decided for. The rail here is single-scope, so
    // this is the analogue of the sibling register's per-scope caveat.
    const sevs = severitiesNote(view);
    if (sevs) host.append(denomNote(sevs));
    renderCensus(view);
  }

  /**
   * The census, under the four figures it gives a shape to. Drawn only where the register has
   * assets to count: `coldCensusModel` returns null otherwise, and a lattice over an unmeasured
   * denominator is the confident zero this page refuses everywhere else.
   *
   * The key row carries every figure in words, which is why this owes no `chartTable`
   * disclosure the way a canvas on this page does.
   */
  function renderCensus(view) {
    const model = coldCensusModel(view);
    if (!model || !model.measured) return;
    host.append(el("div", { class: "card" },
      sectionLabel("Every asset, by what the clock can say"),
      unitGrid(model, { className: "cold-census" }),
      unitKeyRow(model)));
  }

  function renderGroups(view) {
    const rows = coldGroupRows(view);
    host.append(el("h3", { class: "section-label" }, "By support group"));
    if (!rows.length) {
      host.append(emptyState(
        "No support group has an asset to report on yet.",
        "A support group appears here as soon as one of its assets carries a finding.",
        { variant: "notice" },
      ));
      return;
    }
    host.append(pagedTable({
      columns: [
        { key: "label", label: "Support group", cell: (r) => r.label },
        {
          key: "verdict", label: "Verdict",
          // The dot AND the word, never the dot alone.
          cell: (r) => verdictMark(r.verdict, r.verdictWord),
        },
        { key: "assets", label: "Assets", className: "num", cell: (r) => fmtCount(r.assets) },
        {
          key: "coldAssets", label: "Cold assets", className: "num",
          help: { term: "cold-zone" },
          cell: (r) => fmtCount(r.coldAssets),
        },
        {
          key: "share", label: "Cold share", className: "num",
          // The percentage plus a picture of it, `decorative` because the figure is already in
          // words beside it. A null share draws NO meter: see `coldGroupRows` for the refusal
          // and why an empty track would be a claim rather than a blank.
          cell: (r) => {
            if (r.sharePct === null) return absentText;
            return el("span", { class: "rate-with-meter" },
              pct1(r.sharePct),
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
          key: "coldestRank", label: "Coldest rank", help: { term: "coldest-share" },
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
    host.append(denomNote(groupCountNote(view, rows.length)));
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
    // The marks in the column above, counted — and the clamp that decides how many there are,
    // stated. Null when nobody is marked, which is every group in fixed mode.
    const coldest = coldestShareNote(view);
    if (coldest) host.append(denomNote(coldest));
  }

  /**
   * The support-group × idle-bucket grid.
   *
   * HAND-BUILT RATHER THAN `dataTable`, and that is the exception this page makes rather than
   * a component it is missing: no table in `gas_shared` takes a per-cell ordinal shade, and the
   * one this needs (`data-level` off `heatLevel`, styled in pages.css) is meaningful on exactly
   * one grid in one app. Adding it to the shared component would put a shading channel in front
   * of every register that has no use for one.
   *
   * THE HEADER COMES FROM THE PAYLOAD. `bucket_labels` moves with the operator's threshold — at
   * 120 days the columns are 0-40/40-80/80-120/≥ 120 — so a header spelled here would be a
   * second, silently wrong statement of the setting.
   */
  function renderHeat(view) {
    const heat = heatModel(view);
    if (!heat) return;
    const head = el("tr", {}, el("th", { scope: "col" }, "Support group"));
    for (const label of heat.columns) head.append(el("th", { scope: "col", class: "num" }, label));
    const body = el("tbody", {});
    const paintRow = (r) => {
      const tr = el("tr", {}, el("th", { scope: "row" }, r.label));
      for (const cell of r.cells) {
        tr.append(el("td", {
          class: "num heat-cell",
          // Every cell prints its own count and the open findings under it, shaded or not:
          // the shade repeats the number, it never replaces it.
          "data-level": String(cell.level),
        }, fmtCount(cell.count), el("span", { class: "small muted" },
          fmtCount(cell.open) + " open")));
      }
      return tr;
    };
    for (const r of heat.rows) body.append(paintRow(r));
    if (heat.totals) body.append(paintRow(heat.totals));
    host.append(el("h3", { class: "section-label" }, tipLabel("Idle time by support group", {
      lines: [
        "The last column is the assets with no movement on record yet — not idle for zero"
        + " days, but not yet measurable.",
        "Unobserved assets and assets with nothing open are in no column.",
      ],
    })));
    host.append(el("div", { class: "table-wrap" },
      el("table", { class: "data heat" },
        el("caption", { class: "small muted" },
          "Assets per support group by idle band, with the open findings in each."),
        el("thead", {}, head),
        body)));
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
    const all = coldAssetRows(view);
    const cuts = {
      all: { rows: all, label: "All" },
      cold: { rows: all.filter((r) => r.cold), label: "Cold" },
      lost: {
        rows: all.filter((r) => !r.observed && r.open > 0),
        label: "Out of sight, backlog open",
      },
    };

    const toggle = segmented({
      options: ["all", "cold", "lost"].map((value) => ({
        value,
        // THE COUNT RIDES ON THE LABEL. A cut a reader cannot size before opening it is a cut
        // they open to find out, and the interesting one here is often empty — which is good
        // news they should be able to read without a click.
        label: cuts[value].label + " " + fmtCount(cuts[value].rows.length),
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
        assetCut = v;
        toggle.set(v);
        paintAssets();
      },
    });

    host.append(el("div", { class: "section-head" },
      el("h3", { class: "section-label" }, "Cold and unobserved assets"),
      el("div", { class: "toolbar-group" },
        el("span", { class: "small muted" }, "Show"),
        toggle)));

    const tableHost = el("div", {});
    host.append(tableHost);
    paintAssets();

    function paintAssets() {
      const lost = assetCut === "lost";
      const rows = cuts[assetCut].rows;
      clear(tableHost);
      if (!rows.length) {
        // EACH CUT'S ABSENCE IS ITS OWN SENTENCE, and the important one is GOOD NEWS. An empty
        // out-of-sight cut means no backlog has been left behind anywhere, which is the best
        // reading this page can produce; phrasing it as a bare "nothing to show" would file it
        // beside a failure.
        tableHost.append(emptyState(
          lost
            ? "No backlog has been left behind."
            : assetCut === "cold"
              ? "No asset is cold."
              : "No asset is cold, and none has dropped out of the scanner.",
          lost
            ? "Every asset the scanner has lost sight of had already been cleared when it went."
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
          : assetCut === "cold"
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
