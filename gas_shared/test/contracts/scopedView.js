// The scoped viewer's shared model (ui/scopedViewModel.js): the header's scope label, the
// summary tiles, and the roster editor's validation — which has to refuse for the SAME reasons
// the server does, or the Save button lies.
//
// `dims` is the pair this register assigns (gas: d + g; gas_devsecops: d + p), so each app
// proves its own dimensions round-trip through the editor's payload.

import {
  groupLine, mttrHeroView, secondaryStats, sevMttrRows,
  draftProblems, foreignDomain, rosterChanged, rosterPayload, rowChips, rowReach, scopeLabel,
  scopeSentence, summaryTiles, SCOPE_DIM_LABELS,
} from "../../ui/scopedViewModel.js";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string[]} ctx.dims  this register's dimension keys
 */
export function registerScopedViewContract({ describe, it, expect, dims }) {
  const [a, b] = dims.map((k) => SCOPE_DIM_LABELS[k].field);

  describe("scoped view — the header's scope label", () => {
    it("names the scope and never reads an empty one as everything", () => {
      expect(scopeLabel({ [a]: ["Payments"] })).toBe("Payments");
      expect(scopeLabel({ [a]: ["Payments"], [b]: ["X"] })).toBe("Payments + X");
      expect(scopeLabel({ [a]: ["A", "B", "C", "D"] })).toBe("A + B + 2 more");
      expect(scopeLabel({})).toBe("No scope");
      expect(scopeSentence({})).toBe("No scope assigned.");
      expect(scopeSentence({ [a]: ["Payments"] })).toMatch(/Payments/);
    });
  });

  describe("scoped view — summary tiles", () => {
    it("keeps an unobservable median absent, and says so via the lower bound", () => {
      const tiles = summaryTiles({ open: 3, resolved: 1, mttr: { median: null, medianLowerBound: 40, p90: null },
        sla: {}, awaiting: {} });
      const mttr = tiles.find((t) => t.key === "mttr");
      expect(mttr.value).toMatch(/^≥ 40/);
      expect(mttr.sub).toMatch(/not observable/);
      const none = summaryTiles({}).find((t) => t.key === "mttr");
      expect(none.value).toBe(null);
    });
  });

  describe("scoped view — the roster editor refuses what the server refuses", () => {
    const row = (email, scope) => ({ email, scope });

    it("flags an empty scope, a non-address, a duplicate and a privileged address", () => {
      const problems = draftProblems([
        row("x@example.com", { [a]: [] }),
        row("nope", { [a]: ["P"] }),
        row("d@example.com", { [a]: ["P"] }),
        row("D@example.com", { [b]: ["Q"] }),
        row("owner@example.com", { [a]: ["P"] }),
      ], { owner: "owner@example.com", admins: [] });
      expect(problems.join("|")).toMatch(/x@example.com/);
      expect(problems.join("|")).toMatch(/nope/);
      expect(problems.join("|")).toMatch(/listed twice/);
      expect(problems.join("|")).toMatch(/owner/);
      expect(draftProblems([row("ok@example.com", { [b]: ["Q"] })])).toEqual([]);
    });

    it("keeps a value the catalogue no longer carries, marked stale", () => {
      const catalogue = { dims: [{ key: dims[0], label: "L", options: [{ value: "Live", count: 5 }] }] };
      const chips = rowChips(row("x@e.com", { [a]: ["Live", "Gone"] }), catalogue);
      expect(chips.map((c) => [c.value, c.stale])).toEqual([["Live", false], ["Gone", true]]);
      expect(rowReach(row("x@e.com", { [a]: ["Live"] }), catalogue)).toEqual({ total: 5, upperBound: false });
    });

    it("round-trips this register's dimensions and detects a change regardless of order", () => {
      const rows = [row("B@x.com", { [a]: ["2", "1"], [b]: ["z"] })];
      const payload = rosterPayload(rows);
      expect(payload).toEqual([{ email: "b@x.com", scope: { [a]: ["2", "1"], [b]: ["z"] } }]);
      expect(rosterChanged(rows, [row("b@x.com", { [a]: ["1", "2"], [b]: ["z"] })])).toBe(false);
      expect(rosterChanged(rows, [])).toBe(true);
    });

    it("warns about an address outside the owner's domain", () => {
      expect(foreignDomain("a@other.com", "example.com")).toBe(true);
      expect(foreignDomain("a@example.com", "example.com")).toBe(false);
    });
  });

  describe("scoped view — MTTR is the headline", () => {
    it("prints the median, falls back to 'at least' the bound, and never prints 0 days for nothing", () => {
      expect(mttrHeroView({ mttr: { median: 12 }, open: 3, resolved: 5 }).value).toMatch(/^12 days$/);
      const bound = mttrHeroView({ mttr: { median: null, medianLowerBound: 40 }, open: 3, resolved: 1 });
      expect(bound.value).toMatch(/^at least 40 days$/);
      expect(bound.isLowerBound).toBe(true);
      expect(mttrHeroView({}).value).toBe("Not measured");
    });

    it("measures each severity's median against its own target, capped at a full bar", () => {
      const rows = sevMttrRows({ perSev: [
        { sev: "CRITICAL", kmMedian: 30, slaTarget: 15, pastSla: 2 },
        { sev: "LOW", kmMedian: 45, slaTarget: 180, pastSla: 0 },
      ] });
      expect(rows[0]).toMatchObject({ sev: "CRITICAL", meterPct: 100, over: true });
      expect(rows[0].sub).toMatch(/2 past SLA/);
      expect(rows[1]).toMatchObject({ meterPct: 25, over: false });
      const bounded = sevMttrRows({ perSev: [{ sev: "HIGH", kmMedian: null, kmLowerBound: 60, slaTarget: 14 }] });
      expect(bounded[0]).toMatchObject({ value: "≥ 60 days", meterPct: 100, over: true });
    });

    it("keeps MTTR out of the secondary strip", () => {
      expect(secondaryStats({}).map((t) => t.key)).not.toContain("mttr");
    });

    it("says a group's size, its open share and its oldest open finding", () => {
      expect(groupLine({ count: 1, open: 0, oldestOpenDays: null })).toBe("1 finding · 0 open");
      expect(groupLine({ count: 12, open: 9, oldestOpenDays: 210 })).toBe("12 findings · 9 open · oldest open 210 days");
    });
  });
}
