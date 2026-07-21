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
  it("large delta does not overflow the call stack (regression: push(...) spread)", () => {
    // Remaining delta nodes are appended via the Map's values(); a full scan's delta is
    // findings-scale, so spreading it into push() ("merged.push(...byKey.values())") overflowed
    // the stack. 200k distinct nodes is past that limit; pushAll must loop instead.
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
