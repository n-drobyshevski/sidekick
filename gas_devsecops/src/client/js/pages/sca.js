// The Dependencies register: a CVE in a third-party package at a version.
//
// WHY THIS IS ITS OWN PAGE, AND THE ONE FACT THAT MAKES IT ONE. An SCA finding cannot be
// fixed before somebody else publishes a fixed version, so its clock SPLITS: rows with no
// published fix are waiting on a vendor, and only the rest were ever the team's to close.
// PRODUCT.md's sixth principle ("a clock has to say where it started") is why the two are
// rendered as two figures and never as one blended number — an average across both measures
// the vendor and the team at once and names neither.
//
// WHERE THE SHARED REGISTER VOCABULARY LIVES, AND WHY IT LIVES HERE. `sast.js` and
// `secrets.js` import the pure helpers below rather than each growing a third copy. That is
// a package-boundary decision, not a design one: the C4 brief owns exactly three page files
// and `src/client/js/ui/` is off limits, so the choices were (a) one shared vocabulary hosted
// by the eldest of the three registers, or (b) three drifting copies of `signalFigure`. The
// helpers are pure and DOM-thin on purpose; when a later package may touch `ui/`, everything
// under "shared register vocabulary" below is the promotion candidate.
//
// WHAT THIS PAGE DOES NOT DRAW, AND WHY. `api_getRegisterPage` ships aggregates plus a
// top-N oldest-open ranking; it carries no per-finding row set, so `component`
// (package@version), `fixed_version`, `cwe` and `file_path` reach no table here. The page
// says so in words rather than drawing a column of dashes and letting a reader think the
// tenant is missing the data. See `missingColumnsNote` below.

import { bootstrapCached, listJoin, listSplit, navigate, swrCall } from "../store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  DEFAULT_PAGE_SIZE, absent, dataTable, el, emptyState, errorState, glossaryTip, heroStat,
  kpiCard, meter, onPageTeardown, pageHeader, pageOf, segmented, sevBadge, sevEntries,
  sevSegmentBar, skeletonStack, sortRows, statRow, tableFooter, togglePills, fmtDate,
} from "../ui.js";

// =========================================================================================
//  Shared register vocabulary — pure, and imported by sast.js and secrets.js
// =========================================================================================

/** A number from an untrusted payload, with a stated fallback. Never `NaN` onto a page. */
export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A count, grouped for reading. */
export function fmtCount(v) {
  return num(v).toLocaleString();
}

/**
 * A percentage, or the em dash.
 *
 * `null` IS AN ANSWER HERE and it is never 0. Every rate in the domain layer returns null
 * when its denominator is empty (`pct()` in secretsLifecycle.ts, `coveragePct` in
 * readModels.ts, `pctOfOpen` in remediation.ts), precisely so a page cannot print "0%" over
 * nothing measured. Collapsing that back to a zero here would undo the decision.
 */
export function pct1(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v))
    ? "—"
    : `${Number(v).toFixed(1)}%`;
}

/** Days, or the em dash. */
export function days1(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v))
    ? "—"
    : `${Number(v).toFixed(1)} d`;
}

/**
 * A duration that may only be a LOWER BOUND.
 *
 * PRODUCT.md: "where the curve never reaches half, the page publishes a lower bound rather
 * than a number". `> 41 d` and `41 d` are different claims and this is the one place the
 * difference is spelled, so no caller can flatten it by accident.
 */
export function boundedDays(value, lowerBound) {
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
    return { text: days1(value), bounded: false };
  }
  if (lowerBound !== null && lowerBound !== undefined && Number.isFinite(Number(lowerBound))) {
    return { text: `> ${days1(lowerBound)}`, bounded: true };
  }
  return { text: "—", bounded: false };
}

/**
 * The denominator node every rate on these three pages carries.
 *
 * A RATE WITHOUT ITS DENOMINATOR IS NOT A MEASUREMENT — "99.6% unvalidated" and "3-day
 * median over four rows" are the two cases this register was built after. The sentence is
 * ALSO written into the attribute so a test can read what a reader reads, rather than
 * asserting that some node happens to sit nearby.
 */
export function denomNote(sentence) {
  return el("p", { class: "small muted", "data-denominator": sentence }, sentence);
}

