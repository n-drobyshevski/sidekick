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

import { fmtCount } from "../../../../../gas_shared/ui/figures.js";

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
