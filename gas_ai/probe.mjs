// A read-only Wiz probe you can run BEFORE deploying anything.
//
//   npm run probe            one small page per edge-writing step, plus the vocabulary dump
//   npm run probe -- --first=25    ask for more rows per step (default 5)
//   npm run probe -- --vocab-only  introspection only, no traversals
//   npm run probe -- --dry-run     print the exact variables each step would send, send nothing
//   npm run probe -- --diagnose    also run isolation experiments for the steps returning zero
//
// WHY THIS EXISTS ALONGSIDE probeEdgeSteps(). They ask the tenant the same questions and
// should agree; the difference is when you can ask. `probeEdgeSteps()` is an Apps Script
// global, so answering "did the query fixes work?" with it requires deploying the build that
// contains it first — and `pinPostureBaseline()` wants to run BEFORE that deploy. That
// ordering has no solution inside the editor. From here the gate can be answered with nothing
// deployed and nothing pinned, and the deploy decision made afterwards on evidence.
//
// IT SENDS THE APP'S OWN QUERIES, not a hand-written approximation. Every document below is
// the exported constant the battery uses, and every `$query` is built by the same
// `*Variables()` function, which is why `src/server/wizQueriesAi.ts` is kept free of Apps
// Script globals. A probe that re-implemented the traversal would prove things about the
// probe. This is the same discipline that makes exemples/ai_exposure_host_request.js evidence:
// it is generated from the spec rather than transcribed beside it.
//
// WHAT IT DOES NOT DO. Nothing is written to Wiz, the Sheet, Drive or Script Properties, and
// no sync job is created. The one thing it does write is local: `probe-vocabulary.json`, the
// tenant's own entity and relationship enums, because that list currently exists nowhere in
// this repo and every future hop needs to cite it. It asks for `first: 5` by default, and
// every document also selects `totalCount`, so the magnitude comes back without paying for
// the rows. Nothing is cached, so two runs are two independent measurements.
//
// SECRETS. Credentials are read from the environment and never printed; the config echo
// reports presence and length only, exactly as wizDiagnostic() does.

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const FIRST = Number((args.find((a) => a.startsWith("--first=")) ?? "--first=5").split("=")[1]);
const VOCAB_ONLY = args.includes("--vocab-only");
const DRY_RUN = args.includes("--dry-run");
const DIAGNOSE = args.includes("--diagnose");

