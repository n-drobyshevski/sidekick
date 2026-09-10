// AN UNMEASURED REGISTER IS NOT A REGISTER OF ZEROES.
//
// A hero of `0` over four stat rows of `0` states five facts about a population nobody has
// looked at. This file holds both halves of that: the view model's answer on an unread ledger
// (a dash, and an EMPTY stat strip, never four zeros), and — read as SOURCE, comment-stripped
// — the page's own guarantee that its first-run return sits above every canvas, KPI card and
// register table it would otherwise draw.
//
// Ported from `gas_devsecops/test/registerFirstRun.test.js`. What changes here is what
// "content" means: that package's registers draw charts and cards; this one draws those AND
// the server-paged findings table, which is the most expensive thing on the page and the one
// that would fire an RPC against a ledger with nothing in it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { absentText } from "../../gas_shared/ui/figures.js";
import { registerFirstRunView } from "../src/client/js/pages/registerModel.js";
import { HERO_PENDING, overviewHeroView } from "../src/client/js/pages/overviewModel.js";

// ------------------------------------------------------------------ the comment stripper

/** The file with its comments removed — string-aware, so a comment marker inside a quoted
 *  string survives. The same stripper `test/emptyStates.test.js` and
 *  `test/chartTable.test.js` use, and needed for the same reason: the page's own comments
 *  NAME `el("canvas"` and `registerRowsTable(` while explaining the rule below. */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const OVERVIEW = code(readFileSync(
  new URL("../src/client/js/pages/overview.js", import.meta.url), "utf8",
));

// =========================================================================================
//  1. The hero on an unread ledger is a dash, and the stat strip is empty
// =========================================================================================

/** A payload that is real in every way except that the register holds nothing. */
function emptyPayload() {
  return {
    flatScan: true,
    scan: { scanId: "s1", ts: "2026-09-07T08:00:00Z", total: 0 },
    funnel: { open: 0, intel: 0, exploitable: 0, exposed: 0, overdue: 0, exposureKnown: true },
    tiers: { open: 0, perTier: { kev: 0, exploit: 0, epss: 0, none: 0, unknown: 0 } },
    pastSla: { overall: { open: 0, breached: 0, pct: null } },
    awaiting: { overall: 0, openTotal: 0, pctOfOpen: null },
    medianOpenAge: null,
    sevStats: {},
    population: { inScope: 0, gate: null, filters: [] },
  };
}

function fullPayload(over) {
  return {
    ...emptyPayload(),
    funnel: { open: 412, intel: 400, exploitable: 22, exposed: 7, overdue: 3, exposureKnown: true },
    tiers: { open: 412, perTier: { kev: 4, exploit: 18, epss: 30, none: 300, unknown: 60 } },
    pastSla: { overall: { open: 380, breached: 95, pct: 25 } },
    awaiting: { overall: 32, openTotal: 412, pctOfOpen: 7.77 },
    medianOpenAge: 41.2,
    population: { inScope: 520, gate: ["CRITICAL", "HIGH"], filters: ["has a fix"] },
    ...(over || {}),
  };
}

describe("failure of presence: an unread register states nothing about its population", () => {
  it("the hero is a dash and the stat strip is EMPTY, not four zeros", () => {
    const view = overviewHeroView(emptyPayload(), registerFirstRunView(0, true, "t"));
    expect(view.firstRun).toBe(true);
    expect(view.value).toBe(absentText);
    expect(view.value).not.toBe("0");
    expect(view.stats).toEqual([]);
  });

  it("a pending payload is an ellipsis, not a dash — nothing has looked yet", () => {
    // The two absences are different claims: a dash means "we looked and there was nothing",
    // and the RPC has not landed.
    const view = overviewHeroView(null, registerFirstRunView(0, true, "t"));
    expect(view.pending).toBe(true);
    expect(view.value).toBe(HERO_PENDING);
    expect(view.value).not.toBe(absentText);
    expect(view.stats).toEqual([]);
  });

  it("a measured register keeps its figures, zeros included", () => {
    // A FILTER THAT MATCHES NOTHING KEEPS ITS FIGURES: there the zero IS a measurement. The
    // first-run rule is about a population nobody read, not about a small one.
    const view = overviewHeroView(fullPayload(), registerFirstRunView(520, true, "t"));
    expect(view.firstRun).toBe(false);
    expect(view.value).toBe("7");
    expect(view.stats.map((s) => s.name))
      .toEqual(["Open", "Past SLA", "Awaiting vendor fix", "Median open age"]);
    expect(view.stats[0].value).toBe("412");
    expect(view.stats[2].value).toBe("32");
  });
});

