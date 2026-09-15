// THE ONE LINE UNDER THE HERO THAT SAYS WHAT WAS MEASURED — and, more to the point, what was
// never looked at.
//
// Every figure on Overview is computed over a population three things have already narrowed:
// the rows themselves, the severity gate THE LAST SCAN APPLIED, and the base Wiz filter the
// query carries on every page. A reader who does not know that reads "412 open" as a fact
// about the fleet rather than about a filtered slice of it.
//
// NOTHING HERE PRINTS A ZERO FOR WHAT WAS EXCLUDED, and that is the whole reason this is a
// function rather than a template literal in the page. The obvious version of this line counts
// the rows the gate kept out — but nothing counted them: a scan gated to CRITICAL/HIGH never
// fetched a MEDIUM row, so "0 below the gate" would be a measurement of a population nobody
// looked at. The words are "below the gate: not counted" (CLAUDE.md, "The Outside is
// everything the measurement kept out").
//
// Pure and lifted out of the page for the reason mttrPaintPlan.js, capacity.js and
// scanProgress.js already are: the interesting cases are payload shapes, not pixels — an old
// cached payload with no `population` block at all, a gate that arrived empty, a count that
// arrived null — and those are enumerable in node.

import { absentText, fmtCount, fmtDays, num } from "../../../../../gas_shared/ui/figures.js";

/** The separator between parts. One line, read left to right. */
const JOINER = " · ";

/**
 * A gate as WORDS, or null for "no gate was applied".
 *
 * `null`, `[]` and `""` all mean the same thing here — the scan looked at every severity — and
 * all three arrive in practice: `parseSeverities` returns null for a full or unparseable gate,
 * an older payload can carry the empty list, and a hand-written fixture can carry the empty
 * string. Refused BEFORE anything is joined, because `[].join(", ")` is `""` and an empty
 * string reads on screen as a gate whose severities went missing.
 *
 * THIS IS THE ONLY PLACE THAT REFUSAL LIVES, and that is deliberate rather than tidy. The
 * first draft ALSO tested the result for truthiness below (`gate ? … : …`), which meant
 * deleting the `kept.length` check here changed nothing: measured, the whole suite still
 * passed, because the empty string the defect produced was absorbed by the second test — the
 * "guard that fires on nothing" CLAUDE.md names. The caller now asks `=== null`, so there is
 * one refusal and perturbing it fails a test.
 */
function gateWords(gate) {
  if (!Array.isArray(gate)) return null;
  const kept = gate.filter((s) => typeof s === "string" && s.trim() !== "");
  return kept.length ? kept.join(", ") : null;
}

/**
 * The provenance line for the Overview hero: `{ text, parts }`, or null when the payload
 * cannot support one.
 *
 * Null rather than a partial sentence: a cached payload written before `population` existed
 * has no gate and no filter words, and a line reading "In scope 412" alone would state the
 * count as if it were the whole story — the exact reading this line exists to prevent.
 */
export function populationLine(insights) {
  const p = insights && typeof insights === "object" ? insights.population : null;
  if (!p || typeof p !== "object") return null;

  const parts = [];
  // fmtCount refuses null/undefined/""/[]/false before the cast and renders the em dash, so an
  // unmeasured count says "—" instead of the confident zero `Number(null)` would produce.
  parts.push(`In scope ${fmtCount(p.inScope)}`);

  const gate = gateWords(p.gate);
  parts.push(gate === null ? "gate: all severities" : `gate ${gate}`);

  for (const w of Array.isArray(p.filters) ? p.filters : []) {
    if (typeof w === "string" && w.trim() !== "") parts.push(w.trim());
  }

  // Only when a gate was actually applied is there anything below it to speak of — and what
  // there is, is unknown rather than none.
  if (gate !== null) parts.push("below the gate: not counted");

  return { text: parts.join(JOINER), parts };
}

/**
 * The caption under the SLA-window-consumed chart: the sentence naming what the bars mean and
 * WHAT THEY LEAVE OUT — or null when there is no block to caption.
 *
 * Two populations sit outside the bars and neither can be inferred from them. A finding at or
 * past its window has no tenth left to plot, so it is counted and not drawn; a finding with no
 * age or no target for its severity was never measurable against a deadline at all. Both would
 * otherwise be invisible — the bars would still add up, to a smaller number, and nothing on
 * screen would say so.
 *
 * Both counts go through `fmtCount`, which refuses null/undefined/""/[]/false BEFORE the cast
 * and renders the em dash. That is not defensive decoration here: a payload written by an
 * older server carries no `pastWindow` at all, and `Object.values(undefined)` throws while
 * `Number(undefined)` would have quietly printed 0 — a confident "0 past the window" over a
 * population this function never saw.
 */
export function slaConsumedCaption(slaConsumed) {
  if (!slaConsumed || typeof slaConsumed !== "object") return null;
  const past = slaConsumed.pastWindow;
  // Summed only over the numbers that ARE numbers. A non-finite entry is an unmeasured
  // severity, not a zero one, so it poisons the total rather than being added as 0 —
  // fmtCount then prints the em dash for the whole sum.
  let pastTotal = past && typeof past === "object" ? 0 : null;
  for (const v of past && typeof past === "object" ? Object.values(past) : []) {
    if (pastTotal === null) break;
    pastTotal = typeof v === "number" && Number.isFinite(v) ? pastTotal + v : null;
  }
  return "Bucket k is time used; 9−k is time left. "
    + `${fmtCount(pastTotal)} past the window are not drawn; `
    + `${fmtCount(slaConsumed.noWindow)} carry no window.`;
}


