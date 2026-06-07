"""Shared pytest fixtures for characterization + unit tests.

These pin the *current* behavior of the monolith before the refactor, then
travel with the functions as they move into the wiz_dashboard package.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "os_vulns_response_exemple.json"


@pytest.fixture(autouse=True)
def _isolated_ledger(tmp_path, monkeypatch):
    """Point the durable ledger at a per-test temp dir and reset its caches.

    Without this, any test that triggers a scan (e.g. clicking ``sidebar_run``) would write a
    real ``./data/ledger.db`` in the repo and leak state into later tests — notably the
    MTTR empty-state test, which needs the ledger to be empty. ``config.DATA_DIR`` is read
    at call time, so monkeypatching it isolates every read/write to ``tmp_path``.
    """
    from wiz_dashboard import config
    from wiz_dashboard.data import history
    from wiz_dashboard.ui.pages import _derived

    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    # Also keep the legacy daily-median file out of the repo when a test triggers a scan.
    monkeypatch.setattr(history, "HISTORY_FILENAME", str(tmp_path / "mttr_history.json"))
    caches = (
        _derived.ledger_mttr_cached,
        _derived.ledger_scans_cached,
        _derived.ledger_base_cached,
        _derived.ledger_trend_cached,
        _derived.previous_severity_counts_cached,
    )
    for c in caches:
        c.clear()
    yield
    for c in caches:
        c.clear()


@pytest.fixture(scope="session")
def app():
    """Namespace of the relocated pure-logic functions (formerly the monolith)."""
    import types

    from wiz_dashboard.data import transform
    from wiz_dashboard.domain import formatting, metrics, severity

    return types.SimpleNamespace(
        coerce_results=transform.coerce_results,
        extract_nodes=transform.extract_nodes,
        nodes_to_dataframe=transform.nodes_to_dataframe,
        count_by_severity=severity.count_by_severity,
        normalize_severity=severity.normalize_severity,
        calculate_mttr=metrics.calculate_mttr,
        format_duration=formatting.format_duration,
    )


@pytest.fixture
def fixture_text():
    """Raw text of the committed sample response (valid JSON, grouped-by-asset)."""
    return FIXTURE_PATH.read_text(encoding="utf-8")


@pytest.fixture
def grouped_sample():
    """Parsed committed grouped-by-asset response (the real Wiz API shape).

    The 10-asset ``os_vulns_response_exemple.json`` is now valid JSON and serves as the
    default dry-run sample; this fixture loads it for end-to-end ingestion tests.
    """
    import json

    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def flat_sample():
    """Flat per-finding response with firstDetectedAt but NO resolvedAt column.

    Mirrors the os_vulns.py --dry-run sample (the buggy MTTR path).
    """
    return {
        "data": {
            "vulnerabilityFindings": {
                "nodes": [
                    {
                        "id": "dry-1",
                        "name": "sample-vuln",
                        "severity": "CRITICAL",
                        "vulnerableAsset": {"name": "vm-sample"},
                        "fixedVersion": "1.2.3",
                        "firstDetectedAt": "2026-05-27T00:00:00Z",
                    }
                ]
            }
        }
    }


@pytest.fixture
def resolved_sample():
    """Flat findings WITH resolvedAt + status (the working MTTR path)."""
    return {
        "data": {
            "vulnerabilityFindings": {
                "nodes": [
                    {
                        "id": "a",
                        "severity": "HIGH",
                        "status": "RESOLVED",
                        "firstDetectedAt": "2026-04-01T00:00:00Z",
                        "resolvedAt": "2026-04-08T00:00:00Z",
                    },
                    {
                        "id": "b",
                        "severity": "HIGH",
                        "status": "OPEN",
                        "firstDetectedAt": "2026-05-01T00:00:00Z",
                        "resolvedAt": None,
                    },
                ]
            }
        }
    }
