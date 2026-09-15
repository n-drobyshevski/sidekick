// The issue half-life, against hand-built ledger rows.
//
// FOUR RULES, EACH WITH THE DEFECTIVE REWRITE THAT WOULD BREAK IT REPRODUCED INLINE. A guard
// that fires on nothing is decorative, so every one of them is perturbed here: the epsilon,
// the clock's start date, the reopen exclusion and the refusal to cast an absent date. Each
// perturbation is a named `it` that runs the WRONG implementation against the same fixture
// and asserts the wrong answer it produces — so a later "simplification" that reintroduces it
// fails the rule's own test, and the reason is already written down beside it.
//
// The dry-run fixture's end of this is `test/issueHalfLifeApi.test.ts`; this file never boots
// a server.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  CROSSING_EPSILON,
  issueHalfLife,
  kaplanMeier,
  kmCurve,
  kmQuantileFromCurve,
  ledgerObservations,
  type KMPoint,
  type SurvivalLedgerRow,
} from "../src/domain/issueSurvival";

const DAY_MS = 86_400_000;
const EPOCH = Date.parse("2026-01-01T00:00:00Z");

/** An ISO instant `days` after the fixture epoch. */
function at(days: number): string {
  return new Date(EPOCH + days * DAY_MS).toISOString();
}

/** A ledger row, defaulted to the ordinary shape: first episode, still open. */
function row(over: Partial<SurvivalLedgerRow>): SurvivalLedgerRow {
  return {
    firstSeenAt: at(0),
    lastSeenAt: at(1),
    disappearedAt: null,
    episode: 1,
    ...over,
  };
}

describe("the crossing epsilon, on CLAUDE.md's own example", () => {
  // Ten events at t = 1..10, nothing censored. Exact arithmetic gives S(k) = (10-k)/10, so
  // the p90 (S <= 0.10) is 9 and the median (S <= 0.5) is 5.
  const TEN = Array.from({ length: 10 }, (_, i) => ({ t: i + 1, event: true }));

  it("reports p90 = 9 and median = 5", () => {
    const km = kaplanMeier(TEN);
    expect(km.p90).toBe(9);
    expect(km.median).toBe(5);
    expect(km.events).toBe(10);
    expect(km.censored).toBe(0);
    expect(km.total).toBe(10);
    // A known median publishes no lower bound: a figure beside its own floor invites a
    // comparison that means nothing.
    expect(km.medianLowerBound).toBeNull();
  });

  it("PERTURBATION: a bare `s <= threshold` reports 10, because the ULP leans the wrong way",
    () => {
      const curve = kmCurve(TEN.map((o) => o.t), TEN.map((o) => o.t));
      const bare = (c: readonly KMPoint[], q: number): number | null => {
        const threshold = 1 - q;
        for (const p of c) if (p.s <= threshold) return p.t; // the defective comparison
        return null;
      };
      // The two representation errors lean opposite ways, which is the whole finding: the
      // running product lands ABOVE 0.1 and the threshold lands BELOW it.
      const s9 = curve.filter((p) => p.t === 9)[0]!.s;
      expect(s9).toBeGreaterThan(1 - 0.9);
      expect(s9 - 0.1).toBeLessThan(CROSSING_EPSILON);
      expect(bare(curve, 0.9)).toBe(10);
      expect(kmQuantileFromCurve(curve, 0.9)).toBe(9);
    });

  it("is a tolerance, not a shift — a curve genuinely above the threshold still misses", () => {
    // Five events, four censored well beyond them: S never falls near 0.5, and no epsilon of
    // this size may rescue it. Without this the epsilon could be any size and nothing here
    // would notice.
    const obs = [
      ...Array.from({ length: 5 }, (_, i) => ({ t: i + 1, event: true })),
      ...Array.from({ length: 20 }, () => ({ t: 40, event: false })),
    ];
    const km = kaplanMeier(obs);
    expect(km.median).toBeNull();
    expect(km.medianLowerBound).toBe(40);
  });
});

