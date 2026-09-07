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
// THE PER-FINDING TABLE. `api_getRegisterPage` ships aggregates plus a top-N oldest-open
// ranking; it carries no row set on its own. `api_getRegisterRows` is the RPC that does —
// paged and sorted SERVER-SIDE (the sca register is ~18,800 rows; a client-side `sortRows`
// over that would be both slow and a second ordering rule free to disagree with the
// server's) — and `registerRowsTable` below is the one component all three pages draw it
// through. What a scope's table can show is exactly `REGISTER_ROW_COLUMNS[scope]`
// (`domain/pagePayload.ts`); anything still missing (no ledger column exists for it — an
// ecosystem tag, a commit hash) is still named by `missingColumnsNote` rather than drawn as
// a column of dashes that would let a reader think the tenant is missing the data.

import { bootstrapCached, listJoin, listSplit, navigate, swrCall } from "../../../../../gas_shared/store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { PROVENANCE_LABEL, populationLine, provenance } from "./registerModel.js";
import { findingRowLabel, openFindingSheet } from "./findingSheet.js";
import {
  DEFAULT_PAGE_SIZE, absent, absentText, axisBar, axisSegments, boundedDays, chartTable,
  chartTableModel, closeActiveSheet, dataTable, days1, el, emptyState, errorState, figureCard,
  figureCardModel, firstRunNotice, fmtCount, glossaryTip, heroStat, kpiCard, measuredEmpty,
  meter, num, onPageTeardown, pageHeader, pageOf, pct1, segmented, sevBadge, sevEntries,
  sevKeyRow, sevSegmentBar, skeletonStack, sortRows, statRow, statusPill, tableFooter, tipLabel,
  togglePills, fmtDate, triCell,
} from "../ui.js";

// =========================================================================================
//  Shared register vocabulary — pure, and imported by sast.js and secrets.js
// =========================================================================================
//
// `num`, `fmtCount`, `days1`, `pct1` and `denomNote` used to be DEFINED here (and, for `num`/
// `fmtCount`, defined wrongly — see `ui/figures.js`'s module header for the null-renders-as-0
// defect that shipped this way). They now all live in `ui/figures.js`, the one implementation
// every page in this package imports, `denomNote` included — see that file's header for the
// attribute/sentence claim it carries. `boundedDays` joined them, from here AND from
// `repos.js`: it was defined twice, in two shapes, spelling one lower bound two ways.
//
// This file re-exports `pct1` and `boundedDays` because `test/pagesRegisters.test.js` —
// which this package may not edit — still imports both from here by name.
//
// `figureCard` JOINS THEM, and for a different reason: it is no longer this page's, either.
// It was a four-line wrapper over `kpiCard` that appended a `denomNote` paragraph, and the
// paragraph is what this wave is removing from the surface — 22 of them were on these three
// register pages at once. `gas_shared/ui/figures.js` owns the shape now: the same card, the
// denominator sentence PREPENDED to the tip on the label and written to `data-denominator`,
// no paragraph. `sast.js` and `secrets.js` import the name from here, so the name stays here.
export { boundedDays, figureCard, pct1 };

/**
 * The first-run decision, shared by sca.js, sast.js and secrets.js.
 *
 * `show` is true when THIS register's own ledger carries nothing at all — `rowCount` (open
 * plus resolved, together) is 0. sca, sast and secrets are three independent queries against
 * three independent ledger scopes (CLAUDE.md: "the same CVE arriving through a dependency and
 * through a host image is two findings with two clocks"), so a register with rows is never
 * suppressed because a DIFFERENT register is empty, and an empty register is never left to
 * print a page of zeros because some other register has rows. `num(rowCount, 0)` rather than
 * a bare `=== 0`: a malformed payload with no `rowCount` field at all degrades to the SAME
 * safe default — nothing here to show — rather than to a page that assumes data it does not
 * have.
 *
 * `synced` distinguishes "no sync has ever run" from "a sync ran and saved nothing for this
 * register" — the same split `executiveFirstRunView` and `firstRunNotice` (ui/feedback.js)
 * already make, and `firstRunNotice` is what every one of the three pages hands this straight
 * to. The one signal a register page has for it is the shared boot cache: `boot.latestSync`
 * is set the moment ANY sync completes, whichever scope it touched — a sync that ran and
 * saved nothing for THIS register still makes `synced` true, which is the whole point: "the
 * tenant answered and had nothing to report" is a different, true, claim from "nobody has
 * asked".
 *
 * `at` is `boot.latestSync.ts` straight through, unexamined — `firstRunNotice` (ui/feedback.js)
 * is the one place that decides whether it is usable, so a malformed or missing value here
 * degrades to the same undated-but-true sentence rather than this function guessing twice.
 */
export function registerFirstRunView(rowCount, synced, at) {
  return { show: num(rowCount, 0) === 0, synced: !!synced, at };
}

/** EPSS is a probability, 0..1 off the wire; rendered as the percentage it names. */
export function epssPct(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v))
    ? absentText
    : pct1(Number(v) * 100);
}

/** A cell whose only two states worth telling apart are "here" and "absent" — never a bare
 *  dash in the same weight as a value. Text strings only; dates go through `fmtDate`. */
export function textCell(v) {
  return v === null || v === undefined || v === "" ? absent() : String(v);
}

/**
 * A NON-NULLABLE boolean cell — plain Yes/No, never `triCell`.
 *
 * `awaiting_vendor_fix` is `boolean` on `BaseRow`, not `boolean | null` — `ledgerCore.baseRows`
 * always computes it, so there is no "never evaluated" state to protect here. Using `triCell`
 * on a column that can never be null would draw a signal this one is not.
 */
export function yesNo(v) {
  return v ? "Yes" : "No";
}

/**
 * A `.card` with its section label, in the one arrangement every block here uses.
 *
 * `help` TAKES EVERY tipLabel SHAPE NOW, and the string case is the one that could NOT be
 * routed through `tipLabel` — there, a bare string is literal tip COPY, and here it has
 * always meant a glossary id. So a string still goes to `glossaryTip` (unchanged behaviour,
 * and `test/pagesLit.test.js`'s gate 6/7 reads exactly those string literals to check every
 * id is defined); an object goes to `tipLabel`, which is what lets a section heading carry
 * `{lines}` — the method paragraph that used to be printed under it — or `{lines, term}`,
 * the paragraph plus the route to the book. Object shapes are invisible to gate 6/7's regex,
 * which is correct: there is no literal id in them to check.
 *
 * A `denominator` ON THE HELP OBJECT IS THE SAME CONTRACT `figureCard` ALREADY HAS, one level
 * up. A denominator under a TABLE is a `denomNote` paragraph — 22 of them across these three
 * register pages — and the sentence is what this wave is moving off the surface, not the
 * claim: `figureCardModel` (gas_shared/ui/figures.js) resolves the merge in exactly one
 * place, so the sentence LEADS the tip lines and is written to `data-denominator` on the
 * section itself, where a test can read what a reader reads. Additive in the strict sense:
 * a help object with no `denominator` key takes the `tipLabel` path it already took, byte
 * for byte, which is what keeps `secrets.js`'s twenty-odd calls unchanged.
 */
