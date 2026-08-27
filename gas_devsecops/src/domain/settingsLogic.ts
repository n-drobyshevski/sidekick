// Settings semantics, kept pure so the half that can be wrong is the half vitest can hold.
//
// Phase 1 carries the settings the shell itself needs. The register's collection knobs
// (which scopes to sync, which severities to request) are declared here rather than in
// Phase 2 because the Settings page reads them today, and a page that offers a control
// with nothing behind it is the thing this product does not do.

import { SCOPES, SEVERITY_ORDER, SLA_TARGETS, type Scope } from "./config";
import type { Rec } from "./util";

export interface Settings {
  /** Which registers the sync battery collects. At least one, always. */
  scopes: Scope[];
  /** Which severities to request from the API. Empty means all. */
  fetchSeverities: string[];
  /** Remediation windows, in days, by severity. */
  slaTargets: Record<string, number>;
  /** Show routes flagged experimental in the nav. */
  showExperimental: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scopes: [...SCOPES],
  // CRITICAL and HIGH by default, matching brick/devsecops. Not a policy claim about what
  // matters — it is what keeps a first sync inside one execution budget on an estate where
  // a single repository carries ~6,900 SCA findings.
  fetchSeverities: ["CRITICAL", "HIGH"],
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
    fetchSeverities: asList(r.fetchSeverities, SEVERITY_ORDER) ?? [...DEFAULT_SETTINGS.fetchSeverities],
    slaTargets: sla,
    showExperimental: r.showExperimental === true,
  };
}

/** Stage two: what a human got wrong, in words. Never repairs — that is stage one's job. */
export function validateSettings(s: Settings): string[] {
  const errs: string[] = [];
  if (!s.scopes.length) errs.push("Выберите хотя бы один реестр для сбора.");
  for (const [sev, days] of Object.entries(s.slaTargets)) {
    if (!Number.isFinite(days) || days <= 0) {
      errs.push(`Срок SLA для «${sev}» должен быть положительным числом дней.`);
    }
  }
  return errs;
}

/** Merge a patch over current settings, then re-clean. */
export function withSettings(current: Settings, patch: Partial<Settings>): Settings {
  return cleanSettings({ ...current, ...patch } as unknown as Rec);
}
