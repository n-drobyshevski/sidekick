// Which Wiz console URLs a register may store and link to — the rule, stated once.
//
// WHAT THIS GUARDS. `portalUrl` is a field Wiz returns on a finding: an absolute link into
// the tenant's console, the thing a reader clicks when they stop reading the register and
// start acting on the finding. It arrives from the API, so the obvious reading is that it
// needs no checking at all. That reading is wrong, and the reason is the storage:
//
//   Wiz  →  scan frame  →  THE LEDGER TAB OF A GOOGLE SHEET  →  the wire  →  an href
//
// The ledger is a spreadsheet an operator can open and type into, and nothing runs when they
// do. A `javascript:` URL typed into a `portal_url` cell would be served back to every reader
// of that register and run in the app's own page. This is the same argument gas_shared's
// hubUrl.js makes about a hand edit in Project Settings, one storage layer over: the question
// is never "was the value trustworthy when it was written", it is "can anything reach this
// cell that did not come through the write path". Something can.
//
// SO THE PREFIX LIST IS A SECURITY BOUNDARY, NOT A TYPO-CATCHER. Requiring one of the two
// prefixes below refuses `javascript:`, refuses `http:` to any host (a downgrade), refuses
// `//app.wiz.io/x` (protocol-relative, resolving to whatever scheme the page is on), refuses
// a scheme-less "app.wiz.io/x" (a RELATIVE path, which resolves against the sandbox's own
// googleusercontent.com origin), and refuses every other host.
//
// THE TRAILING SLASH IS PART OF THE PREFIX, and it is the whole defence against a longer
// match: without it "https://app.wiz.io.evil.example/x" starts with "https://app.wiz.io" and
// would pass. With it, the character after the host must be the path separator, so a
// different host that merely begins with the same letters is refused. hubUrl.js makes the
// same move with the trailing colon on its localhost prefixes; the trap is identical and so
// is the fix.
//
// TWO COPIES, NOT FOUR, AND THE DIFFERENCE IS NOT AN OVERSIGHT. hubUrl states its rule once
// per app on the server because no `src/server/**` module there may import a `.js` module
// under a tsconfig with no `allowJs`. This module is TypeScript, and `gas_shared/domain/sha1`
// already proves a shared .ts is importable from both `src/domain/**` and `src/server/**` in
// all three registers — so every server-side reader shares THIS file, and only the client
// needs a copy (gas_shared/wizUrl.js), because the client bundle is plain JS. Both are run
// against one case table, gas_shared/test/contracts/wizUrl.js.
//
// BOTH SIDES ANSWER SILENTLY, WHICH IS WHERE THIS DEPARTS FROM hubUrl ON PURPOSE. There, the
// boundary THROWS, because a save has a reader waiting for an answer and storing "" would
// report a bad paste as a successful save. Here there is no save and no reader: the value is
// ingested in bulk, mid-scan, from a page of findings nobody is watching. Throwing would end
// a scan over one malformed URL in one finding — trading a whole register's freshness for a
// link. So a refused value is dropped to null at ingestion and to "" at render, and the
// finding keeps every other fact it carries.
//
// BLANK IS LEGAL AND MEANS "NO LINK", not "something went wrong". Three ordinary states
// produce it: a ledger row written before `portal_url` existed, a finding Wiz returned with
// no `portalUrl`, and a scope whose Wiz type has no such field at all. None of them is an
// error and none of them should draw anything — see the finding sheets, which omit the row
// rather than dashing it.
//
// THE PREFIXES ARE BUILT, NEVER WRITTEN AS A LITERAL. Each app's esbuild.config.mjs fails the
// build on any bare `//` surviving a comment-stripping replay of the bundle, and that check
// runs over the whole minified output — a double slash inside an ordinary quoted string trips
// it exactly as one in a stray comment would. `.join("/")` produces the same two characters
// at RUNTIME without either ever appearing adjacent in the SOURCE. This file is TypeScript
// and is not itself bundled into a client, but its .js twin is, and a rule spelled two ways
// across two copies is a rule with somewhere to drift.

/**
 * The Wiz consoles a register may link to.
 *
 * TWO HOSTS, AND THE SECOND ONE IS DELIBERATE RATHER THAN SPECULATIVE. `app.wiz.io` is the
 * commercial console; `app.wiz.us` is the separate US-Gov/FedRAMP tenancy, which is a
 * different deployment of Wiz rather than a different page of the same one. A register
 * running against a FedRAMP tenant would otherwise store every URL and link to none of them,
 * failing silently in exactly the way a blank means something else.
 *
 * NOTE WHAT IS *NOT* HERE: a regional host. The API endpoint IS regionalized — this estate's
 * is `api.eu15.app.wiz.io` — and the temptation is to derive the console host from
 * `WIZ_API_URL`, which is already configured. That derivation is wrong: the console is not
 * regionalized, and a tenant on `api.eu15...` still browses at `app.wiz.io`. Deriving it
 * would refuse every real URL Wiz sends. The link needs no configuration at all, because
 * Wiz sends an absolute URL and this list only has to recognize it.
 */
const PORTAL_PREFIXES = [
  ["https:", "", "app.wiz.io", ""].join("/"),
  ["https:", "", "app.wiz.us", ""].join("/"),
];

/** Shared by both readers, so "legal" is decided exactly once per copy of this rule. */
function isLegal(url: string): boolean {
  return PORTAL_PREFIXES.some((prefix) => url.indexOf(prefix) === 0);
}

/**
 * The value the ledger may store, or null for "this finding has no link".
 *
 * REFUSED BEFORE ANY CAST, the trap CLAUDE.md names for `Number(null)` and hubUrl.js names
 * for `String(null)`: `String(null)` is the four-character string "null" and `String([])` is
 * the EMPTY string, so a rule that cast first would store "null" as a URL-shaped value and
 * read a stray `[]` as a legal blank. A JSON string is the only shape `portalUrl` ever
 * actually arrives as; anything else is a malformed response or a wiring defect, and both
 * answer the same way here — no link, every other field kept.
 */
export function normalizeWizUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url) return null;
  return isLegal(url) ? url : null;
}
