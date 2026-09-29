// SUPPORT GROUP → DOMAIN OVERRIDES in the code register (settings `supportGroupDomains`,
// domain/currentDomain.ts rule 3): an admin corrects a group the vote put in the wrong domain —
// or confirms one that sits in CROSS on purpose because the CROSS team runs its repositories —
// and every page follows. Owner/admin only, and the ungated settings save cannot reach it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootServer, resetServerMemos, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type ServerModule = Awaited<ReturnType<typeof bootServer>>;
let server: ServerModule;
let active = "";
const OWNER = "owner@example.com";
const g = globalThis as unknown as Rec;

const project = (name: string) => JSON.stringify([{ slug: name.toLowerCase(), name, isFolder: false }]);

function ledgerRow(over: Partial<Rec> & { finding_key: string; scope: string }): Rec {
  return {
    identifier: null,
    component: null,
    severity: "HIGH",
    repo_id: "r1",
    repo_name: "repo-one",
    branch: "main",
    platform: "github",
    first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-08-01T00:00:00Z",
    status: "OPEN",
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: "sync-1",
    last_scan_id: "sync-1",
    fix_date: null,
    fix_observed_at: null,
    fixed_version: null,
    has_kev: null,
    has_exploit: null,
    epss: null,
    cwe: null,
    ai_verdict: null,
    language: null,
    file_path: null,
    start_line: null,
    origin: null,
    secret_kind: null,
    rotated_at: null,
    removed_at: null,
    validation_state: null,
    validated_at: null,
    confidence: null,
    owner_project: null,
    owner_path: null,
    tags_json: null,
    projects_json: null,
    ...over,
  };
}

/** CS-ALPHA: r1, r2 CROSS, r3 SAP → pinned CROSS by the vote. CS-BETA: r4 SAP. */
const ROWS: Rec[] = [
  ledgerRow({ finding_key: "sca#1", scope: "sca", repo_id: "r1", repo_name: "one", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#2", scope: "sca", repo_id: "r2", repo_name: "two", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#3", scope: "sca", repo_id: "r3", repo_name: "three", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#4", scope: "sca", repo_id: "r4", repo_name: "four", projects_json: project("CS-BETA") }),
];

function props() {
  return (g["PropertiesService"] as { getScriptProperties: () => {
    getProperty: (k: string) => string | null; setProperty: (k: string, v: string) => void;
  } }).getScriptProperties();
}

async function as(email: string): Promise<void> {
  active = email;
  await resetServerMemos();
}

function ok(result: unknown): Rec {
  const r = result as Rec;
  expect(r["ok"], `expected ok:true, got ${JSON.stringify(r)}`).toBe(true);
  return r["data"] as Rec;
}

const domainCounts = () => Object.fromEntries(
  ((ok(server.api.bootstrap({}))["filterOptions"] as Rec)["domainList"] as { name: string; findings: number }[])
    .map((d) => [d.name, d.findings]));
const stored = () => ok(server.api.getSettings({}))["supportGroupDomains"] as { items: Rec[] };

beforeEach(async () => {
  server = await bootServer();
  g["Session"] = {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => OWNER }),
  };
  active = OWNER;
  server.setup();
  const { overwrite, TABS } = await import("../src/server/sheetsDb");
  overwrite(TABS.ledger, ROWS);
  props().setProperty("ALLOWED_USERS", `${OWNER}, listed@example.com`);
  props().setProperty("ALLOWED_ADMINS", "admin@example.com");
  const repoTags = await import("../src/server/repoTags");
  const map: Record<string, { domain: string | null; lifecycle: string | null }> = {};
  for (const [id, d] of Object.entries({ r1: "CROSS", r2: "CROSS", r3: "SAP", r4: "SAP" })) {
    map[repoTags.foldToken(id)] = { domain: d, lifecycle: null };
  }
  repoTags.setRepoTagMap(map);
  await resetServerMemos();
});

afterEach(() => {
  teardownServer();
});

describe("saveSupportGroupDomain", () => {
  it("moves the group, with every finding it carries, to the domain an admin sets", () => {
    expect(domainCounts()).toEqual({ CROSS: 3, SAP: 1 });
    const res = ok(server.api.saveSupportGroupDomain({ group: "CS-ALPHA", domain: "SAP", reason: "wrong_tag" }));
    expect(res["saved"]).toBe(true);
    expect(domainCounts()).toEqual({ SAP: 4 });
  });

  it("records who set it, when and why — and an admin may set it too", async () => {
    await as("admin@example.com");
    ok(server.api.saveSupportGroupDomain({ group: "CS-BETA", domain: "CROSS", reason: "cross_team", note: "run by CROSS" }));
    expect(stored().items).toEqual([expect.objectContaining({
      group: "CS-BETA", domain: "CROSS", reason: "cross_team", note: "run by CROSS", by: "admin@example.com",
    })]);
    expect(domainCounts()).toEqual({ CROSS: 4 });
  });

  it("resets to the vote with domain: null, and a second save replaces the first", () => {
    ok(server.api.saveSupportGroupDomain({ group: "CS-ALPHA", domain: "SAP", reason: "wrong_tag" }));
    ok(server.api.saveSupportGroupDomain({ group: "CS-ALPHA", domain: "CROSS", reason: "cross_team" }));
    expect(stored().items.map((o) => [o["group"], o["domain"]])).toEqual([["CS-ALPHA", "CROSS"]]);
    ok(server.api.saveSupportGroupDomain({ group: "CS-ALPHA", domain: null }));
    expect(stored().items).toEqual([]);
    expect(domainCounts()).toEqual({ CROSS: 3, SAP: 1 });
  });

  it("refuses a listed user who is not an admin, and stores nothing", async () => {
    await as("listed@example.com");
    const res = server.api.saveSupportGroupDomain({ group: "CS-ALPHA", domain: "SAP", reason: "wrong_tag" }) as unknown as Rec;
    expect(res["ok"]).toBe(false);
    await as(OWNER);
    expect(stored().items).toEqual([]);
  });

  it("refuses a domain no repository is tagged in, a missing reason, and an empty group", () => {
    for (const bad of [
      { group: "CS-ALPHA", domain: "NOWHERE", reason: "wrong_tag" },
      { group: "CS-ALPHA", domain: "SAP", reason: "because" },
      { group: "", domain: "SAP", reason: "wrong_tag" },
    ]) {
      const res = ok(server.api.saveSupportGroupDomain(bad));
      expect(res["saved"], JSON.stringify(bad)).toBe(false);
      expect((res["errors"] as string[]).length).toBeGreaterThan(0);
    }
    expect(stored().items).toEqual([]);
  });

  it("the settings save cannot write overrides — the admin gate has no way round", () => {
    ok(server.api.putSettings({ settings: { supportGroupDomains: { version: 9, items: [
      { group: "CS-ALPHA", domain: "SAP", reason: "wrong_tag" },
    ] } } }));
    expect(stored().items).toEqual([]);
    expect(domainCounts()).toEqual({ CROSS: 3, SAP: 1 });
  });

  it("ships the groups and the assignable domains on the boot payload", () => {
    const fo = ok(server.api.bootstrap({}))["filterOptions"] as Rec;
    expect(fo["supportGroups"]).toEqual(["CS-ALPHA", "CS-BETA"]);
    expect(fo["assignableDomains"]).toEqual(["CROSS", "SAP"]);
  });
});
