// The DOM-free half of the question all four Scoring Models tabs share: is a figure a
// measurement over the landscape, or a population nobody has synced yet?
//
// F4. `?dry&noseed#/aars` printed ten bare "0"s — the AARS gap ladder's claim-rail column
// (each cascade row's share of the tenant's gap instances) and the band-rail's per-severity
// asset counts. Both come from `api_previewAarsRule`, which succeeds even with zero synced
// assets: it answers "0 of 0" rather than refusing, so `matchCounts`/`gapInstanceTotal` come
// back as real (if empty) arrays and objects — truthy — and the page read that truthiness as
// "measured". CLAUDE.md's rule is that an unmeasured register is not a register of zeroes;
// the fix is to let the page's own `synced` flag (`!!boot.latestSync`, read once at the top
// of `renderAarsRules`) override what the preview claims, not to trust the preview's shape.
//
// `value || 0` is exactly the rewrite this refuses: it prints "0" for the unsynced case as
// readily as for a genuinely empty landscape, and the two mean opposite things — one is a
// population nobody has looked at, the other is a population that was looked at and found
// empty. Refuse BEFORE the fallback, keyed on `synced`, never after.

import { absentText } from "../ui.js";

/**
 * A figure computed over the landscape — a census count, a preview total, an evaluated
 * share — rendered as text. `value` is whatever the synced case prints (a number, an already
 * formatted string); the unsynced case always answers with the shared absence mark, never
 * `value` itself, because there is no landscape for `value` to be a measurement of.
 *
 * Used at the one place in this file that prints such a figure as plain text — the
 * compliance-gap code reference's "seen" column (`openCodeReference()`). Everywhere else
 * a landscape figure feeds `claimRail`'s own `count: null` "not measured yet" lane, which
 * keeps the same contract without going through text at all.
 */
export function aarsFigureView(synced, value) {
  return synced ? value : absentText;
}
