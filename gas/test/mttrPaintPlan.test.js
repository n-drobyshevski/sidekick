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
      .toEqual(["byDomain", "charts", "hero", "sla", "survival"]);
  });
});

describe("summary first, page second — the common cold path", () => {
  it("draws the summary sections and holds the page ones", () => {
    expect(drawn(plan({ mttr: MTTR, summaryChanged: true })))
      .toEqual(["hero", "sla", "survival"]);
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
    }))).toEqual(["hero", "sla", "survival"]);
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

describe("survival and SLA follow the summary only", () => {
  // They are pure functions of the summary, so the old paintFull's call was a Chart.js
  // destroy-and-rebuild of an identical curve on every load.
  it("never repaint on a page arrival", () => {
    const p = plan({ mttr: MTTR, page: PAGE, pageChanged: true });
    expect(p.survival).toBe(false);
    expect(p.sla).toBe(false);
  });
});

describe("the history chips decide whether a page arrival touches the hero", () => {
  it("are on unscoped once the page has landed", () => {
    expect(plan({ mttr: MTTR, page: PAGE, pageChanged: true }).historyChips).toBe(true);
  });

  it("are off before the page lands, so the hero draws without them", () => {
    expect(plan({ mttr: MTTR, summaryChanged: true }).historyChips).toBe(false);
  });

  // Scoped, mttr_history is register-wide while the values are scoped — the chips are
  // suppressed, so a page arrival adds nothing to the hero and must not repaint it.
  it("are off under a scope, and the page arrival then skips the hero", () => {
    const p = plan({ mttr: MTTR, page: PAGE, pageChanged: true, scoped: true });
    expect(p.historyChips).toBe(false);
    expect(p.hero).toBe(false);
    expect(drawn(p)).toEqual(["byDomain", "charts"]);
  });

  it("still let a scoped summary change repaint the hero", () => {
    expect(plan({ mttr: MTTR, page: PAGE, summaryChanged: true, scoped: true }).hero).toBe(true);
  });
});
