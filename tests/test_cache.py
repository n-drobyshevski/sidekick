"""Disk snapshot cache: round-trips, and fails loudly-but-safely on write errors."""

from wiz_dashboard.data import cache


def test_save_and_load_round_trip(tmp_path):
    f = str(tmp_path / "snap.json")
    results = {"data": {"vulnerabilityFindings": {"nodes": [{"id": "x"}]}}}
    assert cache.save_cache(results, filename=f) is True
    assert cache.load_cache(f) == results


def test_save_cache_unwritable_path_returns_false(tmp_path, caplog):
    # Parent directory does not exist -> write fails. Must not raise, must log.
    f = str(tmp_path / "missing_dir" / "snap.json")
    with caplog.at_level("WARNING"):
        ok = cache.save_cache({"a": 1}, filename=f)
    assert ok is False
    assert "Failed to write cache snapshot" in caplog.text


def test_load_missing_returns_none(tmp_path):
    assert cache.load_cache(str(tmp_path / "nope.json")) is None
