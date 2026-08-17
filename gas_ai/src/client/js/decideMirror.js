// A pure, DOM-free JS mirror of ONE thing and one thing only: the CASCADE WALK that
// src/domain/problem.ts and src/domain/posture.ts run to turn a 4-axis decision vector or
// a 3-axis posture vector into an outcome or a tier. Nothing in this file computes a
// point, sums a pillar, or produces a score of any kind — it re-walks a fixed, closed,
// enumerable lattice of 54 (problem) or 27 (posture) leaves against an ORDERED rule table,
// exactly the way `decideProblem` / `decidePosture` already do, and stops there.
//
// THAT BOUNDARY IS THE WHOLE POINT, so say it plainly: pages/aars.js's rule 1 — "the score
// is never computed here [the client]; a second implementation in client JS would be a
// second answer to what this asset's score is" — survives this file intact. AARS's
// continuous score is not mirrored here, could not be (its inputs are pillar weights and
// live graph reads this bundle has no access to), and never will be. The Problem tree and
// the Posture lattice are a different shape of question — first-match-wins over a small,
// literally enumerable table — and that shape is cheap enough to re-walk in a browser
// without becoming a second source of truth: given the SAME rule and the SAME vector, this
// file and the TS domain it mirrors are contractually required to agree, and
// `test/decideMirror.test.js` is the contract, not a suggestion. The server remains, and
// stays, the only source of any COUNTED number — how many assets sit at ACT, how many
// leaves a rule claims, whether a save would blow the ACT ceiling. What this file buys is
// narrower and cheaper: for one hand-edited cascade row and one selected vector, "does this
// leaf still land here" is answerable in the same paint frame as the keystroke that changed
// it, instead of after `PREVIEW_DEBOUNCE_MS` (700ms, aars.js) of silence and an Apps Script
// round-trip through api_previewProblemRule / api_previewPostureRule. A lattice that only
// repaints once every debounced round-trip lands reads as laggy exactly where the editor
// most needs to feel direct — dragging a row up the cascade, watching which cells follow
// it. This module is what lets the LATTICE (src/client/js/lattice.js, built on top of it)
// repaint on every keystroke; the counted totals beside it still wait for the server, same
// as they always have.
//
// WHY A SECOND IMPLEMENTATION IS SAFE HERE WHEN IT IS NOT SAFE FOR A SCORE: `decideProblem`
// and `decidePosture` are not learned, tuned, or approximated — they are eight or nine
// lines of strict-equality checks over a `Partial<Vector>`, first-match-wins. There is no
// coefficient to drift, no floating-point accumulation to disagree on, nothing here that
// two honest implementations could compute differently short of one of them having a bug.
// That is exactly the property `test/decideMirror.test.js` exists to keep true forever: it
// does not spot-check a few hand-picked vectors, it walks every one of the 54 and 27 leaves
// against the default rule and a battery of crafted and fuzzed ones and requires bit-for-
// bit agreement, including the outcome AND which row (or the fallback) produced it. A
// second cascade walk that could ever legally disagree with the first is not a mirror, it
// is a bug waiting to be discovered by a confused analyst; this file is written, and
// tested, to make that discovery happen in CI instead.
//
// ONE DELIBERATE DEPARTURE FROM A LITERAL PORT, IN TWO HALVES — read this before touching
// either `decideProblem` or `decidePosture` below. The server's preview and save paths both run
// `cleanProblemRule` / `cleanPostureRule` (problemRule.ts / postureRule.ts) over the rule
// before ever walking it: any `when` naming an axis value outside that axis's vocabulary is
// DROPPED from the cleaned row, which turns that axis back into a WILDCARD rather than a
// condition nothing can satisfy. The rule object edited in aars.js's draft state, by
// contrast, is never cleaned client-side — a stale draft, a hand-typed junk value surviving
// a schema change, or simply a row mid-edit can all carry an out-of-vocabulary value the
// server has never seen. A literal port of `decideProblem` that skipped this step would
// treat that same row as unsatisfiable (a `when` value that can never strict-equal any real
// vector matches nothing, which is the OPPOSITE of a wildcard) and the lattice would light
// up cells the server, asked the identical question, would not. So `decideProblem` and
// `decidePosture` below run `cleanWhen` / `cleanPostureWhen` over each row's `when` before
// testing it — reproducing the server's own cleaning, one row at a time, instead of
// reproducing the raw (and here, wrong) TS function signature. `vectorMatches` and
// `postureVectorMatches` themselves stay literal, uncleaned ports — they are exported
// because `problemRule.ts` / `postureRule.ts` import the TS originals for exactly this
// "same predicate the decision itself used" guarantee, and this mirror keeps that same
// separation: cleaning is `decideProblem`'s and `decidePosture`'s job, not the match
// predicate's.
//
// The SECOND half of that departure is the row's own verdict, and it is the half that bites
// in practice rather than in theory. `cleanOutcomeRule` / `cleanTierRule` clean the outcome
// and the tier as well as the condition, and `cleanTier` runs the value through `Number()`
// first — so a tier read off the cascade's own `<select>` arrives as the string `"3"`,
// which the server turns into `3` and an uncleaned mirror leaves as `"3"`. Compared against
// the tier palette that string matches nothing, and a rule the operator has just set draws
// as a neutral cell that decided nothing. `cleanOutcome` / `cleanTier` below close that,
// and `test/decideMirror.test.js` pins a junk outcome and a string tier against the server's
// own answer so neither can regress.
//
// Every export below is named and shaped to match its TS counterpart 1:1 — same value
// lists, same enumeration order (nested loops in the SAME axis-declaration order
// `enumerateDecisionVectors` / `enumeratePostureVectors` use, never re-derived or
// re-sorted), same key format, same coverage-tally shape. `leafKey` in particular has to
// produce the byte-identical string `problem.ts`'s does: it is the join key against
// `leafOccupancy` in a `previewProblemRule` response, and a mirror that spelled a leaf's key
// even slightly differently would silently show zero occupancy for every real leaf.

