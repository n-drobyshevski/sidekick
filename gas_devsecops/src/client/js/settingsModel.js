// The settings draft model: which knobs the page-level save bar owns, which tab owns each, and
// the per-tab dirty/invalid state the tablist reads.
//
// THIS FILE USED TO CARRY A SECOND, DEAD REGISTRY. An earlier `SETTINGS_TABS`/`SETTING_FIELDS`
// pair here (plus their own `settingsDraft`/`validateDraft`/`draftWarnings`/`normalizeTab`/
// `changedFields`/`changeSummary`/`changeCountText`/`dirtyTabs`) predated the page that actually
// shipped, and grepped clean: nothing in `src/` ever imported any of it. `pages/settings.js`
// built its OWN parallel Register/Deadlines/Access/System registry instead — a `TAB_FIELDS`
// half here, a `FIELD_LABELS` half there, `SETTINGS_KEYS`/`BATCHED_KEYS` split across both
// files — and it was that split, not the dead file, that this page actually ran on. The dead
// half is gone; `SETTING_FIELDS` below is the one registry both files now read, tab AND label
// in the same place `SETTING_FIELDS` holds them in gas/ and gas_ai/.
//
// `normalizeTab`/`changedFields`/`settingsPatch`/`changeSummary`/`changeCountText`/`tabStatus`
// are `gas_shared/ui/settingsForm.js`'s kernel, bound to the registry below — see that module's
// header for why its `sameValue` leaf is `a === b || Object.is(a, b)` (this app's OWN two
// former copies — the dead `sameValue` here and `pages/settings.js`'s own `sameValue` — used
// two DIFFERENT wrong leaves between them: the dead one fell back to `JSON.stringify`, matching
// gas/gas_ai's bug; the page's own live one fell back to bare `a === b`, matching the opposite
// bug. Neither survives; the kernel's disjunction does), and for why `dirtyTabs` is not part of
// it at all — `tabStatus` replaced its only call site before this page shipped.

import { settingsForm } from "../../../../gas_shared/ui/settingsForm.js";

/** The tabs, in order. `key` is what rides in the hash (`#/settings?tab=deadlines`). */
export const SETTINGS_TABS = [
  { key: "register", label: "Register" },
  { key: "deadlines", label: "Deadlines" },
  { key: "access", label: "Access" },
  { key: "system", label: "System" },
];

export const DEFAULT_TAB = "register";

/**
 * Every knob the page-level save bar batches, and where it lives. Deliberately six of the
 * seven Settings fields `pages/settings.js`'s `draftFromSettings` lifts: `showExperimental` is
 * a real Settings field but saves itself the moment its switch is flipped (see that page's own
 * module header), so it carries no tab here and never goes dirty. `projectView` is a real
 * Settings key too and is not in this registry at all — it is view-scope chrome with its own
 * `api_setProjectView` endpoint, not a page-level save-bar field; `test/pagesSettings.test.js`
 * pins that exclusion.
 *
 * The System tab owns three fields here (the daily sync hour, automatic compaction, the
 * retention window) that the dead registry this replaced never named at all — it predated the
 * maintenance panel that shipped them.
 */
export const SETTING_FIELDS = {
  scopes: { tab: "register", label: "registers collected" },
  fetchSeverities: { tab: "register", label: "severities requested" },
  slaTargets: { tab: "deadlines", label: "remediation windows" },
  syncSchedule: { tab: "system", label: "sync hour" },
  autoCompact: { tab: "system", label: "automatic compaction" },
  retentionDays: { tab: "system", label: "retention window" },
};

const kernel = settingsForm({ tabs: SETTINGS_TABS, fields: SETTING_FIELDS, defaultTab: DEFAULT_TAB });

/**
 * The bound kernel. `pages/settings.js` imports every one of these rather than re-declaring
 * them — see this file's own header, and settingsForm.js's for `normalizeTab`'s two-argument
 * form, `changeCountText`'s array signature (this page used to be the one holdout taking a
 * plain count; its caller is fixed rather than the kernel growing a second convention),
 * `tabStatus`'s key-presence reading of `errors`, and `sameValue`'s leaf.
 */
