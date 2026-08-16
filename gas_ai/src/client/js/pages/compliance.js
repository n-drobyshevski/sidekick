// Compliance Posture: how the estate scores against each security framework Wiz tracks.
//
// The companion to Cloud Configuration, not a replacement for it. That page answers "which
// controls are failing, on what resource" — a flat register of evaluations. This one
// answers "what do we score against OWASP Agentic / ML / the 5Rs", which is a different
// question at a different grain (framework → category → subcategory → policy), asked by a
// different reader. Keeping them apart is why neither has to compromise.
//
// WHAT THIS PAGE DELIBERATELY DOES NOT DRAW. The Wiz console renders this data as an arc
// gauge and a donut. Both are anti-references here: DESIGN.md's "Don't" list and
// PRODUCT.md both name gauges explicitly ("no walls of red and orange cells, no gauges, no
// blinking risk drama"), and charts.js registers no ArcElement, so a doughnut would throw
// at runtime as well as read as vendor theater. The console's "Top Policies" card is
// dropped too — it is a leaderboard without a question, and the register sorted by failing
// policies answers it in the place you would already be looking.
//
// THE ONE INVARIANT: a posture that does not exist is never drawn as a zero. Wiz sends a
// null percentage with a reason (NO_RESOURCES, NO_POLICIES), and both are the opposite of
// "we checked and everything failed". Every cell here goes through postureCell(), which
// renders a state pill rather than a 0% meter — the Honest-State principle, and the reason
// the strip has four segments instead of two. postureCell(), checksCell(), stateStrip() and
// subcategoryDetail() now live in complianceShared.js, so this file and
// complianceOverview.js call the same code rather than drifting into two.
//
// TWO SUB-VIEWS, ONE FETCH, ONE URL. `view.mode` is "overview" (the cross-framework rollup
// — every framework at once) or "framework" (this file's original register, one framework
// at a time), read from `?view=` and mirrored back into the hash by pushParams() exactly
// as config.js does for its controls/findings toggle. Overview is the default: a bare
// `?view=` is absent on a first visit, not a wrong value, so its fallback is "overview".
// BACK-COMPAT: a URL written before this split carries `?framework=<id>` with no `?view` at
// all — every existing deep-link and the compliance help-tip's "Full definition →` links —
// and those must keep landing on the per-framework register, not the new default. So the
// mode fallback checks for a bare `framework` param before defaulting to "overview".
//
// The register (which framework, which state filter, which rows are expanded) is invisible
// while the overview is showing, so pushParams() drops those three params from the URL in
// overview mode — the same "don't carry state the reader can't see" rule config.js applies
// to its own defaults. The in-memory `view` fields are untouched by the mode switch, so
// flipping back to "By framework" restores exactly where the reader left it.

import { setParams, swrCall } from "../store.js";
import {
  clear, dataTable, el, emptyState, errorState, filterCombobox, meter, plural,
  sectionLabel, segmented, sevBadge, skeletonStack, statRow,
} from "../ui.js";
import {
  checksCell, extChip, postureCell, STATES, STATE_ORDER, stateStrip, subcategoryDetail,
} from "./complianceShared.js";
import { renderOverview } from "./complianceOverview.js";

/** Frameworks past this get a searchable combobox instead of a segmented control. */
const SEGMENTED_MAX = 4;

/**
 * The register's columns.
 *
 * No `onRowOpen` on this table, deliberately. A category row already carries a disclosure
 * button, and making the row itself a `role="button"` too would nest one interactive
 * element inside another — two tab stops for one visual row, and a screen reader announcing
 * a button inside a button. So the affordance lives in the first CELL: a category's toggle
 * reveals its subcategory ROWS; a subcategory's (and a mirrored category's, which has none
 * to reveal) toggles its own detail row open via `rowDetail` instead. One actionable
 * element per row, either way.
 */
const COLUMNS = [
  { key: "name", label: "Category", cell: (r) => r.name },
  { key: "posture", label: "Compliance posture", cell: (r) => r.posture },
  { key: "checks", label: "Checks passing", cell: (r) => r.checks, className: "num" },
  { key: "policies", label: "Policies", cell: (r) => r.policies, className: "num" },
];

