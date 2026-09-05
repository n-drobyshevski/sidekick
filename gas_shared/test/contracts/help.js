// The key sheet is one page, and this is what holds every consumer to it.
//
// `gas_shared/ui/helpPage.js` serves `gas/` and `gas_devsecops/`. `gas_ai/` renders a bespoke
// lexicon page and does NOT register this contract — that is the documented exception, stated
// in `gas_shared/README.md` and at the top of `gas_ai/src/client/js/pages/help.js`, not an
// omission. Nothing here is reachable unless an app calls it, which is what "optional" means
// in this directory: a factory, never a test file (vitest collects only each app's own
// `test/`).
//
// WHAT IS PINNED HERE RATHER THAN PER APP: the model's behaviour, which is identical by
// construction, and the two facts about the ROUTE that both consumers agreed on independently
// — help sits in the `Data` lane, and it is the last page of it. The second is not decoration:
// `renderHelpPage`'s hero eyebrow reads the literal "Data", so a consumer that filed the route
// under another lane would ship a page whose own header named the wrong one. This assertion is
// what stops that, and it is why the eyebrow is allowed to be a literal.
//
// WHAT IS NOT PINNED HERE: the vocabulary. Which terms a register defines is the part that is
// genuinely per-app, and each app's own `test/helpContent.test.js` holds its id set.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { helpModel } from "../../ui/helpPage.js";

/** Source with comments removed. Every sweep below is a claim about CODE; a header that
 *  explains the very rule it is about would otherwise trip its own assertion, which is a test
 *  reading its own documentation rather than the program. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Read the PAGES table out of app.js as text — importing it would need a DOM. */
