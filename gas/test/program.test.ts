// Remediation coverage / efficiency / capacity (domain/program.ts). GAS-first, so these are
// hand-written rather than Python-fixture parity.
//
// The first block is the audit anchor: a hand-counted register whose every figure is worked
// out in the comment, so the metric can be checked by reading the test rather than by
// trusting the code. Everything after it guards the three-valued classification, which is
// where a plausible-looking implementation goes wrong quietly.

import { describe, expect, it } from "vitest";
import {
  capacityByMonth,
  classifyRisk,
  confusionBySeverity,
  confusionMatrix,
  DEFAULT_RISK_RULE,
  firedSignals,
  ruleSensitivity,
  ruleSentence,
  signalBreakdown,
  type RiskRow,
  type RiskRule,
} from "../src/domain/program";
import { withCoverageEfficiency } from "../src/domain/trend";
import { baseRows, emptyState, type LedgerState } from "../src/domain/ledgerCore";
import {
  backfillRiskFromRecords,
  countUnknownRisk,
  emptyBackfillResult,
  toEpisodeRow,
} from "../src/domain/maintenance";
import type { LedgerRow } from "../src/domain/reconcile";

const RULE: RiskRule = DEFAULT_RISK_RULE; // KEV or exploit or EPSS >= 0.10

/** A row with everything observed-and-negative unless overridden — an explicit `low`. */
function row(over: Partial<RiskRow> = {}): RiskRow {
  return {
    severity: "HIGH",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0.01,
    ...over,
  };
}

/** A row nothing was ever captured for — an explicit `unknown`. */
function unknownRow(over: Partial<RiskRow> = {}): RiskRow {
  return { severity: "HIGH", status: "OPEN", has_kev: null, has_exploit: null, epss: null, ...over };
}

const RESOLVED = { status: "RESOLVED" };

describe("coverage & efficiency — hand-computed worked example", () => {
  // A 12-lifecycle register, three of each classified cell plus one unclassified on each
  // side. Counts and arithmetic in full, so this block IS the audit trail:
  //
  //   3  high risk, remediated       -> TP = 3
  //   3  not high risk, remediated   -> FP = 3
  //   2  high risk, still open       -> FN = 2
  //   2  not high risk, still open   -> TN = 2
  //   1  no captured signal, remediated -> unknownRemediated = 1
  //   1  no captured signal, open       -> unknownOpen       = 1
  //                                        classified = 10, unknown = 2, total = 12
  //
  //   coverage.point   = TP / (TP + FN)                     = 3 / 5  = 60.0%
  //   coverage.lo      = TP / (TP + FN + unknownOpen)       = 3 / 6  = 50.0%
  //   coverage.hi      = (TP + uR) / (TP + uR + FN)         = 4 / 6  = 66.66..%
  //
  //   efficiency.point = TP / (TP + FP)                     = 3 / 6  = 50.0%
  //   efficiency.lo    = TP / (TP + FP + uR)                = 3 / 7  = 42.857..%
  //   efficiency.hi    = (TP + uR) / (TP + FP + uR)         = 4 / 7  = 57.142..%
  //
  //   prevalence       = (TP + FN) / classified             = 5 / 10 = 50.0%
  //   signalCoverage   = classified / total                 = 10 / 12 = 83.33..%
  //
  // Coverage (60%) differs from efficiency (50%) by construction, so a transposed
  // numerator/denominator cannot pass this test.
  const rows: RiskRow[] = [
    // TP — high risk (one per signal, so the OR is exercised), remediated.
    row({ has_kev: true, ...RESOLVED }),
    row({ has_exploit: true, ...RESOLVED }),
    row({ epss: 0.42, ...RESOLVED }),
    // FP — observed low, remediated anyway.
    row(RESOLVED),
    row(RESOLVED),
    row(RESOLVED),
    // FN — high risk, still open.
    row({ has_kev: true }),
    row({ epss: 0.9 }),
    // TN — low risk, still open.
    row(),
    row(),
    // Unclassified.
    unknownRow(RESOLVED),
    unknownRow(),
  ];
  const m = confusionMatrix(rows, RULE);

  it("counts each quadrant", () => {
    expect(m.tp).toBe(3);
    expect(m.fp).toBe(3);
    expect(m.fn).toBe(2);
    expect(m.tn).toBe(2);
    expect(m.unknownRemediated).toBe(1);
    expect(m.unknownOpen).toBe(1);
  });

  it("reconciles its totals — nothing is lost or double-counted", () => {
    expect(m.classified).toBe(10);
    expect(m.unknown).toBe(2);
    expect(m.total).toBe(rows.length);
    expect(m.tp + m.fp + m.fn + m.tn + m.unknown).toBe(rows.length);
    expect(m.remediated + m.open).toBe(rows.length);
    expect(m.remediated).toBe(7); // 3 TP + 3 FP + 1 unknown
    expect(m.open).toBe(5); // 2 FN + 2 TN + 1 unknown
  });

  it("computes coverage and its bounds", () => {
    expect(m.coverage.point).toBeCloseTo(60, 9);
    expect(m.coverage.lo).toBeCloseTo(50, 9);
    expect(m.coverage.hi).toBeCloseTo(66.6666667, 6);
  });

  it("computes efficiency and its bounds", () => {
    expect(m.efficiency.point).toBeCloseTo(50, 9);
    expect(m.efficiency.lo).toBeCloseTo(42.8571429, 6);
    expect(m.efficiency.hi).toBeCloseTo(57.1428571, 6);
  });

  it("computes the random-prioritization baseline and the signal-coverage share", () => {
    expect(m.prevalence).toBeCloseTo(50, 9);
    expect(m.signalCoveragePct).toBeCloseTo(83.3333333, 6);
  });

  it("brackets the point estimate on both rates", () => {
    expect(m.coverage.lo!).toBeLessThan(m.coverage.point!);
    expect(m.coverage.point!).toBeLessThan(m.coverage.hi!);
    expect(m.efficiency.lo!).toBeLessThan(m.efficiency.point!);
    expect(m.efficiency.point!).toBeLessThan(m.efficiency.hi!);
  });
});

