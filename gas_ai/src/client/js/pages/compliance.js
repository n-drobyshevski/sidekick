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
// the strip has four segments instead of two.

import { setParams, swrCall } from "../store.js";
import {
  clear, dataTable, el, emptyState, errorState, filterCombobox, meter, plural,
  openSheet, sectionLabel, segmented, sevBadge, sheetRow, sheetSection, skeletonStack,
  statRow,
} from "../ui.js";

/**
 * The four posture states, mirroring domain/compliancePosture.POSTURE_STATES.
 *
 * Duplicated deliberately rather than shipped down the wire: these are labels and glyphs,
 * the server's copy is the classifier, and a page that cannot name a state without an RPC
 * cannot render an empty state at all. The classification itself always comes from the
 * server — `node.state` — so the two cannot disagree about which state a row is IN.
 */
const STATES = {
  scored: { glyph: "●", label: "Scored" },
  noResources: { glyph: "○", label: "No resources" },
  noPolicies: { glyph: "◌", label: "No policies" },
  unknown: { glyph: "◐", label: "Not reported" },
};
const STATE_ORDER = ["scored", "noResources", "noPolicies", "unknown"];

/** Frameworks past this get a searchable combobox instead of a segmented control. */
const SEGMENTED_MAX = 4;

/**
 * The register's columns.
 *
 * No `onRowOpen` on this table, deliberately. A category row already carries a disclosure
 * button, and making the row itself a `role="button"` too would nest one interactive
 * element inside another — two tab stops for one visual row, and a screen reader announcing
 * a button inside a button. So the affordance lives in the first CELL: the category's is a
 * toggle, the subcategory's opens its sheet. One actionable element per row, either way.
 */
const COLUMNS = [
  { key: "name", label: "Category", cell: (r) => r.name },
  { key: "posture", label: "Compliance posture", cell: (r) => r.posture },
  { key: "checks", label: "Checks passing", cell: (r) => r.checks, className: "num" },
  { key: "policies", label: "Policies", cell: (r) => r.policies, className: "num" },
];

/**
 * The posture cell. The whole point of the page's honesty lives here.
 *
 * A scored node gets the meter + number. An unscored one gets an em-dash and its reason,
 * with a glyph as well as text, because these four states are exactly the kind of thing
 * PRODUCT.md forbids carrying by colour alone.
 */
function postureCell(node) {
  if (node.state === "scored" && node.posturePct !== null) {
    return el("div", { class: "comp-posture" },
      meter(node.posturePct, {
        max: 100,
        label: `${node.title}, ${node.posturePct} percent compliant`,
      }),
      el("span", { class: "comp-posture-num" }, `${node.posturePct}%`));
  }
  const state = STATES[node.state] || STATES.unknown;
  return el("div", { class: "comp-posture" },
    el("span", { class: "comp-posture-dash", "aria-hidden": "true" }, "—"),
    el("span", { class: "comp-posture-empty", "data-state": node.state },
      el("span", { class: "comp-key-glyph", "aria-hidden": "true" }, state.glyph),
      state.label));
}

/**
 * Passing checks over assessed checks — or the absence of any evaluation at all.
 *
 * Grouped, because these run to six figures on a real estate (194309 is not a number
 * anyone reads; 194,309 is) and the column's job is to be scanned, not decoded.
 */
function checksCell(node) {
  const total = node.passCount + node.failCount;
  if (!total) return el("span", { class: "comp-posture-dash" }, "—");
  return el("span", { class: "num" },
    `${node.passCount.toLocaleString()} / ${total.toLocaleString()}`);
}

/**
 * The subcategory-state strip: the header's distribution AND the register's filter.
 *
 * A row of real buttons rather than a chart. The states are four, they are categorical,
 * and the reader's next action is "show me only those" — which a canvas cannot offer a
 * keyboard user at all.
 */
