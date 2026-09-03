// The per-finding row set: the domain-level slice/ordering rule in pagePayload.ts, and
// `readModels.registerRowsModel` — the server-side paging and sorting that feeds it.
//
// THREE THINGS THIS FILE PINS THAT HAVE NO OTHER TEST:
//
//   1. THE ALLOWLIST IS AN ALLOWLIST. `registerRowsSlice` must not be able to leak a field
//      that was never meant to travel, however it arrives on the source row — including a
//      secret's value, and including `raw_ref`/`obs_ref`, which are scan columns and have no
//      business anywhere near a finding row.
//   2. THE ORDERING RULE IS ONE RULE, MEASURED TWICE. `sortRegisterRows` (server, TypeScript)
//      and `sortRows` (client, plain JS, `ui/tableModel.js`) cannot literally share code — the
//      client bundle cannot import a TS module — so this runs both over the same fixture and
//      asserts identical arrangements, nulls included.
//   3. `registerRowsModel` PAGES AND SORTS SERVER-SIDE over a register large enough
//      (1,000 rows) that doing it in the browser would be the wrong design, and CLAMPS rather
//      than honours an oversized page or an out-of-range page index.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCOPES, SEVERITY_ORDER, type Scope } from "../src/domain/config";
import { LEDGER_COLUMNS } from "../src/domain/ledgerTypes";
import type { BaseRow, ScanRow } from "../src/domain/ledgerTypes";
import {
  DERIVED_ROW_COLUMNS,
  REGISTER_ROW_COLUMNS,
  REGISTER_ROW_DEFAULT_SORT,
  REGISTER_ROW_KEY,
  REGISTER_ROWS_DEFAULT_PAGE_SIZE,
  REGISTER_ROWS_PAGE_SIZE_CAP,
  registerRowColumns,
  registerRowsSlice,
} from "../src/domain/pagePayload";

// The ordering rule's cross-check against its client-side twin (`ui/tableModel.js`) lives in
// `test/registerRowsOrdering.test.js`, not here: that module is untyped plain JS with no
// declaration file, and importing it from a `.ts` file fails `tsc --noEmit` under `strict`.
// `npm run check` runs both files, so the split costs nothing but the file boundary.

// --------------------------------------------------------------------------------------- //
//  1. REGISTER_ROW_COLUMNS cross-checked against the ledger's own schema
// --------------------------------------------------------------------------------------- //

describe("REGISTER_ROW_COLUMNS — each scope's list only names columns it can fill", () => {
  it("every non-derived column is either a real LEDGER_COLUMNS column or finding_key", () => {
    for (const scope of SCOPES) {
      for (const col of registerRowColumns(scope)) {
        if ((DERIVED_ROW_COLUMNS as readonly string[]).includes(col)) continue;
        expect(
          LEDGER_COLUMNS.includes(col),
          `${scope}.${col} is neither a LEDGER_COLUMNS column nor a derived column`,
        ).toBe(true);
      }
    }
  });

  it("carries no scan-tab column — raw_ref and obs_ref are not findings columns at all", () => {
    for (const scope of SCOPES) {
      expect(registerRowColumns(scope)).not.toContain("raw_ref");
      expect(registerRowColumns(scope)).not.toContain("obs_ref");
    }
  });

  it("finding_key rides outside the drawn list, exactly once, never duplicated into it", () => {
    for (const scope of SCOPES) {
      expect(registerRowColumns(scope)).not.toContain(REGISTER_ROW_KEY);
    }
    expect(REGISTER_ROW_KEY).toBe("finding_key");
  });

  it("secrets carries no severity column — severity there grades a detection, not a scope", () => {
    expect(registerRowColumns("secrets")).not.toContain("severity");
  });

  it("an unknown scope fills nothing", () => {
    expect(registerRowColumns("nope")).toEqual([]);
  });

  it("every scope has a default sort naming one of its own columns (or a derived one)", () => {
    for (const scope of SCOPES) {
      const def = REGISTER_ROW_DEFAULT_SORT[scope]!;
      expect(registerRowColumns(scope)).toContain(def.sort);
    }
  });
});

