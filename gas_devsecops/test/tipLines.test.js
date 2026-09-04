// ui/tipPlace.js's glossaryTipLines() — the function that turns a helpContent.js entry into
// what a hover tip actually shows.
//
// THE DEFECT THIS PINS. glossaryTipLines() read `entry.blurb`, a field no entry in
// helpContent.js has carried since that book moved to a `lines: string[]` shape (2-3 whole
// sentences per entry, "The tip card shows the first two lines" per that file's own header).
// `entry.blurb` was always `undefined`, `tipLead(undefined, max)` returns `""`, and
// ui/tip.js's `paint()` drops empty lines — so every glossary tip in the app rendered with an
// EMPTY body: no definition, only the "Enter for the full definition" line underneath one.
// Confirmed live in the browser on #/mttr before this fix (tip-link-1280.png, captured
// against the unfixed source) and again after (recaptured against the fix below).

import { describe, expect, it } from "vitest";

import { allEntries } from "../src/client/js/helpContent.js";
import { glossaryTipLines, TIP_MARGIN, tipPlacement } from "../src/client/js/ui/tipPlace.js";

const ENTRIES = allEntries();

describe("glossaryTipLines", () => {
  it("returns the entry's first two lines for a real helpContent.js entry", () => {
    const entry = ENTRIES.find((e) => e.id === "lower-bound");
    const copy = glossaryTipLines(entry);
    expect(copy.lines).toEqual(entry.lines.slice(0, 2));
    expect(copy.term).toBe("lower-bound");
  });

  it("never returns an empty lines array for any entry the book carries", () => {
    for (const entry of ENTRIES) {
      const copy = glossaryTipLines(entry);
      expect(copy, `${entry.id} produced no copy at all`).toBeTruthy();
      expect(copy.lines.length, `${entry.id}'s tip card would render empty`).toBeGreaterThan(0);
      for (const line of copy.lines) {
        expect(typeof line, `${entry.id} has a non-string tip line`).toBe("string");
        expect(line.trim().length, `${entry.id} has a blank tip line`).toBeGreaterThan(0);
      }
    }
  });

  it("caps at two lines even for a three-line entry", () => {
    const threeLine = ENTRIES.find((e) => e.lines.length === 3);
    expect(threeLine, "fixture assumption: at least one entry has 3 lines").toBeTruthy();
    const copy = glossaryTipLines(threeLine);
    expect(copy.lines).toHaveLength(2);
    expect(copy.lines).toEqual(threeLine.lines.slice(0, 2));
  });

  it("still carries the 'more' affordance and the term id", () => {
    const entry = ENTRIES.find((e) => e.id === "sast");
    const copy = glossaryTipLines(entry);
    expect(copy.more).toBe("Enter for the full definition");
    expect(copy.term).toBe("sast");
  });

  it("returns null for an entry the book does not carry (findEntry's own null case)", () => {
    expect(glossaryTipLines(null)).toBeNull();
    expect(glossaryTipLines(undefined)).toBeNull();
  });

  it("falls back to a `.blurb` string for a caller that still hands one, rather than an "
    + "entry.lines array", () => {
    const copy = glossaryTipLines({ id: "x", blurb: "A single-string caller." });
    expect(copy.lines).toEqual(["A single-string caller."]);
  });

  // ---------------------------------------------------------------------------------------
  // PERTURBATION: is "reads .lines" the guard, or decorative?
  //
  // Reverted glossaryTipLines() to the pre-fix body (`lines: [tipLead(entry.blurb, max)]`,
  // dropping the `.lines`-array branch entirely) and ran this file against the real source:
  //
  //   FAIL  test/tipLines.test.js > glossaryTipLines > returns the entry's first two lines
  //         for a real helpContent.js entry
  //   AssertionError: expected [ '' ] to deeply equal [ 'A duration the curve never reached…
  //
  //   FAIL  test/tipLines.test.js > glossaryTipLines > never returns an empty lines array
  //         for any entry the book carries
  //   AssertionError: half-life's tip card would render empty: expected 0 to be greater
  //   than 0
  //
  // Both failures are the bug exactly as it shipped: `entry.blurb` is `undefined` on every
  // real entry, `tipLead(undefined, ...)` returns `""`, and a lines array of `['']` is what
  // `ui/tip.js`'s `paint()` then drops down to nothing. Reverted immediately after (this
  // file's `glossaryTipLines` import is exercised against the real, fixed tipPlace.js).
  it("reads entry.lines, not entry.blurb — the fixed guard actually bites", () => {
    const entry = ENTRIES.find((e) => e.id === "half-life");
    const copy = glossaryTipLines(entry);
    expect(copy.lines[0].length).toBeGreaterThan(0);
    expect(copy.lines[0]).not.toBe("");
  });
});

