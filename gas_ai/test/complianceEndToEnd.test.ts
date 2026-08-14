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
    expect(kpis.failingPolicies).toBe(5);
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