describe("the hero refuses a confident zero for a figure nobody could compute", () => {
  it("falls back to the KEV count and SAYS SO when the scan carried no exposure field", () => {
    const view = overviewHeroView(
      fullPayload({
        funnel: { open: 412, intel: 400, exploitable: 22, exposed: 0, overdue: 0, exposureKnown: false },
      }),
      registerFirstRunView(520, true, "t"),
    );
    // NOT `f.exposed` (0) — that would be a measurement of something nothing looked at.
    expect(view.value).toBe("4");
    expect(view.exposureKnown).toBe(false);
    expect(view.qualifier).toMatch(/not captured in this scan/);
    expect(view.lines.join(" ")).toMatch(/It is not zero: nothing looked/);
  });

  it("an unmeasured median is the em dash, not 0 days", () => {
    const view = overviewHeroView(fullPayload({ medianOpenAge: null }),
      registerFirstRunView(520, true, "t"));
    const median = view.stats.find((s) => s.name === "Median open age");
    expect(median.value).toBe(absentText);
    expect(median.value).not.toMatch(/0/);
    // And the same for the values `Number()` would turn into a confident zero.
    for (const bad of ["", [], false]) {
      expect(overviewHeroView(fullPayload({ medianOpenAge: bad }),
        registerFirstRunView(520, true, "t"))
        .stats.find((s) => s.name === "Median open age").value, JSON.stringify(bad))
        .toBe(absentText);
    }
  });

  it("the Past SLA rate carries its own base rather than a bare percentage", () => {
    const view = overviewHeroView(fullPayload(), registerFirstRunView(520, true, "t"));
    const past = view.stats.find((s) => s.name === "Past SLA");
    expect(past.kind).toBe("rate");
    expect(past.pct).toBe(25);
    // The denominator is open findings whose SLA CLOCK HAS STARTED, which is smaller than the
    // open count whenever anything is awaiting a vendor fix.
    expect(past.denominator).toBe(380);
    expect(past.denominator).not.toBe(412);
    expect(past.denominatorLabel).toBe("of 380 on the clock");
    // An empty base names the missing population instead of reading as 0%.
    const none = overviewHeroView(
      fullPayload({ pastSla: { overall: { open: 0, breached: 0, pct: null } } }),
      registerFirstRunView(520, true, "t"),
    ).stats.find((s) => s.name === "Past SLA");
    expect(none.pct).toBeNull();
    expect(none.denominator).toBe(0);
  });
});

// =========================================================================================
//  2. The page returns before it draws anything
// =========================================================================================

/** The index just after `firstRunNotice({ … }); return;` — the shape the page-level gate
 *  takes here. -1 when the file has no such pair. */
function firstRunReturnIndex(stripped) {
  const m = /firstRunNotice\(\{[\s\S]{0,400}?\}\)\);?\s*\n\s*return;/.exec(stripped);
  return m ? m.index + m[0].length : -1;
}

/** The earliest point the page draws a canvas, a KPI card, a chart card or the register's own
 *  table — the four content shapes this page actually uses. */
function firstContentIndex(stripped) {
  const idxs = [
    stripped.indexOf('el("canvas"'),
    stripped.indexOf("kpiCard("),
    stripped.indexOf("chartCard("),
    stripped.indexOf("registerRowsTable("),
  ].filter((i) => i !== -1);
  return idxs.length ? Math.min(...idxs) : Infinity;
}

describe("overview returns before drawing any content, the register table included", () => {
  it("the first-run branch precedes every canvas, card and register table in source", () => {
    const returnAt = firstRunReturnIndex(OVERVIEW);
    expect(returnAt, "overview.js has no firstRunNotice({ … }); return; pair").toBeGreaterThan(-1);
    const contentAt = firstContentIndex(OVERVIEW);
    expect(contentAt, "overview.js draws none of the four content shapes").not.toBe(Infinity);
    expect(returnAt, "overview.js draws content BEFORE its first-run return — a first run "
      + "would paint both the notice and the content it replaces").toBeLessThan(contentAt);
  });

  it("the register table is genuinely one of the shapes checked, not a dead branch", () => {
    // ANTI-VACUOUS: if `registerRowsTable(` ever leaves the file, the sweep above quietly
    // stops covering the most expensive thing on the page.
    expect(OVERVIEW).toMatch(/registerRowsTable\(/);
    expect(OVERVIEW.indexOf("registerRowsTable(")).toBeGreaterThan(firstRunReturnIndex(OVERVIEW));
  });

  // PERTURBATION: the defective ordering this describe exists to catch, run through the SAME
  // two functions the real file goes through.
  it("the check catches a register table drawn before the first-run return", () => {
    const REGRESSED = `
      export async function renderOverview(main) {
        const host = el("div", {});
        host.append(registerRowsTable(readRegisterParams({}), null));
        if (!boot.latestScan) {
          main.append(firstRunNotice({ synced: false }));
          return;
        }
      }
    `;
    const stripped = code(REGRESSED);
    expect(firstRunReturnIndex(stripped)).toBeGreaterThan(-1);
    expect(firstContentIndex(stripped)).toBeLessThan(firstRunReturnIndex(stripped));
  });
});
