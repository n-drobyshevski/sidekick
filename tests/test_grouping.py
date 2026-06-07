"""Unit tests for the findings 'Group by' splitting helper (pure pandas, no Streamlit)."""

import pandas as pd

from wiz_dashboard.ui.pages import os_vulns

_DF = pd.DataFrame(
    {
        "severity": ["HIGH", "CRITICAL", "informational", "HIGH", "LOW", "CRITICAL"],
        "vulnerableAsset.type": ["VM", "VM", "Container", "VM", "Container", "Function"],
        "vulnerableAsset.cloudPlatform": ["AWS", "AWS", "GCP", "Azure", "GCP", "GCP"],
    }
)


def _labels(groups):
    return [label for label, _ in groups]


def test_severity_groups_ordered_severest_first_and_normalized():
    groups = os_vulns._grouped_frames(_DF, "severity", None, None)
    # "informational" normalizes to INFO; absent severities (MEDIUM/UNKNOWN) are skipped.
    assert _labels(groups) == ["CRITICAL", "HIGH", "LOW", "INFO"]
    sizes = {label: len(sub) for label, sub in groups}
    assert sizes == {"CRITICAL": 2, "HIGH": 2, "LOW": 1, "INFO": 1}


def test_asset_type_groups_busiest_first():
    groups = os_vulns._grouped_frames(_DF, "atype", "vulnerableAsset.type", None)
    assert _labels(groups) == ["VM", "Container", "Function"]  # 3, 2, 1


def test_cloud_groups_busiest_first():
    groups = os_vulns._grouped_frames(_DF, "cloud", None, "vulnerableAsset.cloudPlatform")
    assert _labels(groups)[0] == "GCP"  # 3 findings, the busiest


def test_subframe_counts_sum_to_input_and_preserve_index():
    for mode, t, c in [
        ("severity", None, None),
        ("atype", "vulnerableAsset.type", None),
        ("cloud", None, "vulnerableAsset.cloudPlatform"),
    ]:
        groups = os_vulns._grouped_frames(_DF, mode, t, c)
        assert sum(len(sub) for _, sub in groups) == len(_DF)
        # Index is preserved per subframe (required for the drill-down to resolve rows).
        for _, sub in groups:
            assert sub.index.isin(_DF.index).all()
