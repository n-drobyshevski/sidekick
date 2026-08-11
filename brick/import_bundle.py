"""Seed the ledger from a GAS migration bundle -- the one-shot import that carries an
existing deployment's history into Delta.

The problem this exists for: `gas/` has been reconciling a daily scan for months and holds
the only record of when each finding was first seen and when it stopped being returned.
brick starting from an empty ledger does not merely lack a chart -- it is *wrong*. Every
``first_seen`` collapses to today, so Kaplan-Meier reads near zero, the capacity grid marks
everything before today as ``reconstructed``, and the confusion matrix is computed over a
population one scan deep. ``--rebuild_ledger`` cannot help: it replays bronze, and a fresh
deployment's bronze is empty.

**What this reads.** The ``wiz-sidekick-migration`` bundle written by
``gas/src/domain/exportBundle.ts`` (Data -> Migration bundle), which is the same format
``wiz_dashboard/data/migrate.py`` emits and the GAS importer accepts. One JSON file,
optionally gzipped:

    {"kind": "wiz-sidekick-migration", "version": 1, "exported_at": ...,
     "scans": [...], "ledger": [...], "episodes": [...], "mttr_history": [...]}

**What it writes.** ``<prefix>vuln_ledger`` and ``<prefix>scans``. Nothing else: bronze and
silver stay empty, because the bundle carries reconciled lifecycles rather than raw findings,
and the gold tables are produced by the next ordinary run from the ledger this seeds.

**Why the mapping is nearly free.** ``config.LEDGER_COLUMNS`` was written to mirror
``gas/src/domain/reconcile.ts``'s list, so 23 of GAS's 24 columns land 1:1. The three
differences are stated in config.py and handled here: ``scope`` is stamped from the run,
``component`` has no GAS source (see ``h:`` below), and ``tags_json`` is dropped because
brick's ingest selects no asset tags and nothing downstream would read it.

Four places where a plausible-looking mapping is silently wrong, each with a test:

  * **A missing risk signal is NULL, not false.** ``has_kev`` / ``has_exploit`` / ``epss``
    stay three-valued the whole way through -- see the correctness trap at the top of
    metrics.py. Coercing an uncaptured signal to false inflates efficiency and deflates
    coverage at the same time, and nothing in the output says so.
  * **``severities`` is serialized differently on the two sides.** GAS writes JSON array
    text (``["CRITICAL", "HIGH"]``, gas/src/domain/compaction.ts) and brick writes sorted
    comma-joined text (``CRITICAL,HIGH``, run_pipeline.serialize_severities). Copied
    verbatim, ``run_pipeline.parse_severities`` returns None for it, which brick reads as
    *unscoped* -- the exact state the disappearance scope guard exists to prevent.
  * **A settled lifecycle can live in ``episodes`` rather than ``ledger``.** GAS compaction
    moves resolved rows out of the live table, and ``ledgerCore.baseRows`` unions the two --
    so the population GAS's own coverage and MTTR are computed over is ledger + episodes.
    Importing only ``ledger`` silently shrinks both.
  * **``last_scan_id`` is load-bearing.** ``ledger.reconcile``'s disappearance branch fires
    only when a row's ``last_scan_id`` equals the immediately-previous scan's id, so the
    imported scan log and the imported rows have to agree. They do, as long as both tables
    are seeded together -- which is why this refuses to write one without the other.

**The ``h:`` caveat, stated once.** ``vuln_key`` is ``id:<wiz finding id>`` when the API
gave one and a hash otherwise, and the hash basis includes ``component``, which GAS never
persisted. An imported ``h:`` row will therefore be re-hashed differently by the next brick
scan and start a second lifecycle. Only findings with no Wiz id are affected, which is why
the summary prints the ``h:`` count -- that number is the blast radius, and it is usually
zero.
"""

from __future__ import annotations

