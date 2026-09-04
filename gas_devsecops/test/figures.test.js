// The register vocabulary's numeric core, and the one guard that stops it drifting back into
// `pages/*.js`.
//
// THE DEFECT THIS FILE PINS. `pages/sca.js` used to define `num(v, fallback = 0)` as
// `Number.isFinite(Number(v)) ? Number(v) : fallback` — casting BEFORE refusing null. Because
// `Number(null)`, `Number(undefined)`, `Number("")`, `Number([])` and `Number(false)` are all
// `0` and all finite, none of those inputs ever reached the fallback branch: every genuinely
// unmeasured SCA figure rendered as a confident `0` rather than the em dash. `sast.js` and
// `secrets.js` imported the same broken pair, so the defect was three pages wide.
// `ui/figures.js` is the fix — refuse null/undefined/blank BEFORE the cast — and this file
// measures it directly rather than trusting the description.
//
// THE SOURCE-TEXT GUARD is what stops the fix regressing: nothing under `src/client/js/pages/`
// may declare its own `num`/`fmtCount` again, or a future page could reintroduce exactly this
// bug one file over from the one that already suffered it.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { days1, fmtCount, num, pct1 } from "../src/client/js/ui/figures.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

describe("num() refuses null/undefined/blank BEFORE the cast", () => {
  // Number(""), Number(null), Number(undefined), Number([]) and Number(false) are all 0 and
  // all finite — the exact set that made the old sca.js `num` render an absent figure as "0".
  it.each([
    ["", ""],
    ["null", null],
    ["undefined", undefined],
    ["[] (empty array)", []],
    ["false", false],
  ])("num(%s) is null, not 0", (_label, input) => {
    expect(num(input)).toBeNull();
  });

  it("num(\"3\") casts a real numeric string", () => {
    expect(num("3")).toBe(3);
  });

  it("num(3) passes a real number through unchanged", () => {
    expect(num(3)).toBe(3);
  });

  it("num(NaN-producing string) falls back too, since it truly is not a number", () => {
    expect(num("not-a-number")).toBeNull();
  });

  it("an explicit fallback is honoured for the arithmetic call sites that ask for one", () => {
    expect(num(null, 0)).toBe(0);
    expect(num(undefined, 0)).toBe(0);
  });
});

describe("the formatters built on num() — null renders as the em dash, never 0", () => {
  it("fmtCount(null) is the em dash", () => {
    expect(fmtCount(null)).toBe("—");
  });

  it("fmtCount(0) is a real, measured zero", () => {
    expect(fmtCount(0)).toBe("0");
  });

  it("fmtCount groups a real count", () => {
    expect(fmtCount(12345)).toBe("12,345");
  });

  it("days1(null) is the em dash", () => {
    expect(days1(null)).toBe("—");
  });

  it("days1 prints one decimal and the unit letter", () => {
    expect(days1(41)).toBe("41.0 d");
  });

  it("pct1(null) is the em dash", () => {
    expect(pct1(null)).toBe("—");
  });

  it("pct1 prints one decimal and the percent sign, including a real zero", () => {
    expect(pct1(0)).toBe("0.0%");
    expect(pct1(12.34)).toBe("12.3%");
  });
});

describe("no page file declares its own num()/fmtCount() again", () => {
  it("grep-equivalent: none of src/client/js/pages/*.js declares `function num(` or `function fmtCount(`", () => {
    for (const file of pageFiles()) {
      const src = readFileSync(new URL(file, PAGES_DIR), "utf8");
      expect(src, `${file} declares its own num()`).not.toMatch(/\bfunction num\(/);
      expect(src, `${file} declares its own fmtCount()`).not.toMatch(/\bfunction fmtCount\(/);
    }
  });
});
