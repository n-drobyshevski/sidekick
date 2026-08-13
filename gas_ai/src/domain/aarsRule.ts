// Pure semantics for the AARS scoring rule: coercion, validation, and prose. Kept out
// of aars.ts (which owns the score itself) and out of the store (which owns the sheet),
// so all three are unit-testable without GAS globals.
//
// Two-stage on purpose, following the risk-rule precedent in the OS-vulns tool: clean*
// coerces junk into the right shape and range, validate* reports what a human got wrong
// and is never silently repaired. A rule the operator cannot trust to mean what it says
// is worse than one that refuses to save.

import {
  DEFAULT_AARS_RULE,
  type AarsBands,
  type AarsRule,
  type BusinessImpact,
  type DataExposure,
  type GapAggregation,
  type GapMatch,
  type GapPointRule,
  type GapSources,
  type CombinationRule,
  type EnvMatch,
  type Environment,
  type EnvironmentRule,
  type InternetExposure,
  type IssueSeverityKey,
  type MultiIssueScaling,
  PILLAR_KEYS,
  type PillarKey,
  type PrivilegeLevel,
} from "./aars";
import { CONDITION_KEYS } from "./toxicCombos";
import { clampInt } from "./util";

export const POINTS_MIN = 0;
export const POINTS_MAX = 100;
export const MULTIPLIER_MIN = 1;
export const MULTIPLIER_MAX = 3;
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 3;
export const BAND_MIN = 1;
export const BAND_MAX = 100;
export const CODE_MAX_LEN = 64;
/** Cap on cascade rows: the whole rule lives in ONE `value_json` cell (~50k char limit). */
export const MAX_GAP_RULES = 60;
/** Same cell, same reason. Account-naming conventions need far fewer rows than gap codes. */
export const MAX_ENV_RULES = 30;
export const MAX_COMBINATION_RULES = 20;
export const COMBINATION_LABEL_MAX_LEN = 80;
export const ENV_PATTERN_MAX_LEN = 120;
/** A dormancy window under a week would fire on any asset synced over a long weekend. */
export const FLOOR_MAX = 0.95;
export const DORMANT_DAYS_MIN = 7;
export const DORMANT_DAYS_MAX = 3650;

const SEVERITY_KEYS: IssueSeverityKey[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const EXPOSURE_KEYS: DataExposure[] = ["SENSITIVE", "DATA_ACCESS", "NONE"];
const INTERNET_EXPOSURE_KEYS: InternetExposure[] = ["CONFIRMED", "UNDETERMINED", "NONE"];
const PRIVILEGE_KEYS: PrivilegeLevel[] = ["ADMIN", "HIGH", "NONE"];
const ENVIRONMENT_KEYS: Environment[] = ["PROD", "PREPROD", "NONPROD", "DEV", "UNCLASSIFIED"];
const BUSINESS_IMPACT_KEYS: BusinessImpact[] = ["HBI", "MBI", "LBI", "UNKNOWN"];
const BAND_KEYS: Array<keyof AarsBands> = ["critical", "high", "medium", "low"];
const BAND_LABELS: Record<keyof AarsBands, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

type Loose = Record<string, unknown>;

function rec(v: unknown): Loose {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {};
}

/** Multipliers carry two decimals — ×1.2 and ×1.1 are the spec's own precision. */
function clampMultiplier(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n * 100) / 100;
  return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, rounded));
}

/**
 * A fraction in [0,1], two decimals. The floor is never allowed to reach 1: a likelihood
 * pinned at certainty would make the multiplicative mode a pure impact score.
 */
function clampFraction(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n * 100) / 100;
  return Math.min(FLOOR_MAX, Math.max(0, rounded));
}

/**
 * A finding-severity weight. Unlike `clampMultiplier` this floor is 0, not 1: weighting a
 * LOW failing control down to nothing is a legitimate model, whereas a multiplier below 1
 * would mean "more issues, less risk".
 */
