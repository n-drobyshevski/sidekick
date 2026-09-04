// The global scope, echoed where the numbers are.
//
// LOCAL BECAUSE THE SCOPE IS THIS REGISTER'S, not because the chips are. Every page draws
// this so a scoped dashboard can never silently read as the whole register — and the two
// things it can be scoped by (a `Wiz/Domain` tag, a support group off the subscription) are
// facts about an OS estate. gas_devsecops scopes by a project tree and keeps its own
// `ui/projectScope.js` for the same reason.
//
// THE CHIPS THEMSELVES ARE SHARED. This used to build a `.scope-bar` of `.scope-chip`s with
// its own ✕ button, a second dismissible-chip recipe beside the design system's — same job,
// different class names, and a `title` attribute on the ✕ that `el()` now refuses outright.
// `filterChipRow` (gas_shared/ui/controls.js) is that recipe: the ✕ carries its own
// aria-label, removal moves focus to the neighbouring chip rather than dropping it on the
// body, and the dressing comes from `.filter-chip` in the shared sheet. What is left here is
// the only part that was ever gas's — WHICH two scopes exist and what they are called.

import { filterChipRow } from "../../../../../gas_shared/ui/controls.js";

/**
 * Header scope bar: dismissible chips for the global scope — domain or support group.
 * Returns null when no global filter is active. `onClear(kind)` clears one.
 *
 * At most one of the two is ever set — the header switcher enforces it (app.js pickScope) —
 * but both branches stay, because the bar's job is to echo whatever the shell holds rather
 * than to assume how many things it may hold.
 */
export function scopeBar({ domain, supportGroup, onClear }) {
  if (!domain && !supportGroup) return null;
  const entries = [];
  if (domain) entries.push({ key: "domain", label: "Domain", value: domain, patch: "domain" });
  if (supportGroup) {
    entries.push({
      key: "supportGroup", label: "Support group", value: supportGroup, patch: "supportGroup",
    });
  }
  // `patch` is the shared row's payload for "what this ✕ means"; here it is simply the kind,
  // because clearing a scope is not a filter patch — there is nothing to merge.
  const row = filterChipRow({
    className: "scope-bar",
    ariaLabel: "Active filters",
    onPatch: (kind) => onClear && onClear(kind),
  });
  row.sync(entries);
  return row;
}
