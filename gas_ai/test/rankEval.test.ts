// What the rank evaluation must not be allowed to do quietly.
//
// Every case here is about one of two failures. The first is a ranker that looks good because
// the labels were generous: a row whose horizon runs past the last sync that could have seen
// it leave is UNKNOWN, and reading that silence as "still open" would inflate every precision
// figure while making the register look more decisive. The second is a figure that exists at
// all when it should not: two syncs under one scope are the minimum for a single label, and an
// evaluation with nothing to measure has to say so rather than publish zeroes.

import { describe, expect, it } from "vitest";
import { DEFAULT_RANK_RULE, type RankRule } from "../src/domain/rank";
import type { IssueLedgerRow } from "../src/domain/issueLedger";
import { evaluateRank, type RankEvalSync } from "../src/domain/rankEval";

const DAY = 86400000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const day = (n: number): string => new Date(T0 + n * DAY).toISOString();

const SCOPE_A = "categories=AI_SECURITY";
const SCOPE_B = "categories=AI_SECURITY,DATA_SECURITY";

function sync(id: string, atDay: number, scope = SCOPE_A): RankEvalSync {
  return { syncId: id, finishedAt: day(atDay), registerScope: scope };
}

/** One ledger row, at the grain the reconcile writes it: a birth sync and maybe a departure. */
function row(
  issueId: string,
  ruleId: string,
  opts: { goneDay?: number; dueDay?: number; scope?: string } = {},
): IssueLedgerRow {
  const gone = opts.goneDay === undefined ? null : day(opts.goneDay);
  return {
    issueId,
    firstSeenSync: "s0",
    firstSeenAt: day(0),
    lastSeenSync: "s0",
    lastSeenAt: day(0),
    disappearedAt: gone,
    resolutionSrc: gone === null ? null : "disappeared",
    lastStatus: "OPEN",
    categories: ["AI_SECURITY"],
    ruleId,
    createdAt: day(-100),
    dueAt: opts.dueDay === undefined ? null : day(opts.dueDay),
    registerScope: opts.scope ?? SCOPE_A,
    episode: 1,
  };
}

/**
 * A rule that reads the rule id and nothing else.
 *
 * `shares.time` is 0 on purpose: the clock moves between syncs, and a test about ORDER should
 * not be measuring the calendar. It is also what makes the tau case a controlled one — an
 * unchanged ranking is unchanged because the inputs are, not because a day happened to fall
 * inside the same bucket.
 */
function weightRule(weights: Record<string, number>): RankRule {
  return {
    ...DEFAULT_RANK_RULE,
    ruleWeights: Object.keys(weights).map((ruleId) => ({ ruleId, weight: weights[ruleId]! })),
    shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 },
    timeShare: 0,
  };
}

/** Ten rows that leave at day 10, ten that never do. The whole population is born at day 0. */
function twentyRows(): IssueLedgerRow[] {
  const rows: IssueLedgerRow[] = [];
  for (let i = 1; i <= 10; i++) rows.push(row(`fix-${i}`, "R-FIX", { goneDay: 10, dueDay: 5 }));
  for (let i = 1; i <= 10; i++) rows.push(row(`stay-${i}`, "R-STAY", { dueDay: 200 }));
  return rows;
}

const KS = [5, 10];

describe("precision at k", () => {
  it("is 1 for a ranker that puts every remediated row first", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: weightRule({ "R-FIX": 1, "R-STAY": 0 }),
      horizonDays: 10,
      ks: KS,
    });
    expect(report.computed).toBe(true);
    expect(report.comparablePairs).toBe(1);
    const point = report.candidate!.points[0]!;
    expect(point.population).toBe(20);
    expect(point.unknown).toBe(0);
    for (const cut of point.precisionAtK) {
      expect(cut.applicable).toBe(true);
      expect(cut.precision).toBe(1);
      expect(cut.unknownInTopK).toBe(0);
    }
    // The matrix reads the same queue: at k = 10 every top-k row was remediated and nothing
    // outside it was, which is coverage and efficiency both at 1 with no bracket.
    expect(point.kAtRisk).toBe(10);
    expect(point.matrix.coverage).toEqual({ point: 1, lo: 1, hi: 1 });
    expect(point.matrix.efficiency).toEqual({ point: 1, lo: 1, hi: 1 });
  });

  it("is 0 for the same ranker inverted", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: weightRule({ "R-FIX": 0, "R-STAY": 1 }),
      horizonDays: 10,
      ks: KS,
    });
    const point = report.candidate!.points[0]!;
    for (const cut of point.precisionAtK) expect(cut.precision).toBe(0);
    expect(point.matrix.coverage.point).toBe(0);
    expect(point.matrix.efficiency.point).toBe(0);
  });

  it("refuses a k larger than the population rather than answering with fewer rows", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: weightRule({ "R-FIX": 1, "R-STAY": 0 }),
      horizonDays: 10,
      ks: [10, 100],
    });
    const cuts = report.candidate!.points[0]!.precisionAtK;
    expect(cuts[1]).toMatchObject({ k: 100, applicable: false, precision: null });
    // The matrix takes the largest k that FITS, so a refused cut never becomes the population.
    expect(report.candidate!.points[0]!.kAtRisk).toBe(10);
  });

  it("agrees with the matrix: coverage at kAtRisk IS precision at that k", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: weightRule({ "R-FIX": 0.6, "R-STAY": 0.4 }),
      horizonDays: 10,
      ks: KS,
    });
    for (const basis of [report.candidate!, report.baselines.dueAtOnly!]) {
      for (const point of basis.points) {
        const cut = point.precisionAtK.find((c) => c.k === point.kAtRisk)!;
        expect(point.matrix.coverage.point).toBe(cut.precision);
      }
    }
  });
});

