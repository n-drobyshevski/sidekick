// The ledger's shapes — the port of gas/src/domain/reconcile.ts's LedgerRow / Observation /
// Deltas / RiskSignalFields / ReconcileOptions and gas/src/domain/ledgerCore.ts's ScanRow /
// EpisodeRow / LedgerState / BaseRow, renamed for the three-scope register and extended for
// SAST and secrets. TYPES ONLY here — the reconciliation and compaction machinery that reads
// and writes these shapes ports in a later package; this module is what everything else in
// the domain layer builds on.
//
// COLUMN NAMES COME FROM TAB_HEADERS[TABS.ledger] IN src/server/sheetsDb.ts, NOT FROM gas/:
//   gas/reconcile.LedgerRow   this file                  why
//   vuln_key               -> finding_key                the register-wide identity column
//   cve                    -> identifier                 SCA's CVE, SAST's weakness, secrets'
//                                                         credential id (<- secretDataId) — a
//                                                         different field per scope, one name
//   asset_id / asset_name  -> repo_id / repo_name         the asset here is a repository
//   (new)                  -> branch, platform            the asset dimension gas/ never had
//   (new)                  -> component                   what the finding was found IN
//   (new)                  -> scope                       part of the identity — see below
//
// `LEDGER_COLUMNS` is exported as the same list AS DATA, in tab order, so
// test/ledgerTypes.test.ts can hold it set-equal to sheetsDb.ts's TAB_HEADERS[TABS.ledger] in
// both directions — the two are independent sources for the same 39 columns and a drift
// between them is exactly the class of defect PROBE_FINDINGS.md §10.2 and §10.9 are about:
// a plausible-looking shape that quietly stops matching what is actually written.
//
// `scope` IS PART OF THE KEY (see lifecycle.ts's findingKey): the same CVE reaching the
// estate through a dependency (sca) and through first-party code (sast, in principle; in
// practice CVEs don't appear there) is two findings with two clocks, and a secret and a CVE
// never collide because their identities live in disjoint scope-prefixed namespaces.

import type { Scope } from "./config";

export type { Scope };

export interface LedgerRow {
  finding_key: string;
  scope: Scope;
  // SCA's CVE, SAST's weakness (cwe/rule name), secrets' credential id (<- secretDataId).
  // Different field per scope, one column — see the header comment above.
  identifier: string | null;
  // What the finding was found IN: the dependency/package for SCA, the file for SAST/secrets.
  component: string | null;
  severity: string | null;

  // The asset dimension. Latest-wins. The "asset" in this register is a repository (SCA/SAST
  // read `vulnerableAsset`/`resource`; secrets read `resource`) rather than a host or VM.
  repo_id: string | null;
  repo_name: string | null;
  branch: string | null;
  platform: string | null;

  // The lifecycle every scope measures.
  first_seen: string | null;
  last_seen: string | null;
  status: string;
  resolved_at: string | null;
  resolution_src: string | null;
  reopened_count: number;
  first_scan_id: string | null;
  last_scan_id: string | null;

  // SCA ONLY — the actionable/second clock's inputs. SAST and secrets have no vendor to wait
  // on: a weakness in first-party code and a leaked credential are both fixed by US, not by
  // upstream, so fix_available_at collapses to first_seen for those two scopes (a later
  // package's job — see PROBE_FINDINGS.md §10 and rule 3 of the D1 brief). Written from day
  // one even though nothing derives fix_available_at yet, per gas/'s own precedent for these
  // two columns: capturing them later would leave a hole no backfill could close.
  fix_date: string | null;
  fix_observed_at: string | null;
  fixed_version: string | null;

  // SCA ONLY. Tri-state FOREVER — null means NOT CAPTURED, never coerced to false. Wiz
  // returns null for a signal it never evaluated; collapsing that to false is what makes an
  // unassessed finding look clean. See reconcile.ts's mergeRiskSignals (a later package) for
  // the monotone merge these columns depend on.
  has_kev: boolean | null;
  has_exploit: boolean | null;
  epss: number | null;
  risk_observed_at: string | null;

  // SAST fills these. `cwe` may be a comma-separated list (a finding can carry several
  // weaknesses); `ai_verdict` <- aiAnalysis.verdict (see config.ts's AI_VERDICTS_HIGH).
  cwe: string | null;
  ai_verdict: string | null;
  language: string | null;
  // SAST AND SECRETS SHARE THIS LOCATION PAIR: file_path <- filePath on SAST and <- path on
  // secrets; start_line <- startLine on SAST and <- lineNumber on secrets. Not a convenience —
  // lineNumber is part of the secrets row key (findingKey in lifecycle.ts), so the column it
  // lands in has to be the one the key is read back from.
  file_path: string | null;
  start_line: number | null;
  origin: string | null;

