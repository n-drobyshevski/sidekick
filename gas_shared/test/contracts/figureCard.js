// `ui/figures.js`'s `figureCard` / `figureCardModel` — the denominator, and where a reader
// finds it.
//
// THE RULE. A rate without its denominator is not a measurement ("99.6% unvalidated" and
// "3-day median over four rows" are the two cases the devsecops register was built after), so
// the sentence has to exist. What changed is where it is DRAWN: 22 `denomNote` paragraphs were
// stacked under the figure rows of three register pages at once, 13 of them on Secrets, and
// that is what turned four figures into four figures and ninety words. DESIGN.md's ladder puts
// the number on the surface and the provenance ONE level down behind a visible signifier, so
// the sentence moves into the tip on the card's own label — and stays on `data-denominator`,
// because a test that can read what a reader reads is the whole reason that attribute exists.
//
// THE THREE THINGS THAT CAN GO WRONG, and each is perturbed inline:
//
//   1. THE SENTENCE IS DROPPED FROM THE LINES. The tempting body is `kpiCard(label, value,
//      sub, chip, help)` with the denominator written only to the attribute — which passes any
//      test that reads the attribute, and shows the reader nothing at all.
//   2. THE SENTENCE IS APPENDED RATHER THAN PREPENDED. A tip is capped and scanned from the
//      top; the denominator is the thing the figure cannot be read without, so it goes first.
//   3. THE TERM IS DROPPED. `{term}` help is what routes the trigger to the book's entry on
//      activation. Merging lines into a bare `{lines}` silently costs every migrated card its
//      link to the glossary, and nothing on screen looks different.
//
// WHY A RESOLVER IS INJECTED FOR THE `{term}` SHAPE. `tipLines({term})` reaches
// `appConfig().findHelpEntry`, and `appConfig()` THROWS when nothing configured it — on
// purpose, so an unset manifest cannot be defaulted into one app getting another's glossary.
// A contract that installed a manifest to get past that would be installing it for every other
// file sharing the vitest worker (`isolate: false` in the `pure` project). So the term shape is
// exercised with the contract's own resolver, and every other shape runs under the default.

import { readFileSync } from "node:fs";

import { code } from "./emptyStates.js";

// Comment-stripped: this module's own header quotes the paragraph it is removing.
const FIGURES_SRC = code(readFileSync(new URL("../../ui/figures.js", import.meta.url), "utf8"));

const DENOM = "1,324 of 1,958 secrets carry a validation state; the rest were never checked.";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} ctx.figureCardModel  the pure half, handed over rather than imported by a
 *   fixed relative path (this file is registered from three different depths)
 */
