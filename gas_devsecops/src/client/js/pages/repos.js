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

import { swrCall } from "../store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  boundedDays, chartTable, chartTableModel, clear, dataTable, days1, denomNote, el, emptyState,
  errorState, fmtCount, glossaryTip, heroStat, kpiCard, num, onPageTeardown, pageHeader, pct1,
  sectionLabel, skeletonStack,
} from "../ui.js";

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
 * `reason` is what a reader — or this file's own report — needs to file it as a real gap
 * rather than a rendering bug.
 */
export function ownershipView() {
  return {
    available: false,
    unownedCount: null,
    reason: "Ownership is not in reposModel's payload. owner_project is written to every "
      + "ledger row and reaches the per-register concentration tables, but assetProfile() "
      + "(src/domain/assets.ts) — the function that builds this page's data — does not read "
      + "it: none of AssetProfileRow's 17 published columns names an owner. So this section "
      + "cannot show a coverage percentage or an unowned count without inventing one.",
  };
}

/** One row of the per-repo / per-language table, formatted for `dataTable`. */
export function tableRow(row) {
  const foothold = num(row.assets_with_high_risk_pct);
  return {
    key: row.asset_group,
    label: row.asset_label || row.asset_group,
    assets: num(row.assets, 0),
    openFindings: num(row.open_findings, 0),
    densityP50: num(row.density_p50),
    footholdPct: foothold,
    footholdText: foothold === null ? "—" : (foothold >= 100 ? "Yes" : foothold <= 0 ? "No" : pct1(foothold)),
    coverageP50: num(row.asset_coverage_p50),
    halfLife: halfLifeView(row),
    verdict: capacityVerdict(row),
  };
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
  host.append(pageHeader({
    hero: heroStat(
      "Data",
      "Repositories",
      "Where the backlog sits, which repositories offer a foothold, and who owns them.",
    ),
  }));

  const densityHost = el("div", { class: "kpi-row" });
  const ownershipHost = el("div", {});
  const repoHost = el("div", {});
  const langHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid" });

  host.append(
    densityHost,
    sectionLabel("Ownership attribution"),
    ownershipHost,
    sectionLabel("By repository"),
    repoHost,
    sectionLabel("By language"),
    langHost,
    sectionLabel("Half-life"),
    chartsHost,
  );

  densityHost.append(skeletonStack(3, { variant: "stat" }));

  let paint = null;
  const promise = swrCall("api_getReposPage", {}, (fresh) => paint && paint(fresh));

  paint = (model) => {
    renderDensity(model);
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

  function renderDensity(model) {
    const result = model && model.byRepo && model.byRepo.all;
    const d = densityView(result);
    const f = footholdView(result);
    clear(densityHost);
    if (!d.measured) {
      densityHost.append(emptyState("No repository profile yet.", "It appears once a sync has saved findings."));
      return;
    }
    const densityCard = kpiCard("Median findings per repository", fmtCount(d.p50), "");
    densityCard.append(denomNote(
      `p25 ${fmtCount(d.p25)} · p75 ${fmtCount(d.p75)}, across ${d.assets.toLocaleString()} repositories `
      + `(${d.openFindings.toLocaleString()} open findings). Never a mean — the distribution is long-tailed.`,
    ));
    const footholdCard = kpiCard(
      glossaryTip("Foothold rate", "foothold"),
      f.pct === null ? "—" : pct1(f.pct),
      "",
    );
    footholdCard.append(denomNote(
      f.assets ? `Of ${f.assets.toLocaleString()} repositories.` : "No repositories measured.",
    ));
    densityHost.append(densityCard, footholdCard);
  }

  function renderOwnership() {
    const view = ownershipView();
    clear(ownershipHost);
    if (!view.available) {
      ownershipHost.append(errorState(
        "Ownership coverage is not available from this page's data.",
        { detail: view.reason },
      ));
      return;
    }
    // Unreachable today (ownershipView() always reports unavailable) — kept so a future
    // package that wires owner_project into assetProfile() has a rendering path to fill in
    // rather than a page that has to be rebuilt from scratch.
    ownershipHost.append(emptyState(`${view.unownedCount} unowned`));
  }

  function renderGroupTable(target, result, singular, plural) {
    const rows = groupRows(result).map(tableRow).sort((a, b) => b.openFindings - a.openFindings);
    clear(target);
    if (!rows.length) {
      target.append(emptyState(`No ${plural} measured yet.`));
      return;
    }
    const isRepo = singular === "repository";
    const columns = [
      { key: "label", label: isRepo ? "Repository" : "Language", cell: (r) => r.label },
    ];
    if (!isRepo) {
      columns.push({ key: "assets", label: "Repos", className: "num", cell: (r) => r.assets.toLocaleString() });
    }
    columns.push(
      { key: "open", label: "Open findings", className: "num", cell: (r) => r.openFindings.toLocaleString() },
      {
        key: "foothold", label: "Foothold", className: "num", help: { term: "foothold" },
        cell: (r) => r.footholdText,
      },
      {
        key: "coverage", label: "Coverage (p50)", className: "num", help: { term: "coverage" },
        cell: (r) => pct1(r.coverageP50),
      },
      {
        key: "halfLife", label: "Half-life", className: "num", help: { term: "half-life" },
        cell: (r) => r.halfLife.text,
      },
      {
        key: "capacity", label: "Capacity", className: "num", help: { term: "capacity" },
        cell: (r) => (r.verdict ? VERDICT_LABEL[r.verdict] : "—"),
      },
    );
    target.append(dataTable({ columns, rows, emptyText: `No ${plural} measured yet.` }));
    target.append(denomNote(`${rows.length.toLocaleString()} ${rows.length === 1 ? singular : plural} shown.`));
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
