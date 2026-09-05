"""``devlake.notebook``'s ``%sql`` transformer and ``dbutils`` shim, then the payoff: a shipped
notebook executed top to bottom in a real Jupyter kernel against a devlake lake, and a DuckDB
measurement of the clustered ledger it wrote.

The notebook-execution and DuckDB tests both build their own lake (``notebook_lake``, below) --
this file's own fixture, not ``test_end_to_end.py``'s ``e2e`` schema -- because the kernel that
runs the notebook is a *separate process* with its own JVM (see this module's own docstring on
memory) and needs the lake to already be on disk, complete, before it boots.
"""

from __future__ import annotations

import contextlib
import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip(
    "pyspark", reason="devlake tests need pyspark: pip install -r brick/requirements.txt"
)
pytest.importorskip(
    "delta", reason="devlake tests need delta-spark: pip install -r brick/requirements.txt"
)

from devlake import notebook as devlake_notebook  # noqa: E402
from devlake import run as devlake_run  # noqa: E402
from devlake import session as devlake_session  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
FORKS = {
    "brick": REPO_ROOT / "brick",
    "devsecops": REPO_ROOT / "brick" / "devsecops",
}


@contextlib.contextmanager
def _isolated_sys_path():
    """Swap ``sys.path`` for a throwaway copy for the duration of the block -- the same pattern
    ``test_lake.py``'s ``_load_by_path`` uses, needed here because loading a fork's own
    ``tests/test_notebooks.py`` runs its module-level ``sys.path.insert(0, str(BRICK_DIR))``."""
    original = sys.path
    sys.path = list(original)
    try:
        yield
    finally:
        sys.path = original


def _load_test_notebooks(fork: str):
    """The fork's own ``tests/test_notebooks.py``, loaded by path -- the oracle for the
    ``%sql`` rule, read from rather than reimplemented (``devlake.notebook.split_sql_cell``'s
    own docstring)."""
    path = FORKS[fork] / "tests" / "test_notebooks.py"
    spec = importlib.util.spec_from_file_location(f"_devlake_test_notebooks_{fork}", path)
    module = importlib.util.module_from_spec(spec)
    with _isolated_sys_path():
        spec.loader.exec_module(module)
    return module


# ------------------------------------------------------------------------ the %sql transformer


def test_the_sql_transformer_splits_exactly_as_the_notebook_test_does():
    """Over every ``.ipynb`` under both forks' ``notebooks/``, for every code cell:
    ``split_sql_cell`` agrees with ``test_notebooks.sql_cells`` on which cells are SQL, and the
    SQL bodies it extracts are identical."""
    sql_cells_seen = 0
    for fork in FORKS:
        upstream = _load_test_notebooks(fork)
        for notebook_path in upstream.NOTEBOOKS:
            doc = upstream.load(notebook_path)
            oracle_sql = {id(cell): query for cell, query in upstream.sql_cells(doc)}
            for cell in upstream.cells(doc, "code"):
                text = upstream.source(cell)
                got = devlake_notebook.split_sql_cell(text)
                expected = oracle_sql.get(id(cell))
                assert (got is not None) == (expected is not None), (
                    f"{fork}/{notebook_path.name}: split_sql_cell disagrees with sql_cells on "
                    f"cell starting {text[:40]!r}"
                )
                if expected is not None:
                    sql_cells_seen += 1
                    assert got == expected, (
                        f"{fork}/{notebook_path.name}: SQL body differs from sql_cells' own"
                    )
    assert sql_cells_seen > 0, "no %sql cell found in either fork -- this check would be vacuous"


# -------------------------------------------------------------------------- widgets through dbx


