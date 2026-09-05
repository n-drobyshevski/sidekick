// WHICH SLICES THIS REGISTER HAS, and what each one has to admit about itself.
//
// What is left of `scopeSwitch.js` (363 lines, deleted) after the control itself moved to
// `gas_shared/ui/scopeControl.js` and the assembly to `gas_shared/ui/scopeModel.js`. Those
// two are the same in all three sidekicks — one appbar combobox, option groups, prefixed
// values, one caption, one reset row — and were three copies of each other. THIS file is the
// part that never generalised: an OS-vulnerability register's own vocabulary.
//
// TWO DIMENSIONS, ONE CONTROL, ONE AT A TIME. Manual group and support group were separate
// comboboxes that could both be live, and their intersection was expressible. It is not any
// more, deliberately: a header that carries "the scope" cannot carry two of them and still
// answer "what am I looking at" in one line. `scopeModel.js` enforces it structurally now —
// one active `{kind, id}`, and picking anything replaces it — where this file used to enforce
// it by clearing the other field in `app.js`.
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
// and every cache key for no visible gain. It is also why `payload()` below emits exactly
// `{domain, supportGroup}`: that object IS what `app.js`'s `activeScope()` has always handed
// every page, and the `registerScopeContract` block in `test/shared.test.js` pins it against
// the deleted implementation.
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

import { scopeView } from "../../../../gas_shared/ui/scopeModel.js";

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
 * ONE OF THEM HAS TO, or a domain and a support group both named `Payments` are one row in the
 * list and one value on the wire. `scopeModel.js` allows exactly one BARE kind per register
 * for this reason and refuses a second — the domain is gas's, as it has always been, so every
 * value this control emits is byte-identical to the deleted implementation's and a stored
 * scope survives the swap.
 *
 * Exported with the trailing colon still spelled at the call sites that compare against it,
 * because that is what `test/scopeSwitchView.test.js` reads.
 */
export const SUPPORT_GROUP_PREFIX = "sg:";
const SUPPORT_GROUP_KIND_PREFIX = "sg";

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
export function domainScopeOptions(names, counts, notAttributable, unassignedBase) {
  return (names || []).map((name) => {
    if (name === NOT_ATTRIBUTABLE) {
      return {
        id: name,
        label: name,
        hint: `No attribution input · ${nf.format(notAttributable || 0)} resolved`,
        group: "Domains",
        icon: "noTag",
      };
    }
    return {
      id: name,
      label: name,
      // Declared in words rather than by glyph: the two kinds mean different things — a domain
      // owns the resource, a support group runs the subscription — and that is a meaning, so it
      // does not travel by mark alone.
      // `Unassigned` is the second bucket whose frame count can understate it. The frame is
      // the current scan; a lifecycle whose tag snapshot predates a tagging rollout and that
      // Wiz no longer re-lists lives in the ledger only — and the MTTR by-domain split, which
      // reads the ledger, will draw it. So when the frame says none and the ledger does not,
      // the hint says so rather than offering a scope that looks empty and is not.
      hint: name === UNASSIGNED && !((counts && counts[UNASSIGNED]) || 0) && unassignedBase
        ? `No domain · none open · ${nf.format(unassignedBase)} in history`
        : (name === UNASSIGNED ? "No domain · " : "Domain · ")
          + findingCount((counts && counts[name]) || 0),
      group: "Domains",
      icon: name === UNASSIGNED ? "noTag" : "tag",
    };
  });
}

/** The support groups on offer, as switcher rows. */
export function supportScopeOptions(names, counts) {
  return (names || []).map((name) => ({
    id: name,
    label: name,
    hint: `Support group · ${findingCount((counts && counts[name]) || 0)}`,
    group: "Support groups",
    icon: "users",
  }));
}

/**
 * Everything the two kinds need from the bootstrap payload, derived once.
 *
 * The gates live here rather than inside each `options()` because they are shared: whether the
 * control appears at all depends on both lists, and the two tail rows are dropped by rules
 * that read counts neither kind owns.
 */
function facts(data) {
  const counts = (data && data.scopeCounts) || null;
  const register = counts ? counts.register : 0;
  // Over BASE ROWS, not the frame — see `domainScopeOptions`.
  const notAttributable = (counts && counts.notAttributable) || 0;
  // Likewise. Zero on a register whose ledger holds no unclaimed lifecycles; non-zero exactly
  // when the MTTR by-domain split has an Unassigned bar to draw.
  const unassignedBase = (counts && counts.unassignedBase) || 0;

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

  return { counts, register, notAttributable, unassignedBase, domains, groups };
}

