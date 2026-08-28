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

import { SCOPES, SCOPE_LABELS, SEVERITY_ORDER, SLA_TARGETS, type Scope } from "../domain/config";
import { baseRows } from "../domain/ledgerCore";
import {
  awaitingVendorFix, kaplanMeier, mttrPercentiles, openAgePercentiles, openPastSla,
  resolutionBuckets,
} from "../domain/remediation";
import { readLedger, readScans } from "./ledgerStore";
import { SAMPLE_SCANS } from "./sampleData";
import { runScan, sampleSource } from "./sync";
import { registerPage, type RegisterQuery } from "./registers";
import { BUILD_ID } from "./buildInfo";
import { getProp, hasWizCredentials, PROP_KEYS, setProp } from "./props";
import { loadSettings, saveSettings } from "./settingsStore";
import { validateSettings, withSettings } from "../domain/settingsLogic";
import { deploymentDiagnostic } from "./diagnostics";
import { readAll, TABS } from "./sheetsDb";
import * as access from "./access";
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
  scopeLabels: Record<string, string>;
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
    // Shipped so the Settings page can label a scope without a second copy of the mapping —
    // and so its divergence warning can compare against the SHARED windows rather than a
    // client-side duplicate of them, which is the copy that would drift invisibly.
    scopeLabels: SCOPE_LABELS,
    severityOrder: SEVERITY_ORDER,
    slaTargets: SLA_TARGETS,
    latestScan: latest,
    canEditAccess: access.canEditUsers(),
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
        scans.push(runScan(scope, sampleSource(s.nodes), {
          scanId: `${s.id}-${scope}`,
          ts: s.ts,
          // The gate THIS scan applied, not the one the settings hold now.
          severities: s.gates?.[scope] ?? null,
        }));
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


/* ------------------------------------------------------------- the register pages */

/** Read a list param that may arrive as an array or a comma string (the URL hash form). */
function readList(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map((x) => String(x).toUpperCase()).filter(Boolean);
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
}

/**
 * One page of one register.
 *
 * `page` and `pageSize` reach `registerPage` but never reach a cache key — see the rule at
 * the top of registers.ts. An unknown scope is REFUSED rather than defaulted: defaulting
 * would answer a question nobody asked with a register they were not looking at.
 */
export function getRegister(p?: Record<string, unknown>): ApiResult<ReturnType<typeof registerPage>> {
  return run(() => {
    const params = p ?? {};
    const scope = String(params["scope"] ?? "");
    if (!(SCOPES as readonly string[]).includes(scope)) {
      throw new Error(`Unknown register scope "${scope}" — expected one of ${SCOPES.join(", ")}.`);
    }
    const q: RegisterQuery = {
      scope: scope as Scope,
      severities: readList(params["severities"]),
      repo: (params["repo"] as string) || null,
      status: (params["status"] as string) || null,
      validation: (params["validation"] as string) || null,
      awaitingVendor: params["awaitingVendor"] === true || params["awaitingVendor"] === "1",
    };
    return registerPage(
      q,
      Math.max(0, Number(params["page"] ?? 0)),
      Number(params["pageSize"] ?? 50),
      (params["sort"] as string) || null,
    );
  });
}

export interface ExecutivePayload {
  km: ReturnType<typeof kaplanMeier>;
  /** Open counts, severity x scope. The row a leader reads across. */
  openBySeverity: Record<string, Record<string, number>>;
  totals: Record<string, { open: number; resolved: number; total: number }>;
  /** The last scan of each register, and what it changed. */
  lastScan: Record<string, { scan_id: string; ts: string; severities: string } | null>;
  /** Movement since the previous scan of each register. */
  movement: Record<string, { new_count: number; resolved_count: number; reopened_count: number } | null>;
  /**
   * Whether anything has ever been synced, and by what route. The page needs this to tell
   * "the register is empty" from "the register has not been measured".
   */
  everScanned: boolean;
  /** True while the only rows present came from the bundled sample rather than a tenant. */
  sampleOnly: boolean;
}

