// Nav icon sets: one glyph per LANE (the items the 76px rail draws) and one per PAGES route
// (the rows its panel lists, and the chrome pages that are rail items in their own right).
//
// The client has no icon system, so these are small stroke SVGs drawn on currentColor and
// inlined — the GAS/CSP sandbox blocks icon fonts and CDNs. 24-grid, rendered at 18px.
//
// Lives outside app.js rather than inside it: app.js reads `document` at module scope and
// imports every page module, so a page importing app.js just to reach these icons would be a
// cycle. This module has neither problem — any page can import it directly, and
// test/navGroups.test.js can hold LANE_ICONS against the lanes PAGES declares.

// The LANE marks — one per labelled lane, drawn on the rail where the lane, not the page, is
// the item. Deliberately NOT a copy of any route glyph below: a lane's mark has to be
// recognisable beside the page marks its own panel lists, so Security is not the shield the
// OS-vulnerabilities page already owns and Data is not the cylinder its own Data page draws.
// A lane holding one visible page is drawn AS that page (navModel.railItems), so only lanes
// that survive that collapse need a mark here.
export const LANE_ICONS = {
  // Crosshairs over a target. The lane is where the register is read for what to fix and how
  // fast it got fixed — an aim rather than an object, and the one mark here that could not be
  // mistaken for the shield, the clock or the dial its panel lists.
  Security: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2.2v3"/><path d="M12 18.8v3"/><path d="M2.2 12h3"/><path d="M18.8 12h3"/></svg>',
  // Trays, stacked. The lane holds the register's own paperwork — the export, the scan log,
  // the attribution map — and a stack of trays says "the record of what we did" where the
  // Data page's cylinder says "the store itself".
  Data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 15.5L12 19.5l8.5-4"/><path d="M3.5 11.5L12 15.5l8.5-4"/><path d="M12 4.5l8.5 4-8.5 4-8.5-4z"/></svg>',
};

// One glyph per PAGES route. Every key here must be a route in PAGES and every non-hidden
// route must have one — test/navGroups.test.js holds both halves.
export const ROUTE_ICONS = {
  executive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-3"/><circle cx="12" cy="15" r="1"/></svg>',
  mttr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5"/><path d="M12 13.5l3 2"/><path d="M9.5 3.5h5"/></svg>',
  program: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3"/><path d="M12 18.5v3"/><path d="M2.5 12h3"/><path d="M18.5 12h3"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l7 2.4v5.2c0 4.2-2.9 7-7 8.4-4.1-1.4-7-4.2-7-8.4V5.6z"/><path d="M12 8.5v3.4"/><path d="M12 15h.01"/></svg>',
  scan_history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M3.5 4.5V9h4.5"/><path d="M12 8.5v4l2.8 1.7"/></svg>',
  attribution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h6.5l9 9-6.5 6.5-9-9z"/><path d="M8 8.5h.01"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.3" ry="2.8"/><path d="M4.7 5.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/><path d="M4.7 11.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>',
};

// The play triangle on the rail's Run scan button, and the tick that marks the scope
// switcher's chosen row. Not lane or route marks, but the same construction and the same
// reason for living here rather than in app.js.
export const RUN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>';
