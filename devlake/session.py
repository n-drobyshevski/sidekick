"""A local Spark+Delta session, built the same way ``brick/tests/conftest.py`` builds one.

Two things a Databricks cluster does for free and a laptop has to do by hand:

* **The jar has to match the installed package.** ``delta-spark`` and its ``io.delta:...`` jar
  are one release -- the Python wheel and the Ivy coordinate ship together -- so the coordinate
  is *derived* from whatever ``delta-spark`` pip installed (:func:`jar_coordinate`) rather than
  hardcoded. A lagging hardcoded pin is exactly what broke ``csvstore`` restore under Spark
  3.5.9 (see ``brick/tests/conftest.py``'s own comments); deriving it makes that class of drift
  impossible rather than merely documented.
* **Only ``brick/``'s flat module directory may be on ``sys.path``.** There used to be a second
  tree here (``brick/devsecops/``, a fork defining the same module names -- ``config``,
  ``run_pipeline``, and so on) that a stray ``sys.path`` entry could resolve a bare
  ``import config`` against instead of ``brick/``'s own copy, silently. That fork is retired
  (S2-T4/T5): one tree, four scopes. What is still real on a flat Databricks workspace folder
  is a STALE IMPORT -- a ``sys.modules`` entry left behind from some other directory entirely
  (a prior test module, a notebook cell, an old checkout on ``sys.path`` ahead of this one) --
  and :func:`put_brick_on_path` still refuses that outright; see its docstring, and
  ``brick/tests/test_deployment_integrity.py`` for the same class of guard enforced again, at
  runtime, inside ``run_pipeline.check_deployment()``.
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

#: The one tree this package runs: a flat module folder with no ``__init__.py``, imported by
#: putting the directory itself on ``sys.path``. There used to be a second fork here
#: (``brick/devsecops/``); it is retired -- see this module's own docstring.
BRICK_DIR = REPO_ROOT / "brick"

#: Every top-level module name ``brick/`` defines. A stale ``sys.modules`` entry under one of
#: these names, pointing at some OTHER directory, resolves a bare ``import config`` (etc.) to
#: the wrong file with no error -- see :func:`put_brick_on_path`.
BRICK_MODULE_NAMES = (
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
    version off the installed package (rather than restating it as a literal, the way
    ``brick/tests/conftest.py`` still does) is what keeps this file from being the next place a
    pin goes stale.
    """
    return f"io.delta:delta-spark_2.12:{importlib.metadata.version('delta-spark')}"


def put_brick_on_path() -> Path:
    """Put ``brick/`` on ``sys.path`` -- and refuse if a module name it defines is already
    imported from somewhere else.

    With only one tree left there is nothing else on ``sys.path`` to mix it with, but a stale
    ``sys.modules`` entry is still a real failure mode: something imported ``run_pipeline`` (or
    ``config``, ``ledger``, ...) from a directory that is not ``brick/`` -- a prior test module
    loading a file by path, a notebook cell, an old checkout still on ``sys.path`` -- and once a
    module name is in ``sys.modules`` a plain ``import`` never looks at ``sys.path`` again, so
    the check has to be on the loaded module's own ``__file__``.

    Repo root is *appended* (never inserted) once this succeeds, so ``devlake`` itself stays
    importable without ever outranking ``brick/``'s directory for a bare module name.
    """
    brick_dir = BRICK_DIR.resolve()

    for name in BRICK_MODULE_NAMES:
        module = sys.modules.get(name)
        module_file = getattr(module, "__file__", None) if module is not None else None
        if module_file is None:
            continue
        module_dir = Path(module_file).resolve().parent
        if module_dir != brick_dir:
            raise RuntimeError(
                f"refusing to put brick/ on sys.path: module {name!r} is already imported "
                f"from {module_file}, under {module_dir}, not from {brick_dir}. Once a module "
                f"name is in sys.modules a bare `import {name}` never consults sys.path again, "
                f"so the wrong file would keep serving that one name silently."
            )

    if str(brick_dir) not in sys.path:
        sys.path.insert(0, str(brick_dir))
    repo_root = str(REPO_ROOT)
    if repo_root not in sys.path:
        sys.path.append(repo_root)
    return brick_dir


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
