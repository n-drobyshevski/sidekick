"""Getting at ``dbutils`` from inside a module, and off-cluster without it.

``dbutils`` is injected into a *notebook's* globals. An imported module has its own globals
and never sees it -- ``globals()["dbutils"]`` inside a library silently fails, which is the
kind of bug that only shows up on the cluster. The supported route is to build one from the
active session (``pyspark.dbutils`` exists only on Databricks), with the notebook's user
namespace as a fallback.

Every accessor here returns ``None``/``""`` rather than raising when there is no Databricks
around, so the same code imports and runs on a laptop and under pytest.
"""

from __future__ import annotations

import functools
from typing import Any, Optional


@functools.lru_cache(maxsize=1)
def get_dbutils() -> Optional[Any]:
    """The cluster's ``dbutils``, or ``None`` when not running on Databricks."""
    try:
        from pyspark.dbutils import DBUtils  # type: ignore[import-not-found]
        from pyspark.sql import SparkSession

        session = SparkSession.getActiveSession() or SparkSession.builder.getOrCreate()
        return DBUtils(session)
    except Exception:  # noqa: BLE001 -- not on Databricks; try the notebook namespace
        pass
    try:
        from IPython import get_ipython  # type: ignore[import-not-found]

        return get_ipython().user_ns["dbutils"]
    except Exception:  # noqa: BLE001 -- not in a notebook either
        return None


def widget(name: str) -> str:
    """A widget value, or ``""`` when there is no widget (or no Databricks) by that name."""
    dbutils = get_dbutils()
    if dbutils is None:
        return ""
    try:
        return dbutils.widgets.get(name) or ""
    except Exception:  # noqa: BLE001 -- widget not defined for this run
        return ""


def secret_value(scope: Optional[str], key: str) -> str:
    """A secret, or ``""`` when the scope/key is not readable from here."""
    if not scope:
        return ""
    dbutils = get_dbutils()
    if dbutils is None:
        return ""
    try:
        return dbutils.secrets.get(scope=scope, key=key) or ""
    except Exception:  # noqa: BLE001 -- missing scope/key, or no permission on it
        return ""
