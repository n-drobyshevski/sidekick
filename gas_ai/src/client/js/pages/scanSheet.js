// The Wiz Scans drill-down: what an area is, what it reported, and — the point of this
// module — the queries behind it, verbatim, with the variables they send.
//
// The panel used to print a hand-typed label like "graphSearch · PROTECTED_BY with
// negate:true". That is the drift class this page spent its whole rebuild removing from its
// numbers: prose describing a thing, free to diverge from the thing. The document here is
// read from the server, so it cannot.
//
// EDITING IS SCOPED TO VARIABLES, and the reason is in src/domain/scanVars.ts: every
// normalizer couples to the document's selection set, a variable cannot change a selection
// set, and five of the steps carry invariants their response cannot confirm. A step with no
// editable variables says so, with the reason — a lock without a reason reads as an
// oversight, and someone eventually "fixes" it.

import { call } from "../../../../../gas_shared/api.js";
import { navigate } from "../../../../../gas_shared/store.js";
import { COVERAGE } from "../scanContent.js";
import {
  clear, codeBlock, copyButton, el, openSheet, plural, sheetSection, toast,
} from "../ui.js";

/**
 * Ledger tab → the page that reads it, for the "lands in" leg of the provenance chain.
 *
 * A tab missing from here degrades to no gloss rather than to a wrong one, which is why
 * five of these were absent for a release without anything breaking: the posture steps were
 * tagged to the configuration-findings area, so their tabs never reached this table.
 */
const WRITES_LABEL = {
  ai_assets: "the asset register",
  ai_edges: "the graph",
  ai_issues: "toxic combinations",
  ai_findings: "compliance findings",
  ai_frameworks: "the Settings framework picker",
  ai_framework_posture: "compliance posture",
  ai_framework_policies: "compliance posture",
  // Reference data rather than a screen: the rule catalogue is what glosses an opaque
  // control id wherever one is shown, so it has no page of its own to name.
  ai_config_rules: "the rule catalogue",
  ai_identity_findings: "identity hygiene on the graph",
};

function writesLabel(writes) {
  const tab = String(writes || "").split(" ")[0].split(".")[0];
  return WRITES_LABEL[tab] || "";
}

/**
 * Open the drill-down for one resolved scan area.
 *
 * `ctx` carries what the page already fetched: the step descriptors, the last sync's
 * skipped steps, and a refresh hook for after a save.
 */
export function openAreaSheet(area, ctx) {
  const meta = COVERAGE[area.state];
  const skipped = new Set(ctx.skippedSteps || []);
  // A different list from the skips, and the difference is whose decision it was: a skip is
  // the tenant refusing the query, a truncation is the sync stopping at the page cap while
  // the tenant was still answering. Shown apart so a partial dataset is not read as a
  // rejection and sent to whoever checks permissions.
  const truncated = new Set(ctx.truncatedSteps || []);
  // Why each skip happened, keyed by step id. A skip with no entry predates the recording and
  // renders as "no reason recorded" — an absent reason and an empty one are different claims.
  const skipReasons = ctx.skipReasons || {};

  // THE QUERIES ARRIVE ON THIS CLICK, not with the page. The battery is ~42 KB of GraphQL
  // documents and variable schemas, and the register behind this sheet reads none of it —
  // it was fetched on every visit to Wiz Scans so that this panel, which many readers never
  // open, could show one area's worth. `ctx.loadSteps` memoizes per area for the life of the
  // page render, so a re-open costs no round trip; see its comment in scans.js for why that
  // lifetime is the right one.
  const queryHost = el("div", {});
  openSheet((body) => {
    const sections = [
      sheetSection("What Wiz does here", el("p", { class: "cov-para" }, area.what)),
      reportedSection(area, meta, ctx),
      queryHost,
      destinationSection(area, ctx),
    ];
    body.append(...sections.filter(Boolean));
    queryHost.append(el("p", { class: "cov-note", role: "status" }, "Loading the queries…"));

    ctx.loadSteps(area.id).then((detail) => {
      // The reader can close the sheet, or open another area, while this is in flight.
      // `isConnected` covers the close; the echoed `area` covers painting one area's
      // queries under another's heading.
      if (!queryHost.isConnected || (detail && detail.area !== area.id)) return;
      const steps = (detail && detail.steps) || [];
      clear(queryHost).append(...[
        provenanceSection(area, steps, ctx),
        ...steps.map((step) => stepSection(step, skipped, truncated, skipReasons, ctx)),
        steps.length ? null : noStepSection(area, ctx),
      ].filter(Boolean));
    }).catch((e) => {
      if (!queryHost.isConnected) return;
      // The sheet keeps everything it already had — what the area is, what it reported,
      // where the answer lands. Only the queries are missing, and it says so.
      clear(queryHost).append(el("p", { class: "cov-note" },
        "Couldn't load the queries for this area: " + String((e && e.message) || e)));
    });
  }, {
    title: area.title,
    subtitle: meta.label + " · " + meta.blurb,
    // The document needs the room; a forty-line query in a 600px drawer is a keyhole.
    expandable: true,
  });
}

