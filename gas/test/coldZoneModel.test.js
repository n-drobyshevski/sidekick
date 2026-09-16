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
  COLD_VERDICT_LABEL, GROUP_VERDICT_LABEL, NO_GROUP, boundOnlySentence, coldAssetRows,
  coldCensusModel, coldGroupRows, coldKpiCards, coldModeCaption, coldScatterPoints,
  coldZoneView, coldestShareNote, groupCountNote, heatLevel, heatModel, severitiesNote,
  unmeasurableNote,
} from "../src/client/js/pages/coldZoneModel.js";

// --------------------------------------------------------------------------- fixtures

/** A `ColdZoneTotals`, zeroed, so a case states only the fields it is about. */
function totals(over = {}) {
  return {
    assets: 0,
    assets_observed: 0,
    assets_unobserved: 0,
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
    expect(by.unobserved.sub).toContain("7 open findings on them");
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
    cold_assets: 4, warm_assets: 6, watching_assets: 2, clear_assets: 5,
  });

  it("holds cold + warm + watching + clear === observed on the fixture", () => {
    expect(t.cold_assets + t.warm_assets + t.watching_assets + t.clear_assets)
      .toBe(t.assets_observed);
  });

  it("holds observed + unobserved === assets on the fixture", () => {
    expect(t.assets_observed + t.assets_unobserved).toBe(t.assets);
  });

  it("builds a measured model whose segment counts sum to the stated total", () => {
    const model = coldCensusModel({ totals: t });
    expect(model.measured).toBe(true);
    expect(model.segments.map((s) => s.key))
      .toEqual(["cold", "warm", "watching", "clear", "unobserved"]);
    const sum = model.segments.reduce((a, s) => a + s.count, 0);
    expect(sum).toBe(t.assets);
  });

  it("hatches the two segments that are not measurements of idleness", () => {
    const model = coldCensusModel({ totals: t });
    const fills = Object.fromEntries(model.segments.map((s) => [s.key, s.fill]));
    expect(fills.watching).toBe("hatch");
    expect(fills.unobserved).toBe("hatch");
    // `clear` is a ring, not a fill: measured, and fine.
    expect(fills.clear).toBe("ring");
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
//  6. coldGroupRows / heatLevel / heatModel
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

describe("heatLevel: refused before any cast, and clamped at the top of the sheet", () => {
  it("is 0 for anything that was not a finite number", () => {
    for (const bad of [null, undefined, "3", [], {}, NaN, Infinity]) {
      expect(heatLevel(bad, 10), String(bad)).toBe(0);
      expect(heatLevel(3, bad), String(bad)).toBe(0);
    }
  });

  it("is 0 for a zero count and for a non-positive maximum", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(-1, 10)).toBe(0);
    expect(heatLevel(3, 0)).toBe(0);
    expect(heatLevel(3, -2)).toBe(0);
  });

  it("walks 1..4 and never asks for a fifth step", () => {
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(30, 100)).toBe(2);
    expect(heatLevel(60, 100)).toBe(3);
    expect(heatLevel(80, 100)).toBe(4);
    expect(heatLevel(100, 100)).toBe(4);
  });

  // PERTURBATION: without the clamp, count === max lands on floor(4) + 1 = 5 — a data-level
  // that matches no rule in the sheet, so the cell loses its shade while keeping its number.
  it("the unclamped arithmetic would have asked for level 5", () => {
    expect(1 + Math.floor((100 / 100) * 4)).toBe(5);
  });
});

describe("heatModel", () => {
  const view = () => coldZoneView(payload({
    assets: [asset()],
    groups: [
      group({ support_group: "A", label: "A", buckets: [4, 0, 0, 0, 1], bucket_open: [8, 0, 0, 0, 2] }),
      group({ support_group: "B", label: "B", buckets: [1, 2, 0, 0, 0], bucket_open: [1, 5, 0, 0, 0] }),
    ],
    totals: totals({
      assets: 8, assets_with_open: 8, buckets: [5, 2, 0, 0, 1], bucket_open: [9, 5, 0, 0, 2],
    }),
  }));

  it("takes its columns from the payload, never from a hardcoded list", () => {
    expect(heatModel(view()).columns)
      .toEqual(["0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable"]);
  });

  it("shades against the biggest single cell in the grid", () => {
    const heat = heatModel(view());
    expect(heat.max).toBe(4);
    expect(heat.rows[0].cells[0].level).toBe(4);
    expect(heat.rows[1].cells[0].level).toBe(2);
    expect(heat.rows[0].cells[2].level).toBe(0);
  });

  it("gives the totals row no shade at all", () => {
    const heat = heatModel(view());
    expect(heat.totals.label).toBe("All support groups");
    expect(heat.totals.cells.every((c) => c.level === 0)).toBe(true);
    expect(heat.totals.cells[0].count).toBe(5);
  });

  it("is null with no columns and null with no groups", () => {
    expect(heatModel(coldZoneView(payload({ totals: null })))).toBeNull();
    expect(heatModel(coldZoneView(payload({
      assets: [asset()], groups: [], totals: totals({ assets: 1, assets_with_open: 1 }),
    })))).toBeNull();
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
