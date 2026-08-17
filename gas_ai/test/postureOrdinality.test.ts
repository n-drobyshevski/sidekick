// Phase 6's decisive test: does the posture tier carry information the AARS score does
// not, or is it a rename of the score wearing a 1-4 costume?
//
// Runs a REAL dry-run sync end to end (setup → runSync → getAssets/getAssetDetail) rather
// than calling enrichGraphDoc/withPostureTiers in isolation — the same reproduction choice
// apiGolden.test.ts makes, and the more honest one here specifically: `derivePostureInput`'s
// `consequence` axis needs `dataFindingCount`, which only appears on a node after
// `withDataFindingCounts` runs, and that fold happens inside `persistSync`, never inside
// the bare `enrichGraphDoc` reproduction path `scoreOrdinality.test.ts` uses for its own,
// narrower purpose (isolating AARS's own pillar arithmetic from the rest of the sync). A
// posture measurement taken through that narrower path would report every asset's
// consequence axis as unknown and inflate the unknown-rate finding below for a reason that
// has nothing to do with posture as a model — a pipeline gap, not a modelling one.
//
// tau-b measures ordinal rank agreement; kappa (with a DECLARED collapse map, not the raw
// five-band/four-tier scales) measures chance-corrected category agreement. The spec's own
// instruction: do not tune DEFAULT_POSTURE_RULE's cascade to move either number. Every
// figure pinned below is what the code produces, not what would look best.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import { AARS_SEVERITY_ORDER } from "../src/domain/config";
import { bootstrapCI, cohensKappa, kendallTauB } from "../src/domain/rankStats";
import { unreachableTierRules, DEFAULT_POSTURE_RULE, cellCoverage } from "../src/domain/postureRule";

type Server = Awaited<ReturnType<typeof bootServer>>;
type AssetRow = Record<string, unknown> & {
  id: string; aarsSeverity: string | null; postureTier: number | null;
};

let server: Server;
let rows: AssetRow[];

beforeAll(async () => {
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
  const assets = server.api.getAssets({}) as { ok: boolean; data: { rows: AssetRow[] } };
  rows = assets.data.rows;
});

afterEach(() => {
  teardownServer();
});

/** Worst=highest, mirroring Tier's own "4 = worst" convention — CRITICAL → 5 … INFO → 1. */
function aarsOrdinal(sev: string): number {
  return AARS_SEVERITY_ORDER.length - (AARS_SEVERITY_ORDER as readonly string[]).indexOf(sev);
}

/**
 * The DECLARED collapse map Cohen's kappa needs — three shared categories neither scale
 * uses natively, chosen once here rather than left for a caller to invent ad hoc.
 * AARS: {CRITICAL, HIGH} → HIGH, {MEDIUM} → MEDIUM, {LOW, INFO} → LOW.
 * Tier:  {4} → HIGH, {3, 2} → MEDIUM, {1} → LOW.
 * Asymmetric on purpose: AARS's five bands and the lattice's four tiers do not divide the
 * same way, and forcing a symmetric split (e.g. tier 3 alone as "HIGH") would be inventing
 * agreement neither model claims.
 */
const KAPPA_CATEGORIES = ["HIGH", "MEDIUM", "LOW"];
function collapseAars(sev: string): string {
  return sev === "CRITICAL" || sev === "HIGH" ? "HIGH" : sev === "MEDIUM" ? "MEDIUM" : "LOW";
}
function collapseTier(tier: number): string {
  return tier === 4 ? "HIGH" : tier === 1 ? "LOW" : "MEDIUM";
}

describe("posture tier vs. AARS band — the ordinality question", () => {
  it("scores 30 assets under both models — the same population scoreOrdinality.test.ts pins", () => {
    const scored = rows.filter((r) => r.aarsSeverity != null && r.postureTier != null);
    expect(scored.length).toBe(30);
  });

  it("tau-b: high monotonic agreement, but measurably below 1 — logged and reported, not tuned", () => {
    const scored = rows.filter((r) => r.aarsSeverity != null && r.postureTier != null);
    const a = scored.map((r) => aarsOrdinal(r.aarsSeverity!));
    const b = scored.map((r) => r.postureTier!);
    const tau = kendallTauB(a, b);

    const pairs: Array<[number, number]> = scored.map((r, i) => [a[i]!, b[i]!]);
    const ci = bootstrapCI(
      pairs,
      (sample) => kendallTauB(sample.map((p) => p[0]), sample.map((p) => p[1])),
      2000,
      42,
    );

    // eslint-disable-next-line no-console
    console.log(`[postureOrdinality] tau-b (posture tier vs AARS band) = ${tau}, 95% CI [${ci.lo}, ${ci.hi}]`);

    expect(Number.isFinite(tau)).toBe(true);
    expect(tau).toBeGreaterThanOrEqual(-1);
    expect(tau).toBeLessThanOrEqual(1);
    // Pinned to what the code actually produces on the seed estate. NOT ≈1.0 — there is
    // real disagreement between the two rankings — but the point estimate is high, and
    // the reasons are named in this file's own header note and in the module's REPORT.
    expect(tau).toBeCloseTo(0.9139321579354337, 10);
    expect(tau).toBeLessThan(0.999);
  });

  it("kappa: only FAIR chance-corrected category agreement — the number that actually separates the two models", () => {
    const scored = rows.filter((r) => r.aarsSeverity != null && r.postureTier != null);
    const ac = scored.map((r) => collapseAars(r.aarsSeverity!));
    const bc = scored.map((r) => collapseTier(r.postureTier!));
    const kappa = cohensKappa(ac, bc, KAPPA_CATEGORIES);

    const pairs: Array<[string, string]> = scored.map((r, i) => [ac[i]!, bc[i]!]);
    const ci = bootstrapCI(
      pairs,
      (sample) => cohensKappa(sample.map((p) => p[0]), sample.map((p) => p[1]), KAPPA_CATEGORIES),
      2000,
      42,
    );

    // eslint-disable-next-line no-console
    console.log(`[postureOrdinality] kappa (declared collapse) = ${kappa}, 95% CI [${ci.lo}, ${ci.hi}]`);

    expect(Number.isFinite(kappa)).toBe(true);
    expect(kappa).toBeLessThanOrEqual(1);
    expect(kappa).toBeCloseTo(0.21348314606741572, 10);
    // "Only fair" is the finding: a rename of the score would show kappa close to 1 too,
    // the same way tau-b does. It does not. See this file's own header for the reading.
    expect(kappa).toBeLessThan(0.5);
  });
});