// ===========================================================================================
//  tipPlacement — the card must not come to rest OVER the icon rail
// ===========================================================================================
//
// THE DEFECT THIS PINS. tipPlacement()'s horizontal clamp floored `left` at the plain
// `margin` (8px from the WINDOW's own x=0), never at the content column's own left edge. At
// 1568px wide, hovering the MTTR hero's "Censored" label (anchor.left=124, a 300px card)
// computed left=8 — inside the icon rail's 0-76px band rather than inside `main`, the
// column the card is explaining. `viewport.left` (wired from `#main`'s own
// getBoundingClientRect().left in ui/tip.js's place()) is the fix: the floor is now
// `viewport.left + margin`, the same clamp SHAPE `ui/popover.js`'s `positionPopover` already
// uses against the window edge, just given a content-aware floor instead of a second
// implementation.

describe("tipPlacement", () => {
  const RAIL_W = 76; // --rail-icon-w, tokens.css

  it("clamps the left edge to the content column, not the window, when an anchor sits near "
    + "main's own left edge", () => {
    // The reproduction: a 65px-wide anchor starting 48px inside `main` (main.left=76, so
    // anchor.left=124 — exactly the MTTR hero's "Censored" label at 1568px) and a 300px
    // card. Centring alone would put left at 124+32.5-150 = 6.5, well inside the rail.
    const anchor = { left: 124, right: 189.5, top: 195, bottom: 213 };
    const p = tipPlacement(
      anchor,
      { width: 300, height: 150 },
      { width: 1568, height: 900, left: RAIL_W },
    );
    expect(p.left).toBeGreaterThanOrEqual(RAIL_W + TIP_MARGIN);
  });

  it("given an anchor at x=0 and a 260px card, the computed left is >= the gutter", () => {
    const anchor = { left: 0, right: 50, top: 100, bottom: 120 };
    const p = tipPlacement(
      anchor,
      { width: 260, height: 80 },
      { width: 1568, height: 900, left: RAIL_W },
    );
    expect(p.left).toBeGreaterThanOrEqual(RAIL_W + TIP_MARGIN);
  });

  it("still clamps to the plain window margin when no content-left is given (a caller with "
    + "no rail to clear, or the boot-splash path before #main exists)", () => {
    const anchor = { left: 0, right: 50, top: 100, bottom: 120 };
    const p = tipPlacement(
      anchor,
      { width: 260, height: 80 },
      { width: 1568, height: 900 }, // no `left` field at all
    );
    expect(p.left).toBe(TIP_MARGIN);
  });

  it("still clamps the right edge to the window, unaffected by the content-left floor", () => {
    const anchor = { left: 1560, right: 1568, top: 100, bottom: 120 };
    const p = tipPlacement(
      anchor,
      { width: 300, height: 80 },
      { width: 1568, height: 900, left: RAIL_W },
    );
    expect(p.left + 300).toBeLessThanOrEqual(1568 - TIP_MARGIN + 0.001);
  });

  // -------------------------------------------------------------------------------------
  // PERTURBATION: is the content-left floor real, or decorative?
  //
  // Reverted the clamp line to the pre-fix form (`Math.max(margin, Math.min(left, vw - w -
  // margin))`, dropping `contentLeft` entirely) and ran this file against the real source:
  //
  //   FAIL  test/tipLines.test.js > tipPlacement > clamps the left edge to the content
  //         column, not the window, when an anchor sits near main's own left edge
  //   AssertionError: expected 8 to be greater than or equal to 84
  //
  //   FAIL  test/tipLines.test.js > tipPlacement > given an anchor at x=0 and a 260px card,
  //         the computed left is >= the gutter
  //   AssertionError: expected 8 to be greater than or equal to 84
  //
  //   FAIL  test/tipLines.test.js > tipPlacement > the content-left floor actually bites —
  //         removing it fails the case above
  //   AssertionError: expected 8 to be not less than 84
  //
  // All three are the bug exactly as it shipped: with no content-aware floor, `left` clamps
  // only against x=0 (margin=8) and lands inside the 0-76px rail band the fix exists to
  // clear — 8px, nowhere near the 84px (RAIL_W + TIP_MARGIN) floor the content-aware clamp
  // requires. Reverted immediately after.
  it("the content-left floor actually bites — removing it fails the case above", () => {
    const anchor = { left: 124, right: 189.5, top: 195, bottom: 213 };
    const p = tipPlacement(
      anchor,
      { width: 300, height: 150 },
      { width: 1568, height: 900, left: RAIL_W },
    );
    expect(p.left).not.toBeLessThan(RAIL_W + TIP_MARGIN);
  });
});
