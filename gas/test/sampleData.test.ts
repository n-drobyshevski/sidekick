// The dev-harness seed's cold-zone coverage (WP6): dev/sampleData.dev.ts adds four assets
// outside the seeded ASSETS pool so domain/coldZone.ts has something real to show locally —
// measured `cold`, `warm`/`watching` past the floor, the `(no support group)` row, and
// `unobserved`. This file pins the facts the dev harness depends on, not a fixture snapshot:
// nobody reads dev/ in production, but a broken dev seed is a broken "does this even work"
// loop for whoever opens `npm run dev` next.

import { describe, expect, it } from "vitest";
import {
  COLD_ASSET,
  NO_GROUP_ASSET,
  SAMPLE_FLAT,
  SLOW_ASSET,
  UNOBSERVED_ASSET,
  VANISHING_IDS,
} from "../dev/sampleData.dev";

type Rec = Record<string, any>;

const NOW = Date.now();
const DAY = 86_400_000;

function nodesOf(assetId: string): Rec[] {
  return (SAMPLE_FLAT.data.vulnerabilityFindings.nodes as Rec[]).filter(
    (n) => (n["vulnerableAsset"] as Rec)?.["id"] === assetId,
  );
}

// The exact fold dev/boot.js seeds into the settings sheet (seedSupportGroups()) — duplicated
// here rather than imported, since boot.js is a plain script with no module graph. Keeping the
// two in sync is exactly what "the unmapped-subscription asset exists" below is for: it fails
// the moment either side drifts and nobody notices they no longer disagree.
const SUPPORT_GROUP_MAP_KEYS = new Set([
  "prod-account", "dev-account", "core-prod", "core-staging", "inix-tt4k", "enms-pr",
]);

describe("cold zone dev seed: COLD_ASSET (measured cold)", () => {
  const rows = nodesOf(COLD_ASSET.id);

  it("carries three rows: two OPEN and one RESOLVED", () => {
    expect(rows).toHaveLength(3);
    const open = rows.filter((r) => r["status"] === "OPEN");
    const resolved = rows.filter((r) => r["status"] === "RESOLVED");
    expect(open).toHaveLength(2);
    expect(resolved).toHaveLength(1);
    for (const r of open) expect(r["resolvedAt"]).toBeNull();
  });

  it("the resolved row is dated at least 90 days before NOW, and after its own first-seen", () => {
    const resolved = rows.find((r) => r["status"] === "RESOLVED")!;
    const resolvedMs = Date.parse(resolved["resolvedAt"] as string);
    const firstMs = Date.parse(resolved["firstDetectedAt"] as string);
    expect(NOW - resolvedMs).toBeGreaterThanOrEqual(90 * DAY);
    expect(resolvedMs).toBeGreaterThan(firstMs);
  });

  it("resolves to a real Support Group (subscription is in the seeded map)", () => {
    expect(SUPPORT_GROUP_MAP_KEYS.has(COLD_ASSET.sub.toLowerCase())).toBe(true);
  });

  it("carries a Wiz/Domain tag", () => {
    expect(COLD_ASSET.tags["Wiz/Domain"]).toBeTruthy();
  });
});

describe("cold zone dev seed: SLOW_ASSET (idle past the floor, short of the window)", () => {
  const rows = nodesOf(SLOW_ASSET.id);

  it("carries a resolved row idle less than the 90-day default window but past the 14-day floor", () => {
    const resolved = rows.find((r) => r["status"] === "RESOLVED")!;
    const idleDays = (NOW - Date.parse(resolved["resolvedAt"] as string)) / DAY;
    expect(idleDays).toBeGreaterThan(14);
    expect(idleDays).toBeLessThan(90);
  });

  it("resolves to a real Support Group", () => {
    expect(SUPPORT_GROUP_MAP_KEYS.has(SLOW_ASSET.sub.toLowerCase())).toBe(true);
  });
});

