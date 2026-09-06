// What the registers claim, tested without a browser.
//
// The load-bearing one is provenance: two resolved rows print the same date in the same
// column, and one of them is a measurement while the other is an upper bound. If that
// distinction can be lost, it will be lost silently.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROVENANCE, PROVENANCE_HELP, REGISTERS, REGISTER_ORDER, activeFilterCount, boundedShare,
  executiveHeadline, facetEntries, headerFigures, populationLine, provenance, readFilters,
  returnedShare, scopeSummaries,
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

  it("a reopened open row is Returned, not merely Open", () => {
    // reconcile.ts's reopen path sets status back to OPEN and increments reopened_count —
    // a row that came back is a different claim from one that never left.
    expect(provenance(open({ reopened_count: 1 }))).toBe(PROVENANCE.RETURNED);
    expect(provenance(open({ reopened_count: 3 }))).toBe(PROVENANCE.RETURNED);
    expect(provenance(open({ reopened_count: 0 }))).toBe(PROVENANCE.OPEN);
  });

  it("a reopened row that has resolved again is still dated by its resolution_src", () => {
    // Returned only describes a row that is OPEN right now. Once it resolves again,
    // resolution_src still decides observed vs. bounded vs. unknown — reopened_count never
    // overrides a status of RESOLVED.
    expect(provenance(byApi({ reopened_count: 3 }))).toBe(PROVENANCE.OBSERVED);
    expect(provenance(byGone({ reopened_count: 3 }))).toBe(PROVENANCE.BOUNDED);
  });

  it("Number(null) reopened_count is not a return", () => {
    // CLAUDE.md's trap, restated for this field: Number(null) is 0, and it is finite. Every
    // one of these has to refuse BEFORE the cast, not read a missing count as "reopened 0
    // times" (harmless here) that a careless rewrite could just as easily read as "reopened".
    expect(provenance(open({ reopened_count: null }))).toBe(PROVENANCE.OPEN);
    expect(provenance(open({ reopened_count: undefined }))).toBe(PROVENANCE.OPEN);
    expect(provenance(open({ reopened_count: "" }))).toBe(PROVENANCE.OPEN);
    expect(provenance(open({ reopened_count: [] }))).toBe(PROVENANCE.OPEN);
    expect(provenance(open({ reopened_count: false }))).toBe(PROVENANCE.OPEN);
    // The bite the perturbation below actually finds: none of the five values above bite,
    // because they all coerce to 0 or NaN and 0 > 0 is false either way — a naive
    // `Number(row.reopened_count) > 0` would pass every one of them by accident, which is
    // exactly the "guard that fires on nothing" CLAUDE.md warns against. A single-element
    // array does bite: `Number(["2"])` is `2`, not NaN, so a malformed count wrapped in an
    // array would read as genuinely reopened under a naive cast. The typed guard refuses it.
    expect(provenance(open({ reopened_count: ["2"] }))).toBe(PROVENANCE.OPEN);
  });

  it("returnedShare reports null, not zero, when nothing is open", () => {
    const s = returnedShare([open({ reopened_count: 2 }), open(), byApi(), byGone()]);
    expect(s.open).toBe(2);
    expect(s.returned).toBe(1);
    expect(s.pct).toBeCloseTo(50, 1);
    expect(returnedShare([byApi(), byGone()]).pct).toBeNull();
    expect(returnedShare([]).pct).toBeNull();
  });
});

