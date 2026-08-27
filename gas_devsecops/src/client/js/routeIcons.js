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
// test/navGroups.test.js holds both halves against PAGES: every lane has exactly one mark,
// every route has exactly one, and neither set carries an entry for something that is gone.

// The LANE marks. A lane's mark has to be recognisable BESIDE the page marks its own panel
// lists, so none of these is a copy of a route glyph below.
export const LANE_ICONS = {
  // A descending curve. The lane is how the programme is doing over time — the shape every
  // page under it draws. Deliberately not a clock: `mttr` owns that below, and a lane's
  // mark has to be recognisable beside the page marks its own panel lists.
  "Программа": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5v14h17"/><path d="M6.5 8.5c3.6 0 4.2 7.5 11 7.5"/></svg>',
  // Stacked sheets: three registers side by side, which is exactly what the panel lists.
  "Реестры": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 3.8h9a1.4 1.4 0 0 1 1.4 1.4v10.4a1.4 1.4 0 0 1-1.4 1.4h-9A1.4 1.4 0 0 1 6.1 15.6V5.2a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M9 20.2h9.2a1.9 1.9 0 0 0 1.9-1.9V8.2"/></svg>',
  // Ruled rows with marks on them: the stored record, and the panel says which part of it.
  "Данные": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.2h15"/><path d="M4.5 12h15"/><path d="M4.5 17.8h15"/><circle cx="8.4" cy="6.2" r="1.6"/><circle cx="14.8" cy="12" r="1.6"/><circle cx="10.6" cy="17.8" r="1.6"/></svg>',
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
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.3" ry="2.8"/><path d="M4.7 5.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/><path d="M4.7 11.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>',
};
