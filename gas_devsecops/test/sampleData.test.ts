// H2 — the dev harness seed. What this file pins:
//
//   1. the generated counts are what dev/sampleData.dev.ts claims (400 sca, 40 sast,
//      120 secrets, split 108 singles + 6 twin pairs);
//   2. the 6 twin pairs really collide on (secretDataId, path, lineNumber) and differ on
//      firstSeenAt — the whole reason they are in the seed;
//   3. every secrets `type` the API returns appears at least once;
//   4. the validation-state split is exactly 4 INVALID / 8 VALID / rest UNKNOWN;
//   5. no generated node carries a key matching /snippet|validationDetails/i — the seed must
//      not fight scanJobs.ts's deny-list, it must never need it;
//   6. THE PIPELINE CHECK: feeding the raw secrets nodes through the REAL
//      `scanJobs.slimRecord` and `domain/reconcile.reconcile` — not a hand-rolled fold —
//      collapses 120 nodes over 114 keys into exactly 114 ledger rows. That arithmetic is
//      the point: a seed that bypassed slimRecord/reconcile could claim "114" without ever
//      proving the fold actually happens.
//   7. the three-scan battery reconciles through `ledgerStore.persistSync` (the exact
//      function `scanJobs.step` calls in production) into resolved rows for sca, sast and
//      secrets — proof the seed exercises resolve-by-disappearance, not just presence.
//
// `dev/sampleData.dev.ts` and its dependents (`scanJobs.ts`, `domain/reconcile.ts`) declare
// no top-level GAS calls, so importing them directly needs no `dev/gas-shims.js` boot for the
// pure checks below (1-6). Case 7 goes through `ledgerStore.persistSync`, which DOES call
// `sheetsDb`/`archiveStore` — those two are faked in-memory here, the same pattern
// `test/ledgerCommit.test.ts` and `test/scanJobs.test.ts` use, so `persistSync` runs for
// real against a fake platform rather than a fake `persistSync`.

import { describe, expect, it, vi } from "vitest";
import { SCOPES, type Scope } from "../src/domain/config";
import type { Rec } from "../src/domain/util";
import {
  SAMPLE_COUNTS,
  SAMPLE_FINDINGS,
  SAMPLE_RAW_NODES,
  SAMPLE_SYNCS,
} from "../dev/sampleData.dev";

const DENIED_KEY = /snippet|validationDetails/i;
const SECRET_TYPES = [
  "CERTIFICATE", "CLOUD_KEY", "DB_CONNECTION_STRING", "GIT_CREDENTIAL",
  "PASSWORD", "PRIVATE_KEY", "SAAS_API_KEY",
];

/* -------------------------------------------------------------------- 1: generated counts */

