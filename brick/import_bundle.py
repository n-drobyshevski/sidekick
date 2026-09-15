"""Seed the ledger from a GAS migration bundle -- the one-shot import that carries an
existing deployment's history into Delta.

Ported from ``brick/import_bundle.py`` when this fork absorbed the ``os`` scope (S2): the
problem it exists for is unchanged -- ``gas/`` has been reconciling a daily OS-patching scan
for months and holds the only record of when each finding was first seen and when it stopped
being returned, and starting this register's ``os`` scope from an empty ledger does not merely
lack a chart, it is *wrong*. Every ``first_seen`` collapses to today, so Kaplan-Meier reads near
zero, the capacity grid marks everything before today as ``reconstructed``, and the confusion
matrix is computed over a population one scan deep. ``--rebuild_ledger`` cannot help: it
replays bronze, and a fresh deployment's bronze is empty.

There is no equivalent history for ``sca`` or ``sast``: no prior GAS deployment scanned those
populations, so a bundle only ever exists for ``--scope=os``. Nothing here enforces that --
``scope`` is stamped from the run the same way ``run_pipeline`` stamps every other write, and
refusing a non-``os`` scope would be a policy this module has no way to verify -- but it is why
this stays deployment tooling (``MIGRATION_MODULES`` in ``run_pipeline.py``) rather than
scope-specific code.

**What this reads.** The ``wiz-sidekick-migration`` bundle written by
``gas/src/domain/exportBundle.ts`` (Data -> Migration bundle), which is the same format
``wiz_dashboard/data/migrate.py`` emits and the GAS importer accepts. One JSON file,
optionally gzipped:

    {"kind": "wiz-sidekick-migration", "version": 1, "exported_at": ...,
     "scans": [...], "ledger": [...], "episodes": [...], "mttr_history": [...]}

**What it writes.** ``<prefix>vuln_ledger``, and the ``family='scan'`` rows of
``<prefix>metrics`` -- the same commit-record shape ``run_pipeline.record_scan`` writes on an
ordinary run. Nothing else: bronze stays empty and no gold family is written, because the
bundle carries reconciled lifecycles rather than raw findings, and gold is produced by the
next ordinary run from the ledger this seeds.

**Why the mapping is nearly free.** ``config.LEDGER_COLUMNS`` was written to mirror
``gas/src/domain/reconcile.ts``'s list, so 23 of GAS's 24 columns land 1:1. The three
differences are stated in config.py and handled here: ``scope`` is stamped from the run,
``component`` has no GAS source (see ``h:`` below), and ``tags_json`` is dropped because
brick's ingest selects no asset tags and nothing downstream would read it. This fork's ledger
carries three more columns than GAS's -- ``cwe``, ``language``, ``ai_verdict`` -- and GAS has no
source for any of them either, being an OS-vulnerability register with no static-analysis
inputs: every imported row gets all three as NULL, the same "never captured" state
``has_kev``/``has_exploit``/``epss`` already use for a signal nobody measured.

Four places where a plausible-looking mapping is silently wrong, each with a test:

  * **A missing risk signal is NULL, not false.** ``has_kev`` / ``has_exploit`` / ``epss``
    stay three-valued the whole way through -- see the correctness trap at the top of
    metrics.py. Coercing an uncaptured signal to false inflates efficiency and deflates
    coverage at the same time, and nothing in the output says so.
  * **``severities`` is serialized differently on the two sides.** GAS writes JSON array
    text (``["CRITICAL", "HIGH"]``, gas/src/domain/compaction.ts) and this pipeline writes
    sorted comma-joined text (``CRITICAL,HIGH``, run_pipeline.serialize_severities). Copied
    verbatim, ``run_pipeline.parse_severities`` returns None for it, which the disappearance
    guard reads as *unscoped* -- the exact state it exists to prevent.
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
persisted. An imported ``h:`` row will therefore be re-hashed differently by the next scan
and start a second lifecycle. Only findings with no Wiz id are affected, which is why
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
MODULE_VERSION = "3.0-devsecops"

# The interchange contract, shared with gas/src/domain/importMerge.ts and
# wiz_dashboard/data/migrate.py. Bumping either of these is a coordinated change across
# three codebases, which is why they are named rather than inlined.
BUNDLE_KIND = "wiz-sidekick-migration"
BUNDLE_VERSION = 1

# The deep-history half of a windowed export (migrate.ARCHIVE_KIND). GAS refuses it as a
# live import and so does this: it carries no scans, so seeding from it would leave every
# imported row with a last_scan_id that names no scan this pipeline knows about, and the
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
    """GAS's ``scans.severities`` text in this pipeline's serialization.

    GAS writes ``'["CRITICAL", "HIGH"]'`` (gas/src/domain/compaction.ts:24-38); this pipeline
    writes ``'CRITICAL,HIGH'`` (run_pipeline.serialize_severities). NULL means *unscoped* on
    both sides and passes straight through -- getting that one backwards would either freeze
    every lifecycle or mass-resolve the register.

    A value that is already in this pipeline's form is accepted too, so a bundle that has been
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
            "-- importing it would leave every row pointing at a scan this pipeline has never "
            "seen, and none of them could ever resolve by disappearance. Import the live "
            "bundle."
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
        # No GAS source: the column is this pipeline's, and reconcile.ts never persisted it.
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
        # cwe, language, ai_verdict: static-analysis-only columns. GAS is the OS-patching
        # register and has no source for any of them -- see the module docstring.
        None,
        None,
        None,
    )


