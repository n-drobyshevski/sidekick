// The ledger core: three scopes in one table, and the disappearance guard that keeps them
// from resolving each other.
//
// The behaviours below are the ones brick/devsecops/tests/test_ledger.py names — that suite
// is the behavioural spec for this port, the same relationship gas/ has to
// wiz_dashboard/domain/. Where a test here reads like one there, that is on purpose.
//
// The three-scope cases have no counterpart in either source. gas/ has one register; brick's
// reconcile takes a `scope` but only stamps it on the row, because its caller hands it a
// prior already filtered down. Here the prior is one tab holding all three, and the failure
// mode is not subtle: a SAST-only scan that forgot to filter resolves 19,949 findings.

import { describe, expect, it } from "vitest";
import { reconcile } from "../src/domain/reconcile";
import {
  baseRows, latestScan, parseSeverities, prevScanIdBySeverity, scansAsc,
} from "../src/domain/ledgerCore";
import { emptyObservation } from "../src/domain/observation";

const T1 = "2026-01-01T00:00:00Z";
const T2 = "2026-01-08T00:00:00Z";
const T3 = "2026-01-15T00:00:00Z";

/** One observation. `scope` first because it is what every case here turns on. */
function obs(scope, key, over = {}) {
  return { ...emptyObservation(scope, `${scope}:${key}`), severity: "CRITICAL", ...over };
}

/** Run one scan and return the ledger keyed by finding_key. */
function scan(observations, prior, scope, scanId, scanTs, prevScanId, options) {
  return reconcile(observations, prior, scope, scanId, scanTs, prevScanId, options);
}

/** A ledger holding all three registers, every row OPEN and last seen in scan `s1`. */
function threeScopeLedger() {
  let ledger = {};
  ledger = scan([obs("sca", "cve-a"), obs("sca", "cve-b")], ledger, "sca", "s1", T1, null,
    { scannedSeverities: ["CRITICAL", "HIGH"] }).ledger;
  ledger = scan([obs("sast", "rule-a")], ledger, "sast", "s1", T1, null,
    { scannedSeverities: ["CRITICAL", "HIGH"] }).ledger;
  ledger = scan([obs("secrets", "sec-a")], ledger, "secrets", "s1", T1, null,
    { scannedSeverities: null }).ledger;
  return ledger;
}

