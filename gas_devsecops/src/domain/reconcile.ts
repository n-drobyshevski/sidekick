// One scan against the prior ledger. Port of gas/src/domain/reconcile.ts, with the one
// change this register forced: THE LEDGER HOLDS THREE SCOPES AND A SCAN COVERS ONE.
//
// Neither gas/ nor brick/devsecops does that. gas has a single register. brick's reconcile
// takes a `scope` but only stamps it on the row — its disappearance guard is severity-scoped,
// because its caller hands it a prior already filtered down. Here the prior is one Sheet tab
// holding 17,991 SCA rows, 127 SAST rows and 1,958 secrets, and a SAST-only sync that
// forgot to filter would resolve 19,949 findings as remediated in one pass. That is too
// large a failure to leave to a calling convention, so RECONCILE FILTERS THE PRIOR ITSELF
// and the `scope` argument is required.
//
// The other change is upstream: this takes normalized LedgerObservations, never raw Wiz
// nodes. gas reads its records inline (`field(rec, "vulnerableAsset.id")`), which works for
// one node type and cannot work for three whose birth date alone is spelled three ways. See
// observation.ts.
//
// THREE UPDATE DISCIPLINES COEXIST HERE and they are not interchangeable — the same split
// brick/devsecops arrived at, and the reason its ledger tests read the way they do:
//
//   latest-wins            severity, the asset and display columns
//   sticky-first-wins      fix_date / fix_observed_at, reset only by a reopen
//   monotone, never reset  has_kev / has_exploit (null -> false -> true), epss keeps the peak

import {
  RESOLUTION_API, RESOLUTION_DISAPPEARED, STATUS_OPEN, STATUS_RESOLVED, type Scope,
} from "./config";
import type { LedgerObservation, LedgerRow } from "./observation";
import { midpointIso, minIso, present, toIso, parseTs } from "./util";

export interface Deltas {
  new_count: number;
  resolved_count: number;
  reopened_count: number;
}

export interface ReconcileOptions {
  /** How a disappearance is dated: at this scan, or halfway back to the last one. */
  disappearanceMode?: "scan_ts" | "midpoint";
  prevScanTs?: string | null;
  /**
   * The severities this scan actually requested, or null for "no gate".
   *
   * Load-bearing, and the reason the scans tab records it. SCA and SAST default to
   * CRITICAL/HIGH, so without this every MEDIUM row in the ledger would vanish on the first
   * scoped scan and mass-resolve. Absence of something nobody looked for is not evidence.
   * Secrets passes null — `DEFAULT_FETCH_SEVERITIES.secrets` is `[]` (§9.2/§10.3), so its
   * scans cover the whole population and every row is a disappearance candidate.
   */
  scannedSeverities?: readonly string[] | null;
  /**
   * The most recent PRIOR SCAN OF THIS SCOPE that covered each severity. A finding that
   * vanished while its severity went unscanned must still resolve on the first scan that
   * covers it again, and this map is what makes that possible.
   */
  prevScanIdBySeverity?: Record<string, string> | null;
}

export interface ReconcileResult {
  ledger: Record<string, LedgerRow>;
  deltas: Deltas;
}

/** A fresh lifecycle from one observation. */
function makeRow(
  obs: LedgerObservation,
  firstSeen: string,
  scanId: string,
  scanTsIso: string,
): LedgerRow {
  const { is_open: _isOpen, ...rest } = obs;
  return {
    ...rest,
    first_seen: firstSeen,
    last_seen: scanTsIso,
    status: STATUS_OPEN,
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: scanId,
    last_scan_id: scanId,
    fix_observed_at: present(obs.fixed_version) || present(obs.fix_date) ? scanTsIso : null,
    risk_observed_at: null,
  };
}

/**
 * Merge one observation's exploit intelligence into a row, in place — monotone, idempotent
 * and order-independent. Booleans go null -> false -> true and never back; `epss` keeps the
 * peak observed; `risk_observed_at` keeps the earliest witnessing scan.
 *
 * Deliberately NOT the latest-wins treatment severity and the asset columns get:
 *
 *   * Exploit knowledge is monotone in reality — a CVE does not become un-exploited, and
 *     KEV entries are effectively never withdrawn. EPSS genuinely decays, so PEAK epss is a
 *     choice: the question is "should this have been prioritized", not "is it still scary".
 *   * It keeps the high-risk label monotone, so a finding cannot leave a coverage
 *     denominator between scans and rewrite a plotted point after the fact.
 *   * A resolved row freezes at its peak known risk, which never under-counts what ought to
 *     have been fixed.
 *
 * Note where it parts company with the fix clock below: risk signals do NOT reset on reopen.
 * Exploit availability is a property of the vulnerability; a vendor fix is a property of the
 * episode.
 *
 * SCA is the only scope that carries any of these. On SAST and secrets all three are null
 * and this is a no-op — and that null means NOT APPLICABLE rather than unmeasured, with
 * `scope` as the discriminator (observation.ts).
 */
