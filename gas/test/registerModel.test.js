// The OS register's pure half: the provenance word, the URL params, and the sentence a
// filter-emptied table gets.
//
// A plain `.js` test file so it can import the untyped client module without tripping
// `tsc --noEmit`'s "no declaration file" error under `strict` — the same reason
// `test/registerRowsOrdering.test.js` and `test/chartModels.test.js` are `.js`.
//
// WHY THIS FILE EXISTS AT ALL. `pages/registerModel.js` encodes one claim the rest of the
// register is built on: A DEATH DATE IS NOT ALWAYS A MEASUREMENT. Where `resolution_src` is
// "disappeared" the date is the scan that first stopped seeing the finding, an upper bound
// whose error is the scan interval — and "Gone by 12 Aug" and "Resolved 12 Aug" are the same
// pixel width. If the word were ever computed in two places they would eventually disagree,
// which is why the word, the tone and the tip all come from here and the page and the sheet
// only render them.

import { describe, expect, it } from "vitest";

import { REGISTER_ROW_COLUMNS, REGISTER_ROW_DEFAULT_SORT } from "../src/domain/pagePayload";
import { RISK_TIER_ORDER } from "../src/domain/program";
import {
  PROVENANCE, PROVENANCE_HELP, PROVENANCE_KIND, PROVENANCE_LABEL, REGISTER_COLUMNS,
  REGISTER_DEFAULT_DIR, REGISTER_DEFAULT_SORT, REGISTER_SORT_KEYS, activeRegisterFilters,
  boundedShare, filterSentence, fixLabel, provenance, readRegisterParams,
  registerFirstRunView, registerParamPatch, returnedShare,
} from "../src/client/js/pages/registerModel.js";

// =========================================================================================
//  1. The provenance word
// =========================================================================================

describe("provenance names HOW a row's death date was arrived at", () => {
  it("an API-reported resolution is Resolved; a disappearance is Gone by", () => {
    expect(provenance({ status: "RESOLVED", resolution_src: "api" }))
      .toBe(PROVENANCE.OBSERVED);
    expect(PROVENANCE_LABEL[PROVENANCE.OBSERVED]).toBe("Resolved");

    expect(provenance({ status: "RESOLVED", resolution_src: "disappeared" }))
      .toBe(PROVENANCE.BOUNDED);
    expect(PROVENANCE_LABEL[PROVENANCE.BOUNDED]).toBe("Gone by");
    // The bound is stated in the tip, in words, not implied by the word alone.
    expect(PROVENANCE_HELP[PROVENANCE.BOUNDED]).toMatch(/upper bound, not a measurement/);
  });

  it("a resolution with no recorded source still reads Resolved, but warns", () => {
    const p = provenance({ status: "RESOLVED", resolution_src: null });
    expect(p).toBe(PROVENANCE.UNKNOWN);
    expect(PROVENANCE_LABEL[p]).toBe("Resolved");
    // NOT `ok`. A green tick over a date nothing accounted for overstates the ledger.
    expect(PROVENANCE_KIND[p]).toBe("warn");
    expect(PROVENANCE_KIND[PROVENANCE.BOUNDED]).toBe("warn");
    expect(PROVENANCE_KIND[PROVENANCE.OBSERVED]).toBe("ok");
  });

  it("an open row reads Open, and one that came back reads Returned", () => {
    expect(provenance({ status: "OPEN", reopened_count: 0 })).toBe(PROVENANCE.OPEN);
    expect(provenance({ status: "OPEN", reopened_count: 2 })).toBe(PROVENANCE.RETURNED);
    expect(PROVENANCE_LABEL[PROVENANCE.RETURNED]).toBe("Returned");
  });

  it("a null row and a non-object are Open, not a crash and not a resolution", () => {
    expect(provenance(null)).toBe(PROVENANCE.OPEN);
    expect(provenance(undefined)).toBe(PROVENANCE.OPEN);
    expect(provenance("RESOLVED")).toBe(PROVENANCE.OPEN);
  });
});

