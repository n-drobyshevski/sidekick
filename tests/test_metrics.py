"""Characterization tests for severity / MTTR / formatting logic."""

import pandas as pd
import pytest


def test_normalize_severity(app):
    assert app.normalize_severity("informational") == "INFO"
    assert app.normalize_severity("INFO") == "INFO"
    assert app.normalize_severity("high") == "HIGH"
    assert app.normalize_severity("weird") == "UNKNOWN"
    assert app.normalize_severity(None) == "UNKNOWN"


def test_count_by_severity(app, flat_sample):
    df = app.nodes_to_dataframe(app.extract_nodes(flat_sample))
    assert app.count_by_severity(df) == {"CRITICAL": 1}
    assert app.count_by_severity(pd.DataFrame()) == {}


def test_format_duration(app):
    assert app.format_duration(None) == "—"
    assert app.format_duration(float("nan")) == "—"
    assert app.format_duration(0.01) == "<1h"
    assert app.format_duration(0.3) == "7h"
    assert app.format_duration(5.0) == "5.0d"
    assert app.format_duration(45.0) == "1.5mo"
    assert app.format_duration(400.0) == "1.1y"


def test_calculate_mttr_resolved(app, resolved_sample):
    df = app.nodes_to_dataframe(app.extract_nodes(resolved_sample))
    per, overall = app.calculate_mttr(df)
    high = per["HIGH"]
    assert high["open"] == 1
    assert high["resolved"] == 1
    assert high["mttr_median"] == 7.0
    assert high["sla_target"] == 14
    assert high["sla_pct"] == 100.0
    assert overall["resolved"] == 1
    assert overall["open"] == 1


def test_calculate_mttr_empty(app):
    assert app.calculate_mttr(pd.DataFrame()) == ({}, {})


def test_calculate_mttr_grouped_fixture_is_empty(app, fixture_text):
    df = app.nodes_to_dataframe(app.extract_nodes(fixture_text))
    assert app.calculate_mttr(df) == ({}, {})


@pytest.mark.xfail(
    raises=TypeError,
    strict=True,
    reason=(
        "PRE-EXISTING BUG: when findings have firstDetectedAt but NO resolvedAt "
        "column (the dry-run path), the all-NaT _resolved column is tz-naive and "
        "subtracting the tz-aware _first_seen raises TypeError. Fixed in the metrics "
        "refactor (Step 2/6) -- this xfail will turn XPASS and must become a real assert."
    ),
)
def test_calculate_mttr_without_resolved_column_BUG(app, flat_sample):
    df = app.nodes_to_dataframe(app.extract_nodes(flat_sample))
    app.calculate_mttr(df)
