// D7 — secretsLifecycle. HAND-WRITTEN, with the arithmetic for every expectation written out
// beside it, because there is no fixture and no second oracle to check against: gas/ has no
// secrets register and brick/devsecops/ never modelled one. Every number below was computed
// by hand from the dates in the row builder, and a test whose expected value cannot be
// derived in the comment above it does not belong in this file.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVOKE_SLA_DAYS,
  SEGMENT_NONE,
  SEVERITY_AXIS_REFUSAL,
  bySegment,
  postDetectionValidityRate,
  removalVsRotation,
  timeToRevoke,
  twinAudit,
  validationCoverage,
  type SecretRow,
  type SegmentAxis,
} from "../src/domain/secretsLifecycle";

/** A secrets ledger row with everything absent; override only what the case is about. */
const secret = (over: Partial<SecretRow> = {}): SecretRow => ({
  scope: "secrets",
  status: "OPEN",
  first_seen: null,
  secret_kind: null,
  rotated_at: null,
  removed_at: null,
  validation_state: null,
  validated_at: null,
  confidence: null,
  ...over,
});

const JAN01 = "2026-01-01T00:00:00Z";
const JAN04 = "2026-01-04T00:00:00Z"; // JAN01 + 3 d
const JAN11 = "2026-01-11T00:00:00Z"; // JAN01 + 10 d
const NOW = Date.parse("2026-02-01T00:00:00Z"); // JAN01 + 31 d

// The four-row set the whole first block reads:
//   A  INVALID, born JAN01, rotated JAN11        -> an EVENT at 10 d
//   B  VALID,   born JAN01, never rotated        -> CENSORED at NOW - JAN01 = 31 d
//   C  UNKNOWN, born JAN01                       -> EXCLUDED (nobody checked it)
//   D  ERROR,   born JAN01                       -> EXCLUDED (the check itself failed)
// so measured = 2 of 4 = 50%, NOT 25%: both VALID and INVALID are measurements. Only the
// two states that assert nothing about the credential are unmeasured.
const FOUR: SecretRow[] = [
  secret({ validation_state: "INVALID", first_seen: JAN01, validated_at: JAN11, rotated_at: JAN11 }),
  secret({ validation_state: "VALID", first_seen: JAN01, validated_at: JAN11 }),
  secret({ validation_state: "UNKNOWN", first_seen: JAN01 }),
  secret({ validation_state: "ERROR", first_seen: JAN01 }),
];

describe("validationCoverage", () => {
  it("counts VALID and INVALID as measured: 2 of 4 = 50%", () => {
    // measured = |{INVALID, VALID}| = 2; unmeasured = |{UNKNOWN, ERROR}| = 2; 2/4 = 50%.
    expect(validationCoverage(FOUR)).toEqual({
      measured: 2,
      unmeasured: 2,
      total: 4,
      coveragePct: 50,
      ignoredOtherScopes: 0,
    });
  });

  it("blank and null states are unmeasured, not measured-and-empty", () => {
    const rows = [secret({ validation_state: "   " }), secret({ validation_state: null })];
    expect(validationCoverage(rows)).toMatchObject({ measured: 0, unmeasured: 2, coveragePct: 0 });
  });

  it("an empty register reports null coverage, not 0%", () => {
    // 0/0 is not 0 — "no rows" and "none of the rows" are different answers.
    expect(validationCoverage([])).toEqual({
      measured: 0,
      unmeasured: 0,
      total: 0,
      coveragePct: null,
      ignoredOtherScopes: 0,
    });
  });
});

describe("postDetectionValidityRate", () => {
  it("is the VALID share of the measured rows: 1 of 2 = 50%", () => {
    // Denominator is measured (2), not total (4): the two unchecked rows are evidence of
    // nothing and would halve the rate while saying nothing about any credential.
    expect(postDetectionValidityRate(FOUR)).toEqual({
      valid: 1,
      invalid: 1,
      measured: 2,
      ratePct: 50,
    });
  });

  it("nothing measured -> null rate", () => {
    expect(postDetectionValidityRate([secret({ validation_state: "UNKNOWN" })])).toEqual({
      valid: 0,
      invalid: 0,
      measured: 0,
      ratePct: null,
    });
  });
});