describe("three scopes, one ledger", () => {
  it("a SAST scan does not resolve SCA or secrets rows", () => {
    // THE TEST THIS WHOLE MODULE EXISTS FOR. Every SCA and secrets row is absent from a SAST
    // scan by construction, so a disappearance pass that did not filter by scope would
    // resolve all of them — 19,949 findings marked remediated in one sync, against a live
    // register of 17,991 + 127 + 1,958.
    //
    // Asserted on the FULL LEDGER rather than on the returned delta: `resolved_count` would
    // read 0 either way if the bug were in what got written, and a delta that agrees with a
    // wrong ledger is exactly the kind of green test that ships a defect.
    const prior = threeScopeLedger();
    const after = scan([obs("sast", "rule-a")], prior, "sast", "s2", T2, "s1",
      { scannedSeverities: ["CRITICAL", "HIGH"] }).ledger;

    const foreign = Object.values(after).filter((r) => r.scope !== "sast");
    expect(foreign).toHaveLength(3);
    for (const row of foreign) {
      expect(row.status).toBe("OPEN");
      expect(row.resolved_at).toBeNull();
      expect(row.last_scan_id).toBe("s1"); // untouched, not merely un-resolved
    }
  });

  it("resolves this scope's own row that vanished", () => {
    // The other half: the guard must not be so wide that nothing ever resolves.
    const prior = threeScopeLedger();
    const r = scan([obs("sca", "cve-a")], prior, "sca", "s2", T2, "s1",
      { scannedSeverities: ["CRITICAL", "HIGH"] });
    expect(r.ledger["sca:cve-b"].status).toBe("RESOLVED");
    expect(r.ledger["sca:cve-b"].resolution_src).toBe("disappeared");
    expect(r.ledger["sca:cve-b"].resolved_at).toBe(T2);
    expect(r.deltas.resolved_count).toBe(1);
  });

  it("the first scan of a scope resolves nothing, however many other scopes ran", () => {
    // Per SCOPE, not per register. `prevScanId` comes from latestScan(scans, scope), which
    // is null the first time SAST runs even with fifty SCA scans behind it.
    let ledger = scan([obs("sast", "rule-a"), obs("sast", "rule-b")], {}, "sast", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a")], ledger, "sca", "s2", T2, null).ledger;
    const r = scan([obs("secrets", "sec-a")], ledger, "secrets", "s3", T3, null);
    expect(Object.values(r.ledger).every((row) => row.status === "OPEN")).toBe(true);
    expect(r.deltas.resolved_count).toBe(0);
  });

  it("refuses an observation carrying the wrong scope", () => {
    // A normalizer emitting the wrong scope would write rows the disappearance pass then
    // refuses to consider — a half-updated register, and silent.
    expect(() => scan([obs("sca", "cve-a")], {}, "sast", "s1", T1, null))
      .toThrow(/carries scope sca/);
  });

  it("marks removed_at on secrets only, and never touches rotated_at", () => {
    // Removed is not rotated: a secret leaving the register means the string left HEAD. The
    // credential is live until rotated_at says otherwise.
    const prior = threeScopeLedger();
    const r = scan([], prior, "secrets", "s2", T2, "s1", { scannedSeverities: null });
    expect(r.ledger["secrets:sec-a"].removed_at).toBe(T2);
    expect(r.ledger["secrets:sec-a"].rotated_at).toBeNull();

    const sca = scan([], prior, "sca", "s2", T2, "s1", { scannedSeverities: ["CRITICAL", "HIGH"] });
    expect(sca.ledger["sca:cve-a"].status).toBe("RESOLVED");
    expect(sca.ledger["sca:cve-a"].removed_at).toBeNull();
  });
});

describe("the lifecycle", () => {
  it("a first sighting opens a lifecycle", () => {
    const r = scan([obs("sca", "cve-a", { first_seen: "2025-12-20T00:00:00Z" })], {}, "sca", "s1", T1, null);
    const row = r.ledger["sca:cve-a"];
    expect(row.status).toBe("OPEN");
    expect(row.first_seen).toBe("2025-12-20T00:00:00Z");
    expect(row.first_scan_id).toBe("s1");
    expect(r.deltas.new_count).toBe(1);
  });

  it("dates a finding the API will not date at the scan that found it", () => {
    // The scan time is a ceiling on the age, not an invention: this finding is at most as
    // old as the scan that first saw it.
    const r = scan([obs("sast", "rule-a", { first_seen: null })], {}, "sast", "s1", T1, null);
    expect(r.ledger["sast:rule-a"].first_seen).toBe(T1);
  });

  it("first_seen never drifts later", () => {
    // The API learning an earlier date is new information; it forgetting one is not.
    let ledger = scan([obs("sca", "cve-a", { first_seen: "2025-12-20T00:00:00Z" })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { first_seen: "2026-06-01T00:00:00Z" })], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].first_seen).toBe("2025-12-20T00:00:00Z");
  });

  it("first_seen moves earlier when the API learns more", () => {
    let ledger = scan([obs("sca", "cve-a", { first_seen: null })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { first_seen: "2025-11-01T00:00:00Z" })], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].first_seen).toBe("2025-11-01T00:00:00Z");
  });

  it("an API resolution closes the row and dates it from the API", () => {
    let ledger = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null).ledger;
    const r = scan(
      [obs("sca", "cve-a", { is_open: false, resolved_at: "2026-01-05T00:00:00Z" })],
      ledger, "sca", "s2", T2, "s1",
    );
    expect(r.ledger["sca:cve-a"].status).toBe("RESOLVED");
    expect(r.ledger["sca:cve-a"].resolved_at).toBe("2026-01-05T00:00:00Z");
    expect(r.ledger["sca:cve-a"].resolution_src).toBe("api");
    expect(r.deltas.resolved_count).toBe(1);
  });

  it("a re-listed resolution is not counted twice", () => {
    // A still-resolved finding coming back in the payload is the API repeating itself.
    let ledger = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null).ledger;
    const resolved = obs("sca", "cve-a", { is_open: false, resolved_at: "2026-01-05T00:00:00Z" });
    ledger = scan([resolved], ledger, "sca", "s2", T2, "s1").ledger;
    const r = scan([resolved], ledger, "sca", "s3", T3, "s2");
    expect(r.deltas.resolved_count).toBe(0);
    expect(r.ledger["sca:cve-a"].resolved_at).toBe("2026-01-05T00:00:00Z");
  });

  it("a reopen starts a new episode and RE-DERIVES first_seen from the API", () => {
    // The next resolution must measure THIS episode, not the original — otherwise a finding
    // that came back after six months carries a six-month MTTR it did not earn.
    //
    // The mechanism is subtle and worth stating, because the obvious reading is wrong. A
    // reopen does not set first_seen to the scan time. It DISCARDS the stored value and
    // re-derives from this observation — `minIso(obs.first_seen, scanTs)` — where the
    // persisting branch instead keeps the stored value in play via
    // `minIso(row.first_seen, obs.first_seen)`. So the new episode's clock is whatever the
    // API now says, floored at the scan that saw it come back.
    let ledger = scan([obs("sca", "cve-a", { first_seen: "2025-01-01T00:00:00Z" })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { is_open: false, resolved_at: T1 })], ledger, "sca", "s2", T2, "s1").ledger;

    // The API has moved its own date forward: the new episode starts there, and the stored
    // 2025 birth date is gone.
    const r = scan([obs("sca", "cve-a", { first_seen: "2026-01-14T00:00:00Z" })], ledger, "sca", "s3", T3, "s2");
    const row = r.ledger["sca:cve-a"];
    expect(row.status).toBe("OPEN");
    expect(row.reopened_count).toBe(1);
    expect(row.resolved_at).toBeNull();
    expect(row.first_seen).toBe("2026-01-14T00:00:00Z");
    expect(r.deltas.reopened_count).toBe(1);
  });

  it("inherits the ORIGINAL birth date when the API keeps reporting it — an open question", () => {
    // NOT a decision this port made; it is inherited from gas/src/domain/reconcile.ts and
    // pinned here so it is visible rather than assumed.
    //
    // If Wiz resets `firstDetectedAt` when a finding is genuinely re-detected, this is
    // correct and there is nothing to do. If it does NOT, the reopened episode's MTTR is
    // inflated by the entire first episode — a finding that took 10 days to fix, came back a
    // year later and was fixed in 2 days would publish 367 days, not 2.
    //
    // NOTHING MEASURED HAS ANY BEARING ON THIS YET: five probe passes have never observed a
    // reopen, because none of them ran two scans. It needs the sync battery and two real
    // syncs to settle, and until then the honest thing is to hold the behaviour still and
    // say so.
    let ledger = scan([obs("sca", "cve-a", { first_seen: "2025-01-01T00:00:00Z" })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { is_open: false, resolved_at: T1 })], ledger, "sca", "s2", T2, "s1").ledger;
    const r = scan([obs("sca", "cve-a", { first_seen: "2025-01-01T00:00:00Z" })], ledger, "sca", "s3", T3, "s2");
    expect(r.ledger["sca:cve-a"].first_seen).toBe("2025-01-01T00:00:00Z");
  });

  it("takes the first of two copies within one scan", () => {
    // Duplicates across a page boundary do happen, and the two copies can disagree.
    const r = scan(
      [obs("sca", "cve-a", { severity: "CRITICAL" }), obs("sca", "cve-a", { severity: "LOW" })],
      {}, "sca", "s1", T1, null,
    );
    expect(r.ledger["sca:cve-a"].severity).toBe("CRITICAL");
    expect(r.deltas.new_count).toBe(1);
  });

  it("does not re-resolve a row that is already resolved", () => {
    let ledger = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([], ledger, "sca", "s2", T2, "s1").ledger;
    const r = scan([], ledger, "sca", "s3", T3, "s2");
    expect(r.deltas.resolved_count).toBe(0);
    expect(r.ledger["sca:cve-a"].resolved_at).toBe(T2);
  });

  it("does not resolve a row that already missed the previous scan", () => {
    // Stale, not newly resolved. Only a row that was in the IMMEDIATELY previous covering
    // scan can be said to have vanished from it.
    let ledger = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null).ledger;
    // s2 is missing it, but s2's own prevScanId is null-free: mark it seen at s1 only.
    ledger["sca:cve-a"].last_scan_id = "s0";
    const r = scan([], ledger, "sca", "s2", T2, "s1");
    expect(r.ledger["sca:cve-a"].status).toBe("OPEN");
  });

  it("dates a disappearance at the midpoint when asked", () => {
    let ledger = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null).ledger;
    const r = scan([], ledger, "sca", "s2", T2, "s1",
      { disappearanceMode: "midpoint", prevScanTs: T1 });
    expect(r.ledger["sca:cve-a"].resolved_at).toBe("2026-01-04T12:00:00Z");
  });
});

