// Where the hub lives, as far as this register is concerned — the BOUNDARY copy of the rule.
//
// THE RULE ITSELF IS gas_shared/hubUrl.js's, and that file's header carries the full argument:
// why the address has to be pasted rather than derived (`ScriptApp.getService().getUrl()`
// answers for THIS deployment only, and no API hands one Apps Script project another's web-app
// URL), why blank is legal and means "not configured", why loopback is the second legal form,
// and why the prefix list is a security boundary rather than a typo-catcher.
//
// WHY THIS FILE EXISTS SEPARATELY. No `src/server/**` module in this app imports `gas_shared`,
// and tsconfig.json's `include` is `src/**/*.ts` with no `allowJs`, so importing that .js
// module from strict-mode server TypeScript is not something `npm run typecheck` will accept.
// The copies are held together by ONE CASE TABLE instead —
// gas_shared/test/contracts/hubUrl.js, registered from test/shared.test.js, which runs the
// same inputs against this boundary and against the shared client copy. A case added there is
// answered by both or it fails on one.
//
// AND THE TWO SIDES ANSWER DIFFERENTLY ON PURPOSE. This one THROWS; the header's
// `safeHubUrl` returns "". A save has a reader waiting for an answer, and silently storing ""
// would report a bad paste as a successful save that cleared the field. A header has nobody
// who can act on the problem, so there the same value simply draws no button.

import { getProp, PROP_KEYS, setProp } from "./props";

/**
 * The two legal prefixes, BUILT rather than written, so no bare `//` appears in the source.
 *
 * esbuild.config.mjs's middlebox guard fails the build on any `//` surviving a
 * comment-stripping replay of the bundle, and that check runs over the whole minified output —
 * a double slash inside an ordinary quoted string trips it exactly as one in a stray comment
 * would. `.join("/")` produces the same two characters at RUNTIME without either ever
 * appearing adjacent in the SOURCE. gas_shared/hubUrl.js and gas_hub's own pair are built the
 * same way, so a reader comparing the copies does not have to decide whether a literal in one
 * and a join in another mean the same thing.
 */
const SCRIPT_PREFIX = ["https:", "", "script.google.com", ""].join("/");
/** Both loopback spellings, with the trailing colon that forces a port — which is what makes
 *  "http://localhost.evil.example/" a different host rather than a longer match. */
const LOCAL_PREFIXES = [
  ["http:", "", "localhost:"].join("/"),
  ["http:", "", "127.0.0.1:"].join("/"),
];

export const HUB_URL_REJECTED =
  "The hub URL must start with " + SCRIPT_PREFIX + " (the hub's deployed /exec URL) or "
  + LOCAL_PREFIXES[0] + "<port>/ (a hub running under npm run dev).";

/**
 * Trim, allow blank, and refuse anything that is neither an Apps Script web-app URL nor a
 * loopback dev-harness one.
 *
 * REFUSED BEFORE THE CAST, never after. `String(null)` is "null" and `String([])` is "" — one
 * would be reported as a bad URL for the wrong reason and the other would quietly READ AS
 * "not configured", clearing a hub link that was set. Same family as CLAUDE.md's
 * `Number(null)` trap, one constructor over.
 */
export function normalizeHubUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error(HUB_URL_REJECTED);
  const url = raw.trim();
  if (!url) return "";
  const legal = url.indexOf(SCRIPT_PREFIX) === 0
    || LOCAL_PREFIXES.some((prefix) => url.indexOf(prefix) === 0);
  if (!legal) throw new Error(HUB_URL_REJECTED);
  return url;
}

/**
 * The stored hub URL, normalized on the way out — "" when unset OR unusable.
 *
 * NORMALIZED ON READ AS WELL AS ON WRITE, because a Script Property can also be edited by hand
 * in Project Settings, where nothing runs this rule. A value this rule refuses must not reach
 * the client as a link either — but reading is not the place to throw: that would take the
 * whole register down over one bad paste, so it reads as "not configured", exactly like an
 * unset one. The client's own `safeHubUrl` makes the same call again at render time, because
 * this is not the only way a payload can reach it.
 */
export function readHubUrl(): string {
  try {
    return normalizeHubUrl(getProp(PROP_KEYS.urlHub) || "");
  } catch (_e) {
    return "";
  }
}

/** Persist a new value, normalizing it first. Returns what was actually stored. */
export function writeHubUrl(next: unknown): string {
  const url = normalizeHubUrl(next);
  setProp(PROP_KEYS.urlHub, url);
  return url;
}
