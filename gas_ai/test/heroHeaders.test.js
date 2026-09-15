// Three hand-rolled heroes take the shared header (P2.4). Inventory's `.inv-hero`, the
// framework register's and the overview's `.comp-hero-value`/`.comp-hero-sub`, and Wiz Scans'
// `.cov-header`/`.cov-hero` block were each a page reinventing `pageHeader({hero, aside,
// stats})` (`gas_shared/ui/controls.js`) byte-for-byte, or close to it — exactly what config.js,
// combos.js and problems.js already draw with. This file is the sweep that keeps the retired
// shapes from quietly coming back, ported in spirit from `figures.test.js`'s own comment-
// stripped source guard.
//
// THE COMMENT-STRIPPED RULE COVERS EVERY CHECK BELOW, JS AND CSS ALIKE — including the "no
// `comp-hero` literal" check, so a comment explaining what USED to live somewhere (this file's
// own header, or the source files' own historical notes) never trips a sweep built to catch a
// live regression.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);
const STYLES_DIR = new URL("../src/client/styles/", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

function readPage(name) {
  return readFileSync(new URL(name, PAGES_DIR), "utf8");
}

function readStyle(name) {
  return readFileSync(new URL(name, STYLES_DIR), "utf8");
}

/**
 * CSS has no `//` line comments, so `code()` (built for JS/TS) is not the right stripper here
 * — it would treat a bare `//` inside a `url()` or a comment's own prose as the start of a
 * line comment and swallow real rules after it. This strips CSS's own block-comment form
 * instead, leaving every actual selector and declaration untouched.
 */
function cssCode(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

// =========================================================================================
//  1. the retired class literals — gone from the JS that used to hand-roll them
// =========================================================================================

/**
 * Every retired selector, keyed to the ONE file family it used to live in. `inv-hero` alone
 * (not `inv-header`, which several shared rules still legitimately name in prose) because that
 * is the div P2.4 deleted; `comp-hero-value`/`comp-hero-sub` are the pair `complianceHero()`
 * replaced; `cov-header`/`cov-hero` are Wiz Scans' own retired wrapper and hero div.
 */
const RETIRED_JS_LITERALS = ["inv-hero", "comp-hero-value", "comp-hero-sub", "cov-header", "cov-hero"];

describe("the retired hero/header class literals are gone from pages/*.js", () => {
  for (const file of pageFiles()) {
    it(`${file} declares none of ${RETIRED_JS_LITERALS.join(", ")}`, () => {
      const stripped = code(readPage(file));
      const hits = RETIRED_JS_LITERALS.filter((lit) => stripped.includes(lit));
      expect(hits, `${file} still carries: ${hits.join(", ")}`).toEqual([]);
    });
  }
});

// =========================================================================================
//  2. compliance.js and complianceOverview.js call the shared complianceHero()
// =========================================================================================

describe("compliance.js and complianceOverview.js draw the hero through complianceHero()", () => {
  const IMPORT_RE = /import\s*\{[^}]*\bcomplianceHero\b[^}]*}\s*from\s*["']\.\/complianceShared\.js["']/;

  for (const file of ["compliance.js", "complianceOverview.js"]) {
    it(`${file} imports complianceHero from ./complianceShared.js`, () => {
      const stripped = code(readPage(file));
      expect(IMPORT_RE.test(stripped)).toBe(true);
    });

    // Broader than the RETIRED_JS_LITERALS check above: no occurrence of the substring
    // "comp-hero" at all, not just the two retired class names — the wrapper this package
    // introduces for the severity mark (`.comp-posture-badge`) and the meter
    // (`.comp-posture-meter`) were named to clear this exact sweep, not merely the narrower
    // one above.
    it(`${file} declares no comp-hero literal at all`, () => {
      const stripped = code(readPage(file));
      expect(stripped.includes("comp-hero")).toBe(false);
    });
  }

  // PERTURBATION, named: a comp-hero literal reintroduced in LIVE code — a page-shaped
  // snippet run through the exact same comment-stripped check, not merely asserted from a
  // comment describing what it would do.
  it("the sweep catches a comp-hero literal reintroduced in live code", () => {
    const regressed = `
      import { complianceHero } from "./complianceShared.js";
      export function paint() {
        return el("div", { class: "comp-hero-value" }, "42%");
      }
    `;
    expect(code(regressed).includes("comp-hero")).toBe(true);
  });

  it("the sweep does not fire on a comment merely mentioning the retired name", () => {
    const commentOnly = `
      import { complianceHero } from "./complianceShared.js";
      // this file used to draw its own .comp-hero-value div by hand — see history
      export function paint() { return complianceHero({ label: "x" }); }
    `;
    expect(code(commentOnly).includes("comp-hero")).toBe(false);
  });
});

// =========================================================================================
//  3. the retired selectors are gone from the three page-local stylesheets
// =========================================================================================

/** Per-file retired selector substrings, and the reason each is scoped to its own sheet. */
const RETIRED_CSS = {
  // `.inv-hero` alone: `.inv-header` is a class this file's own comments still name in prose
  // (the shared grid it used to opt into), and the sweep only has to prove the HERO div —
  // and its two now-redundant full-width overrides — are gone.
  "inventory.css": ["inv-hero"],
  // The renamed-away pair plus the wrapper class itself; `.comp-posture-meter` (the surviving
  // rename) and `.comp-posture-badge` (the new severity-mark hook) are asserted PRESENT below,
  // not absent, so this list only names what left.
  "compliance.css": ["comp-hero-value", "comp-hero-sub", "comp-header"],
  "scans.css": ["cov-header", "cov-hero"],
};

describe("the retired header selectors are gone from their page-local stylesheet", () => {
  for (const [file, literals] of Object.entries(RETIRED_CSS)) {
    it(`${file} carries none of ${literals.join(", ")}`, () => {
      const stripped = cssCode(readStyle(file));
      const hits = literals.filter((lit) => stripped.includes(lit));
      expect(hits, `${file} still carries: ${hits.join(", ")}`).toEqual([]);
    });
  }
});

describe("the posture-tier band tints survive the rename to .comp-posture-meter", () => {
  it("compliance.css still bands all four tiers under the renamed hook", () => {
    const stripped = cssCode(readStyle("compliance.css"));
    for (const band of ["strong", "fair", "poor", "weak"]) {
      expect(stripped).toContain(`.comp-posture-meter .meter-fill[data-band="${band}"]`);
    }
    // The hue-neutral edge rule (LENGTH survives tier 2) is the fifth reference to the hook —
    // dropping it silently would leave the meter's fill readable but its boundary gone.
    expect(stripped).toContain(".comp-posture-meter .meter-fill[data-band]");
  });

  it("the severity-mark wrapper carries its margin/vertical-align rule", () => {
    const stripped = cssCode(readStyle("compliance.css"));
    expect(stripped).toContain(".comp-posture-badge .sev-badge");
  });
});

// =========================================================================================
//  4. every heroStat( value argument in the three pages is a refused figure, never a bare cast
// =========================================================================================

/**
 * Balanced-paren extraction of every top-level `heroStat(...)` call's raw argument text — a
 * plain `indexOf` + depth counter, the same class of tool `figures.test.js`'s own sweeps use,
 * because these calls nest other calls (`fmtCount(...)`, template literals) that a naive regex
 * would stop at the first inner `)`.
 */
function extractCalls(src, name) {
  const marker = `${name}(`;
  const calls = [];
  let i = 0;
  while (true) {
    const at = src.indexOf(marker, i);
    if (at === -1) break;
    let depth = 1;
    let j = at + marker.length;
    while (j < src.length && depth > 0) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") depth--;
      j++;
    }
    calls.push(src.slice(at + marker.length, j - 1));
    i = j;
  }
  return calls;
}

