// Cross-scan finding identity and ledger-sourced MTTR — the port of
// gas/src/domain/lifecycle.ts, renamed and reshaped for the three-scope register.
//
// RULE 1 (the D1 brief): scope is part of the key.
//   finding_key = "<scope>:" + identity
//   identity    = "id:" + node.id                                            for sca / sast
//               = "h:" + sha1Hex(secretDataId + "|" + path + "|" + lineNumber)
//                     .slice(0, 16)                                          for secrets
//
// gas/'s vulnKey prefers node.id and falls back to a hash of (cve|asset|type|cloud|component)
// only when no id is present — a fallback this register does not need: sca and sast nodes
// always carry a Wiz-assigned `id` (Q_SCA / Q_SAST both select it), so findingKey does not
// port that fallback branch.
//
// Secrets NEVER key on node.id or externalId. Both differ between the REPOSITORY and
// REPOSITORY_BRANCH twins Wiz emits for the same credential — PROBE_FINDINGS.md §10.6/§10.7
// measured 187 such twin keys, with externalId differing on every one of them (Wiz builds it
// from the resource, and the branch form inserts a branch segment) and the two twins'
// firstSeenAt disagreeing by a median of 19.9 days. Keying on secretDataId+path+lineNumber
// instead collapses the twins into one row; sheetsDb.ts's TAB_HEADERS[TABS.ledger] comment is
// the full argument and the ledger population this hash is read back against.

import { sha1Hex } from "./sha1";
import type { Scope } from "./config";
import { summarize, type MttrSummary } from "./metrics";
import { normalizeSeverity } from "./severity";
import { clean, parseTs, pyStr, type Rec } from "./util";

/**
 * Stable cross-scan identity for a finding, scoped: "<scope>:id:<wiz node id>" for sca/sast,
 * "<scope>:h:<16-hex>" for secrets. See the module header for why secrets hashes
 * (secretDataId, path, lineNumber) rather than trusting node.id/externalId, and why sca/sast
 * have no hash fallback the way gas/'s vulnKey does.
 */
export function findingKey(scope: Scope, node: Rec): string {
  if (scope === "secrets") {
    const secretDataId = pyStr(clean(node["secretDataId"]) ?? "");
    const path = pyStr(clean(node["path"]) ?? "");
    const lineNumber = pyStr(clean(node["lineNumber"]) ?? "");
    const basis = `${secretDataId}|${path}|${lineNumber}`;
    return `${scope}:h:${sha1Hex(basis).slice(0, 16)}`;
  }
  const rawId = node["id"];
  const id = typeof rawId === "string" ? rawId.trim() : pyStr(clean(rawId) ?? "");
  return `${scope}:id:${id}`;
}

// --------------------------------------------------------------------------- #
//  mttrFromLedger — the ledger-sourced (perSev, overall) MTTR summary
// --------------------------------------------------------------------------- #
//
// gas/'s mttrFromLedger delegates to metrics.ts's summarize(); at D1 time metrics.ts had not
// been ported to gas_devsecops yet, so the reduction was inlined here as a DELIBERATE
// DUPLICATE (see git history for that block). metrics.ts is ported now (D9) — this imports
// summarize() from it instead, and SevStats/OverallStats/MttrSummary now live there too (grep
// confirmed nothing outside this file imported those three types off lifecycle.ts, so they are
// not re-exported here).

/**
 * (perSev, overall) MTTR summary from durable ledger lifecycle rows — the exact contract of
 * gas/'s mttrFromLedger, computed from first_seen/resolved_at/severity. Column names are
 * unchanged from gas/ (severity, first_seen, resolved_at all survive the sheetsDb.ts rename
 * unchanged — only asset_id/asset_name/cve moved), so no per-field rename was needed here.
 *
 * `scope`: optional, since this ledger spans three scopes sharing one table (config.ts's
 * `scope` is part of every row's identity) where gas/'s register had only one. Every ledger
 * row carries `scope`, so — unlike metrics.calculateMttr's best-effort attach — this always
 * has it to filter on.
 */
export function mttrFromLedger(
  ledgerRows: Iterable<Rec>,
  opts: { now?: number; scope?: Scope } = {},
): MttrSummary {
  const rows = [...ledgerRows];
  if (!rows.length) return { perSev: {}, overall: {} };
  const work = rows.map((r) => ({
    sev: "severity" in r ? normalizeSeverity(r["severity"]) : "UNKNOWN",
    firstSeen: parseTs(r["first_seen"]),
    resolved: parseTs(r["resolved_at"]),
    scope: "scope" in r ? (r["scope"] as Scope) : undefined,
  }));
  return summarize(work, opts.now, opts.scope);
}
