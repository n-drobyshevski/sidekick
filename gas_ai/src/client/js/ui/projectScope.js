// The sidebar project switcher: which slice of the synced register every page is showing.
//
// The list comes from `filterOptions.projectList`, derived from the assets the sync
// actually collected — never from the tenant's project catalogue. A picker built from the
// live catalogue would offer projects this register was never asked for, and the page
// behind such a pick renders zero. A zero meaning "nothing here" and a zero meaning "never
// fetched" look identical on screen and call for opposite reactions, so the control simply
// cannot express the second one.
//
// Split in two on purpose, the way syncProgress.js is: `projectScopeView` decides what the
// control CLAIMS — the label, the caption, whether the stored scope has gone stale — and is
// DOM-free so those claims can be tested. `projectScopeControl` only assembles them.

import { el } from "./dom.js";
import { filterCombobox } from "./combobox.js";

const nf = new Intl.NumberFormat();

function assetCount(n) {
  return `${nf.format(n)} ${n === 1 ? "asset" : "assets"}`;
}

/**
 * `isFolder` is tri-state and the third state is load-bearing. `undefined` means the row
 * predates the field — which is every asset already in the ledger — and reading it as
 * `false` would draw a business unit as a leaf project.
 *
 * So the grouping only claims anything when the register has actually recorded the field
 * for someone. If no row knows, the list is flat and says nothing about folders; grouping
 * every row under "Projects" would assert leaf-ness of the whole register on the strength
 * of a field nobody has filled in yet.
 */
function scopeOptions(list) {
  const anyRecorded = list.some((p) => p.isFolder !== undefined);
  return list.map((p) => ({
    value: p.id,
    label: p.name,
    // Folders are declared in words rather than by icon or colour: picking one reaches its
    // whole subtree, and that is a meaning, so it does not travel by colour alone.
    hint: p.isFolder === true ? `Business unit · ${assetCount(p.assets)}` : assetCount(p.assets),
    group: !anyRecorded ? "" : (p.isFolder === true ? "Business units"
      : p.isFolder === false ? "Projects" : "Not yet recorded"),
  }));
}

/**
 * Two characters for the 56px rail, where the trigger's own text has ~34px and ellipsises
 * every project name to "PRO…". Initials of the first two words, because the names that
 * matter here are hyphenated ("VALUE-CHAIN" → VC) and their first two characters are not:
 * a register full of PROJECT-* would render every glyph as "PR".
 *
 * A wayfinding hint, not an identifier — two projects can share a glyph. The full name is
 * on the hover title and is the control's accessible name, and expanding the rail is one
 * click away, so nothing here is the only way to know what is selected.
 */
export function railGlyph(name) {
  const words = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || "?").slice(0, 2).toUpperCase();
}

/**
 * Everything the control asserts, from the bootstrap payload alone.
 *
 * @param {object|null} bootstrapData
 * @returns {{show: boolean, current: string, label: string, caption: string,
 *            stale: boolean, glyph: string, options: object[], pinned: object[]}}
 */
export function projectScopeView(bootstrapData) {
  const list = (bootstrapData && bootstrapData.filterOptions
    && bootstrapData.filterOptions.projectList) || [];
  const scope = (bootstrapData && bootstrapData.scope) || null;

  // Nothing synced, or boot failed: no control at all. An empty picker is a promise the
  // register cannot keep, and the sync zone directly below already says why it is empty.
  if (!scope || !list.length) {
    return { show: false, current: "", label: "", caption: "", stale: false, glyph: "", options: [], pinned: [] };
  }

  const current = scope.projectView || "";
  const chosen = list.find((p) => p.id === current) || null;
  // A stored view whose project fell out of the register after a re-sync scoped elsewhere.
  const stale = Boolean(current) && !chosen;

  return {
    show: true,
    current,
    label: !current ? "all synced projects"
      : chosen ? chosen.name : "a project this register does not hold",
    // The denominator travels with the number: "826" alone cannot tell a small unit from a
    // small register, and those call for opposite reactions.
    caption: !current ? `${assetCount(scope.register)} synced`
      : stale ? `Not in this register — showing 0 of ${nf.format(scope.register)}`
        : `${nf.format(scope.shown)} of ${nf.format(scope.register)} assets`,
    stale,
    glyph: !current ? "ALL" : chosen ? railGlyph(chosen.name) : "!",
    options: scopeOptions(list),
    // "All synced projects", not "All projects". The register holds what the last sync was
    // scoped to fetch, which on a scoped tenant is one unit's subtree — calling that "all
    // projects" would name a population this register does not contain.
    pinned: [{ value: "", label: "All synced projects", hint: assetCount(scope.register) }],
  };
}

/**
 * @param {object|null} bootstrapData  the bootstrap payload, or null when boot failed
 * @param {(id: string) => void} onPick  called with the chosen project id, "" for all
 * @returns {HTMLElement|null}  null when there is nothing truthful to offer
 */
export function projectScopeControl(bootstrapData, onPick) {
  const v = projectScopeView(bootstrapData);
  if (!v.show) return null;

  const combo = filterCombobox({
    value: v.current,
    options: v.options,
    pinnedRows: v.pinned,
    defaultLabel: "All synced projects",
    // Without this the trigger prints the raw id, which reads as corruption rather than as
    // a scope that no longer matches what was fetched.
    fallbackLabel: "Project not in this register",
    // Carries the CURRENT selection, not just the control's name. The rail is rebuilt
    // wholesale on every refresh() and picking triggers one, so this is re-stamped with
    // each change — and in the collapsed rail it is the only thing naming the scope, since
    // the trigger's visible text is down to an initial or two there.
    ariaLabel: `Project scope: ${v.label}`,
    searchPlaceholder: "Search projects…",
    onChange: (id) => onPick(id || ""),
  });
  combo.classList.add("scope-combo");
  // Read on hover, and the collapsed rail's only pointer affordance for the full name.
  combo.title = `Project scope: ${v.label}`;

  return el("div", { class: "scope-switch" },
    combo,
    // Painted OVER the trigger in the collapsed rail, never instead of it. The popover
    // positions against the trigger's box, so the trigger has to keep its geometry and its
    // click target — a stand-in button with the real one hidden would anchor the list at
    // the viewport origin. This is inert decoration; the control underneath it is real.
    el("span", { class: "scope-rail-glyph", "aria-hidden": "true" }, v.glyph),
    el("div", {
      class: `scope-caption${v.stale ? " stale" : ""}`,
      // The caption answers the control above it, so it should be heard on selection
      // rather than only on a deliberate re-read of the region.
      "aria-live": "polite",
    }, v.caption),
  );
}
