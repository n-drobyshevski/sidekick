# AARS — live-tenant measurements, and what they changed

**Tenant** `api.eu15.app.wiz.io` · **project scope** `1dfea0cf-834f-5522-b797-bee5aaf09251`
(VALUE-CHAIN) · **measured** 2026-08-22, extended 2026-08-23 by the Phase 0 widening
measurement (§6), which reverses §3's time-axis ordering on a wider register.

A third document beside [AARS_ASSESSMENT.md](AARS_ASSESSMENT.md) and
[AARS_SCORING_ASSESSMENT.md](AARS_SCORING_ASSESSMENT.md), and it exists because those two
measure the **seed estate** through `enrichGraphDoc` and pin every figure in `npm run check`.
A live-tenant figure cannot be pinned that way. So it is recorded here instead, stamped with
tenant, date and scope — and the seed-reproducible half is asserted in tests, per
`AARS_ASSESSMENT.md` §6's own lesson: *a claim a test does not hold is a claim that expires
quietly.*

> **Read the numbers as of the date above.** They are a dated observation, not an invariant.
> Anything here that a test *could* hold, does — the test is named beside it.

---

## 1. State: what has shipped

| Commit | What |
|---|---|
| `12f6bae` | Tri-state at the boundary; measurability; posture scope split; `DERIVATION_VERSION`; posture trend series; `RUNS_AS` attribution |
| `5bbdf25` | `quick: false` on graphSearch — quick mode cannot paginate |
| _(unversioned)_ | `gas_ai/phase0.mjs` — the read-only widening measurement behind §6 |

`npm run check` green at both: **104 files, 2815 tests**. Branch
`claude/gas-ai-posture-tree-view`; §6 was measured from `claude/gas-ai-risk-model-rebuild`.

---

## 2. The landscape

**822 AI assets** in scope — 585 `AI_DATASET`, 86 `AI_MODEL`, 69 `AI_AGENT`, 36 `AI_SERVICE`,
36 `AI_TOOL`, 5 `AI_PIPELINE`, 4 `AI_GUARDRAIL`, 1 `MCP_SERVER`.

**The scope is 7% of the tenant** — 822 of **12,519** AI assets — and therefore so is every
number computed over it. The probe prints this; it is the single most important context for
any figure below.

**99 open AI-category issues** in scope; **840** tenant-wide; **144,025** open issues
tenant-wide across all categories.

| Signal | Live reading |
|---|---|
| issue `severity` | HIGH 2 · MEDIUM 807 · LOW 31 — 96% one value |
| `validatedAsExploitable` | **`false` on 100%** — never `true`, never absent |
| `aiRemediationAnalysis` | 0.8% (7 issues, all `REMEDIATE`) |
| worst project `businessImpact` | **MBI on 839 of 840.** No `HBI` anywhere |
| `assignee` / `serviceTickets` / `notes` | 0.1% · 1.4% · **48.9%** |
| issue age | median **266 days**, p75 436; 85% > 90d; 45% > 1y |
| past `dueAt` | **82.6%** |
| entity carrying the issue | `SERVICE_ACCOUNT` 691 · `AI_AGENT` 120 · `AI_MODEL` 21 · other 8 |
| rule concentration | 11 rules; **659 of 840 (78%) are `wc-id-2742`** (missing guardrail) |
| config findings | 3,639 rows → only **123 open failing gaps** over **7 rules** |

**Asset flags, as the API returns them** — `null` means Wiz never evaluated:

| kind | n | adminPriv | highPriv | accessToSensitive | hasSensitiveData | internet |
|---|---|---|---|---|---|---|
| `AI_AGENT` | 69 | **0/69** | **0/69** | **0/69** | 69/69 | 16/69 |
| `AI_DATASET` | 585 | all null | all null | all null | **0/585** | all null |
| `AI_MODEL` | 86 | all null | all null | all null | all null | 82/86 |
| `AI_SERVICE` | 36 | all null | all null | all null | all null | **2/36** |

**For AI agents Wiz answers everything.** Most nulls elsewhere are *not applicable* (a dataset
has no execution identity), not unmeasured — which is why `measurability.ts` declares
`NOT_APPLICABLE` narrowly and treats everything else absent as a real gap.

