// WHAT MOVED THE NUMBER — the arithmetic, the identity, and the scope filter.
//
// The port of gas/test/program.test.ts's `movementDecomposition` / `movementWindowScans`
// describes (commit 930c7f1), plus the three specs this register needs and gas/ cannot have:
// three scopes share one `finding_ledger` and one `scans` tab here, so a row or a scan of
// ANOTHER scope reaching the decomposition is a live defect rather than an impossibility.
// CLAUDE.md states the general form ("Three scopes in one ledger, and DISAPPEARANCE IS THE
// DANGEROUS PART"); `movementDecomposition` filters both sides ITSELF for that reason, and the
// last three tests in this file are what hold it to that rather than to a calling convention.
//
// NOTE ON THE FILE NAME: `test/movement.test.ts` is a DIFFERENT measurement — `readModels.ts`'s
// `openMovement`, week-over-week open backlog, endpoints bounded by SYNCS. This file is the
// 28-day within-scope decomposition. Neither is a rename of the other.

import { describe, expect, it } from "vitest";

import {
  movementDecomposition,
  movementWindowScans,
  type MovementRow,
  type MovementScan,
} from "../src/domain/movementDecomposition";

describe("movementDecomposition", () => {
  // A HAND-BUILT WIDE-THEN-NARROW FIXTURE. The dev fixture cannot serve here: every battery in
  // `dev/sampleData.dev.ts` carries `scannedSeverities: null` (CLAUDE.md records the
  // measurement), so it models no gate change at all, and every figure below is a difference
  // between two scans of one scope.
  //
  // The shape is the one this metric exists for — a register whose gate narrowed mid-window:
  //
  //   T1  2026-01-10  sca, gate CRITICAL/HIGH/MEDIUM   <- the window's `since` endpoint
  //   T2  2026-02-10  sca, gate CRITICAL/HIGH          <- the gate narrowed here
  //   T3  2026-03-10  sca, gate CRITICAL/HIGH          <- the window's `until` endpoint
  //
  // and five sca lifecycles, worked out in full so this block is the audit trail:
  //
  //   #1 MEDIUM, open, born 01-05   in the gate at T1, OUTSIDE it at T3. Never resolved, so it
  //                                 is in neither resolution bucket — it is open and unmeasured.
  //   #2 HIGH,   born 01-05, resolved 02-15 by "api"          -> observed
  //   #3 HIGH,   born 01-06, resolved 03-01 by "disappeared"  -> bounded
  //   #4 CRITICAL, born 2025-12-01, resolved 01-05 by "api"   -> BEFORE the window; not counted
  //   #5 HIGH,   born 02-20, still open                       -> the window's one arrival
  //
  //   open at T1 (since) = #1, #2, #3                     = 3
  //   open at T3 (until) = #1, #5                         = 2
  //   netChange                                           = 2 - 3 = -1
  //   arrivals 1 - observed 1 - bounded 1 + reopened 0    = -1     -> identityGap 0
  //
  // The T1 scan carries `new_count: 99` and `reopened_count: 7` on purpose: the window is
  // half-open (since < ts <= until), so the scan that OPENS the window describes the period
  // before it, and counting it would blow the identity by 106 rather than by a rounding.
  const T1 = "2026-01-10T00:00:00Z";
  const T2 = "2026-02-10T00:00:00Z";
  const T3 = "2026-03-10T00:00:00Z";
  const WINDOW = { since: T1, until: T3 };
  // The stored form, NOT "CRITICAL,HIGH": scans.severities is the JSON `serializeSeverities`
  // writes (compaction.ts, ported verbatim from gas/), and `parseSeverities` answers null for
  // anything JSON.parse refuses — a comma-string gate would read as NO gate and quietly zero
  // outsideGate.
  const WIDE = '["CRITICAL", "HIGH", "MEDIUM"]';
  const NARROW = '["CRITICAL", "HIGH"]';

  const scans = (): MovementScan[] => [
    { scope: "sca", ts: T1, severities: WIDE, new_count: 99, reopened_count: 7 },
    { scope: "sca", ts: T2, severities: NARROW, new_count: 0, reopened_count: 0 },
    { scope: "sca", ts: T3, severities: NARROW, new_count: 1, reopened_count: 0 },
  ];

  const mrow = (o: Partial<MovementRow>): MovementRow => ({
    scope: "sca", severity: "HIGH", status: "OPEN", first_seen: null, resolved_at: null,
    resolution_src: null, ...o,
  });

  const rows: MovementRow[] = [
    mrow({ severity: "MEDIUM", first_seen: "2026-01-05T00:00:00Z" }),
    mrow({
      status: "RESOLVED", first_seen: "2026-01-05T00:00:00Z",
      resolved_at: "2026-02-15T00:00:00Z", resolution_src: "api",
    }),
    mrow({
      status: "RESOLVED", first_seen: "2026-01-06T00:00:00Z",
      resolved_at: "2026-03-01T00:00:00Z", resolution_src: "disappeared",
    }),
    mrow({
      severity: "CRITICAL", status: "RESOLVED", first_seen: "2025-12-01T00:00:00Z",
      resolved_at: "2026-01-05T00:00:00Z", resolution_src: "api",
    }),
    mrow({ first_seen: "2026-02-20T00:00:00Z" }),
  ];

  const out = movementDecomposition(rows, scans(), WINDOW, "sca");

  it("a MEDIUM row outside the narrowed gate is counted as unmeasured, not as resolved", () => {
    // The whole point of the figure: this row did not go anywhere. The last scan simply
    // stopped asking about its severity, and a headline that improved for that reason has to
    // say so in a different word from the one it uses for a fix.
    expect(out.outsideGate).toBe(1);
    expect(out.observed).toBe(1);
    expect(out.bounded).toBe(1);
    expect(out.unattributed).toBe(0);
    // Still open, still in the replay at both ends — it cancels out of netChange entirely.
    expect(out.netChange).toBe(-1);
  });

  it("a null gate contributes zero to outsideGate, not the whole register", () => {
    // Five spellings of "no gate was applied" and all five reach here: a column never written,
    // an older row carrying the empty string, a serialized empty list, a value JSON.parse
    // refuses — and the one this register produces on every single `secrets` scan, since
    // `DEFAULT_FETCH_SEVERITIES.secrets = []` serializes to a stored null. `parseSeverities`
    // answers null to all five, and null must mean every severity was in scope, never that
    // every open row is outside it.
    for (const gate of [null, undefined, "", "[]", "CRITICAL,HIGH"]) {
      const ungated = scans().map((s) => (s["ts"] === T1 ? s : { ...s, severities: gate }));
      const m = movementDecomposition(rows, ungated, WINDOW, "sca");
      expect(m.outsideGate, `gate ${JSON.stringify(gate)}`).toBe(0);
      // ...and nothing else moved: the gate decides one field and only one.
      expect(m.observed).toBe(1);
      expect(m.netChange).toBe(-1);
    }
    // The register has five rows and two of them are open; a "gate matches nothing"
    // implementation would report 2 here, not 0.
    expect(rows.filter((r) => r.status === "OPEN").length).toBe(2);
  });

  it("a resolution before the window is not in the window", () => {
    // #4 was resolved on 01-05, five days before `since`. It is in neither bucket here...
    expect(out.observed + out.bounded + out.unattributed).toBe(2);
    // ...and it is not a hidden zero either: widen the window back over it and it appears.
    const wider = movementDecomposition(rows, scans(), {
      since: "2025-12-15T00:00:00Z", until: T3,
    }, "sca");
    expect(wider.observed).toBe(2);
  });

  it("the identity holds on the wide-then-narrow fixture", () => {
    // Hand-computed above: open 3 at T1, open 2 at T3.
    expect(out.netChange).toBe(-1);
    expect(out.arrivals).toBe(1);
    expect(out.reopened).toBe(0);
    expect(out.arrivals - out.observed - out.bounded + out.reopened).toBe(-1);
    expect(out.identityGap).toBe(0);
    expect(out.identityHolds).toBe(true);
    expect(out.scansInWindow).toBe(2);
    expect(out.skippedScans).toBe(0);
    expect(out.partialCounts).toBe(0);
    expect(out.unplacedRows).toBe(0);
    expect(out.scope).toBe("sca");
  });

  it("publishes the gap rather than balancing the books", () => {
    // Perturbation: the T3 scan forgets the one finding that clearly arrived (#5 is in the
    // rows with first_seen 02-20, and the replay counts it). The two sides now disagree by
    // exactly one finding, and the figure has to SAY so rather than deriving one side from
    // the other.
    const forgetful = scans().map((s) => (s["ts"] === T3 ? { ...s, new_count: 0 } : s));
    const m = movementDecomposition(rows, forgetful, WINDOW, "sca");
    expect(m.netChange).toBe(-1); // the replay is untouched
    expect(m.arrivals).toBe(0);
    expect(m.identityGap).toBe(-1 - (0 - 1 - 1 + 0));
    expect(m.identityGap).toBe(1);
    expect(m.identityHolds).toBe(false);
  });

  it("a non-finite new_count is refused and reported, not read as zero", () => {
    // `undefined` is in the list but NOT in the claim below, and the difference is the
    // finding: `Number(undefined)` is NaN, which `Number.isFinite` would have caught. The
    // other four cast to a finite 0 — that is the set a cast-then-isFinite guard reads as a
    // measured "nothing arrived", and the reason the type test has to come first.
    for (const bad of [null, "", [], false]) {
      expect(Number(bad as never), `Number(${JSON.stringify(bad)})`).toBe(0);
      expect(Number.isFinite(Number(bad as never))).toBe(true);
      const broken = scans().map((s) => (s["ts"] === T3 ? { ...s, new_count: bad } : s));
      const m = movementDecomposition(rows, broken, WINDOW, "sca");
      expect(m.arrivals, `new_count ${JSON.stringify(bad)}`).toBe(0);
      expect(m.partialCounts).toBe(1);
      // ...and the refusal shows up as a gap rather than as a confident total.
      expect(m.identityHolds).toBe(false);
      expect(m.identityGap).toBe(1);
    }
    // An absent key takes the same path, for a different reason at the cast (NaN, not 0).
    const missing = scans().map((s) =>
      (s["ts"] === T3 ? { scope: "sca", ts: T3, severities: NARROW } : s));
    const m = movementDecomposition(rows, missing, WINDOW, "sca");
    expect(m.arrivals).toBe(0);
    expect(m.reopened).toBe(0);
    expect(m.partialCounts).toBe(2); // new_count AND reopened_count, both refused
  });

  it("outsideGate is not summed into administrative", () => {
    // PERTURBATION (run 2026-09-06, reverted): folding the stock into the flow —
    //     administrative: bounded + outsideGate,
    // in src/domain/movementDecomposition.ts. Observed, whole suite —
    // 1 failed | 2112 passed | 4 skipped:
    //   FAIL |pure| test/movementDecomposition.test.ts > movementDecomposition > outsideGate
    //        is not summed into administrative
    //        AssertionError: expected 2 to be 1 // Object.is equality
    // EXACTLY ONE test, and the two others predicted did NOT fire — both worth recording,
    // because they are the two blind spots this file is the only cover for.
    // test/historyModel.test.js builds its own payload, so it cannot see a domain defect at
    // all. And test/readModels.test.ts's own movement specs run over a fixture where every
    // scan carries `severities: null` — the gate is off, `outsideGate` is 0, and 0 folded into
    // anything changes nothing. A gate change is not modelled anywhere in this package's
    // fixtures (CLAUDE.md records the same measurement about `dev/sampleData.dev.ts`), which
    // is why the wide-then-narrow fixture above is hand-built.
    // The arithmetic reason it must not: outsideGate is a STOCK — those rows stay outside the
    // gate on every window until someone widens it — so summing it in re-charges the same
    // rows as fresh administrative movement every time the page is opened, and breaks the
    // identity that makes the two halves reconcilable with netChange.
    expect(out.administrative).toBe(out.bounded);
    expect(out.administrative).toBe(1);
    expect(out.administrative).not.toBe(out.bounded + out.outsideGate);
    expect(out.measured + out.administrative).toBe(2);
    expect(out.outsideGate).toBe(1);
  });

  it("a scan whose ts will not parse sits in no window and is counted", () => {
    const broken = [...scans(), { scope: "sca", ts: "not a date", new_count: 40 }];
    const m = movementDecomposition(rows, broken, WINDOW, "sca");
    expect(m.skippedScans).toBe(1);
    expect(m.arrivals).toBe(1);
    expect(m.scansInWindow).toBe(2);
  });

  it("a resolution with no usable provenance is unattributed, not administrative", () => {
    // Neither measured nor administrative: nothing recorded HOW the date was arrived at, and
    // filing it under either heading would be an invention.
    const odd = [...rows, mrow({
      status: "RESOLVED", first_seen: "2026-01-08T00:00:00Z",
      resolved_at: "2026-02-01T00:00:00Z", resolution_src: "manual",
    })];
    const m = movementDecomposition(odd, scans(), WINDOW, "sca");
    expect(m.unattributed).toBe(1);
    expect(m.observed).toBe(1);
    expect(m.bounded).toBe(1);
    // It moved the replay by one and is in neither side of the identity, so it is exactly
    // the gap — which is the honest place for it.
    expect(m.identityGap).toBe(-1);
  });

  it("refuses an unparseable or inverted window rather than returning a zeroed movement", () => {
    // A Movement of all zeroes reads as "nothing happened", which is a measurement; no
    // measurement was made.
    expect(() => movementDecomposition(rows, scans(), { since: "nope", until: T3 }, "sca"))
      .toThrow();
    expect(() => movementDecomposition(rows, scans(), { since: T3, until: T1 }, "sca"))
      .toThrow();
  });

  // ------------------------------------------------------------------ the three-scope specs
  //
  // gas/ has one register and cannot have these. Here one ledger and one scans tab hold all
  // three, and the function filters both sides itself rather than trusting its caller.

  // PERTURBATION (run 2026-09-06, reverted): the scope filter on SCANS —
  //     if (s["scope"] !== scope) continue;
  // — deleted from `movementDecomposition`. Observed, whole suite —
  // 4 failed | 2109 passed | 4 skipped:
  //   FAIL |pure| ... > a scan of another scope is not an endpoint for this scope
  //        AssertionError: expected 501 to be 1
  //   FAIL |pure| ... > a row of another scope is not in this scope's movement
  //        AssertionError: expected 2 to be +0            (scansInWindow, not the row counts)
  //   FAIL |stateful| test/readModels.test.ts > historyModel > ships one movement block per
  //        register, each measured over its own scans   AssertionError: expected 3 to be 1
  //   FAIL |stateful| test/readModels.test.ts > historyModel > does not let another register's
  //        scans bound this register's window
  //        AssertionError: expected '{"scope":"sca","arrivals":10,…' to be '…"arrivals":8,…'
  // The last one is the finding: with the filter gone, ADDING A SAST SCAN CHANGED SCA'S
  // PUBLISHED MOVEMENT — which is precisely the register-crossing this parameter exists to
  // make impossible, and it is invisible in any single-scope assertion.
  it("a row of another scope is not in this scope's movement", () => {
    // A SAST row with the identical lifecycle to #2 — born and resolved by the API inside the
    // window, and MEDIUM so it would also fall outside sca's narrowed gate. If the row filter
    // were dropped it would land in `observed` AND in `outsideGate` AND in the replay, and the
    // sca register would report another register's remediation as its own.
    const withSast: MovementRow[] = [...rows, mrow({
      scope: "sast", severity: "MEDIUM", status: "RESOLVED",
      first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-15T00:00:00Z",
      resolution_src: "api",
    }), mrow({ scope: "sast", severity: "MEDIUM", first_seen: "2026-01-05T00:00:00Z" })];
    const m = movementDecomposition(withSast, scans(), WINDOW, "sca");
    expect(m.observed).toBe(1); // not 2
    expect(m.outsideGate).toBe(1); // not 2
    expect(m.netChange).toBe(-1); // not -2
    expect(m.identityHolds).toBe(true);
    // ...and the same call for `sast` sees only the two SAST rows, over a window bounded by
    // SCA's scans. Measured rather than assumed: the books still balance, because the one
    // movement on that side is a resolution the ROW itself recorded — the scan side had
    // nothing to contribute and contributing nothing is the correct answer when this scope's
    // register was never scanned in the window. `scansInWindow: 0` is what says so, and it is
    // why the server refuses to publish a block whose window came from another scope's log
    // (readModels.ts: the window is computed per scope too).
    const s = movementDecomposition(withSast, scans(), WINDOW, "sast");
    expect(s.observed).toBe(1);
    expect(s.netChange).toBe(-1);
    expect(s.scansInWindow).toBe(0);
    expect(s.arrivals).toBe(0);
    expect(s.outsideGate).toBe(0); // no in-window sast scan, so no gate to be outside of
    expect(s.identityGap).toBe(0);
    expect(s.identityHolds).toBe(true);
  });

  it("a scan of another scope is not an endpoint for this scope", () => {
    // A secrets scan sitting inside the sca window, carrying big counts and NO severity gate
    // (which is what `DEFAULT_FETCH_SEVERITIES.secrets = []` stores). Counted, it would add
    // 500 arrivals and 500 reopenings to sca's window; worse, being the newest in-window scan
    // it would replace sca's narrowed gate with "no gate" and zero `outsideGate` — the one
    // figure this whole section exists to publish.
    const mixed: MovementScan[] = [...scans(), {
      scope: "secrets", ts: "2026-03-09T00:00:00Z", severities: null,
      new_count: 500, reopened_count: 500,
    }];
    const m = movementDecomposition(rows, mixed, WINDOW, "sca");
    expect(m.arrivals).toBe(1);
    expect(m.reopened).toBe(0);
    expect(m.scansInWindow).toBe(2);
    expect(m.outsideGate).toBe(1);
    expect(m.identityHolds).toBe(true);
  });
});

