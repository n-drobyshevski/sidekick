import { describe, expect, it } from "vitest";
import {
  emptyRiskSignals,
  reconcile,
  tagsJson,
  type LedgerRow,
  type ReconcileOptions,
} from "../src/domain/reconcile";
import { expectParity, fixture } from "./helpers";

describe("tagsJson (fixture parity)", () => {
  const { cases } = fixture("tags_json");
  cases.forEach((c: any, i: number) => {
    it(`case ${i}`, () => {
      expectParity(tagsJson(c.input), c.expected);
    });
  });
});

describe("reconcile (fixture parity)", () => {
  const { scenarios } = fixture("reconcile");
  for (const sc of scenarios) {
    it(sc.name, () => {
      const opts: ReconcileOptions = {};
      const o = sc.input.options ?? {};
      if (o.disappearance_mode) opts.disappearanceMode = o.disappearance_mode;
      if (o.prev_scan_ts) opts.prevScanTs = o.prev_scan_ts;
      if (o.scanned_severities) opts.scannedSeverities = o.scanned_severities;
      if (o.prev_scan_id_by_severity) opts.prevScanIdBySeverity = o.prev_scan_id_by_severity;

      const { ledger, observations, deltas } = reconcile(
        sc.input.records,
        sc.input.ledger as Record<string, LedgerRow>,
        sc.input.scan_id,
        sc.input.scan_ts,
        sc.input.prev_scan_id,
        opts,
      );
      expectParity(deltas, sc.expected.deltas);
      expectParity(ledger, sc.expected.ledger);
      expectParity(observations, sc.expected.observations);
    });
  }

  it("does not mutate its inputs", () => {
    const sc = scenarios[1];
    const ledgerCopy = JSON.stringify(sc.input.ledger);
    const recordsCopy = JSON.stringify(sc.input.records);
    reconcile(
      sc.input.records,
      sc.input.ledger,
      sc.input.scan_id,
      sc.input.scan_ts,
      sc.input.prev_scan_id,
    );
    expectParity(JSON.parse(ledgerCopy), sc.input.ledger);
    expectParity(JSON.parse(recordsCopy), sc.input.records);
  });
});

