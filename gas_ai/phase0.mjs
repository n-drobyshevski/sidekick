// Phase 0 — the read-only measurement that decides whether the risk-model rebuild is viable.
//
//   node phase0.mjs --stage=a     schema: what this tenant will actually accept
//   node phase0.mjs --stage=b     rows per risk category  (~500 calls: see the note below)
//   node phase0.mjs --stage=c     severity / businessImpact variance by scope, EXACT counts
//   node phase0.mjs --stage=t     the time axis — can age carry it where dueAt cannot
//   node phase0.mjs --stage=d     vulnerabilityFindings: the funnel from 5.17M to ~17k
//   node phase0.mjs --stage=j     attribution — can the exploitation signal reach the queue
//   node phase0.mjs --stage=k     related-issue field: shape, selection, widened resolution rate
//   node phase0.mjs --stage=e     framework join: finding.rule -> config rule -> policy
//   node phase0.mjs --stage=r2    distinct resources behind the widened register
//   node phase0.mjs --stage=cf    config findings under the candidate categories
//   node phase0.mjs --stage=all   every stage
//
// EVERY FIGURE IS AN EXACT COUNT, not a sample. Where a distribution was wanted it was built
// from one filtered `totalCount` per bucket rather than by paging rows and tallying them, so
// no ordering bias can reach it. `IssuesGroupedByValueField` has no category member, which is
// why per-category counts cost one call each and why stage b alone runs ~500.
//
// Results are written up in ai/AARS_LIVE_MEASUREMENTS.md section 6, dated and tenant-stamped.
//
// IT WRITES NOTHING. Not to Wiz, not to the Sheet, not to Drive, not to Script Properties.
// The only local write is phase0-report.json, so the numbers can be cited rather than
// re-measured. Credentials are read from the environment or gas_ai/.env.local and never
// printed; presence and length only, exactly as probe.mjs does.
//
// WHY A SIBLING TO probe.mjs RATHER THAN A MODE INSIDE IT. probe.mjs sends the app's OWN
// exported query constants, which is what makes it evidence about the battery. Every question
// here is about queries the battery does NOT yet have — a widened category filter and a
// vulnerabilityFindings root that does not exist in gas_ai at all. Putting speculative
// documents inside probe.mjs would break the one property that makes it trustworthy.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const STAGE = (args.find((a) => a.startsWith("--stage=")) ?? "--stage=a").split("=")[1];
const SAMPLE = Number((args.find((a) => a.startsWith("--sample=")) ?? "--sample=100").split("=")[1]);
const want = (s) => STAGE === "all" || STAGE === s;

// ------------------------------------------------------------------ env (mirrors dev/serve.mjs)
const ENV_FILES = [join(root, ".env.local"), join(root, "dev/.env.local")];
function readEnvFile() {
  const out = {};
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let value = line.slice(eq + 1).trim();
      if (value.length > 1 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "").trim();
      const key = line.slice(0, eq).trim();
      if (key && !(key in out)) out[key] = value;
    }
  }
  return out;
}
const file = readEnvFile();
const pick = (k) => String(process.env[k] || file[k] || "").trim();
const API_URL = pick("WIZ_API_URL");
const AUTH_URL = pick("WIZ_AUTH_URL") || "https://auth.app.wiz.io/oauth/token";
const STATIC_TOKEN = pick("WIZ_API_TOKEN");
const CLIENT_ID = pick("WIZ_CLIENT_ID");
const CLIENT_SECRET = pick("WIZ_CLIENT_SECRET");
const PROJECT_ID = pick("WIZ_PROJECT_ID_V2") || null;
const preview = (v) => (v ? `set, length ${v.length}` : "UNSET");

if (!API_URL || (!STATIC_TOKEN && !(CLIENT_ID && CLIENT_SECRET))) {
  console.error("Missing configuration.\n" +
    `  WIZ_API_URL       ${preview(API_URL)}\n` +
    `  WIZ_API_TOKEN     ${preview(STATIC_TOKEN)}\n` +
    `  WIZ_CLIENT_ID     ${preview(CLIENT_ID)}\n` +
    `  WIZ_CLIENT_SECRET ${STATIC_TOKEN || CLIENT_SECRET ? "set" : "UNSET"}`);
  process.exit(2);
}

// ------------------------------------------------------------------------------- transport
let CALLS = 0;
async function token() {
  if (STATIC_TOKEN) return STATIC_TOKEN;
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
const BEARER = await token();

async function post(query, variables) {
  CALLS++;
  let res, text;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${BEARER}` },
      body: JSON.stringify({ query, variables }),
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: `UNREACHABLE: ${e?.message ?? String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 400)}` };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, error: `unparseable: ${text.slice(0, 300)}` }; }
  if (body.errors?.length) return { ok: false, error: body.errors.map((e) => e.message).join(" | ").slice(0, 500) };
  return { ok: true, data: body.data };
}

// --------------------------------------------------------------------------------- helpers
const report = { capturedAt: new Date().toISOString(), apiHost: new URL(API_URL).host, project: PROJECT_ID };
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
function tally(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    const key = k === null || k === undefined ? "(null)" : String(k);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}
/** exp(H) — the number of buckets a distribution behaves as if it had. rankStats.ts:95 */
function effectiveCardinality(counts) {
  const vals = Object.values(counts);
  const n = vals.reduce((a, b) => a + b, 0);
  if (!n) return 0;
  let h = 0;
  for (const c of vals) { if (c > 0) { const p = c / n; h -= p * Math.log(p); } }
  return Math.exp(h);
}
/** Σ C(n_k,2) / C(N,2) — 1.0 means the axis separates no pair. rankStats.ts:77 */
function tieRate(counts) {
  const vals = Object.values(counts);
  const n = vals.reduce((a, b) => a + b, 0);
  if (n < 2) return 0;
  const tied = vals.reduce((a, c) => a + (c * (c - 1)) / 2, 0);
  return tied / ((n * (n - 1)) / 2);
}
const line = (s) => console.log(s);
const head = (s) => { console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`); };

line(`phase0 — ${report.apiHost} · project ${PROJECT_ID ?? "(none)"} · stage ${STAGE}`);

// ============================================================ STAGE A — what the tenant accepts
// The type name is interpolated, not passed as a variable: this tenant's gateway answers
// `__type(name:$n)` with "missing value for non-null variable 'n'" however the variable is
// sent. Literal names are accepted, and a name from a fixed list cannot be injection.
const typeQ = (n) => `{ __type(name:${JSON.stringify(n)}){ name kind
  enumValues{ name }
  possibleTypes{ name }
  inputFields{ name type{ kind name ofType{ kind name ofType{ kind name } } } }
  fields{ name type{ kind name ofType{ kind name ofType{ kind name } } } } } }`;
const renderType = (t) => !t ? "?" : t.kind === "NON_NULL" ? `${renderType(t.ofType)}!`
  : t.kind === "LIST" ? `[${renderType(t.ofType)}]` : (t.name ?? t.kind);

