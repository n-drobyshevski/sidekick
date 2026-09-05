// Per-step page size, and the page cap becoming visible.
//
// PAGE_SIZE was one number for the whole battery, five times below Wiz's documented cursor
// maximum. Raising the DEFAULT would have been wrong twice over — `api.expandAsset` reads a
// page without passing `first`, and the two widest documents are the ones a gateway is most
// likely to time out on — so the size became a property of the step instead.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import {
  getTruncatedSteps,
  getSkipReasons,
  getStepRows,
  withSkippedSteps,
  withSkipReasons,
  withStepRows,
  withTruncatedSteps,
} from "../src/domain/settingsLogic";
import {
  PAGE_SIZE,
  PAGE_SIZE_TRAVERSAL,
  PAGE_SIZE_WIDE,
  MAX_PAGES,
} from "../src/server/wizQueriesAi";

interface Step {
  id: string;
  pageSize: number;
  document: string;
}

let steps: Step[];

// Booted ONCE, not per test. `getScanQueries` is a read-only derivation of the query
// battery — nothing below writes to the store or mutates `steps`, so a boot per test was
// re-deriving nineteen identical answers. It cost 1.9s of the suite's wall clock, which is
// what a beforeEach buys you when the thing it rebuilds cannot change.
beforeAll(async () => {
  const server = await bootServer();
  server.setup();
  // The battery itself; the Scans page endpoint no longer carries it (the sheet fetches it
  // per area), and what these specs are about is the battery, not the transport.
  steps = server.jobs.describeSyncSteps() as unknown as Step[];
});

afterAll(() => {
  teardownServer();
});

