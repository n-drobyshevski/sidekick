// The register vocabulary's numeric core, and the one guard that stops it drifting back into
// `pages/*.js`. Ported from gas_devsecops/test/figures.test.js — see P1.1's brief for why: this
// register's own pages carried the identical class of defect, in five different shapes.
//
// THE DEFECTS THIS FILE PINS, all found in this app's own `pages/*.js` before this package:
//
//   - `pages/mttr.js`'s `fmtKmMedian` printed "> X d" for a censored median. Heavy censoring
//     means the true median is AT LEAST that far out — an inclusive lower bound — and ">"
//     claims something stronger than the estimator showed. Fixed by porting
//     `kmHalfLifeView` (gas_devsecops/pages/mttr.js), which prints "at least X days".
//   - `pages/overview.js`'s `fmtAgeDays(n)` called `Math.round(n)` with NO null check at all —
//     a stale or hand-edited payload would print the unparseable "NaNd" rather than either a
//     confident zero or an honest absence.
//   - `pages/overview.js`'s `deltaChip(current, previous)` read `current` with a bare
//     subtraction (`current - previous`): `Number(null)` is 0, so a null `current` produced a
//     confident, signed "±N" chip rather than a refusal — CLAUDE.md's exact trap, reached from
//     the argument the original guard never checked.
//   - `pages/program.js`'s `pct`/`pct0`/`pct0Cell` and `pages/mttr.js`'s `fmtAwaiting` all
//     hand-typed their own "—" rather than the one shared spelling (`ui/figures.js`'s
//     `absentText`) — six spellings across three apps was the exact complaint that file's own
//     header opened with, and this app had not yet made the swap.
//
// `ui/figures.js` (gas_shared) is what every one of the fixes above is built on. This file
// measures the shared core directly (byte-identical assertions to gas_devsecops's own copy —
// there is only one implementation to measure) and then sweeps this app's OWN pages for a
// second copy of `num`/`fmtCount`/`fmtAgeDays`/`pct`, or a hand-typed dash, regressing back in.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { days1, fmtCount, num, pct1 } from "../../gas_shared/ui/figures.js";
import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

