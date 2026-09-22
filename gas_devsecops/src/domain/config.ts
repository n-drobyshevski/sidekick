// The register's vocabulary: severities, remediation windows, and the three scopes.
//
// SEVERITY IS SHARED, DELIBERATELY. These six fills and their darkened text twins are
// byte-identical to gas/src/domain/config.ts and gas_ai/src/domain/config.ts, and
// test/tokens.test.ts holds them there. A severity has to mean the same thing in every
// sidekick; the brand accent deliberately does not, which is why the accent never appears
// in this file. See src/client/styles/tokens.css for the accent and why it is split.

export const SEVERITY_ORDER = [
  "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN",
] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

// UNKNOWN is a local normalization bucket, never an API value — not user-selectable.
export const SELECTABLE_SEVERITIES = SEVERITY_ORDER.filter((s) => s !== "UNKNOWN");

/** Graphical marks — dots, bars, chart series. Tuned to >= 3:1 on white. */
export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#d97706",
  LOW: "#2563eb",
  INFO: "#64748b",
  UNKNOWN: "#475569",
};

/**
 * Coloured LABELS, darkened from the fill so they clear 4.5:1 on their own pale tint.
 * Never set severity text in the fill colour — that split is the whole rule.
 */
export const SEVERITY_TEXT: Record<string, string> = {
  CRITICAL: "#b91c1c",
  HIGH: "#c2410c",
  MEDIUM: "#b45309",
  LOW: "#1d4ed8",
  INFO: "#475569",
  UNKNOWN: "#334155",
};

/**
 * Remediation windows in days.
 *
 * Identical to gas/ and to brick/config.py, and that is a decision rather than an
 * accident: a CRITICAL finding gets seven days whether it is a host CVE, a dependency CVE
 * or a hardcoded secret, so the four surfaces cannot report different SLA attainment for
 * the same estate. In SLA means resolved ON OR BEFORE the target — the comparison is
 * inclusive, and brick's test suite pins that too.
 */
export const SLA_TARGETS: Record<string, number> = {
  CRITICAL: 7,
  HIGH: 14,
  MEDIUM: 30,
  LOW: 90,
  INFO: 180,
};

/**
 * The cold-zone window in days: how long a repository can go without a finding being
 * resolved, removed or rotated before `src/domain/coldZone.ts` calls it cold.
 *
 * 90 DAYS IS A CHOICE, NOT A MEASUREMENT, and it sits here beside `SLA_TARGETS` because it
 * is the same kind of fact — an operator's statement of what "too long" means, which the
 * Settings page can change. It is deliberately NOT one of the SLA targets: those ask "was
 * THIS finding fixed in time", one row at a time, and every one of them would still be met
 * by a repository nobody has opened in a year as long as the findings on it are LOW. This
 * asks the other question — has anything at all happened here — so it is a single window for
 * the whole repository and it matches the longest routine remediation window (LOW = 90 d):
 * a quarter with no movement of any severity is a silence, not a backlog.
 *
 * The bounds are guardrails for the settings clamp, and each end is a refusal:
 *   MIN 7    below a week the figure measures the scan cadence, not engagement — a register
 *            synced weekly would show every repository cold on the first quiet Monday.
 *   MAX 365  past a year "cold" stops being actionable; a repository silent for longer than
 *            the retention window has nothing left on record to explain the silence with.
 */
export const DEFAULT_COLD_AFTER_DAYS = 90;
export const COLD_AFTER_DAYS_MIN = 7;
export const COLD_AFTER_DAYS_MAX = 365;

