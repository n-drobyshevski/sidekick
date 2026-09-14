"""``conftest.py``'s driver-heap sizing, loaded in isolation rather than through the fixture
pytest already has open for the rest of the suite.

The defect this guards: ``conftest.py`` used to size the driver heap from
``PYTEST_XDIST_WORKER_COUNT`` at *module import time*, which the xdist controller reads before
any worker exists (so it always saw "1"), wrote ``--driver-memory 4g`` into the controller's own
``PYSPARK_SUBMIT_ARGS``, and every worker inherited that value at spawn -- 4g regardless of
``-n``. Loading a private copy of ``conftest.py`` under its own module name lets each test set
``PYTEST_XDIST_WORKER``/``PYTEST_XDIST_WORKER_COUNT`` and call ``_driver_memory()`` directly,
without touching the real conftest plugin instance pytest already has loaded for this run.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]


def _load_conftest_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def conftest_module(monkeypatch, request):
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    return _load_conftest_module(
        f"_test_worker_heap_conftest_{request.node.name}",
        BRICK_DIR / "tests" / "conftest.py",
    )


def test_driver_memory_is_4g_outside_xdist(conftest_module, monkeypatch):
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    assert conftest_module._driver_memory() == "4g"


def test_driver_memory_is_2g_inside_an_xdist_worker(conftest_module, monkeypatch):
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw0")
    assert conftest_module._driver_memory() == "2g"


def test_driver_memory_ignores_a_controller_inherited_worker_count(conftest_module, monkeypatch):
    monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    monkeypatch.setenv("PYTEST_XDIST_WORKER_COUNT", "3")
    assert conftest_module._driver_memory() == "4g"
