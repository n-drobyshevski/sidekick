// The URL boundary: `src/server/urls.ts`, which decides what may become the `href` of a tile.
//
// THIS IS THE COPY OF RECORD. `api_saveUrls` calls `writeUrls`, which normalizes every field
// it is given, so nothing reaches a Script Property without passing through here — the client's
// `urlProblem` (test/urlsModel.test.js) is a field message that saves the reader a round trip,
// not a gate. Both run the SAME case table, `test/urlCases.ts`; this file is the half that
// asserts a throw and a stored value.
//
// The stubs below are the two GAS globals props.ts reaches. `readUrls`/`writeUrls` are the
// reason this file needs them at all — `normalizeAppUrl` is pure and would run without any.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ILLEGAL, LEGAL, NON_STRINGS } from "./urlCases";

const props: Record<string, string> = {};

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => props[k] ?? null,
    setProperty: (k: string, v: string) => { props[k] = v; },
    deleteProperty: (k: string) => { delete props[k]; },
  }),
});

async function load() {
  return import("../src/server/urls");
}

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  vi.resetModules();
});

describe("normalizeAppUrl accepts exactly two shapes of address", () => {
  it("takes a deployed /exec URL, a loopback harness, and blank — trimming each", async () => {
    const { normalizeAppUrl } = await load();
    for (const c of LEGAL) {
      expect(normalizeAppUrl(c.input), c.what).toBe(c.normalized);
    }
  });

  it("is not a vacuous table — it really does carry both legal forms", () => {
    // A guard that fires on nothing is a finding, not a pass (CLAUDE.md). If someone trimmed
    // the loopback cases out of urlCases.ts, every assertion above would still pass and the
    // second legal form would silently stop being tested.
    expect(LEGAL.some((c) => c.normalized.indexOf("script.google.com") > 0)).toBe(true);
    expect(LEGAL.some((c) => c.normalized.indexOf("localhost:") > 0)).toBe(true);
    expect(LEGAL.some((c) => c.normalized.indexOf("127.0.0.1:") > 0)).toBe(true);
  });

  it("REFUSES every other shape, one message for all of them", async () => {
    const { URL_REJECTED, normalizeAppUrl } = await load();
    for (const c of ILLEGAL) {
      expect(() => normalizeAppUrl(c.input), `${c.what} — ${c.why}`).toThrow(URL_REJECTED);
    }
  });

  it("refuses a non-string BEFORE any cast, rather than coercing it", async () => {
    const { URL_REJECTED, normalizeAppUrl } = await load();
    for (const c of NON_STRINGS) {
      expect(() => normalizeAppUrl(c.input), c.what).toThrow(URL_REJECTED);
    }
  });

  it("names both legal forms in the one message a reader ever sees", async () => {
    const { URL_REJECTED } = await load();
    // The message is the entire explanation — there is no second place a reader could look
    // up what a sidekick URL is supposed to be.
    expect(URL_REJECTED).toContain("script.google.com/");
    expect(URL_REJECTED).toContain("localhost:");
    expect(URL_REJECTED).toContain("/exec");
  });
});

describe("readUrls", () => {
  it("reads each sibling out of its own property", async () => {
    const { URL_PROP, readUrls } = await load();
    props[URL_PROP.os] = LEGAL[0].normalized;
    expect(readUrls()).toEqual({ os: LEGAL[0].normalized, ai: "", devsecops: "" });
  });

  it("reads an unset property as \"\" — not configured is a normal state", async () => {
    const { readUrls } = await load();
    expect(readUrls()).toEqual({ os: "", ai: "", devsecops: "" });
  });

  it("SWALLOWS a stored value the rule refuses, rather than taking the app down", async () => {
    // A property can also be hand-edited in Project Settings, where nothing runs the rule.
    // Reading is not the place to throw — one bad paste would blank the whole launcher — so a
    // refused stored value reads exactly like an unset one, and the tile says "not
    // configured" instead of linking somewhere the boundary would never have written.
    const { URL_PROP, readUrls } = await load();
    props[URL_PROP.ai] = "javascript:alert(1)";
    expect(readUrls().ai).toBe("");
  });

  it("trims a stored value that was pasted with padding", async () => {
    const { URL_PROP, readUrls } = await load();
    props[URL_PROP.devsecops] = "  " + LEGAL[0].normalized + "  ";
    expect(readUrls().devsecops).toBe(LEGAL[0].normalized);
  });
});

