// Static configuration — the port of wiz_dashboard/config.py (the pure constants only;
// paths and file names are replaced by Sheets/Drive IDs in Script Properties).

export const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

// Light-theme severity palette (see DESIGN.md); mirrored as --sev-* tokens in styles.css.
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

// Resolved within this many days is the auto-patch "fast lane" — vulns detected
// just before a patch window and closed immediately, the mass that pins the median
// near zero. User-configurable (fast_lane_days setting); this is the default and the
// upper cap. Not an SLA; see remediation.fastLaneSplit and settingsLogic.getFastLaneDays.
// The cap = the LOW SLA target; beyond it the fast lane swallows everything.
export const DEFAULT_FAST_LANE_DAYS = 1;
export const FAST_LANE_MAX_DAYS = 90;

// Standard VM SLAs (days).
export const SLA_TARGETS: Record<string, number> = {
  CRITICAL: 7,
  HIGH: 14,
  MEDIUM: 30,
  LOW: 90,
  INFO: 180,
};

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
