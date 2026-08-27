// The export is defined by what the importer can do with it, so the spec is a
// round-trip: build a register, export it, import the export into an empty ledger, and
// compare the tables. That reuses importMerge — already fixture-locked against the
// Python ledger — as the oracle, rather than asserting the exporter against itself.

import { describe, expect, it } from "vitest";
import {
  BUNDLE_EPISODE_COLUMNS,
  BUNDLE_SCAN_COLUMNS,
  buildMigrationBundle,
  bundleCounts,
} from "../src/domain/exportBundle";
import {
  importBundleCore,
  validateBundle,
  MIGRATION_KIND,
  MIGRATION_VERSION,
} from "../src/domain/importMerge";
import {
  emptyState,
  persistFlatScan,
  scansAsc,
  type LedgerState,
  type ScanRow,
} from "../src/domain/ledgerCore";
import { LEDGER_COLUMNS } from "../src/domain/reconcile";

const EXPORTED_AT = "2026-08-11T00:00:00Z";

const T1 = "2026-07-01T06:00:00Z";
const T2 = "2026-07-08T06:00:00Z";
const T3 = "2026-07-15T06:00:00Z";

function node(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "f-1",
    name: "CVE-2026-0001",
    detailedName: "openssl",
    severity: "HIGH",
    status: "OPEN",
    firstDetectedAt: "2026-06-20T00:00:00Z",
    vulnerableAsset: { id: "vm-1", name: "web-01", type: "VIRTUAL_MACHINE", cloudPlatform: "AWS" },
    ...over,
  };
}

// A persists throughout; B resolves via the API at T2; C is only ever seen at T1 and
// therefore resolves by disappearance at T2; D arrives late. B carries risk signals, C
// carries none at all — the null-vs-false case the whole schema is shaped around.
const A = node({ id: "f-a", name: "CVE-A", severity: "CRITICAL" });
const B_OPEN = node({
  id: "f-b", name: "CVE-B", hasCisaKevExploit: true, hasExploit: false, epssProbability: 0.42,
});
const B_RESOLVED = { ...B_OPEN, status: "RESOLVED", resolvedAt: "2026-07-05T00:00:00Z" };
const C = node({ id: "f-c", name: "CVE-C", severity: "MEDIUM" });
const D = node({ id: "f-d", name: "CVE-D", severity: "HIGH" });

const HISTORY = [
  { date: "2026-07-01", median_days: 5, resolved: 1, open: 3, total: 4, sla_pct: 90,
    oldest_open_days: 40, open_past_sla: 1 },
  { date: "2026-07-15", median_days: 4.5, resolved: 2, open: 2, total: 4, sla_pct: null,
    oldest_open_days: null, open_past_sla: null },
];

function seededState(): LedgerState {
  const state = emptyState();
  persistFlatScan(state, [A, B_OPEN, C], { mode: "live", scanId: T1 });
  persistFlatScan(state, [A, B_RESOLVED], { mode: "live", scanId: T2 });
  persistFlatScan(state, [A, D], { mode: "live", scanId: T3 });
  return state;
}

function scansTable(scans: ScanRow[]) {
  return scansAsc(scans).map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of BUNDLE_SCAN_COLUMNS) out[String(c)] = r[c] ?? null;
    return out;
  });
}

