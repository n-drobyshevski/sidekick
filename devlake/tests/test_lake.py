"""Does a local lake survive a session restart, and does the session refuse both forks?

``test_a_table_survives_a_session_restart`` is the one this whole package exists for: a table
created by one process has to be readable, MERGE-able, and physically unchanged (same
clustering, same deletion-vector property) after the process that created it is gone and a new
one has booted against the same directory. Everything else here pins the smaller guarantees
``devlake.session`` and ``devlake.lake`` make along the way.
"""

from __future__ import annotations

import contextlib
import importlib.metadata
import importlib.util
import re
import sys
import types
from pathlib import Path

import pytest

pytest.importorskip("pyspark")
pytest.importorskip("delta")

from devlake import lake, session as devlake_session  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]


# ------------------------------------------------------------------------- the restart itself


def test_a_table_survives_a_session_restart(tmp_path_factory):
    """Build session A, write to a three-level ledger, stop it. Build session B on the same
    directory, reregister, and check the table came back whole.

    **Measured: in-process, not subprocess.** ``SparkSession.stop()`` tears down the Spark
    *application* (the ``SparkContext``), but the py4j gateway JVM that ``pyspark`` launched
    stays up for the life of the Python process -- so a second ``SparkSession.builder.getOrCreate()``
    after ``stop()`` starts a fresh ``SparkContext`` in that same JVM rather than needing a new
    OS process. That is measured here, not assumed: this test runs session A to completion,
    stops it, and only then builds session B, in the same pytest process, with no
    ``subprocess`` involved -- and it passes. If a future pyspark version tears the gateway down
    on ``stop()`` too, this test is what would catch it, and the fix is a small
    ``subprocess``-run script repeating these same steps.

    This test intentionally does not use the shared ``spark``/``lake_dir`` fixtures in
    ``conftest.py`` -- it manages its own session lifecycle, and does so before either fixture
    is first requested by a later test in this module (see ``conftest.spark``'s docstring), so
    there is exactly one live ``SparkSession`` at any moment and never a collision over the one
    JVM this whole test box is asked to run.
    """
    lake_dir = tmp_path_factory.mktemp("restart_lake")
    devlake_session.put_fork_on_path("brick")
    import ledger as ledger_mod
    import run_pipeline

    namespace = lake.namespace("wiz")
    tables = run_pipeline.resolve_tables(namespace, "os", argv=[])
    field_names = [f.name for f in ledger_mod.LEDGER_SCHEMA.fields]

    def ledger_row(vuln_key: str, **overrides) -> dict:
        row = {name: None for name in field_names}
        row["vuln_key"] = vuln_key
        row.update(overrides)
        return row

    # ---------------------------------------------------------------------------- session A
    spark_a = devlake_session.build(lake_dir, app_name="devlake-restart-a")
    try:
        spark_a.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")
        created = lake.precreate_clustered(spark_a, run_pipeline, tables)
        # `create_clustered`'s builder cannot parse a three-level name at all (see lake.py's
        # docstring) -- this is the DDL stand-in, and both `ledger` and `bronze` have a
        # declared schema to precreate with. `silver` does not, and is absent from `created`.
        assert set(created) == {tables.ledger, tables.bronze}

        rows = [
            ledger_row("restart-cve-a", scope="os", status="OPEN", severity="HIGH"),
            ledger_row("restart-cve-b", scope="os", status="OPEN", severity="CRITICAL"),
        ]
        spark_a.createDataFrame(rows, ledger_mod.LEDGER_SCHEMA).write.format("delta").mode(
            "append"
        ).saveAsTable(tables.ledger)
        assert spark_a.table(tables.ledger).count() == 2
    finally:
        spark_a.stop()

    # ---------------------------------------------------------------------------- session B
    spark_b = devlake_session.build(lake_dir, app_name="devlake-restart-b")
    try:
        # A fresh session's catalog knows nothing of what A wrote -- it lives and dies with the
        # session (no enableHiveSupport()). The Delta log on disk is untouched; reregister is
        # what makes the catalog agree with it again.
        with pytest.raises(Exception):
            spark_b.table(tables.ledger)

        registered = lake.reregister(spark_b, lake_dir, "wiz")
        assert set(registered) >= {tables.ledger, tables.bronze}

        ledger_df = spark_b.table(tables.ledger)
        assert ledger_df.count() == 2
        assert {r["vuln_key"] for r in ledger_df.collect()} == {
            "restart-cve-a",
            "restart-cve-b",
        }

        detail = spark_b.sql(f"DESCRIBE DETAIL {tables.ledger}").collect()[0]
        assert detail["clusteringColumns"] == ["vuln_key"]
        assert detail["properties"]["delta.enableDeletionVectors"] == "true"

        # And the reregistered table still takes a MERGE -- reregistration only changed a
        # catalog entry, not the Delta log the MERGE needs to read.
        spark_b.createDataFrame(
            [
                ledger_row("restart-cve-a", scope="os", status="RESOLVED", severity="HIGH"),
                ledger_row("restart-cve-c", scope="os", status="OPEN", severity="LOW"),
            ],
            ledger_mod.LEDGER_SCHEMA,
        ).createOrReplaceTempView("_restart_src")
        spark_b.sql(
            f"MERGE INTO {tables.ledger} AS target USING _restart_src AS source "
            f"ON target.vuln_key = source.vuln_key "
            f"WHEN MATCHED THEN UPDATE SET status = source.status "
            f"WHEN NOT MATCHED THEN INSERT *"
        )
        merged = spark_b.table(tables.ledger)
        assert merged.count() == 3
        assert (
            merged.filter("vuln_key = 'restart-cve-a'").collect()[0]["status"] == "RESOLVED"
        )
    finally:
        spark_b.stop()


