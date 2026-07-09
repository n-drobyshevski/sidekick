import { describe, expect, it } from "vitest";
import { openBySeverityTrend, trendFromFrames } from "../src/domain/trend";
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