// ------------------------------------------------------------------ what it reported

function reportedSection(area, meta, ctx) {
  const kids = [
    area.figure
      ? el("p", { class: "cov-para cov-sheet-figure" },
          el("strong", { class: "num" }, area.figure.value), " " + area.figure.unit)
      : el("p", { class: "cov-para cov-none" }, "No figure — " + meta.blurb + "."),
    area.note ? el("p", { class: "cov-note" }, area.note) : null,
    area.id === "toxic" && ctx.combosError
      ? el("p", { class: "cov-note" },
          "The toxic-combination payload failed to load this time: " + ctx.combosError)
      : null,
  ];
  return sheetSection("Reported in this tenant", ...kids.filter(Boolean));
}

// -------------------------------------------------------------- the provenance chain

/**
 * Where the number came from, as a chain rather than a paragraph. This is the page's own
 * thesis one level down: an area that states a figure should be able to show its lineage.
 */
function provenanceSection(area, steps, ctx) {
  if (!steps.length && !area.carriedBy) return null;
  const rows = [];

  const queryNames = steps.map((s) => s.rootField).filter(Boolean);
  if (queryNames.length) {
    rows.push(link("Query", uniq(queryNames).join(", ")));
  }
  if (steps.length) {
    rows.push(link("Sync step", steps.map((s) => s.id).join(", ")));
    const writes = uniq(steps.reduce((acc, s) => acc.concat(s.writes || []), []));
    rows.push(link("Writes", writes.join(", "), uniq(writes.map(writesLabel).filter(Boolean)).join(", ")));
  } else if (area.carriedBy) {
    rows.push(link("Carried by", area.carriedBy,
      "no query of its own — the flags ride on that step's rows"));
  }
  if (area.figure && area.figure.source) rows.push(link("Read as", area.figure.source));

  return sheetSection("Where this number comes from", el("div", { class: "prov" }, ...rows));

  function link(key, value, sub) {
    return el("div", { class: "prov-step" },
      el("div", { class: "prov-dot" }),
      el("div", {},
        el("div", { class: "prov-k" }, key),
        el("div", { class: "prov-v" }, el("span", { class: "prov-mono" }, value)),
        sub ? el("div", { class: "prov-sub" }, sub) : null),
    );
  }
}

function uniq(list) {
  const out = [];
  for (const v of list) if (v && out.indexOf(v) < 0) out.push(v);
  return out;
}

// ------------------------------------------------------------------ one step's query

