"""Databricks entry point: Wiz API -> bronze -> the ledger -> one metrics table.

Run it as a Job (Python file task) or call ``main()`` from a notebook. Parameters resolve in
this order, so the same file works in all three places:

    1. ``--name=value`` on the command line   -- how a Job's Python file task receives them
    2. ``dbutils.widgets.get(name)``          -- how a notebook receives them
    3. the ``NAME`` environment variable      -- how a laptop receives them

These are plain top-level modules, not a package: the directory holding them goes on
``sys.path`` and they import each other by bare name. That keeps the Databricks side a flat
folder of files with no ``__init__.py`` and no nesting to reproduce by hand.

Tables written. ``<p>`` is the table prefix, ``wiz_`` by default -- **the same three tables
for every scope**, with ``scope`` a column in each of them rather than a fragment of their
names:

    <catalog>.<schema>.<p>findings_raw   bronze   scan_id, scan_ts, scope, seq, node_json
    <catalog>.<schema>.<p>vuln_ledger    base     one row per (scope, vuln_key) -- MERGEd
    <catalog>.<schema>.<p>metrics        gold     every published row, told apart by ``family``

``scope`` is part of the ledger's key, not merely a label on it: the same CVE reaching a host
through a package and reaching a service through a dependency is two findings with two clocks,
and one row could only carry one of them. It is also part of every read of the ledger as a
prior -- see ``reconcile_scan`` -- because disappearance-resolution reads absence as
remediation, and every row of another scope is absent from this scope's scan by construction.

``metrics`` is one table holding what used to be the scan log and every gold table -- except
the sensitivity family, which is not published at all any more (`panels.rule_sweep` recomputes
it from the lifecycles). Every row carries ``scan_id``, ``scan_ts``, ``scope`` and ``family``;
the rest of its columns belong to one family and are NULL on the other families' rows, which
is what ``mergeSchema`` on the append gives for free:

    family='scan'      the commit record -- one row per run: severities, total, deltas
    family='mttr'      scan_id x severity (+ OVERALL)
    family='program'   scan_id x severity (+ OVERALL)
    family='capacity'  scan_id x month x population
    family='assets'    scan_id x asset_group x population

A read that does not filter on ``family`` blends grains that share no key, so every read
filters: ``panels.register_views`` publishes one view per family and nothing else reads the
table directly.

Silver -- the typed projection of bronze -- is **not** a table. It is computed in memory for
the scan being built and re-derived from bronze by anything that needs it later (see
``panels._silver_frame``): storing it would be a second copy of data the register already
holds, and bronze is what must survive.

Bronze and metrics are appended -- each run adds a ``scan_id``, so they accumulate into a
trend. The ledger is the exception and the point of v2: it is MERGEd, so a vulnerability keeps
one row and one history no matter how many times it is scanned.

The ``capacity`` family carries every month **twice**, once per ``population`` -- ``all`` for
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

MODULE_VERSION = "3.0-devsecops"

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

# ------------------------------------- the register's tables, families and module manifest
BRONZE_TABLE = "findings_raw"
LEDGER_TABLE = "vuln_ledger"
METRICS_TABLE = "metrics"

# Everything this pipeline publishes lands in `metrics`, one family per grain, told apart by
# the `family` column. `scan` is the commit record for the ledger MERGE -- one row per run, and
# the log every "when did we last look" question reads; the rest are the gold grains. The two
# tuples are what a reader filters on and what a test sweeps: a family absent from
# METRICS_FAMILIES is a typo, not a population.
FAMILY_SCAN = "scan"
FAMILY_MTTR = "mttr"
FAMILY_PROGRAM = "program"
FAMILY_CAPACITY = "capacity"
# P2P v5's asset-centric family. See metrics.asset_profile.
FAMILY_ASSETS = "assets"
GOLD_FAMILIES = (FAMILY_MTTR, FAMILY_PROGRAM, FAMILY_CAPACITY, FAMILY_ASSETS)
METRICS_FAMILIES = GOLD_FAMILIES + (FAMILY_SCAN,)

# The append-only tables, i.e. everything except the ledger. A retry writes a scan_id that a
# failed attempt may already have partly written, so these are cleared for that scan_id first.
APPEND_TABLES = (BRONZE_TABLE, METRICS_TABLE)

# APPEND_TABLES name -> the Tables attribute holding its fully-qualified name. Kept beside the
# tuple rather than inline in clear_scan: a table added to one and not the other is a KeyError
# on the retry path only, which is the path nobody exercises until it matters.
APPEND_TABLE_ATTRS = {BRONZE_TABLE: "bronze", METRICS_TABLE: "metrics"}

# Every `Tables` attribute, in the order a reader wants them. Defined here rather than in
# `csvstore` -- which is what consumes it -- because it is a statement about the dataclass
# below, and `csvstore` already imports this module. One list, so a table added to `Tables` and
# forgotten in an export is a name error at import rather than a gap in a backup.
TABLE_ATTRS = ("metrics", "ledger", "bronze")

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

# Storage tooling, treated exactly like the notebook layer and for the same reason:
# `import_bundle` writes the ledger and the `family='scan'` rows of `metrics`, and `csvstore`
# writes both the export and (on restore) the register itself, so a stale copy of either beside
# a fresh `ledger.py` is as fatal as a stale metrics.py -- but a scheduled Job must never fail
# because a module it does not import is missing from the folder. Absent is fine; present and
# disagreeing is not.
#
# `import_bundle` ported from `brick/import_bundle.py` when this fork absorbed the `os` scope
# (S2): the GAS app it seeds from is the OS-patching register, so the importer is only ever run
# with `--scope=os`, but it is deployment tooling like `csvstore`, not scope-specific code, and
# lives here rather than behind a scope check.
#
# Neither is imported by this module at module scope -- `csvstore` is reached lazily from
# `export_csv`, and `import_bundle` imports `run_pipeline` (not the other way around) and calls
# `check_deployment()` itself -- so a Job that never passes `--csv_path` and never runs the
# importer pays for neither.
MIGRATION_MODULES = ("import_bundle", "csvstore")

# The optional layers share one rule, so they share one loop in check_deployment.
OPTIONAL_MODULES = NOTEBOOK_MODULES + MIGRATION_MODULES


# -------------------------------------------------------------------- the deployment guard
def check_deployment() -> None:
    """Refuse to run against a folder holding a mix of versions.

    Every import can succeed and the versions still disagree -- v1's run_pipeline.py imports
    happily alongside v2's metrics.py, and the pair only comes apart at the silver write, after
    a full API sweep. That is what happened on the first real v2 run: 137,870 findings ingested,
    then "A schema mismatch detected when writing to the Delta table", which names neither the
    stale file nor the fix.

    **This module checks a second thing, and it is the more likely failure on a flat
    Databricks workspace folder.** Every runtime module here has a generic name --
    `config`, `metrics`, `ledger`, all of them -- and a ``sys.path`` that happens to carry some
    other directory defining a module of the same name, or a stale ``sys.modules`` entry left
    behind by an earlier import in the same long-lived process, resolves an import to the wrong
    file just as silently as a version mismatch would. So the directory each module was
    actually loaded from is checked too, not only its version string.

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
        f"half-updated folder, or a stale sys.modules entry left over from an earlier import in "
        f"the same long-lived process.\n"
        f"Fix: copy ALL SIX of {', '.join(n + '.py' for n in RUNTIME_MODULES)} into ONE folder "
        f"holding no other brick deployment (plus "
        f"{', '.join(n + '.py' for n in NOTEBOOK_MODULES)} if you read the notebooks), then run "
        f"dbutils.library.restartPython(). See brick/README.md."
    )