---

## 3. What the models output

```
sync-2026-08-22   SUCCESS   live   ~71 API calls
1065 nodes · 167 edges · 99 issues · 822 AI assets · 899 scored

aars_severity    {CRITICAL 8, HIGH 81, MEDIUM 2, LOW 171, INFO 637}
problem_outcome  {ACT 0, ATTEND 0, TRACK_STAR 189, TRACK 33}
posture_tier     {tiers:{1:0, 2:66, 3:2, 4:0}, withheld:306, outOfScope:592, total:966}
guardrail        agents 69 · protected 0 · unknown 1 · coverage 0%
attribution      direct 22 · RUNS_AS 7 · none 70
```

- **`ACT` and `ATTEND` are empty**, and on this tenant they *should* be: `exposure: OPEN` is 0
  (no AI asset is internet-facing) and no `HBI` exists, so the top rows are unreachable for
  reasons about the estate, not defects in the model. The tree's job here is to **order 189
  `TRACK_STAR`s**, and it has nothing to order them with.
- **AARS puts 808 of 899 at LOW or INFO**, with `MEDIUM` holding **2** — a band nothing reaches.
- **Discrimination over the 840-issue register** (`rankStats.ts` formulas; repo reference points
  are spec AARS 0.30/3.67 and `AARS_V2_RULE` 0.20/6.43 on the seed):

  | basis | distinct | tie rate | eff. cardinality |
  |---|---|---|---|
  | **problem outcome alone** | **1** | **1.000** | **1.00** |
  | Wiz severity | 3 | 0.924 | 1.19 |
  | source rule id | 11 | 0.626 | 2.40 |
  | Wiz-native `risks` | 5 | 0.667 | 1.85 |
  | **age bucket** | 5 | **0.308** | **3.86** |
  | overdue bucket | 6 | 0.314 | 3.96 |
  | rule × age | 23 | 0.257 | 6.53 |
  | … × risks × overdue × notes × tickets | 33 | 0.241 | 8.45 |

  **Age alone out-discriminates every axis all four models read, combined**, and needs no new
  query. `risks` adds nothing on top of rule id (it is a function of it) — which contradicts
  `AARS_SCORING_ASSESSMENT.md` §2.2's hope, and is worth correcting there.

---

## 4. Defects found

**Fixed.**

1. **`null` stored as `false`** (`12f6bae`). `syncNormalize.bool` and `syncStore.boolCell`
   collapsed Wiz's "never evaluated" into "evaluated, negative" for five flags. Every
   `unknown` branch downstream was dead, so `tierEstablished` could never withhold a tier and
   an unassessed asset rendered as a clean Tier 1. `guardrailMissing` was worst: the scan is a
   negated traversal that only ever sets it TRUE, so live it reads **true 190 / unknown 776 /
   false 0** — and all 776 were being stored as confirmed guardrails. Shipped as a **default**;
   proven to move no score (live `aars_severity` byte-identical).
2. **`protectedAgents` counted never-scanned agents** (`12f6bae`). Coverage published 1% where
   the confirmed truth is 0%.
3. **quick mode cannot paginate** (`5bbdf25`). `graphSearch` sent `quick: true`, copied from
   console captures; the console never paginates. Every traversal was capped at page 1.
   `LINEAGE` went from **skipped (0 rows) to 590**.
   - Measured: `quick=false` walks 3 pages / 689 rows = `totalCount` exactly.
   - The cheaper fix (quick page 1, non-quick after) **loses 155 of 689 rows, 22%** — the
     cursor is accepted across modes but does not continue where page 1 stopped.

**Open, with evidence.**

