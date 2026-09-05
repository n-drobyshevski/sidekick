// Storage — the register's footprint, and the actions that shrink or destroy it.
//
// AN UNREADABLE TAB IS AN ERROR, NEVER ZERO CELLS. `storageModel`'s `cellsByTab` (D9's
// `readModels.ts::cellsByTab`) tries `gridSize()` per declared tab and, on a throw, publishes
// `{tab, cells: null, error: String(e)}` rather than folding the failure into a 0 — a missing
// number here must not read as an empty tab. `cellsOther` is the spreadsheet's total minus
// every tab this register knows how to name, so it is shown as its own row rather than
// silently folded into the total.
//
// EVERY DESTRUCTIVE ACTION IS GATED BY `confirmedAction`, THE ONE PURE CHOKEPOINT. Delete and
// reset are not undoable (delete rebuilds the ledger from the surviving scans; reset wipes it
// to never-compacted); a real compaction seals scans permanently. `confirmedAction` never
// calls its action without a true confirmation first, and that is what test/pagesData.test.js
// measures directly — a fake confirm returning false must leave the action uncalled.
//
// COMPACTION OFFERS ITS DRY RUN FIRST. `compact({dryRun:true})` takes no lock and mutates
// nothing (`api.ts`'s module header: "a dry run mutates nothing, so it is a read"), so it
// loads automatically; the real run is a second, confirmed step. `archive_bytes_freed` is
// captioned as a LOWER BOUND on every read of it — S2's archive API prices whole subfolders
// and the figure excludes observation files by construction (ledgerStore.ts), not because the
// number can be null.

import { bootstrap, bootstrapCached, swrCall } from "../../../../../gas_shared/store.js";
import { call } from "../../../../../gas_shared/api.js";
import {
  clear, confirmDialog, dataTable, denomNote, downloadText, el, emptyState, errorState,
  firstRunNotice,
  fmtCount, fmtDateTime, kpiCard, num, pageHeader, pct1, registerWideNote,
  sectionLabel, skeletonStack, statusPill, toast,
} from "../ui.js";

// ---------------------------------------------------------------------------- formatting
//
// `num`, `fmtCount`, `pct1` and `denomNote` used to be DEFINED here — this file had the
// corrected refuse-before-cast shape, which is why `ui/figures.js` (the one shared
// implementation every page in this package now imports) matches this file's shape rather
// than `sca.js`'s wrong one. See that module's header for the defect it replaces.

/**
 * Whether a view-project scope is currently narrowing every OTHER page. `storageModel` takes
 * no params at all (`readModels.ts::buildStorage`) and reports `scopeApplies: false`
 * unconditionally — a spreadsheet tab has no project column to narrow, whether or not one is
 * selected — so THIS page decides when the note is worth saying: unscoped, "showing
 * everything" is the resting state and a permanent register-wide badge on a register-wide app
 * is noise, not information.
 */
export function currentlyScoped() {
  const boot = bootstrapCached();
  return !!(boot && boot.scope && boot.scope.projectView);
}

// ------------------------------------------------------------------------- pure view models

/**
 * Cell usage per declared tab. `unreadable` is what separates "counted, 0 cells" from
 * "could not be counted" — a tab that throws carries `cells: null` and its `error` text,
 * never a fabricated 0.
 */
export function tabCellsView(cellsByTab) {
  return (Array.isArray(cellsByTab) ? cellsByTab : []).map((t) => ({
    tab: t && t.tab,
    cells: t && t.cells !== null && t.cells !== undefined ? num(t.cells) : null,
    error: (t && t.error) || null,
    unreadable: !!(t && t.error),
  }));
}

/** The register-wide cell ceiling: what is used, what is headroom, and the share. */
export function cellsSummary(model) {
  const limit = num(model && model.cellLimit);
  const total = num(model && model.cellCount, 0);
  return {
    total,
    limit,
    other: num(model && model.cellsOther, 0),
    pctUsed: limit !== null && limit > 0 ? (total / limit) * 100 : null,
  };
}

