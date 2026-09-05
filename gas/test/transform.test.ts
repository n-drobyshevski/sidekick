import { describe, expect, it } from "vitest";
import { extractNodes, flattenNode, mergeNodes, nodesToRecords } from "../src/domain/transform";
import { expectParity, fixture } from "./helpers";

describe("extractNodes (fixture parity)", () => {
  const { cases } = fixture("extract_nodes");
  cases.forEach((c: any, i: number) => {
    it(`case ${i}`, () => {
      expectParity(extractNodes(c.input), c.expected);
    });
  });
});

describe("mergeNodes (fixture parity)", () => {
  const fx = fixture("merge_nodes");
  it("replaces in place, appends new, keeps last intra-delta duplicate", () => {
    expectParity(mergeNodes(fx.baseline, fx.delta), fx.expected);
  });
  it("does not mutate inputs", () => {
    const b = [{ id: "x" }];
    const d = [{ id: "x", v: 2 }];
    mergeNodes(b, d);
    expect(b).toEqual([{ id: "x" }]);
  });
  // NOT A SPREAD-REGRESSION GUARD, despite the name this test used to carry ("large delta does
  // not overflow the call stack (regression: push(...) spread)"). Same finding as
  // `test/remediation.test.ts`'s two N=200,000 stress tests: `vitest.config.ts`'s
  // `pool: "threads"` runs every test in a real worker_thread, whose default V8 stack
  // tolerates a far larger argument spread than the main thread's — measured directly
  // (in-pool, not a standalone script): a bare `push(...arr)` returns cleanly through 490,000
  // elements and only throws from 498,321 on. 200,000 never gets close, so reverting `pushAll`
  // to `merged.push(...byKey.values())` and rerunning this test at N=200_000 would pass clean.
  //
  // `test/util.test.ts` is the guard that actually bites: `pushAll` is exercised directly at
  // N=2,000,000, comfortably past the measured boundary. THIS test keeps a different, real
  // claim — `mergeNodes` produces the right result at register scale — which util.test.ts's
  // plain-number arrays cannot exercise, since they never touch the merge itself.
  it("large delta merges correctly at register scale (spread regression is guarded directly in util.test.ts)", () => {
    // Remaining delta nodes are appended via the Map's values(); a full scan's delta is
    // findings-scale, so spreading it into push() ("merged.push(...byKey.values())") would
    // overflow the stack once the array is large enough — which is why `pushAll` loops instead.
    const N = 200_000;
    const delta: { id: string }[] = [];
    for (let i = 0; i < N; i++) delta.push({ id: "f-" + i });
    expect(mergeNodes(null, delta).length).toBe(N);
  });
});

describe("flattenNode", () => {
  it("produces dotted keys like json_normalize", () => {
    expect(
      flattenNode({
        id: "f",
        vulnerableAsset: { name: "vm", tags: { env: "prod" } },
        list: [1, 2],
      }),
    ).toEqual({
      id: "f",
      "vulnerableAsset.name": "vm",
      "vulnerableAsset.tags.env": "prod",
      list: [1, 2],
    });
  });
  it("nodesToRecords handles junk entries", () => {
    expect(nodesToRecords([{ a: 1 }, '{"b":2}', "not-json"])).toEqual([
      { a: 1 },
      { b: 2 },
      { _raw: "not-json" },
    ]);
  });
});
