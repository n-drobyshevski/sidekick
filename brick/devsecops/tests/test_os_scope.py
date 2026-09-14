"""The host register, after this fork absorbed it.

``brick/`` measured OS-package CVEs on virtual machines under scopes ``os`` and ``all``; this
fork now measures ``os`` (``all`` is not ported -- it overlapped ``os``, was never scheduled,
and nothing read it) alongside ``sca`` and ``sast``. The absorption added no branch anywhere:
``os`` reads the same GraphQL connection behind the same filter type ``sca`` does, so it is
four table entries and a default, and every dispatch site resolves it by looking the scope up
rather than by knowing its name.

**Which is exactly why it needs its own tests.** A scope that fits without a branch also fails
without one. Each of the four ways this could have gone wrong produces a plausible number
rather than an error:

* the FILTER drifting through ``_shape_base`` -- a different population, every host figure
  still rendering;
* ``os`` classified under ``SastRiskRule`` -- 100% unclassified on a register full of CVEs;
* ``os`` losing the ``hasFix`` pin -- a blank fix clock stops meaning "the fix predates us"
  and every such row lands in the awaiting-vendor bucket;
* the severity gate inherited from somewhere instead of stated -- the sibling register shipped
  a secrets population with no passwords in it that way.

No ``pyspark`` import guard: nothing here touches Spark. These are pure config and pure
``ingest`` assertions, and they are the ones that have to hold before a single row is fetched.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import config  # noqa: E402
import ingest  # noqa: E402


# The filter ``brick/ingest.build_filter("os", ("CRITICAL", "HIGH"), project_id="p")`` emitted,
# transcribed here as a literal ORACLE rather than imported.
#
# Origin: `brick/config.py`'s `SCOPES["os"]` (`_BASE` + the four OS-view keys) plus the two
# things `brick/ingest.build_filter` added -- the severity gate from its flat
# `DEFAULT_FETCH_SEVERITIES = ("CRITICAL", "HIGH")`, and `projectIdV2` written inline as
# `{"equals": [project_id]}` because `VulnerabilityFindingProjectFilter` is an object.
#
# A literal on purpose: `brick/` is deleted later in this same step, so a test that imported it
# would be deleted with it -- and this is the assertion that must OUTLIVE the fork, because
# after the deletion nothing else in the repo remembers what the host register's population
# was. It was verified byte-equal against the live `brick/ingest.build_filter` when it was
# written (and `test_fork_integrity.py` re-checks it against upstream for as long as upstream
# exists); from here on it stands on its own, and a diff against it is a population change that
# somebody has to justify rather than accept.
BRICK_OS_FILTER = {
    "status": ["OPEN", "RESOLVED"],
    "hasFix": True,
    "detectionMethod": ["OS"],
    "assetType": ["VIRTUAL_MACHINE"],
    "assetIsRepresentativeResource": False,
    "detailedNameV2": {"notEquals": ["openssl", "python", "vim"]},
    "severity": ["CRITICAL", "HIGH"],
    "projectIdV2": {"equals": ["p"]},
}


# --------------------------------------------------------------- the population, byte for byte


def test_the_os_filter_is_the_one_brick_retired():
    """The whole population, key by key, against the shape brick sent.

    Not "the keys are present" and not "the interesting ones survived": the emitted dict is
    compared WHOLE, because every one of these keys narrows the population and a silently
    dropped one is a register that measures more than it says it does. `detectionMethod` and
    `assetType` are what makes a finding a host finding; `assetIsRepresentativeResource: False`
    drops the API's duplicate; the `detailedNameV2` exclusions are three packages this register
    deliberately does not report on; `hasFix` is what makes the remediation rates mean
    something (and see the actionable-clock test below, which reads it back out).
    """
    got = ingest.build_filter("os", ["CRITICAL", "HIGH"], project_id="p")
    assert got == BRICK_OS_FILTER

    # The default gate resolves to the same thing without being passed -- which is the form the
    # pipeline actually calls, and a different code path (`default_fetch_severities`).
    assert ingest.build_filter("os", project_id="p") == BRICK_OS_FILTER


def test_the_scope_template_survives_the_call():
    """`build_filter` deep-copies before shaping. It does not, on a bad day, hand out a
    reference to `SCOPES["os"]` that the next call finds a severity gate already in."""
    ingest.build_filter("os", ["LOW"], project_id="p-1")
    assert "severity" not in config.SCOPES["os"]
    assert "projectIdV2" not in config.SCOPES["os"]
    assert config.SCOPES["os"]["detailedNameV2"] == {"notEquals": ["openssl", "python", "vim"]}


def test_the_project_restriction_is_an_object_and_the_table_is_why(monkeypatch):
    """`projectIdV2` is the one key `os` needs an `OBJECT_FILTERS` entry for, and the brief
    that ported this scope predicted it would need none.

    Everything written into `SCOPES["os"]` is a bare list, a scalar, or a nested
    `{"notEquals": [...]}`, all of which `_shape_base` passes through untouched -- so the
    reasoning "no os entry is needed" is right about the base filter and wrong about the
    emitted one. `build_filter` ADDS `projectIdV2` AFTER `_shape_base` has run, and routes it
    through the same table; with no entry, `_list_filter` returns a bare list.

    Measured, not argued: the perturbation below removes the entry and the filter stops
    matching brick's. `VulnerabilityFindingProjectFilter` is an object, so on the wire that is
    HTTP 400 `VALIDATION_INVALID_TYPE_VARIABLE` -- zero rows, reading as an empty register.
    """
    assert config.OBJECT_FILTERS["os"] == ("projectIdV2",)
    assert ingest.build_filter("os", project_id="p")["projectIdV2"] == {"equals": ["p"]}

    without_os = {k: v for k, v in ingest.OBJECT_FILTERS.items() if k != "os"}
    monkeypatch.setattr(ingest, "OBJECT_FILTERS", without_os)
    perturbed = ingest.build_filter("os", project_id="p")
    assert perturbed["projectIdV2"] == ["p"], "the perturbation did not reach the emitted key"
    assert perturbed != BRICK_OS_FILTER


def test_the_wire_shape_is_one_the_fake_tenant_would_accept():
    """`devlake/fakewiz.py` refuses a `filterBy` shaped for the wrong filter type, in BOTH
    directions, and this is that rule restated over `os` so it fails here first.

    Its check is: a key the scope's `OBJECT_FILTERS` entry names must arrive as
    `{"equals": [...]}`, and a key it does not name must NOT. Anything that was never part of
    the list-vs-object convention -- a scalar, a `{"notEquals": [...]}` -- is untouched by
    either half.

    Restated rather than imported: these tests run with only this fork's directory on
    `sys.path`, and a fork test that imported the harness would make the harness a dependency
    of the deployment's own suite.

    **What neither this nor the fake can catch**, measured: the fake reads `OBJECT_FILTERS`
    off the fork's own `ingest` module, so a table that disagrees with the SCHEMA is a table
    both halves agree on and the fake accepts happily. It catches a filter that BYPASSED the
    table, never a wrong table. The only check on the table itself is the oracle above --
    brick's emitted shape, transcribed -- and, ultimately, the live tenant's 400.
    """
    wanted = set(config.OBJECT_FILTERS.get("os", ()))
    emitted = ingest.build_filter("os", project_id="p")

    def object_shaped(value):
        return (
            isinstance(value, dict)
            and set(value) == {"equals"}
            and isinstance(value["equals"], list)
        )

    for key, value in emitted.items():
        assert object_shaped(value) == (key in wanted), (
            f"os.{key} = {value!r} is in the wrong kind for VulnerabilityFindingFilters"
        )

    # And the half the brief asked for outright: with no project restriction, every list-valued
    # key of the os filter stays a BARE list, because none of them is in the table.
    bare = ingest.build_filter("os")
    listish = [k for k, v in bare.items() if isinstance(v, list)]
    assert listish, "the os filter emitted no list-valued keys -- this test measured nothing"
    for key in listish:
        assert key not in config.OBJECT_FILTERS.get("os", ())


# ------------------------------------------------------------------ the source and the query


def test_os_reads_the_vulnerability_findings_connection():
    """One string, three jobs (`Source.connection`): the document queried, the key the nodes
    arrive under, and what `fetch_findings` pages on. A scope cannot page one connection and
    read another, so this is also the assertion that `os` is not quietly a SAST register."""
    assert config.SOURCES["os"] is config.VULN_SOURCE
    assert config.SOURCES["os"].connection == "vulnerabilityFindings"
    assert config.SOURCES["os"].severity_filter is True

    document = ingest.query_for("os")
    assert "vulnerabilityFindings(filterBy: $filterBy" in document
    assert "$filterBy: VulnerabilityFindingFilters" in document
    assert "sastFindings" not in document
    # The exploit signals the risk rule classifies on, which is what makes `os` a P2P register
    # at all. Drop them and every finding classifies `unknown` while the page still renders.
    for field in ("hasCisaKevExploit", "hasExploit", "epssProbability", "firstDetectedAt"):
        assert field in document


def test_os_asks_for_no_asset_members_and_that_is_brick_s_behaviour():
    """A union fails as a whole. `sca` returns exactly one member so it names two and gets its
    asset columns; a host finding can arrive on any of the thirteen, so there is no narrower
    list to ask for and `FETCH_ASSET_FIELDS` decides -- off, because the live tenant 400s the
    full union. The columns that go NULL are the estate breakdowns, not the clock."""
    assert "os" not in config.SCOPE_ASSET_MEMBERS
    assert config.FETCH_ASSET_FIELDS is False
    assert ingest.asset_members("os") == ()
    assert "vulnerableAsset" not in ingest.query_for("os")
    # And the ecosystem column P2P v5 groups `sca` on is not asked for either: a host register
    # has no language, and a field this tenant might not have costs the whole request.
    assert "codeLibraryLanguage" not in ingest.query_for("os")


# ---------------------------------------------------------------------- how os is classified


def test_os_is_classified_by_the_cve_rule_not_the_static_analysis_one():
    """Getting this wrong is not an error, it is a full page of plausible numbers:
    `SastRiskRule` against a CVE register classifies every finding `unknown` and reports 100%
    unclassified. `rule_for_scope` dispatches on the scope's SOURCE, which is why absorbing
    `os` needed no edit there -- and why it needs an assertion here instead."""
    assert config.rule_for_scope("os") is config.DEFAULT_RISK_RULE
    assert config.rule_for_scope("os") is not config.DEFAULT_SAST_RISK_RULE
    assert config.rule_for_scope("sast") is config.DEFAULT_SAST_RISK_RULE


# -------------------------------------------------------------- the two vendor-fix questions


def test_os_has_a_vendor_to_wait_on_and_pins_the_fix_filter():
    """Two DIFFERENT questions, both answered "yes" for `os`, by two different mechanisms.

    ``HAS_VENDOR_FIX`` is declared: whoever ships the OS package ships the fix, so "open with
    no fix available" is a real, temporary state a host row can be in, and the actionable clock
    applies. ``SCOPES_PINNING_HAS_FIX`` is DERIVED from the filter: `os` pins `hasFix: true`
    through `_BASE`, so every row was ingested with a fix already available and a blank fix
    clock dates from `first_seen` rather than parking the row in the awaiting-vendor bucket.

    The derivation is asserted as a derivation, not as a list -- dropping `hasFix` from
    `SCOPES["os"]` is a population change somebody will eventually make, and it has to take
    this claim with it rather than leave the code asserting a fix existed for findings nobody
    filtered for one.
    """
    assert "os" in config.HAS_VENDOR_FIX
    assert config.scope_has_vendor_fix("os")
    assert "os" in config.SCOPES_PINNING_HAS_FIX
    assert config.scope_pins_has_fix("os")

    derived = frozenset(s for s, f in config.SCOPES.items() if f.get("hasFix") is True)
    assert config.SCOPES_PINNING_HAS_FIX == derived == frozenset({"os", "sca"})

    # The perturbation the derivation exists for: a population without the pin loses the claim.
    scopes = copy.deepcopy(config.SCOPES)
    del scopes["os"]["hasFix"]
    assert "os" not in frozenset(s for s, f in scopes.items() if f.get("hasFix") is True)

    # And the exception that makes the declared set worth having: `sast` has no vendor, so it
    # is out of both -- by declaration, and by not using `_BASE` at all.
    assert "sast" not in config.HAS_VENDOR_FIX
    assert "sast" not in config.SCOPES_PINNING_HAS_FIX


# ----------------------------------------------------------------------- the severity gate


def test_the_os_gate_is_stated_rather_than_inherited():
    """`("CRITICAL", "HIGH")` -- brick's retired flat default, keyed rather than flattened.

    The keying is the point. A single shared list is a volume control every future population
    inherits without anybody choosing it for them, which is how the sibling register published
    a secrets register with no passwords in it. So each scope names its own, and an unknown
    scope is refused rather than handed somebody else's.
    """
    assert config.default_fetch_severities("os") == ("CRITICAL", "HIGH")
    assert config.DEFAULT_FETCH_SEVERITIES["os"] == ("CRITICAL", "HIGH")
    assert ingest.build_filter("os")["severity"] == ["CRITICAL", "HIGH"]
    with pytest.raises(RuntimeError, match="unknown scope"):
        config.default_fetch_severities("all")


# ------------------------------------------------------------------------ what was NOT ported


def test_this_register_has_three_scopes_and_all_is_not_one_of_them():
    """`all` was brick's every-detection-method scope. It overlapped `os`, was never scheduled,
    and is dropped rather than ported -- so asking for it is a refusal at every entry point,
    not a scan that writes `wiz_all_*` tables nobody asked for.

    `POPULATION_ALL` is a different thing with the same spelling -- the capacity table's
    all-findings row label -- and is untouched by any of this.
    """
    assert sorted(config.SCOPES) == ["os", "sast", "sca"]
    assert sorted(config.SOURCES) == ["os", "sast", "sca"]
    assert "all" not in config.SCOPES
    assert "all" not in config.HAS_VENDOR_FIX
    for builder in (ingest.build_filter, ingest.query_for):
        with pytest.raises(RuntimeError, match="unknown scope"):
            builder("all")
    assert config.POPULATION_ALL == "all"


def test_os_is_the_default_scope():
    """The oldest, largest and most read population here, and what the notebooks open on.

    It is read at IMPORT time by `ingest.QUERY = build_query()`, and nowhere at runtime --
    `fetch_findings` is handed the run's scope. `tests/test_pipeline.py` holds the consequence
    for `QUERY`.
    """
    assert config.DEFAULT_SCOPE == "os"
    assert config.DEFAULT_SCOPE in config.SCOPES
    assert ingest.build_filter() == ingest.build_filter("os")
    assert ingest.query_for() == ingest.query_for("os")
