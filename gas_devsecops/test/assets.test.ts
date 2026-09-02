// src/domain/assets.ts — the P2P v5 asset-profile family (D6).
//
// Two oracles, in this order of authority:
//   1. test/fixtures/brick/asset_profile.json — the REAL PySpark output of
//      brick/devsecops/metrics.py::asset_profile_populations over 13 literal rows
//      (brick/devsecops/export_fixtures.py:490-600). Two cases, `observed_from_none` and
//      `observed_from_set`; every group AND the OVERALL row of both populations, at 1e-9.
//      A disagreement between this file and that fixture is a FINDING about the port, never
//      a reason to touch the fixture.
//   2. Hand cases with the arithmetic written out, for the behaviour the fixture does not
//      reach: the drop count, the month clamp, the null refusal, `groupBy: "repo"`, and the
//      `secrets` exclusion.
//
// ---------------------------------------------------------------------------------------
// THE RETURN CONTRACT — `OUTPUT_COLUMNS["asset_profile"]`, panels.py:1542-1547.
// 17 fields, spelled as brick spells them so the fixture compare is a plain field-by-field
// equality. Column -> where it comes from in this port:
//
//   1  asset_group                metrics.py:1257 `_asset_group` — coalesce(language,'UNKNOWN'),
//                                 or the repo id under `groupBy: "repo"`; `OVERALL` on the
//                                 union row.                          assets.ts assetGroupOf
//   2  assets                     count of per-asset rows in the group (`F.count(lit(1))`).
//   3  open_findings              sum of per-asset `density` (`F.sum("density")`).
//   4  density_p25                `F.percentile("density", .25)` -> util.quantile(.25).
//   5  density_p50                `F.percentile("density", .50)` -> util.quantile(.50).
//   6  density_p75                `F.percentile("density", .75)` -> util.quantile(.75).
//   7  assets_with_high_risk_pct  safe_pct(#assets with an OPEN high-risk finding, assets)
//                                 — v5 Fig. 11's foothold rate.
//   8  assets_with_high_risk      #assets whose coverage is defined (tp+fn > 0).
//   9  asset_coverage_p50         `F.percentile("asset_coverage_pct", .5)`; NULL coverages
//                                 (no high-risk finding to cover) are SKIPPED, not zeroed.
//  10  km_median_days             metrics.py:1450 `_asset_half_life` -> remediation.kaplanMeier
//                                 over the group's findings; `.median`.
//  11  km_median_lower_bound      the same call's `.medianLowerBound` (τ when the curve never
//                                 reaches half) — published INSTEAD of a fabricated median.
//  12  mmcr_p50                   `F.percentile(safe_pct(closed, open_at_start)/window_months,
//                                 .5)` — v5 Fig. 20.
//  13  falling_behind_pct         share(verdict == "falling-behind") over assets_flowing.
//  14  maintaining_pct            share(verdict == "keeping-up")     over assets_flowing.
//  15  gaining_pct                share(verdict == "gaining")        over assets_flowing.
//  16  assets_flowing             #assets with a non-NULL net flow — the shares' denominator.
//  17  window_months              greatest((now-observed_from)/(86400*30.4375), 1.0).
//
// Plus `population` ("all" | "high_risk"), which `asset_profile` itself stamps on
// (metrics.py:1444-1447) and which the fixture therefore carries: 18 keys in the fixture.
//
// UNMAPPED, both directions:
//   * brick columns with no counterpart here: NONE. All 17 + `population` are produced.
//   * this port's columns with no brick counterpart: `asset_label` only — the display name for
//     a `groupBy: "repo"` group (brick has no repo grouping at all, so nothing to map to). It
//     is null under `groupBy: "language"`, which is why the fixture parity is unaffected.
//   * brick INTERMEDIATES that are deliberately not published, because `asset_profile` does
//     not publish them either: the per-asset `density` / `has_foothold` / `tp` / `fn` /
//     `opened` / `closed` / `open_at_start` / `asset_coverage_pct` / `net_pct` / `verdict`
//     columns of `_per_asset`, which exist only to be aggregated.
//   * `AssetProfileResult` additionally reports `droppedNoAsset` and `unclassifiedSecrets`.
//     Neither is a brick column — brick's `_with_assets` drops silently and its frame arrives
//     with `risk_class` already computed. They are counts of what this port could not measure,
//     and they are published because a zero has to prove it looked.
// ---------------------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  assetProfile,
  assetProfilePopulations,
  type AssetProfileRow,
  type AssetRow,
} from "../src/domain/assets";
import {
  ASSET_GROUP_UNKNOWN,
  DEFAULT_RISK_RULE,
  OVERALL,
  POPULATION_ALL,
  POPULATION_HIGH_RISK,
} from "../src/domain/config";
import { classifyRisk } from "../src/domain/program";
import { brickFixture, expectParity } from "./helpers";

