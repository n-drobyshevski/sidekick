// The pure half of what Wave B took OUT of sentences on the two register pages.
//
// Wave A did this for the front door and the clock; this is Dependencies and Code. Four
// prose mechanisms went: a five-column signal table whose last column was a READING (one
// sentence per row) with a denominator paragraph under each row, two hero-aside paragraphs
// that restated the glossary entry already carried by the page title, a rule sentence that
// restated the three rows of the table under it, and eleven `denomNote` paragraphs. Each
// swap moved a DECISION — which counts divide a population, what an absent signal means,
// which sentence survives a deletion — out of a paragraph and into a model or a tip, and a
// decision inside a picture is the kind a screenshot review passes and a reader is misled by.
//
// NO DOM (vitest.config.ts sets no `environment`), the house style here: every claim below is
// either a pure function on the page module or an assertion against the page's source text,
// the way `pagesLit.test.js`, `mttrAging.test.js` and `figuresOverProse.test.js` already do.
//
// EVERY GUARD IS PERTURBED. CLAUDE.md: "a guard that fires on nothing is a finding, not a
// pass" — so each describe reproduces the tempting rewrite INLINE and shows it giving a
// different, wrong answer on the same input.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { axisSegments } from "../../gas_shared/ui/axisBar.js";
import { figureCardModel } from "../../gas_shared/ui/figures.js";
import { findEntry } from "../src/client/js/helpContent.js";
import {
  SIGNAL_EVALUATED, SIGNAL_NEVER_EVALUATED, SIGNAL_NO_COLUMN, agingSurfaceNote, kevCaveatLine,
  kevColumnHelp, signalFigure, signalReading,
} from "../src/client/js/pages/sca.js";
import { SAST_RULE_SENTENCE, sastModel } from "../src/client/js/pages/sast.js";

const SCA_SRC = readFileSync(new URL("../src/client/js/pages/sca.js", import.meta.url), "utf8");
const SAST_SRC = readFileSync(new URL("../src/client/js/pages/sast.js", import.meta.url), "utf8");

/** Comments stripped — string-aware. Copied from `test/pagesLit.test.js`'s `code()`, for the
 *  reason that file gives: the prose below NAMES the paragraphs it says are gone. */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
    i++;
  }
  return out;
}
const SCA_CODE = code(SCA_SRC);
const SAST_CODE = code(SAST_SRC);

/** A payload's worth of signal coverage, in `coverageOf`'s own arithmetic:
 *  `applicable + notApplicable === total` and `measured + missing === applicable`. */
function coverage({ measured, missing, notApplicable = 0 }) {
  const applicable = measured + missing;
  return {
    applicable,
    measured,
    missing,
    notApplicable,
    total: applicable + notApplicable,
    coveragePct: applicable > 0 ? (measured / applicable) * 100 : null,
  };
}

// =========================================================================================
//  1. signalReading — one population, three states, and the shares always close
// =========================================================================================