export function sectionCard(title, help, ...kids) {
  const merged = headingDenominator(help);
  const section = el("section", { class: "card" },
    el("h2", { class: "section-label" }, sectionHeading(title, help, merged)),
    ...kids,
  );
  if (merged) section.setAttribute("data-denominator", merged.denominator);
  return section;
}

/**
 * The denominator merge, for the two heading builders that share it (`sectionCard` above and
 * `chartCard` below). Returns null unless there is really a sentence to prepend, which is
 * what keeps every existing call site on its existing path.
 */
function headingDenominator(help) {
  if (!help || typeof help !== "object" || Array.isArray(help) || !help.denominator) return null;
  const merged = figureCardModel({ help, denominator: help.denominator });
  return merged.denominator ? merged : null;
}

function sectionHeading(title, help, merged) {
  if (!help) return title;
  if (typeof help === "string") return glossaryTip(title, help);
  if (merged) return tipLabel(title, { lines: merged.lines, term: merged.term });
  return tipLabel(title, help);
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

/** Only reached when bootstrap has not landed; bootstrap's `severityOrder` is the source.
 *  `sast.js` imports this rather than declaring its own copy. */
export const SEVERITY_FALLBACK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

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
      notApplicable: notApplicable === 0 ? absentText : `${fmtCount(notApplicable)} no such column`,
    },
    verdict,
    denominator:
      `${fmtCount(measured)} of ${fmtCount(applicable)} applicable rows evaluated `
      + `(${pct1(coveragePct)}); ${fmtCount(missing)} never evaluated; `
      + `${fmtCount(notApplicable)} of ${fmtCount(total)} rows in view have no such signal.`,
  };
}

/**
 * THE THREE STATES AS THREE WORDS — the legend a bar carries, and the bar's own segments.
 *
 * `signalFigure` above already keeps measured / never-evaluated / not-applicable apart in
 * three vocabularies; these three constants ARE those vocabularies, minus their counts,
 * because `axisBar`'s legend prints the value name and the count itself. Spelled once and
 * exported so `sast.js` reads the same words this page does rather than a second set that
 * could drift to "unknown" or "n/a" — the two spellings this module exists to refuse.
 */
export const SIGNAL_EVALUATED = "evaluated";
export const SIGNAL_NEVER_EVALUATED = "never evaluated";
export const SIGNAL_NO_COLUMN = "no such column";

/**
 * One tri-state signal as an `axisBar` reading — `{values, total, counts, unknowns}`, which
 * is exactly what `axisSegments` takes.
 *
 * WHAT THIS REPLACES: a five-column table whose fifth column was a PROSE reading, one
 * sentence per row, plus a `denomNote` paragraph per row under it — ~110 words on this page
 * for three signals. The three counts are a DIVISION of one population, and a division read
 * as three numbers in a row has to be re-derived by the reader every time; as one bar it is
 * read in a glance, and the legend still prints every count in words beside it.
 *
 * THE THIRD SEGMENT IS DRAWN ONLY WHERE IT EXISTS, and that is a measurement about these two
 * pages rather than taste. `signalCoverage` (src/server/readModels.ts) is handed THIS
 * REGISTER'S OWN ROWS, so `notApplicable` — rows of some other scope, which have no such
 * column — is 0 by construction on the sca and sast register pages, and the table this
 * replaces printed an em dash there on every row. A permanent zero-width segment with a
 * legend entry reading "no such column 0" would be a state nobody can act on drawn three
 * times per page. Where the count IS non-zero (a mixed-scope payload), the segment appears
 * and is hatched: `unknowns` is `axisBar`'s one mark for "this part is not a measurement",
 * and a row with no such column was never measured, it was never measurable.
 *
 * `total` is the SUM of the three counts rather than `signal.total`, so the shares always
 * sum to one. They are the same number on a well-formed payload (`coverageOf` builds
 * `applicable + notApplicable === total`); taking the sum means a malformed one draws a bar
 * that is still internally honest instead of one whose segments stop short of the track.
 */
export function signalReading(signal) {
  const s = signal || {};
  const measured = num(s.measured, 0);
  const missing = num(s.missing, 0);
  const notApplicable = num(s.notApplicable, 0);
  const counts = {
    [SIGNAL_EVALUATED]: measured,
    [SIGNAL_NEVER_EVALUATED]: missing,
    [SIGNAL_NO_COLUMN]: notApplicable,
  };
  const values = [
    SIGNAL_EVALUATED,
    SIGNAL_NEVER_EVALUATED,
    ...(notApplicable > 0 ? [SIGNAL_NO_COLUMN] : []),
  ];
  return {
    values,
    total: values.reduce((sum, v) => sum + counts[v], 0),
    counts,
    // Only the not-applicable portion is hatched — see the doc comment.
    unknowns: { [SIGNAL_NO_COLUMN]: notApplicable },
  };
}

/**
 * The signal's STATE as a pill: a dot, a word and a colour, never a colour alone.
 *
 * The state is the one thing the bar cannot say — a 40%-filled bar looks the same whether
 * the other 60% was evaluated-and-negative or never looked at, and `signalFigure`'s whole
 * point is that those are different claims. DESIGN.md's rule is that a state pairs colour
 * with a glyph and a word; `.pill` carries the dot, this carries the word.
 *
 * "Partly evaluated" rather than the count: the count is in the legend under it, and a pill
 * restating it would be the same number twice on one line. The sentence that says what
 * partial coverage MEANS ("unknown, not clean") is the row label's tip.
 */
export function signalStatePill(signal) {
  const s = signal || {};
  const spec = {
    measured: ["ok", "Fully evaluated"],
    "partly-measured": ["warn", "Partly evaluated"],
    unmeasured: ["warn", "None evaluated"],
    "not-applicable": ["neutral", "No such column"],
  }[s.state] || ["neutral", "Not measured"];
  return statusPill(spec[0], spec[1]);
}

/**
 * One signal: its name, its state, and how the register divided over it.
 *
 * The label's tip carries the two sentences that used to be printed — the reading
 * (`verdict`) and the denominator — with the row's own glossary term still routing to the
 * book on Enter. Shared with `sast.js`, whose single `ai_verdict` signal is the same shape
 * with one row instead of three.
 *
 * NO BAR WHERE THERE IS NOTHING TO DIVIDE. `applicable === 0` is either "this register has
 * no such column at all" — the count says how many rows, and a 0%-filled bar would be a
 * measurement of a population nobody could measure — or "nothing is in view", which is the
 * filter's answer, not the signal's.
 */
