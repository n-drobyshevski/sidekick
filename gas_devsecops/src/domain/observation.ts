// One row shape for three registers.
//
// WHY THIS IS ONE TYPE AND NOT THREE. gas/src/domain/reconcile.ts reads raw Wiz records
// inline — `field(rec, "vulnerableAsset.id")`, `clean(rec["firstDetectedAt"])`. That works
// for one register. It cannot work for three whose node types share almost no field names:
// the birth date is `firstDetectedAt` on SCA, `createdAt` on SAST and `firstSeenAt` on
// secrets; the asset is a union member, a `resource`, and a `resource` of a different type.
// A reconcile that tried to read all three would be a pile of `??` chains, and every future
// scope would edit it.
//
// So normalization happens FIRST, per scope, and reconcile only ever sees this shape. The
// scope-specific columns are nullable because the ledger tab is one table with the same
// nullable columns — LEDGER_COLUMNS below is that tab's header list, and
// test/secretsLedger.test.js pins the two in step.
//
// NULL HERE MEANS TWO DIFFERENT THINGS, and `scope` is the discriminator rather than a
// fourth state. `epss` null on an SCA row means Wiz did not evaluate it — unmeasured, the
// tri-state the AI register has a name for. `epss` null on a SAST row means a static-analysis
// finding has no exploit-prediction score and never will — not applicable. Adding an
// `epss_measured` column would be the wrong fix: the scope already says which kind of null
// it is, for every one of these columns.

import type { Scope } from "./config";

/**
 * The ledger tab's columns, in order.
 *
 * Kept here rather than imported from sheetsDb because this module must stay free of Apps
 * Script — the same rule wizQueries.ts follows. `test/ledgerCore.test.js` asserts the two
 * lists are identical, so the duplication cannot drift.
 */
export const LEDGER_COLUMNS = [
  "finding_key", "scope", "identifier", "component", "severity",
  "repo_id", "repo_name", "branch", "platform",
  "first_seen", "last_seen", "status", "resolved_at", "resolution_src",
  "reopened_count", "first_scan_id", "last_scan_id",
  "fix_date", "fix_observed_at", "fixed_version",
  "has_kev", "has_exploit", "epss", "risk_observed_at",
  "cwe", "language", "file_path", "start_line", "origin",
  "secret_kind", "confidence", "rotated_at", "removed_at", "validation_state", "validated_at",
  "twin_count", "twin_first_seen_spread_days", "source_external_ids",
  "owner_project", "owner_path", "tags_json",
] as const;

/** Wiz's `SecretInstanceValidationStatus`. Four states, and only two of them are measured. */
export type ValidationState = "VALID" | "INVALID" | "ERROR" | "UNKNOWN";

/**
 * What ONE SCAN asserts about one finding, before it meets the ledger.
 *
 * Deliberately NOT the ledger row. An observation has no `status`/`resolved_at` history, no
 * `reopened_count` and no `first_scan_id` — those are properties of a lifecycle, and a
 * lifecycle is what reconcile maintains across scans. What it does carry is everything the
 * scan can honestly claim on its own.
 */
export interface LedgerObservation {
  finding_key: string;
  scope: Scope;
  /** SCA: the CVE. SAST: the rule. Secrets: `secretDataId`, the credential. */
  identifier: string | null;
  /** SCA: package@version. SAST/secrets: `path:line`. */
  component: string | null;
  severity: string;

  // --- the asset. A repository in all three scopes, reached three different ways.
  repo_id: string | null;
  repo_name: string | null;
  branch: string | null;
  platform: string | null;

  // --- the clocks this scan can see.
  /** The API's own birth date, or null when it gives none. Never the scan time — that is
   *  reconcile's fallback to apply, and an observation that invented one would hide it. */
  first_seen: string | null;
  /** The API's own resolution date, when it has one. SAST never does (§2). */
  resolved_at: string | null;
  /** Whether the API considers this finding still live. Disappearance is not visible here. */
  is_open: boolean;

  // --- the second clock's inputs. SCA only; a vendor fix is not a concept on the others.
  fix_date: string | null;
  fixed_version: string | null;

  // --- risk signals. SCA only, tri-state, null-not-false (see the header note).
  has_kev: boolean | null;
  has_exploit: boolean | null;
  epss: number | null;

  // --- SAST-shaped.
  cwe: string | null;
  language: string | null;
  file_path: string | null;
  start_line: number | null;
  origin: string | null;

  // --- secrets-shaped.
  secret_kind: string | null;
  confidence: string | null;
  validation_state: ValidationState | null;
  validated_at: string | null;
  rotated_at: string | null;
  /** Always null from a normalizer: a string leaving HEAD is a disappearance, and a
   *  disappearance needs two scans. Reconcile writes it. */
  removed_at: string | null;

  // --- the secrets twin fold, made auditable (PROBE_FINDINGS.md §10.6/§10.7).
  twin_count: number | null;
  twin_first_seen_spread_days: number | null;
  source_external_ids: string | null;

  // --- ownership.
  owner_project: string | null;
  owner_path: string | null;
  tags_json: string | null;
}

/**
 * One finding's LIFECYCLE — the durable row, maintained across scans.
 *
 * Everything an observation carries, plus what only a sequence of scans can know.
 */
export interface LedgerRow extends Omit<LedgerObservation, "is_open"> {
  status: "OPEN" | "RESOLVED";
  /** How it left: `api` (the API said so) or `disappeared` (it stopped being returned). */
  resolution_src: string | null;
  reopened_count: number;
  first_scan_id: string | null;
  last_scan_id: string | null;
  last_seen: string | null;
  /** First scan that witnessed any risk signal — kept earliest, never overwritten. */
  risk_observed_at: string | null;
  /** Sticky first-wins: the scan that first SAW a fix exist, even if it carried no date. */
  fix_observed_at: string | null;
}

/** The empty observation, so a normalizer names only the fields its scope actually has. */
export function emptyObservation(scope: Scope, findingKey: string): LedgerObservation {
  return {
    finding_key: findingKey, scope,
    identifier: null, component: null, severity: "UNKNOWN",
    repo_id: null, repo_name: null, branch: null, platform: null,
    first_seen: null, resolved_at: null, is_open: true,
    fix_date: null, fixed_version: null,
    has_kev: null, has_exploit: null, epss: null,
    cwe: null, language: null, file_path: null, start_line: null, origin: null,
    secret_kind: null, confidence: null,
    validation_state: null, validated_at: null, rotated_at: null, removed_at: null,
    twin_count: null, twin_first_seen_spread_days: null, source_external_ids: null,
    owner_project: null, owner_path: null, tags_json: null,
  };
}
