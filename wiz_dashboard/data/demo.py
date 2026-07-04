"""Evolving dry-run sample so the dashboard's scan-over-scan badges are demoable offline.

The committed flat sample (``os_vulns.SAMPLE_RESULTS``) is a single fixed snapshot, so
re-scanning it produces identical counts and every change badge reads ``±0``. This module
steps a *sequence* of synthetic snapshots whose per-severity counts move up and down, so
each successive dry-run scan lights up the severity-breakdown and KPI-band evolution chips
(and, via disappearing findings, the MTTR/SLA trend). It is a pure, app-layer concern —
the CLI ``os_vulns`` module stays the canonical, unchanging data source.

``evolving_flat_sample(seq)`` returns the raw ``vulnerabilityFindings`` shape for scan
number ``seq``: ``seq == 0`` is the untouched baseline (``SAMPLE_RESULTS``), so the first
scan and every non-evolving caller see today's data; ``seq >= 1`` cycles through
``_SCENARIOS``. Finding ids are stable per ``(severity, index)`` so a count rising adds new
vulns and a count falling lets the surplus disappear (resolved-by-disappearance in the
ledger) — a realistic lifecycle, not just a number swap.
"""

import os_vulns

# Per-severity target counts for each evolution step. Chosen so consecutive scans show a
# clear mix of rises (red) and falls (green) with round-ish percentages; the list cycles.
_SCENARIOS = [
    {"CRITICAL": 7, "HIGH": 3, "MEDIUM": 5, "LOW": 3, "INFO": 1},
    {"CRITICAL": 4, "HIGH": 4, "MEDIUM": 7, "LOW": 1, "INFO": 2},
    {"CRITICAL": 9, "HIGH": 6, "MEDIUM": 3, "LOW": 2, "INFO": 0},
    {"CRITICAL": 5, "HIGH": 5, "MEDIUM": 4, "LOW": 2, "INFO": 1},
]

_SEV_CODE = {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "LOW": 4, "INFO": 5}

# Small rotations so generated findings have varied, deterministic asset/context (the
# filters stay populated) and spread-out first-detected dates (so MTTR isn't degenerate
# when a finding later disappears). No clocks/randomness: the demo is fully reproducible.
_ASSETS = [
    ("web-prod-01", "VIRTUAL_MACHINE", "AWS"),
    ("registry/api:2.1", "CONTAINER_IMAGE", "GCP"),
    ("db-prod-01", "VIRTUAL_MACHINE", "Azure"),
    ("batch-fn-01", "SERVERLESS", "AWS"),
    ("cache-prod-03", "VIRTUAL_MACHINE", "Azure"),
]
_FIRST_DATES = [
    "2026-01-10", "2026-02-05", "2026-02-20", "2026-03-01",
    "2026-03-12", "2026-03-25", "2026-04-02", "2026-04-15", "2026-04-28",
]


def _finding(severity, i):
    """One deterministic OPEN finding for ``(severity, index)`` — stable id across scans."""
    asset, atype, cloud = _ASSETS[i % len(_ASSETS)]
    first = _FIRST_DATES[(i + _SEV_CODE[severity]) % len(_FIRST_DATES)]
    return {
        "id": f"demo-{severity.lower()}-{i}",
        "name": f"CVE-2026-{_SEV_CODE[severity]}{i:03d}",
        "severity": severity,
        "status": "OPEN",
        "vulnerableAsset": {"name": asset, "type": atype, "cloudPlatform": cloud},
        "fixedVersion": "1.0.0",
        "firstDetectedAt": f"{first}T00:00:00Z",
    }


def _scenario_response(spec):
    nodes = [
        _finding(severity, i)
        for severity, n in spec.items()
        for i in range(n)
    ]
    return {"data": {"vulnerabilityFindings": {"nodes": nodes}}}


def evolving_flat_sample(seq: int = 0):
    """Raw flat dry-run response for scan ``seq`` (0 = the unchanged ``SAMPLE_RESULTS``)."""
    if seq <= 0:
        return os_vulns.SAMPLE_RESULTS
    return _scenario_response(_SCENARIOS[(seq - 1) % len(_SCENARIOS)])


def incremental_flat_sample(seq: int):
    """Raw flat DELTA between demo scans ``seq - 1`` and ``seq`` — the offline stand-in
    for a live ``updatedAt``-filtered incremental fetch.

    Ids present only in scan ``seq`` are emitted as their new OPEN findings; ids present
    only in scan ``seq - 1`` are emitted as ``status=RESOLVED`` nodes with a deterministic
    ``resolvedAt``. That mirrors how the live API reports change: a resolution arrives as
    a re-listed RESOLVED node (API-declared), never as an absence — an incremental fetch
    genuinely cannot observe disappearances. Returns the canonical envelope with an empty
    ``nodes`` list when nothing changed. ``seq <= 0`` is the baseline scan itself, which
    has no predecessor to diff against → empty delta.
    """
    if seq <= 0:
        return {"data": {"vulnerabilityFindings": {"nodes": []}}}
    prev_nodes = evolving_flat_sample(seq - 1)["data"]["vulnerabilityFindings"]["nodes"]
    curr_nodes = evolving_flat_sample(seq)["data"]["vulnerabilityFindings"]["nodes"]
    prev_by_id = {n["id"]: n for n in prev_nodes}
    curr_ids = {n["id"] for n in curr_nodes}

    delta = [n for n in curr_nodes if n["id"] not in prev_by_id]  # new findings
    # Deterministic per-seq resolution stamp (no clocks — the demo stays reproducible).
    resolved_at = f"2026-05-{min(seq, 28):02d}T12:00:00Z"
    for node in prev_nodes:
        if node["id"] in curr_ids:
            continue
        gone = dict(node)  # never mutate the scenario/baseline node
        gone["status"] = "RESOLVED"
        gone["resolvedAt"] = resolved_at
        delta.append(gone)
    return {"data": {"vulnerabilityFindings": {"nodes": delta}}}
