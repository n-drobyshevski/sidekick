// The cold zone: where nothing is closing at all.
//
// The rest of this register answers "how fast is code risk closing". This module answers the
// other question — WHERE HAS IT STOPPED. A repository can carry a small backlog and still be
// the worst thing on the page if nobody has touched it since January; a repository with a
// thousand findings and a fix landing every week is not a problem of engagement. Backlog size
// cannot tell those two apart, so this family measures IDLE TIME instead of volume.
//
// Structural twin of `src/domain/assets.ts`: options carry the clock (`observedFrom` / `now`)
// and the classifier (`rule`), an unparseable clock REFUSES rather than casting to null,
// rows that belong to no asset are dropped AND COUNTED, `secrets` rows are carried at risk
// `unknown` (because `program.resolveRule` throws on that scope by design) and counted, and
// the published order has a name tie-break so two runs over the same ledger diff cleanly.
//
// Pure: no clock of its own, no I/O, no persistence. Every duration here is measured against
// the caller's `now`, which the server sets to the LEDGER's clock (the newest scan's `ts`),
// never `Date.now()` — an idle time dated by the wall clock would grow every time the page
// was opened and would be a different number on every read of the same durable cache.
//
// -------------------------------------------------------------------------------------
// TWO STATES, NOT ONE, and the second one is the whole reason this module is careful:
//
//   cold        the repository is still being scanned, it still has open findings, and no
//               finding on it has been resolved, removed or rotated for at least the
//               threshold. That is a fact about the TEAM.
//   unobserved  the scanner stopped returning the repository. That is a fact about the
//               SCANNER, and it is tested FIRST, because `reconcile` resolves findings that
//               are absent from the newest scan BY DISAPPEARANCE (reconcile.ts's
//               `RESOLUTION_DISAPPEARED`). A repository that drops out of coverage therefore
//               looks mass-remediated in exactly one scan. Reading that as warmth would
//               reward losing sight of a repository, which is the single worst thing this
//               page could do. So an unobserved repository is never warm, never cold, sits
//               in no idle bucket, and publishes `disappeared_at` and how many findings
//               closed at that instant so the reader can see the shape of the drop-out.
//
// WHAT THE COLUMNS REFUSE TO SAY:
//   * `observedFrom === null` ⇒ `repos`, `teams`, `totals`, `bucket_edges` and
//     `bucket_labels` are ALL null, never empty arrays and never zeros. With no scan on
//     record the register cannot say when it started watching, and every figure here is
//     "how long since something happened" — a duration with no origin. `row_count`,
//     `dropped_no_repo`, `unclassified_secrets` and `scopes_without_scan` still report, so
//     an empty section can prove it looked.
//   * A repository with no movement on record gets NO `idle_days`. It gets `idle_bound_days`
//     — a LOWER bound measured from the later of "when we started watching" and "when this
//     repository's oldest finding was first seen" — and `idle_is_bound: true` so the page
//     prints "≥ N d" rather than a number nobody measured. Never having seen a close is not
//     the same fact as having measured a long silence, and the two must not render alike.
//   * `cold_share_pct` and the two totals shares are NULL over an empty denominator, never
//     0%. "No repository has open findings" and "0% of them are cold" are different answers.
//   * `oldest_open_age_days` is derived from `first_seen` against the caller's `now`, NEVER
//     from the row's stored `age_days` — that column is a wall-clock read and would make
//     this block disagree with itself across two loads of the same cached model.
//   * A scope that has rows but no scan on record is UNDECIDABLE, so the repository stays
//     observed (the conservative direction: we do not accuse a team of vanishing on the
//     strength of a missing scan row) and the scope is named in `scopes_without_scan`.
//
// -------------------------------------------------------------------------------------
// ONE POPULATION THE OPERATOR MAY REMOVE, AND IT IS THE ONLY ONE. `excludeEndOfLife` drops
// the repositories the tenant has RETIRED (`src/domain/lifecycleTag.ts`, read off the
// repository's `lifecycle` tag) before anything here is measured. It is off by default, and
// it is the one exclusion this module offers, because it is the one population whose silence
// means the opposite of what every other column here reads into it: nobody is closing
// findings on a finished repository because nobody is meant to. Counting those as cold does
// not describe a team that stopped — it describes a decision that was taken, and it crowds
// out the repositories that really did go quiet.
//
// WHAT THE EXCLUSION REFUSES TO DO:
//   * It never guesses. Only a positive, recognised end-of-life reading removes anything; a
//     repository with no lifecycle tag, or one in a vocabulary this register has not been
//     taught, stays in. Absence is never retirement.
//   * It never happens silently. `end_of_life_repos` counts the retired population in BOTH
//     settings, `excluded_end_of_life` counts what actually left, and `excluded_open_findings`
//     says how much backlog went with them — so a share whose denominator shrank can be
//     checked rather than merely believed.
//   * It never reaches the rest of the register. A retired repository's findings are real and
//     stay in every backlog, density and severity figure this app publishes; what is being
//     removed is a reading about ENGAGEMENT, not a finding.
//   * It never narrows `scopes_without_scan`, which is a fact about scan coverage rather than
//     about this population — a coverage warning must not disappear because of a display
//     setting.
//
// THRESHOLD SEMANTICS: `>=`, everywhere. Exactly 90.0 days idle is cold, matching the
// register's "≥ N" wording rule (README / PRODUCT.md) — the page never prints ">".
//
// -------------------------------------------------------------------------------------
// TWO WAYS TO DRAW THAT LINE, and only one of them is a constant:
//
//   fixed     the operator names the WINDOW. A repository is cold after `coldAfterDays` of
//             silence, and that number means the same thing on every estate and in every
//             week. It is the default, and it is what an absent `mode` means.
//   relative  the operator names a SHARE, and the line in days is DERIVED from the estate:
//             the idlest `targetSharePct` per cent of the repositories that are observed and
//             carry open findings are the cold zone. The line follows the population instead
//             of standing still while the population moves underneath it — the argument EPSS
//             makes for publishing a percentile beside a probability (config.ts carries the
//             sources and the two failure modes the floor answers).
//
// Both modes produce ONE effective threshold in days, and `cold_after_days` is ALWAYS that
// effective line: every verdict, every bucket edge and every label downstream reads it, and
// nothing downstream has to know which mode produced it. The operator's fixed window is still
// published as `fixed_after_days`, so the page can say what was asked for as well as what was
// drawn.
//
// WHAT THE RELATIVE MODE REFUSES TO SAY:
//   * It never interpolates. The cut is a RANK — the k-th largest reading, with
//     `k = min(n, max(1, ceil(target/100 × n)))` — so the line always sits ON a repository
//     somebody can go and look at, and ties at the cutoff are ALL cold. The threshold stays
//     "≥", and two repositories idle the same number of days can never land on opposite
//     sides of it.
//   * It never goes below `floorDays`. A share always names somebody, however healthy the
//     estate; the floor is what stops "the idlest 20%" being a slander on four repositories
//     that were all touched last week. When the floor holds, `floor_applied` says so and
//     `derived_days` publishes the line that was refused.
//   * It never claims the target was met. `achieved_share_pct` is published beside
//     `target_share_pct` in BOTH modes, and the two disagree in both directions by design —
//     below when the floor holds the zone smaller than asked, above when ties at the cutoff
//     widen it.
//   * A repository with no movement on record ranks at its LOWER BOUND (`idle_reading_days`),
//     the same number the fixed mode classifies and prints it by. That is a systematic
//     UNDER-estimate of its silence, so the cost is published: `cold_bound_only` counts the
//     cold repositories whose idle time was never actually measured.
//   * With no eligible repository at all, the line rests on the floor and `derived_days` is
//     NULL — nothing was derived, which is not the same fact as "zero days" — while
//     `eligible_repos` reports 0 so the empty answer can prove it looked.
//
// The TEAM rank is the same idea one level up and is deliberately kept separate from the
// verdict: `relative_rank` orders the products that have repositories with open findings by
// the share of those repositories that are cold, and in relative mode the coldest
// `targetSharePct` of them are marked `in_coldest_share`. A product with no cold repository
// is never marked, whatever the arithmetic says (the `C` clamp), and ties are extended
// through rather than broken by the label — a badge that depended on alphabetical order
// would be a fact about spelling.

