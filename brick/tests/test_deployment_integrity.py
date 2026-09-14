"""The invariant a flat module folder needs even with no fork left to mix with.

``brick/devsecops/`` used to be a copy of ``brick/`` with the same module names -- two
directories on ``sys.path`` at once, each answering to ``config``, ``metrics``, and so on. That
fork is gone (S2 merged the OS scope's config in; S2-T4/T5 deleted ``brick/``'s copies and moved
this directory up to ``brick/``), so there is no more upstream to drift from and the fifteen
shared-constant comparisons, the ledger-schema-superset check, the project-filter-shape check,
the vendor-fix-asymmetry check and the three-populations check that used to load
``brick/config.py`` (etc.) "as upstream" are deleted with it -- there is nothing left to load.

What is still real on a flat Databricks workspace folder: a stale ``sys.modules`` entry from a
previous run, or a module imported from some OTHER directory on ``sys.path``, resolves silently
to the wrong file and measures the wrong population without raising. That failure mode does not
need two directories to exist -- it only needs `import config` to resolve to something that
is not `brick/config.py` -- so ``run_pipeline.check_deployment()`` still checks every module's
``__file__`` against this directory, and the two tests below are what is left to hold it.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import config  # noqa: E402
import run_pipeline  # noqa: E402


def test_the_pipeline_version_is_3_0_devsecops():
    """No upstream to disagree with any more -- just the literal the deployment reports."""
    assert config.PIPELINE_VERSION == "3.0-devsecops"


def test_every_module_must_come_from_this_directory(monkeypatch):
    """A module imported from anywhere else is refused by name and by path.

    A stale ``sys.modules`` entry, or a second copy of this tree reachable via some other
    ``sys.path`` component, imports cleanly and then measures the wrong population -- which is
    the failure this guards, whether or not a second fork exists to produce it.
    """
    impostor = types.SimpleNamespace(
        MODULE_VERSION=config.PIPELINE_VERSION,
        __file__=str(BRICK_DIR.parent / "metrics.py"),
    )
    monkeypatch.setitem(sys.modules, "metrics", impostor)
    with pytest.raises(RuntimeError, match="imported from outside") as exc:
        run_pipeline.check_deployment()
    assert "metrics" in str(exc.value)
    assert "sys.path" in str(exc.value)


def test_the_directory_check_passes_on_a_clean_import():
    run_pipeline.check_deployment()  # must not raise
