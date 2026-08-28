// The whole chain, in memory: sample nodes -> normalize -> reconcile -> derived clocks -> KM.
//
// This runs the REAL modules end to end without the Sheets layer, which is what makes it an
// integration test rather than a mock. The Sheets round trip is covered separately below
// (rowFromSheet / rowToSheet are pure) and end-to-end by `npm run dev`.
//
// It exists because every piece passing alone proves nothing about the sequence: the twin
// fold, the per-scope disappearance guard, the severity gate and the vendor-fix clock only
// meet each other here.

import { describe, expect, it } from "vitest";
import { baseRows } from "../src/domain/ledgerCore";
import { reconcile } from "../src/domain/reconcile";
import { kaplanMeier, openPastSla } from "../src/domain/remediation";
import { rowFromSheet, rowToSheet } from "../src/server/ledgerStore";
import { liveSource, observationsFor, sampleSource } from "../src/server/sync";
import { SAMPLE_SCANS } from "../dev/sampleData.dev";

/** Replay the dev dataset through the real pipeline, without any storage. */
function replay() {
  let ledger = {};
  const scanLog = [];
  for (const s of SAMPLE_SCANS) {
    for (const scope of ["sca", "sast", "secrets"]) {
      const prev = scanLog.filter((r) => r.scope === scope).slice(-1)[0] ?? null;
      const { observations } = observationsFor(scope, s.nodes[scope]);
      const r = reconcile(
        observations, ledger, scope, `${s.id}-${scope}`, s.ts, prev?.scan_id ?? null,
        // The gate THIS scan applied, from the dataset rather than a constant here: scan 1
        // is wide and scans 2-3 are narrow, which is what a settings change looks like and
        // is what puts MEDIUM/LOW rows in the ledger for the guard to protect.
        { scannedSeverities: s.gates[scope], prevScanTs: prev?.ts ?? null },
      );
      ledger = r.ledger;
      scanLog.push({ scan_id: `${s.id}-${scope}`, ts: s.ts, scope, deltas: r.deltas });
    }
  }
  return { ledger, scanLog, rows: Object.values(ledger) };
}

