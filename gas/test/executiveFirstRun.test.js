// The front door on a ledger nobody has read.
//
// WHAT THIS EXISTS TO STOP. With no scan saved, this page rendered `0 tracked lifecycles · 0
// resolved · 0 open` under a hero, over a row of severity tiles each reading a confident 0.
// Every one of those is a statement about a population nobody has looked at, and "0 critical
// open" is indistinguishable from a clean bill of health on the one page read by the one
// person on this product who reads only the front door.
//
// PRODUCT.md's sixth principle names the rule: *"No MTTR yet" is a state a reader can act on;
// "MTTR is 0 days" is a confident lie.* A count is no different. So the zero-valued blocks are
// SUPPRESSED rather than dashed — a dash still holds a figure's slot and invites a reader to
// wait for it to fill — and an itemised panel takes their place, naming each withheld figure
// with the ONE condition that unlocks it.
//
// TWO HALVES, AND THE SECOND IS SOURCE TEXT. `executiveFirstRunView` is pure and is exercised
// directly. The suppression itself is a property of `renderHero`/`paint` — which DOM node gets
// which argument — and there is no jsdom here (vitest.config.ts sets no `environment`), so it
// is read as comment-stripped source through the same `code()` helper every other sweep in
// this tree uses. The perturbation at the bottom runs that same sweep against the defective
// shape it exists to catch, so the guard is shown biting rather than asserted from a comment.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import {
  executiveFirstRunView, executiveHeroView,
} from "../src/client/js/pages/executive.js";

const SRC = readFileSync(
  new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8",
);

/** A payload from a ledger nobody has read: the server answers, and there is nothing in it. */
const UNREAD = { mttr: { rowCount: 0, overall: {}, remediation: {} } };
const BOOT_NO_SCAN = { latestScan: null };
const BOOT_SCANNED = {
  latestScan: { scanId: "s-1", ts: "2026-09-04T00:00:00Z", mode: "full", total: 0 },
};

// =========================================================================================
//  1. The panel
// =========================================================================================

describe("os: executiveFirstRunView", () => {
  it("shows, and names an unlock condition and a control for every figure it withholds", () => {
    const view = executiveFirstRunView(UNREAD, BOOT_NO_SCAN);
    expect(view.show).toBe(true);
    expect(view.synced).toBe(false);
    expect(view.heading).toMatch(/No scan has run yet/);
    expect(view.items.length).toBe(4);

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
    expect(figures).toMatch(/severity/i);
    expect(figures).toMatch(/Fix next/);
    expect(figures).toMatch(/movement/i);
  });

  // A FACT ABOUT THIS REGISTER, NOT AN OVERSIGHT. gas_devsecops sends three of its items to
  // Settings because a register can be switched off for collection there and its SLA windows
  // are editable. This app collects one population and takes its SLA windows from
  // src/domain/config.ts, so there is no setting a reader could change that would fill any of
  // these four. The one control is the rail's Run scan button — and `emptyState` renders a
  // null-route item's label as plain text for exactly that reason.
  it("points every item at the rail's Run scan, because no setting unlocks any of them", () => {
    const view = executiveFirstRunView(UNREAD, BOOT_NO_SCAN);
    expect(view.items.map((i) => i.route)).toEqual([null, null, null, null]);
    for (const item of view.items) {
      expect(item.routeLabel).toBe("Run scan — the button in the rail");
    }
  });

  it("gives each figure a DIFFERENT unlock, so the panel is four facts and not one", () => {
    const view = executiveFirstRunView(UNREAD, BOOT_NO_SCAN);
    const unlocks = view.items.map((i) => i.unlock);
    expect(new Set(unlocks).size).toBe(unlocks.length);
    const byFigure = Object.fromEntries(view.items.map((i) => [i.figure, i.unlock]));
    // The half-life needs a CLOSE, and a close needs a second scan — that is the register's
    // own resolution rule (a finding is dated closed at the scan that stopped seeing it).
    expect(byFigure["Remediation half-life"]).toMatch(/second scan/);
    // The severity picture needs only the first.
    expect(byFigure["Open findings by severity"]).toMatch(/first scan/);
    // The ranking needs the risk signals, which is a different thing from a scan count.
    expect(byFigure["Fix next"]).toMatch(/exploited|fix is published|reachable/);
    // The comparison needs two endpoints a week apart, and refuses to invent one.
    expect(byFigure["Week-over-week movement"]).toMatch(/seven days apart/);
  });

  it("distinguishes a first run from a scan that ran and found nothing", () => {
    const ran = executiveFirstRunView(UNREAD, BOOT_SCANNED);
    expect(ran.show).toBe(true);
    expect(ran.synced).toBe(true);
    expect(ran.heading).toMatch(/The last scan saved no findings/);
    expect(ran.heading).not.toMatch(/No scan has run yet/);
  });

  it("stands down the moment a single lifecycle is tracked", () => {
    const read = executiveFirstRunView(
      { mttr: { rowCount: 1, overall: { resolved: 0, open: 1 }, remediation: { km: {} } } },
      BOOT_SCANNED,
    );
    expect(read.show).toBe(false);
    expect(read.items).toEqual([]);
  });

  it("treats a missing payload and a missing bootstrap as a first run rather than throwing", () => {
    expect(executiveFirstRunView(null, null).show).toBe(true);
    expect(executiveFirstRunView(undefined, undefined).show).toBe(true);
    expect(executiveFirstRunView({}, {}).show).toBe(true);
  });
});

