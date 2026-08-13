// The four risk conditions, as one set of predicates over a node.
//
// These were written twice: once in graphEnrich, to decide whether to hang a synthetic
// risk node off an asset, and once in comboDigest.carriesCondition, to decide whether an
// asset counts toward a column of the Toxic Combinations matrix. Three of the four agreed.
// INTERNET_EXPOSURE did not: the graph treated `isOpenToAllInternet === true` as exposure
// and the matrix read only `isAccessibleFromInternet`, so an asset open to the whole
// internet but with `isAccessibleFromInternet: false` was drawn as a definite exposure on
// one page and reported as definitely NOT exposed on the other.
//
// One table, two consumers, so they cannot disagree again.

import type { GNode } from "./graphTypes";
import type { ConditionKey } from "./toxicCombos";

/**
 * `null` means undetermined rather than absent, and only INTERNET_EXPOSURE can be it: a
 * hosted agent inherits its exposure from the VM or Cloud Run service underneath it, and
 * Wiz reports that as unknown. Folding it into `false` would quietly under-report
 * exposure, so the matrix counts and renders it as its own thing.
 *
 * The other three read a flag on the resource itself, where an unset value is a definite
 * no — a bucket has no guardrail to be missing. They stay strictly boolean, as they were.
 */
export type ConditionState = boolean | null;

export function conditionState(node: GNode, key: ConditionKey): ConditionState {
  switch (key) {
    case "MISSING_GUARDRAIL":
      return node.guardrailMissing === true;
    case "EXCESSIVE_PRIVILEGE":
      return node.hasAdminPrivileges === true || node.hasHighPrivileges === true;
    case "SENSITIVE_DATA":
      return node.hasSensitiveData === true || node.hasAccessToSensitiveData === true;
    case "INTERNET_EXPOSURE": {
      // Either flag counts. `isOpenToAllInternet` is the STRONGER signal of the two, so
      // reading only `isAccessibleFromInternet` (as this side used to) under-reports the
      // worse case. Undetermined only when neither is set to true and at least one is
      // genuinely unknown.
      const reachable = node.isAccessibleFromInternet;
      const openToAll = node.isOpenToAllInternet;
      if (reachable === true || openToAll === true) return true;
      const unknown = (v: boolean | null | undefined) => v === null || v === undefined;
      return unknown(reachable) || unknown(openToAll) ? null : false;
    }
  }
}

/**
 * The strict reading, for the topology builders: only an explicitly-set flag draws a risk
 * node. Undetermined must NOT be drawn as a definite exposure — the graph is a claim about
 * what is true, and "we don't know" is not one.
 */
export function conditionHolds(node: GNode, key: ConditionKey): boolean {
  return conditionState(node, key) === true;
}
