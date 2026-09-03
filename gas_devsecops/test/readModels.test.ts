// The eight read-models, the caching audit that decides where each one is allowed to live, and
// the warm pass.
//
// Everything below runs over a hand-built eight-row ledger with no Sheets and no Drive:
// `ledgerStore`, `historyStore`, `jobsStore`, `sheetsDb`, `serverCache` and `readModelStore`
// are all mocked, so what is under test is the COMPOSITION — which domain function each model
// calls, over which population, with which clock — rather than the domain layer, which has its
// own suites.
//
// Three of the specs here are about failures that produce no symptom at all:
//
//   - the caching audit. A clock-reading model in the durable layer answers "measured now" and
//     means "measured whenever the file was written". Nothing on screen says so.
//   - the warm's job guard. A warm running against a PERSISTING job reads a ledger mid-
//     `overwrite` and caches the torn read under the pre-bump version.
//   - the single derivation. Ten models each calling `loadBaseRows()` is ten full base-row
//     builds per warm, and the only evidence is a slower execution.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseRow, ScanRow } from "../src/domain/ledgerTypes";
import type { Scope } from "../src/domain/config";

// --------------------------------------------------------------------------------------- //
//  Harness
// --------------------------------------------------------------------------------------- //

const H = vi.hoisted(() => ({
  /** Every (name, layer, params, ttl) that reached a cache layer, in order. */
  cacheCalls: [] as { name: string; layer: "cached" | "durablyCached"; params: unknown; ttl?: number }[],
  store: new Map<string, unknown>(),
  version: "v1",
  warmDepth: 0,
  swept: 0,
  loadBaseRowsCalls: 0,
  loadBaseRowsOpts: [] as unknown[],
  trendCalls: [] as any[],
  programTrendCalls: [] as any[],
  activeJobRow: null as unknown,
  rows: [] as BaseRow[],
  scans: [] as ScanRow[],
  cellCountCalls: 0,
  cellCountThrows: false,
  /** `warmDepth` observed at the moment each compute actually ran. */
  computeDepths: [] as number[],
}));

function memo(name: string, params: unknown, compute: () => unknown): unknown {
  const k = `${name}|${JSON.stringify(params ?? null)}|${H.version}`;
  if (H.store.has(k)) return H.store.get(k);
  H.computeDepths.push(H.warmDepth);
  const v = compute();
  H.store.set(k, v);
  return v;
}

vi.mock("../src/server/serverCache", () => ({
  cached: (name: string, params: unknown, compute: () => unknown, ttl?: number) => {
    H.cacheCalls.push({ name, layer: "cached", params, ...(ttl === undefined ? {} : { ttl }) });
    return memo(name, params, compute);
  },
  dataVersion: () => H.version,
}));

vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (name: string, params: unknown, compute: () => unknown, ttl?: number) => {
    H.cacheCalls.push({
      name, layer: "durablyCached", params, ...(ttl === undefined ? {} : { ttl }),
    });
    return memo(name, params, compute);
  },
  duringWarm: <T,>(fn: () => T): T => {
    H.warmDepth += 1;
    try {
      return fn();
    } finally {
      H.warmDepth -= 1;
    }
  },
  sweepReadModels: () => {
    H.swept += 1;
    return 3;
  },
}));

vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: (opts?: unknown) => {
    H.loadBaseRowsCalls += 1;
    H.loadBaseRowsOpts.push(opts);
    return H.rows.map((r) => ({ ...r }));
  },
  loadScanRows: () => H.scans.slice(),
  loadTrend: (o: unknown) => {
    H.trendCalls.push(o);
    return [{ date: "2026-03-01", reconstructed: false, open: 5, resolved: 3, km_median_days: 10 }];
  },
  loadProgramTrend: (rule: unknown, o: unknown) => {
    H.programTrendCalls.push({ rule, o });
    return [{ date: "2026-03-01", reconstructed: false, coverage_pct: 50, efficiency_pct: 40 }];
  },
  latestScanRow: (scope: Scope) => H.scans.filter((s) => s.scope === scope).slice(-1)[0] ?? null,
  previousSeverityCounts: () => ({ CRITICAL: 1, HIGH: 2 }),
}));

vi.mock("../src/server/historyStore", () => ({
  listHistory: () => [{ date: "2026-03-01", stats: { open: 5 } }],
}));

vi.mock("../src/server/jobsStore", () => ({
  activeJob: () => H.activeJobRow,
}));

vi.mock("../src/server/sheetsDb", async (orig) => {
  const actual = await orig<typeof import("../src/server/sheetsDb")>();
  return {
    ...actual,
    cellCount: () => {
      H.cellCountCalls += 1;
      if (H.cellCountThrows) throw new Error("spreadsheet unavailable");
      return 400_000;
    },
    gridSize: () => ({ rows: 1000, cols: 39 }),
  };
});