function clampWeight(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n * 100) / 100;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, rounded));
}

/**
 * One conjunction, or null when it names no recognisable condition. Unknown condition keys
 * are dropped, and a rule left with none is dropped entirely rather than kept as a rule
 * that fires on everything — the same reasoning as `firedCombinations`' empty-list guard.
 */
function cleanCombinationRule(v: unknown): CombinationRule | null {
  const raw = rec(v);
  const list = Array.isArray(raw["conditions"]) ? (raw["conditions"] as unknown[]) : [];
  const conditions: string[] = [];
  for (const c of list) {
    const key = String(c ?? "").trim().toUpperCase();
    if ((CONDITION_KEYS as readonly string[]).includes(key) && !conditions.includes(key)) {
      conditions.push(key);
    }
  }
  if (!conditions.length) return null;
  const rule: CombinationRule = {
    conditions,
    points: clampInt(raw["points"], 0, POINTS_MIN, POINTS_MAX),
  };
  const label = String(raw["label"] ?? "").trim().slice(0, COMBINATION_LABEL_MAX_LEN);
  if (label) rule.label = label;
  return rule;
}

/** One environment row, or null when it carries no usable pattern. */
function cleanEnvironmentRule(v: unknown): EnvironmentRule | null {
  const raw = rec(v);
  const pattern = String(raw["pattern"] ?? "").trim().slice(0, ENV_PATTERN_MAX_LEN);
  if (!pattern) return null;
  const match: EnvMatch = raw["match"] === "regex" ? "regex" : "contains";
  const env = String(raw["environment"] ?? "").trim().toUpperCase();
  // An unrecognised environment is dropped rather than defaulted: silently filing an
  // asset under the wrong environment is worse than not classifying it.
  if (!(ENVIRONMENT_KEYS as string[]).includes(env) || env === "UNCLASSIFIED") return null;
  return { match, pattern, environment: env as Environment };
}

export function cleanGapCode(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().slice(0, CODE_MAX_LEN);
}

function cleanGapRule(v: unknown): GapPointRule | null {
  const raw = rec(v);
  const code = cleanGapCode(raw["code"]);
  if (!code) return null;
  const match: GapMatch = raw["match"] === "prefix" ? "prefix" : "exact";
  return { match, code, points: clampInt(raw["points"], 0, POINTS_MIN, POINTS_MAX) };
}

/**
 * Coerce any stored or posted blob into a well-formed rule. Never throws and never
 * leaves a field undefined: an unreadable part falls back to the spec default, so a
 * hand-edited settings cell degrades to "the documented model", not to a broken score.
 */
