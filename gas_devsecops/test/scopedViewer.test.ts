// The scoped-viewer tier over a REAL booted server (test/gasEnv.ts): someone admitted only to
// a summary and the findings of their own domains / projects.
//
// The two halves of the boundary are pinned separately, because either alone is a leak — the
// FENCE (`denyResult` refuses a scoped caller every RPC outside `SCOPED_RPCS`) and the FORCE
// (the endpoints inside it answer at the viewer's scope whatever the request carried). Plus
// the roster: who may edit it, what it refuses, and that the tiers stay exclusive.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootServer, resetServerMemos, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type ServerModule = Awaited<ReturnType<typeof bootServer>>;
let server: ServerModule;

const OWNER = "dev@example.com";
let active = OWNER;

const LEAF_A = { slug: "leaf-a", name: "Leaf A", isFolder: false };
const LEAF_B = { slug: "leaf-b", name: "Leaf B", isFolder: false };

function ledgerRow(over: Partial<Rec> & { finding_key: string; scope: string }): Rec {
  return {
    identifier: null, component: null, severity: "HIGH", repo_id: "r1", repo_name: "repo-one",
    branch: "main", platform: "github", first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-08-01T00:00:00Z", status: "OPEN", resolved_at: null, resolution_src: null,
    reopened_count: 0, first_scan_id: "sync-1", last_scan_id: "sync-1", fix_date: null,
    fix_observed_at: null, fixed_version: null, has_kev: null, has_exploit: null, epss: null,
    cwe: null, ai_verdict: null, language: null, file_path: null, start_line: null, origin: null,
    secret_kind: null, rotated_at: null, removed_at: null, validation_state: null,
    validated_at: null, confidence: null, owner_project: null, owner_path: null, tags_json: null,
    projects_json: null,
    ...over,
  };
}

const LEDGER_ROWS: Rec[] = [
  ledgerRow({ finding_key: "sca#a1", scope: "sca", projects_json: JSON.stringify([LEAF_A]) }),
  ledgerRow({ finding_key: "sca#a2", scope: "sca", projects_json: JSON.stringify([LEAF_A]),
    status: "RESOLVED", resolved_at: "2026-02-01T00:00:00Z" }),
  ledgerRow({ finding_key: "sca#b", scope: "sca", projects_json: JSON.stringify([LEAF_B]) }),
  ledgerRow({ finding_key: "sast#a", scope: "sast", projects_json: JSON.stringify([LEAF_A]) }),
  ledgerRow({ finding_key: "sast#b", scope: "sast", projects_json: JSON.stringify([LEAF_B]) }),
  ledgerRow({ finding_key: "sca#none", scope: "sca", projects_json: null }),
];

const g = globalThis as unknown as Rec;

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

beforeEach(async () => {
  server = await bootServer();
  g["Session"] = {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => OWNER }),
  };
  active = OWNER;
  server.setup();
  const { overwrite, TABS } = await import("../src/server/sheetsDb");
  overwrite(TABS.ledger, LEDGER_ROWS);
  props().setProperty("ALLOWED_USERS", `${OWNER}, listed@example.com`);
  props().setProperty("ALLOWED_ADMINS", "admin@example.com");
  props().setProperty("SCOPED_USERS", JSON.stringify({ "viewer@example.com": { p: ["leaf-a"] } }));
  await resetServerMemos();
});

afterEach(() => {
  teardownServer();
});

describe("the fence", () => {
  it("refuses a scoped viewer everything outside SCOPED_RPCS", async () => {
    await as("viewer@example.com");
    for (const op of ["getSettings", "putSettings", "setProjectView", "runSync", "getMttrPage",
      "getExecutivePage", "getAccess", "saveAccess", "saveScoped", "resetLedger", "getRegisterPage"]) {
      const res = server.access.denyResult(op);
      expect(res, op).not.toBeNull();
      expect(res!.errorKind).toBe("forbidden");
    }
    for (const op of server.access.SCOPED_RPCS) expect(server.access.denyResult(op), op).toBeNull();
  });

  it("leaves a full user's fence as it was", async () => {
    await as("listed@example.com");
    expect(server.access.denyResult("getSettings")).toBeNull();
    expect(server.access.enforcedScope()).toBeNull();
  });
});