def _check_one_directory() -> None:
    """Every loaded module must have come from this file's own directory.

    On a flat Databricks workspace folder there is no second directory to mix in any more, but
    the failure mode this guards is not specific to one: a stale ``sys.modules`` entry from an
    earlier import in the same long-lived process, or some other path on ``sys.path`` that
    happens to define a module of the same name (``config``, ``metrics``, ...), resolves an
    import to the wrong file just as silently. That produces a working import and a wrong
    pipeline, which is the worst of the two available outcomes.
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
        f"A module of the same name loaded from elsewhere -- most often a stale sys.modules "
        f"entry from an earlier import in this process -- imports cleanly and then measures the "
        f"wrong thing. Put this directory first on sys.path, with sys.path.insert(0, ...), "
        f"restart the interpreter (dbutils.library.restartPython() on a cluster) rather than "
        f"reloading, and see brick/README.md."
    )

# ---------------------------------------------- table references, and where they may point
# These tables usually land in a schema shared with other teams, where bare names like
# `findings_raw` and `metrics` are an obvious collision risk -- `metrics` especially, since it
# is the name of the whole published register. Hence a prefix. Pass --table_prefix= (empty) to
# opt out.
#
# **It no longer carries the scope.** It used to -- `wiz_sca_metrics` -- so that each scope
# landed in its own table set and the registers could never be blended by accident. Three
# scopes meant nine tables to grant, optimise and document, and the separation they bought is
# the separation a `scope` column buys anyway: the ledger is keyed on `(scope, vuln_key)`, the
# MERGE joins on both, and every read of it as a prior filters `scope`. The populations still
# have different positive classes and still must not be blended -- what changed is that the
# thing stopping it is a predicate rather than a table name, and a predicate is testable
# (`test_scope_isolation.py`) where a naming convention was only ever conventional.
DEFAULT_TABLE_PREFIX = "wiz_"

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
    """The three table references one run writes to.

    Either fully-qualified ``catalog.schema.name`` (the default) or ``delta.`<path>``` when
    ``--data_path`` is set. Both are valid anywhere Spark wants a table, which is what lets one
    dataclass serve both and every reader in the module stay unaware of the difference.
    """

    bronze: str
    ledger: str
    metrics: str


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


# --------------------------------------- the run's result, its parameters, and the session
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
# default, and `brick/tools/bench_pipeline.py` does not support one: over three runs a side at 20,000
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


# ------------------------------------------ the tables, the scan log, and the ledger MERGE


def serialize_severities(severities) -> Optional[str]:
    """The severity scope of a scan, as stored on its commit record.

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


# The clustering columns for each table that has one, and whether it carries deletion vectors.
#
# `(scope, vuln_key)` is the MERGE's ON key, both columns of it, and `(scope, scan_id)` is what
# every read of bronze filters on -- `panels._silver_frame` and `rebuild_ledger` both narrow to
# one scope before they narrow to one scan. `scope` leads in both because it is the coarser
# predicate and the one every read applies: with three scopes in one table set, a scan that
# does not filter it reads three registers.
# `metrics` is deliberately absent, and that absence is a decision rather than an omission: a
# scan appends 9-150 rows to it -- a handful per family -- orders of magnitude under the size at
# which a write clusters anything. Clustering it would buy a protocol bump and nothing else, and
# it would drag `maintain`, `create_clustered` and devlake's `precreate_clustered` along with
# it: three mechanisms serving a table with nothing to lay out.
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
# Off for bronze on purpose. It is append-only -- no MERGE, no UPDATE, one
# `DELETE ... WHERE scan_id` on the retry path -- so there is nothing for DVs to make cheaper,
# and leaving them off keeps it at reader version 1. Only DVs push the reader version to 3;
# clustering alone needs writer 7 and leaves readers alone.
CLUSTERING = {
    "ledger": (("scope", "vuln_key"), True),
    "bronze": (("scope", "scan_id"), False),
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
        .clusterBy(*cluster_by)
        .property("delta.enableDeletionVectors", "true" if deletion_vectors else "false")
        .execute()
    )


