// The half-life block on the two Priorities endpoints, against the dry-run seed.
//
// The estimator itself is pinned in `issueSurvival.test.ts` against hand-built rows. THIS file
// asks the other question, the one that fixture cannot: does the register's OWN seeded ledger
// — 40 rows written by `seedIssueLedger`, then reconciled by the dry run — actually reach the
// figure? A survival curve that is arithmetically perfect over rows nobody wired up publishes
// nothing at all, and the failure looks exactly like a register where nothing has ever been
// remediated.
//
// FAILURE OF PRESENCE: every case here is an event that must EXIST. The fixture's whole
// purpose is to make the eight departures visible; a payload reading `events: 0` is the defect
// this file is here to catch.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import type { IssueHalfLife } from "../src/domain/issueSurvival";

type Server = Awaited<ReturnType<typeof bootServer>>;

let server: Server;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  expect(res.ok, `seed sync failed: ${res.error}`).toBe(true);
});

afterAll(() => teardownServer());

function halfLifeOf(endpoint: "getProblems" | "getActions"): IssueHalfLife {
  const res = server.api[endpoint]({}) as { ok: boolean; data: { halfLife: IssueHalfLife } };
  expect(res.ok).toBe(true);
  return res.data.halfLife;
}

describe("failure of presence: the seeded ledger reaches the Priorities head", () => {
  it("counts eight departures, thirty-one open rows and one that came back", () => {
    const km = halfLifeOf("getProblems");
    // Eight events: `iss-gone-01..06`, dated by the dry run's own disappearance pass, plus
    // `iss-gone-07` and `iss-gone-08`, dated at synthetic syncs 3 and 5 and merely CARRIED by
    // the dry run. Six plus two — the same eight `seedLedger.test.ts` counts as the ledger
    // census `{open: 32, disappeared: 8}`.
    expect(km.events).toBe(8);
    // 40 ledger rows: 32 open, 8 dated gone. One of the 32 (`iss-005`) is at episode 2 and
    // leaves the estimate, so 31 open rows are censored and 39 are measured.
    expect(km.censored).toBe(31);
    expect(km.censored).toBeGreaterThanOrEqual(30);
    expect(km.total).toBe(39);
    expect(km.returnedExcluded).toBe(1);
    // Every one of the 40 rows carries dates the estimator could read.
    expect(km.unmeasurable).toBe(0);
    expect(km.total + km.returnedExcluded + km.unmeasurable).toBe(40);
  });

  it("publishes a lower bound rather than a median, because the curve never reaches half", () => {
    const km = halfLifeOf("getProblems");
    // Eight events against a risk set of 39: survival falls to about 0.686 at the longest
    // event time and stops there. A median would have to be invented, so there is none — and
    // the longest lifetime the register actually observed is published in its place. The
    // synthetic syncs are one day apart over eight days, so that bound is 8 days: both the
    // oldest surviving rows and `iss-gone-01` span the whole seeded history.
    expect(km.median).toBeNull();
    expect(km.p90).toBeNull();
    expect(km.medianLowerBound).toBe(8);
    expect(km.medianLowerBound!).toBeGreaterThan(0);
  });

  it("draws the staircase over the register's own event times", () => {
    const km = halfLifeOf("getProblems");
    // Distinct departure times in days: three rows at 2 (`iss-gone-06`, and the two carried
    // rows that each lived two synthetic syncs), then one each at 3, 4, 5, 7 and 8.
    expect(km.curve.map((p) => p.t)).toEqual([2, 3, 4, 5, 7, 8]);
    expect(km.curve[0]!.events).toBe(3);
    expect(km.curve[0]!.atRisk).toBe(34);
    // Monotone non-increasing, which is the one property a survival curve cannot lose.
    for (let i = 1; i < km.curve.length; i += 1) {
      expect(km.curve[i]!.s).toBeLessThanOrEqual(km.curve[i - 1]!.s);
    }
    expect(km.curve[km.curve.length - 1]!.s).toBeGreaterThan(0.5);
  });

  it("stamps asOf from the ledger's own newest sighting, never from a clock", () => {
    const km = halfLifeOf("getProblems");
    expect(km.asOf).toBeTruthy();
    // The dry run saw 32 rows and dated 6 departures, all at its own instant, so the newest
    // observation in the ledger is that sync's timestamp.
    const boot = server.api.bootstrap({}) as {
      data: { latestSync: { finished_at: string } | null };
    };
    const finished = boot.data.latestSync!.finished_at;
    expect(Date.parse(km.asOf!)).toBe(Math.floor(Date.parse(finished) / 1000) * 1000);
  });

  it("publishes the same block on getActions", () => {
    // One derivation, two endpoints — the same rule `problemsMovement` is held to. The two
    // modes of the Priorities page must not be able to state different half-lives.
    expect(halfLifeOf("getActions")).toEqual(halfLifeOf("getProblems"));
  });

  it("does not re-fit itself to a filtered or paged view", () => {
    // The figure is about the whole ledger. A reader narrowing the register to one severity
    // is not asking a different survival question, and a curve that moved with the filter
    // would say they were.
    const filtered = server.api.getProblems({ severity: "HIGH", page: 1, pageSize: 5 }) as {
      data: { halfLife: IssueHalfLife };
    };
    expect(filtered.data.halfLife).toEqual(halfLifeOf("getProblems"));
  });
});
