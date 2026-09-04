// The Code register: a weakness class at a file and a line in first-party source.
//
// WHY THIS IS ITS OWN PAGE. There is NO VENDOR. A weakness in our own code is fixed by
// changing the code, on the day it is found, so `fix_available_at` collapses onto
// `first_seen` and `mttr_actionable_days` is `mttr_days` by construction (ledgerCore.ts says
// so in as many words). Dependencies' two clocks are one clock here — which is exactly why
// this page must not borrow that page's tiles.
//
// THE CAVEAT THIS PAGE IS OBLIGED TO STATE. `SASTFinding` exposes `createdAt` and no
// `resolvedAt`, and `status: RESOLVED` returns nothing in this tenant, so `SAST_FETCH_RESOLVED`
// is false. The birth date is a real measurement; the death date is the scan that first
// stopped seeing the finding. That OVERSTATES the duration by up to one scan interval, and a
// freshly-started ledger reads near-zero until disappearances accrue. PRODUCT.md's rule is
// that "No MTTR yet" is a state a reader can act on and "MTTR is 0 days" is a confident lie,
// so the caveat is body copy on the page rather than a footnote in a commit message.
//
// AI VERDICT COVERAGE IS 0% IN THIS TENANT and it is SHOWN, not hidden. `aiAnalysis` is null
// on every captured node, so one of the SAST risk rule's three clauses has never fired. A
// rule whose clause cannot fire is a coverage gap to publish, not one to paper over.
//
// The shared register vocabulary is imported from `./sca.js` — see that file's header for
// why the eldest of the three registers hosts it. The numeric core (`num`/`fmtCount`/
// `days1`/`pct1`/`denomNote`) comes straight from `../ui.js` instead: `sca.js` no longer
// hosts a second copy of those five, only the register-shaped helpers built on top of them.

import { bootstrapCached, swrCall } from "../store.js";
import {
  absent, dataTable, days1, denomNote, el, emptyState, fmtCount, fmtDate, heroStat, meter,
  num, pageHeader, pct1, sevBadge, sevEntries, sevKeyRow, sevSegmentBar, skeletonStack, statRow,
} from "../ui.js";
import {
  RISK_TIER_LABELS, RISK_TIER_ORDER, agingModel, agingTableModel, chartCard,
  concentrationModel, figureCard, funnelModel, movementCard, movementModel, oldestFindingsModel,
  pagedTable, readRegisterParams, registerRowsTable, registerToolbar, renderRegisterPage,
  sectionCard, sevPalette, severityCountsTableModel, signalFigure, textCell, tierModel,
} from "./sca.js";

const SEVERITY_FALLBACK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/**
 * The disappearance-dating caveat, as one string.
 *
 * Exported so the page and the test read the SAME sentence: a caveat the page renders and a
 * test asserts separately is two claims that can drift apart, which is how a page quietly
 * stops saying the thing it was written to say.
 */
export const DISAPPEARANCE_CAVEAT =
  "A SAST finding carries a real creation date and no resolution date, and this tenant "
  + "returns no resolved SAST findings at all. So the clock STARTS at a measurement and STOPS "
  + "at an estimate: the finding is dated closed at the first scan that stopped seeing it, "
  + "which overstates the duration by up to one scan interval. Until two syncs have run and "
  + "findings have begun to disappear between them, this register reads near-zero — that is "
  + "an absence of observations, not a fast team.";

/**
 * The SAST high-risk rule, in a sentence.
 *
 * DEFAULT_SAST_RISK_RULE is an ANY-OF over three clauses that each answer a different
 * question, and the tenant answers only two of them (see `aiVerdict` above). Mirrored here
 * because the client bundle cannot import `src/domain/config.ts`; `test/pagesRegisters.test.js`
 * checks the three clause names against that file so the sentence cannot drift from the rule.
 */
