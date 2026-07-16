// Attribution diagnostics for the "Attribution" SPA page: per-record rule tracing,
// mapping-rule health (fired vs matched under first-match-wins), domain coverage,
// unassigned-resource explorer rows, and untagged-subscription rollups.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over current-scan frame records: flat dotted keys
// (vulnerableAsset.name / .subscriptionName / .subscriptionExternalId / .tags.<k>)
// plus the server-attached _sev / _supportGroup / _domain. The engine mirrors
// domainRules.assignDomain's loop semantics exactly — including the "(compacted)"
// short-circuit — but traces every condition instead of short-circuiting on the
// first match, which is what makes the "why is this Unassigned?" views possible.

import {
  UNASSIGNED,
  conditionMatches,
  recordTags,
  type CompiledDomain,
  type CondSpec,
} from "./domainRules";
import { normalizeSeverity } from "./severity";
import { present, type Rec } from "./util";

// Ledger episodes surface with this placeholder asset name; assignDomain force-stays
// them Unassigned. Mirrored here so `assigned` agrees with assignDomain (the compiled
// COMPACTED_ASSET / LEDGER_NAME_COLS constants are module-private in domainRules).
const COMPACTED_ASSET = "(compacted)";

const NAME_COL = "vulnerableAsset.name";
const TYPE_COL = "vulnerableAsset.type";
const SUB_COL = "vulnerableAsset.subscriptionName";
const EXT_COL = "vulnerableAsset.subscriptionExternalId";
const SG_COL = "_supportGroup";
const DOMAIN_COL = "_domain";
const NONE = "(none)";

// Row/value caps for the unassigned-resource explorer payload (kept small so the
// cached blob stays cheap; see plan §2 payload-size note).
const MAX_TAG_KEYS = 12;
const MAX_TAG_VALUE_LEN = 80;
const MAX_NEAR_MISSES = 3;

// Human-readable failing-condition labels for near-miss hints ("failing: subscription").
const KIND_LABEL: Record<CondSpec["kind"], string> = {
  tag: "tag",
  regex: "name",
  sub: "subscription",
  sg: "support group",
};

// --- shared readers -------------------------------------------------------------

/** The server-attached domain, defaulting to Unassigned when absent. */
function domainOf(r: Rec): string {
  const v = r[DOMAIN_COL];
  return present(v) ? String(v) : UNASSIGNED;
}

/** Severity of a record — the _sev the frame carries, else normalized `severity`. */
function sevOf(r: Rec): string {
  const s = r["_sev"];
  return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
}

function addSev(counts: Record<string, number>, r: Rec): void {
  const s = sevOf(r);
  counts[s] = (counts[s] ?? 0) + 1;
}

/** A present dotted-key value as a string, else null. */
function flatVal(r: Rec, key: string): string | null {
  const v = r[key];
  return present(v) ? String(v) : null;
}

/** Asset identity — the same `vulnerableAsset.name` convention as insights.groupTree. */
function assetKey(r: Rec): string {
  return String(r[NAME_COL] ?? "");
}

/** Whether a record's ledger asset name marks it a compacted episode. */
function isCompacted(record: Rec): boolean {
  const v = record["asset_name"];
  if (present(v)) return String(v) === COMPACTED_ASSET;
  const va = record["vulnerableAsset"];
  if (va && typeof va === "object" && !Array.isArray(va)) {
    const leaf = (va as Rec)["asset_name"];
    if (present(leaf)) return String(leaf) === COMPACTED_ASSET;
  }
  return false;
}

// --- traceRecord ----------------------------------------------------------------

export interface ConditionTrace {
  index: number;
  matched: boolean;
}

export interface RuleTrace {
  domainIndex: number;
  domain: string;
  ruleIndex: number;
  malformed: boolean; // the compiled rule is null (fails closed, never matches)
  matched: boolean; // every condition matched (always false when malformed)
  conditions: ConditionTrace[]; // [] for a malformed rule
}

export interface RecordTrace {
  assigned: string; // === assignDomain(record, compiled)
  rules: RuleTrace[];
}

