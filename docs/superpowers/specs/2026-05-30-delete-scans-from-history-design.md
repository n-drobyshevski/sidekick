# Delete scans from Scan History — design

- **Date:** 2026-05-30
- **Status:** Approved (brainstorm), pending implementation plan
- **Area:** `wiz_dashboard` — Scan History page + durable SQLite ledger

## Problem

The Scan History page shows every saved scan, but there is no way to remove one.
A bogus or test scan (e.g. an accidental dry-run) permanently pollutes the durable
vulnerability ledger and therefore skews MTTR — which is the entire reason the
ledger subsystem exists. Users need to delete scans **and have the derived data
corrected as if the scan had never run.**

## Decisions (settled during brainstorming)

1. **Delete semantics = recompute, not hide.** Deleting a scan rebuilds the ledger,
   observations, and MTTR by replaying the surviving scans. The derived state always
   equals what it would be if the deleted scan had never been saved.
2. **UI = multi-row select + "Delete selected" button + confirm dialog.** The existing
   "Saved scans" table becomes row-selectable; a primary button and a modal confirm the
   destructive, recompute-triggering action. Bulk delete supported.

## Background: the data model

The ledger (`data/ledger.py`, SQLite at `data/ledger.db`) is a **deterministic
cumulative reduction** over scans replayed in `ts` order:

- `scans` — one row per scan (`scan_id` PK, `ts`, `mode`, `shape`, `total`,
  `new_count`, `resolved_count`, `reopened_count`, `raw_path`).
- `vuln_ledger` — the deduplicated per-vulnerability base (`first_seen`, `last_seen`,
  `status`, `resolved_at`, `resolution_src`, `reopened_count`, `first_scan_id`,
  `last_scan_id`, `latest_json`, …).
- `observations` — per-scan, per-vuln log (`scan_id`, `vuln_key`, `present`,
  `severity`, `status`).
- Raw payloads archived as `data/scans/<scan_id>.json` (git-ignored).

A scan's effects are entangled across the sequence: `first_seen = min(API first,
scan ts)`; disappearance resolutions are timed to the scan that first shows an
absence; `reopened_count` accumulates; per-scan deltas are computed relative to the
*previous* scan. Removing a scan from anywhere but the very end therefore cannot be a
local edit — the derived state must be re-derived.

## Approach: deletion *is* a replay

`persist_flat_scan` / `persist_grouped_scan` already accept an explicit `scan_id` and
`raw`, and reconcile against whatever scans precede them. So deletion needs **no new
"undo" logic** — it reuses the exact code that built the ledger:

1. Take the surviving scans (all minus the deleted ids), ordered by `ts` ascending.
2. Wipe the three derived tables (`vuln_ledger`, `observations`, `scans`).
3. Replay each survivor through the existing persist functions, using its original
   `scan_id` / `mode` / `raw` (read from the archived payload).

Because `scan_id == scan_ts` on replay and every lifecycle field is a pure function of
the ordered scan sequence, the rebuilt ledger is **byte-for-byte identical** to a
ledger that had only ever seen the survivors. This equivalence is the keystone
invariant and the keystone test:

> build `[s1, s3]` directly  ==  build `[s1, s2, s3]` then delete `s2`.

Each scan's flat records are reconstructed from its archived payload via the same
pipeline the live scan and existing tests use:
`nodes_to_dataframe(extract_nodes(raw)).to_dict("records")`.

## Data-layer API (`data/ledger.py`)

```python
class LedgerRebuildError(Exception): ...

def delete_scan(scan_id, db_path=None) -> dict      # thin wrapper over delete_scans
def delete_scans(scan_ids, db_path=None) -> dict
    # returns {"deleted": int, "scans": int, "tracked": int}
