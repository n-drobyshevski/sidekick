// Pure semantics for the Posture rule: coercion, validation, and prose — the STRUCTURAL
// PORT of problemRule.ts onto posture.ts's 27-cell lattice instead of the 54-leaf tree.
// Same two-stage split for the same reason: clean* coerces junk into the right shape and
// range and never throws, validate* reports what a human got wrong and never silently
// repairs it.
//
// Where this deliberately does NOT mirror problemRule.ts: that file's `treeDiscrimination`
// declines to port `tieRate` / `effectiveCardinality` from rankStats.ts because a
// four-outcome tree EXISTS to put most issues in a small number of shared leaves. The same
// argument applies here, doubled — a four-TIER lattice is even less interested in "how many
// distinct values does the population take" than a four-outcome tree is, so
// `postureDiscrimination` below reports tier occupancy and per-axis unknown rates, the same
// two questions `treeDiscrimination` asks, and nothing about tie rates.

import {
  CAPABILITY_VALUES,
  CONTAINMENT_VALUES,
  CONSEQUENCE_VALUES,
  decidePosture,
  enumeratePostureVectors,
  postureKey,
  postureVectorMatches,
  tierEstablished,
  type Capability,
  type Consequence,
  type Containment,
  type PostureVector,
  type Tier,
} from "./posture";

/** One row of the tier cascade. `when` is a `Partial<PostureVector>` — an omitted field is a wildcard. */
export interface TierRule {
  when: Partial<PostureVector>;
  tier: Tier;
}

export interface PostureRule {
  /** Ordered; first match wins — see `posture.decidePosture`. */
  tierRules: TierRule[];
  /** What a vector gets when no row matches. */
  fallbackTier: Tier;
  /**
   * The max share of the 27 cells allowed to reach tier 4, checked by `validatePostureRule`
   * — the posture analogue of `problemRule.ProblemRule.actLeafCeiling`. VALIDATION-only:
   * it never appears in `decidePosture` or `derivePostureInput`, so moving it cannot change
   * which tier any vector receives, only whether the rule as a whole still validates.
   */
  topTierCeiling: number;
}

const AXIS_KEYS = ["capability", "containment", "consequence"] as const;
const TRIFECTA_KEYS = ["privateData", "untrustedIngress", "externalEgress"] as const;
const WHEN_KEYS = [...AXIS_KEYS, ...TRIFECTA_KEYS] as const;

/** Cap on cascade rows, mirroring `problemRule.MAX_OUTCOME_RULES`: the rule lives in one settings cell. */
export const MAX_TIER_RULES = 40;
const CODE_MAX_LEN = 128;
/** Practical floor for `topTierCeiling`'s open lower bound `(0, 1]` — mirrors `problemRule.ACT_CEILING_FLOOR`. */
const TIER_CEILING_FLOOR = 0.001;

type Loose = Record<string, unknown>;

function rec(v: unknown): Loose {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {};
}