/**
 * The SECOND way to draw the same line: relative ("dynamic") cold zoning.
 *
 * `fixed` is the window above — a repository is cold after `coldAfterDays` of silence, and
 * the number means the same thing on every estate. `relative` asks the other question: which
 * repositories are the idlest COMPARED WITH THE REST OF THIS ESTATE? The operator names a
 * share (the idlest 20%, say) and the line in days is derived from the population, so it
 * follows the estate instead of standing still while the estate moves underneath it.
 *
 * WHY A SHARE IS A LEGITIMATE DEFINITION, and not just a prettier way to sort:
 *   * EPSS publishes a PERCENTILE beside its probability for exactly this reason — a raw
 *     score is unreadable without the distribution it came from, and a percentile line stays
 *     consistent as the distribution shifts, where a fixed line silently changes meaning.
 *   * "the top Y% of assets by relative risk" is an established alternative to fixed numeric
 *     thresholds in security dashboards, because it bounds the work the number creates.
 *   * Idle times are HEAVY-TAILED (a few repositories silent for years, most for days). That
 *     is the regime where data-driven cuts — head/tail breaks, Jiang 2013 — beat fixed bins,
 *     because a fixed bin over a heavy tail either catches everything or nothing.
 *
 * WHAT A DATA-DRIVEN CUT GETS WRONG, and what is here to catch it. Any "idlest X%" rule will
 * name somebody, however healthy the estate, and that is a slander the register has to be
 * able to refuse. Two failure modes, two answers:
 *   1  SMALL n. With four repositories carrying open findings, the idlest 20% is one
 *      repository — whoever happens to be last, even at three days of silence.
 *   2  ALL-SIMILAR population. If every repository was touched this week, the idlest 20% are
 *      still only a few days idle, and calling them cold measures nothing but the sort order.
 * Both are answered by `DEFAULT_COLD_FLOOR_DAYS`: the derived line is never allowed below the
 * floor, so a fresh or well-tended estate simply reports fewer cold repositories than the
 * target asked for — and `coldZone.ts` publishes `derived_days`, `floor_applied` and the
 * ACHIEVED share beside the target, so the page can say the zone came out smaller than asked
 * rather than pretending the target was met. The reverse (ties at the cutoff pushing the
 * achieved share ABOVE the target) is published the same way.
 *
 * Bounds, and why each end is a refusal:
 *   TARGET MIN 1   below one percent the "share" is a rounding artefact of the estate size.
 *   TARGET MAX 50  past half the estate, "the cold zone" stops naming a minority worth
 *                  looking at and becomes a statement about the register's own cadence.
 *   FLOOR MIN 1    a floor of zero is no floor: it would let the derived line sit at "idle
 *                  since yesterday" on an estate where everything is being worked.
 *   FLOOR MAX      the fixed window's own maximum, so neither mode can draw a line past the
 *                  point where "cold" stops being actionable (see `COLD_AFTER_DAYS_MAX`).
 */
export type ColdZoneMode = "fixed" | "relative";
export const COLD_ZONE_MODES: readonly ColdZoneMode[] = ["fixed", "relative"];
export const DEFAULT_COLD_ZONE_MODE: ColdZoneMode = "fixed";
export const DEFAULT_COLD_TARGET_SHARE_PCT = 20;
export const COLD_TARGET_SHARE_PCT_MIN = 1;
export const COLD_TARGET_SHARE_PCT_MAX = 50;
export const DEFAULT_COLD_FLOOR_DAYS = 14;
export const COLD_FLOOR_DAYS_MIN = 1;
export const COLD_FLOOR_DAYS_MAX = COLD_AFTER_DAYS_MAX;

/**
 * The three registers this product measures, and the ONE identity they share.
 *
 * They are separate scopes rather than a filter column because their remediation clocks
 * differ in kind, not degree:
 *
 *   sca      A CVE in a third-party package. Cannot be fixed before a fixed version
 *            exists, so its clock has to be split into "waiting for a vendor" and
 *            "actionable" or it measures the ecosystem instead of the team.
 *   sast     A weakness class at a file and line in first-party code. No vendor, so no
 *            second clock — and no resolution date either: the type carries `createdAt`
 *            but nothing to close it with, so the death date comes from the finding
 *            disappearing between scans. One end measured, one end estimated, and the
 *            page has to say which is which.
 *   secrets  A credential in the repository. Leaving the register means the string is out
 *            of HEAD; it does NOT mean the credential is dead. Removal and rotation are
 *            two dates because they are two events.
 *
 * `scope` is part of the ledger key for that reason: the same CVE reaching the estate
 * through a dependency and through a host image is two findings with two clocks.
 */
