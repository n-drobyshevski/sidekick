// Settings — Sidekick URLs, Access, System. THREE STACKED PANELS, NO TABS: this app has three
// things to say and none of them needs a room of its own the way gas_devsecops's seven fields
// across four tabs do.
//
// NO experimental.js — this app gates no route behind a "show experimental content" switch,
// so there is no control here for it.
//
// THE URL RULE IS STATED TWICE, ON PURPOSE. src/server/urls.ts's `normalizeAppUrl` is the
// BOUNDARY — it throws, and it is what `api_saveUrls` actually writes. `urlsModel.js`'s
// `urlProblem` is the SAME RULE restated as a field message, so a bad paste is caught before
// the save bar's own round trip rather than only after it, with nothing on the field itself
// saying why a save was refused. Two copies of one rule, not a fork of it — see urlsModel.js's
// own header for the case table both sides run.
//
// SYSTEM DRAWS ONLY product + build. This app calls no third-party API and stores no secret,
// so it has no `credentials` fact to report on and no `lastSync` — passing either key to
// diagnosticsPanel would ask for a missing-state tone this launcher has no fact to back. No
// import from src/domain or src/server anywhere in this file: everything it needs arrives
// already computed, through bootstrap() and the two url/access RPCs.

import { call } from "../../../../../gas_shared/api.js";
import { bootstrapCached, invalidateBootstrap } from "../../../../../gas_shared/store.js";
import {
  clear, diagnosticsPanel, el, errorState, pageHeader, saveBar, settingRow, settingsPanel,
  statusPill, toast,
} from "../ui.js";
import { renderAccessPanel } from "./accessEditor.js";
import { tileState } from "./hubModel.js";
import { urlPlaceholder, urlProblem } from "./urlsModel.js";
import { settingsForm } from "../../../../../gas_shared/ui/settingsForm.js";

const URL_FIELDS = [
  { key: "os", label: "OS Patching" },
  { key: "ai", label: "AI security" },
  { key: "devsecops", label: "DevSecOps" },
];

// ONE TAB, THREE FIELDS — the smallest registry the shared kernel takes. This app has a
// single panel with nothing to jump BETWEEN (see buildUrlsPanel's own header), so the tablist
// is one entry and `changeSummary`'s `tabLabel` always reads "Sidekick URLs" — the same literal
// the hand-fabricated summary below used to repeat for every changed field. Exported so
// test/shared.test.js can register the shared settingsForm contract against this app's own
// registry, the same way gas/gas_ai/gas_devsecops register it against their SETTINGS_TABS/
// SETTING_FIELDS.
export const URL_TABS = [{ key: "urls", label: "Sidekick URLs" }];
export const URL_TAB_FIELDS = Object.fromEntries(
  URL_FIELDS.map((f) => [f.key, { tab: "urls", label: f.label }]),
);
const urlSettingsForm = settingsForm({ tabs: URL_TABS, fields: URL_TAB_FIELDS, defaultTab: "urls" });

// ---------------------------------------------------------------------- the front-door readout
//
// Every sibling register gains a live readout this wave that states what a control is doing to
// its ledger — a population this app has none of. What it has instead: the reader is editing
// the three URLs that decide what the front door (hub.js's tile grid) looks like, and that
// front door is one click away and entirely invisible while they edit. So the readout here is
// not a measurement, it is a PREVIEW — the tile state hub.js would draw for each register,
// recomputed from the DRAFT as it is typed, not from what is on disk.
//
// THREE STATES, AND ONLY TWO OF THEM COME FROM hubModel.js. `tileState` answers "link" or
// "unset" — see that module's own header — and NOTHING ELSE: there is no "refused" state on a
// drawn tile, because a tile is only ever built from a SAVED, already-legal value. The third
// state lives only here, on the draft: `urlProblem` (this file's other import from
// urlsModel.js) is the FIELD-LEVEL refusal — a value the reader has typed that `api_saveUrls`
// will not accept. `urlReadoutState` is the one place both are asked about the same string.
//
// `tileState` IS CALLED, NOT REIMPLEMENTED. The link/unset boundary already has one correct
// definition in this app (hubModel.js, reused by hub.js's own grid); a second, slightly
// different copy of "what counts as a link" living in this file is exactly the bug worth
// preventing — the settings page and the front door disagreeing about the same URL. So this
// function's whole job is deciding whether `tileState` gets asked at all.
export function urlReadoutState(key, raw) {
  if (urlProblem(raw)) return "refused";
  // Past the check above, `raw` is guaranteed a legal string — urlProblem() itself refuses
  // anything that is not one (see its own header, the String(null)/String([]) trap) — but this
  // does not trust that from a distance any more than hubModel.js's tileState trusts a stray
  // URL on the "soon" tile: a plain `""` fallback is one line and removes the question.
  const trimmed = (typeof raw === "string" ? raw : "").trim();
  return tileState({ key, url: trimmed });
}

