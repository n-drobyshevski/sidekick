"""Tests for the MTTR history store (daily-bucketed snapshots)."""

from wiz_dashboard.data import history


def test_record_and_load_sorted(tmp_path):
    f = str(tmp_path / "h.json")
    history.record_snapshot(7.0, 3, 1, {"CRITICAL": 2, "HIGH": 2}, filename=f, when="2026-05-21")
    history.record_snapshot(5.5, 4, 0, {"CRITICAL": 4}, filename=f, when="2026-05-20")
    df = history.load_history(f)
    assert len(df) == 2
    assert list(df["median_days"]) == [5.5, 7.0]  # sorted by date ascending
    assert str(df["date"].dt.date.iloc[0]) == "2026-05-20"
    assert df["total"].iloc[1] == 4  # 2 + 2


def test_same_day_upsert(tmp_path):
    f = str(tmp_path / "h.json")
    history.record_snapshot(9.0, 1, 1, {}, filename=f, when="2026-05-20")
    history.record_snapshot(4.0, 2, 0, {}, filename=f, when="2026-05-20")  # replaces
    df = history.load_history(f)
    assert len(df) == 1
    assert df["median_days"].iloc[0] == 4.0


def test_load_missing_is_empty(tmp_path):
    df = history.load_history(str(tmp_path / "nope.json"))
    assert df.empty
    assert list(df.columns) == [
        "date", "median_days", "resolved", "open", "total", "sla_pct", "oldest_open_days"
    ]


def test_record_snapshot_glue_records_when_median_present(tmp_path, resolved_sample, app):
    # The scan side-effects (incl. the MTTR snapshot) live in ui.scan, shared by the OS
    # page and the global sidebar trigger.
    from wiz_dashboard.ui import scan

    f = str(tmp_path / "h.json")
    df = app.nodes_to_dataframe(app.extract_nodes(resolved_sample))
    scan._record_mttr_snapshot(df, app.count_by_severity(df), filename=f)
    hist = history.load_history(f)
    assert len(hist) == 1
    assert hist["median_days"].iloc[0] == 7.0


def test_record_snapshot_glue_skips_without_median(tmp_path, flat_sample, app):
    from wiz_dashboard.ui import scan

    f = str(tmp_path / "h.json")
    df = app.nodes_to_dataframe(app.extract_nodes(flat_sample))
    scan._record_mttr_snapshot(df, {}, filename=f)
    assert history.load_history(f).empty  # no resolvedAt column -> nothing recorded
