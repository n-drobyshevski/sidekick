// The "All frameworks" sub-view of Compliance Posture: five bands answering, in order,
// "where do we stand", "which framework is worst", "which subcategory is worst", "which
// control costs us across more than one framework", and "what haven't we even looked at
// yet". Every number on this page is assembled HERE, client-side, from rollups the server
// computed once — this file draws them and asks nothing else of the network.
//
// THE HEADLINE NUMBER IS OURS, NOT WIZ'S, AND SAYS SO. Wiz scores a framework; it does not
// score an estate. kpis.averagePosture is a mean this app takes across the frameworks that
// happen to be scored, and the sub-line under the hero states that plainly and names the
// denominator — the one place on this page a number could be mistaken for a vendor figure,
// so it is the one place that gets a disclaimer.
//
// THE RAIL (band B) is where the null-posture invariant most needs to hold and least gets
// tested: every seeded framework in the dev estate happens to be scored, so an accidental
// `posturePct ?? 0` here would draw a perfectly plausible-looking bar for a framework with
// no bar to draw, and nothing short of a real tenant with a genuinely unscored framework
// would ever catch it. Treat the unscored branch as the one under test, not the one that
// happens not to fire today.
//
// ACCESSIBLE NAMES, NOT DOUBLE ANNOUNCEMENTS. A rail row is a `<button>` whose accessible
// name is computed from its contents by default — so if the visible name, meta, bar and
// percentage inside it were left readable to assistive tech, a screen reader would announce
// the framework's name twice and the percentage twice. Every rail row instead carries one
// explicit `aria-label` stating the whole thing as a sentence, and everything drawn inside
// it is `aria-hidden`. The shared-controls "raised by" strip is the opposite case: it is a
// picture sitting in a table cell with no button around it, so it keeps `role="img"` +
// `aria-label` on itself — but the visible "3 of 4" count sits OUTSIDE that labelled
// picture, or a sighted-plus-screen-reader user would see one thing and hear another.
//
// postureCell(), checksCell(), stateStrip() and openSubcategorySheet() all come from
// complianceShared.js — the same cells and the same sheet the per-framework register uses,
// not a second implementation of either.

import {
  checksCell, extChip, findSubcategory, openSubcategorySheet, postureCell, STATES, stateStrip,
} from "./complianceShared.js";
import {
  dataTable, el, emptyState, meter, plural, sectionLabel, sevBadge, statRow,
} from "../ui.js";

/**
 * plural()'s -s rule mangles "policy" into "policys" — the same irregular case
 * compliance.js's openSubcategorySheet already spells out by hand rather than teaching the
 * helper an exception for one word.
 */
function policyNoun(n) {
  return n === 1 ? "policy" : "policies";
}

function policyKindLabel(kind) {
  if (kind === "CONTROL") return "Control";
  if (kind === "HOST_RULE") return "Host rule";
  return "Cloud rule";
}

/** The sentence form of why a framework or row has no posture — capitalised, a full stop. */
function reasonBlurb(row) {
  if (row.emptyPostureReason === "NO_POLICIES") return "No check is written for this.";
  if (row.emptyPostureReason === "NO_RESOURCES") {
    return "There is nothing in this estate for these checks to evaluate.";
  }
  return "Wiz did not report a status for this framework.";
}

/** Same reason, folded into the lane's "label — reason" line: lower-case, no full stop. */
function reasonWords(row) {
  return reasonBlurb(row).replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase());
}

export function renderOverview(host, data, view, actions) {
  // A stale SWR cache from before this band shipped degrades to `rail: undefined` rather
  // than throwing (the payload contract's defensive-coding note) — and that is genuinely
  // indistinguishable from "nothing synced yet" from this page's point of view, so it gets
  // the same message the per-framework view shows for zero trees.
  const rail = (data && data.rail) || [];
  if (!rail.length) {
    host.append(emptyState(
      "No compliance posture has been synced yet.",
      "This view needs the cross-framework rollup the last sync produced. Refresh the " +
      "page, or run a sync if this stays empty.",
    ));
    return;
  }

  renderHeadline(host, data, view, actions);
  renderRail(host, data, actions);
  renderWeakestAreas(host, data, view);
  renderSharedControls(host, data);
  renderCoverage(host, data);
}

