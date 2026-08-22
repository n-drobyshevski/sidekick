// Pure semantics for the Problem/Decision-Vector rule: coercion, validation, and prose —
// the STRUCTURAL PORT of aarsRule.ts onto problem.ts's tree instead of AARS's score.
// Same two-stage split for the same reason: clean* coerces junk into the right shape and
// range and never throws, validate* reports what a human got wrong and never silently
// repairs it. A rule an operator cannot trust to mean what it says is worse than one that
// refuses to save.
//
// Where this deliberately does NOT mirror aarsRule.ts: `ruleDiscrimination` there exists
// to catch a CONTINUOUS score collapsing onto too few values — cap saturation, tie rate,
// effective cardinality all measure "did the scale stop discriminating". A 4-outcome tree
// is not failing when most of a landscape ties at TRACK; that is the tree WORKING. This
// file's `treeDiscrimination` measures a different failure: leaves the tree never reaches
// at all, and axes whose reading was UNKNOWN too often to trust. See that function's own
// comment for why `tieRate` / `effectiveCardinality` are deliberately not ported here.

import {
  decideProblem,
  enumerateDecisionVectors,
  EXPLOITATION_VALUES,
  EXPOSURE_VALUES,
  IMPACT_VALUES,
  leafKey,
  MISSION_VALUES,
  OUTCOME_VALUES,
  vectorMatches,
  type DecisionVector,
  type Exploitation,
  type Mission,
  type Outcome,
  type SystemExposure,
  type TechnicalImpact,
} from "./problem";

/** One row of the exploitation lookup: a Wiz combo-rule id and how mature its exploit path is. */
export interface ExploitationRuleRow {
  ruleId: string;
  maturity: "REALIZED" | "DEMONSTRATED" | "FEASIBLE";
}

/** One row of the outcome cascade. `when` is a `Partial<DecisionVector>` — an omitted axis is a wildcard. */
export interface OutcomeRule {
  when: Partial<DecisionVector>;
  outcome: Outcome;
}

/**
 * Which asset a problem is judged against — see ProblemRule.attributionJoin.
 */
export type AttributionJoin = "direct" | "runsAs";

export interface ProblemRule {
  /** Ordered; first match wins — see `problem.decideProblem`. */
  outcomeRules: OutcomeRule[];
  /** What a vector gets when no row matches. */
  fallbackOutcome: Outcome;
  /** Operator-maintained: which Wiz combo rules have a REALIZED/DEMONSTRATED exploit path. */
  exploitationByRuleId: ExploitationRuleRow[];
  /** `aiRemediationAnalysis.verdict` values that reach SUSPECTED. Default `["REMEDIATE"]`. */
  remediateVerdicts: string[];
  /** Combo-group ids whose pattern grants code execution — the third TOTAL-impact source. */
  totalImpactGroups: string[];
  /** What a missing business-impact tier reads as. Default `"MEDIUM"`, never `"LOW"`. */
  missingMission: Mission;
  /**
   * WHICH ASSET a problem is judged against — not how the judgement is made.
   *
   * `direct` looks up the entity Wiz raised the issue on. `runsAs` also accepts the AI asset
   * that runs as it, one hop (IssueRow.attributedAssetIds). Deliberately SEPARATE from
   * AarsRule.issueAttribution rather than one shared switch: an AARS-side decision must not be
   * able to silently re-decide every problem verdict, which is the exact coupling
   * withProblemVerdicts exists as its own fold to avoid.
   *
   * A DERIVATION knob, so it joins vectorSignature: it changes which node impactOf and
   * exposureOf read, so a persisted problemInput from the other setting must be re-derived
   * rather than re-decided. Default `direct`.
   */
  attributionJoin: AttributionJoin;
  /**
   * The max share of the 54 leaves allowed to reach ACT, checked by `validateProblemRule`.
   * Default `0.15`. This is a VALIDATION-only knob: it never appears in `decideProblem` or
   * either `derive*ProblemInput` function, so moving it cannot change which outcome any
   * vector receives — only whether the rule as a whole still validates. See
   * `decisionEqual`'s comment for why that makes it the one field excluded there.
   */
  actLeafCeiling: number;
}