// =========================================================================================
//  2. The hero refuses, and the refusal is never a zero
// =========================================================================================

describe("os: the hero on an unread ledger", () => {
  it("reads `Not measured`, never a dash and never a 0", () => {
    const hero = executiveHeroView(UNREAD);
    expect(hero.value).toBe("Not measured");
    expect(hero.measured).toBe(false);
    expect(hero.isLowerBound).toBe(false);
    expect(hero.days).toBeNull();
    expect(hero.value).not.toContain("—");
    expect(hero.value).not.toMatch(/\b0\b/);
  });

  // THE SENTENCE UNDER THE VALUE IS THE OTHER HALF. "Not measured" over "0 tracked lifecycles
  // · 0 resolved · 0 still open" states the refusal and then contradicts it three times.
  it("never glues the refusal to a count", () => {
    const hero = executiveHeroView(UNREAD);
    expect(hero.qualifier).toBe("No lifecycles tracked yet.");
    expect(hero.qualifier).not.toMatch(/\b0\b/);
  });
});

// =========================================================================================
//  3. The suppression, as a property of the page module
// =========================================================================================

/**
 * The three things the first-run path owes, checked over comment-stripped source.
 *
 * Returns the violations rather than asserting, so the SAME function can be pointed at the
 * defective snippet below — a guard that has never been shown firing is decoration.
 */
function firstRunGuards(src) {
  const s = code(src);
  const problems = [];
  // 1. The stat strip is an ARGUMENT that depends on the first-run verdict. Three stat rows
  //    reading 0 under a hero that just said "Not measured" is the contradiction the whole
  //    panel exists to end.
  if (!/stats:\s*first\s*&&\s*first\.show\s*\?\s*\[\]\s*:\s*stats/.test(s)) {
    problems.push("the stat strip is not suppressed on a first run");
  }
  // 2. The verdict is reached BEFORE anything below the hero is drawn. A page that painted
  //    the ranked list and then decided it was a first run has already shown the zeros.
  const verdict = s.indexOf("executiveFirstRunView(payload, boot)");
  const suppress = s.indexOf("if (first.show) {");
  const fixNext = s.indexOf("renderFixNext(payload)");
  const severity = s.indexOf("renderSeverity(payload)");
  if (verdict < 0) problems.push("the page never asks for the first-run verdict");
  if (suppress < 0) problems.push("the page never suppresses the blocks below the hero");
  if (fixNext < 0 || severity < 0) problems.push("the page draws neither fix-next nor severity");
  if (verdict >= 0 && suppress >= 0 && verdict > suppress) {
    problems.push("the verdict is reached after the suppression that depends on it");
  }
  // 3. And the suppression sits ahead of both blocks it suppresses.
  if (suppress >= 0 && fixNext >= 0 && suppress > fixNext) {
    problems.push("the fix-next list is drawn before the first-run check");
  }
  if (suppress >= 0 && severity >= 0 && suppress > severity) {
    problems.push("the severity picture is drawn before the first-run check");
  }
  return problems;
}

