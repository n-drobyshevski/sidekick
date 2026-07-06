import { describe, it } from "vitest";
import { reconcile, tagsJson, type LedgerRow, type ReconcileOptions } from "../src/domain/reconcile";
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
