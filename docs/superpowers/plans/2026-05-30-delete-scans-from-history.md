# Delete scans from Scan History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete one or more saved scans from the Scan History page, rebuilding the durable vulnerability ledger and MTTR by replaying the surviving scans — so the derived data equals what it would be if the deleted scans had never run.

**Architecture:** Deletion is a *replay*. `data.ledger.delete_scans` wipes the three derived tables (`vuln_ledger`, `observations`, `scans`) and re-runs the surviving scans through the existing, tested `persist_flat_scan` / `persist_grouped_scan` (using each scan's original `scan_id`/`mode`/`raw` from `data/scans/`). It is crash-safe: it validates that every surviving flat scan's archive is readable and snapshots the DB *before* mutating, restoring on any failure. The Scan History page makes the "Saved scans" table multi-row selectable with a confirm-dialog delete button.

**Tech Stack:** Python, Streamlit 1.57, SQLite (stdlib `sqlite3`), pandas, pytest + `streamlit.testing.v1.AppTest`.

> **Repo note:** this workspace is not a git repository. Either run `git init` first, or treat each "Commit" step as a checkpoint (skip the `git` command). Run tests with `python -m pytest` from `D:\projects\dkt\wiz` (the `.venv` interpreter).

---

## File Structure

- `wiz_dashboard/data/ledger.py` — **modify.** Add `LedgerRebuildError`, `delete_scan`, `delete_scans`, and private helpers `_read_raw_payload`, `_records_from_payload`, `_reinsert_scan_row`, `_restore_db`. Add imports for `shutil` and `data.transform`.
- `wiz_dashboard/ui/pages/_derived.py` — **modify.** Add `clear_ledger_caches()` so the cache-invalidation set lives in one place.
- `wiz_dashboard/ui/scan.py` — **modify.** Replace the inline cache-clear loop in `_persist_scan` with `_derived.clear_ledger_caches()`.
- `wiz_dashboard/ui/pages/scan_history.py` — **modify.** Make `_scans_table` selectable and return selected `scan_id`s; add `_delete_controls`, the `@st.dialog` confirm, and `_perform_delete`; import `ledger`.
- `tests/test_ledger.py` — **modify.** Add deletion/rebuild tests (keystone equivalence + behaviors + crash-safety).
- `tests/test_scan_history_page.py` — **modify.** Add the `_perform_delete` behavioral test.
- `tests/test_pages.py` or existing render test — no change needed beyond what's added here.

---

## Task 1: `delete_scans` happy path (replay rebuild)

**Files:**
- Modify: `wiz_dashboard/data/ledger.py`
- Test: `tests/test_ledger.py`

- [ ] **Step 1: Add test helpers + the keystone equivalence test**

Append to `tests/test_ledger.py` (top-level, after the existing imports add `import sqlite3`):

```python
import sqlite3


def _ledger_rows(db):
    """Raw vuln_ledger rows (lifecycle truth), ordered for stable comparison."""
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM vuln_ledger ORDER BY vuln_key")]
    finally:
        conn.close()


def _scan_deltas(db):
    """scans rows projected to the comparable columns (raw_path/path excluded)."""
    cols = ["scan_id", "ts", "mode", "shape", "total",
            "new_count", "resolved_count", "reopened_count"]
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [
            {c: r[c] for c in cols}
            for r in conn.execute("SELECT * FROM scans ORDER BY ts ASC, scan_id ASC")
        ]
    finally:
        conn.close()


# Three flat scans. x1 persists throughout; x2 only in s1; x3 only in s2 (the deleted one).
_S1 = [
    {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1",
     "firstDetectedAt": "2026-05-01T00:00:00Z"},
    {"id": "x2", "name": "CVE-2026-2", "severity": "LOW", "vulnerableAsset.name": "vm-2",
     "firstDetectedAt": "2026-05-01T00:00:00Z"},
]
_S2 = [
    {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1"},
    {"id": "x3", "name": "CVE-2026-3", "severity": "CRITICAL", "vulnerableAsset.name": "vm-3",
     "firstDetectedAt": "2026-05-02T00:00:00Z"},
]
_S3 = [
    {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1"},
]


def _build(db, scans):
    """Persist a list of (scan_id, records) flat scans into a fresh db."""
    for scan_id, recs in scans:
        ledger.persist_flat_scan(recs, mode="dry-run", db_path=db, scan_id=scan_id)


def test_delete_middle_scan_equals_never_persisted(tmp_path):
    full = tmp_path / "full" / "ledger.db"
    direct = tmp_path / "direct" / "ledger.db"
    _build(full, [("2026-05-01T00:00:00Z", _S1),
                  ("2026-05-02T00:00:00Z", _S2),
                  ("2026-05-03T00:00:00Z", _S3)])
    _build(direct, [("2026-05-01T00:00:00Z", _S1),
                    ("2026-05-03T00:00:00Z", _S3)])

    summary = ledger.delete_scans(["2026-05-02T00:00:00Z"], db_path=full)

    assert summary["deleted"] == 1
    assert summary["scans"] == 2
    # The rebuilt ledger and scan deltas are identical to a ledger that never saw s2.
    assert _ledger_rows(full) == _ledger_rows(direct)
    assert _scan_deltas(full) == _scan_deltas(direct)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_ledger.py::test_delete_middle_scan_equals_never_persisted -v`
Expected: FAIL with `AttributeError: module 'wiz_dashboard.data.ledger' has no attribute 'delete_scans'`.

- [ ] **Step 3: Add imports to `ledger.py`**

In `wiz_dashboard/data/ledger.py`, add `import shutil` to the stdlib imports and this to the package imports:

```python
import shutil
```
```python
from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe
```

(`data.transform` imports only stdlib + pandas, so there is no import cycle.)

- [ ] **Step 4: Implement the happy-path `delete_scans` + helpers**

Add to `wiz_dashboard/data/ledger.py` (after the Writers section, before Readers):

```python
class LedgerRebuildError(RuntimeError):
    """A scan deletion can't rebuild the ledger (e.g. a surviving flat scan's archived
    payload is missing). Raised BEFORE any data is mutated, so the delete is refused."""


def _read_raw_payload(raw_path):
    """Load an archived scan payload from disk; None if absent/unreadable."""
    if not raw_path:
        return None
    p = Path(raw_path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to read archived scan payload %s", raw_path, exc_info=True)
        return None


def _records_from_payload(payload):
    """Reconstruct a flat scan's per-finding records from its archived payload, using the
    same extract->normalize pipeline as a live scan (so replay is byte-faithful)."""
    df = nodes_to_dataframe(extract_nodes(payload))
    return df.to_dict("records") if not df.empty else []


def delete_scan(scan_id, db_path=None) -> dict:
    """Delete one scan (convenience wrapper over ``delete_scans``)."""
    return delete_scans([scan_id], db_path=db_path)


def delete_scans(scan_ids, db_path=None) -> dict:
    """Delete saved scans and rebuild the derived ledger by replaying the survivors.

    The result is identical to a ledger that had only ever seen the surviving scans.
    Returns ``{"deleted", "scans", "tracked"}``. Raises ``LedgerRebuildError`` (before
    mutating) if a surviving *flat* scan's archived payload can't be replayed.
    """
    targets = {s for s in (scan_ids or []) if s}
    db_path = _resolve(db_path)
    zero = {"deleted": 0, "scans": 0, "tracked": 0}
    if not targets or not db_path.exists():
        return zero

    conn = _connect(db_path)
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM scans ORDER BY ts ASC, scan_id ASC"
        )]
    finally:
        conn.close()
    present = {r["scan_id"] for r in rows if r["scan_id"] in targets}
    if not present:
        return zero
    survivors = [r for r in rows if r["scan_id"] not in present]

    # Pre-load + validate every survivor's payload BEFORE mutating anything.
    replay = []
    for r in survivors:
        payload = _read_raw_payload(r["raw_path"])
        if payload is None and r["shape"] == "flat":
            raise LedgerRebuildError(
                f"Cannot delete: the archived payload for surviving scan "
                f"{r['scan_id']} is missing, so the ledger can't be rebuilt."
            )
        replay.append((r, payload))

    # Wipe the derived tables, then replay survivors in ts order.
    conn = _connect(db_path)
    try:
        with conn:
            conn.execute("DELETE FROM vuln_ledger")
            conn.execute("DELETE FROM observations")
            conn.execute("DELETE FROM scans")
    finally:
        conn.close()

    for r, payload in replay:
        if r["shape"] == "grouped":
            persist_grouped_scan(
                extract_nodes(payload) if payload is not None else [],
                mode=r["mode"], raw=payload, db_path=db_path, scan_id=r["scan_id"],
            )
        else:
            persist_flat_scan(
                _records_from_payload(payload), mode=r["mode"], raw=payload,
                db_path=db_path, scan_id=r["scan_id"],
            )

    scans_df = load_scans_df(db_path)
    base_df = load_base_df(db_path)
    return {
        "deleted": len(present),
        "scans": 0 if scans_df.empty else len(scans_df),
        "tracked": 0 if base_df.empty else len(base_df),
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest tests/test_ledger.py::test_delete_middle_scan_equals_never_persisted -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add wiz_dashboard/data/ledger.py tests/test_ledger.py
git commit -m "feat(ledger): delete_scans rebuilds the ledger by replaying survivors"
```

---

## Task 2: Delete-latest and delete-all behaviors

**Files:**
- Test: `tests/test_ledger.py`

- [ ] **Step 1: Add the tests**

Append to `tests/test_ledger.py`:

```python
def test_delete_latest_scan_equals_prior_state(tmp_path):
    full = tmp_path / "full" / "ledger.db"
    only1 = tmp_path / "only1" / "ledger.db"
    _build(full, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])
    _build(only1, [("2026-05-01T00:00:00Z", _S1)])

    ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=full)

    assert _ledger_rows(full) == _ledger_rows(only1)


def test_delete_all_scans_empties_everything(tmp_path):
    db = tmp_path / "ledger.db"
    _build(db, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])

    summary = ledger.delete_scans(
        ["2026-05-01T00:00:00Z", "2026-05-03T00:00:00Z"], db_path=db
    )

    assert summary == {"deleted": 2, "scans": 0, "tracked": 0}
    assert ledger.load_scans_df(db).empty
    assert ledger.load_base_df(db).empty
    assert ledger.load_open_and_resolved(db) == []
    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0] == 0
    finally:
        conn.close()


def test_delete_unknown_scan_id_is_noop(tmp_path):
    db = tmp_path / "ledger.db"
    _build(db, [("2026-05-01T00:00:00Z", _S1)])
    before = _ledger_rows(db)
    summary = ledger.delete_scans(["nope"], db_path=db)
    assert summary == {"deleted": 0, "scans": 0, "tracked": 0}
    assert _ledger_rows(db) == before
```

- [ ] **Step 2: Run the tests**

Run: `python -m pytest tests/test_ledger.py -k "delete_latest or delete_all or delete_unknown" -v`
Expected: PASS (behavior implemented in Task 1; these characterize it).

- [ ] **Step 3: Commit**

```bash
git add tests/test_ledger.py
git commit -m "test(ledger): cover delete-latest, delete-all, unknown-id no-op"
```

---

## Task 3: Disappearance resolution is un-rolled on delete

**Files:**
- Test: `tests/test_ledger.py`

- [ ] **Step 1: Add the test**

Append to `tests/test_ledger.py`:

```python
def test_delete_scan_unresolves_disappearance(tmp_path):
    # s1 has an open vuln; s2 omits it -> resolved by disappearance. Deleting s2 must
    # reopen it (the resolution only existed because s2 showed its absence).
    db = tmp_path / "ledger.db"
    rec = {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH",
           "vulnerableAsset.name": "vm-1", "firstDetectedAt": "2026-05-01T00:00:00Z"}
    ledger.persist_flat_scan([rec], mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan([], mode="dry-run", db_path=db, scan_id="2026-05-04T00:00:00Z")
    assert ledger.load_base_df(db).set_index("vuln_key").loc["id:x1", "status"] == "RESOLVED"

    ledger.delete_scans(["2026-05-04T00:00:00Z"], db_path=db)

    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:x1", "status"] == "OPEN"
    assert base.loc["id:x1", "resolution_src"] is None
```

- [ ] **Step 2: Run the test**

Run: `python -m pytest tests/test_ledger.py::test_delete_scan_unresolves_disappearance -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_ledger.py
git commit -m "test(ledger): deleting a scan un-rolls its disappearance resolution"
```

---

## Task 4: Grouped scans delete without disturbing the flat lifecycle

**Files:**
- Test: `tests/test_ledger.py`

- [ ] **Step 1: Add the test**

Append to `tests/test_ledger.py`:

```python
def test_delete_grouped_scan_leaves_flat_lifecycle(tmp_path):
    full = tmp_path / "full" / "ledger.db"
    direct = tmp_path / "direct" / "ledger.db"
    grouped = [{"id": "g1", "vulnerableAsset": {"name": "vm-9", "type": "VIRTUAL_MACHINE"},
                "analytics": {"criticalSeverityFindingCount": 5, "totalFindingCount": 5}}]

    ledger.persist_flat_scan(_S1, mode="dry-run", db_path=full, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_grouped_scan(grouped, mode="dry-run", raw=grouped, db_path=full,
                                scan_id="2026-05-02T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", db_path=full, scan_id="2026-05-03T00:00:00Z")
    _build(direct, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])

    summary = ledger.delete_scans(["2026-05-02T00:00:00Z"], db_path=full)

    assert summary["deleted"] == 1
    scan_ids = set(ledger.load_scans_df(full)["scan_id"])
    assert "2026-05-02T00:00:00Z" not in scan_ids
    assert _ledger_rows(full) == _ledger_rows(direct)
```

- [ ] **Step 2: Run the test**

Run: `python -m pytest tests/test_ledger.py::test_delete_grouped_scan_leaves_flat_lifecycle -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_ledger.py
git commit -m "test(ledger): deleting a grouped scan keeps the flat lifecycle intact"
```

---

## Task 5: Remove the deleted scan's raw archive (and keep survivors')

**Files:**
- Modify: `wiz_dashboard/data/ledger.py`
- Test: `tests/test_ledger.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_ledger.py`:

```python
def test_delete_removes_target_archive_keeps_survivors(tmp_path):
    db = tmp_path / "ledger.db"
    ledger.persist_flat_scan(_S1, mode="dry-run", raw={"data": {"vulnerabilityFindings":
                             {"nodes": _S1}}}, db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", raw={"data": {"vulnerabilityFindings":
                             {"nodes": _S3}}}, db_path=db, scan_id="2026-05-03T00:00:00Z")
    scans = ledger.load_scans_df(db).set_index("scan_id")
    s1_raw = scans.loc["2026-05-01T00:00:00Z", "raw_path"]
    s3_raw = scans.loc["2026-05-03T00:00:00Z", "raw_path"]
    assert s1_raw and s3_raw

    ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    from pathlib import Path as _P
    assert not _P(s3_raw).exists()   # deleted scan's archive removed
    assert _P(s1_raw).exists()       # survivor's archive retained
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_ledger.py::test_delete_removes_target_archive_keeps_survivors -v`
Expected: FAIL — the deleted scan's `*.json` still exists (Task 1 doesn't remove archives).

