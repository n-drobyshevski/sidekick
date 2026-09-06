// ONE CASE TABLE, TWO TESTS. The rule about what a sidekick URL may look like is stated
// twice in this app on purpose — `src/server/urls.ts`'s `normalizeAppUrl` is the BOUNDARY
// (it throws, and it is what `api_saveUrls` actually writes) and
// `src/client/js/pages/urlsModel.js`'s `urlProblem` is the same rule as a FIELD MESSAGE, so a
// bad paste is caught before the save round trip. Two copies of a rule are only defensible
// while they are provably the same rule, so the cases live here and both tests iterate them:
// `test/urls.test.ts` asserting throw/return, `test/urlsModel.test.js` asserting
// message/null. A case added here is answered by both sides or it fails on one.
//
// A .ts FILE IMPORTED BY A .js TEST, which looks odd and is the only shape that works:
// tsconfig.json's `include` is `src/**/*.ts` + `test/**/*.ts` with no `allowJs`, so a .js
// helper imported from urls.test.ts would be an untyped module under `strict` and fail
// `npm run typecheck`. Vite resolves the extensionless specifier to this file from either
// side. Every other shared helper in these packages (gas_devsecops/test/helpers.ts,
// gasEnv.ts) is .ts for the same reason.
//
// NOT A HELPER THAT ASSERTS ANYTHING. It is data. Each side owns what "legal" means in its
// own vocabulary (a returned string vs a null message) because those are genuinely different
// answers to the same question, and collapsing them into one shared assertion would be the
// place a real disagreement could hide.

/** Values both sides must accept, with the string the server normalizes them TO. */
export const LEGAL: Array<{ what: string; input: string; normalized: string }> = [
  {
    what: "a deployed /exec URL",
    input: "https://script.google.com/a/macros/example.com/s/AKfycb123/exec",
    normalized: "https://script.google.com/a/macros/example.com/s/AKfycb123/exec",
  },
  {
    what: "the same URL with padding around it",
    input: "   https://script.google.com/a/macros/example.com/s/AKfycb123/exec\n",
    normalized: "https://script.google.com/a/macros/example.com/s/AKfycb123/exec",
  },
  {
    what: "blank — the legal way to say NOT CONFIGURED",
    input: "",
    normalized: "",
  },
  {
    what: "whitespace only, which is the same thing a reader typed by accident",
    input: "   ",
    normalized: "",
  },
  // THE LOOPBACK PAIR. A sibling running under `npm run dev` serves plain HTTP on its own
  // port, and without these a locally-run hub could not link to a locally-run register —
  // which is every tile on the one page this app has. See src/server/urls.ts's header for why
  // a localhost URL in a real deployment is a visible misconfiguration rather than a hole.
  {
    what: "a sibling's local dev harness",
    input: "http://localhost:8788/",
    normalized: "http://localhost:8788/",
  },
  {
    what: "the same harness by loopback IP, with a deep link on it",
    input: "http://127.0.0.1:8789/#/executive",
    normalized: "http://127.0.0.1:8789/#/executive",
  },
];

/** Values both sides must refuse. `why` is the failure each one would have caused. */
export const ILLEGAL: Array<{ what: string; input: string; why: string }> = [
  {
    what: "a javascript: URL",
    input: "javascript:alert(1)",
    why: "it would run in the app's own page the moment a reader clicked the tile — this is "
      + "the case the prefix rule exists for, not typos",
  },
  {
    what: "the right host over plain http",
    input: "http://script.google.com/a/macros/example.com/s/AKfycb123/exec",
    why: "a downgrade: the tile would send the reader's session over an unencrypted hop",
  },
  {
    what: "an https URL on another host entirely",
    input: "https://evil.example/exec",
    why: "the tile is an invitation to click; the host is the whole question",
  },
  {
    what: "a protocol-relative URL",
    input: "//script.google.com/x",
    why: "it resolves to whatever scheme the page happens to be on, which is not a decision "
      + "this app gets to leave to the page",
  },
  {
    what: "a scheme-less string that merely looks like a host",
    input: "script.google.com/x",
    why: "it is a RELATIVE path — it would resolve against googleusercontent.com, i.e. "
      + "against the app's own sandbox origin, and go nowhere a reader expects",
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
    why: "no dev harness serves on port 80, and dropping the port is how the case above "
      + "would otherwise be reachable",
  },
  {
    what: "localhost over https",
    input: "https://localhost:8788/",
    why: "the harnesses are plain http (dev/serve.mjs), so the https form is a typo that "
      + "would fail to connect — worth catching at the field rather than in the browser, and "
      + "not a second legal shape",
  },
];

/**
 * Values that are not strings at all.
 *
 * REFUSED BEFORE ANY CAST, and that is the point of listing them separately: `String(null)`
 * is the four-character string "null" and `String([])` is the EMPTY string, so a rule that
 * cast first would report a stray `null` as a bad URL for the wrong reason and read a stray
 * `[]` as a legal blank — silently configuring a tile as "not configured". Same family as
 * CLAUDE.md's `Number(null)` trap, one cast over.
 */
export const NON_STRINGS: Array<{ what: string; input: unknown }> = [
  { what: "null", input: null },
  { what: "undefined", input: undefined },
  { what: "an object", input: {} },
  { what: "an array, whose String() cast is the empty string", input: [] },
  { what: "a number", input: 8787 },
  { what: "false, whose String() cast is not empty but is not a URL either", input: false },
];
