// Pure construction of the precomputed findings frame (see archiveStore.writeFrame):
// slim records flattened to dotted keys with _vuln_key (sha1) and, when the page
// mapping is known, _page (the raw archive page holding the full node). Building the
// frame inside the scan job moves currentScan()'s per-request flatten + hash pass to
// once per scan. GAS-global-free so vitest can pin frame records to the slim path.

import { vulnKey } from "../domain/lifecycle";
import { flattenNode } from "../domain/transform";
import type { Rec } from "../domain/util";

/** Flattened records with _vuln_key and (when the mapping is known) _page attached. */
export function buildFrame(records: Rec[], pageOf: ((i: number) => number) | null): Rec[] {
  return records.map((n, i) => {
    const flat = flattenNode(n);
    flat["_vuln_key"] = vulnKey(n);
    if (pageOf) flat["_page"] = pageOf(i);
    return flat;
  });
}

/** Index→page from the fetch-order page runs, or null when they don't cover records. */
export function pageOfFromRuns(
  runs: Array<[number, number]> | null,
  total: number,
): ((i: number) => number) | null {
  if (!runs) return null;
  const pages: number[] = [];
  for (const [page, count] of runs) {
    for (let k = 0; k < count; k++) pages.push(page);
  }
  if (pages.length !== total) return null; // spill out of step with the records — no tags
  return (i) => pages[i];
}
