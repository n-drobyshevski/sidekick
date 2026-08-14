// Sync-time enrichment: attaches severity / AARS / combo membership to nodes, and
// materializes one ISSUE node + HAS_ISSUE edge per open issue. Runs ONCE per sync
// (the result is persisted), never per request.

import {
  computeAars,
  DEFAULT_AARS_RULE,
  gap,
  gapPointsFor,
  type AarsGap,
  type AarsInput,
  type AarsRule,
  type DataExposure,
  type InternetExposure,
  type IssueSeverityKey,
} from "./aars";
import { isOpenGap, isUnresolvedIssue, SEVERITY_ORDER } from "./config";
import type { Severity } from "./config";
import { conditionHolds, conditionState } from "./riskConditions";
import type { ConditionKey } from "./toxicCombos";
import {
  AI_ASSET_KINDS,
  edgeId,
  type FindingRow,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
  type NodeKind,
  severityRank,
} from "./graphTypes";
import { groupBy, indexBy, pushInto } from "./util";

export interface AarsHint {
  gaps: AarsGap[];
  dataExposure: DataExposure;
  /**
   * Optional because persisted `aars_input_json` blobs written before pillar D existed do
   * not carry it. Absent means "not recorded", NOT "not exposed" — enrichGraphDoc falls
   * back to re-deriving it from the node rather than defaulting it to NONE, so an upgrade
   * does not silently declare the whole estate unreachable.
   */
  internetExposure?: InternetExposure;
}
export type AarsHints = Record<string, AarsHint>;


function worstSeverity(severities: Severity[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const s of severities) {
    if (worst === undefined || severityRank(s) < severityRank(worst)) worst = s;
  }
  return worst;
}

/**
 * Data-exposure classification (AARS pillar C bucket) from a node's CIEM/DSPM flags.
 * Extracted so the hint path (buildAarsHintsFromFindings) and the non-hint path
 * (deriveAarsInput) always agree — the topology in withSensitiveDataNodes mirrors the
 * SENSITIVE branch exactly.
 */
export function dataExposureOf(node: GNode): DataExposure {
  if (node.hasAccessToSensitiveData || node.hasSensitiveData) return "SENSITIVE";
  if (node.hasHighPrivileges || node.hasAdminPrivileges) return "DATA_ACCESS";
  return "NONE";
}

/**
 * Internet reachability (AARS pillar D) through the SAME predicate the graph topology and
 * the Toxic Combinations matrix read (riskConditions.conditionState). Going through that
 * table rather than reading the flags here is the point: those two consumers used to
 * disagree about exposure, and a third private reading would re-open exactly that bug.
 *
 * `null` — reachability inherited from the underlying compute and never evaluated — maps to
 * UNDETERMINED, never to CONFIRMED and never to NONE.
 */
export function internetExposureOf(node: GNode): InternetExposure {
  const state = conditionState(node, "INTERNET_EXPOSURE");
  if (state === true) return "CONFIRMED";
  if (state === null) return "UNDETERMINED";
  return "NONE";
}

/**
 * Heuristic AARS input for live data (dry-run seeds carry exact hints transcribed
 * from ai/custom_score.md instead): compliance gaps = the distinct framework codes on
 * the asset's open issues plus NO_GUARDRAIL when guardrail coverage flagged the node;
 * data exposure from the CIEM/DSPM flags.
 */
