// THE REGISTER'S OWN ROWS: the domain-level slice in `pagePayload.ts`, and the server-side
// filtering, sorting and paging behind `api_getRegisterRows`.
//
// FOUR THINGS THIS FILE PINS THAT HAVE NO OTHER TEST:
//
//   1. THE ALLOWLIST IS AN ALLOWLIST. `registerRowsSlice` must not be able to leak a field
//      that was never meant to travel, however the source row is shaped — `tags_json` (the
//      asset's whole tag bag), `asset_id`, the scan ids, the raw fix/risk capture columns,
//      and `raw_ref`/`obs_ref`, which are scan-tab columns with no business anywhere near a
//      finding row. Asserted over the full `JSON.stringify` and over `Object.keys`, not with
//      `toMatchObject`, which passes on a superset.
//   2. `internet_exposed` IS TRI-STATE, and the perturbation below is the reason it needs a
//      test rather than a comment. `Boolean(exposed.has(k))` is the one-line form everyone
//      reaches for, and it answers `false` to three different questions: not reachable, we
//      could not look, and this row is not in any current frame.
//   3. THE FILTERS EACH BITE ON SOMETHING. A filter that keeps every row is indistinguishable
//      from a filter that is not wired up, so every branch here is measured against a fixture
//      that has rows on both sides of it.
//   4. PAGING AND SORTING ARE SERVER-SIDE AND CLAMPED. An oversized page size, a page index
//      past the end and a negative one all land somewhere sensible instead of erroring or
//      going blank.
//
// The ordering rule's cross-check against its client twin (`gas_shared/ui/tableModel.js`)
// lives in `test/registerRowsOrdering.test.js`, not here: that module is untyped plain JS with
// no declaration file, and importing it from a `.ts` file fails `tsc --noEmit` under `strict`.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEVERITY_ORDER } from "../src/domain/config";
import { LEDGER_COLUMNS } from "../src/domain/reconcile";
import { DEFAULT_RISK_RULE, RISK_TIER_ORDER } from "../src/domain/program";
import type { Rec } from "../src/domain/util";
import {
  DERIVED_ROW_COLUMNS,
  REGISTER_ROW_COLUMNS,
  REGISTER_ROW_DEFAULT_SORT,
  REGISTER_ROW_KEY,
  REGISTER_ROWS_DEFAULT_PAGE_SIZE,
  REGISTER_ROWS_PAGE_SIZE_CAP,
  registerRowsSlice,
} from "../src/domain/pagePayload";

// --------------------------------------------------------------------------------------- //
//  1. REGISTER_ROW_COLUMNS cross-checked against the ledger's own schema
// --------------------------------------------------------------------------------------- //

describe("REGISTER_ROW_COLUMNS — the list only names columns the server can fill", () => {
  it("every non-derived column is a real LEDGER_COLUMNS column", () => {
    for (const col of REGISTER_ROW_COLUMNS) {
      if (DERIVED_ROW_COLUMNS.includes(col)) continue;
      expect(
        (LEDGER_COLUMNS as readonly string[]).includes(col),
        `${col} is neither a LEDGER_COLUMNS column nor a derived one`,
      ).toBe(true);
    }
  });

  it("every derived column is NOT a ledger column — the two sets do not overlap", () => {
    // Otherwise `DERIVED_ROW_COLUMNS` could quietly grow into an escape hatch that exempts a
    // real column from the cross-check above.
    for (const col of DERIVED_ROW_COLUMNS) {
      expect((LEDGER_COLUMNS as readonly string[]).includes(col), col).toBe(false);
    }
  });

  it("names no column that does not exist — `cvss` is absent, not dashed", () => {
    // `cvss` was on the wish list for this table and is not a ledger column: nothing has ever
    // stored it, so shipping it would print an em dash on every row forever — a table saying
    // "we looked and found nothing" about a field nobody measured. This register's spine is
    // exploitability, and `risk_tier` is the column that carries it.
    expect(REGISTER_ROW_COLUMNS).not.toContain("cvss");
    expect(REGISTER_ROW_COLUMNS).toContain("risk_tier");
    expect((LEDGER_COLUMNS as readonly string[]).includes("cvss")).toBe(false);
  });

  it("carries no scan-tab column — raw_ref and obs_ref are not findings columns at all", () => {
    expect(REGISTER_ROW_COLUMNS).not.toContain("raw_ref");
    expect(REGISTER_ROW_COLUMNS).not.toContain("obs_ref");
  });

  it("vuln_key rides outside the drawn list, exactly once, never duplicated into it", () => {
    expect(REGISTER_ROW_KEY).toBe("vuln_key");
    expect(REGISTER_ROW_COLUMNS).not.toContain(REGISTER_ROW_KEY);
    expect(new Set(REGISTER_ROW_COLUMNS).size).toBe(REGISTER_ROW_COLUMNS.length);
  });

  it("the default sort names one of its own columns", () => {
    expect(REGISTER_ROW_COLUMNS).toContain(REGISTER_ROW_DEFAULT_SORT.sort);
    // Descending on an age column is oldest-first, which is the question this page asks.
    expect(REGISTER_ROW_DEFAULT_SORT).toEqual({ sort: "age_days", dir: "desc" });
  });
});