describe("the severity-scope guard", () => {
  it("an unscanned severity never disappears", () => {
    // SCA and SAST default to CRITICAL/HIGH. Without this guard every MEDIUM row in the
    // ledger vanishes on the first scoped scan and mass-resolves. Absence of something
    // nobody looked for is not evidence.
    let ledger = scan(
      [obs("sca", "cve-a", { severity: "CRITICAL" }), obs("sca", "cve-m", { severity: "MEDIUM" })],
      {}, "sca", "s1", T1, null,
    ).ledger;
    const r = scan([obs("sca", "cve-a", { severity: "CRITICAL" })], ledger, "sca", "s2", T2, "s1",
      { scannedSeverities: ["CRITICAL", "HIGH"] });
    expect(r.ledger["sca:cve-m"].status).toBe("OPEN");
    expect(r.ledger["sca:cve-a"].status).toBe("OPEN");
  });

  it("a severity resolves once its scope returns", () => {
    // The guard defers a resolution; it must not cancel one. prevScanIdBySeverity is what
    // remembers that MEDIUM was last covered by s1, three scans ago.
    let ledger = scan(
      [obs("sca", "cve-a", { severity: "CRITICAL" }), obs("sca", "cve-m", { severity: "MEDIUM" })],
      {}, "sca", "s1", T1, null,
    ).ledger;
    ledger = scan([obs("sca", "cve-a", { severity: "CRITICAL" })], ledger, "sca", "s2", T2, "s1",
      { scannedSeverities: ["CRITICAL", "HIGH"] }).ledger;
    const r = scan([obs("sca", "cve-a", { severity: "CRITICAL" })], ledger, "sca", "s3", T3, "s2", {
      scannedSeverities: ["CRITICAL", "HIGH", "MEDIUM"],
      prevScanIdBySeverity: { CRITICAL: "s2", HIGH: "s2", MEDIUM: "s1" },
    });
    expect(r.ledger["sca:cve-m"].status).toBe("RESOLVED");
    expect(r.ledger["sca:cve-m"].resolution_src).toBe("disappeared");
  });

  it("an ungated scan puts every severity in scope", () => {
    // Secrets sends no severity key at all (§10.3). Reading that as "covered no severities"
    // would exempt all 1,958 rows from disappearance forever.
    let ledger = scan([obs("secrets", "sec-a", { severity: "INFO" })], {}, "secrets", "s1", T1, null,
      { scannedSeverities: null }).ledger;
    const r = scan([], ledger, "secrets", "s2", T2, "s1", { scannedSeverities: null });
    expect(r.ledger["secrets:sec-a"].status).toBe("RESOLVED");
  });
});

