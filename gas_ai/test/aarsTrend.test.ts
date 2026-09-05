// The AARS-severity trend: counting a distribution, and turning sync_history rows into
// the chart's series. The series can only ever be built forward, so the interesting cases
// are the rows that carry nothing to plot.

import { describe, expect, it } from "vitest";
import {
  ADJACENCY_KEYS,
  CATEGORY_SPEC,
  COUNT_KEYS,
  LEDGER_KEYS,
  MIN_COMPARABLE_SYNCS,
  NET_CAPACITY_BAND_PCT,
  TREND_SEVERITIES,
  aarsTrendFromHistory,
  adjacencyTrendFromHistory,
  capacityFromLedgerDeltas,
  categorySpecFor,
  categoryTrendFromHistory,
  countAarsSeverities,
  countIssueCategories,
  countProjectTotals,
  countTrendFromHistory,
  exploitationTrendFromHistory,
  labelCategories,
  ledgerTrendFromHistory,
  problemTrendFromHistory,
  ruleChangePoints,
} from "../src/domain/aarsTrend";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";
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

// The stored count and the live count are ONE claim, and this is the test that says so.
// Written because they were not: `posture_fail_count` first counted the raw policy rows
// and read 9 against the KPI's 5, because the 5Rs rules nothing has judged AI-relevant are
// dropped before the live count. Nothing failed — the trend would simply have drawn its
// posture line at a level the number above it never showed.
describe("the count trend agrees with the KPIs beside it", () => {
  it("stores exactly what the live KPIs report, for all three series", async () => {
    const { bootServer, teardownServer } = await import("./gasEnv");
    const server = await bootServer();
    try {
      server.setup();
      const sync = server.api.runSync({}) as { ok: boolean; error?: string };
      expect(sync.ok, sync.error).toBe(true);

      const assets = server.api.getAssets({}) as { ok: boolean; data: Rec };
      const kpis = assets.data["kpis"] as Rec;
      const trend = assets.data["countTrend"] as Array<{ counts: Record<string, number | null> }>;
      const last = trend[trend.length - 1]!.counts;

      expect(last["issues"]).toBe(kpis["openIssues"]);
      expect(last["findings"]).toBe(kpis["complianceGaps"]);
      const posture = kpis["frameworkPosture"] as { failingPolicies: number };
      expect(last["postureFails"]).toBe(posture.failingPolicies);
    } finally {
      teardownServer();
    }
  });
});

// ------------------------------------------------------------------ the posture series
//
// Four more specs on the same `trendFromHistory` machinery. Not a repeat of every case the
// AARS block above already pins — that is the fork the generalisation exists to prevent —
// but each one is held to the rule the whole file is about: a sync recorded before the
// column existed is SKIPPED, never plotted as zero.

