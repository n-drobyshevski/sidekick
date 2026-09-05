"""Two scans through each fork's real ``run_pipeline.main()``, against a fake Wiz server that
validates the filter shape it receives.

One lake, one Spark session, shared by every Spark-backed test below -- switching fork between
tests goes through ``devlake.run._ensure_fork_on_path`` (called inside ``devlake.run.scan``
itself), not through a session restart: nothing here holds a Python reference into a fork's
modules once a scan returns, so a fork switch leaves nothing dangling. Every scope gets its own
``scan_id`` prefix and shares one schema -- table names are prefixed by scope
(``resolve_tables``'s own ``default_table_prefix``), so ``os``, ``sca`` and ``sast`` land in
separate tables without needing separate schemas.

Both the session and the fork state are torn down at module teardown (see ``_cleanup``), so a
*different* test file collected in the same run -- ``test_lake.py``'s own session-scoped,
brick-only ``spark`` fixture -- gets a clean process to build its own session in, whichever
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
    ``test_lake.py``'s session-scoped, brick-only fixture is untouched by anything below."""
    return devlake_session.build(lake_dir, app_name="devlake-e2e")


@pytest.fixture(scope="module", autouse=True)
def _cleanup(spark):
    yield
    spark.stop()
    run.purge_fork_state()


# ------------------------------------------------------------------------------ brick / os


