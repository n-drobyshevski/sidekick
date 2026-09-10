// THE DRY-RUN SEED'S LIFECYCLE LEDGER — a fabricated prior, and what the dry run measures
// against it.
//
// WHAT THIS FILE IS PROTECTING. Before the seed existed, a dry-run store held a ledger whose
// 32 rows were all born on the sync the reader was looking at, with ZERO dated departures,
// and eight synthetic `sync_history` rows carrying no `ledger_json`, no `issue_count` and no
// `register_scope`. Every lifecycle figure — open-backlog movement between two syncs, a
// survival curve over first-seen to disappeared — therefore had one comparable point and no
// events. That failure is silent: the pages render, the numbers are integers, and each one
// answers a question nobody asked.
//
// THE TWO FAILURE KINDS, and each `describe` names the one it holds.
//
//   A FAILURE OF PRESENCE is a row that should be in the register and is not — here, the
//   seeded prior never being written at all, or being written without the columns that make
//   it readable. It looks like an empty register: one point, no events, no history.
//
//   A FAILURE OF ABSENCE is a row that should be gone and persists, or is dated gone for the
//   WRONG REASON. Two of them live in this file, and they fail in opposite directions. A
//   second dry run that re-seeds would date 37 departures that never happened — a remediation
//   programme manufactured out of running the same sync twice. And a synthetic commit row
//   with no `register_scope` makes `reconcileIssueLedger` unable to prove the previous scan
//   looked, so six real departures go UNDATED and are counted as `skippedNarrowedScope`
//   instead. The first invents remediation; the second refuses to see it. Both are absence.
//
// THE PERTURBATION IS A CONTROL PAIR, not a single case. The stamped arm and the unstamped
// arm differ in exactly one cell, and the stamped arm is what makes the unstamped one
// evidence rather than a number nobody compared against anything.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import { ledgerCensus, type IssueLedgerDeltas } from "../src/domain/issueLedger";
import { registerScopeSignature } from "../src/domain/registerScope";
import { nowIso, type Rec } from "../src/domain/util";

type Server = typeof import("../src/server/index");
type Store = typeof import("../src/server/syncStore");
type Sample = typeof import("../src/server/sampleData");
type Sheets = typeof import("../src/server/sheetsDb");
type Settings = typeof import("../src/server/settingsStore");

let server: Server;
let store: Store;
let sample: Sample;
let sheets: Sheets;
let settings: Settings;

beforeEach(async () => {
  server = await bootServer();
  server.setup();
  // Imported after the boot: `bootServer` resets the module registry, so the modules the
  // server actually writes through are only reachable from a fresh import.
  store = await import("../src/server/syncStore");
  sample = await import("../src/server/sampleData");
  sheets = await import("../src/server/sheetsDb");
  settings = await import("../src/server/settingsStore");
});

afterAll(() => teardownServer());

/** The dry-run's own commit record — the last row of the history. */
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
  // Refuse absent BEFORE the parse: `JSON.parse(String(null))` throws, and a test that read
  // a missing column as `{}` would pass against a store that recorded nothing.
  expect(raw, "the commit row carries no ledger_json").toBeTruthy();
  return JSON.parse(String(raw)) as IssueLedgerDeltas;
}

function runSync(): void {
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  expect(res.ok, `sync failed: ${res.error}`).toBe(true);
}

function scopeNow(): string {
  return registerScopeSignature(settings.getIssueCategories());
}

/**
 * Write the fabricated prior BY HAND, so a case can vary one cell of it.
 *
 * `historyScope` null reproduces the defect the seed exists to avoid: eight synthetic commit
 * rows that describe a ledger and do not say which question they asked. The ledger ROWS are
 * stamped correctly in both arms — the variable under test is the commit record's stamp, and
 * varying two things at once would prove nothing about either.
 */
function seedByHand(historyScope: string | null): void {
  const endIso = nowIso();
  const rowScope = scopeNow();
  sheets.appendRows(sheets.TABS.issueLedger,
    sample.seedLedgerRows(endIso, rowScope).map(store.issueLedgerToRow));
  sheets.appendRows(sheets.TABS.syncHistory, sample.SEED_TREND.map((counts, i) => {
    const at = sample.seedSyncAt(endIso, i);
    const entry = sample.SEED_LEDGER.history[i]!;
    return {
      sync_id: sample.seedSyncId(i),
      started_at: at,
      finished_at: at,
      status: "SUCCESS",
      mode: "dry-run",
      node_count: null,
      edge_count: null,
      issue_count: entry.issueCount,
      api_calls: 0,
      snapshot_ref: null,
      error: null,
      aars_severity_json: JSON.stringify(counts),
      ledger_json: JSON.stringify(entry.deltas),
      register_scope: historyScope,
    };
  }));
}

