"""The full-fidelity dry-run generator: schema parity with the live mock + invariants."""

import json
from datetime import datetime
from pathlib import Path

import pytest

from wiz_dashboard.data import demo

FLAT_MOCK_PATH = Path(__file__).resolve().parent.parent / "os_vulns_response_exemple.json"


def _mock_node():
    return json.loads(FLAT_MOCK_PATH.read_text(encoding="utf-8"))[
        "data"]["vulnerabilityFindings"]["nodes"][0]


def _nodes(seq=0):
    return demo.evolving_flat_sample(seq)["data"]["vulnerabilityFindings"]["nodes"]


def test_generated_node_schema_matches_flat_mock():
    """The headline invariant: every generated node carries exactly the 61-field key set
    of the committed live-response mock, including the nested sub-object schemas."""
    mock = _mock_node()
    for node in (_nodes()[0], _nodes()[-1]):
        assert set(node) == set(mock)
        assert set(node["vulnerableAsset"]) == set(mock["vulnerableAsset"])
        assert set(node["artifactType"]) == set(mock["artifactType"])
        assert set(node["cvssv3"]) == set(mock["cvssv3"])
        assert set(node["versionResolutionPrimarySource"]) == set(
            mock["versionResolutionPrimarySource"])
    page = demo.evolving_flat_sample(0)["data"]["vulnerabilityFindings"]["pageInfo"]
    assert set(page) == {"hasNextPage", "endCursor"}


def test_volume_env_override_and_default(monkeypatch):
    monkeypatch.setenv("WIZ_DEMO_VOLUME", "CRITICAL=3,HIGH=4")
    counts = demo.demo_volume()
    assert counts == {"CRITICAL": 3, "HIGH": 4}
    from collections import Counter
    assert Counter(n["severity"] for n in _nodes()) == counts

    # Unset env → the realistic default (assert the spec, don't generate 65k here).
    monkeypatch.delenv("WIZ_DEMO_VOLUME")
    assert demo.demo_volume() == {"CRITICAL": 5_000, "HIGH": 60_000}

    # Garbage falls back to the default rather than erroring.
    monkeypatch.setenv("WIZ_DEMO_VOLUME", "nonsense")
    assert demo.demo_volume() == demo.DEMO_VOLUME


def test_only_configured_severities_and_unique_stable_ids():
    nodes = _nodes()
    assert {n["severity"] for n in nodes} == set(demo.demo_volume())
    ids = [n["id"] for n in nodes]
    assert len(ids) == len(set(ids))
    assert all(i.startswith("demo-") for i in ids)


def test_determinism_and_snapshot_identity():
    # Same counts → the identical memoized snapshot; a fresh build is equal content-wise.
    assert demo.evolving_flat_sample(0) is demo.evolving_flat_sample(0)
    a = demo._full_finding("HIGH", 42)
    b = demo._full_finding("HIGH", 42)
    assert a == b


def test_resolved_mix_supports_mttr_and_sla():
    nodes = _nodes()
    resolved = [n for n in nodes if n["status"] == "RESOLVED"]
    open_ = [n for n in nodes if n["status"] == "OPEN"]
    assert resolved and open_

    def _ts(s):
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    for n in resolved:
        assert _ts(n["resolvedAt"]) > _ts(n["firstDetectedAt"])
        assert n["fixDate"] == n["resolvedAt"]
    assert all(n["resolvedAt"] is None for n in open_)


def test_nodes_parse_as_flat_findings():
    from wiz_dashboard.models import schema

    nodes = _nodes()
    assert not schema.is_grouped_shape(nodes)
    finding = schema.parse_node(nodes[0])
    assert finding.severity in {"CRITICAL", "HIGH"}
    assert finding.vulnerableAsset and finding.vulnerableAsset.name
    assert finding.firstDetectedAt


def test_scenarios_change_counts_at_any_volume(monkeypatch):
    # Even at a tiny volume the ±1 nudge keeps adjacent scans' counts distinct.
    monkeypatch.setenv("WIZ_DEMO_VOLUME", "CRITICAL=2,HIGH=3")
    seqs = [demo._counts_for_seq(s) for s in range(6)]
    for a, b in zip(seqs, seqs[1:]):
        assert a != b


@pytest.mark.slow
def test_full_default_volume_builds_65k_nodes(monkeypatch):
    monkeypatch.delenv("WIZ_DEMO_VOLUME", raising=False)
    demo._snapshot.cache_clear()
    try:
        nodes = _nodes()
        from collections import Counter

        assert Counter(n["severity"] for n in nodes) == {
            "CRITICAL": 5_000, "HIGH": 60_000}
        assert len(nodes) == 65_000
    finally:
        demo._snapshot.cache_clear()  # don't hold ~160 MB for the rest of the session
