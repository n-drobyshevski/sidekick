"""Two scans through ``brick``'s real ``run_pipeline.main()``, against a fake Wiz server that
validates the filter shape it receives.

One lake, one Spark session, shared by every Spark-backed test below -- moving from one scope
to the next between tests goes through ``devlake.run._ensure_brick_on_path`` (called inside
``devlake.run.scan`` itself), not through a session restart.

**All three scopes land in the same three tables.** They used to land in nine, prefixed by
scope; the register is one table set now, with ``scope`` in the ledger's MERGE key and in every
read of it. So every read below that is about one scope says so -- the ledger and the metrics
families all hold the other two scopes' rows by the time the later tests run, and the tests run
in file order, ``os`` then ``sca`` then ``sast``. Each test's own scope is the newest thing in
the tables when it runs and the oldest thing still there when the next one does; that is the
property this module is positioned to prove and ``test_scope_isolation.py`` proves directly.

Both the session and brick's module state are torn down at module teardown (see
``_cleanup``), so a *different* test file collected in the same run -- ``test_lake.py``'s own
session-scoped ``spark`` fixture -- gets a clean process to build its own session in, whichever
order pytest happens to collect the two files in.
"""

from __future__ import annotations

import pytest

pytest.importorskip(
    "pyspark", reason="devlake tests need pyspark: pip install -r brick/requirements.txt"
)
pytest.importorskip(
    "delta", reason="devlake tests need delta-spark: pip install -r brick/requirements.txt"
)

from pyspark.sql import functions as F  # noqa: E402

from devlake import fakewiz, run  # noqa: E402
from devlake import session as devlake_session  # noqa: E402

SCHEMA = "e2e"


@pytest.fixture(scope="module")
def lake_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("e2e_lake")


@pytest.fixture(scope="module")
def spark(lake_dir):
    """One session for this whole module. Deliberately not the ``conftest.py`` fixture of the
    same name -- pytest resolves a module-level fixture for the tests in this module only, so
    ``test_lake.py``'s session-scoped fixture is untouched by anything below."""
    return devlake_session.build(lake_dir, app_name="devlake-e2e")


@pytest.fixture(scope="module", autouse=True)
def _cleanup(spark):
    yield
    spark.stop()
    run.purge_brick_state()


# --------------------------------------------------------------------------------------- os


