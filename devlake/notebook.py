"""IPython/``dbutils`` shims that let the shipped notebooks run under a plain Jupyter kernel.

A Databricks notebook process gets four things for free that a local ``ipython``/``jupyter``
kernel does not: a ``dbutils`` object in its globals, a ``spark`` object in its globals,
``display``/``displayHTML`` builtins, and a ``%sql`` magic. ``brick/dbx.py``'s
``get_dbutils()`` already has a fallback for the first ("not on Databricks either -- try the
notebook namespace": ``get_ipython().user_ns["dbutils"]``), which is the seam this module fills
in from the other side -- it puts a fake ``dbutils`` (and ``spark``, ``display``,
``displayHTML``) into that same namespace, plus a ``%sql`` input transformer, so a shipped
notebook needs **no edit** to run here.

**Why a kernel *startup* mechanism, not a first cell.** ``brick/notebooks/*.ipynb`` cell 2 (the
boot cell) does read ``dbutils.widgets.get("module_path")`` inside its own ``try/except`` -- but
the very same cell also calls ``panels.context(spark, ...)``, and ``spark`` is a bare name with
no guard at all. A shim installed from *inside* a notebook cell -- a documented "run this first"
cell, or an input transformer that only ever rewrites ``%sql`` cells -- is already too late: cell
2 raises ``NameError`` on ``spark`` before either mechanism would run. The one thing early enough
is IPython's own startup sequence, which finishes before the kernel accepts its first
``execute_request``. See ``devlake/kernel_startup.py`` and ``devlake/README.md``.
"""

from __future__ import annotations

import importlib
import os
from typing import Any, Dict, Optional

#: Prefix for the per-widget environment override -- ``WIDGET_CATALOG=spark_catalog`` beats
#: whatever a caller seeded ``FakeWidgets`` with for ``catalog``. Upper-cased widget name, same
#: convention ``run_pipeline.param``'s own env fallback uses (``NAME.upper()``).
_ENV_PREFIX = "WIDGET_"


class FakeWidgets:
    """A ``dbutils.widgets`` stand-in, seeded from a dict and overridable by ``WIDGET_<NAME>``.

    Mirrors the one piece of real widget behaviour every notebook here actually depends on
    (``panels.BASE_WIDGETS``'s own docstring: "a widget that already exists keeps its old
    value") -- :meth:`text` and :meth:`dropdown` only set a value that is not already there, so
    a widget seeded (or env-overridden) before the notebook's own ``declare_widgets`` call keeps
    that value rather than being reset to the notebook's default.
    """

    def __init__(self, seed: Optional[Dict[str, Any]] = None) -> None:
        self._values: Dict[str, str] = {name: str(v) for name, v in (seed or {}).items()}
        for key, value in os.environ.items():
            if key.startswith(_ENV_PREFIX):
                self._values[key[len(_ENV_PREFIX) :].lower()] = value

    def text(self, name: str, defaultValue: str = "", label: Optional[str] = None) -> None:
        self._values.setdefault(name, str(defaultValue))

    def dropdown(
        self, name: str, defaultValue: str = "", choices: Any = (), label: Optional[str] = None
    ) -> None:
        self._values.setdefault(name, str(defaultValue))

    def get(self, name: str) -> str:
        if name not in self._values:
            raise KeyError(f"no widget named {name!r} is defined")
        return self._values[name]

    def remove(self, name: str) -> None:
        self._values.pop(name, None)

    def removeAll(self) -> None:
        self._values.clear()


class FakeSecrets:
    """A ``dbutils.secrets`` stand-in: ``get(scope, key)`` reads ``SECRET_<SCOPE>_<KEY>``.

    Nothing in the shipped read notebooks calls ``dbutils.secrets`` (only ``run_pipeline``'s own
    scan path does, through ``dbx.secret_value``, which this harness's fake Wiz transport
    bypasses entirely -- see ``devlake.fakewiz``) -- this exists so ``dbx.secret_value`` has
    something to call that behaves the documented way rather than crashing, if a notebook ever
    does read one.
    """

    def get(self, scope: Optional[str] = None, key: str = "") -> str:
        env_name = f"SECRET_{scope}_{key}".upper() if scope else f"SECRET_{key}".upper()
        value = os.environ.get(env_name)
        if value is None:
            raise KeyError(f"no secret for scope={scope!r} key={key!r} (env {env_name})")
        return value


class FakeDbutils:
    """The whole fake ``dbutils`` object: just the two namespaces real code reaches for."""

    def __init__(self, widgets: FakeWidgets, secrets: FakeSecrets) -> None:
        self.widgets = widgets
        self.secrets = secrets


def split_sql_cell(text: str) -> Optional[str]:
    """The ``%sql`` cell rule -- shared with ``brick/tests/test_notebooks.py::sql_cells`` so the
    two can never drift apart. A cell is SQL exactly when its whole text starts with the literal
    ``"%sql"``; the query is everything after the first newline. In every shipped notebook that
    means a first line of exactly ``%sql`` followed by the query on the rest of the cell --
    verified over both forks' notebooks by
    ``devlake/tests/test_notebook_shims.py::test_the_sql_transformer_splits_exactly_as_the_notebook_test_does``.
    """
    if not text.startswith("%sql"):
        return None
    return text.split("\n", 1)[1]


