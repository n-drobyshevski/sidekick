// Settings — Register, Deadlines, Access and System, over one save bar.
//
// THIS PAGE WAS NEVER ASSIGNED. The Phase 2 Wave 5 ownership table covered nine of the ten
// routes and omitted this one; it is the only page still carrying the Phase 1 stub, and the
// stub's own `sections` array (see the version this replaced) is the closest thing this page
// had to a spec: register (scopes + per-scope severities + the Wiz project id), deadlines
// (SLA targets), access (owner/admin/user), system (credentials, schedule, diagnostic).
//
// PURE VIEW MODEL, THIN DOM — the same split every Phase 2 page uses (see pages/data.js's own
// header), because this repo runs no jsdom (vitest.config.ts sets no `environment`): every
// function above `renderSettings` is exercised directly by test/pagesSettings.test.js, and
// `renderSettings` itself is read as source text.
//
// THE CLIENT NEVER IMPORTS domain/*.ts — checked across the other nine pages before writing
// this one, not assumed. SCOPE_LABELS is duplicated here exactly as it already is in
// program.js/executive.js/history.js; RETENTION_FLOOR_DAYS and DEFAULT_SYNC_HOUR mirror
// domain/maintenance.ts's RETENTION_MIN_DAYS and domain/settingsLogic.ts's DEFAULT_SYNC_HOUR
// for the same reason, and are used only to paint a hint BEFORE a save — what the server
// actually stored (including any clamp or fallback) is what `saveReconciliation` reports,
// straight from api_putSettings's own response, never from the local guess.
//
// fetchSeverities.secrets SHIPS [] ON PURPOSE, AND THAT IS THE ONE THING THIS PAGE MUST NOT
// GET WRONG. domain/config.ts's DEFAULT_FETCH_SEVERITIES walks two earlier, wrong answers
// (CRITICAL/HIGH inherited from the vulnerability registers, then MEDIUM on "PASSWORD and
// CERTIFICATE sit below HIGH") before landing on no gate at all: severity grades how a
// scanner classified the DETECTION, not whether the credential is live — 641 SAAS_API_KEY
// rows read LOW. `registerFieldView` below renders an empty list as "All severities", never
// as "None" — see history.js's `isAllSeverities`/`severitiesLabel` for the same predicate
// applied to a scan row instead of a draft.
//
// showExperimental IS ONE OF THE SEVEN Settings FIELDS AND DELIBERATELY GETS NO CONTROL TIED
// TO api_putSettings. The rail's actual "show experimental content" gate
// (app.js: "`experimental` gates a route behind Settings -> show experimental content.") is
// `experimental.js`'s own browser-local flag — nothing in this codebase reads
// `bootstrap.settings.showExperimental` for that purpose. A control here that wrote the
// server-side field would be exactly the thing app.js's own header warns against: "a control
// with nothing behind it is the one thing this app's chrome is careful never to offer." So
// this page reuses `experimental.js`'s real switch (self-saving, immediate) and leaves the
// server-side field as a pass-through the draft still carries, so it is never dropped on save.
//
// wizProjectId IS NOT IN Settings, AND NOT IN Bootstrap EITHER — settingsLogic.ts's own header
// explains why (it is the WIZ_PROJECT_ID_V2 script property, folded into the cache stamp from
// ONE home only). Bootstrap carries no field for it, so the Register tab states that plainly
// instead of fabricating a value or a control this page has no data to back.
//
// ACCESS HAS NO ROSTER RPC IN THIS BUILD. api.ts exposes `canEditAccess` and nothing to list
// or save the allowlist/admin list — those live on Script Properties, set outside this tab.
// So the Access tab is display-only for every viewer regardless of `canEditAccess`: what
// differs is the WORDS a permitted viewer sees (`manageHint`, pointing at where the roster
// actually lives), never a button or field this build cannot back.

import { call } from "../api.js";
import { bootstrapCached } from "../store.js";
import { setShowExperimental, showExperimental } from "../experimental.js";
import {
  clear, el, errorState, fmtDateTime, glossaryTip, heroStat, pageHeader, skeletonStack,
  statusPill, tipLabel, toast, togglePills,
} from "../ui.js";
import { disclosure, saveBar, settingRow, settingsPanel, switchToggle, tabList } from "../ui/settings.js";

// ============================================================================ vocabulary