function stepSection(step, skipped, truncated, skipReasons, ctx) {
  const wasSkipped = skipped.has(step.id);
  const wasTruncated = truncated.has(step.id);
  // A THIRD reading, and the only one that can say the step ran and matched nothing. The two
  // sets above record refusals and page caps; a step the tenant accepts that returns no rows
  // is in neither, and used to be indistinguishable from a step that was never reached.
  // An undefined value means not recorded (last synced before this shipped) and must NOT render as 0.
  const rows = (ctx.stepRows || {})[step.id];
  const ranEmpty = rows === 0 && !wasSkipped;
  const head = el("div", { class: "step-head" },
    el("span", { class: "step-id" }, step.id),
    wasSkipped
      ? el("span", { class: "pill warn" }, "Skipped last sync")
      : el("span", { class: "pill neutral" }, step.optional ? "Optional" : "Required"),
    wasTruncated ? el("span", { class: "pill warn" }, "Stopped at the page cap") : null,
    ranEmpty ? el("span", { class: "pill warn" }, "Ran, returned nothing") : null,
    rows ? el("span", { class: "pill ok" }, plural(rows, "row") + " last sync") : null,
    step.overridden && step.overridden.length
      ? el("span", { class: "pill ok" }, plural(step.overridden.length, "override"))
      : null,
  );

  const kids = [head];

  if (wasSkipped) {
    const reason = skipReasons[step.id];
    kids.push(el("p", { class: "cov-note" },
      "The tenant rejected this query on the last sync, so the step was skipped rather " +
      "than failing the run. Everything this step feeds is missing from the figures above."));
    // Verbatim, and as text — a paraphrase of a GraphQL validation error is worth nothing,
    // because the value is in the offending name and only the original string carries it.
    // textContent, never innerHTML: this string came off the wire from another system.
    kids.push(reason
      ? el("pre", { class: "cov-reason", "aria-label": step.id + " rejection message" }, reason)
      : el("p", { class: "small muted" },
          "No reason recorded — this skip predates the message being kept. Re-run the sync, " +
          "or probe the step below, to capture what the tenant actually says."));
  }

  if (ranEmpty) {
    kids.push(el("p", { class: "cov-note" },
      "The last sync ran this step and Wiz answered with zero rows. That is not a rejection " +
      "— the query was accepted — so it means either the landscape genuinely has nothing of " +
      "this shape, or the filter asks for something this tenant spells differently. Probe it " +
      "below: the sample row is what settles which."));
  }

  if (wasTruncated) {
    kids.push(el("p", { class: "cov-note" },
      "The last sync hit its page ceiling on this step with the cursor still open, so what " +
      "it collected is the first part of the answer rather than all of it. The figures " +
      "above undercount by an unknown amount."));
  }

  kids.push(
    el("div", { class: "q-head" },
      el("span", { class: "q-label" }, "Document"),
      copyButton(() => step.document, { title: "Copy the GraphQL document" })),
    codeBlock(step.document, { label: step.id + " GraphQL document" }),
    el("div", { class: "q-head" },
      el("span", { class: "q-label" }, "Variables"),
      copyButton(() => JSON.stringify(step.variables, null, 2), { title: "Copy the variables" })),
    codeBlock(JSON.stringify(step.variables, null, 2), { label: step.id + " variables", maxHeight: "150px" }),
    el("p", { class: "q-cap" },
      "The transport adds " +
      (ctx.transportVariables || ["first", "after"]).join(", ") +
      " to every request; they are not configuration and are not shown above. This step " +
      "reads " + (step.pageSize || 100) + " rows per page."),
  );

  // Resolved SERVER-SIDE and carried on the step. This used to be
  // `ctx.specs.filter((s) => s.stepId === step.id)[0]` — an exact-id match against a
  // catalogue — while the server's own `varSpecFor` matches a spec flagged `prefix` as a
  // prefix, which is how one entry covers a generated family. So the four
  // `COMPLIANCE_POSTURE_wf-id-*` steps never found the family spec written for them and
  // fell through to the generic lock text below, which is exactly what the flag exists to
  // prevent. One resolver, on the side that owns the rule.
  const spec = step.spec || null;
  if (step.editable && spec) kids.push(varsEditor(step, spec, ctx));
  else kids.push(lockedNote(spec), probeOnly(step, ctx));

  return sheetSection("Query · " + step.id, ...kids.filter(Boolean));
}

