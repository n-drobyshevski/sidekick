// What the compliance trend CLAIMS — the DOM-free half of the card that replaced the
// four-segment state bar in the Compliance header.
//
// Tested the way `postureScopeView` is, and for the same reason: the card is a dozen `el()`
// calls, but WHICH of four things it says is a decision, and every one of those decisions is
// a place this page could quietly mislead. Three are pinned here.
//
//   1. TWO POINTS IS A TREND, ONE IS A READING. A single dot on a time axis invites a slope
//      that is not there, and the reason there is no chart has to be the honest one — "wait
//      for the next sync" and "this framework has never been scored" are different problems
//      with different fixes.
//   2. THE DENOMINATOR TRAVELS WITH THE PERCENTAGE. A framework percentage is a share of the
//      subcategories Wiz scored; the unscored ones are left out rather than counted as
//      failures. So a line that climbs because the landscape improved and one that climbs
//      because scoring narrowed draw identically, and only `scored of subcategories` on each
//      point tells them apart.
//   3. THE SERIES IS REGISTER-WIDE EVEN WHEN THE PAGE IS NOT. Every other figure on this
//      page re-scopes to the project in view — the server re-asks Wiz for it — but the past
//      cannot be re-asked, and a history row carries no asset id. A chart drawing the whole
//      register under a project filter, with nothing saying so, is the one reading this page
//      exists to prevent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  baselineNote,
  complianceTrendView,
  coverageFoot,
  coverageNotes,
  coverageText,
  frameworkSeries,
  landscapeSeries,
  LANDSCAPE_KEY,
  percentRange,
  trendScopeNote,
} from "../src/client/js/complianceTrendModel.js";

const point = (at, counts, coverage) => ({ at, counts, coverage });

const landscape = (at, pct, scored, subs, frameworks) => point(
  at,
  { [LANDSCAPE_KEY]: pct },
  { [LANDSCAPE_KEY]: { scored, subcategories: subs, scoredFrameworks: frameworks } },
);

const framework = (at, pct, scored, subs) => point(
  at, { "wf-a": pct }, { "wf-a": { scored, subcategories: subs } },
);

describe("the LANDSCAPE_KEY mirror", () => {
  it("is the string the domain actually writes", () => {
    // A HAND-KEPT MIRROR, held by reading both. The client bundle cannot import the domain
    // layer (see getCompliance's own note), so this constant is restated here — and a
    // rename on the server side with no matching rename here would leave the Overview's
    // chart silently empty, which looks exactly like a landscape nobody has scored.
    const src = readFileSync(
      fileURLToPath(new URL("../src/domain/complianceTrend.ts", import.meta.url)), "utf8",
    );
    const match = /export const LANDSCAPE_KEY = "([^"]+)"/.exec(src);
    expect(match, "domain/complianceTrend.ts no longer declares LANDSCAPE_KEY").toBeTruthy();
    expect(LANDSCAPE_KEY).toBe(match[1]);
  });
});

describe("percentRange", () => {
  const at = (...pcts) => pcts.map((pct, i) => framework(`2026-09-0${i + 1}T00:00:00.000Z`, pct, 4, 5));
  const series = frameworkSeries("wf-a", "A");

  it("FITS THE DATA rather than running from zero — the whole point", () => {
    // 0-100 puts every one of these points in the top sixth of the card and draws the
    // eleven-point slide between them as a few pixels. This is the regression the option
    // exists for, so it is the first assertion.
    const range = percentRange(at(96, 94, 85), series);
    expect(range.min).toBeGreaterThan(0);
    expect(range.min).toBeLessThanOrEqual(85);
    expect(range.max).toBeGreaterThanOrEqual(96);
  });

  it("REFUSES to magnify a flat line into a collapse", () => {
    // The opposite failure, and the worse one: Chart.js's own auto-fit would give a line
    // wobbling between 94 and 95 the full height of the card. A floor of 10 points draws a
    // one-point move as a tenth of the card, which is what a one-point move is.
    const range = percentRange(at(94, 95, 94), series);
    expect(range.max - range.min).toBeGreaterThanOrEqual(10);
  });

  it("holds the floor for a dead-flat series too", () => {
    const range = percentRange(at(94, 94, 94), series);
    expect(range.max - range.min).toBeGreaterThanOrEqual(10);
    expect(range.min).toBeLessThan(94);
    expect(range.max).toBeGreaterThan(94);
  });

  it("never claims more than 100% or less than 0%", () => {
    // A framework at 100 is the case where padding would run off the top, and where the
    // clamp eats the span back below the floor and has to be given back at the other end.
    const perfect = percentRange(at(100, 100), series);
    expect(perfect.max).toBe(100);
    expect(perfect.max - perfect.min).toBeGreaterThanOrEqual(10);

    const floorCase = percentRange(at(0, 2), series);
    expect(floorCase.min).toBe(0);
    expect(floorCase.max).toBeLessThanOrEqual(100);
    expect(floorCase.max - floorCase.min).toBeGreaterThanOrEqual(10);
  });

  it("keeps the data off the frame, and snaps the ticks to round numbers", () => {
    const range = percentRange(at(85, 100), series);
    expect(range.min).toBeLessThan(85);
    expect(range.min % 5).toBe(0);
    expect(range.max % 5).toBe(0);
  });

  it("ignores the points a series has no reading at", () => {
    // A gap must not drag the window to zero — that is the same "absent is not zero" the
    // line itself breaks for, one layer up.
    const range = percentRange(
      [framework("2026-09-01T00:00:00.000Z", 94, 4, 5), point("2026-09-02T00:00:00.000Z", { "wf-a": null }, {})],
      series,
    );
    expect(range.min).toBeGreaterThan(0);
  });

  it("falls back to the full range when there is nothing to fit", () => {
    expect(percentRange([], series)).toEqual({ min: 0, max: 100 });
  });
});

