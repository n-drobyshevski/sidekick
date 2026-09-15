// Compliance posture over time: the cell the sync writes and the series the page reads back.
//
// ONE INVARIANT CARRIES THIS FILE, and it is the Compliance page's own, one dimension over:
// a posture that does not exist is never drawn as a zero. On a trend that rule has two
// faces, and each is a different silent failure:
//
//   1. A SYNC WITH NO CELL CONTRIBUTES NO POINT. Every column on `sync_history` was appended
//      without a migration, so the rows written before this one exist and have nothing in
//      it. Reading those as 0% would draw a landscape that was entirely non-compliant until
//      the day somebody started recording it, and then leapt to 94 — a remediation programme
//      that never happened, on a chart whose whole job is to say whether one is working.
//   2. A FRAMEWORK WITH NO SCORE BREAKS THE LINE. NO_RESOURCES and NO_POLICIES are the
//      opposite of "we checked and everything failed", and a null percentage plotted at the
//      floor says the second about a framework Wiz said the first of.
//
// The third thing under test is the COVERAGE travelling with the percentage. A framework
// percentage is a share of the subcategories Wiz scored, and the unscored ones are left out
// rather than counted as failures — so a line that rises because the landscape improved and
// one that rises because scoring narrowed are the same picture. `scored`/`subcategories` on
// every point is what tells them apart, and the assertions below pin that they survive the
// round trip through a sheet cell rather than being recomputed at read time from a
// denominator that has since moved.

import { describe, expect, it } from "vitest";

import { buildAllFrameworkTrees, complianceKpis } from "../src/domain/compliancePosture";
import {
  censusCompliancePosture,
  compliancePostureTrendFromHistory,
  COMPLIANCE_POSTURE_COLUMN,
  COMPLIANCE_POSTURE_MAX_CHARS,
  encodeCompliancePosture,
  LANDSCAPE_KEY,
} from "../src/domain/complianceTrend";
import type { FrameworkTree } from "../src/domain/compliancePosture";
import type { Rec } from "../src/domain/util";
import { normalizeCompliancePosturePage } from "../src/domain/syncNormalize";
import { AGENTIC_FRAMEWORK, FIVE_RS_FRAMEWORK } from "./frameworkPosture.fixture";

/** A tree with only the fields the census reads — everything else is the page's business. */
function tree(over: Partial<FrameworkTree> & { frameworkId: string }): FrameworkTree {
  return {
    name: over.frameworkId,
    posturePct: null,
    state: "scored",
    postureBand: null,
    emptyPostureReason: null,
    passSubCategoryCount: 0,
    failSubCategoryCount: 0,
    categories: [],
    stateCounts: { scored: 0, noResources: 0, noPolicies: 0, unknown: 0 },
    policyCount: 0,
    failingPolicyCount: 0,
    unassessedPolicyCount: 0,
    worstFailingSeverity: null,
    ...over,
  } as FrameworkTree;
}

/** A `sync_history` row carrying a census. Only the four fields the reader looks at. */
function row(at: string, cell: string | null, status = "SUCCESS"): Rec {
  return {
    status,
    started_at: at,
    finished_at: at,
    [COMPLIANCE_POSTURE_COLUMN]: cell,
  };
}

const scored = (id: string, pct: number, s: number, subs: number) => tree({
  frameworkId: id,
  posturePct: pct,
  state: "scored",
  stateCounts: { scored: s, noResources: subs - s, noPolicies: 0, unknown: 0 },
});

describe("censusCompliancePosture", () => {
  it("records each framework's percentage and the coverage it is a share of", () => {
    const census = censusCompliancePosture([scored("wf-a", 80, 4, 5), scored("wf-b", 100, 2, 2)]);
    expect(census.frameworks["wf-a"]).toEqual({ pct: 80, scored: 4, subcategories: 5 });
    expect(census.frameworks["wf-b"]).toEqual({ pct: 100, scored: 2, subcategories: 2 });
  });

  it("writes null, never 0, for a framework Wiz did not score", () => {
    // THE INVARIANT. `noResources` is "nothing in this landscape the checks apply to", which
    // a 0 in this cell would turn into "every check failed" on the next read, forever — the
    // cell is the only record and there is nothing to correct it against.
    const census = censusCompliancePosture([
      tree({
        frameworkId: "wf-empty",
        posturePct: null,
        state: "noResources",
        stateCounts: { scored: 0, noResources: 3, noPolicies: 0, unknown: 0 },
      }),
    ]);
    expect(census.frameworks["wf-empty"]!.pct).toBeNull();
    expect(census.avg).toBeNull();
    expect(census.scoredFrameworks).toBe(0);
  });

  it("means the SCORED frameworks only, and says how many that was", () => {
    const census = censusCompliancePosture([
      scored("wf-a", 80, 4, 5),
      scored("wf-b", 100, 2, 2),
      tree({ frameworkId: "wf-c", posturePct: null, state: "noPolicies" }),
    ]);
    expect(census.avg).toBe(90);
    // Without this the 90 is unreadable: a mean over two frameworks and a mean over three
    // are different claims, and the unscored one is NOT a zero dragging it down.
    expect(census.scoredFrameworks).toBe(2);
  });

  it("agrees with the page's own landscape figure, over the same rows", () => {
    // THE ONE ASSERTION THAT KEEPS TWO ARITHMETICS FROM DRIFTING. `complianceKpis` is what
    // the Overview hero prints; this census is what the chart under it draws. They are
    // computed by different code over different inputs (posture rows vs. built trees), and
    // the day they disagree the hero and the line beside it describe two landscapes.
    const posture = [
      ...normalizeCompliancePosturePage([AGENTIC_FRAMEWORK]).posture,
      ...normalizeCompliancePosturePage([FIVE_RS_FRAMEWORK]).posture,
    ];
    const trees = buildAllFrameworkTrees(posture, [], []);
    const kpis = complianceKpis(posture, []);
    const census = censusCompliancePosture(trees);
    expect(census.avg).toBe(kpis.averagePosture);
    expect(census.scoredFrameworks).toBe(kpis.scoredFrameworks);
  });
});

