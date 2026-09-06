// The hub link's rule, run against every copy of it that exists.
//
// FOUR COPIES, ONE TABLE. The rule about what a hub URL may look like is stated once in
// `gas_shared/hubUrl.js` (the client's field message and the header's render guard, shared by
// all three registers) and once more in each register's own `src/server/hubUrl.ts` (the
// boundary that throws, and the only copy `api_saveHubUrl` actually writes through). The
// server copies cannot be collapsed into the shared one: no `src/server/**` module imports
// `gas_shared` in any of these apps, and each tsconfig's `include` is `src/**/*.ts` with no
// `allowJs`, so a .js import from a strict-mode .ts server file is not a module the typecheck
// will accept. Four copies of a rule are only defensible while they are provably the SAME
// rule, which is what this file is: the cases live here, and every registering app runs them
// against both its own boundary and the shared client copy.
//
// EACH SIDE OWNS WHAT "LEGAL" MEANS IN ITS OWN VOCABULARY, and that is deliberate rather than
// sloppy. The boundary answers by returning a normalized string or throwing; the field message
// answers with a sentence or null; the header answers with an href or "". Those are genuinely
// different answers to one question, and collapsing them into a single shared assertion is
// exactly where a real disagreement could hide — so the table is DATA and each block below
// makes its own claim about it.
//
// THE PERTURBATION IS IN THIS FILE, not in a comment. `safeHubUrl` is the last gate before a
// stored string becomes the `href` of the most-clicked control in the app's chrome, so the
// rewrite that matters is not a cast slip — it is the plausible-looking simplification that
// trusts any non-empty string ("the server already validated it"). That version is reproduced
// inline below and shown accepting `javascript:alert(1)`, because a guard nothing exercises is
// decoration (CLAUDE.md), and this one guards script execution in the app's own origin.

import { readFileSync } from "node:fs";

import { HUB_URL_MESSAGE, hubUrlProblem, safeHubUrl } from "../../hubUrl.js";

/** Values every copy must accept, with the string the boundary normalizes them TO. */
export const LEGAL = [
  {
    what: "the hub's deployed /exec URL",
    input: "https://script.google.com/a/macros/example.com/s/AKfycbHUB/exec",
    normalized: "https://script.google.com/a/macros/example.com/s/AKfycbHUB/exec",
  },
  {
    what: "the same URL with padding around it, as a paste from a browser bar arrives",
    input: "  https://script.google.com/a/macros/example.com/s/AKfycbHUB/exec\n",
    normalized: "https://script.google.com/a/macros/example.com/s/AKfycbHUB/exec",
  },
  {
    what: "blank — the legal way to say NOT CONFIGURED, and the state a fresh register is in",
    input: "",
    normalized: "",
  },
  {
    what: "whitespace only, which is what a reader clearing the field actually leaves behind",
    input: "   ",
    normalized: "",
  },
  // THE LOOPBACK PAIR. The hub's dev harness serves plain HTTP on 8790 (gas_hub/dev/serve.mjs)
  // and without these a register under `npm run dev` could not link to it — which is the whole
  // journey this button exists for, unexercisable before a deployment.
  {
    what: "the hub's local dev harness",
    input: "http://localhost:8790/",
    normalized: "http://localhost:8790/",
  },
  {
    what: "the same harness by loopback IP",
    input: "http://127.0.0.1:8790/",
    normalized: "http://127.0.0.1:8790/",
  },
];