describe("timeToRevoke", () => {
  it("1 event, 1 censored, 2 excluded — median 10 d, p90 null", () => {
    const out = timeToRevoke(FOUR, { now: NOW });

    // Events = [10] (JAN11 - JAN01). Censored = [31] (NOW - JAN01). Risk set = [10, 31].
    // KM: the only distinct event time is t=10; atRisk = |{x >= 10}| = 2, d = 1,
    //     S(10) = 1 - 1/2 = 0.5.
    // median: smallest t with S(t) <= 0.5 -> S(10) = 0.5 exactly -> 10.
    expect(out.median).toBe(10);
    expect(out.medianLowerBound).toBeNull();

    // p90 needs S(t) <= 1 - 0.9 = 0.10. The curve's ONLY point sits at S = 0.50, so survival
    // never falls that far and the p90 is NULL — not "the single event time". One event
    // against a risk set of two can drop survival to a half and no further; publishing 10 d
    // as the p90 would be inventing nine-tenths of a distribution from one observation.
    expect(out.p90).toBeNull();

    expect(out.events).toBe(1);
    expect(out.censored).toBe(1); // the censored side IS the open exposure
    expect(out.excludedUnmeasured).toBe(2);
    expect(out.excludedNoClock).toBe(0);
    expect(out.total).toBe(4);
    // 1 event + 1 censored + 2 excluded + 0 untimeable = 4, the whole secrets register.
    expect(out.events + out.censored + out.excludedUnmeasured + out.excludedNoClock).toBe(
      out.total,
    );

    // Default SLA is 7 d (a chosen target, not SLA_TARGETS[severity]); the one event took
    // 10 d, and 10 > 7, so 0 of 1 events landed inside it.
    expect(out.sla).toBe(DEFAULT_REVOKE_SLA_DAYS);
    expect(out.sla).toBe(7);
    expect(out.withinSlaPct).toBe(0);

    // RMST out to tau = max observed time = 31: S=1 over [0,10] gives 1 * 10 = 10, then
    // S=0.5 over [10,31] gives 0.5 * 21 = 10.5, total 20.5. S(tau) = 0.5 > 0, so survival
    // never reached zero inside the observation window and the mean is a LOWER BOUND.
    expect(out.km.restrictionTime).toBe(31);
    expect(out.km.mean).toBeCloseTo(20.5, 10);
    expect(out.km.meanTruncated).toBe(true);
  });

  it("withinSlaPct with sla = 7 over events [3, 10] is 50%", () => {
    const rows = [
      secret({ validation_state: "INVALID", first_seen: JAN01, rotated_at: JAN04 }), // 3 d
      secret({ validation_state: "INVALID", first_seen: JAN01, rotated_at: JAN11 }), // 10 d
    ];
    const out = timeToRevoke(rows, { now: NOW, sla: 7 });

    // 3 <= 7 (in), 10 > 7 (out) -> 1 of 2 = 50%. The comparison is inclusive.
    expect(out.withinSlaPct).toBe(50);
    expect(out.events).toBe(2);
    expect(out.censored).toBe(0);

    // KM with no censoring: t=3 -> atRisk 2, d 1, S = 0.5; t=10 -> atRisk 1, d 1, S = 0.
    // median = 3 (first S <= 0.5); p90 needs S <= 0.10 and S(10) = 0 -> 10.
    expect(out.median).toBe(3);
    expect(out.p90).toBe(10);
  });

  it("the SLA is inclusive: an event exactly at the target is inside it", () => {
    const rows = [secret({ validation_state: "INVALID", first_seen: JAN01, rotated_at: JAN04 })];
    // 3 d against a 3 d target: "resolved ON OR BEFORE the target" -> 1 of 1 = 100%.
    expect(timeToRevoke(rows, { now: NOW, sla: 3 }).withinSlaPct).toBe(100);
  });

  it("unmeasured rows are EXCLUDED, not censored — they do not enter the risk set", () => {
    // One event at 10 d, plus four rows nobody checked, born the same day. Censoring the
    // four would put them in the risk set: atRisk at t=10 would be 5, S = 1 - 1/5 = 0.8,
    // and the median would vanish (0.8 > 0.5 -> null). Excluding them leaves the single
    // event alone: atRisk 1, d 1, S = 0 -> median 10.
    const rows = [
      secret({ validation_state: "INVALID", first_seen: JAN01, rotated_at: JAN11 }),
      secret({ validation_state: "UNKNOWN", first_seen: JAN01 }),
      secret({ validation_state: "UNKNOWN", first_seen: JAN01 }),
      secret({ validation_state: "ERROR", first_seen: JAN01 }),
      secret({ validation_state: null, first_seen: JAN01 }),
    ];
    const out = timeToRevoke(rows, { now: NOW });
    expect(out.excludedUnmeasured).toBe(4);
    expect(out.km.total).toBe(1); // risk set is the one event, not five observations
    expect(out.median).toBe(10);
    expect(out.p90).toBe(10); // S(10) = 0 <= 0.10
  });

  it("removal does not stop the clock: a REMOVED but still-VALID secret is censored, not an event", () => {
    // "Removed is not rotated" — the string left HEAD and the ledger row is RESOLVED, but
    // the credential was last seen working, so it is still exposed and still counting.
    const rows = [
      secret({
        validation_state: "VALID",
        status: "RESOLVED",
        first_seen: JAN01,
        removed_at: JAN11,
      }),
    ];
    const out = timeToRevoke(rows, { now: NOW });
    expect(out.events).toBe(0);
    expect(out.censored).toBe(1);
    expect(out.median).toBeNull();
    expect(out.medianLowerBound).toBe(31); // > 31 d and still unrevoked
    expect(out.withinSlaPct).toBeNull(); // no events -> no share to report
  });

  it("a row that cannot be timed is excluded and counted, never clamped to zero", () => {
    const rows = [
      secret({ validation_state: "INVALID", first_seen: null, rotated_at: JAN11 }), // no birth
      secret({ validation_state: "INVALID", first_seen: JAN11, rotated_at: JAN01 }), // dead before born
      secret({ validation_state: "VALID", first_seen: "2027-01-01T00:00:00Z" }), // born after NOW
      // Known dead, UNDATED: not an event (no duration) and NOT censorable — censoring would
      // assert this credential was alive for 31 d, which is what INVALID contradicts.
      secret({ validation_state: "INVALID", first_seen: JAN01, rotated_at: null }),
    ];
    const out = timeToRevoke(rows, { now: NOW });
    expect(out.excludedNoClock).toBe(4);
    expect(out.events).toBe(0);
    expect(out.censored).toBe(0);
    expect(out.total).toBe(4);
    expect(out.median).toBeNull();
  });

  it("an empty register: every count zero, every figure null", () => {
    const out = timeToRevoke([], { now: NOW });
    expect(out.events).toBe(0);
    expect(out.censored).toBe(0);
    expect(out.total).toBe(0);
    expect(out.median).toBeNull();
    expect(out.p90).toBeNull();
    expect(out.medianLowerBound).toBeNull();
    expect(out.withinSlaPct).toBeNull();
  });
});

