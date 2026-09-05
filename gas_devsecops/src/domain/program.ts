// Remediation program performance: coverage, efficiency, and capacity — the metric family
// from the Cisco Kenna / Cyentia "Prioritization to Prediction" (P2P) research series.
//
// MTTR and SLA answer "how fast are we closing risk". These answer the other half: "are we
// closing the RIGHT risk", and "can we close it faster than it arrives".
//
//   Coverage   (P2P v1; restated v2 p.13, v4 p.5, v5 p.13, vol. 9 p.22)
//              Completeness / recall. Of all HIGH-RISK findings, what share did we
//              remediate?  TP / (TP + FN).
//   Efficiency (P2P v2 p.13)
//              Precision. Of everything we remediated, what share was actually high-risk?
//              TP / (TP + FP).  The rest is effort that "may have been more productive
//              elsewhere".
//   Capacity   (P2P v3 "Lessons in Remediation Capacity", v4 p.7)
//              Mean Monthly Close Rate — the share of the open backlog closed per month
//              (the series' headline: a typical org closes about 1 in 10, regardless of size)
//              — and net capacity, high-risk closed vs. opened, giving the v3 Fig. 22
//              verdict: gaining ground / keeping up / falling behind.
//
// The two rates are in direct tension and are meaningless apart: v2's industry baseline is
// 70% coverage at 18.5% efficiency, and v4 found most firms never cross 50% efficiency. The
// UI must always show them as a pair.
//
// PORT PROVENANCE, because this module has two upstreams and they do not agree everywhere:
//   gas/src/domain/program.ts   the TypeScript shape — export names, the Rate bracket, the
//                               scan-delta cross-check, `maxMonths`.
//   brick/devsecops/metrics.py  the BEHAVIOURAL SPEC for this register (CLAUDE.md), and the
//                               only source for the static-analysis rule, the six-signal
//                               breakdown, `cwe_unmapped`, and the `observed_from` /
//                               `closed_observed` capacity parameters.
// Where the two disagree, brick wins and the divergence is named at the site. There are
// exactly three, all marked `DIVERGENCE:` below: the sensitivity-subset labels, the
// no-horizon `reconstructed` flag, and the extra tiers `riskTier` can return.
//
// The rule TYPES and DEFAULTS are NOT defined here. `RiskRule`, `SastRiskRule`,
// `DEFAULT_RISK_RULE`, `DEFAULT_SAST_RISK_RULE` and `ruleForScope` live in `config.ts`,
// which is where `ruleForScope` has to live anyway (it is the scope table's business, and
// config.ts is what the settings layer reads). gas/ defines `RiskRule` inside program.ts;
// this file imports it instead, so there is exactly one definition in the tree.
//
// ---------------------------------------------------------------------------------------
// THE CORRECTNESS TRAP, stated once because everything here is shaped by it:
// **unknown is not the same as not-high-risk.** A finding whose signal was never captured
// must never be counted as low risk — that single mistake inflates efficiency's denominator
// and deflates coverage's numerator simultaneously, and it does so silently. So unclassified
// rows leave BOTH sides of every rate, are counted in their own matrix row, and drive the
// published bounds (see `Rate`) whose width IS the size of the doubt.
// ---------------------------------------------------------------------------------------

import {
  AI_VERDICTS_HIGH,
  CWE_ANCESTORS,
  CWE_TOP_25_2024,
  NET_CAPACITY_BAND_PCT,
  RESOLVED_STATUSES,
  SEVERITY_ORDER,
  ruleForScope,
  type RiskRule,
  type SastRiskRule,
} from "./config";
import type { BaseRow } from "./ledgerTypes";
import { normalizeSeverity } from "./severity";
import { minNum, parseTs } from "./util";

const DAY_MS = 86_400_000;

/** Same open/resolved test the rest of the domain uses (brick metrics.is_open). */
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

// --------------------------------------------------------------------------- the rules

/** Either classifier. One function per concept; the two rules differ only in what they read. */
export type AnyRiskRule = RiskRule | SastRiskRule;

/** Structural discriminator — `SastRiskRule` is the only one of the two with a `cwe` key. */
export function isSastRule(rule: AnyRiskRule): rule is SastRiskRule {
  return "cwe" in rule;
}

/**
 * Every signal either rule can carry, in the order the breakdown reports them.
 * brick/devsecops/metrics.py's `SIGNAL_NAMES`, and fixed for the same reason: a disabled
 * clause reports 0, never a missing field, so the shape does not change when an operator
 * turns a clause off.
 */
export type RiskSignal = "kev" | "exploit" | "epss" | "cwe" | "aiVerdict" | "critical";

export const SIGNAL_NAMES: readonly RiskSignal[] = [
  "kev", "exploit", "epss", "cwe", "aiVerdict", "critical",
];

/** True when the rule enables no signal at all — nothing is decidable, so everything is unknown. */
export function ruleIsEmpty(rule: AnyRiskRule): boolean {
  return isSastRule(rule)
    ? !rule.cwe && !rule.aiVerdict && !rule.critical
    : !rule.kev && !rule.exploit && !rule.epss;
}

/**
 * The rule as a sentence, for the page and the CSV header — a classifier you cannot read is
 * one you cannot audit. Byte-identical to `RiskRule.sentence()` / `SastRiskRule.sentence()`
 * in brick/devsecops/config.py, which the `rule_sentence` column of confusion.json pins.
 */
