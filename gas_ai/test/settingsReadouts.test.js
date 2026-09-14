// The free readouts' pure halves (P8, P10) — draft/payload in, figures out, no DOM. There is
// no jsdom in this suite, so `derivedFiveRsSelected`/`fiveRsSplitModel`/`fetchScopeReadoutModel`/
// `agentCallsText`/`categoryScopeRowsModel`/`categoryDroppedOnlyText`/`termCoverageModel` are
// exactly the part of src/client/js/settingsReadouts.js vitest can hold; the thin DOM wrappers
// (`fiveRsSplit`, `categoryScopeReadout`, `termCoverageReadout`, and the `el(...)` wiring in
// pages/settings.js) are swept as source text in test/settingsReadoutsDom.test.js, the same
// split gas/test/settingsDom.test.js and gas/test/settingsReadouts.test.js draw for their own
// siblings.

import { describe, expect, it } from "vitest";
import {
  agentCallsText, categoryDroppedOnlyText, categoryScopeRowsModel, derivedFiveRsSelected,
  fetchScopeReadoutModel, fiveRsSplitModel, termCoverageModel,
} from "../src/client/js/settingsReadouts.js";
import { absentText } from "../../gas_shared/ui/figures.js";

function policy(overrides) {
  return { policyId: "p1", reason: "noAiLink", selected: false, ...overrides };
}

describe("derivedFiveRsSelected", () => {
  it("reads a plain (unpinned) reason's selected flag as-is", () => {
    expect(derivedFiveRsSelected(policy({ reason: "noAiLink", selected: false }))).toBe(false);
    expect(derivedFiveRsSelected(policy({ reason: "crossMapped", selected: true }))).toBe(true);
    expect(derivedFiveRsSelected(policy({ reason: "linkedFindings", selected: true }))).toBe(true);
  });

  // THE ONE THAT MATTERS. A "pinnedIn" reason means the SERVER applied a saved pin to reach
  // `selected: true` — so the unpinned answer is the opposite, false, not a restatement of
  // `selected`. Reading `selected` directly here would report every already-pinned rule as
  // "derived" and make Reset to derived a no-op for the very rows it exists to unwind.
  it("inverts a saved pin to recover the UNDERLYING derivation", () => {
    expect(derivedFiveRsSelected(policy({ reason: "pinnedIn", selected: true }))).toBe(false);
    expect(derivedFiveRsSelected(policy({ reason: "pinnedOut", selected: false }))).toBe(true);
  });
});

