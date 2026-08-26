// Remediation program performance: coverage, efficiency, and capacity — the metric family
// from the Cisco Kenna / Cyentia "Prioritization to Prediction" (P2P) research series.
//
// MTTR and SLA answer "how fast are we closing risk". These answer the other half: "are we
// closing the RIGHT risk", and "can we close it faster than it arrives".
//
//   Coverage   (P2P v1; restated v2 p.13, v4 p.5, v5 p.13, vol. 9 p.22)
//              Completeness / recall. Of all HIGH-RISK vulnerabilities, what share did we
//              remediate?  TP / (TP + FN).
//   Efficiency (P2P v2 p.13)
//              Precision. Of everything we remediated, what share was actually high-risk?
//              TP / (TP + FP).  The rest is effort that "may have been more productive
//              elsewhere".
//   Capacity   (P2P v3 "Lessons in Remediation Capacity", v4 p.7)
//              Mean Monthly Close Rate — the share of the open backlog closed per month
//              (the series' headline finding: a typical org closes about 1 in 10, regardless of size)
//              — and net capacity, high-risk closed vs. opened, giving the v3 Fig. 22
//              verdict: gaining ground / keeping up / falling behind.
//
// The two rates are in direct tension and are meaningless apart: v2's industry baseline is
// 70% coverage at 18.5% efficiency, and v4 found most firms never cross 50% efficiency. The
// UI must always show them as a pair.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued). Pure
// functions over ledger base rows, in the style of remediation.ts: a narrow Pick<BaseRow>
// projection, and `null` rather than a fake 0 whenever a denominator is empty.
//
// ---------------------------------------------------------------------------------------
// THE CORRECTNESS TRAP, stated once because everything here is shaped by it:
// **unknown is not the same as not-high-risk.** A finding whose exploit signal was never
// captured must never be counted as low risk — that single mistake inflates efficiency's
// denominator and deflates coverage's numerator simultaneously, and it does so silently.
// So unclassified rows leave BOTH sides of every rate, are counted in their own matrix row,
// and drive the published bounds (see `Rate`) whose width IS the size of the doubt.
// ---------------------------------------------------------------------------------------

import { EPSS_PRIORITY_THRESHOLD, RESOLVED_STATUSES, SEVERITY_ORDER } from "./config";
import type { BaseRow } from "./ledgerCore";
import { normalizeSeverity } from "./severity";
import { minNum, parseTs } from "./util";

const DAY_MS = 86_400_000;

/** Same open/resolved test the rest of the domain uses (remediation.isOpen, insights.isOpen). */
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

// --------------------------------------------------------------------------- the rule

/**
 * The high-risk classifier: an **any-of** rule over the exploit signals Wiz attaches to a
 * finding. P2P vol. 9 (pp. 22-24) is the reason it is any-of rather than a single source —
 * CISA KEV alone covers only ~19% of what is actually exploited in the wild, and the
 * best-performing strategies fire when a CVE shows up in ANY of several sources.
 *
 * Operator-configurable (persisted as a versioned blob; see settingsLogic.getRiskRule),
 * because a rule you cannot inspect or change is a rule you cannot audit.
 */
export interface RiskRule {
  kev: boolean; // listed in the CISA KEV catalog
  exploit: boolean; // a known exploit exists
  epss: boolean; // EPSS probability at or above the threshold
  epssThreshold: number;
}

export const DEFAULT_RISK_RULE: RiskRule = {
  kev: true,
  exploit: true,
  epss: true,
  epssThreshold: EPSS_PRIORITY_THRESHOLD,
};

/** True when the rule enables no signal at all — nothing is decidable, so everything is unknown. */
export function ruleIsEmpty(rule: RiskRule): boolean {
  return !rule.kev && !rule.exploit && !rule.epss;
}

/**
 * The rule as a sentence, for the page and the CSV header — the classifier has to be legible
 * to a reader who never opens Settings. E.g. "CISA KEV or public exploit or EPSS >= 0.10".
 */
