// Live readouts for the Settings page — what a control is currently doing to the register,
// computed from the api_getSettingsImpact payload and the in-memory draft. Pure DOM builders
// (no RPC, no page state) so settings.js stays readable: it fetches the payload once, and
// re-renders these into fixed host nodes as the draft changes.
//
// Two shapes appear here. Most readouts have no interactive element of their own (the splitBar,
// the retention timeline) and are simply rebuilt from scratch on every draft change — cheap, and
// simplest to get right. The risk classifier is the one exception: it owns a `<input type=range>`
// slider that the reader may be actively dragging when a change elsewhere triggers a repaint, and
// replacing that element mid-drag would silently abort the drag (the browser stops delivering
// `input` events to a node once it is removed from the document). So `createRiskReadout()` builds
// its skeleton — including the range input — ONCE and returns an `update()` that only ever
// rewrites attributes/text/children around it, never the input itself. See its comment below.

import { clear, el, splitBar } from "./ui.js";
import { breakdownFromCube, epssHistogram, ruleIsEmpty, ruleSentence } from "./riskCube.js";

function fmt(n) {
  return (n || 0).toLocaleString();
}

function pct(n, total) {
  return total ? ((n / total) * 100).toFixed(1) + "%" : "0.0%";
}

/**
 * Severity scope readout: a splitBar over `census.bySeverity`, one segment per severity in the
 * draft's scan scope (the `--sev-*` fill tokens, same as everywhere else severity appears) plus
 * a single "Not scanned" segment for the rest. The caption repeats every severity's count in
 * words — including the out-of-scope ones, named as such — so the bar is never the only way to
 * read the numbers.
 */
export function severityScopeReadout(census, draft, selectable) {
  const bySev = (census && census.bySeverity) || {};
  const total = (census && census.total) || 0;
  const segments = [];
  const parts = [];
  let inScope = 0;
  for (const sev of selectable) {
    const n = bySev[sev] || 0;
    if (draft.fetchSeverities.includes(sev)) {
      inScope += n;
      segments.push({ label: sev, value: n, tone: sev });
      parts.push(`${sev} ${fmt(n)}`);
    } else {
      parts.push(`${sev} ${fmt(n)} (not scanned)`);
    }
  }
  segments.push({ label: "Not scanned", value: Math.max(0, total - inScope), tone: "out" });
  return splitBar({
    segments,
    caption: `${parts.join(" · ")} — ${fmt(inScope)} of ${fmt(total)} findings scanned.`,
    ariaLabel: `${fmt(inScope)} of ${fmt(total)} findings are in the scan scope`,
  });
}

/** "N of M open findings (X%) <phrase>." — the shared shape for the vendor-fix / EOL headline. */
export function toggleHeadline(count, total, phrase) {
  return `${fmt(count)} of ${fmt(total)} open findings (${pct(count, total)}) ${phrase}.`;
}

/**
 * The static with/without split for a display toggle — deliberately NOT switch-dependent: this
 * is "what is out there", and `toggleReadoutNote` below is where the current switch state is
 * said. `includedLabel`/`excludedLabel` name the two sides in words (e.g. "Has a vendor fix" /
 * "No vendor fix"), so the tone (accent vs. hatched neutral) is never the only signal.
 */
export function toggleReadoutBar(count, total, includedLabel, excludedLabel) {
  const included = Math.max(0, total - count);
  return splitBar({
    segments: [
      { label: includedLabel, value: included, tone: "in" },
      { label: excludedLabel, value: count, tone: "out" },
    ],
    caption: `${includedLabel} ${fmt(included)} · ${excludedLabel} ${fmt(count)} — ${fmt(total)} total.`,
    ariaLabel: `${fmt(count)} of ${fmt(total)} ${excludedLabel.toLowerCase()}`,
  });
}

/** The one line that actually changes with the switch. */
export function toggleReadoutNote(count, total, on) {
  return on
    ? `All ${fmt(total)} counted.`
    : `${fmt(count)} findings hidden from every chart, table, KPI and export.`;
}

function riskRow(name, count, missing) {
  return el(
    "div",
    { class: "risk-row" },
    el("span", { class: "risk-row__name" }, name),
    el(
      "span",
      {},
      el("span", { class: "risk-row__count num" }, `${fmt(count)} fired`),
      missing ? el("span", { class: "risk-row__missing" }, `${fmt(missing)} never measured`) : null,
    ),
  );
}

/**
 * The high-risk classifier's live readout: one row per ENABLED clause, the rule as a sentence,
 * the total, the overlap caveat, and the EPSS histogram with its own threshold slider.
 *
 * Returns `{ node, update(cube, rule, { onThresholdChange }) }`. The skeleton — including the
 * `<input type="range">` — is built exactly once; `update()` only ever rewrites what is already
 * there. This is load-bearing, not a style choice: the range fires `input` continuously while
 * being dragged, and if `update()` (which every draft edit calls) tore down and rebuilt that
 * element, dragging it would silently stop moving after the first pixel — the node the browser
 * is delivering pointer events to would no longer be attached to the document.
 */
