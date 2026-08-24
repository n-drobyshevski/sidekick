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
    "linkage", "flags",
  ];
  for (const key of dims) {
    for (const value of q[key] || []) out.push({ key, value });
  }
  if (q.q) out.push({ key: "q", value: q.q });
  return out;
}
