// Executive — the front door, and the one page a leader is allowed to read alone.
//
// ONE NUMBER, AND IT IS ALLOWED TO REFUSE TO BE A NUMBER. The hero is the register's
// remediation half-life read off a Kaplan-Meier curve. Where that curve never falls to
// half — which is the normal state of a young register carrying more open findings than
// closed ones — there IS no median, and the page publishes `medianLowerBound` as "at least
// N days" instead. PRODUCT.md's sixth principle is the whole reason this file exists in
// this shape: a clock has to say where it started, and a bare number in the hero slot would
// be claiming a measurement nobody made. `executiveHeroView` is where that decision lives,
// pure and exported, so the claim is testable without a DOM.
//
// NO CHART ON THE FRONT DOOR, and that is a decision rather than an omission. Chart.js is
// ~170 KB fetched over `google.script.run` on the first route that draws one
// (chartsLoader.js); the landing page draws none, so the front door never pays for it. The
// survival curve, its censor markers and the per-severity split live on MTTR & SLA, one
// link away — see `curveNote` below, which also states the payload reason.
//
// WHAT THIS PAGE IS SENT, and what it therefore cannot say. `api_getExecutivePage` composes
// two read-models and slices one of them hard (domain/pagePayload.ts::execMttrSlice): the
// hero arrives as `{median, medianLowerBound}` and NOTHING else — no `curve`, no `censored`,
// no `events`. So the hero's qualifier line names resolved and still-open lifecycles, which
// are in the payload, and does not claim they are the estimator's event and censored counts,
// which are not. `execGroupSlice` narrows the per-register split to `{group, kmMedian, open}`,
// dropping each register's own `kmMedianLowerBound` — so a register whose curve never
// reaches half shows a dash there rather than a bound, and says so.

import { bootstrap, swrCall } from "../store.js";
import {
  clear, dataTable, el, emptyState, fmtCount, fmtDateTime, fmtDays, heroStat, kpiCard,
  pageHeader, pluralize, sectionLabel, sevBadge, skeleton, statRow, statusPill,
} from "../ui.js";
// THE HALF-LIFE DECISION IS IMPORTED, NOT REPEATED. `execMttrSlice` is a slice of the MTTR
// page's own payload (api.ts says so), so the rule that turns `{median, medianLowerBound}`
// into a sentence has to be the same rule on both pages or the front door and the detail page
// could describe the same estimate differently. It lives on the page that owns the clock.
// `fmtCount`/`fmtDays` themselves come from `../ui.js` now, not from `./mttr.js` — see
// `ui/figures.js`'s module header.
import { kmHalfLifeView, rateView } from "./mttr.js";

const SCOPE_LABELS = { sca: "Dependencies (SCA)", sast: "Code (SAST)", secrets: "Secrets" };

// ------------------------------------------------------------------------- view models

/**
 * The hero, decided rather than formatted.
 *
 * THE THREE OUTCOMES ARE THREE DIFFERENT CLAIMS and the view keeps them apart:
 *
 *   median present        "41 days"          — half the register closed within that
 *   median null, bound    "at least 41 days" — the curve never reached half; 41 d is the
 *                                              longest thing observed, so the median is at
 *                                              LEAST that. `isLowerBound` is true.
 *   neither               "Not measured"     — no observations at all. Not a zero.
 *
 * The second case is the one this register was built to get right. Rendering the bound as a
 * bare "41 days" would state a median that was never observed; collapsing it to "—" would
 * throw away a true statement. So it is published, prefixed, and flagged.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 * @returns {{measured: boolean, value: string, isLowerBound: boolean, days: number|null,
 *            tracked: number, resolved: number, open: number, qualifier: string,
 *            censoredKnown: boolean}}
 */
export function executiveHeroView(payload) {
  const mttr = (payload && payload.mttr) || null;
  const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
  const tracked = Number((mttr && mttr.rowCount) || 0);
  const overall = (mttr && mttr.overall) || {};
  const resolved = Number(overall.resolved || 0);
  const open = Number(overall.open || 0);

  const half = kmHalfLifeView(km);

  // Deliberately NOT called "events" and "censored". The estimator's own counts are not in
  // this payload (execMttrSlice drops them), and resolved/open are close but not identical —
  // a row whose first_seen will not parse contributes to neither. The MTTR page has the real
  // pair; this line says what it actually knows.
  const qualifier = tracked
    ? fmtCount(tracked) + " tracked " + pluralize(tracked, "lifecycle")
      + " · " + fmtCount(resolved) + " resolved · " + fmtCount(open) + " still open"
    : "No lifecycles tracked yet.";

  return {
    measured: half.measured,
    value: half.value,
    isLowerBound: half.isLowerBound,
    days: half.days,
    tracked,
    resolved,
    open,
    qualifier,
    // The estimator's censored count is on MTTR & SLA, not here — see the module header.
    censoredKnown: false,
  };
}