export function deriveAarsInput(
  node: GNode,
  nodeIssues: IssueRow[],
  rule: AarsRule = DEFAULT_AARS_RULE,
): AarsInput {
  const codes = new Set<string>();
  for (const issue of nodeIssues) {
    const fw = issue.frameworks ?? {};
    for (const c of fw.owaspLlm ?? []) codes.add(c);
    for (const c of fw.owaspAgentic ?? []) codes.add(c);
    for (const c of fw.owaspMl ?? []) codes.add(`ML_${c.replace(/\s+/g, "_").toUpperCase()}`);
    // The 5Rs mappings ride on every issue and have never reached the score, which is why
    // the default cascade's FIVE_RS and 5R rows can never fire. Same shape as the ML
    // branch above: a prose label, normalized into the codebook's 5R_ vocabulary.
    if (rule.gapSources.fiveRs) {
      for (const c of fw.fiveRs ?? []) codes.add(`5R_${c.replace(/\s+/g, "_").toUpperCase()}`);
    }
  }
  const gaps: AarsGap[] = [...codes].sort().map((c) => gap(c));
  if (node.guardrailMissing) gaps.push(gap("NO_GUARDRAIL"));
  // Status-derived gaps. `status` is persisted on every asset and read by nothing but the
  // detail sheet; these two conditions are the ones the cascade already knows how to price.
  const status = String(node.status ?? "").trim().toUpperCase();
  if (rule.gapSources.deprecatedModel && status === "DEPRECATED") gaps.push(gap("DEPRECATED_MODEL"));
  if (rule.gapSources.inactiveAgent && status === "INACTIVE") gaps.push(gap("INACTIVE_AGENT"));
  const dataExposure = dataExposureOf(node);
  return {
    // AARS Pillar A scores Wiz-NATIVE severities (the applied table in
    // ai/custom_score.md: MEDIUM ×1.2 = 24); the adjusted severity is a display
    // lens, not a scoring input — using it would double-count the 5Rs amplifier.
    issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
    gaps,
    dataExposure,
    internetExposure: internetExposureOf(node),
  };
}

/**
 * A finding-contributed gap, weighted by how severe the failing control was.
 *
 * At the spec weights (all 1) this returns a bare `gap(code)` — no `points` override, so
 * the cascade prices it exactly as before and the persisted input is byte-identical. Only
 * a tuned weight materializes an override, and it rounds to a whole point because every
 * other price in the model is an integer.
 */
function weightedGap(code: string, severity: Severity | undefined, rule: AarsRule): AarsGap {
  const w = severity === undefined
    ? 1
    : (rule.findingSeverityWeights[severity as IssueSeverityKey] ?? 1);
  if (w === 1) return gap(code);
  return gap(code, Math.max(0, Math.round(gapPointsFor(code, rule) * w)));
}

/**
 * Turn config-findings into per-asset AARS hints so live Pillar B stops being purely
 * heuristic: for each resource carrying ≥1 failing finding, the hint's gaps are the
 * union of (a) what deriveAarsInput would compute from the asset's open issues +
 * guardrail flag and (b) one gap per distinct framework code the findings contribute —
 * so no existing signal is lost and real failing controls add real points (computeAars
 * still caps pillar B at 30). dataExposure comes from deriveAarsInput, so hinted and
 * un-hinted assets classify identically. Assets with no findings are omitted and fall
 * through to deriveAarsInput unchanged.
 *
 * Only FAILING, OPEN findings price anything — `isOpenGap`. That filter used to live at
 * the normalizer, which stored nothing else; now that the register also keeps RESOLVED
 * and PASS rows for the lifecycle clock, it has to be applied here or a control someone
 * already fixed would keep scoring against the asset forever. Same population as before,
 * so no score moves on upgrade.
 *
 * A finding whose `resourceId` matches no node is skipped, and that is correct rather
 * than lossy: most AI-security configuration rules fail on a REGION, an IAM policy or an
 * unattached service account, none of which the AI graph models, and there is no asset to
 * charge the gap to. It does mean the gap total and the priced total differ, which is why
 * `kpis.complianceGapsUnlinked` reports the difference instead of leaving it implied.
 */
