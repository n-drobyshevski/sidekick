// Fix next — the Executive front door's ranked list, and the accounting that keeps it honest.
//
// WHY THIS IS ITS OWN FILE. Everything else the Executive page is sent describes what IS: a
// Kaplan-Meier half-life, a severity tally, a per-group split. None of it says what to do on
// Monday. This module is the one producer that answers that, and it lives apart from
// `insights.ts` because it is a RANKING RULE rather than an aggregation — the argument it
// encodes (which finding earns a leader's attention first) is the part a reviewer will want to
// read whole, and burying it among fourteen other exports is how a rule stops being read.
//
// IT RANKS GROUPS, NOT FINDINGS, AND THAT IS THE PRODUCT DECISION. The Executive page never
// lists a finding — the OS-vulnerabilities register does that, and it is a page for exactly
// that reason. A leader cannot act on "CVE-2024-1234 on web-prod-03"; a leader can act on
// "eleven known-exploited findings reachable from the internet, all owned by CS-CORE-PLATFORM".
// So the unit here is (tier, owner), which is the smallest unit somebody can be asked to own.
//
// ------------------------------------------------------------------------------------ //
//  THE THREE TIERS, AND WHY THEY ARE ORDERED THIS WAY
// ------------------------------------------------------------------------------------ //
//
//   1  KEV and reachable        On the CISA catalog — somebody IS exploiting it — on a host
//                               reachable from outside. NO SLA GATE and NO FIX GATE: a
//                               known-exploited finding on a reachable host is not more
//                               acceptable on day 3 than on day 30, and it is not more
//                               acceptable while a vendor patch is awaited either, because
//                               the action is isolate / WAF / take it off the internet, not
//                               only patch. This is why the tier is tested BEFORE `noFix`
//                               below — see the perturbation in test/fixNext.test.ts.
//   2  Exploitable and late     KEV or a public exploit, a fix EXISTS, and the actionable
//                               clock has run past the severity's window. The only tier where
//                               somebody else's clock has already stopped: the patch is
//                               published and the register is late on it.
//   3  Critical and late        CRITICAL, a fix exists, past SLA. No exploit evidence — this
//                               is the severity bar catching what the exploitability spine
//                               does not, and it is tighter than tier 2's for that reason.
//
// EXPOSURE IS A CURRENT-SCAN FACT, so tier 1 is only decidable when the caller could compute
// it. `hasWideInternetExposure` is not a ledger column (see `insights.triageFunnel`, which
// makes the same join); when the frame predates those keys the caller passes
// `exposureKnown: false`, tier 1 is EMPTY, and the payload SAYS SO rather than publishing a
// zero. Absent is not none.
//
// THE ACTIONABLE CLOCK, NOT THE DETECTION CLOCK. Lateness is measured on
// `actionable_age_days` — the clock that starts when a vendor fix became available — which is
// the clock the MTTR page's headline uses and the clock `insights.triageFunnel` calls overdue
// on. Using `age_days` would report a finding that was vendor-blocked for three months and
// patchable for two days as three months late, which is a breach nobody could have prevented.
//
// ------------------------------------------------------------------------------------ //
//  THE UNRANKED ACCOUNTING IS THE OTHER HALF OF THE LIST
// ------------------------------------------------------------------------------------ //
//
// A top-8 with no denominator is a list that quietly deletes the backlog: it looks the same
// whether four findings were left out or four thousand. Every OPEN row lands in exactly one
// place — a tier, or one of four named reasons — and
//
//     ranked + noFix + unclassified + insideSla + other === openTotal
//
// holds by construction. The four reasons:
//
//   noFix         `awaiting_vendor_fix` — OPEN with no fix available yet. Waiting on a vendor
//                 is not a slow team, so these are excluded from the list and COUNTED, never
//                 dropped. Tested AFTER tier 1 (a known-exploited reachable finding is
//                 actionable without a patch) and BEFORE any lateness claim (a row with no
//                 fix has no actionable clock to be late on).
//   unclassified  Past SLA, below every tier's bar, and `riskTier` says `unknown` — the
//                 exploit signals were NEVER CAPTURED. This is not "no exploit exists"; it is
//                 "nobody looked", and it gets its own count for the same reason
//                 `riskTierStats.unclassified` does.
//   insideSla     Measured, and still within its severity's window. A positive statement, and
//                 a claim — which is why an unmeasurable age never lands here.
//   other         The residue, deliberately: no readable actionable age, or a severity with no
//                 SLA target at all, or past SLA with the signals captured and none of them
//                 clearing a tier's bar. Anything unaccounted for shows up as a number a
//                 reader can ask about rather than being absorbed into a reassuring bucket.
//
// `Number(null)` IS 0 AND IT IS FINITE, so every age and every target is refused BEFORE any
// cast (CLAUDE.md's third recurrence of this). `has_kev` / `has_exploit` are TRI-STATE and a
// null is NOT a false: a null never ranks, and it never counts as a captured signal either —
// `riskTier` is what decides that, and it is the same classifier the Overview and Program
// pages use, never a second opinion.