/**
 * The posture rule exactly as this phase's spec lays it out, with one row PREPENDED to the
 * eight the spec gives verbatim: the "lethal trifecta" row (private data reach ∧
 * untrusted-content ingress ∧ external egress capacity — Willison's framing) at tier 4.
 *
 * THAT ROW IS UNREACHABLE, ON PURPOSE, AND THE PAGE MUST SAY SO. Two of its three legs
 * (untrusted-content ingress, external egress) have no source anywhere in graphTypes.ts
 * today — no Wiz query this app runs produces either signal, the same "declared but never
 * populated" gap `problem.amplificationVector`'s header documents for the `tools` /
 * `persistence` / `multiAgent` AIVSS factors. The THIRD leg, private-data reach, actually
 * DOES have a real source (`hasAccessToSensitiveData` / `businessImpact`, the same signals
 * `consequenceOf` already reads) — but `derivePostureInput` deliberately leaves it
 * undefined too, alongside the other two, rather than half-deriving the row. Two reasons:
 *
 *   1. The row is an AND of all three legs. Deriving `privateData` for real while the
 *      other two stay permanently unknown changes NOTHING about whether the row can ever
 *      fire — it still can't, because `untrustedIngress` and `externalEgress` never match
 *      — so the extra derivation would buy zero additional reachability at the cost of a
 *      more complicated function to audit.
 *   2. A row that is "two-thirds guessed, one-third measured" is a worse failure mode than
 *      one that is honestly all-unmeasured: a reader skimming the derivation code sees ONE
 *      pattern (all three legs: never set) rather than having to notice that one of three
 *      near-identical-looking fields is quietly different from its neighbours.
 *
 * This is the discipline `unreachableGapRules` (aarsRule.ts) already applies to three dead
 * rows in the DEFAULT AARS cascade — a cascade row that names something nothing in the live
 * pipeline can ever produce is not a bug to hide, it is a documented gap to report, and
 * `unreachableTierRules` below is that report for this rule, run once at module load and
 * pinned by postureRule.test.ts so a future signal source silently making the row live (or
 * silently making it MORE dead) fails a test instead of drifting unnoticed. Choosing "an
 * honestly-dead row the page labels dead" over "a live row fed by a guess" is this phase's
 * one non-negotiable design call, named verbatim in the spec that produced this file.
 *
 * The eight rows below the trifecta row are the spec's own order, taken as given rather
 * than re-derived. A NINTH real row and a lowered `fallbackTier` were added after the
 * spec's own rows, below — see that row's own comment for why.
 *
 * THE FALLBACK WAS PRODUCING A FABRICATED MIDDLE. `cellCoverage`'s original shape (tier4
 * 1/27, tier3 6/27, tier2 18/27 — 12 of those 18 by an explicit row, 6 by the bare
 * `fallbackTier: 2`, tier1 2/27) reported the LATTICE as if it were fully explained; it was
 * not. On a real tenant, 97.2% of assets (13,584 of 13,972) reached tier 2 through that
 * bare fallback — the cascade had matched NOTHING about them, and `fallbackTier` told them
 * they were "Tier 2 of 4" anyway. An unknown asset scored 0/INFO by AARS on the same
 * missing evidence at least reads as unscored; the fallback read the identical asset as a
 * real, moderate number. Two fixes, both from this file's own `DEFAULT_POSTURE_RULE`
 * comment before this paragraph existed — "lowering [the fallback], adding cascade rows to
 * cover the MINIMAL/PARTIAL region, or both" — and both are applied:
 *
 *   1. `posture.tierEstablished` (see its own header) now refuses to place ANY vector built
 *      from a defaulted axis — an asset with an unread capability, containment or
 *      consequence never reaches `decidePosture` with real inputs, so it can no longer
 *      land on this fallback (or any row) by accident. That is the change that actually
 *      shrinks the 97.2% figure: most of that population was never observed on some axis
 *      in the first place, which is exactly what defaulted every one of its readings to
 *      the SAFE end (MINIMAL / PARTIAL / LIMITED) and walked it straight into the six
 *      fallback cells below.
 *   2. For the population that IS fully readable and still matches none of the eight rows
 *      above — a real `SCOPED` capability or a real gap between `PARTIAL` containment and
 *      `STRONG`, paired with a non-`SEVERE` consequence — the cascade now says so
 *      EXPLICITLY rather than through a hidden default: the wildcard row below claims
 *      exactly those six cells (verified by `cellCoverage`'s pinned distribution in
 *      postureRule.test.ts) and reads them as tier 1. None of the three axes is at its
 *      worst reading for any of the six — no `BROAD`, no `WEAK`, no `SEVERE` — which is the
 *      same "mildest tier" argument row 9 (`MINIMAL` + `STRONG`) already makes for the two
 *      cells it claims; this row extends that argument to the rest of the "nothing is
 *      actually bad here" region instead of leaving it to an unlabelled fallback. Because
 *      the wildcard row is now the CASCADE's own last word, `fallbackTier` (lowered to 1
 *      to match, from 2) is a defensive floor for a hand-edited rule that removes this row,
 *      never the number a stock sync actually produces — `unreachableTierRules` does not
 *      flag it because `cleanPostureRule`/an operator edit can always delete the wildcard
 *      row and make it live again.
 *
 * `postureRule.test.ts` computes and pins the resulting 27-cell distribution (tier4 1/27,
 * tier3 6/27, tier2 12/27, tier1 8/27) rather than asserting a hand-picked "better" one, per
 * the spec's own instruction to report the shape rather than tune the cascade to make a
 * number look good.
 */
