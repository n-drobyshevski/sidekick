// The scoped-viewer tier: someone admitted to a reduced, read-only shell over their own domains
// and support groups only.
//
// THE TWO HALVES OF THE BOUNDARY ARE PINNED SEPARATELY, because either alone is a leak:
//
//   the FENCE  — `denyResult` refuses a scoped caller every RPC outside `SCOPED_RPCS`, so
//                settings saves, scans, purges and every register-wide read never run;
//   the FORCE  — the endpoints inside the fence replace whatever scope the request carried
//                with the viewer's own, so `getRegisterRows({supportGroup: "someone else"})`
//                or `{domain: ""}` (the whole register) still answers with their rows.
//
// Plus the roster itself: who may edit it, that the owner and admins cannot be scoped, that
// the tiers stay exclusive, and that a malformed property admits nobody.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEVERITY_ORDER } from "../src/domain/config";
import { DEFAULT_RISK_RULE } from "../src/domain/program";
import type { Rec } from "../src/domain/util";

const OWNER = "owner@example.com";
const H = vi.hoisted(() => ({
  active: "",
  props: {} as Record<string, string>,
  base: [] as Rec[],
  frame: null as { scanId: string; ts: string; records: Rec[] } | null,
}));

vi.stubGlobal("Session", {
  getActiveUser: () => ({ getEmail: () => H.active }),
  getEffectiveUser: () => ({ getEmail: () => OWNER }),
});
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => H.props[k] ?? null,
    setProperty: (k: string, v: string) => { H.props[k] = v; },
    deleteProperty: (k: string) => { delete H.props[k]; },
  }),
});
// saveScoped schedules a warm for new viewers; the trigger plumbing is not what this measures.
vi.stubGlobal("CacheService", {
  getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => [],
  newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => {} }) }) }),
});
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: { name: "scans", headers: [] }, settings: { name: "settings", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  cellUsage: () => ({ total: 0, tabs: {} }), ensureTabs: () => {},
}));
vi.mock("../src/server/serverCache", () => ({
  BUILD_ID: "test",
  cached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  currentStamp: () => "stamp",
  dataVersion: () => "1",
}));
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  durablyPeek: () => undefined,
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));
vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.base.map((r) => ({ ...r })),
  loadScanRows: () => [],
  latestFlatScanRow: () => ({ scan_id: "scan-9", severities: null }),
  latestScanRow: () => ({ scan_id: "scan-9", ts: "2026-06-01T00:00:00Z", total: H.base.length }),
  loadTrend: () => [{ date: "2026-06-01T00:00:00Z", open: 1, km_median_days: 4 }],
}));
vi.mock("../src/server/findings", () => ({
  currentScan: () => H.frame,
  distinct: () => [],
  applyFilters: (records: Rec[]) => records,
  TABLE_COLUMNS: ["_vuln_key", "severity", "sg", "dom"],
}));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => true,
  getIncludeEol: () => true,
  getDisplaySeverities: () => null,
  getFetchSeverities: () => null,
  getRetentionDays: () => null,
  getAutoCompact: () => false,
  getDomains: () => ({ items: [] }),
  getRiskRule: () => ({ version: 1, rule: { ...DEFAULT_RISK_RULE } }),
}));
// Support group straight off a fixture field; the business domain off another, so the
// resolved `_domain` is the tag value (resolveDomain reads `_bizDomain` first).
vi.mock("../src/server/supportGroups", () => ({
  attachSupportGroups: (rows: Rec[]) => {
    for (const r of rows) r["_supportGroup"] = String(r["sg"] ?? "");
  },
}));
vi.mock("../src/server/bizDomains", () => ({
  attachBizDomains: (rows: Rec[]) => {
    for (const r of rows) r["_bizDomain"] = String(r["dom"] ?? "");
  },
  configuredDomainTagKey: () => "Wiz/Domain",
}));
vi.mock("../src/server/errorLog", () => ({ recordError: () => {}, recentErrors: () => [] }));
vi.mock("../src/server/hubUrl", () => ({ readHubUrl: () => "", writeHubUrl: () => "" }));

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 86_400_000;