/** What the dry run must report against the seeded prior. Named once; asserted in four places. */
const DRY_RUN_DELTAS: IssueLedgerDeltas = {
  new: 3, resolved: 6, reopened: 1, carried: 2, skippedNarrowedScope: 0,
};

// ---------------------------------------------------------------------------------------

describe("failure of presence: the prior the dry run reconciles against", () => {
  it("writes eight syncs of ledger rows before the dry run commits", () => {
    runSync();
    const census = ledgerCensus(store.loadIssueLedger());
    // 32 open is the register itself — the dry run's 32 issues, every one of them present.
    // 8 disappeared is the 6 dated on this sync plus the 2 that were already dated. 1 row has
    // been away and come back. Without the seed all three read 32 / 0 / 0.
    expect([census.open, census.disappeared, census.reopenedEver]).toEqual([32, 8, 1]);
    expect(store.loadIssueLedger().length).toBe(40);
    expect(census.open).toBe(sample.SEED_ISSUES.length);
  });

  it("records the five transitions on the dry run's own commit row", () => {
    runSync();
    expect(deltasOf(latestHistory())).toEqual(DRY_RUN_DELTAS);
  });

  it("dates the six departures and reopens the one that came back", () => {
    runSync();
    const rows = store.loadIssueLedger();
    const gone = rows.filter((r) => r.disappearedAt !== null).map((r) => r.issueId).sort();
    expect(gone).toEqual([
      "iss-gone-01", "iss-gone-02", "iss-gone-03", "iss-gone-04", "iss-gone-05", "iss-gone-06",
      "iss-gone-07", "iss-gone-08",
    ]);
    // "disappeared", never "resolved": the provenance rides in the word, because this register
    // never sees a Wiz resolvedAt at all.
    for (const row of rows.filter((r) => r.disappearedAt !== null)) {
      expect([row.issueId, row.resolutionSrc]).toEqual([row.issueId, "disappeared"]);
    }
    const reopened = rows.find((r) => r.issueId === "iss-005")!;
    expect([reopened.disappearedAt, reopened.resolutionSrc, reopened.episode])
      .toEqual([null, "reopened", 2]);
  });

  it("stamps every synthetic commit row with the scope the dry run applied", () => {
    runSync();
    const scope = scopeNow();
    const synthetic = syntheticHistory();
    expect(synthetic.length).toBe(sample.SEED_SYNC_COUNT);
    for (const row of synthetic) {
      // The load-bearing cell. Equal to the dry run's own, because the dry run's disappearance
      // pass compares the two and resolves nothing when they differ.
      expect([row["sync_id"], row["register_scope"]]).toEqual([row["sync_id"], scope]);
    }
    expect(latestHistory()["register_scope"]).toBe(scope);
  });

  it("gives every synthetic row the deltas and the open count the fixture declares", () => {
    runSync();
    const synthetic = syntheticHistory();
    synthetic.forEach((row, i) => {
      const entry = sample.SEED_LEDGER.history[i]!;
      expect([row["sync_id"], deltasOf(row)]).toEqual([row["sync_id"], entry.deltas]);
      expect([row["sync_id"], Number(row["issue_count"])])
        .toEqual([row["sync_id"], entry.issueCount]);
    });
    // Nine rows carrying deltas, not one: the eight fabricated syncs plus the dry run. That
    // count IS the capacity series — `capacityFromLedgerDeltas` skips a row without them.
    const withDeltas = store.syncHistory().filter((r) => r["ledger_json"] !== null);
    expect(withDeltas.length).toBe(sample.SEED_SYNC_COUNT + 1);
  });

  it("dates a seeded row's first sighting to the sync that claims to have made it", () => {
    runSync();
    const rows = store.loadIssueLedger();
    const byId: Record<string, string> = {};
    for (const row of rows) byId[row.issueId] = row.firstSeenSync;
    const history = store.syncHistory();
    for (const row of rows) {
      if (row.firstSeenSync.indexOf("sync-sample-") !== 0) continue;
      const commit = history.find((h) => h["sync_id"] === row.firstSeenSync);
      expect([row.issueId, commit ? commit["finished_at"] : null])
        .toEqual([row.issueId, row.firstSeenAt]);
    }
    // The three ids the seed deliberately withholds were born on the dry run itself, which is
    // what makes `new: 3` a measurement rather than a coincidence.
    const bornNow = rows.filter((r) => r.firstSeenSync.indexOf("sync-sample-") !== 0);
    expect(bornNow.map((r) => r.issueId).sort()).toEqual(["iss-030", "iss-031", "iss-032"]);
    expect(byId["iss-001"]).toBe("sync-sample-01");
  });
});

