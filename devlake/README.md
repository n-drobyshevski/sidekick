# devlake

A local Spark+Delta lake for developing `brick/` and `brick/devsecops/` off Databricks.
**Dev-only, never deployed** — neither fork's `requirements.txt` names anything here, and the
Asset Bundle (`brick/databricks.yml`) points at the fork directories directly.

## Why this exists

The two forks are already mature PySpark + Delta pipelines with their own test suites, but
until now nothing ran the *whole* `main()` against a real catalog-mode register locally, and
nothing let the shipped notebooks run off Databricks. This package is the harness for that: one
`SparkSession` per lake directory, a re-registration step so a fresh process can find tables an
earlier process created, and (in later steps) a fake Wiz transport and IPython/`dbutils` shims.

## The fork rule

`brick/` and `brick/devsecops/` define the same module names (`config`, `ingest`,
`run_pipeline`, ...) in different files. A `sys.path` holding both directories resolves a bare
`import config` to whichever came first — half of one pipeline and half of the other, with no
error. `devlake.session.put_fork_on_path` refuses to put a second fork's directory on
`sys.path`, and refuses if any fork module name is already imported from a different directory.
Exactly one fork is ever active in a process; use two processes (or `subprocess`) to run both.
`devlake` itself has to live at the repo root rather than inside either fork directory for
exactly this reason — a fork directory can only ever host that one fork.

## The jar pin

`devlake.session.jar_coordinate()` derives the Ivy coordinate from
`importlib.metadata.version("delta-spark")` rather than hardcoding it. The Python package and
the jar are one release; a hardcoded pin drifting out of step with the installed package is
exactly what broke `csvstore` restore under Spark 3.5.9 (see the fork conftests). Both fork
`tests/conftest.py` files still hardcode `DELTA_PACKAGE` — `test_lake.py` checks they at least
name the same MAJOR.MINOR line as whatever is installed, not exact equality, since the patch
pin is a separate step.

## The builder limitation, and why DDL pre-creation exists

`create_clustered` (production code, called by `ensure_tables` and `build_metrics`) creates a
table through the Python `DeltaTable.createIfNotExists(spark).tableName(...)` builder. That
builder parses its argument with Spark's *two-part* `TableIdentifier` grammar, so
`spark_catalog.wiz.wiz_os_vuln_ledger` fails `[PARSE_SYNTAX_ERROR]` on the second dot — a
delta-spark-OSS limitation, not a catalog or schema problem (see
`brick/tests/test_catalog_mode.py`). Every other statement the pipeline issues (`saveAsTable`,
`MERGE INTO`, `DELETE`, `OPTIMIZE`, `CREATE SCHEMA`, `spark.catalog.tableExists`) takes a
three-level name locally without complaint.

`devlake.lake.precreate_clustered` creates the same physical table — same schema, same
`CLUSTER BY`, same `delta.enableDeletionVectors` — through SQL DDL instead, which parses a
three-level name fine. Because `create_clustered` short-circuits on `table_exists`,
pre-creating a table this way before `main()` runs makes production code run against it
*unchanged*: it finds the table already there and never calls the builder. `silver` is the one
table this cannot precreate — its schema is not a declared constant anywhere, only whatever
`metrics.silver_findings` projects for a given scan's rows — so it is left for a caller with
real scan data in hand (a later step) to precreate the same way.

## Managed on first boot, external after

Spark's in-memory catalog (no `enableHiveSupport()`) lives and dies with the `SparkSession`.
A table created in one process is, to a fresh process pointed at the same warehouse directory,
just a directory again — the Delta log on disk still has every commit, but nothing in the new
catalog knows the name. `devlake.lake.reregister` runs the same
`CREATE TABLE ... USING DELTA LOCATION` recipe `brick/README.md` documents for moving a
register into a real catalog, on every local boot.

The first `CREATE TABLE` a lake ever does (no restart yet) makes a table *managed* — no
`LOCATION`, Spark picks the path. Every reregistration after a restart passes `LOCATION`
explicitly, which makes the table *external* from then on. Locally, the practical difference is
`DROP TABLE`: on an external (reregistered) table it removes the catalog entry and leaves the
Delta directory on disk untouched; on the original managed table it would have deleted the data
too. Nothing here relies on either behaviour — it is a caveat for anyone who runs `DROP TABLE`
by hand against a restarted lake.

## Run a fake scan