| # | Defect | Evidence |
|---|---|---|
| A | **RESOLVED 2026-08-23. There is no loss — the premise was wrong, and so was the first correction to it.** Persisted `ai_edges` after a live sync holds 68 rows: RUNS_AS 40 · BOUND_TO 12 · ALLOWS_ACCESS_TO 11 · **PRODUCES 3 · READS_DATA_FROM 1 · STORES_DATA_IN 1**. LINEAGE contributes **5 edges and all 5 persist**, matching the probe exactly at the sync's own page size. The cause is the tenant, not the code: at `--first=250` the slot fill is `0:250, 1:3, 2:1, 4:1` — **585 of 590 rows are a bare root with every optional leg null**, so this estate records almost no AI lineage. `edge_count` 167 = 68 asset edges + 99 `HAS_ISSUE`; the "167 before and after" reading was a **5-edge delta mistaken for none**. The arity guard never discarded anything — arity passes, the legs are simply absent. Two corrections worth keeping: the original entry read 5 edges as 0, and the 2026-08-23 note that "the premise does not survive" over-corrected, because getGraph returns a depth-limited projection (61 of 167) rather than the register. Read `ai_edges` directly, never getGraph, to count edges. | live sync 2026-08-22T232628Z; `probe.mjs --first=250` |
| B | **RESOLVED BY DELETION, 2026-08-23 — the four steps are gone.** They were repaired first (three wrong names in one filter: `sourceRuleId` → `sourceRule`, `equals` → `containsAny`, and `status` is not a field on `CloudResourceRelatedIssueFilters` at all), and the repair immediately exposed a second defect the failure had been hiding: **the steps carried no `projectScope()`**, unlike all 32 other uses in `syncJobs`, and `Q_RULE_ASSETS` had no `project` in its `filterBy`. So they collected **tenant-wide into a project-scoped register** — 797 rows and 617 assets where the scope holds 99 issues, taking `issue_count` to 806 and `node_count` to 1757. Scoping would have fixed the count but not the principle: `normalizeRuleAssetsPage` synthesised one issue row per ASSET from `cloudResourcesV2`, with a fabricated `live-` id, and `reconcileIssues` dropped such a row only where a real issuesV2 row already covered it — so every synthetic row that survived was by construction one Wiz did not return. **`ai_issues` is meant to be exactly what Wiz returned**, so the whole path was removed: the four steps, `Q_RULE_ASSETS`, `normalizeRuleAssetsPage`, and `reconcileIssues` (now a no-op, since nothing mints a `live-` id). Nothing regressed — the steps had contributed zero rows for their entire existence. Verified on a live sync: **`issue_count` 806 → 99**, exactly `ISSUES_TOXIC`; `node_count` 1757 → 1062; `edge_count` unchanged at 167 with lineage intact; `api_calls` 73 → 68; `skippedSteps` empty. `test/stepPageSize.test.ts` now pins their **absence** so a re-introduction fails there first. | live sync 2026-08-23, 68 API calls |
| C | **`HOST_EXPOSURE`, `ENDPOINT_EXPOSURE`, `IDENTITY_ACCESS` return 0 rows.** This is why 16 hosted agents have null internet exposure and why `withheld` is 306. | `stepRows` = 0 |
| D | **The rule-id census counts issues only, but `exploitationByRuleId` prices findings too.** `exploitationOfFinding` matches the same operator table on `finding.ruleShortId` (`problem.ts`), while `problemCensus` is issue-shaped by design. So the picker added 2026-08-23 shows a rule id's issue reach and never its finding reach, on the largest step in the sync. Understates, never overstates — naming a rule id can only match more than the hint claims — so it is safe, not urgent. The honest fix is its own change: it must not make `CensusEntry.issues` untrue. | `stepRows.CONFIG_FINDINGS = 3639`; `problem.ts:exploitationOfFinding` |

Per-step rows, last sync: `CONFIG_RULES` 3905 · `CONFIG_FINDINGS` 3639 · `AI_ASSET_PROPERTIES`
822 · `INVENTORY_AI` 822 · **`LINEAGE` 590** · `EFFECTIVE_ACCESS` 500 · `GUARDRAIL_GAPS` 190 ·
`ISSUES_TOXIC` 99 · `SENSITIVE_DATA_ACCESS` 94 · `RUNS_AS` 40 · `SA_FINDINGS` 38 ·
`AGENTIC_IDENTITIES` 31 · `HOST_EXPOSURE` / `ENDPOINT_EXPOSURE` / `IDENTITY_ACCESS` 0 ·
`truncated: []`.