export function buildAarsHintsFromFindings(
  findings: FindingRow[],
  doc: GraphDoc,
  issues: IssueRow[],
  rule: AarsRule = DEFAULT_AARS_RULE,
): AarsHints {
  const open = issues.filter(isUnresolvedIssue);
  const issuesByAsset = groupBy(open, (i) => i.assetId);
  const codesByResource = new Map<string, string[]>();
  // The worst severity any finding contributing this code carried, so a code reached by
  // both a CRITICAL and a LOW control is weighted by the CRITICAL — the same "worst wins"
  // reading pillar A applies to issues.
  const worstByCode = new Map<string, Severity>();
  for (const f of findings.filter(isOpenGap)) {
    pushInto(codesByResource, f.resourceId, ...f.frameworkCodes);
    for (const c of f.frameworkCodes) {
      const key = `${f.resourceId}|${c}`;
      const prev = worstByCode.get(key);
      if (prev === undefined || severityRank(f.severity) < severityRank(prev)) {
        worstByCode.set(key, f.severity);
      }
    }
  }
  const nodeById = indexBy(doc.nodes, (n) => n.id);
  const hints: AarsHints = {};
  for (const [resourceId, codes] of codesByResource) {
    const node = nodeById.get(resourceId);
    if (!node) continue;
    const base = deriveAarsInput(node, issuesByAsset.get(resourceId) ?? [], rule);
    const seen = new Set(base.gaps.map((g) => g.code));
    const gaps = [...base.gaps];
    for (const c of codes) {
      if (c && !seen.has(c)) {
        seen.add(c);
        gaps.push(weightedGap(c, worstByCode.get(`${resourceId}|${c}`), rule));
      }
    }
    hints[resourceId] = {
      gaps,
      dataExposure: base.dataExposure,
      internetExposure: base.internetExposure,
    };
  }
  return hints;
}

/**
 * Enrich a raw synced graph: per-node severity (worst adjusted severity of its open
 * issues), combo membership, AARS for AI assets and any node carrying issues, plus
 * ISSUE nodes and HAS_ISSUE edges. Pure; returns a new document.
 */
export function enrichGraphDoc(
  doc: GraphDoc,
  issues: IssueRow[],
  hints?: AarsHints,
  rule: AarsRule = DEFAULT_AARS_RULE,
): GraphDoc {
  const open = issues.filter(isUnresolvedIssue);
  const byAsset = groupBy(open, (i) => i.assetId);
  const reach = dataFindingReach(doc);

  const nodes: GNode[] = doc.nodes.map((raw) => {
    const node: GNode = { ...raw };
    const nodeIssues = byAsset.get(node.id) ?? [];

    if (nodeIssues.length) {
      node.severity = worstSeverity(nodeIssues.map((i) => i.adjustedSeverity));
      const groups: string[] = [];
      for (const i of nodeIssues) {
        if (i.comboGroup && !groups.includes(i.comboGroup)) groups.push(i.comboGroup);
      }
      node.comboGroups = groups;
    }

    const hint = hints?.[node.id];
    const scorable =
      node.kind !== "ISSUE" &&
      node.kind !== "SUMMARY" &&
      (AI_ASSET_KINDS.includes(node.kind) || nodeIssues.length > 0 || hint !== undefined);
    if (scorable) {
      const base: AarsInput = hint
        ? {
            issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
            ...hint,
            // A hint written before pillar D existed carries no exposure; re-derive it
            // rather than let `undefined` read as NONE.
            internetExposure: hint.internetExposure ?? internetExposureOf(node),
          }
        : deriveAarsInput(node, nodeIssues, rule);
      // Reach comes from the TOPOLOGY, so it is applied after the hint rather than inside
      // it: the dry-run hints are transcribed from ai/custom_score.md and know nothing about
      // a tenant's datastores, and a hint that omitted this would silently price the term at
      // zero for exactly the assets the chain was built to describe. Left absent when the
      // asset reaches nothing, so "no findings" and "never collected" stay distinguishable.
      const reached = reach.get(node.id);
      const input: AarsInput = reached ? { ...base, dataFindingSeverities: reached } : base;
      const result = computeAars(input, rule);
      node.aars = result.score;
      node.aarsSeverity = result.severity;
      node.aarsPillars = result.pillars;
      // Keep the inputs beside the score so a later rule change can re-price exactly
      // these gaps rather than re-deriving a fresh, possibly different, set of them.
      node.aarsInput = {
        gaps: input.gaps,
        dataExposure: input.dataExposure,
        internetExposure: input.internetExposure,
      };
      if (reached) {
        node.aarsInput.dataFindings = countBySeverity(reached);
      }
    }
    return node;
  });

  const issueNodes: GNode[] = open.map((issue) => ({
    id: issue.id,
    kind: "ISSUE",
    name: issue.ruleName,
    severity: issue.adjustedSeverity,
    comboGroups: issue.comboGroup ? [issue.comboGroup] : [],
    status: issue.status,
  }));

  const issueEdges: GEdge[] = open.map((issue) => ({
    id: edgeId(issue.assetId, "HAS_ISSUE", issue.id),
    src: issue.assetId,
    dst: issue.id,
    type: "HAS_ISSUE",
  }));

  return {
    nodes: [...nodes, ...issueNodes],
    edges: [...doc.edges, ...issueEdges],
    syncedAt: doc.syncedAt,
  };
}