import {
  COLD_ZONE_MODES,
  DEFAULT_COLD_ZONE_MODE,
  RESOLUTION_DISAPPEARED,
  RESOLVED_STATUSES,
  type ColdZoneMode,
  type Scope,
} from "./config";
import type { BaseRow } from "./ledgerTypes";
import { isEndOfLife } from "./lifecycleTag";
import { classifyRisk, type AnyRiskRule, type RiskClass, type RiskRow } from "./program";
import { cmp, parseTs, present, toIso } from "./util";

const DAY_MS = 86_400_000;

/** The label the null-product bucket is published under — a real row, never a drop. */
export const COLD_PRODUCT_NONE = "(no product)";

// --------------------------------------------------------------------------- input shape

/**
 * The projection this module reads. A `BaseRow` satisfies it structurally, which is the
 * intended input; the narrow type is here so a test (or a page) can build one without
 * inventing 40 ledger columns — the same bargain `assets.ts`'s `AssetRow` makes.
 *
 * `RiskRow` rides along because `risk_class` is not a stored column in this register: it is
 * derived per row by `program.classifyRisk`, so "high risk sitting cold" and the confusion
 * matrix cannot disagree about what "high" means.
 */
export type ColdRow = RiskRow &
  Pick<
    BaseRow,
    | "repo_id"
    | "repo_name"
    // THE TWO GRAINS, ATTACHED ON READ, NOT the `owner_project` column they replaced. A
    // repository is filed under a `product-…` product and under a CS/CE/LU support group that
    // holds several of them (src/domain/projectGrain.ts); `owner_project` held whichever of
    // the two Wiz returned first, so the roll-up below was ranking products against support
    // groups. Taking `_product` here means the compiler proves the old column left this path.
    | "_product"
    | "_supportGroup"
    | "_supportGroups"
    // The repository's lifecycle, attached on read from its `lifecycle` tag
    // (`src/domain/lifecycleTag.ts`). It is here for two separate jobs: the page prints it
    // beside a cold verdict so a reader can tell an abandoned repository from a finished one,
    // and `excludeEndOfLife` below can remove the finished ones from the measurement entirely.
    | "_lifecycle"
    | "scope"
    | "status"
    | "first_seen"
    | "last_seen"
    | "resolved_at"
    | "resolution_src"
    | "removed_at"
    | "rotated_at"
    | "reopened_count"
    | "last_scan_id"
  >;

/** The newest scan of one scope — what "the scanner still sees this repository" is tested against. */
export interface NewestScan {
  scan_id: string | null;
  ts: string | number | Date | null;
}

export interface ColdZoneOptions {
  /** The evaluation instant. An option, never `Date.now()` — this module is pure. */
  now: string | number | Date;
  /**
   * The earliest scan on record — when this register started WATCHING. `null` is a
   * legitimate, explicit answer ("we do not know"), and it makes every derived block null.
   * There is no default: a clock has to say where it started.
   */
  observedFrom: string | number | Date | null;
  /**
   * How long a silence has to be before it is cold, in days. REQUIRED and not defaulted
   * here: the default lives in `config.DEFAULT_COLD_AFTER_DAYS` and reaches this function
   * through the settings layer, so there is exactly one place an operator's choice can be
   * overridden and exactly one place to look when a published figure disagrees with it.
   */
  coldAfterDays: number;
  /**
   * `"fixed"` (the default when absent) or `"relative"`. Absent means fixed rather than
   * throwing, because the fixed window is the older contract and every caller that predates
   * relative mode is still asking for exactly what it used to get.
   */
  mode?: ColdZoneMode;
  /**
   * The share of eligible repositories the cold zone should hold, in per cent. REQUIRED in
   * relative mode and REFUSED silently by nothing: there is no default here, for the same
   * reason `coldAfterDays` has none — the operator's choice lives in the settings layer
   * (`config.DEFAULT_COLD_TARGET_SHARE_PCT`, clamped to its bounds there), and a default in
   * this module would be a second place for a published figure to come from.
   */
  targetSharePct?: number;
  /** The line's floor in days, REQUIRED in relative mode. See the module header. */
  floorDays?: number;
  /**
   * Leave end-of-life repositories out of the measurement entirely. Default FALSE, so every
   * caller that predates this option gets exactly what it used to.
   *
   * WHY THE COLD ZONE IS THE ONE FAMILY THIS APPLIES TO. Every other number in this register
   * is a count of findings, and a retired repository's findings are real: they are in the
   * backlog, they are in the density, and hiding them would be a smaller estate than the
   * tenant has. This family measures ENGAGEMENT — how long since anybody closed anything —
   * and there the same silence means the opposite thing. Nobody is remediating a retired
   * repository because nobody is meant to, so counting it as cold does not describe a team
   * that has stopped; it describes a decision that was taken on purpose, and it crowds out
   * the repositories that really have gone quiet.
   *
   * AN OPT-IN, NOT A DEFAULT, AND THAT IS THE CONSERVATIVE DIRECTION. Off, the reader sees
   * every repository and can dismiss the retired ones themselves — `ColdRepoRow.lifecycle`
   * is printed for exactly that. On, they are gone and the count of what went is published
   * (`excluded_end_of_life`), because a population that quietly shrank is a share nobody can
   * check. A tenant whose lifecycle tag is missing or misspelled gets no exclusion at all
   * rather than a silent one: `lifecycleTag.isEndOfLife` recognises one word and refuses
   * everything else, absence included.
   */
  excludeEndOfLife?: boolean;
  /** Per scope, the newest scan — a scope absent from this map is undecidable, not stale. */
  newestScanByScope: Partial<Record<Scope, NewestScan>>;
  /** Omit to let each row's scope choose its classifier (`config.ruleForScope`). */
  rule?: AnyRiskRule;
}

// --------------------------------------------------------------------------- output shape

/** Repository states, in the order the verdict table tests them. */
export type ColdVerdict = "unobserved" | "clear" | "cold" | "warm" | "watching";

/** What counts as movement. Three columns, because they are three events. */
export type MovementKind = "resolved" | "removed" | "rotated";

/** Product states, rolled up from the repositories that have open findings. */
export type TeamVerdict = "fully-cold" | "partly-cold" | "warm" | "clear";