export const SCOPE_LABELS = { sca: "Dependencies", sast: "Code", secrets: "Secrets" };
// secrets has no matching glossary entry of its own (its terms — validation-state, rotated,
// removed — describe the lifecycle, not the register as a whole), so it gets a plain label.
const SCOPE_TERMS = { sca: "sca", sast: "sast" };
const LOCAL_SCOPES = ["sca", "sast", "secrets"]; // mirrors domain/config.ts SCOPES

export const RETENTION_FLOOR_DAYS = 30; // domain/maintenance.ts::RETENTION_MIN_DAYS
export const DEFAULT_SYNC_HOUR = 5; // domain/settingsLogic.ts::DEFAULT_SYNC_HOUR

export const SETTINGS_KEYS = [
  "scopes", "fetchSeverities", "slaTargets", "showExperimental",
  "syncSchedule", "autoCompact", "retentionDays",
];

// Which of the seven fields the save bar batches, and which tab owns each — showExperimental
// is deliberately absent, see the module header.
export const FIELD_TABS = {
  scopes: "register",
  fetchSeverities: "register",
  slaTargets: "deadlines",
  syncSchedule: "system",
  autoCompact: "system",
  retentionDays: "system",
};
export const BATCHED_KEYS = Object.keys(FIELD_TABS);

const FIELD_LABELS = {
  scopes: "registers collected",
  fetchSeverities: "severities requested",
  slaTargets: "remediation windows",
  syncSchedule: "sync hour",
  autoCompact: "automatic compaction",
  retentionDays: "retention window",
};

export const TABS = [
  { key: "register", label: "Register" },
  { key: "deadlines", label: "Deadlines" },
  { key: "access", label: "Access" },
  { key: "system", label: "System" },
];
export const DEFAULT_TAB = "register";
const TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.key, t.label]));

/** A tab key the hash is allowed to name; anything else falls back — mirrors navModel.js. */
export function normalizeTab(key) {
  return TABS.some((t) => t.key === key) ? key : DEFAULT_TAB;
}

// ============================================================================ pure view model

/**
 * Lift api_getSettings's payload into a flat draft over exactly the seven Settings fields,
 * defensively — a malformed cell must not crash the page (the server's own `cleanSettings`
 * carries the same never-throw contract; this is its client-side mirror, not a replacement
 * for it). Arrays and per-scope records are copied, never aliased, so editing the draft can
 * never mutate a payload a background revalidation is still holding.
 */
export function draftFromSettings(settings) {
  const s = settings || {};
  const fs = s.fetchSeverities && typeof s.fetchSeverities === "object" ? s.fetchSeverities : {};
  const sla = s.slaTargets && typeof s.slaTargets === "object" ? s.slaTargets : {};
  return {
    scopes: Array.isArray(s.scopes) && s.scopes.length ? [...s.scopes] : [...LOCAL_SCOPES],
    fetchSeverities: Object.fromEntries(
      LOCAL_SCOPES.map((scope) => [scope, Array.isArray(fs[scope]) ? [...fs[scope]] : []]),
    ),
    slaTargets: { ...sla },
    showExperimental: s.showExperimental === true,
    syncSchedule: Number.isFinite(Number(s.syncSchedule)) ? Number(s.syncSchedule) : DEFAULT_SYNC_HOUR,
    autoCompact: s.autoCompact === true,
    retentionDays: Number.isFinite(Number(s.retentionDays)) ? Number(s.retentionDays) : RETENTION_FLOOR_DAYS,
  };
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return false;
    return ka.every((k) => sameValue(a[k], b[k]));
  }
  return a === b;
}

/** Which of the seven fields differ between saved and draft — for the save bar, not the wire. */
export function changedFields(saved, draft) {
  return SETTINGS_KEYS.filter((k) => !sameValue((saved || {})[k], (draft || {})[k]));
}

/**
 * What the save bar says, each change naming the tab that owns it. `showExperimental` never
 * appears here even if it differs — it has no batched tab and no Save/Discard affordance of
 * its own; it saves itself the moment its switch is flipped.
 */
export function changeSummary(changed) {
  return (changed || [])
    .filter((k) => FIELD_TABS[k])
    .map((k) => ({
      field: k, label: FIELD_LABELS[k] || k, tab: FIELD_TABS[k], tabLabel: TAB_LABEL[FIELD_TABS[k]],
    }));
}

