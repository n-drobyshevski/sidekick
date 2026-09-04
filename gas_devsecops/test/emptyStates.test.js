// First-run states of THIS register, and the two things it kept confusing with them.
//
// TWO OF THE ORIGINAL FIVE SECTIONS LEFT. §1 ("a failure is never dressed as an absence")
// and §5 ("every page below Executive states the origin") are rules every sidekick owes, so
// they moved to gas_shared/test/contracts/emptyStates.js and are registered from
// test/shared.test.js — same assertions, same non-vacuity halves, this app's route list
// passed in. Nothing was dropped; what stayed is what is about THIS register's own view
// functions and could not be stated over another app: `executiveFirstRunView`, `kmP90View`
// and `rateView`.
//
// DEFECT TWO: NOBODY HAD SEEN THE EMPTY LEDGER. With `?dry&noseed`, Executive printed
// `0 lifecycles in the ledger · 0 closed findings · 0 kept in as right-censored observations`
// above five severity tiles each reading `0 open` and a register table of three zeros — and
// the one honest sentence on the page ("No sync saved yet") sat at the BOTTOM. MTTR glued
// "not measured" to a count twice in two sentences, and printed the caption "nine in ten
// close by here" under an em dash — on the SEEDED page as well, where P90 is genuinely never
// reached inside the window.
//
// PRODUCT.md's sixth principle names the rule all of it breaks: *"No MTTR yet" is a state a
// reader can act on; "MTTR is 0 days" is a confident lie.* A count is no different. "0
// critical open" over a ledger nobody has read is indistinguishable from a clean bill of
// health, and it is the front door, read by the one person on this product who reads only
// the front door.
//
// WHY SOURCE TEXT FOR §4. There is no jsdom here (vitest.config.ts sets no `environment`),
// and the claim is about which component a page REACHES FOR, which is a property of the
// module rather than of any one rendered output. The sweep reads comment-stripped code
// through the shared `code()` helper — these very module headers name the strings they
// forbid, and a raw-text check would fail on the sentence that states the rule.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import { executiveFirstRunView } from "../src/client/js/pages/executive.js";
import { kmP90View, rateView } from "../src/client/js/pages/mttr.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);
const ROUTES = [
  "executive", "mttr", "program",
  "sca", "sast", "secrets",
  "repos", "history", "data",
  "settings",
];
const CODE = Object.fromEntries(
  ROUTES.map((r) => [r, code(readFileSync(new URL(r + ".js", PAGES_DIR), "utf8"))]),
);

// =========================================================================================
//  2. The front door on a ledger nobody has read
// =========================================================================================

/** The minimum payload `executiveHeroView` reads — enough to make `tracked` non-zero. */
function populatedPayload() {
  return {
    mttr: {
      rowCount: 554,
      overall: { resolved: 138, open: 416 },
      remediation: { km: { median: null, medianLowerBound: 294 } },
    },
    severityCounts: { counts: { CRITICAL: 12, HIGH: 40 }, open: 52, total: 554 },
    byScope: { rows: [{ group: "sca", open: 300, kmMedian: null }] },
    weekTrend: null,
  };
}

const BOOT_FIRST_RUN = {
  latestSync: null,
  settings: { scopes: ["sca", "sast", "secrets"], slaTargets: { CRITICAL: 7, HIGH: 30 } },
};

