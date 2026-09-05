// The issue lifecycle ledger — the only place in this app that can say when a row LEFT.
//
// Every case here is about a distinction that a simpler ledger collapses, and each one of
// those collapses publishes a remediation figure nobody measured:
//
//   absent under an UNCHANGED scope   the row went away          → dated, "gone by"
//   absent under a CHANGED scope      the question changed       → left open, and COUNTED
//   absent and already dated          nothing new happened       → carried, not re-dated
//   present again after an absence    a reopen, a second episode → episode 2, date cleared
//
// The scope guard is ported from the OS register (`gas/src/domain/reconcile.ts`), where the
// gate is the severity set a scan applied; here it is the category scope. Its test is the
// one that matters most, because the failure it prevents does not look like a failure: a
// narrowed register reads as thousands of issues remediated on a single afternoon.

import { describe, expect, it } from "vitest";
import { ledgerCensus, reconcileIssueLedger, type IssueLedgerRow } from "../src/domain/issueLedger";
import type { IssueRow } from "../src/domain/graphTypes";

const AI = "wct-id-1998";
const VULN = "wct-id-3";
const SCOPE_AI = AI;
const SCOPE_WIDE = [AI, VULN].join("|");

const T1 = "2026-09-01T00:00:00.000Z";
const T2 = "2026-09-02T00:00:00.000Z";
const T3 = "2026-09-03T00:00:00.000Z";

function issue(over: Partial<IssueRow> = {}): IssueRow {
  return {
    id: "iss-1",
    ruleId: "wc-id-2742",
    ruleName: "Managed AI agent invoking a model without guardrails",
    comboGroup: "bedrock-no-guardrail",
    nativeSeverity: "HIGH",
    adjustedSeverity: "CRITICAL",
    status: "OPEN",
    assetId: "agent-a",
    assetName: "Agent-A",
    categories: [AI],
    createdAt: "2026-06-01T00:00:00.000Z",
    dueAt: "2026-07-01T00:00:00.000Z",
    ...over,
  } as IssueRow;
}

/** Sync 1: an empty ledger meets one issue. The state every other case starts from. */
function firstSync(issues: IssueRow[] = [issue()], scope = SCOPE_AI): IssueLedgerRow[] {
  return reconcileIssueLedger([], issues, "sync-1", T1, scope, null).rows;
}

describe("a first sync can date nothing but the sighting", () => {
  it("writes the row as new, present, and on its first episode", () => {
    const { rows, deltas } = reconcileIssueLedger([], [issue()], "sync-1", T1, SCOPE_AI, null);
    expect(rows).toEqual([{
      issueId: "iss-1",
      firstSeenSync: "sync-1",
      firstSeenAt: T1,
      lastSeenSync: "sync-1",
      lastSeenAt: T1,
      disappearedAt: null,
      resolutionSrc: null,
      lastStatus: "OPEN",
      categories: [AI],
      ruleId: "wc-id-2742",
      createdAt: "2026-06-01T00:00:00.000Z",
      dueAt: "2026-07-01T00:00:00.000Z",
      registerScope: SCOPE_AI,
      episode: 1,
    }]);
    expect(deltas).toEqual({
      new: 1, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0,
    });
  });

  it("dates first-seen from the SYNC, never from Wiz's createdAt", () => {
    // The distance the whole clock rests on. `createdAt` can predate the tab by a year; this
    // ledger's first_seen is its own observation, and the forward-only claim depends on the
    // two never being confused. It is also why a reopen cannot inflate an episode: there is
    // no API field to re-derive.
    const [row] = firstSync([issue({ createdAt: "2025-01-01T00:00:00.000Z" })]);
    expect([row!.firstSeenAt, row!.createdAt])
      .toEqual([T1, "2025-01-01T00:00:00.000Z"]);
  });

  it("resolves nothing by absence when there is no previous committed scope", () => {
    // prevScopeSignature null is UNKNOWN, not "the same scope". A ledger carried across a
    // history wipe (resetData) meets an empty prior scope, and reading that as coverage
    // would resolve the entire register on the first sync after it.
    const prev = firstSync();
    const { rows, deltas } = reconcileIssueLedger(prev, [], "sync-2", T2, SCOPE_AI, null);
    expect(rows[0]!.disappearedAt).toBeNull();
    expect(deltas.skippedNarrowedScope).toBe(1);
    expect(deltas.resolved).toBe(0);
  });
});

