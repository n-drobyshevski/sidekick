// The entry screen shown to a caller the allowlist has ALREADY admitted.
//
// It is a courtesy, not a boundary, and the risk runs the opposite way from access.test.ts:
// there the danger is admitting someone, here it is STRANDING someone. A gate standing in
// front of the whole app must fail open in every direction it can fail — no address, no
// deployment URL, a cache that will not answer — because "the screen never appeared" is a
// shrug and "nobody can open the dashboard" is an outage.
//
// The other trap pinned here is the shared marker. Under "execute as me" the effective user is
// the owner, so CacheService.getUserCache() is the OWNER's store for every visitor: keyed
// there, one person clicking Continue would dismiss the screen for the whole team, and the
// only symptom would be a screen that mysteriously stopped appearing.

import { beforeEach, describe, expect, it, vi } from "vitest";

let activeEmail = "listed@example.com";
const ownerAddress = "owner@example.com";
let allowlist: string | null = "listed@example.com, other@example.com";
let serviceUrl: string | null = "https://script.google.com/a/macros/example.com/s/AKfycbx/exec";

const cache: Record<string, string> = {};
const puts: Array<{ key: string; ttl: number }> = [];
let cacheThrows = false;

vi.stubGlobal("Session", {
  getActiveUser: () => ({ getEmail: () => activeEmail }),
  getEffectiveUser: () => ({ getEmail: () => ownerAddress }),
});
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => (k === "ALLOWED_USERS" ? allowlist : null),
  }),
});
vi.stubGlobal("CacheService", {
  getScriptCache: () => ({
    get: (k: string) => {
      if (cacheThrows) throw new Error("cache unavailable");
      return k in cache ? cache[k]! : null;
    },
    put: (k: string, v: string, ttl: number) => {
      if (cacheThrows) throw new Error("cache unavailable");
      cache[k] = v;
      puts.push({ key: k, ttl });
    },
  }),
  // Present so a regression that reaches for it is visible rather than a ReferenceError.
  getUserCache: () => { throw new Error("getUserCache is the OWNER's store under execute-as-me"); },
});
vi.stubGlobal("ScriptApp", {
  getService: () => ({ getUrl: () => { if (serviceUrl === null) throw new Error("no url"); return serviceUrl; } }),
});
vi.stubGlobal("HtmlService", {
  createHtmlOutput: (html: string) => ({
    html,
    setTitle() { return this; },
    addMetaTag() { return this; },
  }),
});
vi.stubGlobal("Utilities", {
  DigestAlgorithm: { SHA_1: "SHA_1" },
  Charset: { UTF_8: "UTF_8" },
  computeDigest: (_a: unknown, s: string) =>
    // Deterministic per input, which is all the marker key needs.
    Array.from(String(s)).map((c) => c.charCodeAt(0) % 256),
});
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

async function load() {
  return import("../src/server/welcome");
}

beforeEach(() => {
  for (const k of Object.keys(cache)) delete cache[k];
  puts.length = 0;
  cacheThrows = false;
  activeEmail = "listed@example.com";
  allowlist = "listed@example.com, other@example.com";
  serviceUrl = "https://script.google.com/a/macros/example.com/s/AKfycbx/exec";
  vi.resetModules();
});

describe("the gate shows once and then gets out of the way", () => {
  it("shows the screen to a caller who has not entered", async () => {
    const { gate } = await load();
    const out = gate({ parameter: {} } as never);
    expect(out).not.toBeNull();
    expect((out as unknown as { html: string }).html).toContain("You're signed in.");
  });

  it("does NOT record an entry for a screen that was only rendered", async () => {
    // Rendering is not entering. If a bare render marked them, someone who closed the tab at
    // the screen would silently never be asked again.
    const { gate } = await load();
    gate({ parameter: {} } as never);
    expect(puts).toEqual([]);
  });

  it("records the entry and passes through when Continue comes back", async () => {
    const { gate, ENTRY_TTL_SEC } = await load();
    expect(gate({ parameter: { enter: "1" } } as never)).toBeNull();
    expect(puts.length).toBe(1);
    expect(puts[0]!.ttl).toBe(ENTRY_TTL_SEC);
  });

  it("stays out of the way for the rest of the session", async () => {
    const { gate } = await load();
    gate({ parameter: { enter: "1" } } as never);
    expect(gate({ parameter: {} } as never)).toBeNull();
    expect(gate({ parameter: {} } as never)).toBeNull();
  });

  it("SLIDES the marker on every load, which is what makes it once-per-session", async () => {
    // CacheService caps expiry at 6h, so a fixed marker would re-prompt mid-afternoon. Renewing
    // on each load is the only way a continuous working day costs one Continue.
    const { gate } = await load();
    gate({ parameter: { enter: "1" } } as never);
    expect(puts.length).toBe(1);
    gate({ parameter: {} } as never);
    expect(puts.length).toBe(2);
    expect(puts[1]!.key).toBe(puts[0]!.key);
  });

  it("asks for no more than the platform allows", async () => {
    const { ENTRY_TTL_SEC } = await load();
    expect(ENTRY_TTL_SEC).toBeLessThanOrEqual(21600); // put() rejects anything larger
  });
});

