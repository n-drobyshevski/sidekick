// The nav marks more than one app needs, drawn once.
//
// KEYED BY WHAT THE MARK IS, NOT BY WHICH ROUTE USES IT, and that is load-bearing rather
// than stylistic. `gas_shared/test/contracts/navGroups.js` asserts SET EQUALITY between an
// app's ROUTE_ICONS keys and its route list, so a donor map keyed by route could not be
// spread into an app — it would hand gas_hub an `executive` key for a route it does not
// have. Keying by mark also means two apps naming the same mark for different routes is a
// decision visible on the page, where a byte-comparison of two 400-character strings in two
// files is not: `gas_devsecops`'s history mark and `gas_ai`'s scans mark were the same
// drawing for two years and nothing could see it.
//
// WHAT IS NOT HERE. A mark with one consumer stays in that app's own routeIcons.js — the
// register's shield, the cold zone's snowflake, the graph's nodes, the hub's tiles. Those
// are domain claims, and the promotion bar in gas_shared/README.md is a SECOND consumer,
// not a hope of one.
//
// Every mark is a 24-grid stroke SVG on currentColor, hidden from assistive tech, reaching
// nothing outside the bundle — the GAS sandbox blocks a CDN or an icon font at runtime only,
// so the navGroups contract checks all four properties on every mark an app ends up with.

// The store itself. Byte-identical in three apps before this file existed.
export const cylinder = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.3" ry="2.8"/><path d="M4.7 5.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/><path d="M4.7 11.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/></svg>';

// AN OPEN BOOK ON ITS SPINE: the thing you read, not the thing you measure. Already
// byte-identical in gas and gas_devsecops, and gas's own routeIcons.js said why — "two
// different marks for one page would be the drift this package exists to undo".
//
// gas_ai drew a circled "?" instead, arguing that a top-level rail item has to be
// recognised before it is read. That argument was about a rail item; its key sheet is a
// row inside the Data panel now, beside its own label, so the premise expired with the
// placement.
export const book = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.4c-1.4-1.3-3.4-1.9-6.4-1.9v13.6c3 0 5 .6 6.4 1.9"/><path d="M12 6.4c1.4-1.3 3.4-1.9 6.4-1.9v13.6c-3 0-5 .6-6.4 1.9"/><path d="M12 6.4v13.6"/></svg>';

// Settings. Byte-identical in all four apps before this file existed — the one mark
// nobody had ever drawn twice.
export const sliders = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>';

// ONE NAMED EXPORT PER MARK, NOT ONE OBJECT, and that is about bytes rather than taste.
// esbuild cannot drop an unused PROPERTY of an exported object, so a single NAV_MARKS map
// shipped all ten marks to every app — gas_hub, which has two routes, carried nine drawings
// it never renders. Named exports tree-shake: each app bundles the marks it imports and
// nothing else.
//
// NO PICKER FUNCTION AND NO DEFAULT EITHER. A consumer names an export directly, so a typo
// is an unresolved import — a build error, which is the earliest possible refusal. Even a
// mark that slipped through as undefined is caught per app by the navGroups contract's own
// sweep, which asserts every mark an app ends up with carries `viewBox="0 0 24 24"`,
// `currentColor` and `aria-hidden`, and names the offending route or lane when one does
// not.

// LANE. A descending curve: how the programme is doing over time, the shape every page under
// it draws. Deliberately not a clock — a lane's mark has to be recognisable beside the page
// marks its own panel lists, and `mttr` owns the dial.
export const curve = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5v14h17"/><path d="M6.5 8.5c3.6 0 4.2 7.5 11 7.5"/></svg>';

// LANE. Stacked sheets: the population the register holds, which is what the panel lists.
export const sheets = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 3.8h9a1.4 1.4 0 0 1 1.4 1.4v10.4a1.4 1.4 0 0 1-1.4 1.4h-9A1.4 1.4 0 0 1 6.1 15.6V5.2a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M9 20.2h9.2a1.9 1.9 0 0 0 1.9-1.9V8.2"/></svg>';

// LANE. Stacked trays: the stored record, layered.
//
// gas_devsecops drew ruled rows with offset dots for this lane, and that drawing is
// all but identical to gas_ai's `aars` mark. gas_ai gains a Data lane in this wave, so
// taking the rows would have put two near-twin marks in ONE nav — which is what the
// uniqueness rule in gas_shared/test/contracts/navGroups.js catches, one app over from
// where it used to be able to see it.
export const trays = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 15.5L12 19.5l8.5-4"/><path d="M3.5 11.5L12 15.5l8.5-4"/><path d="M12 4.5l8.5 4-8.5 4-8.5-4z"/></svg>';

// ONE TALL BAR BESIDE TWO SHORT: a headline number with the figures that support it.
//
// gas drew a GAUGE here — a semicircular arc with a needle and a pivot dot — and PRODUCT.md
// rules gauges out in as many words ("no wall of red/orange cells, no gauges, no blinking
// risk drama"), echoed at gas_ai/DESIGN.md. Nothing had ever held a nav mark against that
// line, so the violation shipped. This is the one of these picks decided by a written rule
// rather than by taste.
export const bars = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7.5 20V13"/><path d="M12 20V4.5"/><path d="M16.5 20v-4.6"/></svg>';

// A STOPWATCH — dial, hands, and the crown stem above it. MTTR is a DURATION, and a plain
// clock face says time of day. gas_devsecops drew the plain clock, which also could not sit
// beside `backClock` below without the two reading as one mark used twice.
export const stopwatch = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5"/><path d="M12 13.5l3 2"/><path d="M9.5 3.5h5"/></svg>';

// RINGS WITH THE SHOT OFF-CENTRE. Coverage and efficiency are exactly the question of
// whether effort landed where it was aimed, and a clean bullseye would claim it did. gas
// drew concentric rings with four ticks, which were near-twins of the crosshair on its own
// now-retired Security lane.
export const shotTarget = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.6"/><circle cx="14.1" cy="9.9" r="1"/></svg>';

// A CLOCK WITH ITS ARROW RUNNING BACKWARDS: the record of what ran, not a duration.
//
// THIS ONE RETIRES A CROSS-APP DUPLICATE. gas_devsecops drew a sweep line with a dot here,
// BYTE-IDENTICAL to gas_ai's `scans` mark — one picture for two different pages in two
// different apps, which no in-app uniqueness rule can see. The sweep means one thing now
// and belongs to one page.
export const backClock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M3.5 4.5V9h4.5"/><path d="M12 8.5v4l2.8 1.7"/></svg>';