import { isOpenStatus, SLA_TARGETS } from "./config";
import type { BaseRow } from "./ledgerCore";
import { type RiskRule, riskTier } from "./program";
import { normalizeSeverity } from "./severity";

/** How many groups the Executive payload carries. The page draws all of them. */
export const FIX_NEXT_LIMIT = 8;

export type FixNextTier = 1 | 2 | 3;
export type UnrankedReason = "noFix" | "unclassified" | "insideSla" | "other";

/**
 * What this ranking reads. `_supportGroup` and `_domain` are SERVER-ATTACHED (api.ts's
 * `insightsData` runs `attachSupportGroups` and `resolveDomainName` over the base rows before
 * any aggregation), never native ledger columns — declared here as `unknown` for exactly that
 * reason, so nothing in this module can assume they arrived.
 */
export type FixNextRow = Pick<
  BaseRow,
  | "vuln_key" | "cve" | "severity" | "status"
  | "has_kev" | "has_exploit" | "epss"
  | "fix_available_at" | "awaiting_vendor_fix"
  | "actionable_age_days" | "age_days"
  | "asset_name" | "subscription_name"
> & { _supportGroup?: unknown; _domain?: unknown };

export interface FixNextGroup {
  tier: FixNextTier;
  /** What this group IS, in the register's own words. Never just a number's name. */
  label: string;
  /** `_supportGroup` if the tenant wrote one, else the subscription, else null — the group is
   *  still real when nobody owns it, and "(unknown)" would be a name it does not have. */
  owner: string | null;
  /** Which of the two the `owner` came from, so the client can label it truthfully. */
  ownerKind: "supportGroup" | "subscription" | null;
  /** The one business domain, or null where the group's rows disagree or carry none.
   *  Naming one of several would invent an owner. */
  domain: string | null;
  count: number;
  /** Distinct affected assets — a count of one across nine findings is one patch window. */
  assets: number;
  /** The CVE appearing most often in the group, and how often. Null when no row names one. */
  topCve: { cve: string; count: number } | null;
  /** Oldest open finding in the group, in days on the DETECTION clock — "how long has this
   *  been here", which is a different question from the actionable lateness that ranked it. */
  oldestAgeDays: number | null;
  /** The register page this group's findings live on. */
  route: string;
  /** What a deep link would narrow to. `supportGroup` travels only when the owner IS one —
   *  a subscription name is not a value the Overview's support-group filter accepts. */
  params: { supportGroup?: string; tier: FixNextTier };
}

export interface FixNextUnranked {
  noFix: number;
  unclassified: number;
  insideSla: number;
  other: number;
}

export interface FixNextResult {
  groups: FixNextGroup[];
  /** Open findings per tier — the whole tier, not the part that survived `limit`. */
  tiers: Record<"1" | "2" | "3", number>;
  unranked: FixNextUnranked;
  /** Ranked findings across all tiers. `ranked + every unranked reason === openTotal`. */
  ranked: number;
  openTotal: number;
  /** Groups before `limit`, and how many the limit cut. A truncated list says it is one. */
  groupsTotal: number;
  groupsCut: number;
  /** Findings inside the groups the limit cut — a group count alone hides their size. */
  findingsCut: number;
  limit: number;
  /** False when the current-scan frame carries no exposure fields, which makes tier 1
   *  undecidable rather than empty. Published so the client draws the difference. */
  exposureKnown: boolean;
  asOf: number;
}