describe("migration bundle export", () => {
  const state = seededState();
  const bundle = buildMigrationBundle(state, HISTORY, {
    exportedAt: EXPORTED_AT, schemaVersion: 2,
  });

  it("is a bundle this app's own importer accepts", () => {
    expect(bundle.kind).toBe(MIGRATION_KIND);
    expect(bundle.version).toBe(MIGRATION_VERSION);
    expect(bundle.schema_version).toBe(2);
    expect(() => validateBundle(bundle)).not.toThrow();
  });

  it("carries every ledger column, not the legacy subset", () => {
    expect(bundle.ledger.length).toBeGreaterThan(0);
    for (const row of bundle.ledger) {
      expect(Object.keys(row).sort()).toEqual([...LEDGER_COLUMNS].map(String).sort());
    }
  });

  it("keeps an uncaptured risk signal null rather than false", () => {
    const c = bundle.ledger.find((r) => r["vuln_key"] === "id:f-c")!;
    expect(c["has_kev"]).toBeNull();
    expect(c["has_exploit"]).toBeNull();
    expect(c["epss"]).toBeNull();
    // ...while an observed one survives, including an observed *false*.
    const b = bundle.ledger.find((r) => r["vuln_key"] === "id:f-b")!;
    expect(b["has_kev"]).toBe(true);
    expect(b["has_exploit"]).toBe(false);
    expect(b["epss"]).toBe(0.42);
  });

  it("keeps the lifecycle facts that cannot be recovered from a later scan", () => {
    const c = bundle.ledger.find((r) => r["vuln_key"] === "id:f-c")!;
    // C stopped being returned at T2. Nothing outside this ledger records that.
    expect(c["status"]).toBe("RESOLVED");
    expect(c["resolution_src"]).toBe("disappeared");
    expect(c["resolved_at"]).toBe(T2);
    const b = bundle.ledger.find((r) => r["vuln_key"] === "id:f-b")!;
    expect(b["resolution_src"]).toBe("api");
    // first_seen is the API's own date, earlier than the scan that first saw it.
    expect(b["first_seen"]).toBe("2026-06-20T00:00:00Z");
  });

  it("drops the Drive references and nothing else from the scan rows", () => {
    expect(bundle.scans).toHaveLength(3);
    for (const s of bundle.scans) {
      expect("raw_ref" in s).toBe(false);
      expect("obs_ref" in s).toBe(false);
    }
    expect(bundle.scans.map((s) => s["scan_id"])).toEqual([T1, T2, T3]);
  });

  it("carries open_past_sla, which the legacy Python export predates", () => {
    expect(bundle.mttr_history).toHaveLength(2);
    expect(bundle.mttr_history[0]["open_past_sla"]).toBe(1);
    expect(bundle.mttr_history[1]["open_past_sla"]).toBeNull();
  });

  it("is deterministic — two exports of an unchanged register are identical", () => {
    const again = buildMigrationBundle(seededState(), HISTORY, {
      exportedAt: EXPORTED_AT, schemaVersion: 2,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(bundle));
  });

  it("counts what it wrote", () => {
    expect(bundleCounts(bundle)).toEqual({
      scans: 3, ledger: 4, episodes: 0, mttr_history: 2,
    });
  });

  it("round-trips through importBundleCore, losing nothing", () => {
    const { state: back, counts } = importBundleCore(
      emptyState(), validateBundle(bundle), () => null, { compactionId: "cmp-rt" },
    );
    expect(counts.vulns_imported).toBe(Object.keys(state.ledger).length);
    expect(counts.scans_imported).toBe(state.scans.length);
    expect(counts.scans_replayed).toBe(0);

    // The import is "the unified history compacted at the import floor", so a lifecycle
    // that had already settled arrives as a sealed episode rather than a live row. Every
    // fact still lands, in one table or the other — which is the property worth pinning.
    const settled = Object.values(state.ledger).filter((r) => r.status === "RESOLVED");
    expect(settled.length).toBeGreaterThan(0);
    expect(counts.episodes_converted).toBe(settled.length);

    for (const [key, row] of Object.entries(state.ledger)) {
      if (row.status === "OPEN") {
        expect(back.ledger[key], key).toEqual(row);
        continue;
      }
      const ep = back.episodes.find((e) => e.vuln_key === key);
      expect(ep, key).toBeDefined();
      expect(ep!.first_seen).toBe(row.first_seen);
      expect(ep!.resolved_at).toBe(row.resolved_at);
      expect(ep!.resolution_src).toBe(row.resolution_src);
      expect(ep!.has_kev).toBe(row.has_kev);
      expect(ep!.has_exploit).toBe(row.has_exploit);
      expect(ep!.epss).toBe(row.epss);
    }

    // Imported scans arrive sealed, for the same reason (importMerge.coerceScan).
    const expected = scansTable(state.scans).map((r) => ({ ...r, sealed: 1 }));
    expect(scansTable(back.scans)).toEqual(expected);
  });
});

describe("migration bundle export — compacted history", () => {
  it("carries sealed episodes with their risk and vendor-fix columns intact", () => {
    const state = seededState();
    // Model what compaction leaves behind: a lifecycle that lives only as an episode.
    state.episodes.push({
      vuln_key: "id:f-old", cve: "CVE-OLD", severity: "HIGH",
      first_seen: "2026-05-01T00:00:00Z", resolved_at: "2026-05-20T00:00:00Z",
      resolution_src: "api", reopened_count: 0, compaction_id: "cmp-1",
      superseded_by_scan: null, tags_json: JSON.stringify({ "Wiz/Domain": "SAP" }),
      fix_date: "2026-05-10T00:00:00Z",
      fix_observed_at: "2026-05-12T00:00:00Z", has_kev: true, has_exploit: null,
      published_date: null,
      epss: 0.9, risk_observed_at: "2026-05-02T00:00:00Z",
    });
    const bundle = buildMigrationBundle(state, [], { exportedAt: EXPORTED_AT });
    expect(bundle.episodes).toHaveLength(1);
    const ep = bundle.episodes[0];
    expect(Object.keys(ep).sort()).toEqual([...BUNDLE_EPISODE_COLUMNS].map(String).sort());
    expect(ep["has_kev"]).toBe(true);
    expect(ep["has_exploit"]).toBeNull();
    expect(ep["epss"]).toBe(0.9);
    expect(ep["fix_date"]).toBe("2026-05-10T00:00:00Z");
    // The tag bag is part of the bundle, not just of the sheet: an episode that reaches another
    // surface without it arrives already unattributable, and nothing downstream can tell that
    // apart from a resource nobody ever tagged.
    expect(JSON.parse(String(ep["tags_json"]))["Wiz/Domain"]).toBe("SAP");
    expect(bundle.schema_version).toBeNull();
  });
});