export const SCOPES = ["sca", "sast", "secrets"] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * The severities a sync requests by default, PER SCOPE — because one list cannot serve
 * three registers that mean different things by the word.
 *
 * `sca` and `sast` keep CRITICAL/HIGH, which is brick/'s default and is not a claim
 * about what matters: it is what keeps a first sync inside one execution budget on an estate
 * where a single repository carries ~6,900 SCA findings.
 *
 * SECRETS TAKES NO SEVERITY GATE AT ALL, and that is the settled answer after two wrong
 * ones. The first inherited CRITICAL/HIGH from the vulnerability registers. The second
 * reached to MEDIUM on the strength of "PASSWORD and CERTIFICATE sit below HIGH" — true,
 * and not the same as "they sit at MEDIUM". Measured (PROBE_FINDINGS.md §9.2), on the CODE
 * population:
 *
 *     type                    CRIT   HIGH    MED    LOW   INFO
 *     CERTIFICATE                0      0      0      0    160
 *     PASSWORD                   0      0    107     17     84
 *     SAAS_API_KEY               0    328     45    641    114
 *     CLOUD_KEY                  0    171      0     39      0
 *     PRIVATE_KEY                0    156      0      0      0
 *     DB_CONNECTION_STRING       0     28      0     41     17
 *     GIT_CREDENTIAL             0      8      0      0      2
 *
 * MEDIUM captured 0 of 160 certificates and 107 of 208 passwords, leaving the register at
 * 843 of 1,958 rows — 43%, with one category absent entirely and another halved.
 *
 * SEVERITY IS THE WRONG GATE HERE, which is why walking the floor down kept failing. It
 * grades a DETECTION — 641 SAAS_API_KEY rows sit at LOW — not whether a credential is live.
 * This register asks "which credentials are in the repository, and are they dead yet";
 * `validationStatus` and `confidence` speak to that and severity does not. An empty list
 * sends no severity key at all, which is what buildFilter does with one.
 *
 * Volume was never the reason for a gate here either: the whole CODE population is ~1,958
 * rows, an eighth of SCA.
 */
export const DEFAULT_FETCH_SEVERITIES: Record<Scope, readonly string[]> = {
  sca: ["CRITICAL", "HIGH"],
  sast: ["CRITICAL", "HIGH"],
  secrets: [],
};

export const SCOPE_LABELS: Record<Scope, string> = {
  sca: "Dependencies",
  sast: "Code",
  secrets: "Secrets",
};

/**
 * Projects that are an ORGANISATIONAL TAG rather than a scope.
 *
 * Wiz files a repository under every project that reaches it, and the tenant's GitHub
 * connector puts one project on ALL of them — `GITHUB-DKTUNITED`. It is a true fact about
 * every repository and therefore tells you nothing about any of them: as a switcher row it
 * offers "everything synced" under another name, as an owner it files a repository under the
 * organisation that owns all of them, and as a concentration bucket it answers the question
 * with the population. A dimension that cannot discriminate is not a dimension.
 *
 * MATCHED ON SLUG OR NAME, CASE-INSENSITIVELY, because a project's machine identity here is
 * its slug (`domain/projectScope.ts`) while what a person recognises is its name, and the
 * tenant's slugs are the lower-cased names — listing the name once covers both.
 *
 * A LIST, EXPORTED, because this is the tenant's convention and conventions change: a second
 * connector (a second `GITHUB-…` project, a `JIRA-…`) is one edit here rather than a hunt
 * through the call sites. Spelled out rather than inferred from a `GITHUB-` prefix on
 * purpose — a real business unit is free to be named after the tool it lives in, and guessing
 * would silently hide it. If the list ever has to differ per deployment it becomes a stored
 * setting; one tenant's one entry does not earn a settings page yet.
 *
 * EXCLUDED FROM ANALYSIS, NOT FROM THE LEDGER. `reconcile.ts`'s `projectsJson`/
 * `projectsListJson` still write what Wiz reported, whole — the stored row is the
 * OBSERVATION, and an observation is not ours to edit. The three places that turn projects
 * into an ANSWER drop these: the switcher catalogue and membership predicate
 * (`domain/projectScope.ts::parseProjects`), the owner a row is filed under
 * (`reconcile.ts::ownerProject`, plus `server/ledgerStore.ts` on the way back in, for rows
 * written before this rule existed).
 */