/** A card whose figure is a rate or a count, with its denominator sentence beneath it. */
export function figureCard({ label, value, sub, help, denominator, chip }) {
  const card = kpiCard(label, value, sub || "", chip || null, help || null);
  if (denominator) card.append(denomNote(denominator));
  return card;
}

/** A `.card` with its section label, in the one arrangement every block here uses. */
export function sectionCard(title, help, ...kids) {
  return el("section", { class: "card" },
    el("h2", { class: "section-label" }, help ? glossaryTip(title, help) : title),
    ...kids,
  );
}

/**
 * The severity palette, READ OFF THE STYLESHEET rather than retyped.
 *
 * CLAUDE.md: "the severity palette is byte-identical across all four surfaces". A literal
 * table here would be a fourth copy free to drift; `tokens.css` is the source and
 * `getComputedStyle` is how a client asks it. The fallback is the `--sev-unknown` slate, so
 * a missing custom property degrades to a neutral rather than to black.
 */
export function sevPalette(order) {
  const list = (order && order.length ? order : SEVERITY_FALLBACK).slice();
  const colors = {};
  let cs = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch (e) {
    cs = null;
  }
  for (const s of list) {
    const raw = cs ? cs.getPropertyValue(`--sev-${String(s).toLowerCase()}`).trim() : "";
    colors[s] = raw || "#475569";
  }
  return { order: list, colors };
}

/** Only reached when bootstrap has not landed; bootstrap's `severityOrder` is the source. */
const SEVERITY_FALLBACK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

// ------------------------------------------------------------------ absent is never zero

/**
 * One tri-state signal, as three separate figures.
 *
 * THE WHOLE POINT IS THAT `missing` NEVER RENDERS AS A NO. Wiz returns null for a signal it
 * never evaluated; `signalCoverage` in readModels.ts already keeps measured / missing /
 * notApplicable apart, and this is where that survives contact with a page. The three states
 * get three different words and three different `state` values, so a register whose KEV
 * column was never populated cannot be read as a register with no KEV entries.
 *
 * `notApplicable` is a different statement again — "this scope has no such column" is not
 * "we never looked" — so it is a third figure rather than folded into `missing`.
 */
export function signalFigure(id, label, glossary, cov) {
  const c = cov || {};
  const applicable = num(c.applicable);
  const measured = num(c.measured);
  const missing = num(c.missing);
  const notApplicable = num(c.notApplicable);
  const total = num(c.total);
  const coveragePct = c.coveragePct === null || c.coveragePct === undefined
    ? null
    : num(c.coveragePct, null);

  const state = applicable === 0
    ? "not-applicable"
    : measured === 0
      ? "unmeasured"
      : missing === 0
        ? "measured"
        : "partly-measured";

  const verdict = {
    "not-applicable": "No row in this register carries this signal at all.",
    unmeasured: "Never evaluated. An absent signal is not a negative one.",
    "partly-measured":
      `${fmtCount(missing)} of ${fmtCount(applicable)} applicable rows were never evaluated — `
      + "those rows are unknown, not clean.",
    measured: "Every applicable row was evaluated.",
  }[state];

  return {
    id,
    label,
    glossary,
    applicable,
    measured,
    missing,
    notApplicable,
    total,
    coveragePct,
    state,
    // THREE CELLS, THREE VOCABULARIES. `missing` is written as a count of rows NOBODY LOOKED
    // AT, never as a bare zero that reads like an all-clear.
    cells: {
      measured: measured === 0 ? "None evaluated" : fmtCount(measured),
      missing: missing === 0 ? "None outstanding" : `${fmtCount(missing)} never evaluated`,
      notApplicable: notApplicable === 0 ? "—" : `${fmtCount(notApplicable)} no such column`,
    },
    verdict,
    denominator:
      `${fmtCount(measured)} of ${fmtCount(applicable)} applicable rows evaluated `
      + `(${pct1(coveragePct)}); ${fmtCount(missing)} never evaluated; `
      + `${fmtCount(notApplicable)} of ${fmtCount(total)} rows in view have no such signal.`,
  };
}

// ------------------------------------------------------------------------ shared blocks