// --------------------------------------------------------------------------------------- //
//  2. registerRowsSlice — the allowlist, measured as an allowlist
// --------------------------------------------------------------------------------------- //

describe("registerRowsSlice", () => {
  it("copies only the scope's columns plus finding_key — nothing else off the row", () => {
    const row = {
      finding_key: "sca:CVE-1", scope: "sca", identifier: "CVE-1", severity: "HIGH",
      status: "OPEN", repo_name: "repo-one", branch: "main",
      first_seen: "2026-01-01", last_seen: "2026-03-01",
      fixed_version: "1.2.3", fix_available_at: null, awaiting_vendor_fix: false,
      has_kev: false, has_exploit: false, epss: 0.01, mttr_days: null, age_days: 12,
      component: "left-pad", // sca's own column
      owner_path: "org/proj", tags_json: "[]", resolution_src: null, // NOT in sca's column list
      first_scan_id: "s1", last_scan_id: "s2", repo_id: "r1", risk_observed_at: null,
      raw_ref: "drive-file-1", obs_ref: "drive-file-2",
    };
    const [out] = registerRowsSlice([row], "sca");
    expect(Object.keys(out!).sort()).toEqual(
      [REGISTER_ROW_KEY, ...REGISTER_ROW_COLUMNS["sca"]!].sort(),
    );
    expect(out).not.toHaveProperty("owner_path");
    expect(out).not.toHaveProperty("tags_json");
    expect(out).not.toHaveProperty("raw_ref");
    expect(out).not.toHaveProperty("obs_ref");
  });

  it("has_kev: null SURVIVES as null, not false — absent is never zero", () => {
    const row = { finding_key: "sca:CVE-2", scope: "sca", has_kev: null, has_exploit: null };
    const [out] = registerRowsSlice([row], "sca");
    expect(out!["has_kev"]).toBeNull();
    expect(out!["has_kev"]).not.toBe(false);
    expect(out!["has_exploit"]).toBeNull();
  });

  it("undefined becomes null — the only coercion this function performs", () => {
    const row = { finding_key: "sast:X", scope: "sast" }; // every column absent
    const [out] = registerRowsSlice([row], "sast");
    for (const col of REGISTER_ROW_COLUMNS["sast"]!) expect(out![col]).toBeNull();
  });

  it("a missing finding_key becomes null rather than the string 'undefined'", () => {
    const [out] = registerRowsSlice([{ scope: "sca" }], "sca");
    expect(out![REGISTER_ROW_KEY]).toBeNull();
  });

  it("a non-array input yields no rows", () => {
    expect(registerRowsSlice(null, "sca")).toEqual([]);
    expect(registerRowsSlice(undefined, "sca")).toEqual([]);
  });

  /**
   * THE NON-NEGOTIABLE. No secret value is stored anywhere in this pipeline, but this RPC is
   * the one place a value could newly appear if some future change spread a row instead of
   * picking from it. Simulate exactly that: a source row carrying the denied fields, as if
   * ingest's deny-list had failed. The allowlist must still refuse them.
   */
  it("NEVER SHIPS A SECRET'S VALUE, even if the source row somehow carried one", () => {
    const poisoned = {
      finding_key: "secrets:k1", scope: "secrets", identifier: "k1",
      secret_kind: "SAAS_API_KEY", confidence: "HIGH",
      file_path: "config/prod.yml", start_line: 12,
      validation_state: "VALID", validated_at: "2026-02-01", rotated_at: null, removed_at: null,
      repo_name: "repo-one", branch: "main", first_seen: "2026-01-01", last_seen: "2026-03-01",
      // The two fields Q_SECRETS omits and slimRecord denies — present here as an injection
      // attempt against the allowlist itself.
      snippet: "sk_live_abcdef0123456789",
      validationDetails: { secretValue: "sk_live_abcdef0123456789" },
    };
    const [out] = registerRowsSlice([poisoned], "secrets");
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/snippet|validationDetails|value|secretValue/i);
    expect(json).not.toContain("sk_live_abcdef0123456789");
    expect(out).not.toHaveProperty("snippet");
    expect(out).not.toHaveProperty("validationDetails");
  });

  it("carries no raw_ref/obs_ref for any scope, however the source row is shaped", () => {
    for (const scope of SCOPES) {
      const [out] = registerRowsSlice(
        [{ finding_key: "k", scope, raw_ref: "drive-1", obs_ref: "drive-2" }],
        scope,
      );
      expect(out).not.toHaveProperty("raw_ref");
      expect(out).not.toHaveProperty("obs_ref");
    }
  });
});

