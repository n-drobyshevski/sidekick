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
 * SECRETS IS DIFFERENT, and inheriting the vulnerability default there was a real defect.
 * Measured on the CODE population (PROBE_FINDINGS.md §8.3): CRITICAL/HIGH deletes
 * PASSWORD 209 -> 0 and CERTIFICATE 160 -> 0 — every one of them sits below HIGH. A secrets
 * register containing no passwords is answering a different question from the one it claims
 * to. Volume was never the reason here either: the whole CODE population is ~1,958 rows,
 * an eighth of SCA.
 *
 * PROVISIONAL, and here is what would falsify it. §8.3 established only that those 369 rows
 * sit BELOW HIGH — not that they sit AT MEDIUM. If they are LOW, this default still yields a
 * register with no passwords in it, which is the exact failure it was chosen to fix. The
 * probe now prints a type x severity crosstab over the CODE population; one run settles it,
 * and if the answer is LOW then this list has to reach further down or drop the filter.
 */
export const DEFAULT_FETCH_SEVERITIES: Record<Scope, readonly string[]> = {
  sca: ["CRITICAL", "HIGH"],
  sast: ["CRITICAL", "HIGH"],
  secrets: ["CRITICAL", "HIGH", "MEDIUM"],
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
