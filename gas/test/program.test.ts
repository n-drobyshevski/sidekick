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
  capacityHindcast,
  capacityRowsAsOf,
  classifyRisk,
  confusionBySeverity,
  confusionMatrix,
  DEFAULT_RISK_RULE,
  firedSignals,
  movementDecomposition,
  movementWindowScans,
  NET_CAPACITY_BAND_PCT,
  type MovementRow,
  ruleSensitivity,
  RISK_TIER_ORDER,
  riskTier,
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

  it("skips an unparseable scan ts rather than dating the first scan to 1970", () => {
    // FOUND BY PERTURBING THIS GUARD while writing the hindcast below: the refusal existed
    // and nothing in the suite fired on it. `Number("")` and `Number(null)` are both 0 and
    // both finite, so a blank ts admitted as epoch 0 becomes the EARLIEST flat scan — and
    // `reconstructed` is `end <= firstScanMs`, so every month in the register would report
    // itself directly observed and every pre-scan closure would be counted as real.
    const out = capacityByMonth(
      rows,
      [{ ts: "", shape: "flat", resolved_count: 0 }, ...scans],
      { rule: RULE, now: NOW },
    );
    const jan = out.months.find((m) => m.month === "2026-01")!;
    // January still ends after the real first scan (2 January), so it is observed — but that
    // has to be true because of the January scan, not because of a scan dated to 1970.
    expect(jan.reconstructed).toBe(false);
    const before = capacityByMonth(
      [...rows, { ...row(), first_seen: "2025-06-05T00:00:00Z", resolved_at: null }],
      [{ ts: "", shape: "flat", resolved_count: 0 }, ...scans],
      { rule: RULE, now: NOW },
    );
    expect(before.months.find((m) => m.month === "2025-06")!.reconstructed).toBe(true);
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

// The verdict, replayed against what happened next.
//
// Every fixture here is hand-built, and the arithmetic is stated beside it, because the thing
// under test is a claim about the PAST: a verdict computed from rows as they stood on a date,
// scored against a month that had not happened yet. A fixture generated from today's register
// could not tell the two apart.
//
// One measurement worth recording where the next reader will find it. Inside
// `capacityByMonth(…, { now: ts })` the as-of masking changes NOTHING today: that function
// never scores the month containing `now`, and no earlier month can see a resolution dated
// after `ts` — such a row is already "open at start" of every month it builds. So perturbing
// the masking and re-running the hindcast's headline numbers falsifies nothing, which is why
// the load-bearing test below is aimed at `capacityRowsAsOf` directly, where it bites. See
// that function's own header for why the masking stays.
describe("capacityHindcast", () => {
  const NOW = Date.parse("2026-05-10T00:00:00Z");
  const capRow = (first: string, resolved: string | null) => ({
    ...row(),
    first_seen: first,
    resolved_at: resolved,
  });
  const flat = (ts: string, resolved_count = 0) => ({ ts, shape: "flat", resolved_count });
  const many = (n: number, first: string, resolved: string | null) =>
    Array.from({ length: n }, () => capRow(first, resolved));
  const DAY = 86_400_000;

  // Ten findings born in December, five more in January, six of the fifteen closed in March.
  //   Dec  openAtStart  0  (nothing existed before it)      -> no rate, never counted
  //   Jan  openAtStart 10, opened 5, closed 0 -> net -50%   -> falling behind
  //   Feb  openAtStart 15, opened 0, closed 0 -> net   0%   -> keeping up
  //   Mar  openAtStart 15, opened 0, closed 6 -> net +40%   -> gaining ground
  const F1_ROWS = [
    ...many(6, "2025-12-05T00:00:00Z", "2026-03-10T00:00:00Z"),
    ...many(4, "2025-12-05T00:00:00Z", null),
    ...many(5, "2026-01-10T00:00:00Z", null),
  ];
  const F1_SCANS = [
    flat("2025-12-05T00:00:00Z"),
    flat("2026-01-02T00:00:00Z"),
    flat("2026-02-02T00:00:00Z"),
  ];

  it("hindcasts nothing when no month has closed since the scan", () => {
    // A scan on 15 April is scored against MAY, the first month it could still have moved —
    // and May is still running on 10 May. No row, rather than a row grading the verdict
    // against a fortnight.
    const out = capacityHindcast(F1_ROWS, [flat("2026-04-15T00:00:00Z")], {
      rule: RULE,
      now: NOW,
    });
    expect(out.rows).toEqual([]);
    expect(out.comparable).toBe(0);
    expect(out.counterperformative).toBe(0);
    expect(out.scansConsidered).toBe(1); // it was read; it just had nothing to be scored against
  });

  // THE LOAD-BEARING ONE. A row resolved after the as-of date was OPEN on that date, and a
  // replay that reads today's `resolved_at` hands the past verdict closures that had not
  // happened yet — a program graded on a future it already knew.
  it("treats a row resolved after the as-of date as open at that date", () => {
    const ts = Date.parse("2026-02-02T00:00:00Z");
    const register = [
      { first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-03T00:00:00Z" }, // a day late
      { first_seen: "2026-01-06T00:00:00Z", resolved_at: "2026-01-20T00:00:00Z" }, // really closed
      { first_seen: "2026-02-10T00:00:00Z", resolved_at: null },                   // not born yet
      { first_seen: "", resolved_at: null },                                       // no birth date
    ];
    const asOf = capacityRowsAsOf(register, ts);

    expect(asOf.map((r) => r.first_seen)).toEqual([
      "2026-01-05T00:00:00Z",
      "2026-01-06T00:00:00Z",
    ]);
    expect(asOf[0]!.resolved_at).toBeNull();                        // open on 2 February
    expect(asOf[1]!.resolved_at).toBe("2026-01-20T00:00:00Z");      // closed, and stays closed
    // A row whose birth date will not parse is DROPPED, not dated 1970 and counted as the
    // oldest thing in the register.
    expect(asOf.some((r) => r.first_seen === "")).toBe(false);
    // The caller's own rows are never mutated — the mask is a copy.
    expect(register[0]!.resolved_at).toBe("2026-02-03T00:00:00Z");
  });

  it("marks a falling-behind verdict followed by a gain as counterperformative", () => {
    const out = capacityHindcast(F1_ROWS, F1_SCANS, { rule: RULE, now: NOW });
    const feb = out.rows.find((r) => r.asOf === "2026-02-02T00:00:00Z")!;
    // As of 2 February the only complete, observed month with a backlog is January: -50%.
    expect(feb.verdict).toBe("falling-behind");
    // March — the first month the 2 February verdict could still have moved — gained 40%.
    expect(feb.realisedNetPct).toBe(40);
    expect(feb.agreed).toBe(false);
    expect(out.counterperformative).toBe(1);
    expect(out.comparable).toBe(1);
  });

  it("reports agreed as null, never false, when either side is unobservable", () => {
    // Side one: no verdict that day. As of 2 January the only month behind the scan is
    // December, which had nothing open at its start, so there is no rate to average.
    const out = capacityHindcast(F1_ROWS, F1_SCANS, { rule: RULE, now: NOW });
    const jan = out.rows.find((r) => r.asOf === "2026-01-02T00:00:00Z")!;
    expect(jan.verdict).toBeNull();
    expect(jan.realisedNetPct).toBe(0); // February was observed; the verdict was not
    expect(jan.agreed).toBeNull();

    // Side two: a verdict, and no month to score it against. Everything closes in January, so
    // March opens with nothing at all and has no net rate.
    const emptied = capacityHindcast(
      many(10, "2025-12-05T00:00:00Z", "2026-01-20T00:00:00Z"),
      [flat("2025-12-05T00:00:00Z"), flat("2026-02-02T00:00:00Z")],
      { rule: RULE, now: NOW },
    );
    const feb = emptied.rows.find((r) => r.asOf === "2026-02-02T00:00:00Z")!;
    expect(feb.verdict).toBe("gaining"); // January closed all ten of them
    expect(feb.realisedNetPct).toBeNull();
    expect(feb.agreed).toBeNull();
    expect(emptied.comparable).toBe(0);
  });

  it("a month inside the dead band agrees with keeping-up", () => {
    // One arrival a month against a hundred open is -1%, inside NET_CAPACITY_BAND_PCT either
    // side of zero. The verdict says keeping up and the month keeps up: agreed, not a miss.
    const rows = [
      ...many(100, "2025-12-05T00:00:00Z", null),
      capRow("2026-01-10T00:00:00Z", null),
      capRow("2026-03-10T00:00:00Z", null),
    ];
    const out = capacityHindcast(
      rows,
      [flat("2025-12-05T00:00:00Z"), flat("2026-02-02T00:00:00Z")],
      { rule: RULE, now: NOW },
    );
    const feb = out.rows.find((r) => r.asOf === "2026-02-02T00:00:00Z")!;
    expect(feb.verdict).toBe("keeping-up");
    expect(feb.realisedNetPct).toBeCloseTo(-0.990099, 5); // -1 / 101
    expect(Math.abs(feb.realisedNetPct!)).toBeLessThanOrEqual(NET_CAPACITY_BAND_PCT);
    expect(feb.agreed).toBe(true);
    expect(out.comparable).toBe(1);
    expect(out.counterperformative).toBe(0);
  });

  it("a grouped scan is not an as-of point", () => {
    // A grouped scan carries no per-finding rows, so there is no register to replay against
    // it — the same exclusion capacityByMonth makes for the same reason.
    const out = capacityHindcast(
      F1_ROWS,
      [...F1_SCANS, { ts: "2026-02-20T00:00:00Z", shape: "grouped", resolved_count: 99 }],
      { rule: RULE, now: NOW },
    );
    expect(out.scansConsidered).toBe(3);
    expect(out.rows.map((r) => r.asOf)).not.toContain("2026-02-20T00:00:00Z");
  });

  it("respects the scans cap and says so", () => {
    const out = capacityHindcast(F1_ROWS, F1_SCANS, { rule: RULE, now: NOW, scansCap: 2 });
    // Newest first, so the December scan is the one dropped.
    expect(out.rows.map((r) => r.asOf)).toEqual([
      "2026-02-02T00:00:00Z",
      "2026-01-02T00:00:00Z",
    ]);
    expect(out.scansConsidered).toBe(2);
    expect(out.scansCap).toBe(2);
    // And the cap is reported apart from the count, so "only two scans exist" reads
    // differently from "only two were read".
    expect(capacityHindcast(F1_ROWS, F1_SCANS, { rule: RULE, now: NOW }).scansCap).toBe(24);
  });

  it("an unparseable scan ts is skipped, not placed at epoch 0", () => {
    // Number(null) is 0 and Number("") is 0, and both are finite. A scan dated to epoch 0
    // would replay the whole register against January 1970 — every row unborn, every verdict
    // null — and it would sort to the bottom of the table looking like real history.
    const scans = [
      ...F1_SCANS,
      { ts: "", shape: "flat", resolved_count: 0 },
      { ts: null, shape: "flat", resolved_count: 0 },
      { ts: "not a date", shape: "flat", resolved_count: 0 },
      { ts: [], shape: "flat", resolved_count: 0 },
    ];
    const out = capacityHindcast(F1_ROWS, scans, { rule: RULE, now: NOW });
    expect(out.scansConsidered).toBe(3);
    expect(out.rows.some((r) => r.asOf.startsWith("1970"))).toBe(false);
  });

  it("costs about 140 ms on a 20k-row, 24-scan register", () => {
    // MEASURED, on the shape the live register is heading for. Timed after the two
    // capacityByMonth passes programData already runs, so the paths are as warm as they are
    // in production: 142 ms whole-register, 82 ms high-risk-only (which is what the payload
    // actually asks for). Before the domain parsed the register ONCE instead of once per
    // scan it was 636 ms, and Date.parse was the entire difference.
    //
    // The ceiling below is a smoke bound, not the measurement — a machine ten times slower
    // than this one still passes, and 636 ms would have too. What it catches is the shape
    // going quadratic, which is the way this function actually breaks.
    const rows: (RiskRow & { first_seen: string; resolved_at: string | null })[] = [];
    const start = Date.parse("2024-06-01T00:00:00Z");
    for (let i = 0; i < 20000; i++) {
      const born = start + (i % 700) * DAY;
      rows.push({
        ...row({ has_kev: i % 4 === 0 }),
        first_seen: new Date(born).toISOString(),
        resolved_at: i % 3 === 0 ? new Date(born + 40 * DAY).toISOString() : null,
      });
    }
    const scans = Array.from({ length: 24 }, (_, i) =>
      flat(new Date(Date.parse("2024-08-01T00:00:00Z") + i * 30 * DAY).toISOString(), 3));
    const now = Date.parse("2026-09-01T00:00:00Z");
    capacityByMonth(rows, scans, { rule: RULE, now, maxMonths: 24 });
    capacityByMonth(rows, scans, { rule: RULE, highRiskOnly: true, now, maxMonths: 24 });

    const t0 = Date.now();
    const out = capacityHindcast(rows, scans, {
      rule: RULE, highRiskOnly: true, now, scansCap: 24,
    });
    const elapsed = Date.now() - t0;
    expect(out.rows.length).toBe(24);
    expect(elapsed).toBeLessThan(3000);
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
      published_date: null,
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
    published_date: null,
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
      published_date: null,
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

// ------------------------------------------------------------------------- risk tiers

describe("riskTier", () => {
  const rule = DEFAULT_RISK_RULE;
  const row = (over: Partial<RiskRow> = {}): RiskRow => ({
    severity: "CRITICAL",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    ...over,
  });

  it("splits high risk by which signal fired, worst evidence first", () => {
    // KEV wins even when a public exploit and a high EPSS also fire — a catalogued
    // in-the-wild exploitation is the strongest claim available, so it names the tier.
    expect(riskTier(row({ has_kev: true, has_exploit: true, epss: 0.9 }), rule)).toBe("kev");
    expect(riskTier(row({ has_exploit: true, epss: 0.9 }), rule)).toBe("exploit");
    expect(riskTier(row({ epss: 0.9 }), rule)).toBe("epss");
    expect(riskTier(row(), rule)).toBe("none");
  });

  it("keeps an unmeasured signal unknown rather than inventing a clean row", () => {
    // The trap this whole three-valued scheme exists for: null is NOT captured, not false.
    expect(riskTier(row({ has_kev: null }), rule)).toBe("unknown");
    expect(riskTier(row({ has_exploit: null }), rule)).toBe("unknown");
    expect(riskTier(row({ epss: null }), rule)).toBe("unknown");
    // ...but positive evidence stands on its own, whatever else is missing.
    expect(riskTier(row({ has_kev: true, has_exploit: null, epss: null }), rule)).toBe("kev");
  });

  it("epss uses the rule threshold, at-or-above", () => {
    expect(riskTier(row({ epss: rule.epssThreshold }), rule)).toBe("epss");
    expect(riskTier(row({ epss: rule.epssThreshold - 0.001 }), rule)).toBe("none");
  });

  it("decides nothing when the rule enables no signal", () => {
    const empty: RiskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    expect(riskTier(row({ has_kev: true }), empty)).toBe("unknown");
  });

  // THE LOAD-BEARING ONE. The tiers are a refinement of classifyRisk, not a second opinion:
  // the OS-vulnerabilities page and the Program page both publish an unclassified count over
  // the same fleet, and if these two ever drift, the reader has no way to tell which is
  // lying. Pinned as an identity over a population that exercises every branch.
  it("reconciles with classifyRisk by construction", () => {
    const rows: RiskRow[] = [
      row({ has_kev: true }),
      row({ has_kev: true, has_exploit: true }),
      row({ has_exploit: true }),
      row({ epss: 0.42 }),
      row({ epss: 0.1 }),
      row(),
      row({ has_kev: null }),
      row({ has_exploit: null, epss: null }),
      row({ status: "RESOLVED", has_exploit: true }),
    ];
    const tiers = rows.map((r) => riskTier(r, rule));
    const classes = rows.map((r) => classifyRisk(r, rule));
    const count = (xs: string[], v: string) => xs.filter((x) => x === v).length;

    const high = count(tiers, "kev") + count(tiers, "exploit") + count(tiers, "epss");
    expect(high).toBe(count(classes, "high"));
    expect(count(tiers, "none")).toBe(count(classes, "low"));
    expect(count(tiers, "unknown")).toBe(count(classes, "unknown"));
    // and the tiers partition the population — no row lands in two, none in zero
    expect(tiers.length).toBe(rows.length);
    expect(new Set(tiers).size).toBeLessThanOrEqual(RISK_TIER_ORDER.length);
    for (const t of tiers) expect(RISK_TIER_ORDER).toContain(t);
  });
});

describe("movementDecomposition", () => {
  // A HAND-BUILT WIDE-THEN-NARROW FIXTURE. The dev fixture cannot serve here: it carries no
  // `scans` rows at all (verified), and every figure below is a difference between two scans.
  //
  // The shape is the one this metric exists for — a register whose gate narrowed mid-window:
  //
  //   T1  2026-01-10  flat, gate CRITICAL/HIGH/MEDIUM   <- the window's `since` endpoint
  //   T2  2026-02-10  flat, gate CRITICAL/HIGH          <- the gate narrowed here
  //   T3  2026-03-10  flat, gate CRITICAL/HIGH          <- the window's `until` endpoint
  //
  // and five lifecycles, worked out in full so this block is the audit trail:
  //
  //   #1 MEDIUM, open, born 01-05   in the gate at T1, OUTSIDE it at T3. Never resolved, so it
  //                                 is in neither resolution bucket — it is open and unmeasured.
  //   #2 HIGH,   born 01-05, resolved 02-15 by "api"          -> observed
  //   #3 HIGH,   born 01-06, resolved 03-01 by "disappeared"  -> bounded
  //   #4 CRITICAL, born 2025-12-01, resolved 01-05 by "api"   -> BEFORE the window; not counted
  //   #5 HIGH,   born 02-20, still open                       -> the window's one arrival
  //
  //   open at T1 (since) = #1, #2, #3                     = 3
  //   open at T3 (until) = #1, #5                         = 2
  //   netChange                                           = 2 - 3 = -1
  //   arrivals 1 - observed 1 - bounded 1 + reopened 0    = -1     -> identityGap 0
  //
  // The T1 scan carries `new_count: 99` and `reopened_count: 7` on purpose: the window is
  // half-open (since < ts <= until), so the scan that OPENS the window describes the period
  // before it, and counting it would blow the identity by 106 rather than by a rounding.
  const T1 = "2026-01-10T00:00:00Z";
  const T2 = "2026-02-10T00:00:00Z";
  const T3 = "2026-03-10T00:00:00Z";
  const WINDOW = { since: T1, until: T3 };
  // The stored form, NOT "CRITICAL,HIGH": scans.severities is the JSON `serializeSeverities`
  // writes, and `parseSeverities` answers null for anything JSON.parse refuses — a
  // comma-string gate would read as NO gate and quietly zero outsideGate.
  const WIDE = '["CRITICAL", "HIGH", "MEDIUM"]';
  const NARROW = '["CRITICAL", "HIGH"]';

  type MoveScan = {
    ts?: unknown; shape?: unknown; severities?: unknown;
    new_count?: unknown; reopened_count?: unknown;
  };

  const scans = (): MoveScan[] => [
    { ts: T1, shape: "flat", severities: WIDE, new_count: 99, reopened_count: 7 },
    { ts: T2, shape: "flat", severities: NARROW, new_count: 0, reopened_count: 0 },
    { ts: T3, shape: "flat", severities: NARROW, new_count: 1, reopened_count: 0 },
  ];

  const mrow = (o: Partial<MovementRow>): MovementRow => ({
    severity: "HIGH", status: "OPEN", first_seen: null, resolved_at: null,
    resolution_src: null, ...o,
  });

  const rows: MovementRow[] = [
    mrow({ severity: "MEDIUM", first_seen: "2026-01-05T00:00:00Z" }),
    mrow({
      status: "RESOLVED", first_seen: "2026-01-05T00:00:00Z",
      resolved_at: "2026-02-15T00:00:00Z", resolution_src: "api",
    }),
    mrow({
      status: "RESOLVED", first_seen: "2026-01-06T00:00:00Z",
      resolved_at: "2026-03-01T00:00:00Z", resolution_src: "disappeared",
    }),
    mrow({
      severity: "CRITICAL", status: "RESOLVED", first_seen: "2025-12-01T00:00:00Z",
      resolved_at: "2026-01-05T00:00:00Z", resolution_src: "api",
    }),
    mrow({ first_seen: "2026-02-20T00:00:00Z" }),
  ];

  const out = movementDecomposition(rows, scans(), WINDOW);

  it("a MEDIUM row outside the narrowed gate is counted as unmeasured, not as resolved", () => {
    // The whole point of the figure: this row did not go anywhere. The last scan simply
    // stopped asking about its severity, and a headline that improved for that reason has to
    // say so in a different word from the one it uses for a fix.
    expect(out.outsideGate).toBe(1);
    expect(out.observed).toBe(1);
    expect(out.bounded).toBe(1);
    expect(out.unattributed).toBe(0);
    // Still open, still in the replay at both ends — it cancels out of netChange entirely.
    expect(out.netChange).toBe(-1);
  });

  it("a null gate contributes zero to outsideGate, not the whole register", () => {
    // Four spellings of "no gate was applied" and all four reach here: a column never
    // written, an older row carrying the empty string, a serialized empty list, and a value
    // JSON.parse refuses. `parseSeverities` answers null to all four, and null must mean
    // every severity was in scope — never that every open row is outside it.
    for (const gate of [null, undefined, "", "[]", "CRITICAL,HIGH"]) {
      const ungated = scans().map((s) =>
        s["ts"] === T1 ? s : { ...s, severities: gate });
      const m = movementDecomposition(rows, ungated, WINDOW);
      expect(m.outsideGate, `gate ${JSON.stringify(gate)}`).toBe(0);
      // ...and nothing else moved: the gate decides one field and only one.
      expect(m.observed).toBe(1);
      expect(m.netChange).toBe(-1);
    }
    // The register has five rows and two of them are open; a "gate matches nothing"
    // implementation would report 2 here, not 0.
    expect(rows.filter((r) => r.status === "OPEN").length).toBe(2);
  });

  it("a grouped scan's new_count is not an arrival", () => {
    // A grouped scan is counts-only — it carries no per-finding rows, so its deltas cannot be
    // reconciled against a replay of rows. Same exclusion capacityByMonth makes.
    const withGrouped = [
      ...scans(),
      { ts: "2026-02-20T00:00:00Z", shape: "grouped", severities: NARROW,
        new_count: 500, reopened_count: 500 },
    ];
    const m = movementDecomposition(rows, withGrouped, WINDOW);
    expect(m.arrivals).toBe(1);
    expect(m.reopened).toBe(0);
    expect(m.scansInWindow).toBe(2);
    expect(m.identityHolds).toBe(true);
  });

  it("a resolution before the window is not in the window", () => {
    // #4 was resolved on 01-05, five days before `since`. It is in neither bucket here...
    expect(out.observed + out.bounded + out.unattributed).toBe(2);
    // ...and it is not a hidden zero either: widen the window back over it and it appears.
    const wider = movementDecomposition(rows, scans(), {
      since: "2025-12-15T00:00:00Z", until: T3,
    });
    expect(wider.observed).toBe(2);
  });

  it("the identity holds on the wide-then-narrow fixture", () => {
    // Hand-computed above: open 3 at T1, open 2 at T3.
    expect(out.netChange).toBe(-1);
    expect(out.arrivals).toBe(1);
    expect(out.reopened).toBe(0);
    expect(out.arrivals - out.observed - out.bounded + out.reopened).toBe(-1);
    expect(out.identityGap).toBe(0);
    expect(out.identityHolds).toBe(true);
    expect(out.scansInWindow).toBe(2);
    expect(out.skippedScans).toBe(0);
    expect(out.partialCounts).toBe(0);
    expect(out.unplacedRows).toBe(0);
  });

  it("publishes the gap rather than balancing the books", () => {
    // Perturbation: the T3 scan forgets the one finding that clearly arrived (#5 is in the
    // rows with first_seen 02-20, and the replay counts it). The two sides now disagree by
    // exactly one finding, and the figure has to SAY so rather than deriving one side from
    // the other.
    const forgetful = scans().map((s) => (s["ts"] === T3 ? { ...s, new_count: 0 } : s));
    const m = movementDecomposition(rows, forgetful, WINDOW);
    expect(m.netChange).toBe(-1); // the replay is untouched
    expect(m.arrivals).toBe(0);
    expect(m.identityGap).toBe(-1 - (0 - 1 - 1 + 0));
    expect(m.identityGap).toBe(1);
    expect(m.identityHolds).toBe(false);
  });

  it("a non-finite new_count is refused and reported, not read as zero", () => {
    // `undefined` is in the list but NOT in the claim below, and the difference is the
    // finding: `Number(undefined)` is NaN, which `Number.isFinite` would have caught. The
    // other four cast to a finite 0 — that is the set a cast-then-isFinite guard reads as a
    // measured "nothing arrived", and the reason the type test has to come first.
    for (const bad of [null, "", [], false]) {
      expect(Number(bad as never), `Number(${JSON.stringify(bad)})`).toBe(0);
      expect(Number.isFinite(Number(bad as never))).toBe(true);
      const broken = scans().map((s) => (s["ts"] === T3 ? { ...s, new_count: bad } : s));
      const m = movementDecomposition(rows, broken, WINDOW);
      expect(m.arrivals, `new_count ${JSON.stringify(bad)}`).toBe(0);
      expect(m.partialCounts).toBe(1);
      // ...and the refusal shows up as a gap rather than as a confident total.
      expect(m.identityHolds).toBe(false);
      expect(m.identityGap).toBe(1);
    }
    // An absent key takes the same path, for a different reason at the cast (NaN, not 0).
    const missing = scans().map((s) => (s["ts"] === T3 ? { ts: T3, shape: "flat" } : s));
    const m = movementDecomposition(rows, missing, WINDOW);
    expect(m.arrivals).toBe(0);
    expect(m.reopened).toBe(0);
    expect(m.partialCounts).toBe(2); // new_count AND reopened_count, both refused
  });

  it("outsideGate is not summed into administrative", () => {
    // PERTURBATION (run 2026-09-06, reverted): folding the stock into the flow —
    //     administrative: bounded + outsideGate,
    // in src/domain/program.ts. Observed, whole suite — 1 failed | 1329 passed | 1 skipped:
    //   FAIL  |pure| test/program.test.ts > movementDecomposition > outsideGate is not summed
    //         into administrative
    //         AssertionError: expected 2 to be 1 // Object.is equality
    // ONE test, and the second one predicted did NOT fire, which is worth recording:
    // test/historyModel.test.js builds its own payload and so cannot see a domain defect at
    // all. The view's sentence is pinned there; the arithmetic is pinned only here.
    // The arithmetic reason it must not: outsideGate is a STOCK — those rows stay outside the
    // gate on every window until someone widens it — so summing it in re-charges the same
    // rows as fresh administrative movement every time the page is opened, and breaks the
    // identity that makes the two halves reconcilable with netChange.
    expect(out.administrative).toBe(out.bounded);
    expect(out.administrative).toBe(1);
    expect(out.administrative).not.toBe(out.bounded + out.outsideGate);
    expect(out.measured + out.administrative).toBe(2);
    expect(out.outsideGate).toBe(1);
  });

  it("a scan whose ts will not parse sits in no window and is counted", () => {
    const broken = [...scans(), { ts: "not a date", shape: "flat", new_count: 40 }];
    const m = movementDecomposition(rows, broken, WINDOW);
    expect(m.skippedScans).toBe(1);
    expect(m.arrivals).toBe(1);
    expect(m.scansInWindow).toBe(2);
  });

  it("a resolution with no usable provenance is unattributed, not administrative", () => {
    // Neither measured nor administrative: nothing recorded HOW the date was arrived at, and
    // filing it under either heading would be an invention.
    const odd = [...rows, mrow({
      status: "RESOLVED", first_seen: "2026-01-08T00:00:00Z",
      resolved_at: "2026-02-01T00:00:00Z", resolution_src: "manual",
    })];
    const m = movementDecomposition(odd, scans(), WINDOW);
    expect(m.unattributed).toBe(1);
    expect(m.observed).toBe(1);
    expect(m.bounded).toBe(1);
    // It moved the replay by one and is in neither side of the identity, so it is exactly
    // the gap — which is the honest place for it.
    expect(m.identityGap).toBe(-1);
  });

  it("refuses an unparseable or inverted window rather than returning a zeroed movement", () => {
    // A Movement of all zeroes reads as "nothing happened", which is a measurement; no
    // measurement was made.
    expect(() => movementDecomposition(rows, scans(), { since: "nope", until: T3 })).toThrow();
    expect(() => movementDecomposition(rows, scans(), { since: T3, until: T1 })).toThrow();
  });
});

describe("movementWindowScans — the endpoints are scans, not calendar dates", () => {
  const D = (iso: string) => Date.parse(iso);
  const flat = (iso: string) => ({ ts: iso, shape: "flat" });

  it("takes the newest scan and the newest one at least 28 days older", () => {
    // Four scans; the qualifying pair is the SHORTEST window that still clears 28 days, so
    // the figure describes the most recent 28 days of scanning rather than the whole ledger.
    const w = movementWindowScans([
      flat("2026-01-01T00:00:00Z"),
      flat("2026-02-01T00:00:00Z"),
      flat("2026-02-20T00:00:00Z"),
      flat("2026-03-21T00:00:00Z"),
    ], 28);
    expect(w.reason).toBeNull();
    expect(w.since).toBe(D("2026-02-20T00:00:00Z")); // 29 days back, not 48 and not 78
    expect(w.until).toBe(D("2026-03-21T00:00:00Z"));
    expect(w.days).toBe(29);
  });

  it("refuses a pair closer than the minimum, and publishes the span it does have", () => {
    // The reader learns "this register has only been saving scans for 9 days" — a fact about
    // the register — rather than the bare "no comparison", which reads as a defect.
    const w = movementWindowScans([
      flat("2026-03-12T00:00:00Z"), flat("2026-03-18T00:00:00Z"), flat("2026-03-21T00:00:00Z"),
    ], 28);
    expect(w.reason).toBe("tooClose");
    expect(w.since).toBeNull();
    expect(w.until).toBe(D("2026-03-21T00:00:00Z"));
    expect(w.days).toBe(9);
  });

  it("names the one-scan and no-scan cases apart", () => {
    expect(movementWindowScans([], 28).reason).toBe("noScans");
    expect(movementWindowScans([flat("2026-03-21T00:00:00Z")], 28).reason).toBe("oneScan");
    // ...and a ledger of nothing but grouped scans is a ledger of no usable scans: a
    // counts-only scan carries no per-finding rows for the decomposition to replay against.
    const grouped = [
      { ts: "2026-01-01T00:00:00Z", shape: "grouped" },
      { ts: "2026-03-21T00:00:00Z", shape: "grouped" },
    ];
    expect(movementWindowScans(grouped, 28).reason).toBe("noScans");
  });

  it("a scan whose ts will not parse is not an endpoint", () => {
    const w = movementWindowScans([
      { ts: "", shape: "flat" },
      { ts: null, shape: "flat" },
      flat("2026-01-01T00:00:00Z"),
      flat("2026-03-21T00:00:00Z"),
    ], 28);
    expect(w.reason).toBeNull();
    expect(w.since).toBe(D("2026-01-01T00:00:00Z"));
    expect(w.days).toBe(79);
  });

  it("accepts scans in any stored order — the ledger tab is not sorted by contract", () => {
    const shuffled = [
      flat("2026-03-21T00:00:00Z"), flat("2026-01-01T00:00:00Z"), flat("2026-02-20T00:00:00Z"),
    ];
    const w = movementWindowScans(shuffled, 28);
    expect(w.until).toBe(D("2026-03-21T00:00:00Z"));
    expect(w.since).toBe(D("2026-02-20T00:00:00Z"));
  });
});