/**
 * The front door's whole payload.
 *
 * NO RUN-SCAN CONTROL IS OFFERED, and that is deliberate rather than an omission. The stub
 * promised one; the live Wiz fetch does not exist yet, and a button that does nothing is
 * worse than no button — it makes a reader believe the number in front of them is one
 * refresh away from being current. The payload says what fed the register instead.
 */
export function getExecutive(_p?: unknown): ApiResult<ExecutivePayload> {
  return run(() => {
    const rows = baseRows(Object.values(readLedger()));
    const scans = readScans();

    const openBySeverity: Record<string, Record<string, number>> = {};
    const totals: Record<string, { open: number; resolved: number; total: number }> = {};
    for (const scope of SCOPES) {
      openBySeverity[scope] = {};
      totals[scope] = { open: 0, resolved: 0, total: 0 };
    }
    for (const r of rows) {
      const t = totals[r.scope] ?? (totals[r.scope] = { open: 0, resolved: 0, total: 0 });
      t.total += 1;
      if (r.status === "OPEN") {
        t.open += 1;
        const bucket = openBySeverity[r.scope] ?? (openBySeverity[r.scope] = {});
        bucket[r.severity] = (bucket[r.severity] ?? 0) + 1;
      } else {
        t.resolved += 1;
      }
    }

    const lastScan: ExecutivePayload["lastScan"] = {};
    const movement: ExecutivePayload["movement"] = {};
    for (const scope of SCOPES) {
      const mine = scans.filter((s) => s.scope === scope);
      const last = mine.length ? mine[mine.length - 1]! : null;
      lastScan[scope] = last
        ? { scan_id: last.scan_id, ts: last.ts, severities: last.severities }
        : null;
      // The deltas are already stored per scan, so movement is a read rather than a second
      // pass over the ledger — and it is the SCAN's own account of what it changed, which is
      // the only thing that can be right after a compaction.
      movement[scope] = last
        ? {
            new_count: last.new_count,
            resolved_count: last.resolved_count,
            reopened_count: last.reopened_count,
          }
        : null;
    }

    return {
      km: kaplanMeier(rows),
      openBySeverity,
      totals,
      lastScan,
      movement,
      everScanned: scans.length > 0,
      // From the scans tab's own `mode` column, not a scan_id prefix: a naming
      // convention is something a later caller forgets, and a page claiming real data
      // over sample rows is the worst lie this product could tell.
      sampleOnly: scans.length > 0 && scans.every((s) => s.mode !== "live"),
    };
  });
}


/* ------------------------------------------------------------------ who may open this */

/**
 * One Stackdriver line per change.
 *
 * A DELEGATED GRANT POWER NEEDS A RECORD OF WHO USED IT. The owner can hand an admin the
 * ability to admit people; without this, the only trace of an admission is the property's
 * current value, which says who has access and nothing about who let them in or when.
 */
function logAccessChange(what: string, actor: string, before: string[], after: string[]): void {
  const added = after.filter((e) => before.indexOf(e) < 0);
  const removed = before.filter((e) => after.indexOf(e) < 0);
  console.log(JSON.stringify({ access: "changed", what, actor, added, removed }));
}

/**
 * What the Access panel needs to draw itself.
 *
 * Callable by any allowed caller — the client has to ask whether to render the panel at all —
 * but THE ROSTER IS ONLY INCLUDED FOR SOMEONE WHO MAY EDIT IT. "No panel at all" has to mean
 * nothing on the wire, not just nothing in the DOM: a payload the client chose not to draw is
 * still a payload sitting in the browser's network log.
 */
