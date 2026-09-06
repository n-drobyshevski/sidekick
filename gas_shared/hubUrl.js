// Where the hub lives, as far as a register is concerned — one rule, four readers.
//
// THIS IS THE SAME RULE gas_hub/src/server/urls.ts STATES IN THE OTHER DIRECTION. The hub
// learns its three siblings' addresses from Script Properties an operator pastes; a register
// learns the hub's the same way, and for the same platform reason:
// `ScriptApp.getService().getUrl()` answers for the deployment it is called in and nothing
// else, and there is no API that hands one Apps Script project another project's web-app URL.
// So the address is pasted, once per register, and this module is what every CLIENT-side
// reader of it goes through.
//
// AND IT IS A SECURITY BOUNDARY, NOT A TYPO-CATCHER. The value ends up as the `href` of an
// anchor sitting in the app header of every page of every register — the single most-clicked
// pixel this chrome has. A `javascript:` URL pasted into the field would therefore run in the
// app's own page. Requiring one of the prefixes below refuses that, and with it `http:` to any
// other host (a downgrade), `//script.google.com/x` (protocol-relative, resolving to whatever
// scheme the page happens to be on), a scheme-less "script.google.com/x" (a RELATIVE path,
// which resolves against the sandbox's googleusercontent.com origin), and every other host.
//
// THE SERVER RE-CHECKS AND IS THE COPY OF RECORD. Each register's own
// `src/server/hubUrl.ts` throws on a bad value at the moment `api_saveHubUrl` would write it;
// this module is the FIELD MESSAGE (so a bad paste is named at the input rather than only
// after a save round trip) and the RENDER GUARD (so a value that reached the property by some
// other route — a hand edit in Project Settings, where nothing runs this — still cannot
// become an href). Four copies of one rule are only defensible while they are provably the
// same rule, which is what gas_shared/test/contracts/hubUrl.js is for: one case table, run
// against the shared client copy here and against all three server boundaries.
//
// BLANK IS LEGAL AND MEANS "NOT CONFIGURED". A register whose operator has not pasted a hub
// URL is a normal, and the correct first, state — the header simply carries no hub button.
// That is why "" survives instead of throwing: the refusal is about values that are present
// and wrong, never about values that are absent.
//
// LOCALHOST IS THE SECOND LEGAL FORM, and it is here so the four apps can run side by side on
// one machine — gas 8787, gas_ai 8788, gas_devsecops 8789, the hub 8790 (each dev/serve.mjs).
// Without it a register under `npm run dev` could not link to a locally-run hub and the
// journey this button exists for would be untestable before a deployment. In a real
// deployment a localhost URL is a visible misconfiguration rather than a hole: it points
// somewhere only the person who set it can reach, and it says so the first time anybody else
// clicks it. What it is not is a way to smuggle a foreign origin in — the colon is PART of the
// prefix, so "http://localhost.evil.example/" is refused (a different host that merely starts
// with the same letters), and so are "http://localhost/" with no port and
// "https://localhost:8790/" (the harness is plain http; the https form is a typo worth
// catching rather than a second legal shape).
//
// THE PREFIXES ARE BUILT, NEVER WRITTEN AS A LITERAL. Each app's esbuild.config.mjs fails the
// build on any bare `//` surviving a comment-stripping replay of the bundle, and that check
// runs over the whole minified output — a double slash inside an ordinary quoted string trips
// it exactly as one in a stray comment would. `.join("/")` produces the same two characters at
// RUNTIME without either ever appearing adjacent in the SOURCE. gas_hub's own two copies and
// gas/src/client/js/ui/nvd.js carry the same construction for the same reason.

/** A deployed Apps Script web app. The only remote host a hub URL may name. */
const SCRIPT_PREFIX = ["https:", "", "script.google.com", ""].join("/");

/** Both loopback spellings a browser hands back for a local dev harness. The trailing colon
 *  is deliberate: it forces a PORT, which is what makes "localhost.evil.example" a different
 *  host rather than a longer match. */
const LOCAL_PREFIXES = [
  ["http:", "", "localhost:"].join("/"),
  ["http:", "", "127.0.0.1:"].join("/"),
];

/**
 * The one sentence a reader gets when the field refuses their paste.
 *
 * Stated as what IS accepted rather than as what went wrong: someone pasting the wrong thing
 * has no way to guess the right thing from "invalid URL", and the two legal shapes are short
 * enough to just say.
 */
export const HUB_URL_MESSAGE =
  "The hub URL must start with " + SCRIPT_PREFIX + " (the hub's deployed /exec URL) or "
  + LOCAL_PREFIXES[0] + "<port>/ (a hub running under npm run dev).";

/**
 * What the Settings field shows in an empty input.
 *
 * THE DEPLOYED FORM, not the loopback one, even though both are legal: a placeholder is a
 * worked example of what the reader is being asked for, and the only person who ever types a
 * localhost URL here is a developer whose dev harness has already seeded it (see each app's
 * dev/boot.js). Showing the shape an operator actually pastes is the whole job.
 */
export const HUB_URL_PLACEHOLDER = SCRIPT_PREFIX + "a/macros/<domain>/s/<id>/exec";

/** Shared by both readers below, so "legal" is decided exactly once. */
function isLegal(url) {
  return url.indexOf(SCRIPT_PREFIX) === 0
    || LOCAL_PREFIXES.some((prefix) => url.indexOf(prefix) === 0);
}

/**
 * The inline field message for one input's current value, or `null` when it is legal.
 *
 * REFUSED BEFORE ANY CAST. `String(null)` is the four-character string "null" and
 * `String([])` is the EMPTY string, so a rule that cast first would report a stray `null` as a
 * bad URL for the wrong reason and read a stray `[]` as a legal blank — silently recording the
 * hub as "not configured". Same family as CLAUDE.md's `Number(null)` trap, one cast over. A
 * plain string is the only shape an `<input>`'s `.value` ever actually is; anything else is a
 * wiring defect and is named as one.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function hubUrlProblem(raw) {
  if (typeof raw !== "string") return HUB_URL_MESSAGE;
  const url = raw.trim();
  if (url === "") return null;
  return isLegal(url) ? null : HUB_URL_MESSAGE;
}

/**
 * The value the header may put in an `href`, or "" for "draw no button".
 *
 * SEPARATE FROM `hubUrlProblem` BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS, and collapsing
 * them is where a real disagreement could hide. The field asks "should I tell this reader
 * something?"; the header asks "is this safe to link to?". A value the field would refuse and
 * a value nobody has set must reach the header as the SAME answer — no button — because a
 * header is not a place a misconfiguration can be acted on. Throwing here instead would take
 * the whole app's chrome down over one bad paste, which is the failure gas_hub's `readUrls`
 * already refuses for its tiles.
 *
 * @param {unknown} raw
 * @returns {string} the trimmed URL, or "" when absent or refused
 */
export function safeHubUrl(raw) {
  if (typeof raw !== "string") return "";
  const url = raw.trim();
  if (url === "") return "";
  return isLegal(url) ? url : "";
}