def test_widgets_resolve_through_dbx():
    """With the shim installed in a real ``InteractiveShell.instance()`` (no kernel), the brick
    fork's ``dbx.widget`` resolves through it -- and ``cache_clear`` is exercised: a
    pre-install call that would otherwise cache ``None`` forever is not still cached afterwards.
    """
    from IPython.core.interactiveshell import InteractiveShell

    ip = InteractiveShell.instance()
    try:
        devlake_session.put_fork_on_path("brick")
        import dbx as dbx_module

        dbx_module.get_dbutils.cache_clear()
        assert dbx_module.get_dbutils() is None  # no shim yet, no real Databricks either

        devlake_notebook.install(
            ip, widgets={"catalog": "spark_catalog", "scope": "os"}, spark=object()
        )

        assert dbx_module.widget("catalog") == "spark_catalog"
        assert dbx_module.widget("scope") == "os"
        assert dbx_module.widget("not-a-real-widget") == ""

        # cache_clear ran as part of install(): the dbutils get_dbutils() now returns is the one
        # install() just put in user_ns, not the None it cached three lines up.
        assert dbx_module.get_dbutils() is ip.user_ns["dbutils"]
    finally:
        InteractiveShell.clear_instance()
        devlake_run.purge_fork_state()


def test_widget_env_override_beats_the_seed():
    """``WIDGET_<NAME>`` wins over whatever a caller seeded -- the mechanism
    ``load_ipython_extension`` relies on entirely (it seeds nothing itself)."""
    import os

    fake = devlake_notebook.FakeWidgets({"catalog": "seeded-value"})
    assert fake.get("catalog") == "seeded-value"

    os.environ["WIDGET_CATALOG"] = "env-value"
    try:
        fake2 = devlake_notebook.FakeWidgets({"catalog": "seeded-value"})
        assert fake2.get("catalog") == "env-value"
    finally:
        del os.environ["WIDGET_CATALOG"]

    # text()/dropdown() must not stomp a value that is already there (real dbutils' own rule).
    fake.text("catalog", "some-other-default")
    assert fake.get("catalog") == "seeded-value"
    fake.dropdown("scope", "all", ["os", "all"])
    assert fake.get("scope") == "all"
    fake.remove("scope")
    with pytest.raises(KeyError):
        fake.get("scope")


# ---------------------------------------------------------------------- a real lake to read

FIXTURE_LAKE_SCAN_IDS = ("nb-scan-1", "nb-scan-2")


@dataclass
class NotebookLake:
    lake_dir: Path
    tables: Any
    ledger_count: int
    open_count: int
    scans_count: int


@pytest.fixture(scope="module")
def notebook_lake(tmp_path_factory) -> NotebookLake:
    """Two brick/os scans through the real pipeline, in-process, then the session is stopped --
    freeing the JVM this fixture used before the notebook test boots a second one of its own
    (see this file's module docstring).

    Stops any session already active first. When this file runs as part of the whole
    ``devlake/tests`` suite, ``conftest.py``'s own session-scoped ``spark`` fixture (built by
    ``test_lake.py``, collected before this file alphabetically) is still alive at this point --
    session-scoped means "torn down at the end of the run", not "torn down at the end of its
    file" -- and it is pointed at a *different* warehouse directory, which
    ``devlake_session.build`` correctly refuses to silently reuse (see its own docstring). Since
    pytest runs files one at a time, nothing later in this run depends on that earlier session
    still being up, so stopping it here is safe.
    """
    from pyspark.sql import SparkSession

    active = SparkSession.getActiveSession()
    if active is not None:
        active.stop()

    lake_dir = tmp_path_factory.mktemp("notebook_lake")
    spark = devlake_session.build(lake_dir, app_name="devlake-notebook-fixture")
    try:
        _, scan1_nodes, scan2_nodes = devlake_run.default_fixture("brick", "os")
        devlake_run.scan(
            "brick", "os", scan1_nodes,
            lake=lake_dir, schema="wiz", scan_id=FIXTURE_LAKE_SCAN_IDS[0],
            scan_ts="2026-06-01T00:00:00Z", spark=spark,
        )
        result2 = devlake_run.scan(
            "brick", "os", scan2_nodes,
            lake=lake_dir, schema="wiz", scan_id=FIXTURE_LAKE_SCAN_IDS[1],
            scan_ts="2026-06-02T00:00:00Z", spark=spark,
        )
        tables = result2.tables
        ledger_count = spark.table(tables.ledger).count()
        open_count = spark.table(tables.ledger).filter("status = 'OPEN'").count()
        scans_count = spark.table(tables.scans).count()
    finally:
        spark.stop()
        devlake_run.purge_fork_state()
    return NotebookLake(lake_dir, tables, ledger_count, open_count, scans_count)


