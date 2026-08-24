// The Cloud Configuration register: turning stored FindingRows into the two things the
// page shows — a roll-up BY CONTROL and a flat list BY FINDING — plus the filter/sort/
// facet machinery both need. Pure and unit-tested here, like assetTable.ts, so the
// server and the browser cannot disagree about what a filtered page contains.
//
// Why by-control first. A configuration finding is one evaluation of one rule against one
// resource, so a single misconfiguration pattern arrives as N near-identical rows: in the
// sample tenant, one Bedrock confused-deputy rule fails on sixteen IAM roles with the same
// name, the same severity and the same remediation. Listing those sixteen answers "how
// many rows do I have"; grouping them answers "what is wrong", which is the question, and
// it is also the unit of work — one trust-policy fix pattern closes all sixteen.

import { isOpenGap, SEVERITY_ORDER, type Severity } from "./config";
import type { FindingRow } from "./graphTypes";
import { pageOf, type SortDir } from "./assetTable";
import { toStr as str, type Rec } from "./util";

export { pageOf };

export type ConfigSort = "severity" | "rule" | "resource" | "firstSeen" | "status";

export const CONFIG_SORTS: ConfigSort[] = [
  "severity", "rule", "resource", "firstSeen", "status",
];

/** Risk columns open worst-first; identity columns open A→Z. Same rule as the inventory. */
export const DEFAULT_CONFIG_SORT_DIR: Record<ConfigSort, SortDir> = {
  severity: "desc", firstSeen: "desc",
  rule: "asc", resource: "asc", status: "asc",
  // Phase 5: the problem tree's outcome, worst (ACT) first — same convention as severity.
};

export const CONFIG_PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_CONFIG_PAGE_SIZE = 50;
export const MAX_CONFIG_PAGE_SIZE = 500;

/**
 * Row ceiling for shipping the whole register in one payload, mirroring
 * assetTable.CLIENT_ALL_MAX. Lower than the inventory's 1500 because these rows carry
 * more text (rule names, resource ids, project lists), so the payload budget buys fewer
 * of them. Past it the client pages server-side.
 */
export const CONFIG_CLIENT_ALL_MAX = 1000;

export const CONFIG_FACET_KEYS = [
  "severities", "statuses", "clouds", "resourceTypes", "rules", "projects",
  "domains", "linkage", "flags",
] as const;
export type ConfigFacetKey = (typeof CONFIG_FACET_KEYS)[number];

/**
 * Whether the finding's resource is an AI asset this app actually holds. Its own
 * dimension rather than a flag because the two values are exhaustive and exclusive —
 * OR-ing them selects everything, which is what "no filter" already means, so ticking
 * both is harmless rather than contradictory.
 */
export const LINKAGE_VALUES = ["linked", "unlinked"] as const;

/**
 * Signals that AND inside themselves, following ASSET_FLAGS: "a failing control that is
 * also ignored" is a real triage question and "either" is not.
 *
 * - `gap`    the finding is a failing control right now (isOpenGap)
 * - `ignored` an ignore rule covers it — someone accepted this risk
 * - `iac`     Wiz traced it back to infrastructure-as-code, so there is a fix at source
 */
export const CONFIG_FLAGS = ["gap", "ignored", "iac"] as const;
export type ConfigFlag = (typeof CONFIG_FLAGS)[number];

/**
 * One register row. Deliberately slimmer than FindingRow: the rule description, the
 * remediation text and the Rego policy are the drill-down's job, and shipping them per
 * row would put the same multi-kilobyte document on the wire once per failing resource.
 */
export interface ConfigFindingView {
  id: string;
  name: string;
  severity: Severity;
  status: string;
  result: string;
  ruleShortId: string;
  ruleName: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  cloud: string;
  subscriptionName: string;
  projects: string[];
  businessImpact: string;
  firstSeenAt: string;
  analyzedAt: string;
  /** rule.risks — the Wiz risk taxonomy (AI_SECURITY, UNPROTECTED_DATA, …). */
  risks: string[];
  /** Derived, never stored: whether this resource is in the AI inventory. */
  linked: boolean;
  /**
   * The resource's owning business domain — joined from the AI inventory, not read off the
   * finding.
   *
   * `""` FOR AN UNLINKED FINDING, AND THAT IS NOT AN OVERSIGHT. `configurationFindings`
   * selects `resource { id name type status projects }` and no tags at all, so a finding
   * on a region, an IAM policy or a service account the AI graph does not model has no tag
   * source anywhere in the payload. Widening that selection is possible but not free:
   * CONFIG_FINDINGS is an optional step that swallows an HTTP 400, so a field the tenant
   * rejects would empty `ai_findings` and look exactly like a landscape with nothing to
   * report. The blank is the same fact the `linkage` dimension already publishes, said in
   * a second column rather than guessed at.
   */
  domain: string;
  ignored: boolean;
  iac: boolean;
  gap: boolean;
}

