// The RPC surface.
//
// EVERY EXPORT HERE NEEDS A DELEGATOR IN dist/entry.js, and test/entryPoints.test.ts holds
// the two together by reading both as text. The failure it catches is silent and
// production-only: a new endpoint ships, the client calls it, and google.script.run reports
// only that the function does not exist.
//
// Phase 1 is deliberately small. The client needs a bootstrap payload and the lazy chart
// bundle; everything else arrives with the sync battery. Adding an endpoint that returns
// invented figures would be the one thing this product does not do.

import { SCOPES, SEVERITY_ORDER, SLA_TARGETS } from "../domain/config";
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
