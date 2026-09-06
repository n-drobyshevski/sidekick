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
 * A scope's long-form label, falling back through the bootstrap payload's own (shorter)
 * `scopeLabels` before falling back to the raw scope string — so a scope this map has not
 * been told about yet still reads as a word rather than as a wire-format key.
 *
 * @param {string} scope
 * @param {object|null} [boot]  a bootstrap payload, for its `scopeLabels` field
 */
export function scopeLabel(scope, boot) {
  return SCOPE_LABELS_LONG[scope]
    || (boot && boot.scopeLabels && boot.scopeLabels[scope])
    || scope;
}