// --------------------------------------------------------------------------------------- //
//  3. readModels.registerRowsModel — paging and sorting over a 1,000-row register
// --------------------------------------------------------------------------------------- //

const H = vi.hoisted(() => ({ rows: [] as BaseRow[], scans: [] as ScanRow[], version: "v1" }));

vi.mock("../src/server/serverCache", () => ({
  cached: (_name: string, _params: unknown, compute: () => unknown) => compute(),
  dataVersion: () => H.version,
}));

vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (_name: string, _params: unknown, compute: () => unknown) => compute(),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));

vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.rows.map((r) => ({ ...r })),
  loadScanRows: () => H.scans.slice(),
  loadTrend: () => [],
  loadProgramTrend: () => [],
  latestScanRow: () => null,
  previousSeverityCounts: () => ({}),
}));

vi.mock("../src/server/historyStore", () => ({ listHistory: () => [] }));
vi.mock("../src/server/jobsStore", () => ({ activeJob: () => null }));
vi.mock("../src/server/sheetsDb", () => ({
  cellCount: () => 0,
  gridSize: () => ({ rows: 0, cols: 0 }),
}));

import { __resetModelMemosForTest, registerRowsModel } from "../src/server/readModels";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 86_400_000;

function scaRow(i: number): BaseRow {
  const resolved = i % 10 === 0; // a tenth of the register is closed, to exercise null age_days
  const firstMs = NOW - (i + 1) * DAY;
  const first = new Date(firstMs).toISOString();
  const sev = SEVERITY_ORDER[i % 5]!; // CRITICAL..INFO, cycled — never UNKNOWN
  return {
    finding_key: `sca:CVE-${String(i).padStart(5, "0")}`,
    scope: "sca",
    identifier: `CVE-${i}`,
    component: "left-pad",
    severity: sev,
    repo_id: "r1",
    repo_name: "repo-one",
    branch: "main",
    platform: "github",
    first_seen: first,
    last_seen: first,
    status: resolved ? "RESOLVED" : "OPEN",
    resolved_at: resolved ? new Date(firstMs + DAY).toISOString() : null,
    resolution_src: resolved ? "disappeared" : null,
    reopened_count: 0,
    first_scan_id: "sync-1",
    last_scan_id: "sync-2",
    fix_date: null,
    fix_observed_at: null,
    fixed_version: null,
    has_kev: i % 4 === 0 ? null : i % 4 === 1, // a real mix of null / true / false
    has_exploit: null,
    epss: null,
    risk_observed_at: null,
    cwe: null,
    ai_verdict: null,
    language: "python",
    file_path: null,
    start_line: null,
    origin: null,
    secret_kind: null,
    rotated_at: null,
    removed_at: null,
    validation_state: null,
    validated_at: null,
    confidence: null,
    owner_project: "proj-a",
    owner_path: "org/proj-a",
    tags_json: null,
    mttr_days: resolved ? 1 : null,
    age_days: resolved ? null : (NOW - firstMs) / DAY,
    fix_available_at: first,
    actionable_from: first,
    mttr_actionable_days: resolved ? 1 : null,
    actionable_age_days: resolved ? null : (NOW - firstMs) / DAY,
    awaiting_vendor_fix: false,
  };
}

function secretsRow(i: number): BaseRow {
  const base = scaRow(i);
  return {
    ...base,
    finding_key: `secrets:k${i}`,
    scope: "secrets",
    severity: "LOW",
    secret_kind: "SAAS_API_KEY",
    confidence: "HIGH",
    validation_state: i % 3 === 0 ? null : (i % 3 === 1 ? "VALID" : "INVALID"),
    has_kev: null,
    has_exploit: null,
  };
}

