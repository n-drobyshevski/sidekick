// The appbar scope control: one combobox, and the caption that answers it.
//
// The DOM half of ui/scopeModel.js. It assembles what that module decided and adds nothing
// of its own — every string here arrives from the app's `scopeKinds` / chrome, because the
// vocabulary is the register's and the chrome is not.
//
// IT SITS IN THE HEADER RATHER THAN IN THE RAIL, in all three apps, because it governs every
// page rather than leading to one: the rail is a list of destinations and A SCOPE IS NOT A
// DESTINATION. That move also retired the control's second presentation in two of the three
// — it used to shrink to a glyph box for the 56px collapsed rail, and the header has one
// width.
//
// THE MARKUP IS EXACTLY WHAT ALL THREE ALREADY EMITTED, node for node and class for class:
//
//   div.scope-switch
//     div.combobox.scope-combo[.scoped]        (filterCombobox, with .combobox-pop--scope)
//     div.scope-caption[.stale][aria-live=polite]
//
// so the swap is a deletion in three apps and no pixel moves. The one addition is gas's:
// its control did not carry the hover card the other two did, and the header is narrow
// enough to ellipsise a long domain name in all three.

import { el } from "./dom.js";
import { filterCombobox } from "./combobox.js";
import { uiIcon } from "./uiIcons.js";
import { tipAnchor } from "./tip.js";
import { scopeView } from "./scopeModel.js";

/**
 * @param {object} view  a `scopeView()` result
 * @param {object} chrome  the same chrome object `scopeView` was given — the control needs
 *   the parts a view has no reason to carry (placeholders, the panel's own heading)
 * @param {(value: string) => void} onPick  the chosen option's ENCODED value, "" for the
 *   reset. The caller decodes with `parseScope` / `scopePayload`; the prefix is the control's
 *   own and nothing outside this pair should have to know it.
 * @returns {HTMLElement|null}  null when there is nothing truthful to offer
 */
export function scopeControl(view, chrome, onPick) {
  if (!view || !view.show) return null;
  const c = chrome || {};

  // The trigger's glyph is the mark of the KIND in force — the same mark that kind's rows
  // carry — so the closed control still says which heading you picked from. Unscoped it is
  // the reset row's mark, because that is the row in force.
  const kind = view.kind
    ? (c.kinds || []).find((k) => k.key === view.kind) || null
    : null;
  const glyph = kind && kind.icon ? kind.icon : ((c.reset && c.reset.icon) || "folders");

  const combo = filterCombobox({
    value: view.active,
    options: view.options,
    pinnedRows: view.pinned,
    defaultLabel: c.defaultLabel || "",
    // Without this the trigger prints the raw stored value under a heading that no longer
    // lists it, which reads as corruption rather than as a scope that has gone stale.
    fallbackLabel: c.fallbackLabel || "",
    // Carries the CURRENT selection, not just the control's name. The header is rebuilt
    // wholesale on every refresh and picking triggers one, so this is re-stamped with each
    // change.
    ariaLabel: "Scope: " + view.label,
    searchPlaceholder: c.searchPlaceholder || "Search…",
    // WHAT THE PANEL HAS TO SAY THAT ITS ROWS CANNOT. Every row is a name; none of them can
    // tell you that choosing one re-scopes every figure in the app, or that a few figures
    // refuse to be scoped and say so where they are drawn. A consequence this large should
    // not have to be discovered by trying it.
    header: c.header || null,
    // The scope outlives the page you picked it on, so which row is in force is a standing
    // fact about the app rather than a highlight in an open menu — worth a mark of its own
    // rather than weight and colour alone.
    checkSelected: true,
    // The popover is portaled to <body>, so this class is the only way to reach inside it.
    popClass: c.popClass || "combobox-pop--scope",
    // Decoration inside the trigger. The trigger's accessible name is the ariaLabel above,
    // so this adds no second reading.
    leading: el("span", { class: "scope-combo-icon", "aria-hidden": "true" }, uiIcon(glyph, 14)),
    onChange: (value) => onPick(String(value || "")),
  });
  combo.classList.add("scope-combo");
  // A NARROWED REGISTER IS A STATE, and it is the one state in these apps that silently
  // re-reads every number on every page. DESIGN.md spends colour on "a severity level, an SLA
  // breach, a state change"; this is the third. Unscoped the trigger stays the neutral field
  // it has always been, because "showing everything" is the resting state and a permanently
  // lit control reports nothing. The colour is never alone either way — the trigger names the
  // scope and the caption beside it carries the count.
  if (view.scoped) combo.classList.add("scoped");
  // Read on hover: the header is narrow enough to ellipsise a long name, and the caption
  // beside it answers a different question. Not a native title — a tap reaches none of those,
  // which is the whole reason el() bans the attribute.
  tipAnchor(combo, "Scope: " + view.label);

  return el("div", { class: "scope-switch" },
    combo,
    el("div", {
      class: "scope-caption" + (view.stale ? " stale" : ""),
      // The caption answers the control above it, so it should be heard on selection rather
      // than only on a deliberate re-read of the region.
      "aria-live": "polite",
    }, view.caption),
  );
}

/**
 * `scopeView` and `scopeControl` in one call, for the common case where the appbar has no
 * reason to hold the view between them.
 */
export function scopeSwitch(spec, onPick) {
  const view = scopeView(spec);
  return scopeControl(view, { ...(spec.chrome || {}), kinds: spec.kinds }, onPick);
}
