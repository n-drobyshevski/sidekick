// Pure data-transform helpers — the port of wiz_dashboard/data/transform.py.
// The SDK-wrapper branches of coerce_results are gone (UrlFetchApp returns plain JSON);
// what remains is envelope/nodes extraction, delta merging, and flattening (the
// json_normalize equivalent used to build table records with dotted keys).

import { vulnKey } from "./lifecycle";
import { pushAll, type Rec } from "./util";

export function coerceResults(results: unknown): unknown {
  if (results === null || results === undefined) return results;
  if (typeof results === "object") return results;
  if (typeof results === "string") {
    const s = results.trim();
    try {
      return JSON.parse(s);
    } catch {
      return results;
    }
  }
  return results;
}

/** Extract the findings node list from any of the accepted response envelopes. */
export function extractNodes(results: unknown): Rec[] {
  const coerced = coerceResults(results);
  if (!coerced) return [];
  if (Array.isArray(coerced) && coerced.length && typeof coerced[0] === "object") {
    // A list of page envelopes: merge every page's nodes.
    const merged: Rec[] = [];
    let ok = false;
    for (const page of coerced) {
      if (page && typeof page === "object" && !Array.isArray(page)) {
        const sub = extractNodes(page);
        if (sub.length) {
          pushAll(merged, sub); // not merged.push(...sub): a page can be findings-scale
          ok = true;
        }
      }
    }
    if (ok) return merged;
  }
  if (coerced && typeof coerced === "object" && !Array.isArray(coerced)) {
    const obj = coerced as Rec;
    const data = obj["data"];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const d = data as Rec;
      const vf = d["vulnerabilityFindings"];
      if (vf && typeof vf === "object" && !Array.isArray(vf) && "nodes" in (vf as Rec)) {
        return ((vf as Rec)["nodes"] as Rec[]) ?? [];
      }
      for (const v of Object.values(d)) {
        if (v && typeof v === "object" && !Array.isArray(v) && "nodes" in (v as Rec)) {
          return ((v as Rec)["nodes"] as Rec[]) ?? [];
        }
      }
    }
    if ("nodes" in obj) return (obj["nodes"] as Rec[]) ?? [];
  }
  if (Array.isArray(coerced)) return coerced as Rec[];
  return [coerced as Rec];
}

/**
 * Merge an incremental delta into a full baseline node set -> new full node set.
 * Keyed by vulnKey: a delta node replaces its baseline counterpart in place (order
 * preserved), new delta nodes append in delta order, intra-delta duplicates keep the
 * LAST occurrence. Neither input is mutated; node objects are shared by reference.
 */
export function mergeNodes(baselineNodes: Rec[] | null, deltaNodes: Rec[] | null): Rec[] {
  const byKey = new Map<string, Rec>();
  for (const node of deltaNodes ?? []) byKey.set(vulnKey(node), node); // later wins
  const merged: Rec[] = [];
  for (const node of baselineNodes ?? []) {
    const key = vulnKey(node);
    if (byKey.has(key)) {
      merged.push(byKey.get(key)!);
      byKey.delete(key);
    } else {
      merged.push(node);
    }
  }
  pushAll(merged, byKey.values()); // remaining delta nodes (Map preserves insertion order)
  return merged;
}

/**
 * Flatten one raw node into a dotted-key record — the pd.json_normalize(sep=".")
 * equivalent. Nested plain objects recurse into "a.b.c" keys; arrays and scalars are
 * kept verbatim at their (dotted) position.
 */
export function flattenNode(node: Rec, prefix = ""): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenNode(v as Rec, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Flatten a node list into table records (nodes_to_dataframe minus the DataFrame). */
export function nodesToRecords(nodes: unknown): Rec[] {
  if (!nodes) return [];
  const list = Array.isArray(nodes) ? nodes : [nodes];
  const cleaned: Rec[] = [];
  for (const item of list) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      cleaned.push(item as Rec);
    } else if (typeof item === "string") {
      try {
        const p = JSON.parse(item);
        cleaned.push(p && typeof p === "object" && !Array.isArray(p) ? p : { _raw: item });
      } catch {
        cleaned.push({ _raw: item });
      }
    } else {
      cleaned.push({ _raw: String(item) });
    }
  }
  return cleaned.map((r) => flattenNode(r));
}