describe("the marker is per person, never shared", () => {
  it("does not let one caller's Continue dismiss the screen for another", async () => {
    // The getUserCache trap, pinned: keyed there, the second caller would sail straight
    // through on the first caller's click.
    //
    // The two callers are two MODULE LOADS, not two calls, and that is not test ceremony —
    // access.check() memoizes for the life of an execution, which in GAS is the life of one
    // request. Reusing one import would model a single request that changed identity midway,
    // which cannot happen, and would silently assert nothing. The cache object outlives the
    // re-import, exactly as CacheService outlives an execution.
    activeEmail = "listed@example.com";
    const first = await load();
    first.gate({ parameter: { enter: "1" } } as never);
    expect(first.gate({ parameter: {} } as never)).toBeNull();

    vi.resetModules();
    activeEmail = "other@example.com";
    const second = await load();
    expect(second.gate({ parameter: {} } as never)).not.toBeNull();
  });

  it("keys the marker by a hash, so no address is written into the cache", async () => {
    const { gate } = await load();
    gate({ parameter: { enter: "1" } } as never);
    expect(puts[0]!.key).not.toContain("listed@example.com");
  });
});

describe("the gate fails OPEN — it can never strand somebody who is allowed", () => {
  it("stands aside when there is no deployment URL to point Continue at", async () => {
    // A Continue button with nowhere to go is worse than no screen: the app becomes
    // unreachable for everyone at once.
    const { gate } = await load();
    serviceUrl = null;
    expect(gate({ parameter: {} } as never)).toBeNull();
  });

  it("stands aside when the caller has no address to key on", async () => {
    const { gate } = await load();
    activeEmail = "";
    expect(gate({ parameter: {} } as never)).toBeNull();
  });

  it("stands aside when the cache will not answer", async () => {
    const { gate } = await load();
    cacheThrows = true;
    expect(gate({ parameter: {} } as never)).toBeNull();
  });

  it("never lets a cache write failure reach the caller", async () => {
    const { gate } = await load();
    cacheThrows = true;
    expect(() => gate({ parameter: { enter: "1" } } as never)).not.toThrow();
  });

  it("tolerates a doGet event with no parameters at all", async () => {
    const { gate } = await load();
    expect(() => gate(undefined)).not.toThrow();
  });
});

describe("the screen says who is about to open the register", () => {
  it("names the address, escaped", async () => {
    const { welcomeHtml } = await load();
    const html = welcomeHtml('a<b>&"@x.com', "https://example.com/exec?enter=1");
    expect(html).not.toContain("<b>");
    expect(html).toContain("a&lt;b&gt;&amp;&quot;@x.com");
  });

  it("breaks both links out of the HtmlService sandbox iframe", async () => {
    // Without target="_top" Continue navigates the sandbox frame and dead-ends on a page that
    // cannot reach the app — the classic Apps Script web-app link trap.
    const { welcomeHtml } = await load();
    const html = welcomeHtml("a@x.com", "https://example.com/exec?enter=1", "https://accounts.google.com/x");
    expect(html.match(/target="_top"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('<base target="_top">');
  });

  it("offers Continue always and the switcher only when there is somewhere to switch", async () => {
    const { welcomeHtml } = await load();
    expect(welcomeHtml("a@x.com", "https://e/exec?enter=1", null)).toContain("Continue");
    expect(welcomeHtml("a@x.com", "https://e/exec?enter=1", null)).not.toContain("Switch Google account");
    expect(welcomeHtml("a@x.com", "https://e/exec?enter=1", "https://s")).toContain("Switch Google account");
  });

  it("carries the enter parameter on Continue", async () => {
    const { gate } = await load();
    const html = (gate({ parameter: {} } as never) as unknown as { html: string }).html;
    expect(html).toContain("enter=1");
  });
});