const byId = (id: string): Step => {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id} in [${steps.map((x) => x.id).join(", ")}]`);
  return s;
};

describe("per-step page size", () => {
  it("every step reports the `first` it will actually send", () => {
    // The panel names `first` as a transport variable; without this it could not say what
    // the value is, and the value is no longer one number.
    for (const s of steps) {
      expect([PAGE_SIZE, PAGE_SIZE_TRAVERSAL, PAGE_SIZE_WIDE]).toContain(s.pageSize);
    }
  });

  it("puts the narrow documents on the wide page — CONFIG_RULES above all", () => {
    // ~3,858 rules: 39 calls at 100, 8 at 500. The single largest walk in the battery, and
    // five flat scalars per node.
    expect(byId("CONFIG_RULES").pageSize).toBe(PAGE_SIZE_WIDE);
    for (const id of ["INVENTORY_AI", "AI_ASSET_PROPERTIES", "EFFECTIVE_ACCESS",
      "FRAMEWORKS_LIST", "AGENTIC_IDENTITIES"]) {
      expect(byId(id).pageSize).toBe(PAGE_SIZE_WIDE);
    }
    // FOUR PER-RULE ISSUES_<ruleId> STEPS USED TO BE PINNED HERE, all on the wide page.
    // They were deleted on 2026-08-23 and the claim went with them. They reconstructed an
    // issue row per ASSET from cloudResourcesV2, which can only ever add rows issuesV2 never
    // returned — and ai_issues is meant to be exactly what Wiz returned. They had also never
    // once run (three wrong field names), and repairing that exposed a second defect the
    // failure had hidden: no projectScope(), so they collected tenant-wide into a
    // project-scoped register. Inverted rather than deleted, so a re-introduction fails here.
    expect(steps.filter((s) => /^ISSUES_w[ct]-id-/.test(s.id))).toEqual([]);
  });

  it("generates no category step at the default scope — one category, one step", () => {
    // ISSUES_TOXIC keeps its id and the AI category, so a deployment that has never touched
    // the setting runs exactly the battery it ran before the setting existed.
    expect(steps.filter((s) => s.id.indexOf("ISSUES_CAT_") === 0)).toEqual([]);
    expect(byId("ISSUES_TOXIC").pageSize).toBe(PAGE_SIZE);
  });

  it("leaves the two widest documents on the small page", () => {
    // Q_CONFIG_FINDINGS carries unbounded `opaPolicy` Rego; Q_AI_EXPOSURE spreads three
    // ten-wide nested sub-connections per entity. These are the timeout candidates.
    expect(byId("CONFIG_FINDINGS").pageSize).toBe(PAGE_SIZE);
    expect(byId("HOST_EXPOSURE").pageSize).toBe(PAGE_SIZE);
    expect(byId("ENDPOINT_EXPOSURE").pageSize).toBe(PAGE_SIZE);
  });

  it("puts the graphSearch traversals in the middle, not on either extreme", () => {
    // A graphSearch row is a PATH: narrow field set, but two to four entities per row, each
    // with an unbounded `properties` bag. Not comparable to 500 flat resource rows — and at
    // a 13,842-asset landscape, not something to leave at 100 either.
    for (const id of ["GUARDRAIL_GAPS", "RUNS_AS", "SA_FINDINGS", "SENSITIVE_DATA_ACCESS",
      "IDENTITY_ACCESS"]) {
      expect(byId(id).pageSize).toBe(PAGE_SIZE_TRAVERSAL);
    }
    expect(PAGE_SIZE_TRAVERSAL).toBeGreaterThan(PAGE_SIZE);
    expect(PAGE_SIZE_TRAVERSAL).toBeLessThan(PAGE_SIZE_WIDE);
  });

  it("does not touch the interactive reader, which takes the default", () => {
    // api.expandAsset calls fetchGraphSearchPage with no `first`. That is the Connections
    // card, sliced to EXPAND_MAX_NODES=200 — five times the rows for a payload it discards.
    const src = readSource("src/server/api.ts");
    const call = src.slice(src.indexOf("fetchGraphSearchPage"), src.indexOf("decodeExpansion"));
    expect(call).not.toMatch(/first:/);
  });
});

describe("the page cap is recorded, not silent", () => {
  it("MAX_PAGES x the wide page clears the scales this app documents", () => {
    // It used to be 200 x 100 = 20,000 rows per step, dropped with a bare `break`.
    expect(MAX_PAGES * PAGE_SIZE_WIDE).toBeGreaterThanOrEqual(500_000);
  });

  it("keeps truncation in its own list, separate from the skips", () => {
    // Different meanings: a skip is the tenant refusing, a truncation is us stopping while
    // it was still answering. Folded together, a partial dataset reads as a rejection.
    const s = withTruncatedSteps(withSkippedSteps({}, ["CONFIG_FINDINGS"]), ["EFFECTIVE_ACCESS"]);
    expect(getTruncatedSteps(s)).toEqual(["EFFECTIVE_ACCESS"]);
    expect(s["last_skipped_steps"]).toEqual(["CONFIG_FINDINGS"]);
  });

  it("reads an absent or malformed list as empty rather than throwing", () => {
    expect(getTruncatedSteps({})).toEqual([]);
    expect(getTruncatedSteps({ last_truncated_steps: "EFFECTIVE_ACCESS" })).toEqual([]);
    expect(getTruncatedSteps({ last_truncated_steps: [null, "", "A"] })).toEqual(["A"]);
  });
});

describe("a step that ran and matched nothing is recorded too", () => {
  it("keeps the ZERO, which is the entire reason the map exists", () => {
    // The two lists above cover a refusal and a page cap. Neither can say "the tenant
    // accepted this query and it matched nothing", which is the state all six edge-producing
    // traversals were in on a tenant carrying 13,932 assets and no edges at all. A falsy-eliding
    // reader would collapse that back into the absence it has to be distinguished from.
    const s = withStepRows({}, { RUNS_AS: 0, INVENTORY_AI: 13932 });
    expect(getStepRows(s)).toEqual({ RUNS_AS: 0, INVENTORY_AI: 13932 });
    expect(Object.prototype.hasOwnProperty.call(getStepRows(s), "RUNS_AS")).toBe(true);
  });

  it("distinguishes ran-and-empty from never-recorded", () => {
    const rows = getStepRows(withStepRows({}, { RUNS_AS: 0 }));
    expect(rows["RUNS_AS"]).toBe(0);          // ran, matched nothing
    expect(rows["HOST_EXPOSURE"]).toBeUndefined(); // no claim either way
  });

  it("reads an absent or malformed map as empty rather than throwing", () => {
    expect(getStepRows({})).toEqual({});
    expect(getStepRows({ last_step_rows: "RUNS_AS" })).toEqual({});
    expect(getStepRows({ last_step_rows: ["RUNS_AS"] })).toEqual({});
    expect(getStepRows({ last_step_rows: { A: "12", B: "nope", "": 4 } })).toEqual({ A: 12 });
  });

  it("does not disturb the two lists it sits beside", () => {
    const s = withStepRows(withSkippedSteps({}, ["CONFIG_FINDINGS"]), { RUNS_AS: 0 });
    expect(s["last_skipped_steps"]).toEqual(["CONFIG_FINDINGS"]);
    expect(getStepRows(s)).toEqual({ RUNS_AS: 0 });
  });

  it("is surfaced by the endpoint the Scans page reads", async () => {
    const server = await bootServer();
    server.setup();
    const res = server.api.getScanQueries({}) as {
      ok: boolean;
      data?: { stepRows: Record<string, number> };
    };
    expect(res.ok).toBe(true);
    // An object, never undefined — the client renders a missing id as "not recorded", and a
    // missing FIELD would make every id read that way on a deployment that has synced.
    expect(res.data!.stepRows).toEqual({});
  });
});

describe("a skip keeps the tenant's own reason, not just the step id", () => {
  // `skippedSteps` says WHICH step was refused; only the message says WHAT the tenant objected
  // to, and it is the message that names the enum member the schema does not have. It was
  // written to a Cloud Logging line and discarded, so recovering it on a live tenant took a
  // code change and a re-sync — after the app had already been told.
  const MSG = "Wiz query failed (HTTP 400): Enum \"GraphRelationshipType\" cannot represent "
    + "value: \"RUNS_AS\"";

  it("round-trips a reason verbatim", () => {
    const s = withSkipReasons({}, { RUNS_AS: MSG });
    expect(getSkipReasons(s)["RUNS_AS"]).toBe(MSG);
  });

  it("distinguishes a skip with no recorded reason from one with an empty reason", () => {
    // An empty string is dropped rather than stored, so the reader has exactly two states:
    // a reason, or nothing. "Skipped, reason: (blank)" would read as the tenant declining to
    // explain itself, which is not what happened.
    const s = withSkipReasons({}, { RUNS_AS: MSG, SA_FINDINGS: "" });
    expect(getSkipReasons(s)["RUNS_AS"]).toBe(MSG);
    expect(getSkipReasons(s)["SA_FINDINGS"]).toBeUndefined();
  });

  it("reads an absent or malformed map as empty rather than throwing", () => {
    expect(getSkipReasons({})).toEqual({});
    expect(getSkipReasons({ last_skip_reasons: MSG })).toEqual({});
    expect(getSkipReasons({ last_skip_reasons: [MSG] })).toEqual({});
    expect(getSkipReasons({ last_skip_reasons: { A: 12, B: MSG } })).toEqual({ B: MSG });
  });

  it("does not disturb the lists it sits beside", () => {
    const s = withSkipReasons(
      withStepRows(withSkippedSteps({}, ["RUNS_AS"]), { HOST_EXPOSURE: 0 }),
      { RUNS_AS: MSG },
    );
    expect(s["last_skipped_steps"]).toEqual(["RUNS_AS"]);
    expect(getStepRows(s)).toEqual({ HOST_EXPOSURE: 0 });
    expect(getSkipReasons(s)).toEqual({ RUNS_AS: MSG });
  });

  it("is surfaced by the endpoint the Scans page reads", async () => {
    const server = await bootServer();
    server.setup();
    const res = server.api.getScanQueries({}) as {
      ok: boolean;
      data?: { skipReasons: Record<string, string> };
    };
    expect(res.ok).toBe(true);
    expect(res.data!.skipReasons).toEqual({});
  });

  it("is surfaced by the endpoint the Scans page reads", async () => {
    const server = await bootServer();
    server.setup();
    const res = server.api.getScanQueries({}) as {
      ok: boolean;
      data?: { truncatedSteps: string[] };
    };
    expect(res.ok).toBe(true);
    expect(res.data!.truncatedSteps).toEqual([]);
  });
});

function readSource(rel: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");
}

describe("the category family — one step per selected risk category", () => {
  // Its own boot: the battery is built from the stored settings, so this is the only way to
  // ask what a widened register would run. See registerScope.ts for why the list is a
  // Setting and not a per-step variable.
  it("adds a step per category beyond the default, each with a page size", async () => {
    const server = await bootServer();
    server.setup();
    server.api.setSettings({ issueCategories: ["wct-id-1998", "wct-id-3"] });
    const widened = server.jobs.describeSyncSteps() as unknown as Step[];

    const generated = widened.filter((s) => s.id.indexOf("ISSUES_CAT_") === 0);
    expect(generated.map((s) => s.id)).toEqual(["ISSUES_CAT_wct-id-3"]);
    // Same contract as every other step: it reports the `first` it will actually send.
    expect([PAGE_SIZE, PAGE_SIZE_TRAVERSAL, PAGE_SIZE_WIDE]).toContain(generated[0].pageSize);
    // The default category keeps its own step under its own id — nothing is renamed, so
    // stored overrides and the toxic area's assertions still find it.
    expect(widened.some((s) => s.id === "ISSUES_TOXIC")).toBe(true);
    expect(widened.some((s) => s.id === "ISSUES_CAT_wct-id-1998")).toBe(false);

    // The F4 guard above is about the DELETED per-rule reconstruction steps
    // (ISSUES_wc-id-2742), which synthesised issue rows from the inventory API. Widening the
    // category list must not resurrect that family — different prefix, different meaning.
    expect(widened.filter((s) => /^ISSUES_w[ct]-id-/.test(s.id))).toEqual([]);
    teardownServer();
  });
});