/**
 * Read-time risk topology: append one synthetic risk node + edge per asset that carries a
 * risk condition, so each AARS pillar reads as a first-class neighbour on the attack path
 * instead of a flag on a card — the way ISSUE nodes already make the toxic pillar visible.
 *
 * Derived on READ (applied by loadGraphDoc), never persisted: it therefore covers
 * already-synced graphs without a re-sync and never leaks into the asset/inventory tables.
 * Idempotent (skips any node that already has its `<prefix>|<id>` stub) and pure — returns
 * a new document, or the same one when nothing is flagged.
 *
 * The four builders below were the same twenty lines four times over, differing only in
 * the fields of this spec. Whether an asset carries the condition is not one of those
 * fields: that question lives in riskConditions.ts, shared with the Toxic Combinations
 * matrix, because the two used to answer it differently.
 */
interface DerivedNodeSpec {
  /** Doubles as the synthetic node's kind — the condition keys ARE risk node kinds. */
  kind: ConditionKey;
  /** Id namespace: the stub is `<prefix>|<asset id>`. */
  prefix: string;
  name: string | ((node: GNode) => string);
  edgeType: GEdge["type"] | ((node: GNode) => GEdge["type"]);
  /** A NEGATED edge says "the protective relationship is absent", not "no edge". */
  negated?: true;
  /** Assets this spec must not draw, computed once per document before the walk. */
  suppress?: (doc: GraphDoc) => Set<string>;
}

function withDerivedNodes(doc: GraphDoc, spec: DerivedNodeSpec): GraphDoc {
  const existing = new Set(doc.nodes.filter((n) => n.kind === spec.kind).map((n) => n.id));
  const suppressed = spec.suppress ? spec.suppress(doc) : null;
  const added: GNode[] = [];
  const addedEdges: GEdge[] = [];

  for (const node of doc.nodes) {
    if (node.kind === spec.kind) continue;
    if (!conditionHolds(node, spec.kind)) continue;
    if (suppressed && suppressed.has(node.id)) continue;
    const id = `${spec.prefix}|${node.id}`;
    if (existing.has(id)) continue;

    const type = typeof spec.edgeType === "function" ? spec.edgeType(node) : spec.edgeType;
    added.push({
      id,
      kind: spec.kind,
      name: typeof spec.name === "function" ? spec.name(node) : spec.name,
    });
    const edge: GEdge = { id: edgeId(node.id, type, id, spec.negated), src: node.id, dst: id, type };
    if (spec.negated) edge.negated = true;
    addedEdges.push(edge);
  }

  if (!added.length) return doc;
  return {
    nodes: [...doc.nodes, ...added],
    edges: [...doc.edges, ...addedEdges],
    syncedAt: doc.syncedAt,
  };
}

/** Datastore kinds the data-exposure chain terminates on. */
export const DATASTORE_KINDS: readonly NodeKind[] = ["BUCKET", "DATABASE", "DATABASE_SERVER"];

/** `["HIGH","HIGH","CRITICAL"]` → `[{severity:"CRITICAL",count:1},{severity:"HIGH",count:2}]`. */
function countBySeverity(severities: Severity[]): Array<{ severity: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const s of severities) counts[s] = (counts[s] ?? 0) + 1;
  return Object.keys(counts)
    .sort((a, b) => severityRank(a) - severityRank(b))
    .map((severity) => ({ severity, count: counts[severity] }));
}

/**
 * The data findings each asset can REACH, walking the synced chain:
 *   asset -RUNS_AS-> identity -ALLOWS_ACCESS_TO-> classified store (dataFindingSeverities)
 *
 * Both ends are credited. An execution identity that can read a bucket full of PII is
 * exposed to it, and so is whatever runs as that identity — which is the whole claim the
 * toxic-combination rules make about an agent, and the reason pillar C exists at all. A
 * store is credited with its own findings too, so a classified bucket scores for what is
 * actually in it rather than only for the boolean.
 *
 * Returns severities one entry per finding — the shape pillar C's count term wants. An
 * asset that reaches nothing is simply absent from the map, never present with an empty
 * array: "reaches no findings" and "was never asked" must not both read as zero.
 */