describe("disappearance under an UNCHANGED scope", () => {
  it("dates the departure at the sync that first failed to see it", () => {
    const prev = firstSync();
    const { rows, deltas } = reconcileIssueLedger(prev, [], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    expect([rows[0]!.disappearedAt, rows[0]!.resolutionSrc]).toEqual([T2, "disappeared"]);
    // The row is NOT deleted, and the sighting dates are untouched: the interval between
    // last_seen and disappeared_at is the error bar on the claim.
    expect([rows[0]!.lastSeenSync, rows[0]!.lastSeenAt]).toEqual(["sync-1", T1]);
    expect(deltas).toEqual({
      new: 0, resolved: 1, reopened: 0, carried: 0, skippedNarrowedScope: 0,
    });
  });

  it("carries an already-dated row forward untouched rather than re-dating it", () => {
    const gone = reconcileIssueLedger(firstSync(), [], "sync-2", T2, SCOPE_AI, SCOPE_AI).rows;
    const { rows, deltas } = reconcileIssueLedger(gone, [], "sync-3", T3, SCOPE_AI, SCOPE_AI);
    expect(rows[0]!.disappearedAt).toBe(T2);
    expect(deltas).toEqual({
      new: 0, resolved: 0, reopened: 0, carried: 1, skippedNarrowedScope: 0,
    });
  });
});

describe("disappearance under a CHANGED scope is not a remediation", () => {
  it("leaves the row open and COUNTS the skip", () => {
    // The ported guard, and the reason it exists: narrowing the category list makes every
    // row of the dropped categories absent BY CONSTRUCTION. Resolving them would publish a
    // remediation programme that never happened.
    const prev = firstSync([issue()], SCOPE_WIDE);
    const { rows, deltas } = reconcileIssueLedger(prev, [], "sync-2", T2, SCOPE_AI, SCOPE_WIDE);
    expect([rows[0]!.disappearedAt, rows[0]!.resolutionSrc]).toEqual([null, null]);
    expect(deltas).toEqual({
      new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 1,
    });
  });

  it("skips a WIDENING too, and the count is what says so", () => {
    // A widened scope provably cannot un-see a row, so this absence probably IS a departure.
    // It is still skipped: proving "superset" from two signatures is a claim, and the eval
    // needs only the skip counted. One interval of latency against a wrong date.
    const prev = firstSync();
    const { rows, deltas } = reconcileIssueLedger(prev, [], "sync-2", T2, SCOPE_WIDE, SCOPE_AI);
    expect(rows[0]!.disappearedAt).toBeNull();
    expect(deltas.skippedNarrowedScope).toBe(1);
  });

  it("resumes dating departures once the scope holds still again", () => {
    const prev = firstSync([issue()], SCOPE_WIDE);
    const skipped = reconcileIssueLedger(prev, [], "sync-2", T2, SCOPE_AI, SCOPE_WIDE).rows;
    const { rows, deltas } = reconcileIssueLedger(skipped, [], "sync-3", T3, SCOPE_AI, SCOPE_AI);
    expect([rows[0]!.disappearedAt, rows[0]!.resolutionSrc]).toEqual([T3, "disappeared"]);
    expect(deltas.resolved).toBe(1);
  });
});

describe("a reopen is a second episode, not a new row", () => {
  it("clears the date, increments the episode, and keeps the original first-seen", () => {
    const gone = reconcileIssueLedger(firstSync(), [], "sync-2", T2, SCOPE_AI, SCOPE_AI).rows;
    const { rows, deltas } = reconcileIssueLedger(
      gone, [issue()], "sync-3", T3, SCOPE_AI, SCOPE_AI,
    );
    expect(rows[0]).toMatchObject({
      firstSeenSync: "sync-1",
      firstSeenAt: T1,
      lastSeenSync: "sync-3",
      lastSeenAt: T3,
      disappearedAt: null,
      resolutionSrc: "reopened",
      episode: 2,
    });
    expect(deltas).toEqual({
      new: 0, resolved: 0, reopened: 1, carried: 0, skippedNarrowedScope: 0,
    });
  });

  it("does not re-count a reopen on the sync after it", () => {
    const gone = reconcileIssueLedger(firstSync(), [], "sync-2", T2, SCOPE_AI, SCOPE_AI).rows;
    const back = reconcileIssueLedger(gone, [issue()], "sync-3", T3, SCOPE_AI, SCOPE_AI).rows;
    const { rows, deltas } = reconcileIssueLedger(
      back, [issue()], "sync-4", "2026-09-04T00:00:00.000Z", SCOPE_AI, SCOPE_AI,
    );
    expect(deltas.reopened).toBe(0);
    // `resolutionSrc` keeps naming the last lifecycle event; the episode does not move again.
    expect([rows[0]!.resolutionSrc, rows[0]!.episode]).toEqual(["reopened", 2]);
  });
});

describe("the frozen inputs", () => {
  it("refreshes on every sighting", () => {
    const prev = firstSync([issue({ aiAdjacency: "UNLINKED", status: "OPEN" })]);
    const { rows } = reconcileIssueLedger(
      prev,
      [issue({
        status: "IN_PROGRESS",
        aiAdjacency: "ADJACENT",
        exploitationTier: "kev",
        epssPeak: 0.62,
        dueAt: "2026-08-01T00:00:00.000Z",
      })],
      "sync-2", T2, SCOPE_AI, SCOPE_AI,
    );
    expect(rows[0]).toMatchObject({
      lastStatus: "IN_PROGRESS",
      aiAdjacency: "ADJACENT",
      exploitationTier: "kev",
      epssPeak: 0.62,
      dueAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("DROPS a reading the new sighting does not carry, rather than carrying it forward", () => {
    // Absent is never zero, and it is never last week either. A sync whose VULN_FINDINGS step
    // was refused stamps no tier; keeping the previous one would date an exploitation reading
    // to a scan that never ran the fold — the same restamping `persistSync` refuses one tab
    // over. `rank.exploitationOf` drops an absent tier out of the blend; "none" scores.
    const prev = firstSync([issue({ exploitationTier: "kev", epssPeak: 0.62 })]);
    const { rows } = reconcileIssueLedger(prev, [issue()], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    expect("exploitationTier" in rows[0]!).toBe(false);
    expect("epssPeak" in rows[0]!).toBe(false);
  });

  it("keeps a decided tier with no probability as an explicit null", () => {
    // A KEV finding need not carry an EPSS. `null` is "the fold ran and captured none";
    // absent, one case up, is "no fold ran". Two different claims on one column.
    const { rows } = reconcileIssueLedger(
      [], [issue({ exploitationTier: "kev" })], "sync-1", T1, SCOPE_AI, null,
    );
    expect(rows[0]!.exploitationTier).toBe("kev");
    expect(rows[0]!.epssPeak).toBeNull();
  });

  it("unions the categories rather than letting the last sighting win", () => {
    // Which questions have ever returned this row. A narrowed scope must not be able to erase
    // the fact that a wider one matched it — that is the audit trail behind every scoped total.
    const prev = firstSync([issue({ categories: [AI] })]);
    const widened = reconcileIssueLedger(
      prev, [issue({ categories: [VULN] })], "sync-2", T2, SCOPE_WIDE, SCOPE_AI,
    ).rows;
    expect(widened[0]!.categories).toEqual([AI, VULN]);
    // And the scope stamp is the scope the sync APPLIED, which is a different fact: the
    // categories say what matched, this says what was asked.
    expect(widened[0]!.registerScope).toBe(SCOPE_WIDE);
    const narrowed = reconcileIssueLedger(
      widened, [issue({ categories: [AI] })], "sync-3", T3, SCOPE_AI, SCOPE_WIDE,
    ).rows;
    expect(narrowed[0]!.categories).toEqual([AI, VULN]);
  });
});

describe("mechanics a persisted grid depends on", () => {
  it("is idempotent in the ROWS — a replay of the same sync changes nothing", () => {
    // The deltas are TRANSITION counts, so the replay reports zeroes: nothing moved the
    // second time, which is the honest reading of "this reconcile changed nothing".
    const once = reconcileIssueLedger(firstSync(), [issue()], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    const twice = reconcileIssueLedger(once.rows, [issue()], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    expect(twice.rows).toEqual(once.rows);
    expect(twice.deltas).toEqual({
      new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0,
    });
  });

  it("replays a disappearance without re-dating it", () => {
    const gone = reconcileIssueLedger(firstSync(), [], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    const again = reconcileIssueLedger(gone.rows, [], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    expect(again.rows).toEqual(gone.rows);
  });

  it("sorts by issueId, whatever order the register arrived in", () => {
    const { rows } = reconcileIssueLedger(
      [], [issue({ id: "iss-c" }), issue({ id: "iss-a" }), issue({ id: "iss-b" })],
      "sync-1", T1, SCOPE_AI, null,
    );
    expect(rows.map((r) => r.issueId)).toEqual(["iss-a", "iss-b", "iss-c"]);
    // Stable across a sync that adds a row in the middle of the range.
    const next = reconcileIssueLedger(
      rows, [issue({ id: "iss-b" }), issue({ id: "iss-abc" })], "sync-2", T2, SCOPE_AI, SCOPE_AI,
    );
    expect(next.rows.map((r) => r.issueId)).toEqual(["iss-a", "iss-abc", "iss-b", "iss-c"]);
  });

  it("does not mutate the ledger it was handed", () => {
    // The caller's array is its own read of the sheet. A reconcile that edited it in place
    // would make a preview indistinguishable from a commit.
    const prev = firstSync();
    const before = JSON.stringify(prev);
    reconcileIssueLedger(prev, [], "sync-2", T2, SCOPE_AI, SCOPE_AI);
    expect(JSON.stringify(prev)).toBe(before);
  });

  it("counts one issue once when the register carries it twice", () => {
    // An issue in several selected categories arrives once per category; mergeParts folds
    // them upstream, but a ledger that trusted that would double-count `new` the day it broke.
    const { rows, deltas } = reconcileIssueLedger(
      [], [issue({ categories: [AI] }), issue({ categories: [VULN] })], "sync-1", T1, SCOPE_WIDE, null,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.categories).toEqual([AI, VULN]);
    expect(deltas.new).toBe(1);
  });
});

describe("ledgerCensus", () => {
  it("splits the population by presence, and names the lifecycle events", () => {
    const first = firstSync([issue({ id: "iss-a" }), issue({ id: "iss-b" }), issue({ id: "iss-c" })]);
    const gone = reconcileIssueLedger(
      first, [issue({ id: "iss-a" })], "sync-2", T2, SCOPE_AI, SCOPE_AI,
    ).rows;
    const back = reconcileIssueLedger(
      gone, [issue({ id: "iss-a" }), issue({ id: "iss-b" })], "sync-3", T3, SCOPE_AI, SCOPE_AI,
    ).rows;
    expect(ledgerCensus(back)).toEqual({
      open: 2,          // iss-a never left, iss-b came back
      disappeared: 1,   // iss-c is still gone
      reopenedEver: 1,  // iss-b
      byResolutionSrc: { disappeared: 1, reopened: 1, none: 1 },
    });
  });

  it("reads an empty ledger as an empty census, which is not a claim about anything", () => {
    expect(ledgerCensus([])).toEqual({
      open: 0, disappeared: 0, reopenedEver: 0,
      byResolutionSrc: { disappeared: 0, reopened: 0, none: 0 },
    });
  });
});