---

## 5. What is left, ranked

Re-ranked 2026-08-23. The notes italicised under each item were established by **reading the
source**, not by re-measuring the tenant — no figure in §1–§4 moved.

1. **`problemCensus` gains `ruleId`** (~10 lines). `exploitationByRuleId` ships empty with no
   census to populate it from. Surfacing `wc-id-2742 — 659 issues` lets **one** operator
   judgement reach 78% of the register — the only lever on a 93.9%-unknown axis.
   *Now ranked first: the smallest change here, and the only one needing no new I/O.*
   **DONE, and one figure restated 2026-08-23.** The reach was reported as "617 of 806 issues"
   while the register was polluted by the tenant-wide `ISSUES_<ruleId>` leak (§4 row B). Measured
   against the real in-scope register, the census reads `wc-id-2742` **70 of 99 (71%)**, then
   `wc-id-3217` 13, `wc-id-3484` 7, `wc-id-3230` 6, `wc-id-3123` 3. Still the dominant lever and
   still the argument for the picker — but 71% of 99, not 77% of 806. The 78%-of-840 figure in §3
   is tenant-wide and remains correct for that population. Widen the
   param at `problemRule.ts:634`, add a `ruleIds` accumulator beside `:636-637`, mirror
   `:641-644` in the loop, add `ruleIds: CensusEntry[]` to `ProblemCensus` (`:628-631`) and
   `ruleIds: rank(ruleIds)` to the return (`:655`). `rank` and `PROBLEM_CENSUS_MAX = 200` are
   already generic, and the caller (`api.ts:2742`) needs nothing because `IssueRow.ruleId` is a
   required field (`graphTypes.ts:557`). Rendering the new list client-side is separate work.

2. **Lead A — the lineage normalizer.** *CLOSED 2026-08-23, no defect. See §4 row A: LINEAGE
   yields 5 edges and all 5 persist; 585 of 590 rows are a root with every optional leg null.
   Nothing to fix here — the estate has almost no lineage to collect.*
   *The arity hypothesis is settled by reading, and needs no live sync.* `slots` comes from
   `flattenSlots(lineageSpec())` (`syncNormalize.ts:1217`), and `lineageSpec()`
   (`lineageQuery.ts:129-145`) is one root node plus three top-level legs plus one nested leg:
   `slots.length === 5`, always. The root unions its types on a **single** node
   (`LINEAGE_ROOT_CANDIDATES`, `:90`), so root-narrowing provably cannot move the arity —
   exactly as suspected above, now confirmed. What remains is binary, and `node probe.mjs
   --first=5` (read-only; LINEAGE wired at `probe.mjs:344`) settles it — **report node count
   beside edge count.** Nodes 0 means the 590 rows fail the guard at `:1220`; nodes > 0 with
   edges 0 means they pass it and every edge-bearing slot has a null parent or child
   (`:1224-1228`). The guard is pinned by `test/lineageQuery.test.ts:198-204`, so changing it
   changes that test: name the falsified claim first. Latent trap — `normalizeLineagePage` calls
   `lineageSpec()` with no argument while senders may narrow roots via `lineageRoots(types)`;
   harmless only while root count does not drive slot count.

3. **Lead B — the four `ISSUES_<ruleId>` steps.** *CLOSED 2026-08-23 BY DELETING THEM. See §4
   row B. Repairing them exposed a missing `projectScope()` and, behind that, a reconstruction
   path that could only ever add rows issuesV2 never returned. `ai_issues` is now exactly what
   Wiz returned: `issue_count` 99.*

