// Client-side migration bundle parser (pure module, mirrors domainsImport.test.js).

import { describe, expect, it } from "vitest";
import {
  MAX_BUNDLE_BYTES,
  MIGRATION_KIND,
  parseMigrationBundle,
} from "../src/client/js/migrationImport.js";

const VALID = {
  kind: "wiz-sidekick-migration",
  version: 1,
  exported_at: "2026-07-01T00:00:00Z",
  scans: [{ scan_id: "2026-01-05T06:00:00Z", ts: "2026-01-05T06:00:00Z", mode: "live",
            shape: "flat", total: 3, new_count: 3, resolved_count: 0,
            reopened_count: 0, severities: null, sealed: 0 }],
  ledger: [{ vuln_key: "id:A", cve: "CVE-A", severity: "CRITICAL", status: "OPEN" }],
  episodes: [{ vuln_key: "id:E", compaction_id: "abc" }],
  mttr_history: [{ date: "2026-01-20", median_days: 5 }],
};

describe("parseMigrationBundle", () => {
  it("accepts a canonical bundle and reports counts", () => {
    const res = parseMigrationBundle(JSON.stringify(VALID));
    expect(res.error).toBeUndefined();
    expect(res.counts).toEqual({ scans: 1, vulns: 1, episodes: 1, history: 1 });
    expect(res.bundle.kind).toBe(MIGRATION_KIND);
    expect(res.bundle.exported_at).toBe("2026-07-01T00:00:00Z");
  });

  it("defaults absent tables to empty lists", () => {
    const res = parseMigrationBundle(JSON.stringify({ kind: MIGRATION_KIND, version: 1 }));
    expect(res.error).toBeUndefined();
    expect(res.bundle.scans).toEqual([]);
    expect(res.counts).toEqual({ scans: 0, vulns: 0, episodes: 0, history: 0 });
  });

  it("rejects invalid JSON", () => {
    expect(parseMigrationBundle("{nope").error).toMatch(/Not valid JSON/);
  });

  it("rejects non-object payloads", () => {
    expect(parseMigrationBundle("[1,2]").error).toMatch(/migration bundle/);
    expect(parseMigrationBundle("null").error).toMatch(/migration bundle/);
  });

  it("points a domains export at the Settings page", () => {
    const res = parseMigrationBundle(JSON.stringify({ kind: "wiz-sidekick-domains", items: [] }));
    expect(res.error).toMatch(/Settings page/);
  });

  it("rejects a wrong kind and an unsupported version", () => {
    expect(parseMigrationBundle(JSON.stringify({ kind: "other" })).error).toMatch(/kind/);
    expect(
      parseMigrationBundle(JSON.stringify({ kind: MIGRATION_KIND, version: 99 })).error,
    ).toMatch(/version 99/);
  });

  it("rejects non-list tables and malformed rows", () => {
    expect(
      parseMigrationBundle(JSON.stringify({ kind: MIGRATION_KIND, version: 1, ledger: {} })).error,
    ).toMatch(/"ledger" must be a list/);
    expect(
      parseMigrationBundle(
        JSON.stringify({ kind: MIGRATION_KIND, version: 1, scans: [{ ts: "x" }] }),
      ).error,
    ).toMatch(/Scan 1/);
    expect(
      parseMigrationBundle(
        JSON.stringify({ kind: MIGRATION_KIND, version: 1, episodes: [{ vuln_key: "" }] }),
      ).error,
    ).toMatch(/episodes row 1/);
  });

  it("exposes a sane RPC size guard", () => {
    expect(MAX_BUNDLE_BYTES).toBe(64 * 1024 * 1024);
  });
});