describe("os: the page suppresses rather than dashes", () => {
  it("passes all three checks on the real module", () => {
    expect(firstRunGuards(SRC)).toEqual([]);
  });

  it("clears every host below the hero rather than leaving a stale paint behind it", () => {
    // The severity block is painted EARLY on the unscoped path (bootstrap already holds the
    // numbers, so the repaint is a no-op and the landing page does not flash a skeleton). On
    // a register whose scan saved nothing that early paint is exactly the row of zeros this
    // file is about, so the first-run branch clears it rather than painting over it.
    const s = code(SRC);
    const branch = s.slice(s.indexOf("if (first.show) {"), s.indexOf("renderFixNext(payload)"));
    for (const host of ["fixHost", "sevHost", "byDomainHost"]) {
      expect(branch, `${host} survives the first-run branch`).toContain("clear(" + host + ")");
    }
    expect(branch).toContain("return;");
  });

  // PERTURBATION. The tempting simplification is to hand `stats` over unconditionally and let
  // the hero's own "Not measured" carry the honesty — which is precisely the shape that
  // shipped `0 · 0 · 0` under it. Reproduced here and run through the SAME sweep, so the
  // assertion is "the guard fires", not a restatement of the regex.
  it("PERTURBATION: an unconditional stat strip fails the same sweep", () => {
    const DEFECTIVE = [
      "  function renderHero(payload, first) {",
      "    const view = executiveHeroView(payload);",
      "    const stats = [",
      '      statRow("Tracked", fmtCount(view.tracked), "lifecycles in the ledger"),',
      "    ];",
      "    heroHost.append(pageHeader({",
      '      hero: heroStat("Remediation half-life", view.value, view.qualifier),',
      "      stats: stats,",
      "    }));",
      "  }",
      "  paint = (payload) => {",
      "    const first = executiveFirstRunView(payload, boot);",
      '    guard("the half-life", heroHost, () => renderHero(payload, first));',
      '    guard("the fix-next list", fixHost, () => renderFixNext(payload));',
      '    guard("open findings by severity", sevHost, () => renderSeverity(payload));',
      "  };",
    ].join("\n");
    const hits = firstRunGuards(DEFECTIVE);
    expect(hits).toContain("the stat strip is not suppressed on a first run");
    expect(hits).toContain("the page never suppresses the blocks below the hero");
  });

  it("PERTURBATION: the sweep does not fire on a comment merely describing the defect", () => {
    // Every module header in this tree explains its prohibition by QUOTING it, so a raw-text
    // check would fail on the sentence that states the rule. `code()` strips comments first.
    const commentOnly = [
      "// this page used to pass stats: stats unconditionally, with no first.show branch",
      "const stats = [];",
      "const first = executiveFirstRunView(payload, boot);",
      "if (first.show) { clear(fixHost); clear(sevHost); clear(byDomainHost); return; }",
      "renderFixNext(payload);",
      "renderSeverity(payload);",
      "const strip = first && first.show ? [] : stats;",
      "const header = { stats: first && first.show ? [] : stats };",
      "void strip; void header;",
    ].join("\n");
    expect(firstRunGuards(commentOnly)).toEqual([]);
  });
});