export function signalRow(signal, opts) {
  const s = signal || {};
  const head = el("div", { class: "signal-row__head" },
    el("span", { class: "signal-row__name" },
      tipLabel(s.label, { term: s.glossary, lines: [s.verdict, s.denominator] })),
    signalStatePill(s));
  const box = el("div", { class: "signal-row" }, head);
  if (num(s.applicable, 0) === 0) {
    box.append(el("p", { class: "small muted" },
      num(s.notApplicable, 0) > 0
        ? s.cells.notApplicable
        : "No row in view carries this signal either way."));
    return box;
  }
  const reading = signalReading(s);
  const bar = axisBar({ values: reading.values, unit: (opts && opts.unit) || "rows in view" });
  bar.paint(axisSegments(reading, reading.values));
  box.append(bar);
  return box;
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

/**
 * BOTH COUNTS, NO SENTENCE — the age chart's caption, in the shape `mttr.js` already uses.
 *
 * `agingModel.denominator` is a 25-word origin sentence and it stays exactly as it is; what
 * changes is where it is drawn (the chart heading's tip lines). What cannot move off the
 * surface is the SECOND count: `ageBucketsBy` skips every open row with no readable age, so
 * the bars cover fewer findings than the hero does, and that difference is the Outside —
 * CLAUDE.md's rule is that it is named, in words, beside the picture that excluded it.
 *
 * `undated` is DERIVED here rather than shipped, because the payload does not carry it:
 * `ageBuckets` returns the bucketed count only (`insights.ts` says so — "totalOpen + unaged
 * is the open population", and only `slaConsumedDeciles` ships the second half). Both inputs
 * are refused before any cast and the difference is floored at zero: a negative undated count
 * would mean the two figures were measured over different populations, which is a payload
 * defect and not something to print as a negative.
 */
export function agingSurfaceNote(open, bucketed) {
  const total = num(open, 0);
  const aged = num(bucketed, 0);
  const undated = Math.max(0, total - aged);
  return fmtCount(aged) + " open with a readable age"
    + (undated > 0 ? " · " + fmtCount(undated) + " undated" : "");
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
 * The columns this page does not draw, named.
 *
 * A register page that silently omits the fields its own brief promised looks like a
 * register with nothing to say. `api_getRegisterPage` / `api_getSecretsPage` are aggregate
 * endpoints plus a top-N ranking; these columns exist in the ledger and simply do not travel
 * to this aggregate reply — "payload" is the wire's word for that, not a reader's, so the
 * sentence says what the reader can act on instead.
 */
export function missingColumnsNote(fields) {
  return "Not shown on this page: " + fields.join(", ")
    + ". These columns are in the ledger; this register publishes aggregates and a "
    + "top-N ranking rather than every column, so no table here can draw them. "
    + "Open the finding in Wiz for the full record.";
}

/**
 * A filter-narrowed section with nothing to show, dated when a date is in hand.
 *
 * `emptyText` on `dataTable` already reads "Nothing open." / "No open findings in this
 * dimension." — a state the register can legitimately be in with NO filter active at all, and
 * that sentence is right for it. What it cannot say is whether a SEVERITY FILTER is why the
 * table is empty rather than the register itself — `measuredEmpty` (ui/feedback.js) is the
 * "we looked, on this date, and there was nothing" shape, and it earns its place only once a
 * filter narrows the population, never as a second caption on an unfiltered empty register.
 * Returns null in every other case rather than being folded into `dataTable`'s own emptyText,
 * because whether a given section's emptiness even CAN be explained by the severity filter is
 * a per-call-site decision (secrets' toolbar covers validation/confidence too, not severity).
 */
export function filterEmptyNotice(asOf, filterOn, empty, sentence) {
  if (!empty || !filterOn) return null;
  // `sentence` names WHICH filter narrowed it, because the secrets toolbar filters on the
  // credential's state and its detector confidence and never on severity — a shared string
  // reading "the current severity filter" would name a control that register does not have.
  return measuredEmpty(sentence || "Nothing matched the current severity filter.", { at: asOf });
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

/**
 * The per-finding register, SERVER-paged and SERVER-sorted.
 *
 * `pagedTable` above sorts and pages a row set the page already has in hand — the aggregate
 * endpoints' oldest-open ranking, capped at a few hundred rows server-side. This is the
 * opposite shape: `api_getRegisterRows` is the whole register (sca is ~18,800 rows), so a
 * click here re-fetches rather than re-sorting an array already in the browser. The ordering
 * rule itself still lives on the server (`domain/pagePayload.ts`'s `sortRegisterRows` — see
 * that file's header for why there is exactly one rule and `test/registerRowsOrdering.test.js`
 * for the twin that holds this component's own `sortRows`/`pageOf` reads to it); this
 * component only ever reads back what the server already ordered and never re-sorts a page
 * itself.
 *
 *   scope        "sca" | "sast" | "secrets"
 *   columns      dataTable column spec — `sortable: true` columns must name one of this
 *                scope's own `REGISTER_ROW_COLUMNS` (readModels.ts falls back to the scope's
 *                default sort otherwise, silently, so a stray key here would just stop sorting)
 *   severities   the toolbar's current selection, or `undefined` on secrets (its severity
 *                filter is refused server-side — see `getRegisterRows`'s own header)
 *   showNoFix    sca only; `undefined` elsewhere
 *   defaultSort/defaultDir  the scope's own opening order — mirrors
 *                `REGISTER_ROW_DEFAULT_SORT` so the FIRST paint's header already reflects
 *                what the server actually sent, with no flash of the wrong arrow
 *   status       "open" | "resolved", or "" for the whole register — the one row param that
 *                has always existed on the server and that no page sent until this wave
 *   validation   secrets only: credential states to keep (VALID/INVALID/UNKNOWN/ERROR)
 *   confidence   secrets only: detector grades to keep, measured off the page's own segments
 *   at           `vm.asOf` — dates the `filterEmptyNotice` this table draws below itself when
 *                a filter narrows a server page to zero rows. All three registers pass it
 *                now: secrets has no severity filter but it does have the other three, so
 *                "nothing matched" is a reachable state there too
 *   emptySentence  which filters that notice names. The default names the severity one, and
 *                secrets does not have it — a shared string would point at a missing control
 */
export function registerRowsTable(spec) {
  const {
    scope, columns, severities, showNoFix, defaultSort, defaultDir, emptyText, at,
    status, validation, confidence, emptySentence,
  } = spec;
  const state = {
    page: 0, pageSize: DEFAULT_PAGE_SIZE, sort: defaultSort, dir: defaultDir || "desc",
  };
  const host = el("div", { class: "table-host" });

  function load() {
    host.replaceChildren(skeletonStack(3, { widths: ["100%", "100%", "70%"] }));
    const params = {
      scope, page: state.page, pageSize: state.pageSize, sort: state.sort, dir: state.dir,
    };
    if (severities !== undefined) params.severities = severities.length ? severities : undefined;
    if (showNoFix !== undefined) params.showNoFix = showNoFix;
    // THE THREE ROW-LEVEL FILTERS, and they are sent only when they are ON. `status` is
    // "open" | "resolved" and anything else means all — `registerRowsModel` normalises it —
    // so an absent key and "all" are the same request rather than two. `validation` and
    // `confidence` are secrets-only server-side (ignored, and echoed back as null, on the
    // other two scopes), which is why these pages pass them only where they exist.
    if (status) params.status = status;
    if (validation && validation.length) params.validation = validation;
    if (confidence && confidence.length) params.confidence = confidence;
    swrCall("api_getRegisterRows", params)
      .then((data) => paint(data || {}))
      .catch((e) => {
        host.replaceChildren(errorState("This table could not be loaded.", {
          detail: e && e.message ? e.message : String(e),
        }));
      });
  }

  function paint(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    // The server is the one source of truth for what page/sort it actually served — a
    // clamped page or a sort that fell back to the scope's default answers back through
    // these, so the footer and the active header never show a request the server refused.
    state.page = num(data.page, state.page);
    state.pageSize = num(data.pageSize, state.pageSize);
    state.sort = data.sort || state.sort;
    state.dir = data.dir === "asc" ? "asc" : "desc";
    const table = dataTable({
      columns,
      rows,
      // THE DRILL-DOWN, and `rows` is exactly the server page in hand — prev/next inside the
      // sheet walks these fifty and no more, because these are the rows the reader can see.
      // A sheet reads the row and nothing else (pages/findingSheet.js), so opening one costs
      // no call and can show no figure this table could not.
      onRowOpen: (r) => openFindingSheet(scope, r, { rows }),
      rowLabel: (r) => findingRowLabel(scope, r),
      sort: { key: state.sort, descending: state.dir === "desc" },
      onSort: (key) => {
        state.dir = state.sort === key && state.dir === "desc" ? "asc" : "desc";
        state.sort = key;
        state.page = 0;
        load();
      },
      emptyText: emptyText || "Nothing to show.",
      stickyHeader: true,
    });
    const footer = tableFooter({
      page: state.page,
      pageCount: num(data.pageCount, 1),
      total: num(data.total, rows.length),
      pageSize: state.pageSize,
      onPage: (p) => { state.page = p; load(); },
      onPageSize: (size, nextPage) => { state.pageSize = size; state.page = nextPage; load(); },
    });
    const filterOn = !!(severities && severities.length) || !!status
      || !!(validation && validation.length) || !!(confidence && confidence.length);
    const notice = filterEmptyNotice(at, filterOn, rows.length === 0, emptySentence);
    host.replaceChildren(table, footer, ...(notice ? [notice] : []));
  }

  load();
  return host;
}

/**
 * The stacked age bar's series as a table model — `labels` and `perSev` are the SAME two
 * arrays `stackedAgeBar` is handed, read once here and once there.
 *
 * The severity columns are filtered exactly the way `charts.js::stackedAgeBar` filters its
 * datasets (`order.filter((s) => perSev[s])`), so the table lists the bars that were drawn
 * and no others. NO TOTAL COLUMN: a stacked total looks obvious and is not, because a null
 * bucket count would have to be summed as a zero to produce one, which is the exact move
 * `ui/figures.js` exists to refuse.
 *
 * `bucketLabel` NAMES THE X AXIS, and it is a parameter because this model outgrew age.
 * `mttr.js`'s "SLA window consumed" hands it ten tenth-of-window labels; a first column
 * headed "Age bucket" over "0".."9" would name a quantity the table does not hold, and this
 * table is the non-visual reader's ONLY copy of the chart, so the wrong word there is the
 * wrong figure rather than a cosmetic slip. Defaults to the age wording, so the two register
 * pages that pass nothing are unchanged.
 */
export function agingTableModel(labels, perSev, order, bucketLabel = "Age bucket") {
  const buckets = Array.isArray(labels) ? labels : [];
  const perSevOf = perSev || {};
  const sevs = (order || []).filter((s) => perSevOf[s]);
  return chartTableModel({
    columns: [
      { key: "bucket", label: bucketLabel, format: "text", value: (_row, i) => buckets[i] },
      ...sevs.map((s) => ({
        key: s,
        label: s,
        format: "count",
        value: (_row, i) => perSevOf[s][i],
      })),
    ],
    rows: buckets,
  });
}

/**
 * The severity bar's counts as a table model. Same `counts` object and same `order` the
 * wrapper gets, and the same zero-drop rule `charts.js::severityBar` applies — a level with
 * nothing in it is not a bar, so it is not a row either.
 */
export function severityCountsTableModel(counts, order, valueLabel) {
  const tally = counts || {};
  return chartTableModel({
    columns: [
      { key: "sev", label: "Severity", format: "text", value: (s) => s },
      { key: "count", label: valueLabel || "Open findings", format: "count", value: (s) => tally[s] },
    ],
    rows: (order || []).filter((s) => tally[s]),
  });
}

/**
 * A chart card that survives a deployment whose policy refuses the charts bundle.
 *
 * `table` is the canvas's data-table alternative: `{ caption, model }`, where `model` is
 * already built by `chartTableModel` / `survivalTableModel` from THE SAME arrays the `draw`
 * callback hands the wrapper. It is rendered EAGERLY, before `loadCharts()` is even asked —
 * so the case this card was written for (the bundle refused, `chartUnavailable(canvas)`) is
 * also the case where the figures are the only thing left, and they are already on screen.
 *
 * `help` is the fifth argument BECAUSE THE FOURTH IS ALREADY SPOKEN FOR. It takes every
 * `tipLabel` shape and lands on the card's own heading — the one place a chart's method
 * sentence can go without sitting under the picture as a third line of prose. `note` stays
 * what it always was, the caption a reader must not have to ask for (a count, the population
 * the bars could not hold); the SENTENCE explaining it moves here. Callers passing four
 * arguments render byte-identically, which is what keeps `secrets.js`'s two calls unchanged.
 */
export function chartCard(title, note, draw, table = null, help = null) {
  const canvas = el("canvas");
  const merged = headingDenominator(help);
  const card = el("section", { class: "chart-card" },
    el("h3", { class: "section-label" },
      merged ? tipLabel(title, { lines: merged.lines, term: merged.term }) : tipLabel(title, help)),
    note ? el("p", { class: "chart-note" }, note) : null,
    el("div", { class: "chart-box" }, canvas),
    table ? chartTable({ canvas, caption: table.caption, model: table.model }) : null,
  );
  if (merged) card.setAttribute("data-denominator", merged.denominator);
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
export function registerToolbar({ route, severities, order, showNoFix, offerNoFix, status }) {
  const bar = el("div", { class: "toolbar" });
  // `navigate`, not `setParams`: `history.replaceState` fires no `hashchange`, so the
  // filter would rewrite the URL and leave the page showing the previous fetch. Going
  // through the hash re-enters `route()`, which is the one place a register refetches.
  const onChange = (patch) => {
    const next = { sev: listJoin(severities), nofix: showNoFix ? "" : "0", status: status || "" };
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
  // GROUPED, like the state segment below it. The label and its pills used to sit loose in
  // the flex row beside "Findings table" and its own segment, so at 640px the row wrapped
  // between a label and the control it names — measured on the seeded harness at 640, where
  // this toolbar carries three labelled controls. `.toolbar-group` (pages.css) wraps the
  // GROUPS instead, which is the only wrap that cannot mislabel a control.
  bar.append(el("div", { class: "toolbar-group" },
    el("span", { class: "small muted" }, "Severity"), pills));

  // THE STATE SEGMENT NARROWS ONE TABLE, AND IT SAYS SO. `status` is a parameter of
  // `api_getRegisterRows` only: the aggregates above are computed over the whole register
  // and are not refetched by it. A control that silently changed some figures and not
  // others would be worse than no control, so its own label names what it narrows.
  bar.append(statusSegment(status, onChange));

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

/**
 * The Open / Resolved / All choice, as one control the three registers share.
 *
 * SERVER-SIDE, AND IT ALWAYS WAS: `RowPageParams.status` has existed since the row endpoint
 * was written and no page ever sent it, so every register opened on the whole ledger with no
 * way to ask for just what is still outstanding. "All" is the empty param rather than the
 * literal string, so a default view is a bare URL and a shared link never carries a filter
 * nobody chose.
 */
export function statusSegment(status, onChange) {
  return el("div", { class: "toolbar-group" },
    el("span", { class: "small muted" }, "Findings table"),
    segmented({
      options: [
        {
          value: "open", label: "Open",
          title: "Only findings still in the register, in the table at the foot of this page.",
        },
        {
          value: "resolved", label: "Resolved",
          title: "Only findings that have left the register. Read the state word beside each "
            + "one: a resolution can be an observed event or a scan that stopped seeing it.",
        },
        {
          value: "all", label: "All",
          title: "Open and resolved together — the whole register, which is how it opens.",
        },
      ],
      value: status === "open" || status === "resolved" ? status : "all",
      ariaLabel: "Findings table: state",
      onChange: (v) => onChange({ status: v === "all" ? "" : v }),
    }),
  );
}

/**
 * A labelled row of NEUTRAL toggle pills — the multi-select filter shape without the
 * severity vocabulary that `registerToolbar` above is built on.
 *
 * IT EXISTS SO `secrets.js` NEVER HAS TO NAME ONE. `togglePills` defaults to
 * `pillClass: "sev-pill"` and `sevClass: true`, which would stamp a `sev-VALID` class onto a
 * credential-state filter and put a `sev`-shaped identifier in the one page file that is
 * swept for exactly that (`test/pagesLit.test.js`'s gate 4 — no severity class, badge or
 * helper anywhere in the secrets page's executable code). `kind-pill` is the shared neutral
 * pill: the same base as a severity pill, accent-washed when pressed, with no level tint —
 * which is also the honest mark here, because a credential being LIVE is not a severity.
 */
export function pillFilterRow({ label, options, selected, ariaLabel, onToggle }) {
  return el("div", { class: "toolbar-group" },
    el("span", { class: "small muted" }, label),
    togglePills({
      options, selected, ariaLabel, onToggle, pillClass: "kind-pill", sevClass: false,
    }),
  );
}

/** The filter params these register pages read out of the hash, in one place. */
export function readRegisterParams(params) {
  const p = params || {};
  const status = String(p.status || "").toLowerCase();
  return {
    severities: listSplit(p.sev),
    // `showNoFix` defaults TRUE, matching `modelParams` on the server: the register is the
    // whole population until a reader narrows it.
    showNoFix: p.nofix !== "0",
    // Normalised HERE and not at the control: a hand-edited hash is the one place an
    // unexpected value arrives, and the server would fall back to "all" silently. Reading it
    // back as "" keeps the toolbar and the URL agreeing about what is on.
    status: status === "open" || status === "resolved" ? status : "",
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
 * `ui/tableModel.js` and `navModel.js` already make. The half that can be WRONG is this
 * half, and `test/pagesRegisters.test.js` holds it.
 */
export function scaModel(payload, opts) {
  const p = payload || {};
  const order = (opts && opts.severityOrder) || SEVERITY_FALLBACK;
  const awaiting = p.awaiting || {};
  const coverage = p.signalCoverage || {};
  const firstRun = registerFirstRunView(p.rowCount, opts && opts.synced, opts && opts.at);

  // THE TWO CLOCKS. `openTotal` is the whole open backlog in this scope; `overall` is the
  // part of it with no published fix. Everything else is the part a team could have closed.
  const openTotal = num(awaiting.openTotal, num(p.open));
  const awaitingCount = num(awaiting.overall);
  const actionableCount = Math.max(0, openTotal - awaitingCount);

  return {
    scope: "sca",
    firstRun,
    asOf: p.asOf ?? null,
    severities: p.severities ?? null,
    showNoFix: p.showNoFix !== false,
    rowCount: num(p.rowCount),
    open: num(p.open),
    resolved: num(p.resolved),

    // WHAT THE FIGURES ABOVE WERE MEASURED OVER — the in-scope count, the gate the last scan
    // of THIS scope applied, and the base filters its query carries. Passed straight through:
    // `populationLine` (registerModel.js) is the one place that decides how it reads, so all
    // three registers cannot disagree about it. Null on a payload written before the block
    // existed, and the page draws nothing rather than half a sentence.
    population: p.population ?? null,

    // ON A FIRST RUN THE FIGURE IS NOT A ZERO. `rowCount`/`open`/`resolved` above stay the
    // real numbers the payload carried, however zero, because they are what `firstRun` itself
    // was decided from — but the HERO is the one figure a reader meets before anything else on
    // the page, and "0 open findings of 0 in the register" is a confident claim about a
    // register nobody has read. `firstRunNotice`, rendered right below, carries the reason.
    hero: {
      label: "Dependencies",
      value: firstRun.show ? absentText : fmtCount(p.open),
      sub: firstRun.show
        ? "Nothing has been measured for this register yet."
        : `open findings of ${fmtCount(p.rowCount)} in the register — `
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
        // THE SHORT FORM, AND IT IS THE ONE ON SCREEN. R3's ladder: "N of M open findings"
        // under the figure, the sentence below one level down on the label's own tip. Two
        // counts rather than the percentage they imply — a share is what the reader can
        // derive from these, not the other way round, and the two clocks are complements of
        // one backlog, which is legible in "12 of 90 / 78 of 90" and not in "13.3% / 86.7%".
        short: `${fmtCount(awaitingCount)} of ${fmtCount(openTotal)} open findings`,
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
        short: `${fmtCount(actionableCount)} of ${fmtCount(openTotal)} open findings`,
        denominator:
          `${fmtCount(actionableCount)} of ${fmtCount(openTotal)} open dependency findings `
          + "have a fixed version available. This is the only population whose remaining time "
          + "open measures us rather than upstream.",
      },
    },
    blended: null,

    // Absent is never zero — three signals, three states each.
    signals: [
      // Each signal carries ITS OWN glossary term. All three used to pass "sca" — the
      // register's own entry — so every one of these rows opened the same card defining
      // software composition analysis, on a page that is already the SCA register.
      signalFigure("has_kev", "CISA KEV", "kev", coverage.has_kev),
      signalFigure("has_exploit", "Known exploit", "known-exploit", coverage.has_exploit),
      signalFigure("epss", "EPSS score", "epss", coverage.epss),
    ],

    severityAxis: p.severityAxis || { supported: true },
    counts: p.counts || {},
    severityOrder: order.slice(),
    aging: agingModel(p.aging),
    tiers: tierModel(p.tiers, RISK_TIER_ORDER, RISK_TIER_LABELS),
    funnel: funnelModel(p.funnel),
    // THE LIST IS STATED TWICE — here and in readModels.ts's CONCENTRATION_DIMS — and THIS
    // copy is the one that renders: `concentrationModel` maps over the dims it is GIVEN, so a
    // name here that the payload does not carry yields a card with zero rows rather than no
    // card. Dropping `language` from the server alone therefore replaced the breakdown with an
    // empty one; both copies have to agree. (Passing no list at all falls back to
    // `Object.keys(perDim)` — the server's order — which would remove the duplication, but it
    // also hands the page's card order to the payload, so the explicit list stays.)
    concentration: concentrationModel(p.concentration, ["repo", "owner_project"]),
    oldest: oldestFindingsModel(p.oldest),
    oldestRepos: oldestReposModel(p.oldest),
    movement: movementModel(p.movement, p.latestScan),

    // THE AGGREGATE ENDPOINT (`api_getRegisterPage`) STILL CARRIES NO PER-ROW STRING — that
    // is what `perRow: false` reports, and it is a fact about THIS payload, not about the
    // page. The string itself, and every other column in `REGISTER_ROW_COLUMNS.sca`, travels
    // through `api_getRegisterRows` and the per-finding table below.
    fixedVersion: {
      perRow: false,
      withFix: actionableCount,
      withoutFix: awaitingCount,
      reason: "The fixed version is a per-finding string; this aggregate endpoint counts rows "
        + "that have one rather than naming them — the strings themselves are in the "
        + "per-finding table below.",
    },
    // ECOSYSTEM HAS NO LEDGER COLUMN AT ALL — the one column of the stub's original promise
    // this page still cannot draw, because there is nowhere in `LEDGER_COLUMNS` for it to
    // have come from. `component` and `fixed_version` are dropped from this list: both now
    // ship through `api_getRegisterRows`'s per-finding table.
    missingColumns: missingColumnsNote(["ecosystem"]),
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
  const synced = !!(boot && boot.latestSync);
  const at = boot && boot.latestSync ? boot.latestSync.ts : null;

  return renderRegisterPage(host, {
    skeleton: () => skeletonStack(6, { widths: ["70%", "100%", "90%", "100%", "80%", "60%"] }),
    fetch: () => swrCall("api_getRegisterPage", {
      scope: "sca",
      severities: filters.severities.length ? filters.severities : undefined,
      showNoFix: filters.showNoFix,
    }),
    paint: (payload) =>
      paintSca(host, scaModel(payload, { severityOrder: order, synced, at }), filters),
  });
}

function paintSca(host, vm, filters) {
  // A SHEET OUTLIVES THE PAINT THAT OPENED IT. `openSheet`'s own hook closes on a change of
  // ROUTE NAME only (gas_shared/ui/sheet.js), and every control in the toolbar below rewrites
  // this route's query params — so a filter change repaints the page under an open finding
  // sheet still wired to the previous render's rows. Closing here, at the top of the repaint,
  // is the gas_ai pattern and the one place that covers both paths.
  closeActiveSheet();

  // THE HERO BAR WAS COLOUR AND NOTHING ELSE. Five segments, no key, no counts — the one
  // thing DESIGN.md rules out outright — and on an empty ledger it degraded to an empty
  // bordered box that read as a broken widget rather than as "nothing open". `sevKeyRow`
  // beside it carries the dot, the level name and the count for every segment drawn, and a
  // zero total renders NEITHER: an absent distribution is stated by the figures beside it,
  // not by an empty rectangle.
  const heroSevs = sevEntries(vm.counts, vm.severityOrder);
  host.append(pageHeader({
    // See sast.js: the lane is the eyebrow, the h1 is the page's PAGES title, and the term
    // defines the register rather than the count under it.
    route: "sca",
    help: { term: "sca" },
    hero: heroStat(null, vm.hero.value, vm.hero.sub),
    // THE PARAGRAPH IS GONE AND THE PICTURE IS THE ASIDE. "A CVE in a third-party package.
    // Fixed by upgrading it — which nobody can do until a fixed version exists." was 22 words
    // restating the `sca` glossary entry ("a known CVE in a third-party package at a version.
    // / Fixed by upgrading the dependency — which means it cannot be fixed at all until a
    // fixed version exists") word for word, under a term already carried by the h1 above it.
    // R2's DELETE case: a duplicate, and the one fate that needs no second home.
    aside: el("div", { class: "page-strip" },
      heroSevs.length
        ? [
          sevSegmentBar(heroSevs, { size: "lg", label: "Open findings by severity" }),
          sevKeyRow(heroSevs),
        ]
        : null,
    ),
    // SUPPRESSED, not dashed — the same convention Executive and MTTR use. "In register 0 ·
    // Open 0 · Resolved 0" over a register nobody has read is three more confident zeros
    // beside the hero's own.
    stats: vm.firstRun.show ? [] : [
      statRow("In register", fmtCount(vm.rowCount), "findings, open and resolved"),
      statRow("Open", fmtCount(vm.open), "still outstanding"),
      statRow("Resolved", fmtCount(vm.resolved), "closed in the ledger"),
    ],
  }));

  // WHAT THIS PAGE MEASURED, AND WHAT IT NEVER LOOKED AT — one quiet line under the hero.
  // Provenance, not a figure: the in-scope count, the severity gate the last scan of this
  // register APPLIED, the base filters its query carries, and, where a gate was applied, the
  // fact that what fell below it was never counted rather than counted as none.
  //
  // WITHHELD ON A FIRST RUN, on the same rule as the stat row above it: "In scope 0" over a
  // register nobody has read is one more confident zero, and `firstRunNotice` below already
  // says what is missing.
  const population = vm.firstRun.show ? null : populationLine(vm);
  if (population) host.append(el("p", { class: "small muted" }, population.text));

  // FIRST RUN STOPS HERE. Every section below — the two clocks, the exploitation signals,
  // both charts (so neither canvas is ever created), the tier and funnel tables, every
  // breakdown, the oldest-open ranking, the per-finding table and the movement card — reads a
  // population of exactly zero on an unread register, and each one would otherwise print its
  // own confident "0". `firstRunNotice` carries the one sentence this page owes a reader
  // instead; the notice's `hint` says what specifically fills this register.
  if (vm.firstRun.show) {
    host.append(firstRunNotice({
      synced: vm.firstRun.synced,
      at: vm.firstRun.at,
      hint: "Dependency findings arrive with the first sync that saves a row for this "
        + "register; enable it under Settings → Register if it is off.",
    }));
    return;
  }

  host.append(registerToolbar({
    route: "sca",
    severities: filters.severities,
    order: vm.severityOrder,
    showNoFix: filters.showNoFix,
    offerNoFix: true,
    status: filters.status,
  }));

  // ------------------------------------------------------------------- the two clocks
  //
  // THE 43-WORD LEDE IS THE HEADING'S DEFINITION NOW. "An SCA finding cannot be fixed before
  // somebody else publishes a fixed version…" is what "The clock splits" MEANS; printed under
  // the heading it was a paragraph a reader had to get through to reach the two figures it
  // was introducing. The `two-clocks` term still routes to the book from the same trigger.
  const clocks = sectionCard("The clock splits", {
    term: "two-clocks",
    lines: [
      "An SCA finding cannot be fixed before somebody else publishes a fixed version, so the"
      + " wait for a vendor and the wait for a team are counted separately.",
      "This page publishes no figure that averages the two together — an average across both"
      + " measures the vendor and the team at once and names neither.",
    ],
  },
    // ONE COLUMN, because this card is now half the page wide. `.kpi-row`'s default track is
    // `repeat(auto-fit, minmax(160px, 1fr))`, which still fits both figures side by side in
    // ~800px — and two 160px-floor tiles in a 400px column each is a figure with its
    // explanatory sub-line wrapped to three rows. Stacked, each tile gets the full width of
    // the card and its sentence stays on one line. The two counts are also a SPLIT of one
    // population (112 + 168 = 280), which reads down a column as naturally as across a row.
    el("div", { class: "kpi-row kpi-row--column" },
      figureCard({
        label: vm.clocks.awaitingVendor.label,
        value: fmtCount(vm.clocks.awaitingVendor.count),
        sub: `${vm.clocks.awaitingVendor.short} — measures ${vm.clocks.awaitingVendor.measures}`,
        help: { term: vm.clocks.awaitingVendor.glossary },
        denominator: vm.clocks.awaitingVendor.denominator,
      }),
      figureCard({
        label: vm.clocks.actionable.label,
        value: fmtCount(vm.clocks.actionable.count),
        sub: `${vm.clocks.actionable.short} — measures ${vm.clocks.actionable.measures}`,
        // THE FIXED-VERSION SENTENCE LANDS HERE, on the card whose count it qualifies. It
        // says why this page can count the rows that HAVE a fixed version without naming the
        // versions themselves — a fact about this figure's provenance, which is a tip's job,
        // and it sat under the pair as a third paragraph in a section that had two.
        help: { term: vm.clocks.actionable.glossary, lines: [vm.fixedVersion.reason] },
        denominator: vm.clocks.actionable.denominator,
      }),
    ),
  );
  // ------------------------------------------------------------- exploitation signals
  //
  // ONE BAR PER SIGNAL, AND THE LEGEND CARRIES THE WORDS. What was here: a five-column table
  // whose last column was a prose "Reading" — one sentence per row — with a `denomNote`
  // paragraph per row underneath, ~110 words for three signals, to say how one population
  // divided three ways. `signalRow` draws that division and prints all three counts in the
  // legend beside it; the reading and the denominator are the row label's tip lines.
  // THE TWO CLOCKS AND THE SIGNALS SHARE A ROW, and they earn it as a reading rather than as
  // a layout: both divide the SAME 280 open findings, once by who the wait belongs to (a
  // vendor or the team) and once by what is known about exploitation. Stacked, each spent most
  // of a full-width card on empty space — two stat tiles and three bars are narrow content —
  // and the reader had to scroll one out of view to see the other. `.card-pair` is the
  // primitive the breakdowns below already use; below 1100px it is one column, which is what
  // each card was on its own.
  host.append(el("div", { class: "card-pair" },
    clocks,
    sectionCard("Exploitation signals", {
      term: "sca",
      lines: [
        "Three states, never two: a signal Wiz never evaluated is unknown, not clean, and"
        + " rendering it as a No is what makes an unassessed finding look assessed.",
      ],
    },
      el("div", { class: "signal-rows" },
        ...vm.signals.map((s) => signalRow(s, { unit: "dependency findings" }))),
    ),
  ));

  // ------------------------------------------------------------------ aging + tiers
  host.append(el("div", { class: "chart-row" },
    // The caption is BOTH COUNTS and no sentence (see `agingSurfaceNote`); the 25-word origin
    // sentence is the heading's tip, where a method note belongs.
    chartCard("Open findings by age", agingSurfaceNote(vm.open, vm.aging.totalOpen), (api, canvas) => {
      api.stackedAgeBar(
        canvas,
        vm.aging.labels,
        vm.aging.perSev,
        sevPalette(vm.severityOrder),
        "Open dependency findings by age bucket and severity.",
      );
    }, {
      caption: "Every bar of the stack as a count: one row per age bucket, one column per"
        + " severity drawn.",
      model: agingTableModel(vm.aging.labels, vm.aging.perSev, vm.severityOrder),
    }, { denominator: vm.aging.denominator }),
    chartCard("Open findings by severity", null, (api, canvas) => {
      api.severityBar(canvas, vm.counts, sevPalette(vm.severityOrder), null);
    }, {
      caption: "The length of each bar, as a count of open findings.",
      model: severityCountsTableModel(vm.counts, vm.severityOrder, "Open findings"),
    }),
  ));

  const tierRows = vm.tiers.rows.filter((r) => r.count > 0);
  // TWO NARROW CARDS SIDE BY SIDE. Both tables are three columns — a label, a count and a
  // share meter — so at full width each drew ~1,400px of empty card to the right of its own
  // content, and the reader's eye had to travel that gap to compare two readings of the same
  // 280 open findings. `.card-pair` is the existing primitive for exactly this
  // (secrets.js already pairs its segment cards with it): one column below 1100px, two above,
  // with `min-width: 0` on the items so a table that outgrows its half scrolls inside its own
  // `.table-wrap` rather than pushing the card's border off the pane.
  const narrowPair = el("div", { class: "card-pair" });
  narrowPair.append(sectionCard("What is known about each open finding",
    { denominator: vm.tiers.denominator },
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
      rows: tierRows,
      emptyText: "Nothing open to classify.",
    })),
    filterEmptyNotice(vm.asOf, filters.severities.length > 0, tierRows.length === 0),
  ));

  narrowPair.append(sectionCard("Triage funnel", { denominator: vm.funnel.denominator },
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
    // A PILL, NOT A PARAGRAPH, AND IT STAYS ON THE SURFACE. `funnel.note` is 38 words saying
    // that two steps are missing because internet exposure is a property of a host and this
    // register's asset is a repository. R2 keeps an honesty statement on the page: a reader
    // counting three steps where another register draws five needs the words, not a hover.
    // What moves one level down is the EXPLANATION; the claim is four words and a dot.
    vm.funnel.note
      ? el("p", { class: "small muted" },
        statusPill("neutral", "Exposure and overdue: not applicable", { lines: [vm.funnel.note] }))
      : null,
    filterEmptyNotice(vm.asOf, filters.severities.length > 0, vm.funnel.steps[0].count === 0),
  ));

  host.append(narrowPair);

  // ---------------------------------------------------------------------- breakdowns
  // THE THREE BREAKDOWNS PAIR TOO, and they are the strongest case for it: same four
  // columns, same shape, same units, read against each other. Stacked, comparing "By language"
  // with "By owning project" meant scrolling past a screen of white. An odd count is fine —
  // grid flows the third onto its own row at half width rather than stretching it.
  const breakdowns = el("div", { class: "card-pair" });
  for (const dim of vm.concentration) {
    breakdowns.append(sectionCard(dim.label, { denominator: dim.denominator },
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
            // heading's own tip says so; a bare count here would otherwise imply the
            // never-evaluated rows are known not to be on the catalogue.
            //
            // ONCE, ON THE HEADING, RATHER THAN THREE TIMES UNDER THREE TABLES. This page
            // draws one breakdown per dimension and the caveat was printed under every one of
            // them — the same 30 words, three times, about a column that appears once per
            // table. `ui/tip.js`'s rule is that a column's definition is asked once per table
            // rather than once per row; a caveat about what the column's counts do NOT
            // include is the same kind of claim.
            cell: (r) => fmtCount(r.kev),
            help: kevColumnHelp(vm.signals),
          },
        ],
        rows: dim.rows,
        emptyText: "No open findings in this dimension.",
      })),
      filterEmptyNotice(vm.asOf, filters.severities.length > 0, dim.rows.length === 0),
    ));
  }
  host.append(breakdowns);

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
      : emptyState("Nothing open in this register.", "Every dependency finding is resolved, or no sync has saved one yet."),
  ));

  // ------------------------------------------------------------- every finding, server-paged
  //
  // ONE LINE, AND THE REST ON THE HEADING. The 44-word lede explained the interaction (click a
  // column, open a row) and the `missingColumns` sentence under the table explained what this
  // page cannot draw — one is an affordance a reader discovers by using it, the other is a
  // fact about the payload. `missingColumnsNote` is still what writes the sentence
  // (`test/pagesRegisters.test.js` pins its wording); it is now a line on the heading rather
  // than a paragraph below 18 columns of table nobody reads to the end of.
  host.append(sectionCard("Every finding in the register", {
    lines: [
      "Click a column to ask the server for a different order rather than re-sorting what is"
      + " already on screen; open a row for everything the register holds about that finding.",
      vm.missingColumns,
    ],
  },
    el("p", { class: "small muted" }, "Open and resolved, server-paged and server-sorted."),
    registerRowsTable({
      scope: "sca",
      severities: filters.severities,
      showNoFix: filters.showNoFix,
      status: filters.status,
      at: vm.asOf,
      emptySentence: "Nothing matched the current filters.",
      defaultSort: "age_days",
      defaultDir: "desc",
      emptyText: "Nothing in this register.",
      columns: [
        { key: "identifier", label: "CVE", sortable: true, cell: (r) => textCell(r.identifier) },
        { key: "component", label: "Package", sortable: true, cell: (r) => textCell(r.component) },
        { key: "severity", label: "Severity", sortable: true, cell: (r) => sevBadge(r.severity) },
        {
          // The server sorts the raw `status` column; the label below is a rendering of it
          // (and of `resolution_src` / `reopened_count`, which ride the same row unsorted).
          key: "status", label: "Status", sortable: true,
          cell: (r) => textCell(PROVENANCE_LABEL[provenance(r)]), help: { term: "returned" },
        },
        { key: "repo_name", label: "Repository", sortable: true, cell: (r) => textCell(r.repo_name) },
        { key: "branch", label: "Branch", sortable: true, cell: (r) => textCell(r.branch) },
        { key: "first_seen", label: "First seen", sortable: true, cell: (r) => fmtDate(r.first_seen) },
        { key: "last_seen", label: "Last seen", sortable: true, cell: (r) => fmtDate(r.last_seen) },
        {
          key: "fixed_version", label: "Fixed version", sortable: true,
          cell: (r) => textCell(r.fixed_version),
        },
        {
          key: "fix_available_at", label: "Fix available", sortable: true,
          cell: (r) => fmtDate(r.fix_available_at), help: { term: "two-clocks" },
        },
        {
          key: "awaiting_vendor_fix", label: "Awaiting vendor", sortable: true,
          cell: (r) => yesNo(r.awaiting_vendor_fix), help: { term: "awaiting-fix" },
        },
        { key: "has_kev", label: "KEV", sortable: true, cell: (r) => triCell(r.has_kev) },
        {
          key: "has_exploit", label: "Exploit known", sortable: true,
          cell: (r) => triCell(r.has_exploit),
        },
        {
          key: "epss", label: "EPSS", className: "num", sortable: true,
          cell: (r) => epssPct(r.epss),
        },
        {
          key: "mttr_days", label: "MTTR", className: "num", sortable: true,
          cell: (r) => days1(r.mttr_days),
        },
        {
          key: "age_days", label: "Age", className: "num", sortable: true,
          cell: (r) => days1(r.age_days),
        },
      ],
    }),
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
export function kevCaveatLine(signals) {
  const kev = (signals || []).find((s) => s.id === "has_kev");
  if (!kev || kev.missing === 0) return null;
  return `KEV counts are a floor: ${fmtCount(kev.missing)} row(s) were never evaluated against `
    + "the catalogue, so they are unknown rather than absent from it.";
}

/**
 * The KEV column's heading help — the caveat where a column's caveats belong.
 *
 * AN EMPTY `lines` ARRAY IS NOT "NO LINES". `tipLabel` tests `help.lines` for truthiness and
 * `[]` is truthy, so `{term, lines: []}` renders a tip card with a term and nothing in it —
 * which is why this returns the bare `{term}` shape when the register was fully evaluated
 * rather than filtering an array down to empty at the call site.
 */
export function kevColumnHelp(signals) {
  const line = kevCaveatLine(signals);
  // "kev", not "sca". The column is headed "On KEV"; anchoring it to the register's own entry
  // answered a question the reader did not ask and left the one they did ask undefined.
  return line ? { term: "kev", lines: [line] } : { term: "kev" };
}

/** The same sentence as a paragraph — kept for a caller that wants it on the surface. */
export function kevCaveat(signals) {
  const line = kevCaveatLine(signals);
  return line ? el("p", { class: "small muted" }, line) : null;
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
