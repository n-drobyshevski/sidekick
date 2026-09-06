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

import { parseSeverities } from "./compaction";
import { EPSS_PRIORITY_THRESHOLD, RESOLVED_STATUSES, SEVERITY_ORDER } from "./config";
import type { BaseRow } from "./ledgerCore";
import { normalizeSeverity } from "./severity";
import { minNum, parseTs, toIso } from "./util";

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

/**
 * A lifecycle row for the capacity metrics.
 *
 * The two dates are read ONLY through `parseTs`, which takes an epoch-millisecond number as
 * readily as an ISO string, so the number form is spelled in the type rather than left as an
 * undocumented capability. `capacityHindcast` relies on it: it parses the register once and
 * replays the parsed form, which is the difference between 636 ms and 149 ms on a 20k-row
 * register (see the note there).
 */
type CapacityRow = RiskRow & {
  first_seen: string | number | null;
  resolved_at: string | number | null;
};

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

// --------------------------------------------------------------------- hindcast

/**
 * One past scan, the verdict the page WOULD have shown that day, and what the next full
 * calendar month actually did.
 *
 * `agreed` is three-valued on purpose: `null` is "nobody could check this one" (no verdict
 * that day, or no observed net for the month after), and it is NEVER `false`. False here
 * would read as a verdict that was checked and missed, which is the one claim an
 * unobservable row cannot support.
 */
export interface HindcastRow {
  asOf: string;
  verdict: CapacityVerdict | null;
  realisedNetPct: number | null;
  agreed: boolean | null;
}

export interface Hindcast {
  rows: HindcastRow[];
  /** Rows where both sides were observable — the denominator of every sentence about this. */
  comparable: number;
  /** "Falling behind" followed by a real gain. The cases the verdict got backwards. */
  counterperformative: number;
  /** As-of points actually replayed — flat, parseable, capped. NOT the cap itself. */
  scansConsidered: number;
  /** The cap in force, so a caller can tell "only 3 scans exist" from "only 3 were read". */
  scansCap: number;
}

/** Default number of trailing flat scans replayed. See `capacityHindcast`. */
const HINDCAST_SCANS_CAP = 24;

/**
 * The register AS IT STOOD on `asOfMs`: rows born by then, with a resolution dated after
 * then read back as still open.
 *
 * A NAMED SEAM RATHER THAN FOUR LINES INSIDE THE LOOP, because this is the one refusal the
 * hindcast turns on and it has to be directly testable. Measured, and the measurement is the
 * reason the export exists: within `capacityByMonth(…, { now: asOfMs })` this masking changes
 * NOTHING today. That function never scores the month containing `now` (`partial: key ===
 * lastKey`, and `counted` drops partial months), and no earlier month can see a resolution
 * dated after `asOfMs` — every such row is already "open at start" of every month it builds.
 * So the arithmetic absorbs the difference, and a perturbation applied to the hindcast's
 * headline numbers fails nothing. It stays, and it is tested HERE where it does bite, for
 * two reasons: the row set handed to the verdict rule should be true rather than
 * incidentally harmless, and the absorption is a property of another function's
 * partial-month rule — one edit there and the hindcast would quietly start scoring verdicts
 * against closures that had not happened yet.
 *
 * Both tests are against a PARSED timestamp, never a cast. `parseTs` returns null for blank,
 * garbage and `[]` alike, and a row whose `first_seen` will not parse is dropped rather than
 * dated 1970 — the same refusal `capacityByMonth` makes on the same field.
 */
export function capacityRowsAsOf<T extends { first_seen: unknown; resolved_at: unknown }>(
  rows: T[],
  asOfMs: number,
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const first = parseTs(row.first_seen);
    if (first === null || first > asOfMs) continue;
    const resolved = parseTs(row.resolved_at);
    // Copied only when it needs masking: on a large register this loop runs once per scan.
    out.push(resolved !== null && resolved > asOfMs ? { ...row, resolved_at: null } : row);
  }
  return out;
}