def _rewrite_sql_lines(lines):
    """An ``input_transformers_cleanup`` entry: a ``%sql``-led cell becomes one call to
    ``display(spark.sql(...))``. Anything else passes through untouched."""
    text = "".join(lines)
    sql = split_sql_cell(text)
    if sql is None:
        return lines
    # Triple-quoted, per the shim's documented rewrite -- falling back to repr() only for the
    # pathological case of a query that itself contains `"""`, which no shipped `%sql` cell does
    # (devlake/tests/test_notebook_shims.py checks every one).
    literal = f'"""{sql}"""' if '"""' not in sql else repr(sql)
    return [f"display(spark.sql({literal}))\n"]


def _make_display(limit: int = 1000):
    """``display`` -- a Spark DataFrame renders as its first ``limit`` rows via pandas; anything
    else (a plain string, a dict, a pandas frame already) passes straight to
    ``IPython.display.display``, the same "pass-through otherwise" ``figures.render`` already
    relies on via ``displayHTML``."""

    def display(obj: Any) -> None:
        from IPython.display import display as ipy_display

        try:
            from pyspark.sql import DataFrame as SparkDataFrame
        except ImportError:  # pragma: no cover -- pyspark always installed where this runs
            SparkDataFrame = ()  # type: ignore[assignment]

        if isinstance(obj, SparkDataFrame):
            ipy_display(obj.limit(limit).toPandas())
        else:
            ipy_display(obj)

    return display


def _display_html(html: str) -> None:
    from IPython.display import HTML, display as ipy_display

    ipy_display(HTML(html))


def install(ip=None, *, widgets: Dict[str, Any], spark: Any) -> None:
    """Put ``dbutils``, ``spark``, ``display`` and ``displayHTML`` into ``ip``'s user
    namespace, and register the ``%sql`` transformer.

    ``ip`` defaults to ``IPython.get_ipython()`` -- the running kernel/shell -- and this raises
    if there is none (there is nothing to install into).

    ``dbx.get_dbutils.cache_clear()`` is called on whichever fork's ``dbx`` module is importable
    -- imported by the bare name ``dbx``, which resolves against whichever fork
    ``devlake.session.put_fork_on_path`` most recently put on ``sys.path`` (never both forks at
    once; see that module's own docstring). This is needed because ``get_dbutils`` is
    ``functools.lru_cache(maxsize=1)``-decorated: a call made before this shim was installed
    (or under a fork that has since switched) would otherwise keep serving its first, possibly
    ``None``, answer forever within this process.
    """
    if ip is None:
        from IPython import get_ipython

        ip = get_ipython()
    if ip is None:
        raise RuntimeError(
            "devlake.notebook.install needs a running IPython shell -- get_ipython() returned "
            "None. Call this from inside an IPython/ipykernel process, not a plain script."
        )

    dbutils = FakeDbutils(FakeWidgets(widgets), FakeSecrets())
    ip.user_ns["dbutils"] = dbutils
    ip.user_ns["spark"] = spark
    ip.user_ns["display"] = _make_display()
    ip.user_ns["displayHTML"] = _display_html

    try:
        dbx_module = importlib.import_module("dbx")
    except ImportError:
        dbx_module = None
    if dbx_module is not None and hasattr(dbx_module, "get_dbutils"):
        dbx_module.get_dbutils.cache_clear()

    if _rewrite_sql_lines not in ip.input_transformers_cleanup:
        ip.input_transformers_cleanup.append(_rewrite_sql_lines)


def load_ipython_extension(ip) -> None:
    """``%load_ext devlake.notebook`` -- build the lake session and install the shim, reading
    everything it needs from the environment so the notebook itself needs no new widget:

    * ``DEVLAKE_LAKE`` (required) -- the warehouse directory a prior ``devlake.run.scan`` (or
      ``python -m devlake.run``) wrote.
    * ``DEVLAKE_SCHEMA`` (default ``wiz``) -- the schema to reregister and hand to ``panels``'s
      ``schema`` widget.
    * ``DEVLAKE_FORK`` (default ``brick``) -- which fork's flat module directory goes on
      ``sys.path`` (see ``devlake.session.put_fork_on_path``).

    Widget values themselves (``catalog``, ``schema``, ``scope``, ...) are seeded through
    ``WIDGET_<NAME>`` env vars, read by :class:`FakeWidgets` directly -- this function passes an
    empty seed dict and lets that mechanism do the work, so a caller that only has env vars to
    set (a kernel launched by ``nbclient``, a shell) never needs to touch this module's Python
    API at all.
    """
    lake_dir = os.environ.get("DEVLAKE_LAKE")
    if not lake_dir:
        raise RuntimeError(
            "DEVLAKE_LAKE must be set before `%load_ext devlake.notebook` -- point it at a "
            "lake directory a prior `python -m devlake.run` (or devlake.run.scan) wrote."
        )
    schema = os.environ.get("DEVLAKE_SCHEMA", "wiz")
    fork = os.environ.get("DEVLAKE_FORK", "brick")

    from devlake import lake as lake_module, session as devlake_session

    devlake_session.put_fork_on_path(fork)
    spark = devlake_session.build(lake_dir, app_name=f"devlake-notebook-{fork}")
    lake_module.reregister(spark, lake_dir, schema)

    install(ip, widgets={}, spark=spark)
