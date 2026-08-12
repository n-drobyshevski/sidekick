// AARS Rules: the AI Asset Risk Score model, inspectable and tunable.
//
// The score itself is never computed here. Every number the page shows — the prose
// summary, the impact of a draft, the sandbox result — comes from the server, which runs
// the same computeAars the sync runs. A second implementation in client JS would be a
// second answer to "what is this asset's score", and the page exists to make that
// question have exactly one.

import { call } from "../api.js";
import {
  aarsChip,
  clear,
  confirmDialog,
  downloadText,
  el,
  emptyState,
  sevBadge,
  skeleton,
  statusPill,
  toast,
} from "../ui.js";

const SEVERITY_KEYS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const BAND_KEYS = ["critical", "high", "medium", "low"];
const BAND_LABELS = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW" };
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
// Codes the model names explicitly, offered as one-press adds in the sandbox.
const COMMON_GAP_CODES = ["LLM06", "LLM05", "LLM04", "ASI10", "NO_GUARDRAIL", "DEPRECATED_MODEL"];

// A whole-inventory rescore per keystroke would be unkind to both the sheet and the
// operator; a sandbox score is one pure call and can keep up.
const PREVIEW_DEBOUNCE_MS = 800;
const SAMPLE_DEBOUNCE_MS = 200;

function cloneRule(rule) {
  return JSON.parse(JSON.stringify(rule));
}

