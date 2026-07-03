"""Step 1: os_vulns is importable; fetch_findings replaces the runpy path."""

import threading

import pytest

import os_vulns


def test_fetch_findings_dry_run_default_is_grouped():
    # The dry-run now defaults to the grouped-by-asset shape, mirroring the real Wiz
    # response (the committed os_vulns_grouped_response_example.json: 10 assets, all critical).
    results = os_vulns.fetch_findings(dry_run=True)
    grouped = results["data"]["vulnerabilityFindingsGroupedByValues"]["nodes"]
    assert len(grouped) == 10
    assert all("analytics" in n and "severity" not in n for n in grouped)
    crit = sum(n["analytics"]["criticalSeverityFindingCount"] for n in grouped)
    assert crit == 494


def test_fetch_findings_dry_run_flat_shape():
    results = os_vulns.fetch_findings(dry_run=True, sample_shape="flat")
    nodes = results["data"]["vulnerabilityFindings"]["nodes"]
    assert len(nodes) == 17
    assert nodes[0]["id"] == "dry-c1"
    assert nodes[0]["severity"] == "CRITICAL"
    # The flat sample spans every severity and mixes resolved + open findings, so the
    # MTTR / SLA / trend views are all populated under --dry-run --dry-run-shape flat.
    sevs = {n["severity"] for n in nodes}
    assert {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"} <= sevs
    assert any("resolvedAt" in n for n in nodes)  # resolved -> MTTR computes
    assert any("resolvedAt" not in n for n in nodes)  # open -> open-age computes


def test_cached_client_dry_run(app):
    # The cached data layer delegates to os_vulns.fetch_findings; grouped is the default.
    from wiz_dashboard.data.client import fetch_findings

    fetch_findings.clear()
    grouped = app.extract_nodes(fetch_findings(dry_run=True))
    assert len(grouped) == 10  # grouped-by-asset is the default dry-run shape

    flat = app.extract_nodes(fetch_findings(dry_run=True, sample_shape="flat"))
    assert len(flat) == 17
    assert flat[0]["id"] == "dry-c1"


def _sev_counts(resp):
    from collections import Counter

    nodes = resp["data"]["vulnerabilityFindings"]["nodes"]
    return dict(Counter(n["severity"] for n in nodes))


def test_evolving_flat_sample_seq0_is_the_baseline():
    # seq 0 is the familiar SAMPLE_RESULTS, so the first dry-run scan (and every test that
    # doesn't opt into evolution) sees today's data unchanged.
    from wiz_dashboard.data import demo

    assert demo.evolving_flat_sample(0) is os_vulns.SAMPLE_RESULTS


def test_evolving_flat_sample_changes_each_scan_and_cycles():
    # Each subsequent scan returns a different per-severity mix (so the change badges have a
    # non-zero delta), the shape stays flat, and the scenarios cycle so the demo never ends.
    from wiz_dashboard.data import demo
    from wiz_dashboard.models import schema

    n = len(demo._SCENARIOS)
    counts = [_sev_counts(demo.evolving_flat_sample(s)) for s in range(n + 2)]

    # The first evolution differs from the baseline, and every adjacent scan differs from
    # the one before it — guaranteeing the deltas are visible on each successive scan.
    base = _sev_counts(os_vulns.SAMPLE_RESULTS)
    assert counts[1] != base
    for a, b in zip(counts, counts[1:]):
        assert a != b

    # Wraps: scenario seq and seq+n are the same point in the cycle.
    assert counts[1] == counts[1 + n]

    # Generated samples are valid flat shape (per-finding, not grouped-by-asset).
    nodes = demo.evolving_flat_sample(1)["data"]["vulnerabilityFindings"]["nodes"]
    assert nodes and not schema.is_grouped_shape(nodes)
    assert all({"id", "name", "severity"} <= n.keys() for n in nodes)


def test_cached_client_threads_sample_seq():
    # The cached layer passes sample_seq through (a distinct cache entry per scan) so the
    # dry-run flat data evolves: seq 0 is the baseline, seq > 0 is the next scenario.
    from wiz_dashboard.data import demo
    from wiz_dashboard.data.client import fetch_findings

    fetch_findings.clear()
    base = fetch_findings(dry_run=True, sample_shape="flat", sample_seq=0)
    assert base["data"]["vulnerabilityFindings"]["nodes"][0]["id"] == "dry-c1"
    evo = fetch_findings(dry_run=True, sample_shape="flat", sample_seq=2)
    assert _sev_counts(evo) == _sev_counts(demo.evolving_flat_sample(2))
    assert _sev_counts(evo) != _sev_counts(base)


def test_live_fetch_falls_back_to_disk_snapshot(monkeypatch):
    """A live-fetch failure degrades to the last on-disk snapshot, not an error."""
    from wiz_dashboard.data import client

    snapshot = {
        "data": {"vulnerabilityFindings": {"nodes": [{"id": "cached", "severity": "HIGH"}]}}
    }

    def boom(*args, **kwargs):
        raise RuntimeError("live API down")

    monkeypatch.setattr(client.os_vulns, "fetch_findings", boom)
    monkeypatch.setattr(client.disk_cache, "load_cache", lambda *a, **k: snapshot)

    client.fetch_findings.clear()
    try:
        results = client.fetch_findings(dry_run=False, use_config=False)
    finally:
        client.fetch_findings.clear()

    assert results["data"]["vulnerabilityFindings"]["nodes"][0]["id"] == "cached"


def test_fetch_findings_times_out(monkeypatch):
    """A hung live API raises TimeoutError instead of freezing the caller."""
    release = threading.Event()

    class HangingClient:
        def query(self, *args, **kwargs):
            release.wait(timeout=5)  # released by the test once it has asserted
            return {"data": {}}

    monkeypatch.setattr(os_vulns, "WizAPIClient", HangingClient)
    try:
        with pytest.raises(TimeoutError):
            os_vulns.fetch_findings(dry_run=False, timeout_seconds=0.1)
    finally:
        release.set()


def test_live_fetch_follows_pagination(monkeypatch):
    """A live fetch walks every page via pageInfo.endCursor, not just the first one."""

    pages = {
        None: {
            "data": {
                "vulnerabilityFindings": {
                    "nodes": [{"id": "c1", "severity": "CRITICAL"},
                              {"id": "c2", "severity": "CRITICAL"}],
                    "pageInfo": {"hasNextPage": True, "endCursor": "cur1"},
                }
            }
        },
        "cur1": {
            "data": {
                "vulnerabilityFindings": {
                    "nodes": [{"id": "c3", "severity": "CRITICAL"}],
                    "pageInfo": {"hasNextPage": True, "endCursor": "cur2"},
                }
            }
        },
        "cur2": {
            "data": {
                "vulnerabilityFindings": {
                    "nodes": [{"id": "h1", "severity": "HIGH"}],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        },
    }
    seen_cursors = []

    class PagingClient:
        def query(self, query, variables):
            cursor = variables.get("after")
            seen_cursors.append(cursor)
            return pages[cursor]

    monkeypatch.setattr(os_vulns, "WizAPIClient", PagingClient)
    results = os_vulns.fetch_findings(dry_run=False)

    nodes = results["data"]["vulnerabilityFindings"]["nodes"]
    assert [n["id"] for n in nodes] == ["c1", "c2", "c3", "h1"]  # every page merged
    assert seen_cursors == [None, "cur1", "cur2"]  # followed the cursor chain in order


def test_live_fetch_reports_progress_per_page(monkeypatch):
    """The progress callback fires once per page with cumulative findings counts."""

    pages = {
        None: {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "pageInfo": {"hasNextPage": True, "endCursor": "c1"}}}},
        "c1": {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "c"}],
            "pageInfo": {"hasNextPage": False, "endCursor": None}}}},
    }

    class PagingClient:
        def query(self, query, variables):
            return pages[variables.get("after")]

    monkeypatch.setattr(os_vulns, "WizAPIClient", PagingClient)
    seen = []
    os_vulns.fetch_findings(dry_run=False, progress=lambda p, n: seen.append((p, n)))
    assert seen == [(1, 2), (2, 3)]  # (page, cumulative findings) after each page


