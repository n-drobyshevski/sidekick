// The Cold zone page's decisions, without a page.
//
// `src/client/js/pages/coldZoneModel.js` is the DOM-free twin of `pages/coldZone.js` (the
// convention `overviewModel.js` and `historyModel.js` already follow here), so every claim the
// page makes about a payload is a pure function call and can be checked on a hand-built
// object. There is no jsdom in this project (vitest.config.ts sets no `environment`); the DOM
// half is read as source text in `test/coldZoneDom.test.js`.
//
// WHAT THIS FILE IS ACTUALLY FOR. The domain module has its own suite
// (`test/coldZone.test.ts`) and this is not a second copy of it. What is pinned here is the
// set of refusals the PAGE owns and the domain cannot make for it:
//
//   * `measurable` decided from the SHAPE, so a payload that says `measurable: true` over a
//     null `totals` — an older server, a half-applied durable cache entry — draws a notice
//     rather than throwing inside a renderer.
//   * An explicit null stays null. A share that arrived as `null` is "there was nothing to
//     ask the question of", and rewriting it as 0 would be a claim nobody measured.
//   * NOTATION. Prose says "at least N"; a cell says "≥ N"; neither ever says ">". The caption
//     sweep below runs every combination of mode × measurable × eligible × floorApplied ×
//     boundOnly and asserts both halves on every single sentence.
//   * The census is a PARTITION. cold + warm + watching + clear === observed, and
//     observed + unobserved === assets. `unitChartModel` throws when segments overflow their
//     stated total, so a payload that broke the partition would fail loudly — pinned here so
//     the identity is written down somewhere a reader can find it.
//
// EVERY GUARD IS PERTURBED (CLAUDE.md: "a guard that fires on nothing is a finding, not a
// pass"): each block that asserts a refusal also shows the tempting rewrite giving the wrong
// answer on the same input.

import { describe, expect, it } from "vitest";

import {
  COLD_VERDICT_LABEL, GROUP_VERDICT_LABEL, NO_GROUP, applyColdSelection, boundOnlySentence,
  coldAssetRows, coldBandDefs, coldBandKeyModel, coldBandRows, coldBandScale, coldCensusModel,
  coldGroupRows, coldGroupScatterPoints, coldKpiCards, coldModeCaption, coldScatterPoints,
  coldSelection, coldSelectionNote, coldZoneView, coldestShareNote, groupCountNote,
  severitiesNote, unmeasurableNote,
} from "../src/client/js/pages/coldZoneModel.js";

// --------------------------------------------------------------------------- fixtures

/** A `ColdZoneTotals`, zeroed, so a case states only the fields it is about. */
function totals(over = {}) {
  return {
    assets: 0,
    assets_observed: 0,
    assets_unobserved: 0,
    assets_unobserved_open: 0,
    assets_unobserved_clear: 0,
    assets_with_open: 0,
    cold_assets: 0,
    watching_assets: 0,
    warm_assets: 0,
    clear_assets: 0,
    open_findings: 0,
    open_in_cold: 0,
    high_risk_in_cold: 0,
    open_in_unobserved: 0,
    cold_asset_share_pct: null,
    cold_backlog_share_pct: null,
    groups: 0,
    groups_fully_cold: 0,
    groups_partly_cold: 0,
    groups_in_coldest_share: 0,
    assets_no_support_group: 0,
    buckets: [0, 0, 0, 0, 0],
    bucket_open: [0, 0, 0, 0, 0],
    ...over,
  };
}

/** A page payload carrying a `ColdZoneResult`. */
function payload(over = {}) {
  return {
    coldZone: {
      measurable: true,
      mode: "fixed",
      cold_after_days: 90,
      fixed_after_days: 90,
      target_share_pct: null,
      achieved_share_pct: null,
      floor_days: null,
      floor_applied: false,
      derived_days: null,
      eligible_assets: 0,
      cold_bound_only: 0,
      observed_from: "2026-01-01T00:00:00.000Z",
      as_of: "2026-06-01T00:00:00.000Z",
      bucket_edges: [0, 30, 60, 90],
      bucket_labels: ["0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable"],
      assets: [],
      groups: [],
      totals: totals(),
      row_count: 0,
      dropped_no_asset: 0,
      unclassified_rows: 0,
      severities_without_scan: [],
      ...over,
    },
  };
}

function asset(over = {}) {
  return {
    asset_id: "a1",
    asset_name: "a1",
    asset_type: "VIRTUAL_MACHINE",
    cloud: "AWS",
    support_group: "Payments",
    open_findings: 1,
    open_high_risk: 0,
    oldest_open_age_days: 10,
    last_movement_at: null,
    idle_days: null,
    idle_bound_days: null,
    idle_is_bound: false,
    idle_reading_days: null,
    observed: true,
    last_observed_at: null,
    unobserved_for_days: null,
    disappeared_at: null,
    disappeared_at_last_observation: 0,
    reopened_open: 0,
    verdict: "warm",
    cold: false,
    bucket: 0,
    ...over,
  };
}

function group(over = {}) {
  return {
    support_group: "Payments",
    label: "Payments",
    assets: 1,
    assets_observed: 1,
    assets_unobserved: 0,
    assets_with_open: 1,
    cold_assets: 0,
    watching_assets: 0,
    warm_assets: 1,
    clear_assets: 0,
    open_findings: 1,
    open_in_cold: 0,
    high_risk_in_cold: 0,
    open_in_unobserved: 0,
    cold_share_pct: 0,
    last_movement_at: null,
    verdict: "warm",
    relative_rank: 1,
    in_coldest_share: false,
    buckets: [1, 0, 0, 0, 0],
    bucket_open: [1, 0, 0, 0, 0],
    ...over,
  };
}

// =========================================================================================
//  1. coldZoneView — the shape decides, not the flag
// =========================================================================================