4. **`dwell` as a fifth problem-tree axis — DROPPED 2026-08-23, by decision, on the numbers.**
   It would have taken 54 leaves to 162 while wildcarding existing rows, leaving `actLeafCeiling`
   (0.15) untouched. It does not survive measurement, for two independent reasons.
   **(a) WITHDRAWN 2026-08-23 — this reason was an artifact of a defect, not a fact about the
   tenant.** It read "707 of 806 issues carry no `dueAt`", which was true only while the register
   held 707 synthetic rows from the `ISSUES_<ruleId>` steps. Those rows are deleted (§4 row B),
   and re-measured against the real register the coverage is **`noDueAt = 0`: all 99 issues carry
   a `dueAt`**. Coverage is not the problem and never was.
   **(b) STANDS, and is now the only reason — measured over 100% of the register.** Bucketed by
   Wiz's own SLA window (`dueAt − createdAt`, so no threshold is ours): WITHIN_SLA 17 (17%) ·
   BREACHED 75 (76%) · ENTRENCHED 7 (7%), with the overdue/window ratio degenerate at
   p25 = p50 = p75 = 0.87, p90 = 0.93. Three quarters in one bucket, and a ratio that barely
   moves across the quartiles.
   **But weigh it against the axes the tree already has before treating this as settled.**
   `businessImpact` is MBI on 839 of 840 (§3), so `mission` is one value for essentially the whole
   register — it multiplies the leaf count by three and discriminates nothing. On the "honestly
   populated" test `problem.ts:61` sets, a 17/76/7 axis at full coverage is **better** than the
   constant axis already in the tree. The open question is therefore not only "should dwell go in"
   but "does `mission` earn its place", and the second is the cheaper win: dropping a constant
   axis takes 54 leaves to 18 and loses nothing.
   Two notes for anyone who revives it. The original entry cited "§3 T-Test-3", which exists
   nowhere in this file or in `ai/`. And issue **age** discriminates better (85% > 90d, 45% > 1y)
   but needs thresholds of ours, which the entry forbade as a competing clock — so a revival
   needs a *new* signal carried by more than 12% of the register, not a rebucketing of this one.

5. **The staleness banner UI.** `bootstrap.derivation {current, lastSync, stale, remedy:"sync"}`
   ships and nothing renders it. The tier population legitimately collapsed; nothing says why,
   or that Recompute cannot fix it.
   *DONE 2026-08-23.* The two notices now come from one pure function,
   `src/client/js/staleness.js:staleNotices(boot)`, which `inventory.js` renders in order. Its
   own module rather than an export of the page, because `pages/inventory.js` transitively
   imports `charts.js`, which reads `window` at module scope — anything exported from the page
   is only testable inside a DOM environment, and this is pure. Derivation is emitted FIRST:
   it is the one Recompute cannot fix, so an operator who reads a single line reads that one.
   The remedy is keyed off the server's own `derivation.remedy` rather than hardcoded, which is
   what `api.ts:409-416` asks for in as many words, and an unknown remedy falls back to sync
   rather than dropping the warning. Six tests in `test/staleNotices.test.js`.

6. **A data-plane lattice** (user-chosen). Constraint: on this tenant `hasSensitiveData` is
   `false` for **all 585** datasets and `businessImpact` is MBI for **all 753**, so
   classification and consequence are constants. Only **provenance** (`technology.name` —
   currently dropped by the normalizer), **lifecycle** (`status` + the
   `custom/aiml-model-status` tag, which is the live derivation for `DEPRECATED_MODEL`, a
   cascade row `AARS_ASSESSMENT.md` §3.3 calls underivable) and **age** discriminate.
   **284 of 585 datasets are "Dataset *Version*"** — the register counts versions as assets,
   inflating every published denominator.
   *Reuse `latticeSection`* (`src/client/js/ui/latticeSection.js:63`), which is generic and
   spec-driven; add a third spec beside `PROBLEM_LATTICE` and `POSTURE_LATTICE` (`lattice.js:84`,
   `:117`). Acceptance is the lattice's **own rule** validating with its cells pinned — a rule is
   pinnable, a tenant figure is not. The constants above stay recorded here instead.
   *PROVENANCE DECLINED 2026-08-23 (user decision): `technology.name` is not carried.* The query
   already selects `technology { id name categories { id name } }` (`wizQueriesAi.ts:107`, `:978`)
   and `normalizeCloudResource` keeps only `categories[].name` as `technologyCategories`
   (`syncNormalize.ts:165-173`), discarding the name. Carrying it would have been six edits along
   a named path — `graphTypes.ts:333`, `syncNormalize.ts:165`, `sheetsDb.ts:38`,
   `syncStore.ts:155` and `:258`, `api.ts:839` — at no extra I/O, but it adds a persisted column,
   and that column is now declined. **Do not re-propose it without a new reason.**
   **CONSEQUENCE — this may leave too little to build a lattice on, and that is unmeasured.**
   §3 establishes that on this tenant classification and consequence are constants:
   `hasSensitiveData` is `false` for **all 585** datasets and `businessImpact` is MBI for **all
   753**. With provenance now declined, the only candidate axes left are **lifecycle** (`status`
   plus the `custom/aiml-model-status` tag) and **age**. Two axes is a thin lattice, and there is
   a live risk that lifecycle is a third constant — the sampled assets all read `status: "Active"`,
   though that is a handful of rows and not a measurement. Before any cell is drawn, measure the
   lifecycle and age distributions over the 585 datasets the way `dwell` was measured, and apply
   the same bar: `problem.ts:61`, fewer cells honestly populated over more that read UNKNOWN.
   A one-axis lattice is not a lattice.
   *Also still true:* `detailSheets.js:322` labels `technologyCategories` as "Technology", which is
   the category list under the name of the field that will now never exist.