export const ORG_WIDE_PROJECTS: readonly string[] = ["GITHUB-DKTUNITED"];

const ORG_WIDE_KEYS: ReadonlySet<string> = new Set(
  ORG_WIDE_PROJECTS.map((p) => p.trim().toUpperCase()),
);

/**
 * Is any of these labels an organisation-wide project.
 *
 * VARIADIC AND `unknown`-TYPED so the three call sites can each hand it what they hold
 * without a cast: a parsed `{slug, name}`, a raw Wiz `Rec` (`slug` / `id` / `name`, any of
 * them possibly absent), or the bare `owner_project` string read back off a sheet. Anything
 * that is not a non-empty string is simply not a match.
 */
export function isOrgWideProject(...labels: readonly unknown[]): boolean {
  for (const label of labels) {
    if (typeof label !== "string") continue;
    const key = label.trim().toUpperCase();
    if (key !== "" && ORG_WIDE_KEYS.has(key)) return true;
  }
  return false;
}



/** Statuses that mean "not open". Mirrors brick/config.py RESOLVED_STATUSES. */
export const RESOLVED_STATUSES = new Set(["RESOLVED", "REMEDIATED", "FIXED", "CLOSED"]);

export const STATUS_OPEN = "OPEN";
export const STATUS_RESOLVED = "RESOLVED";

/** How a row left the register: the API said so, or it stopped being returned. */
export const RESOLUTION_API = "api";
export const RESOLUTION_DISAPPEARED = "disappeared";

/**
 * EPSS at or above this is treated as a priority signal on its own.
 * Same threshold as gas/ and brick/, for the same reason SLA_TARGETS is.
 */
export const EPSS_PRIORITY_THRESHOLD = 0.1;

// --------------------------------------------------------------------------------------- //
//  Risk classification — Prioritization to Prediction (P2P). brick/config.py is
//  the source for everything below through ruleForScope, unless a comment says otherwise.
// --------------------------------------------------------------------------------------- //

/**
 * The high-risk classifier for CVE-bearing findings (sca): an any-of over the exploit
 * signals Wiz attaches. Mirrors gas/src/domain/program.ts's `RiskRule` / `DEFAULT_RISK_RULE`
 * — itself the TS shape of brick's `RiskRule` dataclass, brick/config.py:279-312.
 *
 * THIS IS THE ONLY DEFINITION IN THE TREE. gas/ declares `RiskRule` inside its program.ts;
 * here it stays in config.ts, because `ruleForScope` below has to live beside the scope
 * table and the settings layer reads its default from here. `src/domain/program.ts` imports
 * both — it does not redeclare them, and a second declaration is the defect this note
 * exists to prevent (two shapes that agree today and drift on the first field added).
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

/**
 * The high-risk classifier for static-analysis findings (sast), where none of RiskRule's
 * three signals exist — a weakness in first-party code has no CVE, so no KEV entry, no
 * published exploit and no EPSS score. brick/config.py:337-370 (`SastRiskRule` /
 * `DEFAULT_SAST_RISK_RULE`). Any-of over three signals that each answer a different question:
 *   cwe        is this a KIND of weakness that gets exploited? (external evidence — see
 *              CWE_TOP_25_2024 below)
 *   aiVerdict  does the scanner's own triage think this instance is real? (vendor opinion —
 *              see AI_VERDICTS_HIGH)
 *   critical   did somebody already say this one is the worst tier? (existing judgement)
 */