describe("encodeCompliancePosture", () => {
  it("round-trips through a cell", () => {
    const census = censusCompliancePosture([scored("wf-a", 80, 4, 5)]);
    const points = compliancePostureTrendFromHistory([
      row("2026-09-01T00:00:00.000Z", encodeCompliancePosture(census)),
      row("2026-09-02T00:00:00.000Z", encodeCompliancePosture(census)),
    ]);
    expect(points.map((p) => p.counts["wf-a"])).toEqual([80, 80]);
  });

  it("refuses rather than writing a cell the sheet would clip", () => {
    // A refusal costs one point on a chart. A clipped cell costs the sync: `appendRows`
    // would reject it, and a trend refinement must never be able to fail a commit.
    const many = Array.from({ length: 4_000 }, (_, i) => scored(`wf-${i}`, 90, 1, 1));
    const json = JSON.stringify(censusCompliancePosture(many));
    expect(json.length).toBeGreaterThan(COMPLIANCE_POSTURE_MAX_CHARS);
    expect(encodeCompliancePosture(censusCompliancePosture(many))).toBeNull();
  });
});

describe("compliancePostureTrendFromHistory", () => {
  const cellA = encodeCompliancePosture(censusCompliancePosture([
    scored("wf-a", 80, 4, 5), scored("wf-b", 100, 2, 2),
  ]));
  const cellB = encodeCompliancePosture(censusCompliancePosture([
    scored("wf-a", 90, 5, 5), scored("wf-b", 100, 2, 2),
  ]));

  it("returns one point per sync, oldest first, with the landscape mean beside each framework", () => {
    const points = compliancePostureTrendFromHistory([
      row("2026-09-02T00:00:00.000Z", cellB),
      row("2026-09-01T00:00:00.000Z", cellA),
    ]);
    expect(points.map((p) => p.at))
      .toEqual(["2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"]);
    expect(points.map((p) => p.counts["wf-a"])).toEqual([80, 90]);
    expect(points.map((p) => p.counts[LANDSCAPE_KEY])).toEqual([90, 95]);
  });

  it("SKIPS a sync recorded before the column existed — never plots it as zero", () => {
    // The regression this test exists for draws a cliff that never happened: every sync
    // before the upgrade at 0%, then a leap to 90. History cannot be backfilled from a
    // ledger that never held it, and saying so is the only honest answer.
    const points = compliancePostureTrendFromHistory([
      row("2026-08-01T00:00:00.000Z", null),
      row("2026-08-02T00:00:00.000Z", ""),
      row("2026-09-01T00:00:00.000Z", cellA),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("skips a failed sync and an unparseable cell rather than guessing at either", () => {
    const points = compliancePostureTrendFromHistory([
      row("2026-09-01T00:00:00.000Z", cellA, "ERROR"),
      row("2026-09-02T00:00:00.000Z", "{not json"),
      row("2026-09-03T00:00:00.000Z", cellB),
    ]);
    expect(points.map((p) => p.at)).toEqual(["2026-09-03T00:00:00.000Z"]);
  });

  it("carries a framework's null through as a gap, with the mean still drawn", () => {
    const cell = encodeCompliancePosture(censusCompliancePosture([
      scored("wf-a", 80, 4, 5),
      tree({
        frameworkId: "wf-b",
        posturePct: null,
        state: "noResources",
        stateCounts: { scored: 0, noResources: 2, noPolicies: 0, unknown: 0 },
      }),
    ]));
    const points = compliancePostureTrendFromHistory([
      row("2026-09-01T00:00:00.000Z", cell),
      row("2026-09-02T00:00:00.000Z", cell),
    ]);
    expect(points[0]!.counts["wf-b"]).toBeNull();
    expect(points[0]!.counts[LANDSCAPE_KEY]).toBe(80);
  });

  it("carries the coverage each percentage is a share of, framework and landscape alike", () => {
    const points = compliancePostureTrendFromHistory([row("2026-09-01T00:00:00.000Z", cellA)]);
    expect(points[0]!.coverage["wf-a"]).toEqual({ scored: 4, subcategories: 5 });
    // Summed across frameworks, with the count of frameworks the mean averaged — the
    // denominator the Overview hero already prints for the latest sync, now on every point.
    expect(points[0]!.coverage[LANDSCAPE_KEY])
      .toEqual({ scored: 6, subcategories: 7, scoredFrameworks: 2 });
  });

  it("keeps the most recent `limit` points, not the first", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`2026-09-0${i + 1}T00:00:00.000Z`, cellA));
    const points = compliancePostureTrendFromHistory(rows, 2);
    expect(points.map((p) => p.at))
      .toEqual(["2026-09-04T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]);
  });

  it("falls back to started_at when a sync recorded no finish time", () => {
    const points = compliancePostureTrendFromHistory([
      { status: "SUCCESS", started_at: "2026-09-01T00:00:00.000Z", finished_at: "",
        [COMPLIANCE_POSTURE_COLUMN]: cellA },
    ]);
    expect(points[0]!.at).toBe("2026-09-01T00:00:00.000Z");
  });
});