export const SAST_RULE_SENTENCE =
  "A code finding is high risk when any one of three clauses fires: its CWE folds onto the "
  + "2024 CWE Top 25, the scanner's own AI triage calls it exploitable, or it is already "
  + "rated CRITICAL. Any one is enough — they are not scored together.";

export const SAST_RULE_CLAUSES = ["cwe", "aiVerdict", "critical"];

// =========================================================================================
//  The view model
// =========================================================================================

/**
 * The whole page as data. Pure — see `scaModel`'s note on why the testable half is this half.
 *
 * `registerModel` serves sca and sast with ONE SHAPE, so the shared blocks are reused from
 * `scaModel` rather than rebuilt; what differs is what this page is entitled to say about
 * them. The two SCA clocks are deliberately DROPPED rather than rendered as a pair of
 * complements: `awaiting_vendor_fix` is false on every sast row by construction, so an
 * "awaiting a vendor" tile here would be a zero that means "impossible", not "none".
 */
export function sastModel(payload, opts) {
  const p = payload || {};
  const order = (opts && opts.severityOrder) || SEVERITY_FALLBACK;
  const coverage = p.signalCoverage || {};
  const awaiting = p.awaiting || {};
  const concentration = concentrationModel(p.concentration, ["cwe", "repo", "language", "owner_project"]);
  const weakness = concentration.find((c) => c.dim === "cwe") || null;
  const tiers = tierModel(p.tiers, RISK_TIER_ORDER, RISK_TIER_LABELS);

  return {
    scope: "sast",
    asOf: p.asOf ?? null,
    severities: p.severities ?? null,
    showNoFix: p.showNoFix !== false,
    rowCount: num(p.rowCount),
    open: num(p.open),
    resolved: num(p.resolved),

    hero: {
      label: "Code",
      value: fmtCount(p.open),
      sub: `open weaknesses of ${fmtCount(p.rowCount)} in the register — `
        + `${fmtCount(p.resolved)} resolved.`,
    },

    // ONE CLOCK, AND THE PAGE SAYS WHY IT IS ONE.
    clock: {
      id: "disappearance",
      birth: "createdAt, from the Wiz API — a real date",
      death: "the first scan that stopped returning the finding — an estimate",
      caveat: DISAPPEARANCE_CAVEAT,
      overstatesBy: "up to one scan interval",
      resolvedInRegister: num(p.resolved),
      // No vendor, so no second clock: `awaiting_vendor_fix` cannot be true on this scope.
      awaitingVendorApplicable: false,
      awaitingVendorFlagged: num(awaiting.notApplicable),
      denominator:
        `${fmtCount(p.resolved)} of ${fmtCount(p.rowCount)} findings in this register have a `
        + "closing date at all, and every one of those dates came from a disappearance rather "
        + "than from the API.",
    },

    rule: {
      sentence: SAST_RULE_SENTENCE,
      clauses: SAST_RULE_CLAUSES.slice(),
      glossary: "cwe-top-25",
    },

    // 0% in this tenant, and published as such. `signalFigure` renders "never evaluated"
    // rather than a zero, which is the difference between a gap and an all-clear.
    aiVerdict: signalFigure("ai_verdict", "AI triage verdict", "sast", coverage.ai_verdict),

    severityAxis: p.severityAxis || { supported: true },
    counts: p.counts || {},
    severityOrder: order.slice(),
    weaknessMix: weakness,
    aging: agingModel(p.aging),
    tiers,
    // The CWE clause is the only one of the three with real coverage here, so the tier
    // ranking is reported beside the coverage figure that qualifies it.
    cweTierCount: num((tiers.rows.find((r) => r.tier === "cwe") || {}).count),
    funnel: funnelModel(p.funnel),
    concentration: concentration.filter((c) => c.dim !== "cwe"),
    oldest: oldestFindingsModel(p.oldest),
    movement: movementModel(p.movement, p.latestScan),

    // NOTHING LEFT TO NAME AS MISSING. file_path, start_line, language, origin and cwe were
    // the whole of this page's original "columns absent from the payload" list, and every one
    // of them is in `REGISTER_ROW_COLUMNS.sast` — `api_getRegisterRows` and the per-finding
    // table below carry all four. `missingColumns` stays `null` rather than an empty-list
    // sentence so the page has something concrete to check for its absence.
    missingColumns: null,
  };
}

