// The AARS-severity trend: counting a distribution, and turning sync_history rows into
// the chart's series. The series can only ever be built forward, so the interesting cases
// are the rows that carry nothing to plot.

import { describe, expect, it } from "vitest";
import {
  COUNT_KEYS,
  TREND_SEVERITIES,
  aarsTrendFromHistory,
  countAarsSeverities,
  countProjectTotals,
  countTrendFromHistory,
  problemTrendFromHistory,
  ruleChangePoints,
} from "../src/domain/aarsTrend";
import { AARS_SEVERITY_ORDER } from "../src/domain/config";
import { OUTCOME_VALUES } from "../src/domain/problem";
import type { Rec } from "../src/domain/util";

function row(over: Rec): Rec {
  return { status: "SUCCESS", finished_at: "2026-06-20T05:00:00Z", ...over };
}
const counts = (o: Record<string, number>) => JSON.stringify(o);

describe("countAarsSeverities", () => {
  it("counts every level and reports the empty ones as 0, not as absent", () => {
    const got = countAarsSeverities([
      { aarsSeverity: "CRITICAL" },
      { aarsSeverity: "HIGH" },
      { aarsSeverity: "HIGH" },
      { aarsSeverity: "INFO" },
    ]);
    expect(got).toEqual({ CRITICAL: 1, HIGH: 2, MEDIUM: 0, LOW: 0, INFO: 1 });
    expect(Object.keys(got).sort()).toEqual([...AARS_SEVERITY_ORDER].sort());
  });

  it("drops unscored assets rather than inventing a level for them", () => {
    expect(countAarsSeverities([{}, { aarsSeverity: undefined }, { aarsSeverity: "" }]))
      .toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });
  });

  it("still counts a pre-rename MINIMAL, as the INFO it now is", () => {
    expect(countAarsSeverities([{ aarsSeverity: "MINIMAL" }]).INFO).toBe(1);
  });
});

describe("aarsTrendFromHistory", () => {
  it("builds one chronological point per successful sync", () => {
    const points = aarsTrendFromHistory([
      row({ finished_at: "2026-06-22T05:00:00Z", aars_severity_json: counts({ HIGH: 3 }) }),
      row({ finished_at: "2026-06-20T05:00:00Z", aars_severity_json: counts({ HIGH: 1 }) }),
      row({ finished_at: "2026-06-21T05:00:00Z", aars_severity_json: counts({ HIGH: 2 }) }),
    ]);
    expect(points.map((p) => p.counts.HIGH)).toEqual([1, 2, 3]);
  });

  it("skips a sync recorded before the column existed, rather than plotting zero", () => {
    // Charting a missing distribution as 0 would draw a cliff that never happened.
    const points = aarsTrendFromHistory([
      row({ finished_at: "2026-06-20T05:00:00Z" }),
      row({ finished_at: "2026-06-21T05:00:00Z", aars_severity_json: counts({ HIGH: 4 }) }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].counts.HIGH).toBe(4);
  });

  it("ignores failed syncs and unreadable or non-object payloads", () => {
    const points = aarsTrendFromHistory([
      row({ status: "ERROR", aars_severity_json: counts({ HIGH: 9 }) }),
      row({ finished_at: "2026-06-21T05:00:00Z", aars_severity_json: "{not json" }),
      row({ finished_at: "2026-06-22T05:00:00Z", aars_severity_json: "[1,2,3]" }),
      row({ finished_at: "2026-06-23T05:00:00Z", aars_severity_json: counts({ HIGH: 4 }) }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].at).toBe("2026-06-23T05:00:00Z");
  });

  it("coerces junk counts to 0 and fills in levels the payload omits", () => {
    const [p] = aarsTrendFromHistory([
      row({ aars_severity_json: JSON.stringify({ CRITICAL: "x", HIGH: -3, LOW: 2.7 }) }),
    ]);
    expect(p.counts).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 2, INFO: 0 });
  });

  it("falls back to started_at, and skips a row with no usable timestamp", () => {
    const points = aarsTrendFromHistory([
      row({ finished_at: "", started_at: "2026-06-19T05:00:00Z", aars_severity_json: counts({ LOW: 1 }) }),
      row({ finished_at: "", started_at: "", aars_severity_json: counts({ LOW: 2 }) }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].at).toBe("2026-06-19T05:00:00Z");
  });

  it("keeps the most recent points when the ledger outgrows the window", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({
        finished_at: `2026-06-${String(10 + i).padStart(2, "0")}T05:00:00Z`,
        aars_severity_json: counts({ HIGH: i }),
      }));
    const points = aarsTrendFromHistory(rows, 3);
    expect(points.map((p) => p.counts.HIGH)).toEqual([7, 8, 9]);
  });

  it("returns nothing for an empty ledger", () => {
    expect(aarsTrendFromHistory([])).toEqual([]);
  });
});

