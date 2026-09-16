// The Cold zone page's DOM wiring, read as source text — the same bargain
// `test/historyDom.test.js` and `test/settingsDom.test.js` make for their own thin DOM
// layers: there is no jsdom in this project (vitest.config.ts sets no `environment`), the
// pure decisions live in `pages/coldZoneModel.js` and are exercised directly in
// `test/coldZoneModel.test.js`, and what is left — which builder gets called, in what order,
// with what variant — is swept as text. Comment-stripped and string-aware, so a literal
// inside a string survives the strip even where it looks like a comment opener, and so the
// comments on this page (which quote the very rules below) never satisfy their own guard.
//
// THREE CLAIMS, AND EACH ONE IS A DEFECT THIS PAGE COULD PLAUSIBLY ACQUIRE:
//
//   1. THE CAPTION IS FIRST, IN ALL THREE BRANCHES. Every figure on this page is read off one
//      line in days, and the same number means different things depending on which mode drew
//      it. A caption that sat under the cards, or that was skipped on the two notice branches
//      (where the line is the only thing there is to say), would leave "90 days" unreadable.
//   2. NEITHER ABSENCE IS AN ERROR. No clock, and nothing sitting still, are both states this
//      register is legitimately in. `errorState` in either place would announce a working page
//      as broken through role="alert" — the exact conversion `gas_shared`'s empty-state
//      contract exists to stop, in the direction it cannot see (it catches emptyState used for
//      a FAILURE, not errorState used for an absence).
//   3. THE FIRST-RUN GATE PRECEDES EVERY HOST. Shared with `test/emptyStates.test.js`, which
//      holds the return ahead of the first `el("canvas"`; what is added here is the other
//      half — the gate is ahead of the swrCall too, so a first run does not fetch a page it
//      is not going to draw.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const SRC = readFileSync(
  new URL("../src/client/js/pages/coldZone.js", import.meta.url), "utf8",
);
const CODE = code(SRC);

describe("the mode caption is the first thing painted, in all three branches", () => {
  it("appends denomNote(coldModeCaption(view)) before either notice and before the cards", () => {
    const caption = CODE.indexOf("denomNote(coldModeCaption(view))");
    expect(caption, "the page never paints the mode caption").toBeGreaterThan(-1);
    // The two absences and the first figure card all come after it, inside the same paint.
    const notMeasurable = CODE.indexOf("The cold zone is not measured yet.");
    const notPopulated = CODE.indexOf("No asset is sitting still.");
    const kpis = CODE.indexOf("renderKpis(view)");
    expect(notMeasurable).toBeGreaterThan(caption);
    expect(notPopulated).toBeGreaterThan(caption);
    expect(kpis).toBeGreaterThan(caption);
  });

  it("clears the host BEFORE the caption, so a repaint cannot stack two of them", () => {
    const clearAt = CODE.indexOf("clear(host);");
    const caption = CODE.indexOf("denomNote(coldModeCaption(view))");
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(caption);
  });

  // PERTURBATION: the ordering this describe exists to catch, run through the same reads.
  it("the check catches a caption painted under the cards", () => {
    const REGRESSED = code(`
      paint = (model) => {
        const view = coldZoneView(model);
        clear(host);
        renderKpis(view);
        host.append(denomNote(coldModeCaption(view)));
      };
    `);
    expect(REGRESSED.indexOf("renderKpis(view)"))
      .toBeLessThan(REGRESSED.indexOf("denomNote(coldModeCaption(view))"));
  });
});