if (want("a")) {
  head("STAGE A — schema: what this tenant will actually accept");

  const q = await post(`{ __schema { queryType { fields { name args { name type { kind name ofType { kind name } } } } } } }`, {});
  if (!q.ok) { line(`  query root introspection FAILED: ${q.error}`); }
  else {
    const fields = q.data.__schema.queryType.fields;
    report.queryRoots = fields.length;
    line(`  query root exposes ${fields.length} fields`);
    const interesting = fields.filter((f) => /issue|vulnerab|categor|framework|configuration/i.test(f.name));
    line(`\n  relevant roots:`);
    for (const f of interesting) {
      line(`    ${f.name}(${f.args.map((a) => `${a.name}: ${renderType(a.type)}`).join(", ")})`);
    }
    report.relevantRoots = interesting.map((f) => ({
      name: f.name, args: f.args.map((a) => ({ name: a.name, type: renderType(a.type) })),
    }));
  }

  for (const name of ["IssueFilters", "VulnerabilityFindingFilters", "ConfigurationFindingFilters"]) {
    const t = await post(typeQ(name), {});
    if (!t.ok || !t.data.__type) { line(`\n  ${name}: not found (${t.error ?? "null"})`); continue; }
    const inp = t.data.__type.inputFields ?? [];
    line(`\n  ${name} — ${inp.length} input fields`);
    const hit = inp.filter((f) => /categor|project|status|severity|exploit|epss|kev|resolved|first|has/i.test(f.name));
    for (const f of hit) line(`    ${f.name}: ${renderType(f.type)}`);
    report[name] = inp.map((f) => ({ name: f.name, type: renderType(f.type) }));
  }

  // Does an Issue name its own category? If it does, one paged fetch replaces N count calls —
  // and it answers scanVars.ts:118's objection directly, because the row would then carry the
  // claim the category filter is currently making on its behalf.
  const iss = await post(typeQ("Issue"), {});
  if (iss.ok && iss.data.__type) {
    const f = (iss.data.__type.fields ?? []);
    const cat = f.filter((x) => /categor|framework|subcateg/i.test(x.name));
    report.issueCategoryFields = cat.map((x) => ({ name: x.name, type: renderType(x.type) }));
    line(`\n  Issue — ${f.length} fields. Category-bearing ones:`);
    if (!cat.length) line(`    NONE — the row cannot name its own category (scanVars.ts:118 is right)`);
    for (const x of cat) line(`    ${x.name}: ${renderType(x.type)}`);
  }

  for (const name of ["IssuesGroupedByValueField", "ConfigurationFindingGroupBy",
                      "SecurityCategoryFilters", "SecurityCategory"]) {
    const t = await post(typeQ(name), {});
    if (!t.ok || !t.data.__type) { line(`\n  ${name}: not found (${t.error ?? "null"})`); continue; }
    const d = t.data.__type;
    if (d.enumValues?.length) {
      const vals = d.enumValues.map((v) => v.name);
      report[name] = vals;
      line(`\n  ${name} — enum, ${vals.length} values`);
      line(`    ${vals.join(", ")}`);
    } else {
      const inp = d.inputFields ?? [];
      report[name] = inp.map((f) => ({ name: f.name, type: renderType(f.type) }));
      line(`\n  ${name} — ${inp.length} input fields: ${inp.map((f) => f.name).join(", ")}`);
    }
  }

  const vf = await post(typeQ("VulnerabilityFinding"), {});
  if (vf.ok && vf.data.__type) {
    const names = (vf.data.__type.fields ?? []).map((f) => f.name);
    report.vulnerabilityFindingFields = names;
    const wanted = ["hasExploit", "hasCisaKevExploit", "epssProbability", "epssPercentile",
      "epssSeverity", "cvssSeverity", "vendorSeverity", "firstDetectedAt", "resolvedAt",
      "status", "vulnerableAsset", "validatedInRuntime", "cisaKevReleaseDate"];
    line(`\n  VulnerabilityFinding — ${names.length} fields. The ones the model needs:`);
    for (const w of wanted) line(`    ${names.includes(w) ? "OK  " : "MISS"}  ${w}`);
  } else line(`\n  VulnerabilityFinding: not found (${vf.error ?? "null"})`);
}

// =========================================================== STAGE B — counts per risk category
const CAT_COUNT_Q = `query C($f:IssueFilters){ issuesV2(first:1, filterBy:$f){ totalCount } }`;

if (want("b")) {
  head("STAGE B — how big is each risk category, in project scope");

  // securityCategories is the enumeration root. wct-id-* ids are what frameworkCategory takes.
  const cat = await post(`{ securityCategories(first:500){ nodes{ id name externalId } } }`, {});
  const cats = [];
  if (!cat.ok) line(`  securityCategories FAILED: ${cat.error}`);
  else {
    for (const c of cat.data.securityCategories?.nodes ?? []) cats.push(c);
    line(`  securityCategories returned ${cats.length}`);
    line(`  id shapes: ${JSON.stringify(tally(cats, (c) => String(c.id).replace(/\d+$/, "N")))}`);
  }

  const base = { status: ["OPEN", "IN_PROGRESS"] };
  if (PROJECT_ID) base.project = [PROJECT_ID];

  const all = await post(CAT_COUNT_Q, { f: base });
  const ceiling = all.ok ? all.data.issuesV2.totalCount : null;
  line(`\n  CEILING — every open issue in project scope, no category filter: ${ceiling ?? `FAILED: ${all.error}`}`);
  const ai = await post(CAT_COUNT_Q, { f: { ...base, frameworkCategory: ["wct-id-1998"] } });
  line(`  TODAY   — wct-id-1998 (AI) only: ${ai.ok ? ai.data.issuesV2.totalCount : `FAILED: ${ai.error}`}`);
  report.issueCeiling = ceiling;
  report.issueToday = ai.ok ? ai.data.issuesV2.totalCount : null;

  const rows = [];
  for (const c of cats) {
    const r = await post(CAT_COUNT_Q, { f: { ...base, frameworkCategory: [c.id] } });
    rows.push(r.ok ? { ...c, count: r.data.issuesV2.totalCount } : { ...c, count: null, error: r.error.slice(0, 80) });
  }
  rows.sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  report.categories = rows;

  line(`\n  ${"category id".padEnd(16)} ${"issues".padStart(8)}  name`);
  let running = 0;
  for (const r of rows) {
    if (r.count === null) { line(`  ${r.id.padEnd(16)} ${"ERR".padStart(8)}  ${r.name} — ${r.error}`); continue; }
    if (r.count === 0) continue;
    running += r.count;
    line(`  ${r.id.padEnd(16)} ${String(r.count).padStart(8)}  ${r.name}`);
  }
  const nonZero = rows.filter((r) => (r.count ?? 0) > 0);
  line(`\n  ${nonZero.length} categories carry at least one open issue in scope.`);
  line(`  Sum over categories ${running} vs ceiling ${ceiling} — issues can sit in several categories,`);
  line(`  so the sum overshooting the ceiling is expected, not a defect.`);

  // Config findings, same question.
  const cfBase = { status: ["OPEN"] };
  if (PROJECT_ID) cfBase.resource = { projectId: [PROJECT_ID] };
  const cfAll = await post(`query C($f:ConfigurationFindingFilters){ configurationFindings(first:1, filterBy:$f){ totalCount } }`, { f: cfBase });
  const cfAi = await post(`query C($f:ConfigurationFindingFilters){ configurationFindings(first:1, filterBy:$f){ totalCount } }`,
    { f: { ...cfBase, frameworkCategory: ["wct-id-1998"] } });
  line(`\n  configurationFindings — ceiling ${cfAll.ok ? cfAll.data.configurationFindings.totalCount : `FAIL ${cfAll.error.slice(0,80)}`}` +
       ` · AI-category ${cfAi.ok ? cfAi.data.configurationFindings.totalCount : `FAIL ${cfAi.error.slice(0,80)}`}`);
  report.findingCeiling = cfAll.ok ? cfAll.data.configurationFindings.totalCount : null;
  report.findingToday = cfAi.ok ? cfAi.data.configurationFindings.totalCount : null;

  // Rule concentration over the WIDENED register — one call, exact, no sampling.
  const grp = await post(
    `query G($f:IssueFilters){ issuesGroupedByValue(first:60, filterBy:$f, groupBy:SOURCE_RULE){
       nodes{ id count } } }`, { f: base });
  if (!grp.ok) line(`\n  issuesGroupedByValue FAILED: ${grp.error.slice(0, 140)}`);
  else {
    const g = grp.data.issuesGroupedByValue?.nodes ?? [];
    const counts = Object.fromEntries(g.map((x) => [x.id, x.count]));
    const tot = Object.values(counts).reduce((a, b) => a + b, 0);
    line(`\n  RULE CONCENTRATION over the widened register — ${g.length} rules shown, ${tot} issues`);
    line(`    effCard ${effectiveCardinality(counts).toFixed(2)}   tie rate ${tieRate(counts).toFixed(3)}`);
    line(`    top 5: ${g.slice(0, 5).map((x) => `${x.id}=${x.count}`).join(" · ")}`);
    report.ruleConcentrationWidened = { rules: g.length, total: tot,
      effCard: effectiveCardinality(counts), tieRate: tieRate(counts), top: g.slice(0, 10) };
  }
}

