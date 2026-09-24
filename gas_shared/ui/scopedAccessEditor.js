// Settings → Access → Scoped viewers: people who may open the register but see only their own
// domains / teams, through a reduced read-only shell (a summary and their findings list).
//
// ONE COMPONENT FOR BOTH REGISTERS. gas scopes by domain + support group, gas_devsecops by
// domain + project; the server hands the dimensions over in `catalogue.dims`, so this file
// never names either.
//
// THE PANEL IS NOT THE BOUNDARY, exactly as for the people list above it: `api_saveScoped`
// re-checks owner-or-admin server-side, validates the roster and refuses the owner and the
// admins. What this file adds is the reading aid — what each scope would show, which values no
// longer exist in the data, and a live preview of the viewer's own page — and a Save that is
// disabled for the same reasons the server would refuse.

import { call } from "../api.js";
import { el, clear } from "./dom.js";
import { filterCombobox } from "./combobox.js";
import { confirmDialog, toast } from "./feedback.js";
import { statusPill } from "./controls.js";
import { tip } from "./tip.js";
import { settingsPanel } from "./settings.js";
import { guardUnsaved } from "./accessSave.js";
import {
  draftProblems, foreignDomain, normEmail, rosterChanged, rosterPayload, rowChips, rowReach,
  SCOPE_DIM_LABELS, scopeValues, summaryTiles,
} from "./scopedViewModel.js";

const SEP = "\u001f";

function emptyScope() {
  const s = {};
  for (const key of Object.keys(SCOPE_DIM_LABELS)) s[SCOPE_DIM_LABELS[key].field] = [];
  return s;
}

function cloneRows(rows) {
  return (rows || []).map((r) => {
    const scope = emptyScope();
    for (const [k, v] of Object.entries((r && r.scope) || {})) {
      if (Array.isArray(v)) scope[k] = v.slice();
    }
    return { email: normEmail(r && r.email), scope };
  });
}

/**
 * The picker's rows: every catalogue value under its dimension's heading, with the open count
 * as the hint so a reader choosing between two teams can see which one is the big one.
 */
function pickerOptions(catalogue) {
  const out = [];
  for (const dim of (catalogue && catalogue.dims) || []) {
    for (const o of dim.options || []) {
      out.push({
        value: dim.key + SEP + o.value,
        label: o.label || o.value,
        group: dim.label,
        hint: typeof o.count === "number" ? `${o.count.toLocaleString()} open` : "",
      });
    }
  }
  return out;
}

/**
 * A scope editor: the chips it holds, plus one picker that adds to them. `dims` are the keys
 * this register assigns (["d","g"] / ["d","p"]); a typed value no catalogue carries is allowed,
 * because a domain can be granted before its first finding lands.
 */
function scopeEditor(scope, catalogue, dims, onChange) {
  const chips = el("div", { class: "token-chips", role: "list" });
  const picker = filterCombobox({
    value: "",
    options: pickerOptions(catalogue),
    defaultLabel: "Add a domain or team…",
    ariaLabel: "Add a domain or team to this scope",
    searchPlaceholder: "Search domains and teams…",
    searchThreshold: 0,
    onChange: (v) => {
      picker.setValue("");
      const at = String(v || "").indexOf(SEP);
      if (at < 0) return;
      const dim = v.slice(0, at);
      const value = v.slice(at + SEP.length);
      const meta = SCOPE_DIM_LABELS[dim];
      if (!meta || dims.indexOf(dim) < 0) return;
      const list = scope[meta.field] || (scope[meta.field] = []);
      if (list.indexOf(value) < 0) list.push(value);
      paint();
      onChange();
    },
  });

  function paint() {
    clear(chips);
    const row = { scope };
    const vals = rowChips(row, catalogue);
    if (!vals.length) {
      chips.append(el("span", { class: "token-empty small muted" },
        "No domain or team yet — pick at least one."));
      return;
    }
    for (const c of vals) {
      const meta = SCOPE_DIM_LABELS[c.dim];
      const x = el("button", {
        type: "button", class: "token-x", "aria-label": `Remove ${c.label}`,
        onclick: () => {
          scope[meta.field] = (scope[meta.field] || []).filter((v) => v !== c.value);
          paint();
          onChange();
        },
      }, "✕");
      chips.append(el("span", {
        class: "token" + (c.stale ? " token--stale" : ""), role: "listitem",
      },
      el("span", { class: "token-dim small muted" }, meta.one),
      el("span", {}, c.label),
      c.stale
        ? statusPill("warn", "not in data",
          [`No ${meta.one} called ${c.label} in the current data. Kept, so nobody's access ` +
            "narrows silently — remove it if it was renamed."])
        : null,
      x));
    }
  }
  paint();
  return el("div", { class: "token-list" }, chips, picker);
}

