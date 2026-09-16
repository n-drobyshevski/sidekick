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
//
// THE THIRD HALF IS NEWER AND IS ABOUT A BLOCK THAT MAY NOT BE DRAWN AT ALL. The movement
// strip in the hero header states every severity's open count, its previous count and its
// direction, over the same scoped rows under the same gate — so wherever that strip can be
// drawn, this block was the page saying 27 CRITICAL and 39 HIGH a second time, a screen lower,
// in a second picture. It is the strip's FALLBACK now: `openMovement` needs two scans a week
// apart, and a register that does not have them keeps this block as the only breakdown of its
// open backlog. Which of the two is on screen is a real decision with a real wrong answer, so
// it lives on the view and is pinned here, perturbation included.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import {
  coldShareView, executiveByDomainView, executiveHeroView, executiveSeverityView,
} from "../src/client/js/pages/executive.js";

// The DOM half is swept as source text, the house pattern for a tree with no jsdom, and
// comment-stripped through `code()` because this page's prose quotes the calls it removed.
const EXEC_SRC = readFileSync(
  new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8",
);

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

// =========================================================================================
//  coldShareView — one number, and the three things that can make it not be one
// =========================================================================================
//
// The Executive's cold-backlog card reads a `ColdZoneHeadline` (src/domain/coldZone.ts): the
// totals and the clock, never the per-asset or per-group arrays. Three states a payload can
// legitimately arrive in, and each renders differently:
//
//   measurable        the share, with the pair behind it and a sentence naming the mode.
//   not measurable    a notice. No flat scan on record means there is no clock to measure
//                     idleness against — an absence, not a failure.
//   null share        the muted dash. "No asset has an open finding" is not "0.0% of the
//                     backlog is cold", and the second one reads as a clean bill of health.
//
// And a fourth thing that is not a state of the data at all: WHICH CLOCK dated the figure.
// The server publishes `coldZoneAsOfSource`, and "wallClock" means the number moves every time
// the page is reopened rather than when the estate does — so the card says so.

const headline = (over = {}) => ({
  coldZone: {
    measurable: true,
    mode: "fixed",
    cold_after_days: 90,
    fixed_after_days: 90,
    target_share_pct: null,
    achieved_share_pct: 20,
    floor_days: null,
    floor_applied: false,
    derived_days: null,
    eligible_assets: 10,
    cold_bound_only: 0,
    observed_from: "2026-01-01T00:00:00.000Z",
    as_of: "2026-06-01T00:00:00.000Z",
    totals: {
      assets: 40,
      assets_with_open: 10,
      cold_assets: 2,
      open_findings: 500,
      open_in_cold: 157,
      cold_backlog_share_pct: 31.4,
    },
    row_count: 900,
    dropped_no_asset: 0,
    unclassified_rows: 0,
    severities_without_scan: [],
    ...over,
  },
  coldZoneAsOfSource: "scan",
});

describe("coldShareView — the measurable case", () => {
  it("publishes the share and the pair it was taken over", () => {
    const v = coldShareView(headline());
    expect(v.show).toBe(true);
    expect(v.measurable).toBe(true);
    expect(v.pct).toBe(31.4);
    expect(v.openInCold).toBe(157);
    expect(v.openFindings).toBe(500);
    expect(v.coldAssets).toBe(2);
    expect(v.assetsWithOpen).toBe(10);
    expect(v.coldAfterDays).toBe(90);
  });

  it("never carries the per-asset or per-group arrays — that is the point of the slice", () => {
    const v = coldShareView(headline());
    expect(v.assets).toBeUndefined();
    expect(v.groups).toBeUndefined();
  });
});

describe("coldShareView — the shape decides, never the flag", () => {
  it("refuses a payload that claims measurable over a null totals", () => {
    const v = coldShareView(headline({ totals: null }));
    expect(v.show).toBe(false);
    expect(v.measurable).toBe(false);
    // The threshold still rides along: a reader asking "cold after how long?" is asking about
    // the setting, not about the data.
    expect(v.coldAfterDays).toBe(90);
  });

  // PERTURBATION: the flag check this view replaces would have passed that same payload, and
  // the renderer would then have read `.open_in_cold` off null.
  it("the tempting flag check passes the payload that would throw", () => {
    const p = headline({ totals: null });
    expect(p.coldZone.measurable).toBe(true);
    expect(() => p.coldZone.totals.open_in_cold).toThrow();
  });

  it("answers on a payload with no cold-zone block at all rather than throwing", () => {
    for (const payload of [null, undefined, {}, [], 7]) {
      const v = coldShareView(payload);
      expect(v.show).toBe(false);
      expect(v.pct).toBeNull();
      expect(v.openFindings).toBe(0);
    }
  });

  // THE SHAPE THE SERVER SHIPS WHEN THE COLD COMPUTE FAILED. `getExecutivePage` guards its cold
  // slice and sends `{ coldZone: null, coldZoneAsOfSource: null }` rather than letting a Drive
  // service error take the whole landing page down (test/coldZoneServer.test.ts). That is only a
  // degradation while THIS renders it as the absence notice — a throw in here would put the red
  // box back, one layer further down.
  it("renders an explicitly null cold zone as the absence, not as a failure", () => {
    const v = coldShareView({ coldZone: null, coldZoneAsOfSource: null });
    expect(v.show).toBe(false);
    expect(v.measurable).toBe(false);
    expect(v.pct).toBeNull();
    expect(v.openFindings).toBe(0);
    expect(v.coldAfterDays).toBeNull();
    // A null source is not the server SAYING it fell back to the wall clock.
    expect(v.atLedgerClock).toBe(true);
  });

  it("survives the rest of the page's slices arriving alongside a null cold zone", () => {
    const v = coldShareView({ coldZone: null, coldZoneAsOfSource: null, mttr: {}, byDomain: [] });
    expect(v.show).toBe(false);
    expect(v.mode).toBe("fixed");
  });
});

