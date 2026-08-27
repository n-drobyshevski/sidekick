// Settings semantics, kept pure so the half that can be wrong is the half vitest can hold.
//
// Phase 1 carries the settings the shell itself needs. The register's collection knobs
// (which scopes to sync, which severities to request) are declared here rather than in
// Phase 2 because the Settings page reads them today, and a page that offers a control
// with nothing behind it is the thing this product does not do.

import {
  DEFAULT_FETCH_SEVERITIES, SCOPES, SEVERITY_ORDER, SLA_TARGETS, type Scope,
} from "./config";
import type { Rec } from "./util";

export interface Settings {
  /** Which registers the sync battery collects. At least one, always. */
  scopes: Scope[];
  /**
   * Which severities to request from the API, PER SCOPE. Empty means all.
   *
   * Per-scope rather than one list, for the same reason the defaults are: an operator
   * narrowing SCA to CRITICAL/HIGH must not silently delete every PASSWORD and CERTIFICATE
   * from the secrets register, which is what a shared list does.
   */
  fetchSeverities: Record<Scope, string[]>;
  /** Remediation windows, in days, by severity. */
  slaTargets: Record<string, number>;
  /** Show routes flagged experimental in the nav. */
  showExperimental: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scopes: [...SCOPES],
  fetchSeverities: {
    sca: [...DEFAULT_FETCH_SEVERITIES.sca],
    sast: [...DEFAULT_FETCH_SEVERITIES.sast],
    secrets: [...DEFAULT_FETCH_SEVERITIES.secrets],
  },
  slaTargets: { ...SLA_TARGETS },
  showExperimental: false,
};

function asList(v: unknown, allowed: readonly string[]): string[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  for (const x of v) {
    const s = String(x).trim().toUpperCase();
    if (allowed.includes(s as never)) seen.add(s);
  }
  return [...seen];
}

/**
 * Coerce the stored fetchSeverities into the per-scope record, MIGRATING THE OLD SHAPE.
 *
 * This setting used to be one flat array applied to every scope, and the settings tab of any
 * existing deployment still holds it that way. A migration that dropped it would silently
 * reset an operator's choice on the next save; one that threw would take the app down over a
 * settings row. So a stored array is read as "this was your answer for every scope" and
 * spread across all three — which is exactly what it meant when it was written.
 *
 * A scope missing from a stored record falls back to ITS OWN default rather than to another
 * scope's, since that is the whole point of the record. An explicitly empty list is a real
 * answer — "every severity" — and survives.
 */
function cleanFetchSeverities(raw: unknown): Record<Scope, string[]> {
  const out = {} as Record<Scope, string[]>;

  if (Array.isArray(raw)) {
    const shared = asList(raw, SEVERITY_ORDER) ?? [];
    for (const scope of SCOPES) {
      out[scope] = shared.length ? [...shared] : [...DEFAULT_FETCH_SEVERITIES[scope]];
    }
    return out;
  }

  const rec = (raw ?? {}) as Record<string, unknown>;
  for (const scope of SCOPES) {
    out[scope] = asList(rec[scope], SEVERITY_ORDER) ?? [...DEFAULT_FETCH_SEVERITIES[scope]];
  }
  return out;
}

/**
 * Stage one: coerce whatever is stored into shape. NEVER throws and never reports — a
 * settings tab edited by hand must not be able to take the app down. Stage two
 * (`validateSettings`) is what tells a human they typed something wrong.
 */
export function cleanSettings(raw: Rec | null | undefined): Settings {
  const r = (raw || {}) as Rec;
  const scopes = (Array.isArray(r.scopes) ? r.scopes : [])
    .map((x) => String(x).trim().toLowerCase())
    .filter((x): x is Scope => (SCOPES as readonly string[]).includes(x));

  const sla: Record<string, number> = { ...SLA_TARGETS };
  const rawSla = (r.slaTargets || {}) as Rec;
  for (const sev of SEVERITY_ORDER) {
    const v = Number((rawSla as Record<string, unknown>)[sev]);
    if (Number.isFinite(v) && v > 0) sla[sev] = Math.floor(v);
  }

  return {
    // An empty list would collect nothing while looking configured, so it falls back
    // rather than persisting a register that can never fill.
    scopes: scopes.length ? scopes : [...SCOPES],
    fetchSeverities: cleanFetchSeverities(r.fetchSeverities),
    slaTargets: sla,
    showExperimental: r.showExperimental === true,
  };
}

/** Stage two: what a human got wrong, in words. Never repairs — that is stage one's job. */
export function validateSettings(s: Settings): string[] {
  const errs: string[] = [];
  if (!s.scopes.length) errs.push("Choose at least one register to collect.");
  for (const scope of s.scopes) {
    if (!Array.isArray(s.fetchSeverities?.[scope])) {
      errs.push(`No severity selection stored for the ${scope} register.`);
    }
  }
  for (const [sev, days] of Object.entries(s.slaTargets)) {
    if (!Number.isFinite(days) || days <= 0) {
      errs.push(`The SLA target for ${sev} must be a positive number of days.`);
    }
  }
  return errs;
}

/** Merge a patch over current settings, then re-clean. */
export function withSettings(current: Settings, patch: Partial<Settings>): Settings {
  return cleanSettings({ ...current, ...patch } as unknown as Rec);
}