/**
 * Open findings by severity, register-wide.
 *
 * `severityCounts.counts` is built from OPEN rows only (`readModels.buildExecutive`), so
 * these tiles are live risk rather than everything ever recorded — and the sub-line says
 * which, because a tile labelled only "CRITICAL" over a number is the exact ambiguity this
 * register keeps closing.
 *
 * A LEVEL WITH ZERO OPEN FINDINGS IS STILL A TILE, so long as the level exists in the
 * severity order. A missing tile reads as a render that failed; an honest 0 does not.
 */
export function executiveSeverityView(payload, order) {
  const block = (payload && payload.severityCounts) || null;
  const counts = (block && block.counts) || {};
  const levels = (order || []).filter((s) => s !== "UNKNOWN" || counts[s]);
  return {
    show: !!block,
    tiles: levels.map((sev) => ({ sev, count: Number(counts[sev] || 0) })),
    open: Number((block && block.open) || 0),
    total: Number((block && block.total) || 0),
    note: block && block.total && !block.open
      ? "Every tracked finding in this register is closed — nothing is open at any severity."
      : null,
  };
}

/**
 * The three registers side by side: how much is open in each, and how fast each closes.
 *
 * THE HALF-LIFE COLUMN CAN ONLY BE A NUMBER OR A DASH HERE. `execGroupSlice` ships
 * `kmMedian` and drops `kmMedianLowerBound`, so a register whose curve never reaches half
 * arrives as `kmMedian: null` with no bound behind it. That renders as "—" plus a footnote
 * pointing at MTTR & SLA, never as a 0 and never as an invented figure.
 */
export function executiveRegisterView(byScope) {
  const raw = byScope && Array.isArray(byScope.rows) ? byScope.rows : [];
  // The share column's base is the OPEN backlog across the registers this payload carries —
  // not every finding ever tracked, and not the register the reader happens to be scoped to.
  // It rides in the denominator node beside every figure so it cannot be guessed at.
  const totalOpen = raw.reduce((a, r) => a + Number(r.open || 0), 0);
  const rows = raw
    .map((r) => {
      const scope = r.group;
      const kmMedian = r.kmMedian === null || r.kmMedian === undefined ? null : Number(r.kmMedian);
      const open = Number(r.open || 0);
      return {
        scope,
        label: SCOPE_LABELS[scope] || String(scope),
        open,
        share: rateView(
          totalOpen > 0 ? (open / totalOpen) * 100 : null,
          totalOpen,
          fmtCount(totalOpen) + " open across the registers",
        ),
        kmMedian,
        kmText: kmMedian !== null && Number.isFinite(kmMedian) ? fmtDays(kmMedian) : "—",
        // True where the register HAS lifecycles but no observable median. The bound that
        // would replace the dash is not in this payload.
        boundNotShipped: kmMedian === null,
      };
    })
    .sort((a, b) => b.open - a.open);
  return {
    show: rows.length > 0,
    rows,
    totalOpen,
    anyBoundMissing: rows.some((r) => r.boundNotShipped),
  };
}

/**
 * Movement, and what it is movement OF.
 *
 * `weekTrend` is the KM median now against the KM median replayed a week ago — both computed
 * from the same scoped population, so it is scope-correct by construction. It is NOT the
 * per-scan arrival/closure movement the stub asks for in those words: `getExecutivePage`
 * ships no scan deltas at all (see the module header). So the badge says "half-life" and
 * "versus last week" in its own label rather than borrowing the language of a different
 * measurement.
 *
 * Null when the register is under a week old or either endpoint's median is unobservable —
 * `readModels.weekTrend` refuses to substitute a lower bound for a median, so an absent badge
 * means "not comparable", not "unchanged".
 */
export function executiveMovementView(weekTrend) {
  if (!weekTrend) {
    return {
      show: false,
      reason: "Under a week of history, or the half-life was not observable at one of the two"
        + " endpoints. No comparison is published rather than a made-up one.",
    };
  }
  const delta = Number(weekTrend.deltaDays);
  if (!Number.isFinite(delta)) return { show: false, reason: "The week-over-week delta is not a number." };
  const direction = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const magnitude = fmtDays(Math.abs(delta));
  return {
    show: true,
    direction,
    // Up = slower remediation = worse. Stated in words so the arrow is never the only cue.
    label: direction === "flat"
      ? "Half-life unchanged versus last week"
      : "Half-life " + (direction === "up" ? "up" : "down") + " " + magnitude
        + " versus last week — remediation is " + (direction === "up" ? "slower" : "faster"),
    magnitude: direction === "flat" ? "±0" : (direction === "up" ? "↑ " : "↓ ") + magnitude,
    current: weekTrend.current === null || weekTrend.current === undefined
      ? null
      : Number(weekTrend.current),
    previous: weekTrend.previous === null || weekTrend.previous === undefined
      ? null
      : Number(weekTrend.previous),
    days: Number(weekTrend.days || 7),
  };
}

