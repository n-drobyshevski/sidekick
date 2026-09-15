# `brick/` — vulnerability and code-security metrics on Databricks

A small Spark pipeline that pulls Wiz findings — OS-package CVEs on host workloads, CVEs in the
libraries a repository depends on, and static-analysis weaknesses in first-party code — into
Delta, tracks each finding's lifecycle across scans in a persistent ledger, and computes metrics
as query-able gold tables:

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | Kaplan–Meier median over `resolved_at − first_seen`, counting still-open findings as right-censored; in-SLA is `mttr_days <= target` |
| **Coverage** | Of all high-risk findings, what share did we remediate? | `TP / (TP + FN)` |
| **Efficiency** | Of everything we remediated, what share was actually high-risk? | `TP / (TP + FP)` |
| **Capacity** | Can we close faster than risk arrives? | monthly `closed / open_at_start`, and `closed − opened` |
| **Assets at risk** | Which repositories carry the backlog, which offer a foothold, which are falling behind? | P2P v5: per-repo density percentiles, foothold rate, coverage, half-life and net flow |

Coverage and efficiency come from the Cisco Kenna / Cyentia *Prioritization to Prediction*
series. They are in direct tension, so the pipeline always emits both, never one alone — and
P2P is the source of the **formulas**, not a benchmark these numbers can be read against. See
[Reading coverage and efficiency](#reading-coverage-and-efficiency), which is the section to
read before quoting either figure to anyone. Assets at risk is P2P volume 5's asset-centric
family, and it is only computable for a scope whose findings resolve to an asset this pipeline
can narrow its request to — see [Assets at risk](#assets-at-risk-p2p-v5).

Those lifecycles are the difference between this and the pipeline's first version: metrics come
from what the register has been observed to do over time, not from whatever the latest snapshot
happens to say. See [The ledger, and why it exists](#the-ledger-and-why-it-exists).

This is a second surface over the same registers as the Apps Script rebuilds, not a
replacement for them. `gas/` is the reference implementation for the
machinery every scope shares: the lifecycle rules are ported from `gas/src/domain/reconcile.ts`,
the P2P family from `gas/src/domain/program.ts`, and Kaplan–Meier from
`gas/src/domain/remediation.ts`. `gas_devsecops/` is the reference for what is genuinely only
here — its own filter-kind asymmetry table and its `awaiting_vendor_fix` scope guard are what
`config.OBJECT_FILTERS` and `config.HAS_VENDOR_FIX` below are checked against. Where GAS and the
older `wiz_dashboard/domain/` port disagree, GAS wins.

**This directory used to be two.** `brick/` measured only `os` and `brick/devsecops/` measured
`sca`/`sast` as a separate, self-contained copy of the same modules under the same names — a
real fork, deployable on its own, at the cost of the cross-scan reconciler and the P2P maths
existing twice. The two have since merged into this one tree, and with the second copy gone, so
is the rule that exactly one of them could be on `sys.path`. The trap that survives the merge is
narrower: a stale `sys.modules` entry left behind by an earlier import in the same long-lived
process, which `run_pipeline.check_deployment()` still catches before Spark starts.

## Layout

```
config.py           constants: severity taxonomy, per-scope Wiz filters (SCOPES), which API
                     connection each scope reads (SOURCES), the risk rules (RiskRule and the
                     SAST-only any-of), and the actionable-clock scope guards
dbx.py               reaching dbutils from inside a module, and doing without it off-cluster
ingest.py            Wiz OAuth + paginated GraphQL -> raw finding dicts, for both connections
ledger.py            pure PySpark cross-scan lifecycle reconciliation (no I/O)
metrics.py           pure PySpark DataFrame -> DataFrame transforms (no I/O), both silver shapes
run_pipeline.py      the Databricks entry point: bronze -> the ledger -> one metrics table

import_bundle.py     one-shot: seed the `os` ledger from a gas/ migration bundle
export_fixtures.py   golden-fixture exporter for gas_devsecops/'s TypeScript parity suites
csvstore.py          the register as typed CSV, for a deployment with no catalog -- see the
                     CSV register
sast_request.py      a standalone reference script: the exact SAST GraphQL request the `sast`
                     scope's filter was copied from (the code-register analogue of the repo
                     root's os_vulns.py, which the `os` scope's filter mirrors)
sca_request.py       the same, for the SCA GraphQL request

panels.py            every number a notebook shows, and the one place that pins the scan
figures.py           pandas -> Plotly figures, drawn the way the GAS apps draw them
tiles.py             HTML fragments for displayHTML: heroes, KPI bands, the confusion matrix
notebooks/           nine .ipynb pages -- see Notebooks
databricks.yml        the Databricks Asset Bundle: four Jobs, one per scope plus maintenance

tests/               local-SparkSession tests, oracles ported from gas/ and gas_devsecops/
bench_pipeline.py    a synthetic register, timed through the real entry points -- see
                     Benchmarking
```

`ledger.py` and `metrics.py` are pure `DataFrame -> DataFrame`; `run_pipeline.py` is the only
module that does I/O. That is what lets the lifecycle rules — the part most likely to be wrong —
be tested against a local `SparkSession` with no Delta table, no cluster and no API in the way.

The presentation layer keeps the same discipline one level up: `panels.py` is Spark in and a
small frame out, `figures.py` is pandas in and a `Figure` out, `tiles.py` is a value in and a
string out. None of them renders anything except through one function each, which is what makes
the whole UI testable without a workspace. See [Notebooks](#notebooks).

**These are plain top-level modules, not a package.** There is no `__init__.py`, and they import
each other by bare name (`import metrics`, `from config import …`). Whatever directory holds
them goes on `sys.path`. That is what lets the Databricks side be a single flat folder of files,
with no nesting to reproduce by hand and no package prefix to keep in sync.

The consequence to know about: the runtime module names are generic — `config`, `metrics` and
`ingest` obviously so, and `panels`, `figures` and `tiles` even more plausibly, since they are
exactly what someone else's unrelated workspace file might be called. Put the directory **first**
on `sys.path` (`sys.path.insert(0, …)`, not `append`) so a same-named module elsewhere cannot
win — that would fail as a confusing `AttributeError` rather than an import error. Every
notebook's first cell does this, and `06_run_and_verify` prints the `__file__` each module
actually came from.

`brick/` never imports `wiz_dashboard` — a Spark cluster does not carry that package.
The shared constants are duplicated on purpose; `config.py` names its sources.

## The ledger, and why it exists

The pipeline's first version measured each scan in isolation: a run pulled findings and computed
everything from that one snapshot's `firstDetectedAt` / `resolvedAt`. Runs accumulated as
separate `scan_id`s, but nothing reconciled one against the next.

That gets one thing badly wrong. **Wiz stops returning a finding once it is remediated, and often
never sets `resolvedAt`** — so remediation usually looks like a finding quietly disappearing. The
first version could not see that at all. Those findings stayed open forever: MTTR
under-reported, coverage under-reported, and the capacity table's `closed` column missed every
such closure.

The ledger gives each finding a durable identity (`vuln_key`) and a row that survives across
runs — first seen, still here, gone. Metrics come from those observed lifecycles instead of from
a snapshot, so a finding that vanishes is counted as resolved on the day it vanished.

The lifecycle rules are ported from `gas/src/domain/reconcile.ts`, which is the reference
implementation; `tests/test_ledger.py` replays that module's own golden fixture
(`gas/test/fixtures/reconcile.json`) scenario by scenario, so the port is checked against the
standard rather than against itself.

| Rule | |
| --- | --- |
| First sighting | OPEN, `first_seen = min(firstDetectedAt, scan ts)` |
| Persisting | advance `last_seen`; `first_seen` stays earliest-known and never drifts later |
| API-resolved | `resolvedAt` present, or status in `RESOLVED_STATUSES` → `resolution_src = 'api'` |
| Disappearance | was OPEN, was in the previous scan covering its severity and its scope, absent now → `resolution_src = 'disappeared'` |
| Reopen | a RESOLVED finding is active again → OPEN, `reopened_count++`, a new episode |

A reopen "recomputes" `first_seen` rather than advancing it: it takes `min(firstDetectedAt, scan
ts)`, the same formula a first sighting uses, and deliberately ignores the value already on the
row. That breaks the earliest-known chain — the one place `first_seen` can move *later*. Note the
consequence: if Wiz still reports the original `firstDetectedAt`, the reopened episode inherits
that date rather than starting from the reopen. That is the reference implementation's behaviour
(`reconcile.ts:340`), and the surfaces have to agree.

Three different update disciplines coexist on a ledger row, and they are not interchangeable:

- **latest-observation-wins** — severity, CVE, asset attributes, and (for `sast`) `ai_verdict`.
  A re-triage is a correction, not something to remember alongside the old verdict.
- **sticky first-wins, reset by a reopen** — the vendor-fix clock (`fix_date`,
  `fix_observed_at`), on the scopes that have one.
- **monotone, never reset** — the exploit signals, on the scopes that carry them. `has_kev` /
  `has_exploit` go null → false → true and never back; `epss` keeps the **peak** ever observed.
  Exploit knowledge does not decay, and — because the gold tables are appended — a finding that
  silently left the high-risk population would leave last week's published coverage disagreeing
  with this week's for reasons unrelated to any remediation.

### Disappearance is an inference, and it is labelled as one

`resolution_src` records how each closure was learned, and the `mttr` family of `…metrics`
publishes `resolved_api` / `resolved_disappeared` per severity. A register whose closures are
overwhelmingly inferred is telling you something about the data source as much as about the
security programme — which you can only notice if the split is on the table. For `sast`, whose
source has no `resolvedAt` at all (see [Scopes](#scopes)), the split is not a caveat, it is the
whole story: every closure there is `disappeared`.

`--disappearance` picks the date: `scan_ts` (default) is the scan that noticed the absence,
which overstates MTTR by at most one scan interval but never records a moment nobody observed;
`midpoint` halves that bias by inventing a timestamp between the two scans. On a daily job the
difference is under 24 hours.

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
than stored per scan — see [What this does not do](#what-this-does-not-do).

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
[Migrating an existing register](#migrating-an-existing-register).

#### What this measured, which is not what it was supposed to measure

`bench_pipeline.py`, eight scans of 8,000 findings with 30% churn — a register whose ledger
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
arithmetic is the other way round — and the way to find out is to run `bench_pipeline.py` against
numbers that look like yours rather than to trust either of us.

Two things this *does* buy unconditionally: `--maintain` becomes safe to run (see bronze's
accidental skipping above), and the layout is declared rather than emergent.

## Scopes

`--scope` decides which population a run measures, and drives the API filter. It no longer
drives table names — `os`, `sca` and `sast` write into the same `wiz_findings_raw` /
`wiz_vuln_ledger` / `wiz_metrics`, and every row carries a `scope` column instead, which is the
**only** thing that keeps the three registers from being blended: see
[Tables](#tables) for the composite ledger key this rests on and
[Running on Databricks](#3b-as-a-databricks-asset-bundle) for how a single `--scan_id` stays
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

`os_vulns.py` (`sast_request.py`, `sca_request.py` for the other two) also pins a `projectIdV2`
/ `projectId`. That is one tenant's project, so it is **not** copied into the scope; pass
`--project_id=<id>` if you want it.

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
`REPOSITORY_BRANCH` and nothing else (`sca_response.json` is the evidence), so
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
in the same frozen, inspectable shape, swept by the same rule-sensitivity sweep
(`panels.rule_sweep`, recomputed at read time — see
[Since the rule is the label, its sensitivity is a published metric](#since-the-rule-is-the-label-its-sensitivity-is-a-published-metric)).

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

## Running on Databricks

**Requirements:** DBR 14.3 LTS or newer (Spark 3.5 — `F.percentile` is a 3.5 function; liquid
clustering is supported from DBR 13.3 but only **GA from 15.4 LTS**, so on 14.3 the
[table layout](#table-layout) works and is pre-GA), and Unity Catalog if you want a three-level
`catalog.schema.table` namespace. `requests` is already on the runtime. Nothing else to install.

### 1. Store the credentials

Once per workspace, from the Databricks CLI:

```bash
databricks secrets create-scope wiz
databricks secrets put-secret wiz wiz-client-id
databricks secrets put-secret wiz wiz-client-secret
```

The service account needs the `read:vulnerabilities` scope in Wiz. Credentials are only ever
read through `dbutils.secrets`; nothing is inlined, and the values never reach a table or a log.
One service account and one secret pair cover all three scopes — the scope that differs is a
run parameter, not a credential.

**Pick the catalog deliberately.** These tables map unpatched CVEs to named hosts and
repositories, so they belong somewhere with grants to match. `catalog` has no default **on the
write path** for exactly this reason: the job fails rather than guessing. Reading the wrong
catalog shows you an empty page; writing to it is a disclosure, so only the write path is strict
— the read-only notebooks open on `config.DEFAULT_CATALOG` / `DEFAULT_SCHEMA`
(`preprod_datalake_insight_analytics.industry`), which is the deployment they are pointed at.

Note that `datalake_insight_analytics` (no prefix) is **read-only** to the service principal.
The pipeline writes to the `preprod_` catalog; pointing it at the other one fails at the first
`saveAsTable` with a permission error that names neither the catalog nor the grant.

Restrict the schema once it exists:

```sql
GRANT USE SCHEMA, SELECT ON SCHEMA <your-catalog>.<your-schema> TO `security-analysts`;
```

**Privileges the job needs.** `USE CATALOG` on the catalog, `USE SCHEMA` + `CREATE TABLE` on
the schema, and `MODIFY`/`SELECT` on its own tables. It needs `CREATE SCHEMA` on the catalog
**only** when the schema does not yet exist — `ensure_schema` checks first rather than issuing
an unconditional `CREATE SCHEMA IF NOT EXISTS`, which would otherwise fail with
PERMISSION_DENIED against a schema that already exists and is perfectly writable. In a shared
organisation catalog, have a platform admin create the schema once and grant `CREATE TABLE` on
it; the job then never needs catalog-level rights.

**Per-register grants are now row filters, not table grants — and this is documented, not
implemented or measured.** The `GRANT ... SELECT` above hands a reader every scope's rows,
because `os`, `sca` and `sast` now sit in the *same* three tables — that used to be a table-level
grant per scope (`GRANT SELECT ON wiz_os_vuln_ledger TO ...`), and there is no table left to grant
on for one register alone. Unity Catalog row-level security is the documented replacement, not
run against a live workspace here:

```sql
CREATE FUNCTION <catalog>.<schema>.only_scope(scope STRING)
  RETURN scope = current_user_scope();  -- current_user_scope(): however the deployment maps
                                          -- a principal to the one scope it may read, e.g. a
                                          -- lookup table keyed on is_account_group_member()

ALTER TABLE <catalog>.<schema>.wiz_vuln_ledger
  SET ROW FILTER <catalog>.<schema>.only_scope ON (scope);
```

or, simpler and more explicit for a fixed roster, one filter function per scope
(`only_os_scope() RETURN scope = 'os' OR is_account_group_member('security-leads')`) applied per
reader group. Either shape restricts a reader to one scope's rows of a table three registers
share; neither has been run against a workspace, and this is a recipe to adapt, not a script to
paste.

### 2. Get the code onto the workspace

**Six** `.py` modules are needed to run any scope — skip `tests/`, `README.md` and
`requirements.txt`, and note `requests` is already on the runtime. Put them all in **one flat
folder**, created as **Files**, not Notebooks (a notebook is not importable as a module, and
this is the most common way the setup goes wrong):

```
/Workspace/Users/<you>/wiz-metrics/       ← this path goes on sys.path
├── config.py
├── dbx.py
├── ingest.py
├── ledger.py
├── metrics.py
└── run_pipeline.py
```

> **Replace all six together.** The modules move in lockstep — a newer `metrics.py` can write a
> silver frame that only a newer `run_pipeline.py` knows how to merge — so a half-updated folder
> imports cleanly and then fails much later at something that looks unrelated. The pipeline's
> first real run past the flat-snapshot version hit exactly this: 137,870 findings ingested,
> then *"A schema mismatch detected when writing to the Delta table"*, which names neither the
> stale file nor the fix. Every module now carries a `MODULE_VERSION` and `run_pipeline` refuses
> to start when they disagree, but re-pasting the whole set is what avoids the problem rather
> than merely diagnosing it.

To read the [notebooks](#notebooks) as well as run the pipeline, five more files go on the same
`sys.path`, plus the notebooks themselves:

```
/Workspace/Users/<you>/wiz-metrics/       ← these files go on sys.path too
├── panels.py
├── figures.py
├── tiles.py
├── csvstore.py
├── import_bundle.py
└── notebooks/
    ├── 00_security_posture.ipynb
    ├── 01_mttr_sla.ipynb
    ├── 02_program_performance.ipynb
    ├── 03_os_vulnerabilities.ipynb
    ├── 03_code_vulnerabilities.ipynb
    ├── 04_scan_history.ipynb
    ├── 05_estate.ipynb
    ├── 06_run_and_verify.ipynb
    ├── 07_import_gas.ipynb
    └── 08_code_assets.ipynb
```

These five are **not** in the six. A scheduled Job must never fail for want of Plotly, and it
has no business carrying a one-shot migration either, so `run_pipeline` neither imports nor
requires any of them — but if they *are* imported and their version disagrees, that is fatal for
the same reason the six are: a stale `figures.py` beside a fresh `metrics.py` draws a chart that
contradicts the number printed above it, and a stale `import_bundle.py` seeds rows the current
reconciler cannot continue. Same class of bug, quieter failure.

Three ways to get them there, all ending in the same place:

- **UI** — create the folder, then Create → File once per module and paste, all six. Then run
  the verification cell below; with six hand-pasted files it is the step that catches a miss.
  The notebooks have to be **imported** rather than pasted (File → Import), because a `.ipynb`
  is a notebook, not a file.
- **Git folder** — Workspace → Create → Git folder against this repo. Then the path above is
  `/Workspace/Users/<you>/sidekick/brick`, the notebooks arrive as notebooks, and the boot cell
  finds the modules one directory up on its own. The only option that updates every file at once
  and tells you when your copy is stale, and the one to use if you want the notebooks.
- **CLI** — `databricks workspace import-dir ./brick /Workspace/Users/<you>/wiz-metrics
  --overwrite`. **`--overwrite` is not optional when refreshing:** without it existing files are
  skipped and only new files land, which is the mixed folder described above. Copies `tests/`
  too, harmlessly.

#### Check the upload landed

Cheap, and it catches both a missed file and the `sys.path` shadowing described under
[Layout](#layout) — the printed path tells you which `config.py` actually won:

```python
import config, dbx, ingest, ledger, metrics, run_pipeline
for m in (config, dbx, ingest, ledger, metrics, run_pipeline):
    print(f"{m.__name__:14} {getattr(m, 'MODULE_VERSION', 'PRE-2.0 — STALE'):16} {m.__file__}")
```

All six must report the same version, from the folder you just pasted into. Anything else and
the run will refuse to start. `06_run_and_verify` runs this cell for all eleven modules (the six
above plus `panels`, `figures`, `tiles`, `import_bundle` and `csvstore`) and is the better place
to do it once the notebooks are up.

Run this cell rather than relying on the built-in guard alone. `run_pipeline` can only check the
modules it imports, so it catches a stale `config.py` or `metrics.py` — but if `run_pipeline.py`
is itself the stale file, there is no current code running to do the checking, and you get the
old behaviour with none of the diagnostics. The cell reads the versions directly and has no such
blind spot.

### 3a. From a notebook

```python
import sys
sys.path.insert(0, "/Workspace/Users/<you>/wiz-metrics")   # insert, not append -- see Layout

# The writable catalog -- `datalake_insight_analytics` without the prefix is read-only.
dbutils.widgets.text("catalog", "preprod_datalake_insight_analytics")
dbutils.widgets.text("schema", "industry")
dbutils.widgets.text("wiz_api_url", "https://api.eu15.app.wiz.io/graphql")
dbutils.widgets.text("secret_scope", "wiz")
dbutils.widgets.text("severities", "CRITICAL,HIGH")
dbutils.widgets.text("scope", "os")            # "sca" or "sast" for the code registers

from run_pipeline import main
main()
```

**After editing or re-pasting any module, restart Python — do not reload.**

```python
dbutils.library.restartPython()
```

Re-running the import cell changes nothing on its own, because Python caches imports. The
tempting fix is `importlib.reload` over the modules you think you changed, and it is worse than
doing nothing: it re-executes a module while every other module still holds references into the
old one, so `config`'s constants exist twice and a reload of `config` mid-import surfaces as
`ImportError: cannot import name 'SEVERITY_COLORS' from partially initialized module 'config'`.
It is also easy to leave a module out of the list — `ledger` is the one usually forgotten — which
recreates the mixed-version folder by another route. `restartPython()` has neither failure mode.

`<region>` elsewhere in this file is the one in your Wiz tenant URL (`us1`, `eu2`, …) — this
deployment's is **`eu15`**, as above. Get it wrong and auth succeeds but the GraphQL POST 404s.

`06_run_and_verify` is this cell with the version check, the table inventory and the consistency
checks around it, so once the notebooks are up there is no reason to paste it by hand.

### 3b. As a Databricks Asset Bundle

`brick/databricks.yml` deploys the whole thing as Databricks Jobs, defined once and pushed
together with the CLI:

```bash
databricks bundle deploy -t prod --var="catalog=<your-catalog>" \
  --var="wiz_api_url=https://api.<region>.app.wiz.io/graphql" \
  --var="node_type_id=<cloud-specific instance type>"
```

**Two jobs**: one scan job with three chained tasks, and one maintenance job. Every task is a
`spark_python_task` against `brick/run_pipeline.py`.

| Job | Cron (UTC) | Tasks | What it does |
| --- | --- | --- | --- |
| `wiz-scan` | daily 06:00 | `scan_os` → `scan_sca` → `scan_sast` | all three registers, one scan each |
| `wiz-maintain` | weekly, Sun 03:00 | `maintain` | `OPTIMIZE` over the two clustered tables, ingesting nothing — see [Maintenance](#maintenance) |

**One scan job, three chained tasks — not three separate jobs.** Every scope now writes into the
*same* `wiz_findings_raw` / `wiz_vuln_ledger` / `wiz_metrics`, and the ledger `MERGE` is not safe
to run concurrently against one target: two writers racing the same Delta table can each build a
plan against the other's not-yet-committed state. A job's own tasks run in `depends_on` order by
construction, so chaining the three scopes as tasks of one job — `scan_sca` `depends_on:
[scan_os]`, `scan_sast` `depends_on: [scan_sca]` — is what keeps the three `MERGE`s from ever
overlapping; `max_concurrent_runs: 1` on the job is the separate guard that keeps two *runs* of
that same chain from overlapping each other.

`run_if: ALL_DONE` on `scan_sca` and `scan_sast` — not the default `ALL_SUCCESS` — is what keeps
a failing scope from taking the other two down with it and from being blocked by one that failed
before it: the chain exists only to serialize the `MERGE`s, not to make one scope's health a
precondition for another's. If `scan_os` fails, `scan_sca` still runs; if `scan_sca` then also
fails, `scan_sast` still runs after it.

**`--scan_id={{job.run_id}}-<scope>`, not the bare `{{job.run_id}}` three separate jobs used to
pass.** `{{job.run_id}}` is the same value across all three tasks of one run — it names the
*job* run, not the task — so passing it unqualified would make `scan_sca`'s commit row in the
shared `wiz_metrics` collide with `scan_os`'s from the same run. `{{task.run_id}}` is
scope-distinct but changes on every *retry* of that task (it names the task run), which breaks
the idempotency guard in `recorded_scan`: a retried task would arrive with a new id, find no row
for it, and reconcile the same scan a second time. `{{job.run_id}}-<scope>` is both retry-stable
(constant across retries of a given task, exactly like the bare form it replaces) and
scope-distinct (one commit row per scope per job run) — see CLAUDE.md, "`{{task.run_id}}`
changes on a task retry".

A single-node cluster (`num_workers: 0`, the `singleNode` profile) is plenty for every task — the
driver does the API paging and the Spark work is a handful of aggregations over one scan. That
cron cadence is the one the ledger is built for: it advances once a day, so a disappearance is
dated to within 24 hours of when it happened. Scan more often and the dating gets tighter; scan
less often and `scan_ts` resolution gets coarser (or switch to `--disappearance=midpoint`).

**`wiz-maintain` runs once, not once per scope.** `maintain()` takes no `scope` and filters
none — `OPTIMIZE` lays out a whole table, and there is one table set now rather than three, so a
second run of the same job would rewrite the same two tables a second time for nothing. It still
requires `--scope=os` as a parameter, because `main()` resolves `--catalog`/`--schema` into
`Tables` before it ever checks `--maintain`, and `resolve_tables` needs *a* valid scope to
resolve against — `os` here is an arbitrary valid scope, not "the os register": the three tables
it names (`wiz_findings_raw`, `wiz_vuln_ledger`, `wiz_metrics`) are the same ones `--scope=sca`
or `--scope=sast` would name.

**Not validated here.** `databricks bundle validate` resolves a workspace and the current user,
so it cannot run in this repo's test environment; `brick/tests/test_bundle.py` checks the parts
that are checkable without one — the guards above (the chain, `ALL_DONE`, `max_concurrent_runs`,
the scope-suffixed scan id), and that every `python_file` and every `--scope` actually exists.
Run the real `validate` before deploying.

### Parameters

Resolved in this order: `--name=value` on the command line, then `dbutils.widgets.get(name)`,
then the `NAME` environment variable, then the default. One code path covers Jobs, notebooks
and a laptop.

| Name | Default | |
| --- | --- | --- |
| `catalog` | — | **required**, no default; `hive_metastore` on a workspace without Unity Catalog |
| `schema` | `wiz` | created only if it does not already exist |
| `scope` | `os` | `os`, `sca` or `sast` — see [Scopes](#scopes) |
| `table_prefix` | `wiz_` | pass empty to use bare table names |
| `project_id` | — | optional project restriction (`projectIdV2` / `projectId`, per scope) |
| `wiz_api_url` | — | **required**, `https://api.<region>.app.wiz.io/graphql` |
| `wiz_auth_url` | `https://auth.app.wiz.io/oauth/token` | override for a dedicated tenant |
| `secret_scope` | — | scope holding `wiz-client-id` / `wiz-client-secret` |
| `severities` | `CRITICAL,HIGH` | comma-separated; also recorded per scan and used by the disappearance guard |
| `scan_id` | a random id | pass `{{job.run_id}}-<scope>` on a scheduled Job, distinct per scope — see [Retries](#retries-are-safe-if-you-pass-scan_id) |
| `disappearance` | `scan_ts` | `scan_ts` or `midpoint` |
| `rebuild_ledger` | `false` | replay bronze and rebuild the ledger from scratch — see [Backfill](#backfilling-from-existing-bronze) |
| `shuffle_partitions` | `0` | `spark.sql.shuffle.partitions` for the run; `0` leaves the cluster's own setting alone |
| `maintain` | `false` | run `OPTIMIZE` over the clustered tables and exit, ingesting nothing — see [Maintenance](#maintenance) |
| `data_path` | — | write the register to this directory instead of a catalog — see [Fallback storage](#fallback-storage-running-with-no-catalog). With it set, `catalog` is not required |
| `export_csv` | — | write every table to this directory as typed CSV and exit, ingesting nothing — see [The CSV register](#the-csv-register-legacy) |
| `csv_path` | — | **make this directory the register**: restore it into Delta before the scan, export it back after. Implies no catalog, and a disposable Delta scratch — see [The CSV register](#the-csv-register-legacy) |
| `csv_include_bronze` | `false` | include bronze in the export. Large, and nothing reads it back |
| `csv_restore` | — | write a CSV export back out as the Delta register and exit. Overwrites — see [The CSV register](#the-csv-register-legacy) |

`shuffle_partitions` is the one parameter that changes nothing about any published number, and
it is unset by default on purpose. Spark's 200 is sized for a cluster moving real data, and a
run here is a few dozen aggregations over one scan on the single-node cluster this README
recommends — so a smaller number looks like free speed. Measured, it is not: over three runs a
side at 20,000 findings, `64` produced the fastest single run and the tightest spread but a
*worse* median than 200. Tune it against your own register with
[`bench_pipeline.py`](#benchmarking) rather than trusting either number.

### Retries are safe, if you pass `scan_id`

Reconciling one scan twice would advance every lifecycle a second time, so a retry must be
recognisable as a retry. Databricks retries a failed task **within the same run**, so
`--scan_id={{job.run_id}}-<scope>` makes the second attempt arrive with the id the first one
used — `{{job.run_id}}` is retry-stable and the `-<scope>` suffix is what keeps three scopes'
commit rows from colliding in the shared `…metrics`, now that they share one job run and one
table; see [3b. As a Databricks Asset Bundle](#3b-as-a-databricks-asset-bundle). The run then
finds its own `family='scan'` row in `…metrics` (`recorded_scan`, itself filtered to this
`scope`) and — unless that scan's gold went missing, in which case it republishes just that, see
[The scan record is load-bearing](#the-scan-record-is-load-bearing) — does nothing further.

Without it, `scan_id` is random and a retry looks like a brand-new scan. Also set
`"max_concurrent_runs": 1` so two runs of the same chain cannot reconcile against each other.

If a run dies *between* the ledger MERGE and the commit record, the next run detects it — the
ledger carries the scan id, `metrics` does not — and **refuses rather than double-counting**.
Recover with `--rebuild_ledger`.

**A failed ingest leaves partial bronze, and that is fine.** Findings are written to bronze in
batches as they are paged out of the API, rather than held in the driver until the sweep
finishes — a full register is hundreds of thousands of JSON documents and one list of all of
them is a driver problem waiting to happen. So a crash mid-sweep leaves the batches that
committed. Nothing reads them: bronze rows are only ever selected by a `scan_id` that has a
`family='scan'` row in `…metrics`, and a retry passing the same `--scan_id` clears them before
re-ingesting. A run that dies mid-ingest and is *never* retried leaves orphaned bronze rows,
which cost storage and nothing else.

### Maintenance

```bash
python brick/run_pipeline.py --catalog=<catalog> --scope=os --maintain=true \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

`--maintain` runs `OPTIMIZE` over the two [clustered tables](#table-layout) — shared by every
scope now — and exits without ingesting anything. It is what actually applies the clustering: a
table declares its layout at creation, but a write only *lays data out* above a size threshold no
single scan here reaches, so without this the spec is a promise nothing keeps. On a clustered
table `OPTIMIZE` clusters incrementally — it rewrites what is not already in place, not the
whole table.

**Run it as its own Job, weekly, once — not once per scope.** It is deliberately not part of the
daily scan: `OPTIMIZE` is an unbounded rewrite over the whole register, and the job that has to
finish before anyone can read this morning's number should not be queued behind it. It is also
deliberately not one job per scope any more: `maintain()` takes no `scope` and filters
none — there is one `wiz_vuln_ledger` and one `wiz_findings_raw` for all three registers, so a
second run of this job would rewrite the same two tables a second time for nothing. `wiz-maintain`
in the bundle above is that one job; `--scope=os` is still passed as a required parameter (see
[3b. As a Databricks Asset Bundle](#3b-as-a-databricks-asset-bundle)), not as a selector.

It does **not** `VACUUM`. That deletes the files time travel and any in-flight reader still
depend on, and choosing a retention window is a decision nobody has made here — see
[What this does not do](#what-this-does-not-do). `OPTIMIZE` only ever adds files, so the worst a
bad run of this can do is cost money.

On Unity Catalog managed tables you may not need it at all: Databricks **Predictive
Optimization** runs `OPTIMIZE` for you, and where it is enabled `--maintain` is redundant.

### Migrating an existing register

Everything above applies to tables created from now on. A register that already exists keeps its
unclustered layout — a clustering spec cannot be added by an append, and this pipeline will not
silently rewrite the physical layout of a production ledger on the next scheduled run.

Migrating is a handful of statements against the two clustered tables — `metrics` declares no
layout, so there is nothing to `ALTER` on it. Run them once, from a notebook or the SQL editor,
with the pipeline stopped:

```sql
ALTER TABLE <catalog>.<schema>.wiz_vuln_ledger CLUSTER BY (scope, vuln_key);
ALTER TABLE <catalog>.<schema>.wiz_vuln_ledger
  SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true');

ALTER TABLE <catalog>.<schema>.wiz_findings_raw CLUSTER BY (scope, scan_id);

OPTIMIZE <catalog>.<schema>.wiz_vuln_ledger;
OPTIMIZE <catalog>.<schema>.wiz_findings_raw;
```

One statement each now, not one per scope — the register is one shared table set, so there is
one `wiz_vuln_ledger` and one `wiz_findings_raw` to migrate, not three.
`run_pipeline.CLUSTERING`'s two-column tuples are exactly these `CLUSTER BY` lists.
**This recipe is documented, not measured**: no register ever ran the earlier per-scope table
layout (`wiz_os_vuln_ledger`, `wiz_sca_vuln_ledger`, …) against live data, so there is nothing
to migrate *from* in practice and this ALTER has never been run against a populated table.

Three things to know before you do:

- **Existing data is not reclustered until `OPTIMIZE` runs.** `ALTER TABLE` changes the spec,
  nothing else. Until then the layout is unchanged.
- **`ALTER TABLE` needs ownership or `MANAGE`**, which is more than the `MODIFY` the pipeline
  itself runs on — see the grant list in [Store the credentials](#1-store-the-credentials). This
  is an operator action, not something the service principal should be able to do.
- **The reader-version bump on the ledger is one-way** (see
  [Table layout](#table-layout)). Check what else reads that table first.

The alternative to all of it: `--rebuild_ledger` against a freshly created register replays
bronze into new, correctly-clustered tables — see below.

### Backfilling from existing bronze

If a register has been running against an older flat-snapshot version of this pipeline, bronze
already holds months of scans. `--rebuild_ledger` rebuilds **one scope** — the one named by
`--scope` — and leaves the other two untouched: it deletes that scope's rows of `metrics` (the
commit record and every gold family, not only the replayed `scan_id`s) along with that scope's
ledger rows, then replays that scope's bronze scans oldest-first through the same reconciler the
live path uses. Every statement it issues names `scope` for exactly the reason `reconcile_scan`'s
prior does — the ledger, bronze and `metrics` are shared by every register now, and an unscoped
`--rebuild_ledger` would be the single most destructive statement in this file, emptying two
registers that have nothing to do with the recovery being attempted:

```bash
python brick/run_pipeline.py --catalog=<catalog> --scope=os --rebuild_ledger=true \
  --severities=CRITICAL,HIGH --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Without it the ledger starts today: every finding's `first_seen` collapses to now and MTTR reads
as roughly zero until enough history accumulates.

**One caveat, and it matters.** The oldest scans never recorded which severities a scan asked
for, so replayed scans are assumed to have used the `--severities` you pass. If your history was
collected under a different scope, pass *that* scope — otherwise the replay will resolve-by-
disappearance severities the original scans never covered, and invent remediation that never
happened. Scans that already carry their own scope and severities are unaffected.

**It regenerates gold too, not only the ledger.** Each replayed scan reconciles, commits its
record, and then publishes its own gold from the ledger as it stood at that point in the replay
— the same three steps in the same order a live scan takes, because it is the same two
functions. That makes `metrics` a pure function of bronze plus the replay's `--severities`, and
it is the only way to put back a scan's gold once a later scan has moved the ledger past it (see
[The scan record is load-bearing](#the-scan-record-is-load-bearing)). It also means the cost is
per replayed scan rather than a single pass: a rebuild over a long history is a genuinely long
job, and is not something to run on a schedule.

The rebuild is idempotent, and `tests/test_ledger_pipeline.py` pins the invariant that matters:
replaying bronze lands exactly where running those scans live landed.

### Migrating from the Apps Script app

`--rebuild_ledger` only helps a deployment that already has bronze. A **new** deployment beside
a `gas/` app that has been scanning for months has none — and starting its ledger today is not
merely incomplete, it is wrong in the same four ways: `first_seen` collapses to now,
Kaplan–Meier reads near zero, capacity marks every earlier month `reconstructed`, and the
confusion matrix is computed over a population one scan deep. None of it looks like an error.

`import_bundle.py` seeds the ledger and the scan log from a **migration bundle** — the
`wiz-sidekick-migration` JSON that `wiz_dashboard/data/migrate.py` defines, the GAS app already
imports, and now exports too. This is **`os`-only in practice**: `gas/` has been reconciling a
daily OS-patching scan, so it is the only one of the three registers here with a matching
history to seed from. Nothing in `import_bundle.py` refuses a different `--scope` — `scope` is
stamped from the run the same way every other write is, and there is no bundle format for
`sca` or `sast` to check against yet — but there is no `gas_devsecops/` export today that would
give one a history to import.

```
GAS  Data → Migration bundle (Drive)        →  migration-<ts>.json.gz
     upload to a Unity Catalog volume       →  /Volumes/<cat>/<schema>/<vol>/migration-….json.gz
brick 07_import_gas  (or the CLI below)     →  wiz_vuln_ledger + the family='scan' rows of wiz_metrics
     06_run_and_verify, one scan            →  the gold families, from real lifetimes
```

```bash
python brick/import_bundle.py --catalog=<catalog> --schema=<schema> --scope=os \
  --bundle_path=/Volumes/<catalog>/<schema>/<volume>/migration-20260811T000000Z.json.gz
```

**A bundle is one scope's register**, and the import is scoped to it. `wiz_vuln_ledger`,
`wiz_findings_raw` and `wiz_metrics` are shared by every scope now, so the importer reads and
writes only the rows carrying `--scope`'s value: it seeds an **empty** register (this scope
holding nothing — the ledger, or any row of `metrics`, commit record or gold alike) and refuses
otherwise. Merging a seed into a register that has already scanned would re-open lifecycles it
has since resolved, and appending an older scan log beside this pipeline's own would hand the
disappearance guard the wrong previous scan — and with three scopes in one table set, an
unscoped refusal check or an unscoped delete would answer for, or empty, registers that have
nothing to do with the import being run.

`--force_import=true` **replaces this scope's register**, not merely its ledger, and never
touches the other two scopes' rows. Gold is why: it is appended per scan and computed from the
ledger *as it stood at that scan*, so gold rows written before a seed were derived from a ledger
that started empty. Left in place they sit in `04_scan_history` as a run whose MTTR reads near
zero, beside seeded runs where it does not — a contradiction with nothing on the page to explain
it. So a forced import empties this scope's bronze and this scope's share of the *whole*
`metrics` table — the scan log and every gold family together, since they now share one table —
and this scope's register genuinely restarts from the imported history. Re-scan to repopulate
them.

They are emptied rather than dropped: `DELETE` needs only `MODIFY` and keeps each table's
grants, where `DROP` needs ownership and would take the grants with it.

**If the import stops with "No write access"**, that is Unity Catalog, not the bundle. A
`DELETE … WHERE 1=0` probe runs before the expensive work precisely so the refusal names the
grant instead of surfacing as a `Py4JJavaError` at `saveAsTable` some jobs later. Note that
overwriting is not a way around it — UC gives a table's owner `MODIFY` implicitly, so being
refused it means this principal does not own the table, and replacing or dropping needs
ownership or `MANAGE`, a strictly higher bar. Grant at the schema, because the first scan after
the import creates the one remaining table, bronze:

```sql
GRANT USE CATALOG ON CATALOG <catalog> TO `<principal>`;
GRANT USE SCHEMA, SELECT, MODIFY, CREATE TABLE ON SCHEMA <catalog>.<schema> TO `<principal>`;
```

**The two parameters that must match GAS**, because getting either wrong invents remediation
that never happened:

| | |
| --- | --- |
| `--severities` | the scope GAS was scanning. Absence of a severity nobody looked for is not a fix — the same caveat the bronze rebuild carries |
| `--project_id` | GAS's `WIZ_PROJECT_ID_V2`. GAS scans one Wiz project; `--scope=os` pins none unless asked. A wider or narrower population resolves-by-disappearance everything outside the overlap on the first run |

Read `resolved_count` in that first run's summary before anything else. A plausible day's
remediation means the handoff worked; a number close to the whole register means the populations
disagree, and the fix is to re-import with corrected parameters rather than accept it — after a
second run the mistake is indistinguishable from a real mass closure.

#### What comes across, and what does not

`config.LEDGER_COLUMNS` was written to mirror `gas/src/domain/reconcile.ts`'s list, so 23 of
GAS's 24 ledger columns map 1:1 — including the vendor-fix clock and the exploit signals, which
cannot be recovered afterwards because a finding resolved by disappearance is gone from the API
entirely. Sealed `resolved_episodes` are folded in as ordinary RESOLVED rows, mirroring
`ledgerCore.baseRows`, which unions them at read time: that union is the population GAS's own
coverage and MTTR are computed over, so importing only the live ledger would shrink both.

| Not carried | |
| --- | --- |
| `tags_json` | ingest selects no asset tags, so nothing downstream would read it — and domain triage is unavailable here either way |
| a back-dated actionable clock | `fix_date` / `fix_observed_at` arrive and are read (see [The actionable clock](#the-actionable-clock)), but the bundle carries no fix history beyond what each lifecycle's last observation held |
| bronze, and therefore a back-dated gold trend | the bundle holds reconciled lifecycles, not raw findings. The `family='scan'` rows of `wiz_metrics`, filtered to this scope, show the imported runs; the gold families begin accumulating from the first live run |
| `mttr_history` | GAS's precomputed daily KPI series. It rides in the bundle and this pipeline has no table for it |
| several episodes for one `vuln_key` | this ledger is one row per key, so the most recently resolved wins; the import counts the rest |

Two things survive the import but not a **re-scan**, and both are worth knowing before reading a
severity breakdown. GAS heals a blank severity from `vendorSeverity` / `nvdSeverity`
(`gas/src/domain/severity.ts::effectiveSeverity`), and this pipeline's `ingest` queries neither
field, so such a row will read `UNKNOWN` after its next scan — and `UNKNOWN` has no
`SLA_TARGETS` entry. GAS likewise falls back `firstDetectedAt → firstSeenAt → createdAt` where
this pipeline reads only the first.

**The `h:` caveat.** `vuln_key` is `id:<wiz finding id>` when the API gave one and a hash
otherwise, and the hash basis includes `component`, which GAS never persisted. An imported `h:`
row is therefore re-keyed by the next scan and starts a second lifecycle. Only findings with no
Wiz id are affected, which is why the import prints the `h:` count — that number is the blast
radius, and it is usually zero.

### 4. Read the results

```sql
SELECT severity, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM   <catalog>.<schema>.wiz_metrics
WHERE  scope   = 'os'
AND    family  = 'program'
AND    scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_metrics
  WHERE scope = 'os' AND family = 'program'
)
ORDER BY severity;
```

`scope = 'os'` is not optional here: `wiz_metrics` is shared by every register now, and a query
that drops it sums three populations' `program` rows into one plausible-looking answer instead
of raising. Every recipe in this README that means to read *one* register against `wiz_metrics`,
`wiz_vuln_ledger` or `wiz_findings_raw` carries this predicate for that reason — the one
exception is the multi-scope comparison directly below, which deliberately groups by `scope`
instead of filtering it.

Read that against `prevalence_pct` on the same row, not against the P2P baselines — see
[Reading coverage and efficiency](#reading-coverage-and-efficiency). How much of it is the rule
is not a table to query: nothing named `metrics_sensitivity` is published — the sweep is on the
notebook page, not in the register. `panels.rule_sweep(spark, ctx)` recomputes coverage and
efficiency under each of the seven non-empty signal subsets from `v_lifecycles` at read time,
and `02_program_performance` is where it renders.

The run itself prints the `mttr` and `program` families by severity — MTTR/SLA and coverage and
efficiency with the rule-sensitivity sweep beside them (recomputed, not read back from a table)
— and the most recent `capacity` months for each population.

To read the numbers rather than query them, open the [notebooks](#notebooks).

Once more than one scope is running, compare them on the `scope` column — one shared table, no
`UNION ALL` needed, because every scope's rows already sit side by side in it, each of the
scan's own `scope`:

```sql
SELECT scope, coverage_pct, efficiency_pct
FROM   <catalog>.<schema>.wiz_metrics
WHERE  family = 'program' AND severity = 'OVERALL'
AND    scan_id IN (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_metrics
  WHERE family = 'program' GROUP BY scope
)
ORDER BY scope;
```

Start with `--severities=CRITICAL` on the first run: it is the fastest way to confirm the tables
land before pulling the whole register.

## Running it locally

```bash
pip install -r brick/requirements.txt
export WIZ_CLIENT_ID=... WIZ_CLIENT_SECRET=...
python brick/run_pipeline.py --scope=os \
  --catalog=hive_metastore --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Off Databricks the `dbutils` accessors return empty rather than raising, so credentials come
from the environment.

**Three-level names work locally.** Measured (Spark 3.5.9, delta-spark 3.3.3): the test session
installs `DeltaCatalog` **as** `spark_catalog`, so `spark_catalog.<schema>` is a writable
three-level namespace, and `saveAsTable`, `MERGE INTO`, `CREATE TABLE … CLUSTER BY`, `DELETE`,
`OPTIMIZE`, `table_exists` and `databaseExists` all take it — two full scans of a committed
fixture land under three-part names with clustering and deletion vectors intact
(`tests/test_catalog_mode.py`).

What is true is narrower, and worth knowing before you pass `--catalog=hive_metastore`:

- a **named** catalog with no plugin behind it is refused by the session catalog with
  `[REQUIRES_SINGLE_PART_NAMESPACE] spark_catalog requires a single-part namespace`, and it
  never reports "not found" — `databaseExists` returns `False` silently and `CREATE SCHEMA`
  dies inside Spark's own error formatter (`_LEGACY_ERROR_TEMP_1055`), which `ensure_schema`
  then re-raises as a CREATE-SCHEMA *grant* problem it is not;
- delta-spark's Python builder is the one call that genuinely cannot: `DeltaTable
  .createIfNotExists(spark).tableName("a.b.c")` parses a two-part identifier and dies on the
  second dot with `[PARSE_SYNTAX_ERROR] … pos 22`, before any catalog is consulted. That is
  `create_clustered`, which is why the local harness pre-creates the clustered tables by SQL
  DDL and lets `ensure_tables` no-op past them (`devlake/lake.py::precreate_clustered`).

## Running it against a local lake

The whole pipeline runs on a laptop against a directory that mirrors the catalog layout — real
Delta, real `MERGE`, the real `main()`, and the shipped notebooks — with a fake Wiz in front of
it. That is `devlake/`, at the repo root; see [`devlake/README.md`](../devlake/README.md).

```bash
pip install -r brick/requirements.txt -r devlake/requirements.txt
python -m devlake.run --scope=os   --scans=2 --lake=/tmp/lakecheck
python -m devlake.run --scope=sca  --scans=2 --lake=/tmp/lakecheck
python -m devlake.run --scope=sast --scans=2 --lake=/tmp/lakecheck
```

Two scans rather than one on purpose: the second is truncated so a finding **disappears**, which
is the branch that dates most remediations and the one most likely to be wrong. Tables land at
`<lake>/<schema>.db/<prefix><name>` — Spark's own warehouse convention, which is the
`catalog.schema.table` mirror in Spark's spelling — and `devlake.lake.reregister` re-registers
every directory holding a `_delta_log` on the next boot, so the lake survives a session restart.
That re-registration is this file's own `CREATE TABLE … USING DELTA LOCATION` recipe (see
[Moving it into the lake later](#moving-it-into-the-lake-later)), run on every start.

Nothing reaches Wiz: `devlake/fakewiz.py` patches `ingest._post`, keeps the real `build_filter`,
the real cursor walk and the real `seq` ordering, and **refuses a filter of the wrong shape**
with the GraphQL 400 the live API would return — so a scope whose severity filter regressed to a
bare list fails loudly here instead of fetching zero rows and looking like an empty register.

To read the lake without Spark, DuckDB's `delta` extension reads it directly, deletion vectors
and all (measured on duckdb 1.5.5, row counts equal to Spark's):

```sql
INSTALL delta; LOAD delta;
SELECT severity, km_median, mttr_actionable_median
FROM   delta_scan('file:///tmp/lakecheck/wiz.db/wiz_metrics')
WHERE  scope = 'os' AND family = 'mttr';
```

`wiz_metrics` is the one table all three `devlake.run` invocations above wrote into — `scope`
picks the register out of it, the same predicate every SQL recipe in this README carries against
the shared tables.

To open the notebooks, `jupyter lab` from `notebooks/` with `devlake/kernel_startup.py` on
`IPYTHONDIR` — it supplies `dbutils`, `spark`, `display`, `displayHTML` and the `%sql` cell
rule, so the shipped notebooks run unedited. The mechanics and the env vars are in
`devlake/README.md`.

## Fallback storage: running with no catalog

> **Prefer catalog mode.** Everything below exists for a deployment that has nowhere to create
> tables. If this principal has a schema it may write, use
> [Running on Databricks](#running-on-databricks) — the catalog is the supported home for
> the register and the only one the bundle deploys against.

A proof of concept usually has nowhere to put tables — no catalog and schema this principal may
create in. `--data_path` runs the whole pipeline against a **directory** instead:

```bash
python brick/run_pipeline.py --scope=os \
  --data_path=/Volumes/<catalog>/<schema>/<volume>/brick \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

`--catalog` is not required in this mode; that is the point of it. Each table becomes a
directory under the root, named exactly as the catalog-backed table would be
(`brick/wiz_vuln_ledger`, `brick/wiz_findings_raw`, …) — shared by every scope, exactly as the
catalog-backed tables are, with `scope` still the column that separates the registers — and
every reference the code passes to Spark becomes ``delta.`<root>/<name>` ``, which is valid
anywhere a table name is.

Set the same value in the `data_path` widget and notebooks 00–05 read the register from there.

**It is still Delta.** Types survive, NULL stays distinct from false, the ledger is still
`MERGE`d, and the clustering and deletion vectors from [Table layout](#table-layout) are
declared exactly as they would be in a catalog. Nothing about the register is degraded by not
having a catalog — the catalog was only ever the name.

**Silver is never stored, in any mode** — not just this one. It is a pure per-scan projection of
bronze, computed in memory and re-derived by anything that needs it later
(`panels._silver_frame` calls the same `metrics.silver_findings` / `metrics.silver_sast` the
pipeline uses); keeping it would be a second copy of data the register already holds. Bronze is
the table that must survive: `--rebuild_ledger` replays it, and everything else — the ledger,
the commit record, gold — follows.

### Where the path must point

Two things have to be true: it persists, **and Spark executors can write to it**. Every write
here is a distributed Delta write, which rules out one option that otherwise looks ideal.

| | works | why |
| --- | --- | --- |
| `/Volumes/<cat>/<sch>/<vol>/…` | ✅ | needs a Unity Catalog **volume** — a much smaller ask than a schema you can create tables in, and Databricks' own recommendation for non-tabular data |
| `dbfs:/…` | ✅ | where DBFS root still exists. Deprecated, and new workspaces are provisioned without it |
| `s3://…`, `abfss://…`, `gs://…` | ✅ | needs credentials or an external location, but no catalog at all |
| `/Workspace/…` | ❌ | persists, needs no catalog — and [**executors cannot write to workspace files**](https://docs.databricks.com/aws/en/files/workspace) |
| `/tmp`, `/local_disk0`, relative | ❌ | wiped when the cluster terminates |

`--data_path` **refuses** the last two rather than warning, because both failures are late and
land on the data. An ephemeral path loses the register silently, overnight, and is discovered
exactly when somebody first wants the history. `/Workspace` is subtler and worse: it can appear
to work on a single-node cluster, where the driver *is* the executor, and then break the moment
the cluster is scaled — and workspace file permissions expire anyway (36 hours on interactive
compute, 30 days for jobs), which disqualifies it as somewhere data lives. Its 500 MB cap is per
file and would probably not have been the binding constraint; the executor rule is.

Off Databricks the ephemeral prefixes are ordinary directories and are allowed, which is what
lets the tests use a temporary one. `/Workspace` is refused everywhere: there is no local sense
in which it is a reasonable home for this.

**If none of the ✅ rows is available to you**, run the pipeline off-cluster instead — a laptop
or a small VM, `python brick/run_pipeline.py --scope=os --data_path=/some/local/dir`. The driver
does the API paging and the Spark work is a handful of aggregations over one scan, so nothing is
lost by not being on a cluster. See [Running it locally](#running-it-locally).

### Moving it into the lake later

When a real catalog arrives, register each directory as an external table. No copy, no replay —
**three statements total, not three per scope**, because a `--data_path` directory holds one
shared table set for every scope exactly as a catalog does:

```sql
CREATE TABLE <catalog>.<schema>.wiz_vuln_ledger  USING DELTA LOCATION '<root>/wiz_vuln_ledger';
CREATE TABLE <catalog>.<schema>.wiz_findings_raw USING DELTA LOCATION '<root>/wiz_findings_raw';
CREATE TABLE <catalog>.<schema>.wiz_metrics      USING DELTA LOCATION '<root>/wiz_metrics';
```

Then drop `--data_path`, pass `--catalog` and `--schema`, and the next scan of any scope
continues the same ledger. The rows, the clustering columns, the deletion-vector property and
the full history all come across, because they live in the Delta log rather than in the
metastore — `test_the_register_migrates_into_a_catalog_without_losing_anything` is that
paragraph as a test, including that the migrated ledger still accepts a `MERGE`.

Silver has no directory to register — it is never stored, in any mode.

If a path ever has to be rebuilt rather than registered — a directory copied between accounts,
say — `--rebuild_ledger` replays bronze into a fresh register and lands where the live scans
landed.

## The CSV register (legacy)

**Why it exists:** this deployment's service principal had no schema it could create tables in
and no volume to write to, so the register had to live somewhere that needed neither. **What
obsoletes it:** a schema with `CREATE TABLE` on it. Once that grant exists, migrate to catalog
mode and leave this section behind — it is kept because a register currently running on it must
still be readable, not because it is a good place for one.

A deployment with no catalog it may create tables in **and** no Unity Catalog volume has nowhere
for the ✅ rows above to point. `csvstore.py` is the answer that deployment actually runs on:
**the register is a directory of CSV files under `/Workspace`**, and nothing durable is written
to the lake at all.

```bash
# The usual shape: the CSV directory is the register.
python brick/run_pipeline.py --scope=os \
  --csv_path=/Workspace/Users/<you>/wiz/csv_export \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Then point the read-only notebooks at the same directory by setting the **`csv_path` widget**.
That is the whole of the reader's side: `csvstore.load` registers each table as a session temp
view named exactly as the table would be, and a temp view is valid anywhere Spark wants a table
— the same trick `` delta.`<path>` `` plays — so every view, every panel and every `%sql` cell
works untouched.

**One CSV directory carries every scope's register, same as a shared Delta table does.**
`csvstore.export`/`csvstore.load` write and read `wiz_findings_raw` / `wiz_vuln_ledger` /
`wiz_metrics` whole, with no scope filter of their own — so an `os` scan and an `sca` scan
pointed at the same `--csv_path` both land in the one export, and `panels.context()` filters
`scope` on the loaded views exactly as it does against Delta. Only the **scratch** Delta side
underneath a given run stays per-scope (`dbfs:/tmp/wiz_scratch_<scope>` by default): two scopes
scanning at once each need their own disposable Delta to `MERGE` into, but restore/export still
round-trips the one shared CSV register between them.

**Why it is not `spark.read.csv`.** Every write Spark does is distributed, and *executors cannot
write to workspace files* — which is also why `--data_path` refuses `/Workspace` outright. So
everything in `csvstore` is driver-side: `toPandas`, `open()`, `csv`. That is what makes
`/Workspace` a legal destination for the CSV even though it is an illegal one for Delta.

### Restore before, export after

**The register is CSV; Delta is scratch for the length of one run.** There is no way to make
Delta optional outright: the ledger is `MERGE`d on every scan and read back to compute the gold
tables, and a CSV file cannot be merged into. So `--csv_path` brackets the scan —

1. **restore** the CSV export into Delta, before `ensure_tables`, so last run's lifecycles are in
   the ledger this run's reconcile reads. Without this every scan starts from an empty register
   and resolves nothing;
2. run the scan exactly as it always does;
3. **export** back to the same directory, last thing.

The Delta side is deliberately disposable. With `--csv_path` set and no `--data_path`, it
defaults to `dbfs:/tmp/wiz_scratch_<scope>` and the ephemeral-path refusal is *waived* — the
guard exists because a register on ephemeral disk is lost overnight and discovered missing when
somebody wants the history, and here there is no history in Delta to lose. Losing the scratch
costs one restore.

**With `--csv_path` set, no catalog is ever consulted.** Not "no catalog by default":
`resolve_namespace()` is not called at all, because falling through to it is exactly how a run
meant to write CSV creates empty Delta tables in a production catalog instead.

The first run has nothing to restore from. That is not an error — a missing manifest means an
empty register, the run prints a note and carries on, and after it the directory exists.

| you set | the register is | Delta is |
| --- | --- | --- |
| `--csv_path=/Workspace/…` | **the CSV directory** | per-run scratch on `dbfs:/tmp` |
| `--csv_path` **and** `--data_path=<durable>` | the CSV directory | a durable mirror, kept between runs |
| `--data_path=<dir>` alone | that Delta directory | the register |
| `catalog` / `schema`, neither flag | **Delta tables in that catalog** | the register |

The last row is the one to be deliberate about: with neither flag set the run creates and writes
tables in the catalog — and so does opening a read notebook, because `panels.context` calls
`ensure_tables()`. If the intention is to stay out of the lake, **set the `csv_path` widget**;
cell 1 and the run cell both read it, so they cannot disagree about where the register is.

Two other flags remain, and both exit without scanning: `--export_csv=<dir>` copies an existing
Delta register out once, and `--csv_restore=<dir>` writes a CSV export back out as Delta,
overwriting. They are the one-shot halves of what `--csv_path` does on every run.

### The manifest, which is how a torn write is caught

A Delta commit is atomic. A directory of CSVs and sidecars, which a notebook may be reading while
a job rewrites it, is not. `_manifest.json` is written **last** by every export and checked by
every load: it carries the module version and a row count per table.

It cannot make the write atomic. It can make a torn one *detectable*: a row count that disagrees
raises rather than quietly restoring a register missing half its ledger. An export with **no**
manifest is read unverified rather than refused — one written by an older version is not
automatically torn, and the failure worth catching is silence about a register that is.
`tests/test_csvstore.py` pins both halves of that.

### The schema sidecar, which is the other whole point

Each table is written as **two** files: `<table>.csv` and `<table>.schema.json`, the Spark schema
verbatim. Reading goes back through that schema rather than through inference.

CSV has no types. A blank cell is indistinguishable from an empty string, and Spark's own
behaviour on that has changed across releases
([SPARK-17916](https://issues.apache.org/jira/browse/SPARK-17916)). That ambiguity lands exactly
on `has_kev` / `has_exploit` / `epss`, where — per
[Three things that are easy to get wrong](#three-things-that-are-easy-to-get-wrong) — a NULL read
back as `false` inflates efficiency and deflates coverage at the same time, silently.

`tests/test_csvstore.py` is that paragraph as a test: the confusion matrix over a reloaded
register must be identical to the one over the Delta tables it came from.

### What it does and does not carry

| | |
| --- | --- |
| **Bronze is excluded by default** | one JSON document per finding: the only table big enough to hit the workspace 500 MB per-file cap, and the only one nothing reads except `--rebuild_ledger`. `--csv_include_bronze=true` opts in — and **without it `--rebuild_ledger` has nothing to replay** in CSV-register mode, because the scratch Delta directory it would read is a fresh one |
| **Arrays and structs are refused** | nothing in this register has one, and inventing a rendering that round-trips is worse than failing |
| **No history, no clustering, no deletion vectors** | those live in the Delta log, and the log is the thing being thrown away each run. What the CSV carries is the current rows, which is what every metric reads |

**Not how you migrate a register that is intact.** If the Delta side *is* the register — the
`--data_path` / catalog rows above — what you migrate is the Delta directory:
`CREATE TABLE … USING DELTA LOCATION` keeps the clustering, the deletion-vector property and the
full history. The CSV round-trip is for the deployment where CSV is the register in the first
place.

### One thing about the workspace path, said once

`/Workspace` file permissions **expire** — 36 hours on interactive compute, 30 days for jobs.
That is a limit on *access*, not on the bytes, and it is the reason to keep a copy of the CSV
directory somewhere outside the workspace if the history matters. Everything else in this mode
is designed to be lost and restored; that directory is not.

## Tests

```bash
pip install -r brick/requirements.txt
pytest brick/tests -n 3 --dist loadgroup -q
```

One suite, one process, across all three scopes — there is no second fork to run separately any
more. They spin up a local `SparkSession`; the module skips cleanly if pyspark isn't installed.
The root `pyproject.toml` deliberately does **not** collect `brick/tests` — the main suite must
not start depending on Spark.

`delta-spark` is needed for the ledger tests; without it they skip and the pure-transform tests
still run. All the tests share one `SparkSession` from `tests/conftest.py`, because Delta's SQL
extensions can only be installed when a session is built and `getOrCreate()` returns whatever
already exists — leaving each module to make its own meant the first module alphabetically
decided whether the suite could use Delta.

**On the parallel run.** Each worker gets its own `SparkSession`, its own in-memory catalog and
its own warehouse directory, so nothing they do can collide — which means how tests are spread
across them is only ever a question of cost. `--dist loadgroup` is what lets `conftest.py`
answer it: it pins `test_panels` and `test_notebooks` to one worker, because both read the
session-scoped `live_tables` and session-scoped means *once per worker*, so splitting them would
build the whole live register twice. Everything else is left unpinned and handed out per test —
including the two heaviest modules, `test_ledger_pipeline` and `test_import_bundle`, which build
a private database per test and so parallelise all the way down.

A worker is a whole JVM, not a thread, and a `local[1]` Spark session still runs a scheduler, a
listener bus and its own garbage collector — so it wants appreciably more than one core, and
`-n auto` oversubscribes a small machine. On a four-core box `-n 3` measured faster than
`-n auto`; on a larger one `auto` is fine. The heap is sized for this too: `conftest.py` asks
for 4g when it is the only session and 3g per worker when it is not (2g ran out of Java heap on the
3.0 suite around stage 11,000; 3g finishes clean), because four workers at 4g
want 16g and the swapping costs more than the parallelism returns.

The one thing that does not parallelise is the first-ever run after `DELTA_PACKAGE` in
`conftest.py` changes: `--packages` resolves the jars through Ivy into a shared `~/.ivy2`, and
several workers populating a cold cache at once can race. Run the suite serially once after
bumping that version, then in parallel thereafter. `tests/test_pins.py` guards the version pair
itself: `delta-spark`'s installed version must equal the jar version pinned in `conftest.py`,
because the two ship from one release and a floor is not enough — Spark 3.5.6 changed a plain
`overwrite`-mode `saveAsTable` to compile against Delta's staged V2 table, and only delta-spark
3.3.3's `StagedDeltaTableV2` advertises the capability that path needs.

Three modules — `test_figures.py`, `test_tiles.py` and `test_pipeline.py` — touch no Spark at
all (Plotly figures, HTML strings, and argument parsing against a fake session). Running just
those needs no JVM and takes seconds, which is the fast loop while working on that layer:

```bash
pytest brick/tests/test_figures.py brick/tests/test_tiles.py brick/tests/test_pipeline.py -q
```

The oracles are ported, not invented:

- the confusion-matrix block is the hand-counted 12-lifecycle register from
  `gas/test/program.test.ts` (TP=3, FP=3, FN=2, TN=2, one unclassified on each side →
  coverage 60%, efficiency 50%);
- the MTTR block is the `resolved_sample` case from `tests/test_metrics.py` (7.0 days median,
  100% in SLA against a 14-day HIGH target);
- **the lifecycle rules replay `gas/test/fixtures/reconcile.json`** — the golden fixture the
  TypeScript reconciler is tested against — scenario by scenario, comparing the resulting ledger
  and deltas field by field. Nothing about that fixture was written to suit this implementation,
  which is what makes it worth having;
- `vuln_key` is cross-checked against `wiz_dashboard.domain.lifecycle.vuln_key` over the
  committed Wiz response, so the surfaces provably agree on identity;
- one test replays the committed `os_vulns_response_exemple.json` end to end, so the real Wiz
  response shape is covered without a network call, and `tests/test_os_scope.py` pins the `os`
  filter shape against the same fixture family;
- `tests/test_devsecops.py` carries the code-register oracles: both silver projections emit the
  same columns, the CWE ancestor hop works, one missing signal makes a whole row unknown, and
  asking for resolved SAST findings would report zero-day MTTR — over `sca_findings_example.json`
  (synthetic: the captured `sca_response.json` is the *grouped* query, one row per repository
  with severity counts, and has no per-finding rows to drive a pipeline) and
  `sast_response.json`;
- **`test_csvstore.py`** asserts the confusion matrix over a CSV-reloaded register is identical
  to the one over the Delta tables it came from. A NULL exploit signal read back as `false`
  inflates efficiency and deflates coverage at once, so the round-trip is checked over every
  column rather than over the ones somebody thought to assert. It also scans, exports,
  **deletes the Delta directory outright** and scans again, asserting that lifecycles continue,
  `first_seen` does not collapse and a dropped finding still resolves by disappearance — the
  whole claim of `--csv_path`, and a claim whose failure mode in production is not an error but
  a register that looks healthy and is measuring nothing. See
  [The CSV register](#the-csv-register-legacy).

The rules that would be silently wrong rather than loudly broken were mutation-tested: removing
the disappearance previous-scan guard, the severity-scope guard, the scope guard on
`awaiting_vendor_fix`, the monotone risk merge, the peak-EPSS rule, the fix-clock reset on
reopen, and `first_seen`'s earliest-wins each fail the suite.

## Benchmarking

`bench_pipeline.py` is the measuring instrument for performance work on the pipeline. It builds
a synthetic register, drives it through the **real** `ingest_to_bronze` and `build_metrics` — the
API is stubbed, nothing else is — and reports wall-clock and Spark-job count per stage.

```bash
python brick/bench_pipeline.py --findings 20000 --scans 3 \
    --out before.json --dump before/          # on the revision you are measuring against
python brick/bench_pipeline.py --findings 20000 --scans 3 \
    --out after.json --dump after/ --compare before.json
diff -r before/ after/                        # must be empty
```

`--dump` writes every table as sorted JSON with the run's identity columns removed, so
`diff -r` answers the only question that matters about a performance change: **did any number
move?** An optimisation that cannot pass that diff is not an optimisation.

Two things to know before believing a result:

- **The absolute seconds are meaningless.** This is one local JVM; only the ratio between two
  runs of the same script on the same machine says anything.
- **Run it more than once.** The variance is large. A single pair of runs on a four-core box
  showed a 36% improvement for a change that three runs a side put at 8% — the first baseline
  run was simply slow. Report medians, and report the job counts too: seconds move with whatever
  else the machine is doing, "this scan submits 125 Spark jobs" does not.

`--attribute` additionally times each gold transform on its own, which is how you find out that
`rule_sensitivity`'s seven passes are ~1.5s of an ~85s run and therefore not the problem.

The session is built here rather than borrowed from `tests/conftest.py`, deliberately: conftest
sets `spark.sql.shuffle.partitions=1` and turns AQE off, which is right for thirty-row test
frames and would measure the wrong machine entirely.

## Notebooks

Nine `.ipynb` pages under `notebooks/`, mirroring the pages of the GAS apps, plus a one-shot
importer. Each answers one question with a headline, a small set of charts and a table you can
sort and export. Run a cell, get a metric and its visualisation.

| Notebook | The one question it answers |
| --- | --- |
| **`00_security_posture`** | How fast are we closing risk, how much is open right now, and is it getting worse? |
| **`01_mttr_sla`** | How long does a finding actually live once you stop excluding what is still open — and where is it slow? |
| **`02_program_performance`** | Is remediation effort landing on the findings that matter, and can we close faster than risk arrives? |
| **`03_os_vulnerabilities`** | What is exploitable on host workloads, where does risk concentrate, and what moved since the last scan? |
| **`03_code_vulnerabilities`** | The same question over library CVEs and static-analysis weaknesses |
| **`04_scan_history`** | What has actually been measured, when, and how has the register moved across those measurements? |
| **`05_estate`** | Can this register be attributed to an owner at all, and which parts of the estate carry the backlog? |
| **`06_run_and_verify`** | Is the deployment sound, can I run a scan, and are the tables consistent? |
| **`07_import_gas`** | Can this register start from the history the Apps Script app already has, instead of from today? |
| **`08_code_assets`** | Which repositories carry the backlog, which offer a foothold, and which are falling behind? |

`00`–`05` and `08` are **read-only about your data**. `06` is the only one that ingests, which
is deliberate: a page somebody opens to check a number should not be one Run All away from a
credentialed API sweep. `07` is the other writer, and it is meant to be run once, before the
first `os` scan — see
[Migrating from the Apps Script app](#migrating-from-the-apps-script-app).

The one exception, and it is not a data write: `panels.context()` calls
`run_pipeline.ensure_tables()`, so a deployment where the pipeline has never run creates the two
empty lifecycle tables instead of failing every view with `TABLE_OR_VIEW_NOT_FOUND` in cell 1.
It checks existence first, so in the normal case it needs nothing beyond `SELECT`. Pass
`ensure=False` to `context()` for a viewer that holds only `SELECT` on a never-scanned register.

A register with no scans then opens on **"No scan data yet"** rather than a traceback
(`tiles.scan_zone_from`). Every page's first cell goes through that helper: `last_scan(…).first()`
is `None` on an empty table, and the obvious `…first().asDict()` dies with an `AttributeError`
that a fresh deployment cannot tell apart from a broken install.

Two GAS pages have no analogue here and are absent rather than approximated. **Settings** — the
parameters are widgets and Job parameters, and the high-risk rules are `config.DEFAULT_RISK_RULE`
/ `config.SastRiskRule`, so changing them is a code change. **Data**'s import half — this
pipeline ingests from the Wiz API and has no CSV import path; the export half is the download
button on every result grid.

`05_estate` is GAS's **Attribution** page renamed rather than faked. GAS maps findings to
value-chain domains through configurable rules over subscriptions and asset tags. This pipeline
has no domain rules and `ingest.py` selects no asset tags for `os`, so there is nothing to
compute a coverage gap against there. The page says so and answers the nearest question the
register can actually support. Adding tags to `ingest.py` is the real fix.

> **`05_estate` is currently empty for `os`, and that is the honest reading.** See
> [The asset fields are not fetched](#the-asset-fields-are-not-fetched) — every column it groups
> on is NULL for that scope, so `panels.attributability` reports 0% populated. That is the page
> working, not the page broken: it exists to answer "can this register be attributed to an owner
> at all".

### The asset fields are not fetched

`config.FETCH_ASSET_FIELDS` is **False**. The live tenant no longer has the `vulnerableAsset`
union members `os`'s query used, and GraphQL rejects the *whole request* rather than the
sub-selection — so one unavailable field costs every scan. It is a constant rather than a
deletion: `ingest._asset_selection` and its member list are intact, so a tenant that still has
them turns the columns back on by flipping one line. `sca` sidesteps the problem entirely with
its own narrower member list — see [Scopes](#scopes) — which is why it has asset columns and
`os` does not.

| | |
| --- | --- |
| **NULL while it is off (`os`)** | `asset_id`, `asset_name`, `asset_type`, `cloud`, `subscription_name`, `subscription_ext_id` — so `05_estate`, the by-subscription breakdowns and `risk_mix` have nothing to group on |
| **Unaffected** | MTTR, SLA, coverage, efficiency, capacity, and the whole ledger. They read severity, status, timestamps and the exploit signals, none of which live on the asset |
| **Identity unaffected** | `vuln_key` prefers the Wiz finding id, which is still selected. Only the fallback hash uses asset fields, and it is not reached |

Bronze written before the flag still holds the asset JSON, so `--rebuild_ledger` over that
history repopulates those columns for the scans that captured them.

### The scan pin, and why there is a `panels.py`

The gold tables are appended, so **every read has to name a scan or it blends every run that has
ever happened into one entirely plausible chart.** Rather than repeat that predicate in every
cell and hope, the first cell of every notebook calls `panels.context(spark)`, which registers
session temp views that are already pinned, scope-filtered and severity-filtered:

```
v_mttr  v_program  v_capacity  v_assets  v_findings  v_scans  v_lifecycles   ← one scan
v_mttr_all  v_program_all  v_findings_all                                    ← deliberately not
```

**The `scope` widget is what picks the register, and it now does the whole of that job.**
Before the three scopes shared one table set, the widget mainly drove the API filter; which
*table* you were reading was mostly settled by `table_prefix`. With `wiz_findings_raw` /
`wiz_vuln_ledger` / `wiz_metrics` shared by every scope, `ctx.scope` (resolved from the widget by
`run_pipeline.resolve_scope`) is the **only** thing that turns the shared tables into one
register — every view above filters `scope = ctx.scope`, `panels.register_views`'s own
docstring says so is "now the only thing separating the three registers", and changing the
widget and re-running is how a reader moves from `os` to `sca` to `sast`, not a different
notebook path or a different table name.

`max_by(scan_id, scan_ts)` is written in exactly one function in the whole repo. The three
`_all` views are the only unpinned surface and are named so a reader can see it. The consequence
worth having: no SQL in any notebook interpolates a widget, so `tests/test_notebooks.py`
executes every shipped `%sql` cell **verbatim** against real pipeline output.

Two data facts the views correct on the way past, both of which the published tables carry:

- `OVERALL` is not a member of `SEVERITY_ORDER`, so a bare `severity IN (…)` filter deletes the
  row every headline reads. The views keep it explicitly — and note it cannot be narrowed by the
  severity widget, because the pipeline computed it once over everything that was scanned.
- `SLA_TARGETS` has no `UNKNOWN` key, so `mttr_days <= NULL` is NULL, `sum(when(…).otherwise(0))`
  turns that into a **0**, and `safe_pct` divides it into a confident `0.0%`. The views null it
  back out, and anything counting "open past SLA" drops rows with no target from both sides.

### Which engine draws what, and why

**Plotly** draws anything where the *drawing* carries the argument: a NULL that must be a gap, a
reference rule with a label, a staircase, direct labels, uncertainty bounds, or two series that
must differ by more than hue. Databricks renders it live in the cell — pan, hover, legend
toggling — so this is not the old static-PNG surface with a new library. It is also the only
layer where the two rules below can be *tested*: a `Figure` is an object a test can interrogate.

**The native chart editor** draws five things, all of them plain counts where the picker adds
something code cannot: two stacked bars, a 100% stacked bar, and two pivot tables. **The native
result grid** shows every table, because it sorts, filters, exports CSV and docks to a dashboard
better than anything this repo would write — GAS's drawers and pagers are that grid here.

**`displayHTML`** draws the surfaces where the number *is* the product: heroes, KPI bands,
severity tiles, the confusion matrix. Never tabular data.

Two conventions run through all of it, and both are enforced by tests rather than by review:

- **A NULL is drawn as an annotated gap, never a zero.** "No resolved findings yet" and "closed
  instantly" must not look the same. A filled line has the same problem in slower motion —
  Plotly closes the fill polygon down to zero either side of a gap — so a series containing a
  NULL loses its fill.
- **Severity is never carried by colour alone.** The palette is a heat ramp and it fails a
  categorical colourblind check: HIGH `#ea580c` and MEDIUM `#d97706` sit ΔE 1.6 apart under
  deuteranopia and 6.7 apart with normal vision. Every severity series carries its own marker
  shape, every mark is named by a tick or a label, and colour is redundant coding on top.

### The five native charts are not committed, and this is why

A Databricks result visualisation lives under an undocumented, version-dependent
`application/vnd.databricks.v1+*` key, partly in cell metadata and partly in cell output.
Nothing in this repo can author one correctly, and nothing in it could verify one if it did —
which is precisely the failure mode the generated `.lvdash.json` dashboard was deleted to
escape. So no visualisation JSON ships at all.

What ships instead, for each of the five, is:

1. a markdown line above the cell beginning `Chart ▸`, naming the exact fields to set;
2. the cell itself, whose **default rendering is already a correct, sortable, exportable table**.

**The one-time workspace step.** Open each notebook, *Run all*, then for every `Chart ▸` header
click **+ → Visualization** and set exactly the fields the recipe names. Then either:

- **(a)** leave the charts in the workspace copy and accept that a `git pull` may drop them —
  re-creating one is a fifteen-second mechanical act, because the recipe is committed; or
- **(b)** if a workspace admin has enabled *"Allow Git folders to export IPYNB outputs"*, commit
  the notebook back and the visualisation travels with it.

**(b) is workspace-configuration dependent and nothing in this repo can test it.** The failure is
bounded by construction, which is the point: if the visualisation is never created, or is
stripped on the way through Git, the reader sees a correct sorted table — never an error, never a
wrong chart. That is a strictly better failure than "the whole document is rejected", and it is
why only five of the visuals are native. The same *unverified UI guidance* caveat applies to the
menu paths in this section and to **Run accessed commands** below.

`tests/test_notebooks.py` parses every `Chart ▸` recipe and checks each column it names against
the producing panel's declared `OUTPUT_COLUMNS`, so the recipe cannot rot even though the chart
is not committed.

### Widgets

Every notebook declares the same base widgets — `catalog`, `schema`, `scope`, `table_prefix`,
`severities`, `scan_id`, `module_path` — plus its own page widgets. Set them before running
anything; `catalog` has no default for the reason given under
[Store the credentials](#1-store-the-credentials).

Two behaviours to know:

- **Set the notebook to "Run accessed commands"** if you want a widget change to re-run the
  cells that depend on it. Otherwise you change the filter and read a chart drawn under the old
  value, which is the notebook form of the honest-state rule.
- `table_prefix` takes the literal `-` for "no prefix at all". `run_pipeline.param` is
  `widget or env or default`, and an empty string is falsy — so a cleared widget means "use the
  default", not "use nothing".

### What was lost with the AI/BI dashboard

Two real capabilities, stated plainly rather than glossed:

- **Cross-filtering.** Clicking a severity in one chart and watching every other widget
  re-filter is now changing a widget and re-running.
- **The SQL-warehouse viewer path.** An AI/BI dashboard could be shared with someone who had
  only `SELECT` on the gold tables. A notebook needs a cluster to attach to.

What was gained is that every number on every page is now covered by a test that runs on a
laptop, and that the chart definitions are code rather than an undocumented JSON schema
reconstructed from exports.

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
- **`hasFix: true` is in the population** for `os` and `sca` (see [Scopes](#scopes)), so
  awaiting-vendor-fix findings are not in coverage's denominator there. Deliberate, and one more
  reason the published baselines are not comparable.
- **The matrix is cumulative and asset-weighted.** Every finding the ledger has ever seen is in
  it, so the appended per-scan series is a to-date curve, not a monthly one — a good quarter
  barely moves it. And one CVE on 5,000 hosts contributes 5,000 rows.

One more, from the ledger's [sticky signals](#the-ledger-and-why-it-exists): classification is
**not as-of**, for the two scopes whose exploit signals are monotone. A finding that reached KEV
in month six is counted high-risk in month one too. The bias is conservative — it can only move
findings into the high-risk population, never out — but it means the confusion matrix is
"classified with everything we know now", not "classified with what we knew then".

### The positive label is a further step removed for `sast`

`sast` has no CVE and therefore none of the signals the table above prices — its own rule and
its own reading are in [Scopes](#scopes). Restated as the same comparison:

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
(`tests/test_devsecops.py::test_static_analysis_is_never_awaiting_a_vendor_fix`). `os` and `sca`
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
  Compaction is no longer on this list — [`--maintain`](#maintenance) runs `OPTIMIZE` over the
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
  density and capacity figures yet — see [Assets at risk](#assets-at-risk-p2p-v5).
- **Two SAST-specific gaps live in [Scopes](#scopes) rather than here**, because they are
  properties of the *rule*, not the pipeline: `config.CWE_ANCESTORS` is measured-incomplete, and
  `aiAnalysis.verdict`'s enum spelling is unverified against the live tenant.
- **No per-register row-level security.** `os`, `sca` and `sast` share one table set, so a
  `GRANT SELECT` on it hands a reader every scope's rows; restricting a reader to one register
  needs a Unity Catalog row filter keyed on `scope`, and that recipe is documented in
  [1. Store the credentials](#1-store-the-credentials) rather than implemented or measured
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
