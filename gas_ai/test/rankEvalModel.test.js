// The rank-evaluation panel's wording, which is the part of it that can lie.
//
// Plain .js for the reason tableModel.test.js writes out: tsconfig has no allowJs and includes
// test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit`.
//
// Every case here is one of two failures. A gap rendered as a number — `0.0%` where nobody
// could measure — is the one that survives review, because it looks like a result. And a
// bracket dropped from a rate that has one hides the only part of the panel that says how
// wrong it could be.

import { describe, expect, it } from "vitest";

import {
  UNMEASURED,
  formatFraction,
  formatRate,
  formatTau,
  rankEvalHonesty,
  rankEvalRows,
} from "../src/client/js/rankEvalModel.js";

const basis = (label, over) => ({
  key: "candidate",
  label,
  note: "note for " + label,
  meanPrecisionAtK: [
    { k: 10, mean: 0.5, n: 4, ci: { lo: 0.25, hi: 0.75 } },
    { k: 25, mean: null, n: 0, ci: null },
  ],
  matrix: {
    coverage: { point: 0.5, lo: 0.4, hi: 0.6 },
    efficiency: { point: 0.25, lo: 0.25, hi: 0.25 },
  },
  meanTau: 0.75,
  tauN: 3,
  meanTieRate: 0.1,
  ...over,
});

const report = (over) => ({
  computed: true,
  ks: [10, 25],
  horizonDays: 30,
  syncsAvailable: 6,
  comparablePairs: 4,
  scopeChanges: 1,
  unknownScopePairs: 0,
  labelledRows: 80,
  evaluatedRows: 100,
  candidate: basis("Candidate rule"),
  baselines: {
    rankV1: basis("Rank v1"),
    dueAtOnly: basis("Due date only"),
    random: basis("Random"),
    severityOnly: null,
  },
  ...over,
});

describe("formatRate", () => {
  it("drops the bracket only when there is nothing in it", () => {
    expect(formatRate({ point: 0.5, lo: 0.5, hi: 0.5 })).toBe("50.0%");
    expect(formatRate({ point: 0.5, lo: 0.25, hi: 0.75 })).toBe("50.0% (25.0%–75.0%)");
  });

  it("says the word rather than showing a zero", () => {
    expect(formatRate({ point: null, lo: null, hi: null })).toBe(UNMEASURED);
    expect(formatRate(null)).toBe(UNMEASURED);
    expect(formatRate({ point: 0, lo: 0, hi: 0 })).toBe("0.0%");
  });

  it("keeps the bounds of a rate that has no point estimate", () => {
    // Every row in the top k is still being observed: the rate is unmeasured, and the width
    // of what it could have been is the only thing the panel can honestly say.
    expect(formatRate({ point: null, lo: 0, hi: 1 })).toBe(UNMEASURED + " (0.0%–100.0%)");
  });
});

describe("formatFraction and formatTau", () => {
  it("applies the percent sign exactly once", () => {
    expect(formatFraction(0.125)).toBe("12.5%");
    expect(formatFraction(1)).toBe("100.0%");
    expect(formatFraction(null)).toBeNull();
    expect(formatFraction("0.5")).toBeNull();
  });

  it("renders a correlation as a correlation, not a percentage", () => {
    expect(formatTau(1)).toBe("1.00");
    expect(formatTau(-0.5)).toBe("-0.50");
    expect(formatTau(null)).toBe(UNMEASURED);
  });
});

describe("rankEvalRows", () => {
  it("has no rows at all when nothing was computed", () => {
    expect(rankEvalRows({ computed: false, waitingFor: "two syncs" })).toEqual([]);
    expect(rankEvalRows(null)).toEqual([]);
  });

  it("puts the rule in force first and the baselines under it", () => {
    const rows = rankEvalRows(report());
    expect(rows.map((r) => r.key)).toEqual(["candidate", "rankV1", "dueAtOnly", "random"]);
    expect(rows[0].label).toBe("Candidate rule");
  });

  it("gives every requested cut a cell, measured or not", () => {
    const rows = rankEvalRows(report());
    expect(rows[0].precision.map((p) => p.k)).toEqual([10, 25]);
    expect(rows[0].precision[0].text).toBe("50.0%");
    expect(rows[0].precision[0].n).toBe(4);
    // The cut nobody could answer keeps its column and says so.
    expect(rows[0].precision[1].text).toBe(UNMEASURED);
    expect(rows[0].precision[1].value).toBeNull();
  });

  it("formats both rates and the correlation", () => {
    const rows = rankEvalRows(report());
    expect(rows[0].coverage.text).toBe("50.0% (40.0%–60.0%)");
    expect(rows[0].efficiency.text).toBe("25.0%");
    expect(rows[0].tau.text).toBe("0.75");
  });

  it("skips a basis the server could not build rather than inventing a row for it", () => {
    const rows = rankEvalRows(report({
      baselines: { rankV1: basis("Rank v1"), dueAtOnly: null, random: null, severityOnly: null },
    }));
    expect(rows.map((r) => r.key)).toEqual(["candidate", "rankV1"]);
  });
});

describe("rankEvalHonesty", () => {
  it("leads with what the figures are conditional on", () => {
    const block = rankEvalHonesty(report());
    expect(block.map((e) => e.key)).toEqual(["syncs", "pairs", "labelled", "horizon"]);
    expect(block[0].value).toBe("6");
    expect(block[1].value).toBe("4");
    expect(block[1].note).toContain("1 pair skipped");
    expect(block[2].value).toBe("80 of 100");
    expect(block[2].note).toContain("20 still being observed");
    expect(block[3].value).toBe("30 days");
    expect(block[3].note).toContain("DISAPPEARANCE");
  });

  it("says nothing about skipped pairs when none were skipped", () => {
    const block = rankEvalHonesty(report({ scopeChanges: 0, unknownScopePairs: 0 }));
    expect(block[1].note).toBe("");
  });

  it("is drawn even when the report computed nothing", () => {
    const block = rankEvalHonesty({
      computed: false, waitingFor: "…", syncsAvailable: 1, comparablePairs: 0,
      labelledRows: 0, evaluatedRows: 0, horizonDays: 30,
    });
    expect(block[0].value).toBe("1");
    expect(block[2].value).toBe("0 of 0");
  });
});
