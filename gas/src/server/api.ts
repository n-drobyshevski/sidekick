// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  SEVERITY_COLORS,
  SEVERITY_GLYPHS,
  SEVERITY_ORDER,
  SLA_TARGETS,
  SELECTABLE_SEVERITIES,
} from "../domain/config";
import { domainNames, validateDomains, compileDomains, assignDomain, UNASSIGNED } from "../domain/domainRules";
import { mttrFromLedger, vulnKey } from "../domain/lifecycle";
import { extractNodes } from "../domain/transform";
import { overallSlaOldest } from "../domain/metrics";
import { normalizeSeverity } from "../domain/severity";
import { SealedScanError, LedgerRebuildError } from "../domain/maintenance";
import { parseTs, present, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as findings from "./findings";
import * as history from "./historyStore";
import { activeJob, getJob } from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { hasWizCredentials } from "./props";
import * as scanJobs from "./scanJobs";
import * as settingsStore from "./settingsStore";
import { cellCount } from "./sheetsDb";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: string;
}

function run<T>(fn: () => T): ApiResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    const kind =
      e instanceof SealedScanError
        ? "sealed"
        : e instanceof LedgerRebuildError
          ? "rebuild"
          : e instanceof LedgerBusyError
            ? "busy"
            : "error";
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
  }
}

function mutate<T>(fn: () => T): ApiResult<T> {
  return run(() =>
    withScriptLock(() => {
      recoverIfNeeded();
      return fn();
    }),
  );
}

// ------------------------------------------------------------------------ bootstrap

export function bootstrap(_p?: unknown): ApiResult {
  return run(() => {
    const settings = settingsStore.loadSettings();
    const scan = findings.currentScan();
    const latest = ledgerStore.latestScanRow();
    const counts: Record<string, number> = {};
    if (scan) {
      for (const r of scan.records) {
        const sev = String(r["_sev"]);
        counts[sev] = (counts[sev] ?? 0) + 1;
      }
    }
    return {
      palette: {
        order: SEVERITY_ORDER,
        colors: SEVERITY_COLORS,
        glyphs: SEVERITY_GLYPHS,
        slaTargets: SLA_TARGETS,
        selectable: SELECTABLE_SEVERITIES,
      },
      settings: {
        fetchSeverities: settingsStore.getFetchSeverities(),
        displaySeverities: settingsStore.getDisplaySeverities(),
        retentionDays: settingsStore.getRetentionDays(),
        autoCompact: settingsStore.getAutoCompact(),
        domains: settingsStore.getDomains(),
      },
      hasCredentials: hasWizCredentials(),
      latestScan: latest
        ? {
            scanId: latest.scan_id,
            ts: latest.ts,
            mode: latest.mode,
            shape: latest.shape,
            total: latest.total,
            severities: latest.severities,
          }
        : null,
      counts,
      prevCounts: ledgerStore.previousSeverityCounts(),
      domainNames: domainNames(settingsStore.getDomains().items),
      activeJob: activeJobSummary(),
      filterOptions: scan
        ? {
            statuses: findings.distinct(scan.records, "status"),
            assetTypes: findings.distinct(scan.records, "vulnerableAsset.type"),
            clouds: findings.distinct(scan.records, "vulnerableAsset.cloudPlatform"),
          }
        : { statuses: [], assetTypes: [], clouds: [] },
    };
  });
}

function activeJobSummary(): Rec | null {
  return (activeJob() as unknown as Rec) ?? null;
}

// ------------------------------------------------------------------------- findings

export function getFindings(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const scan = findings.currentScan();
    if (!scan) return { rows: [], total: 0, counts: {}, page: 0, pageCount: 0, groups: null };

    const filters: findings.FindingsFilters = {
      severities:
        (params["severities"] as string[]) ?? settingsStore.getDisplaySeverities(),
      statuses: (params["statuses"] as string[]) ?? [],
      assetTypes: (params["assetTypes"] as string[]) ?? [],
      clouds: (params["clouds"] as string[]) ?? [],
      domains: (params["domains"] as string[]) ?? [],
      q: (params["q"] as string) ?? "",
    };
    const filtered = findings.applyFilters(scan.records, filters);

    const counts: Record<string, number> = {};
    for (const r of filtered) {
      const sev = String(r["_sev"]);
      counts[sev] = (counts[sev] ?? 0) + 1;
    }

    const groupBy = (params["groupBy"] as string) ?? "";
    if (groupBy) {
      const keyFor = groupKeyFn(groupBy);
      const groups = new Map<string, Rec[]>();
      for (const r of filtered) {
        const k = keyFor(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      const ordered = [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 30); // group cap, matching the Streamlit page
      return {
        rows: [],
        total: filtered.length,
        counts,
        page: 0,
        pageCount: 0,
        groups: ordered.map(([key, rows]) => ({
          key,
          count: rows.length,
          sevCounts: sevCountsOf(rows),
          rows: rows.slice(0, 250).map(findings.tableRow), // per-group row cap
        })),
      };
    }

    const pageSize = Math.min(Number(params["pageSize"] ?? 100), 500);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(Number(params["page"] ?? 0), 0), pageCount - 1);
    return {
      rows: filtered.slice(page * pageSize, (page + 1) * pageSize).map(findings.tableRow),
      total: filtered.length,
      counts,
      page,
      pageCount,
      groups: null,
    };
  });
}

