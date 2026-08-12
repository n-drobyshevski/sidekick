"""The register as CSV files, with the types intact.

This deployment has no catalog it may create tables in and no Unity Catalog volume, so the
register lives as CSV under ``/Workspace/.../csv_export`` and the notebooks read it back from
there. That was working ad hoc in ``06_run_and_verify``'s cells; this module is the same idea
with the two things those cells could not do.

**Why it is not ``spark.read.csv``.** Every write Spark does is a distributed write, and
*executors cannot write to workspace files* -- which is also why ``run_pipeline.resolve_data_path``
refuses a ``/Workspace`` data path outright. So everything here is driver-side: ``toPandas``,
``open()``, ``csv``. That is what makes ``/Workspace`` a legal destination for the export even
though it is an illegal one for the register itself.

-------------------------------------------------------------------------------------------
**WHY EVERY TABLE HAS A SCHEMA SIDECAR, WHICH IS THE WHOLE POINT OF THIS MODULE.**
CSV has no types. A blank cell is indistinguishable from an empty string, and Spark's own
behaviour on that has changed across releases (SPARK-17916). That ambiguity lands exactly on
``has_kev`` / ``has_exploit`` / ``epss``, where -- per the correctness trap at the top of
``metrics.py`` -- a NULL read back as ``false`` inflates efficiency and deflates coverage at
the same time, silently.

It is not a hypothetical. For the ``sast`` scope those three columns are **always** NULL, so a
type-blind round-trip would classify every static-analysis finding as a confident true negative
and the entire confusion matrix would be fiction that looked exactly like a result.

So each table is written as two files -- ``<table>.csv`` and ``<table>.schema.json``, the Spark
schema verbatim -- and read back through that schema rather than through inference.
``tests/test_csvstore.py`` is that paragraph as a test: the confusion matrix over a reloaded
register must be identical to the one over the Delta tables it came from.
-------------------------------------------------------------------------------------------

Three entry points, and they compose:

  ``export``   Delta (or a directory register) -> CSV + sidecars
  ``load``     CSV -> session temp views named exactly as the tables, and a ``Tables``
               pointing at them. A temp view is valid anywhere Spark wants a table, which is
               the same trick ``delta.`<path>``` plays -- so every panel, every view and every
               notebook ``%sql`` cell works against a CSV register untouched.
  ``restore``  CSV -> Delta. The way back, which matters because the Delta side of this
               deployment sits on ``dbfs:/tmp``: the export is the copy that has to survive,
               and a copy you cannot restore from is a report, not a backup.
"""

from __future__ import annotations

import csv
import json
import os
from typing import Iterable, List, Optional, Sequence

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql.types import (
    ArrayType,
    BooleanType,
    DateType,
    DecimalType,
    DoubleType,
    FloatType,
    IntegerType,
    LongType,
    MapType,
    ShortType,
    StructType,
    TimestampType,
)

import run_pipeline

# See config.PIPELINE_VERSION: every runtime module must come from the same upload.
MODULE_VERSION = "2.3"

#: Every table, in the order a reader wants them. Taken from ``run_pipeline`` rather than
#: restated, so this and the ``Tables`` dataclass cannot drift -- a table added to one and not
#: the other would otherwise be missing from every export until somebody tried to restore.
TABLE_ATTRS = run_pipeline.TABLE_ATTRS

#: What ``export`` writes unless asked otherwise. Bronze is excluded because it is one JSON
#: document per finding -- the only table big enough to hit the 500 MB workspace-file cap, and
#: the only one nothing reads except ``--rebuild_ledger``. Pass ``include_bronze=True`` when the
#: point of the export IS to be able to replay it.
DEFAULT_ATTRS = tuple(a for a in TABLE_ATTRS if a != "bronze")

SCHEMA_SUFFIX = ".schema.json"

