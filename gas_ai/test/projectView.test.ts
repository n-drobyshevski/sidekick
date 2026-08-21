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
