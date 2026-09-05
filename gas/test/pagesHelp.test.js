// The Help key sheet — P7.
//
// THIS FILE IS THIN ON PURPOSE. The page is `gas_shared/ui/helpPage.js`, shared with
// `gas_devsecops`, so its behaviour is pinned once in `gas_shared/test/contracts/help.js` and
// registered from both apps. Duplicating those assertions here would be the third copy the
// package exists to remove. What is left below is the part that is only true HERE: the route's
// place in this register's nav, and the wiring that finally makes a glossary trigger arrive.
//
// NO BOOTED DOM (vitest.config.ts sets no `environment`), so both this file and the contract
// follow the split every page test in this repo uses: the pure model is exercised directly and
// the DOM half is read as source text.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allEntries } from "../src/client/js/helpContent.js";
import { registerHelpContract } from "../../gas_shared/test/contracts/help.js";
import { buildHash } from "../../gas_shared/store.js";

const ENTRIES = allEntries();
const APP_ROOT = new URL("../", import.meta.url);

/** Source with comments removed — every sweep below is a claim about CODE, and several of
 *  the comments this package wrote explain the very rule they sit beside. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const APP_SRC = code(
  readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8"),
);
const TIP_SRC = readFileSync(new URL("../../gas_shared/ui/tip.js", import.meta.url), "utf8");

// =========================================================================================
//  The shared page's whole contract, registered with this register's book
// =========================================================================================
registerHelpContract({
  describe, it, expect, appRoot: APP_ROOT, app: "os", entries: ENTRIES,
  // Not passed as an override — "Data" is the default — but the lane is the one argument that
  // decides where this register files the key sheet, and gas_ai files it in the chrome tail
  // instead. Naming it here rather than defaulting is how that disagreement stays visible.
  lane: "Data",
});

// =========================================================================================
//  The wiring that was missing until this package: the manifest's own resolver
// =========================================================================================
describe("os: the manifest resolves a term to a real entry", () => {
  it("hands the shared tip layer this register's findEntry, not the null placeholder", () => {
    // THE CLAIM THIS REPLACES. Until now MANIFEST.findHelpEntry was `() => null` — a resolver
    // that resolves nothing — which is what made `glossaryTip` degrade to a plain label on
    // every call site in this app. That was correct while there was no book; it is a defect
    // now that there is one, and the two halves have to land together: a book with no resolver
    // is unreachable, and a resolver with no route sends a reader nowhere.
    expect(APP_SRC).toContain("findHelpEntry: findEntry,");
    expect(APP_SRC).not.toContain("findHelpEntry: () => null");
    expect(APP_SRC).toMatch(/import \{ findEntry \} from "\.\/helpContent\.js";/);
  });

  it("still ships the resolves-nothing shape as a FUNCTION in the shared fixture", () => {
    // gas_shared/test/testConfig.js is a manifest fixture with no book, and ui/tip.js calls
    // findHelpEntry as a function — a literal null there would throw rather than degrade.
    const fixture = readFileSync(
      new URL("../../gas_shared/test/testConfig.js", import.meta.url), "utf8",
    );
    expect(fixture).toMatch(/findHelpEntry:\s*\(\)\s*=>/);
  });
});

// =========================================================================================
//  Every glossary trigger's full-entry affordance targets this route
// =========================================================================================
describe("os: a glossary tip's full-entry link targets this route", () => {
  it("buildHash(\"help\", { term }) is exactly #/help?term=<id>, for every id in the book", () => {
    for (const e of ENTRIES) {
      expect(buildHash("help", { term: e.id })).toBe(`#/help?term=${e.id}`);
    }
  });

  it("markTerm — what every term-bearing trigger resolves to on click — navigates to the "
    + "help route BY NAME, generically, not to a hardcoded id", () => {
    // One source check covers every call site: ACTIVATE.set(trigger, () => navigate("help",
    // { term })) in gas_shared/ui/tip.js is what a click on any `{ term }` trigger runs.
    const fn = TIP_SRC.slice(TIP_SRC.indexOf("function markTerm"), TIP_SRC.indexOf("function withTerm"));
    expect(fn).toMatch(/navigate\(\s*"help"\s*,\s*\{\s*term\s*\}\s*\)/);
  });

  it("glossaryTip() passes its own entryId through as `term`", () => {
    const fn = TIP_SRC.slice(
      TIP_SRC.indexOf("export function glossaryTip"),
      TIP_SRC.indexOf("/**", TIP_SRC.indexOf("export function glossaryTip") + 1),
    );
    expect(fn).toMatch(/term:\s*entryId/);
  });
});

// =========================================================================================
//  A term tip is never put on a control that already owns its click
// =========================================================================================
//
// THE DEFECT THIS PINS IS REAL AND WAS CAUGHT WHILE RETROFITTING, NOT IMAGINED. `markTerm`
// registers an anchor in tip.js's ACTIVATE map, and tip.js's delegated document click handler
// runs `act(e)` — navigate("help", { term }) — WITHOUT preventDefault or stopPropagation. Where
// `tip()` attaches IN PLACE to an element that is already interactive (INTERACTIVE[tagName]),
// and that element carries its own onclick, a single click therefore fires BOTH: the control's
// action, and a route change away from the page about to show its result.
//
// Two call sites in this app are that shape — the Quick refresh button (startScan) and each of
// the six matrix cells (openCohort) — and both take `bookTip` instead, which reads the same
// entry out of the same book and attaches no activation. The sentence still lives once; the
// button still does one thing.
describe("os: the two already-actionable triggers read the book without hijacking the click", () => {
  const PROGRAM_SRC = code(readFileSync(
    new URL("../src/client/js/pages/program.js", import.meta.url), "utf8",
  ));
  // The CELLS table alone. `help:` is a legitimate key elsewhere in this file — three
  // dataTable columns carry one — so a whole-file sweep for it would be about the wrong
  // thing, which is what the first pass did.
  const CELLS_SRC = PROGRAM_SRC.slice(
    PROGRAM_SRC.indexOf("const CELLS = {"), PROGRAM_SRC.indexOf("};", PROGRAM_SRC.indexOf("const CELLS = {")),
  );

  it("tip.js's click delegate really does run the activation without cancelling the event", () => {
    // The premise, read from the source rather than assumed. If this ever stops being true
    // the two bookTip call sites below can become term tips, and this test is where that is
    // noticed.
    const handler = TIP_SRC.slice(
      TIP_SRC.indexOf('document.addEventListener("click"'),
      TIP_SRC.indexOf("/**", TIP_SRC.indexOf('document.addEventListener("click"')),
    );
    expect(handler).toContain("const act = ACTIVATE.get(anchor);");
    // The one preventDefault in there belongs to the coarse-pointer first-tap branch, which
    // returns before reaching the activation at all.
    const afterAct = handler.slice(handler.indexOf("const act = ACTIVATE.get(anchor);"));
    expect(afterAct).not.toContain("preventDefault");
    expect(afterAct).not.toContain("stopPropagation");
  });

  it("the Quick refresh button takes bookTip, never a term tip", () => {
    expect(APP_SRC).toContain('bookTip(quickBtn, "quick-refresh")');
    expect(APP_SRC).not.toMatch(/tip\(quickBtn[\s\S]{0,200}term:/);
  });

  it("every matrix cell takes bookTip, and CELLS carries a term rather than a help string", () => {
    expect(PROGRAM_SRC).toContain("bookTip(btn, spec.term)");
    expect(CELLS_SRC, "a CELLS entry still holds its own help copy").not.toContain("help:");
    // Not a vacuous read: all six cells resolve to a real entry.
    const ids = ENTRIES.map((e) => e.id);
    for (const term of ["cell-tp", "cell-fp", "cell-fn", "cell-tn",
      "cell-unclassified-remediated", "cell-unclassified-open"]) {
      expect(CELLS_SRC, `CELLS does not name ${term}`).toContain(`"${term}"`);
      expect(ids, `${term} is not in the book`).toContain(term);
    }
  });
});
