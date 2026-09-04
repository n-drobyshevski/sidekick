// The Help key sheet — W5.
//
// NO BOOTED DOM (vitest.config.ts sets no `environment`), so this file follows the split
// every page test in this repo uses: `helpModel` is pure and is exercised directly; the DOM
// half (`renderHelp`) is read as source text, the same way `test/shared.test.js` reads
// `app.js`'s PAGES table and `test/pagesData.test.js` reads its three pages.
//
// THREE THINGS THIS FILE PINS, one per section below:
//   1. helpModel() — the search/deep-link logic — filters case-insensitively and marks the
//      right entry without throwing on a bad id.
//   2. The route actually exists: PAGES carries `help` in the Data lane, routeIcons.js has
//      its mark, and every id helpContent.js defines renders as exactly one entry.
//   3. Every glossary tip's "full entry" affordance (ui/tip.js's markTerm, wired through
//      glossaryTip) targets `#/help?term=<id>` — the route this package adds is the same one
//      that affordance has named since before this route existed.
//
// PROTECTED FILES THIS SUITE DOES NOT TOUCH: test/shared.test.js, test/pagesLit.test.js,
// test/helpContent.test.js, test/vocabulary.test.js. Both of the first two hardcode "the ten
// routes" as a literal array and fail, unedited, now that PAGES carries an eleventh —
// documented in the handback, not worked around here.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allEntries } from "../src/client/js/helpContent.js";
import { helpModel } from "../src/client/js/pages/help.js";
import { buildHash } from "../../gas_shared/store.js";

const ENTRIES = allEntries();

const APP_SRC = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");
const ROUTE_ICONS_SRC = readFileSync(
  new URL("../src/client/js/routeIcons.js", import.meta.url), "utf8",
);
const TIP_SRC = readFileSync(new URL("../../gas_shared/ui/tip.js", import.meta.url), "utf8");
const HELP_TEST_SRC = readFileSync(
  new URL("./helpContent.test.js", import.meta.url), "utf8",
);

// =========================================================================================
//  1. helpModel — pure search + deep-link logic
// =========================================================================================