/** The ledger's own scan/finding counts — what is stored, not what it costs. */
export function ledgerSummary(model) {
  return {
    scanCount: num(model && model.scanCount, 0),
    sealedCount: num(model && model.sealedCount, 0),
    trackedFindings: num(model && model.trackedFindings, 0),
    ledgerRowCells: num(model && model.ledgerRowCells, 0),
    oldestScanTs: (model && model.oldestScanTs) || null,
    newestScanTs: (model && model.newestScanTs) || null,
    unknownSeverityCount: num(model && model.unknownSeverityCount, 0),
    distinctSeverities: Array.isArray(model && model.distinctSeverities) ? model.distinctSeverities : [],
  };
}

/** Scans a delete picker may offer — sealed rows are excluded; the server refuses them too. */
export function deletableScans(scans) {
  return (Array.isArray(scans) ? scans : [])
    .filter((s) => !(s.sealed === 1 || s.sealed === true))
    .map((s) => ({
      scanId: s.scan_id,
      ts: s.ts,
      scope: s.scope,
      total: num(s.total, 0),
    }));
}

/**
 * The compaction dry-run (or real-run) result, read the same way either time —
 * `compact({dryRun:true})` and a real `compact()` share `CompactionResult`'s shape.
 * `archiveBytesFreed`/`dbBytesFreed` are ALWAYS a lower bound on the archive half; that is
 * captioned at render time rather than modeled here as a nullable field, because the type
 * really is a plain number that undercounts, not an absent one.
 */
export function compactionView(preview) {
  const c = (preview && preview.compaction) || preview || {};
  return {
    noOp: !!c.no_op,
    dryRun: !!c.dry_run,
    scansSealed: num(c.scans_sealed, 0),
    episodesCreated: num(c.episodes_created, 0),
    observationsPruned: num(c.observations_pruned, 0),
    archiveBytesFreed: num(c.archive_bytes_freed, 0),
    dbBytesFreed: num(c.db_bytes_freed, 0),
    floorTs: c.floor_ts || null,
  };
}

/** The recent-errors panel: its rows, AND the scope note saying what it does not cover. */
export function recentErrorsView(payload) {
  return {
    errors: Array.isArray(payload && payload.errors) ? payload.errors : [],
    covers: (payload && payload.covers) || null,
    note: (payload && payload.note) || null,
  };
}

/**
 * The one chokepoint every destructive control on this page runs through: `action` is never
 * invoked unless `confirm` resolves true. Exported so a test can substitute both without a
 * DOM and assert the un-confirmed path never reaches the action.
 */
export async function confirmedAction(confirm, action) {
  const ok = await confirm();
  if (!ok) return { ran: false, result: undefined };
  const result = await action();
  return { ran: true, result };
}

// ----------------------------------------------------------------------------- the page