export const DEFAULT_POSTURE_RULE: PostureRule = {
  tierRules: [
    // The lethal-trifecta row — UNREACHABLE by construction. See this const's own comment.
    { when: { privateData: true, untrustedIngress: true, externalEgress: true }, tier: 4 },
    { when: { capability: "BROAD", containment: "WEAK", consequence: "SEVERE" }, tier: 4 },
    { when: { capability: "BROAD", containment: "WEAK" }, tier: 3 },
    { when: { capability: "BROAD", consequence: "SEVERE" }, tier: 3 },
    { when: { containment: "WEAK", consequence: "SEVERE" }, tier: 3 },
    { when: { capability: "BROAD" }, tier: 2 },
    { when: { containment: "WEAK" }, tier: 2 },
    { when: { consequence: "SEVERE" }, tier: 2 },
    { when: { capability: "MINIMAL", containment: "STRONG" }, tier: 1 },
    // The former bare fallback, made an explicit row — see this const's own comment. Only
    // reachable by a vector with none of BROAD capability, WEAK containment or SEVERE
    // consequence (every rule above already claims those), so "nothing here reads at its
    // worst" is exactly what tier 1 already means for row 9 immediately above it.
    { when: {}, tier: 1 },
  ],
  fallbackTier: 1,
  topTierCeiling: 0.15,
};

function cleanTier(v: unknown, fallback: Tier): Tier {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 || n === 4 ? (n as Tier) : fallback;
}

function cleanWhen(v: unknown): Partial<PostureVector> {
  const raw = rec(v);
  const when: Partial<PostureVector> = {};
  if ((CAPABILITY_VALUES as readonly string[]).includes(raw["capability"] as string)) {
    when.capability = raw["capability"] as Capability;
  }
  if ((CONTAINMENT_VALUES as readonly string[]).includes(raw["containment"] as string)) {
    when.containment = raw["containment"] as Containment;
  }
  if ((CONSEQUENCE_VALUES as readonly string[]).includes(raw["consequence"] as string)) {
    when.consequence = raw["consequence"] as Consequence;
  }
  for (const key of TRIFECTA_KEYS) {
    if (typeof raw[key] === "boolean") when[key] = raw[key] as boolean;
  }
  return when;
}

function cleanTierRule(v: unknown, fallback: Tier): TierRule {
  const raw = rec(v);
  return { when: cleanWhen(raw["when"]), tier: cleanTier(raw["tier"], fallback) };
}

/**
 * Coerce any stored or posted blob into a well-formed rule. Never throws and never
 * leaves a field undefined — the same contract `cleanProblemRule` keeps, for the same
 * reason: a hand-edited settings cell degrades to "the documented model", not to a
 * broken decision.
 */
