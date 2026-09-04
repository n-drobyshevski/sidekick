// First-run states: a failure is never dressed as an absence, and every page below the
// front door says where its figures came from.
//
// DEFECT ONE: `emptyState` WAS DOING TWO JOBS. Five pages caught a render exception and put
// `emptyState("Couldn't render the half-life.")` on the screen — a crash, announced in a
// `role="status"` box, in the same voice and the same dashed rectangle the register uses for
// "no sync saved yet", with the exception dropped on the floor. `errorState` already existed
// (`ui/feedback.js`), already carried `role="alert"` and a `detail` disclosure, and was
// already used correctly by three pages. The two states are not the same claim: an absence
// is a state of the register, a failure is a defect in the app, and only one of them is the
// reader's to act on.
//
// WHY SOURCE TEXT. There is no jsdom in these apps (no vitest `environment`), and the claim
// is about which component a page REACHES FOR — a property of the module rather than of any
// one rendered output. The sweep reads comment-stripped code, because these very module
// headers name the strings they forbid and a raw-text check would fail on the sentence that
// states the rule.
//
// WHAT STAYED BEHIND. The app-specific halves of the original test — the shape of one
// register's first-run panel, its P90 caption, its "not measured" rate view — are assertions
// about that app's own view functions and live in its own test file. Only the two rules that
// are true of every sidekick are here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * The file with EVERY comment removed — `//` and block comments both — string-aware.
 *
 * STRICTER THAN A LINE-COMMENT STRIPPER, and the difference is load-bearing rather than
 * stylistic. A stripper that treats `'` as a quote opener everywhere puts itself into string
 * mode on the first apostrophe inside a JSDoc block ("this page's own payload") and
 * everything up to the next apostrophe, `//` markers included, survives into the "code".
 * Measured on gas_devsecops: the first draft of the §4 sweep failed on `executive.js`, and
 * the offending text was a LINE COMMENT quoting the defective sentence it forbids, kept
 * alive by an apostrophe in a block comment hundreds of lines above it.
 *
 * That matters more here than anywhere else, because every module header in these packages
 * explains its prohibition by QUOTING it. Template literals are tracked too: they can hold
 * `//` and both quote characters.
 */
export function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * `emptyState(` followed — across newlines, past whitespace — by a string literal opening
 * with `Couldn't `. That is the exact shape all six offending call sites had, on both the
 * one-line form (`emptyState("Couldn't render " + label + ".")`) and the wrapped form
 * (`emptyState(\n  "Couldn't load remediation data.",\n  …)`).
 */
const EMPTY_STATE_WITH_FAILURE = /\bemptyState\(\s*"Couldn't /;

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {string[]} ctx.routes            page modules under src/client/js/pages/
 * @param {string[]} ctx.errorStateCarriers  routes whose failure paths must still say
 *                                         "Couldn't" — the non-vacuity half
 * @param {string[]} ctx.guardedRoutes     routes with a per-section guard() that must reach
 *                                         for errorState
 * @param {string[]} ctx.firstRunRoutes    routes that must carry firstRunNotice()
 */
export function registerEmptyStateContract(ctx) {
  const { describe, it, expect, app, routes } = ctx;
  const pagesDir = resolve(fileURLToPath(ctx.appRoot), "src/client/js/pages");
  const CODE = Object.fromEntries(
    routes.map((r) => [r, code(readFileSync(resolve(pagesDir, r + ".js"), "utf8"))]),
  );

  describe(app + ": a render that threw is announced as a failure, not as an absence", () => {
    it("no page module passes a \"Couldn't …\" message to emptyState", () => {
      for (const route of routes) {
        expect(
          EMPTY_STATE_WITH_FAILURE.test(CODE[route]),
          "pages/" + route + ".js dresses a failure as an absence: emptyState(\"Couldn't …\") — "
          + "use errorState(message, { detail }) so it is announced as an alert and the "
          + "exception survives into the disclosure",
        ).toBe(false);
      }
    });

    // NOT A VACUOUS SWEEP. The guard above only bites where the failure path exists at all,
    // so this pins that the failure paths are still there and still say "Couldn't" — a page
    // that deleted its catch block would pass the sweep above for the wrong reason.
    it("is not vacuous — the same failure messages are still present, on errorState", () => {
      const carriers = routes.filter((r) => /\berrorState\(\s*"Couldn't /.test(CODE[r]));
      expect(carriers.sort()).toEqual([...ctx.errorStateCarriers].sort());
    });

    it("every page that catches a render exception reaches for errorState", () => {
      for (const route of ctx.guardedRoutes) {
        // The per-section `guard()` helper — one failing section must not blank the page.
        expect(CODE[route], route + " lost its section guard").toMatch(/function guard\(/);
        expect(CODE[route], route + "'s guard does not use errorState")
          .toMatch(/render failed:[\s\S]{0,200}errorState\(/);
      }
    });
  });

  describe(app + ": the first-run notice", () => {
    it("is the same component on every page that carries it", () => {
      for (const route of ctx.firstRunRoutes) {
        expect(CODE[route], "pages/" + route + ".js never says the ledger has not been read")
          .toMatch(/firstRunNotice\(/);
      }
    });

    it("is decided by the ledger and the sync, never by a null bootstrap alone", () => {
      // Each page gates on `latestSync`, which is `bootstrap()`'s own honest signal — and
      // each AWAITS it rather than reading the cache, which can be null before the shell
      // resolves.
      for (const route of ctx.firstRunRoutes) {
        expect(CODE[route], "pages/" + route + ".js reads a cache that may not be populated yet")
          .toMatch(/await bootstrap\(\)/);
        expect(CODE[route]).toMatch(/latestSync/);
      }
    });
  });
}
