// Locks the invariant the detail-sheet seeding plan depends on: the row a list endpoint
// hands the client and the row the matching detail endpoint hands the client, for the same
// id, are the SAME OBJECT SHAPE — not "close enough".
//
// WHY THIS TEST EXISTS. The issue detail sheet is about to start rendering straight from
// the row a caller already holds (a combo table's `issue`, an asset sheet's `getIssues`
// row) instead of firing `getIssueDetail` and waiting on the round trip. That seed path is
// only honest if `getIssueDetail(id).issue` really is `getIssues({}).rows` filtered to that
// id — today it is, because both read off `syncStore.loadIssues()` with no per-endpoint
// projection in between. But nothing enforces that they stay that way. If a future change
// added a field to one projection and not the other — trimmed the list row for payload
// size, say, or enriched the detail row with something the list doesn't carry — every other
// test in this repo would keep passing: `apiGolden.test.ts` snapshots each endpoint's shape
// in isolation and would happily record the new asymmetry as the new normal. The seeded
// sheet would silently start showing a thinner record than the "authoritative" fetch would
// have, with nothing red anywhere. This test is the only thing that would catch that: it
// compares the two endpoints against EACH OTHER, for several ids, not just against their
// own snapshots.
//
// Same reasoning for `getAssetDetail(id).issues` against `getIssues({}).rows` filtered to
// that assetId — the asset sheet's Issues pane is a candidate for the same seeding treatment
// and depends on the identical parity.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;
type Result = { ok: boolean; data?: unknown; error?: string };

let server: Server;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as Result;
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
});

// A handful of ids spanning: an asset with several issues (agent-h-chatbot, the same
// max-degree node the golden suite seeds), an asset seen earlier in sync order
// (role-finance-admin-01, exactly one issue), and two assets from the middle of the
// register with different issue counts (agent-autogen: four, agent-i: four). Several ids,
// per the plan, not one — a parity break in a projection could easily affect only some
// fields on some rows.
const ISSUE_IDS = ["iss-001", "iss-011", "iss-021", "iss-026", "iss-032"];
const ASSET_IDS = ["role-finance-admin-01", "agent-autogen", "agent-i", "agent-h-chatbot"];

// Fetched fresh inside each `it` rather than hoisted into the `describe` body: `describe`
// callbacks run at collection time, before `beforeAll` has booted the server.
function issueListRows(): Array<{ id: string; assetId: string }> {
  return (
    (server.api.getIssues({}) as Result).data as { rows: Array<{ id: string; assetId: string }> }
  ).rows;
}

describe("seed parity: issue detail vs the issues list", () => {
  for (const id of ISSUE_IDS) {
    it(`getIssueDetail(${id}).issue deep-equals its row in getIssues({}).rows`, () => {
      const detail = (server.api.getIssueDetail({ id }) as Result).data as {
        issue: unknown;
      } | null;
      expect(detail, `getIssueDetail(${id}) should not be null`).not.toBeNull();

      const listRow = issueListRows().find((r) => r.id === id);
      expect(listRow, `${id} should be present in getIssues({}).rows`).toBeTruthy();

      expect(detail!.issue).toEqual(listRow);
    });
  }
});

describe("seed parity: asset detail's issues vs the issues list filtered by asset", () => {
  for (const assetId of ASSET_IDS) {
    it(`getAssetDetail(${assetId}).issues deep-equals getIssues({}).rows filtered to that asset, in order`, () => {
      const detail = (server.api.getAssetDetail({ id: assetId }) as Result).data as {
        issues: Array<{ id: string; assetId: string }>;
      } | null;
      expect(detail, `getAssetDetail(${assetId}) should not be null`).not.toBeNull();

      // openIssues() (src/server/api.ts:116-118) is `loadIssues().filter(isUnresolvedIssue)`
      // — a filter, so it preserves loadIssues()'s order. getIssues({}) with no group applies
      // no filter at all, so it is loadIssues() verbatim. In THIS sample landscape every issue
      // is OPEN or IN_PROGRESS (getIssues({}).total is 32, the whole ai_issues tab — see
      // apiGolden's snapshot), so the unresolved filter drops nothing and the two lists are
      // over the same order. Filtering both by assetId preserves that shared order, so a
      // plain array `toEqual` is a same-order comparison, not just a same-membership one.
      const wantRows = issueListRows().filter((r) => r.assetId === assetId);
      expect(detail!.issues).toEqual(wantRows);
    });
  }
});