`devlake/fakewiz.py` and `devlake/run.py` let a fork's real `run_pipeline.main()` run end to
end against a fake Wiz GraphQL server, with no network call and no credentials -- ingest,
`ensure_schema`, `recorded_scan`, `clear_scan`, MERGE and the four gold tables all run exactly as
a Databricks Job would run them.

```bash
SPARK_LOCAL_IP=127.0.0.1 python3 -m devlake.run --fork=brick --scope=os --scans=2 --lake=/tmp/lakecheck
SPARK_LOCAL_IP=127.0.0.1 python3 -m devlake.run --fork=devsecops --scope=sca --scans=2 --lake=/tmp/lakecheck
SPARK_LOCAL_IP=127.0.0.1 python3 -m devlake.run --fork=devsecops --scope=sast --scans=2 --lake=/tmp/lakecheck
```

Each runs `--scans` scans a day apart, starting `2026-06-01T00:00:00Z`, through the fork's
committed fixture (`devlake.run.default_fixture`), then prints the `scans` log and the
`resolution_src` split. Measured on the committed fixtures:

```
-- scans --                                          -- resolution_src split (ledger) --
scan_id  scope  total  new_count  resolved_count      resolution_src  count
scan-1   os     4      4          2                   NULL            1
scan-2   os     3      0          1                   api             2
                                                        disappeared     1

scan-1   sca    54     54         12                  NULL            21
scan-2   sca    27     0          21                   api             12
                                                        disappeared     21

scan-1   sast   40     40         0                    (sast: 0 resolved either scan --
scan-2   sast   40     0          0                     the committed capture has no
                                                         resolvedAt and this run's scan 2 is
                                                         the same 40 nodes again)
```

**The seam is `ingest._post`.** `devlake.fakewiz.FakeWiz` replaces it with an in-memory,
paginated server that answers under the right connection (`vulnerabilityFindings` for
`os`/`sca`, `sastFindings` for `sast`) and, before answering, validates that `filterBy` is
shaped the way *this scope's* filter type actually wants it -- reading
`config.OBJECT_FILTERS` when the fork has one (devsecops) and the equivalent single-connection
table when it does not (brick). A mismatch (SAST's `severity` sent SCA's way, or vice versa)
raises the same `RuntimeError` `ingest._post` itself raises on a live HTTP 400, formatted
through the fork's own `describe_errors` -- so a wrong shape is loud, the way it would be
against the real tenant, rather than a silent empty page. `devlake.run.scan(fork, scope, nodes,
...)` is the one-call harness around it: it puts the requested fork on `sys.path` (switching
away from whichever fork was there before, if any), precreates the tables
`create_clustered`'s builder cannot parse a three-level name for (`lake.precreate_clustered`
for `ledger`/`bronze`, the new `lake.precreate_silver` for `silver` -- see its docstring for why
`silver` needs its own precreation step), installs the fake, and calls `run_pipeline.main()`
with `sys.argv` patched to the parameters a Job would pass.

**The OS fixture's scan-2 slice is not a first-half truncation, and that is measured, not
stylistic.** `os_vulns_response_exemple.json`'s four findings are, in file order, CRITICAL/OPEN,
HIGH/RESOLVED, MEDIUM/OPEN, LOW/RESOLVED. Keeping the first half and dropping the second --
the obvious slice, and the one `brick/tests/test_catalog_mode.py`'s own fixture uses -- resolves
**nothing** by disappearance: the dropped MEDIUM/OPEN finding's severity is outside the default
`CRITICAL,HIGH` scan scope, so `ledger.reconcile`'s guard correctly declines to resolve-by-
disappearance a severity that was never scanned, and the dropped LOW/RESOLVED finding was
already resolved by the API in scan 1, so its absence resolves nothing either. `default_fixture`
instead drops **index 0**, the CRITICAL/OPEN finding, for scan 2 -- CRITICAL is inside the
default scan scope, so its disappearance is exactly what the guard exists to catch, and
`test_end_to_end.py` asserts on it directly. The `sca` fixture needs no such care: a plain
first-half truncation already drops 14 HIGH/OPEN and 7 CRITICAL/OPEN findings, both inside the
default scope, so disappearance fires either way.

## Open the notebooks locally

