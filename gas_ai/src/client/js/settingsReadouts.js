// Live readouts for the Settings page — what a control is currently doing to the register,
// the AI-register twin of gas/src/client/js/settingsReadouts.js. Read THAT file's header
// first: gas is the only app that had this vocabulary before this wave, its
// repaintReadouts() opens with `if (!impact) return;`, and every readout it draws is
// decorative — every control works without the payload. This file keeps that contract.
//
// THREE READOUTS SHIPPED IN P8; THREE MORE IN P10, BELOW THEM. P8's own scope was
// `fiveRsSplitModel`/`fetchScopeReadoutModel`/`agentCallsText`, and nothing in that half reads
// `categoryCube` or `termCoverage` even though `api_getSettingsImpact` already shipped both —
// see each function's own header below for the ones that do now.
//
// P10 adds the Register tab's category-scope readout (`categoryScopeRowsModel`/
// `categoryScopeReadout`), the dropped-category figure that makes its standing notice concrete
// (`categoryDroppedOnlyText`), and the Priorities ranking panel's term-coverage bars
// (`termCoverageModel`/`termCoverageReadout`). `termCoverage` answers "how many rows can this
// term even read", never "how would the rank ORDER move if I touched this knob" — P11, below
// them, is that second question, over the `rankCube` payload `api_getSettingsImpact` now also
// ships: `rankHistogramReadout` (the score distribution under the draft and the saved rule,
// side by side), `rankMovedText` (rows whose score moves by more than a threshold),
// `rankAgreementText` (`kendallTauB` between the two orderings) and `rankTopNText` (top-N
// carry-over — see that function's own header for why it is sometimes a RANGE, never a guessed
// point estimate).
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

import {
  absentText, el, impactSplit, impactSplitModel, meter, num, splitBar,
} from "./ui.js";
import { categoryMarginalCount, categoryScopeImpact } from "./categoryCubeModel.js";
import {
  rankCubeTauB, rankCubeTopN, rankRowsMovedBeyond, rankScoreHistogram,
} from "./rankCubeModel.js";

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

// ============================================================================ category scope

const CATEGORY_OVERLAP_CAVEAT = "The categories above can overlap on the same issue, so they "
  + "do not sum to the total.";

/**
 * The register-scope category picker's own readout (P10): one row per candidate category, read
 * against `impact.categoryCube` (`domain/settingsImpact.ts`'s `CategoryCube` — see that file's
 * header for why it is a joint distribution and not six independent counts). PAYLOAD-DERIVED,
 * not draft-derived: pages/settings.js reads the resolved `impact` synchronously at build time
 * and never repaints this from a draft edit — the figure that DOES move with the draft is
 * `categoryDroppedOnlyText` below, not this one.
 *
 * `candidateCategories` HERE IS `impact.candidateCategories` — the DATED one
 * (`{id, name, count, measuredAt, measuredScope}`, P9's addition to `CANDIDATE_CATEGORIES`) —
 * and NOT `settings.candidateCategories` (`api_getSettings`'s plain `{id, name}`, which is what
 * builds the category TOGGLES this readout sits beside). Passing the wrong one silently drops
 * the dated calibration figures this readout exists to show; nothing here can tell the two
 * shapes apart, so the caller has to pass the right one.
 *
 * THE HONESTY LINE. A candidate outside `cube.measuredCandidateIds` gets `count: null` here,
 * never `0` — see `CategoryCube.measuredCandidateIds`'s own header: an unmeasured category's
 * count is not zero, it is UNMEASURED, and reading a missing bit as "zero open issues" would
 * read a widened-but-unsynced category as a clean register.
 */
export function categoryScopeRowsModel(cube, candidateCategories) {
  const list = candidateCategories || [];
  if (!cube || !Array.isArray(cube.candidateIds) || !cube.cells) {
    return { scale: 0, rows: [] };
  }
  const measuredIds = new Set(cube.measuredCandidateIds || []);
  const rows = list.map((c) => {
    const idx = cube.candidateIds.indexOf(c.id);
    const isMeasured = idx >= 0 && measuredIds.has(c.id);
    const dated = typeof c.count === "number" && c.measuredAt && c.measuredScope
      ? { count: c.count, measuredAt: c.measuredAt, measuredScope: c.measuredScope }
      : null;
    return {
      id: c.id,
      name: c.name,
      measured: isMeasured,
      // UNMEASURED IS null, NEVER 0 — see this function's own header.
      count: isMeasured ? categoryMarginalCount(cube, idx) : null,
      // THE DATED FOREIGN FIGURE — carried through untouched, never added to or compared
      // against `count` above. See categoryScopeRow()'s own rendering of it.
      dated,
    };
  });
  return { scale: cube.total || 0, rows };
}