/** Values every copy must refuse. `why` is the failure each one would otherwise have caused. */
export const ILLEGAL = [
  {
    what: "a javascript: URL",
    input: "javascript:alert(1)",
    why: "it would run in the app's own page the moment a reader clicked the header — this is "
      + "the case the prefix rule exists for, and it is why the rule is a boundary rather than "
      + "a typo-catcher",
  },
  {
    what: "the right host over plain http",
    input: "http://script.google.com/a/macros/example.com/s/AKfycbHUB/exec",
    why: "a downgrade: the link would carry the reader's session over an unencrypted hop",
  },
  {
    what: "an https URL on another host entirely",
    input: "https://evil.example/exec",
    why: "the button is an invitation to click and the host is the whole question",
  },
  {
    what: "a protocol-relative URL",
    input: "//script.google.com/x",
    why: "it resolves to whatever scheme the page happens to be on, which is not a decision "
      + "this chrome gets to leave to the page",
  },
  {
    what: "a scheme-less string that merely looks like a host",
    input: "script.google.com/x",
    why: "it is a RELATIVE path — it would resolve against the sandbox's own "
      + "googleusercontent.com origin and go nowhere the reader expects",
  },
  {
    what: "a host that merely STARTS with localhost",
    input: "http://localhost.evil.example/",
    why: "the colon is part of the prefix precisely so this is a different host rather than a "
      + "longer match — the loopback exemption must not be a way to smuggle an origin in",
  },
  {
    what: "localhost with no port",
    input: "http://localhost/",
    why: "no dev harness serves on port 80, and dropping the port is how the case above would "
      + "otherwise be reachable",
  },
  {
    what: "localhost over https",
    input: "https://localhost:8790/",
    why: "the harness is plain http (gas_hub/dev/serve.mjs), so the https form is a typo that "
      + "would fail to connect — worth catching at the field, and not a second legal shape",
  },
];

/**
 * Values that are not strings at all.
 *
 * REFUSED BEFORE ANY CAST, which is why they are listed apart from the illegal strings.
 * `String(null)` is the four-character string "null" and `String([])` is the EMPTY string, so
 * a rule that cast first would report a stray `null` as a bad URL for the wrong reason and
 * read a stray `[]` as a legal blank — silently recording the hub as "not configured". Same
 * family as CLAUDE.md's `Number(null)` trap, one constructor over.
 */
export const NON_STRINGS = [
  { what: "null", input: null },
  { what: "undefined", input: undefined },
  { what: "an object", input: {} },
  { what: "an array, whose String() cast is the empty string", input: [] },
  { what: "a number", input: 8790 },
  { what: "false, whose String() cast is not empty but is not a URL either", input: false },
];

const APPBAR_SRC = readFileSync(new URL("../../shell/appbar.js", import.meta.url), "utf8");
const APPSHELL_SRC = readFileSync(new URL("../../shell/appShell.js", import.meta.url), "utf8");

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} [ctx.normalizeHubUrl]  this register's own server boundary. Optional with a
 *   NAMED SKIP rather than silently absent: an app that has not wired its server half yet
 *   should say so in the test summary, because a contract that quietly runs half of itself is
 *   the failure mode these factories exist to prevent.
 */