export interface ColdRepoRow {
  repo_id: string;
  /** Display name; falls back to the id when no row carried one. */
  repo_name: string | null;
  /** `_product`. NULL is a real answer and is rolled up under `COLD_PRODUCT_NONE`. */
  product: string | null;
  /** `_supportGroup` — the group this product escalates to. NULL when the row names none. */
  support_group: string | null;
  /**
   * TRUE where the repository itself is filed under SEVERAL support groups.
   *
   * `support_group` above is one name because a breakdown bucket has to land somewhere; this
   * says that one name is not the whole answer, so the roll-up can decline to publish it as an
   * escalation path. Without it a product whose single repository sits under two groups would
   * be summarised under whichever one sorted first.
   */
  support_group_split: boolean;
  /**
   * `_lifecycle` — where the tenant says this repository is in its life. NULL is a real answer
   * and is never read as "alive": see `ColdZoneOptions.excludeEndOfLife`.
   *
   * PRINTED WHETHER OR NOT THE EXCLUSION IS ON, because it answers a question the verdict
   * cannot. "Cold" and "retired" look identical in every other column on this row, and a
   * reader deciding where to spend a week needs to tell them apart even on a deployment that
   * has chosen to keep both in the table.
   */
  lifecycle: string | null;
  open_findings: number;
  open_high_risk: number;
  /** Age of the oldest OPEN finding, from `first_seen` against `now`. Never from `age_days`. */
  oldest_open_age_days: number | null;
  /** Latest of `resolved_at` / `removed_at` / `rotated_at` over ALL rows, open or not. */
  last_movement_at: string | null;
  last_movement_kind: MovementKind | null;
  /** Measured silence. NULL means no movement was ever recorded — not "zero days idle". */
  idle_days: number | null;
  /** The LOWER bound used when nothing was ever measured. Null when `idle_days` is real. */
  idle_bound_days: number | null;
  idle_is_bound: boolean;
  /** What the page prints: the measurement if there is one, else the bound (as "≥ N d"). */
  idle_reading_days: number | null;
  /** The scanner still returns this repository in the newest scan of some scope it has rows in. */
  observed: boolean;
  last_observed_at: string | null;
  /** The instant that closed the most findings by DISAPPEARANCE — the drop-out's fingerprint. */
  disappeared_at: string | null;
  /** How many findings closed at that instant. A big number beside a recent date is a drop-out. */
  disappeared_at_last_observation: number;
  /** Open findings that have come back at least once — why a repo with no movement went quiet. */
  reopened_open: number;
  verdict: ColdVerdict;
  cold: boolean;
  /** Idle bucket 0..3, or 4 for "not yet measurable". NULL for unobserved and clear repos. */
  bucket: number | null;
}

export interface ColdTeamRow {
  product: string | null;
  label: string;
  /**
   * The support group every repository in this product agreed on, or NULL where they did not
   * — or where none named one at all.
   *
   * A TEAM ROW IS A SUMMARY OVER MANY REPOSITORIES, so this takes the same refusal
   * `server/fixNext.ts` applies to a ranked group: naming one of several would invent an
   * escalation path. `support_groups` is what tells "nobody said" from "they disagreed", and
   * a disagreement is itself worth seeing — it means the tenant's convention has broken for
   * this product.
   */
  support_group: string | null;
  /** How many distinct support groups this product's repositories named. 0 when none did. */
  support_groups: number;
  repos: number;
  repos_observed: number;
  repos_unobserved: number;
  /** OBSERVED repos with at least one open finding — the denominator of `cold_share_pct`. */
  repos_with_open: number;
  cold_repos: number;
  watching_repos: number;
  warm_repos: number;
  clear_repos: number;
  open_findings: number;
  open_in_cold: number;
  high_risk_in_cold: number;
  /** Open findings on repositories the scanner has lost sight of — counted apart, never cold. */
  open_in_unobserved: number;
  cold_share_pct: number | null;
  /** Over OBSERVED repositories only: a drop-out's disappearance close is not this team's work. */
  last_movement_at: string | null;
  verdict: TeamVerdict;
  /**
   * 1..T over the products that have repositories with open findings, by `cold_share_pct`
   * desc, `open_in_cold` desc, label asc. NULL for a product with nothing open — it has no
   * cold share, and giving it a rank would invent a position for a product that is not in
   * the race. Computed in BOTH modes, so the payload has one shape.
   */
  relative_rank: number | null;
  /**
   * The coldest `targetSharePct` of the ranked products. Only ever true in relative mode,
   * never true for a product with no cold repository, and extended through ties.
   */
  in_coldest_share: boolean;
  /** Repos per idle bucket, length 5 (the fifth is "not yet measurable"). */
  buckets: number[];
  /** Open findings per idle bucket, same length — a cell says how much sits in it, not just how many. */
  bucket_open: number[];
}

export interface ColdZoneTotals {
  repos: number;
  repos_observed: number;
  repos_unobserved: number;
  repos_with_open: number;
  cold_repos: number;
  watching_repos: number;
  warm_repos: number;
  clear_repos: number;
  open_findings: number;
  open_in_cold: number;
  high_risk_in_cold: number;
  open_in_unobserved: number;
  /** cold repositories / repositories with open findings. NULL over an empty denominator. */
  cold_repo_share_pct: number | null;
  /** open findings sitting cold / all open findings — the Executive card's one number. */
  cold_backlog_share_pct: number | null;
  teams: number;
  teams_fully_cold: number;
  teams_partly_cold: number;
  /** Products marked `in_coldest_share`. Always 0 in fixed mode — the badge is relative. */
  teams_in_coldest_share: number;
  /** Repositories the tenant filed under no product — the ownership gap, published as a figure. */
  repos_no_product: number;
  buckets: number[];
  bucket_open: number[];
}

export interface ColdZoneResult {
  /** `observedFrom !== null`. False ⇒ every derived block below is null. */
  measurable: boolean;
  /** Which definition drew the line. `"fixed"` when the caller said nothing. */
  mode: ColdZoneMode;
  /**
   * THE EFFECTIVE LINE, in days — in fixed mode the operator's window, in relative mode the
   * derived cut lifted to the floor. Everything downstream (verdicts, buckets, labels, the
   * page's prose) reads this one number and nothing downstream branches on the mode.
   */
  cold_after_days: number;
  /** The operator's fixed window, published in both modes so "asked for" survives the switch. */
  fixed_after_days: number;
  /** The share the line was aimed at, in per cent. NULL in fixed mode — nothing was aimed at. */
  target_share_pct: number | null;
  /**
   * The share the line actually drew: cold repositories / repositories with open findings.
   * Published in BOTH modes (in fixed mode it is the same number as
   * `totals.cold_repo_share_pct`, said where the target can be read beside it), and NULL over
   * an empty denominator — "no repository has an open finding" is not "0% of them are cold".
   */
  achieved_share_pct: number | null;
  /** The floor the derived line may not go below. NULL in fixed mode — there is no derivation. */
  floor_days: number | null;
  /** True when the floor held the line ABOVE the derived cut, so the zone came out smaller. */
  floor_applied: boolean;
  /**
   * The k-th largest idle reading, floored to whole days — the line the estate asked for
   * before the floor was applied. NULL in fixed mode and NULL when nothing was eligible;
   * "not derived" is a different fact from "derived at zero".
   */
  derived_days: number | null;
  /** Observed repositories with at least one open finding: the population the share is of. */
  eligible_repos: number | null;
  /**
   * Cold repositories whose idle time is a LOWER BOUND rather than a measurement. The cost of
   * ranking a repository that has never closed anything at the bound it can prove.
   */
  cold_bound_only: number | null;
  observed_from: string | null;
  /** The instant every duration here was measured against — the clock says where it stood. */
  as_of: string;
  /** Lower edge of each of the four measured buckets: `[0, t/3, 2t/3, t]`. */
  bucket_edges: number[] | null;
  bucket_labels: string[] | null;
  repos: ColdRepoRow[] | null;
  teams: ColdTeamRow[] | null;
  totals: ColdZoneTotals | null;
  /** Whether the caller asked for end-of-life repositories to be left out. */
  exclude_end_of_life: boolean;
  /**
   * Repositories this read saw whose lifecycle says they are finished — COUNTED IN BOTH
   * SETTINGS, which is what makes the setting discoverable instead of hidden.
   *
   * With the exclusion OFF this is how many retired repositories are still being measured as
   * though somebody owed them a fix; with it ON it is what left. Either way it is a number the
   * page can put a sentence behind, and either way it is 0 on a tenant whose lifecycle tag
   * this register never learned — which is not the same fact as "no repository is retired",
   * and is why `mapHealth` measures the lifecycle join separately.
   */
  end_of_life_repos: number;
  /**
   * Of those, how many were actually removed: `end_of_life_repos` when the exclusion is on, 0
   * when it is off. A share whose denominator quietly shrank is a share nobody can check, so
   * the shrinkage travels with it.
   */
  excluded_end_of_life: number;
  /** Open findings on the removed repositories — the backlog this read is no longer about. */
  excluded_open_findings: number;
  /** Rows handed in, before any drop — so a zero elsewhere can prove it looked. */
  row_count: number;
  /** Rows with a blank `repo_id`: dropped, because they belong to no repository, AND counted. */
  dropped_no_repo: number;
  /**
   * `secrets` rows carried at `risk_class = "unknown"`. `program.classifyRisk` REFUSES that
   * scope by design (there is no exploit intelligence for a hardcoded string, and severity
   * there grades a DETECTION), so they can never be high risk — but a leaked credential is a
   * real open finding, so they still count toward `open_findings`, and their `removed_at` /
   * `rotated_at` still counts as movement.
   */
  unclassified_secrets: number;
  /** Scopes with rows but no scan on record: observation is undecidable for them, and said so. */
  scopes_without_scan: Scope[];
}

