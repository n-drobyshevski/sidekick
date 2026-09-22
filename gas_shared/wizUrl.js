// The client's copy of the Wiz console URL rule — the last gate before a stored string
// becomes an href.
//
// THE RULE ITSELF IS gas_shared/domain/wizUrl.ts's, and that file's header carries the full
// argument: why a value the API supplied still needs checking (it rests in a hand-editable
// Google Sheet on the way here), why the trailing slash is load-bearing rather than tidy,
// why blank is legal and means "no link", and why neither side throws.
//
// WHY THIS FILE EXISTS SEPARATELY. The client bundle is plain JavaScript assembled by
// esbuild from `src/client/js/**` and cannot import a TypeScript module; the server and
// domain halves can, and do, share the .ts directly rather than keeping a copy each. So this
// rule has exactly TWO copies, not hubUrl's four, and they are held together by ONE CASE
// TABLE — gas_shared/test/contracts/wizUrl.js, registered from each app's test/shared.test.js,
// which runs the same inputs against this copy and against the TypeScript one. A case added
// there is answered by both or it fails on one.
//
// AND THIS COPY IS NOT REDUNDANT WITH THAT ONE. The ingestion side normalizes what a scan
// writes; this side re-asks the question at render time, because the ledger row can be
// changed after it was written by somebody typing in the spreadsheet, where nothing runs
// either rule. That is the whole reason a render guard exists at all — the same argument
// hubUrl.js's `safeHubUrl` makes about a hand edit in Project Settings.

/** The two Wiz consoles, built so no bare `//` reaches the bundle — see the .ts header. */
const PORTAL_PREFIXES = [
  ["https:", "", "app.wiz.io", ""].join("/"),
  ["https:", "", "app.wiz.us", ""].join("/"),
];

/**
 * The value a sheet may put in an `href`, or "" for "draw no link".
 *
 * ONE ANSWER FOR ABSENT AND FOR REFUSED, on purpose. A finding Wiz gave no URL for, a row
 * written before the column existed, and a cell somebody pasted `javascript:` into are three
 * different stories, but the reader can act on none of them, and a sheet is not a place a
 * malformed ledger cell can be fixed. They collapse to the same rendering — no row — and the
 * finding's footnote is what says that the register has no link to this one.
 *
 * @param {unknown} raw
 * @returns {string} the trimmed URL, or "" when absent or refused
 */
export function safeWizUrl(raw) {
  if (typeof raw !== "string") return "";
  const url = raw.trim();
  if (url === "") return "";
  return PORTAL_PREFIXES.some((prefix) => url.indexOf(prefix) === 0) ? url : "";
}
