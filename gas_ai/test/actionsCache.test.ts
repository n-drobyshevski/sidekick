// getActions ranked the (cached) problems model against the `ai_framework_policies` tab on
// every call — 0.87 s of a 1.06 s warm call in production, and the first Sheets touch of the
// execution. The ranking is now cached under DATA_VERSION, like the model it ranks.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootSyncedServer, resetToSynced, teardownServer } from "./gasEnv";

let server: Awaited<ReturnType<typeof bootSyncedServer>>;

/** What a fresh GAS execution starts with: no per-execution memo survives the request. */
async function nextExecution(): Promise<void> {
  for (const m of [
    await import("../src/server/serverCache"),
    await import("../src/server/settingsStore"),
    await import("../src/server/sheetsDb"),
    await import("../src/server/syncStore"),
    await import("../src/server/readModelStore"),
  ]) m.__resetMemosForTest();
}

function policiesTabReads(log: ReturnType<typeof vi.spyOn>): number {
  return log.mock.calls.filter((c: unknown[]) =>
    String(c[0]).includes('"stage":"sheet"') && String(c[0]).includes('"ai_framework_policies"')).length;
}

beforeAll(async () => {
  server = await bootSyncedServer();
});
afterAll(() => teardownServer());
beforeEach(async () => {
  server = await resetToSynced();
});

describe("getActions ranking cache", () => {
  it("reads the policies tab once, then serves later executions from the cache", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const first = server.api.getActions({}) as { ok: boolean; data: unknown };
    expect(first.ok).toBe(true);
    await nextExecution();
    const second = server.api.getActions({}) as { ok: boolean; data: unknown };
    expect(second.data).toEqual(first.data);
    expect(policiesTabReads(log)).toBe(1);
    log.mockRestore();
  });

  it("re-ranks after a commit bumps the data version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    server.api.getActions({});
    const cache = await import("../src/server/serverCache");
    cache.bumpDataVersion();
    await nextExecution();
    server.api.getActions({});
    expect(policiesTabReads(log)).toBe(2);
    log.mockRestore();
  });
});