/**
 * Evaluate every condition of every rule against a single record. `assigned` mirrors
 * assignDomain (first domain with a fully-matching rule wins; compacted episodes force
 * Unassigned), while `rules` keeps the full per-condition breakdown the UI needs to
 * explain a non-match. recordTags is resolved once, exactly like assignDomain.
 */
export function traceRecord(record: Rec, compiled: CompiledDomain[]): RecordTrace {
  const tags = recordTags(record);
  const compacted = isCompacted(record);
  const rules: RuleTrace[] = [];
  let assigned = UNASSIGNED;
  compiled.forEach((dom, domainIndex) => {
    dom.rules.forEach((rule, ruleIndex) => {
      if (rule === null) {
        rules.push({ domainIndex, domain: dom.name, ruleIndex, malformed: true, matched: false, conditions: [] });
        return;
      }
      const conditions = rule.map((spec, index) => ({ index, matched: conditionMatches(spec, record, tags) }));
      const matched = conditions.every((c) => c.matched);
      rules.push({ domainIndex, domain: dom.name, ruleIndex, malformed: false, matched, conditions });
      if (matched && !compacted && assigned === UNASSIGNED) assigned = dom.name;
    });
  });
  return { assigned, rules };
}

// --- ruleHealth -----------------------------------------------------------------

export type RuleStatus = "ok" | "shadowed" | "dead" | "malformed";

export interface RuleHealth {
  domainIndex: number;
  domain: string;
  ruleIndex: number;
  fired: number; // records this rule actually claimed under first-match-wins
  matched: number; // records this rule matches ignoring priority
  status: RuleStatus;
}

/**
 * Per-rule fired-vs-matched health over the whole scan. `matched` counts every record
 * whose conditions the rule satisfies (priority ignored); `fired` credits, per record,
 * the first matching rule of the winning domain — so a rule shadowed by an earlier
 * domain, or by an earlier rule in its own domain, shows matched > 0 but fired 0.
 * status: malformed (null rule) > dead (matched 0) > shadowed (fired 0) > ok.
 */
export function ruleHealth(records: Rec[], compiled: CompiledDomain[]): RuleHealth[] {
  const stats = compiled.map((dom) => dom.rules.map(() => ({ fired: 0, matched: 0 })));
  for (const record of records) {
    const trace = traceRecord(record, compiled);
    for (const rt of trace.rules) {
      if (rt.matched) stats[rt.domainIndex][rt.ruleIndex].matched += 1;
    }
    if (trace.assigned !== UNASSIGNED) {
      // First matching rule in trace order is the first rule of the winning domain.
      const winner = trace.rules.find((rt) => rt.matched && rt.domain === trace.assigned);
      if (winner) stats[winner.domainIndex][winner.ruleIndex].fired += 1;
    }
  }
  const out: RuleHealth[] = [];
  compiled.forEach((dom, domainIndex) => {
    dom.rules.forEach((rule, ruleIndex) => {
      const { fired, matched } = stats[domainIndex][ruleIndex];
      const status: RuleStatus =
        rule === null ? "malformed" : matched === 0 ? "dead" : fired === 0 ? "shadowed" : "ok";
      out.push({ domainIndex, domain: dom.name, ruleIndex, fired, matched, status });
    });
  });
  return out;
}

// --- coverage -------------------------------------------------------------------

export interface CoverageDomain {
  domain: string;
  findings: number;
  assets: number; // distinct affected assets
}

export interface Coverage {
  totalFindings: number;
  totalAssets: number;
  attributedFindings: number;
  attributedAssets: number;
  unassignedFindings: number;
  unassignedAssets: number;
  supportGroupResolved: number; // findings with _supportGroup present
  supportGroupUnresolved: number; // findings lacking _supportGroup
  byDomain: CoverageDomain[]; // priority order, zero-count domains kept, Unassigned last
}

