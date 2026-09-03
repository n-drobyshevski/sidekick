// Actionable-clock derivations in baseRows/withDerived (ledgerCore.ts) — the port of
// gas/test/actionableClock.test.ts, plus the per-scope rule gas/ has no equivalent for.
//
// The question the second clock asks is "how long was this fixable and not fixed", and the
// answer to "when did it become fixable" is not the same in the three registers:
//   sca              when the vendor shipped a fix (fix_date, else fix_observed_at). A row
//                    with neither is awaiting_vendor_fix and drops out of the clock.
//   sast / secrets   at detection. There is no vendor: a weakness in our own code and a leaked
//                    credential are both fixed by us, on the day they are found.
//
// TWO gas/ TESTS ARE NOT PORTED, AND THE CLAIM THEY ENCODED IS NAMED HERE.
// gas/'s "legacy resolved" and "legacy open" cases assert that a row first seen before
// REMEDIATION_ROLLOUT_ISO ("2026-07-01T00:00:00Z") has fix_available_at == first_seen and is
// never awaiting. THE CLAIM: "rows first seen before the broadened-ingestion rollout had a fix
// by construction, because the old filter only ingested findings that already had one"
// (gas/src/domain/config.ts:85-89). WHAT FALSIFIES IT HERE: that is a statement about ONE
// deployment's migration history, and this register has no such history — gas_devsecops is
// fresh, has never run a hasFix-only filter, and has no row predating its own first scan.
// There is no REMEDIATION_ROLLOUT_ISO in src/domain/config.ts and rule 3 of the D3 brief says
// there must not be one. So the two cases are replaced below by their opposites, at the same
// dates, asserting that an early sca row with no fix columns is awaiting like any other —
// which is what a fresh register can honestly say about it.

import { describe, expect, it } from "vitest";
import { baseRows, emptyState } from "../src/domain/ledgerCore";
import { emptyRiskSignals } from "../src/domain/reconcile";
import type { EpisodeRow, LedgerRow, LedgerState, Scope } from "../src/domain/ledgerTypes";

const NOW = Date.parse("2026-07-25T00:00:00Z");

function row(over: Partial<LedgerRow>): LedgerRow {
  return {
    finding_key: "sca:id:x", scope: "sca", identifier: "CVE-2026-1", component: null,
    severity: "HIGH",
    repo_id: null, repo_name: null, branch: null, platform: null,
    first_seen: null, last_seen: null, status: "OPEN", resolved_at: null,
    resolution_src: null, reopened_count: 0, first_scan_id: null, last_scan_id: null,
    fix_date: null, fix_observed_at: null, fixed_version: null,
    ...emptyRiskSignals(),
    cwe: null, ai_verdict: null, language: null, file_path: null, start_line: null,
    origin: null, secret_kind: null, rotated_at: null, removed_at: null,
    validation_state: null, validated_at: null, confidence: null,
    owner_project: null, owner_path: null, tags_json: null, projects_json: null,
    ...over,
  };
}

/** Derive one row. `scope` defaults to sca; the key is kept in step with it. */
function derive(over: Partial<LedgerRow>, scope: Scope = "sca") {
  const state: LedgerState = emptyState();
  const key = `${scope}:id:x`;
  state.ledger[key] = row({ ...over, scope, finding_key: key });
  return baseRows(state, { now: NOW })[0]!;
}