const API_URL = process.env.WIZ_API_URL;
const AUTH_URL = process.env.WIZ_AUTH_URL ?? "https://auth.app.wiz.io/oauth/token";
const STATIC_TOKEN = process.env.WIZ_API_TOKEN;
const CLIENT_ID = process.env.WIZ_CLIENT_ID;
const CLIENT_SECRET = process.env.WIZ_CLIENT_SECRET;
const PROJECT_ID = process.env.WIZ_PROJECT_ID_V2 || null;
const TYPE_OVERRIDE = (process.env.WIZ_AI_RESOURCE_TYPES ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const preview = (v) => (v ? `set, length ${v.length}` : "UNSET");

if (!API_URL || (!STATIC_TOKEN && !(CLIENT_ID && CLIENT_SECRET))) {
  console.error(
    "Missing configuration. Set WIZ_API_URL plus either WIZ_API_TOKEN, or both\n" +
    "WIZ_CLIENT_ID and WIZ_CLIENT_SECRET. Optional: WIZ_AUTH_URL, WIZ_PROJECT_ID_V2,\n" +
    "WIZ_AI_RESOURCE_TYPES.\n\n" +
    `  WIZ_API_URL       ${preview(API_URL)}\n` +
    `  WIZ_API_TOKEN     ${preview(STATIC_TOKEN)}\n` +
    `  WIZ_CLIENT_ID     ${preview(CLIENT_ID)}\n` +
    `  WIZ_CLIENT_SECRET ${STATIC_TOKEN || CLIENT_SECRET ? "set" : "UNSET"}`,
  );
  process.exit(2);
}

// ---------------------------------------------------------------- load the app's own modules

// The domain and query layers are plain TypeScript with no Apps Script globals, so they can be
// bundled and imported here unchanged. If that ever stops being true this import fails loudly,
// which is the right outcome: a probe that quietly diverged from the battery is worse than none.
const dir = mkdtempSync(join(tmpdir(), "wiz-probe-"));
const outfile = join(dir, "app.mjs");
await build({
  stdin: {
    contents: `
      export { chooseAiResourceTypes, aiFlavored, AI_RESOURCE_TYPE_CANDIDATES,
        Q_AGENTS_NO_GUARDRAIL, Q_AGENT_RUNS_AS, Q_SA_EXCESSIVE_ACCESS,
        Q_AGENT_SENSITIVE_DATA_ACCESS, Q_AI_EXPOSURE, Q_IDENTITY_ACCESS, Q_LINEAGE,
        noGuardrailVariables, agentRunsAsVariables, saExcessiveAccessVariables,
        sensitiveDataAccessVariables, hostExposureVariables, endpointExposureVariables,
        identityAccessVariables, lineageVariables } from "./src/server/wizQueriesAi";
      export { normalizeNoGuardrailPage, normalizeRunsAsPage,
        normalizeSensitiveDataAccessPage, normalizeHostExposurePage,
        normalizeEndpointExposurePage, normalizeIdentityAccessPage,
        normalizeLineagePage } from "./src/domain/syncNormalize";
      export { specVocabulary, toGraphEntityQuery } from "./src/domain/graphExpand";
    `,
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true, outfile, platform: "node", format: "esm",
});
const app = await import(pathToFileURL(outfile).href);

// ------------------------------------------------------------------------------- transport

async function token() {
  if (STATIC_TOKEN && STATIC_TOKEN.trim()) return STATIC_TOKEN.trim();
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      audience: "wiz-api",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`token request failed (${res.status}): ${body.slice(0, 300)}`);
  const t = JSON.parse(body).access_token;
  if (!t) throw new Error("token response carried no access_token");
  return t;
}

const BEARER = DRY_RUN ? "" : await token();

/** One GraphQL POST. Returns the triage rather than throwing, the way testStepVariables does. */
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
    // Unreachable host, DNS, TLS, VPN. Reported rather than thrown so one bad leg does not
    // abandon the run, and so it can never be mistaken for the tenant refusing the document.
    return { ok: false, error: `UNREACHABLE: ${e && e.message ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 400)}` };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, error: `unparseable: ${text.slice(0, 300)}` }; }
  if (body.errors && body.errors.length) {
    return { ok: false, error: body.errors.map((e) => e.message).join(" | ").slice(0, 400) };
  }
  return { ok: true, data: body.data };
}

// -------------------------------------------------------------------------- 1. the config

console.log("=== configuration ===");
console.log(`  WIZ_API_URL        ${API_URL}`);
console.log(`  auth               ${STATIC_TOKEN ? "static WIZ_API_TOKEN" : `oauth ${AUTH_URL}`}`);
console.log(`  WIZ_CLIENT_ID      ${preview(CLIENT_ID)}`);
console.log(`  WIZ_CLIENT_SECRET  ${CLIENT_SECRET ? "set" : "UNSET"}`);
console.log(`  WIZ_PROJECT_ID_V2  ${PROJECT_ID ? `set (${PROJECT_ID})` : "UNSET — steps that scope will run tenant-wide"}`);
console.log(`  rows per step      ${FIRST}`);

// ------------------------------------------------------------------- 2. the tenant's schema


/** `[String!]` / `ProjectFilters` / `String` — the shape a filter field actually wants. */
function renderType(t) {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return renderType(t.ofType) + "!";
  if (t.kind === "LIST") return "[" + renderType(t.ofType) + "]";
  return t.name || t.kind || "?";
}

