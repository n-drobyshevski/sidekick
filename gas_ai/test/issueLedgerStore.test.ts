// The lifecycle ledger through the sheet — the tab that is never a snapshot.
//
// WHY WHOLE-ROW EQUALITY AND NOT A FIELD LIST (the same discipline as
// test/registerScopeStore.test.ts, and for the same reason). `writeGrid` projects a row onto
// the DECLARED headers and discards whatever it carries beyond them, so an undeclared column
// is written on every sync and read back as a default, forever, with nothing failing. On this
// tab that failure is worse than on the others: the discarded field would be a date nobody
// can recover, because the population it described is gone from `ai_issues` by then.
//
// The rest of the file is about the one property that separates this tab from every other
// data tab in the app — a row that leaves the register stays here, dated. Every other tab is
// rewritten from what the last sync saw.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import { TAB_HEADERS, TABS } from "../src/server/sheetsDb";
import { registerScopeSignature } from "../src/domain/registerScope";
import { ledgerCensus, type IssueLedgerRow } from "../src/domain/issueLedger";
import type { IssueRow, NormalizedVulnFinding } from "../src/domain/graphTypes";
import type { Rec } from "../src/domain/util";

type Store = typeof import("../src/server/syncStore");
type Sample = typeof import("../src/server/sampleData");
type Sheets = typeof import("../src/server/sheetsDb");

let store: Store;
let sample: Sample;
let sheets: Sheets;

beforeEach(async () => {
  const server = await bootServer();
  server.setup();
  // Imported after the boot: `bootServer` resets the module registry, so the store the server
  // writes through is only reachable from a fresh import.
  store = await import("../src/server/syncStore");
  sample = await import("../src/server/sampleData");
  sheets = await import("../src/server/sheetsDb");
  // Per test, because every case here asserts against a NAMED sync — a counter shared across
  // files' worth of cases would make "first_seen_sync" a moving target, and past the ninth
  // sync the date below stops parsing.
  syncSeq = 0;
});

afterAll(() => teardownServer());

let syncSeq = 0;

/** One persisted sync over the seed landscape, with whatever issue register is given. */
function persist(
  issues?: IssueRow[],
  extras: { vulnFindings?: NormalizedVulnFinding[] } = {},
): string {
  syncSeq += 1;
  const startedAt = `2026-09-${String(syncSeq).padStart(2, "0")}T00:00:00.000Z`;
  const syncId = `sync-led-${syncSeq}`;
  store.persistSync(
    sample.seedGraphDoc(startedAt),
    issues ?? sample.SEED_ISSUES,
    sample.SEED_AARS_HINTS,
    { syncId, mode: "dry-run", startedAt, apiCalls: 0 },
    // A distinct commit instant per sync, so `disappeared_at` can be told from `last_seen_at`.
    Date.parse(startedAt),
    sample.SEED_FINDINGS,
    [], [], [], [],
    extras,
  );
  return syncId;
}

function ledgerRows(): Rec[] {
  return sheets.readAll(sheets.TABS.issueLedger);
}

function latestHistory(): Rec {
  const history = store.syncHistory();
  return history[history.length - 1] as Rec;
}

function seedIssueId(): string {
  const id = sample.SEED_ISSUES[0]?.id;
  expect(id, "the seed landscape carries no issues").toBeTruthy();
  return String(id);
}

/** What sheetsDb.fromCell does to a written row: '' becomes null on the way back. */
function throughSheet(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = v === "" || v === null || v === undefined ? null : v;
  }
  return out;
}

function ledgerRow(over: Partial<IssueLedgerRow> = {}): IssueLedgerRow {
  return {
    issueId: "iss-1",
    firstSeenSync: "sync-1",
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastSeenSync: "sync-2",
    lastSeenAt: "2026-09-02T00:00:00.000Z",
    disappearedAt: null,
    resolutionSrc: null,
    lastStatus: "OPEN",
    categories: ["wct-id-1998", "wct-id-3"],
    ruleId: "wc-id-2742",
    createdAt: "2026-06-01T00:00:00.000Z",
    dueAt: "2026-07-01T00:00:00.000Z",
    registerScope: "wct-id-1998|wct-id-3",
    episode: 1,
    ...over,
  };
}