export function cleanAarsRule(raw: unknown): AarsRule {
  const r = rec(raw);
  const sevRaw = rec(r["severityPoints"]);
  const severityPoints = {} as Record<IssueSeverityKey, number>;
  for (const k of SEVERITY_KEYS) {
    severityPoints[k] = clampInt(sevRaw[k], DEFAULT_AARS_RULE.severityPoints[k], POINTS_MIN, POINTS_MAX);
  }

  const expRaw = rec(r["dataExposurePoints"]);
  const dataExposurePoints = {} as Record<DataExposure, number>;
  for (const k of EXPOSURE_KEYS) {
    dataExposurePoints[k] = clampInt(
      expRaw[k],
      DEFAULT_AARS_RULE.dataExposurePoints[k],
      POINTS_MIN,
      POINTS_MAX,
    );
  }

  // A source is on ONLY when it says so: anything unreadable reads as off, so a
  // hand-edited cell can never silently widen what counts as a gap.
  const srcRaw = rec(r["gapSources"]);
  const gapSources: GapSources = {
    fiveRs: srcRaw["fiveRs"] === true,
    deprecatedModel: srcRaw["deprecatedModel"] === true,
    inactiveAgent: srcRaw["inactiveAgent"] === true,
    dormantAgent: srcRaw["dormantAgent"] === true,
  };

  const fswRaw = rec(r["findingSeverityWeights"]);
  const findingSeverityWeights = {} as Record<IssueSeverityKey, number>;
  for (const k of SEVERITY_KEYS) {
    findingSeverityWeights[k] = clampWeight(
      fswRaw[k],
      DEFAULT_AARS_RULE.findingSeverityWeights[k],
    );
  }

  const expoRaw = rec(r["exposurePoints"]);
  const exposurePoints = {} as Record<InternetExposure, number>;
  for (const k of INTERNET_EXPOSURE_KEYS) {
    exposurePoints[k] = clampInt(
      expoRaw[k],
      DEFAULT_AARS_RULE.exposurePoints[k],
      POINTS_MIN,
      POINTS_MAX,
    );
  }

  const privRaw = rec(r["privilegePoints"]);
  const privilegePoints = {} as Record<PrivilegeLevel, number>;
  for (const k of PRIVILEGE_KEYS) {
    privilegePoints[k] = clampInt(
      privRaw[k],
      DEFAULT_AARS_RULE.privilegePoints[k],
      POINTS_MIN,
      POINTS_MAX,
    );
  }

  const comboRaw = Array.isArray(r["combinationRules"]) ? (r["combinationRules"] as unknown[]) : null;
  const combinationRules = comboRaw
    ? comboRaw.map(cleanCombinationRule).filter((c): c is CombinationRule => c !== null)
        .slice(0, MAX_COMBINATION_RULES)
    : DEFAULT_AARS_RULE.combinationRules.map((c) => ({ ...c, conditions: [...c.conditions] }));

  const envRulesRaw = Array.isArray(r["environmentRules"]) ? (r["environmentRules"] as unknown[]) : null;
  const environmentRules = envRulesRaw
    ? envRulesRaw.map(cleanEnvironmentRule).filter((e): e is EnvironmentRule => e !== null)
        .slice(0, MAX_ENV_RULES)
    : DEFAULT_AARS_RULE.environmentRules.map((e) => ({ ...e }));

  const envPtsRaw = rec(r["environmentPoints"]);
  const environmentPoints = {} as Record<Environment, number>;
  for (const k of ENVIRONMENT_KEYS) {
    environmentPoints[k] = clampInt(
      envPtsRaw[k],
      DEFAULT_AARS_RULE.environmentPoints[k],
      POINTS_MIN,
      POINTS_MAX,
    );
  }
  // Not an operator choice. An asset no rule matched must score exactly as it would have
  // before environments existed — pricing "we could not tell" would put points on ignorance.
  environmentPoints.UNCLASSIFIED = 0;

  const biRaw = rec(r["businessImpactPoints"]);
  const businessImpactPoints = {} as Record<BusinessImpact, number>;
  for (const k of BUSINESS_IMPACT_KEYS) {
    businessImpactPoints[k] = clampInt(
      biRaw[k],
      DEFAULT_AARS_RULE.businessImpactPoints[k],
      POINTS_MIN,
      POINTS_MAX,
    );
  }
  // Same reasoning as environmentPoints.UNCLASSIFIED: an asset in no rated project must
  // score as it did before this axis existed, never as though it had been rated harmless.
  businessImpactPoints.UNKNOWN = 0;

  const bandRaw = rec(r["bands"]);
  const bands = {} as AarsBands;
  for (const k of BAND_KEYS) {
    bands[k] = clampInt(bandRaw[k], DEFAULT_AARS_RULE.bands[k], BAND_MIN, BAND_MAX);
  }

  const gapsRaw = Array.isArray(r["gapPoints"]) ? (r["gapPoints"] as unknown[]) : null;
  const gapPoints = gapsRaw
    ? gapsRaw.map(cleanGapRule).filter((g): g is GapPointRule => g !== null).slice(0, MAX_GAP_RULES)
    : DEFAULT_AARS_RULE.gapPoints.map((g) => ({ ...g }));

  // An unreadable mode falls back to the SPEC mode, never to the newer one: a rule blob
  // written before these fields existed must keep scoring exactly as it did.
  const multiIssueScaling: MultiIssueScaling = r["multiIssueScaling"] === "log2" ? "log2" : "flat";
  const gapAggregation: GapAggregation = r["gapAggregation"] === "rss" ? "rss" : "sum";

  return {
    severityPoints,
    multiIssueMultiplier: clampMultiplier(
      r["multiIssueMultiplier"],
      DEFAULT_AARS_RULE.multiIssueMultiplier,
    ),
    multiIssueScaling,
    pillarACap: clampInt(r["pillarACap"], DEFAULT_AARS_RULE.pillarACap, POINTS_MIN, POINTS_MAX),
    gapPoints,
    gapFallbackPoints: clampInt(
      r["gapFallbackPoints"],
      DEFAULT_AARS_RULE.gapFallbackPoints,
      POINTS_MIN,
      POINTS_MAX,
    ),
    gapAggregation,
    gapSources,
    scoringMode: r["scoringMode"] === "multiplicative" ? "multiplicative" : "additive",
    // Unknown pillar names are dropped rather than defaulted: a typo must not silently
    // move a whole pillar from the impact half to the likelihood half.
    likelihoodPillars: (Array.isArray(r["likelihoodPillars"]) ? r["likelihoodPillars"] : null)
      ? (r["likelihoodPillars"] as unknown[])
          .map((k) => String(k ?? "").trim())
          .filter((k, i, a): k is PillarKey =>
            (PILLAR_KEYS as string[]).includes(k) && a.indexOf(k) === i)
      : [...DEFAULT_AARS_RULE.likelihoodPillars],
    likelihoodFloor: clampFraction(r["likelihoodFloor"], DEFAULT_AARS_RULE.likelihoodFloor),
    dormantAfterDays: clampInt(
      r["dormantAfterDays"],
      DEFAULT_AARS_RULE.dormantAfterDays,
      DORMANT_DAYS_MIN,
      DORMANT_DAYS_MAX,
    ),
    findingSeverityWeights,
    pillarBCap: clampInt(r["pillarBCap"], DEFAULT_AARS_RULE.pillarBCap, POINTS_MIN, POINTS_MAX),
    dataExposurePoints,
    dataAmplifier: clampMultiplier(r["dataAmplifier"], DEFAULT_AARS_RULE.dataAmplifier),
    exposurePoints,
    privilegePoints,
    combinationRules,
    environmentRules,
    environmentPoints,
    businessImpactPoints,
    reachPointsPer: clampInt(r["reachPointsPer"], DEFAULT_AARS_RULE.reachPointsPer, POINTS_MIN, POINTS_MAX),
    reachCap: clampInt(r["reachCap"], DEFAULT_AARS_RULE.reachCap, POINTS_MIN, POINTS_MAX),
    bands,
  };
}