// --------------------------------------------------------------------------------------- //
//  2. registerRowsSlice — the allowlist, measured as an allowlist
// --------------------------------------------------------------------------------------- //

/** A base row carrying EVERY ledger column plus the working fields, as the server sees it. */
function fatRow(): Rec {
  return {
    vuln_key: "k-1", cve: "CVE-2026-0001", severity: "HIGH",
    asset_id: "asset-abc", asset_name: "host-01", asset_type: "VIRTUAL_MACHINE",
    cloud: "AWS", first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-03-01T00:00:00Z",
    status: "OPEN", resolved_at: null, resolution_src: null, reopened_count: 0,
    first_scan_id: "scan-1", last_scan_id: "scan-9",
    subscription_name: "prod", subscription_ext_id: "111122223333",
    tags_json: '{"Wiz/Domain": "Payments", "Owner": "someone@example.com"}',
    fix_date: "2026-02-01T00:00:00Z", fix_observed_at: "2026-02-02T00:00:00Z",
    published_date: "2025-12-01T00:00:00Z",
    has_kev: null, has_exploit: false, epss: 0.42, risk_observed_at: "2026-02-02T00:00:00Z",
    // derived by ledgerCore.baseRows
    mttr_days: null, age_days: 61, fix_available_at: "2026-02-01T00:00:00Z",
    actionable_from: "2026-02-01T00:00:00Z", mttr_actionable_days: null,
    actionable_age_days: 29, awaiting_vendor_fix: false,
    // stamped by the endpoint
    risk_tier: "epss", internet_exposed: true,
    // working fields the slice renames
    _supportGroup: "Platform SRE", _domain: "Payments", _bizDomain: "Payments", _sev: "HIGH",
    // scan-tab columns, present here as an injection attempt against the allowlist itself
    raw_ref: "drive-file-1", obs_ref: "drive-file-2",
  };
}

describe("registerRowsSlice", () => {
  it("copies only the allowlist plus vuln_key — nothing else off the row", () => {
    const [out] = registerRowsSlice([fatRow()]);
    expect(Object.keys(out!).sort())
      .toEqual([REGISTER_ROW_KEY, ...REGISTER_ROW_COLUMNS].sort());
  });

  it("refuses every unread ledger column and both scan-tab columns, over the whole JSON", () => {
    const json = JSON.stringify(registerRowsSlice([fatRow()]));
    for (const forbidden of [
      "asset_id", "tags_json", "first_scan_id", "last_scan_id", "subscription_ext_id",
      "fix_date", "fix_observed_at", "risk_observed_at", "actionable_from",
      "mttr_actionable_days", "raw_ref", "obs_ref", "_supportGroup", "_domain", "_bizDomain",
      "_sev",
    ]) {
      expect(json, `${forbidden} must not travel`).not.toContain(forbidden);
    }
    // And the VALUES behind them, not only the keys — a spread would carry the tag bag's
    // contents even if some future rename hid the key.
    expect(json).not.toContain("asset-abc");
    expect(json).not.toContain("someone@example.com");
    expect(json).not.toContain("drive-file-1");
  });

  it("renames _supportGroup / _domain rather than shipping either spelling twice", () => {
    const [out] = registerRowsSlice([fatRow()]);
    expect(out!["support_group"]).toBe("Platform SRE");
    expect(out!["domain"]).toBe("Payments");
    expect(out).not.toHaveProperty("_supportGroup");
    expect(out).not.toHaveProperty("_domain");
  });

  it("has_kev: null SURVIVES as null, not false — absent is never zero", () => {
    const [out] = registerRowsSlice([{ vuln_key: "k", has_kev: null, has_exploit: null }]);
    expect(out!["has_kev"]).toBeNull();
    expect(out!["has_kev"]).not.toBe(false);
    expect(out!["has_exploit"]).toBeNull();
  });

  it("undefined becomes null — the only coercion this function performs", () => {
    const [out] = registerRowsSlice([{ vuln_key: "k" }]); // every column absent
    for (const col of REGISTER_ROW_COLUMNS) expect(out![col], col).toBeNull();
  });

  it("a missing vuln_key becomes null rather than the string 'undefined'", () => {
    const [out] = registerRowsSlice([{ cve: "CVE-1" }]);
    expect(out![REGISTER_ROW_KEY]).toBeNull();
  });

  it("a non-array input yields no rows", () => {
    expect(registerRowsSlice(null)).toEqual([]);
    expect(registerRowsSlice(undefined)).toEqual([]);
    expect(registerRowsSlice({ vuln_key: "k" })).toEqual([]);
  });

  it("false and 0 survive — the refusal is of `undefined`, not of falsiness", () => {
    const [out] = registerRowsSlice([
      { vuln_key: "k", has_kev: false, epss: 0, reopened_count: 0, awaiting_vendor_fix: false },
    ]);
    expect(out!["has_kev"]).toBe(false);
    expect(out!["epss"]).toBe(0);
    expect(out!["reopened_count"]).toBe(0);
    expect(out!["awaiting_vendor_fix"]).toBe(false);
  });
});

