# AARS — live-tenant measurements, and what they changed

**Tenant** `api.eu15.app.wiz.io` · **project scope** `1dfea0cf-834f-5522-b797-bee5aaf09251`
(VALUE-CHAIN) · **measured** 2026-08-22.

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

`npm run check` green at both: **104 files, 2815 tests**. Branch
`claude/gas-ai-posture-tree-view`.

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
| B | **FIXED AND CONFIRMED ON A LIVE SYNC, 2026-08-23.** `skippedSteps: []`, `skipReasons: {}` — the four steps ran for the first time and returned **797 rows**: `ISSUES_wc-id-2742` 617 · `ISSUES_wc-id-3217` 87 · `ISSUES_wc-id-3230` 86 · `ISSUES_wc-id-3123` 7. Introspection found the query wrong in **three** places, not one, and the tenant only ever reported the first: `CloudResourceRelatedIssueFilters` accepts exactly `severity`, `sourceRule` and `frameworkCategory`, so `sourceRuleId` → `sourceRule`; `CloudResourceStringArrayFilter` has no `equals`, only containsAny / containsAll / doesNotContainAny / doesNotContainAll / isSet, so `{ equals: … }` → `{ containsAny: … }`; and `status` is not a field on that type at all. Because status cannot be filtered, `normalizeRuleAssetsPage` no longer stamps `OPEN` — it stamps `UNKNOWN`, and that is safe because `reconcileIssues` drops a synthetic `live-` row wherever a real issuesV2 row exists for the same (asset, combo group) while ISSUES_TOXIC asks for exactly `UNRESOLVED_ISSUE_STATUSES`: every synthetic row that survives is one Wiz did not return as unresolved, and `isUnresolvedIssue` is right to skip it. The asset still lands on `ai_assets` with its combo-group membership, which is what the per-rule lists wanted. **A number moved that was not predicted:** `issue_count` went from ~99 to **806**, because the four steps now land 707 synthetic rows the register never held. They are not counted as unresolved work (`isUnresolvedIssue` is false for all of them) and they carry no dates, but they ARE rows in `ai_issues` — which is what made the `dwell` axis unmeasurable for 88% of the register (§5 item 4). Worth deciding whether `issue_count` should report unresolved rather than stored. | live sync 2026-08-22T232628Z, 73 API calls, 66s |
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
   *Now ranked first: the smallest change here, and the only one needing no new I/O.* Widen the
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

3. **Lead B — the four rejected `ISSUES_<ruleId>` steps.** *DONE 2026-08-23 — repaired, widened,
   and confirmed on a live sync: `skippedSteps` is empty and the four steps returned 797 rows.
   See §4 row B for the three wrong names and why the status stamp is now UNKNOWN.*

4. **`dwell` as a fifth problem-tree axis — DROPPED 2026-08-23, by decision, on the numbers.**
   It would have taken 54 leaves to 162 while wildcarding existing rows, leaving `actLeafCeiling`
   (0.15) untouched. It does not survive measurement, for two independent reasons.
   **(a) 707 of 806 issues carry no `dueAt` at all.** Only the 99 real issuesV2 rows have one;
   every synthetic `live-` row from the repaired `ISSUES_<ruleId>` steps has none. The axis would
   read UNMEASURED for 88% of the register — exactly what `problem.ts:61` forbids: "fewer leaves
   that are honestly populated beats more leaves that mostly read UNKNOWN".
   **(b) The scorable 12% barely varies.** Bucketed by Wiz's own SLA window (`dueAt − createdAt`,
   so no threshold is ours): WITHIN_SLA 17 (17%) · BREACHED 75 (76%) · ENTRENCHED 7 (7%), with the
   overdue/window ratio degenerate at p25 = p50 = p75 = 0.87, p90 = 0.93. Three buckets, three
   quarters in one, over an eighth of the register — which would not split the 189-row
   `TRACK_STAR` queue, the entry's whole justification.
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

## 6. How to reproduce

**Read-only probe** — sends the app's own query constants, writes only
`probe-vocabulary.json`:

```bash
cd gas_ai && set -a && . ./.env.local && set +a && node probe.mjs --first=5
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
