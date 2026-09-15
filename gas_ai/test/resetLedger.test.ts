// RESET MEANS RESET, LEDGER INCLUDED (F1).
//
// THE REACHABLE STATE THIS FILE CLOSES. `resetData` used to overwrite every synced tab EXCEPT
// `ai_issue_ledger` (`issueLedger.ts`'s own header calls that tab "the one tab in this app
// that is never overwritten" — right for a SYNC, which reconciles the ledger rather than
// replacing it, and silently wrong for a RESET, which is the user discarding the whole
// register's history). So a Reset followed by a dry-run Sync arrived with an empty sync
// history beside a REAL 40-row ledger. `seedIssueLedger` (`syncJobs.ts`) refuses into a
// non-empty ledger — correctly, on its own terms, since it must never clobber real
// observations — so the eight fabricated commit rows came back with no `ledger_json`,
// `issue_count` or `register_scope` at all, and the dry run went on to reconcile the
// surviving ledger against eight syncs nobody ran.
//
// THE FAILURE KIND. This is a failure of ABSENCE: the ledger that should have been erased by
// the reset persists, and the sync that follows dates departures (or fails to) against a
// prior it should never have been able to see. It is not a failure of presence — no row is
// missing from what the round trip produces; the round trip itself is the wrong shape.
//
// THE FIX AND ITS TEST. `resetData` now clears `ai_issue_ledger` too, so a sync after a reset
// must be indistinguishable from the very first sync a fresh store ever runs — same census,
// same deltas, same history row count. The perturbation below reproduces the OLD `resetData`
// inline (every tab except the ledger) and shows the actual wrong numbers it used to produce.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import { ledgerCensus, type IssueLedgerDeltas } from "../src/domain/issueLedger";
import type { Rec } from "../src/domain/util";

type Server = typeof import("../src/server/index");
type Store = typeof import("../src/server/syncStore");
type Sample = typeof import("../src/server/sampleData");
type Sheets = typeof import("../src/server/sheetsDb");

let server: Server;
let store: Store;
let sample: Sample;
let sheets: Sheets;

beforeEach(async () => {
  server = await bootServer();
  server.setup();
  // Imported after the boot, exactly as `seedLedger.test.ts` does: `bootServer` resets the
  // module registry, so the modules the server actually writes through are only reachable
  // from a fresh import taken after it.
  store = await import("../src/server/syncStore");
  sample = await import("../src/server/sampleData");
  sheets = await import("../src/server/sheetsDb");
});

afterAll(() => teardownServer());

function runSync(): void {
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  expect(res.ok, `sync failed: ${res.error}`).toBe(true);
}

function resetData(): void {
  const res = server.api.resetData({}) as { ok: boolean; error?: string };
  expect(res.ok, `resetData failed: ${res.error}`).toBe(true);
}

/** The dry run's own commit record — the last row of the history. */
function latestHistory(): Rec {
  const rows = store.syncHistory();
  return rows[rows.length - 1] as Rec;
}

/** The eight fabricated commit records, in the order they were written. */
function syntheticHistory(): Rec[] {
  return store.syncHistory().filter((r) => String(r["sync_id"] ?? "").startsWith("sync-sample-"));
}

function deltasOf(row: Rec): IssueLedgerDeltas {
  const raw = row["ledger_json"];
  // Refuse absent BEFORE the parse, as `seedLedger.test.ts` does: `JSON.parse(String(null))`
  // throws, and a test that read a missing column as `{}` would pass against a store that
  // recorded nothing.
  expect(raw, "the commit row carries no ledger_json").toBeTruthy();
  return JSON.parse(String(raw)) as IssueLedgerDeltas;
}

/**
 * What a fresh store's very first dry run reports — pinned once in `seedLedger.test.ts` and
 * restated here as the target a reset-then-sync round trip has to land back on exactly.
 */
const FIRST_RUN_CENSUS = { open: 32, disappeared: 8, reopenedEver: 1 };
const FIRST_RUN_DELTAS: IssueLedgerDeltas = {
  new: 3, resolved: 6, reopened: 1, carried: 2, skippedNarrowedScope: 0,
};