describe("fiveRsSplitModel", () => {
  const rows = [
    policy({ policyId: "derived-in-1", reason: "crossMapped", selected: true }),
    policy({ policyId: "derived-in-2", reason: "linkedFindings", selected: true }),
    policy({ policyId: "derived-out-1", reason: "noAiLink", selected: false }),
    policy({ policyId: "saved-pinned-in", reason: "pinnedIn", selected: true }),
    policy({ policyId: "saved-pinned-out", reason: "pinnedOut", selected: false }),
  ];

  it("classifies a row with no pin at all by its own derivation", () => {
    const m = fiveRsSplitModel(rows, { in: [], out: [] });
    // The two ALREADY-SAVED pins (from `reason`) are NOT reflected in the draft's OWN pin
    // lists here, so they read by their underlying derivation — pinnedIn's true underlying
    // value is false (derivedFiveRsSelected inverts it), so it lands in derived-out; pinnedOut's
    // is true, so it lands in derived-in.
    expect(m.counts).toEqual({ derivedIn: 3, pinnedIn: 0, pinnedOut: 0, derivedOut: 2 });
  });

  it("counts a row the DRAFT pins in as pinned-in, whatever its saved reason says", () => {
    const m = fiveRsSplitModel(rows, { in: ["derived-out-1"], out: [] });
    expect(m.counts.pinnedIn).toBe(1);
    // derived-out-1 moves OUT of derived-out and into pinned-in; saved-pinned-in is still
    // unpinned in this draft and still reads by its own (inverted) derivation, false.
    expect(m.counts.derivedOut).toBe(1);
  });

  it("counts a row the DRAFT pins out as pinned-out, even one the server saved as pinnedIn", () => {
    // The operator flipped a previously-pinned-in rule back out THIS session — the draft pin
    // list is what decides the bucket, never the row's own stale `reason` gloss.
    const m = fiveRsSplitModel(rows, { in: [], out: ["saved-pinned-in"] });
    expect(m.counts.pinnedOut).toBe(1);
    // derived-in-1, derived-in-2 and saved-pinned-out were derived-in already (the last one
    // via its own inverted pinnedOut reason) and none of them is the row that just got pinned
    // out, so this count is unaffected by that move.
    expect(m.counts.derivedIn).toBe(3);
  });

  it("every rule lands in exactly one bucket — the four counts sum to the total", () => {
    const m = fiveRsSplitModel(rows, { in: ["derived-out-1"], out: ["derived-in-1"] });
    const sum = m.counts.derivedIn + m.counts.pinnedIn + m.counts.pinnedOut + m.counts.derivedOut;
    expect(sum).toBe(rows.length);
    expect(m.total).toBe(rows.length);
  });

  it("Reset to derived (both pin lists emptied) recomputes purely from each row's own reason", () => {
    const m = fiveRsSplitModel(rows, { in: [], out: [] });
    expect(m.counts.pinnedIn).toBe(0);
    expect(m.counts.pinnedOut).toBe(0);
  });

  it("names all four segments with a tone, even a zero-value one splitBar will skip", () => {
    const m = fiveRsSplitModel([], { in: [], out: [] });
    expect(m.segments.map((s) => s.tone)).toEqual(["in", "pinned-in", "pinned-out", "out"]);
    expect(m.segments.every((s) => s.value === 0)).toBe(true);
  });

  it("the caption names every bucket's figure in words, not only the bar", () => {
    const m = fiveRsSplitModel(rows, { in: [], out: [] });
    expect(m.caption).toMatch(/Derived in 3/);
    expect(m.caption).toMatch(/Derived out 2/);
    expect(m.caption).toMatch(/Pinned in 0/);
    expect(m.caption).toMatch(/Pinned out 0/);
  });

  it("survives an empty or missing row list and missing pins without throwing", () => {
    expect(fiveRsSplitModel([], { in: [], out: [] }).total).toBe(0);
    expect(fiveRsSplitModel(null, null).total).toBe(0);
    expect(fiveRsSplitModel(undefined, undefined).counts)
      .toEqual({ derivedIn: 0, pinnedIn: 0, pinnedOut: 0, derivedOut: 0 });
  });
});

// The Register tab's Fetch-scope control (project vs tenant). The tenant side has never been
// measured from this deployment and this model must never invent a figure for it — see the
// module's own header.
describe("fetchScopeReadoutModel", () => {
  it("states the project figure as measured when a real count is given", () => {
    const m = fetchScopeReadoutModel(99);
    expect(m.projectLine).toBe(
      "The configured Wiz project — 99 open AI-Security issues, measured under the current scope.",
    );
  });

  it("pluralises a single issue correctly", () => {
    expect(fetchScopeReadoutModel(1).projectLine).toMatch(/1 open AI-Security issue,/);
    expect(fetchScopeReadoutModel(1).projectLine).not.toMatch(/1 open AI-Security issues,/);
  });

  it("treats 0 as a real, measured answer — not the same as never having measured at all", () => {
    expect(fetchScopeReadoutModel(0).projectLine).toMatch(/0 open AI-Security issues,/);
    expect(fetchScopeReadoutModel(0).projectLine).not.toContain(absentText + ".");
  });

  it("reads anything that is not a finite number as unmeasured, never as a guessed zero", () => {
    for (const junk of [null, undefined, "99", NaN, Infinity, {}, []]) {
      expect(fetchScopeReadoutModel(junk).projectLine).toBe(`The configured Wiz project — ${absentText}.`);
    }
  });

  // THE CLAIM THIS MODULE EXISTS TO KEEP. No branch of this function may ever print a number
  // on the tenant side — there is no live Wiz call behind it, so any figure here would be
  // invented rather than measured.
  it("never prints a figure for the tenant side, under any input", () => {
    for (const projectOpenIssues of [0, 1, 99, null, undefined, "junk"]) {
      const line = fetchScopeReadoutModel(projectOpenIssues).tenantLine;
      expect(line).toContain(absentText);
      expect(line).toMatch(/never measured from this deployment/);
      expect(line).not.toMatch(/\d/);
    }
  });
});