- [ ] **Step 3: Implement archive removal**

In `delete_scans`, immediately **before** the `scans_df = load_scans_df(db_path)` line, add:

```python
    # Remove the deleted scans' archived payloads (best-effort; survivors keep theirs).
    for r in rows:
        if r["scan_id"] in present and r["raw_path"]:
            try:
                Path(r["raw_path"]).unlink(missing_ok=True)
            except Exception:
                logger.warning("Couldn't remove archived scan %s", r["raw_path"], exc_info=True)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_ledger.py::test_delete_removes_target_archive_keeps_survivors -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add wiz_dashboard/data/ledger.py tests/test_ledger.py
git commit -m "feat(ledger): remove the deleted scan's raw archive on delete"
```

---

## Task 6: Crash-safety — validate + snapshot + restore

**Files:**
- Modify: `wiz_dashboard/data/ledger.py`
- Test: `tests/test_ledger.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_ledger.py`:

```python
def test_missing_survivor_archive_refuses_and_leaves_db_unchanged(tmp_path):
    # If a SURVIVING flat scan's archive is gone, the delete must refuse before mutating.
    db = tmp_path / "ledger.db"
    ledger.persist_flat_scan(_S1, mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(_S2, mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", db_path=db, scan_id="2026-05-03T00:00:00Z")

    # Remove a survivor's (s2's) archive, then try to delete s3.
    scans = ledger.load_scans_df(db).set_index("scan_id")
    from pathlib import Path as _P
    _P(scans.loc["2026-05-02T00:00:00Z", "raw_path"]).unlink()
    before = _ledger_rows(db)

    import pytest
    with pytest.raises(ledger.LedgerRebuildError):
        ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    # Nothing changed: all three scans + the ledger are intact, no .bak left behind.
    assert len(ledger.load_scans_df(db)) == 3
    assert _ledger_rows(db) == before
    assert not _P(str(db) + ".bak").exists()
```

