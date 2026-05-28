"""Tests for the severity bar chart helper (Altair build + bare-mode render)."""

from wiz_dashboard.ui import charts


def test_severity_bar_renders_without_error():
    # st.altair_chart is a no-op in bare mode; assert the chart builds + renders.
    charts.severity_bar({"CRITICAL": 3, "HIGH": 1, "INFO": 0})
    charts.severity_bar({})  # empty -> caption path, must not raise


def test_build_severity_chart_uses_palette_and_severity_order():
    chart = charts.build_severity_chart({"HIGH": 2, "CRITICAL": 5})
    spec = chart.to_dict()
    scale = spec["encoding"]["color"]["scale"]
    assert scale["domain"] == ["CRITICAL", "HIGH"]  # severity order, not input order
    assert scale["range"] == ["#ef4444", "#f97316"]  # CRITICAL/HIGH palette colors


def test_build_severity_chart_empty_is_none():
    assert charts.build_severity_chart({}) is None
    assert charts.build_severity_chart({"CRITICAL": 0}) is None
