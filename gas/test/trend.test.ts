import { describe, expect, it } from "vitest";
import { openBySeverityTrend, trendFromBase, trendFromFrames } from "../src/domain/trend";
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
