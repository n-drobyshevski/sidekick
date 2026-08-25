// The app-header scope switcher: which slice of the register every page is showing.
//
// It sits in the header rather than in the rail because it governs every page rather than
// leading to one — the rail is a list of destinations, and A SCOPE IS NOT A DESTINATION. That
// move also retired the control's second presentation: the two filters it replaces used to
// shrink to 40x34 glyph boxes for the collapsed rail, and the header has one width.
//
// THREE DIMENSIONS, ONE CONTROL, ONE AT A TIME. Value chain and support group were separate
// comboboxes that could both be live, and their intersection was expressible. It is not any
// more, deliberately: a header that carries "the scope" cannot carry three of them and still
// answer "what am I looking at" in one line. Picking from any group clears the others, and
// that rule is enforced here — in the control that offers them — rather than in the eight
// pages that read them.
//
// THE THREE ARE ORTHOGONAL, NOT NESTED, and listing them as three flat groups rather than one
// tree is the honest shape. A VALUE CHAIN is a bucket this app computes from rules an operator
// wrote in Settings. A SUPPORT GROUP is the team named by a subscription's `Wiz/provisioning`
// tag. A BUSINESS DOMAIN is the owner named by a resource's `Wiz/Domain` tag. Any of the three
// can cut across either of the others, and a tree here would assert a hierarchy the data does
// not have.
//
// WHY NOT A WIZ PROJECT, which is what the sibling gas_ai app's switcher picks. This ledger
// holds no project dimension: `src/domain/transform.ts` drops the `projects[]` array Wiz
// returns on every finding, and `WIZ_PROJECT_ID_V2` scopes the SYNC rather than the view. A
// picker built over a dimension the register does not carry would offer slices whose pages all
// render zero — and a zero meaning "nothing here" and a zero meaning "never fetched" look
// identical on screen while calling for opposite reactions. The business domain has the
// opposite property and is why it can be here at all: `vulnerableAsset.tags` is already in the
// vulnerability query and already persisted per finding as `tags_json`, so every domain the
// list offers is one the register can actually answer for.
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
 * Two of the three kinds carry a prefix on their value; the value chain does not.
 *
 * Two of them have to, or a value chain, a support group and a business domain all named
 * `Payments` are one row in the list and one value on the wire. The prefixes are the control's
 * own: `onPick` takes the kinds apart again and hands the caller `{kind, value}`, so nothing
 * outside this file ever sees them.
 */
export const SUPPORT_GROUP_PREFIX = "sg:";
export const BIZ_DOMAIN_PREFIX = "bd:";

/**
 * The trigger's own glyph, by which kind is in force — the same mark the rows of that kind
 * carry, so the closed control still says which heading you picked from. Unscoped it is the
 * reset row's mark, because that is the row in force.
 */
const SCOPE_KIND_ICON = {
  domain: "funnel",
  bizDomain: "tag",
  support: "users",
};

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
 * The business domains on offer, as switcher rows.
 *
 * NO "UNTAGGED" ROW. An untagged resource contributes nothing to a facet, exactly as a blank
 * cloud or subscription already does, and a synthetic one here would offer "the resources we
 * know least about" as though it were an owner. The coverage figure in the caption answers
 * that question instead, and answers it about the whole register rather than row by row.
 */
export function bizDomainScopeOptions(names, counts) {
  return (names || []).map((name) => ({
    value: BIZ_DOMAIN_PREFIX + name,
    label: name,
    hint: `Business domain · ${findingCount((counts && counts[name]) || 0)}`,
    group: "Business domains",
    icon: "tag",
  }));
}

/**
 * Everything the control asserts, from the bootstrap payload and the shell's active scope.
 *
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 * @param {{domain?: string, supportGroup?: string, bizDomain?: string}} active  what the
 *   shell currently holds — at most one of the three is ever set
 * @returns {{show: boolean, current: string, kind: string, label: string, caption: string,
 *            stale: boolean, options: object[], pinned: object[]}}
 */
