// Open-backlog movement across scans — `insights.openMovement`.
//
// WHY THIS IS NOT `insights.test.ts`'s `movement` describe. That one covers the scan-over-scan
// reconcile deltas: what arrived, closed and reopened between the last two scans. On a
// register scanned daily that is one day of news. This is the other question — how many
// findings were open a WEEK ago against how many are open now — and it is answered by
// REPLAYING the ledger at an earlier instant rather than by reading a delta somebody stored.
//
// THE REPLAY IS THE PART THAT CAN BE WRONG, so the first spec below pins it against the one
// number that is not a replay at all: ask `openAsOf` the question at `until`, and it must
// return exactly the live open count. Everything else here rests on that.
//
// FAILURE KIND. Both failures this file guards are failures of PRESENCE: a comparison that
// should be refused and is published anyway (endpoints too close, so the "difference" is a
// day of noise dressed as a week of progress), and a severity row that should not exist
// because the gate never looked at it.

import { describe, expect, it } from "vitest";

import { MOVEMENT_MIN_GAP_DAYS, openMovement } from "../src/domain/insights";

const DAY = 86_400_000;
const T0 = Date.parse("2026-08-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function scan(dayOffset: number, shape: "flat" | "grouped" = "flat") {
  return { ts: iso(T0 + dayOffset * DAY), shape };
}

interface RowSpec {
  severity?: string;
  status?: string;
  /** Days after T0 the finding was first seen. */
  born?: number;
  /** Days after T0 it was dated closed, or null for still open. */
  died?: number | null;
}

function row(spec: RowSpec) {
  const died = spec.died ?? null;
  return {
    severity: spec.severity ?? "HIGH",
    status: spec.status ?? (died === null ? "OPEN" : "RESOLVED"),
    first_seen: iso(T0 + (spec.born ?? 0) * DAY),
    resolved_at: died === null ? null : iso(T0 + died * DAY),
  };
}

const rows = (...specs: RowSpec[]) => specs.map(row);

describe("the replay and the live count are the same measurement", () => {
  // Both endpoints forced onto the SAME instant — two scan rows at one timestamp, and a zero
  // minimum gap — so `prevOpen` is `openAsOf` asked the question the live count already
  // answers. A finding is only ever dated closed at the scan that stopped seeing it, so the
  // two must agree exactly; if they ever stop agreeing, this block and the severity tiles
  // beside it on the page will print two different open totals with no clue which is right.
  const population = rows(
    { severity: "CRITICAL", born: 0 },
    { severity: "CRITICAL", born: 5 },
    { severity: "HIGH", born: 1, died: 20 },
    { severity: "HIGH", born: 2 },
    { severity: "MEDIUM", born: 0, died: 30 }, // closed exactly AT the endpoint
  );

  it("replays prevOpen at `until` as exactly the live open count", () => {
    const out = openMovement(population, [scan(30), scan(30)], { minGapDays: 0 });
    expect(out.comparable).toBe(true);
    expect(out.since).toBe(out.until);
    expect(out.gapDays).toBe(0);
    expect(out.total.open).toBe(3);
    expect(out.total.prevOpen).toBe(out.total.open);
    expect(out.total.delta).toBe(0);
    // And per severity, not merely in the aggregate — an aggregate can agree by two
    // compensating errors.
    for (const r of out.rows) expect([r.severity, r.prevOpen]).toEqual([r.severity, r.open]);
  });

  it("counts a finding closed exactly AT the endpoint as closed on both sides", () => {
    const out = openMovement(population, [scan(30), scan(30)], { minGapDays: 0 });
    const bySev = Object.fromEntries(out.rows.map((r) => [r.severity, r]));
    // `resolved_at === until` is closed, not open: `resolved > d` is strict, and the live
    // side agrees because the status says RESOLVED. The MEDIUM has nothing to say at either
    // endpoint, so it gets no row at all rather than a pair of zeros.
    expect(bySev["MEDIUM"]).toBeUndefined();
  });

  // THE ONE CONDITION UNDER WHICH THE IDENTITY ABOVE BREAKS, found by measurement while
  // writing this file rather than reasoned about: a row whose `first_seen` is LATER than the
  // newest scan is open on the live side (its status says so) and absent on the replay side
  // (it was not born yet). The equality spec above reported `expected 3 to be 4` until such a
  // row was taken out of its fixture.
  //
  // It is not reachable through the real ingest path — `first_seen` is the API's own
  // `firstDetectedAt`, which is by construction at or before the scan that observed it — so
  // this is pinned as the BOUNDARY rather than fixed. It is reachable through an imported
  // migration bundle carrying a future date, and if it ever shows up the two halves of the
  // Executive page will disagree by exactly the number of such rows. Better to have the
  // condition written down than to have the identity look unconditional.
  it("is not an identity for a row born after the newest scan, and this is that row", () => {
    const future = rows({ severity: "LOW", born: 31 });
    const out = openMovement(future, [scan(30), scan(30)], { minGapDays: 0 });
    expect(out.total.open).toBe(1); // the status says open
    expect(out.total.prevOpen).toBe(0); // it did not exist at `until`
    expect(out.total.delta).toBe(1);
  });
});

