// Live readouts for the Settings page — what a control is currently doing to the register,
// this register's twin of gas/src/client/js/settingsReadouts.js and gas_ai's sibling of the
// same name. Read gas/'s header first: its `repaintReadouts()` opens with `if (!impact) return;`
// and every readout it draws is decorative — every control works with a null payload. This file
// keeps that contract; see pages/settings.js's own `repaintReadouts()` for where it is enforced.
//
// PURE MODEL, THIN DOM — the split every function pair below draws, because this suite runs no
// jsdom (vitest.config.ts sets no `environment`): a "…Model"/"…Ticks"/bare function never calls
// `el()` and is exercised directly by test/settingsReadouts.test.js; the DOM half that calls
// `el()`/`splitBar()`/`tickTimeline()`/`createCutHistogram()` has nothing to render into here and
// is swept as comment-stripped source text instead, in test/settingsReadoutsDom.test.js.
//
// THE CLIENT CANNOT IMPORT src/domain/*.ts (every page in this app states that rule; see e.g.
// pages/settings.js's own header). Two functions below are therefore PLAIN-JS MIRRORS of
// functions that really live in domain/settingsImpact.ts, ported rather than re-derived, and
// pinned bit-for-bit against the TS originals by test/settingsReadoutsMirror.test.js — skipping
// that pin would leave the SLA cutline and the stranded-rows figure free to silently disagree
// with the one number every other surface (readModels.ts, brick/) actually reports against:
//
//   atOrBelow(bin, t)             byte-for-byte the TS original (settingsImpact.ts). The day the
//     window a reader is dragging or typing needs to be judged the moment they move it, with no
//     round trip — the payload ships the bins once (`api_getSettingsImpact`'s `ageHistogram`),
//     and this is what reconstructs "how many findings would be at or below day t" from them.
//   strandedOpenCount(...)        the TS original, minus the one thing the client cannot inherit
//     for free: the domain layer iterates its own module-level `SCOPES` constant, so this mirror
//     takes the full scope list as an explicit argument instead (`allScopes`) rather than a
//     second copy of `["sca","sast","secrets"]` that could drift from it — pages/settings.js
//     already holds that list (`scopeList`, off `boot.scopes`) for its own pills.
//
// THE ONE THING NEITHER MIRROR MAY GET WRONG: `[]` in a scope's `fetchSeverities` entry means
// EVERY SEVERITY, never none — domain/config.ts's `DEFAULT_FETCH_SEVERITIES` docstring, and
// pages/settings.js's own `registerFieldView`, both draw the identical line. `severityScopeModel`
// below and `strandedOpenCount`'s narrowing branch both check `.length` before ever comparing
// against a severity list, the same guard `settingsModel.js`'s `draftWarnings` already makes for
// the identical field. A shared `Array.prototype.includes` predicate would read an empty
// selection as "nothing in scope" and invert this register's most carefully argued default.
//
// AGE_HISTOGRAM_CAP_DAYS mirrors domain/config.ts's constant of the same name, by value rather
// than by import, for the same reason pages/settings.js's own RETENTION_FLOOR_DAYS/
// DEFAULT_SYNC_HOUR literals do — held equal to the source of truth by
// test/settingsReadoutsMirror.test.js instead of an import. It is only ever the SLA cutline's
// static axis bound, fixed at construction time (`createSlaCutlineReadout`, built once, before
// the payload has necessarily arrived); every arithmetic use of "the measured horizon" reads
// `capDays` fresh off the payload each `update()` call instead, so a future change to the real
// constant can never leave the cutline's WORDS out of step with its axis, only its cosmetics.

import {
  createCutHistogram, el, severitySplitModel, splitBar, statusPill, tickTimeline,
} from "./ui.js";

function fmt(n) {
  return (n || 0).toLocaleString();
}

// ============================================================================ mirrored domain
// arithmetic — see this file's own header for why these two exist and how they are pinned.

export const AGE_HISTOGRAM_CAP_DAYS = 730; // domain/config.ts::AGE_HISTOGRAM_CAP_DAYS