describe("withDerived actionable clock (sca)", () => {
  /**
   * gas/'s "legacy resolved", inverted. Same dates; no rollout exemption exists here, so a
   * resolved sca row with no fix columns has no actionable clock at all. The DETECTION clock
   * still measures it: 2026-05-01 -> 2026-05-10 is 9 days.
   */
  it("resolved with no fix columns: detection clock only, no actionable clock", () => {
    const d = derive({
      first_seen: "2026-05-01T00:00:00Z",
      status: "RESOLVED",
      resolved_at: "2026-05-10T00:00:00Z",
    });
    expect(d.mttr_days).toBeCloseTo(9, 6);
    expect(d.fix_available_at).toBeNull();
    expect(d.actionable_from).toBeNull();
    expect(d.mttr_actionable_days).toBeNull();
    expect(d.actionable_age_days).toBeNull();
    // Not open, so not awaiting anything — it was fixed, we just cannot date the fix.
    expect(d.awaiting_vendor_fix).toBe(false);
  });

  /** gas/'s "legacy open", inverted for the same reason. 2026-06-01 -> 2026-07-25 is 54 days. */
  it("open with no fix columns, first seen early: awaiting, and only the age clock runs", () => {
    const d = derive({ first_seen: "2026-06-01T00:00:00Z", status: "OPEN" });
    expect(d.age_days).toBeCloseTo(54, 6);
    expect(d.fix_available_at).toBeNull();
    expect(d.actionable_from).toBeNull();
    expect(d.actionable_age_days).toBeNull();
    expect(d.mttr_actionable_days).toBeNull();
    expect(d.awaiting_vendor_fix).toBe(true);
  });

  it("awaiting: no fix available -> null actionable fields, flagged awaiting", () => {
    const d = derive({ first_seen: "2026-07-10T00:00:00Z", status: "OPEN" });
    expect(d.fix_available_at).toBeNull();
    expect(d.actionable_from).toBeNull();
    expect(d.mttr_actionable_days).toBeNull();
    expect(d.actionable_age_days).toBeNull();
    expect(d.awaiting_vendor_fix).toBe(true);
  });

  it("late-fix clamp: fix appears after detection -> clock starts at the fix", () => {
    const d = derive({
      first_seen: "2026-07-05T00:00:00Z",
      status: "RESOLVED",
      resolved_at: "2026-07-20T00:00:00Z",
      fix_date: "2026-07-12T00:00:00Z",
      fix_observed_at: "2026-07-11T00:00:00Z",
    });
    expect(d.fix_available_at).toBe("2026-07-12T00:00:00Z"); // fix_date wins over observed
    expect(d.actionable_from).toBe("2026-07-12T00:00:00Z");
    expect(d.mttr_days).toBeCloseTo(15, 6); // 07-05 -> 07-20
    expect(d.mttr_actionable_days).toBeCloseTo(8, 6); // 07-12 -> 07-20
    expect(d.awaiting_vendor_fix).toBe(false);
  });

  it("fix-before-detection clamp: clock never starts before first_seen", () => {
    const d = derive({
      first_seen: "2026-07-10T00:00:00Z",
      status: "RESOLVED",
      resolved_at: "2026-07-15T00:00:00Z",
      fix_date: "2026-07-02T00:00:00Z", // fix predates our detection
    });
    expect(d.fix_available_at).toBe("2026-07-02T00:00:00Z");
    expect(d.actionable_from).toBe("2026-07-10T00:00:00Z"); // clamped to detection
    expect(d.mttr_actionable_days).toBeCloseTo(5, 6); // 07-10 -> 07-15
    expect(d.mttr_days).toBeCloseTo(5, 6); // same, since the clamp landed on first_seen
  });

  it("a row whose fix was only observed (fixedVersion, no fixDate)", () => {
    const d = derive({
      first_seen: "2026-07-05T00:00:00Z",
      status: "OPEN",
      fix_observed_at: "2026-07-09T00:00:00Z",
    });
    expect(d.fix_available_at).toBe("2026-07-09T00:00:00Z");
    expect(d.actionable_from).toBe("2026-07-09T00:00:00Z"); // max(07-05, 07-09)
    expect(d.awaiting_vendor_fix).toBe(false);
    expect(d.age_days).toBeCloseTo(20, 6); // 07-05 -> 07-25
    expect(d.actionable_age_days).toBeCloseTo(16, 6); // 07-09 -> 07-25
  });
});

// --------------------------------------------------------------------------- #
//  The per-scope rule
// --------------------------------------------------------------------------- #

/**
 * THE THREE SCOPES, side by side on the same dates, which is the only way the rule reads as
 * one statement rather than three coincidences. first_seen 2026-07-05, resolved 2026-07-20:
 * 15 days of detection clock, and no fix columns on any of them (they are sca-only columns).
 */
