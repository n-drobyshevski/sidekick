# The register: three tables, three scopes

## Tables

Bronze and metrics are appended, never overwritten — every row carries `scan_id` / `scan_ts`, so
repeated runs accumulate into a trend instead of clobbering the last one. The ledger is the
exception: it is `MERGE`d, so a finding keeps one row and one history no matter how many times
it is scanned. **Three tables, shared by every scope:**

| Table | Grain | Contents |
| --- | --- | --- |
| `wiz_findings_raw` | scan × finding | bronze: `node_json` as a string, plus `seq` (API order) |
| **`wiz_vuln_ledger`** | **one row per `(scope, vuln_key)`** | **the durable base: `scope`, `first_seen`, `last_seen`, `status`, `resolved_at`, `resolution_src`, `reopened_count`, the fix clock and the exploit signals** |
| **`wiz_metrics`** | **wide, told apart by `family`** | **the commit record and every gold family, appended together — see the legend below** |

`os`, `sca` and `sast` write into this **same** table set — there used to be one set per scope
(`wiz_os_*`, `wiz_sca_*`, `wiz_sast_*`, nine tables to grant, optimise and document across the
three scopes), and that separation bought nothing a `scope` column does not buy on its own, at
the cost of tripling the estate. **`scope` is part of the ledger's key, not merely a label on
it**: the same CVE reaching a host through an OS package and reaching a service through a
library dependency is two findings with two clocks, two owners and two fixes, and one row can
carry only one `first_seen` — so the `MERGE` joins `ON target.vuln_key = source.vuln_key AND
target.scope = source.scope` (`run_pipeline.merge_ledger`), not on `vuln_key` alone. The hash
fallback is the second reason `vuln_key` alone would not do: `ledger.vuln_key` prefers the Wiz
finding id and falls back to a hash of name + asset + type + cloud + component when there is
none, and that basis carries nothing about the population it was computed in — two scopes can
collide there without either having done anything unusual.