def ensure_tables(spark: SparkSession, tables: Tables) -> None:
    """Create the ledger and metrics tables when they are missing.

    Created from the schema rather than by a first append, because the ledger has to be a Delta
    table before anything can MERGE into it, and because an empty ledger with the right columns
    is what makes the very first run's reconcile a normal case rather than a special one.

    ``metrics`` is created from ``METRICS_BASE_SCHEMA`` -- the commit record's columns plus
    ``family`` -- and not through ``create_clustered``, because it has no clustering spec (see
    ``CLUSTERING``). Its gold columns are not declared here at all: they arrive through
    ``mergeSchema`` on the first append that carries them, exactly as ``snap_*`` and
    ``population`` already do. Declaring them would be a second copy of what the gold frames
    project, and projecting them is what makes widening one a one-line change.

    Bronze is **not** created here even though it is clustered too. It is created by whatever
    first writes it -- see ``ingest_to_bronze`` -- so that a register which has never been
    scanned does not acquire an empty bronze and start looking as though it has.
    ``rebuild_ledger`` depends on that distinction: "there is no bronze" is how it knows there
    is no history to replay.

    **Every scope calls this against the same two tables**, so the second scope's first run
    finds both already there and creates nothing: ``create_clustered`` returns on
    ``table_exists`` and the ``metrics`` write is behind the same check. That is what makes it
    safe for three chained tasks to each call it, and it is also why neither branch may grow a
    "and it has the right columns" condition -- by the second scope's first run the table
    legitimately has gold columns this schema does not declare.
    """
    create_clustered(spark, tables.ledger, ledger_mod.LEDGER_SCHEMA, "ledger")
    if not table_exists(spark, tables.metrics):
        empty = spark.createDataFrame([], METRICS_BASE_SCHEMA).write.format("delta")
        path = as_path(tables.metrics)
        empty.save(path) if path else empty.saveAsTable(tables.metrics)


SCANS_SCHEMA = (
    "scan_id STRING, scan_ts TIMESTAMP, scope STRING, severities STRING, total LONG, "
    "new_count LONG, resolved_count LONG, reopened_count LONG"
)

# The metrics table as it is *declared*: the commit record's own columns plus the family tag.
# Every other column in the table belongs to one gold family and arrives on that family's first
# append through mergeSchema -- which is why this is a base and not the schema.
METRICS_BASE_SCHEMA = SCANS_SCHEMA + ", family STRING"


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


def recorded_scan(
    spark: SparkSession, tables: Tables, scan_id: str, scope: str
) -> Optional[dict]:
    """The stored deltas if this exact scan is already logged, else ``None``.

    The idempotency guard. A Databricks job retries a failed task in the same run, so passing
    ``--scan_id={{job.run_id}}`` means a retry arrives with the id its predecessor used -- and
    reconciling the same scan twice would advance every lifecycle a second time.

    The commit record shares a table with the gold families now, so ``family`` is part of the
    question: without it a gold row carrying the same ``scan_id`` would answer for a commit
    record that was never written, which is the exact torn write this guards against. The
    projection is ``SCANS_COLUMNS`` for a smaller reason: the table also carries every gold
    column, and a caller reading this dict wants the commit record, not a row of NULLs from
    four other grains.

    ``scope`` is part of the question for the same reason ``family`` is: one table holds every
    scope's commit records, and answering "yes, recorded" from another scope's row would send
    a scan that has never run down the resume branch -- or, worse, past it, because the deltas
    it read back describe a different population.
    """
    rows = (
        spark.table(tables.metrics)
        .filter(
            (F.col("family") == FAMILY_SCAN)
            & (F.col("scan_id") == scan_id)
            & (F.col("scope") == scope)
        )
        .select(*SCANS_COLUMNS)
        .limit(1)
        .collect()
    )
    return rows[0].asDict() if rows else None


def ledger_already_merged(
    spark: SparkSession, tables: Tables, scan_id: str, scope: str
) -> bool:
    """Whether the ledger already carries this scan's effect.

    Torn-write detection. The MERGE and the commit record are two commits, so a run can die
    between them and leave the ledger advanced with nothing recording that it happened. A retry
    would then reconcile the same findings against a ledger that has already moved: every
    finding would look unchanged, and every finding absent from the retry would be resolved a
    second time. Asking the ledger directly is cheap and unambiguous.

    Scoped, because the ledger holds every scope. A scan id is unique across scopes (see
    ``clear_scan``), so an unscoped read would today give the same answer -- but "today the ids
    happen not to collide" is a calling convention, and this is the guard that stands between a
    torn write and a double-counted register. It filters what it means.
    """
    return (
        spark.table(tables.ledger)
        .filter(
            (F.col("scope") == scope)
            & ((F.col("last_scan_id") == scan_id) | (F.col("first_scan_id") == scan_id))
        )
        .limit(1)
        .count()
        > 0
    )


def gold_missing(spark: SparkSession, tables: Tables, scan_id: str, scope: str) -> bool:
    """Whether this scan's commit record stands with no gold rows beside it.

    The recoverable half of the two-commit window. ``record_scan`` lands one statement after the
    MERGE and the gold append lands after that, so a run that dies in between leaves a ledger
    that moved, a commit record saying so, and none of the metrics anybody actually reads.
    Before this existed the retry found the commit record, printed "already recorded, nothing to
    do", and that scan's gold was never written at all -- by design, since re-reconciling would
    have double-counted it. Gold is re-derivable from bronze and the ledger, so the answer is to
    republish it rather than to skip the scan.

    Asking about one family answers for all of them: gold is a single append of the union, so
    either every family for this ``scan_id`` committed or none did. It does not answer for all
    of them across scopes, which is why ``scope`` is here: another scope's ``mttr`` rows under
    the same id would say this scan's gold landed when nothing of it did, and the retry would
    take the "nothing to do" branch and leave the scan permanently absent from every metric.
    """
    return (
        spark.table(tables.metrics)
        .filter(
            (F.col("family") == FAMILY_MTTR)
            & (F.col("scan_id") == scan_id)
            & (F.col("scope") == scope)
        )
        .limit(1)
        .count()
        == 0
    )