/**
 * One category row: name, a bar against `scale` (the register's own open total — the common
 * axis every row in this readout shares, never a stacked/split bar over the categories
 * themselves), the live count, and the dated calibration figure when P9's payload carries one
 * for this candidate.
 *
 * NEVER A ZERO-HEIGHT BAR FOR AN UNMEASURED CATEGORY. The bar's value is `max` itself (a FULL
 * bar) whenever `row.measured` is false — never `0`: an empty track reads as "measured, and it
 * was zero", which is exactly the substitution `CategoryCube.measuredCandidateIds` exists to
 * forbid, and it would still be wrong even in the degenerate case where `scale` itself is 0 (an
 * empty register), which is why `max` floors at 1 rather than inheriting `scale` directly.
 * `bar.fill` (`meter()`'s own escape hatch for a caller that needs to touch the fill after
 * building it) carries the `.hatch` class instead of the ordinary solid fill — this design
 * system's one texture for "not measured" (gas_shared/styles/components.css) — and the word
 * "Not measured" sits beside it, because a texture alone is not a fact.
 */
function categoryScopeRow(row, scale) {
  const max = scale > 0 ? scale : 1;
  // No `label`: meter()'s aria-label only applies to its non-decorative branch, and this bar is
  // decorative — the name and the count are both already in `nameLine` as real text.
  const bar = meter(row.measured ? row.count : max, { max, decorative: true });
  if (!row.measured) bar.fill.classList.add("hatch");
  const countEl = row.measured
    ? el("span", { class: "small num" }, fmt(row.count))
    : el("span", { class: "small" }, "Not measured");
  const nameLine = el(
    "p",
    { class: "small", style: "margin:0 0 4px; display:flex; justify-content:space-between; gap:8px" },
    el("strong", {}, row.name),
    countEl,
  );
  const datedLine = row.dated
    ? el(
      "p",
      { class: "small muted", style: "margin:4px 0 0" },
      `Measured ${row.dated.measuredAt}, ${row.dated.measuredScope}: `
      + `${fmt(row.dated.count)} open issue${row.dated.count === 1 ? "" : "s"} — a one-off `
      + "figure, never live.",
    )
    : null;
  return el(
    "div", { class: "category-scope-row", style: "margin:0 0 12px" }, nameLine, bar, datedLine,
  );
}

/**
 * The category scope readout's DOM half — thin, over `categoryScopeRowsModel()`. `null` when
 * the cube never arrived or carries no candidates, so pages/settings.js can append the result
 * unconditionally (`el()` and array spreads both skip a `null`/`undefined` child) rather than
 * branch on the payload itself.
 */
export function categoryScopeReadout(cube, candidateCategories) {
  const model = categoryScopeRowsModel(cube, candidateCategories);
  if (!model.rows.length) return null;
  return el(
    "div",
    { class: "category-scope-readout" },
    ...model.rows.map((r) => categoryScopeRow(r, model.scale)),
    el("p", { class: "small muted" }, CATEGORY_OVERLAP_CAVEAT),
  );
}

/**
 * The Register tab's standing notice — "changing this changes what every published figure
 * counts" — made concrete: open issues stamped ONLY with categories the CURRENT DRAFT is about
 * to drop relative to the last SAVED selection. `categoryCubeModel.categoryScopeImpact` does
 * the set-containment arithmetic (a marginal cannot answer this — a row stamped with a dropped
 * category AND a still-kept one must not count, because re-fetching under the narrowed scope
 * would still return it); this shapes the result into the sentence the panel prints beside the
 * standing notice.
 *
 * DRAFT-DERIVED, UNLIKE `categoryScopeRowsModel` ABOVE. pages/settings.js recomputes this on
 * every edit (`repaintImpactReadouts()`, called from `onEdit()`), because `selectedIds` is the
 * in-memory draft and it moves on every checkbox click; `previousIds` is the SAVED selection,
 * not merely "the draft a moment ago".
 *
 * Returns `null` when the cube never arrived, so the caller can hide its host rather than print
 * a guess.
 */
