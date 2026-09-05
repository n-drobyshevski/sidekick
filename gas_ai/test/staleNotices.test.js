// Which staleness notices the inventory header carries, and — the part worth pinning — which
// remedy each one names. Same shape as actionView.test.js: the page's logic is tested here,
// the page's pixels are checked in the dev harness.

import { describe, expect, it } from "vitest";
import { staleNotices } from "../src/client/js/staleness.js";

const FRESH = { aarsRule: { stale: false }, derivation: { stale: false, remedy: "sync" } };

describe("staleNotices", () => {
  it("says nothing when the register is current", () => {
    expect(staleNotices(FRESH)).toEqual([]);
  });

  it("renders the derivation notice, and names a SYNC as its remedy", () => {
    // The whole point of the second flag. Recompute cannot repair a fact whose original
    // reading was destroyed at ingest, so a banner pointing at Recompute would be worse
    // than no banner — see api.ts where `derivation.remedy` is set.
    const [notice] = staleNotices({ ...FRESH, derivation: { stale: true, remedy: "sync" } });
    expect(notice.id).toBe("derivation");
    expect(notice.href).toBe("#/scans");
    expect(notice.link).toBe("Open Wiz Scans");
    expect(notice.text).toMatch(/only a full sync can/);
    expect(notice.text).toMatch(/Recompute cannot/);
  });

  it("still renders the rule notice, which Recompute DOES fix", () => {
    const [notice] = staleNotices({ ...FRESH, aarsRule: { stale: true } });
    expect(notice.id).toBe("aarsRule");
    expect(notice.href).toBe("#/aars");
  });

  it("puts derivation FIRST when both are stale — an operator who reads one line reads that one", () => {
    const both = staleNotices({ aarsRule: { stale: true }, derivation: { stale: true, remedy: "sync" } });
    expect(both.map((n) => n.id)).toEqual(["derivation", "aarsRule"]);
  });

  it("falls back to sync for an unknown remedy rather than dropping the warning", () => {
    // A remedy this client does not know about is a server that moved ahead of it. Losing
    // the warning entirely is the one outcome worse than naming a slightly wrong button.
    const [notice] = staleNotices({ ...FRESH, derivation: { stale: true, remedy: "teleport" } });
    expect(notice.href).toBe("#/scans");
  });

  it("renders a scope-drift notice, naming BOTH scopes", () => {
    // A third kind: the stored figures are not damaged, they count a different POPULATION
    // than the settings now select. Only a sync reconciles the two, so it takes the sync
    // remedy — but the sentence has to print both sides, because "the register moved" is
    // useless without saying from what to what.
    const [notice] = staleNotices({
      ...FRESH,
      registerScope: {
        kind: "registerScope",
        persisted: "wct-id-1998",
        current: "wct-id-1998|wct-id-3",
        remedy: "sync",
      },
    });
    expect(notice.id).toBe("registerScope");
    expect(notice.href).toBe("#/scans");
    expect(notice.text).toContain("wct-id-1998|wct-id-3");
    expect(notice.text).toMatch(/until the next sync/);
  });

  it("says nothing when the persisted scope matches the selected one", () => {
    // The server sends null when they agree, when nothing has ever been synced, and when
    // the history row predates the column — an absent stamp is unknown, not a mismatch.
    expect(staleNotices({ ...FRESH, registerScope: null })).toEqual([]);
    expect(staleNotices({ ...FRESH })).toEqual([]);
  });

  it("orders the three notices worst-remedy first", () => {
    const all = staleNotices({
      aarsRule: { stale: true },
      derivation: { stale: true, remedy: "sync" },
      registerScope: { kind: "registerScope", persisted: "a", current: "b", remedy: "sync" },
    });
    expect(all.map((n) => n.id)).toEqual(["derivation", "registerScope", "aarsRule"]);
  });

  it("survives a bootstrap that carries neither block", () => {
    expect(staleNotices({})).toEqual([]);
    expect(staleNotices(null)).toEqual([]);
  });
});
