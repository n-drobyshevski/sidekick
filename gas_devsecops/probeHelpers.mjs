// The probe's pure string helpers, extracted so they can be TESTED.
//
// WHY THIS FILE EXISTS. probe.mjs cannot be imported: it checks credentials, bundles the
// app through esbuild and top-level-awaits an import, all at module scope. So the two
// functions below — both of which are pure, and both of which shipped a bug — had no test
// between them. One swallowed inline comments out of .env.local and silently scoped every
// query to a project that does not exist; the other, after a fix, started reporting
// `filePath` as a timestamp. Neither is the kind of bug that looks dangerous in review, and
// neither would have survived a test.

/**
 * One .env value: quoted verbatim, unquoted stripped of a trailing `# comment`.
 *
 * The greedy `(.*)` this replaces swallowed the comment, so
 *
 *     WIZ_PROJECT_ID_V2=1dfea0cf-…   # VALUE-CHAIN, pre-filled
 *
 * produced a 101-character project ID — the UUID plus the words after it. Every query was
 * then scoped to a project that does not exist, and the tenant answered each one with a
 * cheerful empty page. An empty register and a parse bug look identical from the outside.
 */
export function envValue(raw) {
  const s = String(raw).trim();
  const q = s[0];
  if (q === '"' || q === "'") {
    const end = s.indexOf(q, 1);
    // A quoted value keeps everything between the quotes, `#` included — some secrets carry
    // one, and stripping there would corrupt a credential rather than a comment.
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  return s.replace(/\s+#.*$/, "").trim();
}

// Words that name a point in time. One list, three case conventions built from it.
const LOWER = "at|date|time|timestamp|seen|detected|resolved|created|updated|opened|closed|first|last";
const CAP = LOWER.split("|").map((w) => w[0].toUpperCase() + w.slice(1)).join("|");

/**
 * THREE BRANCHES, ALL CASE-SENSITIVE, and that is the point rather than the style.
 *
 * A single case-insensitive regex cannot do this job. The version that carried an `i` flag
 * made `[a-z_]` and `[A-Z_]` each match any letter, which destroyed the camelCase boundary
 * the pattern depended on: `filePath` matched as P + at + h, and `status` as st + at + us.
 * It bought `CREATED_AT` at the cost of the anchoring, and went from flagging 4 of a type's
 * 43 fields to flagging 13 — including six that are not timestamps at all.
 *
 *   HEAD   a lowercase word starting a camelCase name   createdAt, lastSeenAt
 *   MID    a Capitalised word inside one                rejectionExpiredAt, firstDetectedAtSource
 *   SNAKE  a SCREAMING_SNAKE enum value                 CREATED_AT, LAST_SEEN
 */
const HEAD = new RegExp(`^(${LOWER})([A-Z]|$)`);
const MID = new RegExp(`[a-z](${CAP})([A-Z]|$)`);
const SNAKE = new RegExp(`(^|_)(${LOWER.toUpperCase()})(_|$)`);

/** Does this FIELD NAME name a point in time? */
export function temporalName(name) {
  const n = String(name);
  return HEAD.test(n) || MID.test(n) || SNAKE.test(n);
}

/** Does this GraphQL TYPE name one? Carries the fields a name alone would miss. */
export function temporalType(type) {
  return /date|time/i.test(String(type));
}

/** Fields that look like a point in time, by name or by type. */
export function temporalFields(fields) {
  return (fields ?? []).filter((f) => temporalName(f.name) || temporalType(f.type));
}