/**
 * REPLAY THE CAPACITY VERDICT AGAINST WHAT HAPPENED NEXT.
 *
 * The verdict is read by the people whose behaviour it describes, so the one thing it owes
 * them is a track record. For each past scan this recomputes `capacityByMonth`'s own verdict
 * from the rows AS THEY STOOD THAT DAY, and pairs it with the observed net capacity of the
 * following calendar month. No schema change: every input is already in the ledger.
 *
 * THE MONTH THAT IS SCORED IS THE ONE AFTER THE SCAN'S OWN MONTH. A scan on 2 February sits
 * inside February, whose outcome is already half spent by the time the verdict is read; the
 * first month the verdict could still have moved is March. A scan only earns a row once that
 * month is OVER within the same horizon `capacityByMonth` uses — the month in progress is
 * not an outcome.
 *
 * The verdict rule itself is not restated here. `capacityByMonth(…, { now: ts })` IS the
 * rule, called with the register as of that day and the scans that existed then, and
 * `verdictOf` grades the realised month — so a change to the band or to what counts as a
 * complete month moves the hindcast with the page instead of leaving a second copy behind.
 *
 * Grouped scans are not as-of points (they carry no per-finding rows — the same exclusion
 * `capacityByMonth` makes), and a scan whose `ts` will not parse is skipped rather than
 * placed at epoch 0, where it would replay the whole register against 1970.
 */
export function capacityHindcast(
  rows: CapacityRow[],
  scans: { ts?: unknown; shape?: unknown; resolved_count?: unknown }[],
  options: CapacityOptions & { scansCap?: number },
): Hindcast {
  const cap = options.scansCap ?? HINDCAST_SCANS_CAP;
  const horizonMs = options.now ?? Date.now();

  // Grouped and unparseable scans are dropped BEFORE the cap, so the cap counts as-of points
  // rather than rows that could never be one.
  const asOfMs = scans
    .filter((s) => s["shape"] !== "grouped")
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null)
    .sort((a, b) => b - a)
    .slice(0, cap);

  // PARSED ONCE, then replayed. Every date below is read through `parseTs`, which returns a
  // number straight back, so this turns 24 x 40,000 string parses into 40,000 — measured
  // 636 ms -> 149 ms on a 20k-row register at cap 24, and Date.parse WAS the whole cost
  // (capacityRowsAsOf 270 ms -> 31 ms, capacityByMonth 333 ms -> 88 ms). Semantically a
  // no-op: a date that will not parse becomes the same null `capacityByMonth` would have
  // derived from it, and is dropped for the same reason.
  const dated: CapacityRow[] = rows.map((r) => ({
    ...r,
    first_seen: parseTs(r.first_seen),
    resolved_at: parseTs(r.resolved_at),
  }));

  // The realised series, computed ONCE over the whole register. `maxMonths` is dropped: it is
  // the table's display trim, and trimming here would drop the outcome months of the oldest
  // scans for a presentation reason.
  const realised = capacityByMonth(dated, scans, { ...options, maxMonths: undefined });
  const netByMonth: Record<string, number | null> = {};
  for (const m of realised.months) netByMonth[m.month] = m.netPct;

  const out: HindcastRow[] = [];
  for (const ts of asOfMs) {
    const followKey = nextMonthKey(monthKey(ts));
    if (monthStartMs(nextMonthKey(followKey)) > horizonMs) continue;

    const scansUpTo = scans.filter((s) => {
      const t = parseTs(s["ts"]);
      return t !== null && t <= ts;
    });
    const verdict = capacityByMonth(capacityRowsAsOf(dated, ts), scansUpTo, {
      ...options,
      now: ts,
      maxMonths: undefined,
    }).verdict;

    // A follow month is never `reconstructed`: it ends after `ts`, and `ts` is itself a flat
    // scan, so the earliest flat scan precedes it. Nothing to exclude on that count.
    const realisedNetPct = netByMonth[followKey] ?? null;
    out.push({
      // Finite by construction — `parseTs` refused everything that was not a real timestamp.
      asOf: toIso(ts) as string,
      verdict,
      realisedNetPct,
      agreed: agreedWith(verdict, realisedNetPct),
    });
  }

  return {
    rows: out,
    comparable: out.filter((r) => r.agreed !== null).length,
    // "Falling behind" and then the ground was GAINED — graded by the same `verdictOf` the
    // page's own pill uses, so "a gain" cannot mean one thing here and another there.
    counterperformative: out.filter(
      (r) => r.verdict === "falling-behind" && r.realisedNetPct !== null
        && verdictOf(r.realisedNetPct) === "gaining",
    ).length,
    scansConsidered: asOfMs.length,
    scansCap: cap,
  };
}