describe("the posture specs skip a sync recorded before their column existed", () => {
  const pre = (at: string): Rec => row({ finished_at: at });

  it("adjacency: a pre-column row is absent, not an all-UNLINKED register", () => {
    const points = adjacencyTrendFromHistory([
      pre("2026-06-20T05:00:00Z"),
      row({
        finished_at: "2026-06-21T05:00:00Z",
        adjacency_json: counts({ DIRECT: 4, ADJACENT: 2, UNLINKED: 26, edgesKnown: 68 }),
      }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].counts).toEqual({ DIRECT: 4, ADJACENT: 2, UNLINKED: 26 });
  });

  it("exploitation: a sync whose evidence pass did not run plots nothing", () => {
    // `exploitation_json` is null on a refused VULN_FINDINGS step. Five zeroes there would
    // say the register holds nothing exploitable; it says nobody asked.
    const points = exploitationTrendFromHistory([
      row({ finished_at: "2026-06-20T05:00:00Z", exploitation_json: null }),
      row({
        finished_at: "2026-06-21T05:00:00Z",
        exploitation_json: counts({ kev: 1, exploit: 0, epss: 2, none: 20, unknown: 9 }),
      }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].counts).toEqual({ kev: 1, exploit: 0, epss: 2, none: 20, unknown: 9 });
  });

  it("ledger: three transitions, and `carried` / `skippedNarrowedScope` are not series", () => {
    const points = ledgerTrendFromHistory([
      pre("2026-06-20T05:00:00Z"),
      row({
        finished_at: "2026-06-21T05:00:00Z",
        ledger_json: counts({
          new: 3, resolved: 2, reopened: 1, carried: 40, skippedNarrowedScope: 7,
        }),
      }),
    ]);
    expect(points).toHaveLength(1);
    // The two omitted keys are a deliberate exclusion, not an oversight: neither is a
    // movement in the open population, and `skippedNarrowedScope` decides comparability
    // instead (capacityFromLedgerDeltas).
    expect(points[0].counts).toEqual({ new: 3, resolved: 2, reopened: 1 });
    expect(Object.keys(points[0].counts).sort()).toEqual([...LEDGER_KEYS].sort());
  });

  it("category: a pre-column row is absent for every category at once", () => {
    const points = categoryTrendFromHistory([
      pre("2026-06-20T05:00:00Z"),
      row({
        finished_at: "2026-06-21T05:00:00Z",
        category_counts_json: counts({ "wct-id-1998": 99, "wct-id-3": 677 }),
      }),
    ], ["wct-id-1998", "wct-id-3"]);
    expect(points).toHaveLength(1);
    expect(points[0].counts).toEqual({ "wct-id-1998": 99, "wct-id-3": 677 });
  });
});

describe("the adjacency annotation — the denominator rides beside the counts", () => {
  it("carries edgesKnown as an annotation and never as a fourth series", () => {
    // 68 asset edges on the reference tenant is why: an UNLINKED count with no edge count
    // beside it reads as "unrelated" when it means "not traversed". A fourth LINE would put
    // a count of edges on an axis counting issues, which is the other way to lose it.
    const [p] = adjacencyTrendFromHistory([
      row({ adjacency_json: counts({ DIRECT: 4, ADJACENT: 2, UNLINKED: 26, edgesKnown: 68 }) }),
    ]);
    expect(p.annotations).toEqual({ edgesKnown: 68 });
    expect(Object.keys(p.counts).sort()).toEqual([...ADJACENCY_KEYS].sort());
    expect(Object.keys(p.counts)).not.toContain("edgesKnown");
  });

  it("reads an absent edgesKnown as NULL, not as zero edges known", () => {
    const [p] = adjacencyTrendFromHistory([
      row({ adjacency_json: counts({ DIRECT: 1, ADJACENT: 0, UNLINKED: 3 }) }),
    ]);
    expect(p.annotations).toEqual({ edgesKnown: null });
    // The counts are still a measurement — only the denominator is missing.
    expect(p.counts).toEqual({ DIRECT: 1, ADJACENT: 0, UNLINKED: 3 });
  });

  it("keeps a MEASURED zero denominator, which is a different claim", () => {
    // A register whose graph holds no adjacency edges at all: the walk ran and had nothing
    // to walk. That is a finding, and it must not read like a row that never recorded one.
    const [p] = adjacencyTrendFromHistory([
      row({ adjacency_json: counts({ DIRECT: 0, ADJACENT: 0, UNLINKED: 30, edgesKnown: 0 }) }),
    ]);
    expect(p.annotations).toEqual({ edgesKnown: 0 });
  });

  it("gives the exploitation series its own three, and the two older specs none at all", () => {
    const [x] = exploitationTrendFromHistory([
      row({
        exploitation_json: counts({
          kev: 1, exploit: 0, epss: 2, none: 20, unknown: 9,
          findings: 412, unjoined: 3, droppedNotInRegister: 11,
        }),
      }),
    ]);
    expect(x.annotations).toEqual({ findings: 412, unjoined: 3, droppedNotInRegister: 11 });
    // The two specs that predate annotations produce a point with no such key — the same
    // object they produced before this existed.
    const [a] = aarsTrendFromHistory([row({ aars_severity_json: counts({ HIGH: 1 }) })]);
    expect("annotations" in a).toBe(false);
    const [o] = problemTrendFromHistory([row({ problem_outcome_json: counts({ ACT: 1 }) })]);
    expect("annotations" in o).toBe(false);
  });
});

describe("the category series — a vocabulary decided at render time", () => {
  const cat = (o: Record<string, number>, at = "2026-06-20T05:00:00Z"): Rec =>
    row({ finished_at: at, category_counts_json: counts(o) });

  it("follows the list it is given, in that order, and ignores the rest of the cell", () => {
    // A category the register has stopped collecting is still in old rows. It is not drawn,
    // because the chart's vocabulary is the scope the register holds NOW.
    const points = categoryTrendFromHistory(
      [cat({ "wct-id-1998": 99, "wct-id-3": 677, "dropped-id": 5 })],
      ["wct-id-3", "wct-id-1998"],
    );
    expect(Object.keys(points[0].counts)).toEqual(["wct-id-3", "wct-id-1998"]);
    expect(points[0].counts).toEqual({ "wct-id-3": 677, "wct-id-1998": 99 });
  });

  it("reads a key the row never counted as NULL, never as zero", () => {
    // THE CASE THE SPARSE POINT EXISTS FOR. The second category was selected after this sync
    // ran, so that sync never collected it. Zero would say it looked and found none — and the
    // line would start at the bottom of the chart and climb, describing a category that grew
    // from nothing on the day it was switched on.
    const points = categoryTrendFromHistory(
      [cat({ "wct-id-1998": 99 }), cat({ "wct-id-1998": 97, "wct-id-3": 677 }, "2026-06-21T05:00:00Z")],
      ["wct-id-1998", "wct-id-3"],
    );
    expect(points.map((p) => p.counts["wct-id-3"])).toEqual([null, 677]);
    expect(points.map((p) => p.counts["wct-id-1998"])).toEqual([99, 97]);
  });

  it("keeps a measured zero, which IS a reading", () => {
    // The key is present and reads 0: this sync asked that category and got no open issues.
    const [p] = categoryTrendFromHistory([cat({ "wct-id-1998": 0 })], ["wct-id-1998"]);
    expect(p.counts["wct-id-1998"]).toBe(0);
  });

  it("skips a row that counted none of today's categories at all", () => {
    // Every key null is the same absence one grain up: there is nothing on this point to
    // draw, and a column of gaps under a legend is not a measurement.
    expect(categoryTrendFromHistory([cat({ "old-id": 4 })], ["wct-id-1998"])).toHaveLength(0);
  });

  it("charts nothing at all when the vocabulary is empty", () => {
    // Not one point per sync with no series on it, which would draw an empty chart with a
    // sync count under it — "measured, and there is nothing" instead of "nothing was asked".
    expect(categoryTrendFromHistory([cat({ "wct-id-1998": 4 })], [])).toEqual([]);
    expect(CATEGORY_SPEC.keys).toEqual([]);
    expect(categorySpecFor(["a", "b"]).keys).toEqual(["a", "b"]);
  });

  it("labels a known category by name and an unknown one by its own id", () => {
    // CANDIDATE_CATEGORIES is a candidate list, not a permitted set: a tenant may scope the
    // register to an id this build has never heard of, and that line still has to be findable.
    const labels = labelCategories([RISK_CATEGORY_ID, "8ee0e63e-not-a-known-id"]);
    expect(labels[0].name).toBe("AI Security");
    expect(labels[1]).toEqual({ id: "8ee0e63e-not-a-known-id", name: "8ee0e63e-not-a-known-id" });
  });
});

// The capacity readout: the ledger's own transition counts as a remediation programme
// figure. The verdict shape is ported from gas/'s capacityByMonth — three words and a named
// dead band — and everything about WHICH syncs count is this register's own, because here
// the sync is the interval.
describe("capacityFromLedgerDeltas", () => {
  const SCOPE_A = "wct-id-1998";
  const SCOPE_B = "wct-id-1998|wct-id-3";
  const deltas = (o: Partial<Record<string, number>>) => JSON.stringify({
    new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0, ...o,
  });
  /** One committed sync: day of June, scope, and its five transition counts. */
  const sync = (day: number, scope: string, d: Partial<Record<string, number>>): Rec => row({
    sync_id: `sync-${day}`,
    finished_at: `2026-06-${String(day).padStart(2, "0")}T05:00:00Z`,
    register_scope: scope,
    ledger_json: deltas(d),
  });

  it("publishes nothing off one sync — and the first sync is never comparable", () => {
    // Its `new` is the entire register arriving at once, and there is no previous row to
    // compare its scope against. Unknown is not "the same scope", which is the rule
    // reconcileIssueLedger already follows when no previous committed scope exists.
    const cap = capacityFromLedgerDeltas([sync(20, SCOPE_A, { new: 10 })]);
    expect(cap.points).toHaveLength(1);
    expect(cap.points[0].comparable).toBe(false);
    expect(cap.points[0].verdict).toBeNull();
    expect(cap.overall).toEqual({ mmcr: null, verdict: null, syncs: 1, comparable: 0 });
  });

  it("needs two COMPARABLE syncs, which takes three rows", () => {
    const rows = [
      sync(20, SCOPE_A, { new: 10 }),
      sync(21, SCOPE_A, { new: 2, resolved: 3, carried: 7 }),
      sync(22, SCOPE_A, { new: 3, resolved: 3, carried: 6 }),
    ];
    const cap = capacityFromLedgerDeltas(rows);
    expect(cap.points.map((p) => p.comparable)).toEqual([false, true, true]);
    // openAtStart = carried + resolved: 10, then 9. Close rates 30% and 33.33%.
    expect(cap.overall.mmcr).toBeCloseTo((30 + (3 / 9) * 100) / 2, 10);
    expect(cap.overall.syncs).toBe(3);
    expect(cap.overall.comparable).toBe(2);
    // Net +1 on ten open (10%) then 0 on nine: mean +5%, past the 2% band.
    expect(cap.overall.verdict).toBe("gaining");
    expect(cap.points[1]).toEqual({
      syncId: "sync-21", at: "2026-06-21T05:00:00Z",
      opened: 2, closed: 3, net: 1, comparable: true, verdict: "gaining",
    });
  });

  it("counts a REOPEN as work arriving, so the accounting identity holds", () => {
    // openAtEnd = openAtStart + opened - closed = (carried + resolved) + (new + reopened) -
    // resolved = carried + new + reopened, which is the population the sync ends with. A
    // reopened row re-enters the open register exactly as a new one does.
    const cap = capacityFromLedgerDeltas([
      sync(20, SCOPE_A, { new: 10 }),
      sync(21, SCOPE_A, { new: 1, reopened: 2, resolved: 4, carried: 6 }),
    ]);
    expect(cap.points[1].opened).toBe(3);
    expect(cap.points[1].closed).toBe(4);
    expect(cap.points[1].net).toBe(1);
  });

  it("excludes a sync that skipped disappearance-resolution, and counts the exclusion", () => {
    // skippedNarrowedScope > 0 means this sync deliberately resolved nothing by absence, so
    // its `closed` is understated by an amount nobody can recover. Still plotted — it
    // happened — but out of the mean, and its own verdict withheld rather than published
    // with a known direction of error.
    const cap = capacityFromLedgerDeltas([
      sync(20, SCOPE_A, { new: 10 }),
      sync(21, SCOPE_A, { new: 2, resolved: 3, carried: 7 }),
      sync(22, SCOPE_A, { new: 2, resolved: 0, carried: 9, skippedNarrowedScope: 40 }),
      sync(23, SCOPE_A, { new: 1, resolved: 2, carried: 8 }),
    ]);
    expect(cap.points.map((p) => p.comparable)).toEqual([false, true, false, true]);
    expect(cap.points[2].verdict).toBeNull();
    expect(cap.overall.syncs).toBe(4);
    expect(cap.overall.comparable).toBe(2);
  });

  it("excludes a sync whose register_scope moved, in either direction", () => {
    // A count taken over six categories is not comparable with one taken over one. The
    // WIDENING sync is the incomparable one; the sync after it, back on a stable scope, is
    // comparable again.
    const cap = capacityFromLedgerDeltas([
      sync(20, SCOPE_A, { new: 10 }),
      sync(21, SCOPE_A, { new: 2, resolved: 3, carried: 7 }),
      sync(22, SCOPE_B, { new: 90, resolved: 1, carried: 8 }),
      sync(23, SCOPE_B, { new: 4, resolved: 5, carried: 90 }),
    ]);
    expect(cap.points.map((p) => p.comparable)).toEqual([false, true, false, true]);
    expect(cap.overall.comparable).toBe(2);
    // And a row written before `register_scope` existed is UNKNOWN, not "the same scope".
    const legacy = capacityFromLedgerDeltas([
      sync(20, "", { new: 10 }),
      sync(21, "", { new: 2, resolved: 3, carried: 7 }),
      sync(22, "", { new: 2, resolved: 3, carried: 6 }),
    ]);
    expect(legacy.points.map((p) => p.comparable)).toEqual([false, false, false]);
    expect(legacy.overall).toEqual({ mmcr: null, verdict: null, syncs: 3, comparable: 0 });
  });

  it("puts the verdict bands at exactly ±2% of the open population", () => {
    // NET_CAPACITY_BAND_PCT, ported with its provenance: P2P v3 Fig. 22 splits firms without
    // a sharp cut, and a one-issue swing must not flip a verdict. On 100 open, net +2 is
    // still keeping up and net +3 is gaining.
    expect(NET_CAPACITY_BAND_PCT).toBe(2);
    const at = (d: Partial<Record<string, number>>) => capacityFromLedgerDeltas([
      sync(20, SCOPE_A, { new: 100 }),
      sync(21, SCOPE_A, d),
    ]).points[1].verdict;
    expect(at({ closed: 0, resolved: 4, new: 2, carried: 96 })).toBe("keeping-up");   // +2%
    expect(at({ resolved: 5, new: 2, carried: 95 })).toBe("gaining");                 // +3%
    expect(at({ resolved: 2, new: 4, carried: 98 })).toBe("keeping-up");              // -2%
    expect(at({ resolved: 2, new: 5, carried: 98 })).toBe("falling-behind");          // -3%
  });

  it("skips a sync recorded before the ledger existed, rather than reading five zeroes", () => {
    const cap = capacityFromLedgerDeltas([
      row({ finished_at: "2026-06-19T05:00:00Z", register_scope: SCOPE_A }),
      sync(20, SCOPE_A, { new: 10 }),
    ]);
    expect(cap.points.map((p) => p.syncId)).toEqual(["sync-20"]);
    expect(cap.overall.syncs).toBe(1);
  });

  it("reads a sync with nothing open at its start without inventing a rate", () => {
    // A register that has just been reset: openAtStart is 0, so there is no denominator and
    // no close rate. The point is still plotted and still comparable — the sync happened —
    // it simply contributes nothing to the mean.
    const cap = capacityFromLedgerDeltas([
      sync(20, SCOPE_A, {}),
      sync(21, SCOPE_A, { new: 5 }),
      sync(22, SCOPE_A, { new: 1, resolved: 2, carried: 3 }),
    ]);
    expect(cap.points[1].verdict).toBe("keeping-up");
    expect(cap.overall.comparable).toBe(2);
    // TWO comparable syncs and only ONE rate, which is what the mean is entitled to count.
    // The first cut of this gate read `comparable >= 2 && rates.length > 0` and published a
    // mean of that single observation; this case is what failed it.
    expect(cap.overall.mmcr).toBeNull();
    expect(MIN_COMPARABLE_SYNCS).toBe(2);
  });
});

describe("countIssueCategories", () => {
  it("counts a row once under EVERY category it carries", () => {
    // An issue matched by two selected categories arrives twice from the API and merges to
    // one row carrying both stamps, so it is counted under both. These counts deliberately
    // do not sum to the register total — an issue sits in roughly five categories on the
    // reference tenant — and a reader adding them up is measuring the overlap.
    const counted = countIssueCategories([
      { categories: ["wct-id-1998", "wct-id-3"] },
      { categories: ["wct-id-3"] },
    ]);
    expect(counted).toEqual({ "wct-id-1998": 1, "wct-id-3": 2 });
  });

  it("counts a doubled stamp once, and a row with no stamp not at all", () => {
    expect(countIssueCategories([{ categories: ["wct-id-3", "wct-id-3", ""] }]))
      .toEqual({ "wct-id-3": 1 });
    expect(countIssueCategories([{}, { categories: [] }])).toEqual({});
  });
});