import {
  __resetModelMemosForTest,
  executiveModel,
  historyModel,
  mttrModel,
  programModel,
  registerModel,
  reposModel,
  secretsModel,
  signalCoverage,
  storageModel,
  warmReadModels,
} from "../src/server/readModels";

// --------------------------------------------------------------------------------------- //
//  A ledger, by hand
// --------------------------------------------------------------------------------------- //

const NOW = Date.parse("2026-03-11T00:00:00Z");
const DAY = 86_400_000;
const days = (iso: string) => (NOW - Date.parse(iso)) / DAY;

function row(over: Partial<BaseRow> & { finding_key: string; scope: Scope }): BaseRow {
  const first = over.first_seen ?? "2026-01-01T00:00:00Z";
  const resolved = over.resolved_at ?? null;
  const base: BaseRow = {
    finding_key: over.finding_key,
    scope: over.scope,
    identifier: null,
    component: null,
    severity: "HIGH",
    repo_id: "r1",
    repo_name: "repo-one",
    branch: "main",
    platform: "github",
    first_seen: first,
    last_seen: "2026-03-01T00:00:00Z",
    status: resolved ? "RESOLVED" : "OPEN",
    resolved_at: resolved,
    resolution_src: resolved ? "disappeared" : null,
    reopened_count: 0,
    first_scan_id: "sync-1",
    last_scan_id: "sync-2",
    fix_date: null,
    fix_observed_at: null,
    fixed_version: null,
    has_kev: null,
    has_exploit: null,
    epss: null,
    risk_observed_at: null,
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
    owner_project: "proj-a",
    owner_path: "org/proj-a",
    tags_json: null,
    mttr_days: resolved ? (Date.parse(resolved) - Date.parse(first)) / DAY : null,
    age_days: resolved ? null : days(first),
    fix_available_at: null,
    actionable_from: null,
    mttr_actionable_days: null,
    actionable_age_days: null,
    awaiting_vendor_fix: false,
  };
  return { ...base, ...over };
}

/** sca/sast/secrets rows whose actionable clock coincides with detection — every scope but the
 *  one that has a vendor to wait on. Mirrors what `ledgerCore.baseRows` writes. */
function coincident(r: BaseRow): BaseRow {
  return {
    ...r,
    fix_available_at: r.first_seen,
    actionable_from: r.first_seen,
    mttr_actionable_days: r.mttr_days,
    actionable_age_days: r.age_days,
    awaiting_vendor_fix: false,
  };
}

function seed(): void {
  H.rows = [
    // --- sca -------------------------------------------------------------------------- //
    coincident(row({
      finding_key: "sca:CVE-1", scope: "sca", severity: "CRITICAL", identifier: "CVE-1",
      first_seen: "2026-01-01T00:00:00Z", resolved_at: "2026-01-08T00:00:00Z",
      has_kev: true, has_exploit: true, epss: 0.5, language: "python",
      repo_id: "r1", repo_name: "repo-one",
    })),
    coincident(row({
      finding_key: "sca:CVE-2", scope: "sca", severity: "CRITICAL", identifier: "CVE-2",
      first_seen: "2026-01-01T00:00:00Z",
      has_kev: false, has_exploit: false, epss: 0.01, language: "python",
      repo_id: "r1", repo_name: "repo-one",
    })),
    // The one row with a vendor to wait on: no fix available, so no actionable clock at all.
    row({
      finding_key: "sca:CVE-3", scope: "sca", severity: "HIGH", identifier: "CVE-3",
      first_seen: "2026-02-01T00:00:00Z", language: "python",
      repo_id: "r2", repo_name: "repo-two",
      awaiting_vendor_fix: true,
    }),

    // --- sast ------------------------------------------------------------------------- //
    coincident(row({
      finding_key: "sast:CWE-79@a.js:12", scope: "sast", severity: "HIGH", identifier: "CWE-79",
      cwe: "CWE-79", first_seen: "2026-01-15T00:00:00Z", language: "javascript",
      repo_id: "r2", repo_name: "repo-two", file_path: "a.js", start_line: 12,
    })),
    coincident(row({
      finding_key: "sast:CWE-1004@b.js:3", scope: "sast", severity: "MEDIUM",
      identifier: "CWE-1004", cwe: "CWE-1004", language: "javascript",
      first_seen: "2026-02-10T00:00:00Z", resolved_at: "2026-02-20T00:00:00Z",
      repo_id: "r2", repo_name: "repo-two",
    })),

    // --- secrets ---------------------------------------------------------------------- //
    coincident(row({
      finding_key: "secrets:k1", scope: "secrets", severity: "LOW", identifier: "k1",
      first_seen: "2026-01-05T00:00:00Z", secret_kind: "SAAS_API_KEY",
      validation_state: "VALID", validated_at: "2026-02-01T00:00:00Z", confidence: "HIGH",
      repo_id: "r1", repo_name: "repo-one",
    })),
    coincident(row({
      finding_key: "secrets:k2", scope: "secrets", severity: "INFO", identifier: "k2",
      first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-05T00:00:00Z",
      secret_kind: "CERTIFICATE", validation_state: "INVALID",
      validated_at: "2026-02-05T00:00:00Z", rotated_at: "2026-02-05T00:00:00Z",
      removed_at: "2026-02-05T00:00:00Z", confidence: "MEDIUM",
      repo_id: "r3", repo_name: "repo-three",
    })),
    // Removed is not rotated: the string left HEAD, nobody confirmed the credential is dead.
    coincident(row({
      finding_key: "secrets:k3", scope: "secrets", severity: "HIGH", identifier: "k3",
      first_seen: "2026-02-01T00:00:00Z", secret_kind: "PASSWORD",
      removed_at: "2026-02-20T00:00:00Z", confidence: "LOW",
      repo_id: "r3", repo_name: "repo-three",
    })),
  ];

  const scan = (scan_id: string, ts: string, scope: Scope, total: number): ScanRow => ({
    scan_id, ts, scope, mode: "full", severities: null, total,
    new_count: total, resolved_count: 0, reopened_count: 0,
    raw_ref: null, obs_ref: null, sealed: 0,
  });
  H.scans = [
    scan("sync-1", "2026-01-01T00:00:00Z", "sca", 2),
    scan("sync-2", "2026-03-01T00:00:00Z", "sca", 3),
    scan("sync-2", "2026-03-01T00:00:00Z", "sast", 2),
    scan("sync-2", "2026-03-01T00:00:00Z", "secrets", 3),
  ];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  H.cacheCalls.length = 0;
  H.store.clear();
  H.version = "v1";
  H.warmDepth = 0;
  H.swept = 0;
  H.loadBaseRowsCalls = 0;
  H.loadBaseRowsOpts.length = 0;
  H.trendCalls.length = 0;
  H.programTrendCalls.length = 0;
  H.activeJobRow = null;
  H.cellCountCalls = 0;
  H.cellCountThrows = false;
  H.computeDepths.length = 0;
  seed();
  __resetModelMemosForTest();
  vi.stubGlobal("console", { ...console, warn: () => {}, log: () => {} });
});

