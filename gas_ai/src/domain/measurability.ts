// Which flags a KIND can even carry, and whether Wiz actually answered — one table, so the
// readers cannot disagree again. Written for the same reason riskConditions.ts was: the
// question "is this flag absent because nobody looked, or because it does not apply?" was
// being answered three different ways by three different callers, and all three answers were
// the same wrong one, because syncNormalize collapsed `null` to `false` before any of them
// could tell.
//
// THREE STATES, NOT TWO, AND THE THIRD IS NOT A COVERAGE GAP.
//
//   MEASURED        Wiz stated a value. Believe it.
//   UNMEASURED      the flag applies to this kind and Wiz did not answer. A COVERAGE GAP —
//                   someone can go and fix it, and reach.ts should count it.
//   NOT_APPLICABLE  the flag cannot be true or false of this kind. A dataset has no execution
//                   identity; an agent holds no data of its own. NOT a coverage gap, and
//                   counting it as one would leave the register permanently ~90% "incomplete"
//                   with nothing anyone could do about it.
//
// WHY THE TABLE IS DELIBERATELY NARROW. On the reference tenant the identity flags are null
// for 753 of 822 assets, and it is tempting to declare every kind that reads all-null as
// non-applicable — that would make the numbers tidy and it would be a guess. Wiz's own rule
// `wc-id-3231` is "PaaS AI Model with high privileges or sensitive data access", so Wiz plainly
// DOES associate privileges with AI_MODEL, even though this tenant's inventory returns null for
// all 86 of them. Declaring AI_MODEL non-applicable would hide a real coverage gap permanently,
// and it is exactly the inference this module exists to stop.
//
// So NOT_APPLICABLE is asserted ONLY where the kind structurally cannot carry the flag — a
// dataset is not a principal, an agent is not a store — and everything else that is absent
// reads UNMEASURED. The bias is toward admitting ignorance, which is the whole point.

import type { GNode, NodeKind } from "./graphTypes";
import { GUARDRAIL_SUBJECT_KINDS } from "./agentPathQuery";

export type Measurement = "MEASURED" | "UNMEASURED" | "NOT_APPLICABLE";

/** The tri-state flags this module governs. The internet pair is included for completeness. */
export type FlagKey =
  | "hasAdminPrivileges"
  | "hasHighPrivileges"
  | "hasAccessToSensitiveData"
  | "hasSensitiveData"
  | "guardrailMissing"
  | "isAccessibleFromInternet"
  | "isOpenToAllInternet";

export const FLAG_KEYS: readonly FlagKey[] = [
  "hasAdminPrivileges", "hasHighPrivileges", "hasAccessToSensitiveData",
  "hasSensitiveData", "guardrailMissing", "isAccessibleFromInternet", "isOpenToAllInternet",
];

/** "What identity does this run as" — admin/high privilege, and reach into classified data. */
const IDENTITY_FLAGS: readonly FlagKey[] = [
  "hasAdminPrivileges", "hasHighPrivileges", "hasAccessToSensitiveData",
];

/**
 * Kinds that structurally have NO execution identity, so an identity flag cannot be true or
 * false of them. Narrow on purpose (see this file's header): a dataset and a bucket are data at
 * rest, and a permission or binding row DESCRIBES a grant rather than being a principal holding
 * one. Every other kind — including AI_MODEL, AI_TOOL and AI_SERVICE, whose flags read all-null
 * on the reference tenant — is left APPLICABLE, so their absence reads as the coverage gap it
 * may well be.
 */
const NON_PRINCIPAL_KINDS: readonly NodeKind[] = [
  "AI_DATASET", "BUCKET", "DATABASE", "DATABASE_SERVER",
  "ACCESS_ROLE_PERMISSION", "IAM_BINDING", "ACCESS_ROLE_BINDING",
];

/**
 * Kinds that structurally hold NO content of their own, so `hasSensitiveData` cannot be true or
 * false of them — their relationship to data is REACH, which is `hasAccessToSensitiveData`, a
 * different flag. Evidence: `hasSensitiveData` is null on 69 of 69 AI_AGENT rows while
 * `hasAccessToSensitiveData` is answered on all 69. That split is this distinction, stated as
 * data rather than as an opinion.
 */