export function cleanPostureRule(raw: unknown): PostureRule {
  const r = rec(raw);

  const fallbackTier = cleanTier(r["fallbackTier"], DEFAULT_POSTURE_RULE.fallbackTier);

  const rowsRaw = Array.isArray(r["tierRules"]) ? (r["tierRules"] as unknown[]) : null;
  const tierRules = rowsRaw
    ? rowsRaw.slice(0, MAX_TIER_RULES).map((row) => cleanTierRule(row, fallbackTier))
    : DEFAULT_POSTURE_RULE.tierRules.map((row) => ({ when: { ...row.when }, tier: row.tier }));

  const ceilingRaw = Number(r["topTierCeiling"]);
  const topTierCeiling = Number.isFinite(ceilingRaw)
    ? Math.min(1, Math.max(TIER_CEILING_FLOOR, ceilingRaw))
    : DEFAULT_POSTURE_RULE.topTierCeiling;

  return { tierRules, fallbackTier, topTierCeiling };
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * What a human got wrong, in their words. Empty = saveable. Structural port of
 * `validateProblemRule`: an empty cascade, a non-last empty `when` that would swallow
 * every rule after it, a duplicate `when`, and the top-tier outcome-mass check against
 * `topTierCeiling` — computed the same way, over `cellCoverage` instead of `leafCoverage`.
 */
export function validatePostureRule(rule: PostureRule): string[] {
  const errors: string[] = [];

  if (!rule.tierRules.length) {
    errors.push(
      "The tier cascade has no rules; every vector would route to the fallback tier. " +
        "Add a rule or accept the fallback deliberately.",
    );
  }
  if (rule.tierRules.length > MAX_TIER_RULES) {
    errors.push(`The tier cascade is limited to ${MAX_TIER_RULES} rules.`);
  }

  rule.tierRules.forEach((row, i) => {
    const isEmpty = WHEN_KEYS.every((k) => row.when[k] === undefined);
    if (isEmpty && i !== rule.tierRules.length - 1) {
      errors.push(
        `Tier rule ${i + 1} has no conditions, so it matches every remaining vector and ` +
          `swallows every rule after it. Move it last or give it a condition.`,
      );
    }
  });

  const seen = new Map<string, number>();
  rule.tierRules.forEach((row, i) => {
    const isEmpty = WHEN_KEYS.every((k) => row.when[k] === undefined);
    if (isEmpty) return; // reported above, and every empty `when` is trivially "the same"
    const key = WHEN_KEYS.filter((k) => row.when[k] !== undefined)
      .map((k) => `${k}:${row.when[k]}`)
      .join("|");
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      errors.push(`Tier rule ${i + 1} repeats the same condition as rule ${earlier + 1}.`);
    } else {
      seen.set(key, i);
    }
  });

  const coverage = cellCoverage(rule);
  const tier4Share = coverage.total ? coverage.byTier[4] / coverage.total : 0;
  if (tier4Share > rule.topTierCeiling) {
    errors.push(
      `This rule sends ${coverage.byTier[4]} of ${coverage.total} cells to tier 4 ` +
        `(${pct(tier4Share)}) — above the ${pct(rule.topTierCeiling)} ceiling.`,
    );
  }

  return errors;
}

/**
 * Rows every one of whose leaves an EARLIER row already claims — the lattice analogue of
 * `shadowedOutcomeRules`, ported claim and all. A row matching ZERO leaves (the
 * lethal-trifecta row) is NOT reported here — `shadowedTierRules` is about a row that
 * WOULD claim leaves if it ran first but never gets the chance; a row that claims no
 * leaves under ANY ordering is a different failure, and `unreachableTierRules` below is
 * the diagnostic for it.
 */
export function shadowedTierRules(rule: PostureRule): number[] {
  const leaves = enumeratePostureVectors();
  const dead: number[] = [];
  rule.tierRules.forEach((row, i) => {
    const rowLeaves = leaves.filter((v) => postureVectorMatches(v, row.when));
    if (!rowLeaves.length) return;
    const allClaimedEarlier = rowLeaves.every((v) =>
      rule.tierRules.slice(0, i).some((earlier) => postureVectorMatches(v, earlier.when)),
    );
    if (allClaimedEarlier) dead.push(i);
  });
  return dead;
}

