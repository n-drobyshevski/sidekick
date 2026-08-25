// Rescoring under a project view writes narrow and enriches wide.
//
// The write is scoped on purpose, which leaves the register holding scores from two rules at
// once. That is a real cost, accepted deliberately, and the tests here are the mitigation:
// every claim the app makes about a score has to survive a mixed register, and the mixed
// state has to be visible rather than averaged away.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootSyncedServer, resetToSynced, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type Server = Awaited<ReturnType<typeof bootSyncedServer>>;
type SyncStore = typeof import("../src/server/syncStore");
let server: Server;
let syncStore: SyncStore;

const SMALL = "proj-project-delta";

function ok<T = Rec>(res: unknown): T {
  const r = res as { ok: boolean; error?: string; data?: T };
  expect(r.ok, r.error).toBe(true);
  return r.data as T;
}

const setView = (id: string) => ok(server.api.setSettings({ projectView: id }));

/**
 * Every asset with its score and the rule that produced it, register-wide.
 *
 * Read from the store rather than from `getAssets`: the register's payload carries no
 * score any more (the models reach only the workbench), and a rescore is a claim about
 * what is PERSISTED, which is what this file is about either way.
 */
function scores(): Map<string, { aars: number | null; version: number | null }> {
  setView("");
  return new Map(syncStore.loadAssets().map((a) => [
    a.id,
    { aars: a.aars ?? null, version: a.aarsRuleVersion ?? null },
  ]));
}

function spread(): Array<{ version: number | null; assets: number }> {
  return ok<Rec>(server.api.getAarsRule({}))["versionSpread"] as Array<
    { version: number | null; assets: number }
  >;
}

/**
 * Switch to a rule that genuinely scores differently.
 *
 * The app's own presets rather than a hand-perturbed copy: a preset is a whole alternative
 * point model, so it cannot accidentally be a band-only edit — and `setAarsRule` deliberately
 * carries the scored marker forward across those, which would make this test pass while
 * measuring nothing.
 */
function bumpRule(): void {
  const state = ok<Rec>(server.api.getAarsRule({}));
  const presets = state["presets"] as Rec;
  const current = JSON.stringify(state["rule"]);
  const next = Object.values(presets).find((r) => JSON.stringify(r) !== current);
  expect(next, "no preset differs from the current rule").toBeDefined();
  ok(server.api.setAarsRule({ rule: next }));
}

beforeAll(async () => {
  server = await bootSyncedServer();
});

// Every test bumps the AARS rule and rescores, which writes versions across the register.
beforeEach(async () => {
  server = await resetToSynced();
  syncStore = await import("../src/server/syncStore");
});

afterAll(() => {
  teardownServer();
});

describe("rescore under a project view", () => {
  it("stamps one rule version across the register after a sync", () => {
    // The baseline the mixed state is measured against, and the thing a sync restores.
    const s = spread();
    expect(s).toHaveLength(1);
    expect(s[0]!.version).not.toBeNull();
  });

  it("writes only the assets in view, and leaves the rest on their old rule", () => {
    const before = scores();
    setView(SMALL);
    bumpRule();
    const res = ok<Rec>(server.api.rescoreAars({}));
    expect(Number(res["assetCount"])).toBeGreaterThan(0);
    expect(Number(res["untouched"])).toBeGreaterThan(0);
    expect(res["scope"]).toBe(SMALL);

    // Two versions now coexist — the accepted cost, and it must be observable.
    const s = spread();
    expect(s.length).toBe(2);
    expect(s.reduce((n, e) => n + e.assets, 0)).toBe(before.size);
  });

  it("does not touch a single out-of-view score", () => {
    // The merge is the whole mechanism: `overwrite` replaces the tab wholesale, so a bug here
    // is not a wrong number on one row, it is every out-of-view asset silently rescored.
    setView("");
    const inView = new Set(
      (ok<Rec>(server.api.getAssets({ page: 1, pageSize: 500 }))["rows"] as Rec[])
        .filter((r) => JSON.stringify(r["projects"] ?? []).includes("PROJECT-DELTA"))
        .map((r) => String(r["id"])),
    );
    expect(inView.size).toBeGreaterThan(0);

    const before = scores();
    setView(SMALL);
    bumpRule();
    ok(server.api.rescoreAars({}));

    const after = scores();
    let moved = 0;
    for (const [id, b] of before) {
      const a = after.get(id);
      expect(a, `asset ${id} vanished`).toBeDefined();
      if (a!.aars !== b.aars) {
        moved += 1;
        expect(inView.has(id), `out-of-view asset ${id} was rescored`).toBe(true);
      }
    }
    expect(moved, "the rescore changed nothing at all").toBeGreaterThan(0);
  });

  it("keeps reporting stale while any asset is behind the current rule", () => {
    // The badge reads off ONE number, and a scoped rescore makes "the version just written"
    // the wrong one to report — it would say the register is current while most of it is not.
    setView(SMALL);
    bumpRule();
    ok(server.api.rescoreAars({}));
    const state = ok<Rec>(server.api.getAarsRule({}));
    expect(state["stale"], "a partly-rescored register reported itself current").toBe(true);
  });

  it("collapses back to one version on a rescore with no project selected", () => {
    setView(SMALL);
    bumpRule();
    ok(server.api.rescoreAars({}));
    expect(spread().length).toBe(2);

    setView("");
    ok(server.api.rescoreAars({}));
    const s = spread();
    expect(s).toHaveLength(1);
    expect(ok<Rec>(server.api.getAarsRule({}))["stale"]).toBe(false);
  });

  it("a sync heals a mixed register", () => {
    setView(SMALL);
    bumpRule();
    ok(server.api.rescoreAars({}));
    expect(spread().length).toBe(2);

    setView("");
    ok(server.api.runSync({}));
    expect(spread()).toHaveLength(1);
  });
});
