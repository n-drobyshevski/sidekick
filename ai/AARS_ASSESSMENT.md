# AARS — assessment of the scoring rules

An audit of the AI Asset Risk Score as implemented in `gas_ai/`: what it does, where it
stops working, and what was changed. Every measurement below is reproduced from this
repository's own code and seed data — the reproduction is in "How to reproduce" at the end.

---

## 0. The model under audit

```
score = min(100, A + B + C)
A = severityPoints[worst open issue] × (1.2 if >1 open issue), capped 50
B = Σ over distinct gap codes of a first-match-wins ordered cascade, capped 30
C = round(dataExposurePoints[SENSITIVE 20 | DATA_ACCESS 10 | NONE 0] × 1.1)
bands: CRITICAL ≥70, HIGH ≥50, MEDIUM ≥30, LOW ≥10, else INFO
```

Ported from [`custom_score.md`](custom_score.md); implemented in
`gas_ai/src/domain/aars.ts`, tuned through `AarsRule`, edited on the AARS Rules page.

## 1. What the design gets right

Stated first because the critique below is about calibration, not craft, and none of these
should be traded away to fix it.

| | |
|---|---|
| **The rule is data, not constants** (`aars.ts:81`) | Tunable per deployment, versioned (`settingsLogic.ts:70`), with a staleness token that knows a band edit from a point edit (`aarsRule.ts:309` `scoringEqual`). |
| **Gap codes are opaque keys the codebook only annotates** (`codebook.js:5-8`) | A wrong title can never produce a wrong number. This is what lets four unstable vocabularies ride along safely — and it is why §5's corrections are free. |
| **`clean*` / `validate*` are separate** (`aarsRule.ts`) | Junk is coerced to the documented model; human error is reported and never silently repaired. |
| **Pillar A scores `nativeSeverity`** (`graphEnrich.ts:74-77`) | A deliberate guard against double-counting the 5Rs amplifier, which already re-rates severity for display. Correct. |
| **`aarsInput` is persisted beside the score** (`graphTypes.ts:161`) | A rule change re-prices *exactly those* gaps rather than re-deriving a different set. |
| **The preview shows consequence before saving** (`api.ts:725`) | Band deltas, movers, per-row coverage, gap census. **The instrument needed to calibrate this model already shipped — the default rule was simply never fitted with it.** That is the shape of the whole fix. |

## 2. The finding: on live data the score collapses

`deriveAarsInput` (`graphEnrich.ts:62`) emits one gap per **distinct framework code** across
an asset's open issues. Wiz maps a single toxic-combination issue onto 2–3 OWASP LLM codes
*and* 2 ASI codes *and* an ML title, plus `NO_GUARDRAIL` — about 5.5 codes per asset. Summed
against a 30-point cap, that saturates:

| asset | codes derived | raw pillar B | after cap |
|---|---|---|---|
| `agent-a` | 6 | 55 | **30** |
| `agent-g` | 6 | 55 | **30** |
| `agent-autogen` | 5 | 45 | **30** |
| …all 11 agents | 5–6 | 45–55 | **30** |

Scored end-to-end over the seed estate through the live path:

```
spec rule, LIVE derivation   distinct scores: 5     largest tie group: 15
0,0,0,0,0,0,0,0,22,29,29,72,72,72,72,72,72,72,72,72,72,72,72,72,72,72,76,76,76,76
bands: CRITICAL 19 · HIGH 0 · MEDIUM 0 · LOW 3 · INFO 8
pillar B at cap: 19 of 19 scored agents
```

**Fifteen assets tie at exactly 72. Every scored agent is CRITICAL. HIGH and MEDIUM are
unreachable.** A prioritiser that rates everything CRITICAL does not prioritise, and a
"top 10" cut from a 15-asset tie block is arbitrary.