// The minimal candidate set: security-meaningful, thematically adjacent to an AI-asset tool,
// and small enough to stay inside the store. Deliberately NOT the biggest categories — the
// four largest are 6k-9.5k rows of general IT hygiene each, and stage C measures that widening
// past this set makes severity discriminate WORSE (2.88 -> 2.64), not better.
const CANDIDATE_SET = [
  "wct-id-1998",                          // AI Security                 99
  "wct-id-3",                             // Vulnerability Assessment   677
  "41a3ed79-9a2c-4466-9109-f845fd057bd4", // High Profile Threats       536
  "5c3c85b5-bb94-4ee7-8f3e-c186d0229280", // Data Security              439
  "1f28667a-9d12-48dd-898d-d326bb422f8d", // Key & Secret Management  1,390
  "861eb856-54f6-4d1b-8ca1-1d6130841d20", // Identity Management      3,477
];

// ================================================ STAGE C — does a wider register add variance?
if (want("c")) {
  head("STAGE C — does widening break the constants? (exact counts, not a sample)");

  const base = { status: ["OPEN", "IN_PROGRESS"] };
  if (PROJECT_ID) base.project = [PROJECT_ID];
  const count = async (extra) => {
    const r = await post(CAT_COUNT_Q, { f: { ...base, ...extra } });
    return r.ok ? r.data.issuesV2.totalCount : null;
  };

  // Enum vocabularies, so the axes are the tenant's own rather than guessed.
  const sevT = await post(typeQ("Severity"), {});
  const biT = await post(typeQ("BusinessImpact"), {});
  const SEVS = sevT.ok ? (sevT.data.__type?.enumValues ?? []).map((v) => v.name) : ["CRITICAL","HIGH","MEDIUM","LOW","INFORMATIONAL"];
  const BIS = biT.ok ? (biT.data.__type?.enumValues ?? []).map((v) => v.name) : ["HBI","MBI","LBI"];
  line(`  Severity enum: ${SEVS.join(", ")}`);
  line(`  BusinessImpact enum: ${BIS.join(", ")}\n`);

  const SCOPES = [
    ["TODAY    (AI only)", { frameworkCategory: ["wct-id-1998"] }],
    ["CANDIDATE (6 cats)", { frameworkCategory: CANDIDATE_SET }],
    ["CEILING  (all cats)", {}],
  ];

  const out = {};
  for (const [label, scope] of SCOPES) {
    const total = await count(scope);
    const sev = {};
    for (const s of SEVS) { const n = await count({ ...scope, severity: [s] }); if (n) sev[s] = n; }
    const bi = {};
    for (const b of BIS) { const n = await count({ ...scope, projectBusinessImpact: [b] }); if (n) bi[b] = n; }
    const withDue = await count({ ...scope, hasDueDate: true });
    const exploitable = await count({ ...scope, validatedAsExploitable: true });

    out[label] = { total, severity: sev, businessImpact: bi, withDue, exploitable,
      sevEffCard: effectiveCardinality(sev), sevTieRate: tieRate(sev),
      biEffCard: effectiveCardinality(bi) };

    line(`  ${label} — ${total} open issues`);
    line(`    severity        ${JSON.stringify(sev)}`);
    line(`                    effCard ${effectiveCardinality(sev).toFixed(2)}  tie ${tieRate(sev).toFixed(3)}`);
    line(`    businessImpact  ${JSON.stringify(bi)}  effCard ${effectiveCardinality(bi).toFixed(2)}`);
    line(`    hasDueDate      ${withDue}/${total} (${pct(withDue, total)})`);
    line(`    validatedAsExploitable=true  ${exploitable}/${total} (${pct(exploitable, total)})\n`);
  }
  report.varianceByScope = out;

  line(`  ${"axis".padEnd(26)} ${"TODAY".padStart(10)} ${"CANDIDATE".padStart(10)} ${"CEILING".padStart(10)}`);
  const row = (k, f) => line(`  ${k.padEnd(26)} ${String(f(out["TODAY    (AI only)"])).padStart(10)} ${String(f(out["CANDIDATE (6 cats)"])).padStart(10)} ${String(f(out["CEILING  (all cats)"])).padStart(10)}`);
  row("open issues", (o) => o.total);
  row("severity effCard", (o) => o.sevEffCard.toFixed(2));
  row("severity tie rate", (o) => o.sevTieRate.toFixed(3));
  row("businessImpact effCard", (o) => o.biEffCard.toFixed(2));
  row("dueAt coverage", (o) => pct(o.withDue, o.total));
  row("exploitable=true", (o) => o.exploitable);
}

// ============ STAGE T — the time axis. dueAt coverage collapses on widening (stage C), so
// the question is whether AGE can carry the axis instead. Age is universally available by
// construction; dueAt is not, once the register leaves the AI slice.
if (want("t")) {
  head("STAGE T — can age carry the time axis where dueAt cannot?");

  const ft = await post(typeQ("IssueFilters"), {});
  const names = ft.ok ? (ft.data.__type?.inputFields ?? []).map((f) => f.name) : [];
  line(`  IssueFilters (${names.length}): ${names.join(", ")}\n`);
  report.issueFilterNames = names;

  const dateField = ["createdAt", "openedAt", "firstSeenAt"].find((n) => names.includes(n));
  if (!dateField) { line("  no creation-date filter on IssueFilters — age cannot be counted exactly"); }
  else {
    const dt = await post(typeQ("IssueDateFilter"), {});
    const shape = dt.ok ? (dt.data.__type?.inputFields ?? []).map((f) => `${f.name}: ${renderType(f.type)}`) : [];
    line(`  ${dateField} uses IssueDateFilter { ${shape.join(", ")} }\n`);

    const base = { status: ["OPEN", "IN_PROGRESS"] };
    if (PROJECT_ID) base.project = [PROJECT_ID];
    const count = async (extra) => {
      const r = await post(CAT_COUNT_Q, { f: { ...base, ...extra } });
      return r.ok ? r.data.issuesV2.totalCount : { error: r.error.slice(0, 100) };
    };
    const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const CUTS = [30, 90, 180, 365, 730];

    for (const [label, scope] of [
      ["TODAY    (AI only)", { frameworkCategory: ["wct-id-1998"] }],
      ["CANDIDATE (6 cats)", { frameworkCategory: CANDIDATE_SET }],
    ]) {
      const total = await count(scope);
      line(`  ${label} — ${total} open issues`);
      const buckets = {};
      for (const d of CUTS) {
        const older = await count({ ...scope, [dateField]: { before: daysAgo(d) } });
        if (older && older.error) { line(`    ${dateField}.before REFUSED: ${older.error}`); break; }
        buckets[`>${d}d`] = older;
        line(`      older than ${String(d).padStart(4)}d: ${String(older).padStart(6)} (${pct(older, total)})`);
      }
      if (Object.keys(buckets).length) {
        // Convert cumulative "older than" into disjoint buckets so the axis can be scored.
        const disjoint = {};
        let last = total;
        for (const d of CUTS) { const o = buckets[`>${d}d`]; disjoint[`<=${d}d`] = last - o; last = o; }
        disjoint[`>${CUTS[CUTS.length - 1]}d`] = last;
        line(`    disjoint age buckets ${JSON.stringify(disjoint)}`);
        line(`      effCard ${effectiveCardinality(disjoint).toFixed(2)}   tie rate ${tieRate(disjoint).toFixed(3)}`);
        report[`age_${label.trim().split(" ")[0]}`] = { total, disjoint,
          effCard: effectiveCardinality(disjoint), tieRate: tieRate(disjoint) };
      }
      line("");
    }
  }
}

