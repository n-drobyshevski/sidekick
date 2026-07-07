// Settings: default graph depth, node budget, and credential status (read-only —
// secrets are set as Script Properties in the GAS editor, never through the UI).

import { call } from "../api.js";
import { clear, el, emptyState, statusPill, toast } from "../ui.js";

export async function renderSettings(main, _params, ctx) {
  main.append(
    el("h1", {}, "Settings"),
    el("p", { class: "page-sub" }, "Graph defaults and connection status."),
  );

  const host = el("div", {});
  main.append(host);

  let settings;
  try {
    settings = await call("api_getSettings", {});
  } catch (e) {
    host.append(emptyState("Couldn't load settings.", String(e.message || e)));
    return;
  }
  paint(settings);

  function paint(s) {
    clear(host);

    // Graph defaults.
    const depthSel = el("select", { "aria-label": "Default graph depth" },
      ...[1, 2, 3].map((d) => el("option", {
        value: String(d), selected: d === Number(s.defaultDepth) || null,
      }, `Depth ${d}`)),
    );
    const nodesInput = el("input", {
      type: "number", min: "30", max: "400", step: "10",
      value: String(s.maxNodes),
      "aria-label": "Maximum nodes per graph view",
    });
    const saveBtn = el("button", {
      class: "primary",
      onclick: async () => {
        saveBtn.disabled = true;
        try {
          const fresh = await call("api_setSettings", {
            defaultDepth: Number(depthSel.value),
            maxNodes: Number(nodesInput.value),
          });
          toast("Settings saved.");
          paint({ ...s, ...fresh });
          ctx.refresh();
        } catch (e) {
          toast(String(e.message || e), "error");
          saveBtn.disabled = false;
        }
      },
    }, "Save");

    host.append(
      el("div", { class: "card", style: "margin-bottom:14px" },
        el("h3", {}, "Security graph defaults"),
        el("div", { style: "display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end" },
          el("div", { class: "field" },
            el("label", { class: "field-label" }, "Default depth"), depthSel),
          el("div", { class: "field" },
            el("label", { class: "field-label" }, "Node budget per view"), nodesInput),
          saveBtn,
        ),
        el("p", { class: "small muted", style: "margin:10px 0 0" },
          "Depth bounds how far the graph walks from its seeds; the node budget caps " +
          "any single view. Both keep server payloads light — raise them only if views " +
          "feel too shallow."),
      ),
    );

    // Connection status.
    host.append(
      el("div", { class: "card" },
        el("h3", {}, "Wiz connection"),
        el("div", { style: "display:flex; gap:8px; align-items:center" },
          s.hasCredentials
            ? statusPill("ok", "Credentials loaded — live sync enabled")
            : statusPill("neutral", "Dry-run — no credentials configured"),
        ),
        el("p", { class: "small muted", style: "margin:10px 0 0" },
          "Credentials are Script Properties (WIZ_API_URL plus WIZ_API_TOKEN, or " +
          "WIZ_CLIENT_ID + WIZ_CLIENT_SECRET), set in the Apps Script editor under " +
          "Project Settings. They are never entered or shown here. Run wizDiagnostic() " +
          "in the editor to validate them."),
      ),
    );
  }
}
