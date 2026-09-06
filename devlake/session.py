"""A local Spark+Delta session, built the same way ``brick/tests/conftest.py`` builds one.

Two things a Databricks cluster does for free and a laptop has to do by hand:

* **The jar has to match the installed package.** ``delta-spark`` and its ``io.delta:...`` jar
  are one release -- the Python wheel and the Ivy coordinate ship together -- so the coordinate
  is *derived* from whatever ``delta-spark`` pip installed (:func:`jar_coordinate`) rather than
  hardcoded. A lagging hardcoded pin is exactly what broke ``csvstore`` restore under Spark
  3.5.9 (see the fork conftests' own comments); deriving it makes that class of drift
  impossible rather than merely documented.
* **Exactly one fork's flat module directory may be on ``sys.path``.** ``brick/`` and
  ``brick/devsecops/`` both define ``config``, ``ingest``, ``run_pipeline``, and so on -- the
  same names, different files. Whichever directory a bare ``import run_pipeline`` resolves
  against first decides which pipeline runs, silently. :func:`put_fork_on_path` refuses to
  create that situation; see its docstring, and
  ``brick/devsecops/tests/test_fork_integrity.py`` for the same guard enforced the other way
  (both fork *conftests* insert their own directory and never the other's).
"""

from __future__ import annotations

import importlib.metadata
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pyspark.sql import SparkSession

#: This file lives at ``<repo root>/devlake/session.py``.
REPO_ROOT = Path(__file__).resolve().parents[1]

#: The two forks that may go on ``sys.path``, by name. Exactly one at a time -- see
#: ``put_fork_on_path``. Values are directories, not packages: both forks are flat module
#: folders with no ``__init__.py``, imported by putting the directory itself on ``sys.path``.
FORKS = {
    "brick": REPO_ROOT / "brick",
    "devsecops": REPO_ROOT / "brick" / "devsecops",
}

#: Every top-level module name a fork defines. Shared between the two forks by construction --
#: that is what makes mixing them possible and what this list exists to detect.
FORK_MODULE_NAMES = (
    "config",
    "dbx",
    "ingest",
    "ledger",
    "metrics",
    "run_pipeline",
    "csvstore",
    "panels",
    "figures",
    "tiles",
)


def jar_coordinate() -> str:
    """The Ivy coordinate for the ``delta-spark`` package actually installed.

    ``delta-spark`` X.Y.Z always pairs with jar ``io.delta:delta-spark_2.12:X.Y.Z`` -- the PyPI
    release and the Maven release are the same release under two package managers. Reading the
    version off the installed package (rather than restating it as a literal, the way both fork
    ``conftest.py`` modules still do) is what keeps this file from being the next place a pin
    goes stale.
    """
    return f"io.delta:delta-spark_2.12:{importlib.metadata.version('delta-spark')}"


def put_fork_on_path(fork: str) -> Path:
    """Put ``FORKS[fork]`` on ``sys.path`` -- and refuse if that would let two forks mix.

    Two ways a mix happens, and both are checked before anything is inserted:

    1. **The other fork's directory is already on ``sys.path``.** Whichever one comes first in
       ``sys.path`` order wins a bare ``import config``, and the loser is invisible -- no error,
       just the wrong pipeline.
    2. **A fork module is already imported from a different directory.** This catches the case
       the first check cannot: something imported ``run_pipeline`` from ``brick/`` directly
       (without going through ``sys.path`` insertion this function controls -- a prior test
       module, a notebook cell, a stale ``sys.modules`` entry) and this call is now trying to
       serve ``devsecops``. Once a module is in ``sys.modules`` a plain ``import`` never looks
       at ``sys.path`` again, so the check has to be on the loaded module's own ``__file__``.

    Repo root is *appended* (never inserted) once this succeeds, so ``devlake`` itself stays
    importable without ever outranking either fork's directory for a bare module name.
    """
    if fork not in FORKS:
        raise RuntimeError(f"unknown fork {fork!r} -- expected one of {sorted(FORKS)}")
    fork_dir = FORKS[fork].resolve()
    other_forks = {name: path.resolve() for name, path in FORKS.items() if name != fork}

    for entry in sys.path:
        if not entry:
            continue
        entry_resolved = Path(entry).resolve()
        for other_name, other_dir in other_forks.items():
            if entry_resolved == other_dir:
                raise RuntimeError(
                    f"refusing to put {fork!r} ({fork_dir}) on sys.path: {other_name!r}'s "
                    f"directory ({other_dir}) is already on it. A sys.path holding both forks "
                    f"resolves a bare `import config` (or run_pipeline, ledger, ...) to "
                    f"whichever came first -- half of one pipeline and half of the other, with "
                    f"no error. See brick/devsecops/tests/test_fork_integrity.py, 'the two can "
                    f"be mixed'."
                )

    for name in FORK_MODULE_NAMES:
        module = sys.modules.get(name)
        module_file = getattr(module, "__file__", None) if module is not None else None
        if module_file is None:
            continue
        module_dir = Path(module_file).resolve().parent
        if module_dir != fork_dir:
            raise RuntimeError(
                f"refusing to put {fork!r} on sys.path: module {name!r} is already imported "
                f"from {module_file}, under {module_dir}, not from {fork_dir}. Once a module "
                f"name is in sys.modules a bare `import {name}` never consults sys.path again, "
                f"so the wrong fork would keep serving that one name silently."
            )

    sys.path.insert(0, str(fork_dir))
    repo_root = str(REPO_ROOT)
    if repo_root not in sys.path:
        sys.path.append(repo_root)
    return fork_dir