/**
 * Did the month land where the verdict said it would?
 *
 * `verdictOf` IS the rule — the same function `capacityByMonth` grades its own months with,
 * applied to the realised net. Restating the three band comparisons here would be a second
 * copy of `NET_CAPACITY_BAND_PCT`, free to drift from the one on screen.
 *
 * Null when either side is unobservable, and never false. The null check has to come FIRST:
 * `verdictOf(null)` answers "keeping-up", so grading an unmeasured month through it would
 * score a month nobody observed as a verdict that was checked and either kept or missed.
 */
function agreedWith(verdict: CapacityVerdict | null, netPct: number | null): boolean | null {
  if (verdict === null || netPct === null) return null;
  return verdictOf(netPct) === verdict;
}

/** Age in days of the register's observation window — context for the capacity table. */
export function observationWindowDays(rows: Pick<BaseRow, "first_seen">[], now?: number): number | null {
  const nowMs = now ?? Date.now();
  const firsts = rows.map((r) => parseTs(r.first_seen)).filter((t): t is number => t !== null);
  if (!firsts.length) return null;
  return (nowMs - minNum(firsts)) / DAY_MS;
}

// ----------------------------------------------------------------------- movement

/**
 * WHAT MOVED THE OPEN COUNT, and which half of it was work.
 *
 * PRODUCT.md principle 6 — "the representation is not the work" — has a specific failure in
 * mind here. The open count can fall for two completely different reasons: findings were
 * fixed, or the register stopped looking at them. A scan whose severity gate narrowed from
 * CRITICAL/HIGH/MEDIUM to CRITICAL/HIGH sheds every MEDIUM finding at once, and the headline
 * improves exactly as it would after a remediation wave. Nothing on a trend line distinguishes
 * the two. So this decomposes the change over a window into its named causes and LABELS them:
 *
 *   measured        `observed`  — the API itself said the finding was resolved.
 *   administrative  `bounded`   — the finding stopped appearing and was dated by the scan that
 *                                 first missed it. An upper bound on the death date, not a
 *                                 measurement of one (CLAUDE.md: "a death date is not always a
 *                                 measurement"). It is the honest half of a remediation figure
 *                                 to report separately, because a withdrawn population, a
 *                                 renamed asset and a real fix all look like this.
 *
 * `outsideGate` IS REPORTED BESIDE THEM AND NEVER SUMMED IN, and that is the one arithmetic
 * decision in this file worth arguing about. It is a STOCK — how many open findings currently
 * sit outside the gate the last scan applied — not a FLOW over the window. Adding it to
 * `administrative` would double-count every one of those rows on every subsequent window
 * (they stay outside the gate until someone widens it), and would make `administrative +
 * measured` stop reconciling with the identity below. The gate exclusion is a fact about what
 * the last scan COULD have seen; the flows are facts about what it DID see.
 *
 * THE IDENTITY, AND WHY THE RESIDUAL IS PUBLISHED RATHER THAN ABSORBED:
 *
 *     netChange  ==  arrivals - observed - bounded + reopened
 *
 * The left side is replayed from the durable rows (`first_seen` / `resolved_at`); the right
 * side is read off the scan rows reconcile wrote plus the rows' own resolution provenance.
 * They are two independent measurements of the same movement, and in live data they will not
 * always agree — `new_count` counts findings NEW TO A SCAN while the replay counts findings
 * BORN in the window, and Wiz's `firstDetectedAt` can predate the scan that first saw it; a
 * reopen clears `resolved_at` and resets `first_seen`, so a reopened finding leaves the replay
 * looking like an arrival. Each of those is a real gap between two real numbers. `identityGap`
 * publishes it. Tuning it to zero — by deriving one side from the other, or by folding the
 * residual into a bucket — would produce books that always balance and never measure anything.
 *
 * WHAT IS REFUSED RATHER THAN CAST (CLAUDE.md: `Number(null)` is 0, and it is finite):
 *   - a scan whose `ts` will not parse is in no window at all       -> `skippedScans`
 *   - a `new_count` / `reopened_count` that is not a finite number contributes NOTHING and is
 *     counted, so a half-measured window cannot print a confident total -> `partialCounts`
 *   - a row whose `first_seen` will not parse cannot be replayed    -> `unplacedRows`
 *   - a resolved row whose `resolution_src` is neither "api" nor "disappeared" is neither
 *     measured nor administrative                                   -> `unattributed`
 * Every one of those also widens `identityGap`, which is the point: the gap is where the
 * unmeasurable part of the window shows up.
 */
