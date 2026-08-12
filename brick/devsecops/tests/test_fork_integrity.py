"""The invariants a fork needs and a single codebase does not.

``brick/devsecops/`` is a copy of ``brick/`` with the same module names, which buys a
deployment that stands on its own and costs two things a monorepo never has to think about:

* **The two can be mixed.** A ``sys.path`` holding both directories resolves each import to
  whichever came first, so you get half of one pipeline and half of the other -- a clean import
  and a wrong number. That is guarded twice, and both guards are tested here.
* **The two can drift.** Nothing stops somebody fixing a bug in one copy and not the other.
  Nothing here can stop that either, but the shared constants that would be *silently* wrong --
  the severity taxonomy, the SLA targets, the resolved statuses, the EPSS threshold -- are
  compared against the upstream file, so a drift in the numbers that define the metrics fails
  rather than diverging quietly.

The second half is deliberately narrow. It does not diff the code: this is a fork, and the code
is *supposed* to differ. It pins the values that both registers have to agree on for their
numbers to be comparable at all.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest

DEVSECOPS_DIR = Path(__file__).resolve().parents[1]
BRICK_DIR = DEVSECOPS_DIR.parent
sys.path.insert(0, str(DEVSECOPS_DIR))

import config  # noqa: E402
import run_pipeline  # noqa: E402


def upstream(name: str):
    """Load ``brick/<name>.py`` under a private module name.

    Loaded by path rather than by import, and bound to a name that cannot collide, because
    importing it normally is the exact mistake this module exists to catch.
    """
    spec = importlib.util.spec_from_file_location(f"_upstream_{name}", BRICK_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ------------------------------------------------------------------ the mixing guard


def test_the_two_pipelines_cannot_share_a_version_string():
    """The cheap half of the guard: a mixed set is caught on the version alone.

    `1.0-devsecops` against brick's `2.x` -- a comparison that cannot accidentally succeed,
    which is why the suffix is there rather than a bare number.
    """
    assert config.PIPELINE_VERSION == "1.0-devsecops"
    assert config.PIPELINE_VERSION != upstream("config").PIPELINE_VERSION


def test_every_module_must_come_from_this_directory(monkeypatch):
    """The half that catches two forks sharing a version.

    A module imported from anywhere else is refused by name and by path, because the failure it
    prevents -- brick's `config` beside this `metrics` -- imports cleanly and then measures the
    wrong population.
    """
    impostor = types.SimpleNamespace(
        MODULE_VERSION=config.PIPELINE_VERSION,
        __file__=str(BRICK_DIR / "metrics.py"),
    )
    monkeypatch.setitem(sys.modules, "metrics", impostor)
    with pytest.raises(RuntimeError, match="imported from outside") as exc:
        run_pipeline.check_deployment()
    assert "metrics" in str(exc.value)
    assert "sys.path" in str(exc.value)


def test_the_directory_check_passes_on_a_clean_import():
    run_pipeline.check_deployment()  # must not raise


# ------------------------------------------------------------------ the drift guard


@pytest.mark.parametrize(
    "name",
    [
        "SEVERITY_ORDER",
        "SLA_TARGETS",
        "RESOLVED_STATUSES",
        "API_SEVERITY_VALUES",
        "SEVERITY_COLORS",
        "EPSS_PRIORITY_THRESHOLD",
        "NET_CAPACITY_BAND_PCT",
        "DISAPPEARANCE_MODES",
        "STATUS_OPEN",
        "STATUS_RESOLVED",
        "RESOLUTION_API",
        "RESOLUTION_DISAPPEARED",
        "POPULATION_ALL",
        "POPULATION_HIGH_RISK",
        "OVERALL",
    ],
)
def test_shared_constants_match_upstream(name):
    """These define what the metrics mean, so the two registers must agree on them exactly.

    A severity taxonomy or an SLA target that drifted would make the two sets of numbers
    quietly incomparable -- and comparing them is most of the reason for measuring both.
    ``brick/config.py`` is upstream: if this fails, this copy is the one that is wrong.
    """
    assert getattr(config, name) == getattr(upstream("config"), name), (
        f"{name} has drifted from brick/config.py, which is upstream. "
        f"See brick/devsecops/README.md, 'Keeping the two in step'."
    )


def test_the_risk_rule_for_cve_findings_matches_upstream():
    """`sca` findings carry the same three exploit signals a host finding does, so they must be
    classified by the same rule -- otherwise a code coverage figure and a host coverage figure
    are not measuring the same kind of thing."""
    # `astuple`, not `==`: a frozen dataclass compares its class first, and these are two
    # different `RiskRule` classes loaded from two different files. Comparing the objects would
    # pass never rather than fail usefully.
    import dataclasses

    theirs = dataclasses.astuple(upstream("config").DEFAULT_RISK_RULE)
    assert dataclasses.astuple(config.DEFAULT_RISK_RULE) == theirs
    assert dataclasses.astuple(config.rule_for_scope("sca")) == theirs


def test_the_ledger_schema_is_upstreams_plus_the_static_analysis_columns():
    """The reconciler is a copy, so its stored schema must stay a superset of brick's -- three
    nullable columns for the inputs only a SAST register has, and nothing else."""
    import ledger as ledger_mod

    theirs = [f.name for f in upstream("ledger").LEDGER_SCHEMA.fields]
    ours = [f.name for f in ledger_mod.LEDGER_SCHEMA.fields]
    assert ours[: len(theirs)] == theirs, "the shared columns have been reordered or renamed"
    assert ours[len(theirs):] == ["cwe", "language", "ai_verdict"]


def test_this_fork_measures_code_and_refuses_to_pretend_otherwise():
    """`os` and `all` are brick's scopes. Accepting either here would write `wiz_os_*` tables
    full of code findings, which is a naming lie rather than an error anybody would notice."""
    assert sorted(config.SCOPES) == ["sast", "sca"]
    assert config.DEFAULT_SCOPE == "sca"
    for theirs in ("os", "all"):
        assert theirs not in config.SCOPES
