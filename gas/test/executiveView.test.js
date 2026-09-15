// What the Executive page CLAIMS once it answers for the header scope: which population its
// severity tiles counted, and which dimension its remediation split is drawn over.
//
// Plain .js for the reason navGroups.test.js writes out. executive.js exports these two
// functions so this file can exist — the split scanProgress.js and capacity.js already use.
//
// The failure mode this guards is not a crash. It is a page that answers for one domain in its
// hero and for the whole register in its tiles, with nothing on screen saying which is which.
// That mismatch is precisely why Executive was exempt from the scope switcher until now: the
// tiles read a bootstrap tally that is register-wide by construction, so scoping the hero alone
// would have made the page worse rather than narrower.
//
// The tiles now read bootstrap's `openCounts` rather than `counts` — same shape, open rows
// only. They had been counting resolved history too, so the better a register's close rate,
// the more it overstated its live risk. The fixtures below are populations, not sources: this
// file pins which population the view REPORTS, and the open/all filtering itself is
// server-side (isOpenStatus, test/openStatus.test.ts).
//
// THERE ARE NO TILES ANY MORE, AND THE FIELD KEPT ITS NAME. P2.2 replaced five bordered
// `.exec-sev-tile` boxes with `sevSegmentBar` + `sevKeyRow` — the same picture both register
// pages already draw — because a distribution rendered as five equal boxes is the one thing a
// distribution is not: 12 CRITICAL beside 12 INFO looked identical, and recovering the shape
// meant comparing five numbers by eye. So the assertions below are about the DATA, which did
// not change: which population each source reports, in the palette's order, with a zero level
// kept rather than dropped. What is new is `count` beside `value` (the bar needs the number,
// the key row prints the string) and `open`, the total the population line under the picture
// states. `tiles` stays the field name: it is the per-level list either shape is built from,
// and renaming it would have made this file's diff look like a behaviour change.
//
// `executiveHeroView` JOINED THIS FILE with the same rewrite. It is the front door's one
// figure and the whole reason the page exists in this shape, and its three states are three
// different claims — a median, a lower bound, and a refusal — which is exactly the kind of
// thing that gets flattened into "0" by a later edit nobody measures.
//
// The second half guards a quieter one. Only `mttrByDomainData` aliases its `group` column into
// `domain`; the by-support-group split ships `group` alone. A reader that reaches for `.domain`
// renders a table of real numbers beside a column of blanks — which looks like missing data
// rather than like a bug in the accessor.

import { describe, expect, it } from "vitest";

import {
  executiveByDomainView, executiveHeroView, executiveSeverityView,
} from "../src/client/js/pages/executive.js";

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
  // bootstrap counts the OPEN rows of visibleFrame(scan.records), and scopedFrameRecords("","",[])
  // returns exactly that frame, filtered the same way. Pinned here so a later edit to either
  // path cannot introduce a flicker unnoticed; narrowing one population without the other is
  // precisely how that would happen.
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

