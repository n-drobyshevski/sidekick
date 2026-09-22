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
    os_vulns.fetch_findings(dry_run=False, progress=lambda p, n, t: seen.append((p, n, t)))
    # (page, cumulative findings, totalCount) after each page; no totalCount in the
    # payload -> total is None on every call.
    assert seen == [(1, 2, None), (2, 3, None)]


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


def test_live_fetch_probes_max_page_size_and_total_count(monkeypatch):
    """Pages request the 5000 max, and totalCount is asked for on the first page only."""

    pages = {
        None: {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "pageInfo": {"hasNextPage": True, "endCursor": "c1"},
            "totalCount": 3}}},
        "c1": {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "c"}],
            "pageInfo": {"hasNextPage": False, "endCursor": None}}}},
    }
    seen_variables = []

    class PagingClient:
        def query(self, query, variables):
            seen_variables.append(variables)
            return pages[variables.get("after")]

    monkeypatch.setattr(os_vulns, "WizAPIClient", PagingClient)
    seen = []
    os_vulns.fetch_findings(dry_run=False, progress=lambda p, n, t: seen.append((p, n, t)))

    assert [v["first"] for v in seen_variables] == [os_vulns.PAGE_SIZE_MAX] * 2
    # totalCount is an expensive server-side join -- first page only.
    assert [v["includeTotalCount"] for v in seen_variables] == [True, False]
    # The first page's totalCount reaches the progress callback on every page.
    assert seen == [(1, 2, 3), (2, 3, 3)]


def test_live_fetch_falls_back_when_max_page_size_raises(monkeypatch):
    """A tenant that rejects first=5000 with an error still yields a full fetch at 500."""

    pages = {
        None: {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "a"}],
            "pageInfo": {"hasNextPage": True, "endCursor": "c1"},
            "totalCount": 2}}},
        "c1": {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "b"}],
            "pageInfo": {"hasNextPage": False, "endCursor": None}}}},
    }
    seen_firsts = []

    class PickyClient:
        def query(self, query, variables):
            seen_firsts.append(variables["first"])
            if variables["first"] > os_vulns.PAGE_SIZE_FALLBACK:
                raise RuntimeError("first exceeds maximum")
            return pages[variables.get("after")]

    monkeypatch.setattr(os_vulns, "WizAPIClient", PickyClient)
    results = os_vulns.fetch_findings(dry_run=False)

    nodes = results["data"]["vulnerabilityFindings"]["nodes"]
    assert [n["id"] for n in nodes] == ["a", "b"]  # cursor chain still fully walked
    # One rejected probe at the max, then the whole walk at the fallback size.
    assert seen_firsts == [os_vulns.PAGE_SIZE_MAX,
                           os_vulns.PAGE_SIZE_FALLBACK, os_vulns.PAGE_SIZE_FALLBACK]


def test_live_fetch_falls_back_on_errors_only_payload(monkeypatch):
    """A rejected first=5000 that surfaces as a GraphQL errors payload (no connection)
    retries at 500 instead of silently completing with zero findings."""

    class ErrorPayloadClient:
        def query(self, query, variables):
            if variables["first"] > os_vulns.PAGE_SIZE_FALLBACK:
                return {"errors": [{"message": "first exceeds maximum size"}]}
            return {"data": {"vulnerabilityFindings": {
                "nodes": [{"id": "a"}],
                "pageInfo": {"hasNextPage": False, "endCursor": None}}}}

    monkeypatch.setattr(os_vulns, "WizAPIClient", ErrorPayloadClient)
    results = os_vulns.fetch_findings(dry_run=False)
    assert [n["id"] for n in results["data"]["vulnerabilityFindings"]["nodes"]] == ["a"]


def test_live_fetch_error_after_first_page_still_raises(monkeypatch):
    """The fallback only guards the first-page size probe -- a mid-walk failure is real."""

    class FlakyClient:
        def query(self, query, variables):
            if variables.get("after") is None:
                return {"data": {"vulnerabilityFindings": {
                    "nodes": [{"id": "a"}],
                    "pageInfo": {"hasNextPage": True, "endCursor": "c1"}}}}
            raise RuntimeError("boom mid-walk")

    monkeypatch.setattr(os_vulns, "WizAPIClient", FlakyClient)
    with pytest.raises(RuntimeError, match="boom mid-walk"):
        os_vulns.fetch_findings(dry_run=False)


