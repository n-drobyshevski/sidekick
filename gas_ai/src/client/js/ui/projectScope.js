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
// Split in two on purpose, the way syncProgress.js is: `projectScopeView` decides what the
// control CLAIMS — the label, the caption, whether the stored scope has gone stale — and is
// DOM-free so those claims can be tested. `projectScopeControl` only assembles them.

import { el } from "./dom.js";
import { filterCombobox } from "./combobox.js";
import { uiIcon } from "./uiIcons.js";

import { tipAnchor } from "./tip.js";
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
export function scopeOptions(list) {
  const anyRecorded = list.some((p) => p.isFolder !== undefined);
  return list.map((p) => ({
    value: p.id,
    label: p.name,
    // Folders are declared in words rather than by icon or colour: picking one reaches its
    // whole subtree, and that is a meaning, so it does not travel by colour alone.
    hint: p.isFolder === true ? `Business unit · ${assetCount(p.assets)}` : assetCount(p.assets),
    group: !anyRecorded ? "" : (p.isFolder === true ? "Business units"
      : p.isFolder === false ? "Projects" : "Not yet recorded"),
    // The glyph is the THIRD carrier, after the hint above and the group heading — a reader
    // who cannot tell one folder from two at 14px has already been told twice in words. That
    // ordering is the whole licence for it: an icon that had to be understood would be
    // exactly the shorthand the hint exists to avoid.
    icon: p.isFolder === true ? "folders" : "folder",
  }));
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
 * Everything the control asserts, from the bootstrap payload alone.
 *
 * @param {object|null} bootstrapData
 * @returns {{show: boolean, current: string, label: string, caption: string,
 *            stale: boolean, options: object[], pinned: object[]}}
 */
export function projectScopeView(bootstrapData) {
  const opts = (bootstrapData && bootstrapData.filterOptions) || {};
  const list = opts.projectList || [];
  const domains = opts.domainList || [];
  const scope = (bootstrapData && bootstrapData.scope) || null;

  // Nothing synced, or boot failed: no control at all. An empty picker is a promise the
  // register cannot keep, and the rail's sync zone already says why it is empty.
  if (!scope || !list.length) {
    return {
      show: false, current: "", label: "", caption: "", stale: false, options: [], pinned: [],
    };
  }

  const cover = scope.domainCoverage || null;
  const tagged = cover ? cover.tagged : 0;
  const untagged = cover ? Math.max(0, cover.total - cover.tagged) : 0;
  // THE GROUP IS ABSENT, NOT EMPTY, WHEN NOTHING IS TAGGED. `AI_ASSET_PROPERTIES` is an
  // optional sync step that swallows an HTTP 400, so a tenant that rejects it has no domain
  // data at all — and a "Domains" heading over nothing would say that nobody owns anything,
  // which is a claim about the tenant rather than about what we managed to ask.
  const domainRows = tagged > 0 ? domainScopeOptions(domains) : [];

  const domainView = scope.domainView || "";
  const projectView = scope.projectView || "";
  const chosenDomain = domainView
    ? domains.filter((d) => d.name === domainView)[0] || null : null;
  const chosen = projectView ? list.find((p) => p.id === projectView) || null : null;
  // A stored view whose project or domain fell out of the register after a re-sync scoped
  // elsewhere — or, for a domain, after the tag key changed under it.
  const stale = Boolean(domainView ? !chosenDomain : projectView && !chosen);

  const label = domainView
    ? (chosenDomain ? chosenDomain.name : "a domain this register does not hold")
    : !projectView ? "everything synced"
      : chosen ? chosen.name : "a project this register does not hold";

  return {
    show: true,
    // Prefixed for domains so a project whose id is `SAP` and the domain `SAP` can never be
    // one row. The control strips it again on pick; the server keys its caches the same way.
    current: domainView ? `d:${domainView}` : projectView,
    kind: domainView ? "domain" : projectView ? "project" : "",
    label,
    // The denominator travels with the number: "826" alone cannot tell a small unit from a
    // small register, and those call for opposite reactions.
    //
    // A DOMAIN CARRIES A SECOND FIGURE, and leaving it off would be the more comfortable lie.
    // Only some resources are tagged — 15 of 36 in the seeded landscape — so "36 of 87" under
    // a domain silently attributes the other 51 to some other domain, when the truth is that
    // nobody said. The count says which.
    caption: stale ? `Not in this register — showing 0 of ${nf.format(scope.register)}`
      : domainView
        ? `${nf.format(scope.shown)} of ${nf.format(scope.register)} assets · `
          + `${nf.format(untagged)} carry no domain`
        : !projectView ? `${assetCount(scope.register)} synced`
          : `${nf.format(scope.shown)} of ${nf.format(scope.register)} assets`,
    stale,
    options: [...scopeOptions(list), ...domainRows],
    // "Everything synced", not "All projects" and no longer "All synced projects": the row
    // means "no scope", and once the scope can be a domain, naming the reset after one of the
    // two kinds describes half of what it clears. The care in the original wording is kept
    // where it was load-bearing — the register holds what the last sync was scoped to fetch,
    // so "synced" stays and "all" never stands alone.
    pinned: [{
      value: "", label: "Everything synced", hint: assetCount(scope.register), icon: "folders",
    }],
  };
}

/**
 * @param {object|null} bootstrapData  the bootstrap payload, or null when boot failed
 * @param {(pick: {kind: string, value: string}) => void} onPick  the chosen scope; a project
 *   id or a domain name, either of them "" for the whole register
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
    // Carries the CURRENT selection, not just the control's name. The header is rebuilt
    // wholesale on every refresh() and picking triggers one, so this is re-stamped with
    // each change.
    ariaLabel: `Scope: ${v.label}`,
    searchPlaceholder: "Search projects and domains…",
    // WHAT THE PANEL HAS TO SAY THAT ITS ROWS CANNOT. Every row is a project name; none of
    // them can tell you that choosing one re-scopes every figure in the app, or that a few
    // figures refuse to be scoped and say so where they are drawn (registerWideNote, below,
    // is that promise kept). A consequence this large should not have to be discovered by
    // trying it.
    header: {
      title: "Scope",
      // Names both kinds, because both are in the list below it and they are not the same
      // question: a project is a thing Wiz nests resources in, a domain is a tag someone
      // wrote on them, and the seeded landscape puts four domains inside one project to make
      // sure neither reads as the other.
      note: "Every page answers for the project or domain you pick. Figures that cannot be "
        + "scoped say so where they are drawn.",
    },
    // The scope persists server-side and outlives the session, so which row is in force is a
    // standing fact about the app rather than a highlight in an open menu — worth a mark of
    // its own rather than weight and colour alone.
    checkSelected: true,
    // The popover is portaled to <body>, so this class is the only way to reach inside it.
    popClass: "combobox-pop--scope",
    // Decoration inside the trigger, the way the reference screen marks its project picker.
    // The trigger's accessible name is the ariaLabel above, so this adds no second reading.
    leading: el("span", { class: "scope-combo-icon", "aria-hidden": "true" },
      uiIcon(v.kind === "domain" ? "tag" : v.current ? "folder" : "folders", 14)),
    // The prefix is the control's, not the caller's: onPick takes the two kinds apart so the
    // shell can send each to its own setter, which is where "one at a time" is enforced.
    onChange: (v) => (String(v || "").startsWith("d:")
      ? onPick({ kind: "domain", value: String(v).slice(2) })
      : onPick({ kind: "project", value: v || "" })),
  });
  combo.classList.add("scope-combo");
  // A NARROWED REGISTER IS A STATE, and this is the one state in the app that silently
  // re-reads every number on every page. DESIGN.md spends colour on "a severity level, an SLA
  // breach, a state change"; this is the third. Unscoped it stays the neutral field it has
  // always been, because "showing everything" is the resting state and a permanently lit
  // control signals nothing. The colour is never alone either way — the trigger names the
  // project, and the caption beside it carries the count.
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