/**
 * What a human got wrong, in their words. Empty = saveable. The bands check is the one
 * that matters: a non-descending set would make aarsSeverity unreachable for a level,
 * silently retiring it from the scale.
 */
export function validateAarsRule(rule: AarsRule): string[] {
  const errors: string[] = [];

  for (let i = 1; i < BAND_KEYS.length; i++) {
    const upper = BAND_KEYS[i - 1]!;
    const lower = BAND_KEYS[i]!;
    if (rule.bands[upper] <= rule.bands[lower]) {
      errors.push(
        `The ${BAND_LABELS[upper]} threshold (${rule.bands[upper]}) must sit above the ` +
          `${BAND_LABELS[lower]} threshold (${rule.bands[lower]}) — otherwise no score can ` +
          `land in ${BAND_LABELS[lower]}.`,
      );
    }
  }

  // UNDETERMINED means "nobody has checked", so pricing it at or above a CONFIRMED
  // exposure would make not knowing worse than knowing the answer is yes — and would
  // reward leaving a hosted agent unexamined. Zero-vs-zero (pillar D off) is fine.
  const { CONFIRMED, UNDETERMINED, NONE } = rule.exposurePoints;
  if (UNDETERMINED > CONFIRMED) {
    errors.push(
      `Undetermined internet exposure (${UNDETERMINED}) must not score above confirmed ` +
        `exposure (${CONFIRMED}) — "we haven't checked" cannot outrank "yes, it is reachable".`,
    );
  }
  if (NONE > UNDETERMINED) {
    errors.push(
      `No internet exposure (${NONE}) must not score above undetermined exposure ` +
        `(${UNDETERMINED}).`,
    );
  }

  if (!rule.gapPoints.length) {
    errors.push(
      "The compliance-gap cascade has no rules; every gap would price at the fallback. " +
        "Add a rule or set the fallback deliberately.",
    );
  }
  if (rule.gapPoints.length > MAX_GAP_RULES) {
    errors.push(`The compliance-gap cascade is limited to ${MAX_GAP_RULES} rules.`);
  }

  const seen = new Set<string>();
  rule.gapPoints.forEach((g, i) => {
    if (!g.code) {
      errors.push(`Compliance-gap rule ${i + 1} has no code.`);
      return;
    }
    const key = `${g.match}:${g.code}`;
    if (seen.has(key)) {
      errors.push(`Compliance-gap rule ${i + 1} repeats ${g.match} "${g.code}".`);
    }
    seen.add(key);
  });

  return errors;
}