export function categoryDroppedOnlyText(cube, selectedIds, previousIds) {
  if (!cube || !Array.isArray(cube.candidateIds) || !cube.cells) return null;
  const impact = categoryScopeImpact(cube, selectedIds || [], previousIds || selectedIds || []);
  const n = impact.droppedOnlyOpen;
  if (!n) {
    return "Nothing in the current draft is stamped only with a category being dropped — "
      + "narrowing it right now would cost nothing already collected.";
  }
  return `${fmt(n)} open issue${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} stamped only with `
    + "a category this draft drops. They would stop being refreshed on the next sync and could "
    + "not resolve by absence.";
}

// ============================================================================= term coverage

const TERM_LABELS = {
  rule: "Rule judgement",
  time: "Clock",
  exploitation: "Exploitation",
  adjacency: "AI adjacency",
};

/**
 * `termCoverage` (P9's `settingsImpact.termCoverageOf`) shaped into the four `impactSplitModel`s
 * the Priorities ranking panel draws — how many rows in the queue actually MEASURE each of the
 * four blend terms the shares divide across. The decision this readout exists to support:
 * `rank.ts`'s `rankOne` drops an unmeasured term from BOTH sides of the blend rather than
 * scoring it 0, precisely so an unmeasured signal never reads as "we looked and found nothing"
 * — which means a share spent on a term most rows cannot measure is a share spent on rows it
 * will never actually be read on.
 *
 * `timeSource` PICKS WHICH OF `termCoverage.time`'s TWO INDEPENDENT COUNTS the Clock row reads —
 * `dueAt` for `dueAtOnly`, `createdAt` for `dueAtElseAge` — mirroring `rank.ts`'s own `timeOf`.
 * The two counts are never merged: a row with both a parseable `dueAt` and a parseable
 * `createdAt` counts in both underlying numbers, because which one the CLOCK actually reads
 * depends on this one argument, not on the row. THIS IS WHY THIS WHOLE MODEL IS DRAFT-DERIVED,
 * unlike `categoryScopeRowsModel` above — it must be recomputed whenever the Clock-source select
 * changes, even though every OTHER input here is payload, not draft.
 *
 * Returns `null` when the payload never arrived — degrade silently, same as every other readout
 * in this file.
 */
export function termCoverageModel(termCoverage, timeSource) {
  if (!termCoverage) return null;
  const total = Math.max(0, num(termCoverage.total) || 0);
  const clampToTotal = (v) => Math.max(0, Math.min(total, num(v) || 0));
  const timeMeasured = timeSource === "dueAtElseAge"
    ? clampToTotal(termCoverage.time && termCoverage.time.createdAt)
    : clampToTotal(termCoverage.time && termCoverage.time.dueAt);
  const measuredOf = {
    rule: clampToTotal(termCoverage.rule),
    time: timeMeasured,
    exploitation: clampToTotal(termCoverage.exploitation),
    adjacency: clampToTotal(termCoverage.adjacency),
  };
  const terms = ["rule", "time", "exploitation", "adjacency"].map((key) => ({
    key,
    label: TERM_LABELS[key],
    splitModel: impactSplitModel({
      count: total - measuredOf[key],
      total,
      unit: "rows",
      phrase: `cannot measure the ${TERM_LABELS[key].toLowerCase()} term`,
      includedLabel: "Measures",
      excludedLabel: "Cannot measure",
      on: true,
      onNote: "",
      offNote: "",
    }),
  }));
  return { total, terms };
}

/**
 * The term-coverage readout's DOM half: one label plus one `impactSplit()` bar per term, and
 * the one sentence that says why a large share on a poorly-measured term is a mistake —
 * `rank.ts`'s own reason, stated briefly rather than assumed. `null` when the model is, so
 * pages/settings.js can append the result unconditionally.
 */