export interface Movement {
  /** Sum of `new_count` over the FLAT scans in the window. Grouped scans carry no findings. */
  arrivals: number;
  /** Resolutions the API itself reported, dated in the window. Measured remediation. */
  observed: number;
  /** Resolutions dated by disappearance. An upper bound on the date; administrative. */
  bounded: number;
  /** Sum of `reopened_count` over the same scans — risk that came back. */
  reopened: number;
  /**
   * OPEN rows whose severity is not in the gate the newest in-window scan applied. A STOCK,
   * not a flow: reported beside the movement, never added to it. 0 when that scan carried no
   * gate — "no gate" means every severity was in scope, never "everything is outside".
   */
  outsideGate: number;
  /** Replayed from the rows: open at `until` minus open at `since`. */
  netChange: number;
  /** The half of the movement that is a measured remediation. */
  measured: number;
  /** The half that is administrative — dated by absence rather than by an API statement. */
  administrative: number;
  /** Resolved in the window with no usable provenance. In neither half; published. */
  unattributed: number;
  /** netChange - (arrivals - observed - bounded + reopened). Published, never tuned away. */
  identityGap: number;
  identityHolds: boolean;
  scansInWindow: number;
  /** Non-grouped scans whose `ts` could not be parsed, so they sit in no window. */
  skippedScans: number;
  /** In-window `new_count` / `reopened_count` values that were not finite numbers. */
  partialCounts: number;
  /** Rows whose `first_seen` could not be parsed, so the replay could not place them. */
  unplacedRows: number;
  /** The window as parsed, echoed so a caller cannot mislabel the figure. */
  sinceMs: number;
  untilMs: number;
}

export type MovementRow = Pick<
  BaseRow,
  "severity" | "status" | "first_seen" | "resolved_at" | "resolution_src"
>;

type MovementScan = {
  ts?: unknown;
  shape?: unknown;
  severities?: unknown;
  new_count?: unknown;
  reopened_count?: unknown;
};

/**
 * Add a scan count into a running total, refusing anything that is not already a number.
 *
 * `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all 0 and all finite, so a
 * cast-then-`isFinite` guard reads every one of them as a measured zero. The type test comes
 * FIRST and nothing is cast at all.
 */
function addCount(total: number, v: unknown, refused: { n: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    refused.n += 1;
    return total;
  }
  return total + v;
}

/** The window test for a resolution or a scan: half-open, so an endpoint scan is counted once. */
function inWindow(t: number | null, sinceMs: number, untilMs: number): boolean {
  return t !== null && t > sinceMs && t <= untilMs;
}

/**
 * Decompose the change in the open count between two instants into its causes.
 *
 * The endpoints are SCANS, not calendar dates (the caller picks them; see api.scanHistoryData),
 * for the reason gas_devsecops/test/movement.test.ts states for its own week-over-week figure:
 * a register only learns something on the days it looks, so a window bounded by dates it did
 * not look on attributes another period's arrivals to this one.
 *
 * Refuses an unparseable or inverted window rather than returning a zeroed decomposition — a
 * Movement of all zeroes reads as "nothing happened", which is a measurement, and no
 * measurement was made.
 */
