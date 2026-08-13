// Everything the Toxic Combinations page counts, in one pure pass.
//
// `toxicCombos.ts` stays the taxonomy — which patterns exist, what the source rule tests,
// how the 5Rs amplifier re-rates them. This module is the measured half: how many issues
// and assets each pattern actually holds right now, which risk conditions those assets
// actually carry, what the amplifier did to the severity mix, and where the SLA stands.
//
// The two halves are deliberately separate because the matrix shows them side by side: a
// rule TESTS a condition (declared, and often disjunctively — "high privileges OR
// sensitive data access"), while its assets CARRY one (measured). A cell that shows only
// the declared half explains nothing about this tenant; one that shows only the measured
// half can't say which conditions define the pattern and which are extra risk piled on
// top. INTERNET_EXPOSURE is in no rule's condition list, so every mark in that column is
// the second kind.
//
// `nowIso` is injected rather than read from the clock so the SLA arithmetic is testable.

import { SEVERITY_ORDER } from "./config";
import type { Severity } from "./config";
import type { GNode, IssueRow } from "./graphTypes";
import { conditionState } from "./riskConditions";
import { countBySeverity } from "./severity";
import { CONDITION_KEYS, COMBO_GROUPS, comboSummary } from "./toxicCombos";
import type { ConditionKey } from "./toxicCombos";

/**
 * An issue is "due soon" inside this many days. Mirrored by slaState() in
 * src/client/js/pages/comboView.js (the client bundle can't import a TS module) — the
 * KPI and the per-row pill must not disagree about what "due soon" means.
 */
export const DUE_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ConditionTally {
  /** The source rule tests this condition — it is part of what defines the pattern. */
  required: boolean;
  /** Affected assets that actually carry it. */
  carried: number;
  /** Affected assets whose flag is undetermined (exposure inherited from a host). */
  unknown: number;
  /** Affected assets the inventory could resolve — the denominator for the two above. */
  total: number;
}

export interface ComboGroupDigest {
  id: string;
  /** Open issues in this pattern. */
  count: number;
  /** Distinct affected assets. Not the issue count: one asset can hold several issues. */
  assetCount: number;
  conditions: Record<ConditionKey, ConditionTally>;
  nativeMix: Record<string, number>;
  adjustedMix: Record<string, number>;
  /** Issues the amplifier moved. */
  reRated: number;
  pastDue: number;
  dueSoon: number;
  /** Issues carrying no readable deadline — so the SLA figures never imply full cover. */
  noDueDate: number;
}

export interface ComboTotals {
  totalOpen: number;
  /** Distinct assets across every pattern (an asset in two patterns counts once). */
  assetsAffected: number;
  patternsActive: number;
  patternsTotal: number;
  nativeMix: Record<string, number>;
  adjustedMix: Record<string, number>;
  reRated: number;
  pastDue: number;
  dueSoon: number;
  noDueDate: number;
}

export interface ComboDigest {
  totals: ComboTotals;
  /** In COMBO_GROUPS order; ranking for display is the client's call. */
  groups: ComboGroupDigest[];
}

/**
 * Does this asset carry the condition? The predicates live in riskConditions.ts, shared
 * with the graph's topology builders — this side used to read only
 * `isAccessibleFromInternet` while the graph also read `isOpenToAllInternet`, so the two
 * pages disagreed about the same asset.
 */
const carriesCondition = conditionState;

/** Severity mixes read off a field that isn't called `severity`. */
function mixOf(issues: IssueRow[], field: "nativeSeverity" | "adjustedSeverity") {
  // countBySeverity gates on a literal `severity` key (it is the port of the pandas
  // version, which gated on the column), so the rows are projected onto that name.
  return countBySeverity(issues.map((i) => ({ severity: i[field] })));
}

function daysUntil(dueAt: string | undefined, nowMs: number): number | null {
  const t = Date.parse(dueAt || "");
  if (Number.isNaN(t)) return null;
  return Math.round((t - nowMs) / DAY_MS);
}

interface SlaTally { pastDue: number; dueSoon: number; noDueDate: number }

