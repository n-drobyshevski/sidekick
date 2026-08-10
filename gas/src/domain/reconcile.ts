// Pure cross-scan reconciliation — the port of wiz_dashboard/domain/reconcile.py.
//
// Lifecycle rules:
//   * First sighting      -> OPEN, first_seen = min(API firstDetectedAt, scan ts).
//   * Persisting (OPEN)   -> advance last_seen; keep first_seen earliest-known.
//   * API-resolved        -> resolvedAt present or status in RESOLVED_STATUSES.
//   * Disappearance       -> was OPEN and present in the immediately previous scan but
//                            absent now -> resolved at the current scan ts.
//   * Reopen              -> a RESOLVED vuln reappears as active -> OPEN again,
//                            reopened_count++, first_seen reset (new episode).

import { RESOLVED_STATUSES } from "./config";
import { field, vulnKey } from "./lifecycle";
import { normalizeSeverity } from "./severity";
import { clean, midpointIso, minIso, parseTs, present, toIso, type Rec } from "./util";

export type LedgerRow = {
  vuln_key: string;
  cve: string | null;
  severity: string | null;
  asset_id: string | null;
  asset_name: string | null;
  asset_type: string | null;
  cloud: string | null;
  first_seen: string | null;
  last_seen: string | null;
  status: string;
  resolved_at: string | null;
  resolution_src: string | null;
  reopened_count: number;
  first_scan_id: string | null;
  last_scan_id: string | null;
  subscription_name: string | null;
  subscription_ext_id: string | null;
  tags_json: string | null;
  // Vendor-fix capture (actionable clock). fix_date: the upstream fix date the API
  // reports; fix_observed_at: the scan ts at which a fix signal (fixedVersion or
  // fixDate) was first seen for this episode. Both sticky first-wins; see reconcile().
  fix_date: string | null;
  fix_observed_at: string | null;
  // Exploit-intelligence capture (remediation coverage / efficiency). The Wiz node carries
  // these, but only the *current scan frame* does — a finding resolved by disappearance is
  // gone from the frame entirely, so measuring "was what we remediated actually high-risk?"
  // is impossible unless the signal is durable. Hence these columns. Sticky-MONOTONE, not
  // latest-wins like severity/cve: see seedRisk() in reconcile().
  //
  // null means NOT CAPTURED, and is emphatically not the same as false — a row whose signal
  // was never observed is UNCLASSIFIED and leaves both sides of every rate (see
  // domain/program.ts). Never default these to false.
  has_kev: boolean | null; // ever observed on the CISA KEV catalog (hasCisaKevExploit)
  has_exploit: boolean | null; // ever observed with a known exploit (hasExploit)
  epss: number | null; // PEAK observed epssProbability
  risk_observed_at: string | null; // scan ts at which any risk signal first arrived
};

export const LEDGER_COLUMNS: (keyof LedgerRow)[] = [
  "vuln_key", "cve", "severity", "asset_id", "asset_name", "asset_type", "cloud",
  "first_seen", "last_seen", "status", "resolved_at", "resolution_src",
  "reopened_count", "first_scan_id", "last_scan_id",
  "subscription_name", "subscription_ext_id", "tags_json",
  "fix_date", "fix_observed_at",
  "has_kev", "has_exploit", "epss", "risk_observed_at",
];

export interface Observation {
  scan_id: string;
  vuln_key: string;
  present: 0 | 1;
  severity: string | null;
  status: string;
}

export interface Deltas {
  new_count: number;
  resolved_count: number;
  reopened_count: number;
}

const TAGS_PREFIX = "vulnerableAsset.tags.";

/**
 * The asset's tags as canonical JSON (sorted keys), or null when absent. Accepts the
 * nested raw node (vulnerableAsset.tags dict) and flattened vulnerableAsset.tags.<key>
 * record shapes. Sorted keys keep delete-rebuild and checkpoint replays byte-stable.
 */