/**
 * The scoped caption, which both kinds share the skeleton of and neither shares the clauses.
 *
 * THE DENOMINATOR TRAVELS WITH THE NUMBER. "1,204" alone cannot tell a small domain from a
 * small register, and those two call for opposite reactions.
 *
 * AND A SCOPED CAPTION CARRIES A SECOND FIGURE, because leaving it off would be the more
 * comfortable lie. Under a domain, `unassigned` is how many findings NEITHER mechanism
 * claimed; under a support group, `noSupportGroup` is how many carry no group at all. Without
 * it, "1,204 of 8,331" quietly attributes the other 7,127 to some other domain or group, when
 * the truth for most of them is that nobody said.
 */
function scopedCaption(kind, name, data, stale) {
  const f = facts(data);
  if (stale) return `Not in this register — showing 0 of ${nf.format(f.register)}`;

  const shown = kind === "domain"
    ? ((f.counts && f.counts.domains && f.counts.domains[name]) || 0)
    : ((f.counts && f.counts.supportGroups && f.counts.supportGroups[name]) || 0);

  if (kind === "domain" && name === NOT_ATTRIBUTABLE) {
    // The one scope whose figure cannot come from the frame. Stating the zero rather than
    // hiding it: an operator who picks this row and finds every open-findings page empty should
    // read why on the control they picked it from, not conclude the app is broken.
    return `0 open findings · ${nf.format(f.notAttributable)} resolved with no attribution input`;
  }
  if (kind === "domain" && name === UNASSIGNED) {
    // The second figure would be the first one again — these ARE the unassigned findings. It
    // is dropped rather than restated: a caption that says the same number twice reads as a
    // bug, and invites the reader to look for the difference between them.
    //
    // The ledger figure is the exception, and only when it disagrees. `shown` counts the
    // current scan; the by-domain MTTR split counts every lifecycle the register holds. An
    // operator who has just fixed their tagging sees the frame go to zero while the split
    // keeps an Unassigned bar over resolved history Wiz no longer re-lists — and with only
    // the frame number on the control, nothing on screen explains the difference.
    let caption = `${nf.format(shown)} of ${nf.format(f.register)} findings · `
      + "claimed by no tag and no rule";
    if (f.unassignedBase > shown) {
      caption += ` · ${nf.format(f.unassignedBase)} across all history`;
    }
    return caption;
  }
  if (kind === "domain") {
    return `${nf.format(shown)} of ${nf.format(f.register)} findings · `
      + `${nf.format((f.counts && f.counts.unassigned) || 0)} unassigned`;
  }
  return `${nf.format(shown)} of ${nf.format(f.register)} findings · `
    + `${nf.format((f.counts && f.counts.noSupportGroup) || 0)} carry no support group`;
}

/** A stored scope naming something the register no longer holds, per kind. */
function scopedLabel(opt, name, stale) {
  if (!name) return "the whole register";
  return stale ? `${name} — not in this register` : (opt ? opt.label : name);
}

/**
 * The two dimensions, as `gas_shared/ui/scopeModel.js` takes them.
 *
 * `data` is closed over because every one of these functions needs the bootstrap payload and
 * threading it through four signatures bought nothing.
 */
export function scopeKinds(data) {
  const f = facts(data);
  return [
    {
      key: "domain",
      // Bare — see SUPPORT_GROUP_PREFIX above.
      prefix: "",
      // The domain's mark is a TAG rather than the funnel the manual-group filter used to
      // carry: the tag is now the principal mechanism, and a funnel described the fallback.
      icon: "tag",
      options: () => domainScopeOptions(
        f.domains, f.counts && f.counts.domains, f.notAttributable, f.unassignedBase,
      ),
      label: (opt, d, ctx) => scopedLabel(opt, ctx.id, ctx.stale),
      caption: (opt, d, ctx) => scopedCaption("domain", ctx.id, d, ctx.stale),
      // EXACTLY WHAT `activeScope()` HAS ALWAYS HANDED EVERY PAGE. Both fields, always, so
      // "one at a time" is structural rather than a rule two call sites have to remember.
      payload: (id) => ({ domain: id, supportGroup: "" }),
    },
    {
      key: "supportGroup",
      prefix: SUPPORT_GROUP_KIND_PREFIX,
      // Two figures: the dimension is a team, not a filter.
      icon: "users",
      options: () => supportScopeOptions(f.groups, f.counts && f.counts.supportGroups),
      label: (opt, d, ctx) => scopedLabel(opt, ctx.id, ctx.stale),
      caption: (opt, d, ctx) => scopedCaption("supportGroup", ctx.id, d, ctx.stale),
      payload: (id) => ({ domain: "", supportGroup: id }),
    },
  ];
}


