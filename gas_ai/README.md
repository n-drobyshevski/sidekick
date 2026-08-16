# Wiz SIDEKICK AI (Google Apps Script)

An AI-asset security dashboard, sibling to the OS-vulnerabilities tool in `gas/`.
It rebuilds Wiz's security-graph view for the AI estate: agents, models, guardrails,
MCP servers and their supporting identities, data and compute — as a **depth-limited
node graph** with **toxic combinations highlighted** — plus an inventory scored with
the **AI Asset Risk Score (AARS)**, a toxic-combinations drill-down, and a concise
"what we scan with Wiz" coverage page.

Same architecture as `gas/`: a Google Sheet as the durable store, Drive for gzipped
archives, an HtmlService SPA, and a resumable sync job. Same "Audit Ledger" design
system, with a deep-crimson brand (`#be123c`) instead of Signal Blue — the severity
palette is deliberately identical across both tools.

## Pages

| Page | What it shows |
|---|---|
| **Security Graph** | The node graph. Seed it from "all toxic combinations", one combination pattern, or a single asset; a **depth slider (1–3)** bounds the server-side traversal; a **100-node budget** (Settings, 30–400) is a hard ceiling on the payload, counting the "+N more" stubs it also draws, and a capped view offers **Load more** to widen that one view a step at a time (a `maxNodes` hash param, so a widened view is shareable and clears from its chip); per-kind caps collapse high-fanout neighbors into those pills, which expand on demand; a whole-estate view admits its seeds worst-first in waves so the budget buys paths rather than a field of disconnected dots; a count indicator flags capped views. Every risk signal is a **node on the attack path**, not a flag on a card: `ISSUE`, `INTERNET_EXPOSURE`, `EXCESSIVE_PRIVILEGE`, and `MISSING_GUARDRAIL` (a negated `PROTECTED_BY` edge, drawn dashed) hang off the asset they describe. **Data exposure is drawn as the path Wiz itself draws** — `AI_AGENT → RUNS_AS → SERVICE_ACCOUNT → ALLOWS_ACCESS_TO → BUCKET/DATABASE → HAS_DATA_FINDING → DATA_FINDING` — with the findings collapsed into one aggregate per datastore carrying a count badge and the worst severity, because a bucket with two hundred findings is one fact about that bucket and would otherwise spend the whole node budget. `SENSITIVE_DATA` survives as the **fallback**: where Wiz flags an asset but no path is traversable (the tenant rejected the step, or the grant is expressed some way the query does not walk), the old stub is drawn instead, so one asset never tells the same story twice. Its mark is the data-finding gem, left unfinished. Because they are evidence rather than inventory, the node-type / severity / cloud / project filters pass them through with their asset, and the grouped layout files them in their asset's block — unless you name a risk kind in the filter, which curates them directly. Toxic-combination members get a crimson halo + `TC` badge. Under the default **Smart order** the bands are **clustered**: each attack path (a connected component, split by nearest AI agent where one component holds several) claims a contiguous stripe of slots in every band and the next stripe starts a wider gutter away, so proximity alone groups a path — on the sample tenant that cuts the mean edge length by ~60%. Clusters that share a node (one database read by three agents) are laid side by side, and the run of them **wraps onto shelves** — repeats of the whole band set — chosen to leave the canvas the shape of the viewport, which roughly doubles the zoom "Fit" lands on. Picking an explicit order instead turns clustering off. Keyboard: arrows walk edges/lanes, Enter opens details; a "View as table" fallback carries the same data. |
| **AI Inventory** | Every synced asset with its AARS score and severity, issue severity, combo membership and guardrail status. The header reads in three levels rather than as a row of equal tiles: the **census** (AI assets, agents, agentic identities), the **AARS-severity distribution** as a segmented strip, and a stat strip (guardrail coverage as a meter, sensitive-data access, open issues, compliance gaps). The strip is also the page's cross-filter — its keys are toggle buttons, so clicking a band filters the register and the other bands recede, with a keyboard path a canvas could not offer. Only Critical and High carry a **change chip**, and only when `aarsTrend` actually supports one: two points, the same rule version across them, and the last point agreeing with the live counts (a rescore without a sync writes no point, so the delta would explain a different number). A **filter drawer** (`panel=filters`, live-apply) facets on AARS severity, issue severity, kind (grouped by category, searchable), cloud, region, project and risk signals; every option carries **how many assets it would still leave**, counted against the *other* dimensions so the number stays useful as you narrow, with a proportion bar beside it. Values inside a dimension OR together; dimensions AND — except **risk signals, which AND inside themselves**, because "agentic *and* missing a guardrail" is the triage question and "either" is not. Zero-yield options are `aria-disabled` (not `disabled`) so they stay focusable and their `0` stays readable, and a selected option is never disabled. **Reaches classified data** joins that group: it is true for an AI asset whose execution identity can read a datastore carrying DSPM findings, and for the datastore itself. It cannot be true for the *identity* — service accounts are unscored, so nothing persists their reach — which is why pairing it with "agentic identity" narrows to nothing rather than to the agentic identities that can read classified data. Applied filters show as dismissible chips with a count badge on the trigger. The register renders as a **sortable table** (every column but Guardrail/Projects, direction in the URL) with the score as an in-row meter and open issues as a severity-split micro-bar whose *length* is the volume, or as a **card grid** (`view=cards`). **Saved views** keep filter sets in `localStorage` — the URL already encodes the whole state, so sharing is a copied link. The trend (one point per sync, not backfillable, INFO omitted) sits under a History heading below the register. The table is **paged** (25–250 rows, page and size in the URL); a small estate ships in one payload and filters, sorts and counts facets in the browser, a large one does all three server-side — the header, the filter vocabulary and the facet counts describe the whole inventory either way. |
| **Toxic Combinations** | The 4 combination patterns with adjusted-vs-native severity, the 5Rs amplifier note, framework tags (OWASP LLM / Agentic / ML, 5Rs), affected assets, and the issue drill-down — plus **Other AI risk**, the residual bucket holding every issue in the AI risk category whose source rule is none of the four. That bucket is deliberately not a pattern: it shows the severity mix it actually holds instead of a shift badge, and says plainly that Wiz's rating is carried through unchanged, because there is no amplifier claim to justify. It exists so the register's total reconciles against the Wiz console rather than silently counting only the modelled rules. **Unresolved** means OPEN *or* IN_PROGRESS everywhere on this page — the query has always asked for both, and the rollups used to discard the second. |
| **Cloud Configuration** | The failing-control register, from `configurationFindings` under the AI risk category. Two levels, and the order is the argument: a finding is one evaluation of one rule against one resource, so a single misconfiguration pattern arrives as N near-identical rows — in the sample estate one Bedrock confused-deputy rule against sixteen IAM roles, same name, same severity, same fix. **By control** groups them, because that is both the question ("what is wrong") and the unit of work (one trust-policy pattern closes all sixteen); **by finding** is the drill-down, reached by opening a control so there is one table to learn rather than two. The header counts *failing* controls rather than stored rows — resolved findings are kept for their dates and counted by nothing — and the severity strip doubles as the page's severity filter. The register's other job is to say out loud what the inventory's stat tile can only imply: **most of these findings are not on an AI asset**. They are evaluated against a region (a Vertex metadata store), an IAM policy (a Bedrock guardrail condition) or a service account no agent runs as — resource types `NODE_KINDS` does not carry — so they are real compliance gaps that price no AARS score. That is a KPI, a column, a filter and a chip on the finding sheet, not a footnote. The detail sheet is where the widened selection set pays for itself: the rule's own description, the resource-specific remediation *and* the rule's template (labelled separately, because the template still carries its `{{placeholders}}`), the Rego the evaluation actually ran, the projects with their business impact, any ignore rule covering it, and any `sourceMappedIacFindings` — the finding's link back to the code that produced it. |
| **Compliance Posture** | The framework scoreboard, from `securityFramework.complianceAnalytics` — one query per selected framework. **Two views on one route.** It opens on an **Overview** that reads every collected framework at once; `All frameworks / By framework` switches to the per-framework register described below, through a `?view=` param on the Cloud Configuration `?mode=` recipe, and a link carrying `?framework=` still lands on that framework's register so nothing bookmarked breaks. The Overview's argument is that four collected frameworks are four lenses on ONE estate, so the same failing control is raised repeatedly under different names and nothing used to say so — an analyst fixing a Bedrock trust policy for OWASP Agentic never learned it also closed gaps under OWASP LLM and the 5Rs. Five bands, and every one of them is computed **server-side** and shipped in the same payload, because the client bundle cannot import the domain layer at all; the hand-kept mirror the inventory and configuration registers use exists to reconcile a client filtering a *page* against a server filtering the *whole* set, and this payload is already shipped whole, so a mirror here would be duplicated risk buying nothing. The header states the estate mean **as derived**: `complianceKpis` averages the *scored* frameworks only and returns null rather than 0 when none scored, and the sub-line names that denominator, because a mean over three of four frameworks is a different claim from a mean over four. The **framework rail** puts every framework on ONE shared 0–100 axis, worst-first, with the mean drawn once as a reference marker through every row rather than as a fifth bar — small multiples on a shared scale, the pattern the AARS pillars already use, because judging needle angles against each other is exactly what a gauge asks of a reader. **An unscored framework draws no bar at all**: the lane is hatched and carries the state glyph with the reason in words, so absence reads as the *opposite* of a full lane rather than as a lane at zero — a sliver reads as "very little" where the fact is "not measured". **Weakest areas** flattens every subcategory across every framework, weakest first — a ranked ledger rather than the framework × category heat map the Wiz console draws, because a heat map has nowhere to put the fourth state and asks colour to carry meaning alone; unscored rows are *listed* after every scored one and never ranked among them, which is enforced by partitioning into two arrays rather than by a comparator convention a later `||` clause could erode. **Shared controls** is the band the whole view exists for: failing policies grouped by `policyId` across the estate and ranked by how many frameworks one fix would satisfy, each row carrying a filled/hollow dot per framework in the rail's own order with the count in words beside it, since dots must never carry the meaning alone. That is a **third dedupe scope** — `buildFrameworkTree` dedupes within a subcategory, its own `distinct` map within a framework, this one across the whole estate — and `failCount` is the **max** across a policy's mapping rows and never the sum, because one policy is evaluated once against the estate and its counts are merely repeated per mapping, so summing would report one fix as three; a test pins the band's row count against `complianceKpis().failingPolicies` so the header and the band beneath it cannot drift. There was a fifth band, **Coverage**, and what killed it is the reason to read this sentence: it *named* the frameworks in the tenant's catalogue that the sync does not collect. Against the seeded estate that was one row. Against a real tenant it was **thirty-seven**, printed inline in a warning banner and again as a list — the catalogue transcribed, not a finding — and the fact it existed to state was already in the headline strip as `Frameworks 4 of 41`, the same claim in five characters. The band is gone; `coverageSummary` now returns counts and not names, because a payload carrying thirty-seven objects nothing renders is not neutral on a page shipped whole. Its one irreplaceable part, the 5Rs scope, moved to a **footnote under the rail**, beside the line explaining the mean marker: how many rules are in scope, the whole-framework caveat, and the link into Settings. It sits there rather than in the 5Rs rail row because a row is a `<button>` — a link inside it would be two tab stops for one control, the nesting the register's disclosure cells already refuse. **The 5Rs is scoped, because it is a *data* security framework collected by a product about the AI estate** — Reduce, Restrict, Relabel, Relocate, Reconfigure, most of whose rules are general cloud data governance (retention, residency, sensitivity labelling) that no AI-asset analyst acts on. Rather than shipping a list of what to exclude, the app derives it, and the derivation is a union of two **hard** facts, never an inference: the same `policyId` also sits under a collected OWASP framework (Wiz itself files that control under an AI framework — the same crosswalk the shared-controls band computes), or at least one of its open gap findings lands on a synced AI asset. Anything matching neither is out of scope by default with the reason stated. **The obvious test on its own is wrong**, and `api.ts` says why: *most* AI-security rules fail on things the AI graph does not model — a `REGION` for a Vertex metadata store, a `RAW_ACCESS_POLICY` for a Bedrock IAM policy — so "has findings on an AI asset" alone scopes out `SUB-082` (Vertex CMEK), which is unambiguously an AI rule. Guessing from the rule's name or its `subjectEntityType` is rejected in the module header, because it is exactly the inference the OWASP LLM edition handling exists to avoid. The signal is not clairvoyant and says so: a rule no OWASP framework maps and whose findings miss the AI estate **will** be scoped out, which is why Settings lists every rule with its reason and one toggle to overrule it, grouped by subcategory with bulk toggles. **Only the pins are stored, never the resolved selection** — the default derives from an estate that moves, and freezing it would stop it tracking; what an operator decided is a decision, what the app worked out is not. Two things scoping must not do, both pinned by tests: it must not move a **percentage** (this framework reports 85 while its Restrict category reports 194,309 passing checks against 71 failing — Wiz's number is derivable from nothing this app holds, so the registers beneath it change and the number never does, and the rail row and register hero both say so while a scope is active), and it must not drop a rule from a framework that legitimately claims it (`SUB-082` is mapped by the 5Rs *and* OWASP Agentic; filtering by policy id alone would delete it from Agentic and the shared-controls band would lose the crosswalk it exists to show). One filter serves both `getCompliance` and `getAssets`, because filtering one and not the other would have the Compliance page and the Wiz Scans area printing different failing-control totals for one estate. **AARS is deliberately untouched**: the third reader of policy rows is `syncJobs`' `withFrameworkCodes`, gated on `gapSources.frameworkMapping`, `false` by default beside `gapSources.fiveRs`, so no 5Rs code prices a gap today and scoping the sync path would silently re-score anyone who had turned that on. The register is the companion to Cloud Configuration rather than a replacement: that page lists failing *evaluations*, this one scores published *frameworks* (OWASP Agentic 2026, OWASP ML, the Wiz 5Rs) by category, subcategory and the policies behind them. **Wiz's percentages are stored verbatim and never recomputed** — their definition of posture is undocumented, the sample tenant's category mean already disagrees with its framework number, and a second locally-derived figure beside theirs would be two answers to one question. The invariant that shapes every cell: **a posture that does not exist is never drawn as a zero**. Wiz returns a null percentage with an `emptyPostureReason`, and `NO_RESOURCES` ("nothing here to assess") and `NO_POLICIES` ("no check is written for this") are both the *opposite* of 0% ("everything assessed failed"), so each is its own state with its own glyph, left out of the average rather than counted into it. The header states the score as a headline number over the AARS 0–100 meter — **no arc gauge and no donut**, which `DESIGN.md` and `PRODUCT.md` both name as anti-references and which `charts.js` could not draw anyway (no `ArcElement` is registered) — beside a four-state subcategory strip that doubles as the register's filter. The console's *Top Policies* card is dropped: a leaderboard without a question, already answered by the register. A category whose only subcategory restates it is drawn as ONE row (OWASP's Top 10 lists arrive from Wiz that way), so the disclosure control appears only where a framework genuinely has two levels, like the 5Rs. Opening a subcategory row — or a mirrored category's own row — expands an inline detail row beneath it, read on the page rather than in the drill-down sheet this replaced, listing every policy with its kind: a **Control** is a graph query, a **cloud rule** a Rego evaluation, a **host rule** runs on the machine — because presenting them as one sort of thing would misdescribe what failed. Which frameworks are collected is chosen in Settings; the catalogue comes from `securityFrameworks`, and the framework id is **not** an editable step variable, because it selects *which* framework is fetched rather than filtering within one. **Each framework spells its codes differently**, and the AARS join reads each one on its own terms: OWASP Agentic's external id IS the code (`ASI01`); OWASP ML derives `ML_` + the subcategory *title*, because the codebook says the ordinal is not in the data; the Wiz 5Rs derive `5R_` + the *category name*; and OWASP LLM numbers its categories `1`, `2` and hides the code in the *name* — `1 LLM01:2025 Prompt Injection`. That `:2025` is load-bearing: the codebook is written against the 2025 edition and the 2026 edition renumbers eight of the ten, two pairs effectively swapping, so a category stamped with any other edition **mints no code at all** rather than pricing 2026's `LLM03` (Excessive Agency) against 2025's (Supply Chain). A framework with no recognised vocabulary likewise mints nothing — the finding's own shortId still raises its gap, so nothing is under-counted. |
| **AARS Rules** | The scoring model itself, drawn and editable. A **full-bleed workbench** (the graph page's frame): the model on the left, its consequence pinned on the right, Save in a bar that never scrolls. The hero is one **shared 0–100 axis** drawn twice — a stacked bar showing how the pillar caps compose the score (and running visibly past the scale, which is what the clamp does), over a **band rail** whose four thresholds are draggable stops that cannot cross, each a real `<input type="range">` so keyboard and screen-reader support are native. Below it, one section per pillar, and **pillars A and C are drawn on that same axis**: one lane per value, where the lane is the control (the band rail's `range` recipe again), the multi-issue multiplier and the 5Rs amplifier are the hatched extension they cause, and the cap is the line it is, with anything past it hatched out and the readout saying `50 → 60 · scores 50` in words. Pillar C's ceiling is *derived* (top tier through the amplifier), so its line carries no thumb. Pillar B keeps number fields, because its quantity is **order**, not magnitude: an **ordered gap-pricing cascade**, first match wins, ending in the fallback rendered as the table's last row — which is what it is. Every code carries its meaning inline (`exact · Data and Model Poisoning · OWASP LLM Top 10 2025`), resolved from a **codebook** (`src/client/js/codebook.js`) covering OWASP LLM 2025, OWASP Agentic 2026, OWASP ML draft, the Wiz 5Rs and the two locally synthesised codes — each family stamped with its edition and its standing, because three of the four are moving and one is a vendor taxonomy. The Code cell is an **editable combobox**: type-ahead over the codebook, searchable by *meaning* (`agency` finds LLM06), while tenant-specific finding shortIds like `SUB-082` stay one keystroke to type and one character to correct. A **Code reference** sheet browses the whole vocabulary with what this draft prices each entry at, how many live assets carry it, and an *Add a rule* button that inserts the row **above** the family prefix that would otherwise shadow it. A **Prices** column reports how many live gap instances each rule actually priced, so "order is meaning" stops being a claim — and a `0` there reads as either *never fires* (shadowed) or *in force, nothing in this tenant carries it*, never as one undifferentiated zero. Titles are annotation only: the score still matches on the opaque code, so a wrong caption can never produce a wrong number. Defaults are `ai/custom_score.md` exactly. The right pane previews every edit against the live inventory — proposed-vs-current level counts and the assets that move — and a sandbox scores a hypothetical asset through the server, so the model has one implementation, not two; its gaps are chips showing what the draft prices each one at, quick-added from the codes the estate actually carries. Export/import the rule as JSON. A **separation read-out** sits under the level counts, because a rule can stop working without anything looking wrong: a pillar pinned at its cap for every asset still renders a confident number and still fills a band, and the failure shows only as an absence. It states distinct scores, the largest tie group, the range actually used and which levels nothing reaches, and warns by name when a pillar is at its cap for a majority — above a cap two very different assets score the same, so every rule tuned inside that pillar is being clamped away. The Prices column's `0` accordingly reads three ways, not two: *never fires — shadowed*, *never fires — nothing raises this code* (a row naming a gap no derivation emits, which under the spec rule is three of the nine default rows), and *in force, nothing in this tenant carries it*. **Load AARS v2** replaces the draft with a calibrated preset — count-aware pillar A, root-sum-square pillar B, the dormant gap sources on, internet exposure scored, caps rebalanced to exactly 100 — which moves scores, so it goes through the same preview as any other edit and saves only when you say so. See `ai/AARS_ASSESSMENT.md`. |
| **Wiz Scans** | The coverage record for the ten scan areas — AI-SPM, toxic-combination engine, CIEM, DSPM, guardrail coverage, network exposure, identity, supply chain, cloud configuration findings, compliance framework posture. The last two are **companions, not duplicates**, and were named as if they were: configuration findings come from `configurationFindings` and land on Cloud Configuration, framework posture comes from `securityFramework.complianceAnalytics` and lands on Compliance Posture — one counts failing *evaluations* and prices AARS pillar B, the other scores published *frameworks*. Each area's drill-down finds its own queries by matching a step's `area` tag against the area id, which makes that tag a **join key rather than a label**: the two posture steps spent a release tagged to the findings area, so the posture area rendered "No sync step issues a query for this area" beside its own live 94% while the findings area displayed two `securityFramework` documents it does not send. Nothing could see it — both ends were individually correct and only the join was wrong — so `scanAreaSteps.test.ts` now holds both lists at once and requires every area to own a step, declare `carriedBy`, or declare itself unscanned. Every figure on the page is resolved from the last sync; the page holds no numbers of its own, which is a change from the hand-typed stat strings it used to carry (two of which named things this app has never collected). Each area lands in one of **three coverage states**, each with a glyph as well as a colour: `live` ● a figure from the last sync, `partial` ◐ queried and stored but not totalled, `unscanned` ○ no query runs here. State is **derived, not declared**, wherever a resolver can decide it — an older server bundle missing a KPI makes the area step back to `partial` on its own rather than assert a figure it cannot compute; only "we never ask Wiz this" (supply chain, the sole declared state left) is declared, because no payload can tell you that. The configuration-findings area held a declared `partial` for longer than it was true: it carried the badge while its own prose claimed framework *scoring* as its subject and it could count nothing but findings, and scoring became an area of its own without the badge moving with it. Deriving that area's state instead exposed a guard the declaration had been masking — the resolver tested the payload but not the *field*, so a bundle without the KPI would have read `n(undefined)` as a confident "0 failing findings" rather than declining to answer. A **posture header** states coverage as one number over a three-state strip and the sync that produced it. Below it a **provenance diagram** draws the path — ten areas into one sync spine, out to the five screens the results land on — with the unscanned area drawn as a hollow dot behind a dashed border and a dashed edge, the negated-edge convention the Security Graph already uses. Each area is **one row**, not a card: dot, title, and its headline figure right-aligned, so the numbers line up down the column and a node costs 22px of height rather than the 46 a two-line card cost. The geometry is generated from the area list against the **measured container width** — a `ResizeObserver` redraws the viewBox at the container's own pixel width, so the picture is full-width and renders 1:1 at any size, its labels never scaling and its height depending only on how many scan areas there are. (A fixed viewBox with `width: 100%` scales the whole schematic up on a wide pane instead, which buys no extra information and costs a screen of height.) A tenth area needs no coordinate edit. It is `role="img"` with a computed summary label and holds **no tab stops**: the **register** underneath is its keyboard path and its table fallback, one row per area carrying the Wiz query, what it reported, where it lands and its state, opening a detail sheet with the prose and the query. Hovering or focusing a register row lights that area's node and edges. AARS Rules is deliberately absent from the destinations — nothing lands on it; it prices what the sync collected, which is the spine's `score` step. Opening a row gives the **provenance chain** for its figure — query → sync step → ledger column → KPI field → screen — and then **every query behind the area, verbatim**: the GraphQL document and the variables it sends, both copyable, read from the server rather than transcribed, so the panel's account of what the tenant is asked cannot drift from what it is actually asked. A step also shows whether the last sync **skipped** it, which is recorded at commit time because it is otherwise unreachable — optional steps swallow an HTTP 400 by design, so a rejected query would otherwise look exactly like a tenant with nothing to report. **Variables are editable** on the four steps whose normalizer tolerates a changed filter (`INVENTORY_AI`, `ISSUES_TOXIC`, `CONFIG_FINDINGS`, `AGENTIC_IDENTITIES`), through guided controls with the raw JSON underneath, plus a **test run** that sends one page and reports both the rows returned and what the normalizer kept — different questions, since a filter can return a hundred rows the normalizer discards. The **document itself is never editable**: every normalizer couples to the selection set, and five steps assert things the response cannot confirm (`negate: true` *is* the guardrail flag; the edge type comes from the function name; every issue attribute on the per-rule steps comes from a closed-over group), so an edited document there would produce confident wrong data rather than an error. A variable cannot change a selection set, which is the whole reason editing stops there; the locked steps say so in the panel rather than silently omitting the control. `AGENTIC_IDENTITIES` additionally withholds its `identityPurpose` filter, because the sync labels whatever that query returns as agentic, and `SENSITIVE_DATA_ACCESS` is locked outright because its normalizer rebuilds the chain's edges from which entity *types* a row carries. The DSPM area is the one that changed most: it used to declare itself carried by `INVENTORY_AI`'s two booleans — honest, but it could say how many assets reach classified data and never *which* data — and now has its own step and its own figure. A zero there degrades it to `partial` rather than reading as `live`, because a tenant that rejected the optional step and an estate with nothing classified send the same payload. **Network exposure** made the same move for a sharper reason: its two booleans are `null` on every *hosted* asset, because Wiz reports reachability on the compute underneath and not on the agent. It borrowed `INVENTORY_AI`, reported an undetermined count that had no path down, and could never settle it. It now has two steps of its own (`HOST_EXPOSURE`, `ENDPOINT_EXPOSURE`) and reports three numbers — reachable, validated endpoints, still undetermined — because reachable and exposed are different findings and the capture proves they disagree. **Human identity access** was the last declared `partial`, and its note ("access paths are synced and drawn, but nothing totals them; MFA and inactivity signals are not collected at all") was half a missing KPI and half wrong. The paths were always persisted — only the total was missing, and it has to be counted off the *edges* rather than off the drawn stubs, because `withIdentityAccessNodes` suppresses a stub wherever a real CIEM finding already exists. Inactivity was never uncollectable either: Wiz returns `inactiveInLast90Days` in the graph entity's properties bag, which on the `cloudResourcesV2` root sits one level below the flat fields the query asked for, so one `graphEntity { properties }` selection buys dormancy, `enabled`, `userDirectory` and the *real* `identityPurpose` at once. Only MFA survives in the note, because Wiz reports that for IdP-sourced human identities and this estate's AI paths carry service accounts and roles. |
| **Data / Settings** | Sync history, storage stats, reset; default depth, node budget, credential status. |

## How data flows

1. **Sync** (button or daily 05:00 UTC trigger) walks a battery of Wiz GraphQL queries:
   AI inventory (`cloudResourcesV2`), the AI risk register (`issuesV2` scoped by framework
   category `wct-id-1998` and by nothing else — **no issue-type filter**, so a kind this
   register has never modelled is still collected and lands in Other AI risk),
   assets-per-toxic-rule (`relatedIssue` filter),
   compliance findings (`configurationFindings`, same framework category, **OPEN and
   RESOLVED**), the framework catalogue (`securityFrameworks`) and per-framework posture
   (`securityFramework.complianceAnalytics`, one call per SELECTED framework — the
   catalogue populates a picker, it does not widen the battery, because a tenant carrying
   a hundred builtin frameworks would otherwise spend a hundred calls on frameworks this
   app has no vocabulary for),
   guardrail gaps (`graphSearch` with `PROTECTED_BY` + `negate:true`), execution
   identity (`RUNS_AS`), CIEM findings (`HAS_FINDING`), human/role access
   (`ALLOWS_ACCESS_TO` reversed into `ACCESS_ROLE[accessType Admin|High]` — rooted at
   the resolved AI types rather than at `AI_AGENT` alone, and reading the role's own
   access level instead of stamping the filter's, so ADMIN stops being reported as
   HIGH_PRIVILEGE), **effective permissions** (`entityEffectiveAccessEntries`: not who
   holds a role but what it confers, with the granting policy — kept in its own field
   because its `DATA` access type is a different axis from the binding traversal's
   `ADMIN`/`HIGH_PRIVILEGE`, not a wider setting of the same one), **identity hygiene**
   (`configurationFindings` on the MFA and dormancy rules, because Wiz models those as
   RULES rather than as properties on an account — the rules are matched by name against
   a synced `cloudConfigurationRules` catalogue rather than hardcoded, since there are
   several MFA rules and they are cloud-specific), and the **data-exposure chain** (`RUNS_AS` →
   `ALLOWS_ACCESS_TO` into a `hasSensitiveData` bucket/database → `HAS_DATA_FINDING`,
   the last leg optional so a classified store with nothing found in it still draws).
   That last step selects `severity` behind a `... on DataFinding` fragment, which is
   deliberately kept OUT of the entity-field set the other four graphSearch documents
   share: a tenant whose schema does not carry that type would otherwise reject all of
   them at once. Then **network exposure, as two steps because it is two claims**:
   `HOST_EXPOSURE` walks each AI asset to the `VIRTUAL_MACHINE` / `SERVERLESS` that
   `RUNS` it and keeps the internet-reachable ones with their public-exposure paths
   (ports, source ranges, application endpoints); `ENDPOINT_EXPOSURE` keeps the
   `ENDPOINT`s an asset `SERVES` that Wiz's dynamic scanner found `Open` **and** the
   tenant's policy rates High or Medium. Reachable is not exposed — the capture's own
   Cloud Run revision is open to `0.0.0.0/0` on 80 and 443 while both endpoints it
   serves rate `Low` because they redirect to SSO — so the two never collapse into one
   figure, and the bar is applied to the level Wiz *returned* rather than assumed from
   which query returned the row. These two share one document (`Q_AI_EXPOSURE`, the
   console's operation verbatim: both named fragments, every `@include` gate), which for
   the same reason as the fragment above is kept OUT of the shared entity-field set — it
   is the widest selection set the app sends, and a rejection must cost two optional
   steps rather than all seven traversals. Each execution runs under a wall-clock budget and
   resumes via a one-shot trigger if it runs long (at the documented tenant scale the
   whole battery is ~10–20 API calls and finishes in one hop). Steps whose selection set is
   narrow page at 500 rather than 100 — see the page-size note under *Constraints worth
   knowing* — which mostly matters on the runs that refresh the rule catalogue.
2. **Normalize + enrich** (once per sync, persisted): responses become typed
   nodes/edges/issues; each asset gets its worst adjusted severity, combo membership,
   and an AARS score (4 pillars: toxic-combination participation 0–50, compliance
   gaps 0–30, data exposure ×1.1 → 0–22, and internet exposure, which the spec rule
   prices at 0; the score's own severity at 70/50/30/10, CRITICAL down to INFO — see
   `ai/custom_score.md`, whose applied table pins the unit tests). Those numbers are
   `DEFAULT_AARS_RULE`; the rule actually in force comes from the `settings` tab, and the
   asset's scoring **inputs** are persisted beside its score (`aars_input_json`) so a
   later rule change re-prices exactly these gaps.
   The default reproduces the doc and nothing more — it stops separating assets on live
   data, for reasons measured in `ai/AARS_ASSESSMENT.md`. Five knobs address that, every
   one defaulting to the doc's behaviour so no tenant re-scores on upgrade:
   `multiIssueScaling` (read the issue count past "more than one"), `gapAggregation`
   (root-sum-square, so pillar B leaves its cap), `gapSources` (raise the gaps that make
   three default cascade rows fire at all), `exposurePoints` (score reachability), and
   `findingSeverityWeights` (let a failing control's severity matter), and
   `dataFindingPoints` (price the classified findings an asset can actually reach, so
   pillar C stops being the two-valued boolean that sat at its ceiling for 20 of 30
   assets), and `frameworkMapping` — which labels a failing control with the framework
   codes **Wiz itself** maps its rule to, from the synced posture, instead of the ones a
   regex found in a tag value. That one adds NO gap: every finding keeps its id, its
   severity and its place in the count, and only `frameworkCodes` grows, so pillar B
   prices the same gaps against different cascade rows. It is the fix for the defect
   `graphEnrich` records in a comment — the default cascade's `5R` and `ML_` rows have
   never been able to fire, because nothing ever raised those codes. `AARS_V2_RULE` is a calibrated preset combining them, loadable from the
   Rules page; under it pillar C takes four values on the sample estate rather than two.
3. **Persist**: wholesale rewrite of the `ai_assets` / `ai_edges` / `ai_issues` /
   `ai_data_findings` tabs, plus the three compliance tabs — `ai_frameworks` (the
   catalogue), `ai_framework_posture` (the tree flattened with a `level` discriminator, so
   one read path serves all three levels) and `ai_framework_policies` (one row per
   **(framework, subcategory, policy)** triple). That last one repeats a policy's metadata
   deliberately: the same control maps to several subcategories — one prompt-injection
   control lands under ASI01, ASI02 *and* ASI10 — so the mapping IS the row, and a table
   keyed by policy id alone would delete exactly the join this step exists to harvest.
   Nothing sums those rows; distinctness is computed at read time as a set of policy ids.
   The three are written only when the battery actually returned posture, unlike the tabs
   above: their steps are optional AND per-framework, so a tenant that rejects them would
   otherwise have last sync's posture blanked by a battery that never asked. Then a
   gzipped graph snapshot to Drive (the fast read path), then
   the `sync_history` row LAST — the commit record. No history row = the sync never
   happened. DSPM findings get their own tab rather than joining `ai_findings`: that one
   holds compliance *controls*, prices AARS pillar B and counts as `complianceGaps`, and a
   classification finding folded in would inflate both. `ai_findings` carries the whole
   configuration-finding record (rule, resource, subscription, projects, lifecycle dates,
   ignore rules, IaC mappings) rather than the six fields AARS prices — the columns were
   **appended**, so an existing ledger picks them up on the next sync with no migration.
4. **Risk topology** is derived on READ, never persisted: the `with*Nodes` helpers in
   `src/domain/graphEnrich.ts` turn the internet-exposure, excessive-rights and
   guardrail-gap flags into nodes joined to the asset they describe, aggregate each
   datastore's data findings into one node, and draw the sensitive-data stub only for
   assets with no traversable path to a classified store. Read-time means already-synced
   graphs gain them without a re-sync, and they never leak into the `ai_assets` tab the
   inventory reads.
5. **getGraph** resolves seeds/depth/filters server-side, projects a bounded subgraph
   (BFS + per-kind caps + node/edge budgets), lays it out deterministically
   (layered left-to-right: issues → AI assets → identities → data → data findings →
   compute — the bands ARE the data-exposure path, which is why findings sit one band
   right of the store they describe rather than back in the evidence band), and
   caches the payload in CacheService keyed by params + data version — wiggling the
   depth slider never re-reads Sheets.

**Dry-run:** with no credentials configured, "Sync now" persists a bundled sample
dataset transcribed from the anonymized posture docs in `ai/` (14 named agents,
8 IAM roles, 32 issues — 29 in the 4 combination groups plus 3 in Other AI risk,
one of them already in progress — with the applied-table AARS scores).
The whole app is usable without any Wiz access.

## One-time setup

```bash
cd gas_ai
npm install
npm run check          # typecheck + vitest + build (incl. middlebox guard)
npx clasp login        # once per machine
npx clasp create --type webapp --title "Wiz SIDEKICK AI" --rootDir dist
#   → writes .clasp.json, which is gitignored: the scriptId names ONE Apps Script
#     project, so it belongs to whoever is deploying. Already have a project? Write
#     the file yourself instead — {"scriptId": "<Project Settings → IDs>",
#     "rootDir": "dist"} — `push` fails with "request contains an invalid argument"
#     until the scriptId is real.
npm run push
```

Then in the Apps Script editor:

1. Run `setup()` once — creates the "Wiz SIDEKICK AI Ledger" spreadsheet (all tabs),
   the `wiz-sidekick-ai` Drive folder skeleton, and the daily `trigger_dailySync`
   trigger, recording ids in Script Properties.
2. For live syncs, set Script Properties (Project Settings → Script Properties):
   `WIZ_API_URL` (e.g. `https://api.<region>.app.wiz.io/graphql`) and either
   `WIZ_API_TOKEN` or `WIZ_CLIENT_ID` + `WIZ_CLIENT_SECRET` (client-credentials;
   `WIZ_AUTH_URL` defaults to `https://auth.app.wiz.io/oauth/token`).
3. Run `wizDiagnostic()` — a secret-safe step-by-step check of the auth + query path.
   `aarsDiagnostic()` answers the other common question — where the AARS scores are —
   by reporting which columns the assets tab has and how many rows carry a score and
   a severity.
4. Deploy as a web app. Verify dry-run first (no credentials), then set credentials
   and press "Sync now"; confirm the tabs populate and the graph renders.

## Development

```bash
npm run dev        # local harness at http://localhost:8787 (dry-run, in-memory GAS fakes)
npm test           # vitest (AARS applied-table parity, combos, projection, layout, normalizers)
npm run check      # the full gate; run before every push
```

Useful harness flags: `?noseed` (empty state), `?slow=400` (loading states).

### Which build is deployed?

An Apps Script deployment can be stale three ways at once — the project holds an old
file, the web app is pinned to an old VERSION so `clasp push` changes nothing at
`/exec`, or a copy-paste deploy updated some files and not others. Settings → Build
answers it: the client and server bundles are stamped separately (they ship as separate
files) and the page calls out a mismatch.

The stamp is a content hash of `src/`, not a commit SHA. Turn it back into commits with:

```bash
npm run which-build              # the id baked into dist/
npm run which-build <id>         # an id read off a deployment
```

It replays the hash across history and reports where `src/` reached that state, the
window during which that build is live, and the `git merge-base --is-ancestor` check for
"is my change in it?".

> Why not just stamp the commit? `dist/` is committed here, so a SHA baked into the
> bundle can only ever name its own *parent* — the build happens before the commit that
> contains it exists. Rebuilding to fix that makes a new commit, which makes it stale
> again, so every `npm run check` after any commit left `dist/` dirty by one line
> forever. A hash of `src/` has no such loop, because `src/` does not contain `dist/`.
> See `buildStamp.mjs`.

### Constraints worth knowing

- **Page size is a property of the STEP, not of the battery.** `PAGE_SIZE` (100) is the
  default; `PAGE_SIZE_WIDE` (500, Wiz's documented cursor maximum) is opted into per step via
  `SyncStepDef.pageSize`, and the Wiz Scans panel reports the effective `first` for each. The
  default is deliberately not raised: `api.expandAsset` reads a page without passing `first`,
  and it is the one call a user waits on; and the two widest documents (`Q_CONFIG_FINDINGS`,
  whose `opaPolicy` Rego is unbounded, and `Q_AI_EXPOSURE`, three ten-wide nested
  sub-connections per entity) are the likeliest to time out at 500. `CONFIG_RULES` is the
  step this exists for — ~3,858 rules is 39 calls at 100 and 8 at 500.
- **A page cap is recorded, not silent.** `MAX_PAGES` used to stop a step with a bare
  `break`, so a step that ran out of pages was indistinguishable from an estate that has
  less. Hitting it now lands in `last_truncated_steps`, kept **separate** from
  `last_skipped_steps`: a skip means the tenant refused the query, a truncation means we
  stopped asking while it was still answering.
- **Retrying smaller only helps some failures.** `fetchPage` re-asks at
  `PAGE_SIZE_FALLBACK` for a gateway 5xx or a transport/parse error, and rethrows a 429, an
  HTTP-200 GraphQL error envelope and a connection-shape mismatch untouched — none of which
  a smaller page can change. It used to retry all of them, on top of the four attempts
  `gqlPost` had already spent, which is how one throttled page cost eight POSTs and every
  200-shaped enum rejection during type probing cost two. It also never retries *up*.
- **Two cache versions, and the difference is whose freshness it is.** `DATA_VERSION` is
  bumped by `settingsStore.saveSettings` as well as by a sync, which is right for every
  derived read-model and wrong for a cached Wiz response — saving an AARS rule does not make
  a graph answer from Wiz stale. `WIZ_DATA_VERSION` is bumped from `syncStore.commit()` only
  (so a sync, a rescore and `resetData` all reach it) and keys `expandAsset`, the one
  endpoint that spends a live call on a click. Its key also carries `projectId`, which is a
  live input to the query.
- **No template literals / no `//` inside client strings.** The build lowers template
  literals and a "middlebox guard" fails if a bare `//` survives comment-stripping —
  a corporate SSL-inspection proxy corrupts them in transit. Split URLs like
  `["https:", "", "host", "path"].join("/")` (see `icons.js`).
- **Zero graph dependencies.** The security graph is hand-rolled SVG over a
  deterministic layout computed in `src/domain/graphLayout.ts` — no Cytoscape/D3;
  the bundle ships inline in every page load, and DOM nodes give native keyboard
  focus. Layout and projection are pure and unit-tested.
- **No endpoint ships an unbounded list.** `getAssets` answers with the whole
  inventory only under `CLIENT_ALL_MAX` (`src/domain/assetTable.ts`) and pages past
  it; its rows carry the dozen fields the table renders, not the ~25 the drill-down
  needs (those stay behind `getAssetDetail`). A list built for a control, not a
  table, gets its own slim endpoint — the graph's seed picker uses
  `getAssetOptions`. When adding a page that lists rows, follow the same shape:
  aggregates over the full set, rows by the page.
- **A rule change reaches the data two different ways.** An AARS **level** is re-derived
  from the stored score on every read (`withCurrentBands`), so moving a threshold applies
  at once and retroactively. A change to the **point model** strands the persisted scores,
  which the pages flag; "Recompute scores" re-runs enrichment over data already in the
  sheet — issue framework codes, finding framework codes, per-asset inputs — and makes
  **zero Wiz API calls**. It writes no `sync_history` row: a rescore is not a sync, and the
  trend must not gain a point for an estate that never moved. Trend points do carry their
  `aars_rule_version`, and the chart names the breaks rather than letting a threshold edit
  read as movement.
- **Adding an endpoint is a three-file change.** `src/server/api.ts`, then the hand-written
  `api_*` delegator in `dist/entry.js` (never regenerated), then the client call site. The
  dev harness dispatches reflectively, so a missing delegator works locally and fails only
  in the deployed web app.
- **Severity never follows the brand.** Crimson marks identity/interaction and
  toxic-combination membership (always paired with the `TC` glyph); severity is
  always a dot + label with the shared palette; AARS chips reuse severity tokens.
- **`graphSearch` entity arrays are POSITIONAL.** `entities[i]` is the i-th `select: true`
  node of the query in depth-first pre-order, and an `optional` leg that matched nothing
  contributes a literal `null` holding its position. Captured and documented in
  `ai/queries/reponse_schemas/3_graphsearch_response.md`, from
  `exemples/ai_agent_expand_response.js`. Two things follow. `src/domain/syncNormalize.ts`
  identifies entities by TYPE (`entities.find(e => e.kind === X)`), which is sound only
  because each battery traversal is a 2–4 hop chain where a type occurs at most once per
  path — it does not generalize to a wide traversal, so `src/domain/graphExpand.ts` decodes
  by position instead, deriving the query and the slot list from one spec tree. And any
  reader of a raw entity must guard the element for null, not just the row.
- **Configuration findings are stored broadly and judged narrowly.** The register keeps
  every row the filter returns, including RESOLVED ones; `isOpenGap` (`src/domain/config.ts`)
  is the single place that decides which of them is a failing control, and AARS pillar B,
  `kpis.complianceGaps`, the register's counts and the asset sheet's Compliance pane all
  route through it. The gate used to sit at the normalizer, which was right while the step
  only asked for OPEN rows — but a finding that resolved because someone fixed it comes
  back `result: "PASS"`, so keeping it there would have discarded exactly what the widened
  filter exists to collect. `isOpenGap` treats an **absent** `result`/`status` as
  permissive, because rows written before those columns existed were already filtered to
  FAIL + OPEN at ingest; demanding the fields would read a whole pre-upgrade ledger as zero
  gaps on any rescore taken before the next sync.
- **Wiz sends no `resolvedAt` on a configuration finding.** `firstSeenAt` and `analyzedAt`
  are collected, so the register can date when a problem *started* and when it was last
  evaluated — never when it closed. Closure can only ever be reconstructed from this app's
  own sync history, which is why the RESOLVED rows are collected now although nothing reads
  them yet: uncollected history cannot be backfilled. `resolutionReason` is on Wiz's
  published type but absent from the tenant capture, and `CONFIG_FINDINGS` is an optional
  step that swallows an HTTP 400 — a field the schema rejects would empty `ai_findings` and
  look exactly like a tenant with nothing to report. Probe it through the Wiz Scans
  variables panel's test run before selecting it.
- **A finding keyed to a resource the graph does not hold prices nothing, by design.**
  `buildAarsHintsFromFindings` skips it: there is no asset to charge the gap to, and
  inventing one would be worse than counting nothing. The consequence is that the gap total
  and the priced total differ, so `kpis.complianceGapsUnlinked` reports the difference
  rather than leaving it implied.
- **The other graphSearch shapes are still inferred**, not captured — the remaining
  `ai/queries/reponse_schemas/` stubs are empty. Every sync archives its raw pages
  to Drive (`syncs/<sync_id>/step-N-page-*.json.gz`); after a live sync,
  copy representative pages into `ai/queries/reponse_schemas/` and reconcile
  `src/domain/syncNormalize.ts` against them. Live AARS inputs are heuristic
  (`deriveAarsInput`) until real compliance data is wired; dry-run uses exact
  per-asset hints from `ai/custom_score.md`.

## Layout

```
src/domain/    pure logic: graph model, AARS, toxic combos, projection, layout, normalizers
src/server/    GAS: Sheets/Drive stores, Wiz client, sync battery, API endpoints
src/client/    SPA: shell, pages, SVG graph renderer, design tokens (styles.css)
dev/           local browser harness (no GAS account needed)
test/          vitest specs
dist/          entry.js + appsscript.json (hand-maintained) + committed build output
```
