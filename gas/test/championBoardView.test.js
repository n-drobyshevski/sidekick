// The champion board's view model (src/client/js/pages/_championBoard.js): how a card, the
// off-board line, the progress lists and the digest SAY what the server placed. DOM-free, so
// the cases worth pinning — an empty off-board, a vendor card spanning owners, a lower-bound
// MTTR in the digest — run in node.

import { describe, expect, it } from "vitest";

import {
  COLUMN_META, cardView, digestMarkdown, dueText, offBoardLine, progressLists,
} from "../src/client/js/pages/_championBoard.js";

const card = (over) => ({
  cve: "CVE-2024-6387", owner: "CS-core-batch", owners: ["CS-core-batch"], tier: 2,
  severity: "HIGH", count: 4, assets: 4, lateDays: 30, dueInDays: null, rows: [], rowsTotal: 4, ...over,
});

describe("cardView", () => {
  it("says a late tiered card's tier in words beside its mark, and how late it is", () => {
    const v = cardView(card(), "late");
    expect(v.mark).toEqual({ tier: 2 });
    expect(v.markWord).toBe("Exploitable and late");
    expect(v.clock).toBe("30 days late");
    expect(v.clockTone).toBe("bad");
    expect(v.where).toBe("4 hosts");
  });

  it("falls back to severity for an untiered card, so the mark is the severity badge", () => {
    const v = cardView(card({ tier: null, severity: "MEDIUM" }), "late");
    expect(v.mark).toEqual({ severity: "MEDIUM" });
    expect(v.markWord).toBeNull();
  });

  it("words the deadline, and only calls two days or fewer urgent", () => {
    expect(cardView(card({ tier: null, dueInDays: 0 }), "due7").clock).toBe("due today");
    expect(cardView(card({ tier: null, dueInDays: 1 }), "due7").clockTone).toBe("bad");
    expect(cardView(card({ tier: null, dueInDays: 5 }), "due7").clockTone).toBe("neutral");
    expect(dueText(12)).toBe("due in 12 days");
  });

  it("lists every owner on a vendor card, which groups across teams", () => {
    const v = cardView(card({ owner: null, owners: ["SG-A", "SG-B"], tier: null }), "vendor");
    expect(v.owner).toBe("SG-A, SG-B");
    expect(v.mark).toEqual({ vendor: true });
    expect(v.clock).toBe("no fix yet");
  });

  it("names a missing CVE and a missing owner rather than printing blanks", () => {
    const v = cardView(card({ cve: null, owner: null }), "late");
    expect(v.title).toBe("No CVE recorded");
    expect(v.owner).toBe("No owner attributed");
  });

  it("says when the sheet shows only part of the card", () => {
    expect(cardView(card({ rows: [{}, {}], rowsTotal: 30 }), "late").more).toBe("Showing 2 of 30 findings.");
    expect(cardView(card({ rows: [{}], rowsTotal: 1 }), "late").more).toBeNull();
  });
});

describe("offBoardLine", () => {
  it("is null when nothing was left off, never a sentence about zero", () => {
    expect(offBoardLine({ insideSlaLater: 0, unobserved: 0, noClock: 0 })).toBeNull();
    expect(offBoardLine(undefined)).toBeNull();
  });

  it("names each reason a finding is not on the board", () => {
    expect(offBoardLine({ insideSlaLater: 12, unobserved: 3, noClock: 0 }))
      .toBe("15 open findings are not on the board: 12 inside SLA with more than 14 days left · 3 not seen in the latest scan.");
  });
});

describe("progressLists", () => {
  it("words when a fix landed and flags a finding that keeps coming back", () => {
    const l = progressLists({
      fixedGroups: [{ cve: "CVE-1", count: 2, assets: 1, lastDays: 1 }],
      regressions: [{ cve: "CVE-2", times: 2, count: 1, assets: ["web-02"] }, { cve: "CVE-3", times: 1, count: 1, assets: [] }],
    });
    expect(l.fixed[0]).toEqual({ name: "CVE-1", detail: "2 findings on 1 host", when: "yesterday" });
    expect(l.regressions.map((r) => [r.when, r.repeat])).toEqual([["back 2×", true], ["back once", false]]);
  });
});

describe("digestMarkdown", () => {
  it("is the board in text: column counts, the urgent cards, progress and the one benchmark", () => {
    const data = {
      columns: Object.keys(COLUMN_META).map((id) => ({
        id, findings: id === "late" ? 4 : 0, cards: id === "late" ? [card()] : [],
      })),
      progress: { fixedWeek: 7, fixed30: 12, reopened: 2 },
    };
    const md = digestMarkdown({ data, team: "Payments", mttr: "at least 23 days", orgMttr: "31 days", asOf: "2026-10-06" });
    expect(md).toContain("**Payments: OS vulnerabilities, as of 2026-10-06**");
    expect(md).toContain("Act now 0 · Past SLA 4 · Due in 7 days 0");
    expect(md).toContain("- CVE-2024-6387 · CS-core-batch · 4 hosts · 30 days late");
    expect(md).toContain("- Fixed this week: 7 (confirmed by Wiz); 12 in the last 30 days");
    expect(md).toContain("- MTTR: at least 23 days (whole register: 31 days)");
    // An empty column contributes its count to the header line and no section of its own.
    expect(md).not.toContain("**Act now**");
  });
});
