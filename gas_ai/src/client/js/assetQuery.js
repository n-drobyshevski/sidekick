// The browser's copy of src/domain/assetTable.ts — the filter predicate, the comparators
// and the facet counter, for the small-inventory path where the server ships every row
// once and never sees another filter change.
//
// It is a hand-kept mirror because the client bundle can't import the TS module. Two rules
// keep it honest:
//
//   1. Same exported names, same argument order, same return shapes as the TS module. A
//      diff between the two files should read as a translation, not as two designs.
//   2. This module is DOM-free and imports nothing, so test/assetQueryMirror.test.ts can
//      load it under vitest and run one table of cases through both implementations. If
//      you add a dimension here or there and not in the other, that test fails — which is
//      the only real guard, since client JS is never typechecked.
//
// Keep in step with src/domain/assetTable.ts.

export const ASSET_SORTS = [
  "issues", "findings", "name", "kind", "cloud", "region", "severity", "combos",
];

export const DEFAULT_SORT_DIR = {
  issues: "desc", findings: "desc", severity: "desc", combos: "desc",
  name: "asc", kind: "asc", cloud: "asc", region: "asc",
};

export const FACET_KEYS = [
  "severities", "kinds", "clouds", "regions", "projects", "flags",
];

export const ASSET_FLAGS = ["combo", "guardrail", "agentic", "datafindings"];

// Mirrors SEVERITY_ORDER in src/domain/config.ts. The AARS level vocabulary is gone from
// this module with the facet that used it — the register filters on Wiz's issue severity.
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

const SEV_RANK = {};
SEVERITY_ORDER.forEach((sev, i) => {
  SEV_RANK[sev] = SEVERITY_ORDER.length - i;
});