/** 40 findings over four support groups and two domains, every tenth one resolved. */
function row(i: number): Rec {
  const resolved = i % 10 === 0;
  const firstMs = NOW - (i + 1) * DAY;
  const first = new Date(firstMs).toISOString();
  return {
    vuln_key: `k${String(i).padStart(3, "0")}`,
    cve: `CVE-2026-${i}`,
    severity: SEVERITY_ORDER[i % 4]!,
    asset_name: `host-${i}`,
    first_seen: first,
    last_seen: new Date(NOW).toISOString(),
    status: resolved ? "RESOLVED" : "OPEN",
    resolved_at: resolved ? new Date(firstMs + 3 * DAY).toISOString() : null,
    observed: !resolved,
    mttr_days: resolved ? 3 : null,
    age_days: resolved ? null : (NOW - firstMs) / DAY,
    fix_available_at: first,
    actionable_from: first,
    mttr_actionable_days: resolved ? 3 : null,
    actionable_age_days: resolved ? null : (NOW - firstMs) / DAY,
    awaiting_vendor_fix: false,
    tags_json: null,
    sg: `SG-${i % 4}`,
    dom: i % 2 === 0 ? "Payments" : "Logistics",
  };
}

function seed(): void {
  H.base = Array.from({ length: 40 }, (_, i) => row(i));
  H.frame = {
    scanId: "scan-9",
    ts: new Date(NOW).toISOString(),
    records: H.base.filter((r) => r["status"] === "OPEN").map((r) => ({
      _vuln_key: r["vuln_key"],
      _sev: r["severity"],
      severity: r["severity"],
      status: "OPEN",
      _domain: r["dom"],
      _supportGroup: r["sg"],
      sg: r["sg"],
      dom: r["dom"],
    })),
  };
}

async function load() {
  const api = await import("../src/server/api");
  const access = await import("../src/server/access");
  return { api, access };
}

beforeEach(() => {
  for (const k of Object.keys(H.props)) delete H.props[k];
  H.props["ALLOWED_USERS"] = "listed@example.com";
  H.props["ALLOWED_ADMINS"] = "admin@example.com";
  H.props["SCOPED_USERS"] = JSON.stringify({ "viewer@example.com": { g: ["SG-1"] } });
  H.active = OWNER;
  seed();
  vi.resetModules();
});

// --------------------------------------------------------------------------------------- //
//  the decision
// --------------------------------------------------------------------------------------- //

describe("decide — where the scoped tier sits", () => {
  it("admits a rostered viewer as scoped, carrying their scope", async () => {
    const { access } = await load();
    const d = access.decide("Viewer@Example.com", OWNER, "", "", H.props["SCOPED_USERS"]);
    expect(d).toMatchObject({ allowed: true, reason: "scoped" });
    expect(d.scope).toEqual({ d: [], g: ["SG-1"] });
  });

  it("lets the NARROWER grant win when one address is on both lists", async () => {
    // A hand edit in Project Settings can do this; reading it as full access would widen a
    // grant nobody chose to widen.
    const { access } = await load();
    const d = access.decide("viewer@example.com", OWNER, "viewer@example.com", "", H.props["SCOPED_USERS"]);
    expect(d.reason).toBe("scoped");
  });

  it("never scopes the owner or an admin", async () => {
    const { access } = await load();
    const scoped = JSON.stringify({ [OWNER]: { d: ["Payments"] }, "admin@example.com": { d: ["Payments"] } });
    expect(access.decide(OWNER, OWNER, "", "", scoped).reason).toBe("owner");
    expect(access.decide("admin@example.com", OWNER, "", "admin@example.com", scoped).reason).toBe("admin");
  });

  it("admits NOBODY off a malformed or empty-scope roster — never 'scoped to everything'", async () => {
    const { access } = await load();
    expect(access.decide("viewer@example.com", OWNER, "", "", "{not json").allowed).toBe(false);
    expect(access.decide("viewer@example.com", OWNER, "", "", '{"viewer@example.com":{"d":[]}}').allowed)
      .toBe(false);
    expect(access.decide("viewer@example.com", OWNER, "", "", '["viewer@example.com"]').allowed).toBe(false);
  });
});