**Explicitly not doing:** the AIVSS formula (a mean over a 10-element vector of which 9 are
unmeasured — `posture.ts`'s header rules this out); any age term inside AARS; parsing `notes`
into an axis; scoring the 691 service accounts as AI assets; an MTTR; and — added 2026-08-23,
measured rather than assumed — **a time/`dwell` axis on the problem tree**, which stays at four
axes (item 4 above carries the numbers).

---

## 6. Phase 0 — the widening measurement (2026-08-23)

**Measured** 2026-08-23, same tenant and project scope as §2. Tool: `gas_ai/phase0.mjs` —
read-only, writes only `phase0-report.json`. **~700 API calls**, all counts and introspection;
nothing written to Wiz, the Sheet or Drive. A sibling to `probe.mjs` rather than a mode inside
it, because every question here is about queries the battery does **not** have.

The question: the four models read axes that are constants (§3). Is that a fact about the
estate, or an artifact of the register being filtered twice — one project **and**
`frameworkCategory: wct-id-1998`?

**It is an artifact.** But widening has a ceiling, and past it the signal gets worse.

### 6.1 The candidate set, and why not simply "all categories"

74 categories carry at least one open issue in scope. The sum across them is **74,209** against
a ceiling of **14,617**, so each issue sits in roughly **five** categories — marginal rows per
category are far below its count, and picking by count would be wrong.

| scope | open issues | config findings |
|---|---|---|
| `wct-id-1998` (AI) only — today | **99** | **123** |
| candidate set, 6 categories | **6,073** | **18,523** |
| every category in project scope | **14,617** | **124,554** |

The candidate set, chosen for balance rather than size (the four largest categories are 6k–9.5k
rows of general IT hygiene each):

```
wct-id-1998                            AI Security                 99
wct-id-3                               Vulnerability Assessment   677
41a3ed79-9a2c-4466-9109-f845fd057bd4   High Profile Threats       536
5c3c85b5-bb94-4ee7-8f3e-c186d0229280   Data Security              439
1f28667a-9d12-48dd-898d-d326bb422f8d   Key & Secret Management  1,390
861eb856-54f6-4d1b-8ca1-1d6130841d20   Identity Management      3,477
```

### 6.2 Minimal beats maximal on SIGNAL, not only on cost

Severity, by exact filtered counts rather than a sample:

| | TODAY (AI) | **CANDIDATE (6)** | CEILING (all) |
|---|---|---|---|
| distribution | `{LOW 10, MEDIUM 89}` | `{INFO 2916, LOW 1547, MED 1604, HIGH 6}` | `{INFO 8546, LOW 2647, MED 3403, HIGH 21}` |
| effective cardinality | 1.39 | **2.88** | 2.64 |
| tie rate | 0.817 | **0.365** | 0.429 |

**Widening past the candidate set makes the model worse**: the full estate is 58%
`INFORMATIONAL` (8,546 of 14,617), which drowns the signal. Minimal categories is right on the
numbers, not only on the storage budget.

Also measured, and worth recording: **no `CRITICAL` issue exists in project scope at all**, and
only **21 `HIGH`** of 14,617.

### 6.3 The time axis must be AGE — and this reverses §3

| | TODAY (AI) | CANDIDATE (6) | CEILING |
|---|---|---|---|
| `dueAt` coverage | **100%** | **38.4%** (2,329/6,073) | 26.4% (3,852/14,617) |
| age — effective cardinality | 3.27 | **4.26** | — |
| age — tie rate | 0.395 | **0.261** | — |

`dueAt` collapses on widening; age holds 100% coverage by construction and *improves*.

**§3 records "overdue bucket 3.96, age 3.86" and CLAUDE.md repeats it. That ordering holds only
on the AI slice** — the one slice with full `dueAt` coverage. The rule is not wrong; its
register is. `createdAt` is on `IssueFilters`, so age is exactly countable rather than sampled.
Bucket edges need retuning: **nothing in scope is older than 730 days**, so that bucket is
always empty.

### 6.4 The exploitation axis does not exist today; widening is what creates it

`vulnerabilityFindings`, project scope, `status: OPEN`:

| filter | count |
|---|---|
| (none) | **5,173,698** |
| `hasExploit` | 1,028,591 |
| `hasCisaKevExploit` | 9,971 |
| `hasRelatedIssue` | 7,381 |
| `hasExploit` and `hasRelatedIssue` | 2,195 |
| KEV and `hasRelatedIssue` | 717 |
| **related to an AI-category issue** | **0** |
| **related to a candidate-category issue** | **7,368** (99.8% of 7,381) |

Not "weak" — **empty**. KEV findings sit on `VIRTUAL_MACHINE` (79 of 100 sampled) and
`CONTAINER_IMAGE` (21), which this register does not hold, so the direct asset join is ~0% and
attribution must run *through* the issue register.

Exploitation axis over all 5.17M, from exact counts:
`{ACTIVE 9,971 · LIKELY 1,018,620 · NONE/UNKNOWN 4,145,113}` — effective cardinality **1.66**,
tie rate 0.681. **The 5.17M is never ingested**: KEV union relatedIssue is ~17k rows and is the
whole signal.

### 6.5 Two axes are dead by measurement

- **`businessImpact` is degenerate, not merely constant.** Every issue matches *both* `LBI` and
  `MBI` — 99/99 at the AI scope, 14,617 and 14,608 of 14,617 at the ceiling. `HBI` absent
  everywhere. The filter is always-true, so the axis carries no information at any scope. This
  is stronger than §3's "MBI on 839 of 840": that was the worst-of fold; this is the raw filter.
- **`validatedAsExploitable`**: **2** true out of 14,617.

### 6.6 The framework map is real — 88%

**22 of 25** distinct configuration-finding rules resolve to a framework policy, against a
framework side holding **2,606** distinct rule ids across 8 enabled frameworks (5Rs, CIS
Alibaba / AWS / Controls v8, `[Company]` ISSP and data-security frameworks, `[Company]` Linux
Hardening — the last contributing 0 policy rules).

So `toxicCombos.ts`'s four hardcoded `COMBO_GROUPS` literals can be replaced by Wiz's own
mapping, which `AARS_SCORING_ASSESSMENT.md` §1 calls for in as many words: *"pillar B measures
our regex, not the estate."*

### 6.7 Distinct resources behind the widened register

The open storage question — findings reference resources `ai_assets` does not hold:

| | distinct resources |
|---|---|
| config findings, candidate categories | **14,459** |
| assets carrying KEV vulns | 1,976 |
| assets carrying related-issue vulns | 633 |

`ai_assets` would grow **822 → ~17,000** (overlap unmeasured, so this is an upper bound).
At 48 columns that is ~816k cells. Whole-workbook estimate at the candidate set — issues 213k
+ findings 593k + vuln findings 272k + assets 816k — is roughly **1.9M of the 10M cell cap**.
It fits.

### 6.8 Schema facts this cost real calls to learn

- **`Issue` has 51 fields and not one names a category.** `scanVars.ts:118` is exactly right —
  the category filter *is* the claim. So a widened register must **stamp each row with the
  category it was fetched under**, or "AI issues" silently becomes "all issues".
- **`VulnerableAsset` is a union of 16 types.** `vulnerableAsset { id }` is rejected; it needs
  an inline fragment per member.
- **Introspection by variable is refused by this gateway** — `__type(name: $n)` answers
  "missing value for non-null variable" however the variable is sent. Use a literal type name.
- **`RelatedIssueFrameworkCategoryFilter` takes `equalsAny`**, not `equals`.
- **Project scope on `vulnerabilityFindings` is `projectIdV2: { equals: [...] }`** — a **sixth**
  spelling beyond the five tabulated at `probe.mjs:238`.
- `IssuesGroupedByValueField` has no category value (`SOURCE_RULE, RESOURCE, SUBSCRIPTION,
  PROJECT, KUBERNETES_*, CONTAINER_SERVICE`), so per-category counts cost one call each — which
  is how this run reached ~700.
- `securityCategories` returns 500+ and includes CIS benchmark rows and UUID-keyed custom
  categories, not only `wct-id-*` ids.

### 6.9 What this changes

1. The register widens to the **candidate 6 categories**, held in settings, one query per
   category with the category stamped on the row.
2. The time axis becomes **age**, not overdue.
3. `vulnerabilityFindings` joins the battery **filtered to KEV union relatedIssue**, never whole.
4. `businessImpact` / `mission` is **dropped**, on 6.5 rather than on taste.
5. The framework map replaces the four `COMBO_GROUPS` regexes.

---

## 7. How to reproduce

**Read-only probe** — sends the app's own query constants, writes only
`probe-vocabulary.json`:

```bash
cd gas_ai && set -a && . ./.env.local && set +a && node probe.mjs --first=5
```

**The Phase 0 widening measurement** (§6) — read-only, writes only `phase0-report.json`.
It reads `.env.local` itself, so it needs no `set -a` wrapper:

```bash
cd gas_ai
node phase0.mjs --stage=a    # schema: what the tenant accepts
node phase0.mjs --stage=b    # rows per risk category  (~500 calls — see §6.8)
node phase0.mjs --stage=c    # severity/impact variance by scope, exact counts
node phase0.mjs --stage=t    # the age axis
node phase0.mjs --stage=d    # vulnerabilityFindings funnel
node phase0.mjs --stage=j    # exploitation attribution
node phase0.mjs --stage=e    # framework join
node phase0.mjs --stage=r2   # distinct resources
```

**A full live sync in Node.** The dev harness normally runs in a browser tab, because
`UrlFetchApp` is a synchronous `XMLHttpRequest` against the dev server's `/_fetch` proxy. To
run the same sync headless — which is what made every figure above measurable — supply a
synchronous `XMLHttpRequest` backed by `child_process.execFileSync` (one short-lived node
process per call), then:

```js
globalThis.window = globalThis;
globalThis.XMLHttpRequest = SyncXHR;              // the shim above
vm.runInThisContext(read("dev/gas-shims.js"));
vm.runInThisContext(read("dev/server.dev.js"));   // NOT dist/ — see below
Server.setup();
// set WIZ_* Script Properties to the __DEV_WIZ_*__ placeholders; the proxy substitutes them
Server.api.runSync({});
// poll getSyncHistory until row.finished_at, then read getAssets / getScanQueries
```

Three traps, each of which cost a debugging cycle:

- **`npm run build` writes `dist/`, not `dev/server.dev.js`.** The dev bundle is rebuilt by
  `dev/serve.mjs` when `/` is requested. A stale bundle makes a working feature look absent —
  every new field reads `undefined`.
- **`Utilities.sleep` busy-waits on `Date.now()`**, which `test/gasEnv.ts` freezes. That is an
  *infinite* loop, not a slow one, and it is synchronous so no test timeout interrupts it.
  `window.__GAS_SHIM_INSTANT_SLEEP__` is the escape hatch; the test harness sets it.
- **The dev server 500s under memory pressure.** `Command failed: node esbuild.config.mjs`
  with empty stdout *and* stderr is a failed spawn, not a failed build. Restart it.
