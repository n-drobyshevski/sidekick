// Nav-route icon set: one inline stroke SVG glyph per PAGES route (graph, inventory,
// combos, aars, scans, data, settings, help). The client has no icon system, so these are
// small stroke SVGs drawn on currentColor, inlined (the GAS/CSP sandbox blocks icon
// fonts/CDNs). 24-grid, rendered at 18px. Used both expanded (icon + label) and collapsed
// (icon only).
//
// Lives outside app.js rather than inside it: app.js reads `document` at module scope and
// imports every page module, so a page importing app.js just to reach these icons would be
// a cycle. This module has neither problem — any page can import it directly.
export const ROUTE_ICONS = {
  graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="7" r="2.3"/><circle cx="18.5" cy="6" r="2.3"/><circle cx="12" cy="17.5" r="2.3"/><path d="M7.6 8.1l3 7.3"/><path d="M16.6 7.7l-3.3 8"/><path d="M7.7 7.2l8.6-0.7"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4-8 4-8-4z"/><path d="M4 11l8 4 8-4"/><path d="M4 15l8 4 8-4"/></svg>',
  combos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5l8 14H4z"/><path d="M12 10v4.2"/><path d="M12 16.8h.01"/></svg>',
  // A cloud with a check inside it: the page is the pass/fail record of cloud controls,
  // and the cloud is what separates it at a glance from the combos triangle above it.
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.3 18h9a3.7 3.7 0 0 0 .5-7.4 5.1 5.1 0 0 0-9.7-1.3A3.85 3.85 0 0 0 7.3 18z"/><path d="M9.9 13.4l1.7 1.7 3.2-3.4"/></svg>',
  aars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6h14"/><path d="M5 12h14"/><path d="M5 18h14"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/></svg>',
  scans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-4.3-7.1"/><path d="M12 12l5.2-3.2"/><circle cx="12" cy="12" r="1"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.3" ry="2.8"/><path d="M4.7 5.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/><path d="M4.7 11.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>',
  // A circled question mark rather than a book or a key: the page IS a key sheet, but the
  // nav slot has to be recognised before it is read, and "?" is the convention every
  // reader already holds (PRODUCT.md, Earned familiarity).
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.4 2.5c-.7.3-.9.8-.9 1.5v.4"/><path d="M12 16.8h.01"/></svg>',
};
