// Executive View — the default landing page. A calm, centered summary of the numbers
// leadership acts on: one big Kaplan-Meier MTTR score, open vulnerabilities by severity,
// the last scan (with a Run scan button), and KM MTTR by domain. Composes existing
// read-models (api_bootstrap + api_getExecutivePage) — the latter a lean sibling of the
// MTTR page's endpoint that ships only the slices this page paints, sharing their cache
// entries but skipping the unused trend reconstruction.
//
// IT ANSWERS FOR THE HEADER SCOPE, like every other page. It did not always: it sent
// `domain: "", supportGroup: ""` outright and the switcher's own popover said so. What kept it
// exempt was not a stance about leadership wanting the whole register — it was the severity
// tiles, which read bootstrap's `counts`, and that tally is register-wide by construction. A
// scoped hero over unscoped tiles is not a smaller truth; it is two populations on one screen
// with nothing distinguishing them. Once the server could ship a scoped tally
// (`severityCounts`), the exemption had nothing left holding it up. The switcher sits in the
// header precisely because it scopes the whole app, and this is the default route — so a pick
// made anywhere used to appear to do nothing the moment a reader navigated home.
//
// THE WEEK-OVER-WEEK BADGE NEEDS NO SCOPE GATE, and that is worth stating because the
// equivalent chips on the MTTR page do (mttr.js: "EVERY SCOPE THE SHELL CAN HOLD HAS TO BE
// LISTED HERE"). Those diff a scoped current value against the register-wide `mttr_history`
// snapshots, so a scope makes them compare two different populations. `executiveWeekTrend`
// computes both of its endpoints from the same `scopedBaseRows`, so it is scope-correct by
// construction. Do not add a predicate here.
//
// The two view functions below are pure and exported so the claims they encode are testable in
// node — the split scanProgress.js and capacity.js already use, and for the same reason.

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  absent, clear, dataTable, el, emptyState, errorState, fmtDateTime, fmtSpan, glossaryTip,
  heroLines,
  num, pageHeader, scopeBar, sectionLabel, skeleton, statusPill, tip, tipAnchor,
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
// the muted em dash when there's no KM result at all (a stale pre-KM cached payload).
//
// THE MISSING CASE IS A NODE HERE AND A STRING IN mttr.js, and the divergence is deliberate.
// This copy has exactly one call site — the hero value, a Node child position — while mttr.js's
// copy is also interpolated into `latencyLine`'s sentence, where a Node cannot go, so that one
// keeps returning a string and hands the Node case to a separate cell helper. What `absent()`
// fixes is that a hand-typed "—" arrives in the same ink and the same 2rem weight as a measured
// median, which asserts a measurement nobody made.
function fmtKmMedian(km) {
  if (!km) return absent();
  if (km.median !== null && km.median !== undefined) return fmtSpan(km.median);
  if (km.medianLowerBound !== null && km.medianLowerBound !== undefined) {
    return `> ${fmtSpan(km.medianLowerBound)}`;
  }
  return absent();
}

// Small week-over-week trend badge for the hero: a ↑/↓ arrow + magnitude coloured by whether the KM
// MTTR rose (worse, red) or fell (better, green) over the last 7 days, with a muted "vs last week"
// note. Reuses the shared .chg up/down/flat colours; meaning rides on the arrow + number + label,
// never colour alone (DESIGN.md). `wt` is the server weekTrend ({ deltaDays, current, previous,
// days }) or null — null (or a non-finite delta) yields no badge, so a register under a week old or
// a censored endpoint simply shows nothing.
function weekTrendBadge(wt) {
  if (!wt) return null;
  // `num`, NOT `Number`. `Number(null)` is 0 and 0 IS finite, so a weekTrend object that
  // carried no delta at all sailed through the guard below and drew a confident "±0 · vs last
  // week" — the page asserting that MTTR had not moved when nothing had been measured. `num`
  // refuses null/undefined/""/[]/false before the cast, so the unmeasured case now reaches the
  // "no badge" branch the header paragraph already promised it would.
  const delta = num(wt.deltaDays);
  if (!Number.isFinite(delta)) return null;
  const note = el("span", { class: "exec-trend-note" }, "vs last week");
  if (delta === 0) {
    return el("span", { class: "exec-trend" },
      el("span", { class: "chg flat", "aria-label": "MTTR unchanged versus last week" }, "±0"),
      note);
  }
  const worse = delta > 0; // MTTR up = slower remediation = worse
  const mag = fmtSpan(Math.abs(delta));
  const label = `MTTR ${worse ? "up" : "down"} ${mag} versus last week`;
  const chip = el("span", { class: `chg ${worse ? "up" : "down"}`, "aria-label": label },
    el("span", { class: "exec-trend-arrow", "aria-hidden": "true" }, worse ? "↑" : "↓"),
    mag);
  // `title` was a native tooltip: unreachable by keyboard, absent on touch, half a second late.
  // `tipAnchor` rather than `tip` because the chip is not a control and must not become one —
  // it already carries the same sentence as its aria-label, so a screen reader has it and a
  // pointer reader now gets it from the app's own hover card instead of the OS's.
  tipAnchor(chip, () => [label]);
  return el("span", { class: "exec-trend" }, chip, note);
}

