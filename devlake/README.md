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

## Running the tests

`devlake/` is intentionally outside the root `pyproject.toml`'s `testpaths = ["tests"]`, so run
it explicitly from the repo root:

```bash
SPARK_LOCAL_IP=127.0.0.1 python3 -m pytest devlake/tests -q
```

Needs `pyspark` and `delta-spark` installed (from either fork's `requirements.txt`) plus
`devlake/requirements.txt`'s own deps for the later steps (`duckdb`, `ipykernel`, `nbclient`,
`pyyaml`; `jupyterlab` only if you want `jupyter lab brick/notebooks` for interactive use — no
test imports it). Tests `importorskip` both `pyspark` and `delta` and skip cleanly if either is
missing.

Never run more than one Spark JVM at a time on a small box — check nothing else is mid-suite
(`pgrep -f "pytest brick"`) before starting these.