export interface FixNextOptions {
  /** `vuln_key`s of open findings on an internet-reachable host, joined from the frame. */
  exposedKeys?: Set<string>;
  /** Whether that join was possible at all. False empties tier 1 and says so. */
  exposureKnown?: boolean;
  /** The operator's risk rule — the same one `riskTierStats` and the funnel classify with. */
  rule: RiskRule;
  /** Severity -> days. Defaults to `SLA_TARGETS`; a severity absent here never breaches. */
  slaTargets?: Record<string, number>;
  /**
   * Stamps `asOf` and nothing else. Ages are read off each row's own `actionable_age_days` /
   * `age_days`, which `baseRows` already computed against one clock — recomputing them here
   * would put a second, disagreeing clock on one page.
   */
  now?: number;
  limit?: number;
}

const TIER_LABELS: Record<FixNextTier, string> = {
  1: "Known exploited, reachable",
  2: "Exploitable and late",
  3: "Critical and late",
};

/** A finite number, or null. Refuses null / undefined / "" / [] / false BEFORE any cast. */
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A non-blank string, or null. Same refusal, for the fields a group is named by. */
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Past its severity's SLA window on the ACTIONABLE clock, or `null` when that cannot be
 * decided. Strict `>`, matching `insights.triageFunnel` and `remediation.openPastSla` — a
 * finding ON its due date is in SLA. Null for a row with no readable actionable age or a
 * severity carrying no target: both are "not measured", and this register does not render a
 * not-measured as a false.
 */
function pastSla(row: FixNextRow, targets: Record<string, number>): boolean | null {
  const age = finite(row.actionable_age_days);
  if (age === null) return null;
  const target = finite(targets[normalizeSeverity(row.severity)]);
  if (target === null) return null;
  return age > target;
}

/** A fix exists for this finding — what tiers 2 and 3 require before calling anyone late. */
function hasFix(row: FixNextRow): boolean {
  return row.fix_available_at !== null && row.fix_available_at !== undefined;
}

/** The tier this open row earns, or the reason it earns none. Exactly one of the two. */
function classify(
  row: FixNextRow,
  rule: RiskRule,
  targets: Record<string, number>,
  exposedKeys: Set<string>,
  exposureKnown: boolean,
): { tier: FixNextTier } | { reason: UnrankedReason } {
  // TIER 1, ahead of everything including the vendor-fix test. `has_kev === true` and not a
  // truthy cast: the column is tri-state and a null means the KEV signal was never captured.
  if (exposureKnown && row.has_kev === true && exposedKeys.has(row.vuln_key)) {
    return { tier: 1 };
  }

  // Ahead of the SLA test on purpose: a finding with no published fix is awaiting a vendor
  // whether or not its window has closed, and it has no actionable clock to be late on.
  if (row.awaiting_vendor_fix === true) return { reason: "noFix" };

  const late = pastSla(row, targets);
  if (late === null) return { reason: "other" };
  if (!late) return { reason: "insideSla" };

  const fixed = hasFix(row);
  if (fixed && (row.has_kev === true || row.has_exploit === true)) return { tier: 2 };
  if (fixed && normalizeSeverity(row.severity) === "CRITICAL") return { tier: 3 };

  // Past SLA and below every bar. Which of the two it is depends on whether anybody LOOKED:
  // `unknown` from the shared classifier means an enabled signal was never observed on this
  // row, and that is a measurement gap rather than a low score.
  return riskTier(row, rule) === "unknown"
    ? { reason: "unclassified" }
    : { reason: "other" };
}

interface Bucket {
  tier: FixNextTier;
  owner: string | null;
  ownerKind: "supportGroup" | "subscription" | null;
  count: number;
  assets: Set<string>;
  cves: Map<string, number>;
  oldestAgeDays: number | null;
  domains: Set<string>;
  domainMissing: boolean;
}

/** Who would be asked. The tenant's own word first; the subscription is the fallback. */
function ownerOf(row: FixNextRow): { owner: string | null; kind: Bucket["ownerKind"] } {
  const sg = text(row._supportGroup);
  if (sg !== null) return { owner: sg, kind: "supportGroup" };
  const sub = text(row.subscription_name);
  if (sub !== null) return { owner: sub, kind: "subscription" };
  return { owner: null, kind: null };
}

