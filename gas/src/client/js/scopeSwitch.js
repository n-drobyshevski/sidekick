// The app-header scope switcher: which slice of the register every page is showing.
//
// It sits in the header rather than in the rail because it governs every page rather than
// leading to one — the rail is a list of destinations, and A SCOPE IS NOT A DESTINATION. That
// move also retired the control's second presentation: the two filters it replaces used to
// shrink to 40x34 glyph boxes for the collapsed rail, and the header has one width.
//
// TWO DIMENSIONS, ONE CONTROL, ONE AT A TIME. Manual group and support group were separate
// comboboxes that could both be live, and their intersection was expressible. It is not any
// more, deliberately: a header that carries "the scope" cannot carry two of them and still
// answer "what am I looking at" in one line. Picking from either group clears the other, and
// that rule is enforced here — in the control that offers them — rather than in the eight
// pages that read them.
//
// IT WAS THREE, BRIEFLY, AND THAT WAS ONE TOO MANY. `Wiz/Domain` arrived as its own dimension
// ("VC Domains") beside the manual groups, and the two were then two ways to ask one question:
// which domain owns this. They are now one resolved answer per finding — the tag where the
// tenant wrote one, a manual group's rules where it did not (`src/domain/resolveDomain.ts`) —
// so the Domains group below lists both vocabularies as one list, and a row is a domain
// regardless of which mechanism put a finding in it.
//
// THE TWO ARE ORTHOGONAL, NOT NESTED, and listing them as two flat groups rather than one
// tree is the honest shape. A DOMAIN is the owner of the resource. A SUPPORT GROUP is the team
// named by a subscription's `Wiz/provisioning` tag. Either can cut across the other, and a
// tree here would assert a hierarchy the data does not have.
//
// THE CODE STILL SAYS `domain`. That is the wire and storage name — the settings blob key, the
// RPC params, the ledger's `_domain` column — and renaming it would churn a persisted schema
// and every cache key for no visible gain.
//
// WHY NOT A WIZ PROJECT, which is what the sibling gas_ai app's switcher picks. This ledger
// holds no project dimension: `src/domain/transform.ts` drops the `projects[]` array Wiz
// returns on every finding, and `WIZ_PROJECT_ID_V2` scopes the SYNC rather than the view. A
// picker built over a dimension the register does not carry would offer slices whose pages all
// render zero — and a zero meaning "nothing here" and a zero meaning "never fetched" look
// identical on screen while calling for opposite reactions. The `Wiz/Domain` tag has the
// opposite property and is why it can lead here at all: `vulnerableAsset.tags` is already in
// the vulnerability query and already persisted per finding as `tags_json`, so every domain
// the list offers is one the register can actually answer for.
//
// Split in two on purpose, the way scanProgress.js and capacity.js already are:
// `scopeSwitchView` decides what the control CLAIMS — the label, the caption, whether the
// stored scope has gone stale — and is DOM-free so those claims can be tested in node.
// `scopeSwitchControl` only assembles them.

import { el, filterCombobox } from "./ui.js";
import { uiIcon } from "./uiIcons.js";

const nf = new Intl.NumberFormat();

/**
 * The bucket `domainRules.ts` gives a finding no rule claimed. Written out here rather than
 * imported: the client is plain JS and the domain engine is TypeScript on the server, so
 * pages/attribution.js already keeps its own copy of this literal for the same reason.
 *
 * It is a REAL, selectable scope — `domainNames()` appends it to the configured list — and the
 * caption has one special case for it, below.
 */
const UNASSIGNED = "Unassigned";

/**
 * Its counterpart for rows that carried no attribution input at all (resolveDomain's
 * NOT_ATTRIBUTABLE) — compacted and imported RESOLVED history. Structurally absent from the
 * live frame, so its row is measured against base rows and offered only when it holds
 * something; see `domainScopeOptions`.
 */
const NOT_ATTRIBUTABLE = "Not attributable";