/**
 * Everything the control asserts. The same `{show, current, kind, label, caption, stale,
 * options, pinned}` shape the deleted `scopeSwitchView` returned, so `test/scopeSwitchView
 * .test.js` still holds it unchanged: every emitted value is byte-identical to the deleted
 * implementation's, because the domain stayed the bare kind and the support group kept `sg:`.
 *
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 * @param {{domain?: string, supportGroup?: string}} active  what the shell currently holds —
 *   at most one of the two is ever set
 */
export function scopeSwitchView(data, active) {
  const a = active || {};
  const domain = a.domain || "";
  const supportGroup = a.supportGroup || "";
  const view = scopeView({
    kinds: scopeKinds(data),
    data,
    // EXACTLY ONE OF THE TWO IS EVER SET, and the shell has enforced that since the two
    // sidebar filters became one header control. Reading domain first is not a preference:
    // a payload carrying both is a defect upstream, and silently intersecting them here
    // would hide it.
    active: domain ? { kind: "domain", id: domain } : { kind: "supportGroup", id: supportGroup },
    chrome: scopeChrome(data),
  });
  // `current` is what the deleted implementation called the encoded active value.
  return { ...view, current: view.active };
}

/**
 * The parts of the control that are not a dimension.
 *
 * `show` is this register's own answer to "is there anything to slice by": nothing scanned,
 * boot failed, or neither dimension has more than one bucket. AN EMPTY PICKER IS A PROMISE THE
 * REGISTER CANNOT KEEP, and the rail's scan zone already says why it is empty.
 */
export function scopeChrome(data) {
  const f = facts(data);
  return {
    show: Boolean(f.counts && f.register && (f.domains.length || f.groups.length)),
    label: "the whole register",
    caption: () => {
      // THE UNSCOPED CAPTION CARRIES THE OTHER HALF OF THE STORY, and only when there is one.
      // Every scoped figure is about the live frame, where nothing can be `Not attributable`;
      // the historical charts are built from base rows, where it is a real bucket. Saying so
      // here — once, up front, and only when the count is non-zero — is what stops a reader
      // from meeting that bucket for the first time inside an MTTR breakdown with no idea
      // where it came from.
      let caption = `${findingCount(f.register)} in the register`;
      if (f.notAttributable > 0) {
        caption += ` · ${nf.format(f.notAttributable)} resolved with no attribution input`;
      }
      // Only when the ledger holds MORE than the live frame — otherwise the scoped caption
      // already carries it and repeating it here says nothing.
      if (f.unassignedBase > ((f.counts && f.counts.unassigned) || 0)) {
        caption += ` · ${nf.format(f.unassignedBase)} claimed by no tag or rule, including history`;
      }
      return caption;
    },
    // "Everything in the register", not "All domains": the row clears BOTH kinds, and naming
    // it after one of them describes half of what it does. "In the register" rather than a
    // bare "everything", because the register holds what the last scan was scoped to fetch and
    // this control cannot widen that.
    reset: {
      label: "Everything in the register",
      hint: () => findingCount(f.register),
      icon: "folders",
    },
    resetPayload: () => ({ domain: "", supportGroup: "" }),
    defaultLabel: "Everything in the register",
    // Without this the trigger prints the raw stored value under a heading that no longer
    // lists it, which reads as corruption rather than as a scope that has gone stale.
    fallbackLabel: "Not in this register",
    searchPlaceholder: "Search domains and support groups…",
    header: {
      title: "Scope",
      // Names both kinds, because both are in the list below it and they are not the same
      // question: a domain owns the resource, a support group is the team a subscription's tag
      // names. Naming only one would leave a reader to guess which heading they had picked
      // from — and the two cut across each other, so guessing wrong is easy.
      note: "Every page answers for the domain or support group you pick.",
    },
  };
}
