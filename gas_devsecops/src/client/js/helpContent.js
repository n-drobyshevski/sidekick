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