describe("TREND_SEVERITIES", () => {
  it("charts every level except INFO, worst first", () => {
    expect(TREND_SEVERITIES).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect(TREND_SEVERITIES).not.toContain("INFO");
    // The charted levels stay a subset of the scale, in the scale's own order.
    expect([...TREND_SEVERITIES]).toEqual(
      AARS_SEVERITY_ORDER.filter((s) => TREND_SEVERITIES.includes(s)),
    );
  });
});

describe("rule version on a trend point", () => {
  const at = (d: string) => `2026-06-${d}T05:00:00Z`;
  const pt = (d: string, v?: unknown) =>
    row({ finished_at: at(d), aars_severity_json: counts({ CRITICAL: 1 }), aars_rule_version: v });

  it("reads a row written before the column existed as version 0 — which it was", () => {
    expect(aarsTrendFromHistory([pt("20")])[0].ruleVersion).toBe(0);
  });

  it("carries the recorded version, and rejects a nonsense one rather than trusting it", () => {
    expect(aarsTrendFromHistory([pt("20", 3)])[0].ruleVersion).toBe(3);
    expect(aarsTrendFromHistory([pt("20", "x")])[0].ruleVersion).toBe(0);
    expect(aarsTrendFromHistory([pt("20", -1)])[0].ruleVersion).toBe(0);
  });

  it("marks each point where the model changed, and never the first", () => {
    const points = aarsTrendFromHistory([pt("20", 0), pt("21", 0), pt("22", 1), pt("23", 1)]);
    expect(ruleChangePoints(points)).toEqual([2]);
  });

  it("marks nothing when one model scored the whole window", () => {
    expect(ruleChangePoints(aarsTrendFromHistory([pt("20", 2), pt("21", 2)]))).toEqual([]);
    expect(ruleChangePoints([])).toEqual([]);
  });

  it("marks every change, including a rule that was reverted", () => {
    const points = aarsTrendFromHistory([pt("20", 1), pt("21", 2), pt("22", 1)]);
    expect(ruleChangePoints(points)).toEqual([1, 2]);
  });
});

