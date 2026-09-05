// What the registers claim, tested without a browser.
//
// The load-bearing one is provenance: two resolved rows print the same date in the same
// column, and one of them is a measurement while the other is an upper bound. If that
// distinction can be lost, it will be lost silently.

import { describe, expect, it } from "vitest";
import {
  PROVENANCE, PROVENANCE_HELP, REGISTERS, REGISTER_ORDER, activeFilterCount, boundedShare,
  executiveHeadline, facetEntries, headerFigures, provenance, readFilters, scopeSummaries,
} from "../src/client/js/pages/registerModel.js";

const open = (over = {}) => ({ status: "OPEN", resolution_src: null, ...over });
const byApi = (over = {}) => ({ status: "RESOLVED", resolution_src: "api", ...over });
const byGone = (over = {}) => ({ status: "RESOLVED", resolution_src: "disappeared", ...over });

describe("a death date is not always a measurement", () => {
  it("tells an observed resolution from a bounded one", () => {
    expect(provenance(open())).toBe(PROVENANCE.OPEN);
    expect(provenance(byApi())).toBe(PROVENANCE.OBSERVED);
    expect(provenance(byGone())).toBe(PROVENANCE.BOUNDED);
  });

  it("does not call an unrecorded resolution observed", () => {
    // A row resolved before resolution_src was written, or by a source that did not say.
    // Claiming it as observed would upgrade an unknown into a measurement.
    expect(provenance({ status: "RESOLVED", resolution_src: null })).toBe(PROVENANCE.UNKNOWN);
    expect(provenance({ status: "RESOLVED", resolution_src: "" })).toBe(PROVENANCE.UNKNOWN);
  });

  it("applies to all three registers, not only to SAST", () => {
    // SAST is where this is ALWAYS true (§2 — no resolution date, no resolved rows), which
    // is why the caveat was written for it. But SCA and secrets resolve by disappearance
    // too, and qualifying only SAST would imply the other two dates are exact.
    for (const scope of REGISTER_ORDER) {
      expect(provenance(byGone({ scope }))).toBe(PROVENANCE.BOUNDED);
    }
  });

  it("says what a bounded date actually means", () => {
    // The words matter as much as the flag: "the scan that first missed it" is the claim,
    // and it has to name the error, not just hedge.
    expect(PROVENANCE_HELP[PROVENANCE.BOUNDED]).toMatch(/upper bound/);
    expect(PROVENANCE_HELP[PROVENANCE.BOUNDED]).toMatch(/between the previous scan and this one/);
  });

  it("measures the share of aggregates resting on bounded dates", () => {
    // "Median 12 d" over mostly-bounded dates is a different claim from the same number
    // over observed ones, so the page prints this beside any aggregate.
    const s = boundedShare([open(), byApi(), byGone(), byGone()]);
    expect(s.resolved).toBe(3);
    expect(s.bounded).toBe(2);
    expect(s.pct).toBeCloseTo(66.7, 1);
  });

  it("reports null rather than zero when nothing has resolved", () => {
    // 0% bounded and "no resolved rows to characterise" are different answers.
    expect(boundedShare([open(), open()]).pct).toBeNull();
    expect(boundedShare([]).pct).toBeNull();
  });
});

describe("the three registers each carry their own caveat", () => {
  it("names all three and orders them as the nav does", () => {
    expect(REGISTER_ORDER).toEqual(["sca", "sast", "secrets"]);
    expect(Object.keys(REGISTERS).sort()).toEqual(["sast", "sca", "secrets"]);
  });

  it("gives SCA the tri-state columns and the vendor-fix split", () => {
    const keys = REGISTERS.sca.columns.map((c) => c.key);
    expect(keys).toContain("has_kev");
    expect(keys).toContain("has_exploit");
    expect(keys).toContain("epss");
    // Waiting on a vendor is not waiting on a team — the whole reason the second clock
    // exists, so it is a column rather than a detail in the sheet.
    expect(keys).toContain("awaiting_vendor_fix");
    expect(REGISTERS.sca.facets).toContain("awaitingVendor");
    expect(REGISTERS.sca.caveat).toMatch(/TRI-STATE/);
  });

  it("gives secrets TWO date columns, because they are two events", () => {
    const keys = REGISTERS.secrets.columns.map((c) => c.key);
    expect(keys).toContain("removed_at");   // the string left HEAD
    expect(keys).toContain("rotated_at");   // the credential was observed dead
    expect(keys).toContain("validation_state");
    // Where the twin fold discarded a measurement, the row says so.
    expect(keys).toContain("twin_count");
    expect(REGISTERS.secrets.caveat).toMatch(/REMOVED IS NOT ROTATED/);
  });

  it("does not put a vendor-fix column on the scopes that have no vendor", () => {
    // SAST and secrets have no vendor and never will; baseRows already forces the flag
    // false for them, so a column would be a permanently empty claim.
    for (const scope of ["sast", "secrets"]) {
      const keys = REGISTERS[scope].columns.map((c) => c.key);
      expect(keys).not.toContain("awaiting_vendor_fix");
      expect(REGISTERS[scope].facets).not.toContain("awaitingVendor");
    }
  });

  it("does not put the exploit signals on the scopes where they are not applicable", () => {
    // Null there means NOT APPLICABLE rather than unmeasured, and a tri-state cell reading
    // "unknown" on every row would be claiming the wrong kind of absence.
    for (const scope of ["sast", "secrets"]) {
      const keys = REGISTERS[scope].columns.map((c) => c.key);
      expect(keys).not.toContain("has_kev");
      expect(keys).not.toContain("epss");
    }
  });

  it("gives every register a state column, so provenance is always on screen", () => {
    for (const scope of REGISTER_ORDER) {
      expect(REGISTERS[scope].columns.some((c) => c.kind === "provenance")).toBe(true);
    }
  });

  it("says SAST's death date is always bounded", () => {
    expect(REGISTERS.sast.caveat).toMatch(/EVERY closed row/);
    expect(REGISTERS.sast.caveat).toMatch(/bounded by the scan interval/);
  });
});