/** The Executive projection: the totals and the clock, never the per-repo or per-team arrays. */
export interface ColdZoneHeadline {
  measurable: boolean;
  /** Which definition drew the line — the Executive card names the mode it is reading. */
  mode: ColdZoneMode;
  /** The EFFECTIVE line, exactly as on `ColdZoneResult`. */
  cold_after_days: number;
  fixed_after_days: number;
  target_share_pct: number | null;
  achieved_share_pct: number | null;
  floor_days: number | null;
  floor_applied: boolean;
  derived_days: number | null;
  eligible_repos: number | null;
  cold_bound_only: number | null;
  exclude_end_of_life: boolean;
  end_of_life_repos: number;
  excluded_end_of_life: number;
  excluded_open_findings: number;
  observed_from: string | null;
  as_of: string;
  totals: ColdZoneTotals | null;
  row_count: number;
  dropped_no_repo: number;
  unclassified_secrets: number;
  scopes_without_scan: Scope[];
}

// --------------------------------------------------------------------------- small helpers

/** Same open/resolved test the rest of the domain uses (brick `metrics.is_open`). */
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/** True for null / undefined / NaN / whitespace-only — `util.present` read the other way. */
function blank(v: unknown): boolean {
  return !present(v);
}

/**
 * `numerator / denominator * 100`, or NULL when there is nothing to divide by.
 * NULL, never 0 — a share over an empty population is unknown, and rendering it as 0% is a
 * lie the reader cannot detect. Same rule as `assets.ts`'s `safePct` (metrics.py:179-185).
 */
function safePct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

/** Whole days between two instants, fractional and floored at 0 — never rounded. */
function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / DAY_MS);
}

/** Bucket labels print at most one decimal, so a threshold of 100 reads "33.3", not "33.333…". */
function fmtDays(n: number): string {
  return String(Number(n.toFixed(1)));
}

/** Movement beats movement in this order when two land on the same instant. */
const MOVEMENT_RANK: Record<MovementKind, number> = { resolved: 0, removed: 1, rotated: 2 };

/** The published order of repository states — worst engagement first. */
const VERDICT_RANK: Record<ColdVerdict, number> = {
  cold: 0,
  unobserved: 1,
  watching: 2,
  warm: 3,
  clear: 4,
};

// --------------------------------------------------------------------------- per repository

interface RepoAcc {
  repoId: string;
  repoName: string | null;
  product: string | null;
  supportGroup: string | null;
  supportGroupSplit: boolean;
  lifecycle: string | null;
  scopes: Set<Scope>;
  rowsByScope: Map<Scope, ColdRow[]>;
  open: number;
  openHigh: number;
  reopenedOpen: number;
  /** Earliest `first_seen` over OPEN rows — the oldest thing still sitting there. */
  oldestOpenFirstSeen: number | null;
  /** Earliest `first_seen` over ALL rows — one half of the idle lower bound. */
  earliestFirstSeen: number | null;
  lastSeen: number | null;
  movementAt: number | null;
  movementKind: MovementKind | null;
  /** Disappearance closes, counted per instant: the mode is the drop-out's fingerprint. */
  disappeared: Map<number, number>;
}

/**
 * What pass A knows about one repository: everything the threshold CANNOT change.
 *
 * The split exists for the relative mode. The line is derived from `idleReading` over the
 * eligible population, so those facts have to be complete before any line is drawn — and they
 * are, because observation and "has anything open" are decided by the scanner and the ledger,
 * never by the window. That is what makes the derivation a single pass instead of a
 * fixed-point iteration over "who is cold".
 */
interface RepoFacts {
  acc: RepoAcc;
  observed: boolean;
  idleDays: number | null;
  idleBoundDays: number | null;
  idleReading: number | null;
  disappearedAt: number | null;
  disappearedCount: number;
  /** `observed && open > 0` — the population the relative share is a share OF. */
  eligible: boolean;
}

function newAcc(repoId: string): RepoAcc {
  return {
    repoId,
    repoName: null,
    product: null,
    supportGroup: null,
    supportGroupSplit: false,
    lifecycle: null,
    scopes: new Set(),
    rowsByScope: new Map(),
    open: 0,
    openHigh: 0,
    reopenedOpen: 0,
    oldestOpenFirstSeen: null,
    earliestFirstSeen: null,
    lastSeen: null,
    movementAt: null,
    movementKind: null,
    disappeared: new Map(),
  };
}

/**
 * Fold one row into its repository.
 *
 * MOVEMENT IS READ REGARDLESS OF STATUS, and that is not an oversight. A secrets row can be
 * OPEN and carry a `rotated_at` (reconcile.ts: the credential was observed dead while the
 * string is still in HEAD) or a `removed_at` (the string left HEAD while the credential is
 * still live). Both are real remediation work on this repository. Gating movement on the row
 * being closed would report an actively-rotating team as frozen.
 */
function foldRow(acc: RepoAcc, row: ColdRow, risk: RiskClass): void {
  if (acc.repoName === null && !blank(row.repo_name)) acc.repoName = String(row.repo_name);
  if (acc.product === null && !blank(row._product)) acc.product = String(row._product);
  if (acc.supportGroup === null && !blank(row._supportGroup)) {
    acc.supportGroup = String(row._supportGroup);
  }
  // Sticky: one observation of a repository under several groups is enough to stop the
  // roll-up naming one, and a later row that happened to carry a single group does not
  // un-learn it.
  if (Number(row._supportGroups) > 1) acc.supportGroupSplit = true;
  // First non-blank wins, like the name and the product above it: the tag belongs to the
  // repository, so every row of one repository carries the same value or none.
  if (acc.lifecycle === null && !blank(row._lifecycle)) acc.lifecycle = String(row._lifecycle);
  acc.scopes.add(row.scope);
  const bucket = acc.rowsByScope.get(row.scope);
  if (bucket) bucket.push(row);
  else acc.rowsByScope.set(row.scope, [row]);

  const open = isOpen(row.status);
  const firstSeen = parseTs(row.first_seen);
  if (firstSeen !== null && (acc.earliestFirstSeen === null || firstSeen < acc.earliestFirstSeen)) {
    acc.earliestFirstSeen = firstSeen;
  }
  const lastSeen = parseTs(row.last_seen);
  if (lastSeen !== null && (acc.lastSeen === null || lastSeen > acc.lastSeen)) acc.lastSeen = lastSeen;

  if (open) {
    acc.open += 1;
    if (risk === "high") acc.openHigh += 1;
    if (Number(row.reopened_count) > 0) acc.reopenedOpen += 1;
    if (firstSeen !== null && (acc.oldestOpenFirstSeen === null || firstSeen < acc.oldestOpenFirstSeen)) {
      acc.oldestOpenFirstSeen = firstSeen;
    }
  }

  const moves: [MovementKind, unknown][] = [
    ["resolved", row.resolved_at],
    ["removed", row.removed_at],
    ["rotated", row.rotated_at],
  ];
  for (const [kind, value] of moves) {
    const ms = parseTs(value);
    if (ms === null) continue;
    if (
      acc.movementAt === null ||
      ms > acc.movementAt ||
      (ms === acc.movementAt && MOVEMENT_RANK[kind] < MOVEMENT_RANK[acc.movementKind!])
    ) {
      acc.movementAt = ms;
      acc.movementKind = kind;
    }
  }

  if (String(row.resolution_src ?? "") === RESOLUTION_DISAPPEARED) {
    const at = parseTs(row.resolved_at);
    if (at !== null) acc.disappeared.set(at, (acc.disappeared.get(at) ?? 0) + 1);
  }
}

