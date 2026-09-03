// Chunked gzip+base64 CacheService round-trip and DATA_VERSION keying. GAS globals
// (CacheService / Utilities / PropertiesService) are stubbed with node equivalents so the
// packing format and miss semantics are exercised for real.
//
// Port of gas/test/serverCache.test.ts. One divergence, and it is a real one rather than a
// rename: `configStamp()` here folds `WIZ_PROJECT_ID_V2` (props.PROP_KEYS.wizProjectIdV2) and
// nothing else, where gas/ folds a domain-tag key this register does not have. The property is
// an operator Script Property that no mutation bumps, so the "read it once per execution" spec
// below names THIS key — a spec still asserting on `WIZ_DOMAIN_TAG_KEY` would have passed
// vacuously (zero reads is also "not two").

import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMemosForTest,
  bumpDataVersion,
  bumpWizDataVersion,
  cacheGetJson,
  cacheKey,
  cachePutJson,
  cached,
  currentStamp,
  dataVersion,
  paramsHash,
  splitChunks,
  wizDataVersion,
} from "../src/server/serverCache";

const cacheStore = new Map<string, string>();
const propStore = new Map<string, string>();
let propReads: string[] = [];

beforeEach(() => {
  cacheStore.clear();
  propStore.clear();
  propReads = [];
  vi.stubGlobal("CacheService", {
    getScriptCache: () => ({
      get: (k: string) => cacheStore.get(k) ?? null,
      getAll: (keys: string[]) => {
        const out: Record<string, string> = {};
        for (const k of keys) if (cacheStore.has(k)) out[k] = cacheStore.get(k)!;
        return out;
      },
      putAll: (entries: Record<string, string>, _ttl?: number) => {
        for (const [k, v] of Object.entries(entries)) cacheStore.set(k, v);
      },
    }),
  });
  vi.stubGlobal("Utilities", {
    newBlob: (data: string | number[], _type?: string) => ({ data }),
    gzip: (blob: { data: string }) => ({
      getBytes: () => Array.from(gzipSync(Buffer.from(blob.data, "utf8"))),
    }),
    ungzip: (blob: { data: number[] }) => ({
      getDataAsString: () => gunzipSync(Buffer.from(blob.data)).toString("utf8"),
    }),
    base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
    base64Decode: (s: string) => Array.from(Buffer.from(s, "base64")),
  });
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (k: string) => { propReads.push(k); return propStore.get(k) ?? null; },
      setProperty: (k: string, v: string) => { propStore.set(k, v); },
      deleteProperty: (k: string) => { propStore.delete(k); },
    }),
  });
  // Seed a version and, as a side effect, clear the module-level memos. Both matter:
  // `propStore.clear()` above wipes DATA_VERSION while the memos survive (module state lives
  // for the whole file, as it lives for a whole GAS execution), so without this a test could
  // key against a stamp from the previous one.
  __resetMemosForTest();
  bumpDataVersion();
  propReads = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitChunks", () => {
  it("splits and rejoins losslessly", () => {
    const s = "abcdefghij";
    expect(splitChunks(s, 3)).toEqual(["abc", "def", "ghi", "j"]);
    expect(splitChunks(s, 3).join("")).toBe(s);
    expect(splitChunks("", 3)).toEqual([""]);
  });
});

describe("cacheKey", () => {
  it("is deterministic and stays under the 250-char CacheService cap", () => {
    const params = { scope: "sca-".repeat(60) };
    const k1 = cacheKey("mttr", params, "1751810000000");
    const k2 = cacheKey("mttr", params, "1751810000000");
    expect(k1).toBe(k2);
    expect(k1.length + ":m".length).toBeLessThan(250);
    expect(cacheKey("mttr", { scope: "sast" }, "1751810000000")).not.toBe(k1);
    expect(cacheKey("mttr", params, "1751819999999")).not.toBe(k1);
  });
});

describe("cachePutJson / cacheGetJson", () => {
  it("round-trips a value in a single chunk", () => {
    const value = { rows: [1, 2, 3], nested: { a: null, b: "x" } };
    cachePutJson("k", value);
    expect(cacheGetJson("k")).toEqual(value);
  });

  it("round-trips across many chunks", () => {
    const value = { text: "wiz-".repeat(5000) };
    cachePutJson("k", value, 21600, 64); // force dozens of chunks
    expect(Number(cacheStore.get("k:m"))).toBeGreaterThan(1);
    expect(cacheGetJson("k")).toEqual(value);
  });

  it("reads a partially evicted entry as a miss", () => {
    cachePutJson("k", { text: "wiz-".repeat(5000) }, 21600, 64);
    expect(Number(cacheStore.get("k:m"))).toBeGreaterThan(1);
    cacheStore.delete("k:1");
    expect(cacheGetJson("k")).toBeUndefined();
  });

  it("misses on an absent key", () => {
    expect(cacheGetJson("nope")).toBeUndefined();
  });
});

