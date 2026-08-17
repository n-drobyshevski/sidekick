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
    // ASI08 is in the seed and not in this list: its one subcategory has no resources to
    // assess, so neither it nor its parent is listed. The strip still counts it.
    expect(tree.categories.map((c: any) => c.externalId))
      .toEqual(["ASI01", "ASI03", "ASI10"]);
    expect(tree.stateCounts.noResources).toBe(1);
    // Distinct policies, not policy rows: SUB-082 and SUB-114 are each mapped twice. Five,
    // not six: AIService-009 is the seed's never-evaluated rule (every count zero, flag
    // set), it maps under ASI08, and it is reported as dropped rather than counted as a
    // rule this framework covers.
    expect(tree.policyCount).toBe(5);
    expect(tree.unassessedPolicyCount).toBe(1);
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

  it("leaves the empty category out of the register rather than scoring it a zero", () => {
    const tree = compliance().trees.find((t: any) => t.frameworkId === "wf-id-275");
    // ASI08 has nothing in the landscape to assess. It is not a 0% row and it is not a listed
    // row — it is a counted one, and every subcategory that IS listed carries a number.
    expect(tree.categories.find((c: any) => c.externalId === "ASI08")).toBeUndefined();
    expect(tree.stateCounts.noResources).toBe(1);
    for (const cat of tree.categories) {
      for (const sub of cat.subcategories) expect(sub.posturePct).not.toBeNull();
    }
  });

  it("distinguishes the 5Rs' two kinds of emptiness — in the counts, where they survive", () => {
    const tree = compliance().trees.find((t: any) => t.frameworkId === "wf-id-214");
    // Reduce (1) has no resources; its subcategory has no policy written at all. Two
    // different facts about two different levels, and both are gone from the register —
    // there is nothing evaluated under either to act on. The strip is where the difference
    // is still stated, which is why the two states are counted apart rather than summed
    // into one "unscored" bucket.
    expect(tree.categories.find((c: any) => c.externalId === "1")).toBeUndefined();
    expect(tree.stateCounts.noPolicies).toBe(1);
    expect(tree.stateCounts.scored).toBeGreaterThan(0);
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

  it("computes the landscape KPI the Wiz Scans area reads", () => {
    const kpis = compliance().kpis;
    expect(kpis.frameworks).toBe(4);
    expect(kpis.scoredFrameworks).toBe(4);
    expect(kpis.averagePosture).toBe(94); // mean(96, 85, 100, 95), rounded
    // Five, from a seeded landscape that holds NINE failing controls. The four missing ones
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

    // THE invariant, and it survives the arrival of the derived posture. Wiz's own figure
    // stays exactly as Wiz sent it on the TREE — 85, against a Restrict category reporting
    // 194,309 passing checks to 71 failing — because scoping changes the registers beneath
    // the number, never this number. The AI-scoped figure the page now draws instead is a
    // SEPARATE field (`fiveRsPosture`, asserted in the next case) computed at read time and
    // never written back over this one. If THIS ever fails, something has started
    // overwriting Wiz's score rather than deriving beside it.
    expect(fiveRs.posturePct).toBe(85);
    // Four categories, four percentages. The fifth — Reduce, which Wiz sent as a null with
    // a reason — is not listed, and its absence is the one thing about this list that the
    // scope did NOT cause: an unscored category leaves the register regardless of scoping,
    // and the numbers on the four that remain are still Wiz's own.
    expect(fiveRs.categories.map((c: any) => c.posturePct))
      .toEqual([85, 62, 91, 78]);
    expect(data.kpis.averagePosture).toBe(94);

    // And the counts the scope DOES own moved: 7 policies map, 3 survive.
    expect(fiveRs.policyCount).toBe(3);
  });

  it("derives the 5Rs posture over the active rules, beside Wiz's own", () => {
    const derived = compliance().fiveRsPosture;

    // Self-describing: the rail row and the hero both match on this rather than reaching
    // into the sibling fiveRsScope, so the payload cannot be split from its own identity.
    expect(derived.frameworkId).toBe("wf-id-214");

    // The three rules the scope keeps — IAM-236 (1718/18), SUB-047 (30/1), SUB-082 (21/2).
    // The four DATA-* rules carry 227,342 passing checks between them and contribute
    // NOTHING here; that omission is the whole feature, and the gap between this
    // denominator and Wiz's is why the two numbers are stated side by side rather than one
    // being called a correction of the other.
    expect(derived.activePolicyCount).toBe(3);
    expect(derived.passCount).toBe(1769);
    expect(derived.failCount).toBe(21);
    expect(derived.posturePct).toBe(99);
    expect(derived.postureBand).toBe("strong");

    // Nothing in the seed is disabled in Wiz, so the two filters are not confounded here:
    // this 0 is what makes `activePolicyCount` 3 attributable to the AI scope alone.
    expect(derived.disabledPolicyCount).toBe(0);

    // A REAL zero, not a missing one. Every active rule has a failing check, so the
    // control-weighted reading is 0% against a resource-weighted 99% — the two answer
    // different questions and the page states both rather than picking the flattering one.
    expect(derived.controlPassPct).toBe(0);
    expect(derived.cleanPolicyCount).toBe(0);
    expect(derived.failingPolicyCount).toBe(3);

    // Wiz's own figure travels with it, unchanged, so no consumer has to join two fields
    // to say what it is comparing against.
    expect(derived.wizPosturePct).toBe(85);

    // That a PIN moves this number is deliberately NOT asserted here. getCompliance goes
    // through cached() keyed on dataVersion() — String(Date.now()) against a frozen clock —
    // so a payload cached by an earlier case in this describe cannot be invalidated
    // mid-run, exactly as the pin round-trip case below explains. The pin-moves-the-
    // percentage claim is pinned in complianceScope.test.ts instead, where there is no
    // cache at all.
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

// The Overview's four bands, against the seeded landscape rather than the unit fixture. The
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

  it("ranks the weakest areas across frameworks, and carries nothing it cannot rank", () => {
    const rows = compliance().weakestAreas;

    expect(rows.map((r: any) => r.posturePct))
      .toEqual([...rows.map((r: any) => r.posturePct)].sort((a: number, b: number) => a - b));

    // The invariant, at landscape scope, in its current form: a subcategory with no posture
    // is not ranked AND not listed here — `posturePct ?? 0` would file it as the worst
    // thing in the landscape, and appending it unranked to a "weakest areas" band presents a
    // coverage gap as a score. It is counted in the coverage strip instead.
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.state).toBe("scored");
      expect(r.posturePct).not.toBeNull();
    }

    // Flattened rows carry the framework they came from; the register does not have to.
    expect(new Set(rows.map((r: any) => r.frameworkId)).size).toBeGreaterThan(1);
  });

  it("counts one failing control once, however many frameworks raise it", () => {
    const data = compliance();
    // Two dedupes over the same question. If they drift, the header and the band below it
    // report different totals for one landscape.
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

  it("counts what is collected against what the tenant catalogues", () => {
    const cov = compliance().coverage;
    // Five frameworks exist in the seed tenant and four are collected — the CIS one is
    // deliberately left out. The headline strip draws this as "Frameworks 4 of 5"; naming
    // the missing one is Settings' job, not this payload's.
    expect(cov.collected).toBe(4);
    expect(cov.catalogued).toBe(5);

    // Every subcategory lands in exactly one state — no row is counted twice and none is
    // dropped, which is what makes the state strip an accounting rather than a summary.
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