const NON_STORE_KINDS: readonly NodeKind[] = [
  "AI_AGENT", "SERVICE_ACCOUNT", "USER_ACCOUNT", "ACCESS_ROLE", "ACCESS_KEY",
  "ACCESS_ROLE_PERMISSION", "IAM_BINDING", "ACCESS_ROLE_BINDING",
];

/**
 * Whether a flag can apply to a kind at all.
 *
 * `guardrailMissing` defers to `GUARDRAIL_SUBJECT_KINDS` — the scan's OWN root set, reused
 * rather than restated, because a guardrail absence asserted over a population the scan never
 * queries is a fabricated finding. agentPathQuery.ts makes that argument for the QUERY; this is
 * the same argument applied to the READ.
 */
export function flagApplies(kind: string, flag: FlagKey): boolean {
  if (flag === "guardrailMissing") return GUARDRAIL_SUBJECT_KINDS.includes(kind);
  if (flag === "hasSensitiveData") return !(NON_STORE_KINDS as readonly string[]).includes(kind);
  if ((IDENTITY_FLAGS as readonly string[]).includes(flag)) {
    return !(NON_PRINCIPAL_KINDS as readonly string[]).includes(kind);
  }
  return true; // the internet pair applies to anything that can sit on a network
}

/**
 * The three-state reading for one flag on one node.
 *
 * ORDER IS LOAD-BEARING. A present boolean is MEASURED whatever the table says — the table
 * declares where Wiz does not ANSWER, and if it answered, the answer wins. Two things follow,
 * and both are why this checks the value before the table:
 *
 *   - It is migration-free and seed-immune. `sampleData.node()` writes an explicit `false` for
 *     every flag on every kind, so every pinned figure in the ordinality tests keeps reading
 *     MEASURED and nothing re-baselines.
 *   - It makes the table FALSIFIABLE rather than merely opinionated. `flagCensus` counts any
 *     kind declared non-applicable that returns a boolean anyway, and a test fails on it — so a
 *     wrong entry above is a build failure, not a silent misreading.
 */
export function flagMeasurement(node: GNode, flag: FlagKey): Measurement {
  const v = (node as unknown as Record<string, unknown>)[flag];
  if (v === true || v === false) return "MEASURED";
  return flagApplies(node.kind, flag) ? "UNMEASURED" : "NOT_APPLICABLE";
}

export interface FlagCensusCell {
  measured: number;
  unmeasured: number;
  notApplicable: number;
  /** Rows whose kind is declared non-applicable and which carried a boolean anyway. */
  contradictions: number;
}

/**
 * Per flag, per kind: what was measured, what is missing, what does not apply, and where the
 * declaration above is contradicted by the data. That last column is the point — it is what
 * turns this table from an opinion into a claim a test can reject.
 */
export function flagCensus(
  nodes: readonly GNode[],
): Record<FlagKey, Record<string, FlagCensusCell>> {
  const out = {} as Record<FlagKey, Record<string, FlagCensusCell>>;
  for (const flag of FLAG_KEYS) {
    const byKind: Record<string, FlagCensusCell> = {};
    for (const node of nodes) {
      const cell = byKind[node.kind] ??
        (byKind[node.kind] = { measured: 0, unmeasured: 0, notApplicable: 0, contradictions: 0 });
      const state = flagMeasurement(node, flag);
      if (state === "MEASURED") {
        cell.measured++;
        if (!flagApplies(node.kind, flag)) cell.contradictions++;
      } else if (state === "UNMEASURED") {
        cell.unmeasured++;
      } else {
        cell.notApplicable++;
      }
    }
    out[flag] = byKind;
  }
  return out;
}

/** Every (flag, kind) pair the census found a contradiction for — the test's assertion target. */
export function declarationContradictions(
  nodes: readonly GNode[],
): Array<{ flag: FlagKey; kind: string; count: number }> {
  const census = flagCensus(nodes);
  const out: Array<{ flag: FlagKey; kind: string; count: number }> = [];
  for (const flag of FLAG_KEYS) {
    for (const [kind, cell] of Object.entries(census[flag])) {
      if (cell.contradictions > 0) out.push({ flag, kind, count: cell.contradictions });
    }
  }
  return out;
}