// The problem-outcome series: `trendFromHistory` bound to a different vocabulary and a
// different pair of columns. Not a repeat of every case above — that would be exactly the
// fork this generalisation exists to avoid — just enough to pin that the SAME machinery
// answers for the second series: the skip-before-the-column rule, the rule-version
// leniency, and the window/limit behaviour.
describe("problemTrendFromHistory", () => {
  const outcomeRow = (over: Rec): Rec => ({ status: "SUCCESS", finished_at: "2026-06-20T05:00:00Z", ...over });
  const outcomeCounts = (o: Record<string, number>) => JSON.stringify(o);

  it("builds one chronological point per successful sync, over the outcome vocabulary", () => {
    const points = problemTrendFromHistory([
      outcomeRow({ finished_at: "2026-06-21T05:00:00Z", problem_outcome_json: outcomeCounts({ ACT: 2 }) }),
      outcomeRow({ finished_at: "2026-06-20T05:00:00Z", problem_outcome_json: outcomeCounts({ ACT: 1 }) }),
    ]);
    expect(points.map((p) => p.counts.ACT)).toEqual([1, 2]);
    expect(Object.keys(points[0].counts).sort()).toEqual([...OUTCOME_VALUES].sort());
  });

  it("skips a sync recorded before the column existed, rather than plotting zero", () => {
    const points = problemTrendFromHistory([
      outcomeRow({ finished_at: "2026-06-20T05:00:00Z" }),
      outcomeRow({ finished_at: "2026-06-21T05:00:00Z", problem_outcome_json: outcomeCounts({ ACT: 4 }) }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].counts.ACT).toBe(4);
  });

  it("reads an absent rule version as 0, and marks a change under its own column", () => {
    const points = problemTrendFromHistory([
      outcomeRow({ finished_at: "2026-06-20T05:00:00Z", problem_outcome_json: outcomeCounts({ TRACK: 1 }) }),
      outcomeRow({
        finished_at: "2026-06-21T05:00:00Z",
        problem_outcome_json: outcomeCounts({ TRACK: 2 }),
        problem_rule_version: 1,
      }),
    ]);
    expect(points.map((p) => p.ruleVersion)).toEqual([0, 1]);
    expect(ruleChangePoints(points)).toEqual([1]);
  });

  it("is independent of the AARS series — an aars_severity_json-only row contributes nothing here", () => {
    const rows = [
      outcomeRow({
        finished_at: "2026-06-20T05:00:00Z",
        aars_severity_json: JSON.stringify({ HIGH: 3 }),
        // No problem_outcome_json on this row at all.
      }),
    ];
    expect(aarsTrendFromHistory(rows)).toHaveLength(1);
    expect(problemTrendFromHistory(rows)).toHaveLength(0);
  });
});

// The count trend — the series the inventory draws now that no page charts a band
// distribution. Its whole contract is that the three series entered the ledger at
// different times, so "absent" must survive all the way to the chart.
describe("countTrendFromHistory", () => {
  const cRow = (over: Rec): Rec => ({
    status: "SUCCESS", finished_at: "2026-06-20T05:00:00Z", ...over,
  });

  it("reads the three columns into one point", () => {
    const points = countTrendFromHistory([
      cRow({ issue_count: 32, finding_count: 17, posture_fail_count: 9 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].counts).toEqual({ issues: 32, findings: 17, postureFails: 9 });
  });

  it("plots a pre-column sync as a GAP per series, never as zero", () => {
    // The case the whole nullable-per-series design exists for: `issue_count` predates the
    // other two columns, so an old row has issues and nothing else. Reading the absent
    // ones as 0 would draw a landscape with no failing controls until the day we started
    // counting them.
    const points = countTrendFromHistory([
      cRow({ finished_at: "2026-06-19T05:00:00Z", issue_count: 30 }),
      cRow({ finished_at: "2026-06-20T05:00:00Z", issue_count: 32, finding_count: 17, posture_fail_count: 9 }),
    ]);
    expect(points).toHaveLength(2);
    expect(points[0].counts).toEqual({ issues: 30, findings: null, postureFails: null });
    expect(points[1].counts.findings).toBe(17);
  });

  it("reads a sync that collected no posture as null, not as zero failing policies", () => {
    const points = countTrendFromHistory([
      cRow({ issue_count: 4, finding_count: 2, posture_fail_count: null }),
    ]);
    expect(points[0].counts.postureFails).toBeNull();
    expect(points[0].counts.findings).toBe(2);
  });

  it("skips a row with nothing to plot, and non-SUCCESS rows", () => {
    expect(countTrendFromHistory([cRow({})])).toHaveLength(0);
    expect(countTrendFromHistory([cRow({ status: "ERROR", issue_count: 5 })])).toHaveLength(0);
  });

  it("orders by timestamp and keeps the most recent `limit` points", () => {
    const points = countTrendFromHistory([
      cRow({ finished_at: "2026-06-21T05:00:00Z", issue_count: 3 }),
      cRow({ finished_at: "2026-06-19T05:00:00Z", issue_count: 1 }),
      cRow({ finished_at: "2026-06-20T05:00:00Z", issue_count: 2 }),
    ], 2);
    expect(points.map((p) => p.counts.issues)).toEqual([2, 3]);
  });

  it("scoped to a project, reads the scoped counts and refuses a posture number", () => {
    // Posture has no project grain at all (Wiz reports it per framework/subcategory/policy,
    // never per resource), so a scoped series must go null rather than quietly showing the
    // whole landscape's failing policies under a project filter.
    const totals = countProjectTotals(
      [{ id: "a", projects: [{ id: "p1" }], aarsSeverity: "HIGH" }],
      [{ assetId: "a", problemOutcome: "ACT" }, { resourceId: "a" }],
    );
    const points = countTrendFromHistory([
      cRow({
        issue_count: 99, finding_count: 99, posture_fail_count: 99,
        project_totals_json: JSON.stringify(totals),
      }),
    ], 90, "p1");
    expect(points[0].counts).toEqual({ issues: 1, findings: 1, postureFails: null });
  });

  it("scoped to a project with no entry at that sync plots nothing", () => {
    const points = countTrendFromHistory([
      cRow({ issue_count: 12, project_totals_json: JSON.stringify({}) }),
    ], 90, "p1");
    expect(points).toHaveLength(0);
  });

  it("COUNT_KEYS is the vocabulary every point carries", () => {
    const points = countTrendFromHistory([cRow({ issue_count: 1 })]);
    expect(Object.keys(points[0].counts).sort()).toEqual([...COUNT_KEYS].sort());
  });
});
