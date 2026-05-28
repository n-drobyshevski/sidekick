"""Step 1: os_vulns is importable; fetch_findings replaces the runpy path."""

import os_vulns


def test_fetch_findings_dry_run_shape():
    results = os_vulns.fetch_findings(dry_run=True)
    nodes = results["data"]["vulnerabilityFindings"]["nodes"]
    assert len(nodes) == 1
    assert nodes[0]["id"] == "dry-1"
    assert nodes[0]["severity"] == "CRITICAL"


def test_cached_client_dry_run(app):
    # The cached data layer delegates to os_vulns.fetch_findings.
    from wiz_dashboard.data.client import fetch_findings

    results = fetch_findings(dry_run=True)
    nodes = app.extract_nodes(results)
    assert len(nodes) == 1
    assert nodes[0]["id"] == "dry-1"