describe("the risk signals stay tri-state", () => {
  it("never coerces a null signal to false", () => {
    const r = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null);
    expect(r.ledger["sca:cve-a"].has_kev).toBeNull();
    expect(r.ledger["sca:cve-a"].has_exploit).toBeNull();
    expect(r.ledger["sca:cve-a"].epss).toBeNull();
    expect(r.ledger["sca:cve-a"].risk_observed_at).toBeNull();
  });

  it("keeps a signal a later scan lost", () => {
    let ledger = scan([obs("sca", "cve-a", { has_kev: true })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a")], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].has_kev).toBe(true);
  });

  it("makes the booleans monotone", () => {
    // A CVE does not become un-exploited, and KEV entries are effectively never withdrawn.
    let ledger = scan([obs("sca", "cve-a", { has_exploit: true })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { has_exploit: false })], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].has_exploit).toBe(true);
  });

  it("lets a boolean climb from false to true", () => {
    let ledger = scan([obs("sca", "cve-a", { has_exploit: false })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { has_exploit: true })], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].has_exploit).toBe(true);
  });

  it("keeps the PEAK epss, not the latest", () => {
    // EPSS genuinely decays. The question the register asks is "should this have been
    // prioritized", not "is it still scary today".
    let ledger = scan([obs("sca", "cve-a", { epss: 0.4 })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { epss: 0.1 })], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].epss).toBe(0.4);
  });

  it("keeps the earliest witnessing scan, and only a witnessing one", () => {
    let ledger = scan([obs("sca", "cve-a")], {}, "sca", "s1", T1, null).ledger;
    expect(ledger["sca:cve-a"].risk_observed_at).toBeNull(); // a scan carrying nothing witnesses nothing
    ledger = scan([obs("sca", "cve-a", { epss: 0.2 })], ledger, "sca", "s2", T2, "s1").ledger;
    ledger = scan([obs("sca", "cve-a", { epss: 0.3 })], ledger, "sca", "s3", T3, "s2").ledger;
    expect(ledger["sca:cve-a"].risk_observed_at).toBe(T2);
  });

  it("does not reset risk signals on a reopen", () => {
    // Exploit availability is a property of the vulnerability; a vendor fix is a property of
    // the episode. That is exactly where the two disciplines part company.
    let ledger = scan([obs("sca", "cve-a", { has_kev: true, fix_date: T1 })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { is_open: false, resolved_at: T1 })], ledger, "sca", "s2", T2, "s1").ledger;
    ledger = scan([obs("sca", "cve-a")], ledger, "sca", "s3", T3, "s2").ledger;
    expect(ledger["sca:cve-a"].has_kev).toBe(true);
    expect(ledger["sca:cve-a"].fix_date).toBeNull(); // the episode's clock DID reset
  });
});

