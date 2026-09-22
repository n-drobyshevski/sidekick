# Running it on Databricks


**Requirements:** DBR 14.3 LTS or newer (Spark 3.5 — `F.percentile` is a 3.5 function; liquid
clustering is supported from DBR 13.3 but only **GA from 15.4 LTS**, so on 14.3 the
[table layout](register.md#table-layout) works and is pre-GA), and Unity Catalog if you want a three-level
`catalog.schema.table` namespace. `requests` is already on the runtime. Nothing else to install.

## 1. Store the credentials

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

## 2. Get the code onto the workspace

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

> **Replace all six together.** The pipeline's first real run past the flat-snapshot version
> hit exactly this: 137,870 findings ingested, then *"A schema mismatch detected when writing to
> the Delta table"*. Why the modules only move in lockstep, and what `MODULE_VERSION` does about
> it, is written down at `config.PIPELINE_VERSION`.

To read the [notebooks](notebooks.md) as well as run the pipeline, five more files go on the same
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

### Check the upload landed

Cheap, and it catches both a missed file and the `sys.path` shadowing described under
[Layout](internals.md#layout) — the printed path tells you which `config.py` actually won:

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

## 3a. From a notebook

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

## 3b. As a Databricks Asset Bundle

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

## Parameters

Resolved in this order: `--name=value` on the command line, then `dbutils.widgets.get(name)`,
then the `NAME` environment variable, then the default. One code path covers Jobs, notebooks
and a laptop.

| Name | Default | |
| --- | --- | --- |
| `catalog` | — | **required**, no default; `hive_metastore` on a workspace without Unity Catalog |
| `schema` | `wiz` | created only if it does not already exist |
| `scope` | `os` | `os`, `sca` or `sast` — see [Scopes](register.md#scopes) |
| `table_prefix` | `wiz_` | pass empty to use bare table names |
| `project_id` | — | optional project restriction (`projectIdV2` / `projectId`, per scope) |
| `wiz_api_url` | — | **required**, `https://api.<region>.app.wiz.io/graphql` |
| `wiz_auth_url` | `https://auth.app.wiz.io/oauth/token` | override for a dedicated tenant |
| `secret_scope` | — | scope holding `wiz-client-id` / `wiz-client-secret` |
| `severities` | `CRITICAL,HIGH` | comma-separated; also recorded per scan and used by the disappearance guard |
| `scan_id` | a random id | pass `{{job.run_id}}-<scope>` on a scheduled Job, distinct per scope — see [Retries](#retries-are-safe-if-you-pass-scan_id) |
| `disappearance` | `scan_ts` | `scan_ts` or `midpoint` |
| `rebuild_ledger` | `false` | replay bronze and rebuild the ledger from scratch — see [Backfill](migrating.md#backfilling-from-existing-bronze) |
| `shuffle_partitions` | `0` | `spark.sql.shuffle.partitions` for the run; `0` leaves the cluster's own setting alone |
| `maintain` | `false` | run `OPTIMIZE` over the clustered tables and exit, ingesting nothing — see [Maintenance](#maintenance) |
| `data_path` | — | write the register to this directory instead of a catalog — see [Fallback storage](storage.md#fallback-storage-running-with-no-catalog). With it set, `catalog` is not required |
| `export_csv` | — | write every table to this directory as typed CSV and exit, ingesting nothing — see [The CSV register](storage.md#the-csv-register-legacy) |
| `csv_path` | — | **make this directory the register**: restore it into Delta before the scan, export it back after. Implies no catalog, and a disposable Delta scratch — see [The CSV register](storage.md#the-csv-register-legacy) |
| `csv_include_bronze` | `false` | include bronze in the export. Large, and nothing reads it back |
| `csv_restore` | — | write a CSV export back out as the Delta register and exit. Overwrites — see [The CSV register](storage.md#the-csv-register-legacy) |

`shuffle_partitions` is the one parameter that changes nothing about any published number, and
it is unset by default on purpose. Spark's 200 is sized for a cluster moving real data, and a
run here is a few dozen aggregations over one scan on the single-node cluster this README
recommends — so a smaller number looks like free speed. Measured, it is not: over three runs a
side at 20,000 findings, `64` produced the fastest single run and the tightest spread but a
*worse* median than 200. Tune it against your own register with
[`tools/bench_pipeline.py`](internals.md#benchmarking) rather than trusting either number.

## Retries are safe, if you pass `scan_id`

Reconciling one scan twice would advance every lifecycle a second time, so a retry must be
recognisable as a retry. Databricks retries a failed task **within the same run**, so
`--scan_id={{job.run_id}}-<scope>` makes the second attempt arrive with the id the first one
used — `{{job.run_id}}` is retry-stable and the `-<scope>` suffix is what keeps three scopes'
commit rows from colliding in the shared `…metrics`, now that they share one job run and one
table; see [3b. As a Databricks Asset Bundle](#3b-as-a-databricks-asset-bundle). The run then
finds its own `family='scan'` row in `…metrics` (`recorded_scan`, itself filtered to this
`scope`) and — unless that scan's gold went missing, in which case it republishes just that, see
[The scan record is load-bearing](register.md#the-scan-record-is-load-bearing) — does nothing further.

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

## Maintenance

```bash
python brick/run_pipeline.py --catalog=<catalog> --scope=os --maintain=true \
  --wiz_api_url=https://api.<region>.app.wiz.io/graphql
```

`--maintain` runs `OPTIMIZE` over the two [clustered tables](register.md#table-layout) — shared by every
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
[What this does not do](reading-the-numbers.md#what-this-does-not-do). `OPTIMIZE` only ever adds files, so the worst a
bad run of this can do is cost money.

On Unity Catalog managed tables you may not need it at all: Databricks **Predictive
Optimization** runs `OPTIMIZE` for you, and where it is enabled `--maintain` is redundant.

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
[Reading coverage and efficiency](reading-the-numbers.md#reading-coverage-and-efficiency). How much of it is the rule
is not a table to query: nothing named `metrics_sensitivity` is published — the sweep is on the
notebook page, not in the register. `panels.rule_sweep(spark, ctx)` recomputes coverage and
efficiency under each of the seven non-empty signal subsets from `v_lifecycles` at read time,
and `02_program_performance` is where it renders.

The run itself prints the `mttr` and `program` families by severity — MTTR/SLA and coverage and
efficiency with the rule-sensitivity sweep beside them (recomputed, not read back from a table)
— and the most recent `capacity` months for each population.

To read the numbers rather than query them, open the [notebooks](notebooks.md).

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
