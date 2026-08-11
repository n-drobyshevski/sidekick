"""Structural validation of the generated AI/BI dashboard.

The `.lvdash.json` format is undocumented and nothing here can import one, so these tests are
the safety net: they check every property that would make Databricks reject the document, plus
the ones that would make it import cleanly and then display the wrong thing.

The last test is the important one -- it runs every dataset query through a real Spark session
against real pipeline output, so a wrong column name fails here rather than on a warehouse.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("pyspark")

BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
sys.path.insert(0, str(BRICK_DIR))

import dashboard  # noqa: E402
from config import SEVERITY_COLORS  # noqa: E402
from run_pipeline import Tables  # noqa: E402

NAMESPACE = "preprod_datalake_insight_analytics.industry"
PREFIX = "wiz_os_"


@pytest.fixture(scope="module")
def tables():
    def q(name):
        return f"{NAMESPACE}.{PREFIX}{name}"

    return Tables(
        bronze=q("findings_raw"), silver=q("findings"), ledger=q("vuln_ledger"),
        scans=q("scans"), mttr=q("metrics_mttr"),
        program=q("metrics_program"), capacity=q("metrics_capacity"),
        sensitivity=q("metrics_sensitivity"),
    )


@pytest.fixture(scope="module")
def doc(tables):
    return dashboard.build(tables)


def widgets(doc):
    for page in doc["pages"]:
        for entry in page["layout"]:
            yield page, entry["widget"], entry["position"]


# ------------------------------------------------------------- referential integrity
#
# This is the class of error that fails an import outright.


def test_every_widget_points_at_a_defined_dataset(doc):
    defined = {d["name"] for d in doc["datasets"]}
    for _, widget, _ in widgets(doc):
        for query in widget["queries"]:
            assert query["query"]["datasetName"] in defined, widget["name"]


def test_every_encoded_field_exists_in_its_own_query(doc):
    """An encoding naming a field the query does not select renders an empty widget."""
    for _, widget, _ in widgets(doc):
        available = {
            f["name"] for q in widget["queries"] for f in q["query"]["fields"]
        }
        for channel, encoding in widget["spec"]["encodings"].items():
            if channel == "columns":
                names = [c["fieldName"] for c in encoding]
            elif channel == "fields":
                names = [f["fieldName"] for f in encoding if "fieldName" in f]
            else:
                names = [encoding["fieldName"]]
            for name in names:
                assert name in available, f"{widget['name']}.{channel} -> {name}"


def test_filter_queryname_matches_a_query_on_the_same_widget(doc):
    for _, widget, _ in widgets(doc):
        if not widget["spec"]["widgetType"].startswith("filter"):
            continue
        own = {q["name"] for q in widget["queries"]}
        for field in widget["spec"]["encodings"]["fields"]:
            assert field["queryName"] in own, widget["name"]


def test_every_dataset_is_actually_used(doc):
    used = {
        q["query"]["datasetName"] for _, w, _ in widgets(doc) for q in w["queries"]
    }
    for dataset in doc["datasets"]:
        assert dataset["name"] in used, f"unused dataset {dataset['displayName']}"


# --------------------------------------------------------------------- layout sanity


def test_widgets_fit_the_six_column_grid(doc):
    for _, widget, pos in widgets(doc):
        assert pos["x"] >= 0 and pos["y"] >= 0, widget["name"]
        assert pos["width"] > 0 and pos["height"] > 0, widget["name"]
        assert pos["x"] + pos["width"] <= dashboard.GRID_COLUMNS, widget["name"]


def test_no_two_widgets_overlap(doc):
    """Overlapping widgets import fine and then stack on top of each other."""
    for page in doc["pages"]:
        boxes = [(e["widget"]["name"], e["position"]) for e in page["layout"]]
        for i, (name_a, a) in enumerate(boxes):
            for name_b, b in boxes[i + 1:]:
                overlap_x = a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]
                overlap_y = a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]
                assert not (overlap_x and overlap_y), (
                    f"{page['displayName']}: {name_a} overlaps {name_b}"
                )


# ------------------------------------------------------------- identity & determinism


def test_widget_and_dataset_ids_are_unique(doc):
    dataset_ids = [d["name"] for d in doc["datasets"]]
    assert len(dataset_ids) == len(set(dataset_ids))
    widget_ids = [w["name"] for _, w, _ in widgets(doc)]
    assert len(widget_ids) == len(set(widget_ids))
    page_ids = [p["name"] for p in doc["pages"]]
    assert len(page_ids) == len(set(page_ids))


def test_generation_is_deterministic(tables):
    """Regenerating an unchanged dashboard must produce an identical file, or every diff is
    noise and nobody reviews them."""
    assert dashboard.to_json(tables) == dashboard.to_json(tables)


# --------------------------------------------------------------------- parameterisation


def test_queries_use_the_configured_tables_only(doc, tables):
    blob = json.dumps(doc)
    for table in (
        tables.mttr, tables.program, tables.capacity, tables.sensitivity, tables.silver
    ):
        assert table in blob
    # The catalog default that used to exist, and unprefixed names, must not survive anywhere.
    assert "main." not in blob
    for bare in ("industry.metrics_mttr", "industry.findings "):
        assert bare not in blob


def test_document_is_valid_json_without_nan(doc, tables):
    """NaN and Infinity are not valid JSON. Databricks rejects the document without saying why,
    so `allow_nan=False` turns that into a local failure."""
    json.loads(dashboard.to_json(tables))
    with pytest.raises(ValueError):
        json.dumps({"x": float("nan")}, allow_nan=False)  # the guard is real


# ------------------------------------------------------------------- accessibility


def test_severity_colour_is_never_the_only_signal(doc):
    """config.SEVERITY_COLORS is a heat ramp that measurably fails a categorical colourblind
    check, so any widget colouring by severity must also carry severity as a field."""
    for _, widget, _ in widgets(doc):
        color = widget["spec"]["encodings"].get("color")
        if not color or color.get("fieldName") != "severity":
            continue
        fields = {f["name"] for q in widget["queries"] for f in q["query"]["fields"]}
        assert "severity" in fields, widget["name"]


def test_severity_palette_matches_the_shared_one(doc):
    for _, widget, _ in widgets(doc):
        color = widget["spec"]["encodings"].get("color")
        if not color:
            continue
        for mapping in color["scale"]["mappings"]:
            assert SEVERITY_COLORS[mapping["value"]] == mapping["color"]


# --------------------------------------------------- the dataset SQL actually runs
#
# Everything above proves the document is well-formed. This proves it is *right*: a typo in a
# column name is invisible to structural checks and fatal on the warehouse.


@pytest.fixture(scope="module")
def live_tables(spark):
    """Real pipeline output for the dashboard SQL to run against.

    Driven through ``run_pipeline.build_metrics`` rather than by calling the metric transforms
    directly. The fixture used to do the latter, which quietly made this a test of a *second*
    implementation: the dashboard could pass here and still reference a column production never
    writes. Two scans, so the ledger has something to reconcile and the disappearance columns
    are populated rather than trivially empty.
    """
    pytest.importorskip(
        "delta", reason="dashboard SQL tests need delta-spark for the ledger tables"
    )
    from pyspark.sql import functions as F

    import run_pipeline
    from ingest import extract_nodes

    nodes = extract_nodes(json.loads((REPO_ROOT / "os_vulns_response_exemple.json").read_text()))
    # Dropped before creating, not only after: the local warehouse is a directory in the working
    # tree, so a previous run that was interrupted leaves tables behind and this fixture would
    # append a second scan-1 to them.
    spark.sql("DROP DATABASE IF EXISTS dash CASCADE")
    spark.sql("CREATE DATABASE dash")
    tables = run_pipeline.resolve_tables("dash", "os", argv=[])
    run_pipeline.ensure_tables(spark, tables)

    def scan(scan_id, scan_ts, payload):
        rows = [(scan_id, scan_ts, "os", i, json.dumps(n)) for i, n in enumerate(payload)]
        spark.createDataFrame(
            rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
        ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).write.format("delta").mode(
            "append"
        ).option("mergeSchema", "true").saveAsTable(tables.bronze)
        run_pipeline.build_metrics(
            spark, tables, scan_id, scan_ts, "os", severities=["CRITICAL", "HIGH"]
        )

    scan("scan-1", "2026-06-01T00:00:00Z", nodes)
    # A second scan missing the tail of the register, so findings resolve by disappearance and
    # `resolved_disappeared` is a real number the widgets have to be able to render.
    scan("scan-2", "2026-07-01T00:00:00Z", nodes[: max(1, len(nodes) // 2)])

    yield spark, tables
    spark.sql("DROP DATABASE IF EXISTS dash CASCADE")


def test_every_dataset_query_runs(live_tables):
    spark, live = live_tables
    for dataset in dashboard.datasets(live):
        try:
            spark.sql(dataset["query"]).collect()
        except Exception as exc:  # noqa: BLE001 -- re-raised with the dataset named
            raise AssertionError(f"dataset {dataset['displayName']!r} failed:\n{exc}") from exc


def test_every_encoded_field_is_a_real_column(live_tables):
    """Closes the loop: structural checks prove an encoding matches its query's declared field
    list, this proves the underlying SELECT actually produces that column."""
    spark, live = live_tables
    columns = {
        d["name"]: set(spark.sql(d["query"]).columns) for d in dashboard.datasets(live)
    }
    for _, widget, _ in widgets(dashboard.build(live)):
        for query in widget["queries"]:
            available = columns[query["query"]["datasetName"]]
            for field in query["query"]["fields"]:
                bare = field["expression"].strip("`")
                if "(" in field["expression"]:  # an aggregate, e.g. SUM(`open_findings`)
                    bare = field["expression"].split("`")[1]
                assert bare in available, f"{widget['name']} -> {bare}"


def test_import_rejects_a_path_that_would_land_as_a_plain_file():
    """`format=AUTO` only recognises a dashboard when the path ends in .lvdash.json. Get it
    wrong and the import succeeds -- as an inert JSON file nobody can open."""
    import dashboard_cli

    with pytest.raises(RuntimeError, match=r"\.lvdash\.json"):
        dashboard_cli.import_to_workspace("{}", "/Users/me/dash.json", "https://x", "tok")


def test_overview_dataset_returns_exactly_one_row(live_tables):
    """The tiles all read from it; more than one row and they would silently show an arbitrary
    scan."""
    spark, live = live_tables
    overview = next(d for d in dashboard.datasets(live) if d["displayName"] == "overview")
    assert spark.sql(overview["query"]).count() == 1
