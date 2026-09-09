// What the issue sheet is allowed to say about one ledger row.
//
// THE RULE THIS FILE EXISTS FOR, from `src/domain/issueLedger.ts`'s own header: Wiz never
// tells this register that an issue was fixed. The query gate is `status: [OPEN,
// IN_PROGRESS]`, so a remediated row is dropped before a `resolvedAt` could be read, and
// what the ledger observes is an ABSENCE. `disappearedAt` is an UPPER BOUND whose error is
// the interval between two syncs — "gone by 4 Sep", never "resolved 4 Sep". The two
// sentences are the same width on screen and opposite claims, so the provenance has to
// travel in the WORD.
//
// Both failure kinds are named in the describes below, in CLAUDE.md's vocabulary:
//
//   - a FAILURE OF PRESENCE is the register's own dates missing from a sheet that has them —
//     the state before this package, where `getIssueDetail` returned null for a departed row
//     and the sheet said "Issue not found";
//   - a FAILURE OF ABSENCE is a departure printed as though something reported it — a
//     disappearance relabelled "Resolved", or an episode conjured out of a stringified `2`.
//
// The second kind is the dangerous one here, exactly as it is one register over: it does not
// look like an error, it looks like a remediation programme.
//
// Plain .js, not .ts, for the reason `helpContent.test.js`'s header writes out: tsconfig has
// no allowJs, so a .ts test importing a client .js module fails `tsc --noEmit` and vitest
// never runs.

import { describe, expect, it } from "vitest";

import {
  PROVENANCE, PROVENANCE_HELP, PROVENANCE_KIND, PROVENANCE_LABEL,
  issueLifecycleModel, provenance,
} from "../src/client/js/issueLifecycle.js";

/** The eight fields `api.ts`'s `PublicIssueLedger` projection actually ships. */
const PUBLIC_PROJECTION = [
  "firstSeenAt", "firstSeenSync", "lastSeenAt", "lastSeenSync",
  "disappearedAt", "resolutionSrc", "episode", "registerScope",
];

/**
 * The only two fields of the ISSUE the model may touch.
 *
 * `resolvedAt` for the Facts pane's one row; `status` allowed but not required — a subset
 * assertion, so reading fewer is fine and reading a third is not. What the list keeps OUT is
 * the point: `createdAt` above all. On a departed row the seed deliberately sets Wiz's
 * `createdAt` a full 365 days before the ledger's `firstSeenAt` (`sampleData.ts`'s
 * `SEED_GONE_CREATED_LEAD_MS`), so a model that reached for it would print a lifetime nobody
 * measured and every fixture would still look plausible.
 */
const ISSUE_FIELDS_ALLOWED = ["status", "resolvedAt"];

const OPEN_ROW = {
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  firstSeenSync: "sync-sample-01",
  lastSeenAt: "2026-09-08T00:00:00.000Z",
  lastSeenSync: "sync-sample-08",
  disappearedAt: null,
  resolutionSrc: null,
  episode: 1,
  registerScope: "wct-id-1998",
};

const GONE_ROW = {
  ...OPEN_ROW,
  lastSeenAt: "2026-09-04T00:00:00.000Z",
  disappearedAt: "2026-09-05T00:00:00.000Z",
  resolutionSrc: "disappeared",
};

const RETURNED_ROW = {
  ...OPEN_ROW,
  disappearedAt: null,
  resolutionSrc: "reopened",
  episode: 2,
};

/** An issue carrying a Wiz resolution date, to give the withheld row something to withhold. */
const ISSUE_WITH_RESOLVED = { status: "OPEN", resolvedAt: "2026-09-05T00:00:00.000Z" };

/** Every value the model would print, flattened, so a sweep can read the whole section. */
function printedValues(model) {
  const out = [];
  for (const row of model.rows) out.push(String(row.label), String(row.value));
  if (model.chip) out.push(String(model.chip.text));
  if (model.wizResolved) out.push(String(model.wizResolved.label), String(model.wizResolved.value));
  return out;
}

/** A row that records which of its keys anything reads. */
function watched(row, seen) {
  return new Proxy(row, {
    get(target, key) {
      if (typeof key === "string") seen.add(key);
      return target[key];
    },
  });
}

