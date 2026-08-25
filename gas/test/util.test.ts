// The spread-overflow helpers, guarded directly.
//
// `Math.max(...arr)` and `target.push(...items)` make every element a CALL ARGUMENT, so both
// throw RangeError once the array is large. `maxNum`, `minNum` and `pushAll` exist solely to
// fold instead of spread, and each carries a comment in util.ts saying so — but until now not
// one of them had a test. The only thing standing behind all three was
// `remediation.test.ts`'s 200k-row Kaplan-Meier run, which reaches `maxNum` through a
// three-second estimator, and `transform.test.ts`'s merge, which reaches `pushAll` through
// `mergeNodes`.
//
// Guarding them here instead is the same assertion for a thousandth of the cost: these are
// plain number arrays, so the arithmetic is milliseconds and what is left is exactly the
// question — does the helper spread. The integration tests keep their own role, which is to
// catch a spread written INLINE somewhere on those paths, where no helper would be involved.
//
// N IS NOT TUNED TO THIS MACHINE. Measured on node 22 / x64, `Math.max(...)` takes 125,275
// elements and throws at 125,276; `push(...)` breaks at 125,269. That ceiling is a function of
// the available stack, so it moves with the engine and the environment — a smaller stack lowers
// it, a larger one raises it. 200k is the margin both existing regression tests already chose,
// and picking anything nearer the measured number would be calibrating to one machine and
// risking a test that silently stops testing on another.

import { describe, expect, it } from "vitest";

import { maxNum, minNum, pushAll } from "../src/domain/util";

const N = 200_000;

describe("maxNum / minNum — fold, never spread", () => {
  it("survive an array well past the argument limit", () => {
    const values: number[] = [];
    for (let i = 0; i < N; i++) values.push((i % 500) + 1);
    // The assertion that matters is that these return at all; the values confirm the fold is
    // also correct rather than merely non-throwing.
    expect(maxNum(values)).toBe(500);
    expect(minNum(values)).toBe(1);
  });

  it("agree with Math.max/Math.min on a small sample", () => {
    const v = [3, -1, 7, 0, 7, -9];
    expect(maxNum(v)).toBe(Math.max(...v));
    expect(minNum(v)).toBe(Math.min(...v));
  });

  // The reduce seeds are -Infinity and Infinity, which is what an empty fold must return —
  // callers guard with `values.length ? maxNum(values) : null` precisely because of this.
  it("return the identity element for an empty array", () => {
    expect(maxNum([])).toBe(-Infinity);
    expect(minNum([])).toBe(Infinity);
  });

  it("do not mistake a single element for an empty fold", () => {
    expect(maxNum([42])).toBe(42);
    expect(minNum([42])).toBe(42);
  });
});

describe("pushAll — append without spreading", () => {
  it("appends an array well past the argument limit", () => {
    const target: number[] = [];
    const items: number[] = [];
    for (let i = 0; i < N; i++) items.push(i);
    pushAll(target, items);
    expect(target.length).toBe(N);
    expect(target[N - 1]).toBe(N - 1);
  });

  // The doc comment promises any iterable, and the scan path feeds it Map value iterators.
  it("accepts a Map value iterator, not just an array", () => {
    const m = new Map([["a", 1], ["b", 2]]);
    const target: number[] = [3];
    pushAll(target, m.values());
    expect(target).toEqual([3, 1, 2]);
  });

  it("appends onto a non-empty target in order", () => {
    const target = [1, 2];
    pushAll(target, [3, 4]);
    expect(target).toEqual([1, 2, 3, 4]);
  });

  it("is a no-op for an empty source", () => {
    const target = [1];
    pushAll(target, []);
    expect(target).toEqual([1]);
  });
});
