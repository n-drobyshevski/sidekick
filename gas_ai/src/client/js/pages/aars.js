// AARS Rules: the AI Asset Risk Score model, drawn and editable, with its consequence
// pinned beside it.
//
// Two rules govern this file.
//
// 1. The score is never computed here. The prose summary, the impact of a draft and the
//    sandbox result all come from the server, which runs the same computeAars the sync
//    runs. A second implementation in client JS would be a second answer to "what is this
//    asset's score", and the page exists to make that question have exactly one.
//
// 2. Controls are built ONCE and thereafter mutated, never rebuilt. Every repaint that
//    recreates an input the user is typing in drops the keystroke and sends focus to
//    <body>; the previous version of this page did that on four separate controls. sync()
//    below writes values and text in place, and the only rebuilds left are structural
//    (adding, removing or reordering a cascade row, adding or dropping a sandbox gap
//    chip), which restore focus explicitly.
//
// 3. A gap code is an opaque key that the codebook ANNOTATES. Nothing the codebook says
//    reaches the score: the cascade still matches on the literal string, so a title this
//    page gets wrong is a wrong caption, never a wrong number. That is what lets the page
//    carry four moving vocabularies without the model inheriting their instability.

import { call } from "../api.js";
import {
  aarsChip,
  axisBar,
  axisTally,
  claimOffsets,
  diagRow,
  claimRail,
  clear,
  closeActiveSheet,
  confirmDialog,
  debounce,
  downloadText,
  el,
  field,
  emptyState,
  filterCombobox,
  helpTip,
  onPageTeardown,
  openPopover,
  openSheet,
  outcomeBadge,
  outcomeLabel,
  tierLabel,
  paintUnknownRates,
  pointRail,
  railScale,
  latticeSection,
  segmented,
  select,
  sevBadge,
  sheetSection,
  skeleton,
  statusPill,
  rowDrag,
  registerWideNote,
  ruleGrip,
  tierBadge,
  toast,
  tokenList,
  uiIcon,
} from "../ui.js";
import { bootstrapCached } from "../store.js";
import { POSTURE_LATTICE, PROBLEM_LATTICE, toneForKey } from "../lattice.js";
import {
  OUTCOME_VALUES,
  TIER_VALUES,
  cellCoverage as mirrorCellCoverage,
  cellOccupancyByRow as mirrorCellOccupancyByRow,
  leafOccupancyByRow as mirrorLeafOccupancyByRow,
  decidePosture as mirrorDecidePosture,
  decideProblem as mirrorDecideProblem,
  leafCoverage as mirrorLeafCoverage,
} from "../decideMirror.js";
import {
  CODEBOOK,
  gapCodeOptions,
  lookupGap,
  normalizeCode,
  pricedAboveCount,
  resolveGap,
  tenantCodeOptions,
} from "../codebook.js";

const SEVERITY_KEYS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
// Worst first — the order the thresholds descend in.
const BANDS = [
  { key: "critical", label: "CRITICAL" },
  { key: "high", label: "HIGH" },
  { key: "medium", label: "MEDIUM" },
  { key: "low", label: "LOW" },
];
// Left to right on the rail: 0 at the left, 100 at the right.
const RAIL_ORDER = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const EXPOSURES = [
  ["SENSITIVE", "Confirmed sensitive data (PII / PHI / PCI)"],
  ["DATA_ACCESS", "Data access, sensitivity unconfirmed"],
  ["NONE", "No data access"],
];
const EXPOSURE_LABELS = {
  SENSITIVE: "Sensitive data",
  DATA_ACCESS: "Data access",
  NONE: "No data access",
};
const MOVERS_INLINE = 8;
/** Codes offered as one-tap chips in the sandbox, taken from what the landscape actually has. */
const SANDBOX_QUICK_CODES = 6;
const MATCH_OPTIONS = [
  { value: "exact", label: "is exactly" },
  { value: "prefix", label: "starts with" },
];

// A whole-inventory rescore per keystroke would be unkind to the sheet and the operator;
// a sandbox score is one pure call and can keep up.
const PREVIEW_DEBOUNCE_MS = 700;
const SAMPLE_DEBOUNCE_MS = 250;

// Disclosure state outlives a repaint, so an open sandbox is not slammed shut by an edit.
let sandboxOpen = false;

// Whether the impact pane is folded away, as a remembered preference rather than a
// per-visit one — same posture (and same try/catch, since a GAS iframe sandbox can deny web
// storage) as the record sheet's width in ui/sheet.js and the nav rail's collapse in app.js.
// Unlike the rail, the default is OPEN: the impact pane is this page's answer to "what does
// this edit do", so it stays until somebody deliberately puts it away.
const IMPACT_COLLAPSED_KEY = "sidekickai.aarsImpactCollapsed";
function loadImpactCollapsed() {
  try {
    return localStorage.getItem(IMPACT_COLLAPSED_KEY) === "1";
  } catch (e) {
    return false; // storage denied — just don't remember
  }
}
function rememberImpactCollapsed(on) {
  try {
    localStorage.setItem(IMPACT_COLLAPSED_KEY, on ? "1" : "0");
  } catch (e) { /* storage denied — the toggle still works for this session */ }
}

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function cloneRule(rule) {
  return JSON.parse(JSON.stringify(rule));
}