/**
 * Cascade rows that can never fire because an earlier row already matches everything
 * they would. Not an error — a first-match cascade is allowed to have dead rows — but
 * the page says so, since a dead row reads like a rule that is in force.
 */
export function shadowedGapRules(rule: AarsRule): number[] {
  const dead: number[] = [];
  rule.gapPoints.forEach((row, i) => {
    for (let j = 0; j < i; j++) {
      const earlier = rule.gapPoints[j]!;
      // An exact row only ever matches one code, so it can shadow another exact row of
      // the same code — never a prefix row, which matches a whole family.
      const shadows =
        earlier.match === "prefix"
          ? row.code.startsWith(earlier.code)
          : row.match === "exact" && row.code === earlier.code;
      if (shadows) {
        dead.push(i);
        return;
      }
    }
  });
  return dead;
}

/**
 * Every gap code a DERIVATION can raise, as opposed to one a tenant's findings might
 * carry. Three groups, matching the three places codes are made:
 *   - graphEnrich.deriveAarsInput: the OWASP families off issue mappings, NO_GUARDRAIL,
 *     and the three gapSources codes
 *   - syncNormalize.frameworkCodesFromRule: the same OWASP token shapes off config rules
 * A code outside this set is not an error — tenant finding shortIds live there, and the
 * cascade's fallback exists to govern them — but a cascade ROW naming a code outside it
 * can never fire, which is a different thing from a row this tenant merely doesn't exercise.
 */
const DERIVABLE_PREFIXES = ["LLM", "ASI", "ML_", "5R_"];
const DERIVABLE_EXACT = ["NO_GUARDRAIL", "DEPRECATED_MODEL", "INACTIVE_AGENT", "FIVE_RS"];