export function termCoverageReadout(termCoverage, timeSource) {
  const model = termCoverageModel(termCoverage, timeSource);
  if (!model) return null;
  const rows = model.terms.map((t) => el(
    "div",
    { class: "term-coverage-row", style: "margin:0 0 10px" },
    el("p", { class: "small", style: "margin:0 0 2px" }, el("strong", {}, t.label)),
    impactSplit(t.splitModel),
  ));
  const note = el(
    "p",
    { class: "small muted" },
    "A term most rows cannot measure is dropped from both sides of the blend rather than "
    + "scored as zero — putting a large share on one spends it on rows it will never actually "
    + "be read on.",
  );
  return el("div", { class: "term-coverage-readout" }, ...rows, note);
}

// ================================================================================ P11: rank
// cube — "would this change the order of my queue, and by how much".
//
// Every function below takes `rankCube` (`impact.rankCube`) plus TWO rules — a `draftRule` and
// a `savedRule`, both shaped like `draft.rankRule` / `saved.rankRule` (only `shares`,
// `timeSource`, `exploitationWeights`, `adjacencyWeights` and `epssThreshold` are ever read;
// the extra fields a full `RankRule` carries are simply ignored) — and answer, PER KEYSTROKE,
// with no round trip: `rankCubeModel.js` re-prices every tuple in the cube under each rule.
//
// THE THRESHOLD AND THE N ARE FIXED HERE, NOT DRAFT FIELDS. Nothing in this panel lets an
// operator dial either one, so `RANK_MOVED_THRESHOLD` (10 score points, the same 0..1 scale
// `rankScore` itself uses) and `RANK_TOP_N` (50 — `assetTable.DEFAULT_PAGE_SIZE`, a "page" of
// the Priorities queue) are reasonable defaults rather than settings.

const RANK_MOVED_THRESHOLD = 0.1;
const RANK_TOP_N = 50;
const RANK_HIST_BUCKETS = 16;

/**
 * The score histogram under the draft rule and under the saved rule, over the SAME cube — how
 * a rule edit reshapes the queue's whole score distribution, not just its ends. `null` when
 * the cube never arrived.
 */
export function rankHistogramModel(rankCube, draftRule, savedRule, buckets = RANK_HIST_BUCKETS) {
  if (!rankCube) return null;
  const draft = rankScoreHistogram(rankCube, draftRule, buckets);
  const saved = rankScoreHistogram(rankCube, savedRule, buckets);
  if (!draft.length || !saved.length) return null;
  return { draft, saved, total: rankCube.total || 0, buckets };
}

/** One row of `.cut-hist__bar`s (gas_shared's histogram bar, reused bare — no cutline, no
 *  slider, the two things `createCutHistogram` adds that this readout has no use for). */
function histBars(counts) {
  const max = Math.max(...counts, 1);
  return counts.map((n) => {
    const bar = el("div", { class: "cut-hist__bar" });
    bar.style.height = n === 0 ? "0%" : `${Math.max(2, (n / max) * 100)}%`;
    return bar;
  });
}

/** The histogram readout's DOM half — two labelled bar rows, draft above saved, sharing one
 *  axis caption. `null` when `rankHistogramModel` is. */
export function rankHistogramReadout(model) {
  if (!model) return null;
  const row = (label, counts) => el(
    "div", { class: "rank-hist-row", style: "margin:0 0 8px" },
    el("p", { class: "small", style: "margin:0 0 2px" }, label),
    el(
      "div",
      { class: "cut-hist", role: "img", "aria-label": `${label} score histogram, ${fmt(model.total)} rows` },
      ...histBars(counts),
    ),
  );
  return el(
    "div", { class: "rank-hist-readout" },
    row("Draft", model.draft),
    row("Saved", model.saved),
    el(
      "p", { class: "small muted" },
      `Low score (left) to high score (right) — ${fmt(model.total)} rows across `
      + `${model.buckets} buckets.`,
    ),
  );
}

/**
 * How many rows move by more than `threshold` in score between the two rules — the exact
 * per-row count, read off the cube. `null` when the cube never arrived.
 */