def build(
    lake: "Path | str", *, driver_memory: str = "2g", app_name: str = "devlake"
) -> "SparkSession":
    """A Delta-enabled local ``SparkSession`` whose warehouse is ``lake``.

    Mirrors ``brick/tests/conftest.py``'s ``spark`` fixture (lines 60-130): ``PYSPARK_SUBMIT_ARGS``
    and ``SPARK_LOCAL_IP`` are set *before* ``pyspark`` is imported, because ``--packages`` is
    read by ``spark-submit`` when the JVM launches and cannot be added to one already running --
    the same reasoning that comment gives, restated here because this file has no fixture body
    to hide it in. The builder config is the same session shape: ``spark_catalog`` wired to
    ``DeltaCatalog``, UTC, single-partition test economics.

    ``spark.sql.warehouse.dir=<lake>`` is what makes a managed table land at
    ``<lake>/<schema>.db/<table>`` -- Spark's own warehouse convention, and the directory shape
    ``lake.reregister`` walks back in.

    A JVM can only host one ``SparkSession`` (one ``SparkContext`` per process), and
    ``getOrCreate()`` silently hands back whatever session already exists rather than building a
    new one against a different warehouse. That would make a second ``build()`` call quietly
    keep serving the first lake, so an active session pointed at a *different* warehouse is a
    refusal, not a fall-through; stop it first.
    """
    lake = Path(lake).resolve()

    # Must happen before the first `import pyspark` anywhere in this process -- see the
    # docstring above and brick/tests/conftest.py's identical placement.
    os.environ.setdefault(
        "PYSPARK_SUBMIT_ARGS",
        f"--packages {jar_coordinate()} --driver-memory {driver_memory} pyspark-shell",
    )
    os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")

    from pyspark.sql import SparkSession

    active = SparkSession.getActiveSession()
    if active is not None:
        active_warehouse = Path(active.conf.get("spark.sql.warehouse.dir", "")).resolve()
        if active_warehouse != lake:
            raise RuntimeError(
                f"a SparkSession is already active with warehouse {active_warehouse}, not "
                f"{lake} -- SparkSession.builder.getOrCreate() would silently hand that one "
                f"back instead of building this lake (a JVM hosts one SparkContext). Stop it "
                f"first: the existing session's .stop(), then call devlake.session.build() "
                f"again."
            )
        return active

    builder = (
        SparkSession.builder.master("local[1]")
        .appName(app_name)
        .config("spark.sql.warehouse.dir", str(lake))
        # Capacity buckets by UTC calendar month and MTTR is a UTC-to-UTC difference, exactly
        # as the pipeline sets it.
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
        .config("spark.sql.adaptive.enabled", "false")
        .config("spark.default.parallelism", "1")
        .config("spark.rdd.compress", "false")
        .config("spark.databricks.delta.snapshotPartitions", "1")
        .config("spark.ui.showConsoleProgress", "false")
        .config("spark.ui.retainedJobs", "1")
        .config("spark.ui.retainedStages", "1")
        .config("spark.ui.retainedTasks", "1")
        .config("spark.sql.ui.retainedExecutions", "1")
    )
    return builder.getOrCreate()
