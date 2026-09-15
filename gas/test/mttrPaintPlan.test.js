// WHICH SECTIONS THE MTTR PAGE REPAINTS, and — the point of the file — what it does when the
// two RPCs land in the wrong order.
//
// `getMttrPage` used to return the summary as well as the trends, byte-identical to what
// `api_getMttr` returns alone. Dropping it saves 9,372 bytes and a duplicated cold compute,
// and buys one hazard in exchange: a paint driven by the page's arrival can now run with no
// summary in hand. It genuinely happens — a warm page entry with a cold summary, or an SWR
// revisit resolving the cached page instantly while the summary refetches.
//
// The failure that would ship is not subtle once seen: the page paints charts against a
// missing summary and throws, or renders a hero with no value. The guard is that `mttr` must
// be present before anything draws. These specs enumerate the orderings, because a DOM test
// would exercise whichever interleaving the harness happened to produce and call it proof.
//
// Plain .js for the reason navGroups.test.js writes out.

import { describe, expect, it } from "vitest";

import { mttrPaintPlan } from "../src/client/js/pages/mttrPaintPlan.js";

const MTTR = { rowCount: 99, remediation: { km: { median: null } } };
const PAGE = { trends: { history: [], trend: [] }, byDomain: { dimension: "domain", rows: [] } };
const plan = (over) => mttrPaintPlan({
  mttr: null, page: null, pagePainted: false, summaryChanged: false, pageChanged: false,
  scoped: false, ...over,
});
const drawn = (p) => Object.entries(p).filter(([k, v]) => v && k !== "historyChips")
  .map(([k]) => k).sort();

describe("the invariant: nothing draws without a summary", () => {
  it("plans nothing when neither payload has arrived", () => {
    expect(drawn(plan({}))).toEqual([]);
  });

  // The hazard this change introduces. Before, the page payload carried its own summary and
  // could paint alone; now it must wait.
  it("plans nothing when the page arrives first", () => {
    expect(drawn(plan({ page: PAGE, pageChanged: true }))).toEqual([]);
  });

  it("draws everything on the tick the summary finally lands", () => {
    expect(drawn(plan({ mttr: MTTR, page: PAGE, summaryChanged: true })))
      .toEqual(["aging", "byDomain", "charts", "fan", "hero", "sla", "survival"]);
  });
});

describe("summary first, page second — the common cold path", () => {
  it("draws the summary sections and holds the page ones", () => {
    expect(drawn(plan({ mttr: MTTR, summaryChanged: true })))
      .toEqual(["aging", "fan", "hero", "sla", "survival"]);
  });

  it("draws the page sections when it arrives, unscoped hero included", () => {
    expect(drawn(plan({ mttr: MTTR, page: PAGE, pageChanged: true })))
      .toEqual(["byDomain", "charts", "hero"]);
  });
});

describe("independent revalidation — each section reads its own newest input", () => {
  // The reason the page handler must not await the summary promise: swrCall re-fires per RPC,
  // and an await would pin the charts to the first summary forever.
  it("a summary revalidation alone leaves the charts alone", () => {
    expect(drawn(plan({
      mttr: MTTR, page: PAGE, pagePainted: true, summaryChanged: true,
    }))).toEqual(["aging", "fan", "hero", "sla", "survival"]);
  });

  it("a page revalidation alone leaves survival and SLA alone", () => {
    expect(drawn(plan({
      mttr: MTTR, page: PAGE, pagePainted: true, pageChanged: true,
    }))).toEqual(["byDomain", "charts", "hero"]);
  });

  it("plans nothing for a tick that delivered neither", () => {
    expect(drawn(plan({ mttr: MTTR, page: PAGE, pagePainted: true }))).toEqual([]);
  });
});

