// The entry screen an ALLOWED caller sees before the dashboard.
//
// IT IS NOT A LOGIN, AND MUST NEVER BEHAVE LIKE ONE. The deployment's access level is DOMAIN,
// and the only level that admits an unauthenticated visitor is ANYONE_ANONYMOUS — so by the
// time doGet runs, Google has already signed this person in and access.ts has already decided
// they are allowed. There is no credential to collect here and asking for one would be a
// phishing pattern, not a security control.
//
// What it is for is the failure that actually happens: the long-standing Apps Script
// multiple-accounts trap, where a browser signed into several Google accounts runs the app as
// the wrong one. Without this screen that person's first sign of trouble is the denial page.
// With it, the app says whose account it is using before they start reading numbers.
//
// SHOWN ONCE PER WORKING SESSION, and the ceiling is not a preference: CacheService caps
// expiry at 21600s (6 hours). So the marker SLIDES — it is re-put on every page load — which
// makes a continuous working day cost exactly one Continue, while an overnight gap expires it
// and the screen returns in the morning. Six idle hours mid-day also brings it back; that is
// the honest limit of what the platform offers.
//
// The marker lives in the SCRIPT cache keyed by a hash of the address. Not the user cache:
// under "execute as me" the effective user is the owner, so getUserCache() is the OWNER's
// store for every visitor, and one person clicking Continue would dismiss the screen for
// everybody.

import { accountChooserUrl, check, PRODUCT, serviceUrl } from "./access";
import { cardPage, escapeHtml, primaryAction, secondaryAction } from "./pageShell";
import { paramsHash } from "./serverCache";

/** CacheService's documented maximum. Not a tuning knob — put() rejects more than this. */
export const ENTRY_TTL_SEC = 21600;

/** The query parameter Continue carries back. */
export const ENTER_PARAM = "enter";

/** Hashed so no address is stored in a cache key. */
function markerKey(email: string): string {
  return "entered:" + paramsHash(email.trim().toLowerCase());
}

function markEntered(email: string): void {
  try {
    CacheService.getScriptCache().put(markerKey(email), "1", ENTRY_TTL_SEC);
  } catch (e) {
    // A cache write failure costs one extra Continue click, nothing more. It must never
    // propagate: this is a courtesy screen sitting in front of the whole app.
    console.warn("entry marker write failed: " + e);
  }
}

function hasEntered(email: string): boolean {
  try {
    return CacheService.getScriptCache().get(markerKey(email)) !== null;
  } catch (e) {
    console.warn("entry marker read failed: " + e);
    return true; // Fail OPEN — see the fail-safe note on gate().
  }
}

/**
 * The screen, as a pure string so it can be asserted without a GAS runtime (doGet is not
 * reachable from either local harness — dev/serve.mjs composes the page in Node and never
 * calls it, so a unit test on this string is the only coverage available before deployment).
 */
export function welcomeHtml(email: string, continueUrl: string, switchUrl?: string | null): string {
  return cardPage({
    title: PRODUCT,
    eyebrow: PRODUCT,
    heading: "You're signed in.",
    paragraphs: [
      "This dashboard will open as <strong>" + escapeHtml(email) + "</strong>.",
      "If that isn't the account you meant to use, switch before you continue — the register " +
        "you see depends on which account opens it.",
    ],
    actions:
      primaryAction(continueUrl, "Continue") +
      (switchUrl ? secondaryAction(switchUrl, "Switch Google account") : ""),
  });
}

/**
 * The doGet gate: the page to serve instead of the app, or null to let the caller through.
 *
 * Runs only after access.ts has allowed the caller, so it is a courtesy, never a boundary —
 * and it is written so it cannot become one by accident. IT FAILS OPEN IN EVERY DIRECTION:
 * no address to key on, no deployment URL to point Continue at, or a cache that will not
 * answer, and the caller goes straight to the app. A gate that strands somebody who IS
 * allowed would be a worse bug than never showing the screen at all — the same no-lockout
 * rule the allowlist itself follows, for the same reason.
 */
export function gate(e?: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput | null {
  const email = check().email;
  if (!email) return null;

  // Arriving from Continue. Mark first, then let them through — this is the only path that
  // starts a session, so a screen that was rendered but never clicked does not count as one.
  if (e && e.parameter && e.parameter[ENTER_PARAM]) {
    markEntered(email);
    return null;
  }

  if (hasEntered(email)) {
    markEntered(email); // The slide: an active session keeps renewing and never re-prompts.
    return null;
  }

  const url = serviceUrl();
  if (!url) return null; // No working Continue target — never render a button that strands.

  const continueUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + ENTER_PARAM + "=1";
  return HtmlService.createHtmlOutput(welcomeHtml(email, continueUrl, accountChooserUrl()))
    .setTitle(PRODUCT)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
