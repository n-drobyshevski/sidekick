// The client's mirror of src/server/urls.ts's `normalizeAppUrl` — THE SAME RULE, restated as
// a field message rather than a boundary throw. This is the FIELD MESSAGE, not the boundary:
// the server re-validates on `api_saveUrls` and is the copy of record. Two copies of one rule
// is deliberate here (see the plan's "Risks and open items"), so a bad paste is caught before
// the save round trip rather than only after it — with nothing on the input itself explaining
// why the save bar refused.
//
// DOM-free, so test/urlsModel.js exercises it directly, against the same case table
// test/urls.test.ts runs over the server-side `normalizeAppUrl`.
//
// TYPE IS CHECKED BEFORE ANY CAST, on purpose — the `Number(null)` trap (CLAUDE.md) has a
// String() cousin here. `String(null)` is the four-character string "null" and `String([])`
// is the EMPTY string, so casting first would read a stray `[]` as a legal blank field and a
// stray `null` as an illegal one, both for the wrong reason. A plain JS string is the only
// shape an `<input>`'s `.value` ever actually is; anything else is refused up front, the same
// way the server's boundary refuses `null`/`undefined`/`{}`/`[]` rather than coercing them.
//
// THE REQUIRED PREFIX IS BUILT, NEVER WRITTEN AS A LITERAL "https://…" — the same fix
// gas/src/client/js/ui/nvd.js already carries for the one other outbound URL literal in this
// repo. esbuild.config.mjs's middlebox guard fails the build on any bare `//` surviving a
// proxy's comment-stripping replay, and that check runs on the whole minified bundle, so a
// double slash sitting inside an ordinary quoted string trips it exactly as one sitting in a
// stray comment would. `.join("/")` produces the same two characters at RUNTIME without
// either one ever appearing adjacent in the SOURCE.
const REQUIRED_PREFIX = ["https:", "", "script.google.com", ""].join("/");

const MESSAGE =
  "A sidekick URL must start with " + REQUIRED_PREFIX + " — paste the /exec URL from "
  + "Deploy → Manage deployments.";

/**
 * The inline field message for one URL input's current value, or `null` when it is legal.
 * A trimmed-blank value is legal — it means "not configured," same as the server's `""`.
 */
export function urlProblem(raw) {
  if (typeof raw !== "string") return MESSAGE;
  const v = raw.trim();
  if (v === "") return null;
  return v.startsWith(REQUIRED_PREFIX) ? null : MESSAGE;
}

/** The placeholder text settings.js draws the input with — same construction, same reason. */
export function urlPlaceholder() {
  return REQUIRED_PREFIX + "…/exec";
}
