// Sync-time enrichment: attaches severity / AARS / combo membership to nodes, and
// materializes one ISSUE node + HAS_ISSUE edge per open issue. Runs ONCE per sync
// (the result is persisted), never per request.

import {
  computeAars,
  DEFAULT_AARS_RULE,
  environmentFor,
  gap,
  gapPointsFor,
  type AarsGap,
  type AarsInput,
  type AarsRule,
  type DataExposure,
  type Environment,
  type InternetExposure,
  type IssueSeverityKey,
  type PrivilegeLevel,
} from "./aars";
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
  /** Same contract as `internetExposure`: absent means "not recorded", not "NONE". */
  privilege?: PrivilegeLevel;
  /** Same contract again — absent re-derives rather than reading as UNCLASSIFIED. */
  environment?: Environment;
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
/**
 * Effective privilege as its own axis. ADMIN wins over HIGH — the same precedence
 * withExcessivePrivilegeNodes already uses for its label ("Admin privileges" beats
 * "Excessive rights"), so the score and the graph agree about which claim is stronger.
 *
 * Deliberately NOT folded into dataExposureOf: that function answers "what data can this
 * reach", this one answers "what can it do", and collapsing them is why `hasAdminPrivileges`
 * has never changed a score.
 */
export function privilegeOf(node: GNode): PrivilegeLevel {
  if (node.hasAdminPrivileges === true) return "ADMIN";
  if (node.hasHighPrivileges === true) return "HIGH";
  return "NONE";
}

/**
 * Deployment environment from the asset's cloud-account name, through the rule's cascade.
 *
 * The account name is the only environment signal the tenant actually carries — Wiz has no
 * environment field on a cloud resource — and it is already fetched and persisted
 * (`ai_assets.account_name`), so this costs nothing. It is a rule rather than a constant
 * because naming conventions are tenant property: an estate whose accounts are named
 * differently gets UNCLASSIFIED everywhere, which scores exactly as before.
 */
export function environmentOf(node: GNode, rule: AarsRule = DEFAULT_AARS_RULE): Environment {
  return environmentFor(node.cloudAccount?.name, rule);
}

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
    privilege: privilegeOf(node),
    environment: environmentOf(node, rule),
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
 */
export function buildAarsHintsFromFindings(
  findings: FindingRow[],
  doc: GraphDoc,
  issues: IssueRow[],
  rule: AarsRule = DEFAULT_AARS_RULE,
): AarsHints {
  const open = issues.filter((i) => i.status === "OPEN");
  const issuesByAsset = groupBy(open, (i) => i.assetId);
  const codesByResource = new Map<string, string[]>();
  // The worst severity any finding contributing this code carried, so a code reached by
  // both a CRITICAL and a LOW control is weighted by the CRITICAL — the same "worst wins"
  // reading pillar A applies to issues.
  const worstByCode = new Map<string, Severity>();
  for (const f of findings) {
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
      privilege: base.privilege,
      environment: base.environment,
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
  const open = issues.filter((i) => i.status === "OPEN");
  const byAsset = groupBy(open, (i) => i.assetId);

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
      const input: AarsInput = hint
        ? {
            issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
            ...hint,
            // A hint written before these axes existed carries none of them; re-derive
            // rather than let `undefined` read as "nothing here".
            internetExposure: hint.internetExposure ?? internetExposureOf(node),
            privilege: hint.privilege ?? privilegeOf(node),
            environment: hint.environment ?? environmentOf(node, rule),
          }
        : deriveAarsInput(node, nodeIssues, rule);
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
        privilege: input.privilege,
        environment: input.environment,
      };
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

/**
 * Data exposure (AARS pillar C). HOLDS (`hasSensitiveData`) wins over ACCESS when both
 * flags are set — consistent with the score collapsing both to "SENSITIVE".
 */
export function withSensitiveDataNodes(doc: GraphDoc): GraphDoc {
  return withDerivedNodes(doc, {
    kind: "SENSITIVE_DATA",
    prefix: "sensitive",
    name: "Sensitive data",
    edgeType: (n) => (n.hasSensitiveData ? "HAS_SENSITIVE_DATA" : "HAS_ACCESS_TO_SENSITIVE_DATA"),
  });
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