export function registerHubUrlContract(ctx) {
  const { describe, it, expect, app, normalizeHubUrl } = ctx;

  // ---------------------------------------------------------------- the shared client copy
  describe(app + ": the hub URL rule, as the field message reads it", () => {
    it.each(LEGAL.map((c) => [c.what, c.input]))("accepts %s", (_what, input) => {
      expect(hubUrlProblem(input)).toBeNull();
    });

    it.each(ILLEGAL.map((c) => [c.what, c.input, c.why]))(
      "refuses %s", (_what, input) => {
        expect(hubUrlProblem(input)).toBe(HUB_URL_MESSAGE);
      },
    );

    it.each(NON_STRINGS.map((c) => [c.what, c.input]))(
      "refuses %s before any cast", (_what, input) => {
        expect(hubUrlProblem(input)).toBe(HUB_URL_MESSAGE);
      },
    );

    it("states the two legal shapes rather than just saying no", () => {
      // A reader who pasted the wrong thing cannot guess the right thing from "invalid URL".
      expect(HUB_URL_MESSAGE).toContain("script.google.com");
      expect(HUB_URL_MESSAGE).toContain("localhost:");
    });
  });

  // ---------------------------------------------------------------- the header's render gate
  describe(app + ": the hub URL rule, as the header's href gate reads it", () => {
    it.each(LEGAL.map((c) => [c.what, c.input, c.normalized]))(
      "links to %s", (_what, input, normalized) => {
        expect(safeHubUrl(input)).toBe(normalized);
      },
    );

    // THE ASYMMETRY WITH THE FIELD IS THE POINT. The field tells a reader their paste is
    // wrong; the header has no reader who can act on that, so a refused value and an absent
    // one must arrive as the same answer — no button — rather than as a throw that would take
    // the whole app's chrome down over one bad Script Property.
    it.each(ILLEGAL.map((c) => [c.what, c.input]))(
      "draws NO button for %s, rather than throwing", (_what, input) => {
        expect(safeHubUrl(input)).toBe("");
      },
    );

    it.each(NON_STRINGS.map((c) => [c.what, c.input]))(
      "draws no button for %s", (_what, input) => {
        expect(safeHubUrl(input)).toBe("");
      },
    );

    it("is what a defective 'the server already checked it' rewrite would break", () => {
      // The rewrite, reproduced rather than described: trust any non-empty string, on the
      // reasoning that api_saveHubUrl validated it on the way in. It is wrong because the
      // property is also editable by hand in the GAS editor's Project Settings, where nothing
      // runs that endpoint at all.
      const trusting = (raw) => (typeof raw === "string" && raw.trim() ? raw.trim() : "");
      const attack = "javascript:alert(1)";
      expect(trusting(attack)).toBe(attack);   // the rewrite hands it straight to the href
      expect(safeHubUrl(attack)).toBe("");     // the rule in force does not
    });
  });

  // ---------------------------------------------------------------- this register's boundary
  const boundary = typeof normalizeHubUrl === "function" ? describe : describe.skip;
  boundary(app + ": the hub URL rule, as its own server boundary enforces it", () => {
    it.each(LEGAL.map((c) => [c.what, c.input, c.normalized]))(
      "normalizes %s", (_what, input, normalized) => {
        expect(normalizeHubUrl(input)).toBe(normalized);
      },
    );

    // THROWS rather than returning "" — the opposite of the header's gate, on purpose. This is
    // a save: a reader who pasted something is present, is waiting for an answer, and
    // silently storing "" would report their bad paste as a successful save that cleared the
    // field.
    it.each(ILLEGAL.map((c) => [c.what, c.input]))("throws on %s", (_what, input) => {
      expect(() => normalizeHubUrl(input)).toThrow();
    });

    it.each(NON_STRINGS.map((c) => [c.what, c.input]))(
      "throws on %s before any cast", (_what, input) => {
        expect(() => normalizeHubUrl(input)).toThrow();
      },
    );
  });

  // ---------------------------------------------------------------- the wiring
  //
  // NOT A DOM TEST, AND THE REASON IS WORTH STATING: none of these packages has jsdom or
  // happy-dom installed, so there is no `document` for `el()` to build against and no honest
  // way to assert the rendered node here. What these three cover instead is the wiring defect
  // that would make every assertion above pass while no button ever appeared — the failure
  // mode a pure test of `safeHubUrl` alone cannot see. The rendered result is verified in the
  // browser against the running dev harnesses.
  describe(app + ": the header is actually wired to the rule", () => {
    it("routes the stored value through safeHubUrl rather than using it raw", () => {
      expect(APPBAR_SRC).toContain("safeHubUrl");
    });

    it("gets the bootstrap payload from the shell, or the href is always undefined", () => {
      // `renderAppbar(appbarEl, scopeNode)` — the two-argument form this replaced — leaves
      // `data` undefined on every call, so the button silently never renders anywhere.
      // Non-greedy across nested parens on purpose: the scope argument is itself a call
      // (`spec.appbarScope(data)`), so a `[^)]*` character class stops at ITS closing paren
      // and never reaches the third argument. That version of this assertion failed against
      // correctly-wired code, which is the wrong direction for a guard to fail in.
      expect(APPSHELL_SRC).toMatch(/renderAppbar\([\s\S]*?,\s*data\s*\)/);
    });

    it("gives the icon-only link an accessible name of its own", () => {
      // THE FAILURE THIS CATCHES IS SILENT AND LOOKS FINE. The button carries a glyph and no
      // text, and `uiIcon()` marks every glyph `aria-hidden` by contract — so a screen reader
      // computes this link's name from nothing at all and announces bare "link". It renders
      // correctly, it clicks correctly, and it is unusable. The word it replaced was its own
      // name; the glyph cannot be.
      const link = APPBAR_SRC.slice(APPBAR_SRC.indexOf("function hubLink"));
      expect(link).toMatch(/"aria-label":\s*"[^"]+"/);
    });

    it("sets no per-link target, leaving the sandbox escape to the document's base tag", () => {
      // index.template.html carries `<base target="_top">` for the whole document. A second
      // copy of that decision on this one link is a place for the two to drift — and the
      // failure it invites is silent: the hub renders INSIDE the register's sandbox iframe.
      const link = APPBAR_SRC.slice(APPBAR_SRC.indexOf("function hubLink"));
      expect(link).not.toContain("target");
    });
  });
}
