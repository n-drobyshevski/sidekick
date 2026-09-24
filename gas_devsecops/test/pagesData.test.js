// The three Data-lane pages (repos, history, data) — the C5 package.
//
// NO BOOTED DOM. This project runs no jsdom (vitest.config.ts sets no `environment`), so
// every page file is split into a pure view-model half (imported and exercised directly
// here) and a thin DOM half that is only ever invoked from `renderRepos`/`renderHistory`/
// `renderData` at runtime. This file tests the pure half directly and reads the DOM half as
// TEXT — the same split `test/shared.test.js` and `test/charts.test.js` already use in
// this repo.
//
// THE ASSERTION THAT MATTERS MOST ON THE HISTORY PAGE: a `null` `severities` on a scan row
// means the severity gate was OFF and the scan covered EVERY severity — it is exactly what a
// secrets scan writes, because `DEFAULT_FETCH_SEVERITIES.secrets = []`. Reading that null as
// "no severities requested" inverts the claim from "measured everything" to "measured
// nothing", which is the one mistake this suite is built to catch first.
//
// OWNERSHIP IS NO LONGER AN ABSENCE, and the describe that pinned the absence is gone with it.
// This suite used to assert that `ownershipView()` reported `available: false` with a reason
// — the honest-gap behaviour, because `assetProfile()` never read `owner_project` and there
// was no owned/unowned split anywhere in `api_getReposPage`'s reply. That is still true of
// `assetProfile()`; what changed is that the payload now carries a SECOND family beside it,
// `model.coldZone` (src/domain/coldZone.ts), built from the ledger rows where ownership has
// always been. Its `teams` array is one row per PRODUCT — with the CS/CE/LU support group
// above it carried as a column — and has a real "(no product)" bucket,
// so the question the old test pinned as unanswerable is answered, and the describes below
// pin the new claims instead. The rule the deleted test encoded has not moved: an absence is
// still an absence and is still drawn with `emptyState`, which is what the source-as-text case
// at the end of the cold-zone block checks.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  boundedDays, capacityVerdict, capacityView, coldestShareNote, coldKpiCards, coldModeCaption,
  coldCensusModel,
  coldRepoRows, coldScatterPoints, coldTeamRows, coldZoneView, coverageMeterPct, densityView,
  coldBandDefs, coldBandKeyModel,
  droppedNoRepoNote, scopesWithoutScanNote, unclassifiedSecretsNote,
  footholdCellKind, footholdView, groupRows, halfLifeView, overallRow,
  tableRow, unmeasurableNote, productCountNote, endOfLifeNote,
} from "../src/client/js/pages/repos.js";
import {
  groupBySync, isAllSeverities, kmMedianPoints, kpiView, openResolvedPoints, perScopeView,
  scanRowsView, scanScopeNoteShown, severitiesLabel,
} from "../src/client/js/pages/history.js";
import {
  cellsSummary, compactionView, confirmedAction, currentlyScoped, deletableScans, ledgerSummary,
  recentErrorsView, tabCellsView,
} from "../src/client/js/pages/data.js";

const REPOS_SRC = readFileSync(new URL("../src/client/js/pages/repos.js", import.meta.url), "utf8");
const HISTORY_SRC = readFileSync(new URL("../src/client/js/pages/history.js", import.meta.url), "utf8");
const DATA_SRC = readFileSync(new URL("../src/client/js/pages/data.js", import.meta.url), "utf8");

// =========================================================================================
//  Cross-page: no page is still the Phase-1 stub
// =========================================================================================

describe("none of the three pages is still the Phase-1 stub", () => {
  for (const [name, src] of [["repos.js", REPOS_SRC], ["history.js", HISTORY_SRC], ["data.js", DATA_SRC]]) {
    it(`${name} does not call renderStub or import _stub.js`, () => {
      expect(src).not.toMatch(/renderStub/);
      expect(src).not.toMatch(/_stub\.js/);
    });
  }
});

// =========================================================================================
//  repos.js
// =========================================================================================

const OVERALL_ROW = {
  asset_group: "OVERALL",
  assets: 40,
  open_findings: 310,
  density_p25: 1,
  density_p50: 4,
  density_p75: 12,
  assets_with_high_risk_pct: 27.5,
  assets_with_high_risk: 11,
  asset_coverage_p50: 62.5,
  km_median_days: 14.2,
  km_median_lower_bound: null,
  mmcr_p50: 8.1,
  falling_behind_pct: 20,
  maintaining_pct: 55,
  gaining_pct: 25,
  assets_flowing: 20,
  window_months: 6.5,
  population: "all",
  asset_label: null,
};

const REPO_A = {
  ...OVERALL_ROW, asset_group: "r1", asset_label: "repo-one", assets: 1, open_findings: 4,
  density_p25: 4, density_p50: 4, density_p75: 4, km_median_lower_bound: 30,
  km_median_days: null,
};
const RESULT = { rows: [OVERALL_ROW, REPO_A], population: "all", groupBy: "repo", windowMonths: 6.5, droppedNoAsset: 0, unclassifiedSecrets: 0 };

describe("repos: density is p25/p50/p75, never a mean", () => {
  it("densityView emits exactly the three percentiles and no mean field", () => {
    const v = densityView(RESULT);
    expect(v).toMatchObject({ p25: 1, p50: 4, p75: 12, assets: 40, openFindings: 310 });
    expect(v).not.toHaveProperty("mean");
    expect(v).not.toHaveProperty("average");
    expect(Object.keys(v).sort()).toEqual(["assets", "measured", "openFindings", "p25", "p50", "p75"].sort());
  });

  it("reads the OVERALL row, not an average constructed from the group rows", () => {
    // If this ever summed/averaged density across groups instead of reading OVERALL's own
    // published percentiles, p50 would drift from the OVERALL row's own 4.
    const v = densityView(RESULT);
    expect(v.p50).toBe(OVERALL_ROW.density_p50);
  });

  it("is honestly unmeasured (not zeroes) with no OVERALL row", () => {
    const v = densityView({ rows: [] });
    expect(v.measured).toBe(false);
    expect(v.p25).toBeNull();
    expect(v.p50).toBeNull();
    expect(v.p75).toBeNull();
  });
});

describe("repos: foothold, half-life and capacity read the published fields, not zeroes", () => {
  it("footholdView carries the percentage and its assets denominator", () => {
    expect(footholdView(RESULT)).toMatchObject({ measured: true, pct: 27.5, assets: 40 });
  });

  it("halfLifeView prints a plain median when one is observed", () => {
    expect(halfLifeView(OVERALL_ROW)).toMatchObject({ measured: true, text: "14.2 d", bounded: false });
  });

  // The claim: a bound and a median are DIFFERENT CLAIMS, and the view carries the difference
  // twice — in the string (prefixed) and in `bounded` (flagged), so nothing has to parse copy.
  // The glyph moved from ">" to the inclusive "≥" under the vocabulary rule in README.md (a
  // bound means "at least", which ">" denies); the claim above is untouched, and so is the rest
  // of this file.
  it("halfLifeView prints a LOWER BOUND, prefixed and flagged, when the curve never halves", () => {
    const v = halfLifeView(REPO_A);
    expect(v.bounded).toBe(true);
    expect(v.text).toBe("≥ 30.0 d");
  });

  it("boundedDays never collapses '> 30 d' into '30 d'", () => {
    expect(boundedDays(null, 30).text).not.toBe(boundedDays(30, null).text);
  });

  it("capacityView is null across the board without an observation window, not a fake 0/0/0", () => {
    const noWindow = { ...OVERALL_ROW, window_months: null, falling_behind_pct: null, maintaining_pct: null, gaining_pct: null };
    const v = capacityView({ rows: [noWindow] });
    expect(v.measured).toBe(false);
    expect(v.fallingBehindPct).toBeNull();
  });

  it("capacityVerdict names the band a single-asset group actually landed in", () => {
    expect(capacityVerdict({ falling_behind_pct: 100, maintaining_pct: 0, gaining_pct: 0 })).toBe("falling-behind");
    expect(capacityVerdict({ falling_behind_pct: 0, maintaining_pct: 100, gaining_pct: 0 })).toBe("keeping-up");
    expect(capacityVerdict({ falling_behind_pct: 0, maintaining_pct: 0, gaining_pct: 100 })).toBe("gaining");
    expect(capacityVerdict({ falling_behind_pct: null, maintaining_pct: null, gaining_pct: null })).toBeNull();
  });

  it("overallRow / groupRows split OVERALL from the per-group breakdown", () => {
    expect(overallRow(RESULT).asset_group).toBe("OVERALL");
    expect(groupRows(RESULT).map((r) => r.asset_group)).toEqual(["r1"]);
  });

  it("tableRow reads a foothold percentage as Yes/No only at the ends, a number between", () => {
    expect(tableRow({ ...REPO_A, assets_with_high_risk_pct: 100 }).footholdText).toBe("Yes");
    expect(tableRow({ ...REPO_A, assets_with_high_risk_pct: 0 }).footholdText).toBe("No");
    expect(tableRow({ ...REPO_A, assets_with_high_risk_pct: null }).footholdText).toBe("—");
  });

  it("tableRow carries the repository's lifecycle, and the absence mark where there is none", () => {
    expect(tableRow({ ...REPO_A, asset_lifecycle: "END_OF_LIFE" }).lifecycleText).toBe("END_OF_LIFE");
    // Null at every grain but the repository — `domain/assets.ts` refuses it for a product, so
    // this cell is only ever asked to print something real. Blank and missing read the same.
    for (const v of [null, undefined, "", "   "]) {
      expect(tableRow({ ...REPO_A, asset_lifecycle: v }).lifecycle).toBeNull();
      expect(tableRow({ ...REPO_A, asset_lifecycle: v }).lifecycleText).toBe("—");
    }
  });
});

// =========================================================================================
//  repos.js — the two decisions the Foothold/Coverage cells draw from (C2)
// =========================================================================================

describe("repos: footholdCellKind names the glyph a Yes/No verdict earns, and refuses one to a percentage", () => {
  it("Yes and No each get their own kind — a real verdict, drawn with a glyph and the word", () => {
    expect(footholdCellKind("Yes")).toBe("yes");
    expect(footholdCellKind("No")).toBe("no");
  });

  it("a percentage between the ends is not a verdict and draws no glyph", () => {
    expect(footholdCellKind("27.5%")).toBe("value");
  });

  it("the shared absence mark reads as absent, not as a fourth glyph", () => {
    expect(footholdCellKind("—")).toBe("absent");
  });

  // PERTURBATION (recorded, then reverted): folding "value" and "absent" into one fallback
  // branch (`return "value"` for anything not exactly "Yes"/"No") reads the shared dash as a
  // percentage — the render path would then hand `uiIcon`'s caller a bare "—" instead of the
  // muted `absent()` node, which is exactly the "a dash in the same ink as a measured value"
  // defect `ui/cells.js`'s own header names. Kept as three branches, not two, for that reason.
});

describe("repos: coverageMeterPct refuses null BEFORE any cast, so an unmeasured cell draws no meter", () => {
  it("passes a real, measured percentage through unchanged — including a real zero", () => {
    expect(coverageMeterPct({ coverageP50: 62.5 })).toBe(62.5);
    expect(coverageMeterPct({ coverageP50: 0 })).toBe(0);
  });

  it("a null coverage (never measured) returns null, not a confident 0", () => {
    expect(coverageMeterPct({ coverageP50: null })).toBeNull();
    expect(coverageMeterPct(null)).toBeNull();
    expect(coverageMeterPct(undefined)).toBeNull();
  });

  // PERTURBATION (recorded, then reverted): the tempting one-line rewrite —
  // `Number(row && row.coverageP50) || 0` — reads `coverageP50: null` as the finite `0`
  // (CLAUDE.md's own example of this exact cast) and would draw an empty 0% track beside a
  // cell that never measured anything, rather than the em dash `renderGroupTable` draws when
  // this returns null. `typeof pct === "number" && Number.isFinite(pct)` is the refusal that
  // stops it, checked BEFORE any arithmetic rather than cleaned up after.
});

