// The "All frameworks" sub-view of Compliance Posture: four bands answering, in order,
// "where do we stand", "which framework is worst", "which subcategory is worst", and
// "which control costs us across more than one framework". Every number on this page is
// assembled HERE, client-side, from rollups the server computed once — this file draws
// them and asks nothing else of the network.
//
// THERE WAS A FIFTH BAND, "Coverage", and what killed it is worth keeping: it enumerated
// the frameworks in the tenant's catalogue that the sync does not collect. On the sample
// estate that was one name. On a real tenant it was thirty-seven, printed inline in a
// warning banner AND again as a list — the catalogue transcribed, not a finding. The fact
// it existed to state is already in the headline strip as "Frameworks 4 of 41", which is
// the same claim in five characters. The band's one irreplaceable part, the 5Rs scope and
// its link into Settings, moved to the rail footnote below. Any band that reads well
// against seeded data and collapses against a real estate has the same defect; count the
// rows a real tenant would produce before adding another.
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
// postureCell(), checksCell(), stateStrip() and subcategoryDetail() all come from
// complianceShared.js — the same cells and the same detail panel the per-framework register
// uses, not a second implementation of either.

import {
  checksCell, extChip, findSubcategory, postureCell, STATES, stateStrip, subcategoryDetail,
} from "./complianceShared.js";
import {
  dataTable, el, emptyState, meter, plural, sectionLabel, sevBadge, sevRank, statRow,
} from "../ui.js";

/**
 * Worst-first severity order, lower index = worse — the domain's SEVERITY_ORDER
 * (src/domain/config.ts), re-declared here rather than imported: nothing under
 * src/client/js/ imports the domain layer, each page keeps its own small copy (config.js's
 * own sevRank note explains why), and sevRank()'s "lower = worse" contract is exactly this
 * array's own order.
 */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/**
 * plural()'s -s rule mangles "policy" into "policys" — the same irregular case
 * complianceShared.js's subcategoryDetail() already spells out by hand rather than teaching
 * the helper an exception for one word.
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

/**
 * The worst severity across every framework's OWN worst-failing-policy field — a reduce
 * over data already in hand (each row's `worstFailingSeverity`, projected straight off
 * FrameworkTree by frameworkRail() in domain/complianceOverview.ts), not a new rollup and
 * not a re-walk of any policy list. Null when nothing anywhere is failing.
 */
function worstFailingSeverityAcross(rail) {
  let worst = null;
  for (const row of rail) {
    if (!row.worstFailingSeverity) continue;
    if (!worst || sevRank(row.worstFailingSeverity, SEVERITY_ORDER) < sevRank(worst, SEVERITY_ORDER)) {
      worst = row.worstFailingSeverity;
    }
  }
  return worst;
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

  // The headline takes neither `view` nor `actions` any more: its strip was the page's one
  // cross-filter, and with that gone it reads only the payload — like renderSharedControls
  // below, and unlike the two bands that still own an expand/open interaction.
  renderHeadline(host, data);
  renderRail(host, data, actions);
  renderWeakestAreas(host, data, view, actions);
  renderSharedControls(host, data);
}

// -------------------------------------------------------------------- A. headline

