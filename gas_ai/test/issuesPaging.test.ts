// The issue register behind a page gate.
//
// `getAssets` (`CLIENT_ALL_MAX`), `getConfigFindings` (`CONFIG_CLIENT_ALL_MAX`) and
// `getProblems` (`PROBLEMS_CLIENT_ALL_MAX`) all ship `{ all, rows, filtered, page,
// pageCount }` — whole under a ceiling, paged past it. `getIssues`, the toxic-combination
// page's per-pattern issue table, shipped `{ rows }` alone and unpaginated for every
// group, however large. This file protects the fourth endpoint's version of the same rule.
//
// TWO FAILURE KINDS live here, and each `describe` names the one it holds. A FAILURE OF
// PRESENCE would be a group's row silently missing from its own page (the group filter
// dropping something it should keep) — not exercised directly, because `getIssues`'s
// group filter is a single `===` and has no room to lose a row it should keep. A FAILURE
// OF ABSENCE is the one this file is built to catch: `filtered` reporting the wrong
// population, or a page holding rows that should have been filtered OUT before it was
// cut. The perturbation below reproduces exactly that — paging the whole register BEFORE
// the group filter runs, rather than after — and shows both symptoms at once: the wrong
// `filtered` count and a contaminated page.
//
// The seed landscape never puts 1,000+ issues in one toxic-combination pattern, so the
// over-cap branch is exercised by writing the fixture BY HAND straight to the issues tab —
// the same "seed it directly, skip the sync" shape `seedLedger.test.ts` uses for its own
// hand-built prior. `ISSUES_CLIENT_ALL_MAX` is imported rather than hand-typed, so the
// boundary this file tests against is the real one, not a stand-in for it.