export function ruleSentence(rule: AnyRiskRule): string {
  const parts: string[] = [];
  if (isSastRule(rule)) {
    if (rule.cwe) parts.push("CWE in the Top 25");
    if (rule.aiVerdict) parts.push("AI triage says exploitable");
    if (rule.critical) parts.push("severity CRITICAL");
  } else {
    if (rule.kev) parts.push("CISA KEV");
    if (rule.exploit) parts.push("public exploit");
    if (rule.epss) parts.push("EPSS >= " + rule.epssThreshold.toFixed(2));
  }
  return parts.length ? parts.join(" or ") : "no signal enabled";
}

// ------------------------------------------------------------------- classification

/** The three-valued verdict. `unknown` is a first-class outcome, never folded into `low`. */
export type RiskClass = "high" | "low" | "unknown";

/**
 * The projection the classifier reads. `scope` is part of it because the rule is per scope
 * — see `resolveRule`. The three SCA signal columns and the three SAST ones are all here
 * because one ledger holds all three scopes (CLAUDE.md, "Three scopes, one ledger").
 */
export type RiskRow = Pick<
  BaseRow,
  "scope" | "severity" | "status" | "has_kev" | "has_exploit" | "epss" | "cwe" | "ai_verdict"
>;

/** `(name, fired, observed)` — brick's clause triple, evaluated per row rather than per column. */
interface Clause {
  name: RiskSignal;
  fired: boolean;
  observed: boolean;
}

/**
 * Which rule applies to this row, and the refusal.
 *
 * **A `secrets` row is REFUSED, not silently classified.** `ruleForScope("secrets")` is
 * `null` by design (config.ts states the argument in full): there is no exploit intelligence
 * for a hardcoded string the way there is for a CVE, and severity there grades a DETECTION
 * rather than whether the credential is live. Coverage and efficiency over that population
 * would be a rate with no meaning, which is worse than no rate — so this throws, naming the
 * scope, rather than returning `unknown` and letting a page render a confident zero.
 *
 * An explicit `rule` argument does not buy past it. The refusal is about the population, not
 * about which classifier the caller happened to hand in.
 */
function resolveRule(row: RiskRow, rule?: AnyRiskRule): AnyRiskRule {
  const forScope = ruleForScope(row.scope);
  if (forScope === null) {
    throw new Error(
      `program metrics have no meaning for scope "${row.scope}": coverage and efficiency ` +
        `are rates over a high-risk population, and that scope has no high-risk rule ` +
        `(config.ruleForScope returns null). Segment secrets by validation_state and ` +
        `confidence instead.`,
    );
  }
  return rule ?? forScope;
}

/** True when any of a finding's CWEs — or a documented ancestor of one — is in the Top 25. */
export function cweMatchesExploited(cwe: string): boolean {
  const top = CWE_TOP_25_2024 as readonly string[];
  for (const raw of cwe.split(",")) {
    const id = raw.trim();
    if (!id) continue;
    if (top.includes(id)) return true;
    const parent = CWE_ANCESTORS[id];
    if (parent !== undefined && top.includes(parent)) return true;
  }
  return false;
}

/** `(name, fired, observed)` per enabled signal of the CVE rule. brick `_cve_clauses`. */
function cveClauses(row: RiskRow, rule: RiskRule): Clause[] {
  // A NaN EPSS is as good as absent, exactly as brick's `isNotNull() & ~isnan()` has it.
  const epssObserved = typeof row.epss === "number" && Number.isFinite(row.epss);
  const out: Clause[] = [];
  if (rule.kev) {
    out.push({ name: "kev", fired: row.has_kev === true, observed: row.has_kev != null });
  }
  if (rule.exploit) {
    out.push({
      name: "exploit",
      fired: row.has_exploit === true,
      observed: row.has_exploit != null,
    });
  }
  if (rule.epss) {
    out.push({
      name: "epss",
      fired: epssObserved && (row.epss as number) >= rule.epssThreshold,
      observed: epssObserved,
    });
  }
  return out;
}

/**
 * `(name, fired, observed)` per enabled signal of the static-analysis rule.
 * brick `_sast_clauses`. Each *observed* test is deliberately strict: a blank CWE, a missing
 * AI verdict and an UNKNOWN severity are all "never captured", not "captured as no".
 *
 * `aiVerdict` IS UNVERIFIED. `aiAnalysis` is null tenant-wide (CLAUDE.md / config.ts), so
 * `AI_VERDICTS_HIGH` is a guess at a vocabulary and this clause has never fired on real
 * data. That is precisely why `signalBreakdown` reports the axis with its own
 * `aiVerdictMissing` count instead of omitting it: a clause that cannot fire and a clause
 * that fires on nothing look identical in a rate, and only differ in the coverage number
 * beside it.
 */
