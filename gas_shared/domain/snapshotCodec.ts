// The ledger snapshot's on-disk shape: columns and a string dictionary instead of one object per
// row. SHARED by gas/ and gas_devsecops/ (moved here from gas/src/domain with the devsecops port,
// PERF_PLAN.md step 2c), so the two registers cannot drift apart on an on-disk format.
//
// WHY. The snapshot is the fast-read copy of the whole ledger, and every cold execution parses
// it — measured in production at 4.06 MB gzipped and 2–4.5 s to ungzip and parse in gas/, and
// 1.96 MB and 2.4–2.8 s in gas_devsecops/, the largest single cost left on a cold page. Almost all of that text is repetition: every one of ~58k rows
// spells out the same ~25 key names, and the long strings repeat across rows too — a resource's
// whole tag bag (`tags_json`) is copied onto every finding on that resource, and asset names,
// subscriptions, scan ids and scan timestamps recur the same way. Parsing is paid per character,
// so the fix is to stop writing the same characters twice.
//
// THE ENCODING, per table ({ cols, rows }):
//   - `cols` names each column once; a row is an array in that order.
//   - A column is DICTIONARY-ENCODED when its non-null values are all strings and mostly repeat.
//     Its cells then hold an index into the snapshot-wide `strings` table. A non-string that
//     turns up in such a column is stored wrapped as `[value]`, so a cell is always one of
//     index | null | [raw] and the decode is unambiguous.
//   - Any other column holds its values as they are.
//   - A key absent from a row (as opposed to present and null) is listed in `absent` as
//     [row, col], so the decode reproduces the object exactly rather than inventing a null. A
//     key whose value is `undefined` counts as absent — which is what the v1 snapshot did too,
//     since JSON.stringify drops such keys.
//
// EXACTNESS IS THE CONTRACT: `decodeRows(encodeRows(x))` deep-equals what a JSON round trip of
// `x` gives — same keys, same values. Key ORDER follows the columns (first appearance across
// rows), which for the ledger's uniform rows is each row's own order. gas/test/snapshotCodec.test.ts
// holds that on random and adversarial rows; gas_devsecops/test/snapshotCodec.test.ts adds the
// key-field case.
//
// THE LEDGER'S KEY FIELD differs by register: gas/ keys its ledger map by `vuln_key`,
// gas_devsecops/ by `finding_key`. The encoder is told which, and records it in the file when it
// is not the default — so a decode never has to be told, and a gas/ file written before the field
// existed (no `keyField`) still decodes as `vuln_key`.

type Row = Record<string, unknown>;

export interface EncodedTable {
  cols: string[];
  /** Indices of the dictionary-encoded columns. */
  dict: number[];
  rows: unknown[][];
  /** [rowIndex, colIndex] of each key absent from its row. */
  absent: [number, number][];
}

/** A column is worth a dictionary when at most this share of its strings are distinct. */
const DICT_MAX_DISTINCT_SHARE = 0.5;

/** Encode rows against a shared, growing string table (`strings` / `index` are appended to). */
export function encodeRows(
  rows: Row[],
  strings: string[],
  index: Map<string, number>,
): EncodedTable {
  // Column order: first appearance across rows, so a table of uniform rows keeps its key order.
  const cols: string[] = [];
  const colOf = new Map<string, number>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!colOf.has(k)) {
        colOf.set(k, cols.length);
        cols.push(k);
      }
    }
  }

  // Decide per column: all non-null values strings, and mostly repeated.
  const dict: number[] = [];
  for (let c = 0; c < cols.length; c++) {
    const name = cols[c]!;
    const seen = new Set<string>();
    let strs = 0;
    let onlyStrings = true;
    for (const r of rows) {
      const v = r[name];
      if (v === null || v === undefined) continue;
      if (typeof v !== "string") {
        onlyStrings = false;
        break;
      }
      strs += 1;
      seen.add(v);
    }
    if (onlyStrings && strs > 0 && seen.size <= strs * DICT_MAX_DISTINCT_SHARE) dict.push(c);
  }
  const isDict = new Array<boolean>(cols.length).fill(false);
  for (const c of dict) isDict[c] = true;

  const out: unknown[][] = [];
  const absent: [number, number][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const cells = new Array<unknown>(cols.length);
    for (let c = 0; c < cols.length; c++) {
      const name = cols[c]!;
      const v = r[name];
      if (v === undefined || !Object.prototype.hasOwnProperty.call(r, name)) {
        absent.push([i, c]);
        cells[c] = null;
        continue;
      }
      if (!isDict[c] || v === null) {
        cells[c] = v;
        continue;
      }
      if (typeof v === "string") {
        let at = index.get(v);
        if (at === undefined) {
          at = strings.length;
          strings.push(v);
          index.set(v, at);
        }
        cells[c] = at;
      } else {
        cells[c] = [v];
      }
    }
    out.push(cells);
  }
  return { cols, dict, rows: out, absent };
}

