// The finding drill-down's pure half, and the four refusals it exists to keep.
//
// WHY A PROXY AND NOT A KEY LIST. `pages/findingSheet.js`'s whole claim is that it draws from
// THE WIRE ROW AND NOTHING ELSE — `REGISTER_ROW_COLUMNS[scope]` plus `finding_key`. Asserting
// that over the model's OUTPUT would only catch a field that happened to print; a sheet that
// read `row.resolved_at` and used it to CHOOSE a word would pass. So the row handed to the
// model is a Proxy that records every property it is asked for, and the assertion is over the
// set of keys READ. A column that does not travel cannot be consulted at all.
//
// The other three refusals get their own cases: no severity on secrets (that register has no
// `severity` column and severity there grades a detection), no lifecycle word on secrets (it
// has no `status`/`resolution_src` column either, so `provenance()` would answer a confident
// "Open" for every row), and no resolution date anywhere (none is on the wire for any scope —
// the death side of the clock is `last_seen` plus the provenance WORD).
//
// A plain `.js` test file so it can import the untyped client module without tripping
// `tsc --noEmit`'s "no declaration file" error under `strict`, the same reason
// `test/registerRowsOrdering.test.js` is one.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REGISTER_ROW_COLUMNS, REGISTER_ROW_KEY } from "../src/domain/pagePayload";
import { findingRowLabel, findingSheetModel } from "../src/client/js/pages/findingSheet.js";

const SRC = readFileSync(
  new URL("../src/client/js/pages/findingSheet.js", import.meta.url),
  "utf8",
);

/** The file with its `//` comments removed — the stripper `test/pagesLit.test.js` uses. */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
const CODE = code(SRC);

const SCOPES = ["sca", "sast", "secrets"];

/** A value for every column, distinct enough that a leak into the output is greppable. */
const VALUES = {
  identifier: "CVE-2026-0001",
  component: "left-pad@1.0.0",
  severity: "HIGH",
  status: "RESOLVED",
  resolution_src: "disappeared",
  reopened_count: 0,
  repo_name: "acme/api",
  branch: "main",
  first_seen: "2026-01-05T00:00:00Z",
  last_seen: "2026-03-09T00:00:00Z",
  fixed_version: "1.2.3",
  fix_available_at: "2026-02-01T00:00:00Z",
  awaiting_vendor_fix: false,
  has_kev: null,
  has_exploit: true,
  epss: 0.1234,
  mttr_days: 63.5,
  age_days: null,
  cwe: "CWE-79",
  file_path: "src/app/main.py",
  start_line: 42,
  language: "python",
  origin: "semgrep",
  ai_verdict: "true positive",
  secret_kind: "SAAS_API_KEY",
  confidence: "HIGH",
  validation_state: "VALID",
  validated_at: "2026-03-01T00:00:00Z",
  rotated_at: "2026-03-02T00:00:00Z",
  removed_at: "2026-03-03T00:00:00Z",
};