#: Written **last** by every export, and checked by every load.
#:
#: A Delta commit is atomic; a directory of CSVs and sidecars is not. A run that dies half way
#: through an export leaves the ledger from this scan beside gold tables from the last one, and
#: the next run would restore that mixture and reconcile from a state that never existed.
#:
#: The manifest cannot make the write atomic, but it can make a torn one **detectable**: it
#: records the module version and a row count per table, and it is written only after every
#: file has landed. A register whose manifest disagrees with what is on disk is refused rather
#: than read -- the same posture ``run_pipeline`` takes when it finds a ledger MERGE with no
#: matching scan-log row. A register with *no* manifest is read unverified, because one written
#: by an older version is not thereby torn; what must never be silent is a register that is.
MANIFEST = "_manifest.json"


def table_basename(reference: str) -> str:
    """The bare table name behind either reference form.

    ``cat.schema.wiz_sca_metrics_mttr`` and ``delta.`/vol/reg/wiz_sca_metrics_mttr``` both
    yield ``wiz_sca_metrics_mttr``, so the CSV is named after the table in both storage modes
    and an export can be moved between them.
    """
    path = run_pipeline.as_path(reference)
    if path is not None:
        return path.rstrip("/").rsplit("/", 1)[-1]
    return reference.rsplit(".", 1)[-1].strip("`")


# ------------------------------------------------------------------------------- export


def export(
    spark: SparkSession,
    tables: run_pipeline.Tables,
    target: str,
    *,
    include_bronze: bool = False,
    attrs: Optional[Sequence[str]] = None,
) -> List[str]:
    """Write every table that exists to ``target``, one CSV and one sidecar each.

    Returns the CSV paths written. A table that does not exist is skipped rather than written
    empty: "no rows" and "no table" are different states, and an empty CSV would make a
    never-scanned register look like a scanned one with nothing in it.

    The ``_manifest.json`` goes last, after every file has landed -- see ``MANIFEST``. Any
    manifest already there is removed **first**, so a run that dies part way through leaves a
    register that is visibly incomplete rather than one carrying the previous scan's manifest
    over this scan's half-written files.
    """
    wanted = attrs or (TABLE_ATTRS if include_bronze else DEFAULT_ATTRS)
    os.makedirs(target, exist_ok=True)

    manifest_path = os.path.join(target, MANIFEST)
    if os.path.exists(manifest_path):
        os.remove(manifest_path)

    written: List[str] = []
    counts = {}
    for attr in wanted:
        reference = getattr(tables, attr)
        if not run_pipeline.table_exists(spark, reference):
            continue
        name = table_basename(reference)
        frame = spark.table(reference)
        rows = _write_csv(frame, os.path.join(target, f"{name}.csv"))
        with open(os.path.join(target, f"{name}{SCHEMA_SUFFIX}"), "w", encoding="utf-8") as fh:
            json.dump(frame.schema.jsonValue(), fh, indent=2)
        written.append(os.path.join(target, f"{name}.csv"))
        counts[name] = rows
        print(f"[csv] {reference} -> {name}.csv ({rows} rows)")
    if not written:
        print("[csv] nothing to export; the register is empty")
        return written

    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump({"version": MODULE_VERSION, "tables": counts}, fh, indent=2, sort_keys=True)
    return written


def read_manifest(target: str) -> Optional[dict]:
    """The register's manifest, or ``None`` when there is no register here at all.

    ``None`` and "torn" are different answers and only the caller can decide between them: on a
    first run an absent register is the normal case, and everywhere else it is a problem.
    """
    path = os.path.join(target, MANIFEST)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _verify(target: str, manifest: dict) -> None:
    """Every table the manifest names must be present with the row count it recorded.

    This is the whole value of the manifest: it turns "the export died half way" from a state
    that reads back as plausible data into one that refuses to be read.
    """
    problems = []
    for name, expected in sorted(manifest.get("tables", {}).items()):
        path = os.path.join(target, f"{name}.csv")
        if not os.path.exists(path):
            problems.append(f"{name}.csv is missing (manifest says {expected} rows)")
            continue
        with open(path, encoding="utf-8", newline="") as fh:
            actual = max(sum(1 for _ in csv.reader(fh)) - 1, 0)
        if actual != expected:
            problems.append(f"{name}.csv has {actual} rows, manifest says {expected}")
    if problems:
        raise RuntimeError(
            "This CSV register is torn -- the manifest and the files disagree:\n  "
            + "\n  ".join(problems)
            + "\nThe manifest is written last, so an export that died part way through leaves "
            "exactly this. Do not scan against it: reconciling from a half-written ledger "
            "invents remediation. Restore the previous export, or re-export from the Delta "
            "register if it still exists."
        )


