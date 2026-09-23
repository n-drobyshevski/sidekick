// ONE DEFINITION OF "DID WE SEE IT" — `rowReachesScan` (the row-level core `coldZone.isObserved`
// and `baseRows`'s per-row `observed` field are both built from) and the two BaseRow fields the
// backlog split reads it into: `observed` and `seen_age_days`.
//
// coldZone.ts's own tests (test/coldZoneModel.test.ts) already cover the asset-level verdict —
// this file is the row-level predicate and the ledger-core plumbing around it, which had no
// dedicated test home before this package.

import { describe, expect, it } from "vitest";
import {
  baseRows,
  emptyState,
  rowReachesScan,
  type LedgerState,
  type NewestScan,
} from "../src/domain/ledgerCore";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";

const DAY = 86_400_000;

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    vuln_key: "id:x", cve: "CVE-2026-1", severity: "HIGH", asset_id: "a1",
    asset_name: "host-1", asset_type: null, cloud: null, first_seen: null, last_seen: null,
    status: "OPEN", resolved_at: null, resolution_src: null, reopened_count: 0,
    first_scan_id: null, last_scan_id: null, subscription_name: null,
    subscription_ext_id: null, tags_json: null, fix_date: null, fix_observed_at: null,
    published_date: null,
    ...emptyRiskSignals(),
    ...over,
  } as LedgerRow;
}

describe("rowReachesScan — the row-level predicate", () => {
  const newest: NewestScan = { scan_id: "scan-9", ts: "2026-03-10T00:00:00Z" };

  it("present: last_scan_id matches the newest scan's id", () => {
    expect(rowReachesScan(row({ last_scan_id: "scan-9" }), newest)).toBe(true);
  });

  it("stale: last_scan_id names an older scan", () => {
    expect(rowReachesScan(row({ last_scan_id: "scan-8" }), newest)).toBe(false);
  });

  it("a present last_scan_id is tested by id ONLY — it never falls back to last_seen, even if that would match", () => {
    const row1 = row({ last_scan_id: "scan-8", last_seen: "2026-03-11T00:00:00Z" }); // last_seen is AFTER newest.ts
    expect(rowReachesScan(row1, newest)).toBe(false);
  });

  it("blank last_scan_id falls back to last_seen >= newest.ts", () => {
    expect(rowReachesScan(row({ last_scan_id: null, last_seen: "2026-03-10T00:00:00Z" }), newest)).toBe(true);
    expect(rowReachesScan(row({ last_scan_id: null, last_seen: "2026-03-09T23:59:59Z" }), newest)).toBe(false);
  });

  it("blank last_scan_id and blank last_seen — nothing to test against, false", () => {
    expect(rowReachesScan(row({ last_scan_id: null, last_seen: null }), newest)).toBe(false);
  });

  it("a present last_scan_id against a blank newest.scan_id never matches by id", () => {
    const blankNewest: NewestScan = { scan_id: null, ts: "2026-03-10T00:00:00Z" };
    expect(rowReachesScan(row({ last_scan_id: "scan-9" }), blankNewest)).toBe(false);
  });
});

