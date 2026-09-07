// Repositories — the estate: which repos carry the backlog, which offer a foothold, how fast
// a finding dies on them, and who owns them.
//
// NO gas/ COUNTERPART. This page is new (the OS-vuln register has no repository concept), so
// it is built straight from `domain/assets.ts::assetProfile` — a D6 port of
// brick/devsecops/metrics.py's asset-centric family — through `readModels.reposModel`, which
// runs the same estimator twice: `groupBy: "repo"` (one row per repository) and
// `groupBy: "language"` (one row per language, the only grain where percentiles across
// several repos are not trivially one point).
//
// DENSITY IS NEVER A MEAN. `AssetProfileRow` publishes `density_p25/p50/p75` and no mean —
// v5 Fig. 10's distribution is "many with <10 but some >1000", and a mean would move when a
// batch of trivial repos is added without real exposure changing. `densityView` below reads
// exactly those three fields and nothing this page draws sums or averages a density.
//
// OWNERSHIP ATTRIBUTION IS PROMISED BY THE STUB AND NOT IN THIS PAYLOAD, and that is a
// finding rather than an oversight to paper over. `owner_project` is captured on every
// ledger row (ledgerTypes.ts) and reaches the per-register CONCENTRATION dimension
// (readModels.ts's `CONCENTRATION_DIMS`), but `assetProfile()` — the function that builds
// THIS payload — never reads it: the 17 published `AssetProfileRow` columns
// (test/assets.test.ts's `OUTPUT_COLUMNS_ASSET_PROFILE`) have no ownership field, and
// `buildRepos` in readModels.ts calls only `assetProfilePopulations` and `signalCoverage`.
// So `ownershipView` below states the gap rather than inventing an unowned count — CLAUDE.md
// is explicit that a fabricated number is worse than an honest absence, and "a zero has to
// prove it looked" applies just as hard to a percentage nobody computed.

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { pagedTable } from "./sca.js";
import {
  absentText, boundedDays, chartTable, chartTableModel, clear, days1, denomNote, el,
  emptyState, errorState, figureCard, firstRunNotice, fmtCount, meter, num, onPageTeardown,
  pageHeader, pct1, sectionLabel, skeletonStack, uiIcon,
} from "../ui.js";
// `verdictMark` is `pages/program.js`'s own dot-and-word for a capacity verdict, promoted to
// `ui/verdict.js` in this same wave so this page's Capacity column can draw the identical
// mark rather than the plain word `VERDICT_LABEL[r.verdict]` printed alone — see that
// module's header for the DOM and the tone mapping.
import { verdictMark } from "../ui/verdict.js";

const OVERALL = "OVERALL";

// ---------------------------------------------------------------------------- formatting
//
// `num`, `fmtCount`, `pct1`, `days1`, `denomNote` and `boundedDays` used to be DEFINED here
// — this file had the corrected refuse-before-cast shape (the bug `test/pagesData.test.js`
// caught was fixed in place, not left as a second copy of `sca.js`'s wrong one), which is why
// `ui/figures.js` (the one shared implementation every page in this package now imports)
// matches this file's shape. See that module's header for the defect it replaces.
//
// `boundedDays` was the last of them to move, and it moved because it existed TWICE — here
// and in `sca.js` — spelling the same lower bound two ways.

// Re-exported because `test/pagesData.test.js` — which this package may not edit — still
// imports `boundedDays` from here by name, the same reason `sca.js` re-exports `pct1`.
export { boundedDays };

// ------------------------------------------------------------------------- pure view models

/** The `OVERALL` row of an `AssetProfileResult`, or null if the result is empty/absent. */
export function overallRow(result) {
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  return rows.find((r) => r.asset_group === OVERALL) || null;
}

/** Every group row except `OVERALL` — the per-repo or per-language breakdown. */
export function groupRows(result) {
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  return rows.filter((r) => r.asset_group !== OVERALL);
}

/**
 * The register-wide density read: p25/p50/p75, over how many repositories, and how many
 * open findings that spans. NEVER a mean — see the module header.
 */
export function densityView(result) {
  const row = overallRow(result);
  return {
    measured: !!row,
    p25: row ? num(row.density_p25) : null,
    p50: row ? num(row.density_p50) : null,
    p75: row ? num(row.density_p75) : null,
    assets: row ? num(row.assets, 0) : 0,
    openFindings: row ? num(row.open_findings, 0) : 0,
  };
}

