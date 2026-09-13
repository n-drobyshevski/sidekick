// Live readouts for the Settings page — what a control is currently doing to the register,
// the AI-register twin of gas/src/client/js/settingsReadouts.js. Read THAT file's header
// first: gas is the only app that had this vocabulary before this wave, its
// repaintReadouts() opens with `if (!impact) return;`, and every readout it draws is
// decorative — every control works without the payload. This file keeps that contract.
//
// THREE READOUTS, AND ONLY THREE — P8's own scope. The register-scope category bars (the
// joint category cube) and the Priorities ranking histogram are P10 and P11's job; nothing
// here reads `categoryCube` or `termCoverage`, even though `api_getSettingsImpact` already
// ships both.
//
//   fiveRsSplitModel() / fiveRsSplit()   the 5Rs Compliance panel's LIVE draft composition —
//     derived-in / pinned-in / pinned-out / derived-out, every rule in exactly one bucket.
//     Unlike the panel's own "N of M in scope AS SAVED" description (settingsPatch's own
//     `scope.selected`/`scope.total`, which does not move as you edit), this recomputes from
//     the CURRENT draft on every call — that is the whole point of a live readout. Needs no
//     endpoint of its own: `scope.policies` (api_getFiveRsScope) and `draft.fiveRsPins`
//     already carry everything.
//
//   fetchScopeReadoutModel()   the Register tab's Fetch-scope control (`project` vs
//     `tenant`). The project side is measured — the register's own open-issue total under
//     the CURRENT scope, already on bootstrap (`boot.counts.openIssues`). THE TENANT SIDE
//     HAS NEVER BEEN MEASURED FROM THIS DEPLOYMENT, and this file must never invent a "would
//     collect N" figure for it — answering that needs a live Wiz call this page does not
//     make. `absentText` names the gap instead of guessing at it.
//
//   agentCallsText()   `autoExpand`'s stated cost ("one Wiz API call per agent per scan") as
//     a number a reader can actually multiply. `agentCount` is `api_getSettingsImpact`'s own
//     count of agents in the graph; absent (no payload at all, or a non-numeric count) says
//     nothing, never a guess — the same refusal gas's `repaintReadouts()` opens on.
//
// derivedFiveRsSelected() IS THE SAME RULE pages/settings.js's buildFiveRs() already computed
// locally before this package — moved here rather than duplicated, so the live split and the
// row toggles it sits beside can never read two different answers to "what would this rule be
// with no pin at all". settings.js's own `derivedSelected` is now an alias onto this export.

import { absentText, num, splitBar } from "./ui.js";

function fmt(n) {
  return (n || 0).toLocaleString();
}

/**
 * What a 5Rs policy row would be with NO pin at all — the value `setPin()` (pages/settings.js)
 * diffs a toggle against, and the value `fiveRsSplitModel()` below falls back to for any row
 * the draft has not overridden. `row.reason` is the SAVED derivation (api_getFiveRsScope):
 * "pinnedIn"/"pinnedOut" mean the SERVER applied a saved pin to reach `row.selected`, so the
 * underlying, unpinned answer is the OPPOSITE of that; any other reason
 * ("crossMapped"/"linkedFindings"/"noAiLink") already IS the unpinned answer.
 */
export function derivedFiveRsSelected(row) {
  if (row.reason === "pinnedIn") return false;
  if (row.reason === "pinnedOut") return true;
  return !!row.selected;
}

/**
 * The 5Rs scope's live draft composition: derived-in / pinned-in / pinned-out / derived-out.
 * These four are genuinely parts of one whole — every rule lands in exactly one bucket — which
 * is what makes `splitBar` the right mark here, unlike the register-scope category question
 * (P10), where a row can be stamped with more than one category at once and a split bar would
 * misstate the overlap.
 *
 * `pins` is the DRAFT's pin lists, not the row's own saved `reason` — a rule the server saved
 * as pinnedIn but the operator has un-pinned THIS session must count as derived (or
 * pinned-out), not pinned-in, which is exactly why this reads `pins` fresh rather than trusting
 * each row's own gloss.
 *
 * @param {Array<{policyId:string, reason:string, selected:boolean}>} rows  scope.policies
 * @param {{in:string[], out:string[]}} pins  draft.fiveRsPins
 */