export function createRiskReadout() {
  const rowsHost = el("div", { class: "risk-breakdown" });
  const sentenceEl = el("p", { class: "risk-sentence" });
  const emptyEl = el(
    "p",
    { class: "risk-empty muted small" },
    "No signals enabled — every finding will read as unclassified.",
  );
  const caveatEl = el(
    "p",
    { class: "risk-caveat muted small" },
    "The clauses above can overlap on the same finding, so they do not sum to the total.",
  );

  const histBars = el("div", { class: "epss-hist" });
  const cutline = el("div", { class: "epss-cutline", "aria-hidden": "true" });
  const histWrap = el("div", { class: "epss-hist-wrap" }, histBars, cutline);
  const range = el("input", {
    type: "range", class: "epss-range", min: "0", max: "1", step: "0.01",
    "aria-label": "EPSS threshold slider",
  });
  const cutLabel = el("span", { class: "num" });
  const axis = el(
    "div", { class: "epss-axis small muted" },
    el("span", {}, "0.00"), cutLabel, el("span", {}, "1.00"),
  );
  const scaleNote = el(
    "p", { class: "epss-scale-note muted small" },
    "Bar height is the square root of the count — EPSS is skewed hard enough that a linear " +
    "scale would flatten everything above 0.25 to nothing. Hover a bar for its exact figure.",
  );
  const unmeasuredEl = el("p", { class: "risk-unmeasured muted small" });

  const node = el(
    "div", { class: "risk-readout" },
    rowsHost, sentenceEl, emptyEl, caveatEl,
    el("div", { class: "epss-hist-scroll" }, histWrap),
    range, axis, scaleNote, unmeasuredEl,
  );

  let onThreshold = null;
  range.addEventListener("input", () => {
    if (onThreshold) onThreshold(Number(range.value));
  });

  function update(cube, rule, { onThresholdChange } = {}) {
    onThreshold = onThresholdChange || null;
    const breakdown = breakdownFromCube(cube, rule);
    const empty = ruleIsEmpty(rule);

    clear(rowsHost);
    if (rule.kev) rowsHost.append(riskRow("CISA KEV", breakdown.kev, breakdown.kevMissing));
    if (rule.exploit) {
      rowsHost.append(riskRow("Public exploit", breakdown.exploit, breakdown.exploitMissing));
    }
    if (rule.epss) {
      rowsHost.append(
        riskRow(`EPSS ≥ ${rule.epssThreshold.toFixed(2)}`, breakdown.epss, breakdown.epssMissing),
      );
    }

    emptyEl.hidden = !empty;
    sentenceEl.hidden = empty;
    caveatEl.hidden = empty;
    if (!empty) {
      clear(sentenceEl);
      sentenceEl.append(
        `${ruleSentence(rule)} → `,
        el("strong", { class: "num" }, fmt(breakdown.anyOf)),
        ` of ${fmt(cube.total)} findings in scan scope are high risk (${pct(breakdown.anyOf, cube.total)}).`,
      );
    }

    range.value = String(rule.epssThreshold);
    cutLabel.textContent = `${rule.epssThreshold.toFixed(2)} (current cut)`;

    const hist = epssHistogram(cube, 20);
    clear(histBars);
    const max = Math.max(...hist.buckets, 1);
    const scale = (n) => (max ? (Math.sqrt(n) / Math.sqrt(max)) * 100 : 0);
    const per = 1 / hist.buckets.length;
    hist.buckets.forEach((n, i) => {
      const start = i * per;
      const bar = el("div", {
        class: `epss-bar${start >= rule.epssThreshold ? " above" : ""}`,
        title: `${start.toFixed(2)}–${(start + per).toFixed(2)}: ${fmt(n)} finding(s)`,
      });
      bar.style.height = n === 0 ? "0%" : `${Math.max(2, scale(n))}%`;
      histBars.append(bar);
    });
    cutline.style.left = `${rule.epssThreshold * 100}%`;

    unmeasuredEl.textContent =
      `${fmt(hist.unmeasured)} findings have no EPSS score and are never flagged by this clause.`;
  }

  return { node, update };
}

/**
 * The retention timeline: one tick per scan (newest first, matching the payload), sealed/
 * would-seal/pinned each carrying a distinct fill AND a glyph — the legend beneath states both
 * in words, including that a pinned scan is held back regardless of the window. Rebuilt whole on
 * every call; nothing in it is interactive.
 */
export function renderRetentionReadout(scans, draft) {
  const list = scans || [];
  const track = el("div", { class: "retention-timeline" });
  let sealedCount = 0;
  let wouldSeal = 0;
  for (const s of list) {
    if (s.sealed) sealedCount += 1;
    const willSeal = !s.sealed && !s.pinned
      && draft.retentionDays !== null && s.ageDays > draft.retentionDays;
    if (willSeal) wouldSeal += 1;
    const cls = s.sealed ? "is-sealed" : willSeal ? "is-would" : s.pinned ? "is-pinned" : "";
    const glyph = s.sealed ? "✓" : willSeal ? "→" : s.pinned ? "•" : "";
    const why = s.sealed ? "already sealed"
      : willSeal ? `would seal at ${draft.retentionDays}d`
        : s.pinned ? "always kept (most recent)"
          : "within the retention window";
    track.append(el(
      "div",
      { class: `retention-tick${cls ? " " + cls : ""}`, title: `${s.ageDays}d old — ${why}` },
      el("span", { class: "retention-tick__glyph", "aria-hidden": "true" }, glyph),
      el("span", { class: "retention-tick__bar" }),
    ));
  }
  const total = list.length;
  const summary = draft.retentionDays === null
    ? `${fmt(sealedCount)} of ${fmt(total)} scans are already sealed. Sealing is off — no ` +
      "more will seal automatically."
    : `${fmt(sealedCount)} of ${fmt(total)} scans are already sealed. At ${draft.retentionDays} ` +
      `days, ${fmt(wouldSeal)} more would seal on the next pass.`;
  return el(
    "div", { class: "retention-readout" },
    el("div", { class: "retention-timeline-scroll" }, track),
    el(
      "p", { class: "muted small" },
      "✓ sealed · → would seal · • pinned — held back regardless of " +
      "the window (the two most recent scans).",
    ),
    el("p", { class: "muted small" }, summary),
  );
}