describe("executiveFirstRunView", () => {
  it("shows, and names an unlock condition and a route for every figure it withholds", () => {
    const view = executiveFirstRunView({ mttr: { rowCount: 0 } }, BOOT_FIRST_RUN);
    expect(view.show).toBe(true);
    expect(view.synced).toBe(false);
    expect(view.heading).toMatch(/No sync has run yet/);
    expect(view.items.length).toBeGreaterThanOrEqual(4);

    for (const item of view.items) {
      expect(typeof item.figure, "a withheld figure with no name").toBe("string");
      expect(item.figure.length).toBeGreaterThan(0);
      // The unlock is a SENTENCE, not a label: it has to say what would make the figure
      // exist, which is the whole point of the panel.
      expect(item.unlock.length, `${item.figure}: unlock is not a sentence`).toBeGreaterThan(30);
      // Either a hash route, or an explicit null saying the control is not a page — and a
      // label either way, so nothing renders as a link that goes nowhere.
      if (item.route !== null) expect(item.route).toMatch(/^#\//);
      expect(item.routeLabel.length, `${item.figure}: no action named`).toBeGreaterThan(0);
    }

    const figures = view.items.map((i) => i.figure).join(" | ");
    expect(figures).toMatch(/half-life/i);
    expect(figures).toMatch(/movement/i);
    expect(figures).toMatch(/SLA/i);
    // One per register — a count that is missing because the register is switched off is a
    // different fact from one that is missing because nothing has been synced.
    expect(figures).toMatch(/Dependencies/);
    expect(figures).toMatch(/Code/);
    expect(figures).toMatch(/Secrets/);

    // No unlock sentence carries a bare zero. This is the panel that REPLACED eight of them.
    for (const item of view.items) {
      expect(item.unlock, `${item.figure}: a zero reached the unlock copy`).not.toMatch(/\b0\b/);
    }
  });

  it("routes a disabled register to Settings and an enabled one to the sync control", () => {
    const off = executiveFirstRunView(
      { mttr: { rowCount: 0 } },
      { latestSync: null, settings: { scopes: ["sca"], slaTargets: { HIGH: 30 } } },
    );
    const byFigure = Object.fromEntries(off.items.map((i) => [i.figure, i]));
    const sca = byFigure["Dependencies (SCA) — open findings"];
    const secrets = byFigure["Secrets — open findings"];
    expect(sca.route, "an enabled register needs a sync, not a settings trip").toBe(null);
    expect(secrets.route, "a register that is switched off has to say where to switch it on")
      .toMatch(/^#\/settings/);
    expect(secrets.unlock).toMatch(/not being collected/);
  });

  it("distinguishes a first run from a sync that ran and found nothing", () => {
    const ran = executiveFirstRunView(
      { mttr: { rowCount: 0 } },
      { ...BOOT_FIRST_RUN, latestSync: { ts: "2026-09-04T00:00:00Z", total: 0, scopes: [] } },
    );
    expect(ran.show).toBe(true);
    expect(ran.synced).toBe(true);
    expect(ran.heading, "a completed sync is a measurement — saying none ran would be false")
      .not.toMatch(/No sync has run yet/);
  });

  it("stands down entirely on a populated payload", () => {
    const view = executiveFirstRunView(populatedPayload(), BOOT_FIRST_RUN);
    expect(view.show).toBe(false);
    expect(view.items).toEqual([]);
  });

  it("stands down on a populated payload even with no bootstrap at all", () => {
    // The panel is gated on what the LEDGER holds, not on what bootstrap says: a missing
    // bootstrap must never make a register with 554 lifecycles claim it was never synced.
    const view = executiveFirstRunView(populatedPayload(), null);
    expect(view.show).toBe(false);
    expect(view.items).toEqual([]);
  });
});

// =========================================================================================
//  3. A caption that describes a value that is not there
// =========================================================================================

describe("the P90 sub-line", () => {
  it("describes the value only when there is one", () => {
    const measured = kmP90View({ p90: 61.4, events: 138 });
    expect(measured.measured).toBe(true);
    expect(measured.value).toBe("61 days");
    expect(measured.note).toContain("close by here");
  });

  it("does not claim nine in ten close anywhere when P90 is null", () => {
    // The SEEDED case. 138 findings closed and the curve still never reaches nine in ten
    // inside the window — so the absence is a fact about the WINDOW, and the caption says so
    // rather than describing a number that is not printed above it.
    const reached = kmP90View({ p90: null, events: 138, censored: 416 });
    expect(reached.measured).toBe(false);
    expect(reached.value).toBe("—");
    expect(reached.note).not.toContain("close by here");
    expect(reached.note).toMatch(/never reaches/);

    // The EMPTY case. Nothing closed, so there is no percentile to place — a different
    // absence, and collapsing the two would say "nothing closed" over a register where 138
    // things did.
    const empty = kmP90View({ p90: null, events: 0 });
    expect(empty.measured).toBe(false);
    expect(empty.value).toBe("—");
    expect(empty.note).not.toContain("close by here");
    expect(empty.note).toMatch(/nothing has closed/);
    expect(empty.note).not.toMatch(/\b0\b/);
  });

  it("refuses a non-finite P90 rather than printing it", () => {
    for (const km of [null, undefined, {}, { p90: undefined }, { p90: "" }, { p90: NaN }]) {
      const v = kmP90View(km);
      expect(v.measured, JSON.stringify(km)).toBe(false);
      expect(v.note).not.toContain("close by here");
    }
  });
});

// =========================================================================================
//  4. No "not measured" sentence carries a count
// =========================================================================================

/**
 * The two sentences this package fixed, as they were rendered:
 *
 *   "Resolved inside the SLA window: not measured 0 resolved."
 *   "Awaiting a vendor fix: 0 open SCA findings — not measured 0 open findings."
 *
 * Neither was written as one literal — both were ASSEMBLED, from `rate.text` (which is the
 * string "not measured") placed next to `denominatorNode(rate)` (which printed the caller's
 * `"0 resolved"` label). So the guard has two halves: the assembly is only allowed to happen
 * through `denominatorNode`, which now refuses to restate an empty base; and no page may
 * write the pairing out by hand.
 */
describe("no sentence glues \"not measured\" to a count", () => {
  it("rateView marks an empty base as its own state, with a label that names no number", () => {
    const empty = rateView(null, 0, "0 resolved");
    expect(empty.text).toBe("not measured");
    expect(empty.baseEmpty).toBe(true);
    // The denominator still travels — it goes into [data-denominator] and into any test that
    // asks. What must not happen is that a reader sees it beside "not measured".
    expect(empty.denominator).toBe(0);
    expect(empty.emptyLabel, "the empty-base label restates the zero").not.toMatch(/\d/);

    // A base that EXISTS but whose rate was not computed is a different state, and keeps the
    // caller's label, because there the number is a fact.
    const uncomputed = rateView(undefined, 12, "12 resolved");
    expect(uncomputed.text).toBe("not measured");
    expect(uncomputed.baseEmpty).toBe(false);

    const measured = rateView(22.5, 138, "138 resolved");
    expect(measured.baseEmpty).toBe(false);
    expect(measured.text).toBe("22.5%");
  });

  it("every denominator node on the two program-lane pages honours baseEmpty", () => {
    for (const route of ["mttr", "program"]) {
      expect(
        CODE[route],
        `pages/${route}.js prints a rate's denominator label without checking baseEmpty — `
        + "on an empty base that renders as \"not measured 0 resolved\"",
      ).toMatch(/baseEmpty \? [^;]*rate\.emptyLabel : rate\.denominatorLabel/);
    }
    // executive.js builds its share cell inline rather than through a helper, so it carries
    // the same conditional in its own words.
    expect(CODE.executive).toMatch(/share\.baseEmpty \?/);
  });

  it("no page writes the pairing out by hand", () => {
    // `"not measured"` followed, inside the same expression, by a count-producing call or a
    // digit. This is what re-introducing either sentence as a literal would look like.
    const HAND_WRITTEN = /not measured[^"]{0,40}("\s*[,+]\s*(fmtCount|fmtDays|String)\(|\s\d)/;
    for (const route of ROUTES) {
      const hit = CODE[route].match(HAND_WRITTEN);
      expect(hit, `pages/${route}.js interpolates a count into a "not measured" sentence: `
        + (hit ? JSON.stringify(hit[0]) : "")).toBe(null);
    }
  });

  it("is not a vacuous sweep — both fixed sentences are still on the page, rewritten", () => {
    expect(CODE.mttr).toMatch(/Resolved inside the SLA window: not measured — nothing has closed/);
    expect(CODE.mttr).toMatch(/Awaiting a vendor fix: not measured — no SCA finding is open/);
  });
});
