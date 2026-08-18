// The regression net for the server.
//
// api.ts (821 lines), syncJobs.ts (503) and wizClientAi.ts (337) had no test coverage at
// all, and they carry the densest duplication in the codebase. This runs the whole thing —
// setup, a full dry-run sync, then every read endpoint — against the dev GAS fakes and
// snapshots the result.
//
// What it is for: any refactor of the server should leave these snapshots byte-identical.
// A snapshot diff is either a bug you just introduced or a behaviour change you meant to
// make; there is no third case, which is what makes it useful. Update the snapshots only
// with a commit that says why.
//
// WHAT IT DOES NOT COVER. Its reach is exactly what the sample landscape exercises, which was
// measured by mutation rather than assumed. Renaming a node the landscape contains fails it
// immediately; three other mutations passed, and checking each one showed why:
//
//   - `DUE_SOON_DAYS` 7 -> 5           no sample issue falls due in that window
//   - `SEV_RANK` + a constant offset   a uniform shift does not reorder anything
//   - a field added to api.ts's error path   no handler errors during a dry run
//
// The first is a real gap in the landscape, the other two are inert mutations. The important
// consequence: `sampleData.ts` sets both internet flags to `false` unless a seed overrides
// them, and no seed sets `openInternet` without `internet`, so the graph/combos exposure
// divergence CANNOT show up here. Defects get their own targeted tests with hand-built
// fixtures; this file is the refactor net, not the correctness net.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootServer, normalize, READ_APIS, teardownServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;

/** One booted server carrying one dry-run sync, shared by the read-endpoint cases. */
let server: Server;
let syncResult: unknown;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; data?: unknown; error?: string };
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
  syncResult = res.data;
});

afterEach(() => {
  // Only the clock is global; the fakes die with the module registry.
});

describe("dry-run sync", () => {
  it("produces the sample landscape", () => {
    expect(normalize(syncResult)).toMatchSnapshot();
  });

  it("is deterministic — two syncs from a clean store agree", async () => {
    const first = server.api.getGraph({}) as { data: unknown };
    // Phase 4: the graph carries no issue/finding rows (an ISSUE node has no
    // `problemOutcome`), so the problem-verdict determinism check needs its own two
    // endpoints — getGraph agreeing says nothing about whether two independent syncs
    // decided the same ACT/ATTEND/TRACK_STAR/TRACK for the same issue or finding.
    const firstIssues = server.api.getIssues({}) as { data: unknown };
    const firstConfig = server.api.getConfigFindings({}) as { data: unknown };

    const second = await bootServer();
    second.setup();
    const res = second.api.runSync({}) as { ok: boolean };
    expect(res.ok).toBe(true);

    // The graph is the widest surface the sync produces: nodes, edges, layout and the
    // derived risk topology all at once. If two runs agree here they agree everywhere.
    expect(normalize((second.api.getGraph({}) as { data: unknown }).data))
      .toEqual(normalize(first.data));
    // Two syncs from a clean store must decide identical problem verdicts — same outcome,
    // same vector, same unknowns — for every issue and every config finding.
    expect(normalize((second.api.getIssues({}) as { data: unknown }).data))
      .toEqual(normalize(firstIssues.data));
    expect(normalize((second.api.getConfigFindings({}) as { data: unknown }).data))
      .toEqual(normalize(firstConfig.data));

    teardownServer();
    // Restore the shared instance the remaining cases read from.
    server = await bootServer();
    server.setup();
    server.api.runSync({});
  });
});

describe("read endpoints", () => {
  for (const [name, params, label] of READ_APIS) {
    it(`${label ?? name} answers the same shape`, () => {
      const fn = (server.api as unknown as Record<string, (p: unknown) => unknown>)[name];
      expect(fn, `api.${name} is missing`).toBeTypeOf("function");
      const res = fn(params) as { ok: boolean; error?: string };
      expect(res.ok, `api.${name} failed: ${res.error}`).toBe(true);
      expect(normalize(res)).toMatchSnapshot();
    });
  }
});

describe("the persisted ledger", () => {
  it("writes the tabs the schema declares", async () => {
    const { TABS, readAll, dataRowCount } = await import("../src/server/sheetsDb");
    const counts: Record<string, number> = {};
    for (const tab of Object.values(TABS)) counts[tab] = dataRowCount(tab);
    expect(counts).toMatchSnapshot();

    // One row per tab, so a change to any row<->object mapper shows up here. The stores
    // are where the cell-coercion idioms live, and they are about to be refactored.
    const firstRows: Record<string, unknown> = {};
    for (const tab of Object.values(TABS)) firstRows[tab] = readAll(tab)[0] ?? null;
    expect(normalize(firstRows)).toMatchSnapshot();
  });
});

describe("empty-state contracts", () => {
  it("each endpoint's answer before any sync is recorded", async () => {
    const fresh = await bootServer();
    fresh.setup();
    const before: Record<string, unknown> = {};
    for (const [name] of READ_APIS) {
      const fn = (fresh.api as unknown as Record<string, (p: unknown) => unknown>)[name];
      before[name] = normalize(fn({}));
    }
    // These four shapes ({empty:true} / null / [] / a zeroed record) are a client-visible
    // wire contract that four handlers answer differently. Pinning them here is what makes
    // it safe to name the dialects without changing them.
    expect(before).toMatchSnapshot();
  });
});
