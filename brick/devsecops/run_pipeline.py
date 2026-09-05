"""Databricks entry point: Wiz API -> bronze -> silver -> four gold metric tables.

Run it as a Job (Python file task) or call ``main()`` from a notebook. Parameters resolve in
this order, so the same file works in all three places:

    1. ``--name=value`` on the command line   -- how a Job's Python file task receives them
    2. ``dbutils.widgets.get(name)``          -- how a notebook receives them
    3. the ``NAME`` environment variable      -- how a laptop receives them

These are plain top-level modules, not a package: the directory holding them goes on
``sys.path`` and they import each other by bare name. That keeps the Databricks side a flat
folder of files with no ``__init__.py`` and no nesting to reproduce by hand.

Tables written. ``<p>`` is the table prefix, ``wiz_<scope>_`` by default:

    <catalog>.<schema>.<p>findings_raw       bronze   scan_id, scan_ts, scope, seq, node_json
    <catalog>.<schema>.<p>findings           silver   typed findings + mttr_days / age_days
    <catalog>.<schema>.<p>vuln_ledger        base     one row per vuln_key -- MERGEd, not appended
    <catalog>.<schema>.<p>scans              log      one row per run: scope, severities, deltas
    <catalog>.<schema>.<p>metrics_mttr       gold     scan_id x severity (+ OVERALL)
    <catalog>.<schema>.<p>metrics_program    gold     scan_id x severity (+ OVERALL)
    <catalog>.<schema>.<p>metrics_capacity   gold     scan_id x month x population
    <catalog>.<schema>.<p>metrics_sensitivity gold    scan_id x signal subset

Bronze, silver and the four gold tables are appended -- each run adds a ``scan_id``, so they
accumulate into a trend. The ledger is the exception and the point of v2: it is MERGEd, so a
vulnerability keeps one row and one history no matter how many times it is scanned.

``metrics_capacity`` carries every month **twice**, once per ``population`` -- ``all`` for
backlog throughput and ``high_risk`` for the net flow P2P v3 actually defines. Any query
against it that does not filter on ``population`` doubles every count.

Bronze keeps the finding as a JSON string: a Wiz schema change can then never fail ingest,
and silver is just the typed projection of whatever arrived.

**Where the gold numbers come from.** v1 computed them from one snapshot, which meant a finding
remediated by disappearing from the API was never counted as resolved at all. They now come from
the ledger's observed lifecycles instead (``ledger.lifecycle_frame``). The snapshot figures are
still computed and published beside them as ``snap_*`` columns -- the gap between ``km_median``
and ``snap_km_median`` is the size of what v1 was missing.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from typing import Optional

from pyspark.sql import Row, SparkSession
from pyspark.sql import functions as F

MODULE_VERSION = "1.0-devsecops"

# The six runtime modules move in lockstep, and the documented way to deploy them is pasting
# files into a Workspace folder one at a time -- so a half-updated folder is the likely failure,
# not a rare one. Import errors here are re-raised naming that cause, because the bare messages
# point somewhere unhelpful: a folder still on v1 gives "No module named 'ledger'" or "cannot
# import name 'DISAPPEARANCE_MODES' from 'config'", neither of which says "your upload is
# incomplete". check_deployment() below catches the subtler case where every import succeeds.
try:
    import dbx
    import ledger as ledger_mod
    import metrics
    from config import (
        default_fetch_severities,
        rule_for_scope,
        DEFAULT_SCOPE,
        DISAPPEARANCE_MODES,
        DISAPPEARANCE_RESOLUTION,
        PIPELINE_VERSION,
        POPULATION_ALL,
        POPULATION_HIGH_RISK,
        SCANS_COLUMNS,
        SCOPES,
        SEVERITY_ORDER,
    )
    from ingest import DEFAULT_AUTH_URL, fetch_findings, get_token, new_session, secret
except ImportError as exc:
    # The message is long on purpose: it is the recovery procedure, and it is read by someone
    # staring at a stack trace on a cluster with no repo checkout to hand.
    raise ImportError(
        f"{exc}\n\n"
        f"brick's runtime modules must all come from the same version. This error is what a "
        f"partially updated workspace folder looks like -- most often one still missing "
        f"ledger.py, which v2 added.\n"
        f"Fix: copy ALL SIX of config.py, dbx.py, ingest.py, ledger.py, metrics.py and "
        f"run_pipeline.py into the folder, then run dbutils.library.restartPython(). "
        f"See brick/README.md section 2."
    ) from exc

BRONZE_TABLE = "findings_raw"
SILVER_TABLE = "findings"
LEDGER_TABLE = "vuln_ledger"
SCANS_TABLE = "scans"
GOLD_MTTR = "metrics_mttr"
GOLD_PROGRAM = "metrics_program"
GOLD_CAPACITY = "metrics_capacity"
GOLD_SENSITIVITY = "metrics_sensitivity"
# P2P v5's asset-centric family. See metrics.asset_profile.
GOLD_ASSETS = "metrics_assets"

# The append-only tables, i.e. everything except the ledger. A retry writes a scan_id that a
# failed attempt may already have partly written, so these are cleared for that scan_id first.
APPEND_TABLES = (
    BRONZE_TABLE,
    SILVER_TABLE,
    GOLD_MTTR,
    GOLD_PROGRAM,
    GOLD_CAPACITY,
    GOLD_SENSITIVITY,
    GOLD_ASSETS,
)

# APPEND_TABLES name -> the Tables attribute holding its fully-qualified name. Kept beside the
# tuple rather than inline in clear_scan: a table added to one and not the other is a KeyError
# on the retry path only, which is the path nobody exercises until it matters.
APPEND_TABLE_ATTRS = {
    BRONZE_TABLE: "bronze",
    SILVER_TABLE: "silver",
    GOLD_MTTR: "mttr",
    GOLD_PROGRAM: "program",
    GOLD_CAPACITY: "capacity",
    GOLD_SENSITIVITY: "sensitivity",
    GOLD_ASSETS: "assets",
}

# Every `Tables` attribute, in the order a reader wants them. Defined here rather than in
# `csvstore` -- which is what consumes it -- because it is a statement about the dataclass
# below, and `csvstore` already imports this module. One list, so a table added to `Tables` and
# forgotten in an export is a name error at import rather than a gap in a backup.
TABLE_ATTRS = (
    "scans",
    "ledger",
    "mttr",
    "program",
    "capacity",
    "sensitivity",
    "assets",
    "silver",
    "bronze",
)

# Every module that has to be deployed for a run, including this one. The README's file tree
# is checked against this list by the test suite, so the deployment instructions cannot drift
# away from what the code actually imports -- which is exactly how v2 shipped with a five-file
# tree after adding a sixth module.
RUNTIME_MODULES = ("config", "dbx", "ingest", "ledger", "metrics", "run_pipeline")

# The notebook presentation layer. Deliberately NOT in RUNTIME_MODULES: a scheduled Job must
# never fail for want of plotly, and `main()` has no business importing a chart library. The
# guard below treats them asymmetrically -- absent is fine, present and disagreeing is fatal --
# because a stale figures.py beside a fresh metrics.py draws a chart that contradicts the number
# printed above it, which is the same class of bug with a quieter failure.
NOTEBOOK_MODULES = ("panels", "figures", "tiles")

# Storage tooling, treated exactly like the notebook layer and for the same reason: `csvstore`
# writes both the export and (on restore) the register itself, so a stale copy beside a fresh
# `ledger.py` is as fatal as a stale metrics.py -- but a scheduled Job must never fail because
# a module it does not import is missing from the folder. Absent is fine; present and
# disagreeing is not.
#
# `brick/import_bundle.py` has no counterpart here on purpose: the GAS app scans one Wiz project
# for vulnerability findings on hosts, so there is no code-register history to seed from.
#
# `csvstore` is imported lazily by `export_csv` rather than at module scope, so a Job that never
# passes `--csv_path` neither needs the file nor pays for it.
MIGRATION_MODULES = ("csvstore",)

# The optional layers share one rule, so they share one loop in check_deployment.
OPTIONAL_MODULES = NOTEBOOK_MODULES + MIGRATION_MODULES


def check_deployment() -> None:
    """Refuse to run against a folder holding a mix of versions.

    Every import can succeed and the versions still disagree -- v1's run_pipeline.py imports
    happily alongside v2's metrics.py, and the pair only comes apart at the silver write, after
    a full API sweep. That is what happened on the first real v2 run: 137,870 findings ingested,
    then "A schema mismatch detected when writing to the Delta table", which names neither the
    stale file nor the fix.

    **This fork checks a second thing, and it is the more likely failure here.** Every module
    in this directory has the same name as one in ``brick/`` -- `config`, `metrics`, `ledger`,
    all of them -- so a ``sys.path`` holding both directories resolves each import to whichever
    came first. You get half of one pipeline and half of the other: `brick`'s `config` (whose
    SCOPES have no `sca`) with this `metrics` (whose silver projection expects one), and the
    run dies somewhere unrelated-looking. The version strings cannot collide (`1.0-devsecops`
    against `2.3`), which catches the common case, but two forks that happened to share a
    version would not -- so the directory each module was actually loaded from is checked too.

    Called at the top of ``main()``, before Spark: a bad folder should cost a second, not a
    cluster start and an API sweep.
    """
    _check_one_directory()
    versions = {"run_pipeline": MODULE_VERSION}
    for name in RUNTIME_MODULES:
        if name == "run_pipeline":
            continue
        module = sys.modules.get(name)
        # getattr with a default, not attribute access: a v1 module has no MODULE_VERSION at
        # all, and an AttributeError here would be exactly the confusing shape this exists to
        # prevent.
        versions[name] = getattr(module, "MODULE_VERSION", None) if module else None

    # The optional layers, asymmetrically: a module nobody imported is not a problem, because a
    # Job never needs one. One that IS imported and disagrees is the same fatal mix.
    for name in OPTIONAL_MODULES:
        module = sys.modules.get(name)
        if module is not None:
            versions[name] = getattr(module, "MODULE_VERSION", None)

    stale = sorted(name for name, version in versions.items() if version != PIPELINE_VERSION)
    if not stale:
        return

    detail = ", ".join(f"{name}={versions[name] or 'absent'}" for name in stale)
    raise RuntimeError(
        f"Mixed devsecops deployment: {detail} (expected {PIPELINE_VERSION}). These modules "
        f"must all come from the same version, and a mismatch is usually one of two things: a "
        f"half-updated folder, or `brick/` on sys.path ahead of this directory -- the module "
        f"names are identical, so the wrong one wins silently.\n"
        f"Fix: copy ALL SIX of {', '.join(n + '.py' for n in RUNTIME_MODULES)} into ONE folder "
        f"holding no other brick deployment (plus "
        f"{', '.join(n + '.py' for n in NOTEBOOK_MODULES)} if you read the notebooks), then run "
        f"dbutils.library.restartPython(). See brick/devsecops/README.md."
    )


def _check_one_directory() -> None:
    """Every loaded module must have come from this file's own directory.

    The failure this prevents is specific to a fork: `brick/` and `brick/devsecops/` export the
    same module names, so a `sys.path` with both on it silently mixes them. That produces a
    working import and a wrong pipeline, which is the worst of the two available outcomes.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    strangers = {}
    for name in RUNTIME_MODULES + OPTIONAL_MODULES:
        module = sys.modules.get(name)
        origin = getattr(module, "__file__", None) if module else None
        if origin and os.path.dirname(os.path.abspath(origin)) != here:
            strangers[name] = origin
    if not strangers:
        return
    detail = "\n  ".join(f"{name}: {path}" for name, path in sorted(strangers.items()))
    raise RuntimeError(
        f"These modules were imported from outside {here}:\n  {detail}\n"
        f"`brick/` and `brick/devsecops/` use the same module names, so whichever directory is "
        f"first on sys.path wins -- and a mixed pair imports cleanly and then measures the "
        f"wrong thing. Put exactly one of the two on sys.path, with sys.path.insert(0, ...), "
        f"and run dbutils.library.restartPython(). See brick/devsecops/README.md."
    )