// =========================================================================================
//  The page
// =========================================================================================

/** First-party code: a weakness class at a file and a line. */
export function renderSast(host, params) {
  const filters = readRegisterParams(params);
  const boot = bootstrapCached();
  const order = (boot && boot.severityOrder) || SEVERITY_FALLBACK;

  return renderRegisterPage(host, {
    skeleton: () => skeletonStack(6, { widths: ["70%", "100%", "90%", "100%", "80%", "60%"] }),
    fetch: () => swrCall("api_getRegisterPage", {
      scope: "sast",
      severities: filters.severities.length ? filters.severities : undefined,
      // `baseRowNoFix` is false on every non-sca row, so this cannot narrow anything here.
      // Sent anyway so the cache key matches the server's `modelParams` default.
      showNoFix: filters.showNoFix,
    }),
    paint: (payload) => paintSast(host, sastModel(payload, { severityOrder: order }), filters),
  });
}

function paintSast(host, vm, filters) {
  // Same defect, same fix as `paintSca`: the hero bar carried severity in colour alone and
  // drew an empty bordered box over an empty ledger. The key row names and counts every
  // segment; a zero total renders neither the bar nor the key.
  const heroSevs = sevEntries(vm.counts, vm.severityOrder);
  host.append(pageHeader({
    hero: heroStat("Registers · Code", vm.hero.value, vm.hero.sub, { term: "sast" }),
    aside: el("div", { class: "page-strip" },
      heroSevs.length
        ? [
          sevSegmentBar(heroSevs, { size: "lg", label: "Open weaknesses by severity" }),
          sevKeyRow(heroSevs),
        ]
        : null,
      el("p", { class: "small muted" },
        "A weakness class at a file and a line in our own source. There is no vendor: this "
        + "one is fixed by changing the code."),
    ),
    stats: [
      statRow("In register", fmtCount(vm.rowCount), "weaknesses, open and resolved"),
      statRow("Open", fmtCount(vm.open), "still outstanding"),
      statRow("Resolved", fmtCount(vm.resolved), "dated by disappearance"),
    ],
  }));

  host.append(registerToolbar({
    route: "sast",
    severities: filters.severities,
    order: vm.severityOrder,
    showNoFix: filters.showNoFix,
    // NOT OFFERED. A "has a fixed version" switch over a register with no vendor is a control
    // that cannot change the answer, which is the one thing this app's chrome never ships.
    offerNoFix: false,
  }));

  // ------------------------------------------------------------------ the one clock
  host.append(sectionCard("Where this register's clock starts, and where it stops", "censoring",
    el("p", {}, vm.clock.caveat),
    el("div", { class: "kpi-row" },
      figureCard({
        label: "Clock starts",
        value: "createdAt",
        sub: vm.clock.birth,
      }),
      figureCard({
        label: "Clock stops",
        value: "Disappearance",
        sub: vm.clock.death,
        denominator: vm.clock.denominator,
      }),
      figureCard({
        label: "Awaiting a vendor",
        value: "Not applicable",
        sub: "no vendor to wait on — this register's second clock is the first one",
        help: { term: "two-clocks" },
        denominator:
          "0 of this register's rows can be awaiting a vendor fix: the awaiting-vendor flag "
          + "is false on every non-dependency row by construction, so this is an "
          + "impossibility rather than a count of none."
          + (vm.clock.awaitingVendorFlagged
            ? ` ${fmtCount(vm.clock.awaitingVendorFlagged)} row(s) carry the flag anyway and `
              + "were refused rather than trusted."
            : ""),
      }),
    ),
  ));

  // ------------------------------------------------------------------ the rule
  host.append(sectionCard("The rule that calls a weakness high risk", "cwe-top-25",
    el("p", {}, vm.rule.sentence),
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Clause", cell: (r) => r.label },
        { key: "count", label: "Open findings", className: "num", cell: (r) => fmtCount(r.count) },
        {
          key: "share",
          label: "Share of classified",
          cell: (r) => meter(r.pct === null ? 0 : r.pct, {
            className: "meter--stat",
            label: `${r.label}, ${pct1(r.pct)}`,
          }),
        },
      ],
      rows: vm.tiers.rows.filter((r) => vm.rule.clauses.includes(r.tier) || r.count > 0),
      emptyText: "Nothing open to classify.",
    })),
    denomNote(vm.tiers.denominator),
  ));

  // ----------------------------------------------------- ai_verdict coverage, shown
  host.append(sectionCard("AI triage coverage", "sast",
    el("p", { class: "small muted" },
      "One of the rule's three clauses reads the scanner's own verdict. This is how much of "
      + "the register that verdict was ever recorded for — shown rather than inferred from a "
      + "clause that never fires."),
    el("div", { class: "kpi-row" },
      figureCard({
        label: "Verdict recorded",
        value: vm.aiVerdict.cells.measured,
        sub: pct1(vm.aiVerdict.coveragePct) + " of applicable rows",
        denominator: vm.aiVerdict.denominator,
      }),
      figureCard({
        label: "Never evaluated",
        value: vm.aiVerdict.missing > 0 ? fmtCount(vm.aiVerdict.missing) : "None",
        sub: vm.aiVerdict.verdict,
      }),
    ),
  ));

  // ------------------------------------------------------------------ weakness mix
  host.append(sectionCard("The weakness mix", "cwe-top-25",
    vm.weaknessMix && vm.weaknessMix.rows.length
      ? el("div", {},
        el("div", { class: "table-host" }, dataTable({
          columns: [
            { key: "key", label: "Weakness class", cell: (r) => r.key },
            { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
            {
              key: "repos",
              label: "Repositories",
              className: "num",
              cell: (r) => fmtCount(r.repos),
            },
          ],
          rows: vm.weaknessMix.rows,
          emptyText: "No open weaknesses.",
        })),
        denomNote(vm.weaknessMix.denominator),
      )
      : emptyState(
        "No weakness classes to rank.",
        "Nothing open in this register carries a CWE.",
      ),
  ));

  // ------------------------------------------------------------------- aging + funnel
  host.append(el("div", { class: "chart-row" },
    chartCard("Open weaknesses by age", vm.aging.denominator, (api, canvas) => {
      api.stackedAgeBar(
        canvas,
        vm.aging.labels,
        vm.aging.perSev,
        sevPalette(vm.severityOrder),
        "Open code weaknesses by age bucket and severity.",
      );
    }, {
      caption: "Every bar of the stack as a count: one row per age bucket, one column per"
        + " severity drawn.",
      model: agingTableModel(vm.aging.labels, vm.aging.perSev, vm.severityOrder),
    }),
    chartCard("Open weaknesses by severity", null, (api, canvas) => {
      api.severityBar(canvas, vm.counts, sevPalette(vm.severityOrder), null);
    }, {
      caption: "The length of each bar, as a count of open weaknesses.",
      model: severityCountsTableModel(vm.counts, vm.severityOrder, "Open weaknesses"),
    }),
  ));

  host.append(sectionCard("Triage funnel", null,
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Step", cell: (r) => r.label },
        { key: "count", label: "Findings", className: "num", cell: (r) => fmtCount(r.count) },
        {
          key: "share",
          label: "Of open",
          cell: (r) => meter(r.pct === null ? 0 : r.pct, {
            className: "meter--stat",
            label: `${r.label}, ${pct1(r.pct)}`,
          }),
        },
      ],
      rows: vm.funnel.steps,
      emptyText: "Nothing open.",
    })),
    denomNote(vm.funnel.denominator),
    vm.funnel.note ? el("p", { class: "small muted" }, vm.funnel.note) : null,
  ));

  // ---------------------------------------------------------------------- breakdowns
  for (const dim of vm.concentration) {
    host.append(sectionCard(dim.label, null,
      el("div", { class: "table-host" }, dataTable({
        columns: [
          { key: "key", label: "Group", cell: (r) => r.key },
          { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
          { key: "repos", label: "Repositories", className: "num", cell: (r) => fmtCount(r.repos) },
        ],
        rows: dim.rows,
        emptyText: "No open weaknesses in this dimension.",
      })),
      denomNote(dim.denominator),
    ));
  }

  // ------------------------------------------------------------------ oldest open
  host.append(sectionCard("Oldest open weaknesses", null,
    vm.oldest.length
      ? pagedTable({
        rows: vm.oldest,
        sortSpec: { value: (r) => r.ageDays, descending: true, tiebreak: (r) => r.identifier },
        columns: [
          {
            key: "identifier",
            label: "Rule / weakness",
            cell: (r) => r.identifier || absent(),
            help: { term: "sast" },
          },
          { key: "repo", label: "Repository", cell: (r) => r.repo || absent() },
          { key: "owner", label: "Owning project", cell: (r) => r.ownerProject || absent() },
          { key: "sev", label: "Severity", cell: (r) => sevBadge(r.severity) },
          {
            key: "age",
            label: "Open for",
            className: "num",
            cell: (r) => (r.ageDays === null ? absent() : days1(r.ageDays)),
          },
        ],
        emptyText: "Nothing open.",
      })
      : emptyState(
        "Nothing open in this register.",
        "Every code weakness is resolved, or no sync has saved one yet.",
      ),
  ));

  // ------------------------------------------------------------- every finding, server-paged
  host.append(sectionCard("Every finding in the register", null,
    el("p", { class: "small muted" },
      "Open and resolved, server-paged and server-sorted — click a column to ask for a "
      + "different order rather than re-sorting what is already on screen."),
    registerRowsTable({
      scope: "sast",
      severities: filters.severities,
      defaultSort: "age_days",
      defaultDir: "desc",
      emptyText: "Nothing in this register.",
      columns: [
        {
          key: "identifier", label: "Rule / weakness", sortable: true,
          cell: (r) => textCell(r.identifier), help: { term: "sast" },
        },
        { key: "cwe", label: "CWE", sortable: true, cell: (r) => textCell(r.cwe), help: { term: "cwe-top-25" } },
        { key: "file_path", label: "File", sortable: true, cell: (r) => textCell(r.file_path) },
        {
          key: "start_line", label: "Line", className: "num", sortable: true,
          cell: (r) => (r.start_line === null || r.start_line === undefined ? absent() : String(r.start_line)),
        },
        { key: "language", label: "Language", sortable: true, cell: (r) => textCell(r.language) },
        { key: "origin", label: "Scanner", sortable: true, cell: (r) => textCell(r.origin) },
        { key: "ai_verdict", label: "AI verdict", sortable: true, cell: (r) => textCell(r.ai_verdict) },
        { key: "severity", label: "Severity", sortable: true, cell: (r) => sevBadge(r.severity) },
        { key: "status", label: "Status", sortable: true, cell: (r) => textCell(r.status) },
        { key: "repo_name", label: "Repository", sortable: true, cell: (r) => textCell(r.repo_name) },
        { key: "first_seen", label: "First seen", sortable: true, cell: (r) => fmtDate(r.first_seen) },
        { key: "last_seen", label: "Last seen", sortable: true, cell: (r) => fmtDate(r.last_seen) },
        {
          key: "age_days", label: "Age", className: "num", sortable: true,
          cell: (r) => days1(r.age_days),
        },
      ],
    }),
  ));

  host.append(movementCard(vm.movement));
}
