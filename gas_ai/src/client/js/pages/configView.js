// Pure view logic for the Cloud Configuration page — the filter predicate, the
// comparators and the hash-param reader, with no DOM anywhere in the file.
//
// It exists for the same reason pages/comboView.js does: config.js reads `document` and
// builds elements, so nothing in it can be unit-tested in this repo (no jsdom). The
// decisions worth testing therefore live here.
//
// It is also a MIRROR. src/domain/configFindings.ts runs the same predicate and the same
// comparators server-side for a register too large to ship whole; the client bundle
// cannot import a TS module, so the logic is written twice and test/configViewMirror.test.js
// asserts the two agree on a fixture set. Change one, change the other, or the test fails.

import { listSplit } from "../store.js";

export const CONFIG_SORTS = ["severity", "rule", "resource", "firstSeen", "status"];

/** Risk columns open worst-first; identity columns A→Z. Mirrors DEFAULT_CONFIG_SORT_DIR. */
export const CONFIG_SORT_DESC = {
  severity: true, firstSeen: true, rule: false, resource: false, status: false,
};

export const SEVERITY_RANK = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, UNKNOWN: 5,
};

/** Worst-first, matching SEVERITY_ORDER in src/domain/config.ts. */
export const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

export const LINKAGE_VALUES = ["linked", "unlinked"];
export const CONFIG_FLAGS = ["gap", "ignored", "iac"];

export const FLAG_LABELS = {
  gap: "Failing now",
  ignored: "Ignored",
  iac: "Traced to IaC",
};

export const LINKAGE_LABELS = {
  linked: "On an AI asset",
  unlinked: "Not on an AI asset",
};

function sevRank(s) {
  const r = SEVERITY_RANK[s];
  return r === undefined ? SEVERITY_RANK.UNKNOWN : r;
}


/** The filter state carried in the hash. Mirrors resolveConfigQuery. */
export function readConfigParams(params) {
  const p = params || {};
  return {
    q: String(p.q || "").trim().toLowerCase(),
    severities: listSplit(p.severities),
    statuses: listSplit(p.statuses),
    clouds: listSplit(p.clouds),
    resourceTypes: listSplit(p.resourceTypes),
    rules: listSplit(p.rules),
    projects: listSplit(p.projects),
    domains: listSplit(p.domains),
    linkage: listSplit(p.linkage).filter((v) => LINKAGE_VALUES.indexOf(v) >= 0),
    flags: listSplit(p.flags).filter((v) => CONFIG_FLAGS.indexOf(v) >= 0),
  };
}

export function hasConfigFlag(row, flag) {
  if (flag === "gap") return !!row.gap;
  if (flag === "ignored") return !!row.ignored;
  if (flag === "iac") return !!row.iac;
  return false;
}

function anyOf(selected, value) {
  return selected.length === 0 || selected.indexOf(value) >= 0;
}

/**
 * Values inside a dimension OR; dimensions AND — except `flags`, which ANDs inside itself.
 * "Failing AND ignored" is the triage question; "either" is not. Same exception, and the
 * same reasoning, as the inventory's risk-signal group.
 */
export function matchesConfigRow(row, q) {
  if (!anyOf(q.severities, row.severity)) return false;
  if (!anyOf(q.statuses, row.status)) return false;
  if (!anyOf(q.clouds, row.cloud)) return false;
  if (!anyOf(q.resourceTypes, row.resourceType)) return false;
  if (!anyOf(q.rules, row.ruleShortId)) return false;
  if (q.projects.length) {
    const projects = row.projects || [];
    let hit = false;
    for (let i = 0; i < projects.length; i++) {
      if (q.projects.indexOf(projects[i]) >= 0) { hit = true; break; }
    }
    if (!hit) return false;
  }
  if (q.domains.length && q.domains.indexOf(row.domain || "") < 0) return false;
  if (q.linkage.length && !anyOf(q.linkage, row.linked ? "linked" : "unlinked")) return false;
  for (let i = 0; i < q.flags.length; i++) {
    if (!hasConfigFlag(row, q.flags[i])) return false;
  }
  if (q.q) {
    const hay = [
      row.name, row.ruleShortId, row.ruleName, row.resourceName,
      row.resourceType, row.subscriptionName,
    ].join(" ").toLowerCase();
    if (hay.indexOf(q.q) < 0) return false;
  }
  return true;
}

export function applyConfigFilters(rows, q) {
  return (rows || []).filter((r) => matchesConfigRow(r, q));
}

/** Every comparator breaks ties on id, so a repaint never reshuffles equal rows. */
export function sortConfigRows(rows, sort, descending) {
  const dir = descending ? -1 : 1;
  return (rows || []).slice().sort((a, b) => {
    let cmp = 0;
    if (sort === "severity") cmp = sevRank(b.severity) - sevRank(a.severity);
    else if (sort === "rule") cmp = String(a.ruleShortId).localeCompare(String(b.ruleShortId));
    else if (sort === "resource") cmp = String(a.resourceName).localeCompare(String(b.resourceName));
    else if (sort === "status") cmp = String(a.status).localeCompare(String(b.status));
    else if (sort === "firstSeen") cmp = String(a.firstSeenAt).localeCompare(String(b.firstSeenAt));
    return cmp !== 0 ? cmp * dir : String(a.id).localeCompare(String(b.id));
  });
}