describe("baselineNote", () => {
  it("DISCLOSES a truncated axis — the sentence that makes it legitimate", () => {
    // A y axis that does not start at zero exaggerates everything drawn on it. That is the
    // right instrument here and the standard way to mislead, and the only thing separating
    // the two is saying so on the chart.
    const note = baselineNote({ min: 85, max: 100 });
    expect(note).toContain("85%–100%");
    expect(note).toContain("not from zero");
  });

  it("says nothing when the axis really does start at zero", () => {
    expect(baselineNote({ min: 0, max: 100 })).toBeNull();
  });
});

describe("coverageText", () => {
  it("states the pair, and the frameworks the mean averaged where there is one", () => {
    expect(coverageText({ scored: 12, subcategories: 20 }))
      .toBe("12 of 20 subcategories scored");
    expect(coverageText({ scored: 6, subcategories: 7, scoredFrameworks: 2 }))
      .toBe("Mean of 2 scored frameworks, 6 of 7 subcategories scored");
  });

  it("singularises rather than printing '1 frameworks'", () => {
    expect(coverageText({ scored: 1, subcategories: 1, scoredFrameworks: 1 }))
      .toBe("Mean of 1 scored framework, 1 of 1 subcategory scored");
  });

  it("refuses a point with no denominator rather than printing 'of 0'", () => {
    expect(coverageText(null)).toBeNull();
    expect(coverageText({ scored: 0, subcategories: 0 })).toBeNull();
  });
});

describe("coverageNotes", () => {
  it("says so on a point that recorded no coverage, rather than leaving the card bare", () => {
    const notes = coverageNotes(
      [framework("2026-09-01T00:00:00.000Z", 80, 4, 5), point("2026-09-02T00:00:00.000Z", {}, {})],
      "wf-a",
    );
    expect(notes).toEqual(["4 of 5 subcategories scored", "Coverage not recorded"]);
  });
});

describe("coverageFoot", () => {
  it("names the latest reading and says the denominator held still", () => {
    const foot = coverageFoot([
      framework("2026-09-01T00:00:00.000Z", 80, 4, 5),
      framework("2026-09-02T00:00:00.000Z", 90, 5, 5),
    ], "wf-a");
    expect(foot).toContain("Latest sync: 5 of 5 subcategories scored");
    expect(foot).toContain("did not move across this window");
  });

  it("WARNS when the denominator moved — the one way this line can lie", () => {
    // 4/5 at 80% then 4/4 at 100% is not a twenty-point improvement; it is Wiz reporting one
    // fewer subcategory. Nothing on the line shows that, so the caption has to.
    const foot = coverageFoot([
      framework("2026-09-01T00:00:00.000Z", 80, 4, 5),
      framework("2026-09-02T00:00:00.000Z", 100, 4, 4),
    ], "wf-a");
    expect(foot).toContain("between 4 and 5 subcategories");
    expect(foot).toContain("not shares of the same thing");
  });

  it("says plainly that nothing recorded a denominator, rather than implying one", () => {
    const foot = coverageFoot([point("2026-09-01T00:00:00.000Z", { "wf-a": 80 }, {})], "wf-a");
    expect(foot).toContain("cannot be told apart from a change in what was measured");
  });
});

