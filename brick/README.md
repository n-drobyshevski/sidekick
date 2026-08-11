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
series. They are in direct tension — P2P vol. 2's industry baseline is 70% coverage at 18.5%
efficiency — so the pipeline always emits both, never one alone.

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

panels.py         every number a notebook shows, and the one place that pins the scan
figures.py        pandas -> Plotly figures, drawn the way the GAS app draws them
tiles.py          HTML fragments for displayHTML: heroes, KPI bands, the confusion matrix
notebooks/        seven .ipynb pages, one per page of the GAS app

tests/            local-SparkSession tests, oracles ported from the existing suites
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
| `…wiz_os_metrics_capacity` | scan × month | opened, closed, backlog at month start, MMCR, net flow, verdict, `reconstructed`, `closed_observed` |

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

**Requirements:** DBR 14.3 LTS or newer (Spark 3.5 — `F.percentile` is a 3.5 function), and
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
belong somewhere with grants to match. `catalog` has no default for exactly this reason: the
job fails rather than guessing. Restrict the schema once it exists:

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
└── notebooks/
    ├── 00_security_posture.ipynb
    ├── 01_mttr_sla.ipynb
    ├── 02_program_performance.ipynb
    ├── 03_os_vulnerabilities.ipynb
    ├── 04_scan_history.ipynb
    ├── 05_estate.ipynb
    └── 06_run_and_verify.ipynb
```

These three are **not** in the six. A scheduled Job must never fail for want of Plotly, so
`run_pipeline` neither imports nor requires them — but if they *are* imported and their version
disagrees, that is fatal for the same reason the six are: a stale `figures.py` beside a fresh
`metrics.py` draws a chart that contradicts the number printed above it, which is the same class
of bug with a quieter failure.

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

dbutils.widgets.text("catalog", "")            # required -- see "Pick the catalog" above
dbutils.widgets.text("schema", "wiz")
dbutils.widgets.text("wiz_api_url", "https://api.<region>.app.wiz.io/graphql")
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

`<region>` is the one in your Wiz tenant URL (`us1`, `eu2`, …). Get it wrong and auth succeeds
but the GraphQL POST 404s.

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

### 4. Read the results

```sql
SELECT severity, coverage_pct, efficiency_pct, prevalence_pct, signal_coverage_pct
FROM   <catalog>.<schema>.wiz_os_metrics_program
WHERE  scan_id = (
  SELECT max_by(scan_id, scan_ts) FROM <catalog>.<schema>.wiz_os_metrics_program
)
ORDER BY severity;
```

The run itself prints all three families — MTTR and SLA by severity, coverage and efficiency,
and the most recent capacity months.

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

## Tests

```bash
pip install -r brick/requirements.txt
pytest brick/tests -q
```

They spin up a local `SparkSession`; the module skips cleanly if pyspark isn't installed. The
root `pyproject.toml` deliberately does **not** collect `brick/tests` — the main suite must not
start depending on Spark.

`delta-spark` is needed for the ledger tests; without it they skip and the pure-transform tests
still run. All the tests share one `SparkSession` from `tests/conftest.py`, because Delta's SQL
extensions can only be installed when a session is built and `getOrCreate()` returns whatever
already exists — leaving each module to make its own meant the first module alphabetically
decided whether the suite could use Delta.

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

## Notebooks

Seven `.ipynb` pages under `notebooks/`, one per page of the GAS app, in the same order its
sidebar uses. Each answers one question with a headline, a small set of charts and a table you
can sort and export. Run a cell, get a metric and its visualisation.

| Notebook | The one question it answers |
| --- | --- |
| **`00_security_posture`** | How fast are we closing risk, how much is open right now, and is it getting worse? |
| **`01_mttr_sla`** | How long does a vulnerability actually live once you stop excluding what is still open — and where is it slow? |
| **`02_program_performance`** | Is remediation effort landing on the findings that matter, and can we close faster than risk arrives? |
| **`03_os_vulnerabilities`** | What is exploitable, where does risk concentrate, and what moved since the last scan? |
| **`04_scan_history`** | What has actually been measured, when, and how has the register moved across those measurements? |
| **`05_estate`** | Can this register be attributed to an owner at all, and which parts of the estate carry the backlog? |
| **`06_run_and_verify`** | Is the deployment sound, can I run a scan, and are the tables consistent? |

`00`–`05` are **read-only**. `06` is the only one that writes, which is deliberate: a page
somebody opens to check a number should not be one Run All away from a credentialed API sweep.

Two GAS pages have no analogue here and are absent rather than approximated. **Settings** — the
parameters are widgets and Job parameters, and the high-risk rule is `config.DEFAULT_RISK_RULE`,
so changing it is a code change. **Data**'s import half — brick ingests from the Wiz API and has
no CSV import path; the export half is the download button on every result grid.

`05_estate` is GAS's **Attribution** page renamed rather than faked. GAS maps findings to
value-chain domains through configurable rules over subscriptions and asset tags. brick has no
domain rules and `ingest.py` selects no asset tags, so there is nothing to compute a coverage
gap against. The page says so and answers the nearest question the register can actually
support. Adding tags to `ingest.py` is the real fix.

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
- **No retention or compaction.** The ledger grows monotonically. The Streamlit side seals old
  scans into `resolved_episodes` (`wiz_dashboard/data/ledger.py::compact_ledger`); on Delta the
  equivalent levers are `OPTIMIZE` and `VACUUM`, plus bronze retention. Nothing here does either
  yet, and a large register will eventually want it.
Two entries left this list with the notebooks. The **Kaplan–Meier survival curve** is now
`metrics.km_curve`, which `kaplan_meier` itself consumes — one implementation, so the staircase
on `01_mttr_sla` and the published `km_median` cannot disagree. The **rule-sensitivity sweep** is
`panels.rule_sweep`: all seven non-empty subsets of the risk signals through the existing
`classify_risk` / `confusion_matrix`, in one pass over the ledger, plotted on
`02_program_performance`.

Two ledger fields also stay deliberately simple relative to GAS: there is no `tags_json`
(see above), and no `resolved_episodes` table, so a `vuln_key` has exactly one lifecycle row and
a reopen overwrites the previous episode's dates rather than archiving them. `reopened_count`
records that it happened; the earlier episode's `resolved_at` is not kept.
