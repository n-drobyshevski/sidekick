// Wave B's surface claims: what left the two register pages, and what may never leave them.
//
// Sibling of `test/figuresOverProse.test.js` (Wave A, the front door and the clock) for the
// two pages this wave took: Secrets and Coverage & efficiency. Both were correct and wordy —
// 32 prose blocks on one, 11 on the other — and every block got one of four fates: DELETE (a
// duplicate), COMPRESS (a chip, a figure, "N of M"), DISCLOSE (a heading's or a label's tip
// lines, or a closed disclosure) or KEEP.
//
// THE ONE THAT IS WORTH A TEST IS KEEP. The risk this wave carries, named in the plan, is a
// tip becoming the only carrier of an honesty statement: "not measured", "excluded", "no
// joint count", "reconstructed or partial", "not applicable". A hover card is not a place a
// reader is guaranteed to go, and a page that whispers its refusals behind a trigger is worse
// than the wordy page it replaced. So the sweep below reads each page's COMMENT-STRIPPED
// source for the words themselves, which is the only form of this check that can fail.
//
// The pure half is `twinFoldView`: the one figure this wave ADDED to a model rather than
// moved, and the fourth appearance in this repository of `Number(null)` being 0 and finite.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  coverageMeterPct, segmentValidatedPct, twinFoldView,
} from "../src/client/js/pages/secrets.js";
import { signalMeterPct } from "../src/client/js/pages/program.js";

const PAGES = new URL("../src/client/js/pages/", import.meta.url);

/**
 * The file with its comments removed — string-aware, so a `//` inside a quote survives. The
 * fifth copy of `pagesLit.test.js`'s `code()`; those files are protected and there is no
 * shared test helper.
 *
 * LOAD-BEARING HERE. Both pages' comments QUOTE the sentences they no longer print — that is
 * how a fate is recorded in the source — so a raw-text sweep would find every phrase below
 * whether or not a reader can see it, and every case in this file would pass on a page that
 * had deleted all of them.
 */
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
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const raw = (name) => readFileSync(new URL(`${name}.js`, PAGES), "utf8");
const SECRETS = raw("secrets");
const PROGRAM = raw("program");
const SECRETS_CODE = code(SECRETS);
const PROGRAM_CODE = code(PROGRAM);
// `verdictMark` moved out of program.js into ui/verdict.js in Wave C (repos.js's Capacity
// column needed the identical dot-and-word this page had already built) — read separately so
// the "gives the capacity verdict a dot AND a word" claim below still checks the DOM that
// claim is actually about, rather than quietly passing because program.js still says
// "aria-hidden" somewhere else on the page.
const VERDICT_CODE = code(readFileSync(new URL("../src/client/js/ui/verdict.js", import.meta.url), "utf8"));

// =========================================================================================
//  1. R2's KEEP list never leaves the surface
// =========================================================================================

/**
 * Each entry is a phrase a reader has to be able to see WITHOUT hovering anything, and the
 * measurement it refuses to let a zero stand in for. These are quoted from the pages' own
 * copy, so a rewrite that keeps the meaning and changes the words fails here and has to say
 * so — which is the intended cost, not an accident of the check.
 */
const KEEP_SECRETS = [
  ["not measured", "a fold, a coverage or a rate nobody computed is never a zero"],
  ["excluded, not censored", "an unvalidated row supports no claim in either direction"],
  ["no joint count", "there is no validity x confidence cross-tab, and none may be inferred"],
  ["Excluded, unmeasured", "the count of rows outside the revocation estimate, as a figure"],
  ["No severity column", "severity grades a detection here, not a live credential"],
  // Split across a concatenation in the model, so the phrase checked is the second half —
  // which is where the claim lives anyway.
  ["mean the credential is safe", "removed is not rotated — the page's whole thesis"],
  ["Unconfirmed", "the alarm corner's word, beside its glyph and its tint"],
];

const KEEP_PROGRAM = [
  ["not measured", "a rate with no base is not a zero percent"],
  ["not applicable", "a signal no row in scope has a column for is a third state"],
  ["Unclassified", "the rows the rule could not place, held outside the 2x2"],
  ["Secrets excluded (", "the population outside every figure on the page, with its count"],
  ["reconstructed or partial", "the months nobody was watching, counted"],
  ["At or below random", "the verdict on the rule, on the figure it is a verdict about"],
];