export function mergeRiskSignals(row: LedgerRow, obs: LedgerObservation, scanTsIso: string): void {
  // `== null` (not `=== null`) also catches undefined on rows read back from a sheet written
  // before these columns existed.
  if (obs.has_kev !== null && (row.has_kev == null || obs.has_kev)) row.has_kev = obs.has_kev;
  if (obs.has_exploit !== null && (row.has_exploit == null || obs.has_exploit)) {
    row.has_exploit = obs.has_exploit;
  }
  if (obs.epss !== null && (row.epss == null || obs.epss > row.epss)) row.epss = obs.epss;

  const witnessed = obs.has_kev !== null || obs.has_exploit !== null || obs.epss !== null;
  if (!witnessed) return;
  // Earliest-wins, and genuinely a min rather than a first-wins guard: an archive replay can
  // legitimately deliver an earlier scan after a later one.
  if (row.risk_observed_at == null || scanTsIso < row.risk_observed_at) {
    row.risk_observed_at = scanTsIso;
  }
}

/**
 * Reconcile one scan of ONE SCOPE against the prior ledger.
 *
 * `existingLedger` may hold every scope; rows of other scopes are copied through untouched
 * and are never disappearance candidates. Neither input is mutated.
 */
export function reconcile(
  observations: readonly LedgerObservation[],
  existingLedger: Readonly<Record<string, LedgerRow>>,
  scope: Scope,
  scanId: string,
  scanTs: string,
  prevScanId: string | null,
  options: ReconcileOptions = {},
): ReconcileResult {
  const {
    disappearanceMode = "scan_ts",
    prevScanTs = null,
    scannedSeverities = null,
    prevScanIdBySeverity = null,
  } = options;

  // Rows are flat scalar dicts, so a shallow per-row copy preserves the inputs.
  const updated: Record<string, LedgerRow> = {};
  for (const [key, row] of Object.entries(existingLedger)) updated[key] = { ...row };

  const seen = new Set<string>();
  let newCount = 0;
  let resolvedCount = 0;
  let reopenedCount = 0;

  const scanTsIso = toIso(parseTs(scanTs)) ?? String(scanTs);

  for (const obs of observations) {
    if (obs.scope !== scope) {
      // A normalizer emitting the wrong scope would silently write rows this scan's
      // disappearance pass then refuses to consider — a half-updated register. Refuse.
      throw new Error(`reconcile(${scope}): observation ${obs.finding_key} carries scope ${obs.scope}`);
    }
    const key = obs.finding_key;
    if (seen.has(key)) continue; // duplicate within one scan — first wins
    seen.add(key);

    const apiSaysResolved = !obs.is_open;
    // A concrete fix, whether or not it came with a date.
    const fixSignal = present(obs.fixed_version) || present(obs.fix_date);
    // Sticky first-wins: only ever fill a currently-empty field; never clear or overwrite.
    const seedFix = (r: LedgerRow): void => {
      if (r.fix_date == null && obs.fix_date !== null) r.fix_date = obs.fix_date;
      if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
    };

    let row = updated[key];
    if (row === undefined) {
      // The scan time is the floor, not the answer: a finding the API dates to last year is
      // a year old, and one it will not date at all is at most as old as this scan.
      row = makeRow(obs, minIso(obs.first_seen, scanTsIso) ?? scanTsIso, scanId, scanTsIso);
      updated[key] = row;
      newCount += 1;
    } else if (row.status === STATUS_RESOLVED && !apiSaysResolved) {
      // A genuine reopen: it was down as resolved and is active again. Not merely re-listed
      // — a still-resolved finding coming back in the payload is the API repeating itself.
      // A new episode starts, so the next resolution measures THIS episode; the vendor-fix
      // clock resets with it (the prior episode's fix is irrelevant) and re-seeds below.
      row.status = STATUS_OPEN;
      row.resolved_at = null;
      row.resolution_src = null;
      row.reopened_count = Number(row.reopened_count ?? 0) + 1;
      row.first_seen = minIso(obs.first_seen, scanTsIso) ?? scanTsIso;
      row.last_seen = scanTsIso;
      row.last_scan_id = scanId;
      row.fix_date = null;
      row.fix_observed_at = null;
      seedFix(row);
      reopenedCount += 1;
    } else {
      // Persisting, or a still-resolved finding being re-listed. first_seen stays
      // earliest-known and NEVER drifts later — the API learning an earlier date is new
      // information; it forgetting one is not.
      if (row.status === STATUS_OPEN) {
        row.first_seen = minIso(row.first_seen, obs.first_seen) ?? row.first_seen;
      }
      row.last_seen = scanTsIso;
      row.last_scan_id = scanId;
      seedFix(row);
    }

    // One call for all three branches: the merge is monotone and idempotent, unlike seedFix,
    // which has to run per-branch around the reopen reset.
    mergeRiskSignals(row, obs, scanTsIso);

    // Latest observation wins for the display and asset attributes.
    row.severity = obs.severity;
    row.identifier = obs.identifier ?? row.identifier;
    row.component = obs.component ?? row.component;
    row.repo_id = obs.repo_id ?? row.repo_id;
    row.repo_name = obs.repo_name ?? row.repo_name;
    row.branch = obs.branch ?? row.branch;
    row.platform = obs.platform ?? row.platform;
    row.cwe = obs.cwe ?? row.cwe;
    row.language = obs.language ?? row.language;
    row.file_path = obs.file_path ?? row.file_path;
    row.start_line = obs.start_line ?? row.start_line;
    row.origin = obs.origin ?? row.origin;
    row.secret_kind = obs.secret_kind ?? row.secret_kind;
    row.confidence = obs.confidence ?? row.confidence;
    row.owner_project = obs.owner_project ?? row.owner_project;
    row.owner_path = obs.owner_path ?? row.owner_path;
    row.tags_json = obs.tags_json ?? row.tags_json;
    row.fixed_version = obs.fixed_version ?? row.fixed_version;
    // The twin fold is a property of THIS scan's node list, so it is latest-wins rather than
    // sticky: a twin appearing or disappearing between scans changes the true answer.
    row.twin_count = obs.twin_count ?? row.twin_count;
    row.twin_first_seen_spread_days =
      obs.twin_first_seen_spread_days ?? row.twin_first_seen_spread_days;
    row.source_external_ids = obs.source_external_ids ?? row.source_external_ids;

    // The rotation axis, which is NOT the removal axis (§3). Latest-wins, because a
    // credential genuinely can be re-validated — but only from a MEASURED reading: an
    // UNKNOWN check must never overwrite a stored VALID or INVALID, or a register that is
    // 99.6% UNKNOWN would erase its own 0.38% of measurements on the next scan.
    if (obs.validation_state !== null && obs.validation_state !== "UNKNOWN") {
      row.validation_state = obs.validation_state;
      row.validated_at = obs.validated_at;
      row.rotated_at = obs.rotated_at;
    } else if (row.validation_state == null && obs.validation_state !== null) {
      row.validation_state = obs.validation_state;
      row.validated_at = obs.validated_at;
    }

    // An API-declared resolution closes a currently-open row. SAST never reaches this branch
    // — it has no resolvedAt and returns no resolved rows (§2), so every SAST resolution in
    // this ledger is a disappearance.
    if (apiSaysResolved && row.status === STATUS_OPEN) {
      row.status = STATUS_RESOLVED;
      row.resolved_at = present(obs.resolved_at) ? obs.resolved_at : scanTsIso;
      row.resolution_src = RESOLUTION_API;
      resolvedCount += 1;
    }
  }

  // ---- Disappearance: OPEN rows OF THIS SCOPE that were in the immediately-previous
  // covering scan and are absent now.
  //
  // The first scan of a scope cannot resolve anything by absence: every finding in the world
  // is "absent from the previous scan" when there is no previous scan of this scope. That is
  // per SCOPE, not per register — the first SAST sync resolves nothing even with fifty SCA
  // scans behind it.
  if (prevScanId !== null) {
    const covered = scannedSeverities !== null ? new Set(scannedSeverities) : null;
    for (const [key, row] of Object.entries(updated)) {
      // THE GUARD THAT CARRIES THE RISK. Without it a SAST-only scan resolves every SCA and
      // secrets row in the ledger, because none of them is in `seen`.
      if (row.scope !== scope) continue;
      if (seen.has(key) || row.status === STATUS_RESOLVED) continue;
      if (covered !== null && (row.severity === null || !covered.has(row.severity))) {
        // This severity was not scanned — absence is expected, not resolution.
        continue;
      }
      // Only a row that WAS in the immediately-previous covering scan can be said to have
      // vanished from it. One that already missed that scan is stale, not newly resolved.
      const expectedPrev = (prevScanIdBySeverity ?? {})[row.severity ?? ""] ?? prevScanId;
      if (row.last_scan_id !== expectedPrev) continue;

      row.resolved_at =
        disappearanceMode === "midpoint" && prevScanTs
          ? midpointIso(prevScanTs, scanTsIso)
          : scanTsIso;
      row.status = STATUS_RESOLVED;
      row.resolution_src = RESOLUTION_DISAPPEARED;
      // Secrets only: the string left HEAD. Removal is not rotation — the credential is live
      // until rotated_at says otherwise, and this never touches that column.
      if (row.scope === "secrets") row.removed_at = row.resolved_at;
      resolvedCount += 1;
    }
  }

  return {
    ledger: updated,
    deltas: { new_count: newCount, resolved_count: resolvedCount, reopened_count: reopenedCount },
  };
}