/**
 * A probe for a step with no editable variables — the same one-page test the variables editor
 * offers, minus the editor.
 *
 * It exists because the gate was in the wrong place. testScanVars refuses any step where
 * fields.length === 0, which is right for proposing new variable values and wrong for asking
 * a step whether it works. Every step that writes an edge — RUNS_AS, SA_FINDINGS,
 * SENSITIVE_DATA_ACCESS, HOST_EXPOSURE, ENDPOINT_EXPOSURE, IDENTITY_ACCESS — declares no
 * editable fields, so on a tenant with zero rows on ai_edges the one instrument built for
 * that exact failure could not be pointed at a single one of the six steps causing it.
 *
 * Sends no variables: api_probeSyncStep resolves the step's configured ones server-side, so
 * what the probe asks is what the battery asks. Renders through the same testResult the
 * editor uses — one reading of "rows returned vs rows the normalizer kept", not two.
 */
function probeOnly(step, ctx) {
  if (ctx.hasCredentials === false) return null;
  const out = el("div", { class: "vars-test" });
  const btn = el("button", {}, "Probe this step");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    clear(out).append(el("p", { class: "vars-test-line" }, "Asking Wiz for one page…"));
    try {
      const res = await call("api_probeSyncStep", { stepId: step.id });
      clear(out).append(testResult(res));
    } catch (e) {
      clear(out).append(
        el("p", { class: "vars-test-line is-bad" }, String((e && e.message) || e)));
    }
    btn.disabled = false;
  });
  return el("div", { class: "vars" },
    el("div", { class: "vars-bar" },
      el("span", { class: "small muted" },
        "Sends one page with this step's configured variables. Nothing is persisted."),
      btn),
    out,
  );
}

function lockedNote(spec) {
  return el("p", { class: "cov-note" },
    (spec && spec.locked)
      ? spec.locked
      : "This step's variables are fixed. Its normalizer asserts things about the response " +
        "that the response cannot confirm — the relationship type, the negation, the rule a " +
        "finding belongs to — so a changed filter here would produce confident wrong data " +
        "rather than an error.");
}

function noStepSection(area, ctx) {
  if (area.carriedBy) return null;
  return sheetSection("Query",
    el("p", { class: "cov-para cov-none" }, "No sync step issues a query for this area."),
    ctx.hasCredentials === false
      ? null
      : el("p", { class: "cov-note" },
          "Adding one needs more than a document: every step pairs its query with a " +
          "normalizer that turns the response into assets, edges or findings, and that is " +
          "code rather than configuration."));
}

// ----------------------------------------------------------------- variables editor

/**
 * Guided controls for the knobs the spec offers, with the raw JSON underneath.
 *
 * The controls are built once and mutated, never rebuilt on edit — the AARS page learned
 * that the hard way on four separate inputs. Rebuilding a control the user is typing in
 * drops the keystroke and sends focus to <body>.
 */