// ================================== STAGE D — vulnerabilityFindings: magnitude, signal, join
if (want("d")) {
  head("STAGE D — vulnerabilityFindings: is the exploitation signal reachable and attributable?");

  const vfBase = { status: ["OPEN", "IN_PROGRESS"] };
  if (PROJECT_ID) vfBase.projectIdV2 = { equals: [PROJECT_ID] };

  // Vocabularies first. VulnerableAsset is a UNION, which is why `vulnerableAsset { id }`
  // is rejected — it needs an inline fragment per member.
  let assetMembers = [];
  for (const n of ["VulnerableAsset", "FindingCommonStatus", "VulnerabilityEpssFilters"]) {
    const t = await post(typeQ(n), {});
    if (!t.ok || !t.data.__type) { line(`  ${n}: ${t.error ?? "null"}`); continue; }
    const d = t.data.__type;
    if (d.possibleTypes?.length) {
      assetMembers = d.possibleTypes.map((p) => p.name);
      line(`  ${n} is a ${d.kind} of ${assetMembers.length}: ${assetMembers.join(", ")}`);
    } else if (d.enumValues?.length) line(`  ${n} enum: ${d.enumValues.map((v) => v.name).join(", ")}`);
    else if (d.inputFields?.length) line(`  ${n} input: ${d.inputFields.map((f) => `${f.name}: ${renderType(f.type)}`).join(", ")}`);
    else if (d.fields?.length) line(`  ${n} fields: ${d.fields.map((f) => f.name).slice(0, 24).join(", ")}`);
    report[`type_${n}`] = d.possibleTypes?.map((p) => p.name) ?? d.enumValues?.map((v) => v.name)
      ?? d.inputFields?.map((f) => f.name) ?? d.fields?.map((f) => f.name);
  }
  // Every member of the union is some flavour of cloud resource, so id/name/type is the
  // common shape; ask each member for it rather than assuming a shared interface exists.
  const assetSel = assetMembers.length
    ? `vulnerableAsset{ ${assetMembers.map((m) => `... on ${m}{ id name type }`).join(" ")} }`
    : "";

  const vfCount = async (f) => {
    const r = await post(`query V($f:VulnerabilityFindingFilters){ vulnerabilityFindings(first:1, filterBy:$f){ totalCount } }`, { f });
    return r.ok ? r.data.vulnerabilityFindings.totalCount : { error: r.error.slice(0, 120) };
  };

  // THE FUNNEL. This is the deliverable: how many findings actually carry an exploitation
  // signal, versus how many exist. Only the signal-bearing ones need to be stored.
  const scope = PROJECT_ID ? { projectIdV2: { equals: [PROJECT_ID] } } : {};
  const OPEN = { status: ["OPEN"] };
  const funnel = [
    ["project scope, any status", { ...scope }],
    ["project scope, OPEN", { ...scope, ...OPEN }],
    ["  + hasCisaKevExploit", { ...scope, ...OPEN, hasCisaKevExploit: true }],
    ["  + hasExploit", { ...scope, ...OPEN, hasExploit: true }],
    ["  + severity CRITICAL", { ...scope, ...OPEN, severity: ["CRITICAL"] }],
    ["  + severity HIGH", { ...scope, ...OPEN, severity: ["HIGH"] }],
    ["  + hasFix true", { ...scope, ...OPEN, hasFix: true }],
    ["  + relatedIssue exists", { ...scope, ...OPEN, hasRelatedIssue: true }],
  ];
  line(`\n  THE FUNNEL — how much of the 5M actually carries a signal`);
  const funnelOut = {};
  for (const [label, f] of funnel) {
    const n = await vfCount(f);
    funnelOut[label.trim()] = n;
    line(`    ${label.padEnd(30)} ${typeof n === "number" ? n.toLocaleString().padStart(12) : `REFUSED ${n.error}`}`);
  }
  report.vulnFunnel = funnelOut;

  const working = { ...scope, ...OPEN, hasCisaKevExploit: true };
  {
    const r = await post(
      `query V($f:VulnerabilityFindingFilters,$n:Int!){ vulnerabilityFindings(first:$n, filterBy:$f){
         totalCount nodes{ id name status severity hasExploit hasCisaKevExploit
           epssProbability epssPercentile epssSeverity firstDetectedAt resolvedAt
           ${assetSel} } } }`,
      { f: working, n: Math.min(SAMPLE, 100) });
    if (!r.ok) line(`  sample FAILED: ${r.error}`);
    else {
      const rows = r.data.vulnerabilityFindings.nodes ?? [];
      const total = r.data.vulnerabilityFindings.totalCount;
      line(`\n  ${rows.length} sampled of ${total} in scope`);
      const kev = rows.filter((x) => x.hasCisaKevExploit === true).length;
      const exp = rows.filter((x) => x.hasExploit === true).length;
      const epssPresent = rows.filter((x) => typeof x.epssProbability === "number").length;
      const epssHi = rows.filter((x) => (x.epssProbability ?? 0) >= 0.1).length;
      line(`    hasCisaKevExploit true   ${kev}/${rows.length} (${pct(kev, rows.length)})`);
      line(`    hasExploit true          ${exp}/${rows.length} (${pct(exp, rows.length)})`);
      line(`    epssProbability present  ${epssPresent}/${rows.length} (${pct(epssPresent, rows.length)})`);
      line(`    epss >= 0.1              ${epssHi}/${rows.length} (${pct(epssHi, rows.length)})`);
      line(`    severity        ${JSON.stringify(tally(rows, (x) => x.severity))}`);
      line(`    asset type      ${JSON.stringify(tally(rows, (x) => x.vulnerableAsset?.type))}`);

      // Would the exploitation axis actually separate anything?
      const axis = tally(rows, (x) => x.hasCisaKevExploit === true ? "ACTIVE"
        : (x.hasExploit === true || (x.epssProbability ?? 0) >= 0.1) ? "LIKELY"
        : (x.hasExploit === null && x.hasCisaKevExploit === null && x.epssProbability === null) ? "UNKNOWN"
        : "NONE");
      line(`\n    PROPOSED exploitation axis  ${JSON.stringify(axis)}`);
      line(`      effCard ${effectiveCardinality(axis).toFixed(2)}   tie rate ${tieRate(axis).toFixed(3)}`);
      report.vulnFindings = { total, sampled: rows.length, kev, exploit: exp, epssPresent, epssHi,
        assetTypes: tally(rows, (x) => x.vulnerableAsset?.type), exploitationAxis: axis,
        axisEffCard: effectiveCardinality(axis), axisTieRate: tieRate(axis) };

      // The join question: do these assets exist in the AI register the app holds today?
      const ai = await post(
        `query A($f:CloudResourceFilters){ cloudResourcesV2(first:500, filterBy:$f){ nodes{ id } } }`,
        { f: { type: { equals: ["AI_AGENT","AI_MODEL","AI_DATASET","AI_SERVICE","AI_TOOL","AI_PIPELINE","AI_GUARDRAIL","MCP_SERVER"] },
               ...(PROJECT_ID ? { project: { idV2: { equals: [PROJECT_ID] } } } : {}) } });
      if (ai.ok) {
        const known = new Set((ai.data.cloudResourcesV2.nodes ?? []).map((n) => n.id));
        const hit = rows.filter((x) => x.vulnerableAsset?.id && known.has(x.vulnerableAsset.id)).length;
        line(`\n    ASSET JOIN — vulnerable assets already in the AI register: ${hit}/${rows.length} (${pct(hit, rows.length)})`);
        line(`      (register sample held ${known.size} AI asset ids)`);
        report.vulnFindings.assetJoinRate = rows.length ? hit / rows.length : null;
      } else line(`\n    ASSET JOIN — register fetch failed: ${ai.error.slice(0, 120)}`);
    }
  }
}