function groupKeyFn(groupBy: string): (r: Rec) => string {
  const col: Record<string, string> = {
    severity: "_sev",
    status: "status",
    atype: "vulnerableAsset.type",
    cloud: "vulnerableAsset.cloudPlatform",
    asset: "vulnerableAsset.name",
    subscription: "vulnerableAsset.subscriptionName",
    domain: "_domain",
  };
  const c = col[groupBy] ?? "_sev";
  return (r) => (present(r[c]) ? String(r[c]) : "(none)");
}

function sevCountsOf(rows: Rec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const sev = String(r["_sev"]);
    out[sev] = (out[sev] ?? 0) + 1;
  }
  return out;
}

export function getFindingDetail(p?: unknown): ApiResult {
  return run(() => {
    const key = String((p as Rec)?.["vulnKey"] ?? "");
    const scan = findings.currentScan();
    if (!scan || !key) return { record: null, raw: null };
    const record = scan.records.find((r) => r["_vuln_key"] === key) ?? null;
    // The raw node (full fields) lives in the scan's page archive; search pages with
    // early exit — the sheet opens for one finding at a time.
    let raw: Rec | null = null;
    const row = ledgerStore.loadScanRows().find((s) => s.scan_id === scan.scanId);
    const payload = row ? archive.readScanPayload(row.raw_ref) : null;
    if (payload && Array.isArray(payload)) {
      for (const page of payload) {
        const nodes = extractNodes(page);
        raw = (nodes.find((n) => vulnKey(n) === key) as Rec) ?? null;
        if (raw) break;
      }
    }
    return { record, raw };
  });
}

// ----------------------------------------------------------------------------- MTTR

export function getMttr(p?: unknown): ApiResult {
  return run(() => {
    const domain = String((p as Rec)?.["domain"] ?? "");
    let rows: Rec[] = ledgerStore.loadBaseRows() as unknown as Rec[];
    if (domain) {
      const compiled = compileDomains(settingsStore.getDomains().items);
      rows = rows.filter((r) => assignDomain(r, compiled) === domain);
    }
    const { perSev, overall } = mttrFromLedger(rows);
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    return { perSev, overall, slaPct, oldestDays, rowCount: rows.length };
  });
}

export function getMttrTrend(p?: unknown): ApiResult {
  return run(() => {
    const severities = ((p as Rec)?.["severities"] as string[]) ?? null;
    return {
      history: history.loadHistory(),
      trend: ledgerStore.loadTrend(severities),
    };
  });
}

// --------------------------------------------------------------------- scan history

export function getScanHistory(_p?: unknown): ApiResult {
  return run(() => {
    const scans = ledgerStore.loadScanRows().reverse(); // newest first
    const base = ledgerStore.loadBaseRows();
    const open = base.filter((r) => r.status === "OPEN").length;
    const resolved = base.filter((r) => r.status === "RESOLVED").length;
    const { overall } = mttrFromLedger(base as unknown as Rec[]);
    return {
      scans,
      kpis: {
        tracked: base.length,
        open,
        resolvedAllTime: resolved,
        medianMttr: overall.mttr_median ?? null,
      },
    };
  });
}

export function getBaseRows(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    let rows = ledgerStore.loadBaseRows() as unknown as Rec[];
    const compiled = compileDomains(settingsStore.getDomains().items);
    if (compiled.length) {
      rows = rows.map((r) => ({ ...r, _domain: assignDomain(r, compiled) }));
    }
    const statuses = (params["statuses"] as string[]) ?? [];
    const severities = (params["severities"] as string[]) ?? [];
    const domains = (params["domains"] as string[]) ?? [];
    const q = String(params["q"] ?? "").trim().toLowerCase();
    if (statuses.length) {
      const keep = new Set(statuses.map((s) => s.toUpperCase()));
      rows = rows.filter((r) => keep.has(String(r["status"] ?? "").toUpperCase()));
    }
    if (severities.length) {
      const keep = new Set(severities.map(normalizeSeverity));
      rows = rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (domains.length) {
      const keep = new Set(domains);
      rows = rows.filter((r) => keep.has(String(r["_domain"] ?? UNASSIGNED)));
    }
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r["cve"] ?? "").toLowerCase().includes(q) ||
          String(r["asset_name"] ?? "").toLowerCase().includes(q),
      );
    }
    const pageSize = Math.min(Number(params["pageSize"] ?? 100), 500);
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Math.max(Number(params["page"] ?? 0), 0), pageCount - 1);
    return {
      rows: rows.slice(page * pageSize, (page + 1) * pageSize),
      total: rows.length,
      page,
      pageCount,
    };
  });
}