function findingCount(n) {
  return `${nf.format(n)} ${n === 1 ? "finding" : "findings"}`;
}

/**
 * The support group carries a prefix on its value; the domain does not.
 *
 * One of them has to, or a domain and a support group both named `Payments` are one row in the
 * list and one value on the wire. The prefix is the control's own: `onPick` takes the kinds
 * apart again and hands the caller `{kind, value}`, so nothing outside this file ever sees it.
 */
export const SUPPORT_GROUP_PREFIX = "sg:";

/**
 * The trigger's own glyph, by which kind is in force — the same mark the rows of that kind
 * carry, so the closed control still says which heading you picked from. Unscoped it is the
 * reset row's mark, because that is the row in force.
 *
 * The domain's mark is a TAG rather than the funnel the manual-group filter used to carry: the
 * tag is now the principal mechanism, and a funnel described the fallback.
 */
const SCOPE_KIND_ICON = {
  domain: "tag",
  support: "users",
};

/**
 * The domains on offer, as switcher rows.
 *
 * ONE LIST, TWO MECHANISMS, AND THE ROW DOES NOT SAY WHICH. A name here may be a `Wiz/Domain`
 * tag value or a manual group; the resolved domain is one answer either way, and splitting the
 * heading would ask the reader to know which mechanism claimed a bucket before they can pick
 * it. Attribution's by-source strip is where that question is answered.
 *
 * The two tails do say what they are, because neither is an owner. `Unassigned` is a scope a
 * reader genuinely wants — the queue nobody has claimed. `Not attributable` is measured
 * against BASE ROWS: no open finding can land there, so a hint drawn from the frame would read
 * "0 findings" over a bucket that may hold thousands of resolved lifecycles.
 */
export function domainScopeOptions(names, counts, notAttributable) {
  return (names || []).map((name) => {
    if (name === NOT_ATTRIBUTABLE) {
      return {
        value: name,
        label: name,
        hint: `No attribution input · ${nf.format(notAttributable || 0)} resolved`,
        group: "Domains",
        icon: "noTag",
      };
    }
    return {
      value: name,
      label: name,
      // Declared in words rather than by glyph: the two kinds mean different things — a domain
      // owns the resource, a support group runs the subscription — and that is a meaning, so it
      // does not travel by mark alone.
      hint: (name === UNASSIGNED ? "No domain · " : "Domain · ")
        + findingCount((counts && counts[name]) || 0),
      group: "Domains",
      icon: name === UNASSIGNED ? "noTag" : "tag",
    };
  });
}

/** The support groups on offer, as switcher rows. */
export function supportScopeOptions(names, counts) {
  return (names || []).map((name) => ({
    value: SUPPORT_GROUP_PREFIX + name,
    label: name,
    hint: `Support group · ${findingCount((counts && counts[name]) || 0)}`,
    group: "Support groups",
    icon: "users",
  }));
}

/**
 * Everything the control asserts, from the bootstrap payload and the shell's active scope.
 *
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 * @param {{domain?: string, supportGroup?: string}} active  what the shell currently holds —
 *   at most one of the two is ever set
 * @returns {{show: boolean, current: string, kind: string, label: string, caption: string,
 *            stale: boolean, options: object[], pinned: object[]}}
 */