describe("coldZoneView: measurable is read off what arrived, never off the flag", () => {
  it("refuses a payload that claims measurable over a null totals", () => {
    const view = coldZoneView(payload({ totals: null }));
    expect(view.present).toBe(true);
    expect(view.measurable).toBe(false);
    // And the arrays are still real arrays, so a renderer that ran anyway cannot throw.
    expect(view.assets).toEqual([]);
    expect(view.groups).toEqual([]);
  });

  it("refuses a payload that claims measurable over a null assets or groups array", () => {
    expect(coldZoneView(payload({ assets: null })).measurable).toBe(false);
    expect(coldZoneView(payload({ groups: null })).measurable).toBe(false);
  });

  // PERTURBATION: the flag check this view exists to replace would have said "measurable" on
  // exactly the payload above, and the page would then have read `.cold_assets` off null.
  it("the tempting flag check passes the payload that would throw", () => {
    const p = payload({ totals: null });
    expect(p.coldZone.measurable).toBe(true);
    expect(() => p.coldZone.totals.cold_assets).toThrow();
  });

  it("tells an absent block (present: false) apart from an honest refusal", () => {
    const absent = coldZoneView({});
    expect(absent.present).toBe(false);
    expect(absent.measurable).toBe(false);
    const honest = coldZoneView(payload({ measurable: false, totals: null, assets: null, groups: null }));
    expect(honest.present).toBe(true);
    expect(honest.measurable).toBe(false);
  });

  it("survives a null, an array and a non-object model", () => {
    for (const model of [null, undefined, [], 7, "x"]) {
      const view = coldZoneView(model);
      expect(view.present).toBe(false);
      expect(view.assets).toEqual([]);
      expect(view.totals).toBeNull();
    }
  });
});

describe("coldZoneView: the mode is the exact word or it is fixed", () => {
  it("reads only the literal \"relative\" as relative", () => {
    expect(coldZoneView(payload({ mode: "relative" })).mode).toBe("relative");
    for (const m of ["Relative", "RELATIVE", 1, null, undefined, {}]) {
      expect(coldZoneView(payload({ mode: m })).mode).toBe("fixed");
    }
  });

  it("an older payload with no mode key at all reads as fixed", () => {
    const p = payload();
    delete p.coldZone.mode;
    expect(coldZoneView(p).mode).toBe("fixed");
  });
});

describe("coldZoneView: an explicit null is an answer, a missing key is a fallback", () => {
  it("keeps a null achieved_share_pct that the payload actually carried", () => {
    const view = coldZoneView(payload({
      achieved_share_pct: null,
      totals: totals({ cold_asset_share_pct: 42 }),
    }));
    expect(view.achievedSharePct).toBeNull();
  });

  it("falls back to the totals' own share only when the key is missing", () => {
    const p = payload({ totals: totals({ cold_asset_share_pct: 42 }) });
    delete p.coldZone.achieved_share_pct;
    expect(coldZoneView(p).achievedSharePct).toBe(42);
  });

  it("falls back to assets_with_open for eligible_assets on an older payload", () => {
    const p = payload({ totals: totals({ assets_with_open: 9 }) });
    p.coldZone.eligible_assets = null;
    expect(coldZoneView(p).eligibleAssets).toBe(9);
  });
});

describe("coldZoneView: populated is not measurable", () => {
  it("is false on a measurable register where nothing is open and nothing vanished", () => {
    const view = coldZoneView(payload({
      assets: [asset({ verdict: "clear", open_findings: 0 })],
      groups: [group()],
      totals: totals({ assets: 1, assets_observed: 1, clear_assets: 1 }),
    }));
    expect(view.measurable).toBe(true);
    expect(view.populated).toBe(false);
  });

  it("is true where something is open, and true where something vanished", () => {
    expect(coldZoneView(payload({
      assets: [asset()], groups: [group()],
      totals: totals({ assets: 1, assets_with_open: 1 }),
    })).populated).toBe(true);
    expect(coldZoneView(payload({
      assets: [asset({ observed: false })], groups: [group()],
      totals: totals({ assets: 1, assets_unobserved: 1 }),
    })).populated).toBe(true);
  });
});

describe("coldZoneView: bucket labels come from the payload or not at all", () => {
  it("carries the payload's own labels when measurable", () => {
    expect(coldZoneView(payload({
      assets: [asset()], groups: [group()], totals: totals({ assets: 1 }),
    })).bucketLabels).toEqual(["0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable"]);
  });

  it("is null when nothing is measurable — the heat table is not drawn then", () => {
    expect(coldZoneView(payload({ totals: null })).bucketLabels).toBeNull();
  });
});

// =========================================================================================
//  2. coldModeCaption — the sweep, and the notation rule on every sentence
// =========================================================================================

describe("coldModeCaption: every state has a sentence, and none of them says \">\"", () => {
  // Every combination the caption can be asked for. `measurable` × `mode` × eligible × the two
  // relative-only switches — the whole cross product, because the notation claim is about the
  // FUNCTION and not about any one branch of it.
  const cases = [];
  for (const measurable of [true, false]) {
    for (const mode of ["fixed", "relative"]) {
      for (const eligible of [0, 1, 46]) {
        for (const floorApplied of [true, false]) {
          for (const boundOnly of [0, 1, 3]) {
            cases.push({ measurable, mode, eligible, floorApplied, boundOnly });
          }
        }
      }
    }
  }

  it("sweeps " + cases.length + " states: a non-empty sentence every time", () => {
    for (const c of cases) {
      const text = coldModeCaption({
        measurable: c.measurable,
        mode: c.mode,
        coldAfterDays: 90,
        floorDays: 14,
        targetSharePct: 20,
        derivedDays: 47,
        floorApplied: c.floorApplied,
        achievedSharePct: c.eligible ? 21.7 : null,
        eligibleAssets: c.eligible,
        coldBoundOnly: c.boundOnly,
        totals: totals({ cold_assets: c.eligible ? 10 : 0 }),
      });
      expect(typeof text, JSON.stringify(c)).toBe("string");
      expect(text.trim().length, JSON.stringify(c)).toBeGreaterThan(0);
      // NOTATION, both halves, on every sentence: prose never carries the glyph, and a
      // duration in prose is always introduced by "at least" or by a mode clause that names
      // where the line landed.
      expect(text, JSON.stringify(c)).not.toContain(">");
      expect(text, JSON.stringify(c)).not.toContain("≥");
    }
  });

  it("says \"at least\" wherever the fixed window is the subject", () => {
    for (const c of cases.filter((x) => x.mode === "fixed")) {
      const text = coldModeCaption({
        measurable: c.measurable,
        mode: "fixed",
        coldAfterDays: 90,
        eligibleAssets: c.eligible,
        coldBoundOnly: c.boundOnly,
        totals: totals({ cold_assets: 1 }),
      });
      expect(text, JSON.stringify(c)).toContain("at least 90 days");
    }
  });

  it("names the derived line and the refusal when the floor holds", () => {
    const text = coldModeCaption({
      measurable: true, mode: "relative", coldAfterDays: 14, floorDays: 14, targetSharePct: 20,
      derivedDays: 6, floorApplied: true, achievedSharePct: 8.3, eligibleAssets: 12,
      coldBoundOnly: 0, totals: totals({ cold_assets: 1 }),
    });
    expect(text).toContain("14-day floor");
    expect(text).toContain("6 days");
    expect(text).toContain("smaller zone");
  });

  it("says the floor did NOT apply when it did not — the fact the derived line rests on", () => {
    const text = coldModeCaption({
      measurable: true, mode: "relative", coldAfterDays: 47, floorDays: 14, targetSharePct: 20,
      derivedDays: 47, floorApplied: false, achievedSharePct: 20.8, eligibleAssets: 24,
      coldBoundOnly: 0, totals: totals({ cold_assets: 5 }),
    });
    expect(text).toContain("It landed at 47 days idle");
    expect(text).toContain("did not apply");
  });

  it("refuses to report a share over an empty population", () => {
    const relative = coldModeCaption({
      measurable: true, mode: "relative", coldAfterDays: 14, floorDays: 14, targetSharePct: 20,
      eligibleAssets: 0, totals: totals(),
    });
    expect(relative).toContain("nothing to rank");
    expect(relative).not.toContain("0.0%");
    const fixed = coldModeCaption({
      measurable: true, mode: "fixed", coldAfterDays: 90, eligibleAssets: 0, totals: totals(),
    });
    expect(fixed).toContain("no share to report");
    expect(fixed).not.toContain("0.0%");
  });

  it("points a not-measurable fixed register at the control that sets the window", () => {
    const text = coldModeCaption({ measurable: false, mode: "fixed", coldAfterDays: 90 });
    expect(text).toContain("Lifecycle tab");
  });

  it("appends the bound-only cost, singular and plural, and only above zero", () => {
    const base = {
      measurable: true, mode: "fixed", coldAfterDays: 90, eligibleAssets: 10,
      achievedSharePct: 30, totals: totals({ cold_assets: 3 }),
    };
    expect(coldModeCaption({ ...base, coldBoundOnly: 0 })).not.toContain("lower bound");
    expect(coldModeCaption({ ...base, coldBoundOnly: 1 })).toContain("1 of them has");
    expect(coldModeCaption({ ...base, coldBoundOnly: 3 })).toContain("3 of them have");
  });

  it("answers on an empty view rather than throwing", () => {
    expect(typeof coldModeCaption(null)).toBe("string");
    expect(typeof coldModeCaption(undefined)).toBe("string");
    expect(typeof coldModeCaption({})).toBe("string");
  });
});