// -----------------------------------------------------------------------------------------
//  repos.js — the cold zone
// -----------------------------------------------------------------------------------------
//
// THE PAYLOAD THESE READ is `model.coldZone`, a `ColdZoneResult` (src/domain/coldZone.ts).
// The fixtures below are hand-written rather than imported from the domain's own tests on
// purpose: what is being pinned here is how the PAGE behaves when handed a shape, including
// shapes the domain would never produce (a null `totals` under `measurable: true` — an older
// server answering a newer client), and a fixture generated by the producer cannot express
// those.

/** A `ColdRepoRow`-shaped fixture with the fields this page actually reads. */
function coldRepo(over = {}) {
  return {
    repo_id: "r1",
    repo_name: "repo-one",
    product: "platform",
    open_findings: 12,
    open_high_risk: 3,
    oldest_open_age_days: 210.5,
    last_movement_at: "2026-03-01T00:00:00.000Z",
    last_movement_kind: "resolved",
    idle_days: 151,
    idle_bound_days: null,
    idle_is_bound: false,
    idle_reading_days: 151,
    observed: true,
    last_observed_at: "2026-06-15T00:00:00.000Z",
    disappeared_at: null,
    disappeared_at_last_observation: 0,
    reopened_open: 0,
    verdict: "cold",
    cold: true,
    bucket: 3,
    ...over,
  };
}

/** A `ColdTeamRow`-shaped fixture, same bargain. */
function coldTeam(over = {}) {
  return {
    product: "platform",
    label: "platform",
    repos: 4,
    repos_observed: 4,
    repos_unobserved: 0,
    repos_with_open: 3,
    cold_repos: 1,
    watching_repos: 0,
    warm_repos: 2,
    clear_repos: 1,
    open_findings: 40,
    open_in_cold: 12,
    high_risk_in_cold: 3,
    open_in_unobserved: 0,
    cold_share_pct: (1 / 3) * 100,
    last_movement_at: "2026-05-02T00:00:00.000Z",
    verdict: "partly-cold",
    buckets: [1, 1, 0, 1, 0],
    bucket_open: [5, 9, 0, 12, 0],
    ...over,
  };
}

function coldTotals(over = {}) {
  return {
    repos: 10,
    repos_observed: 9,
    repos_unobserved: 1,
    // The one out-of-sight repository still carries backlog — the half worth the alarm.
    repos_unobserved_open: 1,
    repos_unobserved_clear: 0,
    repos_with_open: 6,
    cold_repos: 2,
    watching_repos: 1,
    warm_repos: 3,
    clear_repos: 3,
    open_findings: 100,
    open_in_cold: 24,
    high_risk_in_cold: 6,
    open_in_unobserved: 8,
    cold_repo_share_pct: (2 / 6) * 100,
    cold_backlog_share_pct: 24,
    teams: 2,
    teams_fully_cold: 0,
    teams_partly_cold: 1,
    repos_no_product: 1,
    buckets: [2, 1, 0, 2, 1],
    bucket_open: [10, 6, 0, 24, 4],
    ...over,
  };
}

function coldModel(over = {}) {
  return {
    coldZone: {
      measurable: true,
      cold_after_days: 90,
      observed_from: "2025-11-01T00:00:00.000Z",
      as_of: "2026-06-15T00:00:00.000Z",
      bucket_edges: [0, 30, 60, 90],
      bucket_labels: ["0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable"],
      repos: [coldRepo()],
      teams: [coldTeam()],
      totals: coldTotals(),
      row_count: 400,
      dropped_no_repo: 0,
      unclassified_secrets: 12,
      scopes_without_scan: [],
      ...over,
    },
  };
}

describe("repos: coldZoneView refuses a shape it cannot draw, rather than throwing inside a render", () => {
  it("a payload with no cold-zone block at all is absent, not measurable, and still safe to read", () => {
    for (const model of [null, undefined, {}, { coldZone: null }, { coldZone: [] }, []]) {
      const v = coldZoneView(model);
      expect(v.measurable, JSON.stringify(model)).toBe(false);
      // Every array is a REAL array whether or not anything was measured — a renderer that
      // reached for `.length` on a null would throw and be dressed as an error box.
      expect(Array.isArray(v.repos)).toBe(true);
      expect(Array.isArray(v.teams)).toBe(true);
      expect(v.totals).toBeNull();
      expect(v.populated).toBe(false);
    }
    expect(coldZoneView(null).present).toBe(false);
  });

  it("an unmeasurable block keeps its threshold and its counts but publishes no rows", () => {
    const v = coldZoneView({
      coldZone: {
        measurable: false, cold_after_days: 90, observed_from: null,
        as_of: "2026-06-15T00:00:00.000Z", bucket_edges: null, bucket_labels: null,
        repos: null, teams: null, totals: null,
        row_count: 400, dropped_no_repo: 2, unclassified_secrets: 12, scopes_without_scan: [],
      },
    });
    expect(v.present).toBe(true);
    expect(v.measurable).toBe(false);
    expect(v.coldAfterDays).toBe(90); // the setting is knowable even when the data is not
    expect(v.bucketLabels).toBeNull();
    expect(v.repos).toEqual([]);
    expect(v.totals).toBeNull();
    // The four coverage counts survive too — `coldZone.ts` computes them before the clock is
    // ever read, so they are real on a register that cannot measure anything else.
    expect(v.rowCount).toBe(400);
    expect(v.droppedNoRepo).toBe(2);
    expect(v.unclassifiedSecrets).toBe(12);
    expect(v.scopesWithoutScan).toEqual([]);
  });

  // THE PERTURBATION THIS EXISTS FOR: `measurable: true` over a null `totals`. A view that
  // trusted the flag would hand `coldKpiCards` a null and throw on the first field read,
  // which `renderRepos` has no guard for — the section would vanish behind a stack trace in
  // the console for what is, to a reader, an absence.
  it("trusts the shape over the flag: measurable:true with nothing behind it reads unmeasurable", () => {
    const v = coldZoneView({
      coldZone: { measurable: true, totals: null, repos: null, teams: null, cold_after_days: 90 },
    });
    expect(v.measurable).toBe(false);
    expect(coldKpiCards(v)).toEqual([]);
    expect(coldTeamRows(v)).toEqual([]);
    expect(coldRepoRows(v)).toEqual([]);
    expect(coldScatterPoints(v)).toEqual([]);
    // The band vocabulary and its control are empty too: an unmeasurable block has no labels
    // to derive them from, so the page draws no control rather than an empty one.
    expect(coldBandDefs(v)).toEqual([]);
    expect(coldBandKeyModel(v)).toEqual([]);
    expect(unmeasurableNote(v)).toBeNull();
  });

  it("a measured, populated block publishes the rows, the labels and the threshold", () => {
    const v = coldZoneView(coldModel());
    expect(v.measurable).toBe(true);
    expect(v.populated).toBe(true);
    expect(v.coldAfterDays).toBe(90);
    // FROM THE PAYLOAD. The heatmap header is never spelled on the page — it moves with the
    // operator's threshold, and a hardcoded "≥ 90 d" would be silently wrong at 120.
    expect(v.bucketLabels).toEqual(["0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable"]);
    expect(v.repos).toHaveLength(1);
    expect(v.teams).toHaveLength(1);
  });

  it("a measured register where nothing is open and nothing dropped out is NOT populated", () => {
    // Measurable and empty is a real state and not an error: there is a clock, and there is
    // nothing for it to measure. The page draws a notice for it, never a row of zeros.
    const v = coldZoneView(coldModel({
      repos: [], teams: [],
      totals: coldTotals({ repos_with_open: 0, repos_unobserved: 0, cold_repos: 0 }),
    }));
    expect(v.measurable).toBe(true);
    expect(v.populated).toBe(false);
  });
});

describe("repos: the cold-zone census is a real partition of the register", () => {
  // THE CLAIM THE WAFFLE MAKES is that five verdicts cover every repository exactly once —
  // coldZone.ts's verdict switch says `cold + warm + watching + clear` is every OBSERVED repo
  // and `observed + unobserved` is every repo. `unitChartModel` throws when segments sum past
  // the stated total, so the day a sixth verdict arrives this page fails loudly instead of
  // drawing a renormalised grid nobody would think to check.
  it("covers every repository, with nothing left over", () => {
    const m = coldCensusModel(coldZoneView(coldModel()));
    expect(m).toBeTruthy();
    expect(m.measured).toBe(true);
    expect(m.total).toBe(10);
    const counted = m.segments.reduce((a, s) => a + s.count, 0);
    expect(counted).toBe(10);
    // No remainder at all: a "not accounted for" wedge here would mean the verdicts had
    // stopped partitioning, which is the thing worth noticing.
    expect(m.remainder).toBeNull();
  });

  it("is exact at this size — one cell per repository, no rounding to explain", () => {
    const m = coldCensusModel(coldZoneView(coldModel()));
    expect(m.exact).toBe(true);
    expect(m.cells).toBe(10);
    expect(m.segments.map((s) => [s.key, s.cells])).toEqual([
      ["cold", 2], ["warm", 3], ["watching", 1], ["clear", 3],
      ["unobserved_open", 1], ["unobserved_clear", 0],
    ]);
    expect(m.rounded).toBe(false);
  });

  it("hatches the three states that are not measurements of idleness, and only those", () => {
    // `watching` is a repository with open findings whose idle time could not be measured at
    // all; both unobserved segments are ones the scanner has lost sight of. The section spends
    // most of its words insisting none is warm — --hatch is the design system's token for
    // that claim.
    const m = coldCensusModel(coldZoneView(coldModel()));
    const hatched = m.segments.filter((s) => s.fill === "hatch").map((s) => s.key);
    expect(hatched).toEqual(["watching", "unobserved_open", "unobserved_clear"]);
    expect(m.segments.find((s) => s.key === "clear").fill).toBe("ring");
    expect(m.segments.find((s) => s.key === "cold").fill).toBe("solid");
  });

  // THE SPLIT IS THE POINT, NOT A RENAME. Out of sight was one grey segment covering two
  // unrelated facts: a repository the scanner lost while backlog was still open on it, and one
  // that was remediated and then archived. The second accumulates forever on any register with
  // churn, so drawn as one they made a healthy register look like a coverage catastrophe.
  it("tells the two kinds of out-of-sight apart by tone as well as by word", () => {
    const m = coldCensusModel(coldZoneView(coldModel()));
    const seg = Object.fromEntries(m.segments.map((s) => [s.key, s]));
    expect(seg.unobserved_open.tone).toBe("bad");
    expect(seg.unobserved_clear.tone).toBe("neutral");
    expect(seg.unobserved_open.label).toContain("backlog open");
    expect(seg.unobserved_clear.label).toContain("nothing open");
    // The same tone as cold, told apart by silhouette: cold is measured, this is not.
    expect(seg.cold.tone).toBe("bad");
    expect(seg.cold.fill).toBe("solid");
  });

  it("every segment carries a word, so no cell means anything by its fill alone", () => {
    const m = coldCensusModel(coldZoneView(coldModel()));
    for (const s of m.segments) {
      expect(typeof s.label).toBe("string");
      expect(s.label.trim().length).toBeGreaterThan(0);
    }
    expect(m.aria).toContain("Of 10 repositories");
  });

  it("draws nothing where there is no register to count, rather than an empty lattice", () => {
    expect(coldCensusModel(coldZoneView(null))).toBeNull();
    expect(coldCensusModel(coldZoneView(coldModel({ totals: coldTotals({ repos: 0 }) })))).toBeNull();
    expect(coldCensusModel(null)).toBeNull();
  });

  it("switches to a proportional lattice once the register stops being countable", () => {
    // 400 repositories is not something a reader counts, and a 400-cell grid that looked
    // countable and was not would be worse than one that never claimed to be.
    const big = coldZoneView(coldModel({
      totals: coldTotals({
        repos: 400, repos_observed: 380, repos_unobserved: 20,
        cold_repos: 40, warm_repos: 120, watching_repos: 20, clear_repos: 200,
      }),
    }));
    const m = coldCensusModel(big);
    expect(m.exact).toBe(false);
    expect(m.cells).toBe(100);
    expect(m.segments.reduce((a, s) => a + s.cells, 0) + (m.remainder ? m.remainder.cells : 0))
      .toBe(100);
  });
});

