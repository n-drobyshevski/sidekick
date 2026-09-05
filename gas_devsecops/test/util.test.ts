// The spread-overflow helpers, guarded directly. Port of gas/test/util.test.ts.
//
// `Math.max(...arr)` and `target.push(...items)` make every element a CALL ARGUMENT, so both
// throw RangeError once the array is large. `maxNum`, `minNum` and `pushAll` exist solely to
// fold instead of spread, and each carries a comment in util.ts saying so.
//
// THIS FILE USED TO ALSO FIRE ON NOTHING, at N=200_000. That N was measured correctly (main
// thread, node 22/x64: Math.max(...) throws at 125,276, push(...) at 125,269) but against the
// wrong runtime: vitest.config.ts's `pool: "threads"` runs every test in a real worker_thread,
// and a worker's default V8 stack tolerates a far larger argument spread than the main
// thread's. Reintroducing the literal spread and rerunning THIS file at the old N=200_000
// produced a clean pass — no RangeError, no timeout — because 200,000 never got close to the
// limit in the pool these tests actually execute in. `remediation.test.ts`'s two N=200,000
// end-to-end cases have the same property; see the comments there.
//
// RE-MEASURED IN THIS SUITE'S OWN POOL, not a standalone script (a standalone script is how
// the 125,275 main-thread figure above was obtained the first time, and it answers a question
// about a runtime these tests don't run in). A temporary vitest test, deleted after use, ran a
// bare `Math.max(...new Array(n).fill(1))` and `target.push(...arr)` inside `pool: "threads"`
// at candidate sizes, then binary-searched the exact edge:
//
//   clean:   100_000 / 200_000 / 400_000 / 490_000
//   throws:  500_000 / 510_000 / 600_000 / 700_000 / 1_000_000
//   exact boundary: 498_320 clean, 498_321 throws (RangeError)
//
// Identical under `isolate:false` (the default `pure` project) and `isolate:true`
// (`GAS_TEST_FULL_ISOLATION=1`), and identical in `gas`'s copy of this same probe — same
// engine, same pool, same number.
//
// N = 2_000_000 below, roughly 4x that measured boundary. A 20% margin is not defensible: V8's
// stack tolerance is a function of the engine, the OS and the call site's own stack depth, not
// a fixed constant, and this repo's own history already produced one ~4x swing on exactly this
// number — main thread (125,275) to worker thread (498,320) is itself a factor of ~3.98. Sizing
// the margin to survive a second swing of the same magnitude, rather than to just clear the one
// measurement in hand, is the point; a number nearer 498,320 would calibrate to today's engine
// and risk silently testing nothing on the next one. The cost of the extra margin is real but
// small: measured directly, the two large-array cases below run in ~425ms and ~940ms (mostly
// building the 2,000,000-element input array — the fold/loop itself is a small fraction of
// that) — not the 13-29s `remediation.test.ts`'s end-to-end cases take, because these are
// plain number arrays.
//
// `remediation.test.ts`'s two 200k-row cases keep their place: they cover the estimator
// end-to-end at register scale, which this file does not, and a spread written INLINE on that
// path (rather than through these helpers) would only be caught there.

import { describe, expect, it } from "vitest";

import { field, maxNum, minNum, pushAll } from "../src/domain/util";

const N = 2_000_000;

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

// field() has no gas/ fixture in this package's copy list (D1's fixture set omits
// field.json), so it is guarded here directly rather than through fixture parity — enough to
// pin the two behaviors lifecycle.ts's findingKey and a future reconcile.ts port depend on:
// flat-key lookup and the vulnerableAsset unwrap.
describe("field — dotted-key lookup with vulnerableAsset unwrap", () => {
  it("reads a flattened dotted key directly", () => {
    expect(field({ "vulnerableAsset.name": "vm-b" }, "vulnerableAsset.name")).toBe("vm-b");
  });

  it("unwraps a nested vulnerableAsset object", () => {
    expect(field({ vulnerableAsset: { name: "vm-b" } }, "vulnerableAsset.name")).toBe("vm-b");
  });

  it("tries candidate keys in order and returns the first present one", () => {
    expect(field({ b: "second" }, "a", "b")).toBe("second");
  });

  it("returns empty string when nothing matches", () => {
    expect(field({}, "vulnerableAsset.name")).toBe("");
  });

  it("treats an empty string as absent, not present", () => {
    expect(field({ "vulnerableAsset.name": "" }, "vulnerableAsset.name")).toBe("");
  });
});
