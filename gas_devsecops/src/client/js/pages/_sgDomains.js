// Support group → domain OVERRIDES, the client half: which groups an admin set by hand, the
// words for why, and the marker the pages draw beside such a group. Ported from the OS
// register's copy (gas/src/client/js/pages/_sgDomains.js); the reasons are the shared list
// (gas_shared/domain/sgDomainOverrides.ts) and test/sgDomains.test.js holds the two equal.
//
// A support group counts under ONE domain, normally the one most of its current repositories
// are tagged in (server/currentDomains.ts). An admin can override that, for one of two reasons,
// and the two read differently afterwards, so each carries its own marker:
//
//   wrong_tag   the vote was wrong — the repositories' tags are — and this corrects it.
//               Marker: "Domain set manually".
//   cross_team  the group sits in CROSS on purpose: the CROSS team runs its repositories. Without a
//               marker that reads like a mis-tag; with one it is a stated fact.
//               Marker: "Managed by CROSS team".
//
// The overrides ride on the boot payload (`boot.settings.supportGroupDomains`), and the domains
// one may pick on `boot.filterOptions.assignableDomains`; the save goes through
// `api_saveSupportGroupDomain`, admins only (server-checked).
//
// WHY `pages/`, NOT `ui/`: the reason `_groupSplit.js` gives — `shared.test.js` pins `ui/` to
// the register primitives, and this is one register's vocabulary.

import { el, statusPill } from "../ui.js";

/** gas_shared/domain/sgDomainOverrides.ts SG_DOMAIN_REASONS, with the words each one reads as. */
export const SG_REASONS = {
  wrong_tag: {
    label: "Wrong tag — correct the domain",
    badge: "Domain set manually",
    kind: "neutral",
  },
  cross_team: {
    label: "Managed by CROSS team",
    badge: "Managed by CROSS team",
    kind: "ok",
  },
};

/** The override for `group`, or null. */
export function sgOverrideOf(boot, group) {
  const items = (boot && boot.settings && boot.settings.supportGroupDomains
    && boot.settings.supportGroupDomains.items) || [];
  return items.find((o) => o && o.group === group) || null;
}

/** The domains an admin may set a group to — every domain a repository is tagged in today. This
 *  register has no Unassigned tail to exclude: "no domain" is an unset field, not a choice. */
export function assignableDomains(boot) {
  return ((boot && boot.filterOptions && boot.filterOptions.assignableDomains) || []).slice();
}

/** The words a marker's tip carries: the reason, the note, and who set it when. */
export function sgOverrideLines(o) {
  if (!o) return [];
  const reason = SG_REASONS[o.reason];
  const lines = [
    `${reason ? reason.badge : "Domain set manually"}: counted under ${o.domain} by an admin, `
      + "whatever its repositories are tagged.",
  ];
  if (o.note) lines.push(`Note: ${o.note}`);
  const who = [o.by, o.at ? String(o.at).slice(0, 10) : ""].filter(Boolean).join(", ");
  if (who) lines.push(`Set by ${who}.`);
  return lines;
}

/** The marker beside an overridden group — a pill with its tip — or null for none. */
export function sgOverrideBadge(o) {
  if (!o) return null;
  const reason = SG_REASONS[o.reason] || SG_REASONS.wrong_tag;
  return statusPill(reason.kind, reason.badge, sgOverrideLines(o));
}

/** A group's name with its marker beside it — the split table's group cell. */
export function groupWithBadge(name, o) {
  const badge = sgOverrideBadge(o);
  return badge ? el("span", { class: "sg-with-badge" }, name, " ", badge) : name;
}
