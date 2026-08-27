#!/usr/bin/env node
//
// A READ-ONLY probe against the Wiz tenant. It answers "will the battery work here, and what
// does this tenant actually offer" before a single row is written anywhere.
//
//   npm run probe                     everything below
//   npm run probe -- --dry-run        print exactly what would be sent; send nothing
//   npm run probe -- --schema         introspection only: the finding types and their fields
//   npm run probe -- --roots          introspection only: which query roots exist (secrets!)
//   npm run probe -- --scope=sast     one register instead of all of them
//   npm run probe -- --first=25       rows per sample page (default 3)
//
// IT SENDS THE APP'S OWN QUERIES. src/server/wizQueries.ts is bundled and imported here,
// which is why that file may never touch an Apps Script global. A probe that quietly
// diverged from the battery is worse than no probe.
//
// NOTHING HERE MUTATES. No sheet, no Drive file, no Wiz object. The only local write is
// probe-report.json, and only when --report is passed.

import { build } from "esbuild";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { envValue, temporalFields, temporalName, temporalType } from "./probeHelpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};

const DRY_RUN = has("--dry-run");
const SCHEMA_ONLY = has("--schema");
const ROOTS_ONLY = has("--roots");
const REPORT = has("--report");
const FIRST = Number(val("--first", "3"));
const ONLY_SCOPE = val("--scope", null);

/* ------------------------------------------------------------------ credentials */
// Two accepted locations because both are the obvious one, and looking in only one while
// staying silent about the other is how a filled-in file reads as empty. dev/ wins per key.
function loadEnv() {
  for (const p of [join(HERE, ".env.local"), join(HERE, "dev/.env.local")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      process.env[m[1]] = envValue(m[2]);
    }
  }
}

loadEnv();

const API_URL = process.env.WIZ_API_URL;
const AUTH_URL = process.env.WIZ_AUTH_URL ?? "https://auth.app.wiz.io/oauth/token";
const STATIC_TOKEN = process.env.WIZ_API_TOKEN;
const CLIENT_ID = process.env.WIZ_CLIENT_ID;
const CLIENT_SECRET = process.env.WIZ_CLIENT_SECRET;
const PROJECT_ID = process.env.WIZ_PROJECT_ID_V2 || null;

const shown = (v) => (v ? `set, length ${v.length}` : "UNSET");
if (!DRY_RUN && (!API_URL || (!STATIC_TOKEN && !(CLIENT_ID && CLIENT_SECRET)))) {
  console.error(
    "\nNo credentials. Put them in gas_devsecops/.env.local (or dev/.env.local):\n\n" +
    "  WIZ_API_URL=https://api.<dc>.app.wiz.io/graphql\n" +
    "  WIZ_API_TOKEN=...            # or the client pair below\n" +
    "  WIZ_CLIENT_ID=...\n" +
    "  WIZ_CLIENT_SECRET=...\n" +
    "  WIZ_PROJECT_ID_V2=...        # optional; scopes every query\n\n" +
    `  WIZ_API_URL       ${shown(API_URL)}\n` +
    `  WIZ_API_TOKEN     ${shown(STATIC_TOKEN)}\n` +
    `  WIZ_CLIENT_ID     ${shown(CLIENT_ID)}\n` +
    `  WIZ_CLIENT_SECRET ${STATIC_TOKEN || CLIENT_SECRET ? "set" : "UNSET"}\n\n` +
    "  --dry-run needs none of it.\n",
  );
  process.exit(2);
}

/* --------------------------------------------------- load the app's own query layer */
const dir = mkdtempSync(join(tmpdir(), "wiz-probe-"));
const outfile = join(dir, "app.mjs");
await build({
  stdin: {
    contents: `export { QUERIES, Q_SAST, Q_SCA, Q_SECRETS, SAST_FETCH_RESOLVED,
      PAGE_SIZE, buildFilter, buildVariables, severityFilter } from "./src/server/wizQueries";
      export { SCOPES, DEFAULT_FETCH_SEVERITIES } from "./src/domain/config";`,
    resolveDir: HERE,
    loader: "ts",
  },
  bundle: true, outfile, platform: "node", format: "esm",
});
const app = await import(pathToFileURL(outfile).href);
const cleanup = () => rmSync(dir, { recursive: true, force: true });

