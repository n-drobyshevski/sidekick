// The champion board: one team's open findings sorted into five clocks.
//
// WHO READS IT. A security champion pushes their team's fixes and fixes nothing themselves; what
// they need is a short list to put in front of the team, by deadline. Scoped viewers land here
// (scopedRoutes.js makes it their default route); a full user opens it from the Program lane
// with the header scope set to one domain or support group. With no scope the page asks for one
// rather than drawing the whole register as a "team".
//
// THE COLUMNS ARE CLOCKS (src/domain/championBoard.ts decides which one a finding lands in):
// Act now, Past SLA, Due in 7 days, Due in 8–14 days, Waiting on vendor. A card is one (CVE ×
// owner) group and opens a sheet listing its findings; each finding opens the finding sheet.
//
// NO CANVAS. Scoped viewers never load Chart.js (app.js), and this is a scoped viewer's front
// door. Every mark here is DOM, and every one has its word beside it.
//
// LIGHT ON PURPOSE. The round of mock-ups that chose this layout found the four-figure briefing
// too much for a champion: the board, one progress line, and what it left out. Everything else
// is one click down, in the card sheets, My findings and My scope.

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import { scopeLabel, scopeSentence } from "../../../../../gas_shared/ui/scopedViewModel.js";
import {
  clear, collapsibleSection, copyText, dataTable, el, emptyState, errorState, firstRunNotice,
  fmtCount, measuredEmpty, openSheet, pageHeader, scopeBar, sevBadge, sheetSection,
  skeletonStack, tipLabel, toast,
} from "../ui.js";
import { kmHalfLifeView } from "./mttr.js";
import { findingRowLabel, openFindingSheet } from "./findingSheet.js";
import { pickFindingColumns } from "./_findingColumns.js";
import {
  COLUMN_META, VISIBLE_CARDS, cardView, digestMarkdown, offBoardLine, progressLists,
} from "./_championBoard.js";

/** The finding columns a card's sheet lists — what a champion forwards to the team. */
const SHEET_COLUMNS = [
  "severity", "cve", "asset_name", "support_group", "has_kev", "internet_exposed", "age_days",
  "portal_url",
];

export async function renderChampion(main, params, ctx) {
  const boot = await bootstrap();
  const scoped = Boolean(boot && boot.role === "scoped");
  // A scoped viewer's scope is the server's to set; the header scope only exists for full users.
  const domain = scoped ? "" : (ctx && ctx.domain) || "";
  const supportGroup = scoped ? "" : (ctx && ctx.supportGroup) || "";
  const team = scoped ? scopeLabel(boot.scope, 3) : (domain || supportGroup);

  main.append(pageHeader({
    route: "champion",
    lede: scoped
      ? scopeSentence(boot.scope)
      : "What to push with one team this week, sorted by deadline.",
  }));
  if (!scoped) {
    const chips = scopeBar({ domain, supportGroup, onClear: ctx && ctx.clearScope });
    if (chips) main.append(chips);
  }

  // FIRST-RUN GATE BEFORE ANY COLUMN. An unmeasured register is not a board of empty columns.
  if (!boot.latestScan) {
    main.append(firstRunNotice({
      synced: false,
      hint: "The board sorts findings by their SLA deadlines, so it appears once a scan has been"
        + " taken. Use “Run scan” in the sidebar.",
    }));
    return;
  }
  if (!scoped && !domain && !supportGroup) {
    main.append(emptyState(
      "Pick a team to see its board.",
      "Choose a domain or support group in the scope menu at the top of the page. The board"
        + " never treats the whole register as one team.",
    ));
    return;
  }

  // Severities as every other page reads them (executive.js): null when all are chosen. A
  // scoped viewer sends nothing — the server reads the register's display severities itself.
  const sevScope = boot.settings && boot.settings.displaySeverities && boot.settings.displaySeverities.length
    ? [...boot.settings.displaySeverities]
    : [...((boot.palette && boot.palette.selectable) || [])];
  const severities = boot.palette && sevScope.length === boot.palette.selectable.length ? null : sevScope;
  const request = scoped ? {} : { domain, supportGroup, severities };

  const host = el("div", { class: "champion" });
  main.append(host);
  host.append(skeletonStack(4, { variant: "stat" }));

  // Expanded columns survive an SWR repaint: a reader who opened "+ 6 more" meant the column.
  const expanded = new Set();
  let paint = null;
  const promise = swrCall("api_getChampionBoard", request, (fresh) => paint && paint(fresh));
  paint = (data) => paintBoard(host, data || {}, { team, scoped, expanded });
  try {
    paint(await promise);
  } catch (e) {
    clear(host).append(errorState("Couldn't load the champion board.", {
      detail: String((e && e.message) || e),
      onRetry: () => {
        clear(main);
        renderChampion(main, params, ctx);
      },
    }));
  }
}

