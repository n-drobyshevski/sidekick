// The RPC surface.
//
// EVERY EXPORT HERE NEEDS A DELEGATOR IN dist/entry.js, and test/entryPoints.test.ts holds
// the two together by reading both as text. The failure it catches is silent and
// production-only: a new endpoint ships, the client calls it, and google.script.run reports
// only that the function does not exist.
//
// Still deliberately small. The ledger core is in and the MTTR page reads it, so two
// endpoints joined the surface. The live sync did NOT: `sync.ts`'s live source refuses
// rather than returning an empty page, and no RPC pretends otherwise. Adding an endpoint
// that returns invented figures would be the one thing this product does not do.

import { SCOPES, SEVERITY_ORDER, SLA_TARGETS, type Scope } from "../domain/config";
import { baseRows } from "../domain/ledgerCore";
import {
  awaitingVendorFix, kaplanMeier, mttrPercentiles, openAgePercentiles, openPastSla,
  resolutionBuckets,
} from "../domain/remediation";
import { readLedger, readScans } from "./ledgerStore";
import { SAMPLE_SCANS } from "./sampleData";
import { runScan, sampleSource } from "./sync";
import { BUILD_ID } from "./buildInfo";
import { hasWizCredentials } from "./props";
import { loadSettings, saveSettings } from "./settingsStore";
import { readAll, TABS } from "./sheetsDb";
import { canEditUsers } from "./access";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";

/**
 * THE ENVELOPE, and it lives here rather than in dist/entry.js.
 *
 * google.script.run has no error channel that carries a message, so every RPC returns a
 * result object instead of throwing. Building it here rather than in the delegator is what
 * lets the dev harness dispatch straight into Server.api and still see exactly what the
 * deployed client sees — dev/boot.js's shim never runs entry.js.
 */
export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: string;
}

function run<T>(fn: () => T): ApiResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    const kind = e instanceof LedgerBusyError ? "busy" : "error";
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
  }
}

/** A write: take the lock, roll back a half-finished predecessor, then run. */
function mutate<T>(fn: () => T): ApiResult<T> {
  return run(() => withScriptLock(() => {
    recoverIfNeeded();
    return fn();
  }));
}

export interface Bootstrap {
  product: string;
  buildId: string;
  hasCredentials: boolean;
  scopes: readonly string[];
  severityOrder: readonly string[];
  slaTargets: Record<string, number>;
  latestScan: { scan_id: string; finished_at: string; total: number } | null;
  canEditAccess: boolean;
  settings: ReturnType<typeof loadSettings>;
}

/**
 * Everything the shell needs before it can draw: identity, credential state, the register's
 * vocabulary, and the freshness caption. One round trip, because the shell blocks on it.
 */
export function bootstrap(_p?: unknown): ApiResult<Bootstrap> {
  return run(() => {
  const scans = readAll(TABS.scans);
  let latest: Bootstrap["latestScan"] = null;
  for (const row of scans) {
    const ts = String(row.ts ?? "");
    if (!ts) continue;
    if (!latest || ts > latest.finished_at) {
      latest = {
        scan_id: String(row.scan_id ?? ""),
        finished_at: ts,
        total: Number(row.total ?? 0),
      };
    }
  }
  return {
    product: "Wiz Sidekick DevSecOps",
    buildId: BUILD_ID,
    hasCredentials: hasWizCredentials(),
    scopes: SCOPES,
    severityOrder: SEVERITY_ORDER,
    slaTargets: SLA_TARGETS,
    latestScan: latest,
    canEditAccess: canEditUsers(),
    settings: loadSettings(),
  };
  });
}

/** The current settings dict. */
export function getSettings(_p?: unknown): ApiResult<ReturnType<typeof loadSettings>> {
  return run(() => loadSettings());
}

/** Persist settings. Returns what was actually stored, after cleaning. */
export function putSettings(p: { settings?: unknown }): ApiResult<ReturnType<typeof loadSettings>> {
  return mutate(() => saveSettings(p.settings as never));
}

