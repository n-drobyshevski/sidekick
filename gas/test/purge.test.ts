import { describe, expect, it } from "vitest";
import {
  archiveWalkOrder,
  matchesPurge,
  narrowScanScope,
  previewEpisodePrune,
  previewSeverityPurge,
  pruneEpisodesCore,
  purgeCheckpointByKeys,
  purgeCheckpointBySeverity,
  purgePayloadBySeverity,
  purgeRecordsBySeverity,
  purgeSet,
  purgeStateBySeverity,
  severityOf,
  trimHistoryRows,
} from "../src/domain/purge";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";
import type { EpisodeRow, LedgerState, ScanRow } from "../src/domain/ledgerCore";

function row(vuln_key: string, severity: string, over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    vuln_key, cve: null, severity, asset_id: null, asset_name: null, asset_type: null,
    cloud: null, first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-02-01T00:00:00Z",
    status: "OPEN", resolved_at: null, resolution_src: null, reopened_count: 0,
    first_scan_id: null, last_scan_id: null, subscription_name: null,
    subscription_ext_id: null, tags_json: null, fix_date: null, fix_observed_at: null,
    ...emptyRiskSignals(), ...over,
  };
}

function episode(vuln_key: string, severity: string, resolved_at: string | null): EpisodeRow {
  return {
    vuln_key, cve: null, severity, first_seen: "2026-01-01T00:00:00Z", resolved_at,
    resolution_src: "api", reopened_count: 0, compaction_id: "cmp-1",
    superseded_by_scan: null, fix_date: null, fix_observed_at: null,
    has_kev: null, has_exploit: null, epss: null, risk_observed_at: null,
  };
}

function scan(scan_id: string, ts: string, over: Partial<ScanRow> = {}): ScanRow {
  return {
    scan_id, ts, mode: "live", shape: "flat", total: 0, new_count: 0, resolved_count: 0,
    reopened_count: 0, raw_ref: `folder-${scan_id}`, obs_ref: `obs-${scan_id}`,
    severities: null, sealed: 0, ...over,
  };
}

const envelope = (nodes: unknown[]) => ({ data: { vulnerabilityFindings: { nodes } } });

// --------------------------------------------------------------------- the predicate

describe("severity predicate", () => {
  it("uses effectiveSeverity, so a raw node healed from vendorSeverity classifies like its ledger row", () => {
    // The trap: archives store raw unbaked Wiz nodes (scanJobs.ts:428) while slimRecord bakes
    // effectiveSeverity at ingest (scanJobs.ts:219). A predicate on the raw `severity` field
    // alone would leave this node in the archive when purging LOW — and replay would then
    // resurrect it, relabelled UNKNOWN, which is worse than not purging at all.
    const raw = { severity: "", vendorSeverity: "LOW" };
    expect(severityOf(raw)).toBe("LOW");
    expect(matchesPurge(raw, purgeSet(["LOW"]))).toBe(true);
  });

  it("agrees with the baked slim record produced from the same node", () => {
    expect(severityOf({ severity: "LOW", severity_source: "vendorSeverity" })).toBe("LOW");
  });

  it("normalizes case and the INFORMATIONAL spelling", () => {
    expect(matchesPurge({ severity: "critical" }, purgeSet(["CRITICAL"]))).toBe(true);
    expect(matchesPurge({ severity: "INFORMATIONAL" }, purgeSet(["INFO"]))).toBe(true);
  });

  it("treats an unrecognized severity as UNKNOWN, which is purgeable", () => {
    expect(severityOf({ severity: "nonsense" })).toBe("UNKNOWN");
    expect(matchesPurge({ severity: "nonsense" }, purgeSet(["UNKNOWN"]))).toBe(true);
  });

  it("an empty selection purges nothing (never everything)", () => {
    expect(matchesPurge({ severity: "LOW" }, purgeSet([]))).toBe(false);
  });
});

// ------------------------------------------------------------------------ state purge