/** Age buckets, as one bucket-by-severity matrix plus the totals the chart needs. */
export function agingModel(aging) {
  const a = aging || {};
  const perSev = a.perSev || {};
  const buckets = AGE_BUCKET_LABELS.map((label, i) => ({
    label,
    total: Object.values(perSev).reduce((sum, arr) => sum + num((arr || [])[i]), 0),
  }));
  return {
    labels: AGE_BUCKET_LABELS.slice(),
    perSev,
    buckets,
    totalOpen: num(a.totalOpen),
    // `ageBucketsBy` skips rows with no finite age, so this total can sit BELOW the open
    // count elsewhere on the page. Said out loud rather than left as a discrepancy.
    denominator:
      `${fmtCount(a.totalOpen)} open findings carry a readable age and are bucketed here; `
      + "any open row with no first-seen date is outside this chart.",
  };
}

/** insights.AGE_BUCKET_LABELS, mirrored — the client cannot import the TypeScript domain. */
export const AGE_BUCKET_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

/** Top groups per dimension, with the "N more" tail the domain layer already counted. */
export function concentrationModel(concentration, dims) {
  const c = concentration || {};
  const perDim = c.perDim || {};
  const moreDim = c.moreDim || {};
  return (dims || Object.keys(perDim)).map((dim) => {
    const rows = (perDim[dim] || []).map((r) => ({
      key: String(r.key ?? "(none)"),
      open: num(r.open),
      repos: num(r.repos),
      kev: num(r.kev),
    }));
    const shown = rows.reduce((s, r) => s + r.open, 0);
    return {
      dim,
      label: DIM_LABELS[dim] || dim,
      rows,
      more: num(moreDim[dim]),
      shown,
      denominator:
        `${fmtCount(shown)} open findings across the ${rows.length} group(s) listed; `
        + `${fmtCount(moreDim[dim])} further group(s) are not shown.`,
    };
  });
}

const DIM_LABELS = {
  repo: "By repository",
  language: "By language",
  owner_project: "By owning project",
  cwe: "By weakness class",
  secret_kind: "By secret kind",
};

/** Scan-over-scan movement. Severity-free, so all three registers can render it. */
export function movementModel(movement, latestScan) {
  const m = movement || {};
  const scan = latestScan || null;
  return {
    hasPrevious: !!m.hasPrevious,
    newCount: num(m.newCount),
    resolvedCount: num(m.resolvedCount),
    reopenedCount: num(m.reopenedCount),
    persisting: num(m.persisting),
    scanId: scan ? String(scan.scan_id ?? "") : null,
    scanTs: scan ? String(scan.ts ?? "") : null,
    scanTotal: scan ? num(scan.total) : null,
    // The freshness caption is a claim about COVERAGE as well as about time: a sync that
    // asked for CRITICAL and HIGH has not looked at a MEDIUM.
    scanSeverities: scan && scan.severities ? String(scan.severities) : null,
  };
}

/** Risk tiers, ordered worst-evidence-first, with `unclassified` outside the ranking. */
export function tierModel(tiers, order, labels) {
  const t = tiers || {};
  const perTier = t.perTier || {};
  const open = num(t.open);
  return {
    open,
    rows: (order || []).map((k) => ({
      tier: k,
      label: (labels || {})[k] || k,
      count: num(perTier[k]),
      pct: open ? (num(perTier[k]) / open) * 100 : null,
    })),
    unclassified: num(t.unclassified),
    excludedSecrets: num(t.excludedSecrets),
    denominator:
      `${fmtCount(open)} open, classified findings are the denominator for every share here; `
      + `${fmtCount(t.unclassified)} could not be classified and `
      + `${fmtCount(t.excludedSecrets)} secrets row(s) were excluded before classification.`,
  };
}

/**
 * RISK_TIER_ORDER / RISK_TIER_LABELS, mirrored for the client.
 *
 * The domain layer is TypeScript and this bundle is plain JS, so these two constants cannot
 * be imported. `test/pagesRegisters.test.js` reads both out of `src/domain/program.ts` and
 * compares, so the mirror cannot drift silently.
 */
export const RISK_TIER_ORDER = [
  "kev", "exploit", "epss", "cwe", "aiVerdict", "critical", "none", "unknown",
];
export const RISK_TIER_LABELS = {
  kev: "Known exploited",
  exploit: "Public exploit",
  epss: "Likely exploited",
  cwe: "Top-25 weakness class",
  aiVerdict: "AI triage: exploitable",
  critical: "Rated critical",
  none: "No signal fired",
  unknown: "Unclassified",
};