# These tables usually land in a schema shared with other teams, where bare names like
# `findings` and `metrics_capacity` are an obvious collision risk. The default prefix also
# carries the scope -- `wiz_sca_findings` -- so the library register and the static-analysis
# register land in separate tables and can never be blended by accident. They measure
# populations with different positive classes, so blending them would be meaningless as well as
# wrong. Pass --table_prefix= (empty) to opt out.
def default_table_prefix(scope: str) -> str:
    return f"wiz_{scope}_"

# Catalog, schema and prefix are interpolated straight into SQL, so they are checked rather
# than trusted. They come from an operator, not an attacker -- but `--schema=wiz;DROP ...`
# should fail with a clear message instead of doing something surprising.
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PREFIX = re.compile(r"^[A-Za-z0-9_]*$")

# A table reference of the form delta.`/some/path`, which is how Spark names a Delta table that
# is not in any catalog. Every read site takes one of these unchanged -- `spark.table()` and
# every `FROM {table}` accept it -- so path mode is invisible above this line. The three writers
# below need the path itself, and this is how they get it back out of the reference.
PATH_REF = re.compile(r"^delta\.`(.+)`$")

#: Prefixes that are wiped when a Databricks cluster terminates. Writing the register to one of
#: these is the single failure this mode exists to prevent, so it is refused rather than warned
#: about -- the data would be gone by the time anyone noticed.
EPHEMERAL_PREFIXES = ("/tmp/", "/local_disk0/", "/databricks/driver")

# `dbfs:/`, `s3://`, `abfss://`, `gs://` -- a storage URI is as valid a home for the register as
# an absolute path, and for two of the three places that persist it is the *only* form Spark
# takes. Requiring a leading slash would have rejected them.
URI_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:/")

#: Named once because two different refusals below have to end with the same advice, and advice
#: that drifts between two error messages is worse than no advice.
PERSISTENT_PATHS = (
    "Use somewhere that persists and that executors can write: "
    "/Volumes/<catalog>/<schema>/<volume>/... (a Unity Catalog volume is a much smaller ask "
    "than a schema to create tables in), dbfs:/... where DBFS root still exists, or a storage "
    "URI you already hold credentials for (s3://..., abfss://...). "
    "See brick/README.md, PoC storage."
)


@dataclass(frozen=True)
class Tables:
    """The nine table references one run writes to.

    Either fully-qualified ``catalog.schema.name`` (the default) or ``delta.`<path>``` when
    ``--data_path`` is set. Both are valid anywhere Spark wants a table, which is what lets one
    dataclass serve both and every reader in the module stay unaware of the difference.
    """

    bronze: str
    silver: str
    ledger: str
    scans: str
    mttr: str
    program: str
    capacity: str
    sensitivity: str
    assets: str


def as_path(table: str) -> Optional[str]:
    """The filesystem path behind a ``delta.`...``` reference, or ``None`` for a catalog name.

    The reference carries its own path, so nothing has to be threaded alongside it. That is the
    whole of the storage abstraction: three writers ask this question, everything else does not
    need to.
    """
    match = PATH_REF.match(table)
    return match.group(1) if match else None


def table_exists(spark: SparkSession, table: str) -> bool:
    """Whether a table reference resolves to something. Works for both kinds of reference.

    ``spark.catalog.tableExists`` cannot answer for a path -- there is no catalog entry to find
    -- so a path reference is asked of Delta directly.
    """
    path = as_path(table)
    if path is None:
        return spark.catalog.tableExists(table)
    from delta.tables import DeltaTable

    return DeltaTable.isDeltaTable(spark, path)


@dataclass(frozen=True)
class RunResult:
    """What a run produced. Returned by ``main()`` so a notebook has a handle on the tables it
    just wrote -- charting is then a follow-on rather than a second round of guessing at
    names."""

    tables: Tables
    scan_id: str
    scan_ts: str
    scope: str


def param(name: str, default: str = "", argv: Optional[list] = None) -> str:
    """A job parameter: ``--name=value``, then a widget, then ``$NAME``, then the default."""
    prefix = f"--{name}="
    for arg in argv if argv is not None else sys.argv[1:]:
        if arg.startswith(prefix):
            return arg[len(prefix) :]
    return dbx.widget(name) or os.environ.get(name.upper(), default)


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# 0 means "do not set spark.sql.shuffle.partitions at all".
#
# A run is a handful of aggregations over one scan and the README's own deployment note says "a
# single-node cluster is plenty", so Spark's 200 default does look oversized -- most of the
# shuffles here schedule 200 tasks to move a few rows. The obvious move is to ship a smaller
# default, and `brick/bench_pipeline.py` does not support one: over three runs a side at 20,000
# findings, 64 had the fastest single run and the tightest spread but a *worse* median than 200.
# That is a measurement saying "it depends on the cluster", so the number is left to whoever has
# one, and the knob is here to turn.
DEFAULT_SHUFFLE_PARTITIONS = 0


def get_spark(shuffle_partitions: Optional[int] = None) -> SparkSession:
    """The session, configured.

    None of these change a result. Shuffle partitioning does not affect the value of any
    aggregation here -- including ``F.percentile``, which is exact and order-independent -- and
    AQE only re-plans. They are set explicitly rather than left to the runtime because this file
    also runs on a laptop and under ``python brick/run_pipeline.py``, where the Databricks
    defaults do not apply.
    """
    spark = SparkSession.builder.appName("wiz-vulnerability-metrics").getOrCreate()
    # Capacity buckets by UTC calendar month and MTTR is a UTC-to-UTC difference; a cluster
    # left on local time would silently shift findings between months.
    spark.conf.set("spark.sql.session.timeZone", "UTC")
    # On by default in DBR 14.3, not on by default in open-source Spark 3.5. AQE is what lets
    # the eight joins here with a 7-row side be broadcast at runtime without a hint, and what
    # coalesces the oversized shuffles below back down.
    spark.conf.set("spark.sql.adaptive.enabled", "true")
    spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
    if shuffle_partitions is None:
        shuffle_partitions = resolve_shuffle_partitions()
    if shuffle_partitions:
        spark.conf.set("spark.sql.shuffle.partitions", str(shuffle_partitions))
    return spark


