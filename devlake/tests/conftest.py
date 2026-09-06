"""One local lake, one Spark session, for the whole ``devlake`` test suite.

Excluded from the root ``pyproject.toml``'s ``testpaths = ["tests"]`` on purpose -- this
directory is a harness for developing the two forks, not part of either fork's own suite -- so
it is run explicitly: ``python3 -m pytest devlake/tests -q``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
DEVLAKE_DIR = TESTS_DIR.parent
REPO_ROOT = DEVLAKE_DIR.parent
#: Needed so ``import devlake`` and ``import devlake.session`` resolve -- pytest's rootdir
#: auto-insertion puts *this* directory on sys.path (it has no ``__init__.py``), not the repo
#: root above it.
sys.path.insert(0, str(REPO_ROOT))

pytest.importorskip(
    "pyspark", reason="devlake tests need pyspark: pip install -r brick/requirements.txt"
)
pytest.importorskip(
    "delta", reason="devlake tests need delta-spark: pip install -r brick/requirements.txt"
)

from devlake import session as devlake_session  # noqa: E402


@pytest.fixture(scope="session")
def lake_dir(tmp_path_factory):
    """A fresh warehouse directory, shared by every test that does not need its own session."""
    return tmp_path_factory.mktemp("lake")


@pytest.fixture(scope="session")
def spark(lake_dir):
    """The one shared local session, with ``brick`` (not ``devsecops``) on ``sys.path``.

    Session-scoped like the fork suites' own ``spark`` fixture, for the same reason: Delta's
    extensions and jars can only be set when the JVM launches, so whichever test asked for a
    session first would otherwise decide whether the whole run has Delta at all.

    ``test_a_table_survives_a_session_restart`` deliberately does **not** use this fixture --
    it builds and stops its own sessions to test the restart itself, and does so before this
    fixture is first requested (pytest collects this module top-to-bottom and fixtures are
    lazy), so there is never a live session for it to collide with.
    """
    devlake_session.put_fork_on_path("brick")
    session = devlake_session.build(lake_dir, driver_memory="2g")
    yield session
    session.stop()
