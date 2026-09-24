// Executive & Program's surface claims after P3.4a: what left the surface, and what may
// never leave it. Sibling of `gas_devsecops/test/wordsOneLevelDown.test.js` and
// `figuresOverProse.test.js`, scoped to the two pages this package touched.
//
// THE SWEEP IS LOCATION-AWARE, NOT A BARE SUBSTRING CHECK. `view.cutNote` (say) is still a
// STRING literal in this file whether it renders on the surface or sits inside a closed
// `disclosure(...)` a reader has to open first — a plain `toContain` on the phrase cannot
// tell those two renders apart. `insideDisclosure` below does a real bracket walk so the
// perturbation at the bottom of this file is a measurement, not a restatement of the rule.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES = new URL("../src/client/js/pages/", import.meta.url);
const raw = (name) => readFileSync(new URL(`${name}.js`, PAGES), "utf8");

// Both pages' comments QUOTE the sentences a fate moved or deleted, so a raw-text sweep would
// find those phrases whether or not a reader can actually see them — hence sweeping CODE.

const EXECUTIVE = raw("executive");
const EXECUTIVE_CODE = code(EXECUTIVE);
const PROGRAM = raw("program");
const PROGRAM_CODE = code(PROGRAM);

/**
 * Whether `needle`'s first occurrence in `src` sits inside the span of some `disclosure(`
 * call — a real paren-depth walk rather than a regex, because `disclosure(`'s own summary
 * argument is prose that can itself carry parens. Returns `null` when `needle` is not found
 * at all, so a caller can tell "not there" from "there, on the surface" from "there, hidden".
 */
function insideDisclosure(src, needle) {
  const idx = src.indexOf(needle);
  if (idx === -1) return null;
  let searchFrom = 0;
  for (;;) {
    const dPos = src.indexOf("disclosure(", searchFrom);
    if (dPos === -1 || dPos >= idx) break;
    let depth = 1;
    let j = dPos + "disclosure(".length;
    while (j < src.length && depth > 0) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") depth--;
      j++;
    }
    if (idx < j) return true; // idx falls inside [dPos, matching close paren)
    searchFrom = dPos + 1;
  }
  return false;
}

/**
 * Whether ANY occurrence of `needle` sits inside a `disclosure(` span — `insideDisclosure`
 * answers only for the first.
 *
 * This exists because one field name can be rendered by more than one section. `view.cutNote`
 * is now two: Fix next's ("N more groups holding M findings are not shown") and the remediation
 * split's, which says the same kind of thing about the by-asset cap. Checking the first
 * occurrence alone would have let the second be quietly buried in a disclosure while this file
 * went on reporting the rule as held — the precise failure the bracket walk was written to stop,
 * reintroduced one section later.
 *
 * Returns `null` when the needle appears nowhere, like its sibling.
 */
function anyInsideDisclosure(src, needle) {
  // Every `disclosure(` call's span, by the same paren-depth walk as above.
  const spans = [];
  for (let d = src.indexOf("disclosure("); d !== -1; d = src.indexOf("disclosure(", d + 1)) {
    let depth = 1;
    let j = d + "disclosure(".length;
    while (j < src.length && depth > 0) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") depth--;
      j++;
    }
    spans.push([d, j]);
  }
  let found = false;
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    found = true;
    if (spans.some(([a, b]) => i > a && i < b)) return true;
  }
  return found ? false : null;
}

describe("insideDisclosure (the sweep function itself)", () => {
  it("finds a needle nested inside a disclosure( call", () => {
    const src = 'x.append(disclosure("Why", el("p", {}, view.cutNote)));';
    expect(insideDisclosure(src, "view.cutNote")).toBe(true);
  });

  it("does not flag a needle that sits before or after an unrelated disclosure(", () => {
    const src = 'x.append(el("p", {}, view.cutNote)); y.append(disclosure("Why", other));';
    expect(insideDisclosure(src, "view.cutNote")).toBe(false);
  });

  it("returns null when the needle is not in the source at all", () => {
    expect(insideDisclosure("nothing here", "view.cutNote")).toBeNull();
  });

  // The blind spot the every-occurrence walker exists to cover: one surface render followed by
  // one buried render reads as "on the surface" to the first-occurrence sweep.
  it("insideDisclosure sees only the first occurrence — anyInsideDisclosure sees both", () => {
    const src = 'a.append(el("p", {}, view.cutNote));'
      + ' b.append(disclosure("Why", el("p", {}, view.cutNote)));';
    expect(insideDisclosure(src, "view.cutNote")).toBe(false);
    expect(anyInsideDisclosure(src, "view.cutNote")).toBe(true);
  });

  it("anyInsideDisclosure agrees when every occurrence is on the surface", () => {
    const src = 'a.append(el("p", {}, view.cutNote)); b.append(el("p", {}, view.cutNote));';
    expect(anyInsideDisclosure(src, "view.cutNote")).toBe(false);
  });

  it("anyInsideDisclosure returns null for a needle that is not there", () => {
    expect(anyInsideDisclosure("nothing here", "view.cutNote")).toBeNull();
  });
});