**The `scope` predicate is now the only thing separating the three registers, and it is
checked, not merely stated.** Every read of the ledger as a *prior* — `reconcile_scan`'s own
prior, `ledger_already_merged`, the lifecycles behind gold, `rebuild_ledger`'s deletes and
replay — filters `scope` first, because `ledger.reconcile` resolves by **absence**: a row of
another scope is missing from this scan *by construction*, and an unfiltered prior would close
the whole of it as remediated, with real resolution dates and a delta that reads like a good
week. `ledger._refuse_foreign_scope` is what makes that a checked claim rather than a hopeful
one: it inspects the prior and the observation frame handed to `reconcile` and raises if either
carries a stated scope other than the one it was asked for. It used to be a can't-happen — each
scope wrote its own tables, so the prior was per-scope by construction and nothing but a
hand-assembled frame could trip it. With one table set it is the live proof that the `.where
(scope == …)` line above it actually ran: measured on a shared register scanned in the chained
job's order (`sca`, then `os`, then `sca` again), an unfiltered prior makes the guard raise
immediately; stub the guard too and the disappearance clock — fed by the scope-filtered scan
log below — still refuses to resolve the other scope's rows; only removing *both* filters lets 6
phantom rows appear in the wrong scope while the 5 real `sca` remediations go unrecorded. See
[The scan record is load-bearing](#the-scan-record-is-load-bearing) for the second, independent
filter this rests on, and its own measured cost when it alone is missing.

Silver — the typed projection of bronze — is **not** a table, in any storage mode. It is computed
in memory for the scan being built and re-derived from bronze by anything that needs it later
(`panels._silver_frame` calls the same `metrics.silver_findings` / `metrics.silver_sast` the
pipeline does): storing it would be a second copy of data the register already holds, and bronze
is what must survive. Both silver shapes emit the **same columns**, which is what keeps
`ledger.py` — the module most expensive to get wrong — unaware there are two sources at all; see
[Two silver projections, one column contract](#two-silver-projections-one-column-contract).

`…metrics` carries every row that used to have its own table — the run log and every gold family
— with `family` telling them apart. Every row carries `scan_id`, `scan_ts`, `scope` and `family`;
the rest of a row's columns belong to that one family and are NULL on the other families' rows,
which is what `mergeSchema` on the append gives for free. **A read that does not filter on
`family` blends grains that share no key**, so every reader does: `panels.register_views`
publishes one session view per family (`v_scans`, `v_mttr`, `v_program`, `v_capacity`,
`v_assets` where the scope has one) and nothing else reads the table directly.

| `family` | Grain | Contents |
| --- | --- | --- |
| `scan` | one row per run | the commit record: `scope`, `severities`, and the new/resolved/reopened deltas |
| `mttr` | scan × severity (+ `OVERALL`) | MTTR mean/median, open counts, open-age p50/p90, SLA target and compliance, the resolution-source split, the actionable clock, and the `snap_*` snapshot comparison |
| `program` | scan × severity (+ `OVERALL`) | the confusion matrix, coverage and efficiency with bounds, prevalence, signal coverage |
| `capacity` | scan × month × **`population`** | opened, closed, backlog at month start, MMCR, net flow, verdict, `reconstructed`, `closed_observed` |
| `assets` | scan × repository branch × **`population`** | P2P v5: density percentiles, foothold rate, coverage, half-life, MMCR, capacity split — see [Assets at risk](#assets-at-risk-p2p-v5). Written for `sca`; `os` and `sast` have no narrow asset-member list to request and so write nothing under this family (see [SCOPE_ASSET_MEMBERS](#scopes)) |

There is no `sensitivity` family and nothing is published under that name any more: the seven-
subset rule sweep is recomputed at read time by `panels.rule_sweep` from `v_lifecycles` rather
than stored per scan — see [What this does not do](reading-the-numbers.md#what-this-does-not-do).

The gold families are computed from the ledger and written together as **one append** — see
[The scan record is load-bearing](#the-scan-record-is-load-bearing) for what that buys on a
crash. The snapshot figures are still computed and published beside the `mttr` family as
`snap_km_median`, `snap_mttr_median`, `snap_resolved`, `snap_open` — **the gap between
`km_median` and `snap_km_median` is the size of what the snapshot-only version was missing.**

The `capacity` family gains two columns a snapshot-only pipeline could not produce, both of which
need scan history:

- **`reconstructed`** — the month predates the first scan, so its opens and closes are back-dated
  from the API's own dates rather than watched by us. Not evidence of capacity, and excluded from
  the headline `mmcr_mean` for that reason. A register three weeks old with no ledger would show
  two years of confident monthly throughput without this distinction.
- **`closed_observed`** — reconciliation's own resolution count, bucketed by the month of the scan
  that found them. An independent route to `closed`, which is derived from `resolved_at`. Where
  the two disagree, one of them is wrong, and publishing both is what lets a reader notice.

### The `capacity` and `assets` families carry two populations — always filter on `population`

Each capacity month, and each asset row, appears twice, once per population, and **an unfiltered
read doubles every count.**

| `population` | |
| --- | --- |
| `all` | every finding (or every asset). How much of the backlog moves in a month |
| `high_risk` | high-risk lifecycles only. The population P2P v3 defines net remediation capacity over, and what `gas/src/server/api.ts:859` passes (`highRiskOnly: true`) |

This `population` value is unrelated to the retired **scope** also once called `all` (see
[Scopes](#scopes)) — the two happen to share a word, not a meaning.

The two routinely disagree, and which one a number meant is not recoverable after the fact — so
both are written and every reader has to say which. The `high_risk` rows carry no
`closed_observed`: reconciliation's count has no risk label, so against that population it would
be a cross-check on a different set of findings, which is worse than none.

The grid is built per population from that population's own earliest `first_detected_at`, so a
register whose first high-risk finding arrived late has a shorter `high_risk` series. A register
with no high-risk lifecycles at all writes no `high_risk` rows.

### The scan record is load-bearing

The `family='scan'` rows of `…metrics` are not bookkeeping. Each one records which severities
that scan covered, and **disappearance is only safe because of it**: `--severities` defaults to
`CRITICAL,HIGH`, so without knowing a scan's scope, every MEDIUM row in the ledger would "vanish"
on the first scoped run and mass-resolve. Absence of something nobody looked for is not
remediation. The same rows are the idempotency guard (`recorded_scan`) and the torn-write
detector (`ledger_already_merged`), and the earliest one is the observation horizon that
`reconstructed` is measured against.

**Every read of it is scope-filtered, and that is now a second, independent guard beside the one
on [Tables](#tables) above.** `recorded_scan`, `scan_log_desc`, `previous_scan`,
`prev_scan_id_by_severity` and `gold_missing` all take and apply `scope` — because with one
shared `metrics` table, "what did the last scan see" and "is this scan's commit record already
here" both have to be asked of *this register's* commit records, never of whichever scope's scan
happened to run last in the chained job. **The two filters guard different things and neither
substitutes for the other.** Measured on a shared register scanned in the chained job's order
(`sca`, `os`, `sca` again): as shipped — both filters in place — the `os` rows are untouched and
the `sca` scan resolves 5 findings. With the ledger prior's scope filter removed,
`_refuse_foreign_scope` raises (see [Tables](#tables)). With that guard also stubbed out, the
disappearance clock still refuses to resolve the wrong scope's rows, because it is fed by this
scope-filtered scan log — a second, independent line of defence. Only with the scan-log filter
*also* removed do 6 phantom rows appear in the other scope while the 5 real `sca` remediations
go unrecorded. **The scan-log filter failing alone is the silent one**: removing it by itself,
with the ledger-prior filter still in place, makes a real resolved count read `0` instead of `5`
— no error, no raise, just a wrong and smaller number where a right one belonged. The composite
key contains the blast radius; these two filters are what keep a read from ever reaching outside
it.

**Write order per scan, and what each gap costs.** The ledger `MERGE` commits first; the
`family='scan'` commit record lands one statement later, closing the window a crash can leave
disagreeing to one statement wide; the `mttr`/`program`/`capacity`/`assets` families land after
that, as one union append. A crash in the *first* gap — MERGE committed, no commit record — is
unrecoverable by construction: the retry finds the ledger already moved with nothing recording
it, and refuses rather than reconciling the same findings twice; recover with `--rebuild_ledger`.
A crash in the *second* gap — commit record written, gold append never landed — used to be the
same story: the retry found `recorded_scan`, printed "already recorded, nothing to do", and that
scan's gold was gone for good. It no longer is. `gold_missing` detects the gap (no `mttr` row
for that `scan_id`), and the retry republishes gold from bronze and the ledger — printing
`[scan] resumed gold` — because gold is re-derivable from data the register still has, so a
missing gold row is recoverable and a missing scan is not.

**The resume has one condition.** Gold describes the ledger *as it stood* for that scan, and the
ledger only ever stands at one scan at a time — so a resume is only valid for the *newest* scan
on record. Once a later scan has merged, its gold has already moved the ledger past the crashed
scan's state, and republishing would stamp that later state with the older scan's `scan_ts` — a
wrong number, not a missing one, and one nothing downstream could tell from a right one. The
retry refuses by name in that case, and points at `--rebuild_ledger`, which regenerates gold per
replayed scan (not only the ledger) — the only way to put a stale scan's gold back once a later
scan has moved on.

Fully qualified as `<catalog>.<schema>.<prefix><name>`, where the prefix defaults to `wiz_`. One
reason now, not two: these usually land in a schema shared with other teams, where a bare
`findings_raw` or `metrics` would be a collision waiting to happen. **It no longer carries the
scope.** It used to (`wiz_os_`, `wiz_sca_`, `wiz_sast_`), so each scope landed in its own table
set and the registers could never be blended by accident — but that separation is what a `scope`
column buys anyway, for a third of the tables to grant, optimise and document. What changed is
that the thing stopping a blend is a predicate rather than a table name, and a predicate is
testable (`brick/tests/test_scope_isolation.py`) where a naming convention was only ever
conventional. `--table_prefix` overrides the default (empty opts out entirely).

### Table layout

Two tables carry a physical layout. The third — `metrics`, at roughly a dozen to a few hundred
rows per scan across every family — is left alone: there is nothing there worth laying out.

| Table | `CLUSTER BY` | Deletion vectors | Why |
| --- | --- | --- | --- |
| `…vuln_ledger` | `(scope, vuln_key)` | **on** | `(scope, vuln_key)` is the MERGE's `ON` key |
| `…findings_raw` | `(scope, scan_id)` | off | every read of bronze filters on `scope` first, then `scan_id` |
| `…metrics` | — | — | unclustered; every read already filters on `family` and the scan pin |

**Both keys carry `scope` now, and it leads.** With one table set holding every scope, `scope`
is the coarser predicate and the one every read applies first — `panels._silver_frame` and
`rebuild_ledger` both narrow to one scope before they narrow to one scan id, so a scan that does
not filter it would read three registers instead of one. `run_pipeline.CLUSTERING` holds the
two column tuples plus the deletion-vector flag; `create_clustered` unpacks the tuple into
`clusterBy(*cols)`.

**Deletion vectors are the half that pays.** Without them a `MERGE` that matches a row rewrites
the entire file containing it, so the daily reconcile — which touches every finding the scan
saw, just to advance `last_seen` — rewrites most of the ledger. With them the matched rows are
marked and the new versions appended. The win grows with the register: on a young one nearly
every row is touched daily and there is little to skip; on a mature one, where the bulk is
long-resolved findings nobody observed today, it is the difference between rewriting the table
and rewriting the day.

They are set **explicitly**, on both clustered tables (on for the ledger, off for bronze),
because the two runtimes disagree about the default — Databricks enables deletion vectors for a
clustered table, open-source Delta does not — and a cluster configured unlike the test suite is
how a number stops being reproducible. `metrics` declares no clustering at all, so the question
does not arise for it.

**Clustering on `(scope, vuln_key)` is not what makes the MERGE fast, and it is worth knowing
why.** `vuln_key` is `id:<wiz-finding-id>` or `h:<sha>`; both are effectively random, and adding
`scope` in front of a random key still leaves the register clustered into at most three wide
ranges internally — `os`, `sca` and `sast` files can be pruned against each other, but a MERGE
source holding every finding *this scan* saw is already narrowed to one scope, so that pruning
buys nothing on the write path. Clustering gives files non-overlapping *ranges*, and a source
spanning the whole of one scope's range still leaves almost no file prunable within it — random
keys are the worst case for range-based skipping. It is still the right key (it is the only one
the MERGE joins on, and point lookups do benefit, including a lookup scoped to one register), but
the reason the reconcile gets cheaper is the deletion vectors.

`(scope, scan_id)` on bronze is different: that read genuinely does prune, on both columns.
`scan_id` already skipped perfectly **by accident** — each run appends only its own scan, so
every file had `min(scan_id) == max(scan_id)`. The first `OPTIMIZE` that packs two scans into
one file would have destroyed that. `CLUSTER BY (scope, scan_id)` makes it a property of the
table instead of a lucky consequence of the write pattern, which is what makes running
`--maintain` safe — and with three scopes' scans now interleaved in one table (`sca` runs
between two `os` scans in the chained job), the `scope` column is what keeps that pruning working
at all once a scan of each scope has landed.

**The protocol bump, and its blast radius.** Clustering raises a table to Delta **writer version
7**; deletion vectors raise the **reader to version 3**. Protocol versions cannot be downgraded.
So the ledger becomes unreadable to any client that does not speak reader 3 (DBR 12.2+ is fine),
while bronze and `metrics` stay at reader 1 and can still be read by anything. That split is the
practical reason deletion vectors are off on bronze — they would buy nothing there and cost
every reader; `metrics` never faces the question, since it carries no clustering spec at all.
Nothing in this repo reads these tables (`gas/` and `wiz_dashboard/` never touch Delta), but an
external consumer is worth checking before you migrate.

**Layout is declared at creation.** A clustering spec cannot be added by an append, so the
ledger is created by `ensure_tables` (clustered) and bronze by whatever first writes it
(clustered too, at that point). `ensure_tables` also creates `metrics` when it is missing, as an
empty declared frame with no clustering spec — its gold columns arrive later through
`mergeSchema`, the same way `snap_*` and `population` do. An existing register keeps its
unclustered layout until someone migrates it — see
[Migrating an existing register](migrating.md#migrating-an-existing-register).

#### What this measured, which is not what it was supposed to measure

`tools/bench_pipeline.py`, eight scans of 8,000 findings with 30% churn — a register whose ledger
reaches ~24,800 rows with 8,000 touched per scan, so a third of it is rewritten daily and there
is real copy-on-write to avoid. Three runs a side, medians:

| | median | Spark jobs |
| --- | --- | --- |
| unclustered (before) | 176.3 s | 910 |
| clustered, no deletion vectors | 185.1 s | 910 |
| clustered + deletion vectors | 206.4 s | 988 |

**Both cost. Neither pays.** Clustering alone is ~5% slower; deletion vectors add another ~12%
and 78 Spark jobs per run.

The explanation is the scale, and it is worth stating rather than hiding, because it is also the
condition under which this becomes worth having. Copy-on-write amplification is the cost of
**rewriting a large file to change a few rows** — the pain starts when files reach the
100 MB–1 GB range Delta targets. At benchmark scale the ledger's files are a few megabytes, so
rewriting all of them is nearly free, while writing deletion vectors and applying them on read
is pure added work. Getting the files large enough to invert that needs a ledger on the order of
a million rows, which this harness cannot build on one machine in a sensible time.

So the honest position: **the benefit is argued, not measured, and the cost is measured, not
argued.** If your register is small, or its ledger is mostly still-open findings that get touched
every scan anyway, this layout is costing you and `delta.enableDeletionVectors` is one word in
`run_pipeline.CLUSTERING`. If it holds years of resolved history that no scan touches, the
arithmetic is the other way round — and the way to find out is to run `tools/bench_pipeline.py` against
numbers that look like yours rather than to trust either of us.

Two things this *does* buy unconditionally: `--maintain` becomes safe to run (see bronze's
accidental skipping above), and the layout is declared rather than emergent.

## Scopes

`--scope` decides which population a run measures, and drives the API filter. It no longer
drives table names — `os`, `sca` and `sast` write into the same `wiz_findings_raw` /
`wiz_vuln_ledger` / `wiz_metrics`, and every row carries a `scope` column instead, which is the
**only** thing that keeps the three registers from being blended: see
[Tables](#tables) for the composite ledger key this rests on and
[Running on Databricks](deploy.md#3b-as-a-databricks-asset-bundle) for how a single `--scan_id` stays
distinct per scope when three scopes now share one commit-record table
(`--scan_id={{job.run_id}}-<scope>`).

| Scope | Population | Vendor fix? | Default severity gate |
| --- | --- | --- | --- |
| `os` (default) | OS-package CVEs on host workloads — parity with `os_vulns.VARIABLES["filterBy"]`, so the numbers are comparable with `gas/` | yes | `CRITICAL,HIGH` |
| `sca` | CVEs in the libraries a repository depends on, restricted to the default branch's code stage | yes | `CRITICAL,HIGH` |
| `sast` | weaknesses in first-party code, no CVE involved | no | `CRITICAL,HIGH` |

A fourth scope, `all` — every detection method and asset type, no OS/asset restriction — existed
early on and is **not carried forward**: it overlapped `os` and was never scheduled as a Job.

All three share `status: ["OPEN", "RESOLVED"]` and `hasFix: true` where their filter type
supports either key, and neither is about scoping:

- **`status`** — without it the API returns only open findings, and every remediation metric
  collapses (coverage 0%, efficiency undefined, MTTR empty) while still looking like a real
  result. `sast` withholds it for a different, measured reason — see below.
- **`hasFix`** — restricts a scope to findings a team could actually have remediated, so
  remediation rates mean the same thing across scopes that have it. `sast` has no vendor fix at
  all, so the key does not apply there.

`os_vulns.py` — and, for the other two, the Wiz console exports the `sast` and `sca` filters were
copied from — also pins a `projectIdV2` / `projectId`. That is one tenant's project, so it is
**not** copied into the scope; pass `--project_id=<id>` if you want it. Those two exports are
deleted; their committed captures, `brick/fixtures/sast_response.json` and
`brick/fixtures/sca_response.json`, are what survives of them, and `git show
ef22b05^:brick/devsecops/sca_request.py` still holds the requests themselves.

Bronze keeps the finding as a JSON string so a Wiz schema change can never fail ingest; silver
is just the typed projection of whatever arrived.

### `os` and `sca` need no new maths

Both read the **same GraphQL connection**, `vulnerabilityFindings`, under the same
`VulnerabilityFindingFilters` type. Their findings carry a CVE and the same three exploit
signals, so every metric family above applies unchanged and means what it means for a host
register. `sca` restricts it to the code stage of the default branch:

| | |
| --- | --- |
| `codeToCloudPipelineStage: ["CODE"]` | the library as it appears in the repository, not the copy baked into every container image built from it. Without it one dependency is counted once per repo *and* once per image |
| `isDefaultBranch: {equals: true}` | or every feature branch is its own asset, and the register grows and shrinks with the team's branching habits rather than with its code |

`sca` is also the reason a code register carries **asset columns** where `os` does not. A
`vulnerableAsset` union fails as a whole, so one member the tenant no longer has costs the
entire request — which is why `config.FETCH_ASSET_FIELDS` is off globally. `sca` returns
`REPOSITORY_BRANCH` and nothing else (`fixtures/sca_response.json` is the evidence), so
`config.SCOPE_ASSET_MEMBERS["sca"]` narrows the selection to the two members that resolve. `os`
has no narrower list to ask for — a host finding can arrive on any of the thirteen members — so
it is deliberately absent from that map and falls back to no asset columns at all. That
narrowing is what makes the v5 asset family computable for `sca` at all; see
[Assets at risk](#assets-at-risk-p2p-v5).

### `sast` is a second source, and a rule of our own

`sastFindings` is a different connection with a different filter type, and a static-analysis
finding has **no CVE, and therefore no KEV entry, no published exploit and no EPSS score**.
Under the shared risk rule every one of them would classify `unknown` and every rate would be
undefined — correctly, and uselessly. So `config.SastRiskRule` is an any-of over three signals,
swept by the same rule-sensitivity sweep (`panels.rule_sweep`, recomputed at read time — see
[Since the rule is the label, its sensitivity is a published metric](reading-the-numbers.md#since-the-rule-is-the-label-its-sensitivity-is-a-published-metric)).
Why it carries `RiskRule`'s exact frozen, inspectable shape is written down in
`config.SastRiskRule`'s docstring.

| Signal | Question it answers | What it is |
| --- | --- | --- |
| `cwe` | is this a *kind* of weakness that gets exploited? | the CWE, or a documented ancestor of it, is in MITRE's CWE Top 25 |
| `ai_verdict` | does the scanner's own triage think this instance is real? | `aiAnalysis.verdict` is in `config.AI_VERDICTS_HIGH` |
| `critical` | did somebody already call this the worst tier? | severity is CRITICAL |

Four things about this register are different, and none is a detail:

- **The CWE hierarchy is the weakest joint.** Scanners report leaves and the Top 25 holds
  interior nodes: the captured response contains CWE-23 (Relative Path Traversal), a child of
  Top-25 member CWE-22. `config.CWE_ANCESTORS` lifts the children this tenant actually produces
  and is **deliberately incomplete**. An unmapped child classifies `low`, so the gap costs
  coverage's numerator silently — `signal_breakdown` publishes `cwe_unmapped` as its size, and
  that is the number to read before quoting a SAST coverage figure.
- **There is a birth date and no death date.** `SASTFinding.createdAt` is a non-null `DateTime!`,
  filterable and sortable, and `ingest.SAST_QUERY` selects it — `metrics.silver_sast` reads it
  into `first_detected_at` and the ledger prefers it over the scan that first saw the finding.
  There is still no `resolvedAt`, so a death date arrives only when a later scan stops returning
  a finding. **SAST therefore has a genuine MTTR once two scans exist**: a measured start, a
  disappearance-dated end carrying an error bar of one scan interval, and
  `resolution_src = 'disappeared'` saying so. What remains under-measured is the *end*, not the
  beginning — findings that predate the first scan now carry their real age. **The column
  cannot be applied retroactively** — bronze holds only the fields the query asked for, so
  `--rebuild_ledger` over older scans still reads NULL and falls back to observation.
- **Every closure is inferred, by choice, and the reason is two measured facts, not one.**
  `config.SAST_FETCH_RESOLVED` declines to ask for RESOLVED findings because the type has no
  `resolvedAt`, and because `status: RESOLVED` returns **zero rows** against this tenant. With
  `createdAt` selected and no `resolvedAt` to read, an already-resolved finding would land
  `first_seen = createdAt`, `resolved_at = now`, so `mttr_days` would be the finding's age at
  the moment we first looked — worse than a flat zero, because it is plausible: a weakness fixed
  within a day two years ago would report 730 days, and the Kaplan–Meier median would be set by
  the register's own start date rather than by remediation. `tests/test_devsecops.py` measures
  that age. Turn the flag on if a `resolvedAt` appears, not before.
- **The same field name carries a different KIND across the two filter types.**
  `SASTFindingFilters` does accept `severity`, but as a `SASTSeverityFilter`, an object taking
  `{equals: [...]}`, where `VulnerabilityFindingFilters.severity` is a bare
  `[VulnerabilitySeverity!]`. Same for `status` (`SASTStatusFilter`), and inverted for the
  project restriction: `sca`'s `projectIdV2` is an object and `sast`'s `projectId` is a bare
  `[String!]`. A mismatch is refused with HTTP 400 `VALIDATION_INVALID_TYPE_VARIABLE`, which
  fetches **zero rows and reads as an empty register**, not as an error.
  `config.OBJECT_FILTERS` holds the asymmetry per scope and `ingest._shape_base` routes
  **every** list-valued key of `config.SCOPES` through it, because a table covering only part of
  the filter is worse than none — an inline literal bypasses it, and adding the key changes
  nothing. `os` needs an entry here too, and needing one was **measured, not assumed**: every
  value in `SCOPES["os"]` is a bare list, a scalar or a nested `{"notEquals": [...]}` that
  `_shape_base` leaves alone, but `build_filter` adds `projectIdV2` *after* `_shape_base` runs,
  so without an entry it would go on the wire as a bare list and be refused the same way. Copy
  new entries from `npm run probe -- --schema` in `gas_devsecops/`; never infer one filter
  type's shape from another's.
- **What `aiAnalysis.verdict` spells is still unverified against the live tenant.** Every node in
  the captured response has `aiAnalysis: null`, so the AI clause will never fire until the enum
  is confirmed — quiet, which is why `ai_verdict_missing` is published beside it.

### Two silver projections, one column contract

`metrics.silver_findings` dispatches on the scope's source and `metrics.silver_sast` handles the
`sast` shape. **Both emit the same columns**, which is what keeps `ledger.py` unaware there are
two sources. Three of those columns mean something adjacent for `sast`:

| Column | For `sast` |
| --- | --- |
| `cve` | the weakness *title* ("SQL Injection"), not an identifier. Reused rather than paralleled: it is the column every panel groups on to answer "what kind of thing is this". The identifier-shaped value is in `cwe` |
| `component` | the file path — the located artefact |
| `asset_*` | the repository branch, from `resource`. A plain object rather than a union, so none of `sca`'s `FETCH_ASSET_FIELDS` trouble applies — but `sast` still has no entry in `SCOPE_ASSET_MEMBERS` and no `assets` family, because nothing here derives density and capacity for it yet |

`ai_verdict` is **latest-observation-wins, not monotone**, unlike the exploit signals beside it.
Exploit knowledge does not decay, so letting `has_kev` fall back to false would be forgetting
something true; an AI triage verdict is an opinion about *this call site*, and a re-triage is a
correction. Freezing it would pin the high-risk population full of findings everyone has since
agreed are not real. The cost, stated rather than hidden: a SAST coverage figure **can** move
between scans for a reason that is not remediation.

## Assets at risk (P2P v5)

The `assets` family of `…metrics` is volume 5, whose unit of analysis is the asset rather than
the vulnerability: *"the fact that we manage vulnerabilities in assets rather than in a vacuum
requires us to know where risk isn't, where it is now, and where it will eventually be."* The
asset is the repository branch, and the language/ecosystem is v5's asset *category* — its
analogue of Windows / Linux / Mac / appliances, and for the same reason: a category is a group
of assets that behave alike because of the platform rather than because of the team looking
after them.

| Column | v5 |
| --- | --- |
| `assets` | asset prevalence |
| `density_p25` / `density_p50` / `density_p75` | vulnerability density, open findings per asset (Fig. 10). Percentiles rather than a mean because the distribution is far too skewed for one |
| `assets_with_high_risk_pct` | the foothold rate (Fig. 11): *"just one opening is needed"* |
| `asset_coverage_p50` | coverage per asset rather than per finding, over the assets with anything to cover |
| `km_median_days` | the half-life (Fig. 15) — the same `metrics.kaplan_meier` the severity table uses |
| `mmcr_p50` | the median share of an asset's backlog closed per month (Fig. 20) |
| `falling_behind_pct` / `maintaining_pct` / `gaining_pct` | the capacity split (Fig. 21) |

This family is only written for `sca` today, because it is the only scope with a narrow enough
`vulnerableAsset` member list to resolve reliably — see
[`os` and `sca` need no new maths](#os-and-sca-need-no-new-maths). `os` writes no `assets` rows
(no narrow member list to request) and neither does `sast` (its asset is a plain repository
branch object, not a union, but nothing here has been wired to build density/capacity figures
from it yet).

- **Filter on `population`.** Every asset group appears twice — `all` and `high_risk` — and an
  unfiltered read doubles every count.
- **The capacity columns are NULL without a scan log.** They are rates per *watched* month, and
  a register that has not recorded when it started watching has none. `window_months` and
  `assets_flowing` ride along so a confident split over three repos and one month cannot pass
  for a trend.
