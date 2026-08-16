// The Compliance Overview page's cross-framework read model — the estate-wide rollups
// (a framework rail, the weakest subcategories, the controls worth fixing once, and what
// is and is not covered) built ON TOP of the trees compliancePosture.ts already assembles.
// This file adds no new source of truth: every row below is a projection or a regroup of
// a FrameworkTree, never a re-derivation of a score compliancePosture.ts already computed.
//
// THE SAME RULE GOVERNS THIS FILE AS compliancePosture.ts: a posture that does not exist
// is never a zero. Rolling several frameworks or subcategories together multiplies the
// ways that mistake can hide — an average, a sort, a rank all silently accept a stray
// `?? 0` — so every rollup here either carries `posturePct: number | null` straight
// through untouched, or keeps the unscored rows apart in their own, unranked group. None
// of it re-derives `state`: a row's `state` already resolved the "number vs. reason"
// contradiction (see postureState in compliancePosture.ts), and re-checking `posturePct`
// directly here would risk re-opening exactly that bug.
//
// The second discipline this file adds is SCOPE, widened from "per framework"
// (compliancePosture.ts) to "across the whole estate": `sharedControls` below applies the
// same distinct-by-policy-id, max-not-sum rule buildFrameworkTree applies WITHIN one
// framework (see compliancePosture.ts:258-265), but now across every framework a control
// happens to be mapped into. Get the scope wrong in either direction and the one number
// this page exists to report — "how many frameworks would ONE fix satisfy" — is wrong.

import { SEVERITY_ORDER, type Severity } from "./config";
import type { FrameworkTree, PostureState } from "./compliancePosture";
import type {
  EmptyPostureReason, FrameworkRow, PolicyKind,
} from "./graphTypes";