function sastClauses(row: RiskRow, rule: SastRiskRule): Clause[] {
  const cwe = typeof row.cwe === "string" ? row.cwe : "";
  const cweObserved = cwe.trim().length > 0;
  // Case-folded here rather than trusted: brick's `silver_sast` uppercases the column on the
  // way in, but this register's ledger writes `ai_verdict` straight from the API node, so the
  // fold has to happen at the point of comparison or a lowercase verdict silently never fires.
  const verdictRaw = typeof row.ai_verdict === "string" ? row.ai_verdict.trim() : "";
  const verdictObserved = verdictRaw.length > 0;
  const severity = normalizeSeverity(row.severity);
  const severityObserved = severity !== "UNKNOWN";

  const out: Clause[] = [];
  if (rule.cwe) {
    out.push({ name: "cwe", fired: cweObserved && cweMatchesExploited(cwe), observed: cweObserved });
  }
  if (rule.aiVerdict) {
    out.push({
      name: "aiVerdict",
      fired: verdictObserved && AI_VERDICTS_HIGH.has(verdictRaw.toUpperCase()),
      observed: verdictObserved,
    });
  }
  if (rule.critical) {
    out.push({
      name: "critical",
      fired: severityObserved && severity === "CRITICAL",
      observed: severityObserved,
    });
  }
  return out;
}

/**
 * The enabled signals of either rule. brick's `rule_clauses`: the two rules differ in what
 * they read and in nothing else, so this is the only place that knows which is which, and
 * the three-valued classifier / breakdown / sensitivity sweep are each written once.
 */
function ruleClauses(row: RiskRow, rule: AnyRiskRule): Clause[] {
  return isSastRule(rule) ? sastClauses(row, rule) : cveClauses(row, rule);
}

/**
 * Which enabled clauses fired — drives the per-signal counts on the classifier card and the
 * "why is this high risk" line in the drill-down. Empty for `low` and `unknown` rows.
 */
export function firedSignals(row: RiskRow, rule?: AnyRiskRule): RiskSignal[] {
  const r = resolveRule(row, rule);
  return ruleClauses(row, r)
    .filter((c) => c.fired)
    .map((c) => c.name);
}

/**
 * Three-valued classification, in this order and for these reasons:
 *
 *   1. any enabled signal FIRES            -> "high"     positive evidence stands on its own,
 *                                                        whatever else is missing;
 *   2. else any enabled signal NOT OBSERVED -> "unknown"  never manufacture a negative out of
 *                                                        missing data — this is the trap;
 *   3. else                                 -> "low"      every enabled signal was observed and
 *                                                        none of them fired.
 *
 * Step 2 before step 3 is the whole thing. A row with KEV=false, exploit=false and an EPSS
 * that was never captured is **unknown**, not low; calling it low is precisely how a naive
 * implementation over-states efficiency. The same trap applies a second time on the SAST
 * rule: a finding with an unmapped CWE and no AI verdict is unknown, not low.
 *
 * A rule with no signals enabled decides nothing, so every row is `unknown` and the page
 * reads "no classifier enabled — 100% unclassified". That is deliberate: honest state beats
 * a hidden fallback to the default rule.
 *
 * `rule` may be omitted, in which case the scope's own rule applies (`ruleForScope`). A
 * `secrets` row throws either way — see `resolveRule`.
 */
export function classifyRisk(row: RiskRow, rule?: AnyRiskRule): RiskClass {
  const r = resolveRule(row, rule);
  if (ruleIsEmpty(r)) return "unknown";
  const clauses = ruleClauses(row, r);
  if (clauses.some((c) => c.fired)) return "high";
  if (clauses.some((c) => !c.observed)) return "unknown";
  return "low";
}

// ------------------------------------------------------------------------ risk tiers

/**
 * `classifyRisk` answers high/low/unknown, which is what the coverage and efficiency rates
 * need; a triage view needs to know WHICH signal fired, because "on the CISA KEV catalog"
 * and "EPSS crossed 10%" are not the same day's work.
 *
 * So this is a REFINEMENT of `classifyRisk`, never a second opinion — it splits `high` into
 * its causes in severity-of-evidence order and passes `low` / `unknown` straight through.
 * The identity holds by construction and is pinned in test/program.test.ts:
 *
 *     (every high tier) === (rows classified "high")
 *     none              === (rows classified "low")
 *     unknown           === (rows classified "unknown")
 *
 * That matters because several pages render an unclassified count over the same register.
 * Two classifiers would eventually disagree, and the reader would have no way to tell which
 * one was lying.
 *
 * DIVERGENCE from gas/: three tiers are added, because this register classifies SAST rows
 * too and `kev | exploit | epss` cannot name a CWE match. gas/'s five are unchanged and a
 * CVE row still lands in exactly the tiers gas/ gives it.
 */
export type RiskTier = RiskSignal | "none" | "unknown";

/** Worst evidence first; `unknown` last because it is a measurement gap, not a low score. */
export const RISK_TIER_ORDER: RiskTier[] = [...SIGNAL_NAMES, "none", "unknown"];

/** Display labels. The tier is named by what is KNOWN, never by a severity word. */
export const RISK_TIER_LABELS: Record<RiskTier, string> = {
  kev: "Known exploited",
  exploit: "Public exploit",
  epss: "Likely exploited",
  cwe: "Top-25 weakness class",
  aiVerdict: "AI triage: exploitable",
  critical: "Rated critical",
  // gas/ says "No known exploit"; two of the six signals here are not exploit signals at
  // all, so the label states what happened rather than which catalogue was consulted.
  none: "No signal fired",
  unknown: "Unclassified",
};

/**
 * Which tier a row lands in. A row can fire several clauses at once (a KEV entry usually
 * also has a public exploit); the tier takes the strongest, so the tiers partition the
 * population rather than overlapping the way a signal breakdown deliberately does. "Strongest"
 * is clause order, which is `SIGNAL_NAMES` order within each rule — single-sourced from
 * `ruleClauses`, so the tier can never name a signal the classifier did not evaluate.
 */