export function fiveRsSplitModel(rows, pins) {
  const list = rows || [];
  const pinsIn = new Set((pins && pins.in) || []);
  const pinsOut = new Set((pins && pins.out) || []);
  let derivedIn = 0;
  let pinnedIn = 0;
  let pinnedOut = 0;
  let derivedOut = 0;
  for (const row of list) {
    if (pinsIn.has(row.policyId)) { pinnedIn += 1; continue; }
    if (pinsOut.has(row.policyId)) { pinnedOut += 1; continue; }
    if (derivedFiveRsSelected(row)) derivedIn += 1; else derivedOut += 1;
  }
  const total = list.length;
  const inScope = derivedIn + pinnedIn;
  const segments = [
    { label: "Derived in", value: derivedIn, tone: "in" },
    { label: "Pinned in", value: pinnedIn, tone: "pinned-in" },
    { label: "Pinned out", value: pinnedOut, tone: "pinned-out" },
    { label: "Derived out", value: derivedOut, tone: "out" },
  ];
  const caption = `Derived in ${fmt(derivedIn)} · Pinned in ${fmt(pinnedIn)} · `
    + `Pinned out ${fmt(pinnedOut)} · Derived out ${fmt(derivedOut)} — ${fmt(inScope)} of `
    + `${fmt(total)} rules in scope right now.`;
  const ariaLabel = `${fmt(inScope)} of ${fmt(total)} rules in scope right now`;
  return {
    segments, caption, ariaLabel, total,
    counts: { derivedIn, pinnedIn, pinnedOut, derivedOut },
  };
}

/** `splitBar()` over a `fiveRsSplitModel()` result — thin DOM, same shape as gas_shared's own
 *  `impactSplit()` over `impactSplitModel()`. */
export function fiveRsSplit(rows, pins) {
  return splitBar(fiveRsSplitModel(rows, pins));
}

/**
 * The Fetch-scope readout: the measured side, and the unmeasured side NAMED rather than
 * guessed. `projectOpenIssues` is `boot.counts.openIssues` — the register's own open-issue
 * total under the scope the last sync actually applied, already on bootstrap, costing nothing
 * new. The tenant side has no such figure anywhere in this app: answering "how many would a
 * tenant-wide sync return" needs a live call to Wiz, which this page never makes on its own,
 * so it is named as unmeasured rather than estimated.
 *
 * Returns SENTENCES, not nodes — the two lines are independent and the caller (pages/
 * settings.js) already owns exactly the two `<p>` hosts they belong in.
 *
 * @param {number|null|undefined} projectOpenIssues
 * @returns {{projectLine: string, tenantLine: string}}
 */
export function fetchScopeReadoutModel(projectOpenIssues) {
  const known = typeof projectOpenIssues === "number" && Number.isFinite(projectOpenIssues)
    ? projectOpenIssues
    : null;
  const projectLine = known === null
    ? `The configured Wiz project — ${absentText}.`
    : `The configured Wiz project — ${known.toLocaleString()} open AI-Security issue`
      + `${known === 1 ? "" : "s"}, measured under the current scope.`;
  const tenantLine = `All available perimeters — ${absentText}, never measured from this `
    + "deployment.";
  return { projectLine, tenantLine };
}

/**
 * `autoExpand`'s stated cost, turned into a number a reader can actually multiply — or nothing
 * at all when the count itself is unknown. `agentCount` is `api_getSettingsImpact`'s own
 * count; a missing payload (the RPC failed, or was never fetched) must say NOTHING here rather
 * than guess, so the caller conditions on this returning non-null before drawing anything.
 * `0` is a real, measured answer (an empty graph) and is printed like any other count — it is
 * only the ABSENCE of a number, never the number 0 itself, that goes unstated.
 *
 * REFUSED BEFORE THE CAST, `num()`'s own allowlist (figures.js): `Number(null)` and
 * `Number(undefined)` are both `0`, and `0` is finite, so a bare `Number(agentCount)` here
 * would read a payload that never arrived as a confident "0 agents" — the exact substitution
 * CLAUDE.md's working discipline names. `num()` refuses null/undefined/an object/an array/a
 * boolean to `null` before any cast is attempted; only a value that WAS already a number (or a
 * numeric string) reaches `Number.isFinite` at all.
 *
 * @param {number|null|undefined} agentCount
 * @returns {string|null}
 */
export function agentCallsText(agentCount) {
  const n = num(agentCount);
  if (n === null || n < 0) return null;
  const agents = n.toLocaleString();
  return `${agents} agent${n === 1 ? "" : "s"} in the graph — ${agents} Wiz API call`
    + `${n === 1 ? "" : "s"} per scan.`;
}