async function typeShape(name) {
  if (DRY_RUN) return null;   // dry run sends nothing, not even introspection
  const q = `query SidekickTypeProbe { __type(name: "${name}") { kind enumValues { name } inputFields { name type { name kind ofType { name kind ofType { name kind } } } } } }`;
  const r = await post(q, {});
  if (!r.ok) return { error: r.error };
  const t = r.data?.__type;
  if (!t) return null;
  return {
    kind: t.kind ?? "",
    enumValues: (t.enumValues ?? []).map((e) => e.name),
    inputFields: (t.inputFields ?? []).map((f) => f.name),
    // name + rendered type, for the callers that need to know the SHAPE a field wants.
    inputTypes: (t.inputFields ?? []).map((f) => ({ name: f.name, type: renderType(f.type) })),
  };
}

if (DRY_RUN) {
  // Nothing leaves this process. The AI type list is the candidate list rather than the
  // tenant-resolved one, because resolving it would require the introspection call this mode
  // exists to avoid; everything else is byte-for-byte what the battery sends.
  const T = TYPE_OVERRIDE.length ? TYPE_OVERRIDE : [...app.AI_RESOURCE_TYPE_CANDIDATES];
  console.log("\n=== dry run: exactly what each step would send ===");
  console.log("  No request is made. AI types below are the candidates, not the resolved list.");
  for (const [id, , extra] of buildSteps(T, PROJECT_ID ? [PROJECT_ID] : null)) {
    console.log(`\n--- ${id} ---`);
    console.log(JSON.stringify({ quick: true, first: FIRST, after: null, ...extra }, null, 2));
  }
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

console.log("\n=== the tenant's own vocabulary ===");
const entityType = await typeShape("GraphEntityType");
const relInput = await typeShape("GraphDirectedRelationshipTypeInput");

if (entityType?.error) console.log("  GraphEntityType: " + entityType.error);
else if (!entityType) console.log("  GraphEntityType: no such type (introspection may be disabled)");
else {
  console.log(`  GraphEntityType — ${entityType.kind}, ${entityType.enumValues.length} members`);
  console.log("  AI-flavoured members:");
  console.log("    " + app.aiFlavored(entityType.enumValues).join(", "));
}

let relEnum = null;
if (relInput && !relInput.error) {
  // `type` first, then the input object's other fields — the same order diagnostics.ts uses,
  // because the relationship enum is not named after the input object that carries it.
  for (const field of ["type", ...relInput.inputFields.filter((f) => f !== "type")]) {
    const name = field === "type" ? "GraphRelationshipType" : `Graph${field}Type`;
    const probe = await typeShape(name);
    if (probe && !probe.error && probe.enumValues.length) {
      relEnum = { name, values: probe.enumValues };
      break;
    }
  }
}
if (!relEnum) console.log("  relationship enum: not found by introspection");
else {
  console.log(`\n  ${relEnum.name} — ${relEnum.values.length} members. Every relationship this tenant has:`);
  console.log("    " + [...relEnum.values].sort().join(", "));
  const dump = join(process.cwd(), "probe-vocabulary.json");
  writeFileSync(dump, JSON.stringify({
    capturedAt: new Date().toISOString(),
    entityTypes: entityType?.enumValues ?? [],
    relationships: [...relEnum.values].sort(),
  }, null, 2) + "\n");
  console.log(`\n  Written to ${dump} (gitignored). The committed capture is`);
  console.log("  exemples/tenant_vocabulary.js — diff this against it; a difference is a schema");
  console.log("  change, and the committed file is what test/tenantVocabulary.test.js checks.");
}

// ------------------------------------------- 2b. which project filter each root accepts
//
// FIVE SPELLINGS, and choosing the wrong one is a silent zero rather than an error. This app
// already sends `filterBy.project` (issuesV2), `filterBy.resource.projectId`
// (configurationFindings), `filterBy.projectId` (cloudResourcesV2), the scalar
// `graphSearch(projectId:)` argument, and `analyticsSelection.projectId` — wizQueriesAi.ts
// names all five itself. The sibling gas/ tool sends `projectIdV2: {equals:[id]}`, but on
// `vulnerabilityFindings`, which is a different filter type; brick's own test records that
// "the two filter types spell it differently".
//
// So the question is asked per root rather than carried across from a connection that is not
// this one. `expected` is what this app sends TODAY, so a mismatch is either a latent bug or
// a spelling that only ever worked by accident.
const FILTER_TYPES = [
  ["CloudResourceV2Filters", "projectId", "INVENTORY_AI (unscoped), AI_ASSET_PROPERTIES (unscoped), AGENTIC_IDENTITIES"],
  ["IssueFilters", "project", "ISSUES_TOXIC"],
  ["ConfigurationFindingFilters", "resource.projectId", "CONFIG_FINDINGS, IDENTITY_HYGIENE"],
];
if (!DRY_RUN) {
  console.log("\n=== which project filter each root accepts ===");
  for (const [name, expected, users] of FILTER_TYPES) {
    const shape = await typeShape(name);
    const label = ("  " + name).padEnd(32);
    if (!shape || shape.error) {
      console.log(label + (shape?.error ? "REFUSED  " + shape.error.slice(0, 80) : "no such type"));
      continue;
    }
    // Every project-shaped field, with its type. Not a guess-list: the first version of
    // this check tested four names I had thought of and reported "project" for
    // CloudResourceV2Filters, which was true and still not the answer — it says nothing
    // about the SHAPE the field wants, and a right name in a wrong shape is a 400.
    // `resource` is included because ConfigurationFindingFilters nests the project field
    // inside it; the rendered type name says where to look next rather than reporting
    // "no project-shaped field" for a type that plainly has one, one level down.
    const found = shape.inputTypes.filter((f) => /project/i.test(f.name) || f.name === "resource");
    console.log(label + (found.length
      ? found.map((f) => f.name + ": " + f.type).join(", ")
      : "(no project-shaped field)"));
    console.log("  " + " ".repeat(30) + "sent today: " + expected + "   — " + users);
    if (found.length && !found.some((f) => f.name === expected.split(".")[0])) {
      console.log("  " + " ".repeat(30) + "*** MISMATCH: this type has no '" +
        expected.split(".")[0] + "' field ***");
    }
  }
  console.log("\n  A field listed here exists; it does not follow that it means what you hope.");
  console.log("  Scope one step, count the rows, and only then scope the rest.");
}

// -------------------------------------------------------- 3. resolve the AI type list

const chosen = app.chooseAiResourceTypes(
  entityType && !entityType.error ? entityType.enumValues : null,
  TYPE_OVERRIDE.length ? TYPE_OVERRIDE : null,
);
console.log(`\n  AI resource types (${chosen.source}): ${chosen.types.join(", ") || "(none)"}`);

if (VOCAB_ONLY) { rmSync(dir, { recursive: true, force: true }); process.exit(0); }

// ------------------------------------------------------------------ 4. the traversals

const scope = PROJECT_ID ? [PROJECT_ID] : null;
const STEPS = buildSteps(chosen.types, scope);

// id, document, variables, normalizer, and whether the battery scopes it to a project.
// `null` scope for the agent-rooted four and for LINEAGE mirrors syncJobs exactly; changing
// it here would make the probe answer a question the battery does not ask.
function buildSteps(T, scope) { return [
  ["GUARDRAIL_GAPS",        app.Q_AGENTS_NO_GUARDRAIL,        app.noGuardrailVariables(null),        app.normalizeNoGuardrailPage,        "tenant-wide"],
  ["RUNS_AS",               app.Q_AGENT_RUNS_AS,              app.agentRunsAsVariables(T, null),        app.normalizeRunsAsPage,             "tenant-wide"],
  ["SA_FINDINGS",           app.Q_SA_EXCESSIVE_ACCESS,        app.saExcessiveAccessVariables(T, null),  app.normalizeRunsAsPage,             "tenant-wide"],
  ["SENSITIVE_DATA_ACCESS", app.Q_AGENT_SENSITIVE_DATA_ACCESS, app.sensitiveDataAccessVariables(T, null), app.normalizeSensitiveDataAccessPage, "tenant-wide"],
  ["HOST_EXPOSURE",         app.Q_AI_EXPOSURE,                app.hostExposureVariables(T, scope),              app.normalizeHostExposurePage,       "project-scoped"],
  ["ENDPOINT_EXPOSURE",     app.Q_AI_EXPOSURE,                app.endpointExposureVariables(T, scope),          app.normalizeEndpointExposurePage,   "project-scoped"],
  ["LINEAGE",               app.Q_LINEAGE,                    app.lineageVariables(T, null),                    app.normalizeLineagePage,            "tenant-wide"],
  ["IDENTITY_ACCESS",       app.Q_IDENTITY_ACCESS,            app.identityAccessVariables(T, scope),            app.normalizeIdentityAccessPage,     "project-scoped"],
]; }

console.log("\n=== traversals ===\n");
const results = [];
for (const [id, doc, extra, normalize, scoping] of STEPS) {
  const variables = { quick: true, first: FIRST, after: null, ...extra };
  const r = await post(doc, variables);
  if (!r.ok) { results.push({ id, scoping, ok: false, error: r.error }); continue; }
  const conn = r.data?.graphSearch ?? {};
  const rows = conn.nodes ?? [];
  let norm = { nodes: 0, edges: 0 };
  let normError = null;
  const byType = new Map();
  try {
    const part = normalize(rows);
    norm = { nodes: part.nodes.length, edges: part.edges.length };
    // Which RELATIONSHIP each edge came back on, not just how many. A traversal that returns
    // rows but only ever on one leg is a different finding from one that returns all of them,
    // and the count alone cannot tell them apart.
    for (const e of part.edges) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  } catch (e) { normError = String(e && e.message ? e.message : e); }

  // Which SLOTS the tenant filled, positionally. On a spec whose legs are all `optional` this
  // is the shape of the answer: the captured agent expansion filled 4 of 43, and knowing WHICH
  // four is what told us STORES_DATA_IN returns and READS_DATA_FROM does not.
  const slotFill = [];
  for (const row of rows) {
    const ents = Array.isArray(row?.entities) ? row.entities : [];
    ents.forEach((e, i) => { if (e) slotFill[i] = (slotFill[i] ?? 0) + 1; });
  }

  results.push({
    id, scoping, ok: true,
    rows: rows.length,
    totalCount: conn.totalCount ?? null,
    hasNextPage: !!conn.pageInfo?.hasNextPage,
    norm, normError,
    byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
    slotFill,
    sample: rows.length ? JSON.stringify(rows[0]).slice(0, 1200) : "",
  });
}

const w = Math.max(...results.map((r) => r.id.length));
for (const r of results) {
  const id = r.id.padEnd(w);
  if (!r.ok) {
    // A host we could not reach is NOT a tenant that refused the document. Collapsing the two
    // is how "the query is wrong" gets concluded from a VPN being off.
    const label = r.error.startsWith("UNREACHABLE") ? "UNREACHABLE" : "REJECTED   ";
    console.log(`  ${id}  ${label}  ${r.error}`);
    continue;
  }
  const total = r.totalCount === null ? "?" : String(r.totalCount);
  console.log(
    `  ${id}  ok        ${r.rows} of ${total} rows -> ${r.norm.nodes} nodes, ${r.norm.edges} edges` +
    (r.hasNextPage ? " (more pages)" : "") + (r.normError ? `  NORMALIZER THREW: ${r.normError}` : ""),
  );
  if (r.byType.length) {
    console.log(`  ${" ".repeat(w)}            by relationship: ` +
      r.byType.map(([t, n]) => `${t} ${n}`).join(", "));
  }
  if (r.rows && r.slotFill.length) {
    const filled = r.slotFill.map((n, i) => (n ? `${i}:${n}` : null)).filter(Boolean);
    console.log(`  ${" ".repeat(w)}            slots filled (index:rows of ${r.rows}): ` +
      (filled.join(", ") || "none"));
  }
}

console.log("\n=== how to read this ===");
console.log("  UNREACHABLE          we never reached Wiz. Not a finding about any query — check");
console.log("                       WIZ_API_URL, network and VPN, then run again.");
console.log("  REJECTED             the tenant refused the document. Its message is the finding —");
console.log("                       'cannot represent value' is shape, an unknown enum is vocabulary.");
console.log("  ok, 0 rows           accepted and matched nothing. That is a real answer, not a fault.");
console.log("                       For a project-scoped step, check WIZ_PROJECT_ID_V2 first.");
console.log("  ok, rows, 0 edges    the normalizer is dropping what came back. Read the sample below.");
console.log("  ok, rows, edges      collection works. Check the sample is the path you meant —");
console.log("                       an accepted-but-wrong traversal is worse than a refused one.");
console.log("");
console.log("  A COUNT IS ROWS, NOT ASSETS. graphSearch returns one row per PATH, so a step whose");
console.log("  legs fan out reports a multiple of its population: one agent with four bindings and");
console.log("  three findings is twelve rows. SENSITIVE_DATA_ACCESS and SA_FINDINGS both fan out;");
console.log("  RUNS_AS has a single leg and is close to 1:1. Compare a step against ITSELF across");
console.log("  runs — that is one variable — and never one step against another as a population.");
console.log("  totalCount is also approximate under `quick: true`: GUARDRAIL_GAPS has reported 710,");
console.log("  705, 693 and 690 on an unchanged query. Read magnitudes, not measurements.");

for (const r of results) {
  if (!r.ok || !r.sample) continue;
  console.log(`\n--- ${r.id} (${r.scoping}) first row ---`);
  console.log(r.sample);
}

// ------------------------------------------------------------------- 5. isolation experiments
//
// UNLIKE EVERYTHING ABOVE, the traversals in this section are written HERE and are not what the
// battery sends. That is the point: a step returning zero rows has more than one explanation,
// and the only way to tell them apart is to vary one thing at a time. Nothing here changes a
// spec — each is a question, and the answer decides whether a spec should change.
//
// The two questions, both raised by a step that came back empty tenant-wide:
//
//   SENSITIVE_DATA_ACCESS and IDENTITY_ACCESS both walk `ALLOWS_ACCESS_TO`, and both return
//   nothing — while AGENT_EXPANSION, transcribed from the console, walks that same
//   relationship from an IAM_BINDING and the CIEM step gets rows through exactly that binding.
//   So the suspicion is the STANDING POINT again: `ALLOWS_ACCESS_TO` may be anchored at the
//   binding on this tenant, in which case asking it of a SERVICE_ACCOUNT or of an
//   ACCESS_ROLE_BINDING is a hop that cannot match — zero rows, no error, indistinguishable
//   from "no AI asset reaches sensitive data".

if (DIAGNOSE) {
  const T2 = chosen.types;
  const EXPERIMENTS = [
    {
      id: "sda-1  SA -> store, no filter",
      why: "Does the execution identity reach a store AT ALL, before hasSensitiveData narrows it?",
      spec: {
        type: ["AI_AGENT"],
        relationships: [{
          type: "SERVICE_ACCOUNT", edge: { type: "ACTING_AS" },
          relationships: [{ type: ["BUCKET", "DATABASE"], edge: { type: "ALLOWS_ACCESS_TO" } }],
        }],
      },
    },
    {
      id: "sda-2  SA -> binding -> store",
      why: "Or is ALLOWS_ACCESS_TO anchored at the BINDING, the way AGENT_EXPANSION walks it?",
      spec: {
        type: ["AI_AGENT"],
        relationships: [{
          type: "PRINCIPAL", edge: { type: "ACTING_AS" },
          relationships: [{
            type: "IAM_BINDING", edge: { type: "ENTITLES", reverse: true },
            relationships: [{
              type: ["BUCKET", "DATABASE", "DATA_RESOURCE"],
              edge: { type: "ALLOWS_ACCESS_TO" },
            }],
          }],
        }],
      },
    },
    {
      id: "sda-3  binding -> store, filtered",
      why: "sda-2's path WITH hasSensitiveData. Separates 'wrong shape' from 'nothing classified'.",
      spec: {
        type: ["AI_AGENT"],
        relationships: [{
          type: "PRINCIPAL", edge: { type: "ACTING_AS" },
          relationships: [{
            type: "IAM_BINDING", edge: { type: "ENTITLES", reverse: true },
            relationships: [{
              type: ["BUCKET", "DATABASE", "DATA_RESOURCE"],
              edge: { type: "ALLOWS_ACCESS_TO" },
              where: { hasSensitiveData: { EQUALS: true } },
            }],
          }],
        }],
      },
    },
    {
      id: "ident-1 ACCESS_ROLE_BINDING",
      why: "The binding kind IDENTITY_ACCESS asks for, alone, with no legs below it.",
      spec: {
        type: [...T2],
        relationships: [{
          type: "ACCESS_ROLE_BINDING", edge: { type: "ALLOWS_ACCESS_TO", reverse: true },
        }],
      },
    },
    {
      id: "ident-2 IAM_BINDING",
      why: "The same hop, asking for the binding kind the CIEM step actually gets rows for.",
      spec: {
        type: [...T2],
        relationships: [{
          type: "IAM_BINDING", edge: { type: "ALLOWS_ACCESS_TO", reverse: true },
        }],
      },
    },
  ];

  // A DISCOVERY sweep rather than a hypothesis test. ident-1 and ident-2 both came back empty,
  // which says the binding KIND was never the problem: nothing reaches an AI asset by
  // ALLOWS_ACCESS_TO at all. So instead of guessing a third name, ask the graph which
  // relationships actually land on an AI asset, and let the answer pick the traversal.
  //
  // ACTING_AS leads the list as a POSITIVE CONTROL, and its absence was a real defect in the
  // first version of this sweep. Every candidate came back zero, and a sweep that can only
  // return zero produces exactly that result — so "nothing reaches an AI asset" was not yet
  // distinguishable from "this loop is broken". ACTING_AS is known to return (the RUNS_AS step
  // gets 190 rows through it), so if the control is silent the sweep is wrong and the other
  // rows mean nothing.
  const IDENT_SWEEP = [
    "ACTING_AS",
    "ALLOWS_ACCESS_TO", "ACCESSIBLE_BY", "PERMITS", "ADMINISTRATE",
    "MANAGES", "OWNS", "HAS_ASSIGNMENT", "ASSIGNED_TO", "ENTITLES", "ALLOWS",
  ];
  const IDENT_KINDS = [
    "USER_ACCOUNT", "SERVICE_ACCOUNT", "PRINCIPAL",
    "IAM_BINDING", "ACCESS_ROLE", "ACCESS_ROLE_BINDING",
  ];

  console.log("\n=== isolation experiments (NOT what the battery sends) ===");
  for (const e of EXPERIMENTS) {
    // Any graphSearchVarQuery document works — the traversal rides in $query, so the document
    // is just the envelope. Reusing one the battery already ships keeps the field set identical.
    const r = await post(app.Q_AGENT_RUNS_AS, {
      quick: true, first: FIRST, after: null,
      query: app.toGraphEntityQuery(e.spec), projectId: null,
    });
    const head = "  " + e.id.padEnd(32);
    if (!r.ok) { console.log(head + (r.error.startsWith("UNREACHABLE") ? "UNREACHABLE  " : "REJECTED     ") + r.error); }
    else {
      const conn = r.data?.graphSearch ?? {};
      const rows = (conn.nodes ?? []).length;
      console.log(head + `${rows} of ${conn.totalCount ?? "?"} rows`);
    }
    console.log("  " + " ".repeat(32) + e.why);
  }

  console.log("\n=== discovery: what actually reaches an AI asset ===");
  console.log("  Each cell asks [every AI type] -REL-> [identity-ish kinds], forward and reversed,");
  console.log("  one row max. Only non-zero answers are printed; a silent relationship is one");
  console.log("  that does not connect identities to AI assets on this tenant.\n");
  let anyHit = false;
  for (const rel of IDENT_SWEEP) {
    for (const reverse of [false, true]) {
      const spec = {
        type: [...T2],
        relationships: [{
          type: [...IDENT_KINDS],
          edge: reverse ? { type: rel, reverse: true } : { type: rel },
        }],
      };
      const r = await post(app.Q_AGENT_RUNS_AS, {
        quick: true, first: 1, after: null,
        query: app.toGraphEntityQuery(spec), projectId: null,
      });
      const arrow = reverse ? "<-" : "->";
      const label = `  AI ${arrow}${rel}${arrow === "->" ? "->" : "-"} identity`.padEnd(46);
      if (!r.ok) { console.log(label + "REFUSED  " + r.error.slice(0, 90)); anyHit = true; continue; }
      const conn = r.data?.graphSearch ?? {};
      const n = conn.totalCount ?? (conn.nodes ?? []).length;
      if (n) {
        anyHit = true;
        const kinds = (conn.nodes?.[0]?.entities ?? [])
          .filter(Boolean).map((e) => e.type).join(" -> ");
        console.log(label + `${n} rows   ${kinds}`);
      }
    }
  }
  if (!anyHit) {
    console.log("  Nothing — INCLUDING THE ACTING_AS CONTROL, which is known to return rows.");
    console.log("  That means this sweep is broken, not that the graph is empty. Ignore it.");
  }

  // Which store kinds carry the sensitive-data path. sda-3 asked for three kinds at once and
  // got 147; only two of them are declared in NODE_KINDS, so the shipped spec asks for two and
  // this says what that costs. DATA_RESOURCE is measured but deliberately not collected.
  // GUARDRAIL_GAPS is the one agent-path traversal NOT widened, because its output is an
  // ABSENCE: `guardrailMissing` is the sole input to the MISSING_GUARDRAIL risk condition and
  // AARS prices it in pillar B. Rooting it at every AI kind would flag pipelines and datasets
  // as unprotected — assets a guardrail does not attach to — so the widening is not a wider
  // net but a fabricated finding on most of the register. This measures what it would cost.
  console.log("\n=== GUARDRAIL_GAPS by subject kind ===");
  console.log("  The shipped list is AI_AGENT + AI_MODEL + AI_SERVICE. AI_SERVICE is the one of");
  console.log("  the three no capture walks PROTECTS from, so its own line is the evidence for");
  console.log("  keeping it — or for dropping it.\n");
  for (const roots of [
    ["AI_AGENT"], ["AI_MODEL"], ["AI_SERVICE"],
    ["AI_AGENT", "AI_MODEL", "AI_SERVICE"], [...T2],
  ]) {
    const spec = {
      type: [...roots],
      relationships: [{
        type: "AI_GUARDRAIL", select: false, negate: true,
        edge: { type: "PROTECTS", reverse: true },
      }],
    };
    const r = await post(app.Q_AGENTS_NO_GUARDRAIL, {
      quick: true, first: 1, after: null,
      query: app.toGraphEntityQuery(spec), projectId: null,
    });
    const label = ("  " + (roots.length > 3 ? `all ${roots.length} AI kinds` : roots.join(" + ")))
      .padEnd(42);
    if (!r.ok) console.log(label + "REFUSED  " + r.error.slice(0, 90));
    else console.log(label + `${r.data?.graphSearch?.totalCount ?? "?"} would be flagged unprotected`);
  }

  console.log("\n=== which store kinds carry the 147 ===");
  for (const kind of ["BUCKET", "DATABASE", "DATA_RESOURCE"]) {
    const spec = {
      type: ["AI_AGENT"],
      relationships: [{
        type: "PRINCIPAL", edge: { type: "ACTING_AS" },
        relationships: [{
          type: "IAM_BINDING", select: false, edge: { type: "ENTITLES", reverse: true },
          relationships: [{
            type: [kind], edge: { type: "ALLOWS_ACCESS_TO" },
            where: { hasSensitiveData: { EQUALS: true } },
          }],
        }],
      }],
    };
    const r = await post(app.Q_AGENT_RUNS_AS, {
      quick: true, first: 1, after: null,
      query: app.toGraphEntityQuery(spec), projectId: null,
    });
    const label = ("  " + kind).padEnd(20);
    if (!r.ok) console.log(label + "REFUSED  " + r.error.slice(0, 100));
    else {
      const conn = r.data?.graphSearch ?? {};
      const declared = kind !== "DATA_RESOURCE";
      console.log(label + `${conn.totalCount ?? "?"} rows` +
        (declared ? "   (collected)" : "   (NOT in NODE_KINDS — would be dropped)"));
    }
  }
}

rmSync(dir, { recursive: true, force: true });