describe("trendScopeNote", () => {
  it("says nothing on a register-wide view — a permanent badge is noise, not honesty", () => {
    expect(trendScopeNote(null)).toBeNull();
    expect(trendScopeNote({})).toBeNull();
    expect(trendScopeNote({ projectId: "", domainId: "" })).toBeNull();
  });

  it("declares the series register-wide under a project, and says why", () => {
    const note = trendScopeNote({ projectId: "p-a" });
    expect(note).toContain("whole register's history");
    expect(note).toContain("history cannot be re-asked");
  });

  it("declares it under a domain too, where nothing re-scopes at all", () => {
    expect(trendScopeNote({ domainId: "d-a" })).toContain("whole register's history");
  });
});

describe("complianceTrendView", () => {
  const series = frameworkSeries("wf-a", "OWASP Agentic");
  const two = [
    framework("2026-09-01T00:00:00.000Z", 80, 4, 5),
    framework("2026-09-02T00:00:00.000Z", 90, 5, 5),
  ];

  it("draws from two points, and names the series for the framework", () => {
    const view = complianceTrendView({ points: two, series });
    expect(view.draw).toBe(true);
    expect(view.series.map((s) => s.label)).toEqual(["OWASP Agentic"]);
    expect(view.notes).toHaveLength(2);
    expect(view.foot).toContain("Latest sync");
  });

  it("refuses one point, and says the line draws from the second", () => {
    const view = complianceTrendView({ points: two.slice(0, 1), series });
    expect(view.draw).toBe(false);
    expect(view.reason).toContain("draws from the second");
  });

  it("refuses an empty window with the reason that actually applies", () => {
    // "Nothing has been recorded" and "recorded, but not for this framework" are different
    // facts with different fixes, and a single empty box would say neither.
    expect(complianceTrendView({ points: [], series }).reason)
      .toContain("recorded compliance posture yet");
    // Named, so the reader standing in front of one framework is told it is THAT one that
    // has never been scored, not the register.
    expect(complianceTrendView({ points: two, series: frameworkSeries("wf-z", "ISO 42001") }).reason)
      .toBe("No sync in this window recorded a percentage for ISO 42001.");
  });

  it("flags a broken line rather than letting a gap read as a collapse", () => {
    const view = complianceTrendView({
      points: [
        framework("2026-09-01T00:00:00.000Z", 80, 4, 5),
        point("2026-09-02T00:00:00.000Z", { "wf-a": null }, {}),
        framework("2026-09-03T00:00:00.000Z", 90, 5, 5),
      ],
      series,
    });
    expect(view.draw).toBe(true);
    expect(view.gappy).toBe(true);
  });

  it("draws the landscape mean under its own key", () => {
    const view = complianceTrendView({
      points: [
        landscape("2026-09-01T00:00:00.000Z", 90, 6, 7, 2),
        landscape("2026-09-02T00:00:00.000Z", 95, 7, 7, 2),
      ],
      series: landscapeSeries(),
    });
    expect(view.draw).toBe(true);
    expect(view.series[0].key).toBe(LANDSCAPE_KEY);
    expect(view.notes[0]).toContain("Mean of 2 scored frameworks");
  });

  it("carries the fitted window and its disclosure, so the axis and the caption agree", () => {
    const view = complianceTrendView({ points: two, series });
    expect(view.range).toEqual(percentRange(two, series));
    expect(view.baseline).toContain(`${view.range.min}%`);
  });

  it("fits the window to the series actually DRAWN, not the ones asked for", () => {
    // A framework with no reading in this window is dropped from `series`; letting it widen
    // the axis it is absent from would flatten the line that is there.
    const view = complianceTrendView({
      points: two,
      series: [...series, { key: "wf-absent", label: "Absent", color: "#000" }],
    });
    expect(view.series).toHaveLength(1);
    expect(view.range).toEqual(percentRange(two, series));
  });

  it("publishes no baseline where there is no chart to qualify", () => {
    expect(complianceTrendView({ points: [], series }).baseline).toBeNull();
  });

  it("carries the scope note through so the card cannot forget it", () => {
    const view = complianceTrendView({ points: two, series, postureScope: { projectId: "p-a" } });
    expect(view.scopeNote).toContain("whole register's history");
  });
});