export function scopeSwitchView(data, active) {
  const a = active || {};
  const domain = a.domain || "";
  const supportGroup = a.supportGroup || "";
  const counts = (data && data.scopeCounts) || null;
  const register = counts ? counts.register : 0;
  // Over BASE ROWS, not the frame — see `domainScopeOptions`.
  const notAttributable = (counts && counts.notAttributable) || 0;

  // `domainNames` arrives RESOLVED: tag values the register carries, then the manual groups in
  // priority order, then the two tails. The one row dropped here is `Not attributable` when
  // nothing has landed there, which on a register that has never compacted is always — and a
  // scope holding nothing at all is the empty promise this control refuses to make.
  const allDomains = (data && data.domainNames) || [];
  const named = notAttributable > 0
    ? allDomains
    : allDomains.filter((n) => n !== NOT_ATTRIBUTABLE);
  // A domain that is the only bucket is not a scope — every page is already all of it — so the
  // list only carries them once there is more than one, exactly as the sidebar filter it
  // replaces did. Counted AFTER the drop above, or a register with no tags, no rules and no
  // compacted history would offer the single row `Unassigned` as though it were a choice.
  const domains = named.length > 1 ? named : [];
  const opts = (data && data.filterOptions) || {};
  const groups = opts.supportGroups || [];

  const hidden = {
    show: false, current: "", kind: "", label: "", caption: "",
    stale: false, options: [], pinned: [],
  };
  // Nothing scanned, or boot failed, or there is nothing to slice the register by: no control
  // at all. AN EMPTY PICKER IS A PROMISE THE REGISTER CANNOT KEEP, and the rail's scan zone
  // already says why it is empty.
  if (!counts || !register || (!domains.length && !groups.length)) return hidden;

  const options = [
    ...domainScopeOptions(domains, counts.domains, notAttributable),
    ...supportScopeOptions(groups, counts.supportGroups),
  ];

  const kind = domain ? "domain" : supportGroup ? "support" : "";
  // A stored scope naming something the register no longer holds — a manual group deleted from
  // settings, a support group that fell out after a scan scoped elsewhere, or a tag value that
  // vanished when WIZ_DOMAIN_TAG_KEY was corrected under it.
  const stale = Boolean(
    (domain && domains.indexOf(domain) < 0)
    || (supportGroup && groups.indexOf(supportGroup) < 0),
  );

  const name = domain || supportGroup;
  const label = !name ? "the whole register"
    : stale ? `${name} — not in this register` : name;

  const shown = stale ? 0
    : domain ? (counts.domains[domain] || 0)
      : supportGroup ? (counts.supportGroups[supportGroup] || 0)
        : register;

  // THE DENOMINATOR TRAVELS WITH THE NUMBER. "1,204" alone cannot tell a small domain from a
  // small register, and those two call for opposite reactions.
  //
  // AND A SCOPED CAPTION CARRIES A SECOND FIGURE, because leaving it off would be the more
  // comfortable lie. Under a domain, `unassigned` is how many findings NEITHER mechanism
  // claimed; under a support group, `noSupportGroup` is how many carry no group at all. Without
  // it, "1,204 of 8,331" quietly attributes the other 7,127 to some other domain or group, when
  // the truth for most of them is that nobody said.
  //
  // THE UNSCOPED CAPTION CARRIES THE OTHER HALF OF THE STORY, and only when there is one. Every
  // figure above is about the live frame, where nothing can be `Not attributable`; the
  // historical charts are built from base rows, where it is a real bucket. Saying so here — once,
  // up front, and only when the count is non-zero — is what stops a reader from meeting that
  // bucket for the first time inside an MTTR breakdown with no idea where it came from.
  let caption;
  if (stale) {
    caption = `Not in this register — showing 0 of ${nf.format(register)}`;
  } else if (domain === NOT_ATTRIBUTABLE) {
    // The one scope whose figure cannot come from the frame. Stating the zero rather than
    // hiding it: an operator who picks this row and finds every open-findings page empty should
    // read why on the control they picked it from, not conclude the app is broken.
    caption = `0 open findings · ${nf.format(notAttributable)} resolved with no attribution input`;
  } else if (domain === UNASSIGNED) {
    // The second figure would be the first one again — these ARE the unassigned findings. It
    // is dropped rather than restated: a caption that says the same number twice reads as a
    // bug, and invites the reader to look for the difference between them.
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + "claimed by no tag and no rule";
  } else if (domain) {
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + `${nf.format(counts.unassigned || 0)} unassigned`;
  } else if (supportGroup) {
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + `${nf.format(counts.noSupportGroup || 0)} carry no support group`;
  } else {
    caption = `${findingCount(register)} in the register`;
    if (notAttributable > 0) {
      caption += ` · ${nf.format(notAttributable)} resolved with no attribution input`;
    }
  }

  return {
    show: true,
    current: domain || (supportGroup ? SUPPORT_GROUP_PREFIX + supportGroup : ""),
    kind,
    label,
    caption,
    stale,
    options,
    // "Everything in the register", not "All domains": the row clears BOTH kinds, and naming it
    // after one of them describes half of what it does. "In the register" rather than a bare
    // "everything", because the register holds what the last scan was scoped to fetch and this
    // control cannot widen that.
    pinned: [{
      value: "", label: "Everything in the register",
      hint: findingCount(register), icon: "folders",
    }],
  };
}

