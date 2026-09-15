// THE POSTURE SERIES THE SYNTHETIC SYNCS CARRY — and the two ways this fixture can lie.
//
// WHAT THIS FILE IS PROTECTING. P2.1 gave the eight fabricated commit rows `issue_count`,
// `ledger_json` and `register_scope`, which is everything the LIFECYCLE figures need and
// nothing the POSTURE ones do. `adjacency_json` and `category_counts_json` stayed null on all
// eight, so both series had exactly one point — the dry run's own — and `postureTrendCard`'s
// `points.length >= 2` gate never fired. On the dry seed, the one dataset every dev harness
// and every test opens, "Where issues sit" and "Open issues by category" each rendered a
// heading, a sync note reading "One point per sync", and no canvas at all. Nothing failed:
// the page rendered, the copy was accurate, and two of the four cards in the section were
// permanently empty over a register the fixture had already described in full.
//
// THE TWO FAILURE KINDS, and each `describe` names the one it holds.
//
//   A FAILURE OF PRESENCE is a series that should be drawable and is not — the state above.
//   It looks like an unmeasured register: one point, no chart, an honest-sounding sentence.
//
//   A FAILURE OF ABSENCE is a figure that should be a GAP and is published as a number. Two
//   of them live here. Writing a zeroed exploitation census onto rows whose evidence pass
//   never ran turns "nobody looked" into "nothing is exploitable" — five flat lines at zero,
//   drawn with the same confidence as a measurement. And counting adjacency over every ledger
//   row rather than the rows OPEN at that sync republishes departed findings as live ones, so
//   the placements stop summing to the open count the row beside them declares.
//
// DERIVATION VERSUS READER. The arithmetic cases below recompute the expected cell in the
// TEST, off `SEED_LEDGER.rows` and `SEED_ISSUES`, and compare it against what the READER
// (`aarsTrend.ts` through `api.getAssets`) hands the page. Calling `seedPostureTrend` for the
// expectation would assert the fixture against itself and pass through any error in it.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import {
  countIssueCategories, exploitationTrendFromHistory, EXPLOITATION_KEYS,
} from "../src/domain/aarsTrend";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";
import type { Rec } from "../src/domain/util";
// The page's OWN reader, imported rather than restated: the perturbations below have to fail
// where `inventory.js`'s `postureTrendCard` reads, not where a paraphrase of it would.
// @ts-expect-error — client module is plain JS, no d.ts
import { EXPLOITATION_SERIES, presentSeries, valueAt } from "../src/client/js/postureTrendModel.js";

type Server = typeof import("../src/server/index");
type Store = typeof import("../src/server/syncStore");
type Sample = typeof import("../src/server/sampleData");
type Api = typeof import("../src/server/api");

let server: Server;
let store: Store;
let sample: Sample;
let api: Api;

beforeEach(async () => {
  server = await bootServer();
  server.setup();
  // Imported after the boot: `bootServer` resets the module registry, so the modules the
  // server actually writes through are only reachable from a fresh import.
  store = await import("../src/server/syncStore");
  sample = await import("../src/server/sampleData");
  api = await import("../src/server/api");
});

afterAll(() => teardownServer());

function runSync(): void {
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  expect(res.ok, `sync failed: ${res.error}`).toBe(true);
}

/** The dry-run's own commit record — the last row of the history. */
function latestHistory(): Rec {
  const rows = store.syncHistory();
  return rows[rows.length - 1] as Rec;
}

/** The eight fabricated commit records, in the order they were written. */
function syntheticHistory(): Rec[] {
  return store.syncHistory().filter((r) => String(r["sync_id"] ?? "").startsWith("sync-sample-"));
}

/** What `getAssets` hands the inventory page — the payload `postureTrendSection` reads. */
function postureTrend(): {
  adjacency: Array<{ at: string; counts: Record<string, number>;
    annotations?: Record<string, number | null> }>;
  exploitation: unknown[];
  categoryPoints: Array<{ at: string; counts: Record<string, number | null> }>;
  categories: Array<{ id: string; name: string }>;
} {
  const res = api.getAssets({}) as { ok: boolean; data?: Rec; error?: string };
  expect(res.ok, `getAssets failed: ${res.error}`).toBe(true);
  return (res.data as Rec)["postureTrend"] as ReturnType<typeof postureTrend>;
}

function parseCell(row: Rec, column: string): Record<string, number> {
  const raw = row[column];
  // Refuse absent BEFORE the parse: `JSON.parse(String(null))` throws, and a test that read a
  // missing column as `{}` would pass against a store that recorded nothing.
  expect(raw, `the commit row carries no ${column}`).toBeTruthy();
  return JSON.parse(String(raw)) as Record<string, number>;
}

/**
 * THE EXPECTATION, RECOMPUTED — the ledger rows open after synthetic sync `index`.
 *
 * Deliberately NOT `sample.seedLedgerOpenAt`: this is the claim the fixture makes, restated
 * from the two tables it is derived from, so a wrong `>=`/`>` in either place is a
 * disagreement rather than a shared assumption.
 */
