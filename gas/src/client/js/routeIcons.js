// Nav icon sets: one glyph per LANE (the items the 76px rail draws) and one per PAGES route
// (the rows its panel lists, and the chrome pages that are rail items in their own right).
//
// The client has no icon system, so these are small stroke SVGs drawn on currentColor and
// inlined — the GAS/CSP sandbox blocks icon fonts and CDNs. 24-grid, rendered at 18px.
//
// Lives outside app.js rather than inside it: app.js reads `document` at module scope and
// imports every page module, so a page importing app.js just to reach these icons would be a
// cycle. This module has neither problem — any page can import it directly, and
// the shared navGroups contract can hold LANE_ICONS against the lanes PAGES declares.
//
// THE SHARED MARKS COME FROM gas_shared/shell/navIcons.js. A mark with a second consumer is
// drawn once there and named here; a mark with one consumer is drawn here, in full, because
// it is this register's own claim. Every route still has exactly one visible entry below, in
// rail order, so the whole nav is readable in one file.

import {
  backClock, bars, book, curve, cylinder, sheets, shotTarget, sliders, stopwatch, trays,
} from "../../../../gas_shared/shell/navIcons.js";

// The LANE marks — one per labelled lane, drawn on the rail where the lane, not the page, is
// the item. Deliberately NOT a copy of any route glyph below: a lane's mark has to be
// recognisable beside the page marks its own panel lists, so Security is not the shield the
// OS-vulnerabilities page already owns and Data is not the cylinder its own Data page draws.
// Every labelled lane holds at least two pages, so every one of them reaches the rail and
// every one of them needs a mark. That used to carry a caveat — navModel.railItems draws a
// lane holding one visible page AS that page, so the one-page "Overview" lane never reached
// the rail and never needed a mark. It also never should have existed: renderStackedNav
// below 800px draws a lane heading unconditionally. See app.js's PAGES.
export const LANE_ICONS = {
  // Both marks are gas_shared/shell/navIcons.js's, shared with gas_devsecops, whose lanes
  // these are. The crosshair-over-a-target that used to mark a five-page "Security" lane
  // retires with the lane: it aimed at a question ("how fast is this closing") that Program
  // now names outright, and it was a near-twin of the concentric rings the Coverage &
  // efficiency page draws.
  Program: curve,
  Registers: sheets,
  // Deliberately NOT the cylinder its own Storage page draws: a lane's mark has to be
  // recognisable beside the page marks its own panel lists.
  Data: trays,
};


// One glyph per PAGES route. Every key here must be a route in PAGES and every non-hidden
// route must have one — gas_shared/test/contracts/navGroups.js holds both halves, and holds
// every mark here distinct from every other.
export const ROUTE_ICONS = {
  executive: bars,
  mttr: stopwatch,
  program: shotTarget,
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l7 2.4v5.2c0 4.2-2.9 7-7 8.4-4.1-1.4-7-4.2-7-8.4V5.6z"/><path d="M12 8.5v3.4"/><path d="M12 15h.01"/></svg>',
  // A snowflake: three axes through one centre, each tipped with a pair of barbs. The page is
  // about what has stopped moving, and a flake is the one figure in this set that says "frozen"
  // without borrowing a severity's meaning. Deliberately not a clock (mttr owns the dial) and
  // not a target (program and the Security lane both draw concentric rings); the six barbs are
  // what keeps it legible at 18px rather than reading as a plain asterisk.
  coldZone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M4.2 7.5l15.6 9"/><path d="M19.8 7.5l-15.6 9"/><path d="M9.6 4.8L12 6.4l2.4-1.6"/><path d="M9.6 19.2L12 17.6l2.4 1.6"/><path d="M4.6 11.2l-.4-2.8 2.7-.9"/><path d="M19.4 12.8l.4 2.8-2.7.9"/><path d="M17.1 7.5l2.7.9-.4 2.8"/><path d="M6.9 16.5l-2.7-.9.4-2.8"/></svg>',
  history: backClock,
  attribution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h6.5l9 9-6.5 6.5-9-9z"/><path d="M8 8.5h.01"/></svg>',
  data: cylinder,
  // An open book on its spine — the key sheet, and the one route mark that names a thing to
  // READ rather than a thing to measure. Deliberately the same glyph gas_devsecops draws for
  // the same route: a severity means one thing everywhere and so does the book, and two
  // different marks for one page would be the drift this package exists to undo.
  help: book,
  settings: sliders,
};

// The play triangle on the rail's Run scan button, and the tick that marks the scope
// switcher's chosen row. Not lane or route marks, but the same construction and the same
// reason for living here rather than in app.js.
export const RUN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>';