/**
 * `atOrBelow(t)` reconstructed from a truncated `AgeBin` — see domain/settingsImpact.ts's own
 * docstring for the full argument (`t < from` reads 0; at or past the last stored day reads the
 * last entry, held flat). Ported byte-for-byte rather than re-derived, and pinned against the TS
 * original by test/settingsReadoutsMirror.test.js at every integer window.
 */
export function atOrBelow(bin, t) {
  if (!bin.counts.length || t < bin.from) return 0;
  const idx = t - bin.from;
  return idx >= bin.counts.length ? bin.counts[bin.counts.length - 1] : bin.counts[idx];
}

/**
 * How many currently-OPEN findings the given (scopes, fetchSeverities) selection would STRAND —
 * ported from domain/settingsImpact.ts's function of the same name, with one unavoidable
 * deviation: the domain layer iterates its own module-level `SCOPES`; this mirror takes the full
 * scope list as `allScopes` instead, since the client cannot import it. `census` is
 * `api_getSettingsImpact`'s own `census.byScope` — the UNFILTERED per-scope census, unaffected by
 * either the saved or the draft selection, so this can be called twice against the SAME payload
 * (once for `saved`, once for the live `draft`) to preview a change with no round trip.
 *
 * `[]` MEANS EVERY SEVERITY — see this file's own header. Checked by `.length` before ever
 * comparing against `severityOrder`, the same guard the TS original makes.
 */
export function strandedOpenCount(census, allScopes, keptScopes, fetchSeverities, severityOrder) {
  const kept = new Set(keptScopes || []);
  const byScope = {};
  let total = 0;
  for (const scope of allScopes || []) {
    const c = census && census[scope];
    if (!c) { byScope[scope] = 0; continue; }
    if (!kept.has(scope)) {
      // The whole register is dropped: nothing will ever scan it again, so every open finding
      // it holds today is stranded.
      const n = c.openTotal || 0;
      byScope[scope] = n;
      total += n;
      continue;
    }
    const requested = (fetchSeverities && fetchSeverities[scope]) || [];
    if (!requested.length) { byScope[scope] = 0; continue; } // unfiltered: nothing strands
    let strandedInScope = 0;
    const open = (c.bySeverity && c.bySeverity.open) || {};
    for (const sev of severityOrder || []) {
      if (requested.includes(sev)) continue; // still requested — a future scan can still close it
      strandedInScope += open[sev] || 0;
    }
    byScope[scope] = strandedInScope;
    total += strandedInScope;
  }
  return { total, byScope };
}

// ================================================================= register tab: severity split

/**
 * The shared half of one scope's severity-scope bar: `severitySplitModel` (gas_shared), fed the
 * PREDICATE it requires rather than the draft's own array — see this file's header for why an
 * empty array reading as "nothing in scope" would invert this register's default. Pure: no DOM,
 * directly held by test/settingsReadouts.test.js.
 */
export function severityScopeModel(scope, census, requestedSeverities, selectable) {
  const requested = requestedSeverities || [];
  return severitySplitModel({
    selectable,
    bySeverityOpen: (census && census.bySeverity && census.bySeverity.open) || {},
    bySeverityAll: (census && census.bySeverity && census.bySeverity.all) || {},
    inScope: (sev) => !requested.length || requested.includes(sev),
    openTotal: (census && census.openTotal) || 0,
    total: (census && census.total) || 0,
    outLabel: "Not requested",
    unit: "findings",
  });
}

/** `splitBar()` over `severityScopeModel()`'s result — thin DOM, rebuilt wholesale on every
 *  draft edit (no persistent interactive element lives inside a split bar). */
export function severityScopeReadout(scope, census, requestedSeverities, selectable) {
  return splitBar(severityScopeModel(scope, census, requestedSeverities, selectable));
}

// =================================================================== register tab: stranded rows

/**
 * The stranded-rows figure, as data — the number `settingsModel.js`'s `draftWarnings` already
 * argues for in confirm-dialog prose, turned into something shown live as the reader edits
 * rather than only at save time.
 */
export function strandedRowsModel(stranded) {
  const total = (stranded && stranded.total) || 0;
  if (!total) {
    return {
      tone: "ok",
      pillText: "0 stranded",
      text: "Nothing is stranded — every open finding stays reachable by a future scan under "
        + "this draft.",
    };
  }
  return {
    tone: "warn",
    pillText: `${fmt(total)} stranded`,
    text: `${fmt(total)} open finding${total === 1 ? "" : "s"} would be stranded by this draft `
      + "— frozen outside every future scan's gate, unable to resolve by absence until the gate "
      + "is widened again.",
  };
}

