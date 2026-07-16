// Persistent MTTR history on the `mttr_history` tab — one snapshot per UTC day,
// latest wins (the port of wiz_dashboard/data/history.py).

import { mergeMttrHistory } from "../domain/importMerge";
import type { Rec } from "../domain/util";
import { bumpDataVersion } from "./serverCache";
import { readAll, overwrite, TABS } from "./sheetsDb";

function todayIso(now?: number): string {
  return new Date(now ?? Date.now()).toISOString().slice(0, 10);
}

export interface HistoryPoint {
  date: string;
  median_days: number;
  resolved: number;
  open: number;
  total: number;
  sla_pct: number | null;
  oldest_open_days: number | null;
  open_past_sla: number | null;
}

/** Upsert today's MTTR snapshot. Never throws — a history problem must not fail a scan. */
export function recordSnapshot(
  medianDays: number,
  resolved = 0,
  open = 0,
  counts: Record<string, number> | null = null,
  when: string | null = null,
  slaPct: number | null = null,
  oldestOpenDays: number | null = null,
  openPastSla: number | null = null,
): boolean {
  try {
    const date = when ?? todayIso();
    const records = loadHistory().filter((r) => r.date !== date);
    records.push({
      date,
      median_days: Math.round(medianDays * 1000) / 1000,
      resolved: Math.trunc(resolved),
      open: Math.trunc(open),
      total: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0,
      sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
      oldest_open_days: oldestOpenDays !== null ? Math.round(oldestOpenDays * 1000) / 1000 : null,
      open_past_sla: openPastSla === null ? null : Math.trunc(openPastSla),
    });
    records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    overwrite(TABS.mttrHistory, records as unknown as Rec[]);
    bumpDataVersion();
    return true;
  } catch (e) {
    console.warn(`Failed to write MTTR history: ${e}`);
    return false;
  }
}

/**
 * Merge imported (migration-bundle) history rows into the tab: existing rows win on
 * date collisions, imported rows fill missing dates. Deliberately NOT recordSnapshot —
 * an import must never mint a today-dated point.
 */
export function importHistory(imported: Rec[]): { added: number; skipped: number } {
  const { rows, added, skipped } = mergeMttrHistory(
    loadHistory() as unknown as Rec[],
    imported,
  );
  if (added) {
    overwrite(TABS.mttrHistory, rows);
    bumpDataVersion();
  }
  return { added, skipped };
}

/** History rows sorted by date (invalid dates dropped). */
export function loadHistory(): HistoryPoint[] {
  const rows = readAll(TABS.mttrHistory);
  const out: HistoryPoint[] = [];
  for (const r of rows) {
    const date = r["date"];
    if (typeof date !== "string" || Number.isNaN(Date.parse(date))) continue;
    out.push({
      date: date.slice(0, 10),
      median_days: Number(r["median_days"] ?? 0),
      resolved: Number(r["resolved"] ?? 0),
      open: Number(r["open"] ?? 0),
      total: Number(r["total"] ?? 0),
      sla_pct: r["sla_pct"] === null ? null : Number(r["sla_pct"]),
      oldest_open_days: r["oldest_open_days"] === null ? null : Number(r["oldest_open_days"]),
      // Pre-column rows have no cell here (empty → null, or header absent → undefined);
      // both map to null so the chart draws a gap, never a fabricated zero.
      open_past_sla: r["open_past_sla"] == null ? null : Number(r["open_past_sla"]),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