export interface ControlRollup {
  ruleShortId: string;
  ruleName: string;
  /** Worst severity across the control's findings — the same "worst wins" AARS applies. */
  severity: Severity;
  risks: string[];
  findings: number;
  gaps: number;
  /**
   * Distinct resources, and the three that a reader compares must be counted the same
   * way. `resources` is every resource the control was evaluated against; `gapResources`
   * is how many of those currently fail; `unlinkedGapResources` is how many of THOSE are
   * not AI assets. Counting failures in findings and the denominator in resources would
   * put two different units in adjacent table columns — "1 failing of 2 resources" reads
   * as a ratio whether or not it is one.
   */
  resources: number;
  gapResources: number;
  unlinkedGapResources: number;
  linked: number;
  unlinked: number;
  ignored: number;
  iac: number;
  clouds: string[];
  projects: string[];
  /**
   * The business domains this control's findings span — the by-control view's own
   * argument, at its own grain. "One trust-policy fix closes sixteen roles" is the
   * claim the grouping exists to make; saying which domains those sixteen belong to is
   * the same claim, and it is what tells one team's cleanup from a landscape-wide one.
   * Blank domains contribute nothing, so an all-unlinked control lists none.
   */
  domains: string[];
  severityMix: Record<string, number>;
  /** Earliest firstSeenAt across the control's findings — how long this has been true. */
  firstSeenAt: string;
}

export interface ConfigQuery {
  q: string;
  severities: string[];
  statuses: string[];
  clouds: string[];
  resourceTypes: string[];
  rules: string[];
  projects: string[];
  domains: string[];
  linkage: string[];
  flags: string[];
}

const sevRank = (s: string): number => {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s);
  return i < 0 ? SEVERITY_ORDER.length : i;
};

/** FindingRow + "is its resource in the inventory" → the row the register renders. */
export function toConfigView(f: FindingRow, linked: boolean, domain = ""): ConfigFindingView {
  return {
    id: f.id,
    name: f.name ?? f.ruleName ?? "",
    severity: (f.severity ?? "UNKNOWN") as Severity,
    status: f.status ?? "",
    result: f.result ?? "",
    ruleShortId: f.ruleShortId ?? "",
    ruleName: f.ruleName ?? "",
    resourceId: f.resourceId,
    resourceName: f.resourceName ?? "",
    resourceType: f.resourceType ?? "",
    cloud: f.cloudProvider ?? "",
    subscriptionName: f.subscriptionName ?? "",
    projects: (f.projects ?? []).map((p) => p.name).filter(Boolean),
    businessImpact: f.businessImpact ?? "",
    firstSeenAt: f.firstSeenAt ?? "",
    analyzedAt: f.analyzedAt ?? "",
    risks: f.risks ?? [],
    linked,
    domain,
    ignored: (f.ignoreRuleIds ?? []).length > 0,
    iac: (f.iacFindingIds ?? []).length > 0,
    gap: isOpenGap(f),
  };
}

