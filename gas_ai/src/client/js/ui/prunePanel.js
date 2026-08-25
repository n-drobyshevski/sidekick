// The Data page's prune control: keep one project's subtree, delete the rest of the register.
//
// The register holds whatever the last sync was scoped to fetch. A register synced before
// WIZ_PROJECT_ID_V2 was set holds every project the tenant returned, and re-fetching only the
// wanted slice costs hours of Wiz calls, so this subtracts instead, in place.
//
// Split in two the way projectScope.js is: `prunePanelView` decides what the panel CLAIMS —
// which project is the default, how the census reads, whether removing is offered at all —
// and is DOM-free so those claims can be tested. `prunePanel` only assembles them.
//
// The shape of the interaction is preview-then-commit, and the preview is not optional. This
// deletes tens of thousands of rows irreversibly, and the difference between a business unit
// and one leaf project inside it is orders of magnitude of register: a difference visible in
// the census and in nothing else an operator can see beforehand.

import { el } from "./dom.js";
import { dataTable } from "./data.js";
import { filterCombobox } from "./combobox.js";
import { scopeOptions } from "./projectScope.js";
import { pluralize } from "./format.js";
import { confirmDialog, skeletonStack, toast } from "./feedback.js";
import { statusPill } from "./controls.js";

const nf = new Intl.NumberFormat();

/**
 * What the app calls each tab everywhere else, and the order to read them in.
 *
 * Assets first because it is the population every other row hangs off, then its edges, then
 * the three finding registers. The server sends the tabs in WRITE order (children first, so
 * an interrupted prune fails safe), which is the right order to write and the wrong one to
 * read. A tab this list does not know falls through to its raw name rather than being
 * dropped: a census that silently omitted a table would understate what is about to go.
 */
const TAB_LABELS = [
  ["ai_assets", "Assets"],
  ["ai_edges", "Edges"],
  ["ai_issues", "Issues"],
  ["ai_findings", "Config findings"],
  ["ai_data_findings", "Data findings"],
  ["ai_identity_findings", "Identity findings"],
];

function count(n, word) {
  return nf.format(n) + " " + pluralize(n, word);
}

function censusRows(tabs) {
  const order = TAB_LABELS.map((t) => t[0]);
  const known = tabs.filter((t) => order.includes(t.tab))
    .sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab));
  const unknown = tabs.filter((t) => !order.includes(t.tab));
  return [...known, ...unknown].map((t) => {
    const pair = TAB_LABELS.find((l) => l[0] === t.tab);
    return {
      label: pair ? pair[1] : t.tab,
      before: t.before,
      after: t.after,
      removed: Math.max(0, t.before - t.after),
    };
  });
}

/**
 * The sentence about assets Wiz attributed to no project at all.
 *
 * Only written when there are any. These are the identity rows the access traversal collected
 * and any inventory the tenant left unattributed, and they are the one bucket whose fate an
 * operator might want to stop and think about, so the panel states both halves of the split
 * rather than folding them into the total and letting the reader assume.
 */
function attributionLine(census) {
  if (!census.attached && !census.droppedOrphan) return null;
  if (!census.droppedOrphan) {
    return count(census.attached, "unattributed asset") +
      " kept, because an edge reaches an asset in this project.";
  }
  if (!census.attached) {
    return count(census.droppedOrphan, "unattributed asset") +
      " dropped, because nothing kept reaches them.";
  }
  return count(census.attached, "unattributed asset") +
    " kept, because an edge reaches an asset in this project; " +
    nf.format(census.droppedOrphan) + " dropped, because nothing kept does.";
}

/**
 * Everything the panel asserts, from the bootstrap payload and the last preview.
 *
 * @param {object|null} bootstrapData
 * @param {object|null} preview  the previewPrune payload, or null before one has run
 */
