// What the verdict's track record CLAIMS, and — the part that matters — what it refuses to
// claim while nothing can be checked.
//
// Plain .js for the reason executiveView.test.js and historyModel.test.js write out: the
// module under test is the DOM-free half of a page, so it can be reached directly.
//
// The failure this guards is not a crash. It is a table of em dashes under a confident
// sentence reading "Of 0 verdicts old enough to check, 0 were followed by the opposite
// outcome" — four rows and a headline stating a track record over a population nobody could
// score. That reads as a program with a perfect record, which is the opposite of what an
// unmeasured register means.

import { describe, expect, it } from "vitest";

import { capacityHindcastView } from "../src/client/js/pages/programCapacity.js";

const EM_DASH = "—";

const hindcast = (over = {}) => ({
  rows: [],
  comparable: 0,
  counterperformative: 0,
  scansConsidered: 0,
  scansCap: 24,
  ...over,
});

const hcRow = (over = {}) => ({
  asOf: "2026-02-02T00:00:00Z",
  verdict: "falling-behind",
  realisedNetPct: 40,
  agreed: false,
  ...over,
});

describe("capacityHindcastView — the empty branch is about comparable, not about rows", () => {
  it("refuses to publish a record when nothing is old enough to check", () => {
    // Three replayed scans, none of them scorable: a verdict needs a complete month behind it
    // and an observed month in front of it, and early in a register's life neither exists.
    const view = capacityHindcastView(hindcast({
      rows: [
        hcRow({ verdict: null, realisedNetPct: 0, agreed: null }),
        hcRow({ asOf: "2026-01-02T00:00:00Z", verdict: null, realisedNetPct: null, agreed: null }),
        hcRow({ asOf: "2025-12-05T00:00:00Z", verdict: "gaining", realisedNetPct: null, agreed: null }),
      ],
      comparable: 0,
      scansConsidered: 3,
    }));
    expect(view.empty).toBe("No projection old enough to compare yet.");
    expect(view.rows).toBeUndefined();
    expect(view.sentence).toBeUndefined();
  });

  it("takes the same branch for a payload that predates the feature", () => {
    // An hour-old cached program payload carries no hindcast block at all. Same words: the
    // page has nothing to say yet, and it says that rather than drawing an empty table.
    expect(capacityHindcastView(undefined).empty).toBe("No projection old enough to compare yet.");
    expect(capacityHindcastView({}).empty).toBe("No projection old enough to compare yet.");
  });
});

describe("capacityHindcastView — the sentence counts what was checked", () => {
  const view = capacityHindcastView(hindcast({
    rows: [
      hcRow(),
      hcRow({ asOf: "2026-01-02T00:00:00Z", verdict: "keeping-up", realisedNetPct: -1, agreed: true }),
      hcRow({ asOf: "2025-12-05T00:00:00Z", verdict: null, realisedNetPct: null, agreed: null }),
    ],
    comparable: 2,
    counterperformative: 1,
    scansConsidered: 3,
  }));

  it("names the comparable count and the counterperformative count, in that order", () => {
    expect(view.sentence).toBe(
      "Of 2 verdicts old enough to check, 1 were followed by the opposite outcome.");
  });

  it("says how far back it looked, in scans actually read", () => {
    // scansConsidered, NOT scansCap: a register with three scans has not been "checked over
    // the last 24", and claiming it had would overstate the evidence by eight times.
    expect(view.cap).toBe(3);
    expect(view.capNote).toBe("Checked over the last 3 scans.");
    expect(capacityHindcastView(hindcast({
      rows: [hcRow()], comparable: 1, counterperformative: 0, scansConsidered: 1,
    })).capNote).toBe("Checked over the last 1 scan.");
  });

  it("prints the three verdicts in the page's own words", () => {
    expect(view.rows.map((r) => r.verdictText)).toEqual([
      "Falling behind", "Keeping up", EM_DASH,
    ]);
    expect(view.rows.map((r) => r.asOf)).toEqual([
      "2026-02-02T00:00:00Z", "2026-01-02T00:00:00Z", "2025-12-05T00:00:00Z",
    ]);
  });

  it("answers yes / no / dash, and never 'no' for a row nobody could score", () => {
    expect(view.rows.map((r) => r.agreedText)).toEqual(["no", "yes", EM_DASH]);
  });
});

describe("capacityHindcastView — a null outcome is an em dash, never 0%", () => {
  it("refuses null before the format, so an unobserved month is not a steady one", () => {
    // A month that opened with nothing in the backlog has no net rate at all. `0.0%` there
    // would report a program holding exactly level over a month it never measured — the
    // "absent is never zero" rule, at the last place it can still be broken.
    const view = capacityHindcastView(hindcast({
      rows: [
        hcRow({ verdict: "gaining", realisedNetPct: null, agreed: null }),
        hcRow({ asOf: "2026-01-02T00:00:00Z", realisedNetPct: 0, agreed: false }),
        hcRow({ asOf: "2025-12-05T00:00:00Z", realisedNetPct: -50, agreed: true }),
      ],
      comparable: 2,
      counterperformative: 0,
      scansConsidered: 3,
    }));
    expect(view.rows.map((r) => r.realisedText)).toEqual([EM_DASH, "0.0%", "-50.0%"]);
    expect(view.rows[0].realisedText).not.toBe("0.0%");
  });
});