export function registerFigureCardContract(ctx) {
  const { describe, it, expect, app, figureCardModel } = ctx;

  describe(app + ": figureCardModel() — the denominator leads the tip", () => {
    it("prepends the sentence to a card that already had lines of its own", () => {
      const m = figureCardModel({ help: { lines: ["Own line A.", "Own line B."] }, denominator: DENOM });
      expect(m.lines).toEqual([DENOM, "Own line A.", "Own line B."]);
      expect(m.denominator).toBe(DENOM);
    });

    it("takes a string, an array and {lines} — the same three shapes tipLabel takes", () => {
      expect(figureCardModel({ help: "One string.", denominator: DENOM }).lines)
        .toEqual([DENOM, "One string."]);
      expect(figureCardModel({ help: ["A.", "B."], denominator: DENOM }).lines)
        .toEqual([DENOM, "A.", "B."]);
      expect(figureCardModel({ help: { lines: ["A."] }, denominator: DENOM }).lines)
        .toEqual([DENOM, "A."]);
    });

    it("a denominator with no other help is the whole tip", () => {
      const m = figureCardModel({ denominator: DENOM });
      expect(m.lines).toEqual([DENOM]);
      expect(m.term).toBeNull();
    });

    it("help with no denominator is left exactly as it was — this is additive", () => {
      const m = figureCardModel({ help: { lines: ["Only mine."] } });
      expect(m.lines).toEqual(["Only mine."]);
      expect(m.denominator).toBeNull();
    });

    it("no help and no denominator says nothing, rather than an empty card of tip", () => {
      const m = figureCardModel({});
      expect(m.lines).toBeNull();
      expect(m.term).toBeNull();
      expect(m.denominator).toBeNull();
    });

    // GUARD 1, PERTURBED. The rewrite that keeps the attribute and drops the lines passes any
    // attribute-only assertion and shows the reader nothing.
    it("PERTURBATION PROOF: a model that only stamps the attribute tells the reader nothing", () => {
      function attributeOnlyDefective({ help, denominator }) {
        return { lines: help ? help.lines : null, term: null, denominator };
      }
      const wrong = attributeOnlyDefective({ help: { lines: ["Own line."] }, denominator: DENOM });
      expect(wrong.denominator).toBe(DENOM);          // the attribute check still passes …
      expect(wrong.lines).not.toContain(DENOM);       // … and the sentence is nowhere a reader looks

      const shipped = figureCardModel({ help: { lines: ["Own line."] }, denominator: DENOM });
      expect(shipped.lines).toContain(DENOM);
    });

    // GUARD 2, PERTURBED. Appending reads fine in a two-line tip and buries the denominator
    // the moment a glossary entry contributes three lines above it.
    it("PERTURBATION PROOF: appending buries the denominator under the general definition", () => {
      const entry = ["A general definition.", "A second line.", "A third."];
      const appendedDefective = [...entry, DENOM];
      expect(appendedDefective[0]).not.toBe(DENOM);

      const shipped = figureCardModel({ help: { lines: entry }, denominator: DENOM });
      expect(shipped.lines[0]).toBe(DENOM);
      expect(shipped.lines).toEqual([DENOM, ...entry]);
    });
  });

  describe(app + ": figureCardModel() keeps the route to the book", () => {
    // The contract's own resolver, standing in for `tipLines` on the one shape that would
    // otherwise reach `appConfig()` — see this file's header for why that matters here.
    const BOOK = { censoring: ["Open rows are right-censored.", "Not dropped."] };
    const resolve = (help) => {
      if (!help) return null;
      if (typeof help === "string") return [help];
      if (Array.isArray(help)) return help;
      if (help.lines) return help.lines;
      if (help.term) return BOOK[help.term] || null;
      return null;
    };

    it("resolves a bare {term} into the book's lines and puts the denominator above them", () => {
      const m = figureCardModel({ help: { term: "censoring" }, denominator: DENOM }, resolve);
      expect(m.lines).toEqual([DENOM, "Open rows are right-censored.", "Not dropped."]);
      expect(m.term).toBe("censoring");
    });

    // GUARD 3, PERTURBED. The merge that produces a bare `{lines}` looks identical on screen
    // and costs the trigger its navigation to the entry.
    it("PERTURBATION PROOF: a merge that drops the term costs every card its glossary link", () => {
      function termDroppingDefective({ help, denominator }) {
        return { lines: [denominator, ...resolve(help)], term: null, denominator };
      }
      const wrong = termDroppingDefective({ help: { term: "censoring" }, denominator: DENOM });
      expect(wrong.lines[0]).toBe(DENOM);   // the lines look right …
      expect(wrong.term).toBeNull();        // … and the trigger no longer leads anywhere

      const shipped = figureCardModel({ help: { term: "censoring" }, denominator: DENOM }, resolve);
      expect(shipped.term).toBe("censoring");
    });

    it("a {term} the book does not hold degrades to the denominator alone, keeping the term", () => {
      const m = figureCardModel({ help: { term: "no-such-entry" }, denominator: DENOM }, resolve);
      expect(m.lines).toEqual([DENOM]);
      expect(m.term).toBe("no-such-entry");
    });

    it("a {term} with no denominator at all keeps the term and does not invent a line", () => {
      const m = figureCardModel({ help: { term: "censoring" } }, resolve);
      expect(m.term).toBe("censoring");
      expect(m.lines).toEqual(["Open rows are right-censored.", "Not dropped."]);
      expect(m.denominator).toBeNull();
    });
  });

  describe(app + ": figureCardModel() refuses a denominator that is not a sentence", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace", "   "],
      ["a number", 12],
      ["an array", []],
      ["false", false],
    ])("%s is no denominator: nothing is prepended and nothing is stamped", (_l, bad) => {
      const m = figureCardModel({ help: { lines: ["Own."] }, denominator: bad });
      expect(m.denominator).toBeNull();
      expect(m.lines).toEqual(["Own."]);
    });
  });

  describe(app + ": the card half writes the sentence where a test can read it", () => {
    it("stamps data-denominator on the card node, not on a paragraph beside it", () => {
      expect(FIGURES_SRC).toMatch(/card\.setAttribute\("data-denominator", merged\.denominator\)/);
    });

    it("appends no denomNote paragraph — the whole point of the move", () => {
      const body = FIGURES_SRC.slice(FIGURES_SRC.indexOf("export function figureCard("));
      const card = body.slice(0, body.indexOf("export function figureCardModel("));
      expect(card).not.toContain("denomNote");
    });

    it("still exports denomNote, unchanged — the pages that print one over a TABLE keep it", () => {
      expect(FIGURES_SRC).toContain("export function denomNote(");
      expect(FIGURES_SRC).toMatch(/"data-denominator": sentence \}, sentence\)/);
    });

    it("builds the card through kpiCard rather than growing a second tile vocabulary", () => {
      expect(FIGURES_SRC).toMatch(/kpiCard\(label, value, sub \|\| "", chip \|\| null,/);
    });

    // ADDITIVE MEANS ADDITIVE. A card with no denominator must reach kpiCard with the caller's
    // own `help` object, not with a rebuilt one — the `{term}` shape renders through
    // `glossaryTip` there, which carries an entry's `aka` line that `tipLines()` does not.
    it("hands an unchanged help through untouched when there is no denominator to add", () => {
      expect(FIGURES_SRC).toMatch(
        /const tipHelp = merged\.denominator \? tipShape\(merged\) : \(help \|\| null\);/,
      );
    });
  });
}