// -------------------------------------------------------------------- A. headline

function renderHeadline(host, data, view, actions) {
  const kpis = data.kpis || {};
  const coverage = data.coverage || {};
  const scored = kpis.averagePosture !== null && kpis.averagePosture !== undefined;

  const hero = el("div", {},
    el("div", { class: "label" }, "Compliance posture"),
    scored
      ? el("div", { class: "comp-hero-value num" }, `${kpis.averagePosture}%`)
      : el("div", { class: "comp-hero-value" }, "—"),
    scored
      ? el("div", { class: "comp-hero-meter" }, meter(kpis.averagePosture, {
          max: 100,
          label: `Estate compliance posture, ${kpis.averagePosture} percent`,
        }))
      : null,
    // The one number on this page Wiz did not hand us — it names its own denominator so it
    // is never mistaken for a vendor figure.
    el("div", { class: "comp-hero-sub" }, scored
      ? `Derived here — the mean of ${plural(kpis.scoredFrameworks || 0, "scored framework")}. ` +
        "Wiz publishes no cross-framework figure."
      : "Derived here — no framework has a compliance posture to average yet. " +
        "Wiz publishes no cross-framework figure."),
  );

  // The shared strip only ever reads `.stateCounts`, so the estate-wide roll-up — which is
  // not a FrameworkTree — can drive the exact same component the register uses per framework.
  const strip = stateStrip({ stateCounts: coverage.stateCounts || {} }, view.state,
    (key) => actions.setState(key));

  const sharedRows = data.sharedControls || [];
  const sharedCount = sharedRows.filter((c) => (c.frameworkCount || 0) >= 2).length;

  const stats = el("div", { class: "stat-list" },
    statRow("Frameworks", `${coverage.collected ?? 0} of ${coverage.catalogued ?? 0}`,
      "collected of catalogued"),
    statRow("Failing subcategories", String(kpis.failingSubcategories ?? 0),
      "across every collected framework"),
    statRow("Failing controls", String(kpis.failingPolicies ?? 0),
      "distinct policies with a failing check"),
    statRow("Shared across frameworks", String(sharedCount),
      `of ${plural(sharedRows.length, "failing control")}`),
  );

  host.append(el("div", { class: "comp-ov-section" },
    sectionLabel("Estate posture"),
    el("div", { class: "comp-header" }, hero, strip, stats)));
}

// ------------------------------------------------------------------------ B. rail

function railMetaText(row) {
  if (row.state === "scored" && row.posturePct !== null) {
    return `${row.failingPolicyCount} of ${row.policyCount} ${policyNoun(row.policyCount)} failing`;
  }
  return (STATES[row.state] || STATES.unknown).label;
}

/**
 * Whether THIS row is the 5Rs and some of its rules are scoped out right now — the one
 * fact that has to reach both the visible marker and the aria-label below, computed once
 * so the two can never disagree about when to show it.
 */
function fiveRsScopeNote(row, fiveRsScope) {
  if (!fiveRsScope || !fiveRsScope.frameworkId) return null;
  if (fiveRsScope.frameworkId !== row.frameworkId) return null;
  if (fiveRsScope.selected >= fiveRsScope.total) return null;
  return fiveRsScope;
}

/**
 * The button's one accessible name, standing in for everything drawn inside it (which is
 * all `aria-hidden`) — otherwise the name, the percentage and the bar each get announced
 * on their own and the framework's name is read out twice.
 */