// ==== STAGE J — the attribution path. KEV findings sit on VMs and container images, which
// this register does not hold. hasRelatedIssue routes them through the issue register instead.
if (want("j")) {
  head("STAGE J — can the exploitation signal reach the work queue at all?");

  for (const n of ["RelatedIssueFrameworkCategoryFilter", "VulnerabilityFindingProjectIdFilter"]) {
    const t = await post(typeQ(n), {});
    if (t.ok && t.data.__type?.inputFields)
      line(`  ${n}: { ${t.data.__type.inputFields.map((f) => `${f.name}: ${renderType(f.type)}`).join(", ")} }`);
    else line(`  ${n}: ${t.error ?? "no input fields"}`);
  }
  const vfFields = report.vulnerabilityFindingFields ?? [];
  if (vfFields.length) line(`  VulnerabilityFinding issue-ish fields: ${vfFields.filter((f) => /issue/i.test(f)).join(", ") || "(none)"}`);

  const scope = PROJECT_ID ? { projectIdV2: { equals: [PROJECT_ID] } } : {};
  const vfCount = async (f) => {
    const r = await post(`query V($f:VulnerabilityFindingFilters){ vulnerabilityFindings(first:1, filterBy:$f){ totalCount } }`, { f });
    return r.ok ? r.data.vulnerabilityFindings.totalCount : `REFUSED ${r.error.slice(0, 110)}`;
  };
  const OPEN = { status: ["OPEN"] };
  const cases = [
    ["KEV", { ...scope, ...OPEN, hasCisaKevExploit: true }],
    ["relatedIssue", { ...scope, ...OPEN, hasRelatedIssue: true }],
    ["KEV AND relatedIssue", { ...scope, ...OPEN, hasCisaKevExploit: true, hasRelatedIssue: true }],
    ["hasExploit AND relatedIssue", { ...scope, ...OPEN, hasExploit: true, hasRelatedIssue: true }],
    ["relatedIssue sev CRITICAL/HIGH", { ...scope, ...OPEN, hasRelatedIssue: true, relatedIssueSeverity: ["CRITICAL", "HIGH"] }],
    ["relatedIssue in AI category", { ...scope, ...OPEN, hasRelatedIssue: true, relatedIssueFrameworkCategory: { equalsAny: ["wct-id-1998"] } }],
    ["relatedIssue in CANDIDATE cats", { ...scope, ...OPEN, hasRelatedIssue: true, relatedIssueFrameworkCategory: { equalsAny: CANDIDATE_SET } }],
  ];
  line("");
  const out = {};
  for (const [label, f] of cases) {
    const n = await vfCount(f);
    out[label] = n;
    line(`    ${label.padEnd(32)} ${typeof n === "number" ? n.toLocaleString().padStart(10) : n}`);
  }
  report.attribution = out;

  // The exploitation axis over the WHOLE population, computed from exact counts rather than
  // sampled — a KEV-only sample would report a single value and prove nothing.
  const total = await vfCount({ ...scope, ...OPEN });
  const kev = out["KEV"], exp = await vfCount({ ...scope, ...OPEN, hasExploit: true });
  if (typeof total === "number" && typeof kev === "number" && typeof exp === "number") {
    const axis = { ACTIVE: kev, LIKELY: exp - kev, "NONE/UNKNOWN": total - exp };
    line(`\n  EXPLOITATION AXIS over all ${total.toLocaleString()} open findings in scope (exact, not sampled)`);
    line(`    ${JSON.stringify(axis)}`);
    line(`    effCard ${effectiveCardinality(axis).toFixed(2)}   tie rate ${tieRate(axis).toFixed(3)}`);
    report.exploitationAxisExact = { axis, effCard: effectiveCardinality(axis), tieRate: tieRate(axis) };
  }
}