Also add a positive crash-safety test (snapshot lets a mid-rebuild failure roll back):

```python
def test_rebuild_failure_restores_from_snapshot(tmp_path, monkeypatch):
    db = tmp_path / "ledger.db"
    _build(db, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])
    before = _ledger_rows(db)

    # Force the replay to blow up after the wipe; the snapshot must restore the DB.
    def _boom(*a, **k):
        raise RuntimeError("replay exploded")
    monkeypatch.setattr(ledger, "persist_flat_scan", _boom)

    import pytest
    with pytest.raises(RuntimeError):
        ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    assert _ledger_rows(db) == before                 # fully restored
    from pathlib import Path as _P
    assert not _P(str(db) + ".bak").exists()           # snapshot cleaned up
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_ledger.py -k "missing_survivor or rebuild_failure" -v`
Expected: the validation test PASSES already (Task 1 raises in the pre-load loop and never mutates) **except** the `no .bak` assertion — and the `rebuild_failure` test FAILS because Task 1 has no snapshot/restore, so the DB is left wiped and a `RuntimeError` surfaces with the ledger empty.

(If `missing_survivor` passes fully, that's fine — it confirms the pre-mutation refusal. The `rebuild_failure` test is the RED that drives this task.)

- [ ] **Step 3: Implement snapshot + restore**

Add the restore helper to `wiz_dashboard/data/ledger.py` (near the other private helpers):

```python
def _restore_db(db_path, bak):
    """Restore the DB from a snapshot, clearing WAL sidecars so SQLite doesn't replay a
    stale write-ahead log over the restored file. Removes the snapshot afterwards."""
    for suffix in ("-wal", "-shm"):
        try:
            Path(str(db_path) + suffix).unlink(missing_ok=True)
        except Exception:
            pass
    shutil.copy2(bak, db_path)
    bak.unlink(missing_ok=True)
```

Then wrap the wipe+replay section of `delete_scans` with a snapshot and try/except. Replace the block that runs from the wipe `conn = _connect(db_path)` down through the replay `for r, payload in replay:` loop with:

```python
    # Snapshot the DB (checkpoint WAL first so the copy is a complete database).
    bak = Path(str(db_path) + ".bak")
    cp = _connect(db_path)
    try:
        cp.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        cp.close()
    shutil.copy2(db_path, bak)

    try:
        # Wipe the derived tables, then replay survivors in ts order.
        conn = _connect(db_path)
        try:
            with conn:
                conn.execute("DELETE FROM vuln_ledger")
                conn.execute("DELETE FROM observations")
                conn.execute("DELETE FROM scans")
        finally:
            conn.close()

        for r, payload in replay:
            if r["shape"] == "grouped":
                persist_grouped_scan(
                    extract_nodes(payload) if payload is not None else [],
                    mode=r["mode"], raw=payload, db_path=db_path, scan_id=r["scan_id"],
                )
            else:
                persist_flat_scan(
                    _records_from_payload(payload), mode=r["mode"], raw=payload,
                    db_path=db_path, scan_id=r["scan_id"],
                )
    except Exception:
        _restore_db(db_path, bak)
        raise
    else:
        bak.unlink(missing_ok=True)
```

(The pre-load/validation loop stays exactly where it is — *before* the snapshot — so a missing survivor archive refuses without ever creating a `.bak`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_ledger.py -k "missing_survivor or rebuild_failure" -v`
Expected: PASS (both).

- [ ] **Step 5: Run the whole ledger suite (no regressions)**

Run: `python -m pytest tests/test_ledger.py -v`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 6: Commit**

```bash
git add wiz_dashboard/data/ledger.py tests/test_ledger.py
git commit -m "feat(ledger): crash-safe delete via validate + snapshot + restore"
```

---

## Task 7: Shared `clear_ledger_caches` helper

**Files:**
- Modify: `wiz_dashboard/ui/pages/_derived.py`
- Modify: `wiz_dashboard/ui/scan.py`
- Test: `tests/test_ledger.py` (lightweight) or `tests/test_scan_history_page.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_scan_history_page.py`:

```python
def test_clear_ledger_caches_runs():
    # The shared invalidation helper exists and clears every ledger cache without error.
    from wiz_dashboard.ui.pages import _derived
    _derived.ledger_scans_cached()  # populate one cache
    _derived.clear_ledger_caches()  # must not raise
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_scan_history_page.py::test_clear_ledger_caches_runs -v`
Expected: FAIL with `AttributeError: module 'wiz_dashboard.ui.pages._derived' has no attribute 'clear_ledger_caches'`.

- [ ] **Step 3: Implement the helper**

Append to `wiz_dashboard/ui/pages/_derived.py`:

```python
def clear_ledger_caches() -> None:
    """Invalidate every durable-ledger derivation. Call after any write OR delete that
    changes the SQLite base so consumer pages (Scan History / MTTR) reflect it."""
    for cached in (
        ledger_mttr_cached,
        ledger_scans_cached,
        ledger_base_cached,
        ledger_trend_cached,
        previous_severity_counts_cached,
    ):
        cached.clear()
```

- [ ] **Step 4: Use the helper in `scan.py`**

In `wiz_dashboard/ui/scan.py`, inside `_persist_scan`, replace:

```python
        st.session_state["scan_deltas"] = deltas
        for cached in (
            _derived.ledger_mttr_cached,
            _derived.ledger_scans_cached,
            _derived.ledger_base_cached,
            _derived.ledger_trend_cached,
            _derived.previous_severity_counts_cached,
        ):
            cached.clear()
```

with:

```python
        st.session_state["scan_deltas"] = deltas
        _derived.clear_ledger_caches()
```

- [ ] **Step 5: Run the test + the scan glue tests**

Run: `python -m pytest tests/test_scan_history_page.py::test_clear_ledger_caches_runs tests/test_scan_history_page.py::test_run_scan_persists_to_ledger -v`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add wiz_dashboard/ui/pages/_derived.py wiz_dashboard/ui/scan.py tests/test_scan_history_page.py
git commit -m "refactor: single clear_ledger_caches() helper for ledger invalidation"
```

---

## Task 8: Scan History page — selectable table + `_perform_delete`

**Files:**
- Modify: `wiz_dashboard/ui/pages/scan_history.py`
- Test: `tests/test_scan_history_page.py`

- [ ] **Step 1: Add the failing behavioral test**

Append to `tests/test_scan_history_page.py`:

```python
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

    summary = scan_history._perform_delete(["2026-05-02T00:00:00Z"])

    assert summary["deleted"] == 1
    remaining = set(ledger.load_scans_df()["scan_id"])
    assert remaining == {"2026-05-01T00:00:00Z"}


def test_perform_delete_handles_rebuild_error(monkeypatch):
    # A LedgerRebuildError is swallowed into a warning toast; the handler returns None.
    from wiz_dashboard.data import ledger

    def _boom(_ids):
        raise ledger.LedgerRebuildError("missing archive")
    monkeypatch.setattr(ledger, "delete_scans", _boom)

    assert scan_history._perform_delete(["whatever"]) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_scan_history_page.py -k perform_delete -v`
Expected: FAIL with `AttributeError: module 'wiz_dashboard.ui.pages.scan_history' has no attribute '_perform_delete'`.

- [ ] **Step 3: Add the `ledger` import + `_perform_delete` to `scan_history.py`**

In `wiz_dashboard/ui/pages/scan_history.py`, add to the imports:

```python
from wiz_dashboard.data import ledger
```

Add this function (near the bottom, after `_base_display`):

```python
def _perform_delete(scan_ids):
    """Delete scans, rebuild the ledger, refresh caches, and toast. Returns the summary
    dict, or None if the rebuild was refused (surfaced as a warning)."""
    try:
        summary = ledger.delete_scans(scan_ids)
    except ledger.LedgerRebuildError as exc:
        ui.show_toast(str(exc), "warning")
        return None
    _derived.clear_ledger_caches()
    ui.show_toast(
        f"Deleted {summary['deleted']} scan(s); ledger rebuilt — "
        f"{summary['scans']} scans, {summary['tracked']:,} tracked vulns",
        "success",
    )
    return summary
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_scan_history_page.py -k perform_delete -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add wiz_dashboard/ui/pages/scan_history.py tests/test_scan_history_page.py
git commit -m "feat(scan-history): _perform_delete handler (delete + rebuild + toast)"
```

---

## Task 9: Scan History page — selection UI + confirm dialog

**Files:**
- Modify: `wiz_dashboard/ui/pages/scan_history.py`
- Test: `tests/test_scan_history_page.py`

- [ ] **Step 1: Make `_scans_table` selectable and return selected ids**

In `wiz_dashboard/ui/pages/scan_history.py`, replace the whole `_scans_table` function with:

```python
def _scans_table(scans) -> list:
    """Render the saved-scans table (multi-row selectable) and return the selected
    ``scan_id``s. Selection indices are positional in ``scans`` (newest first)."""
    cols = [c for c in ("ts", "mode", "shape", "total", "new_count", "resolved_count",
                        "reopened_count") if c in scans.columns]
    event = st.dataframe(
        scans[cols],
        hide_index=True,
        width="stretch",
        on_select="rerun",
        selection_mode="multi-row",
        key="sh_scans",
        column_config={
            "ts": st.column_config.DatetimeColumn("When", format="YYYY-MM-DD HH:mm"),
            "mode": st.column_config.TextColumn("Mode"),
            "shape": st.column_config.TextColumn("Shape"),
            "total": st.column_config.NumberColumn("Findings"),
            "new_count": st.column_config.NumberColumn("＋ New", help="First seen in this scan"),
            "resolved_count": st.column_config.NumberColumn(
                "－ Resolved", help="Resolved in this scan (incl. disappeared)"
            ),
            "reopened_count": st.column_config.NumberColumn("↺ Reopened"),
        },
    )
    rows = (event.selection.get("rows") if event and event.selection else None) or []
    return [scans["scan_id"].iloc[i] for i in rows]
```

- [ ] **Step 2: Add the delete controls + confirm dialog**

In `wiz_dashboard/ui/pages/scan_history.py`, add these two functions (after `_scans_table`):

```python
def _delete_controls(scans, selected_ids) -> None:
    """A primary "Delete selected" button that opens the confirm dialog."""
    if not selected_ids:
        return
    if st.button(f"Delete selected ({len(selected_ids)})", type="primary", key="sh_delete"):
        _confirm_delete(scans, selected_ids)


@st.dialog("Delete scans?")
def _confirm_delete(scans, selected_ids) -> None:
    st.write(
        f"Delete **{len(selected_ids)}** scan(s)? This rebuilds the vulnerability ledger "
        "and recomputes MTTR as if the scan(s) never ran."
    )
    chosen = scans[scans["scan_id"].isin(selected_ids)]
    for _, r in chosen.iterrows():
        when = r["ts"].strftime("%Y-%m-%d %H:%M") if pd.notna(r["ts"]) else str(r["scan_id"])
        st.markdown(f"- **{when}** · {r['mode']} · {int(r['total']):,} findings")
    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="sh_del_cancel", width="stretch"):
        st.rerun()
    if c2.button("Delete", type="primary", key="sh_del_confirm", width="stretch"):
        _perform_delete(selected_ids)
        st.rerun()
```

- [ ] **Step 3: Wire the controls into `page()`**

In `wiz_dashboard/ui/pages/scan_history.py`, in `page()`, replace:

```python
    ui.section_label("Saved scans")
    _scans_table(scans)
```

with:

```python
    ui.section_label("Saved scans")
    selected = _scans_table(scans)
    _delete_controls(scans, selected)
```

- [ ] **Step 4: Verify the page still renders cleanly (no selection => no button)**

Run: `python -m pytest tests/test_scan_history_page.py::test_page_renders_after_persist tests/test_scan_history_page.py::test_empty_state_without_scans -v`
Expected: PASS (the selectable table renders; with no rows selected, no delete button/dialog appears).

- [ ] **Step 5: Commit**

```bash
git add wiz_dashboard/ui/pages/scan_history.py
git commit -m "feat(scan-history): multi-row select + confirm-dialog delete"
```

---

## Task 10: Full suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `python -m pytest -q`
Expected: PASS (no regressions across all test files).

- [ ] **Step 2: Manual click-test in the app**

Run: `python -m streamlit run app.py`
Then:
1. Run two scans (sidebar / OS vulnerabilities page) — switch the dry-run shape to **flat** at least once so the ledger populates.
2. Open **Scan History**. Select one scan's row → "Delete selected (1)" appears → click → confirm dialog lists it → **Delete**.
3. Confirm: the scan disappears from "Saved scans", the KPI band + "Vulnerability base" + trend charts update, and a success toast shows the rebuilt counts.
4. Select and delete **all** scans → page returns to the "No scans saved yet" empty state.

Expected: all of the above behave as described; no exceptions in the terminal.

- [ ] **Step 3: Final commit (if any docs touched)**

```bash
git add -A
git commit -m "chore: delete-scans feature complete"
```

---

## Self-Review

**Spec coverage:**
- Replay-rebuild semantics → Tasks 1–4 (`delete_scans` + equivalence/latest/all/disappearance/grouped).
- Crash-safety (validate + snapshot + restore; refuse on missing flat archive) → Task 6.
- Remove deleted scan's archive, keep survivors' → Task 5.
- Multi-row select + "Delete selected" + confirm dialog → Task 9.
- `_perform_delete` (delete + cache clear + toast + `LedgerRebuildError` handling) → Task 8.
- Shared `clear_ledger_caches()` used by `scan.py` + delete flow → Task 7.
- `mttr_history.json` non-goal → intentionally untouched (no task), matching the spec.
- Tests against `tmp_path` DB, keystone equivalence, all listed behaviors → Tasks 1–9.

**Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step shows complete code; every test step shows the assertions.

**Type consistency:** `delete_scans(scan_ids, db_path=None) -> {"deleted","scans","tracked"}` and `delete_scan` wrapper are used consistently in Tasks 1–9; `LedgerRebuildError`, `_read_raw_payload`, `_records_from_payload`, `_restore_db`, `clear_ledger_caches`, `_perform_delete`, `_delete_controls`, `_confirm_delete`, `_scans_table` names match across every reference.
