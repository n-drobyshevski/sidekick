// The register's glossary: one definition per term, written once, reached from anywhere a
// `tip` carries `{ term }`. The tip card shows the first two lines; the Help page (when it
// arrives) shows the whole entry.
//
// Every entry here is a term this register uses in a way a reader could reasonably get
// wrong — which is why "SAST" is defined and "repository" is not. Where a definition
// encodes a measurement decision, the entry states the decision, because that is exactly
// the thing a reader is entitled to check.

const ENTRIES = [
  {
    id: "half-life",
    term: "Remediation half-life",
    lines: [
      "How long it takes for half of what is open today to be remediated.",
      "Read off a Kaplan–Meier survival curve, so findings that are still open count as evidence rather than being dropped.",
      "Preferred to a mean because remediation is long-tailed: a mean moves when a batch of easy findings closes, and can improve while real exposure does not.",
    ],
  },
  {
    id: "censoring",
    term: "Censored",
    lines: [
      "A finding that is still open has been open at least this long, but we do not know how long it will end up taking.",
      "Dropping those rows and averaging what is left is the single most common way a remediation figure flatters its owner.",
      "The curve keeps them as right-censored observations, which is what makes the half-life honest.",
    ],
  },
  {
    id: "sla-target",
    term: "SLA target",
    lines: [
      "The remediation window for a severity, in days.",
      "In SLA means resolved on or before the target — the comparison is inclusive.",
    ],
  },
  {
    id: "sast",
    term: "SAST",
    lines: [
      "Static analysis of first-party code: a weakness class (CWE) at a file and line.",
      "Fixed by changing the code, so there is no vendor to wait for.",
    ],
  },
  {
    id: "sca",
    term: "SCA",
    lines: [
      "Software composition analysis: a known CVE in a third-party package at a version.",
      "Fixed by upgrading the dependency — which means it cannot be fixed at all until a fixed version exists.",
    ],
  },
  {
    id: "awaiting-fix",
    term: "Awaiting a fix",
    lines: [
      "An open SCA finding whose package has no fixed version published yet.",
      "Counting the wait for a vendor as remediation time measures the vendor, not the team, so these rows are reported separately.",
    ],
  },
  {
    id: "two-clocks",
    term: "The two clocks",
    lines: [
      "Detection to remediation is one clock; it includes any time spent waiting for a fix to exist.",
      "Actionable time is the second: it starts when a fix becomes available, and is the only one the team controls.",
      "Both are published, because either alone can be read as the whole story.",
    ],
  },
  {
    id: "secret-resolved",
    term: "Resolved (secret)",
    lines: [
      "A secret finding leaves the register when the credential is out of the code.",
      "That is not the same as the credential being safe: a committed secret stays live until it is rotated, and git history keeps it readable.",
      "Removal and rotation are tracked separately for that reason.",
    ],
  },
  {
    id: "coverage",
    term: "Coverage",
    lines: [
      "Of everything that deserved remediation, the share that was remediated.",
      "Always published beside efficiency: either one alone can be bought by moving the rule.",
    ],
  },
  {
    id: "efficiency",
    term: "Efficiency",
    lines: [
      "Of everything that was remediated, the share that deserved it.",
      "Always published beside coverage.",
    ],
  },
  {
    id: "validation-state",
    term: "Validation state",
    lines: [
      "Whether Wiz has confirmed a detected credential still works: UNKNOWN, VALID, INVALID or ERROR.",
      "VALID means live, INVALID means confirmed dead — UNKNOWN and ERROR mean nobody has checked, which is neither.",
      "393,443 of 394,927 secret instances in this tenant read UNKNOWN, so folding that into \"not rotated\" would misprice 99.6% of the register.",
    ],
  },
  {
    id: "rotated",
    term: "Rotated",
    lines: [
      "The credential was observed dead: validation state read INVALID and the ledger stamped the date it first did.",
      "Not the same as the secret leaving the code — see Removed.",
    ],
  },
  {
    id: "removed",
    term: "Removed",
    lines: [
      "The secret's string left the repository's HEAD.",
      "Removed is not rotated: the credential is live until Rotated says otherwise, and it is still readable in git history.",
    ],
  },
  {
    id: "time-to-revoke",
    term: "Time to revoke",
    lines: [
      "The clock from detection to confirmed-invalid, reported as median, P90 and share within SLA.",
      "A secret that was never validated is excluded, not censored — it supports no claim about whether it is still alive.",
      "The excluded count is published beside the figure so the denominator can be checked.",
    ],
  },
  {
    id: "foothold",
    term: "Foothold",
    lines: [
      "An asset — a repository or a language group — carrying at least one open high-risk finding.",
      "One is enough: a foothold is a yes/no property of the asset, not a count.",
    ],
  },
  {
    id: "capacity",
    term: "Capacity",
    lines: [
      "Whether remediation is keeping up with new findings arriving, read month by month.",
      "A month is gaining, keeping up, or falling behind, judged by closures against openings against a dead band around zero.",
    ],
  },
  {
    id: "mmcr",
    term: "Monthly mean closure rate",
    lines: [
      "Each month's close rate — closings divided by what was already open at the start of that month — averaged across the months actually observed.",
      "Not closings over new arrivals, and not closings over the whole register: the denominator is that month's starting backlog.",
    ],
  },
  {
    id: "reconstructed",
    term: "Reconstructed month",
    lines: [
      "A month whose figures were rebuilt rather than directly observed, because it ends before this register started watching.",
      "Marked so it is not read as measured — the backlog it describes is real, but nobody was looking in real time.",
    ],
  },
  {
    id: "unclassified",
    term: "Unclassified",
    lines: [
      "A finding the risk rule could not place as high-risk or not — most often a secret, which this register refuses to score by severity.",
      "Reported outside the 2×2 rather than folded into a corner, so it can never be mistaken for a quadrant.",
    ],
  },
  {
    id: "cwe-top-25",
    term: "CWE Top 25",
    lines: [
      "MITRE's 2024 list of the most dangerous software weakness classes, which the SAST risk rule scores against.",
      "A child weakness folds onto its Top-25 ancestor first — CWE-23 counts as CWE-22, CWE-80 as CWE-79 — because scanners report leaves and the list is mostly interior nodes.",
    ],
  },
  {
    id: "twin",
    term: "Twin",
    lines: [
      "One secret at one line, reported once against its repository and once against a branch of it.",
      "The ledger keys on (secret, path, line) and keeps the earlier of the two birth dates — 187 keys in this tenant span both, a median 19.9 days apart.",
      "Keying on Wiz's externalId instead would look unique and quietly double the register.",
    ],
  },
];

/** One entry by id, or null. Callers render nothing rather than guessing. */
export function findEntry(id) {
  const want = String(id || "").trim().toLowerCase();
  if (!want) return null;
  return ENTRIES.find((e) => e.id === want) || null;
}

/** Every entry, in declaration order — the Help page's source. */
export function allEntries() {
  return ENTRIES.slice();
}
