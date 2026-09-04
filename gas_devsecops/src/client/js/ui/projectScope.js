// The app-header project switcher: which slice of the synced register every page is showing.
//
// It sits in the header rather than on any one page because it governs every page rather than
// leading to one — the rail is a list of destinations, and a scope is not a destination. See
// app.js's renderAppbar for why that makes it chrome rather than a page filter.
//
// The list comes from `filterOptions.projectList`, derived from the ROWS the ledger actually
// holds — never from a live Wiz project catalogue. A picker built from the live catalogue
// would offer projects this register never fetched, and the page behind such a pick renders
// zero. A zero meaning "nothing here" and a zero meaning "never synced" look identical on
// screen and call for opposite reactions, so the control simply cannot express the second one.
//
// Ported from gas_ai/src/client/js/ui/projectScope.js, with two differences this register's
// shape forces:
//
//   * NO DOMAINS. `Wiz/Domain` is a tag the AI sidekick's tenant writes on assets
//     (domain/maintenance.ts:256 — this register has no such tag), so there is no second
//     switcher axis, no `d:` value prefix, and no domain-coverage figure.
//   * THE UNIT IS FINDINGS, KEYED ON SLUG. This register has no live asset graph to key a
//     switcher on `id` — only ledger rows carrying `projects_json` — and `domain/projectScope.ts`
//     already settled on `slug` as the stable identity (a display name can be re-typed without
//     the project changing). The unattributed count replaces gas_ai's domain-coverage figure
//     for the same reason it existed there: scoped, "N of M findings" alone silently attributes
//     the rows nobody could place to whichever project is in view, when the truth is that some
//     of the other M-N carry no project at all.
//
// Split in two on purpose, the way syncProgress.js is: `projectScopeView` decides what the
// control CLAIMS — the label, the caption, whether the stored scope has gone stale — and is
// DOM-free so those claims can be tested. `projectScopeControl` only assembles them.

import { el } from "../../../../../gas_shared/ui/dom.js";
import { filterCombobox } from "../../../../../gas_shared/ui/combobox.js";
import { uiIcon } from "../../../../../gas_shared/ui/uiIcons.js";
import { tipAnchor } from "../../../../../gas_shared/ui/tip.js";

const nf = new Intl.NumberFormat();

function findingCount(n) {
  const c = Number(n) || 0;
  return `${nf.format(c)} ${c === 1 ? "finding" : "findings"}`;
}

/**
 * The tenant's naming convention: a project whose name begins `CS`, `CE` or `LU` is a SUPPORT
 * GROUP, and a business unit is anything that is not one.
 *
 * A rule read off a NAME, which this codebase is otherwise careful not to do — this is not an
 * inference about what something IS, it is the tenant's own convention for what they CALL
 * things, the same class of fact `domain/projectScope.ts` already leans on for `isFolder`
 * itself: Wiz reports a project's name and whether it nests other projects; it does not report
 * that a folder is a support group rather than a business unit. There is no other way to learn
 * it, so a name rule is the legitimate answer here rather than a shortcut.
 *
 * THE FIRST SEGMENT, NOT A BARE PREFIX. `CE-TRANSPORT` matches; `CENTRAL-OPS` must not, and a
 * project like `owner-CE-INDUS-cloud` — carrying `CE` in the middle of a compound name — must
 * not either. Splitting on the separator answers all three, where `startsWith("CE")` gets the
 * second wrong and `includes("CE")` gets the third wrong.
 *
 * One list, exported, because a convention is a thing that changes: a fourth prefix is one
 * edit here rather than a hunt through every caller.
 */
export const SUPPORT_GROUP_PREFIXES = ["CS", "CE", "LU"];

export function isSupportGroup(name) {
  const first = String(name || "").trim().toUpperCase().split(/[-_\s]/)[0];
  return SUPPORT_GROUP_PREFIXES.indexOf(first) >= 0;
}

/**
 * What to call one row: a support group, a business unit, a project, or nothing yet.
 *
 * THE NAME RULE WINS OVER `isFolder`. A folder named `CS-LOG-ZEN-ECOM` is a folder AND a
 * support group; calling it a business unit because Wiz says it nests things would be the app
 * overruling the tenant on the tenant's own vocabulary.
 */