export function riskTier(row: RiskRow, rule?: AnyRiskRule): RiskTier {
  const cls = classifyRisk(row, rule);
  if (cls !== "high") return cls === "low" ? "none" : "unknown";
  return firedSignals(row, rule)[0]!;
}

// ------------------------------------------------------------------ confusion matrix

/**
 * A rate with the bounds the unclassified population implies.
 *
 * `point` is the rate over classified rows only. `lo` / `hi` are what the rate would be if
 * every unclassified row turned out to be the worst / best case for that rate. When nothing
 * is unclassified, lo === point === hi and the UI renders a bare number; otherwise the width
 * of the bracket **is** the size of the doubt, which makes the missing data impossible to
 * hide behind a confident-looking figure. Never publish `point` on its own.
 */
export interface Rate {
  point: number | null;
  lo: number | null;
  hi: number | null;
}

const NO_RATE: Rate = { point: null, lo: null, hi: null };

/** `num / den * 100`, or NULL when there is nothing to divide by. NULL, never 0. */
function pct(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

export interface ConfusionMatrix {
  // The classified 2x2.
  tp: number; // high risk, remediated      — the work that mattered
  fp: number; // not high risk, remediated  — effort that could have gone elsewhere
  fn: number; // high risk, still open      — unremediated risk
  tn: number; // not high risk, still open  — correctly deprioritized
  // The unclassified row, kept OUTSIDE the 2x2 so it can never be mistaken for a quadrant.
  unknownRemediated: number;
  unknownOpen: number;
  // Totals.
  classified: number;
  unknown: number;
  total: number;
  remediated: number; // including unclassified
  open: number; // including unclassified
  highRisk: number;
  notHighRisk: number;
  // Rates.
  coverage: Rate;
  efficiency: Rate;
  /**
   * (tp + fn) / classified — the share of classified findings that are high risk, which is
   * exactly the efficiency a program picking findings at RANDOM would score. P2P v2 p.15
   * makes this point with the industry figure: 15.6% of open vulns had known exploits, so
   * random selection is "right" 15.6% of the time. Efficiency at or below prevalence means
   * the program is not prioritizing at all — which is what turns efficiency from a number
   * into a verdict.
   */
  prevalence: number | null;
  /** classified / total — the honesty number. Every rate above is conditional on it. */
  signalCoveragePct: number | null;
}

function emptyMatrix(): ConfusionMatrix {
  return {
    tp: 0, fp: 0, fn: 0, tn: 0,
    unknownRemediated: 0, unknownOpen: 0,
    classified: 0, unknown: 0, total: 0,
    remediated: 0, open: 0, highRisk: 0, notHighRisk: 0,
    coverage: NO_RATE, efficiency: NO_RATE,
    prevalence: null, signalCoveragePct: null,
  };
}

/**
 * Finalize the derived fields of a matrix whose six counts are already filled.
 * brick `_finalize_matrix`, term for term.
 *
 * The bounds are the extreme re-labellings of the unclassified rows:
 *
 *   coverage = TP / (TP + FN)
 *     lo  every unclassified-OPEN row was really high risk (they join FN, the worst case),
 *         and no unclassified-remediated row was       ->  TP / (TP + FN + unknownOpen)
 *     hi  every unclassified-REMEDIATED row was really high risk (they join TP), and no
 *         unclassified-open row was            -> (TP + unknownRemediated)
 *                                                 / (TP + unknownRemediated + FN)
 *
 *   efficiency = TP / (TP + FP)         (unclassified-open rows cannot affect it at all)
 *     lo  every unclassified-remediated row was NOT high risk (they join FP)
 *                                                 ->  TP / (TP + FP + unknownRemediated)
 *     hi  every unclassified-remediated row WAS high risk (they join TP)
 *                                                 -> (TP + unknownRemediated)
 *                                                    / (TP + FP + unknownRemediated)
 */
function finalize(m: ConfusionMatrix): ConfusionMatrix {
  m.classified = m.tp + m.fp + m.fn + m.tn;
  m.unknown = m.unknownRemediated + m.unknownOpen;
  m.total = m.classified + m.unknown;
  m.remediated = m.tp + m.fp + m.unknownRemediated;
  m.open = m.fn + m.tn + m.unknownOpen;
  m.highRisk = m.tp + m.fn;
  m.notHighRisk = m.fp + m.tn;
  m.coverage = {
    point: pct(m.tp, m.tp + m.fn),
    lo: pct(m.tp, m.tp + m.fn + m.unknownOpen),
    hi: pct(m.tp + m.unknownRemediated, m.tp + m.unknownRemediated + m.fn),
  };
  m.efficiency = {
    point: pct(m.tp, m.tp + m.fp),
    lo: pct(m.tp, m.tp + m.fp + m.unknownRemediated),
    hi: pct(m.tp + m.unknownRemediated, m.tp + m.fp + m.unknownRemediated),
  };
  m.prevalence = pct(m.highRisk, m.classified);
  m.signalCoveragePct = pct(m.classified, m.total);
  return m;
}

/** Tally one row into a matrix (shared by the overall and per-severity passes). */
function tallyRow(m: ConfusionMatrix, row: RiskRow, rule?: AnyRiskRule): void {
  const open = isOpen(row.status);
  switch (classifyRisk(row, rule)) {
    case "high":
      if (open) m.fn += 1;
      else m.tp += 1;
      break;
    case "low":
      if (open) m.tn += 1;
      else m.fp += 1;
      break;
    default:
      if (open) m.unknownOpen += 1;
      else m.unknownRemediated += 1;
  }
}

/**
 * The confusion matrix and both rates over a set of ledger base rows.
 *
 * "Remediated" is the same `RESOLVED_STATUSES` test the rest of the domain uses, so it
 * includes disappearance-resolutions (a finding that stopped appearing in scans). That is a
 * slightly soft notion of remediated and the methodology copy says so. Note it reads
 * *status*, while the MTTR clock reads `resolved_at`: a finding can be status-RESOLVED with
 * no timestamp, and it counts as remediated here while contributing no MTTR.
 */
export function confusionMatrix(rows: RiskRow[], rule?: AnyRiskRule): ConfusionMatrix {
  const m = emptyMatrix();
  for (const row of rows) tallyRow(m, row, rule);
  return finalize(m);
}

/**
 * Per-severity matrices plus the overall one. Keyed by normalized severity; only severities
 * actually present get a key, and they are emitted in SEVERITY_ORDER (UNKNOWN included).
 * brick's `confusion_matrix` emits the same table as rows with an `OVERALL` severity.
 */
export function confusionBySeverity(
  rows: RiskRow[],
  rule?: AnyRiskRule,
): { perSev: Record<string, ConfusionMatrix>; overall: ConfusionMatrix } {
  const bySev: Record<string, ConfusionMatrix> = {};
  const overall = emptyMatrix();
  for (const row of rows) {
    const s = normalizeSeverity(row.severity);
    const m = bySev[s] ?? (bySev[s] = emptyMatrix());
    tallyRow(m, row, rule);
    tallyRow(overall, row, rule);
  }
  const perSev: Record<string, ConfusionMatrix> = {};
  for (const s of SEVERITY_ORDER) if (bySev[s]) perSev[s] = finalize(bySev[s]!);
  return { perSev, overall: finalize(overall) };
}

// ---------------------------------------------------------------- signal breakdown

export type SignalCounts = Record<RiskSignal, number>;

export interface SignalBreakdown {
  /** Rows each enabled clause fired on. A disabled clause reports 0 — it decides nothing. */
  fired: SignalCounts;
  /** Rows where the signal was never captured, per enabled clause — the shape of the gap. */
  missing: SignalCounts;
  /** Rows classified `high`. NOT the sum of `fired`: the clauses are OR'd and overlap. */
  anyOf: number;
  /**
   * Findings that HAVE a CWE which matched neither the Top 25 nor a documented ancestor of
   * one. Those classify `low`, so this is the size of the gap in `CWE_ANCESTORS` measured in
   * findings. 0 whenever the `cwe` clause is disabled (it decides nothing then).
   */
  cweUnmapped: number;
}

function zeroCounts(): SignalCounts {
  return { kev: 0, exploit: 0, epss: 0, cwe: 0, aiVerdict: 0, critical: 0 };
}

/**
 * How many rows each enabled clause fires on, and how many never captured it.
 *
 * The clauses are OR'd, so a row can be counted under several and these do NOT sum to
 * `anyOf` — the UI must say so rather than presenting them as a partition.
 *
 * The shape is FIXED at all six signals (brick's `SIGNAL_NAMES`) rather than derived from
 * the rule, so turning a clause off changes a number rather than the table. Two of the
 * counts are load-bearing on the static-analysis rule in particular:
 *
 *   `missing.aiVerdict` equal to the row count means the field is not being returned, or
 *   `AI_VERDICTS_HIGH` holds the wrong strings — both of which silence the clause with no
 *   other symptom. It is the measured 0% coverage of an UNVERIFIED signal, and reporting it
 *   is the only thing separating "the AI agreed with nothing" from "nobody asked the AI".
 *   `cweUnmapped` is the coverage gap in `CWE_ANCESTORS`, in findings.
 */
export function signalBreakdown(rows: RiskRow[], rule?: AnyRiskRule): SignalBreakdown {
  const out: SignalBreakdown = {
    fired: zeroCounts(),
    missing: zeroCounts(),
    anyOf: 0,
    cweUnmapped: 0,
  };
  for (const row of rows) {
    const r = resolveRule(row, rule);
    const clauses = ruleClauses(row, r);
    for (const c of clauses) {
      if (c.fired) out.fired[c.name] += 1;
      if (!c.observed) out.missing[c.name] += 1;
      // Only counted while the clause is ENABLED: a disabled clause decides nothing, so it
      // has no gap to report. brick guards this the same way (`if "cwe" in enabled`).
      if (c.name === "cwe" && c.observed && !c.fired) out.cweUnmapped += 1;
    }
    // brick counts `risk_class == "high"` here rather than "any clause fired". The two agree
    // for every rule (an empty rule fires nothing and classifies nothing high); this takes
    // brick's definition so the two can never drift.
    if (classifyRisk(row, r) === "high") out.anyOf += 1;
  }
  return out;
}

// ------------------------------------------------------------------ rule sensitivity

export interface RuleSensitivityPoint {
  label: string;
  rule: AnyRiskRule;
  /** `ruleSentence(rule)` — carried so a CSV row explains itself without a second lookup. */
  sentence: string;
  active: boolean;
  coverage: number | null;
  efficiency: number | null;
  highRisk: number;
  unknown: number;
  /** The full matrix behind the two rates — brick publishes every column of it per subset. */
  matrix: ConfusionMatrix;
}

/**
 * The seven non-empty signal subsets of the CVE rule.
 *
 * DIVERGENCE from gas/: the single-signal labels read "KEV only" / "Exploit only" /
 * "EPSS only" where gas/ says "KEV" / "Exploit" / "EPSS". brick/devsecops/metrics.py's
 * `RULE_SUBSETS` states the difference in its own comment and its notebook layer walks this
 * exact tuple, so the labels are part of what confusion.json pins. brick is this register's
 * behavioural spec (CLAUDE.md), and "KEV only" is the clearer wording besides — a bare "KEV"
 * beside "KEV or EPSS" reads as a category, not as a rule with one clause.
 */
const RULE_SUBSETS: readonly [string, boolean, boolean, boolean][] = [
  ["KEV only", true, false, false],
  ["Exploit only", false, true, false],
  ["EPSS only", false, false, true],
  ["KEV or exploit", true, true, false],
  ["KEV or EPSS", true, false, true],
  ["Exploit or EPSS", false, true, true],
  ["All three", true, true, true],
];

/**
 * The same seven subsets over the static-analysis rule's three signals, in the same order.
 * brick `SAST_RULE_SUBSETS`. The table matters MORE here than on the CVE register, not less:
 * that rule at least reads somebody else's prediction about exploitation, where this one
 * reads a weakness class and a severity somebody typed.
 */
const SAST_RULE_SUBSETS: readonly [string, boolean, boolean, boolean][] = [
  ["CWE only", true, false, false],
  ["AI verdict only", false, true, false],
  ["CRITICAL only", false, false, true],
  ["CWE or AI verdict", true, true, false],
  ["CWE or CRITICAL", true, false, true],
  ["AI verdict or CRITICAL", false, true, true],
  ["All three", true, true, true],
];

/**
 * Coverage and efficiency under each of the seven non-empty signal subsets, with the active
 * rule marked — the data behind the coverage-vs-efficiency scatter.
 *
 * The EPSS threshold is inherited from `active` rather than swept, so the only thing varying
 * across rows is which signals are switched on; the threshold therefore cannot be what marks
 * a row active, and only the three booleans are compared.
 *
 * Deliberately NOT a reproduction of P2P vol. 9's Figure 19. That figure plots candidate
 * remediation strategies against an INDEPENDENT ground truth (observed exploitation in the
 * wild); we have no such ground truth, only these same signals, so no subset can come out
 * "wrong" — a narrow rule simply reports a high rate over a small high-risk population.
 * What this answers instead is the question a reader of a rule-defined metric genuinely
 * needs: **how much of the headline is the rule rather than the register?** `highRisk` and
 * `unknown` ride along on every row precisely so that a subset which buys efficiency by
 * shrinking the positive class, or by pushing rows into `unknown`, cannot hide it. Label it
 * "rule sensitivity" on the page, not "strategy comparison".
 */
export function ruleSensitivity(rows: RiskRow[], active: AnyRiskRule): RuleSensitivityPoint[] {
  if (isSastRule(active)) {
    return SAST_RULE_SUBSETS.map(([label, cwe, aiVerdict, critical]) => {
      const rule: SastRiskRule = { cwe, aiVerdict, critical };
      return point(
        label,
        rule,
        rows,
        cwe === active.cwe && aiVerdict === active.aiVerdict && critical === active.critical,
      );
    });
  }
  return RULE_SUBSETS.map(([label, kev, exploit, epss]) => {
    const rule: RiskRule = { kev, exploit, epss, epssThreshold: active.epssThreshold };
    return point(
      label,
      rule,
      rows,
      kev === active.kev && exploit === active.exploit && epss === active.epss,
    );
  });
}

function point(
  label: string,
  rule: AnyRiskRule,
  rows: RiskRow[],
  active: boolean,
): RuleSensitivityPoint {
  const matrix = confusionMatrix(rows, rule);
  return {
    label,
    rule,
    sentence: ruleSentence(rule),
    active,
    coverage: matrix.coverage.point,
    efficiency: matrix.efficiency.point,
    highRisk: matrix.highRisk,
    unknown: matrix.unknown,
    matrix,
  };
}

// ------------------------------------------------------------------------- capacity

export type CapacityVerdict = "gaining" | "keeping-up" | "falling-behind";

export interface CapacityMonth {
  month: string; // "2026-07"
  openAtStart: number;
  opened: number;
  closed: number;
  /** closed / openAtStart — the month's close rate. Null when nothing was open to close. */
  mmcr: number | null;
  net: number; // closed - opened
  netPct: number | null; // net / openAtStart
  verdict: CapacityVerdict;
  /** The month is not fully observed: it is the current month. */
  partial: boolean;
  /** The month ends before the first observation — see the note on `capacityByMonth`. */
  reconstructed: boolean;
  /** Independent cross-check: the resolutions reconcile itself recorded in this month. */
  scanClosed: number | null;
}

export interface Capacity {
  months: CapacityMonth[];
  /** Mean close rate over COMPLETE, directly-observed months. Null when there are none. */
  mmcrMean: number | null;
  /** "1 in N" phrasing of mmcrMean — the P2P v3 idiom. Null when mmcrMean is null or 0. */
  oneInN: number | null;
  netTotal: number;
  verdict: CapacityVerdict | null;
  monthsCounted: number;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function monthStartMs(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, 1);
}

function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? y! + 1 + "-01" : y! + "-" + String(m! + 1).padStart(2, "0");
}