// ------------------------------------------------------------------ jobs & mutations

export function runScan(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  return run(() =>
    scanJobs.startScan({
      incremental: Boolean(params["incremental"]),
      sampleShape: (params["sampleShape"] as string) ?? undefined,
    }),
  );
}

export function getJobStatus(p?: unknown): ApiResult {
  return run(() => {
    const jobId = String((p as Rec)?.["jobId"] ?? "");
    return jobId ? getJob(jobId) : activeJobSummary();
  });
}

export function cancelScan(p?: unknown): ApiResult {
  return run(() => scanJobs.cancelScan(String((p as Rec)?.["jobId"] ?? "")));
}

export function deleteScans(p?: unknown): ApiResult {
  const scanIds = (((p as Rec)?.["scanIds"] as string[]) ?? []).map(String);
  return mutate(() => ledgerStore.deleteScans(scanIds));
}

export function compact(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const dryRun = Boolean(params["dryRun"]);
  const days =
    params["retentionDays"] !== undefined
      ? Number(params["retentionDays"])
      : settingsStore.getRetentionDays();
  if (dryRun) return run(() => ledgerStore.compactLedger(days, true));
  return mutate(() => ledgerStore.compactLedger(days, false));
}

// -------------------------------------------------------------------------- reports

const REPORT_SOURCE = "OS vulnerabilities";

export function getReport(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const format = String(params["format"] ?? "markdown");
    const scan = findings.currentScan();
    if (!scan) return { content: "", filename: "", matrix: [] };
    const displayed = findings.applyFilters(scan.records, {
      severities: settingsStore.getDisplaySeverities(),
    });
    const counts = sevCountsOf(displayed);
    const { perSev, overall } = mttrFromLedger(ledgerStore.loadBaseRows() as unknown as Rec[]);
    void perSev;
    const generated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const matrix = [
      {
        source: REPORT_SOURCE,
        ...Object.fromEntries(SEVERITY_ORDER.map((s) => [s, counts[s] ?? 0])),
        total: displayed.length,
        medianMttr: overall.mttr_median ?? null,
        open: overall.open ?? 0,
      },
    ];
    if (format === "json") {
      return {
        content: JSON.stringify({ generated, sources: matrix }, null, 2),
        filename: `wiz-report-${generated.slice(0, 10)}.json`,
        matrix,
      };
    }
    if (format === "csv") {
      const cols = findings.TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
      const lines = [cols.join(",")];
      for (const r of displayed) {
        lines.push(cols.map((c) => csvCell(r[c])).join(","));
      }
      return {
        content: lines.join("\r\n"),
        filename: `wiz-report-${generated.slice(0, 10)}.csv`,
        matrix,
      };
    }
    const md = [
      `# Security summary — ${generated}`,
      "",
      `## ${REPORT_SOURCE}`,
      "",
      `| Severity | Count |`,
      `| --- | ---: |`,
      ...SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `| ${s} | ${counts[s]} |`),
      `| **Total** | **${displayed.length}** |`,
      "",
      `Median MTTR: ${overall.mttr_median != null ? overall.mttr_median.toFixed(1) + " days" : "—"}`,
      `Open findings: ${overall.open ?? 0}`,
    ].join("\n");
    return { content: md, filename: `wiz-report-${generated.slice(0, 10)}.md`, matrix };
  });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function getExportCsv(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const which = String(params["source"] ?? "findings");
    if (which === "base") {
      const rows = ledgerStore.loadBaseRows() as unknown as Rec[];
      const cols = [
        "vuln_key", "cve", "severity", "status", "asset_name", "asset_type", "cloud",
        "first_seen", "last_seen", "resolved_at", "resolution_src", "reopened_count",
        "mttr_days", "age_days", "subscription_name",
      ];
      const lines = [cols.join(",")];
      for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
      return { content: lines.join("\r\n"), filename: "wiz-vulnerability-base.csv" };
    }
    const scan = findings.currentScan();
    if (!scan) return { content: "", filename: "" };
    const filtered = findings.applyFilters(scan.records, {
      severities: (params["severities"] as string[]) ?? settingsStore.getDisplaySeverities(),
      statuses: (params["statuses"] as string[]) ?? [],
      assetTypes: (params["assetTypes"] as string[]) ?? [],
      clouds: (params["clouds"] as string[]) ?? [],
      domains: (params["domains"] as string[]) ?? [],
      q: (params["q"] as string) ?? "",
    });
    const cols = findings.TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
    const lines = [cols.join(",")];
    for (const r of filtered) lines.push(cols.map((c) => csvCell(r[c])).join(","));
    return {
      content: lines.join("\r\n"),
      filename: `wiz-os-vulnerabilities-${scan.scanId.slice(0, 10)}.csv`,
    };
  });
}