describe("unknown outcomes", () => {
  // Two evaluations over the SAME labelled window. The second adds a sync whose own horizon
  // has not closed, so it contributes unknowns and nothing else.
  const ledger = twentyRows();
  const rule = weightRule({ "R-FIX": 1, "R-STAY": 0 });
  const closed = evaluateRank({
    ledger, syncs: [sync("s1", 0), sync("s2", 20)], rule, horizonDays: 15, ks: [10],
  });
  const withOpenWindow = evaluateRank({
    ledger, syncs: [sync("s1", 0), sync("s2", 20), sync("s3", 30)], rule, horizonDays: 15, ks: [10],
  });

  it("leaves the point estimate exactly where it was", () => {
    expect(closed.candidate!.matrix.coverage).toEqual({ point: 1, lo: 1, hi: 1 });
    expect(withOpenWindow.candidate!.matrix.coverage.point)
      .toBe(closed.candidate!.matrix.coverage.point);
    expect(withOpenWindow.candidate!.matrix.efficiency.point)
      .toBe(closed.candidate!.matrix.efficiency.point);
  });

  it("widens the bracket by exactly the rows nobody has finished observing", () => {
    const m = withOpenWindow.candidate!.matrix;
    // The second window's whole population is unknown, and the perfect ranker puts all ten
    // of them in its top k — so the doubt lands on coverage, which is the rate they could
    // have joined either side of.
    expect(m.unknownHigh).toBe(10);
    expect(m.unknownLow).toBe(0);
    expect(m.coverage.lo).toBeLessThan(m.coverage.point!);
    expect(m.coverage.lo).toBe(10 / 20);
    expect(m.coverage.hi).toBe(1);
    expect(m.labelCoverage).toBe(20 / 30);
  });

  it("reports a point estimate of null, not zero, when the whole top k is unknown", () => {
    const inverted = evaluateRank({
      ledger,
      syncs: [sync("s1", 0), sync("s2", 20), sync("s3", 30)],
      rule: weightRule({ "R-FIX": 0, "R-STAY": 1 }),
      horizonDays: 15,
      ks: [10],
    });
    const second = inverted.candidate!.points[1]!;
    expect(second.labelled).toBe(0);
    expect(second.matrix.coverage.point).toBeNull();
    // Unmeasured, and the bracket says the full width of that: it could have been anything.
    expect(second.matrix.coverage.lo).toBe(0);
    expect(second.matrix.coverage.hi).toBe(1);
  });

  it("accounts for every row of every population: labelled + unknown === total", () => {
    for (const report of [closed, withOpenWindow]) {
      for (const basis of [report.candidate!, report.baselines.rankV1!, report.baselines.random!]) {
        for (const p of basis.points) {
          expect(p.labelled + p.unknown).toBe(p.population);
          expect(p.resolved + p.open).toBe(p.labelled);
          expect(p.matrix.total).toBe(p.population);
        }
      }
      expect(report.labelledRows + report.unknownRows).toBe(report.evaluatedRows);
      expect(report.evaluatedRows).toBeLessThanOrEqual(report.totalRows);
    }
  });
});

