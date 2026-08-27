// "Show experimental content" — the one preference that decides whether the app's
// unfinished surfaces exist for this reader at all. Off, the Scoring Models page is not in
// the rail, `#/aars` does not open, and the key sheet does not define terms it cannot send
// anyone to see. On, everything is as it always was.
//
// LOCAL, not a settings-tab key. This is chrome, not data: it changes what one reader can
// open and never what anything computes, so it belongs with the rail's collapse in app.js
// and the record sheet's width in ui/sheet.js rather than in the shared ledger, where it
// would cost a sheet write and a DATA_VERSION bump to hide a page from one person.
//
// This module imports NOTHING on purpose. helpContent.js consumes the flag and deliberately
// does not import app.js (app.js reads `document` at module scope, which would drag the whole
// SPA into a unit test), so the flag cannot live there either.
const KEY = "sidekickdso.showExperimental";

// OFF by default, and `=== "1"` rather than the `!== "0"` the collapsed rail uses: absent,
// unreadable and sandboxed all have to read as off. An unfinished model that appears because
// web storage was denied is the one failure this flag exists to prevent, so every path that
// cannot answer answers no. The try/catch is the same one every local preference here carries
// — a GAS iframe sandbox can block web storage outright.
function load() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

// Read once and cached, like `sidebarCollapsed` in app.js: renderSidebar and route() both
// consult it on every navigation, and the answer can only change through setShowExperimental.
let current = load();

/** Whether experimental surfaces are shown to this reader, in this browser. */
export function showExperimental() {
  return current;
}

/**
 * The single listener slot, held by app.js so flipping the toggle rebuilds the rail.
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
  try { localStorage.setItem(KEY, current ? "1" : "0"); } catch { /* sandboxed */ }
  // Sandboxed storage still flips the flag for this session — the preference is honoured
  // now and simply forgotten on reload, which beats a control that does nothing.
  if (listener) listener(current);
}
