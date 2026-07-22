// MTTR & SLA — remediation performance from the durable ledger. Hero stat, trend
// charts, per-severity SLA table, posture bars. Never fetches from Wiz.

import {
  contributionWaterfall, destroyChart, fmtDuration, groupPalette, groupPie, groupTrendLines,
  openResolvedLines, stackedAgeBar, survivalCurve, trendLine,
} from "../charts.js";
import { bootstrap, swrCall } from "../store.js";
import {
  changeChip, clear, el, emptyState, fmtDays, helpTip, noFixHiddenNote, openSheet, scopeBar,
  sectionLabel, sevBadge, severityScopeFilter, skeleton,
} from "../ui.js";

// Keep in sync with RESOLUTION_BUCKET_LABELS in src/domain/remediation.ts (the client
// bundle can't import the TS domain module) — used only if an older cached payload
// somehow carries buckets without labels.
const RESOLUTION_LABELS = ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"];

// Timeframe presets for the Trends charts. null = no window (full history).
const TREND_WINDOWS = [
  ["5d", 5], ["2w", 14], ["30d", 30], ["60d", 60], ["90d", 90], ["All", null],
];

// The chosen window persists across visits in localStorage, stored by preset label so a
// stale or hand-edited value degrades to All. Some GAS iframe sandboxes block web storage
// (see attributionPrefill.js), hence the try/catch — blocked storage just means no recall.
const TREND_WINDOW_KEY = "mttrTrendWindow";
function loadTrendWindow() {
  try {
    const hit = TREND_WINDOWS.find(([label]) => label === localStorage.getItem(TREND_WINDOW_KEY));
    return hit ? hit[1] : null;
  } catch {
    return null;
  }
}
function saveTrendWindow(label) {
  try {
    localStorage.setItem(TREND_WINDOW_KEY, label);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// X-axis width presets for the survival curve (weeks). Purely a view zoom — the full
// curve is already in the payload, so switching windows never re-requests. Persisted by
// label like the Trends window; a stale/blocked value degrades to the widest (30w).
const SURVIVAL_WINDOWS = [["30w", 30], ["15w", 15], ["5w", 5]];
const SURVIVAL_WEEKS_KEY = "mttrSurvivalWeeks";
function loadSurvivalWeeks() {
  try {
    const hit = SURVIVAL_WINDOWS.find(([label]) => label === localStorage.getItem(SURVIVAL_WEEKS_KEY));
    return hit ? hit[1] : 30;
  } catch {
    return 30;
  }
}
function saveSurvivalWeeks(label) {
  try {
    localStorage.setItem(SURVIVAL_WEEKS_KEY, label);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// Generic recall/persist for the two-option in-card toggles (MTTR clock, SLA-quality
// series, distribution view). Same sandbox-tolerant try/catch as the window prefs above;
// an unknown or blocked value degrades to `fallback`.
function loadPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// A compact two-option segmented toggle, reusing the exact .seg-row / .seg-btn--sm /
// aria-pressed pattern as the Trends timeframe and survival-window controls (no invented
// control — DESIGN.md "earned familiarity"). `options` is [[label, value], …]; `onPick`
// gets the chosen value and is expected to persist + repaint.
function toggleRow(ariaLabel, options, current, onPick) {
  return el("div", { class: "seg-row", role: "group", "aria-label": ariaLabel },
    ...options.map(([label, value]) =>
      el("button", {
        type: "button", class: "seg-btn seg-btn--sm",
        "aria-pressed": String(value === current),
        onclick: () => onPick(value),
      }, label)));
}

// A chart card whose title row can carry an inline toggle on the right (via .chart-head)
// and whose title can be a helpTip (methodology moves off the always-on caption onto a
// hover, matching the table columns' convention). `box` is the .chart-box element.
function chartCard(title, box, opts = {}) {
  const h3 = opts.helpLines
    ? el("h3", {}, helpTip(title, opts.helpLines, { className: "help-label" }))
    : el("h3", {}, title);
  const head = opts.toggle ? el("div", { class: "chart-head" }, h3, opts.toggle) : h3;
  return el("div", { class: "chart-card" }, head, box);
}

// Open-past-SLA cell, shared by the hero mini, the per-severity table, and the
// by-domain table: "632 (77%)" — the breached count with its share of the open
// population in parentheses. "0" when nothing is open (pct is null then, not a fake
// 0%); "—" when the payload doesn't carry this metric at all (e.g. a stale
// pre-remediation cache).
function fmtOpenPastSla(o) {
  if (!o || o.open === null || o.open === undefined) return "—";
  if (!o.open) return "0";
  const pct = o.pct !== null && o.pct !== undefined ? `${o.pct.toFixed(0)}%` : "—";
  return `${(o.breached ?? 0).toLocaleString()} (${pct})`;
}

// Awaiting-vendor-fix summary for the hero mini: "N (x% of open)"; "—" when the payload
// doesn't carry the segment at all (a stale pre-actionable cache). pctOfOpen is null when
// nothing is open, so the share is dropped rather than shown as a fake 0%.
function fmtAwaiting(a) {
  if (!a || a.overall === null || a.overall === undefined) return "—";
  const pct = a.pctOfOpen !== null && a.pctOfOpen !== undefined
    ? ` (${a.pctOfOpen.toFixed(0)}% of open)` : "";
  return `${a.overall.toLocaleString()}${pct}`;
}

// Kaplan-Meier median formatter: the exact day count, "> X d" when the curve never drops to
// 50% within the observed window (heavy censoring — the true median is at least that far
// out), or "—" when there's no KM result at all (a stale pre-KM cached payload). `km` is a
// KMResult (or the null/undefined stand-in for one).
function fmtKmMedian(km) {
  if (!km) return "—";
  if (km.median !== null && km.median !== undefined) return fmtDays(km.median);
  if (km.medianLowerBound !== null && km.medianLowerBound !== undefined) {
    return `> ${fmtDays(km.medianLowerBound)}`;
  }
  return "—";
}

// Circular-arrows (refresh) glyph for the by-domain panel's single lens-swap button. Inline
// SVG with stroke:currentColor so it inherits the button's ink, like NAV_ICONS / CHEVRON_ICON.
const SWAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
  + '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';

// App-shell skeleton for the cold-load MTTR page — mirrors the real hero / Trends / Distribution
// / SLA hosts so the swap to live content doesn't reflow. Blocks are aria-hidden; the hero host
// carries the "Computing MTTR" announcement the old muted "Computing…" text used to give. The
// caller leaves the by-domain host (below the fold, whole-chain only) cleared.
function renderMttrSkeleton({ heroHost, chartsHost, survivalHost, slaHost }) {
  clear(heroHost).append(
    el("div", { class: "hero", role: "status", "aria-label": "Computing MTTR" },
      el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
        skeleton("title", { width: "150px" }),
        skeleton("stat", { width: "96px" })),
      el("div", { style: "margin-top:10px" }, skeleton("line", { width: "60%" })),
      el("div", { class: "hero-minis" },
        ...[0, 1, 2, 3].map(() => el("div", {},
          el("div", { style: "margin-bottom:8px" }, skeleton("line", { width: "84px" })),
          skeleton("stat", { width: "56px" }))))),
  );
  clear(chartsHost).append(
    el("div", { class: "section-head" },
      skeleton("line", { width: "110px" }),
      skeleton("pill", { width: "180px" })),
    el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" },
      ...[0, 1].map(() => el("div", { class: "chart-card" },
        el("div", { style: "margin-bottom:12px" }, skeleton("line", { width: "140px" })),
        el("div", { class: "chart-box" }, skeleton("chart"))))),
  );
  clear(survivalHost).append(
    el("div", { style: "margin:28px 0 12px" }, skeleton("line", { width: "130px" })),
    el("div", { class: "chart-card" },
      el("div", { style: "margin-bottom:12px" }, skeleton("line", { width: "220px" })),
      el("div", { class: "chart-box chart-box--tall" }, skeleton("chart"))),
  );
  clear(slaHost).append(
    el("div", { style: "margin:28px 0 12px" }, skeleton("line", { width: "180px" })),
    el("div", { class: "table-wrap", style: "padding:14px" },
      ...[0, 1, 2, 3, 4].map(() => el("div", { style: "margin:10px 0" }, skeleton("line")))),
  );
}

export async function renderMttr(main, _params, ctx) {
  const boot = await bootstrap();

  // Which severities feed every metric on this page. Defaults to the app-wide display
  // setting ("which severities every page shows") so MTTR opens scoped like Overview,
  // falling back to all selectable if that setting is somehow empty. Page-local and
  // non-persisted: resets to the display setting on each visit.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  main.append(
    el("div", { class: "page-head" },
      el("h1", {}, "MTTR & SLA"),
      severityScopeFilter({
        selectable: boot.palette.selectable, scope: sevScope,
        onApply: () => load(), ariaContext: "MTTR",
      })),
    el("p", { class: "page-sub" },
      "How fast risk gets closed — measured over observed lifecycles. " +
      "The SLA clock starts once a vendor fix is available."),
  );

  const scopeChips = scopeBar({
    domain: ctx.domain, supportGroup: ctx.supportGroup, onClear: ctx.clearScope,
  });
  if (scopeChips) main.append(scopeChips);
  if (boot.settings.showNoFix === false) main.append(noFixHiddenNote());

  const heroHost = el("div", {});
  const chartsHost = el("div", {});
  const survivalHost = el("div", {});
  const slaHost = el("div", {});
  const byDomainHost = el("div", {});
  main.append(heroHost, chartsHost, survivalHost, slaHost, byDomainHost);

  // Scope comes from the global Value Chain + Support group filters in the sidebar;
  // "" = no filter on that dimension.
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";

  // Trends timeframe (days back from now; null = full history). Recalled from
  // localStorage across visits; falls back to All where storage is unavailable.
  let trendWindowDays = loadTrendWindow();
  // Survival-curve x-axis window (weeks); recalled across visits, defaults to 30w.
  let survivalWeeks = loadSurvivalWeeks();
  // In-card toggle modes, recalled across visits. MTTR-over-time clock (KM headline vs the
  // naive closed-only comparison), SLA-quality series (cohort attainment vs net-flow burn),
  // and the distribution view (survival curve vs time-to-resolve histogram).
  let overTimeMode = loadPref("mttrOverTimeMode", ["km", "naive"], "km");
  let slaQualMode = loadPref("mttrSlaQualMode", ["attainment", "burn"], "attainment");
  let distMode = loadPref("mttrDistMode", ["survival", "histogram"], "survival");
  // By-domain "MTTR by domain" chart clock: KM median (censoring-aware, the default) vs the
  // naive closed-only comparison. Persisted across visits like the other in-card toggles.
  let byDomainClock = loadPref("mttrByDomainClock", ["km", "naive"], "km");
  // Which lens the merged by-domain panel shows: "share" (resolved-share pie) or "contribution"
  // (MTTR-wait waterfall). Persisted across visits like the clock above.
  let byDomainShareView = loadPref("mttrByDomainShareView", ["share", "contribution"], "share");

  await load();

  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  function scopeParam() {
    return sevScope.length === boot.palette.selectable.length ? null : [...sevScope];
  }

  async function load() {
    // Put every section into a pending state before the await, so a severity change never
    // leaves the charts / SLA table showing the old scope's numbers. The skeleton mirrors the
    // real layout so the swap to live content doesn't reflow; by-domain stays cleared.
    renderMttrSkeleton({ heroHost, chartsHost, survivalHost, slaHost });
    clear(byDomainHost);
    const params = { domain, supportGroup, severities: scopeParam() };

    // Progressive paint over two parallel RPCs that share the same server cache entries
    // getMttrPage's slices use (so a warm revisit is still a single-shot repaint):
    //   - api_getMttr is the summary alone — no trend reconstruction — so the hero, survival
    //     curve and SLA table land as soon as the (cheaper) KM summary is ready.
    //   - api_getMttrPage carries trends + byDomain, the heaviest slice (per-point KM over the
    //     reconstructed history); it fills the chart cards, the per-domain section, and the
    //     hero's history-based change chips when the reconstruction finishes.
    // The full paint always supersedes the summary for the hero, so a slow summary
    // revalidation can never drop the chips a completed full paint drew.
    let fullDone = false;
    const paintSummary = (mttr) => {
      if (fullDone) return;
      renderHero(mttr, { history: [] }); // chips need trend history — they arrive with the full paint
      renderSurvivalCurve(mttr);
      renderSla(mttr);
    };
    const paintFull = (data) => {
      fullDone = true;
      renderHero(data.mttr, data.trends);
      renderCharts(data.trends, data.mttr);
      renderSurvivalCurve(data.mttr);
      renderSla(data.mttr);
      renderByDomain(data.byDomain);
    };
    const summary = swrCall("api_getMttr", params, paintSummary)
      .then(paintSummary).catch(() => {});
    const full = swrCall("api_getMttrPage", params, paintFull)
      .then(paintFull).catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[mttr] getMttrPage failed:", e);
      });
    await Promise.allSettled([summary, full]);
  }

  /** Per-domain remediation, shown only at the whole-chain view (the server omits it
   *  when a single value chain is selected). A value chain is composed of domains, so
   *  this is how each component is doing.
   *
   *  Above the table, a chart pair shows how the domains participate in MTTR — both keyed
   *  to the same canonical `byDomain.trend.groups` (resolved-desc, capped at 5 + pooled
   *  "Other") so a domain wears one hue across the two: a "Remediation share" pie
   *  partitioning the *resolved* population (who's carrying the remediation work, tooltip
   *  carrying each domain's median MTTR), and an "MTTR by domain" line replaying each
   *  domain's median MTTR in days over scan history. This section is all-time like its
   *  table — the Trends timeframe toggle is deliberately not wired in. */
  function renderByDomain(byDomain) {
    clear(byDomainHost);
    if (!byDomain || !byDomain.rows.length || boot.domainNames.length < 2) return;

    // Chart pair over the domain trend the server ships alongside the table. Each card swaps
    // its canvas for a muted message when there's nothing to draw (copied from overview.js's
    // Breakdown helpers). Both share one groupPalette so a domain's hue is stable across them.
    const pieCanvas = el("canvas", {});
    const pieMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCanvas = el("canvas", {});
    const lineMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCaption = el("p", { class: "chart-caption muted" });
    const wfCanvas = el("canvas", {});
    const wfMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    // The pie and the waterfall share one switchable card, so they share one caption too.
    const shareCaption = el("p", { class: "chart-caption muted" });

    // Swap a card between its live canvas and a centered muted message.
    function showChart(canvas, msg) {
      msg.style.display = "none";
      canvas.style.display = "";
    }
    function showMsg(canvas, msg, text) {
      destroyChart(canvas);
      canvas.style.display = "none";
      msg.textContent = text;
      msg.style.display = "";
    }

    const trend = byDomain.trend;
    const groups = (trend && trend.groups) || [];
    const colors = groupPalette(groups);
    const inGroups = new Set(groups);
    // Rows outside the canonical groups pool into "Other" — the pie sums their resolved
    // share; the line's Other series is the same pooled remainder the server replays.
    const resolvedOther = byDomain.rows
      .filter((r) => !inGroups.has(r.domain))
      .reduce((a, r) => a + (r.resolved ?? 0), 0);
    const series = groups.map((name) => ({ name, color: colors.get(name) }));
    if (resolvedOther > 0) series.push({ name: "Other", color: colors.get("Other") });

    // Waterfall steps: each domain's remediation wait-time = resolved × KM median (finding·days),
    // an additive proxy for how much it drives the overall MTTR (the KM median itself doesn't
    // decompose — see the chart's help). Fall back to the naive median when KM is censored to null,
    // and drop any domain with no resolved work or no usable median. Same canonical groups/hues as
    // the pie and line; rows outside the groups pool into an additive "Other" (burden sums cleanly
    // per domain, unlike a median).
    const byNameWf = new Map(byDomain.rows.map((r) => [r.domain, r]));
    const burdenOf = (r) => {
      const m = r && (r.kmMedian ?? r.median);
      const n = (r && r.resolved) ?? 0;
      // Whole finding·days — the median is fractional, but sub-day precision on a ~700 total is
      // just label noise. Rounding each step keeps the drawn Total (their sum) consistent.
      return m != null && n > 0 ? Math.round(n * m) : 0;
    };
    const wfSteps = groups
      .map((name) => ({ label: name, value: burdenOf(byNameWf.get(name)), color: colors.get(name) }))
      .filter((s) => s.value > 0);
    const wfOther = byDomain.rows
      .filter((r) => !inGroups.has(r.domain))
      .reduce((a, r) => a + burdenOf(r), 0);
    if (wfOther > 0) wfSteps.push({ label: "Other", value: wfOther, color: colors.get("Other") });

    const naivePts = (trend && trend.points) || [];
    const kmPts = (trend && trend.kmPoints) || [];
    // ≥2 scan points = a drawable trend. kmPoints and points share one point-per-flat-scan
    // backbone, so when one is drawable both are — the toggle appears together with the chart.
    const canToggleClock = kmPts.length >= 2 && naivePts.length >= 2;

    // Line: per-domain median MTTR (days) replayed over scan history — KM by default (open
    // findings censored), with the naive closed-only median available via the card toggle.
    function paintLine() {
      const usingKm = byDomainClock === "km";
      const pts = usingKm ? kmPts : naivePts;
      lineCaption.textContent = usingKm
        ? "Kaplan–Meier median time-to-remediation (days) by domain, per scan — still-open findings censored."
        : "Naive median MTTR (days) by domain, per scan — closed findings only.";
      if (pts.length < 2) {
        showMsg(lineCanvas, lineMsg, "Trend appears after the second saved scan.");
        return;
      }
      showChart(lineCanvas, lineMsg);
      groupTrendLines(lineCanvas, pts, series, {
        unit: "days",
        nullAsGap: true,
        describe: usingKm
          ? "Kaplan–Meier median time-to-remediation in days per domain over scan history."
          : "Naive median MTTR in days per domain over scan history.",
      });
    }

    // KM ⇄ Naive clock toggle for the by-domain line — same .seg-row/.seg-btn--sm pattern as
    // the "MTTR over time" card. Buttons hold their own refs so a pick can flip aria-pressed and
    // repaint the one canvas without rebuilding the sheet.
    const kmClockBtn = el("button", {
      type: "button", class: "seg-btn seg-btn--sm",
      "aria-pressed": String(byDomainClock === "km"), onclick: () => pickClock("km"),
    }, "KM");
    const naiveClockBtn = el("button", {
      type: "button", class: "seg-btn seg-btn--sm",
      "aria-pressed": String(byDomainClock === "naive"), onclick: () => pickClock("naive"),
    }, "Naive");
    function pickClock(v) {
      byDomainClock = v;
      savePref("mttrByDomainClock", v);
      kmClockBtn.setAttribute("aria-pressed", String(v === "km"));
      naiveClockBtn.setAttribute("aria-pressed", String(v === "naive"));
      paintLine();
    }
    const lineToggle = canToggleClock
      ? el("div", { class: "seg-row", role: "group", "aria-label": "MTTR by domain clock" },
        kmClockBtn, naiveClockBtn)
      : null;
    const lineHelp = [
      "KM: Kaplan–Meier median days from first detection to remediation per domain, replayed " +
        "as of each scan; still-open findings censored, so a wave of fresh open findings can't " +
        "bias it down. The principal figure.",
      "Naive: median of closed findings only per domain, per scan — the biased comparison KM " +
        "corrects for, kept only to compare.",
    ];
    const lineTitle = el("h3", {}, helpTip("MTTR by domain", lineHelp, { className: "help-label" }));
    const lineHead = lineToggle ? el("div", { class: "chart-head" }, lineTitle, lineToggle) : lineTitle;

    // Unified by-domain panel: the "Remediation share" pie and the "Domain contribution to MTTR"
    // waterfall are two lenses on the same domains (who carries the resolved work vs who owns the
    // remediation wait), so they share one card switched by a segmented toggle instead of two
    // separate cards. It sits in a row with the "MTTR by domain" line; the chosen lens persists.
    const shareHelp = [
      "Each domain's share of the resolved findings the MTTR median runs over — who is carrying " +
        "the remediation work. Hover a slice for that domain's KM median.",
    ];
    const wfHelp = [
      "Ranks domains by remediation wait-time — resolved findings × that domain's KM median MTTR " +
        "(finding·days) — stacked to a running total. A tall step is a big lever on the overall figure.",
      "A proxy, not an exact split: the overall KM median is a censored-survival statistic, not a " +
        "weighted average of per-domain medians, so the headline MTTR can't be decomposed exactly.",
    ];
    const shareTitleHost = el("h3", {}); // retitled per lens by applyShareView
    // A single circular-arrows button swaps the two lenses (share ⇄ contribution). The card title
    // names the active lens, so one icon toggle reads cleaner than two buttons; its aria-label /
    // title announce what the next click switches to (updated in applyShareView).
    const swapBtn = el("button", { type: "button", class: "chart-swap" });
    swapBtn.innerHTML = SWAP_ICON;
    swapBtn.addEventListener("click", () =>
      pickShareView(byDomainShareView === "share" ? "contribution" : "share"));
    // Both canvases live in one box (same height as the line card so the row aligns); the inactive
    // one starts hidden so there's no flash before the first paint in the rAF below.
    pieCanvas.style.display = byDomainShareView === "share" ? "" : "none";
    wfCanvas.style.display = byDomainShareView === "contribution" ? "" : "none";
    const shareCard = el("div", { class: "chart-card" },
      el("div", { class: "chart-head" }, shareTitleHost, swapBtn),
      el("div", { class: "chart-box" }, pieCanvas, pieMsg, wfCanvas, wfMsg),
      shareCaption);

    // Switch the lens: flip aria-pressed, retitle with the matching help, tear down the hidden
    // chart, and paint the active one (each paint fn shows its own canvas / empty message).
    function applyShareView(view) {
      byDomainShareView = view;
      // The label names what the *next* click switches to (the title already names the current lens).
      const nextLabel = view === "share" ? "Show domain contribution to MTTR" : "Show remediation share";
      swapBtn.setAttribute("aria-label", nextLabel);
      swapBtn.title = nextLabel;
      clear(shareTitleHost).append(
        view === "share"
          ? helpTip("Remediation share", shareHelp, { className: "help-label" })
          : helpTip("Domain contribution to MTTR", wfHelp, { className: "help-label" }));
      const [hideCanvas, hideMsg] = view === "share" ? [wfCanvas, wfMsg] : [pieCanvas, pieMsg];
      destroyChart(hideCanvas);
      hideCanvas.style.display = "none";
      hideMsg.style.display = "none";
      if (view === "share") paintPie(); else paintWaterfall();
    }
    function pickShareView(view) {
      savePref("mttrByDomainShareView", view);
      applyShareView(view);
    }

    const chartPair = el("div", { class: "chart-grid", style: "align-items:start" },
      shareCard,
      el("div", { class: "chart-card" },
        lineHead,
        el("div", { class: "chart-box" }, lineCanvas, lineMsg),
        lineCaption),
    );

    // Pie: each domain's share of resolved findings — the population the MTTR median runs
    // over. Tooltip detail carries the matching per-domain median. Canonical groups/hues
    // stay fixed (slices resize, never recolor).
    function paintPie() {
      const byName = new Map(byDomain.rows.map((r) => [r.domain, r]));
      shareCaption.textContent = "Each domain's share of resolved findings — the population feeding MTTR.";
      const slices = groups
        .map((name) => {
          const r = byName.get(name);
          return {
            label: name,
            value: r?.resolved ?? 0,
            color: colors.get(name),
            detail: "KM median " + fmtDuration(r?.kmMedian),
          };
        })
        .filter((s) => s.value > 0);
      const other = byDomain.rows
        .filter((r) => !inGroups.has(r.domain))
        .reduce((a, r) => a + (r.resolved ?? 0), 0);
      if (other > 0) slices.push({ label: "Other", value: other, color: colors.get("Other") });
      if (!slices.length) {
        showMsg(pieCanvas, pieMsg, "No resolved findings to partition.");
        return;
      }
      showChart(pieCanvas, pieMsg);
      groupPie(pieCanvas, slices, { subject: "Resolved findings by domain" });
    }

    // Waterfall: each domain's remediation wait-time (resolved × KM median) building to the total —
    // a taller step is a bigger lever on the overall MTTR. Ordered biggest-driver first so the top
    // contributors read left-to-right; the pooled "Other" and grounded Total come last.
    function paintWaterfall() {
      shareCaption.textContent = "Each domain's remediation wait-time (resolved × KM median) building to "
        + "the total — a taller step drives the overall MTTR more.";
      if (!wfSteps.length) {
        showMsg(wfCanvas, wfMsg, "No resolved findings to attribute.");
        return;
      }
      showChart(wfCanvas, wfMsg);
      contributionWaterfall(
        wfCanvas,
        [...wfSteps].sort((a, b) => b.value - a.value),
        { unit: "finding·days", subject: "Domain contribution to remediation wait" },
      );
    }
    // Column headers carry the two new metrics' definitions via helpTip, matching the
    // per-severity table's convention in renderSla above.
    const columns = [
      ["Domain", null],
      ["Median MTTR (KM)",
        ["Kaplan–Meier median time-to-remediation for this domain — the principal MTTR figure. " +
          "Still-open findings count as censored instead of being ignored, so it isn't biased " +
          "low by fresh fast-patched vulns."]],
      ["Median (naive)",
        ["Median days from first detection to remediation for this domain, counting closed " +
          "findings only — no censoring. Biased low by a wave of fresh open findings, which is " +
          "what the KM median corrects for; kept only for comparison."]],
      ["MTTR p90",
        ["Kaplan–Meier 90th-percentile time-to-remediation — the slow tail. Nine in ten " +
          "findings beat it; one in ten is slower. Censoring-aware like the KM median (read off " +
          "the same survival curve), so the tail isn't biased low by fresh fast-patched vulns; " +
          "shows \"—\" when too much is still open to observe it."]],
      ["In SLA (of resolved)", null],
      ["Open past SLA",
        ["Open findings already older than their severity's SLA target, measured from when " +
          "a vendor fix became available. Unlike In-SLA % (which only scores resolved " +
          "findings), an aged-out open CRITICAL counts here."]],
      ["Open", null],
      ["Resolved", null],
    ];
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...columns.map(([h, lines]) => el("th", { scope: "col" },
          lines ? helpTip(h, lines, { className: "help-label" }) : h)))),
    );
    const tbody = el("tbody", {});
    for (const r of byDomain.rows) {
      tbody.append(el("tr", {},
        el("td", {}, r.domain),
        el("td", { class: "num num--key" }, fmtDays(r.kmMedian)),
        el("td", { class: "num muted small" }, fmtDays(r.median)),
        el("td", { class: "num" }, fmtDays(r.p90)),
        el("td", { class: "num" }, r.slaPct != null ? `${r.slaPct.toFixed(0)}%` : "—"),
        el("td", { class: "num" }, fmtOpenPastSla(r.openPastSla)),
        el("td", { class: "num" }, (r.open ?? 0).toLocaleString()),
        el("td", { class: "num" }, (r.resolved ?? 0).toLocaleString()),
      ));
    }
    table.append(tbody);
    const tableWrap = el("div", { class: "table-wrap" }, table);

    // Awaiting-vendor-fix findings aren't a column (they don't breach any SLA) — a footnote
    // sums the per-domain `awaiting` counts so the excluded population is still visible.
    // Hidden entirely when the vendor-fix filter is off (the counts arrive zeroed anyway, and
    // the page-level honesty note already covers it).
    const awaitingTotal = byDomain.rows.reduce((a, r) => a + (r.awaiting ?? 0), 0);
    const footnote = boot.settings.showNoFix !== false && awaitingTotal > 0
      ? el("p", { class: "small muted", style: "margin:8px 0 0" },
        `${awaitingTotal.toLocaleString()} open finding${awaitingTotal === 1 ? "" : "s"} across `
        + "these domains are awaiting a vendor fix — excluded from Open past SLA until a fix appears.")
      : null;

    // Resolved history the server set aside for carrying no domain inputs — compacted episodes
    // and imported/pre-triage rows that could only ever read as Unassigned. Kept out of the
    // split so the breakdown isn't swamped by a fake Unassigned domain with no live counterpart;
    // this note keeps the set-aside population honest. Optional-chained so a stale payload
    // lacking `excluded` degrades to no note rather than throwing.
    const excludedResolved = byDomain.excluded?.resolved ?? 0;
    const excludedNote = excludedResolved > 0
      ? el("p", { class: "small muted", style: "margin:8px 0 0" },
        `${excludedResolved.toLocaleString()} resolved finding${excludedResolved === 1 ? "" : "s"} `
        + "from sealed history are excluded from this breakdown — they carry no domain inputs and "
        + "can't be attributed to a value chain.")
      : null;

    // Progressive disclosure: the whole breakdown opens in a right-drawer instead of
    // stacking on the page. openSheet calls renderBody synchronously, so the paint rAF
    // scheduled here fires after the canvases are attached to the (animating) sheet.
    function renderBody(body) {
      body.append(chartPair, tableWrap);
      if (footnote) body.append(footnote);
      if (excludedNote) body.append(excludedNote);
      requestAnimationFrame(() => {
        applyShareView(byDomainShareView); // paints the active lens (pie or waterfall)
        paintLine();
      });
    }

    byDomainHost.append(sectionLabel("By domain"));
    byDomainHost.append(el("p", { class: "small muted", style: "margin:-6px 0 10px" },
      "Per-domain remediation — share of resolved work, each domain's contribution to MTTR, "
      + "the KM median trend, and a full breakdown table."));
    byDomainHost.append(el("button", {
      type: "button",
      // Wider default than other sheets: this one carries a trend chart *and* a full data
      // table (8 columns) side by side, which cramps hard at the shared 520px default. 820px
      // gives the table room to breathe on a normal desktop viewport while still clamping to
      // 94vw on narrow ones. minWidth keeps a manual drag from shrinking the table into
      // uselessness; storageKey remembers whatever width the user settles on across opens,
      // same as the trend-window/survival-window prefs above.
      onclick: () => openSheet(renderBody, {
        title: "By domain",
        subtitle: "Remediation for each domain in the value chain.",
        width: "min(820px, 94vw)",
        minWidth: 480,
        storageKey: "sheetWidthByDomain",
      }),
    }, "Open by-domain breakdown →"));
  }

  function renderHero(mttr, trends) {
    clear(heroHost);
    if (!mttr.rowCount) {
      heroHost.append(emptyState(
        "No lifecycle data yet.",
        "MTTR needs at least one saved scan with resolved findings.",
      ));
      return;
    }
    const hist = trends.history;
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    // The prev snapshot (mttr_history) is global across chain/support/severity, while the
    // current values are scoped by the active filters. Diffing them would show a fake delta
    // (a small domain's 5d vs the global 45d prev reads as "−40d"), so only show the change
    // chips at the unscoped whole-chain / all-severities view where the populations match.
    // The vendor-fix filter folds in too: with it off, the current values exclude no-fix
    // findings while mttr_history's snapshots never did, so a chip would diff filtered
    // against unfiltered populations exactly like a domain/support/severity scope would.
    const scoped = boot.settings.showNoFix === false
      || scopeParam() !== null || domain || supportGroup;

    // `remediation` is additive on the server (see the plan) — a stale cached response
    // from before the rollout won't carry it, so every read below is optional-chained and
    // every affected mini/cell degrades to "—" rather than throwing.
    const rem = mttr.remediation;
    const km = rem?.km; // KMResult — the primary MTTR methodology now
    // Actionable-clock open-past-SLA, falling back to the from-detection value for a stale
    // pre-actionable cache (both share the {open, breached, pct} shape).
    const openPastSla = rem?.openPastSlaActionable?.overall ?? rem?.openPastSla?.overall;
    const overallPctiles = rem?.pctiles?.overall; // {p50, p90, count}
    // Censoring-aware overall p90 (same survival curve as the KM median), replacing the naive
    // closed-only p90. `undefined` means a stale pre-kmP90 cache → fall back to the naive p90;
    // `null` means present but unobservable under censoring → renders "—" (never the naive one).
    const overallKmP90 = rem?.kmP90;
    const awaiting = rem?.awaiting; // {perSev, overall, openTotal, pctOfOpen}

    const minis = el("div", { class: "hero-minis" });
    // The four numbers a reader acts on beside the headline MTTR: how much resolved on
    // time, how much open work has already breached, the slow tail, and how old the open
    // backlog is. The naive closed-only comparison now lives on the "MTTR over time"
    // toggle, the actionable clock is dropped from the default view, and awaiting-vendor-fix
    // moves to the source line below — so this band matches Overview's 3–4-tile rhythm.
    const miniDefs = [
      // "of resolved" makes the survivorship explicit: In-SLA % scores only resolved
      // findings, so it can look healthy while the open backlog ages (Open past SLA next).
      ["In SLA (of resolved)", mttr.slaPct !== null ? `${mttr.slaPct.toFixed(1)}%` : "—",
        !scoped && prev && prev.sla_pct !== null && mttr.slaPct !== null
          ? changeChip(mttr.slaPct, prev.sla_pct, { invert: true, suffix: "%" }) : null],
      // Open findings already past their SLA target — unlike In SLA %, this scores open
      // findings too. Up is worse, same as every other count-of-risk chip here, so no invert.
      ["Open past SLA", fmtOpenPastSla(openPastSla),
        !scoped && prev && prev.open_past_sla !== null && prev.open_past_sla !== undefined &&
          openPastSla && openPastSla.breached !== null && openPastSla.breached !== undefined
          ? changeChip(openPastSla.breached, prev.open_past_sla) : null],
      ["MTTR p90", fmtDays(overallKmP90 !== undefined ? overallKmP90 : overallPctiles?.p90), null],
      // p90 of open-finding age, not the single oldest — labelled to match the table below.
      ["Open age p90", fmtDays(mttr.oldestDays),
        !scoped && prev && prev.oldest_open_days !== null && mttr.oldestDays !== null
          ? changeChip(mttr.oldestDays, prev.oldest_open_days, { fmt: fmtDays }) : null],
    ].filter(Boolean);
    for (const [label, value, chip] of miniDefs) {
      minis.append(el("div", {},
        el("div", { class: "mini-label" }, label),
        el("div", { class: "mini-value num" }, value, chip || null),
      ));
    }
    const resolved = mttr.overall.resolved ?? 0;
    const open = mttr.overall.open ?? 0;
    // Findings whose severity never normalized to a real value — counted in every total
    // above (rowCount, resolved, open) but invisible in the per-severity table unless the
    // UNKNOWN row below is present. Surfacing the count here makes that gap legible instead
    // of silently letting hero and table totals disagree.
    const unclassified = (mttr.perSev.UNKNOWN?.open ?? 0) + (mttr.perSev.UNKNOWN?.resolved ?? 0);
    // The metric itself (label + value) is the hover/focus target — no separate "i" glyph.
    // No change chip on either KM stat: mttr_history only ever persisted the naive median
    // (now a mini above), never a KM series, so there's nothing to diff against.
    // The single hero value (DESIGN.md: at most one per page). The mean (KM · RMST) is no
    // longer a second headline stat — it survives as a marker on the survival curve below,
    // pointed to from the last helpTip line, so no methodology is lost.
    const metric = helpTip(
      [
        el("div", { class: "label" }, "Median MTTR (Kaplan–Meier)" + (domain ? ` — ${domain}` : "")),
        el("div", { class: "hero-value num" }, fmtKmMedian(km)),
      ],
      [
        "Kaplan–Meier median days from first detection to remediation. Still-open findings " +
          "count as censored observations instead of being ignored, so a wave of fresh open " +
          "findings can't bias this down.",
        "\"> X d\" means the curve never dropped to 50% within the observed window — over " +
          "half of tracked findings are still open, so the true median is at least that " +
          "many days out.",
        "A vuln that disappears between scans counts as resolved.",
        "Mean remediation time (KM · RMST) is marked on the survival curve below.",
      ],
      { className: "hero-metric" },
    );
    // Secondary metric beside the hero — the naive median (closed findings only), the biased
    // comparison the KM headline corrects for. Deliberately a step below the 2rem hero value
    // (DESIGN.md: one hero value per page) while still reading beside the headline. It's the
    // one MTTR figure with a persisted history series, so it keeps the change chip (only at
    // the unscoped view, where the current population matches the global snapshot).
    const naiveChip = !scoped && prev && prev.median_days !== null && prev.median_days !== undefined
      && km?.naiveMedian !== null && km?.naiveMedian !== undefined
      ? changeChip(km.naiveMedian, prev.median_days, { fmt: fmtDays })
      : null;
    const naiveStat = helpTip(
      [
        el("div", { class: "label" }, "Median (naive, closed)"),
        el("div", { class: "kpi-value num" }, fmtDays(km?.naiveMedian), naiveChip),
      ],
      [
        "Median days from first detection to remediation, counting closed findings only — no " +
          "censoring. A wave of fresh open findings biases this down, which is exactly what " +
          "the Kaplan–Meier headline corrects for.",
      ],
      { className: "hero-metric" },
    );
    // Awaiting-vendor-fix moves off its own tile onto the source line — the honest-state
    // context stays legible without spending a KPI slot. Dropped when the vendor-fix filter
    // is off (the count arrives zeroed and the page-level honesty note already covers it).
    const awaitingClause = boot.settings.showNoFix !== false && awaiting && awaiting.overall
      ? ` · ${fmtAwaiting(awaiting)} awaiting vendor fix`
      : "";
    heroHost.append(
      el("div", { class: "hero" },
        el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
          metric, naiveStat),
        el("div", { class: "hero-src" },
          `${mttr.rowCount.toLocaleString()} tracked lifecycle(s) in the durable base · ` +
          `${resolved.toLocaleString()} resolved · ${open.toLocaleString()} open` +
          (unclassified > 0
            ? ` · ${unclassified.toLocaleString()} unclassified severity`
            : "") +
          awaitingClause),
        minis,
      ),
    );
  }

  /** The distribution — one card that toggles between the Kaplan–Meier survival curve
   *  (cumulative S(t)) and its binned-density companion, the time-to-resolve histogram.
   *  `rem` missing entirely means a stale pre-KM cache (nothing shown); a curve with no
   *  points AND no buckets means genuinely no resolved findings yet (a muted note instead
   *  of an empty chart). The survival curve keeps only its two KM markers (median + RMST
   *  mean) — the naive closed-only comparison now lives on the "MTTR over time" toggle. */
  function renderSurvivalCurve(mttr) {
    clear(survivalHost);
    const rem = mttr.remediation;
    if (!rem) return;
    const hasCurve = !!rem.km?.curve?.length;
    const hasBuckets = !!(rem.buckets && rem.buckets.total);
    if (!hasCurve && !hasBuckets) {
      survivalHost.append(sectionLabel("Distribution"));
      survivalHost.append(el("p", { class: "muted small" },
        "Not enough resolved findings yet to draw the distribution — it appears once the " +
        "first remediation is recorded."));
      return;
    }

    const modes = [];
    if (hasCurve) modes.push("survival");
    if (hasBuckets) modes.push("histogram");
    const mode = modes.includes(distMode) ? distMode : modes[0];

    // Section-head controls: the view toggle (survival ⇄ histogram, only when both draw)
    // plus the survival x-axis width control, the latter shown only while the curve is up.
    const controls = el("div", { style: "display:flex; gap:12px; flex-wrap:wrap" });
    if (modes.length > 1) {
      controls.append(toggleRow("Distribution view",
        [["Survival", "survival"], ["Time to resolve", "histogram"]], mode, (v) => {
          distMode = v; savePref("mttrDistMode", v); renderSurvivalCurve(mttr);
        }));
    }
    if (mode === "survival") {
      controls.append(el("div", { class: "seg-row", role: "group", "aria-label": "Survival window" },
        ...SURVIVAL_WINDOWS.map(([label, weeks]) =>
          el("button", {
            type: "button", class: "seg-btn seg-btn--sm",
            "aria-pressed": String(weeks === survivalWeeks),
            onclick: () => { survivalWeeks = weeks; saveSurvivalWeeks(label); renderSurvivalCurve(mttr); },
          }, label))));
    }
    survivalHost.append(el("div", { class: "section-head" },
      sectionLabel("Distribution"), controls));

    const box = el("div", { class: "chart-box chart-box--tall" });
    if (mode === "survival") {
      const canvas = el("canvas", { id: "survival-curve" });
      box.append(canvas);
      survivalHost.append(chartCard("S(t): share of findings still open", box, {
        helpLines: [
          "Time from first detection to remediation, as a Kaplan–Meier survival curve. " +
            "Markers: Median (KM) and Mean (KM · RMST) — still-open findings censored — plus " +
            "Median (closed), the naive closed-only median KM corrects for.",
        ],
      }));
      requestAnimationFrame(() => {
        // The two KM markers plus the naive closed-only median dot, so the curve shows the
        // bias KM corrects for in place (naiveMean stays off the "MTTR over time" toggle).
        survivalCurve(canvas, rem.km.curve,
          { naiveMedian: rem.km.naiveMedian, median: rem.km.median, naiveMean: null, mean: rem.km.mean },
          { maxWeeks: survivalWeeks });
      });
    } else {
      const canvas = el("canvas", { id: "resolution-buckets" });
      box.append(canvas);
      survivalHost.append(chartCard("Time to resolve", box, {
        helpLines: [
          "How long resolved findings actually took, bucketed by severity. The right-hand " +
            "bars are the tail the median hides.",
        ],
      }));
      requestAnimationFrame(() => {
        stackedAgeBar(canvas, rem.buckets.labels || RESOLUTION_LABELS, rem.buckets.perSev,
          boot.palette, "Resolved findings by time-to-resolve bucket and severity.");
      });
    }
  }

  function renderCharts(trends, mttr) {
    clear(chartsHost);
    // With no lifecycle data the hero already shows the single, unified empty state — don't
    // stack a second "Trends appear…" panel beneath it.
    if (!mttr.rowCount) return;

    // Window the already-loaded series client-side (no RPC): the charts use a category
    // x-axis, so filtering the arrays before mapping is the whole job. The cutoff comes
    // from the client clock; a ±1-day skew at the window edge is fine for a view filter.
    const cutoff = trendWindowDays === null ? null : Date.now() - trendWindowDays * 86400000;
    const inWindow = (iso) => cutoff === null || Date.parse(iso) >= cutoff;
    const trend = trends.trend.filter((t) => inWindow(t.date));
    const history = trends.history.filter((h) => inWindow(h.date));
    // Pin the x-axis to the chosen window (epoch days) — the charts' day axis is
    // time-proportional, so a 30d window stays 30 days wide even when the data only
    // reaches back a fortnight: short history reads as empty space, not a full chart.
    const xRange = cutoff === null
      ? null
      : { min: Math.floor(cutoff / 86400000), max: Math.floor(Date.now() / 86400000) };

    // Compact timeframe toggle inline with the section label. aria-pressed toggle
    // buttons, not a radiogroup — the same segmented pattern as the report-format and
    // oldest-open controls. Clicking repaints from the closed-over payload.
    const segRow = el("div", { class: "seg-row", role: "group", "aria-label": "Trends timeframe" },
      ...TREND_WINDOWS.map(([label, days]) =>
        el("button", {
          type: "button", class: "seg-btn seg-btn--sm",
          "aria-pressed": String(days === trendWindowDays),
          onclick: () => { trendWindowDays = days; saveTrendWindow(label); renderCharts(trends, mttr); },
        }, label)));
    const sectionHead = el("div", { class: "section-head" }, sectionLabel("Trends"), segRow);

    // With the vendor-fix filter off, mttr_history's snapshots were captured before any
    // no-fix exclusion existed — falling back to them would paint an unfiltered register on
    // a young ledger with too few reconstructed-trend points. Use the recomputed `trend`
    // array only in that case, even if it leaves the chart with fewer (or zero) points.
    const hideNoFix = boot.settings.showNoFix === false;
    const points = trend.length
      ? trend.map((t) => ({ x: t.date, y: t.median_days, reconstructed: t.reconstructed }))
      : hideNoFix ? [] : history.map((h) => ({ x: h.date, y: h.median_days, reconstructed: false }));

    // KM median trend — reconstructed-trend only (mttr_history snapshots don't carry it: KM
    // needs the full base of events + censoring replayed as-of each date, not a scalar that
    // was persisted at snapshot time).
    const kmMedianPoints = trend
      .map((t) => ({ x: t.date, y: t.km_median_days, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Same fallback shape as `points` above, but for open_past_sla — a column that doesn't
    // exist on history rows saved before this feature shipped. Those rows carry `null`
    // (never a false 0, see historyStore.loadHistory), so they're filtered out here rather
    // than drawn as a dip to zero.
    const openSlaPoints = (trend.length
      ? trend.map((t) => ({ x: t.date, y: t.open_past_sla, reconstructed: t.reconstructed }))
      : hideNoFix ? [] : history.map((h) => ({ x: h.date, y: h.open_past_sla, reconstructed: false })))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Backlog-flow series — reconstructed-trend only, like the tail median (mttr_history
    // snapshots don't carry them). sla_net is a signed per-window flow (can be negative);
    // sla_attainment_pct is the unbiased cohort In-SLA. Null points (first point / stale
    // history rows) are dropped rather than drawn as a dip to zero.
    const slaBurnPoints = trend
      .map((t) => ({ x: t.date, y: t.sla_net, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);
    const slaAttainmentPoints = trend
      .map((t) => ({ x: t.date, y: t.sla_attainment_pct, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // A "trend" needs at least two points — one lone dot is not a trajectory. This matches the
    // Open-vs-resolved gate and the "after two saved scans" copy below.
    const hasTrend = points.length > 1;
    const hasKmTrend = kmMedianPoints.length > 1;
    const hasOpenSlaTrend = openSlaPoints.length > 1;
    const hasSlaBurn = slaBurnPoints.length > 1;
    const hasSlaAttainment = slaAttainmentPoints.length > 1;
    // Four cards, two of them carrying a two-option toggle that folds in the comparison
    // series (KM vs naive; attainment vs burn) — the methodology moves from an always-on
    // caption onto the card-title helpTip. Chart draws are deferred into `painters` and run
    // in one rAF after layout, so a card's canvas is in the DOM before it's sized.
    const grid = el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" });
    const painters = [];

    // Card 1 — MTTR over time: the KM headline vs the naive closed-only comparison, one
    // card. Only the modes that have ≥2 points offer a button; if just one does, no toggle.
    {
      const modes = [];
      if (hasKmTrend) modes.push("km");
      if (hasTrend) modes.push("naive");
      if (modes.length) {
        const mode = modes.includes(overTimeMode) ? overTimeMode : modes[0];
        const canvas = el("canvas", { id: "mttr-over-time" });
        const toggle = modes.length > 1
          ? toggleRow("MTTR clock", [["KM", "km"], ["Naive", "naive"]], mode, (v) => {
            overTimeMode = v; savePref("mttrOverTimeMode", v); renderCharts(trends, mttr);
          })
          : null;
        grid.append(chartCard("MTTR over time", el("div", { class: "chart-box" }, canvas), {
          toggle,
          helpLines: [
            "KM: Kaplan–Meier median days from first detection to remediation, replayed as " +
              "of each scan; still-open findings censored, so a wave of fresh open findings " +
              "can't bias it down.",
            "Naive: median of closed findings only, per scan — the biased comparison KM " +
              "corrects for.",
          ],
        }));
        painters.push(() => (mode === "km"
          ? trendLine(canvas, kmMedianPoints, { yLabel: "days", xRange })
          : trendLine(canvas, points.filter((p) => p.y !== null), { yLabel: "days", xRange })));
      }
    }

    // Card 2 — Open vs resolved (the red/green dual line already encodes color + dash +
    // point-shape, so it stays its own card rather than a third overlay on anything).
    if (trend.length > 1) {
      const canvas = el("canvas", { id: "open-resolved" });
      grid.append(chartCard("Open vs resolved", el("div", { class: "chart-box" }, canvas)));
      painters.push(() => openResolvedLines(canvas, trend, { xRange }));
    }

    // Card 3 — Open past SLA (aged backlog level).
    if (hasOpenSlaTrend) {
      const canvas = el("canvas", { id: "open-sla-trend" });
      grid.append(chartCard("Open past SLA", el("div", { class: "chart-box" }, canvas), {
        helpLines: [
          "Open findings past their SLA deadline, measured from when a vendor fix became " +
            "available rather than first detection. Counts step up at the fix-tracking " +
            "rollout — findings awaiting a vendor fix are now included in the register.",
        ],
      }));
      painters.push(() => trendLine(canvas, openSlaPoints, { yLabel: "findings", xRange }));
    }

    // Card 4 — SLA quality: cohort attainment (rate) vs net-flow burn (direction), one card.
    {
      const modes = [];
      if (hasSlaAttainment) modes.push("attainment");
      if (hasSlaBurn) modes.push("burn");
      if (modes.length) {
        const mode = modes.includes(slaQualMode) ? slaQualMode : modes[0];
        const canvas = el("canvas", { id: "sla-quality" });
        const toggle = modes.length > 1
          ? toggleRow("SLA quality series",
            [["Attainment", "attainment"], ["Burn", "burn"]], mode, (v) => {
              slaQualMode = v; savePref("mttrSlaQualMode", v); renderCharts(trends, mttr);
            })
          : null;
        grid.append(chartCard("SLA quality", el("div", { class: "chart-box" }, canvas), {
          toggle,
          helpLines: [
            "Attainment (cohort): of findings whose SLA deadline has passed, the share met " +
              "on time — unlike In-SLA (of resolved), unaffected by how much is still open.",
            "Burn (net flow): findings crossing their SLA deadline minus breached findings " +
              "cleared, per scan. Above zero = the past-SLA backlog is growing.",
          ],
        }));
        painters.push(() => (mode === "attainment"
          ? trendLine(canvas, slaAttainmentPoints, { yLabel: "%", xRange })
          : trendLine(canvas, slaBurnPoints, { yLabel: "findings", xRange })));
      }
    }

    if (!grid.hasChildNodes()) {
      if (trendWindowDays === null) {
        // Nothing to plot at all — same single empty state as before the filter existed.
        chartsHost.append(emptyState("Trends appear after two saved scans."));
      } else {
        // The window is what emptied the section — keep the control so it can be widened.
        chartsHost.append(sectionHead, emptyState("No trend points in this window."));
      }
      return;
    }
    // A labelled section so the page has no h1 → h3 heading skip (the cards are h3).
    chartsHost.append(sectionHead, grid);
    // Caption keyed to the windowed set — no note about shading that isn't on screen.
    if (trend.some((t) => t.reconstructed)) {
      chartsHost.append(el("p", { class: "small muted", style: "margin:4px 0 0" },
        "Shaded days precede the first saved scan — reconstructed from first-detection dates. "
          + "Open counts there are exact; resolved and MTTR are lower bounds."));
    }

    requestAnimationFrame(() => {
      for (const paint of painters) paint();
    });
  }

  function renderSla(mttr) {
    clear(slaHost);
    // The per-severity breakdown (table + posture bars) follows the severity dropdown,
    // so it always matches the severities feeding the hero and trend above.
    const sevs = boot.palette.order.filter((s) => mttr.perSev[s] && sevScope.includes(s));
    if (!sevs.length) return;

    slaHost.append(sectionLabel("Remediation by severity"));
    // Trimmed to the high-signal columns — Resolved, Awaiting, Open age p90 and the SLA
    // target column are dropped from the default view (the target folds into the In-SLA
    // header helpTip). Column headers carry each metric's definition via helpTip so the
    // hero minis can stay plain.
    const columns = [
      ["Severity", null],
      ["Median MTTR (KM)",
        ["Kaplan–Meier median time-to-remediation for this severity — the principal MTTR " +
          "figure. Still-open findings count as censored instead of being ignored, so it isn't " +
          "biased low by fresh fast-patched vulns."]],
      ["MTTR p90",
        ["Kaplan–Meier 90th-percentile time-to-remediation — the slow tail. Nine in ten " +
          "findings beat it; one in ten is slower. Censoring-aware like the KM median (read off " +
          "the same survival curve), so the tail isn't biased low by fresh fast-patched vulns; " +
          "shows \"—\" when too much is still open to observe it."]],
      ["Open", null],
      ["Open past SLA",
        ["Open findings already older than their severity's SLA target, measured from when " +
          "a vendor fix became available. Unlike In-SLA % (which only scores resolved " +
          "findings), an aged-out open CRITICAL counts here."]],
      ["In SLA (of resolved)",
        ["Share of resolved findings closed within their severity's SLA target — " +
          "CRITICAL 7d · HIGH 14d · MEDIUM 30d · LOW 90d · INFO 180d."]],
    ];
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...columns.map(([h, lines]) => el("th", { scope: "col" },
          lines ? helpTip(h, lines, { className: "help-label" }) : h)))),
    );
    const tbody = el("tbody", {});
    for (const sev of sevs) {
      const d = mttr.perSev[sev];
      // KM median (still-open findings censored) when the payload carries it, falling back to
      // the naive closed-only median for a stale pre-kmMedianPerSev cache.
      const kmMedian = mttr.remediation?.kmMedianPerSev?.[sev];
      // KM p90 (still-open findings censored) when present, falling back to the naive closed-only
      // p90 for a stale pre-kmP90PerSev cache; a present-but-null value renders "—" (censored).
      const kmP90 = mttr.remediation?.kmP90PerSev?.[sev];
      tbody.append(el("tr", {},
        el("td", {}, sevBadge(sev)),
        el("td", { class: "num" }, fmtDays(kmMedian !== undefined ? kmMedian : d.mttr_median)),
        el("td", { class: "num" },
          fmtDays(kmP90 !== undefined ? kmP90 : mttr.remediation?.pctiles?.perSev?.[sev]?.p90)),
        el("td", { class: "num" }, d.open),
        el("td", { class: "num" }, fmtOpenPastSla(
          mttr.remediation?.openPastSlaActionable?.perSev?.[sev]
          ?? mttr.remediation?.openPastSla?.perSev?.[sev])),
        el("td", { class: "num" }, d.sla_pct !== null ? `${d.sla_pct.toFixed(0)}%` : "—"),
      ));
    }
    // The UNKNOWN severity (findings whose severity never normalized to a real value) is
    // deliberately not rendered as a row here — it's still folded into every hero/table
    // total above, and the hero source line surfaces the count as "unclassified severity".
    table.append(tbody);
    slaHost.append(el("div", { class: "table-wrap" }, table));
  }
}