describe("purgeStateBySeverity", () => {
  const state = (): LedgerState => ({
    scans: [scan("s1", "2026-01-01T00:00:00Z", { severities: '["CRITICAL", "HIGH", "LOW"]' })],
    ledger: { a: row("a", "LOW"), b: row("b", "HIGH"), c: row("c", "MEDIUM") },
    episodes: [episode("d", "LOW", "2026-01-05T00:00:00Z"), episode("e", "HIGH", "2026-01-05T00:00:00Z")],
  });

  it("drops matching live rows and episodes, keeps the rest", () => {
    const out = purgeStateBySeverity(state(), ["LOW", "MEDIUM"]);
    expect(Object.keys(out.state.ledger).sort()).toEqual(["b"]);
    expect(out.state.episodes.map((e) => e.vuln_key)).toEqual(["e"]);
    expect(out.ledgerRemoved).toBe(2);
    expect(out.episodeRemoved).toBe(1);
  });

  it("does not mutate the input state", () => {
    const s = state();
    purgeStateBySeverity(s, ["LOW"]);
    expect(Object.keys(s.ledger).sort()).toEqual(["a", "b", "c"]);
    expect(s.episodes).toHaveLength(2);
  });

  it("is idempotent", () => {
    const once = purgeStateBySeverity(state(), ["LOW"]).state;
    const twice = purgeStateBySeverity(once, ["LOW"]);
    expect(twice.ledgerRemoved).toBe(0);
    expect(twice.episodeRemoved).toBe(0);
    expect(twice.state.ledger).toEqual(once.ledger);
  });

  it("narrows each scan row's recorded severity scope", () => {
    const out = purgeStateBySeverity(state(), ["LOW"]);
    expect(out.state.scans[0].severities).toBe('["CRITICAL", "HIGH"]');
    expect(out.scopesNarrowed).toBe(1);
  });
});

