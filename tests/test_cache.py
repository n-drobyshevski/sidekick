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


def test_cache_file_is_gzip(tmp_path):
    f = str(tmp_path / "snap.json.gz")
    assert cache.save_cache({"a": 1}, filename=f) is True
    with open(f, "rb") as fh:
        assert fh.read(2) == b"\x1f\x8b"


def test_legacy_plain_cache_still_loads(tmp_path):
    # A pre-gzip snapshot (plain JSON) stays readable: the reader sniffs content,
    # and a missing .gz falls back to its plain twin so upgrades don't start cold.
    import json

    results = {"data": {"vulnerabilityFindings": {"nodes": [{"id": "x"}]}}}
    plain = tmp_path / "last_results.json"
    plain.write_text(
        json.dumps({"ts": "2026-07-01T00:00:00+00:00", "results": results}),
        encoding="utf-8",
    )
    assert cache.load_cache(str(plain), max_age_minutes=None) == results
    # .gz-named lookup falls back to the plain twin.
    assert cache.load_cache(str(tmp_path / "last_results.json.gz"),
                            max_age_minutes=None) == results
    assert cache.peek_saved_at(str(tmp_path / "last_results.json.gz")) == "2026-07-01 00:00 UTC"
    # clear_cache removes the plain twin too.
    cache.clear_cache(str(tmp_path / "last_results.json.gz"))
    assert not plain.exists()


def test_peek_saved_at_reads_gzip_head(tmp_path):
    # peek must stay a cheap head-read on a large gzipped snapshot: "ts" is written
    # first and read(4096) decompresses only the leading chunk.
    f = str(tmp_path / "snap.json.gz")
    big = {"nodes": [{"id": f"n{i}", "description": "x" * 100} for i in range(20_000)]}
    assert cache.save_cache(big, filename=f) is True
    out = cache.peek_saved_at(f)
    assert out != "an unknown time"
    assert "UTC" in out