function railAriaLabel(row, meanPct, scopeNote) {
  if (row.state === "scored" && row.posturePct !== null) {
    const sentence = [
      `${row.name}, ${row.posturePct} percent compliant.`,
      `${row.failingPolicyCount} of ${row.policyCount} ${policyNoun(row.policyCount)} failing.`,
    ];
    if (meanPct !== null) sentence.push(`Estate mean ${meanPct} percent.`);
    // THE LOAD-BEARING HONESTY POINT of the whole 5Rs feature: this percentage is Wiz's
    // own, computed against every rule the framework has — Wiz's posture math is opaque
    // and cannot be recomputed here (a 5Rs category can report 194,309/71 checks against
    // an 85% posture; that 85 is not a ratio of any pair of numbers this app holds), so
    // scoping rules in or out of the AI register never touches this number. Say so, or a
    // reader watching the register below shrink while this percentage stays put reads it
    // as the app forgetting to update the bar rather than the bar telling the truth.
    if (scopeNote) {
      sentence.push(
        `This percentage is Wiz's own, computed against all ${scopeNote.total} rules in ` +
        `the framework, including the ${scopeNote.total - scopeNote.selected} scoped out ` +
        "of the AI register below it.");
    }
    return sentence.join(" ");
  }
  const state = STATES[row.state] || STATES.unknown;
  return `${row.name}, not scored: ${state.label.toLowerCase()}. ${reasonBlurb(row)}`;
}

function railRow(row, meanPct, actions, fiveRsScope) {
  const scored = row.state === "scored" && row.posturePct !== null;
  const scopeNote = fiveRsScopeNote(row, fiveRsScope);

  const nameMeta = el("div", { class: "comp-fw-head", "aria-hidden": "true" },
    el("span", { class: "comp-fw-name" }, row.name),
    scopeNote
      ? el("span", { class: "scope-rail-note" },
          el("span", { class: "scope-rail-glyph", "aria-hidden": "true" }, "◒"),
          "Scope active — Wiz % unaffected")
      : null,
    el("span", { class: "comp-fw-meta" }, railMetaText(row)));

  const laneEl = el("div", {
    class: `comp-fw-lane${scored ? "" : " comp-fw-lane--empty"}`,
    "data-state": scored ? null : row.state,
    "aria-hidden": "true",
  });
  if (scored) {
    const bar = el("div", { class: "comp-fw-bar" });
    bar.style.width = `${row.posturePct}%`;
    laneEl.append(bar);
  } else {
    const state = STATES[row.state] || STATES.unknown;
    // Never a bar at zero width for a framework with nothing to score — the state glyph
    // and the reason in words instead, reusing `.comp-key-glyph` so this lane's colour never
    // disagrees with the same state's key at the top of the page.
    laneEl.append(
      el("span", { class: "comp-key-glyph", "aria-hidden": "true" }, state.glyph),
      `${state.label} — ${reasonWords(row)}`);
  }

  // The lane and its mean marker share a positioned wrapper, and that wrapper is the grid
  // item — not the lane itself. Two constraints pull against each other: the lane must clip
  // (its bar has rounded corners), and the marker must NOT be clipped (it stands proud of
  // the lane at both ends). Making the marker a sibling solves the clipping, but it then
  // needs something to measure its `left: N%` against, and that something has to be exactly
  // the lane's width or the mark lands somewhere that is not the percentage it claims.
  // A relatively-positioned wrapper is that box. Anchoring to the grid area instead looks
  // equivalent and is not: it resolved against the whole row here, putting the 94% mark
  // past the end of the axis.
  const laneWrap = el("div", { class: "comp-fw-lane-wrap", "aria-hidden": "true" }, laneEl);
  if (meanPct !== null) {
    const marker = el("span", { class: "comp-fw-mean" });
    marker.style.left = `${meanPct}%`;
    laneWrap.append(marker);
  }

  const kids = [nameMeta, laneWrap];
  kids.push(el("span", {
    class: `comp-fw-pct${scored ? "" : " comp-fw-pct--dash"}`,
    "aria-hidden": "true",
  }, scored ? `${row.posturePct}%` : "—"));

  return el("button", {
    type: "button",
    class: "comp-fw-row",
    "aria-label": railAriaLabel(row, meanPct, scopeNote),
    onclick: () => actions.openFramework(row.frameworkId),
  }, ...kids);
}