export function ruleSentence(rule: RiskRule): string {
  const parts: string[] = [];
  if (rule.kev) parts.push("CISA KEV");
  if (rule.exploit) parts.push("public exploit");
  if (rule.epss) parts.push("EPSS >= " + rule.epssThreshold.toFixed(2));
  return parts.length ? parts.join(" or ") : "no signal enabled";
}

// ------------------------------------------------------------------- classification

/** The three-valued verdict. `unknown` is a first-class outcome, never folded into `low`. */
export type RiskClass = "high" | "low" | "unknown";

export type RiskRow = Pick<
  BaseRow,
  "severity" | "status" | "has_kev" | "has_exploit" | "epss"
>;

/** Whether an enabled signal was actually observed on this row (null = never captured). */
function seen(row: RiskRow, rule: RiskRule): { kev: boolean; exploit: boolean; epss: boolean } {
  return {
    kev: !rule.kev || row.has_kev != null,
    exploit: !rule.exploit || row.has_exploit != null,
    epss: !rule.epss || (typeof row.epss === "number" && Number.isFinite(row.epss)),
  };
}

/**
 * Which enabled clauses fired — drives the per-signal counts on the classifier card and the
 * "why is this high risk" line in the drill-down. Empty for `low` and `unknown` rows.
 */
