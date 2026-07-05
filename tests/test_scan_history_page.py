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
    # The dry-run default is now flat, but set it explicitly so the test states its intent
    # (a grouped scan carries no per-finding identity -- see test_run_scan_grouped_archives).
    # Widen the fetch scope to all severities: this test pins the FULL 17-finding sample
    # semantics (the default Critical+High scope is pinned by test_run_scan_default_scope).
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard import config\n"
        "from wiz_dashboard.data import settings\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger\n"
        "settings.set_fetch_severities(config.SELECTABLE_SEVERITIES)\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert "scan_deltas" in at.session_state
    assert at.session_state["scan_deltas"]["new_count"] == 17


def test_run_scan_default_scope_filters_sample_and_records_scope(tmp_path):
    # With no settings saved, the default Critical+High scope filters the dry-run flat
    # sample AND is recorded on the persisted scan row (honest coverage).
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "row = ledger.load_scans_df().iloc[0]\n"
        "st.session_state['stored_scope'] = ledger.parse_severities(row['severities'])\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    counts = at.session_state["os_counts"]
    assert set(counts) <= {"CRITICAL", "HIGH"}  # nothing outside the scope leaks in
    assert sum(counts.values()) == len(at.session_state["os_nodes"])
    assert at.session_state["os_scan_scope"] == ("CRITICAL", "HIGH")
    assert at.session_state["stored_scope"] == ("CRITICAL", "HIGH")
    assert at.session_state["last_scan_meta"]["severities"] == ("CRITICAL", "HIGH")


def test_run_scan_grouped_archives(tmp_path):
    # A grouped-by-asset scan is archived (zero reconciliation deltas) without raising,
    # mirroring the real Wiz response (no per-finding identity to reconcile). The dry-run
    # default is now flat, so request the grouped shape explicitly via the sample override.
    script = (
        "from wiz_dashboard.ui import scan\n"
        "scan.run_scan(force=False, has_creds=False, sample_shape='grouped')\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["scan_deltas"] == {
        "new_count": 0,
        "resolved_count": 0,
        "reopened_count": 0,
    }
    assert len(at.session_state["os_nodes"]) == 10


def test_autoload_hydrates_fresh_session_from_saved_scan(tmp_path):
    # A fresh session with a prior saved scan must auto-load it (no Wiz query, no new
    # snapshot, no os_nodes pre-set), so the dashboard opens on data, not an empty state.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard import config\n"
        "from wiz_dashboard.data import settings\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger\n"
        "settings.set_fetch_severities(config.SELECTABLE_SEVERITIES)\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "st.session_state['before'] = len(ledger.load_scans_df())\n"
        # Simulate a brand-new session: drop the in-session view but keep the durable base.
        "for k in ('os_nodes','os_df','os_raw','os_counts','os_prev_counts',"
        "'last_scan_meta','_autoload_tried','os_scan_id','os_shape','os_raw_path',"
        "'os_df_token'):\n"
        "    st.session_state.pop(k, None)\n"
        "st.session_state['loaded'] = scan.autoload_latest_scan()\n"
        "st.session_state['after'] = len(ledger.load_scans_df())\n"
        # The flat fast path defers the raw nodes; ensure_nodes hydrates them on demand.
        "st.session_state['n_lazy_nodes'] = len(scan.ensure_nodes())\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["loaded"] is True
    # New hydration contract: the frame + routing metadata are loaded eagerly, the raw
    # nested nodes lazily (os_nodes may be None until first drill-down/export).
    assert not at.session_state["os_df"].empty
    assert at.session_state["os_shape"] == "flat"
    assert at.session_state["os_scan_id"]
    assert at.session_state["os_counts"]
    assert "last_scan_meta" in at.session_state
    assert at.session_state["n_lazy_nodes"] == 17  # ensure_nodes re-hydrated the archive
    # Auto-load is a pure read: it must not add a second saved scan.
    assert at.session_state["before"] == at.session_state["after"] == 1


def test_autoload_noop_when_data_already_loaded(tmp_path):
    # Auto-load must never clobber an in-session scan (e.g. one the user just ran).
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "st.session_state['count_before'] = len(st.session_state['os_nodes'])\n"
        "st.session_state['loaded'] = scan.autoload_latest_scan()\n"
        "st.session_state['count_after'] = len(st.session_state['os_nodes'])\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["loaded"] is False
    assert at.session_state["count_before"] == at.session_state["count_after"]


