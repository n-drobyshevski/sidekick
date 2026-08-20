// One-shot Wiz connectivity check, run by hand from the Apps Script editor
// (`wizDiagnostic`). It exercises the SAME getToken + query path the sync uses — so
// it validates the real path — and prints a secret-safe report of exactly which step
// fails and why. Nothing here is called during a normal sync.

import {
  DEFAULT_WIZ_AUTH_URL,
  getProp,
  PROP_KEYS,
  resolveWizAuthMode,
  hasWizCredentials,
} from "./props";
import {
  fetchCloudResourcesPage,
  fetchTypeShape,
  getToken,
  resolveAiResourceTypes,
} from "./wizClientAi";
import { aiFlavored, aiInventoryVariables, Q_AI_INVENTORY } from "./wizQueriesAi";
import { readAll, TABS } from "./sheetsDb";
import { describeSyncSteps, testStepVariables } from "./syncJobs";
import { parseBool, parseTri } from "./syncStore";
import { AI_ASSET_KINDS, EDGE_TYPES } from "../domain/graphTypes";
import { READ_TIME_EDGE_TYPES } from "../domain/reach";
import {
  agentRunsAsSpec, noGuardrailSpec, saExcessiveAccessSpec, sensitiveDataAccessSpec,
} from "../domain/agentPathQuery";
import { endpointExposureSpec, hostExposureSpec } from "../domain/exposureQuery";
import { AGENT_EXPANSION, specVocabulary, type SelectSpec } from "../domain/graphExpand";
import { identityAccessSpec } from "../domain/identityQuery";
import { isOpenGap, isUnresolvedIssue } from "../domain/config";
import { readGraphSnapshot } from "./archiveStore";
import type { Rec } from "../domain/util";

/** Length + first4…last4 preview of a non-secret id/token — never the whole value. */
function preview(value: string | null): string {
  if (!value || !value.trim()) return "(unset)";
  const v = value.trim();
  if (v.length <= 10) return `${v.length} chars`;
  return `${v.length} chars, ${v.slice(0, 4)}…${v.slice(-4)}`;
}

/** Secrets get only a presence + length signal — never any character of the value. */
function secretPreview(value: string | null): string {
  return value && value.trim() ? `(set, ${value.trim().length} chars)` : "(unset)";
}

