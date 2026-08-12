"""Kaplan-Meier time-to-remediate.

The naive median averages only what closed, so it is survivorship bias with a respectable
name: the slowest findings are disproportionately the ones still open, and excluding them
flatters the programme exactly when it is falling behind. These tests pin the censoring-aware
estimator against hand-computed curves, and assert the direction of the correction.

Oracle: gas/src/domain/remediation.ts::kaplanMeier.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("pyspark")


BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import metrics  # noqa: E402


SCHEMA = "severity STRING, mttr_days DOUBLE, age_days DOUBLE, resolved_at TIMESTAMP"


def observations(spark, rows, severity="HIGH"):
    """rows: (duration_days, is_event). Events carry mttr_days and a resolved_at; censored
    rows carry age_days and no resolution -- the shape silver_findings produces."""
    import datetime as dt

    resolved = dt.datetime(2026, 6, 1)
    data = [
        (
            severity,
            float(d) if event else None,
            None if event else float(d),
            resolved if event else None,
        )
        for d, event in rows
    ]
    return spark.createDataFrame(data, SCHEMA)


def km(spark, rows, severity="HIGH"):
    out = metrics.kaplan_meier(observations(spark, rows, severity)).collect()
    return {r["severity"]: r.asDict() for r in out}[severity]


# ------------------------------------------------------------------ the worked curve


def test_survival_curve_and_median(spark):
    """Three observations: resolved at 5, still open at 6, resolved at 8.

        t=5: atRisk = #{>=5} = 3, d=1 -> S = 1 - 1/3 = 0.667
        t=8: atRisk = #{>=8} = 1, d=1 -> S = 0.667 x 0 = 0
        median = smallest t with S <= 0.5 = 8
    """
    got = km(spark, [(5, True), (6, False), (8, True)])
    assert got["km_median"] == pytest.approx(8.0)
    assert got["km_events"] == 2
    assert got["km_censored"] == 1
    assert got["km_restriction_time"] == pytest.approx(8.0)


def test_km_median_exceeds_the_naive_median(spark):
    """The whole point. Naive median over the closed rows [5, 8] is 6.5; KM says 8, because
    the finding still open at day 6 is evidence that closing is slower than the closed rows
    alone suggest."""
    rows = [(5, True), (6, False), (8, True)]
    got = km(spark, rows)
    naive_pdf = metrics.mttr_by_severity(observations(spark, rows)).toPandas()
    naive = naive_pdf.set_index("severity").loc["HIGH", "mttr_median"]
    assert naive == pytest.approx(6.5)
    assert got["km_median"] > naive


def test_rmst_is_the_area_under_the_staircase(spark):
    """RMST = S_0(t_1-t_0) + S_1(t_2-t_1) + S_2(tau-t_2)
             = 1x5 + 0.667x3 + 0x0 = 7.0
    """
    got = km(spark, [(5, True), (6, False), (8, True)])
    assert got["km_rmst"] == pytest.approx(7.0, rel=1e-6)
    assert got["km_truncated"] is False  # survival reached 0 by tau


def test_survival_landing_exactly_on_half_is_a_median(spark):
    """Regression for a float artifact that cost a real answer.

        events 15 and 21, censored at 60 and 90
        t=15: atRisk 4, d=1 -> S = 0.75
        t=21: atRisk 3, d=1 -> S = 0.75 x 2/3 = exactly 0.5 -> median = 21

    Computing S as exp(Σ log f) instead of a running product returns 0.5000000000000001 here,
    which fails a bare `S <= 0.5` and reports NO median for a register whose median is 21 days.
    This exact shape came out of the smoke fixture, not from imagination.
    """
    got = km(spark, [(15, True), (21, True), (60, False), (90, False)])
    assert got["km_median"] == pytest.approx(21.0)


# --------------------------------------------------------- the honest-unknown cases


def test_median_is_null_under_heavy_censoring(spark):
    """One resolved at 5, three still open at 100. S never falls below 0.75, so there is no
    median -- and inventing one from the single closed finding would report 5 days for a
    programme that has remediated one thing in a hundred days."""
    got = km(spark, [(5, True), (100, False), (100, False), (100, False)])
    assert got["km_median"] is None
    assert got["km_median_lower_bound"] == pytest.approx(100.0), "so a reader can say '> 100d'"
    assert got["km_truncated"] is True


def test_all_censored_yields_no_curve_but_keeps_the_counts(spark):
    got = km(spark, [(10, False), (20, False)])
    assert got["km_median"] is None
    assert got["km_rmst"] is None
    assert got["km_events"] == 0
    assert got["km_censored"] == 2
    assert got["km_median_lower_bound"] == pytest.approx(20.0)


def test_a_wiped_out_risk_set_drives_survival_to_zero(spark):
    """Regression for the Spark-specific trap: S is a running product, and exp(sum(log f)) is
    the usual substitute -- but log(0) is NULL in Spark and sum() skips NULLs, so the step that
    resolves everything would be ignored and survival would stay positive after the last
    finding closed."""
    got = km(spark, [(3, True), (3, True)])
    assert got["km_median"] == pytest.approx(3.0)
    assert got["km_truncated"] is False
    assert got["km_rmst"] == pytest.approx(3.0)


def test_censoring_after_the_last_event_extends_the_rmst(spark):
    """A finding still open at 50 cannot change the median, but it does extend tau, so the
    restricted mean has to account for the time survival stayed flat."""
    short = km(spark, [(10, True)])
    long = km(spark, [(10, True), (50, False)])
    assert short["km_median"] == long["km_median"] == pytest.approx(10.0)
    assert long["km_restriction_time"] == pytest.approx(50.0)
    assert long["km_rmst"] > short["km_rmst"]


# ------------------------------------------------------------------- shape / wiring


def test_overall_row_pools_every_severity(spark):
    df = observations(spark, [(5, True), (6, False)], "HIGH").unionByName(
        observations(spark, [(8, True)], "CRITICAL")
    )
    rows = {r["severity"]: r.asDict() for r in metrics.kaplan_meier(df).collect()}
    assert rows["OVERALL"]["km_events"] == 2
    assert rows["OVERALL"]["km_censored"] == 1
    assert rows["HIGH"]["km_events"] == 1


def test_rows_with_no_time_at_all_drop_out(spark):
    """A finding with neither a resolution nor an age contributes to neither side."""
    df = observations(spark, [(5, True)]).unionByName(
        spark.createDataFrame([("HIGH", None, None, None)], SCHEMA)
    )
    got = {r["severity"]: r.asDict() for r in metrics.kaplan_meier(df).collect()}["HIGH"]
    assert got["km_events"] == 1
    assert got["km_censored"] == 0


def test_km_columns_land_on_the_gold_table(spark):
    pdf = metrics.mttr_by_severity(
        observations(spark, [(5, True), (6, False), (8, True)])
    ).toPandas().set_index("severity")
    for column in ("km_median", "km_rmst", "km_events", "km_censored", "km_truncated"):
        assert column in pdf.columns
    assert pdf.loc["HIGH", "km_median"] == pytest.approx(8.0)
