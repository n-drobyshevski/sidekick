# AARS — what the model measures, and what it could

A second audit of the AI Asset Risk Score in `gas_ai/`, asking a different question from
[AARS_ASSESSMENT.md](AARS_ASSESSMENT.md). That one asked *is the model calibrated* and answered
no, then shipped `AARS_V2_RULE`. This one asks three things it did not:

1. **What data does the product actually have now?** The pipeline has widened a great deal since
   the model was written.
2. **Is the scoring method sound — not tuned, sound?** Against the SMART criteria, letter by letter.
3. **Can it prioritise a singular problem?** Today it cannot: AARS scores assets and nothing else.

The short answers: the sheets carry far more signal than the score reads; one pillar is
structurally broken rather than mis-tuned; and the thing an analyst most needs — *which of these
471 problems do I work on Monday* — has no model at all.

Every claim below is reproduced from this repository's code. File and line references are given
so each can be checked.

---

## 1. The structural finding: pillar B measures our regex, not the estate

`AARS_ASSESSMENT.md` §2 established that pillar B saturates: ~5.5 framework codes per asset
against a 30-point cap, every scored agent at the ceiling. It attributed this to a unit error —
the doc prices a failing *framework*, the code charges per *code*. That is true but it is not the
root cause.

**The framework codes are not Wiz data.** `syncNormalize.ts:454` reads:

```ts
frameworks: group?.frameworks,
```

where `group = classifyIssue({ sourceRuleId, ruleName })` (`toxicCombos.ts:185`). `COMBO_GROUPS`
(`toxicCombos.ts:54-120`) is **four hardcoded literals**, keyed to four Wiz rule ids, each
carrying a hand-written array:

| group | rule id | codes it mints |
|---|---|---|
| `bedrock-no-guardrail` | `wc-id-2742` | LLM06, LLM02, ASI02, ASI03, 5R:Restrict |
| `gcp-managed-privileged` | `wc-id-3217` | LLM06, LLM01, ASI03, ASI01, ML:Data Poisoning, 5R:Restrict, 5R:Reconfigure |
| `gcp-hosted-privileged` | `wc-id-3230` | LLM06, LLM01, LLM02, LLM05, ASI02, ASI03, ASI05, 5R:Restrict, 5R:Reduce |
| `permissive-exec-identity` | `wc-id-3123` | ASI03 (+ 5Rs) |

Two consequences follow, and the second is not in the previous audit:

- An issue **matching** one of the four rules contributes 4–7 codes. Pillar B pins at its cap.
- An issue matching **none** of them gets `comboGroup = OTHER_GROUP_ID` and `frameworks =
  undefined`. `deriveAarsInput` iterates `issue.frameworks ?? {}` (`graphEnrich.ts:101`) and adds
  **nothing**. Pillar B contributes **zero**.

**Pillar B is bimodal — roughly 30 or exactly 0 — and the discriminator is whether a regex
written in December matched a rule name.** The "5.5 codes per asset" are literally the union of
two or three hand-written arrays. The OWASP codes are annotation painted on top of a lookup.

This reframes the fix. `gapAggregation: "rss"` makes the saturation go away without making the
quantity mean anything: root-sum-square over a constant is still a constant. The unit that needs
fixing is not *code vs framework*, it is **label vs condition**. LLM03 / ASI04 / ML_SUPPLY_CHAIN
are one supply-chain condition charged three times; the codebook itself says `NO_GUARDRAIL` **is**
"the LLM01 / ASI01 gap" (`codebook.js:108`), so an asset carrying both is double-charged for one
fact.

The four `CONDITION_KEYS` in `riskConditions.ts` — `MISSING_GUARDRAIL`, `EXCESSIVE_PRIVILEGE`,
`SENSITIVE_DATA`, `INTERNET_EXPOSURE` — are the vocabulary that already exists, is derived from
Wiz data rather than from a literal, and is shared by the graph topology and the combos matrix.
That is what pillar B should price, once each.

---

## 2. What the score reads, against what the product stores

The scoring layer touches `severity`, `status`, the four data/privilege booleans, `guardrailMissing`
and internet exposure. Nothing else. Verified: `aars.ts`, `aarsRule.ts` and `aarsTrend.ts` between
them contain **zero** references to `dueAt`, `createdAt`, `firstSeen`, `validatedAsExploitable`,
`businessImpact`, `environments`, `assignee`, `analyzedAt` or `risks`.

### 2.1 Persisted, and scored by nothing

