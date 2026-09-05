// Nav icon set: one glyph per PAGES route. This app has no lane the icon rail collapses a
// page into — both routes are `group: null` (app.js) — so LANE_ICONS is empty; ROUTE_ICONS
// carries the two the rail and the flyout panel actually draw.
//
// The client has no icon system, so these are small stroke SVGs drawn on currentColor and
// inlined — the GAS/CSP sandbox blocks icon fonts and CDNs. 24-grid, rendered at 18px, used
// both expanded (icon + label) and collapsed (icon only) — same convention every sibling's
// routeIcons.js uses.
//
// test/shared.test.js holds both halves against PAGES: every route has exactly one mark, and
// neither set carries an entry for something that is gone.

// No labelled lane exists in this app's PAGES, so there is no lane mark to draw. Present and
// empty, not absent: gas_shared/test/contracts/parity.js's readdirSync of ui/ is a different
// guard, but the manifest's own LANE_ICONS/ROUTE_ICONS pair is expected by name regardless of
// whether either side has entries.
export const LANE_ICONS = {};

export const ROUTE_ICONS = {
  // Four rounded squares in a loose 2x2 — the front door IS the grid a reader is about to
  // land on, so the rail's own mark for "Registers" is that same shape rather than a new one.
  hub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>',
  // Verbatim from gas_devsecops/src/client/js/routeIcons.js — the settings glyph carries no
  // register-specific meaning, so there is nothing about this app that argues for a new one.
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>',
};
