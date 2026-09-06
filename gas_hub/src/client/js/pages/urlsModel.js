// The client's mirror of src/server/urls.ts's `normalizeAppUrl` — THE SAME RULE, restated as
// a field message rather than a boundary throw. This is the FIELD MESSAGE, not the boundary:
// the server re-validates on `api_saveUrls` and is the copy of record. Two copies of one rule
// is deliberate here (see the plan's "Risks and open items"), so a bad paste is caught before
// the save round trip rather than only after it — with nothing on the input itself explaining
// why the save bar refused.
//
// DOM-free, so test/urlsModel.test.js exercises it directly, against the same case table
// test/urls.test.ts runs over the server-side `normalizeAppUrl`.
//
// TYPE IS CHECKED BEFORE ANY CAST, on purpose — the `Number(null)` trap (CLAUDE.md) has a
// String() cousin here. `String(null)` is the four-character string "null" and `String([])`
// is the EMPTY string, so casting first would read a stray `[]` as a legal blank field and a
// stray `null` as an illegal one, both for the wrong reason. A plain JS string is the only
// shape an `<input>`'s `.value` ever actually is; anything else is refused up front, the same
// way the server's boundary refuses `null`/`undefined`/`{}`/`[]` rather than coercing them.
//
// TWO LEGAL FORMS, AND THE SECOND ONE IS WHY THIS APP CAN BE DEVELOPED AT ALL. A deployed
// sidekick lives under https://script.google.com/; a sibling running under `npm run dev`
// lives on plain HTTP on its own loopback port (gas 8787, gas_ai 8788, gas_devsecops 8789,
// this hub 8790). Refusing the second would leave a locally-run hub with four tiles it cannot
// point at anything. See src/server/urls.ts's header for why that is a misconfiguration
// rather than a hole in a real deployment, and for what stays refused: `javascript:`, `http:`
// to any other host, protocol-relative, and scheme-less strings.
//
// THE PREFIXES ARE BUILT, NEVER WRITTEN AS A LITERAL "https://…" — the same fix
// gas/src/client/js/ui/nvd.js already carries for the one other outbound URL literal in this
// repo. esbuild.config.mjs's middlebox guard fails the build on any bare `//` surviving a
// proxy's comment-stripping replay, and that check runs on the whole minified bundle, so a
// double slash sitting inside an ordinary quoted string trips it exactly as one sitting in a
// stray comment would. `.join("/")` produces the same two characters at RUNTIME without
// either one ever appearing adjacent in the SOURCE.
const SCRIPT_PREFIX = ["https:", "", "script.google.com", ""].join("/");
// The trailing colon is part of each prefix on purpose: it forces a port, so
// "http://localhost.evil.example/" is a different host rather than a longer match, and
// "http://localhost/" is refused too.
const LOCAL_PREFIXES = [
  ["http:", "", "localhost:"].join("/"),
  ["http:", "", "127.0.0.1:"].join("/"),
];

const MESSAGE =
  "A sidekick URL must start with " + SCRIPT_PREFIX + " (a deployed /exec URL) or "
  + LOCAL_PREFIXES[0] + "<port>/ (a sibling's local dev harness).";

/**
 * The inline field message for one URL input's current value, or `null` when it is legal.
 * A trimmed-blank value is legal — it means "not configured," same as the server's `""`.
 */
export function urlProblem(raw) {
  if (typeof raw !== "string") return MESSAGE;
  const v = raw.trim();
  if (v === "") return null;
  const legal = v.startsWith(SCRIPT_PREFIX)
    || LOCAL_PREFIXES.some((prefix) => v.startsWith(prefix));
  return legal ? null : MESSAGE;
}

/** The placeholder text settings.js draws the input with — same construction, same reason.
 *  The deployed form, because that is the one an operator pastes; the loopback form is a
 *  developer's own machine and needs no prompting. */
export function urlPlaceholder() {
  return SCRIPT_PREFIX + "…/exec";
}
