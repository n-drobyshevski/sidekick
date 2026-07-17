import { describe, expect, it } from "vitest";
import {
  cohortSlaAttainment,
  medianMttrByGroupTrend,
  openByGroupTrend, openBySeverityTrend, trendFromBase, trendFromFrames,
  withKmMedian, withOpenPastSla, withSlaBurn,
} from "../src/domain/trend";
import type { Rec } from "../src/domain/util";
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

describe("openByGroupTrend", () => {
  // Two flat scans a day apart. keyOf reads the `asset` field; groups ["web", "db"] each
  // keep their own series, everything else folds into "Other".
  const scans = [
    { ts: "2026-01-01T00:00:00Z", shape: "flat" },
    { ts: "2026-01-02T00:00:00Z", shape: "flat" },
  ];
  const keyOf = (r: Rec) => String(r["asset"] ?? "");
  const groups = ["web", "db"];
  const open = (asset: unknown, over: Rec = {}) => ({
    asset, severity: "HIGH", first_seen: "2025-12-31T00:00:00Z", resolved_at: null, ...over,
  });

  it("returns [] with no scans or no base rows", () => {
    expect(openByGroupTrend([], [open("web")], keyOf, groups)).toEqual([]);
    expect(openByGroupTrend(scans, [], keyOf, groups)).toEqual([]);
  });

  it("counts open per group as of a single flat scan", () => {
    const base = [open("web"), open("web"), open("db")];
    expect(openByGroupTrend([scans[0]], base, keyOf, groups)).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: 2, db: 1 } },
    ]);
  });

  it("drops a row from its group at the scan after it resolves", () => {
    const base = [
      open("web", { resolved_at: "2026-01-01T12:00:00Z" }),
      open("db"),
    ];
    expect(openByGroupTrend(scans, base, keyOf, groups)).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: 1, db: 1 } },
      { date: "2026-01-02T00:00:00Z", byGroup: { db: 1 } },
    ]);
  });

  it("ignores non-flat scans (no flat scan -> [])", () => {
    expect(
      openByGroupTrend([{ ts: "2026-01-01T00:00:00Z", shape: "grouped" }], [open("web")], keyOf, groups),
    ).toEqual([]);
  });

  it("normalizes null / blank group values to (none)", () => {
    const base = [open(null), open(""), open("web")];
    // "(none)" only keeps its own series when it's one of the requested groups.
    expect(openByGroupTrend([scans[0]], base, keyOf, ["(none)", "web"])).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { "(none)": 2, web: 1 } },
    ]);
  });

  it("folds values outside groups into Other; includeOther:false drops them", () => {
    const base = [open("web"), open("cache"), open("queue")];
    expect(openByGroupTrend([scans[0]], base, keyOf, groups)).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: 1, Other: 2 } },
    ]);
    expect(openByGroupTrend([scans[0]], base, keyOf, groups, { includeOther: false })).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: 1 } },
    ]);
  });

  it("honors a custom otherLabel", () => {
    expect(
      openByGroupTrend([scans[0]], [open("cache")], keyOf, groups, { otherLabel: "Rest" }),
    ).toEqual([{ date: "2026-01-01T00:00:00Z", byGroup: { Rest: 1 } }]);
  });

  it("scopes to the chosen severities plus UNKNOWN", () => {
    const base = [
      open("web", { severity: "CRITICAL" }),
      open("web", { severity: "HIGH" }),   // filtered out when scoped to CRITICAL
      open("db", { severity: "UNKNOWN" }), // UNKNOWN is never hidden
    ];
    expect(openByGroupTrend([scans[0]], base, keyOf, groups, { severities: ["CRITICAL"] })).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: 1, db: 1 } },
    ]);
  });
});