describe("cached", () => {
  it("computes once per version, then serves the cache", () => {
    const compute = vi.fn(() => ({ n: 42 }));
    expect(cached("stats", null, compute)).toEqual({ n: 42 });
    expect(cached("stats", null, compute)).toEqual({ n: 42 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes after bumpDataVersion", () => {
    const compute = vi.fn(() => ({ n: 42 }));
    cached("stats", null, compute);
    const before = dataVersion();
    bumpDataVersion();
    expect(dataVersion()).not.toBe(before);
    cached("stats", null, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keys on params", () => {
    const compute = vi.fn(() => ({}));
    cached("mttr", { scope: "sca" }, compute);
    cached("mttr", { scope: "sast" }, compute);
    cached("mttr", { scope: "sca" }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("falls back to compute() when the cache layer throws", () => {
    vi.stubGlobal("CacheService", {
      getScriptCache: () => { throw new Error("quota"); },
    });
    const compute = vi.fn(() => ({ ok: 1 }));
    expect(cached("stats", null, compute)).toEqual({ ok: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  // The two version namespaces are the trap this register inherits from gas_ai: an entry
  // stamped under the wrong one would simply never hit — no error, no wrong answer.
  it("keeps the WIZ namespace independent of DATA_VERSION", () => {
    const compute = vi.fn(() => "wiz");
    cached("wizEntry", null, compute, 60, wizDataVersion());
    bumpDataVersion();
    cached("wizEntry", null, compute, 60, wizDataVersion()); // still a hit
    expect(compute).toHaveBeenCalledTimes(1);
    bumpWizDataVersion();
    cached("wizEntry", null, compute, 60, wizDataVersion());
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

// The version prefix every key carries used to be rebuilt inline on each `cached()` call: two
// PropertiesService reads plus a pure-JS SHA-1, for an answer that cannot change mid-request
// unless this module changes it. `warmReadModels` resolves a dozen entries in one execution,
// which is the caller that makes this worth anything.
describe("the version stamp is read once per execution", () => {
  it("reads DATA_VERSION and the project-scope key once across several cached() calls", () => {
    cached("a", { x: 1 }, () => 1);
    cached("b", { x: 2 }, () => 2);
    cached("c", { x: 3 }, () => 3);
    cached("d", { x: 4 }, () => 4);
    expect(propReads.filter((k) => k === "DATA_VERSION").length).toBe(1);
    expect(propReads.filter((k) => k === "WIZ_PROJECT_ID_V2").length).toBe(1);
  });

  // THE INVALIDATION IS THE WHOLE SAFETY ARGUMENT. A mutate() endpoint that bumps and then
  // serves a cached payload in the same execution must not key that read to the pre-bump
  // version — it would hand back exactly the state it just invalidated.
  it("re-reads after bumpDataVersion, so a same-execution bump-then-read is not stale", () => {
    cached("k", null, () => "before");
    bumpDataVersion();
    propReads = [];
    cached("k", null, () => "after");
    expect(propReads.filter((x) => x === "DATA_VERSION").length).toBe(1);
  });

  it("keys a value differently either side of a bump, so the stale entry is unreachable", () => {
    expect(cached("k", null, () => "before")).toBe("before");
    expect(cached("k", null, () => "SHOULD NOT COMPUTE")).toBe("before"); // warm
    bumpDataVersion();
    expect(cached("k", null, () => "after")).toBe("after"); // new key, recomputed
  });

  // The operator can change WIZ_PROJECT_ID_V2 in the GAS console and nothing bumps for it, so
  // it has to be part of the stamp or every derived entry answers under the old scope until
  // the six-hour TTL expires — with no sync to run that would clear it.
  it("moves the stamp when the project scope changes", () => {
    const before = currentStamp();
    propStore.set("WIZ_PROJECT_ID_V2", "project-b");
    __resetMemosForTest();
    expect(currentStamp()).not.toBe(before);
  });
});

describe("paramsHash", () => {
  it("is stable, short, and separates distinct params", () => {
    const h = paramsHash({ scope: "sca", severities: null });
    expect(h).toBe(paramsHash({ scope: "sca", severities: null }));
    expect(h.length).toBe(12);
    expect(h).not.toBe(paramsHash({ scope: "sast", severities: null }));
    expect(paramsHash(null)).toBe(paramsHash(undefined));
  });
});