/**
 * The triage funnel, with the steps that were never measured DROPPED rather than zeroed.
 *
 * `exposureKnown` is false on this register by construction — internet exposure is a
 * property of a host and this register's asset is a repository — so `exposed` and `overdue`
 * are not steps that read zero, they are steps nobody could compute. Rendering them as 0
 * would be the same mistake as rendering an unevaluated KEV flag as "No".
 */
export function funnelModel(funnel) {
  const f = funnel || {};
  const steps = [
    { id: "open", label: "Open", count: num(f.open) },
    { id: "intel", label: "Signals captured", count: num(f.intel) },
    { id: "exploitable", label: "Exploitable", count: num(f.exploitable) },
  ];
  const top = steps[0].count;
  return {
    steps: steps.map((s) => ({ ...s, pct: top ? (s.count / top) * 100 : null })),
    exposureKnown: !!f.exposureKnown,
    droppedSteps: f.exposureKnown ? [] : ["exposed", "overdue"],
    unclassified: num(f.unclassified),
    excludedSecrets: num(f.excludedSecrets),
    denominator:
      `Each step is a strict subset of the one above it, out of ${fmtCount(f.open)} open `
      + `findings; ${fmtCount(f.unclassified)} could not be classified at all.`,
    note: f.exposureKnown
      ? null
      : "Exposure and overdue are not drawn: internet exposure is a property of a host, and "
        + "this register's asset is a repository. There is nothing to measure, so there is "
        + "no zero to print.",
  };
}

/** The oldest open findings, as a table model. Carries severity — sca and sast only. */
export function oldestFindingsModel(oldest) {
  const o = oldest || {};
  return (o.findings || []).map((f) => ({
    identifier: f.identifier === null || f.identifier === undefined ? null : String(f.identifier),
    repo: f.repo === null || f.repo === undefined ? null : String(f.repo),
    ownerProject: f.ownerProject === null || f.ownerProject === undefined
      ? null
      : String(f.ownerProject),
    severity: String(f.severity || "UNKNOWN"),
    ageDays: num(f.ageDays, null),
  }));
}

/** The oldest-aging repositories. Severity-free, so secrets can render it too. */
export function oldestReposModel(oldest) {
  const o = oldest || {};
  return (o.byRepo || []).map((g) => ({
    key: String(g.key ?? "(none)"),
    agedCount: num(g.agedCount),
    openCount: num(g.openCount),
    oldestDays: num(g.oldestDays, null),
    ownerProject: g.ownerProject ? String(g.ownerProject) : null,
  }));
}

/**
 * The columns this payload does not carry, named.
 *
 * A register page that silently omits the fields its own brief promised looks like a
 * register with nothing to say. `api_getRegisterPage` / `api_getSecretsPage` are aggregate
 * endpoints plus a top-N ranking; these columns exist in the ledger and simply do not travel.
 */
export function missingColumnsNote(fields) {
  return "Not in this page's payload: " + fields.join(", ")
    + ". These columns are in the ledger; the register endpoint ships aggregates and a "
    + "top-N ranking rather than a per-finding row set, so no table here can draw them. "
    + "Open the finding in Wiz for the full record.";
}

// ------------------------------------------------------------------------ shared DOM bits

