// Remediation coverage / efficiency / rule sensitivity (domain/program.ts).
//
// Three sources, in this order:
//
//   1. gas/test/program.test.ts, ported. The hand-computed worked example is the audit
//      anchor: every figure is worked out in the comment, so the metric can be checked by
//      READING the test rather than by trusting the code.
//   2. Hand cases for the static-analysis rule, which gas/ does not have at all — it has no
//      SAST register. Same discipline: the arithmetic is in the comment.
//   3. Parity against brick/devsecops/metrics.py's own PySpark output
//      (test/fixtures/brick/confusion.json), at 1e-9. That is a SECOND, independent oracle:
//      nothing in that file was typed by a human, it all came out of a DataFrame.collect().
//
// FOUR gas/ blocks are NOT ported, because they test modules that do not exist in this tree
// and are not this package's to write:
//   `withCoverageEfficiency (trend decorator)`   -> src/domain/trend.ts (not ported yet)
//   `compaction preserves coverage & efficiency` -> ledgerCore.baseRows / maintenance
//   `risk-signal backfill (pure core)`           -> maintenance.backfillRiskFromRecords
//   `capacityByMonth`                            -> test/capacity.test.ts in this package
// The first three are behaviour of OTHER modules asserted through program.ts; they should be
// re-instated by whichever package lands those modules.

import { describe, expect, it } from "vitest";
import {
  classifyRisk,
  confusionBySeverity,
  confusionMatrix,
  cweMatchesExploited,
  firedSignals,
  RISK_TIER_ORDER,
  riskTier,
  ruleSensitivity,
  ruleSentence,
  signalBreakdown,
  type AnyRiskRule,
  type ConfusionMatrix,
  type RiskRow,
} from "../src/domain/program";
import {
  CWE_ANCESTORS,
  DEFAULT_RISK_RULE,
  DEFAULT_SAST_RISK_RULE,
  OVERALL,
  SEVERITY_ORDER,
  type RiskRule,
  type SastRiskRule,
} from "../src/domain/config";
import { normalizeSeverity } from "../src/domain/severity";
import { brickFixture, expectParity } from "./helpers";

const RULE: RiskRule = DEFAULT_RISK_RULE; // KEV or exploit or EPSS >= 0.10
const SAST_RULE: SastRiskRule = DEFAULT_SAST_RISK_RULE; // CWE Top 25 or AI verdict or CRITICAL

/** A row with everything observed-and-negative unless overridden — an explicit `low`. */
function row(over: Partial<RiskRow> = {}): RiskRow {
  return {
    scope: "sca",
    severity: "HIGH",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0.01,
    cwe: null,
    ai_verdict: null,
    ...over,
  };
}

/** A row nothing was ever captured for — an explicit `unknown`. */
function unknownRow(over: Partial<RiskRow> = {}): RiskRow {
  return { ...row(), has_kev: null, has_exploit: null, epss: null, ...over };
}

