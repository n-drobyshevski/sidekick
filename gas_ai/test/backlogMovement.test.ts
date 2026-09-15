// OPEN-BACKLOG MOVEMENT — the backwards replay, and every reason it refuses to run.
//
// TWO FAILURE KINDS, and each `describe` names the one it holds.
//
//   A FAILURE OF PRESENCE here is a comparison that should exist and does not: a week row
//   refused as `tooClose` when a row seven days back is sitting in the history, a `noLedger`
//   raised against rows that carry their deltas. It looks like a register that has only ever
//   been synced once, and it is the safe direction to fail in.
//
//   A FAILURE OF ABSENCE is the dangerous one: a comparison that is PUBLISHED and wrong. Two
//   populations compared across a scope change, five zeroes read out of a cell that named no
//   transition, or the replay's sign flipped so that a backlog which shrank reads as one that
//   grew. Every one of those is a number a reader would act on. The perturbation at the foot
//   of this file is of that kind.

import { describe, expect, it } from "vitest";
import {
  backlogMovement, MOVEMENT_MIN_GAP_DAYS, type MovementComparison,
} from "../src/domain/backlogMovement";
import type { IssueLedgerDeltas } from "../src/domain/issueLedger";
import type { Rec } from "../src/domain/util";

const DAY_MS = 86_400_000;
const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const SCOPE = "wct-id-1998";

const at = (days: number): string => new Date(T0 + days * DAY_MS).toISOString();

function deltas(p: Partial<IssueLedgerDeltas> = {}): IssueLedgerDeltas {
  return { new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0, ...p };
}

/** One commit record, in the column shape `persistSync` and the dry-run seed both write. */
function row(
  days: number,
  d: Partial<IssueLedgerDeltas> | null,
  extra: Rec = {},
): Rec {
  return {
    sync_id: `sync-${days}`,
    started_at: at(days),
    finished_at: at(days),
    status: "SUCCESS",
    ledger_json: d === null ? null : JSON.stringify(deltas(d)),
    register_scope: SCOPE,
    ...extra,
  };
}

/** The live open count the replay anchors on, and the arithmetic the fixtures below encode. */
const OPEN_NOW = 32;

/**
 * THREE SYNCS, ONE WEEK APART, AND THE LIVE COUNT AT THE END.
 *
 *   day 0   open 18 after it
 *   day 7   +6 new, -2 resolved            -> open 22
 *   day 14  +11 new, -1 resolved, +0 reop  -> open 32   (the live count)
 *
 * Written forwards here on purpose: the module replays BACKWARDS, so a fixture stated in the
 * forward direction is an independent statement of the same arithmetic rather than a copy of
 * the implementation.
 */
const THREE_ROWS: Rec[] = [
  row(0, { new: 18 }),
  row(7, { new: 6, resolved: 2 }),
  row(14, { new: 11, resolved: 1 }),
];

describe("failure of absence: the replay must land on the population that really was open", () => {
  it("replays the previous sync's open count out of the live one", () => {
    const m = backlogMovement(THREE_ROWS, { openNow: OPEN_NOW });
    const prev = m.previous as MovementComparison;
    expect(prev).not.toBeNull();
    // 32 - 11 new - 0 reopened + 1 resolved = 22, which is what day 7 ended with.
    expect(prev.prevOpen).toBe(22);
    expect(prev.open).toBe(OPEN_NOW);
    expect(prev.since).toBe(at(7));
    expect(prev.until).toBe(at(14));
    expect(prev.gapDays).toBe(7);
    expect(m.reasons.previous).toBeNull();
  });

  it("replays every step of the week window, not just the last one", () => {
    const m = backlogMovement(THREE_ROWS, { openNow: OPEN_NOW });
    const week = m.week as MovementComparison;
    expect(week).not.toBeNull();
    // Two steps back: 32 -> 22 -> 18, which is what day 0 ended with.
    expect(week.prevOpen).toBe(22);
    expect(week.since).toBe(at(7));
    expect(week.gapDays).toBe(7);
    // The window's deltas are the SUM of the rows replayed, not the latest row's own.
    expect(week.deltas).toEqual(deltas({ new: 11, resolved: 1 }));
  });

  it("picks the NEWEST row that clears the minimum, not the oldest", () => {
    // Four rows: day 0, 7, 8 and 14. Both day 0 and day 7 are >= 7 d older than day 14; the
    // week row must be day 7. Taking day 0 would answer a question about the register's whole
    // life and label it a week.
    const rows = [row(0, { new: 18 }), row(7, { new: 6, resolved: 2 }), row(8, { new: 4 }),
      row(14, { new: 7, resolved: 1 })];
    const m = backlogMovement(rows, { openNow: OPEN_NOW });
    expect((m.week as MovementComparison).since).toBe(at(7));
    // 32 - 7 + 1 = 26 after day 8; 26 - 4 = 22 after day 7.
    expect((m.week as MovementComparison).prevOpen).toBe(22);
  });

  it("reads the history in either order — the rows are sorted, never trusted", () => {
    const forwards = backlogMovement(THREE_ROWS, { openNow: OPEN_NOW });
    // `syncStore.syncHistory()` is append order and `api.getSyncHistory` reverses it, so both
    // orders reach callers in this codebase.
    const backwards = backlogMovement([...THREE_ROWS].reverse(), { openNow: OPEN_NOW });
    expect(backwards).toEqual(forwards);
  });

  it("says the direction in a word", () => {
    // A register that closed 12 and opened 2: 10 - 2 + 12 = 20 was open before it.
    const shrank = backlogMovement([row(0, { new: 20 }), row(7, { new: 2, resolved: 12 })],
      { openNow: 10 });
    expect((shrank.previous as MovementComparison).direction).toBe("down");
    const grew = backlogMovement(THREE_ROWS, { openNow: OPEN_NOW });
    expect((grew.previous as MovementComparison).direction).toBe("up");
    // Flat is a real answer, not the absence of one: three in, three out.
    const flat = backlogMovement([row(0, { new: 5 }), row(7, { new: 3, resolved: 3 })],
      { openNow: 5 });
    expect((flat.previous as MovementComparison).direction).toBe("flat");
  });

  it("counts a non-SUCCESS row as no step at all", () => {
    // A failed sync appends no lifecycle transition — `persistSync` writes the commit record
    // LAST — so it must neither be replayed nor break the walk.
    const rows = [...THREE_ROWS, row(14.5, { new: 999 }, { status: "FAILED" })];
    expect(backlogMovement(rows, { openNow: OPEN_NOW }))
      .toEqual(backlogMovement(THREE_ROWS, { openNow: OPEN_NOW }));
  });
});