// ------------------------------------------------------------------------- the vector

export const EXPLOITATION_VALUES = ["ACTIVE", "SUSPECTED", "UNKNOWN"];
export const IMPACT_VALUES = ["TOTAL", "PARTIAL"];
export const EXPOSURE_VALUES = ["OPEN", "CONTROLLED", "UNVERIFIED"];
export const MISSION_VALUES = ["HIGH", "MEDIUM", "LOW"];
/** Worst first — problem.ts's OUTCOME_VALUES; every ordinal comparison in lattice.js reads this order. */
export const OUTCOME_VALUES = ["ACT", "ATTEND", "TRACK_STAR", "TRACK"];

export const CAPABILITY_VALUES = ["BROAD", "SCOPED", "MINIMAL"];
export const CONTAINMENT_VALUES = ["WEAK", "PARTIAL", "STRONG"];
export const CONSEQUENCE_VALUES = ["SEVERE", "MODERATE", "LIMITED"];
/** 4 = worst, matching posture.ts's TIER_VALUES exactly — never re-sorted here. */
export const TIER_VALUES = [1, 2, 3, 4];

/**
 * All 54 leaves, in a fixed, deterministic order — nesting the axes in their declared order,
 * identical to `problem.enumerateDecisionVectors`. The order is load-bearing (see this
 * file's own header, point 3): `test/decideMirror.test.js` asserts element-for-element
 * agreement against the TS original, not merely "same 54 vectors in some order".
 */
export function enumerateDecisionVectors() {
  const out = [];
  for (const exploitation of EXPLOITATION_VALUES) {
    for (const impact of IMPACT_VALUES) {
      for (const exposure of EXPOSURE_VALUES) {
        for (const mission of MISSION_VALUES) {
          out.push({ exploitation, impact, exposure, mission });
        }
      }
    }
  }
  return out;
}

/** All 27 leaves, nesting capability / containment / consequence — identical to `posture.enumeratePostureVectors`. */
export function enumeratePostureVectors() {
  const out = [];
  for (const capability of CAPABILITY_VALUES) {
    for (const containment of CONTAINMENT_VALUES) {
      for (const consequence of CONSEQUENCE_VALUES) {
        out.push({ capability, containment, consequence });
      }
    }
  }
  return out;
}

/** The leaf-occupancy join key, byte-identical to `problem.leafKey`. */
export function leafKey(v) {
  return `${v.exploitation}|${v.impact}|${v.exposure}|${v.mission}`;
}

/** The cell-occupancy join key, byte-identical to `posture.postureKey`. Trifecta legs never enter it — see posture.ts. */
export function postureKey(v) {
  return `${v.capability}|${v.containment}|${v.consequence}`;
}