export function changeCountText(n) {
  return n + " unsaved change" + (n === 1 ? "" : "s");
}

// ---------------------------------------------------------------------------- register tab

const SECRETS_ALL_NOTE =
  "No severity gate is set by default. Severity grades how a scanner classified the "
  + "detection, not whether the credential is still live — a SAAS_API_KEY can read LOW and "
  + "still work. An empty selection here requests every severity, which is this register's "
  + "whole CODE population.";

const SCOPE_ALL_NOTE = "No severities selected requests every severity for this register.";

/**
 * One scope's severity picker, read the same way whichever scope it is — and the one function
 * on this page that most needs to get "empty" right. `fetchSeverities.secrets` ships `[]` on
 * purpose (domain/config.ts's `DEFAULT_FETCH_SEVERITIES`), and `[]` means "every severity",
 * never "no severity". Rendering it as "None selected" would invert the most carefully-argued
 * default in this register — see history.js's `severitiesLabel` for the same "All severities"
 * wording applied to a saved scan row instead of a draft.
 */
export function registerFieldView(scope, list) {
  const selected = Array.isArray(list) ? [...list] : [];
  const allSelected = selected.length === 0;
  return {
    scope,
    label: SCOPE_LABELS[scope] || scope,
    selected,
    allSelected,
    displayText: allSelected ? "All severities" : selected.join(", "),
    note: scope === "secrets" ? SECRETS_ALL_NOTE : SCOPE_ALL_NOTE,
  };
}

// --------------------------------------------------------------------------- deadlines tab

/** SLA rows in severity order, UNKNOWN excluded — SLA_TARGETS never carries it either. */
export function slaFieldRows(slaTargets, severityOrder) {
  const order = (Array.isArray(severityOrder) ? severityOrder : []).filter((s) => s !== "UNKNOWN");
  const targets = slaTargets || {};
  const known = order.filter((sev) => Object.prototype.hasOwnProperty.call(targets, sev));
  const rest = Object.keys(targets).filter((sev) => !known.includes(sev));
  return [...known, ...rest].map((sev) => ({ sev, days: Number(targets[sev]) }));
}

// ------------------------------------------------------------------------------ system tab

/** Read the floor honestly: a value below it shows the floor, not the number that was typed. */
export function retentionFieldView(days) {
  const n = Number(days);
  const value = Number.isFinite(n) ? n : RETENTION_FLOOR_DAYS;
  return {
    value,
    floor: RETENTION_FLOOR_DAYS,
    belowFloor: value < RETENTION_FLOOR_DAYS,
    displayValue: Math.max(value, RETENTION_FLOOR_DAYS),
  };
}

export const AUTO_COMPACT_OFF_NOTE =
  "Off by default. This preserves the behaviour that shipped before this setting existed — "
  + "turning it on is a choice this page leaves to you, not one it steers you toward.";

/** The maintenance pair, read together — retentionDays is only consulted once autoCompact is true. */
export function maintenanceFieldView(draft) {
  const d = draft || {};
  return {
    autoCompact: d.autoCompact === true,
    retention: retentionFieldView(d.retentionDays),
  };
}

/**
 * What the server actually stored versus what was sent — the honest surface for the two
 * fields `cleanSettings` may silently rewrite: `retentionDays` is CLAMPED up to the floor,
 * `syncSchedule` FALLS BACK to the default when out of range. Reading only `sent` would miss
 * a rewrite this page never asked for; reading only `saved` would miss that one happened at
 * all. Returns human sentences rather than a code, because the only consumer is a toast.
 */
export function saveReconciliation(sent, saved) {
  const notes = [];
  const s = sent || {};
  const r = saved || {};
  if (Number.isFinite(Number(s.retentionDays)) && Number(s.retentionDays) !== Number(r.retentionDays)) {
    notes.push(
      `Retention window saved as ${r.retentionDays} day(s) — raised to the ${RETENTION_FLOOR_DAYS}-day floor.`,
    );
  }
  if (Number.isFinite(Number(s.syncSchedule)) && Number(s.syncSchedule) !== Number(r.syncSchedule)) {
    notes.push(
      `Sync hour saved as ${r.syncSchedule}:00 — ${s.syncSchedule} was out of range, so it fell back to the default.`,
    );
  }
  return notes;
}

// -------------------------------------------------------------------------------- access tab