describe("rank agreement between syncs", () => {
  it("is 1 when the ordering did not move, over the ids both populations hold", () => {
    const ledger: IssueLedgerRow[] = [];
    for (let i = 1; i <= 6; i++) ledger.push(row(`a-${i}`, "R-A"));
    for (let i = 1; i <= 6; i++) ledger.push(row(`b-${i}`, "R-B"));
    for (let i = 1; i <= 6; i++) ledger.push(row(`c-${i}`, "R-C"));
    const report = evaluateRank({
      ledger,
      syncs: [sync("s1", 0), sync("s2", 10), sync("s3", 20)],
      rule: weightRule({ "R-A": 1, "R-B": 0.5, "R-C": 0 }),
      horizonDays: 10,
      ks: [5],
    });
    expect(report.comparablePairs).toBe(2);
    const [first, second] = report.candidate!.points;
    // The first evaluated sync has nothing before it to agree with — null, never 1.
    expect(first!.tau).toBeNull();
    expect(first!.tauCommonIds).toBe(0);
    expect(second!.tauCommonIds).toBe(18);
    expect(second!.tau).toBe(1);
    expect(report.candidate!.meanTau).toBe(1);
    expect(report.candidate!.tauN).toBe(1);
  });

  it("is defined over the common ids alone, so a departed row does not enter it", () => {
    const ledger = [
      ...twentyRows(),
      row("late-1", "R-A"),
      row("late-2", "R-B"),
    ];
    const report = evaluateRank({
      ledger,
      syncs: [sync("s1", 0), sync("s2", 10), sync("s3", 20)],
      rule: weightRule({ "R-FIX": 1, "R-STAY": 0.2, "R-A": 0.9, "R-B": 0.1 }),
      horizonDays: 10,
      ks: [5],
    });
    // 22 rows at day 0; the ten R-FIX rows left at day 10, so 12 are shared with the second.
    expect(report.candidate!.points[0]!.population).toBe(22);
    expect(report.candidate!.points[1]!.population).toBe(12);
    expect(report.candidate!.points[1]!.tauCommonIds).toBe(12);
  });
});

describe("the honesty contract", () => {
  it("computes nothing from a single sync, and says what is missing", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0)],
      rule: DEFAULT_RANK_RULE,
      horizonDays: 30,
      ks: KS,
    });
    expect(report.computed).toBe(false);
    expect(report.comparablePairs).toBe(0);
    expect(report.syncsAvailable).toBe(1);
    expect(report.waitingFor).toContain("two committed syncs");
    expect(report.candidate).toBeNull();
    expect(report.baselines.rankV1).toBeNull();
    expect(report.baselines.dueAtOnly).toBeNull();
    expect(report.baselines.random).toBeNull();
  });

  it("computes nothing when the horizon runs past the last sync that could have looked", () => {
    // A population that has never lost a row: there is no departure to date, and the window
    // closes after the last sync, so nothing at all is observed either way.
    const standing = twentyRows().map((r) => ({ ...r, disappearedAt: null, resolutionSrc: null }));
    const report = evaluateRank({
      ledger: standing,
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: DEFAULT_RANK_RULE,
      horizonDays: 60,
      ks: KS,
    });
    expect(report.comparablePairs).toBe(1);
    expect(report.labelledRows).toBe(0);
    expect(report.unknownRows).toBe(20);
    expect(report.computed).toBe(false);
    expect(report.waitingFor).toContain("60-day horizon");
    expect(report.candidate).toBeNull();
  });

  it("still counts a departure inside the horizon, even past the coverage end", () => {
    // The asymmetry is the point and it is easy to get backwards. "Gone by t+h" is a POSITIVE
    // observation — the register saw the row leave — so it survives a horizon nobody has
    // reached yet; only "still there at t+h" needs a sync that was looking at t+h. So this
    // report is computed, over ten labels, with the other ten rows widening the bracket.
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: weightRule({ "R-FIX": 1, "R-STAY": 0 }),
      horizonDays: 60,
      ks: [10],
    });
    expect(report.computed).toBe(true);
    expect(report.labelledRows).toBe(10);
    expect(report.unknownRows).toBe(10);
    const m = report.candidate!.matrix;
    expect(m.tp).toBe(10);
    expect(m.unknownLow).toBe(10);
    expect(m.coverage).toEqual({ point: 1, lo: 1, hi: 1 });
    expect(m.efficiency.point).toBe(1);
    expect(m.efficiency.lo).toBe(0.5);
  });

  it("skips a pair whose scope moved, and counts it", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0, SCOPE_A), sync("s2", 10, SCOPE_B), sync("s3", 20, SCOPE_B)],
      rule: weightRule({ "R-FIX": 1, "R-STAY": 0 }),
      horizonDays: 10,
      ks: [5],
    });
    expect(report.scopeChanges).toBe(1);
    expect(report.comparablePairs).toBe(1);
    // The surviving pair is the second one — the ranked sync is s2, not s1.
    expect(report.candidate!.points.map((p) => p.syncId)).toEqual(["s2"]);
  });

  it("never reads a blank scope as the same scope", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0, ""), sync("s2", 10, ""), sync("s3", 20, "")],
      rule: DEFAULT_RANK_RULE,
      horizonDays: 10,
      ks: [5],
    });
    expect(report.unknownScopePairs).toBe(2);
    expect(report.scopeChanges).toBe(0);
    expect(report.comparablePairs).toBe(0);
    expect(report.computed).toBe(false);
    expect(report.waitingFor).toContain("unrecorded scope");
  });

  it("says why the severity baseline is missing instead of returning a zero", () => {
    const report = evaluateRank({
      ledger: twentyRows(),
      syncs: [sync("s1", 0), sync("s2", 10)],
      rule: DEFAULT_RANK_RULE,
      horizonDays: 10,
      ks: KS,
    });
    expect(report.baselines.severityOnly).toBeNull();
    expect(report.severityOnlyNote).toContain("not one of them");
  });
});