// Shown in a tile whose count is still in flight. Only reachable under a scope: unscoped, the
// numbers come off bootstrap and are already in hand when the page first paints.
const PENDING = "\u2026";

/**
 * What the "Open vulnerabilities" tiles say. Pure so the scoped/unscoped split is testable.
 *
 * OPEN ONLY, ON BOTH PATHS. The tiles are labelled "Open vulnerabilities" and used to count
 * every row in the frame, resolved history included — so the better a register's close rate,
 * the more it overstated its live risk. Both sources are now open-only: bootstrap's
 * `openCounts` and `executiveSeverityCounts`.
 *
 * UNSCOPED, THE SOURCE STAYS BOOTSTRAP — deliberately, not by omission. This is the default
 * landing page and it must paint real numbers on the first synchronous pass rather than flash a
 * placeholder while an RPC lands. The two tallies provably agree: bootstrap counts the open rows
 * of `visibleFrame(scan.records)` and `scopedFrameRecords("", "", [])` returns exactly that
 * frame, filtered the same way, so the repaint when the payload arrives is a no-op. That
 * agreement is load-bearing and pinned in test/executiveView.test.js — narrowing one population
 * without the other reintroduces the flicker this avoids. The server still computes and warms
 * the unscoped entry, so the scoped path is not the only one ever exercised.
 *
 * A ZERO IS A TILE, BUT AN ALL-ZERO SCOPE IS ALSO A SENTENCE. A scope can hold resolved history
 * and no open findings at all — a domain whose live work has closed, or `Not attributable`,
 * which no open finding can ever land in. The hero above will still show a real KM median off
 * that scope's lifecycles, so five bare zeros beneath it read as a render that failed. Naming it
 * costs one line and is the same move the switcher's own caption makes for its zero rows.
 *
 * @param {{order: string[], scope: string[], bootCounts: object,
 *          payload: object|null|undefined, scoped: boolean}} args
 * @returns {{tiles: {sev: string, value: string}[], note: string|null}}
 */
export function executiveSeverityView({ order, scope, bootCounts, payload, scoped }) {
  const sevs = order.filter((s) => scope.includes(s));
  const tiles = (read) => sevs.map((sev) => ({ sev, value: read(sev) }));
  if (!scoped) {
    const c = bootCounts || {};
    return { tiles: tiles((sev) => (c[sev] ?? 0).toLocaleString()), note: null };
  }
  if (!payload) return { tiles: tiles(() => PENDING), note: null };
  const counts = payload.counts || {};
  // `flatScan: false` means there is no scan to count at all — the scan section already says so,
  // and an honest 0 there needs no second sentence about the scope.
  const note = payload.flatScan && !payload.total ? "No open findings in this scope." : null;
  return { tiles: tiles((sev) => (counts[sev] ?? 0).toLocaleString()), note };
}

/**
 * What the per-group remediation split says, and whether it is worth drawing at all.
 *
 * THE DIMENSION FOLLOWS THE SCOPE, server-tagged: per-domain at the whole-register view,
 * per-support-group when a domain is picked — because splitting BY domain while scoped TO one
 * domain is a single row restating the hero. Only `mttrByDomainData` aliases `group` into
 * `domain`, so the name has to be read through `group ?? domain` or the support-group split
 * renders a column of blanks.
 *
 * THE ONE-ROW GUARD APPLIES TO BOTH DIMENSIONS HERE, which is a deliberate divergence from
 * mttr.js (it guards only the support-group branch). Under a support-group scope the dimension
 * is still "domain" while `domainNames` stays register-wide, so that gate alone would happily
 * draw a one-row table for a group living in a single domain.
 *
 * EVERY GROUP IS LISTED. This used to cap at five and call itself a summary, which quietly made
 * the section unable to answer the question it poses: a domain outside the top five by open
 * backlog could carry the worst MTTR on the page and never appear, with nothing on screen
 * saying rows had been dropped. A silent truncation is worse than a long table. Ordering still
 * puts the biggest backlog first, so the head of the list reads the same as it always did; the
 * table scrolls in its own container rather than pushing the page sideways.
 *
 * @param {object|null|undefined} byDomain  the server's `byDomain` slice
 * @param {{domainNames: string[]}} args
 * @returns {{show: boolean, title?: string, columnHeader?: string,
 *            rows?: {name: string, kmMedian: number|null, open: number}[]}}
 */
