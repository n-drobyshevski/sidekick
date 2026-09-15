"""A local Spark+Delta lake for developing ``brick/`` off Databricks.

**Dev-only. Never deployed.** Nothing under ``devlake/`` ships to a cluster: the Asset Bundle
(``brick/databricks.yml``) points at ``brick/`` directly, and ``brick/requirements.txt`` names
nothing in here. This package exists so a laptop or a CI box with no workspace, no Unity
Catalog and no Databricks CLI can still run the real pipeline code end-to-end -- against real
Delta tables, at three-level names, surviving a process restart -- and inspect the result with
Jupyter or DuckDB.

``session.py`` builds the local ``SparkSession`` and puts ``brick/``'s flat module directory on
``sys.path`` (see its docstring for the one failure mode left: a stale import). ``lake.py``
re-registers a lake's
on-disk Delta tables under the session catalog on every boot, the same
``CREATE TABLE ... USING DELTA LOCATION`` recipe ``brick/README.md`` documents for moving a
register into a real catalog, and works around the one thing a local ``delta-spark`` cannot do:
parse a three-part name in its Python ``DeltaTable`` builder (see ``lake.precreate_clustered``).
"""

from __future__ import annotations