/**
 * gaining / keeping-up / falling-behind, with a dead band around zero — P2P v3 Fig. 22
 * splits firms three ways without a sharp cut, and a one-finding swing should not flip a
 * monthly verdict.
 */
function verdictOf(netPct: number | null): CapacityVerdict {
  if (netPct === null || Math.abs(netPct) <= NET_CAPACITY_BAND_PCT) return "keeping-up";
  return netPct > 0 ? "gaining" : "falling-behind";
}

export interface CapacityOptions {
  /** Omit to let each row's scope choose (`ruleForScope`). Only read when `highRiskOnly`. */
  rule?: AnyRiskRule;
  /** Restrict to high-risk lifecycles — the P2P v3 "net remediation capacity" population. */
  highRiskOnly?: boolean;
  now?: number;
  /** Cap the number of trailing months returned (most recent last). */
  maxMonths?: number;
  /**
   * The moment the register started being watched. Months entirely before it are
   * `reconstructed`. OMIT to derive it from `scans` (the earliest one); pass `null` for "no
   * horizon", which reads every month as observed. brick's `observed_from`.
   */
  observedFrom?: unknown;
  /**
   * Pre-bucketed resolution counts for the cross-check, keyed by month ("2026-05" or any
   * parseable timestamp inside it). OMIT to derive them from `scans`; pass `null` for none.
   * brick's `closed_observed`.
   */
  closedObserved?: Record<string, number> | null;
}

