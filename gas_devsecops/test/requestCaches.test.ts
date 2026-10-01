// The two cross-execution caches in front of Sheets tabs every page load used to read:
// `settings` (settingsStore.loadSettings) and `domain_map` (repoTags.getRepoTagMap).
//
// Measured in production (PERF_PLAN.md step 1): `domain_map` cost 1.5–1.7 s in every
// execution that attached tags, and the settings read was the first Sheets access of a warm
// Executive load — ~0.85 s of a ~1.2 s page, most of it opening the spreadsheet. Settings are
// keyed on DATA_VERSION plus their own generation, the tag map on its generation alone (a sync
// never writes it); both writers move their key and write through. These specs pin exactly
// that, plus the fallbacks: any cache failure reads the tab as before.
//
// A fresh module graph (`vi.resetModules()` + re-import) stands for a fresh GAS execution, so
// the per-execution memos start cold while the CacheService / PropertiesService fakes persist.
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[] = [];
const writes: string[] = [];
const tabs: Record<string, Array<Record<string, unknown>>> = {};
let readThrows: string | null = null;

vi.mock("../src/server/sheetsDb", async (orig) => {
  const actual = await orig<typeof import("../src/server/sheetsDb")>();
  return {
    ...actual,
    readAll: (tab: string) => {
      reads.push(tab);
      if (readThrows === tab) throw new Error("sheet unavailable");
      return (tabs[tab] ?? []).map((r) => ({ ...r }));
    },
    overwrite: (tab: string, rows: Array<Record<string, unknown>>) => {
      writes.push(tab);
      tabs[tab] = rows.map((r) => ({ ...r }));
    },
    ensureTab: () => {},
  };
});