/**
 * `canEditAccess` gates WORDS, not a control — this build ships no roster RPC (see the module
 * header), so there is never an editing affordance here for anyone. `manageHint` is the only
 * field that depends on the flag, and it is null for a viewer who may not edit access, so a
 * viewer without permission sees state and nothing that could be mistaken for a way to change
 * it.
 */
export function accessFieldView(canEditAccess) {
  const editable = canEditAccess === true;
  return {
    canEditAccess: editable,
    tiers: [
      { tier: "Owner", note: "Appoints admins. Always allowed, ahead of either list." },
      { tier: "Admin", note: "Maintains the user list." },
      { tier: "User", note: "Can open the app." },
    ],
    failsClosedNote:
      "An allowlist nobody has set reads as owner-only, never as open — access fails closed.",
    manageHint: editable
      ? "The allowlist and admin list are Script Properties (ALLOWED_USERS / ALLOWED_ADMINS); "
        + "an owner or admin sets them outside this tab."
      : null,
  };
}

// ==================================================================================== page

export async function renderSettings(host, params, ctx) {
  host.append(pageHeader({
    hero: heroStat(
      "Settings",
      "Register, deadlines, access, system",
      "One save bar covers the register, the deadlines and the maintenance schedule. Access "
        + "and the show-experimental preference save themselves, on their own controls.",
    ),
  }));

  const tabHost = el("div", {});
  const panelHost = el("div", { class: "settings-panels" });
  const bar = saveBar({
    onSave: () => doSave(),
    onDiscard: () => doDiscard(),
    onJump: (key) => tabs.focusTab(key),
  });

  const panels = {
    register: el("div", { id: "tab-panel-register", role: "tabpanel", "aria-labelledby": "tab-register" }),
    deadlines: el("div", {
      id: "tab-panel-deadlines", role: "tabpanel", "aria-labelledby": "tab-deadlines", hidden: true,
    }),
    access: el("div", {
      id: "tab-panel-access", role: "tabpanel", "aria-labelledby": "tab-access", hidden: true,
    }),
    system: el("div", {
      id: "tab-panel-system", role: "tabpanel", "aria-labelledby": "tab-system", hidden: true,
    }),
  };
  panelHost.append(panels.register, panels.deadlines, panels.access, panels.system);
  for (const key of Object.keys(panels)) panels[key].append(skeletonStack(3));

  const tabs = tabList({
    tabs: TABS,
    active: normalizeTab(params && params.tab),
    ariaLabel: "Settings sections",
    idPrefix: "tab",
    onSelect: (key) => {
      for (const k of Object.keys(panels)) panels[k].hidden = k !== key;
    },
  });

  host.append(tabHost, bar.node, panelHost);
  tabHost.append(tabs.node);

  const boot = bootstrapCached() || {};
  const severityOrder = (boot.severityOrder && boot.severityOrder.length ? boot.severityOrder : []);
  const scopeList = (boot.scopes && boot.scopes.length ? boot.scopes : LOCAL_SCOPES);

  let saved;
  let draft;

  try {
    const settings = await call("api_getSettings", {});
    saved = draftFromSettings(settings);
    draft = draftFromSettings(settings);
  } catch (e) {
    console.error("[settings] api_getSettings failed:", e);
    for (const key of Object.keys(panels)) {
      clear(panels[key]).append(
        errorState("Couldn't load settings.", { detail: String((e && e.message) || e) }),
      );
    }
    return;
  }

  buildPanels();

  // ------------------------------------------------------------------------- dirty tracking

  function syncDirty() {
    const changed = changedFields(saved, draft);
    for (const t of TABS) {
      tabs.setDirty(t.key, changed.some((k) => FIELD_TABS[k] === t.key));
    }
    bar.update(changeCountText(changed.length), changeSummary(changed));
  }

  async function doSave() {
    bar.setBusy(true);
    try {
      const sent = draft;
      const result = await call("api_putSettings", { settings: sent });
      const notes = saveReconciliation(sent, result);
      toast(notes.length ? notes.join(" ") : "Settings saved.");
      ctx && ctx.refresh && ctx.refresh();
    } catch (e) {
      toast(`Couldn't save settings: ${(e && e.message) || e}`, "error");
      bar.setBusy(false);
    }
  }

  function doDiscard() {
    draft = draftFromSettings(saved);
    buildPanels();
  }

  // ------------------------------------------------------------------------------ builders

  function buildPanels() {
    buildRegisterPanel();
    buildDeadlinesPanel();
    buildAccessPanel();
    buildSystemPanel();
    syncDirty();
  }

  function buildRegisterPanel() {
    const scopesPanel = settingsPanel({
      title: "Registers & severities",
      description: "Which registers a sync collects, and which severities it requests, per register.",
      body: scopeList.map((scope) => registerScopeBlock(scope)),
    });
    const projectPanel = settingsPanel({
      title: "Wiz project scope",
      body: [
        el("p", { class: "small muted" },
          "Set by an operator as the WIZ_PROJECT_ID_V2 script property, outside this settings "
          + "tab. This page does not offer to edit it, and the current value is not part of "
          + "what it is given to draw with."),
      ],
    });
    clear(panels.register).append(scopesPanel, projectPanel);
  }

  function registerScopeBlock(scope) {
    const id = `settings-scope-${scope}`;
    const labelNode = SCOPE_TERMS[scope]
      ? tipLabel(SCOPE_LABELS[scope] || scope, { term: SCOPE_TERMS[scope] })
      : (SCOPE_LABELS[scope] || scope);

    const checkbox = el("input", {
      type: "checkbox", id,
      checked: draft.scopes.includes(scope) ? true : null,
      onchange: (ev) => {
        const on = ev.target.checked;
        const set = new Set(draft.scopes);
        if (on) set.add(scope); else set.delete(scope);
        draft.scopes = [...set];
        syncDirty();
      },
    });
    const collectRow = settingRow({
      label: labelNode, htmlFor: id,
      description: "Included when a sync runs.",
      control: checkbox,
    });

    const view = registerFieldView(scope, draft.fetchSeverities[scope]);
    const displayEl = el("span", { class: "small" }, view.displayText);
    const pills = togglePills({
      options: severityOrder.filter((s) => s !== "UNKNOWN"),
      selected: draft.fetchSeverities[scope],
      ariaLabel: `${view.label} severities requested`,
      onToggle: (sev) => {
        const set = new Set(draft.fetchSeverities[scope]);
        if (set.has(sev)) set.delete(sev); else set.add(sev);
        draft.fetchSeverities[scope] = [...set];
        displayEl.textContent = registerFieldView(scope, draft.fetchSeverities[scope]).displayText;
        syncDirty();
      },
    });
    const severitiesRow = settingRow({
      label: "Severities requested",
      description: view.note,
      control: el("div", { class: "settings-severity-row" }, pills, displayEl),
    });

    return el("div", { class: "settings-scope-block" }, collectRow, severitiesRow);
  }

  function buildDeadlinesPanel() {
    const rows = slaFieldRows(draft.slaTargets, severityOrder);
    const body = rows.map((r) => {
      const id = `settings-sla-${r.sev}`;
      const input = el("input", {
        type: "number", id, min: "1", step: "1", value: String(r.days),
        oninput: (ev) => {
          const n = Number(ev.target.value);
          if (Number.isFinite(n) && n > 0) draft.slaTargets[r.sev] = Math.floor(n);
          syncDirty();
        },
      });
      return settingRow({
        label: `${r.sev} target`, htmlFor: id,
        description: "Days to remediate. In SLA means resolved on or before this many days.",
        control: input,
      });
    });
    const panel = settingsPanel({
      title: glossaryTip("Remediation windows", "sla-target"),
      description: "The same window applies to every register: a CRITICAL finding gets the "
        + "same clock whether it is a host CVE, a dependency CVE or a hardcoded secret.",
      body,
    });
    clear(panels.deadlines).append(panel);
  }

  function buildAccessPanel() {
    const v = accessFieldView(boot.canEditAccess);
    const pill = statusPill(v.canEditAccess ? "ok" : "neutral", v.canEditAccess ? "Can manage access" : "View only");
    const body = [
      settingRow({ label: "Your access", control: pill }),
      ...v.tiers.map((t) => settingRow({ label: t.tier, control: el("span", { class: "small muted" }, t.note) })),
      el("p", { class: "small muted" }, v.failsClosedNote),
    ];
    if (v.manageHint) body.push(el("p", { class: "small muted" }, v.manageHint));
    const panel = settingsPanel({
      title: "Access",
      description: "Two tiers: the owner appoints admins, and admins maintain the user list.",
      body,
    });
    clear(panels.access).append(panel);
  }

  function buildSystemPanel() {
    const scheduleId = "settings-sync-hour";
    const scheduleInput = el("input", {
      type: "number", id: scheduleId, min: "0", max: "23", step: "1", value: String(draft.syncSchedule),
      oninput: (ev) => {
        const n = Number(ev.target.value);
        if (Number.isInteger(n) && n >= 0 && n <= 23) draft.syncSchedule = n;
        syncDirty();
      },
    });
    const scheduleRow = settingRow({
      label: "Daily sync hour", htmlFor: scheduleId,
      description: `Hour of day (0-23), script-local. An out-of-range value falls back to the `
        + `default (${DEFAULT_SYNC_HOUR}:00) on save rather than being rejected.`,
      control: scheduleInput,
    });
    const scheduleCaveat = disclosure(
      "Why a saved hour might not move the trigger yet",
      el("p", {}, "The installed daily trigger is deduplicated by its name alone, not by this "
        + "value, so changing the hour after first install can leave the trigger firing at the "
        + "old time until that reconciliation ships."),
    );

    const autoCompactSwitch = switchToggle({
      checked: draft.autoCompact,
      id: "settings-auto-compact",
      ariaLabel: "Automatic compaction",
      onChange: (on) => { draft.autoCompact = on; syncDirty(); },
    });
    const autoCompactRow = settingRow({
      label: "Automatic compaction", htmlFor: "settings-auto-compact",
      description: AUTO_COMPACT_OFF_NOTE,
      control: autoCompactSwitch.node,
    });

    const retentionId = "settings-retention-days";
    const retentionWarn = el("span", { class: "small settings-retention-warn", hidden: true });
    const retentionInput = el("input", {
      type: "number", id: retentionId, min: String(RETENTION_FLOOR_DAYS), step: "1",
      value: String(draft.retentionDays),
      oninput: (ev) => {
        const n = Number(ev.target.value);
        if (!Number.isFinite(n)) return;
        draft.retentionDays = Math.floor(n);
        const v = retentionFieldView(draft.retentionDays);
        retentionWarn.hidden = !v.belowFloor;
        retentionWarn.textContent = v.belowFloor
          ? `Below the ${v.floor}-day floor — saving will raise it to ${v.floor}.`
          : "";
        syncDirty();
      },
    });
    const retentionRow = settingRow({
      label: "Retention window", htmlFor: retentionId,
      description: `Read only while automatic compaction is on. Floored at ${RETENTION_FLOOR_DAYS} days.`,
      control: el("div", {}, retentionInput, retentionWarn),
    });

    const maintenancePanel = settingsPanel({
      title: "Maintenance",
      body: [scheduleRow, scheduleCaveat, autoCompactRow, retentionRow],
    });

    // Self-saving, NOT part of the batch above — see the module header.
    const expSwitch = switchToggle({
      checked: showExperimental(),
      id: "settings-show-experimental",
      ariaLabel: "Show experimental content",
      onChange: (on) => {
        setShowExperimental(on);
        toast(on ? "Experimental content shown." : "Experimental content hidden.");
      },
    });
    const expRow = settingRow({
      label: "Show experimental content", htmlFor: "settings-show-experimental",
      description: "Saves immediately, for this browser only. It decides which unfinished "
        + "routes exist in the nav, not anything this register computes.",
      control: expSwitch.node,
    });
    const prefsPanel = settingsPanel({ title: "Preferences", body: [expRow] });

    const credPill = statusPill(
      boot.hasCredentials ? "ok" : "bad",
      boot.hasCredentials ? "Connected" : "No credentials",
    );
    const scan = boot.latestScan;
    const scanLine = scan
      ? `${fmtDateTime(scan.ts)} · ${SCOPE_LABELS[scan.scope] || scan.scope || "all registers"} · `
        + `${Number(scan.total || 0).toLocaleString()} finding(s)`
      : "No scan recorded yet.";
    const diagPanel = settingsPanel({
      title: "Deployment",
      body: [
        settingRow({ label: "Product", control: el("span", {}, boot.product || "—") }),
        settingRow({ label: "Build", control: el("span", { class: "num" }, boot.buildId || "—") }),
        settingRow({ label: "Wiz credentials", control: credPill }),
        settingRow({ label: "Last scan", control: el("span", {}, scanLine) }),
      ],
    });

    clear(panels.system).append(maintenancePanel, prefsPanel, diagPanel);
  }
}
