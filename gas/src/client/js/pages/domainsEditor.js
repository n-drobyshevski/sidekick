// Domains editor: priority-ordered list with reorder/edit/delete, an add/edit
// dialog (rules OR-ed, conditions AND-ed) with a live match preview, and a delete
// confirm. Validation happens server-side on save (domain_rules.validate_domains
// parity) and inline for fast feedback.

import { call } from "../api.js";
import { buildPrefillRule } from "../attributionPrefill.js";
import { EXPORT_KIND, parseDomainsImport } from "../domainsImport.js";
import { clear, confirmDialog, downloadText, el, statusPill, toast } from "../ui.js";

export function renderDomainsEditor(host, boot, ctx, hooks = {}) {
  let items = JSON.parse(JSON.stringify(boot.settings.domains.items || []));
  // Snapshot the persisted list so we can show an "unsaved changes" cue and let the parent
  // Settings page warn before a sibling save reboots the page and discards this draft.
  const initialJson = JSON.stringify(boot.settings.domains.items || []);
  const isDirty = () => JSON.stringify(items) !== initialJson;
  // Subscriptions / support groups seen in the current scan, offered by the pickers.
  const knownSubs = (boot.filterOptions && boot.filterOptions.subscriptions) || [];
  const knownGroups = (boot.filterOptions && boot.filterOptions.supportGroups) || [];
  // Case-fold to mirror the rule engine's matching (domainRules.ts `fold`), so the
  // "already claimed" hint agrees with how findings actually get assigned.
  const fold = (s) => String(s).trim().toLowerCase();

  const listHost = el("div", {});
  const addBtn = el("button", { onclick: () => openEditor(null) }, "Add domain");
  const exportBtn = el("button", { onclick: exportJson }, "Export JSON");
  const fileInput = el("input", {
    type: "file", accept: "application/json", style: "display:none",
    "aria-hidden": "true", tabindex: "-1",
  });
  fileInput.addEventListener("change", importJson);
  const importBtn = el("button", { onclick: () => fileInput.click() }, "Import JSON");
  const saveBtn = el("button", { class: "primary", onclick: save }, "Save domains");
  const dirtyHost = el("span", { style: "display:inline-flex; align-items:center; margin-left:2px" });
  host.append(listHost, el("div",
    { style: "display:flex; gap:8px; margin-top:10px; align-items:center" },
    addBtn, exportBtn, importBtn, saveBtn, dirtyHost, fileInput));
  renderList();

  function refreshDirty() {
    clear(dirtyHost);
    if (isDirty()) dirtyHost.append(statusPill("warn", "Unsaved changes"));
  }

  function exportJson() {
    // Snapshots the list as currently edited (not necessarily saved) — same
    // {kind, items} shape the Streamlit dashboard exports and imports.
    downloadText(
      "wiz_domains.json",
      JSON.stringify({ kind: EXPORT_KIND, items }, null, 2),
      "application/json",
    );
  }

  async function importJson() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ""; // re-selecting the same file must re-fire change
    if (!file) return;
    const res = parseDomainsImport(await file.text());
    if (res.error) {
      toast(res.error, "warn");
      return;
    }
    const ok = await confirmDialog({
      title: "Replace all domains?",
      body: `Import ${res.items.length} domain(s), replacing the current list of ` +
        `${items.length}. Nothing is stored until you press Save domains.`,
      confirmLabel: "Replace",
      danger: true,
    });
    if (!ok) return;
    items = res.items;
    renderList();
    toast(`Imported ${res.items.length} domain(s) — press Save domains to persist.`);
  }

  function renderList() {
    clear(listHost);
    refreshDirty();
    if (!items.length) {
      listHost.append(el("p", { class: "muted small" },
        "No domains defined — every finding shows as Unassigned."));
      return;
    }
    items.forEach((item, i) => {
      const ruleCount = (item.rules || []).length;
      listHost.append(
        el("div", { class: "domain-row" },
          el("span", { class: "muted small num" }, `${i + 1}.`),
          el("div", { class: "grow" },
            el("strong", {}, item.name),
            el("span", { class: "muted small", style: "margin-left:8px" },
              `${ruleCount} rule(s)`)),
          el("button", { onclick: () => move(i, -1), disabled: i === 0,
            "aria-label": `Move ${item.name} up` }, "↑"),
          el("button", { onclick: () => move(i, 1), disabled: i === items.length - 1,
            "aria-label": `Move ${item.name} down` }, "↓"),
          el("button", { onclick: () => openEditor(i) }, "Edit"),
          el("button", { class: "danger", onclick: () => remove(i) }, "Delete"),
        ),
      );
    });
  }

  function move(i, delta) {
    const j = i + delta;
    [items[i], items[j]] = [items[j], items[i]];
    renderList();
  }

  async function remove(i) {
    const ok = await confirmDialog({
      title: `Delete domain “${items[i].name}”?`,
      body: "Findings it claimed fall through to lower-priority domains or Unassigned. " +
        "Not saved until you press Save domains.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    items.splice(i, 1);
    renderList();
  }

  async function save() {
    // Saving domains reloads the page too, so warn about any sibling unsaved edits first.
    if (hooks.guardOtherDrafts && !(await hooks.guardOtherDrafts())) return;
    saveBtn.disabled = true;
    try {
      const res = await call("api_saveDomains", { items });
      if (!res.saved) {
        toast(res.errors[0] || "Validation failed.", "warn");
        return;
      }
      toast("Domains saved.");
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ------------------------------------------------------------ add/edit dialog
  // `prefill` ({ resource }), when given, seeds a rule built from an Attribution-page
  // resource (attributionPrefill.js buildPrefillRule): for a new domain it replaces the
  // usual blank starter rule; for an existing domain it's appended alongside whatever
  // rules the domain already has. Nothing is saved until the normal Save/Apply flow.
  function openEditor(index, prefill) {
    const editing = index !== null ? JSON.parse(JSON.stringify(items[index])) : { name: "", rules: [] };
    const prefillRule = prefill ? buildPrefillRule(prefill.resource) : null;
    if (index === null && prefillRule) {
      editing.rules = [prefillRule];
    } else {
      if (!editing.rules.length) editing.rules.push({ conditions: [emptyCondition()] });
      if (index !== null && prefillRule) editing.rules.push(prefillRule);
    }

    const nameInput = el("input", { type: "text", value: editing.name,
      placeholder: "e.g. Payments", "aria-label": "Domain name", style: "width:100%" });
    const rulesHost = el("div", {});
    const previewHost = el("div", { class: "small muted", style: "margin-top:8px", "aria-live": "polite" });

    // Header + actions stay pinned while the rules/preview region scrolls, so a domain with
    // several rules never pushes Apply/Cancel off-screen.
    const dlg = el("dialog", { class: "domains-dialog" },
      el("h3", {}, index !== null ? `Edit “${editing.name}”` : "Add domain"),
      el("div", { class: "dialog-scroll" },
        el("label", { class: "field-label" }, "Name"),
        nameInput,
        prefill ? prefillContextLine(prefill.resource) : null,
        el("p", { class: "small muted", style: "margin:10px 0 4px" },
          "A finding matches the domain when ANY rule matches; a rule matches when ALL its conditions do."),
        rulesHost,
        el("button", { class: "link", onclick: () => {
          editing.rules.push({ conditions: [emptyCondition()] });
          renderRules();
        } }, "+ Add rule"),
        previewHost,
      ),
      el("div", { class: "dialog-actions" },
        el("button", { onclick: () => dlg.close() }, "Cancel"),
        el("button", { class: "primary", onclick: commit }, index !== null ? "Apply" : "Add"),
      ),
    );
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    // Declared before the first schedulePreview() call below — schedulePreview is a
    // hoisted function but previewTimer is a let, so an early call would hit its TDZ.
    let previewTimer;
    renderRules();
    schedulePreview();

    function emptyCondition() {
      return { type: "tag", key: "", value: "" };
    }

    // Muted context line inside the dialog when opened from Attribution's "Attribute…"
    // handoff, naming the resource the seeded rule came from. Built from el() text-node
    // children only (no HTML), so nothing needs manual escaping.
    function prefillContextLine(resource) {
      const r = resource || {};
      const bits = [];
      if (r.subscription) bits.push(`subscription ${r.subscription}`);
      if (r.supportGroup) bits.push(`support group ${r.supportGroup}`);
      return el("p", { class: "small muted", style: "margin:6px 0 4px" },
        `Attributing: ${r.asset || "(unnamed asset)"}`,
        bits.length ? ` — ${bits.join(", ")}` : "");
    }

    // Map folded value -> name of the domain that already claims it (for one condition
    // type: "subscription" or "support_group"), scanning every OTHER domain (the one
    // being edited never blocks itself). The first (highest-priority) claimant wins,
    // matching first-match-wins assignment.
    function claimedValues(condType) {
      const map = new Map();
      items.forEach((dom, di) => {
        if (di === index) return;
        (dom.rules || []).forEach((rule) => {
          (rule.conditions || []).forEach((c) => {
            if (c.type !== condType) return;
            (c.values || []).forEach((v) => {
              const key = fold(v);
              if (key && !map.has(key)) map.set(key, dom.name);
            });
          });
        });
      });
      return map;
    }

    function renderRules() {
      clear(rulesHost);
      editing.rules.forEach((rule, ri) => {
        const ruleCard = el("div", { class: "card", style: "margin-bottom:8px; padding:10px" });
        ruleCard.append(el("div", { class: "label", style: "margin-bottom:6px" },
          `Rule ${ri + 1}`,
          editing.rules.length > 1
            ? el("button", { class: "link", style: "float:right",
                "aria-label": `Remove rule ${ri + 1}`, onclick: () => {
                editing.rules.splice(ri, 1);
                renderRules();
                schedulePreview();
              } }, "remove")
            : null,
        ));
        (rule.conditions || []).forEach((cond, ci) => {
          ruleCard.append(conditionRow(rule, cond, ci));
        });
        ruleCard.append(el("button", { class: "link", onclick: () => {
          rule.conditions.push(emptyCondition());
          renderRules();
        } }, "+ AND condition"));
        rulesHost.append(ruleCard);
      });
    }

    function conditionRow(rule, cond, ci) {
      const typeSel = el("select", { "aria-label": "Condition type" },
        el("option", { value: "tag", selected: cond.type === "tag" || null }, "Tag equals"),
        el("option", { value: "name_regex", selected: cond.type === "name_regex" || null }, "Asset name regex"),
        el("option", { value: "subscription", selected: cond.type === "subscription" || null }, "Subscription in"),
        el("option", { value: "support_group", selected: cond.type === "support_group" || null }, "Support group in"),
      );
      const fields = el("span", {});
      typeSel.addEventListener("change", () => {
        if (typeSel.value === "tag") Object.assign(cond, { type: "tag", key: "", value: "" });
        else if (typeSel.value === "name_regex") {
          delete cond.key; delete cond.value; delete cond.values;
          Object.assign(cond, { type: "name_regex", pattern: "" });
        } else if (typeSel.value === "support_group") {
          delete cond.key; delete cond.value; delete cond.pattern;
          Object.assign(cond, { type: "support_group", values: [] });
        } else {
          delete cond.key; delete cond.value; delete cond.pattern;
          Object.assign(cond, { type: "subscription", values: [] });
        }
        renderFields();
        schedulePreview();
      });
      renderFields();

      function renderFields() {
        clear(fields);
        if (cond.type === "tag") {
          fields.append(
            input("key", cond.key ?? "", (v) => (cond.key = v), "tag key (exact)"),
            input("value", cond.value ?? "", (v) => (cond.value = v === "" ? null : v),
              "value (empty = any)"),
          );
        } else if (cond.type === "name_regex") {
          fields.append(input("pattern", cond.pattern ?? "", (v) => (cond.pattern = v),
            "regex, case-insensitive"));
        } else if (cond.type === "support_group") {
          fields.append(valuePicker(cond, knownGroups, {
            condType: "support_group", label: "Support groups",
            addPlaceholder: "add support group…",
            addAria: "Add a support group not in the scan",
            emptyText: "No support groups in the current scan — add one below.",
          }));
        } else {
          fields.append(valuePicker(cond, knownSubs, {
            condType: "subscription", label: "Subscriptions",
            addPlaceholder: "add subscription…",
            addAria: "Add a subscription not in the scan",
            emptyText: "No subscriptions in the current scan — add one below.",
          }));
        }
      }

      // A checkbox picker over the scan's known values (subscriptions or support groups)
      // plus any already-stored value. Values claimed by another domain are grayed out and
      // labelled; selectable ones sort first. A free-text "add" row keeps values outside
      // the scan usable. `opts.condType` scopes the cross-domain "already claimed" hint.
      function valuePicker(cond, knownValues, opts) {
        if (!Array.isArray(cond.values)) cond.values = [];
        const claimed = claimedValues(opts.condType);
        const wrap = el("div", { style: "flex:1; min-width:220px" });
        const listHost = el("div", { class: "sub-picker", role: "group",
          "aria-label": opts.label });

        const isSelected = (name) => cond.values.some((v) => fold(v) === fold(name));

        function draw() {
          clear(listHost);
          // Options = scan values ∪ any stored value not in that list (preserved).
          const choices = knownValues.slice();
          const knownFolded = new Set(knownValues.map(fold));
          cond.values.forEach((v) => {
            if (!knownFolded.has(fold(v))) {
              choices.push(v);
              knownFolded.add(fold(v));
            }
          });
          const rows = choices.map((name) => {
            const owner = claimed.get(fold(name));
            const selected = isSelected(name);
            return { name, owner, selected, grayed: !!owner && !selected };
          });
          // Selectable (unattributed or already selected here) first, then grayed; each
          // group alphabetical.
          rows.sort((a, b) =>
            (a.grayed ? 1 : 0) - (b.grayed ? 1 : 0) || a.name.localeCompare(b.name));
          if (!rows.length) {
            listHost.append(el("p", { class: "muted small", style: "margin:2px 0" },
              opts.emptyText));
          }
          rows.forEach((row) => {
            const cb = el("input", { type: "checkbox",
              checked: row.selected ? true : null,
              disabled: row.grayed ? true : null,
              "aria-disabled": row.grayed ? "true" : null });
            cb.addEventListener("change", () => {
              if (cb.checked) {
                if (!isSelected(row.name)) cond.values.push(row.name);
              } else {
                cond.values = cond.values.filter((v) => fold(v) !== fold(row.name));
              }
              schedulePreview();
            });
            listHost.append(el("label", { class: row.grayed ? "claimed" : null,
              title: row.owner ? `Already used by domain “${row.owner}”` : row.name },
              cb,
              el("span", { class: "sub-name" }, row.name),
              row.owner ? el("span", { class: "sub-owner" }, `in ${row.owner}`) : null));
          });
        }

        const addInput = el("input", { type: "text", placeholder: opts.addPlaceholder,
          "aria-label": opts.addAria, style: "flex:1; min-height:30px" });
        const addValue = () => {
          const v = addInput.value.trim();
          if (!v) return;
          if (!isSelected(v)) cond.values.push(v);
          addInput.value = "";
          draw();
          schedulePreview();
        };
        addInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); addValue(); }
        });
        const addBtn = el("button", { class: "link", type: "button", onclick: addValue }, "Add");

        draw();
        wrap.append(listHost, el("div", { class: "sub-add" }, addInput, addBtn));
        return wrap;
      }

      function input(label, value, set, placeholder) {
        const inp = el("input", { type: "text", value, placeholder,
          "aria-label": label, style: "margin-left:6px; min-height:30px" });
        inp.addEventListener("input", () => {
          set(inp.value);
          schedulePreview();
        });
        return inp;
      }

      return el("div", { style: "display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin-bottom:6px" },
        typeSel, fields,
        (rule.conditions.length > 1)
          ? el("button", { class: "link", "aria-label": `Remove condition ${ci + 1}`, onclick: () => {
              rule.conditions.splice(ci, 1);
              renderRules();
              schedulePreview();
            } }, "✕")
          : null,
      );
    }

    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(runPreview, 500);
    }

    async function runPreview() {
      const name = nameInput.value.trim() || "(this domain)";
      previewHost.textContent = "Matching…";
      try {
        // Preview the candidate list with this item swapped in at its priority slot.
        const candidate = JSON.parse(JSON.stringify(items));
        const entry = { name: nameInput.value.trim() || "Preview", rules: editing.rules };
        if (index !== null) candidate[index] = entry;
        else candidate.push(entry);
        const res = await call("api_previewDomains", { items: candidate });
        const mine = res.perDomain[entry.name] || { count: 0, samples: [] };
        previewHost.textContent =
          `${name} matches ${mine.count} of ${res.total} finding(s)` +
          (mine.samples.length ? ` — e.g. ${mine.samples.join(", ")}` : "");
      } catch (e) {
        previewHost.textContent = `Preview unavailable: ${e.message}`;
      }
    }

    function commit() {
      const name = nameInput.value.trim();
      if (!name) {
        toast("A domain needs a name.", "warn");
        return;
      }
      const entry = { name, rules: editing.rules };
      if (index !== null) items[index] = entry;
      else items.push(entry);
      dlg.close();
      renderList();
    }
  }

  // Entry point for the Attribution page's "Attribute…" handoff (settings.js calls this
  // after recovering the prefill resource). With no existing domains there's nothing to
  // choose between, so skip straight to a new domain; otherwise offer a small chooser
  // between the existing domains (in priority order) and starting a new one. Either way
  // nothing persists until the analyst presses the normal "Save domains".
  function openWithPrefill(resource) {
    if (!items.length) {
      openEditor(null, { resource });
      return;
    }
    const NEW_DOMAIN = "__new__";
    const select = el("select", { "aria-label": "Domain to add a rule to" },
      ...items.map((item, i) => el("option", { value: String(i) }, item.name)),
      el("option", { value: NEW_DOMAIN }, "New domain…"),
    );
    const dlg = el("dialog", { class: "domains-dialog" },
      el("h3", {}, `Attribute ${(resource && resource.asset) || "resource"}`),
      el("div", { class: "dialog-scroll" },
        el("p", { class: "small muted" },
          "Add a rule for this resource to an existing domain, or start a new one."),
        el("label", { class: "field-label" }, "Domain"),
        select,
      ),
      el("div", { class: "dialog-actions" },
        el("button", { onclick: () => dlg.close() }, "Cancel"),
        el("button", { class: "primary", onclick: () => {
          const chosen = select.value === NEW_DOMAIN ? null : Number(select.value);
          dlg.close();
          openEditor(chosen, { resource });
        } }, "Continue"),
      ),
    );
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
  }

  return { isDirty, openWithPrefill };
}
