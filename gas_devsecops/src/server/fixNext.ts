// Fix next — the front door's ranked list, and the accounting that keeps it honest.
//
// WHY THIS IS ITS OWN FILE. Everything else Executive is sent describes what IS: a half-life,
// a severity tally, three registers side by side. None of it says what to do on Monday. This
// module is the one producer that answers that, and it lives apart from `readModels.ts`
// because it is a RANKING RULE rather than a read model — the argument it encodes (which
// finding earns a leader's attention first) is the part a reviewer will want to read whole,
// and burying it inside a 1,400-line composition file is how a rule stops being read.
//
// IT RANKS GROUPS, NOT FINDINGS, AND THAT IS THE PRODUCT DECISION. Executive never lists a
// finding — the registers do that, and PRODUCT.md's "three registers, three clocks" is the
// reason they are three pages. A leader cannot act on "CVE-2024-1234 in lodash"; a leader can
// act on "seven live credentials in payments-api". So the unit here is (tier, repository),
// which is the smallest unit somebody can be asked to own.
//
// ------------------------------------------------------------------------------------ //
//  THE THREE TIERS, AND WHY THEY ARE ORDERED THIS WAY
// ------------------------------------------------------------------------------------ //
//
//   1  secrets, `validation_state === VALID`     A credential somebody CONFIRMED is live.
//                                                No SLA gate: a live credential is not more
//                                                acceptable on day 3 than on day 30, and
//                                                CLAUDE.md's "removed is not rotated" is the
//                                                same fact from the other side — the register
//                                                losing the row would not have killed the key.
//   2  sca, fix available, CRITICAL/HIGH, past   The only tier where somebody else's clock
//      SLA                                       has already stopped. `fix_available_at` is
//                                                non-null exactly when a fixed version
//                                                exists, so these are the findings a team is
//                                                genuinely late on rather than waiting on.
//   3  sast, CRITICAL, past SLA                  First-party code, nothing to wait for, and
//                                                the severity bar is tighter than SCA's
//                                                because SAST carries no exploit signal to
//                                                narrow it with.
//
// SEVERITY GRADES A DETECTION, WHICH IS WHY TIER 1 IGNORES IT. `DEFAULT_FETCH_SEVERITIES`
// leaves the secrets gate off for exactly this reason: 641 `SAAS_API_KEY` rows are LOW and
// `PASSWORD`/`CERTIFICATE` sit below HIGH. Ranking secrets by severity would file confirmed
// live credentials below unexploitable dependency noise. `validation_state` is the signal
// that means "this is real", so it is the one this tier reads.
//
// ------------------------------------------------------------------------------------ //
//  THE UNRANKED ACCOUNTING IS THE OTHER HALF OF THE LIST
// ------------------------------------------------------------------------------------ //
//
// A top-8 with no denominator is a list that quietly deletes the backlog. Every OPEN row lands
// in exactly one place — a tier, or one of four named reasons — and `ranked + noFix +
// unvalidated + insideSla + other === openTotal` holds by construction. The four reasons are
// tested for exhaustiveness rather than asserted here, because a fifth state added later would
// otherwise be absorbed silently by `other`:
//
//   noFix        SCA with no `fix_available_at`. Waiting on a vendor is not a slow team —
//                PRODUCT.md says so — so these are excluded from the list and COUNTED, never
//                dropped. Only SCA can be here: `ledgerCore.baseRows` collapses
//                `fix_available_at` onto `first_seen` for sast and secrets, so neither scope
//                can produce a null.
//   unvalidated  A secret not confirmed live: UNKNOWN, ERROR, never checked — and INVALID,
//                which is "confirmed dead". Both are "not known to be live", which is the
//                claim tier 1 rests on, so they share a bucket and the client names both.
//   insideSla    Measured, and still within its severity's window. A positive statement.
//   other        Past SLA but below its tier's severity bar, or a row with no measurable age,
//                or a severity with no SLA target at all. Deliberately the residue, so
//                anything unaccounted for shows up as a number a reader can ask about.
//
// A row with an unmeasurable `age_days`, or a severity with no target, is `other` rather than
// `insideSla` — "inside SLA" is a claim, and a claim needs a measurement behind it.

