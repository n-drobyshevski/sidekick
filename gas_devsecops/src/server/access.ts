// Who may use the deployed web app.
//
// The deployment's own fence is "Anyone within <domain>", which admits every account in the
// Workspace. This narrows it to the addresses listed in the ALLOWED_USERS Script Property.
// Apps Script has no per-account access list of its own — the deploy dropdown offers only
// Only-myself / Anyone-with-a-Google-Account / Anyone / Anyone-within-<domain> — so a named
// set of accounts can only be expressed in code, on top of that fence.
//
// IT RESTS ON ONE DOCUMENTED GUARANTEE, AND ONLY HOLDS INSIDE THE DOMAIN. The Session
// reference says the active user's email "is not available in any context that allows a
// script to run without that user's authorization ... [or in] a web app deployed to 'execute
// as me'", except that "these restrictions generally do not apply if the developer runs the
// script themselves or belongs to the same Google Workspace domain as the user". So a
// same-domain visitor is identifiable and can be matched by address, and anybody else — a
// consumer account, another org — reads as "" and is DENIED rather than silently admitted.
// An allowlist cannot be extended to accounts outside the domain by this route at all; that
// would need "execute as the user accessing", which hands every viewer direct access to the
// ledger spreadsheet.
//
// AND THE OTHER HALF OF THE MANIFEST IS JUST AS LOAD-BEARING, in the opposite direction.
// dist/appsscript.json pins `"executeAs": "USER_DEPLOYING"`, and it must stay pinned: under
// "execute as the user accessing" the EFFECTIVE user is the visitor, so `ownerEmail()` below
// returns whoever is looking, `decide()` matches them against themselves, and every
// same-domain caller is admitted as the owner — with canEditAdmins() true and the grant
// power in hand. The `access` half failing wrong denies everybody and is obvious; this half
// failing wrong admits everybody and is silent. Both are pinned in the manifest for that
// reason.
//
// FAIL CLOSED. An unset, empty or unparseable property yields an empty list, and an empty
// list admits nobody — except the owner, who is allowed by IDENTITY rather than by the list
// (see `decide`). That exception is the entire lockout story: a typo in the property, a
// deleted property, or a property nobody ever set costs the owner nothing.
//
// The guards live in dist/entry.js rather than in api.ts's run(), because THAT is the
// untrusted boundary: google.script.run reaches top-level globals directly, and dev/boot.js
// dispatches straight into Server.api without passing through entry.js at all.

import { cardPage, escapeHtml, secondaryAction } from "./pageShell";
import { getProp, PROP_KEYS } from "./props";

/** The one place the product is named on the standalone pages. */
export const PRODUCT = "Wiz Sidekick DevSecOps";

export interface AccessDecision {
  allowed: boolean;
  /** The address the app actually saw, or "" when the caller could not be identified. */
  email: string;
  reason: "owner" | "admin" | "listed" | "anonymous" | "not-listed";
}

/**
 * What a denied caller is told over RPC, and what the Stackdriver line carries. Says nothing
 * about who IS allowed or what the property is called — a denial should not double as a
 * directory. (The denied PAGE additionally names one contact, deliberately; see deniedHtml.
 * These strings do not, because they are log lines as much as user-facing text.)
 */
// These are ALSO the Stackdriver denial lines, which is why "not-listed" names the cause
// rather than restating the verdict. It used to read "You don't have access to this app." —
// word for word the heading the SPA's card renders above it, so a revoked user saw the same
// sentence twice (and the log line said nothing the `reason` field hadn't). A message that
// complements the heading fixes both.
const DENIAL_MESSAGE: Record<string, string> = {
  anonymous:
    "This app can't identify your Google account. It only recognizes accounts signed in to " +
    "the same Google Workspace domain as the app.",
  "not-listed": "Your account isn't on this app's access list.",
};

/**
 * The addresses in the property, lowercased and deduped.
 *
 * Split on commas, semicolons AND whitespace so a list pasted one-per-line, one-per-cell or
 * space-separated all parse the same — an address can contain none of those, so nothing
 * valid is broken by splitting on all of them.
 */
export function parseAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen[email]) continue;
    seen[email] = true;
    out.push(email);
  }
  return out;
}

/**
 * The decision, as a pure function of its inputs, so the table below is unit-testable
 * without any GAS global:
 *
 *   active ""/null                      → deny   (anonymous)   — outside the domain, or a
 *                                                                context with no active user
 *   active === owner (both non-empty)   → allow  (owner)       — regardless of either list
 *   active in the admins list           → allow  (admin)
 *   active in the users list            → allow  (listed)
 *   otherwise                           → deny   (not-listed)  — including unset lists
 *
 * Matching is exact after trim + lowercase. An alias or secondary address is a DIFFERENT
 * string and must be listed separately; the denied page names the address it actually saw,
 * which is what makes that diagnosable rather than mysterious.
 *
 * ADMINS ARE ALLOWED BY BEING ADMINS, not by also appearing in the users list. An admin who
 * could not open the app could not reach the Settings panel that makes them one, and holding
 * their standing in a single list is what stops another admin from demoting them by editing
 * the users list. `adminsRaw` is optional so every caller predating the tier — and every
 * deployment with no ALLOWED_ADMINS property — decides exactly as it did before.
 */
