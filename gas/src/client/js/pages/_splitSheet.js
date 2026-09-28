// The MTTR split's row sheet, the half of it that is not DOM: which findings a row stands for,
// how to ask the server for them, and the words the sheet puts round them.
//
// A ROW OF THE SPLIT IS A POPULATION, AND THE SHEET HAS TO OPEN ON EXACTLY IT. The split's
// dimension follows the header scope (`mttr.js` `renderByDomain`): per domain unscoped, per
// support group inside a domain, per asset inside a support group. So a row is always "this
// bucket, INSIDE the scope the table was drawn under" — and both requests below carry that
// scope as well as the bucket. The case that makes it matter is the support group: a group can
// span domains, the row only counted its part inside the selected one, and a sheet asking for
// the group alone would list findings from domains the header says are not on screen.
//
// TWO SPELLINGS OF "NO VALUE". The split names the rows with no support group, or no asset
// name, "(none)" (`api.ts` NONE_BUCKET) and `api_getMttrGroup` takes that label as-is. The
// register's group filter names the same rows `NONE_GROUP` (`gas_shared/domain/rowGroups.ts`),
// which the client bundle cannot import from TypeScript — so both are copied here, and
// `test/splitSheet.test.js` holds the copies to their sources. "Unassigned" and "Not
// attributable" are real `domain` values on a register row and pass through unchanged.
//
// WHY `pages/`, NOT `ui/`: the reason `_groupSplit.js` gives — `shared.test.js` pins `ui/` to
// the register primitives, and this is one section's vocabulary.

/** `gas_shared/domain/rowGroups.ts` NONE_GROUP — the register's key for a missing value. */
export const NONE_GROUP = "\u0000none";
/** `server/api.ts` NONE_BUCKET — the split's label for the same rows. */
export const SPLIT_NONE = "(none)";
/** `domain/domainRules.ts` UNASSIGNED and `domain/resolveDomain.ts` NOT_ATTRIBUTABLE. */
export const UNASSIGNED = "Unassigned";
export const NOT_ATTRIBUTABLE = "Not attributable";

/** The register column each dimension's bucket lives in. */
const REGISTER_COLUMN = { domain: "domain", supportGroup: "support_group", asset: "asset_name" };

/** A split row's own label, whichever payload shape it arrived in (`r.domain` is the older). */
export function splitGroupOf(row) {
  return String((row && (row.group ?? row.domain)) ?? "");
}

/**
 * The two requests behind one row's sheet.
 *
 * `scope` is the page's header scope (`{domain, supportGroup}`, "" for none), `severities` the
 * page's `scopeParam()` (null = every severity). The header scope rides UNCHANGED on both, so
 * the row is narrowed inside it — never widened past it. `register` carries no paging or sort;
 * the sheet's own state adds those.
 *
 * @param {"domain"|"supportGroup"|"asset"} dimension  the payload's `dimension`
 */
export function splitSheetRequests(dimension, row, scope, severities) {
  const dim = REGISTER_COLUMN[dimension] ? dimension : "domain";
  const group = splitGroupOf(row);
  const base = {
    domain: (scope && scope.domain) || "",
    supportGroup: (scope && scope.supportGroup) || "",
    severities: severities || null,
  };
  // "(none)" is a bucket of the two dimensions that HAVE one; a domain literally named
  // "(none)" is a name, and goes through as one.
  const noneBucket = dim !== "domain" && group === SPLIT_NONE;
  return {
    mttr: { ...base, groupBy: dim, groupValue: group },
    register: {
      ...base,
      groupBy: REGISTER_COLUMN[dim],
      groupValue: noneBucket ? NONE_GROUP : group,
    },
  };
}

/**
 * Where the findings list opens: the OPEN backlog, oldest first — the register's own default,
 * and the question a reader drilling into a slow group asks first. A row with nothing open
 * (Not attributable is resolved history by construction) opens on RESOLVED, slowest fix first,
 * because an open list that is empty by definition is a dead end rather than an answer.
 */
export function splitSheetDefaults(row) {
  const open = Number(row && row.open) || 0;
  return open > 0
    ? { status: "open", sort: "age_days", dir: "desc" }
    : { status: "resolved", sort: "mttr_days", dir: "desc" };
}

/** The sort a status change lands on — each list's own clock, longest first. */
export function splitSheetSortFor(status) {
  if (status === "resolved") return { sort: "mttr_days", dir: "desc" };
  return { sort: "age_days", dir: "desc" };
}

/**
 * The findings table's columns for this dimension and status, as `_findingColumns.js` keys.
 * A column that restates the row is dropped — every finding under a support-group row has that
 * support group — and the two clocks follow the status: an open finding has an Age and no
 * time-to-fix, a resolved one the reverse.
 */
export function splitSheetColumnKeys(dimension, status) {
  const keys = ["severity", "cve", "risk_tier"];
  if (dimension !== "asset") keys.push("asset_name");
  if (dimension === "domain") keys.push("support_group");
  keys.push("awaiting_vendor_fix");
  if (status === "open") keys.push("first_seen", "age_days");
  else if (status === "resolved") keys.push("resolved_at", "mttr_days");
  else keys.push("age_days", "mttr_days");
  keys.push("status", "portal_url");
  return keys;
}

/** The dimension's noun, for the words below. */
const NOUN = { domain: "Domain", supportGroup: "Support group", asset: "Asset" };