describe("executiveSeverityView — the numbers the picture is drawn from", () => {
  // `sevSegmentBar` sets `flex-grow` from a NUMBER and `sevKeyRow` prints one; a view that
  // only carried the formatted string would make the bar parse "1,200" back into 1200 at the
  // call site, which is a cast in front of a figure that was a number the whole way down.
  it("carries the raw count beside the formatted value", () => {
    const v = sevView();
    expect(v.tiles.map((t) => [t.sev, t.count])).toEqual([
      ["CRITICAL", 12], ["HIGH", 340], ["MEDIUM", 1200], ["LOW", 7],
    ]);
    expect(v.pending).toBe(false);
  });

  // The population line under the picture says "N open findings", and N has to be the number
  // the bar is a picture OF. Summing the drawn levels is what makes the two agree by
  // construction: the server's own `total` also counts UNKNOWN, which rides along with every
  // severity gate and is not a level this page draws.
  it("reports `open` as the sum of the levels it actually draws", () => {
    expect(sevView().open).toBe(12 + 340 + 1200 + 7);
    const scopedView = sevView({
      scoped: true,
      payload: { flatScan: true, counts: { CRITICAL: 2, HIGH: 31, UNKNOWN: 9 }, total: 42 },
    });
    expect(scopedView.open).toBe(33);
  });

  // THE DEFECT THIS LINE WAS WRITTEN AGAINST, measured on the dev seed at 1280: the picture
  // drew CRITICAL 27 + HIGH 39 and stated "66 open findings", six inches under a hero reading
  // "70 still open" and a movement row reading "70 open, was 75". Both figures were right and
  // they were about different populations — the display-severity setting was CRITICAL+HIGH,
  // and `filterSeverities` keeps UNKNOWN alongside every gate. Two totals on one page that
  // disagree by four, with nothing saying why, read as arithmetic that has gone wrong.
  it("names BOTH populations on the surface, and moves the reason they differ to `explain`",
    () => {
      const v = sevView({
        order: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"],
        scope: ["CRITICAL", "HIGH"],
        scoped: true,
        payload: { flatScan: true, counts: { CRITICAL: 27, HIGH: 39, UNKNOWN: 4 }, total: 70 },
      });
      expect(v.open).toBe(66);
      expect(v.openAll).toBe(70);
      // BOTH FIGURES ON THE SURFACE, in one short line — no reader has to hover anything to see
      // that 66 and 70 are different counts.
      expect(v.populationLine).toBe("66 open at the shown severities · 70 including UNKNOWN");
      // THE REASON THEY DIFFER IS AN EXPLANATION, one level down, for `renderSeverity` to hang
      // on a `tipLabel` over that same line.
      expect(v.populationExplain).toEqual([
        "The figures elsewhere on this page count 70; this picture counts only the 66 at the"
        + " severities it shows.",
        "A severity gate always keeps findings graded UNKNOWN, and this picture has no level"
        + " to draw them at.",
      ]);
    });

  // And it says the one number when there is only one — "66 open findings, of 66" was a caveat
  // about nothing, and there is nothing left to explain either.
  it("states a single total where the two populations are the same, with nothing to explain",
    () => {
      const v = sevView({
        scoped: true,
        payload: {
          flatScan: true, counts: { CRITICAL: 2, HIGH: 3, MEDIUM: 0, LOW: 0 }, total: 5,
        },
      });
      expect(v.open).toBe(5);
      expect(v.openAll).toBe(5);
      expect(v.populationLine).toBe("5 open findings.");
      expect(v.populationExplain).toBeNull();
    });

  // THE SECOND TOTAL IS THE GATE'S POPULATION, NOT THE REGISTER'S, and getting that wrong is
  // what the first attempt did: summing every level put "of 113" beside a picture of 66 while
  // the hero four inches above said 70 — one discrepancy explained by inventing a bigger one.
  // The hero and the movement strip measure the display scope PLUS UNKNOWN, so that is what
  // the sentence's second number has to be, on both paths.
  it("counts the gate's own population unscoped, not every level in the register", () => {
    const v = sevView({
      order: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"],
      scope: ["CRITICAL", "HIGH"],
      bootCounts: { CRITICAL: 27, HIGH: 39, MEDIUM: 40, LOW: 3, UNKNOWN: 4 },
    });
    expect(v.open).toBe(66);
    expect(v.openAll).toBe(70);
    expect(v.openAll).not.toBe(113);
    expect(v.populationLine).toContain("70 including UNKNOWN");
    expect(v.populationExplain.join(" ")).toContain("count 70");
  });

  // `SELECTABLE_SEVERITIES` (src/domain/config.ts) is SEVERITY_ORDER minus UNKNOWN, so UNKNOWN
  // can never be IN a display scope and is never excluded by one either. With every selectable
  // level shown, the two totals are the same figure and the caveat disappears.
  it("drops the caveat entirely when nothing is graded UNKNOWN", () => {
    const v = sevView({
      order: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"],
      scope: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      bootCounts: { CRITICAL: 12, HIGH: 340, MEDIUM: 1200, LOW: 7 },
    });
    expect(v.openAll).toBe(v.open);
    expect(v.populationLine).toBe("1,559 open findings.");
    expect(v.populationExplain).toBeNull();
  });

  // A count in flight is not a count of zero. The scoped path has nothing to draw until the
  // RPC lands, so it says `pending` and the page paints a skeleton rather than an empty bar.
  it("reports a pending scope as pending, with no counts to draw", () => {
    const v = sevView({ scoped: true, payload: null });
    expect(v.pending).toBe(true);
    expect(v.tiles.map((t) => t.count)).toEqual([null, null, null, null]);
    expect(v.open).toBeNull();
    expect(v.openAll).toBeNull();
    expect(v.populationLine).toBeNull();
    expect(v.populationExplain).toBeNull();
  });

  // A LEVEL WITH ZERO OPEN FINDINGS KEEPS ITS KEY. `sevEntries` (gas_shared) filters
  // `count > 0`, which is right for a register page's hero and wrong here: a missing key
  // reads as a render that failed, an honest 0 does not. The BAR drops the zero segments
  // (a flex-grow-0 segment is invisible anyway); the KEY ROW does not.
  it("keeps a zero level in the list the key row is built from", () => {
    const v = sevView({ scoped: true, payload: { flatScan: true, counts: { HIGH: 4 }, total: 4 } });
    expect(v.tiles.map((t) => t.count)).toEqual([0, 4, 0, 0]);
    expect(v.tiles.filter((t) => t.count > 0).map((t) => t.sev)).toEqual(["HIGH"]);
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
  // This used to assert a five-row cap, and the cap was removed on purpose rather than because
  // the assertion was inconvenient. The claim it encoded — "the exec split is a summary, so
  // five rows is enough" — is false for the question the section asks: MTTR is not ranked by
  // open backlog, so the worst-performing domain on the page could sit outside the top five by
  // volume and never be drawn, with nothing on screen saying rows had been dropped. Ordering is
  // still by open backlog, so the head of the list is unchanged; the tail is no longer silently
  // discarded.
  it("sorts by open backlog descending and lists every group", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((n, i) => byDomainRow(n, i));
    const v = dView({ dimension: "domain", rows });
    expect(v.rows.map((r) => r.name)).toEqual(["g", "f", "e", "d", "c", "b", "a"]);
  });

  it("treats a missing open count as zero rather than dropping the row", () => {
    const v = dView({ dimension: "domain", rows: [{ group: "A" }, byDomainRow("B", 3)] });
    expect(v.rows.map((r) => [r.name, r.open])).toEqual([["B", 3], ["A", 0]]);
  });
});

// =========================================================================================
//  The hero — one figure, three claims
// =========================================================================================
//
// The front door's whole reason to exist, and the one figure PRODUCT.md's sixth principle is
// written about. `kmHalfLifeView` (pages/mttr.js) makes the decision; this view is what turns
// it into the hero's value, its qualifier and the state its help tip reads. The three outcomes
// are three DIFFERENT claims and collapsing any two of them is the failure:
//
//   a median            half the register closed within that
//   a lower bound       the curve never reached half, so the median is at LEAST that
//   neither             nobody has measured anything. Not a zero, and not a dash.

const heroPayload = (km, over = {}) => ({
  mttr: { rowCount: 554, overall: { resolved: 138, open: 416 }, remediation: { km }, ...over },
});

describe("executiveHeroView — the three states of one figure", () => {
  it("publishes an observed median as a plain duration", () => {
    const v = executiveHeroView(heroPayload({ median: 41, medianLowerBound: null }));
    expect(v.measured).toBe(true);
    expect(v.isLowerBound).toBe(false);
    expect(v.value).toBe("41 days");
    expect(v.days).toBe(41);
  });

  // THE CASE THIS REGISTER WAS BUILT TO GET RIGHT. Rendering the bound as a bare "294 days"
  // states a median nobody observed; collapsing it to a dash throws away a true statement.
  it("publishes a censored estimate as an inclusive lower bound, and flags it", () => {
    const v = executiveHeroView(heroPayload({ median: null, medianLowerBound: 293.9 }));
    expect(v.measured).toBe(true);
    expect(v.isLowerBound).toBe(true);
    expect(v.value).toBe("at least 294 days");
    expect(v.days).toBe(293.9);
    // "at least", never ">" — the estimator showed the median is AT LEAST that far out, and
    // "more than" is a strictly stronger claim it never made.
    expect(v.value).not.toContain(">");
  });

  it("refuses rather than printing a zero when there is nothing to read off", () => {
    const v = executiveHeroView(heroPayload({ median: null, medianLowerBound: null }));
    expect(v.measured).toBe(false);
    expect(v.value).toBe("Not measured");
    expect(v.days).toBeNull();
    expect(v.isLowerBound).toBe(false);
  });

  it("refuses a payload with no mttr slice at all, rather than throwing", () => {
    for (const p of [null, undefined, {}, { mttr: null }, { mttr: {} }]) {
      expect(executiveHeroView(p).value).toBe("Not measured");
    }
  });
});

describe("executiveHeroView — the qualifier states its own base", () => {
  it("names the tracked, resolved and still-open lifecycles", () => {
    const v = executiveHeroView(heroPayload({ median: 41 }));
    expect(v.tracked).toBe(554);
    expect(v.resolved).toBe(138);
    expect(v.open).toBe(416);
    expect(v.qualifier)
      .toBe("554 tracked lifecycles · 138 resolved · 416 still open");
  });

  // THE ONE SENTENCE THIS FILE IS MOST ABOUT. "Not measured" over "0 tracked lifecycles · 0
  // resolved · 0 still open" states a refusal and then contradicts it three times, in the one
  // slot on the page a leader reads first. The counts are withheld, not zeroed.
  it("never glues `Not measured` to a count", () => {
    const v = executiveHeroView({ mttr: { rowCount: 0, overall: {}, remediation: {} } });
    expect(v.value).toBe("Not measured");
    expect(v.qualifier).toBe("No lifecycles tracked yet.");
    expect(v.qualifier).not.toMatch(/\b0\b/);
    expect(v.qualifier).not.toContain("—");
  });

  // `Number(null)` is 0 and it is finite. `num(v, 0)` refuses BEFORE the cast and falls back
  // deliberately, so a resolved count that is genuinely absent reads 0 because the fallback
  // said so — and `tracked` stays 0, which is what keeps the qualifier on its honest branch.
  it("does not let an absent count masquerade as a measured one", () => {
    const v = executiveHeroView({
      mttr: { rowCount: null, overall: { resolved: null, open: undefined }, remediation: {} },
    });
    expect(v.tracked).toBe(0);
    expect(v.qualifier).toBe("No lifecycles tracked yet.");
  });

  it("says lifecycle in the singular when there is exactly one", () => {
    const v = executiveHeroView({
      mttr: { rowCount: 1, overall: { resolved: 0, open: 1 }, remediation: { km: {} } },
    });
    expect(v.qualifier).toBe("1 tracked lifecycle · 0 resolved · 1 still open");
  });
});
