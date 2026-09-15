# Reading the numbers

## Reading coverage and efficiency

The formulas are P2P's. **The positive class is not**, and that is the whole of how to read
these numbers — one inferential step further for `sast` than for either of the other two.

P2P scores a remediation strategy against an *independent* ground truth: exploitation observed
in the wild, which lands on roughly 2–5% of CVEs. We have no such ground truth for `os` or
`sca` — only the signals in the risk rule. So `risk_class = high` **is our own prioritization
rule**, and the confusion matrix measures what the register did against that rule rather than
against reality. That is the same move the Kenna product makes (it scores against Kenna's own
risk band), and it is a fair thing to measure. It is just not the thing P2P measures.

| | P2P research | Kenna.VM product | `os` / `sca` here |
| --- | --- | --- | --- |
| Positive label | exploitation observed in the wild | Kenna risk score, high band | `KEV ∨ public exploit ∨ EPSS ≥ 0.1` |
| Nature | retrospective ground truth | vendor prediction | our own rule over a vendor prediction |
| Prevalence | ~2–5% of CVEs | vendor-set | rule-set — read `prevalence_pct` |
| Unit | CVE (v1–v4), asset-centric from v5 | vulnerability instance | finding-instance (`vuln_key`) |
| Window | a defined period | rolling period | cumulative over the ledger |
| Unknown label | none — binary | none | first-class, with `_lo`/`_hi` bounds |

Four consequences, in the order they bite:

- **Do not compare our efficiency to 18.5%.** P2P vol. 2's industry baseline of 70% coverage at
  18.5% efficiency, and vol. 4's finding that most firms never cross 50%, are computed against a
  much rarer positive class. Ours will read higher and mean less.
- **`prevalence_pct` is the baseline that *is* a peer.** It is the share of classified findings
  that are high risk — exactly the efficiency a program picking findings at random would score.
  Efficiency at or below prevalence means the programme is not prioritizing at all. It is
  published beside every rate and on the overview page for this reason.