const ALL = { scope: null, severities: null, showNoFix: true } as const;

function buildEverything(): void {
  executiveModel(ALL);
  mttrModel(ALL);
  programModel(ALL);
  registerModel("sca", ALL);
  registerModel("sast", ALL);
  registerModel("secrets", ALL);
  secretsModel(ALL);
  reposModel(ALL);
  historyModel(ALL);
  storageModel();
}

// --------------------------------------------------------------------------------------- //
//  The caching audit
// --------------------------------------------------------------------------------------- //

describe("the caching audit is per model, and the header states it", () => {
  it("routes every model to the layer its clock allows", () => {
    buildEverything();
    const layerOf = (name: string) =>
      H.cacheCalls.filter((c) => c.name === name).map((c) => c.layer);

    // Clock models: age buckets, SLA arithmetic and open exposure all drift within a day.
    expect(layerOf("dsExecutive1")).toEqual(["cached"]);
    expect(layerOf("dsMttr1")).toEqual(["cached"]);
    expect(layerOf("dsSecrets1")).toEqual(["cached"]);
    expect(layerOf("dsRegister1")).toEqual(["cached", "cached", "cached"]);

    // Time-invariant models: dated by the ledger's own clock, so a stored copy stays true.
    expect(layerOf("dsProgram1")).toEqual(["durablyCached"]);
    expect(layerOf("dsRepos1")).toEqual(["durablyCached"]);
    expect(layerOf("dsHistory1")).toEqual(["durablyCached"]);
    expect(layerOf("dsStorage1")).toEqual(["durablyCached"]);

    // And nothing reached both layers, which is the failure the spelling-out above exists to
    // catch — a model that grew a second call site under the other layer.
    for (const name of new Set(H.cacheCalls.map((c) => c.name))) {
      expect(new Set(layerOf(name)).size, name).toBe(1);
    }
  });

  it("gives the clock models a 1 h TTL rather than the six-hour default", () => {
    buildEverything();
    for (const c of H.cacheCalls.filter((x) => x.layer === "cached")) {
      expect(c.ttl, c.name).toBe(3600);
    }
    // The durable four pass no TTL: their freshness mechanism is the stamp, not a clock.
    for (const c of H.cacheCalls.filter((x) => x.layer === "durablyCached")) {
      expect(c.ttl, c.name).toBeUndefined();
    }
  });

  /**
   * The audit above is a list of names; this is the PROPERTY that list is meant to encode, and
   * it is the assertion that survives a rename.
   *
   * A durable payload is written once and served until the stamp moves — up to a day of
   * DATA_VERSION stability, and seven by the store's own MAX_AGE backstop. So anything in that
   * layer has to answer identically as the wall clock advances over the same ledger. Anything
   * that does not is a figure labelled "measured now" that means "measured whenever the file
   * was written", and nothing on screen would say so.
   */
  it("every durable payload is byte-identical across a 30-day wall-clock move", () => {
    const keyFor = (c: { name: string; params: unknown }) =>
      `${c.name}|${JSON.stringify(c.params ?? null)}|${H.version}`;

    buildEverything();
    const durable = H.cacheCalls.filter((c) => c.layer === "durablyCached");
    expect(durable.length).toBeGreaterThan(0);
    const before = durable.map((c) => ({ c, json: JSON.stringify(H.store.get(keyFor(c))) }));

    vi.setSystemTime(NOW + 30 * DAY);
    H.store.clear();
    H.cacheCalls.length = 0;
    __resetModelMemosForTest();
    buildEverything();

    for (const { c, json } of before) {
      expect(JSON.stringify(H.store.get(keyFor(c))), c.name).toBe(json);
    }
  });

  it("puts the scope in the register key, not only in the payload", () => {
    registerModel("sca", ALL);
    registerModel("sast", ALL);
    const keys = H.cacheCalls
      .filter((c) => c.name === "dsRegister1")
      .map((c) => JSON.stringify(c.params));
    expect(new Set(keys).size).toBe(2);
  });
});

