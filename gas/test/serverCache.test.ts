// Chunked gzip+base64 CacheService round-trip and DATA_VERSION keying. GAS globals
// (CacheService / Utilities / PropertiesService) are stubbed with node equivalents so
// the packing format and miss semantics are exercised for real.

import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bumpDataVersion,
  cached,
  cacheGetJson,
  cacheKey,
  cachePutJson,
  dataVersion,
  splitChunks,
} from "../src/server/serverCache";

const cacheStore = new Map<string, string>();
const propStore = new Map<string, string>();

beforeEach(() => {
  cacheStore.clear();
  propStore.clear();
  vi.stubGlobal("CacheService", {
    getScriptCache: () => ({
      get: (k: string) => cacheStore.get(k) ?? null,
      getAll: (keys: string[]) => {
        const out: Record<string, string> = {};
        for (const k of keys) {
          if (cacheStore.has(k)) out[k] = cacheStore.get(k)!;
        }
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
    const params = { domain: "a-really-long-domain-name".repeat(10) };
    const k1 = cacheKey("mttr", params, "1751810000000");
    const k2 = cacheKey("mttr", params, "1751810000000");
    expect(k1).toBe(k2);
    expect(k1.length + ":m".length).toBeLessThan(250);
    expect(cacheKey("mttr", { domain: "other" }, "1751810000000")).not.toBe(k1);
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
    cached("mttr", { domain: "a" }, compute);
    cached("mttr", { domain: "b" }, compute);
    cached("mttr", { domain: "a" }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("falls back to compute() when the cache layer throws", () => {
    vi.stubGlobal("CacheService", {
      getScriptCache: () => {
        throw new Error("quota");
      },
    });
    const compute = vi.fn(() => ({ ok: 1 }));
    expect(cached("stats", null, compute)).toEqual({ ok: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