/** The row button's accessible name — what a screen reader hears on the table row. */
export function splitRowLabel(dimension, row) {
  const noun = (NOUN[dimension] || NOUN.domain).toLowerCase();
  return `${splitGroupOf(row) || "Unnamed"}, ${noun}, open remediation and findings`;
}

/**
 * The sheet's subtitle: what kind of bucket this is, and the scope it was drawn INSIDE. The
 * scope is on the surface rather than implied because it changes the numbers — the same
 * support group reads differently in two domains.
 */
export function splitSheetSubtitle(dimension, scope, severities) {
  const parts = [NOUN[dimension] || NOUN.domain];
  if (dimension === "supportGroup" && scope && scope.domain) {
    parts.push(`its findings in domain ${scope.domain}`);
  } else if (dimension === "asset" && scope && scope.supportGroup) {
    parts.push(`in support group ${scope.supportGroup}`);
  }
  if (Array.isArray(severities) && severities.length) {
    parts.push(`${severities.join(", ")} only`);
  }
  return parts.join(" · ");
}

/**
 * One sentence for a bucket that is not a real owner — or null for one that is. On the sheet's
 * surface, never in a tip (DESIGN.md §6): it says what population the sheet is about.
 */
export function splitBucketNote(dimension, group) {
  if (dimension === "domain" && group === UNASSIGNED) {
    return "No Wiz/Domain tag and no manual rule matched these findings — this is the "
      + "attribution gap, not a team.";
  }
  if (dimension === "domain" && group === NOT_ATTRIBUTABLE) {
    return "Resolved history with no attribution input left — compacted episodes and imported "
      + "rows. Nothing here is open, so the list opens on Resolved.";
  }
  if (dimension === "supportGroup" && group === SPLIT_NONE) {
    return "Findings whose subscription maps to no support group.";
  }
  if (dimension === "asset" && group === SPLIT_NONE) {
    return "Findings whose asset carries no name.";
  }
  return null;
}

/**
 * The sentence for an open list whose total disagrees with the row it was opened from — or
 * null when they agree. The two counts come from one population through two paths (the row
 * counts `resolved_at`, the register `status`), and `reconcile` keeps those in step; this is
 * the honest line for the day it does not, rather than a list quietly shorter than its row.
 */
export function splitCountNote(row, total, status) {
  if (status !== "open" || typeof total !== "number") return null;
  const open = Number(row && row.open);
  if (!Number.isFinite(open) || open === total) return null;
  return `The row above counts ${open.toLocaleString()} open; the register lists `
    + `${total.toLocaleString()} for the same group.`;
}

/**
 * How a finding's domain was decided — `resolveDomain`'s `source`, in words. The two that
 * name a mechanism say where the fix lives: a tag on the asset in Wiz, or a rule in Settings.
 */
export function domainSourceLabel(source) {
  switch (source) {
    case "tag": return "Wiz/Domain tag";
    case "rule": return "manual rule";
    case "none": return "no tag or rule matched";
    case "missing": return "no attribution input";
    default: return String(source || "");
  }
}

/**
 * The Domains section's lead — where this row's findings are COUNTED, and why the table under
 * it can list more than one domain. A support group is pinned to the one domain most of its
 * current hosts sit in (server/currentDomains.ts), and every finding it carries counts there;
 * the table is where those hosts actually sit today, which is the vote the pin came from.
 * `pinned` is null for a row no support group decides ("(none)", a domain row). Null when
 * there is nothing to describe.
 */
export function splitDomainsLead(dimension, group, domains, pinned) {
  const names = [...new Set((domains || []).map((d) => d.domain))];
  if (!names.length) return null;
  const who = group || "This " + ((NOUN[dimension] || NOUN.domain).toLowerCase());
  if (pinned) {
    const why = dimension === "asset"
      ? `the domain its support group is pinned to`
      : `the domain most of its current assets are in`;
    if (names.length === 1 && names[0] === pinned) {
      return `${who} counts under ${pinned}, where all of its assets are today.`;
    }
    return `${who} counts under ${pinned} — ${why}. Every finding it carries is measured there, `
      + `although its assets sit in ${names.length === 1 ? names[0] : names.length + " domains"} today.`;
  }
  if (names.length === 1) return `All of ${who}'s findings count under ${names[0]}, their assets' current domain.`;
  return `${who}'s findings count under ${names.length} domains — each under its asset's current `
    + "domain: the Wiz/Domain tag of its newest sighting first, else a manual rule.";
}

/** The Domains table's rows, the domain the row is counted under marked `counted`. */
export function splitDomainsRows(domains, pinned) {
  return (domains || []).map((d) => ({
    ...d,
    sourceLabel: domainSourceLabel(d.source),
    counted: Boolean(pinned) && d.domain === pinned,
  }));
}

/** The asset cell's text: the names shipped, then how many more the row carries. */
export function splitDomainAssetsText(d) {
  const names = Array.isArray(d && d.assets) ? d.assets : [];
  const more = Math.max(0, (Number(d && d.assetCount) || 0) - names.length);
  return names.join(", ") + (more ? ` +${more} more` : "");
}

/** The folded Domains section's summary: where the row counts, and how spread its hosts are. */
export function splitDomainsHint(domains, pinned) {
  const names = [...new Set((domains || []).map((d) => d.domain))];
  if (pinned) {
    return names.length > 1 ? `counted under ${pinned} · assets in ${names.length} domains`
      : `counted under ${pinned}`;
  }
  if (!names.length) return "";
  return names.length === 1 ? `1 domain: ${names[0]}` : `${names.length} domains`;
}