/**
 * The Chart.js bundle, fetched on demand.
 *
 * Chart.js is ~170 KB of the client payload and most routes draw nothing, so it ships as
 * its own HtmlService partial rather than inside js_app. Returning it through an RPC keeps
 * the sandbox happy — the page cannot add a <script src> the CSP would refuse.
 */
export function getChartsBundle(_p?: unknown): ApiResult<string> {
  return run(() => HtmlService.createHtmlOutputFromFile("js_charts").getContent());
}


/* ------------------------------------------------------------------- the ledger */

/**
 * Replay the sample dataset into the ledger.
 *
 * THE SAMPLE SOURCE ONLY, and the endpoint says so in its name rather than taking a `mode`
 * flag that could be pointed at a tenant by accident. The live paged fetch is not built; its
 * source refuses when called, so there is nothing here that could quietly run half of it.
 *
 * Re-running is a no-op: `runScan` finds each scan_id already in the log and returns its
 * stored deltas without rewriting anything. That is what makes the dev harness safe to
 * refresh, and it is the same property a real sync needs after a partial failure.
 */
export function runSampleSync(_p?: unknown): ApiResult<{ scans: unknown[]; seeded: boolean }> {
  return mutate(() => {
    if (!SAMPLE_SCANS.length) {
      throw new Error(
        "No sample dataset in this bundle. The deployed bundle ships none on purpose — a "
        + "register must show what its tenant has. Run `npm run dev`, which aliases the "
        + "dev dataset in.",
      );
    }
    const scans: unknown[] = [];
    for (const s of SAMPLE_SCANS) {
      for (const scope of SCOPES) {
        scans.push(runScan(scope, sampleSource(s.nodes), { scanId: `${s.id}-${scope}`, ts: s.ts }));
      }
    }
    return { scans, seeded: true };
  });
}

export interface MttrPayload {
  /** Which scopes the figures cover. `null` scope means all three together. */
  scope: string | null;
  km: ReturnType<typeof kaplanMeier>;
  percentiles: ReturnType<typeof mttrPercentiles>;
  openAge: ReturnType<typeof openAgePercentiles>;
  buckets: ReturnType<typeof resolutionBuckets>;
  sla: ReturnType<typeof openPastSla>;
  vendor: ReturnType<typeof awaitingVendorFix>;
  /** The denominators every figure on the page has to name. */
  population: { total: number; open: number; resolved: number; byScope: Record<string, number> };
  /** The scan that last covered each scope — the freshness caption, per register. */
  lastScanByScope: Record<string, { scan_id: string; ts: string } | null>;
}

/**
 * The MTTR & SLA page's whole payload, in one round trip.
 *
 * `scope` narrows to one register; omitted, the figures cover all three. Both are honest
 * answers to different questions — "how fast do we fix dependencies" and "how fast do we fix
 * anything" — and the page names which it is showing.
 */
export function getMttr(p?: { scope?: string }): ApiResult<MttrPayload> {
  return run(() => {
    const wanted = p?.scope && (SCOPES as readonly string[]).includes(p.scope)
      ? (p.scope as Scope)
      : null;
    const all = Object.values(readLedger());
    const rows = baseRows(wanted === null ? all : all.filter((r) => r.scope === wanted));

    const byScope: Record<string, number> = {};
    for (const r of rows) byScope[r.scope] = (byScope[r.scope] ?? 0) + 1;
    const open = rows.filter((r) => r.status === "OPEN").length;

    const scans = readScans();
    const lastScanByScope: Record<string, { scan_id: string; ts: string } | null> = {};
    for (const scope of SCOPES) {
      const forScope = scans.filter((s) => s.scope === scope);
      const last = forScope.length ? forScope[forScope.length - 1]! : null;
      lastScanByScope[scope] = last ? { scan_id: last.scan_id, ts: last.ts } : null;
    }

    return {
      scope: wanted,
      km: kaplanMeier(rows),
      percentiles: mttrPercentiles(rows),
      openAge: openAgePercentiles(rows),
      buckets: resolutionBuckets(rows),
      sla: openPastSla(rows),
      vendor: awaitingVendorFix(rows),
      population: { total: rows.length, open, resolved: rows.length - open, byScope },
      lastScanByScope,
    };
  });
}