export function wizDiagnostic(): string {
  const lines: string[] = [];
  const log = (m: string) => {
    lines.push(m);
    console.log(m);
  };

  const apiUrl = getProp(PROP_KEYS.wizApiUrl);
  const authUrl = getProp(PROP_KEYS.wizAuthUrl) ?? DEFAULT_WIZ_AUTH_URL;
  const token = getProp(PROP_KEYS.wizApiToken);
  const clientId = getProp(PROP_KEYS.wizClientId);
  const clientSecret = getProp(PROP_KEYS.wizClientSecret);
  const projectId = getProp(PROP_KEYS.wizProjectIdV2);
  const mode = resolveWizAuthMode(token, clientId, clientSecret);

  log("=== Wiz SIDEKICK AI diagnostic ===");
  log(`WIZ_API_URL:        ${apiUrl || "(unset!)"}`);
  log(`Auth mode:          ${mode ?? "(none)"}`);
  log(`WIZ_API_TOKEN:      ${preview(token)}`);
  log(`WIZ_CLIENT_ID:      ${preview(clientId)}`);
  log(`WIZ_CLIENT_SECRET:  ${secretPreview(clientSecret)}`);
  if (mode === "oauth") log(`WIZ_AUTH_URL:       ${authUrl}`);
  log(`WIZ_PROJECT_ID_V2:  ${projectId || "(unset — querying all projects)"}`);

  if (!apiUrl) {
    log("FAIL: WIZ_API_URL is required, e.g. https://api.<region>.app.wiz.io/graphql.");
    return lines.join("\n");
  }
  if (mode === null) {
    log(
      "FAIL: no usable credentials — the app runs in dry-run mode. Set WIZ_API_TOKEN, " +
        "or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET.",
    );
    return lines.join("\n");
  }
  // Step 1 — obtain a bearer token (raw token verbatim, or a fresh OAuth exchange).
  try {
    const bearer = getToken(true);
    log(
      mode === "token"
        ? `Step 1 OK: using raw WIZ_API_TOKEN (${preview(bearer)}).`
        : `Step 1 OK: OAuth exchange minted an access token (${preview(bearer)}).`,
    );
  } catch (e) {
    log(`Step 1 FAIL: could not obtain a token — ${(e as Error).message}`);
    log(
      mode === "oauth"
        ? "→ The token endpoint rejected the client credentials. Verify WIZ_CLIENT_ID / " +
            "WIZ_CLIENT_SECRET (regenerate the service account in Wiz), and that " +
            "WIZ_AUTH_URL matches the auth host shown on the service-account page."
        : "→ WIZ_API_TOKEN is unusable. A Wiz GraphQL service account gives a client " +
            "id + secret, not a durable token; use WIZ_CLIENT_ID / WIZ_CLIENT_SECRET.",
    );
    return lines.join("\n");
  }

  // Step 2 — schema probe: THIS tenant's vocabulary decides which AI resource
  // types the sync queries (guessing produces GRAPHQL_VALIDATION_FAILED). The
  // SAME resolver the sync uses runs here, verbosely: introspection when the
  // gateway allows it, per-candidate 1-row probing when it doesn't.
  let chosen;
  try {
    chosen = resolveAiResourceTypes(log);
    log("Step 2 OK: AI resource types resolved.");
  } catch (e) {
    log(`Step 2 FAIL: ${(e as Error).message}`);
    return lines.join("\n");
  }

  // The graph vocabulary, checked against what this app actually SENDS.
  //
  // This block used to probe "GraphEntityTypeValue" and print a member count. It never worked:
  // the tenant's own rejection messages name the type `GraphEntityType`, so the probe asked for
  // a type that does not exist, `fetchEnumValues` answered null, and the code logged a soothing
  // "introspection unavailable". For as long as this app has existed, the one instrument that
  // could have listed the valid graph vocabulary was reporting "can't tell" to a question it was
  // asking wrong — which is exactly how four traversals shipped with names this tenant refuses.
  //
  // A member COUNT was never the useful output either. What an operator needs is the comparison:
  // of the names this codebase declares and sends, which does this tenant not have. That is the
  // difference between "your graph has 214 types" and "you are asking for RUNS_AS and it does
  // not exist here".
  graphVocabulary(log);

  // Step 3 — a minimal 1-row inventory query, exercising the real request path
  // with the types resolved above (filter passed as the $filterBy variable,
  // mirroring the captured working request).
  try {
    const page = fetchCloudResourcesPage({
      query: Q_AI_INVENTORY,
      first: 1,
      extraVariables: aiInventoryVariables(chosen.types),
    });
    log(
      `Step 3 OK: query succeeded — ${page.rows.length} AI asset(s) on page 1` +
        (page.totalCount !== null ? ` of ${page.totalCount} total` : "") + ".",
    );
    log("=== All checks passed. Live syncs should work. ===");
  } catch (e) {
    const msg = (e as Error).message;
    log(`Step 3 FAIL: the query was rejected — ${msg}`);
    if (/HTTP 401|HTTP 403|Unauthorized/i.test(msg)) {
      log(
        "→ 401/403/Unauthorized: the token was not accepted (expired, invalid, or minted " +
          "for a different tenant). Confirm the service account targets this tenant.",
      );
    } else if (/HTTP 404/i.test(msg)) {
      log(
        "→ 404: WIZ_API_URL host/path is wrong — it must be " +
          "https://api.<region>.app.wiz.io/graphql for your tenant's region.",
      );
    } else if (/cannot represent value/i.test(msg)) {
      log(
        "→ The tenant rejected one of the resolved type values. Set the " +
          "WIZ_AI_RESOURCE_TYPES Script Property to the exact enum values your tenant " +
          "accepts (comma-separated) and rerun this diagnostic.",
      );
    } else {
      log(
        "→ If the body names a field (e.g. \"Cannot query field\"), the service account " +
          "lacks permission for it or the tenant schema differs — capture the response " +
          "into ai/queries/reponse_schemas/ and reconcile the normalizers.",
      );
    }
    return lines.join("\n");
  }

  return lines.join("\n");
}

