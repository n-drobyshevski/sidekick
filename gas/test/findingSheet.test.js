// The finding drill-down's pure half, and the refusals it exists to keep.
//
// WHY A PROXY AND NOT A KEY LIST. `pages/findingSheet.js`'s whole claim is that it draws from
// THE WIRE ROW AND NOTHING ELSE — `REGISTER_ROW_COLUMNS` plus `REGISTER_ROW_KEY`. Asserting
// that over the model's OUTPUT would only catch a field that happened to print; a sheet that
// read `row.tags_json` and used it to CHOOSE a word would pass. So the row handed to the
// model is a Proxy that records every property it is asked for, and the assertion is over the
// set of keys READ. A column that does not travel cannot be consulted at all.
//
// Ported from `gas_devsecops/test/findingSheet.test.js`, whose three-scope structure collapses
// to one register here — and whose central case gains teeth rather than losing them: THIS
// register does carry `resolved_at` on the wire, so "never prints a resolution date" becomes
// "never prints it under the wrong word", which is a claim a wrong implementation can satisfy
// halfway.
//
// A plain `.js` test file so it can import the untyped client module without tripping
// `tsc --noEmit`'s "no declaration file" error under `strict`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REGISTER_ROW_COLUMNS, REGISTER_ROW_KEY } from "../src/domain/pagePayload";
import { nvdUrl } from "../src/client/js/ui/nvd.js";
import {
  findingRowLabel, findingSheetModel,
} from "../src/client/js/pages/findingSheet.js";

const SRC = readFileSync(
  new URL("../src/client/js/pages/findingSheet.js", import.meta.url),
  "utf8",
);

/** A value for every column, distinct enough that a leak into the output is greppable. */
const VALUES = {
  cve: "CVE-2026-0001",
  severity: "HIGH",
  risk_tier: "kev",
  status: "RESOLVED",
  resolution_src: "disappeared",
  reopened_count: 0,
  asset_name: "web-prod-01",
  asset_type: "VIRTUAL_MACHINE",
  cloud: "AWS",
  subscription_name: "prod-account",
  support_group: "CS-CORE-PLATFORM",
  domain: "Payments",
  first_seen: "2026-01-05T00:00:00Z",
  published_date: "2025-12-20T00:00:00Z",
  fix_available_at: "2026-02-01T00:00:00Z",
  awaiting_vendor_fix: false,
  last_seen: "2026-03-09T00:00:00Z",
  resolved_at: "2026-03-11T00:00:00Z",
  has_kev: true,
  has_exploit: null,
  epss: 0.1234,
  internet_exposed: true,
  mttr_days: 63.5,
  age_days: 65.5,
  actionable_age_days: 38.2,
};

/** One wire row: exactly the columns the endpoint ships, plus the key. */
function wireRow(overrides) {
  const row = { [REGISTER_ROW_KEY]: "asset-1|CVE-2026-0001" };
  for (const col of REGISTER_ROW_COLUMNS) row[col] = VALUES[col] ?? null;
  return { ...row, ...(overrides || {}) };
}

/** The same row, wrapped so every property read is recorded. */
function recordingRow(row, seen) {
  return new Proxy(row, {
    get(target, prop) {
      if (typeof prop === "string") seen.add(prop);
      return target[prop];
    },
  });
}