import gzip
import json
from typing import Any, Dict, List, Optional, Sequence

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import LongType, StringType, StructField, StructType

import ledger as ledger_mod
import metrics
import run_pipeline
from config import STATUS_OPEN, STATUS_RESOLVED

# See config.PIPELINE_VERSION: every module in the folder must report the same version.
MODULE_VERSION = "2.2"

# The interchange contract, shared with gas/src/domain/importMerge.ts and
# wiz_dashboard/data/migrate.py. Bumping either of these is a coordinated change across
# three codebases, which is why they are named rather than inlined.
BUNDLE_KIND = "wiz-sidekick-migration"
BUNDLE_VERSION = 1

# The deep-history half of a windowed export (migrate.ARCHIVE_KIND). GAS refuses it as a
# live import and so does this: it carries no scans, so seeding from it would leave every
# imported row with a last_scan_id that names no scan brick knows about, and the
# disappearance guard would never fire for any of them.
ARCHIVE_KIND = "wiz-sidekick-migration-archive"


class BundleError(Exception):
    """A bundle that cannot be imported. Raised before anything is written."""


# --------------------------------------------------------------------------- cell coercions
#
# The bundle is JSON, so most values arrive with the right Python type already. These exist
# for the paths where they do not: a bundle round-tripped through Sheets carries booleans as
# the literal strings "TRUE"/"FALSE" (gas/src/server/sheetsDb.ts formats every cell as plain
# text), and a hand-edited file can carry anything.


def _str(value: Any) -> Optional[str]:
    """Port of ``importMerge.str``: absent, null and empty string all mean NULL."""
    if value is None or value == "":
        return None
    return str(value)


def _bool(value: Any) -> Optional[bool]:
    """Three-valued. **NULL is not false** -- see the module docstring.

    Accepts real JSON booleans and the "TRUE"/"FALSE" text a Sheets round-trip produces.
    Anything else is treated as never-captured rather than guessed at, because a wrong
    guess here moves a published rate and leaves no trace.
    """
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return None
    text = str(value).strip().upper()
    if text in {"TRUE", "1"}:
        return True
    if text in {"FALSE", "0"}:
        return False
    return None