def scan_log_desc(spark: SparkSession, tables: Tables, scope: str) -> list:
    """**This scope's** scan log, most recent first.

    Every reader below wants the same rows in the same order, and a reconcile needs all of
    them. The log has one row per scan ever run, so collecting it is cheap -- what is not cheap
    is doing it repeatedly, because each `collect()` is its own Spark job however few rows come
    back.

    Scoped, and this is the filter the disappearance guard rests on. ``previous_scan`` and
    ``prev_scan_id_by_severity`` both read this list, and what they answer is "what did the last
    scan OF THIS POPULATION see". Hand them another scope's scans and every row of this scope is
    absent from that scan by construction, which is what resolution-by-disappearance reads as a
    fix. The three scopes interleave in this table -- an `sca` scan runs between two `os` scans
    on every chained job -- so unscoped is not a rare mistake here, it is the normal case.

    ``resolved_count`` rides along for ``closed_observed``, which counts this register's
    resolutions per month from these rows instead of reading the table back after its own
    commit record has landed in it.
    """
    return (
        spark.table(tables.metrics)
        .filter((F.col("family") == FAMILY_SCAN) & (F.col("scope") == scope))
        .select("scan_id", "scan_ts", "severities", "resolved_count")
        .orderBy(F.col("scan_ts").desc(), F.col("scan_id").desc())
        .collect()
    )


def previous_scan(
    spark: SparkSession, tables: Tables, scope: str, rows: Optional[list] = None
) -> Optional[tuple]:
    """``(scan_id, scan_ts)`` of this scope's most recent logged scan, or ``None`` if it has
    never been scanned.

    ``rows`` is an already-collected ``scan_log_desc`` **for this same scope**, for a caller
    that needs it anyway. ``scope`` is still required in that case: it is what the argument has
    to have been filtered by, and taking it here is what stops the filtering being a convention
    the call site cannot show.
    """
    if rows is None:
        rows = scan_log_desc(spark, tables, scope)
    return (rows[0]["scan_id"], rows[0]["scan_ts"]) if rows else None


def prev_scan_id_by_severity(
    spark: SparkSession, tables: Tables, scope: str, rows: Optional[list] = None
) -> dict:
    """``{severity: scan_id}`` of this scope's most recent prior scan covering each severity.

    Port of ``gas/src/domain/ledgerCore.ts::prevScanIdBySeverity``. Feeds ``reconcile``'s
    disappearance guard so a finding that vanished while its severity went unscanned still
    resolves on the first scan that covers it again, instead of being stranded open forever.

    "Severity scope" and "population scope" are two different scopes and this function is about
    both: it answers per severity, over one population. A row from another population would
    mark a severity covered by a scan that never looked at this register at all.
    """
    remaining = set(SEVERITY_ORDER)
    mapping = {}
    if rows is None:
        rows = scan_log_desc(spark, tables, scope)
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

    **The key is ``(scope, vuln_key)``, not ``vuln_key``.** Every scope writes into this one
    ledger now, and the same key genuinely occurs under two of them: the same CVE reaching a
    host through an OS package and reaching a service through a library dependency is two
    findings with two clocks, two owners and two fixes, and a row can carry only one
    ``first_seen``. Joining on ``vuln_key`` alone would fold them into one row whose dates are
    whichever scope scanned last -- not a missing row, a wrong one, and one no count would
    show: the register would simply look smaller.

    The hash fallback is the second reason. ``ledger.vuln_key`` prefers the Wiz id and falls
    back to a hash of name + asset + component when there is none; that basis carries nothing
    about the population it was computed in, so two scopes can collide there without either
    having done anything unusual.

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
          ON target.vuln_key = source.vuln_key AND target.scope = source.scope
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    spark.catalog.dropTempView(view)
    # The checkpoint is done its two jobs -- the deltas above and the MERGE's source -- so its
    # blocks are released here rather than left for the JVM's context cleaner. The cleaner only
    # runs when garbage collection happens to reach the Python proxy, and a long-lived session
    # replaying or testing hundreds of scans accumulated one eagerly materialized frame per
    # scan until the driver heap ran out (measured: a 2g xdist worker died with
    # `java.lang.OutOfMemoryError: Java heap space` at stage ~10,900 of the 3.0 suite).
    materialized.unpersist()
    return deltas


def record_scan(
    spark: SparkSession, tables: Tables, *, scan_id, scan_ts, scope, severities, total, deltas
) -> None:
    """Append this scan's commit record -- the ``family='scan'`` row. Written immediately after
    the MERGE, so the window in which a crash can leave the two disagreeing is one statement
    wide -- and ``ledger_already_merged`` closes even that.

    It shares a table with the gold families now and still lands before them, which is what
    makes a crashed gold append recoverable: this row says the ledger moved, ``gold_missing``
    says the rest did not, and the retry republishes only what is absent. The other order would
    trade a resumable gap for an unrecoverable double-count.
    """
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
            FAMILY_SCAN,
        )
    ]
    df = spark.createDataFrame(
        row, METRICS_BASE_SCHEMA.replace("scan_ts TIMESTAMP", "scan_ts STRING")
    )
    write_append(
        df.withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).select(
            *SCANS_COLUMNS, "family"
        ),
        tables.metrics,
    )


def clear_scan(spark: SparkSession, tables: Tables, scan_id: str, scope: str) -> None:
    """Delete a scan's rows from the two append-only tables: bronze and metrics.

    **A scan id is unique across scopes, so the id alone would be enough.** A Databricks run
    supplies ``--scan_id={{job.run_id}}-<scope>`` -- the bundle appends the scope precisely so
    the three chained tasks of one job cannot share an id -- and a self-generated id is a uuid
    nothing else has ever written under. ``scope`` is still in the predicate because it is one
    more conjunct in a statement that already has one, and because the alternative is trusting
    a naming convention held in a YAML file two directories away: if that suffix is ever
    dropped, this DELETE would take another scope's bronze rows and its commit record with it,
    and the next scan of that scope would meet its own findings as NEW with their real ages
    gone.

    Only ever called on the retry path, where a previous attempt may have written some of them
    before failing. The ledger is deliberately not touched here: it is keyed by
    ``(scope, vuln_key)``, so there is nothing scan-shaped to delete, and its correctness comes
    from ``ledger_already_merged`` instead.

    It deletes that scan's commit record along with everything else the attempt wrote, which
    reads alarming and is not: the only caller runs it after ``recorded_scan`` came back empty,
    so there is no commit record under this ``scan_id`` to lose. Had there been one, ``main``
    would have taken the resume branch and never reached here.
    """
    for name in APPEND_TABLES:
        table = getattr(tables, APPEND_TABLE_ATTRS[name])
        if table_exists(spark, table):
            spark.sql(
                f"DELETE FROM {table} WHERE scan_id = '{scan_id}' AND scope = '{scope}'"
            )