export const {
  normalizeTab, changedFields, settingsPatch, changeSummary, changeCountText, tabStatus,
  TAB_FIELDS,
} = kernel;

// =========================================================================================
//  Prepared, not yet wired: settingsDraft / validateDraft / draftWarnings
// =========================================================================================
//
// THESE THREE ARE GENUINE, CORRECT LOGIC OVER THIS REGISTER'S REAL FIELDS — `scopes`,
// `fetchSeverities`, `slaTargets`, the same three names `SETTING_FIELDS` above owns — and they
// are NOT a fork of gas_ai's shape. What they are is UNWIRED: `pages/settings.js` builds its
// own draft with `draftFromSettings` and validates each control inline as it is typed (see that
// file's own `oninput` handlers), rather than calling `validateDraft`/`draftWarnings` the way
// gas's and gas_ai's pages do. That gap is a later package's job to close — `draftWarnings` in
// particular gives this register the same three confirm-before-you-regret-it prompts gas_ai's
// page already shows (dropping a register FREEZES its open findings the same way dropping a
// vulnerability severity does there) — so these stay, tested, rather than being deleted for
// having no caller yet. `test/settingsModel.test.js` holds the cases.
//
// `settingsDraft` covers only the three fields above — NOT the six `SETTING_FIELDS` names, and
// deliberately not `syncSchedule`/`autoCompact`/`retentionDays`: those are simple scalars the
// live page already drafts and validates itself (`draftFromSettings`, `pages/settings.js`), and
// this narrower draft is what `validateDraft`/`draftWarnings` below actually need.

/** Per-scope severity lists as the page would hold them: copied, never aliased. */
function severitiesOf(v, scopes) {
  const out = {};
  for (const scope of scopes) out[scope] = [...((v || {})[scope] || [])];
  return out;
}

/**
 * Lift an api_getSettings-shaped payload into a flat draft over `scopes`/`fetchSeverities`/
 * `slaTargets`. Arrays and the per-scope object are copied, not aliased, so editing the draft
 * can never mutate the payload the rest of a caller is still reading.
 */
export function settingsDraft(settings, ctx) {
  const s = settings || {};
  const c = ctx || {};
  const targets = {};
  for (const sev of c.severityOrder || Object.keys(s.slaTargets || {})) {
    const v = (s.slaTargets || {})[sev];
    if (Number.isFinite(Number(v))) targets[sev] = Number(v);
  }
  return {
    scopes: [...(s.scopes || [])],
    fetchSeverities: severitiesOf(s.fetchSeverities, c.scopes || Object.keys(s.fetchSeverities || {})),
    slaTargets: targets,
  };
}

/**
 * Whether the draft may be sent, and why not: an empty register list is not a legal Settings
 * object, and neither is a non-positive SLA target. Returns `{ ok, message, tab }` — `tab` so a
 * caller can switch to the offending control rather than leaving the reader to hunt for it.
 */
export function validateDraft(draft) {
  if (!draft.scopes.length) {
    return {
      ok: false,
      tab: "register",
      message: "Choose at least one register to collect — with none, a sync has nothing to do.",
    };
  }
  for (const [sev, days] of Object.entries(draft.slaTargets)) {
    if (!Number.isFinite(Number(days)) || Number(days) <= 0) {
      return {
        ok: false,
        tab: "deadlines",
        message: `The SLA target for ${sev} must be a positive number of days.`,
      };
    }
  }
  return { ok: true, message: "", tab: null };
}

/**
 * Consequences worth a confirm rather than a refusal — legal, and almost always a mistake.
 * Every warning here is grounded in something this register's ledger actually does, not in a
 * general worry.
 *
 * `ctx` carries what the module never has on its own: `scopes` (the full register list),
 * `severityOrder`, `scopeLabels` (for the reader-facing name), and `sharedSlaTargets` (the
 * four sidekicks' byte-identical SLA windows, for the divergence warning below).
 */
