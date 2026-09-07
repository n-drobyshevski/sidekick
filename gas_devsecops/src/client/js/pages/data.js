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
  absentText, clear, confirmDialog, dataTable, denomNote, downloadText, el, emptyState,
  errorState, firstRunNotice,
  fmtCount, fmtDateTime, glossaryTip, kpiCard, num, pageHeader, registerWideNote,
  sectionLabel, skeletonStack, statusPill, toast,
} from "../ui.js";
import { usageMeter } from "../../../../../gas_shared/ui/usageMeter.js";

// Warn/bad thresholds for the register's own 10M-cell ceiling — gas/src/client/js/capacity.js
// holds the identical pair (WARN_AT = 0.6, BAD_AT = 0.85) so its Data page and Settings panel
// can never disagree; this register shows the meter on Data only (Settings carries no storage
// section here — gas_shared/README.md's diagnostics table), so the two constants live here,
// the one place a ratio against this ceiling is computed. usageMeter.js's own header says
// where thresholds live: "not here… `state` arrives already decided."
export const CELLS_WARN_AT = 0.6;
export const CELLS_BAD_AT = 0.85;

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

/** "" | "warn" | "bad" for a used/limit ratio, against this module's own CELLS_*_AT pair. */
export function cellsState(pctUsed) {
  if (pctUsed === null) return "";
  const ratio = pctUsed / 100;
  if (ratio >= CELLS_BAD_AT) return "bad";
  if (ratio >= CELLS_WARN_AT) return "warn";
  return "";
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
    // THE FOOTPRINT NOTE, ONE LEVEL DOWN. "Plus N cell(s) in sheets this register does not
    // manage — the spreadsheet's own total, less the tabs listed above" was a 28-word
    // paragraph under the table; the counts stay visible in `denomNote` below (R3's short
    // form), and the METHOD — which sheets that total excludes, and what the per-row figure
    // counts — moves to this heading's own tip, since the numbers beside it already say how
    // much either one is.
    sectionLabel("Space in use", {
      lines: [
        "The spreadsheet's own total, less the tabs already listed above — cells in sheets "
        + "this register does not manage.",
        "The per-row figure counts ledger columns, not cells.",
      ],
    }),
    storageHost,
    sectionLabel("Export", {
      lines: ["No client-side column is added, and none of the ledger's own columns is dropped."],
    }),
    exportHost,
    // THE THREE WORDS THIS PAGE RUNS ON, each now defined where it is used rather than
    // three sections later. "Compaction" is the act, "sealed" is the state it leaves a saved
    // scan in, and an "episode" is what a finding's row becomes — the page used all three as
    // if they were plain English.
    sectionLabel("Compaction", { term: "compaction" }),
    compactHost,
    sectionLabel("Delete scans", {
      lines: ["Deletion rebuilds the ledger by replaying the surviving scans, as if the "
        + "deleted ones had never been saved."],
    }),
    deleteHost,
    sectionLabel("Reset", {
      lines: [
        "Wipes every scan, tracked finding, and compaction back to a fresh, never-compacted "
        + "ledger.",
        "Drive archives are left in place.",
      ],
    }),
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
    // NO `at:` HERE, ON PURPOSE — this call renders ONLY inside the branch where
    // `latestSync` is falsy, so `synced` above is the literal `false`, not a value derived at
    // render time, and there is no sync to date. Same shape as gas's attribution.js (which
    // also renders only when `synced` is hard-coded false); this route is named in
    // `firstRunNoAt` in `test/shared.test.js` rather than carrying a meaningless `at:`.
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

    // A real ceiling gets the shared capacity meter (gas_shared/ui/usageMeter.js) rather than
    // a bare KPI card and a caption below it — the same widget gas/Settings draws over its
    // own 10M-cell ceiling, so a reader who has seen one sidekick's Storage page recognises
    // this one. No published ceiling (a stale pre-rollout cache, or a tenant this app has
    // never measured against) keeps the KPI-card fallback: a meter with no denominator would
    // draw an empty track, which reads as "0% used" rather than as "not measured".
    const state = cellsState(cells.pctUsed);
    const note = state === "bad"
      ? "Past 85% of the 10M-cell ceiling. A spreadsheet refuses new rows once it is reached, "
        + "so a sync would fail mid-save. Compact sealed scans below to reclaim room."
      : state === "warn"
        ? "Past 60% of the 10M-cell ceiling. Compacting sealed scans below reclaims room."
        : null;
    const kpiRow = el("div", { class: "kpi-row" });
    if (cells.limit === null) {
      const headroom = kpiCard("Cells in use", fmtCount(cells.total));
      headroom.append(denomNote("No published ceiling."));
      kpiRow.append(headroom);
    } else {
      storageHost.append(usageMeter({
        used: cells.total, total: cells.limit, label: "Cells in use", state, note,
      }));
    }
    kpiRow.append(
      kpiCard("Tracked findings", fmtCount(ledger.trackedFindings)),
      kpiCard("Saved scans", fmtCount(ledger.scanCount),
        el("span", {}, `${fmtCount(ledger.sealedCount)} `, glossaryTip("sealed", "sealed"))),
    );
    storageHost.append(kpiRow);

    storageHost.append(dataTable({
      columns: [
        { key: "tab", label: "Tab", cell: (r) => r.tab },
        {
          key: "cells", label: "Cells", className: "num",
          cell: (r) => (r.unreadable
            ? statusPill("bad", "Unreadable")
            : (r.cells === null ? absentText : fmtCount(r.cells))),
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
    // THE NUMBERS STAY ON THE SURFACE (R3): what they mean — which sheets the first count
    // excludes, and that the second one is a column count, not a cell count — is the "Space
    // in use" heading's own tip now, since restating it here would say it twice.
    storageHost.append(denomNote(
      `${fmtCount(cells.other)} cells in unmanaged sheets · `
      + `${fmtCount(ledger.ledgerRowCells)} columns per row`,
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
        `${fmtCount(ledger.unknownSeverityCount)} row(s) carry a severity that did not `
        + `normalize to ${ledger.distinctSeverities.join(", ") || "a known level"}.`));
    }
  }

  // -------------------------------------------------------------------------- export

  function renderExport() {
    clear(exportHost);
    const btn = el("button", { onclick: doExport }, "Download ledger CSV");
    exportHost.append(
      el("p", { class: "small muted" }, "The ledger tab, exactly as its own columns are declared."),
      btn,
    );

    async function doExport() {
      btn.disabled = true;
      try {
        const res = await call("api_getExportCsv", {});
        downloadText(res.filename, res.content, "text/csv;charset=utf-8");
        toast(`Exported ${fmtCount(res.rowCount)} row(s), ${res.columns} column(s).`);
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
    // COMPRESSED TO THE ONE CLAUSE THAT IS A CONSTRAINT — nothing is written before you
    // confirm. What a compaction actually DOES is already the "compaction" glossary entry
    // this section's own heading carries ("the dry run states what would go before anything
    // goes"), so restating it here would be the same sentence twice rather than a level down.
    compactHost.append(
      el("p", { class: "small muted" }, "Preview only — nothing is written until you confirm."),
      previewHost,
      runBtn,
    );
    loadPreview();

    async function loadPreview() {
      clear(previewHost).append(
        el("div", { role: "status", "aria-label": "Computing the compaction dry run" },
          skeletonStack(2, { widths: ["80%", "60%"] })),
      );
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
          `Would seal ${fmtCount(v.scansSealed)} scan(s) into ${fmtCount(v.episodesCreated)} `,
          glossaryTip("episode", "episode"),
          `(s), pruning ${fmtCount(v.observationsPruned)} observation(s).`),
        denomNote(
          `Frees at least ${fmtCount(v.archiveBytesFreed)} archive byte(s) and `
          + `${fmtCount(v.dbBytesFreed)} spreadsheet byte(s) — a lower bound, because the `
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
        : `Sealed ${fmtCount(v.scansSealed)} scan(s) into ${fmtCount(v.episodesCreated)} episode(s).`);
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
    // COMPRESSED TO ITS ONE CONSTRAINT (R2 KEEP: an irreversible action's warning stays on the
    // surface, never only in a tip). The mechanism — what deletion actually does — moved to
    // the "Delete scans" heading's own tip, and the confirm dialog below repeats both.
    deleteHost.append(
      el("p", { class: "small muted" }, "This cannot be undone."),
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
          // An empty `<th>` reads as "empty-table-header" to axe — the column carries a
          // control (the checkbox), but nothing names what it is FOR, sighted or not. The
          // visible header stays blank (a bordered checkbox column reads fine at a glance);
          // the name rides in an `.sr-only` span so a screen reader gets one anyway.
          key: "sel", label: el("span", { class: "sr-only" }, "Select"),
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
        { key: "total", label: "Findings", className: "num", cell: (r) => fmtCount(r.total) },
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
      toast(`Deleted ${result.deleted} scan(s); ${fmtCount(result.tracked)} finding(s) tracked.`);
      ctx && ctx.refresh && ctx.refresh();
    }
  }

  // --------------------------------------------------------------------------- reset

  function renderReset() {
    clear(resetHost);
    const btn = el("button", { class: "danger", onclick: onReset }, "Reset ledger");
    // COMPRESSED TO ITS ONE CONSTRAINT, same reasoning as delete above: what a reset actually
    // wipes moved to the "Reset" heading's own tip, and the confirm dialog repeats the warning.
    resetHost.append(
      el("p", { class: "small muted" }, "This cannot be undone."),
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
      v.note || (v.covers ? `Covers: ${v.covers}.` : "This log's coverage was not stated.")));
    if (!v.errors.length) {
      errorsHost.append(emptyState("No recent failures."));
      return;
    }
    errorsHost.append(dataTable({
      columns: [
        { key: "at", label: "When", cell: (r) => fmtDateTime(r.at) },
        { key: "kind", label: "Kind", cell: (r) => r.kind },
        { key: "scope", label: "Register", cell: (r) => r.scope || absentText },
        { key: "phase", label: "Phase", cell: (r) => r.phase },
        { key: "error", label: "Error", cell: (r) => r.error },
      ],
      rows: v.errors,
      emptyText: "No recent failures.",
    }));
  }
}
