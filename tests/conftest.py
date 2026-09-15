"""Shared pytest fixtures for the remaining Python domain/spec tests."""

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
# The grouped-by-asset shape (vulnerabilityFindingsGroupedByValues); the real live
# QUERY's flat shape has its own exact mock at os_vulns_response_exemple.json.
FIXTURE_PATH = REPO_ROOT / "os_vulns_grouped_response_example.json"


@pytest.fixture(autouse=True)
def _isolated_ledger(tmp_path, monkeypatch):
    """Point the durable ledger/history files at a per-test temp dir."""
    from wiz_dashboard import config
    from wiz_dashboard.data import history

    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(history, "HISTORY_FILENAME", str(tmp_path / "mttr_history.json"))
    yield


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

    The 10-asset ``os_vulns_grouped_response_example.json`` is valid JSON and serves as
    the default dry-run sample; this fixture loads it for end-to-end ingestion tests.
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