def test_autoload_noop_and_marks_tried_when_base_empty(tmp_path):
    # With an empty durable base, auto-load loads nothing, raises nothing, and sets the
    # one-shot guard so repeated reruns don't keep re-reading SQLite.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "st.session_state['loaded'] = scan.autoload_latest_scan()\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["loaded"] is False
    assert "os_nodes" not in at.session_state
    assert at.session_state["_autoload_tried"] is True


def test_reload_scan_redraws_without_new_snapshot(tmp_path):
    # Refresh = reload the last saved scan into the os_* session state WITHOUT querying
    # Wiz or adding a new scan row. Run a scan to save one snapshot, wipe the in-session
    # view, then reload and prove it rebuilt the view while the saved scan count held.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "st.session_state['scans_before'] = len(ledger.load_scans_df())\n"
        "for k in ('os_nodes','os_df','os_raw','os_counts','os_prev_counts',"
        "'last_scan_meta','os_scan_id','os_shape','os_raw_path','os_df_token'):\n"
        "    st.session_state.pop(k, None)\n"
        "scan.reload_scan()\n"
        "st.session_state['scans_after'] = len(ledger.load_scans_df())\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    # The view was rebuilt purely from the durable base (frame eager, raw nodes lazy).
    assert not at.session_state["os_df"].empty
    assert at.session_state["os_shape"] == "flat"
    assert at.session_state["os_counts"]
    assert "last_scan_meta" in at.session_state
    # Refresh is a read: it must not add a second saved scan.
    assert at.session_state["scans_before"] == 1
    assert at.session_state["scans_after"] == 1


