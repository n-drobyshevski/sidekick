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

MODULE_VERSION = "2.2"

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
        DEFAULT_FETCH_SEVERITIES,
        DEFAULT_RISK_RULE,
        DEFAULT_SCOPE,
        DISAPPEARANCE_MODES,
        DISAPPEARANCE_RESOLUTION,
        PIPELINE_VERSION,
        POPULATION_ALL,
        POPULATION_HIGH_RISK,
        SCANS_COLUMNS,
        SCOPES,
        SEVERITY_ORDER,
        RiskRule,
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

# The append-only tables, i.e. everything except the ledger. A retry writes a scan_id that a
# failed attempt may already have partly written, so these are cleared for that scan_id first.
APPEND_TABLES = (
    BRONZE_TABLE,
    SILVER_TABLE,
    GOLD_MTTR,
    GOLD_PROGRAM,
    GOLD_CAPACITY,
    GOLD_SENSITIVITY,
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
}

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

# One-shot migration tooling, treated exactly like the notebook layer and for the same
# reason: `import_bundle` writes the ledger, so a stale copy beside a fresh `ledger.py` is
# as fatal as a stale metrics.py -- but a scheduled Job must never fail because a module it
# does not import is missing from the folder. Absent is fine; present and disagreeing is not.
MIGRATION_MODULES = ("import_bundle",)

# The optional layers share one rule, so they share one loop in check_deployment.
OPTIONAL_MODULES = NOTEBOOK_MODULES + MIGRATION_MODULES


def check_deployment() -> None:
    """Refuse to run against a folder holding a mix of versions.

    Every import can succeed and the versions still disagree -- v1's run_pipeline.py imports
    happily alongside v2's metrics.py, and the pair only comes apart at the silver write, after
    a full API sweep. That is what happened on the first real v2 run: 137,870 findings ingested,
    then "A schema mismatch detected when writing to the Delta table", which names neither the
    stale file nor the fix.

    Called at the top of ``main()``, before Spark: a bad folder should cost a second, not a
    cluster start and an API sweep.
    """
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

    detail = ", ".join(f"{name}={versions[name] or 'pre-2.0'}" for name in stale)
    raise RuntimeError(
        f"Mixed brick deployment: {detail} (expected {PIPELINE_VERSION}). These modules must "
        f"all come from the same version -- v2's metrics.py writing through v1's "
        f"run_pipeline.py fails later as an unrelated-looking Delta schema mismatch.\n"
        f"Fix: copy ALL SIX of {', '.join(n + '.py' for n in RUNTIME_MODULES)} into the "
        f"workspace folder (plus {', '.join(n + '.py' for n in NOTEBOOK_MODULES)} if you read "
        f"the notebooks), then run dbutils.library.restartPython(). "
        f"See brick/README.md section 2."
    )

# These tables usually land in a schema shared with other teams, where bare names like
# `findings` and `metrics_capacity` are an obvious collision risk. The default prefix also
# carries the scope -- `wiz_os_findings` -- so an OS run and an all-types run land in separate
# tables and can never be blended by accident. Pass --table_prefix= (empty) to opt out.
def default_table_prefix(scope: str) -> str:
    return f"wiz_{scope}_"

# Catalog, schema and prefix are interpolated straight into SQL, so they are checked rather
# than trusted. They come from an operator, not an attacker -- but `--schema=wiz;DROP ...`
# should fail with a clear message instead of doing something surprising.
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PREFIX = re.compile(r"^[A-Za-z0-9_]*$")


@dataclass(frozen=True)
class Tables:
    """The eight fully-qualified table names one run writes to."""

    bronze: str
    silver: str
    ledger: str
    scans: str
    mttr: str
    program: str
    capacity: str
    sensitivity: str


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


def ensure_tables(spark: SparkSession, tables: Tables) -> None:
    """Create the ledger and scan-log tables when they are missing.

    Created from the schema rather than by a first append, because the ledger has to be a Delta
    table before anything can MERGE into it, and because an empty ledger with the right columns
    is what makes the very first run's reconcile a normal case rather than a special one.
    """
    if not spark.catalog.tableExists(tables.ledger):
        ledger_mod.empty_ledger(spark).write.format("delta").saveAsTable(tables.ledger)
    if not spark.catalog.tableExists(tables.scans):
        spark.createDataFrame([], SCANS_SCHEMA).write.format("delta").saveAsTable(tables.scans)