describe("coldShareView — a null share is an answer and it is not zero", () => {
  it("keeps a null cold_backlog_share_pct null", () => {
    const v = coldShareView(headline({
      totals: {
        assets: 4, assets_with_open: 0, cold_assets: 0,
        open_findings: 0, open_in_cold: 0, cold_backlog_share_pct: null,
      },
    }));
    expect(v.show).toBe(true);
    expect(v.pct).toBeNull();
  });

  it("Number(null) — the cast this refusal replaces — would have printed 0.0%", () => {
    expect(Number(null)).toBe(0);
  });
});

describe("coldShareView — the mode is the exact word or it is fixed", () => {
  it("reads only the literal \"relative\" as relative, and carries its two clauses", () => {
    const v = coldShareView(headline({
      mode: "relative", target_share_pct: 20, floor_days: 14, derived_days: 47,
      cold_after_days: 47, floor_applied: false,
    }));
    expect(v.mode).toBe("relative");
    expect(v.targetSharePct).toBe(20);
    expect(v.derivedDays).toBe(47);
    expect(v.floorApplied).toBe(false);
    for (const mode of ["Relative", "RELATIVE", 1, null]) {
      expect(coldShareView(headline({ mode })).mode, String(mode)).toBe("fixed");
    }
  });

  it("carries floor_applied only when the payload literally says true", () => {
    expect(coldShareView(headline({ floor_applied: true })).floorApplied).toBe(true);
    expect(coldShareView(headline({ floor_applied: "yes" })).floorApplied).toBe(false);
  });
});

describe("coldShareView — which clock dated the figure", () => {
  it("is the ledger clock unless the server SAID it fell back", () => {
    expect(coldShareView(headline()).atLedgerClock).toBe(true);
    const older = headline();
    delete older.coldZoneAsOfSource;
    expect(coldShareView(older).atLedgerClock).toBe(true);
  });

  it("is false on wallClock, in the measurable and the not-measurable branch alike", () => {
    const measurable = { ...headline(), coldZoneAsOfSource: "wallClock" };
    expect(coldShareView(measurable).atLedgerClock).toBe(false);
    const absentBlock = { ...headline({ totals: null }), coldZoneAsOfSource: "wallClock" };
    expect(coldShareView(absentBlock).atLedgerClock).toBe(false);
  });
});

// =========================================================================================
//  The card itself, read as source — the two things a pure function cannot hold
// =========================================================================================
//
// There is no jsdom here, so the render half is swept as text the way test/coldZoneDom.test.js
// and test/historyDom.test.js do: what the card refuses to print, and where its cross-reference
// points. A link to the wrong route is the kind of defect every unit test passes.

describe("the cold-zone card's render half", () => {
  const SRC = readFileSync(
    new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8",
  );

  it("points its cross-reference at the Cold zone route", () => {
    expect(SRC).toContain('el("a", { class: "linklike", href: "#/coldZone" }, "Cold zone")');
    expect(SRC).toContain("Which assets, and which support groups");
  });

  it("draws the absence as a notice rather than an error", () => {
    const at = SRC.indexOf("function renderColdShare");
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf("by domain", at));
    expect(body).toContain('variant: "notice"');
    expect(body).not.toContain("errorState(");
  });

  it("prints the muted dash rather than a percentage when the share is null", () => {
    const at = SRC.indexOf("function renderColdShare");
    const body = SRC.slice(at, SRC.indexOf("by domain", at));
    expect(body).toContain("view.pct === null ? absentText : pct1(view.pct)");
  });

  it("names the wall clock's consequence rather than only its name", () => {
    expect(SRC).toContain("moves as the page is reopened");
  });

  it("labels the figure and takes its definition from the book", () => {
    expect(SRC).toContain('label: "Backlog in the cold zone"');
    expect(SRC).toContain('sectionLabel("The cold zone", { term: "cold-zone" })');
  });
});