/* --------------------------------------------------------------- the hero and its strip */

/** What the hero shows while the insights RPC is still in flight. Not a dash: a dash means
 *  "we looked and there was nothing", and nothing has looked yet. */
export const HERO_PENDING = "…";

/**
 * THE PAGE'S ARGUMENT IN ONE FIGURE, plus the four supporting facts under it — as data.
 *
 * "Act now" is open findings carrying BOTH evidence of exploitation (on the CISA KEV catalog
 * or with a public exploit) AND a way in (a host reachable from outside). It is meant to be
 * small. On a register where severity is close to a constant, a count of everything is not a
 * priority; the intersection is.
 *
 * THREE STATES, AND THEY ARE NOT THE SAME STATE:
 *
 *   pending   the RPC has not landed. `HERO_PENDING`, no stats — nothing has been measured.
 *   firstRun  the ledger holds no row at all for this scope. The hero is the em dash and the
 *             stat strip is EMPTY, not four zeros: "0 open · 0 past SLA · 0 awaiting · 0 days"
 *             states four facts about a population nobody has looked at (CLAUDE.md, "An
 *             unmeasured register is not a register of zeroes"). `firstRunNotice` carries the
 *             reason instead.
 *   measured  the figures, and — where the last scan carried no exposure field — the KEV count
 *             with a sentence saying the narrower figure could not be computed. Never a
 *             confident 0 for the intersection: that would be a measurement, and this is a
 *             refusal to measure.
 *
 * PURE, and it returns rate STATS AS NUMBERS rather than as `rateView` results: `rateView` and
 * `rateCell` live in `pages/mttr.js` / `pages/_rates.js`, which reach `../ui.js` and therefore
 * the DOM. Keeping the arithmetic here and the widget in the page is what lets
 * `test/registerFirstRun.test.js` run this in node.
 */
export function overviewHeroView(insights, firstRun) {
  const loaded = !!(insights && insights.flatScan);
  if (!loaded) {
    return { pending: true, firstRun: false, value: HERO_PENDING, qualifier: "", lines: [], stats: [] };
  }
  if (firstRun && firstRun.show) {
    return {
      pending: false,
      firstRun: true,
      value: absentText,
      qualifier: "Nothing has been measured for this register yet.",
      lines: [],
      stats: [],
    };
  }

  const f = insights.funnel || {};
  const exposureKnown = !!f.exposureKnown;
  const tiers = insights.tiers || {};
  const kev = (tiers.perTier || {}).kev;
  const past = (insights.pastSla || {}).overall || null;
  const aw = insights.awaiting || null;
  const median = insights.medianOpenAge;
  const scanTs = insights.scan ? insights.scan.ts : null;

  return {
    pending: false,
    firstRun: false,
    value: fmtCount(exposureKnown ? f.exposed : kev),
    qualifier: exposureKnown
      ? "open findings on the CISA KEV catalog or with a public exploit, on a host reachable "
        + "from outside."
      : "open findings on the CISA KEV catalog. Internet exposure was not captured in this "
        + "scan, so the narrower figure cannot be computed.",
    scanTs,
    exposureKnown,
    lines: exposureKnown
      ? [
        "Open findings that carry BOTH evidence of exploitation — on the CISA KEV catalog or "
        + "with a public exploit — and a way in: a host reachable from outside.",
        "The intersection, not a total. On a register where nearly everything is severe, a "
        + "count of everything is not a priority.",
      ]
      : [
        "Open findings on the CISA KEV catalog. The last scan carried no exposure field, so "
        + "the narrower figure — the ones also reachable from outside — could not be computed.",
        "It is not zero: nothing looked. Run a scan to capture exposure.",
      ],
    stats: [
      {
        name: "Open",
        value: fmtCount(f.open),
        sub: "still outstanding",
        lines: ["Open findings in scope for this scan, after the severity gate and the "
          + "register's own filters."],
      },
      {
        // A RATE, so it carries its base. The denominator is open findings whose SLA clock has
        // STARTED, which is smaller than the open count whenever anything is awaiting a vendor
        // fix — those have no clock to breach.
        name: "Past SLA",
        kind: "rate",
        pct: past ? past.pct : null,
        denominator: past ? past.open : 0,
        // SHORT, BECAUSE A STAT COLUMN IS ~180px WIDE. Measured on the seeded harness at
        // 1280: "35 of 59 with a running clock" wrapped to three lines under the figure and
        // the sub-line beneath repeated the same fact in different words. The denominator
        // names the BASE and the sub-line names the CLOCK; neither restates the other.
        denominatorLabel: past
          ? "of " + fmtCount(past.open) + " on the clock"
          : "no clock running",
        emptyLabel: "no open finding has an SLA clock running",
        sub: "past it, on the vendor-fix clock",
        lines: ["On the vendor-fix clock, matching the MTTR page — a finding with no patch "
          + "available yet is not counted as a breach, because its clock has not started."],
        term: "actionable-age",
      },
      {
        name: "Awaiting vendor fix",
        value: fmtCount(aw ? aw.overall : null),
        sub: "no published patch yet",
        term: "awaiting-fix",
      },
      {
        name: "Median open age",
        // `absentText`, not a typed dash and not a zero: no median means the payload never
        // measured one.
        value: num(median) === null ? absentText : fmtDays(median),
        sub: "half the open backlog is older",
        term: "age",
      },
    ],
  };
}