# ---------------------------------------------------------------- bronze: ingest and write
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
    scan fetched and the scope recorded on its commit record are guaranteed to be the same list.
    If they could drift, the disappearance guard would be reasoning about a scan that never
    happened.

    **A failed ingest now leaves the batches that completed**, where a single write left nothing.
    That is a change in what a crash leaves behind, not in what a successful run produces, and
    it is already handled: a retry arrives with the same ``--scan_id`` and ``main`` runs
    ``clear_scan`` for it first, so the retry starts from an empty scan. Nothing reads bronze
    for a ``scan_id`` that has no commit record.
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


# --------------------------------------------------- reconciling a scan against the ledger
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
        scan_log = scan_log_desc(spark, tables, scope)
    prev = previous_scan(spark, tables, scope, scan_log)
    prev_scan_id = prev[0] if prev else None
    prev_scan_ts = prev[1].strftime("%Y-%m-%dT%H:%M:%SZ") if prev and prev[1] else None
    by_severity = prev_scan_id_by_severity(spark, tables, scope, scan_log) if prev else None

    # **The prior is THIS SCOPE'S ledger rows and nothing else.** One ledger holds every scope,
    # and `reconcile` resolves by absence: every `sca` row is missing from an `os` scan by
    # construction, so an unfiltered prior would date the whole of the other two registers as
    # remediated by this scan, with real-looking resolution dates and a plausible delta. The
    # sibling that had to learn this priced the mutation at 19,949 findings
    # (CLAUDE.md, gas_devsecops). `ledger._refuse_foreign_scope` is the proof this line ran.
    touched = ledger_mod.reconcile(
        spark.table(tables.ledger).where(F.col("scope") == scope),
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


def closed_observed(spark: SparkSession, scan_log: list, scan_ts: str, deltas: dict):
    """Reconciliation's own resolution count per calendar month of scan.

    The cross-check for capacity's ``closed``, which is derived from ``resolved_at`` instead.
    The two answer the same question by different routes, so a divergence is a real signal --
    and publishing both is the only way a reader can notice one.

    Computed from the same in-memory inputs ``observation_start`` takes: the scan log as it
    stood before this run, plus this run's own ``(scan_ts, resolved_count)``. **It used to read
    the scan table back**, and the number was right only because ``record_scan`` happened to
    have committed this scan's row a few statements earlier -- a figure resting on a write
    ordering that nothing stated and no test held. Reading is no longer how this scan gets
    counted, so the ordering is free to change.

    ``month`` is the first of the month at 00:00, which is what ``date_trunc("month", ...)``
    produces on the grid ``capacity_by_month`` joins this against. Truncating here and
    truncating in Spark are the same operation because the session timezone is UTC -- the
    assumption ``observation_start`` already rests on.
    """
    counted = [(row["scan_ts"], row["resolved_count"]) for row in scan_log]
    counted.append(
        (dt.datetime.strptime(scan_ts, "%Y-%m-%dT%H:%M:%SZ"), deltas["resolved_count"])
    )
    per_month: dict = {}
    for stamp, count in counted:
        # A scan row with no timestamp cannot be placed in a month, and an unplaceable
        # resolution is not a resolution in January. Skipped, as `observation_start` skips it.
        if stamp is None:
            continue
        month = stamp.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        per_month[month] = per_month.get(month, 0) + int(count or 0)
    return spark.createDataFrame(
        sorted(per_month.items()), "month TIMESTAMP, closed_observed LONG"
    )


# --------------------------------------------- gold: build and publish the metric families
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
    """One scan, end to end above bronze: silver in memory, the ledger, then the gold families.

    Silver is computed and never stored. It is a pure per-scan projection of bronze -- the
    snapshot columns read the frame in memory, and `panels._silver_frame` rebuilds it from
    bronze the same way -- so a table would be a second copy of data the register already holds.
    Bronze is what must survive; see the README's PoC storage section.

    ``summary=False`` skips the printed report. The report is the only reason the gold frames
    are cached, so a caller that does not want the printing does not want the caching either --
    which is why the test suite passes it: nothing there reads stdout, and the ``show()`` calls
    per scan over the widest plans in this file are the single most expensive thing the suite
    used to do.

    ``total`` is this scan's finding count when the caller already has it -- see
    ``reconcile_scan``. ``None`` counts the frame, which is what a caller that wrote bronze by
    some other route has to do.
    """
    # `rule=None` means "whatever this scope is classified under", resolved here rather than as
    # a default argument: the default would have to name one rule, and naming the wrong one is a
    # full page of plausible numbers rather than an error. See config.rule_for_scope.
    rule = rule or rule_for_scope(scope)
    # Scoped as well as pinned: bronze holds every scope's findings under its own scan ids, and
    # a scan id that ever collided across scopes would silently widen this scan's population.
    bronze = spark.table(tables.bronze).filter(
        f"scan_id = '{scan_id}' AND scope = '{scope}'"
    )
    silver = metrics.classify_risk(metrics.silver_findings(bronze, scope), rule).cache()

    # Collected once, here, and used three times: the reconciler needs the previous scan and its
    # severity coverage, capacity needs the earliest scan on record and reconciliation's own
    # resolutions per month. Reading the same small table three times is three Spark jobs for
    # one answer. Collected BEFORE the reconcile, so it does not contain this scan -- which is
    # what both `observation_start` and `closed_observed` assume of it.
    scan_log = scan_log_desc(spark, tables, scope)
    deltas = reconcile_scan(
        spark, tables, silver, scan_id=scan_id, scan_ts=scan_ts, scope=scope,
        severities=severities, disappearance=disappearance, scan_log=scan_log, total=total,
    )
    publish_gold(
        spark, tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope, severities=severities,
        rule=rule, scan_log=scan_log, deltas=deltas, silver=silver, summary=summary,
    )
    silver.unpersist()


def publish_gold(
    spark: SparkSession,
    tables: Tables,
    *,
    scan_id: str,
    scan_ts: str,
    scope: str,
    severities,
    rule,
    scan_log: list,
    deltas: dict,
    silver,
    summary: bool = True,
) -> None:
    """The gold families for one scan, published as ONE append to ``metrics``.

    Factored out of ``build_metrics`` because it has a second caller: ``main``'s resume path,
    where the commit record landed and this append did not (see ``gold_missing``). Nothing here
    touches the ledger, and everything it needs is either passed in or re-derivable from bronze
    and the ledger -- which is what makes that resume a republish rather than a second
    reconcile.

    **One append, not one per family.** The families have different columns, so they are folded with
    ``unionByName(allowMissingColumns=True)`` and each family's own columns come back NULL on
    the other families' rows. That is what makes gold atomic: one Delta commit, so
    ``gold_missing`` can never see half a scan.

    ``scan_log`` must be the log as it stood **before** this scan's commit record. Both readers
    of it here add this scan themselves, so a log that already contains it counts this run's
    resolutions twice.
    """
    # Gold comes from the ledger, not from the snapshot. This is the whole of v2 in one line:
    # every finding the register has ever seen, with the dates we actually observed, including
    # the ones the API has long since stopped returning.
    # Scoped for the same reason the reconcile's prior is, with a quieter failure: gold that
    # blended three populations would publish one MTTR curve over host CVEs, library CVEs and
    # source findings at once. Nothing would error and every count would simply be wrong.
    lifecycles = metrics.classify_risk(
        ledger_mod.lifecycle_frame(
            spark.table(tables.ledger).where(F.col("scope") == scope), scan_ts
        ),
        rule,
    ).cache()

    # `summarize` reads the gold frames back. They are lazy, so without this each of its
    # `show()` calls is a *second* full execution of the plan behind it -- two whole populations
    # for capacity -- plus an ordering shuffle, purely to print rows that were just written.
    # Caching before the union is folded makes the single append below populate the cache and
    # the printing read it. The frames are a handful of rows each; only the plans behind them
    # are large, which is exactly why this is worth doing.
    published = []

    def publish(frame):
        if summary:
            frame = frame.cache()
            published.append(frame)
        return frame

    mttr = metrics.with_scan_columns(
        with_snapshot_columns(
            metrics.mttr_by_severity(lifecycles), metrics.mttr_by_severity(silver)
        ),
        scan_id, scan_ts, scope, FAMILY_MTTR,
    )
    mttr = mttr.join(metrics.resolution_sources(lifecycles), "severity", "left")
    # The second clock, joined in beside the first rather than replacing it. Both frames group
    # the same lifecycles by the same key and both emit an OVERALL row, so this is a left join
    # onto an identical severity set: it can neither drop a row nor duplicate one, and
    # `test_panels.py` asserts exactly that against the real register rather than leaving it
    # as a claim. `write_append` passes mergeSchema, so a `metrics` table written before these
    # columns existed gains them on the next scan instead of refusing the write.
    mttr = publish(mttr.join(metrics.actionable_mttr_by_severity(lifecycles), "severity", "left"))

    program = metrics.with_scan_columns(
        metrics.confusion_matrix(lifecycles), scan_id, scan_ts, scope, FAMILY_PROGRAM
    )
    program = publish(program.withColumn("risk_rule", F.lit(rule.sentence())))

    # Both populations, stacked: the all-findings backlog throughput and the high-risk net flow
    # P2P v3 actually defines. Every reader of this family has to filter on `population`.
    capacity = publish(
        metrics.with_scan_columns(
            metrics.capacity_populations(
                lifecycles,
                scan_ts,
                observed_from=observation_start(scan_log, scan_ts),
                closed_observed=closed_observed(spark, scan_log, scan_ts, deltas),
            ),
            scan_id, scan_ts, scope, FAMILY_CAPACITY,
        )
    )

    # P2P v5's asset-centric family. Both populations, stacked, for the same reason capacity
    # stacks them -- so every read has to say which. `observed_from` is shared with capacity
    # above: without it the rate-per-watched-month columns are NULL rather than reconstructed.
    assets = publish(
        metrics.with_scan_columns(
            metrics.asset_profile_populations(
                lifecycles, scan_ts, observed_from=observation_start(scan_log, scan_ts)
            ),
            scan_id, scan_ts, scope, FAMILY_ASSETS,
        )
    )

    # The whole of gold in one Delta commit, which is what `gold_missing` relies on: a scan's
    # families are all present or all absent, never some of each.
    union = mttr
    for frame in (program, capacity, assets):
        union = union.unionByName(frame, allowMissingColumns=True)
    write_append(union, tables.metrics)

    if summary:
        summarize(
            scan_id, scope, rule, deltas, mttr, program, capacity, assets,
            severities=severities,
        )
        for frame in published:
            frame.unpersist()
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


# ---------------------------------------------------------------- the run summary, printed
def summarize(
    scan_id, scope, rule, deltas, mttr, program, capacity, assets=None, *, severities=None
) -> None:
    """Print every metric family.

    Previously only the program frame was shown, so MTTR and capacity were computed, written
    and then never mentioned -- from the notebook it looked like the pipeline did not do MTTR
    at all. If a number is worth a table, it is worth a line of output.
    """
    # The severity gate rides in the header beside the scope and the rule, because all three
    # decide the population every number below is about. A gate is a refusal to measure, not a
    # measurement, so it has to be stated rather than inferred from a smaller count.
    gate = serialize_severities(severities) or "every severity"
    print(f"[{scan_id}] scope: {scope} | severities: {gate} | risk rule: {rule.sentence()}")
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


# -------------------------------------------------------------------- parameter resolution
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
        #
        # This one keeps the scope in its name even though the tables no longer do, and the
        # difference is what the directory IS: per-run scratch, not the register. Two scopes
        # scanning concurrently in CSV-register mode each want their own disposable Delta side
        # -- they are separate runs writing separate CSV registers, not one register two runs
        # share -- and a shared scratch directory would have them MERGE into each other's
        # ledger for the length of a run. The register itself is one table set; this is not it.
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
    namespace: str, argv: Optional[list] = None, data_path: str = ""
) -> Tables:
    """The three table references, prefixed so they can share a schema with other teams' tables.

    **No ``scope``.** Every scope resolves the same three tables; which population a row belongs
    to is the ``scope`` column, which is part of the ledger's key and part of every read of it.
    The parameter used to be here because the prefix carried the scope -- see
    ``DEFAULT_TABLE_PREFIX`` for why it no longer does.

    With ``data_path`` set, each is ``delta.`<path>/<prefix><name>``` -- a directory per table
    under one root, named identically to the tables a catalog-backed run would create, so the
    migration recipe in the README is a `CREATE TABLE ... LOCATION` per directory and nothing
    has to be renamed.
    """
    prefix = param("table_prefix", DEFAULT_TABLE_PREFIX, argv=argv)
    if not PREFIX.match(prefix):
        raise RuntimeError(f"table_prefix {prefix!r} is not a valid identifier fragment")

    def qualify(name: str) -> str:
        if data_path:
            return f"delta.`{data_path}/{prefix}{name}`"
        return f"{namespace}.{prefix}{name}"

    return Tables(
        bronze=qualify(BRONZE_TABLE),
        ledger=qualify(LEDGER_TABLE),
        metrics=qualify(METRICS_TABLE),
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
    one register can be a deletion on another. It is also the list stamped on the commit record,
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


# ------------------------------------ operations: rebuild, maintain, export, ensure schema
def rebuild_ledger(
    spark: SparkSession,
    tables: Tables,
    scope: str,
    severities,
    disappearance: str,
    rule=None,
) -> int:
    """Regenerate the whole register from bronze by replaying every scan, oldest first.

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

    **It regenerates gold too, not just the ledger.** Each replayed scan reconciles, commits
    its record and then publishes its own gold from the ledger as it stands at that point in the
    replay -- the same three steps in the same order as a live scan, because it is the same two
    functions. That is what makes ``metrics`` a pure function of bronze plus the replay's
    severity scope, and it is the only way to put back the gold of a scan that a later scan has
    already moved the ledger past (see ``main``'s resume guard, which now points here).

    **It rebuilds ONE scope and leaves the other two alone.** Bronze, the ledger and the
    metrics table are shared by every scope, so every statement below names ``scope``: the
    replay reads only this scope's bronze scans, deletes only this scope's ledger rows, and
    deletes only this scope's commit records and gold. An unscoped DELETE here would empty two
    registers that have nothing to do with the recovery being attempted, and only the bronze of
    the scope being replayed would be read back -- so the other two would come back as empty
    registers, not as wrong ones. That is the single most destructive statement in this file.

    It costs what it says: the gold computation runs once per replayed scan rather than once,
    so a rebuild over a long history is a long job. It is a recovery operation and is not on any
    schedule.
    """
    rule = rule or rule_for_scope(scope)
    if not table_exists(spark, tables.bronze):
        raise RuntimeError(f"cannot rebuild: {tables.bronze} does not exist yet")

    scans = [
        (r["scan_id"], r["scan_ts"])
        for r in spark.table(tables.bronze)
        .where(F.col("scope") == scope)
        .select("scan_id", "scan_ts")
        .distinct()
        .orderBy(F.col("scan_ts").asc(), F.col("scan_id").asc())
        .collect()
    ]
    if not scans:
        print(f"[rebuild] bronze holds no {scope} scans; nothing to replay")
        return 0

    print(f"[rebuild] replaying {len(scans)} {scope} scans from {tables.bronze}")
    spark.sql(f"DELETE FROM {tables.ledger} WHERE scope = '{scope}'")
    # This scope's WHOLE share of the metrics table -- every family, not the replayed scan_ids.
    # Two predicates doing two different jobs. `scope` is the isolation one: the other two
    # registers are not being rebuilt and must not be emptied. Within the scope it is still
    # unconditional across families and ids, and that is deliberate for the reason it always
    # was: the commit-record delete is unconditional, so scoping the gold delete to the
    # replayed ids would leave gold rows for a scan whose bronze has since been pruned, with no
    # commit record beside them -- precisely the half-written state `gold_missing` detects.
    # Everything deleted here is re-derived below from this scope's bronze, which is the table
    # that must survive.
    spark.sql(f"DELETE FROM {tables.metrics} WHERE scope = '{scope}'")

    # The scan log was just emptied, so it starts empty and this loop is the only thing that
    # adds to it. Collecting it once and extending it here is what stops the replay re-reading
    # a table it is itself growing -- one collect per scan over n rows is O(n^2) across the
    # replay, and the replay is the longest-running thing in this file.
    scan_log: list = []
    for index, (scan_id, scan_ts) in enumerate(scans, start=1):
        ts_iso = scan_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        bronze = spark.table(tables.bronze).filter(
            (F.col("scan_id") == scan_id) & (F.col("scope") == scope)
        )
        # Cached because it has three consumers -- `observed`, the row count in
        # `reconcile_scan`, and the snapshot columns in `publish_gold` -- and without this each
        # one re-reads bronze and re-parses every node_json. The live path caches for the same
        # reason (see `build_metrics`).
        silver = metrics.classify_risk(metrics.silver_findings(bronze, scope), rule).cache()
        try:
            deltas = reconcile_scan(
                spark, tables, silver, scan_id=scan_id, scan_ts=ts_iso, scope=scope,
                severities=severities, disappearance=disappearance, scan_log=scan_log,
            )
            # Gold last, exactly as a live scan orders it: MERGE, then the commit record one
            # statement later, then this. `scan_log` is still the log as it stood BEFORE this
            # scan -- the insert below is what adds it -- which is what `observation_start` and
            # `closed_observed` both require of it.
            publish_gold(
                spark, tables, scan_id=scan_id, scan_ts=ts_iso, scope=scope,
                severities=severities, rule=rule, scan_log=scan_log, deltas=deltas,
                silver=silver, summary=False,
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
                # `closed_observed` reads this off the log rather than off the table, so a
                # synthetic row missing it would silently drop that scan's resolutions from
                # the month they happened in.
                resolved_count=deltas["resolved_count"],
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

    **Once, not once per scope.** It takes no ``scope`` and filters none: OPTIMIZE lays out a
    whole table, and there is one table set now rather than one per scope, so a second run of
    this would rewrite the same two tables a second time for nothing. The bundle schedules one
    maintain job, not three -- clustering on ``(scope, vuln_key)`` is what makes one layout
    serve all three registers.

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


# ------------------------------------------------------------------------------------ main
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
    tables = resolve_tables(namespace, data_path=data_path)
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
            prefix=param("table_prefix", DEFAULT_TABLE_PREFIX),
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
            spark, restore_from, tables, prefix=param("table_prefix", DEFAULT_TABLE_PREFIX)
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
        latest = previous_scan(spark, tables, scope)
        return RunResult(
            tables=tables, scan_id=latest[0],
            scan_ts=latest[1].strftime("%Y-%m-%dT%H:%M:%SZ"), scope=scope,
        )

    supplied_scan_id = scan_id or param("scan_id")
    scan_id = supplied_scan_id or f"scan-{uuid.uuid4().hex[:12]}"
    scan_ts = utc_now_iso()

    # Idempotency. A Job retry arrives with the same --scan_id={{job.run_id}} as the attempt it
    # is retrying, and reconciling one scan twice would advance every lifecycle a second time.
    logged = recorded_scan(spark, tables, scan_id, scope)
    if logged is not None:
        # The scan's own timestamp, not this attempt's wall clock: every row already written
        # under this scan_id carries the recorded one, and gold republished below has to land
        # on the same instant or the scan would describe two different moments.
        if logged["scan_ts"] is not None:
            scan_ts = logged["scan_ts"].strftime("%Y-%m-%dT%H:%M:%SZ")
        if gold_missing(spark, tables, scan_id, scope):
            # The commit record landed and the gold append did not. Gold is re-derivable, so
            # this republishes it instead of skipping the scan -- which is what used to happen,
            # leaving a scan permanently in the ledger and permanently absent from every metric
            # anyone reads. The ledger is deliberately untouched: it already has this scan.

            # The log WITHOUT this scan's own row. `observation_start` and `closed_observed`
            # both add this scan themselves, and this time its commit record IS in the table --
            # left in, it would count this scan's resolutions twice.
            scan_log = [
                r for r in scan_log_desc(spark, tables, scope) if r["scan_id"] != scan_id
            ]

            # **Only the newest scan's gold can be resumed.** Gold describes the ledger AS OF a
            # scan, and the ledger only ever stands at one scan at a time: the rows in it now
            # are the state after the last scan that merged. So republishing an older scan's
            # gold would stamp a later scan's ledger with this scan's `scan_ts` -- a wrong
            # number rather than a missing one, and one nothing downstream could tell from a
            # right one. A scan that cannot be *proved* older counts as blocking: "cannot
            # tell" is not "safe".
            recorded_ts = logged["scan_ts"]
            blocking = [
                row
                for row in scan_log
                if recorded_ts is None or row["scan_ts"] is None or row["scan_ts"] > recorded_ts
            ]
            if blocking:
                other = blocking[0]
                when = (
                    other["scan_ts"].strftime("%Y-%m-%dT%H:%M:%SZ")
                    if other["scan_ts"] is not None
                    else "an unrecorded time"
                )
                raise RuntimeError(
                    f"scan {scan_id} has a commit record but no gold, and its gold can no "
                    f"longer be republished: {other['scan_id']} ({when}) is not older than "
                    f"it, so {tables.ledger} no longer stands where {scan_id} left it. Gold "
                    f"is computed from the ledger as it stands and the ledger stands at one "
                    f"scan at a time, so publishing now would stamp a later scan's state with "
                    f"{scan_id}'s scan_ts.\n"
                    f"Recover with --rebuild_ledger: it replays every scan in "
                    f"{tables.bronze} oldest-first and republishes each one's gold from the "
                    f"ledger as it stood at that scan, which is the only way to put "
                    f"{scan_id}'s gold back once a later scan has moved the ledger on. A fresh "
                    f"scan is the other option: its gold will describe the ledger as it then "
                    f"stands, and {scan_id} simply stays missing from the trend."
                )

            # The same resolution `build_metrics` performs, so the republished gold is
            # classified exactly as the original attempt classified it -- see
            # config.rule_for_scope. A second spelling here would be a second place for the
            # scope-to-rule mapping to drift.
            rule = rule_for_scope(scope)
            # Silver from bronze, the same projection `panels._silver_frame` derives and the
            # same one the original attempt built -- bronze still holds this scan's findings
            # under this scan_id.
            bronze = spark.table(tables.bronze).filter(
                f"scan_id = '{scan_id}' AND scope = '{scope}'"
            )
            silver = metrics.classify_risk(metrics.silver_findings(bronze, scope), rule)
            publish_gold(
                spark, tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope,
                severities=parse_severities(logged["severities"]), rule=rule,
                scan_log=scan_log,
                deltas={
                    k: int(logged[k] or 0)
                    for k in ("new_count", "resolved_count", "reopened_count")
                },
                silver=silver,
            )
            print(f"[{scan_id}] resumed gold")
        else:
            print(
                f"[{scan_id}] already recorded ({logged['new_count']} new, "
                f"{logged['resolved_count']} resolved) -- nothing to do"
            )
        return RunResult(tables=tables, scan_id=scan_id, scan_ts=scan_ts, scope=scope)

    # Torn write: the MERGE committed but the scan log did not. Reconciling again would resolve
    # by disappearance everything already accounted for, so refuse rather than corrupt.
    if ledger_already_merged(spark, tables, scan_id, scope):
        raise RuntimeError(
            f"scan {scan_id} is already reflected in {tables.ledger} but has no "
            f"family='{FAMILY_SCAN}' row in {tables.metrics}: a previous run committed the "
            f"ledger MERGE and then failed. Re-running would double-count it. Recover with "
            f"--rebuild_ledger, or re-run with a fresh --scan_id if that scan's findings were "
            f"never fully ingested."
        )

    # A retry may have written part of the append-only tables before dying. Only a scan_id that
    # came from outside can be a retry: a self-generated one is a fresh uuid nothing has ever
    # written under, so the two DELETEs would be two Delta statements matching nothing.
    if supplied_scan_id:
        clear_scan(spark, tables, scan_id, scope)

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