const AXIS_KEYS = ["exploitation", "impact", "exposure", "mission"] as const;

/** Cap on cascade rows, mirroring `aarsRule.MAX_GAP_RULES`: the rule lives in one settings cell. */
export const MAX_OUTCOME_RULES = 40;
/** Generous cap — one row per Wiz combo-rule id, and a tenant's rule catalogue is small. */
const MAX_EXPLOITATION_RULES = 200;
const MAX_VERDICTS = 20;
const MAX_TOTAL_IMPACT_GROUPS = 40;
const CODE_MAX_LEN = 128;
/**
 * The practical floor for `actLeafCeiling`'s open lower bound `(0, 1]`. A literal 0 is
 * excluded by the model (see the field's own comment) but a clamp needs a real number to
 * land on, and 0.1% is small enough that no real cascade would ever brush against it —
 * it exists only so a hand-edited settings cell of `0` degrades to "ACT must stay
 * vanishingly scarce" rather than to a value the clamp cannot represent.
 */
const ACT_CEILING_FLOOR = 0.001;

type Loose = Record<string, unknown>;

function rec(v: unknown): Loose {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {};
}

function cleanCode(v: unknown): string {
  return String(v ?? "").trim().slice(0, CODE_MAX_LEN);
}

/**
 * The problem rule exactly as this phase's spec lays it out. Every ACT row requires
 * ACTIVE exploitation — the tree's whole discipline is that nothing short of a confirmed
 * exploit path reaches the top band. `shadowedOutcomeRules(DEFAULT_PROBLEM_RULE)` is
 * `[]` and `validateProblemRule(DEFAULT_PROBLEM_RULE)` is `[]`; both are pinned by
 * problemRule.test.ts so a reordering here fails loudly instead of silently.
 *
 * Row 7 (`{ exposure: UNVERIFIED } → TRACK_STAR`) deserves its own note, because it is
 * the row most likely to look like a mistake on first read: an UNVERIFIED exposure is
 * NOT a discount (it does not fall through to plain TRACK) and NOT a promotion (it does
 * not claim OPEN exposure it cannot back up) — it lands on TRACK_STAR, which means
 * "track closely, re-evaluate on new information". That is precisely the right response
 * to "nobody has checked whether this hosted agent is reachable": it turns a coverage
 * gap into a work item — go find out — rather than either hiding it in the TRACK pile or
 * inflating it into an ATTEND it has not earned. It sits ABOVE the mission-only row for
 * the same reason: a confirmed-important asset the tree cannot even confirm is reachable
 * is a worse gap than one whose reachability is simply CONTROLLED.
 */