The dashboard's demo hides this: the dry-run scores from `SEED_AARS_HINTS`
(`sampleData.ts:507`), which pin 2–3 codes per asset transcribed from the doc, and produce
10 distinct scores across five bands. **The demo and production disagree about the model,
and only the demo looks healthy.**

**Root cause.** [`custom_score.md:21-24`](custom_score.md) prices "a failing OWASP LLM
**control**" — one charge per framework. The implementation charges per **code** within the
framework, roughly tripling the intended amount, and the cap then hides the error.

### 2b. Contributing: the other two pillars are near-constant

- **Pillar C** is 22 for any asset touching sensitive data — that is 20 of 30 seed assets at
  the ceiling. Three possible values, one of which nearly everyone takes.
- **`NO_GUARDRAIL` (+10)** fires on ~96% of the estate:
  [`queries/4_guardrail_coverage.md:551`](queries/4_guardrail_coverage.md) measures *3
  guardrails / 71 agents = 4.2% coverage*. The largest exact row in the cascade is a
  constant in all but name.
- **Pillar A** is 20 or 24 for the ~93% of issues rated MEDIUM.

So the live score is `A(20|24) + B(30) + C(22)` — two values.

## 3. Four further defects

**3.1 Pillar A is blind to issue count.** `aars.ts:152` multiplies by 1.2 when `length > 1`,
so 2 issues and 40 score alike. In the normative applied table this already inverts the
ranking: **`AWSReservedSSO` with 8 open issues scores 65, below `Agent-G` with 2 at 66**;
`agent-I` (×4) and `Agent-G` (×2) are exactly equal at 66.

**3.2 The ×1.1 "5Rs amplifier" is a tenant-wide constant that still moves bands.**
`dataAmplifier` (`aars.ts:101`) is applied identically to every asset, so it can never change
a *ranking* — only inflate. But it does change *levels*: removing it flips `agent-H-chatbot`
from **71 CRITICAL to 69 HIGH**. A single global posture number decides an individual asset's
remediation SLA. The derivation from "5Rs = 53%" to ×1.1 is unstated, and it never refreshes
when the 5Rs score does.

**3.3 A third of the cascade is dead on live data.** Not shadowed — `shadowedGapRules`
returns `[]` — but *unreachable*, which the page previously reported as "in force — nothing
in this tenant carries it", indistinguishable from a rule in working order.

| row | why it can never fire |
|---|---|
| `exact FIVE_RS` / `prefix 5R` | `deriveAarsInput` reads `owaspLlm`/`owaspAgentic`/`owaspMl` only. `frameworks.fiveRs` **is** populated on every issue (`toxicCombos.ts:64`) and rendered (`detailSheets.js:70`), but never becomes a gap code. |
| `exact DEPRECATED_MODEL` | Produced only by the pinned dry-run hint. `status === "Deprecated"` is on the node and persisted (`sheetsDb.ts:28`); nothing derives the gap. |

**3.4 Overlapping taxonomies are charged independently.** LLM / ASI / ML are three
vocabularies for largely the same risks: LLM03 *Supply Chain* + ASI04 *Agentic Supply Chain*
+ ML06 *AI Supply Chain* is **one** condition charged three times (+10 +10 +5). The codebook
itself says `NO_GUARDRAIL` **is** "the LLM01 / ASI01 gap" (`codebook.js:108`), so an asset
carrying both is double-charged for one condition. This is a direct cause of §2.

## 4. Signal that is persisted and never scored

| signal | persisted at | used for |
|---|---|---|
| `isAccessibleFromInternet` / `isOpenToAllInternet` | `ai_assets.internet`, `.open_internet` | graph node, combos matrix, a KPI — **zero AARS weight**, though [`custom_score.md:82-127`](custom_score.md) devotes a section to it |
| `FindingRow.severity` | `ai_findings.severity` | **nothing** — a CRITICAL failing control priced exactly like a LOW one |
| `node.status` (`Deprecated`, `Inactive`) | `ai_assets.status` | detail sheet only — the dormant-but-privileged agent (ASI10 *Rogue Agents*) was invisible |
| `issue.frameworks.fiveRs` | `ai_issues.frameworks_json` | rendered only — see 3.3 |
| issue **count** | `ai_issues` | only the `>1` boolean — see 3.1 |

