// The Wiz console link's rule, run against every copy of it that exists.
//
// TWO COPIES, ONE TABLE. `gas_shared/domain/wizUrl.ts` is what every server- and domain-side
// reader normalizes through — one shared TypeScript module, because `gas_shared/domain/sha1`
// already proves a shared .ts is importable from both `src/domain/**` and `src/server/**` in
// all three registers. `gas_shared/wizUrl.js` is the client's render gate, and it exists
// separately only because the client bundle is plain JavaScript and cannot import TypeScript.
//
// THAT IS TWO COPIES WHERE hubUrl HAS FOUR, and the difference is the point rather than an
// inconsistency: hubUrl needs a per-app server boundary because its writers live in
// `src/server/**` under a tsconfig with no `allowJs` and its rule is stated in .js. This rule
// is stated in .ts, so the duplication stops at the client seam. Two copies of a rule are
// only defensible while they are provably the SAME rule, which is what this file is.
//
// THE TWO SIDES ANSWER IN DIFFERENT VOCABULARIES, and the table is DATA so each can make its
// own claim about it. Ingestion answers with a string or `null` (a ledger cell); the render
// gate answers with a string or `""` (an href, or no row). Collapsing those into one shared
// assertion is exactly where a real disagreement could hide.
//
// THE PERTURBATION IS IN THIS FILE, not in a comment. The plausible-looking rewrite here is
// not a cast slip — it is the reasonable-sounding claim that this guard is unnecessary at
// all, because `portalUrl` came from Wiz's own API and an API response is not user input.
// That version is reproduced inline below and shown accepting `javascript:alert(1)`, because
// the value does not travel from the API to the href directly: it rests, in between, in a
// Google Sheet an operator can type into. A guard nothing exercises is decoration
// (CLAUDE.md), and this one guards script execution in the app's own origin.

import { normalizeWizUrl } from "../../domain/wizUrl";
import { safeWizUrl } from "../../wizUrl.js";

/** Values every copy must accept, with the string both sides keep them as. */
export const LEGAL = [
  {
    what: "a vulnerability finding's portalUrl, as Wiz returns it",
    input: "https://app.wiz.io/explorer/vulnerability-findings#~(entity~(~'0ac9b058-fe02-5e5c-990f-5d181343d09d))",
    kept: "https://app.wiz.io/explorer/vulnerability-findings#~(entity~(~'0ac9b058-fe02-5e5c-990f-5d181343d09d))",
  },
  {
    what: "the console root itself",
    input: "https://app.wiz.io/",
    kept: "https://app.wiz.io/",
  },
  {
    // THE FEDRAMP CONSOLE IS A SECOND DEPLOYMENT OF WIZ, not a second page of the first. A
    // register pointed at a US-Gov tenant would otherwise store every URL and link to none.
    what: "the US-Gov / FedRAMP console",
    input: "https://app.wiz.us/issues#~(issue~'abc)",
    kept: "https://app.wiz.us/issues#~(issue~'abc)",
  },
  {
    what: "padding around the value, as a hand-edited spreadsheet cell arrives",
    input: "  https://app.wiz.io/issues\n",
    kept: "https://app.wiz.io/issues",
  },
];

/**
 * Values every copy must treat as "no link".
 *
 * BLANK IS NOT AN ERROR HERE. Three ordinary states produce it — a ledger row written before
 * `portal_url` existed, a finding Wiz returned no `portalUrl` for, and a scope whose Wiz type
 * has no such field — and none of them should draw anything or raise anything.
 */
export const ABSENT = [
  { what: "blank, the state of every row written before this column existed", input: "" },
  { what: "whitespace only, which is what an emptied spreadsheet cell can leave", input: "   " },
];

/** Values every copy must refuse. `why` is the failure each one would otherwise have caused. */
export const ILLEGAL = [
  {
    what: "a javascript: URL",
    input: "javascript:alert(1)",
    why: "it would run in the app's own page the moment a reader clicked the row — this is "
      + "the case the prefix rule exists for, and the reason an API-supplied value still gets "
      + "checked: it rests in a hand-editable Sheet on the way to the href",
  },
  {
    what: "a host that merely STARTS with the console's name",
    input: "https://app.wiz.io.evil.example/explorer",
    why: "the trailing slash is part of the prefix precisely so this is a different host "
      + "rather than a longer match — without it this string passes",
  },
  {
    what: "the right host over plain http",
    input: "http://app.wiz.io/explorer",
    why: "a downgrade: the link would carry the reader's Wiz session over an unencrypted hop",
  },
  {
    what: "an https URL on another host entirely",
    input: "https://evil.example/explorer",
    why: "the row is an invitation to click and the host is the whole question",
  },
  {
    what: "a protocol-relative URL",
    input: "//app.wiz.io/explorer",
    why: "it resolves to whatever scheme the page happens to be on, which is not a decision "
      + "a finding sheet gets to leave to the page",
  },
  {
    what: "a scheme-less string that merely looks like a host",
    input: "app.wiz.io/explorer",
    why: "it is a RELATIVE path — it would resolve against the sandbox's own "
      + "googleusercontent.com origin and go nowhere the reader expects",
  },
  {
    what: "the API host rather than the console host",
    input: "https://api.eu15.app.wiz.io/graphql",
    why: "the regionalized API endpoint is not a page a human can read, and accepting it "
      + "would invite deriving the console host from WIZ_API_URL — which is wrong, because "
      + "the console is not regionalized",
  },
];