def _write_csv(frame: DataFrame, path: str) -> int:
    """One frame to one file, NULLs written as empty and everything else as ``str``.

    ``toPandas`` then ``csv.writer`` rather than ``pandas.to_csv``: pandas renders a missing
    value according to its dtype (``NaN``, ``NaT``, ``<NA>``) and each of those would come back
    as the literal string on the next read. Writing ``None`` as the empty field and pairing it
    with the sidecar is what makes the round-trip exact.
    """
    pdf = frame.toPandas()
    renderers = [_renderer(field.dataType) for field in frame.schema.fields]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(list(pdf.columns))
        for record in pdf.itertuples(index=False, name=None):
            writer.writerow(
                [
                    "" if _is_missing(value) else render(value)
                    for render, value in zip(renderers, record)
                ]
            )
    return len(pdf.index)


def _is_missing(value) -> bool:
    """NULL in any of the shapes pandas uses for it, without importing numpy.

    ``value != value`` catches NaN and NaT, which are the only objects that are not equal to
    themselves. ``pd.NA`` raises on a bare bool() and is caught by the ``is`` chain first.
    """
    if value is None:
        return True
    try:
        return bool(value != value)
    except (TypeError, ValueError):
        return False


def _renderer(data_type):
    """How a field of this type is written. Paired one-for-one with ``_parser`` below.

    Typed rather than ``str(value)``, for one reason that is a bug and one that is manners:

    * **pandas has no nullable integer in a plain ``toPandas``.** An ``int``/``long`` column
      containing a NULL comes back as ``float64``, so ``str(value)`` renders ``90`` as
      ``"90.0"`` -- which ``int()`` then refuses on the way back in. That is not hypothetical:
      it is ``sla_target``, on the very first gold table exported.
    * booleans are written lowercase, matching what ``_parse_bool`` accepts. ``str(True)`` is
      ``"True"``, which Spark's own reader happens to take -- but the two ends of this
      round-trip are four functions apart and should not depend on that.
    """
    if isinstance(data_type, BooleanType):
        return lambda v: "true" if v else "false"
    if isinstance(data_type, (IntegerType, LongType, ShortType)):
        return lambda v: str(int(v))
    return str


# --------------------------------------------------------------------------------- load


def load(
    spark: SparkSession,
    target: str,
    prefix: str = "",
    *,
    attrs: Optional[Sequence[str]] = None,
    required: Iterable[str] = ("scans", "ledger"),
) -> run_pipeline.Tables:
    """Register every exported table as a session temp view and return a ``Tables`` for them.

    The view is named exactly as the table was -- ``wiz_sca_metrics_mttr``, not ``v_mttr`` --
    so the returned ``Tables`` is interchangeable with a catalog-backed or path-backed one and
    nothing downstream can tell the difference. ``panels.context`` relies on precisely that.

    A missing CSV becomes an **empty view with the right schema** when the sidecar is there, and
    is skipped when it is not. That distinction is deliberate: an export that predates a table
    should open the pages on "no data yet" rather than on ``TABLE_OR_VIEW_NOT_FOUND``, but an
    export missing its sidecar cannot be read safely at all and must not be guessed at.

    ``required`` names the tables whose absence is an error rather than an empty page. Both
    defaults are lifecycle tables: without them there is no register here, and the likeliest
    cause is a wrong ``prefix`` -- a scope typo pointing at an export that does not exist.
    Pass ``required=()`` where an absent register is a legitimate state, which on a first run
    it is.

    **The manifest is checked before anything is read.** A torn export -- see ``MANIFEST`` --
    is refused here rather than reconciled against later.
    """
    manifest = read_manifest(target)
    if manifest is not None:
        _verify(target, manifest)

    wanted = attrs or TABLE_ATTRS
    found = {}
    for attr in wanted:
        name = f"{prefix}{_table_name(attr)}"
        schema_path = os.path.join(target, f"{name}{SCHEMA_SUFFIX}")
        if not os.path.exists(schema_path):
            continue
        with open(schema_path, encoding="utf-8") as fh:
            schema = StructType.fromJson(json.load(fh))
        rows = _read_csv(os.path.join(target, f"{name}.csv"), schema)
        spark.createDataFrame(rows, schema).createOrReplaceTempView(name)
        found[attr] = name

    missing = [attr for attr in required if attr not in found]
    if missing:
        raise RuntimeError(
            f"No CSV register at {target!r} for prefix {prefix!r}: "
            f"{', '.join(sorted(missing))} not found. "
            f"Check the `scope` / `table_prefix` widgets match the export, and that the export "
            f"was written by csvstore.export (which writes the {SCHEMA_SUFFIX} sidecars this "
            f"reads)."
        )

    # A table with no export at all still needs a name, and an unregistered one is the honest
    # value: reading it raises TABLE_OR_VIEW_NOT_FOUND naming the table, which is what a reader
    # asking for a table that was never exported should see.
    return run_pipeline.Tables(
        **{attr: found.get(attr, f"{prefix}{_table_name(attr)}") for attr in TABLE_ATTRS}
    )


