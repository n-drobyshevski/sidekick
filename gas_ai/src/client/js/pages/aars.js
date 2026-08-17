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
  openSheet,
  outcomeBadge,
  pointRail,
  railScale,
  segmented,
  select,
  sevBadge,
  sheetSection,
  skeleton,
  statusPill,
  toast,
} from "../ui.js";
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
/** Codes offered as one-tap chips in the sandbox, taken from what the estate actually has. */
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

export async function renderAarsRules(main, _params, ctx) {
  // ------------------------------------------------------------------ shell + load
  const bar = el("div", { class: "workbench-bar" });
  const body = el("div", { class: "workbench-body" });
  const root = el("div", { class: "workbench" }, bar, body);
  main.append(root);

  // Two tabs over one route (help.js's ROUTE_TITLES / ROUTE_ICONS still name "aars"
  // alone): the AARS point score this file has always edited, and the Problem tree —
  // Phase 3/4's decision cascade — added here as a SECOND workbench sharing the page
  // rather than a new route. `aarsPane` and `problemPane` are both mounted from the
  // start; only `hidden` moves, so switching tabs never re-fetches or re-builds a pane
  // that has already loaded. Each is `.tab-pane` (position:absolute; inset:0) rather than
  // a second `.workbench-body` — `body` is already the positioned ancestor both tabs
  // share, and stacking two `flex:1` boxes inside a plain block parent would collapse
  // them to zero height instead of filling it.
  const aarsPane = el("div", { class: "tab-pane" });
  const problemPane = el("div", { class: "tab-pane", hidden: true });
  body.append(aarsPane, problemPane);

  const modelTabs = segmented({
    options: [{ value: "aars", label: "AARS" }, { value: "problem", label: "Problem tree" }],
    value: "aars",
    ariaLabel: "Scoring model",
    onChange: (v) => selectModelTab(v),
  });
  bar.append(el("h1", { class: "workbench-title" }, "AARS Rules"), modelTabs);

  // Assigned once the AARS rule loads (below) and once the Problem tab has loaded at
  // least once — `let`, not `const`, so this closure can reach them however far either
  // load has gotten, including "never" if the AARS rule itself failed to load.
  let aarsControls = null;
  let problemControls = null;
  let activeModelTab = "aars"; // which tab is showing, so an async load can't unhide the wrong one

  function selectModelTab(which) {
    activeModelTab = which;
    const isAars = which === "aars";
    aarsPane.hidden = !isAars;
    problemPane.hidden = isAars;
    if (aarsControls) aarsControls.hidden = !isAars;
    if (problemControls) problemControls.hidden = isAars;
    modelTabs.set(which);
    if (!isAars) loadProblemPane();
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
  // Hidden until the first preview lands, because the count it carries comes from the
  // inventory rather than from the rule. A column of empty cells would read as "nothing
  // matches" rather than "not measured yet".
  const pricesTh = el("th", { class: "rule-prices", hidden: true }, "Prices");
  const cascadeTable = el(
    "div",
    { class: "table-wrap" },
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
          el("th", {}, "When the code"),
          el("th", {}, "Code"),
          el("th", {}, "Points"),
          pricesTh,
          el("th", { class: "rule-noteh" }, "Note"),
          el("th", {}, el("span", { class: "visually-hidden" }, "Actions")),
        ),
      ),
      cascadeBody,
    ),
  );

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
  const fbCount = el("td", { class: "rule-prices num", hidden: true });
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
          "estate, so every data-related point carries the same uplift regardless of asset.",
      ],
      { label: "About the 5Rs amplifier", term: "pillar-c" },
    ),
  );

  editor.append(
    section(
      "Pillar C — data exposure",
      "The amplifier is a systemic signal, not a per-asset one: the 5Rs framework sits at " +
        "53% across the estate, so every data-related point carries the same uplift.",
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
      el("div", { class: "rule-row" }, resetBtn, v2Btn, exportBtn, importBtn, importInput),
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

  // How well the draft SEPARATES the estate. The band strip above cannot show this: a
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

  /**
   * How many gap instances in the live inventory this rule actually priced. Absent until
   * the first preview lands, and hidden rather than zeroed — "not measured yet" and
   * "matches nothing" are different statements.
   */
  function paintPrices(td, count, total) {
    if (!td) return;
    if (count === null || count === undefined) {
      td.hidden = true;
      return;
    }
    if (!td.firstChild) {
      td.append(
        el("span", { class: "cover-bar" }, el("i", {})),
        el("span", { class: "cover-n" }),
      );
    }
    td.hidden = false;
    const share = total ? Math.round((count / total) * 100) : 0;
    td.firstChild.firstChild.style.width = `${share}%`;
    setText(td.lastChild, String(count));
    setAttr(td, "aria-label", total
      ? `prices ${count} of ${total} gap instances`
      : `prices ${count} gap instances`);
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
      const prices = el("td", { class: "rule-prices num", hidden: true });
      const tr = el(
        "tr",
        { "data-idx": String(i) },
        el("td", { class: "num muted small" }, String(i + 1)),
        el("td", {}, matchSel),
        el("td", { class: "rule-codecell" }, codeBox, gloss),
        el("td", {}, pointsInput),
        prices,
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
        el("td", { colspan: "2" }, fbLabel),
        el("td", {}, fbInput),
        fbCount,
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

    // Quick-add reflects what the estate actually carries, not a constant somebody typed
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
      paintPrices(tr.querySelector(".rule-prices"), priced, instanceTotal);
    });
    paintPrices(fbCount, matchCounts ? preview.gapFallbackCount ?? 0 : null, instanceTotal);
    pricesTh.hidden = !matchCounts;
    syncSandboxPrices();

    // --- toolbar
    setText(versionPill, state.version === 0 ? "Spec defaults" : `Model v${state.version}`);
    scorePill.className = `pill ${state.stale ? "warn" : "ok"}`;
    setText(scorePill, state.stale ? "Scores stale" : "Scores current");
    clear(dirtyHost);
    if (isDirty()) dirtyHost.append(statusPill("warn", "Unsaved changes"));
    revertBtn.disabled = !isDirty() || saving;
    // Save stays focusable even when invalid: a disabled control cannot be tabbed to or
    // explain itself. Pressing it with errors moves focus to the offending field.
    saveBtn.disabled = saving;

    syncRecompute();
  }

  function syncRecompute() {
    const want = state.stale ? "1" : "0";
    if (recomputeHost.dataset.sig === want) return;
    recomputeHost.dataset.sig = want;
    clear(recomputeHost);
    if (!state.stale) return;
    const btn = el("button", {}, "Recompute scores");
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Recompute every AARS score?",
        body:
          "Re-scores the whole inventory under the saved rule and rewrites the asset table " +
          "and the graph snapshot. No sync history row is written, so the trend is left alone.",
        confirmLabel: "Recompute",
      });
      if (!ok) return;
      btn.disabled = true;
      setText(btn, "Recomputing…");
      try {
        const fresh = await call("api_rescoreAars", {});
        state = { ...state, ...fresh };
        saved = cloneRule(state.rule);
        toast(`Rescored ${fresh.assetCount} assets.`);
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
      // estate actually carries — and where codes the codebook never heard of (tenant
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

    const line = (label, value, hint) =>
      el(
        "div",
        { class: "diag-row" },
        el("span", { class: "diag-row__label" }, label),
        el("span", { class: "diag-row__value" }, value),
        hint ? el("span", { class: "diag-row__hint small muted" }, hint) : null,
      );

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
    if (!link || leaving || !(isDirty() || isProblemDirty())) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "Discard unsaved changes?",
      body: "This page has edits — to the AARS rule, the Problem tree rule, or both — that " +
        "have not been saved. Leaving discards them.",
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
    if (leaving || !(isDirty() || isProblemDirty())) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // ============================================================================
  // Problem tree — Phase 5. Same rule 1 as the AARS half of this file: the client NEVER
  // decides. Every outcome shown below — the occupancy strip, the movers, the leaf
  // counts, the per-axis unknown rates — comes from api_previewProblemRule, which runs
  // the real cascade server-side (syncStore.decideProblemsWith) at zero Wiz cost.
  // Nothing here calls decideProblem or reimplements first-match-wins.

  const AXIS_DEFS = [
    { key: "exploitation", label: "Exploitation", values: ["ACTIVE", "SUSPECTED", "UNKNOWN"] },
    { key: "impact", label: "Technical impact", values: ["TOTAL", "PARTIAL"] },
    { key: "exposure", label: "System exposure", values: ["OPEN", "CONTROLLED", "UNVERIFIED"] },
    { key: "mission", label: "Mission", values: ["HIGH", "MEDIUM", "LOW"] },
  ];
  // Mirrors OUTCOME_VALUES (src/domain/problem.ts), worst first — the outcome dropdowns
  // and the occupancy strip both walk this order, so a row's options and its place in the
  // strip never disagree about which end of the scale is worse.
  const OUTCOME_OPTIONS = [
    { value: "ACT", label: "Act" },
    { value: "ATTEND", label: "Attend" },
    { value: "TRACK_STAR", label: "Track ★" },
    { value: "TRACK", label: "Track" },
  ];
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
    const pClaimsTh = el("th", { class: "rule-prices", hidden: true }, "Leaves");
    const pCascadeTable = el(
      "div",
      { class: "table-wrap" },
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
            ...AXIS_DEFS.map((a) => el("th", {}, a.label)),
            el("th", {}, "Outcome"),
            pClaimsTh,
            el("th", { class: "rule-noteh" }, "Note"),
            el("th", {}, el("span", { class: "visually-hidden" }, "Actions")),
          ),
        ),
        pCascadeBody,
      ),
    );

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
              onProblemEdit();
            },
          });
          return el("td", {}, sel);
        });
        const outcomeSel = select({
          options: OUTCOME_OPTIONS,
          value: row.outcome,
          ariaLabel: `Outcome, rule ${i + 1}`,
          onChange: (v) => {
            row.outcome = v;
            onProblemEdit();
          },
        });

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
        const claims = el("td", { class: "rule-prices num", hidden: true });
        const tr = el(
          "tr",
          { "data-idx": String(i) },
          el("td", { class: "num muted small" }, String(i + 1)),
          ...axisCells,
          el("td", {}, outcomeSel),
          claims,
          meta,
          el("td", { class: "rule-rowbtns" }, up, down, del),
        );
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
          onProblemEdit();
        },
      });
      pCascadeBody.append(
        el(
          "tr",
          { class: "rule-fallback" },
          el("td", { class: "num muted small", "aria-hidden": "true" }, "↳"),
          el("td", { colspan: String(AXIS_DEFS.length) }, "Matches no rule above"),
          el("td", {}, fbSel),
          el("td", { class: "rule-prices num", hidden: true }),
          el("td", { class: "rule-rowmeta small muted" }, "the tree's fallback outcome"),
          el("td", {}),
        ),
      );

      pAddBtn.disabled = problemDraft.outcomeRules.length >= max;
      pAddBtn.title = pAddBtn.disabled ? `The cascade is limited to ${max} rules.` : "";
    }

    // -------------------------------------------------------- derivation knobs (editor)
    const pMissionSelect = select({
      options: ["HIGH", "MEDIUM", "LOW"],
      value: problemDraft.missingMission,
      ariaLabel: "Missing business impact reads as",
      onChange: (v) => {
        problemDraft.missingMission = v;
        onProblemEdit();
      },
    });
    const pMissionId = nextId("pmission");
    pMissionSelect.id = pMissionId;
    const pMissionField = field(pMissionId, "Missing business impact reads as", pMissionSelect);

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

    const pRemediateId = nextId("premed");
    const pRemediateInput = el("input", { type: "text", id: pRemediateId, class: "rule-code" });
    pRemediateInput.value = problemDraft.remediateVerdicts.join(", ");
    pRemediateInput.addEventListener("input", () => {
      problemDraft.remediateVerdicts =
        pRemediateInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      onProblemEdit();
    });
    const pRemediateField = {
      ...field(
        pRemediateId, "AI verdicts that reach SUSPECTED", pRemediateInput,
        "aiRemediationAnalysis.verdict values, comma-separated"),
      input: pRemediateInput,
    };

    const pGroupsId = nextId("pgroups");
    const pGroupsInput = el("input", { type: "text", id: pGroupsId, class: "rule-code" });
    pGroupsInput.value = problemDraft.totalImpactGroups.join(", ");
    pGroupsInput.addEventListener("input", () => {
      problemDraft.totalImpactGroups =
        pGroupsInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      onProblemEdit();
    });
    const pGroupsField = {
      ...field(
        pGroupsId, "Combo groups that grant code execution", pGroupsInput,
        "combo-group ids, comma-separated — the third TOTAL-impact source"),
      input: pGroupsInput,
    };

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
    const pExploitAddBtn = el("button", {}, "Add rule");
    pExploitAddBtn.addEventListener("click", () => {
      problemDraft.exploitationByRuleId.unshift({ ruleId: "", maturity: "FEASIBLE" });
      renderExploitationRows();
      onProblemEdit();
    });

    function renderExploitationRows() {
      clear(pExploitBody);
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

    const pEditor = el(
      "div",
      { class: "rule-editor" },
      section(
        "Outcome cascade",
        "Each row is tried in order; the first whose conditions ALL match wins. An axis " +
          "left on “any” is a wildcard, not a value — a row with no conditions at all " +
          "matches every remaining vector.",
        [pCascadeTable, el("div", { class: "rule-row", style: "margin-top:10px" }, pAddBtn)],
      ),
      section(
        "How the four axes are read",
        "Separate from the cascade above, which only decides what a VECTOR routes to once " +
          "it exists. These decide what the vector IS.",
        [
          el("div", { class: "rule-row" }, pMissionField.node, pCeilingField.node),
          el("div", { class: "rule-row", style: "margin-top:10px" }, pRemediateField.node),
          el("div", { class: "rule-row", style: "margin-top:10px" }, pGroupsField.node),
        ],
      ),
      section(
        "Exploitation maturity by Wiz combo rule",
        "REALIZED or DEMONSTRATED reaches SUSPECTED exploitation on an issue this rule " +
          "matches; FEASIBLE does not — “someone could” is not “someone has”.",
        [pExploitTable, el("div", { class: "rule-row", style: "margin-top:10px" }, pExploitAddBtn)],
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

    function paintUnknownRates(disc) {
      clear(pUnknownList);
      clear(pUnknownWarn);
      pUnknownSection.hidden = !disc;
      if (!disc) return;
      setText(
        pLeavesLine,
        `${disc.leavesReached} of 54 leaves reached, across ${disc.decided.length} decided ` +
          `issues and findings.`,
      );
      for (const key of ["exploitation", "impact", "exposure", "mission"]) {
        const rate = disc.unknownRate[key] || 0;
        const pct = Math.round(rate * 1000) / 10;
        const high = rate >= UNKNOWN_WARN_THRESHOLD;
        pUnknownList.append(
          el(
            "div", { class: "diag-row" },
            el("span", { class: "diag-row__label" }, AXIS_LABELS[key]),
            el("span", { class: "diag-row__value" }, `${pct}% unknown`),
            high
              ? el("span", { class: "diag-row__hint small muted" },
                "most reads on this axis could not be established")
              : null,
          ),
        );
        if (high) {
          pUnknownWarn.append(
            el(
              "p", { class: "diag-warn small" },
              el("span", { class: "diag-warn__mark", "aria-hidden": "true" }, "▲"),
              `${AXIS_LABELS[key]} reads UNKNOWN on ${pct}% of decided rows. This axis is not ` +
                "populated on this tenant, and every rule keyed on it is deciding on the " +
                "minority it could actually read.",
            ),
          );
        }
      }
    }

    function paintProblemImpact() {
      const errs = problemDraftErrors(problemDraft);
      clear(pImpactState);

      if (errs.length) {
        clear(pImpactStrip);
        clear(pMoverList);
        clear(pMoverMore);
        pMoverSection.hidden = true;
        paintUnknownRates(null);
        setText(pImpactHeadline, "");
        setText(pLeavesLine, "");
        pImpactState.append(emptyState("Fix the highlighted fields to preview.", errs[0]));
        return;
      }
      if (problemPreviewError) {
        clear(pImpactStrip);
        pMoverSection.hidden = true;
        paintUnknownRates(null);
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
        paintUnknownRates(null);
        setText(pImpactHeadline, "");
        setText(pLeavesLine, "");
        clear(pImpactStrip).append(
          skeleton("line", { width: "80%" }), skeleton("line", { width: "60%" }));
        return;
      }
      if (!problemPreview.total) {
        clear(pImpactStrip);
        pMoverSection.hidden = true;
        paintUnknownRates(null);
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

      paintUnknownRates(problemPreview.treeDiscrimination);

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

    // -------------------------------------------------------------------------- sync
    function onProblemEdit() {
      syncProblem();
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
      setValue(pRemediateInput, problemDraft.remediateVerdicts.join(", "));
      setValue(pGroupsInput, problemDraft.totalImpactGroups.join(", "));
      if (document.activeElement !== pMissionSelect) pMissionSelect.value = problemDraft.missingMission;

      // Cascade row notes: shadowed, and how many leaves each row claims — both come from
      // the preview, which walks the DRAFT, exactly like the AARS cascade's own coverage.
      const shadowed = (problemPreview && problemPreview.shadowedOutcomeRules) || [];
      const coverage = (problemPreview && problemPreview.leafCoverage) || null;
      const rows = pCascadeBody.querySelectorAll("tr[data-idx]");
      rows.forEach((tr, i) => {
        const meta = tr.querySelector(".rule-rowmeta");
        const isShadow = shadowed.indexOf(i) >= 0;
        tr.classList.toggle("rule-dead", isShadow);
        setText(meta, isShadow ? "never fires — an earlier rule already claims every leaf it could match" : "");
        paintPrices(tr.querySelector(".rule-prices"), coverage ? coverage.byRow[i] || 0 : null, coverage ? coverage.total : 0);
      });
      const fbRow = pCascadeBody.querySelector("tr.rule-fallback");
      if (fbRow) {
        paintPrices(
          fbRow.querySelector(".rule-prices"),
          coverage ? coverage.byFallback : null,
          coverage ? coverage.total : 0);
      }
      pClaimsTh.hidden = !coverage;

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
      scheduleProblemPreviewRun();
    }

    async function runProblemPreview() {
      const seq = ++problemPreviewSeq;
      try {
        const data = await call("api_previewProblemRule", { rule: problemDraft });
        if (seq !== problemPreviewSeq) return;
        problemPreview = data;
        problemPreviewError = "";
      } catch (e) {
        if (seq !== problemPreviewSeq) return;
        problemPreview = null;
        problemPreviewError = String(e.message || e);
      }
      pImpact.classList.remove("updating");
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
    paintProblemImpact();
    scheduleProblemPreview();
  }

  // --------------------------------------------------------------------- first paint
  renderCascade();
  sync();
  paintImpact();
  schedulePreview();
}