**`ai_issues`** (34 columns, `sheetsDb.ts:61-74`). Every one of these is written by
`issueToRow` (`syncStore.ts:230`), read back by `rowToIssue`, rendered in `detailSheets.js`, and
reaches no arithmetic:

`created_at` · `due_at` · `updated_at` · `resolved_at` · `resolution_reason` · `resolved_by` ·
`assignee` · `environments` · `validated_exploitable` · `business_impact` · `entity_status` ·
`subscription_id` · `ignore_note` · `ignore_expired_at` · `ticket_urls` · `ai_verdict` ·
`ai_recommended_severity` · `resolution_recommendation` · `remediation`

`due_at` is the only one with any logic at all: `comboDigest.slaTally` (`comboDigest.ts:108`)
buckets past-due / due-soon / no-due-date, and `comboView.slaState` renders a pill. Both display-only.

**`ai_findings`** (32 columns): `first_seen_at`, `analyzed_at`, `risks_json`, `threats_json`,
`business_impact`, `rule_name`, `rule_description`, `remediation_instructions`, `opa_policy`,
`ignore_rule_ids_json`, `iac_finding_ids_json`. `severity` reaches scoring only through
`findingSeverityWeights`, which the spec rule sets to all-1 (`aars.ts:255`) — so a CRITICAL failing
control prices exactly like a LOW one by default.

**`ai_assets`** (41 columns): `first_seen`, `last_seen` (persisted, never differenced — there is no
age anywhere), `human_access_json` (admin / inactiveCount / noMfaCount / dormantFindingCount /
effectiveIds / permissionCount / policyIds), `issue_analytics_json`, `inactive`,
`inactive_timeframe`, `publisher`, `discovery_methods`, `technology_categories`, `tags_json`.

Two columns are read by nothing at all, anywhere: `ai_findings.rule_graph_id` and
`ai_config_rules.external_refs`.

### 2.2 Queried from Wiz, then dropped before persistence

The live capture in `exemples/risk_issues_response.js` shows what Wiz actually returns. Selected
in `wizQueriesAi.ts`, normalized or not, and lost at the sheet boundary:

| dropped | where | worth |
|---|---|---|
| `projects[].id` **and** `projects[].riskProfile.businessImpact` on **assets** | `syncStore.ts:77` writes `projects_json` as **names only**; `rowToAsset` then fabricates `proj-<name>` ids that match no Wiz record | the consequence weight. Kept on `ai_issues` and `ai_findings`, absent on `ai_assets` |
| `sourceRules[].risks` / `.threats` / `.severity` / `.description` | never read by a normalizer | `risks` is `["AI_SECURITY","UNPROTECTED_DATA"]` — a Wiz-native, stable risk vocabulary, and a far better pillar-B basis than four hardcoded arrays |
| `applicationServices { id displayName }` | `wizQueriesAi.ts:687`, never read | the closest thing to a service owner in the whole payload |
| `typedProperties { GEAiAgent { description } }` | fetched by `Q_AI_EXPOSURE`, discarded | the agent's own description — the one field the flat inventory root cannot give |
| `lateralMovementPaths`, `codeSourcePath` | fetched with flags **on**, explicitly refused at `syncNormalize.ts:1371` | blast radius |
| `EffectiveAccessRow.permissions` / `.accessTypes` / `.policyNames` | no table exists for the row type | only `permissionCount` (a number) and `policyIds` survive |

### 2.3 The coverage ceiling in the graph

`EDGE_TYPES` declares **23** kinds (`graphTypes.ts:183-212`). On a live tenant:

| source | count | which |
|---|---|---|
| the sync normalizer | **5** | `RUNS_AS`, `ALLOWS_ACCESS_TO`, `HAS_FINDING`, `HOSTED_ON`, `SERVES` |
| enrichment / read-time stubs | 7 | `HAS_ISSUE`, `PROTECTED_BY` (negated only), `HAS_SENSITIVE_DATA`, `HAS_ACCESS_TO_SENSITIVE_DATA`, `EXPOSED_TO_INTERNET`, `HAS_EXCESSIVE_PRIVILEGE`, `HAS_DATA_FINDING` |
| `sampleData.ts` only | 7 | `INVOKES_TOOL`, `USES_MODEL`, `USES_DATASET`, `STORED_IN`, `BUILT_FROM`, `CAN_INVOKE`, `ENFORCES` |
| on-demand expansion, never persisted | 1 | `USES` |
| declared and never constructed | 3 | `USES_TOOL`, `BOUND_TO`, `PERMITS_ACCESS_ROLE` |

