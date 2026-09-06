// "Show experimental content", this app's end of the shared gate.
//
// THE MODULE ITSELF IS `gas_shared/shell/experimental.js` NOW. The two copies of this file
// were 53 lines each and differed in exactly one character span — the `"sidekickdso."` in
// front of the storage key — which is what `MANIFEST.storagePrefix` is for. The shared module
// composes the key from it, so the stored value is byte-identical to what this fork already
// wrote and no reader loses the flag.
//
// This file stays as the seam, not as a second implementation: `pages/settings.js` and
// `helpContent.js` import `../experimental.js`, and a re-export keeps those specifiers
// resolving at their own relative depth — the same arrangement `ui.js` has over the shared
// component barrel. esbuild flattens the hop at build time.
//
// IT ALSO CLAIMS THE SHARED GATE'S ONE LISTENER SLOT for this app and fans it out — see the
// second half of this file. That is wiring, not a second implementation of the gate: the flag
// itself still lives in exactly one place.

import { onExperimentalChange as claimSlot } from "../../../../gas_shared/shell/experimental.js";

export {
  onExperimentalChange, setShowExperimental, showExperimental,
} from "../../../../gas_shared/shell/experimental.js";

// ---------------------------------------------------------------- the app's own fan-out
//
// THE SHARED GATE HOLDS EXACTLY ONE LISTENER SLOT, and it is the shell's: `createAppShell`
// claims it to rebuild the rail when the flag flips (gas_shared/shell/appShell.js). There is
// no getter on it, so a page that calls `onExperimentalChange` directly does not SHARE the
// slot — it takes the rail's rebuild away for the rest of the session, and nothing says so.
//
// So this app claims the slot ONCE, from app.js, handing over the shell's own rebuild as the
// base listener, and everything else subscribes here. A page's subscription returns its own
// unsubscribe, which is what a page teardown can actually restore: the base listener is never
// disturbed, so what was there before the page is exactly what is there after it.
//
// Not promoted to gas_shared/: this is one app's wiring of a shared seam, and the two
// siblings have no page-level subscriber to fan out to yet.

/** Page-level subscribers, added and removed as pages come and go. */
const subscribers = new Set();
let base = null;

/**
 * Claim the shared slot for this app. Called once, from app.js, with the shell's rail
 * rebuild — the listener the shell would otherwise have installed for itself.
 */
export function installExperimentalFanout(shellListener) {
  base = typeof shellListener === "function" ? shellListener : null;
  claimSlot((on) => {
    if (base) base(on);
    // A copy, so a subscriber that unsubscribes itself mid-flip cannot skip the next one.
    for (const fn of [...subscribers]) fn(on);
  });
}

/**
 * Subscribe to flag flips for as long as this page is on screen.
 *
 * Returns the unsubscribe, for `onPageTeardown` — a subscriber left behind would redraw into
 * a DOM the router has already discarded.
 */
export function subscribeExperimental(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