// =========================================================================================
//  The severity block is the movement strip's FALLBACK, not its second copy
// =========================================================================================

/**
 * A comparable `movementOpen` block, in the shape `insights.openMovement` publishes — two
 * endpoints a week apart, a row per severity, a total that the rows sum to.
 */
const COMPARABLE = {
  comparable: true,
  reason: null,
  since: "2026-09-09T00:00:00Z",
  until: "2026-09-16T00:00:00Z",
  gapDays: 7,
  rows: [
    { severity: "CRITICAL", open: 27, prevOpen: 29, delta: -2 },
    { severity: "HIGH", open: 39, prevOpen: 46, delta: -7 },
  ],
  total: { open: 70, prevOpen: 79, delta: -9 },
};

describe("executiveSeverityView — the movement strip supersedes it when it can be drawn", () => {
  it("withholds the whole block when the movement comparison exists", () => {
    const v = sevView({ movement: COMPARABLE });
    expect(v.show).toBe(false);
    expect(v.supersededBy).toBe("movement");
    // NOT "empty tiles and let the renderer work it out": `show` is the decision, and the
    // tiles are absent because there is no block, not because the register has no findings.
    expect(v.tiles).toEqual([]);
    expect(v.populationLine).toBeNull();
  });

  // The three refusals `openMovement` can publish. Each one is a register the strip cannot
  // describe, and every one of them is a register whose severity split still exists.
  for (const reason of ["noScan", "oneScan", "tooClose"]) {
    it(`draws the block when the comparison is refused with \`${reason}\``, () => {
      const v = sevView({ movement: { comparable: false, reason, rows: [], gapDays: 4 } });
      expect(v.show).toBe(true);
      expect(values(v)).toEqual({ CRITICAL: "12", HIGH: "340", MEDIUM: "1,200", LOW: "7" });
    });
  }

  it("draws the block when handed no movement at all, so an older payload keeps it", () => {
    // `movement` undefined means NOT COMPARABLE, not "assume it is". A payload shape that
    // predates the block — or a caller that simply does not pass one — must keep the severity
    // split rather than silently lose the only severity statement on the page.
    expect(sevView().show).toBe(true);
    expect(sevView({ movement: null }).show).toBe(true);
    expect(sevView({ movement: {} }).show).toBe(true);
  });

  // PERTURBATION. The tempting implementation is "does the movement block have any rows?",
  // which reads the evidence instead of the decision. `insights.openMovement` publishes
  // `comparable` and empties `rows` on every refusal, so the two agree TODAY and the shortcut
  // passes every test above — until something publishes rows alongside a refusal, at which
  // point the shortcut deletes the page's only severity statement and the honest read does
  // not. Reproduced inline so this is a measurement rather than a restatement of the rule.
  it("PERTURBATION: reading `rows.length` instead of the decision suppresses a refusal", () => {
    const refusedWithRows = { comparable: false, reason: "tooClose", rows: COMPARABLE.rows };
    const byRows = (m) => Boolean(m && Array.isArray(m.rows) && m.rows.length);
    expect(byRows(refusedWithRows)).toBe(true);        // the shortcut hides the block
    expect(sevView({ movement: refusedWithRows }).show).toBe(true); // the shipped rule keeps it
  });

  it("supersession outranks every other branch, scoped and pending alike", () => {
    // A scoped view with no payload yet would otherwise return `pending: true` and paint a
    // skeleton. A skeleton for a block that is not going to exist is the flash the page
    // dropped its early paint to avoid.
    const v = sevView({ scoped: true, payload: null, movement: COMPARABLE });
    expect(v.show).toBe(false);
    expect(v.pending).toBe(false);
  });
});

describe("os: the page hands the severity view its movement, and paints it no earlier", () => {
  it("passes `movement` off the same payload the strip is drawn from", () => {
    expect(EXEC_SRC).toMatch(/movement: data && data\.movement,/);
  });

  it("no longer paints the block from bootstrap before the payload lands", () => {
    // The early paint could not survive the fallback: whether the block belongs is a question
    // about the payload, and answering it from bootstrap would be a second copy of
    // `insights.openMovement`'s own rule. The call is gone, not merely moved.
    expect(code(EXEC_SRC)).not.toContain("renderSeverity(null)");
    expect(code(EXEC_SRC)).toMatch(/guard\("open findings by severity", sevHost, \(\) => renderSeverity\(payload\)\)/);
  });

  it("drops the scoped error box that existed only to replace that early paint", () => {
    expect(code(EXEC_SRC)).not.toContain("Couldn't load counts for this scope.");
    // The page's ONE failure statement is still the hero's, with the retry on it.
    expect(code(EXEC_SRC)).toContain("Couldn't load remediation data.");
  });
});