describe("reopened_count is refused BEFORE the cast, not after", () => {
  // `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all 0 and all finite.
  // On THIS field a cast-first form gets those four right by luck — 0 is not > 0 — so a test
  // that only listed them would be the "guard that fires on nothing" CLAUDE.md names.
  it("reads null, blank, [] and false as never-reopened", () => {
    for (const rc of [null, undefined, "", [], false]) {
      expect(provenance({ status: "OPEN", reopened_count: rc }), JSON.stringify(rc))
        .toBe(PROVENANCE.OPEN);
    }
  });

  // THE CASE WHERE THE TWO READINGS GENUINELY DIFFER, and therefore the only one that can
  // fail. A STRING "2" is truthy under `Number(rc) > 0` and refused by the typeof gate.
  //
  // PERTURBATION (written out, run, and shown failing below rather than described): the
  // tempting simplification `Number(rc) > 0`.
  it("refuses a STRING count — a reopen the wire never reported", () => {
    expect(provenance({ status: "OPEN", reopened_count: "2" })).toBe(PROVENANCE.OPEN);
    expect(provenance({ status: "OPEN", reopened_count: "  3 " })).toBe(PROVENANCE.OPEN);
  });

  it("the cast-first rewrite is reproduced here and reads a string as a reopen", () => {
    // The defective form, inline, so the difference is measured rather than asserted from a
    // comment. `[]` and `false` it gets right by luck; `"2"` it does not.
    const defective = (row) => {
      const rc = row.reopened_count;
      return Number(rc) > 0 ? PROVENANCE.RETURNED : PROVENANCE.OPEN;
    };
    const row = { status: "OPEN", reopened_count: "2" };
    expect(defective(row)).toBe(PROVENANCE.RETURNED);
    expect(provenance(row)).toBe(PROVENANCE.OPEN);
    expect(defective(row)).not.toBe(provenance(row));
    // And the four the luck covers, so the perturbation's own reach is stated.
    for (const rc of [null, [], false, ""]) {
      expect(defective({ status: "OPEN", reopened_count: rc }))
        .toBe(provenance({ status: "OPEN", reopened_count: rc }));
    }
  });

  it("NaN and Infinity are not counts either", () => {
    expect(provenance({ status: "OPEN", reopened_count: NaN })).toBe(PROVENANCE.OPEN);
    expect(provenance({ status: "OPEN", reopened_count: Infinity })).toBe(PROVENANCE.OPEN);
  });
});

// =========================================================================================
//  2. The two shares, and their empty denominators
// =========================================================================================

describe("boundedShare and returnedShare answer null, never 0, on an empty base", () => {
  const rows = [
    { status: "RESOLVED", resolution_src: "api" },
    { status: "RESOLVED", resolution_src: "disappeared" },
    { status: "RESOLVED", resolution_src: "disappeared" },
    { status: "OPEN", reopened_count: 0 },
    { status: "OPEN", reopened_count: 1 },
  ];

  it("counts the bounded share of resolved rows and the returned share of open ones", () => {
    expect(boundedShare(rows)).toEqual({ resolved: 3, bounded: 2, pct: (2 / 3) * 100 });
    expect(returnedShare(rows)).toEqual({ open: 2, returned: 1, pct: 50 });
  });

  it("an empty denominator is 'we cannot say', not 'none of them'", () => {
    expect(boundedShare([]).pct).toBeNull();
    expect(returnedShare([]).pct).toBeNull();
    expect(boundedShare(null).pct).toBeNull();
    expect(returnedShare(undefined).pct).toBeNull();
    // And 0 would be a measurement, which is the whole distinction.
    expect(boundedShare([]).pct).not.toBe(0);
  });
});

// =========================================================================================
//  3. The columns are keys the wire actually carries
// =========================================================================================

