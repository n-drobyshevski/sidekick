// Settings: four task tabs (Register / Deadlines / Access / System) over ONE batched save bar.
//
// The shape is gas_ai's, and its reasoning transfers whole: a page-level save bar owns every
// knob that writes the settings tab, names each pending change together with the tab that
// holds it, and lets a control live wherever it reads best instead of wherever its Save button
// is. A row of per-panel Save buttons has the "your other edits will be discarded" problem
// built into it.
//
// What did NOT fold into the bar, and why each is a different form rather than an exception:
//   * The access roster writes Script Properties through its own endpoints and its own
//     validation, so it keeps its own Save — the same split both sibling tools draw.
//   * The System tab is read-only. Credentials and the project scope decide WHICH POPULATION
//     every register measures, and a ledger built under one scope is not comparable with one
//     built under another, so they stay Script Properties set deliberately rather than a text
//     box behind a save bar.
//
// settingsModel.js owns the draft/dirty/validate/warn model (DOM-free, so it is the half
// vitest can hold — there is no jsdom in this suite); this file wires DOM controls to that
// draft and repaints from it. CONTROLS ARE BUILT ONCE AND REPAINTED, never rebuilt: a full
// repaint eats unsaved edits and steals focus mid-keystroke.

import { call } from "../api.js";
import { bootstrap, invalidateBootstrap, invalidateRpcCache, setParams } from "../store.js";
import { setShowExperimental, showExperimental } from "../experimental.js";
import {
  changeCountText, changeSummary, changedFields, dirtyTabs, draftWarnings, normalizeTab,
  settingsDraft, settingsPatch, SETTINGS_TABS, validateDraft,
} from "../settingsModel.js";
import { renderAccessPanel } from "./accessEditor.js";
import { clear, el, fmtDateTime } from "../ui.js";
import { heroStat, pageHeader, statusPill, togglePills } from "../ui/controls.js";
import { confirmDialog, emptyState, skeletonStack, toast } from "../ui/feedback.js";
import {
  disclosure, saveBar, settingRow, settingsPanel, switchToggle, tabList,
} from "../ui/settings.js";
import { codeBlock } from "../ui/code.js";

/**
 * A tab's panel: one wrapper the tablist shows and hides.
 *
 * The id has to be `<idPrefix>-panel-<key>` because that is what `tabList` writes into each
 * tab's `aria-controls` — a mismatch leaves every tab pointing at nothing, which no visual
 * check would catch. `tabindex: 0` makes the panel itself focusable, so arrowing to a tab and
 * tabbing once lands inside the content it just revealed.
 */
function tabPanel(key, ...kids) {
  return el("div", {
    class: "settings-tabpanel", id: `settings-panel-${key}`, role: "tabpanel",
    "aria-labelledby": `settings-${key}`, tabindex: "0",
  }, ...kids);
}