describe("signalReading: the three states of a signal as one division", () => {
  it("names each state with the word the legend prints, and counts it once", () => {
    const r = signalReading(signalFigure("has_kev", "CISA KEV", "sca",
      coverage({ measured: 78, missing: 12 })));
    expect(r.counts[SIGNAL_EVALUATED]).toBe(78);
    expect(r.counts[SIGNAL_NEVER_EVALUATED]).toBe(12);
    expect(r.total).toBe(90);
    // The three words ARE the legend: `axisBar` prints `value` verbatim beside each count.
    expect([SIGNAL_EVALUATED, SIGNAL_NEVER_EVALUATED, SIGNAL_NO_COLUMN])
      .toEqual(["evaluated", "never evaluated", "no such column"]);
  });

  it("drops the not-applicable segment where the register has no such rows, and draws it where it does", () => {
    // MEASURED, and it is a fact about these two pages: `signalCoverage`
    // (src/server/readModels.ts) is handed this register's OWN rows, so `notApplicable` — a
    // row of some other scope — is 0 by construction on sca and sast. The table this replaced
    // printed an em dash there on every row; a permanent zero-width segment carrying a legend
    // entry would be worse than the dash, not better.
    const none = signalReading(signalFigure("epss", "EPSS", "sca",
      coverage({ measured: 4, missing: 1 })));
    expect(none.values).toEqual([SIGNAL_EVALUATED, SIGNAL_NEVER_EVALUATED]);

    const mixed = signalReading(signalFigure("epss", "EPSS", "sca",
      coverage({ measured: 4, missing: 1, notApplicable: 5 })));
    expect(mixed.values).toEqual([SIGNAL_EVALUATED, SIGNAL_NEVER_EVALUATED, SIGNAL_NO_COLUMN]);
    expect(mixed.total).toBe(10);
    // …and it is the hatched one: a row with no such column was never measurABLE, which is
    // what `axisBar`'s hatch means everywhere it is used.
    expect(mixed.unknowns[SIGNAL_NO_COLUMN]).toBe(5);
  });

  it("closes: the shares axisSegments computes sum to exactly one", () => {
    const r = signalReading(signalFigure("has_exploit", "Known exploit", "sca",
      coverage({ measured: 61, missing: 17, notApplicable: 22 })));
    const seg = axisSegments(r, r.values);
    const sum = seg.segments.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(seg.segments.map((s) => s.count)).toEqual([61, 17, 22]);
    // The hatch covers the WHOLE of its own segment and none of any other.
    expect(seg.segments.map((s) => s.unknownShare)).toEqual([0, 0, 1]);
  });

  /**
   * PERTURBATION (run here, inline). `total` was read off the payload's own `total` field
   * instead of being summed from the three counts:
   *
   *   total: num(s.total, 0)
   *
   * On a well-formed payload the two are the same number, so nothing above would have moved.
   * On a payload whose `total` disagrees with its parts — the shape a server-side filter
   * change produces — the bar draws segments that stop short of (or overflow) its own track
   * while the legend prints "of N rows" for a different N. The sum is the only form that
   * cannot say two different things at once.
   */
  it("is not satisfied by trusting the payload's own total (perturbation, inline)", () => {
    const malformed = {
      ...coverage({ measured: 30, missing: 10 }),
      total: 400, // the payload disagrees with its own parts
    };
    const good = signalReading(signalFigure("has_kev", "CISA KEV", "sca", malformed));
    expect(good.total).toBe(40);
    expect(axisSegments(good, good.values).segments.reduce((a, s) => a + s.share, 0))
      .toBeCloseTo(1, 12);

    const perturbed = { ...good, total: malformed.total };
    const drawn = axisSegments(perturbed, perturbed.values)
      .segments.reduce((a, s) => a + s.share, 0);
    expect(drawn).toBeCloseTo(0.1, 12); // 40 of 400: nine tenths of the track left blank
  });

  it("survives a payload with nothing in it rather than dividing by it", () => {
    const empty = signalReading(signalFigure("has_kev", "CISA KEV", "sca", null));
    expect(empty.total).toBe(0);
    expect(empty.counts[SIGNAL_EVALUATED]).toBe(0);
    // `axisBar.paint` reads a zero total as "not measured yet" — the honest state, and the
    // one the page reaches by drawing no bar at all (`signalRow`'s applicable === 0 branch).
    expect(axisSegments(empty, empty.values).segments.every((s) => s.share === 0)).toBe(true);
  });
});

// =========================================================================================
//  2. The three vocabularies survive the table's deletion
// =========================================================================================

