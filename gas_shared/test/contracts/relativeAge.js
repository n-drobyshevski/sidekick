// `relativeAge` — the one clock-relative label ("3 hours ago" / "2 days ago" / "just now")
// across all three apps, registered here so the pin is against the module every rail and
// every Scan History caption actually calls, not a description of it.
//
// THREE SHAPES DRIFTED INTO ONE. `pages/history.js` (gas) had a private just-now/min/hour(s)/
// day(s) helper; both siblings had a second, coarser inline calculation (days only, gated at
// `age >= 2`) in their rail caption. P8 promotes the first (the one with real granularity)
// into `gas_shared/ui/figures.js` and repoints every caller.
//
// THE REFUSAL IS THE PART WORTH PINNING DIRECTLY, AND IT IS NARROWER THAN IT LOOKS.
// `Date.parse` is, on its own, an unusually well-behaved cast: `Date.parse(null)`,
// `Date.parse(undefined)`, `Date.parse(false)`, `Date.parse([])` and `Date.parse({})` are
// ALL `NaN` (verified — none of them stringify to anything `Date.parse` accepts), so a bare
// `Date.now() - Date.parse(ts)` guarded only by `Number.isNaN(ms)` was already safe against
// every one of those, which is exactly the shape the old gas/history.js copy had. The trap
// this function actually has to refuse is `Number()`, not `Date.parse()` — because this
// version of `relativeAge` accepts an already-numeric epoch (`typeof ts === "number"`)
// directly, the tempting "simplify the two branches into one" rewrite is
// `const t = Number(ts); if (!Number.isFinite(t)) return absentText;` — and `Number(null)`,
// `Number("")`, `Number([])` and `Number(false)` are all `0` AND finite, so that rewrite reads
// every one of them as epoch 0 (1 Jan 1970) and prints a confident "N days ago" instead of the
// absent dash. That is CLAUDE.md's own two-bitten bug, one constructor away from where it bit
// before, and the perturbation below reproduces it rather than asserting it from the comment.

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} ctx.relativeAge  the module under test, handed over rather than imported
 *   by a fixed relative path — this contract is registered from three different depths
 *   (`gas/test/`, `gas_ai/test/`, `gas_devsecops/test/`) and a hard-coded
 *   "../../gas_shared/ui/figures.js" would silently resolve to nothing from the wrong one.
 */
export function registerRelativeAgeContract(ctx) {
  const { describe, it, expect, app, relativeAge } = ctx;

  describe(app + ": relativeAge() refuses null/undefined/blank BEFORE the cast", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["an object", {}],
      ["an array", []],
      ["false", false],
      ["true", true],
    ])("relativeAge(%s) is the absent dash, never \"just now\" or \"NaN … ago\"", (_label, input) => {
      expect(relativeAge(input)).toBe("—");
    });

    it("a non-empty string Date.parse cannot read gets the same absent dash, not \"NaN … ago\"", () => {
      expect(relativeAge("not-a-date")).toBe("—");
      expect(relativeAge("")).toBe("—");
    });

    // THE PERTURBATION. Reproduces the tempting one-branch rewrite inline (never applied to
    // figures.js itself — this proves the SHIPPED guard against the DEFECTIVE alternative,
    // both present at once) and shows it fails on exactly the inputs `num()`'s own header
    // warns about: `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all `0`
    // and finite, so `Number.isFinite` never reaches its refusal branch for any of them, and
    // each one reads as "epoch 0" — tens of thousands of days ago — rather than absent.
    it("PERTURBATION PROOF: a Number()-cast-first rewrite reads null/blank/[]/false as epoch 0, which this guard refuses", () => {
      function castFirstDefective(ts) {
        const t = Number(ts); // the exact anti-pattern: cast BEFORE refusing
        if (!Number.isFinite(t)) return "—";
        const ms = Date.now() - t;
        if (ms <= 0) return "just now";
        const min = Math.floor(ms / 60000);
        if (min < 1) return "just now";
        return `${min} min ago`;
      }
      for (const bad of [null, "", [], false]) {
        // The defective shape: none of these are refused — Number() casts them to a real,
        // finite 0 first, so every one prints an ancient "N min ago" instead of the dash.
        expect(castFirstDefective(bad), JSON.stringify(bad)).not.toBe("—");
        // The shipped guard: refused before any Number()/Date.parse() cast is attempted.
        expect(relativeAge(bad), JSON.stringify(bad)).toBe("—");
      }
    });

    it("a future timestamp reads as \"just now\", never as a negative age", () => {
      expect(relativeAge(new Date(Date.now() + 60 * 60 * 1000).toISOString())).toBe("just now");
      expect(relativeAge(Date.now() + 1)).toBe("just now");
      expect(relativeAge(Date.now())).toBe("just now"); // ms === 0: not future, not measurably past
    });

    it("a real past timestamp scales through minutes, hours and days", () => {
      const now = Date.now();
      expect(relativeAge(now - 30_000)).toBe("just now");
      expect(relativeAge(now - 5 * 60_000)).toBe("5 min ago");
      expect(relativeAge(now - 65 * 60_000)).toBe("1 hour ago");
      expect(relativeAge(now - 3 * 3_600_000)).toBe("3 hours ago");
      expect(relativeAge(now - 25 * 3_600_000)).toBe("1 day ago");
      expect(relativeAge(now - 2 * 86_400_000)).toBe("2 days ago");
    });

    it("accepts an ISO string the same way it accepts an epoch number", () => {
      const now = Date.now();
      expect(relativeAge(new Date(now - 3 * 3_600_000).toISOString())).toBe("3 hours ago");
    });
  });
}