**Eleven of twenty-three never appear on a live tenant's persisted graph.** Any factor a scoring
model wants to read about tool scope, model provenance, memory persistence or agent-to-agent trust
is reading an empty graph. This is a query problem, not a rule problem — no amount of scoring
design reaches it.

Note also that guardrails are only ever observed as an **absence**: `Q_AGENTS_NO_GUARDRAIL` is a
negated traversal, and no positive `PROTECTED_BY` edge is ever synced. `kpis.protectedAgents` is
`agents − flagged`, an inference. `guardrailMissing === false` is an absence of evidence being read
as a control.

### 2.4 Time

Every data tab is overwritten wholesale each sync (`syncStore.ts:717-744`). An issue that moved
OPEN → RESOLVED between two syncs leaves **no trace** beyond its current row. There is no per-entity
status history and no aging computed anywhere.

The only genuine series is `sync_history` — append-only, one row per successful sync, carrying
`aars_severity_json` and `aars_rule_version` and read by `aarsTrendFromHistory` with rule-change
markers. It is a distribution per sync, not a history per entity.

**But the Drive archives retain every raw response page, gzipped, with no pruning**
(`archiveStore.ts:121`) — `syncs/<sync_id>/step-N-page-NNNN.json.gz`. Aging, closure dates and
status transitions are all reconstructable from data already on disk. Nothing reads them.

---

## 3. The SMART verdict

Backed by NIST SP 800-55v1 §3.2 (*Replicability*, *Consistency*) and ISO/IEC 27004 Annex A rather
than by the acronym alone — neither standard uses the word "SMART", and citing it is not a defence.

### S — Specific: **fails**

A score must name its object and its denominator. Pillar B's real denominator is "issues whose
rule id or name matched one of four literals", and that population is never stated. The only
scope-out number the product publishes is `kpis.complianceGapsUnlinked` — findings whose
`resourceId` matches no node — which is honest and is the model to follow.

*Test:* no scored aggregate ships without its excluded-population count beside it. Fail condition:
any published number whose denominator cannot be recomputed from stored inputs.

### M — Measurable: **fails**

Severity is an ordinal label. AARS multiplies it, adds it across four non-commensurable pillars,
and clips the result with caps. Ordinal arithmetic is not licensed by the scale type, and the caps
make it worse: they clip differently under different encodings.

*Test — dispositive, implemented, and it reproduced.* Re-encode `severityPoints` from 50/35/20/8 to
60/30/12/1 — order-preserving, so every severity keeps its rank and only the numeric gaps change —
leave every other knob alone, rescore the estate, and measure Kendall's τ-b between the two
rankings. An order-preserving change to ordinal labels must not change the order of the output.

> **measured: τ-b = 0.9967** (`test/scoreOrdinality.test.ts`)

τ < 1, so the ranking moved. The movement cannot have come from the severity ordinal, which carries
the same information under both encodings — it comes from how pillar A's rescaled points interact
with the other pillars' *fixed* points through the caps and the 0–100 clamp, neither of which scales
with the encoding. The effect is small on this estate because the estate is mostly tied; it is the
sign, not the size, that settles the question.

*Pillar ablation*, measured the same way — zero each pillar's cap and compare the ranking to the
full score:

| pillar zeroed | τ-b vs full |
|---|---|
| A (toxic) | **0.863** |
| B (compliance) | 0.987 |
| C (data) | 0.987 |

Pillar A does essentially all of the ranking work. B and C are near-constant across the estate, so
removing either barely reorders anything — 50 of the 100 points are spent on two pillars that
between them move the ranking by about 1.3%.

*Second test:* `ruleDiscrimination` already reported `distinctScores`, `largestTieGroup`,
`bandOccupancy` and per-pillar saturation. It now also reports **tie rate** (Σ C(nₖ,2) / C(N,2) —
the share of asset *pairs* the model cannot separate) and **effective cardinality** (exp(H) — how
many distinct scores the estate *behaves* as if it has, weighting each by how many assets take it).

> **measured, live path, spec rule: tie rate 0.30, effective cardinality 3.67** against a
> `distinctScores` of 5.

Nearly a third of all asset pairs are unorderable, and the five distinct values behave like three
and a half because one of them is a single asset. Under `AARS_V2_RULE` the same estate measures 0.20
and 6.43 — which is the first time that preset's improvement has been a number rather than a claim.

### A — Actionable and Assignable: **fails**