/** Thin DOM over `strandedRowsModel()` — a pill plus the sentence, rebuilt wholesale on every
 *  scope/severity edit (`pages/settings.js`'s `repaintReadouts()`). */
export function strandedRowsReadout(stranded) {
  const model = strandedRowsModel(stranded);
  return el(
    "p", { class: "small", style: "display:flex; align-items:center; gap:8px; margin:0 0 12px" },
    statusPill(model.tone, model.pillText),
    model.text,
  );
}

// ==================================================================== system tab: retention lane

/**
 * Which state each scan's retention tick is in, and the two summary counts — pure, held directly
 * by test/settingsReadouts.test.js. `tickTimeline` (gas_shared) only draws whatever this returns;
 * it does not know what "sealed" or "pinned" mean.
 *
 * ONE LANE, not one per scope — `api_getSettingsImpact`'s `scans` already ships every scope's
 * scan rows in one time-ordered list (P6a's `scanAges`; see its own docstring), because the
 * retention window and the seal floor are ONE decision shared across every register this app
 * scans, not three independent ones. `scopeLabels` names each tick's own scope in its hover hint
 * rather than leaving three registers' history to read as one undifferentiated lane.
 */
export function retentionTicks(scans, retentionDays, scopeLabels) {
  const list = scans || [];
  const labels = scopeLabels || {};
  const labelOf = (s) => labels[s] || s;
  let sealedCount = 0;
  let wouldSealCount = 0;
  const ticks = list.map((s) => {
    if (s.sealed) sealedCount += 1;
    const willSeal = !s.sealed && !s.pinned
      && retentionDays !== null && s.ageDays > retentionDays;
    if (willSeal) wouldSealCount += 1;
    const state = s.sealed ? "sealed" : willSeal ? "would" : s.pinned ? "pinned" : "plain";
    const why = s.sealed ? "already sealed"
      : willSeal ? `would seal at ${retentionDays}d`
        : s.pinned ? "always kept (most recent)"
          : "within the retention window";
    return { state, hint: `${labelOf(s.scope)} — ${s.ageDays}d old — ${why}` };
  });
  return { ticks, sealedCount, wouldSeal: wouldSealCount };
}

/** The retention timeline: one tick per scan across every scope, newest first (matching the
 *  payload), sealed/would-seal/pinned each carrying a distinct fill AND a glyph AND a word (a
 *  bare glyph is refused by `tickTimeline` itself). Rebuilt whole on every call. */
export function renderRetentionReadout(scans, retentionDays, scopeLabels) {
  const { ticks, sealedCount, wouldSeal } = retentionTicks(scans, retentionDays, scopeLabels);
  const total = (scans || []).length;
  const summary = retentionDays === null
    ? `${fmt(sealedCount)} of ${fmt(total)} scans (every register) are already sealed. Sealing `
      + "is off — no more will seal automatically."
    : `${fmt(sealedCount)} of ${fmt(total)} scans (every register) are already sealed. At `
      + `${retentionDays} days, ${fmt(wouldSeal)} more would seal on the next pass.`;
  return tickTimeline({
    ticks,
    states: {
      sealed: { glyph: "✓", word: "sealed" },
      would: { glyph: "→", word: "would seal" },
      pinned: { glyph: "•", word: "pinned" },
    },
    legend: "✓ sealed · → would seal · • pinned — held back regardless of the window (the most "
      + "recent scans, across every register).",
    summary,
    ariaLabel: `${fmt(sealedCount)} of ${fmt(total)} scans are sealed`,
  });
}

// =================================================================== deadlines tab: SLA cutline