describe("survival, the fan, SLA and the age bars follow the summary only", () => {
  // They are pure functions of the summary, so the old paintFull's call was a Chart.js
  // destroy-and-rebuild of an identical curve on every load.
  //
  // THE CLAIM THESE FOUR ASSERTIONS ENCODE MOVED, so it is restated rather than extended by
  // habit. It used to be "the two sections `api_getMttr` fills"; it is now "every section
  // `api_getMttr` fills", and the per-severity fan and the open-backlog age bars joined
  // because `remediation.kmPerSev` and `remediation.aging` ship on the SUMMARY payload —
  // neither reads a reconstructed trend point. Driving them off `pageChanged` would be six
  // Chart.js destroy-and-rebuilds of identical curves plus a bar chart, for no changed figure,
  // on every page-payload revalidation.
  it("never repaint on a page arrival", () => {
    const p = plan({ mttr: MTTR, page: PAGE, pageChanged: true });
    expect(p.survival).toBe(false);
    expect(p.fan).toBe(false);
    expect(p.sla).toBe(false);
    expect(p.aging).toBe(false);
  });

  // The other half of the same claim: with no summary in hand there is nothing truthful to
  // draw in either of the two new sections, whatever else has arrived.
  it("draw nothing at all before a summary exists", () => {
    const p = plan({ page: PAGE, pageChanged: true });
    expect(p.fan).toBe(false);
    expect(p.aging).toBe(false);
  });
});

describe("the history chips decide whether a page arrival touches the hero", () => {
  it("are on unscoped once the page has landed", () => {
    expect(plan({ mttr: MTTR, page: PAGE, pageChanged: true }).historyChips).toBe(true);
  });

  it("are off before the page lands, so the hero draws without them", () => {
    expect(plan({ mttr: MTTR, summaryChanged: true }).historyChips).toBe(false);
  });

  // THE CLAIM THIS `it` USED TO ENCODE, AND THE MEASUREMENT THAT FALSIFIED IT.
  //
  // It read "are off under a scope, and the page arrival then skips the hero", and asserted
  // `p.hero === false`. The reasoning behind it was sound when written: the page payload's only
  // contribution to the hero was `trends.history`, which feeds the change chips, and those are
  // suppressed under a scope because the mttr_history snapshots are register-wide while the
  // shown values are scoped.
  //
  // The hero now draws a SECOND thing off that payload — `trends.trend`, the reconstructed
  // half-life series behind the header's sparkline — and that series is scoped already
  // (api.ts's `mttrTrendData` hands `loadTrend` the pre-filtered base rows). So the premise
  // "under a scope a page arrival adds nothing to the hero" is simply no longer true.
  //
  // MEASURED, dev harness, 2026-09-07: its seed ships `displaySeverities: [CRITICAL, HIGH]`
  // against five selectable severities, so `chipsSuppressed()` is true on a PLAIN visit.
  // `api_getMttrPage` returned 211 trend points, one carrying a `km_median_days` — and the
  // header's aside rendered "not measured", the register's own words for "nobody looked", over
  // a series that had been computed, scoped and shipped. The chips half of the claim is
  // unchanged and still asserted; only the hero half moved.
  it("stay off under a scope, while the page arrival still repaints the hero for its trend", () => {
    const p = plan({ mttr: MTTR, page: PAGE, pageChanged: true, scoped: true });
    expect(p.historyChips).toBe(false);
    expect(p.hero).toBe(true);
    expect(drawn(p)).toEqual(["byDomain", "charts", "hero"]);
  });

  // The other side of the same line: a tick that delivered no page payload adds nothing, and a
  // page that has not arrived at all cannot repaint anything.
  it("do not repaint the hero on a tick that delivered no page payload", () => {
    expect(plan({ mttr: MTTR, page: PAGE, pagePainted: true, scoped: true }).hero).toBe(false);
    expect(plan({ mttr: MTTR, pageChanged: true, scoped: true }).hero).toBe(false);
  });

  it("still let a scoped summary change repaint the hero", () => {
    expect(plan({ mttr: MTTR, page: PAGE, summaryChanged: true, scoped: true }).hero).toBe(true);
  });
});