export function prunePanelView(bootstrapData, preview) {
  const list = (bootstrapData && bootstrapData.filterOptions
    && bootstrapData.filterOptions.projectList) || [];
  const scope = (bootstrapData && bootstrapData.scope) || null;

  if (!scope || !list.length) {
    return {
      show: false, options: [], defaultId: "", syncScopeNote: null,
      census: null, attribution: null, status: null, canRemove: false, removeLabel: "",
    };
  }

  const syncScopeId = scope.syncProjectId || "";
  const held = list.some((p) => p.id === syncScopeId);

  // Named in words on the option itself, never by colour or position alone.
  const options = scopeOptions(list).map((o) => (
    o.value === syncScopeId ? { ...o, hint: o.hint + " · sync scope" } : o
  ));

  // The sync scope is only offered as the default when the register actually holds it.
  // Defaulting to a project with no rows would arm the control on a pick whose census reads
  // zero everywhere, and a zero meaning "already clean" and a zero meaning "never fetched"
  // look identical on screen and call for opposite reactions.
  const syncScopeNote = held ? null
    : syncScopeId
      ? "The sync is scoped to a project this register does not hold, so there is no default."
      : "The sync is not scoped to a project, so there is no default. Pick what to keep.";

  const census = preview ? {
    rows: censusRows(preview.tabs),
    cellsBefore: preview.cellsBefore,
    cellsAfter: preview.cellsAfter,
    // Only claimed when it is going to move. Reclaiming the grid leaves each tab a buffer of
    // spare rows (sheetsDb.TRIM_BUFFER_ROWS), so on a register smaller than that buffer the
    // figure genuinely does not change — and "40,300 to 40,300" is a sentence that costs a
    // line and says nothing. The row counts above it are the measure either way.
    cellsFreed: Math.max(0, preview.cellsBefore - preview.cellsAfter),
    keep: preview.census.keep,
    total: preview.census.total,
    removed: preview.census.total - preview.census.keep,
    name: preview.name || preview.projectId,
  } : null;

  let status = null;
  if (census && census.keep <= 0) {
    // The server refuses this before it can be returned. Kept as a visible arm anyway: a
    // panel that can only render the outcomes it expects turns a surprise into a blank card.
    status = {
      kind: "bad",
      label: "Would empty the register",
      text: "No asset here belongs to that project. Use Reset synced data if clearing the " +
        "register is what you want.",
    };
  } else if (census && census.removed <= 0) {
    status = {
      kind: "ok",
      label: "Nothing to remove",
      text: "Every asset in this register already belongs to " + census.name + ".",
    };
  }

  return {
    show: true,
    options,
    defaultId: held ? syncScopeId : "",
    syncScopeNote,
    census,
    attribution: preview ? attributionLine(preview.census) : null,
    status,
    canRemove: Boolean(census) && census.removed > 0 && census.keep > 0,
    removeLabel: census ? "Remove " + count(census.removed, "asset") : "Remove",
  };
}

function censusTable(census) {
  return dataTable({
    panel: true,
    className: "prune-census",
    columns: [
      { key: "label", label: "Table", cell: (r) => r.label },
      { key: "before", label: "Rows now", className: "num", cell: (r) => nf.format(r.before) },
      { key: "after", label: "After", className: "num", cell: (r) => nf.format(r.after) },
      {
        key: "removed", label: "Removed", className: "num",
        cell: (r) => (r.removed ? "-" + nf.format(r.removed) : "0"),
      },
    ],
    rows: census.rows,
  });
}

/**
 * @param {object|null} bootstrapData
 * @param {{refresh: () => void, call: (name: string, params: object) => Promise<any>}} ctx
 * @returns {HTMLElement}
 */