// Not imported from compliancePosture.ts — its own severityRank is a private helper, and
// this file does not touch that one. Same tiny idiom, kept local on purpose so the two
// files stay decoupled at the module boundary rather than sharing an unexported symbol.
function severityRank(s: Severity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** One framework's row on the shared 0-100 axis. */
export interface FrameworkRailRow {
  frameworkId: string;
  name: string;
  posturePct: number | null;
  state: PostureState;
  emptyPostureReason: EmptyPostureReason | null;
  categoryCount: number;
  subcategoryCount: number;
  policyCount: number;
  failingPolicyCount: number;
  /** Worst severity among this framework's FAILING policies. Null when none are failing. */
  worstFailingSeverity: Severity | null;
  stateCounts: Record<PostureState, number>;
}

/**
 * Every framework as one row on the shared axis, in the order buildAllFrameworkTrees
 * already established: worst-scored first, unscored LAST (not as a zero - an unassessed
 * framework is not the worst, it is unknown). A projection, never a re-sort: re-sorting
 * here risks silently disagreeing with the ordering buildAllFrameworkTrees already
 * committed to, for no benefit — the rail's whole job is to agree with it.
 */
export function frameworkRail(trees: FrameworkTree[]): FrameworkRailRow[] {
  return trees.map((tree) => ({
    frameworkId: tree.frameworkId,
    name: tree.name,
    posturePct: tree.posturePct,
    state: tree.state,
    emptyPostureReason: tree.emptyPostureReason,
    categoryCount: tree.categories.length,
    subcategoryCount: tree.categories.reduce((sum, c) => sum + c.subcategories.length, 0),
    policyCount: tree.policyCount,
    failingPolicyCount: tree.failingPolicyCount,
    worstFailingSeverity: tree.worstFailingSeverity,
    // Copied rather than aliased: a caller holding this row must not be able to mutate
    // the FrameworkTree it was built from by mutating what looks like its own object.
    stateCounts: { ...tree.stateCounts },
  }));
}

/** One subcategory, flattened out of its framework. */
export interface WeakAreaRow {
  frameworkId: string;
  frameworkName: string;
  categoryExternalId: string;
  categoryTitle: string;
  externalId: string;
  showExternalId: boolean;
  title: string;
  posturePct: number | null;
  state: PostureState;
  emptyPostureReason: EmptyPostureReason | null;
  passCount: number;
  failCount: number;
  policyCount: number;
  failingPolicyCount: number;
}

/**
 * True when a row's `state` already resolved to "scored" — the one field allowed to
 * decide which bucket a row falls into below. A type guard rather than a bare
 * `!== null` check on `posturePct`, because the two are not always the same fact: a row
 * carrying both a number AND an emptyPostureReason reads as "unknown" (postureState
 * trusts the reason over the number), and sorting it as scored would score a value Wiz
 * itself disowned.
 */
function isScoredRow(row: WeakAreaRow): row is WeakAreaRow & { posturePct: number } {
  return row.state === "scored";
}

/**
 * Subcategories across every framework, weakest first.
 *
 * Scored rows sort ascending by posturePct (ties broken by failingPolicyCount desc, then
 * framework name, then title, so the order is stable). Unscored rows come AFTER every
 * scored row - they are listed because "nobody wrote a check for this" is a finding about
 * the programme, but they are not ranked, because there is no number to rank them by.
 * `limit` caps the returned rows; omit for all.
 */
export function weakestAreas(trees: FrameworkTree[], limit?: number): WeakAreaRow[] {
  const rows: WeakAreaRow[] = [];
  for (const tree of trees) {
    for (const category of tree.categories) {
      for (const sub of category.subcategories) {
        // A scored subcategory with no policies behind it is not a focus target, and this
        // band is nothing but a focus list. Two different things produce that shape and
        // neither is actionable: Wiz wrote no check that maps here, or this app scoped
        // every rule that does out of its view. The second is the sharper case — the 5Rs'
        // "Unlabelled sensitive data" carries Wiz's 62% whether or not we look at its
        // rules, so without this it sorts to the TOP of the estate's weakest areas while
        // offering nothing to fix. The percentage stays true and stays visible in the
        // register; it just stops being advice.
        //
        // Unscored subcategories are exempt: they are already listed rather than ranked
        // (see the partition below), and dropping them here would delete the honest-state
        // rows this band exists to keep visible.
        if (sub.state === "scored" && !sub.policies.length) continue;
        rows.push({
          frameworkId: tree.frameworkId,
          frameworkName: tree.name,
          categoryExternalId: category.externalId,
          categoryTitle: category.title,
          externalId: sub.externalId,
          showExternalId: sub.showExternalId,
          title: sub.title,
          posturePct: sub.posturePct,
          state: sub.state,
          emptyPostureReason: sub.emptyPostureReason,
          passCount: sub.passCount,
          failCount: sub.failCount,
          // Distinct policies THIS subcategory carries. buildFrameworkTree already
          // deduped `policies` to that scope (compliancePosture.ts:190), so re-deduping
          // here would be the wrong scope all over again — count the list as given.
          policyCount: sub.policies.length,
          failingPolicyCount: sub.failingPolicyCount,
        });
      }
    }
  }

  // Partitioned into two arrays rather than sorted with one comparator, so "unscored
  // rows are not ranked" is structural, not a comparator convention a future edit could
  // erode by adding one more `||` clause to the scored branch.
  const scored: (WeakAreaRow & { posturePct: number })[] = [];
  const unscored: WeakAreaRow[] = [];
  for (const row of rows) {
    if (isScoredRow(row)) scored.push(row);
    else unscored.push(row);
  }

  scored.sort((a, b) => a.posturePct - b.posturePct
    || b.failingPolicyCount - a.failingPolicyCount
    || (a.frameworkName < b.frameworkName ? -1 : a.frameworkName > b.frameworkName ? 1 : 0)
    || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  // Unscored rows keep the order they were discovered in (framework rail order, then
  // category, then subcategory — all already deterministic) rather than being sorted
  // alphabetically or any other way that would manufacture a ranking the data does not
  // support.
  const ordered = [...scored, ...unscored];
  return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
}

/** One failing control and every framework that raises it. */
export interface SharedControlRow {
  policyId: string;
  shortId?: string;
  name: string;
  policyKind: PolicyKind;
  severity: Severity;
  hasAutoRemediation: boolean;
  /** Distinct, in the order the frameworks appear in `trees`. */
  frameworkIds: string[];
  frameworkNames: string[];
  frameworkCount: number;
  /** Distinct (frameworkId, subcategoryExternalId) pairs this control maps to. */
  subcategoryCount: number;
  failCount: number;
}

/** Running totals for one policyId while `sharedControls` walks every tree. */
interface ControlAccumulator {
  policyId: string;
  shortId?: string;
  name: string;
  policyKind: PolicyKind;
  severity: Severity;
  severityRank: number;
  hasAutoRemediation: boolean;
  frameworkIds: string[];
  frameworkNames: string[];
  subcategoryKeys: Set<string>;
  failCount: number;
}

/**
 * Failing controls, ranked by how many frameworks one fix would satisfy.
 *
 * Walks every subcategory's already-deduped `policies` list (one row per (framework,
 * subcategory, policy) edge — see FrameworkPolicyRow in graphTypes.ts) and regroups by
 * `policyId` alone, at the scope of the WHOLE estate. That is a wider dedupe than
 * buildFrameworkTree performs (which only dedupes within one subcategory, deliberately
 * preserving the many-to-many mapping — compliancePosture.ts:184-190), and it is the
 * correct one here: the question this function answers is "if I fix this ONE control,
 * how much of the programme moves", which is a fact about the control, not about any one
 * framework's tree.
 */
export function sharedControls(trees: FrameworkTree[]): SharedControlRow[] {
  const byPolicy = new Map<string, ControlAccumulator>();

  for (const tree of trees) {
    for (const category of tree.categories) {
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
              severityRank: severityRank(p.severity),
              hasAutoRemediation: p.hasAutoRemediation === true,
              frameworkIds: [],
              frameworkNames: [],
              subcategoryKeys: new Set(),
              failCount: 0,
            };
            byPolicy.set(p.policyId, acc);
          }

          // Worst severity across every mapping row describes the control, so one
          // described inconsistently across frameworks (framework A calls it MEDIUM,
          // framework B calls it CRITICAL) reports its worst face rather than whichever
          // row this loop happened to visit first.
          const rank = severityRank(p.severity);
          if (rank < acc.severityRank) {
            acc.severityRank = rank;
            acc.severity = p.severity;
            acc.shortId = p.shortId;
            acc.name = p.name;
            acc.policyKind = p.policyKind;
            acc.hasAutoRemediation = p.hasAutoRemediation === true;
          }

          if (acc.frameworkIds.indexOf(tree.frameworkId) === -1) {
            acc.frameworkIds.push(tree.frameworkId);
            acc.frameworkNames.push(tree.name);
          }
          acc.subcategoryKeys.add(`${tree.frameworkId}|${sub.externalId}`);

          // MAX, never sum. One policy is evaluated ONCE against the estate; its
          // pass/fail counts are simply repeated on every (framework, subcategory)
          // mapping row it appears on, which is the exact discipline buildFrameworkTree
          // applies when it dedupes a policy WITHIN one subcategory
          // (compliancePosture.ts:261-265) — this is that same rule at the wider,
          // cross-framework scope. Summing here would report fixing a control once as
          // fixing it three times, and would make the KPI that reconciles against this
          // function (complianceKpis' failingPolicies) impossible to agree with.
          if (p.failCount > acc.failCount) acc.failCount = p.failCount;
        }
      }
    }
  }

  const rows: SharedControlRow[] = [];
  for (const acc of byPolicy.values()) {
    // A passing control has nothing to fix and no leverage to report — this is also what
    // keeps this function's count reconciled with complianceKpis().failingPolicies,
    // which counts the identical thing the identical way.
    if (acc.failCount <= 0) continue;
    rows.push({
      policyId: acc.policyId,
      shortId: acc.shortId,
      name: acc.name,
      policyKind: acc.policyKind,
      severity: acc.severity,
      hasAutoRemediation: acc.hasAutoRemediation,
      frameworkIds: acc.frameworkIds,
      frameworkNames: acc.frameworkNames,
      frameworkCount: acc.frameworkIds.length,
      subcategoryCount: acc.subcategoryKeys.size,
      failCount: acc.failCount,
    });
  }

  // frameworkCount desc, then worst severity, then failCount desc, then name — fully
  // deterministic, so nothing here is left to whatever order Map#values() happened to
  // visit policies in.
  rows.sort((a, b) => b.frameworkCount - a.frameworkCount
    || severityRank(a.severity) - severityRank(b.severity)
    || b.failCount - a.failCount
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return rows;
}