The shipped notebooks (`brick/notebooks/*.ipynb`, `brick/devsecops/notebooks/*.ipynb`) reference
four things a Databricks cluster provides for free and a laptop Jupyter kernel does not:
`dbutils`, `spark`, `display`/`displayHTML`, and the `%sql` magic. `devlake/notebook.py` supplies
all four **with no edit to any shipped notebook** — `dbx.get_dbutils()`
(`brick/dbx.py:23-39`) already falls back to `get_ipython().user_ns["dbutils"]` when it is not on
Databricks, and this module is what puts a fake `dbutils` there, plus `spark`, `display`,
`displayHTML`, and a `%sql` input transformer that rewrites a `%sql`-led cell into
`display(spark.sql("""..."""))` using the exact same rule
`brick/tests/test_notebooks.py::sql_cells` uses (`devlake.notebook.split_sql_cell` — pinned
against every shipped `.ipynb` in both forks by
`devlake/tests/test_notebook_shims.py::test_the_sql_transformer_splits_exactly_as_the_notebook_test_does`).

**Why a kernel *startup* file, not a documented first cell.** Every notebook's own cell 2 (the
boot cell) calls `panels.context(spark, ...)` with `spark` as a bare, unguarded name — so
anything that installs the shim from *inside* a notebook cell is already too late; cell 2 raises
`NameError` before it would run. `devlake/kernel_startup.py` is written to be dropped into
`<IPYTHONDIR>/profile_default/startup/`, which IPython executes while it boots the shell — before
the kernel accepts its first cell. It is a no-op unless `DEVLAKE_LAKE` is set, so the same
profile works for an ordinary IPython session that has nothing to do with this lake.

**The kernel's working directory is the notebook's, not the repo's, and that broke the shim
entirely until it searched for itself.** A real Jupyter deployment starts the kernel with `cwd`
set to wherever the open `.ipynb` lives (`brick/notebooks`, following the recipe below) — measured,
`cd brick/notebooks && python3 -c "import devlake"` raises `ModuleNotFoundError`, so
`kernel_startup.py`'s own `from devlake import notebook` failed the same way there, and IPython's
`_run_startup_files` swallowed it into one unhelpful log line with **no traceback anywhere**
(`showtraceback()` runs after ipykernel has already redirected `sys.stderr` to its zmq `OutStream`,
so the traceback is published on IOPub before any client has subscribed and is lost — the classic
PUB/SUB slow-joiner). The practical effect: `dbutils`/`spark`/`display`/`displayHTML` were silently
never defined, and every cell failed with a plain `NameError` that looked identical to the one
real notebook bug below. `kernel_startup.py` now searches upward from the kernel's own `cwd` for
the directory holding `devlake/__init__.py` (an explicit `DEVLAKE_REPO_ROOT` env var overrides the
search) before importing `devlake`, and writes any remaining failure straight to `sys.__stderr__`
— the original, pre-redirect stderr object — so a future failure is not silently invisible again.

```bash
# 1. Build a lake to point the notebooks at (see "Run a fake scan" above).
SPARK_LOCAL_IP=127.0.0.1 python3 -m devlake.run --fork=brick --scope=os --scans=2 --lake=/tmp/lakecheck

# 2. Wire the startup file into a throwaway IPython profile.
mkdir -p /tmp/devlake-ipython/profile_default/startup
cp devlake/kernel_startup.py /tmp/devlake-ipython/profile_default/startup/00-devlake.py

# 3. Point Jupyter's kernel at the lake and start it up. WIDGET_<NAME> seeds a widget's value
#    exactly as if you had typed it into the notebook's own widget bar -- catalog has no
#    default (panels.BASE_WIDGETS), so it (and schema/scope) need to be set here or in cell 1.
export IPYTHONDIR=/tmp/devlake-ipython
export DEVLAKE_LAKE=/tmp/lakecheck
export DEVLAKE_SCHEMA=wiz
export DEVLAKE_FORK=brick        # or devsecops
export SPARK_LOCAL_IP=127.0.0.1
export WIDGET_CATALOG=spark_catalog
export WIDGET_SCHEMA=wiz
export WIDGET_SCOPE=os
jupyter lab brick/notebooks
```

Open any notebook and run cells top to bottom — no widget dialog needed the first time, since
`WIDGET_*` seeded them before the kernel booted (Databricks' own rule applies from here on: a
widget that already exists keeps its value, so change a filter through the widget bar, not by
re-exporting the env var, once the kernel is running).

Equivalently, from a running kernel that already has `spark` some other way (or one you built by
hand), `%load_ext devlake.notebook` reads the same `DEVLAKE_LAKE` / `DEVLAKE_SCHEMA` /
`DEVLAKE_FORK` env vars, builds the session, reregisters the lake, and installs the shim —
`devlake.kernel_startup` is a one-line wrapper around exactly this call, run automatically at
IPython startup instead of by hand.

