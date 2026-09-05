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
// REDUCED, NOT DELETED. `projectScopeControl` — the combobox, the caption, the `.scoped`
// class — is `gas_shared/ui/scopeControl.js` now, and the assembly that turned a payload into
// `{show, label, caption, options, pinned}` is `gas_shared/ui/scopeModel.js`. Both were three
// copies of each other across the three sidekicks. What stays here is the half that never
// generalised and that the parity contract already allowed this app to keep: the register's
// own vocabulary, which reads `src/domain/projectScope.ts` and means nothing in a sibling
// with no repositories.
//
// Split in two on purpose, the way syncProgress.js is: `projectScopeView` decides what the
// control CLAIMS — the label, the caption, whether the stored scope has gone stale — and is
// DOM-free so those claims can be tested. The control only assembles them.

import { scopeView } from "../../../../../gas_shared/ui/scopeModel.js";

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
 * The one dimension this register has, as `gas_shared/ui/scopeModel.js` takes it.
 *
 * BARE, NOT PREFIXED, and that is what keeps a stored scope working across this change:
 * `settingsStore.projectView` holds a slug, the control emitted a slug, and the shared model
 * allows exactly one kind per register to carry no prefix. A single-kind app is that case by
 * definition — there is no second dimension for a slug to collide with.
 *
 * `scopeOptions` above is left exactly as it was, `value` field and all, because it is
 * exported and tested directly; the mapping to the model's `id` happens here, in one line,
 * rather than by rewriting a builder and its test to say the same thing differently.
 */
export function scopeKinds(data) {
  const opts = (data && data.filterOptions) || {};
  const list = opts.projectList || [];
  return [{
    key: "project",
    prefix: "",
    // One folder for a chosen project; the reset row's two-folder mark is the chrome's.
    icon: "folder",
    options: () => scopeOptions(list).map((o) => ({ ...o, id: o.value })),
    label: (opt, d, ctx) => (ctx.stale
      ? "a project this register does not hold"
      : (opt ? opt.label : ctx.id)),
    caption: (opt, d, ctx) => projectCaption(d, ctx.stale, opt),
    // THE EXACT ARGUMENT `api_setProjectView` HAS ALWAYS TAKEN. Pinned against the deleted
    // implementation by the registerScopeContract block in test/shared.test.js.
    payload: (id) => ({ projectView: id }),
  }];
}

function findingFacts(data) {
  const scope = (data && data.scope) || null;
  const register = scope ? Number(scope.register) || 0 : 0;
  const shown = scope ? Number(scope.shown) || 0 : 0;
  const unattributed = scope ? Number(scope.unattributed) || 0 : 0;
  return { scope, register, shown, unattributed };
}

/**
 * The denominator travels with the number: "12" alone cannot tell a small unit from a small
 * register, and those call for opposite reactions.
 *
 * The unattributed clause is only stated when it is non-zero, and only alongside a count it
 * actually qualifies — a register with nothing unattributed has nothing here to say. See the
 * module header: this is what replaces gas_ai's domain-coverage clause for the same reason it
 * existed there.
 */
function projectCaption(data, stale, opt) {
  const f = findingFacts(data);
  const clause = f.unattributed > 0
    ? ` · ${nf.format(f.unattributed)} have no project`
    : "";
  if (stale) return `Not in this register — showing 0 of ${nf.format(f.register)}`;
  if (!opt) return `${findingCount(f.register)} synced${clause}`;
  return `${nf.format(f.shown)} of ${nf.format(f.register)} findings${clause}`;
}

/**
 * The parts of the control that are not the dimension.
 *
 * `show` is this register's own answer to "is there anything to slice by". Nothing synced, or
 * boot failed: no control at all. AN EMPTY PICKER IS A PROMISE THE REGISTER CANNOT KEEP.
 */
export function scopeChrome(data) {
  const f = findingFacts(data);
  const opts = (data && data.filterOptions) || {};
  const list = opts.projectList || [];
  return {
    show: Boolean(f.scope && list.length),
    label: "everything synced",
    caption: (d) => projectCaption(d, false, null),
    // "Everything synced", not "All projects": the register holds what the last sync was
    // scoped to fetch, and this row means "no view scope", not "every project that exists".
    reset: {
      label: "Everything synced",
      hint: () => findingCount(f.register),
      icon: "folders",
    },
    resetPayload: () => ({ projectView: "" }),
    defaultLabel: "Everything synced",
    // Without this the trigger prints the raw slug, which reads as corruption rather than as
    // a scope that no longer matches what was fetched.
    fallbackLabel: "Project not in this register",
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
  };
}

/**
 * Everything the control asserts, from the bootstrap payload alone. The same
 * `{show, current, label, caption, stale, options, pinned}` shape as before the move to the
 * shared model, so test/projectScopeView.test.js holds it unchanged — including every option
 * `value`, which is still the bare slug.
 *
 * @param {object|null} bootstrapData
 */
export function projectScopeView(bootstrapData) {
  const view = scopeView({
    kinds: scopeKinds(bootstrapData),
    data: bootstrapData,
    active: {
      kind: "project",
      id: (bootstrapData && bootstrapData.scope && bootstrapData.scope.projectView) || "",
    },
    chrome: scopeChrome(bootstrapData),
  });
  if (!view.show) {
    return {
      show: false, current: "", label: "", caption: "", stale: false, options: [], pinned: [],
    };
  }
  return { ...view, current: view.active };
}