describe("the register's columns name only columns the server sends", () => {
  it("every column key is a member of REGISTER_ROW_COLUMNS", () => {
    const allowed = new Set(REGISTER_ROW_COLUMNS);
    const strays = REGISTER_COLUMNS.map((c) => c.key).filter((k) => !allowed.has(k));
    // A column keyed on something the wire does not carry prints an em dash on every row of
    // the register for the life of the page — a table claiming it looked and found nothing.
    expect(strays, `columns the wire never sends: ${strays.join(", ")}`).toEqual([]);
    expect(REGISTER_COLUMNS.length).toBeGreaterThanOrEqual(12);
  });

  it("the sort keys the toolbar may ask for are exactly the sortable columns", () => {
    expect(REGISTER_SORT_KEYS).toEqual(REGISTER_COLUMNS.filter((c) => c.sortable)
      .map((c) => c.key));
    for (const k of REGISTER_SORT_KEYS) expect(REGISTER_ROW_COLUMNS).toContain(k);
  });

  it("opens in the order the server opens in, so the first header is not a lie", () => {
    expect(REGISTER_DEFAULT_SORT).toBe(REGISTER_ROW_DEFAULT_SORT.sort);
    expect(REGISTER_DEFAULT_DIR).toBe(REGISTER_ROW_DEFAULT_SORT.dir);
  });
});

// =========================================================================================
//  4. The URL params
// =========================================================================================

describe("readRegisterParams normalizes the hash and drops what it does not know", () => {
  it("defaults with no params at all", () => {
    expect(readRegisterParams({})).toEqual({
      status: "open", fix: "all", tier: [], exposed: false,
      page: 0, sort: "age_days", dir: "desc",
    });
    expect(readRegisterParams(null).status).toBe("open");
    expect(readRegisterParams(undefined).tier).toEqual([]);
  });

  it("an unrecognised value falls back to the default, never to an empty page", () => {
    // A hash is user-editable. Answering a typo with "0 findings" states a measurement about
    // a population nobody asked for — the server makes the same call in `registerRowFilters`.
    expect(readRegisterParams({ status: "opne" }).status).toBe("open");
    expect(readRegisterParams({ fix: "whatever" }).fix).toBe("all");
    expect(readRegisterParams({ sort: "tags_json" }).sort).toBe("age_days");
    expect(readRegisterParams({ dir: "sideways" }).dir).toBe("desc");
  });

  it("keeps only known tiers, and returns them in tier order", () => {
    expect(readRegisterParams({ tier: "exploit,kev" }).tier).toEqual(["kev", "exploit"]);
    expect(readRegisterParams({ tier: "kev,nonsense" }).tier).toEqual(["kev"]);
    expect(readRegisterParams({ tier: "nonsense" }).tier).toEqual([]);
    expect(readRegisterParams({ tier: " KEV , Unknown " }).tier).toEqual(["kev", "unknown"]);
    expect(readRegisterParams({ tier: RISK_TIER_ORDER.slice().reverse().join(",") }).tier)
      .toEqual([...RISK_TIER_ORDER]);
    // An array arrives too, from a caller that did not join it.
    expect(readRegisterParams({ tier: ["epss"] }).tier).toEqual(["epss"]);
  });

  it("clamps the page and refuses the values a cast would turn into a confident 0", () => {
    expect(readRegisterParams({ page: "3" }).page).toBe(3);
    expect(readRegisterParams({ page: "-4" }).page).toBe(0);
    expect(readRegisterParams({ page: "2.7" }).page).toBe(2);
    for (const bad of [null, undefined, "", [], false, "abc", NaN]) {
      expect(readRegisterParams({ page: bad }).page, JSON.stringify(bad)).toBe(0);
    }
  });

  it("reads the exposure flag only from the forms a link can carry", () => {
    expect(readRegisterParams({ exposed: "1" }).exposed).toBe(true);
    expect(readRegisterParams({ exposed: "true" }).exposed).toBe(true);
    expect(readRegisterParams({ exposed: true }).exposed).toBe(true);
    expect(readRegisterParams({ exposed: "0" }).exposed).toBe(false);
    expect(readRegisterParams({ exposed: "" }).exposed).toBe(false);
  });

  it("defaults dir per column the way the server does", () => {
    // The default column opens descending (oldest open first); any other column opens
    // ascending, matching `getRegisterRows`.
    expect(readRegisterParams({ sort: "age_days" }).dir).toBe("desc");
    expect(readRegisterParams({ sort: "cve" }).dir).toBe("asc");
    expect(readRegisterParams({ sort: "cve", dir: "desc" }).dir).toBe("desc");
  });

  it("round-trips through registerParamPatch, dropping every default", () => {
    const patch = registerParamPatch(readRegisterParams({}));
    // `buildHash` drops empty values, so a default view is a bare URL and a shared link never
    // carries a filter nobody chose.
    expect(Object.values(patch).every((v) => v === "")).toBe(true);

    const filters = readRegisterParams({
      status: "resolved", fix: "awaiting", tier: "kev,epss", exposed: "1",
      sort: "cve", dir: "asc", page: "2",
    });
    const round = readRegisterParams(registerParamPatch(filters));
    expect(round).toEqual({ ...filters, page: 2 });
  });

  it("counts the filters that are actually on", () => {
    expect(activeRegisterFilters(readRegisterParams({ status: "all" }))).toBe(0);
    // `open` IS a narrowing, even though it is the default the register opens in.
    expect(activeRegisterFilters(readRegisterParams({}))).toBe(1);
    expect(activeRegisterFilters(readRegisterParams({
      status: "resolved", fix: "fixable", tier: "kev", exposed: "1",
    }))).toBe(4);
  });
});

