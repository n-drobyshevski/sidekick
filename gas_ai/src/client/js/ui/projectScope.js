// The app-header project switcher: which slice of the synced register every page is showing.
//
// It sits in the header rather than in the rail because it governs every page rather than
// leading to one — the rail is a list of destinations, and a scope is not a destination. That
// move also retired the control's second presentation: it used to shrink to a two-letter
// glyph for the 56px collapsed rail, and the header has one width.
//
// The list comes from `filterOptions.projectList`, derived from the assets the sync
// actually collected — never from the tenant's project catalogue. A picker built from the
// live catalogue would offer projects this register was never asked for, and the page
// behind such a pick renders zero. A zero meaning "nothing here" and a zero meaning "never
// fetched" look identical on screen and call for opposite reactions, so the control simply
// cannot express the second one.
//
// REDUCED, NOT DELETED. `projectScopeControl` — the combobox, the caption, the `.scoped`
// class — is `gas_shared/ui/scopeControl.js` now, and the assembly around it is
// `gas_shared/ui/scopeModel.js`; both were three near-identical copies across the three
// sidekicks. What stays is the half that is genuinely this register's: the two dimensions it
// offers, the tenant naming convention it reads them through, and the three scope NOTES
// (`registerWideNote`, `scopeNote`, `trendScopeView`) that say which figures refuse to follow
// the switcher — a question no sibling asks in the same words.
//
// Split in two on purpose, the way syncProgress.js is: `projectScopeView` decides what the
// control CLAIMS — the label, the caption, whether the stored scope has gone stale — and is
// DOM-free so those claims can be tested. The control only assembles them.

import { el } from "../../../../../gas_shared/ui/dom.js";
import { scopeView } from "../../../../../gas_shared/ui/scopeModel.js";
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
/**
 * The tenant's naming convention: a project whose name begins `CS`, `CE` or `LU` is a
 * SUPPORT GROUP, and a business unit is anything that is not one.
 *
 * A rule read off a NAME, which this codebase is otherwise careful not to do — `aarsRule`
 * refuses to guess a control's meaning from its title for exactly this reason. What makes it
 * legitimate here is that it is not an inference about what something IS: it is the tenant's
 * own convention for what they CALL things, the same class of fact as `WIZ_DOMAIN_TAG_KEY`,
 * and the app has no other way to learn it. Wiz reports `isFolder`; it does not report that
 * `CS-LOG-ZEN-ECOM` — a folder in the captures — is a support group rather than a unit.
 *
 * THE FIRST SEGMENT, NOT A BARE PREFIX. `CE-DPCP-PORTAL` matches, `CENTRAL-OPS` must not, and
 * `owner-CE-INDUS-SUPPLY-cloud` — a real captured name with CE in the middle — must not
 * either. Splitting on the separator answers all three, where `startsWith("CE")` gets the
 * second wrong and `includes("CE")` gets the third wrong.
 *
 * One list, exported, because a convention is a thing that changes: a fourth prefix is one
 * edit here rather than a hunt through three files.
 */
export const SUPPORT_GROUP_PREFIXES = ["CS", "CE", "LU"];

export function isSupportGroup(name) {
  const first = String(name || "").trim().toUpperCase().split(/[-_\s]/)[0];
  return SUPPORT_GROUP_PREFIXES.indexOf(first) >= 0;
}

/**
 * What to call one row: a support group, a business unit, a project, or nothing yet.
 *
 * The name rule wins over `isFolder`, because the two answer different questions and only one
 * of them is about naming. `CS-LOG-ZEN-ECOM` is a folder AND a support group; calling it a
 * business unit because Wiz says it nests things would be the app overruling the tenant on
 * the tenant's own vocabulary.
 */