```

Algorithm (crash-safe via backup/restore — never leaves a half-rebuilt ledger):

1. Resolve the DB path; if the DB does not exist, no-op (return zeros).
2. Read surviving scan rows (`ts` asc, tie-break `scan_id`) and **pre-load every
   survivor's raw payload from its `raw_path`.** If a *flat* survivor's archive is
   missing or unreadable, raise `LedgerRebuildError` **before any mutation** — the
   deletion is refused, the DB is untouched, and the UI surfaces a clear message
   naming the un-replayable scan. Grouped survivors never touch the ledger, so a
   missing/unreadable grouped archive is *not* fatal: re-insert that scan's `scans`
   row directly from its stored columns (`scan_id`, `ts`, `mode`, `shape`, `total`,
   zero deltas, original `raw_path`) instead of replaying from findings.
3. `PRAGMA wal_checkpoint(TRUNCATE)`, then copy the DB file to `<db>.bak`.
4. In one transaction: `DELETE FROM vuln_ledger`, `DELETE FROM observations`,
   `DELETE FROM scans`.
5. Replay survivors in `ts` order: `shape == "grouped"` → `persist_grouped_scan`,
   else `persist_flat_scan`, passing the original `scan_id` / `mode` / `raw`.
   (Re-archiving overwrites identical bytes — harmless.)
6. On success: delete the *target* scans' `data/scans/<id>.json` files (best-effort),
   then delete `<db>.bak`. On any exception during 4–5: restore the DB from `<db>.bak`
   and re-raise.

`ledger.py` gains a sibling import of `data.transform` (`extract_nodes`,
`nodes_to_dataframe`) — both pure, no import cycle.

## UI changes (`ui/pages/scan_history.py`)

- `_scans_table` becomes selectable:
  `st.dataframe(..., selection_mode="multi-row", on_select="rerun", key="sh_scans")`.
  `scan_id` is carried in the frame (not displayed) so positional selection maps to ids.
- A **"Delete selected (N)"** primary button in the "Saved scans" section header row,
  enabled only when rows are selected.
- Clicking opens a `@st.dialog("Delete scans?")` modal that lists the chosen scans
  (when / mode / findings), warns *"This rebuilds the vulnerability ledger and
  recomputes MTTR,"* and offers **Cancel** / **Delete** (destructive).
- Confirm → `ledger.delete_scans(ids)` → clear the ledger caches → success toast
  (`"Deleted N scan(s); ledger rebuilt — M scans, K tracked vulns"`) → `st.rerun()`.
- A `LedgerRebuildError` is caught and shown as a warning toast; nothing is deleted.

## Shared refactor

`_persist_scan` (in `ui/scan.py`), the test conftest fixture, and the new delete flow
all clear the same five `_derived.ledger_*` caches. Extract a single
`_derived.clear_ledger_caches()` helper and call it from `ui/scan.py` and
`scan_history.py`, keeping the invalidation set in one place.

## Edge cases

- **Delete all scans** → all three tables empty; page returns to its existing empty
  state.
- **Delete a grouped scan** → its row is dropped; grouped scans never affected
  reconciliation, so the flat lifecycle is unchanged.
- **Missing survivor archive (flat)** → refused before mutation (see step 2).
- **Selection stability** → the table is sorted `ts` desc and re-renders deterministically,
  so positional selection maps consistently within a render.

## Non-goal (v1)

`mttr_history.json` (the legacy "one median per UTC day, latest-wins" log) is **not**
rewritten on delete. It is lossy and not scan-addressable, so it cannot be faithfully
un-rolled. The Scan History page's trend is ledger-derived and *is* corrected; the
legacy JSON is left as-is and this limitation is documented. (Revisit only if the MTTR
page's JSON-backed trend proves visibly inconsistent after deletes.)

## Testing (TDD, against a `tmp_path` DB)

`tests/test_ledger.py`:

- **Keystone:** delete-then-state equals build-survivors-directly (identical
  `vuln_ledger` rows and scan deltas).
- Delete a middle scan recomputes `first_seen` / `mttr_days` for a vuln first seen there.
- Delete the scan that triggered a disappearance-resolution un-resolves that vuln.
- Delete the latest scan == the state after the prior scan.
- Delete-all empties `scans`, `vuln_ledger`, `observations`.
- Delete a grouped scan leaves the flat lifecycle intact; its row is removed.
- The target scan's `data/scans/<id>.json` is removed; survivors' archives are retained.
- A missing survivor (flat) archive raises `LedgerRebuildError` and leaves the DB
  unchanged.
- Per-scan delta columns are recomputed relative to surviving predecessors.

`tests/test_scan_history_page.py`:

- The delete flow calls `ledger.delete_scans` with the selected ids and clears the
  ledger caches.

## Touchpoints

- `wiz_dashboard/data/ledger.py` — `delete_scans` / `delete_scan` / `LedgerRebuildError`
  + raw-payload reader + rebuild.
- `wiz_dashboard/ui/pages/scan_history.py` — selectable table, delete button, confirm
  dialog, cache clear.
- `wiz_dashboard/ui/pages/_derived.py` — `clear_ledger_caches()` helper.
- `wiz_dashboard/ui/scan.py` — use the shared cache-clear helper.
- `tests/test_ledger.py`, `tests/test_scan_history_page.py` — tests above.