def test_reload_scan_without_saved_scan_warns(tmp_path):
    # With an empty durable base, Refresh leaves the session untouched (no os_* keys) and
    # doesn't raise — it just nudges the user to run a scan first.
    script = (
        "from wiz_dashboard.ui import scan\n"
        "scan.reload_scan()\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert "os_nodes" not in at.session_state
    assert "last_scan_meta" not in at.session_state
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


def test_autoload_survives_missing_archive_via_snapshot(tmp_path):
    # The frame snapshot alone is enough to open the app on data: with the raw JSON
    # archive gone, autoload hydrates from the snapshot and the lazy raw-node load
    # degrades to an empty list instead of failing startup.
    script = (
        "import streamlit as st\n"
        "from pathlib import Path\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "row = ledger.load_latest_scan_row()\n"
        "Path(row['raw_path']).unlink()\n"
        "for k in ('os_nodes','os_df','os_raw','os_counts','os_prev_counts',"
        "'last_scan_meta','_autoload_tried','os_scan_id','os_shape','os_raw_path',"
        "'os_df_token'):\n"
        "    st.session_state.pop(k, None)\n"
        "st.session_state['loaded'] = scan.autoload_latest_scan()\n"
        "st.session_state['n_nodes'] = len(scan.ensure_nodes())\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["loaded"] is True
    assert not at.session_state["os_df"].empty     # hydrated purely from the snapshot
    assert at.session_state["n_nodes"] == 0        # raw nodes unavailable -> degrade, not crash


def test_autoload_falls_back_to_archive_and_backfills_snapshot(tmp_path):
    # Old archives (persisted before snapshots existed) still load: the JSON fallback
    # parses the archive AND writes the missing snapshot so the next cold start is fast.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "from wiz_dashboard.data import ledger, snapshot\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "row = ledger.load_latest_scan_row()\n"
        "snap = snapshot.snapshot_path_for(row['raw_path'])\n"
        "snap.unlink()\n"
        "for k in ('os_nodes','os_df','os_raw','os_counts','os_prev_counts',"
        "'last_scan_meta','_autoload_tried','os_scan_id','os_shape','os_raw_path',"
        "'os_df_token'):\n"
        "    st.session_state.pop(k, None)\n"
        "from wiz_dashboard.ui.pages import _derived\n"
        "_derived.clear_scan_resources()\n"
        "st.session_state['loaded'] = scan.autoload_latest_scan()\n"
        "st.session_state['backfilled'] = snap.exists()\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["loaded"] is True
    assert not at.session_state["os_df"].empty
    assert at.session_state["backfilled"] is True  # slow path healed itself


def _compacted_history_script(tail: str) -> str:
    """Seed 1 sealable old flat scan + 2 protected recent ones, compact, then run
    ``tail``. Uses explicit scan_ids so the retention horizon is deterministic."""
    return (
        "import pandas as pd\n"
        "from wiz_dashboard.data import ledger\n"
        "from wiz_dashboard.ui.pages import _derived, scan_history\n"
        "def rec(rid, resolved=None):\n"
        "    r = {'id': rid, 'name': f'CVE-2026-{rid}', 'severity': 'HIGH',\n"
        "         'vulnerableAsset.name': 'vm-1',\n"
        "         'firstDetectedAt': '2026-01-01T00:00:00Z'}\n"
        "    if resolved: r['resolvedAt'] = resolved\n"
        "    return r\n"
        "ledger.persist_flat_scan([rec('a1'), rec('a2', '2026-01-02T00:00:00Z')],\n"
        "    mode='dry-run', scan_id='2026-01-01T00:00:00Z')\n"
        "ledger.persist_flat_scan([rec('a1')], mode='dry-run',"
        " scan_id='2026-06-20T00:00:00Z')\n"
        "ledger.persist_flat_scan([rec('a1')], mode='dry-run',"
        " scan_id='2026-06-25T00:00:00Z')\n"
        "ledger.compact_ledger(30, now=pd.Timestamp('2026-07-01T00:00:00Z'))\n"
        "_derived.clear_ledger_caches()\n"
    ) + tail


def test_scan_history_renders_sealed_rows_and_compacted_caption(tmp_path):
    script = _compacted_history_script("scan_history.page()\n")
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    # The sealed scan is badged in the saved-scans table and the compacted resolved
    # finding is called out under the base table.
    assert any("compacted" in c.value for c in at.caption)
    dfs = at.get("dataframe")
    assert any(
        "sealed" in getattr(d.value, "columns", []) and "🔒 Sealed" in set(d.value["sealed"])
        for d in dfs
    )


def test_delete_controls_exclude_sealed_selection(tmp_path):
    # Selecting only the sealed scan offers no delete button, just the explanation.
    script = _compacted_history_script(
        "scans = _derived.ledger_scans_cached()\n"
        "scan_history._delete_controls(scans, ['2026-01-01T00:00:00Z'])\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert any("can't be deleted" in c.value for c in at.caption)
    assert not [b for b in at.get("button") if b.key == "sh_delete"]


def test_delete_controls_keep_unsealed_selection(tmp_path):
    # A mixed selection keeps the delete button for the unsealed part only.
    script = _compacted_history_script(
        "scans = _derived.ledger_scans_cached()\n"
        "scan_history._delete_controls(scans,"
        " ['2026-01-01T00:00:00Z', '2026-06-20T00:00:00Z'])\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert any("can't be deleted" in c.value for c in at.caption)
    delete = [b for b in at.get("button") if b.key == "sh_delete"]
    assert delete and "(1)" in delete[0].label


def test_delete_stash_opens_confirm_and_deletes(tmp_path):
    # The delete button lives inside the saved-scans fragment and can only stash the
    # selection (a dialog opened during a fragment rerun won't render); page() pops
    # sh_delete_pending and opens the confirm at app scope. Drive that wiring end to
    # end. AppTest replays the whole script each .run() and page() POPS the stash, so
    # the flag is re-seeded before the click-run (the dialog open-flag memory pattern).
    script = (
        "from wiz_dashboard.data import ledger\n"
        "from wiz_dashboard.ui.pages import _derived, scan_history\n"
        "if ledger.load_scans_df().empty:\n"
        "    ledger.persist_flat_scan([{'id': 'x1', 'name': 'CVE-2026-1',"
        " 'severity': 'HIGH', 'vulnerableAsset.name': 'vm-1'}],"
        " mode='dry-run', scan_id='2026-05-01T00:00:00Z')\n"
        "    ledger.persist_flat_scan([{'id': 'x2', 'name': 'CVE-2026-2',"
        " 'severity': 'HIGH', 'vulnerableAsset.name': 'vm-2'}],"
        " mode='dry-run', scan_id='2026-05-02T00:00:00Z')\n"
        "    _derived.clear_ledger_caches()\n"
        "scan_history.page()\n"
    )
    at = AppTest.from_string(script, default_timeout=60)
    at.session_state["sh_delete_pending"] = ["2026-05-02T00:00:00Z"]
    at.run()
    assert not at.exception, at.exception
    confirm = [b for b in at.get("button") if b.key == "sh_del_confirm"]
    assert confirm, "stash must open the confirm dialog at app scope"
    confirm[0].click()
    at.session_state["sh_delete_pending"] = ["2026-05-02T00:00:00Z"]
    at.run()
    assert not at.exception, at.exception
    from wiz_dashboard.data import ledger
    assert set(ledger.load_scans_df()["scan_id"]) == {"2026-05-01T00:00:00Z"}