// Vendor-fix capture is a GAS-only extension (no Python golden), so these exercise it
// directly. fix_date is the reported upstream fix date; fix_observed_at is the scan ts
// at which a fix signal (fixedVersion or fixDate) first appeared for the episode.
describe("reconcile fix-field capture", () => {
  const rec = (over: Record<string, unknown>) => ({
    id: "vf-1",
    name: "CVE-2026-1",
    severity: "HIGH",
    status: "OPEN",
    firstDetectedAt: "2026-03-01T00:00:00Z",
    ...over,
  });
  const run = (
    records: Record<string, unknown>[],
    ledger: Record<string, LedgerRow>,
    scanId: string,
  ) => reconcile(records, ledger, scanId, scanId, null);

  it("new row with a fix signal captures fix_date and fix_observed_at", () => {
    const { ledger } = run(
      [rec({ fixedVersion: "1.2.3", fixDate: "2026-02-20T00:00:00Z" })],
      {},
      "2026-03-05T00:00:00Z",
    );
    const row = ledger["id:vf-1"];
    expect(row.fix_date).toBe("2026-02-20T00:00:00Z");
    expect(row.fix_observed_at).toBe("2026-03-05T00:00:00Z");
  });

  it("new awaiting row (no fixedVersion, no fixDate) leaves both null", () => {
    const { ledger } = run([rec({ fixedVersion: null, fixDate: null })], {}, "2026-03-05T00:00:00Z");
    const row = ledger["id:vf-1"];
    expect(row.fix_date).toBeNull();
    expect(row.fix_observed_at).toBeNull();
  });

  it("fixedVersion alone marks fix_observed_at while fix_date stays null", () => {
    const { ledger } = run([rec({ fixedVersion: "1.2.3" })], {}, "2026-03-05T00:00:00Z");
    const row = ledger["id:vf-1"];
    expect(row.fix_date).toBeNull();
    expect(row.fix_observed_at).toBe("2026-03-05T00:00:00Z");
  });

  it("sticky first-wins: a late fix seeds an awaiting row; a later fix never overwrites", () => {
    // Scan 1: awaiting (no signal).
    const s1 = run([rec({ fixedVersion: null, fixDate: null })], {}, "2026-03-05T00:00:00Z");
    expect(s1.ledger["id:vf-1"].fix_observed_at).toBeNull();

    // Scan 2: a fix appears — observed_at pinned to THIS scan, fix_date captured.
    const s2 = run(
      [rec({ fixedVersion: "1.2.3", fixDate: "2026-03-08T00:00:00Z" })],
      s1.ledger,
      "2026-03-10T00:00:00Z",
    );
    expect(s2.ledger["id:vf-1"].fix_observed_at).toBe("2026-03-10T00:00:00Z");
    expect(s2.ledger["id:vf-1"].fix_date).toBe("2026-03-08T00:00:00Z");

    // Scan 3: a different (later) fix date must NOT overwrite the sticky first values.
    const s3 = run(
      [rec({ fixedVersion: "1.2.4", fixDate: "2026-03-20T00:00:00Z" })],
      s2.ledger,
      "2026-03-25T00:00:00Z",
    );
    expect(s3.ledger["id:vf-1"].fix_observed_at).toBe("2026-03-10T00:00:00Z");
    expect(s3.ledger["id:vf-1"].fix_date).toBe("2026-03-08T00:00:00Z");
  });

  it("reopen resets the fix clock then re-seeds from the reopening record", () => {
    // A resolved row that carried a fix.
    const resolved: Record<string, LedgerRow> = {
      "id:vf-1": {
        vuln_key: "id:vf-1", cve: "CVE-2026-1", severity: "HIGH", asset_id: null,
        asset_name: null, asset_type: null, cloud: null, first_seen: "2026-03-01T00:00:00Z",
        last_seen: "2026-03-05T00:00:00Z", status: "RESOLVED", resolved_at: "2026-03-05T00:00:00Z",
        resolution_src: "api", reopened_count: 0, first_scan_id: "s1", last_scan_id: "s1",
        subscription_name: null, subscription_ext_id: null, tags_json: null,
        fix_date: "2026-02-20T00:00:00Z", fix_observed_at: "2026-03-05T00:00:00Z",
        ...emptyRiskSignals(),
      },
    };
    // Reopens with NO fix signal → both cleared for the new episode.
    const reopenNoFix = run([rec({ status: "OPEN", fixedVersion: null, fixDate: null })], resolved, "2026-04-01T00:00:00Z");
    const r1 = reopenNoFix.ledger["id:vf-1"];
    expect(r1.status).toBe("OPEN");
    expect(r1.reopened_count).toBe(1);
    expect(r1.fix_date).toBeNull();
    expect(r1.fix_observed_at).toBeNull();

    // Reopens WITH a fresh fix signal → re-seeded from the reopening scan.
    const reopenWithFix = run(
      [rec({ status: "OPEN", fixedVersion: "2.0.0", fixDate: "2026-03-30T00:00:00Z" })],
      resolved,
      "2026-04-02T00:00:00Z",
    );
    const r2 = reopenWithFix.ledger["id:vf-1"];
    expect(r2.fix_date).toBe("2026-03-30T00:00:00Z");
    expect(r2.fix_observed_at).toBe("2026-04-02T00:00:00Z");
  });
});

