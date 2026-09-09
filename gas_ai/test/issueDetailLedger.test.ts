// `getIssueDetail` against the seeded lifecycle ledger — the join, and the surface a
// departed issue finally has.
//
// WHAT WAS WRONG. `ai_issues` is overwritten on every sync and its query is gated to
// `status: [OPEN, IN_PROGRESS]`, so an issue the ledger has dated by disappearance is not in
// that tab. `getIssueDetail` read only that tab, so it answered `null` for such an id — the
// same answer it gives for an id that never existed — and the sheet said "Issue not found."
// on the one register whose ledger knows precisely when the row left. That is a FAILURE OF
// PRESENCE: a record the register holds, missing from the only surface that could show it.
//
// The fixture is P2.1's. `iss-gone-01..06` are open in the seeded ledger and absent from
// `SEED_ISSUES`, so the dry run dates their departure; `iss-005` disappeared at synthetic
// sync 7 and IS live, so the dry run reopens it and it is the register's one `episode: 2`.
// Both cases are read here against the real store rather than a hand-built row, because the
// question this file asks is whether the endpoint and the fixture agree.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;
type Result = { ok: boolean; data?: unknown; error?: string };

interface PublicLedger {
  firstSeenAt: string;
  firstSeenSync: string;
  lastSeenAt: string;
  lastSeenSync: string;
  disappearedAt: string | null;
  resolutionSrc: string | null;
  episode: number;
  registerScope: string;
}

interface Detail {
  issue: Record<string, unknown> | null;
  group: unknown;
  ledger: PublicLedger | null;
}

let server: Server;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as Result;
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
});

function detail(id: string): Detail | null {
  const res = server.api.getIssueDetail({ id }) as Result;
  expect(res.ok, `getIssueDetail(${id}) should not error: ${res.error}`).toBe(true);
  return res.data as Detail | null;
}

/** The eight fields the projection ships, and the ones it deliberately does not. */
const PROJECTION_KEYS = [
  "disappearedAt", "episode", "firstSeenAt", "firstSeenSync",
  "lastSeenAt", "lastSeenSync", "registerScope", "resolutionSrc",
];

describe("the ledger joins the issue detail", () => {
  it("a live issue carries its own ledger row beside the issue", () => {
    const d = detail("iss-026")!;
    expect(d.issue, "iss-026 is in SEED_ISSUES").not.toBeNull();
    expect(d.ledger, "and in the seeded ledger").not.toBeNull();
    expect(Object.keys(d.ledger!).sort()).toEqual(PROJECTION_KEYS);
  });

  it("the projection carries no field that is not the ledger's own observation", () => {
    // `createdAt` is the one that matters: on a departed row the seed sets Wiz's created
    // date 365 days before this register's first sighting, precisely so a client reaching
    // for the wrong date prints a year that nobody measured. It is not on the payload at
    // all, so it cannot be reached for.
    const d = detail("iss-026")!;
    for (const forbidden of ["createdAt", "dueAt", "ruleId", "categories", "lastStatus"]) {
      expect(Object.prototype.hasOwnProperty.call(d.ledger!, forbidden), forbidden).toBe(false);
    }
  });

  it("the reopened issue reads episode 2 and is not dated gone", () => {
    const d = detail("iss-005")!;
    expect(d.issue, "iss-005 is live in the register").not.toBeNull();
    expect(d.ledger!.episode).toBe(2);
    expect(typeof d.ledger!.episode, "a number, not a stringified one").toBe("number");
    expect(d.ledger!.resolutionSrc).toBe("reopened");
    expect(d.ledger!.resolutionSrc).not.toBe("disappeared");
    expect(d.ledger!.disappearedAt, "cleared on the reopen").toBeNull();
  });

  it("the join does not disturb `issue` — the seeded sheet still round-trips", () => {
    // The same claim `seedParity.test.ts` pins, restated where the join was added: a field
    // folded INTO `issue` would break the zero-RPC seeded door quietly, as a repaint on
    // every open rather than as an error.
    const rows = ((server.api.getIssues({}) as Result).data as {
      rows: Array<{ id: string }>;
    }).rows;
    const row = rows.filter((r) => r.id === "iss-026")[0];
    expect(detail("iss-026")!.issue).toEqual(row);
  });
});

describe("failure of presence: a departed issue has a surface", () => {
  it("iss-gone-01 answers with a ledger row and a null issue, not null", () => {
    const d = detail("iss-gone-01");
    expect(d, "the endpoint used to answer null here").not.toBeNull();
    expect(d!.issue).toBeNull();
    expect(d!.group).toBeNull();
    expect(d!.ledger).not.toBeNull();
    expect(d!.ledger!.resolutionSrc).toBe("disappeared");
    expect(d!.ledger!.disappearedAt, "the sync that first missed it").toBeTruthy();
  });

  it("the departure date is LATER than the last sighting — the gap is the error bar", () => {
    const l = detail("iss-gone-01")!.ledger!;
    expect(Date.parse(l.disappearedAt!)).toBeGreaterThan(Date.parse(l.lastSeenAt));
    expect(Date.parse(l.lastSeenAt)).toBeGreaterThanOrEqual(Date.parse(l.firstSeenAt));
  });

  it("all six departures the dry run dated are reachable, not just the first", () => {
    for (const n of ["01", "02", "03", "04", "05", "06"]) {
      const d = detail("iss-gone-" + n);
      expect(d, "iss-gone-" + n).not.toBeNull();
      expect(d!.issue, "iss-gone-" + n + " is not in ai_issues").toBeNull();
      expect(d!.ledger!.resolutionSrc, "iss-gone-" + n).toBe("disappeared");
    }
  });

  it("the two CARRIED rows are reachable too — they left before the dry run", () => {
    for (const n of ["07", "08"]) {
      const d = detail("iss-gone-" + n)!;
      expect(d.issue).toBeNull();
      expect(d.ledger!.resolutionSrc).toBe("disappeared");
    }
  });

  it("an id neither tab has ever held still answers null", () => {
    // The refusal has to stay narrow. `null` now means one thing only: nothing here has
    // ever heard of this id. Widening it to "some empty record" would put a sheet full of
    // dashes in front of a typo.
    expect(detail("no-such-id")).toBeNull();
    expect(detail("")).toBeNull();
  });
});