describe("the honesty statements stayed on the page, not in a tip", () => {
  for (const [phrase, why] of KEEP_SECRETS) {
    it(`secrets still prints “${phrase}” — ${why}`, () => {
      expect(SECRETS_CODE).toContain(phrase);
    });
  }

  for (const [phrase, why] of KEEP_PROGRAM) {
    it(`program still prints “${phrase}” — ${why}`, () => {
      expect(PROGRAM_CODE).toContain(phrase);
    });
  }

  it("is not a vacuous sweep — the stripper really removes the prose that quotes them", () => {
    // Both files' comments name the sentences they no longer draw. If `code()` leaked comment
    // text, every case above would pass on a page that printed none of these words, so this
    // proves the stripper bites: these three phrases exist ONLY in comments.
    for (const [name, src, stripped, phrase] of [
      ["secrets", SECRETS, SECRETS_CODE, "the reader rebuilds the 2x2 in"],
      ["program", PROGRAM, PROGRAM_CODE, "EIGHT-COLUMN TABLE IS A CHART"],
      ["program", PROGRAM, PROGRAM_CODE, "THE VERDICT IS THE CARD'S CHIP"],
    ]) {
      expect(src, `${name}: the control phrase is not in the file at all`).toContain(phrase);
      expect(stripped, `${name}: code() left comment text behind`).not.toContain(phrase);
    }
  });
});

// =========================================================================================
//  2. What moved, and to where
// =========================================================================================