/**
 * `breached(t) = open − atOrBelow(t)`, combined across every scope's `AgeBin` for one severity —
 * an SLA window is ONE setting shared by `sca`/`sast`/`secrets` alike (config.ts's SLA_TARGETS
 * docstring: "the same window applies to every register"), never drawn per scope, so this has to
 * read every scope's bin at once rather than one at a time. `bins` is the caller's own per-scope
 * selection, already narrowed to one severity — this function knows nothing about scopes, the
 * payload's shape, or which scopes exist.
 *
 * `breached` IS `null`, NEVER A NUMBER, once `windowDays` exceeds `capDays` — a window past the
 * measured horizon has to be named as such, never guessed at from `overCap` rows whose exact age
 * was never recorded (see domain/settingsImpact.ts's `ageHistogram` docstring on `overCap`).
 * Below the cap, `overCap` rows are still counted as breached with no special case at all: their
 * age is only KNOWN to exceed `capDays`, and `capDays` itself is always >= `windowDays` in that
 * branch, so "older than the cap" already implies "older than the window" — the same arithmetic
 * `settingsImpact.test.ts`'s own cross-check against `openPastSla` already relies on.
 */
export function slaBreachModel(bins, windowDays, capDays) {
  const list = (bins || []).filter(Boolean);
  let unaged = 0;
  let overCap = 0;
  let atCap = 0;
  for (const bin of list) {
    unaged += bin.unaged || 0;
    overCap += bin.overCap || 0;
    atCap += atOrBelow(bin, capDays);
  }
  const finiteOpenTotal = atCap + overCap;
  const overCapWindow = windowDays > capDays;
  let breached = null;
  if (!overCapWindow) {
    let atWindow = 0;
    for (const bin of list) atWindow += atOrBelow(bin, windowDays);
    breached = finiteOpenTotal - atWindow;
  }
  return { breached, finiteOpenTotal, unaged, overCap, overCapWindow };
}

/**
 * The cutline's words: the live breach count (or the beyond-the-horizon refusal), how it
 * compares to the SAVED window, and the `unaged` population named rather than folded silently
 * into "breached" — `unaged` rows are never inside any window, in either direction, so a reader
 * who only saw the breach count would have no way to tell "past the window" from "nobody knows".
 */
export function slaCutlineModel({ bins, windowDays, savedDays, capDays, unit = "findings" }) {
  const model = slaBreachModel(bins, windowDays, capDays);
  const sameWindow = Number(savedDays) === Number(windowDays);
  const savedModel = sameWindow ? model : slaBreachModel(bins, savedDays, capDays);

  const headline = model.overCapWindow
    ? `Beyond the ${fmt(capDays)}-day measured horizon — findings that old are recorded only as `
      + "past the horizon, not by exact age, so a breach figure here would be a guess rather "
      + "than a measurement."
    : `${fmt(model.breached)} of ${fmt(model.finiteOpenTotal)} open ${unit} with a measured age `
      + `would be past a ${fmt(windowDays)}-day window.`;

  let savedNote = "";
  if (!sameWindow) {
    if (model.overCapWindow || savedModel.overCapWindow) {
      savedNote = `The saved window is ${fmt(savedDays)} day(s).`;
    } else {
      const diff = model.breached - savedModel.breached;
      savedNote = diff === 0
        ? `Same breach count as the saved ${fmt(savedDays)}-day window.`
        : `${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "fewer"} than the saved `
          + `${fmt(savedDays)}-day window (${fmt(savedModel.breached)} breached).`;
    }
  }

  const unmeasuredNote = model.unaged
    ? `${fmt(model.unaged)} open ${unit} have no measured open date and sit outside every `
      + "window — never counted as breached, never counted as in time."
    : "";

  return { model, savedModel, headline, savedNote, unmeasuredNote };
}

/**
 * The divergence note: whether the DRAFT's window for one severity differs from the CANONICAL
 * cross-surface constant — `boot.slaTargets` (`api_bootstrap`'s own `domain/config.ts::SLA_TARGETS`),
 * NEVER the per-register `effectiveSlaTargets` overlay (comparing against the overlay would
 * compare the draft to itself the moment any window has ever been customized, and the warning
 * could never fire again). `config.ts`'s own docstring: these windows are shared across every
 * surface "so the four surfaces cannot report different SLA attainment for the same estate", and
 * `settingsModel.js`'s `draftWarnings` already refuses to let a save past that line go by
 * silently — this is the STANDING companion to that confirm-dialog warning, visible the moment
 * the window differs rather than only once the reader reaches Save.
 *
 * PAYLOAD-FREE, DELIBERATELY: reads only `boot.slaTargets` (already on bootstrap, before
 * api_getSettingsImpact has necessarily arrived) and the draft's own window, so
 * `pages/settings.js` draws it outside `repaintReadouts()`'s `if (!impact) return` gate and it
 * is correct even when the impact payload never loads at all.
 */