// ----------------------------------------------------------------------------- the page

/** The one valid scope a deep link may narrow this page to. */
function scopeParam(params) {
  const s = params && params.scope;
  return s === "sca" || s === "sast" || s === "secrets" ? s : null;
}

export async function renderExecutive(host, params, _ctx) {
  const boot = await bootstrap();
  const scope = scopeParam(params);

  let paint = null;
  const data = swrCall(
    "api_getExecutivePage",
    scope ? { scope } : {},
    (fresh) => paint && paint(fresh),
  );

  const heroHost = el("div", {});
  const sevHost = el("div", {});
  const registerHost = el("div", {});
  const scanHost = el("div", {});
  host.append(heroHost, sevHost, registerHost, scanHost);

  // One failing section must never blank the front door.
  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[executive] " + label + " render failed:", e);
      clear(target).append(emptyState("Couldn't render " + label + "."));
    }
  }

  clear(heroHost).append(
    el("div", { role: "status", "aria-label": "Computing the remediation half-life" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );
  guard("the scan caption", scanHost, renderScan);

  paint = (payload) => {
    guard("the half-life", heroHost, () => renderHero(payload));
    guard("open findings by severity", sevHost, () => renderSeverity(payload));
    guard("the register split", registerHost, () => renderRegisters(payload));
  };

  try {
    paint(await data);
  } catch (e) {
    console.error("[executive] api_getExecutivePage failed:", e);
    clear(heroHost).append(emptyState(
      "Couldn't load remediation data.",
      String((e && e.message) || e),
    ));
  }

  // ------------------------------------------------------------------------------ hero

  function renderHero(payload) {
    const view = executiveHeroView(payload);
    clear(heroHost);

    const stats = [
      statRow("Tracked", fmtCount(view.tracked), "lifecycles in the ledger"),
      statRow("Resolved", fmtCount(view.resolved), "closed findings — the estimator's events"),
      statRow(
        "Still open",
        fmtCount(view.open),
        "kept in as right-censored observations",
        null,
        { term: "censoring" },
      ),
    ];

    heroHost.append(pageHeader({
      hero: heroStat(
        "Remediation half-life",
        view.value,
        view.qualifier,
        { term: "half-life" },
      ),
      aside: renderMovement(payload),
      stats,
    }));

    if (view.isLowerBound) {
      heroHost.append(el("p", { class: "small muted" },
        "The survival curve never falls to half within the observed window, so there is no"
        + " median to publish. What is true is the bound above: more than half of what is"
        + " tracked is still open, so the half-life is at least that long."));
    } else if (!view.measured) {
      heroHost.append(el("p", { class: "small muted" },
        "No lifecycle has a readable clock yet. This is “not measured”, not zero —"
        + " the half-life needs at least one observation to rest on."));
    }
    heroHost.append(curveNote());
  }

  /**
   * Where the curve is, and why it is not here.
   *
   * The stub promised one figure with its censored count beside it, and that is what the
   * hero draws. The CURVE itself is not in this payload — `execMttrSlice` ships two scalars
   * — so this points at the page that has it rather than drawing an empty box on the front
   * door or paying 170 KB for a chart the landing page was sliced to avoid.
   */
  function curveNote() {
    return el("p", { class: "small muted" },
      "The survival curve, its censor markers and the per-severity split are on ",
      el("a", { class: "linklike", href: "#/mttr" }, "MTTR & SLA"),
      ". This page is sent the estimate only, not the curve behind it.");
  }

  function renderMovement(payload) {
    const view = executiveMovementView(payload && payload.weekTrend);
    const box = el("div", { class: "page-strip" },
      el("div", { class: "kpi-label" }, "Movement"));
    if (!view.show) {
      box.append(el("div", { class: "small muted" }, "No week-over-week comparison. " + view.reason));
      return box;
    }
    // The pill's tint is never the only cue: the arrow, the magnitude and the sentence
    // underneath all say the same thing in text.
    const kind = view.direction === "flat" ? "neutral" : view.direction === "up" ? "bad" : "ok";
    box.append(
      statusPill(kind, view.magnitude),
      el("div", { class: "small muted" }, view.label + "."),
    );
    return box;
  }

  // -------------------------------------------------------------------------- severity

  function renderSeverity(payload) {
    const view = executiveSeverityView(payload, boot.severityOrder);
    clear(sevHost);
    if (!view.show) {
      sevHost.append(sectionLabel("Open findings by severity"));
      sevHost.append(emptyState("No severity tally in this payload."));
      return;
    }
    sevHost.append(sectionLabel("Open findings by severity"));
    const row = el("div", { class: "kpi-row" });
    for (const t of view.tiles) {
      row.append(kpiCard(sevBadge(t.sev), fmtCount(t.count), "open"));
    }
    sevHost.append(row);
    sevHost.append(el("p", { class: "small muted" },
      fmtCount(view.open) + " open of " + fmtCount(view.total) + " tracked. Severity is the"
      + " grade Wiz put on the detection; on the secrets register it grades the detection and"
      + " not whether the credential is live, which is why that register is segmented"
      + " differently on its own page."));
    if (view.note) sevHost.append(el("p", { class: "small muted" }, view.note));
  }

  // ------------------------------------------------------------------------- registers

  function renderRegisters(payload) {
    const view = executiveRegisterView(payload && payload.byScope);
    clear(registerHost);
    registerHost.append(sectionLabel("The three registers"));
    if (!view.show) {
      registerHost.append(emptyState(
        "No per-register split yet.",
        "It appears once a scan has saved findings for at least one register.",
      ));
      return;
    }
    registerHost.append(dataTable({
      columns: [
        { key: "label", label: "Register", cell: (r) => r.label },
        {
          key: "open",
          label: "Open",
          className: "num",
          cell: (r) => fmtCount(r.open),
        },
        {
          key: "share",
          label: "Share of the open backlog",
          cell: (r) => el("span", {},
            el("span", { class: "num" }, r.share.text),
            " ",
            el("span", {
              class: "small muted",
              "data-denominator": r.share.denominator === null ? "none" : String(r.share.denominator),
            }, r.share.denominatorLabel)),
        },
        {
          key: "km",
          label: "Half-life",
          className: "num",
          help: { term: "half-life" },
          cell: (r) => r.kmText,
        },
      ],
      rows: view.rows,
      className: "exec-registers",
    }));
    registerHost.append(el("p", { class: "small muted" },
      "Three registers, three clocks. The same CVE arriving through a dependency and through"
      + " first-party code is two findings with two clocks, so these are never summed into one"
      + " number."));
    if (view.anyBoundMissing) {
      registerHost.append(el("p", { class: "small muted" },
        "A dash means that register's curve never falls to half. Its lower bound is not in"
        + " this payload; MTTR & SLA publishes it."));
    }
  }

  // ------------------------------------------------------------------------- last scan

  /**
   * When the register last looked. The CONTROL to look again lives in the rail's scan zone
   * — one run button in one place, so a reader is never offered two that could disagree
   * about what is already running.
   */
  function renderScan() {
    clear(scanHost);
    scanHost.append(sectionLabel("Last sync"));
    const latest = boot.latestSync;
    if (!latest) {
      scanHost.append(emptyState(
        "No sync saved yet.",
        "Every figure above is empty until one runs — run it from the scan zone in the rail.",
      ));
      return;
    }
    // EVERY REGISTER THE SYNC TOUCHED, not the one that sorted first. One run writes one
    // `scans` row per scope; naming a single one here reported a third of the observation as
    // the whole of it — on the page that argues two sections above that the three registers
    // are three clocks and are never collapsed into one.
    scanHost.append(el("p", { class: "scan-caption" },
      fmtDateTime(latest.ts)
      + " · " + fmtCount(latest.total) + " " + pluralize(Number(latest.total || 0), "finding")
      + " across " + fmtCount(latest.scopes.length)
      + " " + pluralize(latest.scopes.length, "register")));
    scanHost.append(el("ul", { class: "scan-scopes small muted" },
      ...latest.scopes.map((s) => el("li", {},
        (SCOPE_LABELS[s.scope] || s.scope)
        + " · " + fmtCount(s.total) + " " + pluralize(Number(s.total || 0), "finding")
        // The coverage half of the caption. `null` means the severity gate was off for that
        // register and it looked at everything — which is the SECRETS default, so rendering
        // it as "none" would invert the most deliberate choice in this product.
        + " · " + (s.severities ? "severities " + s.severities : "all severities"),
      ))));
    scanHost.append(el("p", { class: "small muted" },
      "What that sync changed is on ",
      el("a", { class: "linklike", href: "#/history" }, "Scan history"),
      ", which is the page sent the per-scan arrival and closure counts — one row per register"
      + " per sync. Run another from the scan zone in the rail."));
    if (!boot.hasCredentials) {
      scanHost.append(el("p", { class: "small muted" },
        "No Wiz credentials are configured, so these figures come from a dry run rather than"
        + " from the tenant."));
    }
  }
}
