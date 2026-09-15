// The client's day-axis and stranded-rows readers against the domain layer's — the devsecops
// twin of gas/test/riskCube.test.js. The browser cannot import TypeScript (every page in this
// app states that rule; see e.g. src/client/js/pages/settings.js's own header), so
// src/client/js/settingsReadouts.js carries its own `atOrBelow`/`strandedOpenCount` mirrors
// rather than importing domain/settingsImpact.ts. This file is the only thing that keeps them
// honest: without it, the SLA cutline (the headline readout on the Deadlines tab) and the
// stranded-rows figure (the Register tab's) could silently disagree with the exact numbers
// domain/settingsImpact.ts computes and every other surface (readModels.ts, brick/) reports
// against — a drift that would show up as a support ticket, not a type error.

import { describe, expect, it } from "vitest";
import {
  ageHistogram as tsAgeHistogram,
  atOrBelow as tsAtOrBelow,
  strandedOpenCount as tsStrandedOpenCount,
} from "../src/domain/settingsImpact";
import { SCOPES, SEVERITY_ORDER } from "../src/domain/config";
import {
  atOrBelow as jsAtOrBelow,
  strandedOpenCount as jsStrandedOpenCount,
} from "../src/client/js/settingsReadouts.js";

function rng(seed) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ======================================================================================
// atOrBelow — exact at every integer window, over a real TS-built AgeBin.
// ======================================================================================

describe("the client's atOrBelow mirrors the domain layer's, exactly", () => {
  const SEVS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  const CAP = 60; // a small cap so "every integer window" is a fast, readable loop

  function population(n, seed) {
    const rnd = rng(seed);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const severity = SEVS[Math.floor(rnd() * SEVS.length)];
      const status = rnd() < 0.2 ? "RESOLVED" : "OPEN";
      const u = rnd();
      // A mix of ages straddling the cap, plus some unaged rows, so both overCap and unaged
      // are non-trivial in the resulting bins.
      const age_days = u < 0.08 ? null : Math.round(rnd() * (CAP + 20) * 10) / 10;
      rows.push({ severity, status, age_days });
    }
    return rows;
  }

  const rows = population(500, 20260913);
  const isOpen = (r) => r.status === "OPEN";
  const hist = tsAgeHistogram(rows, (r) => r.severity, isOpen, (r) => r.age_days, CAP);

  for (const sev of SEVS) {
    const bin = hist[sev];
    if (!bin) continue;
    it(`agrees with the TS original at every integer window, for ${sev}`, () => {
      for (let t = 0; t <= CAP; t++) {
        expect(jsAtOrBelow(bin, t)).toBe(tsAtOrBelow(bin, t));
      }
    });
  }

  it("agrees on an empty bin (a severity with no open rows in cap)", () => {
    const empty = { counts: [], from: 0, overCap: 0, unaged: 0 };
    for (let t = 0; t <= CAP; t++) {
      expect(jsAtOrBelow(empty, t)).toBe(tsAtOrBelow(empty, t));
    }
  });

  it("agrees well past the stored range (the held-flat tail)", () => {
    const bin = hist["CRITICAL"] || hist[Object.keys(hist)[0]];
    for (const t of [CAP, CAP + 1, CAP * 10]) {
      expect(jsAtOrBelow(bin, t)).toBe(tsAtOrBelow(bin, t));
    }
  });
});

// ======================================================================================
// strandedOpenCount — the client's mirror takes an explicit `allScopes` argument in place of
// the domain layer's module-level SCOPES import; every other argument lines up positionally.
// ======================================================================================

describe("the client's strandedOpenCount mirrors the domain layer's", () => {
  function census(openBySeverity) {
    const openTotal = Object.values(openBySeverity).reduce((a, b) => a + b, 0);
    return { total: openTotal, openTotal, bySeverity: { all: {}, open: openBySeverity } };
  }

  const full = {
    sca: census({ CRITICAL: 5, HIGH: 10, MEDIUM: 3 }),
    sast: census({ CRITICAL: 2, HIGH: 4 }),
    secrets: census({ HIGH: 1, LOW: 6, INFO: 2 }),
  };

  const cases = [
    { scopes: [...SCOPES], fetchSeverities: { sca: [], sast: [], secrets: [] } },
    { scopes: ["sca", "sast"], fetchSeverities: { sca: [], sast: [] } }, // secrets dropped
    { scopes: [...SCOPES], fetchSeverities: { sca: ["CRITICAL", "HIGH"], sast: [], secrets: [] } },
    { scopes: [...SCOPES], fetchSeverities: { sca: [], sast: ["CRITICAL"], secrets: [] } },
    { scopes: ["sast", "secrets"], fetchSeverities: { sast: ["CRITICAL"], secrets: [] } },
  ];

  for (const [i, c] of cases.entries()) {
    it(`case ${i} (${JSON.stringify(c)}) agrees with the domain layer`, () => {
      const ts = tsStrandedOpenCount(full, c.scopes, c.fetchSeverities, SEVERITY_ORDER);
      const js = jsStrandedOpenCount(full, [...SCOPES], c.scopes, c.fetchSeverities, SEVERITY_ORDER);
      expect(js).toEqual(ts);
    });
  }

  it("agrees on a partial census — a scope absent entirely", () => {
    const partial = { sca: full.sca };
    const ts = tsStrandedOpenCount(partial, ["sca"], { sca: ["CRITICAL"] }, SEVERITY_ORDER);
    const js = jsStrandedOpenCount(
      partial, [...SCOPES], ["sca"], { sca: ["CRITICAL"] }, SEVERITY_ORDER,
    );
    expect(js).toEqual(ts);
  });

  it("fuzzes random scope/severity selections and still agrees, 40 trials", () => {
    const rnd = rng(555);
    for (let trial = 0; trial < 40; trial++) {
      const keptScopes = SCOPES.filter(() => rnd() < 0.7);
      const fetchSeverities = {};
      for (const sc of keptScopes) {
        fetchSeverities[sc] = rnd() < 0.3 ? [] : SEVERITY_ORDER.filter(() => rnd() < 0.5);
      }
      const ts = tsStrandedOpenCount(full, keptScopes, fetchSeverities, SEVERITY_ORDER);
      const js = jsStrandedOpenCount(
        full, [...SCOPES], keptScopes, fetchSeverities, SEVERITY_ORDER,
      );
      expect(js, JSON.stringify({ keptScopes, fetchSeverities })).toEqual(ts);
    }
  });
});
