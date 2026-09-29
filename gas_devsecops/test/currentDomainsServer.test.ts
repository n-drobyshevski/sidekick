// The current-domain assignment through the server (src/server/currentDomains.ts): every read
// path puts a support group's findings in ONE domain — the one most of its current
// repositories are tagged in — and the assignment follows a tag-map refresh without a reset.
//
// The pure rules are currentDomain.test.ts; this pins the wiring: `bootstrap` (the header's
// domain catalogue and counts) reads `_domain` from the assignment, not the per-row tag join.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type ServerModule = Awaited<ReturnType<typeof bootServer>>;
let server: ServerModule;

afterEach(() => {
  teardownServer();
});

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

/** CS-ALPHA: r1, r2 tagged CROSS, r3 tagged SAP → pinned to CROSS. CS-BETA: r4 tagged SAP. */
const ROWS: Rec[] = [
  ledgerRow({ finding_key: "sca#1", scope: "sca", repo_id: "r1", repo_name: "one", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#2", scope: "sca", repo_id: "r2", repo_name: "two", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#3", scope: "sca", repo_id: "r3", repo_name: "three", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sast#3", scope: "sast", repo_id: "r3", repo_name: "three", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#4", scope: "sca", repo_id: "r4", repo_name: "four", projects_json: project("CS-BETA") }),
];

async function setMap(tags: Record<string, string>): Promise<void> {
  const repoTags = await import("../src/server/repoTags");
  const map: Record<string, { domain: string | null; lifecycle: string | null }> = {};
  for (const [id, domain] of Object.entries(tags)) map[repoTags.foldToken(id)] = { domain, lifecycle: null };
  repoTags.resetRepoTagMapMemo();
  repoTags.setRepoTagMap(map);
  repoTags.resetRepoTagMapMemo();
}

function ok(result: unknown): Rec {
  const r = result as Rec;
  expect(r["ok"], `expected ok:true, got ${JSON.stringify(r)}`).toBe(true);
  return r["data"] as Rec;
}

const domainCounts = () => Object.fromEntries(
  ((ok(server.api.bootstrap({}))["filterOptions"] as Rec)["domainList"] as { name: string; findings: number }[])
    .map((d) => [d.name, d.findings]));

beforeEach(async () => {
  server = await bootServer();
  server.setup();
  const { overwrite, TABS } = await import("../src/server/sheetsDb");
  overwrite(TABS.ledger, ROWS);
});

describe("the header counts a support group under its one pinned domain", () => {
  it("puts r3's findings in CROSS with the rest of CS-ALPHA, though r3 is tagged SAP", async () => {
    await setMap({ r1: "CROSS", r2: "CROSS", r3: "SAP", r4: "SAP" });
    expect(domainCounts()).toEqual({ CROSS: 4, SAP: 1 });
  });

  it("follows a tag-map refresh without any memo reset", async () => {
    await setMap({ r1: "CROSS", r2: "CROSS", r3: "SAP", r4: "SAP" });
    expect(domainCounts()).toEqual({ CROSS: 4, SAP: 1 });
    await setMap({ r1: "CROSS", r2: "SAP", r3: "SAP", r4: "SAP" });
    expect(domainCounts()).toEqual({ SAP: 5 });
  });

  it("with no map, nothing is placed", () => {
    expect(domainCounts()).toEqual({});
  });
});
