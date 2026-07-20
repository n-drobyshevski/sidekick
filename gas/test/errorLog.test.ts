// The recent-errors ring buffer over a stubbed Script Properties store (same node stub the
// serverCache test uses). Covers newest-first ordering, the entry cap, message truncation,
// clear, and the never-throw contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearErrors, recentErrors, recordError } from "../src/server/errorLog";

const propStore = new Map<string, string>();

beforeEach(() => {
  propStore.clear();
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (k: string) => propStore.get(k) ?? null,
      setProperty: (k: string, v: string) => {
        propStore.set(k, v);
      },
      deleteProperty: (k: string) => {
        propStore.delete(k);
      },
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("errorLog", () => {
  it("returns [] when nothing is recorded", () => {
    expect(recentErrors()).toEqual([]);
  });

  it("records newest-first with op / kind / message", () => {
    recordError("scan", new Error("boom"), "error", 1000);
    recordError("supportGroupRefresh", "input exceeded", "error", 2000);
    const out = recentErrors();
    expect(out.map((e) => e.op)).toEqual(["supportGroupRefresh", "scan"]);
    expect(out[0]).toMatchObject({ op: "supportGroupRefresh", kind: "error", message: "input exceeded" });
    expect(out[1].message).toBe("boom");
  });

  it("prefers an Error's message over String(err)", () => {
    recordError("api", new Error("the message"));
    expect(recentErrors()[0].message).toBe("the message");
  });

  it("caps at 25 entries, keeping the newest", () => {
    for (let i = 0; i < 30; i++) recordError("api", `err ${i}`, "error", i);
    const out = recentErrors();
    expect(out).toHaveLength(25);
    expect(out[0].message).toBe("err 29"); // newest
    expect(out[24].message).toBe("err 5"); // oldest kept
  });

  it("truncates a long message", () => {
    recordError("api", "x".repeat(600));
    const msg = recentErrors()[0].message;
    expect(msg.length).toBe(501); // 500 chars + the ellipsis
    expect(msg.endsWith("…")).toBe(true);
  });

  it("keeps the stored blob under the Script Property size cap", () => {
    for (let i = 0; i < 25; i++) recordError("supportGroupRefresh", "x".repeat(500), "error", i);
    const raw = propStore.get("RECENT_ERRORS")!;
    expect(raw.length).toBeLessThanOrEqual(8500);
    // Even after trimming, the just-added (newest) entry is always retained.
    expect(recentErrors()[0].message.startsWith("x")).toBe(true);
  });

  it("clearErrors empties the log", () => {
    recordError("api", "one");
    expect(recentErrors()).toHaveLength(1);
    clearErrors();
    expect(recentErrors()).toEqual([]);
  });

  it("tolerates a malformed stored blob", () => {
    propStore.set("RECENT_ERRORS", "{not json");
    expect(recentErrors()).toEqual([]);
  });

  it("never throws even if the store is unavailable", () => {
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => {
        throw new Error("quota");
      },
    });
    expect(() => recordError("api", "boom")).not.toThrow();
  });
});