Every band must name an action, and the top band must be scarce. On live data **every asset that
rates above LOW is CRITICAL** — 19 of 30, with HIGH and MEDIUM both empty and the remaining 11
assets at LOW or INFO. That is not a calibration miss, it is a failed metric: a prioritiser whose
top band holds its entire working population does not prioritise, and a "top 10" cut from a
14-asset tie block is a coin toss.

Assignable is worse, because the data is there and unread. `assignee`, `ticket_urls`,
`resolution_recommendation` and `remediation_instructions` are all persisted. Nothing checks that a
top-band problem has an owner or a next action.

*Test:* `P(top band) ≤ ~11%`, every band non-empty, and the share of top-band problems carrying an
assignee or a ticket within N days of first detection is itself a published measure.

### R — Repeatable: **partly passes**

The strong parts are genuinely strong: pure domain functions, a frozen clock in the test harness,
`aars_input_json` persisting *what the score was computed from* so a rule change re-prices rather
than re-derives, `withCurrentBands` re-deriving levels on read, and `scoringEqual` distinguishing a
band edit from a point edit so a cosmetic change does not strand persisted scores.

Two weak spots:

- `adjustedSeverity` re-rates every Wiz MEDIUM to HIGH (`toxicCombos.ts:60-61`), justified by a
  tenant-wide "5Rs = 53%" constant, with no inter-rater validation. `deriveAarsInput` correctly
  scores `nativeSeverity` and keeps the adjustment as a display lens (`graphEnrich.ts:121-124`) —
  that firewall is right and must be stated in the metric spec, not left as a comment.
- `ai_verdict` / `ai_recommended_severity` are an LLM rater. Non-deterministic by construction, and
  therefore permanently disqualified as a *scoring* input, however useful as evidence.

*Consequence:* record the **source** of every severity (Wiz native / our adjustment / AI verdict) so
"the score changed" and "the source changed" are distinguishable events.

### T — Time-bound: **fails**

`dueAt`, `createdAt`, `firstSeenAt`, `analyzedAt`, `firstSeen`, `lastSeen` are all persisted. None
is scored. There is no aging term, no exposure window, no score expiry, and no as-of stamp on a
published number.

*Test 1:* every persisted score carries an as-of timestamp, and a score past its revision date
renders as stale rather than as a number.

*Test 2 — the one most dashboards fail:* **never publish a bare MTTR over closed issues.** It is
censored data: still-open findings have no close date, so the mean systematically excludes the worst
offenders. Publish a median with censoring, or a survival curve, and say which.

*Test 3:* the risk classification should select the SLA *duration*; the SLA must not enter the
score. `dueAt` is Wiz's deadline and `comboDigest` / `comboView` are deliberately kept in step with
it — so any local target must be rendered as a **delta against `dueAt`**, never as a competing date.

---

## 4. What is good, and must survive any rewrite

Stated plainly because the critique above is long and none of this should be traded away.

| | |
|---|---|
| `ruleDiscrimination` (`aarsRule.ts:405`) | The intrinsic-discrimination instrument the literature asks for and almost nobody builds. A model can stop discriminating without anything looking wrong; this says so. |
| Three kinds of dead rule, distinguished | `shadowedGapRules` (an earlier row claims the code), `unreachableGapRules` (nothing emits it), and a row at zero in `gapMatchTally` (this tenant does not carry it) are three different findings and the code says which. |
| `clean*` / `validate*` as separate stages | Junk is coerced to the documented model; human error is reported and never silently repaired. `cleanAarsRule` on every read **is** the migration mechanism — a new knob with a spec-neutral default is backward-compatible for free. |
| Persist the inputs, not just the output | `aars_input_json` is what makes "recompute" mean *re-price exactly these facts* rather than *derive a different set*, and it is why a whole-estate dry run costs zero API calls. |
| `scoringEqual` vs `rulesEqual` | A band edit moves the label, never the score. The one distinction that keeps the staleness token honest. |
| `ruleSummary` prose readback | The rule in force, in sentences. This is NIST SP 800-55's *Implementation evidence* field, already shipped. |
| The preview shows consequence before saving | Band deltas, movers, per-row coverage, gap census. The instrument needed to calibrate a model — the default rule was simply never fitted with it. |

---

## 5. What is missing, ranked