describe("the model reads the projection and nothing else", () => {
  it("touches only fields getIssueDetail actually ships on `ledger`", () => {
    const seen = new Set();
    issueLifecycleModel({}, watched(GONE_ROW, seen));
    const extra = [...seen].filter((k) => PUBLIC_PROJECTION.indexOf(k) < 0);
    expect(extra, "keys read off the ledger row that the projection does not carry").toEqual([]);
  });

  // MEASURED, and the number is not the one the package brief assumed. The brief asked for
  // "≥ 5 keys read", which is a guard against a subset assertion that passes because the
  // model reads almost nothing. On ANY SINGLE ROW the model reads FOUR: the two provenance
  // discriminants short-circuit each other — a bounded row never reaches `episode`, and a
  // returned row never reaches `disappearedAt`. The union over the three branches is five.
  // That is the honest form of the claim, so it is the one asserted, with the shortfall
  // recorded in the `it` below rather than rounded away.
  it("reads five of the eight across the three branches — not one field, and not by luck", () => {
    const union = new Set();
    for (const row of [OPEN_ROW, GONE_ROW, RETURNED_ROW]) {
      issueLifecycleModel({}, watched(row, union));
    }
    expect([...union].sort(), "ledger keys read across every branch").toEqual([
      "disappearedAt", "episode", "firstSeenAt", "lastSeenAt", "resolutionSrc",
    ]);
    const perRow = new Set();
    issueLifecycleModel({}, watched(GONE_ROW, perRow));
    expect([...perRow].length, "one bounded row: " + [...perRow].join(", ")).toBe(4);
  });

  /**
   * A FINDING, pinned rather than fixed: three of the eight projected fields reach the
   * client and are drawn nowhere.
   *
   * `firstSeenSync` and `lastSeenSync` name the two syncs the dates came from, and
   * `registerScope` names the question that sync ASKED — which is what would let a reader
   * see that a row's dates were recorded under a different category scope than the one in
   * force today. All three are on the payload because they are what makes the dates
   * auditable, and none of them has a call site yet. Pinned here so that adding one is a
   * deliberate act and removing them from the projection is a visible one.
   */
  it("FINDING: three projected fields have no call site on the sheet yet", () => {
    const union = new Set();
    for (const row of [OPEN_ROW, GONE_ROW, RETURNED_ROW]) {
      issueLifecycleModel({}, watched(row, union));
    }
    const undrawn = PUBLIC_PROJECTION.filter((k) => !union.has(k));
    expect(undrawn.sort()).toEqual(["firstSeenSync", "lastSeenSync", "registerScope"]);
  });

  it("touches only `status` / `resolvedAt` on the issue, and never Wiz's createdAt", () => {
    const seen = new Set();
    // The exact shape the seed produces for a departed row: Wiz's created date sits a year
    // before this register ever saw it.
    const issue = watched({
      status: "OPEN",
      resolvedAt: null,
      createdAt: "2025-08-01T00:00:00.000Z",
      dueAt: "2026-09-20T00:00:00.000Z",
    }, seen);
    issueLifecycleModel(issue, GONE_ROW);
    const extra = [...seen].filter((k) => ISSUE_FIELDS_ALLOWED.indexOf(k) < 0);
    expect(extra, "issue keys read outside the allowed pair").toEqual([]);
  });
});

describe("failure of absence: a departure must not read as a resolution", () => {
  it("a disappeared row reads 'Gone by' and never the word Resolved", () => {
    const model = issueLifecycleModel(ISSUE_WITH_RESOLVED, GONE_ROW);
    const labels = model.rows.map((r) => r.label);
    expect(labels).toContain("Gone by");
    expect(labels).not.toContain("Resolved");
    expect(model.wizResolved, "Wiz's resolvedAt is withheld on a bounded row").toBeNull();
    for (const v of printedValues(model)) {
      expect(v, "printed value").not.toContain("Resolved");
    }
  });

  it("the Gone by row carries the DISAPPEARANCE date, not the last sighting", () => {
    const model = issueLifecycleModel(ISSUE_WITH_RESOLVED, GONE_ROW);
    const gone = model.rows.filter((r) => r.label === "Gone by")[0];
    // 2026-09-05, the sync that first missed it — the row was last SEEN on 09-04, and the
    // gap between the two IS the error bar on the date.
    expect(gone.value).toContain("2026-09-05");
    expect(gone.help).toEqual({ term: "disappearance" });
  });

  // PERTURBATION. The defective rewrite is the obvious simplification: drop the gate and let
  // the Facts pane print `issue.resolvedAt` whenever the payload has one, the way it did
  // before this package. Reproduced inline rather than described in a comment, so the guard
  // is shown biting on the one input where the two readings differ.
  it("PERTURBATION: printing resolvedAt unconditionally labels a disappearance a resolution", () => {
    const defective = (issue, ledger) => {
      const real = issueLifecycleModel(issue, ledger);
      const at = issue ? issue.resolvedAt : null;
      // The one line removed: no `provenance(ledger) === BOUNDED` gate before the row.
      return { ...real, wizResolved: at ? { label: "Resolved", value: at } : null };
    };
    const broken = defective(ISSUE_WITH_RESOLVED, GONE_ROW);
    expect(broken.wizResolved).not.toBeNull();
    expect(broken.wizResolved.label).toBe("Resolved");
    // Both claims about the same row, in the same sheet: a date this register bounded by
    // absence, printed under a word that says Wiz reported it.
    expect(broken.rows.map((r) => r.label)).toContain("Gone by");
    expect(
      issueLifecycleModel(ISSUE_WITH_RESOLVED, GONE_ROW).wizResolved,
      "the real model withholds exactly the row the defective one prints",
    ).toBeNull();
  });

  it("a row the ledger never dated by disappearance still prints Wiz's date", () => {
    // The other half of the gate. Withholding on every row would be a different defect,
    // and one a test that only checked the bounded case would never see.
    expect(issueLifecycleModel(ISSUE_WITH_RESOLVED, OPEN_ROW).wizResolved).not.toBeNull();
    expect(issueLifecycleModel(ISSUE_WITH_RESOLVED, RETURNED_ROW).wizResolved).not.toBeNull();
    expect(issueLifecycleModel(ISSUE_WITH_RESOLVED, null).wizResolved).not.toBeNull();
  });
});

