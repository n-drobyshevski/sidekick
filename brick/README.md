# `brick/` — vulnerability metrics on Databricks

A small Spark pipeline that pulls Wiz vulnerability findings into Delta, tracks each
vulnerability's lifecycle across scans in a persistent ledger, and computes four metric families
as query-able gold tables:

| Metric | Question it answers | Formula |
| --- | --- | --- |
| **MTTR / SLA** | How fast are we closing risk? | Kaplan–Meier median over `resolved_at − first_seen`, counting still-open findings as right-censored; in-SLA is `mttr_days <= target` |
| **Coverage** | Of all high-risk vulnerabilities, what share did we remediate? | `TP / (TP + FN)` |
| **Efficiency** | Of everything we remediated, what share was actually high-risk? | `TP / (TP + FP)` |
| **Capacity** | Can we close faster than risk arrives? | monthly `closed / open_at_start`, and `closed − opened` |

Coverage and efficiency come from the Cisco Kenna / Cyentia *Prioritization to Prediction*
series. They are in direct tension, so the pipeline always emits both, never one alone — and
P2P is the source of the **formulas**, not a benchmark these numbers can be read against. See
[Reading coverage and efficiency](#reading-coverage-and-efficiency), which is the section to
read before quoting either figure to anyone.

Those lifecycles are the difference between this and the pipeline's first version: metrics come
from what the register has been observed to do over time, not from whatever the latest snapshot
happens to say. See [The ledger, and why v2 exists](#the-ledger-and-why-v2-exists).

This is a third surface over the same register as the Streamlit app and the Apps Script
rebuild, not a replacement for either. `gas/` is the most complete of the three and is the
reference implementation: the lifecycle rules are ported from `gas/src/domain/reconcile.ts`, the
P2P family from `gas/src/domain/program.ts`, and Kaplan–Meier from
`gas/src/domain/remediation.ts`. Where GAS and the older `wiz_dashboard/domain/` port disagree,
GAS wins.

## Layout

```
config.py         constants mirrored from wiz_dashboard/config.py + the risk rule and scopes
dbx.py            reaching dbutils from inside a module, and doing without it off-cluster
ingest.py         Wiz OAuth + paginated GraphQL -> raw finding dicts
ledger.py         pure PySpark cross-scan lifecycle reconciliation (no I/O)
metrics.py        pure PySpark DataFrame -> DataFrame transforms (no I/O)
run_pipeline.py   the Databricks entry point: bronze -> silver -> ledger -> three gold tables

import_bundle.py  one-shot: seed the ledger from a gas/ migration bundle

panels.py         every number a notebook shows, and the one place that pins the scan
figures.py        pandas -> Plotly figures, drawn the way the GAS app draws them
tiles.py          HTML fragments for displayHTML: heroes, KPI bands, the confusion matrix
notebooks/        seven .ipynb pages, one per page of the GAS app

tests/            local-SparkSession tests, oracles ported from the existing suites
bench_pipeline.py a synthetic register, timed through the real entry points — see Benchmarking
```

`ledger.py` and `metrics.py` are pure `DataFrame -> DataFrame`; `run_pipeline.py` is the only
module that does I/O. That is what lets the lifecycle rules — the part most likely to be wrong —
be tested against a local `SparkSession` with no Delta table, no cluster and no API in the way.

The presentation layer keeps the same discipline one level up: `panels.py` is Spark in and a
small frame out, `figures.py` is pandas in and a `Figure` out, `tiles.py` is a value in and a
string out. None of them renders anything except through one function each, which is what makes
the whole UI testable without a workspace. See [Notebooks](#notebooks).

**These are plain top-level modules, not a package.** There is no `__init__.py`, and they
import each other by bare name (`import metrics`, `from config import …`). Whatever directory
holds them goes on `sys.path`. That is what lets the Databricks side be a single flat folder of
files, with no nesting to reproduce by hand and no package prefix to keep in sync.

The consequence to know about: **all nine are generic module names** — `config`, `metrics` and
`ingest` obviously so, and `panels`, `figures` and `tiles` even more plausibly, since they are
exactly what someone else's unrelated workspace file might be called. Put the directory **first**
on `sys.path` (`sys.path.insert(0, …)`, not `append`) so a same-named module elsewhere cannot
win — that would fail as a confusing `AttributeError` rather than an import error. Every
notebook's first cell does this, and `06_run_and_verify` prints the `__file__` each module
actually came from.

`brick/` never imports `wiz_dashboard` — a Spark cluster has neither that package nor
Streamlit. The shared constants are duplicated on purpose; `config.py` names its sources.

## The ledger, and why v2 exists

v1 measured each scan in isolation: a run pulled findings and computed everything from that one
snapshot's `firstDetectedAt` / `resolvedAt`. Runs accumulated as separate `scan_id`s, but nothing
reconciled one against the next.

That gets one thing badly wrong. **Wiz stops returning a finding once it is remediated, and often
never sets `resolvedAt`** — so remediation usually looks like a finding quietly disappearing. v1
could not see that at all. Those vulnerabilities stayed open forever: MTTR under-reported,
coverage under-reported, and the capacity table's `closed` column missed every such closure.

v2 gives each finding a durable identity (`vuln_key`) and a row in a **ledger** that survives
across runs — first seen, still here, gone. Metrics come from those observed lifecycles instead of
from a snapshot, so a vulnerability that vanishes is counted as resolved on the day it vanished.

The lifecycle rules are ported from `gas/src/domain/reconcile.ts`, which is the reference
implementation; `brick/tests/test_ledger.py` replays that module's own golden fixture
(`gas/test/fixtures/reconcile.json`) scenario by scenario, so the port is checked against the
standard rather than against itself.

| Rule | |
| --- | --- |
| First sighting | OPEN, `first_seen = min(firstDetectedAt, scan ts)` |
| Persisting | advance `last_seen`; `first_seen` stays earliest-known and never drifts later |
| API-resolved | `resolvedAt` present, or status in `RESOLVED_STATUSES` → `resolution_src = 'api'` |
| Disappearance | was OPEN, was in the previous scan covering its severity, absent now → `resolution_src = 'disappeared'` |
| Reopen | a RESOLVED finding is active again → OPEN, `reopened_count++`, a new episode |

A reopen "recomputes" `first_seen` rather than advancing it: it takes `min(firstDetectedAt, scan
ts)`, the same formula a first sighting uses, and deliberately ignores the value already on the
row. That breaks the earliest-known chain — the one place `first_seen` can move *later*. Note the
consequence: if Wiz still reports the original `firstDetectedAt`, the reopened episode inherits
that date rather than starting from the reopen. That is the reference implementation's behaviour
(`reconcile.ts:340`), and the surfaces have to agree.

Three different update disciplines coexist on a ledger row, and they are not interchangeable:

- **latest-observation-wins** — severity, CVE, asset attributes.
- **sticky first-wins, reset by a reopen** — the vendor-fix clock (`fix_date`, `fix_observed_at`).
- **monotone, never reset** — the exploit signals. `has_kev` / `has_exploit` go null → false →
  true and never back; `epss` keeps the **peak** ever observed. Exploit knowledge does not decay,
  and — because the gold tables are appended — a finding that silently left the high-risk
  population would leave last week's published coverage disagreeing with this week's for reasons
  unrelated to any remediation.

### Disappearance is an inference, and it is labelled as one

`resolution_src` records how each closure was learned, and `…metrics_mttr` publishes
`resolved_api` / `resolved_disappeared` per severity. A register whose closures are
overwhelmingly inferred is telling you something about the data source as much as about the
security programme — which you can only notice if the split is on the table.

`--disappearance` picks the date: `scan_ts` (default) is the scan that noticed the absence,
which overstates MTTR by at most one scan interval but never records a moment nobody observed;
`midpoint` halves that bias by inventing a timestamp between the two scans. On a daily job the
difference is under 24 hours.

## Tables

Everything except the ledger is appended, never overwritten. Every row carries `scan_id` /
`scan_ts`, so repeated runs accumulate into a trend instead of clobbering the last one. The
ledger is the exception: it is `MERGE`d, so a vulnerability keeps one row and one history no
matter how many times it is scanned.

| Table | Grain | Contents |
| --- | --- | --- |
| `…wiz_os_findings_raw` | scan × finding | bronze: `node_json` as a string, plus `seq` (API order) |
| `…wiz_os_findings` | scan × finding | silver: typed columns, `mttr_days`, `age_days`, `risk_class` |
| **`…wiz_os_vuln_ledger`** | **one row per `vuln_key`** | **the durable base: `first_seen`, `last_seen`, `status`, `resolved_at`, `resolution_src`, `reopened_count`, the fix clock and the exploit signals** |
| **`…wiz_os_scans`** | **one row per run** | **the run log: `scope`, `severities`, and the new/resolved/reopened deltas** |
| `…wiz_os_metrics_mttr` | scan × severity (+ `OVERALL`) | MTTR mean/median, open counts, open-age p50/p90, SLA target and compliance, the resolution-source split, and the `snap_*` snapshot comparison |
| `…wiz_os_metrics_program` | scan × severity (+ `OVERALL`) | the confusion matrix, coverage and efficiency with bounds, prevalence, signal coverage |
| `…wiz_os_metrics_capacity` | scan × month × **`population`** | opened, closed, backlog at month start, MMCR, net flow, verdict, `reconstructed`, `closed_observed` |
| `…wiz_os_metrics_sensitivity` | scan × signal subset | the same confusion matrix and rates under each of the seven non-empty rules, with the configured one marked `active` |

The gold tables are computed from the ledger. The snapshot figures are still computed and
published beside them as `snap_km_median`, `snap_mttr_median`, `snap_resolved`, `snap_open` —
**the gap between `km_median` and `snap_km_median` is the size of what v1 was missing.**

`…metrics_capacity` gains the two columns v1 could not produce, both of which need scan history:

- **`reconstructed`** — the month predates the first scan, so its opens and closes are back-dated
  from the API's own dates rather than watched by us. Not evidence of capacity, and excluded from
  the headline `mmcr_mean` for that reason. v1 could not draw the distinction, so a register three
  weeks old showed two years of confident monthly throughput.
- **`closed_observed`** — reconciliation's own resolution count, bucketed by the month of the scan
  that found them. An independent route to `closed`, which is derived from `resolved_at`. Where
  the two disagree, one of them is wrong, and publishing both is what lets a reader notice.

### `…metrics_capacity` carries two populations — always filter on `population`

Each month appears twice, once per population, and **an unfiltered read doubles every count.**

| `population` | |
| --- | --- |
| `all` | every finding. How much of the backlog moves in a month |
| `high_risk` | high-risk lifecycles only. The population P2P v3 defines net remediation capacity over, and what `gas/src/server/api.ts:859` passes (`highRiskOnly: true`) |

The two routinely disagree, and which one a number meant is not recoverable after the fact — so
both are written and every reader has to say which. The `high_risk` rows carry no
`closed_observed`: reconciliation's count has no risk label, so against that population it would
be a cross-check on a different set of findings, which is worse than none.

The grid is built per population from that population's own earliest `first_detected_at`, so a
register whose first high-risk finding arrived late has a shorter `high_risk` series. A register
with no high-risk lifecycles at all writes no `high_risk` rows.

> **Upgrading from 2.0:** `population` is added by schema evolution, so rows written by 2.0 land
> with `population = NULL` and are all-findings rows. Backfill them
> (`UPDATE … SET population = 'all' WHERE population IS NULL`) or filter on
> `coalesce(population, 'all')`, or the old scans quietly drop out of every filtered query.
>
> **Until a 2.1+ run has written to the table, the column is absent rather than NULL** — the
> evolution happens on the first write, so a register last scanned under 2.0 has the 2.0 schema
> and `UPDATE … SET population` fails with the same unresolved-column error the query does. The
> notebooks handle both cases (`panels.context` treats a missing column as all-findings and
> coalesces a NULL one), so the pages open either way; SQL written by hand against the table
> needs `coalesce`, and needs the column to exist first:
> `ALTER TABLE … ADD COLUMN population STRING`.

### The scan log is load-bearing

`…wiz_os_scans` is not bookkeeping. It records which severities each scan covered, and
**disappearance is only safe because of it**: `--severities` defaults to `CRITICAL,HIGH`, so
without knowing a scan's scope, every MEDIUM row in the ledger would "vanish" on the first
scoped run and mass-resolve. Absence of something nobody looked for is not remediation. The same
table is the idempotency guard, and its earliest row is the observation horizon that
`reconstructed` is measured against.

Fully qualified as `<catalog>.<schema>.<prefix><name>`, where the prefix defaults to
`wiz_<scope>_`. Two reasons: these usually land in a schema shared with other teams, where a
bare `findings` or `metrics_capacity` would be a collision waiting to happen; and the scope in
the name keeps an OS run and an all-types run in separate tables. `--table_prefix` overrides it
(empty opts out entirely).

### Table layout

Three tables carry a physical layout. The rest are left alone.

| Table | `CLUSTER BY` | Deletion vectors | Why |
| --- | --- | --- | --- |
| `…vuln_ledger` | `vuln_key` | **on** | `vuln_key` is the MERGE's `ON` key |
| `…findings_raw` | `scan_id` | off | every read of bronze filters on `scan_id` |
| `…findings` | `scan_id` | off | same, plus the scan pin every page applies |
| the four gold tables, `…scans` | — | — | 9–150 rows per scan; nothing to lay out |

**Deletion vectors are the half that pays.** Without them a `MERGE` that matches a row rewrites
the entire file containing it, so the daily reconcile — which touches every finding the scan
saw, just to advance `last_seen` — rewrites most of the ledger. With them the matched rows are
marked and the new versions appended. The win grows with the register: on a young one nearly
every row is touched daily and there is little to skip; on a mature one, where the bulk is
long-resolved findings nobody observed today, it is the difference between rewriting the table
and rewriting the day.

They are set **explicitly**, on all three, because the two runtimes disagree about the default —
Databricks enables deletion vectors for a clustered table, open-source Delta does not — and a
cluster configured unlike the test suite is how a number stops being reproducible.

**Clustering `vuln_key` is not what makes the MERGE fast, and it is worth knowing why.** A
`vuln_key` is `id:<wiz-finding-id>` or `h:<sha>`; both are effectively random. Clustering gives
files non-overlapping *ranges*, and a source holding every finding this scan saw spans the whole
range — so almost no file can be pruned. Random keys are the worst case for range-based
skipping. It is still the right key (it is the only one the MERGE joins on, and point lookups do
benefit), but the reason the reconcile gets cheaper is the deletion vectors.

`scan_id` on bronze and silver is different: those reads genuinely do prune. Note that they
already skipped perfectly **by accident** — each run appends only its own scan, so every file
had `min(scan_id) == max(scan_id)`. The first `OPTIMIZE` that packs two scans into one file
would have destroyed that. `CLUSTER BY (scan_id)` makes it a property of the table instead of a
lucky consequence of the write pattern, which is what makes running `--maintain` safe.

**The protocol bump, and its blast radius.** Clustering raises a table to Delta **writer version
7**; deletion vectors raise the **reader to version 3**. Protocol versions cannot be downgraded.
So the ledger becomes unreadable to any client that does not speak reader 3 (DBR 12.2+ is fine),
while bronze and silver stay at reader 1 and can still be read by anything. That split is the
practical reason deletion vectors are off on the two append-only tables — they would buy nothing
there and cost every reader. Nothing in this repo reads these tables (`gas/` and
`wiz_dashboard/` never touch Delta), but an external consumer is worth checking before you
migrate.

**Layout is declared at creation.** A clustering spec cannot be added by an append, so the
ledger is created by `ensure_tables` and bronze and silver by whatever first writes them. An
existing register keeps its unclustered layout until someone migrates it — see
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

Two things this *does* buy unconditionally: `--maintain` becomes safe to run (see
[Table layout](#table-layout) on bronze's accidental skipping), and the layout is declared rather
than emergent.

## Scope

`--scope` decides which population a run measures, and drives **both** the API filter and the
table names — one parameter, so a table can never disagree with what is inside it. Every row
also carries a `scope` column, so it stays self-describing after a `UNION`.

| Scope | Population |
| --- | --- |
| `os` (default) | OS-package CVEs on host workloads. Parity with `os_vulns.VARIABLES["filterBy"]` — `detectionMethod: OS`, `assetType: VIRTUAL_MACHINE`, `assetIsRepresentativeResource: false`, and the `openssl`/`python`/`vim` exclusions — so the numbers are comparable with the Streamlit dashboard's |
| `all` | Every detection method and asset type: container SBOM, code libraries, OS, the lot |

Both scopes share `status: ["OPEN", "RESOLVED"]` and `hasFix: true`, and neither is about
scoping:

- **`status`** — without it the API returns only open findings, and every remediation metric
  collapses (coverage 0%, efficiency undefined, MTTR empty) while still looking like a real
  result.
- **`hasFix`** — restricts both scopes to findings a team could actually have remediated, so
  remediation rates mean the same thing in each. Otherwise awaiting-vendor-fix findings would
  sit in `all`'s coverage denominator and not in `os`'s, and `all` would look worse for a
  reason that is not performance.

What still differs beyond the type and asset restriction: the `openssl`/`python`/`vim`
exclusions and the representative-resource filter are OS-view policy and are not applied to
`all`, so `all` counts a few things `os` deliberately drops.

`os_vulns.py` also pins a `projectIdV2`. That is one tenant's project, so it is **not** copied
into the scope; pass `--project_id=<id>` if you want it.

Moving to all vulnerability types later is `--scope=all`, which writes a parallel
`wiz_all_*` set. The two never mix, and comparing them is a `UNION` on the `scope` column.

Bronze keeps the finding as a JSON string so a Wiz schema change can never fail ingest;
silver is just the typed projection of whatever arrived.

## Running it on Databricks

**Requirements:** DBR 14.3 LTS or newer (Spark 3.5 — `F.percentile` is a 3.5 function; liquid
clustering is supported from DBR 13.3 but only **GA from 15.4 LTS**, so on 14.3 the
[table layout](#table-layout) works and is pre-GA), and
Unity Catalog if you want a three-level `catalog.schema.table` namespace. `requests` is already
on the runtime. Nothing else to install.

### 1. Store the credentials

Once per workspace, from the Databricks CLI:

```bash
databricks secrets create-scope wiz
databricks secrets put-secret wiz wiz-client-id
databricks secrets put-secret wiz wiz-client-secret
```

The service account needs the `read:vulnerabilities` scope in Wiz. Credentials are only ever
read through `dbutils.secrets`; nothing is inlined, and the values never reach a table or a log.

**Pick the catalog deliberately.** These tables map unpatched CVEs to named hosts, so they
belong somewhere with grants to match. `catalog` has no default **on the write path** for
exactly this reason: the job fails rather than guessing. Reading the wrong catalog shows you an
empty page; writing to it is a disclosure, so only the write path is strict — the read-only
notebooks open on `config.DEFAULT_CATALOG` / `DEFAULT_SCHEMA`
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

### 2. Get the code onto the workspace

**Six** `.py` modules are needed at runtime — skip `tests/`, `README.md` and
`requirements.txt`, and note `requests` is already on the runtime. Put them all in **one flat
folder**, created as **Files**, not Notebooks (a notebook is not importable as a module, and
this is the most common way the setup goes wrong):

```
/Workspace/Users/<you>/wiz-metrics/       ← this path goes on sys.path
├── config.py
├── dbx.py
├── ingest.py
├── ledger.py        ← added in v2; a folder set up for v1 will not have it
├── metrics.py
└── run_pipeline.py
```

> **Replace all six together.** The modules move in lockstep — v2's `metrics.py` writes a silver
> frame that only v2's `run_pipeline.py` knows how to merge — so a half-updated folder imports
> cleanly and then fails much later at something that looks unrelated. The first real v2 run hit
> exactly this: 137,870 findings ingested, then *"A schema mismatch detected when writing to the
> Delta table"*, which names neither the stale file nor the fix. Every module now carries a
> `MODULE_VERSION` and `run_pipeline` refuses to start when they disagree, but re-pasting the
> whole set is what avoids the problem rather than merely diagnosing it.

To read the [notebooks](#notebooks) as well as run the pipeline, three more files go on the same
`sys.path`, plus the notebooks themselves:

```
/Workspace/Users/<you>/wiz-metrics/       ← these files go on sys.path too
├── panels.py
├── figures.py
├── tiles.py
├── import_bundle.py
└── notebooks/
    ├── 00_security_posture.ipynb
    ├── 01_mttr_sla.ipynb
    ├── 02_program_performance.ipynb
    ├── 03_os_vulnerabilities.ipynb
    ├── 04_scan_history.ipynb
    ├── 05_estate.ipynb
    ├── 06_run_and_verify.ipynb
    └── 07_import_gas.ipynb
```

These four are **not** in the six. A scheduled Job must never fail for want of Plotly, and it
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
  skipped and only the new `ledger.py` lands, which is the mixed folder described above.
  Copies `tests/` too, harmlessly.

### Check the upload landed

Cheap, and it catches both a missed file and the `sys.path` shadowing described under
[Layout](#layout) — the printed path tells you which `config.py` actually won:

```python
import config, dbx, ingest, ledger, metrics, run_pipeline
for m in (config, dbx, ingest, ledger, metrics, run_pipeline):
    print(f"{m.__name__:14} {getattr(m, 'MODULE_VERSION', 'PRE-2.0 — STALE'):16} {m.__file__}")
```

All six must report the same version, from the folder you just pasted into. Anything else and
the run will refuse to start. `06_run_and_verify` runs this cell for all nine modules and is the
better place to do it once the notebooks are up.

Run this cell rather than relying on the built-in guard alone. `run_pipeline` can only check the
modules it imports, so it catches a stale `config.py` or `metrics.py` — but if `run_pipeline.py`
is itself the stale file, there is no v2 code running to do the checking, and you get the v1
behaviour with none of the diagnostics. That is precisely what happened on the first v2 run. The
cell reads the versions directly and has no such blind spot.

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
dbutils.widgets.text("scope", "os")            # "all" for every vulnerability type

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

### 3b. As a scheduled Job

A **Python file** task with the Git repo as its source, `brick/run_pipeline.py` as the path,
and the parameters passed as `--name=value`:

```json
{
  "name": "wiz-vulnerability-metrics",
  "schedule": { "quartz_cron_expression": "0 0 6 * * ?", "timezone_id": "UTC" },
  "max_concurrent_runs": 1,
  "git_source": {
    "git_url": "https://github.com/<org>/sidekick",
    "git_provider": "gitHub",
    "git_branch": "main"
  },
  "tasks": [
    {
      "task_key": "metrics",
      "spark_python_task": {
        "python_file": "brick/run_pipeline.py",
        "parameters": [
          "--catalog=<your-catalog>",
          "--schema=wiz",
          "--wiz_api_url=https://api.<region>.app.wiz.io/graphql",
          "--secret_scope=wiz",
          "--severities=CRITICAL,HIGH",
          "--scope=os",
          "--scan_id={{job.run_id}}"
        ]
      },
      "new_cluster": { "spark_version": "14.3.x-scala2.12", "num_workers": 2 }
    }
  ]
}
```

That cron is daily at 06:00 UTC, which is the cadence v2 is built for: the ledger advances once a
day, so a disappearance is dated to within 24 hours of when it happened. Scan more often and the
dating gets tighter; scan less often and `scan_ts` resolution gets coarser (or switch to
`--disappearance=midpoint`).

`--scan_id={{job.run_id}}` and `max_concurrent_runs: 1` are what make a retry safe — see
[Retries](#retries-are-safe-if-you-pass-scan_id). Both matter more on a schedule than they do
interactively, because nobody is watching when the retry happens.

A single-node cluster is plenty — the driver does the API paging and the Spark work is a
handful of aggregations over one scan.

**On the first v2 run** the ledger and scan-log tables are created automatically, and `seq` is
added to bronze by schema evolution. Run `--rebuild_ledger=true` once first if you have v1
history worth keeping.

### Parameters

Resolved in this order: `--name=value` on the command line, then `dbutils.widgets.get(name)`,
then the `NAME` environment variable, then the default. One code path covers Jobs, notebooks
and a laptop.

| Name | Default | |
| --- | --- | --- |
| `catalog` | — | **required**, no default; `hive_metastore` on a workspace without Unity Catalog |
| `schema` | `wiz` | created only if it does not already exist |
| `scope` | `os` | `os` or `all` — see [Scope](#scope) |
| `table_prefix` | `wiz_<scope>_` | pass empty to use bare table names |
| `project_id` | — | optional `projectIdV2` restriction |
| `wiz_api_url` | — | **required**, `https://api.<region>.app.wiz.io/graphql` |
| `wiz_auth_url` | `https://auth.app.wiz.io/oauth/token` | override for a dedicated tenant |
| `secret_scope` | — | scope holding `wiz-client-id` / `wiz-client-secret` |
| `severities` | `CRITICAL,HIGH` | comma-separated; also recorded per scan and used by the disappearance guard |
| `scan_id` | a random id | pass `{{job.run_id}}` on a scheduled Job — see [Retries](#retries-are-safe-if-you-pass-scan_id) |
| `disappearance` | `scan_ts` | `scan_ts` or `midpoint` |
| `rebuild_ledger` | `false` | replay bronze and rebuild the ledger from scratch — see [Backfill](#backfilling-from-existing-bronze) |
| `shuffle_partitions` | `0` | `spark.sql.shuffle.partitions` for the run; `0` leaves the cluster's own setting alone |
| `maintain` | `false` | run `OPTIMIZE` over the clustered tables and exit, ingesting nothing — see [Maintenance](#maintenance) |
| `data_path` | — | write the register to this directory instead of a catalog — see [PoC storage](#poc-storage-running-with-no-catalog). With it set, `catalog` is not required |
| `export_csv` | — | write every table to this directory as CSV and exit. One-way; see [PoC storage](#poc-storage-running-with-no-catalog) |

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
`--scan_id={{job.run_id}}` makes the second attempt arrive with the id the first one used. The
run then finds its own row in `…wiz_os_scans` and does nothing.

Without it, `scan_id` is random and a retry looks like a brand-new scan. Also set
`"max_concurrent_runs": 1` so two runs cannot reconcile against each other.

If a run dies *between* the ledger MERGE and the scan-log write, the next run detects it — the
ledger carries the scan id, the log does not — and **refuses rather than double-counting**.
Recover with `--rebuild_ledger`.

**A failed ingest leaves partial bronze, and that is fine.** Findings are written to bronze in
batches as they are paged out of the API, rather than held in the driver until the sweep
finishes — a full register is hundreds of thousands of JSON documents and one list of all of
them is a driver problem waiting to happen. So a crash mid-sweep leaves the batches that
committed. Nothing reads them: bronze rows are only ever selected by a `scan_id` that has a
`…wiz_os_scans` row, and a retry passing the same `--scan_id` clears them before re-ingesting.
A run that dies mid-ingest and is *never* retried leaves orphaned bronze rows, which cost
storage and nothing else.

### Maintenance

```bash
python brick/run_pipeline.py --catalog=<catalog> --maintain=true \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

`--maintain` runs `OPTIMIZE` over the three [clustered tables](#table-layout) and exits without
ingesting anything. It is what actually applies the clustering: a table declares its layout at
creation, but a write only *lays data out* above a size threshold no single scan here reaches,
so without this the spec is a promise nothing keeps. On a clustered table `OPTIMIZE` clusters
incrementally — it rewrites what is not already in place, not the whole table.

**Run it as its own Job, weekly.** It is deliberately not part of the daily scan: `OPTIMIZE` is
an unbounded rewrite over the whole register, and the job that has to finish before anyone can
read this morning's number should not be queued behind it. The same Job JSON as
[the scheduled run](#3b-as-a-scheduled-job) with `--maintain=true` and a weekly cron does it.

It does **not** `VACUUM`. That deletes the files time travel and any in-flight reader still
depend on, and choosing a retention window is a decision nobody has made here — see
[What v2 does not do](#what-v2-does-not-do). `OPTIMIZE` only ever adds files, so the worst a bad
run of this can do is cost money.

On Unity Catalog managed tables you may not need it at all: Databricks **Predictive
Optimization** runs `OPTIMIZE` for you, and where it is enabled `--maintain` is redundant.

### Migrating an existing register

Everything above applies to tables created from now on. A register that already exists keeps its
unclustered layout — a clustering spec cannot be added by an append, and this pipeline will not
silently rewrite the physical layout of a production ledger on the next scheduled run.

Migrating is three statements per table and one decision. Run them once, from a notebook or the
SQL editor, with the pipeline stopped:

```sql
ALTER TABLE <catalog>.<schema>.wiz_os_vuln_ledger CLUSTER BY (vuln_key);
ALTER TABLE <catalog>.<schema>.wiz_os_vuln_ledger
  SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true');

ALTER TABLE <catalog>.<schema>.wiz_os_findings_raw CLUSTER BY (scan_id);
ALTER TABLE <catalog>.<schema>.wiz_os_findings     CLUSTER BY (scan_id);

OPTIMIZE <catalog>.<schema>.wiz_os_vuln_ledger;
OPTIMIZE <catalog>.<schema>.wiz_os_findings_raw;
OPTIMIZE <catalog>.<schema>.wiz_os_findings;
```

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

If you have been running v1, bronze already holds months of scans. `--rebuild_ledger` truncates
the ledger and the scan log, then replays every bronze scan oldest-first through the same
reconciler the live path uses:

```bash
python brick/run_pipeline.py --catalog=<catalog> --rebuild_ledger=true \
  --severities=CRITICAL,HIGH --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Without it the ledger starts today: every finding's `first_seen` collapses to now and MTTR reads
as roughly zero until enough history accumulates.

**One caveat, and it matters.** v1 never recorded which severities a scan asked for, so replayed
scans are assumed to have used the `--severities` you pass. If your history was collected under a
different scope, pass *that* scope — otherwise the replay will resolve-by-disappearance severities
the original scans never covered, and invent remediation that never happened. Scans written by v2
carry their own scope and are unaffected.

The rebuild is idempotent, and `brick/tests/test_ledger_pipeline.py` pins the invariant that
matters: replaying bronze lands exactly where running those scans live landed.

### Migrating from the Apps Script app

`--rebuild_ledger` only helps a deployment that already has bronze. A **new** brick deployment
beside a `gas/` app that has been scanning for months has none — and starting its ledger today
is not merely incomplete, it is wrong in the same four ways: `first_seen` collapses to now,
Kaplan–Meier reads near zero, capacity marks every earlier month `reconstructed`, and the
confusion matrix is computed over a population one scan deep. None of it looks like an error.

`import_bundle.py` seeds the ledger and the scan log from a **migration bundle** — the
`wiz-sidekick-migration` JSON that `wiz_dashboard/data/migrate.py` defines, the GAS app already
imports, and now exports too.

```
GAS  Data → Migration bundle (Drive)        →  migration-<ts>.json.gz
     upload to a Unity Catalog volume       →  /Volumes/<cat>/<schema>/<vol>/migration-….json.gz
brick 07_import_gas  (or the CLI below)     →  <p>vuln_ledger + <p>scans
     06_run_and_verify, one scan            →  the gold tables, from real lifetimes
```

```bash
python brick/import_bundle.py --catalog=<catalog> --schema=<schema> --scope=os \
  --bundle_path=/Volumes/<catalog>/<schema>/<volume>/migration-20260811T000000Z.json.gz
```

It seeds an **empty** register and refuses one that holds anything — the ledger, the scan log,
or any of the six appended tables. Merging a seed into a register that has already scanned
would re-open lifecycles it has since resolved, and appending an older scan log beside brick's
own would hand the disappearance guard the wrong previous scan.

`--force_import=true` **replaces the register**, not merely the two lifecycle tables. The gold
tables are why: they are appended per scan and computed from the ledger *as it stood at that
scan*, so rows written before a seed were derived from a ledger that started empty. Left in
place they sit in `04_scan_history` as a run whose MTTR reads near zero, beside seeded runs
where it does not — a contradiction with nothing on the page to explain it. So a forced import
overwrites the ledger and the scan log and empties bronze, silver and all four gold tables, and
the register genuinely restarts from the imported history. Re-scan to repopulate them.

They are emptied rather than dropped: `DELETE` needs only `MODIFY` and keeps each table's
grants, where `DROP` needs ownership and would take the grants with it.

**If the import stops with "No write access"**, that is Unity Catalog, not the bundle. A
`DELETE … WHERE 1=0` probe runs before the expensive work precisely so the refusal names the
grant instead of surfacing as a `Py4JJavaError` at `saveAsTable` six Spark jobs later. Note
that overwriting is not a way around it — UC gives a table's owner `MODIFY` implicitly, so
being refused it means this principal does not own the table, and replacing or dropping needs
ownership or `MANAGE`, a strictly higher bar. Grant at the schema, because the first scan after
the import creates six more tables:

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
| `tags_json` | brick's ingest selects no asset tags, so nothing downstream would read it — and domain triage is unavailable here either way |
| the actionable clock | `fix_date` / `fix_observed_at` arrive, but nothing reads them yet |
| bronze, and therefore a back-dated gold trend | the bundle holds reconciled lifecycles, not raw findings. `<p>scans` shows the imported runs; the gold tables begin accumulating from the first brick run |
| `mttr_history` | GAS's precomputed daily KPI series. It rides in the bundle and brick has no table for it |
| several episodes for one `vuln_key` | brick's ledger is one row per key, so the most recently resolved wins; the import counts the rest |

Two things survive the import but not a **re-scan**, and both are worth knowing before reading a
severity breakdown. GAS heals a blank severity from `vendorSeverity` / `nvdSeverity`
(`gas/src/domain/severity.ts::effectiveSeverity`) and brick queries neither field, so such a row
will read `UNKNOWN` after its next scan — and `UNKNOWN` has no `SLA_TARGETS` entry. GAS likewise
falls back `firstDetectedAt → firstSeenAt → createdAt` where brick reads only the first.

**The `h:` caveat.** `vuln_key` is `id:<wiz finding id>` when the API gave one and a hash
otherwise, and the hash basis includes `component`, which GAS never persisted. An imported `h:`
row is therefore re-keyed by the next brick scan and starts a second lifecycle. Only findings
with no Wiz id are affected, which is why the import prints the `h:` count — that number is the
blast radius, and it is usually zero.

### 4. Read the results

```sql
SELECT severity, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM   <catalog>.<schema>.wiz_os_metrics_program
WHERE  scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_os_metrics_program
)
ORDER BY severity;
```

Read that against `prevalence_pct` on the same row, not against the P2P baselines — see
[Reading coverage and efficiency](#reading-coverage-and-efficiency). How much of it is the rule:

```sql
SELECT rule_label, active, coverage_pct, efficiency_pct, high_risk, unknown
FROM   <catalog>.<schema>.wiz_os_metrics_sensitivity
WHERE  scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_os_metrics_sensitivity
)
ORDER BY active DESC, rule_label;
```

The run itself prints all three families — MTTR and SLA by severity, coverage and efficiency
with the rule-sensitivity table beside them, and the most recent capacity months for each
population.

To read the numbers rather than query them, open the [notebooks](#notebooks).

Once both scopes are running, compare them on the `scope` column:

```sql
SELECT scope, coverage_pct, efficiency_pct
FROM   <catalog>.<schema>.wiz_os_metrics_program  WHERE severity = 'OVERALL'
UNION ALL
SELECT scope, coverage_pct, efficiency_pct
FROM   <catalog>.<schema>.wiz_all_metrics_program WHERE severity = 'OVERALL';
```

Start with `--severities=CRITICAL` on the first run: it is the fastest way to confirm the
tables land before pulling the whole register.

## Running it locally

```bash
pip install -r brick/requirements.txt
export WIZ_CLIENT_ID=... WIZ_CLIENT_SECRET=...
python brick/run_pipeline.py \
  --catalog=hive_metastore --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

Off Databricks the `dbutils` accessors return empty rather than raising, so credentials come
from the environment. Note that `saveAsTable` against a three-level `catalog.schema.table`
name needs Unity Catalog — a local Spark can only write two-level names.

## PoC storage: running with no catalog

A proof of concept usually has nowhere to put tables — no catalog and schema this principal may
create in. `--data_path` runs the whole pipeline against a **directory** instead:

```bash
python brick/run_pipeline.py \
  --data_path=/Volumes/<catalog>/<schema>/<volume>/brick \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

`--catalog` is not required in this mode; that is the point of it. Each table becomes a
directory under the root, named exactly as the catalog-backed table would be
(`brick/wiz_os_vuln_ledger`, `brick/wiz_os_findings_raw`, …), and every reference the code
passes to Spark becomes ``delta.`<root>/<name>` ``, which is valid anywhere a table name is.

Set the same value in the `data_path` widget and notebooks 00–05 read the register from there.

**It is still Delta.** Types survive, NULL stays distinct from false, the ledger is still
`MERGE`d, and the clustering and deletion vectors from [Table layout](#table-layout) are
declared exactly as they would be in a catalog. Nothing about the register is degraded by not
having a catalog — the catalog was only ever the name.

**Silver is not stored** in this mode. It is a pure per-scan projection of bronze, so keeping it
would be a second copy of data the register already holds; `panels` rebuilds the findings views
from bronze with the same function the pipeline would have written silver with. Bronze is the
table that must survive: `--rebuild_ledger` replays it, and everything else follows.

### Where the path must point

| | persists | the catch |
| --- | --- | --- |
| `/Volumes/<cat>/<sch>/<vol>/…` | yes | needs a Unity Catalog schema — which may be the thing you don't have |
| `/dbfs/…` | yes | DBFS root is deprecated and new workspaces are provisioned without it |
| `/Workspace/…` | yes | **capped at 500 MB** — bronze will exceed it, probably on the first scan |
| an `s3://` / `abfss://` URI you can already write | yes | needs credentials or an external location, but no catalog |
| `/tmp`, `/local_disk0`, anything relative | **no** | wiped when the cluster terminates |

That last row is why `--data_path` **refuses** an ephemeral path when it can see a Databricks
around it. A register written to the driver's disk is gone by the next morning, silently, and
exactly when somebody first goes looking for the history — so it fails at parameter resolution
instead. Off Databricks those are ordinary directories and are allowed, which is what lets the
tests use a temporary one.

### Moving it into the lake later

When a real catalog arrives, register each directory as an external table. No copy, no replay:

```sql
CREATE TABLE <catalog>.<schema>.wiz_os_vuln_ledger  USING DELTA LOCATION '<root>/wiz_os_vuln_ledger';
CREATE TABLE <catalog>.<schema>.wiz_os_findings_raw USING DELTA LOCATION '<root>/wiz_os_findings_raw';
CREATE TABLE <catalog>.<schema>.wiz_os_scans        USING DELTA LOCATION '<root>/wiz_os_scans';
-- and the four metrics_* directories the same way
```

Then drop `--data_path`, pass `--catalog` and `--schema`, and the next scan continues the same
ledger. The rows, the clustering columns, the deletion-vector property and the full history all
come across, because they live in the Delta log rather than in the metastore —
`test_the_register_migrates_into_a_catalog_without_losing_anything` is that paragraph as a test,
including that the migrated ledger still accepts a `MERGE`.

Silver has no directory to register; the first catalog-backed scan creates it.

If a path ever has to be rebuilt rather than registered — a directory copied between accounts,
say — `--rebuild_ledger` replays bronze into a fresh register and lands where the live scans
landed.

### `--export_csv` is for reading, not for migrating

```bash
python brick/run_pipeline.py --data_path=<root> --export_csv=<root>/csv
```

One CSV per table, for opening in a spreadsheet or mailing to somebody. **It is one-way.** CSV
has no types, so every timestamp and boolean comes back as text, and NULL is indistinguishable
from an empty string in a way Spark's own behaviour has changed across releases
([SPARK-17916](https://issues.apache.org/jira/browse/SPARK-17916)). That ambiguity lands on
`has_kev` / `has_exploit` / `epss` — where, per
[Three things that are easy to get wrong](#three-things-that-are-easy-to-get-wrong), a NULL read
back as `false` inflates efficiency and deflates coverage at once and says nothing about it.

So there is deliberately no CSV import, and no test that the export round-trips: writing one
would imply it is safe to migrate from. What you migrate is the Delta directory.

## Tests

```bash
pip install -r brick/requirements.txt
pytest brick/tests -n auto --dist loadgroup -q     # the whole suite, in parallel
pytest brick/tests -q                              # the same tests, one at a time
```

They spin up a local `SparkSession`; the module skips cleanly if pyspark isn't installed. The
root `pyproject.toml` deliberately does **not** collect `brick/tests` — the main suite must not
start depending on Spark.

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
for 4g when it is the only session and 2g per worker when it is not, because four workers at 4g
want 16g and the swapping costs more than the parallelism returns.

The one thing that does not parallelise is the first-ever run after `DELTA_PACKAGE` in
`conftest.py` changes: `--packages` resolves the jars through Ivy into a shared `~/.ivy2`, and
several workers populating a cold cache at once can race. Run the suite serially once after
bumping that version, then in parallel thereafter.

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
  response shape is covered without a network call.

The rules that would be silently wrong rather than loudly broken were mutation-tested: removing
the disappearance previous-scan guard, the severity-scope guard, the monotone risk merge, the
peak-EPSS rule, the fix-clock reset on reopen, and `first_seen`'s earliest-wins each fail the
suite.

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

Seven `.ipynb` pages under `notebooks/`, one per page of the GAS app, in the same order its
sidebar uses, plus a one-shot importer. Each answers one question with a headline, a small set
of charts and a table you can sort and export. Run a cell, get a metric and its visualisation.

| Notebook | The one question it answers |
| --- | --- |
| **`00_security_posture`** | How fast are we closing risk, how much is open right now, and is it getting worse? |
| **`01_mttr_sla`** | How long does a vulnerability actually live once you stop excluding what is still open — and where is it slow? |
| **`02_program_performance`** | Is remediation effort landing on the findings that matter, and can we close faster than risk arrives? |
| **`03_os_vulnerabilities`** | What is exploitable, where does risk concentrate, and what moved since the last scan? |
| **`04_scan_history`** | What has actually been measured, when, and how has the register moved across those measurements? |
| **`05_estate`** | Can this register be attributed to an owner at all, and which parts of the estate carry the backlog? |
| **`06_run_and_verify`** | Is the deployment sound, can I run a scan, and are the tables consistent? |
| **`07_import_gas`** | Can this register start from the history the Apps Script app already has, instead of from today? |

`00`–`05` are **read-only about your data**. `06` is the only one that ingests, which is
deliberate: a page somebody opens to check a number should not be one Run All away from a
credentialed API sweep. `07` is the other writer, and it is meant to be run once, before the
first scan — see [Migrating from the Apps Script app](#migrating-from-the-apps-script-app).

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
parameters are widgets and Job parameters, and the high-risk rule is `config.DEFAULT_RISK_RULE`,
so changing it is a code change. **Data**'s import half — brick ingests from the Wiz API and has
no CSV import path; the export half is the download button on every result grid.

`05_estate` is GAS's **Attribution** page renamed rather than faked. GAS maps findings to
value-chain domains through configurable rules over subscriptions and asset tags. brick has no
domain rules and `ingest.py` selects no asset tags, so there is nothing to compute a coverage
gap against. The page says so and answers the nearest question the register can actually
support. Adding tags to `ingest.py` is the real fix.

> **`05_estate` is currently empty, and that is the honest reading.** See
> [The asset fields are not fetched](#the-asset-fields-are-not-fetched) — every column it groups
> on is NULL, so `panels.attributability` reports 0% populated. That is the page working, not
> the page broken: it exists to answer "can this register be attributed to an owner at all".

### The asset fields are not fetched

`config.FETCH_ASSET_FIELDS` is **False**. The live tenant no longer has the `vulnerableAsset`
union members this query used, and GraphQL rejects the *whole request* rather than the
sub-selection — so one unavailable field costs every scan. It is a constant rather than a
deletion: `ingest._asset_selection` and its member list are intact, so a tenant that still has
them turns the columns back on by flipping one line.

| | |
| --- | --- |
| **NULL while it is off** | `asset_id`, `asset_name`, `asset_type`, `cloud`, `subscription_name`, `subscription_ext_id` — so `05_estate`, the by-subscription breakdowns and `risk_mix` have nothing to group on |
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
v_mttr  v_program  v_capacity  v_findings  v_scans  v_lifecycles     ← one scan
v_mttr_all  v_program_all  v_findings_all                            ← deliberately not
```

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
these numbers.

P2P scores a remediation strategy against an *independent* ground truth: exploitation observed
in the wild, which lands on roughly 2–5% of CVEs. We have no such ground truth — only the
signals in the risk rule. So `risk_class = high` **is our own prioritization rule**, and the
confusion matrix measures what the register did against that rule rather than against reality.
That is the same move the Kenna product makes (it scores against Kenna's own risk band), and it
is a fair thing to measure. It is just not the thing P2P measures.

| | P2P research | Kenna.VM product | here |
| --- | --- | --- | --- |
| Positive label | exploitation observed in the wild | Kenna risk score, high band | `KEV ∨ public exploit ∨ EPSS ≥ 0.1` |
| Nature | retrospective ground truth | vendor prediction | our own rule |
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
- **`hasFix: true` is in the population** (see [Scope](#scope)), so awaiting-vendor-fix findings
  are not in coverage's denominator. Deliberate, and one more reason the published baselines are
  not comparable.
- **The matrix is cumulative and asset-weighted.** Every finding the ledger has ever seen is in
  it, so the appended per-scan series is a to-date curve, not a monthly one — a good quarter
  barely moves it. And one CVE on 5,000 hosts contributes 5,000 rows.

One more, from the ledger's [sticky signals](#the-ledger-and-why-v2-exists): classification is
**not as-of**. Exploit knowledge is monotone by design, so a finding that reached KEV in month
six is counted high-risk in month one too. The bias is conservative — it can only move findings
into the high-risk population, never out — but it means the confusion matrix is "classified with
everything we know now", not "classified with what we knew then".

### Since the rule is the label, its sensitivity is a published metric

`…metrics_sensitivity` recomputes coverage and efficiency under each of the seven non-empty
signal subsets — KEV alone, EPSS alone, KEV-or-exploit, and so on — with the active rule marked
`active = true`. Ported from `gas/src/domain/program.ts::ruleSensitivity`.

It answers **"how much does the headline depend on which signals I turned on?"** and nothing
else. It is deliberately *not* P2P vol. 9's Figure 19, which plots candidate strategies against
observed exploitation; the subsets here are scored against themselves, so a subset cannot be
"wrong" — a narrow rule simply reports high efficiency over a small high-risk population.
Label it *rule sensitivity*, never *strategy comparison*.

What the table is good for is seeing the shape of the trade: each row carries `high_risk` and
`unknown` alongside the two rates, so a subset that buys efficiency by shrinking the high-risk
population — or by pushing rows into `unknown` — cannot hide it. The `KEV only` row is usually the
starkest: P2P vol. 9 pp. 22–24 found CISA KEV alone covers only ~19% of what is exploited in
the wild, which is why the default rule is an any-of over three signals rather than KEV alone.

## MTTR is Kaplan–Meier, not a mean of what closed

Averaging `mttr_days` over resolved findings is survivorship bias with a respectable name. The
findings that take longest are disproportionately the ones *still open*, so excluding them makes
remediation look faster than it is — and the gap widens exactly when a programme is falling
behind, which is when you least want a flattering number.

`metrics.kaplan_meier` (ported from `gas/src/domain/remediation.ts::kaplanMeier`) keeps those
findings in the risk set as **right-censored** observations: "not closed yet" is evidence, just
not the same evidence as "closed on day 40". Columns on `…metrics_mttr`:

| Column | |
| --- | --- |
| `km_median` | the headline. Smallest time where survival falls to ≤ 50% |
| `km_median_lower_bound` | set **only** when `km_median` is NULL, i.e. more than half of that severity is still open and the median does not exist yet. Report it as "> N d" rather than inventing a number |
| `km_rmst` | restricted mean survival time — area under the curve out to the longest observed time |
| `km_truncated` | survival never reached zero, so `km_rmst` is a floor rather than a mean |
| `km_events` / `km_censored` | how much of the estimate rests on closures vs. still-open findings |
| `mttr_mean` / `mttr_median` | the naive closed-only figures, kept for comparison with the Streamlit dashboard — the gap against `km_median` *is* the bias |

On the committed fixture the two differ by about 18%: naive 18.1d against a KM median of 21.3d.

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

## What v2 does not do

The three things v1 was missing — cross-scan lifecycle tracking, the capacity `reconstructed`
flag, and the per-scan `resolved_count` cross-check — are done. What is still outstanding, all
of it available on the GAS side:

- **No actionable clock.** The SLA clock should arguably start when a vendor fix becomes
  available, not at detection (`gas/src/domain/ledgerCore.ts::baseRows` computes
  `fix_available_at`, `mttr_actionable_days`, `awaiting_vendor_fix`). The *inputs* are already
  captured — `fix_date` and `fix_observed_at` are on every ledger row — because they cannot be
  recovered afterwards: once a finding disappears from the API, a fix signal nobody wrote down
  is gone for good. Nothing reads them yet; the derivations are the remaining work.
- **No domain triage.** `gas/src/domain/domainRules.ts` assigns findings to owning teams from
  subscription and tag inputs. `subscription_name` / `subscription_ext_id` are on the ledger;
  **asset tags are not, because `ingest.py` does not select them** — adding that is an ingest
  change (a new field on every `vulnerableAsset` inline fragment), not a ledger one.
- **No retention.** The ledger grows monotonically. The Streamlit side seals old scans into
  `resolved_episodes` (`wiz_dashboard/data/ledger.py::compact_ledger`); on Delta the equivalent
  levers are `VACUUM` and bronze retention, and a large register will eventually want both.
  Compaction is no longer on this list — [`--maintain`](#maintenance) runs `OPTIMIZE` over the
  clustered tables — but nothing here deletes anything, ever, and choosing a retention window is
  the decision that is still outstanding.
- **No period-scoped confusion matrix.** Coverage and efficiency are cumulative over the whole
  ledger, so the per-scan series is a to-date curve and a good quarter barely moves it.
  `gas/src/domain/trend.ts::withCoverageEfficiency` recomputes the pair as-of each trend point
  (using `resolved_at <= d` rather than `status`); there is no `brick` equivalent. See
  [Reading coverage and efficiency](#reading-coverage-and-efficiency).

Two entries left this list with the notebooks. The **Kaplan–Meier survival curve** is now
`metrics.km_curve`, which `kaplan_meier` itself consumes — one implementation, so the staircase
on `01_mttr_sla` and the published `km_median` cannot disagree. The **rule-sensitivity sweep**
exists twice, on purpose: `metrics.rule_sensitivity` writes `…metrics_sensitivity` under the
configured rule, so the sweep is queryable from SQL and trends across scans; `panels.rule_sweep`
recomputes it at read time against `ctx.rule`, so changing the rule in a notebook moves the
filled point without a re-scan. Both walk the same `metrics.RULE_SUBSETS`, so they cannot
disagree about what a subset is.

Two ledger fields also stay deliberately simple relative to GAS: there is no `tags_json`
(see above), and no `resolved_episodes` table, so a `vuln_key` has exactly one lifecycle row and
a reopen overwrites the previous episode's dates rather than archiving them. `reopened_count`
records that it happened; the earlier episode's `resolved_at` is not kept.
