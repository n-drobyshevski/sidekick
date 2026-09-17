// This register's glossary: one definition per term, written once, reached from anywhere a
// `tip` carries `{ term }` or a `bookTip` names one. The tip card shows the first two lines
// (gas_shared/ui/tipPlace.js's `glossaryTipLines`); the Key sheet page shows the whole entry.
//
// THE FIRST TWO LINES ARE A CARD, AND A CARD IS 300px WIDE. That is about 45 characters to a
// rendered row, so the budget is: line one says what the thing IS in 110 characters or fewer,
// line two says the one consequence worth a row in 90 or fewer, and the card totals ~150.
// Everything after line two is Key-sheet prose and can breathe. This file used to run 218-
// character opening lines against a 220-character ceiling and painted seven-row walls on
// hover; the reduction moved sentences DOWN into line three and after, it did not delete
// them. `test/helpContent.test.js` pins the budget with MAX_TIP_LINE_LENGTH, and its
// measurement assertions read `lines.join(" ")` — the whole entry — so a claim the register
// owes a reader is just as load-bearing on line four as it was on line one. Root DESIGN.md
// carries the rule for the family.
//
// 42 ENTRIES NOW, NOT THE 23 THIS FILE OPENED WITH. The first 21 (P7) were lifted out of this
// register's own `tip(` call sites — not one of those call sites passed `term:`, so a reader
// who wanted the rest of a definition had nowhere to go, and the two pages that both define
// the Kaplan–Meier median had two copies of the sentence that could drift apart. Two more
// (`sla-band`, `capacity`) followed for figures a page assumed a reader already had. P1.4
// then ported sixteen register-neutral entries from `gas_devsecops/helpContent.js` — a scan
// there is still the RECORD a sync writes, so `scan` is rewritten here to be the act and the
// record both, since this register has no separate sync — and added three OS-specific ones
// (`internet-exposed`, `age`, `actionable-age`) the exploitability-first Overview page needed
// and had none of. Each of the first 21 names the call site it came from, so the next reader
// can check the two still agree, and every one of those call sites now reaches this file
// instead of restating it.
//
// WHAT IS AND IS NOT A TERM. An entry is a word this register uses in a way a reader could
// reasonably get wrong, or a figure whose definition encodes a measurement decision — which
// is why "Kaplan–Meier median" is defined and "severity" is not. Where a definition encodes a
// decision, the entry states the decision, because that is exactly the thing a reader is
// entitled to check.
//
// THE PROSE IS DIMENSION-NEUTRAL EVEN WHERE THE CALL SITE'S IS NOT. Four of the MTTR page's
// tips interpolate the active grouping dimension ("MTTR by domain", "MTTR by resource group")
// and Risk tiers interpolates the active rule's sentence. Those live triggers keep their own
// interpolated lines — `tip(content, lines, { term })` adds the route WITHOUT taking the words
// away — and the entry here says the general thing, because "domain" is a state of a control,
// not part of the definition.
//
// NO COUNTS, NO FIGURES. Nothing here reads `src/domain/**`, `src/server/**` or a bootstrap
// payload; an entry that quoted this tenant's numbers would be stale the next scan. Live
// figures belong on the page that measured them.