describe("num() refuses null/undefined/blank BEFORE the cast", () => {
  // Number(""), Number(null), Number(undefined), Number([]) and Number(false) are all 0 and
  // all finite — the exact set that let a `Number(v) || 0`-shaped rewrite render an absent
  // figure as "0". Each gets its own `it` so a regression names which input broke, rather than
  // a single `it.each` failure requiring a second look to see which case tripped.
  it("num(\"\") is null, not 0", () => {
    expect(num("")).toBeNull();
  });
  it("num(null) is null, not 0", () => {
    expect(num(null)).toBeNull();
  });
  it("num(undefined) is null, not 0", () => {
    expect(num(undefined)).toBeNull();
  });
  it("num([]) is null, not 0", () => {
    expect(num([])).toBeNull();
  });
  it("num(false) is null, not 0", () => {
    expect(num(false)).toBeNull();
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

// ------------------------------------------------------------------------- the source guard

/**
 * A page-shaped snippet reproducing the EXACT defective rewrite this file's header describes —
 * cast before refusing, so `Number(v) || 0` swallows every falsy-but-absent input into a
 * confident zero. Not a real file: a string handed to the same sweep function the real pages
 * are swept with, so the perturbation proves the sweep bites on the shape it exists to catch
 * rather than merely on the literal text "function num(".
 */
const DEFECTIVE_NUM_REWRITE = `
  // a page-shaped local reimplementation of the numeric core
  function num(v) {
    return Number(v) || 0;
  }
  export function renderThing(x) {
    return num(x.count);
  }
`;

/**
 * The two-part guard: no page under `src/client/js/pages/` may declare its own copy of the
 * numeric core's names, and none may hand-type the one dash `absentText` already owns — in
 * either case, comment-stripped first (`gas_shared/test/contracts/emptyStates.js`'s `code()`,
 * the same stripper `measure.mjs` and every other sweep in this tree reads through), so this
 * file's own doc comments — which quote every one of the forbidden patterns on purpose, to
 * explain what they used to look like — never trip their own guard.
 *
 * @param {string} src        already comment/string-boundary-aware source (or raw source; the
 *                             function strips it itself)
 * @returns {string[]}        the forbidden patterns found, empty when clean
 */
function forbiddenPatterns(src) {
  const stripped = code(src);
  const hits = [];
  if (/\bfunction num\(/.test(stripped)) hits.push("function num(");
  if (/\bfunction fmtCount\(/.test(stripped)) hits.push("function fmtCount(");
  if (/\bfunction fmtAgeDays\(/.test(stripped)) hits.push("function fmtAgeDays(");
  if (/\bfunction pct\(/.test(stripped)) hits.push("function pct(");
  if (/"—"|'—'/.test(stripped)) hits.push('a hand-typed "—" string literal');
  return hits;
}

/**
 * Pre-existing, OUT-OF-SCOPE hand-typed dashes no package has swept yet.
 * `pages/data.js`'s three (`${ep.oldest ? … : "—"}`, and its two siblings) were fixed by
 * P1.3 — the compaction-preview sentences now take `absentText` like everything else in this
 * file, so `data.js` carries no entry here any more, and a future dash in that file has
 * nothing to hide behind. `pages/settings.js` is a different package's file (P1.3's brief:
 * "leave settings.js's two" — MEASURED at one, not two, when this package actually counted;
 * the discrepancy is recorded here rather than silently corrected on another package's file),
 * so its one remaining dash stays allowlisted. Named here rather than silently exempted: an
 * allowlist that does not say WHY is indistinguishable from a sweep nobody trusts, and an
 * allowlist with no expected count would stop noticing a SECOND dash added to the same file.
 * `count` is the exact number of `"—"`/`'—'` occurrences `code()`-stripped source carries
 * today; a file dropping below its count is fine (progress), a file exceeding it fails, same
 * as an unlisted file would.
 */
const DASH_ALLOWLIST = new Map([
  ["settings.js", 1], // the risk-backfill preview's `Floor: ${preview.floor_ts ?? "—"}`
]);

function countDashLiterals(strippedSrc) {
  const matches = strippedSrc.match(/"—"|'—'/g);
  return matches ? matches.length : 0;
}

describe("no page file declares its own num()/fmtCount()/fmtAgeDays()/pct() again", () => {
  it("grep-equivalent, comment-stripped: none of src/client/js/pages/*.js redeclares the shared numeric core's names", () => {
    for (const file of pageFiles()) {
      const src = readFileSync(new URL(file, PAGES_DIR), "utf8");
      const stripped = code(src);
      expect(stripped, `${file} declares its own num()`).not.toMatch(/\bfunction num\(/);
      expect(stripped, `${file} declares its own fmtCount()`).not.toMatch(/\bfunction fmtCount\(/);
      expect(stripped, `${file} declares its own fmtAgeDays()`)
        .not.toMatch(/\bfunction fmtAgeDays\(/);
      expect(stripped, `${file} declares its own pct()`).not.toMatch(/\bfunction pct\(/);
    }
  });

  it("no page hand-types the em dash outside the documented allowlist", () => {
    for (const file of pageFiles()) {
      const src = readFileSync(new URL(file, PAGES_DIR), "utf8");
      const stripped = code(src);
      const found = countDashLiterals(stripped);
      const allowed = DASH_ALLOWLIST.get(file) ?? 0;
      expect(found, `${file} carries ${found} hand-typed "—" literal(s); ` +
        `${allowed} allowlisted (see DASH_ALLOWLIST) — either fix it or update the allowlist ` +
        "with a reason").toBe(allowed);
    }
  });

  // PERTURBATION: the tempting cast-before-refuse rewrite, run through the SAME sweep function
  // the real files go through — not asserted from a comment, reproduced and shown failing.
  it("the sweep catches the defective num() rewrite it exists to prevent", () => {
    const hits = forbiddenPatterns(DEFECTIVE_NUM_REWRITE);
    expect(hits).toContain("function num(");
  });

  it("the sweep's stripper does not fire on a comment merely mentioning the forbidden names", () => {
    const commentOnly = `
      // this file used to declare function num(v) { return Number(v) || 0; } — see history
      export function render() { return "fine"; }
    `;
    expect(forbiddenPatterns(commentOnly)).toEqual([]);
  });
});
