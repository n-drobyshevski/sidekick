// The AARS-severity trend: counting a distribution, and turning sync_history rows into
// the chart's series. The series can only ever be built forward, so the interesting cases
// are the rows that carry nothing to plot.

import { describe, expect, it } from "vitest";
import {
  TREND_SEVERITIES,
  aarsTrendFromHistory,
  countAarsSeverities,
  ruleChangePoints,
} from "../src/domain/aarsTrend";
import { AARS_SEVERITY_ORDER } from "../src/domain/config";
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