/** A paged, sortable table with its footer — the arrangement all three registers use. */
export function pagedTable(spec) {
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

/** A chart card that survives a deployment whose policy refuses the charts bundle. */
export function chartCard(title, note, draw) {
  const canvas = el("canvas");
  const card = el("section", { class: "chart-card" },
    el("h3", { class: "section-label" }, title),
    note ? el("p", { class: "chart-note" }, note) : null,
    el("div", { class: "chart-box" }, canvas),
  );
  loadCharts()
    .then((api) => {
      draw(api, canvas);
      onPageTeardown(() => {
        try {
          api.destroyChart(canvas);
        } catch (e) {
          /* the canvas is already detached — nothing left to destroy */
        }
      });
    })
    .catch(() => chartUnavailable(canvas));
  return card;
}

/**
 * The severity filter and the no-fix switch, as one toolbar.
 *
 * Shared by sca and sast and DELIBERATELY NOT REACHED FROM secrets: `severities` is ignored
 * by `secretsModel` outright, so offering the control there would be a filter that does
 * nothing. `showNoFix` is offered on sca only, for the same reason — `baseRowNoFix` is false
 * on every non-sca row by construction.
 */
export function registerToolbar({ route, severities, order, showNoFix, offerNoFix }) {
  const bar = el("div", { class: "toolbar" });
  // `navigate`, not `setParams`: `history.replaceState` fires no `hashchange`, so the
  // filter would rewrite the URL and leave the page showing the previous fetch. Going
  // through the hash re-enters `route()`, which is the one place a register refetches.
  const onChange = (patch) => {
    const next = { sev: listJoin(severities), nofix: showNoFix ? "" : "0" };
    navigate(route, { ...next, ...patch });
  };
  const pills = togglePills({
    options: (order || SEVERITY_FALLBACK).filter((s) => s !== "UNKNOWN"),
    selected: severities,
    ariaLabel: "Severity filter",
    onToggle: (sev) => {
      const next = new Set(severities);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      onChange({ sev: listJoin([...next]) });
    },
  });
  bar.append(el("span", { class: "small muted" }, "Severity"), pills);

  if (offerNoFix) {
    bar.append(segmented({
      options: [
        { value: "all", label: "All rows", title: "Every open finding, fixed version or not." },
        {
          value: "fixable",
          label: "Has a fixed version",
          title: "Drop the rows with no published fix — they are waiting on a vendor.",
        },
      ],
      value: showNoFix ? "all" : "fixable",
      ariaLabel: "Fix availability",
      onChange: (v) => onChange({ nofix: v === "all" ? "" : "0" }),
    }));
  }
  return bar;
}

/** The filter params these register pages read out of the hash, in one place. */
export function readRegisterParams(params) {
  const p = params || {};
  return {
    severities: listSplit(p.sev),
    // `showNoFix` defaults TRUE, matching `modelParams` on the server: the register is the
    // whole population until a reader narrows it.
    showNoFix: p.nofix !== "0",
  };
}

/** The load / error shell every one of the three pages wraps its body in. */
export async function renderRegisterPage(host, spec) {
  const { skeleton: skel, fetch: fetchPage, paint } = spec;
  host.append(skel());
  let payload;
  try {
    payload = await fetchPage();
  } catch (e) {
    host.replaceChildren(errorState("This register could not be loaded.", {
      detail: e && e.message ? e.message : String(e),
    }));
    return;
  }
  host.replaceChildren();
  paint(payload);
}

// =========================================================================================
//  The Dependencies view model
// =========================================================================================

/**
 * The whole page as data.
 *
 * PURE ON PURPOSE. There is no jsdom in this project (vitest.config.ts sets no
 * `environment`), so anything that touches `document` cannot be unit-tested — the same split
 * `ui/tableModel.js` and `staleness.js` already make. The half that can be WRONG is this
 * half, and `test/pagesRegisters.test.js` holds it.
 */
export function scaModel(payload, opts) {
  const p = payload || {};
  const order = (opts && opts.severityOrder) || SEVERITY_FALLBACK;
  const awaiting = p.awaiting || {};
  const coverage = p.signalCoverage || {};

  // THE TWO CLOCKS. `openTotal` is the whole open backlog in this scope; `overall` is the
  // part of it with no published fix. Everything else is the part a team could have closed.
  const openTotal = num(awaiting.openTotal, num(p.open));
  const awaitingCount = num(awaiting.overall);
  const actionableCount = Math.max(0, openTotal - awaitingCount);

  return {
    scope: "sca",
    asOf: p.asOf ?? null,
    severities: p.severities ?? null,
    showNoFix: p.showNoFix !== false,
    rowCount: num(p.rowCount),
    open: num(p.open),
    resolved: num(p.resolved),

    hero: {
      label: "Dependencies",
      value: fmtCount(p.open),
      sub: `open findings of ${fmtCount(p.rowCount)} in the register — `
        + `${fmtCount(p.resolved)} resolved.`,
    },

    // TWO FIGURES, NEVER ONE. A single "average time to fix" over both populations would be
    // part vendor latency and part team latency, and would name neither. The two counts are
    // complements of the same open backlog, which is what makes them legible side by side —
    // and `blended` is pinned null so a later edit has to delete a stated decision rather
    // than quietly add a third tile.
    clocks: {
      awaitingVendor: {
        id: "awaiting-vendor",
        label: "Awaiting a vendor fix",
        glossary: "awaiting-fix",
        measures: "the vendor",
        count: awaitingCount,
        pct: awaiting.pctOfOpen === null || awaiting.pctOfOpen === undefined
          ? null
          : num(awaiting.pctOfOpen, null),
        perSev: awaiting.perSev || {},
        notApplicable: num(awaiting.notApplicable),
        denominator:
          `${fmtCount(awaitingCount)} of ${fmtCount(openTotal)} open dependency findings have `
          + "no published fixed version. Their actionable clock has not started, so they sit "
          + "outside every SLA and MTTR figure on this page.",
      },
      actionable: {
        id: "actionable",
        label: "Fixable now",
        glossary: "two-clocks",
        measures: "the team",
        count: actionableCount,
        pct: openTotal ? (actionableCount / openTotal) * 100 : null,
        denominator:
          `${fmtCount(actionableCount)} of ${fmtCount(openTotal)} open dependency findings `
          + "have a fixed version available. This is the only population whose remaining time "
          + "open measures us rather than upstream.",
      },
    },
    blended: null,

    // Absent is never zero — three signals, three states each.
    signals: [
      signalFigure("has_kev", "CISA KEV", "sca", coverage.has_kev),
      signalFigure("has_exploit", "Known exploit", "sca", coverage.has_exploit),
      signalFigure("epss", "EPSS score", "sca", coverage.epss),
    ],

    severityAxis: p.severityAxis || { supported: true },
    counts: p.counts || {},
    severityOrder: order.slice(),
    aging: agingModel(p.aging),
    tiers: tierModel(p.tiers, RISK_TIER_ORDER, RISK_TIER_LABELS),
    funnel: funnelModel(p.funnel),
    concentration: concentrationModel(p.concentration, ["repo", "language", "owner_project"]),
    oldest: oldestFindingsModel(p.oldest),
    oldestRepos: oldestReposModel(p.oldest),
    movement: movementModel(p.movement, p.latestScan),

    // FIXED VERSION IS NOT IN THIS PAYLOAD, and saying so is the honest answer to the stub's
    // first promised section. The count of rows that HAVE one is available — it is the
    // complement of `awaiting.overall` — but the string itself is per-row and does not ship.
    fixedVersion: {
      perRow: false,
      withFix: actionableCount,
      withoutFix: awaitingCount,
      reason: "The fixed version is a per-finding string; this page's endpoint ships "
        + "aggregates, so the count of rows that have one is published instead of the "
        + "versions themselves.",
    },
    missingColumns: missingColumnsNote([
      "package and version (component)", "fixed_version", "ecosystem",
    ]),
  };
}

// =========================================================================================
//  The page
// =========================================================================================

/** Third-party dependencies: a CVE in a package at a version. */
export function renderSca(host, params) {
  const filters = readRegisterParams(params);
  // The severity vocabulary comes from the SERVER's `SEVERITY_ORDER`, through bootstrap —
  // the client bundle is plain JS and cannot import `src/domain/config.ts`.
  const boot = bootstrapCached();
  const order = (boot && boot.severityOrder) || SEVERITY_FALLBACK;

  return renderRegisterPage(host, {
    skeleton: () => skeletonStack(6, { widths: ["70%", "100%", "90%", "100%", "80%", "60%"] }),
    fetch: () => swrCall("api_getRegisterPage", {
      scope: "sca",
      severities: filters.severities.length ? filters.severities : undefined,
      showNoFix: filters.showNoFix,
    }),
    paint: (payload) => paintSca(host, scaModel(payload, { severityOrder: order }), filters),
  });
}

function paintSca(host, vm, filters) {
  host.append(pageHeader({
    hero: heroStat("Registers · Dependencies", vm.hero.value, vm.hero.sub, { term: "sca" }),
    aside: el("div", { class: "page-strip" },
      sevSegmentBar(sevEntries(vm.counts, vm.severityOrder), {
        size: "lg",
        label: "Open findings by severity",
      }),
      el("p", { class: "small muted" },
        "A CVE in a third-party package. Fixed by upgrading it — which nobody can do until "
        + "a fixed version exists."),
    ),
    stats: [
      statRow("In register", fmtCount(vm.rowCount), "findings, open and resolved"),
      statRow("Open", fmtCount(vm.open), "still outstanding"),
      statRow("Resolved", fmtCount(vm.resolved), "closed in the ledger"),
    ],
  }));

  host.append(registerToolbar({
    route: "sca",
    severities: filters.severities,
    order: vm.severityOrder,
    showNoFix: filters.showNoFix,
    offerNoFix: true,
  }));

  // ------------------------------------------------------------------- the two clocks
  const clocks = sectionCard("The clock splits", "two-clocks",
    el("p", { class: "small muted" },
      "An SCA finding cannot be fixed before somebody else publishes a fixed version. So the "
      + "wait for a vendor and the wait for a team are counted separately, and this page "
      + "publishes no figure that averages them together."),
    el("div", { class: "kpi-row" },
      figureCard({
        label: vm.clocks.awaitingVendor.label,
        value: fmtCount(vm.clocks.awaitingVendor.count),
        sub: `${pct1(vm.clocks.awaitingVendor.pct)} of the open backlog — measures ${
          vm.clocks.awaitingVendor.measures}`,
        help: { term: vm.clocks.awaitingVendor.glossary },
        denominator: vm.clocks.awaitingVendor.denominator,
      }),
      figureCard({
        label: vm.clocks.actionable.label,
        value: fmtCount(vm.clocks.actionable.count),
        sub: `${pct1(vm.clocks.actionable.pct)} of the open backlog — measures ${
          vm.clocks.actionable.measures}`,
        help: { term: vm.clocks.actionable.glossary },
        denominator: vm.clocks.actionable.denominator,
      }),
    ),
    el("p", { class: "small muted" }, vm.fixedVersion.reason),
  );
  host.append(clocks);

  // ------------------------------------------------------------- exploitation signals
  host.append(sectionCard("Exploitation signals", "sca",
    el("p", { class: "small muted" },
      "Three states, never two. A signal Wiz never evaluated is unknown — rendering it as a "
      + "No is what makes an unassessed finding look clean."),
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Signal", cell: (r) => r.label },
        { key: "measured", label: "Evaluated", className: "num", cell: (r) => r.cells.measured },
        {
          key: "missing",
          label: "Never evaluated",
          className: "num",
          cell: (r) => (r.missing > 0 ? r.cells.missing : absent()),
        },
        {
          key: "na",
          label: "Not applicable",
          className: "num",
          cell: (r) => (r.notApplicable > 0 ? r.cells.notApplicable : absent()),
        },
        { key: "verdict", label: "Reading", cell: (r) => r.verdict },
      ],
      rows: vm.signals,
      emptyText: "No signal coverage in this payload.",
    })),
    ...vm.signals.map((s) => denomNote(`${s.label}: ${s.denominator}`)),
  ));

  // ------------------------------------------------------------------ aging + tiers
  host.append(el("div", { class: "chart-row" },
    chartCard("Open findings by age", vm.aging.denominator, (api, canvas) => {
      api.stackedAgeBar(
        canvas,
        vm.aging.labels,
        vm.aging.perSev,
        sevPalette(vm.severityOrder),
        "Open dependency findings by age bucket and severity.",
      );
    }),
    chartCard("Open findings by severity", null, (api, canvas) => {
      api.severityBar(canvas, vm.counts, sevPalette(vm.severityOrder), null);
    }),
  ));

  host.append(sectionCard("What is known about each open finding", null,
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Strongest evidence", cell: (r) => r.label },
        { key: "count", label: "Open", className: "num", cell: (r) => fmtCount(r.count) },
        {
          key: "share",
          label: "Share",
          cell: (r) => meter(r.pct === null ? 0 : r.pct, {
            className: "meter--stat",
            label: `${r.label}, ${pct1(r.pct)}`,
          }),
        },
      ],
      rows: vm.tiers.rows.filter((r) => r.count > 0),
      emptyText: "Nothing open to classify.",
    })),
    denomNote(vm.tiers.denominator),
  ));

  host.append(sectionCard("Triage funnel", null,
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Step", cell: (r) => r.label },
        { key: "count", label: "Findings", className: "num", cell: (r) => fmtCount(r.count) },
        {
          key: "share",
          label: "Of open",
          cell: (r) => meter(r.pct === null ? 0 : r.pct, {
            className: "meter--stat",
            label: `${r.label}, ${pct1(r.pct)}`,
          }),
        },
      ],
      rows: vm.funnel.steps,
      emptyText: "Nothing open.",
    })),
    denomNote(vm.funnel.denominator),
    vm.funnel.note ? el("p", { class: "small muted" }, vm.funnel.note) : null,
  ));

  // ---------------------------------------------------------------------- breakdowns
  for (const dim of vm.concentration) {
    host.append(sectionCard(dim.label, null,
      el("div", { class: "table-host" }, dataTable({
        columns: [
          { key: "key", label: "Group", cell: (r) => r.key },
          { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
          { key: "repos", label: "Repositories", className: "num", cell: (r) => fmtCount(r.repos) },
          {
            key: "kev",
            label: "On KEV",
            className: "num",
            // The KEV column counts rows whose flag reads TRUE. Where coverage is partial the
            // caveat below the table says so; a bare count here would otherwise imply the
            // never-evaluated rows are known not to be on the catalogue.
            cell: (r) => fmtCount(r.kev),
            help: { term: "sca" },
          },
        ],
        rows: dim.rows,
        emptyText: "No open findings in this dimension.",
      })),
      denomNote(dim.denominator),
      kevCaveat(vm.signals),
    ));
  }

  // ------------------------------------------------------------------ oldest open
  host.append(sectionCard("Oldest open findings", null,
    vm.oldest.length
      ? pagedTable({
        rows: vm.oldest,
        sortSpec: { value: (r) => r.ageDays, descending: true, tiebreak: (r) => r.identifier },
        columns: [
          { key: "identifier", label: "CVE", cell: (r) => r.identifier || absent() },
          { key: "repo", label: "Repository", cell: (r) => r.repo || absent() },
          { key: "owner", label: "Owning project", cell: (r) => r.ownerProject || absent() },
          { key: "sev", label: "Severity", cell: (r) => sevBadge(r.severity) },
          {
            key: "age",
            label: "Open for",
            className: "num",
            cell: (r) => (r.ageDays === null ? absent() : days1(r.ageDays)),
          },
        ],
        emptyText: "Nothing open.",
      })
      : emptyState("Nothing open in this register.", "Every dependency finding is resolved, or nothing has been scanned yet."),
    el("p", { class: "small muted" }, vm.missingColumns),
  ));

  host.append(movementCard(vm.movement));
}