// Exploit-intelligence capture (remediation coverage / efficiency) is a GAS-only extension
// with no Python golden, so these exercise it directly. The semantics deliberately differ
// from the vendor-fix fields above in two ways — monotone rather than plain first-wins, and
// NOT reset on reopen — so each difference gets its own case.
describe("reconcile risk-signal capture", () => {
  const rec = (over: Record<string, unknown>) => ({
    id: "vf-1",
    name: "CVE-2026-1",
    severity: "HIGH",
    status: "OPEN",
    firstDetectedAt: "2026-03-01T00:00:00Z",
    ...over,
  });
  const run = (
    records: Record<string, unknown>[],
    ledger: Record<string, LedgerRow>,
    scanId: string,
  ) => reconcile(records, ledger, scanId, scanId, null);

  // The invariant that keeps the Python parity fixtures green AND keeps "not captured"
  // distinguishable from "captured, and the answer was no". If this ever regresses to false
  // or 0, both the fixture suites and every coverage/efficiency rate break at once.
  it("a record carrying no signal keys leaves all four columns null, never false or 0", () => {
    const { ledger } = run([rec({})], {}, "2026-03-05T00:00:00Z");
    const row = ledger["id:vf-1"];
    expect(row.has_kev).toBeNull();
    expect(row.has_exploit).toBeNull();
    expect(row.epss).toBeNull();
    expect(row.risk_observed_at).toBeNull();
  });

  it("an observed false is captured as false — distinct from not-captured null", () => {
    const { ledger } = run(
      [rec({ hasCisaKevExploit: false, hasExploit: false, epssProbability: 0.02 })],
      {},
      "2026-03-05T00:00:00Z",
    );
    const row = ledger["id:vf-1"];
    expect(row.has_kev).toBe(false);
    expect(row.has_exploit).toBe(false);
    expect(row.epss).toBe(0.02);
    expect(row.risk_observed_at).toBe("2026-03-05T00:00:00Z");
  });

  it("booleans are monotone: false -> true sticks, true never reverts", () => {
    const s1 = run([rec({ hasExploit: false, hasCisaKevExploit: false })], {}, "2026-03-05T00:00:00Z");
    expect(s1.ledger["id:vf-1"].has_exploit).toBe(false);

    // The CVE picks up an exploit, then lands on the KEV.
    const s2 = run([rec({ hasExploit: true, hasCisaKevExploit: false })], s1.ledger, "2026-03-10T00:00:00Z");
    expect(s2.ledger["id:vf-1"].has_exploit).toBe(true);
    expect(s2.ledger["id:vf-1"].has_kev).toBe(false);

    // A later scan reporting false must NOT walk either flag back.
    const s3 = run([rec({ hasExploit: false, hasCisaKevExploit: false })], s2.ledger, "2026-03-15T00:00:00Z");
    expect(s3.ledger["id:vf-1"].has_exploit).toBe(true);
  });

  it("epss keeps the peak observed, not the latest", () => {
    const s1 = run([rec({ epssProbability: 0.4 })], {}, "2026-03-05T00:00:00Z");
    const s2 = run([rec({ epssProbability: 0.82 })], s1.ledger, "2026-03-10T00:00:00Z");
    expect(s2.ledger["id:vf-1"].epss).toBe(0.82);
    // EPSS decays in the real world; the metric asks "should this have been prioritized",
    // so the peak stands.
    const s3 = run([rec({ epssProbability: 0.05 })], s2.ledger, "2026-03-15T00:00:00Z");
    expect(s3.ledger["id:vf-1"].epss).toBe(0.82);
  });

  it("risk_observed_at pins to the EARLIEST witnessing scan, in either replay order", () => {
    // Forward (live scanning).
    const f1 = run([rec({ hasExploit: true })], {}, "2026-03-05T00:00:00Z");
    const f2 = run([rec({ hasExploit: true })], f1.ledger, "2026-03-10T00:00:00Z");
    expect(f2.ledger["id:vf-1"].risk_observed_at).toBe("2026-03-05T00:00:00Z");

    // Reverse (the archive backfill replays newest-first) must converge on the same value.
    const b1 = run([rec({ hasExploit: true })], {}, "2026-03-10T00:00:00Z");
    const b2 = run([rec({ hasExploit: true })], b1.ledger, "2026-03-05T00:00:00Z");
    expect(b2.ledger["id:vf-1"].risk_observed_at).toBe("2026-03-05T00:00:00Z");
  });

  it("a reopen does NOT reset the risk signals (unlike the vendor-fix clock)", () => {
    const resolved: Record<string, LedgerRow> = {
      "id:vf-1": {
        vuln_key: "id:vf-1", cve: "CVE-2026-1", severity: "HIGH", asset_id: null,
        asset_name: null, asset_type: null, cloud: null, first_seen: "2026-03-01T00:00:00Z",
        last_seen: "2026-03-05T00:00:00Z", status: "RESOLVED", resolved_at: "2026-03-05T00:00:00Z",
        resolution_src: "api", reopened_count: 0, first_scan_id: "s1", last_scan_id: "s1",
        subscription_name: null, subscription_ext_id: null, tags_json: null,
        fix_date: "2026-02-20T00:00:00Z", fix_observed_at: "2026-03-05T00:00:00Z",
        has_kev: true, has_exploit: true, epss: 0.7,
        risk_observed_at: "2026-03-01T00:00:00Z",
      },
    };
    // Exploit availability is a property of the vulnerability, not of the episode, so the
    // reopening record carrying no signal must not clear what we already know.
    const { ledger } = run([rec({ status: "OPEN" })], resolved, "2026-04-01T00:00:00Z");
    const row = ledger["id:vf-1"];
    expect(row.reopened_count).toBe(1);
    expect(row.fix_date).toBeNull(); // the fix clock DOES reset — the contrast case
    expect(row.has_kev).toBe(true);
    expect(row.has_exploit).toBe(true);
    expect(row.epss).toBe(0.7);
    expect(row.risk_observed_at).toBe("2026-03-01T00:00:00Z");
  });

  it("reads the Sheets plain-text round-trip of booleans", () => {
    // The ledger grid is number-formatted "@", so setValues(true) reads back as "TRUE".
    const { ledger } = run(
      [rec({ hasCisaKevExploit: "TRUE", hasExploit: "FALSE", epssProbability: "0.31" })],
      {},
      "2026-03-05T00:00:00Z",
    );
    const row = ledger["id:vf-1"];
    expect(row.has_kev).toBe(true);
    expect(row.has_exploit).toBe(false);
    expect(row.epss).toBe(0.31);
  });
});