def test_brick_os_two_scans_land_and_disappearance_fires(spark, lake_dir):
    """Two scans through the real ``main()``: the scan log gets both rows, scan 2 resolves
    something, and it is resolved BY DISAPPEARANCE rather than by the API's own ``resolvedAt``.

    See ``devlake.run.default_fixture``'s docstring for why the slice has to drop the
    CRITICAL/OPEN finding specifically rather than truncate the fixture in half: the naive
    first-half slice resolves nothing at all, for two different reasons that both had to be
    understood before this test could assert anything real.
    """
    _, scan1_nodes, scan2_nodes = run.default_fixture("brick", "os")
    assert len(scan1_nodes) == 4
    assert len(scan2_nodes) == 3

    run.scan(
        "brick", "os", scan1_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="os-scan-1", scan_ts="2026-06-01T00:00:00Z",
        spark=spark,
    )
    result2 = run.scan(
        "brick", "os", scan2_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="os-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    tables = result2.tables

    scans = spark.table(tables.scans).orderBy("scan_ts").collect()
    assert [r["scan_id"] for r in scans] == ["os-scan-1", "os-scan-2"]
    assert scans[1]["resolved_count"] > 0

    disappeared = spark.table(tables.ledger).filter("resolution_src = 'disappeared'").collect()
    assert len(disappeared) >= 1
    assert disappeared[0]["status"] == "RESOLVED"
    assert disappeared[0]["severity"] == "CRITICAL"  # the finding default_fixture drops

    scan_ids = {r["scan_id"] for r in spark.table(tables.mttr).select("scan_id").distinct().collect()}
    assert scan_ids == {"os-scan-1", "os-scan-2"}

    # Idempotency: a retry that arrives with the same --scan_id must not advance anything a
    # second time -- the scans row count has to stay exactly 2.
    run.scan(
        "brick", "os", scan2_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="os-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    assert spark.table(tables.scans).count() == 2


# ------------------------------------------------------------------------------ devsecops / sca


def test_devsecops_sca_two_scans_land_and_disappearance_fires(spark, lake_dir):
    """Same two-scan shape as the os test, on the devsecops fork's sca scope. Here a plain
    first-half truncation already fires disappearance -- measured in
    ``devlake.run.default_fixture``'s docstring -- so no special slice is needed."""
    _, scan1_nodes, scan2_nodes = run.default_fixture("devsecops", "sca")
    assert len(scan1_nodes) == 54
    assert len(scan2_nodes) == 27

    run.scan(
        "devsecops", "sca", scan1_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="sca-scan-1", scan_ts="2026-06-01T00:00:00Z",
        spark=spark,
    )
    result2 = run.scan(
        "devsecops", "sca", scan2_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="sca-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    tables = result2.tables

    assert spark.table(tables.scans).count() == 2
    scan2_row = spark.table(tables.scans).filter("scan_id = 'sca-scan-2'").collect()[0]
    assert scan2_row["resolved_count"] > 0

    disappeared_count = spark.table(tables.ledger).filter("resolution_src = 'disappeared'").count()
    assert disappeared_count > 0

    scan_ids = {r["scan_id"] for r in spark.table(tables.mttr).select("scan_id").distinct().collect()}
    assert scan_ids == {"sca-scan-1", "sca-scan-2"}


# ------------------------------------------------------------------------------ devsecops / sast


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


def test_devsecops_sast_lands_null_then_a_real_birth_date(spark, lake_dir):
    """One scan of the committed capture (no ``createdAt`` anywhere in it) lands with
    ``first_detected_at`` NULL on every silver row. A second scan adding one synthetic node that
    DOES carry ``createdAt`` lands that row's ledger ``first_seen`` as that exact date -- not
    the scan timestamp -- because ``ledger.py`` prefers the API's own birth date over an
    observed one (``first_seen = coalesce(first_detected_at, scan_ts)``, ``ledger.py:409-432``).
    """
    _, scan1_nodes, _ = run.default_fixture("devsecops", "sast")
    assert len(scan1_nodes) == 40

    result1 = run.scan(
        "devsecops", "sast", scan1_nodes,
        lake=lake_dir, schema=SCHEMA, scan_id="sast-scan-1", scan_ts="2026-06-01T00:00:00Z",
        spark=spark,
    )
    tables = result1.tables

    scan1_silver = spark.table(tables.silver).filter("scan_id = 'sast-scan-1'")
    assert scan1_silver.count() == 40
    assert scan1_silver.filter("first_detected_at IS NOT NULL").count() == 0

    created_at = "2026-05-15T00:00:00Z"
    synthetic = _synthetic_sast_node(
        scan1_nodes[0], node_id="devlake-synthetic-sast-1", created_at=created_at
    )
    result2 = run.scan(
        "devsecops", "sast", scan1_nodes + [synthetic],
        lake=lake_dir, schema=SCHEMA, scan_id="sast-scan-2", scan_ts="2026-06-02T00:00:00Z",
        spark=spark,
    )
    assert result2.tables == tables  # same scope, same run -- table identity should not move

    ledger_row = (
        spark.table(tables.ledger).filter("vuln_key = 'id:devlake-synthetic-sast-1'").collect()
    )
    assert len(ledger_row) == 1
    assert ledger_row[0]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == created_at

    # Every one of the 40 captured nodes still has no birth date of its own -- adding one
    # synthetic node must not have retroactively invented dates for the rest of the register.
    # Their `first_seen` stays the scan-1 timestamp (the observed fallback), unchanged by scan 2.
    original_first_seen = (
        spark.table(tables.ledger)
        .filter("vuln_key != 'id:devlake-synthetic-sast-1'")
        .select("first_seen")
        .distinct()
        .collect()
    )
    assert len(original_first_seen) == 1
    assert original_first_seen[0]["first_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T00:00:00Z"


# ------------------------------------------------------------------------- the fake's own shape


def test_fakewiz_refuses_a_bare_list_severity_for_sast():
    """The mutation this whole fake exists for: SAST's ``severity`` must arrive as
    ``{"equals": [...]}}``, not a bare list -- exactly the shape mismatch that once cost the
    entire SAST population (CLAUDE.md, "the same field name carries DIFFERENT KINDS"). Calling
    ``post`` directly with the wrong shape, rather than only ever exercising it through the real
    ``ingest.build_filter`` (which never gets this wrong today), is what proves the fake
    actually validates rather than merely tolerating whatever the pipeline happens to send.
    """
    run._ensure_fork_on_path("devsecops")
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
    wrapping it as ``{"equals": [...]}}`` is the sibling mistake CLAUDE.md names ("codeToCloud-
    PipelineStage sat in BASE as a literal and bypassed the table entirely")."""
    run._ensure_fork_on_path("devsecops")
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
    run._ensure_fork_on_path("devsecops")
    import ingest as ingest_module

    with pytest.raises(RuntimeError, match="unknown scope"):
        fakewiz.FakeWiz("not-a-real-scope", ingest_module, nodes=[])