function stateStrip(tree, active, onToggle) {
  const total = STATE_ORDER.reduce((sum, k) => sum + (tree.stateCounts[k] || 0), 0);
  const bar = el("div", {
    class: "comp-bar",
    role: "img",
    "aria-label": total
      ? STATE_ORDER
        .filter((k) => tree.stateCounts[k])
        .map((k) => `${tree.stateCounts[k]} ${STATES[k].label}`)
        .join(", ")
      : "No subcategories",
  });
  if (!total) {
    bar.append(el("span", { class: "comp-bar-seg", "data-state": "empty" }));
  } else {
    for (const key of STATE_ORDER) {
      const n = tree.stateCounts[key] || 0;
      if (!n) continue;
      const seg = el("span", { class: "comp-bar-seg", "data-state": key });
      seg.style.width = `${(n / total) * 100}%`;
      bar.append(seg);
    }
  }

  const keys = el("div", { class: "comp-keys" });
  for (const key of STATE_ORDER) {
    const n = tree.stateCounts[key] || 0;
    const btn = el("button", {
      type: "button",
      class: "comp-key",
      "data-state": key,
      "aria-pressed": active === key ? "true" : "false",
      // Zero-count states stay focusable and readable rather than disappearing: "no
      // subcategory is unscored" is information, and a vanishing key hides it.
      disabled: n === 0 ? "" : null,
      onclick: () => onToggle(key),
    },
      el("span", { class: "comp-key-glyph", "aria-hidden": "true" }, STATES[key].glyph),
      STATES[key].label,
      el("span", { class: "comp-key-num" }, String(n)));
    keys.append(btn);
  }

  return el("div", { class: "comp-strip" },
    bar,
    keys,
    el("p", { class: "comp-strip-note" },
      "Subcategories by state. A subcategory with no resources or no policies is not a " +
      "failure and not a pass — it is not scored, and it is left out of the framework " +
      "percentage rather than counted as zero."));
}

/** The detail sheet for one subcategory: what it means, and every policy behind it. */
function openSubcategorySheet(tree, category, sub) {
  openSheet((body) => {
    body.append(sheetSection("Posture",
      el("div", { class: "comp-posture" }, postureCell(sub)),
      el("div", { class: "comp-policy-counts" },
        el("span", {}, el("b", {}, String(sub.passCount)), " passing checks"),
        el("span", {}, el("b", {}, String(sub.failCount)), " failing checks"),
        el("span", {}, el("b", {}, String(sub.policies.length)), " policies mapped")),
      sub.emptyPostureReason
        ? el("p", { class: "comp-strip-note" },
          sub.emptyPostureReason === "NO_POLICIES"
            ? "Wiz has no check written for this subcategory, so nothing was evaluated. " +
              "This is a gap in the framework's coverage, not in this estate."
            : "There is nothing in this estate for these checks to evaluate.")
        : null));

    if (sub.description) {
      body.append(sheetSection("What this covers", el("p", {}, sub.description)));
    }
    if (sub.mappingRationale) {
      body.append(sheetSection("Why these policies map here", el("p", {}, sub.mappingRationale)));
    }
    if (sub.assessmentScope) {
      body.append(sheetSection("Assessment scope", el("p", {}, sub.assessmentScope)));
    }

    if (sub.policies.length) {
      body.append(sheetSection(
        // Not plural(): its -s rule would render "1 policys". The one irregular label on
        // this page is spelled out rather than teaching the helper an exception.
        `${sub.policies.length} ${sub.policies.length === 1 ? "policy" : "policies"}`,
        ...sub.policies.map((p) => sheetRow({
          badge: sevBadge(p.severity),
          meta: [
            // The kind matters and is not decoration: a Control is a graph query over the
            // estate, a cloud rule is a Rego evaluation against one resource type, and a
            // host rule runs on the machine. Presenting them as one sort of thing would
            // misdescribe what failed.
            el("span", { class: "comp-ext" },
              p.policyKind === "CONTROL" ? "Control"
                : p.policyKind === "HOST_RULE" ? "Host rule" : "Cloud rule"),
            p.shortId ? el("span", { class: "comp-ext" }, p.shortId) : null,
            p.cloudProvider ? el("span", { class: "comp-ext" }, p.cloudProvider) : null,
          ],
          title: p.name,
          note: p.noResourceToAssess
            ? "Nothing in this estate to evaluate — neither passing nor failing."
            : `${p.passCount} passed · ${p.failCount} failed · ${p.assessedCount} assessed`,
        })),
      ));
    }
  }, {
    title: sub.title,
    subtitle: `${tree.name} · ${category.title}`,
    ariaLabel: `${sub.title} compliance detail`,
  });
}

