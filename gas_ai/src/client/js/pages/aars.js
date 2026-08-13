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
//    (adding, removing or reordering a cascade row), which restore focus explicitly.

import { call } from "../api.js";
import {
  aarsChip,
  clear,
  confirmDialog,
  downloadText,
  el,
  field,
  emptyState,
  openSheet,
  sevBadge,
  skeleton,
  statusPill,
  toast,
} from "../ui.js";

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
const COMMON_GAP_CODES = ["LLM06", "LLM05", "LLM04", "ASI10", "NO_GUARDRAIL", "DEPRECATED_MODEL"];
const MOVERS_INLINE = 8;

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

  bar.append(el("h1", { class: "workbench-title" }, "AARS Rules"));
  body.append(
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
    clear(body).append(
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
  let previewTimer = null;
  let previewSeq = 0;
  let sampleTimer = null;
  let sampleSeq = 0;
  let sampleResult = null;
  let sandboxResultHost = null;
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

  // ------------------------------------------------------------------------ toolbar
  const versionPill = el("span", { class: "pill neutral" });
  const scorePill = el("span", { class: "pill" });
  const dirtyHost = el("span", {});
  const saveBtn = el("button", { class: "primary" }, "Save rule");
  const revertBtn = el("button", {}, "Revert");
  const recomputeHost = el("span", {});
  bar.append(
    el(
      "div",
      { class: "workbench-controls" },
      el("div", { class: "rule-bar-state" }, versionPill, scorePill, dirtyHost),
      recomputeHost,
      revertBtn,
      saveBtn,
    ),
  );

  // ------------------------------------------------------------------------- panes
  const editor = el("div", { class: "rule-editor" });
  const impact = el("div", { class: "rule-impact" });
  clear(body).append(el("div", { class: "rule-panes" }, editor, impact));

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
  const sevFields = {};
  const rowA = el("div", { class: "rule-row" });
  for (const sev of SEVERITY_KEYS) {
    const id = nextId("sev");
    const input = numberInput(id, { value: draft.severityPoints[sev], min: 0, max: P_MAX });
    input.addEventListener("input", () => {
      draft.severityPoints[sev] = num(input.value, draft.severityPoints[sev]);
      onEdit();
    });
    const f = field(id, sev, input);
    sevFields[sev] = { ...f, input };
    rowA.append(f.node);
  }
  const multId = nextId("mult");
  const multInput = numberInput(multId, {
    value: draft.multiIssueMultiplier, min: M_MIN, max: M_MAX, step: "0.05",
  });
  multInput.addEventListener("input", () => {
    draft.multiIssueMultiplier = num(multInput.value, draft.multiIssueMultiplier);
    onEdit();
  });
  const multField = { ...field(multId, "More than one issue ×", multInput), input: multInput };
  const capAId = nextId("capa");
  const capAInput = numberInput(capAId, { value: draft.pillarACap, min: 0, max: P_MAX });
  capAInput.addEventListener("input", () => {
    draft.pillarACap = num(capAInput.value, draft.pillarACap);
    onEdit();
  });
  const capAField = { ...field(capAId, "Pillar cap", capAInput), input: capAInput };
  rowA.append(multField.node, capAField.node);

  editor.append(
    section(
      "Pillar A — toxic-combination participation",
      "Only the asset's worst open issue scores; the others do not add. A second open issue " +
        "applies the multiplier once, and a ninth applies it no further — which is why an " +
        "asset with four MEDIUM issues scores the same as one with two.",
      [rowA],
    ),
  );

  // ============================================================ section B — pillar B
  const cascadeBody = el("tbody", {});
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
          el("th", {}, "Note"),
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
    const first = cascadeBody.querySelector(".rule-code");
    if (first) first.focus();
    onEdit();
  });

  const fbId = nextId("fb");
  const fbInput = numberInput(fbId, { value: draft.gapFallbackPoints, min: 0, max: P_MAX });
  fbInput.addEventListener("input", () => {
    draft.gapFallbackPoints = num(fbInput.value, draft.gapFallbackPoints);
    onEdit();
  });
  const fbField = {
    ...field(fbId, "Unmatched code scores", fbInput, "Governs tenant-specific finding IDs"),
    input: fbInput,
  };
  const capBId = nextId("capb");
  const capBInput = numberInput(capBId, { value: draft.pillarBCap, min: 0, max: P_MAX });
  capBInput.addEventListener("input", () => {
    draft.pillarBCap = num(capBInput.value, draft.pillarBCap);
    onEdit();
  });
  const capBField = { ...field(capBId, "Pillar cap", capBInput), input: capBInput };

  const testId = nextId("test");
  const testInput = el("input", { type: "text", id: testId, class: "rule-code", placeholder: "e.g. SUB-082" });
  const testOut = el("span", { class: "small muted" });
  testInput.addEventListener("input", () => {
    const code = testInput.value.trim();
    if (!code) {
      setText(testOut, "");
      return;
    }
    const hit = priceCode(draft, code);
    setText(
      testOut,
      hit.index === -1
        ? `No rule matches — priced at the fallback, ${hit.points} points.`
        : `Rule ${hit.index + 1} matches — ${hit.points} points.`,
    );
  });
  const testField = field(testId, "Test a code", testInput);
  testField.node.append(testOut);

  editor.append(
    section(
      "Pillar B — compliance framework gaps",
      "Each gap code is priced by the FIRST rule that matches it, so order is meaning: an " +
        "exact LLM04 must sit above the LLM family, or it prices as a primary gap.",
      [
        cascadeTable,
        el("div", { class: "rule-row", style: "margin-top:12px" },
          addBtn, fbField.node, capBField.node, testField.node),
      ],
    ),
  );

  // ============================================================ section C — pillar C
  const expFields = {};
  const rowC = el("div", { class: "rule-row" });
  for (const pair of EXPOSURES) {
    const key = pair[0];
    const id = nextId("exp");
    const input = numberInput(id, { value: draft.dataExposurePoints[key], min: 0, max: P_MAX });
    input.addEventListener("input", () => {
      draft.dataExposurePoints[key] = num(input.value, draft.dataExposurePoints[key]);
      onEdit();
    });
    const f = field(id, EXPOSURE_LABELS[key], input, " ");
    expFields[key] = { ...f, input };
    rowC.append(f.node);
  }
  const ampId = nextId("amp");
  const ampInput = numberInput(ampId, {
    value: draft.dataAmplifier, min: M_MIN, max: M_MAX, step: "0.05",
  });
  ampInput.addEventListener("input", () => {
    draft.dataAmplifier = num(ampInput.value, draft.dataAmplifier);
    onEdit();
  });
  const ampField = { ...field(ampId, "5Rs amplifier ×", ampInput), input: ampInput };
  rowC.append(ampField.node);

  editor.append(
    section(
      "Pillar C — data exposure",
      "The amplifier is a systemic signal, not a per-asset one: the 5Rs framework sits at " +
        "53% across the estate, so every data-related point carries the same uplift.",
      [rowC],
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
      el("div", { class: "rule-row" }, resetBtn, exportBtn, importBtn, importInput),
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

  impact.append(
    el("h2", { class: "section-label" }, "Impact on the current inventory"),
    impactState,
    impactStrip,
    impactHeadline,
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

  // ------------------------------------------------------------- cascade (structural)
  function renderCascade() {
    clear(cascadeBody);
    draft.gapPoints.forEach((row, i) => {
      const matchSel = el(
        "select",
        { "aria-label": `Match type, rule ${i + 1}` },
        el("option", { value: "exact", selected: row.match === "exact" || null }, "is exactly"),
        el("option", { value: "prefix", selected: row.match === "prefix" || null }, "starts with"),
      );
      matchSel.addEventListener("change", () => {
        row.match = matchSel.value;
        onEdit();
      });

      const codeInput = el("input", {
        type: "text", value: row.code, class: "rule-code",
        "aria-label": `Code, rule ${i + 1}`,
      });
      codeInput.addEventListener("input", () => {
        row.code = codeInput.value.toUpperCase();
        onEdit();
      });

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
      const tr = el(
        "tr",
        { "data-idx": String(i) },
        el("td", { class: "num muted small" }, String(i + 1)),
        el("td", {}, matchSel),
        el("td", {}, codeInput),
        el("td", {}, pointsInput),
        meta,
        el("td", { class: "rule-rowbtns" }, up, down, del),
      );
      cascadeBody.append(tr);
    });
    addBtn.disabled = draft.gapPoints.length >= GAP_MAX;
    addBtn.title = addBtn.disabled ? `The cascade is limited to ${GAP_MAX} rules.` : "";
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

    const codesId = nextId("codes");
    const codesInput = el("input", {
      type: "text", id: codesId, class: "rule-code", style: "min-width:220px",
      value: sample.gapCodes.join(", "),
    });
    codesInput.addEventListener("input", () => {
      sample.gapCodes = codesInput.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      syncQuickAdd();
      scheduleSample();
    });

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

    const quickAdd = el("div", { class: "pill-row", style: "margin-top:10px" });
    const quickBtns = {};
    for (const code of COMMON_GAP_CODES) {
      const btn = el("button", { class: "kind-pill" }, code);
      btn.addEventListener("click", () => {
        const at = sample.gapCodes.indexOf(code);
        if (at >= 0) sample.gapCodes.splice(at, 1);
        else sample.gapCodes.push(code);
        setValue(codesInput, sample.gapCodes.join(", "));
        syncQuickAdd();
        scheduleSample();
        btn.focus();
      });
      quickBtns[code] = btn;
      quickAdd.append(btn);
    }
    function syncQuickAdd() {
      for (const code of COMMON_GAP_CODES) {
        setAttr(quickBtns[code], "aria-pressed", sample.gapCodes.indexOf(code) >= 0 ? "true" : "false");
      }
    }
    syncQuickAdd();

    sandboxResultHost = el("div", { class: "sandbox-result" });
    sandboxBody.append(
      el("p", { class: "small muted", style: "margin:10px 0" },
        "Scored by the server with your draft rule — the same code that scores the real " +
          "inventory, so what you see here is what a matching asset would get."),
      countsRow,
      el("div", { class: "rule-row" },
        field(codesId, "Compliance gap codes", codesInput).node,
        field(expId, "Data exposure", exposureSel).node),
      quickAdd,
      sandboxResultHost,
    );
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

    // --- pillar fields
    for (const sev of SEVERITY_KEYS) {
      const f = sevFields[sev];
      setValue(f.input, draft.severityPoints[sev]);
      f.setChanged(saved.severityPoints[sev] !== draft.severityPoints[sev], saved.severityPoints[sev]);
    }
    setValue(multField.input, draft.multiIssueMultiplier);
    multField.setChanged(saved.multiIssueMultiplier !== draft.multiIssueMultiplier, saved.multiIssueMultiplier);
    setValue(capAField.input, draft.pillarACap);
    capAField.setChanged(saved.pillarACap !== draft.pillarACap, saved.pillarACap);

    setValue(fbField.input, draft.gapFallbackPoints);
    fbField.setChanged(saved.gapFallbackPoints !== draft.gapFallbackPoints, saved.gapFallbackPoints);
    setValue(capBField.input, draft.pillarBCap);
    capBField.setChanged(saved.pillarBCap !== draft.pillarBCap, saved.pillarBCap);

    for (const pair of EXPOSURES) {
      const key = pair[0];
      const f = expFields[key];
      setValue(f.input, draft.dataExposurePoints[key]);
      f.setChanged(saved.dataExposurePoints[key] !== draft.dataExposurePoints[key], saved.dataExposurePoints[key]);
      const amplified = Math.round(draft.dataExposurePoints[key] * draft.dataAmplifier);
      const hint = f.node.querySelector(".field-hint");
      if (hint) setText(hint, `after ×${draft.dataAmplifier}: ${amplified}`);
    }
    setValue(ampField.input, draft.dataAmplifier);
    ampField.setChanged(saved.dataAmplifier !== draft.dataAmplifier, saved.dataAmplifier);

    // --- cascade row notes (shadowed / duplicate), mutated in place
    const shadowed = (preview && preview.shadowedGapRules) || [];
    const rows = cascadeBody.querySelectorAll("tr[data-idx]");
    rows.forEach((tr, i) => {
      const meta = tr.querySelector(".rule-rowmeta");
      const err = errs.gaps[i];
      const dead = !err && shadowed.indexOf(i) >= 0;
      setText(meta, err || (dead ? "never fires — an earlier rule already matches this" : ""));
      meta.classList.toggle("field-error", !!err);
      tr.classList.toggle("rule-dead", dead);
      const code = tr.querySelector(".rule-code");
      if (err) code.setAttribute("aria-invalid", "true");
      else code.removeAttribute("aria-invalid");
    });

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
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
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
    previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
  }

  async function runPreview() {
    const seq = ++previewSeq;
    try {
      const data = await call("api_previewAarsRule", { rule: draft });
      if (seq !== previewSeq) return; // superseded by a later edit
      preview = data;
      previewError = "";
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
      setText(impactHeadline, "");
      impactState.append(emptyState("Fix the highlighted fields to preview.", errs.list[0]));
      return;
    }
    if (previewError) {
      clear(impactStrip);
      moverSection.hidden = true;
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
  function scheduleSample() {
    if (!sandboxDetails.open) return; // closed: don't spend a round trip on it
    if (sampleTimer) clearTimeout(sampleTimer);
    sampleTimer = setTimeout(runSample, SAMPLE_DEBOUNCE_MS);
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
      ...(breakdown.length
        ? [el("span", { class: "small muted" },
            "Gaps: " + breakdown.map((g) => `${g.code} ${g.points}`).join(", "))]
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
    if (!link || leaving || !isDirty()) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "Discard unsaved changes?",
      body: "The AARS rule has edits that have not been saved. Leaving discards them.",
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
    if (leaving || !isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // --------------------------------------------------------------------- first paint
  renderCascade();
  sync();
  paintImpact();
  schedulePreview();
}