/** Priority-ordered names deduped with Unassigned forced to the end exactly once. */
function orderedWithUnassignedLast(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (n === UNASSIGNED || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.push(UNASSIGNED);
  return out;
}

/**
 * Register-wide coverage: findings and distinct assets attributed vs Unassigned, the
 * per-domain breakdown in priority order (including domains with zero matches so the
 * table shows dead domains), and the support-group resolved/unresolved split. Reads the
 * pre-attached _domain / _supportGroup; asset identity is `vulnerableAsset.name`.
 */
export function coverage(records: Rec[], orderedDomainNames: string[]): Coverage {
  const findingsByDomain = new Map<string, number>();
  const assetsByDomain = new Map<string, Set<string>>();
  const allAssets = new Set<string>();
  const attributedAssets = new Set<string>();
  const unassignedAssets = new Set<string>();
  let attributedFindings = 0;
  let unassignedFindings = 0;
  let sgResolved = 0;
  let sgUnresolved = 0;
  for (const r of records) {
    const domain = domainOf(r);
    const asset = assetKey(r);
    findingsByDomain.set(domain, (findingsByDomain.get(domain) ?? 0) + 1);
    let set = assetsByDomain.get(domain);
    if (!set) assetsByDomain.set(domain, (set = new Set()));
    if (asset) {
      set.add(asset);
      allAssets.add(asset);
    }
    if (domain === UNASSIGNED) {
      unassignedFindings += 1;
      if (asset) unassignedAssets.add(asset);
    } else {
      attributedFindings += 1;
      if (asset) attributedAssets.add(asset);
    }
    if (present(r[SG_COL])) sgResolved += 1;
    else sgUnresolved += 1;
  }
  const byDomain = orderedWithUnassignedLast(orderedDomainNames).map((domain) => ({
    domain,
    findings: findingsByDomain.get(domain) ?? 0,
    assets: assetsByDomain.get(domain)?.size ?? 0,
  }));
  return {
    totalFindings: records.length,
    totalAssets: allAssets.size,
    attributedFindings,
    attributedAssets: attributedAssets.size,
    unassignedFindings,
    unassignedAssets: unassignedAssets.size,
    supportGroupResolved: sgResolved,
    supportGroupUnresolved: sgUnresolved,
    byDomain,
  };
}

// --- unassignedResources --------------------------------------------------------

export interface NearMiss {
  domain: string;
  ruleIndex: number;
  matchedConditions: number;
  totalConditions: number;
  failedTypes: string[]; // distinct labels of the conditions that failed
}

export interface UnassignedResource {
  asset: string;
  assetType: string | null;
  subscription: string | null;
  subscriptionExtId: string | null;
  supportGroup: string | null;
  tags: Record<string, string>; // <=12 keys, values truncated to 80 chars
  findings: number;
  sevCounts: Record<string, number>;
  nearMisses: NearMiss[];
}

/** First present tags of a record, capped to MAX_TAG_KEYS keys and 80-char values. */
function cappedTags(record: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(recordTags(record))) {
    if (!present(v)) continue;
    if (n >= MAX_TAG_KEYS) break;
    const s = String(v);
    out[k] = s.length > MAX_TAG_VALUE_LEN ? s.slice(0, MAX_TAG_VALUE_LEN) : s;
    n += 1;
  }
  return out;
}