1. **A problem-level model.** There is no per-issue score, rank or priority anywhere in `src/`.
   `IssueRow` (`graphTypes.ts:414`) carries no numeric field at all. The closest things are
   `adjustedSeverity` (an ordinal re-rating, identical for all 27 amplified issues) and the SLA pill
   — two independent axes never combined. The one cross-entity ranking that does exist,
   `complianceOverview.sharedControls` ("failing controls, ranked by how many frameworks one fix
   would satisfy"), is the right shape and the right precedent.
2. **Exploitation evidence, and its fill rate.** `validated_exploitable` is the highest-value field
   in the model — and it is **`true`-or-absent, not a boolean**: `syncNormalize.ts:483` writes
   `if (raw["validatedAsExploitable"] === true)`. "Wiz evaluated it and said no" is indistinguishable
   from "Wiz never evaluated it". Measure its fill rate before designing around it.
3. **Business impact on assets.** Already queried (`wizQueriesAi.ts:104`), already normalized,
   already typed on `GNode.projects[]`, dropped at `syncStore.ts:77`. `AARS_ASSESSMENT.md` §7 called
   this the highest-value follow-up and it remains one — it is one column.
4. **Untrusted-content ingress.** Nothing in the graph says "this agent ingests attacker-controllable
   content" (web fetch, end-user chat, RAG over external documents). Without it, the one genuinely
   non-linear interaction available — private data ∧ untrusted content ∧ external egress, where the
   conjunction is qualitatively worse than the sum — degrades to plain internet exposure.
5. **Tool privilege, not tool count.** `USES_TOOL` is declared and never constructed. Partially
   recoverable today from `ALLOWS_ACCESS_TO.accessType` (READ / WRITE / ADMIN / HIGH_PRIVILEGE) on
   the execution identity — derive it there before asking for a new query.
6. **Any outcome label.** Reopened-after-fix, exception denied, incident ticket, a human confirming
   an `ai_verdict`. Without one there is no ground truth, so no coverage/efficiency curve, so no
   falsifiable claim: the score can only be asserted. `serviceTickets` and `notes` (with the
   user-vs-`serviceAccount` split) are a usable weak label today.
7. **The five agent facts Wiz cannot carry** — autonomy, action reversibility, non-determinism,
   self-modification, opacity. These are *declarative*: a profile sheet, one row per agent. The
   implementation rule that matters: absent must score as **unknown**, never zero, and the unknown
   count must be published as a coverage metric — otherwise unmeasured agents look safe.

---

## 6. Where this goes

The design that follows from all of the above is **two objects, two units, coupled by one directed
edge and never by arithmetic**:

- **A problem-level verdict** — an ordinal decision cascade over exploitation, technical impact,
  system exposure and mission impact, all four sourced from columns that already exist, producing an
  *action* (`ACT` / `ATTEND` / `TRACK*` / `TRACK`) rather than a number. Stored as a first-match-wins
  cascade so it reuses the editor, the shadow/coverage diagnostics and the preview that pillar B's
  cascade already has.
- **An asset posture tier** — capability × containment × consequence, as a lattice rather than an
  average, because an average over "available dimensions" rewards missing data.
- **The coupling** — the asset tier selects the *policy target in days*, rendered as a delta against
  Wiz's `dueAt`; the asset carries its worst open problem as a typed **max pointer**, never a mean
  and never a count. The 0–100 AARS number survives as an estate percentile caption.

`DEFAULT_AARS_RULE` does not move. Every step is a spec-neutral knob or an opt-in preset, so
[custom_score.md](custom_score.md)'s applied 14-row table keeps reproducing and no tenant re-scores
on upgrade — the convention `AARS_ASSESSMENT.md` §6 established and this work follows.

The first move is not a model, though. It is a measurement, and it has shipped:
`src/domain/rankStats.ts` (Kendall τ-b, tie rate, effective cardinality, Cohen's κ, a seeded
bootstrap CI) plus `test/scoreOrdinality.test.ts` make the claims in §3 executable, and
`RuleDiscrimination` now carries tie rate and effective cardinality onto the AARS Rules page beside
the counts it already showed.

That immediately paid for itself. Pinning `AARS_ASSESSMENT.md`'s published figures as assertions
found that several had gone stale: the seed estate had gained three issues on `agent-e`, which gave
that asset a second issue, which tripped pillar A's `>1` multiplier and moved it out of the 72 tie
block. Largest tie group 15 → 14, and §6's whole AARS-v2 row was wrong. Nothing failed, nothing
looked wrong, and the numbers a reader would have quoted were untrue. Both sections are corrected,
and both are now asserted — which is the only durable version of the fix.