export function tagsJson(record: Rec): string | null {
  const va = record["vulnerableAsset"];
  let tags: Rec | null = null;
  if (va && typeof va === "object" && !Array.isArray(va)) {
    const t = (va as Rec)["tags"];
    if (t && typeof t === "object" && !Array.isArray(t)) tags = t as Rec;
  }
  if (tags === null) {
    const flat = record["vulnerableAsset.tags"];
    if (flat && typeof flat === "object" && !Array.isArray(flat)) tags = flat as Rec;
  }
  if (tags === null) {
    const collected: Rec = {};
    for (const [k, v] of Object.entries(record)) {
      if (k.startsWith(TAGS_PREFIX) && clean(v) !== null) {
        collected[k.slice(TAGS_PREFIX.length)] = v;
      }
    }
    tags = collected;
  }
  const kept: Rec = {};
  for (const [k, v] of Object.entries(tags)) {
    if (clean(v) !== null || v === "") kept[String(k)] = v;
  }
  const keys = Object.keys(kept).sort();
  if (!keys.length) return null;
  // Canonical JSON with sorted keys (json.dumps(sort_keys=True) parity for the flat
  // string/number/bool values tags actually carry).
  const parts = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(kept[k])}`);
  return `{${parts.join(", ")}}`;
}

function makeRow(
  record: Rec,
  key: string,
  sev: string,
  firstSeen: string | null,
  scanId: string,
  scanTs: string,
  fixDate: string | null,
  fixObservedAt: string | null,
): LedgerRow {
  return {
    vuln_key: key,
    cve: (clean(record["name"]) as string | null) ?? null,
    severity: sev,
    asset_id: field(record, "vulnerableAsset.id") || null,
    asset_name: field(record, "vulnerableAsset.name") || null,
    asset_type: field(record, "vulnerableAsset.type") || null,
    cloud: field(record, "vulnerableAsset.cloudPlatform") || null,
    subscription_name: field(record, "vulnerableAsset.subscriptionName") || null,
    subscription_ext_id:
      field(record, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId") ||
      null,
    tags_json: tagsJson(record),
    first_seen: firstSeen,
    last_seen: scanTs,
    status: "OPEN",
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: scanId,
    last_scan_id: scanId,
    fix_date: fixDate,
    fix_observed_at: fixObservedAt,
    // Left empty here and filled by mergeRiskSignals() after the branch, which runs for new,
    // reopened, and persisting rows alike (the merge is identical in all three).
    ...emptyRiskSignals(),
  };
}

/** The mutable slice of a row the risk merge touches — ledger rows and episodes alike. */
export type RiskSignalFields = Pick<
  LedgerRow,
  "has_kev" | "has_exploit" | "epss" | "risk_observed_at"
>;

export function emptyRiskSignals(): RiskSignalFields {
  return { has_kev: null, has_exploit: null, epss: null, risk_observed_at: null };
}

/**
 * Hydrate the four risk columns off a stored row — a sheet row, a Drive snapshot row, or a
 * migration-bundle row. Blank/absent stays `null` (never coerced to `false` or `0`, which
 * would turn "not captured" into "captured, and the answer was no"); the plain-text ledger
 * grid round-trips booleans as the strings "TRUE"/"FALSE", which `observeRiskSignals`'
 * coercion already understands.
 */
export function coerceRiskSignals(r: Rec): RiskSignalFields {
  const obs = observeRiskSignals({
    hasCisaKevExploit: r["has_kev"],
    hasExploit: r["has_exploit"],
    epssProbability: r["epss"],
  });
  return {
    has_kev: obs.kev,
    has_exploit: obs.exploit,
    epss: obs.epss,
    risk_observed_at: (clean(r["risk_observed_at"]) as string | null) ?? null,
  };
}

/**
 * One observation's exploit-intelligence signals, each **null when the record does not
 * carry it at all** — which is emphatically not the same as an observed `false`. A slim
 * record written before these fields were captured simply lacks the keys; a tenant whose
 * Wiz plan omits EPSS returns null. Both must stay distinguishable from "observed, and the
 * answer was no", or coverage/efficiency silently impute a negative (see domain/program.ts).
 */
export function observeRiskSignals(
  rec: Rec,
): { kev: boolean | null; exploit: boolean | null; epss: number | null } {
  const bool = (v: unknown): boolean | null => {
    if (typeof v === "boolean") return v;
    // Sheets round-trip: the ledger grid is plain-text formatted (sheetsDb.ensureTabs), so a
    // boolean written with setValues reads back as the string "TRUE"/"FALSE".
    if (typeof v === "string") {
      const s = v.trim().toUpperCase();
      if (s === "TRUE") return true;
      if (s === "FALSE") return false;
    }
    return null;
  };
  const rawEpss = clean(rec["epssProbability"]);
  const n = typeof rawEpss === "number" ? rawEpss : rawEpss === null ? NaN : Number(rawEpss);
  return {
    kev: bool(rec["hasCisaKevExploit"]),
    exploit: bool(rec["hasExploit"]),
    epss: Number.isFinite(n) ? (n as number) : null,
  };
}

/**
 * Merge one observation's risk signals into a row, in place — **monotone, idempotent, and
 * order-independent**. Booleans go null → false → true and never back; `epss` keeps the peak
 * observed; `risk_observed_at` keeps the earliest witnessing scan.
 *
 * Deliberately NOT the latest-observation-wins treatment `severity` / `cve` / asset fields
 * get in reconcile(). Three reasons, all load-bearing:
 *
 *   * Exploit knowledge is monotone in reality — a CVE does not become un-exploited, and
 *     CISA KEV entries are effectively never withdrawn. EPSS genuinely decays, so *peak*
 *     EPSS is a deliberate choice: the question coverage asks is "was this something you
 *     should have prioritized", not "is it still scary today".
 *   * It keeps the high-risk label monotone, so a finding cannot silently leave the coverage
 *     denominator between scans. Without that, trend.withCoverageEfficiency would rewrite
 *     its own history on every scan — a point plotted last week would change value this
 *     week for reasons unrelated to any remediation work, which makes the series
 *     uninterpretable and the whole page unauditable.
 *   * A resolved row therefore freezes at its peak known risk, the conservative reading:
 *     coverage never under-counts what we ought to have fixed.
 *
 * Order-independence is what lets the archive backfill (server/backfillJobs.ts) replay saved
 * scans newest-first, resume after a crash, and be re-run from scratch, all converging on
 * byte-identical state without any bookkeeping.
 *
 * Note the divergence from `seedFix`: risk signals do **not** reset on reopen (the reopen
 * branch in reconcile() clears the vendor-fix clock, which is per-episode). Exploit
 * availability is a property of the vulnerability, not of the episode.
 */
export function mergeRiskSignals(row: RiskSignalFields, rec: Rec, scanTsIso: string): void {
  const obs = observeRiskSignals(rec);
  // `== null` (not `=== null`) also catches undefined on rows read back from a sheet
  // written before these columns existed.
  if (obs.kev !== null && (row.has_kev == null || obs.kev)) row.has_kev = obs.kev;
  if (obs.exploit !== null && (row.has_exploit == null || obs.exploit)) {
    row.has_exploit = obs.exploit;
  }
  if (obs.epss !== null && (row.epss == null || obs.epss > row.epss)) row.epss = obs.epss;
  const witnessed = obs.kev !== null || obs.exploit !== null || obs.epss !== null;
  if (!witnessed) return;
  // Earliest-wins, and genuinely a min rather than a first-wins guard: the backfill replays
  // scans newest-first, so a later call can legitimately carry an earlier timestamp.
  if (row.risk_observed_at == null || scanTsIso < row.risk_observed_at) {
    row.risk_observed_at = scanTsIso;
  }
}

export interface ReconcileOptions {
  disappearanceMode?: "scan_ts" | "midpoint";
  prevScanTs?: string | null;
  scannedSeverities?: string[] | null;
  prevScanIdBySeverity?: Record<string, string> | null;
}

/**
 * Reconcile one flat scan against the prior ledger.
 * Returns {ledger, observations, deltas}; neither input is mutated.
 */
export function reconcile(
  currentRecords: Rec[],
  existingLedger: Record<string, LedgerRow>,
  scanId: string,
  scanTs: string,
  prevScanId: string | null,
  options: ReconcileOptions = {},
): { ledger: Record<string, LedgerRow>; observations: Observation[]; deltas: Deltas } {
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
  const observations: Observation[] = [];
  let newCount = 0;
  let resolvedCount = 0;
  let reopenedCount = 0;

  const scanTsIso = toIso(parseTs(scanTs)) ?? String(scanTs);

  for (const rec of currentRecords) {
    const key = vulnKey(rec);
    if (seen.has(key)) continue; // duplicate within the same scan — first wins
    seen.add(key);

    const sev = normalizeSeverity(clean(rec["severity"]));
    const apiFirst =
      clean(rec["firstDetectedAt"]) ?? clean(rec["firstSeenAt"]) ?? clean(rec["createdAt"]);
    const apiStatus = String(clean(rec["status"]) ?? "").toUpperCase();
    const apiResolved =
      clean(rec["resolvedAt"]) ?? clean(rec["remediatedAt"]) ?? clean(rec["fixedAt"]);
    const apiSaysResolved = present(apiResolved) || RESOLVED_STATUSES.has(apiStatus);

    // Vendor-fix signal for this observation: a concrete fixedVersion or a fixDate.
    // recFixDate is the normalized upstream fix date (null when unparseable/absent).
    const fixSignal = present(rec["fixedVersion"]) || present(rec["fixDate"]);
    const recFixDate = present(rec["fixDate"]) ? toIso(parseTs(rec["fixDate"])) : null;
    // Sticky first-wins: only ever fill a currently-empty field; never clear or overwrite.
    // `== null` also catches undefined from pre-migration snapshot rows lacking the columns.
    const seedFix = (r: LedgerRow): void => {
      if (r.fix_date == null && recFixDate !== null) r.fix_date = recFixDate;
      if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
    };

    let row = updated[key];
    if (row === undefined) {
      const firstSeen = minIso(apiFirst, scanTsIso) ?? scanTsIso;
      row = makeRow(rec, key, sev, firstSeen, scanId, scanTsIso, recFixDate, fixSignal ? scanTsIso : null);
      updated[key] = row;
      newCount += 1;
    } else if (row.status === "RESOLVED" && !apiSaysResolved) {
      // Genuine reopen: start a new episode so the next resolution measures THIS
      // episode, not the original. The fix clock resets too — the prior episode's
      // fix is irrelevant — then re-seeds from the reopening record.
      row.status = "OPEN";
      row.resolved_at = null;
      row.resolution_src = null;
      row.reopened_count = Number(row.reopened_count ?? 0) + 1;
      row.first_seen = minIso(apiFirst, scanTsIso) ?? scanTsIso;
      row.last_seen = scanTsIso;
      row.last_scan_id = scanId;
      row.fix_date = null;
      row.fix_observed_at = null;
      seedFix(row);
      reopenedCount += 1;
    } else {
      // Persisting (OPEN) or a still-resolved finding being re-listed. Keep
      // first_seen earliest-known; never let it drift later.
      if (row.status === "OPEN") {
        row.first_seen = minIso(row.first_seen, apiFirst) ?? row.first_seen;
      }
      row.last_seen = scanTsIso;
      row.last_scan_id = scanId;
      seedFix(row);
    }

    // Exploit intelligence — one call for all three branches above, because the merge is
    // monotone and idempotent (unlike seedFix, which has to run per-branch around the reopen
    // reset). See mergeRiskSignals for why this is sticky rather than latest-wins.
    mergeRiskSignals(row, rec, scanTsIso);

    // Latest observation wins for display attributes.
    row.severity = sev;
    row.cve = (clean(rec["name"]) as string | null) ?? null;
    row.asset_id = field(rec, "vulnerableAsset.id") || row.asset_id;
    row.asset_name = field(rec, "vulnerableAsset.name") || row.asset_name;
    row.asset_type = field(rec, "vulnerableAsset.type") || row.asset_type;
    row.cloud = field(rec, "vulnerableAsset.cloudPlatform") || row.cloud;
    row.subscription_name =
      field(rec, "vulnerableAsset.subscriptionName") || row.subscription_name;
    row.subscription_ext_id =
      field(rec, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId") ||
      row.subscription_ext_id;
    row.tags_json = tagsJson(rec) ?? row.tags_json;

    // API-declared resolution closes a currently-open row.
    if (apiSaysResolved && row.status === "OPEN") {
      row.status = "RESOLVED";
      row.resolved_at = present(apiResolved) ? toIso(parseTs(apiResolved)) : scanTsIso;
      row.resolution_src = "api";
      resolvedCount += 1;
    }

    observations.push({
      scan_id: scanId,
      vuln_key: key,
      present: 1,
      severity: sev,
      status: row.status,
    });
  }

  // Disappearance: OPEN vulns present in the immediately-previous scan but absent now.
  if (prevScanId !== null) {
    const scope = scannedSeverities !== null ? new Set(scannedSeverities) : null;
    for (const [key, row] of Object.entries(updated)) {
      if (seen.has(key) || row.status === "RESOLVED") continue;
      const sevRow = row.severity;
      if (scope !== null && (sevRow === null || !scope.has(sevRow))) {
        // This severity wasn't scanned — absence is expected, not resolution.
        continue;
      }
      const expectedPrev =
        (prevScanIdBySeverity ?? {})[sevRow ?? ""] ?? prevScanId;
      if (row.last_scan_id !== expectedPrev) continue;
      if (disappearanceMode === "midpoint" && prevScanTs) {
        row.resolved_at = midpointIso(prevScanTs, scanTsIso);
      } else {
        row.resolved_at = scanTsIso;
      }
      row.status = "RESOLVED";
      row.resolution_src = "disappeared";
      resolvedCount += 1;
      observations.push({
        scan_id: scanId,
        vuln_key: key,
        present: 0,
        severity: row.severity,
        status: "RESOLVED",
      });
    }
  }

  return {
    ledger: updated,
    observations,
    deltas: {
      new_count: newCount,
      resolved_count: resolvedCount,
      reopened_count: reopenedCount,
    },
  };
}