def _table_name(attr: str) -> str:
    """``Tables`` attribute -> unprefixed table name, from run_pipeline's own constants."""
    return {
        "bronze": run_pipeline.BRONZE_TABLE,
        "silver": run_pipeline.SILVER_TABLE,
        "ledger": run_pipeline.LEDGER_TABLE,
        "scans": run_pipeline.SCANS_TABLE,
        "mttr": run_pipeline.GOLD_MTTR,
        "program": run_pipeline.GOLD_PROGRAM,
        "capacity": run_pipeline.GOLD_CAPACITY,
        "sensitivity": run_pipeline.GOLD_SENSITIVITY,
    }[attr]


def _read_csv(path: str, schema: StructType) -> List[tuple]:
    """Rows as Python tuples, each field parsed to the type the sidecar declares.

    Driver-side and row-at-a-time on purpose. ``spark.createDataFrame(pandas_frame, schema)``
    is faster and goes through Arrow, where a pandas nullable dtype, a NaT and a NaN each have
    their own conversion rules -- and getting one of them wrong is exactly the silent failure
    this module exists to prevent. This route has one rule, written once, per Spark type.

    The cost is real and is why bronze is not exported by default: a few hundred thousand JSON
    documents through a Python loop is slow, and nothing reads bronze from CSV anyway.
    """
    if not os.path.exists(path):
        return []
    parsers = [_parser(field.dataType) for field in schema.fields]
    names = [field.name for field in schema.fields]

    rows: List[tuple] = []
    with open(path, encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header is None:
            return []
        if header != names:
            raise RuntimeError(
                f"{os.path.basename(path)} has columns {header} but its sidecar declares "
                f"{names}. The two were written together, so they have been edited apart -- "
                f"re-export rather than reconciling them by hand."
            )
        for record in reader:
            rows.append(tuple(parse(value) for parse, value in zip(parsers, record)))
    return rows


def _parser(data_type):
    """The one rule for reading a field of this type back. Empty is always NULL."""
    if isinstance(data_type, BooleanType):
        return _parse_bool
    if isinstance(data_type, (IntegerType, LongType, ShortType)):
        # `int(float(v))` on the fallback path, not `int(v)`: an export written before
        # `_renderer` was typed -- or edited in a spreadsheet, which is the point of CSV --
        # holds `90.0` in an integer column, and refusing to read it back would make old
        # exports unreadable for a cosmetic reason.
        return lambda v: None if v == "" else _parse_int(v)
    if isinstance(data_type, (DoubleType, FloatType)):
        return lambda v: None if v == "" else float(v)
    if isinstance(data_type, DecimalType):
        from decimal import Decimal

        return lambda v: None if v == "" else Decimal(v)
    if isinstance(data_type, (TimestampType, DateType)):
        return _parse_timestamp_factory(isinstance(data_type, DateType))
    if isinstance(data_type, (ArrayType, MapType, StructType)):
        # Nothing in this register has one, and guessing at a rendering that round-trips would
        # be inventing a format. Refused loudly here rather than corrupted quietly on read.
        raise RuntimeError(
            f"{data_type.simpleString()} cannot survive a CSV round-trip. "
            f"Export that table as Delta, or flatten the column first."
        )
    return lambda v: None if v == "" else v


def _parse_int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return int(float(value))


def _parse_bool(value: str):
    """``true`` / ``false`` and nothing else -- and empty is NULL, never False.

    The single most important line in this module. See the module header.
    """
    if value == "":
        return None
    lowered = value.strip().lower()
    if lowered in ("true", "1"):
        return True
    if lowered in ("false", "0"):
        return False
    raise RuntimeError(
        f"{value!r} is not a boolean. A NULL must be written as an empty field, because "
        f"reading it as False inflates efficiency and deflates coverage at once."
    )


def _parse_timestamp_factory(date_only: bool):
    from datetime import datetime

    def parse(value: str):
        if value == "":
            return None
        text = value.strip()
        parsed = None
        # `str()` of a Spark timestamp is `YYYY-MM-DD HH:MM:SS[.ffffff]`; an ISO 'T' separator
        # is accepted too, because an export edited in a spreadsheet often comes back that way.
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
                    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            raise RuntimeError(f"{value!r} is not a timestamp this export can read back")
        return parsed.date() if date_only else parsed

    return parse


# ------------------------------------------------------------------------------ restore


def _has_register(target: str, prefix: str) -> bool:
    """Is there anything at ``target`` worth restoring?

    The ledger's schema sidecar, because that is what ``load`` needs to read a table at all: a
    directory with a CSV and no sidecar is not a register this module can use, and one with the
    sidecar is, manifest or no manifest.
    """
    name = f"{prefix}{_table_name('ledger')}{SCHEMA_SUFFIX}"
    return os.path.exists(os.path.join(target, name))


def restore(
    spark: SparkSession,
    target: str,
    tables: run_pipeline.Tables,
    prefix: str = "",
    *,
    attrs: Optional[Sequence[str]] = None,
    missing_ok: bool = False,
) -> List[str]:
    """Write a CSV export back out as the Delta register ``tables`` names.

    The way back, and the half of the CSV-register mode that makes the CSV authoritative: the
    Delta side is a scratch copy for the duration of one run, and this is what puts last run's
    state into it.

    Overwrites, and does not merge. A restore is "make the register be this", so a half-restore
    on top of existing rows -- which is what appending would produce -- is the one outcome
    nobody wants.

    ``missing_ok`` returns ``[]`` instead of raising when there is no register at ``target``.
    That is the first run in ``--csv_path`` mode, where having nothing to restore is not merely
    tolerable but the expected state -- and it is opt-in, because everywhere else an absent
    register means a wrong path and should say so.

    "No register" is decided on the ledger sidecar, not on the manifest. Gating on the manifest
    would make an export written before manifests existed look like an empty directory -- which
    ``missing_ok`` would skip, and the export at the end of the run would then overwrite with a
    register that had lost its whole history. Silently, which is the part that matters.
    """
    if missing_ok and not _has_register(target, prefix):
        print(f"[csv] no register at {target} yet -- starting a new one")
        return []
    loaded = load(spark, target, prefix, attrs=attrs)
    restored: List[str] = []
    for attr in attrs or TABLE_ATTRS:
        view = getattr(loaded, attr)
        if not run_pipeline.table_exists(spark, view):
            continue
        destination = getattr(tables, attr)
        frame = spark.table(view)
        writer = frame.write.format("delta").mode("overwrite").option(
            "overwriteSchema", "true"
        )
        path = run_pipeline.as_path(destination)
        writer.save(path) if path else writer.saveAsTable(destination)
        restored.append(destination)
        print(f"[csv] restored {view} -> {destination}")
    return restored