export function firedSignals(row: RiskRow, rule: RiskRule): ("kev" | "exploit" | "epss")[] {
  const out: ("kev" | "exploit" | "epss")[] = [];
  if (rule.kev && row.has_kev === true) out.push("kev");
  if (rule.exploit && row.has_exploit === true) out.push("exploit");
  if (
    rule.epss &&
    typeof row.epss === "number" &&
    Number.isFinite(row.epss) &&
    row.epss >= rule.epssThreshold
  ) {
    out.push("epss");
  }
  return out;
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
 * Step 2 is the one that is easy to get wrong. A rule with EPSS enabled, applied to a row
 * whose EPSS was never captured and whose KEV/exploit flags are both an observed false, is
 * **unknown** — not low. Treating it as low is precisely how a naive implementation quietly
 * over-states efficiency.
 *
 * A rule with no signals enabled decides nothing, so every row is `unknown` and the page
 * reads "no classifier enabled — 100% unclassified". That is deliberate: honest state beats
 * a hidden fallback to the default rule.
 */
export function classifyRisk(row: RiskRow, rule: RiskRule): RiskClass {
  if (ruleIsEmpty(rule)) return "unknown";
  if (firedSignals(row, rule).length) return "high";
  const s = seen(row, rule);
  if (!s.kev || !s.exploit || !s.epss) return "unknown";
  return "low";
}

// ------------------------------------------------------------------------ risk tiers

/**
 * The OS-vulnerabilities page's spine. `classifyRisk` answers high/low/unknown, which is what
 * the coverage and efficiency rates need; a triage view needs to know WHICH signal fired,
 * because "on the CISA KEV catalog" and "EPSS crossed 10%" are not the same day's work.
 *
 * So this is a REFINEMENT of `classifyRisk`, never a second opinion — it splits `high` into
 * its three causes in severity-of-evidence order and passes `low` / `unknown` straight
 * through. The identity holds by construction and is pinned in test/program.test.ts:
 *
 *     kev + exploit + epss === (rows classified "high")
 *     none                 === (rows classified "low")
 *     unknown              === (rows classified "unknown")
 *
 * That matters because both pages render an unclassified count over the same fleet. Two
 * classifiers would eventually disagree, and the reader would have no way to tell which one
 * was lying.
 */
export type RiskTier = "kev" | "exploit" | "epss" | "none" | "unknown";

/** Worst evidence first; `unknown` last because it is a measurement gap, not a low score. */
export const RISK_TIER_ORDER: RiskTier[] = ["kev", "exploit", "epss", "none", "unknown"];

/** Display labels. The tier is named by what is KNOWN, never by a severity word. */
export const RISK_TIER_LABELS: Record<RiskTier, string> = {
  kev: "Known exploited",
  exploit: "Public exploit",
  epss: "Likely exploited",
  none: "No known exploit",
  unknown: "Unclassified",
};

/**
 * Which tier a row lands in. A row can fire several clauses at once (a KEV entry usually also
 * has a public exploit); the tier takes the strongest, so the tiers partition the population
 * rather than overlapping the way `exploitSummary`'s counts deliberately do.
 */
export function riskTier(row: RiskRow, rule: RiskRule): RiskTier {
  const cls = classifyRisk(row, rule);
  if (cls !== "high") return cls === "low" ? "none" : "unknown";
  const fired = firedSignals(row, rule);
  if (fired.includes("kev")) return "kev";
  if (fired.includes("exploit")) return "exploit";
  return "epss";
}

// ------------------------------------------------------------------ confusion matrix

/**
 * A rate with the bounds the unclassified population implies.
 *
 * `point` is the rate over classified rows only. `lo` / `hi` are what the rate would be if
 * every unclassified row turned out to be the worst / best case for that rate. When nothing
 * is unclassified, lo === point === hi and the UI renders a bare number; otherwise the width
 * of the bracket **is** the size of the doubt, which makes the missing data impossible to
 * hide behind a confident-looking figure.
 */
export interface Rate {
  point: number | null;
  lo: number | null;
  hi: number | null;
}

const NO_RATE: Rate = { point: null, lo: null, hi: null };

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
function tally(m: ConfusionMatrix, row: RiskRow, rule: RiskRule): void {
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
 * slightly soft notion of remediated and the methodology copy says so.
 */
export function confusionMatrix(rows: RiskRow[], rule: RiskRule): ConfusionMatrix {
  const m = emptyMatrix();
  for (const row of rows) tally(m, row, rule);
  return finalize(m);
}

/**
 * Per-severity matrices plus the overall one — the {perSev, overall} shape
 * remediation.openPastSla uses. Keyed by normalized severity; only severities actually
 * present get a key, and they are emitted in SEVERITY_ORDER (UNKNOWN included).
 */
export function confusionBySeverity(
  rows: RiskRow[],
  rule: RiskRule,
): { perSev: Record<string, ConfusionMatrix>; overall: ConfusionMatrix } {
  const bySev: Record<string, ConfusionMatrix> = {};
  const overall = emptyMatrix();
  for (const row of rows) {
    const s = normalizeSeverity(row.severity);
    const m = bySev[s] ?? (bySev[s] = emptyMatrix());
    tally(m, row, rule);
    tally(overall, row, rule);
  }
  const perSev: Record<string, ConfusionMatrix> = {};
  for (const s of SEVERITY_ORDER) if (bySev[s]) perSev[s] = finalize(bySev[s]);
  return { perSev, overall: finalize(overall) };
}

export interface SignalBreakdown {
  kev: number;
  exploit: number;
  epss: number;
  anyOf: number;
  /** Rows where the signal was never captured, per signal — the shape of the gap. */
  kevMissing: number;
  exploitMissing: number;
  epssMissing: number;
}

/**
 * How many rows each enabled clause fires on. The clauses are OR'd, so a row can be counted
 * under several and these do NOT sum to `anyOf` — the UI must say so rather than presenting
 * them as a partition. Disabled clauses report 0 fired and 0 missing (they decide nothing).
 */
export function signalBreakdown(rows: RiskRow[], rule: RiskRule): SignalBreakdown {
  const out: SignalBreakdown = {
    kev: 0, exploit: 0, epss: 0, anyOf: 0,
    kevMissing: 0, exploitMissing: 0, epssMissing: 0,
  };
  for (const row of rows) {
    const fired = firedSignals(row, rule);
    if (fired.length) out.anyOf += 1;
    for (const f of fired) out[f] += 1;
    if (rule.kev && row.has_kev == null) out.kevMissing += 1;
    if (rule.exploit && row.has_exploit == null) out.exploitMissing += 1;
    if (rule.epss && !(typeof row.epss === "number" && Number.isFinite(row.epss))) {
      out.epssMissing += 1;
    }
  }
  return out;
}

export interface RuleSensitivityPoint {
  label: string;
  rule: RiskRule;
  active: boolean;
  coverage: number | null;
  efficiency: number | null;
  highRisk: number;
  unknown: number;
}

/**
 * Coverage and efficiency under each of the seven non-empty signal subsets, with the active
 * rule marked — the data behind the coverage-vs-efficiency scatter.
 *
 * Deliberately NOT a reproduction of P2P vol. 9's Figure 19. That figure plots candidate
 * remediation strategies against an INDEPENDENT ground truth (observed exploitation in the
 * wild); we have no such ground truth, only these same signals. What this answers instead is
 * a question the reader genuinely needs: **how much does the headline depend on which
 * signals I turned on?** Label it "rule sensitivity" on the page, not "strategy comparison".
 */
export function ruleSensitivity(rows: RiskRow[], active: RiskRule): RuleSensitivityPoint[] {
  const subsets: { label: string; kev: boolean; exploit: boolean; epss: boolean }[] = [
    { label: "KEV", kev: true, exploit: false, epss: false },
    { label: "Exploit", kev: false, exploit: true, epss: false },
    { label: "EPSS", kev: false, exploit: false, epss: true },
    { label: "KEV or exploit", kev: true, exploit: true, epss: false },
    { label: "KEV or EPSS", kev: true, exploit: false, epss: true },
    { label: "Exploit or EPSS", kev: false, exploit: true, epss: true },
    { label: "All three", kev: true, exploit: true, epss: true },
  ];
  return subsets.map((s) => {
    const rule: RiskRule = { ...s, epssThreshold: active.epssThreshold };
    const m = confusionMatrix(rows, rule);
    return {
      label: s.label,
      rule,
      active:
        rule.kev === active.kev && rule.exploit === active.exploit && rule.epss === active.epss,
      coverage: m.coverage.point,
      efficiency: m.efficiency.point,
      highRisk: m.highRisk,
      unknown: m.unknown,
    };
  });
}

// ------------------------------------------------------------------------- capacity

export type CapacityVerdict = "gaining" | "keeping-up" | "falling-behind";

/**
 * The dead band around zero net flow that counts as "keeping up" — P2P v3 Fig. 22 splits
 * firms into falling behind / maintaining / gaining ground without a sharp cut, and a
 * one-finding swing should not flip a monthly verdict.
 */
export const NET_CAPACITY_BAND_PCT = 2;

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
  /** The month is not fully observed: it is the current month, or it precedes first_seen. */
  partial: boolean;
  /** The month ends before the first saved flat scan — see the note on `capacityByMonth`. */
  reconstructed: boolean;
  /** Independent cross-check: the reconcile deltas of the scans that landed in this month. */
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
  return Date.UTC(y, m - 1, 1);
}

function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? y + 1 + "-01" : y + "-" + String(m + 1).padStart(2, "0");
}