/** Number from an input. An EMPTY field is not zero — it is "no value yet". */
function num(raw, fallback) {
  const s = String(raw).trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
function setAttr(node, name, value) {
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}
/** Write a value into an input — unless the user is in it. Never fight the cursor. */
function setValue(input, value) {
  if (document.activeElement === input) return;
  const s = String(value);
  if (input.value !== s) input.value = s;
}

/**
 * The band-ordering and cascade checks, mirrored client-side so an error lands on the
 * keystroke that caused it. validateAarsRule in src/domain/aarsRule.ts is the authority
 * and re-runs on save; this is an early warning, never the last word.
 */
function draftErrors(rule) {
  const out = { bands: {}, gaps: {}, list: [] };
  for (let i = 1; i < BANDS.length; i++) {
    const upper = BANDS[i - 1];
    const lower = BANDS[i];
    if (rule.bands[upper.key] <= rule.bands[lower.key]) {
      const msg =
        `${upper.label} must sit above ${lower.label} — otherwise no score can land in ` +
        `${lower.label}.`;
      out.bands[upper.key] = msg;
      out.list.push(msg);
    }
  }
  const seen = {};
  rule.gapPoints.forEach((g, i) => {
    if (!g.code) {
      out.gaps[i] = "This rule has no code.";
      out.list.push(`Compliance-gap rule ${i + 1} has no code.`);
      return;
    }
    const key = g.match + ":" + g.code;
    if (seen[key]) {
      out.gaps[i] = `Repeats ${g.match} "${g.code}".`;
      out.list.push(`Compliance-gap rule ${i + 1} repeats ${g.match} "${g.code}".`);
    }
    seen[key] = true;
  });
  if (!rule.gapPoints.length) out.list.push("The compliance-gap cascade has no rules.");
  return out;
}

/** First-match pricing, for the "test a code" box only — plain string matching. */
function priceCode(rule, code) {
  const c = String(code || "").trim().toUpperCase();
  for (let i = 0; i < rule.gapPoints.length; i++) {
    const row = rule.gapPoints[i];
    const hit = row.match === "exact" ? c === row.code : c.indexOf(row.code) === 0;
    if (hit) return { index: i, points: row.points };
  }
  return { index: -1, points: rule.gapFallbackPoints };
}

/**
 * Append, skipping absent children. Native append() stringifies null — it renders the word
 * "null" — so any conditional child has to come through here. el()'s own children are
 * already filtered.
 */
function numberInput(id, { value, min, max, step }) {
  return el("input", {
    type: "number",
    id,
    min: String(min),
    max: String(max),
    step: step || "1",
    value: String(value),
    class: "rule-num",
  });
}

/**
 * A cascade row's first cell: the drag handle, then the number the notes and the validation
 * errors call the row by. The handle is decorative (see ui/rowReorder.js) — the row's ↑ ↓
 * buttons are the reorder control and this is the shortcut.
 */
function idxCell(i) {
  return el(
    "td",
    { class: "num muted small rule-idxcell" },
    el("div", { class: "rule-idx" }, ruleGrip(), el("span", { class: "rule-idx__n" }, String(i + 1))),
  );
}

/**
 * A verdict `<select>` wearing the pill its own value already wears everywhere else —
 * `outcomeBadge`, `tierBadge`, and every lattice cell directly above the table. `toneForKey`
 * is the same map the lattice paints from, so the ladder and the picture cannot disagree
 * about which of the four `.pill` kinds an outcome is.
 *
 * Returns the wrapper with `.paint(value)` on it: rule 2 of this file says a control is
 * built once and thereafter mutated, so the tone is repainted in place rather than by
 * rebuilding the cell around it.
 */
function verdictSelect(sel) {
  const wrap = el("span", { class: "verdict-select" }, sel);
  wrap.paint = (value) => {
    const tone = toneForKey(value);
    setAttr(wrap, "data-tone", (tone && tone.tone) || "neutral");
  };
  wrap.paint(sel.value);
  return wrap;
}

/**
 * The completeness line over a cascade: how many rules, how much of the closed space they
 * claim between them, what falls through, and whether any of them cannot fire.
 *
 * This is DMN's own reading of a decision table — is it complete, and is any rule
 * redundant — and every figure was already in the preview response. It was just reported in
 * the impact pane, on the far side of the screen from the ladder it is about.
 *
 * `total === null` means no preview has landed. It says so in words rather than printing a
 * zero it has not earned, the same contract claimRail's unmeasured lane keeps.
 */
function paintCascadeSummary(node, { rules, total, fallback, dead, unit }) {
  clear(node);
  const k = (n) => el("span", { class: "rule-summary__k" }, String(n));
  const sep = () => el("span", { class: "rule-summary__sep", "aria-hidden": "true" }, "·");
  node.append(el("span", {}, k(rules), ` ${rules === 1 ? "rule" : "rules"}`));
  if (total === null || total === undefined) {
    node.append(sep(), el("span", { class: "muted" }, "coverage not measured yet"));
    return;
  }
  node.append(
    sep(),
    el("span", {}, k(total - fallback), " of ", k(total), ` ${unit} claimed`),
    sep(),
    el("span", {}, "fallback takes ", k(fallback)),
  );
  if (dead > 0) {
    node.append(
      sep(),
      el("span", { class: "rule-summary__warn" },
        `${dead} never ${dead === 1 ? "fires" : "fire"}`),
    );
  }
}

/**
 * The three lethal-trifecta legs a posture `when` can carry. They sit OFF the 27 cells the
 * lattice draws, which is exactly why a row naming them can never fire — and why a row
 * naming them looks, in a table that renders only the three axes, like a row with no
 * conditions at all.
 */
const POSTURE_LEGS = ["privateData", "untrustedIngress", "externalEgress"];

/** One read-only chip per off-lattice leg a row matches on. Empty for every ordinary row. */
function postureLegChips(when) {
  return POSTURE_LEGS
    .filter((k) => when[k] !== undefined)
    .map((k) => el("span", { class: "rule-leg" }, when[k] === false ? `no ${k}` : k));
}

/**
 * A census the preview reported, as combobox rows. Same shape and same sentence as
 * `tenantCodeOptions` gives the gap-code picker on the AARS tab — the count is the point,
 * because "seen on 42 issues" is what tells an operator a value is worth naming, and the
 * group header is what stops the list reading as a closed catalogue it is not.
 */
function censusOptions(entries, noun) {
  return (entries || []).map((e) => ({
    value: e.value,
    label: e.value,
    hint: `seen on ${e.issues} ${e.issues === 1 ? noun : noun + "s"}`,
    group: "Seen in this tenant",
  }));
}

/**
 * One axis of the decision vector, drawn as what it is: an ordered ladder of signals, each
 * one either a reading Wiz supplies or a list the operator maintains.
 *
 * THE SECTION USED TO NOT ANSWER ITS OWN TITLE. "How the four axes are read" showed one of
 * exploitation's three steps (its second lived in a separate section further down), one of
 * impact's three sources, nothing whatsoever for exposure, and — filed among them — the ACT
 * ceiling, which is not an axis reading at all. A reader could not learn from it what any
 * axis is actually derived from, which is the only question it exists to answer.
 *
 * `ordered` is not styling. Exploitation is a FIRST-MATCH ladder, so it is an `<ol>` and
 * position carries meaning; technical impact is an OR of three sources where order is
 * irrelevant, so it is a `<ul>`. That difference is true of the model and was invisible.
 *
 * Not a card: DESIGN.md has these sections divide one surface with hairlines rather than
 * float as separate boxes, and four boxed axes would read as four unrelated settings.
 */
function axisBlock({ name, values, ordered, lede, steps, note }) {
  const id = nextId("axis");
  const rateMark = el("span", { class: "axis-block__mark", "aria-hidden": "true" });
  const rateText = el("span", {});
  const rate = el("span", { class: "axis-block__rate" }, rateMark, rateText);

  // What the axis actually read across the landscape. The prose above says how a value is
  // derived; this says what that derivation produced, which is the half no wording can
  // carry — a knob deciding nothing looks exactly like a knob deciding everything until the
  // distribution is drawn.
  const bar = axisBar({ values, unit: "decided rows" });

  const list = el(ordered ? "ol" : "ul", { class: "axis-steps" });
  for (const step of steps || []) {
    const li = el(
      "li",
      { class: "axis-step" },
      el(
        "div",
        { class: "axis-step__line" },
        el("span", { class: "axis-step__signal" }, step.signal),
        step.yields
          ? el(
            "span", { class: "axis-step__yield" },
            el("span", { class: "visually-hidden" }, "reads "),
            el("span", { "aria-hidden": "true" }, "→ "),
            step.yields,
          )
          : null,
        step.origin ? el("span", { class: "axis-step__origin" }, step.origin) : null,
      ),
      step.control ? el("div", { class: "axis-step__control" }, step.control) : null,
    );
    // Hovering or focusing a step lights the part of the bar that step produced — the same
    // picture-to-row link the lattice and the cascade already have, so the gesture means the
    // same thing in a third place. Focus counts as much as hover, per scans.js's rule.
    if (step.lights) {
      const on = () => bar.light(step.lights);
      const off = () => bar.light(null);
      li.addEventListener("mouseenter", on);
      li.addEventListener("mouseleave", off);
      li.addEventListener("focusin", on);
      li.addEventListener("focusout", off);
    }
    list.append(li);
  }

  const node = el(
    "section",
    { class: "axis-block", "aria-labelledby": id },
    el(
      "div",
      { class: "axis-block__head" },
      el("h3", { class: "axis-block__name", id }, name),
      el("span", { class: "axis-block__values" }, values.join(" · ")),
      rate,
    ),
    lede ? el("p", { class: "axis-block__lede small muted" }, lede) : null,
    bar,
    steps && steps.length ? list : null,
    note || null,
  );

  /**
   * The axis's own unknown rate, beside the knobs that move it. The impact pane keeps the
   * full diagnostic and its warning cards; this is the reading, and it has to be here
   * because the impact pane can be folded away entirely.
   */
  node.paintRate = (share, high) => {
    if (share === null || share === undefined) {
      setText(rateMark, "");
      setText(rateText, "unknown rate not measured yet");
      node.classList.remove("axis-block--high");
      return;
    }
    setText(rateMark, high ? "▲" : "");
    setText(rateText, `${Math.round(share * 1000) / 10}% unknown`);
    node.classList.toggle("axis-block--high", !!high);
  };
  node.paintRate(null);
  /** The distribution, from the decided population the impact pane already receives. */
  node.paintReading = (tally) => bar.paint(tally);
  return node;
}

/**
 * Mark an axis select that is sitting on its "any" placeholder. A wildcard is what makes a
 * rule greedy, so it is the cell that most needs to be legible at a glance — and the mark
 * is a dashed border rather than a colour, so the reading survives every colour-vision
 * profile. Called on build and again on every change.
 */
function markAny(sel) {
  sel.classList.toggle("is-any", !sel.value);
}

export async function renderAarsRules(main, _params, ctx) {
  // ------------------------------------------------------------------ shell + load
  const bar = el("div", { class: "workbench-bar" });
  const body = el("div", { class: "workbench-body" });
  const root = el("div", { class: "workbench" }, bar, body);
  main.append(root);

  // Three tabs over one route (help.js's ROUTE_TITLES / ROUTE_ICONS still name "aars"
  // alone): the AARS point score this file has always edited, the Problem tree —
  // Phase 3/4's decision cascade — and the Posture lattice — Phase 6's capability-envelope
  // tiers — each a SEPARATE workbench sharing the page rather than a new route.
  // `aarsPane`, `problemPane` and `posturePane` are all mounted from the start; only
  // `hidden` moves, so switching tabs never re-fetches or re-builds a pane that has
  // already loaded. Each is `.tab-pane` (position:absolute; inset:0) rather than its own
  // `.workbench-body` — `body` is already the positioned ancestor all three tabs share,
  // and stacking three `flex:1` boxes inside a plain block parent would collapse them to
  // zero height instead of filling it.
  const aarsPane = el("div", { class: "tab-pane" });
  const problemPane = el("div", { class: "tab-pane", hidden: true });
  const posturePane = el("div", { class: "tab-pane", hidden: true });
  body.append(aarsPane, problemPane, posturePane);

  const modelTabs = segmented({
    options: [
      { value: "aars", label: "AARS" },
      { value: "problem", label: "Problem tree" },
      { value: "posture", label: "Posture" },
    ],
    value: "aars",
    ariaLabel: "Scoring model",
    onChange: (v) => selectModelTab(v),
  });
  // Fold the impact pane away and give the editor the whole width. The flag rides the
  // `.workbench` root rather than the panes themselves because all three `.rule-panes` grids
  // are built LAZILY — the Problem and Posture ones only once their tab has first loaded — so
  // a pane built ten minutes from now inherits the state through the cascade with nothing to
  // wire, and exactly one node can disagree with storage.
  //
  // It sits beside the tab switch (which model) rather than out with Save / Revert (what to
  // do about it): both are view controls, and the toolbar's three action clusters are
  // appended at different times, so "last child of the bar" is not a fixed position anyway.
  let impactCollapsed = loadImpactCollapsed();
  const impactToggle = el(
    "button",
    { class: "rule-impact-toggle", type: "button" },
    uiIcon("chevron-right", 14),
    el("span", {}, "Impact"),
  );
  // No aria-controls: it would have to name one of three panes, two of which may not exist
  // yet — the same reason app.js's rail toggle names only itself.
  function applyImpactCollapsed() {
    root.classList.toggle("impact-collapsed", impactCollapsed);
    const label = impactCollapsed ? "Show impact panel" : "Hide impact panel";
    impactToggle.setAttribute("aria-expanded", String(!impactCollapsed));
    impactToggle.setAttribute("aria-label", label);
    impactToggle.setAttribute("title", label);
  }
  impactToggle.addEventListener("click", () => {
    impactCollapsed = !impactCollapsed;
    rememberImpactCollapsed(impactCollapsed);
    applyImpactCollapsed();
  });
  applyImpactCollapsed();

  bar.append(el("h1", { class: "workbench-title" }, "AARS Rules"), modelTabs, impactToggle);

  // Assigned once the AARS rule loads (below) and once the Problem/Posture tabs have each
  // loaded at least once — `let`, not `const`, so this closure can reach them however far
  // any load has gotten, including "never" if the AARS rule itself failed to load.
  let aarsControls = null;
  let problemControls = null;
  let postureControls = null;
  // Assigned once the Problem pane builds. Leaving a lattice popover open across a tab
  // change would strand a portal against a hidden pane — `portalsOpen()` stays raised and
  // the sheet's Tab trap keeps deferring to a list nothing can reach.
  /**
   * Mark a cascade's rows against one traced walk: everything before the winner was tried
   * and did not match, the winner is the first that did, and everything after it was never
   * reached. `idx === null` clears. Shared by both cascades because the walk is the same
   * shape in each.
   */
  /**
   * Every row of a cascade paired with the rule index it speaks for, THE FALLBACK INCLUDED,
   * as -1 — `decideMirror`'s own sentinel for "no rule matched", and the same number
   * `paintCells` stamps on a cell no rule claims.
   *
   * It is a function rather than a wider selector because `tr[data-idx]` has to keep meaning
   * "a rule row": a dozen loops (reorder, shadow marking, coverage, the claim rails) index
   * straight into `outcomeRules` / `tierRules` with it, and a fallback row arriving there
   * would read as rule number NaN. The fallback is a row of the cascade for the purpose of
   * pointing at the picture, and not one for the purpose of indexing an array, so the two
   * questions get two answers instead of one selector that is wrong for one of them.
   */
  function cascadeRows(body) {
    const rows = [...body.querySelectorAll("tr[data-idx]")].map((tr) => [tr, Number(tr.dataset.idx)]);
    const fallback = body.querySelector("tr.rule-fallback");
    if (fallback) rows.push([fallback, -1]);
    return rows;
  }

  function markTracedRows(body, idx) {
    if (!body) return;
    const live = idx !== null && idx !== undefined;
    cascadeRows(body).forEach(([tr, i]) => {
      // A walk that ends at the fallback tried EVERY rule and none of them matched — which
      // is precisely what "no rule matches" means — so -1 marks them all tried rather than,
      // as it used to, none of them. The fallback itself is never "tried": it is where the
      // walk arrives, not a rule it stepped past.
      tr.classList.toggle("rule-tried", live && i !== -1 && (idx === -1 || i < idx));
      tr.classList.toggle("rule-won", live && i === idx);
    });
  }

  let closeProblemLatticePop = () => {};
  let closePostureLatticePop = () => {};
  let activeModelTab = "aars"; // which tab is showing, so an async load can't unhide the wrong one

  function selectModelTab(which) {
    activeModelTab = which;
    const isAars = which === "aars";
    const isProblem = which === "problem";
    const isPosture = which === "posture";
    aarsPane.hidden = !isAars;
    problemPane.hidden = !isProblem;
    posturePane.hidden = !isPosture;
    if (aarsControls) aarsControls.hidden = !isAars;
    if (problemControls) problemControls.hidden = !isProblem;
    if (postureControls) postureControls.hidden = !isPosture;
    if (!isProblem) closeProblemLatticePop();
    if (!isPosture) closePostureLatticePop();
    modelTabs.set(which);
    if (isProblem) loadProblemPane();
    if (isPosture) loadPosturePane();
  }

  aarsPane.append(
    el(
      "div",
      {
        role: "status",
        "aria-label": "Loading the AARS rule",
        style: "position:absolute; inset:20px; display:flex; flex-direction:column; gap:14px",
      },
      skeleton("title", { width: "220px" }),
      skeleton("chart", { height: "120px" }),
      skeleton("line", { width: "70%" }),
      skeleton("line", { width: "55%" }),
    ),
  );

  let state;
  try {
    state = await call("api_getAarsRule", {});
  } catch (e) {
    clear(aarsPane).append(
      el(
        "div",
        { class: "workbench-empty" },
        emptyState("Couldn't load the AARS rule.", String(e.message || e)),
      ),
    );
    return;
  }

  let saved = cloneRule(state.rule);
  let draft = cloneRule(state.rule);
  let preview = null;
  let previewError = "";
  let previewing = false;
  let previewSeq = 0;
  let sampleSeq = 0;
  let sampleResult = null;
  let sandboxResultHost = null;
  let sandboxCodeBox = null;
  let sandboxQuick = null;
  const sandboxChips = el("div", { class: "gap-chips" });
  let saving = false; // held OUT of the DOM, so no repaint can re-enable Save mid-flight
  let leaving = false; // set once the nav guard has been answered, so it fires only once
  let sample = {
    counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    gapCodes: ["LLM06", "NO_GUARDRAIL"],
    dataExposure: "SENSITIVE",
  };

  const limits = state.limits || {};
  const P_MAX = limits.pointsMax ?? 100;
  const M_MIN = limits.multiplierMin ?? 1;
  const M_MAX = limits.multiplierMax ?? 3;
  const B_MIN = limits.bandMin ?? 1;
  const B_MAX = limits.bandMax ?? 100;
  const GAP_MAX = limits.maxGapRules ?? 60;

  const isDirty = () => JSON.stringify(draft) !== JSON.stringify(saved);

  // ------------------------------------------------------------------ the code vocabulary
  // The census arrives with the preview, never with the rule: loading this page must not
  // cost an inventory pass. Until the first preview lands the picker is the codebook alone,
  // which is already the whole point — the counts are a bonus, not the feature.
  let censusByCode = {};

  /** Codebook first, then whatever this tenant carries that the codebook never heard of. */
  function codeOptions() {
    return gapCodeOptions(censusByCode).concat(tenantCodeOptions(censusByCode));
  }

  /** Every code-entry control on the page, so a fresh census can reach all of them at once. */
  const codeControls = [];
  /** The subset the cascade owns — discarded and rebuilt on every structural change. */
  const cascadeControls = [];
  function refreshCodeOptions() {
    const options = codeOptions();
    for (const c of codeControls) c.setOptions(options);
  }

  /**
   * One code picker: the page's monospace field, with the catalogue filtering under it.
   * Editable rather than pick-only because tenant-specific Wiz finding shortIds (SUB-082)
   * are a routine input here — the cascade's fallback price exists to govern them — and a
   * pick-only control would make the one code nobody can look up the slowest to enter.
   */
  function codePicker({ value, ariaLabel, onChange, placeholder }) {
    const box = filterCombobox({
      value: value || "",
      options: codeOptions(),
      ariaLabel,
      searchPlaceholder: placeholder || "code or meaning…",
      editable: true,
      allowCustom: true,
      inputClass: "rule-code",
      popClass: "combobox-pop--rich",
      transform: normalizeCode,
      onChange,
    });
    codeControls.push(box);
    return box;
  }

  // ------------------------------------------------------------------------ toolbar
  const versionPill = el("span", { class: "pill neutral" });
  const scorePill = el("span", { class: "pill" });
  const dirtyHost = el("span", {});
  const saveBtn = el("button", { class: "primary" }, "Save rule");
  const revertBtn = el("button", {}, "Revert");
  const recomputeHost = el("span", {});
  aarsControls = el(
    "div",
    { class: "workbench-controls" },
    el("div", { class: "rule-bar-state" }, versionPill, scorePill, dirtyHost),
    recomputeHost,
    revertBtn,
    saveBtn,
  );
  bar.append(aarsControls);

  // ------------------------------------------------------------------------- panes
  const editor = el("div", { class: "rule-editor" });
  const impact = el("div", { class: "rule-impact" });
  clear(aarsPane).append(el("div", { class: "rule-panes" }, editor, impact));

  // A single small polite region for impact updates. The tables themselves are NOT live:
  // announcing 55 rows on every keystroke is noise, not access.
  const liveNote = el("span", {
    role: "status",
    "aria-live": "polite",
    class: "visually-hidden",
  });
  impact.append(liveNote);

  // =============================================================== hero: the model
  const heroTotal = el("span", { class: "model-hero__total" });
  // The three pillars as one stacked budget bar. Neutral steps, not colour: severity owns
  // the palette here and a pillar is not a severity.
  const stackSegs = {};
  const stackTrack = el("div", { class: "model-stack__track", role: "img" });
  for (const key of ["a", "b", "c"]) {
    const text = el("span", { class: "model-stack__text" });
    const node = el("div", { class: `model-stack__seg model-stack__seg--${key}` }, text);
    stackSegs[key] = { node, text };
    stackTrack.append(node);
  }
  const meterHost = el("div", { class: "model-stack" }, stackTrack);

  /**
   * The AARS hero gets the same row-to-picture link the two lattices have: hovering or
   * focusing a pillar's rails lights that pillar's segment in the stacked budget bar, and
   * hovering a segment lights the rails that fill it.
   *
   * The hero is already a picture of the model and the rails are already the controls that
   * move it, but nothing said which part of the bar a given rail was pushing on. Same
   * `light(id)` handle the provenance diagram and the lattices use, and hover-OR-focus for
   * the same reason: a keyboard user is reading the same relationship.
   */
  function lightPillar(key) {
    for (const k of ["a", "b", "c"]) {
      stackSegs[k].node.classList.toggle("is-lit", k === key);
      if (pillarHosts[k]) pillarHosts[k].classList.toggle("is-lit", k === key);
    }
  }
  const pillarHosts = {};
  function linkPillar(key, host) {
    if (!host) return;
    pillarHosts[key] = host;
    const on = () => lightPillar(key);
    const off = () => lightPillar(null);
    for (const [node, enter, leave] of [[host, "mouseenter", "mouseleave"], [stackSegs[key].node, "mouseenter", "mouseleave"]]) {
      node.addEventListener(enter, on);
      node.addEventListener(leave, off);
    }
    host.addEventListener("focusin", on);
    host.addEventListener("focusout", off);
  }
  const railTrack = el("div", { class: "band-rail__track" });
  const railStops = el("div", { class: "band-rail__stops" });
  const railInputs = el("div", { class: "band-rail__inputs" });

  const segs = {};
  for (const sev of RAIL_ORDER) {
    const name = el("span", { class: "band-rail__seg-name" });
    const meta = el("span", { class: "band-rail__seg-meta" });
    const seg = el("div", { class: `band-rail__seg sev-${sev}` }, name, meta);
    segs[sev] = { seg, name, meta };
    railTrack.append(seg);
  }

  const stops = {};
  BANDS.forEach((band, i) => {
    const input = el("input", {
      type: "range",
      class: "band-rail__stop",
      min: String(B_MIN),
      max: String(B_MAX),
      step: "1",
      value: String(draft.bands[band.key]),
      "aria-label": `${band.label} threshold`,
    });
    input.addEventListener("input", () => {
      // Stops cannot cross: clamped to one either side of their neighbours, so the
      // descending rule is physical rather than an error message after the fact.
      const upper = i === 0 ? B_MAX : draft.bands[BANDS[i - 1].key] - 1;
      const lower = i === BANDS.length - 1 ? B_MIN : draft.bands[BANDS[i + 1].key] + 1;
      const v = clamp(num(input.value, draft.bands[band.key]), lower, upper);
      if (String(v) !== input.value) input.value = String(v);
      draft.bands[band.key] = v;
      onEdit();
    });
    stops[band.key] = input;
    railStops.append(input);
  });

  const bandFields = {};
  BANDS.forEach((band) => {
    const id = nextId("band");
    const input = numberInput(id, { value: draft.bands[band.key], min: B_MIN, max: B_MAX });
    input.addEventListener("input", () => {
      draft.bands[band.key] = num(input.value, draft.bands[band.key]);
      onEdit();
    });
    const f = field(id, `${band.label} at`, input, "and above");
    bandFields[band.key] = { ...f, input };
    railInputs.append(f.node);
  });

  editor.append(
    el(
      "div",
      { class: "model-hero" },
      el(
        "div",
        { class: "model-hero__head" },
        el("span", { class: "label" }, "The model"),
        heroTotal,
      ),
      meterHost,
      el(
        "div",
        { class: "band-rail" },
        railTrack,
        railStops,
        el(
          "div",
          { class: "band-rail__scale", "aria-hidden": "true" },
          el("span", {}, "0"),
          el("span", {}, "100"),
        ),
        railInputs,
      ),
    ),
  );

  // ============================================================ section A — pillar A
  // Four lanes on the SAME 0-100 axis the hero stack and the band rail use, so CRITICAL 50
  // is visibly five times LOW 8 and both sit over their own value on the rail below. The
  // multiplier is drawn as the extension it causes and the cap as the line it is — which is
  // what makes "four MEDIUM issues score the same as two" something you can see rather than
  // a paragraph you have to take on trust.
  const sevRails = {};
  const railsA = el("div", { class: "rails" });
  for (const sev of SEVERITY_KEYS) {
    const rail = pointRail({
      name: sev,
      value: draft.severityPoints[sev],
      max: P_MAX,
      ariaLabel: `${sev} issue points`,
      onChange: (v) => {
        draft.severityPoints[sev] = v;
        onEdit();
      },
    });
    sevRails[sev] = rail;
    railsA.append(rail);
  }
  const capARail = pointRail({
    name: "Pillar cap",
    value: draft.pillarACap,
    max: P_MAX,
    ariaLabel: "Pillar A cap",
    onChange: (v) => {
      draft.pillarACap = v;
      onEdit();
    },
  });
  capARail.classList.add("rail--cap");
  railsA.append(capARail, railScale(P_MAX));
  linkPillar("a", railsA);

  const rowA = el("div", { class: "rule-row", style: "margin-top:14px" });
  const multId = nextId("mult");
  const multInput = numberInput(multId, {
    value: draft.multiIssueMultiplier, min: M_MIN, max: M_MAX, step: "0.05",
  });
  multInput.addEventListener("input", () => {
    draft.multiIssueMultiplier = num(multInput.value, draft.multiIssueMultiplier);
    onEdit();
  });
  const multField = { ...field(multId, "More than one issue ×", multInput), input: multInput };
  // The multiplier keeps a plain field: its effect is the extension on EVERY lane above, so
  // a lane of its own would draw the same fact twice.
  rowA.append(multField.node);

  editor.append(
    section(
      "Pillar A — toxic-combination participation",
      "Only the asset's worst open issue scores; the others do not add. A second open issue " +
        "applies the multiplier once, and a ninth applies it no further — which is why an " +
        "asset with four MEDIUM issues scores the same as one with two.",
      [railsA, rowA],
    ),
  );

  // ============================================================ section B — pillar B
  const cascadeBody = el("tbody", {});
  // The claim spine, second from the left. It used to sit between Points and Note and hide
  // itself until the first preview landed; claimRail now draws an explicit unmeasured lane
  // instead, so the column is always there and the table never reflows under the reader.
  const pricesTh = el("th", { class: "rule-prices" }, "Prices");
  // Pillar B's host is linked below, once the table element exists.
  const cascadeTable = el(
    "div",
    { class: "table-wrap table-wrap--cascade" },
    el(
      "table",
      { class: "data rule-table" },
      el("caption", { class: "visually-hidden" },
        "Compliance-gap pricing rules, in the order they are tried"),
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", {}, "#"),
          pricesTh,
          el("th", {}, "When the code"),
          el("th", {}, "Code"),
          el("th", {}, "Points"),
          el("th", { class: "rule-noteh" }, "Note"),
          el("th", {}, el("span", { class: "visually-hidden" }, "Actions")),
        ),
      ),
      cascadeBody,
    ),
  );

  linkPillar("b", cascadeTable);

  // Drag reordering, wired ONCE on the body: the rows are rebuilt on every structural
  // change, so per-row listeners would be re-attached on every add, remove and move. The
  // splice below is the one the ↑ ↓ buttons already do — see ui/rowReorder.js.
  onPageTeardown(rowDrag(cascadeBody, (from, to) => {
    const moved = draft.gapPoints.splice(from, 1)[0];
    draft.gapPoints.splice(to, 0, moved);
    renderCascade();
    focusRow(to);
    onEdit();
  }));

  const addBtn = el("button", {}, "Add rule");
  addBtn.addEventListener("click", () => {
    // New rules go on TOP: this is a first-match cascade, and anything appended below the
    // prefix families would be shadowed the moment it was typed.
    draft.gapPoints.unshift({ match: "exact", code: "", points: 5 });
    renderCascade();
    focusRow(0);
    onEdit();
  });

  const refBtn = el("button", { class: "link" }, "Code reference");
  refBtn.addEventListener("click", () => openCodeReference());

  // The fallback IS the cascade's last step, so it is rendered as the table's last row
  // rather than as a stray field beside the Add button. Built once here and moved into the
  // row on every structural rebuild, like everything else on this page.
  const fbId = nextId("fb");
  const fbInput = numberInput(fbId, { value: draft.gapFallbackPoints, min: 0, max: P_MAX });
  fbInput.addEventListener("input", () => {
    draft.gapFallbackPoints = num(fbInput.value, draft.gapFallbackPoints);
    onEdit();
  });
  const fbLabel = el(
    "label",
    { class: "field-label rule-fallback__name", for: fbId },
    "Everything that falls through",
  );
  const fbCount = el("td", { class: "rule-prices num" });
  const fbField = {
    input: fbInput,
    setChanged(changed, savedValue) {
      fbLabel.classList.toggle("field--changed", !!changed);
      if (changed) fbLabel.title = `Saved value: ${savedValue}`;
      else fbLabel.removeAttribute("title");
    },
  };
  const capBId = nextId("capb");
  const capBInput = numberInput(capBId, { value: draft.pillarBCap, min: 0, max: P_MAX });
  capBInput.addEventListener("input", () => {
    draft.pillarBCap = num(capBInput.value, draft.pillarBCap);
    onEdit();
  });
  const capBField = { ...field(capBId, "Pillar cap", capBInput), input: capBInput };

  const testId = nextId("test");
  const testOut = el("span", { class: "small muted" });
  const testBox = codePicker({
    value: "",
    ariaLabel: "Test a code",
    placeholder: "e.g. SUB-082",
    onChange: (code) => {
      if (!code) {
        setText(testOut, "");
        return;
      }
      const hit = priceCode(draft, code);
      const entry = lookupGap(code);
      setText(
        testOut,
        (entry ? `${entry.title} — ` : "") +
          (hit.index === -1
            ? `no rule matches, so it prices at the fallback: ${hit.points} points.`
            : `rule ${hit.index + 1} matches: ${hit.points} points.`),
      );
    },
  });
  // This one has a visible label, so the label IS the accessible name — the aria-label the
  // picker carries for the unlabelled cascade cells would override it, which is exactly the
  // voice-control break field() warns about.
  testBox.focusable().id = testId;
  testBox.focusable().removeAttribute("aria-label");
  const testField = el(
    "div",
    { class: "field" },
    el("label", { class: "field-label", for: testId }, "Test a code"),
    testBox,
    testOut,
  );

  editor.append(
    section(
      "Pillar B — compliance framework gaps",
      "Each gap code is priced by the FIRST rule that matches it, so order is meaning: an " +
        "exact LLM04 must sit above the LLM family, or it prices as a primary gap.",
      [
        el("div", { class: "rule-row", style: "margin-bottom:10px" }, refBtn),
        cascadeTable,
        el("div", { class: "rule-row", style: "margin-top:12px" },
          addBtn, capBField.node, testField),
      ],
    ),
  );

  // ============================================================ section C — pillar C
  // The same lanes on the same axis as pillar A, with the amplifier as the same extension.
  // That upgrades the old `after ×1.1: 22` hint from a footnote into the second segment of
  // the bar it was describing all along.
  const expRails = {};
  const railsC = el("div", { class: "rails" });
  for (const pair of EXPOSURES) {
    const key = pair[0];
    const rail = pointRail({
      name: EXPOSURE_LABELS[key],
      value: draft.dataExposurePoints[key],
      max: P_MAX,
      ariaLabel: `${EXPOSURE_LABELS[key]} points`,
      onChange: (v) => {
        draft.dataExposurePoints[key] = v;
        onEdit();
      },
    });
    expRails[key] = rail;
    railsC.append(rail);
  }
  railsC.append(railScale(P_MAX));
  // Pillar B keeps number fields rather than rails (its quantity is ORDER, not magnitude),
  // so its cascade table is the host that lights instead.
  linkPillar("c", railsC);

  const rowC = el("div", { class: "rule-row", style: "margin-top:14px" });
  const ampId = nextId("amp");
  const ampInput = numberInput(ampId, {
    value: draft.dataAmplifier, min: M_MIN, max: M_MAX, step: "0.05",
  });
  ampInput.addEventListener("input", () => {
    draft.dataAmplifier = num(ampInput.value, draft.dataAmplifier);
    onEdit();
  });
  const ampField = { ...field(ampId, "5Rs amplifier ×", ampInput), input: ampInput };
  rowC.append(
    ampField.node,
    helpTip(
      el("span", { class: "helptip-mark", "aria-hidden": "true" }, "?"),
      [
        "The one number on this page that is not a policy choice.",
        "It is a systemic signal: the 5Rs data-security score sits at 53% across the whole " +
          "landscape, so every data-related point carries the same uplift regardless of asset.",
      ],
      { label: "About the 5Rs amplifier", term: "pillar-c" },
    ),
  );

  editor.append(
    section(
      "Pillar C — data exposure",
      "The amplifier is a systemic signal, not a per-asset one: the 5Rs framework sits at " +
        "53% across the landscape, so every data-related point carries the same uplift.",
      [railsC, rowC],
    ),
  );

  // ================================================================ section — manage
  const resetBtn = el("button", {}, "Reset to spec defaults");
  resetBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Reset to spec defaults?",
      body:
        "Every pillar, gap rule and threshold returns to the model in ai/custom_score.md. " +
        "Nothing is saved until you press Save rule.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    draft = cloneRule(state.defaults);
    renderCascade();
    onEdit();
    resetBtn.focus();
  });

  // Loading a preset is the same act as Reset — it replaces the draft wholesale — so it
  // sits beside it and confirms the same way. It does NOT save: the impact pane is the
  // whole point, and adopting v2 moves scores.
  const v2Btn = el("button", {}, "Load AARS v2");
  v2Btn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Load the AARS v2 model?",
      body:
        "v2 is calibrated against live-derived gaps rather than the doc's hand-picked ones: " +
        "the issue count is read past “more than one”, gap prices combine as a root-sum-square " +
        "so pillar B stops sitting on its cap, the three dormant gap sources are switched on, " +
        "and internet exposure is scored. It WILL move scores — the impact panel shows exactly " +
        "which. Nothing is saved until you press Save rule.",
      confirmLabel: "Load v2",
    });
    if (!ok) return;
    draft = cloneRule(state.presets && state.presets.v2 ? state.presets.v2 : draft);
    renderCascade();
    onEdit();
    v2Btn.focus();
  });

  // v3 is v2 with one further change: pillar B prices the CONDITION an asset holds (missing
  // guardrail, excessive privilege, sensitive data, internet exposure) plus which toxic-
  // combination groups it belongs to, instead of the framework codes those groups mint. It
  // is not simply "better than v2" — see the confirm body — so it is offered beside v2, not
  // instead of it.
  const v3Btn = el("button", {}, "Load AARS v3");
  v3Btn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Load the AARS v3 model?",
      body:
        "v3 is v2 with pillar B repriced: one charge per risk CONDITION an asset holds " +
        "(missing guardrail, excessive privilege, sensitive data, internet exposure) and " +
        "one per distinct toxic-combination group, instead of one per framework code. It " +
        "takes pillar B further off its ceiling than v2's root-sum-square does (0 of 30 " +
        "assets at cap on the seed landscape, vs v2's 1 of 30), but it is not a strict upgrade: " +
        "v2 currently separates the landscape a little better (lower tie rate, higher effective " +
        "cardinality) because its framework-code cascade happens to distinguish toxic-combo " +
        "patterns that v3 correctly prices the same once they cost the same conditions. It " +
        "WILL move scores — the impact panel shows exactly which. Nothing is saved until you " +
        "press Save rule.",
      confirmLabel: "Load v3",
    });
    if (!ok) return;
    draft = cloneRule(state.presets && state.presets.v3 ? state.presets.v3 : draft);
    renderCascade();
    onEdit();
    v3Btn.focus();
  });

  const exportBtn = el("button", { class: "link" }, "Export JSON");
  exportBtn.addEventListener("click", () => {
    downloadText(
      "aars-rule.json",
      JSON.stringify({ basedOnVersion: state.version, unsaved: isDirty(), rule: draft }, null, 2),
      "application/json",
    );
  });

  const importInput = el("input", {
    type: "file", accept: "application/json,.json",
    style: "display:none", "aria-hidden": "true", tabindex: "-1",
  });
  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        draft = cloneRule(parsed && parsed.rule ? parsed.rule : parsed);
        renderCascade();
        onEdit();
        toast("Rule loaded — the impact panel shows what it would change. Save to apply.");
      } catch (e) {
        toast("That file isn't a readable rule: " + String(e.message || e), "error");
      }
    };
    reader.readAsText(file);
    importInput.value = "";
  });
  const importBtn = el("button", { class: "link" }, "Import JSON");
  importBtn.addEventListener("click", () => importInput.click());

  editor.append(
    section("Manage", null, [
      el("div", { class: "rule-row" }, resetBtn, v2Btn, v3Btn, exportBtn, importBtn, importInput),
    ]),
  );

  // ================================================================== impact pane
  const impactStrip = el("div", { class: "impact-strip" });
  const impactHeadline = el("p", { class: "impact-headline small muted" });
  const impactState = el("div", {});
  const moverList = el("div", { class: "mover-list" });
  const moverMore = el("div", { style: "margin-top:8px" });
  const moverSection = el(
    "div",
    {},
    el("h2", { class: "section-label", style: "margin-top:18px" }, "What moves"),
    moverList,
    moverMore,
  );

  // How well the draft SEPARATES the landscape. The band strip above cannot show this: a
  // rule that hands every asset the same score still fills a band, and still reads as a
  // confident answer. Only the absences give it away — few distinct scores, empty bands,
  // a pillar pinned at its cap — so they are stated rather than left to be noticed.
  const diagList = el("div", { class: "diag-list" });
  const diagWarn = el("div", {});
  const diagSection = el(
    "div",
    {},
    el("h2", { class: "section-label", style: "margin-top:18px" }, "How well it separates"),
    diagList,
    diagWarn,
  );

  impact.append(
    el("h2", { class: "section-label" }, "Impact on the current inventory"),
      registerWideNote(bootstrapCached(),
        "a rule preview has to answer for every asset it would rescore"),
    impactState,
    impactStrip,
    impactHeadline,
    diagSection,
    moverSection,
  );

  // Sandbox — a disclosure at the foot of the pane, closed by default.
  const sandboxBody = el("div", {});
  const sandboxDetails = el(
    "details",
    { class: "rule-disclosure", open: sandboxOpen || null },
    el("summary", {}, "Try a hypothetical asset"),
    sandboxBody,
  );
  sandboxDetails.addEventListener("toggle", () => {
    sandboxOpen = sandboxDetails.open;
    if (sandboxOpen) scheduleSample();
  });
  impact.append(sandboxDetails);
  buildSandbox();

  // ------------------------------------------------------------------ section helper
  function section(title, lede, children) {
    const id = nextId("sec");
    return el("section", { class: "rule-section", "aria-labelledby": id },
      el("h2", { class: "section-label", id }, title),
      lede ? el("p", { class: "rule-section__lede small muted" }, lede) : null,
      ...children,
    );
  }

  // ----------------------------------------------------------------- cascade painters
  /**
   * The resolved meaning of a code, under the field that holds it. The mark is a SHAPE and
   * the sentence says the same thing in words — this page has no colour to spend on a
   * gloss, and the reader who most needs "not in the codebook" is the one who cannot see a
   * mark at all.
   */
  function paintGloss(node, g) {
    setText(node.firstChild, g.shape);
    setText(node.lastChild, g.text);
    node.classList.toggle("gap-gloss--unknown", !g.known);
  }


  // ------------------------------------------------------------- cascade (structural)
  /** Put the caret in a row's code field — where every structural change should land. */
  function focusRow(i) {
    const tr = cascadeBody.querySelector(`tr[data-idx="${i}"]`);
    const input = tr && tr.querySelector(".rule-code");
    if (input) input.focus();
  }

  function renderCascade() {
    // Close any open popover before the row holding it is discarded, or its portal count
    // never comes back down and the sheet's focus trap stays deferred to a list that is gone.
    for (const c of cascadeControls) {
      c.closePopover();
      const at = codeControls.indexOf(c);
      if (at >= 0) codeControls.splice(at, 1);
    }
    cascadeControls.length = 0;
    clear(cascadeBody);
    const options = codeOptions();
    draft.gapPoints.forEach((row, i) => {
      const matchSel = segmented({
        options: MATCH_OPTIONS,
        value: row.match,
        ariaLabel: `Match type, rule ${i + 1}`,
        className: "seg--cell",
        onChange: (v) => {
          row.match = v;
          onEdit();
        },
      });

      // The gloss under the field, wired as a DESCRIPTION rather than left as a sibling:
      // in a table cell, DOM adjacency buys a screen reader nothing.
      const glossId = nextId("gloss");
      const gloss = el(
        "span",
        { class: "gap-gloss", id: glossId },
        el("span", { class: "gap-gloss__mark", "aria-hidden": "true" }),
        el("span", { class: "gap-gloss__text" }),
      );
      const codeBox = filterCombobox({
        value: row.code,
        options,
        ariaLabel: `Code, rule ${i + 1}`,
        searchPlaceholder: "code or meaning…",
        editable: true,
        allowCustom: true,
        inputClass: "rule-code",
        popClass: "combobox-pop--rich",
        transform: normalizeCode,
        onChange: (v) => {
          row.code = v;
          onEdit();
        },
      });
      codeControls.push(codeBox);
      cascadeControls.push(codeBox);
      codeBox.focusable().setAttribute("aria-describedby", glossId);

      const pointsInput = el("input", {
        type: "number", min: "0", max: String(P_MAX), value: String(row.points),
        class: "rule-num", "aria-label": `Points, rule ${i + 1}`,
      });
      pointsInput.addEventListener("input", () => {
        row.points = num(pointsInput.value, row.points);
        onEdit();
      });

      const move = (delta) => {
        const to = i + delta;
        if (to < 0 || to >= draft.gapPoints.length) return;
        const other = draft.gapPoints[to];
        draft.gapPoints[to] = row;
        draft.gapPoints[i] = other;
        renderCascade();
        const moved = cascadeBody.querySelector(`tr[data-idx="${to}"]`);
        const btn = moved && moved.querySelector(delta < 0 ? ".js-up" : ".js-down");
        if (btn) btn.focus();
        onEdit();
      };
      const up = el("button", { class: "link js-up", "aria-label": `Move rule ${i + 1} up` }, "↑");
      up.disabled = i === 0;
      up.addEventListener("click", () => move(-1));
      const down = el("button", { class: "link js-down", "aria-label": `Move rule ${i + 1} down` }, "↓");
      down.disabled = i === draft.gapPoints.length - 1;
      down.addEventListener("click", () => move(1));
      const del = el("button", { class: "link danger", "aria-label": `Remove rule ${i + 1}` }, "✕");
      del.addEventListener("click", () => {
        draft.gapPoints.splice(i, 1);
        renderCascade();
        const rows = cascadeBody.querySelectorAll("tr[data-idx]");
        const next = rows[Math.min(i, rows.length - 1)];
        const btn = next && next.querySelector(".link.danger");
        (btn || addBtn).focus();
        onEdit();
      });

      const meta = el("td", { class: "rule-rowmeta small muted" });
      const prices = el("td", { class: "rule-prices num" });
      const tr = el(
        "tr",
        { "data-idx": String(i) },
        idxCell(i),
        prices,
        el("td", {}, matchSel),
        el("td", { class: "rule-codecell" }, codeBox, gloss),
        el("td", {}, pointsInput),
        meta,
        el("td", { class: "rule-rowbtns" }, up, down, del),
      );
      cascadeBody.append(tr);
    });

    // The last step of a first-match cascade, drawn as the last step. It used to sit in a
    // row of fields below the table, where nothing said it was part of the ladder at all.
    cascadeBody.append(
      el(
        "tr",
        { class: "rule-fallback" },
        el("td", { class: "num muted small", "aria-hidden": "true" }, "↳"),
        fbCount,
        el("td", { colspan: "2" }, fbLabel),
        el("td", {}, fbInput),
        el("td", { class: "rule-rowmeta small muted" }, "governs tenant-specific finding IDs"),
        el("td", {}),
      ),
    );

    addBtn.disabled = draft.gapPoints.length >= GAP_MAX;
    addBtn.title = addBtn.disabled ? `The cascade is limited to ${GAP_MAX} rules.` : "";
  }

  /**
   * Insert a rule for a code ABOVE whatever would otherwise claim it, priced at what it
   * costs today. Correctness by construction: someone who has never heard of LLM06 cannot
   * produce a dead rule this way, and adding one does not silently move a score.
   */
  function addRuleForCode(code) {
    const c = normalizeCode(code);
    if (!c) return;
    const hit = priceCode(draft, c);
    const at = hit.index === -1 ? draft.gapPoints.length : hit.index;
    draft.gapPoints.splice(at, 0, { match: "exact", code: c, points: hit.points });
    renderCascade();
    focusRow(at);
    onEdit();
  }

  // -------------------------------------------------------------- the code reference
  /**
   * The whole vocabulary, browsable. Grouped by family, each group stating its edition and
   * its standing — three of the four are moving, and one is a vendor page, so presenting
   * them as equally authoritative would claim a confidence none of them supports.
   */
  function openCodeReference() {
    openSheet(
      (sheetBody) => {
        for (const family of CODEBOOK) {
          const rows = el("div", { class: "codebook-list" });
          for (const [code, title, blurb] of family.entries) {
            const hit = priceCode(draft, code);
            const seen = censusByCode[code] || 0;
            const add = el("button", { class: "link" }, "Add a rule");
            add.setAttribute("aria-label", `Add a pricing rule for ${code}`);
            add.addEventListener("click", () => {
              addRuleForCode(code);
              closeActiveSheet();
              toast(`Added a rule for ${code}, above the rule that was pricing it.`);
            });
            rows.append(
              el(
                "div",
                { class: "codebook-row" },
                el("span", { class: "codebook-row__code" }, code),
                el("span", { class: "codebook-row__title" }, title),
                el("span", { class: "codebook-row__blurb small muted" }, blurb),
                el(
                  "span",
                  { class: "codebook-row__price small muted" },
                  hit.index === -1
                    ? `fallback — ${hit.points} pts`
                    : `rule ${hit.index + 1} — ${hit.points} pts`,
                ),
                el("span", { class: "codebook-row__seen small muted" },
                  seen ? `${seen} ${seen === 1 ? "asset" : "assets"}` : "—"),
                el("span", { class: "codebook-row__act" }, add),
              ),
            );
          }
          sheetBody.append(
            sheetSection(
              `${family.group} · ${family.vintage}`,
              el("p", { class: "small muted", style: "margin:0 0 8px" }, family.standing),
              rows,
            ),
          );
        }
        sheetBody.append(
          el(
            "p",
            { class: "small muted", style: "margin-top:14px" },
            "Titles are annotation. The score matches on the code itself, exactly as it " +
              "always has, so a title this page gets wrong can never produce a wrong score.",
          ),
        );
      },
      {
        title: "Compliance-gap codes",
        subtitle: "What each code means, what this draft prices it at, and how many assets carry it",
        ariaLabel: "The compliance-gap code reference",
      },
    );
  }

  // -------------------------------------------------------------------------- sandbox
  function buildSandbox() {
    const countsRow = el("div", { class: "rule-row" });
    const countInputs = {};
    for (const sev of SEVERITY_KEYS) {
      const id = nextId("sc");
      const input = numberInput(id, { value: sample.counts[sev], min: 0, max: 12 });
      input.addEventListener("input", () => {
        sample.counts[sev] = Math.max(0, num(input.value, sample.counts[sev]));
        scheduleSample();
      });
      countInputs[sev] = input;
      countsRow.append(field(id, `${sev} issues`, input).node);
    }

    const expId = nextId("sexp");
    const exposureSel = el(
      "select",
      { id: expId },
      ...EXPOSURES.map((p) =>
        el("option", { value: p[0], selected: sample.dataExposure === p[0] || null }, p[1])),
    );
    exposureSel.addEventListener("change", () => {
      sample.dataExposure = exposureSel.value;
      scheduleSample();
    });

    // The gaps as chips rather than a comma-separated string, each one saying what the
    // DRAFT rule prices it at — so the sandbox's own input explains the rule being edited.
    const addId = nextId("addgap");
    sandboxCodeBox = codePicker({
      value: "",
      ariaLabel: "Add a gap code",
      placeholder: "code or meaning…",
      onChange: (code) => {
        const c = normalizeCode(code);
        if (!c) return;
        if (sample.gapCodes.indexOf(c) < 0) sample.gapCodes.push(c);
        sandboxCodeBox.setValue("");
        paintSandboxCodes();
        scheduleSample();
      },
    });
    sandboxCodeBox.focusable().id = addId;
    sandboxCodeBox.focusable().removeAttribute("aria-label");

    // Quick-add reflects what the landscape actually carries, not a constant somebody typed
    // once. Empty until the first preview lands, which is honest: before then the page has
    // no idea what is common here.
    sandboxQuick = el("div", { class: "pill-row", style: "margin-top:10px" });

    sandboxResultHost = el("div", { class: "sandbox-result" });
    sandboxBody.append(
      el("p", { class: "small muted", style: "margin:10px 0" },
        "Scored by the server with your draft rule — the same code that scores the real " +
          "inventory, so what you see here is what a matching asset would get."),
      countsRow,
      el(
        "div",
        { class: "field", style: "margin-top:12px" },
        el("label", { class: "field-label", for: addId }, "Compliance gap codes"),
        sandboxChips,
        sandboxCodeBox,
      ),
      sandboxQuick,
      el("div", { class: "rule-row", style: "margin-top:12px" },
        field(expId, "Data exposure", exposureSel).node),
      sandboxResultHost,
    );
    paintSandboxCodes();
  }

  /**
   * The chosen gap codes, and the quick-add row beneath them. Structural — a chip appearing
   * or leaving IS a change of shape — so focus is handed on explicitly, by position, the
   * same recovery the cascade's remove button performs.
   */
  function paintSandboxCodes() {
    clear(sandboxChips);
    sample.gapCodes.forEach((code, i) => {
      const entry = lookupGap(code);
      const pts = priceCode(draft, code).points;
      const drop = el("button", {
        class: "chip-x", "aria-label": `Remove ${code}${entry ? ` — ${entry.title}` : ""}`,
      }, "✕");
      drop.addEventListener("click", () => {
        sample.gapCodes.splice(i, 1);
        paintSandboxCodes();
        scheduleSample();
        const next = sandboxChips.querySelectorAll(".chip-x");
        const target = next[Math.min(i, next.length - 1)];
        (target || sandboxCodeBox.focusable()).focus();
      });
      sandboxChips.append(
        el(
          "div",
          { class: "gap-chip", title: entry ? `${code} — ${entry.title}` : `${code} — not in the codebook` },
          el("span", { class: "gap-chip__code" }, code),
          entry ? el("span", { class: "gap-chip__title" }, entry.title) : null,
          el("span", { class: "gap-chip__pts num" }, `${pts} pts`),
          drop,
        ),
      );
    });
    if (!sample.gapCodes.length) {
      sandboxChips.append(el("span", { class: "small muted" }, "No gaps — pillar B scores 0."));
    }
    paintSandboxQuick();
  }

  /**
   * Reprice the chips in place. Editing the cascade changes what each chip costs, but a
   * chip appearing or leaving is the only thing that changes the chip ROW — so a keystroke
   * mutates text here and never rebuilds a list that might hold the focus.
   */
  function syncSandboxPrices() {
    const chips = sandboxChips.querySelectorAll(".gap-chip");
    chips.forEach((chip, i) => {
      const code = sample.gapCodes[i];
      if (!code) return;
      setText(chip.querySelector(".gap-chip__pts"), `${priceCode(draft, code).points} pts`);
    });
  }

  function paintSandboxQuick() {
    if (!sandboxQuick) return;
    clear(sandboxQuick);
    const common = (preview && preview.gapCensus ? preview.gapCensus : [])
      .filter((c) => sample.gapCodes.indexOf(c.code) < 0)
      .slice(0, SANDBOX_QUICK_CODES);
    if (!common.length) return;
    sandboxQuick.append(el("span", { class: "small muted" }, "Common here:"));
    for (const { code, assets } of common) {
      const entry = lookupGap(code);
      const btn = el("button", {
        class: "kind-pill",
        title: `${entry ? entry.title + " — " : ""}on ${assets} ${assets === 1 ? "asset" : "assets"}`,
      }, code);
      btn.addEventListener("click", () => {
        sample.gapCodes.push(code);
        paintSandboxCodes();
        scheduleSample();
        sandboxCodeBox.focusable().focus();
      });
      sandboxQuick.append(btn);
    }
  }

  // ============================================================================ sync
  function onEdit() {
    sync();
    schedulePreview();
    scheduleSample();
  }

  /** Mutate everything that reflects `draft`. Never rebuilds; never touches a focused field. */
  function sync() {
    const errs = draftErrors(draft);

    // --- hero: one stacked bar showing how the three pillars compose the score, and
    // where the 100-point clamp bites when their caps oversubscribe the scale.
    const capC = Math.round(draft.dataExposurePoints.SENSITIVE * draft.dataAmplifier);
    const caps = [
      { key: "a", label: "A", value: draft.pillarACap, name: "Toxic combinations" },
      { key: "b", label: "B", value: draft.pillarBCap, name: "Compliance gaps" },
      { key: "c", label: "C", value: capC, name: "Data exposure" },
    ];
    const capSum = caps.reduce((t, c) => t + c.value, 0);
    for (const c of caps) {
      const seg = stackSegs[c.key];
      // Drawn on the SAME 0-100 axis as the band rail below, so 50 points here sits over
      // 50 on the rail. When the caps oversubscribe the scale the bar simply runs past its
      // track and is clipped — which is what the clamp does, shown rather than described.
      seg.node.style.width = `${c.value}%`;
      setText(seg.text, `${c.label} · ${c.value}`);
      setAttr(seg.node, "title", `${c.name}: up to ${c.value} points`);
    }
    setAttr(
      stackTrack,
      "aria-label",
      `Pillar caps: toxic combinations ${caps[0].value}, compliance gaps ${caps[1].value}, ` +
        `data exposure ${caps[2].value}. Total ${capSum} against a 100-point scale.`,
    );
    setText(
      heroTotal,
      capSum > 100
        ? `Pillar caps total ${capSum} — the bar runs past the scale and scores clamp at 100`
        : `Pillar caps total ${capSum} of the 100-point scale`,
    );

    // --- band rail
    const b = draft.bands;
    const spans = {
      INFO: b.low,
      LOW: b.medium - b.low,
      MEDIUM: b.high - b.medium,
      HIGH: b.critical - b.high,
      CRITICAL: 101 - b.critical,
    };
    const ranges = {
      INFO: [0, b.low - 1],
      LOW: [b.low, b.medium - 1],
      MEDIUM: [b.medium, b.high - 1],
      HIGH: [b.high, b.critical - 1],
      CRITICAL: [b.critical, 100],
    };
    const counts = (preview && preview.proposed) || null;
    for (const sev of RAIL_ORDER) {
      const s = segs[sev];
      const width = Math.max(0, spans[sev]) / 101 * 100;
      s.seg.style.width = `${width}%`;
      setText(s.name, sev);
      const [lo, hi] = ranges[sev];
      const n = counts ? counts[sev] ?? 0 : null;
      setText(s.meta, hi < lo ? "—" : `${lo}–${hi}${n === null ? "" : ` · ${n}`}`);
    }
    BANDS.forEach((band, i) => {
      const v = draft.bands[band.key];
      const stop = stops[band.key];
      setValue(stop, v);
      const n = counts ? counts[band.label] ?? 0 : null;
      setAttr(stop, "aria-valuetext",
        `${band.label} from ${v}${n === null ? "" : ` — ${n} assets`}`);
      const f = bandFields[band.key];
      setValue(f.input, v);
      f.setError(errs.bands[band.key] || "");
      f.setChanged(saved.bands[band.key] !== v, saved.bands[band.key]);
    });

    // --- pillar A: the lanes carry the value, the multiplier's extension and the cap line
    for (const sev of SEVERITY_KEYS) {
      const rail = sevRails[sev];
      rail.setValue(draft.severityPoints[sev]);
      rail.setJump(draft.multiIssueMultiplier);
      rail.setCap(draft.pillarACap);
      rail.setChanged(
        saved.severityPoints[sev] !== draft.severityPoints[sev], saved.severityPoints[sev]);
    }
    capARail.setValue(draft.pillarACap);
    capARail.setChanged(saved.pillarACap !== draft.pillarACap, saved.pillarACap);
    setValue(multField.input, draft.multiIssueMultiplier);
    multField.setChanged(saved.multiIssueMultiplier !== draft.multiIssueMultiplier, saved.multiIssueMultiplier);

    setValue(fbField.input, draft.gapFallbackPoints);
    fbField.setChanged(saved.gapFallbackPoints !== draft.gapFallbackPoints, saved.gapFallbackPoints);
    setValue(capBField.input, draft.pillarBCap);
    capBField.setChanged(saved.pillarBCap !== draft.pillarBCap, saved.pillarBCap);

    // --- pillar C: same lanes, same axis. Its ceiling is DERIVED (top tier through the
    // amplifier), never set, so the line carries no thumb — offering a handle for a number
    // nobody chooses would be a lie about what this model lets you do.
    for (const pair of EXPOSURES) {
      const key = pair[0];
      const rail = expRails[key];
      rail.setValue(draft.dataExposurePoints[key]);
      rail.setJump(draft.dataAmplifier);
      rail.setCap(capC, { derived: true, label: `derived ceiling ${capC}` });
      rail.setChanged(
        saved.dataExposurePoints[key] !== draft.dataExposurePoints[key],
        saved.dataExposurePoints[key]);
    }
    setValue(ampField.input, draft.dataAmplifier);
    ampField.setChanged(saved.dataAmplifier !== draft.dataAmplifier, saved.dataAmplifier);

    // --- cascade rows: the gloss, the shadow / unreachable / unexercised note, and the count
    const shadowed = (preview && preview.shadowedGapRules) || [];
    const unreachable = (preview && preview.unreachableGapRules) || [];
    const matchCounts = (preview && preview.gapMatchCounts) || null;
    const instanceTotal = (preview && preview.gapInstanceTotal) || 0;
    // Cumulative starts, so the column reads as the live gap instances being consumed in
    // cascade order rather than as N unrelated bars.
    const gapOffsets = claimOffsets(matchCounts || []);
    const rows = cascadeBody.querySelectorAll("tr[data-idx]");
    rows.forEach((tr, i) => {
      const row = draft.gapPoints[i];
      const meta = tr.querySelector(".rule-rowmeta");
      const err = errs.gaps[i];
      const shadow = !err && shadowed.indexOf(i) >= 0;
      const unreach = !err && !shadow && unreachable.indexOf(i) >= 0;
      const dead = shadow || unreach;
      const priced = matchCounts ? matchCounts[i] ?? 0 : null;

      // THREE ways to price nothing, and they are three different claims. A shadowed row
      // is masked by an earlier rule — a mistake in this cascade. An unreachable row names
      // a code no derivation emits, so it cannot fire in ANY tenant — a mistake about what
      // the model can see, and the one the operator has no other way to discover. A live
      // row at zero is simply a rule this tenant does not exercise, which is fine, so it
      // keeps its full weight on the page.
      let note = "";
      if (err) note = err;
      else if (shadow) note = "never fires — an earlier rule already matches this";
      else if (unreach) note = "never fires — nothing raises this code; switch its gap source on";
      else if (priced === 0 && instanceTotal) note = "in force — nothing in this tenant carries it";
      setText(meta, note);
      meta.classList.toggle("field-error", !!err);
      tr.classList.toggle("rule-dead", dead);

      const code = tr.querySelector(".rule-code");
      if (err) code.setAttribute("aria-invalid", "true");
      else code.removeAttribute("aria-invalid");

      const gloss = tr.querySelector(".gap-gloss");
      if (gloss) {
        const g = resolveGap(row.code, row.match, {
          pricedAbove: pricedAboveCount(draft.gapPoints, i),
          fallbackPoints: draft.gapFallbackPoints,
        });
        paintGloss(gloss, g);
      }
      claimRail(tr.querySelector(".rule-prices"), {
        count: priced, total: instanceTotal, offset: gapOffsets[i] || 0, unit: "gap instances",
      });
    });
    claimRail(fbCount, {
      count: matchCounts ? preview.gapFallbackCount ?? 0 : null,
      total: instanceTotal,
      offset: gapOffsets[gapOffsets.length - 1] || 0,
      unit: "gap instances",
    });
    syncSandboxPrices();

    // --- toolbar
    setText(versionPill, state.version === 0 ? "Spec defaults" : `Model v${state.version}`);
    // Three states, not two. A register holding two rule versions is stale AND incomparable:
    // scores computed under different rules are not on the same scale, so a band count or a
    // percentile drawn across them measures two things at once. "Stale" alone would say the
    // register is merely behind, which understates it.
    const mixed = (state.versionSpread || []).length > 1;
    scorePill.className = `pill ${state.stale || mixed ? "warn" : "ok"}`;
    setText(scorePill, mixed ? "Scores mixed"
      : state.stale ? "Scores stale" : "Scores current");
    clear(dirtyHost);
    if (isDirty()) dirtyHost.append(statusPill("warn", "Unsaved changes"));
    revertBtn.disabled = !isDirty() || saving;
    // Save stays focusable even when invalid: a disabled control cannot be tabbed to or
    // explain itself. Pressing it with errors moves focus to the offending field.
    saveBtn.disabled = saving;

    syncRecompute();
  }

  function syncRecompute() {
    const spread = state.versionSpread || [];
    const scope = (bootstrapCached() || {}).scope || {};
    const view = scope.projectView || "";
    // The signature has to carry everything the block renders, or a change of view or of the
    // version split would leave the previous render in place.
    const want = `${state.stale ? 1 : 0}|${spread.length}|${view}`;
    if (recomputeHost.dataset.sig === want) return;
    recomputeHost.dataset.sig = want;
    clear(recomputeHost);
    if (spread.length > 1) {
      // Named in full rather than summarised as "mixed": which rule scored how many assets is
      // the fact an operator needs to decide whether to finish the job.
      recomputeHost.append(el("p", { class: "small muted" },
        "This register holds scores from more than one rule — "
        + spread.map((e) => `${e.version === null ? "unrecorded" : `v${e.version}`}: `
          + `${e.assets} ${e.assets === 1 ? "asset" : "assets"}`).join(" · ")
        + ". Scores from different rules are not on the same scale; recompute with no project "
        + "selected, or sync, to bring the whole register onto one."));
    }
    if (!state.stale) return;
    const btn = el("button", {},
      view ? "Recompute scores in view" : "Recompute scores");
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: view ? "Recompute scores for this project?" : "Recompute every AARS score?",
        body: (view
          ? "Re-scores only the assets in the current project view. The rest of the register "
            + "keeps the scores it has, so the register will hold two rule versions at once "
            + "and scores will not be comparable across them until you recompute with no "
            + "project selected, or sync. "
          : "Re-scores the whole inventory under the saved rule. ")
          + "Rewrites the asset table and the graph snapshot. No sync history row is written, "
          + "so the trend is left alone.",
        confirmLabel: "Recompute",
      });
      if (!ok) return;
      btn.disabled = true;
      setText(btn, "Recomputing…");
      try {
        const fresh = await call("api_rescoreAars", {});
        state = { ...state, ...fresh };
        saved = cloneRule(state.rule);
        toast(fresh.untouched
          ? `Rescored ${fresh.assetCount} assets — ${fresh.untouched} left on an older rule.`
          : `Rescored ${fresh.assetCount} assets.`);
        sync();
        schedulePreview();
        ctx.refresh();
      } catch (e) {
        toast(String(e.message || e), "error");
        btn.disabled = false;
        setText(btn, "Recompute scores");
      }
    });
    recomputeHost.append(btn);
  }

  // ========================================================================= preview
  const schedulePreviewRun = debounce(() => runPreview(), PREVIEW_DEBOUNCE_MS);
  function schedulePreview() {
    schedulePreviewRun.cancel();
    if (draftErrors(draft).list.length) {
      preview = null;
      previewError = "";
      previewing = false;
      impact.classList.remove("updating");
      paintImpact();
      return;
    }
    previewing = true;
    impact.classList.add("updating");
    schedulePreviewRun();
  }

  async function runPreview() {
    const seq = ++previewSeq;
    try {
      const data = await call("api_previewAarsRule", { rule: draft });
      if (seq !== previewSeq) return; // superseded by a later edit
      preview = data;
      previewError = "";
      // The census travels with the preview, so this is where the pickers learn what the
      // landscape actually carries — and where codes the codebook never heard of (tenant
      // finding shortIds) become pickable at all.
      const nextCensus = {};
      for (const row of data.gapCensus || []) nextCensus[row.code] = row.assets;
      if (JSON.stringify(nextCensus) !== JSON.stringify(censusByCode)) {
        censusByCode = nextCensus;
        refreshCodeOptions();
      }
      paintSandboxQuick();
    } catch (e) {
      if (seq !== previewSeq) return;
      preview = null;
      previewError = String(e.message || e);
    }
    previewing = false;
    impact.classList.remove("updating");
    paintImpact();
    sync(); // band counts and shadowed-row notes come from the preview
  }

  function paintImpact() {
    const errs = draftErrors(draft);
    clear(impactState);

    if (errs.list.length) {
      clear(impactStrip);
      clear(moverList);
      clear(moverMore);
      moverSection.hidden = true;
      paintDiscrimination(null);
      setText(impactHeadline, "");
      impactState.append(emptyState("Fix the highlighted fields to preview.", errs.list[0]));
      return;
    }
    if (previewError) {
      clear(impactStrip);
      moverSection.hidden = true;
      paintDiscrimination(null);
      setText(impactHeadline, "");
      const retry = el("button", { style: "margin-top:10px" }, "Try again");
      retry.addEventListener("click", () => {
        previewError = "";
        schedulePreview();
        paintImpact();
      });
      impactState.append(emptyState("Couldn't preview this rule.", previewError), retry);
      return;
    }
    if (!preview) {
      moverSection.hidden = true;
      paintDiscrimination(null);
      setText(impactHeadline, "");
      clear(impactStrip).append(
        skeleton("line", { width: "80%" }),
        skeleton("line", { width: "60%" }),
      );
      return;
    }
    if (!preview.total) {
      clear(impactStrip);
      moverSection.hidden = true;
      paintDiscrimination(null);
      setText(impactHeadline, "");
      impactState.append(
        emptyState(
          "No inventory to compare against.",
          "Run a sync first; the rule still saves and applies to the next one.",
        ),
      );
      return;
    }

    clear(impactStrip);
    for (const band of preview.bandRanges) {
      const now = preview.current[band.severity] ?? 0;
      const next = preview.proposed[band.severity] ?? 0;
      const delta = next - now;
      impactStrip.append(
        el(
          "div",
          { class: "impact-row" },
          sevBadge(band.severity),
          el("span", { class: "impact-row__nums" }, `${now} → ${next}`),
          el(
            "span",
            { class: "impact-row__delta" },
            delta === 0
              ? el("span", { class: "muted" }, "—")
              : el(
                  "span",
                  { class: delta > 0 ? "delta-up" : "delta-down" },
                  (delta > 0 ? "+" : "") + String(delta),
                ),
          ),
        ),
      );
    }

    let headline;
    if (!preview.moverCount) {
      headline = `Nothing changes across ${preview.total} assets.`;
    } else {
      const parts = [];
      if (preview.scoreChangeCount) parts.push(`${preview.scoreChangeCount} change score`);
      if (preview.levelChangeCount) parts.push(`${preview.levelChangeCount} change level`);
      headline = `Of ${preview.total} assets, ${parts.join(" and ")}.`;
    }
    setText(impactHeadline, headline);
    setText(liveNote, `Impact updated. ${headline}`);

    paintDiscrimination(preview.discrimination);

    clear(moverList);
    clear(moverMore);
    moverSection.hidden = !preview.movers.length;

    for (const m of preview.movers.slice(0, MOVERS_INLINE)) {
      moverList.append(moverRow(m));
    }
    if (preview.moverCount > MOVERS_INLINE) {
      const more = el("button", { class: "link" }, `View all ${preview.moverCount}`);
      more.addEventListener("click", () => {
        openSheet(
          (sheetBody) => {
            const list = el("div", { class: "mover-list" });
            for (const m of preview.movers) list.append(moverRow(m));
            sheetBody.append(list);
            if (preview.truncated) {
              sheetBody.append(
                el("p", { class: "small muted", style: "margin-top:10px" },
                  `Showing the ${preview.movers.length} most consequential of ` +
                    `${preview.moverCount} — level changes first, then the largest moves.`),
              );
            }
          },
          { title: "What moves", subtitle: headline, ariaLabel: "Assets that change" },
        );
      });
      moverMore.append(more);
    }
  }

  /**
   * The separation read-out. Every line is a plain sentence rather than a bare metric,
   * because "distinctScores: 2" tells an operator nothing and "every asset lands on one
   * of 2 scores" tells them the model has stopped working.
   *
   * A saturated pillar gets a warning of its own: above a cap the score cannot tell two
   * assets apart at all, so a majority sitting there means that pillar — and every rule
   * the operator has tuned inside it — is contributing nothing to the ranking.
   */
  function paintDiscrimination(d) {
    clear(diagList);
    clear(diagWarn);
    diagSection.hidden = !d || !d.scored;
    if (!d || !d.scored) return;

    const line = diagRow;

    // Worst first, so an unreachable CRITICAL is named before an empty INFO.
    const ALL_LEVELS = RAIL_ORDER.slice().reverse();
    const empties = ALL_LEVELS.filter((b) => !(d.bandOccupancy[b] > 0));
    diagList.append(
      line(
        "Distinct scores",
        `${d.distinctScores} across ${d.scored} assets`,
        d.distinctScores <= 3 ? "too few to rank by" : "",
      ),
      line(
        "Largest tie",
        `${d.largestTieGroup} assets share one score`,
        d.largestTieGroup > d.scored / 2 ? "a “top N” would cut into this block arbitrarily" : "",
      ),
      line("Range used", `${d.range.min}–${d.range.max} of 0–100`, ""),
      line(
        "Levels reached",
        `${ALL_LEVELS.length - empties.length} of ${ALL_LEVELS.length}`,
        empties.length ? `nothing lands in ${empties.join(", ")}` : "",
      ),
    );

    // Pillars pinned at their cap for a majority. Named individually: which pillar has
    // stopped discriminating is the whole diagnosis.
    const pillars = [
      ["A", "toxic combinations", d.saturated.toxic],
      ["B", "compliance gaps", d.saturated.compliance],
      ["C", "data exposure", d.saturated.data],
      ["D", "internet exposure", d.saturated.exposure],
    ];
    for (const [letter, name, n] of pillars) {
      if (!n || n <= d.scored / 2) continue;
      const all = n === d.scored;
      diagWarn.append(
        el(
          "p",
          { class: "diag-warn small" },
          el("span", { class: "diag-warn__mark", "aria-hidden": "true" }, "▲"),
          `Pillar ${letter} — ${name} — is at its cap for ${all ? "every one of the" : n + " of"} ` +
            `${d.scored} scored assets, so it separates ${all ? "none of them" : "almost none of them"}. ` +
            `Above a cap two very different assets score the same. ` +
            (letter === "B"
              ? "Every cascade row below is being clamped away; lower the prices, raise the cap, or switch pillar B to root-sum-square."
              : "Lower the points or raise the cap."),
        ),
      );
    }
    if (d.saturated.score > d.scored / 2) {
      diagWarn.append(
        el("p", { class: "diag-warn small" },
          el("span", { class: "diag-warn__mark", "aria-hidden": "true" }, "▲"),
          `${d.saturated.score} of ${d.scored} assets are clamped at 100 — the scale has run out.`),
      );
    }
  }

  function moverRow(m) {
    return el(
      "div",
      { class: "mover-row" },
      el("span", { class: "mover-row__name" }, m.name),
      el(
        "div",
        { class: "mover-row__move" },
        aarsChip(m.fromScore, m.fromSeverity),
        el("span", { class: "mover-arrow", "aria-hidden": "true" }, "→"),
        aarsChip(m.toScore, m.toSeverity),
        el("span", { class: "mover-row__kind" }, m.levelChanged ? "changes level" : "score only"),
      ),
    );
  }

  // ========================================================================== sandbox
  const scheduleSampleRun = debounce(() => runSample(), SAMPLE_DEBOUNCE_MS);
  function scheduleSample() {
    if (!sandboxDetails.open) return; // closed: don't spend a round trip on it
    scheduleSampleRun();
  }

  async function runSample() {
    const seq = ++sampleSeq;
    const issueSeverities = [];
    for (const sev of SEVERITY_KEYS) {
      for (let i = 0; i < sample.counts[sev]; i++) issueSeverities.push(sev);
    }
    try {
      const data = await call("api_scoreAarsSample", {
        rule: draft,
        sample: { issueSeverities, gapCodes: sample.gapCodes, dataExposure: sample.dataExposure },
      });
      if (seq !== sampleSeq) return;
      sampleResult = data;
    } catch (e) {
      if (seq !== sampleSeq) return;
      sampleResult = { error: String(e.message || e) };
    }
    paintSandbox();
  }

  function paintSandbox() {
    if (!sandboxResultHost) return;
    clear(sandboxResultHost);
    if (!sampleResult) {
      sandboxResultHost.append(skeleton("pill", { width: "180px" }));
      return;
    }
    if (sampleResult.error) {
      sandboxResultHost.append(el("span", { class: "small muted" }, sampleResult.error));
      return;
    }
    const p = sampleResult.pillars;
    const breakdown = sampleResult.gapBreakdown || [];
    sandboxResultHost.append(
      aarsChip(sampleResult.score, sampleResult.severity),
      el("span", { class: "small muted" },
        `A ${p.toxic} + B ${p.compliance} + C ${p.data}` +
          (p.toxic + p.compliance + p.data > sampleResult.score ? " (clamped to 100)" : "")),
      // Each gap tied back to the rule that priced it, and named — so a pillar-B total can
      // be read back to the cascade rows that produced it without a second lookup.
      ...(breakdown.length
        ? [el("div", { class: "sandbox-gaps small muted" },
            ...breakdown.map((g) => {
              const entry = lookupGap(g.code);
              const hit = priceCode(draft, g.code);
              const via = g.overridden
                ? "overridden"
                : hit.index === -1 ? "fallback" : `rule ${hit.index + 1}`;
              return el(
                "div",
                { class: "sandbox-gap" },
                el("span", { class: "sandbox-gap__code" }, g.code),
                entry ? el("span", {}, entry.title) : el("span", {}, "not in the codebook"),
                el("span", { class: "sandbox-gap__pts num" }, `${g.points} (${via})`),
              );
            }))]
        : []),
    );
  }

  // ============================================================================ save
  revertBtn.addEventListener("click", () => {
    draft = cloneRule(saved);
    renderCascade();
    onEdit();
  });

  saveBtn.addEventListener("click", async () => {
    const errs = draftErrors(draft);
    if (errs.list.length) {
      // Focusable-but-invalid: say what's wrong and take the user to it.
      const badBand = BANDS.find((b) => errs.bands[b.key]);
      const target = badBand
        ? bandFields[badBand.key].input
        : cascadeBody.querySelector('[aria-invalid="true"]');
      toast(errs.list[0], "warn");
      if (target) target.focus();
      return;
    }
    saving = true;
    sync();
    try {
      const fresh = await call("api_setAarsRule", { rule: draft });
      state = fresh;
      saved = cloneRule(fresh.rule);
      draft = cloneRule(fresh.rule);
      toast("AARS rule saved.");
      renderCascade();
      saving = false;
      onEdit();
      ctx.refresh();
    } catch (e) {
      saving = false;
      sync();
      toast(String(e.message || e), "error");
    }
  });

  // ------------------------------------------------------- leaving with unsaved work
  // Both listeners self-deactivate once this page's root leaves the document, so they
  // can't outlive the route (pages here have no teardown hook).
  const onNavClick = async (e) => {
    if (!root.isConnected) {
      document.removeEventListener("click", onNavClick, true);
      return;
    }
    const link = e.target.closest && e.target.closest(".nav-link");
    if (!link || leaving || !(isDirty() || isProblemDirty() || isPostureDirty())) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "Discard unsaved changes?",
      body: "This page has edits — to the AARS rule, the Problem tree rule, or the Posture " +
        "rule — that have not been saved. Leaving discards them.",
      confirmLabel: "Discard & leave",
      danger: true,
    });
    if (!ok) return;
    leaving = true;
    window.location.hash = link.getAttribute("href").replace(/^#/, "");
  };
  document.addEventListener("click", onNavClick, true);

  const onBeforeUnload = (e) => {
    if (!root.isConnected) {
      window.removeEventListener("beforeunload", onBeforeUnload);
      return;
    }
    if (leaving || !(isDirty() || isProblemDirty() || isPostureDirty())) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // ============================================================================
  // Problem tree — Phase 5.
  //
  // THE CLIENT DRAWS THE CASCADE; THE SERVER REMAINS THE ONLY SOURCE OF ANYTHING COUNTED.
  // This is a narrowing of what this comment used to say ("the client NEVER decides"), and
  // it is narrower on purpose rather than by erosion. The lattice below has to repaint in
  // the same frame as a keystroke — after PREVIEW_DEBOUNCE_MS (700ms) plus an Apps Script
  // round-trip, a picture you are dragging rows around in reads as broken — so
  // decideMirror.js re-walks the first-match-wins cascade in the browser to decide WHICH
  // CELL GETS WHICH TINT. That is the whole of what it does.
  //
  // Every NUMBER on this tab still comes from api_previewProblemRule, which runs the real
  // cascade server-side (syncStore.decideProblemsWith) at zero Wiz cost: the leaf counts,
  // the landscape occupancy, the movers, the per-axis unknown rates, and the validation that
  // gates Save. Two guards keep the drawn picture and the counted truth from drifting:
  // test/decideMirror.test.js pins the mirror against domain/problem.ts over all 54 vectors
  // (and all 27 posture cells) including which row decided, and the section's own reconcile() below
  // reconciles the mirror's own tally against the server's leafCoverage.byRow on every
  // preview response — hatching the whole lattice rather than letting it show a confident
  // wrong answer if they ever disagree.
  //
  // Rule 1 at the top of this file is untouched: no score, no points, nothing continuous is
  // computed here. See decideMirror.js's own header for why a cascade walk is safe to
  // mirror when a score is not.

  const AXIS_DEFS = [
    { key: "exploitation", label: "Exploitation", values: ["ACTIVE", "SUSPECTED", "UNKNOWN"] },
    { key: "impact", label: "Technical impact", values: ["TOTAL", "PARTIAL"] },
    { key: "exposure", label: "System exposure", values: ["OPEN", "CONTROLLED", "UNVERIFIED"] },
    { key: "mission", label: "Mission", values: ["HIGH", "MEDIUM", "LOW"] },
  ];
  // DERIVED from OUTCOME_VALUES (src/domain/problem.ts) and outcomeLabel(), worst first, so
  // the dropdowns and the occupancy strip walk one order and print one set of words. It used
  // to be a hand-written copy of both, and renaming `Track ★` to CISA's `Track*` had to be
  // applied to three separate copies of the same four strings to keep them agreeing — which
  // is the drift this now cannot have.
  const OUTCOME_OPTIONS = OUTCOME_VALUES.map((value) => ({ value, label: outcomeLabel(value) }));
  const AXIS_LABELS = {
    exploitation: "Exploitation", impact: "Technical impact",
    exposure: "System exposure", mission: "Mission",
  };
  // An axis whose UNKNOWN share crosses this line gets its own .diag-warn card, the same
  // "this is a finding, not a footnote" treatment AARS gives a saturated pillar below.
  const UNKNOWN_WARN_THRESHOLD = 0.5;
  const PROBLEM_MOVERS_INLINE = 8;

  let problemState = null;
  let problemSaved = null;
  let problemDraft = null;
  let problemPreview = null;
  let problemPreviewError = "";
  let problemPreviewSeq = 0;
  let problemSaving = false;
  let problemLoading = false;
  let problemLoaded = false;

  function isProblemDirty() {
    return problemLoaded && JSON.stringify(problemDraft) !== JSON.stringify(problemSaved);
  }

  /**
   * The cheap structural checks only — no leaf enumeration, which would mean re-running
   * the cascade client-side. The ACT-ceiling check (validateProblemRule's other half)
   * stays server-only for exactly that reason; this is an early warning, never the last
   * word, same contract draftErrors() keeps for the AARS half.
   */
  function problemDraftErrors(rule) {
    const max = (problemState && problemState.limits && problemState.limits.maxOutcomeRules) || 40;
    const list = [];
    if (!rule.outcomeRules.length) {
      list.push(
        "The outcome cascade has no rules; every issue and finding would route to the " +
          "fallback outcome.");
    }
    if (rule.outcomeRules.length > max) list.push(`The outcome cascade is limited to ${max} rules.`);
    rule.outcomeRules.forEach((row, i) => {
      const empty = AXIS_DEFS.every((a) => !row.when[a.key]);
      if (empty && i !== rule.outcomeRules.length - 1) {
        list.push(`Outcome rule ${i + 1} has no conditions, so it swallows every rule after it.`);
      }
    });
    return list;
  }

  async function loadProblemPane() {
    if (problemLoaded || problemLoading) return;
    problemLoading = true;
    problemPane.append(
      el(
        "div",
        {
          role: "status",
          "aria-label": "Loading the problem tree rule",
          style: "position:absolute; inset:20px; display:flex; flex-direction:column; gap:14px",
        },
        skeleton("title", { width: "220px" }),
        skeleton("chart", { height: "120px" }),
        skeleton("line", { width: "70%" }),
      ),
    );
    try {
      problemState = await call("api_getProblemRule", {});
    } catch (e) {
      clear(problemPane).append(
        el(
          "div",
          { class: "workbench-empty" },
          emptyState("Couldn't load the Problem tree rule.", String(e.message || e)),
        ),
      );
      problemLoading = false;
      return;
    }
    problemLoading = false;
    problemSaved = cloneRule(problemState.rule);
    problemDraft = cloneRule(problemState.rule);
    problemLoaded = true;
    buildProblemPane();
  }

  function buildProblemPane() {
    // ---------------------------------------------------------------------- toolbar
    const pVersionPill = el("span", { class: "pill neutral" });
    const pStalePill = el("span", { class: "pill" });
    const pDirtyHost = el("span", {});
    const pSaveBtn = el("button", { class: "primary" }, "Save rule");
    const pRevertBtn = el("button", {}, "Revert");
    const pRecomputeHost = el("span", {});
    problemControls = el(
      "div",
      { class: "workbench-controls" },
      el("div", { class: "rule-bar-state" }, pVersionPill, pStalePill, pDirtyHost),
      pRecomputeHost,
      pRevertBtn,
      pSaveBtn,
    );
    problemControls.hidden = activeModelTab !== "problem";
    bar.append(problemControls);

    // ---------------------------------------------------------------- cascade (editor)
    const pCascadeBody = el("tbody", {});
    const pClaimsTh = el("th", { class: "rule-prices" }, "Leaves");
    // DMN's completeness reading — how much of the closed space is claimed, and whether any
    // rule cannot fire — over the table it is about. Every figure already came back in the
    // preview and was reported only in the impact pane, on the far side of the screen from
    // the ladder being edited.
    const pSummary = el("p", { class: "rule-summary" });
    const pCascadeTable = el(
      "div",
      { class: "table-wrap table-wrap--cascade" },
      el(
        "table",
        { class: "data rule-table" },
        el("caption", { class: "visually-hidden" }, "Problem tree outcome rules, tried in order"),
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "#"),
            pClaimsTh,
            ...AXIS_DEFS.map((a) => el("th", {}, a.label)),
            el("th", {}, "Outcome"),
            el("th", { class: "rule-noteh" }, "Note"),
            el("th", {}, el("span", { class: "visually-hidden" }, "Actions")),
          ),
        ),
        pCascadeBody,
      ),
    );

    // Wired ONCE on the body — the rows are rebuilt on every structural change. The splice
    // is the one the ↑ ↓ buttons already do; see ui/rowReorder.js for why drag is the
    // shortcut and those buttons stay the control.
    onPageTeardown(rowDrag(pCascadeBody, (from, to) => {
      const moved = problemDraft.outcomeRules.splice(from, 1)[0];
      problemDraft.outcomeRules.splice(to, 0, moved);
      renderProblemCascade();
      focusProblemRow(to);
      onProblemEdit();
    }));

    const pAddBtn = el("button", {}, "Add rule");
    pAddBtn.addEventListener("click", () => {
      // New rules go on TOP — a first-match cascade, same reasoning as the AARS cascade.
      problemDraft.outcomeRules.unshift({ when: {}, outcome: "ATTEND" });
      renderProblemCascade();
      focusProblemRow(0);
      onProblemEdit();
    });

    function focusProblemRow(i) {
      const tr = pCascadeBody.querySelector(`tr[data-idx="${i}"]`);
      const sel = tr && tr.querySelector("select");
      if (sel) sel.focus();
    }

    function renderProblemCascade() {
      pLattice.close();
      clear(pCascadeBody);
      const max = (problemState.limits && problemState.limits.maxOutcomeRules) || 40;
      problemDraft.outcomeRules.forEach((row, i) => {
        const axisCells = AXIS_DEFS.map((axis) => {
          const sel = select({
            options: axis.values,
            value: row.when[axis.key] || "",
            ariaLabel: `${axis.label}, rule ${i + 1}`,
            placeholder: "any",
            onChange: (v) => {
              if (v) row.when[axis.key] = v;
              else delete row.when[axis.key];
              markAny(sel);
              onProblemEdit();
            },
          });
          markAny(sel);
          return el("td", {}, sel);
        });
        const outcomeSel = select({
          options: OUTCOME_OPTIONS,
          value: row.outcome,
          ariaLabel: `Outcome, rule ${i + 1}`,
          onChange: (v) => {
            row.outcome = v;
            outcomeCell.paint(v);
            onProblemEdit();
          },
        });
        const outcomeCell = verdictSelect(outcomeSel);

        const move = (delta) => {
          const to = i + delta;
          if (to < 0 || to >= problemDraft.outcomeRules.length) return;
          const other = problemDraft.outcomeRules[to];
          problemDraft.outcomeRules[to] = row;
          problemDraft.outcomeRules[i] = other;
          renderProblemCascade();
          const moved = pCascadeBody.querySelector(`tr[data-idx="${to}"]`);
          const btn = moved && moved.querySelector(delta < 0 ? ".js-up" : ".js-down");
          if (btn) btn.focus();
          onProblemEdit();
        };
        const up = el("button", { class: "link js-up", "aria-label": `Move rule ${i + 1} up` }, "↑");
        up.disabled = i === 0;
        up.addEventListener("click", () => move(-1));
        const down = el(
          "button", { class: "link js-down", "aria-label": `Move rule ${i + 1} down` }, "↓");
        down.disabled = i === problemDraft.outcomeRules.length - 1;
        down.addEventListener("click", () => move(1));
        const del = el("button", { class: "link danger", "aria-label": `Remove rule ${i + 1}` }, "✕");
        del.addEventListener("click", () => {
          problemDraft.outcomeRules.splice(i, 1);
          renderProblemCascade();
          const rows = pCascadeBody.querySelectorAll("tr[data-idx]");
          const next = rows[Math.min(i, rows.length - 1)];
          const btn = next && next.querySelector(".link.danger");
          (btn || pAddBtn).focus();
          onProblemEdit();
        });

        const meta = el("td", { class: "rule-rowmeta small muted" });
        const claims = el("td", { class: "rule-prices num" });
        const tr = el(
          "tr",
          { "data-idx": String(i) },
          idxCell(i),
          claims,
          ...axisCells,
          el("td", {}, outcomeCell),
          meta,
          el("td", { class: "rule-rowbtns" }, up, down, del),
        );
        // The register drives the picture, and focus counts as much as hover — the rule
        // scans.js's provenance diagram keeps, so a keyboard user gets the same link.
        const lightCells = () => pLattice.light(i);
        const dimCells = () => pLattice.light(null);
        tr.addEventListener("mouseenter", lightCells);
        tr.addEventListener("mouseleave", dimCells);
        tr.addEventListener("focusin", lightCells);
        tr.addEventListener("focusout", dimCells);

        pCascadeBody.append(tr);
      });

      // The cascade's terminal step, drawn as the table's last row — same idiom as the
      // AARS cascade's fallback price.
      const fbSel = select({
        options: OUTCOME_OPTIONS,
        value: problemDraft.fallbackOutcome,
        ariaLabel: "Fallback outcome",
        onChange: (v) => {
          problemDraft.fallbackOutcome = v;
          fbCell.paint(v);
          onProblemEdit();
        },
      });
      const fbCell = verdictSelect(fbSel);
      const fbTr = el(
        "tr",
        { class: "rule-fallback" },
        el("td", { class: "num muted small", "aria-hidden": "true" }, "↳"),
        el("td", { class: "rule-prices num" }),
        el("td", { colspan: String(AXIS_DEFS.length) }, "Matches no rule above"),
        el("td", {}, fbCell),
        el("td", { class: "rule-rowmeta small muted" }, "the tree's fallback outcome"),
        el("td", {}),
      );
      // The fallback claims leaves like any other row — twelve of the fifty-four, against
      // this draft — and its claim rail says so two columns to the left, so it gets the same
      // link to the picture the rules get. -1 is what `paintCells` stamped on exactly those
      // cells, so `light(-1)` is not a special case here, it is the ordinary one.
      const fbLight = () => pLattice.light(-1);
      const fbDim = () => pLattice.light(null);
      fbTr.addEventListener("mouseenter", fbLight);
      fbTr.addEventListener("mouseleave", fbDim);
      fbTr.addEventListener("focusin", fbLight);
      fbTr.addEventListener("focusout", fbDim);
      pCascadeBody.append(fbTr);

      pAddBtn.disabled = problemDraft.outcomeRules.length >= max;
      pAddBtn.title = pAddBtn.disabled ? `The cascade is limited to ${max} rules.` : "";
    }

    // -------------------------------------------------------- derivation knobs (editor)
    const pMissionSelect = select({
      options: ["HIGH", "MEDIUM", "LOW"],
      value: problemDraft.missingMission,
      // No ariaLabel: `field()` below wires a real <label for>, and an aria-label here
      // would override it — the exact override that file's own header warns breaks voice
      // control ("address the field by the words next to it").
      onChange: (v) => {
        problemDraft.missingMission = v;
        onProblemEdit();
      },
    });
    const pMissionId = nextId("pmission");
    pMissionSelect.id = pMissionId;
    const pMissionField = field(pMissionId, "Mission then reads", pMissionSelect);

    const pCeilingId = nextId("pceil");
    const pCeilingInput = numberInput(pCeilingId, {
      value: Math.round(problemDraft.actLeafCeiling * 1000) / 10, min: 0.1, max: 100, step: 0.1,
    });
    pCeilingInput.addEventListener("input", () => {
      const pct = num(pCeilingInput.value, problemDraft.actLeafCeiling * 100);
      problemDraft.actLeafCeiling = clamp(pct, 0.1, 100) / 100;
      onProblemEdit();
    });
    const pCeilingField = {
      ...field(pCeilingId, "ACT ceiling", pCeilingInput, "% of the 54 leaves"),
      input: pCeilingInput,
    };

    // Both of these hold a LIST of opaque strings the cascade matches literally, so a typo
    // does not fail — it silently matches nothing and the axis reads UNKNOWN for the rest of
    // the landscape. They were single comma-separated text inputs, which made the separator
    // invisible grammar AND gave the operator no way to discover what the tenant carries.
    // The options arrive with the preview (`census`) and are set below in sync().
    const pRemediateTokens = tokenList({
      values: problemDraft.remediateVerdicts,
      ariaLabel: "Add an AI verdict that reaches SUSPECTED",
      placeholder: "Add a verdict…",
      emptyText: "No verdict reaches SUSPECTED on its own",
      onChange: (next) => {
        problemDraft.remediateVerdicts = next;
        onProblemEdit();
      },
    });
    onPageTeardown(() => pRemediateTokens.closePopover());

    const pGroupsTokens = tokenList({
      values: problemDraft.totalImpactGroups,
      ariaLabel: "Add a combo group that grants code execution",
      placeholder: "Add a combo group…",
      emptyText: "No combo group grants TOTAL impact on its own",
      onChange: (next) => {
        problemDraft.totalImpactGroups = next;
        onProblemEdit();
      },
    });
    onPageTeardown(() => pGroupsTokens.closePopover());

    // ------------------------------------------------------- exploitation table (editor)
    const pExploitBody = el("tbody", {});
    const pExploitTable = el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        { class: "data rule-table" },
        el("caption", { class: "visually-hidden" }, "Wiz combo rules with a known exploit maturity"),
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "Wiz combo rule id"),
            el("th", {}, "Maturity"),
            el("th", {}, el("span", { class: "visually-hidden" }, "Actions")),
          ),
        ),
        pExploitBody,
      ),
    );
    const pExploitEmpty = el(
      "p", { class: "axis-step__hint small muted" },
      "No combo rule is listed, so nothing reaches SUSPECTED this way.",
    );
    const pExploitAddBtn = el("button", {}, "Add rule");
    pExploitAddBtn.addEventListener("click", () => {
      problemDraft.exploitationByRuleId.unshift({ ruleId: "", maturity: "FEASIBLE" });
      renderExploitationRows();
      onProblemEdit();
    });

    function renderExploitationRows() {
      clear(pExploitBody);
      // A headers-only table reads as a broken widget, not as "this list is empty" — and
      // empty is the DEFAULT state of this list, so it is the state most readers meet. The
      // table hides and says what its emptiness means; the Add button below stays put.
      pExploitTable.hidden = !problemDraft.exploitationByRuleId.length;
      pExploitEmpty.hidden = !pExploitTable.hidden;
      problemDraft.exploitationByRuleId.forEach((row, i) => {
        const ruleIdInput = el("input", {
          type: "text", class: "rule-code", value: row.ruleId,
          "aria-label": `Wiz combo rule id, row ${i + 1}`,
        });
        ruleIdInput.addEventListener("input", () => {
          row.ruleId = ruleIdInput.value.trim();
          onProblemEdit();
        });
        const maturitySelect = select({
          options: ["REALIZED", "DEMONSTRATED", "FEASIBLE"],
          value: row.maturity,
          ariaLabel: `Maturity, row ${i + 1}`,
          onChange: (v) => {
            row.maturity = v;
            onProblemEdit();
          },
        });
        const del = el("button", { class: "link danger", "aria-label": `Remove row ${i + 1}` }, "✕");
        del.addEventListener("click", () => {
          problemDraft.exploitationByRuleId.splice(i, 1);
          renderExploitationRows();
          onProblemEdit();
        });
        pExploitBody.append(
          el(
            "tr",
            {},
            el("td", {}, ruleIdInput),
            el("td", {}, maturitySelect),
            el("td", { class: "rule-rowbtns" }, del),
          ),
        );
      });
    }

    // ------------------------------------------------------------------- the four axes
    // Each block states what problem.ts actually does. Where a step is a Wiz reading the
    // operator cannot move, it says so — that is as much a part of the answer as the knobs
    // are, and "there is nothing to configure here" is the single most useful sentence this
    // section can carry for exposure.
    const pExploitationAxis = axisBlock({
      name: "Exploitation",
      values: ["ACTIVE", "SUSPECTED", "UNKNOWN"],
      ordered: true,
      lede: "First match wins, as with the cascade above.",
      steps: [
        {
          signal: "Wiz has validated the issue as exploitable",
          yields: "ACTIVE",
          origin: "Wiz signal · issues only",
          lights: "ACTIVE",
        },
        {
          signal: "A Wiz combo rule you list reports REALIZED or DEMONSTRATED",
          yields: "SUSPECTED",
          origin: "your table",
          lights: "SUSPECTED",
          control: el(
            "div",
            {},
            el(
              "p", { class: "axis-step__hint small muted" },
              "Matched on the issue’s rule id, or a finding’s short id. FEASIBLE does not " +
                "reach SUSPECTED — “someone could” is not “someone has”.",
            ),
            pExploitEmpty,
            pExploitTable,
            el("div", { class: "rule-row", style: "margin-top:10px" }, pExploitAddBtn),
          ),
        },
        {
          signal: "The AI remediation verdict is one you name",
          yields: "SUSPECTED",
          origin: "your list · issues only",
          lights: "SUSPECTED",
          control: pRemediateTokens,
        },
        {
          signal: "Nothing above matched",
          yields: "UNKNOWN",
          origin: "the rate above counts these",
          lights: "UNKNOWN",
        },
      ],
    });

    const pImpactAxis = axisBlock({
      name: "Technical impact",
      values: ["TOTAL", "PARTIAL"],
      ordered: false,
      lede:
        "Any one of these says TOTAL; otherwise PARTIAL. “Unknown” here is not a third " +
        "value — it counts the rows where none of the three produced a signal either way, " +
        "which is a coverage gap the two values cannot show on their own.",
      steps: [
        { signal: "The asset has admin privileges", yields: "TOTAL", origin: "Wiz signal", lights: "TOTAL" },
        { signal: "A human holds admin access to it", yields: "TOTAL", origin: "Wiz signal", lights: "TOTAL" },
        {
          signal: "The issue’s combo group is one you name",
          yields: "TOTAL",
          origin: "your list · issues only",
          lights: "TOTAL",
          control: pGroupsTokens,
        },
      ],
    });

    const pExposureAxis = axisBlock({
      name: "System exposure",
      values: ["OPEN", "CONTROLLED", "UNVERIFIED"],
      ordered: false,
      steps: [],
      note: el(
        "p",
        { class: "axis-note small" },
        el("span", { class: "axis-note__mark", "aria-hidden": "true" }, "●"),
        "Nothing to configure. Read from the asset’s INTERNET_EXPOSURE risk condition alone " +
          "— set is OPEN, cleared is CONTROLLED, and no reading at all is UNVERIFIED. A high " +
          "unknown rate here is a sync-coverage problem, not a rule problem: no edit on this " +
          "page can move it.",
      ),
    });

    const pMissionAxis = axisBlock({
      name: "Mission",
      values: ["HIGH", "MEDIUM", "LOW"],
      ordered: true,
      lede: "Wiz’s own business-impact classification, with one fallback you choose.",
      steps: [
        {
          signal: "Wiz classifies the asset HBI, MBI or LBI",
          yields: "HIGH / MEDIUM / LOW",
          origin: "Wiz signal",
          // Not one value — every row Wiz actually classified, whichever way it fell.
          lights: "known",
        },
        {
          signal: "Wiz classifies it as none of those",
          origin: "your default",
          // The hatched share, wherever it landed: exactly the rows the fallback decided,
          // which is the one thing this knob's owner wants to know.
          lights: "unknown",
          control: el("div", { class: "rule-row" }, pMissionField.node),
        },
      ],
    });

    // Keyed by axis so sync() can walk AXIS_DEFS — the same order the cascade's columns and
    // the impact pane's unknown-rate rows already use, so all three read as one vocabulary.
    const pAxisBlocks = {
      exploitation: pExploitationAxis,
      impact: pImpactAxis,
      exposure: pExposureAxis,
      mission: pMissionAxis,
    };

    // ------------------------------------------------------------------ the lattice hero
    // The same structural slot the AARS tab opens with: one picture of the whole model,
    // the only boxed surface in the editor pane, with the parts of the model below it.
    // Everything about how it behaves lives in ui/latticeSection.js, which the Posture tab
    // mounts too — see that file for why this is one component and not two.
    const pLattice = latticeSection({
      spec: PROBLEM_LATTICE,
      kind: "problem",
      unit: "leaves",
      unitOne: "leaf",
      decide: (v) => mirrorDecideProblem(v, problemDraft),
      decideSaved: (v) => mirrorDecideProblem(v, problemSaved),
      coverageOf: (rule) => mirrorLeafCoverage(rule),
      getRule: () => problemDraft,
      getRules: () => problemDraft.outcomeRules,
      getCeiling: () => problemDraft.actLeafCeiling,
      getRuleCap: () => (problemState && problemState.limits && problemState.limits.maxOutcomeRules) || 40,
      getOccupancy: () => {
        const disc = problemPreview && problemPreview.treeDiscrimination;
        return { known: !!disc, map: (disc && disc.leafOccupancy) || {} };
      },
      whenWords: (row) => {
        if (!row) return "no condition";
        const parts = AXIS_DEFS
          .filter((a) => row.when[a.key] !== undefined)
          .map((a) => `${a.label.toLowerCase()} ${row.when[a.key]}`);
        return parts.length ? parts.join(", ") : "no condition, so it matches everything left";
      },
      onRowLight: (idx) => lightProblemRow(idx),
      onTrace: (idx) => markTracedRows(pCascadeBody, idx),
      onAddRule: (when, outcome) => {
        // New rows go on TOP — a first-match cascade, same reasoning as pAddBtn.
        problemDraft.outcomeRules.unshift({ when, outcome });
        renderProblemCascade();
        focusProblemRow(0);
        onProblemEdit();
      },
    });
    // Leaving a lattice popover open across a tab change would strand a portal against a
    // hidden pane — `portalsOpen()` stays raised and the sheet's Tab trap keeps deferring
    // to a list nothing can reach.
    closeProblemLatticePop = pLattice.close;
    onPageTeardown(pLattice.close);

    const pEditor = el(
      "div",
      { class: "rule-editor" },
      pLattice.node,
      section(
        "Outcome cascade",
        "Each row is tried in order; the first whose conditions ALL match wins. An axis " +
          "left on “any” is a wildcard, not a value — a row with no conditions at all " +
          "matches every remaining vector.",
        [pSummary, pCascadeTable, el("div", { class: "rule-row", style: "margin-top:10px" }, pAddBtn)],
      ),
      section(
        "How the four axes are read",
        "Separate from the cascade above, which only decides what a VECTOR routes to once " +
          "it exists. These decide what the vector IS. Each axis lists the signals that " +
          "produce it, in the order they are tried, and the bar beneath shows what those " +
          "signals actually read across the landscape — hatched wherever nothing could be " +
          "established. Hover or focus a signal to light the part of the bar it decided.",
        [pExploitationAxis, pImpactAxis, pExposureAxis, pMissionAxis],
      ),
      section(
        "Validation only",
        "Moving this never changes which outcome a vector receives — only whether the " +
          "cascade as a whole still validates. It lived among the axes above, where it read " +
          "as a fifth thing the tree derives; the Posture tab has always filed its own " +
          "ceiling here.",
        [el("div", { class: "rule-row" }, pCeilingField.node)],
      ),
    );

    // ---------------------------------------------------------------- impact (preview)
    const pImpactStrip = el("div", { class: "impact-strip" });
    const pImpactHeadline = el("p", { class: "impact-headline small muted" });
    const pLeavesLine = el("p", { class: "small muted", style: "margin:0 0 12px" });
    const pImpactState = el("div", {});
    const pLiveNote = el("span", { role: "status", "aria-live": "polite", class: "visually-hidden" });

    // The per-axis unknown-rate readout — the finding this whole endpoint exists to
    // surface (problemRule.ts's own header). Presented with the same weight the AARS
    // pane gives "how well it separates", not folded into a smaller line.
    const pUnknownList = el("div", { class: "diag-list" });
    const pUnknownWarn = el("div", {});
    const pUnknownSection = el(
      "div",
      {},
      el("h2", { class: "section-label", style: "margin-top:18px" }, "Per-axis unknown rate"),
      el(
        "p", { class: "small muted", style: "margin:0 0 6px" },
        "How often each axis could not be established, over the issues and findings this " +
          "draft actually decided. A high rate here — not the outcome counts above — is " +
          "usually the real finding."),
      pUnknownList,
      pUnknownWarn,
    );

    const pMoverList = el("div", { class: "mover-list" });
    const pMoverMore = el("div", { style: "margin-top:8px" });
    const pMoverSection = el(
      "div", {},
      el("h2", { class: "section-label", style: "margin-top:18px" }, "What moves"),
      pMoverList, pMoverMore,
    );

    const pImpact = el(
      "div",
      { class: "rule-impact" },
      pLiveNote,
      el("h2", { class: "section-label" }, "Impact on open issues and findings"),
      registerWideNote(bootstrapCached(),
        "a rule preview has to answer for every asset it would rescore"),
      pImpactState,
      pImpactStrip,
      pImpactHeadline,
      pLeavesLine,
      pUnknownSection,
      pMoverSection,
    );

    // problemControls lives in `bar`, appended above — the toolbar's own home is next to
    // the AARS toolbar it mirrors, not inside the scrollable pane. `problemPane` gets only
    // the two-pane grid below it.
    clear(problemPane).append(el("div", { class: "rule-panes" }, pEditor, pImpact));

    function problemMoverRow(m) {
      return el(
        "div",
        { class: "mover-row" },
        el("span", { class: "mover-row__name" }, `${m.assetName} — ${m.ruleName}`),
        el(
          "div",
          { class: "mover-row__move" },
          outcomeBadge(m.fromOutcome),
          el("span", { class: "mover-arrow", "aria-hidden": "true" }, "→"),
          outcomeBadge(m.toOutcome),
          el("span", { class: "mover-row__kind" }, m.kind === "issue" ? "toxic combination" : "config finding"),
        ),
      );
    }

    function paintProblemUnknownRates(disc) {
      clear(pUnknownList);
      clear(pUnknownWarn);
      pUnknownSection.hidden = !disc;
      if (!disc) return;
      setText(
        pLeavesLine,
        `${disc.leavesReached} of 54 leaves reached, across ${disc.decided.length} decided ` +
          `issues and findings.`,
      );
      paintUnknownRates({
        listHost: pUnknownList,
        warnHost: pUnknownWarn,
        axes: AXIS_DEFS,
        rates: disc.unknownRate,
        threshold: UNKNOWN_WARN_THRESHOLD,
        rowNoun: "rows",
      });
    }

    function paintProblemImpact() {
      const errs = problemDraftErrors(problemDraft);
      clear(pImpactState);

      if (errs.length) {
        clear(pImpactStrip);
        clear(pMoverList);
        clear(pMoverMore);
        pMoverSection.hidden = true;
        paintProblemUnknownRates(null);
        setText(pImpactHeadline, "");
        setText(pLeavesLine, "");
        pImpactState.append(emptyState("Fix the highlighted fields to preview.", errs[0]));
        return;
      }
      if (problemPreviewError) {
        clear(pImpactStrip);
        pMoverSection.hidden = true;
        paintProblemUnknownRates(null);
        setText(pImpactHeadline, "");
        setText(pLeavesLine, "");
        const retry = el("button", { style: "margin-top:10px" }, "Try again");
        retry.addEventListener("click", () => {
          problemPreviewError = "";
          scheduleProblemPreview();
          paintProblemImpact();
        });
        pImpactState.append(emptyState("Couldn't preview this rule.", problemPreviewError), retry);
        return;
      }
      if (!problemPreview) {
        pMoverSection.hidden = true;
        paintProblemUnknownRates(null);
        setText(pImpactHeadline, "");
        setText(pLeavesLine, "");
        clear(pImpactStrip).append(
          skeleton("line", { width: "80%" }), skeleton("line", { width: "60%" }));
        return;
      }
      if (!problemPreview.total) {
        clear(pImpactStrip);
        pMoverSection.hidden = true;
        paintProblemUnknownRates(null);
        setText(pImpactHeadline, "");
        setText(pLeavesLine, "");
        pImpactState.append(
          emptyState(
            "No open issue or failing finding to compare against.",
            "Run a sync first; the rule still saves and applies to the next one."));
        return;
      }

      clear(pImpactStrip);
      for (const opt of OUTCOME_OPTIONS) {
        const now = problemPreview.current[opt.value] || 0;
        const next = problemPreview.proposed[opt.value] || 0;
        const delta = next - now;
        pImpactStrip.append(
          el(
            "div", { class: "impact-row" },
            outcomeBadge(opt.value),
            el("span", { class: "impact-row__nums" }, `${now} → ${next}`),
            el(
              "span", { class: "impact-row__delta" },
              delta === 0
                ? el("span", { class: "muted" }, "—")
                : el(
                  "span", { class: delta > 0 ? "delta-up" : "delta-down" },
                  (delta > 0 ? "+" : "") + String(delta)),
            ),
          ),
        );
      }

      const headline = problemPreview.moverCount
        ? `Of ${problemPreview.total} issues and findings, ${problemPreview.moverCount} change priority.`
        : `Nothing changes across ${problemPreview.total} issues and findings.`;
      setText(pImpactHeadline, headline);
      setText(pLiveNote, `Impact updated. ${headline}`);

      paintProblemUnknownRates(problemPreview.treeDiscrimination);

      clear(pMoverList);
      clear(pMoverMore);
      pMoverSection.hidden = !problemPreview.movers.length;
      for (const m of problemPreview.movers.slice(0, PROBLEM_MOVERS_INLINE)) {
        pMoverList.append(problemMoverRow(m));
      }
      if (problemPreview.moverCount > PROBLEM_MOVERS_INLINE) {
        const more = el("button", { class: "link" }, `View all ${problemPreview.moverCount}`);
        more.addEventListener("click", () => {
          openSheet(
            (sheetBody) => {
              const list = el("div", { class: "mover-list" });
              for (const m of problemPreview.movers) list.append(problemMoverRow(m));
              sheetBody.append(list);
              if (problemPreview.truncated) {
                sheetBody.append(
                  el(
                    "p", { class: "small muted", style: "margin-top:10px" },
                    `Showing the ${problemPreview.movers.length} most consequential of ` +
                      `${problemPreview.moverCount} — worst proposed priority first.`),
                );
              }
            },
            { title: "What moves", subtitle: headline, ariaLabel: "Issues and findings that change priority" },
          );
        });
        pMoverMore.append(more);
      }
    }

    // ----------------------------------------------------------------------- lattice
    /** Light the cascade row that claims a cell, or clear. Rows are rebuilt structurally, so this re-queries. */
    function lightProblemRow(idx) {
      cascadeRows(pCascadeBody).forEach(([tr, i]) => {
        tr.classList.toggle("is-lit", idx !== null && idx !== undefined && i === idx);
      });
    }

    function paintProblemLattice() {
      pLattice.repaint();
    }

    // -------------------------------------------------------------------------- sync
    function onProblemEdit() {
      syncProblem();
      paintProblemLattice();
      scheduleProblemPreview();
    }

    function syncProblem() {
      setText(pVersionPill, problemState.version === 0 ? "Spec defaults" : `Model v${problemState.version}`);
      pStalePill.className = `pill ${problemState.stale ? "warn" : "ok"}`;
      setText(pStalePill, problemState.stale ? "Verdicts stale" : "Verdicts current");
      clear(pDirtyHost);
      if (isProblemDirty()) pDirtyHost.append(statusPill("warn", "Unsaved changes"));
      pRevertBtn.disabled = !isProblemDirty() || problemSaving;
      pSaveBtn.disabled = problemSaving;

      setValue(pCeilingInput, Math.round(problemDraft.actLeafCeiling * 1000) / 10);
      pRemediateTokens.sync(problemDraft.remediateVerdicts);
      pGroupsTokens.sync(problemDraft.totalImpactGroups);
      if (document.activeElement !== pMissionSelect) pMissionSelect.value = problemDraft.missingMission;

      // What the landscape actually carries, offered in the two pickers. It arrives with the
      // preview rather than the rule, so both lists start empty and fill in — `setOptions`
      // keeps an already-open popover usable rather than closing it under the pointer.
      const census = problemPreview && problemPreview.census;
      pRemediateTokens.setOptions(censusOptions(census && census.verdicts, "issue"));
      pGroupsTokens.setOptions(censusOptions(census && census.comboGroups, "issue"));

      // Each axis's own unknown rate, beside its own knobs. The impact pane keeps the full
      // diagnostic and its warning cards; this is the reading, and the pane it duplicates
      // can be folded away entirely.
      const axisRates = (problemPreview && problemPreview.treeDiscrimination
        && problemPreview.treeDiscrimination.unknownRate) || null;
      const decided = (problemPreview && problemPreview.treeDiscrimination
        && problemPreview.treeDiscrimination.decided) || null;
      AXIS_DEFS.forEach((axis) => {
        const block = pAxisBlocks[axis.key];
        const share = axisRates ? axisRates[axis.key] || 0 : null;
        block.paintRate(share, share !== null && share >= UNKNOWN_WARN_THRESHOLD);
        // One pass over a population the impact pane already receives — no new endpoint,
        // and the bar and the rate above it cannot disagree, because both read that array.
        block.paintReading(decided ? axisTally(decided, axis.key, axis.values) : null);
      });

      // Cascade row notes: shadowed, and how many leaves each row claims — both come from
      // the preview, which walks the DRAFT, exactly like the AARS cascade's own coverage.
      const shadowed = (problemPreview && problemPreview.shadowedOutcomeRules) || [];
      const coverage = (problemPreview && problemPreview.leafCoverage) || null;
      const rows = pCascadeBody.querySelectorAll("tr[data-idx]");
      const problemOffsets = claimOffsets((coverage && coverage.byRow) || []);
      const pOcc = problemPreview && problemPreview.treeDiscrimination
        && problemPreview.treeDiscrimination.leafOccupancy;
      const landscapeByRow = pOcc ? mirrorLeafOccupancyByRow(problemDraft, pOcc) : null;
      rows.forEach((tr, i) => {
        const meta = tr.querySelector(".rule-rowmeta");
        const isShadow = shadowed.indexOf(i) >= 0;
        // Three zeros, three claims — the vocabulary the AARS gap ladder has always used
        // and these two cascades could not, because nothing here knew what the landscape
        // put on the leaves a row claims. See decideMirror.occupancyByRow.
        const unused = !isShadow && landscapeByRow && coverage
          && (coverage.byRow[i] || 0) > 0 && landscapeByRow[i] === 0;
        tr.classList.toggle("rule-dead", isShadow);
        tr.classList.toggle("rule-unused", !!unused);
        setText(meta, isShadow
          ? "never fires — an earlier rule already claims every leaf it could match"
          : unused
            ? "in force — nothing in this tenant carries it"
            : "");
        claimRail(tr.querySelector(".rule-prices"), {
          count: coverage ? coverage.byRow[i] || 0 : null,
          total: coverage ? coverage.total : 0,
          offset: problemOffsets[i] || 0,
          unit: "leaves",
          dead: isShadow,
        });
      });
      const fbRow = pCascadeBody.querySelector("tr.rule-fallback");
      if (fbRow) {
        claimRail(fbRow.querySelector(".rule-prices"), {
          count: coverage ? coverage.byFallback : null,
          total: coverage ? coverage.total : 0,
          offset: problemOffsets[problemOffsets.length - 1] || 0,
          unit: "leaves",
        });
      }
      paintCascadeSummary(pSummary, {
        rules: problemDraft.outcomeRules.length,
        total: coverage ? coverage.total : null,
        fallback: coverage ? coverage.byFallback : 0,
        dead: shadowed.length,
        unit: "leaves",
      });

      syncProblemRecompute();
    }

    function syncProblemRecompute() {
      const want = problemState.stale ? "1" : "0";
      if (pRecomputeHost.dataset.sig === want) return;
      pRecomputeHost.dataset.sig = want;
      clear(pRecomputeHost);
      if (!problemState.stale) return;
      const btn = el("button", {}, "Recompute verdicts");
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Recompute every problem verdict?",
          body:
            "Re-decides every open issue and failing finding under the saved rule and " +
            "rewrites the issues and findings tabs. No sync-history row is written, so " +
            "the outcome trend is left alone.",
          confirmLabel: "Recompute",
        });
        if (!ok) return;
        btn.disabled = true;
        setText(btn, "Recomputing…");
        try {
          const fresh = await call("api_recomputeProblems", {});
          problemState = { ...problemState, ...fresh };
          problemSaved = cloneRule(problemState.rule);
          toast(`Redecided ${fresh.issueCount + fresh.findingCount} issues and findings.`);
          syncProblem();
          scheduleProblemPreview();
          ctx.refresh();
        } catch (e) {
          toast(String(e.message || e), "error");
          btn.disabled = false;
          setText(btn, "Recompute verdicts");
        }
      });
      pRecomputeHost.append(btn);
    }

    // ----------------------------------------------------------------------- preview
    const scheduleProblemPreviewRun = debounce(() => runProblemPreview(), PREVIEW_DEBOUNCE_MS);
    function scheduleProblemPreview() {
      scheduleProblemPreviewRun.cancel();
      if (problemDraftErrors(problemDraft).length) {
        problemPreview = null;
        problemPreviewError = "";
        pImpact.classList.remove("updating");
        paintProblemImpact();
        return;
      }
      pImpact.classList.add("updating");
      pLattice.setUpdating(true);
      scheduleProblemPreviewRun();
    }

    async function runProblemPreview() {
      const seq = ++problemPreviewSeq;
      // The rule as it stood when the request left, for pLattice.reconcile — see its
      // own comment for why comparing against the live draft would report races as bugs.
      const sentDraft = cloneRule(problemDraft);
      try {
        const data = await call("api_previewProblemRule", { rule: sentDraft });
        if (seq !== problemPreviewSeq) return;
        problemPreview = data;
        problemPreviewError = "";
        pLattice.reconcile(sentDraft, data && data.leafCoverage);
        paintProblemLattice(); // landscape occupancy only exists once a preview has landed
      } catch (e) {
        if (seq !== problemPreviewSeq) return;
        problemPreview = null;
        problemPreviewError = String(e.message || e);
      }
      pImpact.classList.remove("updating");
      pLattice.setUpdating(false);
      paintProblemImpact();
      syncProblem(); // row notes and leaf counts come from the preview
    }

    // -------------------------------------------------------------------------- save
    pRevertBtn.addEventListener("click", () => {
      problemDraft = cloneRule(problemSaved);
      renderProblemCascade();
      renderExploitationRows();
      onProblemEdit();
    });

    pSaveBtn.addEventListener("click", async () => {
      const errs = problemDraftErrors(problemDraft);
      if (errs.length) {
        toast(errs[0], "warn");
        return;
      }
      problemSaving = true;
      syncProblem();
      try {
        const fresh = await call("api_setProblemRule", { rule: problemDraft });
        problemState = fresh;
        problemSaved = cloneRule(fresh.rule);
        problemDraft = cloneRule(fresh.rule);
        toast("Problem tree rule saved.");
        renderProblemCascade();
        renderExploitationRows();
        problemSaving = false;
        onProblemEdit();
        ctx.refresh();
      } catch (e) {
        problemSaving = false;
        syncProblem();
        toast(String(e.message || e), "error");
      }
    });

    // --------------------------------------------------------------------- first paint
    renderProblemCascade();
    renderExploitationRows();
    syncProblem();
    paintProblemLattice();
    paintProblemImpact();
    scheduleProblemPreview();
  }

  // ============================================================================
  // Posture — Phase 6. Same rule 1 as the AARS and Problem-tree panes: the client NEVER
  // decides. Every outcome shown below — the tier occupancy strip, the movers, the cell
  // counts, the per-axis unknown rates — comes from api_previewPostureRule, which runs the
  // real cascade server-side (syncStore.posturesWith) at zero Wiz cost. Nothing here calls
  // decidePosture or reimplements first-match-wins.
  //
  // Deliberately a SMALLER editor than the Problem tree's: posture derivation reads only
  // the node's own already-persisted fields (see posture.ts's derivePostureInput comment —
  // `rule` is accepted but unread), so there is no derivation-knobs section here the way
  // the Problem tab has one for missingMission / remediateVerdicts / totalImpactGroups.
  // Only the cascade itself and its two validation-only knobs (fallback tier, top-tier
  // ceiling) are editable.

  const POSTURE_AXIS_DEFS = [
    { key: "capability", label: "Capability", values: ["BROAD", "SCOPED", "MINIMAL"] },
    { key: "containment", label: "Containment", values: ["WEAK", "PARTIAL", "STRONG"] },
    { key: "consequence", label: "Consequence", values: ["SEVERE", "MODERATE", "LIMITED"] },
  ];
  // Every key a `when` can carry — the three axes plus the three lethal-trifecta legs. The
  // editor never writes the trifecta legs itself (see DEFAULT_POSTURE_RULE row 0's own
  // comment for why that stays true even for a hand-added row), but a loaded rule can carry
  // them, and the empty/duplicate `when` checks below must see the whole shape or a
  // trifecta-only row would misread as empty.
  const POSTURE_WHEN_KEYS = [
    "capability", "containment", "consequence", "privateData", "untrustedIngress", "externalEgress",
  ];
  // Same derivation as OUTCOME_OPTIONS above — TIER_VALUES (src/domain/posture.ts) and
  // tierLabel() — reversed, because TIER_VALUES ascends and every control on this page leads
  // with the worst end of the scale.
  const TIER_OPTIONS = [...TIER_VALUES].reverse().map((t) => ({ value: String(t), label: tierLabel(t) }));
  const POSTURE_AXIS_LABELS = { capability: "Capability", containment: "Containment", consequence: "Consequence" };
  const POSTURE_UNKNOWN_WARN_THRESHOLD = 0.5;
  const POSTURE_MOVERS_INLINE = 8;

  let postureState = null;
  let postureSaved = null;
  let postureDraft = null;
  let posturePreview = null;
  let posturePreviewError = "";
  let posturePreviewSeq = 0;
  let postureSaving = false;
  let postureLoading = false;
  let postureLoaded = false;

  function isPostureDirty() {
    return postureLoaded && JSON.stringify(postureDraft) !== JSON.stringify(postureSaved);
  }

  /**
   * The cheap structural checks only — no cell enumeration, which would mean re-running
   * the cascade client-side. The top-tier-ceiling check (validatePostureRule's other half)
   * stays server-only, same contract `problemDraftErrors` keeps for the tree.
   */
  function postureDraftErrors(rule) {
    const max = (postureState && postureState.limits && postureState.limits.maxTierRules) || 40;
    const list = [];
    if (!rule.tierRules.length) {
      list.push("The tier cascade has no rules; every asset would route to the fallback tier.");
    }
    if (rule.tierRules.length > max) list.push(`The tier cascade is limited to ${max} rules.`);
    rule.tierRules.forEach((row, i) => {
      const empty = POSTURE_WHEN_KEYS.every((k) => row.when[k] === undefined);
      if (empty && i !== rule.tierRules.length - 1) {
        list.push(`Tier rule ${i + 1} has no conditions, so it swallows every rule after it.`);
      }
    });
    return list;
  }

  async function loadPosturePane() {
    if (postureLoaded || postureLoading) return;
    postureLoading = true;
    posturePane.append(
      el(
        "div",
        {
          role: "status",
          "aria-label": "Loading the posture rule",
          style: "position:absolute; inset:20px; display:flex; flex-direction:column; gap:14px",
        },
        skeleton("title", { width: "220px" }),
        skeleton("chart", { height: "120px" }),
        skeleton("line", { width: "70%" }),
      ),
    );
    try {
      postureState = await call("api_getPostureRule", {});
    } catch (e) {
      clear(posturePane).append(
        el(
          "div",
          { class: "workbench-empty" },
          emptyState("Couldn't load the Posture rule.", String(e.message || e)),
        ),
      );
      postureLoading = false;
      return;
    }
    postureLoading = false;
    postureSaved = cloneRule(postureState.rule);
    postureDraft = cloneRule(postureState.rule);
    postureLoaded = true;
    buildPosturePane();
  }

  function buildPosturePane() {
    // ---------------------------------------------------------------------- toolbar
    const uVersionPill = el("span", { class: "pill neutral" });
    const uStalePill = el("span", { class: "pill" });
    const uDirtyHost = el("span", {});
    const uSaveBtn = el("button", { class: "primary" }, "Save rule");
    const uRevertBtn = el("button", {}, "Revert");
    const uRecomputeHost = el("span", {});
    postureControls = el(
      "div",
      { class: "workbench-controls" },
      el("div", { class: "rule-bar-state" }, uVersionPill, uStalePill, uDirtyHost),
      uRecomputeHost,
      uRevertBtn,
      uSaveBtn,
    );
    postureControls.hidden = activeModelTab !== "posture";
    bar.append(postureControls);

    // ---------------------------------------------------------------- cascade (editor)
    const uCascadeBody = el("tbody", {});
    const uClaimsTh = el("th", { class: "rule-prices" }, "Cells");
    const uSummary = el("p", { class: "rule-summary" });
    const uCascadeTable = el(
      "div",
      { class: "table-wrap table-wrap--cascade" },
      el(
        "table",
        { class: "data rule-table" },
        el("caption", { class: "visually-hidden" }, "Posture tier rules, tried in order"),
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "#"),
            uClaimsTh,
            ...POSTURE_AXIS_DEFS.map((a) => el("th", {}, a.label)),
            el("th", {}, "Tier"),
            el("th", { class: "rule-noteh" }, "Note"),
            el("th", {}, el("span", { class: "visually-hidden" }, "Actions")),
          ),
        ),
        uCascadeBody,
      ),
    );

    // Wired ONCE on the body, like the other two cascades — see ui/rowReorder.js.
    onPageTeardown(rowDrag(uCascadeBody, (from, to) => {
      const moved = postureDraft.tierRules.splice(from, 1)[0];
      postureDraft.tierRules.splice(to, 0, moved);
      renderPostureCascade();
      focusPostureRow(to);
      onPostureEdit();
    }));

    const uAddBtn = el("button", {}, "Add rule");
    uAddBtn.addEventListener("click", () => {
      // New rules go on TOP — a first-match cascade, same reasoning as the other two.
      postureDraft.tierRules.unshift({ when: {}, tier: 2 });
      renderPostureCascade();
      focusPostureRow(0);
      onPostureEdit();
    });

    function focusPostureRow(i) {
      const tr = uCascadeBody.querySelector(`tr[data-idx="${i}"]`);
      const sel = tr && tr.querySelector("select");
      if (sel) sel.focus();
    }

    function renderPostureCascade() {
      uLattice.close();
      clear(uCascadeBody);
      const max = (postureState.limits && postureState.limits.maxTierRules) || 40;
      postureDraft.tierRules.forEach((row, i) => {
        const axisCells = POSTURE_AXIS_DEFS.map((axis) => {
          const sel = select({
            options: axis.values,
            value: row.when[axis.key] || "",
            ariaLabel: `${axis.label}, rule ${i + 1}`,
            placeholder: "any",
            onChange: (v) => {
              if (v) row.when[axis.key] = v;
              else delete row.when[axis.key];
              markAny(sel);
              onPostureEdit();
            },
          });
          markAny(sel);
          return el("td", {}, sel);
        });
        const tierSel = select({
          options: TIER_OPTIONS,
          value: String(row.tier),
          ariaLabel: `Tier, rule ${i + 1}`,
          onChange: (v) => {
            row.tier = Number(v);
            tierCell.paint(Number(v));
            onPostureEdit();
          },
        });
        const tierCell = verdictSelect(tierSel);
        tierCell.paint(row.tier);

        const move = (delta) => {
          const to = i + delta;
          if (to < 0 || to >= postureDraft.tierRules.length) return;
          const other = postureDraft.tierRules[to];
          postureDraft.tierRules[to] = row;
          postureDraft.tierRules[i] = other;
          renderPostureCascade();
          const moved = uCascadeBody.querySelector(`tr[data-idx="${to}"]`);
          const btn = moved && moved.querySelector(delta < 0 ? ".js-up" : ".js-down");
          if (btn) btn.focus();
          onPostureEdit();
        };
        const up = el("button", { class: "link js-up", "aria-label": `Move rule ${i + 1} up` }, "↑");
        up.disabled = i === 0;
        up.addEventListener("click", () => move(-1));
        const down = el(
          "button", { class: "link js-down", "aria-label": `Move rule ${i + 1} down` }, "↓");
        down.disabled = i === postureDraft.tierRules.length - 1;
        down.addEventListener("click", () => move(1));
        const del = el("button", { class: "link danger", "aria-label": `Remove rule ${i + 1}` }, "✕");
        del.addEventListener("click", () => {
          postureDraft.tierRules.splice(i, 1);
          renderPostureCascade();
          const rows = uCascadeBody.querySelectorAll("tr[data-idx]");
          const next = rows[Math.min(i, rows.length - 1)];
          const btn = next && next.querySelector(".link.danger");
          (btn || uAddBtn).focus();
          onPostureEdit();
        });

        // A `when` can carry the three lethal-trifecta legs, and POSTURE_AXIS_DEFS renders
        // none of them — so DEFAULT_POSTURE_RULE's first row shows "any / any / any → Tier
        // 4" and reads as a rule that swallows the whole table, when in fact it matches on
        // signals that sit off the 27 cells entirely and can never fire. The legs are drawn
        // here as read-only chips, dashed like the wildcard two columns over because the
        // border style means the same thing in both places: not a value you set here. The
        // editor still never WRITES them (see DEFAULT_POSTURE_RULE row 0's own comment).
        // The note goes in a span of its own rather than straight into the cell: this is the
        // one cascade whose meta cell has permanent children, and setText on the `td` would
        // take the chips with it.
        const meta = el(
          "td", { class: "rule-rowmeta small muted" },
          ...postureLegChips(row.when), el("span", { class: "rule-rownote" }),
        );
        const claims = el("td", { class: "rule-prices num" });
        const tr = el(
          "tr",
          { "data-idx": String(i) },
          idxCell(i),
          claims,
          ...axisCells,
          el("td", {}, tierCell),
          meta,
          el("td", { class: "rule-rowbtns" }, up, down, del),
        );
        // The register drives the picture, and focus counts as much as hover — the rule
        // scans.js's provenance diagram keeps, so a keyboard user gets the same link.
        const lightCells = () => uLattice.light(i);
        const dimCells = () => uLattice.light(null);
        tr.addEventListener("mouseenter", lightCells);
        tr.addEventListener("mouseleave", dimCells);
        tr.addEventListener("focusin", lightCells);
        tr.addEventListener("focusout", dimCells);

        uCascadeBody.append(tr);
      });

      // The cascade's terminal step, drawn as the table's last row — same idiom as the
      // other two cascades' fallback rows.
      const fbSel = select({
        options: TIER_OPTIONS,
        value: String(postureDraft.fallbackTier),
        ariaLabel: "Fallback tier",
        onChange: (v) => {
          postureDraft.fallbackTier = Number(v);
          fbCell.paint(Number(v));
          onPostureEdit();
        },
      });
      const fbCell = verdictSelect(fbSel);
      fbCell.paint(postureDraft.fallbackTier);
      const fbTr = el(
        "tr",
        { class: "rule-fallback" },
        el("td", { class: "num muted small", "aria-hidden": "true" }, "↳"),
        el("td", { class: "rule-prices num" }),
        el("td", { colspan: String(POSTURE_AXIS_DEFS.length) }, "Matches no rule above"),
        el("td", {}, fbCell),
        el("td", { class: "rule-rowmeta small muted" }, "the lattice's fallback tier"),
        el("td", {}),
      );
      // Same link the problem cascade's fallback gets, and it matters here even though this
      // draft leaves the fallback claiming nothing: a row that claims nothing today is one
      // edit away from claiming cells, and a link that only appears once it does is a link
      // nobody discovers.
      const fbLight = () => uLattice.light(-1);
      const fbDim = () => uLattice.light(null);
      fbTr.addEventListener("mouseenter", fbLight);
      fbTr.addEventListener("mouseleave", fbDim);
      fbTr.addEventListener("focusin", fbLight);
      fbTr.addEventListener("focusout", fbDim);
      uCascadeBody.append(fbTr);

      uAddBtn.disabled = postureDraft.tierRules.length >= max;
      uAddBtn.title = uAddBtn.disabled ? `The cascade is limited to ${max} rules.` : "";
    }

    // -------------------------------------------------------- validation-only knob (editor)
    const uCeilingId = nextId("uceil");
    const uCeilingInput = numberInput(uCeilingId, {
      value: Math.round(postureDraft.topTierCeiling * 1000) / 10, min: 0.1, max: 100, step: 0.1,
    });
    uCeilingInput.addEventListener("input", () => {
      const pct = num(uCeilingInput.value, postureDraft.topTierCeiling * 100);
      postureDraft.topTierCeiling = clamp(pct, 0.1, 100) / 100;
      onPostureEdit();
    });
    const uCeilingField = {
      ...field(uCeilingId, "Tier 4 ceiling", uCeilingInput, "% of the 27 cells"),
      input: uCeilingInput,
    };

    // ------------------------------------------------------------------ the lattice hero
    // The same component the Problem tree mounts, with a spec and a vocabulary. If this
    // block ever needs painter code of its own, ui/latticeSection.js is the thing to fix.
    const uLattice = latticeSection({
      spec: POSTURE_LATTICE,
      kind: "posture",
      unit: "cells",
      unitOne: "cell",
      decide: (v) => mirrorDecidePosture(v, postureDraft),
      decideSaved: (v) => mirrorDecidePosture(v, postureSaved),
      coverageOf: (rule) => mirrorCellCoverage(rule),
      getRule: () => postureDraft,
      getRules: () => postureDraft.tierRules,
      getCeiling: () => postureDraft.topTierCeiling,
      getRuleCap: () => (postureState && postureState.limits && postureState.limits.maxTierRules) || 40,
      getOccupancy: () => {
        const disc = posturePreview && posturePreview.postureDiscrimination;
        return { known: !!disc, map: (disc && disc.cellOccupancy) || {} };
      },
      whenWords: (row) => {
        if (!row) return "no condition";
        const parts = POSTURE_AXIS_DEFS
          .filter((a) => row.when[a.key] !== undefined)
          .map((a) => `${a.label.toLowerCase()} ${row.when[a.key]}`);
        // The lethal-trifecta row names none of the three lattice axes — it names legs that
        // sit OFF the 27 cells entirely, which is exactly why it can never fire.
        const legs = ["privateData", "untrustedIngress", "externalEgress"]
          .filter((k) => row.when[k] !== undefined);
        if (!parts.length && legs.length) return `${legs.length} off-lattice signals nothing populates`;
        return parts.length ? parts.join(", ") : "no condition, so it matches everything left";
      },
      onRowLight: (idx) => lightPostureRow(idx),
      onTrace: (idx) => markTracedRows(uCascadeBody, idx),
      onAddRule: (when, tier) => {
        // New rows go on TOP — a first-match cascade, same reasoning as the other two.
        postureDraft.tierRules.unshift({ when, tier });
        renderPostureCascade();
        focusPostureRow(0);
        onPostureEdit();
      },
    });
    closePostureLatticePop = uLattice.close;
    onPageTeardown(uLattice.close);

    /** Light the cascade row that claims a cell, or clear. Rows are rebuilt structurally, so this re-queries. */
    function lightPostureRow(idx) {
      cascadeRows(uCascadeBody).forEach(([tr, i]) => {
        tr.classList.toggle("is-lit", idx !== null && idx !== undefined && i === idx);
      });
    }

    const uEditor = el(
      "div",
      { class: "rule-editor" },
      uLattice.node,
      section(
        "Tier cascade",
        "Each row is tried in order; the first whose conditions ALL match wins. An axis " +
          "left on “any” is a wildcard, not a value — a row with no conditions at all " +
          "matches every remaining vector. A capability envelope, not an aggregate of open " +
          "issues: nothing here reads a problem verdict.",
        [uSummary, uCascadeTable, el("div", { class: "rule-row", style: "margin-top:10px" }, uAddBtn)],
      ),
      section(
        "Validation only",
        "Moving this never changes which tier a vector receives — only whether the cascade " +
          "as a whole still validates.",
        [el("div", { class: "rule-row" }, uCeilingField.node)],
      ),
    );

    // ---------------------------------------------------------------- impact (preview)
    const uImpactStrip = el("div", { class: "impact-strip" });
    const uImpactHeadline = el("p", { class: "impact-headline small muted" });
    const uCellsLine = el("p", { class: "small muted", style: "margin:0 0 12px" });
    const uImpactState = el("div", {});
    const uLiveNote = el("span", { role: "status", "aria-live": "polite", class: "visually-hidden" });

    const uUnknownList = el("div", { class: "diag-list" });
    const uUnknownWarn = el("div", {});
    const uUnknownSection = el(
      "div",
      {},
      el("h2", { class: "section-label", style: "margin-top:18px" }, "Per-axis unknown rate"),
      el(
        "p", { class: "small muted", style: "margin:0 0 6px" },
        "How often each axis could not be established, over the assets this draft actually " +
          "tiered. A high rate here — not the tier counts above — is usually the real finding."),
      uUnknownList,
      uUnknownWarn,
    );

    const uMoverList = el("div", { class: "mover-list" });
    const uMoverMore = el("div", { style: "margin-top:8px" });
    const uMoverSection = el(
      "div", {},
      el("h2", { class: "section-label", style: "margin-top:18px" }, "What moves"),
      uMoverList, uMoverMore,
    );

    const uImpact = el(
      "div",
      { class: "rule-impact" },
      uLiveNote,
      el("h2", { class: "section-label" }, "Impact on the persisted landscape"),
      registerWideNote(bootstrapCached(),
        "a rule preview has to answer for every asset it would rescore"),
      uImpactState,
      uImpactStrip,
      uImpactHeadline,
      uCellsLine,
      uUnknownSection,
      uMoverSection,
    );

    // postureControls lives in `bar`, appended above — the toolbar's own home is next to
    // the other two toolbars it mirrors, not inside the scrollable pane. `posturePane`
    // gets only the two-pane grid below it.
    clear(posturePane).append(el("div", { class: "rule-panes" }, uEditor, uImpact));

    function postureMoverRow(m) {
      return el(
        "div",
        { class: "mover-row" },
        el("span", { class: "mover-row__name" }, `${m.name} — ${m.kind}`),
        el(
          "div",
          { class: "mover-row__move" },
          tierBadge(m.fromTier),
          el("span", { class: "mover-arrow", "aria-hidden": "true" }, "→"),
          tierBadge(m.toTier),
        ),
      );
    }

    function paintPostureUnknownRates(disc) {
      clear(uUnknownList);
      clear(uUnknownWarn);
      uUnknownSection.hidden = !disc;
      if (!disc) return;
      setText(
        uCellsLine,
        `${disc.cellsReached} of 27 cells reached, across ${disc.decided.length} tiered assets.`,
      );
      paintUnknownRates({
        listHost: uUnknownList,
        warnHost: uUnknownWarn,
        axes: POSTURE_AXIS_DEFS,
        rates: disc.unknownRate,
        threshold: POSTURE_UNKNOWN_WARN_THRESHOLD,
        rowNoun: "tiered assets",
      });
    }

    function paintPostureImpact() {
      const errs = postureDraftErrors(postureDraft);
      clear(uImpactState);

      if (errs.length) {
        clear(uImpactStrip);
        clear(uMoverList);
        clear(uMoverMore);
        uMoverSection.hidden = true;
        paintPostureUnknownRates(null);
        setText(uImpactHeadline, "");
        setText(uCellsLine, "");
        uImpactState.append(emptyState("Fix the highlighted fields to preview.", errs[0]));
        return;
      }
      if (posturePreviewError) {
        clear(uImpactStrip);
        uMoverSection.hidden = true;
        paintPostureUnknownRates(null);
        setText(uImpactHeadline, "");
        setText(uCellsLine, "");
        const retry = el("button", { style: "margin-top:10px" }, "Try again");
        retry.addEventListener("click", () => {
          posturePreviewError = "";
          schedulePosturePreview();
          paintPostureImpact();
        });
        uImpactState.append(emptyState("Couldn't preview this rule.", posturePreviewError), retry);
        return;
      }
      if (!posturePreview) {
        uMoverSection.hidden = true;
        paintPostureUnknownRates(null);
        setText(uImpactHeadline, "");
        setText(uCellsLine, "");
        clear(uImpactStrip).append(
          skeleton("line", { width: "80%" }), skeleton("line", { width: "60%" }));
        return;
      }
      if (!posturePreview.total) {
        clear(uImpactStrip);
        uMoverSection.hidden = true;
        paintPostureUnknownRates(null);
        setText(uImpactHeadline, "");
        setText(uCellsLine, "");
        uImpactState.append(
          emptyState(
            "No persisted asset to compare against.",
            "Run a sync first; the rule still saves and applies to the next one."));
        return;
      }

      clear(uImpactStrip);
      for (const opt of TIER_OPTIONS) {
        const now = posturePreview.current[Number(opt.value)] || 0;
        const next = posturePreview.proposed[Number(opt.value)] || 0;
        const delta = next - now;
        uImpactStrip.append(
          el(
            "div", { class: "impact-row" },
            tierBadge(Number(opt.value)),
            el("span", { class: "impact-row__nums" }, `${now} → ${next}`),
            el(
              "span", { class: "impact-row__delta" },
              delta === 0
                ? el("span", { class: "muted" }, "—")
                : el(
                  "span", { class: delta > 0 ? "delta-up" : "delta-down" },
                  (delta > 0 ? "+" : "") + String(delta)),
            ),
          ),
        );
      }

      const headline = posturePreview.moverCount
        ? `Of ${posturePreview.total} assets, ${posturePreview.moverCount} change tier.`
        : `Nothing changes across ${posturePreview.total} assets.`;
      setText(uImpactHeadline, headline);
      setText(uLiveNote, `Impact updated. ${headline}`);

      paintPostureUnknownRates(posturePreview.postureDiscrimination);

      clear(uMoverList);
      clear(uMoverMore);
      uMoverSection.hidden = !posturePreview.movers.length;
      for (const m of posturePreview.movers.slice(0, POSTURE_MOVERS_INLINE)) {
        uMoverList.append(postureMoverRow(m));
      }
      if (posturePreview.moverCount > POSTURE_MOVERS_INLINE) {
        const more = el("button", { class: "link" }, `View all ${posturePreview.moverCount}`);
        more.addEventListener("click", () => {
          openSheet(
            (sheetBody) => {
              const list = el("div", { class: "mover-list" });
              for (const m of posturePreview.movers) list.append(postureMoverRow(m));
              sheetBody.append(list);
              if (posturePreview.truncated) {
                sheetBody.append(
                  el(
                    "p", { class: "small muted", style: "margin-top:10px" },
                    `Showing the ${posturePreview.movers.length} most consequential of ` +
                      `${posturePreview.moverCount} — worst proposed tier first.`),
                );
              }
            },
            { title: "What moves", subtitle: headline, ariaLabel: "Assets that change tier" },
          );
        });
        uMoverMore.append(more);
      }
    }

    // -------------------------------------------------------------------------- sync
    function onPostureEdit() {
      syncPosture();
      uLattice.repaint();
      schedulePosturePreview();
    }

    function syncPosture() {
      setText(uVersionPill, postureState.version === 0 ? "Spec defaults" : `Model v${postureState.version}`);
      uStalePill.className = `pill ${postureState.stale ? "warn" : "ok"}`;
      setText(uStalePill, postureState.stale ? "Tiers stale" : "Tiers current");
      clear(uDirtyHost);
      if (isPostureDirty()) uDirtyHost.append(statusPill("warn", "Unsaved changes"));
      uRevertBtn.disabled = !isPostureDirty() || postureSaving;
      uSaveBtn.disabled = postureSaving;

      setValue(uCeilingInput, Math.round(postureDraft.topTierCeiling * 1000) / 10);

      // Cascade row notes: shadowed or unreachable, and how many cells each row claims —
      // both come from the preview, which walks the DRAFT, exactly like the other two
      // cascades' own coverage.
      const shadowed = (posturePreview && posturePreview.shadowed) || [];
      const unreachable = (posturePreview && posturePreview.unreachable) || [];
      const coverage = (posturePreview && posturePreview.cellCoverage) || null;
      const rows = uCascadeBody.querySelectorAll("tr[data-idx]");
      // Cumulative starts, so the column reads as the 27 cells being consumed in cascade order.
      const postureOffsets = claimOffsets((coverage && coverage.byRow) || []);
      const uOcc = posturePreview && posturePreview.postureDiscrimination
        && posturePreview.postureDiscrimination.cellOccupancy;
      const uLandscapeByRow = uOcc ? mirrorCellOccupancyByRow(postureDraft, uOcc) : null;
      rows.forEach((tr, i) => {
        const meta = tr.querySelector(".rule-rowmeta");
        const isShadow = shadowed.indexOf(i) >= 0;
        const isUnreachable = !isShadow && unreachable.indexOf(i) >= 0;
        tr.classList.toggle("rule-dead", isShadow || isUnreachable);
        const unused = !isShadow && !isUnreachable && uLandscapeByRow && coverage
          && (coverage.byRow[i] || 0) > 0 && uLandscapeByRow[i] === 0;
        tr.classList.toggle("rule-unused", !!unused);
        setText(
          meta.querySelector(".rule-rownote"),
          isShadow
            ? "never fires — an earlier rule already claims every cell it could match"
            : isUnreachable
              ? "never fires — names something no live signal can produce (see this rule's own header)"
              : unused
                ? "in force — nothing in this tenant carries it"
                : "",
        );
        claimRail(tr.querySelector(".rule-prices"), {
          count: coverage ? coverage.byRow[i] || 0 : null,
          total: coverage ? coverage.total : 0,
          offset: postureOffsets[i] || 0,
          unit: "cells",
          dead: isShadow || isUnreachable,
        });
      });
      const fbRow = uCascadeBody.querySelector("tr.rule-fallback");
      if (fbRow) {
        claimRail(fbRow.querySelector(".rule-prices"), {
          count: coverage ? coverage.byFallback : null,
          total: coverage ? coverage.total : 0,
          offset: postureOffsets[postureOffsets.length - 1] || 0,
          unit: "cells",
        });
      }
      paintCascadeSummary(uSummary, {
        rules: postureDraft.tierRules.length,
        total: coverage ? coverage.total : null,
        fallback: coverage ? coverage.byFallback : 0,
        dead: shadowed.length + unreachable.length,
        unit: "cells",
      });

      syncPostureRecompute();
    }

    function syncPostureRecompute() {
      const want = postureState.stale ? "1" : "0";
      if (uRecomputeHost.dataset.sig === want) return;
      uRecomputeHost.dataset.sig = want;
      clear(uRecomputeHost);
      if (!postureState.stale) return;
      const btn = el("button", {}, "Recompute tiers");
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Recompute every posture tier?",
          body:
            "Re-tiers every persisted asset under the saved rule and rewrites the assets " +
            "tab. No sync-history row is written, so no trend is affected.",
          confirmLabel: "Recompute",
        });
        if (!ok) return;
        btn.disabled = true;
        setText(btn, "Recomputing…");
        try {
          const fresh = await call("api_recomputePostures", {});
          postureState = { ...postureState, ...fresh };
          postureSaved = cloneRule(postureState.rule);
          toast(`Retiered ${fresh.assetCount} assets.`);
          syncPosture();
          schedulePosturePreview();
          ctx.refresh();
        } catch (e) {
          toast(String(e.message || e), "error");
          btn.disabled = false;
          setText(btn, "Recompute tiers");
        }
      });
      uRecomputeHost.append(btn);
    }

    // ----------------------------------------------------------------------- preview
    const schedulePosturePreviewRun = debounce(() => runPosturePreview(), PREVIEW_DEBOUNCE_MS);
    function schedulePosturePreview() {
      schedulePosturePreviewRun.cancel();
      if (postureDraftErrors(postureDraft).length) {
        posturePreview = null;
        posturePreviewError = "";
        uImpact.classList.remove("updating");
        paintPostureImpact();
        return;
      }
      uImpact.classList.add("updating");
      uLattice.setUpdating(true);
      schedulePosturePreviewRun();
    }

    async function runPosturePreview() {
      const seq = ++posturePreviewSeq;
      // The rule as it stood when the request left — see uLattice.reconcile for why
      // comparing against the live draft would report a debounce race as a disagreement.
      const sentDraft = cloneRule(postureDraft);
      try {
        const data = await call("api_previewPostureRule", { rule: sentDraft });
        if (seq !== posturePreviewSeq) return;
        posturePreview = data;
        posturePreviewError = "";
        uLattice.reconcile(sentDraft, data && data.cellCoverage);
        uLattice.repaint(); // landscape occupancy only exists once a preview has landed
      } catch (e) {
        if (seq !== posturePreviewSeq) return;
        posturePreview = null;
        posturePreviewError = String(e.message || e);
      }
      uImpact.classList.remove("updating");
      uLattice.setUpdating(false);
      paintPostureImpact();
      syncPosture(); // row notes and cell counts come from the preview
    }

    // -------------------------------------------------------------------------- save
    uRevertBtn.addEventListener("click", () => {
      postureDraft = cloneRule(postureSaved);
      renderPostureCascade();
      onPostureEdit();
    });

    uSaveBtn.addEventListener("click", async () => {
      const errs = postureDraftErrors(postureDraft);
      if (errs.length) {
        toast(errs[0], "warn");
        return;
      }
      postureSaving = true;
      syncPosture();
      try {
        const fresh = await call("api_setPostureRule", { rule: postureDraft });
        postureState = fresh;
        postureSaved = cloneRule(fresh.rule);
        postureDraft = cloneRule(fresh.rule);
        toast("Posture rule saved.");
        renderPostureCascade();
        postureSaving = false;
        onPostureEdit();
        ctx.refresh();
      } catch (e) {
        postureSaving = false;
        syncPosture();
        toast(String(e.message || e), "error");
      }
    });

    // --------------------------------------------------------------------- first paint
    renderPostureCascade();
    syncPosture();
    uLattice.repaint();
    paintPostureImpact();
    schedulePosturePreview();
  }

  // --------------------------------------------------------------------- first paint
  renderCascade();
  sync();
  paintImpact();
  schedulePreview();
}