describe("removalVsRotation", () => {
  it("fills all four cells; removedNotRotated is 2", () => {
    const rows = [
      secret({ removed_at: JAN11, rotated_at: JAN11 }), // removedAndRotated
      secret({ removed_at: JAN11 }), // removedNotRotated  (1)
      secret({ removed_at: JAN04 }), // removedNotRotated  (2)
      secret({ rotated_at: JAN11 }), // rotatedNotRemoved
      secret({}), // neither
    ];
    expect(removalVsRotation(rows)).toEqual({
      removedAndRotated: 1,
      removedNotRotated: 2,
      rotatedNotRemoved: 1,
      neither: 1,
      total: 5,
    });
  });

  it("a blank cell is absent, not set", () => {
    // "" in a sheet cell is how a never-written date reads back; treating it as a date
    // would move a live credential into removedAndRotated.
    expect(removalVsRotation([secret({ removed_at: "  ", rotated_at: "" })])).toMatchObject({
      neither: 1,
      removedAndRotated: 0,
      removedNotRotated: 0,
    });
  });
});

describe("bySegment", () => {
  // confidence: HIGH x3, null x1, blank x1, LOW x1, MEDIUM x1 = 7 rows.
  const rows = [
    secret({ confidence: "HIGH", validation_state: "VALID" }),
    secret({
      confidence: "HIGH",
      validation_state: "INVALID",
      status: "RESOLVED",
      rotated_at: JAN11,
      removed_at: JAN11,
    }),
    secret({ confidence: "HIGH", validation_state: "UNKNOWN", removed_at: JAN04 }),
    secret({ confidence: null }),
    secret({ confidence: "   " }),
    secret({ confidence: "LOW" }),
    secret({ confidence: "MEDIUM" }),
  ];

  it("orders by total desc then name asc, and folds null/blank into (none)", () => {
    const out = bySegment(rows, "confidence");
    // HIGH 3, (none) 2 (null + blank), then LOW 1 and MEDIUM 1 tied -> name ascending.
    expect(out.map((s) => s.segment)).toEqual(["HIGH", SEGMENT_NONE, "LOW", "MEDIUM"]);
    expect(out.map((s) => s.total)).toEqual([3, 2, 1, 1]);
  });

  it("each segment carries its own denominator and its own coverage", () => {
    const high = bySegment(rows, "confidence")[0]!;
    // HIGH's three rows: VALID+open; INVALID+resolved+rotated+removed; UNKNOWN+open+removed.
    expect(high).toEqual({
      segment: "HIGH",
      total: 3,
      open: 2, // the RESOLVED row is the FINDING's state, not the credential's
      measured: 2, // VALID + INVALID; the UNKNOWN row is neither
      valid: 1,
      invalid: 1,
      rotated: 1,
      removed: 2,
      removedNotRotated: 1, // the UNKNOWN row: string gone, credential never confirmed dead
    });
  });

  it("segments on secret_kind and validation_state too", () => {
    const kinds = [
      secret({ secret_kind: "SAAS_API_KEY" }),
      secret({ secret_kind: "SAAS_API_KEY" }),
      secret({ secret_kind: "PRIVATE_KEY" }),
    ];
    expect(bySegment(kinds, "secret_kind").map((s) => [s.segment, s.total])).toEqual([
      ["SAAS_API_KEY", 2],
      ["PRIVATE_KEY", 1],
    ]);
    expect(bySegment(FOUR, "validation_state").map((s) => s.segment)).toEqual([
      "ERROR",
      "INVALID",
      "UNKNOWN",
      "VALID",
    ]); // all four tied at 1 -> name ascending
  });

  it('refuses the "severity" axis with the reason, not a silent empty result', () => {
    // Compile-time: SegmentAxis does not include "severity", so this line only type-checks
    // through the cast. Runtime: it throws, for callers that arrive from untyped JS.
    expect(() => bySegment(rows, "severity" as unknown as SegmentAxis)).toThrow(
      SEVERITY_AXIS_REFUSAL,
    );
    expect(SEVERITY_AXIS_REFUSAL).toContain(
      "severity grades a detection, not whether a credential is live",
    );
  });
});