import { RESOLVED_STATUSES, SLA_TARGETS, type Scope } from "../domain/config";
import type { BaseRow } from "../domain/ledgerTypes";
import { normalizeSeverity } from "../domain/severity";

/** How many groups the Executive payload carries. The page draws all of them. */
export const FIX_NEXT_LIMIT = 8;

/** Tier 2's severity bar. SCA carries exploit signals; the bar can be two levels wide. */
const TIER2_SEVERITIES = new Set(["CRITICAL", "HIGH"]);
/** Tier 3's. Tighter, because SAST has no exploit evidence to narrow a HIGH with. */
const TIER3_SEVERITIES = new Set(["CRITICAL"]);

export type FixNextTier = 1 | 2 | 3;
export type UnrankedReason = "noFix" | "unvalidated" | "insideSla" | "other";

export interface FixNextGroup {
  tier: FixNextTier;
  /** What this group IS, in the register's own words. Never just a number's name. */
  label: string;
  scope: Scope;
  /** `repo_name` if the ledger has one, else `repo_id`, else null — never "(unknown)". */
  repo: string | null;
  /**
   * The one owning project, or null where the group spans several or carries none.
   * `owner_project` is latest-wins per row, so a group of rows can genuinely disagree;
   * naming one of them would invent an owner.
   */
  owner_project: string | null;
  count: number;
  /** The oldest open finding in the group, in days. Null when no row has a readable age. */
  oldestAgeDays: number | null;
  /** The route this group's register lives at — `sca` / `sast` / `secrets`. */
  route: string;
  /**
   * What a deep link WOULD narrow to. `readRegisterParams` (sca.js) reads `sev` and `nofix`
   * and nothing else today, so no register page has a repository filter to receive this — the
   * client links to the register unfiltered and says so. The key travels anyway so the day a
   * filter lands, the producer already names the repository it meant.
   */
  params: { scope: Scope; repo: string | null };
}

export interface FixNextUnranked {
  noFix: number;
  unvalidated: number;
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
  asOf: number;
}

export interface FixNextOptions {
  /**
   * Stamps `asOf` and nothing else. Ages are read off each row's own `age_days`, which
   * `loadBaseRows` already computed against the snapshot's clock — recomputing them here
   * would put a second, disagreeing clock on one page.
   */
  now?: number;
  /** Severity -> days. Defaults to `SLA_TARGETS`; a severity absent here never breaches. */
  slaTargets?: Record<string, number>;
  limit?: number;
}

const TIER_LABELS: Record<FixNextTier, string> = {
  1: "Live credential",
  2: "Fixable and late",
  3: "Critical code weakness",
};

const TIER_SCOPES: Record<FixNextTier, Scope> = { 1: "secrets", 2: "sca", 3: "sast" };

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/**
 * Past its severity's SLA window, or `null` when that cannot be decided.
 *
 * Strict `>`, matching `remediation.openPastSla` — a finding ON its due date is in SLA. Null
 * for a row with no readable age or a severity carrying no target: both are "not measured",
 * and this register does not render a not-measured as a false.
 */
function pastSla(row: BaseRow, targets: Record<string, number>): boolean | null {
  const age = row.age_days;
  if (age === null || age === undefined || !Number.isFinite(age)) return null;
  const target = targets[normalizeSeverity(row.severity)];
  if (target === undefined || target === null || !Number.isFinite(target)) return null;
  return age > target;
}

/** Tier 1 iff a human or a probe confirmed the credential answers. Nothing else counts. */
function secretIsLive(row: BaseRow): boolean {
  return String(row.validation_state ?? "").toUpperCase() === "VALID";
}

/** The tier this open row earns, or the reason it earns none. Exactly one of the two. */
function classify(
  row: BaseRow,
  targets: Record<string, number>,
): { tier: FixNextTier } | { reason: UnrankedReason } {
  const sev = normalizeSeverity(row.severity);

  if (row.scope === "secrets") {
    return secretIsLive(row) ? { tier: 1 } : { reason: "unvalidated" };
  }

  if (row.scope === "sca") {
    // Ahead of the SLA test on purpose: a finding with no published fix is awaiting a vendor
    // whether or not its window has closed, and reporting it as "late" would be the exact
    // conflation PRODUCT.md separates the two clocks to avoid.
    if (row.fix_available_at === null || row.fix_available_at === undefined) {
      return { reason: "noFix" };
    }
    const late = pastSla(row, targets);
    if (late === null) return { reason: "other" };
    if (!late) return { reason: "insideSla" };
    return TIER2_SEVERITIES.has(sev) ? { tier: 2 } : { reason: "other" };
  }

  const late = pastSla(row, targets);
  if (late === null) return { reason: "other" };
  if (!late) return { reason: "insideSla" };
  return TIER3_SEVERITIES.has(sev) ? { tier: 3 } : { reason: "other" };
}