function str(v) {
  return v === null || v === undefined ? "" : String(v);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sevRank(v) {
  const r = SEV_RANK[str(v).toUpperCase()];
  return r === undefined ? -1 : r;
}

function list(v) {
  const raw = Array.isArray(v) ? v : str(v).split(",");
  const out = [];
  for (const item of raw) {
    const s = str(item).trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

function listWithLegacy() {
  for (let i = 0; i < arguments.length; i++) {
    const parsed = list(arguments[i]);
    if (parsed.length) return parsed;
  }
  return [];
}

function keepValid(values, allowed) {
  return values.map((v) => v.toUpperCase()).filter((v) => allowed.indexOf(v) >= 0);
}

export function resolveAssetQuery(params) {
  const p = params || {};
  const sort = str(p.sort);
  const resolvedSort = ASSET_SORTS.indexOf(sort) >= 0 ? sort : "issues";
  const dir = str(p.dir).toLowerCase();
  const page = Number(p.page);
  const pageSize = Number(p.pageSize);

  // `aarsSeverities` / `aarsSeverity` / `band` are IGNORED, not remapped onto
  // `severities` — see resolveAssetQuery in src/domain/assetTable.ts for why the two
  // scales must not be aliased to each other.

  return {
    q: str(p.q).trim().toLowerCase(),
    severities: keepValid(listWithLegacy(p.severities, p.severity), SEVERITY_ORDER),
    kinds: listWithLegacy(p.kinds, p.kind),
    clouds: listWithLegacy(p.clouds, p.cloud),
    regions: listWithLegacy(p.regions, p.region),
    projects: listWithLegacy(p.projects, p.project),
    flags: list(p.flags).map((v) => v.toLowerCase()).filter((v) => ASSET_FLAGS.indexOf(v) >= 0),
    sort: resolvedSort,
    dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_SORT_DIR[resolvedSort],
    page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
    pageSize: Number.isFinite(pageSize) && pageSize >= 1
      ? Math.min(Math.floor(pageSize), 500)
      : 50,
  };
}

export function hasAssetFlag(row, flag) {
  if (flag === "combo") return num(row.combos) > 0;
  if (flag === "guardrail") return row.guardrailMissing === true;
  if (flag === "agentic") return row.agentic === true;
  if (flag === "datafindings") return num(row.dataFindings) > 0;
  return false;
}

function rowProjects(row) {
  return Array.isArray(row.projects) ? row.projects.map(str).filter(Boolean) : [];
}

export function matchesAssetQuery(row, q) {
  if (q.q && !str(row.name).toLowerCase().includes(q.q)) return false;
  if (q.kinds.length && q.kinds.indexOf(str(row.kind)) < 0) return false;
  if (q.clouds.length && q.clouds.indexOf(str(row.cloud)) < 0) return false;
  if (q.regions.length && q.regions.indexOf(str(row.region)) < 0) return false;
  if (q.severities.length && q.severities.indexOf(str(row.severity)) < 0) return false;
  if (q.projects.length) {
    const mine = rowProjects(row);
    if (!q.projects.some((p) => mine.indexOf(p) >= 0)) return false;
  }
  // AND, not OR — see ASSET_FLAGS in src/domain/assetTable.ts.
  if (q.flags.length && !q.flags.every((f) => hasAssetFlag(row, f))) return false;
  return true;
}

export function filterAssetRows(rows, q) {
  return rows.filter((r) => matchesAssetQuery(r, q));
}

const PRIMARY = {
  name: (a, b) => str(a.name).localeCompare(str(b.name)),
  kind: (a, b) => str(a.kind).localeCompare(str(b.kind)),
  cloud: (a, b) => str(a.cloud).localeCompare(str(b.cloud)),
  region: (a, b) => str(a.region).localeCompare(str(b.region)),
  severity: (a, b) => sevRank(a.severity) - sevRank(b.severity),
  combos: (a, b) => num(a.combos) - num(b.combos),
  issues: (a, b) => num(a.openIssues) - num(b.openIssues),
  findings: (a, b) => num(a.openFindings) - num(b.openFindings),
};

/** Mirrors `byRiskDesc` in src/domain/assetTable.ts — see there for why severity leads. */
const byRiskDesc = (a, b) =>
  sevRank(b.severity) - sevRank(a.severity)
  || num(b.openIssues) - num(a.openIssues)
  || num(b.openFindings) - num(a.openFindings)
  || str(a.name).localeCompare(str(b.name))
  || str(a.id).localeCompare(str(b.id));

export function assetComparator(sort, dir) {
  const primary = PRIMARY[sort] || PRIMARY.issues;
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => sign * primary(a, b) || byRiskDesc(a, b);
}

export const ASSET_COMPARATORS = ASSET_SORTS.reduce((acc, s) => {
  acc[s] = assetComparator(s, DEFAULT_SORT_DIR[s]);
  return acc;
}, {});

export function sortAssetRows(rows, sort, dir) {
  const resolved = ASSET_SORTS.indexOf(sort) >= 0 ? sort : "issues";
  return rows.slice().sort(assetComparator(resolved, dir || DEFAULT_SORT_DIR[resolved]));
}

function facetValues(key, row) {
  if (key === "kinds") return [str(row.kind)].filter(Boolean);
  if (key === "clouds") return [str(row.cloud)].filter(Boolean);
  if (key === "regions") return [str(row.region)].filter(Boolean);
  if (key === "severities") return [str(row.severity)].filter(Boolean);
  if (key === "projects") return rowProjects(row);
  return ASSET_FLAGS.filter((f) => hasAssetFlag(row, f));
}

function facetSorter(key) {
  if (key === "severities") {
    return (a, b) => SEVERITY_ORDER.indexOf(a.value) - SEVERITY_ORDER.indexOf(b.value);
  }
  if (key === "flags") {
    return (a, b) => ASSET_FLAGS.indexOf(a.value) - ASSET_FLAGS.indexOf(b.value);
  }
  return (a, b) => a.value.localeCompare(b.value);
}

export function facetCounts(rows, q) {
  const out = { matched: 0 };
  for (const key of FACET_KEYS) {
    const scope = key === "flags" ? q : Object.assign({}, q, { [key]: [] });
    const counts = new Map();
    for (const row of rows) {
      if (!matchesAssetQuery(row, scope)) continue;
      for (const value of facetValues(key, row)) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    for (const value of q[key]) if (!counts.has(value)) counts.set(value, 0);
    out[key] = Array.from(counts, (entry) => ({ value: entry[0], count: entry[1] }))
      .sort(facetSorter(key));
  }
  out.matched = rows.reduce((n, row) => (matchesAssetQuery(row, q) ? n + 1 : n), 0);
  return out;
}

export function pageOf(rows, page, pageSize) {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
  return {
    rows: rows.slice(clamped * size, (clamped + 1) * size),
    page: clamped,
    pageCount,
  };
}