export function rankMovedText(rankCube, draftRule, savedRule, threshold = RANK_MOVED_THRESHOLD) {
  if (!rankCube) return null;
  const moved = rankRowsMovedBeyond(rankCube, draftRule, savedRule, threshold);
  if (moved === null) return null;
  const total = rankCube.total || 0;
  if (!total) return "No rows in the Priorities queue to compare yet.";
  const t = threshold.toFixed(2);
  if (!moved) {
    return `No rows move by more than ${t} in score if you save this — the draft and the `
      + "saved rule score the queue almost identically.";
  }
  return `${fmt(moved)} of ${fmt(total)} row${total === 1 ? "" : "s"} move by more than ${t} `
    + "in score if you save this.";
}

/**
 * `kendallTauB` between the draft order and the saved order, computed over the cube's tuples
 * WITH MULTIPLICITY — see `domain/settingsImpact.ts`'s `rankCubeTauB` for why that is exact
 * rather than an approximation. `null` when the cube never arrived.
 */
export function rankAgreementText(rankCube, draftRule, savedRule) {
  if (!rankCube) return null;
  const tau = rankCubeTauB(rankCube, draftRule, savedRule);
  if (tau === null) return null;
  if (!rankCube.total) return "No rows in the Priorities queue to compare yet.";
  return "Kendall's tau-b between the draft order and the saved order: "
    + `${tau.toFixed(2)} (1.00 is identical, 0.00 is unrelated, −1.00 is fully reversed).`;
}

/**
 * The top-N carry-over: of the top `n` rows under the saved rule, how many are still in the
 * top `n` under the draft. `null` when the cube never arrived.
 *
 * THE RANGE IS THE POINT. Rows sharing a tuple (or, whenever a share is 0, several tuples
 * that happen to tie on score) are interchangeable to this cube, and their real order comes
 * from the Priorities page's own severity → due date → age → id tiebreak, which the cube does
 * not carry. Whenever that leaves the Nth slot's true position ambiguous under BOTH orderings
 * at once, `rankCubeTopN` returns the exact ACHIEVABLE range rather than a point guess, and
 * this function reports it as a range with one clause on why — never "N of the top 50 carry
 * over" dressed up as a fact this payload cannot support. `lo === hi` — the ordinary case — is
 * printed as the single number it actually is.
 */
export function rankTopNText(rankCube, draftRule, savedRule, n = RANK_TOP_N) {
  if (!rankCube) return null;
  const result = rankCubeTopN(rankCube, draftRule, savedRule, n);
  if (!result) return null;
  const top = result.topA; // === result.topB: "top n" is always min(n, total) rows, whoever ranked it
  if (!top) return `The queue is empty — there is no top ${fmt(n)} to compare.`;
  const { lo, hi } = result.carryOver;
  if (lo === hi) {
    return `${fmt(lo)} of the top ${fmt(top)} carry over from the saved order to the draft's.`;
  }
  return `Between ${fmt(lo)} and ${fmt(hi)} of the top ${fmt(top)} carry over from the saved `
    + "order to the draft's — several rows tie on score, and which of them lands above the "
    + "cut is decided by the page's own tiebreak (severity, then due date, then age), which "
    + "this figure cannot see, so the true count sits somewhere in that range rather than at "
    + "one point in it.";
}

/**
 * The whole P11 block: the histogram, the moved-count, the tau, and the top-N carry-over —
 * bundled the way `termCoverageReadout` bundles its own four rows, so a caller cannot reach
 * for one figure and forget the other three exist. `null` when the cube never arrived, so
 * `pages/settings.js` can append the result unconditionally.
 */
export function rankImpactReadout(rankCube, draftRule, savedRule) {
  if (!rankCube) return null;
  const histNode = rankHistogramReadout(rankHistogramModel(rankCube, draftRule, savedRule));
  const movedText = rankMovedText(rankCube, draftRule, savedRule);
  const tauText = rankAgreementText(rankCube, draftRule, savedRule);
  const topNText = rankTopNText(rankCube, draftRule, savedRule);
  if (!histNode && !movedText && !tauText && !topNText) return null;
  return el(
    "div", { class: "rank-impact-readout" },
    histNode,
    movedText ? el("p", { class: "small" }, movedText) : null,
    tauText ? el("p", { class: "small" }, tauText) : null,
    topNText ? el("p", { class: "small" }, topNText) : null,
  );
}
