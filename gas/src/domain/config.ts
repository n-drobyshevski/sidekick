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

// --------------------------------------------------------------------------- cold zone

/**
 * The `resolution_src` reconcile writes when a finding VANISHED from a scan rather than
 * being reported closed by the API (`reconcile.ts`: "Disappearance"). Exported here because
 * two readers need the same literal: reconcile writes it, and `coldZone.ts` reads it to tell
 * a drop-out apart from remediation. Not to be confused with `DISAPPEARANCE_RESOLUTION`
 * above, which names the TIMESTAMPING strategy ("scan_ts" / "midpoint"), not the source.
 */
export const RESOLUTION_DISAPPEARED = "disappeared";

/**
 * How long a silence has to be before the register calls an asset COLD, in days.
 *
 * 90 DAYS IS A CHOICE, NOT A MEASUREMENT, and it sits here beside `SLA_TARGETS` because it
 * is the same kind of fact — an operator's statement of what "too long" means, which the
 * Settings page can change. It is deliberately NOT one of the SLA targets: those ask "was
 * THIS finding fixed in time", one row at a time, and every one of them would still be met
 * by an asset nobody has touched in a year as long as the findings on it are LOW. This
 * asks the other question — has anything at all happened here — so it is a single window for
 * the whole asset and it matches the longest routine remediation window (LOW = 90 d):
 * a quarter with no movement of any severity is a silence, not a backlog.
 *
 * The bounds are guardrails for the settings clamp, and each end is a refusal:
 *   MIN 7    below a week the figure measures the scan cadence, not engagement — a register
 *            synced weekly would show every asset cold on the first quiet Monday.
 *   MAX 365  past a year "cold" stops being actionable; an asset silent for longer than
 *            the retention window has nothing left on record to explain the silence with.
 */
export const DEFAULT_COLD_AFTER_DAYS = 90;
export const COLD_AFTER_DAYS_MIN = 7;
export const COLD_AFTER_DAYS_MAX = 365;

/**
 * The SECOND way to draw the same line: relative ("dynamic") cold zoning.
 *
 * `fixed` is the window above — an asset is cold after `coldAfterDays` of silence, and
 * the number means the same thing on every estate. `relative` asks the other question: which
 * assets are the idlest COMPARED WITH THE REST OF THIS ESTATE? The operator names a
 * share (the idlest 20%, say) and the line in days is derived from the population, so it
 * follows the estate instead of standing still while the estate moves underneath it.
 *
 * WHY A SHARE IS A LEGITIMATE DEFINITION, and not just a prettier way to sort:
 *   * EPSS publishes a PERCENTILE beside its probability for exactly this reason — a raw
 *     score is unreadable without the distribution it came from, and a percentile line stays
 *     consistent as the distribution shifts, where a fixed line silently changes meaning.
 *   * "the top Y% of assets by relative risk" is an established alternative to fixed numeric
 *     thresholds in security dashboards, because it bounds the work the number creates.
 *   * Idle times are HEAVY-TAILED (a few assets silent for years, most for days). That
 *     is the regime where data-driven cuts — head/tail breaks, Jiang 2013 — beat fixed bins,
 *     because a fixed bin over a heavy tail either catches everything or nothing.
 *
 * WHAT A DATA-DRIVEN CUT GETS WRONG, and what is here to catch it. Any "idlest X%" rule will
 * name somebody, however healthy the estate, and that is a slander the register has to be
 * able to refuse. Two failure modes, two answers:
 *   1  SMALL n. With four assets carrying open findings, the idlest 20% is one
 *      asset — whoever happens to be last, even at three days of silence.
 *   2  ALL-SIMILAR population. If every asset was touched this week, the idlest 20% are
 *      still only a few days idle, and calling them cold measures nothing but the sort order.
 * Both are answered by `DEFAULT_COLD_FLOOR_DAYS`: the derived line is never allowed below the
 * floor, so a fresh or well-tended estate simply reports fewer cold assets than the
 * target asked for — and `coldZone.ts` publishes `derived_days`, `floor_applied` and the
 * ACHIEVED share beside the target, so the page can say the zone came out smaller than asked
 * rather than pretending the target was met. The reverse (ties at the cutoff pushing the
 * achieved share ABOVE the target) is published the same way.
 *
 * Bounds, and why each end is a refusal:
 *   TARGET MIN 1   below one percent the "share" is a rounding artefact of the estate size.
 *   TARGET MAX 50  past half the estate, "the cold zone" stops naming a minority worth
 *                  looking at and becomes a statement about the register's own cadence.
 *   FLOOR MIN 1    a floor of zero is no floor: it would let the derived line sit at "idle
 *                  since yesterday" on an estate where everything is being worked.
 *   FLOOR MAX      the fixed window's own maximum, so neither mode can draw a line past the
 *                  point where "cold" stops being actionable (see `COLD_AFTER_DAYS_MAX`).
 */
export type ColdZoneMode = "fixed" | "relative";
export const COLD_ZONE_MODES: readonly ColdZoneMode[] = ["fixed", "relative"];
export const DEFAULT_COLD_ZONE_MODE: ColdZoneMode = "fixed";
export const DEFAULT_COLD_TARGET_SHARE_PCT = 20;
export const COLD_TARGET_SHARE_PCT_MIN = 1;
export const COLD_TARGET_SHARE_PCT_MAX = 50;
export const DEFAULT_COLD_FLOOR_DAYS = 14;
export const COLD_FLOOR_DAYS_MIN = 1;
export const COLD_FLOOR_DAYS_MAX = COLD_AFTER_DAYS_MAX;
