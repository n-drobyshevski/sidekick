// Executive's two new blocks, held at the half that can be WRONG.
//
// There is no jsdom here (vitest.config.ts sets no `environment`), so the pure/DOM split every
// page file in this tree makes is what makes this testable: `fixNextView`, `openMovementView`
// and `deltaChipView` decide, `renderFixNext` and `renderMovement` draw. The decisions are all
// below; the drawing is checked as SOURCE TEXT, the same way `pagesLit.test.js` does it.
//
// THE ONE STRUCTURAL CLAIM THIS FILE ADDS is that the front door still draws no canvas.
// `chartTable.test.js` already counts canvases per page and would fail on an untabled one;
// this file states the stronger rule for Executive specifically — ZERO, not "tabled" — because
// the page's whole payload shape (execMttrSlice ships two scalars, not a curve) rests on it,
// and a ranked list is exactly the kind of block somebody would later reach for a bar chart to
// draw.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  deltaChipView, executiveFirstRunView, fixNextView, openMovementView,
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
    severityCounts: { counts: { CRITICAL: 15 }, open: 416, total: 554 },
    byScope: { dimension: "scope", rows: [] },
    weekTrend: null,
    ...over,
  };
}

function fixNextBlock(over) {
  return {
    groups: [
      {
        tier: 1, label: "Live credential", scope: "secrets", repo: "payments-api",
        product: "product-payments", supportGroup: "CE-TRANSPORT", count: 7, oldestAgeDays: 412,
        route: "secrets", params: { scope: "secrets", repo: "payments-api" },
      },
      {
        tier: 2, label: "Fixable and late", scope: "sca", repo: null,
        product: null, supportGroup: null, count: 3, oldestAgeDays: null,
        route: "sca", params: { scope: "sca", repo: null },
      },
    ],
    tiers: { 1: 7, 2: 3, 3: 0 },
    unranked: { noFix: 40, unvalidated: 99, insideSla: 12, other: 255 },
    ranked: 10,
    openTotal: 416,
    groupsTotal: 2,
    groupsCut: 0,
    findingsCut: 0,
    limit: 8,
    asOf: 0,
    ...over,
  };
}

// ------------------------------------------------------------------------- delta chip

describe("deltaChipView", () => {
  it("calls a rising count up, and a rising count is the bad one", () => {
    const chip = deltaChipView(320, 280);
    expect(chip.direction).toBe("up");
    expect(chip.kind).toBe("bad");
    expect(chip.delta).toBe(40);
    expect(chip.pct).toBe(14);
    expect(chip.text).toBe("+40 · +14%");
    expect(chip.aria).toMatch(/^up 40, 14 percent/);
    expect(chip.aria).toMatch(/backlog grew/);
  });

  it("calls a falling count down, and spells the direction in words", () => {
    const chip = deltaChipView(280, 320);
    expect(chip.direction).toBe("down");
    expect(chip.kind).toBe("ok");
    expect(chip.delta).toBe(-40);
    expect(chip.text).toBe("−40 · −13%");
    expect(chip.aria).toMatch(/^down 40/);
    expect(chip.aria).toMatch(/backlog shrank/);
  });

  it("says unchanged rather than drawing a direction that is not there", () => {
    const chip = deltaChipView(280, 280);
    expect(chip.direction).toBe("flat");
    expect(chip.text).toBe("±0");
    expect(chip.aria).toBe("unchanged");
    expect(chip.pct).toBeNull();
  });

  // The whole point of the port: `Number(null)` is 0 and 0 is finite, so a naive cast would
  // turn "never measured" into "unchanged, ±0" — a confident zero over a comparison nobody
  // made. `num()` refuses null BEFORE the cast, and this view returns null so nothing draws.
  it("draws NO chip at all when there is no previous value", () => {
    expect(deltaChipView(280, null)).toBeNull();
    expect(deltaChipView(280, undefined)).toBeNull();
    expect(deltaChipView(280, "")).toBeNull();
    expect(deltaChipView(null, 280)).toBeNull();
  });

  it("never prints a 0 % beside a non-zero change", () => {
    // A previous value of 0 has no percentage to give; a change that rounds to 0 % would
    // read as no movement beside a count that plainly moved. Both drop the clause.
    const fromZero = deltaChipView(5, 0);
    expect(fromZero.direction).toBe("up");
    expect(fromZero.pct).toBeNull();
    expect(fromZero.text).toBe("+5");

    const tiny = deltaChipView(1001, 1000);
    expect(tiny.pct).toBeNull();
    expect(tiny.text).toBe("+1");
  });
});