beforeEach(() => {
  __resetModelMemosForTest();
  H.version = `v${Math.random()}`;
  H.scans = [];
  H.rows = Array.from({ length: 1000 }, (_, i) => scaRow(i));
});

describe("registerRowsModel — paging", () => {
  it("total is 1000, and page 2 (index 1) at pageSize 50 is the second 50 sorted rows", () => {
    const def = registerRowsModel("sca", { pageSize: 50, page: 0 });
    expect(def["total"]).toBe(1000);
    const p0 = registerRowsModel("sca", { pageSize: 50, page: 0 });
    const p1 = registerRowsModel("sca", { pageSize: 50, page: 1 });
    expect((p0["rows"] as BaseRow[]).length).toBe(50);
    expect((p1["rows"] as BaseRow[]).length).toBe(50);
    const keys0 = new Set((p0["rows"] as BaseRow[]).map((r) => r.finding_key));
    const keys1 = new Set((p1["rows"] as BaseRow[]).map((r) => r.finding_key));
    // No row on two pages.
    for (const k of keys1) expect(keys0.has(k)).toBe(false);
    expect(p1["page"]).toBe(1);
    expect(p1["pageCount"]).toBe(20);
  });

  it("a pageSize above the cap is CLAMPED, not honoured", () => {
    const model = registerRowsModel("sca", { pageSize: 100_000, page: 0 });
    expect(model["pageSize"]).toBe(REGISTER_ROWS_PAGE_SIZE_CAP);
    expect((model["rows"] as BaseRow[]).length).toBe(REGISTER_ROWS_PAGE_SIZE_CAP);
  });

  it("an out-of-range page clamps to the last page rather than going blank", () => {
    const model = registerRowsModel("sca", { pageSize: 50, page: 9999 });
    expect(model["page"]).toBe(19); // 1000 / 50 - 1
    expect((model["rows"] as BaseRow[]).length).toBe(50);
  });

  it("defaults to REGISTER_ROWS_DEFAULT_PAGE_SIZE when pageSize is omitted", () => {
    const model = registerRowsModel("sca");
    expect(model["pageSize"]).toBe(REGISTER_ROWS_DEFAULT_PAGE_SIZE);
  });
});

describe("registerRowsModel — sorting", () => {
  it("severity: CRITICAL -> INFO across the whole sorted set", () => {
    const model = registerRowsModel("sca", { sort: "severity", dir: "asc", pageSize: 250, page: 0 });
    const rows = model["rows"] as BaseRow[];
    const ranks = rows.map((r) => (SEVERITY_ORDER as readonly string[]).indexOf(String(r.severity)));
    for (let i = 1; i < ranks.length; i += 1) expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
  });

  it("age_days: numeric, nulls last, in BOTH directions", () => {
    const asc = registerRowsModel("sca", { sort: "age_days", dir: "asc", pageSize: 250, page: 3 });
    const ascRows = asc["rows"] as BaseRow[];
    // Page 3 of 4 (250 x 4 = 1000) is where the tenth-resolved nulls should start surfacing
    // once every non-null age has sorted below them; assert monotonic non-null prefix instead
    // of assuming which page the nulls land on.
    const nums = ascRows.map((r) => r.age_days).filter((v): v is number => v !== null);
    for (let i = 1; i < nums.length; i += 1) expect(nums[i]!).toBeGreaterThanOrEqual(nums[i - 1]!);

    const last = registerRowsModel("sca", { sort: "age_days", dir: "asc", pageSize: 250, page: 3 });
    const lastRows = last["rows"] as BaseRow[];
    // 1000 rows, 100 resolved (nulls) — nulls occupy the final 100 positions overall, which is
    // entirely within pages 3 (750-999) at pageSize 250.
    const nullCount = lastRows.filter((r) => r.age_days === null).length;
    expect(nullCount).toBe(100);
    // And they are a SUFFIX of the page, not scattered through it.
    const idxs = lastRows.map((r, i) => (r.age_days === null ? i : -1)).filter((i) => i >= 0);
    expect(idxs).toEqual(Array.from({ length: 100 }, (_, i) => 150 + i));

    const desc = registerRowsModel("sca", { sort: "age_days", dir: "desc", pageSize: 250, page: 3 });
    const descRows = desc["rows"] as BaseRow[];
    const nullCountDesc = descRows.filter((r) => r.age_days === null).length;
    // Nulls still last in the DESCENDING arrangement too — same 100, same final page.
    expect(nullCountDesc).toBe(100);
    const descIdxs = descRows.map((r, i) => (r.age_days === null ? i : -1)).filter((i) => i >= 0);
    expect(descIdxs).toEqual(Array.from({ length: 100 }, (_, i) => 150 + i));
  });

  it("a sort column this scope does not carry falls back to the scope's default", () => {
    const model = registerRowsModel("sca", { sort: "validation_state" }); // secrets-only column
    expect(model["sort"]).toBe(REGISTER_ROW_DEFAULT_SORT["sca"]!.sort);
  });

  it("two requests for the same page return the SAME rows — the tiebreak makes it total", () => {
    const a = registerRowsModel("sca", { sort: "severity", page: 2, pageSize: 50 });
    const b = registerRowsModel("sca", { sort: "severity", page: 2, pageSize: 50 });
    expect((a["rows"] as BaseRow[]).map((r) => r.finding_key))
      .toEqual((b["rows"] as BaseRow[]).map((r) => r.finding_key));
  });
});

