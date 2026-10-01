// The MTTR page's breakdown and its row sheet through the server (readModels.mttrSplitModel /
// mttrGroupModel, api.getMttrPage.byGroup / getMttrGroup / getRegisterRows + split): the split
// follows the header scope, adds up to the hero, sorts "(none)" last, caps the repository split,
// and a row's sheet lists exactly that row's findings — inside the scope, never past it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootServer, resetServerMemos, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type ServerModule = Awaited<ReturnType<typeof bootServer>>;
let server: ServerModule;

const OWNER = "dev@example.com";
let active = OWNER;
const g = globalThis as unknown as Rec;

function props() {
  return (g["PropertiesService"] as { getScriptProperties: () => {
    getProperty: (k: string) => string | null; setProperty: (k: string, v: string) => void;
  } }).getScriptProperties();
}

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

/**
 * CROSS: CS-ALPHA (r1, r2 CROSS; r3 SAP — pinned CROSS) and CS-DELTA (r6 CROSS).
 * SAP: CS-BETA (r4). No domain: CS-GAMMA (r5, untagged). r2's finding is resolved.
 */
const ROWS: Rec[] = [
  ledgerRow({ finding_key: "sca#1", scope: "sca", repo_id: "r1", repo_name: "one", projects_json: project("CS-ALPHA") }),
  ledgerRow({
    finding_key: "sca#2", scope: "sca", repo_id: "r2", repo_name: "two", projects_json: project("CS-ALPHA"),
    status: "RESOLVED", resolved_at: "2026-03-01T00:00:00Z", resolution_src: "observed",
  }),
  ledgerRow({ finding_key: "sca#3", scope: "sca", repo_id: "r3", repo_name: "three", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sast#3", scope: "sast", repo_id: "r3", repo_name: "three", projects_json: project("CS-ALPHA") }),
  ledgerRow({ finding_key: "sca#4", scope: "sca", repo_id: "r4", repo_name: "four", projects_json: project("CS-BETA") }),
  ledgerRow({ finding_key: "sca#5", scope: "sca", repo_id: "r5", repo_name: "five", projects_json: project("CS-GAMMA") }),
  ledgerRow({ finding_key: "sca#6", scope: "sca", repo_id: "r6", repo_name: "six", projects_json: project("CS-DELTA") }),
];
const MAP = { r1: "CROSS", r2: "CROSS", r3: "SAP", r4: "SAP", r6: "CROSS" };

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

async function seed(rows: Rec[]): Promise<void> {
  const { overwrite, TABS } = await import("../src/server/sheetsDb");
  overwrite(TABS.ledger, rows);
  await resetServerMemos();
}

const split = () => ok(server.api.getMttrPage({}))["byGroup"] as Rec;
const labels = (s: Rec) => (s["rows"] as Rec[]).map((r) => r["group"]);
const keysOf = (d: Rec) => (d["rows"] as Rec[]).map((r) => r["finding_key"]).sort();

beforeEach(async () => {
  server = await bootServer();
  g["Session"] = {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => OWNER }),
  };
  active = OWNER;
  server.setup();
  await seed(ROWS);
  await setMap(MAP);
});