describe("the fix clock is per scope", () => {
  const dates = {
    first_seen: "2026-07-05T00:00:00Z",
    status: "RESOLVED",
    resolved_at: "2026-07-20T00:00:00Z",
  } as const;

  it("sca with no fix: fix_available_at is null and there is no actionable clock", () => {
    const d = derive(dates, "sca");
    expect(d.mttr_days).toBeCloseTo(15, 6);
    expect(d.fix_available_at).toBeNull();
    expect(d.mttr_actionable_days).toBeNull();
  });

  for (const scope of ["sast", "secrets"] as const) {
    it(`${scope}: fix_available_at is first_seen, so the two clocks coincide`, () => {
      const d = derive(dates, scope);
      expect(d.fix_available_at).toBe("2026-07-05T00:00:00Z");
      expect(d.actionable_from).toBe("2026-07-05T00:00:00Z");
      expect(d.mttr_days).toBeCloseTo(15, 6);
      expect(d.mttr_actionable_days).toBe(d.mttr_days);
      expect(d.awaiting_vendor_fix).toBe(false);
    });

    it(`${scope} open: the age clocks coincide and it is never awaiting a vendor`, () => {
      const d = derive({ first_seen: "2026-07-05T00:00:00Z", status: "OPEN" }, scope);
      expect(d.fix_available_at).toBe("2026-07-05T00:00:00Z");
      expect(d.age_days).toBeCloseTo(20, 6); // 07-05 -> 07-25
      expect(d.actionable_age_days).toBe(d.age_days);
      expect(d.awaiting_vendor_fix).toBe(false);
    });

    /**
     * The degenerate row: no first_seen at all. reconcile always writes one (it falls back to
     * the scan ts), so this can only arrive from a hand-built or corrupt row — but the flag
     * still must not claim a vendor. Nothing is measurable, which is a different and true
     * statement about the row.
     */
    it(`${scope} with no first_seen: unmeasurable, and still not awaiting a vendor`, () => {
      const d = derive({ first_seen: null, status: "OPEN" }, scope);
      expect(d.fix_available_at).toBeNull();
      expect(d.actionable_from).toBeNull();
      expect(d.age_days).toBeNull();
      expect(d.actionable_age_days).toBeNull();
      expect(d.awaiting_vendor_fix).toBe(false);
    });
  }

  /**
   * sast and secrets rows CAN carry fix_date — nothing stops a sheet holding one — and the
   * rule has to ignore it, or the register would start dating a vendor fix that does not
   * exist. The clock stays on first_seen.
   */
  it("a stray fix_date on a non-sca row does not move its clock", () => {
    const d = derive({ ...dates, fix_date: "2026-07-12T00:00:00Z" }, "sast");
    expect(d.fix_available_at).toBe("2026-07-05T00:00:00Z");
    expect(d.mttr_actionable_days).toBeCloseTo(15, 6); // NOT 8
  });
});

// --------------------------------------------------------------------------- #
//  Episodes
// --------------------------------------------------------------------------- #

function episode(over: Partial<EpisodeRow> & Pick<EpisodeRow, "finding_key" | "scope">): EpisodeRow {
  return {
    identifier: null, component: null, severity: "HIGH", first_seen: null, resolved_at: null,
    resolution_src: "api", reopened_count: 0, compaction_id: "cmp",
    superseded_by_scan: null, fix_date: null, fix_observed_at: null,
    has_kev: null, has_exploit: null, epss: null, cwe: null, language: null,
    owner_project: null,
    ...over,
  };
}

describe("rehydrated episodes", () => {
  it("a sca episode carries fix_date/fix_observed_at into the derivation", () => {
    const state: LedgerState = emptyState();
    state.episodes.push(episode({
      finding_key: "sca:id:ep", scope: "sca", identifier: "CVE-2026-9",
      first_seen: "2026-07-04T00:00:00Z", resolved_at: "2026-07-18T00:00:00Z",
      fix_date: "2026-07-10T00:00:00Z", fix_observed_at: "2026-07-08T00:00:00Z",
    }));
    const d = baseRows(state, { now: NOW }).find((r) => r.finding_key === "sca:id:ep")!;
    expect(d.fix_available_at).toBe("2026-07-10T00:00:00Z"); // fix_date wins
    expect(d.actionable_from).toBe("2026-07-10T00:00:00Z");
    expect(d.mttr_days).toBeCloseTo(14, 6); // 07-04 -> 07-18
    expect(d.mttr_actionable_days).toBeCloseTo(8, 6); // 07-10 -> 07-18
    expect(d.awaiting_vendor_fix).toBe(false);
  });

  it("a secrets episode's clocks coincide, whatever compaction carried", () => {
    const state: LedgerState = emptyState();
    state.episodes.push(episode({
      finding_key: "secrets:h:ep", scope: "secrets",
      first_seen: "2026-07-04T00:00:00Z", resolved_at: "2026-07-18T00:00:00Z",
      // Carried, but sca-only by meaning: the derivation must not read it here.
      fix_date: "2026-07-10T00:00:00Z",
    }));
    const d = baseRows(state, { now: NOW }).find((r) => r.finding_key === "secrets:h:ep")!;
    expect(d.fix_available_at).toBe("2026-07-04T00:00:00Z");
    expect(d.mttr_days).toBeCloseTo(14, 6);
    expect(d.mttr_actionable_days).toBe(d.mttr_days);
    expect(d.awaiting_vendor_fix).toBe(false);
  });
});
