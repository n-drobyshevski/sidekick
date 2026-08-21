// The comparison rules, which are where a delta tool quietly lies.
//
// Three properties matter more than the arithmetic, and each has a test that fails loudly if it
// erodes: an absent baseline is never a delta from zero; a measure whose population moved is
// judged on the RATE and not the raw count; and a confounded measure never reaches the evidence
// list. The first two were the readings that misled this investigation when they were done by
// eye, which is why they are pinned rather than assumed.

import { describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";
import {
  buildSnapshot,
  compareSnapshots,
  regressions,
  unconfounded,
  type Measure,
  type PostureSnapshot,
} from "../src/domain/postureDelta";

type Server = Awaited<ReturnType<typeof bootServer>> & {
  registerScopeDiagnostic(): string;
  pinPostureBaseline(): string;
  postureDelta(): string;
};

const snap = (measures: Measure[], at = "2026-08-20T00:00:00Z"): PostureSnapshot =>
  ({ at, measures });
const one = (deltas: ReturnType<typeof compareSnapshots>, key: string) =>
  deltas.filter((d) => d.key === key)[0];

describe("compareSnapshots — a scope change voids the whole comparison", () => {
  // The one change that moves EVERY measure here at once. Scope the sync to one business unit
  // and the edge rows, every reach stage and the signal count all drop together — for a reason
  // that has nothing to do with the collection this tool exists to verify. Two baselines pinned
  // across such a change compare different tenants, and without this they say so nowhere.
  const m: Measure[] = [{ key: "edge-rows", label: "Rows on ai_edges", value: 100, rising: "better" }];
  const scoped = (scope: string | undefined, value: number): PostureSnapshot => ({
    at: "2026-08-20T00:00:00Z",
    ...(scope === undefined ? {} : { scope }),
    measures: [{ ...m[0]!, value }],
  });

  it("confounds every measure when the two snapshots disagree about scope", () => {
    const d = one(compareSnapshots(scoped("", 13932), scoped("proj-value-chain", 826)), "edge-rows");
    expect(d.confound).toBeTruthy();
    expect(d.confound).toContain("project scope");
    // And it must not reach the evidence list — the whole point of a confound.
    expect(unconfounded(compareSnapshots(scoped("", 13932), scoped("proj-value-chain", 826))))
      .toHaveLength(0);
  });

  it("says nothing about scope when it did not change", () => {
    const d = one(compareSnapshots(scoped("proj-a", 100), scoped("proj-a", 120)), "edge-rows");
    expect(d.confound).toBeUndefined();
    expect(d.verdict).toBe("better");
  });

  it("does not read an unrecorded scope as tenant-wide", () => {
    // A baseline pinned before the field existed carries `undefined`. Treating that as ""
    // would invent the very fact in question and fire a confound on every old baseline —
    // absent is not zero here either.
    const d = one(compareSnapshots(scoped(undefined, 100), scoped("proj-a", 120)), "edge-rows");
    expect(d.confound).toBeUndefined();
  });

  it("keeps a measure's own confound alongside the scope one", () => {
    const withOwn: Measure[] = [{
      key: "register-signal", label: "Assets carrying any signal",
      value: 10, total: 20, rising: "better", confound: "its own reason",
    }];
    const before: PostureSnapshot = { at: "x", scope: "", measures: withOwn };
    const after: PostureSnapshot = { at: "y", scope: "proj-a", measures: withOwn };
    const d = one(compareSnapshots(before, after), "register-signal");
    expect(d.confound).toContain("project scope");
    expect(d.confound).toContain("its own reason");
  });
});

describe("compareSnapshots — absent is not zero", () => {
  it("reports no-baseline rather than a rise from nothing", () => {
    // "It went from nothing to 12" and "we did not look last time" are different claims, and a
    // tool that renders the second as the first manufactures a result.
    const after = snap([{ key: "edge-rows", label: "Rows", value: 12, rising: "better" }]);
    const d = one(compareSnapshots(snap([]), after), "edge-rows");
    expect(d.verdict).toBe("no-baseline");
    expect(d.delta).toBeNull();
    expect(d.before).toBeNull();
  });

  it("distinguishes a measured zero from an unmeasured one", () => {
    const before = snap([{ key: "edge-rows", label: "Rows", value: 0, rising: "better" }]);
    const after = snap([{ key: "edge-rows", label: "Rows", value: 12, rising: "better" }]);
    const d = one(compareSnapshots(before, after), "edge-rows");
    // A pinned zero IS a baseline, and this is the reading the whole exercise is for.
    expect(d.verdict).toBe("better");
    expect(d.delta).toBe(12);
  });

  it("reports not-recorded when the current build could not read the measure", () => {
    const before = snap([{ key: "edge-rows", label: "Rows", value: 4, rising: "better" }]);
    const after = snap([{ key: "edge-rows", label: "Rows", value: null, rising: "better" }]);
    expect(one(compareSnapshots(before, after), "edge-rows").verdict).toBe("not-recorded");
  });

  it("drops a baseline measure the current build no longer produces", () => {
    // A stale baseline entry is not a finding about posture.
    const before = snap([{ key: "gone", label: "Gone", value: 9, rising: "better" }]);
    const after = snap([{ key: "here", label: "Here", value: 1, rising: "better" }]);
    expect(compareSnapshots(before, after).map((d) => d.key)).toEqual(["here"]);
  });
});

describe("compareSnapshots — a moving population is judged on the rate", () => {
  it("calls a flat count against a grown register a regression", () => {
    // THE case that makes raw counts dishonest. 88 covered of 13,830 and 88 of 27,660 are not
    // the same coverage, and a raw delta of 0 says they are.
    const before = snap([
      { key: "reach-enriched", label: "Enriched", value: 88, total: 13830, rising: "better" },
    ]);
    const after = snap([
      { key: "reach-enriched", label: "Enriched", value: 88, total: 27660, rising: "better" },
    ]);
    const d = one(compareSnapshots(before, after), "reach-enriched");
    expect(d.delta).toBe(0);
    expect(d.rateDeltaPct).toBeLessThan(0);
    expect(d.verdict).toBe("worse");
  });

  it("uses the raw delta for a count with no denominator", () => {
    const before = snap([{ key: "edge-rows", label: "Rows", value: 0, rising: "better" }]);
    const after = snap([{ key: "edge-rows", label: "Rows", value: 340, rising: "better" }]);
    const d = one(compareSnapshots(before, after), "edge-rows");
    expect(d.rateDeltaPct).toBeNull();
    expect(d.verdict).toBe("better");
  });

  it("never divides by an empty population", () => {
    const before = snap([{ key: "k", label: "K", value: 0, total: 0, rising: "better" }]);
    const after = snap([{ key: "k", label: "K", value: 0, total: 0, rising: "better" }]);
    const d = one(compareSnapshots(before, after), "k");
    expect(d.rateDeltaPct).toBeNull();
    expect(d.verdict).toBe("unchanged");
  });
});

describe("compareSnapshots — direction", () => {
  it("reads a rising tie block as worse", () => {
    // The one measure where up is the loss: it is the block a top-N cuts blindly into.
    const before = snap([{ key: "t", label: "Tie", value: 100, rising: "worse" }]);
    const after = snap([{ key: "t", label: "Tie", value: 13227, rising: "worse" }]);
    expect(one(compareSnapshots(before, after), "t").verdict).toBe("worse");
  });

  it("leaves a context reading unjudged however far it moves", () => {
    // A denominator that grew is a fact about the tenant's inventory, not a win or a loss.
    const before = snap([{ key: "n", label: "Register", value: 100, rising: "neither" }]);
    const after = snap([{ key: "n", label: "Register", value: 99999, rising: "neither" }]);
    expect(one(compareSnapshots(before, after), "n").verdict).toBe("unchanged");
  });
});

describe("evidence and confounds", () => {
  const deltas = () => compareSnapshots(
    snap([
      { key: "reach-enriched", label: "Enriched", value: 0, total: 100, rising: "better" },
      { key: "register-signal", label: "Signal", value: 10, total: 100, rising: "better",
        confound: "rises on the diagnostic's own fix" },
      { key: "reach-register", label: "In register", value: 90, total: 100, rising: "neither" },
    ]),
    snap([
      { key: "reach-enriched", label: "Enriched", value: 40, total: 100, rising: "better" },
      { key: "register-signal", label: "Signal", value: 55, total: 100, rising: "better",
        confound: "rises on the diagnostic's own fix" },
      { key: "reach-register", label: "In register", value: 90, total: 100, rising: "neither" },
    ]),
  );

  it("keeps a confounded measure out of the evidence, however much it moved", () => {
    // The signal count more than quintupled here and is still not evidence — that fix raises it
    // with no tenant data changing at all.
    const keys = unconfounded(deltas()).map((d) => d.key);
    expect(keys).toEqual(["reach-enriched"]);
  });

  it("carries the confound text on the measure, not in a footnote", () => {
    const d = one(deltas(), "register-signal");
    expect(d.confound).toContain("diagnostic's own fix");
    expect(d.verdict).toBe("better"); // still reported — watched, just not counted
  });

  it("surfaces regressions as their own list", () => {
    const d = compareSnapshots(
      snap([{ key: "a", label: "A", value: 10, rising: "better" }]),
      snap([{ key: "a", label: "A", value: 2, rising: "better" }]),
    );
    expect(regressions(d).map((x) => x.key)).toEqual(["a"]);
  });

  it("offers no overall verdict to quote out of context", () => {
    // Deliberate: the states this tool exists to surface are the mixed ones, and any single
    // figure over them would hide exactly that.
    const mod = { buildSnapshot, compareSnapshots, regressions, unconfounded };
    expect(Object.keys(mod).some((k) => /score|overall|verdict|grade/i.test(k))).toBe(false);
  });
});

describe("buildSnapshot", () => {
  const input = {
    at: "2026-08-20T00:00:00Z",
    reach: {
      stages: [
        { key: "register", label: "In register", covered: 13830, total: 13932 },
        { key: "observed", label: "Observed", covered: 88, total: 13830 },
        { key: "enriched", label: "Enriched", covered: 0, total: 13830 },
        { key: "decided", label: "Decided", covered: 221, total: 13830 },
      ],
      edges: { populated: [], dead: ["RUNS_AS", "SERVES"], declared: 23 },
      axes: { exploitation: 0.03, impact: 0.18, exposure: 0.15, mission: 1 },
      axesPopulation: 221,
      impactTagged: { covered: 13096, total: 13830 },
    },
    aars: {
      scored: 13907, distinctScores: 12, largestTieGroup: 13227,
      tieRate: 0.9, effectiveCardinality: 1.4,
    },
    edgeRows: 0,
    stepRows: { RUNS_AS: 0, HOST_EXPOSURE: 0 },
    signal: { covered: 109, total: 13932 },
  };

  it("marks the register stage and impact tagging as context, not reach", () => {
    // Both read high on a landscape nothing traversed, so crediting either would be the
    // false-green this whole family of tools exists to refuse.
    const by = new Map(buildSnapshot(input).measures.map((m) => [m.key, m]));
    expect(by.get("reach-register")!.rising).toBe("neither");
    expect(by.get("reach-impact-tagged")!.rising).toBe("neither");
    expect(by.get("reach-enriched")!.rising).toBe("better");
  });

  it("confounds every AARS measure and the signal count", () => {
    const by = new Map(buildSnapshot(input).measures.map((m) => [m.key, m]));
    for (const k of ["aars-distinct-scores", "aars-largest-tie", "aars-tie-rate"]) {
      expect(by.get(k)!.confound, `${k} must name what else moves it`).toBeTruthy();
    }
    expect(by.get("register-signal")!.confound).toContain("boolean fix");
  });

  it("counts the largest tie block as a measure where rising is worse", () => {
    const by = new Map(buildSnapshot(input).measures.map((m) => [m.key, m]));
    expect(by.get("aars-largest-tie")!.rising).toBe("worse");
    expect(by.get("aars-tie-rate")!.rising).toBe("worse");
  });

  it("carries one measure per sync step, so a silent traversal is visible", () => {
    const keys = buildSnapshot(input).measures.map((m) => m.key);
    expect(keys).toContain("step-RUNS_AS");
    expect(keys).toContain("step-HOST_EXPOSURE");
  });

  it("censuses edge types against what can be populated, not what is declared", () => {
    // 23 are declared; six are drawn at read time and never reach the tab. Counting those as a
    // shortfall made every healthy sync look catastrophic.
    const by = new Map(buildSnapshot(input).measures.map((m) => [m.key, m]));
    expect(by.get("edge-types-populated")!.total).toBe(2);
    expect(by.get("edge-types-populated")!.value).toBe(0);
  });
});

describe("the diagnostic end to end", () => {
  it("refuses to compare against a baseline nobody pinned", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    const out = server.postureDelta();
    expect(out).toContain("No baseline pinned");
    // The instruction that matters most, because pinning afterwards reports no movement and
    // that reads exactly like a result.
    expect(out).toContain("BEFORE the change");
    expect(out).toContain("=== end ===");
  });

  it("pins, then reports every measure unchanged against itself", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});

    const pinned = server.pinPostureBaseline();
    expect(pinned).toContain("Pinned");
    expect(pinned).toContain("Rows on ai_edges");

    // Nothing has changed between the pin and the delta, so nothing may claim it has. This is
    // the check that would catch a comparison accidentally reading two different populations.
    const out = server.postureDelta();
    expect(out).toContain("Baseline pinned");
    expect(out).not.toContain("[BETTER]");
    expect(out).not.toContain("[WORSE]");
  });

  it("prints the confound beside the number rather than in a footnote", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});
    server.pinPostureBaseline();
    const out = server.postureDelta();
    expect(out).toContain("CONFOUNDED");
    expect(out).toContain("not evidence any traversal ran");
    // And the reader is told which single measure only an edge can move.
    expect(out).toContain("Enriched is the one measure only an edge can move");
  });

  it("puts regressions above the good news", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});
    server.pinPostureBaseline();
    const out = server.postureDelta();
    // Both headings exist in a fixed order; a reader who stops early should have been made to
    // read the bad news first.
    expect(out.indexOf("MOVED THE WRONG WAY"))
      .toBeLessThan(out.indexOf("CONFOUNDED — worth watching"));
  });

  it("agrees with registerScopeDiagnostic about what carries signal", async () => {
    // One question, one implementation. Two counts of the same thing is how the sent and
    // persisted vocabularies came to disagree in the first place.
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});
    const scope = server.registerScopeDiagnostic();
    const m = /carrying any signal: +(\d+) of/.exec(scope);
    expect(m).toBeTruthy();
    server.pinPostureBaseline();
    expect(server.postureDelta()).toContain(`${m![1]}/`);
  });
});