describe("classifyRisk — the three-valued truth table", () => {
  it("any enabled signal firing wins, even with the others missing", () => {
    expect(classifyRisk({ ...unknownRow(), has_kev: true }, RULE)).toBe("high");
    expect(classifyRisk({ ...unknownRow(), has_exploit: true }, RULE)).toBe("high");
    expect(classifyRisk({ ...unknownRow(), epss: 0.5 }, RULE)).toBe("high");
  });

  it("all enabled signals observed and none firing -> low", () => {
    expect(classifyRisk(row(), RULE)).toBe("low");
  });

  // The trap, stated as a test: a partially-captured row is unknown, NOT low. Counting it as
  // low would put it in FP/TN and quietly overstate efficiency.
  it("a missing enabled signal makes the row unknown, never low", () => {
    expect(classifyRisk(row({ epss: null }), RULE)).toBe("unknown");
    expect(classifyRisk(row({ has_kev: null }), RULE)).toBe("unknown");
    expect(classifyRisk(row({ has_exploit: null }), RULE)).toBe("unknown");
    expect(classifyRisk(unknownRow(), RULE)).toBe("unknown");
  });

  it("a disabled signal is ignored — its absence cannot make a row unknown", () => {
    const epssOnly: RiskRule = { kev: false, exploit: false, epss: true, epssThreshold: 0.1 };
    // KEV and exploit never captured, but the rule doesn't ask about them.
    expect(classifyRisk({ ...unknownRow(), epss: 0.02 }, epssOnly)).toBe("low");
    expect(classifyRisk({ ...unknownRow(), epss: 0.5 }, epssOnly)).toBe("high");
    // A KEV listing cannot make a row high risk under a rule that ignores KEV.
    expect(classifyRisk({ ...unknownRow(), has_kev: true, epss: 0.02 }, epssOnly)).toBe("low");
  });

  it("the threshold is inclusive at its boundary", () => {
    expect(classifyRisk(row({ epss: 0.1 }), RULE)).toBe("high");
    expect(classifyRisk(row({ epss: 0.0999 }), RULE)).toBe("low");
  });

  it("a rule with nothing enabled classifies everything unknown, with no silent fallback", () => {
    const none: RiskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    expect(classifyRisk(row({ has_kev: true }), none)).toBe("unknown");
    const m = confusionMatrix([row({ has_kev: true }), row()], none);
    expect(m.unknown).toBe(2);
    expect(m.classified).toBe(0);
    expect(m.coverage.point).toBeNull();
    expect(m.signalCoveragePct).toBe(0);
  });

  it("is monotone — adding evidence never demotes a row", () => {
    expect(classifyRisk(row(), RULE)).toBe("low");
    expect(classifyRisk(row({ has_exploit: true }), RULE)).toBe("high");
    expect(classifyRisk(row({ has_kev: true, has_exploit: true, epss: 0.9 }), RULE)).toBe("high");
  });
});

