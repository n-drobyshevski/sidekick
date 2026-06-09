"""Unit tests for the findings 'Group by' splitting helper (pure pandas, no Streamlit)."""

import pandas as pd

from wiz_dashboard.ui.pages import os_vulns

_DF = pd.DataFrame(
    {
        "severity": ["HIGH", "CRITICAL", "informational", "HIGH", "LOW", "CRITICAL"],
        "status": ["OPEN", "OPEN", "RESOLVED", "OPEN", "RESOLVED", "OPEN"],
        "vulnerableAsset.name": ["vm-a", "vm-a", "img-b", "vm-c", "img-b", "fn-d"],
        "vulnerableAsset.type": ["VM", "VM", "Container", "VM", "Container", "Function"],
        "vulnerableAsset.cloudPlatform": ["AWS", "AWS", "GCP", "Azure", "GCP", "GCP"],
        "vulnerableAsset.subscriptionName": ["prod", "prod", "dev", "prod", "dev", "dev"],
    }
)


def _labels(groups):
    return [label for label, _ in groups]


def test_severity_groups_ordered_severest_first_and_normalized():
    groups = os_vulns._grouped_frames(_DF, "severity", "severity")
    # "informational" normalizes to INFO; absent severities (MEDIUM/UNKNOWN) are skipped.
    assert _labels(groups) == ["CRITICAL", "HIGH", "LOW", "INFO"]
    sizes = {label: len(sub) for label, sub in groups}
    assert sizes == {"CRITICAL": 2, "HIGH": 2, "LOW": 1, "INFO": 1}


def test_asset_type_groups_busiest_first():
    groups = os_vulns._grouped_frames(_DF, "atype", "vulnerableAsset.type")
    assert _labels(groups) == ["VM", "Container", "Function"]  # 3, 2, 1


def test_cloud_groups_busiest_first():
    groups = os_vulns._grouped_frames(_DF, "cloud", "vulnerableAsset.cloudPlatform")
    assert _labels(groups)[0] == "GCP"  # 3 findings, the busiest


def test_status_groups_busiest_first():
    groups = os_vulns._grouped_frames(_DF, "status", "status")
    assert _labels(groups) == ["OPEN", "RESOLVED"]  # 4, 2


def test_asset_groups_busiest_first():
    groups = os_vulns._grouped_frames(_DF, "asset", "vulnerableAsset.name")
    assert _labels(groups)[0] == "vm-a"  # 2 findings, the busiest


def test_subscription_groups_present():
    groups = os_vulns._grouped_frames(_DF, "subscription", "vulnerableAsset.subscriptionName")
    assert set(_labels(groups)) == {"prod", "dev"}  # 3, 3


def test_subframe_counts_sum_to_input_and_preserve_index():
    for mode, col in [
        ("severity", "severity"),
        ("status", "status"),
        ("atype", "vulnerableAsset.type"),
        ("cloud", "vulnerableAsset.cloudPlatform"),
        ("asset", "vulnerableAsset.name"),
        ("subscription", "vulnerableAsset.subscriptionName"),
    ]:
        groups = os_vulns._grouped_frames(_DF, mode, col)
        assert sum(len(sub) for _, sub in groups) == len(_DF)
        # Index is preserved per subframe (required for the drill-down to resolve rows).
        for _, sub in groups:
            assert sub.index.isin(_DF.index).all()


def test_group_columns_only_offers_present_fields():
    df = pd.DataFrame({"severity": ["HIGH"], "status": ["OPEN"]})
    assert os_vulns._group_columns(df) == {"Severity": "severity", "Status": "status"}


def test_group_columns_resolves_candidate_fallbacks():
    df = pd.DataFrame({"type": ["VM"], "cloudPlatform": ["AWS"]})
    assert os_vulns._group_columns(df) == {"Asset type": "type", "Cloud": "cloudPlatform"}