describe("repos: the four cold-zone figures each carry their own denominator", () => {
  const cards = coldKpiCards(coldZoneView(coldModel()));

  it("publishes exactly the four figures, each with a denominator sentence", () => {
    expect(cards.map((c) => c.key))
      .toEqual(["coldRepos", "openInCold", "highRiskInCold", "unobserved"]);
    for (const card of cards) {
      expect(typeof card.denominator, card.key).toBe("string");
      expect(card.denominator.trim().length, card.key).toBeGreaterThan(0);
    }
  });

  it("names the threshold in prose — \"at least N days\", never \">\"", () => {
    const coldCard = cards[0];
    expect(coldCard.denominator).toMatch(/at least 90 days/);
    expect(coldCard.denominator).not.toMatch(/>/);
  });

  it("the backlog card prints its share of open findings, and the count it is a share of", () => {
    expect(cards[1].sub).toBe("24.0% of 100 open findings");
  });

  it("a null share prints no percentage rather than a 0.0%", () => {
    // `cold_backlog_share_pct` is null over an empty denominator — a register with no open
    // findings has no cold SHARE, and 0.0% would say the backlog is all warm.
    const v = coldZoneView(coldModel({
      totals: coldTotals({ cold_backlog_share_pct: null, cold_repo_share_pct: null }),
    }));
    const [repoCard, backlogCard] = coldKpiCards(v);
    expect(backlogCard.sub).toBe("Of 100 open findings");
    expect(backlogCard.sub).not.toMatch(/%/);
    expect(repoCard.denominator).not.toMatch(/%/);
  });
});

describe("repos: unmeasurableNote — the repositories no figure can speak for", () => {
  it("counts the watching repositories and says they are in neither figure", () => {
    const note = unmeasurableNote(coldZoneView(coldModel()));
    expect(note).toMatch(/1 repository has/);
    expect(note).toMatch(/neither the cold figure nor the warm one/);
  });

  it("is null — not a sentence about zero repositories — when there are none", () => {
    expect(unmeasurableNote(coldZoneView(coldModel({ totals: coldTotals({ watching_repos: 0 }) }))))
      .toBeNull();
    expect(unmeasurableNote(null)).toBeNull();
  });
});