// `autoExpand`'s stated cost, turned into a number a reader can multiply.
describe("agentCallsText", () => {
  it("states both halves of the rate with the same count", () => {
    expect(agentCallsText(12)).toBe("12 agents in the graph — 12 Wiz API calls per scan.");
  });

  it("pluralises a single agent and a single call correctly", () => {
    expect(agentCallsText(1)).toBe("1 agent in the graph — 1 Wiz API call per scan.");
  });

  // 0 is a real, measured answer (an empty graph) — it prints like any other count.
  it("prints 0 rather than treating it as absent", () => {
    expect(agentCallsText(0)).toBe("0 agents in the graph — 0 Wiz API calls per scan.");
  });

  it("says nothing — returns null — for a missing or non-numeric count, never a guess", () => {
    // null/undefined/NaN/an object/an array/a boolean all refuse to null via num()'s own
    // allowlist (figures.js) — Number(null) is 0 and finite, which is exactly the confident-
    // zero substitution this function must not make. -1 refuses on its own separate rule
    // (agentCallsText's business check), not through num().
    for (const junk of [null, undefined, NaN, {}, [], true, false, -1]) {
      expect(agentCallsText(junk)).toBeNull();
    }
  });

  // A numeric STRING is a legitimate count by num()'s own rule (the same allowlist every
  // other formatter in figures.js shares) — this app's real payload never sends one
  // (`agentCount` is always a server-side `Number(...)`), but the function should not refuse
  // a shape num() itself accepts.
  it("accepts a numeric string the same way num() does everywhere else", () => {
    expect(agentCallsText("12")).toBe("12 agents in the graph — 12 Wiz API calls per scan.");
  });
});

// ================================================================================ P10: category
// scope

// Three candidates, bit 0 = ai, bit 1 = vuln, bit 2 = threats — small enough to hand-check the
// masks. mask 1 = ai only (5 rows), mask 3 = ai+vuln (2 rows), mask 4 = threats only (7 rows),
// mask 0 = none of the three (1 row, e.g. fetched only under a category outside this list).
function cubeFixture({ cells, measuredCandidateIds } = {}) {
  const c = cells || { "1": 5, "3": 2, "4": 7, "0": 1 };
  return {
    total: Object.values(c).reduce((a, b) => a + b, 0),
    cells: c,
    candidateIds: ["ai", "vuln", "threats"],
    measuredCandidateIds: measuredCandidateIds || ["ai", "vuln", "threats"],
  };
}

const DATED_CANDIDATES = [
  { id: "ai", name: "AI Security", count: 99, measuredAt: "2026-08-23", measuredScope: "VALUE-CHAIN project" },
  { id: "vuln", name: "Vulnerability Assessment", count: 677, measuredAt: "2026-08-23", measuredScope: "VALUE-CHAIN project" },
  // No dated figure at all for this one — the DEFAULT_CATEGORY_IDS-only case, or simply a
  // candidate P9 never dated.
  { id: "threats", name: "High Profile Threats" },
];