export function dataFindingReach(doc: GraphDoc): Map<string, Severity[]> {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));

  /** One store's findings, expanded from its severity mix into one entry per finding. */
  const findingsOf = (store: GNode): Severity[] => {
    const out: Severity[] = [];
    for (const [severity, count] of Object.entries(store.dataFindingSeverities ?? {})) {
      for (let i = 0; i < count; i++) out.push(severity as Severity);
    }
    return out;
  };

  const reach = new Map<string, Severity[]>();
  const add = (id: string, severities: Severity[]) => {
    if (!severities.length) return;
    const prev = reach.get(id);
    if (prev) prev.push(...severities);
    else reach.set(id, [...severities]);
  };

  // Store → its own findings.
  for (const node of doc.nodes) {
    if (!(DATASTORE_KINDS as readonly string[]).includes(node.kind)) continue;
    add(node.id, findingsOf(node));
  }
  // Identity → the stores it can reach.
  const identityReach = new Map<string, Severity[]>();
  for (const e of doc.edges) {
    if (e.type !== "ALLOWS_ACCESS_TO") continue;
    const store = byId.get(e.dst);
    if (!store || !(DATASTORE_KINDS as readonly string[]).includes(store.kind)) continue;
    const found = findingsOf(store);
    if (!found.length) continue;
    const prev = identityReach.get(e.src);
    if (prev) prev.push(...found);
    else identityReach.set(e.src, [...found]);
  }
  for (const [id, severities] of identityReach) add(id, severities);
  // Whatever RUNS_AS such an identity.
  for (const e of doc.edges) {
    if (e.type !== "RUNS_AS") continue;
    const viaIdentity = identityReach.get(e.dst);
    if (viaIdentity) add(e.src, viaIdentity);
  }
  return reach;
}

/**
 * Everything on a real, traversable path to a classified datastore.
 *
 * Three populations, walked from the chain the sensitive-data step syncs:
 *   store   — a classified datastore the graph actually holds
 *   reacher — an identity with an ALLOWS_ACCESS_TO edge into one
 *   runner  — whatever RUNS_AS that identity (the head of the chain: the agent)
 *
 * Shared by the stub suppression below and, through it, the only definition of "this asset's
 * data exposure is drawn as a path" the app has. Empty when the step never ran — which is
 * what makes every fallback in this file degrade to today's behaviour rather than to
 * silence.
 */
function assetsOnDataPath(doc: GraphDoc): Set<string> {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const onPath = new Set<string>();
  const reachers = new Set<string>();

  for (const e of doc.edges) {
    if (e.type !== "ALLOWS_ACCESS_TO") continue;
    const store = byId.get(e.dst);
    if (!store || !(DATASTORE_KINDS as readonly string[]).includes(store.kind)) continue;
    if (store.hasSensitiveData !== true) continue;
    onPath.add(store.id);
    reachers.add(e.src);
  }
  for (const id of reachers) onPath.add(id);
  for (const e of doc.edges) {
    if (e.type === "RUNS_AS" && reachers.has(e.dst)) onPath.add(e.src);
  }
  return onPath;
}

/**
 * Data exposure (AARS pillar C). HOLDS (`hasSensitiveData`) wins over ACCESS when both
 * flags are set — consistent with the score collapsing both to "SENSITIVE".
 *
 * The stub is now the FALLBACK, not the primary rendering. Where the sensitive-data
 * traversal produced a real chain — agent → execution identity → classified store — that
 * chain is the evidence, and hanging a "Sensitive data" stub off the agent as well would
 * state one fact twice in two visual languages. Same rule withExcessivePrivilegeNodes
 * already applies when a real CIEM finding beats its synthetic stand-in, over a path rather
 * than a single edge.
 *
 * What deliberately KEEPS its stub:
 *   - an asset Wiz flags sensitive with no traversable path (the tenant rejected the step,
 *     or the grant is expressed some way this query does not walk). This is the whole point
 *     of keeping the stub at all;
 *   - every asset in a graph synced before the chain existed, which carries none of these
 *     edges and so reaches the suppression set empty-handed.
 */