/**
 * The ONE way this process ends.
 *
 * Every mode used to exit on its own line, and `--roots --report` exited before reaching
 * the writeFileSync at the bottom — so the flag was accepted, no report appeared, and
 * nothing said why. A single exit means no flag combination can skip the write.
 *
 * The report MERGES into any existing file rather than replacing it, because the natural
 * way to use this is several narrow runs in a row (`--roots`, then `--schema`, then a
 * sample), and a later run clobbering an earlier run's answers is how a finding gets lost
 * between two terminal scrollbacks.
 */
function finish(code) {
  if (REPORT) {
    const at = join(HERE, "probe-report.json");
    let prior = {};
    if (existsSync(at)) {
      try { prior = JSON.parse(readFileSync(at, "utf8")); } catch { prior = {}; }
    }
    const merged = {
      ...prior, ...report,
      findings: { ...(prior.findings ?? {}), ...report.findings },
    };
    writeFileSync(at, JSON.stringify(merged, null, 2));
    console.log(`\nprobe-report.json written (git-ignored), ${Object.keys(merged.findings).length} finding key(s).`);
  }
  cleanup();
  process.exit(code);
}

const SCOPES = ONLY_SCOPE ? [ONLY_SCOPE] : app.SCOPES;
const report = { at: null, api: API_URL ?? null, project: PROJECT_ID, findings: {} };

/* ------------------------------------------------------------------- transport */
async function token() {
  if (STATIC_TOKEN && STATIC_TOKEN.trim()) return STATIC_TOKEN.trim();
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials", audience: "wiz-api",
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`token request failed (${res.status}): ${body.slice(0, 300)}`);
  const t = JSON.parse(body).access_token;
  if (!t) throw new Error("token response carried no access_token");
  return t;
}
const BEARER = DRY_RUN ? "" : await token();

/**
 * One GraphQL POST.
 *
 * PARTIAL FAILURE IS NOT FAILURE, and that distinction is the reason this returns a triage
 * object instead of throwing. The captured sast_response.json is a 200 carrying 40 good
 * nodes AND an `errors` array (a Weakness whose name was null). brick/devsecops raises on
 * any `errors`, which would reject that exact response wholesale. Data and errors are
 * reported side by side here so a caller can decide.
 */