def test_os_two_scans_produce_two_committed_scan_rows_with_disappearance(spark, lake_dir):
    """Two scans through the real ``main()``: the scan log gets both rows, scan 2 resolves
    something, and it is resolved BY DISAPPEARANCE rather than by the API's own ``resolvedAt``.

    Pins the exact figures measured for this fixture through the single tree: scan-1
    ``total=4 new_count=4 resolved_count=2``, scan-2 ``total=3 new_count=0 resolved_count=1``,
    and the ledger's ``resolution_src`` split NULL 1 / ``api`` 2 / ``disappeared`` 1. See
    ``devlake.run.default_fixture``'s docstring for why the slice has to drop the CRITICAL/OPEN
    finding specifically rather than truncate the fixture in half: the naive first-half slice
    resolves nothing at all, for two different reasons that both had to be understood before
    this test could assert anything real.
    """
    _, scan1_nodes, scan2_nodes = run.default_fixture("os")
    assert len(scan1_nodes) == 4
    assert len(scan2_nodes) == 3

    run.scan(
        "os", scan1_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="os-scan-1", scan_ts="2026-06-01T00:00:00Z",
        spark=spark,
    )
    result2 = run.scan(
        "os", scan2_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="os-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    tables = result2.tables
    import run_pipeline as run_pipeline_module  # noqa: PLC0415

    def family(name):
        return spark.table(tables.metrics).where(
            (F.col("family") == name) & (F.col("scope") == "os")
        )

    scans = family(run_pipeline_module.FAMILY_SCAN).orderBy("scan_ts").collect()
    assert [r["scan_id"] for r in scans] == ["os-scan-1", "os-scan-2"]
    assert [r["total"] for r in scans] == [4, 3]
    assert [r["new_count"] for r in scans] == [4, 0]
    assert [r["resolved_count"] for r in scans] == [2, 1]

    ledger = spark.table(tables.ledger).where(F.col("scope") == "os")
    disappeared = ledger.filter("resolution_src = 'disappeared'").collect()
    assert len(disappeared) == 1
    assert disappeared[0]["status"] == "RESOLVED"
    assert disappeared[0]["severity"] == "CRITICAL"  # the finding default_fixture drops

    resolution_src_counts = {
        row["resolution_src"]: row["count"]
        for row in ledger.groupBy("resolution_src").count().collect()
    }
    assert resolution_src_counts == {None: 1, "api": 2, "disappeared": 1}

    scan_ids = {
        r["scan_id"]
        for r in family(run_pipeline_module.FAMILY_MTTR).select("scan_id").distinct().collect()
    }
    assert scan_ids == {"os-scan-1", "os-scan-2"}

    # Idempotency: a retry that arrives with the same --scan_id must not advance anything a
    # second time -- the scans row count has to stay exactly 2.
    run.scan(
        "os", scan2_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="os-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    assert family(run_pipeline_module.FAMILY_SCAN).count() == 2


# -------------------------------------------------------------------------------------- sca


def test_sca_two_scans_land_and_disappearance_fires(spark, lake_dir):
    """Same two-scan shape as the os test, on ``brick``'s ``sca`` scope. Here a plain
    first-half truncation already fires disappearance -- measured in
    ``devlake.run.default_fixture``'s docstring -- so no special slice is needed."""
    _, scan1_nodes, scan2_nodes = run.default_fixture("sca")
    assert len(scan1_nodes) == 54
    assert len(scan2_nodes) == 27

    run.scan(
        "sca", scan1_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="sca-scan-1", scan_ts="2026-06-01T00:00:00Z",
        spark=spark,
    )
    result2 = run.scan(
        "sca", scan2_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="sca-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    tables = result2.tables
    import run_pipeline as run_pipeline_module  # noqa: PLC0415

    def family(name):
        return spark.table(tables.metrics).where(
            (F.col("family") == name) & (F.col("scope") == "sca")
        )

    assert family(run_pipeline_module.FAMILY_SCAN).count() == 2
    scan2_row = family(run_pipeline_module.FAMILY_SCAN).filter("scan_id = 'sca-scan-2'").collect()[0]
    assert scan2_row["resolved_count"] > 0

    disappeared_count = (
        spark.table(tables.ledger)
        .where(F.col("scope") == "sca")
        .filter("resolution_src = 'disappeared'")
        .count()
    )
    assert disappeared_count > 0

    scan_ids = {
        r["scan_id"]
        for r in family(run_pipeline_module.FAMILY_MTTR).select("scan_id").distinct().collect()
    }
    assert scan_ids == {"sca-scan-1", "sca-scan-2"}


# ------------------------------------------------------------------------------------- sast


def _synthetic_sast_node(template: dict, *, node_id: str, created_at: str) -> dict:
    """A second SAST node, shaped like the committed capture's own nodes but carrying a
    ``createdAt`` none of the 40 captured ones do -- the tenant capture predates that column
    (see ``ingest.py``'s own comment on ``_SAST_QUERY_TEMPLATE``), so the only way to exercise
    the birth-date path is to add one by hand rather than pretend the capture has it."""
    node = dict(template)
    node["id"] = node_id
    node["createdAt"] = created_at
    node["filePath"] = "devlake/synthetic/Node.java"
    return node


def test_sast_lands_null_then_a_real_birth_date(spark, lake_dir):
    """One scan of the committed capture (no ``createdAt`` anywhere in it) lands with
    ``first_detected_at`` NULL on every silver row. A second scan adding one synthetic node that
    DOES carry ``createdAt`` lands that row's ledger ``first_seen`` as that exact date -- not
    the scan timestamp -- because ``ledger.py`` prefers the API's own birth date over an
    observed one (``first_seen = coalesce(first_detected_at, scan_ts)``, ``ledger.py:409-432``).
    """
    _, scan1_nodes, _ = run.default_fixture("sast")
    assert len(scan1_nodes) == 40

    result1 = run.scan(
        "sast", scan1_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="sast-scan-1", scan_ts="2026-06-01T00:00:00Z",
        spark=spark,
    )
    tables = result1.tables
    import metrics as metrics_module  # noqa: PLC0415

    # Silver is not a table -- it is derived from bronze in memory, the same way
    # `panels._silver_frame` does it for a notebook page, and the same function
    # `run_pipeline.build_metrics` used to build the scan's own silver frame in the first place.
    bronze_scan1 = spark.table(tables.bronze).filter("scan_id = 'sast-scan-1'")
    scan1_silver = metrics_module.silver_findings(bronze_scan1, "sast")
    assert scan1_silver.count() == 40
    assert scan1_silver.filter("first_detected_at IS NOT NULL").count() == 0

    created_at = "2026-05-15T00:00:00Z"
    synthetic = _synthetic_sast_node(
        scan1_nodes[0], node_id="devlake-synthetic-sast-1", created_at=created_at
    )
    result2 = run.scan(
        "sast", scan1_nodes + [synthetic],
        lake=lake_dir, schema=SCHEMA, scan_id="sast-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    assert result2.tables == tables  # same scope, same run -- table identity should not move

    sast_ledger = spark.table(tables.ledger).where(F.col("scope") == "sast")
    ledger_row = sast_ledger.filter("vuln_key = 'id:devlake-synthetic-sast-1'").collect()
    assert len(ledger_row) == 1
    assert ledger_row[0]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == created_at

    # Every one of the 40 captured nodes still has no birth date of its own -- adding one
    # synthetic node must not have retroactively invented dates for the rest of the register.
    # Their `first_seen` stays the scan-1 timestamp (the observed fallback), unchanged by scan 2.
    original_first_seen = (
        sast_ledger.filter("vuln_key != 'id:devlake-synthetic-sast-1'")
        .select("first_seen")
        .distinct()
        .collect()
    )
    assert len(original_first_seen) == 1
    assert original_first_seen[0]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T00:00:00Z"


# ------------------------------------------------------------- all three, one table set


#: The order the chained Databricks job runs them in, and the ledger row count each scope's
#: committed capture produces on a first scan. Named rather than inlined because the assertion
#: below divides them by scope and because a fixture that changes size has to fail here saying
#: "re-measure", not quietly shift what "unchanged" means.
SHARED_SCOPES = ("os", "sca", "sast")
SHARED_LEDGER_ROWS = {"os": 4, "sca": 54, "sast": 40}


def _ledger_counts_by_scope(spark, tables) -> dict:
    """``SELECT scope, count(*) FROM <ledger> GROUP BY scope`` -- the one read that can see a
    scan of one scope having disturbed another."""
    return {
        row["scope"]: row["count"]
        for row in spark.table(tables.ledger).groupBy("scope").count().collect()
    }


def test_three_scopes_land_in_one_register_and_none_disturbs_the_ones_before_it(
    spark, lake_dir
):
    """os, then sca, then sast, into ONE lake and ONE table set -- the shape the chained job
    produces, run end to end through the real ``main()``.

    **Failure of absence**: the danger here is not that a scope fails to land, it is that a
    scope that lands RESOLVES one that already had. ``reconcile`` dates a disappearance as a
    remediation, and every row of the other two scopes is absent from any given scan by
    construction -- so the thing to measure is not the final counts but whether each scope's
    count survives the scans that come after it. That is why the counts are captured after
    every scan rather than only at the end: a register where os was emptied by the sca scan and
    then re-created would still end with three rows in a ``GROUP BY scope``.

    A fresh schema of its own, in the shared lake: the three tests above already interleave
    these same scopes in ``e2e``, and this one has to be able to say what each count was at each
    step without inheriting theirs. ``brick/tests/test_scope_isolation.py`` proves the same
    property directly, against the filters that carry it; this proves it through the real
    entry point, with the real fixtures, in one directory on disk.
    """
    schema = "shared"
    snapshots = []
    tables = None
    for index, scope in enumerate(SHARED_SCOPES):
        _, scan1_nodes, _ = run.default_fixture(scope)
        assert len(scan1_nodes) == SHARED_LEDGER_ROWS[scope], (
            f"the committed {scope} capture changed size; re-measure SHARED_LEDGER_ROWS"
        )
        result = run.scan(
            scope, scan1_nodes,
            lake=lake_dir, schema=schema, scan_id=f"shared-{scope}-1",
            scan_ts=f"2026-07-{index + 1:02d}T00:00:00Z", spark=spark,
        )
        tables = result.tables
        snapshots.append((scope, _ledger_counts_by_scope(spark, tables)))

    # One ledger, three populations.
    final = snapshots[-1][1]
    assert set(final) == set(SHARED_SCOPES)
    assert final == SHARED_LEDGER_ROWS
    assert spark.table(tables.ledger).count() == sum(SHARED_LEDGER_ROWS.values())

    # And every scope's count is the same in every snapshot taken after it landed. This is the
    # assertion the final counts cannot make: a scope emptied and rebuilt would pass those.
    for position, (scope, taken) in enumerate(snapshots):
        for later_scope, later in snapshots[position:]:
            assert later[scope] == taken[scope], (
                f"the {scope} register held {taken[scope]} rows and holds {later[scope]} "
                f"after the {later_scope} scan -- a scan of one scope moved another"
            )

    # Not one row of an earlier scope was even touched by a later scan: an unscoped prior read
    # would have re-stamped these with the scanning scope's own last_scan_id.
    import run_pipeline as run_pipeline_module  # noqa: PLC0415

    for scope in SHARED_SCOPES:
        rows = spark.table(tables.ledger).where(F.col("scope") == scope)
        assert {r["last_scan_id"] for r in rows.select("last_scan_id").distinct().collect()} == {
            f"shared-{scope}-1"
        }, scope
        assert rows.filter("resolved_at IS NOT NULL AND resolution_src = 'disappeared'").count() == 0

    # One commit record per scope, in the one metrics table.
    scan_rows = (
        spark.table(tables.metrics)
        .where(F.col("family") == run_pipeline_module.FAMILY_SCAN)
        .collect()
    )
    assert sorted(r["scope"] for r in scan_rows) == sorted(SHARED_SCOPES)
    assert {r["scan_id"] for r in scan_rows} == {f"shared-{s}-1" for s in SHARED_SCOPES}


# ----------------------------------------------------------------------- the fake's own shape


def test_fakewiz_refuses_a_bare_list_severity_for_sast():
    """The mutation this whole fake exists for: SAST's ``severity`` must arrive as
    ``{"equals": [...]}}``, not a bare list -- exactly the shape mismatch that once cost the
    entire SAST population (CLAUDE.md, "the same field name carries DIFFERENT KINDS"). Calling
    ``post`` directly with the wrong shape, rather than only ever exercising it through the real
    ``ingest.build_filter`` (which never gets this wrong today), is what proves the fake
    actually validates rather than merely tolerating whatever the pipeline happens to send.
    """
    run._ensure_brick_on_path()
    import ingest as ingest_module

    fake = fakewiz.FakeWiz("sast", ingest_module, nodes=[])
    with pytest.raises(RuntimeError, match="VALIDATION_INVALID_TYPE_VARIABLE"):
        fake.post(
            "https://fake.invalid/graphql",
            "tok",
            {"filterBy": {"severity": ["HIGH"]}, "first": 10, "after": None},
            30,
        )


def test_fakewiz_refuses_an_object_shaped_bare_list_key_for_sca():
    """The reverse mutation: ``codeToCloudPipelineStage`` must stay a bare list on ``sca`` --
    wrapping it as ``{"equals": [...]}}`` is ``gas_devsecops/``'s mistake ("codeToCloud-
    PipelineStage sat in BASE as a literal and bypassed the table entirely")."""
    run._ensure_brick_on_path()
    import ingest as ingest_module

    fake = fakewiz.FakeWiz("sca", ingest_module, nodes=[])
    with pytest.raises(RuntimeError, match="VALIDATION_INVALID_TYPE_VARIABLE"):
        fake.post(
            "https://fake.invalid/graphql",
            "tok",
            {"filterBy": {"codeToCloudPipelineStage": {"equals": ["CODE"]}}, "first": 10, "after": None},
            30,
        )


def test_fakewiz_refuses_an_unknown_scope():
    run._ensure_brick_on_path()
    import ingest as ingest_module

    with pytest.raises(RuntimeError, match="unknown scope"):
        fakewiz.FakeWiz("not-a-real-scope", ingest_module, nodes=[])
