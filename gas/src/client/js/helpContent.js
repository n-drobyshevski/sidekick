// This register's glossary: one definition per term, written once, reached from anywhere a
// `tip` carries `{ term }` or a `bookTip` names one. The tip card shows the first two lines
// (gas_shared/ui/tipPlace.js's `glossaryTipLines`); the Key sheet page shows the whole entry.
//
// EVERY ENTRY HERE WAS ALREADY WRITTEN, SOMEWHERE ELSE. That is the whole reason this file
// exists rather than being new copy: the register had 21 glossary-shaped definitions living
// inside 27 `tip(` call sites, and not one of those call sites passed `term:` — so a reader
// who wanted the rest of a definition had nowhere to go, and the two pages that both define
// the Kaplan–Meier median had two copies of the sentence that could drift apart. Each entry
// below names the call site it came from, so the next reader can check the two still agree,
// and every one of those call sites now reaches this file instead of restating it.
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
      "Deletions aren't detected — a finding that has gone quiet still reads as open, so run a full scan to clear resolved findings.",
      "The full scan is what dates a remediation: a vuln that disappears between scans is resolved as of the scan that noticed.",
    ],
  },
  {
    // pages/attribution.js's rule-health panel — the "status guide" trigger.
    id: "rule-health",
    term: "Rule health",
    lines: [
      "How each mapping rule performed against this scan, under first-match priority: a finding is claimed by the first rule that matches it, so a rule's health is relative to the ones above it.",
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
      "Median days from first detection to remediation, read off a Kaplan–Meier survival curve. Still-open findings count as censored observations instead of being ignored, so a wave of fresh open findings can't bias it down.",
      "\"> X d\" means the curve never dropped to 50% within the observed window — over half of tracked findings are still open, so the true median is at least that many days out.",
      "A vuln that disappears between scans counts as resolved, dated to the scan that noticed. Mean remediation time (KM · RMST) is marked on the survival curve rather than published as a second headline.",
    ],
  },
  {
    // pages/mttr.js's secondary hero stat.
    id: "naive-median",
    term: "Median (naive, closed)",
    lines: [
      "Median days from first detection to remediation, counting closed findings only — no censoring.",
      "A wave of fresh open findings biases this down, which is exactly what the Kaplan–Meier headline corrects for.",
      "It is published because it is the one MTTR figure with a saved history series, not because it is the better number.",
    ],
  },
  {
    // pages/mttr.js's hero source line.
    id: "vendor-fix-wait",
    term: "Wait for a vendor fix",
    lines: [
      "Kaplan–Meier median wait for a fix to become available, measured from our first detection and from CVE publication.",
      "Findings still awaiting one are censored, not dropped: excluding them would leave only the vulnerabilities that got fixed and measure how fast the fixed ones were fixed.",
      "This is the vendor's half of the exposure — our half is the actionable clock, which starts where this one ends. A wait whose origin or availability date was never captured is unmeasured and excluded, never counted as a zero-length wait.",
    ],
  },
  {
    // pages/mttr.js's by-dimension line chart.
    id: "mttr-by-dimension",
    term: "MTTR by dimension",
    lines: [
      "The same remediation clock, split by whichever dimension the page is grouped on and replayed as of each scan.",
      "KM is the principal figure: per-group Kaplan–Meier medians, still-open findings censored. Naive is the median of closed findings only, kept alongside as the biased comparison KM corrects for.",
    ],
  },
  {
    // pages/mttr.js's by-dimension lens card, contribution view.
    id: "mttr-contribution",
    term: "Contribution to MTTR",
    lines: [
      "Each group's resolved findings × (its KM median − the overall KM median), in finding·days. Right of the zero line the group dragged the headline MTTR up; left of it, it held MTTR down.",
      "Leverage, not rate: a slightly-slow group that closes a lot outweighs a very-slow one that closes little.",
      "A proxy rather than an exact split — the overall KM median is a censored-survival statistic, not a weighted average of the per-group ones — so read the magnitudes as relative.",
    ],
  },
  {
    // pages/mttr.js's by-dimension lens card, median view.
    id: "median-mttr-by-dimension",
    term: "Median MTTR by dimension",
    lines: [
      "Each group's Kaplan–Meier median, ranked slowest first against a dashed line at the overall KM median. Bars past the line take longer than the register median.",
      "The pure rate, ignoring volume: a very-slow group tops this even if it closed only a handful. Contribution to MTTR is the same medians weighted by resolved count, which is where the real leverage shows.",
    ],
  },
  {
    // pages/overview.js's funnel section label.
    id: "triage-funnel",
    term: "Triage funnel",
    lines: [
      "Open findings only. Each step is a strict subset of the one above it, so the counts narrow rather than overlapping.",
      "Exploit intelligence comes from the durable ledger; internet exposure comes from the current scan and cannot be replayed over history.",
      "Which is why the funnel STOPS rather than reading zero when a scan did not capture exposure: two steps of zero would say none, and none is not what was measured.",
    ],
  },
  {
    // pages/overview.js's tier card section label.
    id: "risk-tiers",
    term: "Risk tiers",
    lines: [
      "A refinement of the same high-risk rule the Program page scores against, applied one finding at a time.",
      "A finding takes its strongest signal, so the tiers partition the backlog rather than overlapping — every open finding sits in exactly one.",
      "The unclassified count here and on the Program page always agree, because they are the same population read through the same rule.",
    ],
  },
  {
    // pages/program.js's hero.
    id: "coverage",
    term: "Remediation coverage",
    lines: [
      "Of every finding the active rule calls high risk, the share that has been remediated: TP / (TP + FN).",
      "The bracketed range is what coverage would be if every unclassified finding turned out to be high risk (low end) or not (high end). It closes to a single number once every finding carries a captured exploit signal.",
      "Higher is better, but coverage alone is easy to buy by fixing everything — it is never published apart from efficiency.",
    ],
  },
  {
    // pages/program.js's secondary hero stat.
    id: "efficiency",
    term: "Efficiency",
    lines: [
      "Of everything remediated, the share that was actually high risk: TP / (TP + FP).",
      "The remainder is effort spent on findings the rule did not flag. Some of that is unavoidable — one patch often closes several CVEs at once, and only one of them may be the dangerous one.",
      "Picking findings at random would score about the prevalence of high risk among classified findings, so efficiency at or below that means the program is not prioritizing.",
    ],
  },
  {
    // pages/program.js's 2×2, top-left cell.
    id: "cell-tp",
    term: "Fixed, and it mattered (TP)",
    lines: [
      "High risk under the active rule, and remediated.",
      "The numerator of both coverage and efficiency — the one cell that moves both numbers the same way.",
    ],
  },
  {
    // pages/program.js's 2×2, bottom-left cell.
    id: "cell-fp",
    term: "Fixed, but low risk (FP)",
    lines: [
      "Not high risk under the active rule, but remediated anyway.",
      "Effort that may have been more productive elsewhere — this is what pulls efficiency down. It leaves coverage untouched, which is why efficiency has to be read beside it.",
    ],
  },
  {
    // pages/program.js's 2×2, top-right cell.
    id: "cell-fn",
    term: "High risk, still open (FN)",
    lines: [
      "High risk under the active rule and not yet remediated.",
      "Unremediated risk — this is what pulls coverage down, and the only cell that shrinks by doing the work rather than by moving the rule.",
    ],
  },
  {
    // pages/program.js's 2×2, bottom-right cell.
    id: "cell-tn",
    term: "Correctly deprioritized (TN)",
    lines: [
      "Not high risk under the active rule, and still open.",
      "Work correctly left undone. It appears in neither rate's numerator nor either denominator, so a large TN is neither good news nor bad on its own.",
    ],
  },
  {
    // pages/program.js's unclassified row, remediated cell.
    id: "cell-unclassified-remediated",
    term: "Unclassified, remediated",
    lines: [
      "Remediated, but no exploit signal was ever captured for it, so it cannot be scored either way.",
      "Excluded from both rates and reflected in their published ranges — never folded into a corner of the 2×2.",
    ],
  },
  {
    // pages/program.js's unclassified row, still-open cell.
    id: "cell-unclassified-open",
    term: "Unclassified, still open",
    lines: [
      "Still open, and no exploit signal was ever captured for it.",
      "Excluded from both rates and reflected in their published ranges. Still open is not the same claim as not high risk.",
    ],
  },
  {
    // pages/program.js's unclassified row header.
    id: "no-captured-signal",
    term: "No captured signal",
    lines: [
      "Outside the 2×2 on purpose: these findings are not low risk, they are unscored.",
      "Counting them as low risk would inflate efficiency and deflate coverage at the same time, so they are excluded from both and reported separately.",
      "Absent is never zero. A signal nobody evaluated is a different fact from a signal that came back clean.",
    ],
  },
  {
    // pages/program.js's trend chart title.
    id: "coverage-efficiency-trend",
    term: "Coverage & efficiency over time",
    lines: [
      "Both rates recomputed at each date over the findings that existed then: a finding counts as remediated from its resolution date onward, and as open before it.",
      "Risk classification is NOT re-evaluated per date: each finding carries the signals ever observed for it, so a CVE that only reached the KEV catalog later counts as high risk in earlier points too.",
      "That reads pessimistically early, and it is what stops last week's plotted value from moving every time a scan lands. The shaded stretch before the first saved scan is reconstructed from first-detection dates, so closures there are under-counted.",
    ],
  },
  {
    // pages/program.js's sensitivity scatter title.
    id: "rule-sensitivity",
    term: "How much the rule choice matters",
    lines: [
      "Each point is one combination of signals scored over this same register: how much of what THAT rule calls high risk got fixed (coverage, across) against how much of the fixing it would credit (efficiency, up).",
      "Up and to the right is better, and no rule reaches the corner — that trade-off is the whole reason both numbers are published.",
      "It measures sensitivity to the rule, not which rule is right: the ground truth here is the rule itself, so a narrow rule can look flattering simply by flagging less.",
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