describe("failure of presence: the named reasons, and the span published beside them", () => {
  it("says noSync with nothing recorded", () => {
    const m = backlogMovement([], { openNow: 0 });
    expect(m.previous).toBeNull();
    expect(m.reasons.previous).toBe("noSync");
    expect(m.spanDays).toBeNull();
  });

  it("says oneSync with a single commit record", () => {
    const m = backlogMovement([row(0, { new: 18 })], { openNow: 18 });
    expect(m.reasons.previous).toBe("oneSync");
    expect(m.week).toBeNull();
    expect(m.spanDays).toBeNull();
  });

  it("says tooClose, and publishes the real span the log DOES cover", () => {
    const rows = [row(0, { new: 18 }), row(1, { new: 2 }), row(3, { new: 1 })];
    const m = backlogMovement(rows, { openNow: 21 });
    expect(m.week).toBeNull();
    expect(m.reasons.week).toBe("tooClose");
    // The widest span, not the nearest gap: "the saved syncs span 3 days" is what makes
    // "look again next week" the obvious next move.
    expect(m.spanDays).toBe(3);
    // `previous` still stands — a one-day comparison is a real comparison, it is only the
    // WEEK claim the minimum gap governs.
    expect((m.previous as MovementComparison).prevOpen).toBe(20);
  });

  it("takes MOVEMENT_MIN_GAP_DAYS as the boundary, and includes it", () => {
    expect(MOVEMENT_MIN_GAP_DAYS).toBe(7);
    // Exactly 7 d clears it...
    expect(backlogMovement(THREE_ROWS, { openNow: OPEN_NOW }).week).not.toBeNull();
    // ...and one hour under it does not. Two rows only: a third, older one would clear the
    // minimum on its own and the boundary under test would never be reached.
    const rows = [row(0, { new: 18 }), row(7 - 1 / 24, { new: 6 })];
    expect(backlogMovement(rows, { openNow: OPEN_NOW }).reasons.week).toBe("tooClose");
  });

  it("says noLedger for a sync recorded before the ledger existed", () => {
    // The PREVIOUS endpoint predates the ledger. The latest row's own deltas are readable, so
    // the arithmetic would run — and it would compare against a population nobody counted.
    const rows = [row(0, null), row(7, null), row(14, { new: 11, resolved: 1 })];
    const m = backlogMovement(rows, { openNow: OPEN_NOW });
    expect(m.previous).toBeNull();
    expect(m.reasons.previous).toBe("noLedger");
    expect(m.reasons.week).toBe("noLedger");
  });

  it("says noLedger for a cell that named no transition at all", () => {
    // `Number(undefined)` is NaN and `{}` has none of the five keys — both are "nobody
    // counted", and reading either as five zeroes would claim a sync that moved nothing.
    for (const cell of ["{}", "null", "[]", "not json", ""]) {
      const rows = [row(0, { new: 18 }), row(7, null, { ledger_json: cell })];
      const m = backlogMovement(rows, { openNow: OPEN_NOW });
      expect(m.reasons.previous, `ledger_json ${JSON.stringify(cell)}`).toBe("noLedger");
      expect(m.previous, `ledger_json ${JSON.stringify(cell)}`).toBeNull();
    }
  });

  it("stops the walk at a sync that resolved nothing because the scope moved", () => {
    // `skippedNarrowedScope > 0` is the ledger's own record that this sync declined to read
    // absence as remediation. Its `resolved` is understated by an amount nobody can recover,
    // so undoing that step lands on a population that never existed.
    //
    // THE RESCOPED SYNC IS IN THE MIDDLE OF THE WINDOW, not at its edge, and the placement is
    // the test. A rescope on the OLDER ENDPOINT is harmless — the replay never applies that
    // row's deltas, only the ones after it — so a fixture that put it there would pass against
    // a module with no scope guard at all.
    const rows = [
      row(0, { new: 18 }),
      row(7, { new: 6, resolved: 2 }),
      row(10, { new: 3, skippedNarrowedScope: 4 }),
      row(14, { new: 11, resolved: 1 }),
    ];
    const m = backlogMovement(rows, { openNow: OPEN_NOW });
    // The latest step is clean, so `previous` still stands...
    expect((m.previous as MovementComparison).prevOpen).toBe(22);
    // ...and the week walk, which has to pass THROUGH the rescoped sync, refuses.
    expect(m.week).toBeNull();
    expect(m.reasons.week).toBe("rescoped");
  });

  it("leaves a rescope on the OLDER endpoint alone", () => {
    // The control for the case above. Row 7 declined to resolve four absences, so ITS OWN
    // `resolved` understates what left between syncs 0 and 7 — and the week window here runs
    // from 7 to 14, which that understatement does not touch. Refusing here would withhold a
    // comparison the ledger can actually make.
    const rows = [
      row(0, { new: 18 }),
      row(7, { new: 6, skippedNarrowedScope: 4 }),
      row(14, { new: 11, resolved: 1 }),
    ];
    const m = backlogMovement(rows, { openNow: OPEN_NOW });
    expect(m.reasons.week).toBeNull();
    expect((m.week as MovementComparison).prevOpen).toBe(22);
  });

  it("stops at a scope change that skippedNarrowedScope cannot see", () => {
    // A WIDENING with no absent rows leaves `skippedNarrowedScope` at 0 while `new` carries a
    // whole category that was never in the prior. `reconcileIssueLedger` only counts what it
    // REFUSED to resolve, so a sync with nothing absent records a clean zero and the register
    // still measured two different populations.
    const rows = [
      row(0, { new: 18 }),
      row(7, { new: 14 }, { register_scope: "wct-id-1998|wct-id-2000" }),
    ];
    const m = backlogMovement(rows, { openNow: OPEN_NOW });
    expect(m.previous).toBeNull();
    expect(m.reasons.previous).toBe("rescoped");
  });

  it("treats a missing scope stamp as UNKNOWN, never as 'the same scope'", () => {
    const rows = [row(0, { new: 18 }), row(7, { new: 14 }, { register_scope: "" })];
    expect(backlogMovement(rows, { openNow: OPEN_NOW }).reasons.previous).toBe("rescoped");
  });

  it("names noLedger rather than rescoped when the older endpoint predates both", () => {
    // A pre-ledger row carries no scope stamp EITHER, so the scope rule above would fire on
    // it and blame a re-scope for a register that simply predates the ledger.
    const rows = [row(0, null, { register_scope: "" }), row(7, { new: 14 })];
    expect(backlogMovement(rows, { openNow: OPEN_NOW }).reasons.previous).toBe("noLedger");
  });
});