const ENTRIES = [
  {
    // app.js's scan zone — the Quick refresh button (bookTip, not a term tip: the button
    // already has a click action of its own).
    id: "quick-refresh",
    term: "Quick refresh",
    lines: [
      "Fetch only findings changed since the last full scan and merge them in.",
      "Deletions aren't detected, so a finding gone quiet still reads as open.",
      "Run a full scan to clear resolved findings. The full scan is what dates a remediation: a vuln that disappears between scans is resolved as of the scan that noticed.",
    ],
  },
  {
    // pages/attribution.js's rule-health panel — the "status guide" trigger.
    id: "rule-health",
    term: "Rule health",
    lines: [
      "How each mapping rule fared against this scan, under first-match priority.",
      "A rule's health is relative to the ones above it, which claim first.",
      "Fires — the rule claims findings. Shadowed — it matches findings, but an earlier rule or group claims them first. Never matches — it matches nothing in this scan, a dead rule.",
      "Malformed — the rule failed to compile, so it never matches anything. Malformed and Never matches both claim nothing, and only one of them is a typo.",
    ],
  },
  {
    // pages/executive.js's hero AND pages/mttr.js's hero. THE DUPLICATE THAT JUSTIFIES THIS
    // FILE: the same definition was written out twice, in two files, and the second copy had
    // already lost a word from the first ("at least that many days out" vs "at least that
    // far out"). Both triggers now carry `term: "km-median"`.
    id: "km-median",
    term: "Median MTTR (Kaplan–Meier)",
    lines: [
      "Median days from first detection to remediation, off a Kaplan–Meier survival curve.",
      "Still-open findings are censored, not ignored, so fresh ones can't bias it down.",
      "Where the curve never falls to half within the window, there is no median: the longest thing observed becomes a lower bound, printed \"at least N days\" in prose and \"≥ N d\" in a cell.",
      "A vuln that disappears between scans counts as resolved, dated to the scan that noticed. Mean remediation time (KM · RMST) is marked on the survival curve rather than published as a second headline.",
    ],
  },
  {
    // pages/mttr.js's secondary hero stat.
    id: "naive-median",
    term: "Median (naive, closed)",
    lines: [
      "Median days from detection to remediation over closed findings only — no censoring.",
      "A wave of fresh findings biases this down, which the Kaplan–Meier headline corrects for.",
      "It is published because it is the one MTTR figure with a saved history series, not because it is the better number.",
    ],
  },
  {
    // pages/mttr.js's hero source line.
    id: "vendor-fix-wait",
    term: "Wait for a vendor fix",
    lines: [
      "Kaplan–Meier median wait for a fix to exist, from our first detection and from CVE publication.",
      "Findings still awaiting one are censored, not dropped.",
      "Excluding them would leave only the vulnerabilities that got fixed, and measure how fast the fixed ones were fixed.",
      "This is the vendor's half of the exposure — our half is the actionable clock, which starts where this one ends. A wait whose origin or availability date was never captured is unmeasured and excluded, never counted as a zero-length wait.",
    ],
  },
  {
    // pages/mttr.js's by-dimension line chart.
    id: "mttr-by-dimension",
    term: "MTTR by dimension",
    lines: [
      "The same remediation clock, split by the active grouping and replayed as of each scan.",
      "KM is the principal figure: per-group medians, still-open findings censored.",
      "Naive is the median of closed findings only, kept alongside as the biased comparison KM corrects for.",
    ],
  },
  {
    // pages/mttr.js's by-dimension lens card, contribution view.
    id: "mttr-contribution",
    term: "Contribution to MTTR",
    lines: [
      "Resolved findings × (the group's KM median − the overall one), in finding·days.",
      "Leverage, not rate: a slightly-slow group closing a lot outweighs a fast-closing few.",
      "Right of the zero line the group dragged the headline MTTR up; left of it, it held MTTR down.",
      "A proxy rather than an exact split — the overall KM median is a censored-survival statistic, not a weighted average of the per-group ones — so read the magnitudes as relative.",
    ],
  },
  {
    // pages/mttr.js's by-dimension lens card, median view.
    id: "median-mttr-by-dimension",
    term: "Median MTTR by dimension",
    lines: [
      "Each group's Kaplan–Meier median, slowest first, against a dashed line at the overall one.",
      "The pure rate: a very-slow group tops this even if it closed a handful.",
      "Bars past the line take longer than the register median. Contribution to MTTR is the same medians weighted by resolved count, which is where the real leverage shows.",
    ],
  },
  {
    // pages/overview.js's funnel section label.
    id: "triage-funnel",
    term: "Triage funnel",
    lines: [
      "Open findings only, each step a strict subset of the one above it, so counts narrow.",
      "Exploit intelligence comes from the ledger; exposure comes from the current scan.",
      "Exposure cannot be replayed over history, which is why the funnel STOPS rather than reading zero when a scan did not capture it: two steps of zero would say none, and none is not what was measured.",
    ],
  },
  {
    // pages/overview.js's tier card section label.
    id: "risk-tiers",
    term: "Risk tiers",
    lines: [
      "The same high-risk rule the Program page scores against, applied one finding at a time.",
      "A finding takes its strongest signal, so every open finding sits in exactly one tier.",
      "The tiers partition the backlog rather than overlapping. The unclassified count here and on the Program page always agree, because they are the same population read through the same rule.",
    ],
  },
  {
    // pages/program.js's hero.
    id: "coverage",
    term: "Remediation coverage",
    lines: [
      "Of what the active rule calls high risk, the share remediated: TP / (TP + FN).",
      "Easy to buy by fixing everything, so it is never published apart from efficiency.",
      "The bracketed range is what coverage would be if every unclassified finding turned out to be high risk (low end) or not (high end). It closes to a single number once every finding carries a captured exploit signal.",
    ],
  },
  {
    // pages/program.js's secondary hero stat.
    id: "efficiency",
    term: "Efficiency",
    lines: [
      "Of everything remediated, the share that was actually high risk: TP / (TP + FP).",
      "The remainder is effort spent on findings the rule did not flag.",
      "Some of that is unavoidable — one patch often closes several CVEs at once, and only one of them may be the dangerous one.",
      "Picking findings at random would score about the prevalence of high risk among classified findings, so efficiency at or below that means the program is not prioritizing.",
    ],
  },
  {
    // pages/program.js's 2×2, top-left cell.
    id: "cell-tp",
    term: "Fixed, and it mattered (TP)",
    lines: [
      "High risk under the active rule, and remediated.",
      "The numerator of both coverage and efficiency.",
      "The one cell that moves both numbers the same way.",
    ],
  },
  {
    // pages/program.js's 2×2, bottom-left cell.
    id: "cell-fp",
    term: "Fixed, but low risk (FP)",
    lines: [
      "Not high risk under the active rule, but remediated anyway.",
      "Effort better spent elsewhere — this is what pulls efficiency down.",
      "It leaves coverage untouched, which is why efficiency has to be read beside it.",
    ],
  },
  {
    // pages/program.js's 2×2, top-right cell.
    id: "cell-fn",
    term: "High risk, still open (FN)",
    lines: [
      "High risk under the active rule and not yet remediated.",
      "Unremediated risk — this is what pulls coverage down.",
      "The only cell that shrinks by doing the work rather than by moving the rule.",
    ],
  },
  {
    // pages/program.js's 2×2, bottom-right cell.
    id: "cell-tn",
    term: "Correctly deprioritized (TN)",
    lines: [
      "Not high risk under the active rule, and still open.",
      "Work correctly left undone, in neither rate's numerator nor either denominator.",
      "So a large TN is neither good news nor bad on its own.",
    ],
  },
  {
    // pages/program.js's unclassified row, remediated cell.
    id: "cell-unclassified-remediated",
    term: "Unclassified, remediated",
    lines: [
      "Remediated, but no exploit signal was ever captured, so it cannot be scored either way.",
      "Excluded from both rates and reflected in their published ranges.",
      "Never folded into a corner of the 2×2.",
    ],
  },
  {
    // pages/program.js's unclassified row, still-open cell.
    id: "cell-unclassified-open",
    term: "Unclassified, still open",
    lines: [
      "Still open, and no exploit signal was ever captured for it.",
      "Still open is not the same claim as not high risk.",
      "Excluded from both rates and reflected in their published ranges.",
    ],
  },
  {
    // pages/program.js's unclassified row header.
    id: "no-captured-signal",
    term: "No captured signal",
    lines: [
      "Outside the 2×2 on purpose: these findings are not low risk, they are unscored.",
      "Absent is never zero — a signal nobody evaluated is not one that came back clean.",
      "Counting them as low risk would inflate efficiency and deflate coverage at the same time, so they are excluded from both and reported separately.",
    ],
  },
  {
    // pages/program.js's trend chart title.
    id: "coverage-efficiency-trend",
    term: "Coverage & efficiency over time",
    lines: [
      "Both rates recomputed at each date over the findings that existed then.",
      "Risk classification is NOT re-evaluated per date: signals attach once, for all time.",
      "So a finding counts as remediated from its resolution date onward and open before it, while a CVE that only reached the KEV catalog later counts as high risk in earlier points too.",
      "That reads pessimistically early, and it is what stops last week's plotted value from moving every time a scan lands. The shaded stretch before the first saved scan is reconstructed from first-detection dates, so closures there are under-counted.",
    ],
  },
  {
    // pages/program.js's sensitivity scatter title.
    id: "rule-sensitivity",
    term: "How much the rule choice matters",
    lines: [
      "One point per combination of signals, scored over this same register: coverage across, efficiency up.",
      "Up and to the right is better, and no rule reaches the corner.",
      "That trade-off is the whole reason both numbers are published.",
      "It measures sensitivity to the rule, not which rule is right: the ground truth here is the rule itself, so a narrow rule can look flattering simply by flagging less.",
    ],
  },
  {
    // pages/mttr.js's per-severity SLA section label.
    id: "sla-band",
    term: "SLA band",
    lines: [
      "An SLA is a band the population is kept inside, not a wall a single finding hits.",
      "Read it as a distribution: how much of the window each open finding has consumed.",
      "And how many are already past it.",
    ],
  },
  {
    // pages/program.js's capacity section label.
    id: "capacity",
    term: "Remediation capacity",
    lines: [
      "Only capacity absorbs inflow: the verdict compares close rate with arrival rate, not counts.",
      "Gaining ground, keeping up and falling behind are its three readings.",
      "There is a dead band, so a flat month is not a verdict.",
    ],
  },
  {
    // pages/program.js's "Closed per month" hero mini.
    //
    // ITS OWN ENTRY RATHER THAN A THIRD LINE ON `capacity` ABOVE, and the tip card is why: it
    // renders the first TWO lines, so folding this in would have pushed the verdict's own
    // definition off the surface the verdict is defined on. The same reason gas_devsecops
    // keeps `mmcr` apart from `capacity`.
    id: "closed-per-month",
    term: "Findings closed per month",
    lines: [
      "Findings closed in a mean calendar month, over the months the close rate averages over.",
      "The close rate's absolute half, which the rate alone cannot supply.",
      "One in ten a month is four findings on a small register and four hundred on a large one.",
    ],
  },
  // ---------------------------------------------------------------- the Executive front door
  //
  // FIVE ENTRIES PORTED FROM gas_devsecops, WITH ONE WORD CHANGED THROUGHOUT. That register
  // calls the operation a sync; MANIFEST.sync here says `{ noun: "scan" }` and the rail's
  // button says "Run scan", so an entry that said "sync" would send a reader looking for a
  // control this app does not have (gas/DESIGN.md §5). `km-median` stays exactly as it is —
  // pages/mttr.js reaches for it, and its own "> X d" reading is a fact about THAT page's
  // table columns; `half-life` is the front door's own hero, whose value reads "at least N
  // days" instead. Two spellings of one estimator is a real difference, not a duplicate.
  {
    // pages/executive.js's hero label, and its by-domain half-life column.
    id: "half-life",
    term: "Remediation half-life",
    lines: [
      "How long it takes for half of what is open today to be remediated.",
      "Off a Kaplan–Meier curve, so still-open findings count as evidence, not as gaps.",
      "Preferred to a mean because remediation is long-tailed: a mean moves when a batch of easy findings closes, and can improve while real exposure does not.",
    ],
  },
  {
    // pages/executive.js's by-domain footnote — what a dash in the half-life column means.
    id: "lower-bound",
    term: "Lower bound",
    lines: [
      "A duration the curve never reached, so the median is at least this far out.",
      "More than half of what was tracked is still open and it cannot be read exactly.",
      "Prose says \"at least N days\" and a figure says \"≥ N\" — one notation per context, and inclusive either way, which is why \"more than\" would be a different claim.",
    ],
  },
  {
    // pages/executive.js's "Still open" stat row.
    id: "censoring",
    term: "Censored",
    lines: [
      "A still-open finding has been open at least this long; how long it will take is unknown.",
      "Dropping those rows and averaging the rest is how a remediation figure flatters its owner.",
      "The curve keeps them as right-censored observations, which is what makes the half-life honest.",
    ],
  },
  {
    // pages/executive.js's "Fix next" section heading. This is the RANKING RULE, and it is a
    // definition rather than a caveat: without it the list is eight owners in an order nobody
    // can check.
    id: "fix-next",
    term: "Fix next",
    lines: [
      "Ranked by what cannot wait rather than by severity.",
      "Grouped by the team or subscription that would be asked — the smallest ownable unit.",
      "The order is: a known-exploited finding on a reachable host, then an exploitable finding already past its window, then a critical one already past its window.",
    ],
  },
  {
    // pages/executive.js's "Movement" aside. The method sentence used to sit under the rows as
    // its own paragraph; the rows already carry the pills and the raw pair, so what was left
    // to say is what the comparison is BETWEEN, which is a definition.
    id: "movement",
    term: "Movement",
    lines: [
      "The open backlog now against the same register a week or more of scanning ago.",
      "A rising count is worse. The comparison is between two scans, not two calendar dates.",
      "A register only learns anything on the days it looks, so the two scans have to be at least a week apart. Closer than that and no comparison is published rather than a noisy one.",
    ],
  },


  // =======================================================================================
  //  P1.4 — sixteen register-neutral entries ported from gas_devsecops, plus three new
  //  OS-specific ones. None of these came from a call site already carrying the sentence —
  //  every one is genuinely new copy on this page's tables and section headings, which is
  //  why they read differently from the block above.
  // =======================================================================================
  {
    // Rewritten for this register rather than ported verbatim: gas_devsecops keeps "sync"
    // (the act, one run over three registers) and "scan" (the record one register's run
    // leaves) apart, because one sync writes three scan rows. This register's own operation
    // is already named "scan" (gas/DESIGN.md §5 — "the noun is scan, not sync"; there is no
    // separate sync word here at all), so the entry has to be both halves at once: the act of
    // reading Wiz, and the row it leaves in Scan History.
    id: "scan",
    term: "Scan",
    lines: [
      "The act and the record both: it reads the register from Wiz and saves a row in Scan History.",
      "Wiz's own detectors run continuously and are a different thing.",
      "This word names the read-and-save operation this app runs, on demand.",
    ],
  },
  {
    id: "disappearance",
    term: "Dated by disappearance",
    lines: [
      "A finding dated resolved at the first scan that stopped returning it.",
      "An upper bound: \"gone by 12 Aug\", never \"resolved 12 Aug\".",
      "The API publishes no resolution date for it, so the error is the interval between two scans.",
      "Until two scans have run and findings have begun to disappear between them, a register dated this way reads near-zero — an absence of observations, not a fast team.",
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
    id: "awaiting-fix",
    term: "Awaiting a vendor fix",
    lines: [
      "An open finding whose vendor has not published a fixed version yet.",
      "Reported separately: the wait measures the vendor, not the team.",
      "Counting it as remediation time would credit or blame the wrong party.",
    ],
  },
  {
    id: "two-clocks",
    term: "The two clocks",
    lines: [
      "Detection to remediation is one clock, including any wait for a vendor fix to exist.",
      "The actionable clock starts once a fix exists — the only one the team controls.",
      "Both are published, because either alone can be read as the whole story.",
    ],
  },
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
  {
    id: "sla-edge",
    term: "SLA edge",
    lines: [
      "The day count splitting one severity's open findings into late and not late.",
      "Its own SLA target, read against the age buckets.",
      "A deadline rarely lands on a bucket's boundary, so a bucket is usually part in and part out; a rule is drawn on the chart only where every severity shares one exact edge.",
    ],
  },
  {
    // THE COLD ZONE'S THREE WORDS, ported from gas_devsecops/helpContent.js and reworded for
    // this grain. `cold-zone` is the state and its clock; `unobserved` is the state that must
    // never be mistaken for it (a fact about the scanner, not about a support group); `idle` is
    // the number both of them are read off. Three entries rather than one because the tip card
    // renders an entry's first two lines — a definition folded in as a third line is a
    // definition nobody can reach — and because the Cold zone page puts the three in three
    // different places: the page header, a verdict column, and a figure column.
    id: "cold-zone",
    term: "Cold zone",
    lines: [
      "An asset with open findings and nothing resolved on it for the whole cold-zone window.",
      "Measured at the last scan, never against today, so a saved ledger always reads the same.",
      "With no movement on record the figure is a lower bound \u2014 see Lower bound.",
      "The window is either a fixed number of days or a share of the estate, set on the Lifecycle tab in Settings. An asset the scanner has stopped returning is Unobserved instead: counted apart, and never counted as warm.",
    ],
  },
  {
    // The support-group half of relative mode. A rank is not a verdict, and this is where that
    // distinction is settled for a reader who found the mark on the group table.
    id: "coldest-share",
    term: "Coldest share",
    lines: [
      "In relative mode, the groups with the highest share of their open-finding assets cold.",
      "A position relative to the other groups, never a verdict about any one of them.",
      "A group with no cold asset is never marked, however small the estate; groups tied at the cutoff are all marked rather than split by name.",
      "Ranked over the support groups that have at least one asset with an open finding. A group with nothing open has no share to rank and carries no position at all.",
    ],
  },
  {
    id: "unobserved",
    term: "Unobserved",
    lines: [
      "The scanner stopped returning this asset: nothing on it reached the newest scan.",
      "Its findings close by disappearance, which looks like a whole asset remediated at once.",
      "So it is tested first, counted apart, and never counted as warm or cold. No finding on it reached the newest scan of any severity it has rows in.",
      "Two very different things land here, and the census draws them apart. An asset that was fixed and then decommissioned is unobserved for as long as the ledger remembers it — nothing open, nothing to do, and on a long-lived register most of the figure. The one worth acting on is an asset the scanner lost while findings were still open on it: that backlog is real and nobody will be told about it again.",
    ],
  },
  {
    id: "idle",
    term: "Idle days",
    lines: [
      "Days since the last movement on an asset: the most recent finding resolved on it.",
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
  {
    id: "rail-status",
    term: "Rail status",
    lines: [
      "Only exceptions speak: running, failed, nothing collected, never scanned, bad date, or stale.",
      "Never-scanned outranks stale: a register nobody looked at is unmeasured, not old.",
    ],
  },
  {
    id: "compaction",
    term: "Compaction",
    lines: [
      "Rolls the oldest closed findings into exact episode rows and prunes their raw archives.",
      "MTTR and every trend stay identical — the arithmetic is exact, not approximated.",
      "The two most recent full scans are never candidates, and the dry run states what would go before anything goes.",
    ],
  },
  {
    id: "sealed",
    term: "Sealed",
    lines: [
      "A saved scan compaction has already rolled into episode rows and pruned.",
      "It can't be deleted from Scan History — its archive was reclaimed when it was sealed.",
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
    id: "unclassified",
    term: "Unclassified",
    lines: [
      "A finding no exploit signal was captured for, so the rule could not place it either way.",
      "Not the same as low risk: absent is never zero.",
      "Reported separately rather than folded into a corner of the matrix or the tier breakdown.",
    ],
  },
  {
    id: "reconstructed",
    term: "Reconstructed",
    lines: [
      "A point rebuilt rather than observed, falling before the first saved scan.",
      "Marked so it is not read as measured: the backlog is real, but nobody was watching then.",
    ],
  },
  {
    // NEW — Overview's exploitability funnel and hero both gate on this and neither had a
    // definition: "…and reachable from outside" (the funnel) and the hero's "on a host
    // reachable from outside" clause.
    id: "internet-exposed",
    term: "Internet exposed",
    lines: [
      "A host reachable from outside the network, as reported by the current scan.",
      "In the scan snapshot only, not the ledger, so it can't be replayed or trended.",
    ],
  },
  {
    // NEW — the simpler of the two clocks Overview's "Median open age" mini and the oldest-
    // findings table both draw on, and the one `two-clocks` above promises a sibling for.
    id: "age",
    term: "Age",
    lines: [
      "Time since a finding was first detected, whether or not a fix is available yet.",
      "The simpler of the two clocks — see The two clocks for the one that starts later.",
    ],
  },
  {
    // NEW — the clock MTTR's SLA columns actually measure against (a vendor fix's
    // availability date, not first detection), named so "Open past SLA" and "In SLA" stop
    // being silent about which clock they read.
    id: "actionable-age",
    term: "Actionable age",
    lines: [
      "Time since a fix became available for an open finding — the clock the team actually controls.",
      "Undefined while no fix has appeared yet; those findings are awaiting a vendor fix instead.",
    ],
  },
];

/** One entry by id, or null. Callers render nothing rather than guessing. */
export function findEntry(id) {
  const want = String(id || "").trim().toLowerCase();
  if (!want) return null;
  return ENTRIES.find((e) => e.id === want) || null;
}

/** Every entry, in declaration order — the Key sheet page's source. */
export function allEntries() {
  return ENTRIES.slice();
}
