// Attribution diagnostics for the "Attribution" SPA page: per-record rule tracing,
// mapping-rule health (fired vs matched under first-match-wins), domain coverage,
// unassigned-resource explorer rows, and untagged-subscription rollups.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over current-scan frame records: flat dotted keys
// (vulnerableAsset.name / .subscriptionName / .subscriptionExternalId / .tags.<k>)
// plus the server-attached _sev / _supportGroup / _domain. The engine mirrors
// domainRules.assignDomain's loop semantics exactly, but traces every condition instead of
// short-circuiting on the first match, which is what makes the "why is this Unassigned?"
// views possible.

import {
  UNASSIGNED,
  conditionMatches,
  recordTags,
  type CompiledDomain,
  type CondSpec,
} from "./domainRules";
import { NOT_ATTRIBUTABLE, type DomainSource } from "./resolveDomain";
import { normalizeSeverity } from "./severity";
import { present, type Rec } from "./util";

const NAME_COL = "vulnerableAsset.name";
const TYPE_COL = "vulnerableAsset.type";
const SUB_COL = "vulnerableAsset.subscriptionName";
const EXT_COL = "vulnerableAsset.subscriptionExternalId";
const SG_COL = "_supportGroup";
const DOMAIN_COL = "_domain";
const SOURCE_COL = "_domainSource";
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

/**
 * WHICH MECHANISM CLAIMED THE ROW. `resolveDomain` writes `_domainSource` beside `_domain` at
 * every attach site, and that is the only reading that can tell a tag from a rule — the two
 * produce indistinguishable names by design (a manual group may be named after a tag value).
 *
 * The fallback is for a caller that resolved without recording provenance (older cached
 * payloads, hand-built test records). It reads the two tails off the name, which are
 * unambiguous, and calls everything else "rule" — under-reporting tag attribution rather than
 * inventing it, so a missing provenance shows up as a coverage story that looks worse than the
 * truth instead of better.
 */
function sourceOf(r: Rec): DomainSource {
  const v = r[SOURCE_COL];
  if (v === "tag" || v === "rule" || v === "none" || v === "missing") return v;
  const dom = domainOf(r);
  if (dom === NOT_ATTRIBUTABLE) return "missing";
  if (dom === UNASSIGNED) return "none";
  return "rule";
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
 * assignDomain (first domain with a fully-matching rule wins), while `rules` keeps the full
 * per-condition breakdown the UI needs to explain a non-match. recordTags is resolved once,
 * exactly like assignDomain.
 *
 * There is no compacted-episode special case here any more, and there must not be one: the
 * `(compacted)` placeholder is now excluded inside domainRules.conditionMatches' regex pool
 * alone, so a sealed episode that kept its tag bag is claimable by a `tag` rule. A trace that
 * still pinned such a record to Unassigned would contradict the verdict it exists to explain.
 */
export function traceRecord(record: Rec, compiled: CompiledDomain[]): RecordTrace {
  const tags = recordTags(record);
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
      if (matched && assigned === UNASSIGNED) assigned = dom.name;
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
  byDomain: CoverageDomain[]; // priority order, zero-count domains kept, the two tails last
  bySource: CoverageSources; // which mechanism claimed each finding
}

/**
 * The per-mechanism split, and the reason this page did not become redundant when the tag took
 * over: "coverage" now has two ways to succeed and two ways to fail, and an operator's next
 * action is different for each. `tag` rising is the tenant tagging its estate. `rule` is what
 * the manual groups are still carrying, and is the number that should shrink. `none` is the
 * actionable gap — the row had inputs and nothing claimed it. `missing` is not a gap anyone can
 * close from here; it is history that arrived with nothing to match on.
 */
export interface CoverageSources {
  tag: number;
  rule: number;
  none: number;
  missing: number;
}

/**
 * Priority-ordered names deduped with the two tails forced to the end exactly once.
 *
 * `Unassigned` is always present — a register with nothing unassigned still wants the row, at
 * zero, as the statement that nothing is unassigned. `Not attributable` is appended only when
 * something actually landed there, because on a live frame it is structurally empty (every open
 * finding carries a name and a subscription) and a permanent zero row would read as a bug.
 */
function orderedWithTailsLast(names: string[], includeNotAttributable: boolean): string[] {
  const seen = new Set<string>([UNASSIGNED, NOT_ATTRIBUTABLE]);
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.push(UNASSIGNED);
  if (includeNotAttributable) out.push(NOT_ATTRIBUTABLE);
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
  const bySource: CoverageSources = { tag: 0, rule: 0, none: 0, missing: 0 };
  for (const r of records) {
    const domain = domainOf(r);
    const asset = assetKey(r);
    bySource[sourceOf(r)] += 1;
    findingsByDomain.set(domain, (findingsByDomain.get(domain) ?? 0) + 1);
    let set = assetsByDomain.get(domain);
    if (!set) assetsByDomain.set(domain, (set = new Set()));
    if (asset) {
      set.add(asset);
      allAssets.add(asset);
    }
    // THREE-WAY, NOT TWO. `Not attributable` counts as neither attributed nor unassigned:
    // calling it attributed would claim an owner that does not exist, and calling it unassigned
    // would put it in the same figure as the explorer below, which lists only rows that HAD
    // inputs and matched nothing — the KPI and the table it links to would then disagree. So
    // `attributedFindings + unassignedFindings + bySource.missing === totalFindings`. On a live
    // frame the third term is structurally zero, so no existing figure moves.
    if (domain === NOT_ATTRIBUTABLE) {
      // no-op: counted only in `bySource.missing` and its own `byDomain` row
    } else if (domain === UNASSIGNED) {
      unassignedFindings += 1;
      if (asset) unassignedAssets.add(asset);
    } else {
      attributedFindings += 1;
      if (asset) attributedAssets.add(asset);
    }
    if (present(r[SG_COL])) sgResolved += 1;
    else sgUnresolved += 1;
  }
  const byDomain = orderedWithTailsLast(orderedDomainNames, bySource.missing > 0).map(
    (domain) => ({
      domain,
      findings: findingsByDomain.get(domain) ?? 0,
      assets: assetsByDomain.get(domain)?.size ?? 0,
    }),
  );
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
    bySource,
  };
}

