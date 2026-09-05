// What the dot at the foot of the rail says.
//
// It is the whole status readout on the default layout — above 800px the captions beside it
// are visually hidden — so these are not cosmetic assertions. Each one pins a sentence a
// reader is entitled to, in a place where the alternative is a coloured circle and nothing.

import { describe, expect, it } from "vitest";
import { railStatus, withLabels } from "../src/client/js/railStatus.js";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

const base = {
  hasCredentials: true,
  scopes: ["sca", "sast", "secrets"],
  nowMs: NOW,
  job: null,
};
const labels = { sca: "Dependencies", sast: "Code", secrets: "Secrets" };
const scanned = (over) => withLabels(
  { sca: ago(0), sast: ago(0), secrets: ago(0), ...over }, labels,
);

describe("precedence", () => {
  it("says what is happening now before anything about the past", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: scanned({ secrets: null }),
      job: { phase: "FETCHING", scope: "sca", findings_so_far: 1500, total_count: 17991 },
    });
    expect(s.state).toBe("scanning");
    expect(s.label).toContain("Dependencies");
    expect(s.detail).toBe("1,500 of 17,991");
  });

  it("reports a failure over a stale register", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: scanned({ sca: ago(30) }),
      job: { phase: "FAILED", scope: "sast" },
    });
    expect(s.state).toBe("bad");
    expect(s.label).toBe("Last sync failed");
  });

  it("says NEVER SCANNED rather than averaging it away", () => {
    // The pair that carries the design. Two registers scanned an hour ago and one never
    // looked at is not a fresh register — reporting "scanned today" would describe a
    // population nobody has measured, which is the same failure the Executive page's empty
    // state exists to avoid.
    const s = railStatus({ ...base, lastScanByScope: scanned({ secrets: null }) });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("1 register never scanned");
    expect(s.detail).toBe("Secrets");
  });

  it("names all of them when nothing has ever run", () => {
    const s = railStatus({
      ...base, lastScanByScope: withLabels({ sca: null, sast: null, secrets: null }, labels),
    });
    expect(s.label).toBe("Never scanned");
  });
});

describe("no tenant is not a fault", () => {
  it("is neutral, and says what to do", () => {
    // Nothing is broken: a fresh deployment and the dev harness both live here. A warning
    // colour would make the normal state look like a problem.
    const s = railStatus({ ...base, hasCredentials: false, lastScanByScope: scanned() });
    expect(s.state).toBe("neutral");
    expect(s.label).toContain("No Wiz credentials");
    expect(s.detail).toContain("Run sync");
  });

  it("beats freshness, because a stale figure with no source behind it is not the story", () => {
    const s = railStatus({
      ...base, hasCredentials: false, lastScanByScope: scanned({ sca: ago(40) }),
    });
    expect(s.state).toBe("neutral");
    expect(s.label).toContain("credentials");
  });
});

describe("freshness is the WORST of the collected registers", () => {
  it("takes the oldest, not the newest", () => {
    // `bootstrap.latestScan` is a max over the whole scans tab, which reads "fresh" whenever
    // ANY scope ran recently. Three registers keep three clocks.
    const s = railStatus({ ...base, lastScanByScope: scanned({ secrets: ago(6) }) });
    expect(s.state).toBe("warn");
    expect(s.label).toBe("Oldest register scanned 6 days ago");
    expect(s.detail).toBe("Secrets");
  });

  it("ignores a register that is not collected", () => {
    // Dropping a scope in Settings freezes its findings, and the Settings page warns about
    // exactly that — but the rail must not then report the frozen register as stale forever.
    const s = railStatus({
      ...base, scopes: ["sca", "sast"], lastScanByScope: scanned({ secrets: ago(400) }),
    });
    expect(s.state).toBe("ok");
  });

  it("calls a same-day scan today and a one-day-old one yesterday", () => {
    expect(railStatus({ ...base, lastScanByScope: scanned() }).label)
      .toBe("All registers scanned today");
    expect(railStatus({ ...base, lastScanByScope: scanned({ sca: ago(1) }) }).label)
      .toBe("All registers scanned yesterday");
  });

  it("does not call an unreadable date fresh", () => {
    // The quiet way a broken clock becomes a green tick.
    const s = railStatus({
      ...base, lastScanByScope: withLabels({ sca: "not-a-date", sast: "x", secrets: "y" }, labels),
    });
    expect(s.state).toBe("neutral");
    expect(s.state).not.toBe("ok");
  });
});

describe("it survives a payload it does not recognise", () => {
  it("answers rather than throwing on nothing at all", () => {
    // It runs during boot, before anything else has drawn. A throw here is a blank app.
    expect(railStatus().state).toBeTruthy();
    expect(railStatus({}).label).toBeTruthy();
  });

  it("still labels a scope when no label map was shipped", () => {
    const s = railStatus({ ...base, lastScanByScope: { sca: ago(0), sast: ago(0), secrets: null } });
    expect(s.detail).toBe("secrets");
  });
});
