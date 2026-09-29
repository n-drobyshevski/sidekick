// Settings → System → "Support group domains": every support group an admin placed in a domain
// by hand, why, and by whom — and, for an admin, where to add, change or remove one. Ported
// from the OS register's copy (gas/src/client/js/pages/sgDomainsEditor.js); here the admin tier
// is already on the boot payload (`boot.canEditAccess`), so no access round trip.
//
// The same overrides the MTTR row sheet's "Change domain…" writes (`api_saveSupportGroupDomain`,
// admins only, server-checked); this is where they are reviewed together. What an override
// does is `domain/currentDomain.ts`'s third rule: it replaces the host vote for that group, on
// every page. The reasons and markers are `_sgDomains.js`'s.

import { call } from "../../../../../gas_shared/api.js";
import {
  clear, confirmDialog, dataTable, el, settingsPanel, toast,
} from "../ui.js";
import { SG_REASONS, assignableDomains, sgOverrideBadge } from "./_sgDomains.js";

/**
 * The panel. `onSaved` re-reads what the bootstrap carries (every page's figures move with an
 * override). Non-admins see the list read-only.
 */
export function sgDomainsPanel(boot, { onSaved } = {}) {
  let items = ((boot.settings && boot.settings.supportGroupDomains
    && boot.settings.supportGroupDomains.items) || []).slice();
  let canEdit = false;
  const listHost = el("div", {});
  const addHost = el("div", {});

  function paint() {
    clear(listHost).append(dataTable({
      columns: [
        {
          key: "group", label: "Support group",
          help: ["The support group whose domain an admin set."],
          cell: (o) => o.group,
        },
        {
          key: "domain", label: "Counted under",
          help: ["The one domain every finding of this group counts under, on every page, "
            + "whatever its repositories are tagged."],
          cell: (o) => o.domain,
        },
        {
          key: "reason", label: "Why",
          help: ["Managed by CROSS team: the group sits in CROSS on purpose, because the CROSS "
            + "team runs its repositories. Domain set manually: the repositories' tags put it in the wrong "
            + "domain, and this corrects it."],
          cell: (o) => sgOverrideBadge(o),
        },
        {
          key: "note", label: "Note",
          help: ["What the admin who set it wrote down, if anything."],
          cell: (o) => o.note || "",
        },
        {
          key: "by", label: "Set by",
          help: ["Who set it, and on which day."],
          cell: (o) => el("span", { class: "small muted" },
            [o.by, o.at ? String(o.at).slice(0, 10) : ""].filter(Boolean).join(" · ")),
        },
        ...(canEdit ? [{
          key: "remove", label: "",
          cell: (o) => el("button", {
            type: "button", class: "linklike", "aria-label": `Remove the override of ${o.group}`,
            onclick: () => remove(o),
          }, "Remove"),
        }] : []),
      ],
      rows: items,
      emptyText: "No support group has a domain set by hand — each counts under the domain "
        + "most of its current repositories are tagged in.",
    }));
  }

  function paintAdd() {
    clear(addHost);
    if (!canEdit) return;
    const groups = (boot.filterOptions && boot.filterOptions.supportGroups) || [];
    const domains = assignableDomains(boot);
    const group = el("select", { "aria-label": "Support group" },
      el("option", { value: "" }, "Support group…"),
      ...groups.map((g) => el("option", { value: g }, g)));
    const domain = el("select", { "aria-label": "Domain" },
      ...domains.map((d) => el("option", { value: d }, d)));
    const reason = el("select", { "aria-label": "Why" },
      ...Object.entries(SG_REASONS).map(([v, r]) => el("option", { value: v }, r.label)));
    reason.addEventListener("change", () => {
      if (reason.value === "cross_team" && domains.includes("CROSS")) domain.value = "CROSS";
    });
    const note = el("input", { type: "text", "aria-label": "Note (optional)",
      placeholder: "Note (optional)", maxlength: "500" });
    const add = el("button", { type: "button", onclick: () => {
      if (!group.value) { toast("Pick a support group.", "error"); return; }
      save({ group: group.value, domain: domain.value, reason: reason.value, note: note.value },
        `${group.value} now counts under ${domain.value}.`);
    } }, "Set domain");
    addHost.append(el("div", {
      style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px",
    }, group, domain, reason, note, add));
  }

  async function remove(o) {
    const ok = await confirmDialog({
      title: `Reset ${o.group}'s domain`,
      body: `${o.group} goes back to the domain most of its current repositories are tagged in.`,
      confirmLabel: "Reset",
    });
    if (ok) save({ group: o.group, domain: null }, `${o.group} is back on its automatic domain.`);
  }

  async function save(p, done) {
    try {
      const res = await call("api_saveSupportGroupDomain", p);
      if (!res || !res.saved) {
        toast(((res && res.errors) || ["Couldn't save the domain."]).join(" "), "error");
        return;
      }
      items = res.items || [];
      paint();
      paintAdd();
      toast(done);
      if (onSaved) onSaved();
    } catch (e) {
      toast(String((e && e.message) || e), "error");
    }
  }

  // Admins get the controls; the list is the same for everyone. The server re-checks every save.
  canEdit = Boolean(boot.canEditAccess);
  paint();
  paintAdd();

  return settingsPanel({
    title: "Support group domains",
    description: "Each support group counts under ONE domain — the one most of its current "
      + "repositories are tagged in. Set it by hand where that is wrong, or where the CROSS team "
      + "runs the group's repositories. An override applies even before Repository tags are "
      + "refreshed.",
    body: [listHost, addHost],
  });
}