describe("boundOnlySentence: singular and plural", () => {
  it("agrees with its own count", () => {
    expect(boundOnlySentence(1)).toContain("1 of them has");
    expect(boundOnlySentence(4)).toContain("4 of them have");
  });
});

// =========================================================================================
//  3. coldKpiCards — four denominators, and none of them is "every asset" twice
// =========================================================================================

describe("coldKpiCards: each card names the population it was taken over", () => {
  const view = coldZoneView(payload({
    achieved_share_pct: 25,
    eligible_assets: 8,
    unclassified_rows: 5,
    assets: [asset()],
    groups: [group()],
    totals: totals({
      assets: 20, assets_with_open: 8, assets_unobserved: 3, cold_assets: 2,
      assets_unobserved_open: 2, assets_unobserved_clear: 1,
      open_findings: 100, open_in_cold: 30, high_risk_in_cold: 4, open_in_unobserved: 7,
      cold_asset_share_pct: 25, cold_backlog_share_pct: 30,
    }),
  }));
  const cards = coldKpiCards(view);
  const by = Object.fromEntries(cards.map((c) => [c.key, c]));

  it("draws exactly four", () => {
    expect(cards.map((c) => c.key))
      .toEqual(["coldAssets", "openInCold", "highRiskInCold", "unobserved"]);
  });

  it("gives every card a denominator, and no two the same one", () => {
    const sentences = cards.map((c) => c.denominator);
    for (const s of sentences) expect(typeof s).toBe("string");
    expect(new Set(sentences).size).toBe(4);
  });

  it("counts cold assets against the assets with open findings", () => {
    expect(by.coldAssets.value).toBe("2");
    expect(by.coldAssets.denominator).toContain("8 assets with open findings");
    expect(by.coldAssets.denominator).toContain("(25.0%)");
  });

  it("counts open-in-cold against the whole backlog", () => {
    expect(by.openInCold.denominator).toContain("100 open findings across every asset");
  });

  it("explains the high-risk figure's measurement gap when rows are unclassified", () => {
    expect(by.highRiskInCold.denominator).toContain("30 open findings on cold assets");
    expect(by.highRiskInCold.denominator).toContain("no risk class at all");
    expect(by.highRiskInCold.denominator).toContain("never high-risk ones");
  });

  it("says nothing about unclassified rows when there are none", () => {
    const clean = coldZoneView(payload({
      unclassified_rows: 0, assets: [asset()], groups: [group()],
      totals: totals({ assets: 1, assets_with_open: 1, open_in_cold: 3 }),
    }));
    const card = coldKpiCards(clean).find((c) => c.key === "highRiskInCold");
    expect(card.denominator).not.toContain("no risk class");
  });

  it("counts unobserved assets against every asset in the ledger", () => {
    expect(by.unobserved.value).toBe("3");
    expect(by.unobserved.denominator).toContain("20 assets in the ledger");
  });

  // THE FIGURE IS EVERY ASSET THE SCANNER LOST; THE SUB-LINE IS THE PART THAT IS WORK. On a
  // long-lived register most of the headline is assets that were fixed and then
  // decommissioned, so a sub-line reading "7 open findings on them" invited a reader to treat
  // all three as a coverage problem. It names the two still carrying backlog instead, and the
  // denominator says how many of the rest have nothing open at all.
  it("splits the sub-line and the denominator on which half is worth acting on", () => {
    expect(by.unobserved.sub).toBe("2 still carrying 7 open findings");
    expect(by.unobserved.denominator).toContain("1 of them have nothing open at all");
  });

  it("prints the em dash, not 0.0%, where a share is null", () => {
    const nullShare = coldZoneView(payload({
      achieved_share_pct: null,
      assets: [asset()], groups: [group()],
      totals: totals({ assets: 4, assets_with_open: 0, open_findings: 0 }),
    }));
    const cards2 = coldKpiCards(nullShare);
    const cold = cards2.find((c) => c.key === "coldAssets");
    expect(cold.sub).toBe("Of 0 with open findings");
    expect(cold.sub).not.toContain("0.0%");
  });

  it("names relative mode in the cold card's denominator, and only there", () => {
    const rel = coldZoneView(payload({
      mode: "relative", target_share_pct: 20, floor_days: 14, derived_days: 47,
      cold_after_days: 47, achieved_share_pct: 20.8, eligible_assets: 24,
      assets: [asset()], groups: [group()],
      totals: totals({ assets: 30, assets_with_open: 24, cold_assets: 5, open_findings: 50 }),
    }));
    const cards2 = coldKpiCards(rel);
    expect(cards2[0].denominator).toContain("Relative mode");
    expect(cards2[1].denominator).not.toContain("Relative mode");
    expect(cards2[2].denominator).not.toContain("Relative mode");
    expect(cards2[3].denominator).not.toContain("Relative mode");
  });

  it("returns nothing at all with no totals to read", () => {
    expect(coldKpiCards(coldZoneView(payload({ totals: null })))).toEqual([]);
    expect(coldKpiCards(null)).toEqual([]);
  });
});