describe("helpModel", () => {
  it("returns every entry when the query is empty", () => {
    const m = helpModel(ENTRIES, "", "");
    expect(m.total).toBe(ENTRIES.length);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].entries).toHaveLength(ENTRIES.length);
    // Alphabetical by term, so a reader scanning the page can predict where a word sits.
    const terms = m.groups[0].entries.map((e) => e.term);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
  });

  it("filters to entries whose term or body match every query word", () => {
    // "sync" the term is a whole word inside the sync entry's own lines and nowhere else
    // that isn't also legitimately about the act of syncing.
    const m = helpModel(ENTRIES, "kaplan", "");
    expect(m.groups[0].entries.map((e) => e.id)).toEqual(["half-life"]);
  });

  it("a multi-word query requires every word to match, in any order", () => {
    const m = helpModel(ENTRIES, "path line", "");
    const ids = m.groups[0].entries.map((e) => e.id);
    // "twin" is the only entry whose body carries both "path" and "line".
    expect(ids).toContain("twin");
    for (const e of m.groups[0].entries) {
      const hay = (e.term + " " + e.lines.join(" ")).toLowerCase();
      expect(hay).toMatch(/\bpath/);
      expect(hay).toMatch(/\bline/);
    }
  });

  it("marks the entry a ?term= deep link named, and reports it as the match", () => {
    const m = helpModel(ENTRIES, "", "lower-bound");
    const marked = m.groups[0].entries.filter((e) => e.linked);
    expect(marked.map((e) => e.id)).toEqual(["lower-bound"]);
    expect(m.match).toBe("lower-bound");
  });

  it("an id the book does not carry marks nothing and does not throw", () => {
    expect(() => helpModel(ENTRIES, "", "not-a-real-term")).not.toThrow();
    const m = helpModel(ENTRIES, "", "not-a-real-term");
    expect(m.groups[0].entries.some((e) => e.linked)).toBe(false);
    expect(m.match).toBeNull();
  });

  it("an empty or absent term marks nothing, without throwing", () => {
    for (const term of ["", null, undefined]) {
      expect(() => helpModel(ENTRIES, "", term)).not.toThrow();
      const m = helpModel(ENTRIES, "", term);
      expect(m.groups[0].entries.some((e) => e.linked)).toBe(false);
      expect(m.match).toBeNull();
    }
  });

  it("an empty result renders no groups, for the page's emptyState branch", () => {
    const m = helpModel(ENTRIES, "not a word this book uses anywhere at all", "");
    expect(m.groups).toEqual([]);
    expect(m.total).toBe(ENTRIES.length); // total is the book, not the filtered count
  });

  it("does not throw on a non-array entries argument", () => {
    expect(() => helpModel(null, "sync", "")).not.toThrow();
    expect(helpModel(undefined, "", "x")).toEqual({ groups: [], match: null, total: 0 });
  });

  // ---------------------------------------------------------------------------------------
  // PERTURBATION: is the case-insensitivity real, or decorative?
  //
  // helpModel is supposed to match "SAST" and "sast" alike (CLAUDE.md: "a guard that fires
  // on nothing is a finding — perturb every guard you write"). Proven by actually breaking
  // it: matchesEntry()'s haystack was left un-lowercased for one run
  // (`entry.term + " " + entry.lines.join(" ")`, the trailing `.toLowerCase()` removed) —
  // `normalize(query)` still lowercases the QUERY side, so "SAST" against an un-lowercased
  // "SAST ..." haystack still can't fail on case alone, which is exactly why this assertion
  // is written as upper-vs-lower agreement rather than as one hardcoded expectation. Run
  // against the real source with that one line removed:
  //
  //   FAIL  test/pagesHelp.test.js > helpModel > matches case-insensitively — a capitalised
  //         query still finds a lowercase-bodied term
  //   TypeError: Cannot read properties of undefined (reading 'entries')
  //    ❯ test/pagesHelp.test.js:130:28
  //      128|     const upper = helpModel(ENTRIES, "SAST", "");
  //      129|     const lower = helpModel(ENTRIES, "sast", "");
  //      130|     expect(upper.groups[0].entries.map((e) => e.id)).toEqual(lower.gro…
  //
  // `upper.groups` came back `[]` — the lowercase query "sast" no longer matched the
  // capitalised "SAST" sitting in the untouched haystack, so `groups[0]` was undefined and
  // the assertion never got far enough to compare ids. Reverted immediately after (this
  // file's `matchesEntry` carries the `.toLowerCase()` again).
  it("matches case-insensitively — a capitalised query still finds a lowercase-bodied term", () => {
    const upper = helpModel(ENTRIES, "SAST", "");
    const lower = helpModel(ENTRIES, "sast", "");
    expect(upper.groups[0].entries.map((e) => e.id)).toEqual(lower.groups[0].entries.map((e) => e.id));
    expect(upper.groups[0].entries.map((e) => e.id)).toContain("sast");
  });
});

// =========================================================================================
//  2. The route exists: PAGES, the icon, and every glossary id renders
// =========================================================================================

/** Read the PAGES table out of app.js as text — mirrors test/shared.test.js's parser. */
function parsePages(src) {
  const body = src.slice(src.indexOf("const PAGES = {"), src.indexOf("\n};", src.indexOf("const PAGES = {")));
  const out = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{2}(\w+):\s*\{(.*)$/);
    if (!m) continue;
    const groupMatch = m[2].match(/group:\s*(null|"([^"]*)")/);
    out.push({
      route: m[1],
      group: groupMatch ? (groupMatch[1] === "null" ? null : groupMatch[2]) : undefined,
      title: (m[2].match(/title:\s*"([^"]*)"/) || [])[1],
    });
  }
  return out;
}

/** The EXPECTED_IDS array test/helpContent.test.js pins, read as text rather than imported —
 *  that file is protected, so this reads its literal array the way shared.test.js reads
 *  app.js's PAGES rather than importing anything from it. */