export function withSensitiveDataNodes(doc: GraphDoc): GraphDoc {
  return withDerivedNodes(doc, {
    kind: "SENSITIVE_DATA",
    prefix: "sensitive",
    name: "Sensitive data",
    edgeType: (n) => (n.hasSensitiveData ? "HAS_SENSITIVE_DATA" : "HAS_ACCESS_TO_SENSITIVE_DATA"),
    suppress: assetsOnDataPath,
  });
}

/**
 * The DSPM verdict on a datastore: one aggregate node per store, carrying how many
 * classified findings it holds and their severity mix.
 *
 * An aggregate rather than one node per finding, which is how Wiz's own graph draws it
 * ("Data Findings", count badge). The individual rows live in `ai_data_findings` and the
 * store's detail sheet names them; a bucket with two hundred findings must cost one node,
 * not the whole budget.
 *
 * Derived on READ, from two persisted columns. That means changing what the aggregate says
 * never needs a re-sync, and it cannot use withDerivedNodes: that helper keys off
 * conditionHolds, a boolean, and this reads a count.
 */
export function withDataFindingNodes(doc: GraphDoc): GraphDoc {
  const existing = new Set(doc.nodes.filter((n) => n.kind === "DATA_FINDING").map((n) => n.id));
  const added: GNode[] = [];
  const addedEdges: GEdge[] = [];

  for (const node of doc.nodes) {
    if (!(DATASTORE_KINDS as readonly string[]).includes(node.kind)) continue;
    const count = node.dataFindingCount ?? 0;
    if (count <= 0) continue;
    const id = `datafinding|${node.id}`;
    if (existing.has(id)) continue;

    const mix = node.dataFindingSeverities ?? {};
    const finding: GNode = {
      id,
      kind: "DATA_FINDING",
      name: "Data Findings",
      // summaryCount, not a bespoke field: the client already reads it for the collapse
      // stubs, so the count badge and its aria text come for free.
      summaryCount: count,
      dataFindingSeverities: mix,
    };
    // The worst severity present, so the card carries a dot and a word rather than only a
    // number — severity must never be a colour alone, and a bare "3" says nothing about how
    // bad. Absent when nothing in the mix ranks, rather than defaulted to something false.
    const worst = Object.keys(mix).sort((a, b) => severityRank(a) - severityRank(b))[0];
    if (worst && severityRank(worst) < SEVERITY_ORDER.length) finding.severity = worst as Severity;
    added.push(finding);
    addedEdges.push({
      id: edgeId(node.id, "HAS_DATA_FINDING", id),
      src: node.id,
      dst: id,
      type: "HAS_DATA_FINDING",
    });
  }

  if (!added.length) return doc;
  return {
    nodes: [...doc.nodes, ...added],
    edges: [...doc.edges, ...addedEdges],
    syncedAt: doc.syncedAt,
  };
}

/**
 * Internet exposure. Strict `=== true` (see riskConditions.ts): the flags are tri-state,
 * and null means exposure is inherited from the underlying compute and undetermined —
 * which must NOT be drawn as a definite exposure.
 */
export function withInternetExposureNodes(doc: GraphDoc): GraphDoc {
  return withDerivedNodes(doc, {
    kind: "INTERNET_EXPOSURE",
    prefix: "internet",
    name: "Internet exposure",
    edgeType: "EXPOSED_TO_INTERNET",
  });
}

/**
 * Excessive rights, so over-permissioning reads as a neighbour on the attack path.
 *
 * Assets that already carry a REAL CIEM finding (Wiz's own EXCESSIVE_ACCESS_FINDING,
 * reached via HAS_FINDING) are skipped: the tenant's finding is the better evidence and
 * drawing both would show one problem twice.
 */