describe("neither absence is dressed as a failure", () => {
  it("draws both notices through emptyState with variant: \"notice\"", () => {
    const notices = CODE.match(/variant: "notice"/g) || [];
    // Two page-level absences plus the four section-level ones (no support group has an asset,
    // no asset is cold, no asset to plot) — every one of them a state, none of them a failure.
    expect(notices.length).toBeGreaterThanOrEqual(2);
    for (const heading of [
      "The cold zone is not measured yet.",
      "No asset is sitting still.",
    ]) {
      const at = CODE.indexOf(heading);
      expect(at, heading + " is not drawn at all").toBeGreaterThan(-1);
      // The `{ variant: "notice" }` that closes that call sits within the next few lines.
      expect(CODE.slice(at, at + 400), heading + " is not a notice")
        .toContain('variant: "notice"');
    }
  });

  it("reaches for errorState exactly once, on the RPC that did not answer", () => {
    const calls = CODE.match(/errorState\(/g) || [];
    expect(calls).toHaveLength(1);
    expect(CODE).toContain('errorState("Couldn\'t load the cold zone."');
  });

  it("never passes a \"Couldn't …\" message to emptyState", () => {
    expect(/emptyState\(\s*"Couldn't /.test(CODE)).toBe(false);
  });
});

describe("the first-run gate runs before anything is fetched or built", () => {
  it("gates on boot.latestScan and returns before the swrCall", () => {
    const gate = CODE.indexOf("if (!boot.latestScan)");
    // The call is spread over several lines, so the RPC NAME is the anchor rather than the
    // `swrCall(` that opens it.
    const fetchAt = CODE.indexOf('"api_getColdZonePage"');
    expect(gate).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(gate, "the page fetches a model it is not going to draw").toBeLessThan(fetchAt);
  });

  it("uses the shared firstRunNotice rather than a hand-rolled emptyState", () => {
    expect(CODE).toContain("firstRunNotice({");
    expect(CODE).toMatch(/firstRunNotice\(\{[\s\S]{0,400}?\}\)\);?\s*\n\s*return;/);
  });
});

describe("the page is wired to this register's shared shape", () => {
  it("takes its h1 from PAGES by naming its own route", () => {
    expect(CODE).toContain('route: "coldZone"');
  });

  it("draws the scope chips, so every figure below says what it answers for", () => {
    expect(CODE).toContain("scopeBar({ domain, supportGroup, onClear: ctx.clearScope })");
  });

  it("says out loud that an active support-group scope collapses the roll-up", () => {
    expect(CODE).toContain("if (supportGroup)");
    expect(CODE).toContain("this roll-up has one");
  });

  it("names the unrefreshed support-group map when every asset lands in one bucket", () => {
    expect(CODE).toContain("noGroup === t.assets");
    expect(CODE).toContain("Refresh support groups");
  });
});

describe("the scatter follows the app's chart contract", () => {
  it("goes through loadCharts(), ships a chartTable twin and falls back to chartUnavailable", () => {
    expect(CODE).toContain("api.coldZoneScatter(canvas, points,");
    expect(CODE).toContain("chartTable({");
    expect(CODE).toContain("chartUnavailable(canvas)");
  });

  it("destroys the chart on teardown, so a route change leaves no live Chart behind", () => {
    expect(CODE).toMatch(/onPageTeardown\(\(\) => \{[\s\S]{0,200}destroyChart\(canvas\)/);
  });

  it("hands the canvas the effective line and the mode, never the fixed window", () => {
    const call = CODE.slice(
      CODE.indexOf("api.coldZoneScatter(canvas, points,"),
      CODE.indexOf("api.coldZoneScatter(canvas, points,") + 220,
    );
    expect(call).toContain("thresholdDays: view.coldAfterDays");
    expect(call).toContain("mode: view.mode");
    expect(call).not.toContain("fixedAfterDays");
  });
});

describe("the heat table carries its shade as a redundancy, never as the reading", () => {
  it("stamps data-level from the model and still prints both numbers in the cell", () => {
    expect(CODE).toContain('"data-level": String(cell.level)');
    expect(CODE).toContain("fmtCount(cell.count)");
    expect(CODE).toContain('fmtCount(cell.open) + " open"');
  });

  it("takes its header from the payload's own bucket labels", () => {
    expect(CODE).toContain("for (const label of heat.columns)");
  });
});
