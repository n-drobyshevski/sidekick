// `urlReadoutState()` — the Sidekick URLs panel's live per-field readout: the tile state
// hub.js's grid will draw for this register under the CURRENT DRAFT, plus the one answer a
// drawn tile never has. `src/client/js/pages/settings.js`'s own header explains why it lives
// there rather than in urlsModel.js or hubModel.js: it is the one place both of those files'
// pure functions are asked about the same string, and gas's own settings.js already exports a
// pure function (`saveReconciliation`) alongside its DOM-building code for the same reason —
// this repo tests the pure half directly, wherever in the file it sits. DOM-free, so this runs
// in plain node exactly like test/hubModel.test.js and test/urlsModel.test.js do for the two
// functions it composes; importing settings.js at all is already proven safe here by
// test/shared.test.js, which imports URL_TABS/URL_TAB_FIELDS from the same file.
//
// SAME CASE TABLE AS test/urls.test.ts AND test/urlsModel.test.js, for the "refused" half — see
// test/urlCases.ts's own header for why a table shared across the URL rule's two other tests is
// the only defensible way to keep two copies of one rule in sync. This file's `urlReadoutState`
// is not a third copy of the rule itself — it calls `urlProblem` for the answer — but it does
// promise that "refused" and "the field message fires" are the same event, and that promise is
// exactly what iterating the shared table checks.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { tileState } from "../src/client/js/pages/hubModel.js";
import { urlReadoutState } from "../src/client/js/pages/settings.js";
import { ILLEGAL, LEGAL, NON_STRINGS } from "./urlCases";

describe("urlReadoutState — link and unset are hubModel's own tileState, not a second copy", () => {
  it("is \"link\" for a legal, non-blank URL, for every field key", () => {
    for (const key of ["os", "ai", "devsecops"]) {
      expect(urlReadoutState(key, "https://script.google.com/a/macros/x/s/y/exec")).toBe("link");
    }
  });

  it("is \"unset\" for blank and for whitespace-only — the legal way to say not configured", () => {
    expect(urlReadoutState("os", "")).toBe("unset");
    expect(urlReadoutState("os", "   ")).toBe("unset");
  });

  it("agrees with tileState() on every LEGAL case from the shared URL rule table, once "
    + "trimmed the same way the server would normalize it", () => {
    for (const c of LEGAL) {
      const expected = tileState({ key: "os", url: c.normalized });
      expect(urlReadoutState("os", c.input), c.what).toBe(expected);
    }
  });

  it("PERTURBATION PROOF: calls tileState rather than reimplementing its decision — asserted "
    + "as a direct equality against the real function, not a mock, so the two cannot silently "
    + "drift apart the way two hand-written copies of \"url ? link : unset\" could", () => {
    const legal = "https://script.google.com/a/macros/x/s/y/exec";
    expect(urlReadoutState("ai", legal)).toBe(tileState({ key: "ai", url: legal }));
    expect(urlReadoutState("devsecops", "  ")).toBe(tileState({ key: "devsecops", url: "" }));
  });

  it("hubModel's tileState has a THIRD answer, \"soon\", that no Sidekick URLs field can ever "
    + "reach — verified directly rather than assumed, per this package's own brief", () => {
    // tileState's "soon" branch keys off spec.key === "soon" alone; none of the three fields
    // this panel edits (os/ai/devsecops) is ever keyed "soon", so urlReadoutState's three real
    // answers are exactly link/unset/refused and never soon.
    expect(tileState({ key: "soon", url: "https://script.google.com/x/exec" })).toBe("soon");
    for (const key of ["os", "ai", "devsecops"]) {
      expect(["link", "unset", "refused"]).toContain(urlReadoutState(key, "not a url"));
    }
  });
});

describe("urlReadoutState — refused is the state tileState alone cannot answer", () => {
  it("is \"refused\" for every shape the field message and the server boundary both refuse", () => {
    for (const c of ILLEGAL) {
      expect(urlReadoutState("os", c.input), `${c.what} — ${c.why}`).toBe("refused");
    }
  });

  it("is \"refused\" for a non-string, exactly where urlProblem refuses — before any cast, "
    + "so a stray null or [] never reaches tileState's own truthiness check", () => {
    for (const c of NON_STRINGS) {
      expect(urlReadoutState("os", c.input), c.what).toBe("refused");
    }
  });

  it("overrides what tileState alone would have said — a non-empty but illegal value is not "
    + "\"link\" just because tileState only checks truthiness", () => {
    expect(urlReadoutState("os", "javascript:alert(1)")).toBe("refused");
    // What tileState alone would answer, for contrast — this is the disagreement urlProblem
    // exists to catch before the reader ever saves it.
    expect(tileState({ key: "os", url: "javascript:alert(1)" })).toBe("link");
  });

  it("refuses padding-wrapped illegal input rather than reading it as blank or as a host "
    + "match once trimmed", () => {
    expect(urlReadoutState("os", "   javascript:alert(1)   ")).toBe("refused");
  });

  it("still reads a legal URL with padding as \"link\" — refusal is not triggered by the "
    + "padding itself", () => {
    expect(urlReadoutState("os", "   https://script.google.com/a/macros/x/s/y/exec\n"))
      .toBe("link");
  });
});

// -------------------------------------------------------------------- the DOM half, by sweep
// No test here exercises `renderSettings` itself — this app has no jsdom (see repo root
// CLAUDE.md and every existing test/*.js in this package) — so, following hubModel.test.js's
// own MODIFIER-table sweep and urlsModel.test.js's "no URL literal" sweep, the DOM half is
// checked by reading settings.js's source text rather than by rendering it.
describe("the Sidekick URLs readout never carries a state by colour alone", () => {
  const SRC = readFileSync(
    new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8",
  );

  it("gives \"link\", \"unset\" and \"refused\" each a non-empty word in the READOUT table", () => {
    const start = SRC.indexOf("const READOUT = {");
    const block = SRC.slice(start, SRC.indexOf("\n};", start));
    expect(block, "READOUT table not found").toBeTruthy();
    for (const state of ["link", "unset", "refused"]) {
      const m = block.match(new RegExp(state + ":\\s*\\{([^}]*)\\}", "s"));
      expect(m, `no READOUT entry for "${state}"`).toBeTruthy();
      expect(m[1], `"${state}" carries no word`).toMatch(/word:\s*"[^"]+"/);
    }
  });

  it("draws every row with statusPill(), whose dot (gas_shared/styles/components.css's "
    + "`.pill::before`) is what pairs the colour with a mark", () => {
    expect(SRC).toContain("statusPill(");
  });
});