/**
 * How many rows each option would still leave, counted against every OTHER active
 * dimension but not its own — so the number answers "what does narrowing cost" rather
 * than showing 0 on everything you have not picked. Mirrors configFacetCounts.
 */
export function configFacetCounts(rows, q, keys) {
  const out = {};
  for (const key of keys) {
    const scope = key === "flags" ? q : Object.assign({}, q, { [key]: [] });
    const counts = new Map();
    for (const row of rows) {
      if (!matchesConfigRow(row, scope)) continue;
      for (const value of facetValues(key, row)) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    // A selected value that now matches nothing stays at 0 — otherwise the control you
    // would switch it off from vanishes the moment it stops matching.
    for (const value of q[key] || []) if (!counts.has(value)) counts.set(value, 0);
    out[key] = Array.from(counts, ([value, count]) => ({ value, count })).sort(facetSorter(key));
  }
  return out;
}

function facetValues(key, row) {
  if (key === "severities") return row.severity ? [row.severity] : [];
  if (key === "statuses") return row.status ? [row.status] : [];
  if (key === "clouds") return row.cloud ? [row.cloud] : [];
  if (key === "resourceTypes") return row.resourceType ? [row.resourceType] : [];
  if (key === "rules") return row.ruleShortId ? [row.ruleShortId] : [];
  if (key === "projects") return row.projects || [];
  // Blank contributes nothing — an unlinked finding has no domain to offer.
  if (key === "domains") return [row.domain].filter(Boolean);
  if (key === "linkage") return [row.linked ? "linked" : "unlinked"];
  return CONFIG_FLAGS.filter((f) => hasConfigFlag(row, f));
}

function facetSorter(key) {
  if (key === "severities") return (a, b) => sevRank(a.value) - sevRank(b.value);
  if (key === "flags") return (a, b) => CONFIG_FLAGS.indexOf(a.value) - CONFIG_FLAGS.indexOf(b.value);
  if (key === "linkage") {
    return (a, b) => LINKAGE_VALUES.indexOf(a.value) - LINKAGE_VALUES.indexOf(b.value);
  }
  return (a, b) => String(a.value).localeCompare(String(b.value));
}

/** Non-empty filter dimensions, for the "clear filters" affordance and the chip row. */
export function activeConfigFilters(q) {
  const out = [];
  const dims = [
    "severities", "statuses", "clouds", "resourceTypes", "rules", "projects",
    "domains", "linkage", "flags",
  ];
  for (const key of dims) {
    for (const value of q[key] || []) out.push({ key, value });
  }
  if (q.q) out.push({ key: "q", value: q.q });
  return out;
}

/**
 * What a scope costs this register, as a sentence — or null when it costs nothing.
 *
 * DOM-free like the rest of this module, because the WORDING is the decision. A scoped
 * register is shorter than an unscoped one for two unrelated reasons, and collapsing them
 * into one number would be the comfortable half-truth: some findings hang off an asset in
 * another project or domain, and some hang off no AI asset at all — one evaluated against a
 * region, an IAM policy, a service account no agent runs as. The second group can never be in
 * any view, which is a fact about this register rather than about the scope, and a reader who
 * is not told it will read a short list as a clean landscape.
 *
 * @param {{outOfView: number, register: number, unattributed: number}|null} loss
 * @param {{projectView?: string, domainView?: string}|null} scope
 */
export function configScopeLossView(loss, scope) {
  if (!loss || !loss.outOfView) return null;
  const nf = new Intl.NumberFormat();
  const noun = loss.register === 1 ? "finding" : "findings";
  const domain = (scope && scope.domainView) || "";

  // "7 of 7 are outside this view" is true and reads like an arithmetic error. When the scope
  // takes the whole register, say so as the fact it is — an empty table under a header with a
  // count of zero needs the sentence more than any other case, not a more awkward one.
  const lead = loss.outOfView < loss.register
    ? `${nf.format(loss.outOfView)} of ${nf.format(loss.register)} ${noun} are outside `
      + "this view."
    // A register of one has to be said differently again — "None of the 1 finding are in this
    // view" is the kind of small wrongness that makes a careful page look careless.
    : loss.register === 1 ? "The one finding on this register is not in this view."
      : `None of the ${nf.format(loss.register)} ${noun} are in this view.`;

  // The structural half, and it is a different sentence for each kind of scope: a project is
  // something a finding's own resource can carry, a domain is only ever joined from the AI
  // asset the finding names. Both end on the group that can be in NO view — the reason this
  // register is short is partly the scope and partly the register, and a reader owed one
  // number is owed both.
  const why = domain
    ? "A finding carries no tags of its own, so its domain is joined from the AI asset it "
      + "names."
    : "A finding evaluated against a region, an IAM policy or a service account belongs to "
      + "no project.";
  const orphans = loss.unattributed > 0
    ? ` ${nf.format(loss.unattributed)} ${loss.unattributed === 1 ? "names" : "name"} no AI `
      + "asset at all, and can be in no view."
    : "";

  return {
    tag: "Whole register",
    text: `${lead} ${why}${orphans} Clearing the scope brings them back.`,
  };
}
