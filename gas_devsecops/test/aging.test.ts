// THE OPEN BACKLOG AS A DISTRIBUTION, AND WHERE THE SLA CUTS IT.
//
// `test/insights.test.ts` already holds `ageBuckets` / `ageBucketsBy` — the four buckets over
// dated open rows. This file holds what those two could not express and what the MTTR page
// needed expressed: the rows they SKIP, and the per-severity deadline the distribution is
// read against.
//
// THE UNAGED COUNT IS THE POINT OF THE FILE. `ageBucketsBy` drops an open row with no finite
// `age_days` and reports the loss only in a comment, so its `totalOpen` is quietly smaller
// than the open count printed beside it. PRODUCT.md's sixth principle — a clock says what it
// did with the rows it could not measure — is what `agingDistribution` returns instead, and
// the identity `sum(perSev) + unaged === open` is asserted below rather than assumed.
//
// GAS-first, hand-written fixtures. No Python parity: the Streamlit side is discontinued and
// `brick/devsecops/` has no aging-against-SLA equivalent to port from.

import { describe, expect, it } from "vitest";

import { SLA_TARGETS, type Scope } from "../src/domain/config";
import {
  AGE_BUCKET_EDGES,
  AGE_BUCKET_LABELS,
  agingDistribution,
  slaEdgeBucket,
  slaEdgeIsExact,
} from "../src/domain/insights";

const row = (
  age_days: number | null,
  severity = "HIGH",
  status = "OPEN",
  scope: Scope = "sca",
) => ({ severity, status, age_days, scope });

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

// =========================================================================================
//  1. The edges
// =========================================================================================

describe("agingDistribution buckets at the documented edges", () => {
  // PERTURBATION (run 2026-09-04, then reverted): the FIRST comparison in
  // `agingDistribution` was narrowed from `age <= AGE_BUCKET_EDGES[0]` to
  // `age < AGE_BUCKET_EDGES[0]` — the off-by-one that turns an inclusive edge into an
  // exclusive one, which would move every finding sitting exactly on CRITICAL's 7-day
  // deadline out of the in-SLA bar. Observed:
  //
  //   × straddles all three edges in one pass
  //   × places each of the six edge days in exactly one named bucket
  //   × the deadline day itself is inside its own bucket, for every severity with a target
  //
  //   FAIL  test/aging.test.ts > agingDistribution buckets at the documented edges >
  //         straddles all three edges in one pass
  //     AssertionError: expected [ +0, 3, 2, 1 ] to deeply equal [ 1, 2, 2, 1 ]
  //
  //   FAIL  ... > places each of the six edge days in exactly one named bucket
  //     AssertionError: age 7 landed in the wrong bucket: expected 1 to be +0
  //
  //   FAIL  ... > the deadline day itself is inside its own bucket, for every severity …
  //     AssertionError: CRITICAL at exactly 7 d: expected [ +0, 3, +0, +0 ] to deeply equal
  //     [ 3, +0, +0, +0 ]
  //
  //   Test Files  1 failed (1) ; Tests  3 failed | 15 passed (18)
  //
  // The third failure is the one worth having: it is in section 3 and it is what ties the
  // BUCKET edges to the SLA edges, so a boundary that moves under the deadline fails beside
  // the deadline rather than only in the counting cases.
  it("straddles all three edges in one pass", () => {
    const { perSev, totalOpen } = agingDistribution([
      row(7), row(8), row(30), row(31), row(90), row(91),
    ]);
    // 7|8 straddle the first edge, 30|31 the second, 90|91 the third.
    expect(perSev.HIGH).toEqual([1, 2, 2, 1]);
    expect(totalOpen).toBe(6);
  });

  it("places each of the six edge days in exactly one named bucket", () => {
    const expected: Array<[number, number]> = [
      [7, 0], [8, 1], [30, 1], [31, 2], [90, 2], [91, 3],
    ];
    for (const [age, bucket] of expected) {
      const { perSev, totalOpen } = agingDistribution([row(age)]);
      const counts = perSev.HIGH!;
      expect(totalOpen, `age ${age}`).toBe(1);
      expect(counts.indexOf(1), `age ${age} landed in the wrong bucket`).toBe(bucket);
      expect(sum(counts), `age ${age} was counted twice`).toBe(1);
    }
  });

  it("ships the four labels the client draws, from the domain's own constant", () => {
    expect(agingDistribution([row(3)]).labels).toEqual([...AGE_BUCKET_LABELS]);
    expect(AGE_BUCKET_LABELS).toHaveLength(AGE_BUCKET_EDGES.length + 1);
  });
});