describe("repos: scopesWithoutScanNote — the coverage warning, the most important of the four", () => {
  it("is null when every scope with rows also has a scan on record", () => {
    expect(scopesWithoutScanNote(coldZoneView(coldModel()))).toBeNull();
    expect(scopesWithoutScanNote(null)).toBeNull();
  });

  it("names the one scope in the register's long-form label, as a gap in OUR coverage", () => {
    const note = scopesWithoutScanNote(
      coldZoneView(coldModel({ scopes_without_scan: ["secrets"] })),
    );
    expect(note).toMatch(/^No scan is on record for Secrets,/);
    expect(note).toMatch(/that scope is/);
    expect(note).toMatch(/its repositories stay observed/);
    expect(note).toMatch(/gap in this register's scan coverage/);
    // The refusal is SPELLED OUT, never left implicit — `coldZone.ts`'s header: "we do not
    // accuse a team of vanishing on the strength of a missing scan row".
    expect(note).toMatch(/not a reading on the team\.$/);
  });

  it("lists more than one scope, and the verb and pronoun go plural", () => {
    const note = scopesWithoutScanNote(
      coldZoneView(coldModel({ scopes_without_scan: ["sca", "sast"] })),
    );
    expect(note).toMatch(/^No scan is on record for Dependencies \(SCA\), Code \(SAST\),/);
    expect(note).toMatch(/those scopes are/);
    expect(note).toMatch(/their repositories stay observed/);
  });
});

describe("repos: droppedNoRepoNote — rows outside every figure in this section", () => {
  it("is null when nothing was dropped", () => {
    expect(droppedNoRepoNote(coldZoneView(coldModel({ dropped_no_repo: 0 })))).toBeNull();
    expect(droppedNoRepoNote(null)).toBeNull();
  });

  it("is grammatical at one", () => {
    const note = droppedNoRepoNote(coldZoneView(coldModel({ dropped_no_repo: 1 })));
    expect(note).toBe(
      "1 row carries no repository and sits outside every figure in this section.",
    );
  });

  it("pluralises for more than one", () => {
    const note = droppedNoRepoNote(coldZoneView(coldModel({ dropped_no_repo: 5 })));
    expect(note).toBe(
      "5 rows carry no repository and sit outside every figure in this section.",
    );
  });
});

describe("repos: unclassifiedSecretsNote — secrets rows outside the high-risk figure", () => {
  it("is null when every secrets row was classified", () => {
    expect(unclassifiedSecretsNote(coldZoneView(coldModel({ unclassified_secrets: 0 }))))
      .toBeNull();
    expect(unclassifiedSecretsNote(null)).toBeNull();
  });

  it("is grammatical at one", () => {
    const note = unclassifiedSecretsNote(coldZoneView(coldModel({ unclassified_secrets: 1 })));
    expect(note).toBe(
      "1 secrets row carries no risk class, so it sits outside the high-risk figure.",
    );
  });

  it("pluralises for more than one — coldModel()'s own default", () => {
    const note = unclassifiedSecretsNote(coldZoneView(coldModel()));
    expect(note).toBe(
      "12 secrets rows carry no risk class, so they sit outside the high-risk figure.",
    );
  });
});


describe("repos: coldTeamRows — a share nobody could take draws no meter", () => {
  it("carries the product's figures and its verdict word", () => {
    const [row] = coldTeamRows(coldZoneView(coldModel()));
    expect(row.label).toBe("platform");
    expect(row.verdict).toBe("partly-cold");
    expect(row.verdictWord).toBe("Partly cold");
    expect(row.coldRepos).toBe(1);
    expect(row.openInCold).toBe(12);
    expect(row.highRiskInCold).toBe(3);
  });

  it("a null cold share is null on the row, so the cell draws the em dash and no track", () => {
    // `cold_share_pct` is null over an empty denominator (a product with no repository
    // carrying an open finding). `meter()` opens with `Number(value) || 0`, so a row that
    // passed the null through would draw a confident 0% track beside a cell that measured
    // nothing — the same defect `coverageMeterPct` above exists to refuse.
    const v = coldZoneView(coldModel({
      teams: [coldTeam({ cold_share_pct: null, repos_with_open: 0, cold_repos: 0, verdict: "clear" })],
    }));
    const [row] = coldTeamRows(v);
    expect(row.sharePct).toBeNull();
    expect(Number(row.sharePct) || 0).toBe(0); // what the cast-first version would have drawn
  });

  it("a measured zero share KEEPS its meter — the empty track is the measurement", () => {
    const v = coldZoneView(coldModel({ teams: [coldTeam({ cold_share_pct: 0, cold_repos: 0 })] }));
    expect(coldTeamRows(v)[0].sharePct).toBe(0);
  });

  it("the no-product bucket is a row like any other, labelled and never dropped", () => {
    const v = coldZoneView(coldModel({
      teams: [coldTeam({ product: null, label: "(no product)" }), coldTeam()],
    }));
    const rows = coldTeamRows(v);
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe("(no product)");
    expect(rows[0].key).toBe("(no product)");
  });

  // THE ESCALATION PATH, beside the grain that went cold. One support group holds many
  // products, so this column is the only way to read a cold product up to who answers for it
  // — the roll-up itself stays on products, because the verdicts and the coldest-share badge
  // are calibrated on that population.
  it("carries the support group a product escalates to", () => {
    const v = coldZoneView(coldModel({
      teams: [coldTeam({ support_group: "CE-TRANSPORT", support_groups: 1 })],
    }));
    expect(coldTeamRows(v)[0].supportGroup).toBe("CE-TRANSPORT");
    expect(coldTeamRows(v)[0].supportGroupText).toBe("CE-TRANSPORT");
  });

  it("prints the em dash where no single support group answers — BOTH reasons, one mark", () => {
    // Nobody named one, and several named different ones, look the same to a reader asking
    // who to escalate to; this column cannot tell them apart and does not pretend to. The
    // distinction survives in the payload's `support_groups` count.
    const none = coldZoneView(coldModel({
      teams: [coldTeam({ support_group: null, support_groups: 0 })],
    }));
    expect(coldTeamRows(none)[0].supportGroup).toBeNull();
    expect(coldTeamRows(none)[0].supportGroupText).toBe("—");

    const split = coldZoneView(coldModel({
      teams: [coldTeam({ support_group: null, support_groups: 2 })],
    }));
    expect(coldTeamRows(split)[0].supportGroupText).toBe("—");
  });

  it("a team that has never moved prints the em dash, never a date of zero", () => {
    const v = coldZoneView(coldModel({ teams: [coldTeam({ last_movement_at: null })] }));
    expect(coldTeamRows(v)[0].lastMovementText).toBe("—");
  });
});

describe("repos: coldRepoRows — the bound reads \"≥\", and never \">\"", () => {
  it("a measured idle time prints as a plain day figure", () => {
    const [row] = coldRepoRows(coldZoneView(coldModel()));
    expect(row.idleBounded).toBe(false);
    expect(row.idleText).toBe("151.0 d");
    expect(row.idleText).not.toMatch(/≥|>/);
  });

  it("a repository with no movement on record prints its LOWER BOUND, with \"≥\"", () => {
    // README.md above the Pages table: "at least N" in prose, "≥ N" in a cell, never ">" —
    // "at least" is inclusive and ">" is not. `boundedDays` (ui/figures.js) is the one
    // implementation; this pins that the page routes the bound through it rather than
    // spelling a second one.
    const v = coldZoneView(coldModel({
      repos: [coldRepo({
        idle_days: null, idle_bound_days: 226.5, idle_is_bound: true, idle_reading_days: 226.5,
        last_movement_at: null, last_movement_kind: null,
      })],
    }));
    const [row] = coldRepoRows(v);
    expect(row.idleBounded).toBe(true);
    expect(row.idleText).toBe("≥ 226.5 d");
    expect(row.idleText).not.toContain(">");
    expect(row.movementText).toBe("—"); // never a date of zero
  });

  it("lists the cold AND the unobserved, cold first, biggest backlog first inside each", () => {
    const v = coldZoneView(coldModel({
      repos: [
        coldRepo({ repo_id: "warm", repo_name: "warm-one", cold: false, verdict: "warm", bucket: 0 }),
        coldRepo({ repo_id: "gone", repo_name: "gone-one", cold: false, observed: false,
          verdict: "unobserved", bucket: null, open_findings: 99 }),
        coldRepo({ repo_id: "cold-small", repo_name: "cold-small", open_findings: 2 }),
        coldRepo({ repo_id: "cold-big", repo_name: "cold-big", open_findings: 40 }),
      ],
    }));
    // The unobserved repository has the biggest backlog of the three and is still last: its
    // idle time measures a scanner outage, not a team's silence, so it never outranks a cold
    // repository in a list about engagement.
    expect(coldRepoRows(v).map((r) => r.key)).toEqual(["cold-big", "cold-small", "gone"]);
  });

  it("carries the returned count beside a repository whose movement a reopen cleared", () => {
    // A reopen clears resolved_at/removed_at/rotated_at (reconcile.ts), so the repository
    // reads as never having moved. The count of findings that came back is what tells the
    // reader why, and the page prints it beside the absence.
    const v = coldZoneView(coldModel({
      repos: [coldRepo({ last_movement_at: null, last_movement_kind: null, reopened_open: 4 })],
    }));
    expect(coldRepoRows(v)[0].reopenedOpen).toBe(4);
  });

  it("a repository with no product recorded is filed under (no product), never blank", () => {
    const v = coldZoneView(coldModel({ repos: [coldRepo({ product: null })] }));
    expect(coldRepoRows(v)[0].product).toBe("(no product)");
  });
});

describe("repos: productCountNote — names the (no product) bucket only when it is in the table", () => {
  it("says nothing about a bucket the table does not hold", () => {
    const v = coldZoneView(coldModel({ totals: coldTotals({ repos_no_product: 0 }) }));
    expect(productCountNote(v, 4)).toBe("4 products.");
    expect(productCountNote(v, 4)).not.toMatch(/no product/);
  });

  it("names the bucket, with its size, when repositories have no product recorded", () => {
    const v = coldZoneView(coldModel({ totals: coldTotals({ repos_no_product: 2 }) }));
    expect(productCountNote(v, 3)).toBe(
      "3 products, including the 2 repositories with no product recorded, counted together as one.",
    );
    expect(productCountNote(v, 1)).toMatch(/^1 product,/);
  });
});

describe("repos: coldScatterPoints — observed repositories with a backlog, and nothing else", () => {
  it("plots a cold repository with its idle time, its backlog and its bound flag", () => {
    const [p] = coldScatterPoints(coldZoneView(coldModel()));
    expect(p).toEqual({
      label: "repo-one", idleDays: 151, open: 12, cold: true, bounded: false,
    });
  });

  it("drops the unobserved and the empty — neither is a point about engagement", () => {
    const v = coldZoneView(coldModel({
      repos: [
        coldRepo({ repo_id: "gone", observed: false, verdict: "unobserved", cold: false }),
        coldRepo({ repo_id: "clear", open_findings: 0, cold: false, verdict: "clear" }),
        coldRepo({ repo_id: "noclock", idle_days: null, idle_bound_days: null,
          idle_reading_days: null, idle_is_bound: true }),
        coldRepo({ repo_id: "keep" }),
      ],
    }));
    expect(coldScatterPoints(v).map((p) => p.label)).toEqual(["repo-one"]);
    expect(coldScatterPoints(v)).toHaveLength(1);
  });

  it("carries the bound flag for a repository whose idle time is a lower bound", () => {
    const v = coldZoneView(coldModel({
      repos: [coldRepo({ idle_days: null, idle_bound_days: 40, idle_reading_days: 40,
        idle_is_bound: true, cold: false, verdict: "watching" })],
    }));
    expect(coldScatterPoints(v)[0]).toMatchObject({ bounded: true, idleDays: 40, cold: false });
  });
});

describe("repos: the cold zone's absences are notices, never error boxes", () => {
  // SOURCE-AS-TEXT, the same shape the deleted ownership case used: this project runs no
  // jsdom, and the decision that can be wrong is which COMPONENT an absence reaches for.
  // `errorState` draws a red role="alert" box — right for an RPC that failed, wrong for a
  // register that has no scan yet, and the defect CLAUDE.md's audit named on this very page.
  const fn = REPOS_SRC.slice(REPOS_SRC.indexOf("function renderColdZone"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));

  it("the unmeasurable branch reaches emptyState with the notice variant", () => {
    expect(body).toMatch(/emptyState\(/);
    expect(body).toMatch(/variant: "notice"/);
    expect(body).toMatch(/The cold zone is not measured yet\./);
    expect(body).toMatch(/no scan\s*"?\s*\+?\s*"?\s*has been saved/);
  });

  it("reaches for errorState nowhere in the section", () => {
    expect(body).not.toMatch(/errorState\(/);
    // …and neither does any other block of the section: the whole family draws absences.
    const section = REPOS_SRC.slice(
      REPOS_SRC.indexOf("function renderColdZone"),
      REPOS_SRC.indexOf("function renderGroupTable"),
    );
    expect(section).not.toMatch(/errorState\(/);
  });

  it("the page still keeps errorState for the one thing that IS a failure — the RPC", () => {
    // Not a vacuous check: a page that simply deleted `errorState` would pass the two above.
    expect(REPOS_SRC).toMatch(/errorState\(\s*\n?\s*"Couldn't load the repository profile\./);
  });
});
// -----------------------------------------------------------------------------------------
//  repos.js — the cold zone drawn RELATIVE to the estate (phase 2)
// -----------------------------------------------------------------------------------------
//
// ONE LINE IN DAYS, TWO WAYS OF DRAWING IT. `cold_after_days` is the EFFECTIVE threshold in
// both modes (src/domain/coldZone.ts's header), so nothing below branches on the mode to read
// a NUMBER — every assertion here is about the SENTENCE that says where the number came from,
// which is the only thing on this page that a mode can change. The fixtures above are
// deliberately left as they were: a payload with no `mode` at all is an older server, and the
// first describe here is what pins that it reads as the fixed window rather than as a gap.

/** A relative-mode `ColdZoneResult`, carrying the phase-2 fields the fixtures above omit. */
function relativeModel(over = {}, totalsOver = {}) {
  return coldModel({
    mode: "relative",
    cold_after_days: 47, // the DERIVED line — what the estate produced, not what was set
    fixed_after_days: 90, // …and the operator's window, which survives the switch
    target_share_pct: 20,
    achieved_share_pct: (10 / 46) * 100,
    floor_days: 14,
    floor_applied: false,
    derived_days: 47,
    eligible_repos: 46,
    cold_bound_only: 0,
    totals: coldTotals({
      repos_with_open: 46, cold_repos: 10, teams_in_coldest_share: 0, ...totalsOver,
    }),
    ...over,
  });
}

/** The fixed-mode payload a phase-2 server sends: the same window, with the new fields said. */
function fixedModel(over = {}, totalsOver = {}) {
  return coldModel({
    mode: "fixed",
    cold_after_days: 90,
    fixed_after_days: 90,
    target_share_pct: null,
    achieved_share_pct: (3 / 46) * 100,
    floor_days: null,
    floor_applied: false,
    derived_days: null,
    eligible_repos: 46,
    cold_bound_only: 0,
    totals: coldTotals({
      repos_with_open: 46, cold_repos: 3, teams_in_coldest_share: 0, ...totalsOver,
    }),
    ...over,
  });
}

describe("repos: coldZoneView lifts the mode, and a payload that never heard of one is fixed", () => {
  it("an older payload with no mode block reads as the fixed window, not as a gap", () => {
    const v = coldZoneView(coldModel());
    expect(v.mode).toBe("fixed");
    expect(v.fixedAfterDays).toBeNull();
    expect(v.targetSharePct).toBeNull();
    expect(v.floorDays).toBeNull();
    expect(v.floorApplied).toBe(false);
    expect(v.derivedDays).toBeNull();
    expect(v.coldBoundOnly).toBeNull();
    // `eligible_repos === totals.repos_with_open` by construction, so the older payload can
    // still answer "a share of what" out of the totals it does carry.
    expect(v.eligibleRepos).toBe(6);
    // …and the achieved share falls back to the totals' own copy of the same number.
    expect(v.achievedSharePct).toBeCloseTo((2 / 6) * 100, 10);
    expect(v.teamsInColdestShare).toBe(0);
  });

  it("only the exact word is relative — anything else is the older contract", () => {
    for (const mode of ["RELATIVE", "Relative", " relative", "dynamic", 1, true, null, {}]) {
      expect(coldZoneView(coldModel({ mode })).mode, JSON.stringify(mode)).toBe("fixed");
    }
    expect(coldZoneView(coldModel({ mode: "relative" })).mode).toBe("relative");
  });

  it("a relative payload publishes the target, the floor and the line that was refused", () => {
    const v = coldZoneView(relativeModel({ floor_applied: true, derived_days: 9,
      cold_after_days: 14 }));
    expect(v.mode).toBe("relative");
    expect(v.coldAfterDays).toBe(14); // the EFFECTIVE line, which is the floor here
    expect(v.fixedAfterDays).toBe(90); // the setting, still published, and NOT what classified
    expect(v.targetSharePct).toBe(20);
    expect(v.floorDays).toBe(14);
    expect(v.floorApplied).toBe(true);
    expect(v.derivedDays).toBe(9);
    expect(v.eligibleRepos).toBe(46);
  });

  it("a NULL achieved share is kept, never quietly replaced by the totals' number", () => {
    // The field carrying null is a statement — "no repository has an open finding, so there is
    // no share" — and the fallback exists only for a payload that has no field at all.
    const v = coldZoneView(relativeModel({ achieved_share_pct: null }));
    expect(v.achievedSharePct).toBeNull();
  });

  it("the shape-over-flag refusal still holds over every one of the new fields", () => {
    const v = coldZoneView({
      coldZone: {
        measurable: true, totals: null, repos: null, teams: null, cold_after_days: 47,
        mode: "relative", target_share_pct: 20, floor_days: 14, derived_days: 47,
        eligible_repos: 46, cold_bound_only: 3,
      },
    });
    expect(v.measurable).toBe(false);
    // The mode and the operator's numbers survive — they are facts about the SETTING, which is
    // knowable even where the data is not — but nothing counted from rows does.
    expect(v.mode).toBe("relative");
    expect(v.targetSharePct).toBe(20);
    expect(v.teamsInColdestShare).toBe(0);
    expect(coldKpiCards(v)).toEqual([]);
    expect(coldestShareNote(v)).toBeNull();
    expect(typeof coldModeCaption(v)).toBe("string"); // a caption for every state, never a throw
  });

  it("every refusable input still yields a caption rather than an exception", () => {
    for (const model of [null, undefined, {}, { coldZone: null }, []]) {
      expect(typeof coldModeCaption(coldZoneView(model)), JSON.stringify(model)).toBe("string");
    }
    expect(typeof coldModeCaption(null)).toBe("string");
    expect(typeof coldModeCaption(undefined)).toBe("string");
  });
});

describe("repos: coldModeCaption — one sentence per state, in the copy the section was drawn with", () => {
  const caption = (model) => coldModeCaption(coldZoneView(model));

  const FIXED_LEAD = "Fixed window: a repository is cold after at least 90 days with nothing"
    + " resolved, removed or rotated.";
  const RELATIVE_LEAD = "Relative mode: the line is set so the idlest 20% of the 46"
    + " repositories with open findings are cold.";
  // `row_count` is folded into every branch as the trailing sentence — see `coldModeCaption`'s
  // header. `coldModel()` (and therefore `fixedModel`/`relativeModel`, which build on it) fixes
  // `row_count` at 400; the two explicit "not measurable" fixtures below set it to 0.
  const POP_400 = " Computed over 400 rows.";
  const POP_0 = " Computed over 0 rows.";

  it("fixed and populated: the window, then the share it drew", () => {
    expect(caption(fixedModel())).toBe(
      `${FIXED_LEAD} 3 of 46 repositories with open findings (6.5%) are cold.${POP_400}`,
    );
  });

  it("fixed and populated at n = 1: the verb agrees with a single cold repository", () => {
    expect(caption(fixedModel({ achieved_share_pct: (1 / 46) * 100 }, { cold_repos: 1 }))).toBe(
      `${FIXED_LEAD} 1 of 46 repositories with open findings (2.2%) is cold.${POP_400}`,
    );
  });

  it("fixed with nothing open: no share is reported, and no 0% is invented", () => {
    expect(caption(fixedModel(
      { eligible_repos: 0, achieved_share_pct: null },
      { repos_with_open: 0, cold_repos: 0 },
    ))).toBe(
      `${FIXED_LEAD} No repository has an open finding, so there is no share to report.${POP_400}`,
    );
  });

  it("fixed and not measurable: the window is a setting, and the caption says where it lives", () => {
    expect(caption({
      coldZone: {
        measurable: false, mode: "fixed", cold_after_days: 90, fixed_after_days: 90,
        target_share_pct: null, achieved_share_pct: null, floor_days: null, floor_applied: false,
        derived_days: null, eligible_repos: null, cold_bound_only: null,
        observed_from: null, as_of: "2026-06-15T00:00:00.000Z",
        bucket_edges: null, bucket_labels: null, repos: null, teams: null, totals: null,
        row_count: 0, dropped_no_repo: 0, unclassified_secrets: 0, scopes_without_scan: [],
      },
    })).toBe(`${FIXED_LEAD} The window is set in Settings, on the Deadlines tab.${POP_0}`);
  });

  it("relative with the floor idle: where the line landed, and that the floor did not bind", () => {
    expect(caption(relativeModel())).toBe(
      `${RELATIVE_LEAD} It landed at 47 days idle, and 10 repositories (21.7%) are cold.`
      + ` The 14-day floor did not apply.${POP_400}`,
    );
  });

  it("relative with the floor idle at n = 1: the verb agrees with a single cold repository", () => {
    expect(caption(relativeModel({ achieved_share_pct: (1 / 46) * 100 }, { cold_repos: 1 })))
      .toBe(
        `${RELATIVE_LEAD} It landed at 47 days idle, and 1 repository (2.2%) is cold.`
        + ` The 14-day floor did not apply.${POP_400}`,
      );
  });

  it("relative with the floor holding: the line that was refused, and the smaller zone", () => {
    expect(caption(relativeModel(
      { floor_applied: true, derived_days: 9, cold_after_days: 14,
        achieved_share_pct: (2 / 46) * 100 },
      { cold_repos: 2 },
    ))).toBe(
      `${RELATIVE_LEAD} The idlest 20% would have been 9 days, so the 14-day floor holds the`
      + " line instead, and 2 repositories (4.3%) are cold — a smaller zone than the 20% asked"
      + ` for.${POP_400}`,
    );
  });

  it("relative with the floor holding at n = 1: the verb agrees with a single cold repository",
    () => {
      expect(caption(relativeModel(
        { floor_applied: true, derived_days: 9, cold_after_days: 14,
          achieved_share_pct: (1 / 46) * 100 },
        { cold_repos: 1 },
      ))).toBe(
        `${RELATIVE_LEAD} The idlest 20% would have been 9 days, so the 14-day floor holds the`
        + " line instead, and 1 repository (2.2%) is cold — a smaller zone than the 20% asked"
        + ` for.${POP_400}`,
      );
    });

  it("relative with nothing to rank: the line rests on the floor, and says so", () => {
    expect(caption(relativeModel(
      { eligible_repos: 0, achieved_share_pct: null, derived_days: null, cold_after_days: 14 },
      { repos_with_open: 0, cold_repos: 0 },
    ))).toBe(
      "Relative mode: no repository has an open finding, so there is nothing to rank. The line"
      + ` rests on the 14-day floor until one does.${POP_400}`,
    );
  });

  it("relative and not measurable: what would produce a line, and the floor under it", () => {
    expect(caption({
      coldZone: {
        measurable: false, mode: "relative", cold_after_days: 14, fixed_after_days: 90,
        target_share_pct: 20, achieved_share_pct: null, floor_days: 14, floor_applied: false,
        derived_days: null, eligible_repos: null, cold_bound_only: null,
        observed_from: null, as_of: "2026-06-15T00:00:00.000Z",
        bucket_edges: null, bucket_labels: null, repos: null, teams: null, totals: null,
        row_count: 0, dropped_no_repo: 0, unclassified_secrets: 0, scopes_without_scan: [],
      },
    })).toBe(
      "Relative mode: the line is derived from the estate once a scan has been saved, and it"
      + ` never falls below the 14-day floor.${POP_0}`,
    );
  });

  it("the bound-only suffix rides on either mode, and is grammatical at one", () => {
    // A cold repository whose idle time was never MEASURED is ranked and classified at the
    // bound it can prove — a systematic under-estimate — so the count is said out loud.
    expect(caption(relativeModel({ cold_bound_only: 4 }))).toContain(
      " 4 of them have no movement on record at all, so their idle time is a lower bound.",
    );
    expect(caption(fixedModel({ cold_bound_only: 1 }))).toBe(
      `${FIXED_LEAD} 3 of 46 repositories with open findings (6.5%) are cold. 1 of them has no`
      + ` movement on record at all, so its idle time is a lower bound.${POP_400}`,
    );
  });

  it("says nothing about a bound nobody is resting on", () => {
    expect(caption(relativeModel())).not.toContain("lower bound");
    expect(caption(fixedModel())).not.toContain("lower bound");
  });

  it("NO caption, in any state, writes a bound with \">\" or \"≥\"", () => {
    // README.md above the Pages table: prose says "at least N", a CELL says "≥ N", and neither
    // ever says ">". This is prose in every one of its eight shapes.
    const models = [
      coldModel(), fixedModel(), relativeModel(),
      fixedModel({ eligible_repos: 0, achieved_share_pct: null }, { repos_with_open: 0 }),
      relativeModel({ floor_applied: true, derived_days: 9, cold_after_days: 14 }),
      relativeModel({ eligible_repos: 0, achieved_share_pct: null }, { repos_with_open: 0 }),
      relativeModel({ cold_bound_only: 7 }),
      { coldZone: { measurable: false, mode: "relative", cold_after_days: 14, floor_days: 14 } },
      { coldZone: { measurable: false, mode: "fixed", cold_after_days: 90 } },
      null, {},
    ];
    for (const model of models) {
      const text = coldModeCaption(coldZoneView(model));
      expect(text, JSON.stringify(model)).not.toContain(">");
      expect(text, JSON.stringify(model)).not.toContain("≥");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("repos: the cold-repositories card names the share it drew and what drew it", () => {
  it("prints the achieved share on the face of the card, over the population it is of", () => {
    const [card] = coldKpiCards(coldZoneView(relativeModel()));
    expect(card.sub).toBe("21.7% of 46 with open findings");
  });

  it("falls back to today's sentence where there is no share to print", () => {
    const [card] = coldKpiCards(coldZoneView(relativeModel(
      { achieved_share_pct: null }, { repos_with_open: 0, cold_repos: 0 },
    )));
    expect(card.sub).toBe("Of 0 with open findings");
    expect(card.sub).not.toMatch(/%/);
  });

  it("the denominator names the mode, the target and where the line landed", () => {
    const [card] = coldKpiCards(coldZoneView(relativeModel()));
    expect(card.denominator).toContain(
      "Relative mode: the idlest 20% of them are the cold zone, and the line landed at 47 days"
      + " idle.",
    );
    expect(card.denominator).toContain("for at least 47 days");
    expect(card.denominator).not.toMatch(/>/);
  });

  it("…or the floor sentence, where the floor is what held the line", () => {
    const [card] = coldKpiCards(coldZoneView(relativeModel(
      { floor_applied: true, derived_days: 9, cold_after_days: 14,
        achieved_share_pct: (2 / 46) * 100 },
      { cold_repos: 2 },
    )));
    expect(card.denominator).toContain(
      "Relative mode: the idlest 20% of them would have been 9 days, so the 14-day floor holds"
      + " the line instead and the zone is smaller than the 20% asked for.",
    );
  });

  it("appends the bound-only sentence when cold repositories are resting on a bound", () => {
    const [card] = coldKpiCards(coldZoneView(relativeModel({ cold_bound_only: 4 })));
    expect(card.denominator).toMatch(
      / 4 of them have no movement on record at all, so their idle time is a lower bound\.$/,
    );
    expect(coldKpiCards(coldZoneView(relativeModel()))[0].denominator)
      .not.toContain("lower bound");
  });

  it("says nothing about a mode on the fixed window — that denominator is unchanged", () => {
    const [card] = coldKpiCards(coldZoneView(fixedModel()));
    expect(card.denominator).toBe(
      "Of 46 repositories with open findings (6.5%). Cold means no finding resolved, removed or"
      + " rotated for at least 90 days, measured at the last scan.",
    );
  });

  it("leaves the other three cards exactly as they were", () => {
    const relative = coldKpiCards(coldZoneView(relativeModel()));
    const fixed = coldKpiCards(coldZoneView(fixedModel()));
    expect(relative.map((c) => c.key))
      .toEqual(["coldRepos", "openInCold", "highRiskInCold", "unobserved"]);
    for (const i of [1, 2, 3]) {
      expect(relative[i].denominator, relative[i].key).not.toMatch(/Relative mode/);
      expect(relative[i].sub, relative[i].key).toBe(fixed[i].sub);
    }
  });
});

describe("repos: coldTeamRows — the rank is not the row number, and the badge is relative only", () => {
  it("carries the rank and the mark the payload published", () => {
    const v = coldZoneView(relativeModel({
      teams: [
        coldTeam({ product: "quiet", label: "quiet", relative_rank: 1, in_coldest_share: true }),
        coldTeam({ relative_rank: 2, in_coldest_share: false }),
      ],
    }));
    const rows = coldTeamRows(v);
    expect(rows.map((r) => r.relativeRank)).toEqual([1, 2]);
    expect(rows.map((r) => r.inColdestShare)).toEqual([true, false]);
  });

  it("a product with no repository carrying an open finding has NO rank, not a last place", () => {
    const v = coldZoneView(relativeModel({
      teams: [coldTeam({
        repos_with_open: 0, cold_repos: 0, cold_share_pct: null, verdict: "clear",
        relative_rank: null, in_coldest_share: false,
      })],
    }));
    expect(coldTeamRows(v)[0].relativeRank).toBeNull();
  });

  it("fixed mode marks nobody, and the note under the table stays silent", () => {
    // `in_coldest_share` is a claim about a TARGET share and fixed mode never named one, so
    // the domain leaves it false on every row and the total at zero.
    const v = coldZoneView(fixedModel({
      teams: [coldTeam({ relative_rank: 1, in_coldest_share: false })],
    }));
    expect(coldTeamRows(v).every((r) => r.inColdestShare === false)).toBe(true);
    expect(coldestShareNote(v)).toBeNull();
  });

  it("an older payload has neither field, and neither is invented", () => {
    const [row] = coldTeamRows(coldZoneView(coldModel()));
    expect(row.relativeRank).toBeNull();
    expect(row.inColdestShare).toBe(false);
  });
});

describe("repos: coldestShareNote — the marks counted, and the clamp that decides how many", () => {
  it("counts the badged products and states the refusal behind the count", () => {
    const v = coldZoneView(relativeModel({}, { teams_in_coldest_share: 2 }));
    expect(coldestShareNote(v)).toBe(
      "2 products are in the coldest 20% by the share of their open-finding repositories that"
      + " are cold. A product with no cold repository is never marked.",
    );
  });

  it("reads grammatically at one product", () => {
    const v = coldZoneView(relativeModel({}, { teams_in_coldest_share: 1 }));
    expect(coldestShareNote(v)).toBe(
      "1 product is in the coldest 20% by the share of its open-finding repositories that are"
      + " cold. A product with no cold repository is never marked.",
    );
  });

  it("is null — not a sentence about zero products — when nobody is marked", () => {
    expect(coldestShareNote(coldZoneView(relativeModel()))).toBeNull();
    expect(coldestShareNote(null)).toBeNull();
    expect(coldestShareNote(undefined)).toBeNull();
  });
});

// =========================================================================================
//  repos: ONE grouped table with a repo/product switch — and no language table at all
// =========================================================================================
//
// SOURCE-AS-TEXT, for this file's usual reason: no jsdom here, and what can go wrong is
// WHICH payload cut the table reads and WHETHER the switch repaints instead of refetching.

describe("repos: the grouped table is one table with two grains", () => {
  const section = REPOS_SRC.slice(
    REPOS_SRC.indexOf("function renderGroupTable"),
    REPOS_SRC.indexOf("function renderHalfLifeChart"),
  );

  it("reads BOTH cuts from the one payload, so the switch is a repaint and not a refetch", () => {
    expect(section).toMatch(/model\.byProduct && model\.byProduct\.all/);
    expect(section).toMatch(/model\.byRepo && model\.byRepo\.all/);
    // A refetch here would make a grain flip cost a round trip for data already on the page.
    expect(section).not.toMatch(/swrCall|api_getReposPage/);
  });

  it("names the row header for the grain, and the control agrees word for word", () => {
    expect(section).toMatch(/label: isRepo \? "Repository" : "Product"/);
    expect(REPOS_SRC).toMatch(/value: "repo",\s*\n\s*label: "Repository"/);
    expect(REPOS_SRC).toMatch(/value: "product",\s*\n\s*label: "Product"/);
  });

  it("ONE GRAIN-SPECIFIC COLUMN EACH, in the same slot: Lifecycle vs Repos", () => {
    // Without `Repos` a reader cannot tell a product whose single repository is dense from one
    // whose twenty are; on the repository side the answer is always one, so it would be a
    // column of ones. `Lifecycle` is the mirror: a retired repository carries a backlog nobody
    // is meant to clear, and a product spans repositories that need not agree on one word — so
    // `domain/assets.ts` publishes `asset_lifecycle` at the repository grain and null at every
    // other, and this side of the branch is the only place it can be read.
    expect(section).toMatch(/if \(isRepo\) \{[\s\S]{0,200}?label: "Lifecycle"/);
    expect(section).toMatch(/\} else \{[\s\S]{0,120}?key: "assets", label: "Repos"/);
    // And neither leaks to the other side: one `columns.push` per branch, not two.
    expect(section.match(/label: "Lifecycle"/g)).toHaveLength(1);
    expect(section.match(/label: "Repos"/g)).toHaveLength(1);
  });

  it("draws the switch even where the grain has nothing measured", () => {
    // A reader who lands on an empty grain has to be able to get back to the one that has
    // something; a control that appeared only on success would strand them.
    const beforeEmpty = section.slice(0, section.indexOf("if (!rows.length)"));
    expect(beforeEmpty).toMatch(/repoHost\.append\(grainSwitch\(\)\)/);
  });

  it("is headed by its QUESTION, and leaves the grain to the switch inside it", () => {
    // The control already says which grain a row is, so a heading repeating it says nothing
    // twice — and "By repository or product" collided on screen with the cold zone's own
    // "By product" roll-up, leaving two headings that both answered "how is this grouped?"
    // and neither "what does this tell me?".
    expect(REPOS_SRC).toMatch(/sectionLabel\("Backlog and clearance"\)/);
    expect(REPOS_SRC).not.toMatch(/sectionLabel\("By repository/);
    // The cold zone's roll-up is untouched: it answers who has gone quiet, which this does
    // not, and it stays legible under its own section heading.
    expect(REPOS_SRC).toMatch(/"By product"/);
  });

  it("the language table is gone from the page entirely — heading, host and payload", () => {
    // Deleted rather than hidden: a repository's language is not something anyone remediates
    // against, and grouping the same measurements by it restated the repository table one
    // level coarser. `assets.ts` keeps its `language` grouping for brick's fixture parity;
    // this page simply never asks for it.
    expect(REPOS_SRC).not.toMatch(/byLanguage/);
    expect(REPOS_SRC).not.toMatch(/langHost/);
    expect(REPOS_SRC).not.toMatch(/sectionLabel\("By language"\)/);
    expect(REPOS_SRC).not.toMatch(/label: .*"Language"/);
  });
});

describe("repos: the mode reaches the section, the column and the canvas", () => {
  // SOURCE-AS-TEXT, for the same reason the notice-vs-error check above is: no jsdom here, and
  // what can go wrong is WHERE the sentence is appended and WHETHER the canvas is told.
  const section = REPOS_SRC.slice(
    REPOS_SRC.indexOf("function renderColdZone"),
    REPOS_SRC.indexOf("function renderGroupTable"),
  );
  const renderFn = REPOS_SRC.slice(REPOS_SRC.indexOf("function renderColdZone"));
  const body = renderFn.slice(0, renderFn.indexOf("\n  }\n"));

  it("the caption is the section's FIRST child, ahead of both notice branches", () => {
    expect(body).toMatch(/denomNote\(coldModeCaption\(view\)\)/);
    // Before the early return for "not measurable" — and therefore before the one for "not
    // populated" too, which is further down the same function.
    expect(body.indexOf("coldModeCaption"))
      .toBeLessThan(body.indexOf("if (!view.measurable)"));
  });

  it("all four coverage notes render ahead of the measurable check, same as endOfLifeNote", () => {
    expect(body).toMatch(/scopesWithoutScanNote\(view\)/);
    expect(body).toMatch(/droppedNoRepoNote\(view\)/);
    expect(body).toMatch(/unclassifiedSecretsNote\(view\)/);
    const measurableAt = body.indexOf("if (!view.measurable)");
    // The CALL sites, not any mention — the comments above them name `endOfLifeNote` first
    // in prose, which would make a bare `indexOf("endOfLifeNote")` fragile.
    const callAt = (name) => body.indexOf(`${name}(view)`);
    expect(callAt("scopesWithoutScanNote")).toBeLessThan(measurableAt);
    expect(callAt("droppedNoRepoNote")).toBeLessThan(measurableAt);
    expect(callAt("unclassifiedSecretsNote")).toBeLessThan(measurableAt);
    // The coverage warning — the most important of the four — leads even `endOfLifeNote`.
    expect(callAt("scopesWithoutScanNote")).toBeLessThan(callAt("endOfLifeNote"));
  });

  it("the product table carries a Coldest rank column, its pill and its glossary id", () => {
    expect(section).toMatch(/label: "Coldest rank"/);
    expect(section).toMatch(/term: "coldest-share"/);
    expect(section).toMatch(/statusPill\("warn", `Coldest \$\{fmtCount\(view\.targetSharePct\)\}%`\)/);
    // The column sits after Cold share and before Open in cold.
    expect(section.indexOf('label: "Cold share"')).toBeLessThan(section.indexOf('label: "Coldest rank"'));
    expect(section.indexOf('label: "Coldest rank"')).toBeLessThan(section.indexOf('label: "Open in cold"'));
  });

  it("the table is headed By product and carries the Support group column next to it", () => {
    expect(section).toMatch(/"By product"/);
    expect(section).toMatch(/label: "Product"/);
    expect(section).toMatch(/label: "Support group"/);
    // Immediately after the product it belongs to, and before anything measured — the reader
    // reads "this product, under that group" as one phrase before any number arrives.
    expect(section.indexOf('label: "Product"'))
      .toBeLessThan(section.indexOf('label: "Support group"'));
    expect(section.indexOf('label: "Support group"'))
      .toBeLessThan(section.indexOf('label: "Verdict"'));
    // And the word the whole family retired is gone from this section.
    expect(section).not.toMatch(/label: "Project"/);
  });

  // THE IDLE GRID IS GONE, and this holds what replaced it. It drew one row per REPOSITORY
  // with exactly one lit cell in it — an N x 5 grid carrying N values, which is a column of
  // data wearing a matrix. That one fact is a pill on the repositories table now.
  it("draws no per-repository grid any more", () => {
    expect(section).not.toMatch(/tipLabel\("Idle time by repo"/);
    expect(section).not.toMatch(/cell\.lit/);
    expect(section).not.toMatch(/data-level/);
    // Not `heatModel`: the comment standing where it used to be names it, and a raw-text sweep
    // that failed on the sentence explaining a removal rather than on the removal itself is
    // the trap this package's contracts strip comments to avoid.
    expect(section).not.toMatch(/heatModel\(/);
  });

  it("bands a repository where the reading it bands already is", () => {
    expect(section).toMatch(/label: "Idle band"/);
    expect(section).toMatch(/class: "bandpill"/);
    // The band comes from the domain's own bucket, never re-derived from days and a threshold.
    expect(section).toMatch(/coldBandDefs\(view\)\.find/);
  });

  it("puts a PRODUCT's distribution in the roll-up row that owns it", () => {
    expect(section).toMatch(/label: "Idle profile"/);
    expect(section).toMatch(/bandBarModel\(\{/);
    // One scale for the table, never per row.
    expect(section).toMatch(/const scale = coldBandScale\(rows\);/);
    expect(section).toMatch(/max: scale/);
  });

  it("the scatter is told which mode drew the line it is about to draw a rule at", () => {
    expect(section).toMatch(/coldZoneScatter\(canvas, points, \{[\s\S]*?mode: view\.mode,/);
  });

  it("the badge's count line is rendered under the product table", () => {
    expect(section).toMatch(/coldestShareNote\(view\)/);
  });
});

// =========================================================================================
//  history.js
// =========================================================================================

describe("history: a null severities means ALL severities, never none", () => {
  it("severitiesLabel(null) reads as 'All severities' — the secrets shape", () => {
    expect(severitiesLabel(null)).toBe("All severities");
    expect(severitiesLabel(undefined)).toBe("All severities");
  });

  it("severitiesLabel names exactly what a scoped scan (sca/sast) actually covered", () => {
    expect(severitiesLabel('["CRITICAL","HIGH"]')).toBe("CRITICAL, HIGH");
  });

  it("isAllSeverities agrees: null/empty is all, a real list is not", () => {
    expect(isAllSeverities(null)).toBe(true);
    expect(isAllSeverities("[]")).toBe(true);
    expect(isAllSeverities('["LOW"]')).toBe(false);
  });

  it("scanRowsView carries a secrets row's null severities as 'All severities', not 'None'", () => {
    const rows = scanRowsView([
      { scan_id: "sync-1", ts: "2026-03-01T00:00:00Z", scope: "secrets", mode: "full", total: 3, new_count: 3, resolved_count: 0, reopened_count: 0, severities: null, sealed: 0 },
    ]);
    expect(rows[0].allSeverities).toBe(true);
    expect(rows[0].severitiesText).toBe("All severities");
    expect(rows[0].severitiesText.toLowerCase()).not.toContain("none");
  });
});

describe("history: three rows per sync, one per register", () => {
  const SYNC = [
    { scan_id: "sync-1", ts: "2026-03-01T00:00:00Z", scope: "sca", mode: "full", total: 10, new_count: 10, resolved_count: 0, reopened_count: 0, severities: '["CRITICAL","HIGH"]', sealed: 0 },
    { scan_id: "sync-1", ts: "2026-03-01T00:00:00Z", scope: "sast", mode: "full", total: 5, new_count: 5, resolved_count: 0, reopened_count: 0, severities: '["CRITICAL","HIGH"]', sealed: 0 },
    { scan_id: "sync-1", ts: "2026-03-01T00:00:00Z", scope: "secrets", mode: "full", total: 3, new_count: 3, resolved_count: 0, reopened_count: 0, severities: null, sealed: 0 },
  ];

  it("groupBySync collapses the three scope rows of one sync into one group of three", () => {
    const groups = groupBySync(SYNC);
    expect(groups).toHaveLength(1);
    expect(groups[0].scanId).toBe("sync-1");
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[0].scopes).toEqual(["sast", "sca", "secrets"]);
  });

  it("a partial sweep (fewer than three scopes) groups to fewer than three rows", () => {
    const groups = groupBySync(SYNC.slice(0, 2));
    expect(groups[0].rows).toHaveLength(2);
  });

  it("the flat table view keeps all three rows — one per (scan_id, scope) — rather than folding them", () => {
    const rows = scanRowsView(SYNC);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.scope).sort()).toEqual(["sast", "sca", "secrets"]);
  });
});

describe("history: KPIs, KM points and the SLA-trend gap", () => {
  it("kpiView derives the one honest rate this KPI band can publish, with its denominator", () => {
    const v = kpiView({
      tracked: 100, open: 40, resolvedAllTime: 60, km: { median: 3.5, medianLowerBound: 3.5 },
    });
    expect(v.resolvedSharePct).toBeCloseTo(60, 5);
    expect(v.tracked).toBe(100);
  });

  it("kpiView never divides by zero into a fake rate", () => {
    expect(kpiView({ tracked: 0, open: 0, resolvedAllTime: 0 }).resolvedSharePct).toBeNull();
  });

  /**
   * THE FOURTH CARD, AND WHY THE `medianMttr` FIXTURE ABOVE BECAME A `km` ONE.
   *
   * The retired claim: the KPI band's half-life card publishes `kpis.medianMttr`, i.e.
   * `overall.mttr_median` — the plain median over the rows that CLOSED. The card is captioned
   * with the `half-life` glossary term, which defines a Kaplan-Meier figure that keeps
   * still-open findings in as censored evidence, so the field and the caption were two
   * different claims about two different populations. On the dev seed the card read 93 days
   * while the MTTR page read "Not reached" over the same 554 rows. `medianMttr` is gone
   * from the payload (readModels.ts's `buildHistory`) and the band reads `kpis.km` through
   * `kmHalfLifeView` — the same chooser the MTTR page's hero draws with.
   *
   * NOTE ON WHAT THE OLD FIXTURE ACTUALLY PINNED: nothing about the median. It passed
   * `medianMttr: 3.5` and asserted only `resolvedSharePct` and `tracked`, so the defect could
   * never have failed here. The three outcomes below are the guard that was missing.
   */
  describe("the half-life card publishes the KM figure, in the tile's own notation", () => {
    it("a measured median is the number itself", () => {
      const v = kpiView({
        tracked: 8, open: 3, resolvedAllTime: 5,
        km: { median: 41, medianLowerBound: 41, q25: 18, reliableUntil: null },
      });
      expect(v.halfLife).toEqual({
        measured: true, value: "41 days", isLowerBound: false, days: 41,
        q25Days: 18, state: "median", secondary: null,
      });
    });

    it("no median but a q25 is \"Not reached\" — never \"at least N days\" or a table cell's \"≥ N\"", () => {
      const v = kpiView({
        tracked: 554, open: 416, resolvedAllTime: 138,
        km: { median: null, medianLowerBound: 297, q25: 41, reliableUntil: 297 },
      });
      expect(v.halfLife.value).toBe("Not reached");
      expect(v.halfLife.isLowerBound).toBe(true);
      expect(v.halfLife.state).toBe("quartile");
      expect(v.halfLife.secondary).toBe("25% fixed within 41 days");
      // THE PERTURBATION THIS PAIR EXISTS FOR. `boundedDays(null, 297).text` is "≥ 297.0 d"
      // — the numeric-cell notation, and it may not leak into this tile's own value.
      expect(v.halfLife.value).not.toMatch(/[≥>]/);
      expect(v.halfLife.value).not.toMatch(/at least/);
    });

    it("no median AND no q25, but a reliable floor, is STILL \"Not reached\"", () => {
      // MTTR delayed-entry package: the state a young register spends most of its life in —
      // not even a quarter has closed within the window the curve can still be trusted over.
      const v = kpiView({
        tracked: 554, open: 416, resolvedAllTime: 138,
        km: { median: null, medianLowerBound: 297, q25: null, reliableUntil: 297 },
      });
      expect(v.halfLife.value).toBe("Not reached");
      expect(v.halfLife.state).toBe("quartile-bound");
      expect(v.halfLife.secondary).toBe("under 25% fixed within 297 days");
      expect(v.halfLife.value).not.toMatch(/at least/);
      expect(v.halfLife.value).not.toMatch(/[≥>]/);
    });

    it("neither is \"Not measured\" — NOT a zero, and NOT a fallback to the retired naive median", () => {
      // `medianMttr` is handed in on purpose: this is the defect trying to come back. A
      // `kpiView` that fell through to it when the curve has no median would answer
      // "93 days" here, which is exactly the figure the Scan History card used to publish.
      const v = kpiView({
        tracked: 554, open: 554, resolvedAllTime: 0, medianMttr: 93,
        km: { median: null, medianLowerBound: null },
      });
      expect(v.halfLife).toEqual({
        measured: false, value: "Not measured", isLowerBound: false, days: null,
        q25Days: null, state: "unmeasured", secondary: null,
      });
      expect(v.medianMttr).toBeUndefined();
    });

    it("a payload with no km block at all says so, rather than throwing or printing a 0", () => {
      expect(kpiView({ tracked: 1, open: 1, resolvedAllTime: 0 }).halfLife.value)
        .toBe("Not measured");
      expect(kpiView(null).halfLife.value).toBe("Not measured");
      expect(kpiView({ km: null }).halfLife.measured).toBe(false);
    });

    it("the card renders the view object's own string — no second chooser in the DOM half", () => {
      // The DOM half read as text, this file's established split (see the module header).
      // What must be true: the tile's value is `v.halfLife.value` verbatim, so every outcome
      // pinned above is what a reader actually reads.
      expect(HISTORY_SRC)
        .toMatch(/glossaryTip\("Remediation half-life", "half-life"\), v\.halfLife\.value/);
      expect(HISTORY_SRC).not.toMatch(/v\.medianMttr/);
    });

    /**
     * ONE STATISTIC, ONE NAME. The retired claim is the label "Median MTTR", which this card
     * carried while the MTTR page's hero called the same figure over the same population
     * "Remediation half-life" — both pointing at the `half-life` glossary entry, itself
     * titled "Remediation half-life". Nothing was wrong with the arithmetic; what was wrong
     * is that a reader moving between the two pages had to work out that two names were one
     * number, which is the drift the "one vocabulary for figures" wave exists to stop.
     */
    it("the card is named for the statistic, in the same words as the glossary and the MTTR hero", () => {
      expect(HISTORY_SRC).not.toMatch(/kpiCard\(glossaryTip\("Median MTTR"/);
      const mttrSrc = readFileSync(
        new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8",
      );
      expect(mttrSrc).toContain('tipLabel("Remediation half-life"');
    });
  });

  it("kmMedianPoints filters the skipped points (km_median_days: null) — the server-applied kmSkipMask", () => {
    const trend = [
      { date: "2026-01-01", reconstructed: true, open: 1, resolved: 0, km_median_days: null },
      { date: "2026-01-02", reconstructed: true, open: 1, resolved: 0, km_median_days: 5 },
      { date: "2026-01-03", reconstructed: false, open: 0, resolved: 1, km_median_days: 4 },
    ];
    const pts = kmMedianPoints(trend);
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.y)).toEqual([5, 4]);
  });

  it("openResolvedPoints carries every point verbatim (this line is never skip-masked)", () => {
    const trend = [{ date: "2026-01-01", reconstructed: true, open: 3, resolved: 1, km_median_days: null }];
    expect(openResolvedPoints(trend)).toEqual([{ date: "2026-01-01", open: 3, resolved: 1, reconstructed: true }]);
  });

  it("perScopeView always names all three registers, even with zero scans", () => {
    const rows = perScopeView({ sca: { scans: 2, sealed: 0, firstScanTs: null, lastScanTs: null, lastTotal: null } });
    expect(rows.map((r) => r.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(rows.find((r) => r.scope === "sast").scans).toBe(0);
  });

  it("states, in the rendered text, that the open-past-SLA trend is not in this payload", () => {
    // WORDING CHANGED (Wave 1, item 1.4): "payload" is developer jargon reaching the screen.
    // The claim this test pins is unchanged — the open-past-SLA series is not published on
    // this page, it is on MTTR & SLA — only the reader-facing sentence moved from "is not in
    // this page's payload" to "is not published on this page".
    expect(HISTORY_SRC).toMatch(/open-past-SLA series is not published on this page/);
  });
});

// =========================================================================================
//  history.js / data.js — the honesty flags: two figures that cannot follow the scope
// =========================================================================================
//
// `historyModel`'s `scans` and `perScope` (and `storageModel`, unconditionally) carry no
// project dimension — readModels.ts's own comments on `buildHistory` / `buildStorage` say so.
// `getScanHistory` (api.ts) now forwards `scanScopeApplies` / `scanScopeNote` so the client can
// mark them; before this package neither flag left the server at all, so the scan table and
// the per-register coverage strip stayed silently register-wide under a scope with nothing on
// screen to say so.

describe("history: scanScopeNoteShown is gated on the server's own scanScopeNote, not on a "
  + "second client-side scope check", () => {
  it("false with no payload, or a payload carrying no note (no project view is set)", () => {
    expect(scanScopeNoteShown(null)).toBe(false);
    expect(scanScopeNoteShown({ scanScopeApplies: false, scanScopeNote: null })).toBe(false);
  });

  it("true exactly when the server sent a real note string", () => {
    expect(scanScopeNoteShown({
      scanScopeApplies: false,
      scanScopeNote: "scans, perScope and history describe the whole register — a scan "
        + "battery and a daily snapshot carry no project dimension to narrow by.",
    })).toBe(true);
  });

  // PERTURBATION (recorded, then reverted): changing the gate to `payload.scanScopeApplies
  // === false` (ignoring the note's own null-ness) turned the "no note set" test above red —
  // it now reported `true` on an unscoped payload, since `scanScopeApplies` is unconditionally
  // false in buildHistory regardless of whether a project is selected. The "real note" test
  // stayed green either way, which is exactly why relying on scanScopeApplies alone is wrong:
  // it cannot tell scoped-but-unmarked apart from genuinely unscoped.
});

// THE CARRIER CHANGED IN WAVE C; THE CLAIM DID NOT — and the three cases below say which is
// which. What these pinned was `registerWideNote(` — a `<p class="register-wide-note">` under
// each of the two scan-side tables, 21 words under one and 34 under the other, saying the
// same thing in two sets of words. The density wave moved the STATE onto each table's own
// heading as `statusPill("neutral", "Register-wide", lines)` and the two SENTENCES into that
// pill's tip. That is a mechanism, not a claim: the same failure these cases were written to
// catch — a table silently register-wide under a project view, or a note worded so it reads
// as covering the KPIs and the trend as well — fails exactly as loudly against the pill.
//
// So the mechanism assertions are re-pointed at the pill, and everything that is a CLAIM is
// kept verbatim: the gate is still read in the render function that owns the table (never
// re-derived inside the DOM helper, which now takes the decision rather than the payload),
// and the second sentence still says, in those words, that the KPIs and the trend ARE scoped.
describe("history: the note is placed on the scan-side tables specifically, never worded to "
  + "imply the KPIs or trend are unscoped", () => {
  it("renderPerScope gates its own note on scanScopeNoteShown(payload)", () => {
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("function renderPerScope"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/scanScopeNoteShown\(payload\)/);
    expect(body).toMatch(/registerWidePill\(/);
  });

  it("renderTable's note explicitly says the KPIs and trend ARE scoped, right beside the "
    + "claim that the table itself is not", () => {
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("function renderTable"));
    const body = fn.slice(0, fn.indexOf("\n  function renderTrends"));
    expect(body).toMatch(/scanScopeNoteShown\(payload\)/);
    expect(body).toMatch(/KPIs above and the/);
    expect(body).toMatch(/trend below ARE scoped/);
  });

  it("draws the state as the shared statusPill, not as a hand-rolled note", () => {
    expect(HISTORY_SRC).toMatch(/statusPill\("neutral", "Register-wide"/);
    expect(HISTORY_SRC).toMatch(/from "\.\.\/ui\.js"/);
    // NOT A VACUOUS SWEEP, and this half is what makes the re-point above safe: a pill with
    // no lines behind it would be a two-word label where a sentence used to be, so both
    // sentences have to still be in the source, and the helper has to refuse to draw a pill
    // when the server sent no note at all.
    expect(HISTORY_SRC).toMatch(/Scan counts across every register, not narrowed/);
    expect(HISTORY_SRC).toMatch(/This table lists every scan ever saved, not narrowed/);
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("function registerWidePill"));
    expect(fn.slice(0, fn.indexOf("\n  }\n"))).toMatch(/if \(!lines\) return;/);
  });
});

describe("data: Storage's register-wide note only appears while a project view is actually "
  + "narrowing the rest of the app", () => {
  it("currentlyScoped() is false with nothing booted (this test's real, un-mocked store.js)", () => {
    expect(currentlyScoped()).toBe(false);
  });

  it("renderStorage gates the note on model.scopeApplies === false AND currentlyScoped()", () => {
    const fn = DATA_SRC.slice(DATA_SRC.indexOf("function renderStorage"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/model\.scopeApplies === false/);
    expect(body).toMatch(/currentlyScoped\(\)/);
    expect(body).toMatch(/registerWideNote\(/);
  });

  it("falls back to an honest sentence if the server ever omits scopeNote, rather than "
    + "rendering an empty note", () => {
    const fn = DATA_SRC.slice(DATA_SRC.indexOf("function renderStorage"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/model\.scopeNote \|\|/);
  });

  // PERTURBATION (recorded, then reverted): dropping the `currentlyScoped()` half of the
  // guard (leaving only `model.scopeApplies === false`, which storageModel sets on every
  // call) would render this note on every visit to Storage, scoped or not — turning "showing
  // everything" from the resting, silent state into a permanently-lit badge. There is no
  // jsdom in this suite to render the page and see the badge appear, so this is recorded as a
  // manual read of the source rather than a failing assertion: the guard is the ONLY line in
  // renderStorage that mentions currentlyScoped, so removing it removes the whole condition
  // the two tests above pin.
});

// =========================================================================================
//  data.js
// =========================================================================================

describe("data: an unreadable tab is an error, never zero cells", () => {
  it("tabCellsView keeps cells null and surfaces the error text for a tab that threw", () => {
    const rows = tabCellsView([
      { tab: "scans", cells: 1200 },
      { tab: "jobs", cells: null, error: "Exception: Range not found" },
    ]);
    const jobs = rows.find((r) => r.tab === "jobs");
    expect(jobs.unreadable).toBe(true);
    expect(jobs.cells).toBeNull();
    expect(jobs.error).toBe("Exception: Range not found");
    // And it must not be indistinguishable from a genuinely empty (0-cell) tab.
    const scans = rows.find((r) => r.tab === "scans");
    expect(scans.unreadable).toBe(false);
    expect(scans.cells).toBe(1200);
  });

  it("the render path draws the unreadable tab as a status pill, not '0'", () => {
    const fn = DATA_SRC.slice(DATA_SRC.indexOf("function renderStorage"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/r\.unreadable/);
    expect(body).toMatch(/statusPill\(/);
  });

  it("cellsSummary reports no ceiling as null, not as 0% used", () => {
    expect(cellsSummary({ cellCount: 500, cellLimit: null }).pctUsed).toBeNull();
    expect(cellsSummary({ cellCount: 500, cellLimit: 1000, cellsOther: 10 }).pctUsed).toBeCloseTo(50, 5);
  });

  it("ledgerSummary passes through the register's own counts", () => {
    expect(ledgerSummary({ scanCount: 9, sealedCount: 2, trackedFindings: 500 }))
      .toMatchObject({ scanCount: 9, sealedCount: 2, trackedFindings: 500 });
  });
});

describe("data: compaction — the dry run's numbers, and archive_bytes_freed as a lower bound", () => {
  it("compactionView reads the same shape for a dry run and a real run", () => {
    const v = compactionView({ compaction: { no_op: false, dry_run: true, scans_sealed: 4, episodes_created: 1, observations_pruned: 12, archive_bytes_freed: 4096, db_bytes_freed: 512, floor_ts: "2026-01-01T00:00:00Z" } });
    expect(v).toMatchObject({ noOp: false, scansSealed: 4, episodesCreated: 1, archiveBytesFreed: 4096 });
  });

  it("a no-op compaction is distinguishable from one that actually sealed nothing measurable", () => {
    expect(compactionView({ compaction: { no_op: true } }).noOp).toBe(true);
  });

  it("the render path captions archive_bytes_freed as a lower bound", () => {
    expect(DATA_SRC).toMatch(/lower bound/);
    expect(DATA_SRC).toMatch(/archiveBytesFreed/);
  });
});

describe("data: getRecentErrors' scope note is surfaced, not implied", () => {
  it("recentErrorsView carries covers and note through unchanged", () => {
    const v = recentErrorsView({
      errors: [{ job_id: "j1", kind: "scan", phase: "FAILED", scope: "sca", at: "2026-01-01T00:00:00Z", error: "boom" }],
      covers: "jobs",
      note: "Job failures only — this register has no error-log tab.",
    });
    expect(v.covers).toBe("jobs");
    expect(v.note).toMatch(/jobs|error-log/);
    expect(v.errors).toHaveLength(1);
  });

  it("the render path prints the note (or, absent one, the covers field) rather than staying silent", () => {
    const fn = DATA_SRC.slice(DATA_SRC.indexOf("function renderErrors"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/v\.note/);
    expect(body).toMatch(/v\.covers/);
  });
});

describe("data: every destructive action is behind a confirm step", () => {
  it("confirmedAction never calls the action when confirmation is declined", async () => {
    const action = vi.fn().mockResolvedValue("should not run");
    const confirm = vi.fn().mockResolvedValue(false);
    const out = await confirmedAction(confirm, action);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
    expect(out).toEqual({ ran: false, result: undefined });
  });

  it("confirmedAction calls the action, and only the action's result, once confirmed", async () => {
    const action = vi.fn().mockResolvedValue({ deleted: 2 });
    const confirm = vi.fn().mockResolvedValue(true);
    const out = await confirmedAction(confirm, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ran: true, result: { deleted: 2 } });
  });

  it("delete, compact and reset each route their mutating call through confirmedAction in source", () => {
    for (const rpc of ["api_deleteScans", "api_resetLedger"]) {
      const at = DATA_SRC.indexOf(`"${rpc}"`);
      expect(at, `${rpc} is not called from data.js`).toBeGreaterThan(-1);
      const before = DATA_SRC.slice(Math.max(0, at - 400), at);
      expect(before, `${rpc} is not gated by confirmedAction`).toMatch(/confirmedAction\(/);
    }
    // The real (non-dry) compact run is the mutating call; the dry run is intentionally NOT
    // gated (api.ts: "a dry run mutates nothing, so it is a read").
    const dryRunOnce = DATA_SRC.indexOf('dryRun: false');
    expect(dryRunOnce, "the real compaction call is missing").toBeGreaterThan(-1);
    const before = DATA_SRC.slice(Math.max(0, dryRunOnce - 400), dryRunOnce);
    expect(before).toMatch(/confirmedAction\(/);
  });

  it("deletableScans excludes sealed scans — the server refuses them, so the picker should too", () => {
    const rows = deletableScans([
      { scan_id: "a", ts: "2026-01-01T00:00:00Z", scope: "sca", total: 1, sealed: 0 },
      { scan_id: "b", ts: "2026-01-02T00:00:00Z", scope: "sca", total: 1, sealed: 1 },
    ]);
    expect(rows.map((r) => r.scanId)).toEqual(["a"]);
  });
});

// =========================================================================================
//  repos: the lifecycle column, and the sentence the end-of-life setting owes the reader
// =========================================================================================
//
// The column and the exclusion are one feature read two ways. A repository's lifecycle is
// printed on the cold table whatever the setting says — "cold" and "retired" are opposite
// readings of the same silence and every other cell on the row looks identical — and
// `endOfLifeNote` is what the section says once an operator acts on that.

describe("repos: coldRepoRows carries the lifecycle beside the owner", () => {
  it("prints the tag as the tenant wrote it", () => {
    const v = coldZoneView(coldModel({ repos: [coldRepo({ lifecycle: "END_OF_LIFE" })] }));
    expect(coldRepoRows(v)[0].lifecycle).toBe("END_OF_LIFE");
    expect(coldRepoRows(v)[0].lifecycleText).toBe("END_OF_LIFE");
  });

  it("draws the absence mark for a repository the tenant never tagged, never a guessed word", () => {
    for (const lifecycle of [null, undefined, "", "   "]) {
      const v = coldZoneView(coldModel({ repos: [coldRepo({ lifecycle })] }));
      expect(coldRepoRows(v)[0].lifecycle, String(lifecycle)).toBeNull();
      expect(coldRepoRows(v)[0].lifecycleText, String(lifecycle)).toBe("—");
    }
  });
});

describe("repos: endOfLifeNote", () => {
  const view = (over) => coldZoneView(coldModel(over));

  it("says nothing at all when no repository here is end of life", () => {
    // `unmeasurableNote`'s rule: a sentence about zero repositories is noise — and it is also
    // the honest reading on a tenant whose lifecycle tag this register never learned.
    expect(endOfLifeNote(view({ end_of_life_repos: 0, exclude_end_of_life: false }))).toBeNull();
    expect(endOfLifeNote(view({ end_of_life_repos: 0, exclude_end_of_life: true }))).toBeNull();
    // A payload that predates the fields entirely.
    expect(endOfLifeNote(coldZoneView(coldModel()))).toBeNull();
    expect(endOfLifeNote(null)).toBeNull();
  });

  // Perturbation, run and reverted: returning null whenever the exclusion is off — the
  // "nothing was removed, so there is nothing to say" reading — fails this case with
  // `expected null to contain 'still counted'`.
  it("OFF, it says the retired repositories are in here and where the switch is", () => {
    const note = endOfLifeNote(view({ end_of_life_repos: 3, exclude_end_of_life: false }));
    expect(note).toContain("3 repositories");
    expect(note).toContain("still counted");
    expect(note).toContain("Deadlines");
    // Nothing left, so nothing is claimed to have.
    expect(note).not.toContain("left out");
  });

  // BOTH SENTENCES NAME THE COLD ZONE. There are two of these switches now and they are
  // independent (`mttr.js`'s `endOfLifeExclusionNote` is the other), so a note that claimed
  // its own exclusion was the only one would be false the moment a reader turned the other on.
  it("names the family it reaches, in BOTH settings", () => {
    const off = endOfLifeNote(view({ end_of_life_repos: 3, exclude_end_of_life: false }));
    const on = endOfLifeNote(view({
      end_of_life_repos: 3, exclude_end_of_life: true,
      excluded_end_of_life: 3, excluded_open_findings: 41,
    }));
    expect(off).toContain("the cold zone");
    expect(on).toContain("the cold zone");
  });

  it("ON, it says what left and how much backlog went with it", () => {
    const note = endOfLifeNote(view({
      end_of_life_repos: 3, exclude_end_of_life: true,
      excluded_end_of_life: 3, excluded_open_findings: 41,
    }));
    expect(note).toContain("3 repositories left out");
    expect(note).toContain("41 open findings");
    // THE LIMIT OF THE CLAIM, said in the same breath — and worded so it survives the OTHER
    // switch being on too: neither exclusion ever touches a count of what is open, which is
    // the one promise that is true in all four combinations.
    expect(note).toContain("Still counted in every count of what is open");
  });

  it("counts in singular where one repository or one finding is what happened", () => {
    expect(endOfLifeNote(view({ end_of_life_repos: 1, exclude_end_of_life: false })))
      .toContain("1 repository here is");
    expect(endOfLifeNote(view({
      end_of_life_repos: 1, exclude_end_of_life: true,
      excluded_end_of_life: 1, excluded_open_findings: 1,
    }))).toContain("1 repository left out of the cold zone as end of life, with 1 open finding.");
  });

  it("survives a register with no clock, where the count is real and nothing else is", () => {
    // The fold that produces these happens before the clock is consulted, so the figure is
    // true on a payload whose every other block is null.
    const v = coldZoneView(coldModel({
      measurable: false, repos: null, teams: null, totals: null,
      end_of_life_repos: 2, exclude_end_of_life: true,
      excluded_end_of_life: 2, excluded_open_findings: 7,
    }));
    expect(v.measurable).toBe(false);
    expect(endOfLifeNote(v)).toContain("2 repositories left out");
  });
});
