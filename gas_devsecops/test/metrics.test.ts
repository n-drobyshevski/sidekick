// Port of gas/test/metrics.test.ts. metrics.json is byte-identical between gas/ and this
// package (diffed before writing this file) — calculateMttr reads raw Wiz node field names
// (firstDetectedAt/resolvedAt/severity), not the ledger's renamed columns, so the D9 brief's
// vuln_key -> finding_key / cve -> identifier / asset_* -> repo_* renames do not touch this
// fixture or this file at all. No fixture fields are unmapped.
//
// metrics_no_first_seen.json (gas/'s edge-case fixture) was never copied into this package's
// test/fixtures/ — only metrics.json and mttr_from_ledger.json were. It is a single hand-typed
// record, not a Python export, so it is inlined below instead of read off disk.

import { describe, expect, it } from "vitest";
import { calculateMttr, overallSlaOldest, summarize } from "../src/domain/metrics";
import { expectParity, fixture } from "./helpers";

describe("calculateMttr (fixture parity)", () => {
  const fx = fixture("metrics");
  it("matches the Python per-severity and overall summary", () => {
    const { perSev, overall } = calculateMttr(fx.records, Date.parse(fx.now));
    expectParity(perSev, fx.expected.per_sev);
    expectParity(overall, fx.expected.overall);
  });
  it("matches overall_sla_oldest", () => {
    const { perSev } = calculateMttr(fx.records, Date.parse(fx.now));
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    expectParity(slaPct, fx.expected.overall_sla_oldest.sla_pct);
    expectParity(oldestDays, fx.expected.overall_sla_oldest.oldest_days);
  });
});

describe("calculateMttr edge cases", () => {
  it("returns empty without a first-seen column (metrics_no_first_seen.json, inlined — see header)", () => {
    const records = [{ severity: "HIGH", status: "OPEN" }];
    const { perSev, overall } = calculateMttr(records);
    expect(perSev).toEqual({});
    expect(overall).toEqual({});
  });
  it("returns empty for no records", () => {
    expect(calculateMttr([])).toEqual({ perSev: {}, overall: {} });
  });
});

// ------------------------------------------------------------------------- scope filter (D9)
//
// New relative to gas/: this ledger spans three scopes sharing one table (config.ts's `scope`
// is part of every LedgerRow's identity), so "every metric takes an optional scope filter"
// (D9 brief). calculateMttr's records are raw Wiz nodes and normally carry no `scope` field —
// it is a ledger column, not part of the API response — but the filter still has to work when
// a caller attaches one (e.g. probing ledger-shaped rows through this path), and it must never
// drop a record that simply lacks the field.
describe("scope filter", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
  const rowsMixed = [
    { sev: "CRITICAL", firstSeen: Date.parse(day(1)), resolved: Date.parse(day(3)), scope: "sca" as const },
    { sev: "CRITICAL", firstSeen: Date.parse(day(1)), resolved: Date.parse(day(11)), scope: "sast" as const },
  ];

  it("summarize(scope) narrows to one scope's rows", () => {
    const now = Date.parse(day(20));
    const sca = summarize(rowsMixed, now, "sca");
    // 3 - 1 = 2 days MTTR for the sca-only row; the sast row (10 days) must not enter it.
    expect(sca.perSev.CRITICAL!.mttr_mean).toBe(2);
    expect(sca.perSev.CRITICAL!.resolved).toBe(1);

    const sast = summarize(rowsMixed, now, "sast");
    expect(sast.perSev.CRITICAL!.mttr_mean).toBe(10);
  });

  it("summarize() with no scope arg reads every row, same as before this parameter existed", () => {
    const now = Date.parse(day(20));
    const all = summarize(rowsMixed, now);
    expect(all.perSev.CRITICAL!.resolved).toBe(2);
    expect(all.perSev.CRITICAL!.mttr_mean).toBe(6); // mean(2, 10)
  });

  it("calculateMttr's scope filter never drops a record with no scope field", () => {
    // Raw Wiz records normally carry no `scope` at all; the filter must be a no-op then.
    const records = [
      { severity: "HIGH", firstDetectedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-05T00:00:00Z" },
    ];
    const filtered = calculateMttr(records, undefined, "sca");
    const unfiltered = calculateMttr(records);
    expect(filtered).toEqual(unfiltered);
    expect(filtered.perSev.HIGH!.resolved).toBe(1);
  });

  it("calculateMttr honours an attached scope field when a caller supplies one", () => {
    const records = [
      { severity: "HIGH", firstDetectedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-05T00:00:00Z", scope: "sca" },
      { severity: "HIGH", firstDetectedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-11T00:00:00Z", scope: "secrets" },
    ];
    const sca = calculateMttr(records, undefined, "sca");
    expect(sca.perSev.HIGH!.resolved).toBe(1);
    expect(sca.perSev.HIGH!.mttr_mean).toBe(4);
  });
});
