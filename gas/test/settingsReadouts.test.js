// `openAndTotal` — the one formatting rule on the Settings readouts, and the one most likely to
// regress quietly, because a wrong result still looks like a plausible label.
//
// Every figure on this page used to count open AND resolved rows while labelling itself "open".
// The fix leads with the open figure. The second figure is dropped when it would repeat the
// first: scopeSwitch.js reached the same conclusion for its own captions — "a caption that says
// the same number twice reads as a bug, and invites the reader to look for the difference
// between them" — and guards on `unassignedBase > shown`.

import { describe, expect, it } from "vitest";
import { openAndTotal } from "../src/client/js/settingsReadouts.js";

describe("openAndTotal", () => {
  it("leads with the open figure and carries the total behind it", () => {
    expect(openAndTotal(43, 57)).toBe("43 (57 all time)");
  });

  it("drops the second figure entirely when it would repeat the first", () => {
    expect(openAndTotal(6, 6)).toBe("6");
    expect(openAndTotal(0, 0)).toBe("0");
  });

  it("takes a caller-supplied unit, so a caption can read in its own words", () => {
    expect(openAndTotal(2, 9, "in the register")).toBe("2 (9 in the register)");
  });

  it("groups thousands, matching every other figure on the page", () => {
    expect(openAndTotal(1204, 6842)).toBe("1,204 (6,842 all time)");
  });

  it("treats a missing count as zero rather than rendering undefined", () => {
    expect(openAndTotal(undefined, undefined)).toBe("0");
    expect(openAndTotal(0, 12)).toBe("0 (12 all time)");
  });

  // The resolved population can only add to the total, so open should never exceed it. If it
  // somehow does, say something honest rather than silently collapsing to the suppressed form.
  it("still shows both when open somehow exceeds the total", () => {
    expect(openAndTotal(5, 3)).toBe("5 (3 all time)");
  });
});
