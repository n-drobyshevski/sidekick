"""Tests for the chart helpers (Altair build + bare-mode render)."""

import pandas as pd

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


def test_build_mttr_trend_none_when_empty():
    assert charts.build_mttr_trend(None) is None
    assert charts.build_mttr_trend(pd.DataFrame()) is None


def test_build_mttr_trend_builds_line():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-05-20", "2026-05-21"]),
            "median_days": [7.0, 5.0],
            "resolved": [3, 4],
            "open": [1, 0],
        }
    )
    spec = charts.build_mttr_trend(df).to_dict()
    assert spec["encoding"]["y"]["field"] == "median_days"
    assert spec["encoding"]["x"]["field"] == "date"
    assert spec["mark"]["type"] == "line"


def test_mttr_trend_renders_without_error():
    charts.mttr_trend(pd.DataFrame())  # empty -> caption path
    df = pd.DataFrame({"date": pd.to_datetime(["2026-05-20"]), "median_days": [7.0]})
    charts.mttr_trend(df)
