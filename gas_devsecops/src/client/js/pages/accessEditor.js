// Settings → Access: who may open this app, and who may change that list.
//
// THE PANEL IS NOT THE BOUNDARY. Every endpoint behind it re-checks server-side, because
// `google.script.run` reaches `api_saveAccess` and `api_saveAdmins` directly from any allowed
// caller's browser console. What this file decides is only what to DRAW — and drawing nothing
// is a normal outcome, because the roster is not offered to people who cannot edit it.
//
// Two tiers, and the difference between them is the whole point: the owner may promote
// admins, an admin may only add and remove ordinary people. `src/server/access.ts` records why
// the tier stops there, and `test/accessAdmin.test.ts` fails the moment it is blurred.
//
// The decisions live in accessModel.js, which is DOM-free and tested. This file draws.

import { call } from "../api.js";
import { clear, el } from "../ui.js";
import { confirmDialog, toast } from "../ui/feedback.js";
import { settingsPanel } from "../ui/settings.js";
import { statusPill } from "../ui/controls.js";
import {
  ADD_REJECTION, isAddable, isDirty, outsideDomain, pendingSaves, removals, splitRoster,
} from "./accessModel.js";

/**
 * `{ panel, roster }` — the Access section, and what it is a section ABOUT.
 *
 * `panel` is **null** when the caller may not edit it: settings.js appends only what it is
 * given, so a non-editor gets no section at all rather than a disabled one, matching what the
 * endpoint does (it sends them no roster). `roster` is null in the same case.
 *
 * The roster comes back so the page can put a NUMBER in its hero — `heroStat` exists for one,
 * and "how many people can open this dashboard" is the figure this page is about. Returning it
 * costs nothing; a second `getAccess` from settings.js would have cost a round trip to
 * re-fetch what this function already holds.
 */
