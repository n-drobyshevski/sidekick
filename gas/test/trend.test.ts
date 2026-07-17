import { describe, expect, it } from "vitest";
import {
  openBySeverityTrend, trendFromBase, trendFromFrames, withOpenPastSla, withTailMedian,
} from "../src/domain/trend";
import { expectParity, fixture } from "./helpers";

describe("trendFromFrames (fixture parity)", () => {
  const fx = fixture("trend");
  it("matches the unscoped Python trend", () => {
    expectParity(trendFromFrames(fx.scans, fx.base), fx.expected.all);
  });
  it("matches the CRITICAL+HIGH scoped trend", () => {
    expectParity(
      trendFromFrames(fx.scans, fx.base, ["CRITICAL", "HIGH"]),
      fx.expected.scoped_critical_high,
    );
  });
  it("returns [] for empty inputs", () => {
    expectParity(trendFromFrames([], fx.base), []);
    expectParity(trendFromFrames(fx.scans, []), []);
  });
});

describe("openBySeverityTrend", () => {
  // Two flat scans a day apart. A CRITICAL first seen before scan 1 and resolved
  // between the two must read open at scan 1, resolved (absent) at scan 2. A HIGH
  // first seen before both and never resolved stays open at both. A LOW first seen
  // only after scan 1 appears at scan 2 alone.
  const scans = [
    { ts: "2026-01-01T00:00:00Z", shape: "flat" },
    { ts: "2026-01-02T00:00:00Z", shape: "flat" },
  ];
  const base = [
    { severity: "CRITICAL", first_seen: "2025-12-31T00:00:00Z", resolved_at: "2026-01-01T12:00:00Z" },
    { severity: "HIGH", first_seen: "2025-12-30T00:00:00Z", resolved_at: null },
    { severity: "LOW", first_seen: "2026-01-01T06:00:00Z", resolved_at: null },
  ];

  it("counts open per severity as of each flat scan", () => {
    const out = openBySeverityTrend(scans, base);
    expect(out).toEqual([
      { date: "2026-01-01T00:00:00Z", bySev: { CRITICAL: 1, HIGH: 1 } },
      { date: "2026-01-02T00:00:00Z", bySev: { HIGH: 1, LOW: 1 } },
    ]);
  });

  it("restricts to the requested severities (+ UNKNOWN)", () => {
    const out = openBySeverityTrend(scans, base, ["HIGH"]);
    expect(out).toEqual([
      { date: "2026-01-01T00:00:00Z", bySev: { HIGH: 1 } },
      { date: "2026-01-02T00:00:00Z", bySev: { HIGH: 1 } },
    ]);
  });

  it("ignores non-flat scans and returns [] for empty inputs", () => {
    expect(openBySeverityTrend([{ ts: "2026-01-01T00:00:00Z", shape: "grouped" }], base)).toEqual([]);
    expect(openBySeverityTrend([], base)).toEqual([]);
    expect(openBySeverityTrend(scans, [])).toEqual([]);
  });
});