SCANS_SCHEMA = (
    "scan_id STRING, scan_ts TIMESTAMP, scope STRING, severities STRING, total LONG, "
    "new_count LONG, resolved_count LONG, reopened_count LONG"
)


def write_append(df, table: str) -> None:
    """Append a frame to one of the scan-stamped tables.

    Always Delta, explicitly: the pipeline needs MERGE and DELETE, so relying on the session's
    default format would work on Databricks and quietly produce Parquet anywhere else.
    mergeSchema because v2 adds columns to tables a v1 run already created.
    """
    df.write.format("delta").mode("append").option("mergeSchema", "true").saveAsTable(table)


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
        if spark.catalog.tableExists(table):
            spark.sql(f"DELETE FROM {table} WHERE scan_id = '{scan_id}'")


BRONZE_SCHEMA = "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"

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
    severities = list(severities) if severities else list(DEFAULT_FETCH_SEVERITIES)

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
    rule: RiskRule = DEFAULT_RISK_RULE,
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
    bronze = spark.table(tables.bronze).filter(f"scan_id = '{scan_id}'")

    silver = metrics.classify_risk(metrics.silver_findings(bronze), rule).cache()
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

    if summary:
        summarize(scan_id, scope, rule, deltas, mttr, program, capacity, sensitivity)
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


def summarize(scan_id, scope, rule, deltas, mttr, program, capacity, sensitivity) -> None:
    """Print all three metric families.

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


def resolve_tables(namespace: str, scope: str, argv: Optional[list] = None) -> Tables:
    """The eight table names, prefixed so they can share a schema with other teams' tables."""
    prefix = param("table_prefix", default_table_prefix(scope), argv=argv)
    if not PREFIX.match(prefix):
        raise RuntimeError(f"table_prefix {prefix!r} is not a valid identifier fragment")

    def qualify(name: str) -> str:
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
    )


def resolve_disappearance(argv: Optional[list] = None) -> str:
    """How a vanished finding's resolution should be dated. See config.DISAPPEARANCE_RESOLUTION."""
    mode = param("disappearance", DISAPPEARANCE_RESOLUTION, argv=argv)
    if mode not in DISAPPEARANCE_MODES:
        raise RuntimeError(
            f"unknown disappearance mode {mode!r} -- expected one of {sorted(DISAPPEARANCE_MODES)}"
        )
    return mode


def resolve_severities(argv: Optional[list] = None) -> list:
    """The severity scope of this run. Drives the API filter AND the disappearance guard."""
    requested = param("severities", argv=argv) or ",".join(DEFAULT_FETCH_SEVERITIES)
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
    rule: RiskRule = DEFAULT_RISK_RULE,
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
    if not spark.catalog.tableExists(tables.bronze):
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
        silver = metrics.classify_risk(metrics.silver_findings(bronze), rule).cache()
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


def ensure_schema(spark: SparkSession, namespace: str) -> None:
    """Create the schema, but only when it is actually missing.

    An unconditional ``CREATE SCHEMA IF NOT EXISTS`` looks harmless and is not: in a shared
    organisation catalog a service principal typically holds CREATE TABLE on one schema and
    no CREATE SCHEMA on the catalog, so the statement fails with PERMISSION_DENIED against a
    schema that already exists and is perfectly writable. Checking first means the job needs
    the privilege only when it genuinely has to create something.
    """
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
    namespace = resolve_namespace()
    scope = resolve_scope()
    tables = resolve_tables(namespace, scope)
    disappearance = resolve_disappearance()
    severities = resolve_severities()

    spark = get_spark()
    ensure_schema(spark, namespace)
    ensure_tables(spark, tables)

    if truthy(param("rebuild_ledger")):
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
    return RunResult(tables=tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope)


if __name__ == "__main__":
    main()