describe("choosing the two endpoints", () => {
  const population = rows(
    { severity: "CRITICAL", born: 0 },
    { severity: "CRITICAL", born: 0, died: 25 },
    { severity: "HIGH", born: 0, died: 12 },
    { severity: "HIGH", born: 22 },
  );
  // Scans on days 0, 5, 10, 20, 28, 30. Against a 7-day minimum and `until` = day 30, the
  // qualifying candidates are days 0, 5, 10 and 20 — and 20 is the answer.
  const log = [scan(0), scan(5), scan(10), scan(20), scan(28), scan(30)];

  it("takes the NEWEST qualifying scan as `since`, not the oldest", () => {
    const out = openMovement(population, log, {});
    expect(out.comparable).toBe(true);
    expect(out.since).toBe(iso(T0 + 20 * DAY));
    expect(out.until).toBe(iso(T0 + 30 * DAY));
    expect(out.gapDays).toBe(10);
    // Taking day 0 instead would answer a question about the register's whole life and call
    // it a week: prevOpen there is 3 (the day-22 HIGH is not born yet) against 2 at day 20,
    // so the block would report -2 where the week's actual movement is 0.
    const wholeLife = openMovement(population, [scan(0), scan(30)], {});
    expect(wholeLife.total.prevOpen).toBe(3);
    expect(out.total.prevOpen).toBe(2);
  });

  it("honours the minimum gap it is handed", () => {
    expect(openMovement(population, log, { minGapDays: 11 }).since)
      .toBe(iso(T0 + 10 * DAY));
    expect(openMovement(population, log, { minGapDays: 1 }).since)
      .toBe(iso(T0 + 28 * DAY));
    // The default is the exported constant, not a literal repeated here.
    expect(MOVEMENT_MIN_GAP_DAYS).toBe(7);
    expect(openMovement(population, log, {}).since)
      .toBe(openMovement(population, log, { minGapDays: MOVEMENT_MIN_GAP_DAYS }).since);
  });

  it("clears the gap on exactly `minGapDays` — the comparison is >=, not >", () => {
    // Eight daily scans span exactly 7 days, which is the shape `dev/boot.js` seeds. If this
    // were a strict `>` the seeded harness would refuse forever and nobody would see the
    // comparable state locally.
    const eight = Array.from({ length: 8 }, (_, i) => scan(i));
    const out = openMovement(population, eight, {});
    expect(out.comparable).toBe(true);
    expect(out.gapDays).toBe(7);
  });

  it("ignores grouped scans — a scan that reconciled nothing moved nothing", () => {
    // A grouped scan writes zero deltas by construction (`persistGroupedScan`), so it cannot
    // be one side of a difference. With the grouped row on day 30 the newest FLAT scan is
    // day 20, and the whole comparison shifts accordingly.
    const withGrouped = [scan(0), scan(20), scan(30, "grouped")];
    const out = openMovement(population, withGrouped, {});
    expect(out.until).toBe(iso(T0 + 20 * DAY));
    expect(out.since).toBe(iso(T0 + 0 * DAY));
  });
});

describe("the refusals, and what each one still tells the reader", () => {
  const population = rows({ severity: "CRITICAL", born: 0 });

  it("refuses with `noScan` and publishes nothing it cannot know", () => {
    const out = openMovement(population, [], {});
    expect(out).toEqual({
      comparable: false, reason: "noScan", since: null, until: null, gapDays: null,
      rows: [], total: { open: 0, prevOpen: 0, delta: 0 },
    });
  });

  it("refuses with `oneScan` but still names when the register last looked", () => {
    const out = openMovement(population, [scan(30)], {});
    expect(out.comparable).toBe(false);
    expect(out.reason).toBe("oneScan");
    expect(out.until).toBe(iso(T0 + 30 * DAY));
    expect(out.since).toBeNull();
    expect(out.gapDays).toBeNull();
  });

  it("refuses with `tooClose` and publishes the REAL span the log can offer", () => {
    // Four scans over three days against a seven-day minimum. "No comparison available" would
    // be true and useless; "the saved scans span 3.5 days" is what makes "look again next
    // week" the obvious next move.
    const tight = [scan(0), scan(1), scan(2), scan(3.5)];
    const out = openMovement(population, tight, {});
    expect(out.comparable).toBe(false);
    expect(out.reason).toBe("tooClose");
    expect(out.gapDays).toBe(3.5);
    expect(out.until).toBe(iso(T0 + 3.5 * DAY));
    expect(out.rows).toEqual([]);

    // The WIDEST span, not the nearest gap: the nearest gap here is 1.5 days, and reporting
    // that would understate how long the register has been watching by more than half.
    expect(out.gapDays).not.toBe(1.5);
  });

  it("rounds the published span to one decimal — 13.5 days is not 14 and not 13", () => {
    const out = openMovement(population, [scan(0), scan(0.26)], {});
    expect(out.gapDays).toBe(0.3);
  });
});