describe("tier distribution and cell coverage over the seed estate", () => {
  it("reports the tier distribution across every synced asset, not only the AARS-scored subset", () => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of rows) if (r.postureTier != null) counts[r.postureTier as number]!++;
    // eslint-disable-next-line no-console
    console.log(
      `[postureOrdinality] tier distribution over ${rows.length} synced assets:`,
      counts,
    );
    expect(counts[1]! + counts[2]! + counts[3]! + counts[4]!).toBe(rows.length);
    // Pinned: the seed estate's actual shape. Tier 4 sits at zero here — the lattice
    // PERMITS it (1/27 cells under DEFAULT_POSTURE_RULE), but no synced asset happens to
    // combine BROAD capability, WEAK containment and SEVERE consequence at once, mostly
    // because `businessImpact` is never populated on a seed GNode (see the unknown-rate
    // case below), which keeps `consequence` at its LIMITED default almost everywhere.
    expect(counts).toEqual({ 1: 49, 2: 19, 3: 19, 4: 0 });
  });

  it("cells reached under DEFAULT_POSTURE_RULE, of 27", () => {
    expect(cellCoverage(DEFAULT_POSTURE_RULE).total).toBe(27);
  });

  it("the lethal-trifecta row stays reported unreachable on the saved default rule", () => {
    expect(unreachableTierRules(DEFAULT_POSTURE_RULE)).toEqual([0]);
  });
});

describe("per-dimension unknown rates on the seed estate", () => {
  it("capability and containment are fully observed; consequence is almost entirely unknown", () => {
    const counts = { capability: 0, containment: 0, consequence: 0 };
    let n = 0;
    for (const r of rows) {
      const detail = server.api.getAssetDetail({ id: r.id }) as { ok: boolean; data: { node: { postureInput?: { unknowns?: string[] } } } | null };
      const postureInput = detail.data?.node?.postureInput;
      // Present-but-`unknowns`-omitted means "this asset, every axis observed" — see
      // graphEnrich.withPostureTiers's own comment on why an empty `unknowns` array is
      // dropped rather than stored. That is a real zero, not a skip.
      if (!postureInput) continue;
      n++;
      for (const u of postureInput.unknowns ?? []) if (u in counts) (counts as Record<string, number>)[u]!++;
    }
    const rate = (c: number) => (n ? c / n : 0);
    const unknownRate = {
      capability: rate(counts.capability),
      containment: rate(counts.containment),
      consequence: rate(counts.consequence),
    };
    // eslint-disable-next-line no-console
    console.log(`[postureOrdinality] per-axis unknown rate over ${n} synced assets:`, unknownRate);

    // capability / containment: sampleData.ts's `node()` builder defaults every one of
    // hasAdminPrivileges / hasHighPrivileges / hasAccessToSensitiveData / guardrailMissing
    // to `false` rather than leaving them unset (see that function's own comment), so
    // there is never an all-unobserved node on this estate for either axis.
    expect(unknownRate.capability).toBe(0);
    expect(unknownRate.containment).toBe(0);
    // consequence: `NodeSeed` (sampleData.ts) carries no `businessImpact` field at all, and
    // `enrichGraphDoc`'s fold only ever POPULATES `node.businessImpact` from
    // `projects[].businessImpact` — which no seed project carries either — so it is
    // undefined on literally every seed asset. The few points of daylight below the 100%
    // ceiling are the handful of datastores `withDataFindingCounts` actually gave a real
    // `dataFindingCount` to from `SEED_DATA_FINDINGS`. This is a genuine gap in the DEMO
    // estate, not a defect in `consequenceOf` — a real tenant's Wiz-reported
    // `businessImpact` would close almost all of it.
    expect(unknownRate.consequence).toBeCloseTo(0.9655172413793104, 10);
    expect(unknownRate.consequence).toBeGreaterThan(0.9);
  });
});