// ==== STAGE K — the related-issue field. Stage J proved a KEV finding can reach an issue via
// hasRelatedIssue; this stage builds the concrete selection for that field (single object vs
// connection/list is unknown until introspected — the same union lesson §6.8 learned from
// VulnerableAsset applies to any object-shaped field, not only unions) and measures how much of
// the KEV/hasRelatedIssue sample actually resolves into the candidate-category issue set versus
// the AI-only set.
if (want("k")) {
  head("STAGE K — the related-issue field: shape, selection, and where it resolves");

  const refusals = [];
  const stageK = {
    sample: Math.min(SAMPLE, 100),
    relatedIssueField: null, vulnerableAssetFragment: "",
    distinctRelatedIssues: null, resolvedIntoCandidate: null, resolvedIntoAiOnly: null,
    share: null, nullCensus: null,
  };

  // ---- 1. Introspect VulnerabilityFinding, list every /issue/i field with kind + inner type.
  // A dedicated deep query: the field could be a raw `[Issue!]!` list (needs three ofType hops
  // to reach the named type) rather than the Connection object every other paginated root here
  // uses, and the shared typeQ() only carries two hops — not enough to tell which shape it is.
  const deepFieldQ = (n) => `{ __type(name:${JSON.stringify(n)}){ name kind
    fields{ name type{ kind name ofType{ kind name ofType{ kind name ofType{ kind name
      ofType{ kind name } } } } } } } }`;
  const unwrap = (t) => {
    let isList = false, cur = t;
    while (cur && (cur.kind === "NON_NULL" || cur.kind === "LIST")) {
      if (cur.kind === "LIST") isList = true;
      cur = cur.ofType;
    }
    return { isList, kind: cur?.kind ?? null, inner: cur?.name ?? null };
  };

  const vfType = await post(deepFieldQ("VulnerabilityFinding"), {});
  let issueFields = [];
  if (!vfType.ok || !vfType.data.__type) {
    const msg = `VulnerabilityFinding introspection FAILED: ${vfType.error ?? "null"}`;
    refusals.push(msg); line(`  ${msg}`);
  } else {
    const all = vfType.data.__type.fields ?? [];
    issueFields = all.filter((f) => /issue/i.test(f.name)).map((f) => ({ name: f.name, ...unwrap(f.type) }));
    if (!issueFields.length) {
      const msg = "no field on VulnerabilityFinding matches /issue/i";
      refusals.push(msg); line(`  ${msg}`);
    } else {
      line(`  VulnerabilityFinding fields matching /issue/i (${issueFields.length}):`);
      for (const f of issueFields) {
        const kindLabel = f.isList ? "LIST" : (f.kind ?? "?");
        const innerLabel = f.isList || f.kind === "OBJECT" ? (f.inner ?? "?") : "";
        line(`    ${f.name.padEnd(28)} kind=${kindLabel.padEnd(10)} inner=${innerLabel || "-"}`);
      }
      stageK.issueFields = issueFields.map((f) => ({
        name: f.name, kind: f.isList ? "LIST" : f.kind,
        inner: f.isList || f.kind === "OBJECT" ? f.inner : null,
      }));
    }
  }

  // Prefer a field literally named relatedIssue(s); fall back to the first /issue/i match so
  // the stage still reports something to look at when the name guess is wrong.
  const chosen = issueFields.find((f) => /^relatedissues?$/i.test(f.name)) ?? issueFields[0] ?? null;
  let relatedSelection = "", cardinality = null;
  if (chosen) {
    if (chosen.isList) {
      // A raw list already yields the item objects directly — no `nodes` wrapper to unwrap.
      relatedSelection = `${chosen.name}{ id }`;
      cardinality = "list";
    } else if (chosen.kind === "OBJECT") {
      const innerT = await post(typeQ(chosen.inner), {});
      const innerFieldNames = innerT.ok && innerT.data.__type?.fields ? innerT.data.__type.fields.map((f) => f.name) : [];
      if (innerFieldNames.includes("nodes")) { relatedSelection = `${chosen.name}{ nodes{ id } }`; cardinality = "connection"; }
      else { relatedSelection = `${chosen.name}{ id }`; cardinality = "single"; }
    } else {
      relatedSelection = chosen.name; // scalar/enum id — select the field bare
      cardinality = "scalar";
    }
    stageK.relatedIssueField = { name: chosen.name, kind: chosen.isList ? "LIST" : chosen.kind, inner: chosen.inner, cardinality };
    line(`\n  SELECTED related-issue field: ${chosen.name} -> selection \`${relatedSelection}\` (${cardinality})`);
  } else {
    const msg = "no related-issue field to select — see the introspection refusal above";
    refusals.push(msg); line(`\n  ${msg}`);
  }

  // ---- 2. VulnerableAsset union fragment — id-less members fall back to __typename only.
  const vaType = await post(typeQ("VulnerableAsset"), {});
  let assetFragment = "";
  if (!vaType.ok || !vaType.data.__type?.possibleTypes?.length) {
    const msg = `VulnerableAsset union introspection FAILED: ${vaType.error ?? "no possibleTypes"}`;
    refusals.push(msg); line(`\n  ${msg}`);
  } else {
    const members = vaType.data.__type.possibleTypes.map((p) => p.name);
    const parts = [];
    for (const m of members) {
      const mt = await post(typeQ(m), {});
      const fields = mt.ok && mt.data.__type?.fields ? mt.data.__type.fields.map((f) => f.name) : [];
      parts.push(fields.includes("id") ? `... on ${m}{ id type name }` : `... on ${m}{ __typename }`);
    }
    assetFragment = `vulnerableAsset{ ${parts.join(" ")} }`;
    line(`\n  VulnerableAsset union — ${members.length} members`);
    line(`  fragment: ${assetFragment}`);
  }
  stageK.vulnerableAssetFragment = assetFragment;

  // ---- 3/4. The sample query — related-issue selection + asset fragment together — and the
  // widened issue-id sets to resolve against.
  if (!chosen || !assetFragment) {
    const msg = "sample query skipped — no related-issue field or no asset fragment to select";
    refusals.push(msg); line(`\n  ${msg}`);
  } else {
    const sampleN = Math.min(SAMPLE, 100);
    const filterK = { status: ["OPEN"], hasCisaKevExploit: true, hasRelatedIssue: true };
    if (PROJECT_ID) filterK.projectIdV2 = { equals: [PROJECT_ID] };
    const q = `query V($f:VulnerabilityFindingFilters,$n:Int!){ vulnerabilityFindings(first:$n, filterBy:$f){
      totalCount nodes{ id name severity hasExploit hasCisaKevExploit epssProbability epssPercentile
        epssSeverity firstDetectedAt ${relatedSelection} ${assetFragment} } } }`;
    const r = await post(q, { f: filterK, n: sampleN });
    if (!r.ok) {
      const msg = `sample query FAILED: ${r.error}`;
      refusals.push(msg); line(`\n  ${msg}`);
    } else {
      const rows = r.data.vulnerabilityFindings.nodes ?? [];
      const total = r.data.vulnerabilityFindings.totalCount;
      line(`\n  ${rows.length} sampled of ${total} (KEV & hasRelatedIssue, OPEN, project scope)`);

      // Null census — null vs falsy(false/0) vs truthy, kept apart because "absent is never
      // zero" (CLAUDE.md, gas_ai scoring conventions).
      const census = (key) => {
        let n = 0, falsy = 0, truthy = 0;
        for (const row of rows) {
          const v = row[key];
          if (v === null || v === undefined) n++; else if (v === false || v === 0) falsy++; else truthy++;
        }
        return { null: n, falsy, truthy };
      };
      const nullCensus = { hasExploit: census("hasExploit"), hasCisaKevExploit: census("hasCisaKevExploit"),
        epssProbability: census("epssProbability") };
      line(`\n  NULL CENSUS (over ${rows.length} sampled)`);
      for (const [k2, v2] of Object.entries(nullCensus)) line(`    ${k2.padEnd(20)} null=${v2.null} falsy=${v2.falsy} truthy=${v2.truthy}`);
      stageK.nullCensus = nullCensus;

      const extractIds = (row) => {
        const v = row[chosen.name];
        if (v == null) return [];
        if (cardinality === "list") return Array.isArray(v) ? v.map((x) => x?.id).filter(Boolean) : [];
        if (cardinality === "connection") return (v.nodes ?? []).map((x) => x?.id).filter(Boolean);
        if (cardinality === "single") return v.id ? [v.id] : [];
        return [];
      };
      const relatedIds = new Set();
      for (const row of rows) for (const id of extractIds(row)) relatedIds.add(id);
      line(`\n  distinct related-issue ids in sample: ${relatedIds.size}`);
      stageK.distinctRelatedIssues = relatedIds.size;

      // The widened issue-id sets, paginated (issuesV2 has no bulk "in set" filter here, so the
      // membership test has to be done client-side against every id in scope).
      const fetchIssueIds = async (categories) => {
        const f = { status: ["OPEN", "IN_PROGRESS"], frameworkCategory: categories };
        if (PROJECT_ID) f.project = [PROJECT_ID];
        const q2 = `query I($f:IssueFilters,$n:Int!,$a:String){ issuesV2(first:$n, after:$a, filterBy:$f){
          totalCount pageInfo{ hasNextPage endCursor } nodes{ id } } }`;
        const ids = new Set();
        let after = null, pages = 0, totalCount = null;
        while (true) {
          const rr = await post(q2, { f, n: 500, a: after });
          if (!rr.ok) return { ok: false, error: rr.error, ids, pages };
          const conn = rr.data.issuesV2;
          totalCount = conn.totalCount;
          for (const node of conn.nodes ?? []) if (node?.id) ids.add(node.id);
          pages++;
          if (!conn.pageInfo?.hasNextPage || pages > 40) break;
          after = conn.pageInfo.endCursor;
        }
        return { ok: true, ids, pages, totalCount };
      };

      const candidateSet = await fetchIssueIds(CANDIDATE_SET);
      const aiSet = await fetchIssueIds(["wct-id-1998"]);

      if (!candidateSet.ok) {
        const msg = `candidate issue-id fetch FAILED after ${candidateSet.pages} page(s): ${candidateSet.error}`;
        refusals.push(msg); line(`\n  ${msg}`);
      } else {
        const resolvedIntoCandidate = [...relatedIds].filter((id) => candidateSet.ids.has(id)).length;
        const share = pct(resolvedIntoCandidate, relatedIds.size);
        line(`\n  widened candidate issue set: ${candidateSet.ids.size} ids over ${candidateSet.pages} page(s)` +
             ` (declared totalCount ${candidateSet.totalCount})`);
        line(`  resolved into candidate set: ${resolvedIntoCandidate}/${relatedIds.size} (${share})`);
        stageK.resolvedIntoCandidate = resolvedIntoCandidate;
        stageK.share = share;
      }

      if (!aiSet.ok) {
        const msg = `AI-only issue-id fetch FAILED after ${aiSet.pages} page(s): ${aiSet.error}`;
        refusals.push(msg); line(`\n  ${msg}`);
      } else {
        const resolvedIntoAiOnly = [...relatedIds].filter((id) => aiSet.ids.has(id)).length;
        line(`  resolved into AI-only set (wct-id-1998): ${resolvedIntoAiOnly}/${relatedIds.size} (${pct(resolvedIntoAiOnly, relatedIds.size)})`);
        stageK.resolvedIntoAiOnly = resolvedIntoAiOnly;
      }
    }
  }

  stageK.refusals = refusals;
  if (refusals.length) line(`\n  ${refusals.length} REFUSAL(S) — the figures above are partial; see refusals[] in the report.`);
  report.stageK = stageK;
}