describe("trendFromBase (backfill)", () => {
  // One real scan on Jul 6. Two findings first seen in June (Jun 6, Jun 20); one critical is
  // API-resolved Jul 6 with a 2-day span. Backfill should reconstruct a daily backbone from
  // Jun 6 up to (excluding) Jul 6, tagged reconstructed, with exact cumulative open counts.
  const scans = [{ ts: "2026-07-06T10:00:00Z", shape: "flat" }];
  const base = [
    { severity: "HIGH", first_seen: "2026-06-06T00:00:00Z", resolved_at: null, mttr_days: null },
    { severity: "MEDIUM", first_seen: "2026-06-20T00:00:00Z", resolved_at: null, mttr_days: null },
    {
      severity: "CRITICAL", first_seen: "2026-07-04T00:00:00Z",
      resolved_at: "2026-07-06T00:00:00Z", mttr_days: 2,
    },
  ];

  it("with backfill off is exactly trendFromFrames, all reconstructed:false", () => {
    const out = trendFromBase(scans, base);
    expect(out.length).toBe(1);
    expect(out[0].date).toBe("2026-07-06T10:00:00Z");
    expect(out[0].reconstructed).toBe(false);
    const { reconstructed, ...bare } = out[0];
    expect([bare]).toEqual(trendFromFrames(scans, base));
  });

  it("reconstructs a daily backbone from the earliest first_seen to the first scan", () => {
    const out = trendFromBase(scans, base, null, { backfill: true });
    // 30 synthetic days (Jun 6 .. Jul 5 inclusive) + 1 real scan.
    expect(out[0].date).toBe("2026-06-06T00:00:00Z");
    expect(out.filter((p) => p.reconstructed).length).toBe(30);
    expect(out.filter((p) => !p.reconstructed).length).toBe(1);
    expect(out[out.length - 1].date).toBe("2026-07-06T10:00:00Z");
    expect(out[out.length - 1].reconstructed).toBe(false);
    // Open counts are the exact cumulative first_seen<=ts population.
    expect(out.find((p) => p.date === "2026-06-06T00:00:00Z")!.open).toBe(1);
    expect(out.find((p) => p.date === "2026-06-20T00:00:00Z")!.open).toBe(2);
  });

  it("does not backfill when the earliest first_seen is not before the first scan", () => {
    const laterBase = base.map((r) => ({ ...r, first_seen: "2026-07-06T00:00:00Z" }));
    const out = trendFromBase(scans, laterBase, null, { backfill: true });
    expect(out.length).toBe(1);
    expect(out.every((p) => !p.reconstructed)).toBe(true);
  });

  it("returns [] for empty inputs even with backfill on", () => {
    expect(trendFromBase([], base, null, { backfill: true })).toEqual([]);
    expect(trendFromBase(scans, [], null, { backfill: true })).toEqual([]);
  });
});