/** `OUTPUT_COLUMNS["asset_profile"]` (panels.py:1542-1547), copied verbatim and in order. */
const OUTPUT_COLUMNS_ASSET_PROFILE = [
  "asset_group", "assets", "open_findings", "density_p25", "density_p50", "density_p75",
  "assets_with_high_risk_pct", "assets_with_high_risk", "asset_coverage_p50",
  "km_median_days", "km_median_lower_bound", "mmcr_p50", "falling_behind_pct",
  "maintaining_pct", "gaining_pct", "assets_flowing", "window_months",
] as const;

// ------------------------------------------------------------------ the brick fixture

interface BrickAssetRow {
  vuln_key: string;
  asset_id: string | null;
  language: string | null;
  severity: string;
  first_detected_at: string;
  resolved_at: string | null;
  is_open: boolean;
  mttr_days: number | null;
  age_days: number | null;
  risk_class: string;
}

interface BrickCase {
  name: string;
  input: { rows: BrickAssetRow[] };
  params: { now: string; observed_from: string | null };
  expected: Record<string, unknown>[];
}

const FX = brickFixture<{ cases: BrickCase[] }>("asset_profile");

/**
 * brick's frame carries `risk_class` as a stored column; this port DERIVES it with
 * `program.classifyRisk` (see assets.ts's note on that divergence). So the fixture's
 * `risk_class` is reproduced through the signal columns `DEFAULT_RISK_RULE` actually reads:
 * `has_kev: true` fires the KEV clause -> "high"; all three signals observed and none firing
 * -> "low". That the mapping is exact is ASSERTED below, not assumed.
 *
 * `is_open` becomes a status, because this register stores a status and derives openness from
 * it (`RESOLVED_STATUSES`). In this frame `is_open === (resolved_at === null)` on all 13 rows.
 */
