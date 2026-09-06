// The three registers' long-form names, in one place instead of three.
//
// `executive.js`, `program.js` and `history.js` each declared the identical object —
// `{ sca: "Dependencies (SCA)", sast: "Code (SAST)", secrets: "Secrets" }` — because each
// page needed the register's name written out in full (a scope filter chip, a table column,
// the spiral legend) rather than the shorter word `settings.js`'s own `SCOPE_LABELS` uses for
// a narrow tab strip. One copy now; the three pages import it under the same local name they
// already indexed, so every `SCOPE_LABELS[scope] || scope` call site is unchanged.
//
// `settings.js` keeps its OWN `SCOPE_LABELS` rather than importing this one — its three words
// ("Dependencies"/"Code"/"Secrets") are a different, shorter label for a different context,
// not a rename of this one, and `test/pagesSettings.test.js` imports it by name.

/** The register names as this app's pages write them out in full. */
export const SCOPE_LABELS_LONG = {
  sca: "Dependencies (SCA)",
  sast: "Code (SAST)",
  secrets: "Secrets",
};

/**
 * A scope's long-form label, falling back to the raw scope string — so a scope this map has
 * not been told about yet still reads as a word rather than as a wire-format key.
 *
 * NO `boot` PARAMETER. An earlier draft took a second argument and fell back through a
 * bootstrap payload's own `scopeLabels` before the raw string — but `SCOPE_LABELS_LONG` above
 * is checked FIRST and already covers every scope this app declares (`sca`/`sast`/`secrets`),
 * so that fallback could only ever fire for a scope outside that set, which `boot.scopeLabels`
 * has no better an answer for than the raw string does either. A parameter nothing can make
 * fire is decorative, not a guard.
 *
 * @param {string} scope
 */
export function scopeLabel(scope) {
  return SCOPE_LABELS_LONG[scope] || scope;
}