/** Distinct labels of the failing conditions of a traced rule (in condition order). */
function failedTypes(compiled: CompiledDomain[], rt: RuleTrace): string[] {
  const rule = compiled[rt.domainIndex].rules[rt.ruleIndex];
  if (!rule) return [];
  const out: string[] = [];
  for (const c of rt.conditions) {
    if (c.matched) continue;
    const label = KIND_LABEL[rule[c.index].kind];
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * The top-3 rules the record almost matched, from one trace of the representative
 * record: rules with >=1 matched condition, ranked by matched conditions desc, then
 * fewest failing conditions, then rule priority. Malformed rules never qualify.
 */
function nearMisses(record: Rec, compiled: CompiledDomain[]): NearMiss[] {
  const trace = traceRecord(record, compiled);
  const cand = trace.rules
    .filter((rt) => !rt.malformed && rt.conditions.some((c) => c.matched))
    .map((rt) => {
      const matchedConditions = rt.conditions.filter((c) => c.matched).length;
      return {
        domainIndex: rt.domainIndex,
        nm: {
          domain: rt.domain,
          ruleIndex: rt.ruleIndex,
          matchedConditions,
          totalConditions: rt.conditions.length,
          failedTypes: failedTypes(compiled, rt),
        } as NearMiss,
      };
    });
  cand.sort(
    (a, b) =>
      b.nm.matchedConditions - a.nm.matchedConditions ||
      a.nm.totalConditions - a.nm.matchedConditions - (b.nm.totalConditions - b.nm.matchedConditions) ||
      a.domainIndex - b.domainIndex ||
      a.nm.ruleIndex - b.nm.ruleIndex,
  );
  return cand.slice(0, MAX_NEAR_MISSES).map((c) => c.nm);
}

/**
 * Group Unassigned findings by asset into explorer rows: attribution fields and tags
 * from the first record seen for the asset, finding count and per-severity counts, and
 * the near-miss hints computed from that representative record. Sorted by findings desc.
 */
export function unassignedResources(records: Rec[], compiled: CompiledDomain[]): UnassignedResource[] {
  const groups = new Map<string, { rep: Rec; findings: number; sevCounts: Record<string, number> }>();
  for (const r of records) {
    if (domainOf(r) !== UNASSIGNED) continue;
    const asset = assetKey(r);
    let g = groups.get(asset);
    if (!g) groups.set(asset, (g = { rep: r, findings: 0, sevCounts: {} }));
    g.findings += 1;
    addSev(g.sevCounts, r);
  }
  const rows: UnassignedResource[] = [];
  for (const [asset, g] of groups) {
    rows.push({
      asset,
      assetType: flatVal(g.rep, TYPE_COL),
      subscription: flatVal(g.rep, SUB_COL),
      subscriptionExtId: flatVal(g.rep, EXT_COL),
      supportGroup: flatVal(g.rep, SG_COL),
      tags: cappedTags(g.rep),
      findings: g.findings,
      sevCounts: g.sevCounts,
      nearMisses: nearMisses(g.rep, compiled),
    });
  }
  rows.sort((a, b) => b.findings - a.findings || a.asset.localeCompare(b.asset));
  return rows;
}

// --- untaggedSubscriptions ------------------------------------------------------

export interface UntaggedSubscription {
  subscription: string; // "(none)" when the frame has no subscription name
  extId: string; // "(none)" when absent
  assets: number;
  findings: number;
  sevCounts: Record<string, number>;
}

/**
 * Subscriptions carrying findings but no resolved support group, grouped by name + ext
 * id (blank -> "(none)"). Only records lacking _supportGroup are counted, so the list
 * is exactly the subscriptions missing the `Wiz/provisioning` tag. Derived from the
 * findings frame (no extra Wiz calls). Sorted by findings desc.
 */
export function untaggedSubscriptions(records: Rec[]): UntaggedSubscription[] {
  const groups = new Map<
    string,
    { subscription: string; extId: string; assets: Set<string>; findings: number; sevCounts: Record<string, number> }
  >();
  for (const r of records) {
    if (present(r[SG_COL])) continue;
    const subscription = flatVal(r, SUB_COL) ?? NONE;
    const extId = flatVal(r, EXT_COL) ?? NONE;
    const key = `${subscription} ${extId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { subscription, extId, assets: new Set(), findings: 0, sevCounts: {} }));
    g.findings += 1;
    const asset = assetKey(r);
    if (asset) g.assets.add(asset);
    addSev(g.sevCounts, r);
  }
  return [...groups.values()]
    .map((g) => ({
      subscription: g.subscription,
      extId: g.extId,
      assets: g.assets.size,
      findings: g.findings,
      sevCounts: g.sevCounts,
    }))
    .sort(
      (a, b) =>
        b.findings - a.findings ||
        a.subscription.localeCompare(b.subscription) ||
        a.extId.localeCompare(b.extId),
    );
}