/**
 * Values that are not strings at all.
 *
 * REFUSED BEFORE ANY CAST, which is why they are listed apart from the illegal strings.
 * `String(null)` is the four-character string "null" and `String([])` is the EMPTY string, so
 * a rule that cast first would store "null" as a URL-shaped value and read a stray `[]` as a
 * legal blank. Same family as CLAUDE.md's `Number(null)` trap, one constructor over.
 */
export const NON_STRINGS = [
  { what: "null, which is what an absent JSON field reads as", input: null },
  { what: "undefined, which is what a missing ledger column reads as", input: undefined },
  { what: "an object", input: {} },
  { what: "an array, whose String() cast is the empty string", input: [] },
  { what: "a number", input: 15 },
  { what: "false, whose String() cast is not empty but is not a URL either", input: false },
];

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {string}   [ctx.sheetSrc]  the register's finding-sheet source, for the wiring check.
 *   Optional with a NAMED SKIP rather than silently absent: an app that has not wired its
 *   sheet yet should say so in the test summary, because a contract that quietly runs half of
 *   itself is the failure mode these factories exist to prevent.
 */
export function registerWizUrlContract(ctx) {
  const { describe, it, expect, app, sheetSrc } = ctx;

  // ------------------------------------------------------------- the ingestion normalizer
  describe(app + ": the Wiz link rule, as ingestion stores it", () => {
    it.each(LEGAL.map((c) => [c.what, c.input, c.kept]))(
      "keeps %s", (_what, input, kept) => {
        expect(normalizeWizUrl(input)).toBe(kept);
      },
    );

    it.each(ABSENT.map((c) => [c.what, c.input]))(
      "stores null for %s", (_what, input) => {
        expect(normalizeWizUrl(input)).toBeNull();
      },
    );

    // DROPPED, NOT THROWN, and the asymmetry with hubUrl's boundary is deliberate. There is
    // no reader waiting: this runs in bulk, mid-scan, over a page of findings. Throwing would
    // end a whole scan over one malformed URL in one finding — trading a register's freshness
    // for a link.
    it.each(ILLEGAL.map((c) => [c.what, c.input]))(
      "drops %s rather than throwing", (_what, input) => {
        expect(normalizeWizUrl(input)).toBeNull();
      },
    );

    it.each(NON_STRINGS.map((c) => [c.what, c.input]))(
      "drops %s before any cast", (_what, input) => {
        expect(normalizeWizUrl(input)).toBeNull();
      },
    );
  });

  // ------------------------------------------------------------------- the render gate
  describe(app + ": the Wiz link rule, as the finding sheet's href gate reads it", () => {
    it.each(LEGAL.map((c) => [c.what, c.input, c.kept]))(
      "links to %s", (_what, input, kept) => {
        expect(safeWizUrl(input)).toBe(kept);
      },
    );

    // THE RENDER GATE IS NOT REDUNDANT WITH INGESTION. The ledger is a Google Sheet tab; a
    // value can reach this cell without passing the normalizer, by somebody typing it. That
    // is the entire reason this second copy exists, so it is asserted rather than assumed.
    it.each(ILLEGAL.map((c) => [c.what, c.input]))(
      "draws NO link for %s, rather than throwing", (_what, input) => {
        expect(safeWizUrl(input)).toBe("");
      },
    );

    it.each(ABSENT.concat(NON_STRINGS).map((c) => [c.what, c.input]))(
      "draws no link for %s", (_what, input) => {
        expect(safeWizUrl(input)).toBe("");
      },
    );

    it("is what a defective 'it came from the API' rewrite would break", () => {
      // The rewrite, reproduced rather than described: trust any non-empty string, on the
      // reasoning that Wiz's own API produced it and an API response is not user input. It is
      // wrong because the value does not travel from the API to the href directly — it rests
      // in a ledger tab of a spreadsheet an operator can open and type into, where neither
      // copy of this rule runs.
      const trusting = (raw) => (typeof raw === "string" && raw.trim() ? raw.trim() : "");
      const attack = "javascript:alert(1)";
      expect(trusting(attack)).toBe(attack);  // the rewrite hands it straight to the href
      expect(safeWizUrl(attack)).toBe("");    // the rule in force does not
    });

    it("agrees with the ingestion copy on every case in the table", () => {
      // The two copies answer in different vocabularies (null vs ""), so this states the
      // correspondence directly rather than leaving it to two lists that could drift apart.
      for (const c of LEGAL) expect(safeWizUrl(c.input)).toBe(normalizeWizUrl(c.input));
      for (const c of ILLEGAL.concat(ABSENT)) {
        expect(safeWizUrl(c.input)).toBe("");
        expect(normalizeWizUrl(c.input)).toBeNull();
      }
    });
  });

  // ------------------------------------------------------------------------- the wiring
  //
  // NOT A DOM TEST, for the reason the hubUrl contract states: none of these packages has
  // jsdom installed, so there is no `document` for `el()` to build against. What this covers
  // instead is the wiring defect that would make every assertion above pass while a raw
  // ledger value still reached an href — the failure a pure test of the two functions cannot
  // see.
  const wiring = typeof sheetSrc === "string" ? describe : describe.skip;
  wiring(app + ": the finding sheet is actually wired to the rule", () => {
    it("routes the stored value through safeWizUrl rather than using it raw", () => {
      expect(sheetSrc).toContain("safeWizUrl");
    });
  });
}
