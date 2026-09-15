// Executive's two new blocks, held at the half that can be WRONG.
//
// Ported from gas_devsecops/test/executiveFixNext.test.js and re-pointed at THIS register's
// payload: `fixNext` here groups by (tier, owner) where an owner is a support group or a
// subscription — never a repository — and its unranked accounting has four reasons whose
// names differ from the sibling's (`unclassified` where that one has `unvalidated`, because
// this register's gap is a risk signal nobody captured rather than a credential nobody
// confirmed). A verbatim port would have passed against fields this server does not send.
//
// There is no jsdom here (vitest.config.ts sets no `environment`), so the pure/DOM split every
// page file in this tree makes is what makes this testable: `fixNextView`, `openMovementView`
// and `deltaChipView` decide, `renderFixNext` and `renderMovement` draw. The decisions are all
// below; the drawing is checked as SOURCE TEXT, the same way figures.test.js does it.
//
// THE ONE STRUCTURAL CLAIM THIS FILE ADDS is that the front door still draws no canvas. The
// page's whole payload shape (`execMttrSlice` ships two scalars, not a curve) rests on it, and
// a ranked list is exactly the kind of block somebody would later reach for a bar chart to
// draw. Chart.js is ~170 KB fetched over `google.script.run` on the first route that draws
// one; the landing page is the one route that must never pay for it.
//
// Plain .js for the reason executiveView.test.js writes out: tsconfig has no allowJs, so a
// .ts test importing a client .js module fails `tsc --noEmit` and `npm run check` would never
// reach vitest.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  deltaChipView, executiveFirstRunView, fixNextQuery, fixNextView, openMovementView,
} from "../src/client/js/pages/executive.js";

const SRC = readFileSync(
  new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8",
);

// --------------------------------------------------------------------------- payloads

/** Enough of `api_getExecutivePage` to make the register look read. */
function payload(over) {
  return {
    mttr: {
      rowCount: 554,
      overall: { resolved: 138, open: 416 },
      remediation: { km: { median: null, medianLowerBound: 293.9 } },
    },
    severityCounts: { flatScan: true, counts: { CRITICAL: 15 }, total: 15 },
    byDomain: { dimension: "domain", rows: [] },
    weekTrend: null,
    ...over,
  };
}

/** `src/domain/fixNext.ts`'s own result shape, field for field. */
function fixNextBlock(over) {
  return {
    groups: [
      {
        tier: 1,
        label: "Known exploited, reachable",
        owner: "CS-CORE-PLATFORM",
        ownerKind: "supportGroup",
        domain: "Payments",
        count: 11,
        assets: 4,
        topCve: { cve: "CVE-2024-3094", count: 5 },
        oldestAgeDays: 412.3,
        route: "overview",
        params: { supportGroup: "CS-CORE-PLATFORM", tier: 1 },
      },
      {
        tier: 2,
        label: "Exploitable and late",
        owner: null,
        ownerKind: null,
        domain: null,
        count: 3,
        assets: 0,
        topCve: null,
        oldestAgeDays: null,
        route: "overview",
        params: { tier: 2 },
      },
    ],
    tiers: { 1: 11, 2: 3, 3: 0 },
    unranked: { noFix: 30, unclassified: 2, insideSla: 33, other: 23 },
    ranked: 25,
    openTotal: 113,
    groupsTotal: 2,
    groupsCut: 0,
    findingsCut: 0,
    limit: 8,
    exposureKnown: true,
    asOf: 0,
    ...over,
  };
}

// ------------------------------------------------------------------------- delta chip

