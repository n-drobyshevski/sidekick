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
// OWNERSHIP, ADAPTED FROM THE BRIEF. The brief asks this suite to assert that "ownership
// coverage renders its unowned count". Measured against the real payload
// (`readModels.ts::buildRepos`, `domain/assets.ts::assetProfile`), `reposModel` carries no
// ownership field at all: `owner_project` never reaches `AssetProfileRow`'s 17 published
// columns, so there is no owned/unowned split anywhere in `api_getReposPage`'s reply. CLAUDE.md
// is explicit that a fabricated number is worse than an honest gap ("invent no numbers", "a
// zero has to prove it looked"), so `ownershipView()` reports `available: false` with a
// reason rather than a count, and the test below pins THAT — the honest-absence behavior —
// instead of a number nothing computed. See repos.js's module header for the full account.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  boundedDays, capacityVerdict, capacityView, densityView, footholdView, groupRows, halfLifeView,
  overallRow, ownershipView, tableRow,
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
});

describe("repos: ownership coverage — honestly absent, not a fabricated unowned count", () => {
  it("reports unavailable rather than inventing a coverage percentage or an unowned count", () => {
    const v = ownershipView();
    expect(v.available).toBe(false);
    expect(v.unownedCount).toBeNull();
    expect(v.reason).toMatch(/owner_project/);
    expect(v.reason).toMatch(/assetProfile/);
  });

  it("the render path draws the honest-absence state (errorState), not a percentage", () => {
    // Source-as-text: renderOwnership() must branch on `!view.available` and reach for
    // errorState() there — a perturbation that rendered a bare number instead is exactly
    // what CLAUDE.md's "invent no numbers" rule exists to catch.
    const fn = REPOS_SRC.slice(REPOS_SRC.indexOf("function renderOwnership"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/!view\.available/);
    expect(body).toMatch(/errorState\(/);
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
    const v = kpiView({ tracked: 100, open: 40, resolvedAllTime: 60, medianMttr: 3.5 });
    expect(v.resolvedSharePct).toBeCloseTo(60, 5);
    expect(v.tracked).toBe(100);
  });

  it("kpiView never divides by zero into a fake rate", () => {
    expect(kpiView({ tracked: 0, open: 0, resolvedAllTime: 0 }).resolvedSharePct).toBeNull();
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
    expect(HISTORY_SRC).toMatch(/open-past-SLA trend is not in this page's payload/);
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

describe("history: the note is placed on the scan-side tables specifically, never worded to "
  + "imply the KPIs or trend are unscoped", () => {
  it("renderPerScope gates its own note on scanScopeNoteShown(payload)", () => {
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("function renderPerScope"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/scanScopeNoteShown\(payload\)/);
    expect(body).toMatch(/registerWideNote\(/);
  });

  it("renderTable's note explicitly says the KPIs and trend ARE scoped, right beside the "
    + "claim that the table itself is not", () => {
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("function renderTable"));
    const body = fn.slice(0, fn.indexOf("\n  function renderTrends"));
    expect(body).toMatch(/scanScopeNoteShown\(payload\)/);
    expect(body).toMatch(/registerWideNote\(/);
    expect(body).toMatch(/KPIs above and the/);
    expect(body).toMatch(/trend below ARE scoped/);
  });

  it("imports registerWideNote from the shared ui barrel, not a hand-rolled note", () => {
    expect(HISTORY_SRC).toMatch(/registerWideNote/);
    expect(HISTORY_SRC).toMatch(/from "\.\.\/ui\.js"/);
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
