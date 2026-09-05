// Where the three sibling sidekicks live — the only data this app stores.
//
// WHY A PROPERTY AND NOT A DERIVATION. `ScriptApp.getService().getUrl()` answers for the
// deployment it is called in and nothing else, and it has flipped between the /dev and the
// /exec form across Apps Script runtime changes (and fails outright for a versioned
// deployment). There is no API that hands one project another project's web-app URL. So the
// three addresses are pasted, once, into Script Properties by whoever deployed them, and
// this module is the one place that reads, writes and vets them.
//
// AN EMPTY VALUE IS LEGAL AND MEANS "NOT CONFIGURED". A hub with one sibling deployed is a
// normal state, and it must render as a tile that says so — never as a link to nowhere. That
// is why "" survives normalization instead of throwing: the refusal below is about values
// that are present and wrong, not about values that are absent.
//
// AND THE REFUSAL IS A SECURITY BOUNDARY, not a typo-catcher. The value ends up as the
// `href` of an anchor the reader is invited to click, so a `javascript:` URL pasted here
// would run in the app's own page. Requiring the literal prefix "https://script.google.com/"
// rejects that, and with it `http:` (downgrade), `//script.google.com/x` (protocol-relative,
// resolves to whatever the page's scheme is), a scheme-less "script.google.com/x" (a
// RELATIVE path, which would resolve against googleusercontent.com), and any other host.
// src/client/js/pages/urlsModel.js carries the same rule as a FIELD MESSAGE so the reader is
// told before they save; this one is the boundary, and it re-checks every write.

import { getProp, PROP_KEYS, setProp } from "./props";

/** The three registers, in the order the launcher draws them. `soon` is not a URL. */
export const TILE_ORDER = ["os", "ai", "devsecops"] as const;
export type TileKey = (typeof TILE_ORDER)[number];

/** Which Script Property holds each. */
export const URL_PROP: Record<TileKey, string> = {
  os: PROP_KEYS.urlOs,
  ai: PROP_KEYS.urlAi,
  devsecops: PROP_KEYS.urlDevsecops,
};

const REQUIRED_PREFIX = "https://script.google.com/";

export const URL_REJECTED =
  "A sidekick URL must start with https://script.google.com/ — paste the /exec URL from " +
  "Deploy → Manage deployments.";

/**
 * Trim, allow blank, and refuse anything that is not an Apps Script web-app URL.
 *
 * REFUSED BEFORE THE CAST, never after. `String(null)` is "null" and `String([])` is "" —
 * one would be reported as a bad URL and the other would quietly READ AS "not configured",
 * which is the failure this repo has now met three times in other shapes (CLAUDE.md's
 * "Number(null) is 0, and it is finite"). So a non-string is refused as such, and only a
 * real string gets to be trimmed. `writeUrls` never sends one: a field the payload omits is
 * skipped there rather than passed through as undefined.
 */
export function normalizeAppUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error(URL_REJECTED);
  const url = raw.trim();
  if (!url) return "";
  if (url.indexOf(REQUIRED_PREFIX) !== 0) throw new Error(URL_REJECTED);
  return url;
}

/** The three stored URLs, normalized on the way out — "" for any that is unset. */
export function readUrls(): Record<TileKey, string> {
  const out = {} as Record<TileKey, string>;
  for (const key of TILE_ORDER) {
    // Normalized on READ as well as on write, because a property can also be edited by
    // hand in Project Settings, where nothing runs this rule. A stored value that would be
    // refused on save must not be handed to the client as a link either — but reading is
    // not the place to throw (that would take the whole launcher down over one bad paste),
    // so a value this rule refuses reads as "not configured", exactly like an unset one.
    let value = "";
    try {
      value = normalizeAppUrl(getProp(URL_PROP[key]) || "");
    } catch (_e) {
      value = "";
    }
    out[key] = value;
  }
  return out;
}

/**
 * Persist whichever of the three the caller sent, normalizing every field.
 *
 * A field the payload omits is left alone — this is a PATCH, like `setSettings` in the
 * siblings, and for the same reason: three fields behind one save bar means two people
 * saving different fields a minute apart must not have the second silently revert the first.
 * An explicit "" is a value, not an omission: it clears that sibling back to unconfigured.
 */
export function writeUrls(next: Partial<Record<TileKey, unknown>>): Record<TileKey, string> {
  for (const key of TILE_ORDER) {
    if (!(key in next)) continue;
    setProp(URL_PROP[key], normalizeAppUrl(next[key]));
  }
  return readUrls();
}