// =========================================================================================
//  2. Open rows only, and no silent drop
// =========================================================================================

describe("agingDistribution counts open rows, and accounts for every one of them", () => {
  it("excludes resolved rows entirely — a closed finding stopped ageing", () => {
    const d = agingDistribution([
      row(3, "HIGH", "OPEN"),
      row(300, "HIGH", "RESOLVED"),
      // Every member of config.RESOLVED_STATUSES, not just the obvious one — "REMOVED" is
      // NOT one of them and would count as open, which is the trap this list avoids.
      row(300, "HIGH", "REMEDIATED"),
      row(300, "HIGH", "FIXED"),
      row(300, "HIGH", "CLOSED"),
      row(null, "HIGH", "RESOLVED"),
    ]);
    expect(d.totalOpen).toBe(1);
    expect(d.unaged).toBe(0);
    expect(d.perSev.HIGH).toEqual([1, 0, 0, 0]);
  });

  it("counts a null age as `unaged` rather than dropping it or calling it young", () => {
    const d = agingDistribution([row(null), row(null), row(2)]);
    expect(d.unaged).toBe(2);
    expect(d.totalOpen).toBe(1);
    // The decisive half: the nulls are NOT in bucket 0. A null age bucketed as 0-7d would
    // read as two fresh findings, which is the confident lie PRODUCT.md's sixth principle
    // exists to refuse.
    expect(d.perSev.HIGH).toEqual([1, 0, 0, 0]);
  });

  it("treats NaN and Infinity the same as null — neither was a measurement", () => {
    const d = agingDistribution([row(Number.NaN), row(Number.POSITIVE_INFINITY), row(1)]);
    expect(d.unaged).toBe(2);
    expect(d.totalOpen).toBe(1);
  });

  it("sum(perSev) + unaged === the open row count, over a mixed population", () => {
    const rows = [
      row(1, "CRITICAL"), row(9, "CRITICAL"), row(null, "CRITICAL"),
      row(45, "HIGH"), row(400, "HIGH"), row(null, "HIGH"), row(null, "HIGH"),
      row(60, "MEDIUM"), row(7, "LOW"), row(180, "INFO"),
      row(12, "HIGH", "RESOLVED"), row(null, "LOW", "RESOLVED"),
    ];
    const open = rows.filter((r) => r.status === "OPEN").length;
    const d = agingDistribution(rows);
    const bucketed = Object.values(d.perSev).reduce((n, arr) => n + sum(arr), 0);
    expect(bucketed).toBe(d.totalOpen);
    expect(bucketed + d.unaged).toBe(open);
  });

  it("keeps a severity whose whole open population is undated, with four zeroes", () => {
    const d = agingDistribution([row(null, "LOW"), row(5, "HIGH")]);
    // Present, so the page can say "LOW: open, none dated" instead of silently omitting it.
    expect(d.perSev.LOW).toEqual([0, 0, 0, 0]);
    expect(d.unaged).toBe(1);
  });

  it("normalizes severity, so one severity cannot arrive under two keys", () => {
    const d = agingDistribution([row(2, "critical"), row(2, "CRITICAL")]);
    expect(Object.keys(d.perSev)).toEqual(["CRITICAL"]);
    expect(d.perSev.CRITICAL).toEqual([2, 0, 0, 0]);
  });

  it("honours the scope filter, because one ledger holds three registers", () => {
    const rows = [row(2, "HIGH", "OPEN", "sca"), row(2, "HIGH", "OPEN", "sast")];
    expect(agingDistribution(rows, "sca").totalOpen).toBe(1);
    expect(agingDistribution(rows).totalOpen).toBe(2);
  });

  it("returns an empty, well-formed shape for an empty register", () => {
    const d = agingDistribution([]);
    expect(d.perSev).toEqual({});
    expect(d.totalOpen).toBe(0);
    expect(d.unaged).toBe(0);
    expect(d.slaEdge).toEqual({});
  });
});