export function draftWarnings(saved, draft, ctx) {
  const c = ctx || {};
  const scopes = c.scopes || [];
  const severityOrder = c.severityOrder || [];
  const shared = c.sharedSlaTargets || {};
  const labelOf = (s) => (c.scopeLabels || {})[s] || s;
  const out = [];

  // ---- dropping a register entirely
  const dropped = saved.scopes.filter((s) => draft.scopes.indexOf(s) < 0);
  if (dropped.length) {
    const names = dropped.map(labelOf).join(", ");
    // Pronoun and register count both have to agree with `dropped.length`: this warning is
    // reachable with either one register dropped or two (three would empty `draft.scopes`
    // outright, which validateDraft refuses before draftWarnings ever runs) — the wording used
    // to say "in it FREEZES ... until the register is collected again" even when two registers
    // were dropped at once, disagreeing with its own plural "two registers" title.
    const pronoun = dropped.length === 1 ? "it" : "them";
    const registerWord = dropped.length === 1 ? "register" : "registers";
    const registerVerb = dropped.length === 1 ? "is" : "are";
    out.push({
      tab: "register",
      title: dropped.length === 1 ? `Stop collecting ${names}?` : "Stop collecting two registers?",
      body: `Nothing will scan ${names} again, so every open finding in ${pronoun} FREEZES: it can `
        + "never be resolved by disappearance, because resolution by absence needs a scan that "
        + "looked. The rows stay in the ledger and in every open count, ageing, until the "
        + `${registerWord} ${registerVerb} collected again.`,
      confirmLabel: "Stop collecting",
    });
  }

  // ---- narrowing a severity gate
  //
  // The register's own rule: a scan records the gate it APPLIED, and a severity that was not
  // requested is never resolved by disappearance. So narrowing does not merely collect less —
  // it strands whatever is already in the ledger outside the new gate.
  for (const scope of scopes) {
    if (draft.scopes.indexOf(scope) < 0) continue;
    const before = saved.fetchSeverities[scope] || [];
    const after = draft.fetchSeverities[scope] || [];
    // An EMPTY list means "every severity", never "none" — settled after §8.3/§9.2, and
    // reading it as a narrowing here would invert it.
    const wasAll = !before.length;
    const isAll = !after.length;
    if (isAll) continue;                       // widening to everything strands nothing
    const lost = wasAll
      ? severityOrder.filter((s) => after.indexOf(s) < 0)
      : before.filter((s) => after.indexOf(s) < 0);
    if (!lost.length) continue;
    out.push({
      tab: "register",
      title: `Stop requesting ${lost.join(", ")} from ${labelOf(scope)}?`,
      body: "Findings at those severities are already in the ledger, and a scan that no longer "
        + "requests them cannot resolve those findings by absence — the same guard that stops "
        + "an unrequested severity from mass-resolving also stops it from ever closing. They "
        + "will sit open and ageing until the gate is widened again.",
      confirmLabel: "Narrow the scope",
    });
  }

  // ---- diverging from the other three sidekicks
  //
  // SLA_TARGETS is byte-identical across gas/, gas_ai/, brick/ and this register, and
  // that is a decision rather than an accident: a CRITICAL finding gets the same window whether
  // it is a host CVE, a dependency CVE or a hardcoded secret, so the four surfaces cannot
  // report different SLA attainment for the same estate.
  const diverged = Object.keys(draft.slaTargets)
    .filter((sev) => Number.isFinite(Number(shared[sev]))
      && Number(draft.slaTargets[sev]) !== Number(shared[sev]));
  if (diverged.length) {
    out.push({
      tab: "deadlines",
      title: "Report different SLA attainment from the other registers?",
      body: `${diverged.join(", ")} would no longer match the window the OS, AI and pipeline `
        + "surfaces use. They measure the same estate, so the same finding will be inside its "
        + "deadline on one dashboard and past it on another.",
      confirmLabel: "Use different deadlines",
    });
  }

  return out;
}