describe("empty denominators return null, never zero", () => {
  it("no rows at all", () => {
    const m = confusionMatrix([], RULE);
    expect(m.coverage.point).toBeNull();
    expect(m.efficiency.point).toBeNull();
    expect(m.prevalence).toBeNull();
    expect(m.signalCoveragePct).toBeNull();
    expect(m.total).toBe(0);
  });

  it("nothing high risk -> coverage is unmeasurable, efficiency is a real 0%", () => {
    const m = confusionMatrix([row(), row(RESOLVED)], RULE);
    expect(m.coverage.point).toBeNull(); // no high-risk population to have covered
    expect(m.efficiency.point).toBe(0); // one thing WAS remediated, and it wasn't high risk
  });

  it("nothing remediated -> efficiency is unmeasurable, coverage is a real 0%", () => {
    const m = confusionMatrix([row({ has_kev: true }), row()], RULE);
    expect(m.efficiency.point).toBeNull();
    expect(m.coverage.point).toBe(0);
  });

  it("with no unclassified rows the bounds collapse onto the point", () => {
    const m = confusionMatrix([row({ has_kev: true, ...RESOLVED }), row({ has_kev: true })], RULE);
    expect(m.coverage.lo).toBe(m.coverage.point);
    expect(m.coverage.hi).toBe(m.coverage.point);
    expect(m.efficiency.lo).toBe(m.efficiency.point);
    expect(m.efficiency.hi).toBe(m.efficiency.point);
  });
});

describe("per-severity split", () => {
  const rows: RiskRow[] = [
    row({ severity: "CRITICAL", has_kev: true, ...RESOLVED }),
    row({ severity: "CRITICAL", has_kev: true }),
    row({ severity: "LOW", has_exploit: true, ...RESOLVED }),
  ];
  const { perSev, overall } = confusionBySeverity(rows, RULE);

  it("splits by normalized severity and keeps the overall consistent", () => {
    expect(perSev.CRITICAL.coverage.point).toBeCloseTo(50, 9); // 1 of 2
    expect(perSev.LOW.coverage.point).toBeCloseTo(100, 9); // 1 of 1
    expect(overall.coverage.point).toBeCloseTo(66.6666667, 6); // 2 of 3
    expect(perSev.CRITICAL.total + perSev.LOW.total).toBe(overall.total);
  });

  it("omits severities with no rows", () => {
    expect(perSev.MEDIUM).toBeUndefined();
  });
});

describe("signalBreakdown", () => {
  const rows: RiskRow[] = [
    row({ has_kev: true, has_exploit: true }), // fires on two clauses at once
    row({ has_exploit: true }),
    row({ epss: 0.6 }),
    row(),
    unknownRow(),
  ];
  const b = signalBreakdown(rows, RULE);

  it("counts each clause, overlapping — they do not partition the high-risk set", () => {
    expect(b.kev).toBe(1);
    expect(b.exploit).toBe(2);
    expect(b.epss).toBe(1);
    expect(b.anyOf).toBe(3); // not 4: the first row is counted once
    expect(b.kev + b.exploit + b.epss).toBeGreaterThan(b.anyOf);
  });

  it("reports where each signal was never captured", () => {
    expect(b.kevMissing).toBe(1);
    expect(b.exploitMissing).toBe(1);
    expect(b.epssMissing).toBe(1);
  });
});

describe("ruleSensitivity", () => {
  const rows: RiskRow[] = [
    row({ has_kev: true, ...RESOLVED }),
    row({ has_exploit: true }),
    row({ epss: 0.7, ...RESOLVED }),
    row(RESOLVED),
  ];

  it("scores all seven non-empty subsets and marks the active one", () => {
    const pts = ruleSensitivity(rows, RULE);
    expect(pts).toHaveLength(7);
    expect(pts.filter((p) => p.active)).toHaveLength(1);
    expect(pts.find((p) => p.active)!.label).toBe("All three");
  });

  it("shows the coverage/efficiency trade-off between a narrow and a broad rule", () => {
    const pts = ruleSensitivity(rows, RULE);
    const kevOnly = pts.find((p) => p.label === "KEV")!;
    const all = pts.find((p) => p.label === "All three")!;
    // KEV alone flags one finding, which was remediated: perfect coverage of a tiny set.
    expect(kevOnly.highRisk).toBe(1);
    expect(kevOnly.coverage).toBeCloseTo(100, 9);
    // All three flags three; two of them were remediated.
    expect(all.highRisk).toBe(3);
    expect(all.coverage).toBeCloseTo(66.6666667, 6);
    // Broader rule, better efficiency here (more of what we fixed was high risk).
    expect(all.efficiency!).toBeGreaterThan(kevOnly.efficiency!);
  });
});