export function executiveByDomainView(byDomain, { domainNames }) {
  if (!byDomain || !byDomain.rows || !byDomain.rows.length) return { show: false };
  const isSg = byDomain.dimension === "supportGroup";
  if (!isSg && (domainNames || []).length < 2) return { show: false };
  if (byDomain.rows.length < 2) return { show: false };
  return {
    show: true,
    title: isSg ? "MTTR by support group" : "MTTR by domain",
    columnHeader: isSg ? "Support group" : "Domain",
    rows: [...byDomain.rows]
      .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
      .map((r) => ({ name: r.group ?? r.domain, kmMedian: r.kmMedian, open: r.open ?? 0 })),
  };
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

  // The scope in force, from the header switcher — a domain or a support group, at most one of
  // them; "" = no filter on that dimension. Same read as every other page (mttr.js, overview.js).
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";
  const scoped = Boolean(domain || supportGroup);

  // Kick the executive-data RPC off as soon as the scope is known — the hero + per-group slices
  // are the slow part, so the fetch overlaps the synchronous shell build below. Scoped to the
  // header pick and to the display severities, so a narrowed setting (e.g. Critical-only) also
  // computes over fewer rows. `paint` is assigned once the section hosts exist; the SWR
  // background revalidation resolves far later than that, so the guarded reference is safe.
  //
  // A SCOPE CHANGE NEEDS NO INVALIDATION: swrCall keys on name + JSON.stringify(params), so each
  // scope is its own entry and the previous one stays valid — switching back repaints instantly
  // from cache rather than re-fetching.
  let paint;
  const execData = swrCall(
    "api_getExecutivePage",
    { domain, supportGroup, severities },
    (fresh) => paint && paint(fresh),
  );

  const page = el("div", { class: "exec" });
  page.append(pageHeader({
    route: "executive",
    // TWO LINES, both carried word for word: the page's old hero VALUE was "Security posture"
    // — a subtitle, not a figure — and its sub-line was the sentence below it. The h1 is the
    // route's PAGES title now, so the subtitle drops one level rather than being deleted.
    lede: heroLines(
      "Security posture",
      "The one number this register exists to state, and what moved it.",
    ),
  }));
  // Echoed inside `.exec` rather than in `main`, so the chip stays in the centered 720px column
  // with the figures it qualifies. Null when nothing is scoped.
  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) page.append(scopeChips);
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
      console.error("[executive] " + label + " render failed:", e);
      // errorState, NOT emptyState. A section that THREW is a defect in the app; an empty
      // section is a state the register is legitimately in. They were the same dashed box
      // in the same role="status" here, which announced a crash to a screen reader as calm
      // news and dropped the exception on the floor. The disclosure keeps it.
      if (host) {
        clear(host).append(errorState("Couldn't render " + label + ".",
          { detail: String((e && e.message) || e) }));
      }
    }
  }

  guard("scan", scanHost, renderScan);
  // Painted twice on the scoped path (pending, then counted) and twice to the same numbers on
  // the unscoped one, where bootstrap already holds them — see executiveSeverityView.
  guard("severity", sevHost, () => renderSeverity(null));
  renderHeroSkeleton();

  paint = (data) => {
    guard("MTTR", heroHost, () => renderHero(data && data.mttr, data && data.weekTrend));
    guard("severity", sevHost, () => renderSeverity(data));
    guard("by domain", byDomainHost, () => renderByDomain(data && data.byDomain));
  };
  try {
    paint(await execData);
  } catch (e) {
    console.error("[executive] getExecutivePage failed:", e);
    clear(heroHost).append(errorState("Couldn't load remediation data.", {
      detail: String((e && e.message) || e),
      onRetry: () => ctx.refresh(),
    }));
    // Unscoped, the tiles already hold bootstrap's numbers and those are still true — leave them.
    // Scoped, they hold the pending placeholder, and falling back to the register-wide tally
    // would be exactly the lie this page was rewired to stop telling.
    if (scoped) {
      clear(sevHost).append(errorState("Couldn't load counts for this scope.",
        { detail: String((e && e.message) || e) }));
    }
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
    // The label names the scope, so the one big number on the page can never be read as the
    // register's when it isn't. The chip above says the same thing for the page as a whole; this
    // says it for the figure, which is the part that gets screenshotted out of context.
    const scopeSuffix = domain ? ` — ${domain}` : supportGroup ? ` — ${supportGroup}` : "";
    // THE SENTENCE USED TO BE WRITTEN OUT HERE AND AGAIN IN pages/mttr.js, and the two copies
    // had already drifted a word apart ("at least that many days out" against "at least that
    // far out"). It is helpContent.js's `km-median` entry now, and `glossaryTip` is the shape
    // for "the book already says it": the card shows the entry's first two lines and Enter
    // opens the whole definition on the key sheet. `tip(content, lines, { term })` is the other
    // shape, for a trigger that says something sharper in place than the book does.
    const metric = glossaryTip(
      [
        el("div", { class: "label" }, `Median MTTR (Kaplan–Meier)${scopeSuffix}`),
        el("div", { class: "exec-hero-value num" }, fmtKmMedian(km)),
      ],
      "km-median",
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

  // Open vulnerabilities by severity, from the current scan (the live open set, same source
  // Overview's headline uses) narrowed to the header scope. One tile per selectable severity: a
  // colored dot + the count + a plain label — color carries meaning only alongside the dot and
  // text (DESIGN two-token + non-color-signal rules). A tile with zero is shown honestly, not
  // hidden; an all-zero scope also gets a sentence. The scoped/unscoped source split and the
  // note rule live in executiveSeverityView; this only draws them.
  //
  // Severity scope is the "Display severity" setting, the same one the hero and the split use,
  // so the whole page reflects one severity scope — a Critical-only setting shows just the
  // Critical tile, not the full selectable breakdown.
  function renderSeverity(data) {
    clear(sevHost);
    const view = executiveSeverityView({
      order: boot.palette.order,
      scope: sevScope,
      bootCounts: boot.openCounts,
      payload: data && data.severityCounts,
      scoped,
    });
    if (!view.tiles.length) return;

    sevHost.append(sectionLabel("Open vulnerabilities"));
    const row = el("div", { class: "exec-sev-row" });
    for (const t of view.tiles) {
      row.append(
        el("div", { class: "exec-sev-tile" },
          el("div", { class: "exec-sev-count num" }, t.value),
          el("div", { class: "exec-sev-name" },
            el("span", {
              class: "sev-dot", "aria-hidden": "true",
              style: `background:${boot.palette.colors[t.sev]}`,
            }),
            nice(t.sev)),
        ),
      );
    }
    sevHost.append(row);
    if (view.note) sevHost.append(el("p", { class: "small muted" }, view.note));
  }

  // The per-group remediation split — by domain at the whole-register view, by support group
  // within a picked domain. A compact table (group · KM median · open) sorted by open backlog,
  // listing every group; the deeper per-group charts still live on the MTTR page.
  // Which dimension, and whether there is a split worth drawing at all, is executiveByDomainView.
  function renderByDomain(byDomain) {
    clear(byDomainHost);
    const view = executiveByDomainView(byDomain, { domainNames: boot.domainNames });
    if (!view.show) return;

    byDomainHost.append(sectionLabel(view.title));
    // `dataTable` rather than a hand-rolled `<table class="data">`: the column list is static,
    // there is no group header and no colspan, so nothing here needed the hand-built version —
    // and the hand-built one had drifted in two ways the shared component fixes for free. The
    // column definition lands on the <th> as well as the cells, so the two numeric headings now
    // sit over their own figures (`table.data th.num` in tables.css) instead of adrift to the
    // left; and every cell gets a truncTip, so a long domain name clipped by the 320px cell cap
    // can still be read. It returns the `.table-wrap` itself — do not wrap it again.
    byDomainHost.append(dataTable({
      className: "exec-by-domain",
      columns: [
        { key: "name", label: view.columnHeader, cell: (r) => r.name },
        {
          key: "kmMedian",
          label: "Median MTTR (KM)",
          className: "num num--key",
          help: ["Kaplan–Meier median time-to-remediation for this group — still-open findings " +
            "censored, so it isn't biased low by fresh fast-patched vulns."],
          cell: (r) => fmtSpan(r.kmMedian),
        },
        { key: "open", label: "Open", className: "num", cell: (r) => r.open.toLocaleString() },
      ],
      rows: view.rows,
    }));
  }
}