/** Spacer/ticks/spacer, matching the row's three grid tracks so the scale lines up over
 *  every lane below it. Purely decorative — the numbers it labels are already spoken in
 *  each row's own aria-label. */
function railAxis() {
  return el("div", { class: "comp-rail-axis", "aria-hidden": "true" },
    el("div", {}),
    el("div", { class: "comp-axis-ticks" },
      ...[0, 25, 50, 75, 100].map((n) =>
        el("span", { class: "comp-axis-tick", "data-pos": String(n) }, String(n)))),
    el("span", {}));
}

function renderRail(host, data, actions) {
  const rows = data.rail || [];
  const kpis = data.kpis || {};
  const meanPct = kpis.averagePosture === undefined ? null : kpis.averagePosture;
  // Absent on a stale SWR payload from before this shipped — fiveRsScopeNote() already
  // treats that the same as "no scope active", so nothing downstream has to branch on it.
  const fiveRsScope = data.fiveRsScope || null;

  // Already worst-first with unscored last, from the server — re-sorting here would
  // second-guess a ranking the read model owns and is tested against.
  const rail = el("div", { class: "comp-rail" },
    railAxis(),
    ...rows.map((row) => railRow(row, meanPct, actions, fiveRsScope)));

  const key = meanPct !== null
    ? el("p", { class: "comp-rail-key" },
        el("span", { class: "comp-rail-key-swatch", "aria-hidden": "true" }),
        `The vertical mark on every lane is the estate mean, ${meanPct}% — where each ` +
        "framework sits against it, read left to right.")
    : el("p", { class: "comp-rail-key" },
        "No estate mean yet — no framework has a compliance posture to average.");

  host.append(el("div", { class: "comp-ov-section" }, sectionLabel("Frameworks"), rail, key));
}

// --------------------------------------------------------------- C. weakest areas

function renderWeakestAreas(host, data, view) {
  const all = data.weakestAreas || [];
  // The only band the estate-wide state strip cross-filters — see the comment on band D
  // for why that filter stops here instead of reaching into the shared-controls table too.
  const rows = view.state ? all.filter((r) => r.state === view.state) : all;

  const table = dataTable({
    className: "comp-table",
    columns: [
      {
        key: "sub", label: "Subcategory",
        cell: (r) => el("div", {},
          el("div", {}, extChip(r), r.title),
          el("div", { class: "small muted" }, r.frameworkName)),
      },
      { key: "posture", label: "Compliance posture", cell: (r) => postureCell(r) },
      { key: "checks", label: "Checks passing", className: "num", cell: (r) => checksCell(r) },
      {
        key: "failing", label: "Failing policies", className: "num",
        cell: (r) => String(r.failingPolicyCount),
      },
    ],
    rows,
    rowLabel: (r) => `${r.title}, ${r.frameworkName}, ` +
      (r.posturePct !== null
        ? `${r.posturePct} percent compliant`
        : (STATES[r.state] || STATES.unknown).label),
    // Opens the same sheet the register opens — findSubcategory() walks the flat row back
    // to the tree/category/sub triple the sheet wants, rather than teaching the sheet a
    // second, flatter shape.
    onRowOpen: (r) => {
      const found = findSubcategory(data.trees, r.frameworkId, r.categoryExternalId, r.externalId);
      if (found) openSubcategorySheet(found.tree, found.category, found.sub);
    },
    emptyText: view.state
      ? `No weak area is ${(STATES[view.state] || {}).label || "shown"}.`
      : "Nothing here is close to failing.",
  });

  host.append(el("div", { class: "comp-ov-section" }, sectionLabel("Weakest areas"), table));
}