describe("the split follows the header scope", () => {
  it("splits by domain unscoped, with the no-domain bucket last", () => {
    const s = split();
    expect(s["dimension"]).toBe("domain");
    expect(labels(s)).toEqual(["CROSS", "SAP", "(none)"]);
  });

  it("adds up to the hero: every row of the population is in exactly one bucket", () => {
    const page = ok(server.api.getMttrPage({}));
    const rows = (page["byGroup"] as Rec)["rows"] as Rec[];
    const total = rows.reduce((a, r) => a + Number(r["open"]) + Number(r["resolved"]), 0);
    expect(total).toBe((page["mttr"] as Rec)["rowCount"]);
    const cross = rows.find((r) => r["group"] === "CROSS")!;
    // r3 is tagged SAP, but CS-ALPHA is pinned to CROSS — its findings count there.
    expect([cross["open"], cross["resolved"]]).toEqual([4, 1]);
    expect(cross["openByScope"]).toEqual({ sca: 3, sast: 1 });
  });

  it("splits a domain by support group", () => {
    ok(server.api.setDomainView({ domainView: "CROSS" }));
    const s = split();
    expect(s["dimension"]).toBe("supportGroup");
    expect(labels(s)).toEqual(["CS-ALPHA", "CS-DELTA"]);
    expect(s["within"]).toMatchObject({ kind: "domain", value: "CROSS" });
  });

  it("splits a one-group project by repository, capped at twenty with the rest as `cut`", async () => {
    const many = Array.from({ length: 22 }, (_, i) => ledgerRow({
      finding_key: `sca#big${i}`, scope: "sca", repo_id: `big${i}`,
      repo_name: `big-${String(i).padStart(2, "0")}`, projects_json: project("CS-BIG"),
    }));
    await seed([...ROWS, ...many]);
    ok(server.api.setProjectView({ projectView: "cs-big" }));
    const s = split();
    expect(s["dimension"]).toBe("repo");
    expect((s["rows"] as Rec[]).length).toBe(20);
    expect(s["cut"]).toEqual({ groups: 2, open: 2, resolved: 0, leftCoverage: 0 });
    expect((s["within"] as Rec)["supportGroup"]).toBe("CS-BIG");
  });

  it("ranks and cuts repositories without reading a drop-out as a fix", async () => {
    // Nineteen open repositories, then one slot: "aa-drop" (three findings that left coverage
    // with it) against "zz-fixed" (one real fix). Counted as resolved, the drop-outs won the
    // slot and the cut said "1 resolved"; they are neither open nor resolved.
    const at = "2026-03-01T00:00:00Z";
    const big = (name: string, over: Partial<Rec> = {}) => ledgerRow({
      finding_key: `sca#${name}`, scope: "sca", repo_id: name, repo_name: name,
      projects_json: project("CS-BIG"), ...over,
    });
    const dropped = { status: "RESOLVED", resolved_at: at, resolution_src: "repo_dropout" };
    await seed([
      ...ROWS,
      ...Array.from({ length: 19 }, (_, i) => big(`big-${String(i).padStart(2, "0")}`)),
      // A drop-out on a repository that is listed anyway: not part of its totals either.
      { ...big("big-00"), finding_key: "sca#big-00-left", ...dropped },
      ...["1", "2", "3"].map((i) => ({ ...big("aa-drop"), finding_key: `sca#aa-drop-${i}`, ...dropped })),
      big("zz-fixed", { status: "RESOLVED", resolved_at: at, resolution_src: "api" }),
    ]);
    ok(server.api.setProjectView({ projectView: "cs-big" }));
    const s = split();
    expect(s["dimension"]).toBe("repo");
    expect(labels(s)).toContain("zz-fixed");
    expect(labels(s)).not.toContain("aa-drop");
    expect(s["cut"]).toEqual({ groups: 1, open: 0, resolved: 0, leftCoverage: 3 });
    const big00 = (s["rows"] as Rec[]).find((r) => r["group"] === "big-00")!;
    expect(big00["totalByScope"]).toEqual({ sca: 1 });
  });
});

describe("one row, opened", () => {
  it("measures the row alone and names the one domain it counts under", () => {
    const m = ok(server.api.getMttrGroup({ groupBy: "supportGroup", groupValue: "CS-ALPHA" }));
    expect(m["rowCount"]).toBe(4);
    expect(m["countedDomain"]).toBe("CROSS");
  });

  it("names no domain for a bucket whose findings share none", () => {
    const m = ok(server.api.getMttrGroup({ groupBy: "domain", groupValue: "(none)" }));
    expect(m["rowCount"]).toBe(1);
    expect(m["countedDomain"]).toBeNull();
  });

  it("refuses an unknown dimension rather than widening to the whole scope", () => {
    const r = server.api.getMttrGroup({ groupBy: "everything", groupValue: "x" }) as unknown as Rec;
    expect(r["ok"]).toBe(false);
  });

  it("lists exactly the row's findings, one register at a time", () => {
    const sca = ok(server.api.getRegisterRows({
      scope: "sca", status: "all", pageSize: 500, split: { by: "supportGroup", value: "CS-ALPHA" },
    }));
    expect(keysOf(sca)).toEqual(["sca#1", "sca#2", "sca#3"]);
    const sast = ok(server.api.getRegisterRows({
      scope: "sast", status: "all", pageSize: 500, split: { by: "domain", value: "CROSS" },
    }));
    expect(keysOf(sast)).toEqual(["sast#3"]);
    const none = ok(server.api.getRegisterRows({
      scope: "sca", status: "all", pageSize: 500, split: { by: "domain", value: "(none)" },
    }));
    expect(keysOf(none)).toEqual(["sca#5"]);
  });

  it("stays inside the header scope: a group outside the domain lists nothing", () => {
    ok(server.api.setDomainView({ domainView: "CROSS" }));
    const d = ok(server.api.getRegisterRows({
      scope: "sca", status: "all", pageSize: 500, split: { by: "supportGroup", value: "CS-BETA" },
    }));
    expect(keysOf(d)).toEqual([]);
  });

  it("cannot widen a scoped viewer's scope", async () => {
    props().setProperty("ALLOWED_USERS", OWNER);
    props().setProperty("SCOPED_USERS", JSON.stringify({ "viewer@example.com": { p: ["cs-alpha"] } }));
    active = "viewer@example.com";
    await resetServerMemos();
    const outside = ok(server.api.getRegisterRows({
      scope: "sca", status: "all", pageSize: 500, split: { by: "supportGroup", value: "CS-BETA" },
    }));
    expect(keysOf(outside)).toEqual([]);
    const inside = ok(server.api.getRegisterRows({
      scope: "sca", status: "all", pageSize: 500, split: { by: "domain", value: "CROSS" },
    }));
    expect(keysOf(inside)).toEqual(["sca#1", "sca#2", "sca#3"]);
  });
});