function parsePages(appSrc) {
  const start = appSrc.indexOf("const PAGES = {");
  if (start === -1) throw new Error("parsePages(): no `const PAGES = {` in app.js");
  const body = appSrc.slice(start, appSrc.indexOf("\n};", start));
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

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {Array}    ctx.entries    this register's own `allEntries()`
 * @param {string}   [ctx.lane]     the PAGES lane the route belongs to. Default "Data".
 */
export function registerHelpContract(ctx) {
  const { describe, it, expect, app, entries } = ctx;
  const lane = ctx.lane || "Data";
  const root = fileURLToPath(ctx.appRoot);
  const APP_SRC = readFileSync(resolve(root, "src/client/js/app.js"), "utf8");
  const ROUTE_ICONS_SRC = readFileSync(resolve(root, "src/client/js/routeIcons.js"), "utf8");
  const PAGE_SRC = readFileSync(resolve(root, "src/client/js/pages/help.js"), "utf8");
  const SHARED_SRC = readFileSync(
    fileURLToPath(new URL("../../ui/helpPage.js", import.meta.url)), "utf8",
  );

  // =======================================================================================
  //  1. helpModel — pure search + deep-link logic
  // =======================================================================================
  describe(app + ": helpModel", () => {
    it("returns every entry when the query is empty", () => {
      const m = helpModel(entries, "", "");
      expect(m.total).toBe(entries.length);
      expect(m.groups).toHaveLength(1);
      expect(m.groups[0].entries).toHaveLength(entries.length);
      // Alphabetical by term, so a reader scanning the page can predict where a word sits.
      const terms = m.groups[0].entries.map((e) => e.term);
      expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
    });

    // THE SEARCH CLAIMS ARE PINNED AGAINST A FIXTURE, NOT AGAINST THE REGISTER'S OWN WORDS.
    // Deriving a two-word query or a mid-word fragment out of whichever vocabulary the app
    // happens to ship makes the assertion depend on prose edits, and a search test that goes
    // green because nobody happens to use the word "syncing" any more has stopped testing
    // anything. `helpModel` is pure, so it can be asked directly. The register's own entries
    // are used above and below for the claims that ARE about the register.
    const FIXTURE = [
      { id: "b-second", term: "Beta term", lines: ["Resyncing a shard rewrites it.", "Two."] },
      { id: "a-first", term: "Alpha term", lines: ["Sync the ledger and the shard.", "Two."] },
    ];

    it("a multi-word query requires every word to match, in any order", () => {
      const m = helpModel(FIXTURE, "shard sync", "");
      expect(m.groups[0].entries.map((e) => e.id)).toEqual(["a-first"]);
      // Order-independent: the same two words the other way round pick the same entry.
      expect(helpModel(FIXTURE, "sync shard", "").groups[0].entries.map((e) => e.id))
        .toEqual(["a-first"]);
    });

    it("anchors a query word to a word START, so it never matches mid-word", () => {
      // "sync" is a word start in a-first ("Sync the ledger") and sits MID-WORD in b-second
      // ("Resyncing"). A bare substring match would return both; the `\b` returns one.
      expect(helpModel(FIXTURE, "sync", "").groups[0].entries.map((e) => e.id))
        .toEqual(["a-first"]);
      // A true prefix still matches: "syn" reaches "Sync", and still not "Resyncing".
      expect(helpModel(FIXTURE, "syn", "").groups[0].entries.map((e) => e.id))
        .toEqual(["a-first"]);
      // And a fragment that only ever appears inside a word matches nothing at all.
      expect(helpModel(FIXTURE, "yncing", "").groups).toEqual([]);
    });

    it("sorts by term rather than by declaration order", () => {
      // FIXTURE is declared Beta-then-Alpha on purpose: a model that preserved input order
      // would return b-second first and this would fail.
      expect(helpModel(FIXTURE, "", "").groups[0].entries.map((e) => e.id))
        .toEqual(["a-first", "b-second"]);
    });

    it("marks the entry a ?term= deep link named, and reports it as the match", () => {
      const id = entries[0].id;
      const m = helpModel(entries, "", id);
      expect(m.groups[0].entries.filter((e) => e.linked).map((e) => e.id)).toEqual([id]);
      expect(m.match).toBe(id);
    });

    it("an id the book does not carry marks nothing and does not throw", () => {
      expect(() => helpModel(entries, "", "not-a-real-term")).not.toThrow();
      const m = helpModel(entries, "", "not-a-real-term");
      expect(m.groups[0].entries.some((e) => e.linked)).toBe(false);
      expect(m.match).toBeNull();
    });

    it("an empty or absent term marks nothing, without throwing", () => {
      for (const term of ["", null, undefined]) {
        expect(() => helpModel(entries, "", term)).not.toThrow();
        const m = helpModel(entries, "", term);
        expect(m.groups[0].entries.some((e) => e.linked)).toBe(false);
        expect(m.match).toBeNull();
      }
    });

    it("an empty result renders no groups, for the page's emptyState branch", () => {
      const m = helpModel(entries, "not a word this book uses anywhere at all", "");
      expect(m.groups).toEqual([]);
      expect(m.total).toBe(entries.length); // total is the book, not the filtered count
    });

    it("does not throw on a non-array entries argument", () => {
      expect(() => helpModel(null, "sync", "")).not.toThrow();
      expect(helpModel(undefined, "", "x")).toEqual({ groups: [], match: null, total: 0 });
    });

    // -------------------------------------------------------------------------------------
    // PERTURBATION: is the case-insensitivity real, or decorative?
    //
    // `helpModel` is supposed to match "SAST" and "sast" alike. Proven by actually breaking
    // it: `matchesEntry()`'s haystack was left un-lowercased for one run (the trailing
    // `.toLowerCase()` removed from `gas_shared/ui/helpPage.js`) — `normalize(query)` still
    // lowercases the QUERY side, so the assertion is written as upper-vs-lower AGREEMENT
    // rather than as one hardcoded expectation. With that one line removed:
    //
    //   FAIL  test/pagesHelp.test.js > dso: helpModel > matches case-insensitively …
    //   FAIL  test/pagesHelp.test.js > os: helpModel > matches case-insensitively …
    //   AssertionError: expected [] to deeply equal [ 'a-first' ]
    //
    // Both registers failed, which is the other thing the perturbation proves: one edit to
    // the shared model is now visible from both ends. Reverted immediately after.
    it("matches case-insensitively — a capitalised query still finds a lowercase body", () => {
      const upper = helpModel(FIXTURE, "SYNC", "");
      const lower = helpModel(FIXTURE, "sync", "");
      expect(upper.groups.length, "the uppercase query matched nothing").toBe(1);
      expect(upper.groups[0].entries.map((e) => e.id))
        .toEqual(lower.groups[0].entries.map((e) => e.id));
      // And the register's own book agrees, so the claim is not only about the fixture. A
      // plainly-spelled term, because a term carrying punctuation ("Median MTTR
      // (Kaplan–Meier)") is not a valid query at all: `\b` before "(" never matches, which
      // is a fact about the anchor rather than about case.
      const donor = entries.find((e) => /^[A-Za-z][A-Za-z ]+$/.test(e.term));
      expect(donor, "no plainly-spelled term in this book to case-flip").toBeTruthy();
      const hit = helpModel(entries, donor.term.toUpperCase(), "");
      expect(hit.groups[0].entries.map((e) => e.id)).toContain(donor.id);
    });
  });

  // =======================================================================================
  //  2. The route exists, in the lane the shared hero claims
  // =======================================================================================
  describe(app + ": the help route exists", () => {
    const pages = parsePages(APP_SRC);
    const help = pages.find((p) => p.route === "help");

    it("PAGES carries a help route, in the " + lane + " lane", () => {
      expect(help, "app.js's PAGES has no help route").toBeTruthy();
      expect(help.group).toBe(lane);
      expect(help.title).toBeTruthy();
    });

    it("is the last page in the " + lane + " lane — the hero eyebrow names that lane", () => {
      const laneRoutes = pages.filter((p) => p.group === lane).map((p) => p.route);
      expect(laneRoutes[laneRoutes.length - 1]).toBe("help");
      // Not a free-floating literal: renderHelpPage's heroStat says this word, and the whole
      // reason it is allowed to be hardcoded there is that this assertion holds here.
      expect(SHARED_SRC).toContain('heroStat(\n      "' + lane + '",');
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

    it("every id the book defines renders as exactly one entry", () => {
      const m = helpModel(entries, "", "");
      expect(m.groups[0].entries.map((e) => e.id).sort())
        .toEqual(entries.map((e) => e.id).sort());
    });
  });

  // =======================================================================================
  //  3. The page delegates — it holds the book, and nothing else
  // =======================================================================================
  describe(app + ": pages/help.js is wiring, not a second implementation", () => {
    it("draws the shared page and hands it this register's own entries", () => {
      // THE DEPTH IS PART OF THE ASSERTION, and it is here because getting it wrong is the
      // one way this wiring fails. `gas`'s first version wrote four `../` where five are
      // needed (pages/ is one level below js/, which app.js is not) and nothing in the test
      // suite noticed: no test imports the page module, so only esbuild refused it — a
      // failure that arrives after every test has gone green. Computed rather than
      // hardcoded, from where the file actually sits.
      const up = "../".repeat(
        resolve(root, "src/client/js/pages").slice(resolve(root, "..").length)
          .split(/[\\/]/).filter(Boolean).length,
      );
      expect(code(PAGE_SRC)).toContain('from "' + up + 'gas_shared/ui/helpPage.js"');
      expect(code(PAGE_SRC))
        .toMatch(/renderHelpPage\(host, params, ctx, \{ entries: allEntries\(\) \}\)/);
    });

    it("re-declares none of the page's own vocabulary", () => {
      // The failure this catches is a fork starting quietly: someone copies one helper back
      // in "just for this app" and the two pages begin to drift, which is exactly how the
      // three copies this package replaced came about.
      for (const forked of ["helpModel", "help-entry", "help-search", "scrollIntoView"]) {
        expect(code(PAGE_SRC), "pages/help.js re-declares " + forked).not.toContain(forked);
      }
      expect(PAGE_SRC.split("\n").length).toBeLessThan(40);
    });
  });

  // =======================================================================================
  //  4. The deep link clears the filter BEFORE it looks for the row
  // =======================================================================================
  //
  // A SOURCE-ORDER ASSERTION ON PURPOSE, AND THE REASON IS THE HONEST PART. On today's
  // routing the clear fires on nothing: every `?term=` arrival is a hashchange,
  // `appShell.js`'s `route()` replaces `<main>` and calls `renderHelpPage` afresh, so the
  // search field is empty at the only moment `revealEntry` is reachable. Perturbed anyway —
  // the `clearFilter()` call was moved BELOW `getElementById` for one run — and NOTHING in
  // either app failed, which is the finding rather than the pass. So the guard is pinned
  // where it can be seen: by order, in the source, with the failure it prevents named.
  // `gas_ai`'s page needs the same clear at runtime because its index rail reveals entries
  // in place with no route change; the first in-page reveal trigger added here makes this
  // one load-bearing too, and this assertion is what will still be standing then.
  describe(app + ": revealing an entry clears any live filter first", () => {
    it("calls clearFilter() before it reaches for the row", () => {
      const src = code(SHARED_SRC);
      const fn = src.slice(
        src.indexOf("function revealEntry"),
        src.indexOf("const model = paint();"),
      );
      expect(fn, "revealEntry() not found in the shared page").toContain("clearFilter()");
      expect(fn.indexOf("clearFilter()")).toBeLessThan(fn.indexOf("getElementById"));
    });

    it("reads ?term= out of the hash params, never out of location.search", () => {
      // These are hash-routed SPAs: location.search is empty on every route, so a
      // URLSearchParams read here would silently mark nothing.
      // Comments stripped: this module's own header EXPLAINS the trap and therefore says
      // "location.search" in prose. The claim is about what the code reads.
      expect(code(SHARED_SRC)).not.toContain("location.search");
      expect(code(SHARED_SRC)).not.toContain("URLSearchParams");
      expect(code(SHARED_SRC)).toContain("params && params.term");
    });
  });
}
