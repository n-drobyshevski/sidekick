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


def test_the_project_filter_shape_matches_upstream():
    """Same GraphQL connection, same filter type, so the project restriction must be byte-equal.

    `sca` and brick's `os` both read `vulnerabilityFindings` behind a
    `VulnerabilityFindingFilters`, and `projectIdV2` on that type is a
    `VulnerabilityFindingProjectFilter` -- an object. This fork now routes it through
    ``config.OBJECT_FILTERS`` instead of writing the object inline; upstream still writes it
    inline, because upstream has exactly one filter type and a one-entry table would be
    theatre. The two spellings must still agree, or the same tenant filter means two things.

    It is the *shape* being compared, not the whole filter: the populations differ on purpose.
    """
    import ingest as ours

    theirs = upstream("ingest")
    # `upstream` loads by path, but brick/ingest.py's own `from config import SCOPES` resolves
    # through `sys.path` -- which this module has already pointed at the fork. Rebinding the
    # two scope constants from brick's config is what makes `theirs.build_filter` measure
    # brick's `os` scope rather than this fork's `sca` under brick's code. The mixing guard
    # exists because that substitution is invisible; here it is deliberate and named.
    their_config = upstream("config")
    theirs.SCOPES = their_config.SCOPES
    theirs.DEFAULT_SCOPE = their_config.DEFAULT_SCOPE
    # The severity gate is the third constant that crosses, and it is the one that goes wrong
    # QUIETLY -- so it is passed at the call rather than left to the leak. Upstream's
    # `build_filter` defaults it to a flat `("CRITICAL", "HIGH")`; this fork's config answers
    # `from config import DEFAULT_FETCH_SEVERITIES` with a dict keyed by scope, so brick's code
    # iterates its KEYS and builds `severity: ["SCA", "SAST"]` -- measured here, not supposed,
    # and raising nothing. Rebinding the module attribute does NOT reach it either: a default
    # argument is captured in `__defaults__` at `def` time, which is the difference between this
    # constant and the two above.
    their_severities = their_config.DEFAULT_FETCH_SEVERITIES

    assert ours.build_filter("sca", project_id="p")["projectIdV2"] == (
        theirs.build_filter("os", their_severities, project_id="p")["projectIdV2"]
    ) == {"equals": ["p"]}
    # And the asymmetry upstream never has to know about: the SAST type spells it `projectId`
    # and takes it bare, which is why the shape is data here and a literal there.
    assert ours.build_filter("sast", project_id="p")["projectId"] == ["p"]
    assert config.OBJECT_FILTERS["sca"] == ("projectIdV2",)
    # Each register's gate reaches its own `build_filter`. Pinned as a KIND rather than as an
    # equality -- the values agree today, and the point of keying this fork's default by scope
    # is that they need not.
    assert theirs.build_filter("os", their_severities)["severity"] == ["CRITICAL", "HIGH"]
    assert ours.build_filter("sca")["severity"] == list(config.default_fetch_severities("sca"))
    # The leak itself, stated: brick's own default, read through this fork's config, is not a
    # severity list at all. Nothing upstream can be changed from here, so the call sites above
    # state the gate instead.
    assert theirs.build_filter("os")["severity"] == ["SCA", "SAST"]


def test_the_vendor_fix_scopes_differ_and_that_asymmetry_is_the_point():
    """``HAS_VENDOR_FIX`` is deliberately NOT one of the shared constants above.

    The two registers measure different populations, and this is the one place where the
    difference is a fact about the world rather than about a filter: an OS package and a
    library both have a maintainer who ships the fixed version; a weakness in first-party code
    does not. So the asymmetry itself is what gets pinned, in both directions -- ``sast`` out,
    ``sca`` in -- because either half alone would pass against a set that had drifted into the
    other's answer.

    Adding this name to ``test_shared_constants_match_upstream`` would fail immediately and
    correctly. What would NOT fail, and is why this test exists, is somebody widening it here
    to "match upstream": that puts every open SAST finding on a vendor watchlist forever
    (priced in ``tests/test_devsecops.py``) while looking like a consistency fix.
    """
    theirs = upstream("config")
    assert config.HAS_VENDOR_FIX == frozenset({"sca"})
    assert "sast" not in config.HAS_VENDOR_FIX
    assert "sca" in config.HAS_VENDOR_FIX
    assert theirs.HAS_VENDOR_FIX == frozenset({"os", "all"})
    assert config.HAS_VENDOR_FIX != theirs.HAS_VENDOR_FIX
    # Every scope one of them names is a scope that fork actually has.
    assert config.HAS_VENDOR_FIX <= set(config.SCOPES)
    assert theirs.HAS_VENDOR_FIX <= set(theirs.SCOPES)


def test_the_has_fix_pin_is_read_from_the_filter_in_both_forks():
    """The second half of the actionable clock, and it is derived rather than declared.

    Both forks pin ``hasFix: true`` through ``_BASE`` today, which is what lets a blank fix
    clock date from ``first_seen``. Neither fork may hardcode that: dropping ``hasFix`` from a
    scope has to take the claim with it, or the code goes on asserting a fix existed for
    findings nobody filtered for one.
    """
    for module, scopes in ((config, ("sca",)), (upstream("config"), ("os", "all"))):
        derived = frozenset(s for s, f in module.SCOPES.items() if f.get("hasFix") is True)
        assert module.SCOPES_PINNING_HAS_FIX == derived
        for scope in scopes:
            assert module.scope_pins_has_fix(scope)
    # `sast` does not use `_BASE` at all, which is the same conclusion by a different route.
    assert not config.scope_pins_has_fix("sast")


def test_this_fork_measures_code_and_refuses_to_pretend_otherwise():
    """`os` and `all` are brick's scopes. Accepting either here would write `wiz_os_*` tables
    full of code findings, which is a naming lie rather than an error anybody would notice."""
    assert sorted(config.SCOPES) == ["sast", "sca"]
    assert config.DEFAULT_SCOPE == "sca"
    for theirs in ("os", "all"):
        assert theirs not in config.SCOPES
