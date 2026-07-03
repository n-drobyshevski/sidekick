"""Tests for the parsed-frame disk snapshot behind the start-up fast path."""

import pickle

import pandas as pd

from wiz_dashboard.data import snapshot


def _frame():
    # The shapes that ruled out parquet/feather: list cells, list-of-dict cells,
    # category dtype, NaN/NaT — all must round-trip exactly, index included.
    return pd.DataFrame(
        {
            "severity": pd.Series(["HIGH", "LOW", None], dtype="category"),
            "categories": [["rce", "kev"], [], None],
            "projects": [[{"id": "p1"}], None, [{"id": "p2"}, {"id": "p3"}]],
            "score": [9.8, None, 3.1],
            "firstDetectedAt": pd.to_datetime(["2026-04-01", None, "2026-04-03"], utc=True),
        }
    )


def test_snapshot_round_trip_preserves_frame(tmp_path):
    raw = tmp_path / "scan-1.json"
    df = _frame()
    path = snapshot.write_snapshot(raw, df)
    assert path == str(tmp_path / "scan-1.df.pkl")

    out = snapshot.read_snapshot(raw)
    pd.testing.assert_frame_equal(out, df)
    assert isinstance(out["severity"].dtype, pd.CategoricalDtype)
    assert out["projects"].iloc[2] == [{"id": "p2"}, {"id": "p3"}]
    # Atomic write leaves no tmp litter behind.
    assert not list(tmp_path.glob("*.tmp"))


def test_read_snapshot_none_on_missing_or_bad(tmp_path):
    raw = tmp_path / "scan-2.json"
    assert snapshot.read_snapshot(raw) is None          # missing
    assert snapshot.read_snapshot(None) is None         # no raw path at all

    p = snapshot.snapshot_path_for(raw)
    p.write_bytes(b"not a pickle")
    assert snapshot.read_snapshot(raw) is None          # corrupt

    p.write_bytes(pickle.dumps({"version": 999, "df": _frame()}))
    assert snapshot.read_snapshot(raw) is None          # future/unknown version

    p.write_bytes(pickle.dumps({"version": snapshot.SNAPSHOT_VERSION, "df": "nope"}))
    assert snapshot.read_snapshot(raw) is None          # wrapper holds no DataFrame


def test_write_snapshot_never_raises(tmp_path):
    # Unwritable destination -> None, no exception (start-up fast path is best-effort).
    missing_dir = tmp_path / "nope" / "scan-3.json"
    assert snapshot.write_snapshot(missing_dir, _frame()) is None


def test_snapshot_path_pairs_gz_and_plain(tmp_path):
    # Gzipped and pre-compression plain archives must map to the SAME snapshot file,
    # or every existing .df.pkl (and the delete-flow's snapshot unlink) would unpair.
    gz = snapshot.snapshot_path_for(tmp_path / "scan-1.json.gz")
    plain = snapshot.snapshot_path_for(tmp_path / "scan-1.json")
    assert gz == plain == tmp_path / "scan-1.df.pkl"
