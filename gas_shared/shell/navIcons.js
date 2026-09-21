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
