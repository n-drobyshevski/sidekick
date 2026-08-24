// Phase 6's decisive test: does the posture tier carry information the AARS score does
// not, or is it a rename of the score wearing a 1-4 costume?
//
// Runs a REAL dry-run sync end to end (setup → runSync → the persisted register) rather
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
//
// READS THE MODEL, NOT A PAGE. Both series come from `syncStore.loadAssets()` — where the
// two models actually live — rather than from `getAssets`, which no longer publishes
// either of them: the register ranks by counts and the verdicts reach only the workbench.
// That is the right source for a measurement about the models regardless, and the reason
// this file needed one line changed while nothing about either model moved.

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
  const syncStore = await import("../src/server/syncStore");
  rows = syncStore.loadAssets() as unknown as AssetRow[];
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
  it("scores 23 of the 30 AARS-scored assets under BOTH models — 7 carry no posture tier", () => {
    // MOVED from 30/30. scoreOrdinality.test.ts still pins 30 assets with an AARS
    // severity — AARS is untouched by either change (see this repo's own VERIFY step).
    // What moved is the posture side: `posture.tierEstablished` (Change 2) now withholds
    // a tier from any asset with an unread capability/containment/consequence axis rather
    // than deciding one from a defaulted value, so a real subset of the AARS-scored
    // population now carries `postureTier: null` on purpose — see the per-axis test below
    // for which axis is doing that, and posture.ts's own header for why.
    const aarsScored = rows.filter((r) => r.aarsSeverity != null);
    expect(aarsScored.length).toBe(30);
    const scored = rows.filter((r) => r.aarsSeverity != null && r.postureTier != null);
    expect(scored.length).toBe(23);
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
    // Pinned to what the code actually produces on the seed landscape. MOVED from
    // 0.9139321579354337 (down): the 23-asset population this measures is smaller AND
    // different now (see the population test above) — `businessImpact` being real on the
    // AI-kinded seed (sampleData.ts) moves some assets' consequence axis, and therefore
    // their tier, without moving AARS at all, so the two rankings' agreement over this
    // narrower, differently-arranged population is not the same number as before. NOT
    // ≈1.0 — there is real disagreement between the two rankings — but the point estimate
    // is still high, and the reasons are named in this file's own header note.
    expect(tau).toBeCloseTo(0.856037238519734, 10);
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
    // MOVED from 0.21348314606741572 — same population/consequence-axis reasons as tau-b
    // above. Still "fair" on the Landis & Koch scale (0.21–0.40), which is the finding this
    // test exists to pin — the two models read categories differently even when their
    // point estimate of rank agreement is high — surviving both changes unchanged in KIND.
    expect(kappa).toBeCloseTo(0.35294117647058826, 10);
    // "Only fair" is the finding: a rename of the score would show kappa close to 1 too,
    // the same way tau-b does. It does not. See this file's own header for the reading.
    expect(kappa).toBeLessThan(0.5);
  });
});

describe("tier distribution and cell coverage over the seed landscape", () => {
  it("reports the tier distribution across every synced asset that could be PLACED", () => {
    // RENAMED premise: this no longer covers "every synced asset" — Change 2 means a real
    // node can be synced, enriched, and still carry no postureTier at all when
    // `posture.tierEstablished` refuses to place it (an unread axis). `rows.length` is the
    // WHOLE synced population; `counts`' sum is only the ESTABLISHED subset of it, and the
    // gap between the two IS the finding this test now also asserts, not silently drops.
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let notEstablished = 0;
    for (const r of rows) {
      if (r.postureTier != null) counts[r.postureTier as number]!++;
      else notEstablished++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[postureOrdinality] tier distribution over ${rows.length} synced assets ` +
        `(${notEstablished} not established):`,
      counts,
    );
    expect(counts[1]! + counts[2]! + counts[3]! + counts[4]! + notEstablished).toBe(rows.length);
    // Pinned: the seed landscape's actual shape, MOVED from { 1: 49, 2: 19, 3: 19, 4: 0 }
    // (which used to sum to all 87 synced assets). Two changes compound here:
    //   - `businessImpact` is now real on the seed's AI-kinded nodes (sampleData.ts,
    //     Change 1), so `consequence` reads SEVERE for several of them, which is why tier
    //     4 is no longer zero — the old comment's own explanation for a zero tier 4 was
    //     this exact gap, now closed on that subset.
    //   - the other 61 real nodes (buckets, databases, service accounts, and every other
    //     seed kind Change 1 left without a businessImpact) still have no way to read
    //     `consequence`, and Change 2 now REFUSES to place them rather than default them
    //     to LIMITED — they land in `notEstablished`, not in tier 1.
    expect(counts).toEqual({ 1: 7, 2: 3, 3: 10, 4: 6 });
    expect(notEstablished).toBe(87 - (7 + 3 + 10 + 6));
  });

  it("cells reached under DEFAULT_POSTURE_RULE, of 27", () => {
    expect(cellCoverage(DEFAULT_POSTURE_RULE).total).toBe(27);
  });

  it("the lethal-trifecta row stays reported unreachable on the saved default rule", () => {
    expect(unreachableTierRules(DEFAULT_POSTURE_RULE)).toEqual([0]);
  });
});

describe("per-dimension unknown rates on the seed landscape", () => {
  it("capability and containment are fully observed; consequence is almost entirely unknown", () => {
    const counts = { capability: 0, containment: 0, consequence: 0 };
    let n = 0;
    for (const r of rows) {
      // Straight off the node, like the two series above. `getAssetDetail` used to carry
      // `postureInput`; the sheet publishes no verdict now, and a per-asset round trip was
      // never the right way to read a model anyway.
      const postureInput = (r as { postureInput?: { unknowns?: string[] } }).postureInput;
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
    // there is never an all-unobserved node on this landscape for either axis.
    expect(unknownRate.capability).toBe(0);
    expect(unknownRate.containment).toBe(0);
    // consequence: MOVED from 0.9655172413793104 (down). `NodeSeed` (sampleData.ts) now
    // carries a REAL `businessImpact` on a deliberate, non-uniform subset — the 14 AGENTS
    // (12 of 14; agent-j/agent-k are left unattributed on purpose) plus 6 of the 8 other
    // AI_ASSET_KINDS entries in SUPPORT (guardrail-bedrock and pipeline-training-01 are
    // left unattributed too) — see AGENTS's and SUPPORT's own comments in sampleData.ts
    // for why those specific gaps are load-bearing, not oversights. That closes most, but
    // deliberately not all, of the gap this test used to report: the remaining ~70% is
    // every OTHER real node on the seed (buckets, databases, service accounts, identities,
    // …) that Change 1 left untouched, plus the AI-kinded assets carrying no
    // businessImpact by design. This is a genuine, intentionally-incomplete DEMO
    // landscape, not a defect in `consequenceOf` — a real tenant's Wiz-reported
    // `businessImpact` on every project would close most of what remains.
    expect(unknownRate.consequence).toBeCloseTo(0.7011494252873564, 10);
    expect(unknownRate.consequence).toBeGreaterThan(0.6);
    expect(unknownRate.consequence).toBeLessThan(0.8);
  });
});