describe("categoryScopeRowsModel", () => {
  it("reads each candidate's LIVE marginal off the joint cube, never a sum of overlapping cells", () => {
    // ai: masks with bit0 set -> mask1(5) + mask3(2) = 7. vuln: mask3(2). threats: mask4(7).
    const model = categoryScopeRowsModel(cubeFixture(), DATED_CANDIDATES);
    expect(model.scale).toBe(15);
    expect(model.rows.map((r) => [r.id, r.count])).toEqual([["ai", 7], ["vuln", 2], ["threats", 7]]);
  });

  // THE HONESTY LINE. A candidate outside measuredCandidateIds is unmeasured, and its count is
  // null — never a claimed 0, even though this fixture's cube happens to carry 7 rows stamped
  // "threats" (a category can be measured-with-rows or unmeasured; the cube's own bits decide,
  // not whether cells happen to be non-empty for a stray reason).
  it("reads a candidate outside measuredCandidateIds as UNMEASURED — count is null, never 0", () => {
    const cube = cubeFixture({ measuredCandidateIds: ["ai", "vuln"] });
    const model = categoryScopeRowsModel(cube, DATED_CANDIDATES);
    const threats = model.rows.find((r) => r.id === "threats");
    expect(threats.measured).toBe(false);
    expect(threats.count).toBeNull();
    const ai = model.rows.find((r) => r.id === "ai");
    expect(ai.measured).toBe(true);
    expect(ai.count).toBe(7);
  });

  it("carries the dated calibration figure through untouched, and null when P9 never dated one", () => {
    const model = categoryScopeRowsModel(cubeFixture(), DATED_CANDIDATES);
    expect(model.rows.find((r) => r.id === "ai").dated).toEqual({
      count: 99, measuredAt: "2026-08-23", measuredScope: "VALUE-CHAIN project",
    });
    expect(model.rows.find((r) => r.id === "threats").dated).toBeNull();
  });

  // THE DATED FIGURE AND THE LIVE COUNT ARE NEVER MIXED. A decoy dated count wildly different
  // from the live marginal must not perturb `count` — they are read from two independent
  // sources (the cube, and the candidate list) and this function never adds or compares them.
  it("never lets the dated figure influence the live count", () => {
    const decoy = [{ ...DATED_CANDIDATES[0], count: 999999 }];
    const cube = cubeFixture();
    const model = categoryScopeRowsModel(cube, decoy);
    expect(model.rows[0].count).toBe(7);
    expect(model.rows[0].dated.count).toBe(999999);
  });

  it("degrades to an empty model when the cube never arrived, rather than guessing", () => {
    expect(categoryScopeRowsModel(null, DATED_CANDIDATES)).toEqual({ scale: 0, rows: [] });
    expect(categoryScopeRowsModel(undefined, DATED_CANDIDATES)).toEqual({ scale: 0, rows: [] });
    expect(categoryScopeRowsModel(cubeFixture(), undefined).rows).toEqual([]);
  });
});

describe("categoryDroppedOnlyText — the dropped-category figure", () => {
  it("returns null when the cube never arrived", () => {
    expect(categoryDroppedOnlyText(null, ["vuln"], ["ai", "vuln", "threats"])).toBeNull();
  });

  it("names nothing dropped when the draft has not narrowed anything", () => {
    const text = categoryDroppedOnlyText(cubeFixture(), ["ai", "vuln", "threats"], ["ai", "vuln", "threats"]);
    expect(text).toMatch(/^Nothing in the current draft/);
  });

  // THE DROPPED-CATEGORY FIGURE CHANGES WHEN THE DRAFT CHANGES. Dropping "ai" and "threats"
  // (keeping only "vuln") counts rows stamped with a dropped bit and NOT the kept "vuln" bit:
  // mask1 (ai only, 5) qualifies, mask4 (threats only, 7) qualifies, mask3 (ai+vuln, 2) does
  // NOT — it still carries the kept "vuln" stamp and would resolve by that alone. Total: 12.
  it("counts open issues stamped ONLY with a category the draft just dropped", () => {
    const text = categoryDroppedOnlyText(cubeFixture(), ["vuln"], ["ai", "vuln", "threats"]);
    expect(text).toMatch(/^12 open issues are stamped only with/);
    expect(text).toMatch(/stop being refreshed/);
  });

  it("recomputes to a different figure for a different draft over the SAME saved selection", () => {
    const previous = ["ai", "vuln", "threats"];
    const dropAiAndThreats = categoryDroppedOnlyText(cubeFixture(), ["vuln"], previous);
    const dropNothing = categoryDroppedOnlyText(cubeFixture(), previous, previous);
    const dropThreatsOnly = categoryDroppedOnlyText(cubeFixture(), ["ai", "vuln"], previous);
    expect(dropAiAndThreats).not.toBe(dropNothing);
    expect(dropAiAndThreats).not.toBe(dropThreatsOnly);
    expect(dropThreatsOnly).toMatch(/^7 open issues/);
  });

  it("pluralises a single dropped-only issue correctly", () => {
    const cube = cubeFixture({ cells: { "1": 1, "3": 2 } }); // mask1 (ai only): 1 row
    const text = categoryDroppedOnlyText(cube, ["vuln"], ["ai", "vuln"]);
    expect(text).toMatch(/^1 open issue is stamped only with/);
  });

  // NEVER MIXED WITH THE DATED FIGURES — this function never even receives the candidate
  // list P9 dated, so no measuredAt/measuredScope string can appear in its output.
  it("never carries a dated figure — this is a live count only", () => {
    const text = categoryDroppedOnlyText(cubeFixture(), ["vuln"], ["ai", "vuln", "threats"]);
    expect(text).not.toMatch(/2026-08-23/);
    expect(text).not.toMatch(/VALUE-CHAIN/);
  });
});