# --- Per-group compact stats -------------------------------------------------

def test_group_stats_severity_distribution_severest_first():
    sub = _DF[_DF["vulnerableAsset.subscriptionName"] == "prod"]  # HIGH, CRITICAL, HIGH
    stats = os_vulns._group_stats(sub, "subscription", len(_DF))
    assert stats["n"] == 3
    # Present severities only, ordered severest-first (dict insertion order).
    assert list(stats["severity"].keys()) == ["CRITICAL", "HIGH"]
    assert stats["severity"] == {"CRITICAL": 1, "HIGH": 2}


def test_group_stats_open_resolved_split_and_assets():
    sub = _DF[_DF["vulnerableAsset.subscriptionName"] == "dev"]  # 3 rows: 2 RESOLVED, 1 OPEN
    stats = os_vulns._group_stats(sub, "subscription", len(_DF))
    assert (stats["open"], stats["resolved"]) == (1, 2)
    # dev spans img-b (x2) + fn-d -> 2 distinct assets.
    assert stats["assets"] == 2


def test_group_stats_share_of_total():
    sub = _DF[_DF["vulnerableAsset.subscriptionName"] == "prod"]
    stats = os_vulns._group_stats(sub, "subscription", len(_DF))
    assert stats["share"] == 3 / 6


def test_group_stats_skips_severity_when_grouping_by_severity():
    sub = _DF[_DF["severity"] == "HIGH"]
    stats = os_vulns._group_stats(sub, "severity", len(_DF))
    assert stats["severity"] == {}  # redundant: every row already shares the severity


def test_group_stats_omits_assets_when_grouping_by_asset():
    sub = _DF[_DF["vulnerableAsset.name"] == "vm-a"]
    stats = os_vulns._group_stats(sub, "asset", len(_DF))
    assert stats["assets"] is None  # constant 1 per asset group adds nothing


def test_group_stats_tolerates_missing_columns():
    df = pd.DataFrame({"severity": ["HIGH", "CRITICAL"]})  # no status / asset columns
    stats = os_vulns._group_stats(df, "severity", 2)
    assert stats["open"] is None and stats["resolved"] is None
    assert stats["assets"] is None


def test_group_header_appends_severity_glyphs_for_non_severity_modes():
    sub = _DF[_DF["vulnerableAsset.subscriptionName"] == "prod"]
    stats = os_vulns._group_stats(sub, "subscription", len(_DF))
    header = os_vulns._group_header("prod", "subscription", stats)
    assert header.startswith("prod · 3")
    assert "🔴 1" in header and "🟠 2" in header  # severest-first glyph summary


def test_group_header_severity_mode_keeps_single_glyph():
    sub = _DF[_DF["severity"] == "CRITICAL"]
    stats = os_vulns._group_stats(sub, "severity", len(_DF))
    header = os_vulns._group_header("CRITICAL", "severity", stats)
    assert header == "🔴 CRITICAL · 2"


def test_group_stats_strip_html_renders_bar_legend_and_meta():
    sub = _DF[_DF["vulnerableAsset.subscriptionName"] == "dev"]
    stats = os_vulns._group_stats(sub, "subscription", len(_DF))
    html = os_vulns._group_stats_strip_html(stats)
    assert "group-stats__bar" in html and "group-stats__seg" in html
    assert "sev-dot" in html  # accessible dot legend, not color alone
    assert "open" in html and "resolved" in html and "of findings" in html
    assert "var(--sev-critical)" in html  # bar segment uses the severity token


def test_group_stats_strip_html_skips_bar_without_severity_mix():
    df = pd.DataFrame({"status": ["OPEN", "RESOLVED"]})  # no severity column
    stats = os_vulns._group_stats(df, "status", 2)
    html = os_vulns._group_stats_strip_html(stats)
    assert "group-stats__bar" not in html  # nothing to plot
    assert "of findings" in html  # but the meta line still renders