export const DEFAULT_PROBLEM_RULE: ProblemRule = {
  outcomeRules: [
    { when: { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN" }, outcome: "ACT" },
    { when: { exploitation: "ACTIVE", impact: "TOTAL", mission: "HIGH" }, outcome: "ACT" },
    { when: { exploitation: "ACTIVE", exposure: "OPEN", mission: "HIGH" }, outcome: "ACT" },
    { when: { exploitation: "ACTIVE" }, outcome: "ATTEND" },
    { when: { impact: "TOTAL", exposure: "OPEN", mission: "HIGH" }, outcome: "ATTEND" },
    { when: { exploitation: "SUSPECTED", exposure: "OPEN" }, outcome: "ATTEND" },
    { when: { exposure: "UNVERIFIED" }, outcome: "TRACK_STAR" },
    { when: { mission: "HIGH" }, outcome: "TRACK_STAR" },
  ],
  fallbackOutcome: "TRACK",
  exploitationByRuleId: [],
  remediateVerdicts: ["REMEDIATE"],
  // wc-id-3230 (gcp-hosted-privileged) is the one combo pattern whose OWASP Agentic
  // mapping names ASI05 (toxicCombos.ts) — Excessive Agency / remote-code-execution shape
  // — alongside its excessive-privilege and sensitive-data conditions. That is what
  // "grants code execution" means operationally for this axis: not merely elevated IAM,
  // but the specific pattern whose own framework tags say RCE.
  totalImpactGroups: ["gcp-hosted-privileged"],
  missingMission: "MEDIUM",
  attributionJoin: "direct",
  actLeafCeiling: 0.15,
};

function cleanWhen(v: unknown): Partial<DecisionVector> {
  const raw = rec(v);
  const when: Partial<DecisionVector> = {};
  if ((EXPLOITATION_VALUES as readonly string[]).includes(raw["exploitation"] as string)) {
    when.exploitation = raw["exploitation"] as Exploitation;
  }
  if ((IMPACT_VALUES as readonly string[]).includes(raw["impact"] as string)) {
    when.impact = raw["impact"] as TechnicalImpact;
  }
  if ((EXPOSURE_VALUES as readonly string[]).includes(raw["exposure"] as string)) {
    when.exposure = raw["exposure"] as SystemExposure;
  }
  if ((MISSION_VALUES as readonly string[]).includes(raw["mission"] as string)) {
    when.mission = raw["mission"] as Mission;
  }
  return when;
}

function cleanOutcome(v: unknown, fallback: Outcome): Outcome {
  return (OUTCOME_VALUES as readonly string[]).includes(v as string) ? (v as Outcome) : fallback;
}

function cleanOutcomeRule(v: unknown, fallback: Outcome): OutcomeRule {
  const raw = rec(v);
  return { when: cleanWhen(raw["when"]), outcome: cleanOutcome(raw["outcome"], fallback) };
}

function cleanExploitationRuleRow(v: unknown): ExploitationRuleRow | null {
  const raw = rec(v);
  const ruleId = cleanCode(raw["ruleId"]);
  if (!ruleId) return null;
  const maturityRaw = raw["maturity"];
  // An unreadable maturity falls to FEASIBLE — the one value that does NOT reach
  // SUSPECTED (see REALIZED_OR_DEMONSTRATED in problem.ts) — never to REALIZED. A junk
  // cell must never silently grant an exploit maturity nobody asserted.
  const maturity: ExploitationRuleRow["maturity"] =
    maturityRaw === "REALIZED" || maturityRaw === "DEMONSTRATED" || maturityRaw === "FEASIBLE"
      ? maturityRaw
      : "FEASIBLE";
  return { ruleId, maturity };
}

function cleanCodeList(v: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const out: string[] = [];
  for (const item of v) {
    const c = cleanCode(item);
    if (c) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Coerce any stored or posted blob into a well-formed rule. Never throws and never
 * leaves a field undefined — the same contract `cleanAarsRule` keeps, for the same
 * reason: a hand-edited settings cell degrades to "the documented model", not to a
 * broken decision.
 */
export function cleanProblemRule(raw: unknown): ProblemRule {
  const r = rec(raw);

  const fallbackOutcome = cleanOutcome(r["fallbackOutcome"], DEFAULT_PROBLEM_RULE.fallbackOutcome);

  const rowsRaw = Array.isArray(r["outcomeRules"]) ? (r["outcomeRules"] as unknown[]) : null;
  const outcomeRules = rowsRaw
    ? rowsRaw.slice(0, MAX_OUTCOME_RULES).map((row) => cleanOutcomeRule(row, fallbackOutcome))
    : DEFAULT_PROBLEM_RULE.outcomeRules.map((row) => ({ when: { ...row.when }, outcome: row.outcome }));

  const exploitationRaw = Array.isArray(r["exploitationByRuleId"])
    ? (r["exploitationByRuleId"] as unknown[])
    : null;
  const exploitationByRuleId = exploitationRaw
    ? exploitationRaw
        .slice(0, MAX_EXPLOITATION_RULES)
        .map(cleanExploitationRuleRow)
        .filter((row): row is ExploitationRuleRow => row !== null)
    : DEFAULT_PROBLEM_RULE.exploitationByRuleId.map((row) => ({ ...row }));

  const remediateVerdicts = cleanCodeList(
    r["remediateVerdicts"],
    DEFAULT_PROBLEM_RULE.remediateVerdicts,
    MAX_VERDICTS,
  );
  const totalImpactGroups = cleanCodeList(
    r["totalImpactGroups"],
    DEFAULT_PROBLEM_RULE.totalImpactGroups,
    MAX_TOTAL_IMPACT_GROUPS,
  );

  const missingMission: Mission = (MISSION_VALUES as readonly string[]).includes(r["missingMission"] as string)
    ? (r["missingMission"] as Mission)
    : DEFAULT_PROBLEM_RULE.missingMission;

  // Unreadable reads as "direct", never "runsAs" — same convention as every other derivation
  // field: a rule blob written before this existed must keep deciding exactly as it did.
  const attributionJoin: AttributionJoin = r["attributionJoin"] === "runsAs" ? "runsAs" : "direct";

  const ceilingRaw = Number(r["actLeafCeiling"]);
  const actLeafCeiling = Number.isFinite(ceilingRaw)
    ? Math.min(1, Math.max(ACT_CEILING_FLOOR, ceilingRaw))
    : DEFAULT_PROBLEM_RULE.actLeafCeiling;

  return {
    outcomeRules,
    fallbackOutcome,
    exploitationByRuleId,
    remediateVerdicts,
    attributionJoin,
    totalImpactGroups,
    missingMission,
    actLeafCeiling,
  };
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * What a human got wrong, in their words. Empty = saveable.
 *
 * The outcome-mass check is where "the top band must stay scarce" stops being a comment
 * and becomes a checked property: `leafCoverage` enumerates all 54 leaves under the rule
 * AS WRITTEN, and if ACT's share exceeds `actLeafCeiling`, that is reported the same way
 * an inverted band threshold is in `validateAarsRule` — a concrete number, not a vibe.
 * Nothing else in this module (or in `decideProblem`) enforces the ceiling; a rule that
 * fails this check still SCORES, it simply should not be saved.
 */
export function validateProblemRule(rule: ProblemRule): string[] {
  const errors: string[] = [];

  if (!rule.outcomeRules.length) {
    errors.push(
      "The outcome cascade has no rules; every vector would route to the fallback outcome. " +
        "Add a rule or accept the fallback deliberately.",
    );
  }
  if (rule.outcomeRules.length > MAX_OUTCOME_RULES) {
    errors.push(`The outcome cascade is limited to ${MAX_OUTCOME_RULES} rules.`);
  }

  rule.outcomeRules.forEach((row, i) => {
    const isEmpty = AXIS_KEYS.every((k) => row.when[k] === undefined);
    if (isEmpty && i !== rule.outcomeRules.length - 1) {
      errors.push(
        `Outcome rule ${i + 1} has no conditions, so it matches every remaining vector and ` +
          `swallows every rule after it. Move it last or give it a condition.`,
      );
    }
  });

  const seen = new Map<string, number>();
  rule.outcomeRules.forEach((row, i) => {
    const isEmpty = AXIS_KEYS.every((k) => row.when[k] === undefined);
    if (isEmpty) return; // reported above, and every empty `when` is trivially "the same"
    const key = AXIS_KEYS.filter((k) => row.when[k] !== undefined)
      .map((k) => `${k}:${row.when[k]}`)
      .join("|");
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      errors.push(`Outcome rule ${i + 1} repeats the same condition as rule ${earlier + 1}.`);
    } else {
      seen.set(key, i);
    }
  });

  const coverage = leafCoverage(rule);
  const actShare = coverage.total ? coverage.byOutcome.ACT / coverage.total : 0;
  if (actShare > rule.actLeafCeiling) {
    errors.push(
      `This rule sends ${coverage.byOutcome.ACT} of ${coverage.total} leaves to ACT ` +
        `(${pct(actShare)}) — above the ${pct(rule.actLeafCeiling)} ceiling.`,
    );
  }

  return errors;
}

/**
 * Rows every one of whose leaves an EARLIER row already claims — the tree analogue of
 * `shadowedGapRules`, ported claim and all: a first-match cascade is allowed to have dead
 * rows (that is not an error, `validateProblemRule` does not report it), but a row that
 * can never be the FIRST match for any leaf is not a rule in force, and the page must say
 * so rather than let it read as one.
 *
 * Where `shadowedGapRules` can lean on the prefix/exact STRUCTURE of a gap code to decide
 * shadowing without enumerating anything, a `when` has no such structure to exploit — two
 * conditions either pick out overlapping leaf sets or they do not, and the only honest way
 * to know is to enumerate. 54 leaves is cheap enough that this is not a performance
 * concession, it is simply the correct algorithm for this shape of rule.
 */
export function shadowedOutcomeRules(rule: ProblemRule): number[] {
  const leaves = enumerateDecisionVectors();
  const dead: number[] = [];
  rule.outcomeRules.forEach((row, i) => {
    const rowLeaves = leaves.filter((v) => vectorMatches(v, row.when));
    if (!rowLeaves.length) return;
    const allClaimedEarlier = rowLeaves.every((v) =>
      rule.outcomeRules.slice(0, i).some((earlier) => vectorMatches(v, earlier.when)),
    );
    if (allClaimedEarlier) dead.push(i);
  });
  return dead;
}

/** Every leaf's outcome, tallied against the rule that claimed it — the evidence behind "order is meaning". */
export interface LeafCoverage {
  /** Always 54 — `enumerateDecisionVectors().length`, never hardcoded here. */
  total: number;
  /** Leaves each outcome-rule row claimed as its FIRST match, index-aligned with `rule.outcomeRules`. */
  byRow: number[];
  /** Leaves no row matched, decided by `rule.fallbackOutcome`. */
  byFallback: number;
  byOutcome: Record<Outcome, number>;
}

/**
 * Walk every one of the 54 leaves through `decideProblem` and tally what claimed it. Same
 * function `decideProblem` itself uses, so a row's leaf count and an issue's actual
 * outcome can never disagree about which rule won — the same non-negotiable
 * `gapMatchTally` keeps against `gapPointsFor`.
 *
 * A row at zero in `byRow` means one of two very different things, exactly as a zero in
 * `gapMatchTally.perRule` does: `shadowedOutcomeRules` says it can never fire, or it is a
 * live rule this particular RUN of the tree simply did not reach. The two are not the same
 * claim and a caller must be able to tell them apart, which is why they stay separate
 * functions rather than one combined "is this row dead" flag.
 */
export function leafCoverage(rule: ProblemRule): LeafCoverage {
  const leaves = enumerateDecisionVectors();
  const byRow = rule.outcomeRules.map(() => 0);
  const byOutcome: Record<Outcome, number> = { ACT: 0, ATTEND: 0, TRACK_STAR: 0, TRACK: 0 };
  let byFallback = 0;
  for (const v of leaves) {
    const { outcome, matchedRuleIndex } = decideProblem(v, rule);
    if (matchedRuleIndex === -1) byFallback++;
    else byRow[matchedRuleIndex]! += 1;
    byOutcome[outcome]++;
  }
  return { total: leaves.length, byRow, byFallback, byOutcome };
}

/**
 * How much of the tree a decided LANDSCAPE actually exercises — as opposed to `leafCoverage`,
 * which measures the RULE alone against all 54 leaves regardless of any real data. This is
 * the rule run against a population: how the four outcomes actually landed, how many of
 * the 54 possible leaves any issue actually reached, and how often each axis could not be
 * established.
 *
 * Deliberately does NOT port `tieRate` / `effectiveCardinality` from `rankStats.ts` the way
 * `ruleDiscrimination` does. Those measure whether a CONTINUOUS score has collapsed onto
 * too few values — for AARS, a large tie group is the failure. Here it is the design: a
 * four-outcome tree EXISTS to put most issues in a small number of shared leaves, and a
 * high "tie rate" over `leafOccupancy` would just be restating that the tree has four
 * outcomes. The numbers worth watching for THIS tree are different — `leavesReached` (is
 * the tree actually being exercised, or is real data landing in a handful of leaves for a
 * reason worth knowing) and `unknownRate` (is an axis unreadable often enough that its
 * readings cannot be trusted) — which is why those are what this function reports instead.
 */
export interface TreeDiscrimination {
  decided: Array<{ outcome: Outcome; vector: DecisionVector; unknowns: string[] }>;
  /** All four outcomes, zeros kept — an outcome nothing reached is the finding, not an absence. */
  outcomeOccupancy: Record<Outcome, number>;
  /** Distinct leaves any decided item actually landed on, out of the 54 possible. */
  leavesReached: number;
  /** Sparse — only leaves at least one item reached; size equals `leavesReached`. */
  leafOccupancy: Record<string, number>;
  /** Share of decided items whose reading on that axis was unknown, one entry per axis. */
  unknownRate: Record<"exploitation" | "impact" | "exposure" | "mission", number>;
  /**
   * What each axis ACTUALLY read across the decided population — the distribution the
   * per-axis bars draw, counted here rather than in the browser.
   *
   * This used to be `axisTally` in ui/axisBar.js, walking `decided` client-side. That was
   * defensible while `decided` was already on the wire; it is not the reason `decided` is on
   * the wire any more, because it no longer is. Shipping one object per decided issue and
   * finding so the page could derive four small histograms from it put a per-row array
   * between a real tenant and its own picture — the same transport ceiling `readGrid` had
   * to start blocking around, arriving the same way: swallowed by `run()` into a response
   * that looks normal. The counting belongs where the population already is.
   *
   * `unknown` is counted PER VALUE rather than as a value of its own, because for three of
   * the four axes it is not one: an impact reading is TOTAL or PARTIAL whether or not
   * anything established it, and a MEDIUM mission may be Wiz's answer or the operator's
   * fallback. A fifth "unknown" segment would claim those rows had no value, which is false.
   */
  axisReadings: Record<AxisKey, AxisReading>;
}

export type AxisKey = "exploitation" | "impact" | "exposure" | "mission";

/** One axis's distribution over the decided population. `counts`/`unknowns` are zero-filled. */
export interface AxisReading {
  total: number;
  counts: Record<string, number>;
  unknowns: Record<string, number>;
}

/** The declared value order of each axis, so a reading is always zero-filled in that order. */
export const AXIS_VALUES: Record<AxisKey, readonly string[]> = {
  exploitation: EXPLOITATION_VALUES,
  impact: IMPACT_VALUES,
  exposure: EXPOSURE_VALUES,
  mission: MISSION_VALUES,
};

export function treeDiscrimination(
  decided: Array<{ outcome: Outcome; vector: DecisionVector; unknowns: string[] }>,
): TreeDiscrimination {
  const outcomeOccupancy: Record<Outcome, number> = { ACT: 0, ATTEND: 0, TRACK_STAR: 0, TRACK: 0 };
  const leafOccupancy: Record<string, number> = {};
  const unknownCounts: Record<AxisKey, number> = {
    exploitation: 0, impact: 0, exposure: 0, mission: 0,
  };
  // Zero-filled up front, in each axis's own declared order: a value nothing reached is a
  // finding about the tenant, not an absence, and it has to survive into the bar to be one.
  const axisReadings = {} as Record<AxisKey, AxisReading>;
  for (const axis of AXIS_KEYS) {
    const counts: Record<string, number> = {};
    const unknowns: Record<string, number> = {};
    for (const value of AXIS_VALUES[axis]) {
      counts[value] = 0;
      unknowns[value] = 0;
    }
    axisReadings[axis] = { total: 0, counts, unknowns };
  }

  for (const d of decided) {
    outcomeOccupancy[d.outcome]++;
    const key = leafKey(d.vector);
    leafOccupancy[key] = (leafOccupancy[key] ?? 0) + 1;
    for (const axis of AXIS_KEYS) {
      const reading = axisReadings[axis];
      const value = d.vector[axis] as string | undefined;
      // A value off the declared list is skipped rather than invented as a new bucket —
      // the same "never widen a vocabulary from data" rule clean* keeps on the way in.
      if (value === undefined || !(value in reading.counts)) continue;
      reading.counts[value]! += 1;
      reading.total += 1;
      if (d.unknowns.indexOf(axis) >= 0) reading.unknowns[value]! += 1;
    }
    for (const u of d.unknowns) {
      if (u === "exploitation" || u === "impact" || u === "exposure" || u === "mission") {
        unknownCounts[u]++;
      }
    }
  }

  const n = decided.length;
  const rate = (count: number) => (n ? count / n : 0);

  return {
    decided,
    outcomeOccupancy,
    leavesReached: Object.keys(leafOccupancy).length,
    leafOccupancy,
    unknownRate: {
      exploitation: rate(unknownCounts.exploitation),
      impact: rate(unknownCounts.impact),
      exposure: rate(unknownCounts.exposure),
      mission: rate(unknownCounts.mission),
    },
    axisReadings,
  };
}

/** The rule as prose — `ruleSummary`'s voice, aimed at the tree instead of the score. */
export function problemRuleSummary(rule: ProblemRule): string[] {
  const coverage = leafCoverage(rule);
  const actShare = coverage.total ? coverage.byOutcome.ACT / coverage.total : 0;

  return [
    `${rule.outcomeRules.length} outcome rules are tried in order, first match wins; a ` +
      `vector matching none of them falls back to ${rule.fallbackOutcome}.`,
    `ACT claims ${coverage.byOutcome.ACT} of ${coverage.total} leaves (${pct(actShare)}), ` +
      `against a ceiling of ${pct(rule.actLeafCeiling)}.`,
    `Exploitation reaches ACTIVE only from Wiz's own validated-exploitable flag. It reaches ` +
      `SUSPECTED from ${rule.exploitationByRuleId.length} rule-table row(s) at REALIZED or ` +
      `DEMONSTRATED maturity, or from an AI verdict of ` +
      `${rule.remediateVerdicts.length ? rule.remediateVerdicts.join("/") : "(none configured)"} — ` +
      `never both the way to ACTIVE.`,
    `Technical impact reads TOTAL from admin privileges, admin-level human access, or ` +
      `membership in ${
        rule.totalImpactGroups.length ? rule.totalImpactGroups.join(", ") : "(no configured groups)"
      }; otherwise PARTIAL.`,
    `A missing business-impact tier reads as ${rule.missingMission}, never LOW.`,
  ];
}

/**
 * A short, human-readable fingerprint of the four DERIVATION knobs —
 * `exploitationByRuleId`, `remediateVerdicts`, `totalImpactGroups`, `missingMission` — the
 * ones that decide WHICH VECTOR a row gets (`problem.deriveProblemInput` /
 * `deriveFindingProblemInput`), as opposed to `outcomeRules` / `fallbackOutcome`, which
 * decide what a vector ROUTES TO once it exists. Persisted on `IssueRow.problemInput
 * .derivedUnder` / `FindingRow.problemInput.derivedUnder` (graphTypes.ts) — the direct
 * structural port of `aars.derivationSignature` onto this rule's shape, for exactly the
 * reason that one exists: `syncStore.redecideProblems` reuses a persisted VECTOR to
 * re-ROUTE it for free on an `outcomeRules` edit, and that is the wrong thing to do the
 * moment a caller instead flips `missingMission` from MEDIUM to LOW — the persisted
 * vector's `mission` axis was derived under the OLD default and was never re-read.
 * Unconditional reuse across a signature mismatch is the exact bug `enrichFromTabs`'s
 * `derivedUnder` check exists to close for AARS; this is the same fix, made once here
 * rather than rediscovered later against this rule's shape.
 *
 * Deliberately NOT a hash, for the same reason `derivationSignature`'s own comment gives:
 * this value lands in a sheet cell and inside `problem_input_json`, read by a human
 * comparing two rows, and a digest would tell them nothing a name doesn't.
 */
export function vectorSignature(rule: ProblemRule): string {
  const exploitation = rule.exploitationByRuleId.map((r) => `${r.ruleId}:${r.maturity}`).join(",");
  return [
    `exploitationByRuleId:${exploitation}`,
    `remediateVerdicts:${rule.remediateVerdicts.join(",")}`,
    `totalImpactGroups:${rule.totalImpactGroups.join(",")}`,
    `missingMission:${rule.missingMission}`,
    `attributionJoin:${rule.attributionJoin}`,
  ].join("|");
}

/**
 * Structural equality over everything that changes an OUTCOME — the tree analogue of
 * `scoringEqual`. Excludes exactly one field, `actLeafCeiling`: it is checked only by
 * `validateProblemRule` and never read by `decideProblem` or either `derive*ProblemInput`
 * function, so moving it cannot make any persisted verdict stale. This is what a future
 * `setProblemRule` will use to decide whether persisted decisions need re-deriving —
 * exactly the job `scoringEqual` already does for a rescore, ported to this rule's shape.
 */
export function decisionEqual(a: ProblemRule, b: ProblemRule): boolean {
  const withoutCeiling = (r: ProblemRule): string => {
    const c: Partial<ProblemRule> = cleanProblemRule(r);
    delete c.actLeafCeiling;
    return JSON.stringify(c);
  };
  return withoutCeiling(a) === withoutCeiling(b);
}

/**
 * What this tenant actually carries on the two axes an operator can name values for.
 *
 * The two fields at issue — `remediateVerdicts` and `totalImpactGroups` — are free lists of
 * opaque strings matched literally, so a typo does not fail: it silently matches nothing,
 * and the axis quietly reads UNKNOWN for the rest of the landscape. The editor's only
 * defence against that is being able to show what the strings could be, which is exactly
 * what `tenantCodeOptions` does for gap codes on the AARS tab.
 *
 * DELIBERATELY SHAPE-TYPED RATHER THAN TAKING `IssueRow`. This module is pure rule
 * semantics and imports nothing from the graph vocabulary; a structural parameter keeps it
 * that way and makes the function trivially testable.
 *
 * ISSUES ONLY, and the type says so rather than a comment: both fields are issue
 * vocabulary, and a `FindingRow` carries neither. Widening the parameter to accept the
 * union would need a cast — TypeScript's weak-type check rejects a type with no properties
 * in common — and would imply findings contribute to a census they cannot reach.
 *
 * `OTHER_GROUP_ID` is excluded on purpose: it is `syncNormalize`'s "no rule pattern
 * matched" sentinel, so offering it as a group that grants code execution would invite an
 * operator to hand TOTAL impact to every unclassified issue in the tenant.
 */
export const PROBLEM_CENSUS_MAX = 200;
const OTHER_COMBO_GROUP = "other-ai-risk";

export interface CensusEntry {
  value: string;
  /** Issues carrying it — the prevalence the picker prints, and the reason to trust it. */
  issues: number;
}

export interface ProblemCensus {
  verdicts: CensusEntry[];
  comboGroups: CensusEntry[];
}

export function problemCensus(
  rows: ReadonlyArray<{ aiVerdict?: string; comboGroup?: string }>,
): ProblemCensus {
  const verdicts: Record<string, number> = {};
  const groups: Record<string, number> = {};

  for (const row of rows ?? []) {
    if (!row) continue;
    const verdict = String(row.aiVerdict ?? "").trim();
    if (verdict) verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
    const group = String(row.comboGroup ?? "").trim();
    if (group && group !== OTHER_COMBO_GROUP) groups[group] = (groups[group] ?? 0) + 1;
  }

  // Commonest first, then alphabetical — a stable order across two previews of the same
  // landscape, so the list under an open picker does not reshuffle on every keystroke.
  const rank = (counts: Record<string, number>): CensusEntry[] =>
    Object.keys(counts)
      .map((value) => ({ value, issues: counts[value]! }))
      .sort((a, b) => b.issues - a.issues || a.value.localeCompare(b.value))
      .slice(0, PROBLEM_CENSUS_MAX);

  return { verdicts: rank(verdicts), comboGroups: rank(groups) };
}


