// One-shot Wiz connectivity check, run by hand from the Apps Script editor
// (`wizDiagnostic`). It exercises the SAME getToken + query path the sync uses — so
// it validates the real path — and prints a secret-safe report of exactly which step
// fails and why. Nothing here is called during a normal sync.

import {
  DEFAULT_WIZ_AUTH_URL,
  getProp,
  PROP_KEYS,
  resolveWizAuthMode,
} from "./props";
import {
  fetchCloudResourcesPage,
  fetchEnumValues,
  getToken,
  resolveAiResourceTypes,
} from "./wizClientAi";
import { aiFlavored, aiInventoryVariables, Q_AI_INVENTORY } from "./wizQueriesAi";
import { readAll, TABS } from "./sheetsDb";
import { AI_ASSET_KINDS, EDGE_TYPES } from "../domain/graphTypes";
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

  // Informational: the graph-relationship steps use the graph entity vocabulary.
  const graphEnum = fetchEnumValues("GraphEntityTypeValue");
  if (graphEnum) {
    log(
      `Graph entity types: ${graphEnum.length} members; AI-flavored: ` +
        `${aiFlavored(graphEnum).join(", ") || "(none — graph relationship steps will be skipped)"}.`,
    );
  } else {
    log(
      "Graph entity introspection unavailable — graph relationship steps will be " +
        "skipped automatically if this tenant rejects their queries.",
    );
  }

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
 * estate's headline numbers look wrong in a way no rule change explains.
 *
 * It exists because of a specific failure this product cannot otherwise see. Every scoring
 * model here reports a distribution over `ai_assets`, and a distribution is only a claim
 * about risk if the population is the one the reader assumes. A live tenant showed 97.58%
 * of assets at AARS INFO and 97.2% of them reaching the posture fallback tier — figures
 * that read as "an exceptionally clean AI estate" and read equally well as "the register
 * is not the AI estate". Those two readings call for opposite responses, and nothing in
 * the product distinguished them.
 *
 * The distinguishing question is one histogram: if a single `kind` holds most of the rows,
 * the degeneracy is a scope artefact and the models were never the problem. If the kinds
 * are spread the way an AI estate is spread, the degeneracy is real and it is a visibility
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
        deleted: r["deleted"] === true || r["deleted"] === "TRUE",
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
        // a risk condition the graph established. The four condition columns are read
        // directly rather than through riskConditions.conditionState because that predicate
        // wants a GNode and this diagnostic deliberately reads the flat ledger — the tab is
        // what the register IS, and a snapshot disagreeing with it is itself a finding.
        const held =
          r["sensitive_data"] === true || r["sensitive_access"] === true ||
          r["high_priv"] === true || r["admin_priv"] === true ||
          r["guardrail_missing"] === true || r["internet"] === true;
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
          `${pct(topAi[1].total, aiKinded)} of the AI estate, ` +
          `${pct(topAi[1].signal, topAi[1].total)} of it carrying signal`,
        );
      }
      log("");
      log("  Read it this way, and let the numbers decide rather than a threshold picked here:");
      log("  · ONE AI kind holding most of the AI rows, and carrying little signal, means the");
      log("    register is wider than the AI estate a reader pictures. Every distribution");
      log("    downstream is then a statement about that kind, not about AI risk. Check what");
      log("    that Wiz type actually enumerates before reading any model as degenerate.");
      log("  · AI kinds spread across agents / models / pipelines / datasets, most without");
      log("    signal, means the register is right and the estate is genuinely unassessed —");
      log("    a visibility finding, and the models were never the problem.");
    }
  } catch (e) {
    log(`ai_assets unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  // The edge census. Eleven of the declared relationship types have never been observed to
  // populate on a live tenant, and each dead one silently removes a class of question the
  // product appears able to answer — tool use, model provenance, agent-to-agent trust.
  try {
    const rows = readAll(TABS.edges);
    const seen = new Set<string>();
    for (const r of rows) seen.add(String(r["type"] ?? ""));
    const dead = (EDGE_TYPES as readonly string[]).filter((t) => !seen.has(t));
    log("");
    log(`  edge rows: ${rows.length}`);
    log(`  populated edge types:  ${EDGE_TYPES.length - dead.length} of ${EDGE_TYPES.length}`);
    if (dead.length) log(`  never populated:       ${dead.join(", ")}`);
  } catch (e) {
    log(`ai_edges unreadable: ${String(e instanceof Error ? e.message : e)}`);
  }

  log("=== end ===");
  return lines.join("\n");
}
