// The scope-walk chips: one mark per register, and exactly ONE mark.
//
// THE DEFECT THIS EXISTS FOR. `.scan-step-dot` was written as a CONTENTLESS shape — an 8x8
// disc whose own rule in base.css still says "State is encoded by SHAPE + COLOR
// (waiting=hollow, active=filled+pulse, done=filled)". Later the row builders started putting
// a text glyph INSIDE that same span (`✓` / `●` / `○`), because shape-plus-colour cannot tell
// `done` from `active` — both are filled discs differing only in hue, and this repo's
// accessibility bar is that status never carries meaning by colour alone.
//
// Nobody removed the disc. So every chip painted two marks at once: the CSS disc, plus a
// 14px glyph inside an 8px box with `overflow: visible`. Measured in the browser against the
// real stylesheet, on the three chips of the sync sheet's scope walk:
//
//     .scan-step-dot  box 8x8   content 8x21 (`●`) / 12x21 (`○`)
//                     -> the glyph paints 13px BELOW the disc and 4px past its side
//
// which reads as a doubled, misaligned bullet beside every register name.
//
// WHY THE GLYPH WINS AND THE DISC GOES. The glyph is the half that carries state without
// colour, so deleting it to save the disc would trade a rendering bug for an accessibility
// one. It is also the half that gets the TOKEN CONTRACT right: an inherited `color` puts
// `--accent-text` (7.39:1) on the active chip, where the disc used `--accent` — a FILL token
// at 1.52:1 that is only legible behind `--accent-edge`. See CLAUDE.md's "the accent is split
// and the split is load-bearing".
//
// WHAT THIS GUARD ACTUALLY CHECKS, and why it is not decorative: the two halves of the bug
// live in different files, so neither file is wrong on its own. A fixed pixel box is fine for
// a span with no content; a glyph is fine in a span that is not a fixed pixel box. Only the
// COMBINATION is the defect, so only a check that reads both can see it. Perturbed both ways
// before it was kept: restoring `width: 8px; height: 8px` to the rule fails it, and so does a
// row builder that stops passing a glyph while the rule still has no box.

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {string}   ctx.progressSrc  this app's scope-walk builder, read as text. The file is
 *   named differently per app (`scanProgress.js` in gas, `syncProgress.js` in both siblings),
 *   so the caller reads it — a fixed relative path here would resolve to nothing in two of
 *   the three and pass by finding no glyph at all.
 * @param {string}   ctx.baseCss      gas_shared/styles/base.css, read as text.
 */
export function registerScanStepContract(ctx) {
  const { describe, it, expect, app, progressSrc, baseCss } = ctx;

  /** The body of the bare `.scan-step-dot { … }` rule — not the state variants, which are
   *  allowed to paint, and not the `.sidebar` ones. */
  const dotRule = (() => {
    const m = baseCss.match(/(^|\n)\.scan-step-dot\s*\{([^}]*)\}/);
    return m ? m[2] : null;
  })();

  describe(app + ": the scope-walk chip paints one mark, not two", () => {
    it("has a .scan-step-dot rule to check at all", () => {
      // If this ever goes null the two assertions below would pass vacuously, which is the
      // failure mode every contract in this directory is written to avoid.
      expect(dotRule, "no bare .scan-step-dot rule found in base.css").not.toBeNull();
    });

    it("puts a glyph in the dot, so state is not carried by colour alone", () => {
      // The premise of the rule below. If a row builder stops doing this, the disc has to come
      // back — and this failing is how that argument gets made rather than assumed.
      expect(progressSrc).toMatch(/class:\s*"scan-step-dot"[^)]*\}\s*,\s*glyph/);
    });

    it("does not also lock that glyph inside a fixed pixel box", () => {
      // A px width/height on a span carrying 14px text is the bug: the text cannot fit, and
      // `overflow: visible` paints it outside the box rather than clipping it.
      expect(dotRule, ".scan-step-dot sizes a box that has a text glyph in it")
        .not.toMatch(/\b(width|height)\s*:\s*\d+px/);
    });

    it("does not draw a disc behind that glyph either", () => {
      // `border-radius: 50%` plus a background is the disc. With a glyph present it is the
      // SECOND mark — the one that made the chip look doubled.
      expect(dotRule, ".scan-step-dot still draws the contentless disc's chrome")
        .not.toMatch(/border-radius\s*:\s*50%/);
    });
  });
}
