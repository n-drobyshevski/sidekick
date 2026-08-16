// One rendering of "what does a posture cell look like" and "what does a subcategory's own
// detail look like" — split out of compliance.js so the per-framework register and the
// cross-framework overview (complianceOverview.js) call the SAME code instead of carrying
// two copies of the same four state pills and the same detail panel that drift the next
// time either page is touched.
//
// Nothing here fetches or shapes data; every function is a pure transform of a node the
// server already sent. postureCell() and checksCell() only read {state, posturePct, title,
// passCount, failCount} — a shape the register's CategoryNode/SubcategoryNode and the
// overview's flatter WeakAreaRow both carry — so the same two functions render both without
// caring which view called them. The invariant they exist to enforce travels with them: a
// posture that does not exist is never drawn as a zero. STATES/STATE_ORDER are duplicated
// from domain/compliancePosture.POSTURE_STATES rather than shipped down the wire — labels
// and glyphs belong in the view, the classification itself always comes from the server
// (`node.state`), so the two cannot disagree about which state a row is IN.

import { el, meter, sevBadge } from "../ui.js";

/**
 * The four posture states, mirroring domain/compliancePosture.POSTURE_STATES.
 *
 * Duplicated deliberately rather than shipped down the wire: these are labels and glyphs,
 * the server's copy is the classifier, and a page that cannot name a state without an RPC
 * cannot render an empty state at all. The classification itself always comes from the
 * server — `node.state` — so the two cannot disagree about which state a row is IN.
 */
export const STATES = {
  scored: { glyph: "●", label: "Scored" },
  noResources: { glyph: "○", label: "No resources" },
  noPolicies: { glyph: "◌", label: "No policies" },
  unknown: { glyph: "◐", label: "Not reported" },
};
export const STATE_ORDER = ["scored", "noResources", "noPolicies", "unknown"];

/**
 * The leading external-id chip, or nothing when the title already opens with it.
 *
 * OWASP LLM names its categories "1 LLM01:2025 Prompt Injection" while numbering them "1",
 * so an unconditional chip renders "11 LLM01:2025 …". The predicate lives in the read
 * model, where it is tested — compliancePosture.titleRepeatsExternalId.
 */
export function extChip(node) {
  return node.showExternalId
    ? el("span", { class: "comp-ext" }, node.externalId)
    : null;
}

/**
 * The posture cell. The whole point of the page's honesty lives here.
 *
 * A scored node gets the meter + number. An unscored one gets an em-dash and its reason,
 * with a glyph as well as text, because these four states are exactly the kind of thing
 * PRODUCT.md forbids carrying by colour alone.
 */
