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
 * The redundant cue. Severity never carries meaning by colour alone — every mark pairs its
 * fill with one of these and a word (PRODUCT.md, Accessibility). The red/orange/amber band
 * is a measured colourblind risk: HIGH and MEDIUM sit 6.7 apart in normal vision and 1.6
 * apart under deuteranopia, so these are load-bearing rather than decorative.
 */
export const SEVERITY_GLYPHS: Record<string, string> = {
  CRITICAL: "●",
  HIGH: "▲",
  MEDIUM: "■",
  LOW: "◆",
  INFO: "○",
  UNKNOWN: "—",
};

/**
 * Remediation windows in days.
 *
 * Identical to gas/ and to brick/devsecops/config.py, and that is a decision rather than an
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
 * `sca` and `sast` keep CRITICAL/HIGH, which is brick/devsecops's default and is not a claim
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



/** Statuses that mean "not open". Mirrors brick/devsecops/config.py RESOLVED_STATUSES. */
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

/**
 * Bumped when a stored derivation's INPUTS change shape. Anything that changes WHICH rows
 * a derivation reads has to move this, or a persisted result is silently reused across the
 * change and the knob appears to do nothing.
 */
export const DERIVATION_VERSION = 1;

// --------------------------------------------------------------------------------------- //
//  Risk classification — Prioritization to Prediction (P2P). brick/devsecops/config.py is
//  the source for everything below through ruleForScope, unless a comment says otherwise.
// --------------------------------------------------------------------------------------- //

/**
 * The high-risk classifier for CVE-bearing findings (sca): an any-of over the exploit
 * signals Wiz attaches. Mirrors gas/src/domain/program.ts's `RiskRule` / `DEFAULT_RISK_RULE`
 * (camelCase field names kept for consistency with that file, which this constant will be
 * unified with once program.ts is ported here) — itself the TS shape of brick's `RiskRule`
 * dataclass, brick/devsecops/config.py:279-312. Not in the D1 brief's explicit list, but
 * `ruleForScope`'s sca branch has nothing else to return; porting it here rather than
 * inventing a placeholder keeps the eventual program.ts port a pure move, not a rename.
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
 * published exploit and no EPSS score. brick/devsecops/config.py:337-370 (`SastRiskRule` /
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
 * brick/devsecops/config.py:382-408 (`CWE_TOP_25_2024`), copied verbatim — 25 entries,
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
 * child is matched through its Top-25 ancestor. brick/devsecops/config.py:424-441
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
 * `aiAnalysis.verdict` values that count as the AI triage firing. brick/devsecops/config.py:450
 * (`AI_VERDICTS_HIGH`). UNVERIFIED against the live tenant — every node in the captured SAST
 * response has `aiAnalysis: null` (brick's comment), so this is a guess at the vocabulary and
 * will not fire until corrected against real data.
 */
export const AI_VERDICTS_HIGH: ReadonlySet<string> = new Set([
  "EXPLOITABLE", "TRUE_POSITIVE", "CONFIRMED", "VULNERABLE",
]);

/**
 * The high-risk rule a scope is classified under. brick/devsecops/config.py:453-461
 * (`rule_for_scope`), extended to all three scopes rather than brick's CVE-register-or-SAST
 * dispatch — secrets never existed in brick/devsecops, so brick had nothing to say about it.
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
 * brick/devsecops/config.py:467 (`NET_CAPACITY_BAND_PCT`). P2P v3 Fig. 22 splits firms into
 * falling behind / maintaining / gaining ground without a sharp cut; a one-finding swing
 * should not flip a monthly verdict.
 */
export const NET_CAPACITY_BAND_PCT = 2;

/** The row label used for the all-severities aggregate in gold tables. brick/devsecops/config.py:470. */
export const OVERALL = "OVERALL";

/**
 * Which population a capacity row describes — every finding vs. high-risk lifecycles only.
 * brick/devsecops/config.py:482-483 (`POPULATION_ALL` / `POPULATION_HIGH_RISK`).
 */
export const POPULATION_ALL = "all";
export const POPULATION_HIGH_RISK = "high_risk";

/**
 * The asset-category fallback for a scope with no language/ecosystem to group on.
 * brick/devsecops/config.py:272 (`ASSET_GROUP_UNKNOWN`).
 */
export const ASSET_GROUP_UNKNOWN = "UNKNOWN";

/**
 * Disappearance-resolution timestamping default: "scan_ts" (conservative) or "midpoint".
 * gas/src/domain/config.ts:81 (`DISAPPEARANCE_RESOLUTION`); brick/devsecops/config.py:501
 * mirrors the same value for the same reason.
 */
export const DISAPPEARANCE_RESOLUTION = "scan_ts";

/** Retention / compaction guardrail: minimum unsealed flat scans to keep. gas/src/domain/config.ts:94. */
export const MIN_UNSEALED_FLAT_SCANS = 2;

/** Retention / compaction guardrail: default retention window, in days. gas/src/domain/config.ts:92. */
export const DEFAULT_RETENTION_DAYS = 180;
