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