export function postureCell(node) {
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
export function checksCell(node) {
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
 * keyboard user at all. `tree` only needs a `.stateCounts` map, so the overview's estate-wide
 * roll-up (which is not a FrameworkTree) can drive this too by handing it `{ stateCounts }`.
 */
export function stateStrip(tree, active, onToggle) {
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

/** A Control is a graph query over the estate, a cloud rule is a Rego evaluation against one
 *  resource type, and a host rule runs on the machine — presenting them as one sort of thing
 *  would misdescribe what failed. */
function policyKindLabel(kind) {
  if (kind === "CONTROL") return "Control";
  if (kind === "HOST_RULE") return "Host rule";
  return "Cloud rule";
}

/**
 * A small local heading over a block of prose or a table — `sectionLabel()`/`sheetSection()`
 * are sheet vocabulary (a right-anchored overlay's own section chrome), and this panel is
 * not one, so it gets its own tiny header rather than borrowing theirs.
 */
function detailBlock(label, ...children) {
  return el("div", { class: "comp-detail-block" },
    el("h4", { class: "comp-detail-heading" }, label),
    ...children);
}

/**
 * Every policy behind a subcategory, as a plain table nested inside the detail row.
 *
 * Hand-built rather than `dataTable()`: that component brings sticky `th`, a sort model and
 * `.table-wrap`'s own border into a table cell, none of which a small panel nested inside
 * another table's row wants. A plain `<table>` with one header row is the honest shape here.
 */
function policyTable(policies) {
  return el("div", { class: "comp-policy-wrap" },
    el("table", { class: "comp-policy-table" },
      el("thead", {},
        el("tr", {},
          el("th", { scope: "col" }, "Severity"),
          el("th", { scope: "col" }, "Control"),
          el("th", { scope: "col", class: "num" }, "Checks"))),
      el("tbody", {},
        ...policies.map((p) => el("tr", {},
          el("td", {}, sevBadge(p.severity)),
          el("td", {},
            el("div", {}, p.name),
            el("div", { class: "small muted" },
              [p.shortId, policyKindLabel(p.policyKind), p.cloudProvider]
                .filter(Boolean).join(" · "))),
          // Grouped, like the summary line above it and the register's Checks column.
          // Ungrouped here they read as a different quantity from the same numbers three
          // lines up — "1718" beside "194,309" looks like two ways of counting, not two
          // scopes of one count.
          el("td", { class: "num" }, p.noResourceToAssess
            ? "Nothing in this estate to evaluate — neither passing nor failing."
            : `${p.passCount.toLocaleString()} passed · ${p.failCount.toLocaleString()} failed` +
              ` · ${p.assessedCount.toLocaleString()} assessed`))))));
}

/**
 * The subcategory's own detail, as a node for an inline detail row.
 *
 * Takes only `sub` — the sheet this replaces needed `tree`/`category` too, for its title and
 * subtitle, but an inline row does not: the row it hangs under already says which
 * subcategory it is, so repeating the framework and category inside it would be chrome the
 * sheet needed only because it floated free of the table. The posture cell the sheet also
 * opened with is dropped for the same reason — the row's own Posture column already drew it.
 */
export function subcategoryDetail(sub) {
  const kids = [
    el("div", { class: "comp-policy-counts" },
      // Grouped, for the reason checksCell() states one function up: these run to six
      // figures on a real estate, and 120044 is not a number anyone reads. The sheet
      // printed them ungrouped; on the page, beside a Checks column that IS grouped, the
      // mismatch would read as two different quantities.
      el("span", {}, el("b", {}, sub.passCount.toLocaleString()), " passing checks"),
      el("span", {}, el("b", {}, sub.failCount.toLocaleString()), " failing checks"),
      // "1 policy mapped", not "1 policies mapped". plural()'s -s rule would give
      // "policys", which is why the heading below spells the irregular out by hand too —
      // this line was reading wrong in the sheet as well, where fewer people saw it.
      el("span", {}, el("b", {}, String(sub.policies.length)),
        sub.policies.length === 1 ? " policy mapped" : " policies mapped")),
  ];

  if (sub.emptyPostureReason) {
    kids.push(el("p", { class: "comp-strip-note" },
      sub.emptyPostureReason === "NO_POLICIES"
        ? "Wiz has no check written for this subcategory, so nothing was evaluated. " +
          "This is a gap in the framework's coverage, not in this estate."
        : "There is nothing in this estate for these checks to evaluate."));
  }

  if (sub.description) {
    kids.push(detailBlock("What this covers", el("p", {}, sub.description)));
  }
  if (sub.mappingRationale) {
    kids.push(detailBlock("Why these policies map here", el("p", {}, sub.mappingRationale)));
  }
  if (sub.assessmentScope) {
    kids.push(detailBlock("Assessment scope", el("p", {}, sub.assessmentScope)));
  }

  if (sub.policies.length) {
    kids.push(detailBlock(
      // Not plural(): its -s rule would render "1 policys". The one irregular label on
      // this page is spelled out rather than teaching the helper an exception.
      `${sub.policies.length} ${sub.policies.length === 1 ? "policy" : "policies"}`,
      policyTable(sub.policies)));
  }

  return el("div", { class: "comp-detail" }, ...kids);
}

/**
 * The full nodes behind a flattened weak-area row. The overview's WeakAreaRow is a
 * server-side flattening of the same tree the register walks — this walks back the other
 * way so subcategoryDetail() (which wants the full subcategory node — its description,
 * its policies — not the flat row's summary fields) never has to be taught a second shape.
 * Three nested `.find()`s over data already in hand; nothing here is a fetch.
 */
export function findSubcategory(trees, frameworkId, categoryExternalId, externalId) {
  const tree = (trees || []).find((t) => t.frameworkId === frameworkId);
  if (!tree) return null;
  const category = (tree.categories || []).find((c) => c.externalId === categoryExternalId);
  if (!category) return null;
  const sub = (category.subcategories || []).find((s) => s.externalId === externalId);
  if (!sub) return null;
  return { tree, category, sub };
}