/**
 * Rows that can never match ANY of the 27 canonical leaves — as opposed to
 * `shadowedTierRules` (an earlier row already claims every leaf this one WOULD claim). A
 * row lands here when its `when` names a trifecta leg: none of the 27 leaves
 * `enumeratePostureVectors` builds ever carries `privateData` / `untrustedIngress` /
 * `externalEgress`, and neither does any live-derived vector (`derivePostureInput` never
 * sets them — see `PostureVector`'s own comment), so a `when` naming one is dead under
 * every possible ordering and every possible landscape. This is the posture analogue of
 * `aarsRule.unreachableGapRules` — a row naming something nothing in the live pipeline can
 * ever emit — computed the same way: not by inspecting the rule's STRUCTURE, but by
 * checking it against the actual leaf enumeration, because 27 leaves is cheap enough that
 * this is simply the correct algorithm rather than a performance concession.
 */
export function unreachableTierRules(rule: PostureRule): number[] {
  const leaves = enumeratePostureVectors();
  const dead: number[] = [];
  rule.tierRules.forEach((row, i) => {
    const matchesAny = leaves.some((v) => postureVectorMatches(v, row.when));
    if (!matchesAny) dead.push(i);
  });
  return dead;
}

/** Every cell's tier, tallied against the rule that claimed it — the evidence behind "order is meaning". */
export interface CellCoverage {
  /** Always 27 — `enumeratePostureVectors().length`, never hardcoded here. */
  total: number;
  /** Cells each tier-rule row claimed as its FIRST match, index-aligned with `rule.tierRules`. */
  byRow: number[];
  /** Cells no row matched, decided by `rule.fallbackTier`. */
  byFallback: number;
  byTier: Record<Tier, number>;
}

/**
 * Walk every one of the 27 cells through `decidePosture` and tally what claimed it. Same
 * function `decidePosture` itself uses, so a row's cell count and an asset's actual tier
 * can never disagree about which rule won — the lattice analogue of `leafCoverage`.
 */
export function cellCoverage(rule: PostureRule): CellCoverage {
  const leaves = enumeratePostureVectors();
  const byRow = rule.tierRules.map(() => 0);
  const byTier: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let byFallback = 0;
  for (const v of leaves) {
    const { tier, matchedRuleIndex } = decidePosture(v, rule);
    if (matchedRuleIndex === -1) byFallback++;
    else byRow[matchedRuleIndex]! += 1;
    byTier[tier]++;
  }
  return { total: leaves.length, byRow, byFallback, byTier };
}

/**
 * How much of the lattice a decided LANDSCAPE actually exercises — as opposed to
 * `cellCoverage`, which measures the RULE alone against all 27 cells regardless of any
 * real data. This is the rule run against a population: how the four tiers actually
 * landed, how many of the 27 possible cells any asset actually reached, and how often
 * each axis could not be established. Structural port of `problem.treeDiscrimination`,
 * with tie-rate machinery left out for the reason this file's own header gives.
 *
 * `tier` is `Tier | undefined` on each decided item — undefined exactly when
 * `posture.tierEstablished` refused to place the vector (see that function's own header).
 * That population is NOT dropped from `decided`: it is the whole reason this interface
 * exists rather than a plain tally, the same "excluded population reported beside the
 * count, never silently" discipline `reach.ts`'s header states outright. Dropping it here
 * would let `tierOccupancy` read as complete when it is really "of the assets we could
 * place" — precisely the false-green failure the surrounding VERIFY constraints call out.
 */