/** What the estate is - and is not - measuring. */
export interface CoverageSummary {
  /** Frameworks with stored posture. */
  collected: number;
  /** Frameworks in the tenant catalogue. */
  catalogued: number;
  scoredFrameworks: number;
  /** Every subcategory across every framework, by state. */
  stateCounts: Record<PostureState, number>;
  subcategoryCount: number;
}

/**
 * Counts, not names.
 *
 * This used to return `uncollected` — every catalogue entry with no stored posture, by
 * name — for a Coverage band that listed them. On the sample estate that was one row; on a
 * real tenant it was thirty-seven, and the band was deleted for printing a framework
 * catalogue where a finding belonged. With the band went the only reader, and a payload
 * carrying thirty-seven objects nothing renders is not neutral: it ships on every read of
 * a page that is already sent whole.
 *
 * `collected` vs `catalogued` still states the same fact, and the headline strip draws it
 * as "Frameworks 4 of 41". The difference between those two numbers is the count that was
 * ever worth reporting; which particular frameworks make it up is a question for Settings,
 * where the answer is actionable rather than merely long.
 *
 * `collected` counts TREES, not selections. A framework the tenant later disabled still has
 * a tree if `posture` mentions it — buildFrameworkTree builds one for every id it sees,
 * regardless of the catalogue's flags — and is rightly counted; a framework this app was
 * told to sync but nothing has come back for yet has none. What was asked for and what has
 * landed are different questions, and this one answers the second.
 */
export function coverageSummary(
  trees: FrameworkTree[],
  catalogue: FrameworkRow[],
): CoverageSummary {
  const stateCounts: Record<PostureState, number> = {
    scored: 0, noResources: 0, noPolicies: 0, unknown: 0,
  };
  let subcategoryCount = 0;
  for (const tree of trees) {
    stateCounts.scored += tree.stateCounts.scored;
    stateCounts.noResources += tree.stateCounts.noResources;
    stateCounts.noPolicies += tree.stateCounts.noPolicies;
    stateCounts.unknown += tree.stateCounts.unknown;
    for (const category of tree.categories) subcategoryCount += category.subcategories.length;
  }

  return {
    collected: trees.length,
    catalogued: catalogue.length,
    scoredFrameworks: trees.filter((t) => t.state === "scored").length,
    stateCounts,
    subcategoryCount,
  };
}