describe("the sample dataset drives a real ledger", () => {
  const { rows, scanLog } = replay();

  it("is a SEQUENCE, so reconcile actually has something to do", () => {
    // One scan exercises nothing: no disappearance, no held first_seen, and an MTTR page
    // with nothing but open rows. Three scans is the minimum that measures anything.
    expect(SAMPLE_SCANS).toHaveLength(3);
    const firstScanDeltas = scanLog.filter((s) => s.scan_id.startsWith("sample-1"));
    expect(firstScanDeltas.every((s) => s.deltas.resolved_count === 0)).toBe(true);
    const later = scanLog.filter((s) => !s.scan_id.startsWith("sample-1"));
    expect(later.some((s) => s.deltas.resolved_count > 0)).toBe(true);
  });

  it("never hands back a row its own gate excludes", () => {
    // The fixture defect this pins: SCA showed MEDIUM and LOW rows while its scan log said
    // it covered CRITICAL,HIGH — the ledger and its own account of how it was built in
    // contradiction. Caught by looking at the Executive page, not by a test, which is why
    // there is one now.
    for (const s of SAMPLE_SCANS) {
      for (const scope of ["sca", "sast", "secrets"]) {
        const gate = s.gates[scope];
        if (!gate) continue;
        const outside = s.nodes[scope].filter((n) => !gate.includes(n.severity));
        expect(outside.map((n) => n.severity)).toEqual([]);
      }
    }
  });

  it("models a WIDENED first scan, so the guard has something to protect", () => {
    // Deleting the out-of-gate rows would have made the fixture coherent and the
    // disappearance guard untestable — nothing would ever be out of scope. A wide first scan
    // followed by a narrowed one is both coherent AND the real production shape.
    expect(SAMPLE_SCANS[0].gates.sca).toBeNull();
    expect(SAMPLE_SCANS[1].gates.sca).toEqual(["CRITICAL", "HIGH"]);

    const { rows } = replay();
    const outOfGate = rows.filter(
      (r) => r.scope === "sca" && !["CRITICAL", "HIGH"].includes(r.severity));
    expect(outOfGate.length).toBeGreaterThan(0);      // they are in the ledger...
    expect(outOfGate.every((r) => r.status === "OPEN")).toBe(true); // ...and never resolved
  });

  it("carries all three registers", () => {
    const scopes = new Set(rows.map((r) => r.scope));
    expect([...scopes].sort()).toEqual(["sast", "sca", "secrets"]);
  });

  it("resolves SAST only by disappearance, because the API cannot say otherwise", () => {
    // §2: SASTFinding has no resolvedAt and returns no resolved rows. If any SAST row here
    // carried resolution_src "api", something upstream invented a resolution.
    const sast = rows.filter((r) => r.scope === "sast" && r.status === "RESOLVED");
    expect(sast.length).toBeGreaterThan(0);
    expect(sast.every((r) => r.resolution_src === "disappeared")).toBe(true);
  });

  it("resolves SCA both ways, so the two sources are distinguishable", () => {
    const sca = rows.filter((r) => r.scope === "sca" && r.status === "RESOLVED");
    const srcs = new Set(sca.map((r) => r.resolution_src));
    expect(srcs.has("api")).toBe(true);
    expect(srcs.has("disappeared")).toBe(true);
  });

  it("never DISAPPEARS a row whose severity the scan did not cover", () => {
    // SCA and SAST gate to CRITICAL/HIGH, so a MEDIUM or LOW row is absent from every scan
    // by construction and must never be resolved for it.
    //
    // The guard is about DISAPPEARANCE specifically, and this test used to say "never
    // resolves" — which is a different and wrong claim. An API-declared resolution is a fact
    // the API stated about a row it handed back; severity has no bearing on whether to
    // believe it. Conflating the two would mean discarding a real remediation because of the
    // grade on it.
    const wrong = rows.filter((r) =>
      r.scope !== "secrets"
      && r.resolution_src === "disappeared"
      && !["CRITICAL", "HIGH"].includes(r.severity));
    expect(wrong).toEqual([]);
  });

  it("resolves secrets at every severity, because that scope has no gate", () => {
    // The other side of the same rule: an empty gate means the scan covered everything, so
    // every severity is a disappearance candidate (§9.2/§10.3).
    const resolved = rows.filter((r) => r.scope === "secrets" && r.status === "RESOLVED");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.some((r) => !["CRITICAL", "HIGH"].includes(r.severity))).toBe(true);
  });

  it("folds the secrets twins and records what the fold discarded", () => {
    const twinned = rows.filter((r) => r.scope === "secrets" && (r.twin_count ?? 1) > 1);
    expect(twinned.length).toBeGreaterThan(0);
    // Every twin's spread is real, and the fold took the earlier date, so first_seen must be
    // at or before the later twin's — which the spread column is the size of.
    expect(twinned.every((r) => r.twin_first_seen_spread_days > 0)).toBe(true);
    expect(twinned.every((r) => JSON.parse(r.source_external_ids).length === 2)).toBe(true);
  });

  it("marks removed_at on resolved secrets and leaves rotated_at alone", () => {
    // Removed is not rotated. The credential is live until a validation says otherwise.
    const gone = rows.filter((r) => r.scope === "secrets" && r.status === "RESOLVED");
    expect(gone.every((r) => r.removed_at !== null)).toBe(true);
    expect(gone.every((r) => r.rotated_at === null || r.validation_state === "INVALID")).toBe(true);
  });

  it("keeps unevaluated risk signals null through three scans", () => {
    // The dev dataset leaves one row in four unevaluated on purpose. If any of them read
    // false here, the tri-state died somewhere between the normalizer and the merge.
    const sca = rows.filter((r) => r.scope === "sca");
    expect(sca.some((r) => r.has_exploit === null)).toBe(true);
    expect(sca.some((r) => r.has_exploit === false)).toBe(true);
    expect(sca.some((r) => r.has_exploit === true)).toBe(true);
  });
});

describe("the page's figures come out honest", () => {
  const { rows } = replay();
  const derived = baseRows(rows, Date.parse("2026-08-16T00:00:00Z"));

  it("keeps every open finding in the KM risk set", () => {
    const km = kaplanMeier(derived);
    expect(km.censored).toBeGreaterThan(0);
    expect(km.events).toBeGreaterThan(0);
    expect(km.total).toBe(km.events + km.censored);
    // The comparison the page exists to show: the closed-only median describes only what
    // closed, and the censoring-aware estimate is computed from the whole risk set.
    expect(km.naiveMedian).not.toBeNull();
  });

  it("flags a truncated RMST on a register that is mostly open", () => {
    const km = kaplanMeier(derived);
    expect(km.meanTruncated).toBe(true); // survival never reaches 0 here
    expect(km.restrictionTime).toBeGreaterThan(0);
  });

  it("finds an aged backlog past SLA", () => {
    const sla = openPastSla(derived);
    expect(sla.overall.open).toBeGreaterThan(0);
    expect(sla.overall.breached).toBeGreaterThan(0);
  });

  it("puts SCA rows — and ONLY SCA rows — into awaiting_vendor_fix", () => {
    const awaiting = derived.filter((r) => r.awaiting_vendor_fix);
    expect(awaiting.length).toBeGreaterThan(0);
    expect(awaiting.every((r) => r.scope === "sca")).toBe(true);
  });

  it("gives SAST and secrets a real MTTR rather than an age metric", () => {
    // The disappearance clock is a genuine death date, so these rows have a lifetime — which
    // is the difference between this register and one that can only report how old things are.
    for (const scope of ["sast", "secrets"]) {
      const closed = derived.filter((r) => r.scope === scope && r.mttr_days !== null);
      expect(closed.length).toBeGreaterThan(0);
      expect(closed.every((r) => r.mttr_days > 0)).toBe(true);
    }
  });
});