// --- supportGroupBreakdown ------------------------------------------------------

export interface SupportGroupRow {
  group: string; // a resolved support group, or "(none)" for the unresolved bucket
  findings: number;
  assets: number; // distinct affected assets
  unresolved: boolean; // true only for the "(none)" row
}

export interface SupportGroupBreakdown {
  totalFindings: number;
  totalAssets: number;
  resolvedFindings: number; // findings carrying a _supportGroup
  unresolvedFindings: number; // findings resolving to "(none)"
  resolvedAssets: number;
  unresolvedAssets: number;
  distinctGroups: number; // distinct resolved groups actually present on findings this scan
  rows: SupportGroupRow[]; // resolved groups by findings desc (name tiebreak), then "(none)" last
}

/**
 * Findings split by their resolved support group — the support-group dual of `coverage`'s
 * per-domain table, and the view that makes "why is this (none)?" answerable. Each record's
 * group is the pre-attached `_supportGroup` (server-resolved from the subscription→group
 * map), defaulting to "(none)" when absent. Resolved groups are ranked by findings; the
 * unresolved "(none)" bucket is always last when present. Asset identity is
 * `vulnerableAsset.name`, matching the rest of this module.
 */
export function supportGroupBreakdown(records: Rec[]): SupportGroupBreakdown {
  const findingsByGroup = new Map<string, number>();
  const assetsByGroup = new Map<string, Set<string>>();
  const allAssets = new Set<string>();
  const resolvedAssets = new Set<string>();
  const unresolvedAssets = new Set<string>();
  let resolvedFindings = 0;
  let unresolvedFindings = 0;
  for (const r of records) {
    const sg = flatVal(r, SG_COL);
    const group = sg ?? NONE;
    const asset = assetKey(r);
    findingsByGroup.set(group, (findingsByGroup.get(group) ?? 0) + 1);
    let set = assetsByGroup.get(group);
    if (!set) assetsByGroup.set(group, (set = new Set()));
    if (asset) {
      set.add(asset);
      allAssets.add(asset);
    }
    if (sg) {
      resolvedFindings += 1;
      if (asset) resolvedAssets.add(asset);
    } else {
      unresolvedFindings += 1;
      if (asset) unresolvedAssets.add(asset);
    }
  }
  const rows: SupportGroupRow[] = [...findingsByGroup.entries()]
    .filter(([g]) => g !== NONE)
    .map(([group, findings]) => ({
      group,
      findings,
      assets: assetsByGroup.get(group)?.size ?? 0,
      unresolved: false,
    }))
    .sort((a, b) => b.findings - a.findings || a.group.localeCompare(b.group));
  const distinctGroups = rows.length;
  if (findingsByGroup.has(NONE)) {
    rows.push({
      group: NONE,
      findings: findingsByGroup.get(NONE) ?? 0,
      assets: assetsByGroup.get(NONE)?.size ?? 0,
      unresolved: true,
    });
  }
  return {
    totalFindings: records.length,
    totalAssets: allAssets.size,
    resolvedFindings,
    unresolvedFindings,
    resolvedAssets: resolvedAssets.size,
    unresolvedAssets: unresolvedAssets.size,
    distinctGroups,
    rows,
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
    const key = `${subscription}\u0000${extId}`;
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

// --- unassignedLifecycles ------------------------------------------------------
//
// Everything above reads the CURRENT SCAN. This one reads the durable ledger, and it exists
// because the two disagree in a way that looked like a bug: an operator who fixes their
// tagging watches the frame go to zero while the MTTR by-domain split keeps an Unassigned bar.
// Both are right. The split counts every lifecycle the register holds, and a lifecycle whose
// stored tag snapshot predates the rollout — and which Wiz no longer re-lists, so no scan can
// refresh it — stays unclaimed forever with nothing on screen naming it.
//
// LEDGER COLUMNS, NOT FRAME COLUMNS. A base row spells its identity `asset_name` /
// `subscription_name`, not `vulnerableAsset.*`, so none of the readers above can be reused —
// they would return "(none)" for every field and the explorer would list rows it could not
// name. That is why this is a separate function rather than a second caller of
// `unassignedResources`.

const LEDGER_NAME_COL = "asset_name";
const LEDGER_TYPE_COL = "asset_type";
const LEDGER_SUB_COL = "subscription_name";

export interface UnassignedLifecycle {
  asset: string;
  assetType: string | null;
  subscription: string | null;
  supportGroup: string | null;
  open: number;
  resolved: number;
  /** Latest `last_seen` across the group — how stale this attribution gap actually is. */
  lastSeen: string | null;
  /** The tag bag as stored. The point of showing it: the reader can see for themselves that
   *  the domain tag is absent from the snapshot rather than being told so. */
  tags: Record<string, string>;
  nearMisses: NearMiss[];
}

/**
 * Ledger rows resolving to Unassigned, grouped by asset.
 *
 * Expects `_domain` already resolved onto each row (the server does that before calling, the
 * same way `mttrByDomainData` does) so this and the by-domain split cannot disagree about
 * which rows are Unassigned — the whole point being to explain that split, not to offer a
 * second opinion on it.
 *
 * Sorted by total lifecycles desc, then by asset, and capped: this is a diagnostic for
 * deciding whether the tail is worth chasing, not a register.
 */
export function unassignedLifecycles(
  rows: Rec[],
  compiled: CompiledDomain[],
  topN = 100,
): UnassignedLifecycle[] {
  const groups = new Map<
    string,
    { rep: Rec; open: number; resolved: number; lastSeen: string | null }
  >();
  for (const r of rows) {
    if (domainOf(r) !== UNASSIGNED) continue;
    const asset = String(r[LEDGER_NAME_COL] ?? "") || NONE;
    let g = groups.get(asset);
    if (!g) groups.set(asset, (g = { rep: r, open: 0, resolved: 0, lastSeen: null }));
    // Same open test the rest of the app uses, read off the durable status column.
    if (String(r["status"] ?? "").toUpperCase() === "OPEN") g.open += 1;
    else g.resolved += 1;
    const seen = r["last_seen"];
    if (present(seen)) {
      const s = String(seen);
      if (g.lastSeen === null || s > g.lastSeen) g.lastSeen = s;
    }
  }
  const out: UnassignedLifecycle[] = [];
  for (const [asset, g] of groups) {
    out.push({
      asset,
      assetType: flatVal(g.rep, LEDGER_TYPE_COL),
      subscription: flatVal(g.rep, LEDGER_SUB_COL),
      supportGroup: flatVal(g.rep, SG_COL),
      open: g.open,
      resolved: g.resolved,
      lastSeen: g.lastSeen,
      tags: cappedTags(g.rep),
      // `recordTags` reads the ledger's `tags_json` as happily as a frame's tag columns, so
      // the near-miss hints work here unchanged — which is what makes this actionable: it
      // says which rule almost claimed the row, not just that none did.
      nearMisses: nearMisses(g.rep, compiled),
    });
  }
  out.sort(
    (a, b) => (b.open + b.resolved) - (a.open + a.resolved) || a.asset.localeCompare(b.asset),
  );
  return out.slice(0, topN);
}
