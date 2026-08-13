// The local half of util.ts — the helpers the domain layer was re-deriving.
//
// The parity half (present/clean/parseTs/toIso/…) mirrors wiz_dashboard/domain and is
// covered through the modules that use it; these have no Python twin and no other cover.

import { describe, expect, it } from "vitest";
import {
  clampInt, cmp, cmpBy, groupBy, indexBy, minIso, pushInto, tally, toNum, toStr,
} from "../src/domain/util";

describe("toStr / toNum declare one miss value", () => {
  it("maps only null and undefined to the fallback", () => {
    expect(toStr(null)).toBe("");
    expect(toStr(undefined)).toBe("");
    expect(toStr(0)).toBe("0");      // not missing
    expect(toStr(false)).toBe("false");
    expect(toStr("")).toBe("");
    expect(toStr(null, "—")).toBe("—");
  });

  it("rejects anything that isn't a finite number", () => {
    expect(toNum("42")).toBe(42);
    expect(toNum("")).toBe(0);       // Number("") is 0, but so is the fallback
    expect(toNum("abc")).toBe(0);
    expect(toNum(NaN)).toBe(0);
    expect(toNum(Infinity)).toBe(0);
    expect(toNum(undefined, -1)).toBe(-1);
  });

  it("is safe to reference but not to pass straight to map", () => {
    // `.map(toStr)` would feed the array index into `fallback`. The types reject it now;
    // this records why the call sites wrap it.
    expect([null, "a"].map((v) => toStr(v))).toEqual(["", "a"]);
  });
});

describe("clampInt", () => {
  it("rounds, then clamps", () => {
    expect(clampInt(2.6, 1, 1, 3)).toBe(3);
    expect(clampInt(99, 1, 1, 3)).toBe(3);
    expect(clampInt(-5, 1, 1, 3)).toBe(1);
  });

  it("falls back for anything unparseable, rather than clamping NaN to the floor", () => {
    // The distinction that matters: a bad value gets the DEFAULT, not the minimum.
    expect(clampInt("nonsense", 2, 1, 3)).toBe(2);
    expect(clampInt(undefined, 2, 1, 3)).toBe(2);
  });

  it("treats null as 0 and clamps it, because Number(null) is 0", () => {
    // Not the fallback — `null` is finite once coerced, so it clamps to the floor. This
    // is the behaviour all three previous copies had, kept deliberately: the callers pass
    // `settings[k] ?? DEFAULT`, so null is resolved before it ever reaches here.
    expect(clampInt(null, 2, 1, 3)).toBe(1);
  });
});

describe("cmp / cmpBy", () => {
  it("orders and reports ties", () => {
    expect(cmp("a", "b")).toBe(-1);
    expect(cmp("b", "a")).toBe(1);
    expect(cmp("a", "a")).toBe(0);
  });

  it("chains with || for tie-breaks", () => {
    const rows = [
      { sev: 1, name: "b" }, { sev: 0, name: "z" }, { sev: 1, name: "a" },
    ];
    rows.sort((a, b) => cmpBy((r: typeof a) => r.sev)(a, b) || cmpBy((r: typeof a) => r.name)(a, b));
    expect(rows.map((r) => r.name)).toEqual(["z", "a", "b"]);
  });
});

describe("indexBy / groupBy / pushInto / tally", () => {
  it("indexBy keeps the last on a duplicate key, like the Map form it replaces", () => {
    const xs = [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "a", n: 3 }];
    expect(indexBy(xs, (x) => x.id).get("a")).toEqual({ id: "a", n: 3 });
  });

  it("groupBy preserves input order inside each bucket", () => {
    const g = groupBy([1, 2, 3, 4, 5], (n) => n % 2);
    expect(g.get(1)).toEqual([1, 3, 5]);
    expect(g.get(0)).toEqual([2, 4]);
  });

  it("pushInto creates the bucket on first use and appends after", () => {
    const m = new Map<string, number[]>();
    pushInto(m, "k", 1);
    pushInto(m, "k", 2, 3);
    expect(m.get("k")).toEqual([1, 2, 3]);
  });

  it("tally counts from absent", () => {
    const c = new Map<string, number>();
    tally(c, "x");
    tally(c, "x");
    tally(c, "y", 5);
    expect([...c]).toEqual([["x", 2], ["y", 5]]);
  });
});

describe("minIso folds rather than spreading", () => {
  it("finds the earliest", () => {
    expect(minIso("2026-08-13T10:00:00Z", "2026-08-12T10:00:00Z")).toBe("2026-08-12T10:00:00Z");
  });

  it("ignores unparseable values, and answers null when none parse", () => {
    expect(minIso("nope", "2026-08-12T10:00:00Z")).toBe("2026-08-12T10:00:00Z");
    expect(minIso("nope", null, undefined)).toBeNull();
    expect(minIso()).toBeNull();
  });

  it("survives an argument list long enough to blow the spread form", () => {
    // Math.min(...arr) throws RangeError somewhere around 100k-200k arguments depending
    // on the engine. This is the regression the sibling tool hit at scale.
    const many = Array.from({ length: 200_000 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString());
    expect(() => minIso(...many)).not.toThrow();
    expect(minIso(...many)).toBe("2026-01-01T00:00:00Z");
  });
});