describe("secrets — the words are one level down and the pictures are on the surface", () => {
  it("prints no denominator as a paragraph any more", () => {
    // Five `denomNote(...)` paragraphs: the hero's, the 2x2's, the age table's, one per
    // concentration dimension and one per segment axis. Every one of them is a line on the
    // heading or card label it belongs to now, and the sentence a test can read is written to
    // `data-denominator` by `figureCard` instead.
    expect(SECRETS_CODE).not.toMatch(/\bdenomNote\(/);
    expect(SECRETS_CODE).toMatch(/denominator:/);
  });

  it("draws the four corners as a 2x2 rather than as five columns", () => {
    expect(SECRETS_CODE).toMatch(/quadTable\(\s*\n?\s*removalQuadModel\(/);
    expect(SECRETS_CODE).not.toMatch(/label: "Corner"/);
    expect(SECRETS_CODE).not.toMatch(/label: "Reading"/);
  });

  it("keeps the block ORDER test/secretsTriage.test.js pins, with the pair's new heading", () => {
    const paint = SECRETS_CODE.slice(SECRETS_CODE.indexOf("function paintSecrets("));
    const spine = paint.indexOf("validityTriageView(vm)");
    const heading = paint.indexOf('sectionLabel("Validity and confidence"');
    const pair = paint.indexOf('class: "card-pair"');
    const corners = paint.indexOf('sectionCard("Removed is not rotated"');
    expect(spine).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(spine);
    expect(pair).toBeGreaterThan(heading);
    expect(corners).toBeGreaterThan(pair);
  });

  it("stops rendering the 120-word twin note, and prints this sync's own fold instead", () => {
    const paint = SECRETS_CODE.slice(SECRETS_CODE.indexOf("function paintSecrets("));
    expect(paint).not.toContain("vm.twinNote");
    expect(paint).toContain("vm.twinFold.line");
    // The model still CARRIES it — `test/pagesRegisters.test.js` pins `SECRETS.twinNote` and
    // the string is where the tenant measurement is recorded. This is about what is drawn.
    expect(SECRETS_CODE).toContain("twinNote: TWIN_NOTE");
  });

  it("renders missingColumnsNote as heading lines rather than as a trailing paragraph", () => {
    // `test/pagesRegisters.test.js` pins the sentence itself; this pins that the page still
    // shows it, and that it is no longer a paragraph at the far end of a 13-column table.
    expect(SECRETS_CODE).toContain("vm.missingColumns");
    expect(SECRETS_CODE).not.toMatch(/el\("p", \{ class: "small muted" \}, vm\.missingColumns\)/);
  });
});

describe("program — the same, on the coverage lane", () => {
  it("draws the confusion matrix as a cross and keeps the unclassified rows outside it", () => {
    expect(PROGRAM_CODE).toMatch(/quadTable\(confusionQuadModel\(view\)/);
    expect(PROGRAM_CODE).toMatch(/class: "hatch unclassified-swatch"/);
    expect(PROGRAM_CODE).not.toMatch(/label: "Classified", cell:/);
  });

  it("keeps exactly the two dataTables that are still tables", () => {
    // Four before this wave: the matrix (now a quad), the signals table (still a table — six
    // rows of four different kinds of figure), the sensitivity sweep (still a table, now
    // inside a disclosure) and the eight-column month table (now a chart with that table
    // behind it). A count, so a table deleted to satisfy the claim shows as a change here.
    const tables = (PROGRAM_CODE.match(/\bdataTable\(\{/g) || []).length;
    expect(tables).toBe(2);
  });

  it("puts the subset sweep behind a disclosure with its count in the summary", () => {
    expect(PROGRAM_CODE).toMatch(/disclosure\(\s*\n?\s*"All " \+ fmtCount\(group\.points\.length\)/);
  });

  it("stops printing both rates a second time under the header", () => {
    expect(PROGRAM_CODE).not.toContain('"Coverage: "');
    expect(PROGRAM_CODE).not.toContain('". Efficiency: "');
    // …and the denominator of each is on its own figure instead.
    expect(PROGRAM_CODE).toMatch(/label: "Remediation efficiency"/);
    expect((PROGRAM_CODE.match(/\bfigureCard\(\{/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("gives the capacity verdict a dot AND a word", () => {
    // This page's own claim is only that it CALLS the shared mark with its verdict and
    // label — verdictMark's DOM (the dot, the word, its aria-hidden-ness) is ui/verdict.js's
    // claim now, checked against that file's own source below, since the function moved
    // there in Wave C when repos.js needed the identical mark for its Capacity column.
    expect(PROGRAM_CODE).toMatch(/verdictMark\(view\.verdict, view\.verdictLabel\)/);
    expect(PROGRAM_CODE).not.toMatch(/function verdictMark\(/);
    expect(VERDICT_CODE).toMatch(/class: "verdict-word"/);
    expect(VERDICT_CODE).toMatch(/"aria-hidden": "true"/);
  });
});

// =========================================================================================
//  3. twinFoldView — the figure this wave added, and the cast it refuses
// =========================================================================================

describe("twinFoldView — a fold nobody reported is not a fold of nothing", () => {
  it("says so in words when the payload carries no twin statistics", () => {
    for (const absent of [undefined, null, "", 0, [], false, "nope"]) {
      const view = twinFoldView(absent);
      expect(view.measured, JSON.stringify(absent) + " read as a measurement").toBe(false);
      expect(view.line).toBe("Twin fold: not measured on this sync");
      expect(view.folded).toBe(null);
      expect(view.line).not.toMatch(/\b0\b/);
    }
  });

  it("reports a real fold as a count and a median gap", () => {
    expect(twinFoldView({ keys: 6, folded: 7, medianGapDays: 19.94 }).line)
      .toBe("7 twins folded · median gap 19.9 d");
    expect(twinFoldView({ keys: 1, folded: 1, medianGapDays: 3 }).line)
      .toBe("1 twin folded · median gap 3.0 d");
  });

  it("keeps a MEASURED zero, which is a different statement entirely", () => {
    // `TwinStats` is `{keys: 0, folded: 0, medianGapDays: null}` when a sync looked and found
    // no credential reported against both a repository and a branch. That IS a measurement,
    // and it must not read the same as a payload that never said anything.
    const view = twinFoldView({ keys: 0, folded: 0, medianGapDays: null });
    expect(view.measured).toBe(true);
    expect(view.line).toBe("0 twins folded · no birth-date gap recorded");
    expect(view.line).not.toContain("not measured");
  });

  /**
   * PERTURBATION, reproduced inline rather than described — the fourth time this exact rewrite
   * has been available in this repository and the reason CLAUDE.md records it three times.
   *
   * The tempting simplification is to cast first and let `Number.isFinite` sort it out:
   *
   *     const folded = Number(twins && twins.folded);
   *     if (!Number.isFinite(folded)) return notMeasured;
   *
   * `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all 0 and all finite,
   * so every one of those payloads comes back as a confident "0 twins folded" — a page saying
   * it looked and found nothing, on a sync that never reported. The two shapes are run side by
   * side below.
   */
  it("the cast-first rewrite reads five kinds of absence as a measured zero", () => {
    const defective = (twins) => {
      const folded = Number(twins && twins.folded);
      return Number.isFinite(folded)
        ? { measured: true, line: folded + " twins folded" }
        : { measured: false, line: "Twin fold: not measured on this sync" };
    };
    const absences = [null, undefined, { folded: null }, { folded: "" }, { folded: [] }];
    for (const a of absences) {
      expect(twinFoldView(a).measured, JSON.stringify(a)).toBe(false);
    }
    const fooled = absences.filter((a) => defective(a).measured);
    // Four of the five: `undefined` is the one `Number` refuses, which is exactly why the
    // rewrite looks safe to a reviewer who tries one case.
    expect(fooled).toHaveLength(4);
    expect(defective({ folded: null }).line).toBe("0 twins folded");
  });

  /**
   * THE FOLD IS DATED, BECAUSE A CLOCK HAS TO SAY WHERE IT STARTED — PRODUCT.md's seventh
   * principle, the one this register adds to the shared six.
   *
   * The figure comes off the newest per-UTC-day history blob (`readModels.ts`'s
   * `latestSecretsTwins`), one file per day, latest write wins. On a register nobody has
   * synced since Tuesday, "7 twins folded" read on Friday is Tuesday's number, and until the
   * day was on the line nothing on screen said so. The same requirement the Scan History
   * sparkline's caption meets with "as of each saved scan".
   */
  it("names the day it was measured, in the app's own date format", () => {
    const view = twinFoldView({ keys: 6, folded: 7, medianGapDays: 19.94 }, "2026-06-15");
    expect(view.line).toBe("7 twins folded · median gap 19.9 d · measured 2026-06-15");
    expect(view.asOf).toBe("2026-06-15");
  });

  it("a measured zero is dated too — it is a measurement and it happened on a day", () => {
    expect(twinFoldView({ keys: 0, folded: 0, medianGapDays: null }, "2026-06-15").line)
      .toBe("0 twins folded · no birth-date gap recorded · measured 2026-06-15");
  });

  it("A DATE THAT DID NOT ARRIVE IS NOT TODAY: the fold prints undated", () => {
    for (const bad of [undefined, null, "", 0, [], false, "not a date", {}, NaN]) {
      const view = twinFoldView({ keys: 6, folded: 7, medianGapDays: 19.94 }, bad);
      expect(view.asOf, JSON.stringify(bad)).toBe(null);
      expect(view.line, JSON.stringify(bad))
        .toBe("7 twins folded · median gap 19.9 d");
      expect(view.line, JSON.stringify(bad)).not.toContain("measured");
    }
  });

  it("the unmeasured line takes no date, whatever is passed beside it", () => {
    const view = twinFoldView(null, "2026-06-15");
    expect(view.line).toBe("Twin fold: not measured on this sync");
    expect(view.asOf).toBe(null);
  });

  /**
   * PERTURBATION, reproduced inline. The tempting shape is "we know roughly when this was —
   * default it to now", which reads as a kindness and publishes a measurement date nobody
   * recorded. It is the same substitution as reading an absent fold as a zero, one field
   * along: today's date on a fold that may be a week old is a stronger claim than no date,
   * and the reader has no way to tell.
   */
  it("defaulting a missing date to today would date a fold nobody dated", () => {
    const defective = (twins, asOf) => {
      const day = asOf || new Date().toISOString().slice(0, 10); // the anti-pattern
      return `${twins.folded} twins folded · measured ${day}`;
    };
    const today = new Date().toISOString().slice(0, 10);
    expect(defective({ folded: 7 }, null)).toContain(today);
    const shipped = twinFoldView({ keys: 6, folded: 7, medianGapDays: 19.94 }, null);
    expect(shipped.line).not.toContain(today);
    expect(shipped.line).not.toContain("measured");
  });

  it("refuses a median gap on its own terms, never as a zero-day gap", () => {
    const view = twinFoldView({ keys: 3, folded: 4, medianGapDays: null });
    expect(view.medianGapDays).toBe(null);
    expect(view.line).toContain("no birth-date gap recorded");
    expect(view.line).not.toContain("0.0 d");
  });
});

// =========================================================================================
//  4. Three new meters, and the confident zero each one refuses to draw
// =========================================================================================
//
// THIS SECTION EXISTS BECAUSE THE FIRST VERSION OF IT DID NOT, AND THAT WAS A FINDING. This
// wave added three `meter--stat` bars — one per segment row's validated share, one headline
// for validation coverage, one per signal's capture rate — and each carries a refusal in
// front of it. The refusals were written as inline expressions inside DOM builders, where
// this project (no jsdom) cannot call them. Perturbing one of them — replacing the whole of
// `signalMeter`'s body with `meter(Number(row.coveragePct))` — made ZERO tests fail across
// pagesProgram, pagesLit and this file. A guard that fires on nothing is a finding, not a
// pass (CLAUDE.md), so each decision is a pure exported function now and the cases below are
// where it bites.

describe("a meter is drawn only where a share was actually taken", () => {
  it("signalMeterPct: a measured share, including a measured zero", () => {
    // `ai_verdict` reads 0% in the live tenant and that IS the measurement — it separates
    // "the AI agreed with nothing" from "nobody asked the AI". An empty track is its picture.
    expect(signalMeterPct({ coverageState: "measured", coveragePct: 0 })).toBe(0);
    expect(signalMeterPct({ coverageState: "measured", coveragePct: 62.5 })).toBe(62.5);
  });

  it("signalMeterPct: no bar for the two states that are not shares at all", () => {
    // "always present" — the clause rests on a column that is never missing, so there is no
    // share to take; "not applicable" — no row in scope has such a column. A 0% track beside
    // either of those words is a picture contradicting the word.
    expect(signalMeterPct({ coverageState: "always-present", coveragePct: null })).toBe(null);
    expect(signalMeterPct({ coverageState: "not-applicable", coveragePct: null })).toBe(null);
    // …and no bar for a row that says "measured" and carries nothing readable.
    for (const pct of [null, undefined, "", [], false]) {
      expect(signalMeterPct({ coverageState: "measured", coveragePct: pct }), String(pct))
        .toBe(null);
    }
    expect(signalMeterPct(null)).toBe(null);
  });

  /**
   * PERTURBATION, inline. The one-line version is the tempting one and it is what was there
   * before this section existed:
   *
   *     meter(Number(row.coveragePct), { className: "meter--stat" })
   *
   * `meter()` opens with `Number(value) || 0`, so every one of the five absences above — and
   * both of the non-share states — resolves to a confident empty track.
   */
  it("the cast-first meter draws an empty track for every state that has no share", () => {
    const defective = (row) => Number(row.coveragePct) || 0;
    const nonShares = [
      { coverageState: "always-present", coveragePct: null },
      { coverageState: "not-applicable", coveragePct: null },
      { coverageState: "measured", coveragePct: "" },
      { coverageState: "measured", coveragePct: [] },
    ];
    for (const row of nonShares) {
      expect(signalMeterPct(row), JSON.stringify(row)).toBe(null);
      expect(defective(row), JSON.stringify(row)).toBe(0);
    }
    // And the one case where the two must AGREE — a real, measured zero keeps its bar.
    const measuredZero = { coverageState: "measured", coveragePct: 0 };
    expect(signalMeterPct(measuredZero)).toBe(0);
    expect(defective(measuredZero)).toBe(0);
  });

  it("coverageMeterPct: no headline bar for a coverage nobody computed", () => {
    expect(coverageMeterPct({ coveragePct: 8.2 })).toBe(8.2);
    expect(coverageMeterPct({ coveragePct: 0 })).toBe(0); // measured zero keeps its bar
    for (const cov of [{ coveragePct: null }, { coveragePct: "" }, {}, null, undefined]) {
      expect(coverageMeterPct(cov), JSON.stringify(cov)).toBe(null);
    }
  });

  it("segmentValidatedPct: refuses a missing denominator before it divides by it", () => {
    expect(segmentValidatedPct({ total: 56, measured: 14 })).toBe(25);
    expect(segmentValidatedPct({ total: 8, measured: 0 })).toBe(0); // measured zero, real bar
    // 0/0 is not 0% — a segment with no findings has no share, and dividing would be NaN.
    expect(segmentValidatedPct({ total: 0, measured: 0 })).toBe(null);
    for (const row of [
      { total: null, measured: 4 }, { total: "", measured: 4 }, { total: [], measured: 4 },
      { total: 10, measured: null }, null, undefined,
    ]) {
      expect(segmentValidatedPct(row), JSON.stringify(row)).toBe(null);
    }
    // The cast-first shape divides by a zero it invented, and NaN reaches the fill width.
    const defective = (row) => (Number(row.measured) / Number(row.total)) * 100;
    expect(Number.isNaN(defective({ total: null, measured: 4 }))).toBe(false);
    expect(defective({ total: null, measured: 4 })).toBe(Infinity);
    expect(Number.isNaN(defective({ total: 0, measured: 0 }))).toBe(true);
  });
});