/**
 * Literal, uncleaned port of `problem.vectorMatches`: an axis absent from `when` is a
 * wildcard, an axis present must strict-equal the vector's own reading. Deliberately does
 * NOT clean `when` itself — see this file's header for why that job belongs to
 * `decideProblem`, one row at a time, and not to this predicate.
 */
export function vectorMatches(vector, when) {
  if (when.exploitation !== undefined && when.exploitation !== vector.exploitation) return false;
  if (when.impact !== undefined && when.impact !== vector.impact) return false;
  if (when.exposure !== undefined && when.exposure !== vector.exposure) return false;
  if (when.mission !== undefined && when.mission !== vector.mission) return false;
  return true;
}

/**
 * Literal, uncleaned port of `posture.postureVectorMatches`, trifecta legs included exactly
 * as written there. READ THIS BEFORE "FIXING" ANY OF THE LAST THREE LINES: every one of the
 * 27 canonical leaves (and every live-derived posture vector — `derivePostureInput` never
 * sets any of the three legs, see posture.ts's own header) carries `privateData` /
 * `untrustedIngress` / `externalEgress` as `undefined`, never `false`. A `when` row naming
 * `privateData: false` therefore compares `false !== undefined`, which is `true`, which
 * makes the row FAIL to match — the same as naming `privateData: true` does. Both spellings
 * of "not true" are equally unreachable, on purpose: `false` is not a discount any more
 * than `true` is a promotion, because nothing in this vector's live derivation ever
 * distinguishes "checked and false" from "never checked" on these three legs. Special-
 * casing `false` to mean "matches vectors that don't carry this leg" would silently make
 * the lethal-trifecta row (or any row copying its shape) reachable — exactly the bug this
 * predicate's own strict inequality already prevents, and exactly what
 * `test/decideMirror.test.js`'s `privateData:true` AND `privateData:false` cases both
 * claiming zero cells is there to catch.
 */
export function postureVectorMatches(vector, when) {
  if (when.capability !== undefined && when.capability !== vector.capability) return false;
  if (when.containment !== undefined && when.containment !== vector.containment) return false;
  if (when.consequence !== undefined && when.consequence !== vector.consequence) return false;
  if (when.privateData !== undefined && when.privateData !== vector.privateData) return false;
  if (when.untrustedIngress !== undefined && when.untrustedIngress !== vector.untrustedIngress) return false;
  if (when.externalEgress !== undefined && when.externalEgress !== vector.externalEgress) return false;
  return true;
}

// ------------------------------------------------------------------------ cleaning a `when`