/**
 * Is the scanner still returning this repository?
 *
 * PER SCOPE, and observed if ANY scope reaches its own newest scan — an sca-only sweep must
 * not mark every sast row of a perfectly healthy repository as vanished. The primary test is
 * `last_scan_id === newestScanByScope[scope].scan_id`; a blank `last_scan_id` falls back to
 * `last_seen >= newest.ts`, because an older ledger row can carry the sighting without the
 * scan id. A scope with rows but NO scan on record is undecidable and resolves to observed —
 * and is named in `scopes_without_scan`, so the reader knows which way the doubt fell.
 */
function isObserved(
  acc: RepoAcc,
  newestByScope: Partial<Record<Scope, NewestScan>>,
  scopesWithoutScan: Set<Scope>,
): boolean {
  let observed = false;
  for (const scope of acc.scopes) {
    const newest = newestByScope[scope];
    if (!newest) {
      scopesWithoutScan.add(scope);
      observed = true;
      continue;
    }
    const rows = acc.rowsByScope.get(scope) ?? [];
    const newestTs = parseTs(newest.ts);
    for (const row of rows) {
      if (!blank(row.last_scan_id)) {
        if (!blank(newest.scan_id) && String(row.last_scan_id) === String(newest.scan_id)) {
          observed = true;
          break;
        }
        continue;
      }
      const lastSeen = parseTs(row.last_seen);
      if (newestTs !== null && lastSeen !== null && lastSeen >= newestTs) {
        observed = true;
        break;
      }
    }
  }
  return observed;
}

/** `[0,t/3) [t/3,2t/3) [2t/3,t) [t,∞)` — bucket 3 is cold, by construction. */
function bucketOf(readingDays: number, t: number): number {
  if (readingDays >= t) return 3;
  if (readingDays >= (2 * t) / 3) return 2;
  if (readingDays >= t / 3) return 1;
  return 0;
}

// --------------------------------------------------------------------------- the entry point

/**
 * The cold-zone profile: one row per repository, one per product, and the totals.
 *
 * The verdict table, first match wins — the ORDER is the contract. Rule 0 is the operator's
 * and runs before the clock is read at all; rules 1-6 are the register's:
 *
 *   0  excludeEndOfLife && the repository's lifecycle is end-of-life      not measured here
 *   1  no row reaches the newest scan of any scope the repo has rows in   unobserved
 *   2  open_findings === 0                                                clear
 *   3  idle_days !== null    && idle_days       >= coldAfterDays          cold (measured)
 *   4  idle_days === null    && idle_bound_days >= coldAfterDays          cold (bound)
 *   5  idle_days !== null                                                 warm
 *   6  otherwise (no movement, bound under threshold)                     watching
 *
 * Rule 1 sits first for the reason the module header gives: disappearance-resolution makes a
 * drop-out look mass-remediated, so coverage is decided before remediation is read. Rule 4
 * exists because a repository that has NEVER closed anything is the strongest possible case
 * of cold, and refusing to say so just because nothing was measured would hide exactly the
 * repositories this page is for — the bound is published alongside so the claim is auditable.
 * Rule 6 is the honest remainder: no movement, and not enough watched time to call it.
 *
 * Rule 0 sits above all of them because an excluded repository must not be in the population
 * the relative line is derived FROM, not merely absent from the table afterwards — a cut
 * applied later would move the line and then hide the repositories that moved it.
 */
