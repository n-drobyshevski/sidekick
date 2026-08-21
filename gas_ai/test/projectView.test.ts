// The VIEW scope — what the pages show — as distinct from the FETCH scope.
//
// `syncScope.test.ts` covers the other layer: what the battery collects. These two are
// deliberately separate mechanisms and the tests stay separate with them, because the
// failure this file guards against is precisely the two being conflated. A view is applied
// to already-synced rows and costs nothing; a fetch scope decides what exists at all.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type Server = Awaited<ReturnType<typeof bootServer>>;
let server: Server;

const UNIT = "proj-demo-business-unit";  // the folder every seeded asset belongs to
const LEAF = "proj-project-alpha";
// A pair with no asset in common: every seeded row carrying BETA carries only ALPHA
// beside it, so nothing in BETA's slice belongs to DELTA. The one-way-door test below
// needs that disjointness — picked with ALPHA it passes vacuously, because almost every
// seeded asset is in ALPHA and filtering to it leaves nearly every project still visible.
const BETA = "proj-project-beta";
const DISJOINT_FROM_BETA = "proj-project-delta";
// The smallest slice in the seed. ALPHA is a poor probe for narrowing — it holds 34 of the
// 87 assets and every seeded issue hangs off one of them, so scoping to it leaves the issue
// list untouched and a "does this narrow?" test passes whether or not it does.
const SMALL = "proj-project-delta";

function ok<T = Rec>(res: unknown): T {
  const r = res as { ok: boolean; error?: string; data?: T };
  expect(r.ok, r.error).toBe(true);
  return r.data as T;
}

function setView(id: string): void {
  ok(server.api.setSettings({ projectView: id }));
}

function boot(): Rec {
  return ok<Rec>(server.api.bootstrap({}));
}

function scope(): { projectView: string; shown: number; register: number } {
  return boot()["scope"] as { projectView: string; shown: number; register: number };
}

function projectIds(): string[] {
  const opts = boot()["filterOptions"] as Rec;
  return ((opts["projectList"] ?? []) as Rec[]).map((p) => String(p["id"]));
}

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  ok(server.api.runSync({}));
});