function num(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The band-ordering check, mirrored client-side so the error lands on the keystroke that
 * caused it. validateAarsRule in src/domain/aarsRule.ts is the authority and re-runs on
 * save — this is an early warning, never the last word.
 */
function draftErrors(rule) {
  const errors = [];
  for (let i = 1; i < BAND_KEYS.length; i++) {
    const upper = BAND_KEYS[i - 1];
    const lower = BAND_KEYS[i];
    if (rule.bands[upper] <= rule.bands[lower]) {
      errors.push(
        `The ${BAND_LABELS[upper]} threshold must sit above the ${BAND_LABELS[lower]} ` +
          "threshold — otherwise no score can land in " + BAND_LABELS[lower] + ".",
      );
    }
  }
  const seen = {};
  rule.gapPoints.forEach((g, i) => {
    if (!g.code) errors.push(`Compliance-gap rule ${i + 1} has no code.`);
    const key = g.match + ":" + g.code;
    if (g.code && seen[key]) errors.push(`Compliance-gap rule ${i + 1} repeats ${g.match} "${g.code}".`);
    seen[key] = true;
  });
  if (!rule.gapPoints.length) errors.push("The compliance-gap cascade has no rules.");
  return errors;
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
 * Append, skipping absent children. Native append() stringifies null — it renders the
 * word "null" — so a section built with `cond ? node : null` has to go through this
 * rather than straight into node.append(). el()'s own children are already filtered.
 */
function fill(node, ...children) {
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

function field(labelText, control, hint) {
  return el(
    "div",
    { class: "field" },
    el("label", { class: "field-label" }, labelText),
    control,
    hint ? el("span", { class: "field-hint small muted" }, hint) : null,
  );
}

function numberInput(opts) {
  const input = el("input", {
    type: "number",
    min: String(opts.min),
    max: String(opts.max),
    step: opts.step || "1",
    value: String(opts.value),
    class: "rule-num",
    "aria-label": opts.ariaLabel,
  });
  input.addEventListener("input", () => opts.onInput(input.value));
  return input;
}

export async function renderAarsRules(main, _params, ctx) {
  main.append(
    el("h1", {}, "AARS Rules"),
    el(
      "p",
      { class: "page-sub" },
      "How the AI Asset Risk Score is calculated. Every number below is editable; the " +
        "defaults are the model in ai/custom_score.md.",
    ),
  );

  const host = el("div", {});
  main.append(host);
  host.append(
    el(
      "div",
      {
        class: "card",
        role: "status",
        "aria-label": "Loading the AARS rule",
        style: "display:flex; flex-direction:column; gap:16px",
      },
      skeleton("title", { width: "220px" }),
      skeleton("line", { width: "90%" }),
      skeleton("line", { width: "80%" }),
      skeleton("pill", { width: "160px" }),
      skeleton("chart", { height: "120px" }),
    ),
  );

  let state;
  try {
    state = await call("api_getAarsRule", {});
  } catch (e) {
    clear(host).append(emptyState("Couldn't load the AARS rule.", String(e.message || e)));
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

  // Section hosts, repainted independently so editing a field never rebuilds the input
  // the cursor is in.
  const statusHost = el("div", { class: "card rule-card" });
  const pillarAHost = el("div", { class: "card rule-card" });
  const pillarBHost = el("div", { class: "card rule-card" });
  const pillarCHost = el("div", { class: "card rule-card" });
  const levelsHost = el("div", { class: "card rule-card" });
  const previewHost = el("div", {
    class: "card rule-card",
    role: "status",
    "aria-label": "Impact of the proposed rule",
  });
  const sandboxHost = el("div", { class: "card rule-card" });

  clear(host).append(
    statusHost,
    pillarAHost,
    pillarBHost,
    pillarCHost,
    levelsHost,
    previewHost,
    sandboxHost,
  );

  function isDirty() {
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }

  /** Called by every control: refresh the dependent panels and re-arm the preview. */
  function onEdit(opts) {
    paintStatus();
    paintLevels();
    if (!(opts && opts.keepPillarB)) paintPillarB();
    schedulePreview();
    scheduleSample();
  }

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    const errors = draftErrors(draft);
    if (errors.length) {
      preview = null;
      previewError = "";
      previewing = false;
      paintPreview();
      return;
    }
    previewing = true;
    paintPreview();
    previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
  }

  async function runPreview() {
    const seq = ++previewSeq;
    try {
      const data = await call("api_previewAarsRule", { rule: draft });
      if (seq !== previewSeq) return; // a later edit already superseded this answer
      preview = data;
      previewError = "";
    } catch (e) {
      if (seq !== previewSeq) return;
      preview = null;
      previewError = String(e.message || e);
    }
    previewing = false;
    paintPreview();
    paintStatus();
    paintLevels();
    paintPillarB();
  }

  function scheduleSample() {
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
        sample: {
          issueSeverities,
          gapCodes: sample.gapCodes,
          dataExposure: sample.dataExposure,
        },
      });
      if (seq !== sampleSeq) return;
      sampleResult = data;
    } catch (e) {
      if (seq !== sampleSeq) return;
      sampleResult = { error: String(e.message || e) };
    }
    paintSandbox();
  }

  // ------------------------------------------------------------------ status + actions

  function paintStatus() {
    clear(statusHost);
    const errors = draftErrors(draft);
    const dirty = isDirty();
    // While editing, the prose describes the DRAFT (the preview carries it); with no
    // preview yet it describes what is actually stored, and says which it is.
    const summary = (preview && preview.summary) || state.summary || [];
    const describesDraft = !!(preview && preview.summary) && dirty;

    const pills = el(
      "div",
      { class: "rule-pills" },
      statusPill("neutral", state.version === 0 ? "Model: spec defaults" : `Model version ${state.version}`),
      state.stale
        ? statusPill("warn", "Scores stale — recompute to apply")
        : statusPill("ok", "Scores current"),
      dirty ? statusPill("warn", "Unsaved changes") : null,
    );

    const saveBtn = el("button", { class: "primary" }, "Save rule");
    saveBtn.disabled = !dirty || errors.length > 0;
    saveBtn.addEventListener("click", () => save(saveBtn));

    const revertBtn = el("button", {}, "Revert");
    revertBtn.disabled = !dirty;
    revertBtn.addEventListener("click", () => {
      draft = cloneRule(saved);
      paintAll();
      schedulePreview();
      scheduleSample();
    });

    const resetBtn = el("button", {}, "Reset to spec defaults");
    resetBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Reset to spec defaults?",
        body:
          "Every pillar, gap rule and threshold returns to the model in " +
          "ai/custom_score.md. Nothing is saved until you press Save rule.",
        confirmLabel: "Reset",
      });
      if (!ok) return;
      draft = cloneRule(state.defaults);
      paintAll();
      schedulePreview();
      scheduleSample();
    });

    const exportBtn = el("button", { class: "link" }, "Export JSON");
    exportBtn.addEventListener("click", () => {
      downloadText(
        "aars-rule.json",
        JSON.stringify({ version: state.version, summary, rule: draft }, null, 2),
        "application/json",
      );
    });

    const importInput = el("input", {
      type: "file",
      accept: "application/json,.json",
      style: "display:none",
      "aria-hidden": "true",
      tabindex: "-1",
    });
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          // Accept either a bare rule or a previous export, which nests it.
          draft = cloneRule(parsed && parsed.rule ? parsed.rule : parsed);
          paintAll();
          schedulePreview();
          scheduleSample();
          toast("Rule loaded — review it, then Save.");
        } catch (e) {
          toast("That file isn't a readable rule: " + String(e.message || e), "error");
        }
      };
      reader.readAsText(file);
      importInput.value = "";
    });
    const importBtn = el("button", { class: "link" }, "Import JSON");
    importBtn.addEventListener("click", () => importInput.click());

    const actions = el(
      "div",
      { class: "rule-actions" },
      saveBtn,
      revertBtn,
      resetBtn,
      el("span", { class: "rule-actions__spacer" }),
      exportBtn,
      importBtn,
      importInput,
    );

    fill(
      statusHost,
      el("h3", {}, "The model"),
      pills,
      el(
        "p",
        { class: "small muted", style: "margin:0 0 10px" },
        describesDraft
          ? "Describing your unsaved draft."
          : "Describing the model currently in force.",
      ),
      el("ul", { class: "rule-summary" }, ...summary.map((line) => el("li", {}, line))),
      errors.length
        ? el(
            "div",
            { class: "rule-errors", role: "alert" },
            ...errors.map((e) => el("div", {}, e)),
          )
        : null,
      state.stale
        ? el(
            "p",
            { class: "small muted", style: "margin:10px 0 0" },
            "The saved point model has changed since the inventory was scored. Recompute " +
              "rescores every asset from data already in the sheet — no Wiz API calls, no " +
              "re-sync. Level thresholds never need this: levels are re-derived on read.",
          )
        : null,
      state.stale ? recomputeButton() : null,
      actions,
    );
  }

  function recomputeButton() {
    const btn = el("button", { class: "primary", style: "margin-top:10px" }, "Recompute scores");
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Recompute every AARS score?",
        body:
          "Re-scores the whole inventory under the saved rule and rewrites the asset " +
          "table and the graph snapshot. No sync history row is written, so the trend is " +
          "left alone.",
        confirmLabel: "Recompute",
      });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = "Recomputing…";
      try {
        const fresh = await call("api_rescoreAars", {});
        state = { ...state, ...fresh };
        saved = cloneRule(state.rule);
        toast(`Rescored ${fresh.assetCount} assets.`);
        paintAll();
        schedulePreview();
        ctx.refresh();
      } catch (e) {
        toast(String(e.message || e), "error");
        btn.disabled = false;
        btn.textContent = "Recompute scores";
      }
    });
    return btn;
  }

  async function save(btn) {
    btn.disabled = true;
    try {
      const fresh = await call("api_setAarsRule", { rule: draft });
      state = fresh;
      saved = cloneRule(fresh.rule);
      draft = cloneRule(fresh.rule);
      toast("AARS rule saved.");
      paintAll();
      schedulePreview();
      scheduleSample();
      ctx.refresh();
    } catch (e) {
      toast(String(e.message || e), "error");
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------- pillar A

  function paintPillarA() {
    clear(pillarAHost);
    const row = el("div", { class: "rule-row" });
    for (const sev of SEVERITY_KEYS) {
      row.append(
        field(
          sev,
          numberInput({
            value: draft.severityPoints[sev],
            min: 0,
            max: P_MAX,
            ariaLabel: `Points for a ${sev} open issue`,
            onInput: (v) => {
              draft.severityPoints[sev] = num(v, draft.severityPoints[sev]);
              onEdit();
            },
          }),
        ),
      );
    }
    row.append(
      field(
        "More than one issue ×",
        numberInput({
          value: draft.multiIssueMultiplier,
          min: M_MIN,
          max: M_MAX,
          step: "0.05",
          ariaLabel: "Multiplier applied when an asset has more than one open issue",
          onInput: (v) => {
            draft.multiIssueMultiplier = num(v, draft.multiIssueMultiplier);
            onEdit();
          },
        }),
      ),
      field(
        "Pillar cap",
        numberInput({
          value: draft.pillarACap,
          min: 0,
          max: P_MAX,
          ariaLabel: "Maximum points from pillar A",
          onInput: (v) => {
            draft.pillarACap = num(v, draft.pillarACap);
            onEdit();
          },
        }),
      ),
    );

    pillarAHost.append(
      el("h3", {}, "Pillar A — toxic-combination participation"),
      row,
      el(
        "p",
        { class: "small muted", style: "margin:10px 0 0" },
        "Only the asset's WORST open issue scores; the others do not add. A second open " +
          "issue applies the multiplier once, and a ninth applies it no further — which " +
          "is why an asset with four MEDIUM issues scores the same as one with two.",
      ),
    );
  }

  // ---------------------------------------------------------------------- pillar B

  function paintPillarB() {
    clear(pillarBHost);
    const shadowed = (preview && preview.shadowedGapRules) || [];

    const body = el("tbody", {});
    draft.gapPoints.forEach((row, i) => {
      const matchSel = el(
        "select",
        { "aria-label": `Match type for compliance-gap rule ${i + 1}` },
        el("option", { value: "exact", selected: row.match === "exact" || null }, "is exactly"),
        el("option", { value: "prefix", selected: row.match === "prefix" || null }, "starts with"),
      );
      matchSel.addEventListener("change", () => {
        row.match = matchSel.value;
        onEdit();
      });

      const codeInput = el("input", {
        type: "text",
        value: row.code,
        class: "rule-code",
        "aria-label": `Code for compliance-gap rule ${i + 1}`,
      });
      codeInput.addEventListener("input", () => {
        row.code = codeInput.value.toUpperCase();
        // Keep this table as it is: rebuilding it would take the cursor out of the field.
        onEdit({ keepPillarB: true });
      });

      const pointsInput = numberInput({
        value: row.points,
        min: 0,
        max: P_MAX,
        ariaLabel: `Points for compliance-gap rule ${i + 1}`,
        onInput: (v) => {
          row.points = num(v, row.points);
          onEdit({ keepPillarB: true });
        },
      });

      const up = el("button", { class: "link", "aria-label": `Move rule ${i + 1} up` }, "↑");
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        const prev = draft.gapPoints[i - 1];
        draft.gapPoints[i - 1] = row;
        draft.gapPoints[i] = prev;
        onEdit();
      });

      const down = el("button", { class: "link", "aria-label": `Move rule ${i + 1} down` }, "↓");
      down.disabled = i === draft.gapPoints.length - 1;
      down.addEventListener("click", () => {
        const next = draft.gapPoints[i + 1];
        draft.gapPoints[i + 1] = row;
        draft.gapPoints[i] = next;
        onEdit();
      });

      const del = el("button", { class: "link danger", "aria-label": `Remove rule ${i + 1}` }, "✕");
      del.addEventListener("click", () => {
        draft.gapPoints.splice(i, 1);
        onEdit();
      });

      const dead = shadowed.indexOf(i) >= 0;
      body.append(
        el(
          "tr",
          { class: dead ? "rule-dead" : null },
          el("td", { class: "num muted small" }, String(i + 1)),
          el("td", {}, matchSel),
          el("td", {}, codeInput),
          el("td", {}, pointsInput),
          el(
            "td",
            { class: "rule-rowmeta small muted" },
            dead ? "never fires — an earlier rule already matches this" : "",
          ),
          el("td", { class: "rule-rowbtns" }, up, down, del),
        ),
      );
    });

    const addBtn = el("button", {}, "Add rule");
    addBtn.disabled = draft.gapPoints.length >= GAP_MAX;
    addBtn.addEventListener("click", () => {
      draft.gapPoints.push({ match: "exact", code: "", points: 5 });
      onEdit();
    });

    // Code tester: plain first-match string comparison, no scoring involved.
    const testInput = el("input", {
      type: "text",
      placeholder: "e.g. SUB-082",
      class: "rule-code",
      "aria-label": "Test which rule prices a code",
    });
    const testOut = el("span", { class: "small muted", role: "status" }, "—");
    testInput.addEventListener("input", () => {
      const code = testInput.value.trim();
      if (!code) {
        testOut.textContent = "—";
        return;
      }
      const hit = priceCode(draft, code);
      testOut.textContent =
        hit.index === -1
          ? `No rule matches — priced at the fallback, ${hit.points} points.`
          : `Rule ${hit.index + 1} matches — ${hit.points} points.`;
    });

    pillarBHost.append(
      el("h3", {}, "Pillar B — compliance framework gaps"),
      el(
        "p",
        { class: "small muted", style: "margin:0 0 10px" },
        "Each gap code is priced by the FIRST rule that matches it, so order is meaning: " +
          "an exact LLM04 must sit above the LLM family, or it prices as a primary gap.",
      ),
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "data rule-table" },
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
              el("th", {}, ""),
              el("th", {}, ""),
            ),
          ),
          body,
        ),
      ),
      el(
        "div",
        { class: "rule-row", style: "margin-top:12px" },
        addBtn,
        field(
          "Unmatched code scores",
          numberInput({
            value: draft.gapFallbackPoints,
            min: 0,
            max: P_MAX,
            ariaLabel: "Points for a gap code no rule matches",
            onInput: (v) => {
              draft.gapFallbackPoints = num(v, draft.gapFallbackPoints);
              onEdit({ keepPillarB: true });
            },
          }),
          "Governs tenant-specific finding IDs",
        ),
        field(
          "Pillar cap",
          numberInput({
            value: draft.pillarBCap,
            min: 0,
            max: P_MAX,
            ariaLabel: "Maximum points from pillar B",
            onInput: (v) => {
              draft.pillarBCap = num(v, draft.pillarBCap);
              onEdit({ keepPillarB: true });
            },
          }),
        ),
        field("Test a code", testInput),
      ),
      el("p", { class: "small muted", style: "margin:8px 0 0" }, testOut),
    );
  }

  // ---------------------------------------------------------------------- pillar C

  function paintPillarC() {
    clear(pillarCHost);
    const row = el("div", { class: "rule-row" });
    for (const pair of EXPOSURES) {
      const key = pair[0];
      row.append(
        field(
          EXPOSURE_LABELS[key],
          numberInput({
            value: draft.dataExposurePoints[key],
            min: 0,
            max: P_MAX,
            ariaLabel: `Points for ${pair[1]}`,
            onInput: (v) => {
              draft.dataExposurePoints[key] = num(v, draft.dataExposurePoints[key]);
              onEdit();
            },
          }),
          `after ×${draft.dataAmplifier}: ${Math.round(draft.dataExposurePoints[key] * draft.dataAmplifier)}`,
        ),
      );
    }
    row.append(
      field(
        "5Rs amplifier ×",
        numberInput({
          value: draft.dataAmplifier,
          min: M_MIN,
          max: M_MAX,
          step: "0.05",
          ariaLabel: "Systemic amplifier applied to all data-exposure points",
          onInput: (v) => {
            draft.dataAmplifier = num(v, draft.dataAmplifier);
            paintPillarC();
            onEdit();
          },
        }),
      ),
    );

    pillarCHost.append(
      el("h3", {}, "Pillar C — data exposure"),
      row,
      el(
        "p",
        { class: "small muted", style: "margin:10px 0 0" },
        "The amplifier is a systemic signal, not a per-asset one: the 5Rs framework sits " +
          "at 53% across the estate, so every data-related point carries the same uplift.",
      ),
    );
  }

  // ------------------------------------------------------------------------ levels

  function paintLevels() {
    clear(levelsHost);
    const row = el("div", { class: "rule-row" });
    for (const key of BAND_KEYS) {
      row.append(
        field(
          `${BAND_LABELS[key]} at`,
          numberInput({
            value: draft.bands[key],
            min: B_MIN,
            max: B_MAX,
            ariaLabel: `Lowest score that counts as ${BAND_LABELS[key]}`,
            onInput: (v) => {
              draft.bands[key] = num(v, draft.bands[key]);
              onEdit();
            },
          }),
          "and above",
        ),
      );
    }

    const ranges = (preview && preview.bandRanges) || state.bandRanges || [];
    const counts = (preview && preview.proposed) || {};
    const hasCounts = !!(preview && preview.proposed);
    const body = el("tbody", {});
    for (const band of ranges) {
      body.append(
        el(
          "tr",
          {},
          el("td", {}, sevBadge(band.severity)),
          el("td", { class: "num" }, `${band.min}–${band.max}`),
          el("td", { class: "num" }, hasCounts ? String(counts[band.severity] ?? 0) : "—"),
        ),
      );
    }

    levelsHost.append(
      el("h3", {}, "Levels"),
      el(
        "p",
        { class: "small muted", style: "margin:0 0 10px" },
        "Where a score lands on the scale. Thresholds apply the moment you save — levels " +
          "are re-derived from each stored score on read, so no recompute is needed.",
      ),
      row,
      el(
        "div",
        { class: "table-wrap", style: "margin-top:12px" },
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el("tr", {}, el("th", {}, "Level"), el("th", {}, "Score"), el("th", {}, "Assets")),
          ),
          body,
        ),
      ),
    );
  }

  // ------------------------------------------------------------------------ preview

  function paintPreview() {
    clear(previewHost);
    previewHost.append(el("h3", {}, "Impact on the current inventory"));

    const errors = draftErrors(draft);
    if (errors.length) {
      previewHost.append(
        emptyState("Fix the errors above to preview.", errors[0]),
      );
      return;
    }
    if (previewError) {
      previewHost.append(emptyState("Couldn't preview this rule.", previewError));
      return;
    }
    if (!preview) {
      previewHost.append(
        el(
          "div",
          { style: "display:flex; flex-direction:column; gap:12px" },
          skeleton("line", { width: "60%" }),
          skeleton("chart", { height: "120px" }),
        ),
      );
      return;
    }
    if (!preview.total) {
      previewHost.append(
        emptyState(
          "No inventory to compare against.",
          "Run a sync first; the rule still saves and applies to the next one.",
        ),
      );
      return;
    }

    const distBody = el("tbody", {});
    for (const band of preview.bandRanges) {
      const now = preview.current[band.severity] ?? 0;
      const next = preview.proposed[band.severity] ?? 0;
      const delta = next - now;
      distBody.append(
        el(
          "tr",
          {},
          el("td", {}, sevBadge(band.severity)),
          el("td", { class: "num" }, String(now)),
          el("td", { class: "num" }, String(next)),
          el(
            "td",
            { class: "num" },
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

    // Level and score changes are counted apart: moving a threshold re-labels assets
    // without touching a score, and rolling both into one number would misreport it.
    let headline;
    if (!preview.moverCount) {
      headline = `Nothing changes across ${preview.total} assets.`;
    } else {
      const parts = [];
      if (preview.scoreChangeCount) parts.push(`${preview.scoreChangeCount} change score`);
      if (preview.levelChangeCount) parts.push(`${preview.levelChangeCount} change level`);
      headline = `Of ${preview.total} assets, ${parts.join(" and ")}.`;
    }

    previewHost.append(
      el(
        "p",
        { class: "small muted", style: "margin:0 0 10px" },
        headline + (previewing ? " · updating…" : ""),
      ),
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Level"),
              el("th", {}, "Now"),
              el("th", {}, "Proposed"),
              el("th", {}, "Change"),
            ),
          ),
          distBody,
        ),
      ),
    );

    if (!preview.movers.length) return;

    const moverBody = el("tbody", {});
    for (const m of preview.movers) {
      moverBody.append(
        el(
          "tr",
          {},
          el("td", {}, m.name),
          el("td", {}, aarsChip(m.fromScore, m.fromSeverity)),
          el("td", { class: "muted", "aria-hidden": "true" }, "→"),
          el("td", {}, aarsChip(m.toScore, m.toSeverity)),
          el(
            "td",
            { class: "num" },
            m.levelChanged ? statusPill("warn", "level") : el("span", { class: "muted" }, "score"),
          ),
        ),
      );
    }

    fill(
      previewHost,
      el("h3", { style: "margin-top:18px" }, "What moves"),
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "data" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Asset"),
              el("th", {}, "Now"),
              el("th", { "aria-hidden": "true" }, ""),
              el("th", {}, "Proposed"),
              el("th", {}, "Kind of change"),
            ),
          ),
          moverBody,
        ),
      ),
      preview.truncated
        ? el(
            "p",
            { class: "small muted", style: "margin:8px 0 0" },
            `Showing the ${preview.movers.length} most consequential of ${preview.moverCount} — ` +
              "level changes first, then the largest score moves.",
          )
        : null,
    );
  }

  // ------------------------------------------------------------------------ sandbox

  function paintSandbox() {
    clear(sandboxHost);

    const countsRow = el("div", { class: "rule-row" });
    for (const sev of SEVERITY_KEYS) {
      countsRow.append(
        field(
          `${sev} issues`,
          numberInput({
            value: sample.counts[sev],
            min: 0,
            max: 20,
            ariaLabel: `Number of open ${sev} issues on the hypothetical asset`,
            onInput: (v) => {
              sample.counts[sev] = Math.max(0, num(v, sample.counts[sev]));
              scheduleSample();
            },
          }),
        ),
      );
    }

    const codesInput = el("input", {
      type: "text",
      value: sample.gapCodes.join(", "),
      class: "rule-code",
      style: "min-width:260px",
      "aria-label": "Compliance gap codes, comma separated",
    });
    codesInput.addEventListener("input", () => {
      sample.gapCodes = codesInput.value
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      scheduleSample();
    });

    const exposureSel = el(
      "select",
      { "aria-label": "Data exposure of the hypothetical asset" },
      ...EXPOSURES.map((pair) =>
        el("option", { value: pair[0], selected: sample.dataExposure === pair[0] || null }, pair[1]),
      ),
    );
    exposureSel.addEventListener("change", () => {
      sample.dataExposure = exposureSel.value;
      scheduleSample();
    });

    const quickAdd = el("div", { class: "pill-row" });
    for (const code of COMMON_GAP_CODES) {
      const on = sample.gapCodes.indexOf(code) >= 0;
      const btn = el(
        "button",
        { class: "kind-pill", "aria-pressed": on ? "true" : "false" },
        code,
      );
      btn.addEventListener("click", () => {
        const at = sample.gapCodes.indexOf(code);
        if (at >= 0) sample.gapCodes.splice(at, 1);
        else sample.gapCodes.push(code);
        paintSandbox();
        scheduleSample();
      });
      quickAdd.append(btn);
    }

    let result;
    if (!sampleResult) {
      result = skeleton("pill", { width: "180px" });
    } else if (sampleResult.error) {
      result = el("span", { class: "small muted" }, sampleResult.error);
    } else {
      const p = sampleResult.pillars;
      const breakdown = sampleResult.gapBreakdown || [];
      result = el(
        "div",
        { class: "sandbox-result", role: "status" },
        aarsChip(sampleResult.score, sampleResult.severity),
        el(
          "span",
          { class: "small muted" },
          `A ${p.toxic} + B ${p.compliance} + C ${p.data}` +
            (p.toxic + p.compliance + p.data > sampleResult.score ? " (clamped to 100)" : ""),
        ),
        breakdown.length
          ? el(
              "span",
              { class: "small muted" },
              "Gaps: " + breakdown.map((g) => `${g.code} ${g.points}`).join(", "),
            )
          : null,
      );
    }

    sandboxHost.append(
      el("h3", {}, "Try a hypothetical asset"),
      el(
        "p",
        { class: "small muted", style: "margin:0 0 10px" },
        "Scored by the server with your draft rule — the same code that scores the real " +
          "inventory, so what you see here is what a matching asset would get.",
      ),
      countsRow,
      el(
        "div",
        { class: "rule-row" },
        field("Compliance gap codes", codesInput),
        field("Data exposure", exposureSel),
      ),
      quickAdd,
      el("div", { style: "margin-top:12px" }, result),
    );
  }

  function paintAll() {
    paintStatus();
    paintPillarA();
    paintPillarB();
    paintPillarC();
    paintLevels();
    paintPreview();
    paintSandbox();
  }

  paintAll();
  schedulePreview();
  scheduleSample();
}