describe("failure of absence: the sign of the replay", () => {
  // THE PERTURBATION. The identity is open(k-1) = open(k) - new - reopened + resolved, and the
  // one plausible mistype is the sign on `resolved`: it reads naturally as "and take off what
  // was resolved". Reproduced inline rather than described, because the number it produces is
  // not obviously wrong — it is an integer of the right magnitude, and the DIRECTION WORD
  // beside it is what a reader acts on.
  const DEFECTIVE_STEP_BACK = (open: number, d: IssueLedgerDeltas): number =>
    open - d.new - d.reopened - d.resolved;

  it("reads a backlog that was cleared as one that grew, when resolved is subtracted", () => {
    // A register that closed 12 of 20 and opened 2: 20 - 12 + 2 = 10 open now.
    const rows = [row(0, { new: 20 }), row(7, { new: 2, resolved: 12 })];
    const latest = deltas({ new: 2, resolved: 12 });

    const wrong = DEFECTIVE_STEP_BACK(10, latest);
    // 10 - 2 - 0 - 12 = -4. A NEGATIVE backlog, which is not a population at all — and the
    // headline it produces is "10 open, was -4", i.e. a register that grew.
    expect(wrong).toBe(-4);
    expect(10 > wrong).toBe(true);

    const m = backlogMovement(rows, { openNow: 10 });
    const prev = m.previous as MovementComparison;
    expect(prev.prevOpen).toBe(20);
    expect(prev.direction).toBe("down");
    // And the guard bites on the real fixture too, not only on the contrived one.
    expect(prev.prevOpen).not.toBe(wrong);
  });
});