export function prunePanel(bootstrapData, ctx) {
  const head = [
    el("strong", {}, "Remove data outside a project"),
    el("div", { class: "small muted prune-note" },
      "Keeps the assets under the project you pick and the edges, issues and findings " +
      "attached to them. Everything else is deleted. Settings, sync history and the rule " +
      "catalogue are kept, so the trend goes on showing what each sync really collected. " +
      "Preview the change first."),
  ];

  const first = prunePanelView(bootstrapData, null);
  if (!first.show) {
    return el("div", { class: "card prune-card" }, ...head,
      el("div", { class: "small muted prune-note" },
        "No project has been synced into this register yet, so there is nothing to prune to."));
  }

  let projectId = first.defaultId;
  let preview = null;
  let error = null;
  let busy = "";

  const body = el("div", { class: "prune-body", "aria-live": "polite" });
  const actions = el("div", { class: "prune-actions" });

  const combo = filterCombobox({
    value: projectId,
    options: first.options,
    defaultLabel: "Pick a project to keep",
    // Without this the trigger prints the raw id, which reads as corruption rather than as a
    // pick this register cannot honour.
    fallbackLabel: "Project not in this register",
    ariaLabel: "Project to keep",
    searchPlaceholder: "Search projects…",
    onChange: (id) => {
      projectId = id || "";
      // A census describes one project. Leaving the previous one on screen beside a new pick
      // would arm the Remove button with numbers that no longer say what it does.
      preview = null;
      error = null;
      paint();
    },
  });
  combo.classList.add("prune-combo");

  const previewBtn = el("button", {
    onclick: async () => {
      // Never disabled for want of a project, only while a call is in flight. A disabled
      // control cannot explain itself, and it leaves the keyboard tab order stepping from the
      // picker straight past Preview to the Reset card below — so the one button that has to
      // be pressed before anything is deleted is the one a keyboard user never meets. Pressing
      // it empty says what is missing and puts the caret on it, which is what the scan-vars
      // editor does with an invalid Save for the same reason.
      if (!projectId) {
        toast("Pick a project to keep first.", "warn");
        combo.querySelector("button, input").focus();
        return;
      }
      busy = "preview";
      error = null;
      paint();
      try {
        preview = await ctx.call("api_previewPrune", { projectId });
      } catch (e) {
        preview = null;
        error = String((e && e.message) || e);
      }
      busy = "";
      paint();
    },
  }, "Preview");

  function runRemoval(census) {
    return async () => {
      const ok = await confirmDialog({
        title: "Remove data outside " + census.name + "?",
        body: el("div", {},
          el("p", { class: "muted" },
            "This deletes " + count(census.removed, "asset") + " and every edge, issue and " +
            "finding attached to them. " + count(census.keep, "asset") + " are kept. It " +
            "cannot be undone, and the next sync refetches only what it is scoped to."),
          censusTable(census)),
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      busy = "remove";
      paint();
      try {
        const res = await ctx.call("api_pruneToProject", { projectId });
        toast(res.message || "Data removed.");
        ctx.refresh();
      } catch (e) {
        busy = "";
        paint();
        toast(String((e && e.message) || e), "error");
      }
    };
  }

  function paint() {
    const v = prunePanelView(bootstrapData, preview);
    body.replaceChildren();
    actions.replaceChildren();

    previewBtn.disabled = busy !== "";
    previewBtn.textContent = busy === "preview" ? "Checking…" : "Preview";
    for (const node of combo.querySelectorAll("button, input")) node.disabled = busy !== "";

    if (busy === "preview") {
      body.append(el("div", { role: "status", "aria-label": "Checking what would be removed" },
        skeletonStack(4, { height: "18px" })));
      return;
    }
    if (error) {
      body.append(el("div", { class: "prune-error", role: "alert" }, error));
      return;
    }
    if (v.status) {
      body.append(el("div", { class: "prune-status" },
        statusPill(v.status.kind, v.status.label),
        el("span", { class: "small muted" }, v.status.text)));
    }
    if (v.census) {
      const notes = [];
      if (v.census.cellsFreed) {
        notes.push("Spreadsheet cells " + nf.format(v.census.cellsBefore) + " to " +
          nf.format(v.census.cellsAfter) + ", once the empty rows are reclaimed.");
      }
      if (v.attribution) notes.push(v.attribution);
      // Appended one at a time rather than spread into a single call: `Node.append` renders a
      // null child as the text "null", where el()'s own child handling drops it.
      body.append(censusTable(v.census));
      for (const note of notes) {
        body.append(el("div", { class: "small muted prune-note" }, note));
      }
    }
    if (v.canRemove) {
      actions.append(el("button", {
        class: "danger",
        disabled: busy !== "",
        onclick: runRemoval(v.census),
      }, busy === "remove" ? "Removing…" : v.removeLabel));
    }
  }

  const panel = el("div", { class: "card prune-card" },
    ...head,
    first.syncScopeNote
      ? el("div", { class: "small muted prune-note" }, first.syncScopeNote)
      : null,
    el("div", { class: "prune-controls" }, combo, previewBtn),
    body,
    actions,
  );
  paint();
  return panel;
}