export async function renderCompliance(main, params, ctx) {
  const view = {
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

  function pushParams(patch) {
    setParams(Object.assign({
      framework: view.frameworkId || null,
      state: view.state || null,
      open: view.expanded.size ? [...view.expanded].join(",") : null,
    }, patch || {}));
  }

  function paint() {
    clear(host);
    const trees = (data && data.trees) || [];

    if (!trees.length) {
      host.append(emptyState(
        "No compliance posture has been synced yet.",
        // Says which of the two reasons it is, because "we never asked" and "we asked and
        // the tenant said nothing" send an operator to completely different places.
        {
          detail: (data && data.selected && data.selected.length)
            ? "The sync is configured to collect " +
              plural(data.selected.length, "framework") +
              ", but no posture has been stored yet. Run a sync, then check the Wiz Scans " +
              "page for a skipped step if this stays empty."
            : "No frameworks are selected for posture collection. Choose them in Settings.",
        },
      ));
      return;
    }

    // The requested framework, the first one, or whatever the hash asked for if it exists.
    const tree = trees.find((t) => t.frameworkId === view.frameworkId) || trees[0];
    view.frameworkId = tree.frameworkId;

    // ---- framework switcher ----
    if (trees.length > 1) {
      const options = trees.map((t) => ({
        value: t.frameworkId,
        label: t.name,
        title: t.posturePct === null ? "Not scored" : `${t.posturePct}% compliant`,
      }));
      host.append(el("div", { class: "toolbar" }, trees.length <= SEGMENTED_MAX
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
        })));
    }

    // ---- header ----
    const scored = tree.state === "scored" && tree.posturePct !== null;
    const hero = el("div", {},
      el("div", { class: "label" }, "Compliance posture"),
      scored
        ? el("div", { class: "comp-hero-value num" }, `${tree.posturePct}%`)
        : el("div", { class: "comp-hero-value" }, "—"),
      scored
        ? el("div", { class: "comp-hero-meter" }, meter(tree.posturePct, {
          max: 100,
          label: `${tree.name}, ${tree.posturePct} percent compliant`,
        }))
        : null,
      el("div", { class: "comp-hero-sub" }, scored
        ? `${tree.name} · Wiz's own score, carried through unchanged`
        : `${tree.name} · ${(STATES[tree.state] || STATES.unknown).label}`),
    );

    host.append(el("div", { class: "comp-header" },
      hero,
      stateStrip(tree, view.state, (key) => {
        view.state = view.state === key ? "" : key;
        pushParams();
        paint();
      }),
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
      // way) is drawn as ONE row that opens the detail directly, rather than a disclosure
      // that reveals the row you just read. The predicate lives in the read model, where
      // it is tested — see compliancePosture.CategoryNode.mirrorsCategory.
      if (cat.mirrorsCategory) {
        const only = cat.subcategories[0];
        rows.push({
          _key: `cat-${cat.externalId}`,
          _class: "",
          name: el("button", {
            type: "button",
            class: "comp-row-toggle",
            onclick: () => openSubcategorySheet(tree, cat, only),
          },
            el("span", { class: "comp-ext" }, cat.externalId),
            cat.title),
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
            el("span", { class: "comp-ext" }, cat.externalId),
            cat.title)),
        posture: postureCell(cat),
        checks: checksCell(cat),
        policies: el("span", { class: "num" },
          String(subs.reduce((n, s) => n + s.policies.length, 0))),
      });

      if (!open) continue;
      for (const sub of subs) {
        rows.push({
          _key: `sub-${cat.externalId}-${sub.externalId}`,
          _class: "comp-sub-row",
          name: el("button", {
            type: "button",
            class: "comp-row-toggle comp-sub-title",
            onclick: () => openSubcategorySheet(tree, cat, sub),
          },
            el("span", { class: "comp-ext" }, sub.externalId),
            sub.title),
          posture: postureCell(sub),
          checks: checksCell(sub),
          policies: el("span", { class: "num" }, String(sub.policies.length)),
        });
      }
    }

    host.append(sectionLabel("Categories"));
    if (!rows.length) {
      host.append(emptyState(`No subcategory is ${(STATES[view.state] || {}).label || "shown"}.`, {
        detail: "Clear the state filter above to see the whole framework.",
      }));
      return;
    }

    host.append(dataTable({
      columns: COLUMNS,
      rows,
      className: "comp-table",
      rowClass: (row) => row._class,
    }));
  }
}