function rec(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * Coerce a raw (possibly hand-edited, possibly stale, possibly junk) `when` blob into one
 * that only ever carries the four problem axes at values that axis actually has — the
 * client-side twin of `problemRule.cleanWhen`. An out-of-vocabulary value or an unknown key
 * is DROPPED, never coerced or defaulted, so the axis reads back as an absent wildcard —
 * the exact behaviour `cleanProblemRule` produces server-side before `decideProblem` ever
 * runs. See this file's header for why `decideProblem` below calls this on every row rather
 * than trusting the caller to have cleaned the whole rule first.
 */
export function cleanWhen(raw) {
  const r = rec(raw);
  const when = {};
  if (EXPLOITATION_VALUES.includes(r.exploitation)) when.exploitation = r.exploitation;
  if (IMPACT_VALUES.includes(r.impact)) when.impact = r.impact;
  if (EXPOSURE_VALUES.includes(r.exposure)) when.exposure = r.exposure;
  if (MISSION_VALUES.includes(r.mission)) when.mission = r.mission;
  return when;
}

/**
 * The VERDICT half of the same cleaning, and it is needed for exactly the reason the `when`
 * half is. `cleanOutcomeRule` / `cleanTierRule` do not stop at the condition — they coerce
 * the row's own outcome or tier too, falling back rather than passing junk through, and a
 * mirror that cleaned only the `when` would light a cell with a verdict the server would
 * never return.
 *
 * `cleanTier`'s `Number()` is the one that actually bites in this app rather than in theory:
 * `select.value` is ALWAYS a string, so a tier arriving from the cascade's own dropdown is
 * `"3"`, not `3`. The server coerces that to `3` and the lattice, comparing `"3"` against
 * the tier palette, would fall through to a neutral cell — a rule the operator just set,
 * drawn as though it decided nothing. `test/decideMirror.test.js` pins both spellings.
 */
export function cleanOutcome(v, fallback) {
  return OUTCOME_VALUES.includes(v) ? v : fallback;
}

/** The posture twin — `Number()` first, because a tier off a `<select>` is a string. */
export function cleanTier(v, fallback) {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : fallback;
}

/** The posture twin of `cleanWhen` — the client-side mirror of `postureRule.cleanWhen`, trifecta legs included. */
export function cleanPostureWhen(raw) {
  const r = rec(raw);
  const when = {};
  if (CAPABILITY_VALUES.includes(r.capability)) when.capability = r.capability;
  if (CONTAINMENT_VALUES.includes(r.containment)) when.containment = r.containment;
  if (CONSEQUENCE_VALUES.includes(r.consequence)) when.consequence = r.consequence;
  if (typeof r.privateData === "boolean") when.privateData = r.privateData;
  if (typeof r.untrustedIngress === "boolean") when.untrustedIngress = r.untrustedIngress;
  if (typeof r.externalEgress === "boolean") when.externalEgress = r.externalEgress;
  return when;
}

// ------------------------------------------------------------------------------- deciding

/**
 * First-match-wins over `rule.outcomeRules`, each row's `when` cleaned before it is tested
 * — see this file's header for why that is not optional. `matchedRuleIndex` is `-1` exactly
 * when the fallback fired, the same contract `problem.decideProblem` keeps, so an audit
 * trail built off this function's result can always say which row (or "no row") decided.
 */
export function decideProblem(vector, rule) {
  // The row fallback is the CLEANED rule-level fallback, not the raw one — the same order
  // `cleanProblemRule` resolves them in, so a rule with a junk fallback AND a junk row
  // outcome degrades exactly once, to the documented default, rather than twice.
  const fallbackOutcome = cleanOutcome(rule.fallbackOutcome, "TRACK");
  for (let i = 0; i < rule.outcomeRules.length; i++) {
    const row = rule.outcomeRules[i];
    if (vectorMatches(vector, cleanWhen(row.when))) {
      return { outcome: cleanOutcome(row.outcome, fallbackOutcome), matchedRuleIndex: i };
    }
  }
  return { outcome: fallbackOutcome, matchedRuleIndex: -1 };
}

/** The posture twin of `decideProblem` — first-match-wins over `rule.tierRules`, each row cleaned first. */
export function decidePosture(vector, rule) {
  const fallbackTier = cleanTier(rule.fallbackTier, 2);
  for (let i = 0; i < rule.tierRules.length; i++) {
    const row = rule.tierRules[i];
    if (postureVectorMatches(vector, cleanPostureWhen(row.when))) {
      return { tier: cleanTier(row.tier, fallbackTier), matchedRuleIndex: i };
    }
  }
  return { tier: fallbackTier, matchedRuleIndex: -1 };
}

// ------------------------------------------------------------------------------ coverage

/**
 * Walk every one of the 54 leaves through `decideProblem` and tally what claimed it —
 * identical algorithm and identical shape to `problemRule.leafCoverage`, run over THIS
 * file's `decideProblem` (so a junk `when` is handled the same way here as it would be by
 * the server, per this file's header) rather than re-imported from the TS domain.
 */
export function leafCoverage(rule) {
  const leaves = enumerateDecisionVectors();
  const byRow = rule.outcomeRules.map(() => 0);
  const byOutcome = { ACT: 0, ATTEND: 0, TRACK_STAR: 0, TRACK: 0 };
  let byFallback = 0;
  for (const v of leaves) {
    const { outcome, matchedRuleIndex } = decideProblem(v, rule);
    if (matchedRuleIndex === -1) byFallback++;
    else byRow[matchedRuleIndex] += 1;
    byOutcome[outcome]++;
  }
  return { total: leaves.length, byRow, byFallback, byOutcome };
}

/** The posture twin of `leafCoverage` — identical algorithm and shape to `postureRule.cellCoverage`. */
export function cellCoverage(rule) {
  const leaves = enumeratePostureVectors();
  const byRow = rule.tierRules.map(() => 0);
  const byTier = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let byFallback = 0;
  for (const v of leaves) {
    const { tier, matchedRuleIndex } = decidePosture(v, rule);
    if (matchedRuleIndex === -1) byFallback++;
    else byRow[matchedRuleIndex] += 1;
    byTier[tier]++;
  }
  return { total: leaves.length, byRow, byFallback, byTier };
}
