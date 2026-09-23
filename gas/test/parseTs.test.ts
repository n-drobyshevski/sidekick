// parseTs's fast path for the canonical "YYYY-MM-DDTHH:MM:SSZ" shape every ledger column is
// written in. It exists for speed alone (millions of calls per request), so the only thing it
// may never do is answer differently from the general path it skips.
import { describe, expect, it } from "vitest";
import { parseTs } from "../src/domain/util";

describe("parseTs fast path", () => {
  it("parses the canonical shape as UTC", () => {
    expect(parseTs("2026-09-20T01:02:03Z")).toBe(Date.UTC(2026, 8, 20, 1, 2, 3));
  });

  it("agrees with the general path on every neighbouring shape", () => {
    const at = Date.UTC(2026, 8, 20, 1, 2, 3);
    expect(parseTs(" 2026-09-20T01:02:03Z ")).toBe(at); // padded: general path trims
    expect(parseTs("2026-09-20T01:02:03")).toBe(at); // no zone: general path appends Z
    expect(parseTs("2026-09-20 01:02:03")).toBe(at); // space: general path normalizes
    expect(parseTs("2026-09-20T01:02:03.000Z")).toBe(at);
  });

  it("falls through to null on a canonical-length string that is not a date", () => {
    expect(parseTs("2026-99-99T99:99:99Z")).toBeNull();
    expect(parseTs("xxxxxxxxxxTxxxxxxxxZ")).toBeNull();
  });
});
