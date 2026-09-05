// What the Access panel decides, separated from how it draws.
//
// DOM-free, so the rules below are tested in node — the same split registerModel.js uses, and
// worth having twice over here because this panel is a PRIVILEGE SURFACE. Whoever passes its
// checks can grant other people access to the register.
//
// NONE OF THIS IS THE BOUNDARY. Every rule here is a drawing decision; the server re-checks
// each one, because `google.script.run` reaches `api_saveAccess` and `api_saveAdmins` directly
// from any allowed caller's browser console. `test/accessAdmin.test.ts` holds that side. What
// this file prevents is a panel that offers a control the server will refuse — an edit that
// looks accepted and is not.

/**
 * The owner is admitted by IDENTITY, never by membership, so their row can never be removed.
 *
 * Deleting them from the list changes nothing about their access and everything about what
 * the list appears to say, so the panel does not offer the control at all rather than
 * offering one that silently no-ops.
 */
export function isOwnerRow(email, owner) {
  return String(email ?? "").toLowerCase() === String(owner ?? "").toLowerCase();
}

/**
 * An address outside the owner's Workspace domain can never match a Google account here, so
 * adding it grants nothing.
 *
 * Flagged rather than refused: the server accepts it, and a domain this app cannot see could
 * in principle be a legitimate future one. What the panel owes the reader is that the entry
 * they just added will not do what they think — not a decision made on their behalf.
 */
export function outsideDomain(email, domain) {
  if (!domain) return false;
  const at = String(email ?? "").lastIndexOf("@");
  return at < 0 || String(email).slice(at + 1).toLowerCase() !== String(domain).toLowerCase();
}

/**
 * The roster as the panel holds it: the owner lifted out of the editable list.
 *
 * `users` from the server always contains the owner (saveAccess writes them in), and the
 * panel draws them as a locked row above the list. Leaving them in the editable array would
 * put a remove button on the one row that cannot be removed.
 */
export function splitRoster(info) {
  const owner = String((info && info.owner) || "").toLowerCase();
  const users = ((info && info.users) || []).filter((e) => !isOwnerRow(e, owner));
  const admins = ((info && info.admins) || []).slice();
  return { owner, domain: String((info && info.domain) || ""), users, admins };
}

/** Whether either list has moved since it was loaded. */
export function isDirty(state, saved) {
  return state.users.join(",") !== saved.users || state.admins.join(",") !== saved.admins;
}

/**
 * Who this save would lock out, by name.
 *
 * ADDING SOMEONE IS RECOVERABLE BY REMOVING THEM; REMOVING SOMEONE IS NOT — they lose access
 * on their very next request, and if that person is the last admin nobody but the owner can
 * put them back. So the confirmation names them rather than counting them.
 *
 * TAKES THE LAST SAVED ROSTER, NOT THE INITIALLY LOADED ONE, and that is a correction to the
 * source. gas/src/client/js/pages/accessEditor.js:134 compares against the `info` payload from
 * the first `getAccess` and never refreshes it after a save — so the FIRST removal in a visit
 * is confirmed and every one after it is silent. Found here in the browser: add two people,
 * save, remove one, save; no dialog, and they are gone. The baseline has to move when the disk
 * does.
 */
export function removals(baseline, state) {
  const goneUsers = ((baseline && baseline.users) || [])
    .filter((e) => state.users.indexOf(e) < 0);
  const goneAdmins = ((baseline && baseline.admins) || [])
    .filter((e) => state.admins.indexOf(e) < 0);
  return goneUsers.concat(goneAdmins);
}

/**
 * Is this a plausible address to add?
 *
 * Mirrors the server's rule exactly (`access.validateAddresses`): an entry with no `@` can
 * never match a Google account, so it is a typo rather than a policy. Checking it here too is
 * not defence — it is so the same edit is not accepted by the panel and refused by the save,
 * which would leave the reader unsure which of their entries was the bad one.
 */
export function isAddable(value, list, owner) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return { ok: false, reason: "empty" };
  if (v.indexOf("@") < 0) return { ok: false, reason: "not-an-address" };
  if (isOwnerRow(v, owner)) return { ok: false, reason: "already-the-owner" };
  if ((list || []).indexOf(v) >= 0) return { ok: false, reason: "already-listed" };
  return { ok: true, value: v };
}

/** The words each rejection gets. */
export const ADD_REJECTION = {
  "not-an-address": "That doesn't look like an email address.",
  "already-the-owner": "The owner always has access.",
  "already-listed": "That person is already on the list.",
};

/**
 * Which save calls a submit actually needs.
 *
 * An unchanged list is not sent. That matters for admins specifically: their panel never
 * changes `admins`, and sending it anyway would earn a refusal from `saveAdmins` for a no-op —
 * an error message about a thing the reader never touched.
 */
export function pendingSaves(state, saved, canEditAdmins) {
  return {
    users: state.users.join(",") !== saved.users,
    admins: Boolean(canEditAdmins) && state.admins.join(",") !== saved.admins,
  };
}