// =========================================================================================
//  4. coldCensusModel — the partition identities
// =========================================================================================

describe("coldCensusModel: the five verdicts partition the register", () => {
  const t = totals({
    assets: 20, assets_observed: 17, assets_unobserved: 3,
    assets_unobserved_open: 1, assets_unobserved_clear: 2,
    cold_assets: 4, warm_assets: 6, watching_assets: 2, clear_assets: 5,
  });

  it("holds cold + warm + watching + clear === observed on the fixture", () => {
    expect(t.cold_assets + t.warm_assets + t.watching_assets + t.clear_assets)
      .toBe(t.assets_observed);
  });

  it("holds observed + unobserved === assets on the fixture", () => {
    expect(t.assets_observed + t.assets_unobserved).toBe(t.assets);
  });

  it("holds the two unobserved halves summing to the whole on the fixture", () => {
    expect(t.assets_unobserved_open + t.assets_unobserved_clear).toBe(t.assets_unobserved);
  });

  it("builds a measured model whose segment counts sum to the stated total", () => {
    const model = coldCensusModel({ totals: t });
    expect(model.measured).toBe(true);
    expect(model.segments.map((s) => s.key))
      .toEqual(["cold", "warm", "watching", "clear", "unobserved_open", "unobserved_clear"]);
    const sum = model.segments.reduce((a, s) => a + s.count, 0);
    expect(sum).toBe(t.assets);
  });

  it("hatches the three segments that are not measurements of idleness", () => {
    const model = coldCensusModel({ totals: t });
    const fills = Object.fromEntries(model.segments.map((s) => [s.key, s.fill]));
    expect(fills.watching).toBe("hatch");
    expect(fills.unobserved_open).toBe("hatch");
    expect(fills.unobserved_clear).toBe("hatch");
    // `clear` is a ring, not a fill: measured, and fine.
    expect(fills.clear).toBe("ring");
  });

  // THE SPLIT IS A SPLIT, NOT A RECOLOUR. The half carrying open findings is the alarm — same
  // `bad` tone as cold, different silhouette, because it is the same backlog with the
  // measurement missing. The half with nothing open is a decommissioned asset and stays
  // neutral; drawing it red would put "this machine no longer exists" beside real backlog.
  it("tells the two kinds of out-of-sight apart by tone as well as by word", () => {
    const model = coldCensusModel({ totals: t });
    const seg = Object.fromEntries(model.segments.map((s) => [s.key, s]));
    expect(seg.unobserved_open.tone).toBe("bad");
    expect(seg.unobserved_clear.tone).toBe("neutral");
    expect(seg.unobserved_open.label).toContain("backlog open");
    expect(seg.unobserved_clear.label).toContain("nothing open");
    // Same tone as cold, and the silhouette is what separates them.
    expect(seg.cold.tone).toBe("bad");
    expect(seg.cold.fill).toBe("solid");
  });

  // AMBER MEANS ONE THING ON THIS LATTICE, and `warm` is not it. A warm asset had a finding
  // resolve inside the window, which on this page's question is the system working; drawing
  // the LARGEST segment in `--warn` made the census read as roughly half problem and left
  // `watching` — the one genuine caveat — wearing the same tone as the healthy majority.
  it("keeps amber for the segment nobody could measure", () => {
    const model = coldCensusModel({ totals: t });
    const seg = Object.fromEntries(model.segments.map((s) => [s.key, s]));
    expect(seg.warm.tone).toBe("ok");
    expect(seg.watching.tone).toBe("warn");
    // ...and it is the ONLY one. A second amber segment would put the caveat back in a crowd.
    const amber = model.segments.filter((x) => x.tone === "warn").map((x) => x.key);
    expect(amber).toEqual(["watching"]);
  });

  // WARM AND CLEAR SHARE A TONE, so the silhouette is the only channel left to separate them.
  // This is the pair `unitChart`'s two channels exist for, and the assertion that would fail
  // the day someone "tidied" clear into a solid to match its neighbour.
  it("separates warm from clear by silhouette alone", () => {
    const model = coldCensusModel({ totals: t });
    const seg = Object.fromEntries(model.segments.map((s) => [s.key, s]));
    expect(seg.warm.tone).toBe(seg.clear.tone);
    expect(seg.warm.fill).not.toBe(seg.clear.fill);
    expect(seg.warm.fill).toBe("solid");
    expect(seg.clear.fill).toBe("ring");
  });

  // PERTURBATION: unitChartModel is the guard that would catch a sixth verdict silently
  // renormalising the lattice, so show it actually refusing an overlapping partition.
  it("refuses segments that overflow the stated total", () => {
    expect(() => coldCensusModel({
      totals: totals({ assets: 5, cold_assets: 4, warm_assets: 4 }),
    })).toThrow();
  });

  it("draws nothing over an empty or absent denominator", () => {
    expect(coldCensusModel({ totals: totals({ assets: 0 }) })).toBeNull();
    expect(coldCensusModel({ totals: null })).toBeNull();
    expect(coldCensusModel(null)).toBeNull();
  });
});

// =========================================================================================
//  5. The notes: each one is null rather than a sentence about zero
// =========================================================================================

describe("unmeasurableNote", () => {
  it("is null with no watching assets", () => {
    expect(unmeasurableNote({ totals: totals() })).toBeNull();
    expect(unmeasurableNote({ totals: null })).toBeNull();
    expect(unmeasurableNote(null)).toBeNull();
  });

  it("agrees with its own count", () => {
    expect(unmeasurableNote({ totals: totals({ watching_assets: 1 }) }))
      .toContain("1 asset has");
    expect(unmeasurableNote({ totals: totals({ watching_assets: 4 }) }))
      .toContain("4 assets have");
  });
});