// --------------------------------------------------------------------------------------- //
//  One derivation
// --------------------------------------------------------------------------------------- //

describe("the whole model set costs one loadBaseRows", () => {
  it("derives the base exactly once across all ten builds", () => {
    buildEverything();
    expect(H.loadBaseRowsCalls).toBe(1);
  });

  it("hands that same array to the trend builders instead of letting them rebuild", () => {
    historyModel(ALL);
    programModel(ALL);
    expect(H.loadBaseRowsCalls).toBe(1);
    expect(Array.isArray(H.trendCalls[0].base)).toBe(true);
    expect(Array.isArray(H.programTrendCalls[0].o.base)).toBe(true);
  });

  // The memo is keyed on dataVersion(), not merely "computed once": a mutate-then-read inside
  // one execution must not serve rows it had just invalidated.
  it("rebuilds when the data version moves", () => {
    mttrModel(ALL);
    expect(H.loadBaseRowsCalls).toBe(1);
    H.version = "v2";
    mttrModel(ALL);
    expect(H.loadBaseRowsCalls).toBe(2);
  });

  it("dates the rows with the instant it publishes as asOf", () => {
    const m = mttrModel(ALL) as any;
    expect(m.asOf).toBe(NOW);
    expect((H.loadBaseRowsOpts[0] as any).now).toBe(NOW);
  });
});

// --------------------------------------------------------------------------------------- //
//  mttrModel
// --------------------------------------------------------------------------------------- //

describe("mttrModel", () => {
  it("summarises the whole register and censors what is still open", () => {
    const m = mttrModel(ALL) as any;
    expect(m.rowCount).toBe(8);
    expect(m.overall.resolved).toBe(3);
    expect(m.overall.open).toBe(5);
    expect(m.overall.mttr_median).toBe(10); // median of 7, 10, 31
    expect(m.remediation.km.events).toBe(3);
    expect(m.remediation.km.censored).toBe(5);
    expect(m.remediation.km.total).toBe(8);
  });

  // Where the curve never reaches half there is no median to print. The model must ship BOTH
  // fields so the page can render "> X d" instead of inventing a number.
  it("never collapses medianLowerBound into median", () => {
    const m = mttrModel(ALL) as any;
    expect("median" in m.remediation.km).toBe(true);
    expect("medianLowerBound" in m.remediation.km).toBe(true);
    // 3 events against 5 censored: survival never falls to 0.5 here, so the median is
    // unobservable and the bound is what is true.
    expect(m.remediation.km.median).toBeNull();
    expect(m.remediation.km.medianLowerBound).toBeGreaterThan(0);
    expect(m.remediation.kmLowerBoundPerSev).toBeTruthy();
  });

  // `KMPoint` carries {t, s, atRisk, events}; the chart plots two of them, and the register
  // decides the array's length.
  it("ships the curve as {t, s} only", () => {
    const m = mttrModel(ALL) as any;
    expect(m.remediation.km.curve.length).toBeGreaterThan(0);
    expect(Object.keys(m.remediation.km.curve[0]).sort()).toEqual(["s", "t"]);
  });

  it("counts the awaiting-vendor-fix segment and refuses it on scopes with no vendor", () => {
    const m = mttrModel(ALL) as any;
    expect(m.remediation.awaiting.overall).toBe(1); // sca:CVE-3
    expect(m.remediation.awaiting.openTotal).toBe(5);
    expect(m.remediation.awaiting.notApplicable).toBe(0);
  });

  // The actionable clock coincides with the detection clock on sast and secrets BY
  // CONSTRUCTION, so averaging it across three scopes would be two-thirds a restatement.
  it("scopes the actionable clock to sca and says how much it left out", () => {
    const m = mttrModel(ALL) as any;
    expect(m.remediation.actionable.scope).toBe("sca");
    expect(m.remediation.actionable.rowCount).toBe(3);
    expect(m.remediation.actionable.notMeasured).toBe(5);
    // Only CVE-2 has a live actionable clock (CVE-1 is resolved, CVE-3 has no fix yet) and it
    // is 69 days past a 7-day CRITICAL target.
    expect(m.remediation.actionable.openPastSla.overall.open).toBe(1);
    expect(m.remediation.actionable.openPastSla.overall.breached).toBe(1);
    expect(m.remediation.actionable.vendorLatency.segments.total).toBe(3);
  });

  it("drops the no-fix population from the point-in-time blocks when the toggle is off", () => {
    const on = mttrModel({ ...ALL }) as any;
    const off = mttrModel({ ...ALL, showNoFix: false }) as any;
    expect(on.rowCount).toBe(8);
    expect(off.rowCount).toBe(7); // sca:CVE-3 only
    expect(off.remediation.awaiting.overall).toBe(0);
    // The latency clock still reads the PRE-toggle population: its censored rows are exactly
    // the ones the toggle hides, so honouring it would leave only the fixed findings.
    expect(off.remediation.actionable.vendorLatency.segments.total).toBe(3);
  });

  it("narrows to one register when asked", () => {
    const m = mttrModel({ ...ALL, scope: "sast" }) as any;
    expect(m.rowCount).toBe(2);
    expect(m.remediation.actionable.rowCount).toBe(0);
    expect(m.remediation.actionable.notMeasured).toBe(2);
  });

  it("narrows to a severity selection", () => {
    const m = mttrModel({ ...ALL, severities: ["CRITICAL"] }) as any;
    expect(m.rowCount).toBe(2);
  });
});