import { beforeEach, describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";
import { ISSUES_CLIENT_ALL_MAX } from "../src/server/api";
import type { IssueRow } from "../src/domain/graphTypes";

type Server = Awaited<ReturnType<typeof bootServer>>;
type Rec = Record<string, unknown>;
type IssuesPayload = {
  all: boolean;
  rows: Rec[];
  filtered: number;
  page: number;
  pageCount: number;
};
type Result<T = Rec> = { ok: boolean; data?: T; error?: string };

let server: Server;
let store: typeof import("../src/server/syncStore");
let sheets: typeof import("../src/server/sheetsDb");

const GROUP_A = "synthetic-group-a";
const GROUP_B = "synthetic-group-b";

beforeEach(async () => {
  server = await bootServer();
  server.setup();
  store = await import("../src/server/syncStore");
  sheets = await import("../src/server/sheetsDb");
});

/** A minimal, valid IssueRow — every field `getIssues` reads or forwards is present. */
function makeIssue(group: string, n: number): IssueRow {
  return {
    id: `${group}-${n}`,
    ruleId: "synthetic-rule",
    ruleName: "Synthetic rule",
    comboGroup: group,
    nativeSeverity: "LOW",
    adjustedSeverity: "LOW",
    status: "OPEN",
    assetId: `${group}-asset-${n}`,
    assetName: `Synthetic asset ${n}`,
  };
}

function seed(counts: Record<string, number>): void {
  const rows: Rec[] = [];
  for (const [group, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) rows.push(store.issueToRow(makeIssue(group, i)));
  }
  sheets.appendRows(sheets.TABS.issues, rows);
}

function getIssues(params: unknown): IssuesPayload {
  const res = server.api.getIssues(params) as Result<IssuesPayload>;
  expect(res.ok, `getIssues failed: ${res.error}`).toBe(true);
  return res.data!;
}

describe("getIssues: under the cap, the whole group ships unpaginated (failure of presence guard)", () => {
  it("all:true with every row of the group, filtered equal to the group's count", () => {
    seed({ [GROUP_A]: 5, [GROUP_B]: 3 });

    const resp = getIssues({ group: GROUP_A });
    expect(resp.all).toBe(true);
    expect(resp.rows.length).toBe(5);
    expect(resp.filtered).toBe(5);
    expect(resp.rows.every((r) => r["comboGroup"] === GROUP_A)).toBe(true);
    // GROUP_B's rows never leak into GROUP_A's table.
    expect(resp.rows.some((r) => r["comboGroup"] === GROUP_B)).toBe(false);
  });

  it("no group: the whole register, matching getIssues({}).rows's existing contract", () => {
    seed({ [GROUP_A]: 5, [GROUP_B]: 3 });
    const resp = getIssues({});
    expect(resp.all).toBe(true);
    expect(resp.rows.length).toBe(8);
    expect(resp.filtered).toBe(8);
  });
});

describe("getIssues: past the cap, the server pages the GROUP, not the register", () => {
  const OVER = ISSUES_CLIENT_ALL_MAX + 5;

  it("all:false, filtered counts the GROUP; page clamps into [0, pageCount-1]", () => {
    seed({ [GROUP_A]: OVER, [GROUP_B]: 50 });

    const first = getIssues({ group: GROUP_A, page: 0, pageSize: 5 });
    expect(first.all).toBe(false);
    expect(first.rows.length).toBe(5);
    // The GROUP's own count...
    expect(first.filtered).toBe(OVER);
    // ...never the whole register's (OVER + 50).
    expect(first.filtered).not.toBe(OVER + 50);
    expect(first.rows.every((r) => r["comboGroup"] === GROUP_A)).toBe(true);
    expect(first.pageCount).toBe(Math.ceil(OVER / 5));

    // A page past the end clamps to the last page rather than answering empty.
    const overPage = getIssues({ group: GROUP_A, page: 100000, pageSize: 5 });
    expect(overPage.page).toBe(overPage.pageCount - 1);
    expect(overPage.rows.length).toBeGreaterThan(0);

    // A negative page clamps to 0, the same way.
    const underPage = getIssues({ group: GROUP_A, page: -3, pageSize: 5 });
    expect(underPage.page).toBe(0);
  });

  it(
    "PERTURBATION: paging the whole register BEFORE the group filter reports the " +
      "register's size and contaminates the page with another group's rows",
    () => {
      // GROUP_B written FIRST, so a page cut from the front of the UNFILTERED register
      // (the defective order) is guaranteed to include its rows rather than happening,
      // by luck of insertion order, to still read as pure GROUP_A.
      seed({ [GROUP_B]: 5, [GROUP_A]: OVER });

      // The real order, `getIssues`'s own: the group filter runs BEFORE the page is cut.
      const real = getIssues({ group: GROUP_A, page: 0, pageSize: 5 });
      expect(real.filtered).toBe(OVER);
      expect(real.rows.every((r) => r["comboGroup"] === GROUP_A)).toBe(true);

      // The defective rewrite this guards against, reproduced inline against the same
      // seed: page the register FIRST, filter the resulting page by group SECOND.
      const whole = store.loadIssues();
      const wrongFiltered = whole.length; // reports the REGISTER's size...
      const wrongPage = whole.slice(0, 5).filter((r) => r.comboGroup === GROUP_A);

      expect(wrongFiltered).toBe(OVER + 5);
      expect(wrongFiltered).not.toBe(real.filtered); // ...never the group's
      // Fewer than a full page of GROUP_A rows survive the wrong-order cut: the other
      // group's rows occupied slots in the page before they could be filtered out.
      expect(wrongPage.length).toBeLessThan(5);
    },
  );
});

describe("getIssues: bogus page params refuse to 0, never NaN", () => {
  it("page 'abc', a negative page, and an absent page all resolve to 0", () => {
    seed({ [GROUP_A]: 3 });

    const bogusString = getIssues({ group: GROUP_A, page: "abc" });
    expect(bogusString.page).toBe(0);
    expect(Number.isNaN(bogusString.page)).toBe(false);

    const negative = getIssues({ group: GROUP_A, page: -3 });
    expect(negative.page).toBe(0);

    const absent = getIssues({ group: GROUP_A });
    expect(absent.page).toBe(0);
  });

  it("a bogus pageSize never reaches pageOf as NaN (past the cap, where pageOf runs)", () => {
    seed({ [GROUP_A]: ISSUES_CLIENT_ALL_MAX + 5 });

    const resp = getIssues({ group: GROUP_A, page: 0, pageSize: "abc" });
    expect(resp.all).toBe(false);
    expect(Number.isFinite(resp.pageCount)).toBe(true);
    expect(resp.pageCount).toBeGreaterThan(0);
    expect(resp.rows.length).toBeGreaterThan(0);
  });
});