export function getExportRawUrl(p?: unknown): ApiResult {
  return run(() => {
    const scanId = String((p as Rec)?.["scanId"] ?? "");
    const row = scanId
      ? ledgerStore.loadScanRows().find((s) => s.scan_id === scanId)
      : ledgerStore.latestScanRow();
    if (!row?.raw_ref) return { urls: [] };
    const folder = DriveApp.getFolderById(row.raw_ref);
    const urls: Array<{ name: string; url: string }> = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (/^page-\d+\.json(\.gz)?$/.test(f.getName())) {
        urls.push({ name: f.getName(), url: f.getDownloadUrl() });
      }
    }
    urls.sort((a, b) => (a.name < b.name ? -1 : 1));
    return { urls, folderUrl: folder.getUrl() };
  });
}

// ------------------------------------------------------------------------- settings

export function getSettings(_p?: unknown): ApiResult {
  return run(() => ({
    fetchSeverities: settingsStore.getFetchSeverities(),
    displaySeverities: settingsStore.getDisplaySeverities(),
    retentionDays: settingsStore.getRetentionDays(),
    autoCompact: settingsStore.getAutoCompact(),
    domains: settingsStore.getDomains(),
  }));
}

export function setSeverities(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  return mutate(() => {
    if (params["fetch"]) settingsStore.setFetchSeverities(params["fetch"]);
    if (params["display"]) settingsStore.setDisplaySeverities(params["display"]);
    return {
      fetchSeverities: settingsStore.getFetchSeverities(),
      displaySeverities: settingsStore.getDisplaySeverities(),
    };
  });
}

export function setRetention(p?: unknown): ApiResult {
  const days = (p as Rec)?.["days"];
  return mutate(() => {
    settingsStore.setRetentionDays(days === null || days === undefined ? null : Number(days));
    return { retentionDays: settingsStore.getRetentionDays() };
  });
}

export function setAutoCompact(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setAutoCompact(Boolean((p as Rec)?.["on"]));
    return { autoCompact: settingsStore.getAutoCompact() };
  });
}

export function getDomains(_p?: unknown): ApiResult {
  return run(() => settingsStore.getDomains());
}

export function saveDomains(p?: unknown): ApiResult {
  const items = ((p as Rec)?.["items"] as unknown[]) ?? [];
  return mutate(() => {
    const errors = validateDomains(items);
    if (errors.length) return { saved: false, errors };
    settingsStore.setDomains(items);
    return { saved: true, errors: [], domains: settingsStore.getDomains() };
  });
}

export function previewDomains(p?: unknown): ApiResult {
  return run(() => {
    const items = ((p as Rec)?.["items"] as unknown[]) ?? [];
    const compiled = compileDomains(items);
    const scan = findings.currentScan();
    const records = scan?.records ?? [];
    const perDomain: Record<string, { count: number; samples: string[] }> = {};
    for (const d of compiled) perDomain[d.name] = { count: 0, samples: [] };
    perDomain[UNASSIGNED] = { count: 0, samples: [] };
    for (const r of records) {
      const name = assignDomain(r, compiled);
      const bucket = perDomain[name] ?? (perDomain[name] = { count: 0, samples: [] });
      bucket.count += 1;
      if (bucket.samples.length < 5) {
        const asset = String(r["vulnerableAsset.name"] ?? "");
        if (asset && !bucket.samples.includes(asset)) bucket.samples.push(asset);
      }
    }
    return { total: records.length, perDomain };
  });
}

// ---------------------------------------------------------------------------- misc

export function getStorageStats(_p?: unknown): ApiResult {
  return run(() => {
    const scans = ledgerStore.loadScanRows();
    return {
      cellCount: cellCount(),
      cellLimit: 10_000_000,
      scanCount: scans.length,
      sealedCount: scans.filter((s) => s.sealed).length,
      oldestScanTs: scans.length ? scans[0].ts : null,
      trackedVulns: ledgerStore.loadBaseRows().length,
    };
  });
}