describe("the vendor-fix clock is sticky first-wins", () => {
  it("never lets a later scan overwrite a recorded fix date", () => {
    let ledger = scan([obs("sca", "cve-a", { fix_date: "2026-01-02T00:00:00Z" })], {}, "sca", "s1", T1, null).ledger;
    ledger = scan([obs("sca", "cve-a", { fix_date: "2026-05-01T00:00:00Z" })], ledger, "sca", "s2", T2, "s1").ledger;
    expect(ledger["sca:cve-a"].fix_date).toBe("2026-01-02T00:00:00Z");
  });

  it("records the scan that first saw a fix exist without a date", () => {
    // fixed_version with no fixDate still means a fix exists. fix_observed_at is the upper
    // bound on when — conservative, never crediting a team with time it did not have.
    const r = scan([obs("sca", "cve-a", { fixed_version: "1.2.4" })], {}, "sca", "s1", T1, null);
    expect(r.ledger["sca:cve-a"].fix_date).toBeNull();
    expect(r.ledger["sca:cve-a"].fix_observed_at).toBe(T1);
  });
});

describe("the validation axis", () => {
  it("never lets an UNKNOWN check overwrite a measured one", () => {
    // 393,443 of 394,927 instances are UNKNOWN (§3). A latest-wins rule that accepted them
    // would erase the 0.38% that is measured on the very next scan.
    let ledger = scan(
      [obs("secrets", "sec-a", { validation_state: "INVALID", validated_at: T1, rotated_at: T1 })],
      {}, "secrets", "s1", T1, null, { scannedSeverities: null },
    ).ledger;
    ledger = scan([obs("secrets", "sec-a", { validation_state: "UNKNOWN" })], ledger, "secrets", "s2", T2, "s1",
      { scannedSeverities: null }).ledger;
    expect(ledger["secrets:sec-a"].validation_state).toBe("INVALID");
    expect(ledger["secrets:sec-a"].rotated_at).toBe(T1);
  });

  it("lets a measured reading replace another measured reading", () => {
    // A credential genuinely can be re-validated, so this half IS latest-wins.
    let ledger = scan(
      [obs("secrets", "sec-a", { validation_state: "VALID", validated_at: T1 })],
      {}, "secrets", "s1", T1, null, { scannedSeverities: null },
    ).ledger;
    ledger = scan(
      [obs("secrets", "sec-a", { validation_state: "INVALID", validated_at: T2, rotated_at: T2 })],
      ledger, "secrets", "s2", T2, "s1", { scannedSeverities: null },
    ).ledger;
    expect(ledger["secrets:sec-a"].validation_state).toBe("INVALID");
    expect(ledger["secrets:sec-a"].rotated_at).toBe(T2);
  });
});