describe("os: deltaChipView", () => {
  it("calls a rising count up, and a rising count is the bad one", () => {
    const chip = deltaChipView(320, 280);
    expect(chip.direction).toBe("up");
    expect(chip.kind).toBe("bad");
    expect(chip.delta).toBe(40);
    expect(chip.pct).toBe(14);
    // THE WORD IS IN THE VISIBLE TEXT, not only in the aria-label. The pill's tint and its ▲
    // are both cues a reader may not resolve; "up 40" is the one that always lands.
    expect(chip.text).toBe("up 40 · 14%");
    expect(chip.aria).toMatch(/^up 40, 14 percent/);
    expect(chip.aria).toMatch(/backlog grew/);
  });

  it("calls a falling count down, and spells the direction in words", () => {
    const chip = deltaChipView(280, 320);
    expect(chip.direction).toBe("down");
    expect(chip.kind).toBe("ok");
    expect(chip.delta).toBe(-40);
    expect(chip.text).toBe("down 40 · 13%");
    expect(chip.aria).toMatch(/^down 40/);
    expect(chip.aria).toMatch(/backlog shrank/);
  });

  it("says unchanged rather than drawing a direction that is not there", () => {
    const chip = deltaChipView(280, 280);
    expect(chip.direction).toBe("flat");
    expect(chip.text).toBe("unchanged");
    expect(chip.aria).toBe("unchanged");
    expect(chip.pct).toBeNull();
  });

  // `Number(null)` is 0 and 0 is finite, so a naive cast would turn "never measured" into
  // "unchanged" — a confident zero over a comparison nobody made. `num()` refuses null BEFORE
  // the cast, and this view returns null so nothing draws.
  it("draws NO chip at all when there is no previous value", () => {
    expect(deltaChipView(280, null)).toBeNull();
    expect(deltaChipView(280, undefined)).toBeNull();
    expect(deltaChipView(280, "")).toBeNull();
    expect(deltaChipView(null, 280)).toBeNull();
  });

  it("never prints a 0 % beside a non-zero change", () => {
    const fromZero = deltaChipView(5, 0);
    expect(fromZero.direction).toBe("up");
    expect(fromZero.pct).toBeNull();
    expect(fromZero.text).toBe("up 5");

    const tiny = deltaChipView(1001, 1000);
    expect(tiny.pct).toBeNull();
    expect(tiny.text).toBe("up 1");
  });
});

// -------------------------------------------------------------------------- movement

describe("os: openMovementView", () => {
  const comparable = {
    comparable: true,
    reason: null,
    since: "2026-06-01T20:00:00.000Z",
    until: "2026-06-15T08:00:00.000Z",
    gapDays: 13.5,
    rows: [
      { severity: "CRITICAL", open: 4, prevOpen: 3, delta: 1 },
      { severity: "HIGH", open: 27, prevOpen: 36, delta: -9 },
      { severity: "MEDIUM", open: 82, prevOpen: 82, delta: 0 },
    ],
    total: { open: 113, prevOpen: 121, delta: -8 },
  };

  it("gives every severity a pill and states the two dates compared", () => {
    const view = openMovementView(comparable);
    expect(view.show).toBe(true);
    // The payload's own order, which is SEVERITY_ORDER — worst first. Re-sorting it here
    // would put LOW above CRITICAL on a strip whose whole job is the shape of the backlog.
    expect(view.rows.map((r) => r.severity)).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
    expect(view.rows[0].chip.direction).toBe("up");
    expect(view.rows[1].chip.direction).toBe("down");
    expect(view.rows[2].chip.direction).toBe("flat");
    expect(view.total.label).toBe("All severities");
    expect(view.total.chip.direction).toBe("down");
    // The interval is part of the figure, not a footnote: "down 8" over an unnamed window is
    // not a measurement.
    expect(view.dates).toMatch(/^Between the scans on /);
    // WORDED WHOLE DAYS, because this is a sentence. P1.1 set the grain by context — prose
    // takes `fmtDays`, a table cell takes `days1` — and "13.5 d apart" mid-sentence reads as
    // a cell that escaped its table. The rounding this costs is asserted rather than glossed:
    // `fmtDays` rounds a 13.5-day interval to "14 days", and the exact figure stays on the
    // model where a caller (and Scan History) can still reach it.
    expect(view.dates).toMatch(/14 days apart/);
    expect(view.dates).not.toContain("13.5");
    expect(view.gapDays).toBe(13.5);
  });

  it("spells each pill's direction in words, never in the glyph alone", () => {
    const view = openMovementView(comparable);
    expect(view.rows.map((r) => r.chip.text)).toEqual(["up 1 · 33%", "down 9 · 25%", "unchanged"]);
  });

  it("refuses with the actual gap when the scans are too close together", () => {
    const view = openMovementView({
      comparable: false, reason: "tooClose", since: null,
      until: "2026-06-04T08:00:00.000Z", gapDays: 3, rows: [],
      total: { open: 0, prevOpen: 0, delta: 0 },
    });
    expect(view.show).toBe(false);
    expect(view.reason).toMatch(/too close together/);
    expect(view.reason).toMatch(/3 days apart/);
    expect(view.reason).not.toContain("3.0 d");
    expect(view.reason).toMatch(/a week is the minimum/);
    expect(view.gapDays).toBe(3);
  });

  it("says `one scan only` and does not reach for a number to put beside it", () => {
    const view = openMovementView({
      comparable: false, reason: "oneScan", since: null, until: "x", gapDays: null,
      rows: [], total: { open: 0, prevOpen: 0, delta: 0 },
    });
    expect(view.show).toBe(false);
    expect(view.reason).toMatch(/One scan only/);
    // NO SPAN SENTENCE. `openMovement` publishes `gapDays` only on `tooClose`; inventing one
    // here would be a measurement of an interval the server declined to name.
    expect(view.reason).not.toMatch(/apart/);
    expect(view.gapDays).toBeNull();
  });

  it("treats a missing block as `no scan`, never as a comparison against zero", () => {
    expect(openMovementView(null).show).toBe(false);
    expect(openMovementView(null).reason).toMatch(/No scan has saved a population yet/);
    expect(openMovementView(undefined).reason).toMatch(/No scan has saved a population yet/);
  });

  it("dates the sentence only when the comparison is comparable", () => {
    expect(openMovementView({ comparable: false, reason: "noScan" }).dates).toBeUndefined();
    expect(openMovementView(comparable).dates).toContain("Between the scans on");
  });
});