describe("the force", () => {
  it("answers the findings list at the viewer's scope, whatever the request names", async () => {
    await as("viewer@example.com");
    for (const extra of [{}, { viewerScope: { domains: [], projects: ["leaf-b"] } }]) {
      const d = ok(server.api.getRegisterRows({ scope: "sca", status: "all", pageSize: 500, ...extra }));
      const keys = (d["rows"] as Rec[]).map((r) => r["finding_key"]).sort();
      expect(keys, JSON.stringify(extra)).toEqual(["sca#a1", "sca#a2"]);
    }
  });

  it("ignores a global project view a full user set", async () => {
    ok(server.api.setProjectView({ projectView: "leaf-b" }));
    await as("viewer@example.com");
    const d = ok(server.api.getRegisterRows({ scope: "sast", status: "all", pageSize: 500 }));
    expect((d["rows"] as Rec[]).map((r) => r["finding_key"])).toEqual(["sast#a"]);
  });

  it("exports only the viewer's rows", async () => {
    await as("viewer@example.com");
    const d = ok(server.api.getExportCsv({}));
    expect(d["rowCount"]).toBe(3); // sca#a1, sca#a2, sast#a
    expect(String(d["content"])).not.toContain("sca#b");
    expect(String(d["content"])).not.toContain("sca#none");
  });

  it("boots the small scoped payload, carrying the summary and nothing register-wide", async () => {
    await as("viewer@example.com");
    const d = ok(server.api.bootstrap());
    expect(d["role"]).toBe("scoped");
    expect(d["scope"]).toEqual({ domains: [], projects: ["leaf-a"] });
    expect(d["filterOptions"]).toBeUndefined();
    expect(d["settings"]).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("leaf-b");
    const summary = d["summary"] as Rec;
    expect(summary["open"]).toBe(2);
    expect(summary["resolved"]).toBe(1);
  });

  it("lets a full user preview a scope, and never lets a viewer widen theirs", async () => {
    const preview = ok(server.api.getScopeSummary({ viewerScope: { domains: [], projects: ["leaf-b"] } }));
    expect(preview["open"]).toBe(2);
    await as("viewer@example.com");
    const own = ok(server.api.getScopeSummary({ viewerScope: { domains: [], projects: ["leaf-b"] } }));
    expect(own["open"]).toBe(2);
    expect(own["resolved"]).toBe(1); // leaf-a's, not leaf-b's
  });
});

describe("the roster", () => {
  const entry = (email: string, projects = ["leaf-b"]) => ({ email, scope: { domains: [], projects } });

  it("lets an admin save it and moves the address out of full access", async () => {
    await as("admin@example.com");
    const d = ok(server.api.saveScoped({ scoped: [entry("listed@example.com")] }));
    expect(d["scoped"]).toEqual([{ email: "listed@example.com", scope: { domains: [], projects: ["leaf-b"] } }]);
    expect(props().getProperty("ALLOWED_USERS")).not.toContain("listed@example.com");
  });

  it("refuses a listed user, the owner as a target, and an empty scope", async () => {
    await as("listed@example.com");
    expect(server.api.saveScoped({ scoped: [entry("x@example.com")] }).ok).toBe(false);
    await as(OWNER);
    expect(server.api.saveScoped({ scoped: [entry(OWNER)] }).ok).toBe(false);
    expect(server.api.saveScoped({ scoped: [entry("x@example.com", [])] }).ok).toBe(false);
  });

  it("granting full access un-scopes the person", async () => {
    ok(server.api.saveAccess({ users: `${OWNER}, viewer@example.com` }));
    expect(JSON.parse(props().getProperty("SCOPED_USERS")!)).toEqual({});
  });

  it("getAccess hands an editor the roster and a catalogue with project labels", async () => {
    const d = ok(server.api.getAccess());
    expect(d["scoped"]).toEqual([{ email: "viewer@example.com", scope: { domains: [], projects: ["leaf-a"] } }]);
    const dims = ((d["catalogue"] as Rec)["dims"] as Rec[]);
    const projects = dims.find((x) => x["key"] === "p")!["options"] as Rec[];
    expect(projects.find((o) => o["value"] === "leaf-a")).toMatchObject({ label: "Leaf A" });
  });
});

describe("group by", () => {
  it("groups the viewer's rows by repository and opens one group", async () => {
    await as("viewer@example.com");
    const g = ok(server.api.getRegisterRows({ scope: "sca", status: "all", groupBy: "repo_name" }));
    const groups = g["groups"] as Rec[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ value: "repo-one", count: 2, open: 1 });
    const rows = ok(server.api.getRegisterRows({
      scope: "sca", status: "all", groupBy: "repo_name", groupValue: "repo-one", pageSize: 500,
    }));
    expect(rows["total"]).toBe(2);
  });

  it("refuses a column the scope's rows do not carry", async () => {
    const d = ok(server.api.getRegisterRows({ scope: "sast", status: "all", groupBy: "secret_kind" }));
    expect(d["groups"]).toBeUndefined();
  });
});