export function coldZoneProfile(rows: ColdRow[], opts: ColdZoneOptions): ColdZoneResult {
  // REFUSE BEFORE CASTING. A typo in a timestamp would otherwise silently publish a
  // duration measured from the epoch, and every repository would be cold. See assets.ts.
  const nowMs = parseTs(opts.now);
  if (nowMs === null) {
    throw new Error(`coldZoneProfile: unparseable now (${JSON.stringify(opts.now)})`);
  }
  const observedFromOpt = opts.observedFrom ?? null;
  const observedFromMs = observedFromOpt === null ? null : parseTs(observedFromOpt);
  if (observedFromOpt !== null && observedFromMs === null) {
    throw new Error(
      `coldZoneProfile: unparseable observedFrom (${JSON.stringify(observedFromOpt)})`,
    );
  }
  const t = Number(opts.coldAfterDays);
  if (!Number.isFinite(t) || t <= 0) {
    // The buckets are thirds of this number; a zero or a NaN would make every edge
    // meaningless and every repository cold. Clamping belongs in the settings layer
    // (`COLD_AFTER_DAYS_MIN`/`MAX`), so anything that gets past it is a caller bug.
    throw new Error(`coldZoneProfile: coldAfterDays must be a positive number (${String(opts.coldAfterDays)})`);
  }

  // The mode, and the two options it makes REQUIRED. Relative mode without a target or a
  // floor is not a shape this module can guess its way out of: a default target would be a
  // second place a published share could come from, and a missing floor would let a healthy
  // estate's sort order decide who is cold. Both refusals are caller bugs — the settings
  // layer clamps these to `config`'s bounds before they ever get here.
  const mode: ColdZoneMode = opts.mode ?? DEFAULT_COLD_ZONE_MODE;
  if (!COLD_ZONE_MODES.includes(mode)) {
    throw new Error(
      `coldZoneProfile: mode must be one of ${COLD_ZONE_MODES.join(" | ")} (${JSON.stringify(opts.mode)})`,
    );
  }
  const relative = mode === "relative";
  const targetSharePct = relative ? Number(opts.targetSharePct) : null;
  const floorDays = relative ? Number(opts.floorDays) : null;
  if (relative && (!Number.isFinite(targetSharePct!) || targetSharePct! <= 0 || targetSharePct! > 100)) {
    throw new Error(
      `coldZoneProfile: relative mode requires targetSharePct in (0, 100] (${String(opts.targetSharePct)})`,
    );
  }
  if (relative && (!Number.isFinite(floorDays!) || floorDays! <= 0)) {
    throw new Error(
      `coldZoneProfile: relative mode requires floorDays to be a positive number (${String(opts.floorDays)})`,
    );
  }

  // Classify once, over every row — the counts below report on what was handed in, not on
  // what survived. `secrets` is refused by program.ts and carried as `unknown` rather than
  // thrown on, exactly as assets.ts does it.
  let unclassifiedSecrets = 0;
  const classified: { row: ColdRow; risk: RiskClass }[] = [];
  for (const row of rows) {
    if (row.scope === "secrets") {
      unclassifiedSecrets += 1;
      classified.push({ row, risk: "unknown" });
      continue;
    }
    classified.push({ row, risk: classifyRisk(row, opts.rule) });
  }

  // Rows with no repository belong to no cell of this page. Dropped, and counted.
  let droppedNoRepo = 0;
  const byRepo = new Map<string, RepoAcc>();
  for (const { row, risk } of classified) {
    if (blank(row.repo_id)) {
      droppedNoRepo += 1;
      continue;
    }
    const id = String(row.repo_id).trim();
    let acc = byRepo.get(id);
    if (!acc) {
      acc = newAcc(id);
      byRepo.set(id, acc);
    }
    foldRow(acc, row, risk);
  }

  // ---------------------------------------------------------------- the end-of-life cut
  //
  // DECIDED PER REPOSITORY, AFTER THE FOLD AND BEFORE ANY MEASUREMENT. A lifecycle is a
  // property of a repository, not of a finding, so the question can only be asked once the
  // rows are gathered; and it has to be asked before pass A, because an excluded repository
  // must not sit in the eligible population the relative line is DERIVED from. A cut applied
  // later would move the line and then hide the repositories that moved it.
  //
  // COUNTED IN BOTH SETTINGS, REMOVED IN ONE. `end_of_life_repos` is the whole retired
  // population whatever the caller asked for; `excluded` is the subset that actually left.
  // With the option off the two disagree by design, and that difference is the sentence the
  // page puts in front of an operator who has not found the setting yet.
  const excludeEol = opts.excludeEndOfLife === true;
  const excludedIds = new Set<string>();
  let endOfLifeRepos = 0;
  let excludedOpenFindings = 0;
  for (const acc of byRepo.values()) {
    if (!isEndOfLife(acc.lifecycle)) continue;
    endOfLifeRepos += 1;
    if (!excludeEol) continue;
    excludedIds.add(acc.repoId);
    excludedOpenFindings += acc.open;
  }
  const excludedRepos = excludedIds.size;

  // Observation is decided even when the block is not measurable, so `scopes_without_scan`
  // reports either way — the reader needs to know coverage is undecidable before they need
  // to know how long the silence was.
  //
  // OVER EVERY REPOSITORY, EXCLUDED ONES INCLUDED, and that is deliberate rather than an
  // oversight in the filter below. `scopes_without_scan` is a statement about SCAN COVERAGE —
  // this scope has rows and no scan, so observation cannot be decided for it — and that stays
  // true of a scope whose only rows happen to sit on a retired repository. Narrowing it with
  // the cold population would make a coverage warning disappear because of a display setting.
  const scopesWithoutScan = new Set<Scope>();
  const observedById = new Map<string, boolean>();
  for (const acc of byRepo.values()) {
    observedById.set(acc.repoId, isObserved(acc, opts.newestScanByScope, scopesWithoutScan));
  }
  const scopesWithoutScanList = [...scopesWithoutScan].sort(cmp);

  const base = {
    observed_from: observedFromMs === null ? null : toIso(observedFromMs),
    as_of: toIso(nowMs)!,
    exclude_end_of_life: excludeEol,
    end_of_life_repos: endOfLifeRepos,
    excluded_end_of_life: excludedRepos,
    excluded_open_findings: excludedOpenFindings,
    row_count: rows.length,
    dropped_no_repo: droppedNoRepo,
    unclassified_secrets: unclassifiedSecrets,
    scopes_without_scan: scopesWithoutScanList,
  };
  const modeBase = {
    mode,
    fixed_after_days: t,
    target_share_pct: targetSharePct,
    floor_days: floorDays,
  };

  if (observedFromMs === null) {
    // No clock, so no population, so nothing to derive a line FROM. In relative mode the line
    // still has to be a number the page can print, and the only number that owes nothing to a
    // population we could not read is the floor. `derived_days`, `eligible_repos` and
    // `cold_bound_only` are null for the same reason `repos` is: they are facts about an
    // estate this read never got to look at.
    return {
      measurable: false,
      ...modeBase,
      cold_after_days: relative ? floorDays! : t,
      achieved_share_pct: null,
      floor_applied: false,
      derived_days: null,
      eligible_repos: null,
      cold_bound_only: null,
      ...base,
      bucket_edges: null,
      bucket_labels: null,
      repos: null,
      teams: null,
      totals: null,
    };
  }

  // ---------------------------------------------------------------- pass A: what the
  // threshold cannot change. Idle time, the bound, observation and the drop-out fingerprint
  // are all decided before any line is drawn — which is exactly why the relative line can be
  // derived from them without a fixed-point iteration. `unobserved` and `clear` are
  // threshold-independent too, so the eligible population is knowable here.
  const facts: RepoFacts[] = [];
  for (const acc of byRepo.values()) {
    // The cut, applied once. Everything downstream — the eligible population, the derived
    // line, the verdicts, the buckets, the roll-up and the totals — is built from `facts`, so
    // skipping here is the whole exclusion and there is no second place to keep in step.
    if (excludedIds.has(acc.repoId)) continue;
    const observed = observedById.get(acc.repoId) === true;
    const idleDays = acc.movementAt === null ? null : daysBetween(acc.movementAt, nowMs);
    // The bound: the later of "when we started watching" and "when this repository's oldest
    // finding was first seen". Watching time before the repository existed is not silence
    // anybody could have broken, and neither is the repository's life before we looked.
    const boundStart =
      acc.earliestFirstSeen === null ? observedFromMs : Math.max(observedFromMs, acc.earliestFirstSeen);
    const idleBoundDays = idleDays === null ? daysBetween(boundStart, nowMs) : null;
    const idleReading = idleDays ?? idleBoundDays;

    let disappearedAt: number | null = null;
    let disappearedCount = 0;
    for (const [at, count] of acc.disappeared) {
      // The MODE, with the later instant winning a tie: a mass close is one scan's event,
      // and the most recent one is the drop-out the reader is looking at.
      if (count > disappearedCount || (count === disappearedCount && disappearedAt !== null && at > disappearedAt)) {
        disappearedAt = at;
        disappearedCount = count;
      }
    }

    facts.push({
      acc,
      observed,
      idleDays,
      idleBoundDays,
      idleReading,
      disappearedAt,
      disappearedCount,
      // Eligible for the share: still scanned, and something is still open on it. A repository
      // the scanner lost is not evidence about engagement, and one with nothing open cannot be
      // in a zone that measures unclosed work.
      eligible: observed && acc.open > 0,
    });
  }

  // ---------------------------------------------------------------- the derivation
  const eligible = facts.filter((f) => f.eligible);
  const eligibleRepos = eligible.length;
  let derivedDays: number | null = null;
  let floorApplied = false;
  let effective = t;
  if (relative) {
    if (eligibleRepos > 0) {
      // A RANK, NOT `util.quantile`. That helper interpolates between the two neighbouring
      // order statistics, which would put the line at a number NO repository sits on (46.4
      // days between one at 44 and one at 50) and would make the resulting count unpredictable
      // at small n — a "20% cut" that catches 1 of 5 in one estate and 2 of 5 in another with
      // the same shape. The k-th largest reading is a line the reader can go and stand on, and
      // because the test stays `>=`, ties AT that reading are all cold rather than being split
      // by an interpolation nobody can see.
      const readings = eligible.map((f) => f.idleReading!).sort((a, b) => b - a);
      const k = Math.min(eligibleRepos, Math.max(1, Math.ceil((targetSharePct! / 100) * eligibleRepos)));
      // Floored to WHOLE DAYS so `fmtDays` prose and the "≥ N d" cells cannot contradict each
      // other. Flooring can only ever widen the zone, so `cold_repos >= k` still holds.
      derivedDays = Math.floor(readings[k - 1]);
      effective = Math.max(derivedDays, floorDays!);
      floorApplied = derivedDays < floorDays!;
    } else {
      // Nothing to rank. The line rests on the floor, and `derived_days` stays NULL rather
      // than reporting a zero nobody derived. `floor_applied` is false because the floor held
      // nothing back — there was no derived line for it to overrule.
      effective = floorDays!;
      derivedDays = null;
      floorApplied = false;
    }
  }

  const bucketEdges = [0, effective / 3, (2 * effective) / 3, effective];
  const bucketLabels = [
    `${fmtDays(0)}–${fmtDays(effective / 3)} d`,
    `${fmtDays(effective / 3)}–${fmtDays((2 * effective) / 3)} d`,
    `${fmtDays((2 * effective) / 3)}–${fmtDays(effective)} d`,
    `≥ ${fmtDays(effective)} d`,
    "not yet measurable",
  ];

  // ---------------------------------------------------------------- pass B: the verdict and
  // the bucket, read off the EFFECTIVE line — the only place either mode's choice can matter.
  const repos: ColdRepoRow[] = [];
  let coldBoundOnly = 0;
  for (const f of facts) {
    const { acc, observed, idleDays, idleBoundDays, idleReading, disappearedAt, disappearedCount } = f;

    let verdict: ColdVerdict;
    if (!observed) verdict = "unobserved";
    else if (acc.open === 0) verdict = "clear";
    else if (idleDays !== null && idleDays >= effective) verdict = "cold";
    else if (idleDays === null && idleBoundDays !== null && idleBoundDays >= effective) verdict = "cold";
    else if (idleDays !== null) verdict = "warm";
    else verdict = "watching";

    if (verdict === "cold" && idleDays === null) coldBoundOnly += 1;

    const bucket =
      verdict === "unobserved" || verdict === "clear"
        ? null
        : verdict === "watching"
          ? 4
          : bucketOf(idleReading!, effective);

    repos.push({
      repo_id: acc.repoId,
      repo_name: acc.repoName,
      product: acc.product,
      support_group: acc.supportGroup,
      support_group_split: acc.supportGroupSplit,
      lifecycle: acc.lifecycle,
      open_findings: acc.open,
      open_high_risk: acc.openHigh,
      oldest_open_age_days:
        acc.oldestOpenFirstSeen === null ? null : daysBetween(acc.oldestOpenFirstSeen, nowMs),
      last_movement_at: toIso(acc.movementAt),
      last_movement_kind: acc.movementKind,
      idle_days: idleDays,
      idle_bound_days: idleBoundDays,
      idle_is_bound: idleDays === null,
      idle_reading_days: idleReading,
      observed,
      last_observed_at: toIso(acc.lastSeen),
      disappeared_at: toIso(disappearedAt),
      disappeared_at_last_observation: disappearedCount,
      reopened_open: acc.reopenedOpen,
      verdict,
      cold: verdict === "cold",
      bucket,
    });
  }

  repos.sort(
    (a, b) =>
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      b.open_findings - a.open_findings ||
      cmp(a.repo_name ?? a.repo_id, b.repo_name ?? b.repo_id),
  );

  const teams = rankTeams(rollUp(repos), mode, targetSharePct);
  const totals = totalsOf(repos, teams);

  return {
    measurable: true,
    ...modeBase,
    cold_after_days: effective,
    achieved_share_pct: totals.cold_repo_share_pct,
    floor_applied: floorApplied,
    derived_days: derivedDays,
    eligible_repos: eligibleRepos,
    cold_bound_only: coldBoundOnly,
    ...base,
    bucket_edges: bucketEdges,
    bucket_labels: bucketLabels,
    repos,
    teams,
    totals,
  };
}