export function decide(
  active: string | null,
  owner: string | null,
  raw: string | null,
  adminsRaw?: string | null,
): AccessDecision {
  const email = (active || "").trim();
  const key = email.toLowerCase();
  if (!key) return { allowed: false, email: "", reason: "anonymous" };

  // BOTH sides must be non-empty before this comparison. Two blanks are equal, and reading
  // that as "the owner" would admit precisely the unidentified caller the check above just
  // refused — the one way this whole module could fail open.
  const ownerKey = (owner || "").trim().toLowerCase();
  if (ownerKey && ownerKey === key) return { allowed: true, email, reason: "owner" };

  if (parseAllowlist(adminsRaw ?? null).indexOf(key) >= 0) {
    return { allowed: true, email, reason: "admin" };
  }

  return parseAllowlist(raw).indexOf(key) >= 0
    ? { allowed: true, email, reason: "listed" }
    : { allowed: false, email, reason: "not-listed" };
}

// Memoized for the life of the execution — which in GAS is the life of one request. doGet
// and its include() scriptlets would otherwise each re-read the property and re-ask Session.
// Module state is per-execution in real GAS; here the module registry outlives a test, so
// __resetMemosForTest below joins the list test/gasEnv.ts sweeps in resetServerMemos().
let memo: AccessDecision | undefined;

/** The current caller's decision. */
export function check(): AccessDecision {
  if (memo === undefined) {
    memo = decide(
      Session.getActiveUser().getEmail(),
      Session.getEffectiveUser().getEmail(),
      getProp(PROP_KEYS.allowedUsers),
      getProp(PROP_KEYS.allowedAdmins),
    );
  }
  return memo;
}

/** See the memo comment above — gasEnv.ts calls this between tests. */
export function __resetMemosForTest(): void {
  memo = undefined;
}

/**
 * Denials go to Stackdriver rather than being raised as faults: a denial is not a fault, and
 * a reload loop against a revoked account would otherwise fill the execution log with
 * exceptions that need no investigation. One console.log line per refusal is the whole
 * record, and `reason` is what makes it readable in aggregate.
 */
function logDenial(op: string, d: AccessDecision): void {
  console.log(JSON.stringify({ access: "denied", op, reason: d.reason, email: d.email }));
}

/**
 * The google.script.run guard: null when the caller may proceed, else the standard
 * {ok:false} envelope the client wrapper already knows how to reject with. `forbidden` joins
 * the errorKind vocabulary api.ts's run() mints (busy / error) — and is minted HERE rather
 * than by run(), because the whole point is to refuse before run() is ever reached.
 */
export function denyResult(op: string): DenyEnvelope | null {
  const d = check();
  if (d.allowed) return null;
  logDenial(op, d);
  const env: DenyEnvelope = {
    ok: false,
    error: DENIAL_MESSAGE[d.reason] || DENIAL_MESSAGE["not-listed"]!,
    errorKind: "forbidden",
  };
  // Carried as its own fields rather than appended to `error`, because `error` is also the
  // Stackdriver denial line: an address in every log entry is noise the `reason` field already
  // covers. The client composes the sentence; the server just supplies who and the href.
  const who = ownerEmail().trim();
  if (who) {
    env.contact = who;
    env.contactUrl = contactMailto(who);
  }
  return env;
}

export interface DenyEnvelope {
  ok: false;
  error: string;
  errorKind: "forbidden";
  /** The owner's address, for the "contact X" line. Absent if it could not be resolved. */
  contact?: string;
  contactUrl?: string;
}

/** The guard for the editor-run maintenance globals, where a throw is the natural refusal. */
export function assertAllowed(op: string): void {
  const d = check();
  if (d.allowed) return;
  logDenial(op, d);
  throw new Error(DENIAL_MESSAGE[d.reason] || DENIAL_MESSAGE["not-listed"]!);
}

/**
 * The "ask for access" mailto, built in ONE place because two surfaces render it: the denied
 * page doGet serves, and the card the SPA shows when access is revoked with a tab already
 * open. The prefilled subject is the whole point — the request arrives legible rather than as
 * "hi, can I get access to the thing" — and a subject string maintained twice would drift.
 */
export function contactMailto(email: string): string {
  return "mailto:" + email.trim() +
    "?subject=" + encodeURIComponent("Access to " + PRODUCT);
}

/**
 * The denied page, as a pure string so its contents can be asserted in a unit test — the
 * doGet path itself is not reachable from either local harness (dev/serve.mjs composes the
 * page in Node and never calls Server.doGet).
 *
 * It names the address it saw — the single most useful fact when the cause is "signed in to
 * the wrong Google account" — and nothing else about the deployment.
 */