describe("withOpenPastSla", () => {
  // A CRITICAL (target 7) open all along, a HIGH resolved Jan 10, and an UNKNOWN (no
  // target) open all along, all first seen Jan 1. As of a given point date, "open past
  // SLA" counts findings open as-of that date whose age already exceeds their target.
  const base = [
    { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: null },
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-10T00:00:00Z" },
    { severity: "UNKNOWN", first_seen: "2026-01-01T00:00:00Z", resolved_at: null },
  ];

  it("counts open-past-SLA as of each point date and preserves existing fields", () => {
    // Jan 5: CRITICAL age 4d <= 7 -> none breached. Jan 15: CRITICAL age 14d > 7 -> 1
    // (HIGH is resolved by then; UNKNOWN has no target).
    const points = [
      { date: "2026-01-05T00:00:00Z", open: 99, foo: "a" },
      { date: "2026-01-15T00:00:00Z", open: 88, foo: "b" },
    ];
    expect(withOpenPastSla(points, base)).toEqual([
      { date: "2026-01-05T00:00:00Z", open: 99, foo: "a", open_past_sla: 0 },
      { date: "2026-01-15T00:00:00Z", open: 88, foo: "b", open_past_sla: 1 },
    ]);
  });

  it("scopes to the chosen severities plus UNKNOWN", () => {
    const b = [
      { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: null }, // 14d > 7 -> breached
      { severity: "MEDIUM", first_seen: "2025-11-01T00:00:00Z", resolved_at: null }, // ~75d > 30 -> breached
      { severity: "UNKNOWN", first_seen: "2026-01-01T00:00:00Z", resolved_at: null }, // no target
    ];
    const points = [{ date: "2026-01-15T00:00:00Z" }];
    // Unscoped: CRITICAL + MEDIUM breach = 2.
    expect(withOpenPastSla(points, b)[0].open_past_sla).toBe(2);
    // Scoped to CRITICAL: MEDIUM filtered out, UNKNOWN kept (but never breaches) -> 1.
    expect(withOpenPastSla(points, b, ["CRITICAL"])[0].open_past_sla).toBe(1);
  });

  it("a finding resolved before the point date drops out", () => {
    const b = [{ severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-10T00:00:00Z" }];
    // Jan 9: still open (resolved_at > d), age 8d > 7 -> breached.
    expect(withOpenPastSla([{ date: "2026-01-09T00:00:00Z" }], b)[0].open_past_sla).toBe(1);
    // Jan 20: resolved by then -> not open -> 0.
    expect(withOpenPastSla([{ date: "2026-01-20T00:00:00Z" }], b)[0].open_past_sla).toBe(0);
  });

  it("counts synthetic/reconstructed points the same as real ones (by date only)", () => {
    const b = [{ severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: null }];
    const points = [
      { date: "2026-01-15T00:00:00Z", reconstructed: true }, // synthetic backfill day
      { date: "2026-01-15T00:00:00Z", reconstructed: false }, // real saved scan, same date
    ];
    const out = withOpenPastSla(points, b);
    expect(out[0].open_past_sla).toBe(1);
    expect(out[1].open_past_sla).toBe(out[0].open_past_sla);
    // Passthrough keeps the reconstructed flag untouched.
    expect(out.map((p) => p.reconstructed)).toEqual([true, false]);
  });
});

describe("withTailMedian", () => {
  // Three resolutions with a 3-day threshold: 2d and 3.0d are fast lane (excluded — the
  // strict > dual of the fast lane's <=), 5d and 9d are tail. Resolution dates stagger so
  // the as-of pool grows point by point.
  const base = [
    { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-03T00:00:00Z", mttr_days: 2 },
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-04T00:00:00Z", mttr_days: 3 },
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-06T00:00:00Z", mttr_days: 5 },
    { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-10T00:00:00Z", mttr_days: 9 },
    { severity: "LOW", first_seen: "2026-01-01T00:00:00Z", resolved_at: null, mttr_days: null }, // open — never pooled
  ];

  it("pools only tail resolutions resolved by each point date; null before any", () => {
    const points = [
      { date: "2026-01-05T00:00:00Z", foo: "a" }, // only fast-lane resolutions so far
      { date: "2026-01-07T00:00:00Z", foo: "b" }, // tail pool [5]
      { date: "2026-01-15T00:00:00Z", foo: "c" }, // tail pool [5, 9]
    ];
    expect(withTailMedian(points, base, 3)).toEqual([
      { date: "2026-01-05T00:00:00Z", foo: "a", tail_median_days: null },
      { date: "2026-01-07T00:00:00Z", foo: "b", tail_median_days: 5 },
      { date: "2026-01-15T00:00:00Z", foo: "c", tail_median_days: 7 }, // median [5, 9]
    ]);
  });

  it("threshold boundary: mttr exactly == threshold stays fast lane (excluded)", () => {
    const b = [{ severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-04T00:00:00Z", mttr_days: 3 }];
    expect(withTailMedian([{ date: "2026-01-15T00:00:00Z" }], b, 3)[0].tail_median_days).toBeNull();
    // Just over the threshold joins the tail.
    expect(withTailMedian([{ date: "2026-01-15T00:00:00Z" }],
      [{ ...b[0], mttr_days: 3.001 }], 3)[0].tail_median_days).toBe(3.001);
  });

  it("scopes to the chosen severities plus UNKNOWN", () => {
    const b = [
      { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-10T00:00:00Z", mttr_days: 9 },
      { severity: "MEDIUM", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-06T00:00:00Z", mttr_days: 5 },
      { severity: "UNKNOWN", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-14T00:00:00Z", mttr_days: 13 },
    ];
    const points = [{ date: "2026-01-15T00:00:00Z" }];
    // Unscoped: pool [9, 5, 13] -> median 9. Scoped to CRITICAL: UNKNOWN kept -> [9, 13] -> 11.
    expect(withTailMedian(points, b, 3)[0].tail_median_days).toBe(9);
    expect(withTailMedian(points, b, 3, ["CRITICAL"])[0].tail_median_days).toBe(11);
  });

  it("rounds like trendFromFrames (3 decimals)", () => {
    const b = [
      { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-06T00:00:00Z", mttr_days: 5.0004 },
      { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-06T00:00:00Z", mttr_days: 5.0006 },
    ];
    expect(withTailMedian([{ date: "2026-01-15T00:00:00Z" }], b, 3)[0].tail_median_days).toBe(5.001);
  });
});