/** The repository a row hangs off, preferring the name a reader would recognise. */
function repoOf(row: BaseRow): string | null {
  const name = row.repo_name === null || row.repo_name === undefined ? "" : String(row.repo_name);
  if (name.trim() !== "") return name;
  const id = row.repo_id === null || row.repo_id === undefined ? "" : String(row.repo_id);
  return id.trim() === "" ? null : id;
}

interface Bucket {
  tier: FixNextTier;
  repo: string | null;
  count: number;
  oldestAgeDays: number | null;
  owners: Set<string>;
}

/**
 * The ranked list, and everything it left out.
 *
 * RESOLVED ROWS NEVER REACH THE CLASSIFIER. The list is about what to do next, and there is
 * nothing to do about a closed finding — so `openTotal` is the denominator every figure here
 * is against, and it is published so the client never has to derive it.
 *
 * ORDER: tier ascending (a live credential outranks any count of anything else), then count
 * descending, then oldest first, then repository name — the last two so the order is total and
 * a re-run of the same ledger produces the same list rather than a stable-sort accident.
 */
export function fixNext(rows: readonly BaseRow[], opts: FixNextOptions = {}): FixNextResult {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const targets = opts.slaTargets ?? SLA_TARGETS;
  const limit = opts.limit === undefined ? FIX_NEXT_LIMIT : Math.max(0, Math.trunc(opts.limit));

  const tiers: Record<"1" | "2" | "3", number> = { 1: 0, 2: 0, 3: 0 };
  const unranked: FixNextUnranked = { noFix: 0, unvalidated: 0, insideSla: 0, other: 0 };
  const buckets = new Map<string, Bucket>();
  let openTotal = 0;
  let ranked = 0;

  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    openTotal += 1;
    const verdict = classify(row, targets);
    if ("reason" in verdict) {
      unranked[verdict.reason] += 1;
      continue;
    }
    ranked += 1;
    tiers[String(verdict.tier) as "1" | "2" | "3"] += 1;

    const repo = repoOf(row);
    const key = verdict.tier + " " + (repo === null ? "" : repo);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tier: verdict.tier, repo, count: 0, oldestAgeDays: null, owners: new Set() };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const age = row.age_days;
    if (age !== null && age !== undefined && Number.isFinite(age)) {
      if (bucket.oldestAgeDays === null || age > bucket.oldestAgeDays) bucket.oldestAgeDays = age;
    }
    const owner = row.owner_project === null || row.owner_project === undefined
      ? ""
      : String(row.owner_project);
    if (owner.trim() !== "") bucket.owners.add(owner);
  }

  const all: FixNextGroup[] = [...buckets.values()]
    .map((b) => {
      const scope = TIER_SCOPES[b.tier];
      return {
        tier: b.tier,
        label: TIER_LABELS[b.tier],
        scope,
        repo: b.repo,
        owner_project: b.owners.size === 1 ? [...b.owners][0]! : null,
        count: b.count,
        // One decimal. `age_days` is a float carrying sub-second precision that no reader
        // wants and every group pays 14 bytes for; the page rounds it to whole days anyway.
        oldestAgeDays: b.oldestAgeDays === null
          ? null
          : Math.round(b.oldestAgeDays * 10) / 10,
        route: scope,
        params: { scope, repo: b.repo },
      };
    })
    .sort((a, b) => (
      a.tier - b.tier
      || b.count - a.count
      || (b.oldestAgeDays ?? -1) - (a.oldestAgeDays ?? -1)
      || String(a.repo ?? "").localeCompare(String(b.repo ?? ""))
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
    asOf: now,
  };
}
