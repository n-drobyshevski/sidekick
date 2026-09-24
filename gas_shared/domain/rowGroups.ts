// Grouping a register's rows by one column — the findings table's "Group by".
//
// ON THE SERVER, OVER THE WHOLE FILTERED SET, NEVER OVER A PAGE. The table is server-paged, so
// grouping the fifty rows in hand would print "3 findings on web-prod-06" for an asset that
// has forty — a count that looks measured and is really an artefact of where page one ended.
// Both registers call this over the full set their `getRegisterRows` already holds, and a
// group is opened by asking for its rows with `groupValue`, paged like any other request.
//
// Pure: both apps' tests pin it without a GAS global.

type Rec = Record<string, unknown>;

/** What stands for a missing value, as a group key. Never collides with a real value. */
export const NONE_GROUP = "\u0000none";

export interface RowGroup {
  /** The key a client sends back as `groupValue` to open this group. */
  value: string;
  /** The column's own value for this group (first row's), for the client's cell renderer. */
  raw: unknown;
  count: number;
  open: number;
  /** The worst severity in the group, by `severityOrder`; null when none is known. */
  worstSeverity: string | null;
  /** The oldest open finding's age, in days; null when nothing open carries one. */
  oldestOpenDays: number | null;
}

export interface GroupOpts {
  severityOrder: readonly string[];
  isOpen: (row: Rec) => boolean;
  /** Most groups a response carries; the rest are counted in `truncated`. */
  cap?: number;
}

/** A row's group key for `column`. Missing, null and "" all land in one NONE group. */
export function groupKeyOf(row: Rec, column: string): string {
  const v = row[column];
  if (v === null || v === undefined || v === "") return NONE_GROUP;
  return String(v);
}

/** The rows of one group, for a `groupValue` request. */
export function rowsInGroup<T extends Rec>(rows: T[], column: string, value: string): T[] {
  return rows.filter((r) => groupKeyOf(r, column) === value);
}

/**
 * The groups, WORST FIRST: by worst severity, then by open count, then by size, then by key
 * — a total order, so two requests list the groups identically. A reader grouping by asset is
 * asking where to start, and the asset holding a CRITICAL is that answer even when a noisier
 * one holds more LOWs.
 */
export function groupRows(
  rows: Rec[],
  column: string,
  opts: GroupOpts,
): { groups: RowGroup[]; truncated: number } {
  const rank = (s: string | null) => {
    const i = s === null ? -1 : opts.severityOrder.indexOf(s);
    return i < 0 ? opts.severityOrder.length : i;
  };
  const byKey = new Map<string, RowGroup>();
  for (const r of rows) {
    const key = groupKeyOf(r, column);
    let g = byKey.get(key);
    if (!g) {
      g = { value: key, raw: key === NONE_GROUP ? null : r[column], count: 0, open: 0,
        worstSeverity: null, oldestOpenDays: null };
      byKey.set(key, g);
    }
    g.count += 1;
    const sev = r["severity"] === null || r["severity"] === undefined
      ? null : String(r["severity"]).toUpperCase();
    if (sev !== null && rank(sev) < rank(g.worstSeverity)) g.worstSeverity = sev;
    if (opts.isOpen(r)) {
      g.open += 1;
      const age = r["age_days"];
      if (typeof age === "number" && Number.isFinite(age)
        && (g.oldestOpenDays === null || age > g.oldestOpenDays)) {
        g.oldestOpenDays = age;
      }
    }
  }
  const groups = Array.from(byKey.values()).sort((x, y) =>
    rank(x.worstSeverity) - rank(y.worstSeverity)
    || y.open - x.open
    || y.count - x.count
    || (x.value < y.value ? -1 : x.value > y.value ? 1 : 0));
  const cap = opts.cap ?? 500;
  return { groups: groups.slice(0, cap), truncated: Math.max(0, groups.length - cap) };
}