/** One wire row for a scope: exactly the columns that scope ships, plus the key. */
function wireRow(scope, overrides) {
  const row = { [REGISTER_ROW_KEY]: `${scope}:key-1` };
  for (const col of REGISTER_ROW_COLUMNS[scope]) row[col] = VALUES[col] ?? null;
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

// =========================================================================================
//  1. The sheet reads the wire row and nothing else
// =========================================================================================

describe("findingSheetModel reads only columns the wire actually carries", () => {
  /**
   * PERTURBATION (run 2026-09-06, then reverted). `secretsSections` was given one extra row,
   * `row("State", PROVENANCE_LABEL[provenance(r)])` — the obvious-looking symmetry with the
   * other two registers, and the exact defect this case exists for, since `status`,
   * `resolution_src` and `reopened_count` are not in `REGISTER_ROW_COLUMNS.secrets`:
   *
   *   FAIL  … > secrets consults no column outside its own list
   *     AssertionError: secrets read a column it was never sent: status, reopened_count:
   *     expected [ 'status', 'reopened_count' ] to deeply equal []
   *   FAIL  … > names no lifecycle state row on secrets — that register ships no status column
   *     AssertionError: expected [ 'Credential', 'Kind', …(12) ] to not include 'State'
   *
   * Reverted. The model's answer on that row was "Open" for every secret in the register —
   * `provenance()` reads a `status` that is not on the wire, and `undefined !== "RESOLVED"`.
   */
  for (const scope of SCOPES) {
    it(`${scope} consults no column outside its own list`, () => {
      const seen = new Set();
      findingSheetModel(scope, recordingRow(wireRow(scope), seen));
      const allowed = new Set([...REGISTER_ROW_COLUMNS[scope], REGISTER_ROW_KEY]);
      const strays = [...seen].filter((k) => !allowed.has(k));
      expect(strays, `${scope} read a column it was never sent: ${strays.join(", ")}`).toEqual([]);
    });
  }

  it("is not a vacuous sweep — each scope genuinely reads most of its own columns", () => {
    for (const scope of SCOPES) {
      const seen = new Set();
      findingSheetModel(scope, recordingRow(wireRow(scope), seen));
      const read = REGISTER_ROW_COLUMNS[scope].filter((c) => seen.has(c));
      expect(read.length, `${scope} reads only ${read.length} of its own columns`)
        .toBeGreaterThanOrEqual(REGISTER_ROW_COLUMNS[scope].length - 1);
    }
  });

  it("never prints a resolution date, because none is on the wire", () => {
    // The row is handed a `resolved_at` it would never receive in production. If the sheet
    // reached for one, this is the shape it would come in.
    for (const scope of SCOPES) {
      const model = findingSheetModel(scope, wireRow(scope, { resolved_at: "2026-04-04T00:00:00Z" }));
      const text = allText(model).join(" | ");
      expect(text, `${scope} printed a resolution date`).not.toMatch(/2026-04-04|2026-04-04/);
      expect(text).not.toMatch(/\bresolved_at\b/);
    }
  });
});

// =========================================================================================
//  2. Secrets: no severity, no lifecycle word
// =========================================================================================

describe("the secrets sheet carries no severity and no status word", () => {
  it("sev is the empty string on secrets, and the row's severity on the other two", () => {
    expect(findingSheetModel("secrets", wireRow("secrets")).sev).toBe("");
    expect(findingSheetModel("sca", wireRow("sca")).sev).toBe("HIGH");
    expect(findingSheetModel("sast", wireRow("sast")).sev).toBe("HIGH");
  });

  it("keeps sev empty even if a severity is smuggled onto a secrets row", () => {
    // `REGISTER_ROW_COLUMNS.secrets` has no severity column, so this cannot happen through
    // the endpoint — the case is here because the accent is painted off `sev` alone, and a
    // sheet that read it wherever it found it would tint one register the whole app refuses
    // to grade.
    expect(findingSheetModel("secrets", wireRow("secrets", { severity: "CRITICAL" })).sev).toBe("");
  });

  it("names no lifecycle state row on secrets — that register ships no status column", () => {
    const model = findingSheetModel("secrets", wireRow("secrets"));
    const labels = model.sections.flatMap((s) => s.rows.map((r) => r.label));
    expect(labels).not.toContain("State");
    expect(labels).not.toContain("Age");
    // What it does carry instead: the four events that are genuinely dated on this register.
    expect(labels).toEqual(expect.arrayContaining([
      "Left HEAD", "Credential state", "Last checked", "Observed dead",
    ]));
  });

  it("uses the credential's own state as the header chip, with 'never checked' as its own answer", () => {
    const live = findingSheetModel("secrets", wireRow("secrets", { validation_state: "VALID" }));
    expect(live.chips[0].text).toBe("Live");
    const dead = findingSheetModel("secrets", wireRow("secrets", { validation_state: "INVALID" }));
    expect(dead.chips[0].text).toBe("Dead");
    for (const blank of [null, "", "UNKNOWN"]) {
      const unchecked = findingSheetModel("secrets", wireRow("secrets", { validation_state: blank }));
      expect(unchecked.chips[0].text, JSON.stringify(blank)).toBe("Never checked");
    }
    const failed = findingSheetModel("secrets", wireRow("secrets", { validation_state: "ERROR" }));
    expect(failed.chips[0].text).toBe("Check failed");
  });

  it("the secrets branch of the source names no severity identifier, class or helper", () => {
    // SHAPED LIKE `test/pagesLit.test.js`'s gate 4, deliberately, and this started out as a
    // blanket /sev/i over the branch. That version failed on prose: the Confidence row's tip
    // says the grade "is not a severity and not a check", which is the sentence a reader most
    // needs on a register whose confidence and validation state are two different axes. Gate 4
    // does not ban the WORD either — secrets.js's own header argues at length about severity —
    // it bans the identifiers, classes and helpers that would put a severity mark on screen.
    // A test that made the honest sentence unwritable would be enforcing a rule nobody holds.
    const start = CODE.indexOf("function secretsSections(");
    expect(start).toBeGreaterThan(-1);
    // To the function's own closing brace at column 0 — not to the next declaration, which
    // would sweep `findingSheetModel`'s `sev:` key into the branch and fail on the very line
    // that implements this rule.
    const end = CODE.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    const branch = CODE.slice(start, end);
    expect(branch).not.toMatch(/\bsev-[A-Za-z]/);
    expect(branch).not.toMatch(/severity-[a-z]/i);
    expect(branch).not.toMatch(/sevBadge|sevEntries|sevSegmentBar|sevKeyRow|sevkey|sev-pill/i);
    // No severity FIELD is read off the row and none is written into the model, which is the
    // claim the branch actually has to keep. `r.severity` in either direction fails here.
    //
    // PERTURBATION (run 2026-09-06, then reverted): one `row("Severity", textOf(r.severity))`
    // added to `secretsSections`. THREE cases failed, which is the point of keeping all three
    // — the source sweep below, the serialized-output case after it, and the Proxy case at the
    // top of this file ("secrets read a column it was never sent: severity"), because
    // `REGISTER_ROW_COLUMNS.secrets` has no such column to read in the first place.
    expect(branch).not.toMatch(/\.severity\b|\bsev\s*:/);
  });

  it("no severity key survives into the secrets model's serialized output", () => {
    // The output half of gate 4's own pair. A key named severity at any depth would be a
    // severity axis on a register that refuses to have one, whatever the source looked like.
    const json = JSON.stringify(findingSheetModel("secrets", wireRow("secrets")));
    expect(json).not.toMatch(/"severity"/i);
    expect(json).not.toMatch(/\bsev-[A-Za-z]/);
  });
});

// =========================================================================================
//  3. The provenance word, and what stands beside it
// =========================================================================================

describe("the death side of the clock is a word plus a measurement, never one date", () => {
  const stateRow = (model) =>
    model.sections.flatMap((s) => s.rows).find((r) => r.label === "State");

  it("a disappearance-resolved row reads 'Gone by' and carries the bound in its tip", () => {
    const model = findingSheetModel("sca", wireRow("sca", {
      status: "RESOLVED", resolution_src: "disappeared",
    }));
    expect(stateRow(model).value).toBe("Gone by");
    expect(stateRow(model).help).toMatch(/upper bound, not a measurement/);
    expect(model.chips[0].text).toBe("Gone by");
  });

  it("an API-reported resolution reads 'Resolved', and an open row reads 'Open'", () => {
    const api = findingSheetModel("sca", wireRow("sca", {
      status: "RESOLVED", resolution_src: "api",
    }));
    expect(stateRow(api).value).toBe("Resolved");
    const open = findingSheetModel("sca", wireRow("sca", {
      status: "OPEN", resolution_src: null, reopened_count: 0,
    }));
    expect(stateRow(open).value).toBe("Open");
  });

  it("a reopened row says so rather than reading as one that never left", () => {
    const model = findingSheetModel("sast", wireRow("sast", {
      status: "OPEN", resolution_src: null, reopened_count: 2,
    }));
    expect(stateRow(model).value).toBe("Returned");
    const labels = model.sections.flatMap((s) => s.rows.map((r) => r.label));
    expect(labels).toContain("Reopened");
  });

  it("says a code finding has no resolution date, in the sheet's own caveat", () => {
    const model = findingSheetModel("sast", wireRow("sast"));
    expect(model.caveat).toMatch(/No resolution date is recorded for code findings/);
    // And the other two do not borrow that sentence: SCA and secrets both have registers
    // where an observed resolution date is possible, so claiming otherwise would be a
    // different lie from the one it prevents.
    expect(findingSheetModel("sca", wireRow("sca")).caveat)
      .not.toMatch(/No resolution date is recorded/);
    expect(findingSheetModel("secrets", wireRow("secrets")).caveat)
      .not.toMatch(/No resolution date is recorded/);
  });
});

// =========================================================================================
//  4. Absence, and the credential value
// =========================================================================================

describe("an absent field is a dash, never a confident value", () => {
  it("a wholly empty row renders no null, no undefined, no NaN and no zero-by-cast", () => {
    for (const scope of SCOPES) {
      const empty = { [REGISTER_ROW_KEY]: null };
      for (const col of REGISTER_ROW_COLUMNS[scope]) empty[col] = null;
      // THE VALUES ONLY. The prose beside them says the word "null" on purpose — the SCA
      // caveat explains that Wiz returns null for a signal it never evaluated, and the
      // exploitation tips repeat it — so sweeping the whole model would fail on the sentence
      // that states the rule this case is checking.
      const values = findingSheetModel(scope, empty).sections
        .flatMap((s) => s.rows)
        // A tri row carries no string at all — its state IS the null, and `triCell` renders
        // the three answers. Stringifying it here would be the very cast this case forbids.
        .filter((r) => r.kind !== "tri")
        .map((r) => String(r.value));
      const text = values.join(" | ");
      expect(text, scope).not.toMatch(/\bnull\b|\bundefined\b|NaN/);
      // `Number(null)` is 0 and finite: an age or an EPSS of "0.0 d" / "0.0%" here would be
      // that cast, not a measurement.
      expect(text, scope).not.toMatch(/0\.0 d|0\.0%/);
      // And the tri rows keep their null rather than being flattened into a "No".
      for (const r of findingSheetModel(scope, empty).sections.flatMap((s) => s.rows)) {
        if (r.kind === "tri") expect(r.tri, `${scope}.${r.label}`).toBeNull();
      }
    }
  });

  it("a missing file path never becomes 'null:null' in the location line", () => {
    for (const scope of ["sast", "secrets"]) {
      const model = findingSheetModel(scope, wireRow(scope, { file_path: null, start_line: null }));
      const loc = model.sections.flatMap((s) => s.rows).find((r) => r.label === "File and line");
      expect(loc.value).toBe("—");
    }
  });

  it("offers a copy button for the id, and for the location where there is one", () => {
    expect(findingSheetModel("sca", wireRow("sca")).copies.map((c) => c.label))
      .toEqual(["Copy id"]);
    for (const scope of ["sast", "secrets"]) {
      const copies = findingSheetModel(scope, wireRow(scope)).copies;
      expect(copies.map((c) => c.label)).toEqual(["Copy id", "Copy location"]);
      expect(copies[1].text).toBe("src/app/main.py:42");
    }
  });

  it("names no denied field — a secret's value has no way onto this sheet", () => {
    expect(CODE).not.toMatch(/\bsnippet\b|\bvalidationDetails\b/);
    for (const scope of SCOPES) {
      expect(JSON.stringify(findingSheetModel(scope, wireRow(scope))))
        .not.toMatch(/snippet|validationDetails/i);
    }
  });

  it("gives the row button a name that says what opens", () => {
    expect(findingRowLabel("sca", wireRow("sca"))).toBe("CVE-2026-0001, acme/api, open details");
    expect(findingRowLabel("secrets", { identifier: null, repo_name: null }))
      .toBe("Secrets, open details");
  });
});
