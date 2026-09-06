// The Registers page's tiles, decided without a document — the same pure-model/thin-DOM split
// every Phase 2 page in these apps keeps: this module says WHICH state each tile draws in,
// hub.js only draws it. DOM-free, so test/hubModel.test.js exercises it directly in node.
//
// TILE_ORDER IS FIXED, NOT DERIVED FROM THE SERVER'S ARRAY. The grid always draws OS
// Patching, AI security, DevSecOps, Coming soon (maybe) in that order and in that position on
// the page,
// whatever order api.ts's `bootstrap()` happens to list `tiles` in — a launcher whose own
// grid reflowed between reloads would be a worse product than the SPA it replaces.
export const TILE_ORDER = ["os", "ai", "devsecops", "soon"];

/**
 * One tile's drawing state: "link" (a working URL is configured), "unset" (this sidekick has
 * none yet), or "soon" (the placeholder — NEVER a link, whatever `url` happens to carry).
 *
 * The "soon" branch does not even inspect `spec.url`. `src/server/api.ts` builds that tile
 * with `url: null` and no `URL_PROP` entry by construction, so today `spec.url` is always
 * already null for it — but this model does not trust that from a distance: a tile whose own
 * KEY says "not built yet" must never become clickable because of a stray value arriving from
 * an upstream change this file cannot see.
 */
export function tileState(spec) {
  if (!spec || spec.key === "soon") return "soon";
  return spec.url ? "link" : "unset";
}

/**
 * The four tiles, in TILE_ORDER, each carrying its own drawing state.
 *
 * `boot` is api.ts's `bootstrap()` payload: `{ product, buildId, tiles, canEditAccess,
 * canEditUrls }`. A key TILE_ORDER names that `boot.tiles` did not send is simply skipped
 * rather than fabricated — a differently-shaped payload produces a shorter grid, never a tile
 * with made-up copy standing in for a fact nobody sent.
 */
export function tileModel(boot) {
  const byKey = Object.fromEntries(((boot && boot.tiles) || []).map((t) => [t.key, t]));
  return TILE_ORDER.filter((key) => byKey[key]).map((key) => {
    const spec = byKey[key];
    const state = tileState(spec);
    return {
      key,
      productName: spec.productName,
      headline: spec.headline,
      scope: spec.scope,
      url: state === "link" ? spec.url : null,
      state,
    };
  });
}