function varsEditor(step, spec, ctx) {
  // A stable container, NOT a reassignable local. The field controls close over whatever
  // they are handed, so reassigning `draft` on Reset or Revert left every control still
  // reading — and writing — the object it was built with: the JSON view moved and the
  // chips did not. One box that gets its contents replaced keeps them all pointed at the
  // same value.
  const box = { draft: clone(step.variables) };
  const saved = clone(step.variables);
  let busy = false;

  const dirty = () => JSON.stringify(box.draft) !== JSON.stringify(saved);

  const fields = [];
  const host = el("div", { class: "vars-fields" });
  for (const field of spec.fields) {
    const control = field.kind === "list"
      ? listControl(field, box, onEdit)
      : enumControl(field, box, onEdit);
    fields.push(control);
    host.append(control.node);
  }

  const jsonView = codeBlock("", { label: step.id + " variables as JSON", maxHeight: "140px" });
  const errorHost = el("p", { class: "vars-error", role: "alert" });
  const testHost = el("div", { class: "vars-test" });

  const saveBtn = el("button", { class: "primary" }, "Save variables");
  const revertBtn = el("button", {}, "Revert");
  const resetBtn = el("button", {}, "Reset to default");
  const testBtn = el("button", {}, "Test against Wiz");
  const state = el("span", { class: "vars-state" });

  const bar = el("div", { class: "vars-bar" }, state, testBtn, resetBtn, revertBtn, saveBtn);

  function onEdit() {
    sync();
  }

  function sync() {
    jsonView.textContent = JSON.stringify(box.draft, null, 2);
    const errs = localErrors();
    errorHost.textContent = errs[0] || "";
    errorHost.classList.toggle("is-on", !!errs.length);
    clear(state);
    if (busy) state.append(el("span", { class: "pill neutral" }, "Working…"));
    else if (dirty()) state.append(el("span", { class: "pill warn" }, "Unsaved"));
    revertBtn.disabled = !dirty() || busy;
    // Save stays enabled when invalid: a disabled control cannot explain itself. Pressing
    // it with an error says what is wrong instead of doing nothing.
    saveBtn.disabled = busy;
    resetBtn.disabled = busy;
    testBtn.disabled = busy;
    for (const f of fields) f.sync();
  }

  /** The one check worth mirroring client-side: an emptied required list. */
  function localErrors() {
    const out = [];
    for (const field of spec.fields) {
      if (field.kind !== "list" || !field.required) continue;
      const list = readPath(box.draft, field.path);
      if (Array.isArray(list) && !list.length) {
        out.push(field.label + " cannot be empty — an empty filter asks Wiz for everything.");
      }
    }
    return out;
  }

  saveBtn.addEventListener("click", async () => {
    const errs = localErrors();
    if (errs.length) { toast(errs[0], "warn"); return; }
    busy = true; sync();
    try {
      await call("api_setScanVars", { stepId: step.id, vars: box.draft });
      toast("Variables saved — the next sync uses them.");
      busy = false;
      ctx.refresh();
    } catch (e) {
      busy = false; sync();
      toast(String((e && e.message) || e), "error");
    }
  });

  revertBtn.addEventListener("click", () => {
    box.draft = clone(saved);
    sync();
  });

  resetBtn.addEventListener("click", () => {
    box.draft = clone(step.defaultVariables);
    sync();
  });

  testBtn.addEventListener("click", async () => {
    busy = true; sync();
    clear(testHost).append(el("p", { class: "vars-test-line" }, "Asking Wiz for one page…"));
    try {
      const res = await call("api_testScanVars", { stepId: step.id, vars: box.draft });
      busy = false; sync();
      clear(testHost).append(testResult(res));
    } catch (e) {
      busy = false; sync();
      clear(testHost).append(
        el("p", { class: "vars-test-line is-bad" }, String((e && e.message) || e)));
    }
  });

  sync();

  return el("div", { class: "vars" },
    el("div", { class: "vars-head" },
      el("span", { class: "q-label" }, "Variables you can change"),
      step.overridden && step.overridden.length
        ? el("span", { class: "small muted" }, "differs from the default")
        : null),
    host,
    errorHost,
    el("details", { class: "vars-json" },
      el("summary", {}, "As JSON"),
      jsonView),
    bar,
    testHost,
  );
}

/**
 * A test result reports two numbers because they answer different questions: how many rows
 * Wiz returned, and how many survived the step's own normalizer. A filter that returns a
 * hundred rows the normalizer discards is a filter that reports nothing.
 */
function testResult(res) {
  if (!res || res.ok === false) {
    return el("div", { class: "vars-test-out" },
      el("p", { class: "vars-test-line is-bad" },
        "Wiz rejected it: " + String((res && res.error) || "unknown error")),
      el("p", { class: "small muted" },
        "This step is optional, so a live sync would skip it silently rather than fail."));
  }
  const n = res.normalized || {};
  const kept = (n.nodes || 0) + (n.edges || 0) + (n.issues || 0) + (n.findings || 0);
  return el("div", { class: "vars-test-out" },
    el("p", { class: "vars-test-line" + (res.rows ? "" : " is-bad") },
      plural(res.rows || 0, "row") + " returned" +
      (res.totalCount === null || res.totalCount === undefined ? "" : " of " + res.totalCount) +
      (res.hasNextPage ? " (more pages)" : "")),
    el("p", { class: "vars-test-line" + (kept ? "" : " is-bad") },
      "the normalizer kept " +
      [
        n.nodes ? plural(n.nodes, "asset") : "",
        n.edges ? plural(n.edges, "edge") : "",
        n.issues ? plural(n.issues, "issue") : "",
        n.findings ? plural(n.findings, "finding") : "",
      ].filter(Boolean).join(", ") || "nothing"),
    res.rows && !kept
      ? el("p", { class: "cov-note" },
          "Rows came back but none survived normalization — usually a selection the step " +
          "needs is filtered out. This step would report nothing.")
      : null,
    res.sample
      ? el("details", { class: "vars-json" },
          el("summary", {}, "First row"),
          codeBlock(res.sample, { label: "First returned row", maxHeight: "140px" }))
      : null,
  );
}