// -------------------------------------------------------------- D. shared controls

/**
 * The membership strip: one dot per framework, in the rail's own order, on every row —
 * stable down the column so a reader can scan the "on" dot's POSITION rather than reread
 * a label each time. It is a picture, not a control (nothing here opens anything), so it
 * keeps `role="img"` on itself; the visible "N of M" count sits in a sibling OUTSIDE the
 * labelled picture, or the count would be swallowed into the aria-label and a sighted
 * screen-reader user would see one figure while hearing another.
 */
function raisedByCell(row, order) {
  const on = new Set(row.frameworkIds || []);
  const onNames = order.filter((f) => on.has(f.frameworkId)).map((f) => f.name);
  const offNames = order.filter((f) => !on.has(f.frameworkId)).map((f) => f.name);
  const dots = order.map((f) => el("span", {
    class: `comp-dot ${on.has(f.frameworkId) ? "comp-dot--on" : "comp-dot--off"}`,
  }));
  const label = onNames.length
    ? `Raised by ${onNames.join(", ")}` +
      (offNames.length ? `. Not raised by ${offNames.join(", ")}.` : ".")
    : `Not raised by any of ${offNames.join(", ")}.`;
  return el("span", { class: "comp-dots" },
    el("span", { class: "comp-dots-pic", role: "img", "aria-label": label }, ...dots),
    el("span", { class: "comp-dots-n" }, `${onNames.length} of ${order.length}`));
}

function renderSharedControls(host, data) {
  const rows = data.sharedControls || [];
  // The rail's order, not a fresh sort — it is the fixed column order the caption below
  // names, and rebuilding it per row would let the two drift.
  const order = data.rail || [];
  const sharedCount = rows.filter((r) => (r.frameworkCount || 0) >= 2).length;

  const lede = el("p", { class: "small muted" },
    `${plural(rows.length, "control")} failing across the frameworks tracked here — ` +
    `${sharedCount} of them raised by more than one.`);

  const table = dataTable({
    className: "comp-table",
    columns: [
      {
        key: "control", label: "Control",
        cell: (r) => el("div", {},
          el("div", {}, r.name),
          el("div", { class: "small muted" },
            [r.shortId, policyKindLabel(r.policyKind)].filter(Boolean).join(" · "))),
      },
      { key: "severity", label: "Severity", cell: (r) => sevBadge(r.severity) },
      { key: "raisedBy", label: "Raised by", cell: (r) => raisedByCell(r, order) },
      { key: "failing", label: "Failing", className: "num", cell: (r) => String(r.failCount) },
      {
        key: "remediation", label: "Remediation",
        cell: (r) => (r.hasAutoRemediation
          ? el("span", { class: "comp-auto" }, "Auto-remediation")
          : el("span", { class: "muted" }, "—")),
      },
    ],
    rows,
    emptyText: "No control is shared across frameworks.",
  });

  host.append(el("div", { class: "comp-ov-section" },
    sectionLabel("Shared controls"),
    lede,
    table,
    // Not cross-filtered by the estate state strip, unlike band C: a control's row does not
    // carry a state of its own, only the subcategories it maps into do, and picking a state
    // that maps to a control only THROUGH a subcategory it may or may not still fail on
    // would be a filter that looks precise and is actually a guess. Left alone rather than
    // faked.
    order.length
      ? el("p", { class: "small muted" }, "Dot order: " + order.map((f) => f.name).join(" · "))
      : null));
}

// --------------------------------------------------------------------- E. coverage