# ---------------------------------------------------------------------------- the fork guard


def test_the_session_refuses_both_forks_on_the_path(monkeypatch):
    """Both ways a mix can happen: the other fork's directory already on ``sys.path``, and a
    fork module already imported from a different directory."""
    monkeypatch.syspath_prepend(str(devlake_session.FORKS["devsecops"]))
    with pytest.raises(RuntimeError, match="devsecops.*already on it"):
        devlake_session.put_fork_on_path("brick")

    monkeypatch.undo()  # clean sys.path before the second scenario

    fake_config = types.SimpleNamespace(
        __file__=str(devlake_session.FORKS["devsecops"] / "config.py")
    )
    monkeypatch.setitem(sys.modules, "config", fake_config)
    with pytest.raises(RuntimeError, match="config.*already imported"):
        devlake_session.put_fork_on_path("brick")


# --------------------------------------------------------------------------- the jar pin(s)


def test_the_jar_coordinate_matches_the_installed_package():
    installed = importlib.metadata.version("delta-spark")
    assert devlake_session.jar_coordinate() == f"io.delta:delta-spark_2.12:{installed}"


@contextlib.contextmanager
def _isolated_sys_path():
    """Swap out ``sys.path`` for a throwaway copy for the duration of the block.

    Loading a fork's ``conftest.py`` by file path runs its module-level
    ``sys.path.insert(0, str(BRICK_DIR))`` -- exactly the sys.path mutation
    ``devlake.session.put_fork_on_path`` exists to police, and permanent here would let this
    file's own fork-guard test start failing depending on what ran before it. Reassigning
    ``sys.path`` to a copy means that ``insert`` call (looked up as ``sys.path`` at the moment
    it runs) mutates the copy, not the list every other import in this process shares; the
    ``finally`` restores the original object.
    """
    original = sys.path
    sys.path = list(original)
    try:
        yield
    finally:
        sys.path = original


def _load_by_path(name: str, path: Path):
    """``brick/devsecops/tests/test_fork_integrity.py::upstream()``'s pattern, generalised."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with _isolated_sys_path():
        spec.loader.exec_module(module)
    return module


def test_the_fork_conftests_pin_the_same_delta_line():
    """Both fork ``conftest.py`` files hardcode ``DELTA_PACKAGE``; the installed ``delta-spark``
    has to be the same release LINE.

    Not exact equality: the jar bump from 3.3.2 to match the installed 3.3.3 patch is a
    separate step, tracked, not done here. This only pins that nobody has drifted onto a
    different MAJOR.MINOR line -- 3.2 vs 3.3, say -- which would be the real breakage
    (``brick/tests/conftest.py``'s own comment: 3.2 cannot cluster the ledger by one column).
    """
    installed = importlib.metadata.version("delta-spark")
    installed_line = ".".join(installed.split(".")[:2])

    for label, conftest_path in (
        ("brick", REPO_ROOT / "brick" / "tests" / "conftest.py"),
        ("devsecops", REPO_ROOT / "brick" / "devsecops" / "tests" / "conftest.py"),
    ):
        module = _load_by_path(f"_devlake_conftest_{label}", conftest_path)
        match = re.search(r"delta-spark_2\.12:([\d.]+)", module.DELTA_PACKAGE)
        assert match, f"{conftest_path} has no DELTA_PACKAGE coordinate to read"
        pinned_line = ".".join(match.group(1).split(".")[:2])
        assert pinned_line == installed_line, (
            f"{conftest_path} pins {module.DELTA_PACKAGE!r} ({pinned_line}), which is not the "
            f"same delta-spark line as the installed {installed} ({installed_line})"
        )


# ------------------------------------------------------------------------------ reregister


def test_reregister_only_registers_delta_directories(spark, lake_dir):
    """A stray non-Delta directory under ``<schema>.db/`` is ignored, not registered."""
    schema = "stray_probe"
    namespace = lake.namespace(schema)
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")
    spark.createDataFrame([(1,)], "n INT").write.format("delta").saveAsTable(
        f"{namespace}.real_table"
    )

    schema_dir = Path(lake_dir) / f"{schema}.db"
    stray_dir = schema_dir / "not_a_delta_table"
    stray_dir.mkdir(parents=True, exist_ok=True)
    (stray_dir / "data.csv").write_text("a,b\n1,2\n")

    dirs = lake.table_dirs(lake_dir, schema)
    assert [d.name for d in dirs] == ["real_table"]

    registered = lake.reregister(spark, lake_dir, schema)
    assert registered == [f"{namespace}.real_table"]
    assert not any("not_a_delta_table" in name for name in registered)
