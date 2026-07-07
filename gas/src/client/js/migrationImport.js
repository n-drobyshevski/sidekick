// Parsing for migration bundles exported by the legacy Streamlit dashboard
// (wiz_dashboard/data/migrate.py). Pure and DOM-free so it is unit-testable.
// Structural checks only — deep validation (timestamp ordering, sealed-state
// preconditions, row caps) stays server-side in api_importMigration.

export const MIGRATION_KIND = "wiz-sidekick-migration";
export const MANIFEST_KIND = "wiz-sidekick-migration-manifest";
export const SHARD_KIND = "wiz-sidekick-migration-shard";
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

/**
 * Classify a multi-file selection into a `single` full bundle or a `sharded` set (one
 * manifest + its N shard files, contiguous 0..N-1). Each file is parsed once.
 * Returns { mode:"single", text } | { mode:"sharded", manifest, manifestText, shards, counts }
 * | { error }. `shards` = [{ index, text }] in index order (text kept for gzip upload).
 */
export function classifyImportFiles(files) {
  const parsed = [];
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(f.text);
    } catch (e) {
      return { error: `${f.name}: not valid JSON (${e.message}).` };
    }
    parsed.push({ name: f.name, text: f.text, kind: data && data.kind, data });
  }

  if (parsed.length === 1 && parsed[0].kind === MIGRATION_KIND) {
    return { mode: "single", text: parsed[0].text };
  }

  const others = parsed.filter((p) => p.kind !== MANIFEST_KIND && p.kind !== SHARD_KIND);
  if (others.length) {
    return {
      error: parsed.some((p) => p.kind === MIGRATION_KIND)
        ? "Select either one full bundle or a manifest + its shards, not both."
        : `${others[0].name}: unrecognized file (kind ${JSON.stringify(others[0].kind)}).`,
    };
  }
  const manifests = parsed.filter((p) => p.kind === MANIFEST_KIND);
  if (manifests.length !== 1) {
    return { error: "Select exactly one manifest.json together with its shard files." };
  }
  const m = manifests[0].data;
  if (Number(m.version) !== MIGRATION_VERSION) {
    return { error: `Unsupported manifest version ${m.version} — expected ${MIGRATION_VERSION}.` };
  }
  if (!Array.isArray(m.scans)) return { error: "Manifest scans must be a list." };
  const shardCount = Number(m.shard_count);

  const shards = parsed
    .filter((p) => p.kind === SHARD_KIND)
    .map((p) => ({ index: Number(p.data.index), text: p.text }))
    .sort((a, b) => a.index - b.index);
  if (shards.length !== shardCount) {
    return { error: `Expected ${shardCount} shard(s) for this manifest, got ${shards.length}.` };
  }
  for (let i = 0; i < shards.length; i++) {
    if (shards[i].index !== i) return { error: `Shard ${i} is missing or duplicated.` };
  }
  return {
    mode: "sharded",
    manifest: m,
    manifestText: manifests[0].text,
    shards,
    counts: {
      scans: m.scans.length,
      vulns: (m.totals && m.totals.ledger) || 0,
      episodes: (m.totals && m.totals.episodes) || 0,
      history: (m.mttr_history || []).length,
    },
  };
}