// ================================================================================ P10: term
// coverage

function termCoverageFixture(overrides) {
  return {
    total: 100,
    rule: 100,
    time: { dueAt: 40, createdAt: 90 },
    exploitation: 30,
    adjacency: 10,
    ...overrides,
  };
}

describe("termCoverageModel", () => {
  it("returns null when the payload never arrived", () => {
    expect(termCoverageModel(null, "dueAtOnly")).toBeNull();
    expect(termCoverageModel(undefined, "dueAtOnly")).toBeNull();
  });

  it("names all four terms, in blend order", () => {
    const model = termCoverageModel(termCoverageFixture(), "dueAtOnly");
    expect(model.terms.map((t) => t.key)).toEqual(["rule", "time", "exploitation", "adjacency"]);
  });

  it("reads the CLOCK term off dueAt under dueAtOnly", () => {
    const model = termCoverageModel(termCoverageFixture(), "dueAtOnly");
    const time = model.terms.find((t) => t.key === "time").splitModel;
    // impactSplitModel's `count` is the UNMEASURED side: 100 - 40 = 60 rows cannot measure it.
    expect(time.segments.find((s) => s.tone === "in").value).toBe(40);
    expect(time.segments.find((s) => s.tone === "out").value).toBe(60);
  });

  // THE TIME COVERAGE FIGURE MOVES LIVE WHEN timeSource CHANGES — the whole reason this model
  // takes timeSource as an argument rather than reading one fixed field off the payload.
  it("reads the CLOCK term off createdAt under dueAtElseAge — a different figure, live", () => {
    const model = termCoverageModel(termCoverageFixture(), "dueAtElseAge");
    const time = model.terms.find((t) => t.key === "time").splitModel;
    expect(time.segments.find((s) => s.tone === "in").value).toBe(90);
    expect(time.segments.find((s) => s.tone === "out").value).toBe(10);
  });

  it("leaves the other three terms unaffected by timeSource", () => {
    const a = termCoverageModel(termCoverageFixture(), "dueAtOnly");
    const b = termCoverageModel(termCoverageFixture(), "dueAtElseAge");
    for (const key of ["rule", "exploitation", "adjacency"]) {
      const ma = a.terms.find((t) => t.key === key).splitModel;
      const mb = b.terms.find((t) => t.key === key).splitModel;
      expect(ma.segments).toEqual(mb.segments);
    }
  });

  it("clamps a measured count that exceeds the total rather than reading a negative unmeasured share", () => {
    const model = termCoverageModel(termCoverageFixture({ rule: 9001 }), "dueAtOnly");
    const rule = model.terms.find((t) => t.key === "rule").splitModel;
    expect(rule.segments.find((s) => s.tone === "in").value).toBe(100);
    expect(rule.segments.find((s) => s.tone === "out").value).toBe(0);
  });

  it("survives a zero-row queue without throwing", () => {
    const model = termCoverageModel(termCoverageFixture({
      total: 0, rule: 0, time: { dueAt: 0, createdAt: 0 }, exploitation: 0, adjacency: 0,
    }), "dueAtOnly");
    expect(model.total).toBe(0);
    expect(model.terms).toHaveLength(4);
  });
});