# --------------------------------------------------------------- the scan log + the ledger


def serialize_severities(severities) -> Optional[str]:
    """The severity scope of a scan, as stored on the ``scans`` row.

    ``None`` means unscoped -- the run asked Wiz for every severity, so absence of any severity
    is meaningful. That is exactly the distinction ``reconcile``'s scope guard needs, and
    getting it backwards would either freeze every lifecycle or mass-resolve the register.
    """
    values = sorted({s.strip().upper() for s in (severities or []) if s and s.strip()})
    return ",".join(values) if values else None


def parse_severities(text) -> Optional[list]:
    """Inverse of ``serialize_severities``: an ordered list, or ``None`` for unscoped."""
    if not text or not str(text).strip():
        return None
    chosen = {s.strip().upper() for s in str(text).split(",") if s.strip()}
    return [s for s in SEVERITY_ORDER if s in chosen] or None


# The clustering key for each table that has one, and whether it carries deletion vectors.
#
# `vuln_key` is the MERGE's ON key and `scan_id` is what every read of bronze and silver filters
# on. The four gold tables and the scan log are deliberately absent: they are 9-150 rows per
# scan, orders of magnitude under the size at which a write clusters anything, so clustering
# them would buy a protocol bump and nothing else.
#
# Deletion vectors are the half of this meant to pay. Without them a MERGE that matches a row
# rewrites the whole file containing it, so the daily reconcile rewrites most of the ledger to
# advance `last_seen` on findings that have not changed. They are set explicitly rather than
# left to a default because the two runtimes disagree: Databricks turns DVs on for a clustered
# table, open-source Delta does not, and a cluster running a different configuration from the
# tests is how a number becomes unreproducible.
#
# **Measured, they cost rather than pay** -- ~5% for the clustering and ~12% more for the DVs,
# on a ledger of ~25k rows. That is the scale, not the idea: rewriting a few-megabyte file is
# nearly free, so there is no amplification to avoid and the DV bookkeeping is all cost. The
# README's "What this measured" section has the numbers and the condition under which it
# inverts. Turning DVs off here is one word, and on a small register it is the right word.
#
# Off for bronze and silver on purpose. Both are append-only -- no MERGE, no UPDATE, one
# `DELETE ... WHERE scan_id` on the retry path -- so there is nothing for DVs to make cheaper,
# and leaving them off keeps those two tables at reader version 1. Only DVs push the reader
# version to 3; clustering alone needs writer 7 and leaves readers alone.
CLUSTERING = {
    "ledger": ("vuln_key", True),
    "bronze": ("scan_id", False),
    "silver": ("scan_id", False),
}


def create_clustered(spark: SparkSession, table: str, schema, attr: str) -> None:
    """``CREATE TABLE IF NOT EXISTS`` with this table's clustering spec. No-op if it exists.

    The ``DeltaTable`` builder rather than SQL DDL because it takes a ``StructType`` outright:
    there is no DDL string to render, and so no hand-rolled type-name mapping to get wrong, and
    ``vuln_key``'s ``NOT NULL`` survives (a CTAS would drop it).

    ``delta.tables`` is imported here rather than at module scope on purpose. ``run_pipeline``
    has to stay importable with no delta-spark installed -- that is what lets ``test_figures``,
    ``test_tiles`` and ``test_pipeline`` run in seconds with no JVM at all.

    **Existing registers are not migrated.** This only fires when the table is absent, so a
    deployment that already has these tables keeps its unclustered layout until someone runs
    the ALTER TABLE recipe in the README. Enabling clustering on an existing table is an
    owner-level operation and not one to perform silently on the next scheduled run.
    """
    if table_exists(spark, table):
        return
    from delta.tables import DeltaTable

    if isinstance(schema, str):
        schema = spark.createDataFrame([], schema).schema
    cluster_by, deletion_vectors = CLUSTERING[attr]
    builder = DeltaTable.createIfNotExists(spark)
    # A path-backed table is created at a location instead of under a name. Everything else --
    # the schema, the clustering spec, the deletion-vector property, the resulting reader and
    # writer versions -- comes out identical, which is what makes the two modes interchangeable
    # and the `CREATE TABLE ... USING DELTA LOCATION` migration lossless.
    path = as_path(table)
    builder = builder.location(path) if path else builder.tableName(table)
    (
        builder.addColumns(schema)
        .clusterBy(cluster_by)
        .property("delta.enableDeletionVectors", "true" if deletion_vectors else "false")
        .execute()
    )


def ensure_tables(spark: SparkSession, tables: Tables) -> None:
    """Create the ledger and scan-log tables when they are missing.

    Created from the schema rather than by a first append, because the ledger has to be a Delta
    table before anything can MERGE into it, and because an empty ledger with the right columns
    is what makes the very first run's reconcile a normal case rather than a special one.

    Bronze and silver are **not** created here even though they are clustered too. They are
    created by whatever first writes them -- see ``ingest_to_bronze`` and ``build_metrics`` --
    so that a register which has never been scanned does not acquire an empty bronze and start
    looking as though it has. ``rebuild_ledger`` depends on that distinction: "there is no
    bronze" is how it knows there is no history to replay.
    """
    create_clustered(spark, tables.ledger, ledger_mod.LEDGER_SCHEMA, "ledger")
    if not table_exists(spark, tables.scans):
        empty = spark.createDataFrame([], SCANS_SCHEMA).write.format("delta")
        path = as_path(tables.scans)
        empty.save(path) if path else empty.saveAsTable(tables.scans)


SCANS_SCHEMA = (
    "scan_id STRING, scan_ts TIMESTAMP, scope STRING, severities STRING, total LONG, "
    "new_count LONG, resolved_count LONG, reopened_count LONG"
)


def write_append(df, table: str) -> None:
    """Append a frame to one of the scan-stamped tables.

    Always Delta, explicitly: the pipeline needs MERGE and DELETE, so relying on the session's
    default format would work on Databricks and quietly produce Parquet anywhere else.
    mergeSchema because v2 adds columns to tables a v1 run already created.

    A path-backed table is saved rather than saved-as-table. That is the only difference; the
    append itself, including the clustering it preserves, is the same operation.
    """
    writer = df.write.format("delta").mode("append").option("mergeSchema", "true")
    path = as_path(table)
    writer.save(path) if path else writer.saveAsTable(table)


def recorded_scan(spark: SparkSession, tables: Tables, scan_id: str) -> Optional[dict]:
    """The stored deltas if this exact scan is already logged, else ``None``.

    The idempotency guard. A Databricks job retries a failed task in the same run, so passing
    ``--scan_id={{job.run_id}}`` means a retry arrives with the id its predecessor used -- and
    reconciling the same scan twice would advance every lifecycle a second time.
    """
    rows = spark.table(tables.scans).filter(F.col("scan_id") == scan_id).limit(1).collect()
    return rows[0].asDict() if rows else None


def ledger_already_merged(spark: SparkSession, tables: Tables, scan_id: str) -> bool:
    """Whether the ledger already carries this scan's effect.

    Torn-write detection. The MERGE and the ``scans`` row are two commits, so a run can die
    between them and leave the ledger advanced with nothing recording that it happened. A retry
    would then reconcile the same findings against a ledger that has already moved: every
    finding would look unchanged, and every finding absent from the retry would be resolved a
    second time. Asking the ledger directly is cheap and unambiguous.
    """
    return (
        spark.table(tables.ledger)
        .filter((F.col("last_scan_id") == scan_id) | (F.col("first_scan_id") == scan_id))
        .limit(1)
        .count()
        > 0
    )


def scan_log_desc(spark: SparkSession, tables: Tables) -> list:
    """The whole scan log, most recent first.

    Both readers below want the same rows in the same order, and a reconcile needs both. The
    log has one row per scan ever run, so collecting it is cheap -- what is not cheap is doing
    it twice, because each `collect()` is its own Spark job however few rows come back.
    """
    return (
        spark.table(tables.scans)
        .select("scan_id", "scan_ts", "severities")
        .orderBy(F.col("scan_ts").desc(), F.col("scan_id").desc())
        .collect()
    )


def previous_scan(
    spark: SparkSession, tables: Tables, rows: Optional[list] = None
) -> Optional[tuple]:
    """``(scan_id, scan_ts)`` of the most recent logged scan, or ``None`` for a fresh register.

    ``rows`` is an already-collected ``scan_log_desc``, for a caller that needs it anyway.
    """
    if rows is None:
        rows = scan_log_desc(spark, tables)
    return (rows[0]["scan_id"], rows[0]["scan_ts"]) if rows else None


