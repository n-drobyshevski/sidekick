// Cross-page handoff for the Attribution page's "Attribute…" action. DOM-free and
// pure so it is unit-testable (domainsImport.js precedent) — no ui/store/api
// imports here. attribution.js writes the prefill payload before navigating to
// Settings; settings.js/domainsEditor.js read it back to seed the domain-rule
// dialog. Versioned so a stale payload from an older build never round-trips
// into something the reader mis-parses.

export const PREFILL_KEY = "wsk-attribution-prefill";

/** Escape all JS regex metacharacters so a literal string can be embedded in a pattern. */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resource (an unassigned-resources row: { asset, subscription, subscriptionExtId,
 * supportGroup, ... }) -> a single domain-rule condition that would match it, or
 * null when neither field is usable. Preference: a subscription condition (broader,
 * matches every asset in the subscription) over an exact-match name_regex anchored
 * to this one asset. Shapes must match domainRules.ts compileCondition: subscription
 * conditions carry `values` (array), name_regex carries `pattern`.
 */
export function buildPrefillRule(resource) {
  const r = resource || {};
  if (typeof r.subscription === "string" && r.subscription.trim()) {
    return { conditions: [{ type: "subscription", values: [r.subscription] }] };
  }
  if (typeof r.asset === "string" && r.asset.trim()) {
    return { conditions: [{ type: "name_regex", pattern: "^" + escapeRegex(r.asset) + "$" }] };
  }
  return null;
}

/** Resource -> versioned JSON string for sessionStorage/hash handoff. */
export function encodePrefill(resource) {
  return JSON.stringify({ v: 1, resource });
}

/** Versioned JSON string -> resource object, or null for anything malformed. Never throws. */
export function decodePrefill(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.v !== 1) return null;
  const resource = data.resource;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return null;
  return resource;
}
