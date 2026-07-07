// AARS — AI Asset Risk Score, the port of ai/custom_score.md. Three pillars:
//   A (0–50)  toxic-combination participation: worst open-issue severity, ×1.2 when
//             the asset appears in more than one issue, capped at 50
//   B (0–30)  compliance framework gaps: summed per-gap points, capped at 30
//   C (0–22)  data exposure: sensitive 20 / unconfirmed data access 10 / none 0,
//             then the systemic 5Rs=53% amplifier ×1.1 (→ 22 / 11 / 0)
// The applied 14-row table in ai/custom_score.md is normative; aars.test.ts
// reproduces every row exactly.

import type { AarsBand, Severity } from "./config";

export type DataExposure = "SENSITIVE" | "DATA_ACCESS" | "NONE";

export interface AarsGap {
  code: string;    // "LLM06", "ASI10", "ML_DATA_POISONING", "FIVE_RS", "NO_GUARDRAIL", "DEPRECATED_MODEL"
  points: number;
}

export interface AarsInput {
  issueSeverities: Severity[];   // severities of the asset's OPEN issues (one per issue)
  gaps: AarsGap[];               // compliance gaps, points already resolved
  dataExposure: DataExposure;
}

export interface AarsResult {
  score: number;                 // 0–100, integer
  band: AarsBand;
  pillars: { toxic: number; compliance: number; data: number };
}

const SEVERITY_POINTS: Record<string, number> = {
  CRITICAL: 50,
  HIGH: 35,
  MEDIUM: 20,
  LOW: 8,
};

const MULTI_ISSUE_MULTIPLIER = 1.2;
const PILLAR_A_CAP = 50;
const PILLAR_B_CAP = 30;
const DATA_EXPOSURE_POINTS: Record<DataExposure, number> = {
  SENSITIVE: 20,
  DATA_ACCESS: 10,
  NONE: 0,
};
// 5Rs framework at 53% — data-exposure controls are systemically weak, so all
// data-related points are amplified (ai/custom_score.md Pillar C).
const FIVE_RS_MULTIPLIER = 1.1;

/**
 * Default gap points by code, matching the applied table: primary OWASP LLM and
 * Agentic (ASI*) control gaps score 10; the secondary LLM04/LLM05 rows, OWASP ML
 * and 5Rs gaps score 5; a missing guardrail is a primary 10; a deprecated model 5.
 */
export function defaultGapPoints(code: string): number {
  const c = code.toUpperCase();
  if (c === "NO_GUARDRAIL") return 10;
  if (c === "DEPRECATED_MODEL") return 5;
  if (c === "LLM04" || c === "LLM05") return 5;
  if (c.startsWith("LLM")) return 10;
  if (c.startsWith("ASI")) return 10;
  if (c.startsWith("ML")) return 5;
  if (c === "FIVE_RS" || c.startsWith("5R")) return 5;
  return 5;
}

export function gap(code: string, points?: number): AarsGap {
  return { code, points: points ?? defaultGapPoints(code) };
}

export function aarsBand(score: number): AarsBand {
  if (score >= 70) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 30) return "MEDIUM";
  if (score >= 10) return "LOW";
  return "MINIMAL";
}

function worstSeverityPoints(severities: Severity[]): number {
  let worst = 0;
  for (const s of severities) {
    const p = SEVERITY_POINTS[s] ?? 0;
    if (p > worst) worst = p;
  }
  return worst;
}

export function computeAars(input: AarsInput): AarsResult {
  let toxic = worstSeverityPoints(input.issueSeverities);
  if (input.issueSeverities.length > 1) toxic *= MULTI_ISSUE_MULTIPLIER;
  toxic = Math.min(PILLAR_A_CAP, Math.round(toxic));

  const compliance = Math.min(
    PILLAR_B_CAP,
    input.gaps.reduce((acc, g) => acc + g.points, 0),
  );

  const data = Math.round(DATA_EXPOSURE_POINTS[input.dataExposure] * FIVE_RS_MULTIPLIER);

  const score = Math.min(100, toxic + compliance + data);
  return { score, band: aarsBand(score), pillars: { toxic, compliance, data } };
}
