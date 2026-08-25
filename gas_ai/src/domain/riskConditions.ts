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
 * `null` means undetermined rather than absent, and ALL FOUR conditions can be it.
 *
 * This used to say the other three "read a flag on the resource itself, where an unset value
 * is a definite no — a bucket has no guardrail to be missing", and stayed strictly boolean on
 * that basis. The live tenant falsified it. Wiz returns `null` — never evaluated — for the
 * privilege and sensitive-data flags on 753 of 822 assets, and `guardrailMissing` is only
 * ever set TRUE (the coverage scan is a negated traversal), so an unset value there has never
 * once meant "we looked and a guardrail is attached". The normalizer and the store were
 * collapsing all of that to `false` before it reached here; now they do not, and this
 * predicate has to be able to say so.
 *
 * The old sentence was right about ONE thing and it is worth keeping: an unset flag on a kind
 * the flag does not APPLY to — a bucket has no guardrail, a dataset has no execution identity
 * — is a different fact from an unmeasured one. This function cannot tell them apart, and
 * deliberately does not try: it reports what was observed, and applicability is the
 * caller’s question. What it must never do again is report an assumption as an observation.
 *
 * Reading, for every case: `true` when any source says so; `false` only when every source
 * gave a definite negative; `null` when nothing said yes and at least one source never
 * answered. That is the same rule INTERNET_EXPOSURE already used, applied to all four.
 */
export type ConditionState = boolean | null;

/**
 * The tri-state OR the three flag-reading conditions share: a positive from any source wins,
 * a definite negative needs EVERY source to have answered, and anything else is undetermined.
 * Written once because the three cases below drifted apart the last time they were written
 * out separately — see this file’s own header.
 */
function anyTrue(sources: ReadonlyArray<boolean | null | undefined>): ConditionState {
  if (sources.some((v) => v === true)) return true;
  if (sources.some((v) => v === null || v === undefined)) return null;
  return false;
}

export function conditionState(node: GNode, key: ConditionKey): ConditionState {
  switch (key) {
    case "MISSING_GUARDRAIL":
      // True-or-absent on live data: syncNormalize sets this flag only when the negated
      // guardrail traversal returns the asset, so `false` here means the scan reached this
      // asset and found a guardrail, and `undefined` means it never reached it at all.
      return anyTrue([node.guardrailMissing]);
    case "EXCESSIVE_PRIVILEGE":
      return anyTrue([node.hasAdminPrivileges, node.hasHighPrivileges]);
    case "SENSITIVE_DATA":
      return anyTrue([node.hasSensitiveData, node.hasAccessToSensitiveData]);
    case "INTERNET_EXPOSURE": {
      // Topology first. A hosted AI asset carries NO exposure flags of its own — Wiz reports
      // them on the compute underneath — which is why this used to answer `null` forever for
      // exactly the assets most worth knowing about. The two exposure steps walk that hop
      // (domain/exposureQuery.ts) and `withExposureEvidence` folds what they find onto the
      // asset; reading it here is what makes one answer serve the Inventory, the combos
      // matrix, the graph stub and AARS pillar D.
      //
      // This can only ever UPGRADE. Absent evidence falls straight through to the flags, so
      // an asset the steps never reached scores exactly as it did before they existed, and
      // nothing here can turn a definite `false` into a `true` on its own — the evidence is
      // a positive finding or it is not present at all.
      const evidence = node.exposureEvidence;
      if (evidence) {
        const hosts = evidence.hostIds ?? [];
        const endpoints = evidence.endpointIds ?? [];
        if (hosts.length > 0 || endpoints.length > 0) return true;
      }
      // Either flag counts. `isOpenToAllInternet` is the STRONGER signal of the two, so
      // reading only `isAccessibleFromInternet` (as this side used to) under-reports the
      // worse case. Undetermined only when neither is set to true and at least one is
      // genuinely unknown — which is exactly `anyTrue`, the rule the other three now share.
      return anyTrue([node.isAccessibleFromInternet, node.isOpenToAllInternet]);
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
