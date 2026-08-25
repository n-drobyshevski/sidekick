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
// FAIL CLOSED. An unset, empty or unparseable property yields an empty list, and an empty
// list admits nobody — except the owner, who is allowed by IDENTITY rather than by the list
// (see `decide`). That exception is the entire lockout story: a typo in the property, a
// deleted property, or a property nobody ever set costs the owner nothing.
//
// The guards live in dist/entry.js rather than in api.ts's run(), because THAT is the
// untrusted boundary: google.script.run reaches top-level globals directly, and dev/boot.js
// dispatches straight into Server.api without passing through entry.js at all.

import { getProp, PROP_KEYS } from "./props";

export interface AccessDecision {
  allowed: boolean;
  /** The address the app actually saw, or "" when the caller could not be identified. */
  email: string;
  reason: "owner" | "listed" | "anonymous" | "not-listed";
}

/**
 * What a denied caller is told. Deliberately says nothing about who IS allowed, who owns the
 * deployment, or what the property is called — a denial should not double as a directory.
 */
const DENIAL_MESSAGE: Record<string, string> = {
  anonymous:
    "This app can't identify your Google account. It only recognizes accounts signed in to " +
    "the same Google Workspace domain as the app.",
  "not-listed": "You don't have access to this app.",
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
 * The decision, as a pure function of the three inputs, so the table below is unit-testable
 * without any GAS global:
 *
 *   active ""/null                      → deny   (anonymous)   — outside the domain, or a
 *                                                                context with no active user
 *   active === owner (both non-empty)   → allow  (owner)       — regardless of the list
 *   active in the list                  → allow  (listed)
 *   otherwise                           → deny   (not-listed)  — including an unset list
 *
 * Matching is exact after trim + lowercase. An alias or secondary address is a DIFFERENT
 * string and must be listed separately; the denied page names the address it actually saw,
 * which is what makes that diagnosable rather than mysterious.
 */
export function decide(
  active: string | null,
  owner: string | null,
  raw: string | null,
): AccessDecision {
  const email = (active || "").trim();
  const key = email.toLowerCase();
  if (!key) return { allowed: false, email: "", reason: "anonymous" };

  // BOTH sides must be non-empty before this comparison. Two blanks are equal, and reading
  // that as "the owner" would admit precisely the unidentified caller the check above just
  // refused — the one way this whole module could fail open.
  const ownerKey = (owner || "").trim().toLowerCase();
  if (ownerKey && ownerKey === key) return { allowed: true, email, reason: "owner" };

  return parseAllowlist(raw).indexOf(key) >= 0
    ? { allowed: true, email, reason: "listed" }
    : { allowed: false, email, reason: "not-listed" };
}

// Memoized for the life of the execution — which in GAS is the life of one request. doGet
// and its include() scriptlets would otherwise each re-read the property and re-ask Session.
// Module state is per-execution in real GAS; tests start it cold by re-importing the module,
// the same way test/requestMemos.test.ts does for the ledger memos.
let memo: AccessDecision | undefined;

/** The current caller's decision. */
export function check(): AccessDecision {
  if (memo === undefined) {
    memo = decide(
      Session.getActiveUser().getEmail(),
      Session.getEffectiveUser().getEmail(),
      getProp(PROP_KEYS.allowedUsers),
    );
  }
  return memo;
}

/**
 * Denials go to Stackdriver, not to the in-app recent-errors log: a denial is not a fault,
 * and a reload loop would evict real errors from that bounded tab.
 */
function logDenial(op: string, d: AccessDecision): void {
  console.log(JSON.stringify({ access: "denied", op, reason: d.reason, email: d.email }));
}

/**
 * The google.script.run guard: null when the caller may proceed, else the standard
 * {ok:false} envelope the client wrapper already knows how to reject with. `forbidden` joins
 * the existing errorKind vocabulary (sealed / rebuild / busy / error).
 */
export function denyResult(
  op: string,
): { ok: false; error: string; errorKind: "forbidden" } | null {
  const d = check();
  if (d.allowed) return null;
  logDenial(op, d);
  return { ok: false, error: DENIAL_MESSAGE[d.reason] || DENIAL_MESSAGE["not-listed"]!, errorKind: "forbidden" };
}

/** The guard for the editor-run maintenance globals, where a throw is the natural refusal. */
export function assertAllowed(op: string): void {
  const d = check();
  if (d.allowed) return;
  logDenial(op, d);
  throw new Error(DENIAL_MESSAGE[d.reason] || DENIAL_MESSAGE["not-listed"]!);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The denied page, as a pure string so its contents can be asserted in a unit test — the
 * doGet path itself is not reachable from either local harness (dev/serve.mjs composes the
 * page in Node and never calls Server.doGet).
 *
 * Deliberately self-contained: a handful of inline rules taken from DESIGN.md rather than the
 * 84KB styles partial, which would ship the whole design system to someone who is being
 * turned away. It names the address it saw — the single most useful fact when the cause is
 * "signed in to the wrong Google account" — and nothing else about the deployment.
 */
export function deniedHtml(d: AccessDecision, switchUrl?: string | null): string {
  const detail = d.email
    ? "You're signed in as <strong>" + escapeHtml(d.email) + "</strong>."
    : "This app can't see which Google account you're signed in as, which happens when the " +
      "account isn't in the same Google Workspace domain as the app.";
  const link = switchUrl
    ? '<p class="alt"><a href="' + escapeHtml(switchUrl) + '">Switch Google account</a></p>'
    : "";
  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Wiz Sidekick OS</title><style>",
    "*{box-sizing:border-box}",
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
    "background:#f8fafc;color:#0a0a0a;",
    "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
    ".card{max-width:32rem;margin:24px;padding:32px;background:#fff;border:1px solid #e2e8f0;",
    "border-radius:14px;box-shadow:0 1px 2px rgba(10,10,10,.06)}",
    ".product{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 12px}",
    "h1{font-size:20px;line-height:1.3;margin:0 0 12px;font-weight:650}",
    "p{margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155}",
    ".alt{margin-top:20px}",
    "a{color:#2563eb}",
    "a:focus-visible{outline:2px solid #2563eb;outline-offset:2px;border-radius:4px}",
    "</style></head><body><main class=\"card\">",
    "<p class=\"product\">Wiz Sidekick OS</p>",
    "<h1>You don't have access to this app.</h1>",
    "<p>" + detail + "</p>",
    "<p>If you think you should have access, ask whoever runs this dashboard to add you.</p>",
    link,
    "</main></body></html>",
  ].join("");
}

/** The doGet guard: null when the caller may proceed, else the page to serve instead. */
export function deniedPage(): GoogleAppsScript.HTML.HtmlOutput | null {
  const d = check();
  if (d.allowed) return null;
  logDenial("doGet", d);
  let switchUrl: string | null = null;
  try {
    // Best effort only — the page's job is to explain the denial, and it still does that if
    // the service URL is unavailable for any reason.
    switchUrl =
      "https://accounts.google.com/AccountChooser?continue=" +
      encodeURIComponent(ScriptApp.getService().getUrl());
  } catch (_e) {
    switchUrl = null;
  }
  return HtmlService.createHtmlOutput(deniedHtml(d, switchUrl))
    .setTitle("Wiz Sidekick OS")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * The deploying owner's address. Under "execute as me" this is who the script runs as, in an
 * installable trigger it is who created the trigger — either way, the one account that must
 * never be locked out. Used by setup() to seed the allowlist.
 */
export function ownerEmail(): string {
  return Session.getEffectiveUser().getEmail() || "";
}