describe("cold zone dev seed: NO_GROUP_ASSET (the `(no support group)` row)", () => {
  it("exists, with open rows, on a subscription the support-group map does not name", () => {
    const rows = nodesOf(NO_GROUP_ASSET.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r["status"]).toBe("OPEN");
    expect(SUPPORT_GROUP_MAP_KEYS.has(NO_GROUP_ASSET.sub.toLowerCase())).toBe(false);
  });
});

describe("cold zone dev seed: UNOBSERVED_ASSET (drops out of coverage entirely)", () => {
  it("has three rows, all pinned ids, and all of them are in VANISHING_IDS", () => {
    const rows = nodesOf(UNOBSERVED_ASSET.id);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(VANISHING_IDS).toContain(r["id"]);
  });

  it("has no row outside VANISHING — every id withheld together drops the whole asset", () => {
    const withheld = new Set(VANISHING_IDS);
    const rows = nodesOf(UNOBSERVED_ASSET.id);
    expect(rows.every((r) => withheld.has(r["id"] as string))).toBe(true);
  });

  it("carries a Wiz/Domain tag and resolves to a real Support Group", () => {
    expect(UNOBSERVED_ASSET.tags["Wiz/Domain"]).toBeTruthy();
    expect(SUPPORT_GROUP_MAP_KEYS.has(UNOBSERVED_ASSET.sub.toLowerCase())).toBe(true);
  });
});

// The one behaviour this whole seed leans on: does `reconcile` really take the API-declared
// resolution for a row that arrives ALREADY RESOLVED, on the very first scan that ever sees
// it? (reconcile.ts:411-417, "API-declared resolution closes a currently-open row" — reached
// from a BRAND-NEW row because `makeRow` always starts a fresh row OPEN, and this check runs
// unconditionally after the new/reopen/persist branch.) If this were false, COLD_ASSET's
// resolved row would sit OPEN in the ledger forever and there would be nothing to measure.
describe("the pipeline: a pinned row that arrives RESOLVED lands in the ledger resolved", () => {
  it("reconcile takes the API resolution on first sight, dated by the record, not the scan", async () => {
    const { reconcile } = await import("../src/domain/reconcile");
    const { slimRecord } = await import("../src/server/scanJobs");

    const raw = nodesOf(COLD_ASSET.id).find((r) => r["status"] === "RESOLVED")!;
    const scanTs = new Date(NOW).toISOString();
    const slim = slimRecord(raw) as Rec;
    const result = reconcile([slim], {}, scanTs, scanTs, null);

    const rows = Object.values(result.ledger);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("RESOLVED");
    expect(row.resolution_src).toBe("api");
    // Dated by the record's own resolvedAt (~150 days back), NOT by scanTs (~now) — the whole
    // reason this seed uses an API resolution instead of relying on disappearance.
    expect(row.resolved_at).toBe(raw["resolvedAt"]);
    expect(NOW - Date.parse(row.resolved_at as string)).toBeGreaterThanOrEqual(90 * DAY);
  });

  it("a still-resolved row re-listed on a later scan keeps its original resolved_at", async () => {
    const { reconcile } = await import("../src/domain/reconcile");
    const { slimRecord } = await import("../src/server/scanJobs");

    const raw = nodesOf(COLD_ASSET.id).find((r) => r["status"] === "RESOLVED")!;
    const scanTs1 = new Date(NOW - 2 * DAY).toISOString();
    const slim = slimRecord(raw) as Rec;
    const first = reconcile([slim], {}, scanTs1, scanTs1, null);

    const scanTs2 = new Date(NOW).toISOString();
    const second = reconcile([slim], first.ledger, scanTs2, scanTs2, "scan-1");

    const row = Object.values(second.ledger)[0]!;
    expect(row.status).toBe("RESOLVED");
    expect(row.resolved_at).toBe(raw["resolvedAt"]);
    // last_seen tracks the newest scan even though the movement date does not — this is what
    // keeps the asset `observed` on every seeded scan. (reconcile normalizes to whole-second
    // ISO, same as dev/sampleData.dev.ts's own `iso()` helper, so compare by parsed instant.)
    expect(Date.parse(row.last_seen as string)).toBe(Math.floor(Date.parse(scanTs2) / 1000) * 1000);
  });
});