function openIdsAt(index: number): string[] {
  return sample.SEED_LEDGER.rows
    .filter((spec) => spec.firstSeenIndex <= index
      && (spec.disappearedIndex === null || spec.disappearedIndex > index))
    .map((spec) => spec.issueId)
    .sort();
}

/** The categories those rows carry — `SEED_ISSUES`' own stamps, the risk category for a departed row. */
function categoriesOf(issueId: string): readonly string[] {
  const live = sample.SEED_ISSUES.find((i) => i.id === issueId);
  return live ? (live.categories ?? []) : [RISK_CATEGORY_ID];
}

// ---------------------------------------------------------------------------------------

describe("failure of presence: the posture series the trend cards read", () => {
  it("gives the adjacency and category series nine points, not one", () => {
    runSync();
    const trend = postureTrend();
    // Eight fabricated syncs plus the dry run's own. Before this fixture: 1 and 1, which is
    // below `postureTrendCard`'s draw gate and renders no canvas.
    expect(trend.adjacency.length).toBe(sample.SEED_SYNC_COUNT + 1);
    expect(trend.categoryPoints.length).toBe(sample.SEED_SYNC_COUNT + 1);
    expect(trend.adjacency.length).toBeGreaterThanOrEqual(2);
    expect(trend.categoryPoints.length).toBeGreaterThanOrEqual(2);
  });

  it("lands the last point of each series on the dry run's own census", () => {
    runSync();
    const trend = postureTrend();
    const row = latestHistory();

    const adjacency = parseCell(row, "adjacency_json");
    const last = trend.adjacency[trend.adjacency.length - 1]!;
    expect(last.at).toBe(String(row["finished_at"]));
    expect(last.counts).toEqual({
      DIRECT: adjacency["DIRECT"], ADJACENT: adjacency["ADJACENT"], UNLINKED: adjacency["UNLINKED"],
    });
    // The denominator rides beside the counts on every point, never only on the last — an
    // UNLINKED count without it is unreadable (`TrendPoint.annotations`).
    expect(last.annotations).toEqual({ edgesKnown: adjacency["edgesKnown"] });
    for (const point of trend.adjacency) {
      expect([point.at, point.annotations?.["edgesKnown"]])
        .toEqual([point.at, adjacency["edgesKnown"]]);
    }

    const lastCategory = trend.categoryPoints[trend.categoryPoints.length - 1]!;
    expect(lastCategory.counts).toEqual(parseCell(row, "category_counts_json"));
  });

  it("counts the newest synthetic row's categories over the rows the ledger says were open", () => {
    runSync();
    const newest = syntheticHistory()[sample.SEED_SYNC_COUNT - 1]!;
    expect(newest["sync_id"]).toBe(sample.seedSyncId(sample.SEED_SYNC_COUNT - 1));

    // DERIVATION: recomputed here from `SEED_LEDGER.rows` and `SEED_ISSUES`, through the same
    // counter `persistSync` writes the real cell with.
    const open = openIdsAt(sample.SEED_SYNC_COUNT - 1);
    const expected = countIssueCategories(open.map((id) => ({ categories: categoriesOf(id) })));

    // READER: what `aarsTrend` hands the page for that same sync.
    const point = postureTrend().categoryPoints
      .find((p) => p.at === String(newest["finished_at"]))!;
    expect(point, "the newest synthetic sync has no category point").toBeTruthy();
    expect(point.counts).toEqual(expected);
    // And the count is the open population itself, because every seeded row carries exactly
    // one category. 34 rows open after sync 8: 37 born, three departed.
    expect(expected).toEqual({ [RISK_CATEGORY_ID]: 34 });
    expect(open.length).toBe(34);
  });

  it("sums the three adjacency placements to the open count each row declares", () => {
    runSync();
    // THE INVARIANT THAT TIES THIS FIXTURE TO THE LEDGER'S OWN. Every issue in a sync's
    // register sits in exactly one of the three placements, so the census is a partition of
    // the population the row beside it counts. A series counted over a different population
    // draws a landscape the movement aside on Priorities denies, and nothing else notices.
    syntheticHistory().forEach((row, i) => {
      const cell = parseCell(row, "adjacency_json");
      const sum = cell["DIRECT"]! + cell["ADJACENT"]! + cell["UNLINKED"]!;
      const entry = sample.SEED_LEDGER.history[i]!;
      expect([row["sync_id"], sum]).toEqual([row["sync_id"], entry.issueCount]);
      expect([row["sync_id"], Number(row["issue_count"])])
        .toEqual([row["sync_id"], entry.issueCount]);
    });
    // The dry run's own row partitions its own register: `issue_count` there is
    // `issues.length`, and every one of those 32 rows was placed.
    const live = parseCell(latestHistory(), "adjacency_json");
    expect(live["DIRECT"]! + live["ADJACENT"]! + live["UNLINKED"]!)
      .toBe(Number(latestHistory()["issue_count"]));
  });

  it("moves the adjacency series with the ledger's own departures and its one reopen", () => {
    runSync();
    const counts = postureTrend().adjacency.map((p) => p.counts);
    // The story the ledger tells, read off the chart: UNLINKED is the `iss-gone-NN` cohort
    // (no asset, so the fold places them UNLINKED) rising as they arrive and collapsing to
    // zero when the dry run stops seeing the last six; ADJACENT dips at sync 7 where
    // `iss-005` disappears and recovers on the dry run, which is the register's one reopen.
    expect(counts.map((c) => c["UNLINKED"])).toEqual([2, 3, 3, 4, 4, 5, 6, 6, 0]);
    expect(counts.map((c) => c["ADJACENT"])).toEqual([8, 8, 8, 8, 8, 8, 7, 7, 8]);
    expect(counts.map((c) => c["DIRECT"])).toEqual([2, 7, 11, 14, 16, 18, 19, 21, 24]);
  });

  it("re-seeds nothing on a second dry run, so the series stays nine points long", () => {
    runSync();
    const first = postureTrend().adjacency.length;
    runSync();
    // The seed guards on an empty history, so the second sync appends only its own row.
    expect(postureTrend().adjacency.length).toBe(first + 1);
    expect(syntheticHistory().length).toBe(sample.SEED_SYNC_COUNT);
  });
});