describe("ruleSentence", () => {
  it("reads as prose for the page and the CSV header", () => {
    expect(ruleSentence(RULE)).toBe("CISA KEV or public exploit or EPSS >= 0.10");
    expect(ruleSentence({ kev: true, exploit: false, epss: false, epssThreshold: 0.1 })).toBe(
      "CISA KEV",
    );
    expect(ruleSentence({ kev: false, exploit: false, epss: false, epssThreshold: 0.1 })).toBe(
      "no signal enabled",
    );
  });
});

describe("capacityByMonth", () => {
  const NOW = Date.parse("2026-04-10T00:00:00Z");
  const cap = (over: Partial<RiskRow> & { first_seen: string; resolved_at: string | null }) => ({
    ...row(),
    ...over,
  });
  // One flat scan in January, so nothing is flagged reconstructed from February on.
  const scans = [
    { ts: "2026-01-02T00:00:00Z", shape: "flat", resolved_count: 0 },
    { ts: "2026-02-02T00:00:00Z", shape: "flat", resolved_count: 1 },
    { ts: "2026-03-02T00:00:00Z", shape: "flat", resolved_count: 2 },
    { ts: "2026-03-03T00:00:00Z", shape: "grouped", resolved_count: 99 }, // never counted
  ];

  const rows = [
    // Opened January, closed February.
    cap({ first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-10T00:00:00Z" }),
    // Opened January, closed March.
    cap({ first_seen: "2026-01-06T00:00:00Z", resolved_at: "2026-03-10T00:00:00Z" }),
    // Opened January, still open.
    cap({ first_seen: "2026-01-07T00:00:00Z", resolved_at: null }),
    // Opened March, still open.
    cap({ first_seen: "2026-03-20T00:00:00Z", resolved_at: null }),
  ];
  const out = capacityByMonth(rows, scans, { rule: RULE, now: NOW });

  it("buckets by UTC calendar month from the earliest first_seen to now", () => {
    expect(out.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("counts opened, closed, and the backlog open at each month start", () => {
    const [jan, feb, mar, apr] = out.months;
    expect(jan.opened).toBe(3);
    expect(jan.closed).toBe(0);
    expect(jan.openAtStart).toBe(0); // nothing existed before January
    expect(feb.openAtStart).toBe(3);
    expect(feb.closed).toBe(1);
    expect(feb.mmcr).toBeCloseTo(33.3333333, 6); // 1 of 3
    expect(mar.openAtStart).toBe(2);
    expect(mar.opened).toBe(1);
    expect(mar.closed).toBe(1);
    expect(apr.openAtStart).toBe(2);
  });

  it("flags the current month partial and pre-first-scan months reconstructed", () => {
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-04"].partial).toBe(true);
    expect(byKey["2026-03"].partial).toBe(false);
    // January ends after the 2026-01-02 scan, so it is directly observed.
    expect(byKey["2026-01"].reconstructed).toBe(false);
  });

  it("excludes the partial current month from the mean close rate", () => {
    // Only February and March are complete, observed, and had an open backlog:
    //   Feb 1/3 = 33.333%, Mar 1/2 = 50%  ->  mean 41.666%
    expect(out.monthsCounted).toBe(2);
    expect(out.mmcrMean).toBeCloseTo(41.6666667, 6);
    expect(out.oneInN).toBeCloseTo(2.4, 6);
  });

  it("carries the scan-delta cross-check and ignores grouped scans", () => {
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-02"].scanClosed).toBe(1);
    expect(byKey["2026-03"].scanClosed).toBe(2); // the grouped scan's 99 is excluded
    expect(byKey["2026-04"].scanClosed).toBeNull(); // no scans ran that month
  });

  it("excludes the first scan from the cross-check", () => {
    // The first reconcile counts every already-resolved finding the API returns as a
    // resolution, whenever it was really fixed — a different question from "closed this
    // month", and including it makes January's cross-check look wildly wrong.
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-01"].scanClosed).toBeNull();
    const withBigFirst = capacityByMonth(
      rows,
      [{ ts: "2026-01-02T00:00:00Z", shape: "flat", resolved_count: 500 }, ...scans.slice(1)],
      { rule: RULE, now: NOW },
    );
    expect(withBigFirst.months.find((m) => m.month === "2026-01")!.scanClosed).toBeNull();
  });

  it("gives the P2P v3 verdict from net flow", () => {
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-02"].net).toBe(1); // closed 1, opened 0
    expect(byKey["2026-02"].verdict).toBe("gaining");
    expect(byKey["2026-03"].net).toBe(0); // closed 1, opened 1
    expect(byKey["2026-03"].verdict).toBe("keeping-up");
  });

  it("restricts to the high-risk population when asked", () => {
    const mixed = [
      cap({ first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-10T00:00:00Z", has_kev: true }),
      cap({ first_seen: "2026-01-06T00:00:00Z", resolved_at: "2026-02-11T00:00:00Z" }), // low
    ];
    const all = capacityByMonth(mixed, scans, { rule: RULE, now: NOW });
    const high = capacityByMonth(mixed, scans, { rule: RULE, highRiskOnly: true, now: NOW });
    expect(all.months.find((m) => m.month === "2026-02")!.closed).toBe(2);
    expect(high.months.find((m) => m.month === "2026-02")!.closed).toBe(1);
  });

  it("returns an empty result rather than throwing on an empty register", () => {
    const empty = capacityByMonth([], scans, { rule: RULE, now: NOW });
    expect(empty.months).toEqual([]);
    expect(empty.mmcrMean).toBeNull();
    expect(empty.verdict).toBeNull();
  });
});

describe("firedSignals", () => {
  it("names the clauses behind a high-risk verdict, for the drill-down", () => {
    expect(firedSignals(row({ has_kev: true, epss: 0.5 }), RULE)).toEqual(["kev", "epss"]);
    expect(firedSignals(row(), RULE)).toEqual([]);
    expect(firedSignals(unknownRow(), RULE)).toEqual([]);
  });
});

describe("withCoverageEfficiency (trend decorator)", () => {
  // Three high-risk lifecycles and one low-risk one, resolving on known dates, so the series
  // can be checked by hand at each point:
  //
  //   A  high, first seen 01-01, resolved 02-01
  //   B  high, first seen 01-01, still open
  //   C  high, first seen 03-01, resolved 03-15
  //   D  low,  first seen 01-01, resolved 02-01
  //   E  unknown signals, first seen 01-01, still open
  //
  //   as of 2026-01-15:  exists A,B,D,E. remediated none.
  //                      TP 0, FN 2 (A,B), FP 0  -> coverage 0%, efficiency null
  //   as of 2026-02-15:  A and D remediated.
  //                      TP 1, FN 1 (B), FP 1 (D) -> coverage 50%, efficiency 50%
  //   as of 2026-03-20:  C exists and is remediated too.
  //                      TP 2, FN 1 (B), FP 1 (D) -> coverage 66.7%, efficiency 66.7%
  const base = [
    { severity: "HIGH", status: "RESOLVED", has_kev: true, has_exploit: false, epss: 0.01,
      first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-02-01T00:00:00Z" },
    { severity: "HIGH", status: "OPEN", has_kev: true, has_exploit: false, epss: 0.01,
      first_seen: "2026-01-01T00:00:00Z", resolved_at: null },
    { severity: "HIGH", status: "RESOLVED", has_kev: true, has_exploit: false, epss: 0.01,
      first_seen: "2026-03-01T00:00:00Z", resolved_at: "2026-03-15T00:00:00Z" },
    { severity: "HIGH", status: "RESOLVED", has_kev: false, has_exploit: false, epss: 0.01,
      first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-02-01T00:00:00Z" },
    { severity: "HIGH", status: "OPEN", has_kev: null, has_exploit: null, epss: null,
      first_seen: "2026-01-01T00:00:00Z", resolved_at: null },
  ];
  const points = [
    { date: "2026-01-15T00:00:00Z", open: 0 },
    { date: "2026-02-15T00:00:00Z", open: 0 },
    { date: "2026-03-20T00:00:00Z", open: 0 },
  ];
  const out = withCoverageEfficiency(points, base, RULE);

  it("computes both rates as of each point's date", () => {
    expect(out[0].coverage_pct).toBe(0);
    expect(out[0].efficiency_pct).toBeNull(); // nothing remediated yet
    expect(out[1].coverage_pct).toBe(50);
    expect(out[1].efficiency_pct).toBe(50);
    expect(out[2].coverage_pct).toBe(66.7);
    expect(out[2].efficiency_pct).toBe(66.7);
  });

  it("excludes rows that did not exist yet at the point's date", () => {
    // C is first seen 03-01, so it is absent from the first two points entirely.
    expect(out[0].high_risk_open).toBe(2); // A and B, not C
    expect(out[2].high_risk_remediated).toBe(2); // A and C
  });

  it("reports the unclassified share alongside the rates", () => {
    expect(out[0].unknown_pct).toBe(25); // E of the four rows that existed on 01-15
    expect(out[1].unknown_pct).toBe(25);
    expect(out[2].unknown_pct).toBe(20); // five rows exist by then
  });

  it("preserves the caller's existing point fields", () => {
    expect(out[0].date).toBe("2026-01-15T00:00:00Z");
    expect(out[0].open).toBe(0);
  });

  it("scopes to the given severities", () => {
    const scoped = withCoverageEfficiency(points, base, RULE, ["LOW"]);
    expect(scoped[2].coverage_pct).toBeNull(); // no HIGH rows left to score
  });
});

describe("compaction preserves coverage & efficiency", () => {
  // Episodes carry the risk columns, so sealing a resolved lifecycle must not move either
  // rate. This asserts the invariant directly; maintenance.planCompaction enforces it at
  // runtime with its own stats-identity gate.
  it("a live row and its compacted episode classify identically", () => {
    const live: LedgerRow = {
      vuln_key: "k", cve: "CVE-2026-1", severity: "HIGH", asset_id: null, asset_name: null,
      asset_type: null, cloud: null, first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-02-01T00:00:00Z", status: "RESOLVED", resolved_at: "2026-02-01T00:00:00Z",
      resolution_src: "api", reopened_count: 0, first_scan_id: null, last_scan_id: null,
      subscription_name: null, subscription_ext_id: null, tags_json: null,
      fix_date: null, fix_observed_at: null,
      has_kev: true, has_exploit: false, epss: 0.44,
      risk_observed_at: "2026-01-01T00:00:00Z",
    };
    const ep = toEpisodeRow(live, "cmp-1");
    expect(ep.has_kev).toBe(true);
    expect(ep.has_exploit).toBe(false);
    expect(ep.epss).toBe(0.44);
    expect(ep.risk_observed_at).toBe("2026-01-01T00:00:00Z");

    // Round-trip through baseRows: live in one state, compacted episode in the other.
    const liveState: LedgerState = emptyState();
    liveState.ledger["k"] = live;
    const sealedState: LedgerState = emptyState();
    sealedState.episodes.push(ep);

    const project = (st: LedgerState) =>
      baseRows(st, Date.parse("2026-03-01T00:00:00Z")).map((r) => ({
        severity: r.severity, status: r.status,
        has_kev: r.has_kev, has_exploit: r.has_exploit, epss: r.epss,
      }));
    const before = confusionMatrix(project(liveState), RULE);
    const after = confusionMatrix(project(sealedState), RULE);
    expect(after.tp).toBe(before.tp);
    expect(after.coverage.point).toBe(before.coverage.point);
    expect(after.efficiency.point).toBe(before.efficiency.point);
    expect(before.tp).toBe(1); // and it really was classified, not silently unknown
  });
});

describe("risk-signal backfill (pure core)", () => {
  // The backfill replays saved scan archives to fill signals on lifecycles recorded before
  // the ledger stored them. Three properties make the resumable job safe, and each is
  // asserted here rather than assumed: idempotent, order-independent, and never destructive.
  const ledgerRow = (key: string, over: Partial<LedgerRow> = {}): LedgerRow => ({
    vuln_key: key, cve: "CVE-2026-1", severity: "HIGH", asset_id: null, asset_name: null,
    asset_type: null, cloud: null, first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-01-01T00:00:00Z", status: "OPEN", resolved_at: null,
    resolution_src: null, reopened_count: 0, first_scan_id: null, last_scan_id: null,
    subscription_name: null, subscription_ext_id: null, tags_json: null,
    fix_date: null, fix_observed_at: null,
    has_kev: null, has_exploit: null, epss: null, risk_observed_at: null,
    ...over,
  });
  const rec = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, name: "CVE-2026-1", severity: "HIGH", ...over });

  const freshState = () => {
    const st = emptyState();
    st.ledger["id:a"] = ledgerRow("id:a");
    st.episodes.push({
      vuln_key: "id:b", cve: "CVE-2026-2", severity: "HIGH",
      first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-02-01T00:00:00Z",
      resolution_src: "api", reopened_count: 0, compaction_id: "cmp", superseded_by_scan: null,
      tags_json: null, fix_date: null, fix_observed_at: null,
      has_kev: null, has_exploit: null, epss: null, risk_observed_at: null,
    });
    return st;
  };

  const scanA = [rec("a", { hasExploit: true, epssProbability: 0.3 })];
  const scanB = [rec("a", { hasCisaKevExploit: true, epssProbability: 0.8 }),
                 rec("b", { hasExploit: true, epssProbability: 0.4 })];

  it("fills live ledger rows and compacted episodes alike", () => {
    const st = freshState();
    const res = emptyBackfillResult();
    backfillRiskFromRecords(st, scanB, "2026-03-01T00:00:00Z", res);
    expect(st.ledger["id:a"].has_kev).toBe(true);
    expect(st.episodes[0].has_exploit).toBe(true); // the compacted lifecycle too
    expect(res.ledgerRowsTouched).toBe(1);
    expect(res.episodeRowsTouched).toBe(1);
  });

  it("is order-independent — newest-first replay matches oldest-first", () => {
    // This is what lets the job walk archives newest-first, so an abandoned run has still
    // done the most valuable part.
    const fwd = freshState();
    backfillRiskFromRecords(fwd, scanA, "2026-02-01T00:00:00Z", emptyBackfillResult());
    backfillRiskFromRecords(fwd, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());

    const rev = freshState();
    backfillRiskFromRecords(rev, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());
    backfillRiskFromRecords(rev, scanA, "2026-02-01T00:00:00Z", emptyBackfillResult());

    expect(rev.ledger["id:a"]).toEqual(fwd.ledger["id:a"]);
    expect(rev.episodes[0]).toEqual(fwd.episodes[0]);
    // And specifically: peak EPSS, both booleans true, earliest witness date.
    expect(fwd.ledger["id:a"].epss).toBe(0.8);
    expect(fwd.ledger["id:a"].has_exploit).toBe(true);
    expect(fwd.ledger["id:a"].has_kev).toBe(true);
    expect(fwd.ledger["id:a"].risk_observed_at).toBe("2026-02-01T00:00:00Z");
  });

  it("is idempotent — replaying the same scan twice changes nothing", () => {
    const once = freshState();
    backfillRiskFromRecords(once, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());
    const twice = freshState();
    backfillRiskFromRecords(twice, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());
    backfillRiskFromRecords(twice, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());
    expect(twice.ledger["id:a"]).toEqual(once.ledger["id:a"]);
    // A crashed hop can therefore be re-run with no rollback, which is why BACKFILLING is
    // deliberately absent from locks.recoverIfNeeded's set.
  });

  it("never clears a signal a later archive happens not to carry", () => {
    const st = freshState();
    backfillRiskFromRecords(st, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());
    backfillRiskFromRecords(st, [rec("a")], "2026-04-01T00:00:00Z", emptyBackfillResult());
    expect(st.ledger["id:a"].has_kev).toBe(true);
    expect(st.ledger["id:a"].epss).toBe(0.8);
  });

  it("ignores records for lifecycles the ledger no longer tracks", () => {
    const st = freshState();
    const res = emptyBackfillResult();
    backfillRiskFromRecords(st, [rec("gone", { hasExploit: true })], "2026-03-01T00:00:00Z", res);
    expect(res.ledgerRowsTouched).toBe(0);
    expect(res.episodeRowsTouched).toBe(0);
  });

  it("counts the lifecycles still carrying no signal at all", () => {
    const st = freshState();
    expect(countUnknownRisk(st)).toBe(2);
    backfillRiskFromRecords(st, scanA, "2026-02-01T00:00:00Z", emptyBackfillResult());
    expect(countUnknownRisk(st)).toBe(1); // only the episode is left unfilled
    backfillRiskFromRecords(st, scanB, "2026-03-01T00:00:00Z", emptyBackfillResult());
    expect(countUnknownRisk(st)).toBe(0);
  });
});