describe("the header does not misstate the size of the register", () => {
  const payload = (over = {}) => ({
    total: 40, scopeTotal: 170,
    summary: { open: 30, resolved: 10, disappeared: 7, awaitingVendor: 4 },
    ...over,
  });

  it("keeps the filtered count and the register's size apart", () => {
    // "1,204 findings" with a filter on has told the reader the size of the register wrongly.
    const h = headerFigures(payload());
    expect(h.total).toBe(40);
    expect(h.scopeTotal).toBe(170);
    expect(h.filtered).toBe(true);
  });

  it("does not claim a filter when none is on", () => {
    expect(headerFigures(payload({ total: 170 })).filtered).toBe(false);
  });

  it("reports the bounded share of what resolved", () => {
    expect(headerFigures(payload()).boundedPct).toBe(70);
  });

  it("reports null, not zero, when nothing resolved", () => {
    const h = headerFigures(payload({
      summary: { open: 40, resolved: 0, disappeared: 0, awaitingVendor: 0 },
    }));
    expect(h.boundedPct).toBeNull();
  });
});

describe("facets describe the register, not the selection", () => {
  const facets = { severity: { HIGH: 30, CRITICAL: 5, LOW: 60 }, repo: { a: 4, b: 9 } };

  it("orders severity by meaning, not by count or alphabet", () => {
    // "CRITICAL, HIGH, INFO, LOW, MEDIUM" is what a string sort gives and it is useless.
    const e = facetEntries(facets, "severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
    expect(e.map((x) => x.value)).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("orders an unordered dimension by count", () => {
    expect(facetEntries(facets, "repo").map((x) => x.value)).toEqual(["b", "a"]);
  });

  it("returns nothing for a dimension the scope does not have", () => {
    expect(facetEntries(facets, "validation")).toEqual([]);
    expect(facetEntries(undefined, "severity")).toEqual([]);
  });
});

describe("filters live in the URL, and are not trusted", () => {
  it("makes a filtered register a link someone can send", () => {
    const f = readFilters({ severities: "critical,high", repo: "org/api", status: "open" }, REGISTERS.sca);
    expect(f.severities).toEqual(["CRITICAL", "HIGH"]);
    expect(f.repo).toBe("org/api");
    expect(f.status).toBe("open");
  });

  it("drops a filter the scope does not offer", () => {
    // A hash is user-editable. Forwarding whatever it holds into an RPC is how a query
    // param becomes an injection point — and `awaitingVendor` on secrets is meaningless
    // anyway, since baseRows forces the flag false there.
    const f = readFilters({ awaitingVendor: "1", validation: "VALID" }, REGISTERS.sast);
    expect(f.awaitingVendor).toBeUndefined();
    expect(f.validation).toBeUndefined();
  });

  it("keeps the vendor-fix toggle on the one scope that has a vendor", () => {
    expect(readFilters({ awaitingVendor: "1" }, REGISTERS.sca).awaitingVendor).toBe(true);
  });

  it("counts what is on", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ severities: [], repo: null })).toBe(0);
    expect(activeFilterCount({ severities: ["HIGH"], repo: "x", awaitingVendor: true })).toBe(3);
  });
});

describe("the front door", () => {
  it("quotes a lower bound where MTTR & SLA would, never a median", () => {
    // The two pages must not be able to disagree: the same register saying two things about
    // its own half-life is worse than either answer alone.
    const bounded = executiveHeadline({ median: null, medianLowerBound: 479, censored: 145 });
    expect(bounded).toEqual({ value: 479, bound: true, censored: 145 });

    const exact = executiveHeadline({ median: 12, medianLowerBound: null, censored: 3 });
    expect(exact).toEqual({ value: 12, bound: false, censored: 3 });
  });

  it("survives having no curve at all", () => {
    expect(executiveHeadline(null).value).toBeNull();
    expect(executiveHeadline({}).value).toBeNull();
  });

  it("lists a scope with no rows rather than omitting it", () => {
    // "We have no secrets findings" and "we never looked for secrets" are answers a leader
    // must be able to tell apart, and an omitted scope reads as the first while being the
    // second. lastScan beside it is what settles which.
    const s = scopeSummaries({
      totals: { sca: { open: 3, resolved: 1, total: 4 } },
      openBySeverity: { sca: { HIGH: 3 } },
      lastScan: { sca: { scan_id: "s1", ts: "2026-08-15T00:00:00Z" } },
      movement: {},
    });
    expect(s.map((x) => x.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(s[1].totals).toEqual({ open: 0, resolved: 0, total: 0 });
    expect(s[1].lastScan).toBeNull(); // never scanned — not "scanned and empty"
    expect(s[0].lastScan.scan_id).toBe("s1");
  });

  it("carries each register's title so the page does not re-name them", () => {
    expect(scopeSummaries({}).map((x) => x.title)).toEqual(["Dependencies", "Code", "Secrets"]);
  });
});