describe("the baselines", () => {
  const ledger = twentyRows();
  const syncs = [sync("s1", 0), sync("s2", 10)];
  const args = { ledger, syncs, rule: weightRule({ "R-FIX": 1, "R-STAY": 0 }), horizonDays: 10, ks: KS };

  it("draw the same random ordering for the same seed, and a different one otherwise", () => {
    const a = evaluateRank({ ...args, seed: 4242 });
    const b = evaluateRank({ ...args, seed: 4242 });
    const c = evaluateRank({ ...args, seed: 99 });
    expect(a.baselines.random).toEqual(b.baselines.random);
    expect(JSON.stringify(a.baselines.random)).not.toBe(JSON.stringify(c.baselines.random));
    // The seed is published, so a figure can be reproduced from the report alone.
    expect(a.seed).toBe(4242);
  });

  it("rank the same population against the same labels as the candidate", () => {
    const report = evaluateRank(args);
    const candidate = report.candidate!.points[0]!;
    for (const basis of [report.baselines.rankV1!, report.baselines.dueAtOnly!, report.baselines.random!]) {
      const point = basis.points[0]!;
      expect(point.population).toBe(candidate.population);
      expect(point.resolved).toBe(candidate.resolved);
      expect(point.open).toBe(candidate.open);
      expect(point.unknown).toBe(candidate.unknown);
    }
  });

  it("put the soonest deadline first, with the undated rows last", () => {
    const report = evaluateRank(args);
    // The R-FIX rows are due at day 5 and the R-STAY rows at day 200, so due-date order is
    // the perfect order here — which is the point: a baseline that already answers the
    // question is what makes a candidate's margin over it worth reading.
    expect(report.baselines.dueAtOnly!.points[0]!.precisionAtK[1]!.precision).toBe(1);
    const undated = evaluateRank({
      ...args,
      ledger: twentyRows().map((r) => ({ ...r, dueAt: null })),
    });
    // With nothing to read, every row ties and the basis separates no pairs at all.
    expect(undated.baselines.dueAtOnly!.points[0]!.tieRate).toBe(1);
    expect(undated.baselines.dueAtOnly!.points[0]!.effectiveCardinality).toBe(1);
  });

  it("publish a bootstrap interval only once three syncs have answered", () => {
    const two = evaluateRank(args);
    expect(two.candidate!.meanPrecisionAtK[0]!.n).toBe(1);
    expect(two.candidate!.meanPrecisionAtK[0]!.ci).toBeNull();

    const many = evaluateRank({
      ledger: [
        ...twentyRows(),
        ...[1, 2, 3, 4].map((i) => row(`later-${i}`, "R-FIX", { goneDay: 30 })),
      ],
      syncs: [sync("s1", 0), sync("s2", 10), sync("s3", 20), sync("s4", 30), sync("s5", 40)],
      rule: weightRule({ "R-FIX": 1, "R-STAY": 0 }),
      horizonDays: 10,
      ks: [5],
    });
    const cut = many.candidate!.meanPrecisionAtK[0]!;
    expect(cut.n).toBeGreaterThanOrEqual(3);
    expect(cut.ci).not.toBeNull();
    expect(cut.ci!.lo).toBeLessThanOrEqual(cut.mean!);
    expect(cut.ci!.hi).toBeGreaterThanOrEqual(cut.mean!);
  });
});
