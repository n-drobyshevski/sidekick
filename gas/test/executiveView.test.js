// What the Executive page CLAIMS once it answers for the header scope: which population its
// severity tiles counted, and which dimension its remediation split is drawn over.
//
// Plain .js for the reason navGroups.test.js writes out. executive.js exports these two
// functions so this file can exist — the split scanProgress.js and capacity.js already use.
//
// The failure mode this guards is not a crash. It is a page that answers for one domain in its
// hero and for the whole register in its tiles, with nothing on screen saying which is which.
// That mismatch is precisely why Executive was exempt from the scope switcher until now: the
// tiles read bootstrap's `counts`, which is register-wide by construction, so scoping the hero
// alone would have made the page worse rather than narrower.
//
// The second half guards a quieter one. Only `mttrByDomainData` aliases its `group` column into
// `domain`; the by-support-group split ships `group` alone. A reader that reaches for `.domain`
// renders a table of real numbers beside a column of blanks — which looks like missing data
// rather than like a bug in the accessor.

import { describe, expect, it } from "vitest";

import { executiveByDomainView, executiveSeverityView } from "../src/client/js/pages/executive.js";

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const ALL = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const BOOT = { CRITICAL: 12, HIGH: 340, MEDIUM: 1200, LOW: 7 };

const sevView = (over = {}) => executiveSeverityView({
  order: ORDER, scope: ALL, bootCounts: BOOT, payload: null, scoped: false, ...over,
});
const values = (v) => Object.fromEntries(v.tiles.map((t) => [t.sev, t.value]));

describe("executiveSeverityView — unscoped, bootstrap is the source", () => {
  it("paints real numbers on the first pass, with no placeholder", () => {
    const v = sevView();
    expect(values(v)).toEqual({ CRITICAL: "12", HIGH: "340", MEDIUM: "1,200", LOW: "7" });
    expect(v.note).toBeNull();
  });

  // The landing page must not regress to a skeleton flash for a scoped case it isn't in, so the
  // unscoped repaint has to be a no-op. It is only a no-op because the two tallies agree —
  // bootstrap counts visibleFrame(scan.records) and scopedFrameRecords("","",[]) returns exactly
  // that. Pinned here so a later edit to either path cannot introduce a flicker unnoticed.
  it("ignores the payload it is handed, so the repaint changes nothing", () => {
    const withPayload = sevView({
      payload: { flatScan: true, counts: { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 1 }, total: 4 },
    });
    expect(values(withPayload)).toEqual(values(sevView()));
  });
});

describe("executiveSeverityView — scoped, the server's tally is the source", () => {
  it("shows a placeholder while the scoped counts are in flight", () => {
    const v = sevView({ scoped: true, payload: null });
    expect(v.tiles.map((t) => t.value)).toEqual(["…", "…", "…", "…"]);
    expect(v.note).toBeNull();
  });

  // The bug under test: bootstrap's numbers must not survive into a scoped view.
  it("reads the payload, never the register-wide bootstrap counts", () => {
    const v = sevView({
      scoped: true,
      payload: { flatScan: true, counts: { CRITICAL: 2, HIGH: 31 }, total: 33 },
    });
    expect(values(v)).toEqual({ CRITICAL: "2", HIGH: "31", MEDIUM: "0", LOW: "0" });
    expect(v.note).toBeNull();
  });

  it("renders a severity the payload omits as 0, not as blank or an em dash", () => {
    const v = sevView({ scoped: true, payload: { flatScan: true, counts: { HIGH: 4 }, total: 4 } });
    expect(values(v).CRITICAL).toBe("0");
  });

  // A scope holding resolved history and no open findings — a domain whose live work has closed,
  // or `Not attributable`, which no open finding can reach. The hero above still shows a real KM
  // median off those lifecycles, so the zeros need to say why they are zero.
  it("names an all-zero scope instead of leaving four bare zeros under a live hero", () => {
    const v = sevView({ scoped: true, payload: { flatScan: true, counts: {}, total: 0 } });
    expect(v.tiles.map((t) => t.value)).toEqual(["0", "0", "0", "0"]);
    expect(v.note).toBe("No open findings in this scope.");
  });

  // No scan at all is a different statement, and the scan section already makes it.
  it("stays silent when there is no scan to count", () => {
    const v = sevView({ scoped: true, payload: { flatScan: false, counts: {}, total: 0 } });
    expect(v.note).toBeNull();
  });
});

describe("executiveSeverityView — the display-severity scope", () => {
  it("drops tiles outside the scope and keeps the palette's order", () => {
    const v = sevView({ scope: ["MEDIUM", "CRITICAL"] });
    expect(v.tiles.map((t) => t.sev)).toEqual(["CRITICAL", "MEDIUM"]);
  });

  it("returns no tiles at all when the scope is empty", () => {
    expect(sevView({ scope: [] }).tiles).toEqual([]);
  });
});

const row = (name, open, kmMedian = 10) => ({ group: name, open, kmMedian });
const byDomainRow = (name, open, kmMedian = 10) => ({ ...row(name, open, kmMedian), domain: name });
const dView = (byDomain, domainNames = ["A", "B", "C"]) =>
  executiveByDomainView(byDomain, { domainNames });

describe("executiveByDomainView — the dimension follows the scope", () => {
  it("titles and labels the domain split, reading the aliased name", () => {
    const v = dView({ dimension: "domain", rows: [byDomainRow("A", 5), byDomainRow("B", 3)] });
    expect(v.show).toBe(true);
    expect(v.title).toBe("MTTR by domain");
    expect(v.columnHeader).toBe("Domain");
    expect(v.rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  // Only mttrByDomainData writes the `domain` alias. Reaching for it here is a column of blanks.
  it("titles and labels the support-group split, reading the unaliased name", () => {
    const v = dView({ dimension: "supportGroup", rows: [row("Team X", 5), row("Team Y", 3)] });
    expect(v.title).toBe("MTTR by support group");
    expect(v.columnHeader).toBe("Support group");
    expect(v.rows.map((r) => r.name)).toEqual(["Team X", "Team Y"]);
  });
});

describe("executiveByDomainView — when there is no split worth drawing", () => {
  it("hides the domain split on a register with fewer than two domains", () => {
    const rows = [byDomainRow("A", 5), byDomainRow("B", 3)];
    expect(dView({ dimension: "domain", rows }, ["A"]).show).toBe(false);
  });

  // domainNames is register-wide, so under a support-group scope that gate passes for a group
  // that lives in a single domain — and a one-row table just restates the hero.
  it("hides a one-row table on either dimension", () => {
    expect(dView({ dimension: "domain", rows: [byDomainRow("A", 5)] }).show).toBe(false);
    expect(dView({ dimension: "supportGroup", rows: [row("Team X", 5)] }).show).toBe(false);
  });

  it("hides an absent or empty payload", () => {
    expect(dView(null).show).toBe(false);
    expect(dView(undefined).show).toBe(false);
    expect(dView({ dimension: "domain", rows: [] }).show).toBe(false);
  });
});

describe("executiveByDomainView — ranking", () => {
  it("sorts by open backlog descending and caps the summary at five", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((n, i) => byDomainRow(n, i));
    const v = dView({ dimension: "domain", rows });
    expect(v.rows.map((r) => r.name)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("treats a missing open count as zero rather than dropping the row", () => {
    const v = dView({ dimension: "domain", rows: [{ group: "A" }, byDomainRow("B", 3)] });
    expect(v.rows.map((r) => [r.name, r.open])).toEqual([["B", 3], ["A", 0]]);
  });
});