describe("the project view", () => {
  it("shows the whole register when nothing is chosen", () => {
    setView("");
    const s = scope();
    expect(s.projectView).toBe("");
    expect(s.register).toBeGreaterThan(0);
    // Not a tautology on the wiring: `shown` is counted off the filtered read and
    // `register` off the raw one, so this is the two paths agreeing when they must.
    expect(s.shown).toBe(s.register);
  });

  it("selects a folder's whole subtree, not just rows naming the folder", () => {
    // The fact the whole design rests on: an asset carries its ANCESTORS, so one id match
    // reaches a subtree without walking a tree — no tree walk, no recursive query.
    setView(UNIT);
    const unit = scope();
    expect(unit.projectView).toBe(UNIT);
    setView(LEAF);
    const leaf = scope();

    // Both ends of the containment, because each catches a different failure. Strictly
    // MORE than the leaf inside it: if ancestry did not materialise on the rows, selecting
    // a folder would match only assets naming the folder itself and land at or below its
    // children. Strictly LESS than the register: a folder is not a synonym for everything,
    // and the seeds carrying no project at all must not be swept in with it.
    expect(leaf.shown).toBeGreaterThan(0);
    expect(unit.shown).toBeGreaterThan(leaf.shown);
    expect(unit.shown).toBeLessThan(unit.register);
  });

  it("keeps offering every project after one is chosen", () => {
    // The one-way door. `filterOptions` is handed the FILTERED assets, so deriving the
    // switcher's own list from them would collapse it to the current selection plus its
    // ancestors — and a sibling project would become unreachable without first clearing
    // the view, which is the one thing a filter must never do to itself.
    setView("");
    const all = projectIds();
    expect(all).toContain(DISJOINT_FROM_BETA);

    setView(BETA);
    expect(projectIds()).toEqual(all);
    // Named explicitly as well as compared wholesale: the equality above says the lists
    // match, this says WHICH project a view-derived list would have eaten, so a failure
    // reads as "DELTA became unreachable" rather than as two long arrays differing.
    expect(projectIds()).toContain(DISJOINT_FROM_BETA);
  });

  it("reports zero for a project the register does not hold, and says so honestly", () => {
    // A stored view can outlive the register: re-sync scoped elsewhere and the project is
    // simply gone. Zero is the truthful answer for that project — what must NOT happen is
    // a silent fallback to the whole register, which would show tenant-wide numbers under
    // a label naming one project.
    setView("proj-not-in-this-register");
    const s = scope();
    expect(s.shown).toBe(0);
    expect(s.register).toBeGreaterThan(0);
    // Still absent from the picker, so the control can never offer it — but the stored
    // value is preserved rather than silently reset, or clearing it would be impossible.
    expect(projectIds()).not.toContain("proj-not-in-this-register");
    expect(s.projectView).toBe("proj-not-in-this-register");
    // And the picker still offers everything else, so this state is escapable. A list
    // derived from the visible rows would be EMPTY here — zero assets, zero projects —
    // stranding the operator in a scope with no control left to leave it by.
    expect(projectIds().length).toBeGreaterThan(1);
  });

  it("scopes the populations the pages are actually built from", () => {
    // Assets are not the only population. Priorities, Toxic Combinations and Cloud
    // Configuration are built from ISSUE and FINDING rows and only join assets in for
    // enrichment — so filtering the join alone leaves every row on screen, minus the
    // posture tier on the ones out of view. The first cut of this change did exactly that:
    // the sidebar read "6 of 87 assets" while Priorities listed all 38 problems.
    setView("");
    const wide = {
      problems: (ok<Rec>(server.api.getProblems({}))["rows"] as unknown[]).length,
      findings: (ok<Rec>(server.api.getConfigFindings({}))["rows"] as unknown[]).length,
      issues: (ok<Rec>(server.api.getIssues({}))["rows"] as unknown[]).length,
    };

    setView(SMALL);
    const scoped = {
      problems: (ok<Rec>(server.api.getProblems({}))["rows"] as unknown[]).length,
      findings: (ok<Rec>(server.api.getConfigFindings({}))["rows"] as unknown[]).length,
      issues: (ok<Rec>(server.api.getIssues({}))["rows"] as unknown[]).length,
    };

    expect(wide.problems).toBeGreaterThan(0);
    expect(scoped.problems).toBeLessThan(wide.problems);
    expect(scoped.findings).toBeLessThan(wide.findings);
    expect(scoped.issues).toBeLessThan(wide.issues);
  });

  it("still opens a row by id from outside the view", () => {
    // The deliberate asymmetry. LISTS are scoped; a lookup BY ID is not, because the id is
    // already a specific answer — someone following a bookmark or a shared link to an issue
    // should see it, not a "not found" that reads as deleted. Scoping detail lookups would
    // make the view silently destroy links rather than narrow a list.
    setView("");
    const anyIssue = (ok<Rec>(server.api.getIssues({}))["rows"] as Rec[])[0];
    expect(anyIssue).toBeDefined();

    setView("proj-not-in-this-register");
    expect((ok<Rec>(server.api.getIssues({}))["rows"] as unknown[]).length).toBe(0);
    const detail = ok<Rec>(server.api.getIssueDetail({ id: anyIssue["id"] }));
    expect((detail["issue"] as Rec | null)?.["id"]).toBe(anyIssue["id"]);
  });

  it("answers a by-id asset sheet in full, even for an asset out of view", () => {
    // The sharpest failure this feature can have. The sheet opens from unscoped surfaces too —
    // a graph neighbour, a bookmark, a shared link — and a scoped issue list renders an
    // out-of-view asset as having NO issues. "Nothing wrong with this asset" and "not in the
    // project you are looking at" must never share a rendering in a security tool.
    setView("");
    const withIssues = (ok<Rec>(server.api.getIssues({}))["rows"] as Rec[])[0];
    const assetId = String(withIssues["assetId"]);
    const wide = ok<Rec>(server.api.getAssetDetail({ id: assetId }));
    expect((wide["issues"] as unknown[]).length).toBeGreaterThan(0);

    // A view that holds nothing at all — the strongest form of "out of view".
    setView("proj-not-in-this-register");
    const scoped = ok<Rec>(server.api.getAssetDetail({ id: assetId }));
    expect(scoped["node"]).toBeTruthy();
    expect((scoped["issues"] as unknown[]).length).toBe((wide["issues"] as unknown[]).length);
    expect((scoped["neighbors"] as unknown[]).length).toBe((wide["neighbors"] as unknown[]).length);
    expect((scoped["findings"] as unknown[]).length).toBe((wide["findings"] as unknown[]).length);
  });

  it("keeps a config finding's asset attached when the finding is out of view", () => {
    // The handler's own comment promises "lists narrow; links do not break". A scoped asset
    // join breaks them quietly: the finding resolves, but comes back with `asset: null`, which
    // this pane already uses to mean "no AI asset models this resource".
    setView("");
    const linked = (ok<Rec>(server.api.getConfigFindings({}))["rows"] as Rec[])
      .find((r) => r["onAiAsset"] === true || r["linked"] === true);
    expect(linked, "seed has no finding linked to an AI asset").toBeDefined();
    const findingId = String((linked as Rec)["id"]);

    setView("proj-not-in-this-register");
    const detail = ok<Rec>(server.api.getConfigFindingDetail({ id: findingId }));
    expect((detail["finding"] as Rec | null)?.["id"]).toBe(findingId);
    expect(detail["asset"], "the asset join went missing under a view").toBeTruthy();
  });

  it("decides the 5Rs scope register-wide, because the pin it drives is register-wide", () => {
    // The only place a project view reached persisted state. `scopeFiveRs` decides which 5Rs
    // rules are AI-relevant; the Settings card renders that and its toggle writes a GLOBAL
    // pin. Scoped, an operator in one project sees "no AI link" for a rule linked in another,
    // pins it out, and it is pinned out everywhere.
    //
    // The COUNTS inside those rules are a separate question and they do move under a view:
    // `withCountsFrom` re-reads them off the trees Wiz re-aggregated for the project (see
    // api.ts `scopedPosture`). What must not move is the in/out VERDICT, which is what this
    // asserts — `selected` and `total` on the shipped scope, not the arithmetic under it.
    // Without credentials the live path never fires here anyway, so this also pins the
    // fallback: a tenantless checkout answers register-wide and says so.
    setView("");
    const wide = ok<Rec>(server.api.getCompliance({}));
    const wideScope = wide["fiveRsScope"] as Rec | undefined;
    expect(wideScope, "no fiveRsScope on the compliance payload").toBeDefined();

    for (const view of [LEAF, SMALL, "proj-not-in-this-register"]) {
      setView(view);
      const scope = ok<Rec>(server.api.getCompliance({}))["fiveRsScope"] as Rec;
      expect(scope["selected"], `5Rs scope moved under view ${view}`)
        .toBe((wideScope as Rec)["selected"]);
      expect(scope["total"], `5Rs total moved under view ${view}`)
        .toBe((wideScope as Rec)["total"]);
    }
  });

  it("narrows the graph endpoints, not just the graph helper", () => {
    // The wiring, not the rule. `graphScope.test.ts` proves scopeGraphDoc filters correctly and
    // says nothing about whether any endpoint calls it — which is the failure this file exists
    // for: a builder-level test already sat green through a change that bypassed it.
    setView("");
    const wide = ok<Rec>(server.api.runGraphQuery({}));
    const wideNodes = ((wide["graph"] ?? wide) as Rec)["nodes"] as unknown[] | undefined;
    expect(wideNodes, "runGraphQuery returned no nodes").toBeDefined();

    setView(SMALL);
    const scoped = ok<Rec>(server.api.runGraphQuery({}));
    const scopedNodes = ((scoped["graph"] ?? scoped) as Rec)["nodes"] as unknown[];
    expect(scopedNodes.length).toBeGreaterThan(0);
    expect(scopedNodes.length).toBeLessThan((wideNodes as unknown[]).length);

    // getGraph has no live client caller today but is live API surface; a divergent twin that
    // still answers tenant-wide is exactly how this regresses.
    setView("");
    const gWide = ok<Rec>(server.api.getGraph({}));
    setView(SMALL);
    const gScoped = ok<Rec>(server.api.getGraph({}));
    expect((gScoped["nodes"] as unknown[]).length)
      .toBeLessThan((gWide["nodes"] as unknown[]).length);
  });

  it("stops offering other projects' names in the query vocabulary", () => {
    // The query builder enumerates field VALUES off the graph. Unscoped it offers every project
    // in the tenant, each with a register-wide count — a menu of things the current view cannot
    // contain. (Not to be confused with the switcher's own list, which is register-wide on
    // purpose so it cannot remove its own alternatives.)
    setView(SMALL);
    const vocab = ok<Rec>(server.api.getQueryVocabulary({ kind: "ANY" }));
    const json = JSON.stringify(vocab);
    expect(json).not.toContain("PROJECT-BETA");
    expect(json).not.toContain("PROJECT-ZETA");
  });

  it("leaves the rule previews reading the whole register", () => {
    // A rule preview answers "what would this change?", and the answer is tenant-wide
    // whatever the sidebar is looking at. Scoping it would understate the blast radius of
    // a rule the operator is about to commit.
    setView("");
    const wide = ok<Rec>(server.api.previewAarsRule({
      rule: (boot()["aarsRule"] ?? {}) as Rec,
    }));
    setView(LEAF);
    const scoped = ok<Rec>(server.api.previewAarsRule({
      rule: (boot()["aarsRule"] ?? {}) as Rec,
    }));
    expect(scoped["changed"]).toEqual(wide["changed"]);
    expect(scoped["total"]).toEqual(wide["total"]);
  });
});