// ============================ STAGE E — framework join: is the rule->framework map real?
if (want("e")) {
  head("STAGE E — framework join: does finding.rule actually resolve to a framework policy?");

  const cfBase = { status: ["OPEN"] };
  if (PROJECT_ID) cfBase.resource = { projectId: [PROJECT_ID] };
  const cf = await post(
    `query F($f:ConfigurationFindingFilters,$n:Int!){ configurationFindings(first:$n, filterBy:$f){
       totalCount nodes{ id severity result rule{ id shortId name } resource{ id type } } } }`,
    { f: cfBase, n: Math.min(SAMPLE, 100) });

  if (!cf.ok) { line(`  configurationFindings FAILED: ${cf.error}`); }
  else {
    const rows = cf.data.configurationFindings.nodes ?? [];
    const ruleIds = new Set(rows.map((r) => r.rule?.id).filter(Boolean));
    line(`  ${rows.length} findings sampled of ${cf.data.configurationFindings.totalCount}; ${ruleIds.size} distinct rules`);
    line(`    result          ${JSON.stringify(tally(rows, (r) => r.result))}`);
    line(`    severity        ${JSON.stringify(tally(rows, (r) => r.severity))}`);

    const fw = await post(
      `query FW($f:SecurityFrameworkFilters){ securityFrameworks(first:50, filterBy:$f){ nodes{ id name } } }`,
      { f: { enabled: true } });
    if (!fw.ok) { line(`  securityFrameworks FAILED: ${fw.error}`); }
    else {
      const policyRules = new Set();
      const frameworks = fw.data.securityFrameworks.nodes ?? [];
      for (const f of frameworks.slice(0, 8)) {
        const pa = await post(
          `query P($id:ID!,$p:[String!]){ securityFramework(id:$id){ name
             complianceAnalytics(selection:{projectId:$p}){
               categoryAnalytics{ subCategoryAnalytics{ policyAnalytics{
                 cloudConfigurationRule{ id shortId } } } } } } }`,
          { id: f.id, p: PROJECT_ID ? [PROJECT_ID] : null });
        if (!pa.ok) { line(`    ${f.name}: policy fetch failed — ${pa.error.slice(0, 90)}`); continue; }
        let n = 0;
        for (const c of pa.data.securityFramework?.complianceAnalytics?.categoryAnalytics ?? [])
          for (const s of c.subCategoryAnalytics ?? [])
            for (const p of s.policyAnalytics ?? [])
              if (p.cloudConfigurationRule?.id) { policyRules.add(p.cloudConfigurationRule.id); n++; }
        line(`    ${f.name.padEnd(38)} ${String(n).padStart(5)} policy rules`);
      }
      const hit = [...ruleIds].filter((id) => policyRules.has(id)).length;
      line(`\n  FRAMEWORK JOIN — finding rules that resolve to a framework policy: ${hit}/${ruleIds.size} (${pct(hit, ruleIds.size)})`);
      line(`    (framework side held ${policyRules.size} distinct rule ids)`);
      report.frameworkJoin = { findingRules: ruleIds.size, policyRules: policyRules.size,
        matched: hit, rate: ruleIds.size ? hit / ruleIds.size : null };
    }
  }
}

// ---------------------------------------------------------------------------------- output
report.apiCalls = CALLS;
writeFileSync(join(root, "phase0-report.json"), JSON.stringify(report, null, 2));
line(`\n${"-".repeat(78)}`);
line(`${CALLS} API calls. Written: phase0-report.json (nothing else was written anywhere).`);

// ==== STAGE CF — configurationFindings cannot widen wholesale (124k). Can they be scoped to
// the candidate categories instead of abandoned?
if (want("cf")) {
  head("STAGE CF — can configuration findings be category-scoped rather than dropped?");
  const b = { status: ["OPEN"] };
  if (PROJECT_ID) b.resource = { projectId: [PROJECT_ID] };
  const cfc = async (extra) => {
    const r = await post(`query C($f:ConfigurationFindingFilters){ configurationFindings(first:1, filterBy:$f){ totalCount } }`,
      { f: { ...b, ...extra } });
    return r.ok ? r.data.configurationFindings.totalCount : `REFUSED ${r.error.slice(0, 110)}`;
  };
  for (const [label, extra] of [
    ["ceiling (no category)", {}],
    ["AI only", { frameworkCategory: ["wct-id-1998"] }],
    ["CANDIDATE 6 cats", { frameworkCategory: CANDIDATE_SET }],
    ["CANDIDATE + result FAIL", { frameworkCategory: CANDIDATE_SET, }],
  ]) {
    const n = await cfc(extra);
    line(`    ${label.padEnd(28)} ${typeof n === "number" ? n.toLocaleString().padStart(10) : n}`);
    report[`cf_${label}`] = n;
  }
}

// ==== STAGE R — the open storage number. Widened findings reference resources ai_assets does
// not hold. How many DISTINCT ones? Grouped roots answer it without paging every row.
if (want("r")) {
  head("STAGE R — how many distinct resources do the widened findings reference?");
  for (const n of ["ConfigurationFindingGroupBy", "ConfigurationFindingGroupByFields",
                   "VulnerabilityFindingGroupBy", "VulnerabilityFindingsGroupedByValuesOrder"]) {
    const t = await post(typeQ(n), {});
    if (!t.ok || !t.data.__type) { line(`  ${n}: ${(t.error ?? "null").slice(0, 90)}`); continue; }
    const d = t.data.__type;
    if (d.enumValues?.length) line(`  ${n} enum: ${d.enumValues.map((v) => v.name).join(", ")}`);
    else if (d.inputFields?.length) line(`  ${n} input: ${d.inputFields.map((f) => `${f.name}: ${renderType(f.type)}`).join(", ")}`);
    else line(`  ${n}: kind ${d.kind}, no enum/input`);
  }
}