describe("failure of absence: an episode is a number a sync recorded", () => {
  it("episode 2 reads Returned, with the count in the row", () => {
    const model = issueLifecycleModel({}, RETURNED_ROW);
    const returned = model.rows.filter((r) => r.label === "Returned")[0];
    expect(returned, "the returned row").toBeTruthy();
    expect(returned.value).toBe("Episode 2");
    expect(returned.help).toEqual({ term: "episode" });
    expect(provenance(RETURNED_ROW)).toBe(PROVENANCE.RETURNED);
    expect(model.chip.text).toBe("Returned");
  });

  it('episode "2" as a STRING is refused — no Returned row, no returned chip', () => {
    // `Number("2") > 1` is true, which is exactly how a cast-first rewrite would read a
    // stringified row as a re-detection no sync ever recorded. The `typeof` gate is where
    // the refusal bites; `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are
    // all 0 and all finite, so none of them reaches the comparison either.
    const model = issueLifecycleModel({}, { ...RETURNED_ROW, episode: "2" });
    expect(model.rows.map((r) => r.label)).not.toContain("Returned");
    expect(provenance({ ...RETURNED_ROW, episode: "2" })).toBe(PROVENANCE.OPEN);
  });

  it("episode 1 is not a return, and neither is an absent one", () => {
    expect(issueLifecycleModel({}, OPEN_ROW).rows.map((r) => r.label)).not.toContain("Returned");
    const noEpisode = { ...OPEN_ROW };
    delete noEpisode.episode;
    expect(issueLifecycleModel({}, noEpisode).rows.map((r) => r.label)).not.toContain("Returned");
  });

  it("a row that returned and left again reads Gone by, not Returned", () => {
    // Both conditions hold at once. The sheet answers what the row's state IS; it does not
    // print two lifecycle verdicts and leave the reader to rank them.
    const model = issueLifecycleModel({}, { ...GONE_ROW, episode: 3 });
    const labels = model.rows.map((r) => r.label);
    expect(labels).toContain("Gone by");
    expect(labels).not.toContain("Returned");
  });
});

describe("failure of presence: what the section says when there is nothing to say", () => {
  it("a null ledger yields no chip and no rows", () => {
    const model = issueLifecycleModel({ status: "OPEN" }, null);
    expect(model.chip).toBeNull();
    expect(model.rows).toEqual([]);
    expect(provenance(null)).toBeNull();
    expect(provenance(undefined)).toBeNull();
  });

  it("an empty ledger row prints no null, undefined, NaN or 0", () => {
    const model = issueLifecycleModel({}, {});
    expect(model.rows.length, "the two sighting rows still stand").toBe(2);
    for (const v of printedValues(model)) {
      expect(v, "printed value").not.toMatch(/null|undefined|NaN/);
      expect(v, "printed value").not.toMatch(/(^|\W)0(\W|$)/);
    }
  });

  it("an open row prints both sightings and nothing after them", () => {
    const model = issueLifecycleModel({}, OPEN_ROW);
    expect(model.rows.map((r) => r.label)).toEqual([
      "First seen by this register", "Last seen",
    ]);
    expect(model.rows[0].help).toEqual({ term: "first-seen" });
    expect(model.rows[0].value).toContain("2026-08-01");
    expect(model.rows[1].value).toContain("2026-09-08");
  });
});

describe("the vocabulary", () => {
  it("names three provenances and no OBSERVED", () => {
    // This ledger can never receive an API resolution date (issueLedger.ts:17-24), so an
    // OBSERVED member would be a state nothing could produce, sitting in a lookup table
    // beside three that can. gas's register has five members because its rows really do
    // carry `resolution_src: "api"`.
    expect(Object.keys(PROVENANCE).sort()).toEqual(["BOUNDED", "OPEN", "RETURNED"]);
    expect(Object.keys(PROVENANCE)).not.toContain("OBSERVED");
  });

  it("gives every provenance a label, a tone and a sentence", () => {
    for (const p of Object.values(PROVENANCE)) {
      expect(PROVENANCE_LABEL[p], p).toBeTruthy();
      expect(PROVENANCE_KIND[p], p).toBeTruthy();
      expect(PROVENANCE_HELP[p].length, p).toBeGreaterThan(40);
    }
  });

  it("never tints a bounded date as a success", () => {
    expect(PROVENANCE_KIND[PROVENANCE.BOUNDED]).toBe("warn");
    expect(PROVENANCE_KIND[PROVENANCE.BOUNDED]).not.toBe("ok");
  });

  it("the bounded chip carries the date beside the word", () => {
    const model = issueLifecycleModel({}, GONE_ROW);
    expect(model.chip.kind).toBe("warn");
    expect(model.chip.text.startsWith("Gone by ")).toBe(true);
    expect(model.chip.text).toContain("2026-09-05");
  });
});