// =========================================================================================
//  5. The sentence a filter-emptied table gets
// =========================================================================================

describe("filterSentence names which filters narrowed the table", () => {
  it("names each one, in the toolbar's own words", () => {
    expect(filterSentence(readRegisterParams({
      status: "resolved", fix: "awaiting", tier: "kev",
    }))).toBe("Nothing matched: resolved only, awaiting vendor fix, tier Known exploited.");
    expect(filterSentence(readRegisterParams({ exposed: "1" })))
      .toBe("Nothing matched: open only, internet-reachable only.");
    expect(filterSentence(readRegisterParams({ status: "all", fix: "fixable" })))
      .toBe("Nothing matched: fix available.");
  });

  it("is null when nothing is on, so an unfiltered empty register is not blamed on a filter", () => {
    // `status: "all"` with everything else at its default is the one unfiltered state.
    expect(filterSentence(readRegisterParams({ status: "all" }))).toBeNull();
    expect(filterSentence(null)).toBeNull();
    expect(filterSentence({})).toBeNull();
  });
});

// =========================================================================================
//  6. First run, and the vendor-fix word
// =========================================================================================

describe("registerFirstRunView asks 'has anything ever been written here'", () => {
  it("shows on an empty ledger and hides on one with rows", () => {
    expect(registerFirstRunView(0, true, "2026-09-01T00:00:00Z"))
      .toEqual({ show: true, synced: true, at: "2026-09-01T00:00:00Z" });
    expect(registerFirstRunView(412, true, "x").show).toBe(false);
  });

  it("a malformed count degrades to 'nothing to show', not to a page assuming data", () => {
    for (const bad of [null, undefined, "", [], false, "abc"]) {
      expect(registerFirstRunView(bad, true, null).show, JSON.stringify(bad)).toBe(true);
    }
  });

  it("distinguishes 'nobody scanned' from 'a scan ran and saved nothing'", () => {
    expect(registerFirstRunView(0, false, null).synced).toBe(false);
    expect(registerFirstRunView(0, true, null).synced).toBe(true);
  });
});

describe("fixLabel refuses to call an absent column a published fix", () => {
  it("says Awaiting vendor / Available, and dashes a column that never arrived", () => {
    expect(fixLabel(true)).toBe("Awaiting vendor");
    expect(fixLabel(false)).toBe("Available");
    expect(fixLabel(null)).toBe("—");
    expect(fixLabel(undefined)).toBe("—");
  });
});