function fromBrick(r: BrickAssetRow): AssetRow {
  return {
    scope: "sca",
    severity: r.severity,
    status: r.is_open ? "OPEN" : "RESOLVED",
    has_kev: r.risk_class === "high",
    has_exploit: false,
    epss: 0,
    cwe: null,
    ai_verdict: null,
    repo_id: r.asset_id,
    repo_name: r.asset_id,
    language: r.language,
    first_seen: r.first_detected_at,
    resolved_at: r.resolved_at,
    mttr_days: r.mttr_days,
    age_days: r.age_days,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The fixture is ordered by (population, asset_group) — export_fixtures.py:577. */
function inFixtureOrder(rows: AssetProfileRow[]): AssetProfileRow[] {
  return [...rows].sort(
    (a, b) => cmp(a.population, b.population) || cmp(a.asset_group, b.asset_group),
  );
}

describe("assetProfile — brick fixture parity", () => {
  it("reproduces the fixture's risk_class from the signal columns", () => {
    for (const c of FX.cases) {
      for (const r of c.input.rows) {
        expect(classifyRisk(fromBrick(r), DEFAULT_RISK_RULE), r.vuln_key).toBe(r.risk_class);
        // …and with no explicit rule, since scope "sca" resolves to the same one.
        expect(classifyRisk(fromBrick(r)), r.vuln_key).toBe(r.risk_class);
      }
    }
  });

  for (const c of FX.cases) {
    describe(c.name, () => {
      const rows = c.input.rows.map(fromBrick);
      const out = assetProfilePopulations(rows, {
        now: c.params.now,
        observedFrom: c.params.observed_from,
      });
      const actual = inFixtureOrder(out.rows);

      it("emits exactly the fixture's (population, asset_group) pairs", () => {
        expect(actual.map((r) => `${r.population}/${r.asset_group}`)).toEqual(
          c.expected.map((e) => `${e.population}/${e.asset_group}`),
        );
      });

      c.expected.forEach((exp, i) => {
        it(`${exp.population}/${exp.asset_group} matches field for field`, () => {
          expectParity(actual[i], exp);
        });
      });

      it("drops the two asset-less RUBY rows and says so", () => {
        // id:12 has a NULL asset_id, id:13 an empty string — both `risk_class: "high"`, so
        // both populations lose exactly the same two.
        expect(out.all.droppedNoAsset).toBe(2);
        expect(out.highRisk.droppedNoAsset).toBe(2);
        // RUBY is the language of both, and it appears in NO group.
        expect(actual.some((r) => r.asset_group === "RUBY")).toBe(false);
      });
    });
  }

  it("accounts for every field the fixture carries, and adds exactly one of its own", () => {
    const fixtureKeys = new Set<string>();
    for (const c of FX.cases) for (const r of c.expected) for (const k of Object.keys(r)) fixtureKeys.add(k);
    expect([...fixtureKeys].sort()).toEqual(
      [...OUTPUT_COLUMNS_ASSET_PROFILE, "population"].sort(),
    );

    const sample = assetProfile([], { now: "2026-08-01T00:00:00Z", observedFrom: null }).rows[0]!;
    const produced = new Set(Object.keys(sample));
    for (const k of fixtureKeys) expect(produced.has(k), `missing column ${k}`).toBe(true);
    expect([...produced].filter((k) => !fixtureKeys.has(k))).toEqual(["asset_label"]);
  });

  it("publishes OVERALL first, then assets descending", () => {
    const c = FX.cases[0]!;
    const out = assetProfilePopulations(c.input.rows.map(fromBrick), {
      now: c.params.now,
      observedFrom: c.params.observed_from,
    });
    // panels.py:1284 — ORDER BY (asset_group = OVERALL) DESC, assets DESC.
    expect(out.all.rows.map((r) => r.asset_group)).toEqual(["OVERALL", "GO", "JAVA", "PYTHON"]);
    expect(out.all.rows.map((r) => r.assets)).toEqual([5, 2, 2, 1]);
  });
});

// ------------------------------------------------------------------------- hand cases

/** A minimal row; every field the profile reads is overridable. */
function row(over: Partial<AssetRow> = {}): AssetRow {
  return {
    scope: "sca",
    severity: "HIGH",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    cwe: null,
    ai_verdict: null,
    repo_id: "repo-1",
    repo_name: "acme/repo-1",
    language: "GO",
    first_seen: "2025-06-01T00:00:00Z",
    resolved_at: null,
    mttr_days: null,
    age_days: 400,
    ...over,
  };
}

const NOW = "2026-07-01T00:00:00Z";

describe("asset-less rows are dropped AND counted", () => {
  const rows = [
    row({ repo_id: "repo-1" }),
    row({ repo_id: "repo-2" }),
    row({ repo_id: null }),
    row({ repo_id: "" }),
    row({ repo_id: "   " }), // whitespace-only — brick's `length(trim(asset_id)) > 0`
  ];
  const out = assetProfile(rows, { now: NOW, observedFrom: null });
  const overall = out.rows.find((r) => r.asset_group === OVERALL)!;

  it("counts the three it could not place", () => {
    expect(out.droppedNoAsset).toBe(3);
  });

  it("leaves them out of every figure — 5 findings in, 2 assets and 2 open findings out", () => {
    expect(overall.assets).toBe(2);
    expect(overall.open_findings).toBe(2);
    // Not folded into a phantom NULL asset: no UNKNOWN group appears from them either, since
    // the drop happens before grouping.
    expect(out.rows.map((r) => r.asset_group).sort()).toEqual([OVERALL, "GO"].sort());
  });
});

describe("window_months = greatest(days / 30.4375, 1.0) — clamped, NOT floored", () => {
  // metrics.py:1424-1432. The D6 brief stated `max(1, floor(days / 30.4375))`; the fixture
  // falsifies the floor — `observed_from_set` spans 273 days and publishes 8.969199178644764,
  // which a floor would have made 8. The clamp at 1 is real; the floor is not. This test
  // encodes the CLAMP, and the four values below are the division, not a rounding of it.
  //
  // MEASURED: the fixture cannot cover this. Deleting `Math.max(…, 1)` from assets.ts leaves
  // all 18 fixture assertions GREEN and fails only the first `it` below — the fixture's only
  // window is 8.97 months, nowhere near the clamp. So the clamp rests on this hand case alone.
  const FROM = "2026-01-01T00:00:00Z";
  const at = (days: number) =>
    assetProfile([row()], { now: Date.parse(FROM) + days * 86_400_000, observedFrom: FROM })
      .windowMonths!;

  it("clamps a sub-month window to exactly 1.0", () => {
    // 30 / 30.4375 = 0.9856262833675564 -> 1
    expect(at(30)).toBe(1);
    expect(at(1)).toBe(1);
  });

  it("does not floor a window longer than a month", () => {
    expect(at(31)).toBeCloseTo(1.0184804928131417, 12); // 31 / 30.4375
    expect(at(60)).toBeCloseTo(1.9712525667351128, 12); // 60 / 30.4375
    expect(at(61)).toBeCloseTo(2.004106776180698, 12); //  61 / 30.4375
    // A floor would have collapsed all three of these to 1, 1 and 2.
    expect(at(31)).not.toBe(1);
    expect(at(60)).not.toBe(1);
  });

  it("publishes the same value on every row", () => {
    const out = assetProfile([row()], { now: NOW, observedFrom: FROM });
    // 2026-01-01 -> 2026-07-01 is 181 days; 181 / 30.4375 = 5.946611909650924
    for (const r of out.rows) expect(r.window_months).toBeCloseTo(5.946611909650924, 12);
  });
});

describe("observedFrom: null makes every rate NULL, never 0", () => {
  // One repo with a pre-window backlog of 2 high-risk findings, one of which closed inside the
  // window: closed = 1, open_at_start = 2, net_pct = (1-0)/2*100 = 50 -> "gaining", and
  // mmcr = 50 / window_months.
  const rows = [
    row({
      repo_id: "repo-1",
      has_kev: true,
      status: "RESOLVED",
      first_seen: "2025-06-01T00:00:00Z",
      resolved_at: "2026-02-01T00:00:00Z",
      mttr_days: 245,
      age_days: null,
    }),
    row({ repo_id: "repo-1", has_kev: true, first_seen: "2025-06-01T00:00:00Z", age_days: 396 }),
  ];

  const withWindow = assetProfile(rows, { now: NOW, observedFrom: "2026-01-01T00:00:00Z" });
  const without = assetProfile(rows, { now: NOW, observedFrom: null });
  const wOverall = withWindow.rows.find((r) => r.asset_group === OVERALL)!;
  const nOverall = without.rows.find((r) => r.asset_group === OVERALL)!;

  it("computes them when the register knows when it started watching", () => {
    expect(wOverall.window_months).toBeCloseTo(5.946611909650924, 12); // 181 / 30.4375
    expect(wOverall.mmcr_p50).toBeCloseTo(8.408149171270718, 12); //     50 / 5.9466119…
    expect(wOverall.gaining_pct).toBe(100);
    expect(wOverall.falling_behind_pct).toBe(0);
    expect(wOverall.maintaining_pct).toBe(0);
    expect(wOverall.assets_flowing).toBe(1);
  });

  it("refuses them when it does not — null, and specifically not zero", () => {
    expect(without.windowMonths).toBeNull();
    for (const r of without.rows) {
      expect(r.window_months).toBeNull();
      expect(r.mmcr_p50).toBeNull();
      expect(r.falling_behind_pct).toBeNull();
      expect(r.maintaining_pct).toBeNull();
      expect(r.gaining_pct).toBeNull();
    }
    // The three shares are null, not 0 — brick's own `asset_profile` docstring: every one of
    // them is a rate per unit of WATCHED time. `assets_flowing` IS 0, because it is a count of
    // assets with a defined flow and that count is genuinely zero (the fixture agrees:
    // `assets_flowing: 0` on all eight `observed_from_none` rows).
    expect(nOverall.assets_flowing).toBe(0);
  });

  it("leaves everything that does not need a clock unchanged", () => {
    expect(nOverall.assets).toBe(wOverall.assets);
    expect(nOverall.open_findings).toBe(wOverall.open_findings);
    expect(nOverall.asset_coverage_p50).toBe(wOverall.asset_coverage_p50);
    expect(nOverall.km_median_days).toBe(wOverall.km_median_days);
  });
});

describe('groupBy: "repo"', () => {
  const rows = [
    row({ repo_id: "r1", repo_name: "acme/alpha", language: "GO", has_kev: true }),
    row({ repo_id: "r1", repo_name: "acme/alpha", language: "GO" }),
    row({ repo_id: "r2", repo_name: "acme/beta", language: "GO", has_kev: true }),
    row({ repo_id: "r3", repo_name: "acme/gamma", language: "JAVA" }),
  ];
  const byRepo = assetProfile(rows, { now: NOW, observedFrom: null, groupBy: "repo" });
  const byLang = assetProfile(rows, { now: NOW, observedFrom: null });

  it("gives one group per repository plus OVERALL", () => {
    expect(byRepo.rows.map((r) => r.asset_group)).toEqual([OVERALL, "r1", "r2", "r3"]);
    expect(byRepo.rows.map((r) => r.assets)).toEqual([3, 1, 1, 1]);
  });

  it("carries repo_name for display, and only there", () => {
    expect(byRepo.rows.map((r) => r.asset_label)).toEqual([
      null, // OVERALL has no single repo to name
      "acme/alpha",
      "acme/beta",
      "acme/gamma",
    ]);
    expect(byLang.rows.every((r) => r.asset_label === null)).toBe(true);
  });

  it("measures the same population as the language grouping", () => {
    const rOverall = byRepo.rows.find((r) => r.asset_group === OVERALL)!;
    const lOverall = byLang.rows.find((r) => r.asset_group === OVERALL)!;
    expect(rOverall.open_findings).toBe(4);
    expect(lOverall.open_findings).toBe(4);
    expect(rOverall.assets).toBe(lOverall.assets);
    // 2 of 3 repos carry an open high-risk finding: 2/3*100.
    expect(rOverall.assets_with_high_risk_pct).toBeCloseTo(66.66666666666666, 12);
    expect(lOverall.assets_with_high_risk_pct).toBeCloseTo(66.66666666666666, 12);
  });

  it("makes each repo its own density, since the asset IS the repository", () => {
    const r1 = byRepo.rows.find((r) => r.asset_group === "r1")!;
    expect([r1.density_p25, r1.density_p50, r1.density_p75]).toEqual([2, 2, 2]);
    // GO holds r1 (2 open) and r2 (1 open): p25 1.25, p50 1.5, p75 1.75 by linear interpolation.
    const go = byLang.rows.find((r) => r.asset_group === "GO")!;
    expect([go.density_p25, go.density_p50, go.density_p75]).toEqual([1.25, 1.5, 1.75]);
  });
});

describe("secrets rows are excluded from risk classification and counted", () => {
  const rows = [
    row({ repo_id: "r1", has_kev: true }), //          sca, high, open  -> foothold on r1
    row({ repo_id: "r2" }), //                         sca, low,  open
    row({ repo_id: "r2", scope: "secrets", severity: "LOW", has_kev: null, epss: null }),
    row({ repo_id: "r2", scope: "secrets", severity: "LOW", has_kev: null, epss: null }),
  ];
  const out = assetProfile(rows, { now: NOW, observedFrom: null });
  const overall = out.rows.find((r) => r.asset_group === OVERALL)!;

  it("counts them rather than throwing", () => {
    // program.classifyRisk REFUSES the scope outright — that refusal is the contract this
    // module has to route around, so pin it here too.
    expect(() => classifyRisk(rows[2]!)).toThrow(/secrets/);
    expect(out.unclassifiedSecrets).toBe(2);
  });

  it("never lets an unclassified secret become a foothold", () => {
    const r2 = out.rows.find((r) => r.asset_group === "GO")!;
    // r1 and r2 are both GO. Only r1 has an OPEN high-risk finding: 1/2 * 100.
    expect(r2.assets_with_high_risk_pct).toBe(50);
    expect(overall.assets_with_high_risk_pct).toBe(50);
    // …and never enters a coverage denominator: only r1 has a defined coverage.
    expect(overall.assets_with_high_risk).toBe(1);
  });

  it("still counts them as open findings on the repository", () => {
    // Removed is not rotated and unclassified is not absent: a leaked credential is a real
    // open finding on r2, so density sees all four rows.
    expect(overall.open_findings).toBe(4);
  });

  it("drops them from the high-risk population, where they were never high", () => {
    const pops = assetProfilePopulations(rows, { now: NOW, observedFrom: null });
    const hr = pops.highRisk.rows.find((r) => r.asset_group === OVERALL)!;
    expect(hr.population).toBe(POPULATION_HIGH_RISK);
    expect(hr.assets).toBe(1); // r1 only
    expect(hr.open_findings).toBe(1);
    expect(pops.all.rows[0]!.population).toBe(POPULATION_ALL);
    // The count is per population, and both passes see the same two secrets rows.
    expect(pops.all.unclassifiedSecrets).toBe(2);
    expect(pops.highRisk.unclassifiedSecrets).toBe(2);
  });
});

describe("the UNKNOWN group", () => {
  it("folds a missing language into one named group rather than dropping the row", () => {
    const rows = [
      row({ repo_id: "r1", language: null }),
      row({ repo_id: "r2", language: "" }),
      row({ repo_id: "r3", language: "   " }),
      row({ repo_id: "r4", language: "GO" }),
    ];
    const out = assetProfile(rows, { now: NOW, observedFrom: null });
    expect(out.rows.map((r) => r.asset_group)).toEqual([OVERALL, ASSET_GROUP_UNKNOWN, "GO"]);
    // All three blank spellings land in ONE group — see assetGroupOf's divergence note.
    expect(out.rows.find((r) => r.asset_group === ASSET_GROUP_UNKNOWN)!.assets).toBe(3);
    expect(out.droppedNoAsset).toBe(0);
  });
});

describe("the half-life", () => {
  it("publishes a lower bound instead of a median when the curve never reaches half", () => {
    // Three open at 300d, one closed at 10d. S(10) = 1 - 1/4 = 0.75, and the curve stops
    // there: no median, so the longest observed time is published as the bound.
    const rows = [
      row({ repo_id: "r1", status: "RESOLVED", mttr_days: 10, age_days: null, resolved_at: "2026-01-01T00:00:00Z" }),
      row({ repo_id: "r1", age_days: 300 }),
      row({ repo_id: "r1", age_days: 300 }),
      row({ repo_id: "r1", age_days: 300 }),
    ];
    const overall = assetProfile(rows, { now: NOW, observedFrom: null }).rows.find(
      (r) => r.asset_group === OVERALL,
    )!;
    expect(overall.km_median_days).toBeNull();
    expect(overall.km_median_lower_bound).toBe(300);
  });

  it("DIVERGENCE: a status-resolved row with no mttr_days but an age_days is not censored", () => {
    // brick's `km_curve` reads `coalesce(mttr_days, age_days)` and never a status, so it would
    // censor this row at 300d; `remediation.kaplanMeier` gates the censored branch on the row
    // being OPEN, so it drops out of the risk set entirely. The shape cannot occur in either
    // ledger — brick's `_with_durations` (metrics.py:317-322) writes `age_days` only where
    // `resolved_at` is NULL — so this pins which behaviour ships, not which is right.
    const rows = [
      row({ repo_id: "r1", status: "RESOLVED", mttr_days: 10, age_days: null, resolved_at: "2026-01-01T00:00:00Z" }),
      row({ repo_id: "r1", status: "RESOLVED", mttr_days: null, age_days: 300, resolved_at: null }),
    ];
    const overall = assetProfile(rows, { now: NOW, observedFrom: null }).rows.find(
      (r) => r.asset_group === OVERALL,
    )!;
    // One event at 10d over a risk set of one: S(10) = 0, so the median IS 10.
    // Under brick's rule the risk set would be two, S(10) = 0.5, and the median still 10 —
    // but the restriction time would be 300 rather than 10, which the lower bound would show.
    expect(overall.km_median_days).toBe(10);
    expect(overall.km_median_lower_bound).toBeNull();
  });
});

describe("refusals", () => {
  it("refuses an unparseable clock rather than publishing window_months = 1", () => {
    expect(() => assetProfile([], { now: "not-a-date", observedFrom: null })).toThrow(/now/);
    expect(() =>
      assetProfile([], { now: NOW, observedFrom: "not-a-date" }),
    ).toThrow(/observedFrom/);
  });

  it("still emits an OVERALL row for an empty register", () => {
    const out = assetProfile([], { now: NOW, observedFrom: null });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.asset_group).toBe(OVERALL);
    expect(out.rows[0]!.assets).toBe(0);
    expect(out.rows[0]!.density_p50).toBeNull();
    expect(out.rows[0]!.assets_with_high_risk_pct).toBeNull(); // safe_pct over 0 assets
  });
});