/** Read a `?`-param list ("A,B") or an array, dropping blanks. */
function listParam(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = str(v);
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

export function resolveConfigQuery(params: Rec): ConfigQuery {
  return {
    q: (str(params["q"]) ?? "").trim().toLowerCase(),
    severities: listParam(params["severities"]),
    statuses: listParam(params["statuses"]),
    clouds: listParam(params["clouds"]),
    resourceTypes: listParam(params["resourceTypes"]),
    rules: listParam(params["rules"]),
    projects: listParam(params["projects"]),
    domains: listParam(params["domains"]),
    linkage: listParam(params["linkage"]).filter(
      (v) => (LINKAGE_VALUES as readonly string[]).indexOf(v) >= 0,
    ),
    flags: listParam(params["flags"]).filter(
      (v) => (CONFIG_FLAGS as readonly string[]).indexOf(v) >= 0,
    ),
  };
}

export function hasConfigFlag(row: ConfigFindingView, flag: string): boolean {
  if (flag === "gap") return row.gap;
  if (flag === "ignored") return row.ignored;
  if (flag === "iac") return row.iac;
  return false;
}

function anyOf(selected: string[], value: string): boolean {
  return selected.length === 0 || selected.indexOf(value) >= 0;
}

export function matchesConfigQuery(row: ConfigFindingView, q: ConfigQuery): boolean {
  if (!anyOf(q.severities, row.severity)) return false;
  if (!anyOf(q.statuses, row.status)) return false;
  if (!anyOf(q.clouds, row.cloud)) return false;
  if (!anyOf(q.resourceTypes, row.resourceType)) return false;
  if (!anyOf(q.rules, row.ruleShortId)) return false;
  if (q.projects.length && !row.projects.some((p) => q.projects.indexOf(p) >= 0)) return false;
  if (q.domains.length && q.domains.indexOf(row.domain) < 0) return false;
  if (q.linkage.length && !anyOf(q.linkage, row.linked ? "linked" : "unlinked")) return false;
  // ANDs inside itself, unlike every dimension above.
  for (const flag of q.flags) if (!hasConfigFlag(row, flag)) return false;
  if (q.q) {
    const hay = [
      row.name, row.ruleShortId, row.ruleName, row.resourceName,
      row.resourceType, row.subscriptionName,
    ].join(" ").toLowerCase();
    if (hay.indexOf(q.q) < 0) return false;
  }
  return true;
}

export function filterConfigRows(
  rows: ConfigFindingView[],
  q: ConfigQuery,
): ConfigFindingView[] {
  return rows.filter((r) => matchesConfigQuery(r, q));
}

type Cmp = (a: ConfigFindingView, b: ConfigFindingView) => number;

/**
 * Every comparator breaks ties on id. Sheets rewrites this tab wholesale each sync and
 * page 2 must not reshuffle because two findings share a severity.
 */
export function configComparator(sort: ConfigSort, dir?: SortDir): Cmp {
  const d = (dir ?? DEFAULT_CONFIG_SORT_DIR[sort]) === "asc" ? 1 : -1;
  const tie = (a: ConfigFindingView, b: ConfigFindingView) => a.id.localeCompare(b.id);
  return (a, b) => {
    let cmp = 0;
    if (sort === "severity") cmp = sevRank(b.severity) - sevRank(a.severity);
    else if (sort === "rule") cmp = a.ruleShortId.localeCompare(b.ruleShortId);
    else if (sort === "resource") cmp = a.resourceName.localeCompare(b.resourceName);
    else if (sort === "status") cmp = a.status.localeCompare(b.status);
    else if (sort === "firstSeen") cmp = a.firstSeenAt.localeCompare(b.firstSeenAt);
    return cmp !== 0 ? cmp * d : tie(a, b);
  };
}

export function sortConfigRows(
  rows: ConfigFindingView[],
  sort: ConfigSort,
  dir?: SortDir,
): ConfigFindingView[] {
  return rows.slice().sort(configComparator(sort, dir));
}

export interface ConfigFacetCount {
  value: string;
  count: number;
}
export type ConfigFacetCounts =
  Record<ConfigFacetKey, ConfigFacetCount[]> & { matched: number };

function facetValues(key: ConfigFacetKey, row: ConfigFindingView): string[] {
  if (key === "severities") return [row.severity].filter(Boolean);
  if (key === "statuses") return [row.status].filter(Boolean);
  if (key === "clouds") return [row.cloud].filter(Boolean);
  if (key === "resourceTypes") return [row.resourceType].filter(Boolean);
  if (key === "rules") return [row.ruleShortId].filter(Boolean);
  if (key === "projects") return row.projects;
  if (key === "domains") return [row.domain].filter(Boolean);
  if (key === "linkage") return [row.linked ? "linked" : "unlinked"];
  return CONFIG_FLAGS.filter((f) => hasConfigFlag(row, f)) as unknown as string[];
}

function facetSorter(key: ConfigFacetKey): (a: ConfigFacetCount, b: ConfigFacetCount) => number {
  if (key === "severities") return (a, b) => sevRank(a.value) - sevRank(b.value);
  if (key === "flags") {
    const order = CONFIG_FLAGS as readonly string[];
    return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
  }
  if (key === "linkage") {
    const order = LINKAGE_VALUES as readonly string[];
    return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
  }
  return (a, b) => a.value.localeCompare(b.value);
}

/**
 * How many rows each option would still leave, counted against every OTHER active
 * dimension but not its own — the same contract (and the same reasoning) as
 * assetTable.facetCounts. A selected value that now matches nothing stays on the list at
 * 0, or the control you would switch it off from disappears the moment it stops matching.
 */
export function configFacetCounts(
  rows: ConfigFindingView[],
  q: ConfigQuery,
): ConfigFacetCounts {
  const out = { matched: 0 } as ConfigFacetCounts;
  for (const key of CONFIG_FACET_KEYS) {
    // `flags` ANDs inside itself, so its options count against the FULL query.
    const scope: ConfigQuery = key === "flags" ? q : { ...q, [key]: [] };
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!matchesConfigQuery(row, scope)) continue;
      for (const value of facetValues(key, row)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    for (const value of q[key]) if (!counts.has(value)) counts.set(value, 0);
    out[key] = Array.from(counts, ([value, count]) => ({ value, count })).sort(facetSorter(key));
  }
  out.matched = rows.reduce((n, row) => (matchesConfigQuery(row, q) ? n + 1 : n), 0);
  return out;
}

/**
 * Findings grouped into the controls that produced them, worst control first.
 *
 * `resources` counts DISTINCT resource ids, not rows: a rule evaluated twice against the
 * same resource (two regions of one subscription can repeat an id in a malformed page) is
 * one thing failing, and a resource count that double-counts would overstate the blast
 * radius the page exists to show.
 */
export function rollupByControl(rows: ConfigFindingView[]): ControlRollup[] {
  const byRule = new Map<string, ConfigFindingView[]>();
  for (const row of rows) {
    const key = row.ruleShortId || row.ruleName || "—";
    const bucket = byRule.get(key);
    if (bucket) bucket.push(row);
    else byRule.set(key, [row]);
  }

  const out: ControlRollup[] = [];
  for (const [ruleShortId, group] of byRule) {
    const resources = new Set<string>();
    const gapResources = new Set<string>();
    const unlinkedGapResources = new Set<string>();
    const clouds = new Set<string>();
    const projects = new Set<string>();
    const domains = new Set<string>();
    const risks = new Set<string>();
    const severityMix: Record<string, number> = {};
    let worst = "UNKNOWN";
    let firstSeenAt = "";
    let gaps = 0;
    let linked = 0;
    let unlinked = 0;
    let ignored = 0;
    let iac = 0;

    for (const row of group) {
      resources.add(row.resourceId);
      if (row.cloud) clouds.add(row.cloud);
      for (const p of row.projects) projects.add(p);
      if (row.domain) domains.add(row.domain);
      for (const r of row.risks) risks.add(r);
      severityMix[row.severity] = (severityMix[row.severity] ?? 0) + 1;
      if (sevRank(row.severity) < sevRank(worst)) worst = row.severity;
      // Earliest wins: the control has been failing since its oldest finding appeared.
      if (row.firstSeenAt && (!firstSeenAt || row.firstSeenAt < firstSeenAt)) {
        firstSeenAt = row.firstSeenAt;
      }
      if (row.gap) {
        gaps += 1;
        gapResources.add(row.resourceId);
        if (!row.linked) unlinkedGapResources.add(row.resourceId);
      }
      if (row.linked) linked += 1;
      else unlinked += 1;
      if (row.ignored) ignored += 1;
      if (row.iac) iac += 1;
    }

    out.push({
      ruleShortId,
      ruleName: group[0].ruleName || group[0].name || "",
      severity: worst as Severity,
      risks: [...risks].sort(),
      findings: group.length,
      gaps,
      resources: resources.size,
      gapResources: gapResources.size,
      unlinkedGapResources: unlinkedGapResources.size,
      linked,
      unlinked,
      ignored,
      iac,
      clouds: [...clouds].sort(),
      projects: [...projects].sort(),
      domains: [...domains].sort(),
      severityMix,
      firstSeenAt,
    });
  }

  // Worst first, then the widest blast radius, then by id so the order is stable.
  return out.sort((a, b) =>
    sevRank(a.severity) - sevRank(b.severity)
    || b.gaps - a.gaps
    || b.resources - a.resources
    || a.ruleShortId.localeCompare(b.ruleShortId));
}

/** The register's headline counts, over the WHOLE set — never the page or the filter. */
export interface ConfigTotals {
  findings: number;
  gaps: number;
  controls: number;
  resources: number;
  unlinkedGaps: number;
  ignored: number;
  iac: number;
  severityMix: Record<string, number>;
}

export function configTotals(rows: ConfigFindingView[]): ConfigTotals {
  const controls = new Set<string>();
  const resources = new Set<string>();
  const severityMix: Record<string, number> = {};
  let gaps = 0;
  let unlinkedGaps = 0;
  let ignored = 0;
  let iac = 0;
  for (const row of rows) {
    if (row.ruleShortId) controls.add(row.ruleShortId);
    resources.add(row.resourceId);
    // The mix describes failing controls, not stored rows: counting resolved findings in
    // a severity bar would draw risk the landscape no longer carries.
    if (row.gap) {
      gaps += 1;
      severityMix[row.severity] = (severityMix[row.severity] ?? 0) + 1;
      if (!row.linked) unlinkedGaps += 1;
    }
    if (row.ignored) ignored += 1;
    if (row.iac) iac += 1;
  }
  return {
    findings: rows.length,
    gaps,
    controls: controls.size,
    resources: resources.size,
    unlinkedGaps,
    ignored,
    iac,
    severityMix,
  };
}
