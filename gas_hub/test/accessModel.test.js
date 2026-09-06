// What the Access panel draws, and the two things it must never draw.
//
// The authorization itself is `test/accessAdmin.test.ts` — server-side, where the boundary
// actually is. This file covers the panel's own decisions, whose failure mode is different
// and quieter: a control that looks like it worked.

import { describe, expect, it } from "vitest";
import {
  ADD_REJECTION, isAddable, isDirty, isOwnerRow, outsideDomain, pendingSaves, removals,
  splitRoster,
} from "../src/client/js/pages/accessModel.js";

const info = {
  canEditUsers: true,
  canEditAdmins: true,
  owner: "owner@example.com",
  domain: "example.com",
  users: ["owner@example.com", "listed@example.com", "other@example.com"],
  admins: ["admin@example.com"],
};

describe("the owner's row", () => {
  it("is lifted out of the editable list", () => {
    // Leaving them in would put a remove button on the one row that cannot be removed —
    // they are admitted by identity, so deleting them changes nothing except what the list
    // appears to say.
    const s = splitRoster(info);
    expect(s.users).toEqual(["listed@example.com", "other@example.com"]);
    expect(s.owner).toBe("owner@example.com");
  });

  it("matches regardless of case", () => {
    // The server lowercases on the way in; a payload from anywhere else may not.
    expect(isOwnerRow("Owner@Example.com", "owner@example.com")).toBe(true);
    expect(isOwnerRow("someone@example.com", "owner@example.com")).toBe(false);
  });

  it("cannot be added back as an ordinary person", () => {
    expect(isAddable("owner@example.com", [], "owner@example.com"))
      .toEqual({ ok: false, reason: "already-the-owner" });
  });

  it("survives a payload with no roster at all", () => {
    // What a non-editor gets: {canEditUsers:false}. The panel returns null before reaching
    // here, but a model that threw on it would turn a normal outcome into a page error.
    const s = splitRoster({ canEditUsers: false });
    expect(s).toEqual({ owner: "", domain: "", users: [], admins: [] });
    expect(splitRoster(null).users).toEqual([]);
  });
});

describe("an address outside the domain grants nothing", () => {
  it("flags it", () => {
    // It cannot match a Google account this app can see, so adding it is a no-op the reader
    // would otherwise walk away believing.
    expect(outsideDomain("x@other.com", "example.com")).toBe(true);
    expect(outsideDomain("x@example.com", "example.com")).toBe(false);
    expect(outsideDomain("X@EXAMPLE.COM", "example.com")).toBe(false);
  });

  it("flags nothing when the domain is unknown", () => {
    // Better to say nothing than to mark every address as suspect.
    expect(outsideDomain("x@other.com", "")).toBe(false);
  });

  it("does not REFUSE it", () => {
    // Flagged, not blocked: the server accepts it, and the panel's job is to tell the reader
    // what will happen rather than to decide for them.
    expect(isAddable("x@other.com", [], "owner@example.com").ok).toBe(true);
  });
});

describe("what the panel will not accept", () => {
  it("refuses an entry with no @, exactly as the server does", () => {
    // Mirrored so the same edit is not accepted here and refused there — which would leave
    // the reader unsure which of their entries was the bad one.
    expect(isAddable("notanemail", [], "o@x.com"))
      .toEqual({ ok: false, reason: "not-an-address" });
    expect(ADD_REJECTION["not-an-address"]).toMatch(/email address/);
  });

  it("refuses a duplicate and an empty box", () => {
    expect(isAddable("a@x.com", ["a@x.com"], "o@x.com").reason).toBe("already-listed");
    expect(isAddable("   ", [], "o@x.com").reason).toBe("empty");
  });

  it("normalizes what it does accept", () => {
    expect(isAddable("  A@X.com ", [], "o@x.com")).toEqual({ ok: true, value: "a@x.com" });
  });
});

describe("a save says what it will take away", () => {
  // `baseline` is the roster known to be ON DISK, and it moves on every save.
  const baseline = { users: ["listed@example.com", "other@example.com"], admins: ["admin@example.com"] };

  it("names the people who lose access", () => {
    // Counting them would be enough for a dialog and not enough for a decision: removing
    // someone locks them out on their very next request.
    const state = { users: ["listed@example.com"], admins: [] };
    expect(removals(baseline, state)).toEqual(["other@example.com", "admin@example.com"]);
  });

  it("still confirms a removal made AFTER an earlier save", () => {
    // THE DEFECT THIS SIGNATURE EXISTS FOR, carried in from the source and caught in the
    // browser: gas/accessEditor.js:134 compares against the payload the page loaded with and
    // never refreshes it, so a person added and saved in this visit is invisible to the check
    // — the first removal is confirmed and every one after it is silent.
    //
    // Reproduced: the loaded roster held only the owner, two people were added and saved, and
    // removing one raised no dialog at all.
    const loaded = { users: [], admins: [] };
    const afterSave = { users: ["colleague@example.com", "outsider@other.com"], admins: [] };
    const state = { users: ["colleague@example.com"], admins: [] };

    expect(removals(loaded, state)).toEqual([]);                      // what the source asked
    expect(removals(afterSave, state)).toEqual(["outsider@other.com"]); // what it must ask
  });

  it("never counts the owner as a removal", () => {
    // They are absent from the baseline by construction — splitRoster lifts them out — so
    // this holds without a special case for them.
    const state = { users: ["listed@example.com", "other@example.com"], admins: ["admin@example.com"] };
    expect(removals(baseline, state)).toEqual([]);
    expect(splitRoster(info).users).not.toContain(info.owner);
  });

  it("sees an addition as no removal at all", () => {
    const state = { users: [...baseline.users, "new@example.com"], admins: ["admin@example.com"] };
    expect(removals(baseline, state)).toEqual([]);
  });

  it("survives an empty baseline", () => {
    expect(removals(null, { users: [], admins: [] })).toEqual([]);
  });
});

describe("only what changed is sent", () => {
  const saved = { users: "listed@example.com", admins: "admin@example.com" };

  it("sends nothing when nothing moved", () => {
    const state = { users: ["listed@example.com"], admins: ["admin@example.com"] };
    expect(isDirty(state, saved)).toBe(false);
    expect(pendingSaves(state, saved, true)).toEqual({ users: false, admins: false });
  });

  it("never sends the admins list from an admin's panel", () => {
    // An admin cannot change it, so sending it — even unchanged — would earn a refusal from
    // saveAdmins for a no-op, surfacing an error about something they never touched.
    const state = { users: ["listed@example.com", "new@example.com"], admins: ["admin@example.com"] };
    expect(pendingSaves(state, saved, false)).toEqual({ users: true, admins: false });
  });

  it("sends the admins list when the owner changed it", () => {
    const state = { users: ["listed@example.com"], admins: ["admin@example.com", "second@example.com"] };
    expect(isDirty(state, saved)).toBe(true);
    expect(pendingSaves(state, saved, true)).toEqual({ users: false, admins: true });
  });
});