export function deniedHtml(
  d: AccessDecision,
  switchUrl?: string | null,
  contact?: string | null,
): string {
  const detail = d.email
    ? "You're signed in as <strong>" + escapeHtml(d.email) + "</strong>."
    : "This app can't see which Google account you're signed in as, which happens when the " +
      "account isn't in the same Google Workspace domain as the app.";

  // NAMING THE OWNER HERE IS DELIBERATE, and it reverses what this page originally did.
  //
  // The page still discloses no roster and no property name — a denial must not double as a
  // directory of who DOES have access. The owner's own address is a different question, and
  // the audience settles it: the deployment's access level is DOMAIN, so Google refuses
  // everyone outside the Workspace before doGet is ever reached. The only people who can see
  // this page are colleagues who could have looked the owner up in the directory anyway, and
  // "ask whoever runs this dashboard" was asking them to go and do exactly that.
  //
  // mailto rather than plain text, with the subject filled in, so the request that arrives is
  // legible instead of "hi, can I get access to the thing".
  const who = (contact || "").trim();
  const ask = who
    ? "If you think you should have access, contact " +
      '<a href="' + escapeHtml(contactMailto(who)) + '">' + escapeHtml(who) + "</a>."
    : // No owner address resolved — never render "contact:" with nothing after it.
      "If you think you should have access, ask whoever runs this dashboard to add you.";

  return cardPage({
    title: PRODUCT,
    eyebrow: PRODUCT,
    heading: "You don't have access to this app.",
    paragraphs: [detail, ask],
    actions: switchUrl ? secondaryAction(switchUrl, "Switch Google account") : "",
  });
}

/** The doGet guard: null when the caller may proceed, else the page to serve instead. */
export function deniedPage(): GoogleAppsScript.HTML.HtmlOutput | null {
  const d = check();
  if (d.allowed) return null;
  logDenial("doGet", d);
  return HtmlService.createHtmlOutput(deniedHtml(d, accountChooserUrl(), ownerEmail()))
    .setTitle(PRODUCT)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * This deployment's own URL, or null if it cannot be determined.
 *
 * Shared with the entry screen, where the stakes are higher than here: the denial page merely
 * loses its switch-account link, but a Continue button pointing nowhere would strand an
 * ALLOWED user, so welcome.ts treats null as "skip the gate".
 */
export function serviceUrl(): string | null {
  try {
    return ScriptApp.getService().getUrl() || null;
  } catch (_e) {
    return null;
  }
}

/** Google's account picker, pointed back at this deployment. Null when the URL is unknown. */
export function accountChooserUrl(): string | null {
  const url = serviceUrl();
  return url
    ? "https://accounts.google.com/AccountChooser?continue=" + encodeURIComponent(url)
    : null;
}

/**
 * The deploying owner's address. Under "execute as me" this is who the script runs as, in an
 * installable trigger it is who created the trigger — either way, the one account that must
 * never be locked out. Used by setup() to seed the allowlist.
 */
export function ownerEmail(): string {
  return Session.getEffectiveUser().getEmail() || "";
}

// ---------------------------------------------------------------- the admin tier
//
// WHERE THE TIER STOPS, AND WHY IT STOPS THERE. Admins may edit ALLOWED_USERS; only the owner
// may edit ALLOWED_ADMINS. If admins could promote admins the tier would self-propagate and
// collapse back into "anyone who can edit can grant anything" — the delegation would be
// indistinguishable from handing out ownership. Keeping promotion with the owner is the entire
// difference between a real second tier and a cosmetic one, and test/accessAdmin.test.ts
// exists to fail the moment it is blurred.
//
// Note what an admin still cannot do: admit anyone outside the Workspace domain (they read as
// "" and are denied before either list is consulted), lock the owner out (identity, not
// membership), or demote another admin by editing the users list (admin standing lives in the
// admins list alone).

/** The deploying account — the only identity that is allowed without appearing in any list. */
export function isOwner(): boolean {
  return check().reason === "owner";
}

/** Owner or admin: may add and remove people from ALLOWED_USERS. */
export function canEditUsers(): boolean {
  const r = check().reason;
  return r === "owner" || r === "admin";
}

/** Owner only: may add and remove admins. Deliberately narrower than canEditUsers. */
export function canEditAdmins(): boolean {
  return isOwner();
}

/** The current lists, parsed. Callers must have checked they may see them. */
export function currentUsers(): string[] {
  return parseAllowlist(getProp(PROP_KEYS.allowedUsers));
}

export function currentAdmins(): string[] {
  return parseAllowlist(getProp(PROP_KEYS.allowedAdmins));
}

/** The owner's domain, for the client's "this address can never match" warning. */
export function ownerDomain(): string {
  const at = ownerEmail().lastIndexOf("@");
  return at >= 0 ? ownerEmail().slice(at + 1).toLowerCase() : "";
}