export async function renderCompliance(main, params, ctx) {
  const requestedMode = params.view === "framework" ? "framework"
    : params.view === "overview" ? "overview" : "";
  const view = {
    // See the back-compat paragraph in the header comment above.
    mode: requestedMode || (params.framework ? "framework" : "overview"),
    frameworkId: params.framework || "",
    state: STATE_ORDER.indexOf(params.state) >= 0 ? params.state : "",
    expanded: new Set(String(params.open || "").split(",").filter(Boolean)),
  };

  main.append(
    el("h1", {}, "Compliance Posture"),
    el("p", { class: "page-sub" },
      "How this estate scores against the security frameworks Wiz tracks — by category, " +
      "subcategory and the policies behind them."),
  );

  const host = el("div", {});
  main.append(host);
  host.append(skeletonStack(4, { height: "58px" }));

  function pushParams(patch) {
    const inOverview = view.mode === "overview";
    setParams(Object.assign({
      view: inOverview ? null : view.mode,
      framework: inOverview ? null : (view.frameworkId || null),
      state: inOverview ? null : (view.state || null),
      open: inOverview ? null : (view.expanded.size ? [...view.expanded].join(",") : null),
    }, patch || {}));
  }

  // The small callback surface the overview reaches back through — it never touches `view`
  // or setParams itself, so it stays a pure function of the payload it is handed.
  const actions = {
    /** The rail (and anything else in the overview that names a framework) hands off here. */
    openFramework(frameworkId) {
      view.mode = "framework";
      view.frameworkId = frameworkId;
      // A different framework is a different register; carrying the open rows over would
      // expand categories that belong to something else. `state` is left alone, the same
      // way the framework switcher below leaves it alone on its own onChange. Subcategory
      // keys (prefixed "s:", see below) live in this same Set, so this one reset clears
      // both levels — there is nothing framework-specific left to separately forget.
      view.expanded = new Set();
      pushParams();
      paint();
    },
    /** Press the active key again to clear it — the same toggle the register's own strip uses. */
    setState(key) {
      view.state = view.state === key ? "" : key;
      pushParams();
      paint();
    },
    repaint() {
      paint();
    },
  };

  // The fetch sits BELOW `actions`, not above it, and the ordering is load-bearing rather
  // than stylistic. `paint()` is a hoisted function declaration, so it can be referenced
  // from anywhere in this scope — but it closes over `actions`, which is a `const`, and a
  // const is in its temporal dead zone until its own line runs. Calling paint() before
  // that line threw "Cannot access 'actions' before initialization" on every load, caught
  // by app.js's route guard and rendered as the generic "This page failed to load." card.
  // Nothing static could have caught it: the reference is legal, only the timing was not.
  let data;
  try {
    data = await swrCall("api_getCompliance", {}, (fresh) => {
      data = fresh;
      paint();
    });
  } catch (e) {
    clear(host).append(errorState("Couldn't load compliance posture.", {
      detail: e && e.message ? e.message : e,
      onRetry: () => ctx.refresh(),
    }));
    return;
  }

  paint();

  function paint() {
    clear(host);
    const trees = (data && data.trees) || [];

    if (!trees.length) {
      host.append(emptyState(
        "No compliance posture has been synced yet.",
        // Says which of the two reasons it is, because "we never asked" and "we asked and
        // the tenant said nothing" send an operator to completely different places.
        (data && data.selected && data.selected.length)
          ? "The sync is configured to collect " + plural(data.selected.length, "framework") +
            ", but no posture has been stored yet. Run a sync, then check the Wiz Scans " +
            "page for a skipped step if this stays empty."
          : "No frameworks are selected for posture collection. Choose them in Settings.",
      ));
      return;
    }

    // ---- view switch: All frameworks (the overview) vs By framework (the register) ----
    const toolbar = el("div", { class: "toolbar" },
      segmented({
        options: [
          { value: "overview", label: "All frameworks" },
          { value: "framework", label: "By framework" },
        ],
        value: view.mode,
        ariaLabel: "Compliance view",
        onChange: (v) => {
          view.mode = v;
          pushParams();
          paint();
        },
      }));
    host.append(toolbar);

    if (view.mode === "overview") {
      renderOverview(host, data, view, actions);
      return;
    }

    // The requested framework, the first one, or whatever the hash asked for if it exists.
    const tree = trees.find((t) => t.frameworkId === view.frameworkId) || trees[0];
    view.frameworkId = tree.frameworkId;

    // ---- framework switcher, beside the mode switch in the same toolbar ----
    if (trees.length > 1) {
      const options = trees.map((t) => ({
        value: t.frameworkId,
        label: t.name,
        title: t.posturePct === null ? "Not scored" : `${t.posturePct}% compliant`,
      }));
      toolbar.append(trees.length <= SEGMENTED_MAX
        ? segmented({
          options,
          value: tree.frameworkId,
          ariaLabel: "Framework",
          onChange: (v) => {
            view.frameworkId = v;
            // A different framework is a different register; carrying the open rows over
            // would expand categories that belong to something else.
            view.expanded = new Set();
            pushParams();
            paint();
          },
        })
        : filterCombobox({
          ariaLabel: "Framework",
          defaultLabel: "Choose a framework",
          options: options.map((o) => ({ value: o.value, label: o.label })),
          value: tree.frameworkId,
          onChange: (v) => {
            view.frameworkId = v;
            view.expanded = new Set();
            pushParams();
            paint();
          },
        }));
    }

    // ---- header ----
    const scored = tree.state === "scored" && tree.posturePct !== null;
    // The 5Rs is the one framework this app scopes down to its AI-relevant rules (Settings
    // → "5Rs — Wiz for Data Security"). When some of its rules are pinned or derived out,
    // the register below this hero only lists what is in scope — but the score IN the hero
    // is still Wiz's, computed against every rule the framework has. The existing sub-line
    // already carries the first half of that ("carried through unchanged"); this only adds
    // the half that says what changed underneath it, so a reader watching the register
    // shrink does not read that as the hero quietly moving too.
    const fiveRs = data.fiveRsScope;
    const scopedHere = scored && fiveRs && fiveRs.frameworkId === tree.frameworkId &&
      fiveRs.selected < fiveRs.total;

    // ONE OF THREE MARKS ON THIS WHOLE PAGE ALLOWED TO CARRY SEVERITY COLOUR — see the
    // matching comment on `.comp-fw-bar` in compliance.css. Null when nothing under this
    // framework is failing, and the meter stays plain graphite.
    const worstSeverity = scored ? tree.worstFailingSeverity : null;
    const heroMeter = scored
      ? meter(tree.posturePct, {
        max: 100,
        label: `${tree.name}, ${tree.posturePct} percent compliant` +
          (worstSeverity ? `, worst failing severity ${worstSeverity}` : ""),
      })
      : null;
    if (heroMeter && worstSeverity) heroMeter.fill.dataset.sev = worstSeverity;

    // The severity mark folds into the sub-line's existing sentence rather than a new slot.
    const heroSubKids = [scored
      ? `${tree.name} · Wiz's own score, carried through unchanged` +
        (scopedHere
          ? ` — the register below is scoped to ${fiveRs.selected} of ${fiveRs.total} ` +
            "AI-relevant rules; this percentage is not."
          : "")
      : `${tree.name} · ${(STATES[tree.state] || STATES.unknown).label}`];
    if (worstSeverity) heroSubKids.push(sevBadge(worstSeverity));

    const hero = el("div", {},
      el("div", { class: "label" }, "Compliance posture"),
      scored
        ? el("div", { class: "comp-hero-value num" }, `${tree.posturePct}%`)
        : el("div", { class: "comp-hero-value" }, "—"),
      scored
        ? el("div", { class: "comp-hero-meter" }, heroMeter)
        : null,
      el("div", { class: "comp-hero-sub" }, ...heroSubKids),
    );

    host.append(el("div", { class: "comp-header" },
      hero,
      stateStrip(tree, view.state, (key) => actions.setState(key)),
      el("div", { class: "stat-list" },
        statRow("Categories", String(tree.categories.length), "in this framework"),
        statRow(
          "Subcategories scored",
          `${tree.stateCounts.scored}`,
          `of ${STATE_ORDER.reduce((s, k) => s + (tree.stateCounts[k] || 0), 0)}`,
        ),
        statRow(
          "Policies",
          String(tree.policyCount),
          `${tree.failingPolicyCount} with a failing check`,
        ),
      )));

    // ---- register ----
    // Categories, each expanding to its subcategories. One table, not two: the child rows
    // share the parent's columns, so there is one set of widths, one sort model and one
    // keyboard path to learn.
    const rows = [];
    for (const cat of tree.categories) {
      const subs = view.state
        ? cat.subcategories.filter((s) => s.state === view.state)
        : cat.subcategories;
      // Under a state filter a category with no matching child is not shown at all —
      // an expandable row that expands to nothing is a dead end.
      if (view.state && !subs.length) continue;

      // A category whose only subcategory restates it (OWASP's Top 10 lists arrive that
      // way) is drawn as ONE row that expands its own detail directly, rather than a
      // disclosure that reveals the row you just read. The predicate lives in the read
      // model, where it is tested — see compliancePosture.CategoryNode.mirrorsCategory.
      if (cat.mirrorsCategory) {
        const only = cat.subcategories[0];
        // The bare category key, reused rather than minting a subcategory key: a mirrored
        // category has no subcategory children of its own, so "expand this category" is
        // already an unambiguous "reveal its one subcategory's detail".
        const key = cat.externalId;
        const open = view.expanded.has(key);
        rows.push({
          _key: `cat-${cat.externalId}`,
          _class: "",
          _detail: open ? subcategoryDetail(only) : null,
          name: el("button", {
            type: "button",
            class: "comp-row-toggle",
            "aria-expanded": open ? "true" : "false",
            onclick: () => {
              if (open) view.expanded.delete(key);
              else view.expanded.add(key);
              pushParams();
              paint();
            },
          },
            el("span", { class: "comp-row-chevron", "aria-hidden": "true" }, "›"),
            el("span", {}, extChip(cat), cat.title)),
          posture: postureCell(cat),
          checks: checksCell(cat),
          policies: el("span", { class: "num" }, String(only.policies.length)),
        });
        continue;
      }

      const open = view.expanded.has(cat.externalId);
      rows.push({
        _key: `cat-${cat.externalId}`,
        _class: "",
        name: el("button", {
          type: "button",
          class: "comp-row-toggle",
          "aria-expanded": open ? "true" : "false",
          onclick: () => {
            if (open) view.expanded.delete(cat.externalId);
            else view.expanded.add(cat.externalId);
            pushParams();
            paint();
          },
        },
          el("span", { class: "comp-row-chevron", "aria-hidden": "true" }, "›"),
          el("span", {},
            extChip(cat),
            cat.title)),
        posture: postureCell(cat),
        checks: checksCell(cat),
        policies: el("span", { class: "num" },
          String(subs.reduce((n, s) => n + s.policies.length, 0))),
      });

      if (!open) continue;
      for (const sub of subs) {
        // Prefixed "s:" so a subcategory key can share `view.expanded` — and its `?open=`
        // URL param — with the bare category externalIds above without ever colliding with
        // one. That back-compat requirement is the whole reason for the prefix: a
        // `?open=ASI01` link written before subcategories were expandable must keep
        // expanding exactly the category it always did, not a same-named subcategory.
        const subKey = `s:${cat.externalId}/${sub.externalId}`;
        const subOpen = view.expanded.has(subKey);
        rows.push({
          _key: `sub-${cat.externalId}-${sub.externalId}`,
          _class: "comp-sub-row",
          _detail: subOpen ? subcategoryDetail(sub) : null,
          name: el("button", {
            type: "button",
            class: "comp-row-toggle comp-sub-title",
            "aria-expanded": subOpen ? "true" : "false",
            onclick: () => {
              if (subOpen) view.expanded.delete(subKey);
              else view.expanded.add(subKey);
              pushParams();
              paint();
            },
          },
            el("span", { class: "comp-row-chevron", "aria-hidden": "true" }, "›"),
            extChip(sub),
            sub.title),
          posture: postureCell(sub),
          checks: checksCell(sub),
          policies: el("span", { class: "num" }, String(sub.policies.length)),
        });
      }
    }

    host.append(sectionLabel("Categories"));
    if (!rows.length) {
      host.append(emptyState(`No subcategory is ${(STATES[view.state] || {}).label || "shown"}.`,
        "Clear the state filter above to see the whole framework."));
      return;
    }

    host.append(dataTable({
      columns: COLUMNS,
      rows,
      className: "comp-table",
      rowClass: (row) => row._class,
      rowDetail: (row) => row._detail || null,
    }));
  }
}