// =========================================================================================
//  3. The SLA edge
// =========================================================================================

describe("slaEdgeBucket places each deadline in the bucket that still contains it", () => {
  it("matches SLA_TARGETS, read against the same edges the counts use", () => {
    expect(slaEdgeBucket("CRITICAL")).toBe(0); // 7 d, the first edge exactly
    expect(slaEdgeBucket("HIGH")).toBe(1); // 14 d, inside 8-30d
    expect(slaEdgeBucket("MEDIUM")).toBe(1); // 30 d, the second edge exactly
    expect(slaEdgeBucket("LOW")).toBe(2); // 90 d, the third edge exactly
    expect(slaEdgeBucket("INFO")).toBe(3); // 180 d, past every edge
  });

  it("derives the bucket from SLA_TARGETS rather than from a second copy of the numbers", () => {
    for (const [sev, target] of Object.entries(SLA_TARGETS)) {
      const expected = target <= AGE_BUCKET_EDGES[0] ? 0
        : target <= AGE_BUCKET_EDGES[1] ? 1
          : target <= AGE_BUCKET_EDGES[2] ? 2 : 3;
      expect(slaEdgeBucket(sev), sev).toBe(expected);
    }
  });

  it("is null for a severity with no target — UNKNOWN never gets an invented deadline", () => {
    expect(slaEdgeBucket("UNKNOWN")).toBeNull();
    expect(slaEdgeBucket(null)).toBeNull();
    expect(slaEdgeBucket("not-a-severity")).toBeNull();
  });

  it("separates a deadline that sits ON a boundary from one that lands mid-bucket", () => {
    // The distinction the page turns into two different sentences: for these three every
    // bucket right of the edge is WHOLLY late; for the other two the edge bucket itself is
    // part in and part out.
    expect(slaEdgeIsExact("CRITICAL")).toBe(true); // 7 === AGE_BUCKET_EDGES[0]
    expect(slaEdgeIsExact("MEDIUM")).toBe(true); // 30
    expect(slaEdgeIsExact("LOW")).toBe(true); // 90
    expect(slaEdgeIsExact("HIGH")).toBe(false); // 14, inside 8-30d
    expect(slaEdgeIsExact("INFO")).toBe(false); // 180, past 90
    expect(slaEdgeIsExact("UNKNOWN")).toBe(false);
  });

  it("the deadline day itself is inside its own bucket, for every severity with a target", () => {
    for (const [sev, target] of Object.entries(SLA_TARGETS)) {
      const d = agingDistribution([row(target, sev), row(target, sev), row(target, sev)]);
      const counts = d.perSev[sev]!;
      const edge = slaEdgeBucket(sev)!;
      const expected = [0, 0, 0, 0];
      expected[edge] = 3;
      expect(counts, `${sev} at exactly ${target} d`).toEqual(expected);
    }
  });
});

describe("the edge travels beside the counts it is read against", () => {
  it("carries an edge, a target and an exactness flag for every severity drawn", () => {
    const d = agingDistribution([
      row(1, "CRITICAL"), row(20, "HIGH"), row(200, "INFO"), row(3, "UNKNOWN"),
    ]);
    expect(Object.keys(d.slaEdge).sort()).toEqual(["CRITICAL", "HIGH", "INFO", "UNKNOWN"]);
    expect(d.slaEdge).toEqual({ CRITICAL: 0, HIGH: 1, INFO: 3, UNKNOWN: null });
    expect(d.slaTargets).toEqual({ CRITICAL: 7, HIGH: 14, INFO: 180, UNKNOWN: null });
    expect(d.slaEdgeExact).toEqual({
      CRITICAL: true, HIGH: false, INFO: false, UNKNOWN: false,
    });
  });

  it("names no severity the counts do not, so the chart cannot draw an edge with no bar", () => {
    const d = agingDistribution([row(1, "CRITICAL")]);
    expect(Object.keys(d.slaEdge)).toEqual(Object.keys(d.perSev));
  });
});