export interface SastRiskRule {
  cwe: boolean;
  aiVerdict: boolean;
  critical: boolean;
}

export const DEFAULT_SAST_RISK_RULE: SastRiskRule = {
  cwe: true,
  aiVerdict: true,
  critical: true,
};

/**
 * MITRE's CWE Top 25 Most Dangerous Software Weaknesses, 2024 edition.
 * brick/config.py:382-408 (`CWE_TOP_25_2024`), copied verbatim — 25 entries,
 * asserted by test/ledgerTypes.test.ts. A snapshot that ages: re-derive against the current
 * year's publication rather than trusting this list indefinitely.
 */
export const CWE_TOP_25_2024: readonly string[] = [
  "CWE-79", "CWE-787", "CWE-89", "CWE-352", "CWE-22",
  "CWE-125", "CWE-78", "CWE-416", "CWE-862", "CWE-434",
  "CWE-94", "CWE-20", "CWE-77", "CWE-287", "CWE-269",
  "CWE-502", "CWE-200", "CWE-863", "CWE-918", "CWE-119",
  "CWE-476", "CWE-798", "CWE-190", "CWE-400", "CWE-306",
];

/**
 * CWE is a tree; scanners report leaves and the Top 25 above is mostly interior nodes, so a
 * child is matched through its Top-25 ancestor. brick/config.py:424-441
 * (`CWE_ANCESTORS`), copied verbatim — deliberately incomplete (only children actually seen
 * in the tenant's findings), never a transcription of the full CWE tree. An unmapped child
 * classifies `low` rather than `high`, which is a coverage gap to publish, not paper over.
 */
export const CWE_ANCESTORS: Record<string, string> = {
  "CWE-23": "CWE-22",
  "CWE-36": "CWE-22",
  "CWE-80": "CWE-79",
  "CWE-83": "CWE-79",
  "CWE-91": "CWE-94",
  "CWE-95": "CWE-94",
  "CWE-470": "CWE-94",
  "CWE-1321": "CWE-94",
  "CWE-88": "CWE-77",
  "CWE-611": "CWE-20",
  "CWE-547": "CWE-798",
  "CWE-259": "CWE-798",
  "CWE-321": "CWE-798",
  "CWE-1333": "CWE-400",
  "CWE-732": "CWE-863",
  "CWE-284": "CWE-862",
};

/**
 * `aiAnalysis.verdict` values that count as the AI triage firing. brick/config.py:450
 * (`AI_VERDICTS_HIGH`). UNVERIFIED against the live tenant — every node in the captured SAST
 * response has `aiAnalysis: null` (brick's comment), so this is a guess at the vocabulary and
 * will not fire until corrected against real data.
 */
export const AI_VERDICTS_HIGH: ReadonlySet<string> = new Set([
  "EXPLOITABLE", "TRUE_POSITIVE", "CONFIRMED", "VULNERABLE",
]);

/**
 * The high-risk rule a scope is classified under. brick/config.py:453-461
 * (`rule_for_scope`), extended to all three scopes rather than brick's CVE-register-or-SAST
 * dispatch — secrets never existed in brick/, so brick had nothing to say about it.
 *
 * `secrets` returns null: there is no exploit intelligence for a hardcoded string the way
 * there is for a CVE, and severity here grades a DETECTION (how confident the scanner is
 * that a match is a real credential shape) rather than whether the credential is live — the
 * same argument DEFAULT_FETCH_SEVERITIES.secrets above makes for turning the severity gate
 * off. A secrets finding's risk is answered by validation_state and confidence, not a
 * KEV/exploit/EPSS-style rule, so there is nothing for a RiskRule-shaped classifier to say.
 */
export function ruleForScope(scope: Scope): RiskRule | SastRiskRule | null {
  if (scope === "sca") return DEFAULT_RISK_RULE;
  if (scope === "sast") return DEFAULT_SAST_RISK_RULE;
  return null;
}