/**
 * Per PRODUCT, with the support group carried alongside. The NULL key is a real bucket and is
 * labelled `COLD_PRODUCT_NONE` — it is never dropped and never pinned last, because "nobody
 * owns these repositories" is one of the answers the page exists to give, not a gap in the
 * data to be tidied away.
 *
 * ROLLED UP BY THE FINER GRAIN, DELIBERATELY, even though this type is called a TEAM row and
 * a support group is literally the team. The verdicts and the coldest-share badge are
 * calibrated on this population: over a dozen support groups instead of a hundred products,
 * `cold_share_pct` means a different thing and the glossary entry stops being true. A group
 * whose products are individually fine can also be fine in aggregate while one of them has
 * gone completely dark, and that is exactly what the page exists to surface.
 *
 * So the group rides as a COLUMN instead — the escalation path from a cold product, reachable
 * without a second table calibrated on a second population. That also makes honest something
 * this type only ever approximated: a "team" here was always the finest ownership the ledger
 * could name, and now the reader can see the team above it.
 */
function rollUp(repos: ColdRepoRow[]): ColdTeamRow[] {
  const byProduct = new Map<string | null, ColdRepoRow[]>();
  for (const r of repos) {
    const list = byProduct.get(r.product);
    if (list) list.push(r);
    else byProduct.set(r.product, [r]);
  }

  const out: ColdTeamRow[] = [];
  for (const [product, list] of byProduct) {
    const buckets = [0, 0, 0, 0, 0];
    const bucketOpen = [0, 0, 0, 0, 0];
    let observed = 0;
    let unobserved = 0;
    let withOpen = 0;
    let coldRepos = 0;
    let watching = 0;
    let warm = 0;
    let clear = 0;
    let openFindings = 0;
    let openInCold = 0;
    let highInCold = 0;
    let openInUnobserved = 0;
    let lastMovement: number | null = null;

    for (const r of list) {
      openFindings += r.open_findings;
      if (r.observed) {
        observed += 1;
        // Over OBSERVED repositories only: a drop-out's disappearance close is the scanner's
        // event, not this team's work, and must not refresh the team's last-movement date.
        const at = parseTs(r.last_movement_at);
        if (at !== null && (lastMovement === null || at > lastMovement)) lastMovement = at;
      } else {
        unobserved += 1;
        openInUnobserved += r.open_findings;
      }
      if (r.bucket !== null) {
        buckets[r.bucket] += 1;
        bucketOpen[r.bucket] += r.open_findings;
      }
      switch (r.verdict) {
        case "cold":
          coldRepos += 1;
          withOpen += 1;
          openInCold += r.open_findings;
          highInCold += r.open_high_risk;
          break;
        case "warm":
          warm += 1;
          withOpen += 1;
          break;
        case "watching":
          watching += 1;
          withOpen += 1;
          break;
        case "clear":
          clear += 1;
          break;
        default:
          break;
      }
    }

    const verdict: TeamVerdict =
      withOpen === 0 ? "clear" : coldRepos === withOpen ? "fully-cold" : coldRepos > 0 ? "partly-cold" : "warm";

    const groups = new Set<string>();
    let split = false;
    for (const r of list) {
      if (r.support_group !== null) groups.add(r.support_group);
      if (r.support_group_split) split = true;
    }
    // A repository filed under several groups makes the union below an UNDERCOUNT, so the
    // count is floored at two: the honest answer is "more than one", and the column's job is
    // only to stop asserting one.
    const groupCount = split ? Math.max(groups.size, 2) : groups.size;

    out.push({
      product,
      label: product ?? COLD_PRODUCT_NONE,
      // One name only when they all agree — see the field's own comment.
      support_group: groupCount === 1 ? [...groups][0]! : null,
      support_groups: groupCount,
      repos: list.length,
      repos_observed: observed,
      repos_unobserved: unobserved,
      repos_with_open: withOpen,
      cold_repos: coldRepos,
      watching_repos: watching,
      warm_repos: warm,
      clear_repos: clear,
      open_findings: openFindings,
      open_in_cold: openInCold,
      high_risk_in_cold: highInCold,
      open_in_unobserved: openInUnobserved,
      cold_share_pct: safePct(coldRepos, withOpen),
      last_movement_at: toIso(lastMovement),
      verdict,
      // Filled by `rankTeams`, which runs over the finished roll-up: the rank is a fact about
      // the whole set of products, so no single product's fold can know it.
      relative_rank: null,
      in_coldest_share: false,
      buckets,
      bucket_open: bucketOpen,
    });
  }

  out.sort(
    (a, b) => b.cold_repos - a.cold_repos || b.open_in_cold - a.open_in_cold || cmp(a.label, b.label),
  );
  return out;
}

