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
| A | **RESOLVED IN PART, 2026-08-23 — the suspect is exonerated and the premise is contradicted.** The probe that produced the original reading was not sending what the battery sends: `probe.mjs` passed `null` scope for LINEAGE and the agent-rooted four, under a comment claiming it mirrored syncJobs. True at `dfc63b2` (20 Aug), false six commits later at `b3562ae` ("scope every step"), never updated. Corrected, every step's row count now reproduces this document's recorded sync exactly — LINEAGE 590, GUARDRAIL_GAPS 190, RUNS_AS 40, SA_FINDINGS 38, SENSITIVE_DATA_ACCESS 94 — which is the instrument validating itself. **Scoped LINEAGE yields edges: 5 rows → 10 nodes, 5 edges, `PRODUCES 3 · READS_DATA_FROM 1 · STORES_DATA_IN 1`, slots filled at 0/1/2/4.** So the arity guard is not discarding rows, and `normalizeLineagePage` is not the loss. Tracing the rest of the path: `appendPart` copies edges, the gz part round-trip preserves them, `mergeParts` keys them by `edge.id` with no membership filter, `graphEnrich` only ever spreads `[...doc.edges, ...added]`, `realNodes` filters nodes alone, and `edge_count` counts every edge including HAS_ISSUE. Nothing in the pipeline drops a lineage edge. **Still open:** why the recorded sync showed `edge_count` 167 unchanged when ~1 edge per row should have landed ~590. The likeliest reading is now that the 167 and the 590 come from different syncs rather than that anything is losing edges. Settling it needs one full sync, which overwrites the live register — ask before running it. | probe at `--first=5`, scoped; `git log -S` on both files |
| B | **ANSWERED BY INTROSPECTION 2026-08-23, and it is not a rename.** `CloudResourceRelatedIssueFilters` accepts exactly three fields: `severity: CloudResourceRelatedIssueSeverityFilter`, `sourceRule: CloudResourceStringArrayFilter`, `frameworkCategory: …`. So the query is wrong in **three** places, not one: `sourceRuleId` → `sourceRule`; `CloudResourceStringArrayFilter` has **no `equals`** (it takes `containsAny` / `containsAll` / `doesNotContainAny` / `doesNotContainAll` / `isSet`), so `{ equals: $ruleIds }` → `{ containsAny: $ruleIds }`; and **`status` does not exist on that type at all**, nor is there a sibling for it on `CloudResourceV2Filters` (whose full field list the probe now prints on a mismatch). Guessing the first would have failed on the second and third — which is why the entry said introspect. **Do not simply repair and enable it.** `normalizeRuleAssetsPage` hardcodes `status: "OPEN"` on every synthetic row, so a step that cannot constrain to OPEN would mint OPEN issues for already-resolved ones; `reconcileIssues` only supersedes a synthetic row where `ISSUES_TOXIC` returned a real one, and that step is itself OPEN-filtered, so the false rows are exactly the ones nothing would catch. Two real options, both product decisions with a number attached: accept the widening and stop asserting OPEN in the normalizer, or **delete the four steps** — `ISSUES_TOXIC` is now wired to `issuesV2`, carries real status, and has been carrying the register alone (840 issues) for as long as these have been rejected. | `npm run probe -- --vocab-only`; `normalizeRuleAssetsPage`; `wizQueriesAi.ts:Q_RULE_ASSETS` |
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

2. **Lead A — the lineage normalizer.** *Largely answered 2026-08-23; see §4 row A. The
   normalizer is exonerated by measurement — scoped LINEAGE yields edges — and what remains is
   why a recorded `edge_count` did not move. Read §4 A before spending anything else here.*
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

3. **Lead B — the four rejected `ISSUES_<ruleId>` steps.** *Answered 2026-08-23; see §4 row B.
   The spelling is `sourceRule` with `containsAny`, and `status` cannot be filtered here at all.
   What is left is a decision, not a repair: widen and stop asserting OPEN, or delete the four
   steps because `ISSUES_TOXIC` already carries the register. Both need your call.*

4. **`dwell` as a fifth problem-tree axis** (user-chosen). 54 leaves → 162. Existing rows
   wildcard it, so `actLeafCeiling` (0.15) is untouched — ACT stays 11.1% of leaves. Values as
   a delta against Wiz's `dueAt`, never a competing date (§3 T-Test-3). It will **not** unblock
   ACT/ATTEND — it splits the 189-row `TRACK_STAR` queue, which is the actual need.
   *NEEDS A DECISION BEFORE IT IS BUILT, 2026-08-23.* Two problems with the entry as written.
   First, **"§3 T-Test-3" points at nothing** — no such label exists in this file or anywhere in
   `ai/`. Second, and materially: §3 measures `past dueAt` at **82.6%**, so a dwell axis read as
   past-versus-not-past would be one value for five issues in six. `problem.ts:61` rules that
   out in the codebase's own words — "Fewer leaves that are honestly populated beats more leaves
   that mostly read UNKNOWN" — and a 162-leaf tree whose fifth axis is 83% one value is the
   thing that comment forbids. Issue **age** discriminates far better (85% > 90d, 45% > 1y, so
   roughly 15/40/45), and both `createdAt` and `dueAt` are on `IssueRow`
   (`graphTypes.ts:608-609`) — but age means choosing our own thresholds, which is the
   competing clock the entry forbids. **Proposal that satisfies both:** bucket by Wiz's own SLA
   window, `dueAt − createdAt`, so no threshold is ours — `WITHIN_SLA` (not yet due) ·
   `BREACHED` (overdue by less than one window) · `ENTRENCHED` (overdue by more than the window
   Wiz itself set). Three values, 54 → 162 exactly as the entry says. **The split is unmeasured**
   — §3 records only the 82.6%, not the overdue-delta distribution — so measure that first and
   drop the axis if `ENTRENCHED` swallows it.
   *`enumerateDecisionVectors` and `leafCoverage` each exist twice* — `problem.ts:98` and
   `problemRule.ts:388` in the domain, `decideMirror.js:103` and `:284` in the client, with
   comments asserting the pairs are identical and `aars.js:2361, 3409` reconciling them. Both
   copies move together or the preview silently desyncs from saved state. `LeafCoverage.total`
   is commented "Always 54 — `enumerateDecisionVectors().length`, never hardcoded here"
   (`problemRule.ts:367`); confirm that still holds at 162. `actLeafCeiling` is validation-only
   (`:328`) and deliberately outside `vectorSignature` (`:583-585`) — but a new axis changes the
   decision-vector space, so whether it must join `problemRule.vectorSignature` is an open
   question to settle, not an assumption.

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

**Unresolved, noticed 2026-08-23.** `CLAUDE.md` calls a live sync "~71 API calls, ~2 min";
`gas_ai/README.md:72-73` calls the whole battery "~10–20 API calls" finishing "in one hop".
These probably describe different things — a full sync versus the probe battery. Confirm which,
and reword the loser: two durable numbers that look like a contradiction are worse than one.

**Explicitly not doing:** the AIVSS formula (a mean over a 10-element vector of which 9 are
unmeasured — `posture.ts`'s header rules this out); any age term inside AARS; parsing `notes`
into an axis; scoring the 691 service accounts as AI assets; an MTTR.

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
