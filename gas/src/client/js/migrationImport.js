// Parsing for migration bundles exported by the legacy Streamlit dashboard
// (wiz_dashboard/data/migrate.py). Pure and DOM-free so it is unit-testable.
// Structural checks only — deep validation (timestamp ordering, sealed-state
// preconditions, row caps) stays server-side in api_importMigration.

export const MIGRATION_KIND = "wiz-sidekick-migration";
export const MIGRATION_VERSION = 1;

// Single-RPC guard. The bundle is gzipped before it crosses google.script.run (see
// gzipToBase64), so this ceiling is on the raw JSON on disk: ~64MB of JSON compresses to
// a few MB on the wire and still parses within one server execution. Larger than that is
// beyond what the Sheets-backed ledger can absorb anyway — export a windowed live bundle.
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/**
 * gzip `text` and base64-encode it for a compact google.script.run argument, or null when
 * the browser lacks CompressionStream (caller then falls back to the uncompressed path).
 */
export async function gzipToBase64(text) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // chunk the fromCharCode call so a big array can't overflow the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const TABLE_NAMES = ["scans", "ledger", "episodes", "mttr_history"];

/**
 * Migration-bundle JSON text → { bundle, counts } or { error }.
 * counts = { scans, vulns, episodes, history } for the confirm dialog.
 */
export function parseMigrationBundle(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: "Not valid JSON: " + e.message };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Unrecognized format — expected a migration bundle object." };
  }
  if (data.kind === "wiz-sidekick-domains") {
    return { error: "This is a domains export — import it on the Settings page instead." };
  }
  if (data.kind !== MIGRATION_KIND) {
    return { error: `Not a migration bundle — expected "kind": "${MIGRATION_KIND}".` };
  }
  if (Number(data.version) !== MIGRATION_VERSION) {
    return {
      error: `Unsupported bundle version ${data.version} — this app understands version ` +
        `${MIGRATION_VERSION}. The bundle may come from a newer exporter.`,
    };
  }
  const tables = {};
  for (const name of TABLE_NAMES) {
    const value = data[name];
    if (value === undefined || value === null) {
      tables[name] = [];
    } else if (Array.isArray(value)) {
      tables[name] = value;
    } else {
      return { error: `Bundle field "${name}" must be a list.` };
    }
  }
  for (let i = 0; i < tables.scans.length; i++) {
    const s = tables.scans[i];
    if (s === null || typeof s !== "object" || Array.isArray(s) ||
        typeof s.scan_id !== "string" || !s.scan_id || typeof s.ts !== "string" || !s.ts) {
      return { error: `Scan ${i + 1}: missing scan_id or ts.` };
    }
  }
  for (const name of ["ledger", "episodes"]) {
    for (let i = 0; i < tables[name].length; i++) {
      const r = tables[name][i];
      if (r === null || typeof r !== "object" || Array.isArray(r) ||
          typeof r.vuln_key !== "string" || !r.vuln_key) {
        return { error: `${name} row ${i + 1}: missing vuln_key.` };
      }
    }
  }
  return {
    bundle: {
      kind: MIGRATION_KIND,
      version: MIGRATION_VERSION,
      exported_at: typeof data.exported_at === "string" ? data.exported_at : null,
      scans: tables.scans,
      ledger: tables.ledger,
      episodes: tables.episodes,
      mttr_history: tables.mttr_history,
    },
    counts: {
      scans: tables.scans.length,
      vulns: tables.ledger.length,
      episodes: tables.episodes.length,
      history: tables.mttr_history.length,
    },
  };
}
