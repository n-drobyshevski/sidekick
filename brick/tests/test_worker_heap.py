"""``_driver_memory`` in ``conftest.py`` has to be computed in the process that will use it.

Measured defect: ``conftest.py`` used to size the driver heap from
``PYTEST_XDIST_WORKER_COUNT`` at *module import time*. Under ``pytest-xdist`` the controller
imports every conftest.py before any worker exists, and the controller's own environment never
carries ``PYTEST_XDIST_WORKER_COUNT`` -- so that read always saw the single-process default
("1") and wrote ``--driver-memory 4g`` into the controller's ``PYSPARK_SUBMIT_ARGS``. Workers
inherit their parent's environment when execnet spawns them, so every worker started with 4g
already set, and the ``os.environ.setdefault`` call guarding the worker's own value never had a
chance to fire: the variable was already set, just by the wrong process. Three workers at 4g
each is exactly the OOM this suite's own comment warns about (a cgroup limit hit, dmesg-visible)
-- on a box sized for four 2g workers, not four 4g ones.

The fix keys sizing on ``PYTEST_XDIST_WORKER`` (set only *inside* a worker's own process, never
in the controller) and reads it from ``pytest_configure``, which xdist calls separately in every
process rather than once at whichever process imports the module first. This test exercises the
pure decision function directly -- no JVM, no xdist, no subprocess -- so it runs in either
suite's default (non-xdist) invocation too.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]


def _load_conftest_module(name: str, path: Path):
    """Import ``path`` under a throwaway module name, independent of pytest's own plugin cache.

    ``conftest.py`` is already imported by pytest itself as a plugin (under a name pytest
    picks), and re-importing that same module object would just return the cached one -- which
    is fine for reading ``_driver_memory``, but giving it a private name here keeps this test
    from depending on pytest's internal naming scheme for conftest modules, which is not public
    API.
    """
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def conftest_module(monkeypatch, request):
    # Import fresh so the PYTEST_XDIST_WORKER monkeypatches below are visible to a brand-new
    # read, not masked by whatever pytest's own already-imported conftest module cached.
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    return _load_conftest_module(
        f"_test_worker_heap_conftest_{request.node.name}", BRICK_DIR / "tests" / "conftest.py"
    )


def test_driver_memory_is_4g_outside_xdist(conftest_module, monkeypatch):
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    assert conftest_module._driver_memory() == "4g"


def test_driver_memory_is_2g_inside_an_xdist_worker(conftest_module, monkeypatch):
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw0")
    assert conftest_module._driver_memory() == "2g"


def test_driver_memory_ignores_a_controller_inherited_worker_count(conftest_module, monkeypatch):
    """The historical bug, pinned directly: a stale/irrelevant WORKER_COUNT must not matter.

    ``PYTEST_XDIST_WORKER_COUNT`` is what the old code kept, and it can be set in a process
    that is not itself a worker (that's exactly how the controller produced the wrong value).
    ``_driver_memory`` must decide from ``PYTEST_XDIST_WORKER`` alone.
    """
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    monkeypatch.setenv("PYTEST_XDIST_WORKER_COUNT", "3")
    assert conftest_module._driver_memory() == "4g"
