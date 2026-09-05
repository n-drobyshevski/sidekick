// Static configuration — the port of wiz_dashboard/config.py (the pure constants only;
// paths and file names are replaced by Sheets/Drive IDs in Script Properties).

export const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

// Light-theme severity palette (see DESIGN.md); mirrored as --sev-* tokens in
// gas_shared/styles/tokens.base.css, byte-identical across all four surfaces.
export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#d97706",
  LOW: "#2563eb",
  INFO: "#64748b",
  UNKNOWN: "#475569",
};

// Non-color severity signal (accessibility): meaning never rides on color alone.
export const SEVERITY_GLYPHS: Record<string, string> = {
  CRITICAL: "\u{1F534}",
  HIGH: "\u{1F7E0}",
  MEDIUM: "\u{1F7E1}",
  LOW: "\u{1F535}",
  INFO: "⚪",
  UNKNOWN: "⚫",
};

// Standard VM SLAs (days).
export const SLA_TARGETS: Record<string, number> = {
  CRITICAL: 7,
  HIGH: 14,
  MEDIUM: 30,
  LOW: 90,
  INFO: 180,
};

// EPSS probability at or above this counts as a priority signal. 0.1 is the conventional
// operational cut (FIRST guidance treats >=0.1 as meaningful exploitation likelihood); 0.5
// would qualify almost nothing in typical fleets.
//
// Lives here, beside SLA_TARGETS, because it is a policy constant two classifiers read:
// `insights.exploitSummary` and `program.DEFAULT_RISK_RULE`. It used to live in insights.ts,
// which made program.ts import insights.ts — and that blocked insights.ts from ever importing
// program.ts back. `insights.riskTierStats` needs exactly that, so the constant moved rather
// than the classifier being duplicated. insights.ts re-exports it, so every existing import
// still resolves.
export const EPSS_PRIORITY_THRESHOLD = 0.1;

// UNKNOWN is a local normalization bucket, never an API value — not user-selectable.
export const SELECTABLE_SEVERITIES = SEVERITY_ORDER.filter((s) => s !== "UNKNOWN");
export const DEFAULT_FETCH_SEVERITIES = ["CRITICAL", "HIGH"];
export const DEFAULT_DISPLAY_SEVERITIES = ["CRITICAL", "HIGH"];

// App severity -> Wiz API enum for filterBy.severity (the API spells INFO as INFORMATIONAL).
export const API_SEVERITY_VALUES: Record<string, string> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INFO: "INFORMATIONAL",
};

// API statuses that mean remediated/closed — the MTTR stop-clock.
export const RESOLVED_STATUSES = new Set(["RESOLVED", "REMEDIATED", "FIXED", "CLOSED"]);

/**
 * Is this finding still open? The polarity is deliberate and load-bearing: anything that is
 * NOT a recognized resolved status counts as open, including a blank or unfamiliar one. A new
 * Wiz status the app has never seen should leave a finding in the backlog where someone will
 * look at it, not silently close it.
 *
 * Three domain modules each carry a private copy of this two-line test (insights, remediation,
 * program), each with its own tests; those are left alone. This export exists so the SERVER
 * layer has one to reach for instead of open-coding the same `.has(String(...).toUpperCase())`
 * at every call site — which is how the Executive tiles came to count resolved rows.
 */
export function isOpenStatus(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

// Disappearance-resolution timestamping: "scan_ts" (conservative; default) or "midpoint".
export const DISAPPEARANCE_RESOLUTION = "scan_ts";

// The actionable-clock legacy boundary. Rows first seen before this were captured under
// the old hasFix-only Wiz filter, so a vendor fix was — by construction — available as of
// their first_seen; withDerived treats them as fix_available_at == first_seen. Set to the
// deploy date of broadened (no-hasFix) ingestion. NOTE: pinned earlier than today's deploy
// so the dev sample harness (recent backdated scans) genuinely exercises the awaiting-
// vendor-fix path; UPDATE this to the real broadened-scan deploy date at production rollout.
export const REMEDIATION_ROLLOUT_ISO = "2026-07-01T00:00:00Z";

// Retention / compaction guardrails.
export const DEFAULT_RETENTION_DAYS = 180;
export const RETENTION_MIN_DAYS = 30;
export const MIN_UNSEALED_FLAT_SCANS = 2;
