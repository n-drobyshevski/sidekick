// The v2 ledger snapshot (columns + a string dictionary) must read back exactly what the v1
// snapshot (plain JSON of the objects) read back — same keys, same values — or every cold page
// would be computed from a subtly different ledger. The v1 answer is the oracle: a JSON round
// trip of the input.
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { decodeSnapshot, encodeSnapshot } from "../../gas_shared/domain/snapshotCodec";

type Row = Record<string, unknown>;
const viaJson = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const roundTrip = (ledger: Record<string, Row>, episodes: Row[]) =>
  decodeSnapshot(viaJson(encodeSnapshot(ledger, episodes)));

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const LEDGER_COLS = ["vuln_key", "cve", "severity", "asset_id", "asset_name", "status",
  "first_seen", "resolved_at", "reopened_count", "tags_json", "has_kev", "epss", "portal_url"];

function randomRow(r: () => number, i: number): Row {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const asset = "asset-" + Math.floor(r() * 30);
  const row: Row = {
    vuln_key: "k" + i,
    cve: r() < 0.1 ? null : "CVE-2026-" + Math.floor(r() * 50),
    severity: pick(["CRITICAL", "HIGH", "MEDIUM", "LOW", null]),
    asset_id: asset,
    asset_name: r() < 0.05 ? 42 : asset.toUpperCase(), // a stray number in a string column
    status: pick(["OPEN", "RESOLVED"]),
    first_seen: pick(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-03-01 00:00:00", ""]),
    resolved_at: r() < 0.5 ? null : "2026-04-0" + (1 + Math.floor(r() * 9)) + "T00:00:00Z",
    reopened_count: Math.floor(r() * 3),
    tags_json: JSON.stringify({ "Wiz/Domain": pick(["A", "B", "ü\u2028\"q\""]), n: Math.floor(r() * 3) }),
    has_kev: pick([true, false, null]),
    epss: r() < 0.2 ? null : r(),
    portal_url: "https://example.test/f/" + i,
  };
  if (r() < 0.05) delete row["cve"]; // an absent key, not a null
  if (r() < 0.05) row["cve"] = undefined; // undefined: JSON drops it, so must the codec
  return row;
}

describe("snapshot codec v2", () => {
  it("reads back exactly what the v1 JSON snapshot did, on random ledgers", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed);
      const n = Math.floor(r() * 300);
      const ledger: Record<string, Row> = {};
      for (let i = 0; i < n; i++) {
        const row = randomRow(r, i);
        ledger[String(row["vuln_key"])] = row;
      }
      const episodes = Array.from({ length: Math.floor(r() * 50) }, (_, i) => randomRow(r, 10_000 + i));
      const got = roundTrip(ledger, episodes)!;
      expect(got.ledger).toStrictEqual(viaJson(ledger));
      expect(got.episodes).toStrictEqual(viaJson(episodes));
      // Key order too, for the uniform rows the ledger actually holds.
      expect(Object.keys(got.ledger)).toEqual(Object.keys(ledger));
    }
  });

  it("keeps each row's own key order when rows are uniform", () => {
    const row = Object.fromEntries(LEDGER_COLS.map((c) => [c, c === "vuln_key" ? "k1" : null]));
    const got = roundTrip({ k1: row }, [])!;
    expect(JSON.stringify(got.ledger)).toBe(JSON.stringify({ k1: row }));
  });

  it("keeps a ledger key that differs from its row's vuln_key", () => {
    const got = roundTrip({ other: { vuln_key: "k1", status: "OPEN" } }, [])!;
    expect(Object.keys(got.ledger)).toEqual(["other"]);
  });

  it("round-trips the empty ledger", () => {
    expect(roundTrip({}, [])).toEqual({ ledger: {}, episodes: [] });
  });

  // Rollback safety: a v1 reader accepts anything carrying `ledger` and `episodes`, so v2 must
  // carry neither — an old deployment then reads the tabs instead of misreading an encoded table.
  it("is not mistaken for a v1 snapshot by a v1 reader", () => {
    const v2 = viaJson(encodeSnapshot({ k1: { vuln_key: "k1" } }, [])) as unknown as Record<string, unknown>;
    expect(v2["ledger"]).toBeUndefined();
    expect(v2["episodes"]).toBeUndefined();
  });

  it("refuses anything that is not a v2 snapshot", () => {
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot({ version: 1, ledger: {}, episodes: [] })).toBeNull();
    expect(decodeSnapshot([1, 2])).toBeNull();
  });

  it("writes far less text than v1 for a ledger shaped like production", () => {
    // 58,679 findings over 2,404 assets, each asset carrying one tag bag that v1 copied onto
    // every one of its findings.
    const ledger: Record<string, Row> = {};
    const tagsOf = (a: number) =>
      JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, t) => ["tag-" + t, "value-" + a + "-" + t])));
    for (let i = 0; i < 58_679; i++) {
      const a = i % 2404;
      ledger["k" + i] = {
        vuln_key: "k" + i, cve: "CVE-2026-" + (i % 3000), severity: "HIGH", asset_id: "asset-" + a,
        asset_name: "host-" + a, asset_type: "VIRTUAL_MACHINE", cloud: "AWS",
        first_seen: "2026-0" + (1 + (i % 9)) + "-01T00:00:00Z", last_seen: "2026-09-20T00:00:00Z",
        status: "OPEN", resolved_at: null, resolution_src: null, reopened_count: 0,
        first_scan_id: "scan-" + (i % 90), last_scan_id: "scan-89",
        subscription_name: "sub-" + (a % 60), subscription_ext_id: "ext-" + (a % 60),
        tags_json: tagsOf(a), fix_date: null, fix_observed_at: null,
        has_kev: false, has_exploit: false, epss: 0.01, risk_observed_at: "2026-09-20T00:00:00Z",
        portal_url: "https://app.wiz.io/f#" + i,
      };
    }
    const v1 = JSON.stringify({ version: 1, ledger, episodes: [] });
    const v2 = JSON.stringify(encodeSnapshot(ledger, []));
    const t0 = performance.now();
    decodeSnapshot(JSON.parse(v2));
    const v2ReadMs = performance.now() - t0;
    const t1 = performance.now();
    JSON.parse(v1);
    const v1ReadMs = performance.now() - t1;
    console.log(
      `v1 ${(v1.length / 1e6).toFixed(1)} MB (${(gzipSync(v1).length / 1e6).toFixed(2)} MB gz) read ${v1ReadMs.toFixed(0)} ms; ` +
      `v2 ${(v2.length / 1e6).toFixed(1)} MB (${(gzipSync(v2).length / 1e6).toFixed(2)} MB gz) read ${v2ReadMs.toFixed(0)} ms`,
    );
    expect(v2.length).toBeLessThan(v1.length / 3);
  });
});