/** Whether any derivation could emit this code, given what the rule has switched on. */
function isDerivable(code: string, rule: AarsRule): boolean {
  const c = cleanGapCode(code);
  if (!c) return false;
  if (c === "DEPRECATED_MODEL") return rule.gapSources.deprecatedModel === true;
  if (c === "INACTIVE_AGENT") return rule.gapSources.inactiveAgent === true;
  if (c.startsWith("5R_")) return rule.gapSources.fiveRs === true;
  // FIVE_RS is the UNNAMED form. Nothing raises it: the fiveRs source always names which
  // of the five, so this code can only ever arrive on a tenant finding.
  if (c === "FIVE_RS") return false;
  if (DERIVABLE_EXACT.includes(c)) return true;
  return DERIVABLE_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * Rows that can never fire because NOTHING EMITS the code they name — as distinct from
 * `shadowedGapRules` (an earlier row already claims it) and from a row this tenant simply
 * doesn't exercise yet. The page must separate the three: only the last is a rule in
 * working order, and under the spec rule three of the nine default rows are in here.
 *
 * A row is only reported when it names an exclusively-derived code. Anything that could
 * plausibly arrive as a tenant finding shortId is left alone — the operator knows their
 * own tenant better than this function does.
 */
export function unreachableGapRules(rule: AarsRule): number[] {
  const dead: number[] = [];
  rule.gapPoints.forEach((row, i) => {
    // A prefix row is unreachable only when the whole family it names is off; a bare
    // prefix like "LLM" always has live members.
    const claimsDerivedFamily =
      row.match === "prefix"
        ? row.code.startsWith("5R") && rule.gapSources.fiveRs !== true
        : DERIVABLE_EXACT.includes(cleanGapCode(row.code)) && !isDerivable(row.code, rule);
    if (claimsDerivedFamily) dead.push(i);
  });
  return dead;
}

/**
 * How well a rule separates the estate it is applied to.
 *
 * This exists because the model can stop discriminating without anything looking wrong:
 * a pillar pinned at its cap for every asset still renders a confident number, and the
 * band counts still add up. The failure only shows as an absence — few distinct scores,
 * empty bands, a large tie group at the top.
 *
 * Cap saturation is the specific thing to watch. Above a cap the score's discriminative
 * power is exactly zero: two assets with very different inputs receive the same number,
 * so any ranking within that block is arbitrary. `atPillarBCap` at 100% means the whole
 * cascade — every row, every price, the entire editable surface — is contributing
 * nothing, which is the state the spec rule reaches on live data.
 */
export interface RuleDiscrimination {
  /** Assets carrying a score. Unscored nodes are not part of any of these counts. */
  scored: number;
  /** How many different scores those assets take. `scored` here means perfect separation. */
  distinctScores: number;
  /** The largest set of assets sharing one score — the tie block a "top N" would cut into. */
  largestTieGroup: number;
  /** Occupancy per level, INFO included, zeroes kept: an empty band is the finding. */
  bandOccupancy: Record<string, number>;
  /** Lowest and highest score actually reached, so an unused range is visible. */
  range: { min: number; max: number };
  /** Assets pinned at each pillar's cap, and at the 0–100 ceiling. */
  saturated: { toxic: number; compliance: number; data: number; exposure: number; score: number };
}

const EMPTY_DISCRIMINATION: RuleDiscrimination = {
  scored: 0,
  distinctScores: 0,
  largestTieGroup: 0,
  bandOccupancy: {},
  range: { min: 0, max: 0 },
  saturated: { toxic: 0, compliance: 0, data: 0, exposure: 0, score: 0 },
};

/**
 * Measure a scored estate against the rule that scored it. Pure, and reads only what
 * `scoreAssetsWith` already returns, so the preview pays no extra Sheets read for it.
 */
export function ruleDiscrimination(
  nodes: ReadonlyArray<{
    aars?: number;
    aarsSeverity?: string;
    aarsPillars?: { toxic: number; compliance: number; data: number; exposure?: number };
  }>,
  rule: AarsRule,
): RuleDiscrimination {
  const scores: number[] = [];
  const counts: Record<string, number> = {};
  for (const b of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]) counts[b] = 0;
  const saturated = { toxic: 0, compliance: 0, data: 0, exposure: 0, score: 0 };
  const maxData = Math.round(
    Math.max(...EXPOSURE_KEYS.map((k) => rule.dataExposurePoints[k])) * rule.dataAmplifier,
  );
  const maxExposure = Math.max(...INTERNET_EXPOSURE_KEYS.map((k) => rule.exposurePoints[k]));

  for (const n of nodes) {
    if (typeof n.aars !== "number") continue;
    scores.push(n.aars);
    const band = String(n.aarsSeverity ?? "");
    if (band in counts) counts[band] = counts[band]! + 1;
    const p = n.aarsPillars;
    if (p) {
      if (p.toxic >= rule.pillarACap) saturated.toxic++;
      if (p.compliance >= rule.pillarBCap) saturated.compliance++;
      // A pillar whose ceiling is zero is switched off, not saturated — counting every
      // asset as "at the cap" there would report pillar D as the problem in every tenant.
      if (maxData > 0 && p.data >= maxData) saturated.data++;
      if (maxExposure > 0 && (p.exposure ?? 0) >= maxExposure) saturated.exposure++;
    }
    if (n.aars >= 100) saturated.score++;
  }

  if (!scores.length) return { ...EMPTY_DISCRIMINATION, bandOccupancy: counts };

  const byScore = new Map<number, number>();
  for (const s of scores) byScore.set(s, (byScore.get(s) ?? 0) + 1);

  return {
    scored: scores.length,
    distinctScores: byScore.size,
    largestTieGroup: Math.max(...byScore.values()),
    bandOccupancy: counts,
    range: { min: Math.min(...scores), max: Math.max(...scores) },
    saturated,
  };
}