/**
 * The team-level relative position, added to the finished roll-up WITHOUT reordering it.
 *
 * The published order is the one `rollUp` set (cold repositories desc), because that is the
 * order the table is read in and changing it under a reader would be a different page. The
 * rank is a separate column measured on a different axis — the SHARE of a product's
 * open-finding repositories that are cold, so a product with three cold repositories out of
 * three outranks one with five out of fifty. Tie-breaks: `open_in_cold` desc, then label asc
 * for determinism.
 *
 * Three refusals, all of them about not badging somebody the arithmetic merely swept up:
 *   * Only products with `repos_with_open > 0` are ranked at all. A product with nothing open
 *     has a NULL cold share, and a rank over a null is an invention.
 *   * `C` — the ranked products that actually have a cold repository — CLAMPS the badge.
 *     "The coldest 20%" of an estate where only one product has anything cold is that one
 *     product, never a second one whose cold share is zero.
 *   * Ties at the cutoff are extended through, on `(cold_share_pct, open_in_cold)`. The label
 *     tie-break orders the table; it must never decide a badge, because that would make the
 *     mark a fact about spelling.
 *
 * Fixed mode still computes the ranks — the payload has one shape in both modes, and the
 * column can be read without the badge — but marks nobody: `in_coldest_share` is a statement
 * about a target share, and fixed mode never named one.
 */
function rankTeams(
  teams: ColdTeamRow[],
  mode: ColdZoneMode,
  targetSharePct: number | null,
): ColdTeamRow[] {
  const ranked = teams
    .filter((team) => team.repos_with_open > 0)
    .sort(
      (a, b) =>
        (b.cold_share_pct ?? 0) - (a.cold_share_pct ?? 0) ||
        b.open_in_cold - a.open_in_cold ||
        cmp(a.label, b.label),
    );
  const rankOf = new Map<ColdTeamRow, number>();
  ranked.forEach((team, i) => rankOf.set(team, i + 1));

  const total = ranked.length;
  const withCold = ranked.filter((team) => team.cold_repos > 0).length;
  let want = 0;
  if (mode === "relative" && withCold > 0 && targetSharePct !== null) {
    want = Math.min(withCold, Math.max(1, Math.ceil((targetSharePct / 100) * total)));
    // Extend through a tie at the cutoff — see the refusals above. The walk stops at `withCold`
    // by construction as well as by the guard: every product past that point has a cold share
    // of 0, which cannot tie with the share of a product that has a cold repository.
    while (
      want < withCold &&
      (ranked[want].cold_share_pct ?? 0) === (ranked[want - 1].cold_share_pct ?? 0) &&
      ranked[want].open_in_cold === ranked[want - 1].open_in_cold
    ) {
      want += 1;
    }
  }

  // A NEW array in the PUBLISHED order — `rankTeams` is pure and the caller's sort survives it.
  return teams.map((team) => {
    const rank = rankOf.get(team) ?? null;
    return { ...team, relative_rank: rank, in_coldest_share: rank !== null && rank <= want };
  });
}

function totalsOf(repos: ColdRepoRow[], teams: ColdTeamRow[]): ColdZoneTotals {
  const buckets = [0, 0, 0, 0, 0];
  const bucketOpen = [0, 0, 0, 0, 0];
  const t: ColdZoneTotals = {
    repos: repos.length,
    repos_observed: 0,
    repos_unobserved: 0,
    repos_with_open: 0,
    cold_repos: 0,
    watching_repos: 0,
    warm_repos: 0,
    clear_repos: 0,
    open_findings: 0,
    open_in_cold: 0,
    high_risk_in_cold: 0,
    open_in_unobserved: 0,
    cold_repo_share_pct: null,
    cold_backlog_share_pct: null,
    teams: teams.length,
    teams_fully_cold: 0,
    teams_partly_cold: 0,
    teams_in_coldest_share: 0,
    repos_no_product: 0,
    buckets,
    bucket_open: bucketOpen,
  };

  for (const team of teams) {
    t.repos_observed += team.repos_observed;
    t.repos_unobserved += team.repos_unobserved;
    t.repos_with_open += team.repos_with_open;
    t.cold_repos += team.cold_repos;
    t.watching_repos += team.watching_repos;
    t.warm_repos += team.warm_repos;
    t.clear_repos += team.clear_repos;
    t.open_findings += team.open_findings;
    t.open_in_cold += team.open_in_cold;
    t.high_risk_in_cold += team.high_risk_in_cold;
    t.open_in_unobserved += team.open_in_unobserved;
    if (team.verdict === "fully-cold") t.teams_fully_cold += 1;
    if (team.verdict === "partly-cold") t.teams_partly_cold += 1;
    // Counted off the rows themselves rather than passed in from the derivation, so the
    // figure and the marks on the table can never disagree about how many were badged.
    if (team.in_coldest_share) t.teams_in_coldest_share += 1;
    if (team.product === null) t.repos_no_product = team.repos;
    for (let i = 0; i < 5; i += 1) {
      buckets[i] += team.buckets[i];
      bucketOpen[i] += team.bucket_open[i];
    }
  }

  t.cold_repo_share_pct = safePct(t.cold_repos, t.repos_with_open);
  t.cold_backlog_share_pct = safePct(t.open_in_cold, t.open_findings);
  return t;
}

/**
 * The Executive card's slice: the totals, the clock and the threshold — never the arrays.
 *
 * CAPPED IN THE MODEL, NOT SLICED AT THE EDGE (the `fixNext` pattern). A page that received
 * the whole profile and rendered one number would ship every repository name in the estate
 * into a payload that had no use for them, and the next reader of that payload would have no
 * way to know which half was meant to be drawn.
 */
export function coldZoneHeadline(result: ColdZoneResult): ColdZoneHeadline {
  return {
    measurable: result.measurable,
    mode: result.mode,
    cold_after_days: result.cold_after_days,
    fixed_after_days: result.fixed_after_days,
    target_share_pct: result.target_share_pct,
    achieved_share_pct: result.achieved_share_pct,
    floor_days: result.floor_days,
    floor_applied: result.floor_applied,
    derived_days: result.derived_days,
    eligible_repos: result.eligible_repos,
    cold_bound_only: result.cold_bound_only,
    exclude_end_of_life: result.exclude_end_of_life,
    end_of_life_repos: result.end_of_life_repos,
    excluded_end_of_life: result.excluded_end_of_life,
    excluded_open_findings: result.excluded_open_findings,
    observed_from: result.observed_from,
    as_of: result.as_of,
    totals: result.totals,
    row_count: result.row_count,
    dropped_no_repo: result.dropped_no_repo,
    unclassified_secrets: result.unclassified_secrets,
    scopes_without_scan: result.scopes_without_scan,
  };
}
