"""Shared pytest fixtures for characterization + unit tests.

These pin the *current* behavior of the monolith before the refactor, then
travel with the functions as they move into the wiz_dashboard package.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "os_vulns_response_exemple.json"


@pytest.fixture(scope="session")
def app():
    """The monolith module. Top-level Streamlit calls are no-ops in bare mode."""
    import streamlit_app

    return streamlit_app


@pytest.fixture
def fixture_text():
    """Raw text of the committed sample response (note: malformed + grouped-by-asset)."""
    return FIXTURE_PATH.read_text(encoding="utf-8")


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