/**
 * The exact defective shape CLAUDE.md's working discipline names: a scalar the server sends
 * once, cast with `Number(null) || 0`'s String-wrapped cousin, PRINTING a confident "0" for a
 * figure nobody measured. `heroStat`'s own null branch already draws the em dash for free —
 * this is the rewrite that throws that away.
 */
const STRING_CAST_RE = /String\([^)]*(\?\?|\|\|)\s*0[^)]*\)/;

function heroStatViolations(src) {
  return extractCalls(src, "heroStat").filter((call) => STRING_CAST_RE.test(call));
}

describe("heroStat( value arguments never String(x ?? 0) / String(x || 0) a figure", () => {
  // complianceShared.js, not compliance.js/complianceOverview.js — the literal `heroStat(`
  // call for the compliance pages now lives inside `complianceHero()`, one function, for both.
  const FILES = ["inventory.js", "scans.js", "complianceShared.js"];

  for (const file of FILES) {
    it(`${file} carries no String(x ?? 0) / String(x || 0) heroStat value`, () => {
      const stripped = code(readPage(file));
      const hits = heroStatViolations(stripped);
      expect(hits, `${file} heroStat() call(s) with a cast-first value: ${hits.join(" | ")}`)
        .toEqual([]);
    });
  }

  // PERTURBATION, named: the sweep's own extractor, run against a string reproducing the
  // exact defective rewrite, has to find it — not merely assert the regex from a comment.
  it("the sweep catches a String(kpis.aiAssets ?? 0) heroStat value", () => {
    const regressed = `
      host.append(pageHeader({
        hero: heroStat("AI assets", String(kpis.aiAssets ?? 0), "agents"),
        stats: [],
      }));
    `;
    expect(heroStatViolations(regressed)).toHaveLength(1);
  });

  it("the sweep does not fire on a real, refused figure", () => {
    const clean = `
      hero: heroStat("AI assets", fmtCount(kpis.aiAssets), "agents"),
      hero2: heroStat("Reporting", tally.live + " of " + resolved.length, "areas"),
    `;
    expect(heroStatViolations(clean)).toEqual([]);
  });
});