describe("the row survives the sheet", () => {
  it("declares every column the writer emits", () => {
    // The `writeGrid` trap, asserted directly.
    const headers = TAB_HEADERS[TABS.issueLedger]!;
    for (const key of Object.keys(store.issueLedgerToRow(ledgerRow()))) {
      expect([key, headers.indexOf(key) >= 0]).toEqual([key, true]);
    }
  });

  it("round-trips the WHOLE row, in both directions", () => {
    const source = ledgerRow({
      disappearedAt: "2026-09-03T00:00:00.000Z",
      resolutionSrc: "disappeared",
      aiAdjacency: "ADJACENT",
      exploitationTier: "kev",
      epssPeak: 0.62,
      episode: 2,
    });
    const written = store.issueLedgerToRow(source);
    expect(store.rowToIssueLedger(throughSheet(written))).toEqual(source);
    expect(store.issueLedgerToRow(store.rowToIssueLedger(throughSheet(written)))).toEqual(written);
  });

  it("keeps ABSENT and null apart on the exploitation pair", () => {
    // Three states on two columns, and the ledger has to hold all three: no fold ran
    // (absent), the fold ran and captured no probability (null), the fold ran and measured
    // one (a number). Collapsing the first two scores an unscanned register as an unexploited
    // one — see rank.exploitationOf.
    const noFold = store.rowToIssueLedger(throughSheet(store.issueLedgerToRow(ledgerRow())));
    expect("exploitationTier" in noFold).toBe(false);
    expect("epssPeak" in noFold).toBe(false);

    const noEpss = store.rowToIssueLedger(throughSheet(
      store.issueLedgerToRow(ledgerRow({ exploitationTier: "kev", epssPeak: null })),
    ));
    expect([noEpss.exploitationTier, noEpss.epssPeak]).toEqual(["kev", null]);

    // And a measured ZERO must survive as 0, not fall back to null: 0 is a computed EPSS.
    const zero = store.rowToIssueLedger(throughSheet(
      store.issueLedgerToRow(ledgerRow({ exploitationTier: "none", epssPeak: 0 })),
    ));
    expect(zero.epssPeak).toBe(0);
  });

  it("reads an unmeasured adjacency as absent, never as UNLINKED", () => {
    const back = store.rowToIssueLedger(throughSheet(store.issueLedgerToRow(ledgerRow())));
    expect("aiAdjacency" in back).toBe(false);
  });
});

describe("two syncs back to back", () => {
  it("keeps one row per issue and moves only the last sighting", () => {
    persist();
    const first = ledgerRows();
    expect(first.length).toBe(sample.SEED_ISSUES.length);
    expect(first.every((r) => r["first_seen_sync"] === r["last_seen_sync"])).toBe(true);

    persist();
    const second = ledgerRows();
    expect(second.length).toBe(first.length);
    for (const row of second) {
      expect([row["issue_id"], row["first_seen_sync"]]).toEqual([row["issue_id"], "sync-led-1"]);
      expect(row["last_seen_sync"]).toBe("sync-led-2");
      expect(row["first_seen_sync"]).not.toBe(row["last_seen_sync"]);
      // Still present, so nothing is dated and nothing claims a lifecycle event.
      expect([row["disappeared_at"], row["resolution_src"]])
        .toEqual([null, null]);
    }
  });

  it("records the deltas on the commit row, and the second sync moved nothing", () => {
    persist();
    expect(JSON.parse(String(latestHistory()["ledger_json"]))).toEqual({
      new: sample.SEED_ISSUES.length,
      resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0,
    });
    persist();
    // Transition counts, not a census: a row present on both syncs is counted by none of the
    // five, so an unchanged register reports five zeroes rather than repeating its size.
    expect(JSON.parse(String(latestHistory()["ledger_json"]))).toEqual({
      new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0,
    });
  });

  it("stamps the scope the sync APPLIED on every row it saw", async () => {
    persist();
    const settings = await import("../src/server/settingsStore");
    const scope = registerScopeSignature(settings.getIssueCategories());
    for (const row of ledgerRows()) expect(row["register_scope"]).toBe(scope);
    // The same signature the commit row records, because the guard on the NEXT sync compares
    // the two: a ledger stamped from settings and a history row stamped from the battery
    // would disagree the moment an operator edited the list mid-sync.
    expect(latestHistory()["register_scope"]).toBe(scope);
  });
});