export function getAccess(_p?: unknown): ApiResult<Record<string, unknown>> {
  return run(() => {
    if (!access.canEditUsers()) return { canEditUsers: false, canEditAdmins: false };
    return {
      canEditUsers: true,
      canEditAdmins: access.canEditAdmins(),
      owner: access.ownerEmail(),
      domain: access.ownerDomain(),
      users: access.currentUsers(),
      admins: access.currentAdmins(),
    };
  });
}

/**
 * Add or remove people. Owner or admin.
 *
 * THE PANEL IS NOT THE BOUNDARY — this re-checks, because `google.script.run` reaches
 * `api_saveAccess` directly from any allowed caller's browser console. Whatever the client
 * decided to draw has no bearing here.
 */
export function saveAccess(p?: { users?: unknown }): ApiResult<{ users: string[] }> {
  return run(() => {
    if (!access.canEditUsers()) throw new Error("Only the owner or an admin can change access.");
    const before = access.currentUsers();
    const list = access.validateAddresses(p?.users);
    // The owner is always written in. Redundant with the identity rule that admits them, but
    // it keeps the property self-documenting for whoever reads it in Project Settings, and it
    // matches what setup() seeds — one rule instead of a branch for "were they there before".
    const owner = access.ownerEmail().trim().toLowerCase();
    const withOwner = owner && list.indexOf(owner) < 0 ? [owner].concat(list) : list;
    setProp(PROP_KEYS.allowedUsers, withOwner.join(", "));
    logAccessChange("users", access.check().email, before, withOwner);
    return { users: withOwner };
  });
}

/**
 * Add or remove admins. OWNER ONLY — and this line is what keeps the tier real.
 *
 * An admin who could edit this could promote anyone, including making their own standing
 * permanent, and the delegation would be indistinguishable from handing over ownership. The
 * whole difference between a real second tier and a cosmetic one is this check.
 */
export function saveAdmins(p?: { admins?: unknown }): ApiResult<{ admins: string[] }> {
  return run(() => {
    if (!access.canEditAdmins()) throw new Error("Only the owner can change admins.");
    const before = access.currentAdmins();
    const list = access.validateAddresses(p?.admins);
    setProp(PROP_KEYS.allowedAdmins, list.join(", "));
    logAccessChange("admins", access.check().email, before, list);
    return { admins: list };
  });
}


/**
 * Save only the fields that moved.
 *
 * A PATCH rather than the whole object, which is `putSettings`'s shape and the reason this
 * exists beside it. The page batches edits across four tabs behind one save bar, and sending
 * the whole settings object would make every save a write of every key — so two readers saving
 * different tabs a minute apart would have the second silently revert the first's field to
 * whatever their page loaded with. `withSettings` merges over CURRENT, read at save time.
 *
 * Returns the cleaned result so the page can re-seed its draft from what was actually stored
 * rather than from what it sent — the two differ wherever `cleanSettings` normalizes.
 */
export function setSettings(p?: Record<string, unknown>): ApiResult<ReturnType<typeof loadSettings>> {
  return mutate(() => {
    const next = withSettings(loadSettings(), (p ?? {}) as never);
    const errors = validateSettings(next);
    if (errors.length) throw new Error(errors.join(" "));
    return saveSettings(next);
  });
}

/**
 * The System tab's read-only half: what this deployment is wired to.
 *
 * The diagnostic is a STRING built by diagnostics.ts and printed verbatim. It is the same text
 * an operator gets from the Apps Script editor, deliberately: a settings page that paraphrased
 * it would be a second thing to keep in step with the checks themselves.
 */
export function getDiagnostic(_p?: unknown): ApiResult<{ text: string; project: string | null }> {
  return run(() => ({
    text: deploymentDiagnostic(),
    // Read-only here. Changing the project scope changes WHICH POPULATION every register
    // measures, and a ledger built under one scope is not comparable with one built under
    // another — so it stays a Script Property, set deliberately, rather than a text box on a
    // settings page.
    project: getProp(PROP_KEYS.wizProjectIdV2),
  }));
}
