"""Render checks for the Scan History page + the run_scan -> ledger glue."""

from streamlit.testing.v1 import AppTest

from wiz_dashboard.ui.pages import scan_history


def test_empty_state_without_scans():
    # The autouse _isolated_ledger fixture points DATA_DIR at an empty temp dir, so the
    # ledger is empty and the page shows its empty state without raising (bare mode).
    scan_history.page()


def test_page_renders_after_persist(tmp_path, monkeypatch):
    # DATA_DIR is already isolated to a temp dir by the autouse fixture; seed a scan into
    # that ledger from inside the AppTest run, then render the page.
    script = (
        "from wiz_dashboard.data.client import fetch_findings\n"
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "from wiz_dashboard.data import ledger\n"
        "from wiz_dashboard.ui.pages import _derived, scan_history\n"
        "recs = nodes_to_dataframe(extract_nodes(fetch_findings(dry_run=True))).to_dict('records')\n"
        "ledger.persist_flat_scan(recs, mode='dry-run', scan_id='2026-05-29T10:00:00Z')\n"
        "for c in (_derived.ledger_mttr_cached, _derived.ledger_scans_cached,"
        " _derived.ledger_base_cached, _derived.ledger_trend_cached): c.clear()\n"
        "scan_history.page()\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert any("Scan History" in t.value for t in at.title)
    # KPI band ("Tracked (all-time)") + the base-table CSV download button.
    assert any("Tracked" in m.value for m in at.markdown)
    assert len(at.get("download_button")) >= 1


def test_run_scan_persists_to_ledger(tmp_path):
    # The single scan writer must reconcile a flat scan into the durable base + set deltas.
    # Force the flat dry-run shape (the grouped default carries no per-finding identity, so
    # it archives without reconciliation -- see test_run_scan_grouped_default_archives).
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert "scan_deltas" in at.session_state
    assert at.session_state["scan_deltas"]["new_count"] == 17


def test_run_scan_grouped_default_archives(tmp_path):
    # The default dry-run shape is grouped-by-asset: the scan writer archives it (zero
    # reconciliation deltas) without raising, mirroring the real Wiz response.
    script = (
        "from wiz_dashboard.ui import scan\n"
        "scan.run_scan(force=False, has_creds=False)\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["scan_deltas"] == {
        "new_count": 0,
        "resolved_count": 0,
        "reopened_count": 0,
    }
    assert len(at.session_state["os_nodes"]) == 10


def test_clear_ledger_caches_invalidates():
    # The shared helper must actually invalidate the caches, not just run: a cached
    # (stale) read keeps returning the old value until clear_ledger_caches() is called.
    from wiz_dashboard.data import ledger
    from wiz_dashboard.ui.pages import _derived

    assert _derived.ledger_scans_cached().empty  # caches the empty result
    ledger.persist_flat_scan(
        [{"id": "x1", "name": "CVE-2026-1", "severity": "HIGH",
          "vulnerableAsset.name": "vm-1"}],
        mode="dry-run", scan_id="2026-05-01T00:00:00Z",
    )
    assert _derived.ledger_scans_cached().empty  # stale cache still shows empty
    _derived.clear_ledger_caches()
    assert len(_derived.ledger_scans_cached()) == 1  # fresh read reflects the new scan


def test_perform_delete_removes_scan(tmp_path):
    # Seed two flat scans into the (fixture-isolated) ledger, then delete one via the
    # page handler. The ledger must drop to one scan and clear its caches.
    from wiz_dashboard.data import ledger
    from wiz_dashboard.ui.pages import _derived

    s1 = [{"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1",
           "firstDetectedAt": "2026-05-01T00:00:00Z"}]
    s2 = [{"id": "x2", "name": "CVE-2026-2", "severity": "LOW", "vulnerableAsset.name": "vm-2",
           "firstDetectedAt": "2026-05-02T00:00:00Z"}]
    ledger.persist_flat_scan(s1, mode="dry-run", scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(s2, mode="dry-run", scan_id="2026-05-02T00:00:00Z")
    _derived.clear_ledger_caches()
    assert len(_derived.ledger_scans_cached()) == 2  # warm a stale cache (both scans)

    summary = scan_history._perform_delete(["2026-05-02T00:00:00Z"])

    assert summary["deleted"] == 1
    remaining = set(ledger.load_scans_df()["scan_id"])
    assert remaining == {"2026-05-01T00:00:00Z"}
    # The handler cleared the caches, so a fresh cached read reflects the single survivor.
    assert len(_derived.ledger_scans_cached()) == 1


def test_perform_delete_handles_rebuild_error(monkeypatch):
    # A LedgerRebuildError is swallowed into a warning toast; the handler returns None.
    from wiz_dashboard.data import ledger

    def _boom(_ids):
        raise ledger.LedgerRebuildError("missing archive")
    monkeypatch.setattr(ledger, "delete_scans", _boom)

    assert scan_history._perform_delete(["whatever"]) is None


def test_perform_delete_handles_generic_error(monkeypatch):
    # A non-rebuild error (e.g. a locked/unwritable DB) is surfaced as a toast, not a
    # full-page crash; the handler returns None.
    from wiz_dashboard.data import ledger

    def _boom(_ids):
        raise OSError("database is locked")
    monkeypatch.setattr(ledger, "delete_scans", _boom)

    assert scan_history._perform_delete(["whatever"]) is None


def test_selected_scan_ids_ignores_stale_out_of_range_indices():
    # Regression: a delete shrinks the table, but the dataframe's persisted selection
    # can still hold a row index past the now-smaller frame. Mapping must drop the stale
    # index, not raise IndexError (the crash this guards against).
    import pandas as pd

    scans = pd.DataFrame({"scan_id": ["a", "b"]})
    assert scan_history._selected_scan_ids(scans, [0, 1]) == ["a", "b"]
    assert scan_history._selected_scan_ids(scans, [2]) == []        # stale index dropped
    assert scan_history._selected_scan_ids(scans, [1, 5]) == ["b"]  # keep valid, drop stale
    assert scan_history._selected_scan_ids(scans, []) == []
    assert scan_history._selected_scan_ids(scans, None) == []