// --------------------------------------------------------------------------------------- //
//  Absent is never zero
// --------------------------------------------------------------------------------------- //

describe("every rate carries its denominator", () => {
  it("reports ai_verdict coverage as 0 % rather than hiding it", () => {
    const c = signalCoverage(H.rows);
    expect(c.ai_verdict.applicable).toBe(2); // the two sast rows
    expect(c.ai_verdict.measured).toBe(0);
    expect(c.ai_verdict.missing).toBe(2);
    expect(c.ai_verdict.coveragePct).toBe(0);
    expect(c.ai_verdict.notApplicable).toBe(6);
  });

  it("separates 'not captured' from 'this scope has no such column'", () => {
    const c = signalCoverage(H.rows);
    // has_kev is an sca column. Two of the three sca rows carry a value; the third never had
    // one captured. The other five rows are a different question entirely.
    expect(c.has_kev.applicable).toBe(3);
    expect(c.has_kev.measured).toBe(2);
    expect(c.has_kev.missing).toBe(1);
    expect(c.has_kev.notApplicable).toBe(5);
    expect(c.has_kev.total).toBe(8);
    expect(c.validation_state.applicable).toBe(3);
    expect(c.validation_state.measured).toBe(2);
  });

  it("returns null, never 0 %, over an empty applicable population", () => {
    const c = signalCoverage(H.rows.filter((r) => r.scope === "secrets"));
    expect(c.has_kev.applicable).toBe(0);
    expect(c.has_kev.coveragePct).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  secretsModel
// --------------------------------------------------------------------------------------- //

describe("secretsModel has no severity axis", () => {
  it("ignores a severity selection and says it did", () => {
    const wide = secretsModel(ALL) as any;
    const narrow = secretsModel({ ...ALL, severities: ["CRITICAL"] }) as any;
    expect(wide.rowCount).toBe(3);
    expect(narrow.rowCount).toBe(3);
    expect(narrow.severityAxis.supported).toBe(false);
    expect(narrow.severityAxis.reason).toContain("severity grades a");
  });

  it("keeps severities out of its cache key, so one entry serves every selection", () => {
    secretsModel(ALL);
    secretsModel({ ...ALL, severities: ["CRITICAL"] });
    const keys = H.cacheCalls
      .filter((c) => c.name === "dsSecrets1")
      .map((c) => JSON.stringify(c.params));
    expect(new Set(keys).size).toBe(1);
  });

  it("segments on validation_state, confidence and secret_kind", () => {
    const m = secretsModel(ALL) as any;
    expect(Object.keys(m.segments).sort()).toEqual(["confidence", "secret_kind", "validation_state"]);
    const kinds = m.segments.secret_kind.map((s: any) => s.segment).sort();
    expect(kinds).toEqual(["CERTIFICATE", "PASSWORD", "SAAS_API_KEY"]);
  });

  it("publishes the validation denominator beside the validity rate", () => {
    const m = secretsModel(ALL) as any;
    expect(m.coverage.measured).toBe(2);
    expect(m.coverage.unmeasured).toBe(1);
    expect(m.coverage.total).toBe(3);
    expect(m.validity.measured).toBe(2);
    expect(m.validity.valid).toBe(1);
    expect(m.validity.ratePct).toBe(50);
  });

  // Removed is not rotated: a secret leaving the register means the string left HEAD.
  it("keeps removal and rotation as two events", () => {
    const m = secretsModel(ALL) as any;
    expect(m.removalVsRotation.removedAndRotated).toBe(1);
    expect(m.removalVsRotation.removedNotRotated).toBe(1);
    expect(m.removalVsRotation.rotatedNotRemoved).toBe(0);
    expect(m.removalVsRotation.neither).toBe(1);
  });

  it("censors the live credentials rather than dropping them", () => {
    const m = secretsModel(ALL) as any;
    expect(m.timeToRevoke.events).toBe(1); // k2, confirmed dead
    expect(m.timeToRevoke.censored).toBe(1); // k1, measured live
    expect(m.timeToRevoke.excludedUnmeasured).toBe(1); // k3, nobody looked
    expect(m.timeToRevoke.total).toBe(3);
  });
});

// --------------------------------------------------------------------------------------- //
//  registerModel
// --------------------------------------------------------------------------------------- //

describe("registerModel", () => {
  it("gives a vulnerability register its severity breakdown", () => {
    const m = registerModel("sca", ALL) as any;
    expect(m.severityAxis.supported).toBe(true);
    expect(m.counts).toEqual({ CRITICAL: 2, HIGH: 1 });
    expect(m.rowCount).toBe(3);
    expect(m.open).toBe(2);
    expect(m.previousCounts).toEqual({ CRITICAL: 1, HIGH: 2 });
  });

  it("refuses the severity axis on secrets and segments instead", () => {
    const m = registerModel("secrets", ALL) as any;
    expect(m.severityAxis.supported).toBe(false);
    expect(m.counts).toBeNull();
    expect(m.sevStats).toBeNull();
    expect(m.previousCounts).toBeNull();
    expect(m.segments.secret_kind.length).toBe(3);
  });

  // Internet exposure is a property of a host; this register's asset is a repository. The
  // funnel says it does not know rather than drawing a zero.
  it("stops the triage funnel at exploitable, because exposure is unknown here", () => {
    const m = registerModel("sca", ALL) as any;
    expect(m.funnel.exposureKnown).toBe(false);
    expect(m.funnel.exposed).toBe(0);
    expect(m.funnel.open).toBe(2);
  });

  it("excludes secrets from the risk tiers rather than folding them into unknown", () => {
    const m = registerModel("secrets", ALL) as any;
    expect(m.tiers.excludedSecrets).toBe(2); // both open secrets rows
    expect(m.tiers.open).toBe(0);
    expect(m.funnel.excludedSecrets).toBe(2);
  });

  it("buckets open ages and ranks the oldest", () => {
    const m = registerModel("sca", ALL) as any;
    expect(m.aging.totalOpen).toBe(2);
    expect(m.oldest.findings[0].identifier).toBe("CVE-2"); // 69 d, the oldest open
    expect(m.oldest.byRepo.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------------------- //
//  programModel
// --------------------------------------------------------------------------------------- //

describe("programModel", () => {
  it("excludes secrets from classification and counts what it refused", () => {
    const m = programModel(ALL) as any;
    expect(m.excludedSecrets).toBe(3);
    expect(m.rowCount).toBe(5);
    expect(m.rules.secrets).toBeNull();
    expect(m.rules.sca.sentence).toBeTruthy();
    expect(m.rules.sast.sentence).toBeTruthy();
  });

  it("computes sensitivity per scope, because the two rules are different kinds", () => {
    const m = programModel(ALL) as any;
    expect(Object.keys(m.sensitivity).sort()).toEqual(["sast", "sca"]);
    expect(Array.isArray(m.sensitivity.sca.points)).toBe(true);
  });

  it("publishes both capacity populations", () => {
    const m = programModel(ALL) as any;
    expect(m.capacity.months.length).toBeGreaterThan(0);
    expect(m.capacityHighRisk).toBeTruthy();
    expect(m.observationDays).toBeGreaterThan(0);
  });

  // `programTrendSlice` reads `.trend`; a secrets scope has no high-risk rule, so the honest
  // answer is an empty series with a flag, not a line of zeroes.
  it("carries a trend keyed where pagePayload.programTrendSlice reads it", () => {
    const m = programModel(ALL) as any;
    expect(m.trend[0].coverage_pct).toBe(50);
    expect(m.trendSupported).toBe(true);
    const s = programModel({ ...ALL, scope: "secrets" }) as any;
    expect(s.trend).toEqual([]);
    expect(s.trendSupported).toBe(false);
  });

  // THE DURABILITY ARGUMENT. Dated by the newest scan's ts, not by Date.now(), so the payload
  // is a function of the ledger and a stored copy answers identically forever.
  it("dates itself from the ledger's own clock, not the wall clock", () => {
    const m = programModel(ALL) as any;
    expect(m.asOfSource).toBe("scan");
    expect(m.asOf).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(m.observedFrom).toBe("2026-01-01T00:00:00Z");
  });

  it("answers identically a week later, with the same ledger", () => {
    const before = JSON.stringify(programModel(ALL));
    vi.setSystemTime(NOW + 7 * DAY);
    H.store.clear();
    __resetModelMemosForTest();
    expect(JSON.stringify(programModel(ALL))).toBe(before);
  });

  it("says so when there is no scan to date it from", () => {
    H.scans = [];
    __resetModelMemosForTest();
    const m = programModel(ALL) as any;
    expect(m.asOfSource).toBe("wallClock");
    expect(m.observedFrom).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  reposModel
// --------------------------------------------------------------------------------------- //

describe("reposModel", () => {
  it("profiles both groupings and both populations", () => {
    const m = reposModel(ALL) as any;
    expect(m.byRepo.groupBy).toBeUndefined(); // populations wrap two results
    expect(m.byRepo.all.groupBy).toBe("repo");
    expect(m.byLanguage.all.groupBy).toBe("language");
    expect(m.byRepo.rows.some((r: any) => r.population === "all")).toBe(true);
    expect(m.byRepo.rows.some((r: any) => r.population === "high_risk")).toBe(true);
  });

  it("counts the secrets it could not classify rather than calling them low risk", () => {
    const m = reposModel(ALL) as any;
    expect(m.byRepo.all.unclassifiedSecrets).toBe(3);
  });

  // The half-life column reads `age_days`, which is a wall-clock read as loaded. Re-censoring
  // at the ledger clock is what keeps the durable copy true.
  it("is stable across a moving wall clock", () => {
    const before = JSON.stringify(reposModel(ALL));
    vi.setSystemTime(NOW + 30 * DAY);
    H.store.clear();
    __resetModelMemosForTest();
    expect(JSON.stringify(reposModel(ALL))).toBe(before);
  });

  it("publishes the window it rests on, or null when there is none", () => {
    const m = reposModel(ALL) as any;
    expect(m.byRepo.all.windowMonths).toBeGreaterThan(0);
    H.scans = [];
    H.store.clear();
    __resetModelMemosForTest();
    const none = reposModel(ALL) as any;
    expect(none.observedFrom).toBeNull();
    expect(none.byRepo.all.windowMonths).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  historyModel
// --------------------------------------------------------------------------------------- //

describe("historyModel", () => {
  it("is shaped for the three pagePayload slices that read it", () => {
    const m = historyModel(ALL) as any;
    expect(Array.isArray(m.scans)).toBe(true);
    expect(Array.isArray(m.history)).toBe(true); // mttrPageTrendSlice reads this
    expect(Array.isArray(m.trend)).toBe(true); // both trend slices read this
    expect(m.scans[0].scan_id).toBe("sync-2"); // newest first, as the table draws it
  });

  it("counts the KPI band over the visible population", () => {
    const m = historyModel(ALL) as any;
    expect(m.kpis.tracked).toBe(8);
    expect(m.kpis.open).toBe(5);
    expect(m.kpis.resolvedAllTime).toBe(3);
    expect(m.kpis.medianMttr).toBe(10);
    expect(m.kpis.km.total).toBe(8);
  });

  it("reports per-scope scan coverage", () => {
    const m = historyModel(ALL) as any;
    expect(m.perScope.sca.scans).toBe(2);
    expect(m.perScope.sast.scans).toBe(1);
    expect(m.perScope.sca.firstScanTs).toBe("2026-01-01T00:00:00Z");
  });

  it("scopes the scan log with the rest of the model", () => {
    const m = historyModel({ ...ALL, scope: "sast" }) as any;
    expect(m.scans.length).toBe(1);
    expect(m.kpis.tracked).toBe(2);
  });

  // The trend must see the PRE-toggle rows: loadTrend excludes no-fix findings as-of each
  // date, so a fix landing later re-admits its finding at that point rather than deleting it.
  it("hands loadTrend the unfiltered population and the toggle", () => {
    historyModel({ ...ALL, showNoFix: false });
    const call = H.trendCalls[0];
    expect(call.showNoFix).toBe(false);
    expect(call.base.length).toBe(8); // not 7 — the no-fix row is still in
  });
});

// --------------------------------------------------------------------------------------- //
//  storageModel
// --------------------------------------------------------------------------------------- //

describe("storageModel", () => {
  it("prices the grid and says what is left over", () => {
    const m = storageModel() as any;
    expect(m.cellCount).toBe(400_000);
    expect(m.cellLimit).toBe(10_000_000);
    expect(m.cellsByTab.length).toBeGreaterThan(0);
    expect(m.cellsOther).toBe(400_000 - m.cellsByTab.length * 39_000);
    expect(m.ledgerRowCells).toBeGreaterThan(30);
  });

  it("counts findings and scans per register", () => {
    const m = storageModel() as any;
    expect(m.trackedFindings).toBe(8);
    expect(m.perScope.sca.findings).toBe(3);
    expect(m.perScope.secrets.scans).toBe(1);
    expect(m.scanCount).toBe(4);
  });

  it("reports the severities actually present, unknowns included", () => {
    const m = storageModel() as any;
    expect(m.distinctSeverities).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
    expect(m.unknownSeverityCount).toBe(0);
  });
});

// --------------------------------------------------------------------------------------- //
//  executiveModel
// --------------------------------------------------------------------------------------- //

describe("executiveModel", () => {
  it("tallies OPEN findings only, so the tiles agree with the hero above them", () => {
    const m = executiveModel(ALL) as any;
    expect(m.severityCounts.open).toBe(5);
    expect(m.severityCounts.total).toBe(8);
    expect(m.severityCounts.counts.CRITICAL).toBe(1);
  });

  // gas/'s by-domain split has no analog on a code register; three registers with three clocks
  // is what this one has instead. Shaped for execGroupSlice / mttrGroupTableSlice verbatim.
  it("splits by scope in the shape the executive slices read", () => {
    const m = executiveModel(ALL) as any;
    expect(m.byScope.dimension).toBe("scope");
    expect(m.byScope.rows.map((r: any) => r.group)).toEqual(["sca", "sast", "secrets"]);
    const sca = m.byScope.rows[0];
    expect(sca.open).toBe(2);
    expect(sca.resolved).toBe(1);
    expect("kmMedian" in sca).toBe(true);
    expect("kmMedianLowerBound" in sca).toBe(true);
  });

  it("collapses the split to the one register when a scope is selected", () => {
    const m = executiveModel({ ...ALL, scope: "sast" }) as any;
    expect(m.byScope.rows.length).toBe(1);
    expect(m.byScope.rows[0].group).toBe("sast");
  });

  // No badge beats a made-up one: under a week of history, or an unobservable median at
  // either endpoint, and the field is null.
  it("withholds the week badge when there is nothing to compare against", () => {
    for (const r of H.rows) r.first_seen = "2026-03-10T00:00:00Z";
    __resetModelMemosForTest();
    const m = executiveModel(ALL) as any;
    expect(m.weekTrend).toBeNull();
  });

  it("carries the unclassified count beside the tiers", () => {
    const m = executiveModel(ALL) as any;
    expect(m.tiers.excludedSecrets).toBe(2);
    expect(typeof m.tiers.unclassified).toBe("number");
  });
});

// --------------------------------------------------------------------------------------- //
//  The warm pass
// --------------------------------------------------------------------------------------- //

describe("warmReadModels", () => {
  it("asks for a fixed handful and sweeps once", () => {
    const report = warmReadModels();
    expect(report.blockedBy).toBeNull();
    expect(report.warmed).toBe(10);
    expect(report.skipped).toBe(0);
    expect(H.swept).toBe(1);
    expect(new Set(H.cacheCalls.map((c) => c.name))).toEqual(new Set([
      "dsHistory1", "dsProgram1", "dsRepos1", "dsStorage1",
      "dsExecutive1", "dsMttr1", "dsSecrets1", "dsRegister1",
    ]));
  });

  // `readModelStore` only WRITES while `duringWarm` is running — the garbage-collection rule
  // that bounds the Drive file count. A warm computing outside that window would write nothing
  // and leave the durable layer permanently cold, with no error anywhere.
  it("computes inside duringWarm, which is the only window that may write to Drive", () => {
    warmReadModels();
    expect(H.computeDepths.length).toBe(10);
    expect(H.computeDepths.every((d) => d === 1)).toBe(true);
    // ...and an ordinary page read is NOT in that window.
    H.store.clear();
    H.computeDepths.length = 0;
    mttrModel(ALL);
    expect(H.computeDepths).toEqual([0]);
  });

  // A commit landing mid-warm bumps DATA_VERSION and wastes everything computed; worse, a
  // PERSISTING job is part-way through a wholesale overwrite, so a warm reading the ledger
  // then would cache a TORN read under the pre-bump version.
  it("is a no-op while a job is in flight", () => {
    H.activeJobRow = { job_id: "job-1", kind: "scan", phase: "persisting" };
    const report = warmReadModels();
    expect(report.blockedBy).toContain("job-1");
    expect(report.warmed).toBe(0);
    expect(H.cacheCalls.length).toBe(0);
    expect(H.loadBaseRowsCalls).toBe(0);
    expect(H.swept).toBe(0);
  });

  it("respects the budget and skips the sweep when it ran out", () => {
    const report = warmReadModels(-1); // every target is already over budget
    expect(report.warmed).toBe(0);
    expect(report.skipped).toBe(10);
    expect(H.swept).toBe(0); // a short keep-list would trash live entries
  });

  // Best-effort: one failure must never abort the rest, or a single unreadable sheet costs the
  // whole warm and every page pays the cold path until the next fire.
  it("keeps going when one model throws", () => {
    H.cellCountThrows = true;
    const report = warmReadModels();
    expect(report.warmed).toBe(9); // storage failed; the other nine landed
    expect(report.skipped).toBe(0);
    expect(H.swept).toBe(1);
  });
});