describe("failure of absence: a gap published as a zero", () => {
  it("leaves the exploitation census null on every row, synthetic and live alike", () => {
    runSync();
    // NOT AN OMISSION IN THE FIXTURE. `dryRunSync` passes no `vulnFindings`, so `persistSync`
    // writes null on the dry run's OWN row; no evidence pass ran over the fabricated history
    // either. The card is right to say "No sync has recorded this yet." — and the day a dry
    // run does carry findings, this case fails and asks for the seeded series to follow.
    for (const row of store.syncHistory()) {
      expect([row["sync_id"], row["exploitation_json"]]).toEqual([row["sync_id"], null]);
      expect([row["sync_id"], row["kev_linked_count"]]).toEqual([row["sync_id"], null]);
    }
    expect(postureTrend().exploitation.length).toBe(0);
  });

  it(
    "PERTURBATION: a zeroed exploitation census instead of null makes the card read 0 "
      + "where it must read a gap",
    () => {
      runSync();
      const rows = store.syncHistory() as Rec[];

      // THE SHIPPED ARM. Null parses to no point at all, so `postureTrendCard` falls to
      // "No sync has recorded this yet." — the register's one true statement about this axis.
      const honest = exploitationTrendFromHistory(rows);
      expect(honest.length).toBe(0);
      expect(presentSeries(honest, EXPLOITATION_SERIES)).toEqual([]);

      // THE DEFECTIVE ARM, reproduced inline rather than described: the same rows with a
      // zeroed census written where no pass ran. This is the tempting "fill in the column"
      // fix, and it is the one that must not ship.
      const zeroed = Object.fromEntries(EXPLOITATION_KEYS.map((k) => [k, 0]));
      const perturbed = rows.map((r) => ({ ...r, exploitation_json: JSON.stringify(zeroed) }));
      const points = exploitationTrendFromHistory(perturbed);
      expect(points.length).toBe(rows.length);
      // Every one of the five tiers now reads as MEASURED at zero: `presentSeries` keeps a
      // series whose value is 0 and drops only one that is null, so the card draws five flat
      // lines and a nine-row table of zeros over a register nobody asked the question of.
      expect(presentSeries(points, EXPLOITATION_SERIES).map((s: { key: string }) => s.key))
        .toEqual([...EXPLOITATION_KEYS]);
      expect(valueAt(points[points.length - 1], "kev")).toBe(0);
      expect(valueAt(honest[honest.length - 1], "kev")).toBe(null);
      // `{}` is the same defect spelled shorter, and it is WORSE on this spec: the tier keys
      // are dense, so an omitted key coerces to 0 rather than to null.
      const empty = exploitationTrendFromHistory(rows.map((r) => ({ ...r, exploitation_json: "{}" })));
      expect(empty.length).toBe(rows.length);
      expect(valueAt(empty[empty.length - 1], "none")).toBe(0);
    },
  );

  it(
    "PERTURBATION: adjacency counted over every ledger row, not the rows open at that sync, "
      + "republishes departed findings as live ones",
    () => {
      runSync();
      // The derivation under test is the open-population filter — `firstSeenIndex <= i` AND
      // not yet disappeared. Dropping the second half is the plausible simplification (a
      // ledger row is "in the ledger", after all), and it is invisible on the chart: the
      // lines still rise, the legend is unchanged, the table is full of integers.
      const naive = sample.SEED_LEDGER.rows
        .filter((spec) => spec.firstSeenIndex <= sample.SEED_SYNC_COUNT - 1).length;
      const open = openIdsAt(sample.SEED_SYNC_COUNT - 1).length;
      // 37 born against 34 open: the three rows that had already departed by sync 8.
      expect([naive, open]).toEqual([37, 34]);
      // What makes it visible is the invariant the shipped case above asserts: the naive
      // count no longer sums to the `issue_count` the same row declares.
      const declared = sample.SEED_LEDGER.history[sample.SEED_SYNC_COUNT - 1]!.issueCount;
      expect(open).toBe(declared);
      expect(naive).not.toBe(declared);
    },
  );
});