// --------------------------------------------------------------------------------------- //
//  Capacity, population labels, and ledger/retention guardrails.
// --------------------------------------------------------------------------------------- //

/**
 * The dead band (percentage points) around zero net flow that still counts as "keeping up".
 * brick/config.py:467 (`NET_CAPACITY_BAND_PCT`). P2P v3 Fig. 22 splits firms into
 * falling behind / maintaining / gaining ground without a sharp cut; a one-finding swing
 * should not flip a monthly verdict.
 */
export const NET_CAPACITY_BAND_PCT = 2;

/** The row label used for the all-severities aggregate in gold tables. brick/config.py:470. */
export const OVERALL = "OVERALL";

/**
 * Which population a capacity row describes — every finding vs. high-risk lifecycles only.
 * brick/config.py:482-483 (`POPULATION_ALL` / `POPULATION_HIGH_RISK`).
 */
export const POPULATION_ALL = "all";
export const POPULATION_HIGH_RISK = "high_risk";

/**
 * The asset-category fallback for a scope with no language/ecosystem to group on.
 * brick/config.py:272 (`ASSET_GROUP_UNKNOWN`).
 */
export const ASSET_GROUP_UNKNOWN = "UNKNOWN";

/**
 * Disappearance-resolution timestamping default: "scan_ts" (conservative) or "midpoint".
 * gas/src/domain/config.ts:81 (`DISAPPEARANCE_RESOLUTION`); brick/config.py:501
 * mirrors the same value for the same reason.
 */
export const DISAPPEARANCE_RESOLUTION = "scan_ts";

/** Retention / compaction guardrail: minimum unsealed flat scans to keep. gas/src/domain/config.ts:94. */
export const MIN_UNSEALED_FLAT_SCANS = 2;

/** Retention / compaction guardrail: default retention window, in days. gas/src/domain/config.ts:92. */
export const DEFAULT_RETENTION_DAYS = 180;

/**
 * The RMST horizon, in days, every `kaplanMeier` call in `server/readModels.ts` and
 * `domain/secretsLifecycle.ts` passes as `opts.horizonDays` (MTTR delayed-entry package).
 *
 * A restricted mean with no restriction at all — τ = whatever the register's own oldest row
 * happens to be — grows with the register's age rather than measuring anything about
 * remediation speed, and on a heavily-censored curve (this product's own motivating case: 49k
 * open against ~1k resolved) it can run to hundreds of days past where the estimate is still
 * trustworthy. 365 (one year) is a chosen reporting window, not a measured statistic — the same
 * kind of reasoned-default this file already carries one of (see `AGE_HISTOGRAM_CAP_DAYS`'s own
 * note): long enough that a CRITICAL-through-LOW spread of SLA targets (7..180 d) fits inside it
 * with room to spare, short enough that one register's outlier decade-old finding cannot dominate
 * the "average days open" figure every page states beside it.
 */
export const RMST_HORIZON_DAYS = 365;

/**
 * `settingsImpact.ts`'s `ageHistogram` measurement horizon, in whole days: an open row older
 * than this is reported as `overCap` rather than binned or, worse, silently extrapolated past
 * the population actually measured.
 *
 * NOT A MEASURED STATISTIC — no production open-age distribution was available to size this
 * against, so 730 (two years) borrows the closest thing this codebase has to a stated opinion
 * on "how far back does anyone actually look": the longest preset gas/'s own retention control
 * already offers an operator (`gas/src/client/js/pages/data.js`'s `[730, "2 years"]`). This
 * register's own `retentionDays` setting has no such preset (a free-form number floored at
 * `RETENTION_MIN_DAYS`), and retention governs SCAN sealing, not finding age, so it is not a
 * cap this constant could simply inherit — it is a fresh, reasoned default an operator can
 * revisit once real backlog ages are on hand to check it against.
 */
export const AGE_HISTOGRAM_CAP_DAYS = 730;
