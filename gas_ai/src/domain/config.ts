// Static configuration for Wiz SIDEKICK AI. The severity palette is IDENTICAL to the
// OS-vulnerability tool (gas/src/domain/config.ts) — severity meaning must read the
// same across the product family. Brand accent (crimson) lives only in styles.css and
// charts.js; it never appears here because severity must not follow the brand.

export const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * The issue statuses the register collects AND counts — one list, so the Wiz filter
 * (aiIssuesVariables) and every rollup cannot disagree about the population.
 *
 * They did disagree. The query has always asked for OPEN *and* IN_PROGRESS, and then
 * seven separate readers threw the IN_PROGRESS rows away with `status === "OPEN"`: the
 * issues reached the ai_issues tab and were counted by nothing. That is why the register
 * total read lower than the same filter in the Wiz console.
 *
 * Not for configurationFindings — their status vocabulary is OPEN/RESOLVED/REJECTED with
 * no in-progress state, and normalizeConfigFindingsPage filters on its own.
 */
export const UNRESOLVED_ISSUE_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

/** Whether an issue is still live work: it is on the register and it is not done. */
export function isUnresolvedIssue(issue: { status?: string }): boolean {
  return (UNRESOLVED_ISSUE_STATUSES as readonly string[]).includes(String(issue.status ?? ""));
}

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

// AARS (AI Asset Risk Score) severity, worst first — the score's own risk level, as
// opposed to the Wiz severity of an asset's open issues. The two scales carry the same
// values (this one simply has no UNKNOWN: every scored asset lands somewhere), so a
// score's severity reads with the severity tokens directly and introduces no new color.
export const AARS_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type AarsSeverity = (typeof AARS_SEVERITY_ORDER)[number];

/** A legacy `MINIMAL` — the old name for the bottom band — read as today's INFO. */
export function normalizeAarsSeverity(v: unknown): AarsSeverity | undefined {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "MINIMAL") return "INFO";
  return (AARS_SEVERITY_ORDER as readonly string[]).includes(s) ? (s as AarsSeverity) : undefined;
}

// Graph projection guardrails (server-side depth control). Depth is user-facing;
// the caps keep any single getGraph payload bounded regardless of tenant size.
// Both budgets count everything the payload carries, "+N more" stubs included, so
// the numbers below are what the browser actually receives and draws.
export const DEPTH_MIN = 1;
export const DEPTH_MAX = 3;
export const DEPTH_DEFAULT = 2;
/** Nodes per view, overridable per deployment in Settings and per view by "Load more". */
export const MAX_NODES_DEFAULT = 100;
export const MAX_NODES_FLOOR = 30;
export const MAX_NODES_CEILING = 400;
/** projectGraph's own fallback: the edge budget that goes with a 100-node view. */
export const MAX_EDGES_DEFAULT = 250;
/**
 * Edges allowed per node of budget. Fixing the edge cap while the node budget moves would
 * make a raised budget draw more nodes with fewer of their connections; at the default
 * 100-node view this ratio reproduces MAX_EDGES_DEFAULT exactly.
 */
export const EDGE_BUDGET_RATIO = 2.5;
/**
 * Share of the node budget a single wave of seeds may claim. A bulk start ("every toxic
 * combination", "every scored asset") can name more seeds than the budget holds, and a
 * view that is all seeds and no neighbors shows no attack paths at all — the one thing
 * the graph exists to show. Waves leave room for each seed's surroundings; when the
 * neighbors run out before the budget does, the next wave takes the remainder.
 */
export const SEED_WAVE_RATIO = 0.4;
