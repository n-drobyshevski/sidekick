// The three free readouts' pure halves (P8) — draft/payload in, figures out, no DOM. There is
// no jsdom in this suite, so `derivedFiveRsSelected`/`fiveRsSplitModel`/`fetchScopeReadoutModel`/
// `agentCallsText` are exactly the part of src/client/js/settingsReadouts.js vitest can hold;
// the thin DOM wrapper (`fiveRsSplit`, and the two `el(...)` lines in pages/settings.js) is
// swept as source text in test/settingsReadoutsDom.test.js, the same split gas/test/
// settingsDom.test.js and gas/test/settingsReadouts.test.js draw for their own siblings.

import { describe, expect, it } from "vitest";
import {
  agentCallsText, derivedFiveRsSelected, fetchScopeReadoutModel, fiveRsSplitModel,
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