describe("generated counts", () => {
  it("match what SAMPLE_COUNTS claims, per scope", () => {
    expect(SAMPLE_RAW_NODES.sca).toHaveLength(SAMPLE_COUNTS.sca);
    expect(SAMPLE_RAW_NODES.sast).toHaveLength(SAMPLE_COUNTS.sast);
    expect(SAMPLE_RAW_NODES.secrets).toHaveLength(SAMPLE_COUNTS.secrets);
    expect(SAMPLE_COUNTS.sca).toBe(400);
    expect(SAMPLE_COUNTS.sast).toBe(40);
    expect(SAMPLE_COUNTS.secrets).toBe(120);
    expect(SAMPLE_COUNTS.secretsSingles).toBe(108);
    expect(SAMPLE_COUNTS.secretsTwinPairs).toBe(6);
    expect(SAMPLE_COUNTS.secretsSingles + SAMPLE_COUNTS.secretsTwinPairs * 2).toBe(120);
  });

  it("SAMPLE_FINDINGS is the flat union — 560 raw nodes, export name unchanged", () => {
    expect(Array.isArray(SAMPLE_FINDINGS)).toBe(true);
    expect(SAMPLE_FINDINGS).toHaveLength(400 + 40 + 120);
  });

  it("every scope in SCOPES has a raw-node population", () => {
    for (const scope of SCOPES) {
      expect(SAMPLE_RAW_NODES[scope].length).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------------------- 2 + 3 + 4 + 5 */

function secretKeyOf(n: Rec): string {
  return `${n["secretDataId"]}|${n["path"]}|${n["lineNumber"]}`;
}

describe("secrets: twins, types, validation split, deny-list", () => {
  it("6 keys collide on (secretDataId, path, lineNumber), each with 2 nodes differing on firstSeenAt", () => {
    const byKey = new Map<string, Rec[]>();
    for (const n of SAMPLE_RAW_NODES.secrets) {
      const key = secretKeyOf(n);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(n);
      else byKey.set(key, [n]);
    }
    const twinGroups = [...byKey.values()].filter((g) => g.length > 1);
    expect(twinGroups).toHaveLength(6);
    for (const group of twinGroups) {
      expect(group).toHaveLength(2);
      expect(group[0]!["firstSeenAt"]).not.toBe(group[1]!["firstSeenAt"]);
      // one REPOSITORY, one REPOSITORY_BRANCH — the shape the fold's precedence rule reads.
      const types = group.map((n) => (n["resource"] as Rec)["type"]).sort();
      expect(types).toEqual(["REPOSITORY", "REPOSITORY_BRANCH"]);
    }
    // 108 singleton keys + 6 twin keys = 114 unique keys over 120 physical nodes.
    expect(byKey.size).toBe(114);
  });

  it("every secrets `type` the API returns appears at least once", () => {
    const seen = new Set(SAMPLE_RAW_NODES.secrets.map((n) => String(n["type"])));
    for (const type of SECRET_TYPES) expect(seen.has(type)).toBe(true);
    expect(seen.size).toBe(SECRET_TYPES.length);
  });

  it("validation state splits 4 INVALID / 8 VALID / rest UNKNOWN", () => {
    const counts: Record<string, number> = { INVALID: 0, VALID: 0, UNKNOWN: 0 };
    for (const n of SAMPLE_RAW_NODES.secrets) {
      const state = String(n["validationStatus"]);
      counts[state] = (counts[state] ?? 0) + 1;
    }
    expect(counts["INVALID"]).toBe(4);
    expect(counts["VALID"]).toBe(8);
    expect(counts["UNKNOWN"]).toBe(120 - 4 - 8);
  });

  it("CERTIFICATE is entirely INFO and PASSWORD never exceeds MEDIUM; nothing is CRITICAL", () => {
    const bySeverity = (type: string) =>
      SAMPLE_RAW_NODES.secrets.filter((n) => n["type"] === type).map((n) => String(n["severity"]));
    expect(new Set(bySeverity("CERTIFICATE"))).toEqual(new Set(["INFO"]));
    expect(new Set(bySeverity("PASSWORD"))).not.toContain("HIGH");
    expect(new Set(bySeverity("PASSWORD"))).not.toContain("CRITICAL");
    for (const n of SAMPLE_RAW_NODES.secrets) expect(n["severity"]).not.toBe("CRITICAL");
  });
});

describe("no generated node carries a denied key", () => {
  for (const scope of SCOPES) {
    it(`${scope}: no node's JSON matches /snippet|validationDetails/i`, () => {
      for (const n of SAMPLE_RAW_NODES[scope]) {
        expect(JSON.stringify(n)).not.toMatch(DENIED_KEY);
      }
    });
  }
});

/* -------------------------------------------------------------- 6: the pipeline, single-shot */

describe("the pipeline: slimRecord -> reconcile, and the twin fold", () => {
  it("120 raw secrets nodes (6 twin pairs) fold to 114 ledger rows through the REAL pipeline", async () => {
    const { slimRecord } = await import("../src/server/scanJobs");
    const { reconcile } = await import("../src/domain/reconcile");

    const slimmed = SAMPLE_RAW_NODES.secrets.map((n) => slimRecord("secrets", n));
    const scanId = "2026-06-01T08:00:00.000Z";
    const result = reconcile(slimmed, {}, scanId, scanId, null, { scope: "secrets" });

    expect(Object.keys(result.ledger)).toHaveLength(114);
    expect(result.twinStats.keys).toBe(6);
    expect(result.twinStats.folded).toBe(6); // 12 twin nodes - 6 surviving rows = 6 folded away
    expect(result.twinStats.medianGapDays).not.toBeNull();
  });

  for (const scope of SCOPES) {
    it(`${scope}: slimRecord keeps every field its ledger row is built from`, async () => {
      const { slimRecord } = await import("../src/server/scanJobs");
      const { reconcile } = await import("../src/domain/reconcile");

      const raw = SAMPLE_RAW_NODES[scope][0]!;
      const slim = slimRecord(scope, raw);
      const scanId = "2026-06-01T08:00:00.000Z";
      const result = reconcile([slim], {}, scanId, scanId, null, { scope });
      expect(Object.values(result.ledger)).toHaveLength(1);
    });
  }
});

/* --------------------------------------------------------- 7: the three-scan battery, in full */

interface Row { [k: string]: unknown }

const tables: Record<string, Row[]> = {};
const drive = { backups: {} as Record<string, unknown>, obs: {} as Record<string, string[]> };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

vi.mock("../src/server/sheetsDb", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/sheetsDb")>();
  const project = (tab: string, row: Row): Row => {
    const out: Row = {};
    for (const h of real.TAB_HEADERS[tab] ?? []) out[h] = h in row ? row[h] : null;
    return out;
  };
  return {
    TABS: real.TABS,
    TAB_HEADERS: real.TAB_HEADERS,
    readAll: (tab: string) => tables[tab] ?? [],
    readTail: (tab: string, n: number) => (tables[tab] ?? []).slice(-n),
    overwrite: (tab: string, rows: Row[]) => { tables[tab] = rows.map((r) => project(tab, r)); },
    appendRows: (tab: string, rows: Row[]) => {
      tables[tab] = [...(tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
    },
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      const row = (tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
      for (const [k, v] of Object.entries(patch)) {
        if ((real.TAB_HEADERS[tab] ?? []).includes(k)) row[k] = v;
      }
      return true;
    },
    dataRowCount: (tab: string) => (tables[tab] ?? []).length,
    trimSurplusRows: () => 0,
  };
});

const props: Record<string, string> = {};

vi.mock("../src/server/props", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/props")>();
  return {
    ...real,
    getProp: (k: string) => props[k] ?? null,
    setProp: (k: string, v: string) => { props[k] = v; },
    deleteProp: (k: string) => { delete props[k]; },
    requireProp: (k: string) => props[k] ?? "",
    hasWizCredentials: () => false,
  };
});

vi.mock("../src/server/archiveStore", () => ({
  writeBackup: (jobId: string, state: unknown) => {
    drive.backups[jobId] = clone(state);
    return `backup-${jobId}`;
  },
  readBackup: (jobId: string) => (jobId in drive.backups ? clone(drive.backups[jobId]) : null),
  trashBackup: (jobId: string) => { delete drive.backups[jobId]; },
  writeLedgerSnapshot: () => {},
  readLedgerSnapshot: () => null,
  writeObservations: (scanId: string, keys: string[]) => {
    drive.obs[scanId] = [...keys];
    return `obs-${scanId}`;
  },
  readObservations: (scanId: string) => drive.obs[scanId] ?? [],
  trashScan: () => {},
}));

describe("the three-scan battery, through ledgerStore.persistSync", () => {
  it("commits scan A, B, C in order and resolves the findings the seed drops between scans", async () => {
    const { slimRecord } = await import("../src/server/scanJobs");
    const ledgerStore = await import("../src/server/ledgerStore");

    let secretsAfterA = -1;
    let sawResolvedSca = 0;
    let sawResolvedSast = 0;
    let sawResolvedSecrets = 0;

    SAMPLE_SYNCS.forEach((sync, i) => {
      const perScope = sync.scopes.map((battery) => ({
        scope: battery.scope as Scope,
        records: battery.rawRecords.map((n) => slimRecord(battery.scope, n)),
        mode: battery.mode,
        scannedSeverities: battery.scannedSeverities,
      }));
      const outcome = ledgerStore.persistSync(`job-${i + 1}`, sync.syncId, perScope);
      expect(new Set(outcome.committed_scopes)).toEqual(new Set(["sca", "sast", "secrets"]));

      for (const scopeOutcome of outcome.scopes) {
        if (scopeOutcome.scope === "secrets" && i === 0) {
          secretsAfterA = Object.values(ledgerStore.loadState().ledger).filter(
            (r) => r.scope === "secrets",
          ).length;
          expect(scopeOutcome.twins?.keys).toBe(6);
          expect(scopeOutcome.twins?.folded).toBe(6);
        }
        sawResolvedSca += scopeOutcome.scope === "sca" ? scopeOutcome.deltas.resolved_count : 0;
        sawResolvedSast += scopeOutcome.scope === "sast" ? scopeOutcome.deltas.resolved_count : 0;
        sawResolvedSecrets += scopeOutcome.scope === "secrets" ? scopeOutcome.deltas.resolved_count : 0;
      }
    });

    // scan A's secrets population folds 120 nodes / 6 twin pairs down to 114 live rows.
    expect(secretsAfterA).toBe(114);
    // sca: EARLY_GONE (50) resolves by disappearance at B, LATE_GONE (40) at C, and
    // API_RESOLVED (30) resolves directly at B — 120 resolutions total across the battery.
    expect(sawResolvedSca).toBe(50 + 40 + 30);
    // sast: GONE_AT_B (8) resolves at B, GONE_AT_C (2) at C.
    expect(sawResolvedSast).toBe(8 + 2);
    // secrets: the 8 seeded drop-after-A findings resolve by disappearance at scan B.
    expect(sawResolvedSecrets).toBe(8);

    expect(tables["scans"]).toHaveLength(9); // 3 syncs x 3 scopes
  });
});