  // SECRETS ONLY. Secrets carry their own lifecycle: removal from HEAD is not rotation.
  //   validation_state  UNKNOWN | VALID | INVALID | ERROR, from SecretInstanceValidationStatus.
  //   validated_at      when that check was last made (lastValidatedAt).
  //   rotated_at        the credential was observed DEAD at this time (validation_state ==
  //                     INVALID at validated_at). NOT the same as removed_at.
  //   removed_at        the string left HEAD — the OTHER axis. See sheetsDb.ts's ledger
  //                     header comment (PROBE_FINDINGS.md §3/§10.6/§10.7) for the full
  //                     argument, including why this is (secretDataId, path, lineNumber)
  //                     keyed with the earliest firstSeenAt and never externalId.
  secret_kind: string | null;
  rotated_at: string | null;
  removed_at: string | null;
  validation_state: string | null;
  validated_at: string | null;
  // How sure the detector is that this is a credential at all (SecretInstance.confidence).
  // With the severity gate off (config.ts's DEFAULT_FETCH_SEVERITIES.secrets), this and
  // validation_state are the register's volume controls — severity grades a detection.
  confidence: string | null;

  // All three scopes: ownership, from projects[].
  owner_project: string | null;
  owner_path: string | null;
  tags_json: string | null;
}

/** The ledger's columns, as data, in tab order — see the header comment for what it guards. */
export const LEDGER_COLUMNS: readonly string[] = [
  "finding_key", "scope", "identifier", "component", "severity",
  "repo_id", "repo_name", "branch", "platform",
  "first_seen", "last_seen", "status", "resolved_at", "resolution_src",
  "reopened_count", "first_scan_id", "last_scan_id",
  "fix_date", "fix_observed_at", "fixed_version",
  "has_kev", "has_exploit", "epss", "risk_observed_at",
  "cwe", "ai_verdict", "language", "file_path", "start_line", "origin",
  "secret_kind", "rotated_at", "removed_at", "validation_state", "validated_at",
  "confidence",
  "owner_project", "owner_path", "tags_json",
];

export interface Observation {
  scan_id: string;
  finding_key: string;
  present: 0 | 1;
  severity: string | null;
  status: string;
}

export interface Deltas {
  new_count: number;
  resolved_count: number;
  reopened_count: number;
}

/** The mutable slice of a row the risk merge touches — ledger rows and episodes alike. */
export type RiskSignalFields = Pick<
  LedgerRow,
  "has_kev" | "has_exploit" | "epss" | "risk_observed_at"
>;

export interface ReconcileOptions {
  /**
   * REQUIRED, and not defaultable. It selects the node projection (SCA's `vulnerableAsset`
   * union vs SAST's and secrets' plain `resource`, `filePath` vs `path`, …), it prefixes
   * every finding_key, and it is stamped on every row — see the `scope` column above. A
   * default would silently file one register's findings under another's identity namespace.
   */
  scope: Scope;
  disappearanceMode?: "scan_ts" | "midpoint";
  prevScanTs?: string | null;
  scannedSeverities?: string[] | null;
  prevScanIdBySeverity?: Record<string, string> | null;
}

// --------------------------------------------------------------------------- #
//  Scan log and sealed episodes — mirrors TAB_HEADERS[TABS.scans] / [TABS.episodes]
// --------------------------------------------------------------------------- #

export interface ScanRow {
  scan_id: string;
  ts: string;
  // Which register this scan covered — the devsecops scans tab carries no `shape` column
  // (gas/'s flat-vs-grouped distinction does not apply here: every scope's fetch is a flat
  // per-finding scan).
  scope: Scope;
  mode: string;
  severities: string | null; // serializeSeverities text
  total: number;
  new_count: number;
  resolved_count: number;
  reopened_count: number;
  // Reference to the archived raw payload (a Drive folder id in GAS; opaque here).
  raw_ref: string | null;
  // Reference to the scan's observations file (Drive file id in GAS) — what
  // resolve-by-disappearance rests on: a finding_key absent from the latest scan's
  // observations is resolved, and without the set persisted the only way to recompute that
  // is to re-read every raw page.
  obs_ref: string | null;
  sealed: 0 | 1;
}

export interface EpisodeRow {
  finding_key: string;
  scope: Scope;
  identifier: string | null;
  component: string | null;
  severity: string | null;
  first_seen: string | null;
  resolved_at: string | null;
  resolution_src: string | null;
  reopened_count: number;
  compaction_id: string;
  superseded_by_scan: string | null;
  // Carried through compaction so a sealed episode keeps its actionable-clock inputs.
  fix_date: string | null;
  fix_observed_at: string | null;
  has_kev: boolean | null;
  has_exploit: boolean | null;
  epss: number | null;
  cwe: string | null;
  language: string | null;
  owner_project: string | null;
}

export interface LedgerState {
  scans: ScanRow[];
  ledger: Record<string, LedgerRow>;
  episodes: EpisodeRow[];
}

// --------------------------------------------------------------------------- #
//  Base rows (finding_ledger UNION resolved_episodes) — the load_base_df equivalent
// --------------------------------------------------------------------------- #

export type BaseRow = LedgerRow & {
  mttr_days: number | null;
  age_days: number | null;
  // Actionable clock — the SLA/MTTR clock starts when a vendor fix is available, not at
  // detection, for SCA. For sast/secrets a later package sets fix_available_at = first_seen
  // (rule 3 of the D1 brief: there is no vendor to wait on, so the actionable clock and the
  // detection clock coincide) — the type stays nullable so that assignment type-checks
  // without any special-casing here.
  fix_available_at: string | null;
  actionable_from: string | null;
  mttr_actionable_days: number | null;
  actionable_age_days: number | null;
  awaiting_vendor_fix: boolean;
};