def _episode_row(row: dict, *, scope: str) -> tuple:
    """A sealed episode as a ledger row.

    An episode is a completed lifecycle: GAS compaction moved it out of the live table and
    ``ledgerCore.baseRows`` unions it back in at read time. This pipeline has no episodes
    table, so it lands as an ordinary RESOLVED row -- which is what every metric treats it as
    anyway.

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
        # cwe, language, ai_verdict: see _ledger_row.
        None,
        None,
        None,
    )


def selectable_episodes(bundle: dict) -> tuple:
    """``(rows, collapsed)`` -- the episodes that become ledger rows, and how many were dropped.

    Two filters and a collapse:

      * ``superseded_by_scan`` set means a later scan took the lifecycle over, so the live
        ledger row already tells its story. Same predicate ``baseRows`` applies.
      * a ``vuln_key`` that also has a live row keeps the live row. This pipeline's ledger is
        one row per key by construction, and a reopen there overwrites rather than archives.
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
        StructField("family", StringType()),
    ]
)


def scans_frame(spark: SparkSession, bundle: dict, *, scope: str) -> DataFrame:
    """The bundle's run log as a frame matching ``run_pipeline.METRICS_BASE_SCHEMA``.

    ``mode``, ``shape``, ``raw_ref``, ``obs_ref`` and ``sealed`` are dropped: the first two are
    GAS scan-job bookkeeping, the refs are Drive ids meaningless off that deployment, and
    this pipeline has no compaction for ``sealed`` to describe.

    Every row is stamped ``family=run_pipeline.FAMILY_SCAN``: this frame is written into
    ``tables.metrics`` now, the one table that also carries the gold families, and ``family``
    is what makes a bundle-seeded commit record readable by ``recorded_scan`` /
    ``scan_log_desc`` the same way ``record_scan``'s own rows are. The final ``select`` pins
    the column set (and order) to exactly ``SCANS_COLUMNS + ["family"]``, which is
    ``METRICS_BASE_SCHEMA``'s own column list.
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
            run_pipeline.FAMILY_SCAN,
        )
        for r in _rows(bundle, "scans")
    ]
    raw = spark.createDataFrame(rows, _RAW_SCANS_SCHEMA)
    return raw.withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).select(
        *run_pipeline.SCANS_COLUMNS, "family"
    )


# --------------------------------------------------------------------------------- the write

#: Every table the pipeline writes, as attributes of ``run_pipeline.Tables``. ``ledger`` and
#: ``metrics`` first, because they are the two this module replaces outright -- the ledger with
#: the bundle's lifecycles, ``metrics`` with the bundle's scan log (which empties whatever gold
#: was sitting beside it, same as ``force`` already promised). ``bronze`` last: this module
#: never writes it, only clears it on a forced import.
REGISTER_ATTRS = ("ledger", "metrics", "bronze")


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
            f"the first scan after this import needs (it creates the one remaining table, "
            f"bronze):\n"
            f"    GRANT USE SCHEMA, SELECT, MODIFY, CREATE TABLE\n"
            f"      ON SCHEMA <catalog>.<schema> TO `<principal>`;\n\n"
            f"Or point --catalog / --schema / --table_prefix somewhere you own and seed there; "
            f"the bundle is not catalog-specific.\n\n"
            f"Original error: {text.strip().splitlines()[0]}"
        ) from exc


def _replace(spark: SparkSession, df: DataFrame, table: str, scope: str) -> None:
    """Replace **this scope's** rows in a table: delete them, then append the bundle's.

    ``WHERE scope = '<scope>'`` and never the bare ``DELETE FROM {table}`` this used to issue.
    Every scope shares one table set now (``run_pipeline.DEFAULT_TABLE_PREFIX``), so the
    unqualified statement emptied two registers that have nothing to do with the bundle being
    imported -- and emptied them into a shape no rebuild could recover, because
    ``rebuild_ledger`` replays bronze and this same function had just deleted that too. The
    predicate matches the one ``run_pipeline.rebuild_ledger`` uses for the same reason.

    On ``metrics`` it is deliberately every FAMILY of this scope, gold included, and not just
    ``family='scan'``: gold rows written before a seed were computed from a ledger that started
    empty, so leaving them would put a near-zero-MTTR run in the trend beside seeded ones with
    nothing on the page to say why. That is what ``force`` has always promised; what changed is
    that it now promises it about one register instead of about the whole estate.

    Not ``mode("overwrite")``. That resolves through Delta's DataSource V2 catalog, which
    answers *"Table … does not support truncate in batch mode"* -- so the tidier-looking
    single-commit version is one this suite cannot run and a cluster might. DELETE-then-append
    is what ``run_pipeline.rebuild_ledger`` already does to the same two tables, needs the same
    MODIFY privilege, and is exercised by every test below. It is also the only form that can
    carry a predicate at all, which is now a second reason rather than a cost.

    The cost is a window between the two statements in which this scope's rows are gone.
    Acceptable here and nowhere else: this runs once, before the register has any readers.
    """
    spark.sql(f"DELETE FROM {table} WHERE scope = '{scope}'")
    run_pipeline.write_append(df, table)


def refuse_a_frame_of_another_scope(scope: str, **frames: DataFrame) -> None:
    """Refuse any frame about to be written whose ``scope`` is not the one being imported.

    **This is not a check on the bundle.** ``_ledger_row`` / ``_episode_row`` / ``scans_frame``
    stamp ``scope`` from the parameter, and the interchange contract (``BUNDLE_KIND`` v1) has
    no scope field at all -- GAS is the OS-patching register and says so by carrying no
    ``cwe`` / ``language`` / ``ai_verdict`` source. So there is no bundle-stated scope here to
    disagree with, and a guard asserting ``F.lit(scope) == scope`` would fire on nothing.

    What it actually holds is the tie between the WRITE and the DELETE. ``_replace`` clears
    ``WHERE scope = '<scope>'`` and then appends these frames; if a frame ever carried a
    different scope -- a future bundle that states one, a caller that builds the frames itself,
    a mapping change that reads the scope off a row -- the append would land rows the clearing
    statement cannot reach, and ``force`` would stop meaning "replace this register". That is a
    half-replaced register, which is the failure of absence this module exists to avoid,
    arriving from the one direction ``occupied_tables`` cannot see.

    Cheap enough to be unconditional: a ``distinct()`` over two frames of a few thousand rows.
    """
    for name, frame in frames.items():
        found = sorted(
            str(r["scope"])
            for r in frame.select("scope").distinct().collect()
            if r["scope"] is not None
        )
        if found != [scope]:
            raise BundleError(
                f"The {name} frame carries scope {found or ['(none)']} but this import is for "
                f"scope {scope!r}. Every row written here is cleared by a "
                f"DELETE ... WHERE scope = '{scope}', so a row of another scope would be "
                f"appended to a register that was never emptied -- and would sit inside "
                f"whichever register it names, dated by this bundle's history. Import the "
                f"bundle under the scope it was exported from."
            )


def occupied_tables(spark: SparkSession, tables: run_pipeline.Tables, scope: str) -> dict:
    """``{table: rows}`` for every pipeline table holding rows **of this scope**.

    Scoped, and the question it asks is the one the refusal below acts on: "is the register I
    am about to replace already in use". With one table set per deployment, an unscoped count
    answers a different question -- "is any register in use" -- and answers it wrongly in both
    directions. A first-ever ``os`` import into a deployment already scanning ``sca`` would be
    refused as a non-empty register it has no business reading; and a forced import would then
    report the *other* registers' row counts as what it replaced.
    """
    counts = {}
    for attr in REGISTER_ATTRS:
        table = getattr(tables, attr)
        if run_pipeline.table_exists(spark, table):
            rows = spark.table(table).where(F.col("scope") == scope).count()
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
    """Seed ``tables.ledger`` and the ``family='scan'`` rows of ``tables.metrics`` from the
    bundle. Returns a summary.

    Refuses a register that already holds anything, because the two ways it could go wrong are
    both silent. Merging a seed into a ledger this pipeline has already advanced would re-open
    lifecycles it has since resolved; appending the seed's scan log beside its own would
    put an older scan after a newer one and hand the disappearance guard the wrong previous
    scan.

    ``force`` means **replace the register**, not merely the ledger. Gold is the reason: it is
    appended per scan and computed from the ledger *as it stood at that scan*, so gold rows
    written before the seed were derived from a ledger that started empty. Left in place they
    would sit beside seeded runs where MTTR does not read near zero -- a contradiction with no
    visible cause. So a forced import empties this scope's bronze and this scope's whole share
    of ``metrics`` -- the scan log and every gold family together, since they now share one
    table -- and the register genuinely restarts from the imported history. ``_replace`` on
    ``metrics`` is what does that emptying: it DELETEs this scope's rows before appending the
    bundle's scan rows, so the gold rows a prior run wrote never survive it.

    **"The register" is ONE SCOPE'S register, and every statement below says so.** A GAS bundle
    is the Apps Script app's own history and that app scans hosts, so an import is an ``os``
    import; the three scopes share one table set (``run_pipeline.DEFAULT_TABLE_PREFIX``), and
    until this was scoped a ``--force_import`` emptied the ledger, the metrics table and bronze
    outright -- taking the ``sca`` and ``sast`` registers with it, unrecoverably, since the
    bronze that ``--rebuild_ledger`` would replay went in the same statement. Measured by
    reproducing that one statement inline
    (``test_import_bundle.py::TestAnImportTouchesOneScope``): on a register holding the
    committed ``sca`` capture, an ``os`` import that names no other scope takes all 54 ``sca``
    lifecycles and every published ``sca`` metrics row to zero, and prints a summary that looks
    exactly like a successful seed.

    They are emptied rather than dropped: DELETE needs only MODIFY and keeps the tables' grants,
    where DROP needs ownership and would silently take the grants with it.

    **Order matters.** The ledger is replaced first. Then bronze -- never written by this
    module, only ever cleared -- is cleared on its own, before ``metrics`` is touched: clearing
    it as part of one loop over ``metrics`` and ``bronze`` together would run at the same time
    as (or after) ``_replace`` writing ``metrics``, and the two are not safe to interleave.
    ``metrics`` itself is replaced last, by ``_replace``, which is what empties whatever gold
    was there.
    """
    run_pipeline.ensure_tables(spark, tables)
    # Before the expensive part, and before anything is written.
    require_write_access(spark, tables.ledger)
    require_write_access(spark, tables.metrics)

    occupied = occupied_tables(spark, tables, scope)
    if occupied and not force:
        listed = "\n".join(f"    {t}: {n} {scope} row(s)" for t, n in occupied.items())
        raise BundleError(
            f"The {scope!r} register is not empty:\n{listed}\n\n"
            f"An import seeds an empty register. Merging into one that has already scanned "
            f"would re-open resolved lifecycles and mis-order the scan log, and any gold rows "
            f"already written were computed from a ledger that started empty.\n"
            f"Pass --force_import=true to REPLACE the {scope!r} register -- it overwrites that "
            f"scope's ledger rows and empties its bronze and its share of the metrics table "
            f"(the scan log together with every gold family). The other scopes' rows in these "
            f"same tables are not read and not touched."
        )

    episodes, collapsed = selectable_episodes(bundle)
    rows = ledger_frame(spark, bundle, scope=scope).localCheckpoint(eager=True)
    scans = scans_frame(spark, bundle, scope=scope)
    # Before the first DELETE: what is written and what is cleared have to be the same scope,
    # or `force` stops replacing what it says it replaces. See the function's own header.
    refuse_a_frame_of_another_scope(scope, ledger=rows, scans=scans)

    _replace(spark, rows, tables.ledger, scope)

    # bronze only, and before metrics: see "Order matters" above.
    cleared = {}
    if tables.bronze in occupied:
        spark.sql(f"DELETE FROM {tables.bronze} WHERE scope = '{scope}'")
        cleared[tables.bronze] = occupied[tables.bronze]

    _replace(spark, scans, tables.metrics, scope)
    if tables.metrics in occupied:
        cleared[tables.metrics] = occupied[tables.metrics]

    hashed = rows.filter(F.col("vuln_key").startswith("h:")).count()
    span = rows.agg(
        F.min("first_seen").alias("first_seen"), F.max("last_seen").alias("last_seen")
    ).collect()[0]
    latest = run_pipeline.previous_scan(spark, tables, scope)
    return {
        "scope": scope,
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


def seeded_overview(
    spark: SparkSession, tables: run_pipeline.Tables, scope: str
) -> DataFrame:
    """What landed **for this scope**, by status: the read-back an operator checks against.

    Lives here rather than in the notebook for the same reason every other aggregate does --
    a number computed in a cell is a number no test can reach. ``earliest_first_seen`` is the
    one to look at: if it reads today, the seed did not take and every MTTR below it is
    measuring the import rather than the register.

    Scoped, or the check does not check the import: the ledger holds every scope, so an
    unfiltered ``min(first_seen)`` would answer with whichever register happens to have the
    oldest row -- and a seed that did not take would read as though it had, because some other
    scope's history supplied the old date. It would fail in the safe-looking direction, which
    is the direction a read-back must never fail in.
    """
    return (
        spark.table(tables.ledger)
        .where(F.col("scope") == scope)
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
    """Every line names the scope. These tables hold three registers, and a line reading
    "REPLACED a non-empty register: wiz_vuln_ledger (54)" without one is a sentence an operator
    would reasonably read as "the register", i.e. all of it."""
    scope = summary["scope"]
    print(f"[import] {summary['ledger_rows']} {scope} lifecycle(s) -> {tables.ledger}")
    print(
        f"[import]   {summary['episodes_folded']} sealed episode(s) folded in"
        + (
            f", {summary['episodes_collapsed']} extra episode(s) collapsed"
            if summary["episodes_collapsed"]
            else ""
        )
    )
    print(f"[import] {summary['scans']} {scope} scan(s) -> {tables.metrics}")
    if summary["replaced"]:
        print(
            f"[import] REPLACED a non-empty {scope!r} register: "
            + ", ".join(
                f"{t.split('.')[-1]} ({n} {scope} row(s))"
                for t, n in summary["replaced"].items()
            )
        )
        print("[import]   rows of the other scopes in those tables were not touched")
    if summary["cleared"]:
        print(
            f"[import]   emptied the {scope} rows of {len(summary['cleared'])} derived "
            f"table(s) -- they were computed from a ledger that started empty, so re-scan to "
            f"repopulate them"
        )
    print(
        f"[import] observed {summary['earliest_first_seen']} .. {summary['latest_last_seen']}, "
        f"exported {summary['exported_at']}"
    )
    if summary["hashed_keys"]:
        print(
            f"[import] WARNING {summary['hashed_keys']} row(s) carry a hashed (h:) vuln_key. "
            f"GAS never persisted `component`, which is part of this pipeline's hash basis, so "
            f"the next scan will re-key these and start a second lifecycle for each. Findings "
            f"with a Wiz id are unaffected."
        )
    print(
        f"[import] next: run the pipeline with the SAME --severities as GAS was scanning, and "
        f"--project_id matching WIZ_PROJECT_ID_V2. A first run that resolves most of the "
        f"register means the populations disagree -- re-import rather than accept it."
    )


def main() -> Optional[dict]:
    run_pipeline.check_deployment()
    # The same storage-mode resolution `run_pipeline.main` does: with `--data_path` set there is
    # no catalog to require, and the seeded ledger lands in a directory. A PoC that has to start
    # from the Apps Script app's history should not also have to wait for a catalog.
    data_path = run_pipeline.resolve_data_path()
    namespace = "" if data_path else run_pipeline.resolve_namespace()
    scope = run_pipeline.resolve_scope()
    tables = run_pipeline.resolve_tables(namespace, data_path=data_path)
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
