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
  toast,
} from "../ui.js";
import { renderAccessPanel } from "./accessEditor.js";
import { urlPlaceholder, urlProblem } from "./urlsModel.js";

const URL_FIELDS = [
  { key: "os", label: "OS Patching" },
  { key: "ai", label: "AI" },
  { key: "devsecops", label: "DevSecOps" },
];

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

  const bar = saveBar({ onSave: () => doSave(), onDiscard: () => doDiscard(), onJump: () => {} });
  const panelHost = el("div", {});

  function syncDirty() {
    const changed = URL_FIELDS.filter((f) => draft[f.key] !== saved[f.key]);
    const countText = changed.length + " unsaved change" + (changed.length === 1 ? "" : "s");
    const summary = changed.map((f) => (
      { label: f.label, tab: "urls", tabLabel: "Sidekick URLs" }
    ));
    bar.update(countText, summary);
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
      body: URL_FIELDS.map(fieldRow),
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