export function movementDecomposition(
  rows: MovementRow[],
  scans: MovementScan[],
  window: { since: string | number; until: string | number },
): Movement {
  const sinceMs = parseTs(window.since);
  const untilMs = parseTs(window.until);
  if (sinceMs === null || untilMs === null || !(sinceMs < untilMs)) {
    throw new Error(
      "movementDecomposition: the window endpoints must be two parseable instants, " +
        "since before until — got " + JSON.stringify(window),
    );
  }

  // ---- the scan side: arrivals, reopenings, and the gate the last scan in the window applied.
  const refused = { n: 0 };
  let arrivals = 0;
  let reopened = 0;
  let scansInWindow = 0;
  let skippedScans = 0;
  let newestTs: number | null = null;
  let newestScan: MovementScan | null = null;
  for (const s of scans) {
    // Grouped scans are counts-only: they carry no per-finding rows, so their deltas describe
    // nothing this decomposition can reconcile against. Excluded exactly as capacityByMonth
    // excludes them.
    if (s["shape"] === "grouped") continue;
    const t = parseTs(s["ts"]);
    if (t === null) {
      skippedScans += 1;
      continue;
    }
    if (!inWindow(t, sinceMs, untilMs)) continue;
    scansInWindow += 1;
    arrivals = addCount(arrivals, s["new_count"], refused);
    reopened = addCount(reopened, s["reopened_count"], refused);
    if (newestTs === null || t > newestTs) {
      newestTs = t;
      newestScan = s;
    }
  }

  // The gate as the NEWEST in-window scan applied it — the one whose population the register
  // is currently showing. `parseSeverities` answers null for absent, empty, full and
  // unparseable alike, and all four mean the same thing: nothing was gated out.
  const gate = newestScan ? parseSeverities(newestScan["severities"]) : null;
  const gateSet = gate && gate.length ? new Set(gate) : null;

  // ---- the row side: resolutions by provenance, the replay, and what could not be placed.
  let observed = 0;
  let bounded = 0;
  let unattributed = 0;
  let outsideGate = 0;
  let openAtSince = 0;
  let openAtUntil = 0;
  let unplacedRows = 0;
  for (const row of rows) {
    const first = parseTs(row.first_seen);
    const resolved = parseTs(row.resolved_at);

    if (inWindow(resolved, sinceMs, untilMs)) {
      const src = String(row.resolution_src ?? "").trim().toLowerCase();
      if (src === "api") observed += 1;
      else if (src === "disappeared") bounded += 1;
      else unattributed += 1;
    }

    // The stock, not a flow: what is open NOW and outside what the last scan looked at.
    if (gateSet && isOpen(row.status) && !gateSet.has(normalizeSeverity(row.severity))) {
      outsideGate += 1;
    }

    if (first === null) {
      unplacedRows += 1;
      continue;
    }
    if (first <= sinceMs && (resolved === null || resolved > sinceMs)) openAtSince += 1;
    if (first <= untilMs && (resolved === null || resolved > untilMs)) openAtUntil += 1;
  }

  const netChange = openAtUntil - openAtSince;
  const identityGap = netChange - (arrivals - observed - bounded + reopened);

  return {
    arrivals,
    observed,
    bounded,
    reopened,
    outsideGate,
    netChange,
    measured: observed,
    administrative: bounded,
    unattributed,
    identityGap,
    identityHolds: identityGap === 0,
    scansInWindow,
    skippedScans,
    partialCounts: refused.n,
    unplacedRows,
    sinceMs,
    untilMs,
  };
}

/**
 * The window's two endpoints: the newest flat scan, and the newest flat scan at least
 * `minDays` older than it.
 *
 * THE ENDPOINTS ARE SCANS, NOT CALENDAR DATES, and that is the whole rule. A register only
 * learns something on the days it looks, so a window running from "28 days ago" to "now"
 * attributes to this window every arrival a scan happened to first see inside it — including
 * findings born in a stretch nobody scanned. gas_devsecops/test/movement.test.ts states the
 * same rule for its week-over-week figure.
 *
 * `reason` rather than a sentence: the copy belongs to the surface that prints it. On
 * `tooClose` the SPAN the log actually offers travels too, so the reader learns "this register
 * has only been saving scans for 9 days" rather than the bare "no comparison".
 */
export type MovementWindow =
  | { since: number; until: number; days: number; reason: null }
  | { since: null; until: number | null; days: number | null; reason: "noScans" | "oneScan" | "tooClose" };

export function movementWindowScans(
  scans: { ts?: unknown; shape?: unknown }[],
  minDays: number,
): MovementWindow {
  const flat = scans
    .filter((s) => s["shape"] !== "grouped")
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  if (!flat.length) return { since: null, until: null, days: null, reason: "noScans" };
  const until = flat[flat.length - 1] as number;
  const spanDays = Math.round(((until - (flat[0] as number)) / DAY_MS) * 10) / 10;
  if (flat.length === 1) return { since: null, until, days: 0, reason: "oneScan" };
  const cutoff = until - minDays * DAY_MS;
  // Newest-first, so the window is the SHORTEST one that still clears the minimum — the most
  // recent 28 days of scanning, not the whole ledger.
  for (let i = flat.length - 2; i >= 0; i -= 1) {
    const t = flat[i] as number;
    if (t <= cutoff) {
      return { since: t, until, days: Math.round(((until - t) / DAY_MS) * 10) / 10, reason: null };
    }
  }
  return { since: null, until, days: spanDays, reason: "tooClose" };
}