describe("scope filtering", () => {
  const mixed: SecretRow[] = [
    secret({ validation_state: "VALID", first_seen: JAN01 }),
    secret({ scope: "sca", validation_state: "INVALID", first_seen: JAN01, rotated_at: JAN11 }),
    secret({ scope: "sast", validation_state: "VALID", first_seen: JAN01 }),
  ];

  it("validationCoverage ignores other scopes and says how many it ignored", () => {
    expect(validationCoverage(mixed)).toEqual({
      measured: 1,
      unmeasured: 0,
      total: 1, // the denominator is the secrets rows, not the ledger
      coveragePct: 100,
      ignoredOtherScopes: 2,
    });
  });

  it("timeToRevoke ignores other scopes and says how many it ignored", () => {
    const out = timeToRevoke(mixed, { now: NOW });
    // The sca row carries a rotated_at, and it must NOT become an event on this curve.
    expect(out.events).toBe(0);
    expect(out.censored).toBe(1);
    expect(out.total).toBe(1);
    expect(out.ignoredOtherScopes).toBe(2);
  });

  it("the other exports drop non-secrets rows too", () => {
    expect(removalVsRotation(mixed).total).toBe(1);
    expect(postDetectionValidityRate(mixed).measured).toBe(1);
    expect(bySegment(mixed, "validation_state").map((s) => s.segment)).toEqual(["VALID"]);
  });
});

describe("twinAudit", () => {
  it("renders the measured numbers", () => {
    const out = twinAudit({ keys: 187, folded: 187, medianGapDays: 19.9 });
    expect(out).toEqual({
      sentence:
        "187 credentials were seen on both the repository and a branch and folded to one " +
        "row each (187 duplicate rows removed); the two birth dates differ by a median of " +
        "19.9 d.",
      keys: 187,
      folded: 187,
      medianGapDays: 19.9,
    });
    expect(out.sentence).toContain("187");
    expect(out.sentence).toContain("19.9");
  });

  it("says nothing was recorded rather than printing zeros", () => {
    expect(twinAudit(null)).toEqual({
      sentence: "No twin statistics were recorded for this sync.",
      keys: null,
      folded: null,
      medianGapDays: null,
    });
  });

  it("a measured zero reads differently from an absent measurement", () => {
    expect(twinAudit({ keys: 0, folded: 0, medianGapDays: null }).sentence).toBe(
      "No credential was seen on both the repository and a branch in this sync.",
    );
  });

  it("singulars, and a whole-number gap that does not render as 20.0", () => {
    expect(twinAudit({ keys: 1, folded: 1, medianGapDays: 20 }).sentence).toBe(
      "1 credential was seen on both the repository and a branch and folded to one row " +
        "each (1 duplicate row removed); the two birth dates differ by a median of 20 d.",
    );
  });

  it("a fold with no gap statistic says so", () => {
    expect(twinAudit({ keys: 5, folded: 5, medianGapDays: null }).sentence).toContain(
      "no birth-date gap was recorded",
    );
  });
});