/** The small preview under a row: the viewer's own tiles, fetched on demand. */
function previewBlock(row) {
  const host = el("div", { class: "scoped-preview small", role: "region",
    "aria-label": `Preview of ${row.email}'s summary` });
  host.append(el("span", { class: "muted" }, "Loading their summary…"));
  call("api_getScopeSummary", { viewerScope: row.scope }).then((s) => {
    clear(host);
    const tiles = summaryTiles(s);
    host.append(el("div", { class: "scoped-preview__tiles" },
      ...tiles.map((t) => el("div", { class: "scoped-preview__tile" },
        el("span", { class: "muted" }, t.label),
        el("strong", { class: "num" }, t.value === null || t.value === undefined
          ? "—" : typeof t.value === "number" ? t.value.toLocaleString() : String(t.value))))));
  }).catch((e) => {
    clear(host);
    host.append(el("span", { class: "muted" }, "Preview unavailable: " + ((e && e.message) || e)));
  });
  return host;
}

/**
 * The Scoped viewers block, for the Access panel's body. `info` is `api_getAccess`'s payload
 * (roster in `info.scoped`, picker vocabulary in `info.catalogue`); `dims` the keys this
 * register assigns. `onSaved(fresh)` hands the refreshed getAccess payload back, because a
 * save can move people out of the full-access list the panel above is drawing.
 */