describe("the live sca/sast status columns render provenance(), not raw status", () => {
  // registerModel.js used to be read only by the orphan pages/register.js — the live tables
  // (sca.js:1073, sast.js:462) rendered `textCell(r.status)` and a reopened row printed the
  // same word as one that had never left. A text assertion over the source, in the style of
  // gas_shared/test/contracts/*.js, so the live tables cannot drift back to raw status
  // silently — a unit test on registerModel.js alone would never notice that regression.
  const src = (rel) => readFileSync(
    fileURLToPath(new URL(`../src/client/js/pages/${rel}`, import.meta.url)),
    "utf8",
  );

  it("sca.js's status column reads provenance(), not r.status", () => {
    const text = src("sca.js");
    const statusCol = text.slice(text.indexOf('key: "status"'), text.indexOf('key: "status"') + 300);
    expect(statusCol).toMatch(/provenance\(/);
    expect(statusCol).not.toMatch(/textCell\(r\.status\)/);
  });

  it("sast.js's status column reads provenance(), not r.status", () => {
    const text = src("sast.js");
    const statusCol = text.slice(text.indexOf('key: "status"'), text.indexOf('key: "status"') + 300);
    expect(statusCol).toMatch(/provenance\(/);
    expect(statusCol).not.toMatch(/textCell\(r\.status\)/);
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


// =========================================================================================
//  The line under the hero: what was measured, and what was never looked at
// =========================================================================================
//
// Every figure on a register page is computed over a population three things narrowed first.
// The one failure this suite exists for is the tempting one: printing a ZERO for the rows the
// severity gate kept out. Nothing counted them — a sync gated to CRITICAL/HIGH never fetched a
// MEDIUM row — so a zero there would be a confident measurement of a population nobody looked
// at.

describe("the population line names the gate and refuses to price what it excluded", () => {
  const withPop = (population) => ({ population });

  it("names the gate when one was applied", () => {
    const line = populationLine(withPop({
      inScope: 1234,
      gate: ["CRITICAL", "HIGH"],
      filters: ["the default branch only"],
    }));
    expect(line.parts[0]).toBe("In scope 1,234");
    expect(line.parts[1]).toBe("gate CRITICAL, HIGH");
    expect(line.parts).toContain("the default branch only");
    expect(line.text).toBe(
      "In scope 1,234 · gate CRITICAL, HIGH · the default branch only · "
      + "below the gate: not counted",
    );
  });

  it("says 'all severities' rather than printing an empty gate", () => {
    // THREE SHAPES, ONE MEANING. parseSeverities answers null for a gate that covered
    // everything; a payload can carry the empty list; a hand-written fixture can carry the
    // empty string. `[].join(", ")` is "", and "gate " on screen reads as a gate whose
    // severities went missing — a different claim from "the gate was off".
    for (const gate of [null, [], "", undefined, ["  ", ""]]) {
      const line = populationLine(withPop({ inScope: 7, gate, filters: [] }));
      expect(line.parts[1], `gate ${JSON.stringify(gate)}`).toBe("gate: all severities");
      expect(line.text, `gate ${JSON.stringify(gate)}`).not.toMatch(/gate\s*·/);
      expect(line.text, `gate ${JSON.stringify(gate)}`).not.toMatch(/gate\s*$/);
    }
  });

  it("secrets' default empty gate reads as all severities, and says nothing was excluded", () => {
    // DEFAULT_FETCH_SEVERITIES.secrets is [] — empty means all, and severityFilter([]) makes
    // buildFilter omit the severity key entirely. So the whole CODE population is in the
    // register, and there is no "below the gate" to speak of. This is a third of the product,
    // not an edge case.
    const line = populationLine(withPop({
      inScope: 1958,
      gate: [],
      filters: ["repository findings, not cloud or runtime detections"],
    }));
    expect(line.parts[1]).toBe("gate: all severities");
    expect(line.text).not.toContain("not counted");
    expect(line.text).toBe(
      "In scope 1,958 · gate: all severities · repository findings, not cloud or runtime "
      + "detections",
    );
  });

  it("never prints a zero for what the gate excluded", () => {
    const line = populationLine(withPop({
      inScope: 500,
      gate: ["CRITICAL"],
      filters: [],
    }));
    const excluded = line.parts.filter((s) => /below the gate/.test(s));
    expect(excluded).toEqual(["below the gate: not counted"]);
    // The excluded part carries NO DIGIT of any kind — not a zero, not a count, not a
    // percentage. The rows it describes were never fetched.
    expect(excluded[0]).not.toMatch(/\d/);
  });

  it("returns null on a payload with no population block", () => {
    // A warm cache entry written before this block existed. Half a sentence — "In scope 412"
    // with no gate and no filters — states the count as if it were the whole story, which is
    // the exact reading this line exists to prevent.
    for (const model of [null, undefined, {}, { population: null }, { population: 7 }]) {
      expect(populationLine(model), JSON.stringify(model)).toBeNull();
    }
  });

  it("says em dash rather than zero for a count that was never measured", () => {
    // Number(null) is 0 and it is finite; fmtCount refuses null/undefined/""/[]/false BEFORE
    // the cast, which is the only reason "In scope 0" is not printed over an absent count.
    for (const inScope of [null, undefined, "", []]) {
      const line = populationLine(withPop({ inScope, gate: null, filters: [] }));
      expect(line.parts[0], JSON.stringify(inScope)).toBe("In scope —");
    }
    expect(populationLine(withPop({ inScope: 0, gate: null, filters: [] })).parts[0])
      .toBe("In scope 0"); // a real zero IS a measurement, and keeps its digit
  });

  it("drops a blank or non-string filter word rather than joining an empty part", () => {
    const line = populationLine(withPop({
      inScope: 1,
      gate: null,
      filters: ["  the default branch only  ", "", null, 3, "  "],
    }));
    expect(line.parts).toEqual(["In scope 1", "gate: all severities", "the default branch only"]);
  });
});
