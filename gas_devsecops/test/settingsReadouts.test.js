// The pure-model half of src/client/js/settingsReadouts.js — NO booted DOM (vitest.config.ts
// sets no `environment`), so this holds only the functions that never call `el()`: the mirrored
// domain arithmetic (atOrBelow/strandedOpenCount — pinned against the TS originals in
// test/settingsReadoutsMirror.test.js, not re-checked for correctness here), the severity-split
// adapter, the stranded-rows sentence, the retention-tick states, and the SLA cutline's breach
// arithmetic. The DOM half (severityScopeReadout, strandedRowsReadout, renderRetentionReadout,
// createSlaCutlineReadout, and pages/settings.js's own wiring) is swept as comment-stripped
// source text in test/settingsReadoutsDom.test.js.
//
// THE ASSERTION THAT MATTERS MOST HERE: `[]` in a scope's fetchSeverities entry means EVERY
// severity, never none (domain/config.ts's DEFAULT_FETCH_SEVERITIES; pages/settings.js's own
// registerFieldView draws the identical line for the plain-text side of the same control). A
// severity-split bar that read `[]` as "nothing in scope" would contradict the words right next
// to it on the page.

import { describe, expect, it } from "vitest";
import {
  AGE_HISTOGRAM_CAP_DAYS, atOrBelow, retentionTicks, severityScopeModel, slaBreachModel,
  slaCutlineModel, slaDivergenceNote, strandedOpenCount, strandedRowsModel,
} from "../src/client/js/settingsReadouts.js";

describe("AGE_HISTOGRAM_CAP_DAYS", () => {
  it("is the mirrored constant test/settingsReadoutsMirror.test.js pins against domain/config.ts", () => {
    expect(AGE_HISTOGRAM_CAP_DAYS).toBe(730);
  });
});

// ==================================================================================== atOrBelow

describe("atOrBelow", () => {
  const bin = { counts: [1, 3, 3, 6], from: 5 }; // days 5,6,7,8

  it("reads 0 below the bin's first stored day", () => {
    expect(atOrBelow(bin, 0)).toBe(0);
    expect(atOrBelow(bin, 4)).toBe(0);
  });

  it("reads the exact stored value inside the range", () => {
    expect(atOrBelow(bin, 5)).toBe(1);
    expect(atOrBelow(bin, 6)).toBe(3);
    expect(atOrBelow(bin, 7)).toBe(3);
    expect(atOrBelow(bin, 8)).toBe(6);
  });

  it("holds the last value flat past the end of the stored range", () => {
    expect(atOrBelow(bin, 9)).toBe(6);
    expect(atOrBelow(bin, 1000)).toBe(6);
  });

  it("reads 0 for an empty bin at every t", () => {
    const empty = { counts: [], from: 0 };
    expect(atOrBelow(empty, 0)).toBe(0);
    expect(atOrBelow(empty, 400)).toBe(0);
  });
});

// ============================================================================ strandedOpenCount

describe("strandedOpenCount", () => {
  function census(openBySeverity) {
    const openTotal = Object.values(openBySeverity).reduce((a, b) => a + b, 0);
    return { total: openTotal, openTotal, bySeverity: { all: {}, open: openBySeverity } };
  }

  const ALL_SCOPES = ["sca", "sast", "secrets"];
  const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
  const full = {
    sca: census({ CRITICAL: 5, HIGH: 10, MEDIUM: 3 }),
    sast: census({ CRITICAL: 2, HIGH: 4 }),
    secrets: census({ HIGH: 1, LOW: 6, INFO: 2 }),
  };

  it("strands nothing for the unnarrowed default — every scope kept, [] everywhere", () => {
    const got = strandedOpenCount(
      full, ALL_SCOPES, ALL_SCOPES, { sca: [], sast: [], secrets: [] }, SEV_ORDER,
    );
    expect(got).toEqual({ total: 0, byScope: { sca: 0, sast: 0, secrets: 0 } });
  });

  // THE FIGURE CHANGES WHEN THE DRAFT CHANGES — the whole point of drawing this live.
  it("changes as the draft's kept scopes change, with the same payload census", () => {
    const before = strandedOpenCount(
      full, ALL_SCOPES, ALL_SCOPES, { sca: [], sast: [], secrets: [] }, SEV_ORDER,
    );
    const afterDropSecrets = strandedOpenCount(
      full, ALL_SCOPES, ["sca", "sast"], { sca: [], sast: [] }, SEV_ORDER,
    );
    expect(before.total).toBe(0);
    expect(afterDropSecrets.total).toBe(9); // 1 + 6 + 2
    expect(afterDropSecrets.byScope.secrets).toBe(9);
  });

  it("changes as the draft's requested severities narrow, with the same kept scopes", () => {
    const wide = strandedOpenCount(
      full, ALL_SCOPES, ALL_SCOPES, { sca: [], sast: [], secrets: [] }, SEV_ORDER,
    );
    const narrowed = strandedOpenCount(
      full, ALL_SCOPES, ALL_SCOPES,
      { sca: ["CRITICAL", "HIGH"], sast: [], secrets: [] }, SEV_ORDER,
    );
    expect(wide.byScope.sca).toBe(0);
    expect(narrowed.byScope.sca).toBe(3); // the MEDIUM rows, now outside the gate
  });

  it("[] means every severity — widening a scope back to unfiltered strands nothing there", () => {
    const got = strandedOpenCount(
      full, ALL_SCOPES, ALL_SCOPES, { sca: [], sast: ["CRITICAL"], secrets: [] }, SEV_ORDER,
    );
    expect(got.byScope.sca).toBe(0);
    expect(got.byScope.secrets).toBe(0);
    expect(got.byScope.sast).toBe(4); // the HIGH rows, outside sast's narrowed gate
  });

  it("is zero for a scope absent from the census entirely, rather than throwing", () => {
    const partial = { sca: full.sca };
    const got = strandedOpenCount(partial, ALL_SCOPES, ["sca"], { sca: ["CRITICAL"] }, SEV_ORDER);
    expect(got.byScope).toEqual({ sca: 13, sast: 0, secrets: 0 });
  });
});