export function scopedAccessSection({ info, dims, onSaved }) {
  const catalogue = info.catalogue || null;
  const owner = normEmail(info.owner);
  const admins = (info.admins || []).map(normEmail);
  let saved = cloneRows(info.scoped);
  let rows = cloneRows(saved);
  let users = (info.users || []).map(normEmail);
  const openPreview = new Set();
  let editing = null; // an email, while its chips are open

  const listHost = el("div", { class: "access-list" });
  const problemsHost = el("div", { class: "scoped-problems small", "aria-live": "polite" });
  const saveBtn = el("button", { class: "primary", type: "button", onclick: save }, "Save scoped viewers");
  const dirtyHost = el("span", {});

  function refresh() {
    const problems = rosterChanged(rows, saved) ? draftProblems(rows, { owner, admins }) : [];
    clear(problemsHost);
    for (const p of problems) problemsHost.append(el("p", { class: "field-error" }, p));
    const dirty = rosterChanged(rows, saved);
    saveBtn.disabled = !dirty || problems.length > 0;
    clear(dirtyHost);
    if (dirty) dirtyHost.append(statusPill("warn", "Unsaved changes"));
  }

  function reachText(row) {
    const r = rowReach(row, catalogue);
    if (r.total === null) return "";
    return `${r.upperBound ? "up to " : ""}${r.total.toLocaleString()} open`;
  }

  function viewerRow(row, i) {
    const chips = rowChips(row, catalogue);
    const stale = chips.some((c) => c.stale);
    const isEditing = editing === row.email;
    const head = el("div", { class: "access-row scoped-row" },
      el("span", { class: "access-row__email" }, row.email),
      foreignDomain(row.email, info.domain) ? statusPill("warn", "outside " + info.domain) : null,
      users.indexOf(row.email) >= 0 ? statusPill("warn", "also has full access") : null,
      isEditing ? null : el("span", { class: "scoped-row__chips" },
        ...chips.map((c) => el("span", { class: "token" + (c.stale ? " token--stale" : "") }, c.label))),
      stale && !isEditing ? statusPill("warn", "not in data") : null,
      el("span", { class: "muted small num" }, reachText(row)),
      el("button", { class: "link", type: "button",
        "aria-expanded": openPreview.has(row.email) ? "true" : "false",
        onclick: () => {
          if (openPreview.has(row.email)) openPreview.delete(row.email);
          else openPreview.add(row.email);
          draw();
        } }, "Preview"),
      el("button", { class: "link", type: "button",
        onclick: () => { editing = isEditing ? null : row.email; draw(); } },
        isEditing ? "Done" : "Edit"),
      tip(el("button", { class: "cond-remove", type: "button", "aria-label": "Remove " + row.email,
        onclick: () => {
          rows.splice(i, 1);
          openPreview.delete(row.email);
          if (editing === row.email) editing = null;
          draw();
        } }, "✕"), ["Remove " + row.email]),
    );
    const out = [head];
    if (isEditing) {
      out.push(el("div", { class: "scoped-row__editor" },
        scopeEditor(row.scope, catalogue, dims, () => { draw(true); })));
    }
    if (openPreview.has(row.email) && scopeValues(row.scope).length) out.push(previewBlock(row));
    return out;
  }

  function addRow() {
    const scope = emptyScope();
    const input = el("input", { type: "text", inputmode: "email", autocomplete: "off",
      placeholder: "Add a viewer by email (name@" + (info.domain || "example.com") + ")",
      "aria-label": "Scoped viewer's email", style: "flex:1; min-height:30px" });
    const note = el("p", { class: "muted small" });
    const commit = () => {
      const email = normEmail(input.value);
      if (!email) return;
      if (email.indexOf("@") < 0) { toast("That doesn't look like an email address.", "error"); return; }
      if (!scopeValues(scope).length) { toast("Pick at least one domain or team first.", "error"); return; }
      const existing = rows.find((r) => r.email === email);
      if (existing) {
        for (const [k, v] of Object.entries(scope)) {
          existing.scope[k] = Array.from(new Set((existing.scope[k] || []).concat(v)));
        }
      } else {
        rows.push({ email, scope });
      }
      draw();
    };
    input.addEventListener("input", () => {
      const email = normEmail(input.value);
      note.textContent = users.indexOf(email) >= 0
        ? "Has full access today. Saving here narrows them to this scope."
        : email === owner || admins.indexOf(email) >= 0
          ? "The owner and admins always have full access and can't be scoped."
          : "";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });
    // EMAIL, THEN SCOPE, THEN ADD — the order the sentence "give <who> access to <what>" is
    // said in, and the button last so it is reached after the one field that is required.
    return el("div", { class: "scoped-add" },
      el("span", { class: "label" }, "Add a viewer"),
      input,
      scopeEditor(scope, catalogue, dims, () => {}),
      note,
      el("div", {}, el("button", { class: "secondary", type: "button", onclick: commit }, "Add to list")));
  }

  // `keepEditor` redraws the rows but not the add form, so a half-typed address survives.
  let addHost = el("div", {});
  function draw(keepEditor) {
    clear(listHost);
    if (!rows.length) {
      listHost.append(el("p", { class: "muted small" }, "No scoped viewers yet."));
    }
    rows.forEach((row, i) => listHost.append(...viewerRow(row, i)));
    if (!keepEditor) {
      const fresh = el("div", {}, addRow());
      addHost.replaceWith(fresh);
      addHost = fresh;
    }
    refresh();
  }

  async function save() {
    const gone = saved.map((r) => r.email).filter((e) => !rows.some((r) => r.email === e));
    const moving = rows.map((r) => r.email).filter((e) => users.indexOf(e) >= 0);
    if (gone.length || moving.length) {
      const lines = [];
      if (gone.length) lines.push(gone.join(", ") + " will lose access on their next request.");
      if (moving.length) lines.push(moving.join(", ") + " will lose full access and see only their scope.");
      const ok = await confirmDialog({
        title: "Change who can see what?",
        body: lines.join(" "),
        confirmLabel: "Save",
        danger: gone.length > 0,
      });
      if (!ok) return;
    }
    saveBtn.disabled = true;
    try {
      await call("api_saveScoped", { scoped: rosterPayload(rows) });
      toast("Access updated — their summary is being prepared.", "success");
      const fresh = await call("api_getAccess");
      saved = cloneRows(fresh.scoped);
      rows = cloneRows(saved);
      users = (fresh.users || []).map(normEmail);
      editing = null;
      draw();
      if (onSaved) onSaved(fresh);
    } catch (e) {
      toast(String((e && e.message) || e), "error");
      refresh();
    }
  }

  // ITS OWN CARD, WITH ITS OWN FOOTER. Inside the Access card its Save sat above that card's
  // "Save access", and two primary buttons in one card read as one form — which they are not:
  // each saves a different list through a different endpoint.
  const block = settingsPanel({
    title: "Scoped viewers",
    description:
      "People who see only their own domains or teams: a summary (MTTR, open and overdue " +
      "findings, trend) and a read-only list of their findings — no settings, scans or other " +
      "domains. Each viewer's page is precomputed, so it opens without loading the whole register.",
    body: [listHost, addHost, problemsHost],
    footer: [saveBtn, dirtyHost],
  });
  draw();
  // For the panel's OTHER save: granting full access un-scopes people server-side, so the
  // panel hands the fresh payload back here rather than leaving a stale roster to re-save.
  block.sync = (fresh) => {
    saved = cloneRows(fresh.scoped);
    rows = cloneRows(saved);
    users = (fresh.users || []).map(normEmail);
    editing = null;
    draw();
  };
  // A reload with unsaved roster edits asks first, like the people/admins card beside it.
  guardUnsaved(block, () => rosterChanged(rows, saved));
  return block;
}
