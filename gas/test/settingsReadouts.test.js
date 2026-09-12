// `retentionTicks` — the pure arithmetic behind the retention timeline: which state each scan's
// tick is in, and the two summary counts the readout's sentence is built from. Split out of
// `renderRetentionReadout` in P2 specifically so this file could finally hold it — before this
// package the whole readout was one DOM builder with no jsdom to render it into, so the state
// logic (sealed / would-seal / pinned / plain) went untested. `tickTimeline` (gas_shared) only
// draws whatever this returns; it does not know what any of these four words mean.
//
// `openAndTotal`'s own cases moved out of this file and into
// gas_shared/test/contracts/settingsReadouts.js, now that the function itself lives in
// gas_shared/ui/figures.js rather than here.

import { describe, expect, it } from "vitest";
import { retentionTicks } from "../src/client/js/settingsReadouts.js";

function scan(overrides) {
  return { sealed: false, pinned: false, ageDays: 10, ...overrides };
}

describe("retentionTicks", () => {
  it("an already-sealed scan reads \"sealed\", whatever its age or pin state", () => {
    const { ticks, sealedCount } = retentionTicks([scan({ sealed: true, ageDays: 400 })], 90);
    expect(ticks[0].state).toBe("sealed");
    expect(ticks[0].hint).toBe("400d old — already sealed");
    expect(sealedCount).toBe(1);
  });

  it("an unsealed, unpinned scan past the window reads \"would\" and counts toward wouldSeal", () => {
    const { ticks, wouldSeal } = retentionTicks([scan({ ageDays: 120 })], 90);
    expect(ticks[0].state).toBe("would");
    expect(ticks[0].hint).toBe("120d old — would seal at 90d");
    expect(wouldSeal).toBe(1);
  });

  it("a pinned scan reads \"pinned\" even past the window — pins hold regardless of age", () => {
    const { ticks, wouldSeal } = retentionTicks([scan({ pinned: true, ageDays: 400 })], 90);
    expect(ticks[0].state).toBe("pinned");
    expect(ticks[0].hint).toBe("400d old — always kept (most recent)");
    expect(wouldSeal).toBe(0);
  });

  it("an unsealed, unpinned scan still inside the window reads \"plain\"", () => {
    const { ticks, wouldSeal } = retentionTicks([scan({ ageDays: 10 })], 90);
    expect(ticks[0].state).toBe("plain");
    expect(ticks[0].hint).toBe("10d old — within the retention window");
    expect(wouldSeal).toBe(0);
  });

  it("sealing OFF (retentionDays null) never reads \"would\", however old a scan is", () => {
    const { ticks, wouldSeal } = retentionTicks([scan({ ageDays: 9000 })], null);
    expect(ticks[0].state).toBe("plain");
    expect(wouldSeal).toBe(0);
  });

  it("counts sealedCount and wouldSeal independently across a mixed list", () => {
    const { ticks, sealedCount, wouldSeal } = retentionTicks([
      scan({ sealed: true, ageDays: 200 }),
      scan({ sealed: true, ageDays: 150 }),
      scan({ ageDays: 120 }),
      scan({ pinned: true, ageDays: 5 }),
      scan({ ageDays: 3 }),
    ], 90);
    expect(ticks.map((t) => t.state)).toEqual(["sealed", "sealed", "would", "pinned", "plain"]);
    expect(sealedCount).toBe(2);
    expect(wouldSeal).toBe(1);
  });

  it("an empty scan list is answered, not thrown at", () => {
    expect(retentionTicks([], 90)).toEqual({ ticks: [], sealedCount: 0, wouldSeal: 0 });
    expect(retentionTicks(null, 90)).toEqual({ ticks: [], sealedCount: 0, wouldSeal: 0 });
  });

  it("a scan exactly AT the retention floor has not yet crossed it — strictly greater-than", () => {
    const { ticks } = retentionTicks([scan({ ageDays: 90 })], 90);
    expect(ticks[0].state).toBe("plain");
  });
});
