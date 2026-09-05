// The Help key sheet — W5, repointed by P7.
//
// WHAT CHANGED AND WHY. `gas/` grew the same page, so the page moved to
// `gas_shared/ui/helpPage.js` and its behaviour moved with it, into
// `gas_shared/test/contracts/help.js`. Three describe blocks that used to live in this file —
// the `helpModel` suite, "the help route exists", and the every-id-renders check — are that
// contract now, registered below with this register's own book. NOT ONE ASSERTION WAS DROPPED
// TO MAKE THE MOVE: the claims each encoded are restated in the contract, and two were
// strengthened on the way (the word-boundary anchor is now pinned against a fixture that makes
// "matches at a word start" falsifiable rather than being inferred from whichever words this
// register happens to use; the lane assertion is now tied to the shared hero's own eyebrow,
// which reads the literal "Data").
//
// NO BOOTED DOM (vitest.config.ts sets no `environment`), so the split is unchanged: the pure
// model is exercised directly, the DOM half is read as source text.
//
// PROTECTED FILES THIS SUITE DOES NOT TOUCH: test/pagesLit.test.js, test/helpContent.test.js,
// test/vocabulary.test.js.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allEntries } from "../src/client/js/helpContent.js";
import { registerHelpContract } from "../../gas_shared/test/contracts/help.js";
import { buildHash } from "../../gas_shared/store.js";

const ENTRIES = allEntries();
const APP_ROOT = new URL("../", import.meta.url);

const TIP_SRC = readFileSync(new URL("../../gas_shared/ui/tip.js", import.meta.url), "utf8");
const HELP_TEST_SRC = readFileSync(
  new URL("./helpContent.test.js", import.meta.url), "utf8",
);

// =========================================================================================
//  The shared page's whole contract, registered with this register's book
// =========================================================================================
registerHelpContract({
  describe, it, expect, appRoot: APP_ROOT, app: "dso", entries: ENTRIES, lane: "Data",
});

// =========================================================================================
//  The book this register ships is the book its own registry names
// =========================================================================================
//
// KEPT LOCAL, because it is the one claim above that is about THIS vocabulary rather than
// about the page: the ids helpContent.js defines are exactly the ids test/helpContent.test.js
// pins. That file is protected, so its literal array is read as text the way app.js's PAGES is
// read, rather than imported.
describe("dso: the book matches its own id registry", () => {
  function expectedIds(src) {
    const body = src.slice(
      src.indexOf("const EXPECTED_IDS = ["), src.indexOf("];", src.indexOf("const EXPECTED_IDS = [")),
    );
    return [...body.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  }

  it("defines exactly the ids helpContent.test.js names", () => {
    const expected = expectedIds(HELP_TEST_SRC);
    expect(expected.length).toBeGreaterThan(15); // not a vacuous read of the fixture
    expect(ENTRIES.map((e) => e.id).sort()).toEqual([...expected].sort());
  });
});

// =========================================================================================
//  Every glossary tip's full-entry affordance targets #/help?term=<id>
// =========================================================================================
describe("dso: a glossary tip's full-entry link targets this route", () => {
  it("buildHash(\"help\", { term }) is exactly #/help?term=<id>, for any id", () => {
    for (const e of ENTRIES) {
      expect(buildHash("help", { term: e.id })).toBe(`#/help?term=${e.id}`);
    }
  });

  it("ui/tip.js's markTerm — the function every glossaryTip() trigger is wired through — "
    + "navigates to the help route by name, generically, not to a hardcoded id", () => {
    // markTerm(trigger, term) is what ACTIVATE.set(...) resolves to on click for EVERY
    // glossaryTip()/tip({term}) caller in the app, so a single source check here covers every
    // call site — the same reasoning test/pagesLit.test.js's exit gate 6/7 uses.
    const fn = TIP_SRC.slice(TIP_SRC.indexOf("function markTerm"), TIP_SRC.indexOf("function withTerm"));
    expect(fn).toMatch(/navigate\(\s*"help"\s*,\s*\{\s*term\s*\}\s*\)/);
  });

  it("glossaryTip() passes its own entryId through as `term`, so markTerm's navigation "
    + "carries the SAME id the card defines", () => {
    const fn = TIP_SRC.slice(
      TIP_SRC.indexOf("export function glossaryTip"),
      TIP_SRC.indexOf("/**", TIP_SRC.indexOf("export function glossaryTip") + 1),
    );
    expect(fn).toMatch(/term:\s*entryId/);
  });
});
