// The expandAsset endpoint, end to end through the dev GAS fakes.
//
// The dry-run case is the one that has to hold: dev/gas-shims.js throws on
// UrlFetchApp.fetch by design, so a handler that reached the network here would fail
// loudly rather than quietly. That makes "returns source: stored without throwing" a real
// assertion that no live call was attempted — the detail sheet must stay fully usable on a
// tenantless checkout, which is how the whole app is developed.

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

describe("expandAsset", () => {
  it("reports stored provenance without credentials, and does not call out", () => {
    const res = server.api.expandAsset({ id: "any-asset" }) as Result;
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({
      source: "stored",
      nodes: [],
      edges: [],
      arityMismatches: 0,
      truncated: false,
    });
  });

  it("returns null for a missing id rather than expanding the whole estate", () => {
    const res = server.api.expandAsset({}) as Result;
    expect(res.ok).toBe(true);
    expect(res.data).toBeNull();
  });

  it("is reachable under the name dist/entry.js delegates to", () => {
    // The three-file rule: api.ts, the hand-written delegator, the client call site. The
    // build's drift guard covers the first two; this covers the export actually existing.
    expect(typeof server.api.expandAsset).toBe("function");
  });
});