type CapacityRow = RiskRow & Pick<BaseRow, "first_seen" | "resolved_at">;

/** A scan-log row, as loosely as this module needs to read one. */
type CapacityScan = { ts?: unknown; shape?: unknown; resolved_count?: unknown };

/**
 * Monthly remediation capacity, derived from the durable ledger — NOT from the per-scan
 * `new_count` / `resolved_count` deltas.
 *
 * That choice matters. The scan deltas are whole-register scalars produced by reconcile:
 * they carry no severity, no scope, and crucially no risk label, so the metric P2P actually
 * defines (high-risk closed vs. high-risk opened) cannot be computed from them at all. They
 * are also cadence-dependent — the first scan's `new_count` is the entire register. Bucketing
 * the ledger rows' own `first_seen` / `resolved_at` by UTC calendar month sidesteps scan
 * cadence entirely: months are wall-clock intervals and every row carries wall-clock dates.
 *
 * The deltas survive as `scanClosed`, an independent cross-check the page shows beside the
 * ledger-derived figure — reconcile counted each resolution exactly once, so the two should
 * agree, and where they do not the page says why. The EARLIEST scan is excluded from it: its
 * deltas describe the initial ingest, not a month's remediation work, so including it makes
 * the first month's cross-check wildly exceed the ledger figure and read as a defect.
 *
 * Two honesty flags travel with each month:
 *   - `partial`: the current month, which is not over. Never extrapolated, and excluded
 *     from `mmcrMean` — otherwise the headline dips every time you look early in a month.
 *   - `reconstructed`: months ending before the first observation. `first_seen` can predate
 *     the first scan (Wiz reports `firstDetectedAt`), but disappearance-resolutions are
 *     pinned to the scan that observed them, so closures in that region are systematically
 *     under-counted. Flagged, not dropped: the backlog they describe is real and
 *     `openAtStart` depends on them, but "we closed 40 in March" is not evidence of capacity
 *     when nobody was looking in March.
 *
 * DIVERGENCE from gas/: with NO observation horizon at all, gas/ flags every month
 * `reconstructed`; brick flags none, on the argument that reading every month as observed is
 * "only honest before any scan has been logged" — there is nothing to have missed if nothing
 * was ever watched. brick wins (it is the spec, and capacity.json's `by_month_no_horizon`
 * case pins it). Where a scan log IS present the two definitions are algebraically identical:
 * gas/'s `end <= firstScan` and brick's `month < trunc(observedFrom)` select the same months.
 */