// --------------------------------------------------------------------- field controls

const clone = (v) => JSON.parse(JSON.stringify(v || {}));

function readPath(obj, path) {
  let cur = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function writePath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (!next || typeof next !== "object" || Array.isArray(next)) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/** A set of string values as removable chips, plus one input that adds. */
function listControl(field, box, onEdit) {
  const chips = el("div", { class: "chipset" });
  const input = el("input", {
    type: "text",
    class: "chip-input",
    placeholder: "add a value…",
    "aria-label": "Add a value to " + field.label,
    list: field.options && field.options.length ? "opts-" + field.path.replace(/\./g, "-") : null,
  });
  const datalist = field.options && field.options.length
    ? el("datalist", { id: "opts-" + field.path.replace(/\./g, "-") },
        ...field.options.map((o) => el("option", { value: o })))
    : null;

  function values() {
    const v = readPath(box.draft, field.path);
    return Array.isArray(v) ? v : [];
  }

  function add() {
    const v = input.value.trim();
    if (!v) return;
    const list = values().slice();
    if (list.indexOf(v) < 0) list.push(v);
    writePath(box.draft, field.path, list);
    input.value = "";
    onEdit();
    input.focus();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // The sheet is a dialog; Enter would otherwise reach whatever default it has.
    e.preventDefault();
    add();
  });

  const node = el("div", { class: "vars-field" },
    el("label", { class: "vars-label" }, field.label),
    el("p", { class: "vars-help" }, field.help),
    chips,
    el("div", { class: "chip-add" }, input, el("button", { type: "button", onclick: add }, "Add")),
    datalist,
  );

  function sync() {
    clear(chips);
    const list = values();
    if (!list.length) {
      chips.append(el("span", { class: "chipset-empty" }, "empty — Wiz would return everything"));
    }
    for (const v of list) {
      chips.append(el("span", { class: "chip" }, v, el("button", {
        type: "button",
        class: "chip-x",
        "aria-label": "Remove " + v,
        onclick: () => {
          writePath(box.draft, field.path, values().filter((x) => x !== v));
          onEdit();
        },
      }, "×")));
    }
  }

  return { node, sync };
}

/** One of a fixed set. A real <select>, so the keyboard and screen reader come free. */
function enumControl(field, box, onEdit) {
  const sel = el("select", { class: "vars-select", "aria-label": field.label },
    ...(field.options || []).map((o) => el("option", { value: o }, o)));
  sel.addEventListener("change", () => {
    writePath(box.draft, field.path, sel.value);
    onEdit();
  });
  const node = el("div", { class: "vars-field" },
    el("label", { class: "vars-label" }, field.label),
    el("p", { class: "vars-help" }, field.help),
    sel,
  );
  function sync() {
    const v = readPath(box.draft, field.path);
    if (document.activeElement !== sel && v && sel.value !== v) sel.value = String(v);
  }
  return { node, sync };
}

// ------------------------------------------------------------------------ where it lands

function destinationSection(area, ctx) {
  const dest = ctx.destinationOf(area);
  if (!dest || area.state === "unscanned") return null;
  return sheetSection("Where the results land",
    el("button", {
      class: "linklike",
      type: "button",
      onclick: () => navigate(dest.id, {}),
    }, "Open the " + dest.title + " →"),
    el("p", { class: "small muted", style: "margin-top:4px" }, dest.sub),
  );
}
