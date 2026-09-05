// "Show experimental content" — the one preference that decides whether an app's unfinished
// surfaces exist for this reader at all. Off, a gated page is not in the rail, its hash does
// not open, and the key sheet does not define terms it cannot send anyone to see. On,
// everything is as it always was.
//
// LOCAL, not a settings-tab key. This is chrome, not data: it changes what one reader can
// open and never what anything computes, so it belongs with the rail's pin and the record
// sheet's width rather than in the shared ledger, where it would cost a sheet write and a
// DATA_VERSION bump to hide a page from one person.
//
// PROMOTED FROM TWO IDENTICAL COPIES that differed in exactly one character span — the
// literal `"sidekickai."` / `"sidekickdso."` in front of the key. That prefix is what
// `MANIFEST.storagePrefix` is for, so the key is composed rather than written out and the
// stored values are byte-identical to what the two forks already wrote: no migration, and no
// reader loses the flag. gas has no experimental page and never imported either fork; nothing
// here invents a gate for it, and `showExperimental()` simply answers false there.
//
// This module imports nothing but the manifest, on purpose: each app's `helpContent.js` and
// `pages/settings.js` consume the flag and must not drag app.js (which reads `document` at
// module scope) into a unit test.

import { appConfig } from "../appConfig.js";

function key() {
  return appConfig().storagePrefix + "showExperimental";
}

// OFF by default, and `=== "1"` rather than the `!== "0"` the pinned panel uses: absent,
// unreadable and sandboxed all have to read as off. An unfinished model that appears because
// web storage was denied is the one failure this flag exists to prevent, so every path that
// cannot answer answers no. The try/catch is the same one every local preference here carries
// — a GAS iframe sandbox can block web storage outright.
function load() {
  try { return localStorage.getItem(key()) === "1"; } catch { return false; }
}

// Read once and cached, because renderSidebar and route() both consult it on every
// navigation and the answer can only change through setShowExperimental.
//
// LAZILY, unlike the two forks, and that is forced by the seam rather than a preference:
// `appConfig.js`'s rule 2 says a shared module may not read the manifest at module top level,
// because under esbuild's bundling order this body runs BEFORE app.js's configureApp(). null
// means "not asked yet".
let current = null;

/** Whether experimental surfaces are shown to this reader, in this browser. */
export function showExperimental() {
  if (current === null) current = load();
  return current;
}

/**
 * The single listener slot, held by the shell so flipping the toggle rebuilds the rail.
 *
 * A callback rather than an import: app.js already imports pages/settings.js, and settings.js
 * reaching back for a rebuild function would close that into a cycle. One slot, not a list,
 * because there is exactly one owner of the rail.
 */
let listener = null;

export function onExperimentalChange(fn) {
  listener = fn;
}

export function setShowExperimental(on) {
  current = on === true;
  try { localStorage.setItem(key(), current ? "1" : "0"); } catch { /* sandboxed */ }
  // Sandboxed storage still flips the flag for this session — the preference is honoured now
  // and simply forgotten on reload, which beats a control that does nothing.
  if (listener) listener(current);
}