function expectedIds(src) {
  const body = src.slice(src.indexOf("const EXPECTED_IDS = ["), src.indexOf("];", src.indexOf("const EXPECTED_IDS = [")));
  return [...body.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

describe("the help route exists", () => {
  const pages = parsePages(APP_SRC);
  const help = pages.find((p) => p.route === "help");

  it("PAGES carries a help route, in the Data lane", () => {
    expect(help, "app.js's PAGES has no help route").toBeTruthy();
    expect(help.group).toBe("Data");
    expect(help.title).toBeTruthy();
  });

  it("is the last page in the Data lane", () => {
    const dataRoutes = pages.filter((p) => p.group === "Data").map((p) => p.route);
    expect(dataRoutes[dataRoutes.length - 1]).toBe("help");
  });

  it("app.js imports renderHelp from ./pages/help.js", () => {
    expect(APP_SRC).toMatch(/import \{ renderHelp \} from "\.\/pages\/help\.js";/);
  });

  it("routeIcons.js gives the help route exactly one mark, on the shared 24-grid", () => {
    const m = ROUTE_ICONS_SRC.match(/help:\s*'([^']+)'/);
    expect(m, "routeIcons.js has no help icon").toBeTruthy();
    const svg = m[1];
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain("currentColor");
    expect(svg).toContain('aria-hidden="true"');
  });

  it("every id helpContent.js defines is exactly the book EXPECTED_IDS names, and the model "
    + "renders one entry per id", () => {
    const expected = expectedIds(HELP_TEST_SRC);
    expect(expected.length).toBeGreaterThan(15); // not a vacuous read of the fixture
    expect(ENTRIES.map((e) => e.id).sort()).toEqual([...expected].sort());

    const m = helpModel(ENTRIES, "", "");
    const rendered = m.groups[0].entries.map((e) => e.id).sort();
    expect(rendered).toEqual([...expected].sort());
  });

  // ---------------------------------------------------------------------------------------
  // PERTURBATION: remove the route, watch this test AND shared.test.js both catch it.
  //
  // Performed against the real source (app.js's `help: { ... }` entry deleted, the import
  // line and routeIcons.js's icon both left in place so only the PAGES registration was
  // missing), then reverted:
  //
  //   FAIL  test/pagesHelp.test.js > the help route exists > PAGES carries a help route, in
  //         the Data lane
  //   AssertionError: app.js's PAGES has no help route: expected undefined to be truthy
  //
  //   FAIL  test/shared.test.js > nav marks > give every route exactly one
  //   AssertionError: expected [ 'data', 'executive', 'help', …(8) ] to deeply equal
  //   [ Array(10) ]
  //     @@ -1,8 +1,9 @@
  //        [
  //          "data",
  //          "executive",
  //     +   "help",
  //          "history",
  //     (ROUTE_ICONS still names "help" — the icon this package also added — while PAGES no
  //     longer does, so the two sorted key lists stop matching one-for-one. Removing the
  //     PAGES row and NOT the icon is deliberate: it is what makes the failure be about the
  //     route disappearing rather than about a leftover icon nobody would call the same bug.
  //     "the route table > parses, and holds the ten routes" does NOT fail on this
  //     perturbation — removing the row restores the exact ten-route array that test still
  //     hardcodes, which is the fixed-cardinality tension the handback reports separately.)
  //
  // Both failures are what proves this suite and shared.test.js are actually looking at
  // the live PAGES table rather than a fixture of their own — the second one is a fact about
  // a file this package may not edit, restated here as evidence rather than asserted as a
  // requirement.
  it("is a route this test would actually notice losing (see the perturbation note above)", () => {
    expect(pages.map((p) => p.route)).toContain("help");
  });
});

// =========================================================================================
//  3. Every glossary tip's full-entry affordance targets #/help?term=<id>
// =========================================================================================

describe("a glossary tip's full-entry link targets this route", () => {
  it("buildHash(\"help\", { term }) is exactly #/help?term=<id>, for any id", () => {
    for (const e of ENTRIES) {
      expect(buildHash("help", { term: e.id })).toBe(`#/help?term=${e.id}`);
    }
  });

  it("ui/tip.js's markTerm — the function every glossaryTip() trigger is wired through — "
    + "navigates to the help route by name, generically, not to a hardcoded id", () => {
    // markTerm(trigger, term) is what ACTIVATE.set(...) resolves to on click for EVERY
    // glossaryTip()/tip({term}) caller in the app (ui/tip.js: "ACTIVATE.set(trigger, () =>
    // navigate("help", { term }))"), so a single source check here covers every call site —
    // the same reasoning test/pagesLit.test.js's exit gate 6/7 uses for glossary ids.
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
