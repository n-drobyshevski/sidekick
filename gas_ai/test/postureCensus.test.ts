// The posture series, and the staleness marker that keeps it honest.
//
// Two claims, and the second is the reason the first exists at all:
//
//   1. A tier count alone is unreadable. An asset can carry no tier because nobody measured it
//      (a coverage gap, actionable) or because the lattice does not describe its kind (not a
//      gap, and nothing to act on). `censusPostureTiers` reports them apart, with the total
//      beside them so every share has its denominator.
//   2. The tri-state normalizer fix legitimately collapses the tiered population — on the
//      reference tenant from essentially every asset to 68 — the first time a sync tells the
//      truth. Without a marker saying WHY, that reads as risk improving. `DERIVATION_VERSION`
//      is that marker, and it is deliberately not a rule version, because the remedies differ:
//      a rule change is repaired by Recompute, this one only by a full sync.

import { describe, expect, it } from "vitest";
import { censusPostureTiers, countPostureTiers } from "../src/domain/posture";
import { DERIVATION_VERSION } from "../src/domain/config";
import {
  derivationIsStale,
  getSyncDerivationVersion,
  withSyncDerivationVersion,
} from "../src/domain/settingsLogic";

type CensusNode = { kind?: string; postureTier?: number; postureInput?: unknown };

/** In scope and decided. */
const tiered = (tier: number): CensusNode => ({ kind: "AI_AGENT", postureTier: tier, postureInput: {} });
/** In scope, tier withheld — the vector survives as the evidence trail for what is missing. */
const withheld = (): CensusNode => ({ kind: "AI_AGENT", postureInput: { unknowns: ["capability"] } });
/** Out of scope — `withPostureTiers` writes no vector at all, which is how the two are told apart. */
const outOfScope = (): CensusNode => ({ kind: "AI_DATASET" });

describe("censusPostureTiers: withheld and out-of-scope are different findings", () => {
  it("separates the two ways an asset can carry no tier", () => {
    const census = censusPostureTiers([
      tiered(4), tiered(2), tiered(2),
      withheld(), withheld(),
      outOfScope(), outOfScope(), outOfScope(), outOfScope(),
    ]);
    expect(census.tiers).toEqual({ 1: 0, 2: 2, 3: 0, 4: 1 });
    expect(census.withheld).toBe(2);
    expect(census.outOfScope).toBe(4);
    expect(census.total).toBe(9);
  });

  it("accounts for every node exactly once — the denominator is real", () => {
    const nodes = [tiered(1), tiered(3), withheld(), outOfScope()];
    const c = censusPostureTiers(nodes);
    const tiered_ = Object.values(c.tiers).reduce((a, b) => a + b, 0);
    expect(tiered_ + c.withheld + c.outOfScope).toBe(c.total);
  });

  it("skips ISSUE and SUMMARY, exactly as withPostureTiers does", () => {
    const c = censusPostureTiers([
      tiered(1),
      { kind: "ISSUE" },
      { kind: "SUMMARY" },
    ]);
    // They were never candidates, so counting them as out-of-scope would inflate the
    // denominator with things the model was never asked about.
    expect(c.total).toBe(1);
    expect(c.outOfScope).toBe(0);
  });

  it("keeps zeros, so a tier nothing reached is visible as the finding it is", () => {
    const c = censusPostureTiers([tiered(2)]);
    expect(c.tiers).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0 });
  });

  it("agrees with countPostureTiers on the tier half", () => {
    const nodes = [tiered(4), tiered(4), tiered(1), withheld(), outOfScope()];
    expect(censusPostureTiers(nodes).tiers).toEqual(countPostureTiers(nodes));
  });
});

describe("DERIVATION_VERSION: a stale normalizer is not a stale rule", () => {
  it("treats an unstamped ledger as STALE, not as current", () => {
    // The opposite default to the three rule-version keys, and deliberately so: a store
    // written before this marker existed was written by an older normalizer by definition,
    // and that is precisely the population the warning needs to reach.
    expect(getSyncDerivationVersion({})).toBe(0);
    expect(derivationIsStale({}, DERIVATION_VERSION)).toBe(true);
  });

  it("clears once a sync stamps the running version", () => {
    const stamped = withSyncDerivationVersion({}, DERIVATION_VERSION);
    expect(getSyncDerivationVersion(stamped)).toBe(DERIVATION_VERSION);
    expect(derivationIsStale(stamped, DERIVATION_VERSION)).toBe(false);
  });

  it("re-raises when the code moves ahead of the ledger", () => {
    const stamped = withSyncDerivationVersion({}, DERIVATION_VERSION);
    expect(derivationIsStale(stamped, DERIVATION_VERSION + 1)).toBe(true);
  });

  it("coerces junk to 0 rather than trusting it", () => {
    for (const junk of ["", "abc", -3, null, undefined, {}]) {
      expect(getSyncDerivationVersion({ last_sync_derivation_version: junk })).toBe(0);
    }
  });

  it("is at least 2 — the tri-state boundary fix bumped it", () => {
    // Pins the bump itself. A future normalizer change that alters what a stored fact MEANS
    // must move this; one that only re-prices must not.
    expect(DERIVATION_VERSION).toBeGreaterThanOrEqual(2);
  });
});