export function projectKind(p) {
  if (isSupportGroup(p.name)) return "support";
  if (p.isFolder === true) return "unit";
  if (p.isFolder === false) return "project";
  return "unknown";
}

const KIND_GROUP = {
  support: "Support groups",
  unit: "Business units",
  project: "Projects",
  unknown: "Not yet recorded",
};
// Support groups sort AFTER units, so the list reads widest-first: a unit reaches a whole
// subtree, a support group reaches its own, a project is a leaf. The combobox emits a heading
// only when the group value changes while walking in order, so a list that did not sort by
// kind would fragment its own headings.
const KIND_RANK = { unit: 0, support: 1, project: 2, unknown: 3 };

/**
 * The projects on offer, as switcher rows.
 *
 * `isFolder` is TRI-STATE and the third state is load-bearing (`domain/projectScope.ts`):
 * `undefined` means the register has not recorded it for anyone — every row before the
 * `projects_json` column existed, or an API response that omitted the flag on this particular
 * project. So the FOLDER half of the grouping only claims anything once at least one row in
 * the CURRENT register has actually recorded it; otherwise the list is flat, because grouping
 * every row under "Projects" would assert leaf-ness of the whole register on a field nobody
 * has filled in yet. The SUPPORT-GROUP half is NOT gated on it — it is read off the name and
 * needs nothing from Wiz, so it is worth saying even on a register that cannot yet say which
 * of its folders are leaves.
 */
export function scopeOptions(list) {
  const anyRecorded = (list || []).some((p) => p.isFolder !== undefined);
  const rows = (list || []).map((p) => {
    const kind = projectKind(p);
    return {
      value: p.slug,
      label: p.name,
      kind,
      // Declared in words rather than by icon or colour: picking a unit or a support group
      // reaches its whole subtree, and that is a meaning, so it does not travel by colour
      // alone.
      hint: kind === "support" ? `Support group · ${findingCount(p.findings)}`
        : kind === "unit" ? `Business unit · ${findingCount(p.findings)}`
          : findingCount(p.findings),
      group: kind === "support" ? KIND_GROUP.support
        : !anyRecorded ? "" : KIND_GROUP[kind],
      // The glyph is the THIRD carrier, after the hint above and the group heading — a reader
      // who cannot tell one folder from two at 14px has already been told twice in words. That
      // ordering is the whole licence for it: an icon that had to be understood would be
      // exactly the shorthand the hint exists to avoid.
      icon: kind === "unit" || kind === "support" ? "folders" : "folder",
    };
  });
  // Sorted by kind so each heading is emitted once. Stable within a kind, which keeps the
  // server's folders-first-then-name ordering (`domain/projectScope.ts::projectCatalogue`)
  // wherever it still applies.
  return rows
    .map((row, at) => ({ row, at }))
    .sort((x, y) => (KIND_RANK[x.row.kind] - KIND_RANK[y.row.kind]) || (x.at - y.at))
    .map(({ row }) => row);
}

/**
 * Everything the control asserts, from the bootstrap payload alone.
 *
 * @param {object|null} bootstrapData
 * @returns {{show: boolean, current: string, label: string, caption: string,
 *            stale: boolean, options: object[], pinned: object[]}}
 */