def test_progress_callback_errors_do_not_abort_fetch(monkeypatch):
    """A throwing progress callback is swallowed so the scan still completes."""

    pages = {
        None: {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "a"}],
            "pageInfo": {"hasNextPage": False, "endCursor": None}}}},
    }

    class PagingClient:
        def query(self, query, variables):
            return pages[variables.get("after")]

    def boom(*_a):
        raise RuntimeError("ui blew up")

    monkeypatch.setattr(os_vulns, "WizAPIClient", PagingClient)
    results = os_vulns.fetch_findings(dry_run=False, progress=boom)
    assert len(results["data"]["vulnerabilityFindings"]["nodes"]) == 1


def test_live_fetch_stops_on_repeating_cursor(monkeypatch):
    """A cursor that never advances can't spin the page loop forever."""

    class StuckClient:
        def query(self, query, variables):
            return {
                "data": {
                    "vulnerabilityFindings": {
                        "nodes": [{"id": "x", "severity": "LOW"}],
                        "pageInfo": {"hasNextPage": True, "endCursor": "same"},
                    }
                }
            }

    monkeypatch.setattr(os_vulns, "WizAPIClient", StuckClient)
    results = os_vulns.fetch_findings(dry_run=False)
    # First page collected, then the repeated "same" cursor halts the walk.
    assert len(results["data"]["vulnerabilityFindings"]["nodes"]) == 2
