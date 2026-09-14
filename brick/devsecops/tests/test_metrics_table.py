"""One metrics table: the families, the union schema, and the crashed gold write that resumes.

These are S1-T6's tests, this fork's copy. They cover the part `test_ledger_pipeline.py` does
not: the two-commit window between the ledger MERGE and the gold append and the three ways out
of it, that every scan carries every family -- five here, because this fork publishes P2P v5's
`assets` beside the other three gold grains -- that the union's schema is the element-wise merge
of the family frames' schemas, that both storage modes hold the same `metrics` content, and that
`closed_observed` counts this scan's own resolutions in this scan's own month.

Every assertion below sweeps `run_pipeline.METRICS_FAMILIES` / `GOLD_FAMILIES` rather than a
list of its own, so `assets` is covered by the same lines that cover `mttr` -- a family added to
the fork and not to the tuples is a typo, not a population.

**The fixture builders below are copied from `test_ledger_pipeline.py`, not imported.** Importing
a sibling test module would not bring its fixtures with it -- pytest resolves fixtures from the
requesting module and its conftest, never from another test module -- and it would couple two
files that are edited independently. Only what these tests actually use was copied.

Run with:  pytest brick/devsecops/tests/test_metrics_table.py -q
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark",
    reason="devsecops tests need pyspark: pip install -r brick/devsecops/requirements.txt",
)
pytest.importorskip(
    "delta", reason="ledger tests need delta-spark: pip install -r brick/devsecops/requirements.txt"
)

from pyspark.sql import DataFrame, Row  # noqa: E402
from pyspark.sql import functions as F  # noqa: E402

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import run_pipeline  # noqa: E402
from config import SCANS_COLUMNS  # noqa: E402

SCOPE = "sca"
SEVERITIES = ["CRITICAL", "HIGH"]
TS = {
    "s1": "2026-05-01T00:00:00Z",
    "s2": "2026-05-08T00:00:00Z",
    "s3": "2026-05-15T00:00:00Z",
}

#: The columns the commit record carries, i.e. everything `metrics` is *declared* with. A frame
#: holding anything beyond these is a gold frame: see `crash_the_gold_append`.
BASE_COLUMNS = frozenset(SCANS_COLUMNS) | {"family"}

GOLD_CRASH = "simulated crash in the gold append"


# ------------------------------------------------------------------------------- fixtures


@pytest.fixture
def tables(spark, request):
    """A private schema per test, so tables never leak between them."""
    name = "mt_" + re.sub(r"\W", "_", request.node.name).lower()[:100]
    spark.sql(f"DROP DATABASE IF EXISTS {name} CASCADE")
    spark.sql(f"CREATE DATABASE {name}")
    tbl = run_pipeline.resolve_tables(name, SCOPE, argv=[])
    run_pipeline.ensure_tables(spark, tbl)
    yield tbl
    spark.sql(f"DROP DATABASE IF EXISTS {name} CASCADE")


@pytest.fixture
def data_root(tmp_path) -> str:
    """Where a path-backed register lives. Handed to `main` as `--data_path`."""
    return str(tmp_path / "register")


@pytest.fixture
def path_tables(spark, data_root):
    """The same three tables in a directory instead of a schema.

    Every test that drives `main` uses this mode, and the reason is `create_clustered`:
    `main` resolves a namespace of `<catalog>.<schema>`, which makes every table a three-part
    name, and delta-spark's own Python builder parses `a.b.c` as a two-part identifier and dies
    on the second dot (CLAUDE.md, brick section). `--data_path` needs no catalog at all, so the
    tables `main` resolves are the same references this fixture built.
    """
    tbl = run_pipeline.resolve_tables("", SCOPE, argv=[], data_path=data_root)
    run_pipeline.ensure_tables(spark, tbl)
    return tbl


# ------------------------------------------------------------------------ fixture builders


def node(fid="f-1", severity="HIGH", **over) -> dict:
    base = {
        "id": fid,
        "name": f"CVE-2026-{fid}",
        "detailedName": "openssl",
        "severity": severity,
        "status": "OPEN",
        "firstDetectedAt": "2026-04-01T00:00:00Z",
        "resolvedAt": None,
        "hasCisaKevExploit": True,
        "hasExploit": False,
        "epssProbability": 0.5,
        "vulnerableAsset": {
            "id": "vm-1", "name": "web-01", "type": "VIRTUAL_MACHINE",
            "cloudPlatform": "AWS", "subscriptionName": "prod",
        },
    }
    base.update(over)
    return base


def write_bronze(spark, tables, nodes, scan_id, scan_ts):
    """Stand-in for `ingest_to_bronze` -- the same rows without the API, created the same way."""
    run_pipeline.create_clustered(
        spark, tables.bronze, run_pipeline.BRONZE_TABLE_SCHEMA, "bronze"
    )
    rows = [(scan_id, scan_ts, SCOPE, i, json.dumps(n)) for i, n in enumerate(nodes)]
    df = spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
    )
    writer = (
        df.withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))
        .write.format("delta")
        .mode("append")
        .option("mergeSchema", "true")
    )
    path = run_pipeline.as_path(tables.bronze)
    writer.save(path) if path else writer.saveAsTable(tables.bronze)


def run_scan(spark, tables, nodes, scan_id, scan_ts, severities=SEVERITIES):
    """One full scan: bronze, then everything `build_metrics` does. No printed summary."""
    write_bronze(spark, tables, nodes, scan_id, scan_ts)
    run_pipeline.build_metrics(
        spark, tables, scan_id, scan_ts, SCOPE, severities=severities, summary=False
    )


def ledger_rows(spark, tables) -> dict:
    return {r["vuln_key"]: r.asDict() for r in spark.table(tables.ledger).collect()}


def metrics_rows(spark, tables) -> list:
    """Every row of `metrics`, ordered deterministically and with its types intact.

    `str(row.asDict())` would compare too, and would also read `1` and `1.0` as different while
    reading a `Decimal` and a `float` of the same value as the same -- so the dicts are kept and
    only the *order* is made deterministic.
    """
    return sorted(
        (r.asDict() for r in spark.table(tables.metrics).collect()),
        # Sorted on the (name, value) pairs by NAME, so two registers whose columns happen to
        # sit in a different order still compare row for row -- the dict equality below is
        # order-blind, and the sort key has to be too or it would fail on the order alone.
        key=lambda row: repr(sorted(row.items())),
    )


def families_by_scan(spark, tables) -> dict:
    """`{scan_id: [family, ...]}` -- a list, not a set, so a duplicate `scan` row shows up."""
    out: dict = {}
    for row in spark.table(tables.metrics).select("scan_id", "family").collect():
        out.setdefault(row["scan_id"], []).append(row["family"])
    return out


def gold_rows_for(spark, tables, scan_id) -> list:
    return (
        spark.table(tables.metrics)
        .filter((F.col("scan_id") == scan_id) & (F.col("family") != run_pipeline.FAMILY_SCAN))
        .collect()
    )


# --------------------------------------------------------------------------- the crash


def crash_the_gold_append(patch, tables):
    """Make the ONE gold append fail and let the commit record through.

    Both writes go through `write_append` and both target `metrics`, so they are told apart by
    the frame: the commit record projects exactly the declared columns (`SCANS_COLUMNS` plus
    `family`), and the gold union carries every family's own columns beside them. Asking the
    frame for its `family` value would work too and would compute the whole gold plan inside
    the fake crash -- which is the one thing the crash is standing in for.
    """
    real = run_pipeline.write_append

    def guarded(df, table):
        if table == tables.metrics and set(df.columns) - BASE_COLUMNS:
            raise RuntimeError(GOLD_CRASH)
        real(df, table)

    patch.setattr(run_pipeline, "write_append", guarded)


def drive_main(spark, monkeypatch, data_root, scan_id):
    """`run_pipeline.main()` against the path-backed register, on the session the tests own."""
    monkeypatch.setattr(run_pipeline, "get_spark", lambda *args, **kwargs: spark)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_pipeline",
            f"--scan_id={scan_id}",
            f"--scope={SCOPE}",
            f"--data_path={data_root}",
            f"--severities={','.join(SEVERITIES)}",
        ],
    )
    return run_pipeline.main()


def scan_with_a_crashed_gold_append(spark, tables, monkeypatch, nodes, scan_id, scan_ts):
    """Scan `scan_id` the way a run that died between the commit record and the gold append did.

    The MERGE lands, the commit record lands one statement later, the single gold append
    raises. Returns nothing: what it leaves behind is the state under test.
    """
    with monkeypatch.context() as crashed:
        crash_the_gold_append(crashed, tables)
        with pytest.raises(RuntimeError, match=GOLD_CRASH):
            run_scan(spark, tables, nodes, scan_id, scan_ts)


# ------------------------------------------------- (a) the defect and the fix: the resume


def test_a_failed_gold_append_is_resumed_by_the_retry(
    spark, path_tables, data_root, monkeypatch
):
    """A crashed gold write is republished by the retry, and nothing else moves.

    **Failure of presence**: the scan is in the ledger and in the scan log, and absent from
    every metric anybody reads. `record_scan` lands one statement after the MERGE and the gold
    append lands after that, so a run that dies in between leaves exactly that -- and gold is
    re-derivable from bronze and the ledger, so the retry republishes it rather than skipping
    the scan.

    What must NOT move is the ledger: the retry republishes, it does not reconcile again.
    """
    run_scan(spark, path_tables, [node("f-1"), node("f-2"), node("f-3")], "s1", TS["s1"])
    scan_with_a_crashed_gold_append(
        spark, path_tables, monkeypatch, [node("f-1"), node("f-2")], "s2", TS["s2"]
    )

    # The state a crash in the gold append leaves: a commit record, a moved ledger, no gold.
    logged = run_pipeline.recorded_scan(spark, path_tables, "s2")
    assert logged is not None, "the commit record lands before gold and must have survived"
    assert logged["resolved_count"] == 1, "f-3 disappeared, and the MERGE recorded it"
    assert run_pipeline.gold_missing(spark, path_tables, "s2") is True
    assert run_pipeline.ledger_already_merged(spark, path_tables, "s2") is True
    assert gold_rows_for(spark, path_tables, "s2") == []

    ledger_before = ledger_rows(spark, path_tables)
    assert ledger_before["id:f-3"]["status"] == "RESOLVED", "the ledger did move"
    s1_before = [r for r in metrics_rows(spark, path_tables) if r["scan_id"] == "s1"]

    result = drive_main(spark, monkeypatch, data_root, "s2")

    # The retry stamps the republished gold with the scan's OWN timestamp. Wall clock would be
    # a different instant from the one every other row of this scan carries.
    assert result is not None
    assert result.scan_id == "s2"
    assert result.scan_ts == TS["s2"]

    families = families_by_scan(spark, path_tables)
    assert set(families["s2"]) == set(run_pipeline.METRICS_FAMILIES)
    assert families["s2"].count(run_pipeline.FAMILY_SCAN) == 1, "no second commit record"
    stamped = (
        spark.table(path_tables.metrics)
        .filter(F.col("scan_id") == "s2")
        .select(F.date_format("scan_ts", "yyyy-MM-dd'T'HH:mm:ss'Z'").alias("ts"))
        .distinct()
        .collect()
    )
    assert [row["ts"] for row in stamped] == [TS["s2"]], (
        "commit record and republished gold alike carry the scan's own instant -- a retry "
        "stamped with its own wall clock would describe two different moments"
    )

    # The ledger is the thing a second reconcile would corrupt, so it is compared whole.
    assert ledger_rows(spark, path_tables) == ledger_before
    assert [r for r in metrics_rows(spark, path_tables) if r["scan_id"] == "s1"] == s1_before


def test_the_old_short_circuit_is_the_defect(spark, path_tables, data_root, monkeypatch):
    """The perturbation that proves the resume above is load-bearing.

    `gold_missing` forced to False is the pipeline as it behaved before S1-T1: the retry finds
    the commit record, prints "already recorded -- nothing to do" and that scan's gold is never
    written at all. This test asserts that state rather than fixing it, because it is what the
    resume exists to end.

    **Failure of presence**, and the quiet kind: nothing errors, the run "succeeds", and the
    scan sits in the ledger and the scan log for good while being absent from `mttr`, `program`
    and `capacity` forever.
    """
    run_scan(spark, path_tables, [node("f-1"), node("f-2")], "s1", TS["s1"])
    scan_with_a_crashed_gold_append(
        spark, path_tables, monkeypatch, [node("f-1")], "s2", TS["s2"]
    )

    monkeypatch.setattr(run_pipeline, "gold_missing", lambda *args, **kwargs: False)
    result = drive_main(spark, monkeypatch, data_root, "s2")

    assert result is not None, "the old path returns a RunResult and looks like a success"
    assert gold_rows_for(spark, path_tables, "s2") == [], (
        "the defect: the short circuit leaves the crashed scan with no gold at all"
    )
    assert run_pipeline.recorded_scan(spark, path_tables, "s2") is not None
    assert run_pipeline.ledger_already_merged(spark, path_tables, "s2") is True
    # And it is scoped to the crashed scan: the register is not broken, one scan is missing
    # from it, which is why nothing downstream announces it.
    assert set(families_by_scan(spark, path_tables)["s1"]) == set(run_pipeline.METRICS_FAMILIES)


def test_a_stale_scan_cannot_be_resumed(spark, path_tables, data_root, monkeypatch):
    """Only the newest scan's gold can be resumed, and `rebuild_ledger` is the way back.

    Gold is computed from the ledger as it stands, and the ledger stands at one scan at a time.
    Once a later scan has merged, republishing an older scan's gold would stamp the later
    state with the older scan's `scan_ts`.

    **Failure of absence**: the row that would appear is not missing, it is *wrong* -- a
    measurement of a moment the register was never in, and nothing downstream could tell it
    from a right one. So the refusal has to leave `metrics` untouched, and it has to name the
    recovery and the scan that blocks it.
    """
    run_scan(spark, path_tables, [node("f-1"), node("f-2"), node("f-3")], "s1", TS["s1"])
    scan_with_a_crashed_gold_append(
        spark, path_tables, monkeypatch, [node("f-1"), node("f-2")], "s2", TS["s2"]
    )
    run_scan(spark, path_tables, [node("f-1")], "s3", TS["s3"])

    metrics_before = metrics_rows(spark, path_tables)
    ledger_before = ledger_rows(spark, path_tables)

    with pytest.raises(RuntimeError) as refused:
        drive_main(spark, monkeypatch, data_root, "s2")

    message = str(refused.value)
    assert "--rebuild_ledger" in message, "the refusal has to name the recovery"
    assert "s3" in message, "and the scan that blocks the resume"
    assert metrics_rows(spark, path_tables) == metrics_before, "a refusal writes nothing"
    assert ledger_rows(spark, path_tables) == ledger_before

    # The recovery it names. It deletes the whole metrics table and replays bronze, so every
    # scan -- including the one whose gold was lost -- comes back with all of its families.
    assert run_pipeline.rebuild_ledger(spark, path_tables, SCOPE, SEVERITIES, "scan_ts") == 3

    families = families_by_scan(spark, path_tables)
    assert set(families) == {"s1", "s2", "s3"}
    for scan_id, seen in families.items():
        assert set(seen) == set(run_pipeline.METRICS_FAMILIES), scan_id
        assert seen.count(run_pipeline.FAMILY_SCAN) == 1, scan_id
    # The replay goes through the same reconcile the live path used, so it has to land where
    # the live scans landed -- a rebuild that moved the ledger would be a different register.
    assert ledger_rows(spark, path_tables) == ledger_before


def test_a_crash_between_merge_and_commit_record_still_refuses(
    spark, path_tables, data_root, monkeypatch
):
    """The unchanged contract: the window that ends in a manual rebuild is one statement wide.

    Nothing about the resume widens it. A run that dies between the MERGE and the commit record
    leaves a ledger that moved with nothing recording that it did, and re-running would resolve
    by disappearance a second time everything the first attempt already resolved.

    **Failure of absence**: rows dated gone for the wrong reason -- a remediation programme
    manufactured out of one retry. It is refused, not recovered from, and the message names
    `--rebuild_ledger`.
    """
    run_scan(spark, path_tables, [node("f-1"), node("f-2")], "s1", TS["s1"])

    def die(*args, **kwargs):
        raise RuntimeError("simulated crash between the MERGE and the commit record")

    with monkeypatch.context() as crashed:
        crashed.setattr(run_pipeline, "record_scan", die)
        with pytest.raises(RuntimeError, match="between the MERGE"):
            run_scan(spark, path_tables, [node("f-1")], "s2", TS["s2"])

    assert run_pipeline.recorded_scan(spark, path_tables, "s2") is None
    assert run_pipeline.ledger_already_merged(spark, path_tables, "s2") is True

    metrics_before = metrics_rows(spark, path_tables)
    with pytest.raises(RuntimeError) as refused:
        drive_main(spark, monkeypatch, data_root, "s2")

    message = str(refused.value)
    assert "--rebuild_ledger" in message
    assert f"family='{run_pipeline.FAMILY_SCAN}'" in message
    assert metrics_rows(spark, path_tables) == metrics_before


# ------------------------------------------------------------------- (b) family integrity


def test_every_scan_carries_every_family(spark, tables):
    """One table, every family, and every scan in all of them.

    **Failure of presence**: a family dropped from the fold is invisible in a wide table -- the
    rows that carried it simply stop existing, and every read that filters on `family` returns
    an empty frame that looks like a quiet period rather than a missing publish.
    """
    run_scan(spark, tables, [node("f-1"), node("f-2"), node("f-3")], "s1", TS["s1"])
    run_scan(spark, tables, [node("f-1")], "s2", TS["s2"])

    rows = spark.table(tables.metrics).collect()
    assert rows, "two scans have to have published something"
    assert all(row["family"] is not None for row in rows), (
        "a row that does not say which family it belongs to is counted by every reader of "
        "every other one"
    )
    assert {row["family"] for row in rows} == set(run_pipeline.METRICS_FAMILIES)
    assert all(row["scan_id"] is not None and row["scope"] == SCOPE for row in rows)

    families = families_by_scan(spark, tables)
    assert set(families) == {"s1", "s2"}
    for scan_id, seen in families.items():
        assert seen.count(run_pipeline.FAMILY_SCAN) == 1, f"{scan_id}: one commit record"
        assert set(seen) - {run_pipeline.FAMILY_SCAN} == set(run_pipeline.GOLD_FAMILIES), scan_id

    # Capacity carries every month twice, once per population, and `assets` stacks the same two
    # populations for the same reason -- so a row that does not say which doubles every count
    # that reads it.
    for family in (run_pipeline.FAMILY_CAPACITY, run_pipeline.FAMILY_ASSETS):
        stacked = spark.table(tables.metrics).filter(F.col("family") == family).collect()
        assert stacked, family
        assert all(row["population"] is not None for row in stacked), family


# --------------------------------------------------------------------- (c) the union schema


def test_the_union_schema_is_the_elementwise_merge(spark, tables, monkeypatch):
    """The table's schema is exactly the element-wise merge of the family frames' schemas.

    **The route taken**: the family frames are captured as `publish_gold` folds them, by
    recording the receiver and argument of every `unionByName` call whose frames carry a
    `family` column. That is the real published frames -- post-join for `mttr`, post-`withColumn`
    for `program` -- rather than a second implementation recomputed from `metrics.*` here, which
    could drift from the pipeline and still agree with itself. The populations `capacity` and
    `assets` each stack are unioned before `with_scan_columns` stamps them, so they carry no
    `family` and are not mistaken for a family frame.

    **Failure of presence**: `unionByName(allowMissingColumns=True)` aligns by NAME. Two families
    spelling one column differently give two half-NULL columns; two families giving one name two
    types either fails the write or silently widens it, and a widened column is a value that
    arrived in the register as something other than what was measured.
    """
    recorded: list = []
    real_union = DataFrame.unionByName

    def recording(self, other, allowMissingColumns=False):
        if "family" in self.columns and "family" in other.columns:
            if not recorded:
                recorded.append(self.schema)
            recorded.append(other.schema)
        return real_union(self, other, allowMissingColumns)

    monkeypatch.setattr(DataFrame, "unionByName", recording)
    run_scan(spark, tables, [node("f-1"), node("f-2")], "s1", TS["s1"])
    monkeypatch.undo()

    assert len(recorded) == len(run_pipeline.GOLD_FAMILIES), (
        "one frame per gold family reaches the fold"
    )

    merged: dict = {}
    for schema in recorded:
        for field in schema.fields:
            if field.name in merged:
                assert merged[field.name] == field.dataType, (
                    f"{field.name} carries two types across the gold families: "
                    f"{merged[field.name]} and {field.dataType}"
                )
            merged[field.name] = field.dataType

    # The declared columns the commit record owns and no gold family has. They are part of the
    # table and of no family, which is the whole reason `METRICS_BASE_SCHEMA` is a *base*.
    base = spark.createDataFrame([], run_pipeline.METRICS_BASE_SCHEMA).schema
    for field in base.fields:
        if field.name in merged:
            assert merged[field.name] == field.dataType, field.name
        merged[field.name] = field.dataType

    stored = {f.name: f.dataType for f in spark.table(tables.metrics).schema.fields}
    assert stored == merged


# ----------------------------------------------------------- (d) path and catalog registers


def test_path_and_catalog_registers_hold_the_same_metrics(spark, tables, path_tables):
    """Two backends, one register -- compared over the whole of `metrics`, types included.

    Overlaps `test_ledger_pipeline.py::test_a_path_backed_register_holds_the_same_ledger`, which
    compares `str(row.asDict())` over this same table. This is the stricter one: the rows are
    compared as typed dicts, and the two SCHEMAS are compared as well. A `str()` comparison
    cannot see a column that arrived as a different type in one mode, and neither comparison can
    see a column that is missing from both -- which is what the schema equality adds.

    **Failure of presence in one backend**: `--data_path` exists so a PoC with no catalog can
    still collect a register, and the promise is that nothing is lost by it. A family, a column
    or a row present in one mode and not the other breaks that promise silently, because each
    mode looks complete on its own.
    """
    first = [node("f-1"), node("f-2"), node("f-3")]
    for tbl in (tables, path_tables):
        run_scan(spark, tbl, first, "s1", TS["s1"])
        run_scan(spark, tbl, [node("f-1")], "s2", TS["s2"])

    assert metrics_rows(spark, path_tables) == metrics_rows(spark, tables)
    assert {f.name: f.dataType for f in spark.table(path_tables.metrics).schema.fields} == {
        f.name: f.dataType for f in spark.table(tables.metrics).schema.fields
    }
    def families(tbl):
        return {scan: sorted(seen) for scan, seen in families_by_scan(spark, tbl).items()}

    assert families(path_tables) == families(tables)


# ------------------------------------------------------------------------ (e) closed_observed


def test_closed_observed_counts_this_scans_resolutions_in_its_month(spark):
    """Reconciliation's own resolutions, per calendar month, including this scan's.

    `closed_observed` is pure now: it takes the scan log as it stood BEFORE this run plus this
    run's own `(scan_ts, resolved_count)`, and never reads the table back. It used to read it,
    and the number was right only because `record_scan` happened to have committed a few
    statements earlier -- a figure resting on a write ordering nothing stated.

    **Failure of presence** in one direction: drop this scan's own pair and the newest month
    reports every resolution but today's. **Failure of absence** in the other: a scan row with
    no timestamp cannot be placed in a month, and counting it anyway would put resolutions in a
    month nobody measured. It is skipped, exactly as `observation_start` skips it.
    """
    scan_log = [
        Row(scan_id="s4", scan_ts=None, severities=None, resolved_count=99),
        Row(scan_id="s3", scan_ts=dt.datetime(2026, 5, 20, 9, 30), severities=None,
            resolved_count=4),
        Row(scan_id="s2", scan_ts=dt.datetime(2026, 5, 2, 0, 0), severities=None,
            resolved_count=3),
        Row(scan_id="s1", scan_ts=dt.datetime(2026, 4, 30, 23, 59), severities=None,
            resolved_count=5),
    ]

    frame = run_pipeline.closed_observed(
        spark, scan_log, "2026-06-10T00:00:00Z", {"resolved_count": 11}
    )
    assert frame.schema.simpleString() == "struct<month:timestamp,closed_observed:bigint>"

    counted = {row["month"]: row["closed_observed"] for row in frame.collect()}
    assert counted == {
        dt.datetime(2026, 4, 1): 5,
        # Two scans in one month are summed, not overwritten.
        dt.datetime(2026, 5, 1): 7,
        # This scan's own resolutions, in this scan's own month, with no row of its own on the
        # log it was handed.
        dt.datetime(2026, 6, 1): 11,
    }
    assert 99 not in counted.values(), "the undated scan is not a resolution in January"
    assert sum(counted.values()) == 23