def prev_scan_id_by_severity(
    spark: SparkSession, tables: Tables, rows: Optional[list] = None
) -> dict:
    """``{severity: scan_id}`` of the most recent prior scan whose scope covered each severity.

    Port of ``gas/src/domain/ledgerCore.ts::prevScanIdBySeverity``. Feeds ``reconcile``'s
    disappearance guard so a finding that vanished while its severity went unscanned still
    resolves on the first scan that covers it again, instead of being stranded open forever.
    """
    remaining = set(SEVERITY_ORDER)
    mapping = {}
    if rows is None:
        rows = scan_log_desc(spark, tables)
    for row in rows:
        scope = parse_severities(row["severities"])
        covered = set(remaining) if scope is None else remaining & set(scope)
        for sev in covered:
            mapping[sev] = row["scan_id"]
        remaining -= covered
        if not remaining:
            break
    return mapping


def merge_ledger(spark: SparkSession, tables: Tables, touched) -> dict:
    """MERGE this scan's touched rows into the durable ledger. Returns the scan deltas.

    ``touched`` is a query over the ledger table itself, so it is checkpointed first. That
    truncates the lineage, which means the MERGE's source is a materialized set of rows rather
    than a plan that would re-read the table it is writing to -- the one arrangement Delta
    cannot be asked to reason about. Checkpointing also stops the reconcile join being computed
    twice, once for the deltas and once for the write.
    """
    materialized = touched.localCheckpoint(eager=True)
    row = materialized.agg(
        F.sum(F.col("is_new").cast("int")).alias("new_count"),
        F.sum(F.col("is_resolved_now").cast("int")).alias("resolved_count"),
        F.sum(F.col("is_reopened").cast("int")).alias("reopened_count"),
    ).collect()[0]
    deltas = {k: int(row[k] or 0) for k in ("new_count", "resolved_count", "reopened_count")}

    source = materialized.drop(*ledger_mod.CHANGE_COLUMNS)
    view = "brick_ledger_updates"
    source.createOrReplaceTempView(view)
    spark.sql(
        f"""
        MERGE INTO {tables.ledger} AS target
        USING {view} AS source
          ON target.vuln_key = source.vuln_key
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    spark.catalog.dropTempView(view)
    return deltas


def record_scan(
    spark: SparkSession, tables: Tables, *, scan_id, scan_ts, scope, severities, total, deltas
) -> None:
    """Append the run log row. Written immediately after the MERGE, so the window in which a
    crash can leave the two disagreeing is one statement wide -- and ``ledger_already_merged``
    closes even that."""
    row = [
        (
            scan_id,
            scan_ts,
            scope,
            serialize_severities(severities),
            int(total),
            int(deltas["new_count"]),
            int(deltas["resolved_count"]),
            int(deltas["reopened_count"]),
        )
    ]
    df = spark.createDataFrame(row, SCANS_SCHEMA.replace("scan_ts TIMESTAMP", "scan_ts STRING"))
    write_append(
        df.withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).select(*SCANS_COLUMNS),
        tables.scans,
    )


def clear_scan(spark: SparkSession, tables: Tables, scan_id: str) -> None:
    """Delete a scan's rows from the append-only tables.

    Only ever called on the retry path, where a previous attempt may have written some of them
    before failing. The ledger is deliberately not touched here: it is keyed by ``vuln_key``, so
    there is nothing scan-shaped to delete, and its correctness comes from
    ``ledger_already_merged`` instead.
    """
    for name in APPEND_TABLES:
        table = getattr(tables, APPEND_TABLE_ATTRS[name])
        if table_exists(spark, table):
            spark.sql(f"DELETE FROM {table} WHERE scan_id = '{scan_id}'")


BRONZE_SCHEMA = "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"

# The same columns as they are *stored*. `scan_ts` arrives as a string and is cast on the way in
# (see `write_bronze_batch`), so the two differ in exactly one type -- which is why the table
# cannot simply be created from BRONZE_SCHEMA. `ensure_tables` creates bronze from this so the
# CLUSTER BY has somewhere to live; without it the table would be created by its first append,
# and a clustering spec cannot be declared on an append.
BRONZE_TABLE_SCHEMA = "scan_id STRING, scan_ts TIMESTAMP, scope STRING, seq LONG, node_json STRING"

# How many findings to hold in the driver before flushing a batch to bronze. `fetch_findings`
# is a generator precisely so the caller need not hold the register in memory, and the caller
# used to build one list of every row anyway -- 137,870 tuples, each carrying a JSON document,
# then one `createDataFrame` that pickles the lot in a single hop. This bounds both.
#
# 20,000 rather than the API's 500-row page: a Delta append is a commit, and one per page would
# trade a driver problem for 276 transaction-log entries.
INGEST_BATCH_ROWS = 20_000


def write_bronze_batch(spark: SparkSession, table: str, rows: list) -> None:
    """Append one batch of raw findings to bronze."""
    batch = spark.createDataFrame(rows, BRONZE_SCHEMA)
    # mergeSchema because `seq` is new in v2: a bronze table written by v1 does not have the
    # column, and the first v2 run has to be able to add it rather than fail on arrival.
    batch.withColumn("scan_ts", batch["scan_ts"].cast("timestamp")).write.format("delta").mode(
        "append"
    ).option("mergeSchema", "true").saveAsTable(table)


def ingest_to_bronze(
    spark: SparkSession, table: str, scan_id: str, scan_ts: str, scope: str, severities=None
) -> int:
    """Fetch every finding and append it to bronze in batches. Returns the row count.

    ``severities`` comes from the caller rather than being re-read here, so the population this
    scan fetched and the scope recorded on its ``scans`` row are guaranteed to be the same list.
    If they could drift, the disappearance guard would be reasoning about a scan that never
    happened.

    **A failed ingest now leaves the batches that completed**, where a single write left nothing.
    That is a change in what a crash leaves behind, not in what a successful run produces, and
    it is already handled: a retry arrives with the same ``--scan_id`` and ``main`` runs
    ``clear_scan`` for it first, so the retry starts from an empty scan. Nothing reads bronze
    for a ``scan_id`` that has no ``scans`` row.
    """
    api_url = param("wiz_api_url")
    if not api_url:
        raise RuntimeError("wiz_api_url is required, e.g. https://api.<region>.app.wiz.io/graphql")
    # Named `secret_scope`, not `scope`: this is the Databricks secret scope, and `scope` is
    # already the vulnerability population. Sharing the name silently overwrote the population
    # with the secret-scope string.
    secret_scope = param("secret_scope") or None
    severities = list(severities) if severities else list(default_fetch_severities(scope))

    # Bronze's only creation site. It has to exist before the first batch lands, because a
    # clustering spec can only be declared at creation and an append cannot add one -- and it
    # is created here rather than in `ensure_tables` so that a register nobody has scanned has
    # no bronze at all. See `ensure_tables`.
    create_clustered(spark, table, BRONZE_TABLE_SCHEMA, "bronze")

    session = new_session()
    token = get_token(
        secret(secret_scope, "wiz-client-id", "WIZ_CLIENT_ID"),
        secret(secret_scope, "wiz-client-secret", "WIZ_CLIENT_SECRET"),
        auth_url=param("wiz_auth_url") or DEFAULT_AUTH_URL,
        session=session,
    )

    # `seq` is the order the API returned each finding in. Recorded rather than recomputed so
    # that first-wins deduplication of a repeated finding stays reproducible -- including years
    # later, when --rebuild_ledger replays these same rows. See ledger.observed. It runs across
    # the whole scan, not per batch: the batching below is an implementation detail of the
    # write and must not be visible in the data.
    total = 0
    batch: list = []
    for node in fetch_findings(
        api_url,
        token,
        scope=scope,
        severities=severities,
        project_id=param("project_id") or None,
        session=session,
    ):
        batch.append((scan_id, scan_ts, scope, total, json.dumps(node)))
        total += 1
        if len(batch) >= INGEST_BATCH_ROWS:
            write_bronze_batch(spark, table, batch)
            batch = []
    if batch:
        write_bronze_batch(spark, table, batch)

    if not total:
        print(f"[{scan_id}] Wiz returned no {scope} findings for severities={severities}")
        return 0
    return total


def reconcile_scan(
    spark: SparkSession,
    tables: Tables,
    silver,
    *,
    scan_id: str,
    scan_ts: str,
    scope: str,
    severities,
    disappearance: str,
    scan_log: Optional[list] = None,
    total: Optional[int] = None,
) -> dict:
    """Advance the ledger by one scan and log the run. Returns the deltas.

    Everything scan-specific is resolved here and handed to the pure reconciler: which scan came
    before, which severities each of them covered, and how a disappearance should be dated.

    ``scan_log`` is an already-collected ``scan_log_desc`` for a caller that needs the same rows
    anyway -- ``build_metrics`` for the observation boundary, ``rebuild_ledger`` to stop
    re-collecting a growing table once per replayed scan.

    ``total`` is this scan's row count when the caller already knows it. ``ingest_to_bronze``
    returns exactly that number, and bronze holds nothing else under this ``scan_id`` -- the id
    is either freshly generated, so nothing has ever written under it, or it was supplied and
    ``main`` cleared it first. Counting the frame again is a Spark job for an answer already in
    hand. ``None`` means "count it" -- the replay path, which never ingested anything.
    """
    if scan_log is None:
        scan_log = scan_log_desc(spark, tables)
    prev = previous_scan(spark, tables, scan_log)
    prev_scan_id = prev[0] if prev else None
    prev_scan_ts = prev[1].strftime("%Y-%m-%dT%H:%M:%SZ") if prev and prev[1] else None
    by_severity = prev_scan_id_by_severity(spark, tables, scan_log) if prev else None

    touched = ledger_mod.reconcile(
        spark.table(tables.ledger),
        ledger_mod.observed(silver),
        scan_id=scan_id,
        scan_ts=scan_ts,
        scope=scope,
        prev_scan_id=prev_scan_id,
        prev_scan_ts=prev_scan_ts,
        prev_scan_id_by_severity=by_severity,
        scanned_severities=severities,
        disappearance=disappearance,
    )
    deltas = merge_ledger(spark, tables, touched)
    record_scan(
        spark, tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope, severities=severities,
        total=silver.count() if total is None else total, deltas=deltas,
    )
    return deltas


def observation_start(scan_log: list, scan_ts: str):
    """The timestamp of the earliest scan on record, including the one being written now.

    This is the boundary between months we watched and months we merely inferred from the API's
    own dates, which is what ``capacity_by_month`` needs to flag reconstructed months honestly.
    On the very first scan it is that scan, which is the honest answer: nothing before it was
    watched by anyone.

    Computed from the scan log the caller has already collected, plus the scan being written
    right now -- which is what ``MIN(scan_ts)`` over the table would return, because
    ``record_scan`` has committed this run's row by the time capacity is built. Both are naive
    UTC datetimes: the session timezone is UTC, and ``scan_ts`` is always ``utc_now_iso``'s
    format, so parsing it here gives the same value Spark stored.
    """
    stamps = [row["scan_ts"] for row in scan_log if row["scan_ts"] is not None]
    stamps.append(dt.datetime.strptime(scan_ts, "%Y-%m-%dT%H:%M:%SZ"))
    return min(stamps)


def closed_observed(spark: SparkSession, tables: Tables):
    """Reconciliation's own resolution count per calendar month of scan.

    The cross-check for capacity's ``closed``, which is derived from ``resolved_at`` instead.
    The two answer the same question by different routes, so a divergence is a real signal --
    and publishing both is the only way a reader can notice one.
    """
    return (
        spark.table(tables.scans)
        .groupBy(F.date_trunc("month", F.col("scan_ts")).alias("month"))
        .agg(F.sum("resolved_count").cast("long").alias("closed_observed"))
    )


# The snapshot-sourced columns republished beside the ledger-sourced ones. Kept deliberately
# short: enough to see how far v1 was off, not a second copy of the whole table.
SNAPSHOT_COLUMNS = ["km_median", "mttr_median", "resolved", "open"]


def build_metrics(
    spark: SparkSession,
    tables: Tables,
    scan_id: str,
    scan_ts: str,
    scope: str,
    rule=None,
    *,
    severities=None,
    disappearance: str = DISAPPEARANCE_RESOLUTION,
    summary: bool = True,
    total: Optional[int] = None,
) -> None:
    """Silver, the ledger, and the three gold tables for one scan.

    ``summary=False`` skips the printed report. The report is the only reason the gold frames
    are cached below, so a caller that does not want the printing does not want the caching
    either -- which is why the test suite passes it: nothing there reads stdout, and six
    ``show()`` calls per scan over the widest plans in this file is the single most expensive
    thing the suite used to do.

    ``total`` is this scan's finding count when the caller already has it -- see
    ``reconcile_scan``. ``None`` counts the frame, which is what a caller that wrote bronze by
    some other route has to do.
    """
    # `rule=None` means "whatever this scope is classified under", resolved here rather than as
    # a default argument: the default would have to name one rule, and naming the wrong one is a
    # full page of plausible numbers rather than an error. See config.rule_for_scope.
    rule = rule or rule_for_scope(scope)
    bronze = spark.table(tables.bronze).filter(f"scan_id = '{scan_id}'")

    silver = metrics.classify_risk(metrics.silver_findings(bronze, scope), rule).cache()
    # Silver is not persisted in path mode. It is a pure per-scan projection of bronze -- the
    # snapshot columns below read the frame in memory, and `panels.register_views` rebuilds
    # `v_findings` from bronze the same way -- so storing it would be a second copy of data the
    # register already holds. Bronze is what must survive; see the README's PoC storage section.
    #
    # In catalog mode it is still written, because that is what every existing deployment and
    # every panel expects to find. Silver is created here rather than in `ensure_tables`
    # because it has no declared schema anywhere -- it is whatever `metrics.silver_findings`
    # projects, deliberately, so that widening the projection is a one-line change. Taking the
    # schema off the frame keeps that property; a constant would be a second copy to keep in step.
    if as_path(tables.silver) is None:
        create_clustered(spark, tables.silver, silver.schema, "silver")
        write_append(silver, tables.silver)

    # Collected once, here, and used twice: the reconciler needs the previous scan and its
    # severity coverage, and capacity needs the earliest scan on record. Reading the same small
    # table twice is two Spark jobs for one answer.
    scan_log = scan_log_desc(spark, tables)
    deltas = reconcile_scan(
        spark, tables, silver, scan_id=scan_id, scan_ts=scan_ts, scope=scope,
        severities=severities, disappearance=disappearance, scan_log=scan_log, total=total,
    )

    # Gold comes from the ledger, not from the snapshot. This is the whole of v2 in one line:
    # every finding the register has ever seen, with the dates we actually observed, including
    # the ones the API has long since stopped returning.
    lifecycles = metrics.classify_risk(
        ledger_mod.lifecycle_frame(spark.table(tables.ledger), scan_ts), rule
    ).cache()

    # `summarize` reads the four gold frames back. They are lazy, so without this each of its
    # six `show()` calls is a *second* full execution of the plan behind it -- seven wide
    # aggregations for sensitivity, two whole populations for capacity -- plus an ordering
    # shuffle, purely to print rows that were just written. Caching at the write makes the
    # write populate the cache and the printing read it. The frames are a handful of rows
    # each; only the plans behind them are large, which is exactly why this is worth doing.
    published = []

    def publish(frame, table):
        if summary:
            frame = frame.cache()
            published.append(frame)
        write_append(frame, table)
        return frame

    mttr = metrics.with_scan_columns(
        with_snapshot_columns(
            metrics.mttr_by_severity(lifecycles), metrics.mttr_by_severity(silver)
        ),
        scan_id, scan_ts, scope,
    )
    mttr = mttr.join(metrics.resolution_sources(lifecycles), "severity", "left")
    mttr = publish(mttr, tables.mttr)

    program = metrics.with_scan_columns(
        metrics.confusion_matrix(lifecycles), scan_id, scan_ts, scope
    )
    program = program.withColumn("risk_rule", F.lit(rule.sentence()))
    program = publish(program, tables.program)

    # Coverage and efficiency are defined by the rule, so how much of them IS the rule is not a
    # curiosity -- it belongs beside them. Seven aggregations over an already-cached frame.
    sensitivity = metrics.with_scan_columns(
        metrics.rule_sensitivity(lifecycles, rule), scan_id, scan_ts, scope
    )
    sensitivity = publish(sensitivity, tables.sensitivity)

    # Both populations, stacked: the all-findings backlog throughput and the high-risk net flow
    # P2P v3 actually defines. Every reader of this table has to filter on `population`.
    capacity = metrics.with_scan_columns(
        metrics.capacity_populations(
            lifecycles,
            scan_ts,
            observed_from=observation_start(scan_log, scan_ts),
            closed_observed=closed_observed(spark, tables),
        ),
        scan_id, scan_ts, scope,
    )
    capacity = publish(capacity, tables.capacity)

    # P2P v5's asset-centric family. Both populations, stacked, for the same reason capacity
    # stacks them -- so every read has to say which. `observed_from` is shared with capacity
    # above: without it the rate-per-watched-month columns are NULL rather than reconstructed.
    assets = metrics.with_scan_columns(
        metrics.asset_profile_populations(
            lifecycles, scan_ts, observed_from=observation_start(scan_log, scan_ts)
        ),
        scan_id, scan_ts, scope,
    )
    assets = publish(assets, tables.assets)

    if summary:
        summarize(
            scan_id, scope, rule, deltas, mttr, program, capacity, sensitivity, assets
        )
        for frame in published:
            frame.unpersist()
    silver.unpersist()
    lifecycles.unpersist()


def with_snapshot_columns(ledger_mttr, snapshot_mttr):
    """Attach the snapshot figures to the ledger ones as ``snap_*``.

    Both frames are computed the same way by the same code; only the lifecycles underneath them
    differ. That is what makes the comparison meaningful -- and what makes it worth publishing,
    because the gap IS the survivorship the snapshot path could not see.
    """
    snap = snapshot_mttr.select(
        "severity", *[F.col(c).alias(f"snap_{c}") for c in SNAPSHOT_COLUMNS]
    )
    return ledger_mttr.join(snap, "severity", "left")


def summarize(
    scan_id, scope, rule, deltas, mttr, program, capacity, sensitivity, assets=None
) -> None:
    """Print every metric family.

    Previously only the program frame was shown, so MTTR and capacity were computed, written
    and then never mentioned -- from the notebook it looked like the pipeline did not do MTTR
    at all. If a number is worth a table, it is worth a line of output.
    """
    print(f"[{scan_id}] scope: {scope} | risk rule: {rule.sentence()}")
    print(
        f"[{scan_id}] lifecycle: {deltas['new_count']} new, "
        f"{deltas['resolved_count']} resolved, {deltas['reopened_count']} reopened"
    )

    # km_median leads. mttr_median is the closed-only figure kept beside it: the gap between
    # the two is the survivorship bias, and seeing them together is the argument for KM.
    # snap_km_median is the same estimator over the snapshot lifecycles v1 used -- the gap
    # against km_median is what cross-scan tracking added.
    print("\nMTTR and SLA by severity (km_median counts still-open findings as censored)")
    metrics.order_by_severity(
        mttr.select(
            "severity", "resolved", "open", "km_median", "km_median_lower_bound", "km_rmst",
            "mttr_median", "sla_target", "sla_pct", "snap_km_median",
        )
    ).show(truncate=False)

    print("How resolutions were learned (disappeared = inferred from absence)")
    metrics.order_by_severity(
        mttr.select("severity", "resolved", "resolved_api", "resolved_disappeared")
    ).show(truncate=False)

    print("Remediation coverage and efficiency")
    metrics.order_by_severity(
        program.select(
            "severity", "coverage_pct", "efficiency_pct", "prevalence_pct", "signal_coverage_pct"
        )
    ).show(truncate=False)

    # Printed straight after coverage/efficiency, because it is the caveat on them: a headline
    # that swings wildly across these rows is mostly reporting the rule, not the register.
    print("How much of that is the rule (coverage/efficiency under each signal subset)")
    sensitivity.select(
        "rule_label", "active", "coverage_pct", "efficiency_pct", "prevalence_pct",
        "high_risk", "unknown",
    ).orderBy(F.col("active").desc(), "rule_label").show(truncate=False)

    print("Capacity — most recent months, all findings")
    _show_capacity(capacity, POPULATION_ALL)

    # The P2P v3 reading. Separate rather than a column beside the above, because the two
    # populations have their own month grids and their own backlogs -- they are not two
    # measurements of one thing.
    print("Capacity — most recent months, high risk only (the P2P v3 net-capacity population)")
    _show_capacity(capacity, POPULATION_HIGH_RISK)

    if assets is not None:
        # P2P v5, over the population v5 asks about. An `os` register has no asset columns
        # while config.FETCH_ASSET_FIELDS is off, so this prints one empty frame and says so
        # rather than being silently skipped -- the absence is the finding.
        print("Assets at risk (P2P v5) — high risk only, by ecosystem")
        rows = assets.filter(F.col("population") == POPULATION_HIGH_RISK)
        if rows.head(1):
            rows.select(
                "asset_group", "assets", "density_p50", "assets_with_high_risk_pct",
                "km_median_days", "mmcr_p50", "falling_behind_pct", "gaining_pct",
            ).orderBy(F.col("assets").desc()).show(10, truncate=False)
        else:
            print("  no assets in this register -- see config.FETCH_ASSET_FIELDS")


def _show_capacity(capacity, population: str) -> None:
    rows = capacity.filter(F.col("population") == population)
    rows.select(
        "month", "open_at_start", "opened", "closed", "closed_observed", "mmcr", "verdict",
        "partial", "reconstructed",
    ).orderBy(F.col("month").desc()).show(6, truncate=False)


def resolve_namespace(argv: Optional[list] = None) -> str:
    """``<catalog>.<schema>``, with the catalog required -- there is no safe default for it.

    A default that succeeds is worse than none here. `main` exists in most Unity Catalog
    metastores, is a production catalog in plenty of organisations, and usually carries broad
    USE CATALOG grants -- so forgetting the parameter would quietly land CVEs-against-named-hosts
    somewhere permissive rather than failing.
    """
    catalog = param("catalog", argv=argv)
    if not catalog:
        raise RuntimeError(
            "catalog is required -- pass --catalog=<name> (or set the widget / $CATALOG). "
            "Prefer a catalog scoped to security data over a shared one; on a workspace "
            "without Unity Catalog, pass --catalog=hive_metastore."
        )
    schema = param("schema", "wiz", argv=argv)
    for label, value in (("catalog", catalog), ("schema", schema)):
        if not IDENTIFIER.match(value):
            raise RuntimeError(f"{label} {value!r} is not a valid identifier")
    return f"{catalog}.{schema}"


def resolve_scope(argv: Optional[list] = None) -> str:
    """Which population this run measures. Drives the API filter and the table names alike."""
    scope = param("scope", DEFAULT_SCOPE, argv=argv)
    if scope not in SCOPES:
        raise RuntimeError(f"unknown scope {scope!r} -- expected one of {sorted(SCOPES)}")
    return scope


def resolve_data_path(argv: Optional[list] = None, csv_register: str = "") -> str:
    """The directory the register lives in, or ``""`` for a catalog-backed run.

    Setting ``--data_path`` is what selects path mode; there is no second flag, because the
    presence of a path *is* the mode and two flags would have a fourth combination to explain.
    A path-backed run needs no catalog, no schema and no Unity Catalog -- which is the point of
    it: a PoC with nowhere to create tables can still collect a register that survives.

    An absolute path or a storage URI: ``/Volumes/...``, ``dbfs:/...``, ``s3://...``,
    ``abfss://...``. A relative path is refused because it resolves against whatever the
    driver's working directory happens to be.

    Three things are refused rather than accepted, all of them at parameter resolution so they
    cost seconds rather than surfacing forty minutes into a scan:

    A **backtick**, because the path is interpolated into SQL inside one. Same reasoning as
    IDENTIFIER and PREFIX above: the value comes from an operator, not an attacker, and it
    should still fail with a clear message rather than do something surprising.

    An **ephemeral path**, when there is a Databricks around to be ephemeral on. `/tmp`,
    `/local_disk0` and the driver's own directories are wiped when a cluster terminates, so a
    register written there is gone by the next morning -- silently, and precisely at the moment
    somebody goes looking for the history. Off Databricks those paths are ordinary local
    directories and are allowed, which is what lets the tests use ``tmp_path``.

    **``/Workspace``**, which looks like the obvious answer and is not one. Workspace files
    persist and need no catalog, so they are the natural first choice for a PoC -- but
    *"executors cannot write to workspace files"*, and every write here is a distributed Delta
    write. It can appear to work on a single-node cluster, where the driver is also the
    executor, and then fail the moment the cluster is scaled. Workspace file permissions also
    expire (36 hours interactive, 30 days for jobs), which disqualifies it as somewhere data
    lives. Refused for the same reason as the ephemeral paths: the failure is late, confusing,
    and lands on the data. See brick/README.md, PoC storage.
    """
    path = param("data_path", argv=argv).strip().rstrip("/")
    if not path and csv_register:
        # A CSV register needs somewhere for Delta to live *during a run* -- the ledger is
        # MERGEd and read back, and a CSV cannot be merged into -- but nowhere for it to live
        # afterwards. So the default is deliberately disposable, and losing it costs nothing:
        # the next run restores from the CSV, which is the register.
        #
        # `dbfs:/tmp` rather than `/tmp`: the latter is per-node local disk, and every write
        # here is distributed, so executors would write to whichever machine they landed on.
        # A workspace with no DBFS root should pass `--data_path` pointing at a volume.
        return f"dbfs:/tmp/wiz_scratch_{param('scope', DEFAULT_SCOPE, argv=argv) or DEFAULT_SCOPE}"
    if not path:
        return ""
    if "`" in path:
        raise RuntimeError(f"data_path {path!r} must not contain a backtick")
    if not (path.startswith("/") or URI_SCHEME.match(path)):
        raise RuntimeError(
            f"data_path {path!r} must be an absolute path or a storage URI -- a relative path "
            f"resolves against whatever the driver's working directory happens to be"
        )
    if csv_register and path.startswith(EPHEMERAL_PREFIXES):
        # Deliberately allowed, and the one case where it is right. The refusal below exists
        # because a register on ephemeral disk is lost overnight and discovered missing when
        # somebody wants the history -- but with a CSV register there is no history here to
        # lose. Saying so explicitly beats the alternative, which is that `dbfs:/tmp/...`
        # happens to slip past a guard matching a leading `/tmp/`.
        return path
    if dbx.get_dbutils() is not None and path.startswith(EPHEMERAL_PREFIXES):
        raise RuntimeError(
            f"data_path {path!r} is on the cluster's ephemeral disk, which is wiped when the "
            f"cluster terminates -- the register would be lost. {PERSISTENT_PATHS}"
        )
    if path.startswith("/Workspace"):
        raise RuntimeError(
            f"data_path {path!r} is a workspace file path, and Spark executors cannot write to "
            f"those -- every write here is a distributed Delta write. It can look like it works "
            f"on a single-node cluster and break as soon as one is scaled, and workspace file "
            f"permissions expire (36h interactive, 30 days for jobs) besides. {PERSISTENT_PATHS}"
        )
    return path


def resolve_tables(
    namespace: str, scope: str, argv: Optional[list] = None, data_path: str = ""
) -> Tables:
    """The eight table references, prefixed so they can share a schema with other teams' tables.

    With ``data_path`` set, each is ``delta.`<path>/<prefix><name>``` -- a directory per table
    under one root, named identically to the tables a catalog-backed run would create, so the
    migration recipe in the README is a `CREATE TABLE ... LOCATION` per directory and nothing
    has to be renamed.
    """
    prefix = param("table_prefix", default_table_prefix(scope), argv=argv)
    if not PREFIX.match(prefix):
        raise RuntimeError(f"table_prefix {prefix!r} is not a valid identifier fragment")

    def qualify(name: str) -> str:
        if data_path:
            return f"delta.`{data_path}/{prefix}{name}`"
        return f"{namespace}.{prefix}{name}"

    return Tables(
        bronze=qualify(BRONZE_TABLE),
        silver=qualify(SILVER_TABLE),
        ledger=qualify(LEDGER_TABLE),
        scans=qualify(SCANS_TABLE),
        mttr=qualify(GOLD_MTTR),
        program=qualify(GOLD_PROGRAM),
        capacity=qualify(GOLD_CAPACITY),
        sensitivity=qualify(GOLD_SENSITIVITY),
        assets=qualify(GOLD_ASSETS),
    )


def resolve_disappearance(argv: Optional[list] = None) -> str:
    """How a vanished finding's resolution should be dated. See config.DISAPPEARANCE_RESOLUTION."""
    mode = param("disappearance", DISAPPEARANCE_RESOLUTION, argv=argv)
    if mode not in DISAPPEARANCE_MODES:
        raise RuntimeError(
            f"unknown disappearance mode {mode!r} -- expected one of {sorted(DISAPPEARANCE_MODES)}"
        )
    return mode


def resolve_severities(scope: str, argv: Optional[list] = None) -> list:
    """The severity scope of this run. Drives the API filter AND the disappearance guard.

    ``scope`` is required rather than defaulted because the default gate is a property of the
    population being measured, not of the product: a severity list that is a volume control on
    one register can be a deletion on another. It is also the list stamped on the ``scans`` row,
    so what the disappearance guard later believes a scan covered is decided right here.
    """
    requested = param("severities", argv=argv) or ",".join(default_fetch_severities(scope))
    return [s.strip().upper() for s in requested.split(",") if s.strip()]


def resolve_shuffle_partitions(argv: Optional[list] = None) -> int:
    """How many partitions a shuffle produces. ``0`` means "leave the cluster's value alone".

    See ``get_spark``. Exposed as a parameter rather than hard-coded because the right number
    is a property of the cluster, and the only person who knows the cluster is the operator.
    """
    raw = param("shuffle_partitions", str(DEFAULT_SHUFFLE_PARTITIONS), argv=argv).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(
            f"shuffle_partitions must be an integer, got {raw!r} (0 = leave the cluster's "
            f"setting alone)"
        ) from exc
    if value < 0:
        raise RuntimeError(f"shuffle_partitions must not be negative, got {value}")
    return value


def truthy(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def rebuild_ledger(
    spark: SparkSession,
    tables: Tables,
    scope: str,
    severities,
    disappearance: str,
    rule=None,
) -> int:
    """Rebuild the ledger from scratch by replaying every bronze scan, oldest first.

    The backfill. Without it a register that has been running v1 for months starts its ledger
    today: every finding's ``first_seen`` collapses to now, and MTTR reads as roughly zero until
    enough history accumulates to be worth reading.

    Replay goes through the same ``reconcile`` the live path uses, which is the point -- the
    rebuilt ledger is faithful by construction rather than by a second implementation that has
    to be kept in step. This mirrors how ``gas/src/domain/ledgerCore.ts`` and the SQLite ledger
    rebuild after a scan is deleted.

    **The severity scope is the one thing bronze cannot tell us.** v1 never recorded which
    severities a scan asked for, so replayed scans are assumed to have used this run's
    ``--severities``. If the history was collected under a different scope, pass that scope --
    otherwise the replay will resolve-by-disappearance severities the original scans never
    covered, and invent remediation that never happened.
    """
    rule = rule or rule_for_scope(scope)
    if not table_exists(spark, tables.bronze):
        raise RuntimeError(f"cannot rebuild: {tables.bronze} does not exist yet")

    scans = [
        (r["scan_id"], r["scan_ts"])
        for r in spark.table(tables.bronze)
        .select("scan_id", "scan_ts")
        .distinct()
        .orderBy(F.col("scan_ts").asc(), F.col("scan_id").asc())
        .collect()
    ]
    if not scans:
        print("[rebuild] bronze holds no scans; nothing to replay")
        return 0

    print(f"[rebuild] replaying {len(scans)} scans from {tables.bronze}")
    spark.sql(f"DELETE FROM {tables.ledger}")
    spark.sql(f"DELETE FROM {tables.scans}")

    # The scan log was just emptied, so it starts empty and this loop is the only thing that
    # adds to it. Collecting it once and extending it here is what stops the replay re-reading
    # a table it is itself growing -- one collect per scan over n rows is O(n^2) across the
    # replay, and the replay is the longest-running thing in this file.
    scan_log: list = []
    for index, (scan_id, scan_ts) in enumerate(scans, start=1):
        ts_iso = scan_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        bronze = spark.table(tables.bronze).filter(F.col("scan_id") == scan_id)
        # Cached because it has two consumers -- `observed` and the row count in
        # `reconcile_scan` -- and without this the second one re-reads bronze and re-parses
        # every node_json. The live path caches for the same reason (see `build_metrics`).
        silver = metrics.classify_risk(metrics.silver_findings(bronze, scope), rule).cache()
        try:
            deltas = reconcile_scan(
                spark, tables, silver, scan_id=scan_id, scan_ts=ts_iso, scope=scope,
                severities=severities, disappearance=disappearance, scan_log=scan_log,
            )
        finally:
            silver.unpersist()
        # Newest first, matching `scan_log_desc`'s ordering: scans are replayed oldest-first, so
        # each new row belongs at the front. The timestamp is parsed back out of `ts_iso` rather
        # than reused from bronze, because that is the value `record_scan` just wrote -- second
        # resolution, sub-seconds dropped -- and this list stands in for reading that table.
        scan_log.insert(
            0,
            Row(
                scan_id=scan_id,
                scan_ts=dt.datetime.strptime(ts_iso, "%Y-%m-%dT%H:%M:%SZ"),
                severities=serialize_severities(severities),
            ),
        )
        print(
            f"[rebuild] {index}/{len(scans)} {scan_id} -> {deltas['new_count']} new, "
            f"{deltas['resolved_count']} resolved, {deltas['reopened_count']} reopened"
        )
    return len(scans)


def maintain(spark: SparkSession, tables: Tables) -> list:
    """``OPTIMIZE`` the clustered tables. Returns the table names it touched.

    Clustering is declared at creation but only *applied* when data is laid out, and a write
    lays it out only above a size threshold no table here reaches on a single scan -- so without
    this the clustering spec is a promise nothing keeps. OPTIMIZE is what redeems it: on a
    clustered table it clusters incrementally, rewriting only what is not already in place.

    **Deliberately not part of the daily run.** OPTIMIZE is an unbounded rewrite over the whole
    register, and the job that has to finish before anyone can read this morning's number should
    not be waiting behind it. Weekly, as its own Job, is the shape this is built for.

    Also deliberately not ``VACUUM``: that deletes files that time travel and any in-flight
    reader still depend on, and choosing a retention window is a decision nobody has made here.
    ``OPTIMIZE`` only ever adds files, so the worst a bad run of this can do is cost money.
    """
    optimized = []
    for attr in CLUSTERING:
        table = getattr(tables, attr)
        if not table_exists(spark, table):
            continue
        spark.sql(f"OPTIMIZE {table}")
        optimized.append(table)
        print(f"[maintain] optimized {table}")
    if not optimized:
        print("[maintain] no clustered tables exist yet; nothing to do")
    return optimized


def export_csv(
    spark: SparkSession, tables: Tables, target: str, *, include_bronze: bool = False
) -> list:
    """Write every table that exists to ``target`` as CSV. Returns what it wrote.

    Delegates to ``csvstore.export``, which writes each table driver-side alongside a schema
    sidecar. Two things changed when it did, and both were failures rather than preferences:

    * **It writes where the register cannot live.** The old implementation used Spark's CSV
      writer, which is a distributed write, and executors cannot write to ``/Workspace`` -- the
      one destination a deployment with no catalog and no volume actually has.
    * **It round-trips.** CSV has no types, and a NULL read back as ``false`` inflates
      efficiency and deflates coverage at once (see the header of ``csvstore``). The sidecar is
      what fixes that, and ``csvstore.load`` is what reads it.

    Still not how you *migrate* between registers: what you migrate is the Delta directory,
    ``CREATE TABLE ... USING DELTA LOCATION``, which keeps the clustering and the history too.
    See the README's PoC storage section. ``csvstore.restore`` is for rebuilding a register
    whose Delta side was lost, which is a different job from moving one that is intact.

    ``include_bronze`` opts into the one table the default skips -- see ``csvstore.DEFAULT_ATTRS``.
    """
    import csvstore

    return csvstore.export(spark, tables, target, include_bronze=include_bronze)


def ensure_schema(spark: SparkSession, namespace: str) -> None:
    """Create the schema, but only when it is actually missing.

    An unconditional ``CREATE SCHEMA IF NOT EXISTS`` looks harmless and is not: in a shared
    organisation catalog a service principal typically holds CREATE TABLE on one schema and
    no CREATE SCHEMA on the catalog, so the statement fails with PERMISSION_DENIED against a
    schema that already exists and is perfectly writable. Checking first means the job needs
    the privilege only when it genuinely has to create something.

    A path-backed run passes ``""`` and this does nothing: there is no schema, which is the
    entire reason that mode exists.
    """
    if not namespace:
        return
    try:
        if spark.catalog.databaseExists(namespace):
            return
    except Exception:  # noqa: BLE001 -- can't tell; fall through and let CREATE decide
        pass
    try:
        spark.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")
    except Exception as exc:  # noqa: BLE001 -- re-raised with the parameter named
        raise RuntimeError(
            f"Schema {namespace} does not exist and could not be created. Either create it "
            f"first, or grant this principal CREATE SCHEMA on the catalog."
        ) from exc


def main(scan_id: Optional[str] = None) -> Optional[RunResult]:
    """Run the pipeline. Returns what it wrote, or ``None`` when there was nothing to do."""
    # A half-updated workspace folder is the cheapest failure to detect and the most expensive
    # to diagnose later, so it goes first -- ahead of even parameter resolution.
    check_deployment()
    # Resolve parameters before touching Spark: a missing one should fail in milliseconds,
    # not after a cluster has warmed up and an API fetch has run.
    # `--data_path` selects the storage mode, so it is resolved first: with one set there is no
    # catalog to require, which is what lets a PoC with nowhere to create tables run at all.
    scope = resolve_scope()
    csv_register = param("csv_path")
    data_path = resolve_data_path(csv_register=csv_register)
    # **With a CSV register there is no catalog, ever.** Not "no catalog by default" -- the
    # whole point of the mode is that nothing durable lands in the lake, and falling through to
    # `resolve_namespace()` here is exactly how a run that was meant to write CSV creates two
    # empty Delta tables in a production catalog instead. See `resolve_data_path`.
    namespace = "" if (data_path or csv_register) else resolve_namespace()
    tables = resolve_tables(namespace, scope, data_path=data_path)
    disappearance = resolve_disappearance()
    severities = resolve_severities(scope)

    spark = get_spark()
    ensure_schema(spark, namespace)

    # The CSV is the register; the Delta side is a scratch copy for the length of this run.
    # Restoring first is what makes last run's lifecycles available to this one's reconcile --
    # without it every scan would start from an empty ledger and resolve nothing.
    #
    # Before `ensure_tables`, because a restore overwrites and `ensure_tables` only creates what
    # is missing: the other order would leave an empty ledger for the restore to replace, which
    # works but reads as though the order does not matter.
    if csv_register:
        import csvstore

        csvstore.restore(
            spark, csv_register, tables,
            prefix=param("table_prefix", default_table_prefix(scope)),
            missing_ok=True,
        )
    ensure_tables(spark, tables)

    # Maintenance is not a scan and returns nothing scan-shaped. It goes first so that a job
    # scheduled to run it can never also ingest, whatever else its parameters say.
    if truthy(param("maintain")):
        maintain(spark, tables)
        return None

    # Likewise an export: it reads the register and writes files beside it, and must not be
    # able to turn into a scan because somebody left the other parameters set.
    export_to = param("export_csv")
    if export_to:
        export_csv(
            spark, tables, export_to, include_bronze=truthy(param("csv_include_bronze"))
        )
        return None

    # And a restore, which writes the register from a CSV export. First among the three, in
    # spirit: it is the only one that overwrites data, so it returns rather than continuing
    # into a scan that would then reconcile against a register it had just replaced.
    restore_from = param("csv_restore")
    if restore_from:
        import csvstore

        csvstore.restore(
            spark, restore_from, tables, prefix=param("table_prefix", default_table_prefix(scope))
        )
        return None

    if truthy(param("rebuild_ledger")):
        # A rebuild replays bronze, and in CSV-register mode bronze is excluded from the export
        # by default -- so the restore above brought back no bronze and `ensure_tables` made an
        # empty one. The replay would then find nothing and return, quietly, having done
        # nothing: the worst outcome, because it looks like a rebuild that found no history
        # rather than a rebuild that could not have run. Refuse and say which flag is missing.
        if csv_register and not truthy(param("csv_include_bronze")):
            raise RuntimeError(
                f"--rebuild_ledger has nothing to replay: the CSV register at {csv_register!r} "
                f"excludes bronze, and the Delta side is scratch for this run only. Re-run the "
                f"scans that built it with --csv_include_bronze=true first, or rebuild against "
                f"a --data_path register that still has its bronze."
            )
        replayed = rebuild_ledger(spark, tables, scope, severities, disappearance)
        if not replayed:
            return None
        latest = previous_scan(spark, tables)
        return RunResult(
            tables=tables, scan_id=latest[0],
            scan_ts=latest[1].strftime("%Y-%m-%dT%H:%M:%SZ"), scope=scope,
        )

    supplied_scan_id = scan_id or param("scan_id")
    scan_id = supplied_scan_id or f"scan-{uuid.uuid4().hex[:12]}"
    scan_ts = utc_now_iso()

    # Idempotency. A Job retry arrives with the same --scan_id={{job.run_id}} as the attempt it
    # is retrying, and reconciling one scan twice would advance every lifecycle a second time.
    logged = recorded_scan(spark, tables, scan_id)
    if logged is not None:
        print(
            f"[{scan_id}] already recorded ({logged['new_count']} new, "
            f"{logged['resolved_count']} resolved) -- nothing to do"
        )
        return RunResult(tables=tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope)

    # Torn write: the MERGE committed but the scan log did not. Reconciling again would resolve
    # by disappearance everything already accounted for, so refuse rather than corrupt.
    if ledger_already_merged(spark, tables, scan_id):
        raise RuntimeError(
            f"scan {scan_id} is already reflected in {tables.ledger} but has no row in "
            f"{tables.scans}: a previous run committed the ledger MERGE and then failed. "
            f"Re-running would double-count it. Recover with --rebuild_ledger, or re-run with "
            f"a fresh --scan_id if that scan's findings were never fully ingested."
        )

    # A retry may have written part of the append-only tables before dying. Only a scan_id that
    # came from outside can be a retry: a self-generated one is a fresh uuid nothing has ever
    # written under, so the six DELETEs would be six Delta statements matching nothing.
    if supplied_scan_id:
        clear_scan(spark, tables, scan_id)

    count = ingest_to_bronze(spark, tables.bronze, scan_id, scan_ts, scope, severities)
    if not count:
        return None
    print(f"[{scan_id}] ingested {count} {scope} findings at {scan_ts}")
    build_metrics(
        spark, tables, scan_id, scan_ts, scope,
        severities=severities, disappearance=disappearance, total=count,
    )

    # The other half of the CSV register: this run's state goes back to where the next run will
    # look for it. Not a side errand -- the Delta side is scratch, so a scan that ingested and
    # did not export has lost its output entirely.
    if csv_register:
        export_csv(
            spark, tables, csv_register, include_bronze=truthy(param("csv_include_bronze"))
        )
    return RunResult(tables=tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope)


if __name__ == "__main__":
    main()