const props = new Map<string, string>();
const cache = new Map<string, string>();
let cacheThrows = false;
/** Only `put` fails — a write-through that did not land, while reads still work. */
let putThrows = false;

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  readThrows = null;
  for (const k of Object.keys(tabs)) delete tabs[k];
  tabs["settings"] = [{ key: "retentionDays", value_json: "30" }];
  tabs["domain_map"] = [
    { token: "repo-a", domain: "payments", lifecycle: "" },
    { token: "repo-b", domain: "", lifecycle: "production" },
  ];
  props.clear();
  cache.clear();
  cacheThrows = false;
  putThrows = false;
  const guard = () => {
    if (cacheThrows) throw new Error("cache down");
  };
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (k: string) => props.get(k) ?? null,
      setProperty: (k: string, v: string) => { props.set(k, v); },
      deleteProperty: (k: string) => { props.delete(k); },
    }),
  });
  vi.stubGlobal("CacheService", {
    getScriptCache: () => ({
      get: (k: string) => { guard(); return cache.get(k) ?? null; },
      put: (k: string, v: string) => {
        guard();
        if (putThrows) throw new Error("cache put failed");
        cache.set(k, v);
      },
      getAll: (keys: string[]) => {
        guard();
        const out: Record<string, string> = {};
        for (const k of keys) if (cache.has(k)) out[k] = cache.get(k)!;
        return out;
      },
      putAll: (entries: Record<string, string>) => {
        guard();
        for (const [k, v] of Object.entries(entries)) cache.set(k, v);
      },
    }),
  });
  vi.stubGlobal("Utilities", {
    newBlob: (data: string | number[]) => ({ data }),
    gzip: (blob: { data: string }) => ({
      getBytes: () => Array.from(gzipSync(Buffer.from(blob.data, "utf8"))),
    }),
    ungzip: (blob: { data: number[] }) => ({
      getDataAsString: () => gunzipSync(Buffer.from(blob.data)).toString("utf8"),
    }),
    base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
    base64Decode: (s: string) => Array.from(Buffer.from(s, "base64")),
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const readsOf = (tab: string) => reads.filter((t) => t === tab).length;

describe("settings: cross-execution cache", () => {
  const nextExecution = async () => {
    vi.resetModules();
    return import("../src/server/settingsStore");
  };

  it("serves a second execution from the cache without opening the tab", async () => {
    expect((await nextExecution()).loadSettings().retentionDays).toBe(30);
    expect((await nextExecution()).loadSettings().retentionDays).toBe(30);
    expect(readsOf("settings")).toBe(1);
  });

  it("hands the next execution the saved dict, not the tab's old one", async () => {
    const first = await nextExecution();
    const saved = first.saveSettings({ ...first.loadSettings(), retentionDays: 45 });
    const next = (await nextExecution()).loadSettings();
    expect(next.retentionDays).toBe(45);
    expect(next).toEqual(saved);
    expect(readsOf("settings")).toBe(1);
  });

  it("answers exactly what the tab would", async () => {
    const fromTab = (await nextExecution()).loadSettings();
    const fromCache = (await nextExecution()).loadSettings();
    expect(fromCache).toEqual(fromTab);
  });

  it("re-reads the tab once the data version moves", async () => {
    (await nextExecution()).loadSettings();
    props.set("DATA_VERSION", "999");
    (await nextExecution()).loadSettings();
    expect(readsOf("settings")).toBe(2);
  });

  // A header view switch saves WITHOUT moving DATA_VERSION (`saveSettings`'s `viewOnly`), so the
  // key has to move on something else — SETTINGS_GEN — or it would go on answering for the old
  // view. The write-through usually hides that: the save rewrites the very entry it would have
  // left stale. These two take the write-through away.
  it("a view-only save moves the key without moving the data version", async () => {
    const first = await nextExecution();
    first.loadSettings();
    const version = props.get("DATA_VERSION");
    first.saveSettings({ ...first.loadSettings(), projectView: "leaf-a" }, { viewOnly: true });
    expect(props.get("DATA_VERSION")).toBe(version);
    expect(props.get("SETTINGS_GEN")).toBeDefined();
    // Two entries now, under two keys: the stale one is unreachable rather than overwritten.
    expect([...cache.keys()].filter((k) => k.startsWith("dsSettings2:"))).toHaveLength(2);
    expect((await nextExecution()).loadSettings().projectView).toBe("leaf-a");
  });

  it("a view switch whose write-through failed is not served the old view", async () => {
    (await nextExecution()).loadSettings(); // the old view, cached
    const saver = await nextExecution();
    putThrows = true;
    saver.saveSettings({ ...saver.loadSettings(), projectView: "leaf-a" }, { viewOnly: true });
    putThrows = false;
    expect((await nextExecution()).loadSettings().projectView).toBe("leaf-a");
    expect(readsOf("settings")).toBe(2);
  });

  it("does not cache a dict too large for one CacheService value", async () => {
    tabs["settings"] = [{ key: "blob", value_json: JSON.stringify("x".repeat(100_000)) }];
    (await nextExecution()).loadSettings();
    (await nextExecution()).loadSettings();
    expect(readsOf("settings")).toBe(2);
  });

  it("falls back to the tab when the cache throws", async () => {
    cacheThrows = true;
    expect((await nextExecution()).loadSettings().retentionDays).toBe(30);
    expect(readsOf("settings")).toBe(1);
  });
});

describe("domain_map: cross-execution cache", () => {
  const nextExecution = async () => {
    vi.resetModules();
    return import("../src/server/repoTags");
  };

  it("serves a second execution from the cache without opening the tab", async () => {
    const first = (await nextExecution()).getRepoTagMap();
    const second = (await nextExecution()).getRepoTagMap();
    expect(second).toEqual(first);
    expect(second["repo-a"]).toEqual({ domain: "payments", lifecycle: null });
    expect(readsOf("domain_map")).toBe(1);
  });

  it("hands the next execution the saved map, not the tab's old one", async () => {
    const map = { "repo-z": { domain: "identity", lifecycle: "production" } };
    (await nextExecution()).setRepoTagMap(map);
    expect((await nextExecution()).getRepoTagMap()).toEqual(map);
    expect(readsOf("domain_map")).toBe(0);
  });

  // A sync bumps DATA_VERSION and never touches the tab, so it must not cost the 1.5 s read.
  it("keeps serving the cached map across a data-version bump", async () => {
    (await nextExecution()).getRepoTagMap();
    props.set("DATA_VERSION", "999");
    (await nextExecution()).getRepoTagMap();
    expect(readsOf("domain_map")).toBe(1);
  });

  it("re-reads the tab once the map's generation moves", async () => {
    (await nextExecution()).getRepoTagMap();
    props.set("REPO_TAG_MAP_GEN", "elsewhere");
    (await nextExecution()).getRepoTagMap();
    expect(readsOf("domain_map")).toBe(2);
  });

  it("moves the generation on every save, so a second save is not served the first", async () => {
    const one = { "repo-1": { domain: "one", lifecycle: null } };
    const two = { "repo-2": { domain: "two", lifecycle: null } };
    (await nextExecution()).setRepoTagMap(one);
    const genOne = props.get("REPO_TAG_MAP_GEN");
    (await nextExecution()).setRepoTagMap(two);
    expect(props.get("REPO_TAG_MAP_GEN")).not.toBe(genOne);
    expect((await nextExecution()).getRepoTagMap()).toEqual(two);
    expect(readsOf("domain_map")).toBe(0);
  });

  it("round-trips a register-sized map through the chunked store", async () => {
    tabs["domain_map"] = Array.from({ length: 10_000 }, (_, i) => ({
      token: `wiz-repo-${i}-${"x".repeat(20)}`, domain: `domain-${i % 37}`, lifecycle: i % 3 ? "prod" : "",
    }));
    const first = (await nextExecution()).getRepoTagMap();
    const second = (await nextExecution()).getRepoTagMap();
    expect(Object.keys(second)).toHaveLength(10_000);
    expect(second).toEqual(first);
    expect(readsOf("domain_map")).toBe(1);
  });

  it("does not cache the empty map of an unreadable tab", async () => {
    readThrows = "domain_map";
    expect((await nextExecution()).getRepoTagMap()).toEqual({});
    readThrows = null;
    expect(Object.keys((await nextExecution()).getRepoTagMap())).toHaveLength(2);
  });

  it("falls back to the tab when the cache throws", async () => {
    cacheThrows = true;
    expect(Object.keys((await nextExecution()).getRepoTagMap())).toHaveLength(2);
    expect(readsOf("domain_map")).toBe(1);
  });
});