describe("narrowScanScope", () => {
  it("removes the purged severity from an explicit scope", () => {
    expect(narrowScanScope('["CRITICAL", "HIGH", "LOW"]', purgeSet(["LOW"])))
      .toBe('["CRITICAL", "HIGH"]');
  });

  it("turns an unscoped row (null = all severities) into the remaining set", () => {
    expect(narrowScanScope(null, purgeSet(["LOW", "INFO"])))
      .toBe('["CRITICAL", "HIGH", "MEDIUM"]');
  });

  it("leaves a row alone when it already excludes the purged severity", () => {
    expect(narrowScanScope('["CRITICAL"]', purgeSet(["LOW"]))).toBe('["CRITICAL"]');
  });

  it("leaves a row alone rather than narrowing it to nothing", () => {
    // serializeSeverities([]) round-trips back to null, which means ALL severities — writing
    // it would widen the row instead of narrowing it.
    expect(narrowScanScope('["LOW"]', purgeSet(["LOW"]))).toBe('["LOW"]');
  });

  it("purging every selectable severity leaves the row alone too", () => {
    const all = purgeSet(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
    expect(narrowScanScope(null, all)).toBe(null);
  });
});

// -------------------------------------------------------------------------- payloads

describe("purgePayloadBySeverity", () => {
  it("filters a GraphQL page envelope and keeps its shape", () => {
    const out = purgePayloadBySeverity(
      envelope([{ id: 1, severity: "LOW" }, { id: 2, severity: "HIGH" }]), ["LOW"]);
    expect(out.removed).toBe(1);
    expect(out.recognized).toBe(true);
    expect((out.payload as any).data.vulnerabilityFindings.nodes).toEqual([
      { id: 2, severity: "HIGH" },
    ]);
  });

  it("writes an emptied page back as an empty envelope, never null", () => {
    // readScanPayload returns null for a scan with no readable pages, and loadReplayPayloads
    // turns that into LedgerRebuildError — permanently blocking scan deletion. An emptied
    // page must stay a page.
    const out = purgePayloadBySeverity(envelope([{ severity: "LOW" }]), ["LOW"]);
    expect(out.payload).not.toBeNull();
    expect((out.payload as any).data.vulnerabilityFindings.nodes).toEqual([]);
  });

  it("handles the list-of-pages form readScanPayload returns", () => {
    const out = purgePayloadBySeverity(
      [envelope([{ severity: "LOW" }]), envelope([{ severity: "HIGH" }])], ["LOW"]);
    expect(out.removed).toBe(1);
    expect(Array.isArray(out.payload)).toBe(true);
    expect((out.payload as any[])[0].data.vulnerabilityFindings.nodes).toEqual([]);
  });

  it("handles a bare slim-record array (the incremental archive shape)", () => {
    const out = purgePayloadBySeverity(
      [{ severity: "LOW" }, { severity: "HIGH" }], ["LOW"]);
    expect(out.removed).toBe(1);
    expect(out.recognized).toBe(true);
    expect(out.payload).toEqual([{ severity: "HIGH" }]);
  });

  it("returns an unrecognized payload untouched rather than emptying it", () => {
    const weird = { something: "else" };
    const out = purgePayloadBySeverity(weird, ["LOW"]);
    expect(out.recognized).toBe(false);
    expect(out.removed).toBe(0);
    expect(out.payload).toBe(weird);
  });

  it("is idempotent", () => {
    const once = purgePayloadBySeverity(envelope([{ severity: "LOW" }, { severity: "HIGH" }]), ["LOW"]);
    const twice = purgePayloadBySeverity(once.payload, ["LOW"]);
    expect(twice.removed).toBe(0);
  });
});

describe("purgeRecordsBySeverity", () => {
  it("filters and counts", () => {
    const out = purgeRecordsBySeverity(
      [{ severity: "LOW" }, { severity: "HIGH" }, { severity: "", vendorSeverity: "LOW" }], ["LOW"]);
    expect(out.removed).toBe(2);
    expect(out.records).toEqual([{ severity: "HIGH" }]);
  });
});

// ------------------------------------------------------------------------ checkpoint

describe("purgeCheckpoint", () => {
  const cp = { version: 1, floor_scan_id: "s1", floor_ts: "t", ledger: [row("a", "LOW"), row("b", "HIGH")] };

  it("drops matching rows by severity and keeps the floor metadata", () => {
    const out = purgeCheckpointBySeverity(cp, ["LOW"]);
    expect(out.removed).toBe(1);
    expect(out.checkpoint.ledger.map((r) => r.vuln_key)).toEqual(["b"]);
    expect(out.checkpoint.floor_scan_id).toBe("s1");
  });

  it("drops matching rows by key (the episode-prune counterpart)", () => {
    const out = purgeCheckpointByKeys(cp, new Set(["b"]));
    expect(out.removed).toBe(1);
    expect(out.checkpoint.ledger.map((r) => r.vuln_key)).toEqual(["a"]);
  });

  it("an empty key set is a no-op", () => {
    expect(purgeCheckpointByKeys(cp, new Set()).removed).toBe(0);
  });
});

// -------------------------------------------------------------------- episode pruning

describe("pruneEpisodesCore", () => {
  const cutoff = Date.parse("2026-06-01T00:00:00Z");
  const state = (): LedgerState => ({
    scans: [],
    ledger: {},
    episodes: [
      episode("old-low", "LOW", "2026-01-01T00:00:00Z"),
      episode("old-high", "HIGH", "2026-02-01T00:00:00Z"),
      episode("new-low", "LOW", "2026-09-01T00:00:00Z"),
      episode("undated", "LOW", null),
    ],
  });

  it("prunes by age", () => {
    const out = pruneEpisodesCore(state(), { resolvedBeforeMs: cutoff, severities: null });
    expect(out.prunedKeys.sort()).toEqual(["old-high", "old-low"]);
    expect(out.state.episodes.map((e) => e.vuln_key).sort()).toEqual(["new-low", "undated"]);
  });

  it("narrows by severity when asked", () => {
    const out = pruneEpisodesCore(state(), { resolvedBeforeMs: cutoff, severities: ["LOW"] });
    expect(out.prunedKeys).toEqual(["old-low"]);
  });

  it("never prunes an episode with no parseable resolved_at — absent is not infinitely old", () => {
    const out = pruneEpisodesCore(state(), { resolvedBeforeMs: Date.now(), severities: null });
    expect(out.prunedKeys).not.toContain("undated");
  });

  it("is exclusive at the boundary (resolved exactly at the cutoff survives)", () => {
    const s: LedgerState = {
      scans: [], ledger: {},
      episodes: [episode("edge", "LOW", "2026-06-01T00:00:00Z")],
    };
    expect(pruneEpisodesCore(s, { resolvedBeforeMs: cutoff, severities: null }).removed).toBe(0);
  });

  it("does not mutate the input", () => {
    const s = state();
    pruneEpisodesCore(s, { resolvedBeforeMs: cutoff, severities: null });
    expect(s.episodes).toHaveLength(4);
  });

  it("preview counts match what apply removes", () => {
    const c = { resolvedBeforeMs: cutoff, severities: null };
    expect(previewEpisodePrune(state(), c).rows).toBe(pruneEpisodesCore(state(), c).removed);
  });
});

// ---------------------------------------------------------------------- history trim

describe("trimHistoryRows", () => {
  const rows = [
    { date: "2024-01-01", median_days: 1 },
    { date: "2025-06-01", median_days: 2 },
    { date: "2026-01-01", median_days: 3 },
  ];

  it("drops rows strictly before the cutoff date", () => {
    const out = trimHistoryRows(rows, "2025-06-01");
    expect(out.removed).toBe(1);
    expect(out.rows.map((r) => r.date)).toEqual(["2025-06-01", "2026-01-01"]);
    expect(out.oldestKept).toBe("2025-06-01");
  });

  it("keeps undated rows", () => {
    const out = trimHistoryRows([{ median_days: 1 }, ...rows], "2030-01-01");
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]["date"]).toBeUndefined();
  });

  it("is a no-op when nothing is old enough", () => {
    expect(trimHistoryRows(rows, "2000-01-01").removed).toBe(0);
  });
});