export function capacityByMonth(
  rows: CapacityRow[],
  scans: CapacityScan[],
  options: CapacityOptions = {},
): Capacity {
  const nowMs = options.now ?? Date.now();

  const parsed: { first: number; resolved: number | null }[] = [];
  for (const row of rows) {
    if (options.highRiskOnly && classifyRisk(row, options.rule) !== "high") continue;
    const first = parseTs(row.first_seen);
    if (first === null) continue;
    parsed.push({ first, resolved: parseTs(row.resolved_at) });
  }

  // `shape` is gas/'s flat-vs-grouped distinction. This register's scan log carries no such
  // column (every scope's fetch is a flat per-finding scan — ledgerTypes.ts), so the filter
  // is a no-op here and is kept only so a gas-shaped scan log reads identically.
  const scanMs = scans
    .filter((s) => s["shape"] !== "grouped")
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null);
  const firstScanMs = scanMs.length ? minNum(scanMs) : null;

  const observedFromMs =
    options.observedFrom !== undefined ? parseTs(options.observedFrom) : firstScanMs;
  const observedMonth = observedFromMs === null ? null : monthKey(observedFromMs);

  const scanClosedByMonth: Record<string, number> = {};
  if (options.closedObserved !== undefined) {
    for (const [k, v] of Object.entries(options.closedObserved ?? {})) {
      const t = parseTs(k);
      const key = t === null ? k : monthKey(t);
      scanClosedByMonth[key] = (scanClosedByMonth[key] ?? 0) + Number(v ?? 0);
    }
  } else {
    for (const s of scans) {
      if (s["shape"] === "grouped") continue;
      const t = parseTs(s["ts"]);
      if (t === null) continue;
      if (firstScanMs !== null && t === firstScanMs) continue;
      const k = monthKey(t);
      scanClosedByMonth[k] = (scanClosedByMonth[k] ?? 0) + Number(s["resolved_count"] ?? 0);
    }
  }

  if (!parsed.length) {
    return { months: [], mmcrMean: null, oneInN: null, netTotal: 0, verdict: null, monthsCounted: 0 };
  }

  // minNum, not Math.min(...): `parsed` holds one entry per finding, so the spread/apply
  // forms overflow the call stack on a large register (see util.maxNum).
  const earliest = minNum(parsed.map((p) => p.first));
  const months: CapacityMonth[] = [];
  const lastKey = monthKey(nowMs);
  for (let key = monthKey(earliest); ; key = nextMonthKey(key)) {
    const start = monthStartMs(key);
    const end = monthStartMs(nextMonthKey(key));
    let openAtStart = 0;
    let opened = 0;
    let closed = 0;
    for (const p of parsed) {
      if (p.first < start && (p.resolved === null || p.resolved >= start)) openAtStart += 1;
      if (p.first >= start && p.first < end) opened += 1;
      if (p.resolved !== null && p.resolved >= start && p.resolved < end) closed += 1;
    }
    const netPct = openAtStart > 0 ? ((closed - opened) / openAtStart) * 100 : null;
    months.push({
      month: key,
      openAtStart,
      opened,
      closed,
      mmcr: openAtStart > 0 ? (closed / openAtStart) * 100 : null,
      net: closed - opened,
      netPct,
      verdict: verdictOf(netPct),
      // The first month is partial only in the sense that the register begins mid-month; it
      // still fully observes its own closures, so only the current month is excluded.
      partial: key === lastKey,
      reconstructed: observedMonth !== null && key < observedMonth,
      scanClosed: scanClosedByMonth[key] ?? null,
    });
    if (key === lastKey) break;
    // Guard against a corrupt future-dated row spinning this loop.
    if (months.length > 600) break;
  }

  // Reconstructed months are excluded alongside partial ones, and for the same reason: the
  // headline "we close about 1 in N" is a claim about throughput we MEASURED. On a young
  // register this can leave few months standing, or none — which is why `monthsCounted` is
  // published beside it. A small honest sample beats a large confident one.
  const counted = months.filter((m) => !m.partial && !m.reconstructed && m.mmcr !== null);
  const mmcrMean = counted.length
    ? counted.reduce((a, m) => a + (m.mmcr as number), 0) / counted.length
    : null;
  const netTotal = months.reduce((a, m) => a + m.net, 0);
  const netPctOverall = counted.length
    ? counted.reduce((a, m) => a + (m.netPct ?? 0), 0) / counted.length
    : null;

  const trimmed =
    options.maxMonths !== undefined && months.length > options.maxMonths
      ? months.slice(months.length - options.maxMonths)
      : months;

  return {
    months: trimmed,
    mmcrMean,
    oneInN: mmcrMean !== null && mmcrMean > 0 ? 100 / mmcrMean : null,
    netTotal,
    verdict: counted.length ? verdictOf(netPctOverall) : null,
    monthsCounted: counted.length,
  };
}

