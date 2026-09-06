"""A local Spark+Delta lake for developing ``brick/`` and ``brick/devsecops/`` off Databricks.

**Dev-only. Never deployed.** Nothing under ``devlake/`` ships to a cluster: the Asset Bundle
(``brick/databricks.yml``) points at the fork directories directly, and neither fork's
``requirements.txt`` names anything in here. This package exists so a laptop or a CI box with no
workspace, no Unity Catalog and no Databricks CLI can still run the real pipeline code
end-to-end -- against real Delta tables, at three-level names, surviving a process restart --
and inspect the result with Jupyter or DuckDB.

``session.py`` builds the local ``SparkSession`` and puts exactly one fork's flat module
directory on ``sys.path`` (never both -- see its docstring). ``lake.py`` re-registers a lake's
on-disk Delta tables under the session catalog on every boot, the same
``CREATE TABLE ... USING DELTA LOCATION`` recipe ``brick/README.md`` documents for moving a
register into a real catalog, and works around the one thing a local ``delta-spark`` cannot do:
parse a three-part name in its Python ``DeltaTable`` builder (see ``lake.precreate_clustered``).
"""

from __future__ import annotations