// =========================================================================================
//  executive.js
// =========================================================================================

describe("executive — the population line's short form is on the surface, its reason is a tip",
  () => {
    it("renderSeverity prints view.populationLine unconditionally", () => {
      const fn = EXECUTIVE_CODE.slice(EXECUTIVE_CODE.indexOf("function renderSeverity("));
      expect(fn).toMatch(/view\.populationExplain\s*\n?\s*\?\s*tipLabel\(view\.populationLine/);
      // Both branches of the ternary print `view.populationLine` — the short form is on the
      // surface whether or not there is anything to explain.
      expect(fn).toContain(": view.populationLine");
    });

    it("puts the population gap's REASON on a tipLabel, not a second surface sentence", () => {
      const fn = EXECUTIVE_CODE.slice(EXECUTIVE_CODE.indexOf("function renderSeverity("));
      expect(fn).toMatch(/tipLabel\(view\.populationLine, \{ lines: view\.populationExplain \}\)/);
      // The old two-sentence paragraph is gone: nothing in this function still glues the
      // explanation onto the same string the surface prints.
      expect(fn).not.toContain("a severity gate always keeps findings graded UNKNOWN");
    });
  });

describe("executive — linkNote moved off the surface, onto the Fix next heading's own tip",
  () => {
    it("no longer prints linkNote as its own surface paragraph", () => {
      expect(EXECUTIVE_CODE).not.toMatch(/el\("p", \{ class: "small muted" \}, view\.linkNote\)/);
    });

    it("still says what it said, on the Fix next heading's tip lines", () => {
      const fn = EXECUTIVE_CODE.slice(EXECUTIVE_CODE.indexOf("function renderFixNext("));
      expect(fn).toMatch(/lines:\s*\[\.\.\.\(fixNextEntry \? fixNextEntry\.lines : \[\]\),\s*view\.linkNote\]/);
      // `view.linkNote` itself is unchanged — findEntry("fix-next") is a REAL lookup, not a
      // fallback that quietly drops the book's own two lines when it succeeds.
      expect(fn).toContain('findEntry("fix-next")');
    });
  });

describe("executive — cutNote, exposureNote and rankedShort MAY NEVER LEAVE THE SURFACE", () => {
  // EVERY occurrence, not the first. `cutNote` is rendered twice now — Fix next's cap and the
  // remediation split's by-asset cap — and a rule that only inspected the first would have gone
  // on passing while the second was buried.
  for (const field of ["cutNote", "exposureNote", "rankedShort"]) {
    it(`view.${field} is not nested inside any disclosure(`, () => {
      expect(anyInsideDisclosure(EXECUTIVE_CODE, "view." + field)).toBe(false);
    });
  }

  it("cutNote and exposureNote both still print as their own <p>, when present", () => {
    expect(EXECUTIVE_CODE).toContain('el("p", { class: "small muted" }, view.cutNote)');
    expect(EXECUTIVE_CODE).toContain('el("p", { class: "small muted" }, view.exposureNote)');
  });

  // Both renders of it, so a future edit that keeps Fix next's and drops the split's — or
  // reshapes one into something a reader has to open — fails here rather than on the page.
  it("renders cutNote on both surfaces that have a cap to confess", () => {
    expect((EXECUTIVE_CODE.match(/view\.cutNote/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const split = EXECUTIVE_CODE.slice(EXECUTIVE_CODE.indexOf("function renderByDomain("));
    expect(split).toContain('el("p", { class: "small muted" }, view.cutNote)');
  });

  it("rankedShort still prints, on the Act now figure's caption", () => {
    // The folded full list and its accounting disclosure are gone; the page keeps a three-row
    // Fix first table, so the "N of M open findings ranked" denominator rides on the figure
    // that counts the ranked groups.
    const fn = EXECUTIVE_CODE.slice(EXECUTIVE_CODE.indexOf("function actFigure("));
    expect(fn).toMatch(/caption: legend\.join\(" · "\) \+ "\. " \+ view\.rankedShort \+ "\.",/);
  });
});

describe("executive — the by-domain footnote is gone; the column heading's own tip says it now",
  () => {
    it("no longer draws the Lower bound footnote paragraph", () => {
      expect(EXECUTIVE_CODE).not.toMatch(/tipLabel\("Lower bound", \{ term: "lower-bound" \}\)/);
    });

    it("the KM-median column's own heading tip still states what a dash means", () => {
      const fn = EXECUTIVE_CODE.slice(EXECUTIVE_CODE.indexOf("function renderByDomain("));
      expect(fn).toMatch(/curve never falls to half/);
    });
  });

// =========================================================================================
//  program.js
// =========================================================================================

describe("program — renderHero draws the shared briefing, not a local .hero block", () => {
  it("builds its figures through the shared briefing primitives (DESIGN.md §6c)", () => {
    const fn = PROGRAM_CODE.slice(
      PROGRAM_CODE.indexOf("function renderHero("),
      PROGRAM_CODE.indexOf("function renderMatrix("),
    );
    expect(fn).toMatch(/briefFigures\(/);
    // Coverage and efficiency stay published together, each with its bounds drawn.
    expect((fn.match(/boundedTrack\(\{/g) || []).length).toBe(2);
    expect(fn).toMatch(/reference: view\.prevalence/);
  });

  it("passes NO route — the h1 lives in the title block renderProgram appends once", () => {
    const fn = PROGRAM_CODE.slice(
      PROGRAM_CODE.indexOf("function renderHero("),
      PROGRAM_CODE.indexOf("function renderMatrix("),
    );
    expect(fn).not.toMatch(/pageHeader\(\{\s*\n?\s*route:/);
  });

  it("carries no local .hero* class literal anywhere in the file any more", () => {
    for (const cls of ['"hero"', '"hero-minis"', '"hero-src"', '"hero-value"']) {
      expect(PROGRAM_CODE, `still has class: ${cls}`).not.toContain("class: " + cls);
    }
  });

  it("still prints the coverage bound on the surface, as the Coverage figure's caption", () => {
    // It was a separate `denomNote(rateSub(covRate))` paragraph under the hero; the briefing's
    // Coverage figure now prints the same sentence as its caption, so the paragraph would say
    // it twice. Still on the surface, never only in a tip or a disclosure.
    const fn = PROGRAM_CODE.slice(
      PROGRAM_CODE.indexOf("function renderHero("),
      PROGRAM_CODE.indexOf("function renderMatrix("),
    );
    expect(fn).toContain("caption: rateSub(covRate),");
    expect(insideDisclosure(fn, "caption: rateSub(covRate)")).toBe(false);
    expect(fn).not.toContain("denomNote(rateSub(covRate))");
  });

  it("still prints the classified-count / no-signal population line as the hero's qualifier",
    () => {
      const fn = PROGRAM_CODE.slice(
        PROGRAM_CODE.indexOf("function renderHero("),
        PROGRAM_CODE.indexOf("function renderMatrix("),
      );
      expect(fn).toContain("with no captured exploit signal");
    });
});

// =========================================================================================
//  PERTURBATION — the sweep actually bites
// =========================================================================================
//
// The tempting "one level down" rewrite is to fold an honesty statement into a disclosure
// alongside the accounting it sits near — cutNote reads like part of the same story as
// unrankedSentence, and both COULD live under "Why the rest are not ranked". They must not:
// a cap on the list, or a tier that could not be measured at all, is a fact a reader needs
// without opening anything. Reproduced here and run through the SAME sweep this file uses
// above, so "the guard fires" is a measurement rather than a restatement of the rule.

describe("PERTURBATION: honesty moved into a disclosure fails the surface sweep", () => {
  it("catches cutNote wrapped in a disclosure(", () => {
    const defective = `
      fixHost.append(el("p", { class: "small muted" }, view.rankedShort));
      fixHost.append(disclosure(
        "Why the rest are not ranked",
        el("p", { class: "small muted" }, view.unrankedSentence),
        view.cutNote ? el("p", { class: "small muted" }, view.cutNote) : null,
      ));
    `;
    // The real page's own check (used above) would report this as hidden — proving the
    // sweep actually distinguishes the two renders rather than passing on both.
    expect(insideDisclosure(defective, "view.cutNote")).toBe(true);
  });

  it("does NOT flag the real page's own renders of cutNote", () => {
    expect(anyInsideDisclosure(EXECUTIVE_CODE, "view.cutNote")).toBe(false);
  });

  // The same perturbation one section over: the split's bound is the tempting one to fold away,
  // because the section already carries an awaiting-vendor-fix footnote and a second grey line
  // under a table looks like clutter. It is not clutter — without it the table reads as the
  // whole estate.
  it("catches the split's cut note wrapped in a disclosure(", () => {
    const defective = `
      byDomainHost.append(tableWrap);
      byDomainHost.append(disclosure(
        "About this table",
        el("p", { class: "small muted" }, view.cutNote),
      ));
    `;
    expect(anyInsideDisclosure(defective, "view.cutNote")).toBe(true);
  });
});
