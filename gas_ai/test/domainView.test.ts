// The VIEW scope, second kind: a business domain rather than a project.
//
// Beside `projectView.test.ts` and deliberately not inside it, because the two dimensions
// are orthogonal and the seeded landscape is built to prove it — `sampleData.ts` puts
// `bucket-customer-pii` in SAP while `agent-a`, which reads it, is CROSS, so that "grouping
// by domain has to visibly cut across an attack path or the dimension is just a second
// spelling of the project". A file that tested both through one set of fixtures would be
// asserting the thing they are not.
//
// The other half of what this guards: a domain is a TAG, and only some resources carry one.
// 15 of the 87 seeded assets do. Every case below therefore has to distinguish "in another
// domain" from "carries no domain", because the whole feature is only honest if the app can.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type Server = Awaited<ReturnType<typeof bootServer>>;
let server: Server;

// Two domains with assets on both sides of an attack path, per the seed's own comment.
const SAP = "SAP";
const CROSS = "CROSS";

function ok<T = Rec>(res: unknown): T {
  const r = res as { ok: boolean; error?: string; data?: T };
  expect(r.ok, r.error).toBe(true);
  return r.data as T;
}

const setDomain = (name: string) => ok(server.api.setSettings({ domainView: name }));
const setProject = (id: string) => ok(server.api.setSettings({ projectView: id }));
const boot = (): Rec => ok<Rec>(server.api.bootstrap({}));
const scope = (): Rec => boot()["scope"] as Rec;

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  ok(server.api.runSync({}));
});

describe("the domain view", () => {
  it("offers every domain the register carries, with register-wide counts", () => {
    setDomain("");
    const opts = boot()["filterOptions"] as Rec;
    const list = (opts["domainList"] ?? []) as Rec[];
    expect(list.map((d) => String(d["name"]))).toEqual(
      ["CROSS", "EXAMPLE DOMAIN", "SAP", "VALUE-CHAIN"],
    );
    // Counts answer "how much would I see if I picked this", so they are of the register
    // and not of the current view — the same rule projectList's own comment states.
    for (const d of list) expect(Number(d["assets"])).toBeGreaterThan(0);
  });

  it("publishes coverage as a count, so absence is not read as a fact about the tenant", () => {
    setDomain("");
    const cover = scope()["domainCoverage"] as Rec;
    expect(cover["key"]).toBe("Wiz/Domain");
    // The figure the caption needs. 15 tagged of 87 means a domain scope can never show more
    // than 15, and a reader told only "5 of 87" would conclude the other 82 are elsewhere.
    expect(Number(cover["tagged"])).toBe(15);
    expect(Number(cover["total"])).toBe(87);
    expect(Number(cover["tagged"])).toBeLessThan(Number(cover["total"]));
  });

  it("narrows the register to the assets carrying that tag", () => {
    setDomain("");
    const wide = Number(scope()["register"]);
    setDomain(SAP);
    const s = scope();
    expect(s["domainView"]).toBe(SAP);
    expect(Number(s["shown"])).toBeGreaterThan(0);
    expect(Number(s["shown"])).toBeLessThan(wide);
    // The register is the denominator and never moves with the view.
    expect(Number(s["register"])).toBe(wide);
  });

  it("scopes the populations the pages are built from, not just the assets", () => {
    // The same trap projectView.test.ts names: Priorities, Toxic Combinations and Cloud
    // Configuration are built from ISSUE and FINDING rows and only join assets in for
    // enrichment, so filtering the join alone would leave every row on screen under a label
    // naming one domain.
    setDomain("");
    const rows = (name: "getProblems" | "getConfigFindings" | "getIssues") =>
      (ok<Rec>((server.api as Rec as Record<string, (p: Rec) => unknown>)[name]({}))["rows"] as unknown[]).length;
    const wide = { problems: rows("getProblems"), issues: rows("getIssues") };
    setDomain(SAP);
    expect(wide.problems).toBeGreaterThan(0);
    expect(rows("getProblems")).toBeLessThan(wide.problems);
    expect(rows("getIssues")).toBeLessThan(wide.issues);
  });

  // The one-way door: picking either kind clears the other, enforced in the settings pair
  // rather than in the ten readers.
  it("replaces a project view, and is replaced by one", () => {
    setProject("proj-project-alpha");
    expect(scope()["projectView"]).toBe("proj-project-alpha");

    setDomain(SAP);
    let s = scope();
    expect(s["domainView"]).toBe(SAP);
    expect(s["projectView"]).toBe("");

    setProject("proj-project-alpha");
    s = scope();
    expect(s["projectView"]).toBe("proj-project-alpha");
    expect(s["domainView"]).toBe("");
  });

  it("reports zero for a domain the register does not hold, rather than refusing it", () => {
    // Same latitude as a stale project view: the stored value is never validated against the
    // catalogue, because rejecting it would strand anyone whose domain fell out of scope —
    // clearing is a write too.
    setDomain("NOT-A-DOMAIN");
    const s = scope();
    expect(s["domainView"]).toBe("NOT-A-DOMAIN");
    expect(Number(s["shown"])).toBe(0);
    expect(Number(s["register"])).toBeGreaterThan(0);
  });

  it("cuts an attack path that crosses domains, which is the point of the dimension", () => {
    // The seed's own demonstration: bucket-customer-pii is SAP, agent-a reads it and is
    // CROSS. Neither scope may show the other's asset, however reachable — the guard that
    // stops one scope dragging in another's assets through a shared node.
    const names = (): string[] => {
      const doc = ok<Rec>(server.api.getGraph({}));
      return ((doc["nodes"] ?? []) as Rec[]).map((n) => String(n["id"]));
    };
    setDomain(SAP);
    const sap = names();
    setDomain(CROSS);
    const cross = names();
    expect(sap.length).toBeGreaterThan(0);
    expect(cross.length).toBeGreaterThan(0);
    expect(sap).not.toEqual(cross);
  });

  it("keeps compliance register-wide, and says which population that is", () => {
    // Not a failure to retry: scopedPosture re-scores by ASKING Wiz with the project id in
    // the query's variables, and a tag is not something complianceAnalytics can be scoped by.
    setDomain(SAP);
    const comp = ok<Rec>(server.api.getCompliance({}));
    const ps = comp["postureScope"] as Rec;
    expect(ps["reason"]).toBe("domainScope");
    expect(ps["domainId"]).toBe(SAP);
    expect(ps["source"]).toBe("stored");
  });

  it("marks the inventory trend as the register's, because it is recorded per project", () => {
    setDomain(SAP);
    const head = ok<Rec>(server.api.getAssets({ all: true, pageSize: 5 }));
    const ts = head["trendScope"] as Rec;
    expect(ts["domainId"]).toBe(SAP);
    // Not scoped, and not pretending to be: sync_history has no per-domain column and one
    // cannot be backfilled, because the ledger never held the dimension.
    expect(ts["scoped"]).toBe(false);
  });
});
