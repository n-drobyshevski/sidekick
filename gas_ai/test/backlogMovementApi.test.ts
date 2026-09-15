// The movement block on the two Priorities endpoints, against the dry-run seed.
//
// The pure replay is pinned in `backlogMovement.test.ts` against hand-built rows. THIS file
// asks the other question: does the register's OWN history — eight fabricated commit records
// plus the dry run's own, written by `seedDryRunHistory` and `persistSync` — actually feed it?
// A replay that is arithmetically perfect over a fixture nobody wired up publishes nothing, and
// the failure looks exactly like a register that has only ever been synced once.
//
// FAILURE OF PRESENCE throughout: every case here is a comparison that must EXIST.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import type { BacklogMovement } from "../src/domain/backlogMovement";

type Server = Awaited<ReturnType<typeof bootServer>>;

let server: Server;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  expect(res.ok, `seed sync failed: ${res.error}`).toBe(true);
});

afterAll(() => teardownServer());

function movementOf(endpoint: "getProblems" | "getActions"): BacklogMovement {
  const res = server.api[endpoint]({}) as { ok: boolean; data: { movement: BacklogMovement } };
  expect(res.ok).toBe(true);
  return res.data.movement;
}

describe("failure of presence: the seeded history reaches the Priorities head", () => {
  it("replays the previous sync's open backlog off the dry run's own deltas", () => {
    const m = movementOf("getProblems");
    const prev = m.previous;
    expect(prev, "no previous comparison on a nine-sync register").not.toBeNull();
    // The dry run records {new: 3, resolved: 6, reopened: 1, carried: 2, skipped: 0} against
    // the fabricated prior (test/seedLedger.test.ts pins those five), and the register holds
    // 32 open issues after it. 32 - 3 - 1 + 6 = 34, which is exactly the `issue_count` the
    // eighth synthetic commit row carries — two independent statements of one population, and
    // the replay is the one that did not read the stored figure.
    expect(prev!.open).toBe(32);
    expect(prev!.prevOpen).toBe(34);
    expect(prev!.direction).toBe("down");
    expect(prev!.deltas).toEqual({
      new: 3, resolved: 6, reopened: 1, carried: 2, skippedNarrowedScope: 0,
    });
    expect(m.reasons.previous).toBeNull();
  });

  it("has a week row, because the synthetic syncs span eight days", () => {
    const m = movementOf("getProblems");
    expect(m.reasons.week, "the week comparison was refused").toBeNull();
    expect(m.week).not.toBeNull();
    // The synthetic rows are one day apart ending one day before the dry run, so the newest
    // row at least seven days back is synthetic sync 02 — whose stored `issue_count` is 18.
    expect(m.week!.prevOpen).toBe(18);
    expect(m.week!.open).toBe(32);
    expect(m.week!.direction).toBe("up");
    expect(m.week!.gapDays).toBe(7);
    expect(m.spanDays).toBe(8);
  });

  it("publishes the same block on getActions", () => {
    // One derivation, two endpoints. The two modes of the Priorities page must not be able to
    // state different movement — which is the same reason both read one `problemsModel`.
    expect(movementOf("getActions")).toEqual(movementOf("getProblems"));
  });

  it("anchors on ISSUES alone, never on the issues-union-findings total", () => {
    const res = server.api.getProblems({}) as {
      data: { total: number; movement: BacklogMovement };
    };
    // The union is strictly larger — findings are in it — and findings never enter the
    // lifecycle ledger, so anchoring on `total` would undo issue transitions from a count that
    // includes them and leave every `prevOpen` off by the finding population.
    expect(res.data.total).toBeGreaterThan(32);
    expect(res.data.movement.previous!.open).toBe(32);
  });
});