// ==== STAGE R2 — distinct resource counts via the grouped roots.
if (want("r2")) {
  head("STAGE R2 — distinct resources behind the widened register");
  for (const n of ["ConfigurationFindingGroupByField", "ConfigurationFindingGroupByFields"]) {
    const t = await post(typeQ(n), {});
    if (t.ok && t.data.__type?.enumValues?.length)
      line(`  ${n} enum: ${t.data.__type.enumValues.map((v) => v.name).join(", ")}`);
  }
  const scope = PROJECT_ID ? { projectIdV2: { equals: [PROJECT_ID] } } : {};

  // Vulnerability side: distinct vulnerable assets carrying an exploitation signal.
  for (const [label, f] of [
    ["KEV", { ...scope, status: ["OPEN"], hasCisaKevExploit: true }],
    ["relatedIssue", { ...scope, status: ["OPEN"], hasRelatedIssue: true }],
  ]) {
    const r = await post(
      `query G($f:VulnerabilityFindingFilters){ vulnerabilityFindingsGroupedByValues(
         first:1, filterBy:$f, groupBy:[VULNERABLE_ASSET]){ totalCount } }`, { f });
    line(`    vuln distinct assets · ${label.padEnd(14)} ${r.ok ? String(r.data.vulnerabilityFindingsGroupedByValues.totalCount).padStart(8) : `REFUSED ${r.error.slice(0,110)}`}`);
  }

  // Config side: distinct resources under the candidate categories.
  const cfB = { status: ["OPEN"], frameworkCategory: CANDIDATE_SET };
  if (PROJECT_ID) cfB.resource = { projectId: [PROJECT_ID] };
  for (const field of ["RESOURCE", "CLOUD_RESOURCE", "RESOURCE_ID"]) {
    const r = await post(
      `query G($f:ConfigurationFindingFilters,$g:ConfigurationFindingGroupBy!){
         configurationFindingsGroupedByValues(first:1, filterBy:$f, groupBy:$g){ totalCount } }`,
      { f: cfB, g: { fields: [field] } });
    line(`    config distinct by ${field.padEnd(14)} ${r.ok ? String(r.data.configurationFindingsGroupedByValues.totalCount).padStart(8) : `REFUSED ${r.error.slice(0,100)}`}`);
    if (r.ok) break;
  }
}

// ==== STAGE SC — scope audit. Two steps carry no projectScope(): CONFIG_RULES and
// FRAMEWORKS_LIST. Both are catalogues of DEFINITIONS, which are tenant-wide by nature. The
// live question is not "can they be project-scoped" but "how much of the catalogue does the
// scoped register actually reference".
if (want("sc")) {
  head("STAGE SC — how much of the rule catalogue does VALUE-CHAIN actually touch?");

  const t = await post(typeQ("CloudConfigurationRuleFilters"), {});
  if (t.ok && t.data.__type?.inputFields) {
    const names = t.data.__type.inputFields.map((f) => f.name);
    line(`  CloudConfigurationRuleFilters (${names.length}): ${names.join(", ")}`);
    report.cloudConfigurationRuleFilters = names;
  } else line(`  CloudConfigurationRuleFilters: ${t.error ?? "none"}`);

  const fw = await post(typeQ("SecurityFrameworkFilters"), {});
  if (fw.ok && fw.data.__type?.inputFields)
    line(`  SecurityFrameworkFilters: ${fw.data.__type.inputFields.map((f) => f.name).join(", ")}`);

  // The whole catalogue, as CONFIG_RULES collects it today.
  const all = await post(`{ cloudConfigurationRules(first:1){ totalCount } }`, {});
  const total = all.ok ? all.data.cloudConfigurationRules.totalCount : null;
  line(`\n  catalogue as CONFIG_RULES collects it today: ${total ?? `FAILED ${all.error}`}`);

  // How many distinct rules do the SCOPED findings actually reference?
  const b = { status: ["OPEN"] };
  if (PROJECT_ID) b.resource = { projectId: [PROJECT_ID] };
  for (const [label, extra] of [
    ["AI category only", { frameworkCategory: ["wct-id-1998"] }],
    ["candidate 6 cats", { frameworkCategory: CANDIDATE_SET }],
    ["every category in project", {}],
  ]) {
    const r = await post(
      `query G($f:ConfigurationFindingFilters,$g:ConfigurationFindingGroupBy!){
         configurationFindingsGroupedByValues(first:1, filterBy:$f, groupBy:$g){ totalCount } }`,
      { f: { ...b, ...extra }, g: { fields: ["RULE"] } });
    const n = r.ok ? r.data.configurationFindingsGroupedByValues.totalCount : `FAILED ${r.error.slice(0, 90)}`;
    const share = typeof n === "number" && total ? ` — ${((n / total) * 100).toFixed(1)}% of the catalogue` : "";
    line(`    distinct rules referenced · ${label.padEnd(26)} ${String(n).padStart(6)}${share}`);
    report[`rulesReferenced_${label}`] = n;
  }

  // Can the catalogue be narrowed at the query, or only after the fact?
  for (const [label, f] of [
    ["hasAssessments", { hasAssessments: true }],
    ["enabled", { enabled: true }],
  ]) {
    const r = await post(
      `query R($f:CloudConfigurationRuleFilters){ cloudConfigurationRules(first:1, filterBy:$f){ totalCount } }`,
      { f });
    line(`    catalogue filtered by ${label.padEnd(20)} ${r.ok ? String(r.data.cloudConfigurationRules.totalCount).padStart(6) : `REFUSED ${r.error.slice(0, 80)}`}`);
  }
}

// ==== STAGE SC2 — both "unscoped" catalogues DO expose a project filter. What do they yield?
if (want("sc2")) {
  head("STAGE SC2 — scoping the two catalogue steps to VALUE-CHAIN");
  const rules = async (f) => {
    const r = await post(`query R($f:CloudConfigurationRuleFilters){ cloudConfigurationRules(first:1, filterBy:$f){ totalCount } }`, { f });
    return r.ok ? r.data.cloudConfigurationRules.totalCount : `REFUSED ${r.error.slice(0, 90)}`;
  };
  const P = PROJECT_ID ? [PROJECT_ID] : null;
  for (const [label, f] of [
    ["(today: no filter)", {}],
    ["project", { project: P }],
    ["hasFindings", { hasFindings: true }],
    ["project + hasFindings", { project: P, hasFindings: true }],
    ["frameworkCategory = candidate", { frameworkCategory: CANDIDATE_SET }],
    ["project + frameworkCategory", { project: P, frameworkCategory: CANDIDATE_SET }],
  ]) line(`    cloudConfigurationRules · ${label.padEnd(30)} ${String(await rules(f)).padStart(6)}`);

  const fws = async (f) => {
    const r = await post(`query F($f:SecurityFrameworkFilters){ securityFrameworks(first:1, filterBy:$f){ totalCount } }`, { f });
    return r.ok ? r.data.securityFrameworks.totalCount : `REFUSED ${r.error.slice(0, 90)}`;
  };
  line("");
  for (const [label, f] of [
    ["(today: enabled only)", { enabled: true }],
    ["enabled + projectId", { enabled: true, projectId: P }],
    ["projectId only", { projectId: P }],
  ]) line(`    securityFrameworks · ${label.padEnd(33)} ${String(await fws(f)).padStart(6)}`);
}