// The word (never colour alone) and the one-line "why" for each of urlReadoutState's three
// answers. `tone` feeds statusPill's kind, which already pairs a dot with the word — see
// gas_shared/styles/components.css's own comment on `.pill::before`, "a dot the colour never
// carries alone."
const READOUT = {
  link: { tone: "ok", word: "Linked", note: "The tile opens this register." },
  unset: {
    tone: "neutral", word: "Not configured",
    note: "The tile keeps its colour and headline and says so — never a broken link.",
  },
  refused: {
    tone: "bad", word: "Won't save",
    note: "Fix the value above — this draft will not be written to that register's tile.",
  },
};

// The ONLY pageHeader({ route: "settings" }) call in this file — the h1 text ("Settings")
// comes from PAGES via appConfig(), never a second copy of the string here.
export async function renderSettings(host, params, ctx) {
  host.append(pageHeader({ route: "settings" }));

  const urlsHost = el("div", {});
  const accessHost = el("div", {});
  const systemHost = el("div", {});
  host.append(urlsHost, accessHost, systemHost);

  await buildUrlsPanel(urlsHost, ctx);
  await buildAccessPanel(accessHost);
  buildSystemPanel(systemHost);
}

// ------------------------------------------------------------------------- Sidekick URLs

/**
 * Three `settingRow`s over `api_getUrls`, one `saveBar` covering all three — there is only
 * one panel on this page that is ever dirty, so there is nothing here for a save bar's
 * per-field tab-jump link to jump BETWEEN. `onJump` is a no-op and every change names the
 * same (only) panel; that is the degenerate, single-panel use of a control built for
 * gas_devsecops's four tabs, not a second save-bar shape invented just for this page.
 */