function projectKind(p) {
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

export function scopeOptions(list) {
  // `isFolder` is tri-state and the third state is load-bearing: `undefined` means the row
  // predates the field. So the FOLDER half of the grouping only claims anything once the
  // register has recorded it for someone. The SUPPORT-GROUP half is not gated on it, because
  // it is read off the name and needs nothing from Wiz — knowing which four rows are support
  // groups is worth saying even on a register that cannot yet say which are folders.
  const anyRecorded = list.some((p) => p.isFolder !== undefined);
  const rows = list.map((p) => {
    const kind = projectKind(p);
    return {
      value: p.id,
      label: p.name,
      kind,
      // Declared in words rather than by icon or colour: picking a unit or a support group
      // reaches its whole subtree, and that is a meaning, so it does not travel by colour
      // alone.
      hint: kind === "support" ? `Support group · ${assetCount(p.assets)}`
        : kind === "unit" ? `Business unit · ${assetCount(p.assets)}`
          : assetCount(p.assets),
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
  // server's folders-first-then-name ordering wherever it still applies.
  return rows
    .map((row, at) => ({ row, at }))
    .sort((x, y) => (KIND_RANK[x.row.kind] - KIND_RANK[y.row.kind]) || (x.at - y.at))
    .map(({ row }) => row);
}

/**
 * The domains on offer, as switcher rows.
 *
 * A flat group, never nested under a project and never a tier above one. The seeded landscape
 * puts four domains inside PROJECT-ALPHA on purpose — "grouping by domain has to visibly cut
 * across an attack path or the dimension is just a second spelling of the project" — so a tree
 * here would assert a hierarchy the data does not have.
 *
 * No "untagged" row. An untagged resource contributes nothing to a facet, exactly as a blank
 * cloud or region already does, and a synthetic one here would offer "the assets we know least
 * about" as though it were an owner. The coverage figure in the caption answers that instead.
 */
export function domainScopeOptions(list) {
  return (list || []).map((d) => ({
    value: `d:${d.name}`,
    label: d.name,
    hint: assetCount(d.assets),
    group: "Domains",
    icon: "tag",
  }));
}

/**
 * What the two dimensions need from the payload, derived once.
 *
 * THE DOMAIN GROUP IS ABSENT, NOT EMPTY, WHEN NOTHING IS TAGGED. `AI_ASSET_PROPERTIES` is an
 * optional sync step that swallows an HTTP 400, so a tenant that rejects it has no domain data
 * at all — and a "Domains" heading over nothing would say that nobody owns anything, which is
 * a claim about the tenant rather than about what we managed to ask.
 */
function facts(bootstrapData) {
  const opts = (bootstrapData && bootstrapData.filterOptions) || {};
  const scope = (bootstrapData && bootstrapData.scope) || null;
  const cover = (scope && scope.domainCoverage) || null;
  return {
    scope,
    list: opts.projectList || [],
    domains: opts.domainList || [],
    tagged: cover ? cover.tagged : 0,
    untagged: cover ? Math.max(0, cover.total - cover.tagged) : 0,
  };
}

/**
 * The two dimensions, as `gas_shared/ui/scopeModel.js` takes them.
 *
 * THE PROJECT IS THE BARE KIND AND THE DOMAIN CARRIES `d:`, exactly as before the move. One of
 * them has to — a project whose id is `SAP` and a domain named `SAP` would otherwise be one row
 * and one value — and which one is bare is not a free choice: `settingsStore.projectView` holds
 * an unprefixed id and the server keys its caches the same way, so flipping it would invalidate
 * a persisted scope for nothing a reader can see.
 *
 * `scopeOptions` and `domainScopeOptions` above are untouched, `value` field and all, because
 * both are exported and tested directly; the one-line map to the model's `id` happens here.
 */
export function scopeKinds(bootstrapData) {
  const f = facts(bootstrapData);
  return [
    {
      key: "project",
      prefix: "",
      icon: "folder",
      options: () => scopeOptions(f.list).map((o) => ({ ...o, id: o.value })),
      label: (opt, d, ctx) => (ctx.stale
        ? "a project this register does not hold"
        : (opt ? opt.label : ctx.id)),
      caption: (opt, d, ctx) => projectCaption(d, ctx.stale),
      // THE EXACT ARGUMENT `api_setSettings` HAS ALWAYS TAKEN for this kind. ONE FIELD, NEVER
      // BOTH: `settingsLogic`'s withProjectView / withDomainView clear each other server-side,
      // so sending both would leave which one survived to the order the setter ran them in.
      payload: (id) => ({ projectView: id }),
    },
    {
      key: "domain",
      prefix: "d",
      icon: "tag",
      options: () => (f.tagged > 0
        ? domainScopeOptions(f.domains).map((o) => ({ ...o, id: o.value.slice(2) }))
        : []),
      label: (opt, d, ctx) => (ctx.stale
        ? "a domain this register does not hold"
        : (opt ? opt.label : ctx.id)),
      caption: (opt, d, ctx) => domainCaption(d, ctx.stale),
      payload: (id) => ({ domainView: id }),
    },
  ];
}

/** The denominator travels with the number: "826" alone cannot tell a small unit from a small
 *  register, and those call for opposite reactions. */
function projectCaption(bootstrapData, stale) {
  const f = facts(bootstrapData);
  const register = f.scope ? f.scope.register : 0;
  if (stale) return "Not in this register — showing 0 of " + nf.format(register);
  return nf.format(f.scope.shown) + " of " + nf.format(register) + " assets";
}

/**
 * A DOMAIN CARRIES A SECOND FIGURE, and leaving it off would be the more comfortable lie.
 * Only some resources are tagged — 15 of 36 in the seeded landscape — so "36 of 87" under a
 * domain silently attributes the other 51 to some other domain, when the truth is that nobody
 * said. The count says which.
 */
function domainCaption(bootstrapData, stale) {
  const f = facts(bootstrapData);
  const register = f.scope ? f.scope.register : 0;
  if (stale) return "Not in this register — showing 0 of " + nf.format(register);
  return nf.format(f.scope.shown) + " of " + nf.format(register) + " assets · "
    + nf.format(f.untagged) + " carry no domain";
}

/**
 * The parts of the control that are not a dimension.
 *
 * `show` is this register's own answer to "is there anything to slice by". Nothing synced, or
 * boot failed: no control at all. AN EMPTY PICKER IS A PROMISE THE REGISTER CANNOT KEEP, and
 * the rail's sync zone already says why it is empty.
 */
export function scopeChrome(bootstrapData) {
  const f = facts(bootstrapData);
  const register = f.scope ? f.scope.register : 0;
  return {
    show: Boolean(f.scope && f.list.length),
    label: "everything synced",
    caption: () => assetCount(register) + " synced",
    // "Everything synced", not "All projects" and no longer "All synced projects": the row
    // means "no scope", and once the scope can be a domain, naming the reset after one of the
    // two kinds describes half of what it clears. The care in the original wording is kept
    // where it was load-bearing — the register holds what the last sync was scoped to fetch,
    // so "synced" stays and "all" never stands alone.
    reset: {
      label: "Everything synced",
      hint: () => assetCount(register),
      icon: "folders",
    },
    // The reset row's value is "", which parses to the BARE kind — the project — so this is
    // the same `{projectView: ""}` the deleted control sent, and `withProjectView` clears the
    // domain along with it.
    resetPayload: () => ({ projectView: "" }),
    defaultLabel: "All synced projects",
    // Without this the trigger prints the raw id, which reads as corruption rather than as a
    // scope that no longer matches what was fetched.
    fallbackLabel: "Project not in this register",
    searchPlaceholder: "Search projects and domains…",
    // WHAT THE PANEL HAS TO SAY THAT ITS ROWS CANNOT. Every row is a project name; none of
    // them can tell you that choosing one re-scopes every figure in the app, or that a few
    // figures refuse to be scoped and say so where they are drawn (registerWideNote, below, is
    // that promise kept). A consequence this large should not have to be discovered by trying
    // it.
    header: {
      title: "Scope",
      // Names both kinds, because both are in the list below it and they are not the same
      // question: a project is a thing Wiz nests resources in, a domain is a tag someone wrote
      // on them, and the seeded landscape puts four domains inside one project to make sure
      // neither reads as the other.
      note: "Every page answers for the project or domain you pick. Figures that cannot be "
        + "scoped say so where they are drawn.",
    },
  };
}

/**
 * Everything the control asserts, from the bootstrap payload alone. The same
 * `{show, current, kind, label, caption, stale, options, pinned}` shape as before the move to
 * the shared model, so test/projectScopeView.test.js holds it — including every option value,
 * `d:`-prefixed domains and bare project ids alike.
 *
 * @param {object|null} bootstrapData
 */
export function projectScopeView(bootstrapData) {
  const scope = (bootstrapData && bootstrapData.scope) || null;
  const domainView = (scope && scope.domainView) || "";
  const projectView = (scope && scope.projectView) || "";
  const view = scopeView({
    kinds: scopeKinds(bootstrapData),
    data: bootstrapData,
    // ONE AT A TIME, and the domain wins the read because it is the narrower claim. A payload
    // carrying both is a defect server-side (withProjectView / withDomainView clear each
    // other), and intersecting them here would hide it rather than surface it.
    active: domainView
      ? { kind: "domain", id: domainView }
      : { kind: "project", id: projectView },
    chrome: scopeChrome(bootstrapData),
  });
  if (!view.show) {
    return {
      show: false, current: "", label: "", caption: "", stale: false, options: [], pinned: [],
    };
  }
  return { ...view, current: view.active };
}

/**
 * Marks a figure that does NOT follow the project view, and appears only when one is set.
 *
 * Some numbers here cannot be scoped and must not pretend to be. `sync_history` stores
 * register-wide totals with no asset or project on the row, so a trend point can never be
 * re-scoped; posture percentages are Wiz's own tenant-side aggregates; storage counts describe
 * the ledger; a rule preview answers what a rule would do to everything it scores. Rendering
 * any of those beside scoped figures with nothing to tell them apart invites the one reading
 * that is definitely wrong — that they describe the same population.
 *
 * Printed with the figure rather than as a footnote, which is the discipline postureDelta's
 * `confound` already states: a footnote is read after the reader has decided. And it carries
 * both counts, because "whole register" only means something next to the number it is not.
 *
 * Returns null when no project is selected — unscoped, there is nothing to disambiguate and
 * a permanent badge saying "register-wide" on a register-wide app is noise.
 *
 * @param {object|null} bootstrapData  the bootstrap payload
 * @param {string} detail  what this particular figure covers, e.g. "every sync recorded"
 */
export function registerWideNote(bootstrapData, detail) {
  const scope = (bootstrapData && bootstrapData.scope) || null;
  if (!scope || !scope.projectView) return null;
  return scopeNote({
    tag: "Whole register",
    text: `${nf.format(scope.register)} assets, not the ${nf.format(scope.shown)} in view`
      + (detail ? ` — ${detail}.` : "."),
  });
}

/**
 * The note itself: a tag and a sentence, in the one markup both kinds share.
 *
 * Factored out because there are now two kinds and they must not drift into two looks. The
 * original says a figure does NOT follow the switcher; `scope-live-tag` says one DOES, and
 * that is the only difference — same chip, same hairline, darker ink. Two hand-written
 * copies of four `el()` calls in two page files is how a design system quietly acquires a
 * second style for the same idea.
 */
export function scopeNote({ tag, text, live }) {
  return el("p", { class: "register-wide-note" },
    el("span", { class: `register-wide-tag${live ? " scope-live-tag" : ""}` }, tag),
    el("span", {}, text),
  );
}

/**
 * What the inventory trend claims about the population it charts.
 *
 * DOM-free, like `projectScopeView` above and for the same reason: the wording IS the
 * decision. This series is the last figure in the app that had to refuse the project
 * switcher, and the refusal was real — `sync_history` held register-wide totals with nothing
 * on the row to re-scope BY. It now carries a per-project blob beside them, so a scoped read
 * is a different column rather than a filter.
 *
 * THE COVERAGE SENTENCE IS THE POINT. A blob can only exist for syncs recorded after it
 * shipped, so a project's series can be three points long against a ledger of forty — and a
 * chart that starts three points in looks exactly like a landscape that collapsed. Saying
 * "covers 3 of 40" is the difference between a short history and a catastrophe. Nothing here
 * is backfillable: the ledger never held the dimension, so the earlier points do not exist to
 * be recovered, and the note says that rather than implying a later sync will fill them in.
 *
 * @param {{projectId: string, scoped: boolean, points: number, registerPoints: number}|null} scope
 */
export function trendScopeView(scope) {
  // A DOMAIN VIEW IS NOT A SHORT SERIES, IT IS NO SERIES, and the difference has to be said.
  // `sync_history` records per-project totals beside its register-wide ones; there is no
  // per-domain column and there cannot be a backfilled one, because the ledger never held the
  // dimension. Left to the branch below this would read as `scoped: false` and print nothing,
  // and the chart would sit under a header naming a domain while charting the register.
  if (scope && !scope.scoped && scope.domainId) {
    return {
      show: true,
      live: false,
      tag: "Whole register",
      text: "This series is recorded per project, so a domain has no point on it — these are "
        + "the register's totals. Nothing here can be broken down after the fact: the ledger "
        + "never held the dimension.",
    };
  }
  if (!scope || !scope.scoped) return { show: false, live: false, tag: "", text: "" };
  const points = Number(scope.points) || 0;
  const register = Number(scope.registerPoints) || 0;

  // Nothing recorded for this project yet, on a ledger that has history. The chart is empty,
  // so the tag must not claim to be showing this project's series — it is explaining why
  // there is none. "Whole register" would be wrong too: nothing register-wide is on screen.
  if (points === 0) {
    return {
      show: true,
      live: false,
      tag: "Not yet recorded",
      text: register
        ? `Per-project totals start with the next sync. The ${nf.format(register)} `
          + `${register === 1 ? "sync" : "syncs"} already recorded hold register-wide totals `
          + "only, and cannot be broken down after the fact."
        : "Per-project totals start with the first sync.",
    };
  }

  if (points >= register) {
    return {
      show: true,
      live: true,
      tag: "This project",
      text: "Every recorded sync, counted for the project in view.",
    };
  }

  return {
    show: true,
    live: true,
    tag: "This project",
    text: `Covers ${nf.format(points)} of the ${nf.format(register)} recorded syncs — the `
      + "earlier ones hold register-wide totals only, so this project has no point on them.",
  };
}

/** `trendScopeView`, assembled. Null when no project is in view. */
export function trendScopeNote(scope) {
  const v = trendScopeView(scope);
  return v.show ? scopeNote(v) : null;
}