function verdictOf(netPct: number | null): CapacityVerdict {
  if (netPct === null || Math.abs(netPct) <= NET_CAPACITY_BAND_PCT) return "keeping-up";
  return netPct > 0 ? "gaining" : "falling-behind";
}

export interface CapacityOptions {
  rule: RiskRule;
  /** Restrict to high-risk lifecycles — the P2P v3 "net remediation capacity" population. */
  highRiskOnly?: boolean;
  now?: number;
  /** Cap the number of trailing months returned (most recent last). */
  maxMonths?: number;
}

type CapacityRow = RiskRow & Pick<BaseRow, "first_seen" | "resolved_at">;

/**
 * Monthly remediation capacity, derived from the durable base — NOT from the per-scan
 * `new_count` / `resolved_count` deltas.
 *
 * That choice matters. The scan deltas are whole-register scalars produced by reconcile:
 * they carry no severity, no domain, and crucially no risk label, so the metric P2P actually
 * defines (high-risk closed vs. high-risk opened) cannot be computed from them at all. They
 * are also cadence-dependent — the first scan's `new_count` is the entire register, grouped
 * scans contribute zeros, and a severity-scoped scan yields scope-limited deltas. Bucketing
 * the base rows' own `first_seen` / `resolved_at` by UTC calendar month sidesteps scan
 * cadence entirely: months are wall-clock intervals and every row carries wall-clock dates.
 *
 * The deltas survive as `scanClosed`, an independent cross-check the page shows beside the
 * ledger-derived figure — reconcile counted each resolution exactly once, so the two should
 * agree, and where they do not the page says why.
 *
 * Two honesty flags travel with each month:
 *   - `partial`: the current month, which is not over. Never extrapolated, and excluded
 *     from `mmcrMean` — otherwise the headline dips every time you look early in a month.
 *   - `reconstructed`: months ending before the first saved flat scan. `first_seen` can
 *     predate the first scan (Wiz reports `firstDetectedAt`), but disappearance-resolutions
 *     are pinned to the scan that observed them, so closures in that region are systematically
 *     under-counted. This is the same caveat trend.trendFromBase documents for its backfill.
 */