async function buildUrlsPanel(host, ctx) {
  let info;
  try {
    info = await call("api_getUrls", {});
  } catch (e) {
    // "Couldn't " — the anti-vacuity regex gas_shared/test/contracts/emptyStates.js pins
    // against this exact prefix.
    host.append(errorState("Couldn't load the sidekick URLs.", {
      detail: String((e && e.message) || e),
    }));
    return;
  }
  // No roster to show a viewer who cannot edit it — matches accessEditor.js's own rule for
  // the Access panel below: a non-editor gets no section at all, not a disabled one.
  if (!info || !info.canEditUrls) return;

  const saved = { os: "", ai: "", devsecops: "", ...(info.urls || {}) };
  let draft = { ...saved };
  // Fields currently failing their OWN input's validity check — a field can be invalid
  // without being dirty (an in-progress keystroke never writes into `draft` below), and
  // saving is refused while any are present.
  let invalid = {};
  // The field's text EXACTLY AS TYPED, valid or not — `draft` only ever holds a value that has
  // already cleared `urlProblem` (see the oninput handler below), so a keystroke that is
  // currently illegal would otherwise be invisible to the readout. This is what
  // `urlReadoutState` is asked about, not `draft`.
  let rawByKey = { ...saved };

  const bar = saveBar({ onSave: () => doSave(), onDiscard: () => doDiscard(), onJump: () => {} });
  const panelHost = el("div", {});

  // One row per URL field, built ONCE and mutated in place on every keystroke — never rebuilt.
  // Same reason gas_shared/ui/settingsReadouts.js's cut histogram never recreates its `<input
  // type=range>`: these rows sit inside the same panel as the three live text inputs, and
  // `build()` runs only on load, save and discard. If the readout rebuilt its own rows on
  // every edit it would cost nothing by itself, but sharing that habit with the fields
  // themselves is what silently drops mid-word focus — so this file keeps the two rebuild
  // rhythms visibly different: fields rebuild on `build()`, readout rows mutate on every edit.
  const readoutRows = URL_FIELDS.map((field) => {
    const pill = statusPill("neutral", "");
    const desc = el("span", { class: "setting-row__desc muted small" }, "");
    const row = el("div", { class: "setting-row" },
      el("div", { class: "setting-row__label" },
        el("span", { class: "setting-row__title" }, field.label), desc),
      el("div", { class: "setting-row__control" }, pill));
    return { key: field.key, row, pill, desc };
  });

  function repaintReadout() {
    for (const r of readoutRows) {
      const meta = READOUT[urlReadoutState(r.key, rawByKey[r.key])];
      r.pill.className = `pill ${meta.tone}`;
      r.pill.textContent = meta.word;
      r.desc.textContent = meta.note;
    }
  }

  function syncDirty() {
    const changed = urlSettingsForm.changedFields(saved, draft);
    bar.update(urlSettingsForm.changeCountText(changed), urlSettingsForm.changeSummary(changed));
    repaintReadout();
  }

  function fieldRow(field) {
    const id = "settings-url-" + field.key;
    const errorId = id + "-error";
    const errorEl = el(
      "span", { id: errorId, class: "small settings-field-error", role: "alert", hidden: true },
    );
    const input = el("input", {
      type: "text", id, value: draft[field.key] || "",
      placeholder: urlPlaceholder(),
      "aria-describedby": errorId,
      oninput: (ev) => {
        const raw = ev.target.value;
        rawByKey[field.key] = raw;
        const problem = urlProblem(raw);
        errorEl.hidden = !problem;
        errorEl.textContent = problem || "";
        input.setAttribute("aria-invalid", problem ? "true" : "false");
        if (problem) {
          invalid[field.key] = true;
        } else {
          delete invalid[field.key];
          draft[field.key] = raw.trim();
        }
        syncDirty();
      },
    });
    return settingRow({
      label: field.label, htmlFor: id,
      description: "The /exec URL from that sidekick's Deploy → Manage deployments.",
      control: el("div", {}, input, errorEl),
    });
  }

  function build() {
    const panel = settingsPanel({
      title: "Sidekick URLs",
      description: "Blank reads as \"not configured\" on that tile, never as a broken link.",
      body: [
        ...URL_FIELDS.map(fieldRow),
        el("span", { class: "label" }, "On the front door, right now"),
        ...readoutRows.map((r) => r.row),
      ],
    });
    clear(panelHost).append(panel);
    syncDirty();
  }

  async function doSave() {
    if (Object.keys(invalid).length) {
      toast("Fix the highlighted URL(s) before saving.", "error");
      return;
    }
    bar.setBusy(true);
    try {
      // api_saveUrls answers the after-URLs OBJECT ITSELF (src/server/api.ts's `saveUrls`
      // returns `after` directly, not `{ urls: after }` — unlike `api_getUrls`, which does
      // wrap its payload that way. The two endpoints are NOT symmetric here; this reads the
      // real return shape rather than assuming the pair matches.
      const result = await call("api_saveUrls", { urls: draft });
      Object.assign(saved, result);
      draft = { ...saved };
      rawByKey = { ...saved };
      // The tiles' own URLs came from this same bootstrap payload — a save with no refresh
      // would leave the front door linking to whatever was true when the page loaded.
      invalidateBootstrap();
      if (ctx && ctx.refresh) ctx.refresh();
      toast("Sidekick URLs saved.");
      build();
    } catch (e) {
      toast("Couldn't save the sidekick URLs: " + String((e && e.message) || e), "error");
    } finally {
      bar.setBusy(false);
    }
  }

  function doDiscard() {
    draft = { ...saved };
    invalid = {};
    rawByKey = { ...saved };
    build();
  }

  build();
  host.append(panelHost, bar.node);
}

// ------------------------------------------------------------------------------------ Access

async function buildAccessPanel(host) {
  const { panel } = await renderAccessPanel();
  if (panel) host.append(panel);
}

// ------------------------------------------------------------------------------------ System

/**
 * Product + build only. WHAT THIS APP DOES NOT PASS, and does not gain: no `credentials`
 * (this launcher holds no secret and calls no third-party API), no `lastSync` (it runs no
 * scan and no sync), no storage meter, no error log. Passing any of those would be a new
 * deployment claim about this app rather than the one fact it can actually measure.
 */
function buildSystemPanel(host) {
  const boot = bootstrapCached() || {};
  const diagnostics = diagnosticsPanel({
    heading: "Deployment",
    product: { value: boot.product },
    build: { server: boot.buildId },
  });
  host.append(diagnostics.node);
}