export function slaDivergenceNote(windowDays, canonicalDays) {
  // Refused BEFORE the cast: Number(null) is 0, and 0 is finite (this codebase's standing
  // trap — figures.js's num(), settingsLogic.ts's numericOrNull). A missing canonical value is
  // not "diverged from day zero", it is unmeasured, so it is checked here before Number() ever
  // touches it.
  if (canonicalDays === null || canonicalDays === undefined) return "";
  const canonical = Number(canonicalDays);
  if (!Number.isFinite(canonical) || Number(windowDays) === canonical) return "";
  return `Differs from the ${fmt(canonical)}-day window the OS, AI and pipeline surfaces use `
    + "for this severity — the same finding will be inside its deadline on one dashboard and "
    + "past it on another.";
}

const SLA_CUTLINE_BUCKETS = 30;

/**
 * The SLA cutline: `createCutHistogram` (gas_shared) over the day axis, one instance per
 * severity. BUILT EXACTLY ONCE per severity — `pages/settings.js` constructs every instance
 * before the first `buildPanels()` call and only ever calls `.update()` on it afterwards, the
 * same discipline gas's own EPSS threshold slider keeps (`createRiskReadout`'s own comment) and
 * for the identical reason: the range fires `input` continuously while being dragged, and
 * rebuilding it mid-drag would silently abort the drag.
 *
 * `capDays` here is the STATIC axis bound, fixed at construction — the arithmetic itself always
 * reads a fresh `capDays` from `update()`'s own argument (the payload's `impact.capDays`), so a
 * change to the real constant can only ever move the axis's cosmetics, never the words.
 */
export function createSlaCutlineReadout({ sev, capDays = AGE_HISTOGRAM_CAP_DAYS, unit = "findings" }) {
  let onCutChange = null;
  const headlineEl = el("p", { class: "small", style: "margin:8px 0 0" });
  const savedEl = el("p", { class: "small muted", style: "margin:2px 0 0" });
  const cutHist = createCutHistogram({
    min: 0, max: capDays, step: 1, buckets: SLA_CUTLINE_BUCKETS,
    ariaLabel: `${sev} remediation window`,
    format: (v) => `${Math.round(v)}d`,
    axisNote: "Every scope's findings at this severity, combined — a CRITICAL finding gets the "
      + "same window whether it is a dependency, code, or a secret. Bar height is the square "
      + "root of the count.",
    barTip: (start, end, n) => `${Math.round(start)}-${Math.round(end)}d: ${fmt(n)} finding(s)`,
    onCut: (v) => { if (onCutChange) onCutChange(Math.round(v)); },
  });
  const node = el("div", {}, headlineEl, savedEl, cutHist.node);

  function update({ bins, windowDays, savedDays, capDays: liveCapDays, onCut }) {
    onCutChange = onCut || null;
    const cap = Number.isFinite(Number(liveCapDays)) ? Number(liveCapDays) : capDays;
    const m = slaCutlineModel({ bins, windowDays, savedDays, capDays: cap, unit });
    headlineEl.textContent = m.headline;
    savedEl.hidden = !m.savedNote;
    savedEl.textContent = m.savedNote;

    // Bucketed over the SLIDER'S OWN static [0, capDays] domain (the constructor's `capDays`,
    // not the live one) — the bars have to line up with the axis they are drawn on.
    const per = capDays / SLA_CUTLINE_BUCKETS;
    const counts = [];
    for (let i = 0; i < SLA_CUTLINE_BUCKETS; i++) {
      const t0 = Math.floor(i * per);
      const t1 = Math.floor((i + 1) * per);
      let c = 0;
      for (const bin of (bins || [])) { if (bin) c += atOrBelow(bin, t1) - atOrBelow(bin, t0); }
      counts.push(c);
    }
    cutHist.update({
      counts,
      cut: Math.min(windowDays, capDays),
      unmeasuredNote: m.unmeasuredNote,
    });
  }

  return { node, update };
}
