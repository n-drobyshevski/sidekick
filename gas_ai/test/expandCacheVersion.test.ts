// What invalidates a cached Wiz expansion, and what must not.
//
// `expandAsset` is the only endpoint that spends a UrlFetchApp call on a user's click, and
// its answer used to share the read-model key space. That space is versioned by
// DATA_VERSION, which `settingsStore.saveSettings` bumps — so saving an AARS rule, a depth
// default, a node budget or a scan-var override discarded every cached expansion in the
// tenant, and the next click on each agent paid Wiz again. A graph response from Wiz does
// not go stale because a local band threshold moved.
//
// The invalidation contract is tested here rather than through expandAsset's own cache
// because the dev shims throw on UrlFetchApp.fetch: without credentials the endpoint
// answers `stored` and never reaches the cache at all.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootSyncedServer, resetToSynced, teardownServer } from "./gasEnv";
// cacheKey is pure, so it does not matter that bootServer resets the module registry
// underneath it — this instance and the server's compute the same string.
import { cacheKey } from "../src/server/serverCache";

type Server = Awaited<ReturnType<typeof bootSyncedServer>>;
type Result = { ok: boolean; data?: unknown; error?: string };

let server: Server;

beforeAll(async () => {
  server = await bootSyncedServer();
});

// Each test saves settings or wipes data, and both move a version stamp — so each needs the
// Script Properties back where they started, and the frozen clock back where `tick()` found
// it. `resetToSynced` does both.
beforeEach(async () => {
  server = await resetToSynced();
});

afterAll(() => {
  teardownServer();
});

/** Both versions, as the Script Properties hold them. */
function versions(): { data: string; wiz: string } {
  const props = (globalThis as unknown as {
    PropertiesService: GoogleAppsScript.Properties.PropertiesService;
  }).PropertiesService.getScriptProperties();
  return {
    data: props.getProperty("DATA_VERSION") ?? "0",
    wiz: props.getProperty("WIZ_DATA_VERSION") ?? "0",
  };
}

/**
 * The clock is frozen by bootServer. Both versions LEAD with a timestamp, and the tests
 * below advance it so the two stamps are legibly different runs rather than relying on the
 * tie-breaking counter — the counter is pinned on its own, further down.
 */
function tick(): void {
  vi.setSystemTime(new Date(Date.now() + 1000));
}

describe("WIZ_DATA_VERSION", () => {
  it("does NOT move when settings are saved — the whole point", () => {
    expect((server.api.runSync({}) as Result).ok).toBe(true);
    const before = versions();
    tick();

    expect((server.api.setSettings({ maxNodes: 250 }) as Result).ok).toBe(true);
    const after = versions();

    // The read-model space is invalidated, because a node budget really does change the
    // projected graph...
    expect(after.data).not.toBe(before.data);
    // ...and the Wiz space is not, because Wiz has not been asked anything.
    expect(after.wiz).toBe(before.wiz);
  });

  it("moves on a sync, so a fresh picture of the tenant does invalidate expansions", () => {
    expect((server.api.runSync({}) as Result).ok).toBe(true);
    const before = versions();
    tick();

    expect((server.api.runSync({}) as Result).ok).toBe(true);
    expect(versions().wiz).not.toBe(before.wiz);
  });

  it("moves on resetData — the case bumping inside persistSync would have missed", () => {
    expect((server.api.runSync({}) as Result).ok).toBe(true);
    const before = versions();
    tick();

    expect((server.api.resetData({}) as Result).ok).toBe(true);

    // Without this a live expansion could outlive a full wipe by up to six hours, and
    // expandAsset's own guard cannot catch it: with the graph gone it finds no node, skips
    // the kind check, and serves the stale answer.
    expect(versions().wiz).not.toBe(before.wiz);
  });
});

describe("expandAsset cache key", () => {
  it("varies with the project scope, which is a live input to the query", () => {
    // projectId is read from a Script Property and sent with the query. Leaving it out of
    // the key served the tenant-wide answer to an operator who had just narrowed the scope.
    const tenantWide = cacheKey("expandAsset", { id: "agent-a", projectId: null }, "v1");
    const scoped = cacheKey("expandAsset", { id: "agent-a", projectId: "proj-1" }, "v1");
    expect(scoped).not.toBe(tenantWide);
  });

  it("varies with the version it is handed", () => {
    expect(cacheKey("expandAsset", { id: "a" }, "wiz-1"))
      .not.toBe(cacheKey("expandAsset", { id: "a" }, "wiz-2"));
  });

  it("still answers `stored` without credentials, spending no call", () => {
    expect((server.api.runSync({}) as Result).ok).toBe(true);
    const res = server.api.expandAsset({ id: "any-asset" }) as Result;
    // gas-shims throws on UrlFetchApp.fetch, so reaching the network here would fail loudly.
    expect(res.ok).toBe(true);
    expect((res.data as { source: string }).source).toBe("stored");
  });
});

describe("the version stamp itself", () => {
  it("moves on every mutation, including two inside the same millisecond", () => {
    // It is a cache KEY, so the only property it owes anyone is differing from its
    // predecessor. `String(Date.now())` does not owe that: two mutations landing in the
    // same millisecond stamp the same version, every key stays identical, and the second
    // mutation serves the first one's payload until the 6h TTL expires.
    //
    // No tick() here, deliberately — the frozen clock IS the same-millisecond case, and
    // running it under a moving clock would only re-test what the timestamp already gave.
    expect((server.api.setSettings({ maxNodes: 250 }) as Result).ok).toBe(true);
    const first = versions().data;
    expect((server.api.setSettings({ maxNodes: 260 }) as Result).ok).toBe(true);
    const second = versions().data;
    expect((server.api.setSettings({ maxNodes: 270 }) as Result).ok).toBe(true);
    const third = versions().data;

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third).not.toBe(first);
  });

  it("still leads with the clock, so a stamp stays readable as a time", () => {
    // The counter is a tie-breaker, not a replacement: an operator reading DATA_VERSION out
    // of Script Properties should still be able to see WHEN the last mutation was.
    expect((server.api.setSettings({ maxNodes: 250 }) as Result).ok).toBe(true);
    expect(versions().data.split(".")[0]).toBe(String(Date.now()));
  });
});