/**
 * Where the AARS scores actually are — run from the editor when the inventory shows no
 * score. Reads only the ledger, prints no asset content beyond counts, and answers the
 * three questions in order: does the tab have the column, do its rows carry values, and
 * does the Drive snapshot (which the graph reads instead) agree.
 *
 * A tab still headed `aars_band` with no `aars_severity` means this deployment predates
 * the column and needs a sync on a build that has it; the sync rewrites both the header
 * and every row.
 */
export function aarsDiagnostic(): string {
  const lines: string[] = [];
  const log = (m: string) => {
    lines.push(m);
    console.log(m);
  };

  log("=== AARS ledger diagnostic ===");
  try {
    const rows = readAll(TABS.assets);
    log(`ai_assets rows: ${rows.length}`);
    if (!rows.length) {
      log("The assets tab is empty — run a sync first.");
    } else {
      const cols = Object.keys(rows[0]);
      const has = (c: string) => (cols.indexOf(c) >= 0 ? "present" : "MISSING");
      log(`column aars:          ${has("aars")}`);
      log(`column aars_severity: ${has("aars_severity")}`);
      log(`column aars_band:     ${has("aars_band")} (pre-rename name; harmless if present)`);
      const scored = rows.filter((r: Rec) => r["aars"] !== null && r["aars"] !== undefined).length;
      const sev = rows.filter((r: Rec) => r["aars_severity"] || r["aars_band"]).length;
      log(`rows with a score:    ${scored} of ${rows.length}`);
      log(`rows with a severity: ${sev} of ${rows.length}`);
      if (scored && !sev) {
        log("→ Scores survived but severities did not: the tab was written by a build " +
          "whose schema had a column this sheet lacks. Deploy a build that adds missing " +
          "headers on write, then run one sync.");
      }
    }
  } catch (e) {
    log(`ai_assets unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  try {
    const snap = readGraphSnapshot();
    if (!snap) log("Drive snapshot: none (the graph falls back to the tabs)");
    else {
      const scored = snap.nodes.filter((n) => (n.aars ?? null) !== null).length;
      const sev = snap.nodes.filter(
        (n) => n.aarsSeverity || (n as { aarsBand?: unknown }).aarsBand,
      ).length;
      log(`Drive snapshot: ${snap.nodes.length} nodes, ${scored} scored, ${sev} with a severity`);
    }
  } catch (e) {
    log(`Drive snapshot unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  log("=== end ===");
  return lines.join("\n");
}

/**
 * What is actually IN the AI register, broken down by kind — run from the editor when the
 * landscape's headline numbers look wrong in a way no rule change explains.
 *
 * It exists because of a specific failure this product cannot otherwise see. Every scoring
 * model here reports a distribution over `ai_assets`, and a distribution is only a claim
 * about risk if the population is the one the reader assumes. A live tenant showed 97.58%
 * of assets at AARS INFO and 97.2% of them reaching the posture fallback tier — figures
 * that read as "an exceptionally clean AI landscape" and read equally well as "the register
 * is not the AI landscape". Those two readings call for opposite responses, and nothing in
 * the product distinguished them.
 *
 * The distinguishing question is one histogram: if a single `kind` holds most of the rows,
 * the degeneracy is a scope artefact and the models were never the problem. If the kinds
 * are spread the way an AI landscape is spread, the degeneracy is real and it is a visibility
 * finding. So this prints the breakdown and refuses to draw the conclusion — the numbers
 * decide it, not a threshold picked here.
 *
 * `withSignal` is the second half of the same question. An asset carrying no open issue,
 * no failing control and no held risk condition contributes nothing any model can score;
 * counting how many of those the register holds says whether "97% INFO" means "clean" or
 * means "never assessed". Reads the ledger only, prints counts and kind names, and never
 * an asset's identity.
 */
export function registerScopeDiagnostic(): string {
  const lines: string[] = [];
  const log = (m: string) => {
    lines.push(m);
    console.log(m);
  };
  const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");

  log("=== AI register scope diagnostic ===");

  let issueAssetIds = new Set<string>();
  let findingResourceIds = new Set<string>();
  try {
    for (const r of readAll(TABS.issues)) {
      if (isUnresolvedIssue({ status: String(r["status"] ?? "") })) {
        issueAssetIds.add(String(r["asset_id"] ?? ""));
      }
    }
    for (const r of readAll(TABS.findings)) {
      const gap = isOpenGap({
        result: (r["result"] as string) ?? undefined,
        status: (r["status"] as string) ?? undefined,
        // `parseTri`, not a comparison against a JS boolean: the tab is plain text and
        // `triCell` writes the lowercase strings "true"/"false"/"null". The first version of
        // this line tested `=== true || === "TRUE"` and matched neither, so every tombstoned
        // finding was counted as an open gap. `null` (a legacy row with no cell) is not
        // deleted, which is the same reading `rowToFinding` takes.
        deleted: parseTri(r["deleted"]) === true,
      });
      if (gap) findingResourceIds.add(String(r["resource_id"] ?? ""));
    }
  } catch (e) {
    log(`issues/findings unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  try {
    const rows = readAll(TABS.assets);
    log(`ai_assets rows: ${rows.length}`);
    if (!rows.length) {
      log("The assets tab is empty — run a sync first.");
    } else {
      const byKind = new Map<string, { total: number; signal: number }>();
      let aiKinded = 0;
      let anySignal = 0;

      for (const r of rows) {
        const kind = String(r["kind"] ?? "(blank)");
        const id = String(r["id"] ?? "");
        // "Signal" is anything a model could read: outstanding work, a failing control, or
        // a risk condition the graph established. The condition columns are read directly
        // rather than through riskConditions.conditionState because that predicate wants a
        // GNode and this diagnostic deliberately reads the flat ledger — the tab is what the
        // register IS, and a snapshot disagreeing with it is itself a finding.
        //
        // Through `parseBool`/`parseTri`, never a bare `=== true`. Cells are plain text and
        // hold the strings "true"/"false"/"null" (syncStore's boolCell/triCell), so the
        // original `r["sensitive_data"] === true` was dead: it could not fire on any row this
        // app has ever written, and the diagnostic reported a register carrying no risk
        // conditions at all. Sharing the ledger's own decoder is what keeps that impossible.
        //
        // `open_internet` is tested beside `internet` because conditionState treats
        // openToAllInternet as the STRONGER of the two (riskConditions.ts) — reading only the
        // weaker column is a second, quieter undercount of the same kind.
        const held =
          parseBool(r["sensitive_data"]) || parseBool(r["sensitive_access"]) ||
          parseBool(r["high_priv"]) || parseBool(r["admin_priv"]) ||
          parseBool(r["guardrail_missing"]) ||
          parseTri(r["internet"]) === true || parseTri(r["open_internet"]) === true;
        const signal = issueAssetIds.has(id) || findingResourceIds.has(id) || held;

        const slot = byKind.get(kind) ?? { total: 0, signal: 0 };
        slot.total += 1;
        if (signal) slot.signal += 1;
        byKind.set(kind, slot);

        if ((AI_ASSET_KINDS as readonly string[]).indexOf(kind) >= 0) aiKinded += 1;
        if (signal) anySignal += 1;
      }

      const ordered = [...byKind.entries()].sort((a, b) => b[1].total - a[1].total);
      log("");
      log("  by kind, most rows first — kind / rows / share / carrying signal:");
      for (const [kind, s] of ordered) {
        log(
          `    ${kind.padEnd(26)} ${String(s.total).padStart(7)}  ${pct(s.total, rows.length).padStart(6)}` +
          `   signal ${String(s.signal).padStart(6)} (${pct(s.signal, s.total)})`,
        );
      }

      const aiOrdered = ordered.filter(
        ([k]) => (AI_ASSET_KINDS as readonly string[]).indexOf(k) >= 0,
      );
      const topAi = aiOrdered[0];
      log("");
      log(`  distinct kinds:        ${ordered.length}`);
      log(`  carrying any signal:   ${anySignal} of ${rows.length} (${pct(anySignal, rows.length)})`);
      log("");
      // The substrate is in this tab BY DESIGN: the exposure, identity and data-reach
      // traversals pull buckets, service accounts and hosts in so the graph has something
      // to draw a path through. A low AI share is therefore not itself a fault. The number
      // that decides the scope question is the largest AI kind, because that is the
      // population every model's distribution is actually reporting on.
      log(`  in AI_ASSET_KINDS:     ${aiKinded} of ${rows.length} (${pct(aiKinded, rows.length)})`);
      log("    the rest is substrate the exposure / identity / data-reach traversals pull in");
      log("    so the graph has something to draw a path through. Expected, not a fault.");
      if (topAi) {
        log(
          `  largest AI kind:       ${topAi[0]} at ${topAi[1].total} rows — ` +
          `${pct(topAi[1].total, aiKinded)} of the AI landscape, ` +
          `${pct(topAi[1].signal, topAi[1].total)} of it carrying signal`,
        );
      }
      log("");
      log("  Read it this way, and let the numbers decide rather than a threshold picked here:");
      log("  · ONE AI kind holding most of the AI rows, and carrying little signal, means the");
      log("    register is wider than the AI landscape a reader pictures. Every distribution");
      log("    downstream is then a statement about that kind, not about AI risk. Check what");
      log("    that Wiz type actually enumerates before reading any model as degenerate.");
      log("  · AI kinds spread across agents / models / pipelines / datasets, most without");
      log("    signal, means the register is right and the landscape is genuinely unassessed —");
      log("    a visibility finding, and the models were never the problem.");
    }
  } catch (e) {
    log(`ai_assets unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  // The edge census — against the REACHABLE ceiling, not against the declared vocabulary.
  //
  // This block used to print "populated edge types: N of 23", counting every member of
  // EDGE_TYPES as something a sync could have produced. It cannot. Of the 23:
  //   · SIX are drawn at graph-READ time by graphEnrich's stub folds (READ_TIME_EDGE_TYPES in
  //     domain/reach.ts) and are correctly absent from the persisted tab — so they are excluded
  //     from the denominator entirely rather than counted as a shortfall;
  //   · SEVENTEEN can in principle land on the tab, which is the denominator printed below;
  //   · but only FIVE are produced by any sync NORMALIZER — RUNS_AS, HAS_FINDING,
  //     ALLOWS_ACCESS_TO, HOSTED_ON, SERVES (a `type: "…"` census of domain/syncNormalize.ts
  //     returns exactly those). The other twelve reach the tab only on the bundled sample
  //     dataset, which hand-authors them.
  // So a live tenant tops out at 5, and printing "N of 23" made that ceiling read as a
  // catastrophic shortfall on every healthy sync — the opposite of this diagnostic's job. It
  // hid the reverse too: on a tenant where the traversals genuinely produced nothing, "0 of 23"
  // looked like the same routine gap the eighteen always cause.
  //
  // The split itself is imported from reach.ts rather than restated, so the panel an analyst
  // reads and the log an operator reads cannot drift into two different censuses.
  try {
    const rows = readAll(TABS.edges);
    const seen = new Set<string>();
    for (const r of rows) seen.add(String(r["type"] ?? ""));
    const unseen = (EDGE_TYPES as readonly string[]).filter((t) => !seen.has(t));
    const readTime = (t: string) => (READ_TIME_EDGE_TYPES as readonly string[]).includes(t);
    const syntheticMissing = unseen.filter(readTime);
    const dead = unseen.filter((t) => !readTime(t));
    const persistable = (EDGE_TYPES as readonly string[]).filter((t) => !readTime(t));
    const populated = persistable.length - dead.length;
    log("");
    log(`  edge rows: ${rows.length}`);
    log(`  populated edge types:  ${populated} of ${persistable.length} persistable`);
    log(`    (${EDGE_TYPES.length} declared; ${syntheticMissing.length} of those are drawn at`);
    log("     read time and are not expected on this tab. A LIVE sync normalizes only five:");
    log("     RUNS_AS, HAS_FINDING, ALLOWS_ACCESS_TO, HOSTED_ON, SERVES — the rest reach this");
    log("     tab only on the bundled sample dataset.)");
    if (dead.length) log(`  never populated:       ${dead.join(", ")}`);
    if (!rows.length) {
      log("");
      log("  ZERO edges. Every persisted edge comes from one of six optional graphSearch steps");
      log("  (RUNS_AS, SA_FINDINGS, SENSITIVE_DATA_ACCESS, HOST_EXPOSURE, ENDPOINT_EXPOSURE,");
      log("  IDENTITY_ACCESS). A step that the tenant ACCEPTS and that matches nothing is");
      log("  recorded nowhere — not skipped, not truncated — so this reading alone cannot say");
      log("  whether those queries were rejected or simply found nothing. Check");
      log("  last_skipped_steps on the settings tab first; if it is empty, probe a step");
      log("  directly: probeSyncStep(\"HOST_EXPOSURE\") from this editor reports the row count,");
      log("  what the normalizer made of those rows, and a sample of what the tenant returned.");
    }
  } catch (e) {
    log(`ai_edges unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  log("=== end ===");
  return lines.join("\n");
}

/**
 * Probe every sync step that writes a graph edge, in one editor run.
 *
 * WHY THIS EXISTS AS A SEPARATE, ZERO-ARGUMENT FUNCTION. `api.probeSyncStep` takes a step id,
 * and the Apps Script editor's Run control invokes the selected global with NO arguments — there
 * is no way to pass one from the dropdown. So the parameterised probe is reachable only from the
 * Scans drill-down button, one step per click across four different area drawers. When the
 * question is "which of the six traversals is my tenant refusing, and what does it say", that is
 * four clicks and four page-loads to assemble one answer. Every other editor-run entry point in
 * this file is deliberately zero-argument for the same reason.
 *
 * WHY IT LIVES HERE AND NOT IN api.ts. Everything api.ts exports acquires a google.script.run
 * delegator — the dist/entry.js drift guard in esbuild.config.mjs enforces exactly that. A helper
 * that makes one live Wiz call PER STEP should not acquire a client-callable surface as a side
 * effect of where its source file sits.
 *
 * THE STEP LIST IS DERIVED, NOT WRITTEN DOWN. Every edge-producing step already declares itself
 * through `writes`, so a seventh traversal added tomorrow is probed by this without anyone
 * remembering to come back here. A hand-written array would be the fourth copy of that list in
 * this codebase and the first one able to go quietly stale.
 *
 * COST: one live page request per step, six today, and the two exposure documents each spread
 * three ten-wide nested sub-connections per entity — this is not six cheap pings. If it ever
 * approaches the Apps Script execution ceiling, probe one step at a time from the Scans drawer
 * instead; that path is already shipped and does the same thing.
 *
 * Nothing is persisted, no job is created, and a rejected step is reported as a value rather
 * than thrown (see syncJobs.testStepVariables), so one refusal cannot abort the run.
 */
export function probeEdgeSteps(): string {
  const lines: string[] = [];
  const log = (m: string) => {
    lines.push(m);
    console.log(m);
  };

  log("=== edge-producing step probe ===");

  if (!hasWizCredentials()) {
    log(
      "A probe calls Wiz, and no credentials are configured — this deployment is in dry-run. " +
      "Add credentials in Settings to probe a step against the tenant.",
    );
    log("=== end ===");
    return lines.join("\n");
  }

  let steps: Rec[];
  try {
    // `describeSyncSteps`, not the private `syncSteps`: it is already exported, already
    // resolves the tenant's AI type list the way the battery will, and already returns the
    // `writes` declaration this filter reads. Nothing new has to be made public.
    steps = describeSyncSteps().filter((s) =>
      ((s["writes"] as string[]) ?? []).some((w: string) => String(w).indexOf("ai_edges") === 0),
    );
  } catch (e) {
    log(`Could not describe the battery: ${String(e instanceof Error ? e.message : e)}`);
    log("=== end ===");
    return lines.join("\n");
  }

  if (!steps.length) {
    log("No step in this battery writes to ai_edges — nothing to probe.");
    log("=== end ===");
    return lines.join("\n");
  }

  // Two passes over the same results: the summary first, because it is the part worth reading at
  // a glance and the part worth pasting into a conversation. Probing once and rendering twice —
  // never probing twice — because each probe is a live call.
  const results: Array<{ id: string; area: string; res: Rec }> = [];
  for (const step of steps) {
    const id = String(step["id"] ?? "");
    results.push({
      id,
      area: String(step["area"] ?? ""),
      res: testStepVariables(id, null),
    });
  }

  const width = Math.max(...results.map((r) => r.id.length));
  const pad = (s: string) => s + " ".repeat(Math.max(0, width - s.length));
  log("");
  for (const { id, res } of results) {
    if (res["ok"] === false) {
      log(`  ${pad(id)}  REJECTED  ${String(res["error"] ?? "").slice(0, 160)}`);
      continue;
    }
    const n = (res["normalized"] as Rec) ?? {};
    log(
      `  ${pad(id)}  ok        ${Number(res["rows"] ?? 0)} rows → ` +
      `${Number(n["nodes"] ?? 0)} nodes, ${Number(n["edges"] ?? 0)} edges` +
      (res["hasNextPage"] ? " (more pages)" : ""),
    );
  }

  // Then the detail. `variables` is included deliberately: it echoes the resolved projectId and
  // the root type list, which are the two moving parts behind an accepted-but-empty step, and
  // neither is visible anywhere else without reading Script Properties by hand.
  for (const { id, area, res } of results) {
    log("");
    log(`--- ${id} (${area}) ---`);
    log(JSON.stringify(res, null, 2));
  }

  log("");
  log("Read it this way:");
  log("  · REJECTED means the tenant refused the document — the message names the token its");
  log("    schema does not have, and the fix is this app's query, not your permissions.");
  log("  · ok with 0 rows means the query was accepted and matched nothing. Check the echoed");
  log("    `variables.projectId` and `variables.query.type` before concluding anything: the");
  log("    mandatory inventory query is tenant-wide while these steps are project-scoped.");
  log("  · ok with rows but 0 normalized edges means the query works and the NORMALIZER is");
  log("    dropping what came back — read `sample` for the entity types the tenant returned.");

  log("=== end ===");
  return lines.join("\n");
}


/**
 * Report this tenant's graph vocabulary against the names this codebase declares.
 *
 * TWO SCHEMA TYPES, both named by the tenant's own HTTP 400 bodies rather than guessed:
 * `GraphEntityType` for entities, `GraphDirectedRelationshipTypeInput` for relationships. The
 * second is an input OBJECT, not an enum — a relationship is sent as `[{ type, reverse }]` — so
 * its members live behind one of its fields, and the probe follows that hop rather than assuming
 * a name for it.
 *
 * Best-effort throughout: a tenant with introspection disabled must get a diagnostic that says
 * so, not one that throws. Every branch prints why it could not answer.
 */
function graphVocabulary(log: (m: string) => void): void {
  const entity = fetchTypeShape("GraphEntityType");
  const rel = fetchTypeShape("GraphDirectedRelationshipTypeInput");

  const report = (label: string, declared: readonly string[], members: string[]): void => {
    const have = new Set(members);
    const absent = declared.filter((d) => !have.has(d));
    log(
      `  ${label}: ${members.length} members on this tenant; this app declares ` +
      `${declared.length}, ${declared.length - absent.length} present.`,
    );
    // The absent list IS the finding. Printed in full, never truncated to a count: a name this
    // app sends that the tenant does not have is a query that will be refused, and which one it
    // is happens to be the entire content of the answer.
    if (!absent.length) {
      log("    every declared name exists on this tenant.");
      return;
    }
    log(`    ABSENT HERE: ${absent.join(", ")}`);
    // For each absent name, the tenant members that SHARE A WORD with it.
    //
    // Knowing RUNS_AS does not exist is half an answer; the other half is what this tenant
    // calls that hop, and it is already in `members` — the probe fetched all of them and the
    // first version of this block threw them away to print a count. A name is a name, so the
    // match is on underscore-separated words and nothing cleverer.
    //
    // STRING SIMILARITY IS NOT SEMANTIC EQUIVALENCE, and this block must never be read as if
    // it were. `HAS_FINDING` sharing a word with `HAS_DATA_FINDING` says the two are spelled
    // alike, not that they mean the same hop — the only authority on that is a query the Wiz
    // console built and the tenant answered. These are leads to check, not substitutions to
    // make.
    for (const name of absent) {
      const words = new Set(name.split("_"));
      const near = members
        .map((m) => ({ m, hits: m.split("_").filter((w) => words.has(w)).length }))
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits || a.m.length - b.m.length)
        .slice(0, 6)
        .map((x) => x.m);
      log(`      ${name} → ${near.length ? near.join(", ") : "(nothing spelled like it)"}`);
    }
  };

  // What the app WILL SEND, not what it persists. `NODE_KINDS`/`EDGE_TYPES` are the model's own
  // vocabularies — they carry read-time synthetics and names no query has ever named — and the
  // two namespaces diverge on purpose: the battery sends ACTING_AS and persists RUNS_AS. Checking
  // the persisted lists against a tenant reported absences for names nobody sends, which buries
  // the real ones. These come off the shipped traversals themselves.
  const sent = sentVocabulary();

  if (entity && entity.enumValues.length) {
    report("Graph entity types (GraphEntityType)", sent.entities, entity.enumValues);
    const ai = aiFlavored(entity.enumValues);
    log(`    AI-flavored members: ${ai.join(", ") || "(none)"}`);
  } else {
    log(
      `  Graph entity types: could not read GraphEntityType` +
      `${entity ? ` (kind ${entity.kind}, no enum members)` : " (no such type, or introspection " +
      "is disabled)"}. Graph traversals cannot be checked ahead of time on this tenant.`,
    );
  }

  if (!rel) {
    log(
      "  Graph relationships: could not read GraphDirectedRelationshipTypeInput (no such type, " +
      "or introspection is disabled).",
    );
    return;
  }
  // The relationship enum sits behind a field of the input object. `type` is the field the
  // working queries populate, so try it first and then anything else the object declares —
  // named rather than assumed, because a wrong guess here is what this whole block exists to
  // stop happening again.
  const candidates = ["type", ...rel.inputFields.filter((f) => f !== "type")];
  for (const field of candidates) {
    const probe = fetchTypeShape(relEnumName(field));
    if (probe && probe.enumValues.length) {
      report(`Graph relationships (via ${field})`, sent.edges, probe.enumValues);
      // The whole vocabulary, once, sorted. A hundred names is a paragraph, and it is the
      // paragraph that ends the guessing: with it in hand nobody has to infer this tenant's
      // relationship names from a capture, a planning doc, or a hopeful substitution again.
      log("    every relationship this tenant has:");
      log(`      ${[...probe.enumValues].sort().join(", ")}`);
      return;
    }
  }
  log(
    `  Graph relationships: GraphDirectedRelationshipTypeInput has fields ` +
    `[${rel.inputFields.join(", ") || "none readable"}], but none of them resolved to an enum ` +
    "this probe could read. Relationship names cannot be checked ahead of time; the probe in " +
    "probeEdgeSteps() reports what the tenant says about them instead.",
  );
}

/**
 * The conventional enum name behind an input-object field. A guess by construction — which is
 * why every caller treats a miss as "could not read" and falls through, rather than reporting an
 * empty vocabulary as if it had been measured.
 */
function relEnumName(field: string): string {
  return field === "type" ? "GraphRelationshipType" : `Graph${field}Type`;
}


/**
 * Every entity type and relationship name the shipped traversals will send, deduped and sorted.
 *
 * One entry per spec builder, listed by hand because that is the honest shape: a new traversal is
 * a new call site here, and a traversal missing from this list is one the vocabulary check cannot
 * warn about. `AGENT_EXPANSION` is included even though it is not a battery step — `expandAsset`
 * runs it live against the same tenant, so a name it carries can be refused the same way.
 *
 * `describeAiTypes()` is deliberately NOT consulted for the type-dependent specs: their root list
 * is the AI resource vocabulary, which `resolveAiResourceTypes` has already checked against the
 * tenant by the time this runs. Passing an empty root here keeps this check about the names this
 * codebase hardcodes, which are the ones nothing else validates.
 */
function sentVocabulary(): { entities: string[]; edges: string[] } {
  const specs: SelectSpec[] = [
    noGuardrailSpec(),
    agentRunsAsSpec(),
    saExcessiveAccessSpec(),
    sensitiveDataAccessSpec(),
    identityAccessSpec([]),
    hostExposureSpec([]),
    endpointExposureSpec([]),
    AGENT_EXPANSION,
  ];
  const entities = new Set<string>();
  const edges = new Set<string>();
  for (const spec of specs) {
    const v = specVocabulary(spec);
    for (const e of v.entities) entities.add(e);
    for (const e of v.edges) edges.add(e);
  }
  return { entities: [...entities].sort(), edges: [...edges].sort() };
}