export function projectScopeView(bootstrapData) {
  const opts = (bootstrapData && bootstrapData.filterOptions) || {};
  const list = opts.projectList || [];
  const scope = (bootstrapData && bootstrapData.scope) || null;

  // Nothing synced, or boot failed: no control at all. An empty picker is a promise the
  // register cannot keep.
  if (!scope || !list.length) {
    return {
      show: false, current: "", label: "", caption: "", stale: false, options: [], pinned: [],
    };
  }

  const projectView = scope.projectView || "";
  const chosen = projectView ? list.find((p) => p.slug === projectView) || null : null;
  // A stored view naming a project that fell out of the register after a re-sync scoped
  // elsewhere, or that never existed.
  const stale = Boolean(projectView && !chosen);

  const label = !projectView ? "everything synced"
    : chosen ? chosen.name : "a project this register does not hold";

  const unattributed = Number(scope.unattributed) || 0;
  // Only stated when it is non-zero, and only alongside a count it actually qualifies — a
  // register with nothing unattributed has nothing here to say. See the module header: this
  // is what replaces gas_ai's domain-coverage clause for the same reason it existed there.
  const unattributedClause = unattributed > 0
    ? ` · ${nf.format(unattributed)} have no project`
    : "";

  return {
    show: true,
    current: projectView,
    label,
    // The denominator travels with the number: "12" alone cannot tell a small unit from a
    // small register, and those call for opposite reactions.
    caption: stale
      ? `Not in this register — showing 0 of ${nf.format(scope.register)}`
      : !projectView
        ? `${findingCount(scope.register)} synced${unattributedClause}`
        : `${nf.format(scope.shown)} of ${nf.format(scope.register)} findings${unattributedClause}`,
    stale,
    // Every real project stays on offer even when the stored scope is stale, so the state is
    // escapable rather than a dead end the reader can only clear by editing settings by hand.
    options: scopeOptions(list),
    // "Everything synced", not "All projects": the register holds what the last sync was
    // scoped to fetch, and this row means "no view scope", not "every project that exists".
    pinned: [{
      value: "", label: "Everything synced", hint: findingCount(scope.register), icon: "folders",
    }],
  };
}

/**
 * @param {object|null} bootstrapData  the bootstrap payload, or null when boot failed
 * @param {(slug: string) => void} onPick  the chosen project slug, "" for the whole register
 * @returns {HTMLElement|null}  null when there is nothing truthful to offer
 */
export function projectScopeControl(bootstrapData, onPick) {
  const v = projectScopeView(bootstrapData);
  if (!v.show) return null;

  const combo = filterCombobox({
    value: v.current,
    options: v.options,
    pinnedRows: v.pinned,
    defaultLabel: "Everything synced",
    // Without this the trigger prints the raw slug, which reads as corruption rather than as
    // a scope that no longer matches what was fetched.
    fallbackLabel: "Project not in this register",
    // Carries the CURRENT selection, not just the control's name. The header is rebuilt
    // wholesale on every refresh() and picking triggers one, so this is re-stamped with
    // each change.
    ariaLabel: `Scope: ${v.label}`,
    searchPlaceholder: "Search projects…",
    // WHAT THE PANEL HAS TO SAY THAT ITS ROWS CANNOT. Every row is a project name; none of
    // them can tell you that choosing one re-scopes every figure in the app, or that a few
    // figures refuse to be scoped and say so where they are drawn (registerWideNote). A
    // consequence this large should not have to be discovered by trying it.
    header: {
      title: "Scope",
      note: "Every page answers for the project you pick. Figures that cannot be scoped say "
        + "so where they are drawn.",
    },
    // The scope persists server-side and outlives the session, so which row is in force is a
    // standing fact about the app rather than a highlight in an open menu — worth a mark of
    // its own rather than weight and colour alone.
    checkSelected: true,
    // The popover is portaled to <body>, so this class is the only way to reach inside it.
    popClass: "combobox-pop--scope",
    // Decoration inside the trigger. The trigger's accessible name is the ariaLabel above, so
    // this adds no second reading.
    leading: el("span", { class: "scope-combo-icon", "aria-hidden": "true" },
      uiIcon(v.current ? "folder" : "folders", 14)),
    onChange: (val) => onPick(val || ""),
  });
  combo.classList.add("scope-combo");
  // A NARROWED REGISTER IS A STATE, and this is the one state in the app that silently
  // re-reads every number on every page. Unscoped it stays the neutral field it has always
  // been, because "showing everything" is the resting state and a permanently lit control
  // signals nothing. The colour is never alone either way — the trigger names the project, and
  // the caption beside it carries the count.
  if (v.current) combo.classList.add("scoped");
  // Read on hover: the header is narrow enough to ellipsise a long project name, and the
  // caption beside it answers a different question. Not a native title — a tap reaches none
  // of those, which is the whole reason el() bans the attribute.
  tipAnchor(combo, "Scope: " + v.label);

  return el("div", { class: "scope-switch" },
    combo,
    el("div", {
      class: `scope-caption${v.stale ? " stale" : ""}`,
      // The caption answers the control above it, so it should be heard on selection
      // rather than only on a deliberate re-read of the region.
      "aria-live": "polite",
    }, v.caption),
  );
}