function renderHeadline(host, data) {
  const kpis = data.kpis || {};
  const coverage = data.coverage || {};
  const scored = kpis.averagePosture !== null && kpis.averagePosture !== undefined;
  // Estate-wide worst — see worstFailingSeverityAcross(). Only meaningful (and only ever
  // drawn) alongside a scored mean; an unscored estate has no bar to tint either.
  const worstSeverity = scored ? worstFailingSeverityAcross(data.rail || []) : null;

  // ONE OF THREE MARKS ON THIS WHOLE PAGE ALLOWED TO CARRY SEVERITY COLOUR — see the
  // matching comment on the rail bar below for why the register, the weakest-areas table
  // and the subcategory detail rows all stay neutral graphite on purpose.
  const heroMeter = scored
    ? meter(kpis.averagePosture, {
        max: 100,
        label: `Estate compliance posture, ${kpis.averagePosture} percent` +
          (worstSeverity ? `, worst failing severity ${worstSeverity}` : ""),
      })
    : null;
  if (heroMeter && worstSeverity) heroMeter.fill.dataset.sev = worstSeverity;

  // The sub-line is the hero's one prose slot, so the severity mark folds into it rather
  // than opening a new one — a sevBadge beside the sentence that already explains the
  // number, never colour without the word next to it.
  const subKids = [scored
    ? `Derived here — the mean of ${plural(kpis.scoredFrameworks || 0, "scored framework")}. ` +
      "Wiz publishes no cross-framework figure."
    : "Derived here — no framework has a compliance posture to average yet. " +
      "Wiz publishes no cross-framework figure."];
  if (worstSeverity) subKids.push(sevBadge(worstSeverity));

  const hero = el("div", {},
    el("div", { class: "label" }, "Compliance posture"),
    scored
      ? el("div", { class: "comp-hero-value num" }, `${kpis.averagePosture}%`)
      : el("div", { class: "comp-hero-value" }, "—"),
    scored
      ? el("div", { class: "comp-hero-meter" }, heroMeter)
      : null,
    // The one number on this page Wiz did not hand us — it names its own denominator so it
    // is never mistaken for a vendor figure.
    el("div", { class: "comp-hero-sub" }, ...subKids),
  );

  // The shared strip only ever reads `.stateCounts`, so the estate-wide roll-up — which is
  // not a FrameworkTree — can drive the exact same component the register uses per
  // framework. It no longer cross-filters the weakest-areas band below: that band lists
  // scored subcategories only now, so every state but one filtered to nothing. The strip
  // is a summary here, and the estate's only count of what went unscored.
  const strip = stateStrip({ stateCounts: coverage.stateCounts || {} });

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
    // The one sentence stating what is failing carries the worst severity too, rather than
    // a second sentence — a screen reader hears "4 of 6 policies failing, worst severity
    // HIGH" as one fact, which is what it is.
    const failingClause = row.worstFailingSeverity
      ? `${row.failingPolicyCount} of ${row.policyCount} ${policyNoun(row.policyCount)} ` +
        `failing, worst severity ${row.worstFailingSeverity}.`
      : `${row.failingPolicyCount} of ${row.policyCount} ${policyNoun(row.policyCount)} failing.`;
    const sentence = [
      `${row.name}, ${row.posturePct} percent compliant.`,
      failingClause,
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

  // The badge pairs with the bar's colour below, so it only draws when the bar itself is
  // going to be tinted — a row with nothing failing gets neither.
  const barBadge = scored && row.worstFailingSeverity ? sevBadge(row.worstFailingSeverity) : null;

  const nameMeta = el("div", { class: "comp-fw-head", "aria-hidden": "true" },
    el("span", { class: "comp-fw-name" }, row.name),
    scopeNote
      ? el("span", { class: "scope-rail-note" },
          el("span", { class: "scope-rail-glyph", "aria-hidden": "true" }, "◒"),
          "Scope active — Wiz % unaffected")
      : null,
    el("div", { class: "comp-fw-meta-row" },
      el("span", { class: "comp-fw-meta" }, railMetaText(row)),
      barBadge));

  const laneEl = el("div", {
    class: `comp-fw-lane${scored ? "" : " comp-fw-lane--empty"}`,
    "data-state": scored ? null : row.state,
    "aria-hidden": "true",
  });
  if (scored) {
    const bar = el("div", { class: "comp-fw-bar" });
    // ONE OF THREE MARKS ON THIS WHOLE PAGE ALLOWED TO CARRY SEVERITY COLOUR (the other
    // two are both hero meters). DESIGN.md's Rationed Ink Rule sanctions this because the
    // rail is a handful of prominent rows, not a column — the register below, the
    // weakest-areas table and the subcategory detail rows all stay neutral graphite on
    // purpose. Do not extend this tint to those; that is the wall of colour the rule
    // forbids.
    if (row.worstFailingSeverity) bar.dataset.sev = row.worstFailingSeverity;
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

  // The 5Rs scope, as a footnote to the rail rather than a control inside it.
  //
  // A rail row is a <button> with everything inside it aria-hidden behind one label, so a
  // link cannot live there: that nests an interactive element in an interactive element —
  // two tab stops for one visual row, a link announced inside a button — which is the same
  // failure compliance.js refuses for the register's disclosure controls. Here, after the
  // rail and outside every button, it is one tab stop in its own right.
  //
  // Same `selected < total` condition the in-row marker uses (fiveRsScopeNote), so the
  // footnote and the marker appear and disappear together rather than drifting into a state
  // where one claims a scope the other does not.
  const scoped = rows.map((row) => fiveRsScopeNote(row, fiveRsScope)).filter(Boolean)[0];
  const scopeKey = scoped
    ? el("p", { class: "comp-rail-key comp-rail-key--scope" },
        el("b", {}, `${scoped.frameworkName}: `),
        `${scoped.selected} of ${scoped.total} rules in scope. `,
        // Restated here and not only in the row's aria-label, because this is the line a
        // sighted reader lands on when the register below shrinks and the percentage above
        // does not — without it that reads as the bar failing to update.
        `The percentage above is Wiz's own and still covers all ${scoped.total}. `,
        el("a", { href: "#/settings", target: "_self" }, "Choose which rules →"))
    : null;

  host.append(el("div", { class: "comp-ov-section" },
    sectionLabel("Frameworks"), rail, key, scopeKey));
}

// --------------------------------------------------------------- C. weakest areas

function renderWeakestAreas(host, data, view, actions) {
  // Every row here is scored — weakestAreas() drops what it cannot rank, and the trees it
  // walks carry nothing unscored to begin with. The estate-wide strip above used to
  // cross-filter this band by state; with three of the four states now unrepresentable in
  // it, that control is gone rather than left to resolve to an empty table.
  const rows = data.weakestAreas || [];

  // Which rows are expanded, held on `view` — like the register's own `expanded` Set in
  // compliance.js — but deliberately NOT mirrored into the URL. Overview-local view state
  // is ephemeral by this page's design (the mode switch and the chosen framework are the
  // only things worth a deep link), so a URL param for one more band would be the odd one
  // out rather than the missing one. Keyed by the same
  // frameworkId/categoryExternalId/externalId triple findSubcategory() takes, because this
  // band is cross-framework and two frameworks can both carry a subcategory called "2.1".
  const open = view.weakOpen || (view.weakOpen = new Set());
  const rowKey = (r) => `${r.frameworkId}/${r.categoryExternalId}/${r.externalId}`;

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
    // Toggles the row's own detail open in place, where this used to open the sheet.
    // actions.repaint() re-runs compliance.js's paint(), the same round-trip the register's
    // own toggles use.
    onRowOpen: (r) => {
      const key = rowKey(r);
      if (open.has(key)) open.delete(key);
      else open.add(key);
      actions.repaint();
    },
    rowExpanded: (r) => open.has(rowKey(r)),
    // findSubcategory() walks the flat row back to the full subcategory node
    // subcategoryDetail() wants, rather than teaching it a second, flatter shape. A row
    // whose subcategory cannot be found (a stale payload) simply does not expand.
    rowDetail: (r) => {
      if (!open.has(rowKey(r))) return null;
      const found = findSubcategory(data.trees, r.frameworkId, r.categoryExternalId, r.externalId);
      return found ? subcategoryDetail(found.sub) : null;
    },
    emptyText: "Nothing here is close to failing.",
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