describe("medianMttrByGroupTrend", () => {
  // Two flat scans a day apart. keyOf reads the `asset` field; groups ["web", "db"] each
  // keep their own series, everything else folds into "Other". `res` mints a resolved row
  // with a fixed mttr sample; resolved_at null (+ mttr null) is an open row.
  const scans = [
    { ts: "2026-01-01T00:00:00Z", shape: "flat" },
    { ts: "2026-01-02T00:00:00Z", shape: "flat" },
  ];
  const keyOf = (r: Rec) => String(r["asset"] ?? "");
  const groups = ["web", "db"];
  const res = (
    asset: unknown,
    mttr: number | null,
    resolved_at: string | null,
    over: Rec = {},
  ) => ({
    asset, severity: "HIGH", first_seen: "2025-12-31T00:00:00Z", resolved_at, mttr_days: mttr, ...over,
  });

  it("computes the exact median per group per ts (odd + even counts, 3-dp rounding)", () => {
    const base = [
      res("web", 2, "2026-01-01T00:00:00Z"),
      res("web", 9, "2026-01-01T00:00:00Z"),
      res("web", 4, "2026-01-01T00:00:00Z"),     // odd -> middle sample 4
      res("db", 1, "2026-01-01T00:00:00Z"),
      res("db", 1.3334, "2026-01-01T00:00:00Z"), // even -> (1 + 1.3334)/2 = 1.1667 -> 1.167
    ];
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups)).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 4, db: 1.167 } },
    ]);
  });

  it("emits null before a group's first resolution, then a number once one resolves <= ts", () => {
    // web resolves at noon on Jan 1 (after scan 1, before scan 2); db never resolves.
    const base = [res("web", 3, "2026-01-01T12:00:00Z")];
    expect(medianMttrByGroupTrend(scans, base, keyOf, groups)).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: null, db: null } },
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 3, db: null } },
    ]);
  });

  it("excludes rows resolved after ts, includes them (and the <= boundary) once resolved", () => {
    const base = [
      res("web", 5, "2026-01-01T00:00:00Z"),  // resolved exactly at scan 1 -> included (<=)
      res("web", 7, "2026-01-01T18:00:00Z"),  // resolved after scan 1 -> in only at scan 2
    ];
    expect(medianMttrByGroupTrend(scans, base, keyOf, groups)).toEqual([
      { date: "2026-01-01T00:00:00Z", byGroup: { web: 5, db: null } }, // just [5]
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 6, db: null } }, // median [5,7]
    ]);
  });

  it("never pools open rows or resolved rows without an mttr sample", () => {
    const base = [
      res("web", 4, "2026-01-01T00:00:00Z"),
      res("web", null, null),                   // still open -> skipped
      res("db", null, "2026-01-01T00:00:00Z"),  // resolved but mttr null -> skipped
    ];
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups)).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 4, db: null } },
    ]);
  });

  it("scopes to the chosen severities plus UNKNOWN", () => {
    const base = [
      res("web", 2, "2026-01-01T00:00:00Z", { severity: "CRITICAL" }),
      res("web", 10, "2026-01-01T00:00:00Z", { severity: "HIGH" }),   // filtered out
      res("db", 6, "2026-01-01T00:00:00Z", { severity: "UNKNOWN" }),  // never hidden
    ];
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups, { severities: ["CRITICAL"] })).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 2, db: 6 } },
    ]);
  });

  it("pools Other's median over the remainder (not a sum); includeOther:false drops; custom otherLabel", () => {
    const base = [
      res("web", 4, "2026-01-01T00:00:00Z"),
      res("cache", 2, "2026-01-01T00:00:00Z"),
      res("queue", 8, "2026-01-01T00:00:00Z"),
    ];
    // cache + queue fold to Other -> median([2, 8]) = 5, never the sum 10.
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups)).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 4, db: null, Other: 5 } },
    ]);
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups, { includeOther: false })).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 4, db: null } },
    ]);
    expect(
      medianMttrByGroupTrend(
        [scans[1]],
        [res("cache", 2, "2026-01-01T00:00:00Z"), res("queue", 8, "2026-01-01T00:00:00Z")],
        keyOf,
        groups,
        { otherLabel: "Rest" },
      ),
    ).toEqual([{ date: "2026-01-02T00:00:00Z", byGroup: { web: null, db: null, Rest: 5 } }]);
  });

  it("normalizes null / blank group values to (none)", () => {
    const base = [
      res(null, 3, "2026-01-01T00:00:00Z"),
      res("", 5, "2026-01-01T00:00:00Z"),
      res("web", 9, "2026-01-01T00:00:00Z"),
    ];
    // "(none)" only keeps its own series when it's one of the requested groups; median([3,5]) = 4.
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, ["(none)", "web"])).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { "(none)": 4, web: 9 } },
    ]);
  });

  it("ignores non-flat scans and returns [] for empty inputs", () => {
    expect(
      medianMttrByGroupTrend(
        [{ ts: "2026-01-01T00:00:00Z", shape: "grouped" }],
        [res("web", 3, "2026-01-01T00:00:00Z")],
        keyOf,
        groups,
      ),
    ).toEqual([]);
    expect(medianMttrByGroupTrend([], [res("web", 3, "2026-01-01T00:00:00Z")], keyOf, groups)).toEqual([]);
    expect(medianMttrByGroupTrend(scans, [], keyOf, groups)).toEqual([]);
  });

  it("minMttrDays drops fast-lane samples (mttr <= threshold), strictly", () => {
    const base = [
      res("web", 0.5, "2026-01-01T00:00:00Z"), // fast lane — dropped
      res("web", 1, "2026-01-01T00:00:00Z"),   // exactly at threshold — dropped (strict >)
      res("web", 6, "2026-01-01T00:00:00Z"),
      res("web", 10, "2026-01-01T00:00:00Z"),  // tail median = (6+10)/2 = 8
      res("db", 0.2, "2026-01-01T00:00:00Z"),  // db has only fast-lane resolutions -> null
    ];
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups, { minMttrDays: 1 })).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: 8, db: null } },
    ]);
  });

  it("minMttrDays applies to the pooled Other remainder too", () => {
    const base = [
      res("cache", 0.5, "2026-01-01T00:00:00Z"), // dropped from the pool
      res("cache", 4, "2026-01-01T00:00:00Z"),
      res("queue", 12, "2026-01-01T00:00:00Z"),  // Other tail median = (4+12)/2 = 8
    ];
    expect(medianMttrByGroupTrend([scans[1]], base, keyOf, groups, { minMttrDays: 1 })).toEqual([
      { date: "2026-01-02T00:00:00Z", byGroup: { web: null, db: null, Other: 8 } },
    ]);
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

  it("fromField 'actionable_from' shifts breach ages and skips null-actionable rows", () => {
    // All CRITICAL (target 7). A has a fix from detection; B's fix arrived on Jan 10; C is
    // awaiting a vendor fix (null actionable_from). As of Jan 15:
    //   default (first_seen origin): all three age 14d > 7 -> 3 breached.
    //   actionable_from origin: A ages from Jan 1 (14d, breached); B ages from Jan 10 (5d,
    //   within target); C is skipped (null origin) -> 1 breached.
    const b = [
      { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null },
      { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", actionable_from: "2026-01-10T00:00:00Z", resolved_at: null },
      { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", actionable_from: null, resolved_at: null },
    ];
    const points = [{ date: "2026-01-15T00:00:00Z" }];
    expect(withOpenPastSla(points, b)[0].open_past_sla).toBe(3);
    expect(withOpenPastSla(points, b, null, "actionable_from")[0].open_past_sla).toBe(1);
  });
});

describe("withSlaBurn", () => {
  // All CRITICAL (target 7), actionable_from Jan 1 -> deadline Jan 8. Scans Jan 1 / Jan 10 /
  // Jan 20 bracket the deadline (crossing in window 2) and B's late resolution (window 3).
  //   A: never resolved -> crosses into breach.
  //   B: resolved Jan 15, AFTER the deadline -> crosses, then clears.
  //   C: resolved Jan 5, BEFORE the deadline -> never breaches, never counts.
  //   D: awaiting a vendor fix (null actionable_from) -> never counts.
  //   E: UNKNOWN, no SLA target -> never counts.
  const base = [
    { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null },
    { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-15T00:00:00Z" },
    { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-05T00:00:00Z" },
    { severity: "CRITICAL", actionable_from: null, resolved_at: null },
    { severity: "UNKNOWN", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null },
  ];
  const points = [
    { date: "2026-01-01T00:00:00Z", foo: "a" },
    { date: "2026-01-10T00:00:00Z", foo: "b" },
    { date: "2026-01-20T00:00:00Z", foo: "c" },
  ];

  it("first point is null; entered/cleared/net per window; exclusions never count", () => {
    expect(withSlaBurn(points, base)).toEqual([
      { date: "2026-01-01T00:00:00Z", foo: "a", sla_entered: null, sla_cleared: null, sla_net: null },
      // Window (Jan 1, Jan 10]: A and B cross into breach (deadline Jan 8, unresolved by it);
      // C resolved before its deadline; D/E excluded. entered 2, cleared 0.
      { date: "2026-01-10T00:00:00Z", foo: "b", sla_entered: 2, sla_cleared: 0, sla_net: 2 },
      // Window (Jan 10, Jan 20]: no new deadlines; B's late resolution (Jan 15 > deadline)
      // clears. entered 0, cleared 1.
      { date: "2026-01-20T00:00:00Z", foo: "c", sla_entered: 0, sla_cleared: 1, sla_net: -1 },
    ]);
  });

  it("scopes to the chosen severities plus UNKNOWN", () => {
    // A HIGH crossing and a MEDIUM crossing in window 2; scoping to HIGH drops MEDIUM but
    // keeps UNKNOWN (which never has a target anyway).
    const b = [
      { severity: "HIGH", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null }, // deadline Jan 15
      { severity: "MEDIUM", actionable_from: "2025-12-01T00:00:00Z", resolved_at: null }, // deadline ~Dec 31
    ];
    const pts = [
      { date: "2026-01-01T00:00:00Z" },
      { date: "2026-01-20T00:00:00Z" },
    ];
    // Unscoped window (Jan 1, Jan 20]: HIGH deadline Jan 15 in window; MEDIUM deadline Dec 31
    // is before Jan 1, so it does not cross this window -> only HIGH enters.
    expect(withSlaBurn(pts, b)[1].sla_entered).toBe(1);
    // Scoped to HIGH: MEDIUM filtered out entirely -> still 1.
    expect(withSlaBurn(pts, b, ["HIGH"])[1].sla_entered).toBe(1);
    // A window that brackets the MEDIUM deadline shows it unscoped but not when scoped to HIGH.
    const ptsDec = [
      { date: "2025-12-01T00:00:00Z" },
      { date: "2026-01-20T00:00:00Z" },
    ];
    expect(withSlaBurn(ptsDec, b)[1].sla_entered).toBe(2);
    expect(withSlaBurn(ptsDec, b, ["HIGH"])[1].sla_entered).toBe(1);
  });
});

describe("cohortSlaAttainment", () => {
  // All CRITICAL (target 7), actionable_from Jan 1 -> deadline Jan 8.
  //   A: still open -> misses (open past deadline).
  //   B: resolved Jan 15, after the deadline -> misses (late).
  //   C: resolved Jan 5, on time -> hits.
  const base = [
    { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null },
    { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-15T00:00:00Z" },
    { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-05T00:00:00Z" },
  ];

  it("cohort membership by deadline<=d; late/open miss, on-time hits; empty cohort null", () => {
    const points = [
      { date: "2026-01-05T00:00:00Z", foo: "a" }, // deadline Jan 8 not yet passed -> empty cohort
      { date: "2026-01-10T00:00:00Z", foo: "b" }, // all three in cohort; 1 of 3 on time -> 33.3
    ];
    expect(cohortSlaAttainment(points, base)).toEqual([
      { date: "2026-01-05T00:00:00Z", foo: "a", sla_attainment_pct: null },
      { date: "2026-01-10T00:00:00Z", foo: "b", sla_attainment_pct: 33.3 },
    ]);
  });

  it("excludes awaiting-vendor-fix and no-target rows from the cohort", () => {
    const b = [
      { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-05T00:00:00Z" }, // on time
      { severity: "CRITICAL", actionable_from: null, resolved_at: null }, // awaiting -> excluded
      { severity: "UNKNOWN", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null }, // no target -> excluded
    ];
    // Only the one CRITICAL is in the cohort as of Jan 10, and it was on time -> 100.
    expect(cohortSlaAttainment([{ date: "2026-01-10T00:00:00Z" }], b)[0].sla_attainment_pct).toBe(100);
  });

  it("resolved exactly at the deadline counts as on time (<=)", () => {
    const b = [{ severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-08T00:00:00Z" }];
    // deadline is Jan 1 + 7d = Jan 8; resolved exactly then -> met.
    expect(cohortSlaAttainment([{ date: "2026-01-10T00:00:00Z" }], b)[0].sla_attainment_pct).toBe(100);
  });

  it("rounds attainment to one decimal place", () => {
    // 2 of 3 on time = 66.666… -> 66.7.
    const b = [
      { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-05T00:00:00Z" },
      { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: "2026-01-06T00:00:00Z" },
      { severity: "CRITICAL", actionable_from: "2026-01-01T00:00:00Z", resolved_at: null },
    ];
    expect(cohortSlaAttainment([{ date: "2026-01-10T00:00:00Z" }], b)[0].sla_attainment_pct).toBe(66.7);
  });
});

describe("withKmMedian", () => {
  // Four HIGH findings all first seen 2026-01-01, resolved 2/4/6/8 days later. As of an early
  // date only some have resolved (the rest are right-censored at their current age); as of a
  // late date all four are events and the KM staircase crosses 0.5.
  const base = [
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-03T00:00:00Z", mttr_days: 2 },
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-05T00:00:00Z", mttr_days: 4 },
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-07T00:00:00Z", mttr_days: 6 },
    { severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-09T00:00:00Z", mttr_days: 8 },
  ];

  it("null before any event / before the 0.5 crossing; KM median as of each date", () => {
    const points = [
      { date: "2026-01-02T00:00:00Z", foo: "a" }, // nothing resolved yet -> null
      { date: "2026-01-04T00:00:00Z", foo: "b" }, // event [2], three censored at age 3: t2 n=4 S=.75 -> null
      { date: "2026-01-10T00:00:00Z", foo: "c" }, // events [2,4,6,8]: t2 S=.75, t4 S=.5 -> median 4
    ];
    expect(withKmMedian(points, base)).toEqual([
      { date: "2026-01-02T00:00:00Z", foo: "a", km_median_days: null },
      { date: "2026-01-04T00:00:00Z", foo: "b", km_median_days: null },
      { date: "2026-01-10T00:00:00Z", foo: "c", km_median_days: 4 },
    ]);
  });

  it("scopes to the chosen severities plus UNKNOWN", () => {
    const b = [
      { severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-03T00:00:00Z", mttr_days: 2 },
      { severity: "MEDIUM", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-05T00:00:00Z", mttr_days: 4 },
      { severity: "UNKNOWN", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-07T00:00:00Z", mttr_days: 6 },
    ];
    const points = [{ date: "2026-01-10T00:00:00Z" }];
    // Unscoped events [2,4,6]: t2 n=3 S=.667, t4 n=2 S=.333 <= .5 -> median 4.
    // Scoped to CRITICAL (UNKNOWN kept) events [2,6]: t2 n=2 S=.5 <= .5 -> median 2.
    expect(withKmMedian(points, b)[0].km_median_days).toBe(4);
    expect(withKmMedian(points, b, ["CRITICAL"])[0].km_median_days).toBe(2);
  });

  it("rounds the KM median to 3 decimals like trendFromFrames", () => {
    // A single event at 5.0006: S drops straight to 0, so the median is that event time.
    const b = [{ severity: "HIGH", first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-06T00:00:00Z", mttr_days: 5.0006 }];
    expect(withKmMedian([{ date: "2026-01-15T00:00:00Z" }], b)[0].km_median_days).toBe(5.001);
  });
});