export interface PostureDiscrimination {
  decided: Array<{ tier: Tier | undefined; vector: PostureVector; unknowns: string[] }>;
  /**
   * All four tiers, zeros kept — a tier nothing reached is the finding, not an absence.
   * Counts ONLY the ESTABLISHED subset of `decided`; an item with `tier: undefined`
   * contributes to `unknownRate.tier` below instead, never to a tier bucket it was never
   * placed in.
   */
  tierOccupancy: Record<Tier, number>;
  /** Distinct cells any ESTABLISHED asset actually landed on, out of the 27 possible. */
  cellsReached: number;
  /**
   * Sparse — only cells at least one ESTABLISHED asset reached; size equals `cellsReached`.
   * A not-established item's vector is excluded here too: at least one of its own axes is a
   * default rather than a reading, so its cell would misreport a guess as an occupied cell.
   */
  cellOccupancy: Record<string, number>;
  /**
   * Share of the WHOLE `decided` population (established and not) whose reading on that
   * axis was unknown — one entry per axis, plus `tier`: the share that landed in the
   * not-established state overall (equivalently, whose `unknowns` was non-empty on ANY
   * axis — see `tierEstablished`). `tier` is reported here, EXTENDING this same record,
   * rather than as a parallel `notEstablishedCount` structure next to `tierOccupancy`: the
   * constraint this satisfies is "report it separately from tier occupancy", not "invent a
   * second shape for it".
   */
  unknownRate: Record<"capability" | "containment" | "consequence" | "tier", number>;
}

export function postureDiscrimination(
  decided: Array<{ tier: Tier | undefined; vector: PostureVector; unknowns: string[] }>,
): PostureDiscrimination {
  const tierOccupancy: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const cellOccupancy: Record<string, number> = {};
  const unknownCounts: Record<"capability" | "containment" | "consequence", number> = {
    capability: 0, containment: 0, consequence: 0,
  };
  let notEstablished = 0;

  for (const d of decided) {
    const established = tierEstablished(d.unknowns);
    if (established && d.tier !== undefined) {
      tierOccupancy[d.tier]++;
      const key = postureKey(d.vector);
      cellOccupancy[key] = (cellOccupancy[key] ?? 0) + 1;
    } else {
      notEstablished++;
    }
    for (const u of d.unknowns) {
      if (u === "capability" || u === "containment" || u === "consequence") unknownCounts[u]++;
    }
  }

  const n = decided.length;
  const rate = (count: number) => (n ? count / n : 0);

  return {
    decided,
    tierOccupancy,
    cellsReached: Object.keys(cellOccupancy).length,
    cellOccupancy,
    unknownRate: {
      capability: rate(unknownCounts.capability),
      containment: rate(unknownCounts.containment),
      consequence: rate(unknownCounts.consequence),
      tier: rate(notEstablished),
    },
  };
}

/** The rule as prose — `problemRuleSummary`'s voice, aimed at the lattice instead of the tree. */
export function postureRuleSummary(rule: PostureRule): string[] {
  const coverage = cellCoverage(rule);
  const tier4Share = coverage.total ? coverage.byTier[4] / coverage.total : 0;
  const unreachable = unreachableTierRules(rule);

  return [
    `${rule.tierRules.length} tier rules are tried in order, first match wins; a vector ` +
      `matching none of them falls back to tier ${rule.fallbackTier}.`,
    `Tier 4 claims ${coverage.byTier[4]} of ${coverage.total} cells (${pct(tier4Share)}), ` +
      `against a ceiling of ${pct(rule.topTierCeiling)}.`,
    unreachable.length
      ? `${unreachable.length} row(s) can never fire against any cell this app can derive ` +
        `— the lethal-trifecta row, kept as a documented gap rather than fed a guess.`
      : `Every row can fire against at least one of the 27 cells.`,
    `Posture is a capability envelope against a containment, not a sum of open problems: ` +
      `an asset with zero open findings can still sit at a high tier.`,
  ];
}

/**
 * Structural equality over everything that changes a TIER — the lattice analogue of
 * `decisionEqual`. Excludes exactly one field, `topTierCeiling`: it is checked only by
 * `validatePostureRule` and never read by `decidePosture`, so moving it cannot make any
 * persisted tier stale.
 */
export function tierEqual(a: PostureRule, b: PostureRule): boolean {
  const withoutCeiling = (r: PostureRule): string => {
    const c: Partial<PostureRule> = cleanPostureRule(r);
    delete c.topTierCeiling;
    return JSON.stringify(c);
  };
  return withoutCeiling(a) === withoutCeiling(b);
}
