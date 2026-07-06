// Parsing for domain-rules JSON exported by this app or the Streamlit dashboard.
// Pure and DOM-free so it is unit-testable. Structural checks only — deep rule
// validation stays server-side (api_saveDomains → domainRules.validateDomains),
// the same gate the editor's own Save uses.

export const EXPORT_KIND = "wiz-sidekick-domains";

/**
 * Exported domains JSON text → { items } or { error }.
 *
 * Accepts the canonical export ({kind, items}), a raw settings wrapper
 * ({version, items}) or a bare JSON array. Copies only {name, rules} per entry:
 * Streamlit items carry an editor-local `id` that must not be persisted here.
 */
export function parseDomainsImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: "Not valid JSON: " + e.message };
  }
  let raw;
  if (Array.isArray(data)) raw = data;
  else if (data && typeof data === "object" && Array.isArray(data.items)) raw = data.items;
  else return { error: 'Unrecognized format — expected {"items": [...]} or a JSON array.' };

  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: `Item ${i + 1}: expected an object.` };
    }
    if (typeof entry.name !== "string" || !entry.name.trim()) {
      return { error: `Item ${i + 1}: missing name.` };
    }
    items.push({ name: entry.name, rules: Array.isArray(entry.rules) ? entry.rules : [] });
  }
  return { items };
}