export async function renderData(host, _params, ctx) {
  host.append(pageHeader({
    route: "data",
    lede: "The register's storage: what it occupies, what can be exported, what can be reset.",
  }));

  const noticeHost = el("div", {});
  const storageHost = el("div", {});
  const exportHost = el("section", { class: "card" });
  const compactHost = el("section", { class: "card" });
  const deleteHost = el("section", { class: "card" });
  const resetHost = el("section", { class: "card" });
  const errorsHost = el("div", {});

  host.append(
    noticeHost,
    sectionLabel("Space in use"),
    storageHost,
    sectionLabel("Export"),
    exportHost,
    sectionLabel("Compaction"),
    compactHost,
    sectionLabel("Delete scans"),
    deleteHost,
    sectionLabel("Reset"),
    resetHost,
    sectionLabel("Recent errors"),
    errorsHost,
  );

  // THE ZEROS BELOW THIS NOTICE ARE MEASUREMENTS, and that is why they stay. This page's
  // subject is storage occupancy: "Saved scans 0" is a true census of a ledger that has zero
  // saved scans, and it is what the delete and reset controls act on. What it needed was the
  // ORIGIN above it — a reader meeting a page of zeros with no line saying the register has
  // never been synced cannot tell an empty ledger from a broken read.
  // `await bootstrap()`, not `bootstrapCached()`: a null cache would read as "never synced"
  // and post the notice over a register that has been synced all week.
  if (!(await bootstrap()).latestSync) {
    noticeHost.append(firstRunNotice({
      synced: false,
      hint: "The figures below are a census of what is stored, so they read zero honestly."
        + " Run a sync with the Run sync button in the rail to give them something to count.",
    }));
  }

  storageHost.append(skeletonStack(3, { variant: "stat" }));

  const storagePromise = swrCall("api_getStorageStats", {}, (fresh) => renderStorage(fresh));
  const historyPromise = swrCall("api_getScanHistory", {}, (fresh) => renderDelete(fresh.scans));
  const errorsPromise = swrCall("api_getRecentErrors", {}, (fresh) => renderErrors(fresh));

  renderExport();
  renderCompact();
  renderReset();

  try {
    renderStorage(await storagePromise);
  } catch (e) {
    console.error("[data] api_getStorageStats failed:", e);
    // A failure, not an absence. This page already had `errorState` on the compaction dry run
    // (below); these three fetches had `emptyState`, so a broken read of the storage tab and
    // an empty storage tab were the same box in the same voice.
    clear(storageHost).append(errorState(
      "Couldn't load storage usage.",
      { detail: String((e && e.message) || e) },
    ));
  }

  try {
    renderDelete((await historyPromise).scans);
  } catch (e) {
    console.error("[data] api_getScanHistory failed:", e);
    clear(deleteHost).append(errorState(
      "Couldn't load the scan list.",
      { detail: String((e && e.message) || e) },
    ));
  }

  try {
    renderErrors(await errorsPromise);
  } catch (e) {
    console.error("[data] api_getRecentErrors failed:", e);
    clear(errorsHost).append(errorState(
      "Couldn't load recent errors.",
      { detail: String((e && e.message) || e) },
    ));
  }

  // -------------------------------------------------------------------------- storage

  function renderStorage(model) {
    const cells = cellsSummary(model);
    const ledger = ledgerSummary(model);
    const tabs = tabCellsView(model && model.cellsByTab);
    clear(storageHost);

    const kpiRow = el("div", { class: "kpi-row" });
    const headroom = kpiCard("Cells in use", fmtCount(cells.total));
    headroom.append(denomNote(
      cells.limit === null ? "No published ceiling." : `${pct1(cells.pctUsed)} of ${cells.limit.toLocaleString()} cells.`,
    ));
    kpiRow.append(
      headroom,
      kpiCard("Tracked findings", fmtCount(ledger.trackedFindings)),
      kpiCard("Saved scans", fmtCount(ledger.scanCount), `${fmtCount(ledger.sealedCount)} sealed`),
    );
    storageHost.append(kpiRow);

    storageHost.append(dataTable({
      columns: [
        { key: "tab", label: "Tab", cell: (r) => r.tab },
        {
          key: "cells", label: "Cells", className: "num",
          cell: (r) => (r.unreadable
            ? statusPill("bad", "Unreadable")
            : (r.cells === null ? "—" : r.cells.toLocaleString())),
        },
      ],
      rows: tabs,
      emptyText: "No tabs reported.",
    }));
    if (tabs.some((t) => t.unreadable)) {
      storageHost.append(el("p", { class: "small muted" },
        "An unreadable tab is reported as an error, not as zero cells: "
        + tabs.filter((t) => t.unreadable).map((t) => `${t.tab} (${t.error})`).join("; ") + "."));
    }
    storageHost.append(denomNote(
      `Plus ${cells.other.toLocaleString()} cell(s) in sheets this register does not manage — `
      + `the spreadsheet's own total, less the tabs listed above. `
      + `${ledger.ledgerRowCells.toLocaleString()} column(s) per ledger row.`,
    ));
    // `scopeApplies: false` on `storageModel` is unconditional (it takes no params), but the
    // note only earns its place while a project view is actually narrowing the rest of the
    // app — see currentlyScoped's doc comment.
    if (model && model.scopeApplies === false && currentlyScoped()) {
      storageHost.append(registerWideNote(
        model.scopeNote || "These figures describe the whole register, regardless of the "
          + "view-project scope.",
      ));
    }
    if (ledger.unknownSeverityCount > 0) {
      storageHost.append(el("p", { class: "small muted" },
        `${ledger.unknownSeverityCount.toLocaleString()} row(s) carry a severity that did not `
        + `normalize to ${ledger.distinctSeverities.join(", ") || "a known level"}.`));
    }
  }

  // -------------------------------------------------------------------------- export

  function renderExport() {
    clear(exportHost);
    const btn = el("button", { onclick: doExport }, "Download ledger CSV");
    exportHost.append(
      el("p", { class: "small muted" },
        "The ledger tab, exactly as its own columns are declared — no client-side column is "
        + "added and none of the ledger's own columns is dropped."),
      btn,
    );

    async function doExport() {
      btn.disabled = true;
      try {
        const res = await call("api_getExportCsv", {});
        downloadText(res.filename, res.content, "text/csv;charset=utf-8");
        toast(`Exported ${res.rowCount.toLocaleString()} row(s), ${res.columns} column(s).`);
      } catch (e) {
        toast(`Export failed: ${(e && e.message) || e}`, "error");
      } finally {
        btn.disabled = false;
      }
    }
  }

  // ------------------------------------------------------------------------- compact

  function renderCompact() {
    clear(compactHost);
    const previewHost = el("div", {});
    const runBtn = el("button", { class: "primary", onclick: runCompact, disabled: true }, "Run compaction");
    compactHost.append(
      el("p", { class: "small muted" },
        "The dry run below is what a real compaction would do — nothing is written until "
        + "“Run compaction” is confirmed."),
      previewHost,
      runBtn,
    );
    loadPreview();

    async function loadPreview() {
      clear(previewHost).append(el("p", { class: "small muted" }, "Computing the dry run…"));
      try {
        const res = await call("api_compact", { dryRun: true });
        paintPreview(res);
      } catch (e) {
        clear(previewHost).append(errorState("Couldn't compute the compaction dry run.", { detail: String((e && e.message) || e) }));
      }
    }

    function paintPreview(res) {
      const v = compactionView(res);
      clear(previewHost);
      if (v.noOp) {
        previewHost.append(el("p", { class: "small muted" }, "Nothing to compact right now."));
        runBtn.disabled = true;
        return;
      }
      runBtn.disabled = false;
      previewHost.append(
        el("p", {},
          `Would seal ${v.scansSealed.toLocaleString()} scan(s) into `
          + `${v.episodesCreated.toLocaleString()} episode(s), pruning `
          + `${v.observationsPruned.toLocaleString()} observation(s).`),
        denomNote(
          `Frees at least ${v.archiveBytesFreed.toLocaleString()} archive byte(s) and `
          + `${v.dbBytesFreed.toLocaleString()} spreadsheet byte(s) — a lower bound, because the `
          + `archive figure prices whole scan folders and excludes observation files.`,
        ),
      );
    }

    async function runCompact() {
      const { ran, result } = await confirmedAction(
        () => confirmDialog({
          title: "Run compaction?",
          body: "Seals the scans the dry run named into permanent episodes. This cannot be undone.",
          confirmLabel: "Run compaction",
          danger: true,
        }),
        () => call("api_compact", { dryRun: false }),
      );
      if (!ran) return;
      const v = compactionView(result);
      toast(v.noOp
        ? "Nothing to compact."
        : `Sealed ${v.scansSealed.toLocaleString()} scan(s) into ${v.episodesCreated.toLocaleString()} episode(s).`);
      ctx && ctx.refresh && ctx.refresh();
      loadPreview();
    }
  }

  // -------------------------------------------------------------------------- delete

  function renderDelete(scans) {
    const rows = deletableScans(scans);
    clear(deleteHost);
    if (!rows.length) {
      deleteHost.append(emptyState("No deletable scans.", "Sealed scans can't be deleted here."));
      return;
    }
    const selected = new Set();
    const deleteBtn = el("button", { class: "danger", disabled: true, onclick: onDelete }, "Delete selected");
    const tableHost = el("div", {});
    deleteHost.append(
      el("p", { class: "small muted" },
        "Deletion rebuilds the ledger by replaying the surviving scans, as if the deleted "
        + "ones had never been saved. This cannot be undone."),
      deleteBtn,
      tableHost,
    );

    function syncBtn() {
      deleteBtn.disabled = !selected.size;
      deleteBtn.textContent = selected.size ? `Delete selected (${selected.size})` : "Delete selected";
    }

    clear(tableHost).append(dataTable({
      columns: [
        {
          key: "sel", label: "",
          cell: (r) => {
            const cb = el("input", { type: "checkbox", "aria-label": `Select scan ${fmtDateTime(r.ts)}` });
            cb.checked = selected.has(r.scanId);
            cb.addEventListener("change", () => {
              if (cb.checked) selected.add(r.scanId);
              else selected.delete(r.scanId);
              syncBtn();
            });
            return cb;
          },
        },
        { key: "ts", label: "When", cell: (r) => fmtDateTime(r.ts) },
        { key: "scope", label: "Register", cell: (r) => r.scope },
        { key: "total", label: "Findings", className: "num", cell: (r) => r.total.toLocaleString() },
      ],
      rows,
      emptyText: "No deletable scans.",
    }));

    async function onDelete() {
      const ids = [...selected];
      const { ran, result } = await confirmedAction(
        () => confirmDialog({
          title: `Delete ${ids.length} scan(s)?`,
          body: "The ledger is rebuilt from the surviving scans. This cannot be undone.",
          confirmLabel: "Delete and rebuild",
          danger: true,
        }),
        () => call("api_deleteScans", { scanIds: ids }),
      );
      if (!ran) return;
      toast(`Deleted ${result.deleted} scan(s); ${result.tracked.toLocaleString()} finding(s) tracked.`);
      ctx && ctx.refresh && ctx.refresh();
    }
  }

  // --------------------------------------------------------------------------- reset

  function renderReset() {
    clear(resetHost);
    const btn = el("button", { class: "danger", onclick: onReset }, "Reset ledger");
    resetHost.append(
      el("p", { class: "small muted" },
        "Wipes every scan, tracked finding, and compaction back to a fresh, never-compacted "
        + "ledger. Drive archives are left in place. This cannot be undone."),
      btn,
    );

    async function onReset() {
      const { ran, result } = await confirmedAction(
        () => confirmDialog({
          title: "Reset the ledger?",
          body: "Permanently clears every scan, tracked finding, and compaction record. This "
            + "cannot be undone.",
          confirmLabel: "Reset ledger",
          danger: true,
        }),
        () => call("api_resetLedger", {}),
      );
      if (!ran) return;
      toast(`Cleared ${result.scans} scan(s), ${result.findings} finding(s), `
        + `${result.episodes} episode(s), ${result.repos} repo(s), ${result.compactions} compaction(s).`);
      ctx && ctx.refresh && ctx.refresh();
    }
  }

  // ------------------------------------------------------------------------- errors

  function renderErrors(payload) {
    const v = recentErrorsView(payload);
    clear(errorsHost);
    errorsHost.append(el("p", { class: "small muted", "data-denominator": v.covers ? `Covers: ${v.covers}.` : "" },
      v.note || (v.covers ? `Covers: ${v.covers}.` : "Scope unknown.")));
    if (!v.errors.length) {
      errorsHost.append(emptyState("No recent failures."));
      return;
    }
    errorsHost.append(dataTable({
      columns: [
        { key: "at", label: "When", cell: (r) => fmtDateTime(r.at) },
        { key: "kind", label: "Kind", cell: (r) => r.kind },
        { key: "scope", label: "Register", cell: (r) => r.scope || "—" },
        { key: "phase", label: "Phase", cell: (r) => r.phase },
        { key: "error", label: "Error", cell: (r) => r.error },
      ],
      rows: v.errors,
      emptyText: "No recent failures.",
    }));
  }
}