function paintBoard(host, data, opts) {
  clear(host);
  if (data.needsScope) {
    host.append(emptyState("Pick a team to see its board.",
      "Choose a domain or support group in the scope menu at the top of the page."));
    return;
  }
  const at = data.scan && data.scan.ts;
  if (!data.open) {
    host.append(measuredEmpty("Nothing open for this team.", {
      at,
      hint: "Every finding in this scope is resolved. Progress below shows what was fixed.",
    }));
  } else {
    host.append(boardNode(data, opts));
    const left = offBoardLine(data.offBoard);
    // An honesty statement, so it stays on the surface (DESIGN.md: only explanations go a
    // level down). It says what the board did not draw, never why the board is right.
    if (left) host.append(el("p", { class: "champion-offboard small muted" }, left));
  }
  host.append(progressNode(data));
  host.append(actionsNode(data, opts));
}

// ---------------------------------------------------------------------------- the board

function boardNode(data, opts) {
  const board = el("div", { class: "champion-board" });
  for (const col of data.columns || []) board.append(columnNode(col, data, opts));
  // The board scrolls sideways inside its own wrapper on a narrow screen; the page never does.
  return el("div", {
    class: "champion-board-wrap", role: "region", tabindex: "0", "aria-label": "Champion board",
  }, board);
}

function columnNode(col, data, opts) {
  const meta = COLUMN_META[col.id] || { title: col.id, help: null, empty: "" };
  const list = el("ul", { class: "champion-col__cards" });
  const section = el("section", { class: "champion-col champion-col--" + col.id },
    el("div", { class: "champion-col__head" },
      el("h2", { class: "champion-col__title" }, tipLabel(meta.title, meta.help)),
      el("span", { class: "champion-col__count num", "aria-label": `${fmtCount(col.findings)} findings` },
        fmtCount(col.findings))),
    list);

  const draw = () => {
    clear(list);
    const open = opts.expanded.has(col.id);
    const shown = open ? col.cards : col.cards.slice(0, VISIBLE_CARDS);
    for (const card of shown) list.append(el("li", {}, cardNode(card, col.id, opts)));
    if (!col.cards.length) {
      // "Not measured" is not "none": with no exposure keys in the frame, tier 1 is undecidable.
      const empty = col.id === "now" && data.exposureKnown === false
        ? "Exposure was not measured in the latest scan, so nothing can be placed here."
        : meta.empty;
      list.append(el("li", { class: "champion-col__empty small muted" }, empty));
    }
    if (col.cards.length > VISIBLE_CARDS) {
      list.append(el("li", {}, el("button", {
        type: "button",
        class: "champion-col__more",
        "aria-expanded": open ? "true" : "false",
        onclick: () => {
          if (open) opts.expanded.delete(col.id); else opts.expanded.add(col.id);
          draw();
        },
      }, open ? "Show fewer" : `+ ${fmtCount(col.cards.length - VISIBLE_CARDS)} more`)));
    }
  };
  draw();
  return section;
}

function cardNode(card, columnId, opts) {
  const v = cardView(card, columnId);
  const mark = v.mark.tier
    ? el("span", { class: "champion-card__mark brief-tone--t" + v.mark.tier, "aria-hidden": "true" })
    : v.mark.vendor
      ? el("span", { class: "champion-card__mark champion-card__mark--vendor", "aria-hidden": "true" })
      : null;
  return el("button", {
    type: "button",
    class: "champion-card",
    "aria-label": v.aria,
    onclick: () => openCardSheet(card, columnId, opts),
  },
  el("span", { class: "champion-card__name" }, mark, el("span", { class: "champion-card__cve" }, v.title)),
  el("span", { class: "champion-card__meta" },
    v.markWord ? el("span", { class: "champion-card__kind" }, v.markWord) : sevBadge(v.mark.severity)),
  el("span", { class: "champion-card__meta" }, `${v.owner} · ${v.where}`),
  el("span", { class: "champion-card__clock" + (v.clockTone === "bad" ? " champion-card__clock--bad" : "") },
    v.clock));
}