// -------------------------------------------------------------------------- fix next

describe("os: fixNextView", () => {
  const view = fixNextView(payload({ fixNext: fixNextBlock() }), null);

  it("lists the groups in the order it was sent, with units on every figure", () => {
    expect(view.show).toBe(true);
    expect(view.items.length).toBe(2);
    const first = view.items[0];
    expect(first.rank).toBe(1);
    expect(first.tierLabel).toBe("Known exploited, reachable");
    // A pill kind, not a bare colour name — and the tier's own words carry the meaning.
    expect(first.kind).toBe("bad");
    expect(view.items[1].kind).toBe("warn");
    expect(first.ownerText).toBe("CS-CORE-PLATFORM");
    expect(first.ownerKindWord).toBe(" · support group");
    // EVERY FIGURE CARRIES ITS UNIT, ONCE. "11" is not a figure; "11 open findings" is, and
    // the hosts, the CVE and the age each keep their own noun — but "on" (stitching the finding
    // count to the host count) and "mostly" (a hedge word on the CVE clause) are both gone, so
    // the density walker's 15-word prose threshold has real headroom rather than the line
    // riding right up against it. The CVE's own count is NOT dropped to buy that shorter form —
    // "which CVE" and "how much of the group is it" are two different facts.
    expect(first.meta).toBe(
      "11 open findings · 4 hosts · CVE-2024-3094 (5) · oldest 412 days · domain Payments",
    );
  });

  // THE GRAIN IS A PROPERTY OF THE CONTEXT, not of the figure, and this sweep is what keeps
  // it that way as clauses are added. `days1`'s "N.N d" belongs in a table cell; every string
  // this view hands to a running sentence takes `fmtDays`'s worded whole days.
  it("puts no table-cell duration grain into any sentence it builds", () => {
    const sentences = [
      ...view.items.map((i) => i.meta),
      view.unrankedSentence,
      view.rankedShort,
      view.linkNote,
      view.emptyReason,
      openMovementView({
        comparable: true, reason: null, since: "2026-06-01T20:00:00.000Z",
        until: "2026-06-15T08:00:00.000Z", gapDays: 13.5, rows: [],
        total: { open: 1, prevOpen: 1, delta: 0 },
      }).dates,
      openMovementView({
        comparable: false, reason: "tooClose", since: null, until: "x", gapDays: 3.4, rows: [],
        total: { open: 0, prevOpen: 0, delta: 0 },
      }).reason,
    ].filter(Boolean);
    // ANTI-VACUOUS. A sweep over an empty list is a guard that fires on nothing, and the
    // first draft of THIS test was exactly that in a second way — see the regex below.
    expect(sentences.length).toBeGreaterThan(4);
    for (const sentence of sentences) {
      expect(sentence, `"${sentence}" carries a days1-shaped duration`)
        // `[^0-9]`, NOT \\b, AND THE FIRST DRAFT OF THIS LINE WAS THE BUG
        // `gas_shared/test/contracts/emptyStates.js` RECORDS ABOUT ITSELF. It ended `d\\b`,
        // written through a generator that read `\\b` as the BACKSPACE character (0x08), so
        // the pattern was `/\\d+\\.\\d+ d<BACKSPACE>/` and matched nothing a register can
        // produce. It passed against `oldest 412.3 d` — measured, by perturbing the page
        // back to `days1` and watching only the exact-equality test above fail while this
        // one stayed green. A word boundary is not needed here anyway: the separator is
        // always a space or the end of the clause.
        .not.toMatch(/[0-9]+\.[0-9]+ d(?![a-z])/);
    }
  });

  // THE LINK LANDS ON A SUPERSET OF THE GROUP, NEVER A SUBSET — the one rule this mapping
  // has to keep. A link that lands on fewer rows than the card counted makes the register
  // look like it lost them, and the reader has no way to tell which number is wrong.
  it("links every group at the register, filtered to what its tier MEANS", () => {
    expect(view.items.map((i) => i.href)).toEqual([
      // Tier 1 is `has_kev === true` on a reachable host, with no SLA gate and no fix gate
      // (domain/fixNext.ts's `classify`). `exposed=1` is the only half the register can
      // narrow; the KEV half deliberately is not — see below.
      "#/overview?status=open&exposed=1",
      // Tiers 2 and 3 both require `fix_available_at` present and past SLA. `fix=fixable` is
      // exactly the first; the register has no SLA filter, so the second is left wide.
      "#/overview?status=open&fix=fixable",
    ]);
    expect(view.items[0].linkLabel).toMatch(/Open the OS vulnerabilities register/);
    expect(view.linkNote).toMatch(/filtered to that group's tier/);
    expect(view.linkNote).not.toMatch(/unfiltered/);
    expect(view.linkNote).not.toMatch(/later package wires the filter/);
  });

  it("sends no tier= param, because riskTier and fixNext do not ask the same question", () => {
    // THE MAPPING THAT LOOKS RIGHT AND IS A SUBSET. The register's `tier` filter is
    // `program.riskTier`, which answers "kev" only when the operator's RISK RULE has the KEV
    // clause enabled (`firedSignals` tests `rule.kev && row.has_kev === true`). `fixNext`
    // tier 1 reads `has_kev` directly and asks the rule nothing. With the KEV clause off in
    // Settings, every tier-1 row classifies as exploit / epss / none / unknown and
    // `tier=kev` would land on a table missing all of them.
    for (const href of view.items.map((i) => i.href)) {
      expect(href, href).not.toMatch(/[?&]tier=/);
    }
  });

  it("sends no supportGroup= param — the register never reads one out of the hash", () => {
    // `fixNext.ts` publishes `params.supportGroup` for exactly this link, and the register
    // cannot use it: the support-group scope is `activeSupportGroup` in `app.js`, module
    // state set only by the header switcher. A `supportGroup=` param here would be a key
    // nothing reads — the table would open unscoped while the link claimed otherwise.
    expect(view.items[0].owner).toBe("CS-CORE-PLATFORM");
    expect(view.items[0].ownerKind).toBe("supportGroup");
    for (const href of view.items.map((i) => i.href)) {
      expect(href, href).not.toMatch(/supportGroup/);
    }
  });

  it("the query is a superset of the tier: every filter it sends is a fixNext precondition", () => {
    // Read against `classify` clause by clause. `status=open` is safe on every tier —
    // `fixNext` ranks OPEN rows only (`isOpenStatus` gates the loop).
    const tier1 = new URLSearchParams(view.items[0].href.split("?")[1]);
    expect(tier1.get("status")).toBe("open");
    expect(tier1.get("exposed")).toBe("1");
    expect(tier1.get("fix")).toBeNull();  // tier 1 has NO fix gate: a KEV row on a reachable
    // host ranks whether or not a patch exists, because the action is to take it off the
    // internet. `fix=fixable` here would drop the vendor-blocked half of the tier.

    const tier2 = new URLSearchParams(view.items[1].href.split("?")[1]);
    expect(tier2.get("status")).toBe("open");
    expect(tier2.get("fix")).toBe("fixable");
    expect(tier2.get("exposed")).toBeNull();  // tiers 2 and 3 have no exposure gate.
  });

  it("fixNextQuery answers per tier and nothing else", () => {
    expect(fixNextQuery(1)).toBe("?status=open&exposed=1");
    expect(fixNextQuery(2)).toBe("?status=open&fix=fixable");
    expect(fixNextQuery(3)).toBe("?status=open&fix=fixable");
  });

  // THE FAILURE THIS GUARDS. A dash inside a running sentence reads as punctuation, not as an
  // absence — "3 open findings on — hosts · oldest — d" says nothing true and looks like a
  // render that half-worked. The parts a group does not have are OMITTED.
  it("omits an absent owner, CVE, age and domain rather than dashing any of them", () => {
    const second = view.items[1];
    expect(second.owner).toBeNull();
    expect(second.ownerText).toBe("No owner recorded");
    expect(second.ownerKindWord).toBeNull();
    expect(second.oldestDays).toBeNull();
    expect(second.domain).toBeNull();
    expect(second.topCve).toBeNull();
    expect(second.meta).toBe("3 open findings");
    expect(second.meta).not.toContain("—");
    expect(second.meta).not.toContain("hosts");
  });

  it("accounts for everything it left out, by reason, in one sentence", () => {
    expect(view.unrankedSentence).toMatch(/^25 of 113 open findings are ranked above\./);
    expect(view.unrankedSentence).toContain("30 are waiting on a vendor fix");
    expect(view.unrankedSentence).toContain("33 are inside their SLA window");
    expect(view.unrankedSentence)
      .toContain("2 could not be classified because no risk signal was captured");
    expect(view.unrankedSentence).toContain("23 are past SLA without meeting any tier's bar");
    expect(view.unranked).toEqual({ noFix: 30, unclassified: 2, insideSla: 33, other: 23 });
    expect(view.rankedShort).toBe("25 of 113 open findings ranked");
  });

  // A clause reading "0 could not be classified" is a measurement of an empty bucket dressed
  // as an explanation. The reason is dropped; the reasons with something behind them stay.
  it("never prints a reason whose count is 0", () => {
    const some = fixNextView(payload({
      fixNext: fixNextBlock({ unranked: { noFix: 30, unclassified: 0, insideSla: 58, other: 0 } }),
    }), null);
    expect(some.unrankedSentence).toContain("30 are waiting on a vendor fix");
    expect(some.unrankedSentence).toContain("58 are inside their SLA window");
    expect(some.unrankedSentence).not.toContain("classified");
    expect(some.unrankedSentence).not.toContain("tier's bar");
    expect(some.unrankedSentence).not.toMatch(/\b0 /);
  });

  it("says every open finding earned a tier when nothing at all was left over", () => {
    const none = fixNextView(payload({
      fixNext: fixNextBlock({
        unranked: { noFix: 0, unclassified: 0, insideSla: 0, other: 0 }, ranked: 113,
      }),
    }), null);
    expect(none.unrankedSentence).toMatch(/^113 of 113 open findings are ranked above\./);
    expect(none.unrankedSentence).toMatch(/Nothing is left over/);
    expect(none.unrankedSentence).not.toContain("The rest are not");
  });

  it("says the list is capped when the server cut groups off the end", () => {
    const cut = fixNextView(payload({
      fixNext: fixNextBlock({ groupsTotal: 14, groupsCut: 6, findingsCut: 21 }),
    }), null);
    expect(cut.cutNote).toContain("6 more groups");
    expect(cut.cutNote).toContain("21 findings are not shown");
    expect(cut.cutNote).toMatch(/the register lists every open finding/);

    // ONE GROUP TAKES A SINGULAR VERB. `pluralize` fixes the noun and left "1 more group
    // holding 2 findings ARE not shown" on screen, measured on the dev seed.
    const one = fixNextView(payload({
      fixNext: fixNextBlock({ groupsTotal: 9, groupsCut: 1, findingsCut: 2 }),
    }), null);
    expect(one.cutNote).toContain("1 more group holding 2 findings is not shown");
    // And no note at all when nothing was cut — a "0 further groups" line is noise.
    expect(view.cutNote).toBeNull();
  });

  // Tier 1 is only decidable when the current-scan frame carried the exposure field. Absent is
  // not none: `fixNext` publishes `exposureKnown: false` rather than a tier-1 count of 0, and
  // the page has to say which of the two it is looking at.
  it("names an unmeasurable tier 1 instead of letting it read as an empty one", () => {
    expect(view.exposureNote).toBeNull();
    const blind = fixNextView(payload({
      fixNext: fixNextBlock({ exposureKnown: false }),
    }), null);
    expect(blind.exposureNote).toMatch(/Tier 1 could not be measured/);
    expect(blind.exposureNote).toMatch(/no exposure field/);
  });

  it("is ABSENT on a first run, deferring to the panel that names every waiting figure", () => {
    const unread = payload({ mttr: { rowCount: 0, overall: {}, remediation: {} } });
    // The first-run rule lives in one place; this view reads it rather than restating it.
    expect(executiveFirstRunView(unread, null).show).toBe(true);
    const first = fixNextView(unread, null);
    expect(first.show).toBe(false);
    expect(first.firstRun).toBe(true);
    expect(first.missing).toBe(false);
    expect(first.items).toEqual([]);
  });

  it("distinguishes `nothing ranked` from `nothing read`, and gives the reason", () => {
    const nothing = fixNextView(payload({
      fixNext: fixNextBlock({
        groups: [], tiers: { 1: 0, 2: 0, 3: 0 }, ranked: 0, groupsTotal: 0,
      }),
    }), null);
    expect(nothing.show).toBe(true);
    expect(nothing.firstRun).toBe(false);
    expect(nothing.empty).toBe(true);
    expect(nothing.emptyReason).toMatch(/^Nothing to rank/);
    expect(nothing.emptyReason).toMatch(/known-exploited finding on a reachable host/);
    // The counts are still published — they are the evidence for the good news.
    expect(nothing.unrankedSentence).toMatch(/^0 of 113 open findings are ranked/);
  });

  it("withholds the section with a sentence, rather than throwing, when the key is missing", () => {
    const missing = fixNextView(payload(), null);
    expect(missing.show).toBe(false);
    expect(missing.firstRun).toBe(false);
    expect(missing.missing).toBe(true);
    expect(missing.missingNote).toMatch(/carries no ranked list/);
    expect(missing.items).toEqual([]);
    // The two shapes a stale cache can hand over, neither of which may throw.
    expect(() => fixNextView(payload({ fixNext: null }), null)).not.toThrow();
    expect(() => fixNextView(payload({ fixNext: {} }), null)).not.toThrow();
    expect(fixNextView(payload({ fixNext: {} }), null).items).toEqual([]);
  });
});

// ------------------------------------------------------------------- the page's shape

describe("os: the front door still draws no chart", () => {
  it("creates no canvas anywhere in executive.js", () => {
    // Deliberately over the RAW source rather than a comment-stripped copy: the module header
    // and this page's own prose name `el("canvas"` while explaining the rule, so a hit here
    // would be either a real canvas or a comment that has to be reworded. Both are worth
    // stopping at.
    const calls = SRC.match(/el\("canvas"/g) || [];
    expect(calls).toEqual([]);
    // And it never reaches for the ~170 KB Chart.js loader the other four pages import. The
    // module header NAMES chartsLoader.js while explaining that it does not use it, so the
    // check is on the import statement rather than on the word.
    expect(SRC).not.toMatch(/from "\.\.\/chartsLoader\.js"/);
  });

  it("draws the ranked list as an ordered list, because the order is the claim", () => {
    // A reader on a screen reader hears "1 of 8" and gets the same argument the page makes
    // visually. A `<ul>` or a stack of divs is the same pixels and a different statement.
    expect(SRC).toContain('el("ol", { class: "fixnext" })');
  });

  it("has no page-level Run scan button left to disagree with the rail's", () => {
    // The decision this package took: one control in one place. The page's own primary button
    // and the icon it carried are gone; a second Run scan is a second thing that can claim a
    // scan is or is not already running.
    expect(SRC).not.toContain("ctx.startScan");
    expect(SRC).not.toContain("RUN_ICON");
  });
});