/**
 * The PAGE's own first-run decision — not `densityView().measured`.
 *
 * `assetProfile()` (src/domain/assets.ts) always pushes an OVERALL row, even a zeroed one, so
 * `overallRow(result)` finds one and `measured` reads true on a ledger nobody has ever synced.
 * That is the right answer for `densityView` itself (a row exists to read, however empty), and
 * the wrong one for deciding whether to show this reader a page of "—" over four more empty
 * section boxes — CLAUDE.md: "An unmeasured register is not a register of zeroes… Every page
 * checks 'has this ever been scanned' before it checks 'how many'."
 *
 * So this page checks `assets` instead: a register that has been profiled has profiled AT
 * LEAST ONE repository. `d.assets` is already `num(row.assets, 0)` — a plain finite number,
 * never null/NaN — but the refusal is spelled out explicitly rather than trusted implicitly,
 * the same "refuse before any cast" shape `usableDate` (gas_shared/ui/feedback.js) applies to
 * a date, applied here to a count.
 *
 * A PROJECT-SCOPE FILTER MATCHING ZERO REPOSITORIES ON A SYNCED LEDGER LANDS ON THIS SAME
 * NOTICE, and that is not a misreading: `firstRunNotice({synced:true, at})` words that case as
 * "the last sync saved no findings, so there is nothing here to measure yet" — which is
 * exactly true of a scoped population that happens to be empty, the same measured-empty-vs-
 * never-measured split `renderGroupTable` below already draws for its own per-group rows.
 */
export function reposFirstRun(d) {
  const assets = d && d.assets;
  return !(typeof assets === "number" && Number.isFinite(assets) && assets > 0);
}

/** v5 Fig. 11: the share of repositories carrying at least one open high-risk finding. */
export function footholdView(result) {
  const row = overallRow(result);
  return {
    measured: !!row,
    pct: row ? num(row.assets_with_high_risk_pct) : null,
    assets: row ? num(row.assets, 0) : 0,
  };
}

/** v5 Fig. 15: the Kaplan–Meier half-life of a finding, at OVERALL or one group's grain. */
export function halfLifeView(row) {
  if (!row) return { measured: false, ...boundedDays(null, null) };
  return { measured: true, ...boundedDays(row.km_median_days, row.km_median_lower_bound) };
}

/**
 * v5 Fig. 21: falling-behind / keeping-up / gaining, over the repositories with a defined
 * net flow — null across the board without an observation window (`window_months === null`,
 * i.e. `observedFrom` was never recorded), never a fabricated 0/0/0 split.
 */
export function capacityView(result) {
  const row = overallRow(result);
  return {
    measured: !!row && row.window_months !== null,
    windowMonths: row ? num(row.window_months) : null,
    fallingBehindPct: row ? num(row.falling_behind_pct) : null,
    maintainingPct: row ? num(row.maintaining_pct) : null,
    gainingPct: row ? num(row.gaining_pct) : null,
    flowing: row ? num(row.assets_flowing, 0) : 0,
    assets: row ? num(row.assets, 0) : 0,
  };
}

/**
 * Ownership attribution — ABSENT FROM THIS PAYLOAD, stated rather than papered over.
 *
 * `owner_project` never reaches `assetProfile()`'s output columns (see the module header),
 * so there is no owned/unowned split to render. `available: false` is the whole answer;
 * `reason` is reader prose for `renderOwnership` below — an absence stated in the register's
 * own vocabulary rather than the trace a developer would want, which is this comment instead:
 * `owner_project` is written to every ledger row and reaches the per-register concentration
 * tables, but `assetProfile()` (src/domain/assets.ts) — the function that builds THIS page's
 * data — does not read it. None of `AssetProfileRow`'s 17 published columns names an owner.
 */
export function ownershipView() {
  return {
    available: false,
    unownedCount: null,
    reason: "Every finding is captured with the project that owns it, but that field does not "
      + "reach this page's data — so there is no owned/unowned split to show here without "
      + "inventing one.",
  };
}

/** One row of the per-repo / per-language table, formatted for `pagedTable`'s columns. */
export function tableRow(row) {
  const foothold = num(row.assets_with_high_risk_pct);
  return {
    key: row.asset_group,
    label: row.asset_label || row.asset_group,
    assets: num(row.assets, 0),
    openFindings: num(row.open_findings, 0),
    densityP50: num(row.density_p50),
    footholdPct: foothold,
    footholdText: foothold === null ? absentText : (foothold >= 100 ? "Yes" : foothold <= 0 ? "No" : pct1(foothold)),
    coverageP50: num(row.asset_coverage_p50),
    halfLife: halfLifeView(row),
    verdict: capacityVerdict(row),
  };
}