/**
 * The ranked list, and everything it left out.
 *
 * RESOLVED ROWS NEVER REACH THE CLASSIFIER. The list is about what to do next, and there is
 * nothing to do about a closed finding — so `openTotal` is the denominator every figure here
 * is against, and it is published so the client never has to derive it.
 *
 * ORDER: tier ascending (a known-exploited reachable finding outranks any count of anything
 * else), then count descending, then oldest first, then owner — the last two so the order is
 * TOTAL and a re-run over the same ledger produces the same list rather than a stable-sort
 * accident.
 */
export function fixNext(rows: readonly FixNextRow[], opts: FixNextOptions): FixNextResult {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const targets = opts.slaTargets ?? SLA_TARGETS;
  const limit = opts.limit === undefined ? FIX_NEXT_LIMIT : Math.max(0, Math.trunc(opts.limit));
  const exposedKeys = opts.exposedKeys ?? new Set<string>();
  const exposureKnown = opts.exposureKnown === true;

  const tiers: Record<"1" | "2" | "3", number> = { 1: 0, 2: 0, 3: 0 };
  const unranked: FixNextUnranked = { noFix: 0, unclassified: 0, insideSla: 0, other: 0 };
  const buckets = new Map<string, Bucket>();
  let openTotal = 0;
  let ranked = 0;

  for (const row of rows) {
    if (!isOpenStatus(row.status)) continue;
    openTotal += 1;
    const verdict = classify(row, opts.rule, targets, exposedKeys, exposureKnown);
    if ("reason" in verdict) {
      unranked[verdict.reason] += 1;
      continue;
    }
    ranked += 1;
    tiers[String(verdict.tier) as "1" | "2" | "3"] += 1;

    const { owner, kind } = ownerOf(row);
    const key = verdict.tier + " " + (owner === null ? "" : owner);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        tier: verdict.tier, owner, ownerKind: kind, count: 0,
        assets: new Set(), cves: new Map(), oldestAgeDays: null,
        domains: new Set(), domainMissing: false,
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const asset = text(row.asset_name);
    if (asset !== null) bucket.assets.add(asset);
    const cve = text(row.cve);
    if (cve !== null) bucket.cves.set(cve, (bucket.cves.get(cve) ?? 0) + 1);
    const age = finite(row.age_days);
    if (age !== null && (bucket.oldestAgeDays === null || age > bucket.oldestAgeDays)) {
      bucket.oldestAgeDays = age;
    }
    const dom = text(row._domain);
    if (dom === null) bucket.domainMissing = true;
    else bucket.domains.add(dom);
  }

  const all: FixNextGroup[] = [...buckets.values()]
    .map((b) => {
      let topCve: { cve: string; count: number } | null = null;
      for (const [cve, count] of b.cves) {
        // Ties break on the CVE id, so the group is stable across runs rather than
        // reporting whichever row the ledger happened to hand over first.
        if (topCve === null || count > topCve.count
          || (count === topCve.count && cve < topCve.cve)) {
          topCve = { cve, count };
        }
      }
      return {
        tier: b.tier,
        label: TIER_LABELS[b.tier],
        owner: b.owner,
        ownerKind: b.ownerKind,
        // One domain only when EVERY row in the group agreed on it. A row with no domain
        // at all disagrees too — "some of these are Not attributable" is not "all SAP".
        domain: b.domains.size === 1 && !b.domainMissing ? [...b.domains][0]! : null,
        count: b.count,
        assets: b.assets.size,
        topCve,
        // One decimal. `age_days` is a float carrying sub-second precision that no reader
        // wants and every group pays bytes for; the page rounds it to whole days anyway.
        oldestAgeDays: b.oldestAgeDays === null ? null : Math.round(b.oldestAgeDays * 10) / 10,
        route: "overview",
        params: {
          ...(b.ownerKind === "supportGroup" && b.owner !== null
            ? { supportGroup: b.owner }
            : {}),
          tier: b.tier,
        },
      };
    })
    .sort((a, b) => (
      a.tier - b.tier
      || b.count - a.count
      || (b.oldestAgeDays ?? -1) - (a.oldestAgeDays ?? -1)
      || String(a.owner ?? "").localeCompare(String(b.owner ?? ""))
    ));

  const groups = all.slice(0, limit);
  const cutRows = all.slice(limit);

  return {
    groups,
    tiers,
    unranked,
    ranked,
    openTotal,
    groupsTotal: all.length,
    groupsCut: cutRows.length,
    findingsCut: cutRows.reduce((n, g) => n + g.count, 0),
    limit,
    exposureKnown,
    asOf: now,
  };
}