describe("baseRows — observed (row-level, per its own severity)", () => {
  // Two severities' newest flat scans, the shape ledgerStore.loadBaseRows hands to baseRows in
  // production (via newestFlatScanBySeverity). HIGH has one on record; LOW does not — the
  // undecidable case.
  const newestBySeverity: Record<string, NewestScan> = {
    HIGH: { scan_id: "scan-9", ts: "2026-03-10T00:00:00Z" },
  };

  it("present: last_scan_id matches its own severity's newest scan", () => {
    const state: LedgerState = emptyState();
    state.ledger["k1"] = row({ vuln_key: "k1", severity: "HIGH", last_scan_id: "scan-9" });
    const [r] = baseRows(state, Date.now(), newestBySeverity);
    expect(r!.observed).toBe(true);
  });

  it("stale: last_scan_id names an older scan of the SAME severity", () => {
    const state: LedgerState = emptyState();
    state.ledger["k1"] = row({ vuln_key: "k1", severity: "HIGH", last_scan_id: "scan-3" });
    const [r] = baseRows(state, Date.now(), newestBySeverity);
    expect(r!.observed).toBe(false);
  });

  it("undecidable: a severity with no scan on record resolves to observed", () => {
    const state: LedgerState = emptyState();
    state.ledger["k1"] = row({ vuln_key: "k1", severity: "LOW", last_scan_id: "scan-3" });
    const [r] = baseRows(state, Date.now(), newestBySeverity);
    expect(r!.observed).toBe(true);
  });

  it("no map at all (the default third argument) — every row reads observed, on every severity", () => {
    const state: LedgerState = emptyState();
    state.ledger["k1"] = row({ vuln_key: "k1", severity: "HIGH", last_scan_id: "scan-3" });
    // Two-arg call — the shape almost every existing caller in this codebase uses.
    const [r] = baseRows(state, Date.now());
    expect(r!.observed).toBe(true);
  });

  it("a HIGH-only sweep does not mark a LOW row unobserved (matches reconcile's own per-severity gate)", () => {
    const state: LedgerState = emptyState();
    state.ledger["low1"] = row({ vuln_key: "low1", severity: "LOW", last_scan_id: null, last_seen: null });
    const [r] = baseRows(state, Date.now(), newestBySeverity);
    expect(r!.observed).toBe(true); // LOW is absent from the map -> undecidable -> observed
  });
});

describe("baseRows — seen_age_days", () => {
  it("open row: (last_seen - first_seen) in days, exactly", () => {
    const state: LedgerState = emptyState();
    // 2026-01-01 -> 2026-01-11 is 10 days, exactly.
    state.ledger["k1"] = row({
      vuln_key: "k1", status: "OPEN",
      first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-01-11T00:00:00Z",
    });
    const [r] = baseRows(state, Date.parse("2026-06-01T00:00:00Z"));
    expect(r!.seen_age_days).toBe(10);
    // age_days is unchanged by the split: now (06-01) - first_seen (01-01) = 151 days.
    const AGE = (Date.parse("2026-06-01T00:00:00Z") - Date.parse("2026-01-01T00:00:00Z")) / DAY;
    expect(AGE).toBe(151);
    expect(r!.age_days).toBe(151);
  });

  it("null once resolved — mirrors age_days's own null-when-resolved convention", () => {
    const state: LedgerState = emptyState();
    state.ledger["k1"] = row({
      vuln_key: "k1", status: "RESOLVED",
      first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-01-11T00:00:00Z",
      resolved_at: "2026-01-11T00:00:00Z",
    });
    const [r] = baseRows(state, Date.now());
    expect(r!.seen_age_days).toBeNull();
  });

  it("null when either date is missing", () => {
    const state: LedgerState = emptyState();
    state.ledger["k1"] = row({ vuln_key: "k1", status: "OPEN", first_seen: null, last_seen: "2026-01-11T00:00:00Z" });
    state.ledger["k2"] = row({ vuln_key: "k2", status: "OPEN", first_seen: "2026-01-01T00:00:00Z", last_seen: null });
    const [r1, r2] = baseRows(state, Date.now());
    expect(r1!.seen_age_days).toBeNull();
    expect(r2!.seen_age_days).toBeNull();
  });

  it("an unobserved open row: seen_age_days is smaller than age_days once the scanner has moved on", () => {
    const newestBySeverity: Record<string, NewestScan> = {
      HIGH: { scan_id: "scan-9", ts: "2026-04-10T00:00:00Z" },
    };
    const state: LedgerState = emptyState();
    // Last actually seen 2026-01-11 (10 days after first_seen), but the newest HIGH scan is
    // 2026-04-10 and this row's last_scan_id names an older one — unobserved.
    state.ledger["k1"] = row({
      vuln_key: "k1", severity: "HIGH", status: "OPEN", last_scan_id: "scan-3",
      first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-01-11T00:00:00Z",
    });
    const now = Date.parse("2026-06-01T00:00:00Z");
    const [r] = baseRows(state, now, newestBySeverity);
    expect(r!.observed).toBe(false);
    expect(r!.seen_age_days).toBe(10); // last_seen - first_seen, unaffected by observed
    // age_days keeps its own meaning too: now (06-01) - first_seen (01-01) = 151 days, the
    // same figure the "unchanged by the split" test above computes.
    expect(r!.age_days).toBe(151);
    expect(r!.seen_age_days!).toBeLessThan(r!.age_days!);
  });
});
