// One scan: source -> normalize -> reconcile -> write.
//
// THE SOURCE IS PLUGGABLE AND ONLY ONE OF THEM EXISTS YET. `sample` reads a fixed dataset,
// which is what lets the whole chain be exercised — and the MTTR page be looked at — without
// a tenant. `live` is the paged Wiz fetch and is NOT implemented; it REFUSES rather than
// returning an empty page, because "the sync ran and found nothing" and "the sync does not
// exist" must not look the same from the outside. That is the same rule the probe learned
// the hard way (PROBE_FINDINGS.md §9.1): a zero has to prove it looked.
//
// A CAVEAT THIS PIPELINE CANNOT RESOLVE, recorded rather than fixed. `BASE.sca` in
// wizQueries.ts carries `hasFix: true`, so the SCA population is "findings that have a fix".
// A finding whose fix is WITHDRAWN leaves that population — and leaving the population is
// exactly what resolution-by-disappearance reads as remediation. Nothing in the ledger can
// tell a withdrawn fix from a real one: both are simply absent next scan. The register would
// publish a false remediation, indistinguishable from a true one.
//
// It is not fixed here because the fix is a POPULATION CHANGE — dropping `hasFix` broadens
// SCA from 17,991 rows to however many exist without one — and a population change belongs
// in its own round, measured, not smuggled in beside a ledger port. gas/ has already been
// through this: its REMEDIATION_ROLLOUT_ISO exists precisely to date the scan where the same
// filter was broadened, because rows ingested before it are not comparable with rows after.

import { DEFAULT_FETCH_SEVERITIES, type Scope } from "../domain/config";
import {
  existingScanDeltas, latestScan, parseSeverities, prevScanIdBySeverity,
} from "../domain/ledgerCore";
import { NORMALIZERS } from "../domain/normalize";
import type { LedgerObservation } from "../domain/observation";
import { reconcile, type Deltas } from "../domain/reconcile";
import { collapseTwins } from "../domain/secretsLedger";
import { nowIso, type Rec } from "../domain/util";
import { appendScan, readLedger, readScans, writeLedger } from "./ledgerStore";
import { loadSettings } from "./settingsStore";

export type SyncMode = "sample" | "live";

export interface SyncResult {
  scan_id: string;
  scope: Scope;
  ts: string;
  mode: SyncMode;
  /** Raw API rows read. */
  nodes: number;
  /** Findings after the secrets twin fold; equal to `nodes` on the other two scopes. */
  findings: number;
  deltas: Deltas;
  /** True when this scan_id was already in the log, so nothing was rewritten. */
  alreadyRecorded: boolean;
  /** Secrets only: rows keyed without a line number (see collapseTwins). */
  keyed_without_line?: number;
}

/**
 * Turn one scope's raw nodes into observations.
 *
 * Secrets takes a LIST because its unit of work is a fold, not a map: 187 findings arrive as
 * two rows each and only the whole page can pair them (PROBE_FINDINGS.md §10.6).
 */
export function observationsFor(
  scope: Scope,
  nodes: readonly Rec[],
): { observations: LedgerObservation[]; keyedWithoutLine?: number } {
  if (scope === "secrets") {
    const folded = collapseTwins(nodes);
    return { observations: folded.observations, keyedWithoutLine: folded.keyed_without_line };
  }
  const normalize = NORMALIZERS[scope];
  return { observations: nodes.map((n) => normalize(n)) };
}

/** Where a scan's rows come from. Only `sample` is implemented. */
export interface SyncSource {
  mode: SyncMode;
  nodes(scope: Scope): readonly Rec[];
}

/**
 * The live paged Wiz fetch — NOT YET BUILT, and it says so instead of returning nothing.
 *
 * An empty result here would write a scan row claiming it covered the scope, and the next
 * scan's disappearance pass would then resolve the entire register against it. The refusal
 * is not defensive politeness; it is what stops a missing feature from looking like a
 * remediation event.
 */
export function liveSource(): SyncSource {
  return {
    mode: "live",
    nodes(scope) {
      throw new Error(
        `The live Wiz fetch is not implemented (scope ${scope}). Use the sample source. `
        + "Returning an empty page here would record a scan that covered nothing, and the "
        + "next scan would resolve the whole register against it.",
      );
    },
  };
}

export function sampleSource(dataset: Record<string, readonly Rec[]>): SyncSource {
  return { mode: "sample", nodes: (scope) => dataset[scope] ?? [] };
}

/**
 * Run one scan of one scope and persist it.
 *
 * `scanId` is the caller's, and re-running the same one is a NO-OP by design — the scan log
 * is what makes a retry safe after a partial failure.
 */
export function runScan(
  scope: Scope,
  source: SyncSource,
  opts: {
    scanId: string;
    ts?: string;
    /**
     * The severity gate THIS scan applied, overriding the current setting.
     *
     * A scan records what it actually covered, not what the settings happen to say now — and
     * the two genuinely differ, because the gate is a per-scope setting a user can change
     * between scans. Without the override a replay of older scans would stamp today's gate on
     * all of them, and the disappearance guard would then believe a severity was covered by a
     * scan that never looked at it. `null` means no gate; omitted means "read the setting".
     */
    severities?: readonly string[] | null;
  },
): SyncResult {
  const ts = opts.ts ?? nowIso();
  const scans = readScans();

  const already = existingScanDeltas(scans, opts.scanId);
  if (already) {
    return {
      scan_id: opts.scanId, scope, ts, mode: source.mode,
      nodes: 0, findings: 0, deltas: already, alreadyRecorded: true,
    };
  }

  const nodes = source.nodes(scope);
  const { observations, keyedWithoutLine } = observationsFor(scope, nodes);

  // The severity gate this scan actually applied — recorded so a later scan knows which rows
  // it was entitled to resolve by absence. Secrets' empty list becomes null: no gate at all.
  const requested = opts.severities !== undefined
    ? opts.severities
    : loadSettings().fetchSeverities?.[scope] ?? DEFAULT_FETCH_SEVERITIES[scope];
  const scannedSeverities = requested && requested.length ? [...requested] : null;

  // Per SCOPE, all three of them. The first SAST scan has no predecessor even if SCA has
  // fifty, and reading the register's latest scan instead would silently mis-date every
  // disappearance guard.
  const prev = latestScan(scans, scope);
  const prevBySev = prevScanIdBySeverity(scans, scope);

  const result = reconcile(
    observations, readLedger(), scope, opts.scanId, ts, prev?.scan_id ?? null,
    {
      scannedSeverities,
      prevScanIdBySeverity: prevBySev,
      prevScanTs: prev?.ts ?? null,
    },
  );

  writeLedger(result.ledger);
  appendScan({
    scan_id: opts.scanId, ts, scope, mode: source.mode,
    severities: scannedSeverities,
    total: observations.length,
    ...result.deltas,
  });

  return {
    scan_id: opts.scanId, scope, ts, mode: source.mode,
    nodes: nodes.length, findings: observations.length,
    deltas: result.deltas, alreadyRecorded: false,
    ...(keyedWithoutLine === undefined ? {} : { keyed_without_line: keyedWithoutLine }),
  };
}

/** Re-export so callers reading a scan log do not have to reach into the domain layer. */
export { parseSeverities };