describe("the sources", () => {
  it("the sample source hands each scope its own nodes", () => {
    const src = sampleSource(SAMPLE_SCANS[0].nodes);
    expect(src.mode).toBe("sample");
    expect(src.nodes("sca").length).toBeGreaterThan(0);
    expect(src.nodes("nonexistent")).toEqual([]);
  });

  it("the live source REFUSES rather than returning nothing", () => {
    // The refusal stands; its REASON changed, and the old assertion had gone stale.
    //
    // It used to read /not implemented/, and that was true while there was no battery: an
    // empty page here would have written a scan row claiming it covered the scope, and the
    // next scan's disappearance pass would have resolved the whole register against it.
    // The battery exists now, so "not implemented" is simply false — but what this guard
    // actually forbids was never the Wiz call. It is an UNBUDGETED, UNRESUMABLE fetch inside
    // the one function that also commits: a scope is tens of pages against a six-minute
    // execution, so a source paging from here gets killed partway and hands `reconcile` a
    // partial population, which is read as remediation. `scanJobs` pages across executions
    // and hands `runScan` the finished set through `stagedSource`.
    //
    // So the claim is narrowed rather than dropped, and pinned to the part that is still
    // load-bearing: it throws, and the message points at the battery.
    expect(() => liveSource().nodes("sca")).toThrow(/does not run inside runScan/);
    expect(() => liveSource().nodes("sca")).toThrow(/scanJobs/);
  });

  it("routes secrets through the fold and the others through a map", () => {
    const secrets = observationsFor("secrets", SAMPLE_SCANS[0].nodes.secrets);
    // The fold removes rows; a map never could.
    expect(secrets.observations.length).toBeLessThan(SAMPLE_SCANS[0].nodes.secrets.length);
    expect(secrets.keyedWithoutLine).toBe(0);

    const sca = observationsFor("sca", SAMPLE_SCANS[0].nodes.sca);
    expect(sca.observations.length).toBe(SAMPLE_SCANS[0].nodes.sca.length);
    expect(sca.keyedWithoutLine).toBeUndefined();
  });
});

describe("the sheet round trip", () => {
  // The riskiest layer in the store, because a Sheet gives back strings and the domain is
  // written against boolean|null. A blank cell coerced to false here would undo the
  // tri-state one level below where anyone would look for it.

  it("keeps null, TRUE and FALSE distinct through a round trip", () => {
    const row = rowFromSheet({
      finding_key: "k", scope: "sca", severity: "HIGH", status: "OPEN",
      has_kev: "TRUE", has_exploit: "FALSE", epss: "0.42",
    });
    expect(row.has_kev).toBe(true);
    expect(row.has_exploit).toBe(false);
    expect(row.epss).toBe(0.42);

    const blank = rowFromSheet({ finding_key: "k", scope: "sca", has_kev: "", has_exploit: null });
    expect(blank.has_kev).toBeNull();   // never evaluated
    expect(blank.has_exploit).toBeNull();
  });

  it("reads a column that did not exist when the row was written as null", () => {
    // Header-mapped writes make a new column additive, and a row that predates it simply has
    // no cell. That absence is unmeasured, not false.
    const row = rowFromSheet({ finding_key: "k", scope: "secrets" });
    expect(row.twin_count).toBeNull();
    expect(row.validation_state).toBeNull();
    expect(row.reopened_count).toBe(0); // the one field with a real zero identity
  });

  it("writes every ledger column, nulls included", () => {
    // A column omitted from the write is a cell the header-mapped writer leaves alone —
    // which on an overwrite means the previous scan's value survives into a row that no
    // longer claims it.
    const out = rowToSheet(rowFromSheet({ finding_key: "k", scope: "sast" }));
    expect(Object.keys(out)).toContain("rotated_at");
    expect(Object.keys(out)).toContain("twin_first_seen_spread_days");
    expect(out.rotated_at).toBeNull();
  });

  it("survives a full ledger row unchanged", () => {
    const { rows } = replay();
    const original = rows.find((r) => r.scope === "secrets" && (r.twin_count ?? 1) > 1);
    expect(rowFromSheet(rowToSheet(original))).toEqual(original);
  });
});