def test_delta_filter_rides_every_page_with_baseline_filters(monkeypatch):
    """extra_filter_by lands in filterBy on every page, merged OVER the baseline filters
    (status incl. RESOLVED must survive, or the delta would miss resolutions)."""

    pages = {
        None: {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "a"}],
            "pageInfo": {"hasNextPage": True, "endCursor": "c1"}}}},
        "c1": {"data": {"vulnerabilityFindings": {
            "nodes": [{"id": "b"}],
            "pageInfo": {"hasNextPage": False, "endCursor": None}}}},
    }
    seen_variables = []

    class PagingClient:
        def query(self, query, variables):
            seen_variables.append(variables)
            return pages[variables.get("after")]

    monkeypatch.setattr(os_vulns, "WizAPIClient", PagingClient)
    since = {"updatedAt": {"after": "2026-07-01T00:00:00Z"}}
    results = os_vulns.fetch_findings(dry_run=False, extra_filter_by=since)

    assert len(results["data"]["vulnerabilityFindings"]["nodes"]) == 2
    for v in seen_variables:
        assert v["filterBy"]["updatedAt"] == {"after": "2026-07-01T00:00:00Z"}
        assert v["filterBy"]["status"] == ["OPEN", "RESOLVED"]  # baseline filter intact


def test_delta_filter_survives_page_size_fallback(monkeypatch):
    """Both first-page fallback retries must re-carry the extra filter — a dropped filter
    would silently turn the delta into a partial full scan."""

    seen = []

    class PickyClient:
        def query(self, query, variables):
            seen.append(variables)
            if variables["first"] > os_vulns.PAGE_SIZE_FALLBACK:
                raise RuntimeError("first exceeds maximum")
            return {"data": {"vulnerabilityFindings": {
                "nodes": [{"id": "a"}],
                "pageInfo": {"hasNextPage": False, "endCursor": None}}}}

    monkeypatch.setattr(os_vulns, "WizAPIClient", PickyClient)
    since = {"updatedAt": {"after": "2026-07-01T00:00:00Z"}}
    results = os_vulns.fetch_findings(dry_run=False, extra_filter_by=since)

    assert len(results["data"]["vulnerabilityFindings"]["nodes"]) == 1
    assert len(seen) == 2  # rejected max probe + fallback retry
    for v in seen:
        assert v["filterBy"]["updatedAt"] == {"after": "2026-07-01T00:00:00Z"}


def test_delta_errors_only_payload_raises_not_zero_findings(monkeypatch):
    """With a delta filter, an errors-only first page must raise WizDeltaFilterError —
    silently returning 0 nodes would be indistinguishable from an empty delta and let
    a stale baseline be re-persisted as fresh. Without the filter, the tolerant 0-node
    behavior is unchanged (regression guard)."""

    class ErrorsOnlyClient:
        def query(self, query, variables):
            return {"errors": [{"message": "unknown filter field updatedAt"}]}

    monkeypatch.setattr(os_vulns, "WizAPIClient", ErrorsOnlyClient)
    with pytest.raises(os_vulns.WizDeltaFilterError):
        os_vulns.fetch_findings(
            dry_run=False, extra_filter_by={"updatedAt": {"after": "2026-07-01T00:00:00Z"}}
        )

    # Same payload WITHOUT the delta filter: tolerated as an empty (0-finding) scan.
    results = os_vulns.fetch_findings(dry_run=False)
    assert results["data"]["vulnerabilityFindings"]["nodes"] == []


def test_extra_filter_does_not_mutate_module_variables(monkeypatch):
    """The per-call filter merge must never leak into the module-global VARIABLES."""

    class OnePageClient:
        def query(self, query, variables):
            return {"data": {"vulnerabilityFindings": {
                "nodes": [], "pageInfo": {"hasNextPage": False, "endCursor": None}}}}

    monkeypatch.setattr(os_vulns, "WizAPIClient", OnePageClient)
    os_vulns.fetch_findings(dry_run=False,
                            extra_filter_by={"updatedAt": {"after": "2026-07-01T00:00:00Z"}})
    assert "updatedAt" not in os_vulns.VARIABLES["filterBy"]