/**
 * Which glyph and word the Foothold cell draws, from `tableRow`'s own already-pinned
 * Yes/No/percentage/absent text — the decision that can be wrong, kept separate from the
 * `<span>` around it so it can be tested without a DOM.
 *
 * ONLY THE TWO ENDS GET A GLYPH. `tableRow.footholdText` is "Yes" at 100%, "No" at 0%, a
 * plain percentage in between (a language grouping several repositories, most of which will
 * never land on an exact 0 or 100), and `absentText` when nothing was measured — a percentage
 * is not a verdict, so it stays plain text rather than borrowing a glyph that would claim one.
 */
export function footholdCellKind(footholdText) {
  if (footholdText === "Yes") return "yes";
  if (footholdText === "No") return "no";
  if (footholdText === absentText) return "absent";
  return "value";
}

/**
 * The percentage a repository/language's coverage meter may be filled to — or NULL, which
 * draws no meter. Mirrors `pages/program.js`'s `signalMeterPct`: the refusal happens on the
 * value `tableRow` already read through `num()` (refuse-before-cast), never on a second,
 * confident `Number(...)` taken at render time — `meter(Number(row.coverageP50))` would draw
 * an empty 0% track beside an unmeasured cell, which is a picture asserting a coverage of zero
 * where nothing was measured at all.
 *
 * @param {{coverageP50?: number|null}|null|undefined} row  a `tableRow` result
 * @returns {number|null}
 */
export function coverageMeterPct(row) {
  const pct = row && row.coverageP50;
  return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
}

/**
 * Which of falling-behind / keeping-up / gaining a group's net flow lands in, read off the
 * three published shares rather than re-deriving the band — a group with no defined flow
 * (no window, or nothing to compare) verdicts null rather than a guessed "keeping up".
 */
export function capacityVerdict(row) {
  const falling = num(row.falling_behind_pct);
  const maintaining = num(row.maintaining_pct);
  const gaining = num(row.gaining_pct);
  if (falling === null && maintaining === null && gaining === null) return null;
  if (falling >= maintaining && falling >= gaining && falling > 0) return "falling-behind";
  if (gaining >= maintaining && gaining > 0) return "gaining";
  if (maintaining > 0) return "keeping-up";
  return null;
}

const VERDICT_LABEL = {
  "falling-behind": "Falling behind",
  "keeping-up": "Keeping up",
  gaining: "Gaining",
};

// ----------------------------------------------------------------------------- the page