export function capacityByMonth(
  rows: CapacityRow[],
  scans: { ts?: unknown; shape?: unknown; resolved_count?: unknown }[],
  options: CapacityOptions,
): Capacity {
  const nowMs = options.now ?? Date.now();
  const rule = options.rule;

  const parsed: { first: number; resolved: number | null }[] = [];
  for (const row of rows) {
    if (options.highRiskOnly && classifyRisk(row, rule) !== "high") continue;
    const first = parseTs(row.first_seen);
    if (first === null) continue;
    parsed.push({ first, resolved: parseTs(row.resolved_at) });
  }

  const flatScanMs = scans
    .filter((s) => s["shape"] !== "grouped")
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null);
  const firstScanMs = flatScanMs.length ? minNum(flatScanMs) : null;

  // Closures reported by reconcile, bucketed the same way — the independent cross-check.
  //
  // The EARLIEST flat scan is excluded. Its deltas describe the initial ingest, not a month's
  // remediation work: every finding the API already reported as resolved is counted as a
  // resolution by that first reconcile, however long ago it was actually fixed. Including it
  // would make the first month's cross-check wildly exceed the ledger figure and read as a
  // defect in the ledger rather than what it is — a different question being answered.
  const scanClosedByMonth: Record<string, number> = {};
  for (const s of scans) {
    if (s["shape"] === "grouped") continue;
    const t = parseTs(s["ts"]);
    if (t === null) continue;
    if (firstScanMs !== null && t === firstScanMs) continue;
    const k = monthKey(t);
    scanClosedByMonth[k] = (scanClosedByMonth[k] ?? 0) + Number(s["resolved_count"] ?? 0);
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
      reconstructed: firstScanMs === null || end <= firstScanMs,
      scanClosed: scanClosedByMonth[key] ?? null,
    });
    if (key === lastKey) break;
    // Guard against a corrupt future-dated row spinning this loop.
    if (months.length > 600) break;
  }

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

/** Age in days of the register's observation window — context for the capacity table. */
export function observationWindowDays(rows: Pick<BaseRow, "first_seen">[], now?: number): number | null {
  const nowMs = now ?? Date.now();
  const firsts = rows.map((r) => parseTs(r.first_seen)).filter((t): t is number => t !== null);
  if (!firsts.length) return null;
  return (nowMs - minNum(firsts)) / DAY_MS;
}