describe("the words a signal is reported in are still the three signalFigure chose", () => {
  it("keeps 'never evaluated' and 'no such column' as the counted states, not as absences", () => {
    const partial = signalFigure("has_kev", "CISA KEV", "sca", coverage({ measured: 78, missing: 12 }));
    expect(partial.state).toBe("partly-measured");
    expect(partial.verdict).toMatch(/unknown, not clean/);
    // The legend word and the cell word are the same claim in two lengths.
    expect(partial.cells.missing).toBe("12 never evaluated");
    expect(SIGNAL_NEVER_EVALUATED).toBe("never evaluated");
  });

  it("a register that evaluated nothing says so in words, not as a 0", () => {
    const none = signalFigure("ai_verdict", "AI triage verdict", "sast",
      coverage({ measured: 0, missing: 340 }));
    expect(none.state).toBe("unmeasured");
    expect(none.cells.measured).toBe("None evaluated");
    // …and the page draws that word beside the bar: the state pill, not the bar, is what
    // stops a 0%-filled track from reading as a measured absence.
    expect(SCA_CODE).toMatch(/unmeasured: \["warn", "None evaluated"\]/);
  });

  it("the page draws one bar per signal and no Reading column at all", () => {
    expect(SCA_CODE).toMatch(/signalRow\(s, \{ unit: "dependency findings" \}\)/);
    expect(SAST_CODE).toMatch(/signalRow\(vm\.aiVerdict, \{ unit: "code weaknesses" \}\)/);
    // The prose column, and the per-row paragraphs under it, are gone from both.
    expect(SCA_CODE).not.toMatch(/label: "Reading"/);
    expect(SCA_CODE).not.toMatch(/s\.denominator\}`\)/);
    expect(SCA_CODE).not.toMatch(/\bdenomNote\(/);
    expect(SAST_CODE).not.toMatch(/\bdenomNote\(/);
  });
});

// =========================================================================================
//  3. agingSurfaceNote — the count that may not leave the surface
// =========================================================================================

describe("agingSurfaceNote: the bucketed count, and the rows the bars could not hold", () => {
  it("prints both counts when some open rows have no readable age", () => {
    expect(agingSurfaceNote(90, 84)).toBe("84 open with a readable age · 6 undated");
  });

  it("prints one count when every open row is bucketed — no '· 0 undated'", () => {
    // A zero here IS a measurement, and it is stated by the absence of the clause rather
    // than by a zero: "0 undated" beside "90 open" is a second figure a reader has to
    // subtract to learn nothing.
    expect(agingSurfaceNote(90, 90)).toBe("90 open with a readable age");
  });

  it("floors the difference at zero rather than printing a negative population", () => {
    expect(agingSurfaceNote(5, 9)).toBe("9 open with a readable age");
  });

  /**
   * PERTURBATION (run here, inline). The two `num(v, 0)` refusals were replaced with the
   * tempting cast-first form:
   *
   *   const aged = Number(bucketed);
   *   const undated = Math.max(0, Number(open) - aged);
   *
   * CLAUDE.md's rule, for the fourth time in this repo: `Number(null)` is 0 and finite, and
   * `Number(undefined)` is NaN, which is the half that bites HERE — a payload that shipped no
   * `aging` block at all renders "— open with a readable age" and silently drops the undated
   * clause, i.e. an em dash where a zero was measured and no mention of the rows outside the
   * chart. `num` refuses by type before any cast, so both come out 0.
   */
  it("is not satisfied by casting first (perturbation, inline)", () => {
    expect(agingSurfaceNote(undefined, undefined)).toBe("0 open with a readable age");
    expect(agingSurfaceNote(10, undefined)).toBe("0 open with a readable age · 10 undated");

    const castFirst = (open, bucketed) => {
      const aged = Number(bucketed);
      const undated = Math.max(0, Number(open) - aged);
      return `${aged} open with a readable age${undated > 0 ? ` · ${undated} undated` : ""}`;
    };
    expect(castFirst(10, undefined)).toBe("NaN open with a readable age");
    expect(castFirst(undefined, undefined)).toBe("NaN open with a readable age");
  });

  it("is the caption both register pages draw, over the sentence that moved to the heading", () => {
    for (const src of [SCA_CODE, SAST_CODE]) {
      expect(src).toMatch(/agingSurfaceNote\(vm\.open, vm\.aging\.totalOpen\)/);
      expect(src).toMatch(/\{ denominator: vm\.aging\.denominator \}/);
    }
  });
});

// =========================================================================================
//  4. kevColumnHelp — an empty lines array is not "no lines"
// =========================================================================================

describe("kevColumnHelp: the KEV caveat, once, on the column heading", () => {
  const partial = [signalFigure("has_kev", "CISA KEV", "sca", coverage({ measured: 78, missing: 12 }))];
  const complete = [signalFigure("has_kev", "CISA KEV", "sca", coverage({ measured: 90, missing: 0 }))];

  it("carries the floor sentence where any row was never evaluated", () => {
    const help = kevColumnHelp(partial);
    expect(help.term).toBe("sca");
    expect(help.lines).toEqual([kevCaveatLine(partial)]);
    expect(help.lines[0]).toMatch(/KEV counts are a floor: 12 row\(s\)/);
    expect(help.lines[0]).toMatch(/unknown rather than absent from it/);
  });

  it("carries NO lines key at all where the register was fully evaluated", () => {
    expect(kevCaveatLine(complete)).toBeNull();
    expect(kevColumnHelp(complete)).toEqual({ term: "sca" });
  });

  /**
   * PERTURBATION (run here, inline). The call site's first draft was
   *
   *   help: { term: "sca", lines: [kevCaveatLine(vm.signals)].filter(Boolean) }
   *
   * which is the obvious spelling and is wrong in one specific way: `tipLabel` (ui/tip.js)
   * tests `help.lines` for TRUTHINESS, and `[]` is truthy — so a fully-evaluated register
   * would open a tip card with a term and nothing in it, on a column that has nothing to
   * caveat. The shape below is what `tipLabel` would branch on.
   */
  it("is not satisfied by filtering an array down to empty (perturbation, inline)", () => {
    const perturbed = { term: "sca", lines: [kevCaveatLine(complete)].filter(Boolean) };
    expect(perturbed.lines).toEqual([]);
    expect(Boolean(perturbed.lines)).toBe(true); // …which is why tipLabel would draw it
    expect(Boolean(kevColumnHelp(complete).lines)).toBe(false);
  });

  it("is drawn once per table rather than once under each breakdown", () => {
    // One CALL SITE — the column spec inside the breakdown loop — against the three
    // paragraphs the loop used to append, one per dimension.
    expect((SCA_CODE.match(/help: kevColumnHelp\(vm\.signals\)/g) || []).length).toBe(1);
    expect(SCA_CODE).not.toMatch(/kevCaveat\(vm\.signals\)/);
    // One sentence, one place: the paragraph form is still exported and now reads the same
    // string rather than a second copy of it.
    expect((SCA_CODE.match(/KEV counts are a floor/g) || []).length).toBe(1);
  });
});

// =========================================================================================
//  5. A DELETE is only legitimate if the claim survives somewhere
// =========================================================================================

describe("the two hero-aside paragraphs are gone, and the glossary still says what they said", () => {
  /**
   * THE ASIDE SLICE, NOT A PHRASE SWEEP, and the reason is a stripper defect worth recording.
   * The obvious assertion is `SCA_CODE` not matching "A CVE in a third-party package" — and
   * it FAILS on a correct page, because `code()` (this file's, `pagesLit.test.js`'s and
   * `pagesRegisters.test.js`'s alike) opens string mode on an APOSTROPHE inside a `//`
   * comment ("the page's PAGES title", sca.js:1195) and then swallows the following comment
   * lines as if they were a string — including the source comment that quotes the paragraph
   * it says was deleted. Measured here before this assertion was rewritten. So the claim is
   * asserted STRUCTURALLY instead: the header's aside slot holds the bar and its key and no
   * paragraph at all, which is the thing that was actually changed.
   */
  const asideSlice = (src) => src.slice(src.indexOf("aside: el("), src.indexOf("stats: "));

  it("sca: the aside slot holds no paragraph, and the term still carries both clauses", () => {
    const aside = asideSlice(SCA_SRC);
    expect(aside).toMatch(/sevSegmentBar\(heroSevs/);
    expect(aside).not.toMatch(/el\("p"/);
    expect(SCA_CODE).toMatch(/help: \{ term: "sca" \}/);
    const entry = findEntry("sca");
    expect(entry.lines.join(" ")).toMatch(/third-party package/);
    expect(entry.lines.join(" ")).toMatch(/cannot be fixed at all until a fixed version exists/);
  });

  it("sast: the same, for the register with no vendor", () => {
    const aside = asideSlice(SAST_SRC);
    expect(aside).toMatch(/sevSegmentBar\(heroSevs/);
    expect(aside).not.toMatch(/el\("p"/);
    expect(SAST_CODE).toMatch(/help: \{ term: "sast" \}/);
    const entry = findEntry("sast");
    expect(entry.lines.join(" ")).toMatch(/a file and line/);
    expect(entry.lines.join(" ")).toMatch(/no vendor to wait for/);
  });

  it("sast: the rule SENTENCE is no longer drawn, and the model still holds it", () => {
    // The three-row table under the heading lists the same three clauses with their counts;
    // the sentence added nothing but its quantifier, which is the heading's first tip line.
    expect(SAST_CODE).not.toMatch(/el\("p", \{\}, vm\.rule\.sentence\)/);
    expect(SAST_CODE).toMatch(/Any one clause is enough — they are not scored together\./);
    expect(sastModel({}).rule.sentence).toBe(SAST_RULE_SENTENCE);
    expect(SAST_RULE_SENTENCE).toMatch(/they are not scored together/);
  });

  it("the missing-columns sentence is still written by missingColumnsNote and still drawn", () => {
    // `test/pagesRegisters.test.js` pins the WORDING; this pins that it still reaches a
    // reader after moving off the surface — as a line on the table's own heading.
    expect(SCA_CODE).toMatch(/missingColumns: missingColumnsNote\(\["ecosystem"\]\)/);
    expect(SCA_CODE).toMatch(/vm\.missingColumns,/);
    expect(SCA_CODE).not.toMatch(/el\("p", \{ class: "small muted" \}, vm\.missingColumns\)/);
  });

  it("the funnel's unmeasurable steps keep their words on the surface, as a pill", () => {
    for (const src of [SCA_CODE, SAST_CODE]) {
      expect(src).toMatch(/statusPill\("neutral", "Exposure and overdue: not applicable"/);
      expect(src).toMatch(/lines: \[vm\.funnel\.note\]/);
      expect(src).not.toMatch(/el\("p", \{ class: "small muted" \}, vm\.funnel\.note\)/);
    }
  });
});

// =========================================================================================
//  6. The denominator, one level up: sectionCard/chartCard's merge
// =========================================================================================

describe("a heading's denominator leads its tip lines and is written where a test can read it", () => {
  // `sectionCard` and `chartCard` are DOM, so what is asserted here is the merge they both
  // call (`figureCardModel`, gas_shared) plus the wiring in source. The resolver is injected
  // for the reason gas_shared/README.md gives: `tipLines({term})` reaches
  // `appConfig().findHelpEntry`, which throws when nothing configured it, and configuring one
  // here would install it for every other file sharing this vitest worker.
  it("prepends the sentence to whatever the help object already carried", () => {
    const merged = figureCardModel(
      { help: { term: "two-clocks", lines: ["a page line"] }, denominator: "12 of 90 rows." },
      () => ["a page line"],
    );
    expect(merged.lines).toEqual(["12 of 90 rows.", "a page line"]);
    expect(merged.term).toBe("two-clocks");
    expect(merged.denominator).toBe("12 of 90 rows.");
  });

  it("leaves a help object with no denominator exactly as it was — the secrets page's path", () => {
    const merged = figureCardModel({ help: { term: "removed" }, denominator: null }, () => ["book"]);
    expect(merged.denominator).toBeNull();
    // …and `sectionCard` only diverts to the merged shape when there IS a denominator, which
    // is what keeps every existing call site rendering byte-identically.
    expect(SCA_CODE).toMatch(/if \(!help \|\| typeof help !== "object" \|\| Array\.isArray\(help\) \|\| !help\.denominator\) return null;/);
    expect(SCA_CODE).toMatch(/if \(merged\) return tipLabel\(title, \{ lines: merged\.lines, term: merged\.term \}\);/);
  });

  it("writes the sentence onto the node, so a reader and a test read the same string", () => {
    expect(SCA_CODE).toMatch(/section\.setAttribute\("data-denominator", merged\.denominator\)/);
    expect(SCA_CODE).toMatch(/card\.setAttribute\("data-denominator", merged\.denominator\)/);
  });

  it("moved every denominator paragraph these two pages drew onto a heading", () => {
    // Eleven `denomNote` paragraphs stood under tables on these two pages; none is left, and
    // each sentence is now a `denominator:` on the heading above the table it belonged to.
    for (const [name, src] of [["sca", SCA_CODE], ["sast", SAST_CODE]]) {
      expect(src, `${name} still draws a denominator paragraph`).not.toMatch(/denomNote\(/);
    }
    expect(SCA_CODE).toMatch(/\{ denominator: vm\.tiers\.denominator \}/);
    expect(SCA_CODE).toMatch(/\{ denominator: vm\.funnel\.denominator \}/);
    expect(SCA_CODE).toMatch(/\{ denominator: dim\.denominator \}/);
    expect(SAST_CODE).toMatch(/denominator: vm\.weaknessMix \? vm\.weaknessMix\.denominator : null/);
  });
});