export function scopeSwitchView(data, active) {
  const a = active || {};
  const domain = a.domain || "";
  const supportGroup = a.supportGroup || "";
  const bizDomain = a.bizDomain || "";
  const counts = (data && data.scopeCounts) || null;
  const register = counts ? counts.register : 0;

  // A value chain that is one bucket is not a scope — every page is already the whole chain —
  // so the list only carries them once settings define more than one, exactly as the sidebar
  // filter it replaces did.
  const domainNames = (data && data.domainNames) || [];
  const domains = domainNames.length > 1 ? domainNames : [];
  const opts = (data && data.filterOptions) || {};
  const groups = opts.supportGroups || [];
  // THE GROUP IS ABSENT, NOT EMPTY, WHEN NOTHING IS TAGGED. The domain tag is optional and the
  // tenant's to write, so a register where nobody has written it has no domain data at all —
  // and a "Business domains" heading over nothing would say that nobody owns anything, which is
  // a claim about the tenant rather than about what we managed to read.
  const bizDomains = opts.bizDomains || [];

  const hidden = {
    show: false, current: "", kind: "", label: "", caption: "",
    stale: false, options: [], pinned: [],
  };
  // Nothing scanned, or boot failed, or there is nothing to slice the register by: no control
  // at all. AN EMPTY PICKER IS A PROMISE THE REGISTER CANNOT KEEP, and the rail's scan zone
  // already says why it is empty.
  if (!counts || !register || (!domains.length && !groups.length && !bizDomains.length)) {
    return hidden;
  }

  const options = [
    ...domainScopeOptions(domains, counts.domains),
    ...bizDomainScopeOptions(bizDomains, counts.bizDomains),
    ...supportScopeOptions(groups, counts.supportGroups),
  ];

  const kind = domain ? "domain" : bizDomain ? "bizDomain" : supportGroup ? "support" : "";
  // A stored scope naming something the register no longer holds — a value chain deleted from
  // settings, a support group that fell out after a scan scoped elsewhere, or a business domain
  // that vanished when WIZ_DOMAIN_TAG_KEY was corrected under it.
  const stale = Boolean(
    (domain && domains.indexOf(domain) < 0)
    || (supportGroup && groups.indexOf(supportGroup) < 0)
    || (bizDomain && bizDomains.indexOf(bizDomain) < 0),
  );

  const name = domain || bizDomain || supportGroup;
  const label = !name ? "the whole register"
    : stale ? `${name} — not in this register` : name;

  const shown = stale ? 0
    : domain ? (counts.domains[domain] || 0)
      : bizDomain ? ((counts.bizDomains || {})[bizDomain] || 0)
        : supportGroup ? (counts.supportGroups[supportGroup] || 0)
          : register;

  // THE DENOMINATOR TRAVELS WITH THE NUMBER. "1,204" alone cannot tell a small value chain
  // from a small register, and those two call for opposite reactions.
  //
  // AND A SCOPED CAPTION CARRIES A SECOND FIGURE, because leaving it off would be the more
  // comfortable lie. Under a value chain, `unassigned` is how many findings no rule claimed;
  // under a support group, `noSupportGroup` is how many carry no group at all; under a business
  // domain, `noBizDomain` is how many carry no domain tag. Without it, "1,204 of 8,331" quietly
  // attributes the other 7,127 to some other chain, group or domain, when the truth for most of
  // them is that nobody said.
  //
  // THE DOMAIN'S SECOND FIGURE IS THE ONE THAT WORKS HARDEST, because the tag is the tenant's
  // to write and most tenants have not finished writing it: a bare "5 of 87" under a domain
  // reads as a small domain in a big register, when what it actually says is that 82 resources
  // are unattributed. It names the tag it read, too — the figure is a fact about `Wiz/Domain`
  // specifically, and an operator who mistyped WIZ_DOMAIN_TAG_KEY would otherwise read a
  // tenant-wide tagging failure off their own typo.
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
  } else if (bizDomain) {
    const tagKey = (data && data.domainTagKey) || "";
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + `${nf.format(counts.noBizDomain || 0)} carry no ${tagKey || "domain"} tag`;
  } else if (supportGroup) {
    caption = `${nf.format(shown)} of ${nf.format(register)} findings · `
      + `${nf.format(counts.noSupportGroup || 0)} carry no support group`;
  } else {
    caption = `${findingCount(register)} in the register`;
  }

  return {
    show: true,
    current: domain ? domain
      : bizDomain ? BIZ_DOMAIN_PREFIX + bizDomain
        : supportGroup ? SUPPORT_GROUP_PREFIX + supportGroup : "",
    kind,
    label,
    caption,
    stale,
    options,
    // "Everything in the register", not "All value chains": the row clears ALL THREE kinds, and
    // naming it after one of them describes a third of what it does. "In the register" rather
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
 * @param {{domain?: string, supportGroup?: string, bizDomain?: string}} active
 * @param {(pick: {kind: string, value: string}) => void} onPick  the chosen scope; a value
 *   chain, business domain or support group name, any of them "" for the whole register
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
    searchPlaceholder: "Search value chains, domains and support groups…",
    header: {
      title: "Scope",
      // Names all three kinds, because all three are in the list below it and they are not the
      // same question: a value chain is a rule someone wrote in Settings, a business domain is
      // a tag someone wrote in Wiz, and a support group is the team a subscription's tag names.
      // Naming only some of them would leave a reader to guess which heading they had picked
      // from — and the three can cut across each other, so guessing wrong is easy.
      note: "Every page answers for the value chain, business domain or support group you "
        + "pick. Executive always answers for the whole register.",
    },
    // The scope outlives the page you picked it on, so which row is in force is a standing
    // fact about the app rather than a highlight in an open menu — worth a mark of its own
    // rather than weight and colour alone.
    checkSelected: true,
    // The popover is portaled to <body>, so this class is the only way to reach inside it.
    popClass: "combobox-pop--scope",
    leading: el("span", { class: "scope-combo-icon", "aria-hidden": "true" },
      uiIcon(SCOPE_KIND_ICON[v.kind] || "folders", 14)),
    // The prefixes are the control's, not the caller's: onPick takes the three kinds apart so
    // the shell can send each to its own field, which is where "one at a time" is enforced.
    onChange: (picked) => {
      const s = String(picked || "");
      if (s.startsWith(SUPPORT_GROUP_PREFIX)) {
        onPick({ kind: "supportGroup", value: s.slice(SUPPORT_GROUP_PREFIX.length) });
      } else if (s.startsWith(BIZ_DOMAIN_PREFIX)) {
        onPick({ kind: "bizDomain", value: s.slice(BIZ_DOMAIN_PREFIX.length) });
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
