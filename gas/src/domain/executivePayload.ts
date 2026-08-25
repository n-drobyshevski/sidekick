// What the Executive landing page is actually sent.
//
// The page composes read-models built for the MTTR page, and that sharing is deliberate — both
// slices come from the same `cached()` entries, so exec→MTTR navigation at one scope lands warm
// and neither page pays a second compute. What was NOT deliberate is that exec also shipped
// those read-models whole: two thirds of the payload on the default landing page was serialized
// and sent on every load without anything reading it.
//
// The bulk is Kaplan–Meier curves. `KMResult.curve` carries one point per DISTINCT EVENT TIME,
// and `mttrData` builds two of them (`km` and the actionable-clock `kmActionable`), while the
// hero reads exactly two scalars off the first — `median` and `medianLowerBound`. That is a
// scaling problem, not a fixed cost: the curve grows with the number of distinct resolution
// times, so a register with thousands of closed lifecycles ships a far larger one than a small
// estate suggests. The trend series beneath the per-group split has the same character.
//
// PROJECTING RATHER THAN COMPUTING SOMETHING LEANER is the point. A separate slim read-model
// would have cut the compute too, but it would have cost the shared cache entry — exec and MTTR
// would each compute their own, and the warm hand-off between them would be gone. Projecting a
// cached result keeps every entry, and every sharing property, exactly as it was. What this
// saves is serialization and transfer, which is paid on EVERY load, warm or cold; the compute
// is paid once per scope and is already warmed for the unscoped view.
//
// Pure and separate from api.ts so the shape is pinned in node without standing up the server
// module graph — the same split pages/executive.js uses for its view functions.

import type { Rec } from "./util";

/**
 * The four numbers the hero paints, keeping `mttrData`'s nesting so the client reads them at
 * the paths it always has (`mttr.rowCount`, `mttr.overall.open`, `mttr.remediation.km.median`).
 *
 * `remediation` is left EMPTY rather than dropped when there is no KM result, because
 * `fmtKmMedian` distinguishes a missing estimate (renders "—") from a present one, and an
 * absent `remediation` and an absent `remediation.km` have to reach it the same way.
 */
export function execMttrSlice(mttr: unknown): Rec | null {
  if (!mttr || typeof mttr !== "object") return null;
  const m = mttr as Rec;
  const overall = (m["overall"] ?? {}) as Rec;
  const km = ((m["remediation"] ?? {}) as Rec)["km"] as Rec | undefined;
  return {
    rowCount: m["rowCount"],
    overall: { resolved: overall["resolved"], open: overall["open"] },
    remediation: km
      ? { km: { median: km["median"], medianLowerBound: km["medianLowerBound"] } }
      : {},
  };
}

/**
 * The per-group split reduced to the three columns the table draws, plus the `dimension` tag the
 * client relabels from. `trend` is dropped whole — the exec table has no chart under it.
 *
 * ONLY `group` SURVIVES, not the `domain` alias beside it. `mttrByDomainData` writes both
 * (`api.ts`: "Keep `domain` alongside the generic `group` label"), but the by-support-group
 * split writes only `group`, which is why every reader already goes through `group ?? domain`.
 * Shipping both would send each group's name twice for one of the two dimensions.
 *
 * ROWS ARE NOT CAPPED HERE, though the page draws five. How many rows are worth showing is a
 * presentation decision, and it already lives in `executiveByDomainView` where it is tested;
 * capping server-side too would put the same number in two places, free to drift. The cost is
 * bounded by the number of groups in the register rather than by the estate's size — a wide
 * register pays a few hundred bytes for rows it will not draw, which is the trade being made.
 */
export function execGroupSlice(byGroup: unknown): Rec | null {
  if (!byGroup || typeof byGroup !== "object") return null;
  const b = byGroup as Rec;
  const rows = Array.isArray(b["rows"]) ? (b["rows"] as Rec[]) : [];
  return {
    dimension: b["dimension"],
    rows: rows.map((r) => ({
      group: r["group"] ?? r["domain"],
      kmMedian: r["kmMedian"],
      open: r["open"],
    })),
  };
}