/** What the cascade actually priced, per row — the evidence behind "order is meaning". */
export interface GapTally {
  /** Instances each row priced, index-aligned with `rule.gapPoints`. */
  perRule: number[];
  /** Instances no row matched, priced at `gapFallbackPoints`. */
  fallback: number;
  /** Every instance counted, so a row's share is readable without re-summing. */
  total: number;
  /** Distinct assets carrying each code — the picker's prevalence, and the census. */
  byCode: Record<string, number>;
}

/**
 * Walk the cascade over the gaps the inventory actually carries and count what each row
 * priced. Same first-match walk `gapPointsFor` performs, so a row's count and a gap's price
 * can never disagree about which rule won.
 *
 * `codeLists` is one entry per asset. Codes are de-duplicated within an asset before
 * counting, because an asset carrying a code twice is one gap as far as pillar B is
 * concerned — so an "instance" here is exactly one asset-and-code pair, and `byCode` and
 * `perRule` are counting the same population rather than two similar ones.
 *
 * A row at zero means one of two very different things, and the page must not conflate
 * them: `shadowedGapRules` says it can never fire, and anything else at zero is simply a
 * rule in force that this tenant does not exercise.
 */
export function gapMatchTally(rule: AarsRule, codeLists: string[][]): GapTally {
  const perRule = rule.gapPoints.map(() => 0);
  const byCode: Record<string, number> = {};
  let fallback = 0;
  let total = 0;

  for (const list of codeLists ?? []) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    for (const raw of list) {
      const code = cleanGapCode(raw);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      byCode[code] = (byCode[code] ?? 0) + 1;
      total++;
      let matched = false;
      for (let i = 0; i < rule.gapPoints.length; i++) {
        const row = rule.gapPoints[i]!;
        const hit = row.match === "exact" ? code === row.code : code.startsWith(row.code);
        if (hit) {
          perRule[i] = perRule[i]! + 1;
          matched = true;
          break;
        }
      }
      if (!matched) fallback++;
    }
  }

  return { perRule, fallback, total, byCode };
}

function pointsPhrase(n: number): string {
  return n === 1 ? "1 point" : `${n} points`;
}

/**
 * The rule as prose, for the page's summary card and the JSON export. A rule you cannot
 * read back in plain language is a rule you cannot audit.
 */