/**
 * The one line that keeps a KEV count from over-claiming.
 *
 * A "3 on KEV" cell counts rows whose flag reads true. If a fifth of the register was never
 * evaluated, the honest reading is "at least 3", and this says so rather than leaving the
 * number to be read as complete.
 */
export function kevCaveat(signals) {
  const kev = (signals || []).find((s) => s.id === "has_kev");
  if (!kev || kev.missing === 0) return null;
  return el("p", { class: "small muted" },
    `KEV counts are a floor: ${fmtCount(kev.missing)} row(s) were never evaluated against the `
    + "catalogue, so they are unknown rather than absent from it.");
}

/** Scan-over-scan movement and the freshness caption, shared by all three registers. */
export function movementCard(m) {
  return sectionCard("Since the previous scan", null,
    m.hasPrevious
      ? el("div", { class: "kpi-row" },
        kpiCard("New", fmtCount(m.newCount), "first seen in the latest scan"),
        kpiCard("Resolved", fmtCount(m.resolvedCount), "stopped being returned"),
        kpiCard("Reopened", fmtCount(m.reopenedCount), "seen again after resolving"),
        kpiCard("Persisting", fmtCount(m.persisting), "open and older than this scan"),
      )
      : emptyState(
        "No movement yet.",
        "Movement needs two scans of this register. One scan can say what is open; it cannot "
        + "say what changed.",
      ),
    m.scanTs
      ? el("p", { class: "small muted" },
        `Latest scan ${fmtDate(m.scanTs)} — ${fmtCount(m.scanTotal)} findings returned`
        + (m.scanSeverities ? `, severities requested: ${m.scanSeverities}.` : "."))
      : null,
  );
}