describe("severitiesNote", () => {
  it("is null when every severity with rows had a flat scan covering it", () => {
    expect(severitiesNote({ severitiesWithoutScan: [] })).toBeNull();
    expect(severitiesNote({})).toBeNull();
    expect(severitiesNote(null)).toBeNull();
  });

  it("names the severities and says which way the undecidable case was resolved", () => {
    const text = severitiesNote({ severitiesWithoutScan: ["HIGH", "MEDIUM"] });
    expect(text).toContain("HIGH, MEDIUM");
    expect(text).toContain("kept as observed");
  });

  it("reaches the view straight off the payload, measurable or not", () => {
    const view = coldZoneView(payload({
      severities_without_scan: ["LOW"], totals: null,
    }));
    expect(view.measurable).toBe(false);
    expect(severitiesNote(view)).toContain("LOW");
  });
});

describe("groupCountNote", () => {
  it("names the (no support group) bucket only when the table holds it", () => {
    expect(groupCountNote({ totals: totals({ assets_no_support_group: 0 }) }, 3))
      .toBe("3 support groups.");
    expect(groupCountNote({ totals: totals({ assets_no_support_group: 2 }) }, 3))
      .toContain("including the 2 assets with no support group recorded");
  });

  it("agrees with its own counts", () => {
    expect(groupCountNote({ totals: totals({ assets_no_support_group: 1 }) }, 1))
      .toContain("1 support group,");
  });
});

describe("coldestShareNote", () => {
  it("is null when nobody is badged — which is every group in fixed mode", () => {
    expect(coldestShareNote({ groupsInColdestShare: 0 })).toBeNull();
    expect(coldestShareNote(null)).toBeNull();
  });

  it("states the clamp, so a reader counting fewer marks sees the clamp not a bug", () => {
    const text = coldestShareNote({ groupsInColdestShare: 2, targetSharePct: 20 });
    expect(text).toContain("2 support groups are in the coldest 20%");
    expect(text).toContain("never marked");
  });
});

// =========================================================================================
//  6. coldGroupRows (and the bands it now carries)
// =========================================================================================

describe("coldGroupRows", () => {
  it("keeps the payload's order and its own labels", () => {
    const view = coldZoneView(payload({
      assets: [asset()],
      groups: [group({ support_group: "B", label: "B" }), group({ support_group: "A", label: "A" })],
      totals: totals({ assets: 2, assets_with_open: 2 }),
    }));
    expect(coldGroupRows(view).map((r) => r.label)).toEqual(["B", "A"]);
  });

  it("files a null support group under the shared label rather than dropping it", () => {
    const view = coldZoneView(payload({
      assets: [asset()],
      groups: [group({ support_group: null, label: NO_GROUP })],
      totals: totals({ assets: 1, assets_with_open: 1 }),
    }));
    const [row] = coldGroupRows(view);
    expect(row.key).toBe(NO_GROUP);
    expect(row.label).toBe(NO_GROUP);
  });

  it("keeps a null cold share null — the cell that draws NO meter", () => {
    const view = coldZoneView(payload({
      assets: [asset()],
      groups: [group({ cold_share_pct: null })],
      totals: totals({ assets: 1, assets_with_open: 1 }),
    }));
    expect(coldGroupRows(view)[0].sharePct).toBeNull();
  });

  // PERTURBATION: the cast this refusal replaces would have drawn a full-width empty track
  // asserting that none of the group's assets has gone cold.
  it("Number(null) would have made that same cell a 0% claim", () => {
    expect(Number(null)).toBe(0);
  });

  it("carries a rank in both modes and no badge in fixed mode", () => {
    const view = coldZoneView(payload({
      assets: [asset()],
      groups: [group({ relative_rank: 3, in_coldest_share: false })],
      totals: totals({ assets: 1, assets_with_open: 1 }),
    }));
    expect(coldGroupRows(view)[0].relativeRank).toBe(3);
    expect(coldGroupRows(view)[0].inColdestShare).toBe(false);
  });

  it("prints every verdict as its own word", () => {
    for (const v of Object.keys(GROUP_VERDICT_LABEL)) {
      const view = coldZoneView(payload({
        assets: [asset()], groups: [group({ verdict: v })],
        totals: totals({ assets: 1, assets_with_open: 1 }),
      }));
      expect(coldGroupRows(view)[0].verdictWord).toBe(GROUP_VERDICT_LABEL[v]);
    }
  });
});



// =========================================================================================
//  7. coldAssetRows and coldScatterPoints
// =========================================================================================