export function ruleSummary(rule: AarsRule): string[] {
  const sev = SEVERITY_KEYS.map((k) => `${k} ${rule.severityPoints[k]}`).join(", ");
  const exposure =
    `sensitive data ${rule.dataExposurePoints.SENSITIVE}, ` +
    `unconfirmed data access ${rule.dataExposurePoints.DATA_ACCESS}, ` +
    `none ${rule.dataExposurePoints.NONE}`;
  const amplified = EXPOSURE_KEYS.map((k) =>
    String(Math.round(rule.dataExposurePoints[k] * rule.dataAmplifier)),
  ).join(" / ");

  const countClause =
    rule.multiIssueScaling === "log2"
      ? `each doubling of the open-issue count multiplies that by a further ` +
        `×${rule.multiIssueMultiplier} step (two issues ×${rule.multiIssueMultiplier}, ` +
        `four ×${(1 + (rule.multiIssueMultiplier - 1) * 2).toFixed(2)}, ` +
        `eight ×${(1 + (rule.multiIssueMultiplier - 1) * 3).toFixed(2)})`
      : `more than one open issue multiplies that by ×${rule.multiIssueMultiplier}, ` +
        `however many there are`;
  const gapClause =
    rule.gapAggregation === "rss"
      ? `matched prices combine as a root-sum-square, so each further gap adds less than the last`
      : `matched prices are added up`;

  return [
    `Pillar A — toxic combinations, capped at ${rule.pillarACap}. The asset's worst open ` +
      `issue scores ${sev}; ${countClause}.`,
    `Pillar B — compliance gaps, capped at ${rule.pillarBCap}. ${rule.gapPoints.length} ` +
      `pricing rules are tried in order, first match wins; an unmatched code scores ` +
      `${pointsPhrase(rule.gapFallbackPoints)}. ${gapClause[0]!.toUpperCase()}${gapClause.slice(1)}.`,
    `Pillar C — data exposure: ${exposure}, all amplified by ×${rule.dataAmplifier} ` +
      `(→ ${amplified}).`,
    rule.exposurePoints.CONFIRMED === 0 &&
    rule.exposurePoints.UNDETERMINED === 0 &&
    rule.exposurePoints.NONE === 0
      ? `Pillar D — internet exposure scores nothing; reachability is reported beside the ` +
        `score but never added to it.`
      : `Pillar D — internet exposure: confirmed ${rule.exposurePoints.CONFIRMED}, ` +
        `undetermined ${rule.exposurePoints.UNDETERMINED}, none ${rule.exposurePoints.NONE}. ` +
        `Not amplified — the 5Rs signal says nothing about reachability.`,
    `Levels — CRITICAL at ${rule.bands.critical} and above, HIGH from ${rule.bands.high}, ` +
      `MEDIUM from ${rule.bands.medium}, LOW from ${rule.bands.low}, INFO below that. ` +
      `Scores are clamped to 100.`,
  ];
}

/** Ranges per level, worst first — the band table the page and the KPI captions render. */
export function bandRanges(
  bands: AarsBands,
): Array<{ severity: string; min: number; max: number; label: string }> {
  return [
    { severity: "CRITICAL", min: bands.critical, max: 100 },
    { severity: "HIGH", min: bands.high, max: bands.critical - 1 },
    { severity: "MEDIUM", min: bands.medium, max: bands.high - 1 },
    { severity: "LOW", min: bands.low, max: bands.medium - 1 },
    { severity: "INFO", min: 0, max: bands.low - 1 },
  ].map((b) => ({ ...b, label: `score ${b.min}–${b.max}` }));
}

/** Structural equality, for the page's dirty check and the store's no-op guard. */
export function rulesEqual(a: AarsRule, b: AarsRule): boolean {
  return JSON.stringify(cleanAarsRule(a)) === JSON.stringify(cleanAarsRule(b));
}

/**
 * Equal in everything that produces a SCORE, ignoring the bands that only name it.
 * Moving a threshold cannot invalidate a persisted score — the level is re-derived from
 * it on read — so a band-only edit must not mark the whole inventory as needing a
 * recompute the operator would have no reason to run.
 */
export function scoringEqual(a: AarsRule, b: AarsRule): boolean {
  const withoutBands = (r: AarsRule): string => {
    const c = cleanAarsRule(r) as Partial<AarsRule>;
    delete c.bands;
    return JSON.stringify(c);
  };
  return withoutBands(a) === withoutBands(b);
}
