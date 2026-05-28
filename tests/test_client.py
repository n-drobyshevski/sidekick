"""Step 1: os_vulns is importable; fetch_findings replaces the runpy path."""

import os_vulns


def test_fetch_findings_dry_run_shape():
    results = os_vulns.fetch_findings(dry_run=True)
    nodes = results["data"]["vulnerabilityFindings"]["nodes"]
    assert len(nodes) == 1
    assert nodes[0]["id"] == "dry-1"
    assert nodes[0]["severity"] == "CRITICAL"


def test_run_os_vulns_internal_matches_fetch_findings(app):
    # The app's internal fetch now delegates to os_vulns.fetch_findings (no runpy).
    internal = app._run_os_vulns_internal(dry_run=True)
    assert internal == os_vulns.fetch_findings(dry_run=True)
    nodes = app.extract_nodes(internal)
    assert len(nodes) == 1
    assert nodes[0]["id"] == "dry-1"
