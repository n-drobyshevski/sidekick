// Settings' hub field: where this register's header links back to.
//
// SHARED RATHER THAN COPIED, because it is the same panel in all three registers — the same
// one field, the same rule, the same endpoint name, the same two states. The three Settings
// pages it lands in have genuinely different shapes (gas builds tab nodes eagerly, gas_ai
// filters its tab list by what it could fetch, gas_devsecops rebuilds panels from a draft), so
// what they share is this node and not the page around it.
//
// ITS OWN SAVE, OUTSIDE THE BATCHED SAVE BAR, AND THAT IS THE DESIGN. Each app's save bar
// patches its settings dict; this writes a Script Property through `api_saveHubUrl` — a
// different store, a different access tier, a different failure mode. The access roster is
// held out of the bar for exactly this reason, and CLAUDE.md states the rule it follows: two
// forms with one save model each is fine, two models inside one form is not. So this field
// must never appear in an app's SETTINGS_KEYS / FIELD_TABS / BATCHED_KEYS, and an ordinary
// Register or Deadlines save must never carry it.
//
// THE FIELD MESSAGE IS NOT THE BOUNDARY. `hubUrlProblem` names a bad paste at the input,
// before a round trip that would otherwise return an error with nothing on the field to
// explain it. Each app's `src/server/hubUrl.ts` is the copy of record and re-checks every
// write — `google.script.run` reaches `api_saveHubUrl` from any allowed caller's console, so
// what this panel chose to draw has no bearing there.
//
// READ-ONLY IS A REAL STATE, not a disabled input. A reader who cannot edit the roster cannot
// edit this either, and the honest rendering of that is the stored value plus a sentence —
// rather than a control that looks live and is refused on submit.

import { call } from "../api.js";
import { HUB_URL_PLACEHOLDER, hubUrlProblem } from "../hubUrl.js";
import { el } from "./dom.js";
import { toast } from "./feedback.js";
import { settingRow, settingsPanel } from "./settings.js";

const TITLE = "Hub";
const DESCRIPTION = "Where this register's header links back to.";

/**
 * @param {object}   opts
 * @param {string}   opts.hubUrl    the stored value, from the bootstrap payload ("" when unset)
 * @param {boolean}  opts.canEdit   may this reader change it — the same tier that may edit the
 *                                  access roster. False draws the read-only form.
 * @param {Function} [opts.onSaved] called after a successful save. The header is drawn from the
 *                                  bootstrap payload, so without a refresh here the reader
 *                                  saves a URL and the control it is FOR does not move — pass
 *                                  the page's `refresh` seam.
 * @returns {HTMLElement}
 */
export function hubUrlPanel(opts) {
  const stored = typeof opts.hubUrl === "string" ? opts.hubUrl : "";

  if (!opts.canEdit) {
    return settingsPanel({
      title: TITLE,
      description: DESCRIPTION,
      body: [
        settingRow({
          label: "Hub URL",
          control: el("span", { class: "small muted" },
            stored || "Not configured — the header carries no hub button."),
        }),
        el("p", { class: "small muted" }, "Only the owner or an admin can change this."),
      ],
    });
  }

  const inputId = "settings-hub-url";
  const errorId = inputId + "-error";
  const error = el("span", {
    id: errorId, class: "small settings-field-error", role: "alert", hidden: true,
  });

  let value = stored;
  let saved = stored;
  let busy = false;

  const save = el("button", {
    class: "primary", disabled: true,
    onclick: async () => {
      busy = true;
      sync();
      try {
        // The endpoint returns what it actually STORED, which is the trimmed form — so the
        // field settles on the stored string rather than on the reader's whitespace, and a
        // second Save on an unchanged value is correctly inert rather than a no-op round trip
        // that still reports success.
        const res = await call("api_saveHubUrl", { hubUrl: value });
        input.value = res.hubUrl;
        value = res.hubUrl;
        saved = res.hubUrl;
        toast(res.hubUrl
          ? "Hub URL saved."
          : "Hub URL cleared — the header's hub button is gone.");
        if (opts.onSaved) opts.onSaved(res.hubUrl);
      } catch (e) {
        toast("Couldn't save the hub URL: " + ((e && e.message) || e), "error");
      } finally {
        busy = false;
        sync();
      }
    },
  }, "Save hub URL");

  const input = el("input", {
    type: "url", id: inputId, value: stored, spellcheck: "false",
    placeholder: HUB_URL_PLACEHOLDER,
    "aria-describedby": errorId,
    oninput: (ev) => { value = ev.target.value; sync(); },
  });

  /** One repaint for all three facts, so the message, the field's validity and the button can
   *  never disagree about the same string. */
  function sync() {
    const problem = hubUrlProblem(value);
    error.hidden = !problem;
    error.textContent = problem || "";
    input.setAttribute("aria-invalid", problem ? "true" : "false");
    // Trimmed on BOTH sides of the comparison: the stored form is trimmed, so padding alone is
    // not a change worth enabling a save for.
    save.disabled = busy || !!problem || value.trim() === saved;
  }
  sync();

  return settingsPanel({
    title: TITLE,
    description: DESCRIPTION,
    body: [
      settingRow({
        label: "Hub URL", htmlFor: inputId,
        description: "The hub web app's /exec URL, from its Deploy > Manage deployments. "
          + "Leave it blank and the header carries no hub button.",
        control: el("div", { class: "settings-inline" }, input, save, error),
      }),
    ],
  });
}