**Measured, and it does NOT pass**: `brick/notebooks/00_security_posture.ipynb`, run this way
against a two-scan lake via `nbclient.NotebookClient` in a real `ipykernel` subprocess (its own
JVM — see `devlake/tests/test_notebook_shims.py::test_a_shipped_notebook_executes_top_to_bottom`,
currently red), fails on cell 2 — the shared boot cell every page notebook uses — with
`NameError: name 'panels' is not defined`. The cell's own first line reads
`PAGE = {"group_by": ("subscription_name", panels.GROUP_DIMENSIONS)}`, referencing `panels`
*before* the `import panels, figures, tiles` line further down the same cell. This is a defect in
the shipped notebook's own source, not a gap in this shim: the shim's job is to fake the four
Databricks-only globals (`dbutils`, `spark`, `display`/`displayHTML`) and the `%sql` magic, all of
which are present and working by the time cell 2 runs (`dbx.get_dbutils()` resolves, `spark` is
bound) — `panels` itself is a plain `import` the cell issues for itself, two lines below the line
that already needs it. No environment can make that name resolve before its own `import`
statement executes; a fresh Databricks cluster attach would hit the identical `NameError` on this
exact cell. `01_mttr_sla.ipynb` — the one notebook with a `%sql` cell over `v_mttr` — was also
measured and fails on the same line for the same reason (see
`devlake/tests/test_notebook_shims.py::test_measure_mttr_sla_notebook_also_runs`, which reports it
as a skip rather than a hard failure since it is explicitly informational). Neither notebook has
been edited to fix this — that is a `brick/notebooks/` change, out of scope here — so both
findings stand as reported.

## Query the lake with DuckDB

DuckDB's `delta` extension reads a Delta table straight off disk, no Spark involved — including
the deletion-vector-enabled, `CLUSTER BY`-clustered ledger table this pipeline writes:

```bash
python3 -c "
import duckdb
con = duckdb.connect()
con.execute('INSTALL delta')
con.execute('LOAD delta')
print(con.execute(\"SELECT count(*) FROM delta_scan('file:///tmp/lakecheck/wiz.db/wiz_os_vuln_ledger')\").fetchone())
print(con.execute(\"SELECT count(*) FROM delta_scan('file:///tmp/lakecheck/wiz.db/wiz_os_vuln_ledger') WHERE status='OPEN'\").fetchone())
"
```

**Measured** (`duckdb 1.5.5`, this container): both queries above return the exact same row
counts DuckDB reads directly off disk as Spark reports from its own `.count()` over the same
table, and the same is true of the append-only `scans` log (no deletion vectors at all) — see
`devlake/tests/test_notebook_shims.py::test_duckdb_reads_the_clustered_ledger_with_deletion_vectors`,
which asserts both and fails with the DuckDB version and the exact exception if either stops
matching, naming which half (deletion vectors, or `delta_scan` itself) is responsible. No
`CLUSTERING` knob was needed in `run_pipeline.py` to make this work — the ledger's
`delta.enableDeletionVectors=true` table read correctly as shipped.

## Running the tests

`devlake/` is intentionally outside the root `pyproject.toml`'s `testpaths = ["tests"]`, so run
it explicitly from the repo root:

```bash
SPARK_LOCAL_IP=127.0.0.1 python3 -m pytest devlake/tests -q
```

Needs `pyspark` and `delta-spark` installed (from either fork's `requirements.txt`) plus
`devlake/requirements.txt`'s own deps for the notebook/DuckDB steps (`duckdb`, `ipykernel`,
`nbclient`, `pyyaml`; `jupyterlab` only if you want `jupyter lab brick/notebooks` for interactive
use — no test imports it). Tests `importorskip` both `pyspark` and `delta` and skip cleanly if
either is missing; the notebook-execution tests additionally `importorskip` `nbformat`/`nbclient`
(`nbformat` arrives as `nbclient`'s own transitive dependency, so installing `nbclient` is
enough).

Never run more than one Spark JVM at a time on a small box — check nothing else is mid-suite
(`pgrep -f "pytest brick"`) before starting these. The notebook-execution test starts a
**second** JVM of its own (a real `ipykernel` subprocess, separate from the one this test file's
own fixtures use) — its lake-building fixture stops its Spark session before that subprocess
boots for exactly this reason.