@pytest.fixture()
def ipythondir(tmp_path) -> Path:
    """A throwaway ``IPYTHONDIR`` whose ``profile_default/startup/`` holds a copy of
    ``devlake/kernel_startup.py`` -- the mechanism a real deployment wires in by pointing
    ``IPYTHONDIR`` at a directory that already has it there (see ``devlake/README.md``)."""
    startup_dir = tmp_path / "profile_default" / "startup"
    startup_dir.mkdir(parents=True)
    source = (Path(devlake_notebook.__file__).parent / "kernel_startup.py").read_text(
        encoding="utf-8"
    )
    (startup_dir / "00-devlake.py").write_text(source, encoding="utf-8")
    return tmp_path


def _kernel_env(monkeypatch, notebook_lake: NotebookLake, ipythondir: Path, **widgets) -> None:
    monkeypatch.setenv("DEVLAKE_LAKE", str(notebook_lake.lake_dir))
    monkeypatch.setenv("DEVLAKE_SCHEMA", "wiz")
    monkeypatch.setenv("DEVLAKE_FORK", "brick")
    monkeypatch.setenv("SPARK_LOCAL_IP", "127.0.0.1")
    monkeypatch.setenv("IPYTHONDIR", str(ipythondir))
    for name, value in widgets.items():
        monkeypatch.setenv(f"WIDGET_{name.upper()}", value)


# ---------------------------------------------------------------- the notebook actually runs


def test_a_shipped_notebook_executes_top_to_bottom(notebook_lake, ipythondir, monkeypatch):
    """``brick/notebooks/00_security_posture.ipynb``, executed by a real ``ipykernel`` kernel
    (a separate process, its own JVM) against the lake ``notebook_lake`` just wrote. No cell may
    error and at least one cell must produce an output.

    The kernel picks up the shim through ``IPYTHONDIR``'s startup file (``kernel_startup.py``),
    not through any change to the notebook itself -- see that file's docstring for why a
    per-cell mechanism is too late. Env vars reach the kernel subprocess because
    ``jupyter_client``'s own launch path defaults to ``env=os.environ`` when no explicit ``env``
    is passed (``KernelProvisionerBase.pre_launch``): setting them here, in this process, before
    the kernel is started is sufficient -- no ``kernel_manager_class`` override needed.
    """
    nbformat = pytest.importorskip("nbformat")
    nbclient_module = pytest.importorskip("nbclient")

    _kernel_env(
        monkeypatch, notebook_lake, ipythondir,
        catalog="spark_catalog", schema="wiz", scope="os",
    )

    notebook_path = REPO_ROOT / "brick" / "notebooks" / "00_security_posture.ipynb"
    nb = nbformat.read(notebook_path, as_version=4)

    client = nbclient_module.NotebookClient(
        nb,
        kernel_name="python3",
        allow_errors=False,
        timeout=600,
        resources={"metadata": {"path": str(notebook_path.parent)}},
    )
    client.execute()

    code_cells = [c for c in nb.cells if c.get("cell_type") == "code"]
    assert code_cells, "the executed notebook has no code cells at all"
    for cell in code_cells:
        for output in cell.get("outputs", []):
            assert output.get("output_type") != "error", (
                f"a cell errored despite allow_errors=False (should have raised already): "
                f"{output}"
            )
    assert any(cell.get("outputs") for cell in code_cells), (
        "every cell ran with no error, but not one produced an output"
    )