export async function renderRepos(host, _params, _ctx) {
  const boot = await bootstrap();
  host.append(pageHeader({
    route: "repos",
    lede: "Where the backlog sits, which repositories offer a foothold, and who owns them.",
  }));

  const densityHost = el("div", { class: "kpi-row" });
  const ownershipHost = el("div", {});
  const repoHost = el("div", {});
  const langHost = el("div", {});
  const chartsHost = el("div", { class: "chart-row" });
  // ONE WRAPPER FOR EVERY SECTION BELOW THE DENSITY CARDS, so a first run can clear four
  // headings and their content together in one call — the same "label lives with its box"
  // shape history.js's own `sectionsHost`/`ensureSections()` use, for the same reason: these
  // headings are static text appended once rather than something a renderX function draws.
  const sectionsHost = el("div", {});

  function ensureSections() {
    if (sectionsHost.childNodes.length) return;
    sectionsHost.append(
      sectionLabel("Ownership attribution"),
      ownershipHost,
      sectionLabel("By repository"),
      repoHost,
      sectionLabel("By language"),
      langHost,
      sectionLabel("Half-life"),
      chartsHost,
    );
  }

  host.append(densityHost, sectionsHost);

  densityHost.append(skeletonStack(3, { variant: "stat" }));

  let paint = null;
  const promise = swrCall("api_getReposPage", {}, (fresh) => paint && paint(fresh));

  paint = (model) => {
    const result = model && model.byRepo && model.byRepo.all;
    const d = densityView(result);
    const first = reposFirstRun(d);
    renderDensity(model, d, first);
    // FIRST RUN STOPS HERE — one notice above (in `densityHost`), not four more section
    // headings each over their own empty box. Clearing `sectionsHost` detaches its four
    // headings AND the four content hosts nested inside it in one call; `ensureSections()`
    // re-attaches them the next time this runs non-first (see history.js for the identical
    // shape).
    if (first) {
      [ownershipHost, repoHost, langHost, chartsHost, sectionsHost].forEach(clear);
      return;
    }
    ensureSections();
    renderOwnership();
    renderGroupTable(repoHost, model && model.byRepo && model.byRepo.all, "repository", "repositories");
    renderGroupTable(langHost, model && model.byLanguage && model.byLanguage.all, "language", "languages");
    renderHalfLifeChart(model);
  };

  try {
    paint(await promise);
  } catch (e) {
    console.error("[repos] api_getReposPage failed:", e);
    // errorState, like `renderOwnership` below already uses — this one call site was the
    // page's last "failure dressed as an absence", and it sat two functions above a correct
    // use of the right component.
    clear(densityHost).append(errorState(
      "Couldn't load the repository profile.",
      { detail: String((e && e.message) || e) },
    ));
  }

  function renderDensity(model, d, first) {
    const result = model && model.byRepo && model.byRepo.all;
    const f = footholdView(result);
    clear(densityHost);
    if (first) {
      densityHost.append(firstRunNotice({
        synced: !!boot.latestSync,
        at: boot.latestSync ? boot.latestSync.ts : null,
        hint: "The repository profile appears once a sync has saved findings.",
      }));
      return;
    }
    // FIGURE CARDS, NOW — R3's ladder. The numbers a reader compares (p25/p75, the repository
    // count) stay on the surface as the card's `sub`; the "never a mean" method clause moves
    // to the label's own tip, and the full sentence still lands on `data-denominator` so a
    // test reads what a reader reads (see `test/pagesLit.test.js` gate 3/7).
    const densityCard = figureCard({
      label: "Median findings per repository",
      value: fmtCount(d.p50),
      sub: `p25 ${fmtCount(d.p25)} · p75 ${fmtCount(d.p75)} across ${fmtCount(d.assets)} repositories`,
      denominator:
        `p25 ${fmtCount(d.p25)} · p75 ${fmtCount(d.p75)}, across ${fmtCount(d.assets)} repositories `
        + `(${fmtCount(d.openFindings)} open findings). Never a mean — the distribution is long-tailed.`,
    });
    const footholdCard = figureCard({
      label: "Foothold rate",
      value: f.pct === null ? absentText : pct1(f.pct),
      sub: f.assets ? `Of ${fmtCount(f.assets)} repositories` : "No repositories measured",
      help: { term: "foothold" },
      denominator: f.assets ? `Of ${fmtCount(f.assets)} repositories.` : "No repositories measured.",
    });
    densityHost.append(densityCard, footholdCard);
  }

  function renderOwnership() {
    const view = ownershipView();
    clear(ownershipHost);
    // A permanent, known data gap is an ABSENCE, not a failure — this section renders correctly
    // every single time it runs, it simply has nothing to show. `errorState`'s role="alert" red
    // box used to draw here on every visit, which told a reader the page was broken rather than
    // that ownership is a real, stated gap in what this page's data carries.
    ownershipHost.append(emptyState(
      "Ownership is not measured on this page.",
      view.reason,
      { variant: "notice" },
    ));
  }

  function renderGroupTable(target, result, singular, plural) {
    const rows = groupRows(result).map(tableRow).sort((a, b) => b.openFindings - a.openFindings);
    clear(target);
    if (!rows.length) {
      target.append(emptyState(
        `No ${plural} measured yet.`,
        `It appears once a sync has saved a finding against at least one ${singular}.`,
      ));
      return;
    }
    const isRepo = singular === "repository";
    const columns = [
      { key: "label", label: isRepo ? "Repository" : "Language", cell: (r) => r.label },
    ];
    if (!isRepo) {
      columns.push({ key: "assets", label: "Repos", className: "num", cell: (r) => fmtCount(r.assets) });
    }
    columns.push(
      { key: "open", label: "Open findings", className: "num", cell: (r) => fmtCount(r.openFindings) },
      {
        key: "foothold", label: "Foothold", className: "num", help: { term: "foothold" },
        // A verdict at the two ends (Yes/No) draws a glyph AND the word — colour never
        // carries it alone, per R5. A percentage in between (a language spanning several
        // repositories) is not a verdict and stays plain text; absent stays this app's one
        // absence mark. `footholdCellKind` is the pure decision this reads.
        cell: (r) => {
          const kind = footholdCellKind(r.footholdText);
          if (kind === "yes") {
            return el("span", { class: "cell-verdict cell-verdict--ok" }, uiIcon("check", 14), "Yes");
          }
          if (kind === "no") {
            return el("span", { class: "cell-verdict cell-verdict--muted" }, uiIcon("not", 14), "No");
          }
          return r.footholdText;
        },
      },
      {
        key: "coverage", label: "Coverage (p50)", className: "num", help: { term: "coverage" },
        // The percentage plus a picture of it, `decorative` because the figure is already in
        // words right beside it (`.rate-with-meter` — the same recipe MTTR & SLA's rate cells
        // use). `coverageMeterPct` refuses null BEFORE any cast, so an unmeasured cell draws
        // no meter rather than an empty one asserting a coverage of zero.
        cell: (r) => {
          const pct = coverageMeterPct(r);
          if (pct === null) return absentText;
          return el("span", { class: "rate-with-meter" },
            pct1(r.coverageP50),
            meter(pct, { className: "meter--stat", decorative: true }));
        },
      },
      {
        key: "halfLife", label: "Half-life", className: "num", help: { term: "half-life" },
        cell: (r) => r.halfLife.text,
      },
      {
        key: "capacity", label: "Capacity", className: "num", help: { term: "capacity" },
        cell: (r) => verdictMark(r.verdict, r.verdict ? VERDICT_LABEL[r.verdict] : absentText),
      },
    );
    // PAGED, like every other unbounded table in this app. `rows` is one row per repository
    // (or per language) and the estate is not small: the whole list was rendered at once
    // here, so a reader met several hundred rows with no footer, no page size and nothing
    // saying how many there were beyond the count line below. `pagedTable` (sca.js) sorts
    // and pages client-side, which is right for a list the page already holds in full —
    // unlike the per-finding register, which is server-paged because it is 18,800 rows.
    //
    // THE SORT IS THE ONE THIS TABLE ALREADY HAD: most open findings first, tie-broken on
    // the group key so equal counts do not reshuffle between paints. `rows` arrives sorted
    // that way and `sortRows` re-states it rather than changing it.
    target.append(pagedTable({
      columns,
      rows,
      sortSpec: { value: (r) => r.openFindings, descending: true, tiebreak: (r) => r.key },
      emptyText: `No ${plural} measured yet.`,
    }));
    // "MEASURED", NOT "SHOWN", NOW THAT THE TABLE PAGES. The count is the whole set this
    // page holds; the pager above it states which slice of that set is on screen. Leaving
    // the old word would have the two lines disagree — "312 repositories shown" directly
    // under a footer reading 1-25 of 312.
    target.append(denomNote(`${fmtCount(rows.length)} ${rows.length === 1 ? singular : plural} measured.`));
  }

  function renderHalfLifeChart(model) {
    const rows = groupRows(model && model.byRepo && model.byRepo.all)
      .filter((r) => r.km_median_days !== null || r.km_median_lower_bound !== null)
      .sort((a, b) => (b.km_median_days ?? b.km_median_lower_bound ?? 0) - (a.km_median_days ?? a.km_median_lower_bound ?? 0))
      .slice(0, 15);
    clear(chartsHost);
    if (!rows.length) {
      chartsHost.append(emptyState(
        "Not enough resolved findings yet to chart a per-repository half-life.",
        "It appears once at least one finding in a repository has resolved.",
      ));
      return;
    }
    const canvas = el("canvas");
    // ONE array, built here and handed to both the wrapper and the table below it. `bounded`
    // is carried alongside because the plotted y is a MEDIAN for some repositories and a
    // LOWER BOUND for others — the canvas draws one line either way and cannot say which,
    // and CLAUDE.md's rule is that where the curve never reaches half we publish the bound
    // rather than a number pretending to be the median.
    const points = rows.map((r) => ({
      x: r.asset_label || r.asset_group,
      y: r.km_median_days !== null ? r.km_median_days : r.km_median_lower_bound,
      bounded: r.km_median_days === null,
    }));
    chartsHost.append(el("div", { class: "chart-card" },
      el("h3", { class: "section-label" }, "Slowest-clearing repositories"),
      el("div", { class: "chart-box" }, canvas),
      chartTable({
        canvas,
        caption: "The plotted repositories and their half-life in days. \"at least\" marks a"
          + " repository whose curve never fell to half — that figure is a lower bound, not a"
          + " median.",
        model: chartTableModel({
          columns: [
            { key: "x", label: "Repository", format: "text" },
            { key: "y", label: "Half-life", format: "days" },
            {
              key: "bounded",
              label: "Reading",
              format: "text",
              align: "text",
              value: (p) => (p.bounded ? "at least" : "median"),
            },
          ],
          rows: points,
        }),
      })));
    loadCharts()
      .then((api) => {
        api.trendLine(canvas, points, { yLabel: "days" });
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