// --------------------------------------------------------------------------------------- //
//  3. api.getRegisterRows — the population, the filters, the sort and the page
// --------------------------------------------------------------------------------------- //

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 86_400_000;

const H = vi.hoisted(() => ({
  base: [] as Rec[],
  frame: null as { scanId: string; ts: string; records: Rec[] } | null,
  latestFlat: null as Rec | null,
  version: 0,
}));

// Sheets/Drive never load: this file is about the read model, and api.ts's import graph
// reaches both. Same treatment as test/accessAdmin.test.ts.
vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: { name: "scans", headers: [] }, vulnLedger: { name: "vuln_ledger", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  cellUsage: () => ({ total: 0, tabs: {} }), ensureTabs: () => {},
}));

// `cached` is a passthrough so every call recomputes: this suite measures the compute, and a
// live CacheService key would make one spec's answer depend on the previous spec's params.
vi.mock("../src/server/serverCache", () => ({
  BUILD_ID: "test",
  cached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  dataVersion: () => "1",
}));
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));

vi.mock("../src/server/ledgerStore", () => ({
  // Fresh objects per call, exactly as the real `baseRows` builds them, so a spec that stamps
  // `risk_tier` on a row cannot leak into the next one.
  loadBaseRows: () => H.base.map((r) => ({ ...r })),
  loadScanRows: () => [],
  latestFlatScanRow: () => H.latestFlat,
}));
vi.mock("../src/server/findings", () => ({
  currentScan: () => H.frame,
  distinct: () => [],
}));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => true,
  getIncludeEol: () => true,
  getDomains: () => ({ items: [] }),
  getRiskRule: () => ({ version: H.version, rule: { ...DEFAULT_RISK_RULE } }),
}));
// The attribution join, faked so the two renamed columns carry something a spec can read.
// `owner_sg` is NOT a ledger column and NOT in the allowlist, which makes it a second probe:
// if the slice ever spread instead of picking, it would ride along.
vi.mock("../src/server/supportGroups", () => ({
  attachSupportGroups: (rows: Rec[]) => {
    for (const r of rows) r["_supportGroup"] = String(r["owner_sg"] ?? "");
  },
}));
vi.mock("../src/server/bizDomains", () => ({
  attachBizDomains: (rows: Rec[]) => {
    for (const r of rows) r["_bizDomain"] = "";
  },
}));
vi.mock("../src/server/errorLog", () => ({ recordError: () => {}, recentErrors: () => [] }));

import { getRegisterRows } from "../src/server/api";

