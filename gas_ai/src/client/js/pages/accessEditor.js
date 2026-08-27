// Settings → Access: who may open this app, and who may change that list.
//
// THE PANEL IS NOT THE BOUNDARY. Every endpoint behind it re-checks server-side, because
// google.script.run reaches api_saveAccess and api_saveAdmins directly from any allowed
// caller's browser console. What this file decides is only what to DRAW — and drawing nothing
// is the common case, because the roster is not offered to people who cannot edit it.
//
// Two tiers, and the difference between them is the whole point: the owner may promote admins,
// an admin may only add and remove ordinary people. See src/server/access.ts for why the tier
// stops there rather than letting admins make admins.

import { call } from "../api.js";
import { clear, confirmDialog, el, settingsPanel, statusPill, toast } from "../ui.js";

/**
 * The Access card, or **null** when the caller may not edit it — settings.js appends only
 * what it is given, so a non-editor gets no section at all rather than a disabled one.
 */
export async function renderAccessPanel() {
  // Never let this panel take the Settings page down with it. It is one section among several,
  // and it is the only one whose absence is already a normal outcome — so a failure here
  // renders nothing, exactly as a non-editor does, rather than replacing graph defaults,
  // credential status and the 5Rs scope with "Couldn't load settings."
  let info;
  try {
    info = await call("api_getAccess");
  } catch (e) {
    console.warn("[access] panel unavailable:", e);
    return null;
  }
  if (!info || !info.canEditUsers) return null;

  // The owner is admitted by identity, never by membership, so their row has no remove button.
  // Saying why turns a missing control into a stated rule.
  const owner = String(info.owner || "").toLowerCase();
  const domain = String(info.domain || "");
  let users = (info.users || []).filter((e) => e !== owner);
  let admins = (info.admins || []).slice();
  const savedUsers = users.join(",");
  const savedAdmins = admins.join(",");

  const usersHost = el("div", { class: "access-list" });
  const adminsHost = el("div", { class: "access-list" });
  const dirtyHost = el("span", {});

  const dirty = () => users.join(",") !== savedUsers || admins.join(",") !== savedAdmins;
  function refreshDirty() {
    clear(dirtyHost);
    if (dirty()) dirtyHost.append(statusPill("warn", "Unsaved changes"));
  }

  /** An address outside the owner's domain can never match — see the note in access.ts. */
  const outsideDomain = (email) => domain && email.slice(email.lastIndexOf("@") + 1) !== domain;

  function personRow(email, onRemove) {
    return el("div", { class: "access-row" },
      el("span", { class: "access-row__email" }, email),
      outsideDomain(email)
        ? statusPill("warn", "outside " + domain)
        : null,
      onRemove
        ? el("button", { class: "access-remove", type: "button", title: "Remove " + email,
            "aria-label": "Remove " + email, onclick: onRemove }, "✕")
        : null);
  }

  function drawUsers() {
    clear(usersHost);
    usersHost.append(
      el("div", { class: "access-row access-row--locked" },
        el("span", { class: "access-row__email" }, owner),
        el("span", { class: "small", style: "color:var(--text-3)" }, "Owner · always has access")));
    if (!users.length) {
      usersHost.append(el("p", { class: "small", style: "color:var(--text-3)" },
        "Nobody else yet — only the owner can open the app."));
    }
    users.forEach((email, i) => {
      usersHost.append(personRow(email, () => {
        users.splice(i, 1);
        drawUsers();
        refreshDirty();
      }));
    });
    usersHost.append(addRow("Add someone by email", (v) => {
      if (users.indexOf(v) < 0 && v !== owner) users.push(v);
      drawUsers();
      refreshDirty();
    }));
  }

  function drawAdmins() {
    clear(adminsHost);
    if (!admins.length) {
      adminsHost.append(el("p", { class: "small", style: "color:var(--text-3)" },
        "No admins — only the owner."));
    }
    admins.forEach((email, i) => {
      adminsHost.append(personRow(email, info.canEditAdmins ? () => {
        admins.splice(i, 1);
        drawAdmins();
        refreshDirty();
      } : null));
    });
    if (info.canEditAdmins) {
      adminsHost.append(addRow("Add an admin by email", (v) => {
        if (admins.indexOf(v) < 0) admins.push(v);
        drawAdmins();
        refreshDirty();
      }));
    }
  }

  function addRow(placeholder, add) {
    const input = el("input", { type: "text", placeholder, "aria-label": placeholder,
      style: "flex:1; min-height:30px" });
    const commit = () => {
      const v = input.value.trim().toLowerCase();
      if (!v) return;
      // Matches the server's rule, so the same edit is not accepted here and refused there.
      if (v.indexOf("@") < 0) { toast("That doesn't look like an email address.", "error"); return; }
      input.value = "";
      add(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });
    return el("div", { class: "access-add" }, input,
      el("button", { class: "link", type: "button", onclick: commit }, "Add"));
  }

  async function save() {
    // Removals get a confirmation naming names: adding someone is recoverable by removing
    // them, but removing someone locks them out on their very next request.
    const goneUsers = (info.users || []).filter((e) => e !== owner && users.indexOf(e) < 0);
    const goneAdmins = (info.admins || []).filter((e) => admins.indexOf(e) < 0);
    const gone = goneUsers.concat(goneAdmins);
    if (gone.length) {
      const ok = await confirmDialog({
        title: gone.length === 1 ? "Remove one person?" : "Remove " + gone.length + " people?",
        body: gone.join(", ") + " will lose access on their next request.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      if (users.join(",") !== savedUsers) await call("api_saveAccess", { users: users.join(", ") });
      // Only sent when the owner actually changed it — an admin's panel never reaches here,
      // and sending an unchanged list would earn a refusal for a no-op.
      if (info.canEditAdmins && admins.join(",") !== savedAdmins) {
        await call("api_saveAdmins", { admins: admins.join(", ") });
      }
      toast("Access updated.", "success");
      const fresh = await call("api_getAccess");
      users = (fresh.users || []).filter((e) => e !== owner);
      admins = (fresh.admins || []).slice();
      drawUsers();
      drawAdmins();
      refreshDirty();
    } catch (e) {
      toast(String((e && e.message) || e), "error");
    }
  }

  drawUsers();
  drawAdmins();

  // A settingsPanel() now that there is one — the note this used to carry, that the app had no
  // such helper and inventing one for a single caller would be the larger change, is answered:
  // ui/settings.js has it and the whole Settings page is built from it.
  //
  // The Save button stays. This roster writes Script Properties through its own endpoints and
  // its own validation, so it is a second FORM rather than a knob the page's save bar withheld —
  // which is exactly the split the page header describes.
  return settingsPanel({
    title: "Access",
    description: "Who can open this dashboard. Everyone here must be signed in to "
      + (domain ? domain : "this Workspace domain")
      + " — Google accounts outside it can't be recognised and are always refused.",
    body: [
      el("div", { class: "access-block" },
        el("span", { class: "access-block__label" }, "People"),
        usersHost),
      el("div", { class: "access-block access-block--divided" },
        el("span", { class: "access-block__label" }, "Admins"),
        el("p", { class: "small access-block__note" },
          info.canEditAdmins
            ? "Admins can add and remove people. Only you, as the owner, can change who is an "
              + "admin — so an admin can't promote anyone, including themselves."
            : "You can add and remove people. Only the owner can change who is an admin."),
        adminsHost),
    ],
    footer: [el("button", { class: "primary", onclick: save }, "Save access"), dirtyHost],
  });
}