// -------------------------------------------------------------------------- movement

describe("openMovementView", () => {
  const comparable = {
    comparable: true,
    reason: null,
    syncs: 3,
    since: "2026-06-01T20:00:00.000Z",
    until: "2026-06-15T08:00:00.000Z",
    days: 13.5,
    perScope: {
      sca: { open: 280, prevOpen: 320, delta: -40 },
      sast: { open: 30, prevOpen: 27, delta: 3 },
      secrets: { open: 106, prevOpen: 106, delta: 0 },
    },
    total: { open: 416, prevOpen: 453, delta: -37 },
  };

  it("gives every register a chip and states the two dates compared", () => {
    const view = openMovementView(comparable);
    expect(view.show).toBe(true);
    expect(view.rows.map((r) => r.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(view.rows[0].chip.direction).toBe("down");
    expect(view.rows[1].chip.direction).toBe("up");
    expect(view.rows[2].chip.direction).toBe("flat");
    expect(view.total.chip.direction).toBe("down");
    // The interval is part of the figure, not a footnote: "down 37" over an unnamed window
    // is not a measurement.
    expect(view.dates).toMatch(/Between the syncs on /);
    expect(view.dates).toMatch(/13\.5 d apart/);
    // Reported to a decimal on purpose: `fmtDays` would round 13.5 to "14 days", and the
    // interval a delta is measured over is exactly the kind of origin this register does not
    // round away.
    expect(view.days).toBe(13.5);
  });

  it("refuses with the actual gap when the syncs are too close together", () => {
    const view = openMovementView({
      comparable: false, reason: "tooClose", syncs: 2, since: null,
      until: "2026-06-04T08:00:00.000Z", days: 3,
    });
    expect(view.show).toBe(false);
    expect(view.reason).toMatch(/too close together/);
    expect(view.reason).toMatch(/spans 3 days/);
    expect(view.reason).toMatch(/at least 7 days apart/);
  });

  it("says `one sync only` and does not reach for a number to put beside it", () => {
    const view = openMovementView({
      comparable: false, reason: "oneSync", syncs: 1, since: null, until: "x", days: null,
    });
    expect(view.show).toBe(false);
    expect(view.reason).toMatch(/One sync only/);
    expect(view.reason).not.toMatch(/spans/);
    expect(view.days).toBeNull();
  });

  it("treats a missing block as `no sync`, never as a comparison against zero", () => {
    expect(openMovementView(null).show).toBe(false);
    expect(openMovementView(null).reason).toMatch(/No sync has saved a scan yet/);
    expect(openMovementView(undefined).reason).toMatch(/No sync has saved a scan yet/);
  });
});

// -------------------------------------------------------------------------- fix next

describe("fixNextView", () => {
  const view = fixNextView(payload({ fixNext: fixNextBlock() }));

  it("lists the groups in the order it was sent, with units on every figure", () => {
    expect(view.show).toBe(true);
    expect(view.items.length).toBe(2);
    const first = view.items[0];
    expect(first.rank).toBe(1);
    expect(first.tierLabel).toBe("Live credential");
    // A pill kind, not a bare colour name — and the tier's own words carry the meaning.
    expect(first.kind).toBe("bad");
    expect(first.repoText).toBe("payments-api");
    expect(first.countText).toBe("7 open findings");
    expect(first.oldestText).toBe("oldest 412 days");
    expect(first.scopeLabel).toBe("Secrets");
    expect(first.product).toBe("product-payments");
    expect(first.supportGroup).toBe("CE-TRANSPORT");
    // The product is who this is for, so it is what the meta line prints.
    expect(first.ownerText).toBe("product-payments");
  });

  it("links each group at its own register", () => {
    expect(view.items[0].href).toBe("#/secrets");
    expect(view.items[1].href).toBe("#/sca");
    expect(view.items[0].linkLabel).toMatch(/Open the Secrets register/);
    // And it says what the link does NOT do, because no register page reads a repository
    // filter out of the hash today.
    expect(view.linkNote).toMatch(/unfiltered/);
    expect(view.linkNote).toMatch(/no repository filter yet/);
  });

  it("dashes an absent repository and an unreadable age instead of inventing either", () => {
    const second = view.items[1];
    expect(second.repo).toBeNull();
    expect(second.repoText).toBe("—");
    expect(second.oldestDays).toBeNull();
    expect(second.oldestText).toBe("no readable age");
    expect(second.product).toBeNull();
    expect(second.supportGroup).toBeNull();
    expect(second.ownerText).toBe("no single owner");
  });

  // THREE STATES, NOT TWO. A group whose repositories sit under several products may still
  // sit under one support group — the coarser grain agrees more often, and it is who a reader
  // escalates to. Falling straight to "no single owner" there would hide a real answer.
  it("falls back to the support group, NAMED AS ONE, when no single product agrees", () => {
    const v = fixNextView(payload({ fixNext: fixNextBlock({
      groups: [{
        tier: 1, label: "Live credential", scope: "secrets", repo: "payments-api",
        product: null, supportGroup: "CE-TRANSPORT", count: 7, oldestAgeDays: 412,
        route: "secrets", params: { scope: "secrets", repo: "payments-api" },
      }],
    }) }));
    // Named as one: "CE-TRANSPORT" alone would read as a product to anyone who has not
    // learned the tenant's prefixes.
    expect(v.items[0].ownerText).toBe("CE-TRANSPORT (support group)");
  });

  it("accounts for everything it left out, by reason, in one sentence", () => {
    expect(view.unrankedSentence).toMatch(/^10 of 416 open findings are ranked above/);
    expect(view.unrankedSentence).toMatch(/40 awaiting a vendor fix/);
    expect(view.unrankedSentence).toMatch(/99 secrets not confirmed live/);
    expect(view.unrankedSentence).toMatch(/12 still inside their SLA window/);
    expect(view.unrankedSentence).toMatch(/255 below their tier's severity bar/);
    expect(view.unranked).toEqual({ noFix: 40, unvalidated: 99, insideSla: 12, other: 255 });
  });

  it("says the list is capped when the server cut groups off the end", () => {
    const cut = fixNextView(payload({
      fixNext: fixNextBlock({ groupsTotal: 14, groupsCut: 6, findingsCut: 21 }),
    }));
    expect(cut.cutNote).toMatch(/6 further groups/);
    expect(cut.cutNote).toMatch(/21 ranked findings/);
    expect(cut.cutNote).toMatch(/capped at 8/);
    // And no note at all when nothing was cut — a "0 further groups" line is noise.
    expect(view.cutNote).toBeNull();
  });

  it("is ABSENT on a first run, deferring to the panel that names every waiting figure", () => {
    const unread = payload({ mttr: { rowCount: 0, overall: {}, remediation: {} } });
    // The first-run rule lives in one place; this view reads it rather than restating it.
    expect(executiveFirstRunView(unread, null).show).toBe(true);
    const first = fixNextView(unread, null);
    expect(first.show).toBe(false);
    expect(first.firstRun).toBe(true);
    expect(first.items).toEqual([]);
  });

  it("distinguishes `nothing ranked` from `nothing read`, and gives the reason", () => {
    const nothing = fixNextView(payload({
      fixNext: fixNextBlock({
        groups: [], tiers: { 1: 0, 2: 0, 3: 0 }, ranked: 0, groupsTotal: 0,
      }),
    }));
    expect(nothing.show).toBe(true);
    expect(nothing.firstRun).toBe(false);
    expect(nothing.empty).toBe(true);
    expect(nothing.emptyReason).toMatch(/Nothing to rank/);
    expect(nothing.emptyReason).toMatch(/confirmed live/);
    // The counts are still published — they are the evidence for the good news.
    expect(nothing.unrankedSentence).toMatch(/0 of 416 open findings are ranked/);
  });

  it("withholds the section rather than drawing an empty one when the key is missing", () => {
    const view2 = fixNextView(payload());
    expect(view2.show).toBe(false);
    expect(view2.firstRun).toBe(false);
  });
});

// ------------------------------------------------------------------- the page's shape

describe("the front door still draws no chart", () => {
  it("creates no canvas anywhere in executive.js", () => {
    // Deliberately over the RAW source rather than a comment-stripped copy: the module header
    // and this page's own prose name `el("canvas"` while explaining the rule, so a hit here
    // would be either a real canvas or a comment that has to be reworded. Both are worth
    // stopping at. `chartTable.test.js` counts canvases per page; this states the stronger
    // rule for the one page whose payload was sliced on the assumption.
    const calls = SRC.match(/el\("canvas"/g) || [];
    expect(calls).toEqual([]);
    // And it never reaches for the ~170 KB Chart.js loader the other four pages import. The
    // module header NAMES chartsLoader.js while explaining that it does not use it, so the
    // check is on the import statement rather than on the word.
    expect(SRC).not.toMatch(/from "\.\.\/chartsLoader\.js"/);
  });

  it("draws the ranked list as an ordered list, because the order is the claim", () => {
    expect(SRC).toContain('el("ol", { class: "fixnext" })');
  });
});

// ------------------------------------------------- where the ranked list sits, and how

/**
 * The host order, as the page itself declares it — `host.append(...)`'s argument list is the
 * DOM order, so this is the one line that decides what a reader meets first. The literal spans
 * two lines here, hence the `[\s\S]`.
 */
function hostOrder(src) {
  const m = src.match(/(?<![A-Za-z])(?:brief|host)\.append\(([^;]*Host[^;]*)\);/);
  return m
    ? m[1].split(",").map((s) => s.trim()).filter((s) => s.endsWith("Host"))
    : [];
}

describe("Fix next is one collapsible block, straight after the splits", () => {
  it("appends fixHost after the splits and before the reading notes", () => {
    // The briefing (DESIGN.md "The briefing"): status line, figures, splits, then the ranked
    // list — its own top three while shut — and the reading notes last, so the notes qualify
    // everything above them.
    expect(hostOrder(SRC)).toEqual([
      "statusHost", "noticeHost", "figuresHost", "splitsHost", "fixHost", "notesHost",
    ]);
    // Perturbed, because "is fixHost in the list" would pass on the arrangement this replaces.
    // The ranked list spent its whole life directly under the hero, which put the page's
    // longest block between the one figure this page opens with and the three one-glance
    // blocks that qualify it.
    const before = "  host.append(\n    pageHeader({ route: \"executive\" }),\n"
      + "    noticeHost, heroHost, fixHost, coldHost, sevHost, registerHost, scanHost,\n  );";
    expect(hostOrder(before).at(-1)).toBe("scanHost");
    expect(hostOrder(SRC).at(-1)).toBe("notesHost");
  });

  it("is ONE block: no separate Fix first preview, and the shut preview hides when it opens", () => {
    // The same top three used to be drawn twice — a "Fix first" preview above, and the folded
    // Fix next list below starting with the same groups. The preview now lives inside the
    // Fix next block and steps aside whenever the section is open.
    expect(SRC).not.toContain("topHost");
    expect(SRC).not.toContain('label: "Fix first"');
    const fn = SRC.slice(SRC.indexOf("function renderFixNext("));
    expect(fn).toMatch(/const preview = previewOf\(view\);/);
    expect(fn).toMatch(/preview\.hidden = section\.node\.open;/);
    expect(fn).toMatch(/fixHost\.append\(section\.node, preview\);/);
  });

  it("builds the section through collapsibleSection, with the page holding the open flag", () => {
    const fn = SRC.slice(SRC.indexOf("function renderFixNext("));
    expect(fn).toContain('collapsibleSection("Fix next", {');
    expect(fn).toMatch(/open: fixOpen,/);
    expect(fn).toMatch(/onToggle: \(o\) => \{ fixOpen = o; preview\.hidden = o; \},/);
    // Remembered per reader across visits — the closure flag only survives this page's own
    // repaints, and swrCall paints twice on a warm cache.
    expect(fn).toMatch(/remember: "execFixNext",/);
  });

  it("puts the denominator on the heading, so a SHUT section still says what it holds", () => {
    const fn = SRC.slice(SRC.indexOf("function renderFixNext("));
    expect(fn).toMatch(/hint: view\.rankedShort,/);
    // And it is no longer ALSO a paragraph under the list — one statement, one place.
    expect(fn).not.toContain('el("p", { class: "small muted" }, view.rankedShort)');
  });
});

describe("the loading stubs are the briefing's own layout", () => {
  it("stubs the figures, the splits and the list in their hosts, and each render clears its own", () => {
    const s = SRC.slice(SRC.indexOf("const stub = briefSkeleton();"));
    expect(s).toMatch(/clear\(figuresHost\)\.append\(stub\.figures\);/);
    expect(s).toMatch(/clear\(splitsHost\)\.append\(stub\.splits\);/);
    expect(s).toMatch(/clear\(fixHost\)\.append\(stub\.list\);/);
    // A stub left standing under real content is the defect this guards: every host the stub
    // fills is cleared by its render (and by the first-run branch for the last two).
    for (const [fn, host] of [["renderFigures", "figuresHost"], ["renderSplits", "splitsHost"],
      ["renderFixNext", "fixHost"]]) {
      const body = SRC.slice(SRC.indexOf("function " + fn + "("));
      expect(body.slice(0, 400), fn).toContain("clear(" + host + ")");
    }
  });
});