interface Payload extends Rec {
  rows: Rec[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

function ask(p?: Rec): Payload {
  const res = getRegisterRows(p);
  expect(res.error ?? "", "endpoint threw").toBe("");
  expect(res.ok).toBe(true);
  return res.data as Payload;
}

/**
 * The fixture: 200 findings with every branch of every filter represented.
 *
 *   status            every tenth row is RESOLVED (20 of 200)
 *   resolution_src    half of those `disappeared` (a BOUNDED date), half `api` (a measured one)
 *   awaiting fix      every seventh OPEN row has no `fix_available_at`
 *   risk signals      has_kev / has_exploit / epss each cycle through null / true / false, so
 *                     every one of the five risk tiers is populated
 *   exposure          OPEN rows are in the frame; RESOLVED ones are not, by construction
 */
function osRow(i: number): Rec {
  const resolved = i % 10 === 0;
  const firstMs = NOW - (i + 1) * DAY;
  const first = new Date(firstMs).toISOString();
  const resolvedAt = resolved ? new Date(firstMs + 5 * DAY).toISOString() : null;
  const noFixDate = !resolved && i % 7 === 0;
  return {
    vuln_key: `k${String(i).padStart(4, "0")}`,
    cve: `CVE-2026-${String(i).padStart(4, "0")}`,
    severity: SEVERITY_ORDER[i % 5]!,
    asset_id: `asset-${i}`,
    asset_name: `host-${String(i % 20).padStart(2, "0")}`,
    asset_type: "VIRTUAL_MACHINE",
    cloud: i % 2 === 0 ? "AWS" : "Azure",
    first_seen: first,
    last_seen: resolved ? resolvedAt : new Date(NOW).toISOString(),
    status: resolved ? "RESOLVED" : "OPEN",
    resolved_at: resolvedAt,
    resolution_src: resolved ? (i % 20 === 0 ? "disappeared" : "api") : null,
    reopened_count: i % 50 === 0 ? 1 : 0,
    first_scan_id: "scan-1",
    last_scan_id: "scan-9",
    subscription_name: `sub-${i % 3}`,
    subscription_ext_id: `${100000000000 + i}`,
    tags_json: null,
    fix_date: noFixDate ? null : first,
    fix_observed_at: null,
    published_date: i % 4 === 0 ? null : new Date(firstMs - 30 * DAY).toISOString(),
    has_kev: i % 4 === 0 ? null : i % 4 === 1,
    has_exploit: i % 5 === 0 ? true : i % 5 === 1 ? false : null,
    epss: i % 3 === 0 ? null : (i % 100) / 100,
    risk_observed_at: null,
    // ledgerCore.baseRows derivations, precomputed here the way it would compute them
    mttr_days: resolved ? 5 : null,
    age_days: resolved ? null : (NOW - firstMs) / DAY,
    fix_available_at: noFixDate ? null : first,
    actionable_from: noFixDate ? null : first,
    mttr_actionable_days: resolved ? 5 : null,
    actionable_age_days: resolved || noFixDate ? null : (NOW - firstMs) / DAY,
    awaiting_vendor_fix: !resolved && noFixDate,
    // not a ledger column; the support-group fake reads it and the slice must refuse it
    owner_sg: `SG-${i % 4}`,
  };
}

/** The current-scan frame: the OPEN rows only, which is what a frame holds. */
function frameFor(rows: Rec[], opts: { exposureKeys: boolean }): Rec[] {
  return rows
    .filter((r) => r["status"] === "OPEN")
    .map((r, n) => {
      const rec: Rec = {
        _vuln_key: r["vuln_key"],
        _sev: r["severity"],
        _domain: "",
        _supportGroup: "",
        severity: r["severity"],
        status: "OPEN",
        hasCisaKevExploit: r["has_kev"] === true,
        hasExploit: r["has_exploit"] === true,
      };
      if (opts.exposureKeys) {
        // A third of the frame is internet-reachable; the rest carries the key as an
        // observed `false`, which is what makes `internet_exposed: false` a measurement.
        rec["vulnerableAsset.hasWideInternetExposure"] = n % 3 === 0;
        rec["vulnerableAsset.hasLimitedInternetExposure"] = false;
      }
      return rec;
    });
}

/**
 * THE FIXTURE IS DELIBERATELY OUT OF KEY ORDER, and that is what gives the tiebreak spec
 * something to bite on.
 *
 * `loadBaseRows` returns rows in whatever order the ledger's object map yielded them, which is
 * not the key order — and `Array.prototype.sort` is STABLE, so a fixture built in key order
 * would come back in key order even with no tiebreak at all. The tiebreak assertion would then
 * be decorative: it would pass against an implementation that had none (CLAUDE.md, "A guard
 * that fires on nothing is a finding, not a pass"). A deterministic scramble — every seventh
 * row, wrapping — makes the two arrangements differ.
 */
function scrambled<T>(rows: T[]): T[] {
  const out: T[] = [];
  const n = rows.length;
  for (let i = 0; i < n; i += 1) out.push(rows[(i * 7) % n]!);
  return out;
}

function seed(opts: { exposureKeys: boolean } = { exposureKeys: true }): void {
  H.base = scrambled(Array.from({ length: 200 }, (_, i) => osRow(i)));
  H.frame = {
    scanId: "scan-9",
    ts: new Date(NOW).toISOString(),
    records: frameFor(H.base, opts),
  };
  H.latestFlat = { scan_id: "scan-9", severities: null };
}

beforeEach(() => {
  H.version = 1;
  seed();
});

describe("getRegisterRows — the payload's own shape", () => {
  it("ships the column list, the key, and rows carrying exactly those fields", () => {
    const d = ask({ pageSize: 5 });
    expect(d["columns"]).toEqual([...REGISTER_ROW_COLUMNS]);
    expect(d["key"]).toBe(REGISTER_ROW_KEY);
    expect(Object.keys(d.rows[0]!).sort())
      .toEqual([REGISTER_ROW_KEY, ...REGISTER_ROW_COLUMNS].sort());
  });

  it("never lets a base row's unread columns onto the wire", () => {
    const json = JSON.stringify(ask({ pageSize: 250, status: "all" }).rows);
    for (const forbidden of ["asset_id", "owner_sg", "subscription_ext_id", "first_scan_id",
      "fix_date", "fix_observed_at", "risk_observed_at", "_supportGroup", "_domain"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it("publishes the population line the Overview publishes — in-scope, gate, base filters", () => {
    const d = ask({ pageSize: 5 });
    const pop = d["population"] as Rec;
    // inScope is the register BEFORE the reader's own filters; `total` is after them.
    expect(pop["inScope"]).toBe(200);
    expect(d.total).toBe(180); // status defaults to open
    expect(pop["gate"]).toBeNull(); // scans.severities null = the full gate, not an empty one
    expect(Array.isArray(pop["filters"])).toBe(true);
  });

  it("stamps asOf inside the compute, so a cached page cannot claim a fresher measurement", () => {
    const d = ask({ pageSize: 1 });
    expect(typeof d["asOf"]).toBe("string");
    expect(Number.isFinite(Date.parse(String(d["asOf"])))).toBe(true);
  });

  it("carries resolution_src, so a bounded death date can be told from a measured one", () => {
    // "Gone by 12 Aug" and "Resolved 12 Aug" are the same pixel width; the provenance has to
    // ride in the row (CLAUDE.md, "A DEATH DATE IS NOT ALWAYS A MEASUREMENT").
    const d = ask({ status: "resolved", pageSize: 250 });
    const srcs = new Set(d.rows.map((r) => String(r["resolution_src"])));
    expect(srcs).toEqual(new Set(["disappeared", "api"]));
  });
});

// --------------------------------------------------------------------------------------- //
//  3b. internet_exposed — the tri-state, and the rewrite that flattens it
// --------------------------------------------------------------------------------------- //

describe("getRegisterRows — internet_exposed is tri-state", () => {
  it("true / false / null all occur, and each means a different thing", () => {
    const rows = ask({ status: "all", pageSize: 250 }).rows;
    const seen = new Set(rows.map((r) => r["internet_exposed"]));
    expect(seen).toEqual(new Set([true, false, null]));
    // null is exactly the rows that are not in the current frame — every RESOLVED one.
    for (const r of rows) {
      if (r["status"] === "RESOLVED") expect(r["internet_exposed"], String(r["vuln_key"])).toBeNull();
      else expect(typeof r["internet_exposed"], String(r["vuln_key"])).toBe("boolean");
    }
  });

  it("is null for EVERY row when the frame never carried the exposure keys", () => {
    seed({ exposureKeys: false });
    const d = ask({ status: "all", pageSize: 250 });
    expect(d["exposureKnown"]).toBe(false);
    expect(d["exposureFilterSupported"]).toBe(false);
    for (const r of d.rows) expect(r["internet_exposed"], String(r["vuln_key"])).toBeNull();
  });

  /**
   * THE PERTURBATION, RUN INLINE RATHER THAN DESCRIBED.
   *
   * `Boolean(exposedKeys.has(k))` is the obvious simplification of the three-branch form in
   * `registerRowsData`. It reads the same on the page and is wrong in a way no aggregate
   * shows: it answers `false` to "not reachable", to "the scan never evaluated exposure", and
   * to "this row left the frame months ago". A reader filtering an exposure column would then
   * see every remediated finding and every unmeasured one classified as safe.
   *
   * Reproduced here over the same inputs the endpoint used, so the claim is measured rather
   * than asserted from a comment (CLAUDE.md, gas_shared `relativeAge`).
   *
   * Run against the real source too — see the perturbation record at the foot of this file,
   * where this is perturbation 1 and the captured output is quoted verbatim.
   */
  it("PERTURBATION: Boolean(exposed.has(k)) prints false for all three questions", () => {
    seed({ exposureKeys: false });
    const known = ask({ status: "all", pageSize: 250 }).rows;
    // The defective form, applied to the very rows the endpoint just answered `null` for.
    const exposedKeys = new Set<string>(); // what exposedVulnKeys returns when it could not look
    const flattened = known.map((r) => Boolean(exposedKeys.has(String(r[REGISTER_ROW_KEY]))));
    expect(flattened.every((v) => v === false)).toBe(true);
    // ...while the shipped implementation says `null` for every one of them. If these two ever
    // agreed, the tri-state would have been flattened.
    expect(known.every((r) => r["internet_exposed"] === null)).toBe(true);
    expect(flattened[0]).not.toBe(known[0]!["internet_exposed"]);
  });
});

// --------------------------------------------------------------------------------------- //
//  3c. the four row-level filters
// --------------------------------------------------------------------------------------- //

describe("getRegisterRows — the status filter", () => {
  it("defaults to OPEN, and open + resolved add up to all", () => {
    const def = ask({ pageSize: 250 });
    expect(def["status"]).toBe("open");
    const all = ask({ status: "all", pageSize: 250 });
    const open = ask({ status: "open", pageSize: 250 });
    const resolved = ask({ status: "resolved", pageSize: 250 });
    expect(all.total).toBe(200);
    expect(open.total).toBe(180);
    expect(resolved.total).toBe(20);
    expect(open.total + resolved.total).toBe(all.total);
    expect(def.total).toBe(open.total);
    for (const r of resolved.rows) expect(r["status"]).toBe("RESOLVED");
    for (const r of open.rows) expect(r["status"]).toBe("OPEN");
  });

  it("an unrecognised status falls back to the DEFAULT, not to an empty register", () => {
    const bogus = ask({ status: "OPENISH", pageSize: 250 });
    expect(bogus["status"]).toBe("open");
    expect(bogus.total).toBe(180);
  });
});

describe("getRegisterRows — the vendor-fix filter", () => {
  it("`awaiting` keeps exactly the open rows with no fix available", () => {
    const awaiting = ask({ fix: "awaiting", status: "all", pageSize: 250 });
    expect(awaiting.total).toBeGreaterThan(0);
    expect(awaiting.total).toBeLessThan(200);
    for (const r of awaiting.rows) {
      expect(r["awaiting_vendor_fix"]).toBe(true);
      expect(r["fix_available_at"]).toBeNull();
      expect(r["status"]).toBe("OPEN");
    }
  });

  it("`fixable` keeps exactly the rows where a fix WAS observed", () => {
    const fixable = ask({ fix: "fixable", status: "all", pageSize: 250 });
    expect(fixable.total).toBeGreaterThan(0);
    for (const r of fixable.rows) expect(r["fix_available_at"]).not.toBeNull();
  });

  it("the two PARTITION the open register, and deliberately do not partition the closed one", () => {
    // Under the default `status: open` every row is one or the other. Across RESOLVED rows a
    // lifecycle can close without this register ever having seen a fix date, and calling such
    // a row "fixable" would be a claim nobody measured.
    const open = ask({ status: "open", pageSize: 250 });
    const openAwaiting = ask({ status: "open", fix: "awaiting", pageSize: 250 });
    const openFixable = ask({ status: "open", fix: "fixable", pageSize: 250 });
    expect(openAwaiting.total + openFixable.total).toBe(open.total);

    const all = ask({ status: "all", pageSize: 250 });
    const allAwaiting = ask({ status: "all", fix: "awaiting", pageSize: 250 });
    const allFixable = ask({ status: "all", fix: "fixable", pageSize: 250 });
    expect(allAwaiting.total + allFixable.total).toBe(all.total); // this fixture happens to
    // carry a fix date on every resolved row; the assertion above is the one that matters.
  });

  it("an unrecognised fix mode falls back to `all`", () => {
    const bogus = ask({ fix: "sometimes", status: "all", pageSize: 250 });
    expect(bogus["fix"]).toBe("all");
    expect(bogus.total).toBe(200);
  });
});

describe("getRegisterRows — the risk-tier filter", () => {
  it("every tier in RISK_TIER_ORDER is populated by the fixture, and each one narrows", () => {
    const all = ask({ status: "all", pageSize: 250 });
    const counts = new Map<string, number>();
    for (const r of all.rows) {
      const t = String(r["risk_tier"]);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    let summed = 0;
    for (const tier of RISK_TIER_ORDER) {
      const only = ask({ status: "all", tier: [tier], pageSize: 250 });
      expect(only.total, tier).toBe(counts.get(tier) ?? 0);
      for (const r of only.rows) expect(r["risk_tier"]).toBe(tier);
      summed += only.total;
    }
    // The tiers PARTITION the register — the identity program.ts pins between riskTier and
    // classifyRisk, seen from the filter's side.
    expect(summed).toBe(all.total);
  });

  it("takes several tiers at once, as an array or a comma string, and echoes tier order", () => {
    const two = ask({ status: "all", tier: ["epss", "kev"], pageSize: 250 });
    expect(two["tier"]).toEqual(["kev", "epss"]); // RISK_TIER_ORDER order, not asked order
    const asString = ask({ status: "all", tier: "kev,epss", pageSize: 250 });
    expect(asString.total).toBe(two.total);
    const kev = ask({ status: "all", tier: ["kev"], pageSize: 250 });
    const epss = ask({ status: "all", tier: ["epss"], pageSize: 250 });
    expect(two.total).toBe(kev.total + epss.total);
  });

  it("an unknown tier name is DROPPED, and a list that drops to empty is no filter", () => {
    const all = ask({ status: "all", pageSize: 250 });
    const bogus = ask({ status: "all", tier: ["catastrophic"], pageSize: 250 });
    expect(bogus["tier"]).toBeNull();
    expect(bogus.total).toBe(all.total);
    // A mixed list keeps the half it recognises rather than refusing the request.
    const mixed = ask({ status: "all", tier: ["catastrophic", "kev"], pageSize: 250 });
    expect(mixed["tier"]).toEqual(["kev"]);
    expect(mixed.total).toBe(ask({ status: "all", tier: ["kev"], pageSize: 250 }).total);
  });
});

describe("getRegisterRows — the exposure filter", () => {
  it("keeps only the internet-reachable rows when the frame looked", () => {
    const all = ask({ pageSize: 250 });
    const exposed = ask({ exposed: true, pageSize: 250 });
    expect(all["exposureKnown"]).toBe(true);
    expect(exposed["exposureFilterSupported"]).toBe(true);
    expect(exposed["exposed"]).toBe(true);
    expect(exposed.total).toBeGreaterThan(0);
    expect(exposed.total).toBeLessThan(all.total);
    for (const r of exposed.rows) expect(r["internet_exposed"]).toBe(true);
  });

  it("is IGNORED and says so when the frame never carried the keys — never a measured zero", () => {
    // Applying it against an empty key set would answer "0 internet-facing findings", which is
    // a measurement; the truth is that nothing looked (CLAUDE.md, "The Outside").
    seed({ exposureKeys: false });
    const plain = ask({ pageSize: 250 });
    const asked = ask({ exposed: true, pageSize: 250 });
    expect(asked["exposureFilterSupported"]).toBe(false);
    expect(asked["exposureKnown"]).toBe(false);
    expect(asked["exposed"]).toBe(false); // echoed as NOT applied
    expect(asked.total).toBe(plain.total);
    expect(asked.total).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------------------- //
//  3d. paging and sorting
// --------------------------------------------------------------------------------------- //

describe("getRegisterRows — paging", () => {
  it("pages without repeating or dropping a row", () => {
    const p0 = ask({ status: "all", pageSize: 50, page: 0 });
    const p1 = ask({ status: "all", pageSize: 50, page: 1 });
    expect(p0.total).toBe(200);
    expect(p0.pageCount).toBe(4);
    expect(p0.rows.length).toBe(50);
    const keys0 = new Set(p0.rows.map((r) => r[REGISTER_ROW_KEY]));
    for (const r of p1.rows) expect(keys0.has(r[REGISTER_ROW_KEY])).toBe(false);
    expect(p1.page).toBe(1);
  });

  it("defaults to REGISTER_ROWS_DEFAULT_PAGE_SIZE", () => {
    expect(ask({ status: "all" }).pageSize).toBe(REGISTER_ROWS_DEFAULT_PAGE_SIZE);
    // ...and a blank / absent value is not read as the clamp's floor of 1 (Number(null) is 0).
    expect(ask({ status: "all", pageSize: null }).pageSize).toBe(REGISTER_ROWS_DEFAULT_PAGE_SIZE);
    expect(ask({ status: "all", pageSize: "" }).pageSize).toBe(REGISTER_ROWS_DEFAULT_PAGE_SIZE);
    expect(ask({ status: "all", pageSize: "abc" }).pageSize)
      .toBe(REGISTER_ROWS_DEFAULT_PAGE_SIZE);
  });

  it("a pageSize above the cap is CLAMPED, not honoured", () => {
    const d = ask({ status: "all", pageSize: 100_000 });
    expect(d.pageSize).toBe(REGISTER_ROWS_PAGE_SIZE_CAP);
    // The fixture is 200 rows, so the cap is what bounds the PAGE SIZE rather than the page:
    // one page holds all 200, and the ask for 100,000 did not travel.
    expect(d.rows.length).toBe(Math.min(REGISTER_ROWS_PAGE_SIZE_CAP, d.total));
    expect(d.pageCount).toBe(1);
  });

  it("a page index past the end clamps to the last page rather than going blank", () => {
    const d = ask({ status: "all", pageSize: 50, page: 9999 });
    expect(d.page).toBe(3);
    expect(d.rows.length).toBe(50);
  });

  it("a negative page index clamps to zero", () => {
    const d = ask({ status: "all", pageSize: 50, page: -4 });
    expect(d.page).toBe(0);
    expect(d.rows.map((r) => r[REGISTER_ROW_KEY]))
      .toEqual(ask({ status: "all", pageSize: 50, page: 0 }).rows.map((r) => r[REGISTER_ROW_KEY]));
  });

  it("an empty result is one page of nothing, not a division by zero", () => {
    const d = ask({ status: "all", tier: ["kev"], fix: "awaiting", exposed: true, pageSize: 50 });
    expect(d.pageCount).toBeGreaterThanOrEqual(1);
    expect(d.page).toBe(0);
  });
});

describe("getRegisterRows — sorting", () => {
  it("opens on age_days descending — oldest open first", () => {
    const d = ask({ pageSize: 250 });
    expect(d["sort"]).toBe("age_days");
    expect(d["dir"]).toBe("desc");
    const ages = d.rows.map((r) => r["age_days"]).filter((v): v is number => typeof v === "number");
    for (let i = 1; i < ages.length; i += 1) expect(ages[i]!).toBeLessThanOrEqual(ages[i - 1]!);
  });

  it("sorts a DATE column as instants, nulls last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const d = ask({ status: "all", sort: "published_date", dir, pageSize: 250 });
      const ts = d.rows.map((r) => r["published_date"]);
      const firstNull = ts.findIndex((v) => v === null);
      expect(firstNull).toBeGreaterThan(0);
      // Every null is a SUFFIX of the arrangement, whichever direction was asked for.
      expect(ts.slice(firstNull).every((v) => v === null), dir).toBe(true);
      const present = ts.slice(0, firstNull).map((v) => Date.parse(String(v)));
      for (let i = 1; i < present.length; i += 1) {
        if (dir === "asc") expect(present[i]!).toBeGreaterThanOrEqual(present[i - 1]!);
        else expect(present[i]!).toBeLessThanOrEqual(present[i - 1]!);
      }
    }
  });

  it("sorts a NUMBER column numerically, nulls last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const d = ask({ status: "all", sort: "epss", dir, pageSize: 250 });
      const vals = d.rows.map((r) => r["epss"]);
      const firstNull = vals.findIndex((v) => v === null);
      expect(firstNull).toBeGreaterThan(0);
      expect(vals.slice(firstNull).every((v) => v === null), dir).toBe(true);
      const nums = vals.slice(0, firstNull) as number[];
      for (let i = 1; i < nums.length; i += 1) {
        if (dir === "asc") expect(nums[i]!).toBeGreaterThanOrEqual(nums[i - 1]!);
        else expect(nums[i]!).toBeLessThanOrEqual(nums[i - 1]!);
      }
    }
  });

  it("sorts SEVERITY by meaning — ascending is worst-first", () => {
    const d = ask({ status: "all", sort: "severity", dir: "asc", pageSize: 250 });
    const ranks = d.rows.map((r) => SEVERITY_ORDER.indexOf(String(r["severity"]) as never));
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
    expect(String(d.rows[0]!["severity"])).toBe("CRITICAL");
  });

  it("sorts RISK_TIER by evidence order — ascending opens on kev, not on epss", () => {
    const d = ask({ status: "all", sort: "risk_tier", dir: "asc", pageSize: 250 });
    const ranks = d.rows.map((r) => RISK_TIER_ORDER.indexOf(String(r["risk_tier"]) as never));
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
  });

  it("an unknown sort column falls back to the default rather than pretending", () => {
    // Ordering by a column that does not exist would leave the rows in loadBaseRows order
    // while the payload claimed to be sorted.
    const d = ask({ status: "all", sort: "validation_state", pageSize: 250 });
    expect(d["sort"]).toBe(REGISTER_ROW_DEFAULT_SORT.sort);
    expect(d["dir"]).toBe(REGISTER_ROW_DEFAULT_SORT.dir);
  });

  it("a non-default sort defaults to ascending, and an explicit dir wins", () => {
    expect(ask({ status: "all", sort: "cve" })["dir"]).toBe("asc");
    expect(ask({ status: "all", sort: "cve", dir: "desc" })["dir"]).toBe("desc");
    expect(ask({ status: "all", sort: "age_days", dir: "asc" })["dir"]).toBe("asc");
  });

  it("THE TIEBREAK MAKES THE ARRANGEMENT TOTAL: two identical requests return one order", () => {
    // `status` is one of three values across 200 rows, so without a constant second key the
    // page cut would depend on whatever order loadBaseRows returned.
    const a = ask({ status: "all", sort: "status", page: 2, pageSize: 50 });
    const b = ask({ status: "all", sort: "status", page: 2, pageSize: 50 });
    expect(a.rows.map((r) => r[REGISTER_ROW_KEY])).toEqual(b.rows.map((r) => r[REGISTER_ROW_KEY]));
    // And it is not merely stable-by-luck: the keys within the page are in key order.
    const keys = a.rows.map((r) => String(r[REGISTER_ROW_KEY]));
    expect([...keys].sort()).toEqual(keys);
  });
});

// --------------------------------------------------------------------------------------- //
//  4. THE PERTURBATION RECORD — each guard broken on purpose, run, and reverted
// --------------------------------------------------------------------------------------- //
//
// A guard that fires on nothing is decorative. All four below were applied to the real source
// on 2026-09-07, run with `npx vitest run test/registerRows.test.ts`, and reverted. Output is
// quoted as vitest printed it.
//
//  1. THE TRI-STATE FLATTENED.  `registerRowsData`:
//       r["internet_exposed"] = Boolean(exposedKeys.has(key));
//     3 failed of 47:
//       × true / false / null all occur, and each means a different thing
//           AssertionError: expected Set{ false, true } to deeply equal Set{ true, false, null }
//       × is null for EVERY row when the frame never carried the exposure keys
//           AssertionError: k0199: expected false to be null
//       × PERTURBATION: Boolean(exposed.has(k)) prints false for all three questions
//           AssertionError: expected false to be true
//
//  2. THE EXPOSURE REFUSAL DROPPED.  `registerRowsData`:
//       const exposedApplied = filters.exposed;          // was `&& exposureKnown`
//     1 failed of 47:
//       × is IGNORED and says so when the frame never carried the keys — never a measured zero
//           AssertionError: expected true to be false
//     i.e. the filter ran against an empty key set and answered a measured zero.
//
//  3. THE PAGE SIZE CAST FIRST.  `registerRowsPageSize`: the `if (!present(v))` line removed,
//     leaving `Number(v)` to speak for an absent value.
//     1 failed of 47:
//       × defaults to REGISTER_ROWS_DEFAULT_PAGE_SIZE
//           AssertionError: expected 1 to be 50
//     `Number(null)` is 0, `Number.isFinite(0)` is true, and the clamp's floor turned an
//     absent page size into ONE ROW PER PAGE. The third time this cast has bitten here.
//
//  4. THE TIEBREAK REMOVED.  `getRegisterRows`: the `tiebreak: (r) => r[REGISTER_ROW_KEY]`
//     line deleted from the sort spec.
//     1 failed of 47:
//       × THE TIEBREAK MAKES THE ARRANGEMENT TOTAL: two identical requests return one order
//           AssertionError: expected [ 'k0001', 'k0005', 'k0008', …(47) ]
//                           to deeply equal [ 'k0184', 'k0191', 'k0198', …(47) ]
//     Note this only bites because `seed()` scrambles the fixture's order — see `scrambled`.
//     Built in key order, a stable sort would have returned key order anyway and the spec
//     would have passed against an implementation with no tiebreak at all.