async function post(query, variables) {
  let res, text;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${BEARER}` },
      body: JSON.stringify({ query, variables }),
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, unreachable: true, error: `UNREACHABLE: ${e?.message ?? e}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 400)}` };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, error: `unparseable: ${text.slice(0, 300)}` }; }
  const errs = (body.errors ?? []).map((e) => e.message);
  return { ok: !!body.data, data: body.data, errors: errs, partial: !!body.data && errs.length > 0 };
}

/* ---------------------------------------------------------------- introspection */
function renderType(t) {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return renderType(t.ofType) + "!";
  if (t.kind === "LIST") return "[" + renderType(t.ofType) + "]";
  return t.name || t.kind || "?";
}

/**
 * How EVERY field of a filter type must be sent — a bare list or an object filter.
 *
 * Every field, not a handful named in advance. The first version printed the three keys I
 * happened to guess at, which is the wrong shape of answer to a question whose whole lesson
 * is that you cannot generalise: SecretInstanceFilters sends `status`, `validationStatus`
 * and `severity` as objects while `projectId` IN THE SAME TYPE is a bare [String!]. Naming
 * the keys in advance is how `codeToCloudPipelineStage` went unprinted and had to be
 * inferred. Print them all; inference is what broke SAST.
 */
function printFilterShapes(fields) {
  const rows = fields.map((f) => {
    const list = /^\[/.test(f.type);
    const scalar = /^(String|Int|Float|Boolean|ID)!?$/.test(f.type);
    return {
      name: f.name,
      type: f.type,
      how: list ? "bare LIST" : scalar ? "scalar" : "OBJECT { equals: [...] }",
    };
  });
  const w = Math.max(...rows.map((r) => r.name.length), 4);
  console.log("\n    how each field must be SENT:");
  for (const r of rows) {
    console.log(`      ${r.name.padEnd(w)}  ${r.type.padEnd(38)} -> ${r.how}`);
  }
  const objects = rows.filter((r) => r.how.startsWith("OBJECT")).map((r) => r.name);
  console.log(`\n      OBJECT_FILTERS entry: [${objects.map((n) => `"${n}"`).join(", ")}]`);
}

/** Output fields of an object type, or null when introspection is closed. */
async function typeFields(name) {
  const q = `query SidekickTypeProbe {
    __type(name: "${name}") {
      kind
      fields { name type { kind name ofType { kind name ofType { kind name } } } }
      enumValues { name }
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
  }`;
  const r = await post(q, {});
  if (!r.ok) return { error: r.errors?.join(" | ") || r.error };
  const t = r.data?.__type;
  if (!t) return null;
  return {
    kind: t.kind,
    fields: (t.fields ?? []).map((f) => ({ name: f.name, type: renderType(f.type) })),
    enumValues: (t.enumValues ?? []).map((e) => e.name),
    inputFields: (t.inputFields ?? []).map((f) => ({ name: f.name, type: renderType(f.type) })),
  };
}


/* ============================================================== DRY RUN ========= */
if (DRY_RUN) {
  console.log("\n=== dry run — nothing leaves this process ===\n");
  for (const scope of SCOPES) {
    const doc = app.QUERIES[scope];
    console.log(`--- ${scope} ---`);
    if (!doc) {
      console.log("  NO QUERY DOCUMENT. See wizQueries.ts Q_SECRETS for why it is absent\n"
        + "  rather than guessed, and use --roots against a real tenant to find the root.\n");
      continue;
    }
    const vars = app.buildVariables(scope, {
      severities: app.DEFAULT_FETCH_SEVERITIES[scope], projectId: PROJECT_ID, first: FIRST,
    });
    console.log("  variables: " + JSON.stringify(vars, null, 2).replace(/\n/g, "\n  "));
    console.log(`  document:  ${doc.split("\n")[0]} … (${doc.split("\n").length} lines)\n`);
  }
  console.log(`SAST_FETCH_RESOLVED = ${app.SAST_FETCH_RESOLVED}`);
  finish(0);
}

/* ============================================================== LIVE =========== */
report.at = new Date().toISOString();
console.log(`\nWiz Sidekick DevSecOps — read-only probe`);
console.log(`  ${API_URL}`);
console.log(`  project ${PROJECT_ID ?? "(all)"}\n`);

// ---- 1. which query roots exist. This is how the secrets register gets found.
if (ROOTS_ONLY || !SCHEMA_ONLY) {
  console.log("=== query roots this tenant offers ===");
  const root = await typeFields("Query");
  if (!root || root.error) {
    console.log(`  introspection unavailable (${root?.error ?? "no __type"}).`);
    console.log("  Falling back to probing candidate roots by name.\n");
    for (const cand of ["secretFindings", "secrets", "gitSecretFindings", "codeSecretFindings"]) {
      const r = await post(`query P { ${cand}(first: 1) { __typename } }`, {});
      const verdict = r.ok ? "EXISTS" : (/Cannot query field/i.test(r.errors?.[0] ?? "") ? "no" : "?");
      console.log(`  ${cand.padEnd(24)} ${verdict}  ${r.ok ? "" : (r.errors?.[0] ?? r.error ?? "").slice(0, 110)}`);
    }
  } else {
    const interesting = root.fields.filter((f) =>
      /finding|secret|vuln|sast|sca|issue/i.test(f.name));
    for (const f of interesting) console.log(`  ${f.name.padEnd(34)} ${f.type}`);
    report.findings.roots = interesting.map((f) => f.name);
    const secretRoots = interesting.filter((f) => /secret/i.test(f.name));
    console.log(secretRoots.length
      ? `\n  SECRETS ROOT FOUND: ${secretRoots.map((f) => f.name).join(", ")}`
      : "\n  No secret-shaped root in this tenant's Query type.");
  }
  console.log();
  if (ROOTS_ONLY) finish(0);
}

// ---- 2. THE QUESTION: does a SAST finding carry a timestamp?
console.log("=== does SASTFinding expose a timestamp? ===");
console.log("  The pagination cursor decodes to a server-side date, so one exists.");
console.log("  The question is whether it is selectable.\n");

const sastType = await typeFields("SASTFinding");
if (!sastType || sastType.error) {
  console.log(`  introspection unavailable (${sastType?.error ?? "no __type"}).`);
  console.log("  Probing candidate field names one at a time and reading the refusal:\n");
  const CANDIDATES = [
    "firstDetectedAt", "lastDetectedAt", "resolvedAt", "createdAt", "updatedAt",
    "detectedAt", "firstSeenAt", "lastSeenAt", "openedAt", "closedAt", "analyzedAt",
    "firstSeen", "lastSeen", "timestamp", "date",
  ];
  const found = [];
  for (const f of CANDIDATES) {
    const r = await post(
      `query P($filterBy: SASTFindingFilters, $first: Int) {
         sastFindings(filterBy: $filterBy, first: $first) { nodes { id ${f} } } }`,
      { filterBy: app.buildFilter("sast", { projectId: PROJECT_ID }), first: 1 },
    );
    const refused = /Cannot query field|Unknown field|not found/i.test(r.errors?.[0] ?? "");
    if (r.ok && !refused) {
      const v = r.data?.sastFindings?.nodes?.[0]?.[f];
      found.push({ field: f, sample: v ?? null });
      console.log(`  ${f.padEnd(18)} SELECTABLE   sample: ${JSON.stringify(v ?? null)}`);
    } else {
      console.log(`  ${f.padEnd(18)} no           ${(r.errors?.[0] ?? r.error ?? "").slice(0, 90)}`);
    }
  }
  report.findings.sastTimestamps = found;
  console.log(found.length
    ? `\n  ANSWER: ${found.length} selectable timestamp field(s). SAST can have a real clock.`
    : "\n  ANSWER: none selectable. SAST stays dated from observation; keep SAST_FETCH_RESOLVED false.");
} else {
  const t = temporalFields(sastType.fields);
  console.log(`  SASTFinding exposes ${sastType.fields.length} fields. Temporal-looking ones:`);
  if (t.length) for (const f of t) console.log(`    ${f.name.padEnd(22)} ${f.type}`);
  else console.log("    (none)");
  report.findings.sastFields = sastType.fields;
  report.findings.sastTimestamps = t;
  console.log(t.length
    ? "\n  ANSWER: a timestamp IS selectable. SAST can have a real clock — see wizQueries.ts."
    : "\n  ANSWER: no timestamp on the type. SAST stays dated from observation.");
}

// The order enum is the other place a date field shows itself: the cursor named
// `finding_severityOrder`, so the enum lists what the server can sort by.
const order = await typeFields("SASTFindingOrderField") ?? await typeFields("SASTFindingOrder");
if (order && !order.error && (order.enumValues?.length || order.inputFields?.length)) {
  const names = order.enumValues.length ? order.enumValues : order.inputFields.map((f) => f.name);
  const dated = names.filter((n) => temporalName(n) || temporalType(n));
  console.log(`\n  Sortable fields naming a time: ${dated.length ? dated.join(", ") : "(none)"}`);
  report.findings.sastOrderFields = names;
}
console.log();

// ---- 2b. the secrets node and filter types, so Q_SECRETS can be WRITTEN rather than guessed
//
// The root, both clocks and most of the filter are already known (PROBE_FINDINGS.md §3).
// What is not known is the node's IDENTITY fields — which secret, in which file, at which
// commit — and the SHAPE of the status / validationStatus filters. That second one is not
// a detail: assuming a filter shape is exactly what made every SAST sync fetch zero rows.
// ALL THREE FILTER TYPES, not just the new one. printFilterShapes would have caught the
// SAST defect on day one — SASTFindingFilters.severity printed as an OBJECT next to
// VulnerabilityFindingFilters.severity printed as a bare LIST is the whole finding, visible
// in two adjacent lines. Introspecting only the type currently being written is how that
// stayed invisible through a full pass.
console.log("=== every filter type, and how each field must be sent ===");
for (const name of [
  "SASTFindingFilters", "VulnerabilityFindingFilters",
  "SecretInstance", "SecretInstanceFilters",
]) {
  const shape = await typeFields(name);
  if (!shape || shape.error) {
    console.log(`  ${name}: unavailable (${shape?.error ?? "no __type"})`);
    continue;
  }
  const fields = shape.fields.length ? shape.fields : shape.inputFields;
  console.log(`\n  --- ${name} (${shape.kind}, ${fields.length} fields) ---`);
  for (const f of fields) console.log(`    ${f.name.padEnd(30)} ${f.type}`);
  report.findings[name] = fields;

  if (name.endsWith("Filters")) printFilterShapes(fields);
}
console.log();

if (SCHEMA_ONLY) finish(0);

// ---- 3. the app's own queries, one small page each
console.log("=== the battery's own queries, one page each ===");
for (const scope of SCOPES) {
  const doc = app.QUERIES[scope];
  if (!doc) { console.log(`\n--- ${scope} ---\n  no document yet (see --roots above)`); continue; }
  const vars = app.buildVariables(scope, {
    severities: app.DEFAULT_FETCH_SEVERITIES[scope], projectId: PROJECT_ID, first: FIRST,
  });
  const r = await post(doc, vars);
  console.log(`\n--- ${scope} ---`);
  if (!r.ok) {
    const why = (r.errors?.join(" | ") ?? r.error ?? "").slice(0, 400);
    console.log(`  REFUSED: ${why}`);
    // RECORDED, NOT JUST PRINTED. A refusal used to `continue` without touching the report,
    // so probe-report.json simply had no key for the scope — indistinguishable from a scope
    // nobody asked about. That is how the SAST refusal in §4 would have been missed by
    // anyone reading the file instead of the console, and the report is the artifact that
    // gets pasted between sessions.
    report.findings[scope] = { refused: true, error: why, variables: vars };
    continue;
  }
  const conn = r.data.sastFindings ?? r.data.vulnerabilityFindings ?? {};
  const nodes = conn.nodes ?? [];
  console.log(`  ${nodes.length} node(s)${conn.totalCount != null ? `, totalCount ${conn.totalCount}` : ""}`
    + `, hasNextPage ${conn.pageInfo?.hasNextPage}`);
  if (r.partial) {
    console.log(`  PARTIAL: ${r.errors.length} error(s) alongside good data — e.g. ${r.errors[0].slice(0, 120)}`);
    console.log("  (the battery must tolerate this; brick/devsecops raises on it)");
  }
  if (nodes[0]) {
    const keys = Object.keys(nodes[0]);
    const nulls = keys.filter((k) => nodes.every((n) => n[k] === null));
    console.log(`  fields: ${keys.join(", ")}`);
    if (nulls.length) console.log(`  ALWAYS NULL in this sample: ${nulls.join(", ")}`);
  }
  report.findings[scope] = {
    count: nodes.length, totalCount: conn.totalCount ?? null,
    partialErrors: r.errors, sample: nodes[0] ?? null,
  };
}

// ---- the secrets severity floor: which severities the categories actually sit at
//
// DEFAULT_FETCH_SEVERITIES.secrets reaches to MEDIUM on the strength of §8.3, which
// established only that PASSWORD and CERTIFICATE sit BELOW HIGH — not that they sit AT
// MEDIUM. If they are LOW, the default is still wrong and the register still has no
// passwords in it. One crosstab settles it.
if (SCOPES.includes("secrets") && app.QUERIES.secrets) {
  console.log("=== secrets: type x severity on the CODE population ===");
  const seen = {};
  let cursor = null;
  let pages = 0;
  // Four pages of 500 is enough to characterise a ~1,958-row register without pretending
  // to be a sync. It is a probe, not an ingest.
  while (pages < 4) {
    const r = await post(app.QUERIES.secrets, app.buildVariables("secrets", {
      severities: [], projectId: PROJECT_ID, first: 500, after: cursor,
    }));
    if (!r.ok) { console.log(`  refused: ${(r.errors?.[0] ?? r.error ?? "").slice(0, 160)}`); break; }
    const conn = r.data.secretInstances ?? {};
    for (const n of conn.nodes ?? []) {
      const k = `${n.type ?? "?"}`;
      seen[k] = seen[k] ?? {};
      const s = n.severity ?? "?";
      seen[k][s] = (seen[k][s] ?? 0) + 1;
    }
    pages += 1;
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  const sevs = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL", "?"];
  const names = Object.keys(seen).sort();
  if (names.length) {
    console.log("  " + "type".padEnd(24) + sevs.map((s) => s.slice(0, 5).padStart(7)).join(""));
    for (const n of names) {
      console.log("  " + n.padEnd(24) + sevs.map((s) => String(seen[n][s] ?? 0).padStart(7)).join(""));
    }
    const belowHigh = names.filter((n) => !(seen[n].CRITICAL || seen[n].HIGH));
    console.log(`\n  categories with NOTHING at CRITICAL/HIGH: ${belowHigh.join(", ") || "(none)"}`);
    console.log(`  DEFAULT_FETCH_SEVERITIES.secrets is currently [${app.DEFAULT_FETCH_SEVERITIES.secrets.join(", ")}]`);
    console.log("  If a category above has rows ONLY at LOW or INFORMATIONAL, that default is still too high.");
    report.findings.secretsTypeSeverity = seen;
  }
  console.log();
}

console.log();
finish(0);