/** Every string in the model, flattened — what a reader could actually end up seeing. */
function allText(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allText(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allText(v, out);
  return out;
}

const rowsOf = (model) => model.sections.flatMap((s) => s.rows);
const labelsOf = (model) => rowsOf(model).map((r) => r.label);
const findRow = (model, label) => rowsOf(model).find((r) => r.label === label);

// =========================================================================================
//  1. The sheet reads the wire row and nothing else
// =========================================================================================

describe("findingSheetModel reads only columns the wire actually carries", () => {
  it("consults no column outside the allowlist", () => {
    const seen = new Set();
    findingSheetModel(recordingRow(wireRow(), seen));
    const allowed = new Set([...REGISTER_ROW_COLUMNS, REGISTER_ROW_KEY]);
    const strays = [...seen].filter((k) => !allowed.has(k));
    expect(strays, `read a column it was never sent: ${strays.join(", ")}`).toEqual([]);
  });

  it("is not a vacuous sweep — it genuinely reads most of the register's own columns", () => {
    const seen = new Set();
    findingSheetModel(recordingRow(wireRow(), seen));
    const read = REGISTER_ROW_COLUMNS.filter((c) => seen.has(c));
    expect(read.length, `reads only ${read.length} of ${REGISTER_ROW_COLUMNS.length} columns`)
      .toBeGreaterThanOrEqual(15);
  });

  it("names none of the fields the server's allowlist deliberately withholds", () => {
    // `tags_json`, `asset_id`, the scan ids and the raw capture columns are refused by
    // `registerRowsSlice`; a sheet naming one of them would be reaching for a field the wire
    // cannot supply, which is a dash on every row of the register.
    for (const denied of ["tags_json", "asset_id", "first_scan_id", "last_scan_id",
      "fix_date", "fix_observed_at", "risk_observed_at", "cvss"]) {
      expect(SRC, `findingSheet.js names ${denied}`).not.toMatch(new RegExp(`r\\.${denied}\\b`));
    }
  });
});

// =========================================================================================
//  2. A death date is not always a measurement, and the row has to say which
// =========================================================================================

describe("failure of absence: a bounded date never printed as an observed one", () => {
  it("a disappearance-resolved row reads 'Gone by' and carries the bound in its tip", () => {
    const model = findingSheetModel(wireRow({
      status: "RESOLVED", resolution_src: "disappeared",
    }));
    expect(findRow(model, "State").value).toBe("Gone by");
    expect(labelsOf(model)).toContain("Gone by");
    expect(labelsOf(model)).not.toContain("Resolved");
    expect(findRow(model, "Gone by").help).toMatch(/upper bound, not a measurement/);
    expect(model.chips[0].text).toBe("Gone by");
    expect(model.chips[0].kind).toBe("warn");
  });

  it("an API-reported resolution reads 'Resolved' and gets the observed row instead", () => {
    const model = findingSheetModel(wireRow({
      status: "RESOLVED", resolution_src: "api",
    }));
    expect(findRow(model, "State").value).toBe("Resolved");
    expect(labelsOf(model)).toContain("Resolved");
    expect(labelsOf(model)).not.toContain("Gone by");
    expect(model.chips[0].kind).toBe("ok");
  });

  it("an open row is given NEITHER dated row, however a resolved_at reached it", () => {
    // A stale or hand-built payload can carry a `resolved_at` on an OPEN row. Printing it
    // would date a resolution that has not happened.
    const model = findingSheetModel(wireRow({
      status: "OPEN", resolution_src: null, reopened_count: 0,
      resolved_at: "2026-04-04T00:00:00Z",
    }));
    expect(findRow(model, "State").value).toBe("Open");
    expect(labelsOf(model)).not.toContain("Resolved");
    expect(labelsOf(model)).not.toContain("Gone by");
    expect(allText(model).join(" | ")).not.toMatch(/4 Apr 2026|2026-04-04/);
  });

  it("a reopened row says so rather than reading as one that never left", () => {
    const model = findingSheetModel(wireRow({
      status: "OPEN", resolution_src: null, reopened_count: 2,
    }));
    expect(findRow(model, "State").value).toBe("Returned");
    expect(labelsOf(model)).toContain("Reopened");
    expect(findRow(model, "Reopened").value).toBe("2 time(s)");
    // And a row that never reopened does not carry the line at all — "Reopened 0 time(s)" is
    // an answer to a question nobody asked.
    expect(labelsOf(findingSheetModel(wireRow({ status: "OPEN", reopened_count: 0 }))))
      .not.toContain("Reopened");
  });

  // PERTURBATION. The defective form written out inline, so the difference is measured rather
  // than asserted from a comment: one unconditional `resolved_at` row, which is exactly the
  // tempting simplification of the branch in `clockSection`.
  it("the unconditional-date rewrite is reproduced here and dates a bound as a measurement", () => {
    const defective = (r) => ({
      label: "Resolved",
      value: r.resolved_at,
    });
    const bounded = wireRow({ status: "RESOLVED", resolution_src: "disappeared" });
    expect(defective(bounded).label).toBe("Resolved");
    // The real model refuses to put that date under that word.
    const real = findingSheetModel(bounded);
    expect(labelsOf(real)).not.toContain("Resolved");
    expect(findRow(real, "Gone by").value).toBe(findRow(real, "Gone by").value);
    expect(defective(bounded).label).not.toBe(findRow(real, "Gone by").label);
  });
});

// =========================================================================================
//  3. Absence, tri-states and the one outbound link
// =========================================================================================

describe("an absent field is a dash, never a confident value", () => {
  it("a wholly empty row renders no null, no undefined, no NaN and no zero-by-cast", () => {
    const empty = { [REGISTER_ROW_KEY]: null };
    for (const col of REGISTER_ROW_COLUMNS) empty[col] = null;
    const model = findingSheetModel(empty);
    // THE VALUES ONLY. The prose beside them says the word "null" nowhere, but the tips do
    // carry sentences about what a dash means, and sweeping the whole model would fail on the
    // sentence that states the rule this case checks.
    const values = rowsOf(model)
      // A tri row carries no string at all — its state IS the null, and `triCell` renders the
      // three answers. Stringifying it here would be the very cast this case forbids.
      .filter((r) => r.kind !== "tri")
      .map((r) => String(r.value));
    const text = values.join(" | ");
    expect(text).not.toMatch(/\bnull\b|\bundefined\b|NaN/);
    // `Number(null)` is 0 and finite: an age or an EPSS of "0.0 d" / "0.0%" here would be that
    // cast, not a measurement.
    expect(text).not.toMatch(/0\.0 d|0\.0%/);
    // And the tri rows keep their null rather than being flattened into a "No".
    for (const r of rowsOf(model)) {
      if (r.kind === "tri") expect(r.tri, r.label).toBeNull();
    }
    // The header still says something rather than rendering blank.
    expect(model.title).toBe("Finding");
    expect(model.chips[0].text).toBe("Open");
  });

  it("keeps the three exploitation signals tri-state, never collapsed to a No", () => {
    const model = findingSheetModel(wireRow({
      has_kev: true, has_exploit: false, internet_exposed: null,
    }));
    expect(findRow(model, "On KEV").tri).toBe(true);
    expect(findRow(model, "Known exploit").tri).toBe(false);
    expect(findRow(model, "Internet-reachable").tri).toBeNull();
    // And the null case explains itself, rather than reading as a measured "not reachable".
    expect(findRow(model, "Internet-reachable").help.lines[0])
      .toMatch(/Not captured in the last scan/);
  });

  it("builds the NVD link through nvd.js, only when there is a CVE to link", () => {
    const withCve = findRow(findingSheetModel(wireRow()), "CVE");
    expect(withCve.kind).toBe("link");
    expect(withCve.href).toBe(nvdUrl("CVE-2026-0001"));
    const without = findRow(findingSheetModel(wireRow({ cve: null })), "CVE");
    expect(without.kind).toBeUndefined();
    expect(without.href).toBeUndefined();
    expect(without.value).toBe("—");
  });

  it("names no literal URL of its own — the middlebox guard bans a bare double slash", () => {
    expect(SRC).not.toMatch(/["'`]https?:/);
    expect(SRC).toMatch(/nvdUrl\(/);
  });
});

// =========================================================================================
//  4. The header, the copies and the row's name
// =========================================================================================

describe("the header says what the record is and how much to trust its date", () => {
  it("titles by CVE, subtitles by asset and subscription", () => {
    const model = findingSheetModel(wireRow());
    expect(model.title).toBe("CVE-2026-0001");
    expect(model.subtitle).toBe("web-prod-01 · prod-account");
    expect(model.sev).toBe("HIGH");
    // No subtitle punctuation left dangling when half of it is absent.
    expect(findingSheetModel(wireRow({ subscription_name: null })).subtitle).toBe("web-prod-01");
    expect(findingSheetModel(wireRow({ asset_name: null, subscription_name: null })).subtitle)
      .toBe("");
  });

  it("carries the provenance word and the tier as its two chips", () => {
    const model = findingSheetModel(wireRow({ risk_tier: "kev" }));
    expect(model.chips.map((c) => c.text)).toEqual(["Gone by", "Known exploited"]);
    // A tier the classifier never reached keeps a WORD, and routes to the entry that says a
    // measurement gap is not a low score.
    const unknown = findingSheetModel(wireRow({ risk_tier: "unknown" }));
    expect(unknown.chips[1].text).toBe("Unclassified");
    expect(unknown.chips[1].help).toEqual({ term: "unclassified" });
    const absentTier = findingSheetModel(wireRow({ risk_tier: null }));
    expect(absentTier.chips[1].text).toBe("Unclassified");
  });

  it("offers a copy button for the CVE and for the asset, and none for what is absent", () => {
    expect(findingSheetModel(wireRow()).copies.map((c) => c.label))
      .toEqual(["Copy CVE", "Copy asset"]);
    expect(findingSheetModel(wireRow()).copies.map((c) => c.text))
      .toEqual(["CVE-2026-0001", "web-prod-01"]);
    expect(findingSheetModel(wireRow({ cve: null })).copies.map((c) => c.label))
      .toEqual(["Copy asset"]);
    expect(findingSheetModel({}).copies).toEqual([]);
  });

  it("gives the row button a name that says what opens", () => {
    expect(findingRowLabel(wireRow())).toBe("CVE-2026-0001, web-prod-01, open details");
    expect(findingRowLabel({ cve: null, asset_name: null })).toBe("Finding, open details");
    expect(findingRowLabel(null)).toBe("Finding, open details");
  });

  it("says where the record ends rather than drawing a link the ledger does not hold", () => {
    expect(findingSheetModel(wireRow()).footnote).toMatch(/the register carries no link/);
  });
});

// =========================================================================================
//  5. The three sections, in the order a reader needs them
// =========================================================================================

describe("the sheet's shape", () => {
  it("is Identity, Exploitation, Clock — exploitability before the clock, per the register", () => {
    expect(findingSheetModel(wireRow()).sections.map((s) => s.label))
      .toEqual(["Identity", "Exploitation", "Clock"]);
  });

  it("states both clocks and where each one started", () => {
    const labels = labelsOf(findingSheetModel(wireRow()));
    expect(labels).toEqual(expect.arrayContaining([
      "First seen", "Published", "Fix available", "Awaiting a vendor", "Last seen", "State",
      "Age", "Actionable age", "Time to remediate",
    ]));
  });

  it("omits the remediation duration on a row that has not been remediated", () => {
    expect(labelsOf(findingSheetModel(wireRow({ mttr_days: null }))))
      .not.toContain("Time to remediate");
  });
});
