// Every app layer is named, and the two exceptions are stated rather than assumed.
//
// A BARE z-index IS INVISIBLE TO THE NEXT READER. The scale in tokens.base.css documented
// four layers it did not define — "the route overlay (20), the boot splash (55) and the
// toasts (60) stay literals until something needs to reason about them" — and the rules that
// carried those numbers had no way to say what they were above or below. The cost was not
// hypothetical: the ≤800px sticky top bar carried `z-index: 45` under a comment claiming only
// that it must clear the route overlay, and 45 also put it above the scrim (40) and the sheet
// (41), so a modal opened at that width dimmed everything except the top bar and left it
// clickable. Nobody chose that; the literal simply did not say what it was doing.
//
// THE TWO ALLOWED LITERALS are `1` and `2`, and only for stacking WITHIN a component: a
// sticky table header over its own rows, a focused segmented button over its neighbour's
// border, a sticky section title over the rows scrolling behind it. Those are local
// orderings inside one stacking context, not app layers, and giving each a token would
// spend the vocabulary on the one case it cannot help with.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stylesheetClosure } from "./tokens.js";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 */
export function registerZScaleContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const SHEETS = stylesheetClosure(resolve(root, "src/client/styles.css"));
  const LOCAL_LITERALS = ["1", "2"];

  describe(app + ": every app layer is a --z-* token", () => {
    it("uses no bare z-index outside the two component-local values", () => {
      const offenders = [];
      for (const [label, css] of SHEETS) {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of stripped.matchAll(/z-index:\s*([^;}]+)/g)) {
          const value = m[1].trim();
          if (value.startsWith("var(--z-")) continue;
          if (LOCAL_LITERALS.includes(value)) continue;
          offenders.push(label + ": z-index: " + value);
        }
      }
      expect(offenders, "a bare z-index says nothing about what it is above or below")
        .toEqual([]);
    });

    it("is not a vacuous sweep — the sheets really do stack things", () => {
      const all = SHEETS.map(([, css]) => css).join("\n");
      const tokenised = [...all.matchAll(/z-index:\s*var\(--z-[a-z-]+\)/g)].length;
      expect(tokenised, "no tokenised z-index found at all").toBeGreaterThanOrEqual(8);
    });

    it("defines every --z-* token it names, and names every one it defines", () => {
      // A var() pointing at nothing resolves to `auto` and the layer silently collapses into
      // the flow — the loudest possible bug with the quietest possible symptom.
      const all = SHEETS.map(([, css]) => css).join("\n");
      const defined = new Set(
        [...all.matchAll(/^\s*(--z-[a-z-]+):\s*(\d+);/gm)].map((m) => m[1]),
      );
      const used = new Set([...all.matchAll(/var\((--z-[a-z-]+)\)/g)].map((m) => m[1]));
      for (const name of used) {
        expect(defined.has(name), name + " is used but never defined").toBe(true);
      }
      expect(defined.size, "the z scale is empty").toBeGreaterThanOrEqual(10);
    });

    it("keeps the scale strictly ordered, so a comparison between two layers is real", () => {
      // The whole value of a named scale is that "--z-appbar is below --z-scrim" can be read
      // off the names. Two layers sharing a number would make that sentence untrue while
      // every rule still looked correct.
      const tokensCss = SHEETS.find(([label]) => label.endsWith("/tokens.base.css"));
      expect(tokensCss, "no tokens.base.css in the index").toBeTruthy();
      const pairs = [...tokensCss[1].matchAll(/^\s*(--z-[a-z-]+):\s*(\d+);/gm)]
        .map((m) => [m[1], Number(m[2])]);
      const values = pairs.map(([, v]) => v);
      expect(new Set(values).size, "two layers share a z value: "
        + JSON.stringify(pairs)).toBe(values.length);
      expect(values.slice().sort((a, b) => a - b), "the scale is not written in order")
        .toEqual(values);
    });
  });
}