- **`hasFix: true` is in the population** for `os` and `sca` (see [Scopes](register.md#scopes)), so
  awaiting-vendor-fix findings are not in coverage's denominator there. Deliberate, and one more
  reason the published baselines are not comparable.
- **The matrix is cumulative and asset-weighted.** Every finding the ledger has ever seen is in
  it, so the appended per-scan series is a to-date curve, not a monthly one — a good quarter
  barely moves it. And one CVE on 5,000 hosts contributes 5,000 rows.

One more, from the ledger's [sticky signals](internals.md#the-ledger-and-why-it-exists): classification is
**not as-of**, for the two scopes whose exploit signals are monotone. A finding that reached KEV
in month six is counted high-risk in month one too. The bias is conservative — it can only move
findings into the high-risk population, never out — but it means the confusion matrix is
"classified with everything we know now", not "classified with what we knew then".

### The positive label is a further step removed for `sast`

`sast` has no CVE and therefore none of the signals the table above prices — its own rule and
its own reading are in [Scopes](register.md#scopes). Restated as the same comparison:

| | P2P research | `sca` | `sast` |
| --- | --- | --- | --- |
| Positive label | exploitation observed in the wild | `KEV ∨ public exploit ∨ EPSS ≥ 0.1` | `CWE in Top 25 ∨ AI verdict ∨ CRITICAL` |
| Nature | retrospective ground truth | our rule over a vendor prediction | our rule over a weakness *class* |
| Prevalence | ~2–5% of CVEs | rule-set — read `prevalence_pct` | rule-set — read `prevalence_pct` |
| Unit | CVE | finding-instance (`vuln_key`) | weakness instance (file × line) |

`sca` is one step from P2P's ground truth: the rule reads somebody else's prediction about
exploitation, made per CVE, by people whose job that is. `sast` is two: from *"this weakness is
of a kind that has historically been exploited across all software"* to *"this instance of it,
in this file, is worth fixing first"*. That second step is a genuine leap — a weakness class says
nothing about whether the call site is reachable, whether the input is attacker-controlled, or
whether the code ships. P2P offers no help and says so: volumes 1, 2 and 3 each state, verbatim,
*"We won't be discussing CWEs in this study."*

**So: do not compare a SAST rate to `sca`'s, to `os`'s, or to any P2P baseline.** Compare it to
`prevalence_pct` on the same row, and read the rule-sensitivity sweep beside it — which matters
more for that rule than for the others, not less.

### Since the rule is the label, its sensitivity is a published metric

`metrics.rule_sensitivity` recomputes coverage and efficiency under each of the seven non-empty
signal subsets — KEV alone, EPSS alone, KEV-or-exploit, and so on for the exploit-signal rule;
CWE alone, AI-verdict alone, and so on for `SastRiskRule` — with the active rule marked
`active = true`. Ported from `gas/src/domain/program.ts::ruleSensitivity`. **It is not a
published table.** `panels.rule_sweep` calls the same transform at read time, over
`v_lifecycles`, so the sweep is always the current rule against the current register rather than
a snapshot from whenever a scan last ran — see
[What this does not do](#what-this-does-not-do) for why the table form was dropped.

It answers **"how much does the headline depend on which signals I turned on?"** and nothing
else. It is deliberately *not* P2P vol. 9's Figure 19, which plots candidate strategies against
observed exploitation; the subsets here are scored against themselves, so a subset cannot be
"wrong" — a narrow rule simply reports high efficiency over a small high-risk population. Label
it *rule sensitivity*, never *strategy comparison*.

What the sweep is good for is seeing the shape of the trade: each row carries `high_risk` and
`unknown` alongside the two rates, so a subset that buys efficiency by shrinking the high-risk
population — or by pushing rows into `unknown` — cannot hide it. On the exploit-signal rule, the
`KEV only` row is usually the starkest: P2P vol. 9 pp. 22–24 found CISA KEV alone covers only
~19% of what is exploited in the wild, which is why the default rule there is an any-of over
three signals rather than KEV alone.

## MTTR is Kaplan–Meier, not a mean of what closed

Averaging `mttr_days` over resolved findings is survivorship bias with a respectable name. The
findings that take longest are disproportionately the ones *still open*, so excluding them makes
remediation look faster than it is — and the gap widens exactly when a programme is falling
behind, which is when you least want a flattering number.

`metrics.kaplan_meier` (ported from `gas/src/domain/remediation.ts::kaplanMeier`) keeps those
findings in the risk set as **right-censored** observations: "not closed yet" is evidence, just
not the same evidence as "closed on day 40". Columns on the `mttr` family of `…metrics`:

| Column | |
| --- | --- |
| `km_median` | the headline. Smallest time where survival falls to ≤ 50% |
| `km_median_lower_bound` | set **only** when `km_median` is NULL, i.e. more than half of that severity is still open and the median does not exist yet. Report it as "> N d" rather than inventing a number |
| `km_rmst` | restricted mean survival time — area under the curve out to the longest observed time |
| `km_truncated` | survival never reached zero, so `km_rmst` is a floor rather than a mean |
| `km_events` / `km_censored` | how much of the estimate rests on closures vs. still-open findings |
| `mttr_mean` / `mttr_median` | the naive closed-only figures, kept for comparison with the earlier Python spec — the gap against `km_median` *is* the bias |

On the committed `os` fixture the two differ by about 18%: naive 18.1d against a KM median of
21.3d.

Two implementation notes, both of which cost a wrong answer before they were caught:

- Survival is a running product and Spark has no product aggregate. `exp(Σ log f)` is the usual
  substitute, but `log(0)` is NULL in Spark and `sum()` skips NULLs, so a step that resolves the
  entire remaining risk set would be ignored and survival would stay positive after everything
  had closed. A sticky zero flag handles it.
- The median crossing is inclusive, and an exact tie is the *common* case — `0.75 × (1 − 1/3)` is
  exactly 0.5 in IEEE. The `exp(Σ log f)` form returns `0.5000000000000001` for that same curve,
  which fails a bare `<= 0.5` and reports "no median" for a register whose median is real. Hence
  the tolerance in `SURVIVAL_TIE_EPS`.

## Three things that are easy to get wrong

**`null` is not `false`.** `has_kev`, `has_exploit` and `epss` stay nullable the whole way
through. A NULL means the signal was *never captured*, which is not the same as observed-absent.
Coercing it to `false` inflates efficiency's numerator and deflates coverage's — both at once,
and silently. Unclassified findings therefore leave *both* sides of every rate, are counted in
their own row, and drive the published `_lo` / `_hi` bounds, whose width is the size of the
doubt. There is a regression test for exactly this.

**Empty denominators are NULL, not 0.** A rate over an empty population is unknown, and 0%
coverage is indistinguishable from "no high-risk findings" to a reader.

**Exact percentiles.** `metrics.py` uses `F.percentile`, which interpolates linearly the same
way pandas' `.median()` / `.quantile(0.9)` do. `percentile_approx` would quietly disagree with
the dashboard.

## The actionable clock

`mttr_days` answers *how long did this finding live*. It is the wrong question to hold a team
to, on a scope with a vendor: for most of that time there was often nothing to install. The
actionable clock answers *how long did it live once it could have been fixed*, and both are
published, because the gap between them is how much of the exposure was the vendor's.

Five columns on every lifecycle (`ledger.lifecycle_frame`), ported from
`gas/src/domain/ledgerCore.ts::baseRows`:

| Column | |
| --- | --- |
| `fix_available_at` | when a fix first existed: `fix_date`, else `fix_observed_at` |
| `actionable_from` | `greatest(first_seen, fix_available_at)` — **the clock never starts before detection** |
| `mttr_actionable_days` | `resolved_at − actionable_from` |
| `actionable_age_days` | for an open finding, `now − actionable_from` |
| `awaiting_vendor_fix` | open, in a scope that HAS a vendor, and no fix available yet |

and on the `mttr` family of `…metrics`, per severity plus `OVERALL`: `mttr_actionable_mean`,
`mttr_actionable_median`, `actionable_resolved`, `actionable_age_p50` / `_p90`, and
`actionable_sla_compliant`. `actionable_resolved` is the population the second clock could
price at all, and it is published beside the rates for that reason — it is the denominator that
says how much of the register the actionable figures actually cover.

**`awaiting_vendor_fix` is scope-guarded, and that guard is load-bearing.** "Open with no fix
available" is true of every static-analysis finding by construction — a weakness in your own
code has no vendor to wait for — so without the guard every open `sast` row sits awaiting a
vendor forever: out of every actionable clock, in every exposure count, and the two halves of
the page disagree in a way that reads as broken arithmetic rather than a category error. The
mutation is measured rather than argued: put `sast` back into `config.HAS_VENDOR_FIX` and all
40 open findings in the committed capture flip
(`tests/test_code_scopes.py::test_static_analysis_is_never_awaiting_a_vendor_fix`). `os` and `sca`
both have a vendor and both carry the guard's opposite risk — see below.

**The `hasFix` population.** Every scope whose filter pins `hasFix: true` — `os` and `sca`, but
never `sast` — contains only findings that already had a fix when they were ingested. So a row
of such a scope with a blank fix clock has not "no fix available"; it has a fix whose date the
API did not give us, and `fix_available_at` falls back to `first_seen`. Taking GAS's
`fix_date ?? fix_observed_at ?? null` verbatim would mark those rows as awaiting a vendor
**inside a population defined by having one** — the same category error as the `sast` case,
reached from the other side. The bound is one-sided and the derivation says so: the filter
proves a fix existed by the scan that ingested the row, not necessarily by `firstDetectedAt`, so
`first_seen` can sit before the fix shipped and the actionable clock degrades onto the exposure
clock rather than inventing a later start. That is the harsh direction, which is the one to be
wrong in. `config.SCOPES_PINNING_HAS_FIX` is derived from `SCOPES` at import rather than written
out, so dropping `hasFix` from a filter corrects this automatically instead of leaving it
asserting a fix that is no longer guaranteed.

## What this does not do

- **No domain triage.** `gas/src/domain/domainRules.ts` assigns findings to owning teams from
  subscription and tag inputs. `subscription_name` / `subscription_ext_id` are on the `os`
  ledger; **asset tags are not, because `ingest.py` does not select them** — adding that is an
  ingest change (a new field on every `vulnerableAsset` inline fragment), not a ledger one.
- **No retention.** The ledger grows monotonically. The Python spec seals old scans into
  `resolved_episodes` (`wiz_dashboard/data/ledger.py::compact_ledger`); on Delta the equivalent
  levers are `VACUUM` and bronze retention, and a large register will eventually want both.
  Compaction is no longer on this list — [`--maintain`](deploy.md#maintenance) runs `OPTIMIZE` over the
  clustered tables — but nothing here deletes anything, ever, and choosing a retention window is
  the decision that is still outstanding.
- **No period-scoped confusion matrix.** Coverage and efficiency are cumulative over the whole
  ledger, so the per-scan series is a to-date curve and a good quarter barely moves it.
  `gas/src/domain/trend.ts::withCoverageEfficiency` recomputes the pair as-of each trend point
  (using `resolved_at <= d` rather than `status`); there is no equivalent here. See
  [Reading coverage and efficiency](#reading-coverage-and-efficiency).
- **No `secrets` scope.** `gas_devsecops/` measures a fourth population — leaked credentials —
  that has no CVE and no vulnerability-finding representation, and would need its own
  `Source.kind` and its own silver shape rather than a new value squeezed into an existing one.
  Nothing here fetches it.
- **The asset family stops at `sca`.** `os` has no narrow `vulnerableAsset` member list to
  request, and `sast`'s resource is a plain object nothing here has been wired to turn into
  density and capacity figures yet — see [Assets at risk](register.md#assets-at-risk-p2p-v5).
- **Two SAST-specific gaps live in [Scopes](register.md#scopes) rather than here**, because they are
  properties of the *rule*, not the pipeline: `config.CWE_ANCESTORS` is measured-incomplete, and
  `aiAnalysis.verdict`'s enum spelling is unverified against the live tenant.
- **No per-register row-level security.** `os`, `sca` and `sast` share one table set, so a
  `GRANT SELECT` on it hands a reader every scope's rows; restricting a reader to one register
  needs a Unity Catalog row filter keyed on `scope`, and that recipe is documented in
  [1. Store the credentials](deploy.md#1-store-the-credentials) rather than implemented or measured
  against a live workspace.

Two entries left this list with the notebooks. The **Kaplan–Meier survival curve** is now
`metrics.km_curve`, which `kaplan_meier` itself consumes — one implementation, so the staircase
on `01_mttr_sla` and the published `km_median` cannot disagree. The **rule-sensitivity sweep**
used to exist twice — a gold table published a row per scan under the configured rule, and
`panels.rule_sweep` recomputed the same thing at read time. It now exists once: nothing
publishes the sweep any more, and `panels.rule_sweep` is the only path a reader has to it,
recomputed from `v_lifecycles` on every open of `02_program_performance` against whatever rule
the notebook is configured with — so it is always current and never a snapshot from whenever a
scan last ran, at the cost of not being queryable from SQL or trendable across scans the way a
published table would be. `metrics.rule_sensitivity` itself is unchanged and still tested; it is
simply not called from `run_pipeline` any more. Both it and `panels.rule_sweep` still walk the
same `metrics.RULE_SUBSETS`, so they cannot disagree about what a subset is.

Two ledger fields also stay deliberately simple: there is no `tags_json` (see above), and no
`resolved_episodes` table, so a `vuln_key` has exactly one lifecycle row and a reopen overwrites
the previous episode's dates rather than archiving them. `reopened_count` records that it
happened; the earlier episode's `resolved_at` is not kept.