describe("coldAssetRows: cold first, then unobserved, and nothing else in the list", () => {
  const view = coldZoneView(payload({
    assets: [
      asset({ asset_id: "warm", asset_name: "warm", verdict: "warm", open_findings: 99 }),
      asset({ asset_id: "gone", asset_name: "gone", verdict: "unobserved", observed: false, open_findings: 50 }),
      asset({ asset_id: "cold-small", asset_name: "cold-small", verdict: "cold", cold: true, open_findings: 2 }),
      asset({ asset_id: "cold-big", asset_name: "cold-big", verdict: "cold", cold: true, open_findings: 9 }),
      asset({ asset_id: "clear", asset_name: "clear", verdict: "clear", open_findings: 0 }),
      asset({ asset_id: "watch", asset_name: "watch", verdict: "watching", open_findings: 3 }),
    ],
    groups: [group()],
    totals: totals({ assets: 6, assets_with_open: 5 }),
  }));

  it("lists only the cold and the unobserved", () => {
    expect(coldAssetRows(view).map((r) => r.key))
      .toEqual(["cold-big", "cold-small", "gone"]);
  });

  it("orders cold before unobserved even where the unobserved backlog is larger", () => {
    const rows = coldAssetRows(view);
    expect(rows[0].cold).toBe(true);
    expect(rows[rows.length - 1].observed).toBe(false);
    expect(rows[rows.length - 1].open).toBeGreaterThan(rows[0].open);
  });

  it("prints a measured idle time plainly and a bound with the glyph", () => {
    const v = coldZoneView(payload({
      assets: [
        asset({ asset_id: "m", verdict: "cold", cold: true, idle_reading_days: 120, idle_days: 120 }),
        asset({
          asset_id: "b", verdict: "cold", cold: true, idle_reading_days: 100,
          idle_bound_days: 100, idle_is_bound: true,
        }),
      ],
      groups: [group()],
      totals: totals({ assets: 2, assets_with_open: 2 }),
    }));
    const by = Object.fromEntries(coldAssetRows(v).map((r) => [r.key, r]));
    expect(by.m.idleText).toBe("120.0 d");
    expect(by.m.idleBounded).toBe(false);
    expect(by.b.idleText).toBe("≥ 100.0 d");
    expect(by.b.idleBounded).toBe(true);
    // A CELL says "≥". Prose never does — see the caption sweep above.
    expect(by.b.idleText).not.toContain("at least");
  });

  it("files a null support group, type and cloud honestly", () => {
    const v = coldZoneView(payload({
      assets: [asset({
        verdict: "cold", cold: true, support_group: null, asset_type: null, cloud: null,
      })],
      groups: [group()],
      totals: totals({ assets: 1, assets_with_open: 1 }),
    }));
    const [row] = coldAssetRows(v);
    expect(row.group).toBe(NO_GROUP);
    expect(row.assetType).toBe("—");
    expect(row.cloud).toBe("—");
  });

  it("prints every verdict as its own word", () => {
    for (const verdict of Object.keys(COLD_VERDICT_LABEL)) {
      const v = coldZoneView(payload({
        assets: [asset({ verdict, cold: true })],
        groups: [group()],
        totals: totals({ assets: 1, assets_with_open: 1 }),
      }));
      expect(coldAssetRows(v)[0].verdictWord).toBe(COLD_VERDICT_LABEL[verdict]);
    }
  });

  // WHY AN ASSET WENT QUIET, CARRIED RATHER THAN DERIVED. The domain has published these three
  // since the module shipped and this row dropped all of them, which left the page unable to
  // say anything about an out-of-sight asset beyond the fact that it was one. Nothing here
  // decides anything: the row is a faithful carrier and the columns do the reading.
  it("carries the observation facts the domain publishes about a drop-out", () => {
    const v = coldZoneView(payload({
      assets: [asset({
        asset_id: "gone", observed: false, verdict: "unobserved", open_findings: 9,
        last_observed_at: "2026-03-04T00:00:00.000Z",
        unobserved_for_days: 197.4,
        disappeared_at: "2026-03-05T00:00:00.000Z",
        disappeared_at_last_observation: 12,
      })],
      groups: [group()],
      totals: totals({ assets: 1, assets_unobserved: 1, assets_unobserved_open: 1 }),
    }));
    const [row] = coldAssetRows(v);
    expect(row.lastObservedAt).toBe("2026-03-04T00:00:00.000Z");
    expect(row.lastObservedText).toBe("2026-03-04");
    expect(row.unobservedForDays).toBe(197.4);
    expect(row.disappearedText).toBe("2026-03-05");
    expect(row.disappearedCount).toBe(12);
  });

  // An explicit absence stays an absence: an asset nothing was ever seen on has no last-seen
  // date and no silence to measure, and "0 days invisible" would be a claim nobody made.
  it("prints an em dash rather than a date where nothing was ever observed", () => {
    const v = coldZoneView(payload({
      assets: [asset({ asset_id: "never", observed: false, verdict: "unobserved" })],
      groups: [group()],
      totals: totals({ assets: 1, assets_unobserved: 1 }),
    }));
    const [row] = coldAssetRows(v);
    expect(row.lastObservedAt).toBeNull();
    expect(row.lastObservedText).toBe("—");
    expect(row.unobservedForDays).toBeNull();
    expect(row.disappearedText).toBe("—");
    expect(row.disappearedCount).toBe(0);
  });

  it("carries the returned count beside a missing movement date", () => {
    const v = coldZoneView(payload({
      assets: [asset({ verdict: "cold", cold: true, last_movement_at: null, reopened_open: 3 })],
      groups: [group()],
      totals: totals({ assets: 1, assets_with_open: 1 }),
    }));
    const [row] = coldAssetRows(v);
    expect(row.movementText).toBe("—");
    expect(row.reopenedOpen).toBe(3);
  });
});

describe("coldScatterPoints: both filters earn their place", () => {
  const view = coldZoneView(payload({
    assets: [
      asset({
        asset_id: "plot", asset_name: "plot", verdict: "cold", cold: true, open_findings: 4,
        idle_reading_days: 120,
      }),
      asset({
        asset_id: "gone", asset_name: "gone", observed: false, open_findings: 9,
        idle_reading_days: 300,
      }),
      asset({ asset_id: "empty", asset_name: "empty", open_findings: 0, idle_reading_days: 10 }),
      asset({
        asset_id: "noidle", asset_name: "noidle", open_findings: 4, idle_reading_days: null,
      }),
    ],
    groups: [group()],
    totals: totals({ assets: 4, assets_with_open: 3 }),
  }));

  it("plots only observed assets that still have an open finding and a reading", () => {
    expect(coldScatterPoints(view).map((p) => p.label)).toEqual(["plot"]);
  });

  it("carries cold and bounded so the canvas can draw one dot either way", () => {
    const [p] = coldScatterPoints(view);
    expect(p).toEqual({ label: "plot", idleDays: 120, open: 4, cold: true, bounded: false });
  });

  it("is an empty list, never a throw, on an unmeasurable view", () => {
    expect(coldScatterPoints(coldZoneView(payload({ totals: null })))).toEqual([]);
    expect(coldScatterPoints(null)).toEqual([]);
  });
});