export async function renderSettings(host, params) {
  const head = el("div", {});
  const body = el("div", {});
  host.append(head, body);
  body.append(el("section", { class: "card" }, skeletonStack(4)));

  // THREE ROUND TRIPS SIDE BY SIDE, degraded on their own terms. Losing settings fails the
  // page, since nothing below can render without it; losing the diagnostic costs the System
  // tab its text; losing access costs the Access tab, which is already a normal outcome for
  // anyone who may not edit the roster. renderAccessPanel swallows its own errors and answers
  // a null panel, so allSettled is belt and braces.
  const [boot, settled] = await Promise.all([
    bootstrap().catch(() => null),
    Promise.allSettled([
      call("api_getSettings", {}),
      call("api_getDiagnostic", {}),
      renderAccessPanel(),
    ]),
  ]);

  if (settled[0].status === "rejected") {
    const e = settled[0].reason;
    clear(body);
    body.append(emptyState("Couldn't load settings.", String((e && e.message) || e)));
    return;
  }

  const ctx = {
    scopes: (boot && boot.scopes) || [],
    scopeLabels: (boot && boot.scopeLabels) || {},
    severityOrder: (boot && boot.severityOrder) || [],
    sharedSlaTargets: (boot && boot.slaTargets) || {},
  };
  const diagnostic = settled[1].status === "fulfilled" ? settled[1].value : null;
  const access = settled[2].status === "fulfilled" ? settled[2].value : { panel: null, roster: null };

  clear(body);

  // ------------------------------------------------------------------------- draft model
  // `savedShape` is the payload settingsDraft() reads — kept separately from `saved` so a
  // Discard can rebuild a fresh draft exactly the way a save does.
  let savedShape = settled[0].value;
  const saved = settingsDraft(savedShape, ctx);
  let draft = settingsDraft(savedShape, ctx);

  head.append(pageHeader({
    hero: heroStat("Settings", String(draft.scopes.length),
      `${draft.scopes.length === 1 ? "register" : "registers"} collected`
      + (access.roster ? ` · ${access.roster.people} can open this dashboard` : "")),
  }));

  // ============================================================================ REGISTER TAB
  const scopeRow = togglePills({
    options: ctx.scopes.map((s) => ({ value: s, label: ctx.scopeLabels[s] || s })),
    selected: draft.scopes,
    sevClass: false,
    pillClass: "scope-pill",
    ariaLabel: "Registers to collect",
    onToggle: (v) => {
      draft.scopes = draft.scopes.indexOf(v) >= 0
        ? draft.scopes.filter((s) => s !== v)
        : [...draft.scopes, v];
      scopeRow.set(draft.scopes);
      severityHosts.forEach((h) => h.sync());
      onEdit();
    },
  });

  // One severity row per scope, because the gate is per scope — and that is not a convenience.
  // A shared list is what deleted every PASSWORD and CERTIFICATE from the secrets register
  // when CRITICAL/HIGH was inherited from the vulnerability ones.
  const severityHosts = ctx.scopes.map((scope) => {
    // `block`, not `host` — the page's own host is in scope here and shadowing it inside a
    // closure that also calls onEdit() is the kind of thing that reads fine and edits wrong.
    const block = el("div", { class: "sev-scope" });
    const row = togglePills({
      options: ctx.severityOrder.filter((s) => s !== "UNKNOWN"),
      selected: draft.fetchSeverities[scope] || [],
      ariaLabel: `Severities requested from ${ctx.scopeLabels[scope] || scope}`,
      onToggle: (v) => {
        const cur = draft.fetchSeverities[scope] || [];
        draft.fetchSeverities[scope] = cur.indexOf(v) >= 0
          ? cur.filter((s) => s !== v)
          : [...cur, v];
        block.sync();
        onEdit();
      },
    });
    // "Every severity" is what an EMPTY list means, and the caption has to say so — a row of
    // unpressed pills otherwise reads as "none", which is the exact inversion that took two
    // wrong answers to settle on the secrets register.
    const caption = el("p", { class: "muted small" });
    block.append(row, caption);
    block.sync = () => {
      const list = draft.fetchSeverities[scope] || [];
      row.set(list);
      const collected = draft.scopes.indexOf(scope) >= 0;
      clear(caption);
      caption.append(
        !collected
          ? "Not collected — this register is switched off above."
          : list.length
            ? `Requesting ${list.length} of ${ctx.severityOrder.length - 1} severities.`
            : "Nothing selected means EVERY severity — the whole population.",
      );
      block.classList.toggle("is-off", !collected);
    };
    block.scope = scope;
    return block;
  });

  const registerPanel = settingsPanel({
    title: "What gets collected",
    description: "Which registers a sync walks, and which severities it asks the API for.",
    body: [
      disclosure("Why this matters", el("p", {},
        "A scan records the gate it APPLIED, and a severity it did not request can never be "
        + "resolved by absence — the guard that stops an unrequested severity mass-resolving "
        + "also stops it ever closing. So narrowing here does not merely collect less: it "
        + "strands whatever is already in the ledger outside the new gate, open and ageing.")),
      settingRow({
        label: "Registers collected",
        description: "A register nobody scans can never close a finding.",
        control: scopeRow,
      }),
      ...severityHosts.map((h) => settingRow({
        label: `${ctx.scopeLabels[h.scope] || h.scope} severities`,
        description: h.scope === "secrets"
          ? "Severity grades a DETECTION here, not whether a credential is live — which is why "
            + "this register ships with no gate at all."
          : "A volume control, not a claim about what matters.",
        control: h,
      })),
    ],
  });

  // =========================================================================== DEADLINES TAB
  const slaInputs = new Map();
  for (const sev of ctx.severityOrder) {
    if (!(sev in draft.slaTargets)) continue;
    const input = el("input", {
      type: "number", min: "1", step: "1", id: `sla-${sev}`,
      oninput: () => { draft.slaTargets[sev] = Number(input.value); onEdit(); },
    });
    slaInputs.set(sev, input);
  }

  const deadlinesPanel = settingsPanel({
    title: "Remediation windows",
    description: "How long a finding of each severity may stay open before it is late.",
    body: [
      disclosure("Why this matters", el("p", {},
        "These windows are byte-identical across the OS, AI and pipeline sidekicks on purpose: "
        + "a CRITICAL finding gets the same deadline whether it arrives as a host CVE, a "
        + "dependency CVE or a hardcoded secret, so the four surfaces cannot report different "
        + "SLA attainment for the same estate. Changing one here diverges this register from "
        + "the other three.")),
      ...[...slaInputs].map(([sev, input]) => settingRow({
        label: sev, htmlFor: `sla-${sev}`,
        description: `Shared default: ${ctx.sharedSlaTargets[sev]} days.`,
        control: input,
      })),
    ],
  });

  // ============================================================================== SYSTEM TAB
  const experimental = switchToggle({
    id: "set-experimental",
    checked: showExperimental(),
    ariaLabel: "Show experimental content",
    // SAVES ON CHANGE, and stays out of the bar: it writes localStorage and reshapes the nav
    // rail on the spot. There is no server to reject it and nothing to batch it against.
    onChange: (v) => {
      setShowExperimental(v);
      toast(v ? "Experimental routes shown." : "Experimental routes hidden.");
    },
  });

/**
 * The credential row's control: what is stored, whether the tenant has ever accepted it, and
 * a way to find out.
 *
 * The verification is a real token exchange plus one page of one row (`api_testWizConnection`
 * -> `wizClient.testConnection`), and it drops the cached token first — a cached one outlives
 * a revoked client secret by up to six hours, so a test that accepted it would keep reporting
 * success after the credentials stopped working.
 */
function credentialControl(boot) {
  const wrap = el("div", { class: "settings-inline" });
  const paint = (state) => {
    clear(wrap);
    if (!boot || !boot.hasCredentials) {
      wrap.append(statusPill("warn", "Not set — the register has no tenant to collect from"));
      return;
    }
    if (state && state.ok) {
      wrap.append(statusPill("ok", `Verified ${fmtDateTime(state.at)}`));
    } else if (state && state.notAuthorized) {
      // A DIFFERENT FAILURE WITH A DIFFERENT REMEDY, and it is not about Wiz at all: Apps
      // Script refused the outbound call before one was made. The platform's own sentence
      // names a scope URL and nothing a reader can act on — and arrives in the script
      // owner's locale, so it is not even reliably readable here. Print the steps instead.
      wrap.append(
        statusPill("bad", "Not authorized"),
        el("span", { class: "muted small" },
          "This deployment may not make outbound requests, so it cannot reach Wiz. "
          + "The credentials are not the problem."),
        el("ol", { class: "settings-remedy" },
          el("li", {}, "Push the current build. Its appsscript.json declares "
            + "script.external_request, and a manifest change is what makes Apps Script ask "
            + "for consent — inference alone did not."),
          el("li", {}, "In the Apps Script editor, run wizDiagnostic() and ACCEPT the "
            + "prompt. Read the Execution log: it names which step fails."),
          el("li", {}, "Deploy \u2192 Manage deployments \u2192 Edit \u2192 New version. "
            + "Pushing code does not change what the web app URL serves."),
          el("li", {}, "Check the daily scan trigger still fires: a scope change can "
            + "suspend an installable trigger silently.")),
      );
    } else if (state && state.error) {
      wrap.append(statusPill("bad", "Refused"), el("span", { class: "muted small" }, state.error));
    } else if (boot.wizVerifiedAt) {
      wrap.append(statusPill("ok", `Last verified ${fmtDateTime(boot.wizVerifiedAt)}`));
    } else {
      // Stored, never exercised. Neutral rather than green: nothing is wrong, and nothing
      // has been confirmed either.
      wrap.append(statusPill("neutral", "Stored, never verified"));
    }
    const btn = el("button", {
      class: "linklike",
      onclick: async () => {
        btn.disabled = true;
        paint({ pending: true });
        try {
          const res = await call("api_testWizConnection", {});
          paint({ ok: true, at: res.at });
          toast(res.rows === null
            ? "The tenant answered."
            : `The tenant answered — ${res.rows.toLocaleString()} findings in scope.`);
          // The stored timestamp moved, so the next reader of this page sees it too.
          invalidateBootstrap();
        } catch (e) {
          // `errorKind` is set server-side; the message is the platform's and may be in any
          // language, so the branch must not key on reading it.
          if (e.kind === "not-authorized") paint({ notAuthorized: true });
          else paint({ error: String(e.message || e).slice(0, 200) });
        }
      },
    }, state && state.pending ? "Testing…" : "Test connection");
    if (state && state.pending) btn.disabled = true;
    wrap.append(btn);
  };
  paint(null);
  return wrap;
}

  const systemPanel = settingsPanel({
    title: "This deployment",
    description: "What the app is wired to. Read-only here — see below for why.",
    body: [
      settingRow({
        label: "Wiz credentials",
        description: "Set as Script Properties, never through the app.",
        // PRESENT AND VERIFIED ARE DIFFERENT FACTS, and this row used to state only the
        // first while looking like the second. `hasCredentials` is three non-empty Script
        // Properties — no exchange, no call, nothing the tenant has ever agreed to — and a
        // green pill on a row labelled "Wiz credentials" invites the stronger reading with
        // nothing beside it to correct that. Meanwhile the rail said "collection not wired".
        // Two surfaces, one deployment, two stories.
        control: credentialControl(boot),
      }),
      settingRow({
        label: "Project scope",
        description: "Which Wiz project every query is narrowed to.",
        control: diagnostic && diagnostic.project
          ? el("code", { class: "code-inline" }, diagnostic.project)
          : statusPill("neutral", "All projects"),
      }),
      settingRow({
        label: "Build", description: "The bundle this page is running.",
        control: el("code", { class: "code-inline" }, (boot && boot.buildId) || "—"),
      }),
      settingRow({
        label: "Show experimental content",
        description: "Routes still being built. Local to this browser; saves immediately.",
        htmlFor: "set-experimental",
        control: experimental.node,
      }),
      disclosure("Why credentials are not editable here", el("p", {},
        "The project scope decides WHICH POPULATION every register measures, and a ledger "
        + "built under one scope is not comparable with one built under another. A text box "
        + "on a settings page makes that a typo away; a Script Property makes it deliberate.")),
      diagnostic
        ? disclosure("Deployment diagnostic", codeBlock(diagnostic.text, { maxHeight: "320px" }))
        : el("p", { class: "muted small" }, "The diagnostic could not be read."),
    ],
    footer: null,
  });

  // ================================================================================== TABS
  const panels = {
    register: tabPanel("register", registerPanel),
    deadlines: tabPanel("deadlines", deadlinesPanel),
    system: tabPanel("system", systemPanel),
  };
  // Only when the reader may edit it: a non-editor gets no section at all rather than a
  // disabled one, which is what the endpoint does too — it sends them no roster.
  if (access.panel) panels.access = tabPanel("access", access.panel);

  const tabDefs = SETTINGS_TABS.filter((t) => panels[t.key]);
  const tabKeys = tabDefs.map((t) => t.key);

  const tabs = tabList({
    tabs: tabDefs.map((t) => ({ key: t.key, label: t.label })),
    // Deep-linkable via `#/settings?tab=deadlines`. A stale `?tab=access` on a deployment where
    // Access is not drawn falls back rather than selecting a tab that was never built.
    active: normalizeTab((params || {}).tab, tabKeys),
    ariaLabel: "Settings sections",
    idPrefix: "settings",
    onSelect: (key) => {
      for (const k of tabKeys) panels[k].hidden = k !== key;
      setParams({ tab: key });  // replaceState — no hashchange, no re-render
    },
  });

  const bar = saveBar({ onSave, onDiscard, onJump: (tab) => tabs.select(tab) });
  body.append(tabs.node, ...tabKeys.map((k) => panels[k]), bar.node);

  // -------------------------------------------------------------------- shared repainting
  function syncDirty() {
    const changed = changedFields(saved, draft);
    bar.update(changeCountText(changed), changeSummary(changed));
    const dt = new Set(dirtyTabs(changed));
    for (const k of tabKeys) tabs.setDirty(k, dt.has(k));
  }

  function onEdit() {
    syncDirty();
  }

  function repaintFromDraft() {
    scopeRow.set(draft.scopes);
    severityHosts.forEach((h) => h.sync());
    for (const [sev, input] of slaInputs) {
      // Never overwrite the box someone is typing in.
      if (document.activeElement !== input) input.value = String(draft.slaTargets[sev]);
    }
    onEdit();
  }

  async function onSave() {
    const v = validateDraft(draft);
    if (!v.ok) {
      toast(v.message, "error");
      tabs.select(v.tab);
      return;
    }
    for (const w of draftWarnings(saved, draft, ctx)) {
      tabs.select(w.tab);
      const ok = await confirmDialog({
        title: w.title, body: w.body, confirmLabel: w.confirmLabel, danger: true,
      });
      if (!ok) return;
    }

    bar.setBusy(true);
    try {
      const res = await call("api_setSettings", settingsPatch(saved, draft));
      // Re-seed from what was STORED rather than from what was sent: the two differ wherever
      // cleanSettings normalizes, and a draft seeded from the request would then read dirty
      // against its own save.
      savedShape = res;
      Object.assign(saved, settingsDraft(savedShape, ctx));
      draft = settingsDraft(savedShape, ctx);
      // Nothing here is torn down; every other page refetches on its own next visit, which is
      // what these two arrange. No re-render, so no discarded draft and no lost tab.
      invalidateBootstrap();
      invalidateRpcCache();
      repaintFromDraft();
      toast("Settings saved.");
    } catch (e) {
      toast(`Save failed: ${String((e && e.message) || e)}`, "error");
    } finally {
      bar.setBusy(false);
    }
  }

  function onDiscard() {
    draft = settingsDraft(savedShape, ctx);
    repaintFromDraft();
  }

  repaintFromDraft();
}