## 5. Codebook accuracy, checked against primary sources

The codebook is annotation and reaches no arithmetic, so these were wrong captions rather
than wrong numbers — but two mattered.

| claim | verdict |
|---|---|
| OWASP LLM Top 10 2025 codes and titles | **correct** |
| "a 2026 edition renumbers eight of ten" | **correct** — the 2026 edition shipped 3 Aug 2026; exactly 8 of 10 change number |
| the 2025→2026 collision map | **was missing.** Five codes mean different things across vintages and two pairs effectively swap: 2025 `LLM03` Supply Chain → 2026 `LLM04`, while 2026 `LLM03` is Excessive Agency (2025 `LLM06`); 2025 `LLM05` Improper Output Handling → 2026 `LLM10`, while 2026 `LLM05` is Data and Model Poisoning. Only `LLM01`/`LLM02` keep their number. **A connector emitting 2026 codes into this 2025-authored cascade is priced against the wrong risk.** Now documented in the group's `standing`. |
| "ASI supersedes an earlier T1–T15 list" | **wrong on both counts.** *Agentic AI — Threats and Mitigations* is a parallel companion, updated to **v1.1** in the same December 2025 release and now running **T1–T17**. It is a different layer (granular attack pathways), not a superseded edition. Corrected. |
| ASI codes and titles | **correct**, two titles tightened to the published wording (`ASI04 …Vulnerabilities`, `ASI05 …(RCE)`) |
| OWASP ML draft v0.3, all ten titles | **correct**, including "still a draft, modified frequently" |
| Wiz 5Rs wording | **correct** — verbatim-equivalent to Wiz's published text |
| NIST AI RMF / EU AI Act absent | **correctly absent.** AI RMF subcategories are organisational outcomes ("policies are in place"), and the EU AI Act classifies *AI systems* by intended purpose, not cloud assets. Neither is a property an asset carries, so neither belongs as a gap code. |

