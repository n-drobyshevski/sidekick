// `isOpenStatus` — the server layer's one open/closed test.
//
// The polarity is the whole point and it is the opposite of the obvious one: the function asks
// "is this NOT resolved", not "is this open". Anything unrecognized stays in the backlog. A
// naive `status === "OPEN"` would silently close every finding carrying a status the app has
// not seen before, and a register quietly shrinking is the failure nobody reports.
//
// This exists because the Executive page's "Open vulnerabilities" tiles were counting resolved
// rows: the tally had no status test at all, and the label was the only thing claiming
// otherwise.

import { describe, expect, it } from "vitest";

import { isOpenStatus, RESOLVED_STATUSES } from "../src/domain/config";

describe("isOpenStatus", () => {
  it("closes exactly the four recognized resolved statuses", () => {
    for (const s of RESOLVED_STATUSES) expect(isOpenStatus(s), s).toBe(false);
    expect(RESOLVED_STATUSES.size).toBe(4);
  });

  it("is case-insensitive, because the wire spelling is not guaranteed", () => {
    expect(isOpenStatus("resolved")).toBe(false);
    expect(isOpenStatus("Resolved")).toBe(false);
    expect(isOpenStatus("ReSoLvEd")).toBe(false);
  });

  it("treats OPEN and IN_PROGRESS as open", () => {
    expect(isOpenStatus("OPEN")).toBe(true);
    expect(isOpenStatus("IN_PROGRESS")).toBe(true);
  });

  // The load-bearing one. A status the app has never seen must not be read as closed.
  it("keeps anything unrecognized, blank or absent in the backlog", () => {
    expect(isOpenStatus("SOME_NEW_WIZ_STATUS")).toBe(true);
    expect(isOpenStatus("")).toBe(true);
    expect(isOpenStatus(null)).toBe(true);
    expect(isOpenStatus(undefined)).toBe(true);
    expect(isOpenStatus(0)).toBe(true);
  });

  // Whitespace is NOT trimmed, and that is the conservative direction: " RESOLVED " reads as
  // open, which leaves a row visible rather than dropping it. Pinned so the behaviour is a
  // decision rather than a surprise if a future caller starts passing padded values.
  it("does not trim, so a padded status stays open", () => {
    expect(isOpenStatus(" RESOLVED ")).toBe(true);
  });
});
