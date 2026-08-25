// The app-header scope switcher: which slice of the register every page is showing.
//
// It sits in the header rather than in the rail because it governs every page rather than
// leading to one — the rail is a list of destinations, and A SCOPE IS NOT A DESTINATION. That
// move also retired the control's second presentation: the two filters it replaces used to
// shrink to 40x34 glyph boxes for the collapsed rail, and the header has one width.
//
// TWO DIMENSIONS, ONE CONTROL, ONE AT A TIME. Value chain and support group were separate
// comboboxes that could both be live, and their intersection was expressible. It is not any
// more, deliberately: a header that carries "the scope" cannot carry two of them and still
// answer "what am I looking at" in one line. Picking from either group clears the other, and
// that rule is enforced here — in the control that offers them — rather than in the eight
// pages that read them.
//
// WHY NOT A WIZ PROJECT, which is what the sibling gas_ai app's switcher picks. This ledger
// holds no project dimension: `src/domain/transform.ts` drops the `projects[]` array Wiz
// returns on every finding, and `WIZ_PROJECT_ID_V2` scopes the SYNC rather than the view. A
// picker built over a dimension the register does not carry would offer slices whose pages all
// render zero — and a zero meaning "nothing here" and a zero meaning "never fetched" look
// identical on screen while calling for opposite reactions.
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

function findingCount(n) {
  return `${nf.format(n)} ${n === 1 ? "finding" : "findings"}`;
}

/**
 * A support group's value carries a prefix and a value chain's does not.
 *
 * One of the two has to, or a value chain named `Payments` and a support group named
 * `Payments` are one row in the list and one value on the wire. The prefix is the control's
 * own: `onPick` takes the two kinds apart again and hands the caller `{kind, value}`, so
 * nothing outside this file ever sees it.
 */
export const SUPPORT_GROUP_PREFIX = "sg:";

/**
 * The value chains on offer, as switcher rows.
 *
 * `Unassigned` sits in this list because `domainNames()` puts it there, and it is a scope a
 * reader genuinely wants — it is the queue of findings nobody has claimed. Its hint says what
 * it is rather than calling it a value chain, because it is the absence of one.
 */
export function domainScopeOptions(names, counts) {
  return (names || []).map((name) => ({
    value: name,
    label: name,
    // Declared in words rather than by glyph: the two kinds mean different things — a value
    // chain is a rule someone wrote, a support group is a team someone owns — and that is a
    // meaning, so it does not travel by mark alone.
    hint: (name === UNASSIGNED ? "No value chain · " : "Value chain · ")
      + findingCount((counts && counts[name]) || 0),
    group: "Value chains",
    icon: "funnel",
  }));
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
 * @param {{domain?: string, supportGroup?: string}} active  what the shell currently holds
 * @returns {{show: boolean, current: string, kind: string, label: string, caption: string,
 *            stale: boolean, options: object[], pinned: object[]}}
 */
export function scopeSwitchView(data, active) {
  const a = active || {};
  const domain = a.domain || "";
  const supportGroup = a.supportGroup || "";
  const counts = (data && data.scopeCounts) || null;
  const register = counts ? counts.register : 0;

  // A value chain that is one bucket is not a scope — every page is already the whole chain —
  // so the list only carries them once settings define more than one, exactly as the sidebar
  // filter it replaces did.
  const domainNames = (data && data.domainNames) || [];
  const domains = domainNames.length > 1 ? domainNames : [];
  const groups = (data && data.filterOptions && data.filterOptions.supportGroups) || [];

  const hidden = {
    show: false, current: "", kind: "", label: "", caption: "",
    stale: false, options: [], pinned: [],
  };
  // Nothing scanned, or boot failed, or there is nothing to slice the register by: no control
  // at all. AN EMPTY PICKER IS A PROMISE THE REGISTER CANNOT KEEP, and the rail's scan zone
  // already says why it is empty.
  if (!counts || !register || (!domains.length && !groups.length)) return hidden;

  const options = [
    ...domainScopeOptions(domains, counts.domains),
    ...supportScopeOptions(groups, counts.supportGroups),
  ];

  const kind = domain ? "domain" : supportGroup ? "support" : "";
  // A stored scope naming something the register no longer holds — a value chain deleted from
  // settings, or a support group that fell out after a scan scoped elsewhere.
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

  // THE DENOMINATOR TRAVELS WITH THE NUMBER. "1,204" alone cannot tell a small value chain
  // from a small register, and those two call for opposite reactions.
  //
  // AND A SCOPED CAPTION CARRIES A SECOND FIGURE, because leaving it off would be the more
  // comfortable lie. Under a value chain, `unassigned` is how many findings no rule claimed;
  // under a support group, `noSupportGroup` is how many carry no group at all. Without it,
  // "1,204 of 8,331" quietly attributes the other 7,127 to some other chain or group, when the
  // truth for most of them is that nobody said.
  let caption;
  if (stale) {
    caption = `Not in this register — showing 0 of ${nf.format(register)}`;
  } else if (domain === UNASSIGNED) {
    // The second figure would be the first one again — these ARE the unassigned findings. It
    // is dropped rather than restated: a caption that says the same number twice reads as a
    // bug, and invites the reader to look for the difference between them.
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · claimed by no rule`;
  } else if (domain) {
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + `${nf.format(counts.unassigned || 0)} unassigned`;
  } else if (supportGroup) {
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + `${nf.format(counts.noSupportGroup || 0)} carry no support group`;
  } else {
    caption = `${findingCount(register)} in the register`;
  }

  return {
    show: true,
    current: domain ? domain : supportGroup ? SUPPORT_GROUP_PREFIX + supportGroup : "",
    kind,
    label,
    caption,
    stale,
    options,
    // "Everything in the register", not "All value chains": the row clears BOTH kinds, and
    // naming it after one of them describes half of what it does. "In the register" rather
    // than a bare "everything", because the register holds what the last scan was scoped to
    // fetch and this control cannot widen that.
    pinned: [{
      value: "", label: "Everything in the register",
      hint: findingCount(register), icon: "folders",
    }],
  };
}

/**
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 * @param {{domain?: string, supportGroup?: string}} active
 * @param {(pick: {kind: string, value: string}) => void} onPick  the chosen scope; a value
 *   chain name or a support group name, either of them "" for the whole register
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
    searchPlaceholder: "Search value chains and support groups…",
    header: {
      title: "Scope",
      // Names both kinds, because both are in the list below it and they are not the same
      // question: a value chain is a rule someone wrote in Settings, a support group is a team
      // the subscription tag names.
      note: "Every page answers for the value chain or support group you pick. Executive "
        + "always answers for the whole register.",
    },
    // The scope outlives the page you picked it on, so which row is in force is a standing
    // fact about the app rather than a highlight in an open menu — worth a mark of its own
    // rather than weight and colour alone.
    checkSelected: true,
    // The popover is portaled to <body>, so this class is the only way to reach inside it.
    popClass: "combobox-pop--scope",
    leading: el("span", { class: "scope-combo-icon", "aria-hidden": "true" },
      uiIcon(v.kind === "support" ? "users" : v.kind === "domain" ? "funnel" : "folders", 14)),
    // The prefix is the control's, not the caller's: onPick takes the two kinds apart so the
    // shell can send each to its own field, which is where "one at a time" is enforced.
    onChange: (picked) => (String(picked || "").startsWith(SUPPORT_GROUP_PREFIX)
      ? onPick({ kind: "supportGroup", value: String(picked).slice(SUPPORT_GROUP_PREFIX.length) })
      : onPick({ kind: "domain", value: picked || "" })),
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
