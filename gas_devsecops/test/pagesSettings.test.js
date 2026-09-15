// settings.js — the page the Phase 2 Wave 5 table never assigned to anyone (see the module
// header on the page itself). NO BOOTED DOM (vitest.config.ts sets no `environment`), so this
// tests the pure view-model half directly — the same split test/pagesData.test.js and
// test/pagesLit.test.js already use — and reads the DOM half as source text.
//
// THE ASSERTION THAT MATTERS MOST HERE: fetchSeverities.secrets ships `[]` on purpose
// (domain/config.ts's DEFAULT_FETCH_SEVERITIES — severity grades a detection, not whether a
// credential is live) and this page must render that as "All severities", never as "None" or
// "no severities selected". Getting this backwards would invert the most carefully-argued
// default in the whole register on the one page whose job is to show it to an operator.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUTO_COMPACT_OFF_NOTE, BATCHED_KEYS, DEFAULT_SYNC_HOUR, DEFAULT_TAB, FIELD_TABS,
  RETENTION_FLOOR_DAYS, SCOPE_LABELS, SETTINGS_KEYS, TABS,
  accessFieldView, changeCountText, changeSummary, changedFields, draftFromSettings,
  maintenanceFieldView, normalizeTab, registerFieldView, retentionFieldView,
  saveReconciliation, slaFieldRows,
} from "../src/client/js/pages/settings.js";
import {
  DEFAULT_SETTINGS, cleanSettings, validateSettings, withSettings,
} from "../src/domain/settingsLogic";
import {
  DEFAULT_FETCH_SEVERITIES, SCOPES, SCOPE_LABELS as DOMAIN_SCOPE_LABELS, SEVERITY_ORDER,
  SLA_TARGETS,
} from "../src/domain/config";
import { RETENTION_MIN_DAYS } from "../src/domain/maintenance";
import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const SRC = readFileSync(new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8");

// Comment-stripped, string-aware — without it, a `//` explanation ABOVE doSave that happens to
// mention "setBusy(true)" or "syncDirty()" in prose (this file's own header comment on doSave
// does exactly that, arguing the shape before the code) would satisfy an ordering assertion
// whether or not the CODE below it actually does those things in that order.
const CODE = code(SRC);

// The exact body of doSave, isolated from the rest of the page: `function doDiscard()` is the
// next declaration in source (see pages/settings.js), so this is everything between doSave's
// own opening brace and doDiscard's, and nothing else in the file can leak into the ordering
// assertions below by coincidentally containing the same identifiers.
const DOSAVE_START = CODE.indexOf("async function doSave() {");
const DOSAVE_END = CODE.indexOf("function doDiscard() {", DOSAVE_START);
const DOSAVE_CODE = CODE.slice(DOSAVE_START, DOSAVE_END);

// =========================================================================================
//  0. Not the stub anymore
// =========================================================================================

describe("settings.js is no longer the Phase 1 stub", () => {
  it("does not import or call renderStub", () => {
    expect(SRC).not.toMatch(/renderStub/);
    expect(SRC).not.toMatch(/_stub\.js/);
  });

  it("exports the render function the route table names", () => {
    expect(SRC).toMatch(/export async function renderSettings\(/);
  });
});

// =========================================================================================
//  1. The floor constants agree with the domain layer they mirror
// =========================================================================================

describe("the locally-duplicated constants match the domain values they mirror", () => {
  // The client never imports domain/*.ts (checked across the other nine pages before writing
  // this one — see the module header), so these two are necessarily separate literals. This
  // test is what keeps them from drifting apart silently.
  it("RETENTION_FLOOR_DAYS matches domain/maintenance.ts's RETENTION_MIN_DAYS", () => {
    expect(RETENTION_FLOOR_DAYS).toBe(RETENTION_MIN_DAYS);
  });

  it("DEFAULT_SYNC_HOUR matches domain/settingsLogic.ts's DEFAULT_SYNC_HOUR default", () => {
    expect(DEFAULT_SYNC_HOUR).toBe(DEFAULT_SETTINGS.syncSchedule);
  });
});

// =========================================================================================
//  2. draftFromSettings carries the full seven-key contract
// =========================================================================================

describe("draftFromSettings never drops one of the seven Settings fields", () => {
  // The two VIEW SCOPES this page does not own. Both are app-header chrome written through
  // their own endpoints (`api_setProjectView` / `api_setDomainView`), one field at a time —
  // see the module header just above SETTINGS_KEYS in pages/settings.js. So the exact-set
  // check below is "every Settings key EXCEPT the two this page does not own".
  const VIEW_SCOPES = ["projectView", "domainView"];

  it("SETTINGS_KEYS names exactly the seven PAGE-EDITABLE fields Settings declares", () => {
    const pageEditable = Object.keys(DEFAULT_SETTINGS)
      .filter((k) => VIEW_SCOPES.indexOf(k) < 0);
    expect([...SETTINGS_KEYS].sort()).toEqual(pageEditable.sort());
  });

  it.each(VIEW_SCOPES)(
    "%s is a real Settings key, and is deliberately absent from SETTINGS_KEYS",
    (key) => {
      // Pins the exclusion as intentional rather than accidental: a Settings field that exists
      // but a future edit forgets to route anywhere should fail LOUDLY as "missing everywhere",
      // not silently pass a same-length-array check that never named the field at all.
      expect(Object.keys(DEFAULT_SETTINGS)).toContain(key);
      expect(SETTINGS_KEYS).not.toContain(key);
      expect(Object.keys(FIELD_TABS)).not.toContain(key);
      expect(BATCHED_KEYS).not.toContain(key);
      expect(Object.keys(draftFromSettings(DEFAULT_SETTINGS))).not.toContain(key);
    },
  );

  it("produces exactly those seven keys from a real Settings object", () => {
    expect(Object.keys(draftFromSettings(DEFAULT_SETTINGS)).sort()).toEqual([...SETTINGS_KEYS].sort());
  });

  it("produces exactly those seven keys from nothing at all", () => {
    expect(Object.keys(draftFromSettings(null)).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(Object.keys(draftFromSettings(undefined)).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(Object.keys(draftFromSettings({})).sort()).toEqual([...SETTINGS_KEYS].sort());
  });

  it("round-trips a real Settings object through cleanSettings unchanged", () => {
    const draft = draftFromSettings(DEFAULT_SETTINGS);
    expect(cleanSettings(draft)).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips through withSettings, keeping every OTHER field when one is patched", () => {
    const draft = draftFromSettings(DEFAULT_SETTINGS);
    const patched = { ...draft, autoCompact: true };
    const merged = withSettings(DEFAULT_SETTINGS, patched);
    expect(Object.keys(merged).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(merged.autoCompact).toBe(true);
    for (const key of SETTINGS_KEYS) {
      if (key === "autoCompact") continue;
      expect(merged[key], `${key} was dropped or changed by an unrelated patch`).toEqual(DEFAULT_SETTINGS[key]);
    }
  });

  it("copies arrays and per-scope records rather than aliasing the input", () => {
    const settings = { ...DEFAULT_SETTINGS, scopes: [...SCOPES] };
    const draft = draftFromSettings(settings);
    draft.scopes.push("bogus");
    draft.fetchSeverities.sca.push("BOGUS");
    expect(settings.scopes).toEqual([...SCOPES]);
    expect(settings.fetchSeverities.sca).toEqual(DEFAULT_SETTINGS.fetchSeverities.sca);
  });
});

// =========================================================================================
//  3. fetchSeverities.secrets === [] renders as "All severities" — never "None"
// =========================================================================================

describe("the secrets empty-list default renders as ALL severities, never none", () => {
  it("DEFAULT_FETCH_SEVERITIES.secrets is really []", () => {
    expect(DEFAULT_FETCH_SEVERITIES.secrets).toEqual([]);
  });

  it("registerFieldView reads an empty secrets list as allSelected", () => {
    const v = registerFieldView("secrets", []);
    expect(v.allSelected).toBe(true);
    expect(v.displayText).toBe("All severities");
  });

  it("never renders the empty case as None, Empty, or No severities", () => {
    const v = registerFieldView("secrets", []);
    expect(v.displayText).not.toMatch(/none/i);
    expect(v.displayText).not.toMatch(/^no severities/i);
    expect(v.displayText).not.toBe("");
  });

  it("draws the same conclusion for a non-secrets scope with an empty list, since the "
    + "semantics are per-scope emptiness, not a secrets-only special case", () => {
    expect(registerFieldView("sca", []).displayText).toBe("All severities");
  });

  it("a non-empty selection displays exactly the severities chosen, joined", () => {
    const v = registerFieldView("secrets", ["HIGH", "LOW"]);
    expect(v.allSelected).toBe(false);
    expect(v.displayText).toBe("HIGH, LOW");
  });

  it("secrets carries the detection-not-liveness note; a vulnerability register does not "
    + "repeat it", () => {
    expect(registerFieldView("secrets", []).note).toMatch(/detection/i);
    expect(registerFieldView("sca", []).note).not.toMatch(/detection/i);
  });

  // PERTURBATION (recorded, then reverted): flipping registerFieldView's ternary so an empty
  // list reads as "None" instead of "All severities" turned exactly the three tests above
  // that assert on displayText red — 3 of the file's tests failed, the rest (including the
  // unrelated draftFromSettings and retention tests) stayed green. See the report for the
  // measured count.
});

// =========================================================================================
//  4. autoCompact defaults to off, and the view model says so
// =========================================================================================

describe("autoCompact defaults off, and is never presented as recommended-on", () => {
  it("DEFAULT_SETTINGS.autoCompact is false (the domain layer's own contract)", () => {
    expect(DEFAULT_SETTINGS.autoCompact).toBe(false);
  });

  it("draftFromSettings defaults autoCompact to false from an empty/junk settings object", () => {
    expect(draftFromSettings({}).autoCompact).toBe(false);
    expect(draftFromSettings({ autoCompact: "true" }).autoCompact).toBe(false); // only a literal true
    expect(draftFromSettings({ autoCompact: true }).autoCompact).toBe(true);
  });

  it("maintenanceFieldView reports autoCompact off for a fresh draft", () => {
    const v = maintenanceFieldView(draftFromSettings({}));
    expect(v.autoCompact).toBe(false);
  });

  it("the off-note never reads as a recommendation to turn it on", () => {
    expect(AUTO_COMPACT_OFF_NOTE).toMatch(/off by default/i);
    expect(AUTO_COMPACT_OFF_NOTE).not.toMatch(/recommend/i);
  });

  // PERTURBATION (recorded, then reverted): defaulting draftFromSettings's autoCompact to
  // `true` when the source object omits the field turned 2 tests in this block red (the
  // draftFromSettings default and the maintenanceFieldView default); the DEFAULT_SETTINGS and
  // note-text tests, which pin the domain layer and the string rather than this function,
  // stayed green. See the report for the measured count.
});

// =========================================================================================
//  5. retentionDays below the floor shows the floor
// =========================================================================================

describe("a retentionDays below the floor is shown as the floor, not the typed value", () => {
  it("RETENTION_FLOOR_DAYS matches the domain floor", () => {
    expect(RETENTION_FLOOR_DAYS).toBe(RETENTION_MIN_DAYS);
  });

  it("a below-floor value is flagged and displayed at the floor", () => {
    const v = retentionFieldView(5);
    expect(v.belowFloor).toBe(true);
    expect(v.displayValue).toBe(RETENTION_FLOOR_DAYS);
    // and the RAW typed value is still carried, so the caller can tell the two apart
    expect(v.value).toBe(5);
  });

  it("an in-range value is shown as typed, with no floor flag", () => {
    const v = retentionFieldView(90);
    expect(v.belowFloor).toBe(false);
    expect(v.displayValue).toBe(90);
  });

  it("saveReconciliation reports the server's own clamp, from its own response", () => {
    const notes = saveReconciliation({ retentionDays: 5 }, { retentionDays: RETENTION_MIN_DAYS });
    expect(notes.join(" ")).toMatch(new RegExp(`${RETENTION_MIN_DAYS} day`));
    expect(notes.join(" ")).toMatch(/floor/i);
  });

  it("saveReconciliation reports nothing when the server stored exactly what was sent", () => {
    expect(saveReconciliation({ retentionDays: 90 }, { retentionDays: 90 })).toEqual([]);
  });

  it("saveReconciliation reports a syncSchedule fallback the same way", () => {
    const notes = saveReconciliation({ syncSchedule: 99 }, { syncSchedule: DEFAULT_SYNC_HOUR });
    expect(notes.join(" ")).toMatch(/out of range/i);
  });

  // PERTURBATION (recorded, then reverted): changing retentionFieldView's displayValue to
  // `value` (dropping the Math.max floor clamp) turned 1 test in this block red — the
  // below-floor displayValue assertion; the in-range test and the two saveReconciliation
  // tests, which do not exercise the clamp, stayed green. See the report for the measured
  // count.

  it("matches the server's own clamp behaviour for the same inputs (cross-check against "
    + "domain/maintenance.ts)", () => {
    for (const bad of [1, 0, -50]) {
      expect(cleanSettings({ retentionDays: bad }).retentionDays).toBe(RETENTION_MIN_DAYS);
      expect(retentionFieldView(bad).displayValue).toBe(RETENTION_FLOOR_DAYS);
    }
  });
});

// =========================================================================================
//  6. canEditAccess: false yields no editing affordance
// =========================================================================================

describe("access is state, not an editing affordance, unless canEditAccess says otherwise", () => {
  it("a viewer who may not edit access gets no manage hint at all", () => {
    const v = accessFieldView(false);
    expect(v.canEditAccess).toBe(false);
    expect(v.manageHint).toBeNull();
  });

  it("junk/absent canEditAccess reads as false, not as open", () => {
    for (const junk of [undefined, null, 0, "", "true", 1]) {
      expect(accessFieldView(junk).canEditAccess).toBe(false);
    }
  });

  it("a permitted viewer gets a hint naming where the roster actually lives — never a "
    + "button, action, or input descriptor, because this build has no roster RPC", () => {
    const v = accessFieldView(true);
    expect(v.canEditAccess).toBe(true);
    expect(typeof v.manageHint).toBe("string");
    expect(v.manageHint.length).toBeGreaterThan(0);
  });

  it("neither state ever carries an actionable field — no page in this build offers "
    + "roster editing, so the view model never claims one", () => {
    for (const view of [accessFieldView(true), accessFieldView(false)]) {
      const keys = Object.keys(view);
      expect(keys).not.toContain("actions");
      expect(keys).not.toContain("onSave");
      expect(keys).not.toContain("action");
    }
  });

  it("never implies an unset allowlist is open — it fails closed", () => {
    const note = accessFieldView(false).failsClosedNote;
    expect(note).toMatch(/owner-only/);
    expect(note).toMatch(/fails closed/i);
    // "open" appears only inside the negation ("never as open"); it must never stand alone
    // as an affirmative claim like "reads as open" or "is open".
    expect(note).not.toMatch(/\bis open\b/i);
    expect(note).not.toMatch(/reads as open\b/i);
  });

  // PERTURBATION (recorded, then reverted): setting `manageHint` unconditionally (dropping
  // the `editable ? ... : null` branch) turned 1 test in this block red — the
  // "no manage hint at all" assertion for canEditAccess: false; the junk-input and
  // permitted-viewer tests stayed green because they do not check the false case's hint
  // value directly against null in the same way. See the report for the measured count.
});

// =========================================================================================
//  7. Every glossary id this page reaches for resolves in helpContent.js
// =========================================================================================

describe("every glossary id settings.js uses is a real entry", () => {
  const HELP_SRC = readFileSync(
    new URL("../src/client/js/helpContent.js", import.meta.url), "utf8",
  );
  const defined = new Set([...HELP_SRC.matchAll(/^\s*id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]));

  it("found a real glossary to check against", () => {
    expect(defined.size).toBeGreaterThan(15);
  });

  it("names no undefined id, across every id-carrying call shape this page uses", () => {
    const ID_PATTERNS = [
      /glossaryTip\([^,]+,\s*"([a-z0-9-]+)"/g,
      /\bterm:\s*"([a-z0-9-]+)"/g,
    ];
    let checked = 0;
    for (const pattern of ID_PATTERNS) {
      for (const m of SRC.matchAll(pattern)) {
        checked++;
        expect(defined.has(m[1]), `settings.js reaches an undefined glossary id: ${m[1]}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// =========================================================================================
//  8. Tab plumbing: normalizeTab, dirty summary, save-bar text
// =========================================================================================

describe("tab plumbing", () => {
  it("TABS has exactly the four sections the stub promised: register, deadlines, access, system", () => {
    expect(TABS.map((t) => t.key)).toEqual(["register", "deadlines", "access", "system"]);
  });

  it("normalizeTab falls back to DEFAULT_TAB for anything not in TABS", () => {
    expect(normalizeTab("register")).toBe("register");
    expect(normalizeTab("nonsense")).toBe(DEFAULT_TAB);
    expect(normalizeTab(undefined)).toBe(DEFAULT_TAB);
    expect(normalizeTab(null)).toBe(DEFAULT_TAB);
  });

  it("BATCHED_KEYS is six of the seven fields — showExperimental is deliberately excluded", () => {
    expect(BATCHED_KEYS.sort()).toEqual(
      ["scopes", "fetchSeverities", "slaTargets", "syncSchedule", "autoCompact", "retentionDays"].sort(),
    );
    expect(BATCHED_KEYS).not.toContain("showExperimental");
  });

  it("every batched key names a real tab", () => {
    for (const key of BATCHED_KEYS) {
      expect(TABS.map((t) => t.key)).toContain(FIELD_TABS[key]);
    }
  });

  it("changedFields is empty for two identical drafts", () => {
    const d = draftFromSettings(DEFAULT_SETTINGS);
    expect(changedFields(d, d)).toEqual([]);
  });

  it("changedFields ignores selection order in arrays (a pill re-toggled the same set is not a change)", () => {
    const a = draftFromSettings(DEFAULT_SETTINGS);
    const b = draftFromSettings(DEFAULT_SETTINGS);
    b.scopes = [...b.scopes].reverse();
    expect(changedFields(a, b)).toEqual([]);
  });

  it("changedFields finds a real change and names the right field", () => {
    const a = draftFromSettings(DEFAULT_SETTINGS);
    const b = draftFromSettings(DEFAULT_SETTINGS);
    b.autoCompact = true;
    expect(changedFields(a, b)).toEqual(["autoCompact"]);
  });

  it("changeSummary names the owning tab for a batched field, and never mentions "
    + "showExperimental even if it were somehow in the changed list", () => {
    const summary = changeSummary(["autoCompact", "showExperimental"]);
    expect(summary.map((s) => s.field)).toEqual(["autoCompact"]);
    expect(summary[0].tab).toBe("system");
    expect(summary[0].tabLabel).toBe("System");
  });

  it("changeCountText pluralizes correctly", () => {
    // Array form now, matching the kernel (gas_shared/ui/settingsForm.js) and gas/gas_ai's own
    // signature — this page used to be the one holdout taking a plain count.
    expect(changeCountText([])).toBe("0 unsaved changes");
    expect(changeCountText(["autoCompact"])).toBe("1 unsaved change");
    expect(changeCountText(["autoCompact", "scopes"])).toBe("2 unsaved changes");
  });
});

// =========================================================================================
//  9. slaFieldRows orders by severity and excludes UNKNOWN
// =========================================================================================

describe("slaFieldRows", () => {
  it("orders the real SLA_TARGETS by SEVERITY_ORDER, UNKNOWN excluded", () => {
    const rows = slaFieldRows(SLA_TARGETS, SEVERITY_ORDER);
    expect(rows.map((r) => r.sev)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
    expect(rows.map((r) => r.sev)).not.toContain("UNKNOWN");
  });

  it("carries the real day counts", () => {
    const rows = slaFieldRows(SLA_TARGETS, SEVERITY_ORDER);
    for (const r of rows) expect(r.days).toBe(SLA_TARGETS[r.sev]);
  });

  it("never throws on a missing or malformed slaTargets", () => {
    expect(slaFieldRows(null, SEVERITY_ORDER)).toEqual([]);
    expect(slaFieldRows(undefined, SEVERITY_ORDER)).toEqual([]);
    expect(() => slaFieldRows({}, null)).not.toThrow();
  });
});

// =========================================================================================
//  10. Cross-check: this page's constants agree with validateSettings' own error text
// =========================================================================================

describe("cross-checks against the domain layer's own validation", () => {
  it("DEFAULT_SETTINGS passes validateSettings with no complaint (sanity: the fixture this "
    + "whole file leans on is itself valid)", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
  });

  it("SCOPE_LABELS has an entry for every scope the domain layer declares", () => {
    for (const scope of SCOPES) expect(SCOPE_LABELS[scope], `${scope} has no label`).toBeTruthy();
  });

  // settings.js's own header says the client never imports domain/*.ts, so SCOPE_LABELS is a
  // literal copy of config.ts's SCOPE_LABELS rather than a read of it — two copies are allowed
  // to exist only while a test holds them byte-equal, which is what this pins.
  it("SCOPE_LABELS is byte-equal to domain/config.ts's own SCOPE_LABELS", () => {
    expect(SCOPE_LABELS).toEqual(DOMAIN_SCOPE_LABELS);
  });
});

// =========================================================================================
//  11. doSave, read as source text — four defects, four regressions this pins
// =========================================================================================
//
// NO JSDOM (this file's own header), so doSave itself is never executed here — the same
// bargain test/settingsDom.test.js (gas) makes for its own page. Every check below runs
// against DOSAVE_CODE, doSave's own body sliced out of the comment-stripped source (see the
// helpers above `SRC`), so a `//` explanation of the shape — this file carries one, right above
// `async function doSave()` — can never stand in for the code actually doing it.

describe("doSave found its own body in source (a canary for the two slice markers above)", () => {
  it("DOSAVE_CODE is non-empty and contains the send", () => {
    // If either marker (`async function doSave() {` / `function doDiscard() {`) ever drifts —
    // renamed, reordered — DOSAVE_START/DOSAVE_END silently produce -1 or an empty slice, and
    // every assertion below would vacuously pass on nothing. This is what stops that.
    expect(DOSAVE_START).toBeGreaterThan(-1);
    expect(DOSAVE_END).toBeGreaterThan(DOSAVE_START);
    expect(DOSAVE_CODE.length).toBeGreaterThan(200);
    expect(DOSAVE_CODE).toMatch(/call\(\s*"api_putSettings"/);
  });
});

describe("doSave validates and confirms BEFORE it ever sends", () => {
  // Order is the whole point (this file's brief, verbatim): a confirm shown before validation
  // asks the reader to approve something that will then be refused.
  const idxErrors = DOSAVE_CODE.indexOf("Object.keys(errors)");
  const idxValidate = DOSAVE_CODE.indexOf("validateDraft(draft)");
  const idxWarnings = DOSAVE_CODE.indexOf("draftWarnings(saved, draft");
  const idxConfirm = DOSAVE_CODE.indexOf("confirmDialog(");
  const idxSend = DOSAVE_CODE.indexOf('call("api_putSettings"');

  it("finds all five landmarks in doSave's own body", () => {
    for (const [name, idx] of [
      ["Object.keys(errors)", idxErrors], ["validateDraft(draft)", idxValidate],
      ["draftWarnings(saved, draft", idxWarnings], ["confirmDialog(", idxConfirm],
      ['call("api_putSettings"', idxSend],
    ]) expect(idx, `${name} not found in doSave`).toBeGreaterThan(-1);
  });

  it("checks the per-field errors gate before the committed draft", () => {
    expect(idxErrors).toBeLessThan(idxValidate);
  });

  it("validates the committed draft before asking draftWarnings anything", () => {
    expect(idxValidate).toBeLessThan(idxWarnings);
  });

  it("computes the warnings before showing any confirmDialog", () => {
    expect(idxWarnings).toBeLessThan(idxConfirm);
  });

  it("shows every confirmDialog before the network send", () => {
    expect(idxConfirm).toBeLessThan(idxSend);
  });

  it("bails out of the warnings loop on a decline, before the send", () => {
    // `for (const w of warnings) { ... if (!ok) return; }` — a declined confirm must return out
    // of doSave entirely, not merely skip one warning and fall through to bar.setBusy(true).
    const loop = DOSAVE_CODE.slice(idxWarnings, idxSend);
    expect(loop).toMatch(/for \(const w of warnings\)/);
    expect(loop).toMatch(/if \(!ok\) return;/);
  });
});

describe("doSave actually reaches draftWarnings and feeds its result to confirmDialog", () => {
  // The brief's own warning: "a test that only asserts the import would pass against the old
  // broken page." This checks the CALL, with the warning object's own fields threaded through —
  // not merely that the two identifiers appear somewhere in the file.
  it("calls draftWarnings with (saved, draft, ctx), not a bare re-export", () => {
    expect(DOSAVE_CODE).toMatch(/const warnings = draftWarnings\(saved, draft, \{/);
  });

  it("the ctx it builds carries the four fields draftWarnings needs (settingsModel.js's own "
    + "signature)", () => {
    const ctxSlice = DOSAVE_CODE.slice(
      DOSAVE_CODE.indexOf("draftWarnings(saved, draft, {"),
      DOSAVE_CODE.indexOf("confirmDialog("),
    );
    expect(ctxSlice).toMatch(/scopes:\s*scopeList/);
    expect(ctxSlice).toMatch(/severityOrder/);
    expect(ctxSlice).toMatch(/scopeLabels:\s*SCOPE_LABELS/);
    expect(ctxSlice).toMatch(/sharedSlaTargets:\s*boot\.slaTargets/);
  });

  it("awaits confirmDialog with the warning's own title/body/confirmLabel, danger:true", () => {
    expect(DOSAVE_CODE).toMatch(
      /await confirmDialog\(\{\s*title:\s*w\.title,\s*body:\s*w\.body,\s*confirmLabel:\s*w\.confirmLabel,\s*danger:\s*true,?\s*\}\)/,
    );
  });
});

describe("bar.setBusy(false) is reachable on the SUCCESS path, not only on failure", () => {
  // The specific defect: the old doSave called setBusy(true), then only ever called
  // setBusy(false) from the catch block — a successful save left the button disabled forever.
  // This asserts the finally itself, not merely that the string "setBusy(false)" appears
  // somewhere in the file (which the old, broken doSave already satisfied, from its catch).
  it("setBusy(false) sits in a finally block, not only in the catch", () => {
    expect(DOSAVE_CODE).toMatch(/\}\s*finally\s*\{\s*bar\.setBusy\(false\);\s*\}/);
  });

  it("the catch block does not ALSO call setBusy(false) — finally is the only place, so a "
    + "reader can't mistake this for the old two-copies shape", () => {
    const catchSlice = DOSAVE_CODE.slice(
      DOSAVE_CODE.indexOf("} catch (e) {"),
      DOSAVE_CODE.indexOf("} finally {"),
    );
    expect(catchSlice).not.toMatch(/setBusy\(false\)/);
  });

  it("the try block itself never calls setBusy(false) before the finally — only setBusy(true), "
    + "once, at the top", () => {
    const trySlice = DOSAVE_CODE.slice(
      DOSAVE_CODE.indexOf("bar.setBusy(true);"),
      DOSAVE_CODE.indexOf("} catch (e) {"),
    );
    expect(trySlice.match(/setBusy\(/g)).toEqual(["setBusy("]); // exactly the setBusy(true) at the top
  });
});

describe("a successful save re-baselines saved from the response and clears the save bar", () => {
  // The other half of the same defect: `saved` used to never move, so `syncDirty()` (never
  // called either) would have kept reporting every batched field as still dirty forever.
  const idxSend = DOSAVE_CODE.indexOf('call("api_putSettings"');
  const idxRebaseline = DOSAVE_CODE.indexOf("saved = draftFromSettings(result)");
  const idxSyncDirty = DOSAVE_CODE.indexOf("syncDirty()", idxSend);
  const idxCatch = DOSAVE_CODE.indexOf("} catch (e) {");

  it("re-baselines saved from the server's OWN response, not from the sent draft", () => {
    // Specifically `result` (what the server actually stored), never `sent` (what was asked
    // for) — cleanSettings can rewrite retentionDays/syncSchedule, and `saved` has to track
    // the rewrite, not the request. Searching for the `sent` shape confirms it is genuinely
    // absent, rather than merely that the `result` shape happens to appear somewhere too.
    expect(idxRebaseline).toBeGreaterThan(-1);
    expect(DOSAVE_CODE).not.toMatch(/saved = draftFromSettings\(sent\)/);
  });

  it("re-baselines and calls syncDirty() after the send, and before the catch — i.e. on the "
    + "success path, inside the try", () => {
    expect(idxSend).toBeLessThan(idxRebaseline);
    expect(idxRebaseline).toBeLessThan(idxSyncDirty);
    expect(idxSyncDirty).toBeLessThan(idxCatch);
  });
});

// =========================================================================================
//  12. The active tab round-trips into the hash
// =========================================================================================
//
// `normalizeTab(params.tab)` was already honoured on ENTRY (section 8 above pins normalizeTab
// itself); what was missing is the other direction — using the page never produced
// `#/settings?tab=deadlines` for anyone to bookmark, refresh, or share, because onSelect never
// told the URL a tab had changed.

describe("tabList's onSelect writes the active tab back into the hash", () => {
  // Bounded like settingsDom.test.js's own aria-describedby sweep (`[\s\S]{0,N}`) rather than
  // an unbounded `[\s\S]*`, so this can only match the ONE onSelect this page defines, not
  // wander into an unrelated setParams call anywhere else in the module.
  const onSelectMatch = CODE.match(/onSelect:\s*\(key\)\s*=>\s*\{[\s\S]{0,300}?\}\s*,\s*\}\s*\);/);

  it("finds the tabList(...) call's onSelect handler in source", () => {
    expect(onSelectMatch).not.toBeNull();
  });

  it("calls setParams({ tab: key }) from inside onSelect — history.replaceState, no re-render", () => {
    expect(onSelectMatch[0]).toMatch(/setParams\(\s*\{\s*tab:\s*key\s*\}\s*\)/);
  });

  it("imports setParams from the shared store, not a local reimplementation", () => {
    expect(CODE).toMatch(/import\s*\{[^}]*\bsetParams\b[^}]*\}\s*from\s*"[^"]*\/gas_shared\/store\.js"/);
  });
});

describe("confirmDialog and the settingsModel gates are real imports, not just referenced", () => {
  // Necessary but not sufficient on its own — section 11 above is what proves the import is
  // actually EXERCISED on the save path; this just guards against the import line itself
  // silently disappearing in a future edit.
  it("imports confirmDialog from the app's ui.js barrel (which re-exports gas_shared's)", () => {
    expect(CODE).toMatch(/import\s*\{[^}]*\bconfirmDialog\b[^}]*\}\s*from\s*"\.\.\/ui\.js"/);
  });

  it("imports draftWarnings and validateDraft from settingsModel.js", () => {
    expect(CODE).toMatch(/import\s*\{[^}]*\bdraftWarnings\b[^}]*\}\s*from\s*"\.\.\/settingsModel\.js"/);
    expect(CODE).toMatch(/import\s*\{[^}]*\bvalidateDraft\b[^}]*\}\s*from\s*"\.\.\/settingsModel\.js"/);
  });
});
