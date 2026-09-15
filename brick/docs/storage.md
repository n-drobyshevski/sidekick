# Running it off Databricks

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
it. That is `devlake/`, at the repo root; see [`devlake/README.md`](../../devlake/README.md).

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
> [Running on Databricks](deploy.md) — the catalog is the supported home for
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
`MERGE`d, and the clustering and deletion vectors from [Table layout](register.md#table-layout) are
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

An export with **no** manifest is read unverified rather than refused — one written by an older
version is not automatically torn, and the failure worth catching is silence about a register
that is. `tests/test_csvstore.py` pins both halves of that. The posture behind it, and why the
manifest cannot make the write atomic but can make a torn one detectable, is written down at
`csvstore.MANIFEST`.

### The schema sidecar, which is the other whole point

Each table is written as **two** files: `<table>.csv` and `<table>.schema.json`, the Spark schema
verbatim. Reading goes back through that schema rather than through inference.

CSV has no types. A blank cell is indistinguishable from an empty string, and Spark's own
behaviour on that has changed across releases
([SPARK-17916](https://issues.apache.org/jira/browse/SPARK-17916)). That ambiguity lands exactly
on `has_kev` / `has_exploit` / `epss`, where — per
[Three things that are easy to get wrong](reading-the-numbers.md#three-things-that-are-easy-to-get-wrong) — a NULL read
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