// ------------------------------------------------------------------------ walk order

describe("archiveWalkOrder", () => {
  it("returns flat scans newest first and drops grouped ones", () => {
    const scans = [
      scan("s1", "2026-01-01T00:00:00Z"),
      scan("s2", "2026-03-01T00:00:00Z", { shape: "grouped" }),
      scan("s3", "2026-02-01T00:00:00Z"),
    ];
    expect(archiveWalkOrder(scans).map((s) => s.scan_id)).toEqual(["s3", "s1"]);
  });
});

// ------------------------------------------------------------------------- preview

describe("previewSeverityPurge", () => {
  it("counts rows and separates rewritable from sealed scans", () => {
    const state: LedgerState = {
      scans: [
        scan("s1", "2026-01-01T00:00:00Z", { sealed: 1 }),
        scan("s2", "2026-02-01T00:00:00Z"),
        scan("s3", "2026-03-01T00:00:00Z", { shape: "grouped" }),
      ],
      ledger: { a: row("a", "LOW"), b: row("b", "HIGH") },
      episodes: [episode("c", "LOW", "2026-01-01T00:00:00Z")],
    };
    const p = previewSeverityPurge(state, ["LOW"]);
    expect(p.ledgerRows).toBe(1);
    expect(p.episodeRows).toBe(1);
    expect(p.bySeverity).toEqual({ LOW: 2 });
    expect(p.scansToRewrite).toBe(1);
    expect(p.sealedScans).toBe(1);
  });

  it("preview counts equal what the apply removes", () => {
    const state: LedgerState = {
      scans: [], ledger: { a: row("a", "LOW"), b: row("b", "MEDIUM") },
      episodes: [episode("c", "LOW", "2026-01-01T00:00:00Z")],
    };
    const p = previewSeverityPurge(state, ["LOW", "MEDIUM"]);
    const applied = purgeStateBySeverity(state, ["LOW", "MEDIUM"]);
    expect(p.ledgerRows).toBe(applied.ledgerRemoved);
    expect(p.episodeRows).toBe(applied.episodeRemoved);
  });
});
