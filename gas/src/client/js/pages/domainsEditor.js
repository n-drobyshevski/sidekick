// Domains editor: priority-ordered list with reorder/edit/delete, an add/edit
// dialog (rules OR-ed, conditions AND-ed) with a live match preview, and a delete
// confirm. Validation happens server-side on save (domain_rules.validate_domains
// parity) and inline for fast feedback.

import { call } from "../api.js";
import { EXPORT_KIND, parseDomainsImport } from "../domainsImport.js";
import { clear, confirmDialog, downloadText, el, toast } from "../ui.js";

export function renderDomainsEditor(host, boot, ctx) {
  let items = JSON.parse(JSON.stringify(boot.settings.domains.items || []));

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
  host.append(listHost, el("div", { style: "display:flex; gap:8px; margin-top:10px" },
    addBtn, exportBtn, importBtn, saveBtn, fileInput));
  renderList();

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
      body: "Findings it claimed fall through to lower-priority domains or Unassigned.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    items.splice(i, 1);
    renderList();
  }

  async function save() {
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
  function openEditor(index) {
    const editing = index !== null ? JSON.parse(JSON.stringify(items[index])) : { name: "", rules: [] };
    if (!editing.rules.length) editing.rules.push({ conditions: [emptyCondition()] });

    const nameInput = el("input", { type: "text", value: editing.name,
      placeholder: "e.g. Payments", "aria-label": "Domain name", style: "width:100%" });
    const rulesHost = el("div", {});
    const previewHost = el("div", { class: "small muted", style: "margin-top:8px", "aria-live": "polite" });

    const dlg = el("dialog", {},
      el("h3", {}, index !== null ? `Edit “${editing.name}”` : "Add domain"),
      el("label", { class: "field-label" }, "Name"),
      nameInput,
      el("p", { class: "small muted", style: "margin:10px 0 4px" },
        "A finding matches the domain when ANY rule matches; a rule matches when ALL its conditions do."),
      rulesHost,
      el("button", { class: "link", onclick: () => {
        editing.rules.push({ conditions: [emptyCondition()] });
        renderRules();
      } }, "+ Add rule"),
      previewHost,
      el("div", { class: "dialog-actions" },
        el("button", { onclick: () => dlg.close() }, "Cancel"),
        el("button", { class: "primary", onclick: commit }, index !== null ? "Apply" : "Add"),
      ),
    );
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    renderRules();
    schedulePreview();

    function emptyCondition() {
      return { type: "tag", key: "", value: "" };
    }

    function renderRules() {
      clear(rulesHost);
      editing.rules.forEach((rule, ri) => {
        const ruleCard = el("div", { class: "card", style: "margin-bottom:8px; padding:10px" });
        ruleCard.append(el("div", { class: "label", style: "margin-bottom:6px" },
          `Rule ${ri + 1}`,
          editing.rules.length > 1
            ? el("button", { class: "link", style: "float:right", onclick: () => {
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
      );
      const fields = el("span", {});
      typeSel.addEventListener("change", () => {
        if (typeSel.value === "tag") Object.assign(cond, { type: "tag", key: "", value: "" });
        else if (typeSel.value === "name_regex") {
          delete cond.key; delete cond.value; delete cond.values;
          Object.assign(cond, { type: "name_regex", pattern: "" });
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
        } else {
          fields.append(input("values", (cond.values || []).join(", "),
            (v) => (cond.values = v.split(",").map((s) => s.trim()).filter(Boolean)),
            "subscriptions, comma-separated"));
        }
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
          ? el("button", { class: "link", onclick: () => {
              rule.conditions.splice(ci, 1);
              renderRules();
              schedulePreview();
            } }, "✕")
          : null,
      );
    }

    let previewTimer;
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
}
