// Nav icon sets: one glyph per LANE (the items the 76px rail draws) and one per PAGES route
// (the rows its panel lists, and the chrome pages that are rail items in their own right).
//
// The client has no icon system, so these are small stroke SVGs drawn on currentColor and
// inlined — the GAS/CSP sandbox blocks icon fonts and CDNs. 24-grid, rendered at 18px, used
// both expanded (icon + label) and collapsed (icon only).
//
// Lives outside app.js rather than inside it: app.js reads `document` at module scope and
// imports every page module, so a page importing app.js just to reach these icons would be
// a cycle. This module has neither problem.
//
// test/shared.test.js holds both halves against PAGES: every lane has exactly one mark,
// every route has exactly one, and neither set carries an entry for something that is gone.
//
// THE SHARED MARKS COME FROM gas_shared/shell/navIcons.js. A mark with a second consumer is
// drawn once there and named here; a mark with one consumer is drawn here, in full, because
// it is this register's own claim. Every route still has exactly one visible entry below, in
// rail order, so the whole nav is readable in one file.

import {
  book, curve, cylinder, sheets, sliders, trays,
} from "../../../../gas_shared/shell/navIcons.js";

// The LANE marks. A lane's mark has to be recognisable BESIDE the page marks its own panel
// lists, so none of these is a copy of a route glyph below.
export const LANE_ICONS = {
  // All three are gas_shared/shell/navIcons.js's now, shared with gas/, which arrived at
  // these same three lanes. The curve and the sheets are this register's own drawings,
  // promoted unchanged.
  Program: curve,
  Registers: sheets,
  // TRAYS, NOT THE RULED ROWS THIS USED TO DRAW. The rows-with-dots were all but identical
  // to gas_ai's `aars` mark, and gas_ai gains a Data lane in this wave — two near-twin
  // marks in one nav is exactly what the uniqueness rule refuses.
  Data: trays,
};



export const ROUTE_ICONS = {
  // A single tall bar beside two short ones: the page is one headline number with its
  // supporting counts, and the mark says so before the label does.
  executive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7.5 20V13"/><path d="M12 20V4.5"/><path d="M16.5 20v-4.6"/></svg>',
  // A clock. The page is time-to-remediate and nothing else, and the clock is the only
  // glyph a reader needs no label to place.
  mttr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.4"/><path d="M12 6.8V12l3.4 2.2"/></svg>',
  // A target with the shot off-centre: coverage and efficiency are precisely the question
  // of whether effort landed where it was aimed, and a bullseye alone would claim it did.
  program: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.6"/><circle cx="14.1" cy="9.9" r="1"/></svg>',
  // A package. SCA is third-party code arriving as a unit, and the box is that unit.
  sca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.3l7.6 3.9v9.6L12 20.7l-7.6-3.9V7.2z"/><path d="M4.6 7.3L12 11.1l7.4-3.8"/><path d="M12 11.1v9.5"/></svg>',
  // Angle brackets with a mark between them: first-party source, and the mark is the
  // finding sitting inside it.
  sast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.4 7.6L4 12l4.4 4.4"/><path d="M15.6 7.6L20 12l-4.4 4.4"/><path d="M12.8 6.2l-1.6 11.6"/></svg>',
  // A key. Not a padlock: a lock says "protected", and every row on this page is the
  // opposite of protected.
  secrets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.2" cy="12" r="3.7"/><path d="M11.7 11.3h8.1"/><path d="M17.4 11.3v3.3"/><path d="M14.6 11.3v2.4"/></svg>',
  // A branch. The register's asset is a repository branch, which is literally what the
  // ledger keys on, so the mark is the thing itself.
  repos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="5.6" r="2.2"/><circle cx="7" cy="18.4" r="2.2"/><circle cx="17" cy="9.4" r="2.2"/><path d="M7 7.8v8.4"/><path d="M17 11.6c0 3.4-3 4.3-6.6 4.9"/></svg>',
  // A sweep line with a mark on it: one scan is one dated observation of the register.
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-4.3-7.1"/><path d="M12 12l5.2-3.2"/><circle cx="12" cy="12" r="1"/></svg>',
  data: cylinder,
  // An open book. Every other Data-lane mark is a record of what happened; this is the one
  // page that records nothing and defines everything, so the mark is deliberately not a
  // fourth variation on rows-and-marks.
  help: book,
  settings: sliders,
};
