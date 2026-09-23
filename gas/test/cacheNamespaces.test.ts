// Every cached read-model is named with a version, because that version is now the only thing a
// code change contributes to its cache key. The stamp used to carry BUILD_ID, so any deploy made
// every entry cold (measured at ~35 s of first opens after each one); it carries
// serverCache.CACHE_EPOCH instead, and a change to one payload's shape or meaning is expressed
// by bumping that payload's namespace — `mttr11` → `mttr12` — as every rename comment in api.ts
// records. A namespace with no number has nothing to bump, so it cannot be introduced.
//
// Read as source: the namespaces are string literals at the call sites.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8")
  // Comments mention cached()/durablyCached() in prose; drop them before scanning call sites.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

function namespaces(): string[] {
  const consts = new Map(
    [...SRC.matchAll(/const (\w+) = "([^"]+)";/g)].map((m) => [m[1]!, m[2]!] as const),
  );
  const out: string[] = [];
  for (const m of SRC.matchAll(/\b(?:cached|durablyCached|durablyPeek)(?:<[^>(]*>)?\(\s*(?:"([^"]+)"|(\w+))/g)) {
    const name = m[1] ?? consts.get(m[2]!);
    if (name !== undefined) out.push(name);
  }
  return out;
}

describe("cache namespaces", () => {
  it("finds the read-models this spec expects", () => {
    const names = namespaces();
    expect(names.length).toBeGreaterThan(15);
    for (const n of ["bootstrapCore8", "mttr12", "coldZone1", "eolKeys1"]) expect(names).toContain(n);
  });

  it("names every one with a version to bump", () => {
    expect(namespaces().filter((n) => !/\d+$/.test(n))).toEqual([]);
  });

  it("keeps BUILD_ID out of the cache stamp", () => {
    const cache = readFileSync(new URL("../src/server/serverCache.ts", import.meta.url), "utf8");
    const stampLine = cache.split("\n").find((l) => l.includes("versionStamp = `"));
    expect(stampLine).toBeDefined();
    expect(stampLine).toContain("CACHE_EPOCH");
    expect(stampLine).not.toContain("BUILD_ID");
  });
});