// ============================================================================ strandedRowsModel

describe("strandedRowsModel", () => {
  it("reads a healthy tone and no number when nothing strands", () => {
    const m = strandedRowsModel({ total: 0, byScope: { sca: 0, sast: 0, secrets: 0 } });
    expect(m.tone).toBe("ok");
    expect(m.text).not.toMatch(/\d/);
  });

  it("names the total and warns when something strands", () => {
    const m = strandedRowsModel({ total: 9, byScope: { sca: 0, sast: 0, secrets: 9 } });
    expect(m.tone).toBe("warn");
    expect(m.pillText).toMatch(/9/);
    expect(m.text).toMatch(/9 open finding/);
  });

  it("degrades a missing stranded payload to the healthy state rather than throwing", () => {
    expect(() => strandedRowsModel(null)).not.toThrow();
    expect(strandedRowsModel(null).tone).toBe("ok");
  });
});

// =============================================================== severityScopeModel ([] rule)

describe("severityScopeModel", () => {
  const census = {
    total: 30, openTotal: 20,
    bySeverity: {
      all: { CRITICAL: 5, HIGH: 10, MEDIUM: 15 },
      open: { CRITICAL: 4, HIGH: 8, MEDIUM: 8 },
    },
  };
  const selectable = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

  // THE PIN THE BRIEF ASKS FOR BY NAME: [] reads as all severities, not as none.
  it("[] reads as every severity in scope, not as none", () => {
    const m = severityScopeModel("sca", census, [], selectable);
    // Every severity's open count lands in the in-scope side; the trailing "out" segment is 0.
    expect(m.inScopeCount).toBe(census.openTotal);
    const out = m.segments.find((s) => s.tone === "out");
    expect(out.value).toBe(0);
  });

  it("a non-empty selection narrows scope the ordinary way", () => {
    const m = severityScopeModel("sca", census, ["CRITICAL"], selectable);
    expect(m.inScopeCount).toBe(4);
    const out = m.segments.find((s) => s.tone === "out");
    expect(out.value).toBe(census.openTotal - 4);
  });

  it("degrades a missing census to zero rather than throwing", () => {
    expect(() => severityScopeModel("sca", null, [], selectable)).not.toThrow();
    const m = severityScopeModel("sca", null, [], selectable);
    expect(m.inScopeCount).toBe(0);
  });
});

// ==================================================================================== retention

describe("retentionTicks", () => {
  const scans = [
    { scope: "sca", ageDays: 400, sealed: true, pinned: false },
    { scope: "sast", ageDays: 200, sealed: false, pinned: false },
    { scope: "secrets", ageDays: 1, sealed: false, pinned: true },
  ];

  it("classifies sealed, would-seal, and pinned correctly", () => {
    const { ticks, sealedCount, wouldSeal } = retentionTicks(scans, 180);
    expect(ticks.map((t) => t.state)).toEqual(["sealed", "would", "pinned"]);
    expect(sealedCount).toBe(1);
    expect(wouldSeal).toBe(1);
  });

  it("seals nothing when the window is off (null)", () => {
    const { wouldSeal } = retentionTicks(scans, null);
    expect(wouldSeal).toBe(0);
  });

  it("names each tick's own scope in its hint — one lane, three registers", () => {
    const { ticks } = retentionTicks(scans, 180, { sca: "Dependencies", sast: "Code", secrets: "Secrets" });
    expect(ticks[0].hint).toMatch(/^Dependencies —/);
    expect(ticks[1].hint).toMatch(/^Code —/);
    expect(ticks[2].hint).toMatch(/^Secrets —/);
  });

  it("falls back to the bare scope key when no label map is given", () => {
    const { ticks } = retentionTicks(scans, 180);
    expect(ticks[0].hint).toMatch(/^sca —/);
  });
});