export interface CapacityPopulations {
  all: Capacity;
  highRisk: Capacity;
}

/**
 * `capacityByMonth` over both populations. brick's `capacity_populations`.
 *
 * P2P v3 defines net remediation capacity over the **high-risk** population; this register
 * publishes both, because "how much of the backlog moves" and "are we closing high risk
 * faster than it arrives" routinely disagree and which one was meant is not recoverable from
 * a single unlabelled number.
 *
 * Two things are deliberately NOT shared between the halves:
 *   - **`scanClosed` is attached to `all` only.** It is reconcile's own resolution count, and
 *     reconcile does not label risk — against the high-risk rows it would be a cross-check
 *     between two different populations, which is worse than no cross-check at all.
 *   - **The month grid is built per population**, from that population's own earliest
 *     `first_seen`. A register whose first high-risk finding arrived a year after its first
 *     finding has a shorter high-risk series, which is the honest shape.
 */
export function capacityPopulations(
  rows: CapacityRow[],
  scans: CapacityScan[],
  options: CapacityOptions = {},
): CapacityPopulations {
  return {
    all: capacityByMonth(rows, scans, { ...options, highRiskOnly: false }),
    highRisk: capacityByMonth(rows, scans, {
      ...options,
      highRiskOnly: true,
      closedObserved: null,
    }),
  };
}

/** Age in days of the register's observation window — context for the capacity table. */
export function observationWindowDays(
  rows: Pick<BaseRow, "first_seen">[],
  now?: number,
): number | null {
  const nowMs = now ?? Date.now();
  const firsts = rows.map((r) => parseTs(r.first_seen)).filter((t): t is number => t !== null);
  if (!firsts.length) return null;
  return (nowMs - minNum(firsts)) / DAY_MS;
}