export function withExcessivePrivilegeNodes(doc: GraphDoc): GraphDoc {
  return withDerivedNodes(doc, {
    kind: "EXCESSIVE_PRIVILEGE",
    prefix: "excessive",
    // ADMIN wins over HIGH when both are set — it is the stronger claim.
    name: (n) => (n.hasAdminPrivileges ? "Admin privileges" : "Excessive rights"),
    edgeType: "HAS_EXCESSIVE_PRIVILEGE",
    suppress: (d) => {
      const kindById = new Map(d.nodes.map((n) => [n.id, n.kind]));
      const withRealFinding = new Set<string>();
      for (const e of d.edges) {
        if (e.type === "HAS_FINDING" && kindById.get(e.dst) === "EXCESSIVE_ACCESS_FINDING") {
          withRealFinding.add(e.src);
        }
      }
      return withRealFinding;
    },
  });
}

/**
 * Human identity access.
 *
 * The identity-access scan already syncs who can reach each AI asset, but nothing counted
 * it — scanContent.js says so in as many words ("Access paths are synced and drawn, but
 * nothing totals them"). This makes it a countable, filterable neighbour on the attack
 * path, the way the other four risk topologies do.
 *
 * It cannot use withDerivedNodes: that helper reads a per-node boolean through
 * conditionState, and this signal is an EDGE — identity → ALLOWS_ACCESS_TO → asset,
 * carrying an accessType. So it walks edges instead.
 *
 * Two rules keep it from drawing a fact the graph already shows:
 *
 *  - HUMAN identities only. USER_ACCOUNT, never SERVICE_ACCOUNT — an agent's own execution
 *    identity reaching it is normal operation, not a finding.
 *  - Assets that already carry a REAL CIEM finding are skipped, exactly as
 *    withExcessivePrivilegeNodes skips them: the tenant's own finding is better evidence,
 *    and drawing both would show one problem twice.
 */
export function withIdentityAccessNodes(doc: GraphDoc): GraphDoc {
  const HUMAN_REACH: ReadonlySet<string> = new Set(["ADMIN", "HIGH_PRIVILEGE"]);
  const aiAssets = new Set(
    doc.nodes.filter((n) => (AI_ASSET_KINDS as readonly string[]).includes(n.kind)).map((n) => n.id),
  );
  const humans = new Set(doc.nodes.filter((n) => n.kind === "USER_ACCOUNT").map((n) => n.id));
  const existing = new Set(
    doc.nodes.filter((n) => n.kind === "IDENTITY_ACCESS_FINDING").map((n) => n.id),
  );

  const kindById = new Map(doc.nodes.map((n) => [n.id, n.kind]));
  const withRealFinding = new Set<string>();
  for (const e of doc.edges) {
    if (e.type === "HAS_FINDING" && kindById.get(e.dst) === "EXCESSIVE_ACCESS_FINDING") {
      withRealFinding.add(e.src);
    }
  }

  const reached = new Set<string>();
  for (const e of doc.edges) {
    if (e.type !== "ALLOWS_ACCESS_TO") continue;
    if (!e.accessType || !HUMAN_REACH.has(e.accessType)) continue;
    if (!humans.has(e.src) || !aiAssets.has(e.dst)) continue;
    if (withRealFinding.has(e.dst)) continue;
    reached.add(e.dst);
  }

  const added: GNode[] = [];
  const addedEdges: GEdge[] = [];
  for (const assetId of reached) {
    const id = `identityaccess|${assetId}`;
    if (existing.has(id)) continue;
    added.push({ id, kind: "IDENTITY_ACCESS_FINDING", name: "Human access" });
    addedEdges.push({
      id: edgeId(assetId, "HAS_FINDING", id),
      src: assetId,
      dst: id,
      type: "HAS_FINDING",
    });
  }

  if (!added.length) return doc;
  return {
    nodes: [...doc.nodes, ...added],
    edges: [...doc.edges, ...addedEdges],
    syncedAt: doc.syncedAt,
  };
}

/**
 * Guardrail coverage.
 *
 * The edge is a NEGATED `PROTECTED_BY` — the vocabulary already says "the protective edge
 * is absent" (Wiz's own negate:true scan), and the client draws negated edges dashed and
 * labels them "(ABSENT)", so the absence stays legible rather than reading as coverage.
 */
export function withMissingGuardrailNodes(doc: GraphDoc): GraphDoc {
  return withDerivedNodes(doc, {
    kind: "MISSING_GUARDRAIL",
    prefix: "noguardrail",
    name: "No guardrail",
    edgeType: "PROTECTED_BY",
    negated: true,
  });
}
