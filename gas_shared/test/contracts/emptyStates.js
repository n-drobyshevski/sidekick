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
 * @param {string[]} [ctx.firstRunNoAt]    routes whose first-run notice cannot carry a date,
 *   with the reason in a comment at the call site. A route named in `firstRunRoutes` must
 *   appear in exactly one of "passes `at:` to its `firstRunNotice(` call" or this list — never
 *   both, never neither — so an empty list here can never silently stand in for a route
 *   nobody dated, and a route cannot claim the exemption while also quietly carrying a date.
 * @param {string[]} [ctx.firstRunBootstrapRoutes]  routes that must literally `await
 *   bootstrap()` (rather than read `bootstrapCached()`) before deciding `synced`. Defaults to
 *   `firstRunRoutes`. Override with a NARROWER list when `firstRunRoutes` has grown to include
 *   a page that reads the cache instead — safe only where something else (the shell's own
 *   boot sequence) already guarantees the cache is populated before that page can render; see
 *   gas_devsecops's registration for the worked case.
 * @param {string}   [ctx.syncField]       the bootstrap field a first-run page gates on.
 *   Defaults to `"latestSync"`, which is what two of the three registers call it; gas passes
 *   `"latestScan"`.
 *
 *   HARD-CODING THIS COST gas ITS WHOLE FIRST-RUN HALF. The field name was written into the
 *   regex, so `firstRunRoutes` had to be `[]` in `gas/test/shared.test.js` — not because that
 *   register's pages fail to say the ledger has never been read (`data` and `attribution`
 *   both do), but because they say it about a field spelled `latestScan`. The comment left
 *   there is explicit that the alternatives were worse: renaming a payload field to satisfy a
 *   regex, or aliasing one inside the page to be matched by it, is gaming the test. Taking
 *   the name as an argument is the fix it names, and gas's two routes are registered now — so
 *   this contract's second half runs on three apps instead of two.
 */
export function registerEmptyStateContract(ctx) {
  const { describe, it, expect, app, routes } = ctx;
  const syncField = ctx.syncField || "latestSync";
  const pagesDir = resolve(fileURLToPath(ctx.appRoot), "src/client/js/pages");
  const CODE = Object.fromEntries(
    routes.map((r) => [r, code(readFileSync(resolve(pagesDir, r + ".js"), "utf8"))]),
  );
  // Read fresh rather than through `routes`/`CODE` above — the shared module lives outside
  // any app's own `src/client/js/pages`, and the date clause below needs its literal text
  // once per app run (the same shared-module claim, checked identically three times).
  const FEEDBACK_SRC = code(readFileSync(
    resolve(fileURLToPath(ctx.appRoot), "../gas_shared/ui/feedback.js"), "utf8",
  ));

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

    it("is decided by the ledger and the " + syncField + ", never by a null bootstrap alone", () => {
      // Each page gates on the bootstrap's own honest "has anything been read" signal — and
      // each AWAITS it rather than reading the cache, which can be null before the shell
      // resolves. The FIELD NAME is the app's: two registers spell it `latestSync`, gas
      // spells it `latestScan`, and hard-coding one of the two is what silently excused the
      // other from this half of the contract.
      // `"\\b"`, not `"\b"`. In a JS string literal `\b` is the BACKSPACE character, so the
      // first draft of this line built /latestScan/ and matched nothing — it
      // failed on gas_devsecops, whose pages do read `latestSync`, which is how it was caught
      // rather than by the app it was written for.
      const field = new RegExp("\\b" + syncField + "\\b");
      // `ctx.firstRunBootstrapRoutes`, defaulting to `ctx.firstRunRoutes`: three
      // gas_devsecops register pages (sca/sast/secrets) read `bootstrapCached()` rather than
      // awaiting `bootstrap()` fresh — safe ONLY because `gas_shared/shell/appShell.js`'s own
      // `boot()` already awaits `bootstrap()` once before any route mounts, which every page
      // relies on but only some name in their own text. Widening `firstRunRoutes` to cover
      // those three for the date clause below must not silently widen THIS check too, or it
      // starts failing on three pages that were never broken — it fails on the literal text
      // "await bootstrap()", which those three pages have no reason to carry a second time.
      for (const route of (ctx.firstRunBootstrapRoutes || ctx.firstRunRoutes)) {
        expect(CODE[route], "pages/" + route + ".js reads a cache that may not be populated yet")
          .toMatch(/await bootstrap\(\)/);
        expect(CODE[route], "pages/" + route + ".js never reads " + syncField)
          .toMatch(field);
      }
    });
  });

  describe(app + ": an empty state says when it looked", () => {
    // SHARED-MODULE CLAIM. Both sentence shapes live in one file, `gas_shared/ui/feedback.js`,
    // so this assertion is identical across gas/gas_ai/gas_devsecops on purpose — it is a fact
    // about the module every app imports, not about any one app's own pages.
    it("gas_shared/ui/feedback.js carries both the dated and the undated shape", () => {
      expect(FEEDBACK_SRC, "the dated firstRunNotice sentence is missing or reworded")
        .toMatch(/The last \$\{noun\} on \$\{/);
      expect(FEEDBACK_SRC, "measuredEmpty's dated line is missing or reworded")
        .toMatch(/Measured at /);
    });

    // NOT VACUOUS BY CONSTRUCTION. `firstRunNoAt` names routes whose first-run notice cannot
    // carry a date (the reason lives in a comment at that route's own call site — see
    // gas/test/shared.test.js's "attribution" entry). A route must land in EXACTLY ONE of
    // "passes at: in its call" or `firstRunNoAt`: an empty `firstRunNoAt` cannot stand in for
    // a route nobody dated (the union check below would come up short), and a route cannot be
    // both dated and exempt (the disjointness check would catch it carrying `at:` for no
    // reason, or claiming an exemption a later edit made stale).
    it("every route either dates its notice or is named as unable to", () => {
      const noAt = ctx.firstRunNoAt || [];
      const dated = ctx.firstRunRoutes.filter((r) => /firstRunNotice\(\{[^}]*\bat:/.test(CODE[r]));
      const overlap = dated.filter((r) => noAt.includes(r));
      expect(overlap, "route(s) both pass at: AND claim the firstRunNoAt exemption").toEqual([]);
      expect([...dated, ...noAt].sort(), "dated routes + firstRunNoAt must equal firstRunRoutes")
        .toEqual([...ctx.firstRunRoutes].sort());
    });
  });
}
