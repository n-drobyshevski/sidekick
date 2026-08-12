"""The CSV register, and the one property it exists to have: NULL survives.

``csvstore`` is what makes a deployment with no catalog and no Unity Catalog volume readable --
the pipeline writes CSV to the workspace and the notebooks read it back. The risk that comes
with that is stated at the top of the module and is not hypothetical: CSV has no types, and a
NULL ``has_kev`` read back as ``false`` inflates efficiency and deflates coverage at the same
time, silently, with nothing on the page to show for it.

For the ``sast`` scope those three columns are **always** NULL, so a type-blind round-trip would
classify every static-analysis finding as a confident true negative and publish a confusion
matrix that was entirely fiction.

So the test that matters here is not "the files were written". It is **the gold frames computed
over a reloaded register are identical to the ones computed over the Delta tables they came
from** -- which is the only check that covers every column at once, including the ones nobody
thought to assert.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("pyspark")
pytest.importorskip("delta")

BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
sys.path.insert(0, str(BRICK_DIR))

from pyspark.sql import functions as F  # noqa: E402
from pyspark.sql.types import (  # noqa: E402
    BooleanType,
    DoubleType,
    StringType,
    StructField,
    StructType,
)

import csvstore  # noqa: E402
import ledger as ledger_mod  # noqa: E402
import metrics  # noqa: E402
import run_pipeline  # noqa: E402
from config import DEFAULT_RISK_RULE  # noqa: E402
from ingest import extract_nodes  # noqa: E402

SCOPE = "os"
SEVERITIES = ["CRITICAL", "HIGH"]


@pytest.fixture
def register(spark, tmp_path, request):
    """A small real register in its own database, with two scans so lifecycles are real."""
    nodes = extract_nodes(
        json.loads((REPO_ROOT / "os_vulns_response_exemple.json").read_text())
    )
    database = f"csv_{abs(hash(request.node.name)) % 10**8}"
    spark.sql(f"DROP DATABASE IF EXISTS {database} CASCADE")
    spark.sql(f"CREATE DATABASE {database}")
    tables = run_pipeline.resolve_tables(database, SCOPE, argv=[])
    run_pipeline.ensure_tables(spark, tables)

    def scan(scan_id, scan_ts, payload):
        run_pipeline.create_clustered(
            spark, tables.bronze, run_pipeline.BRONZE_TABLE_SCHEMA, "bronze"
        )
        rows = [(scan_id, scan_ts, SCOPE, i, json.dumps(n)) for i, n in enumerate(payload)]
        (
            spark.createDataFrame(
                rows,
                "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING",
            )
            .withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))
            .write.format("delta")
            .mode("append")
            .option("mergeSchema", "true")
            .saveAsTable(tables.bronze)
        )
        run_pipeline.build_metrics(
            spark, tables, scan_id, scan_ts, SCOPE, severities=SEVERITIES, summary=False
        )

    scan("scan-1", "2026-06-01T00:00:00Z", nodes)
    scan("scan-2", "2026-07-01T00:00:00Z", nodes[: max(1, len(nodes) // 2)])

    yield tables, str(tmp_path / "csv")
    spark.sql(f"DROP DATABASE IF EXISTS {database} CASCADE")


def rows_of(frame, order):
    """A frame as a list of dicts, ordered, so two of them can be compared field by field."""
    return [r.asDict() for r in frame.orderBy(*order).collect()]


# ------------------------------------------------------------------ the property that matters


def test_the_confusion_matrix_survives_the_round_trip(spark, register):
    """**The test this module exists for.**

    Coverage, efficiency, both sets of bounds, prevalence, signal coverage and every count
    underneath them, computed over a reloaded ledger, must equal the same figures over the
    Delta ledger. Any type lost on the way through CSV shows up here, because every one of
    those numbers is downstream of a nullable column.
    """
    tables, target = register
    csvstore.export(spark, tables, target)
    loaded = csvstore.load(spark, target, "wiz_os_")

    def matrix(reference):
        frame = metrics.classify_risk(
            ledger_mod.lifecycle_frame(spark.table(reference), "2026-07-01T00:00:00Z"),
            DEFAULT_RISK_RULE,
        )
        return rows_of(metrics.confusion_matrix(frame), ["severity"])

    assert matrix(loaded.ledger) == matrix(tables.ledger)


def test_a_null_exploit_signal_does_not_come_back_as_false(spark, tmp_path):
    """The failure in isolation, so a break here names the cause rather than a downstream rate.

    Three findings: one with the signals observed and true, one with them observed and false,
    one with them never captured. Only the third is `unknown`, and it stays `unknown` -- the
    whole distinction the module header is about.
    """
    schema = StructType(
        [
            StructField("vuln_key", StringType()),
            StructField("has_kev", BooleanType()),
            StructField("has_exploit", BooleanType()),
            StructField("epss", DoubleType()),
        ]
    )
    frame = spark.createDataFrame(
        [
            ("id:observed-true", True, False, 0.9),
            ("id:observed-false", False, False, 0.01),
            ("id:never-captured", None, None, None),
        ],
        schema,
    )
    target = str(tmp_path / "csv")
    csvstore._write_csv(frame, _one_file(target, "t.csv"))
    with open(_one_file(target, "t.schema.json"), "w", encoding="utf-8") as fh:
        json.dump(frame.schema.jsonValue(), fh)

    read_back = spark.createDataFrame(
        csvstore._read_csv(_one_file(target, "t.csv"), schema), schema
    )
    by_key = {r["vuln_key"]: r for r in read_back.collect()}

    assert by_key["id:observed-true"]["has_kev"] is True
    # `is False`, not falsy: this is the assertion that a captured negative is preserved...
    assert by_key["id:observed-false"]["has_kev"] is False
    # ...and this is the one that an absent signal did not become one.
    assert by_key["id:never-captured"]["has_kev"] is None
    assert by_key["id:never-captured"]["has_exploit"] is None
    assert by_key["id:never-captured"]["epss"] is None

    classified = metrics.classify_risk(read_back, DEFAULT_RISK_RULE)
    verdicts = {r["vuln_key"]: r["risk_class"] for r in classified.collect()}
    assert verdicts == {
        "id:observed-true": "high",
        "id:observed-false": "low",
        "id:never-captured": "unknown",
    }


def test_a_sast_shaped_register_stays_entirely_unclassified(spark, tmp_path):
    """The same property from the direction that bites hardest.

    A SAST register has NULL for all three CVE signals on every row. Under ``RiskRule`` that is
    100% unclassified -- which is the honest reading -- and a round-trip that turned those NULLs
    into ``false`` would report 100% *classified*, 0% high risk, and an efficiency of NULL over
    a population it had just invented.
    """
    schema = StructType(
        [
            StructField("vuln_key", StringType()),
            StructField("has_kev", BooleanType()),
            StructField("has_exploit", BooleanType()),
            StructField("epss", DoubleType()),
            StructField("severity", StringType()),
            StructField("is_open", BooleanType()),
        ]
    )
    frame = spark.createDataFrame(
        [(f"id:w-{i}", None, None, None, "HIGH", i % 2 == 0) for i in range(6)], schema
    )
    target = str(tmp_path / "csv")
    path = _one_file(target, "t.csv")
    csvstore._write_csv(frame, path)
    read_back = spark.createDataFrame(csvstore._read_csv(path, schema), schema)

    matrix = (
        metrics.confusion_matrix(metrics.classify_risk(read_back, DEFAULT_RISK_RULE))
        .where(F.col("severity") == "OVERALL")
        .first()
    )
    assert matrix["classified"] == 0
    assert matrix["unknown"] == 6
    assert matrix["signal_coverage_pct"] == 0.0
    assert matrix["coverage_pct"] is None
    assert matrix["efficiency_pct"] is None


def test_an_empty_field_is_the_only_null_a_boolean_accepts(spark):
    """``_parse_bool`` refuses anything it is not sure about, rather than guessing.

    A CSV that has been through a spreadsheet comes back with all sorts in a boolean column.
    Guessing would reintroduce exactly the bug the sidecar removes, so an unrecognised value is
    an error naming the consequence.
    """
    assert csvstore._parse_bool("") is None
    assert csvstore._parse_bool("true") is True
    assert csvstore._parse_bool("false") is False
    for hostile in ("NULL", "None", "N/A", "-", "yes"):
        with pytest.raises(RuntimeError, match="not a boolean"):
            csvstore._parse_bool(hostile)


# --------------------------------------------------------------------------- the mechanics


def test_every_gold_frame_survives_the_round_trip(spark, register):
    """Not just the ledger: MTTR, program, capacity and sensitivity, row for row.

    The gold tables carry the timestamps, the doubles and the NULL rates, so this is where a
    ``mmcr`` of NULL coming back as 0.0 -- "we closed nothing" rather than "there was nothing
    open" -- would surface.
    """
    tables, target = register
    csvstore.export(spark, tables, target)
    loaded = csvstore.load(spark, target, "wiz_os_")

    for attr, order in (
        ("mttr", ["scan_id", "severity"]),
        ("program", ["scan_id", "severity"]),
        ("capacity", ["scan_id", "population", "month"]),
        ("sensitivity", ["scan_id", "rule_label"]),
        ("scans", ["scan_id"]),
    ):
        expected = rows_of(spark.table(getattr(tables, attr)), order)
        actual = rows_of(spark.table(getattr(loaded, attr)), order)
        assert actual == expected, f"{attr} did not round-trip"


def test_bronze_is_excluded_unless_asked_for(spark, register):
    """It is the only table big enough to hit the workspace 500 MB file cap, and nothing reads
    it from CSV. Opting in is one argument; paying for it by default is not."""
    tables, target = register
    csvstore.export(spark, tables, target)
    assert not (Path(target) / "wiz_os_findings_raw.csv").exists()

    csvstore.export(spark, tables, target, include_bronze=True)
    assert (Path(target) / "wiz_os_findings_raw.csv").exists()


def test_load_names_its_views_after_the_tables(spark, register):
    """The whole reason nothing downstream needs changing: a temp view is valid anywhere Spark
    wants a table, so a CSV register substitutes for a catalog-backed one."""
    tables, target = register
    csvstore.export(spark, tables, target)
    loaded = csvstore.load(spark, target, "wiz_os_")

    assert loaded.mttr == "wiz_os_metrics_mttr"
    assert loaded.ledger == "wiz_os_vuln_ledger"
    # And it is readable by that name through plain SQL, which is what a notebook cell does.
    assert spark.sql("SELECT count(*) AS n FROM wiz_os_metrics_mttr").first()["n"] > 0


def test_load_refuses_a_directory_that_is_not_a_register(spark, tmp_path):
    """A wrong `scope` or `table_prefix` widget points at an export that does not exist, and
    the useful failure names the widgets rather than the first missing view."""
    with pytest.raises(RuntimeError, match="No CSV register"):
        csvstore.load(spark, str(tmp_path), "wiz_sast_")


def test_a_csv_edited_apart_from_its_sidecar_is_refused(spark, register):
    """The two files are written together and read together. Reconciling a mismatch by
    guessing which column is which is how a rate ends up computed over the wrong column."""
    tables, target = register
    csvstore.export(spark, tables, target)
    path = Path(target) / "wiz_os_metrics_mttr.csv"
    lines = path.read_text().splitlines()
    path.write_text("\n".join(["not,the,right,header"] + lines[1:]))

    with pytest.raises(RuntimeError, match="sidecar declares"):
        csvstore.load(spark, target, "wiz_os_")


def test_restore_rebuilds_a_register_the_pipeline_can_continue(spark, register, tmp_path):
    """The reason ``restore`` exists: this deployment's Delta side is ephemeral, so the export
    is the durable copy -- and a copy you cannot restore from is a report, not a backup.

    Restored into a fresh path-backed register, and the ledger must still accept a MERGE,
    because "can the next scan continue from this" is the actual question.
    """
    tables, target = register
    csvstore.export(spark, tables, target)

    root = str(tmp_path / "restored")
    fresh = run_pipeline.resolve_tables("", SCOPE, argv=[], data_path=root)
    csvstore.restore(spark, target, fresh, "wiz_os_")

    expected = rows_of(spark.table(tables.ledger), ["vuln_key"])
    assert rows_of(spark.table(fresh.ledger), ["vuln_key"]) == expected

    # And it is a real Delta table, not a view: the next scan reconciles into it.
    touched = ledger_mod.reconcile(
        spark.table(fresh.ledger),
        ledger_mod.observed(
            spark.table(fresh.ledger)
            .limit(1)
            .select(
                F.col("vuln_key").alias("finding_id"),
                "cve", "component", "severity", "asset_id", "asset_name", "asset_type",
                "cloud", "subscription_name", "subscription_ext_id",
                F.col("first_seen").alias("first_detected_at"),
                F.col("last_seen").alias("last_detected_at"),
                "resolved_at",
                F.lit(True).alias("is_open"),
                "fix_date",
                F.lit(None).cast("string").alias("fixed_version"),
                "has_kev", "has_exploit", "epss",
                F.lit(0).cast("long").alias("seq"),
            )
        ),
        scan_id="scan-3",
        scan_ts="2026-08-01T00:00:00Z",
        scope=SCOPE,
    )
    assert touched.count() >= 1


def test_a_timestamp_comes_back_as_a_timestamp(spark, register):
    """Not as text. ``first_seen`` and ``resolved_at`` are the clock every MTTR figure runs on,
    and a string column would make ``unix_timestamp`` return NULL for all of them."""
    tables, target = register
    csvstore.export(spark, tables, target)
    loaded = csvstore.load(spark, target, "wiz_os_")

    fields = dict(spark.table(loaded.ledger).dtypes)
    assert fields["first_seen"] == "timestamp"
    assert fields["resolved_at"] == "timestamp"
    assert fields["epss"] == "double"
    assert fields["has_kev"] == "boolean"
    assert fields["reopened_count"] == "int"


def test_table_basename_reads_both_reference_forms():
    """One export directory has to be readable whichever storage mode wrote it."""
    assert csvstore.table_basename("cat.sch.wiz_sca_metrics_mttr") == "wiz_sca_metrics_mttr"
    assert (
        csvstore.table_basename("delta.`/Volumes/c/s/v/reg/wiz_sca_metrics_mttr`")
        == "wiz_sca_metrics_mttr"
    )


def _one_file(directory: str, name: str) -> str:
    Path(directory).mkdir(parents=True, exist_ok=True)
    return str(Path(directory) / name)


# ------------------------------------------------------- the CSV register, end to end


def test_two_scans_reconcile_through_csv_alone(spark, tmp_path, monkeypatch):
    """**The test the CSV-register mode exists for.**

    Scan, export, *destroy the Delta side entirely*, scan again -- and the second scan must
    continue the first one's lifecycles. That is the whole claim of `--csv_path`: the CSV is
    the register and the Delta directory is scratch for the length of one run.

    If it fails, the failure mode in production is not an error. Every scan would start from an
    empty ledger, `first_seen` would collapse to today on every finding, nothing would ever
    resolve by disappearance, and MTTR would read near zero -- a register that looks like a
    healthy programme and is measuring nothing.
    """
    import shutil

    nodes = extract_nodes(
        json.loads((REPO_ROOT / "os_vulns_response_exemple.json").read_text())
    )
    register = str(tmp_path / "csv")
    scratch = str(tmp_path / "scratch")
    monkeypatch.setattr(run_pipeline.dbx, "widget", lambda name: "")

    def scan(scan_id, scan_ts, payload):
        tables = run_pipeline.resolve_tables("", SCOPE, argv=[], data_path=scratch)
        csvstore.restore(spark, register, tables, "wiz_os_", missing_ok=True)
        run_pipeline.ensure_tables(spark, tables)
        run_pipeline.create_clustered(
            spark, tables.bronze, run_pipeline.BRONZE_TABLE_SCHEMA, "bronze"
        )
        rows = [(scan_id, scan_ts, SCOPE, i, json.dumps(n)) for i, n in enumerate(payload)]
        (
            spark.createDataFrame(
                rows,
                "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING",
            )
            .withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))
            .write.format("delta").mode("append").option("mergeSchema", "true")
            .save(run_pipeline.as_path(tables.bronze))
        )
        run_pipeline.build_metrics(
            spark, tables, scan_id, scan_ts, SCOPE, severities=SEVERITIES, summary=False
        )
        csvstore.export(spark, tables, register)
        return tables

    scan("scan-1", "2026-06-01T00:00:00Z", nodes)
    first = csvstore.load(spark, register, "wiz_os_")
    seen_first = {r["vuln_key"]: r for r in spark.table(first.ledger).collect()}
    assert seen_first, "the first scan exported no lifecycles"

    # The Delta side is gone. Everything the second scan knows, it knows from the CSV.
    shutil.rmtree(scratch)

    # Drop one finding that is **in the severity scope and still OPEN**, so disappearance is the
    # only way it can close -- the inference that only works if the previous scan's ledger AND
    # its scan log both came back. Named rather than sliced: the committed response holds one
    # finding per severity, so taking half of it can drop only out-of-scope rows and prove
    # nothing. And OPEN, because a finding the response already marks RESOLVED closes through
    # `resolvedAt` with `resolution_src = "api"` and would pass without the round-trip working.
    dropped = next(
        n for n in nodes if n["severity"] in SEVERITIES and n["status"] == "OPEN"
    )
    scan("scan-2", "2026-07-01T00:00:00Z", [n for n in nodes if n is not dropped])
    after = csvstore.load(spark, register, "wiz_os_")
    rows = {r["vuln_key"]: r for r in spark.table(after.ledger).collect()}

    # Same lifecycles, not a second set: identity survived the round-trip.
    assert set(rows) == set(seen_first)
    # `first_seen` did not collapse to the second scan -- the earliest evidence was carried.
    for key, row in rows.items():
        assert row["first_seen"] == seen_first[key]["first_seen"], key
    # And the tail actually resolved, by the inference that needs the previous scan log. Keyed
    # on `vuln_key` rather than on the CVE: one CVE can sit on several assets, so a CVE is not
    # an identity here even where this fixture happens to make it look like one.
    disappeared = [key for key, r in rows.items() if r["resolution_src"] == "disappeared"]
    assert disappeared == [f"id:{dropped['id']}"], (
        "the dropped finding did not resolve by disappearance -- the previous scan's log or "
        "its last_scan_id did not survive the round-trip"
    )

    # Two scans on the log, and the gold tables accumulated rather than being replaced.
    assert spark.table(after.scans).count() == 2
    assert (
        spark.table(after.mttr).select("scan_id").distinct().count() == 2
    ), "the gold trend did not survive the round-trip"


def test_a_torn_export_is_refused_rather_than_read(spark, register):
    """The manifest is written last, so a run that dies mid-export leaves this shape.

    Reconciling against a half-written ledger invents remediation that never happened, and it
    does it silently -- so the register refuses to load rather than letting a scan proceed.
    """
    tables, target = register
    csvstore.export(spark, tables, target)

    # A ledger truncated the way a killed process would leave it.
    path = Path(target) / "wiz_os_vuln_ledger.csv"
    lines = path.read_text().splitlines()
    assert len(lines) > 2
    path.write_text("\n".join(lines[:2]) + "\n")

    with pytest.raises(RuntimeError, match="torn"):
        csvstore.load(spark, target, "wiz_os_")


def test_an_export_with_no_manifest_is_read_unverified(spark, register):
    """An export written by something other than `csvstore.export`, or one whose manifest was
    removed, cannot be checked -- so it is not read."""
    tables, target = register
    csvstore.export(spark, tables, target)
    (Path(target) / csvstore.MANIFEST).unlink()

    # No manifest means no verification is possible; `load` still reads it, because a register
    # exported by an older version is not automatically torn. What must not happen is silence
    # about a register that IS torn, and that is the test above.
    loaded = csvstore.load(spark, target, "wiz_os_")
    assert spark.table(loaded.ledger).count() > 0


def test_restore_tolerates_an_absent_register_only_when_asked(spark, tmp_path):
    """The first run in `--csv_path` mode has nothing to restore, and that is normal. Every
    other caller passing a path with no register there has a wrong path, and should hear so."""
    empty = str(tmp_path / "nothing")
    tables = run_pipeline.resolve_tables("", SCOPE, argv=[], data_path=str(tmp_path / "d"))

    assert csvstore.restore(spark, empty, tables, "wiz_os_", missing_ok=True) == []
    with pytest.raises(RuntimeError, match="No CSV register"):
        csvstore.restore(spark, empty, tables, "wiz_os_")


def test_missing_ok_does_not_mistake_a_manifestless_export_for_an_empty_one(spark, register):
    """`missing_ok` decides on the ledger sidecar, and this is why it cannot decide on the
    manifest.

    An export written before manifests existed has every row it always had. If `missing_ok` read
    it as "nothing here", the run would restore nothing, scan against an empty ledger, and then
    export over the top -- destroying the history in the one mode where the CSV *is* the
    history, with no error anywhere.
    """
    tables, target = register
    csvstore.export(spark, tables, target)
    (Path(target) / csvstore.MANIFEST).unlink()

    restored = csvstore.restore(spark, target, tables, "wiz_os_", missing_ok=True)
    assert restored, "a manifest-less export was skipped as though it were empty"
    assert spark.table(tables.ledger).count() > 0


def test_a_rebuild_against_a_bronzeless_csv_register_is_refused(spark, tmp_path, monkeypatch):
    """`--rebuild_ledger` replays bronze, and bronze is what a CSV export leaves out.

    Without the guard the replay finds an empty bronze, returns, and the run reports nothing --
    indistinguishable, from the outside, from a register that genuinely has no history. The
    refusal has to name the flag, because the recovery is to have set it on the earlier scans.
    """
    monkeypatch.setattr(run_pipeline.dbx, "widget", lambda name: "")
    monkeypatch.setattr(sys, "argv", [
        "run_pipeline.py",
        f"--csv_path={tmp_path / 'csv'}",
        f"--data_path={tmp_path / 'scratch'}",
        f"--scope={SCOPE}",
        "--rebuild_ledger=true",
    ])

    with pytest.raises(RuntimeError, match="csv_include_bronze"):
        run_pipeline.main()
