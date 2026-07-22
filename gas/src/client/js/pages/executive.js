// Executive View — the default landing page. A calm, centered summary of the numbers
// leadership acts on: one big Kaplan–Meier MTTR score, open vulnerabilities by severity,
// the last scan (with a Run scan button), and KM MTTR by domain. Composes existing
// read-models (api_bootstrap + api_getExecutivePage) — the latter a lean sibling of the
// MTTR page's endpoint that ships only the hero + per-domain slices this page paints,
// sharing their cache entries but skipping the unused trend reconstruction.

import { bootstrap, swrCall } from "../store.js";
import {
  clear, el, emptyState, fmtDateTime, fmtDays, helpTip, sectionLabel,
  skeleton, statusPill,
} from "../ui.js";

// A play triangle for the Run scan button — inlined stroke/fill SVG (the GAS/CSP sandbox
// blocks icon fonts and CDNs), matching the sidebar's RUN_ICON so the control reads the same.
const RUN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>';

function iconSpan(svg) {
  const s = el("span", { class: "btn-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// Title-case a severity name for a label ("CRITICAL" -> "Critical").
function nice(s) {
  return s[0] + s.slice(1).toLowerCase();
}

// Kaplan–Meier median formatter (mirrors pages/mttr.js fmtKmMedian — the client bundle can't
// import the TS domain module): the exact day count, "> X d" when the curve never drops to 50%
// within the observed window (heavy censoring, so the true median is at least that far out), or
// "—" when there's no KM result at all (a stale pre-KM cached payload).
function fmtKmMedian(km) {
  if (!km) return "—";
  if (km.median !== null && km.median !== undefined) return fmtDays(km.median);
  if (km.medianLowerBound !== null && km.medianLowerBound !== undefined) {
    return `> ${fmtDays(km.medianLowerBound)}`;
  }
  return "—";
}

// Small week-over-week trend badge for the hero: a ↑/↓ arrow + magnitude coloured by whether the KM
// MTTR rose (worse, red) or fell (better, green) over the last 7 days, with a muted "vs last week"
// note. Reuses the shared .chg up/down/flat colours; meaning rides on the arrow + number + label,
// never colour alone (DESIGN.md). `wt` is the server weekTrend ({ deltaDays, current, previous,
// days }) or null — null (or a non-finite delta) yields no badge, so a register under a week old or
// a censored endpoint simply shows nothing.
function weekTrendBadge(wt) {
  if (!wt) return null;
  const delta = Number(wt.deltaDays);
  if (!Number.isFinite(delta)) return null;
  const note = el("span", { class: "exec-trend-note" }, "vs last week");
  if (delta === 0) {
    return el("span", { class: "exec-trend" },
      el("span", { class: "chg flat", "aria-label": "MTTR unchanged versus last week" }, "±0"),
      note);
  }
  const worse = delta > 0; // MTTR up = slower remediation = worse
  const mag = fmtDays(Math.abs(delta));
  const label = `MTTR ${worse ? "up" : "down"} ${mag} versus last week`;
  return el("span", { class: "exec-trend" },
    el("span", { class: `chg ${worse ? "up" : "down"}`, title: label, "aria-label": label },
      el("span", { class: "exec-trend-arrow", "aria-hidden": "true" }, worse ? "↑" : "↓"),
      mag),
    note);
}

export async function renderExecutive(main, _params, ctx) {
  const boot = await bootstrap();

  // Which severities every metric on this page reflects — the app-wide "Display severity"
  // setting ("which severities every page shows"), so the exec view opens scoped exactly
  // like Overview and MTTR; falls back to all selectable if that setting is somehow empty.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  // Null when every selectable severity is chosen (no filter → shares the MTTR page's
  // default cache entry); otherwise the chosen subset, which the server keeps alongside
  // UNKNOWN. Same rule as pages/mttr.js scopeParam so exec and MTTR share cache entries.
  const severities = sevScope.length === boot.palette.selectable.length ? null : sevScope;

  // Kick the executive-data RPC off as soon as the severity scope is known — the hero +
  // per-domain slices are the slow part, so the fetch overlaps the synchronous shell build
  // below. Whole-chain (no domain/support scope), scoped to the display severities so a
  // narrowed setting (e.g. Critical-only) also computes over fewer rows. `paint` is assigned
  // once the section hosts exist; the SWR background revalidation resolves far later than
  // that, so the guarded reference is safe. api_getExecutivePage ships only the hero +
  // by-domain slices this page reads, skipping the unused trend reconstruction.
  let paint;
  const execData = swrCall(
    "api_getExecutivePage",
    { domain: "", supportGroup: "", severities },
    (fresh) => paint && paint(fresh),
  );

  const page = el("div", { class: "exec" });
  page.append(el("h1", {}, "Security posture"));
  // The vendor-fix / EOL "findings hidden" notes are deliberately omitted here: the executive view
  // is the calm leadership summary, and those filter-honesty banners live on the analyst pages
  // (Overview, MTTR, OS vulnerabilities, …) that this page links into.
  main.append(page);

  // Section hosts, painted below. Order = visual hierarchy: the headline MTTR, then the
  // scan action, then open risk, then the per-domain split.
  const heroHost = el("div", { class: "exec-hero" });
  const scanHost = el("div", { class: "exec-scan" });
  const sevHost = el("div", {});
  const byDomainHost = el("div", {});
  page.append(heroHost, scanHost, sevHost, byDomainHost);

  // This is the default landing page, so a single failing section must never blank the whole
  // view. Each section renders inside a guard: on error it logs a tagged trace (so a recurrence
  // is diagnosable to the exact section) and drops an honest fallback into that host, while the
  // rest of the page still paints.
  function guard(label, host, fn) {
    try {
      fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[executive] " + label + " render failed:", e);
      if (host) clear(host).append(emptyState("Couldn't render " + label + "."));
    }
  }

  guard("scan", scanHost, renderScan);
  guard("severity", sevHost, renderSeverity);
  renderHeroSkeleton();

  // We use only `.mttr` (hero) and `.byDomain` (per-domain split) — api_getExecutivePage
  // ships exactly those two slices and skips the trend reconstruction the MTTR page needs.
  paint = (data) => {
    guard("MTTR", heroHost, () => renderHero(data && data.mttr, data && data.weekTrend));
    guard("by domain", byDomainHost, () => renderByDomain(data && data.byDomain));
  };
  try {
    paint(await execData);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[executive] getExecutivePage failed:", e);
    clear(heroHost).append(emptyState(
      "Couldn't load remediation data.",
      "Try running a scan or reloading the page.",
    ));
  }

  function renderHeroSkeleton() {
    clear(heroHost).append(
      el("div", { role: "status", "aria-label": "Computing MTTR" },
        el("div", { style: "margin-bottom:8px; display:flex; justify-content:center" },
          skeleton("line", { width: "180px" })),
        el("div", { style: "display:flex; justify-content:center" },
          skeleton("stat", { width: "160px", height: "56px" }))),
    );
  }

  // The single hero value (DESIGN.md: at most one per page) — the KM median MTTR, sized
  // larger here as the deliberate exec-only exception (this page *is* the number). The label
  // + value are the helpTip hover/focus target; no separate glyph. Source line states what
  // the figure was measured over so the number is never shown without its base.
  function renderHero(mttr, weekTrend) {
    clear(heroHost);
    if (!mttr || !mttr.rowCount) {
      heroHost.append(emptyState(
        "No lifecycle data yet.",
        "MTTR needs at least one saved scan with resolved findings.",
      ));
      return;
    }
    const km = mttr.remediation?.km; // KMResult — the primary MTTR methodology
    const resolved = mttr.overall?.resolved ?? 0;
    const open = mttr.overall?.open ?? 0;
    const metric = helpTip(
      [
        el("div", { class: "label" }, "Median MTTR (Kaplan–Meier)"),
        el("div", { class: "exec-hero-value num" }, fmtKmMedian(km)),
      ],
      [
        "Kaplan–Meier median days from first detection to remediation. Still-open findings " +
          "count as censored observations instead of being ignored, so a wave of fresh open " +
          "findings can't bias this down.",
        "\"> X d\" means the curve never dropped to 50% within the observed window — over " +
          "half of tracked findings are still open, so the true median is at least that many " +
          "days out.",
      ],
      { className: "hero-metric" },
    );
    // The metric sits in an inline row with the week-over-week badge to its bottom-right (a small
    // arrow + number, red when MTTR rose, green when it fell). The badge is a sibling, not a child
    // of the helpTip, so hovering it doesn't fire the KM tooltip; it's simply omitted when the
    // server had no comparable week-ago baseline.
    const badge = weekTrendBadge(weekTrend);
    const metricRow = el("div", { class: "exec-hero-row" }, metric);
    if (badge) metricRow.append(badge);
    heroHost.append(
      metricRow,
      el("div", { class: "hero-src" },
        `${mttr.rowCount.toLocaleString()} tracked lifecycle(s) · ` +
        `${resolved.toLocaleString()} resolved · ${open.toLocaleString()} open`),
    );
  }

  // Last-scan caption + a single primary (full) Run scan button. The scan itself is driven by
  // the sidebar's job machinery via ctx.startScan — the progress card appears in the scan zone
  // and a completed job refreshes the whole shell, exactly like the sidebar's own Run scan.
  function renderScan() {
    clear(scanHost);
    const runBtn = el("button", { class: "primary", onclick: () => ctx.startScan(false, runBtn) },
      iconSpan(RUN_ICON), el("span", { class: "btn-label" }, "Run scan"));

    if (boot.latestScan) {
      const age = Math.floor((Date.now() - Date.parse(boot.latestScan.ts)) / 86400000);
      scanHost.append(
        el("div", { class: "scan-caption" },
          `Last scan ${fmtDateTime(boot.latestScan.ts)}` + (age >= 2 ? ` — ${age} days ago` : "")),
      );
    } else {
      scanHost.append(el("div", { class: "scan-caption" }, "No scan saved yet."));
    }
    scanHost.append(runBtn);
    // Honest state: name the dry-run when there are no Wiz credentials, so the numbers above
    // aren't mistaken for a live register (matches the sidebar's credentials pill).
    if (!boot.hasCredentials) {
      scanHost.append(el("div", { class: "scan-caption" },
        statusPill("neutral", "Dry-run (no credentials)")));
    }
  }

  // Open vulnerabilities by severity, from the current scan's counts (the live open set, same
  // source Overview's headline uses). One tile per selectable severity: a colored dot + the
  // count + a plain label — color carries meaning only alongside the dot and text (DESIGN
  // two-token + non-color-signal rules). A tile with zero is shown honestly, not hidden.
  function renderSeverity() {
    clear(sevHost);
    const counts = boot.counts || {};
    // Scoped to the same "Display severity" setting the hero and by-domain table use, so the
    // whole page reflects one severity scope — a Critical-only setting shows just the Critical
    // tile, not the full selectable breakdown.
    const sevs = boot.palette.order.filter((s) => sevScope.includes(s));
    if (!sevs.length) return;

    sevHost.append(sectionLabel("Open vulnerabilities"));
    const row = el("div", { class: "exec-sev-row" });
    for (const sev of sevs) {
      const n = counts[sev] ?? 0;
      row.append(
        el("div", { class: "exec-sev-tile" },
          el("div", { class: "exec-sev-count num" }, n.toLocaleString()),
          el("div", { class: "exec-sev-name" },
            el("span", {
              class: "sev-dot", "aria-hidden": "true",
              style: `background:${boot.palette.colors[sev]}`,
            }),
            nice(sev)),
        ),
      );
    }
    sevHost.append(row);
  }

  // KM MTTR by domain — the per-domain remediation split. The server ships `byDomain` only at
  // the whole-chain view (which this always is) and the MTTR page gates the section on ≥2
  // configured domains, so mirror that: hidden entirely when there's nothing meaningful to
  // split. A compact table (domain · KM median · open) sorted by open backlog, capped so the
  // exec view stays a summary — the full breakdown lives on the MTTR page.
  function renderByDomain(byDomain) {
    clear(byDomainHost);
    if (!byDomain || !byDomain.rows || !byDomain.rows.length || boot.domainNames.length < 2) return;

    const rows = [...byDomain.rows]
      .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
      .slice(0, 5);

    byDomainHost.append(sectionLabel("MTTR by domain"));
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Domain"),
        el("th", { scope: "col" },
          helpTip("Median MTTR (KM)",
            ["Kaplan–Meier median time-to-remediation for this domain — still-open findings " +
              "censored, so it isn't biased low by fresh fast-patched vulns."],
            { className: "help-label" })),
        el("th", { scope: "col" }, "Open"))),
    );
    const tbody = el("tbody", {});
    for (const r of rows) {
      tbody.append(el("tr", {},
        el("td", {}, r.domain),
        el("td", { class: "num num--key" }, fmtDays(r.kmMedian)),
        el("td", { class: "num" }, (r.open ?? 0).toLocaleString()),
      ));
    }
    table.append(tbody);
    byDomainHost.append(el("div", { class: "table-wrap exec-by-domain" }, table));
  }
}