// --------------------------------------------------------------------------------------- //
//  the fence
// --------------------------------------------------------------------------------------- //

describe("denyResult — the scoped viewer's fence", () => {
  it("refuses everything outside SCOPED_RPCS", async () => {
    H.active = "viewer@example.com";
    const { access } = await load();
    for (const op of ["getSettings", "saveSettings", "runScan", "getMttrPage", "getExecutivePage",
      "getAccess", "saveAccess", "saveScoped", "resetLedger", "exportMigrationBundle", "getInsights"]) {
      const res = access.denyResult(op);
      expect(res, op).not.toBeNull();
      expect(res!.errorKind).toBe("forbidden");
    }
  });

  it("lets through exactly the reduced shell's calls", async () => {
    H.active = "viewer@example.com";
    const { access } = await load();
    for (const op of access.SCOPED_RPCS) expect(access.denyResult(op), op).toBeNull();
  });

  it("refuses the editor-run maintenance globals too", async () => {
    H.active = "viewer@example.com";
    const { access } = await load();
    expect(() => access.assertAllowed("setup")).toThrow();
  });

  it("leaves a full user's fence exactly as it was", async () => {
    H.active = "listed@example.com";
    const { access } = await load();
    expect(access.denyResult("getSettings")).toBeNull();
    expect(access.enforcedScope()).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  the force
// --------------------------------------------------------------------------------------- //

function groupsOf(rows: Rec[]): string[] {
  return Array.from(new Set(rows.map((r) => String(r["support_group"])))).sort();
}

describe("getRegisterRows — the viewer's scope replaces the request's", () => {
  it("answers with the viewer's rows whatever scope the request names", async () => {
    H.active = "viewer@example.com";
    const { api } = await load();
    for (const p of [
      {},
      { domain: "", supportGroup: "" },
      { supportGroup: "SG-2" },
      { domain: "Logistics" },
      { viewerScope: { domains: ["Payments", "Logistics"], supportGroups: [] } },
    ]) {
      const res = api.getRegisterRows({ ...p, status: "all", pageSize: 500 });
      expect(res.ok, JSON.stringify(p)).toBe(true);
      const data = res.data as { rows: Rec[]; total: number };
      expect(groupsOf(data.rows), JSON.stringify(p)).toEqual(["SG-1"]);
      expect(data.total).toBe(10);
    }
  });

  it("takes the UNION across dimensions", async () => {
    H.props["SCOPED_USERS"] = JSON.stringify({ "viewer@example.com": { d: ["Payments"], g: ["SG-1"] } });
    H.active = "viewer@example.com";
    const { api } = await load();
    const data = api.getRegisterRows({ status: "all", pageSize: 500 }).data as { rows: Rec[] };
    // Payments is every even row (SG-0, SG-2); SG-1 is odd rows. The union is three groups.
    expect(groupsOf(data.rows)).toEqual(["SG-0", "SG-1", "SG-2"]);
  });

  it("leaves a full user's unscoped register untouched", async () => {
    H.active = "listed@example.com";
    const { api } = await load();
    const data = api.getRegisterRows({ status: "all", pageSize: 500 }).data as { total: number };
    expect(data.total).toBe(40);
  });

  it("exports only the viewer's rows as CSV", async () => {
    H.active = "viewer@example.com";
    const { api } = await load();
    const res = api.getExportCsv({ supportGroups: [] });
    const lines = String((res.data as Rec)["content"]).split("\r\n").slice(1);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toContain("SG-1");
  });
});

describe("bootstrap — a scoped viewer never receives the core", () => {
  it("returns the small scoped boot with its summary and no other domain's names", async () => {
    H.active = "viewer@example.com";
    const { api } = await load();
    const res = api.bootstrap();
    expect(res.ok).toBe(true);
    const data = res.data as Rec;
    expect(data["role"]).toBe("scoped");
    expect(data["scope"]).toEqual({ domains: [], supportGroups: ["SG-1"] });
    expect(data["domainNames"]).toBeUndefined();
    expect(data["scopeCounts"]).toBeUndefined();
    expect(data["settings"]).not.toHaveProperty("domains");
    const text = JSON.stringify(data);
    for (const other of ["SG-0", "SG-2", "SG-3", "Logistics"]) expect(text).not.toContain(other);
    const summary = data["summary"] as Rec;
    // 10 SG-1 rows, one resolved (i = 1, 5, 9, … — none a multiple of ten), so ten open.
    expect(summary["open"]).toBe(10);
  });

  it("a full user can preview a scope's summary; a viewer cannot widen theirs", async () => {
    H.active = OWNER;
    let { api } = await load();
    const preview = api.getScopeSummary({ viewerScope: { domains: ["Payments"], supportGroups: [] } });
    expect(preview.ok).toBe(true);
    expect((preview.data as Rec)["open"]).toBe(16); // 20 Payments rows, four resolved

    vi.resetModules();
    H.active = "viewer@example.com";
    ({ api } = await load());
    const own = api.getScopeSummary({ viewerScope: { domains: ["Payments"], supportGroups: [] } });
    expect((own.data as Rec)["open"]).toBe(10);
  });
});

// --------------------------------------------------------------------------------------- //
//  the roster
// --------------------------------------------------------------------------------------- //

describe("saveScoped — who may edit the roster, and what it refuses", () => {
  const entry = (email: string, supportGroups: string[] = ["SG-3"]) =>
    ({ email, scope: { domains: [], supportGroups } });

  it("lets an admin save it, and moves the address out of the full-access list", async () => {
    H.active = "admin@example.com";
    const { api } = await load();
    const res = api.saveScoped({ scoped: [entry("listed@example.com")] });
    expect(res.ok, String(res.error)).toBe(true);
    expect(JSON.parse(H.props["SCOPED_USERS"]!)).toEqual({ "listed@example.com": { g: ["SG-3"] } });
    expect(H.props["ALLOWED_USERS"]).not.toContain("listed@example.com");
  });

  it("refuses a listed user and a scoped viewer", async () => {
    for (const who of ["listed@example.com", "viewer@example.com"]) {
      vi.resetModules();
      H.active = who;
      const { api } = await load();
      expect(api.saveScoped({ scoped: [entry("x@example.com")] }).ok, who).toBe(false);
    }
  });

  it("refuses to scope the owner or an admin", async () => {
    const { api } = await load();
    expect(api.saveScoped({ scoped: [entry(OWNER)] }).ok).toBe(false);
    expect(api.saveScoped({ scoped: [entry("admin@example.com")] }).ok).toBe(false);
  });

  it("refuses an entry with no scope rather than storing 'everything'", async () => {
    const before = H.props["SCOPED_USERS"];
    const { api } = await load();
    const res = api.saveScoped({ scoped: [entry("x@example.com", [])] });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("x@example.com");
    expect(H.props["SCOPED_USERS"]).toBe(before);
  });

  it("granting full access un-scopes the person in the same save", async () => {
    const { api } = await load();
    expect(api.saveAccess({ users: "listed@example.com, viewer@example.com" }).ok).toBe(true);
    expect(JSON.parse(H.props["SCOPED_USERS"]!)).toEqual({});
  });

  it("getAccess hands editors the roster and the picker's catalogue, and viewers nothing", async () => {
    const { api } = await load();
    const res = api.getAccess();
    expect(res.ok, String(res.error)).toBe(true);
    const data = res.data as Rec;
    expect(data["scoped"]).toEqual([
      { email: "viewer@example.com", scope: { domains: [], supportGroups: ["SG-1"] } },
    ]);
    expect((data["catalogue"] as Rec)["dims"]).toHaveLength(2);
  });
});
