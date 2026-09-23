// Every cached read-model is named with a version, because that version is now the only thing a
// code change contributes to its cache key. The key used to carry BUILD_ID, so any deploy made
// every entry cold — the bootstrap core, every read-model, and the durable Drive copies; it
// carries serverCache.CACHE_EPOCH instead (PERF_PLAN.md step 2d, gas/ #322), and a change to one
// payload's shape or meaning is expressed by bumping that payload's namespace — `dsMttr3` →
// `dsMttr4`. A namespace with no number has nothing to bump, so it cannot be introduced.
//
// Read as source: the namespaces are string literals (or named constants) at the call sites.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["api.ts", "readModels.ts", "bootCore.ts"];

const strip = (src: string) =>
  // Comments mention cached()/durablyCached() in prose; drop them before scanning call sites.
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function namespaces(): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    const src = strip(readFileSync(new URL(`../src/server/${f}`, import.meta.url), "utf8"));
    const consts = new Map(
      [...src.matchAll(/const (\w+) = "([^"]+)";/g)].map((m) => [m[1]!, m[2]!] as const),
    );
    const calls = /\b(?:cached|durablyCached|durablyPeek)(?:<[^>(]*>)?\(\s*(?:"([^"]+)"|(\w+))/g;
    for (const m of src.matchAll(calls)) {
      const name = m[1] ?? consts.get(m[2]!);
      if (name !== undefined) out.push(name);
    }
  }
  return out;
}

describe("cache namespaces", () => {
  it("finds the read-models this spec expects", () => {
    const names = namespaces();
    expect(names.length).toBeGreaterThan(8);
    for (const n of ["dsBootCore1", "dsMttr4", "dsExecutive2", "dsStorage1", "settingsImpact1"]) {
      expect(names).toContain(n);
    }
  });

  it("names every one with a version to bump", () => {
    expect(namespaces().filter((n) => !/\d+$/.test(n))).toEqual([]);
  });

  it("keeps BUILD_ID out of the cache key and the L2 stamp", () => {
    const cache = readFileSync(new URL("../src/server/serverCache.ts", import.meta.url), "utf8");
    const prefix = cache.split("\n").find((l) => l.startsWith("const KEY_PREFIX = "));
    expect(prefix).toBeDefined();
    expect(prefix).toContain("CACHE_EPOCH");
    expect(strip(cache)).not.toContain("BUILD_ID");
  });
});
