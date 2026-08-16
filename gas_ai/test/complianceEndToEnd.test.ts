// The compliance feature end to end: setup → dry-run sync → the endpoint the page calls.
//
// The unit tests above prove each piece against fixtures. This proves the pieces are
// actually WIRED — that the seed reaches the tabs, the tabs reach the read model, and the
// read model reaches the endpoint. Every link in that chain has been broken at least once
// in this codebase's history by a normalizer whose output nothing accumulated (see
// normalizedPart.test.ts's header), and none of those failures raised an error.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;

let server: Server;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
});

function compliance(params: Record<string, unknown> = {}) {
  const res = server.api.getCompliance(params) as { ok: boolean; data?: any; error?: string };
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe("getCompliance after a dry-run sync", () => {
  it("returns a tree per framework the seed carries posture for", () => {
    const data = compliance();
    expect(data.trees.map((t: any) => t.frameworkId).sort())
      .toEqual(["wf-id-106", "wf-id-201", "wf-id-214", "wf-id-275"]);
  });

  it("sorts worst-scored first", () => {
    // 5Rs 85, LLM 95, Agentic 96, ML 100.
    expect(compliance().trees.map((t: any) => t.posturePct)).toEqual([85, 95, 96, 100]);
  });

  it("rebuilds the Agentic framework's categories and their policies", () => {
    const tree = compliance().trees.find((t: any) => t.frameworkId === "wf-id-275");
    expect(tree.categories.map((c: any) => c.externalId))
      .toEqual(["ASI01", "ASI03", "ASI08", "ASI10"]);
    // Distinct policies, not policy rows: SUB-082 and SUB-114 are each mapped twice.
    expect(tree.policyCount).toBe(6);
  });

  it("reads the OWASP LLM framework, whose codes live in the category name", () => {
    const tree = compliance().trees.find((t: any) => t.frameworkId === "wf-id-201");
    expect(tree.name).toBe("OWASP LLM Security Top 10");
    // Numeric external ids, unlike the ASI frameworks — the shape that broke the first
    // cut of the gap-code mapping.
    expect(tree.categories.map((c: any) => c.externalId)).toEqual(["1", "2"]);
    expect(tree.categories[0].title).toBe("1 LLM01:2025 Prompt Injection");
    expect(tree.categories.map((c: any) => c.posturePct)).toEqual([90, 98]);
  });

  it("keeps the empty category empty — with a reason, not a zero", () => {
    const tree = compliance().trees.find((t: any) => t.frameworkId === "wf-id-275");
    const asi08 = tree.categories.find((c: any) => c.externalId === "ASI08");
    expect(asi08.posturePct).toBeNull();
    expect(asi08.state).toBe("noResources");
    expect(asi08.subcategories[0].state).toBe("noResources");
  });

  it("distinguishes the 5Rs' two kinds of emptiness", () => {
    const tree = compliance().trees.find((t: any) => t.frameworkId === "wf-id-214");
    const reduce = tree.categories.find((c: any) => c.externalId === "1");
    expect(reduce.state).toBe("noResources");
    // The category has no resources; its subcategory has no policy written at all. Two
    // different facts, and the page says which.
    expect(reduce.subcategories[0].state).toBe("noPolicies");
  });

  it("ships the catalogue with this app's selection folded in", () => {
    const data = compliance();
    // Five frameworks exist in the seed tenant; the CIS one is deliberately not collected,
    // so the picker can show something that is off.
    expect(data.catalogue).toHaveLength(5);
    const cis = data.catalogue.find((f: any) => f.id === "wf-id-042");
    expect(cis.selected).toBe(false);
    expect(data.catalogue.filter((f: any) => f.selected)).toHaveLength(4);
  });

  it("reports a requested framework only when it actually has posture", () => {
    expect(compliance({ frameworkId: "wf-id-214" }).requested).toBe("wf-id-214");
    // Never silently falls back to a different framework's numbers.
    expect(compliance({ frameworkId: "wf-id-042" }).requested).toBeNull();
    expect(compliance({ frameworkId: "nope" }).requested).toBeNull();
  });

  it("computes the estate KPI the Wiz Scans area reads", () => {
    const kpis = compliance().kpis;
    expect(kpis.frameworks).toBe(4);
    expect(kpis.scoredFrameworks).toBe(4);
    expect(kpis.averagePosture).toBe(94); // mean(96, 85, 100, 95), rounded
    // Five, from a seeded estate that holds NINE failing controls. The four missing ones
    // are the 5Rs' general data-governance rules — labelling, classification, residency,
    // retention — which the derived scope files out because no OWASP framework maps them
    // and none of their findings land on an AI asset. The previous commit pinned this at
    // nine on purpose, so the drop is visible in the history rather than asserted into
    // existence: a filter that removes nothing and a filter that is broken produce
    // identical numbers, and only the diff tells them apart.
    expect(kpis.failingPolicies).toBe(5);
  });

  it("scopes the 5Rs to its AI-relevant rules, and says why for each", () => {
    const scope = compliance().fiveRsScope;
    expect(scope.frameworkId).toBe("wf-id-214");
    expect(scope.total).toBe(7);
    expect(scope.selected).toBe(3);

    const by = (shortId: string) => scope.policies.find((p: any) => p.shortId === shortId);

    // Wiz files SUB-082 under ASI01 and ASI10, so the cross-mapping signal keeps it —
    // and it is the case that proves "Reconfigure" is not a category that is simply off.
    expect(by("SUB-082").selected).toBe(true);
    expect(by("SUB-082").reason).toBe("crossMapped");
    expect(by("SUB-082").mappedBy).toContain("OWASP Top 10 For Agentic Applications 2026");

    // The four this product does not act on, each for the same stated reason.
    for (const id of ["DATA-311", "DATA-318", "DATA-402", "DATA-514"]) {
      expect(by(id).selected).toBe(false);
      expect(by(id).reason).toBe("noAiLink");
    }
  });

  it("scopes the 5Rs without touching any percentage", () => {
    const data = compliance();
    const fiveRs = data.trees.find((t: any) => t.frameworkId === "wf-id-214");

    // THE invariant. Wiz's posture is opaque — this framework reports 85 while its
    // Restrict category reports 194,309 passing checks against 71 failing, a ratio of
    // 99.96% — so it is derivable from nothing this app holds and a scope can never
    // honestly move it. Scoping changes the registers beneath the number, never the
    // number. If this ever fails, something has started recomputing a score.
    expect(fiveRs.posturePct).toBe(85);
    expect(fiveRs.categories.map((c: any) => c.posturePct))
      .toEqual([null, 85, 62, 91, 78]);
    expect(data.kpis.averagePosture).toBe(94);

    // And the counts the scope DOES own moved: 7 policies map, 3 survive.
    expect(fiveRs.policyCount).toBe(3);
  });

  it("round-trips a pin through setSettings and back into the scope", () => {
    // The gap a browser found and this suite did not: settingsStore grew getFiveRsPins /
    // setFiveRsPins and getCompliance grew fiveRsScope, but setSettings was never taught
    // the parameter, so the Settings card posted pins into a handler that ignored unknown
    // keys and reported success. Every unit passed, every payload was correct, and the
    // save did nothing. This case exists so the wire is asserted rather than assumed.
    const write = server.api.setSettings({
      fiveRsPins: { in: ["pol-DATA-311"], out: [] },
    }) as { ok: boolean; data?: any };
    expect(write.ok).toBe(true);
    expect(write.data.fiveRsPins.in).toEqual(["pol-DATA-311"]);

    const read = server.api.getSettings({}) as { ok: boolean; data?: any };
    expect(read.data.fiveRsPins.in).toEqual(["pol-DATA-311"]);

    // Only the WRITE path is asserted here, for the reason this file's closing note gives:
    // getCompliance goes through cached() keyed on dataVersion(), which is String(Date.now())
    // against a frozen clock, so a payload cached by an earlier case in this describe can
    // never be invalidated mid-run. That a pin beats the derivation and reports `pinnedIn`
    // rather than borrowing a derived reason is pinned in complianceScope.test.ts, where
    // there is no cache at all.

    // An id the tenant does not carry is dropped rather than stored forever.
    const cleaned = server.api.setSettings({
      fiveRsPins: { in: ["pol-DATA-311", "pol-does-not-exist"], out: [] },
    }) as { ok: boolean; data?: any };
    expect(cleaned.data.fiveRsPins.in).toEqual(["pol-DATA-311"]);

    server.api.setSettings({ fiveRsPins: { in: [], out: [] } });
  });

  it("keeps a scoped-out rule under the AI framework that also claims it", () => {
    const data = compliance();
    // SUB-082 is mapped by the 5Rs and by OWASP Agentic. Dropping 5Rs rows by policy id
    // alone would delete it from Agentic too, and the shared-controls band would lose the
    // crosswalk it exists to show.
    const agentic = data.trees.find((t: any) => t.frameworkId === "wf-id-275");
    const ids = agentic.categories
      .flatMap((c: any) => c.subcategories)
      .flatMap((s: any) => s.policies)
      .map((p: any) => p.shortId);
    expect(ids).toContain("SUB-082");
  });
});

// The Overview's four bands, against the seeded estate rather than the unit fixture. The
// unit tests prove each rollup in isolation; these prove they are actually WIRED into the
// endpoint the page calls — the same gap complianceEndToEnd exists to close for the trees.
describe("the Overview bands getCompliance ships beside the trees", () => {
  it("rails every framework in the trees' own order", () => {
    const data = compliance();
    // A projection, never a re-sort: if these two ever disagree, the rail is telling a
    // different story about "worst first" than the register it links into.
    expect(data.rail.map((r: any) => r.frameworkId))
      .toEqual(data.trees.map((t: any) => t.frameworkId));
    expect(data.rail.map((r: any) => r.posturePct)).toEqual([85, 95, 96, 100]);
  });

  it("ranks the weakest areas across frameworks, and ranks no unscored one", () => {
    const rows = compliance().weakestAreas;
    const scored = rows.filter((r: any) => r.state === "scored");
    const unscored = rows.filter((r: any) => r.state !== "scored");

    expect(scored.map((r: any) => r.posturePct))
      .toEqual([...scored.map((r: any) => r.posturePct)].sort((a: number, b: number) => a - b));

    // The invariant, at estate scope: a subcategory with no posture is LISTED, because
    // "no check is written for this" is a finding about the programme — but it is never
    // ranked, because `posturePct ?? 0` would file it as the worst thing in the estate.
    for (const r of unscored) expect(r.posturePct).toBeNull();
    expect(unscored.length).toBeGreaterThan(0);
    expect(rows.indexOf(unscored[0]))
      .toBeGreaterThan(rows.indexOf(scored[scored.length - 1]));

    // Flattened rows carry the framework they came from; the register does not have to.
    expect(new Set(rows.map((r: any) => r.frameworkId)).size).toBeGreaterThan(1);
  });

  it("counts one failing control once, however many frameworks raise it", () => {
    const data = compliance();
    // Two dedupes over the same question. If they drift, the header and the band below it
    // report different totals for one estate.
    expect(data.sharedControls).toHaveLength(data.kpis.failingPolicies);

    for (const c of data.sharedControls) {
      expect(c.failCount).toBeGreaterThan(0);
      expect(c.frameworkCount).toBe(new Set(c.frameworkIds).size);
      // A control mapped under two subcategories of one framework is still one framework.
      expect(c.subcategoryCount).toBeGreaterThanOrEqual(c.frameworkCount);
    }

    // Leverage first — the band's whole reason to exist is that the top row is the fix
    // that closes the most obligations.
    const counts = data.sharedControls.map((c: any) => c.frameworkCount);
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
  });

  it("names the framework this tenant has but does not collect", () => {
    const cov = compliance().coverage;
    expect(cov.collected).toBe(4);
    expect(cov.catalogued).toBe(5);
    expect(cov.uncollected.map((f: any) => f.id)).toEqual(["wf-id-042"]);

    // Every subcategory lands in exactly one state — no row is counted twice and none is
    // dropped, which is what makes the coverage band an accounting rather than a summary.
    const total = Object.values(cov.stateCounts).reduce((a: any, b: any) => a + b, 0);
    expect(total).toBe(cov.subcategoryCount);
  });
});

// NOTE ON WHAT IS *NOT* ASSERTED HERE. `getCompliance` goes through `cached()`, whose key
// carries `dataVersion()` — and `bumpDataVersion()` is `String(Date.now())`. This harness
// freezes the clock (gasEnv.FROZEN_NOW) so sync ids and timestamps stay stable, which
// means the version cannot advance mid-test and a cached payload is never invalidated.
// That is a property of the harness, not of the feature: under a real clock the version
// moves and the next read recomputes. So these cases assert the WRITE path, which the
// cache does not sit in front of; the storage semantics themselves are pinned in
// settingsLogic.test.ts, where there is no cache at all.
describe("setSelectedFrameworks", () => {
  it("stores an explicit selection", () => {
    const res = server.api.setSelectedFrameworks({ ids: ["wf-id-275"] }) as
      { ok: boolean; data?: any };
    expect(res.ok).toBe(true);
    expect(res.data.selected).toEqual(["wf-id-275"]);
  });

  it("accepts an explicit empty selection as a real choice", () => {
    // Not re-defaulted: "collect nothing" has to be expressible, or an operator can never
    // turn posture collection off.
    const res = server.api.setSelectedFrameworks({ ids: [] }) as { ok: boolean; data?: any };
    expect(res.ok).toBe(true);
    expect(res.data.selected).toEqual([]);
  });

  it("dedupes and trims on the way in", () => {
    const res = server.api.setSelectedFrameworks({
      ids: [" wf-id-275 ", "wf-id-275", "", "wf-id-214"],
    }) as { ok: boolean; data?: any };
    expect(res.data.selected).toEqual(["wf-id-275", "wf-id-214"]);
  });

  it("changing the selection does not touch the posture already stored", () => {
    // Selection decides what the NEXT sync collects. Blanking the register the moment
    // someone edits a checkbox would lose the last sync's answer for no reason.
    server.api.setSelectedFrameworks({ ids: [] });
    const trees = compliance().trees;
    expect(trees).toHaveLength(4);
    expect(trees.every((t: any) => t.categories.length > 0)).toBe(true);
  });
});