def _float(value: Any) -> Optional[float]:
    """EPSS, keeping NULL distinct from 0.0 and rejecting NaN (which is not a probability)."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if number != number else number  # NaN != NaN


def _int(value: Any) -> int:
    """Counters. Absent means zero here -- unlike the signals, a count has no unknown state."""
    if value is None or value == "" or isinstance(value, bool):
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _status(value: Any) -> str:
    """``OPEN`` / ``RESOLVED``, defaulting to OPEN like ``importMerge.coerceLedger``.

    Upper-cased because ``reconcile`` compares against the constants literally, and a row
    reading "open" would be neither OPEN nor RESOLVED -- it would simply never resolve.
    """
    text = str(value).strip().upper() if value not in (None, "") else ""
    return STATUS_RESOLVED if text == STATUS_RESOLVED else (text or STATUS_OPEN)


def gas_severities(text: Any) -> Optional[str]:
    """GAS's ``scans.severities`` text in brick's serialization.

    GAS writes ``'["CRITICAL", "HIGH"]'`` (gas/src/domain/compaction.ts:24-38); brick writes
    ``'CRITICAL,HIGH'`` (run_pipeline.serialize_severities). NULL means *unscoped* on both
    sides and passes straight through -- getting that one backwards would either freeze every
    lifecycle or mass-resolve the register.

    A value that is already in brick's form is accepted too, so a bundle that has been
    through a converter twice is not corrupted by the second pass.
    """
    if text is None or str(text).strip() == "":
        return None
    raw = str(text).strip()
    values: Sequence[Any]
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None
        if not isinstance(parsed, list):
            raise BundleError(f"Unreadable severity scope on a bundle scan: {text!r}")
        values = parsed
    else:
        values = raw.split(",")
    return run_pipeline.serialize_severities([v for v in values if isinstance(v, str)])


# ------------------------------------------------------------------------------- reading
def load_bundle(path: str) -> dict:
    """Read the bundle from a Volume / DBFS / local path, gzipped or not.

    Sniffs the gzip magic bytes rather than trusting the extension, matching
    ``archiveStore.parseGzBlob`` -- a file downloaded from Drive and decompressed by the
    browser keeps its ``.json.gz`` name, and that should not be an error.
    """
    with open(path, "rb") as handle:
        head = handle.read(2)
        handle.seek(0)
        raw = gzip.decompress(handle.read()) if head == b"\x1f\x8b" else handle.read()
    try:
        return validate_bundle(json.loads(raw.decode("utf-8")))
    except ValueError as exc:
        raise BundleError(f"{path} is not readable JSON: {exc}") from exc


def _rows(data: dict, name: str) -> List[dict]:
    value = data.get(name)
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(r, dict) for r in value):
        raise BundleError(f'Bundle field "{name}" must be a list of objects.')
    return value


def validate_bundle(data: Any) -> dict:
    """Structural validation. Port of ``importMerge.validateBundle``, minus its row caps --
    those exist because a GAS execution has six minutes and a spreadsheet has ten million
    cells, and neither is true here."""
    if not isinstance(data, dict):
        raise BundleError("The file is not a migration bundle (expected a JSON object).")
    kind = data.get("kind")
    if kind == ARCHIVE_KIND:
        raise BundleError(
            "This is the deep-history archive half of a split export, which carries no scans "
            "-- importing it would leave every row pointing at a scan brick has never seen, "
            "and none of them could ever resolve by disappearance. Import the live bundle."
        )
    if kind != BUNDLE_KIND:
        raise BundleError(f"Not a migration bundle (kind {kind!r}).")
    version = data.get("version")
    if str(version) != str(BUNDLE_VERSION):
        raise BundleError(
            f"Unsupported bundle version {version!r} -- this importer understands version "
            f"{BUNDLE_VERSION}. The bundle may come from a newer exporter."
        )
    scans = _rows(data, "scans")
    for scan in scans:
        if not _str(scan.get("scan_id")) or not _str(scan.get("ts")):
            raise BundleError("Every bundle scan needs a scan_id and a ts.")
    for name in ("ledger", "episodes"):
        for row in _rows(data, name):
            if not _str(row.get("vuln_key")):
                raise BundleError(f"Every bundle {name} row needs a vuln_key.")
    if not scans:
        raise BundleError(
            "The bundle has no scans. The scan log is what dates the observation window and "
            "what the disappearance guard compares against, so a ledger without it cannot be "
            "continued -- export again from a register that has scanned at least once."
        )
    return data


# --------------------------------------------------------------------------- ledger frame
#
# Timestamps arrive as ISO-8601 strings and are cast by Spark rather than parsed in Python:
# the session timezone is pinned to UTC (run_pipeline.get_spark), so one cast is both the
# cheapest and the only place a timezone assumption lives.

_RAW_LEDGER_SCHEMA = StructType(
    [
        StructField(f.name, StringType() if f.dataType.typeName() == "timestamp" else f.dataType)
        for f in ledger_mod.LEDGER_SCHEMA
    ]
)


def _ledger_row(row: dict, *, scope: str) -> tuple:
    return (
        str(row["vuln_key"]),
        scope,
        _str(row.get("cve")),
        # No GAS source: the column is brick's, and reconcile.ts never persisted it.
        None,
        _str(row.get("severity")),
        _str(row.get("asset_id")),
        _str(row.get("asset_name")),
        _str(row.get("asset_type")),
        _str(row.get("cloud")),
        _str(row.get("subscription_name")),
        _str(row.get("subscription_ext_id")),
        _str(row.get("first_seen")),
        _str(row.get("last_seen")),
        _status(row.get("status")),
        _str(row.get("resolved_at")),
        _str(row.get("resolution_src")),
        _int(row.get("reopened_count")),
        _str(row.get("first_scan_id")),
        _str(row.get("last_scan_id")),
        _str(row.get("fix_date")),
        _str(row.get("fix_observed_at")),
        _bool(row.get("has_kev")),
        _bool(row.get("has_exploit")),
        _float(row.get("epss")),
        _str(row.get("risk_observed_at")),
    )


def _episode_row(row: dict, *, scope: str) -> tuple:
    """A sealed episode as a ledger row.

    An episode is a completed lifecycle: GAS compaction moved it out of the live table and
    ``ledgerCore.baseRows`` unions it back in at read time. brick has no episodes table, so it
    lands as an ordinary RESOLVED row -- which is what every metric treats it as anyway.

    ``last_seen`` takes ``resolved_at`` because that is the last moment the lifecycle was
    known to be real; the scan ids are NULL because the scans that saw it were sealed and
    are not in the bundle. A NULL ``last_scan_id`` cannot match the disappearance guard's
    previous scan -- correct, and harmless: the row is already resolved.
    """
    resolved_at = _str(row.get("resolved_at"))
    return (
        str(row["vuln_key"]),
        scope,
        _str(row.get("cve")),
        None,
        _str(row.get("severity")),
        None, None, None, None, None, None,      # asset + subscription: not on an episode
        _str(row.get("first_seen")),
        resolved_at,
        STATUS_RESOLVED,
        resolved_at,
        _str(row.get("resolution_src")),
        _int(row.get("reopened_count")),
        None,
        None,
        _str(row.get("fix_date")),
        _str(row.get("fix_observed_at")),
        _bool(row.get("has_kev")),
        _bool(row.get("has_exploit")),
        _float(row.get("epss")),
        _str(row.get("risk_observed_at")),
    )


def selectable_episodes(bundle: dict) -> tuple:
    """``(rows, collapsed)`` -- the episodes that become ledger rows, and how many were dropped.

    Two filters and a collapse:

      * ``superseded_by_scan`` set means a later scan took the lifecycle over, so the live
        ledger row already tells its story. Same predicate ``baseRows`` applies.
      * a ``vuln_key`` that also has a live row keeps the live row. brick's ledger is one row
        per key by construction, and a reopen there overwrites rather than archives.
      * successive compactions can leave several episodes for one key. Only one can be
        represented, so the most recently resolved wins and the rest are counted as
        ``collapsed`` -- lost remediation events that would otherwise vanish unremarked.
    """
    live = {str(r["vuln_key"]) for r in _rows(bundle, "ledger")}
    best: Dict[str, dict] = {}
    collapsed = 0
    for row in _rows(bundle, "episodes"):
        key = str(row["vuln_key"])
        if row.get("superseded_by_scan") not in (None, "") or key in live:
            continue
        current = best.get(key)
        if current is None:
            best[key] = row
            continue
        collapsed += 1
        if str(row.get("resolved_at") or "") > str(current.get("resolved_at") or ""):
            best[key] = row
    return list(best.values()), collapsed


def ledger_frame(spark: SparkSession, bundle: dict, *, scope: str) -> DataFrame:
    """The bundle's lifecycles as a frame matching ``ledger.LEDGER_SCHEMA``.

    Severity is normalized on the way in (blank / unrecognized -> ``UNKNOWN``) rather than
    passed through, matching ``importMerge.coerceLedger``: a literal null severity would drop
    out of every by-severity aggregate silently, where UNKNOWN is at least auditable.
    """
    episodes, _ = selectable_episodes(bundle)
    rows = [_ledger_row(r, scope=scope) for r in _rows(bundle, "ledger")]
    rows += [_episode_row(r, scope=scope) for r in episodes]
    raw = spark.createDataFrame(rows, _RAW_LEDGER_SCHEMA)
    return raw.select(
        *[
            metrics.normalize_severity(F.col("severity")).alias("severity")
            if field.name == "severity"
            else F.col(field.name).cast(field.dataType).alias(field.name)
            for field in ledger_mod.LEDGER_SCHEMA
        ]
    )


# ---------------------------------------------------------------------------- scans frame

_RAW_SCANS_SCHEMA = StructType(
    [
        StructField("scan_id", StringType()),
        StructField("scan_ts", StringType()),
        StructField("scope", StringType()),
        StructField("severities", StringType()),
        StructField("total", LongType()),
        StructField("new_count", LongType()),
        StructField("resolved_count", LongType()),
        StructField("reopened_count", LongType()),
    ]
)


def scans_frame(spark: SparkSession, bundle: dict, *, scope: str) -> DataFrame:
    """The bundle's run log as a frame matching ``run_pipeline.SCANS_SCHEMA``.

    ``mode``, ``shape``, ``raw_ref``, ``obs_ref`` and ``sealed`` are dropped: the first two are
    GAS scan-job bookkeeping, the refs are Drive ids meaningless off that deployment, and
    brick has no compaction for ``sealed`` to describe.
    """
    rows = [
        (
            str(r["scan_id"]),
            _str(r.get("ts")),
            scope,
            gas_severities(r.get("severities")),
            _int(r.get("total")),
            _int(r.get("new_count")),
            _int(r.get("resolved_count")),
            _int(r.get("reopened_count")),
        )
        for r in _rows(bundle, "scans")
    ]
    raw = spark.createDataFrame(rows, _RAW_SCANS_SCHEMA)
    return raw.withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))


# --------------------------------------------------------------------------------- the write

#: Every table the pipeline writes, as attributes of ``run_pipeline.Tables``. The lifecycle
#: pair first, because they are the ones this module replaces outright.
REGISTER_ATTRS = ("ledger", "scans") + tuple(run_pipeline.APPEND_TABLE_ATTRS.values())


def require_write_access(spark: SparkSession, table: str) -> None:
    """Fail now, with the grant named, rather than six Spark jobs into the import.

    Unity Catalog checks privileges when it *analyses* a statement, not when it runs one, so a
    DELETE matching nothing still has to clear the MODIFY check -- which makes it the cheapest
    honest probe available. Without it the refusal surfaces at ``saveAsTable`` after the ledger
    frame has been built and checkpointed, as a ``Py4JJavaError`` naming neither the fix nor
    the grant that would be the fix.
    """
    try:
        spark.sql(f"DELETE FROM {table} WHERE 1=0")
    except Exception as exc:  # noqa: BLE001 -- re-raised either way; only the message changes
        text = str(exc)
        if "PERMISSION_DENIED" not in text and "Unauthorized" not in text:
            raise
        raise BundleError(
            f"No write access to {table}.\n\n"
            f"Unity Catalog gives a table's owner MODIFY implicitly, so being refused it means "
            f"this principal does not own the table -- and replacing or dropping it needs "
            f"ownership or MANAGE, a strictly higher bar. Overwriting instead will not get "
            f"past this.\n\n"
            f"Ask an owner or metastore admin for the schema-level grant, which is also what "
            f"the first scan after this import needs (it creates six more tables):\n"
            f"    GRANT USE SCHEMA, SELECT, MODIFY, CREATE TABLE\n"
            f"      ON SCHEMA <catalog>.<schema> TO `<principal>`;\n\n"
            f"Or point --catalog / --schema / --table_prefix somewhere you own and seed there; "
            f"the bundle is not catalog-specific.\n\n"
            f"Original error: {text.strip().splitlines()[0]}"
        ) from exc


def _replace(spark: SparkSession, df: DataFrame, table: str) -> None:
    """Replace a table's contents: empty it, then append.

    Not ``mode("overwrite")``. That resolves through Delta's DataSource V2 catalog, which
    answers *"Table … does not support truncate in batch mode"* -- so the tidier-looking
    single-commit version is one this suite cannot run and a cluster might. DELETE-then-append
    is what ``run_pipeline.rebuild_ledger`` already does to the same two tables, needs the same
    MODIFY privilege, and is exercised by every test below.

    The cost is a window between the two statements in which the table is empty. Acceptable
    here and nowhere else: this runs once, before the register has any readers.
    """
    spark.sql(f"DELETE FROM {table}")
    run_pipeline.write_append(df, table)


def occupied_tables(spark: SparkSession, tables: run_pipeline.Tables) -> dict:
    """``{table: rows}`` for every pipeline table that exists and is not empty."""
    counts = {}
    for attr in REGISTER_ATTRS:
        table = getattr(tables, attr)
        if spark.catalog.tableExists(table):
            rows = spark.table(table).count()
            if rows:
                counts[table] = rows
    return counts


def import_bundle(
    spark: SparkSession,
    tables: run_pipeline.Tables,
    bundle: dict,
    *,
    scope: str,
    force: bool = False,
) -> dict:
    """Seed ``tables.ledger`` and ``tables.scans`` from the bundle. Returns a summary.

    Refuses a register that already holds anything, because the two ways it could go wrong are
    both silent. Merging a seed into a ledger brick has already advanced would re-open
    lifecycles it has since resolved; appending the seed's scan log beside brick's own would
    put an older scan after a newer one and hand the disappearance guard the wrong previous
    scan.

    ``force`` means **replace the register**, not merely the two tables. The gold tables are
    the reason: they are appended per scan and computed from the ledger *as it stood at that
    scan*, so rows written before the seed were derived from a ledger that started empty. Left
    in place they would sit in `04_scan_history` as a run whose MTTR reads near zero, beside
    seeded runs where it does not -- a contradiction with no visible cause. So a forced import
    empties bronze, silver and all four gold tables too, and the register genuinely restarts
    from the imported history.

    They are emptied rather than dropped: DELETE needs only MODIFY and keeps the tables' grants,
    where DROP needs ownership and would silently take the grants with it.
    """
    run_pipeline.ensure_tables(spark, tables)
    # Before the expensive part, and before anything is written.
    require_write_access(spark, tables.ledger)
    require_write_access(spark, tables.scans)

    occupied = occupied_tables(spark, tables)
    if occupied and not force:
        listed = "\n".join(f"    {t}: {n} row(s)" for t, n in occupied.items())
        raise BundleError(
            f"This register is not empty:\n{listed}\n\n"
            f"An import seeds an empty register. Merging into one that has already scanned "
            f"would re-open resolved lifecycles and mis-order the scan log, and any gold rows "
            f"already written were computed from a ledger that started empty.\n"
            f"Pass --force_import=true to REPLACE the register -- it overwrites the ledger and "
            f"the scan log and empties bronze, silver and the four gold tables."
        )

    episodes, collapsed = selectable_episodes(bundle)
    rows = ledger_frame(spark, bundle, scope=scope).localCheckpoint(eager=True)
    scans = scans_frame(spark, bundle, scope=scope)

    _replace(spark, rows, tables.ledger)
    _replace(spark, scans, tables.scans)

    cleared = {}
    for attr in run_pipeline.APPEND_TABLE_ATTRS.values():
        table = getattr(tables, attr)
        if table in occupied:
            spark.sql(f"DELETE FROM {table}")
            cleared[table] = occupied[table]

    hashed = rows.filter(F.col("vuln_key").startswith("h:")).count()
    span = rows.agg(
        F.min("first_seen").alias("first_seen"), F.max("last_seen").alias("last_seen")
    ).collect()[0]
    latest = run_pipeline.previous_scan(spark, tables)
    return {
        "ledger_rows": rows.count(),
        "episodes_folded": len(episodes),
        "episodes_collapsed": collapsed,
        "scans": scans.count(),
        "hashed_keys": hashed,
        "earliest_first_seen": span["first_seen"],
        "latest_last_seen": span["last_seen"],
        "last_scan_id": latest[0] if latest else None,
        "exported_at": bundle.get("exported_at"),
        "replaced": occupied,
        "cleared": cleared,
    }


def seeded_overview(spark: SparkSession, tables: run_pipeline.Tables) -> DataFrame:
    """What landed, by status: the read-back an operator checks the import against.

    Lives here rather than in the notebook for the same reason every other aggregate does --
    a number computed in a cell is a number no test can reach. ``earliest_first_seen`` is the
    one to look at: if it reads today, the seed did not take and every MTTR below it is
    measuring the import rather than the register.
    """
    return (
        spark.table(tables.ledger)
        .groupBy("status")
        .agg(
            F.count("*").alias("lifecycles"),
            F.min("first_seen").alias("earliest_first_seen"),
            F.max("last_seen").alias("latest_last_seen"),
            F.sum(F.col("has_kev").cast("int")).alias("kev"),
            F.count("epss").alias("epss_captured"),
        )
        .orderBy("status")
    )


def summarize(summary: dict, tables: run_pipeline.Tables) -> None:
    print(f"[import] {summary['ledger_rows']} lifecycle(s) -> {tables.ledger}")
    print(
        f"[import]   {summary['episodes_folded']} sealed episode(s) folded in"
        + (
            f", {summary['episodes_collapsed']} extra episode(s) collapsed"
            if summary["episodes_collapsed"]
            else ""
        )
    )
    print(f"[import] {summary['scans']} scan(s) -> {tables.scans}")
    if summary["replaced"]:
        print(
            f"[import] REPLACED a non-empty register: "
            + ", ".join(f"{t.split('.')[-1]} ({n})" for t, n in summary["replaced"].items())
        )
    if summary["cleared"]:
        print(
            f"[import]   emptied {len(summary['cleared'])} derived table(s) -- their rows were "
            f"computed from a ledger that started empty, so re-scan to repopulate them"
        )
    print(
        f"[import] observed {summary['earliest_first_seen']} .. {summary['latest_last_seen']}, "
        f"exported {summary['exported_at']}"
    )
    if summary["hashed_keys"]:
        print(
            f"[import] WARNING {summary['hashed_keys']} row(s) carry a hashed (h:) vuln_key. "
            f"GAS never persisted `component`, which is part of brick's hash basis, so the "
            f"next scan will re-key these and start a second lifecycle for each. Findings "
            f"with a Wiz id are unaffected."
        )
    print(
        f"[import] next: run the pipeline with the SAME --severities as GAS was scanning, and "
        f"--project_id matching WIZ_PROJECT_ID_V2. A first run that resolves most of the "
        f"register means the populations disagree -- re-import rather than accept it."
    )


def main() -> Optional[dict]:
    run_pipeline.check_deployment()
    namespace = run_pipeline.resolve_namespace()
    scope = run_pipeline.resolve_scope()
    tables = run_pipeline.resolve_tables(namespace, scope)
    path = run_pipeline.param("bundle_path")
    if not path:
        raise BundleError(
            "--bundle_path is required: the migration bundle exported from the GAS Data page, "
            "uploaded somewhere the cluster can read (a Unity Catalog volume, e.g. "
            "/Volumes/<catalog>/<schema>/<volume>/migration-....json.gz)."
        )
    bundle = load_bundle(path)

    spark = run_pipeline.get_spark()
    run_pipeline.ensure_schema(spark, namespace)
    summary = import_bundle(
        spark, tables, bundle, scope=scope, force=run_pipeline.truthy(run_pipeline.param("force_import"))
    )
    summarize(summary, tables)
    return summary


if __name__ == "__main__":
    main()