function openCardSheet(card, columnId, opts) {
  const v = cardView(card, columnId);
  const rows = Array.isArray(card.rows) ? card.rows : [];
  openSheet((body) => {
    const table = dataTable({
      columns: pickFindingColumns(SHEET_COLUMNS),
      rows,
      onRowOpen: (r) => openFindingSheet(r, {
        rows,
        backTo: { label: v.title, onBack: () => openCardSheet(card, columnId, opts) },
      }),
      rowLabel: findingRowLabel,
      emptyText: "No findings in this card.",
    });
    const more = v.more
      ? el("p", { class: "small muted", style: "margin:8px 0 0" },
        `${v.more} The rest are in ${opts.scoped ? "My findings" : "OS vulnerabilities"}.`)
      : null;
    body.append(sheetSection("Findings", table, more));
  }, {
    title: v.title,
    subtitle: v.subtitle,
    width: "min(880px, 96vw)",
    resizable: true,
    closeOnRouteChange: true,
  });
}

// ------------------------------------------------------------------------- the progress strip

function mttrWords(data) {
  const m = data.mttr || {};
  return {
    team: kmHalfLifeView(m.team).value,
    org: m.org ? kmHalfLifeView(m.org).value : null,
  };
}

function progressNode(data) {
  const p = data.progress || {};
  const mttr = mttrWords(data);
  const lists = progressLists(p);
  const line = el("div", { class: "champion-progress__line" },
    el("span", { class: "champion-progress__label" }, "Progress"),
    el("span", {}, el("b", { class: "num" }, fmtCount(p.fixedWeek)), " fixed this week"),
    el("span", {}, el("b", { class: "num" }, fmtCount(p.reopened)), " came back"),
    el("span", {}, tipLabel("MTTR", ["Kaplan-Meier half-life over this team's findings. “At least”"
      + " when fewer than half are fixed."]), " ", el("b", {}, mttr.team),
    mttr.org ? el("span", { class: "muted" }, ` · whole register ${mttr.org}`) : null));

  const fold = collapsibleSection("What we fixed, and what came back", {
    remember: "championProgress",
    hint: `${fmtCount(p.fixed30)} fixed in 30 days · ${fmtCount(p.reopened)} came back`,
  });
  fold.body.append(el("div", { class: "champion-progress__cols" },
    listNode("What we fixed", "Last 30 days, confirmed by Wiz", lists.fixed,
      "No confirmed fixes in the last 30 days."),
    listNode("Came back", "Open again after being resolved", lists.regressions,
      "Nothing has come back. Fixes are sticking.")));
  return el("section", { class: "champion-progress" }, line, fold.node);
}

function listNode(title, sub, rows, empty) {
  return el("div", { class: "champion-list" },
    el("h3", { class: "champion-list__title" }, title, el("span", { class: "small muted" }, " · " + sub)),
    rows.length
      ? el("ul", { class: "champion-list__rows" }, rows.slice(0, 8).map((r) => el("li", {},
        el("span", {}, el("span", { class: "champion-list__name" }, r.name), " " + r.detail),
        el("span", { class: r.repeat ? "champion-list__when champion-list__when--repeat" : "champion-list__when" }, r.when))))
      : el("p", { class: "small muted" }, empty));
}

// ----------------------------------------------------------------------------- the digest

function actionsNode(data, opts) {
  const mttr = mttrWords(data);
  const button = el("button", {
    type: "button",
    class: "btn",
    onclick: async () => {
      const md = digestMarkdown({
        data, team: opts.team, mttr: mttr.team, orgMttr: mttr.org,
        asOf: data.scan && data.scan.ts ? String(data.scan.ts).slice(0, 10) : null,
      });
      const ok = await copyText(md);
      toast(ok ? "Weekly digest copied." : "Your browser blocked the clipboard, so nothing was copied.",
        ok ? undefined : "warn");
    },
  }, "Copy weekly digest");
  return el("div", { class: "champion-actions" }, button,
    el("span", { class: "small muted" }, "Markdown for a standup, a chat or a ticket."));
}

