// Static configuration for Wiz SIDEKICK AI. The severity palette is IDENTICAL to the
// OS-vulnerability tool (gas/src/domain/config.ts) — severity meaning must read the
// same across the product family. Brand accent (crimson) lives only in styles.css and
// charts.js; it never appears here because severity must not follow the brand.

export const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

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

// AARS (AI Asset Risk Score) bands, worst first. Bands reuse the severity tokens for
// their visual treatment (MINIMAL borrows INFO) so no new color carries meaning.
export const AARS_BAND_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"] as const;
export type AarsBand = (typeof AARS_BAND_ORDER)[number];

export const AARS_BAND_SEVERITY_TOKEN: Record<string, string> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  MINIMAL: "INFO",
};

// Graph projection guardrails (server-side depth control). Depth is user-facing;
// the caps keep any single getGraph payload bounded regardless of tenant size.
export const DEPTH_MIN = 1;
export const DEPTH_MAX = 3;
export const DEPTH_DEFAULT = 2;
export const MAX_NODES_DEFAULT = 120;
export const MAX_EDGES_DEFAULT = 250;