describe("which severities get a row", () => {
  const population = rows(
    { severity: "CRITICAL", born: 0 },
    { severity: "CRITICAL", born: 0, died: 25 },
    { severity: "LOW", born: 0 },
    { severity: "LOW", born: 22 },
  );
  const log = [scan(20), scan(30)];

  it("rows are in SEVERITY_ORDER and sum to the total on both sides", () => {
    const out = openMovement(population, log, {});
    expect(out.rows.map((r) => r.severity)).toEqual(["CRITICAL", "LOW"]);
    expect(out.rows.reduce((n, r) => n + r.open, 0)).toBe(out.total.open);
    expect(out.rows.reduce((n, r) => n + r.prevOpen, 0)).toBe(out.total.prevOpen);
    expect(out.rows.reduce((n, r) => n + r.delta, 0)).toBe(out.total.delta);
  });

  it("draws a genuine zero for a gated severity the register does not hold", () => {
    // HIGH is in the gate and has no findings: somebody selected it and the answer is none.
    // That IS a measurement, so it is drawn.
    const out = openMovement(population, log, { severities: ["CRITICAL", "HIGH"] });
    const bySev = Object.fromEntries(out.rows.map((r) => [r.severity, r]));
    expect(bySev["HIGH"]).toEqual({ severity: "HIGH", open: 0, prevOpen: 0, delta: 0 });
  });

  it("never draws a zero for a severity the gate excluded", () => {
    // MEDIUM and INFO are outside the gate and outside the population. The register did not
    // look at them, and a `0` would say it looked and found none — the exact conflation
    // CLAUDE.md's "The Outside" is about.
    const out = openMovement(population, log, { severities: ["CRITICAL", "HIGH"] });
    const drawn = out.rows.map((r) => r.severity);
    expect(drawn).not.toContain("MEDIUM");
    expect(drawn).not.toContain("INFO");
    // LOW is outside the gate too — and it IS present in the population, so it is a real
    // count rather than an invented zero, and dropping it would stop the rows summing to the
    // total. Present beats gated; only the intersection of "excluded" and "absent" vanishes.
    expect(drawn).toContain("LOW");
    expect(out.rows.reduce((n, r) => n + r.open, 0)).toBe(out.total.open);
  });

  it("with no gate at all, draws every severity present at either endpoint", () => {
    const out = openMovement(population, log, { severities: null });
    expect(out.rows.map((r) => r.severity)).toEqual(["CRITICAL", "LOW"]);
    // The CRITICAL that closed on day 25 is inside the window, so its severity has something
    // to say even though only one CRITICAL is open now.
    const crit = out.rows.find((r) => r.severity === "CRITICAL")!;
    expect(crit).toEqual({ severity: "CRITICAL", open: 1, prevOpen: 2, delta: -1 });
  });

  it("says nothing about a severity whose findings all closed before the window", () => {
    const old = rows({ severity: "MEDIUM", born: 0, died: 5 }, { severity: "HIGH", born: 0 });
    const out = openMovement(old, log, { severities: null });
    expect(out.rows.map((r) => r.severity)).toEqual(["HIGH"]);
  });
});

describe("rows the clock cannot read", () => {
  it("treats a finding with no first_seen as not yet born, never as epoch 0", () => {
    // `Number(null)` is 0 and it is finite; a `parseTs` that fell through to a cast would
    // date this finding to 1970 and count it open at every instant the register has ever
    // observed. `openAsOf` refuses the null before any of that.
    const out = openMovement(
      [{ severity: "HIGH", status: "OPEN", first_seen: null, resolved_at: null }],
      [scan(20), scan(30)],
      {},
    );
    expect(out.total.open).toBe(1); // live: the status says open
    expect(out.total.prevOpen).toBe(0); // replay: undatable, so not claimed as open then
    expect(out.total.delta).toBe(1);
  });

  it("treats an unrecognised status as OPEN, matching every other reader here", () => {
    // The polarity in `isOpenStatus` is deliberate: a Wiz status the app has never seen
    // leaves the finding in the backlog rather than silently closing it.
    const out = openMovement(
      rows({ severity: "HIGH", born: 0, status: "TRIAGING" }),
      [scan(20), scan(30)],
      {},
    );
    expect(out.total.open).toBe(1);
  });
});