describe("failure of absence: a reset must erase the ledger, not just the history", () => {
  it("wipes the ledger to zero rows, alongside the history", () => {
    runSync();
    expect(store.loadIssueLedger().length).toBe(40);

    resetData();

    expect(store.syncHistory().length).toBe(0);
    expect(store.loadIssueLedger().length).toBe(0);
  });

  it("a sync after reset reproduces the very first dry run's census and deltas", () => {
    runSync();
    resetData();
    runSync();

    const census = ledgerCensus(store.loadIssueLedger());
    expect([census.open, census.disappeared, census.reopenedEver]).toEqual([
      FIRST_RUN_CENSUS.open, FIRST_RUN_CENSUS.disappeared, FIRST_RUN_CENSUS.reopenedEver,
    ]);
    expect(store.loadIssueLedger().length).toBe(40);
    expect(deltasOf(latestHistory())).toEqual(FIRST_RUN_DELTAS);
  });

  it("leaves the same sync-history row count as an unreset first run's", () => {
    runSync();
    const firstRunHistoryLen = store.syncHistory().length;
    expect(firstRunHistoryLen).toBe(sample.SEED_SYNC_COUNT + 1);

    resetData();
    runSync();

    // Not one more, not one fewer: the reset's whole job is to make the second run
    // indistinguishable from a first run into a store that never held anything.
    expect(store.syncHistory().length).toBe(firstRunHistoryLen);
    expect(syntheticHistory().length).toBe(sample.SEED_SYNC_COUNT);
  });

  it("stamps register_scope on every synthetic row again, none skipped", () => {
    runSync();
    resetData();
    runSync();

    const synthetic = syntheticHistory();
    expect(synthetic.length).toBe(sample.SEED_SYNC_COUNT);
    for (const row of synthetic) {
      expect([row["sync_id"], !!row["register_scope"], !!row["ledger_json"]])
        .toEqual([row["sync_id"], true, true]);
    }
    // And the six departures the fixture claims are dated, not counted as a scope skip.
    expect(deltasOf(latestHistory()).skippedNarrowedScope).toBe(0);
  });
});

describe("perturbation: the OLD resetData, reproduced inline, breaks the round trip", () => {
  /**
   * The defective rewrite this file's fix replaces: every tab EXCEPT the ledger — exactly
   * what shipped before F1. Reproduced here rather than imported, because the whole point is
   * to show the ACTUAL wrong numbers a reader would have measured against the real defect.
   */
  function oldResetData(): void {
    sheets.overwrite(sheets.TABS.assets, []);
    sheets.overwrite(sheets.TABS.edges, []);
    sheets.overwrite(sheets.TABS.issues, []);
    sheets.overwrite(sheets.TABS.findings, []);
    sheets.overwrite(sheets.TABS.dataFindings, []);
    sheets.overwrite(sheets.TABS.syncHistory, []);
    // `ai_issue_ledger` deliberately left untouched — that omission IS the defect.
  }

  it("reaches the exact reachable state F1 closes: empty history beside a real ledger", () => {
    runSync();
    oldResetData();

    expect(store.syncHistory().length).toBe(0);
    expect(store.loadIssueLedger().length).toBe(40);
  });

  it("seeds the trend with no ledger_json/issue_count/register_scope on any synthetic row", () => {
    runSync();
    oldResetData();
    runSync();

    // seedIssueLedger refused (ledger non-empty), so seedTrendHistory ran with `withLedger:
    // false` — every synthetic row's three ledger-derived columns stay null, the shape
    // `seedTrendHistory`'s own comment names as "the shape every one of these rows carried
    // before the ledger seed existed".
    const synthetic = syntheticHistory();
    expect(synthetic.length).toBe(sample.SEED_SYNC_COUNT);
    for (const row of synthetic) {
      expect([row["sync_id"], row["ledger_json"], row["issue_count"], row["register_scope"]])
        .toEqual([row["sync_id"], null, null, null]);
    }
  });

  it("makes the second dry run disagree with the first — the actual wrong numbers", () => {
    runSync();
    oldResetData();
    runSync();

    // The 32 live issues were already IN the surviving 40-row ledger from the first sync, so
    // the second dry run's own reconcile — against a register nothing scanned in between —
    // finds nothing new, nothing freshly gone and nothing reopened. It reads exactly like the
    // "must not re-seed" case in `seedLedger.test.ts` — a bare re-sync of an unmoved store —
    // even though a Reset sat between the two calls and the user asked for a clean slate.
    const census = ledgerCensus(store.loadIssueLedger());
    expect([census.open, census.disappeared, census.reopenedEver]).toEqual([32, 8, 1]);
    const deltas = deltasOf(latestHistory());
    expect(deltas).toEqual({
      new: 0, resolved: 0, reopened: 0, carried: 8, skippedNarrowedScope: 0,
    });
    // Named explicitly, not just left to the equality above: this is NOT the first run's own
    // numbers, which is exactly the discrepancy a reader comparing the two Reset buttons —
    // one that clears everything and one that quietly does not — would have measured.
    expect(deltas).not.toEqual(FIRST_RUN_DELTAS);
    expect(store.loadIssueLedger().length).toBe(40);
  });
});