describe("failure of absence: a second sync must not re-seed, and must date nothing new", () => {
  it("carries the eight dated rows and resolves nothing", () => {
    runSync();
    runSync();
    // The census is unmoved. A re-seed would have appended 37 more rows; a re-run of the
    // disappearance pass over a re-seeded prior would have dated the whole register.
    const census = ledgerCensus(store.loadIssueLedger());
    expect([census.open, census.disappeared, census.reopenedEver]).toEqual([32, 8, 1]);
    expect(store.loadIssueLedger().length).toBe(40);
    // Transition counts, not a census: every one of the 32 was present on both syncs, so it is
    // counted by none of the five. `carried` is the 8 already dated and still absent — the one
    // number that is NOT zero, and 8 rather than 32 for exactly that reason.
    expect(deltasOf(latestHistory()))
      .toEqual({ new: 0, resolved: 0, reopened: 0, carried: 8, skippedNarrowedScope: 0 });
    // Eight fabricated rows, still eight, plus the two real ones.
    expect(syntheticHistory().length).toBe(sample.SEED_SYNC_COUNT);
    expect(store.syncHistory().length).toBe(sample.SEED_SYNC_COUNT + 2);
  });
});

describe("failure of absence: the scope stamp is what lets a departure be dated", () => {
  it("dates the six departures when the synthetic rows carry the scope", () => {
    // THE CONTROL ARM. Seeded by hand with the stamp present, so the perturbation below
    // differs from it in exactly one cell.
    seedByHand(scopeNow());
    runSync();
    expect(deltasOf(latestHistory())).toEqual(DRY_RUN_DELTAS);
  });

  it("refuses to date them, and counts the refusal, when the stamp is missing", () => {
    // THE PERTURBATION, reproducing the defective seed inline: eight commit rows describing a
    // ledger without saying which question they asked. `reconcileIssueLedger` reads a null
    // `prevScopeSignature` as UNKNOWN — never as "the same scope" — so it declines to read an
    // absence as a remediation and counts the refusal instead.
    //
    // The six that would have been dated are the entire difference. Everything else holds:
    // `new` and `reopened` do not depend on the previous scope, and `carried` is decided
    // before the scope is consulted at all.
    seedByHand(null);
    runSync();
    expect(deltasOf(latestHistory()))
      .toEqual({ new: 3, resolved: 0, reopened: 1, carried: 2, skippedNarrowedScope: 6 });
    // And the rows really are still open — the count above is not the only reading.
    const census = ledgerCensus(store.loadIssueLedger());
    expect([census.open, census.disappeared]).toEqual([38, 2]);
  });
});

