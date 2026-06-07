"""Tests for the chart helpers (Altair build + bare-mode render)."""

import json

import pandas as pd

from wiz_dashboard.ui import charts


def test_severity_bar_renders_without_error():
    # st.altair_chart is a no-op in bare mode; assert the chart builds + renders.
    charts.severity_bar({"CRITICAL": 3, "HIGH": 1, "INFO": 0})
    charts.severity_bar({})  # empty -> caption path, must not raise


def test_build_severity_chart_uses_palette_and_severity_order():
    chart = charts.build_severity_chart({"HIGH": 2, "CRITICAL": 5})
    spec = chart.to_dict()
    # Layered now (bars + value-label text); the colored bars are the first layer.
    bars = spec["layer"][0]
    scale = bars["encoding"]["color"]["scale"]
    assert scale["domain"] == ["CRITICAL", "HIGH"]  # severity order, not input order
    assert scale["range"] == ["#dc2626", "#ea580c"]  # CRITICAL/HIGH palette colors


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


def test_severity_chart_has_value_labels_layer():
    spec = charts.build_severity_chart({"CRITICAL": 5, "HIGH": 2}).to_dict()
    # Two layers: colored bars + a text mark carrying the count labels.
    marks = {layer.get("mark", {}).get("type") if isinstance(layer.get("mark"), dict)
             else layer.get("mark") for layer in spec["layer"]}
    assert "bar" in marks and "text" in marks


def test_build_open_resolved_trend():
    assert charts.build_open_resolved_trend(None) is None
    df = pd.DataFrame(
        {"date": pd.to_datetime(["2026-05-20", "2026-05-21"]), "open": [5, 3], "resolved": [1, 4]}
    )
    spec = charts.build_open_resolved_trend(df).to_dict()
    # Series distinguished by BOTH color and dash (a11y: not color alone).
    assert "strokeDash" in spec["encoding"] and "color" in spec["encoding"]


def test_renderers_do_not_raise():
    charts.open_resolved_trend(None)


def test_build_severity_chart_selectable_adds_selection_param():
    # selectable -> a point-selection param is attached so on_select reports clicks.
    sel_spec = charts.build_severity_chart({"CRITICAL": 3}, selectable=True).to_dict()
    assert "sevsel" in json.dumps(sel_spec)
    # default build has no selection param (keeps the grouped/static render clean).
    plain_spec = charts.build_severity_chart({"CRITICAL": 3}).to_dict()
    assert "sevsel" not in json.dumps(plain_spec)


def test_selected_severities_parses_event_shapes():
    class Evt:  # attribute-style selection (Streamlit's DeltaGenerator event)
        selection = {"sevsel": [{"severity": "critical"}, {"severity": "HIGH"}]}

    assert charts._selected_severities(Evt()) == ["CRITICAL", "HIGH"]
    # dict-style event + de-dup + normalize-case
    assert charts._selected_severities(
        {"selection": {"p": [{"severity": "low"}, {"severity": "LOW"}]}}
    ) == ["LOW"]
    # nothing selected
    assert charts._selected_severities({"selection": {}}) == []
    assert charts._selected_severities(None) == []


# --------------------------------------------------------------------------- #
#  Trend hardening: day-aggregation + non-finite guards (the ledger trend stamps
#  one row per scan timestamp, so sub-day scans must collapse to one point per UTC
#  day, and an all-null slice must not reach Vega — it warns "Infinite extent").
# --------------------------------------------------------------------------- #
def test_daily_collapses_to_one_row_per_utc_day_latest_wins():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(
                ["2026-05-30T18:00:00Z", "2026-05-30T20:00:00Z", "2026-05-31T09:00:00Z"],
                utc=True,
            ),
            "median_days": [10.0, 20.0, 30.0],
            "resolved": [1, 2, 3],
            "open": [9, 8, 7],
        }
    )
    daily = charts._daily(df, ["median_days"])
    assert len(daily) == 2  # two distinct UTC days, not three scans
    may30 = daily[daily["date"] == pd.Timestamp("2026-05-30")]
    assert float(may30["median_days"].iloc[0]) == 20.0  # latest reading that day wins
    assert int(may30["resolved"].iloc[0]) == 2  # sibling columns ride along from that row


def test_daily_drops_nonfinite_value_rows_and_empties_cleanly():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-05-30T18:00:00Z", "2026-05-31T09:00:00Z"], utc=True),
            "median_days": [None, 12.0],
        }
    )
    daily = charts._daily(df, ["median_days"])
    assert len(daily) == 1 and float(daily["median_days"].iloc[0]) == 12.0
    # all-null -> empty frame (so the builder can return None instead of an infinite extent)
    allnull = pd.DataFrame(
        {"date": pd.to_datetime(["2026-05-30T18:00:00Z"], utc=True), "median_days": [None]}
    )
    assert charts._daily(allnull, ["median_days"]).empty


def test_build_mttr_trend_none_when_no_finite_values():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-05-30T18:00:00Z", "2026-05-30T20:00:00Z"], utc=True),
            "median_days": [None, None],
        }
    )
    assert charts.build_mttr_trend(df) is None  # guards Vega "Infinite extent"


def test_build_mttr_trend_collapses_subday_and_labels_axis():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(
                ["2026-05-30T18:00:00Z", "2026-05-30T22:00:00Z", "2026-05-31T09:00:00Z"],
                utc=True,
            ),
            "median_days": [10.0, 15.0, 20.0],
            "resolved": [1, 2, 3],
            "open": [3, 2, 1],
        }
    )
    chart = charts.build_mttr_trend(df)
    spec = chart.to_dict()
    assert spec["encoding"]["x"]["title"] == "Date"  # x-axis is labeled now
    assert charts._daily(df, ["median_days"]).shape[0] == 2  # one point per day, not per scan


def test_build_open_resolved_trend_collapses_by_day():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(
                ["2026-05-30T18:00:00Z", "2026-05-30T22:00:00Z", "2026-05-31T09:00:00Z"],
                utc=True,
            ),
            "open": [5, 4, 3],
            "resolved": [1, 2, 4],
        }
    )
    assert charts.build_open_resolved_trend(df) is not None
    assert charts._daily(df, ["open", "resolved"]).shape[0] == 2


def test_trend_renderers_handle_subday_timestamps_without_error():
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-05-30T18:00:00Z", "2026-05-30T20:00:00Z"], utc=True),
            "median_days": [10.0, 12.0],
            "open": [3, 2],
            "resolved": [1, 2],
        }
    )
    charts.mttr_trend(df)  # single distinct day -> sparse-note path, must not raise
    charts.open_resolved_trend(df)