describe("coldGroupScatterPoints: the same scatter, one grain up", () => {
  /** An asset that qualifies for the scatter, named and placed in one call. */
  const plot = (id, group, idle, open, over = {}) => asset({
    asset_id: id, asset_name: id, support_group: group, idle_reading_days: idle,
    open_findings: open, ...over,
  });

  it("files the null support group under its own label rather than dropping it", () => {
    const v = coldZoneView(payload({
      assets: [plot("a", null, 40, 2), plot("b", "Payments", 50, 3)],
      groups: [group()],
      totals: totals({ assets: 2, assets_with_open: 2 }),
    }));
    expect(coldGroupScatterPoints(v).map((p) => p.label).sort())
      .toEqual([NO_GROUP, "Payments"]);
  });

  it("adds the members' backlog up, so the group dots total the asset dots", () => {
    const v = coldZoneView(payload({
      assets: [
        plot("a", "Payments", 10, 2), plot("b", "Payments", 20, 3), plot("c", "Retail", 30, 4),
      ],
      groups: [group()],
      totals: totals({ assets: 3, assets_with_open: 3 }),
    }));
    const groups = coldGroupScatterPoints(v);
    const sum = (points) => points.reduce((n, p) => n + p.open, 0);
    expect(sum(groups)).toBe(sum(coldScatterPoints(v)));
    expect(groups.find((p) => p.label === "Payments").open).toBe(5);
  });

  it("takes the middle member's reading on an odd count", () => {
    const v = coldZoneView(payload({
      assets: [
        plot("a", "Payments", 10, 1), plot("b", "Payments", 200, 1),
        plot("c", "Payments", 50, 1),
      ],
      groups: [group()],
      totals: totals({ assets: 3, assets_with_open: 3 }),
    }));
    expect(coldGroupScatterPoints(v)[0].idleDays).toBe(50);
  });

  it("takes the upper of the two middles on an even count, never their average", () => {
    // 10, 20, 40, 80 — the average of the middles would be 30, which no asset ever read.
    // The upper middle keeps "at least half have been idle at least this long" exact.
    const v = coldZoneView(payload({
      assets: [
        plot("a", "Payments", 10, 1), plot("b", "Payments", 20, 1),
        plot("c", "Payments", 40, 1), plot("d", "Payments", 80, 1),
      ],
      groups: [group()],
      totals: totals({ assets: 4, assets_with_open: 4 }),
    }));
    expect(coldGroupScatterPoints(v)[0].idleDays).toBe(40);
  });

  it("inherits cold and bounded from the median asset, never re-deciding either", () => {
    const v = coldZoneView(payload({
      assets: [
        plot("warm", "Payments", 10, 1),
        plot("mid", "Payments", 120, 1, { cold: true, verdict: "cold", idle_is_bound: true }),
        plot("cold", "Payments", 300, 1, { cold: true, verdict: "cold" }),
      ],
      groups: [group()],
      totals: totals({ assets: 3, assets_with_open: 3 }),
    }));
    expect(coldGroupScatterPoints(v)[0]).toEqual({
      label: "Payments", idleDays: 120, open: 3, cold: true, bounded: true,
    });
  });

  it("excludes from both the median and the sum exactly what the asset grain excludes", () => {
    const v = coldZoneView(payload({
      assets: [
        plot("keep", "Payments", 60, 2),
        plot("gone", "Payments", 900, 9, { observed: false }),
        plot("empty", "Payments", 10, 0),
        plot("noidle", "Payments", null, 7),
      ],
      groups: [group()],
      totals: totals({ assets: 4, assets_with_open: 1 }),
    }));
    expect(coldGroupScatterPoints(v)).toEqual([
      { label: "Payments", idleDays: 60, open: 2, cold: false, bounded: false },
    ]);
  });

  it("is empty exactly when the asset grain is, so no grain can strand a reader", () => {
    const none = coldZoneView(payload({
      assets: [plot("gone", "Payments", 900, 9, { observed: false })],
      groups: [group()],
      totals: totals({ assets: 1 }),
    }));
    expect(coldScatterPoints(none)).toEqual([]);
    expect(coldGroupScatterPoints(none)).toEqual([]);
    expect(coldGroupScatterPoints(coldZoneView(payload({ totals: null })))).toEqual([]);
    expect(coldGroupScatterPoints(null)).toEqual([]);
  });

  it("orders cold groups first, then by backlog, so the alt text reads worst-first", () => {
    const v = coldZoneView(payload({
      assets: [
        plot("a", "Small", 200, 1, { cold: true, verdict: "cold" }),
        plot("b", "Busy", 10, 50),
        plot("c", "Big", 200, 9, { cold: true, verdict: "cold" }),
      ],
      groups: [group()],
      totals: totals({ assets: 3, assets_with_open: 3 }),
    }));
    expect(coldGroupScatterPoints(v).map((p) => p.label)).toEqual(["Big", "Small", "Busy"]);
  });
});

// --------------------------------------------------------- the bands, and the cross-filter

const BAND_LABELS = ["0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable"];

function bandView(over = {}) {
  return {
    bucketLabels: BAND_LABELS,
    groups: [],
    assets: [],
    totals: totals(),
    ...over,
  };
}

describe("coldBandDefs: the labels are the payload's, the ranks are the positions'", () => {
  it("gives the four idle steps a rank and the unmeasurable tail none", () => {
    const defs = coldBandDefs(bandView());
    expect(defs.map((d) => d.rank)).toEqual([1, 2, 3, 4, null]);
    expect(defs.map((d) => d.label)).toEqual(BAND_LABELS);
    expect(defs.map((d) => d.key)).toEqual(
      ["band:0", "band:1", "band:2", "band:3", "band:4"]);
  });

  // THE LABELS MOVE WITH THE OPERATOR'S THRESHOLD and are never spelled here. At 120 days the
  // columns read 0-40/40-80/80-120; a hard-coded label would be a second, wrong statement of
  // the setting.
  it("takes whatever labels the payload sent", () => {
    const defs = coldBandDefs(bandView({ bucketLabels: ["0–40 d", "40–80 d", "x", "y", "z"] }));
    expect(defs[0].label).toBe("0–40 d");
  });

  it("draws nothing where nothing is measurable", () => {
    expect(coldBandDefs(bandView({ bucketLabels: [] }))).toEqual([]);
    expect(coldBandDefs(null)).toEqual([]);
  });
});

describe("coldGroupRows: the idle distribution arrives in the row it belongs to", () => {
  const groups = [
    { support_group: "A", label: "A", assets: 10, buckets: [4, 3, 2, 1, 0], bucket_open: [8, 6, 4, 2, 0] },
    { support_group: "B", label: "B", assets: 3, buckets: [1, 1, 1, 0, 0], bucket_open: [0, 0, 0, 0, 0] },
  ];

  it("carries every band, with the open findings as the segment's second figure", () => {
    const [a] = coldGroupRows(bandView({ groups }));
    expect(a.bands.map((b) => b.count)).toEqual([4, 3, 2, 1, 0]);
    expect(a.bands[0].extra).toBe("8 open");
    expect(a.bands.map((b) => b.rank)).toEqual([1, 2, 3, 4, null]);
    expect(a.bandTotal).toBe(10);
  });

  // A BAND WITH NOTHING OPEN CARRIES NO SECOND FIGURE. "0 open" in a sentence about an empty
  // band is noise, and the bar leaves the band out entirely.
  it("says nothing about open findings where there are none", () => {
    const [, b] = coldGroupRows(bandView({ groups }));
    expect(b.bands.every((x) => x.extra === "")).toBe(true);
  });
});