export async function renderAccessPanel() {
  // NEVER LET THIS PANEL TAKE THE PAGE DOWN WITH IT. Returning null is already a normal
  // outcome here, so a failure degrades to the same thing rather than replacing the whole
  // Settings page with an error. The sibling records doing exactly that once, over a mistyped
  // RPC name — which is why test/entryPoints.test.js pins those names.
  let info;
  try {
    info = await call("api_getAccess");
  } catch (e) {
    console.warn("[access] panel unavailable:", e);
    return { panel: null, roster: null };
  }
  if (!info || !info.canEditUsers) return { panel: null, roster: null };

  const { owner, domain, users: initialUsers, admins: initialAdmins } = splitRoster(info);
  const state = { users: initialUsers, admins: initialAdmins };
  // The last roster known to be ON DISK. Both the dirty check and the removal confirmation
  // read it, and it MOVES ON EVERY SAVE — see the note on `removals`, which the source gets
  // wrong by comparing against the payload the page loaded with.
  const baseline = { users: state.users.slice(), admins: state.admins.slice() };
  const saved = { users: baseline.users.join(","), admins: baseline.admins.join(",") };

  const usersHost = el("div", { class: "access-list" });
  const adminsHost = el("div", { class: "access-list" });
  const dirtyHost = el("span", {});

  function refreshDirty() {
    clear(dirtyHost);
    if (isDirty(state, saved)) dirtyHost.append(statusPill("warn", "Unsaved changes"));
  }

  function personRow(email, onRemove) {
    return el("div", { class: "access-row" },
      el("span", { class: "access-row__email" }, email),
      outsideDomain(email, domain)
        ? statusPill("warn", `outside ${domain}`,
            `This address is not in ${domain}, so no Google account here can match it — `
            + "adding it grants nothing.")
        : null,
      // `aria-label` and no `title`: el() throws on the title attribute outright (ui/dom.js),
      // because a native tooltip cannot be reached by keyboard and does not exist on touch.
      onRemove
        ? el("button", {
            class: "access-remove", type: "button",
            "aria-label": `Remove ${email}`, onclick: onRemove,
          }, "✕")
        : null);
  }

  function addRow(placeholder, list, add) {
    const input = el("input", { type: "text", placeholder, "aria-label": placeholder });
    const commit = () => {
      const verdict = isAddable(input.value, list(), owner);
      if (!verdict.ok) {
        if (verdict.reason !== "empty") toast(ADD_REJECTION[verdict.reason], "error");
        return;
      }
      input.value = "";
      add(verdict.value);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });
    return el("div", { class: "access-add" }, input,
      el("button", { class: "linklike", type: "button", onclick: commit }, "Add"));
  }

  function drawUsers() {
    clear(usersHost);
    // The owner's row, stated rather than merely missing a button: "always has access" turns
    // an absent control into a rule the reader can see.
    usersHost.append(el("div", { class: "access-row access-row--locked" },
      el("span", { class: "access-row__email" }, owner),
      el("span", { class: "muted small" }, "Owner · always has access")));
    if (!state.users.length) {
      usersHost.append(el("p", { class: "muted small" },
        "Nobody else yet — only the owner can open the app."));
    }
    state.users.forEach((email, i) => {
      usersHost.append(personRow(email, () => {
        state.users.splice(i, 1);
        drawUsers();
        refreshDirty();
      }));
    });
    usersHost.append(addRow("Add someone by email", () => state.users, (v) => {
      state.users.push(v);
      drawUsers();
      refreshDirty();
    }));
  }

  function drawAdmins() {
    clear(adminsHost);
    if (!state.admins.length) {
      adminsHost.append(el("p", { class: "muted small" }, "No admins — only the owner."));
    }
    state.admins.forEach((email, i) => {
      adminsHost.append(personRow(email, info.canEditAdmins ? () => {
        state.admins.splice(i, 1);
        drawAdmins();
        refreshDirty();
      } : null));
    });
    if (info.canEditAdmins) {
      adminsHost.append(addRow("Add an admin by email", () => state.admins, (v) => {
        state.admins.push(v);
        drawAdmins();
        refreshDirty();
      }));
    }
  }

  async function save() {
    // REMOVALS GET A CONFIRMATION NAMING NAMES. Adding someone is recoverable by removing
    // them; removing someone locks them out on their very next request, and a count would be
    // enough for a dialog but not enough for a decision.
    const gone = removals(baseline, state);
    if (gone.length) {
      const ok = await confirmDialog({
        title: gone.length === 1 ? "Remove one person?" : `Remove ${gone.length} people?`,
        body: `${gone.join(", ")} will lose access on their next request.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
    }
    const pending = pendingSaves(state, saved, info.canEditAdmins);
    try {
      if (pending.users) await call("api_saveAccess", { users: state.users.join(", ") });
      if (pending.admins) await call("api_saveAdmins", { admins: state.admins.join(", ") });
      toast("Access updated.", "success");
      // Re-read rather than trusting the local arrays: saveAccess writes the owner back in,
      // so what is on disk is not always what was sent.
      const fresh = await call("api_getAccess");
      const next = splitRoster(fresh);
      state.users = next.users;
      state.admins = next.admins;
      baseline.users = next.users.slice();
      baseline.admins = next.admins.slice();
      saved.users = baseline.users.join(",");
      saved.admins = baseline.admins.join(",");
      drawUsers();
      drawAdmins();
      refreshDirty();
    } catch (e) {
      toast(String((e && e.message) || e), "error");
    }
  }

  drawUsers();
  drawAdmins();

  const panel = settingsPanel({
    title: "Access",
    description:
      "Who can open this dashboard. Everyone here must be signed in to "
      + (domain || "this Workspace domain")
      + " — Google accounts outside it cannot be recognised and are always refused.",
    body: [
      el("div", { class: "access-block" },
        el("span", { class: "access-block__label" }, "People"),
        usersHost),
      el("div", { class: "access-block access-block--divided" },
        el("span", { class: "access-block__label" }, "Admins"),
        el("p", { class: "muted small access-block__note" },
          info.canEditAdmins
            ? "Admins can add and remove people. Only you, as the owner, can change who is an "
              + "admin — so an admin cannot promote anyone, themselves included."
            : "You can add and remove people. Only the owner can change who is an admin."),
        adminsHost),
    ],
    footer: [
      el("button", { class: "primary", type: "button", onclick: save }, "Save access"),
      dirtyHost,
    ],
  });

  // The owner plus everyone on the list — the count the page's hero states. Read off
  // `baseline` rather than `state` so it is what is on disk, not what is staged.
  return { panel, roster: { people: baseline.users.length + 1, admins: baseline.admins.length } };
}
