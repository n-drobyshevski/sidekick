// segmented() replaces every hand-rolled toggle, and this file is the guard that stops the
// hand-rolled recipe drifting back in.
//
// FIVE CALL SITES ACROSS mttr.js/overview.js/data.js each rebuilt the exact same thing by
// hand: a joined or unboxed row of aria-pressed buttons, the pressed one styled by a
// `.seg-btn[aria-pressed="true"]` rule, a compact variant via `.seg-btn--sm`, the row itself
// via `.seg-row` — which is precisely what gas_shared/ui/controls.js's `segmented()` already
// is (components.css's `.segmented` rule carries the identical recipe once, for four apps).
// Every one of the five now takes the shared control (pages/mttr.js's `toggleRow`, its own
// by-domain KM/Naive clock toggle, the Distribution/Survival/Trends-timeframe controls;
// pages/overview.js's Oldest-open-findings view and Concentration-dimension toggles;
// pages/data.js's Report-format toggle), and `.seg-btn`/`.seg-btn--sm`/`.seg-row` are deleted
// from pages.css — this file is what makes that deletion safe rather than merely convenient.
//
// WHY SOURCE TEXT. There is no jsdom in this app (vitest.config.ts sets no `environment`), and
// the claim is about which classes a page's markup REACHES FOR — a property of the module
// rather than of any one rendered output. `code()` strips comments first (both `//` and CSS's
// `/* */`) so a doc comment — including this file's own header, and pages.css's own retirement
// note — never trips its own guard.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);
const PAGES_CSS_URL = new URL("../src/client/styles/pages.css", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

/**
 * `seg-btn` / `seg-row` as a whole word, comment-stripped first. Whole-word rather than a
 * bare substring match: `.segmented`'s own name and `seg-btn`'s replacement, `segmented(`,
 * share the "seg" prefix, and a substring test would flag every call site this package just
 * finished converting.
 *
 * @param {string} src  raw source (JS or CSS both work — `code()` strips `//` and `/* *\/`
 *                      generically, and CSS has no `//` comments to over-strip)
 * @returns {string[]}  the forbidden class names found, empty when clean
 */
function segClassHits(src) {
  const stripped = code(src);
  const hits = [];
  if (/\bseg-btn\b/.test(stripped)) hits.push("seg-btn");
  if (/\bseg-row\b/.test(stripped)) hits.push("seg-row");
  return hits;
}

describe("segmented() replaces every hand-rolled toggle", () => {
  it("no page module under src/client/js/pages/ hand-types a seg-btn/seg-row class", () => {
    for (const file of pageFiles()) {
      const src = readFileSync(new URL(file, PAGES_DIR), "utf8");
      expect(segClassHits(src), `pages/${file} still carries a hand-rolled seg-btn/seg-row class`)
        .toEqual([]);
    }
  });

  it("pages.css carries no .seg-btn / .seg-btn--sm / .seg-row rule any more", () => {
    const css = readFileSync(PAGES_CSS_URL, "utf8");
    expect(segClassHits(css)).toEqual([]);
  });

  // NOT A VACUOUS SWEEP. The two checks above only bite where a `seg-btn`/`seg-row` literal
  // exists at all; this perturbation proves the sweep function catches the exact shape a
  // regression would take, reproduced and shown failing rather than asserted from a comment.
  it("the sweep catches a reintroduced seg-btn class", () => {
    const REGRESSED_TOGGLE = `
      // a page-shaped snippet reintroducing the old hand-rolled toggle
      const btn = el("button", { class: "seg-btn", type: "button" }, "Label");
    `;
    expect(segClassHits(REGRESSED_TOGGLE)).toContain("seg-btn");
  });

  it("the sweep catches a reintroduced seg-row wrapper", () => {
    const REGRESSED_ROW = `
      const row = el("div", { class: "seg-row", role: "group" });
    `;
    expect(segClassHits(REGRESSED_ROW)).toContain("seg-row");
  });

  it("the sweep's stripper does not fire on a comment merely mentioning the old classes", () => {
    const commentOnly = `
      // this used to be a hand-rolled .seg-row of .seg-btn buttons — see history
      export function render() { return "fine"; }
    `;
    expect(segClassHits(commentOnly)).toEqual([]);
  });

  it("does not fire on segmented()'s own name or the segmented-btn glyph of unrelated words", () => {
    // "segmented(" and ".segmented" share the "seg" prefix with "seg-btn"/"seg-row" but are
    // not them — a substring sweep would have flagged every converted call site.
    const CONVERTED_CALL_SITE = `
      const toggle = segmented({
        options: [{ value: "km", label: "KM" }],
        value: "km",
        ariaLabel: "MTTR clock",
        onChange: () => {},
      });
    `;
    expect(segClassHits(CONVERTED_CALL_SITE)).toEqual([]);
  });
});