describe("movementWindowScans — the endpoints are scans of THIS scope, not calendar dates", () => {
  const D = (iso: string) => Date.parse(iso);
  const scan = (scope: string, iso: string) => ({ scope, ts: iso });

  it("takes the newest scan and the newest one at least 28 days older", () => {
    // Four scans; the qualifying pair is the SHORTEST window that still clears 28 days, so
    // the figure describes the most recent 28 days of scanning rather than the whole ledger.
    const w = movementWindowScans([
      scan("sca", "2026-01-01T00:00:00Z"),
      scan("sca", "2026-02-01T00:00:00Z"),
      scan("sca", "2026-02-20T00:00:00Z"),
      scan("sca", "2026-03-21T00:00:00Z"),
    ], 28, "sca");
    expect(w.reason).toBeNull();
    expect(w.since).toBe(D("2026-02-20T00:00:00Z")); // 29 days back, not 48 and not 78
    expect(w.until).toBe(D("2026-03-21T00:00:00Z"));
    expect(w.days).toBe(29);
  });

  it("refuses a pair closer than the minimum, and publishes the span it does have", () => {
    // The reader learns "this register has only been saving scans for 9 days" — a fact about
    // the register — rather than the bare "no comparison", which reads as a defect.
    const w = movementWindowScans([
      scan("sca", "2026-03-12T00:00:00Z"),
      scan("sca", "2026-03-18T00:00:00Z"),
      scan("sca", "2026-03-21T00:00:00Z"),
    ], 28, "sca");
    expect(w.reason).toBe("tooClose");
    expect(w.since).toBeNull();
    expect(w.until).toBe(D("2026-03-21T00:00:00Z"));
    expect(w.days).toBe(9);
  });

  it("names the one-scan and no-scan cases apart", () => {
    expect(movementWindowScans([], 28, "sca").reason).toBe("noScans");
    expect(movementWindowScans([scan("sca", "2026-03-21T00:00:00Z")], 28, "sca").reason)
      .toBe("oneScan");
    // ...and a tab full of OTHER registers' scans is, for this one, a tab of no scans at all.
    const others = [scan("sast", "2026-01-01T00:00:00Z"), scan("secrets", "2026-03-21T00:00:00Z")];
    expect(movementWindowScans(others, 28, "sca").reason).toBe("noScans");
  });

  it("the first SAST scan with fifty SCA scans behind it has a one-scan window, not a fifty-scan one", () => {
    // The shape CLAUDE.md warns about, in the window function rather than in reconcile: three
    // registers share one scans tab, and every SCA row in it is a scan that never looked at a
    // SAST finding. Bounding SAST's window with SCA's endpoints would hand the FIRST SAST scan
    // a 49-day window, replay every SAST row as "open at since", and read the whole register
    // as a standing backlog nobody had yet measured — a failure of presence dressed as one.
    const DAY = 86_400_000;
    const start = D("2026-01-01T00:00:00Z");
    const tab: { scope: string; ts: string }[] = [];
    for (let i = 0; i < 50; i += 1) {
      tab.push(scan("sca", new Date(start + i * DAY).toISOString()));
    }
    // The one SAST scan, dated the same day as the fiftieth SCA scan.
    const sastTs = new Date(start + 49 * DAY).toISOString();
    tab.push(scan("sast", sastTs));
    expect(tab.filter((s) => s.scope === "sca").length).toBe(50);

    const sast = movementWindowScans(tab, 28, "sast");
    expect(sast.reason).toBe("oneScan");
    expect(sast.since).toBeNull();
    expect(sast.until).toBe(D(sastTs));
    // ...while sca, over the same tab, gets a real window. The refusal is about SAST's own
    // record, not about the tab being short.
    const sca = movementWindowScans(tab, 28, "sca");
    expect(sca.reason).toBeNull();
    expect(sca.since).not.toBeNull();
  });

  it("a scan whose ts will not parse is not an endpoint", () => {
    const w = movementWindowScans([
      { scope: "sca", ts: "" },
      { scope: "sca", ts: null },
      scan("sca", "2026-01-01T00:00:00Z"),
      scan("sca", "2026-03-21T00:00:00Z"),
    ], 28, "sca");
    expect(w.reason).toBeNull();
    expect(w.since).toBe(D("2026-01-01T00:00:00Z"));
    expect(w.days).toBe(79);
  });

  it("accepts scans in any stored order — the ledger tab is not sorted by contract", () => {
    const shuffled = [
      scan("sca", "2026-03-21T00:00:00Z"),
      scan("sca", "2026-01-01T00:00:00Z"),
      scan("sca", "2026-02-20T00:00:00Z"),
    ];
    const w = movementWindowScans(shuffled, 28, "sca");
    expect(w.until).toBe(D("2026-03-21T00:00:00Z"));
    expect(w.since).toBe(D("2026-02-20T00:00:00Z"));
  });
});
