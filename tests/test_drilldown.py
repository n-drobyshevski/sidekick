"""Unit tests for the finding drill-down helpers (pure logic behind the st.dialog)."""

import pandas as pd

from wiz_dashboard.ui.pages import os_vulns


def test_record_to_dict_drops_private_and_nan():
    s = pd.Series({"severity": "HIGH", "_internal": 1, "empty": None, "count": 5})
    d = os_vulns._record_to_dict(s)
    assert d["severity"] == "HIGH"
    assert d["count"] == 5
    assert "_internal" not in d
    assert "empty" not in d


def test_summary_fields_picks_present_in_order():
    record = {
        "severity": "CRITICAL",
        "vulnerableAsset.name": "vm-1",
        "firstDetectedAt": "2026-01-01T00:00:00Z",
        "fixedVersion": "1.2.3",
    }
    fields = dict(os_vulns._summary_fields(record))
    assert fields["Severity"] == "CRITICAL"
    assert fields["Asset"] == "vm-1"
    assert fields["First detected"] == "2026-01-01T00:00:00Z"
    assert fields["Fixed version"] == "1.2.3"
    assert "Status" not in fields  # absent fields are skipped


def test_raw_node_maps_position_to_node():
    df = pd.DataFrame([{"a": 1}, {"a": 2}, {"a": 3}])
    nodes = [{"id": "n0"}, {"id": "n1"}, {"id": "n2"}]
    assert os_vulns._raw_node(df, 1, nodes) == {"id": "n1"}
    assert os_vulns._raw_node(df, 0, None) is None