describe("a row that leaves the register is dated, not erased", () => {
  it("holds the departure with its provenance, on the sync that first missed it", () => {
    // The whole reason the tab exists. `ai_issues` is filtered to OPEN/IN_PROGRESS, so a
    // remediated issue simply vanishes from it — and every other tab here is rewritten from
    // what the last sync saw.
    persist();
    const gone = seedIssueId();
    persist(sample.SEED_ISSUES.filter((i) => i.id !== gone));

    const rows = ledgerRows();
    expect(rows.length).toBe(sample.SEED_ISSUES.length);
    const row = rows.find((r) => r["issue_id"] === gone)!;
    expect(row, `${gone} was erased from the ledger`).toBeTruthy();
    // Dated at the sync that failed to see it — an upper bound whose error is the interval
    // between last_seen_at and here, which is why both dates stay on the row.
    expect(row["disappeared_at"]).toBe("2026-09-02T00:00:00Z");
    expect(row["last_seen_at"]).toBe("2026-09-01T00:00:00Z");
    // "disappeared", never "resolved": the provenance rides in the word, because the two
    // render at the same pixel width and this register never saw a Wiz resolvedAt.
    expect(row["resolution_src"]).toBe("disappeared");

    expect(JSON.parse(String(latestHistory()["ledger_json"]))).toMatchObject({
      new: 0, resolved: 1, skippedNarrowedScope: 0,
    });
  });

  it("reopens it on the sync that sees it again", () => {
    persist();
    const gone = seedIssueId();
    persist(sample.SEED_ISSUES.filter((i) => i.id !== gone));
    persist();

    const row = ledgerRows().find((r) => r["issue_id"] === gone)!;
    expect([row["disappeared_at"], row["resolution_src"], Number(row["episode"])])
      .toEqual([null, "reopened", 2]);
    expect(JSON.parse(String(latestHistory()["ledger_json"]))).toMatchObject({ reopened: 1 });
  });

  it("answers the census off the stored rows", () => {
    persist();
    const gone = seedIssueId();
    persist(sample.SEED_ISSUES.filter((i) => i.id !== gone));
    const census = ledgerCensus(store.loadIssueLedger());
    expect([census.open, census.disappeared]).toEqual([sample.SEED_ISSUES.length - 1, 1]);
    expect(census.byResolutionSrc.disappeared).toBe(1);
  });
});

describe("what a refused optional step does to the ledger", () => {
  it("leaves it standing, with the reading absent rather than downgraded", () => {
    // VULN_FINDINGS is optional and a refusal must not cost the register its clock. The
    // exploitation columns follow `ai_issues`: this sync's reading, not last sync's — the
    // ledger dates a sighting, it does not archive a measurement nobody took.
    persist(undefined, {
      vulnFindings: [{
        id: "vf-1", hasKev: true, hasExploit: true, epss: 0.62, issueIds: [seedIssueId()],
      }],
    });
    const stamped = ledgerRows().find((r) => r["issue_id"] === seedIssueId())!;
    expect([stamped["exploitation_tier"], Number(stamped["epss_peak"])]).toEqual(["kev", 0.62]);

    // The next sync's step was refused, so its issue rows carry no tier at all.
    persist();
    const rows = ledgerRows();
    expect(rows.length).toBe(sample.SEED_ISSUES.length);
    const after = rows.find((r) => r["issue_id"] === seedIssueId())!;
    // The row and its clock survive; only the reading is gone.
    expect(after["first_seen_sync"]).toBe("sync-led-1");
    expect(after["exploitation_tier"]).toBeNull();
    expect(after["epss_peak"]).toBeNull();
    expect(store.loadIssueLedger().find((l) => l.issueId === seedIssueId())!.exploitationTier)
      .toBeUndefined();
  });
});