function slaTally(issues: IssueRow[], nowMs: number): SlaTally {
  const out: SlaTally = { pastDue: 0, dueSoon: 0, noDueDate: 0 };
  for (const issue of issues) {
    const days = daysUntil(issue.dueAt, nowMs);
    if (days === null) out.noDueDate += 1;
    else if (days < 0) out.pastDue += 1;
    else if (days <= DUE_SOON_DAYS) out.dueSoon += 1;
  }
  return out;
}

function emptyConditions(): Record<ConditionKey, ConditionTally> {
  const out = {} as Record<ConditionKey, ConditionTally>;
  for (const key of CONDITION_KEYS) {
    out[key] = { required: false, carried: 0, unknown: 0, total: 0 };
  }
  return out;
}

function reRatedCount(issues: IssueRow[]): number {
  return issues.filter((i) => i.nativeSeverity !== i.adjustedSeverity).length;
}

/**
 * Roll up the OPEN toxic-combination issues and the assets they land on.
 *
 * `issues` may be the whole issue set — only OPEN rows count, exactly as comboSummary
 * treats them, so the page and the graph never disagree about the denominator.
 */
export function comboDigest(issues: IssueRow[], assets: GNode[], nowIso: string): ComboDigest {
  const nowMs = Date.parse(nowIso);
  const byAsset = new Map(assets.map((a) => [a.id, a]));
  const open = issues.filter((i) => i.status === "OPEN");
  const summaries = comboSummary(issues);
  const summaryById = new Map(summaries.map((s) => [s.group.id, s]));

  const groups: ComboGroupDigest[] = COMBO_GROUPS.map((group) => {
    const summary = summaryById.get(group.id);
    const assetIds = summary ? summary.assetIds : [];
    const rows = open.filter((i) => i.comboGroup === group.id);
    const conditions = emptyConditions();
    const declared = new Set<string>(group.conditions);
    for (const key of CONDITION_KEYS) conditions[key].required = declared.has(key);

    for (const id of assetIds) {
      const asset = byAsset.get(id);
      if (!asset) continue; // an issue naming an asset the inventory doesn't hold
      for (const key of CONDITION_KEYS) {
        const tally = conditions[key];
        tally.total += 1;
        const carried = carriesCondition(asset, key);
        if (carried === null) tally.unknown += 1;
        else if (carried) tally.carried += 1;
      }
    }

    const sla = slaTally(rows, nowMs);
    return {
      id: group.id,
      count: summary ? summary.count : 0,
      assetCount: assetIds.length,
      conditions,
      nativeMix: mixOf(rows, "nativeSeverity"),
      adjustedMix: mixOf(rows, "adjustedSeverity"),
      reRated: reRatedCount(rows),
      pastDue: sla.pastDue,
      dueSoon: sla.dueSoon,
      noDueDate: sla.noDueDate,
    };
  });

  // Estate totals are taken over the classified issues only — the same population the
  // four patterns describe — so the KPI row and the cards add up.
  const classified = open.filter((i) => summaryById.has(i.comboGroup));
  const affected = new Set<string>();
  for (const s of summaries) for (const id of s.assetIds) affected.add(id);
  const sla = slaTally(classified, nowMs);

  return {
    totals: {
      totalOpen: classified.length,
      assetsAffected: affected.size,
      patternsActive: groups.filter((g) => g.count > 0).length,
      patternsTotal: COMBO_GROUPS.length,
      nativeMix: mixOf(classified, "nativeSeverity"),
      adjustedMix: mixOf(classified, "adjustedSeverity"),
      reRated: reRatedCount(classified),
      pastDue: sla.pastDue,
      dueSoon: sla.dueSoon,
      noDueDate: sla.noDueDate,
    },
    groups,
  };
}

/** Worst-first, for anything that needs to rank a severity mix. */
export function worstSeverity(mix: Record<string, number>): Severity | null {
  for (const sev of SEVERITY_ORDER) {
    if (mix[sev]) return sev;
  }
  return null;
}