Sources: [OWASP GenAI LLM Top 10 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) ·
[OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) ·
[Agentic AI — Threats and Mitigations v1.1](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/) ·
[OWASP ML Security Top 10](https://owasp.org/www-project-machine-learning-security-top-10/) ·
[Wiz — the 5Rs](https://www.wiz.io/blog/operationalize-data-security)

## 6. What was changed

Everything ships as **opt-in knobs defaulting to today's behaviour**, plus one preset.
`DEFAULT_AARS_RULE` is untouched, the normative 14-row applied table reproduces exactly, and
no tenant re-scores on upgrade.

| knob | default | what it fixes |
|---|---|---|
| `multiIssueScaling: "flat" \| "log2"` | `flat` | 3.1. `worst × (1 + (m−1)·log2(n))` — **identical to `flat` at n ≤ 2**, so adopting it re-prices only the assets whose count `flat` was discarding |
| `gapAggregation: "sum" \| "rss"` | `sum` | §2. Root-sum-square: identical for one gap, sublinear after, so pillar B leaves its ceiling. Also absorbs much of 3.4 without an equivalence map |
| `gapSources` | all off | 3.3. `5R_*` from the issue's own 5Rs mapping; `DEPRECATED_MODEL` and a new `INACTIVE_AGENT` from `status` |
| `exposurePoints` | all zero | §4. Pillar D, derived through the existing `conditionState` so the tri-state survives: `null` → `UNDETERMINED`, never `CONFIRMED`, never `NONE` |
| `findingSeverityWeights` | all 1 | §4. A CRITICAL failing control can outrank a LOW one. At weight 1 no override is written, so the persisted input stays byte-identical |

**Diagnostics** (`ruleDiscrimination`, `unreachableGapRules`) now report distinct scores, the
largest tie group, the range used, empty bands, and per-pillar cap saturation on the Rules
page. This is the part that matters most: the model can stop discriminating without anything
looking wrong, and now it says so.

**`AARS_V2_RULE`** is a calibrated preset — loadable from the Rules page, never a default —
turning the above on and rebalancing the caps to **A 45 / B 25 / C 12 / D 18 = exactly 100**.
Pillar C halves because it is at its ceiling for two-thirds of the estate and ranks almost
nothing; that budget buys pillar D, which discriminates. The 5Rs amplifier is folded into the
points (`dataAmplifier: 1`) so the pillar says what it means. Bands stay at 70/50/30/10 —
they carry the doc's remediation SLAs, and the page's rail moves them per tenant.

Measured over the seed estate, live path:

| | spec rule | **AARS v2** |
|---|---|---|
| distinct scores | 5 | **11** |
| largest tie group | 15 | 12 |
| pillar B at cap | **19 of 19** | **0** |
| bands occupied | CRITICAL 19 · HIGH 0 · MEDIUM 0 | HIGH 15 · MEDIUM 2 · LOW 1 (+INFO 8) |
| unreachable cascade rows | 3 | 1 |

## 7. Known limits

- **A 12-asset tie remains under v2**, and no scoring function can fix it: those agents have
  genuinely identical inputs — same gap shape, sensitive data, no confirmed exposure, one
  issue. Separating them needs signal the model does not have.
- **`projects[].businessImpact` is the signal that would break it.** It is queried
  (`wizQueriesAi.ts:50`), normalized (`syncNormalize.ts:106`) and typed
  (`graphTypes.ts:136`) — then dropped at `syncStore.ts:67`, which writes project *names*
  only. Reaching it needs a new `ai_assets` column. This is the highest-value follow-up.
- **Pillar C is still at its ceiling for 20 of 30 assets** under v2. It is a true fact about
  the estate rather than a modelling error, but it means the pillar ranks little; v2 responds
  by reducing its weight rather than by pretending otherwise.
- **12 of the 21 declared edge kinds exist only in `sampleData.ts`** — no live query produces
  `INVOKES_TOOL`, `USES_MODEL`, `HOSTED_ON` and the rest. Agent-to-agent trust (ASI07),
  MCP/tool supply chain (ASI04) and model provenance (LLM03) are a coverage ceiling that
  needs new Wiz queries, not new rules.
- **The seed estate has no CRITICAL or HIGH native issue severities**, so its top score under
  v2 is 69 and CRITICAL looks empty. That is the demo's shape, not the rule's: a
  CRITICAL-issue asset that is internet-exposed and holds sensitive data reaches 100.

## 8. What was deliberately not done

- **Changing `DEFAULT_AARS_RULE`.** Every improvement here moves scores; making any of it
  default would silently re-score every tenant and invalidate the normative applied table.
- **A gap theme / equivalence map** for 3.4. `rss` absorbs most of the double-count for far
  less machinery. Worth revisiting only if measured discrimination stays poor.
- **Replacing the numeric score with a decision tree.** Defensible on the merits, but it
  would discard the trend series, the bands, and the entire Rules page.
- **Refitting v2's bands to the seed distribution.** Thirty demo assets are not a population;
  the diagnostics plus the draggable rail let each tenant fit their own.

## 9. How to reproduce

The measurements in §2 and §6 come from scoring the seed estate through the two paths:

```js
import { AARS_V2_RULE, DEFAULT_AARS_RULE } from "../src/domain/aars";
import { ruleDiscrimination } from "../src/domain/aarsRule";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

// the demo path — pinned hints, 2-3 codes per asset
enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, SEED_AARS_HINTS, DEFAULT_AARS_RULE);
// the live path — deriveAarsInput, 5-6 codes per asset
enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, undefined, DEFAULT_AARS_RULE);
enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, undefined, AARS_V2_RULE);
// then: ruleDiscrimination(doc.nodes, rule)
```

The same numbers are asserted in `gas_ai/test/aars.test.ts`,
`gas_ai/test/aarsRule.test.ts` and `gas_ai/test/graphEnrich.test.ts`; `npm run check` in
`gas_ai/` runs them.


---

# Part II — the signal roadmap and the likelihood × impact model

*Follow-up pass. Part I fixed the arithmetic; the score was then out of **signal**, not out
of arithmetic — a 12-asset tie survived under v2 because those assets were genuinely
identical to the model.*

## 10. Evidence: real captured tenant responses

`gas_ai/exemples/` holds real request/response pairs — 396 KB of `cloudResourcesV2` covering
40 of 68 agents, plus issue and finding captures. Stronger evidence than vendor docs, and it
**killed** as many candidates as it confirmed.

### Confirmed and varying — built on

| signal | distribution across the 40 real agents |
|---|---|
| environment from `cloudAccount.name` | `dpcp-production-…`, `dpcp-preproduction-…`, `sap-nonprodpartner`, `inix-horsprod-…`, `ai-industry-pp-…` → **16 of 40 classify**: PROD 2 / PREPROD 6 / NONPROD 7 / DEV 1 |
| `graphEntity.properties.deploymentType` | PaaS 23 / Hosted 17 |
| `isAccessibleFromInternet` tri-state | known 23 / **UNDETERMINED 17 (43%)** |
| `status` | Active 36 / **Inactive 4** |
| `projects[].riskProfile.businessImpact` | **`LBI` ×9, `MBI` ×2** — real variance, and it was being dropped at `syncStore.assetToRow` |

`deploymentType` predicts exposure-knowability **exactly**: PaaS → known 23/23, Hosted →
undetermined 17/17. A hosted agent inherits reachability from the compute underneath it,
which is precisely what UNDETERMINED means.

### Confirmed but flat — NOT built on

`maxExposureLevel` is **0 for all 40**. `businessUnit` is **empty in all 11** issue rows.
`validatedAsExploitable` is **`false` in all 5**. `technology.status`/`businessModel` splits
17/23 but is **exactly co-linear with `deploymentType`**. Config findings are **all MEDIUM,
all FAIL, 2 distinct rule ids** — so Part I's `findingSeverityWeights` is correct but inert
here. **A term with no variance adds zero ranking information.**

### Not verifiable from the captures

The capture uses a richer, different query shape than the app's and selects none of
`lastSeen`, `hasHighPrivileges` or `hasAdminPrivileges`. So the privilege axis and the
dormancy test are **not confirmed against real payloads** — `lastSeen` came back null on all
40 while `updatedAt` is populated 40/40, which is the next thing to wire.

## 11. Bugs found while mapping the surface

- **`accessType` was hard-coded** to `"HIGH_PRIVILEGE"` (`syncNormalize.ts`) even though the
  query asks for `EQUALS ["HIGH_PRIVILEGE", "ADMIN"]` — every ADMIN grant silently downgraded.
- **`LATERAL_MOVEMENT_FINDING` handling was dead code**: the normalizer existed, the query
  never asked for that node type. `ai/queries/6_IAM.MD` §6.7 rates it the largest single
  weight of any unfetched signal.
- **`hasAdminPrivileges`** round-tripped fully and **changed no score anywhere**:
  `dataExposureOf` ORs it with `hasHighPrivileges` and only reaches that branch when the
  asset has no sensitive access.

## 12. The model: likelihood × impact

The pillars were **summed**, but sensitive data and privilege describe what happens *if* an
asset is compromised, while control gaps and reachability describe how *likely* that is. An
unreachable agent holding PII and a reachable agent holding nothing landed on the same
number while needing opposite work.

`scoringMode: "multiplicative"` separates them:

```
L = 1 − Π(1 − pᵢ)   over likelihood pillars, each as its share of its own ceiling
L = max(L, likelihoodFloor)
I = Σ impact pillars, normalised against the sum of THEIR ceilings
score = round(100 × L × I/100)
```

Noisy-OR because likelihood evidence is *alternative routes to one outcome*, so it must
saturate toward 1 rather than sum past it — the cap-saturation failure of Part I, avoided by
construction rather than by clamping. Impact is summed because impact terms are not
alternatives: data *and* admin *and* production is worse on three separate counts.

**The floor is what stops this being naive.** A pure product scores an unreachable asset at
zero, which no estate can support — and 43% of this tenant's agents are UNDETERMINED
precisely because nobody has checked. OWASP's AIVSS draft reaches the same conclusion from
the other side, flooring its mitigation factor at 0.67 because *"no mitigation, however
strong, can fully eliminate the residual risk contributed by agentic amplification
factors"* ([AIVSS v0.8](https://aivss.owasp.org/) §3.4.1).

**On AIVSS more broadly:** it is a pre-1.0 draft, it scores *vulnerabilities* not assets, and
it explicitly forbids the aggregation a register score needs — *"do not average scores across
findings"* (§3.2). Its equation is not adoptable here. Its ten agentic amplification factors
(autonomy, tool surface, memory, dynamic identity, multi-agent interaction, self-modification…)
*are* properties of the agent rather than of the finding, and remain the most interesting
future capability vector.

**A property operators must understand:** impact is normalised against the *sum* of impact
ceilings, so adding a term whose ceiling nothing reaches drags every other asset's impact
fraction down. Caps must be set to what is *achievable* in that tenant — which is a judgement,
and is what the Rules page is for.

## 13. What shipped

All opt-in; `DEFAULT_AARS_RULE` stays additive and still reproduces the applied table.

| | |
|---|---|
| `privilegePoints` | ADMIN over HIGH, as its own axis |
| `environmentRules` | operator-editable account-name cascade; every negative form sits above `prod`, or `sap-nonprodpartner` classifies as production |
| `combinationRules` | conjunctions — the thing a product named after toxic combinations could not previously express |
| `gapSources.dormantAgent` | the shadow/orphaned asset (`ai/ai_agents_discovery_queries.md` §11) |
| `businessImpactPoints` | Wiz's own rating, no longer discarded |
| `scoringMode` + `AARS_V3_RULE` | the likelihood × impact model |
| `reachPointsPer` / `reachCap` | graph-derived: distinct sensitive resources reachable through the identity chain |

Measured over the seed estate, **live derivation path**:

| | spec | v2 | **v3** |
|---|---|---|---|
| distinct scores | 5 | 11 | **11** |
| largest tie | 15 | 12 | **8** |
| bands occupied | CRITICAL only | HIGH only | HIGH 10 / MEDIUM 9 / LOW 2 / INFO 9 |

**The remaining 8-tie is exactly `AWSReservedSSO_FinanceAdmin_01..08`** — eight byte-identical
clones of one role. No scoring function separates identical inputs, so that is the floor and
the model now reaches it. What remains is a *grouping* problem: eight clones each inflate the
band census. Not every tie is a defect.

## 14. Still open

- **Dormancy is inert until a recency field lands.** `lastSeen` is null across the capture;
  `updatedAt` is populated 40/40 and is not yet normalized.
- **`HBI` never appears** in the sample. If the real estate is all LBI/MBI, `businessImpact`
  buys less separation than hoped.
- **The chain query is untested against a live tenant.** It is `optional: true`, so a schema
  mismatch degrades to a recorded skipped step — but its real yield is unknown.
- **Clone grouping** (§13) is the highest-value remaining work, and it is a product change
  rather than a scoring one.
- **Still unqueried:** agent-to-agent trust (ASI07), MCP/tool supply chain (ASI04), model
  provenance (LLM03). 12 of the 21 declared edge kinds still exist only in sample data.
