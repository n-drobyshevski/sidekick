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
    id: "sync",
    term: "Sync",
    lines: [
      "The act: one run reads all three registers from Wiz and saves what it found.",
      "Started from the Run sync button in the rail. One sync saves one scan per register, so a sync and a scan are never the same thing.",
    ],
  },
  {
    id: "scan",
    term: "Scan",
    lines: [
      "The record a sync wrote for one register: what was asked for, when, and how many findings came back.",
      "Three per sync — dependencies, code and secrets — unless a sweep covered fewer. You run a sync; you browse scans.",
      "Wiz's own detectors are a third thing, called the scanner.",
    ],
  },
  {
    id: "lower-bound",
    term: "Lower bound",
    lines: [
      "A duration the curve never reached: more than half of what was tracked is still open, so the median is at least this far out and cannot be read exactly.",
      "Prose says \"at least N days\" and a figure says \"≥ N\" — one notation per context, and inclusive either way, which is why \"more than\" would be a different claim.",
    ],
  },
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
    // The Code register's clock section. `censoring` next door is about a finding that is
    // still OPEN; this is about one that has closed and whose closing DATE is an estimate —
    // the opposite end of the same clock, and the two were being asked to share one entry.
    // The page's own 85-word caveat leads the tip and this is what sits behind it.
    id: "disappearance",
    term: "Dated by disappearance",
    lines: [
      "A finding dated closed at the first scan that stopped returning it, because the API publishes no resolution date for it.",
      "An upper bound whose error is the interval between two scans: \"gone by 12 Aug\", never \"resolved 12 Aug\".",
      "Until two syncs have run and findings have begun to disappear between them, a register dated this way reads near-zero — an absence of observations, not a fast team.",
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
      "A month is gaining, keeping up or falling behind: only capacity absorbs inflow, so the verdict compares the close rate with the arrival rate, not a count, with a dead band around zero.",
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
  // THE THREE EXPLOITATION SIGNALS, one entry each. They used to share the "sca" entry — the
  // definition of the REGISTER — so hovering "CISA KEV", "Known exploit", "EPSS score" or the
  // breakdown tables' "On KEV" column all answered "Software composition analysis: a known CVE
  // in a third-party package at a version", which defines the page rather than the column
  // under the pointer. Each signal says a different thing about exploitation, and the
  // differences are the whole reason the page draws three rows instead of one.
  {
    id: "kev",
    term: "On KEV",
    lines: [
      "CISA's Known Exploited Vulnerabilities catalogue: CVEs with reliable evidence that someone, somewhere, has actually exploited them.",
      "Observed exploitation of the CVE — not a statement that this finding is reachable here. It raises the priority of a finding; it does not decide it.",
      "A row Wiz never evaluated against the catalogue is unknown, not absent from it, which is why these counts are reported as a floor.",
    ],
  },
  {
    id: "known-exploit",
    term: "Known exploit",
    lines: [
      "Public exploit code exists for the CVE.",
      "A weaker claim than KEV and a different one: code being published is not the same as exploitation having been observed. A CVE can carry this and not be on KEV, and the reverse.",
    ],
  },
  {
    id: "epss",
    term: "EPSS score",
    lines: [
      "Exploit Prediction Scoring System: the estimated probability that a CVE will be exploited in the next 30 days.",
      "A FORECAST, not an observation — the one signal here that says what may happen rather than what has. It is a probability, so a high score on a large register still describes many findings that will never be attacked.",
    ],
  },
  // The Code register's one signal, and the only one here that is somebody else's OPINION
  // rather than an observation or a forecast. It shared the "sast" entry — the register's own
  // definition — for the same reason the three above shared "sca".
  {
    id: "ai-verdict",
    term: "AI triage verdict",
    lines: [
      "The scanner's own judgement that a static-analysis finding is real. A vendor opinion, not a measurement this register made — which is why it is one clause of the high-risk rule and never the whole of it.",
      "It has never actually fired in this tenant: every SAST node captured so far carries a null aiAnalysis, so a zero beside it means nobody was asked, not that the AI looked and disagreed.",
      "The values that count are EXPLOITABLE, TRUE_POSITIVE, CONFIRMED and VULNERABLE (domain/config.ts's AI_VERDICTS_HIGH). That vocabulary is UNVERIFIED against this tenant, so a register where every row reads unevaluated means either the field is not being returned or those are the wrong strings — both worth knowing, and neither of them a finding about the code.",
    ],
  },
  {
    id: "signal-coverage",
    term: "Signal coverage",
    lines: [
      "How much of the column a risk clause rests on was ever captured, over the rows that clause applies to.",
      "A measured 0% is a measurement: it separates \u201cthe AI agreed with nothing\u201d from \u201cnobody asked the AI\u201d. \u201cNot applicable\u201d is a third statement \u2014 no row in scope has such a column at all.",
      "The clauses are OR'd and overlap, so what each one fired on never sums to the high-risk count.",
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
  {
    // pages/mttr.js's "SLA window consumed" section label — the SLA read as a distribution,
    // beside the "SLA by severity" table that reads it per severity (term: "sla-target").
    // It rode "Open findings by age" until that section existed: the two lines below describe
    // the DECILES chart (window consumed, and how many are past it), while the age bars are
    // fixed at 7/30/90 days and normalise by nothing.
    id: "sla-band",
    term: "SLA band",
    lines: [
      "An SLA is a band the population is kept inside, not a wall a single finding hits.",
      "Read it as a distribution: how much of the window each open finding has consumed, and how many are already past it.",
    ],
  },
  {
    // pages/history.js's "Coverage by register" label — the per-register table the rail's
    // one status dot summarises.
    //
    // THE COPY IS NOT THE RAIL'S OWN WORDING, and the difference is this file's rule, not a
    // paraphrase. `railStatus.js` labels its states "Never scanned" and "Oldest register
    // scanned N days ago"; the glossary may not spell the ACT with the word scan
    // (test/helpContent.test.js's SCAN_AS_ACT sweep), so the same two states are named here
    // by what was or was not measured.
    id: "rail-status",
    term: "Rail status",
    lines: [
      "Only exceptions speak: a sync running, a sync that failed, nothing to sync with, a register never measured, a scan gone old, or current.",
      "Never-measured outranks old: a register nobody has looked at is unmeasured, not stale.",
    ],
  },
  {
    // The Storage page's three words. Compaction is the act, a sealed scan is what it leaves
    // behind, and an episode is what a finding's row becomes once its scan is sealed — three
    // names for one mechanism, and the page used all three before any of them was defined.
    id: "compaction",
    term: "Compaction",
    lines: [
      "Folding the oldest saved scans into episodes: their per-finding observations are pruned and the scan's own totals are kept.",
      "It reclaims spreadsheet cells and archive bytes. The most recent scans are never candidates, and the dry run states what would go before anything goes.",
    ],
  },
  {
    id: "sealed",
    term: "Sealed",
    lines: [
      "A saved scan whose per-finding observations compaction has already pruned. Its totals stay; the detail behind them is gone.",
      "A sealed scan cannot be deleted from the Storage page — the archive it pointed at was reclaimed when it was sealed.",
    ],
  },
  {
    id: "episode",
    term: "Episode",
    lines: [
      "One finding's settled lifetime — first seen, how it ended, when — kept after the scan that carried it was sealed.",
      "The clock survives compaction; the per-scan observations behind it do not. A finding seen again after its episode begins a new one.",
    ],
  },
  {
    // The Executive front door's "Movement" aside, and Scan history's "What moved the number"
    // section. The method sentence used to sit under the rows as its own paragraph; the rows
    // already carry the chips and the raw pair, so what was left to say was what the
    // comparison is BETWEEN — a definition, which is what a tip is for.
    //
    // THE THIRD LINE IS THE ONE BOTH PAGES LEANED ON AND NEITHER DEFINED. Scan history's
    // 65-word section note said it in its own words; this entry did not say it at all, so a
    // reader who followed the trigger from either page met a definition that reads as though
    // one window covered the whole register. It is third because a tip card shows the first
    // two lines: the general reading leads, and this qualifies it on the Help page.
    id: "movement",
    term: "Movement",
    lines: [
      "The open backlog now against the same register at the previous sync. A rising count is worse.",
      "The comparison is between two syncs, not between two calendar dates — a register only learns anything on the days it looks.",
      "Each register has its own window: the three share one scan log, and a scan of one of them looked at none of the others.",
    ],
  },
  {
    // The Executive front door's "Fix next" section heading. This is the RANKING RULE, and it
    // is a definition rather than a caveat: without it the list is eight repositories in an
    // order nobody can check.
    id: "fix-next",
    term: "Fix next",
    lines: [
      "Ranked by what cannot wait rather than by severity: a credential somebody confirmed is live, then a fixable dependency finding already late, then a critical code weakness already late.",
      "Grouped by repository, because that is the smallest unit somebody can be asked to own.",
    ],
  },
  {
    // The MTTR page's "Open findings by age" legend. NO DAY COUNTS IN THE COPY: the targets
    // are per severity and editable in Settings, and the legend line beside this tip prints
    // whatever the payload actually carries. A glossary that hard-coded 7 / 14 / 30 would be
    // a second place for them to drift.
    id: "sla-edge",
    term: "SLA edge",
    lines: [
      "The day count that splits one severity's open findings into late and not late — its own SLA target, read against the age buckets.",
      "A deadline rarely lands on a bucket's boundary, so a bucket is usually part in and part out; a rule is drawn on the chart only where every severity shares one exact edge.",
    ],
  },
  {
    id: "returned",
    term: "Returned",
    lines: [
      "Seen again after it had been resolved. Its clock restarted on this sighting.",
      "The earlier episode is not in this figure — a returned finding's age counts only from the return.",
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