/** A static-analysis row: the CVE signals do not exist, the three SAST ones do. */
function sastRow(over: Partial<RiskRow> = {}): RiskRow {
  return {
    scope: "sast",
    severity: "HIGH",
    status: "OPEN",
    has_kev: null,
    has_exploit: null,
    epss: null,
    cwe: null,
    ai_verdict: null,
    ...over,
  };
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

  it("a NaN EPSS counts as never captured, not as a zero score", () => {
    expect(classifyRisk(row({ epss: NaN }), RULE)).toBe("unknown");
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

// --------------------------------------------------------- the scope dispatch and refusal

describe("the rule comes from the row's scope", () => {
  it("an sca row with no explicit rule is classified by DEFAULT_RISK_RULE", () => {
    expect(classifyRisk(row({ has_kev: true }))).toBe("high");
    expect(classifyRisk(row())).toBe("low");
    expect(classifyRisk(row({ epss: null }))).toBe("unknown");
  });

  it("a sast row with no explicit rule is classified by DEFAULT_SAST_RISK_RULE", () => {
    // Under DEFAULT_RISK_RULE this row would be `unknown` — has_kev/has_exploit/epss are all
    // null on every SAST finding, which is exactly why the second rule exists.
    expect(classifyRisk(sastRow({ cwe: "CWE-79" }), RULE)).toBe("unknown");
    expect(classifyRisk(sastRow({ cwe: "CWE-79" }))).toBe("high");
  });

  // THE REFUSAL. Coverage and efficiency are rates over a high-risk population, and secrets
  // has no high-risk rule: severity there grades a DETECTION (how confident the scanner is
  // that a match is credential-shaped), not whether the credential is live, so a rate over
  // that population would be a number with no referent. Throwing beats returning `unknown`,
  // which a page would render as a confident "0% classified".
  it("REFUSES a secrets row, naming the scope, and an explicit rule does not buy past it", () => {
    const secret = row({ scope: "secrets" });
    expect(() => classifyRisk(secret)).toThrow(/secrets/);
    expect(() => classifyRisk(secret, RULE)).toThrow(/secrets/);
    expect(() => classifyRisk(secret, SAST_RULE)).toThrow(/secrets/);
    expect(() => riskTier(secret)).toThrow(/secrets/);
    expect(() => firedSignals(secret)).toThrow(/secrets/);
    expect(() => confusionMatrix([secret], RULE)).toThrow(/secrets/);
    expect(() => signalBreakdown([secret], RULE)).toThrow(/secrets/);
  });

  it("says why, not just that it refused", () => {
    expect(() => classifyRisk(row({ scope: "secrets" }))).toThrow(/validation_state/);
  });
});

// ------------------------------------------------- the static-analysis rule (brick-only)

describe("the SAST rule — hand cases", () => {
  // The CWE clause is the one carrying external evidence, and it hops one level up the CWE
  // tree because scanners report leaves while the Top 25 holds interior nodes.
  it("a Top-25 CWE fires directly", () => {
    // CWE-79 (Cross-site Scripting) is entry 1 of CWE_TOP_25_2024.
    expect(classifyRisk(sastRow({ cwe: "CWE-79" }), SAST_RULE)).toBe("high");
    expect(cweMatchesExploited("CWE-79")).toBe(true);
  });

  it("a child CWE fires through its documented ancestor", () => {
    // CWE-83 (Improper Neutralization of Script in Attributes in a Web Page) is not itself in
    // the Top 25; CWE_ANCESTORS maps it to CWE-79, which is. Asserted rather than assumed —
    // CWE_ANCESTORS is deliberately incomplete, so the map entry is part of the claim.
    expect(CWE_ANCESTORS["CWE-83"]).toBe("CWE-79");
    expect(classifyRisk(sastRow({ cwe: "CWE-83" }), SAST_RULE)).toBe("high");
    expect(riskTier(sastRow({ cwe: "CWE-83" }), SAST_RULE)).toBe("cwe");
  });

  it("an unmapped CWE does not fire — and that is a coverage gap, not a clean row", () => {
    // CWE-999 is in neither the Top 25 nor CWE_ANCESTORS. The clause is OBSERVED and does not
    // fire, so with the other two signals also observed the row is `low`...
    const observed = sastRow({ cwe: "CWE-999", ai_verdict: "FALSE_POSITIVE", severity: "LOW" });
    expect(classifyRisk(observed, SAST_RULE)).toBe("low");
    // ...but with no AI verdict captured it is `unknown`, not low. Same trap, second rule:
    // "the CWE didn't match" is not evidence about the two clauses nobody answered.
    expect(classifyRisk(sastRow({ cwe: "CWE-999" }), SAST_RULE)).toBe("unknown");
    // Either way it lands in cweUnmapped — the size of the CWE_ANCESTORS gap in findings.
    expect(signalBreakdown([observed], SAST_RULE).cweUnmapped).toBe(1);
  });

  it("no CWE and no verdict is unknown — a blank field is never a `no`", () => {
    expect(classifyRisk(sastRow(), SAST_RULE)).toBe("unknown");
    expect(classifyRisk(sastRow({ cwe: "" }), SAST_RULE)).toBe("unknown");
    expect(classifyRisk(sastRow({ cwe: "   " }), SAST_RULE)).toBe("unknown");
  });

  it("the AI verdict fires only on the listed vocabulary, case-folded", () => {
    expect(classifyRisk(sastRow({ ai_verdict: "TRUE_POSITIVE" }), SAST_RULE)).toBe("high");
    expect(classifyRisk(sastRow({ ai_verdict: "true_positive" }), SAST_RULE)).toBe("high");
    // Observed and not in AI_VERDICTS_HIGH: the clause answers "no", so with a CWE also
    // observed and a severity below CRITICAL the row is decidable.
    expect(
      classifyRisk(
        sastRow({ ai_verdict: "FALSE_POSITIVE", cwe: "CWE-999", severity: "LOW" }),
        SAST_RULE,
      ),
    ).toBe("low");
  });

  it("CRITICAL fires on its own, and an UNKNOWN severity is never captured", () => {
    expect(classifyRisk(sastRow({ severity: "CRITICAL" }), SAST_RULE)).toBe("high");
    // The severity clause is what makes a no-CWE, no-verdict row decidable at all; with the
    // severity itself unknown, nothing is.
    const bare: SastRiskRule = { cwe: false, aiVerdict: false, critical: true };
    expect(classifyRisk(sastRow({ severity: "LOW" }), bare)).toBe("low");
    expect(classifyRisk(sastRow({ severity: null }), bare)).toBe("unknown");
    expect(classifyRisk(sastRow({ severity: "nonsense" }), bare)).toBe("unknown");
  });

  it("a comma-separated CWE list fires if ANY member matches", () => {
    expect(classifyRisk(sastRow({ cwe: "CWE-999,CWE-1000" }), SAST_RULE)).toBe("unknown");
    expect(classifyRisk(sastRow({ cwe: "CWE-999,CWE-89" }), SAST_RULE)).toBe("high");
  });

  it("reports the ai_verdict axis even when it never fires — 0% coverage is the finding", () => {
    // aiAnalysis is null tenant-wide (CLAUDE.md), so AI_VERDICTS_HIGH is UNVERIFIED. A rate
    // computed with a clause that cannot fire and one computed with a clause that fired on
    // nothing are the same number; only the missing count tells them apart. Omitting the
    // axis would delete the only evidence.
    const rows = [sastRow({ cwe: "CWE-79" }), sastRow({ cwe: "CWE-999" }), sastRow()];
    const b = signalBreakdown(rows, SAST_RULE);
    expect(b.fired.aiVerdict).toBe(0);
    expect(b.missing.aiVerdict).toBe(3); // 3 of 3 — the axis's coverage is 0%
    expect(Object.keys(b.missing)).toContain("aiVerdict");
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
    expect(perSev["CRITICAL"]!.coverage.point).toBeCloseTo(50, 9); // 1 of 2
    expect(perSev["LOW"]!.coverage.point).toBeCloseTo(100, 9); // 1 of 1
    expect(overall.coverage.point).toBeCloseTo(66.6666667, 6); // 2 of 3
    expect(perSev["CRITICAL"]!.total + perSev["LOW"]!.total).toBe(overall.total);
  });

  it("omits severities with no rows", () => {
    expect(perSev["MEDIUM"]).toBeUndefined();
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
    expect(b.fired.kev).toBe(1);
    expect(b.fired.exploit).toBe(2);
    expect(b.fired.epss).toBe(1);
    expect(b.anyOf).toBe(3); // not 4: the first row is counted once
    expect(b.fired.kev + b.fired.exploit + b.fired.epss).toBeGreaterThan(b.anyOf);
  });

  it("reports where each signal was never captured", () => {
    expect(b.missing.kev).toBe(1);
    expect(b.missing.exploit).toBe(1);
    expect(b.missing.epss).toBe(1);
  });

  it("keeps the six-signal shape whichever rule is in force — a disabled clause is a 0", () => {
    // The frame's shape must not change when somebody turns a clause off, or a report that
    // reads a column by name silently starts reading `undefined`.
    expect(Object.keys(b.fired).sort()).toEqual(
      ["aiVerdict", "critical", "cwe", "epss", "exploit", "kev"],
    );
    expect(b.fired.cwe).toBe(0);
    expect(b.missing.cwe).toBe(0); // disabled clauses decide nothing, so they report no gap
    expect(b.cweUnmapped).toBe(0);
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
    // LABEL NOTE: gas/'s copy of this test looks up "KEV". This register takes brick's
    // wording — "KEV only" — because brick/devsecops/metrics.py's RULE_SUBSETS is the
    // behavioural spec here and confusion.json pins the label as data. Same subset, same
    // numbers; only the display string moved.
    const pts = ruleSensitivity(rows, RULE);
    const kevOnly = pts.find((p) => p.label === "KEV only")!;
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

  it("sweeps the SAST rule's own three signals, with the same seven subset shapes", () => {
    const pts = ruleSensitivity([sastRow({ cwe: "CWE-79" })], SAST_RULE);
    expect(pts.map((p) => p.label)).toEqual([
      "CWE only", "AI verdict only", "CRITICAL only",
      "CWE or AI verdict", "CWE or CRITICAL", "AI verdict or CRITICAL", "All three",
    ]);
    expect(pts.find((p) => p.active)!.label).toBe("All three");
  });

  it("inherits the EPSS threshold rather than sweeping it", () => {
    const tuned: RiskRule = { ...RULE, epssThreshold: 0.5 };
    for (const p of ruleSensitivity(rows, tuned)) {
      expect((p.rule as RiskRule).epssThreshold).toBe(0.5);
    }
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

  it("reads the static-analysis rule too", () => {
    expect(ruleSentence(SAST_RULE)).toBe(
      "CWE in the Top 25 or AI triage says exploitable or severity CRITICAL",
    );
    expect(ruleSentence({ cwe: false, aiVerdict: false, critical: true })).toBe(
      "severity CRITICAL",
    );
    expect(ruleSentence({ cwe: false, aiVerdict: false, critical: false })).toBe(
      "no signal enabled",
    );
  });
});

describe("firedSignals", () => {
  it("names the clauses behind a high-risk verdict, for the drill-down", () => {
    expect(firedSignals(row({ has_kev: true, epss: 0.5 }), RULE)).toEqual(["kev", "epss"]);
    expect(firedSignals(row(), RULE)).toEqual([]);
    expect(firedSignals(unknownRow(), RULE)).toEqual([]);
  });
});

// ------------------------------------------------------------------------- risk tiers

describe("riskTier", () => {
  const rule = DEFAULT_RISK_RULE;
  const tierRow = (over: Partial<RiskRow> = {}): RiskRow =>
    row({ severity: "CRITICAL", epss: 0, ...over });

  it("splits high risk by which signal fired, worst evidence first", () => {
    // KEV wins even when a public exploit and a high EPSS also fire — a catalogued
    // in-the-wild exploitation is the strongest claim available, so it names the tier.
    expect(riskTier(tierRow({ has_kev: true, has_exploit: true, epss: 0.9 }), rule)).toBe("kev");
    expect(riskTier(tierRow({ has_exploit: true, epss: 0.9 }), rule)).toBe("exploit");
    expect(riskTier(tierRow({ epss: 0.9 }), rule)).toBe("epss");
    expect(riskTier(tierRow(), rule)).toBe("none");
  });

  it("keeps an unmeasured signal unknown rather than inventing a clean row", () => {
    // The trap this whole three-valued scheme exists for: null is NOT captured, not false.
    expect(riskTier(tierRow({ has_kev: null }), rule)).toBe("unknown");
    expect(riskTier(tierRow({ has_exploit: null }), rule)).toBe("unknown");
    expect(riskTier(tierRow({ epss: null }), rule)).toBe("unknown");
    // ...but positive evidence stands on its own, whatever else is missing.
    expect(riskTier(tierRow({ has_kev: true, has_exploit: null, epss: null }), rule)).toBe("kev");
  });

  it("epss uses the rule threshold, at-or-above", () => {
    expect(riskTier(tierRow({ epss: rule.epssThreshold }), rule)).toBe("epss");
    expect(riskTier(tierRow({ epss: rule.epssThreshold - 0.001 }), rule)).toBe("none");
  });

  it("decides nothing when the rule enables no signal", () => {
    const empty: RiskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    expect(riskTier(tierRow({ has_kev: true }), empty)).toBe("unknown");
  });

  it("names the SAST signals on a SAST row, in clause order", () => {
    expect(riskTier(sastRow({ cwe: "CWE-79", severity: "CRITICAL" }), SAST_RULE)).toBe("cwe");
    expect(riskTier(sastRow({ ai_verdict: "CONFIRMED", severity: "CRITICAL" }), SAST_RULE))
      .toBe("aiVerdict");
    expect(riskTier(sastRow({ severity: "CRITICAL" }), SAST_RULE)).toBe("critical");
  });

  // THE LOAD-BEARING ONE. The tiers are a refinement of classifyRisk, not a second opinion:
  // several pages publish an unclassified count over the same register, and if these two ever
  // drift, the reader has no way to tell which is lying. Pinned as an identity over a
  // population that exercises every branch, on BOTH rules.
  it("reconciles with classifyRisk by construction", () => {
    const cases: [RiskRow, AnyRiskRule][] = [
      [tierRow({ has_kev: true }), rule],
      [tierRow({ has_kev: true, has_exploit: true }), rule],
      [tierRow({ has_exploit: true }), rule],
      [tierRow({ epss: 0.42 }), rule],
      [tierRow({ epss: 0.1 }), rule],
      [tierRow(), rule],
      [tierRow({ has_kev: null }), rule],
      [tierRow({ has_exploit: null, epss: null }), rule],
      [tierRow({ status: "RESOLVED", has_exploit: true }), rule],
      [sastRow({ cwe: "CWE-79" }), SAST_RULE],
      [sastRow({ cwe: "CWE-999", ai_verdict: "FALSE_POSITIVE", severity: "LOW" }), SAST_RULE],
      [sastRow({ severity: "CRITICAL" }), SAST_RULE],
      [sastRow(), SAST_RULE],
    ];
    const tiers = cases.map(([r, k]) => riskTier(r, k));
    const classes = cases.map(([r, k]) => classifyRisk(r, k));
    const count = (xs: string[], v: string) => xs.filter((x) => x === v).length;

    const high = tiers.filter((t) => t !== "none" && t !== "unknown").length;
    expect(high).toBe(count(classes, "high"));
    expect(count(tiers, "none")).toBe(count(classes, "low"));
    expect(count(tiers, "unknown")).toBe(count(classes, "unknown"));
    // and the tiers partition the population — no row lands in two, none in zero
    expect(tiers.length).toBe(cases.length);
    expect(new Set(tiers).size).toBeLessThanOrEqual(RISK_TIER_ORDER.length);
    for (const t of tiers) expect(RISK_TIER_ORDER).toContain(t);
  });
});

// =======================================================================================
//  brick/devsecops parity — the second oracle
// =======================================================================================
//
// NAME MAPPING, brick snake_case -> this module's camelCase. Written out rather than derived,
// because a mechanical snake->camel would silently map `coverage_pct` onto a field that does
// not exist and pass by comparing undefined to undefined:
//
//   brick column            this module
//   ----------------------  --------------------------------
//   unknown_remediated      ConfusionMatrix.unknownRemediated
//   unknown_open            ConfusionMatrix.unknownOpen
//   high_risk               ConfusionMatrix.highRisk
//   not_high_risk           ConfusionMatrix.notHighRisk
//   coverage_pct/_lo/_hi    ConfusionMatrix.coverage.{point,lo,hi}
//   efficiency_pct/_lo/_hi  ConfusionMatrix.efficiency.{point,lo,hi}
//   prevalence_pct          ConfusionMatrix.prevalence
//   signal_coverage_pct     ConfusionMatrix.signalCoveragePct
//   severity == "OVERALL"   confusionBySeverity().overall   (config.OVERALL)
//   ai_verdict              SignalBreakdown.{fired,missing}.aiVerdict
//   any_of                  SignalBreakdown.anyOf
//   cwe_unmapped            SignalBreakdown.cweUnmapped
//   rule_label              RuleSensitivityPoint.label
//   rule_sentence           RuleSensitivityPoint.sentence
//   rule_kev/_exploit/_epss RiskRule.{kev,exploit,epss}      (on the point's `rule`)
//   rule_cwe/_ai_verdict/
//     _critical             SastRiskRule.{cwe,aiVerdict,critical}
//   epss_threshold          RiskRule.epssThreshold
//
// NOTHING IS UNMAPPED. Every column of brick's confusion_matrix, signal_breakdown and
// rule_sensitivity frames has a counterpart above, and every field this module publishes is
// asserted by one of them.

/** brick's silver projection of a CVE node, as this register's ledger row. */
function fromCveNode(n: Record<string, any>): RiskRow {
  return {
    scope: "sca",
    severity: normalizeSeverity(n["severity"]),
    status: n["status"],
    has_kev: n["hasCisaKevExploit"] ?? null,
    has_exploit: n["hasExploit"] ?? null,
    epss: n["epssProbability"] ?? null,
    cwe: null,
    ai_verdict: null,
  };
}

/**
 * brick's `silver_sast` projection. Two mappings are load-bearing:
 * `severity` falls back to `originalSeverity`, and `cwe` is the finding's weakness ids
 * sorted, de-duplicated and comma-joined (`_joined_cwes`) — NULL when there are none, never
 * "", because an absent weakness is *not observed* rather than *observed as none*.
 */
function fromSastNode(n: Record<string, any>): RiskRow {
  const ids = ((n["weaknesses"] ?? []) as Record<string, any>[])
    .map((w) => String(w["id"] ?? "").trim())
    .filter((s) => s.length > 0);
  const unique = [...new Set(ids)].sort();
  const verdict = n["aiAnalysis"]?.["verdict"];
  return {
    scope: "sast",
    severity: normalizeSeverity(n["severity"] ?? n["originalSeverity"]),
    status: n["status"],
    has_kev: null,
    has_exploit: null,
    epss: null,
    cwe: unique.length ? unique.join(",") : null,
    ai_verdict: verdict == null ? null : String(verdict).trim().toUpperCase(),
  };
}

function matrixColumns(m: ConfusionMatrix): Record<string, unknown> {
  return {
    tp: m.tp,
    fp: m.fp,
    fn: m.fn,
    tn: m.tn,
    unknown_remediated: m.unknownRemediated,
    unknown_open: m.unknownOpen,
    classified: m.classified,
    unknown: m.unknown,
    total: m.total,
    remediated: m.remediated,
    open: m.open,
    high_risk: m.highRisk,
    not_high_risk: m.notHighRisk,
    coverage_pct: m.coverage.point,
    coverage_lo: m.coverage.lo,
    coverage_hi: m.coverage.hi,
    efficiency_pct: m.efficiency.point,
    efficiency_lo: m.efficiency.lo,
    efficiency_hi: m.efficiency.hi,
    prevalence_pct: m.prevalence,
    signal_coverage_pct: m.signalCoveragePct,
  };
}

/** brick's `order_by_severity(confusion_matrix(df))`: SEVERITY_ORDER, then OVERALL last. */
function brickConfusionRows(rows: RiskRow[], rule: AnyRiskRule): Record<string, unknown>[] {
  const { perSev, overall } = confusionBySeverity(rows, rule);
  const out = SEVERITY_ORDER.filter((s) => perSev[s]).map((s) => ({
    severity: s as string,
    ...matrixColumns(perSev[s]!),
  }));
  out.push({ severity: OVERALL, ...matrixColumns(overall) });
  return out;
}

function brickBreakdown(rows: RiskRow[], rule: AnyRiskRule): Record<string, unknown> {
  const b = signalBreakdown(rows, rule);
  return {
    kev: b.fired.kev,
    exploit: b.fired.exploit,
    epss: b.fired.epss,
    cwe: b.fired.cwe,
    ai_verdict: b.fired.aiVerdict,
    critical: b.fired.critical,
    any_of: b.anyOf,
    kev_missing: b.missing.kev,
    exploit_missing: b.missing.exploit,
    epss_missing: b.missing.epss,
    cwe_missing: b.missing.cwe,
    ai_verdict_missing: b.missing.aiVerdict,
    critical_missing: b.missing.critical,
    cwe_unmapped: b.cweUnmapped,
  };
}

/** brick's `rule_sensitivity`, ordered by `rule_label` the way the exporter dumps it. */
function brickSensitivity(rows: RiskRow[], active: AnyRiskRule): Record<string, unknown>[] {
  return ruleSensitivity(rows, active)
    .map((p) => {
      const flags =
        "cwe" in p.rule
          ? {
              rule_cwe: p.rule.cwe,
              rule_ai_verdict: p.rule.aiVerdict,
              rule_critical: p.rule.critical,
            }
          : {
              rule_kev: p.rule.kev,
              rule_exploit: p.rule.exploit,
              rule_epss: p.rule.epss,
              epss_threshold: p.rule.epssThreshold,
            };
      return {
        rule_label: p.label,
        ...matrixColumns(p.matrix),
        ...flags,
        rule_sentence: p.sentence,
        active: p.active,
      };
    })
    // Codepoint order, not localeCompare: Spark's `orderBy` on a string column is a binary
    // comparison, and a locale-aware collator is free to disagree with it (it folds case at
    // the primary level, which is exactly what separates "KEV or EPSS" from "KEV or exploit").
    .sort((a, b) => {
      const x = String(a["rule_label"]);
      const y = String(b["rule_label"]);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

describe("brick parity — confusion.json", () => {
  const cases = brickFixture<{ cases: any[] }>("confusion").cases;

  const CASE_RULES: Record<string, { rule: AnyRiskRule; toRow: (n: any) => RiskRow }> = {
    cve_population: { rule: DEFAULT_RISK_RULE, toRow: fromCveNode },
    sast_population: { rule: DEFAULT_SAST_RISK_RULE, toRow: fromSastNode },
  };

  it("covers exactly the two populations the exporter dumps", () => {
    expect(cases.map((c) => c.name)).toEqual(["cve_population", "sast_population"]);
  });

  for (const c of cases) {
    const { rule, toRow } = CASE_RULES[c.name]!;
    const rows: RiskRow[] = c.input.nodes.map(toRow);

    describe(c.name, () => {
      it("agrees with Spark on the rule's own sentence", () => {
        expect(ruleSentence(rule)).toBe(c.params.rule_sentence);
      });

      it("agrees on every per-severity confusion row and the OVERALL aggregate", () => {
        expectParity(brickConfusionRows(rows, rule), c.expected.confusion_matrix, 1e-9);
      });

      it("agrees on the signal breakdown, including cwe_unmapped", () => {
        expectParity(brickBreakdown(rows, rule), c.expected.signal_breakdown, 1e-9);
      });

      it("agrees on all seven rule-sensitivity subsets", () => {
        expectParity(brickSensitivity(rows, rule), c.expected.rule_sensitivity, 1e-9);
      });
    });
  }
});