describe("writeUrls", () => {
  it("normalizes every field it is handed", async () => {
    const { URL_PROP, writeUrls } = await load();
    const after = writeUrls({
      os: "  " + LEGAL[0].normalized + " ",
      ai: "http://localhost:8788/",
      devsecops: "   ",
    });
    expect(after).toEqual({
      os: LEGAL[0].normalized, ai: "http://localhost:8788/", devsecops: "",
    });
    expect(props[URL_PROP.os]).toBe(LEGAL[0].normalized);
    expect(props[URL_PROP.devsecops]).toBe("");
  });

  it("is a PATCH — a field the payload omits is left alone", async () => {
    // Three fields behind one save bar. Sending everything would make two people saving
    // different fields a minute apart have the second silently revert the first — the same
    // rule `setSettings` follows in every sibling.
    const { URL_PROP, writeUrls } = await load();
    props[URL_PROP.os] = LEGAL[0].normalized;
    const after = writeUrls({ ai: "http://localhost:8788/" });
    expect(after.os).toBe(LEGAL[0].normalized);
    expect(props[URL_PROP.os]).toBe(LEGAL[0].normalized);
  });

  it("treats an explicit \"\" as a value, not an omission — it clears that sibling", async () => {
    const { URL_PROP, writeUrls } = await load();
    props[URL_PROP.os] = LEGAL[0].normalized;
    expect(writeUrls({ os: "" }).os).toBe("");
    expect(props[URL_PROP.os]).toBe("");
  });

  it("REFUSES a bad field and writes nothing for it", async () => {
    const { URL_PROP, URL_REJECTED, writeUrls } = await load();
    props[URL_PROP.os] = LEGAL[0].normalized;
    expect(() => writeUrls({ os: "https://evil.example/exec" })).toThrow(URL_REJECTED);
    expect(props[URL_PROP.os], "the refused value was stored anyway")
      .toBe(LEGAL[0].normalized);
  });

  it("refuses a non-string field the same way normalizeAppUrl does", async () => {
    const { URL_REJECTED, writeUrls } = await load();
    // `null` would otherwise cast to the string "null" and `[]` to "" — the second would
    // quietly clear a sibling nobody asked to clear.
    expect(() => writeUrls({ os: null })).toThrow(URL_REJECTED);
    expect(() => writeUrls({ ai: [] })).toThrow(URL_REJECTED);
  });
});

describe("the tile order and the property map", () => {
  it("names the three registers, and only them — `soon` is not a URL", async () => {
    const { TILE_ORDER, URL_PROP } = await load();
    expect([...TILE_ORDER]).toEqual(["os", "ai", "devsecops"]);
    // THE MECHANISM THAT MAKES THE UNBUILT FOURTH UNCLICKABLE. api.ts looks its URL up in
    // this map by key; `soon` has no entry, so it gets `undefined` -> `null` and cannot be
    // rendered as a link whatever a later client does with the payload. There is no branch to
    // forget because there is no branch.
    expect(Object.keys(URL_PROP).sort()).toEqual(["ai", "devsecops", "os"]);
    expect((URL_PROP as Record<string, string>)["soon"]).toBeUndefined();
  });

  it("points each key at the property an operator actually sets", async () => {
    const { URL_PROP } = await load();
    expect(URL_PROP).toEqual({
      os: "URL_OS", ai: "URL_AI", devsecops: "URL_DEVSECOPS",
    });
  });
});