function renderCoverage(host, data) {
  const coverage = data.coverage || {};
  const uncollected = coverage.uncollected || [];
  const selected = data.selected || [];
  const stateCounts = coverage.stateCounts || {};
  // Absent on a stale SWR payload from before this shipped — the cell below degrades to
  // not rendering at all, same as a tenant with no 5Rs framework collected.
  const fiveRsScope = data.fiveRsScope || null;

  // Two different facts hide inside "this framework has no posture stored", and they send
  // an operator to completely different places. A framework nobody selected is a decision
  // not yet made — the fix is in Settings. A framework that IS selected and still has
  // nothing stored is a sync that did not deliver — the fix is the Wiz Scans page's
  // skipped-step report. The register's own empty state has always drawn this distinction
  // (it says which of the two reasons it is); this band said "selected for collection but
  // not synced yet" about every row, which was the wrong sentence for the common case and
  // sent readers hunting a sync failure that had not happened.
  const notDelivered = uncollected.filter((f) => selected.indexOf(f.id) >= 0);
  const notChosen = uncollected.filter((f) => selected.indexOf(f.id) === -1);

  const section = el("div", { class: "comp-ov-section" }, sectionLabel("Coverage"));

  if (notDelivered.length) {
    section.append(el("div", { class: "notice warn" },
      `${plural(notDelivered.length, "framework")} selected for collection but carrying no ` +
      "stored posture: " + notDelivered.map((f) => f.name).join(", ") +
      ". Check the Wiz Scans page for a skipped step."));
  }
  if (notChosen.length) {
    section.append(el("div", { class: "notice warn" },
      `${plural(notChosen.length, "framework")} in this tenant's catalogue ` +
      (notChosen.length === 1 ? "is" : "are") + " not collected: " +
      notChosen.map((f) => f.name).join(", ") + ". Nothing on this page reports on " +
      (notChosen.length === 1 ? "it" : "them") + "."));
  }

  section.append(el("div", { class: "comp-cov" },
    el("div", { class: "comp-cov-cell" },
      el("div", { class: "label" }, "Not collected"),
      uncollected.length
        ? el("ul", { class: "comp-cov-list" },
            ...uncollected.map((f) => el("li", {},
              el("span", { class: "comp-key-glyph", "aria-hidden": "true" }, STATES.unknown.glyph),
              f.name)))
        : el("p", { class: "small muted" }, "Every catalogued framework has been collected.")),
    el("div", { class: "comp-cov-cell" },
      el("div", { class: "label" }, "No policies"),
      el("div", { class: "mini-value num" }, String(stateCounts.noPolicies || 0)),
      el("p", { class: "small muted" },
        "No check is written for these — not a pass and not a failure.")),
    el("div", { class: "comp-cov-cell" },
      el("div", { class: "label" }, "No resources"),
      el("div", { class: "mini-value num" }, String(stateCounts.noResources || 0)),
      el("p", { class: "small muted" },
        "There is nothing in this estate for these checks to evaluate — also not a failure.")),
    // Only when a 5Rs framework is actually collected — this is the same band saying what
    // is not being measured, and "not measured" has no meaning to report against nothing.
    fiveRsScope && fiveRsScope.frameworkId
      ? el("div", { class: "comp-cov-cell" },
          el("div", { class: "label" }, "5Rs AI scope"),
          el("div", { class: "mini-value num" }, `${fiveRsScope.selected} of ${fiveRsScope.total}`),
          el("p", { class: "small muted" },
            `${plural(fiveRsScope.total - fiveRsScope.selected, "rule")} out of scope — the ` +
            "5Rs percentage above still covers all of them."),
          el("a", { href: "#/settings", target: "_self" }, "Open Settings →"))
      : null,
    el("div", { class: "comp-cov-cell" },
      el("div", { class: "label" }, "Collection"),
      el("p", { class: "small muted" }, "Choose which frameworks Wiz scores posture against."),
      // index.html sets <base target="_top">, which would escape the GAS sandbox iframe;
      // _self keeps hash routing in-frame, as every other in-app link does.
      el("a", { href: "#/settings", target: "_self" }, "Open Settings →"))));

  host.append(section);
}
