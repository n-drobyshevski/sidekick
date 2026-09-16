// `ui/sheet.js`'s `collapsibleSection` — a whole section behind its own heading, and the two
// affordances that must not be the same one.
//
// WHY THIS IS A SOURCE SWEEP AND NOT A RENDER. `test/domStub.js` is deliberately smaller than
// a browser (no `closest`, no `classList`, no event dispatch, no `<details>` activation
// behaviour) and its own header says a test needing more than it supports is asking a question
// it cannot answer honestly. Everything below IS such a question — it is about what a click on
// a `<summary>` does — so it is swept as source text, the house pattern every DOM half in this
// repo is held to (`historyDom.test.js`, `figuresOverProse.test.js`, `wordsOneLevelDown.js`).
//
// THE FOUR THINGS THAT CAN GO WRONG, each one a rewrite somebody would reasonably make:
//
//   1. THE HEADING BECOMES THE TIP TRIGGER. `sectionLabel(text, help)` is right there and it
//      reads like the obvious way to put the section's name in the summary. It turns the WHOLE
//      heading into a `.tip-trigger` button — so the most obvious click target on the page
//      stops opening the section, and a `{term}` help makes one click both toggle the section
//      AND navigate to the Help entry. The help belongs on a `tipMark()` "?" beside the name.
//   2. THE GUARD STOPS PROPAGATION INSTEAD OF THE DEFAULT. `stopPropagation()` looks like the
//      stronger fix and is the wrong one: `ui/tip.js` listens on `document`, so a tip click
//      that never reaches it is a "?" that reveals nothing and a term that never routes. Only
//      `preventDefault()` cancels the summary's activation behaviour while leaving the
//      delegated listener intact.
//   3. `open` IS READ OFF THE NODE. A section rebuilt on every paint — which is what an swr
//      page does, twice on a warm cache — snaps shut under a reader who had just expanded it
//      unless the flag lives with the caller and is handed back in.
//   4. A DENIED localStorage TAKES THE SECTION WITH IT. `remember` is a convenience; a private
//      window or an embedded iframe that throws on `getItem` must fall back to the caller's own
//      default, not to "shut", and must not throw out of the render.
//
// Perturbed inline: each claim below reproduces the tempting rewrite as a string and shows the
// same assertion failing on it, so none of these is a rule restated from a comment.

import { readFileSync } from "node:fs";

import { code } from "./emptyStates.js";

// Comment-stripped: this module's own header and the component's quote the shapes being ruled
// out, and a raw sweep would find them in the prose that rejects them.
const SHEET_SRC = code(readFileSync(new URL("../../ui/sheet.js", import.meta.url), "utf8"));

/** `collapsibleSection`'s body, from its declaration to the next top-level `function`. */
function componentBody(src) {
  const start = src.indexOf("export function collapsibleSection(");
  if (start === -1) throw new Error("collapsibleSection is gone from ui/sheet.js");
  const next = src.indexOf("\nfunction ", start);
  return src.slice(start, next === -1 ? src.length : next);
}

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 */
export function registerCollapsibleSectionContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const BODY = componentBody(SHEET_SRC);

  describe(app + ": collapsibleSection — the heading toggles, the ? defines", () => {
    it("puts a plain h2 in the summary and the help on a tipMark, never sectionLabel", () => {
      expect(BODY).toMatch(/el\("h2", \{ class: "section-label section-collapse__title" \}, label\)/);
      expect(BODY).toMatch(/tipLabel\(tipMark\(\), p\.help\)/);
      // The rewrite this rules out, and why a bare "is sectionLabel called" check is not it:
      // `sectionLabel` is exported from this same file, so the NAME is in the source either
      // way. The claim is about the summary's own children.
      const defective = 'el("summary", {}, caret, sectionLabel(label, p.help))';
      expect(/el\("h2", \{ class: "section-label section-collapse__title" \}, label\)/
        .test(defective)).toBe(false);
    });

    it("cancels the summary's default on a tip click, and never its propagation", () => {
      expect(BODY).toContain('t.closest("[data-tip]")');
      expect(BODY).toContain("e.preventDefault()");
      // ui/tip.js is a document-level delegate (five listeners for the whole app), so the
      // stronger-looking fix is the one that breaks it.
      expect(BODY).not.toContain("stopPropagation");
      const defective = 'summary.addEventListener("click", (e) => { e.stopPropagation(); });';
      expect(defective.includes("stopPropagation")).toBe(true);
    });

    it("takes its open state from the caller and reports every change back", () => {
      expect(BODY).toMatch(/const open = stored === null \? p\.open === true : stored;/);
      expect(BODY).toMatch(/\{ class: "section-collapse", open \}/);
      expect(BODY).toMatch(/node\.addEventListener\("toggle"/);
      expect(BODY).toContain("p.onToggle(node.open)");
      // The rewrite: a `<details>` left to hold its own state. It renders identically on a
      // first paint and loses the reader's expansion on the second.
      const defective = 'el("details", { class: "section-collapse" }, summary, body)';
      expect(/\{ class: "section-collapse", open \}/.test(defective)).toBe(false);
    });

    it("falls back to the caller's default when the store is unreadable, never to shut", () => {
      const read = SHEET_SRC.slice(SHEET_SRC.indexOf("function readOpen("));
      expect(read).toMatch(/return raw === null \? null : raw === "1";/);
      // `null`, NOT `false`: the caller's `open` has to survive a denied store. Returning
      // false here is the one-character version of "every reader gets it shut forever".
      expect(read.slice(0, read.indexOf("function writeOpen("))).toMatch(/catch \(e\) \{\s*return null;/);
      const defective = "catch (e) { return false; }";
      expect(/catch \(e\) \{\s*return null;/.test(defective)).toBe(false);
    });

    it("namespaces the remembered flag under the host app's own storage prefix", () => {
      // Two sidekicks are served from the same origin; `storageKey` is the one place that
      // knows which one this is. A bare literal would let them share a key.
      expect(BODY.includes("localStorage.getItem(")).toBe(false);
      expect(SHEET_SRC).toContain('storageKey("section:" + name)');
    });
  });
}
