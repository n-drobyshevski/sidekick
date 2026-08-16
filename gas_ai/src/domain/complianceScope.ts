// The 5Rs framework's derived AI-relevance scope: which of "5Rs - Wiz for Data Security"'s
// controls belong on an AI-focused register, and why.
//
// 5Rs (Reduce, Restrict, Relabel, Relocate, Reconfigure) is a DATA SECURITY framework,
// collected here by an AI-focused product. Most of its rules are about all cloud data — a
// stale bucket, an over-broad grant on a data warehouse nobody's agent ever touches — and
// are noise on a page built to answer "is my AI estate safe". A fixed allowlist of "the
// AI-relevant 5Rs rules" would go stale the moment Wiz revises the framework, so this module
// DERIVES the scope instead, from two HARD facts about the estate rather than a guess:
//
//   1. CROSS-MAPPED. The same policyId also appears under a framework this app already
//      knows is AI-specific — an OWASP Agentic, LLM or ML tree collected alongside 5Rs.
//      Zero inference: Wiz itself filed the control under an AI framework, and this module
//      only reads that filing.
//   2. LINKED FINDINGS. At least one of the policy's own open gap findings sits on a
//      resource this app has synced as an AI asset. Not "the rule sounds AI-ish" — a real
//      finding, on a real asset the AI graph already models.
//
// Neither is an inference over the rule's own metadata, and that omission is deliberate,
// not an oversight. It is tempting to also look at a rule's name, or its
// `subjectEntityType` / `targetNativeType` — both read like exactly the AI-vs-not-AI
// signal this module wants, and both were tried and rejected. src/server/api.ts:665-671
// documents why: most AI-security rules evaluate against things the AI graph does not model
// at all — a REGION standing in for a Vertex metadata store, a RAW_ACCESS_POLICY standing in
// for a Bedrock IAM policy. On a 5Rs rule, `subjectEntityType` is often the type of the
// WRONG resource, not a hint about the right one, and a name regex would be exactly the kind
// of shipped guesswork the two hard facts above exist to avoid. If a future edit reaches for
// either field to "improve" the signal, that is this same mistake again, not a fix.
//
// BE HONEST ABOUT THE LIMIT. This signal is not clairvoyant. A genuinely AI-relevant 5Rs
// rule that no OWASP framework happens to cross-map, and that has not yet failed on a
// synced AI asset, WILL be scoped out by default — see the REGION/RAW_ACCESS_POLICY case
// pinned in the test file, which is exactly that trap. That is exactly why the operator pin
// exists (ScopePins, below) and why every row reports its own `reason` rather than only its
// `selected` bit: a default that cannot see everything has to say what it did see, or it is
// the implied confidence PRODUCT.md forbids.

import { SEVERITY_ORDER, isOpenGap, type Severity } from "./config";
import type { FrameworkTree } from "./compliancePosture";
import type { FindingRow, PolicyKind } from "./graphTypes";
import { frameworkFamily } from "./syncNormalize";
import { cmp, pushInto } from "./util";