describe("registerRowsModel — has_kev survives the slice as null, not false", () => {
  it("a has_kev: null row stays null through model + registerRowsSlice", () => {
    H.rows = [scaRow(0)]; // i=0 -> has_kev: null by construction
    expect(H.rows[0]!.has_kev).toBeNull();
    const model = registerRowsModel("sca", { pageSize: 10, page: 0 });
    const sliced = registerRowsSlice(model["rows"], "sca");
    expect(sliced[0]!["has_kev"]).toBeNull();
    expect(sliced[0]!["has_kev"]).not.toBe(false);
  });
});

describe("registerRowsModel — secrets", () => {
  beforeEach(() => {
    H.rows = Array.from({ length: 50 }, (_, i) => secretsRow(i));
  });

  it("severityFilterSupported is false, and a severity selection is ignored", () => {
    const unfiltered = registerRowsModel("secrets", { pageSize: 250 });
    const filtered = registerRowsModel("secrets", { pageSize: 250, severities: ["CRITICAL"] });
    expect(unfiltered["severityFilterSupported"]).toBe(false);
    expect(unfiltered["severities"]).toBeNull();
    expect(filtered["severities"]).toBeNull();
    expect(filtered["total"]).toBe(unfiltered["total"]);
  });

  it("carries no credential-value-shaped key anywhere in the sliced rows, full JSON.stringify", () => {
    const model = registerRowsModel("secrets", { pageSize: 250 });
    const sliced = registerRowsSlice(model["rows"], "secrets");
    const json = JSON.stringify(sliced);
    expect(json).not.toMatch(/snippet|validationDetails|secretValue/i);
  });

  it("carries no raw_ref/obs_ref", () => {
    const model = registerRowsModel("secrets", { pageSize: 250 });
    const sliced = registerRowsSlice(model["rows"], "secrets");
    const json = JSON.stringify(sliced);
    expect(json).not.toContain("raw_ref");
    expect(json).not.toContain("obs_ref");
  });
});

// --------------------------------------------------------------------------------------- //
//  5. Perturbations — each guard, broken on purpose, then reverted
// --------------------------------------------------------------------------------------- //
//
// Not part of the pinned suite (nothing here runs by default) — this documents, in code, the
// three perturbations run by hand while building this file and what each one broke. Left as
// `.skip` so the record survives without executing a deliberately-wrong implementation.

describe.skip("perturbations (manual record, see file header)", () => {
  it("collapsing null has_kev to false would fail 'survives the slice as null'", () => {});
  it("dropping the pageSize cap would fail 'CLAMPED, not honoured'", () => {});
  it("sorting nulls first would fail every 'nulls LAST' assertion, both directions", () => {});
});