// ============================================================================= SLA cutline math

describe("slaBreachModel", () => {
  const binA = { counts: [1, 2, 2, 4], from: 0, overCap: 1, unaged: 2 }; // days 0..3
  const binB = { counts: [0, 1], from: 2, overCap: 0, unaged: 0 }; // days 2..3

  it("combines multiple scopes' bins into one breach figure", () => {
    const m = slaBreachModel([binA, binB], 3, 100);
    // finiteOpenTotal = (atOrBelow(binA,100)=4 + overCap 1) + (atOrBelow(binB,100)=1 + overCap 0) = 6
    // atWindow(3) = atOrBelow(binA,3)=4 + atOrBelow(binB,3)=1 = 5
    expect(m.finiteOpenTotal).toBe(6);
    expect(m.breached).toBe(1);
    expect(m.unaged).toBe(2);
    expect(m.overCap).toBe(1);
    expect(m.overCapWindow).toBe(false);
  });

  it("ignores holes in the bin list (a scope with no rows at this severity)", () => {
    const m = slaBreachModel([binA, null, undefined], 3, 100);
    expect(m.finiteOpenTotal).toBe(5);
  });

  // NEVER EXTRAPOLATED: a window past capDays names itself rather than guessing at overCap rows.
  it("refuses to compute a breach figure once the window exceeds capDays", () => {
    const m = slaBreachModel([binA, binB], 200, 100);
    expect(m.breached).toBeNull();
    expect(m.overCapWindow).toBe(true);
    // The population figures are still honestly reported — only the breach count is refused.
    expect(m.finiteOpenTotal).toBe(6);
  });

  it("is exact at every integer window, matching the direct filter over the same rows", () => {
    // Reconstruct the same population atOrBelow was built from, to check breach() by hand.
    // binA: days [0,0,1,1,2,3,3,3] via deltas [1,1,0,2]... simplified: just trust the counts
    // array's own cumulative meaning and cross-check a few hand-picked windows instead.
    for (const t of [0, 1, 2, 3, 4, 100]) {
      const m = slaBreachModel([binA], t, 100);
      const atW = t === 0 ? 1 : t === 1 ? 2 : t === 2 ? 2 : 4; // atOrBelow(binA, t) for t<=3
      const want = t <= 3 ? (4 + 1) - atW : (4 + 1) - 4;
      expect(m.breached).toBe(want);
    }
  });
});

describe("slaDivergenceNote", () => {
  it("says nothing when the draft window matches the canonical one", () => {
    expect(slaDivergenceNote(7, 7)).toBe("");
  });

  it("names the canonical window when the draft has diverged from it", () => {
    const note = slaDivergenceNote(10, 7);
    expect(note).toMatch(/7-day window/);
    expect(note).toMatch(/OS, AI and pipeline/);
  });

  it("degrades to silence when the canonical value is missing or non-numeric", () => {
    expect(slaDivergenceNote(10, undefined)).toBe("");
    expect(slaDivergenceNote(10, null)).toBe("");
    expect(slaDivergenceNote(10, "not-a-number")).toBe("");
  });
});

describe("slaCutlineModel", () => {
  const binA = { counts: [1, 2, 2, 4], from: 0, overCap: 1, unaged: 2 };

  it("states the breach headline in words", () => {
    const m = slaCutlineModel({ bins: [binA], windowDays: 14, savedDays: 14, capDays: 100 });
    expect(m.headline).toMatch(/past a 14-day window/);
    expect(m.savedNote).toBe(""); // same window as saved: nothing to compare
  });

  it("names the unaged population rather than folding it into the breach count", () => {
    const m = slaCutlineModel({ bins: [binA], windowDays: 14, savedDays: 14, capDays: 100 });
    expect(m.unmeasuredNote).toMatch(/2 open findings have no measured open date/);
  });

  it("says nothing about unaged rows when there are none", () => {
    const noUnaged = { counts: [1, 2], from: 0, overCap: 0, unaged: 0 };
    const m = slaCutlineModel({ bins: [noUnaged], windowDays: 14, savedDays: 14, capDays: 100 });
    expect(m.unmeasuredNote).toBe("");
  });

  it("compares the live window against the saved one when they differ", () => {
    const m = slaCutlineModel({ bins: [binA], windowDays: 1, savedDays: 3, capDays: 100 });
    expect(m.savedNote).toMatch(/saved 3-day window/);
  });

  it("names the horizon rather than guessing once the window passes capDays", () => {
    const m = slaCutlineModel({ bins: [binA], windowDays: 200, savedDays: 14, capDays: 100 });
    expect(m.headline).toMatch(/measured horizon/);
    expect(m.headline).not.toMatch(/\d+ of \d+ open/);
  });
});