/** The exact inverse of `encodeRows`. */
export function decodeRows(t: EncodedTable, strings: string[]): Row[] {
  const n = t.cols.length;
  const isDict = new Array<boolean>(n).fill(false);
  for (const c of t.dict) isDict[c] = true;
  // Absent cells, looked up per row; almost always empty.
  const absentByRow = new Map<number, Set<number>>();
  for (const [i, c] of t.absent) {
    let s = absentByRow.get(i);
    if (!s) absentByRow.set(i, (s = new Set()));
    s.add(c);
  }
  const out: Row[] = new Array(t.rows.length);
  for (let i = 0; i < t.rows.length; i++) {
    const cells = t.rows[i]!;
    const skip = absentByRow.get(i);
    const r: Row = {};
    for (let c = 0; c < n; c++) {
      if (skip && skip.has(c)) continue;
      const v = cells[c];
      if (isDict[c] && v !== null) {
        r[t.cols[c]!] = typeof v === "number" ? strings[v] : (v as unknown[])[0];
      } else {
        r[t.cols[c]!] = v;
      }
    }
    out[i] = r;
  }
  return out;
}

// ------------------------------------------------------------------- the whole snapshot

export const SNAPSHOT_V2 = 2;

// THE FIELD NAMES DIFFER FROM V1 ON PURPOSE. A v1 reader accepts anything with `ledger` and
// `episodes`; if v2 reused those names, rolling a deployment back past this change would hand
// the old code an encoded table as if it were the ledger map. Under these names an old reader
// finds neither field, reports "no snapshot", and falls back to reading the tabs — slower, and
// correct.
export interface SnapshotV2 {
  version: 2;
  strings: string[];
  ledgerTable: EncodedTable;
  /** The row field the ledger map is keyed by; absent means `vuln_key` (see the header). */
  keyField?: string;
  /** Present only when some ledger key differs from its row's key field. */
  ledgerKeys?: string[];
  episodeTable: EncodedTable;
}

const DEFAULT_KEY_FIELD = "vuln_key";

/** The ledger map and episode list as a v2 snapshot. One string table serves both. */
export function encodeSnapshot(
  ledger: Record<string, Row>,
  episodes: Row[],
  keyField: string = DEFAULT_KEY_FIELD,
): SnapshotV2 {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const keys = Object.keys(ledger);
  const rows = keys.map((k) => ledger[k]!);
  const snap: SnapshotV2 = {
    version: 2,
    strings,
    ledgerTable: encodeRows(rows, strings, index),
    episodeTable: encodeRows(episodes, strings, index),
  };
  if (keyField !== DEFAULT_KEY_FIELD) snap.keyField = keyField;
  if (keys.some((k, i) => rows[i]![keyField] !== k)) snap.ledgerKeys = keys;
  return snap;
}

/** Decode a v2 snapshot, or null when the value is not one. */
export function decodeSnapshot(v: unknown): { ledger: Record<string, Row>; episodes: Row[] } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Partial<SnapshotV2>;
  if (s.version !== SNAPSHOT_V2 || !Array.isArray(s.strings) || !s.ledgerTable || !s.episodeTable) {
    return null;
  }
  const keyField = typeof s.keyField === "string" ? s.keyField : DEFAULT_KEY_FIELD;
  const rows = decodeRows(s.ledgerTable, s.strings);
  const ledger: Record<string, Row> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    ledger[s.ledgerKeys ? s.ledgerKeys[i]! : String(row[keyField])] = row;
  }
  return { ledger, episodes: decodeRows(s.episodeTable, s.strings) };
}