// The fixture's own two halves, and the failure kind runs BOTH ways here. A sync claiming
// `new: 12` while eleven rows carry its birth index is a failure of PRESENCE — a row the
// history says exists and the ledger does not hold. A sync claiming `resolved: 1` with no row
// dated on it is a failure of ABSENCE — a remediation the fixture invented, which every
// figure downstream then publishes as a measurement. Neither is visible from a page: the
// numbers are integers either way.
describe("failure of presence and of absence: the eight synthetic syncs ship the rows they claim", () => {
  it("is sized to SEED_TREND, so the two halves of one synthetic sync cannot drift", () => {
    expect(sample.SEED_LEDGER.history.length).toBe(sample.SEED_SYNC_COUNT);
    expect(sample.SEED_TREND.length).toBe(sample.SEED_SYNC_COUNT);
  });

  it("replays open(i) = open(i-1) + new - resolved + reopened onto 34", () => {
    let open = 0;
    sample.SEED_LEDGER.history.forEach((entry, i) => {
      const d = entry.deltas;
      open = open + d.new - d.resolved + d.reopened;
      // Asserted per step, not only at the end: a table that lands on 34 by two errors
      // cancelling is exactly what a single final assertion would pass.
      expect([i, open]).toEqual([i, entry.issueCount]);
    });
    expect(open).toBe(34);
  });

  it("claims exactly the rows each sync created, dated and carried", () => {
    const rows = sample.SEED_LEDGER.rows;
    // Every row belongs to a sync in range, and a departure is strictly after the last
    // sighting it claims.
    for (const row of rows) {
      expect([row.issueId, row.firstSeenIndex >= 0, row.firstSeenIndex < sample.SEED_SYNC_COUNT])
        .toEqual([row.issueId, true, true]);
      if (row.disappearedIndex !== null) {
        expect([row.issueId, row.disappearedIndex]).toEqual([row.issueId, row.lastSeenIndex + 1]);
        expect([row.issueId, row.disappearedIndex > row.firstSeenIndex])
          .toEqual([row.issueId, true]);
      }
    }
    let standing = 0; // rows already dated and still absent, entering each sync
    sample.SEED_LEDGER.history.forEach((entry, i) => {
      const born = rows.filter((r) => r.firstSeenIndex === i).length;
      const dated = rows.filter((r) => r.disappearedIndex === i).length;
      expect([i, "new", entry.deltas.new]).toEqual([i, "new", born]);
      expect([i, "resolved", entry.deltas.resolved]).toEqual([i, "resolved", dated]);
      expect([i, "carried", entry.deltas.carried]).toEqual([i, "carried", standing]);
      // Nothing has come back yet — that is the dry run's job, and a fixture that used up the
      // reopen here would leave the register's one reopen unobservable.
      expect([i, "reopened", entry.deltas.reopened]).toEqual([i, "reopened", 0]);
      expect([i, "skipped", entry.deltas.skippedNarrowedScope]).toEqual([i, "skipped", 0]);
      standing += dated;
    });
    expect(rows.length).toBe(37);
    expect(standing).toBe(3);
  });

  it("withholds three live ids and seeds six that are not live at all", () => {
    const seeded: Record<string, true> = {};
    for (const row of sample.SEED_LEDGER.rows) seeded[row.issueId] = true;
    const live: Record<string, true> = {};
    for (const issue of sample.SEED_ISSUES) live[issue.id] = true;

    const withheld = sample.SEED_ISSUES.filter((i) => !seeded[i.id]).map((i) => i.id);
    expect(withheld).toEqual(["iss-030", "iss-031", "iss-032"]);

    // The rows the dry run cannot see. Six still open — those are the departures it dates —
    // and two already dated, which it carries. A row can only be dated by DISAPPEARANCE in
    // this register, so an id the current register still contains could never produce one.
    const notLive = sample.SEED_LEDGER.rows.filter((r) => !live[r.issueId]);
    expect(notLive.length).toBe(8);
    expect(notLive.filter((r) => r.disappearedIndex === null).length).toBe(6);
    expect(notLive.filter((r) => r.disappearedIndex !== null).length).toBe(2);

    // And exactly one dated row IS live, which is the reopen.
    const datedAndLive = sample.SEED_LEDGER.rows
      .filter((r) => r.disappearedIndex !== null && live[r.issueId]);
    expect(datedAndLive.map((r) => r.issueId)).toEqual(["iss-005"]);
  });

  it("dates a departed row a year after Wiz first raised it, so a curve cannot use createdAt", () => {
    // A survival curve must measure from the LEDGER's own first sighting. A fixture where
    // `createdAt` and `firstSeenAt` agreed could not tell a correct reading from one that
    // read the wrong field — this gap is what makes that perturbation visible downstream.
    const rows = sample.seedLedgerRows("2026-08-13T09:00:00Z", "wct-id-1998");
    const gone = rows.find((r) => r.issueId === "iss-gone-01")!;
    expect(gone.createdAt).toBeTruthy();
    const lead = Date.parse(gone.firstSeenAt) - Date.parse(String(gone.createdAt));
    expect(lead).toBe(365 * 86_400_000);
    // The exploitation trio stays ABSENT on a seeded row: no evidence pass ran over this
    // fabricated history, and "none" would turn "nobody looked" into a measurement.
    expect("exploitationTier" in gone).toBe(false);
    expect("epssPeak" in gone).toBe(false);
    expect("aiAdjacency" in gone).toBe(false);
  });
});