/**
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 * @param {{domain?: string, supportGroup?: string}} active
 * @param {(pick: {kind: string, value: string}) => void} onPick  the chosen scope; a domain or
 *   support group name, either of them "" for the whole register
 * @returns {HTMLElement|null}  null when there is nothing truthful to offer
 */
export function scopeSwitchControl(data, active, onPick) {
  const v = scopeSwitchView(data, active);
  if (!v.show) return null;

  const combo = filterCombobox({
    value: v.current,
    options: v.options,
    pinnedRows: v.pinned,
    defaultLabel: "Everything in the register",
    // Without this the trigger prints the raw stored value under a heading that no longer
    // lists it, which reads as corruption rather than as a scope that has gone stale.
    fallbackLabel: "Not in this register",
    // Carries the CURRENT selection, not just the control's name. The header is rebuilt on
    // every pick, so this is re-stamped with each change.
    ariaLabel: `Scope: ${v.label}`,
    searchPlaceholder: "Search domains and support groups…",
    header: {
      title: "Scope",
      // Names both kinds, because both are in the list below it and they are not the same
      // question: a domain owns the resource, a support group is the team a subscription's tag
      // names. Naming only one would leave a reader to guess which heading they had picked
      // from — and the two cut across each other, so guessing wrong is easy.
      note: "Every page answers for the domain or support group you pick.",
    },
    // The scope outlives the page you picked it on, so which row is in force is a standing
    // fact about the app rather than a highlight in an open menu — worth a mark of its own
    // rather than weight and colour alone.
    checkSelected: true,
    // The popover is portaled to <body>, so this class is the only way to reach inside it.
    popClass: "combobox-pop--scope",
    leading: el("span", { class: "scope-combo-icon", "aria-hidden": "true" },
      uiIcon(SCOPE_KIND_ICON[v.kind] || "folders", 14)),
    // The prefix is the control's, not the caller's: onPick takes the two kinds apart so the
    // shell can send each to its own field, which is where "one at a time" is enforced.
    onChange: (picked) => {
      const s = String(picked || "");
      if (s.startsWith(SUPPORT_GROUP_PREFIX)) {
        onPick({ kind: "supportGroup", value: s.slice(SUPPORT_GROUP_PREFIX.length) });
      } else {
        onPick({ kind: "domain", value: s });
      }
    },
  });
  combo.classList.add("scope-combo");
  // A NARROWED REGISTER IS A STATE, and it is the one state in this app that silently re-reads
  // every number on every page. Unscoped the trigger stays the neutral field it has always
  // been, because "showing everything" is the resting state and a permanently lit control
  // reports nothing. The colour is never alone either way — the trigger names the scope and
  // the caption beside it carries the count.
  if (v.current) combo.classList.add("scoped");

  return el("div", { class: "scope-switch" },
    combo,
    el("div", {
      class: `scope-caption${v.stale ? " stale" : ""}`,
      // The caption answers the control above it, so it should be heard on selection rather
      // than only on a deliberate re-read of the region.
      "aria-live": "polite",
    }, v.caption),
  );
}