describe("coldBandScale: one unit per table, never per row", () => {
  it("is the largest row total", () => {
    expect(coldBandScale([{ bandTotal: 10 }, { bandTotal: 3 }, { bandTotal: 7 }])).toBe(10);
  });

  it("is 0 where there is nothing to scale against", () => {
    expect(coldBandScale([])).toBe(0);
    expect(coldBandScale(null)).toBe(0);
    expect(coldBandScale([{ bandTotal: null }])).toBe(0);
  });
});

describe("coldBandKeyModel: the heat table's totals row, still on the surface", () => {
  it("carries every band's estate-wide count and its open findings", () => {
    const keys = coldBandKeyModel(bandView({
      totals: totals({ buckets: [7, 5, 3, 2, 1], bucket_open: [14, 10, 6, 9, 0] }),
    }));
    expect(keys.map((k) => k.count)).toEqual([7, 5, 3, 2, 1]);
    expect(keys.map((k) => k.open)).toEqual([14, 10, 6, 9, 0]);
    expect(keys.map((k) => k.rank)).toEqual([1, 2, 3, 4, null]);
  });

  it("draws no control where nothing is measurable", () => {
    expect(coldBandKeyModel(bandView({ bucketLabels: [] }))).toEqual([]);
    expect(coldBandKeyModel({ bucketLabels: BAND_LABELS, totals: null })).toEqual([]);
  });
});

describe("coldBandRows: a band reaches assets the cold list never held", () => {
  const assets = [
    { asset_id: "warm1", asset_name: "warm1", support_group: "A", bucket: 0, open_findings: 2, cold: false, observed: true },
    { asset_id: "warm2", asset_name: "warm2", support_group: "B", bucket: 0, open_findings: 9, cold: false, observed: true },
    { asset_id: "cold1", asset_name: "cold1", support_group: "A", bucket: 3, open_findings: 5, cold: true, observed: true },
    { asset_id: "gone1", asset_name: "gone1", support_group: "A", bucket: null, open_findings: 4, cold: false, observed: false },
  ];
  const view = bandView({ assets });

  // THE WHOLE REASON THIS FUNCTION EXISTS. `coldAssetRows` is cold-or-unobserved only, so a
  // band-0 selection over it would light the picture and list nothing.
  it("lists warm assets, which coldAssetRows deliberately does not", () => {
    expect(coldAssetRows(view).map((r) => r.key)).toEqual(["cold1", "gone1"]);
    expect(coldBandRows(view, 0).map((r) => r.key)).toEqual(["warm2", "warm1"]);
  });

  // NULL IS A REAL ANSWER. An unobserved or clear asset has no bucket and belongs to no band;
  // a cast or a `== null` comparison would drop it into band 0.
  it("puts an asset with no bucket in no band at all", () => {
    for (const band of [0, 1, 2, 3, 4]) {
      expect(coldBandRows(view, band).map((r) => r.key)).not.toContain("gone1");
    }
  });

  it("refuses a band that is not a number", () => {
    for (const junk of [null, undefined, "0", NaN, {}]) {
      expect(coldBandRows(view, junk)).toEqual([]);
    }
  });

  it("carries the band on every row, so the table can name it without re-deriving it", () => {
    expect(coldBandRows(view, 3)[0].band).toBe(3);
  });
});

describe("coldSelection / applyColdSelection: two axes over rows already in hand", () => {
  const assets = [
    { asset_id: "c-a", asset_name: "c-a", support_group: "A", bucket: 3, open_findings: 5, cold: true, observed: true },
    { asset_id: "c-b", asset_name: "c-b", support_group: "B", bucket: 3, open_findings: 3, cold: true, observed: true },
    { asset_id: "w-a", asset_name: "w-a", support_group: "A", bucket: 1, open_findings: 2, cold: false, observed: true },
    { asset_id: "gone", asset_name: "gone", support_group: "A", bucket: null, open_findings: 4, cold: false, observed: false },
  ];
  const view = bandView({ assets });

  it("reads a band out of the cut rather than standing beside it", () => {
    expect(coldSelection("band:2", null).band).toBe(2);
    expect(coldSelection("cold", null).band).toBe(null);
    expect(coldSelection("all", "A").group).toBe("A");
  });

  it("refuses a cut that is not one", () => {
    for (const junk of [null, undefined, "", 7, {}]) {
      expect(coldSelection(junk, null).cut).toBe("all");
    }
    expect(coldSelection("band:x", null).band).toBe(null);
    expect(coldSelection("band:-1", null).band).toBe(null);
  });

  it("crosses a band with a support group", () => {
    const sel = coldSelection("band:3", "A");
    expect(applyColdSelection(view, sel).map((r) => r.key)).toEqual(["c-a"]);
  });

  it("falls back to the cold list when no band is chosen", () => {
    expect(applyColdSelection(view, coldSelection("all", null)).map((r) => r.key))
      .toEqual(["c-a", "c-b", "gone"]);
    expect(applyColdSelection(view, coldSelection("cold", null)).map((r) => r.key))
      .toEqual(["c-a", "c-b"]);
    expect(applyColdSelection(view, coldSelection("lost", null)).map((r) => r.key))
      .toEqual(["gone"]);
  });

  // THE CORNER THAT CANNOT HAPPEN, and the reason the band lives inside the cut. An unobserved
  // asset has no bucket, so "out of sight" crossed with any band is empty by construction —
  // and because the two share one control, a reader can never ask for it.
  it("cannot be asked for out-of-sight in an idle band", () => {
    expect(coldSelection("band:3", null).cut).toBe("band:3");
    expect(coldSelection("lost", null).band).toBe(null);
  });

  it("survives an absent selection", () => {
    expect(applyColdSelection(view, null).map((r) => r.key)).toEqual(["c-a", "c-b", "gone"]);
  });
});

describe("coldSelectionNote: one sentence, three consumers", () => {
  const view = bandView();

  it("names the group and the band it is showing", () => {
    const note = coldSelectionNote(view, coldSelection("band:3", "Payments"), 4);
    expect(note).toContain("Listing 4 assets");
    expect(note).toContain("Payments");
    expect(note).toContain("≥ 90 d");
  });

  it("names the cut where the cut is what narrowed it", () => {
    expect(coldSelectionNote(view, coldSelection("cold", null), 2)).toContain("cold only");
    expect(coldSelectionNote(view, coldSelection("lost", null), 1))
      .toContain("out of sight with backlog open");
  });

  it("says only the count where nothing is selected", () => {
    expect(coldSelectionNote(view, coldSelection("all", null), 12)).toBe("Listing 12 assets.");
    expect(coldSelectionNote(view, coldSelection("all", null), 1)).toBe("Listing 1 asset.");
  });
});