def test_measure_mttr_sla_notebook_also_runs(notebook_lake, ipythondir, monkeypatch):
    """Not required by the plan -- measured and reported. ``01_mttr_sla.ipynb`` is the one
    notebook with a ``%sql`` cell over ``v_mttr``, so a clean run here is also a second,
    independent confirmation that the transformer's rewrite is valid Python and valid SQL."""
    nbformat = pytest.importorskip("nbformat")
    nbclient_module = pytest.importorskip("nbclient")

    _kernel_env(
        monkeypatch, notebook_lake, ipythondir,
        catalog="spark_catalog", schema="wiz", scope="os",
    )

    notebook_path = REPO_ROOT / "brick" / "notebooks" / "01_mttr_sla.ipynb"
    nb = nbformat.read(notebook_path, as_version=4)

    client = nbclient_module.NotebookClient(
        nb,
        kernel_name="python3",
        allow_errors=False,
        timeout=600,
        resources={"metadata": {"path": str(notebook_path.parent)}},
    )
    try:
        client.execute()
    except Exception as exc:  # noqa: BLE001 -- informational measurement, not a gate
        pytest.skip(f"01_mttr_sla.ipynb did NOT run cleanly (measured, not required): {exc}")


# --------------------------------------------------------------- duckdb reads the clustered lake


def test_duckdb_reads_the_clustered_ledger_with_deletion_vectors(notebook_lake):
    """DuckDB's ``delta`` extension against the ledger (``CLUSTER BY``,
    ``delta.enableDeletionVectors=true`` -- reader v3) and, as a control, the scans log (no
    deletion vectors) -- so a failure on the ledger alone isolates to deletion vectors
    specifically rather than to ``delta_scan`` itself."""
    duckdb = pytest.importorskip("duckdb")

    ledger_table_name = notebook_lake.tables.ledger.split(".")[-1]
    scans_table_name = notebook_lake.tables.scans.split(".")[-1]
    ledger_path = (notebook_lake.lake_dir / "wiz.db" / ledger_table_name).resolve()
    scans_path = (notebook_lake.lake_dir / "wiz.db" / scans_table_name).resolve()

    con = duckdb.connect()
    con.execute("INSTALL delta")
    con.execute("LOAD delta")

    # Control: the scans log carries no deletion vectors at all.
    scans_count = con.execute(
        f"SELECT count(*) FROM delta_scan('file://{scans_path}')"
    ).fetchone()[0]
    assert scans_count == notebook_lake.scans_count, (
        f"duckdb {duckdb.__version__}: scans table row count differs from Spark's "
        f"({scans_count} vs {notebook_lake.scans_count}) -- delta_scan itself is suspect, not "
        "deletion vectors"
    )

    # The measurement this test exists for: the ledger, which DOES carry deletion vectors.
    try:
        ledger_count = con.execute(
            f"SELECT count(*) FROM delta_scan('file://{ledger_path}')"
        ).fetchone()[0]
    except Exception as exc:  # noqa: BLE001 -- the failure IS the measurement; report it plainly
        pytest.fail(
            f"duckdb {duckdb.__version__} could not read the deletion-vector-enabled ledger "
            f"table at {ledger_path}: {exc!r}. The scans table (no deletion vectors) read fine "
            f"above ({scans_count} rows), so this isolates the failure to deletion vectors, not "
            "delta_scan or the lake in general."
        )
    assert ledger_count == notebook_lake.ledger_count, (
        f"duckdb {duckdb.__version__}: ledger row count differs from Spark's "
        f"({ledger_count} vs {notebook_lake.ledger_count})"
    )

    open_count = con.execute(
        f"SELECT count(*) FROM delta_scan('file://{ledger_path}') WHERE status = 'OPEN'"
    ).fetchone()[0]
    assert open_count == notebook_lake.open_count, (
        f"duckdb {duckdb.__version__}: OPEN row count differs from Spark's "
        f"({open_count} vs {notebook_lake.open_count})"
    )