function severityRank(s: Severity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

export type ScopeReason =
  | "crossMapped" | "linkedFindings" | "noAiLink" | "pinnedIn" | "pinnedOut";

/**
 * Label + blurb per reason, the POSTURE_STATES pattern (compliancePosture.ts) — the UI
 * reads its copy from here rather than minting its own wording for a reason code.
 */
export const SCOPE_REASONS: Record<ScopeReason, { label: string; blurb: string }> = {
  crossMapped: {
    label: "Cross-mapped",
    blurb: "Wiz also files this control under a collected OWASP AI framework",
  },
  linkedFindings: {
    label: "Linked findings",
    blurb: "an open gap on this control sits on a synced AI asset",
  },
  noAiLink: {
    label: "No AI link",
    blurb: "neither signal fired — out of AI scope by default, pin it in if it belongs",
  },
  pinnedIn: {
    label: "Pinned in",
    blurb: "an operator added this control to AI scope by hand",
  },
  pinnedOut: {
    label: "Pinned out",
    blurb: "an operator removed this control from AI scope by hand",
  },
};

/** One 5Rs policy's derived — or pinned — AI-scope verdict. */
export interface PolicyScope {
  policyId: string;
  shortId?: string;
  name: string;
  policyKind: PolicyKind;
  severity: Severity;
  /** Distinct (categoryExternalId, subcategoryExternalId) pairs, so the UI can group. */
  categoryExternalId: string;
  subcategoryExternalId: string;
  subcategoryTitle: string;
  selected: boolean;
  reason: ScopeReason;
  /** Names of the AI frameworks that map it. Empty unless crossMapped applies. */
  mappedBy: string[];
  /** Open gap findings of this policy sitting on a synced AI asset. */
  aiFindingCount: number;
  failCount: number;
}

export interface FiveRsScope {
  /** null when no 5Rs framework is collected — the caller renders nothing rather than an empty card. */
  frameworkId: string | null;
  frameworkName: string;
  policies: PolicyScope[];
  selected: number;
  total: number;
}

export interface ScopePins { in: string[]; out: string[] }

/** The three families scopeFiveRs treats as "an AI framework Wiz itself collected". */
function isAiFamily(family: ReturnType<typeof frameworkFamily>): boolean {
  return family === "OWASP_ASI" || family === "OWASP_LLM" || family === "OWASP_ML";
}

/**
 * Derive (or apply the operator's pin over) the AI-relevance scope for every policy the
 * 5Rs framework maps, from the trees the sync already built.
 *
 * The 5Rs tree is found by `frameworkFamily(tree.name) === "WIZ_5RS"`, never by the id
 * `wf-id-214` — settingsLogic.ts says at length why a Wiz framework id is tenant-local and
 * why matching on the name family is the only match that survives a different tenant or a
 * new edition of the same framework. The same reasoning is why the AI frameworks a policy
 * cross-maps into are found the identical way, by family, from whatever else happens to sit
 * in `trees` — this module has no id of its own to pin them to either.
 */
export function scopeFiveRs(
  trees: FrameworkTree[],
  findings: FindingRow[],
  aiAssetIds: Record<string, true>,
  pins: ScopePins,
): FiveRsScope {
  const fiveRsTree = trees.find((t) => frameworkFamily(t.name) === "WIZ_5RS");
  if (!fiveRsTree) {
    return {
      frameworkId: null, frameworkName: "", policies: [], selected: 0, total: 0,
    };
  }

  // Signal 1 — crossMapped. Every OTHER tree in the array (the 5Rs tree is excluded so a
  // policy cannot "cross-map" into itself) whose family is one of the three AI frameworks
  // contributes its name to every policyId it maps. A Set per policy, not a list, because
  // the same policy can recur under several subcategories of the SAME AI framework and that
  // must collapse to one name, not one per mapping row.
  const mappedByPolicy = new Map<string, Set<string>>();
  for (const tree of trees) {
    if (tree === fiveRsTree) continue;
    if (!isAiFamily(frameworkFamily(tree.name))) continue;
    for (const category of tree.categories) {
      for (const sub of category.subcategories) {
        for (const p of sub.policies) {
          const names = mappedByPolicy.get(p.policyId) ?? new Set<string>();
          names.add(tree.name);
          mappedByPolicy.set(p.policyId, names);
        }
      }
    }
  }

  // Signal 2 — linkedFindings. Restricted to open gaps on a resource this app has synced as
  // an AI asset, up front, so neither a resolved/rejected/deleted row nor a finding on a
  // resource the AI graph doesn't model (the REGION/RAW_ACCESS_POLICY trap the module header
  // names) can ever contribute a count. Indexed by BOTH `ruleId` and `ruleShortId` — the
  // same two identifiers graphTypes.ts documents a FrameworkPolicyRow carries as `policyId`
  // / `shortId` — because which one a given configuration finding actually populated
  // depends on the policy kind, and matching only one would silently under-count the other.
  const aiOpenFindings = findings.filter(
    (f) => isOpenGap(f) && aiAssetIds[f.resourceId] === true,
  );
  const findingsByRuleId = new Map<string, FindingRow[]>();
  const findingsByShortId = new Map<string, FindingRow[]>();
  for (const f of aiOpenFindings) {
    if (f.ruleId) pushInto(findingsByRuleId, f.ruleId, f);
    if (f.ruleShortId) pushInto(findingsByShortId, f.ruleShortId, f);
  }

  const pinnedOut = new Set(pins.out);
  const pinnedIn = new Set(pins.in);

  interface Accumulator {
    policyId: string;
    shortId?: string;
    name: string;
    policyKind: PolicyKind;
    severity: Severity;
    categoryExternalId: string;
    subcategoryExternalId: string;
    subcategoryTitle: string;
    failCount: number;
  }

  // A policy appears once per policyId even when the 5Rs framework maps it under several
  // subcategories (buildFrameworkTree keeps every one of those mappings deliberately — see
  // compliancePosture.ts — so the same policyId legitimately recurs in this walk). The pin
  // and the verdict below are decided PER POLICY, not per mapping: keeping every mapping as
  // its own row would let one operator toggle leave a control half in scope, in scope under
  // one subcategory heading and out under another, which is not a state "is this rule
  // AI-relevant" can coherently be in. The FIRST subcategory reached wins the grouping
  // fields (categoryExternalId / subcategoryExternalId / subcategoryTitle) purely as a
  // display choice — which heading a multiply-mapped rule is shown under — and carries no
  // weight in the in/out decision itself.
  const byPolicy = new Map<string, Accumulator>();
  for (const category of fiveRsTree.categories) {
    for (const sub of category.subcategories) {
      for (const p of sub.policies) {
        let acc = byPolicy.get(p.policyId);
        if (!acc) {
          acc = {
            policyId: p.policyId,
            shortId: p.shortId,
            name: p.name,
            policyKind: p.policyKind,
            severity: p.severity,
            categoryExternalId: category.externalId,
            subcategoryExternalId: sub.externalId,
            subcategoryTitle: sub.title,
            failCount: 0,
          };
          byPolicy.set(p.policyId, acc);
        }
        // MAX, never sum — the same discipline complianceOverview.ts's sharedControls
        // applies at estate scope, applied here at the 5Rs tree's own scope: one policy is
        // evaluated once, and its fail count is simply repeated on every subcategory row it
        // maps to.
        if (p.failCount > acc.failCount) acc.failCount = p.failCount;
      }
    }
  }

  const policies: PolicyScope[] = [];
  for (const acc of byPolicy.values()) {
    // Sorted for a mappedBy list that does not depend on which position the AI tree(s)
    // happen to occupy in the `trees` array the caller passed — see the ordering test.
    const mappedBy = [...(mappedByPolicy.get(acc.policyId) ?? [])].sort();
    const crossMapped = mappedBy.length > 0;

    // Dedupe by finding id, not by count of matches: a finding whose ruleId AND ruleShortId
    // both happen to match this policy (possible when a policy's id and shortId collide
    // with each other, or simply through the OR itself) must count once, not twice.
    const matched = new Map<string, FindingRow>();
    for (const f of findingsByRuleId.get(acc.policyId) ?? []) matched.set(f.id, f);
    if (acc.shortId) {
      for (const f of findingsByShortId.get(acc.shortId) ?? []) matched.set(f.id, f);
    }
    const aiFindingCount = matched.size;

    // Pins beat derivation in BOTH directions, so the UI can trust `reason` to say who
    // actually decided — an operator's call is never re-labelled as something the estate
    // "found" on its own. `out` is checked FIRST: a policyId stored in both lists is a
    // contradiction cleanFiveRsPins (settingsLogic.ts) should already have resolved before
    // it reaches here, but this function does not trust that it was, and re-applies the
    // same conservative tie-break (scoping a control OUT of AI review is the safer
    // direction to err in when the two disagree about what the operator meant) rather than
    // silently picking whichever list this loop happened to check last.
    let selected: boolean;
    let reason: ScopeReason;
    if (pinnedOut.has(acc.policyId)) {
      selected = false;
      reason = "pinnedOut";
    } else if (pinnedIn.has(acc.policyId)) {
      selected = true;
      reason = "pinnedIn";
    } else if (crossMapped) {
      selected = true;
      reason = "crossMapped";
    } else if (aiFindingCount > 0) {
      selected = true;
      reason = "linkedFindings";
    } else {
      selected = false;
      reason = "noAiLink";
    }

    policies.push({
      policyId: acc.policyId,
      shortId: acc.shortId,
      name: acc.name,
      policyKind: acc.policyKind,
      severity: acc.severity,
      categoryExternalId: acc.categoryExternalId,
      subcategoryExternalId: acc.subcategoryExternalId,
      subcategoryTitle: acc.subcategoryTitle,
      selected,
      reason,
      mappedBy,
      aiFindingCount,
      failCount: acc.failCount,
    });
  }

  // Out-of-scope first (that is what the operator came to this page to review), then worst
  // severity, then failCount desc, then name — fully deterministic, so nothing is left to
  // whichever order Map#values() happened to visit policies in, or to which order the
  // caller's `trees` array happened to list its frameworks.
  policies.sort((a, b) => (a.selected === b.selected ? 0 : a.selected ? 1 : -1)
    || severityRank(a.severity) - severityRank(b.severity)
    || b.failCount - a.failCount
    || cmp(a.name, b.name));

  return {
    frameworkId: fiveRsTree.frameworkId,
    frameworkName: fiveRsTree.name,
    policies,
    selected: policies.filter((p) => p.selected).length,
    total: policies.length,
  };
}

/** The policyIds to drop. Empty when there is no 5Rs tree. */
export function unselectedPolicyIds(scope: FiveRsScope): string[] {
  return scope.policies.filter((p) => !p.selected).map((p) => p.policyId);
}
