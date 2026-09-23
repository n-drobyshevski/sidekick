// The shared v2 snapshot codec (gas_shared/domain/snapshotCodec.ts), from this register's side.
// Its exactness on random and adversarial rows is gas/test/snapshotCodec.test.ts's; what is this
// register's own is the KEY FIELD — the ledger map is keyed by `finding_key` here, not gas/'s
// `vuln_key` — and the size on a ledger of this register's shape.
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeSnapshot, encodeSnapshot } from "../../gas_shared/domain/snapshotCodec";

type Row = Record<string, unknown>;
const viaJson = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function devsecopsLedger(n: number): Record<string, Row> {
  const ledger: Record<string, Row> = {};
  for (let i = 0; i < n; i++) {
    const repo = i % 700;
    const key = `sca:${repo}:pkg-${i % 900}:CVE-2026-${i}`;
    ledger[key] = {
      finding_key: key, scope: ["sca", "sast", "secrets"][i % 3], identifier: `CVE-2026-${i}`,
      component: `pkg-${i % 900}`, severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW"][i % 4],
      repo_id: `repo-${repo}`, repo_name: `org/service-${repo}`, branch: "main",
      projects_json: JSON.stringify([`project-${repo % 40}`]), status: i % 3 ? "OPEN" : "RESOLVED",
      first_seen: `2026-0${1 + (i % 9)}-01T00:00:00Z`, last_seen: "2026-09-20T00:00:00Z",
      resolved_at: i % 3 ? null : "2026-09-01T00:00:00Z", reopened_count: i % 2,
      first_scan_id: `sync-${i % 30}:sca`, last_scan_id: "sync-29:sca", fix_available: i % 5 !== 0,
      portal_url: `https://app.wiz.io/findings#${i}`,
    };
  }
  return ledger;
}

describe("snapshot codec, keyed by finding_key", () => {
  it("round-trips a finding_key ledger exactly, without writing the keys twice", () => {
    const ledger = devsecopsLedger(500);
    const episodes = [{ finding_key: "e1", resolved_at: "2026-02-01T00:00:00Z", mttr_days: 3.25 }];
    const snap = viaJson(encodeSnapshot(ledger, episodes, "finding_key"));
    expect(snap.keyField).toBe("finding_key");
    expect(snap.ledgerKeys).toBeUndefined();
    const got = decodeSnapshot(snap)!;
    expect(got.ledger).toStrictEqual(viaJson(ledger));
    expect(Object.keys(got.ledger)).toEqual(Object.keys(ledger));
    expect(got.episodes).toStrictEqual(viaJson(episodes));
  });

  it("keeps a map key that differs from its row's finding_key", () => {
    const snap = viaJson(encodeSnapshot({ other: { finding_key: "k1" } }, [], "finding_key"));
    expect(Object.keys(decodeSnapshot(snap)!.ledger)).toEqual(["other"]);
  });

  it("still decodes a gas/ file written before the key field existed, as vuln_key", () => {
    const snap = viaJson(encodeSnapshot({ k1: { vuln_key: "k1", status: "OPEN" } }, []));
    expect(snap.keyField).toBeUndefined();
    expect(decodeSnapshot(snap)!.ledger).toStrictEqual({ k1: { vuln_key: "k1", status: "OPEN" } });
  });

  it("writes far less text than v1 for a ledger shaped like this register", () => {
    const ledger = devsecopsLedger(28_000);
    const v1 = JSON.stringify({ version: 1, scans: [], ledger, episodes: [] });
    const v2 = JSON.stringify(encodeSnapshot(ledger, [], "finding_key"));
    console.log(
      `v1 ${(v1.length / 1e6).toFixed(1)} MB (${(gzipSync(v1).length / 1e6).toFixed(2)} MB gz); ` +
      `v2 ${(v2.length / 1e6).toFixed(1)} MB (${(gzipSync(v2).length / 1e6).toFixed(2)} MB gz)`,
    );
    expect(v2.length).toBeLessThan(v1.length / 2);
  });
});