describe("the scan log", () => {
  const scans = [
    { scan_id: "a1", ts: T1, scope: "sca", severities: "CRITICAL,HIGH", new_count: 2, resolved_count: 0, reopened_count: 0 },
    { scan_id: "b1", ts: T2, scope: "sast", severities: "CRITICAL,HIGH", new_count: 1, resolved_count: 0, reopened_count: 0 },
    { scan_id: "a2", ts: T3, scope: "sca", severities: "CRITICAL", new_count: 0, resolved_count: 1, reopened_count: 0 },
  ];

  it("reads the previous scan OF THIS SCOPE, not of the register", () => {
    // A latestScan that ignored scope would hand SAST a SCA scan as its predecessor, and the
    // disappearance guard matches on last_scan_id — so it would resolve nothing, or the
    // wrong thing, and say neither.
    expect(latestScan(scans, "sca").scan_id).toBe("a2");
    expect(latestScan(scans, "sast").scan_id).toBe("b1");
    expect(latestScan(scans, "secrets")).toBeNull();
    expect(scansAsc(scans, "sca").map((r) => r.scan_id)).toEqual(["a1", "a2"]);
  });

  it("remembers which scan last covered each severity, per scope", () => {
    const m = prevScanIdBySeverity(scans, "sca");
    expect(m.CRITICAL).toBe("a2");
    expect(m.HIGH).toBe("a1"); // a2 gated to CRITICAL, so HIGH's last covering scan is a1
    expect(m.MEDIUM).toBeUndefined(); // never covered by any sca scan
  });

  it("reads an empty severity list as ALL, not as none", () => {
    // The secrets register's whole population depends on this one line.
    expect(parseSeverities("")).toBeNull();
    expect(parseSeverities("*")).toBeNull();
    expect(parseSeverities("CRITICAL, high")).toEqual(["CRITICAL", "HIGH"]);
  });
});

describe("the second clock", () => {
  const NOW = Date.parse("2026-02-01T00:00:00Z");
  const row = (over) => ({
    ...emptyObservation("sca", "k"), status: "OPEN", resolution_src: null, reopened_count: 0,
    first_scan_id: "s1", last_scan_id: "s1", last_seen: T1, risk_observed_at: null,
    fix_observed_at: null, first_seen: T1, ...over,
  });

  it("computes both clocks for a resolved SCA row", () => {
    const [b] = baseRows([row({
      status: "RESOLVED", resolved_at: "2026-01-21T00:00:00Z", fix_date: "2026-01-11T00:00:00Z",
    })], NOW);
    expect(b.mttr_days).toBe(20);          // detected -> resolved
    expect(b.mttr_actionable_days).toBe(10); // fix available -> resolved
    expect(b.fix_available_at).toBe("2026-01-11T00:00:00Z");
  });

  it("never starts the actionable clock before detection", () => {
    const [b] = baseRows([row({ fix_date: "2025-06-01T00:00:00Z" })], NOW);
    expect(b.actionable_from).toBe(T1); // the fix predates the finding; the clamp holds
  });

  it("flags an SCA row with no fix as awaiting a vendor", () => {
    const [b] = baseRows([row({})], NOW);
    expect(b.awaiting_vendor_fix).toBe(true);
    expect(b.actionable_age_days).toBeNull(); // out of the actionable clock, by design
    expect(b.age_days).toBe(31);              // still in the exposure count
  });

  it("NEVER flags SAST or secrets as awaiting a vendor", () => {
    // "Open with no fix available" is true of every SAST finding and every secret, because
    // neither has a vendor. Without the scope guard 127 + 1,958 rows would sit in that state
    // forever — out of every actionable clock, in every exposure count, and the two halves of
    // the page would disagree in a way that looks like broken arithmetic.
    for (const scope of ["sast", "secrets"]) {
      const [b] = baseRows([{ ...row({}), scope }], NOW);
      expect(b.awaiting_vendor_fix).toBe(false);
      expect(b.fix_available_at).toBeNull();
      expect(b.age_days).toBe(31);
    }
  });

  it("falls back to the scan that first saw a fix when no date came with it", () => {
    const [b] = baseRows([row({ fix_observed_at: "2026-01-11T00:00:00Z" })], NOW);
    expect(b.fix_available_at).toBe("2026-01-11T00:00:00Z");
    expect(b.awaiting_vendor_fix).toBe(false);
  });
});