describe("failure of absence: a curve that never reaches half publishes the bound, not a number",
  () => {
    it("all censored — no median, and the lower bound is the longest observed life", () => {
      const km = kaplanMeier([
        { t: 3, event: false },
        { t: 91.5, event: false },
        { t: 12, event: false },
      ]);
      expect(km.median).toBeNull();
      expect(km.p90).toBeNull();
      expect(km.curve).toEqual([]);
      expect(km.medianLowerBound).toBe(91.5);
      expect(km.events).toBe(0);
      expect(km.censored).toBe(3);
      expect(km.total).toBe(3);
    });

    it("an empty ledger measures nothing and claims nothing", () => {
      const km = issueHalfLife([]);
      expect(km.median).toBeNull();
      expect(km.medianLowerBound).toBeNull();
      expect(km.total).toBe(0);
      expect(km.asOf).toBeNull();
    });
  });

describe("the clock runs from the ledger's own first sighting", () => {
  const rows: SurvivalLedgerRow[] = [
    // A row born a year before this register first saw it — the `iss-gone-NN` shape the
    // dry-run fixture seeds, which is the only reason a wrong start date is visible at all.
    row({ firstSeenAt: at(0), lastSeenAt: at(10), disappearedAt: at(10) }),
    row({ firstSeenAt: at(2), lastSeenAt: at(6) }),
  ];

  it("dates an event by disappearedAt and a censored row by its LAST SIGHTING", () => {
    const { obs, returnedExcluded, unmeasurable } = ledgerObservations(rows);
    expect(obs).toEqual([{ t: 10, event: true }, { t: 4, event: false }]);
    expect(returnedExcluded).toBe(0);
    expect(unmeasurable).toBe(0);
  });

  it("PERTURBATION: starting the clock at Wiz's createdAt inflates the same row by 365 days",
    () => {
      // The defective builder, inline: it reads a field the real module never touches.
      type WithCreated = SurvivalLedgerRow & { createdAt: string };
      const withCreated: WithCreated[] = rows.map((r) => ({
        ...r,
        createdAt: new Date(Date.parse(r.firstSeenAt) - 365 * DAY_MS).toISOString(),
      }));
      const defective = withCreated.map((r) => ({
        t: (Date.parse(r.disappearedAt ?? r.lastSeenAt) - Date.parse(r.createdAt)) / DAY_MS,
        event: r.disappearedAt !== null,
      }));
      expect(defective[0]!.t).toBe(375);
      expect(defective[1]!.t).toBe(369);
      // The real reading, off the same rows, over the same two facts.
      expect(ledgerObservations(withCreated).obs.map((o) => o.t)).toEqual([10, 4]);
    });

  it("never reads createdAt, in source", () => {
    // The perturbation above proves the arithmetic; this proves the field is not reachable at
    // all — a later refactor could reintroduce it in a branch no fixture happens to cover.
    // Comments stripped first, BOTH kinds: the module's own header explains at length why it
    // does not read Wiz's created date or the wall clock, and a scan that kept the prose would
    // fail on the explanation instead of on the code.
    const src = readFileSync(
      new URL("../src/domain/issueSurvival.ts", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/createdAt/);
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});

describe("failure of presence: a reopened row is excluded AND counted", () => {
  const rows = [
    row({ firstSeenAt: at(0), lastSeenAt: at(4), disappearedAt: at(4) }),
    // Episode 2: the ledger cleared `disappearedAt` and bumped the count without stamping
    // when the new episode began, so neither of its two dates describes the current run.
    row({ firstSeenAt: at(0), lastSeenAt: at(30), episode: 2 }),
    row({ firstSeenAt: at(1), lastSeenAt: at(5) }),
  ];

  it("leaves the returned row out of the estimate and says how many left", () => {
    const km = issueHalfLife(rows);
    expect(km.returnedExcluded).toBe(1);
    expect(km.total).toBe(2);
    expect(km.events).toBe(1);
    expect(km.censored).toBe(1);
  });

  it("PERTURBATION: measuring it anyway adds a 30-day open run the ledger never observed",
    () => {
      const defective = rows.map((r) => ({
        t: (Date.parse(r.disappearedAt ?? r.lastSeenAt) - Date.parse(r.firstSeenAt)) / DAY_MS,
        event: r.disappearedAt !== null,
      }));
      const km = kaplanMeier(defective);
      expect(km.total).toBe(3);
      // The reopened row's whole history, gaps included, enters as one censored observation at
      // 30 days. It is the longest, so it holds the risk set open past the one real event and
      // the curve stops at S = 2/3 — and the page, which had a measured half-life of 4 days,
      // now says "at least 30" instead. The defect makes the figure LOOK more conservative,
      // which is the worst direction for one nobody would think to re-derive.
      expect(km.median).toBeNull();
      expect(km.medianLowerBound).toBe(30);
      const real = issueHalfLife(rows);
      expect(real.median).toBe(4);
      expect(real.medianLowerBound).toBeNull();
    });
});

describe("absent is never zero: an unreadable date is dropped and counted", () => {
  const rows = [
    row({ firstSeenAt: at(0), lastSeenAt: at(3) }),
    row({ firstSeenAt: "", lastSeenAt: at(3) }),
    row({ firstSeenAt: at(0), lastSeenAt: at(3), disappearedAt: "not-a-date" }),
    row({ firstSeenAt: at(0), lastSeenAt: null as unknown as string }),
    row({ firstSeenAt: at(0), lastSeenAt: at(3), episode: null as unknown as number }),
  ];

  it("measures only the row it could read", () => {
    const km = issueHalfLife(rows);
    expect(km.total).toBe(1);
    expect(km.unmeasurable).toBe(4);
    expect(km.censored).toBe(1);
    expect(km.medianLowerBound).toBe(3);
  });

  it("PERTURBATION: a `Number(x) || 0` fold reads each of them as an epoch-0 lifetime", () => {
    // `Number(null)` is 0 AND finite; `Number("")` is 0; `new Date(0)` is 1970. The fold below
    // is the tempting one-liner, and every refused row comes back as a ~20,600-day event.
    const defective = rows.map((r) => ({
      t: ((Number(new Date(r.lastSeenAt as string).getTime()) || 0)
        - (Number(new Date(r.firstSeenAt).getTime()) || 0)) / DAY_MS,
      event: false,
    }));
    // Two of them, leaning opposite ways: an unparsable START date puts the birth at 1970 and
    // the lifetime at +56 years, while an absent END date puts the death there and the
    // lifetime at -56 years. Neither is a measurement, and only one of them even looks wrong.
    const blownUp = defective.filter((o) => Math.abs(o.t) > 20_000);
    expect(blownUp.length).toBe(2);
    expect(blownUp.filter((o) => o.t > 0).length).toBe(1);
    expect(blownUp.filter((o) => o.t < 0).length).toBe(1);
    // And the real reading refuses both of them before any arithmetic.
    expect(issueHalfLife(rows).medianLowerBound).toBe(3);
  });

  it("refuses a departure dated before the first sighting rather than calling it zero days",
    () => {
      const km = issueHalfLife([
        row({ firstSeenAt: at(10), lastSeenAt: at(10), disappearedAt: at(2) }),
      ]);
      expect(km.total).toBe(0);
      expect(km.unmeasurable).toBe(1);
    });
});

describe("asOf is derived from the rows, not from a clock", () => {
  it("takes the newest sighting or departure across EVERY row, reopened ones included", () => {
    const km = issueHalfLife([
      row({ firstSeenAt: at(0), lastSeenAt: at(3), disappearedAt: at(3) }),
      row({ firstSeenAt: at(0), lastSeenAt: at(9), episode: 2 }),
      row({ firstSeenAt: at(0), lastSeenAt: at(5) }),
    ]);
    expect(km.asOf).toBe(at(9).replace(".000Z", "Z"));
  });

  it("is stable across repeated calls — the whole reason no clock is read", () => {
    const rows = [row({ firstSeenAt: at(0), lastSeenAt: at(3) })];
    expect(issueHalfLife(rows)).toEqual(issueHalfLife(rows));
  });
});
