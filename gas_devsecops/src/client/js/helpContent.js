// The register's glossary: one definition per term, written once, reached from anywhere a
// `tip` carries `{ term }`. The tip card shows the first two lines; the Help page (when it
// arrives) shows the whole entry.
//
// THE FIRST TWO LINES ARE A CARD, AND A CARD IS 300px WIDE — about 45 characters to a
// rendered row. Line one says what the thing IS in 110 characters or fewer, line two says the
// one consequence worth a row in 90 or fewer, and the card totals ~150. Everything after line
// two is Help-page prose and can breathe. See root DESIGN.md for the family rule, and
// test/helpContent.test.js's MAX_TIP_LINE_LENGTH for the ceiling this file is held to.
//
// Entries this register shares WORD FOR WORD with gas/helpContent.js — lower-bound, half-life,
// censoring, sla-target, sla-band, kev, known-exploit, epss, sla-edge, returned, episode — are
// kept byte-identical to their opposite numbers there. The vocabulary is per-app on purpose
// (gas_shared/README.md: only the SHAPE of a definition is shared), so the two books cannot be
// merged; keeping the words the same is what stops them drifting apart instead.
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
      "One sync saves one scan per register, so a sync and a scan are never the same thing.",
      "Started from the Run sync button in the rail.",
    ],
  },
  {
    id: "scan",
    term: "Scan",
    lines: [
      "The record a sync wrote for one register: what was asked for, when, how many came back.",
      "Three per sync — dependencies, code and secrets — unless a sweep covered fewer.",
      "You run a sync; you browse scans. Wiz's own detectors are a third thing, called the scanner.",
    ],
  },
  {
    id: "lower-bound",
    term: "Lower bound",
    lines: [
      "A duration the curve never reached, so the median is at least this far out.",
      "More than half of what was tracked is still open and it cannot be read exactly.",
      "Prose says \"at least N days\" and a figure says \"≥ N\" — one notation per context, and inclusive either way, which is why \"more than\" would be a different claim.",
    ],
  },
  {
    id: "half-life",
    term: "Remediation half-life",
    lines: [
      "How long it takes for half of what is open today to be remediated.",
      "Off a Kaplan–Meier curve, so still-open findings count as evidence, not as gaps.",
      "Preferred to a mean because remediation is long-tailed: a mean moves when a batch of easy findings closes, and can improve while real exposure does not.",
      "Fixes are only visible from the day this register started scanning, so each finding counts from the age it had on that day (delayed entry). The curve stops where too few findings remain to trust it. When fewer than half have been fixed within that range the median is \"Not reached\" and the page shows the time by which 25% were fixed instead.",
    ],
  },
  {
    id: "censoring",
    term: "Censored",
    lines: [
      "A still-open finding has been open at least this long; how long it will take is unknown.",
      "Dropping those rows and averaging the rest is how a remediation figure flatters its owner.",
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
      "A finding dated closed at the first scan that stopped returning it.",
      "An upper bound: \"gone by 12 Aug\", never \"resolved 12 Aug\".",
      "The API publishes no resolution date for it, so the error is the interval between two scans.",
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
      "Fixed by upgrading the dependency, so it cannot be fixed at all until a fixed version exists.",
    ],
  },
  {
    id: "awaiting-fix",
    term: "Awaiting a fix",
    lines: [
      "An open SCA finding whose package has no fixed version published yet.",
      "Reported separately: the wait measures the vendor, not the team.",
      "Counting it as remediation time would credit or blame the wrong party.",
    ],
  },
  {
    id: "two-clocks",
    term: "The two clocks",
    lines: [
      "Detection to remediation is one clock, including any wait for a fix to exist.",
      "Actionable time starts once a fix exists — the only one the team controls.",
      "Both are published, because either alone can be read as the whole story.",
    ],
  },
  {
    id: "secret-resolved",
    term: "Resolved (secret)",
    lines: [
      "A secret finding leaves the register when the credential is out of the code.",
      "Not the same as safe: it stays live until rotated, and git history keeps it.",
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
      "Whether Wiz confirmed a credential still works: UNKNOWN, VALID, INVALID, ERROR.",
      "VALID is live, INVALID confirmed dead; UNKNOWN and ERROR are neither.",
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
      "Removed is not rotated: it is live until Rotated says otherwise.",
      "And it is still readable in git history.",
    ],
  },
  {
    id: "time-to-revoke",
    term: "Time to revoke",
    lines: [
      "Detection to confirmed-invalid, as median, P90 and share within SLA.",
      "A never-validated secret is excluded, not censored: it supports no claim.",
      "The excluded count is published beside the figure so the denominator can be checked.",
    ],
  },
  {
    id: "foothold",
    term: "Foothold",
    lines: [
      "An asset — a repository, or a product made of several — carrying at least one open high-risk finding.",
      "One is enough: a foothold is a yes/no property of the asset, not a count.",
    ],
  },
  {
    id: "capacity",
    term: "Capacity",
    lines: [
      "Whether remediation is keeping up with new findings arriving, month by month.",
      "Gaining, keeping up or falling behind — the close rate against the arrival rate.",
      "Only capacity absorbs inflow, so the verdict compares rates rather than counts, with a dead band around zero.",
    ],
  },
  {
    id: "mmcr",
    term: "Monthly mean closure rate",
    lines: [
      "Each month's close rate, averaged across the months actually observed.",
      "The denominator is that month's starting backlog, nothing else.",
      "Closings divided by what was already open at the start of that month — not over new arrivals, and not over the whole register.",
    ],
  },
  {
    // ITS OWN ENTRY, NEXT TO `mmcr` AND FOR THE SAME REASON THAT ONE IS NOT PART OF
    // `capacity`: the tip card renders an entry's first two lines, so a figure folded in as a
    // third line is defined nowhere a reader can reach. This one is also a different KIND of
    // figure from the verdict `capacity` defines — a count, not a comparison.
    id: "closed-per-month",
    term: "Findings closed per month",
    lines: [
      "Findings closed in a mean calendar month, over the months the rate averages over.",
      "The rate's absolute half, which the rate alone cannot supply.",
      "One in ten a month is four findings on a small register and four hundred on a large one.",
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
      "CISA's Known Exploited Vulnerabilities catalogue: CVEs someone has actually exploited.",
      "Reliable evidence about the CVE, not a claim this finding is reachable here.",
      "It raises the priority of a finding; it does not decide it.",
      "A row Wiz never evaluated against the catalogue is unknown, not absent from it, which is why these counts are reported as a floor.",
    ],
  },
  {
    id: "known-exploit",
    term: "Known exploit",
    lines: [
      "Public exploit code exists for the CVE.",
      "Weaker than KEV: code published is not exploitation observed.",
      "A CVE can carry this and not be on KEV, and the reverse.",
    ],
  },
  {
    id: "epss",
    term: "EPSS score",
    lines: [
      "Exploit Prediction Scoring System: the odds a CVE is exploited in the next 30 days.",
      "A FORECAST, not an observation — what may happen rather than what has.",
      "It is a probability, so a high score on a large register still describes many findings that will never be attacked.",
    ],
  },
  // The Code register's one signal, and the only one here that is somebody else's OPINION
  // rather than an observation or a forecast. It shared the "sast" entry — the register's own
  // definition — for the same reason the three above shared "sca".
  {
    id: "ai-verdict",
    term: "AI triage verdict",
    lines: [
      "The scanner's own judgement that a static-analysis finding is real.",
      "A vendor opinion, not a measurement: one clause of the high-risk rule, never the whole.",
      "It has never actually fired in this tenant: every SAST node captured so far carries a null aiAnalysis, so a zero beside it means nobody was asked, not that the AI looked and disagreed.",
      "The values that count are EXPLOITABLE, TRUE_POSITIVE, CONFIRMED and VULNERABLE (domain/config.ts's AI_VERDICTS_HIGH). That vocabulary is UNVERIFIED against this tenant, so a register where every row reads unevaluated means either the field is not being returned or those are the wrong strings — both worth knowing, and neither of them a finding about the code.",
    ],
  },
  {
    id: "signal-coverage",
    term: "Signal coverage",
    lines: [
      "How much of the column a risk clause rests on was captured, over the rows it applies to.",
      "A measured 0% is a measurement, not a blank.",
      "It separates \u201cthe AI agreed with nothing\u201d from \u201cnobody asked the AI\u201d. \u201cNot applicable\u201d is a third statement \u2014 no row in scope has such a column at all.",
      "The clauses are OR'd and overlap, so what each one fired on never sums to the high-risk count.",
    ],
  },
  {
    id: "reconstructed",
    term: "Reconstructed month",
    lines: [
      "A month rebuilt rather than observed, ending before this register started watching.",
      "Marked so it is not read as measured: the backlog is real, but nobody was watching.",
    ],
  },
  {
    id: "unclassified",
    term: "Unclassified",
    lines: [
      "A finding the risk rule could not place as high-risk or not.",
      "Reported outside the 2×2, never folded into a corner of it.",
      "Most often a secret, which this register refuses to score by severity.",
    ],
  },
  {
    id: "cwe-top-25",
    term: "CWE Top 25",
    lines: [
      "MITRE's 2024 list of the most dangerous weakness classes, which SAST scores against.",
      "A child weakness folds onto its Top-25 ancestor first.",
      "CWE-23 counts as CWE-22, CWE-80 as CWE-79 — scanners report leaves and the list is mostly interior nodes.",
    ],
  },
  {
    id: "twin",
    term: "Twin",
    lines: [
      "One secret at one line, reported once against its repository and once against a branch.",
      "The ledger keys on (secret, path, line) and keeps the earlier birth date.",
      "187 keys in this tenant span both, a median 19.9 days apart.",
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
      "Read it as a distribution: how much of the window each open finding has consumed.",
      "And how many are already past it.",
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
      "Only exceptions speak: a sync running or failed, nothing to sync with, a register never measured, a scan gone old.",
      "Never-measured outranks old: a register nobody looked at is unmeasured, not stale.",
    ],
  },
  {
    // The Storage page's three words. Compaction is the act, a sealed scan is what it leaves
    // behind, and an episode is what a finding's row becomes once its scan is sealed — three
    // names for one mechanism, and the page used all three before any of them was defined.
    id: "compaction",
    term: "Compaction",
    lines: [
      "Folds the oldest saved scans into episodes, keeping their totals.",
      "Their per-finding observations are pruned, reclaiming cells and archive bytes.",
      "The most recent scans are never candidates, and the dry run states what would go before anything goes.",
    ],
  },
  {
    id: "sealed",
    term: "Sealed",
    lines: [
      "A saved scan whose per-finding observations compaction has already pruned.",
      "Its totals stay; the detail behind them is gone.",
      "It cannot be deleted from the Storage page — the archive it pointed at was reclaimed when it was sealed.",
    ],
  },
  {
    id: "episode",
    term: "Episode",
    lines: [
      "One finding's settled lifetime — first seen, how it ended, when.",
      "The clock survives compaction; the per-scan observations behind it do not.",
      "A finding seen again after its episode begins a new one.",
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
      "The open backlog now against the same register at the previous sync.",
      "A rising count is worse. The comparison is between two syncs, not two dates.",
      "A register only learns anything on the days it looks.",
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
      "Ranked by what cannot wait rather than by severity.",
      "Grouped by repository — the smallest unit somebody can be asked to own.",
      "The order is: a credential somebody confirmed is live, then a fixable dependency finding already late, then a critical code weakness already late.",
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
      "The day count splitting one severity's open findings into late and not late.",
      "Its own SLA target, read against the age buckets.",
      "A deadline rarely lands on a bucket's boundary, so a bucket is usually part in and part out; a rule is drawn on the chart only where every severity shares one exact edge.",
    ],
  },
  {
    // THE COLD ZONE'S THREE WORDS. `cold-zone` is the state and its clock; `unobserved` is the
    // state that must never be mistaken for it (a fact about the scanner, not about a team);
    // `idle` is the number both of them are read off. Three entries rather than one because
    // the tip card renders an entry's first two lines — a definition folded in as a third line
    // is a definition nobody can reach — and because the Repositories page puts the three in
    // three different places: the section label, a verdict column, and a figure column.
    id: "cold-zone",
    term: "Cold zone",
    lines: [
      "A repository with open findings and no movement for the whole cold-zone window.",
      "Nothing resolved, removed or rotated on it in that time.",
      "Measured at the last scan, never against today, so the same saved ledger always reads the same. With no movement on record the figure is a lower bound \u2014 see Lower bound.",
      "The window is either a fixed number of days or a share of the estate \u2014 see Cold-zone mode. A repository the scanner has stopped returning is Unobserved instead: counted apart, and never counted as warm.",
    ],
  },
  {
    // THE SECOND DEFINITION OF THE LINE, and its own entry rather than a third line on
    // `cold-zone`: the tip card renders an entry's first two lines, so a mode folded in as a
    // third line is a definition nobody can reach. The Settings control and the Repositories
    // caption both point here.
    id: "cold-zone-mode",
    term: "Cold-zone mode",
    lines: [
      "Fixed window: cold after a set number of idle days, the same number every week.",
      "Relative: the line follows the population, so the idlest share is always cold.",
      "Fixed is the number an operator can be held to. Relative never falls below the floor, and moves as the population moves instead of standing still while it does.",
      "Whichever mode is on, the page prints the line it produced in days, the share it was aiming at and the share it actually drew — those last two disagree in both directions by design. Set on the Deadlines tab in Settings.",
    ],
  },
  {
    // WHAT THE REGISTER KNOWS ABOUT A REPOSITORY THAT IS NOT A FINDING. The Lifecycle column on
    // the Repositories tables points here; it is a tag the tenant writes, not anything this
    // app derives, and the second line is the one a reader needs when the column is empty.
    id: "lifecycle",
    term: "Lifecycle",
    lines: [
      "Where the tenant says a repository is in its life: production, development, end of life.",
      "Read off its lifecycle tag in Wiz and printed as written.",
      "Blank means no lifecycle is known: either the repository carries no such tag, or the tag map has never been refreshed. It is never read as \u201calive\u201d, and a blank tag excludes a repository from nothing.",
      "Refresh it from Settings > System, which also reports how many repositories the key actually placed.",
    ],
  },
  {
    // THE ONE POPULATION AN OPERATOR MAY REMOVE. Its own entry rather than a line on
    // `cold-zone`, for this file's usual reason: the tip card renders two lines. The Settings
    // switch and the Repositories exclusion note both point here.
    id: "end-of-life",
    term: "End of life",
    lines: [
      "A repository the tenant has retired, by its lifecycle tag.",
      "Nobody closes findings on one, so its silence and its clock both mislead.",
      "Settings > Deadlines carries two switches: one leaves these out of the cold zone, the other out of the remediation-speed figures. Both off by default, and neither guesses at an unfamiliar word.",
      "Whichever is on, a retired repository's findings stay in every count of what is open \u2014 the backlog, the density and the severity breakdowns are untouched by either.",
    ],
  },
  {
    // The team-level half of relative mode. A rank is not a verdict, and this is where that
    // distinction is settled for a reader who found the mark on the product table.
    //
    // THE ID DOES NOT MOVE with the wording. Every `help: { term: "coldest-share" }` in
    // repos.js resolves against it, and a renamed entry is a column whose caveat silently
    // stops opening.
    id: "coldest-share",
    term: "Coldest share",
    lines: [
      "In relative mode, the products with the highest share of their repositories cold.",
      "A position relative to the other products, never a verdict about any one of them.",
      "A product with no cold repository is never marked, however small the estate; products tied at the cutoff are all marked rather than split by name.",
      "Ranked over the products that have at least one repository with an open finding. A product with nothing open has no share to rank and carries no position at all.",
    ],
  },
  {
    id: "unobserved",
    term: "Unobserved",
    lines: [
      "The scanner stopped returning this repository: nothing on it reached the last scan.",
      "Its findings close by disappearance, like a whole repository remediated at once.",
      "So it is tested first, counted apart, and never counted as warm or cold. No finding on it reached the last scan of any register it has rows in.",
      "Two very different things land here, and the census draws them apart. A repository that was fixed and then archived is unobserved for as long as the ledger remembers it — nothing open, nothing to do, and on a long-lived register most of the figure. The one worth acting on is a repository the scanner lost while findings were still open on it: that backlog is real and nobody will be told about it again.",
    ],
  },
  {
    id: "idle",
    term: "Idle days",
    lines: [
      "Days since the last finding resolved, removed or rotated on a repository.",
      "Measured from the last scan, never from today.",
      "Where nothing has ever moved there is no measurement, so the count runs from when we started watching and is published as a lower bound.",
    ],
  },
  {
    id: "returned",
    term: "Returned",
    lines: [
      "Seen again after it had been resolved. Its clock restarted on this sighting.",
      "The earlier episode is not in this figure: age counts only from the return.",
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
