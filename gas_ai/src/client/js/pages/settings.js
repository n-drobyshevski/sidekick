// Settings: default graph depth, node budget, and credential status (read-only —
// secrets are set as Script Properties in the GAS editor, never through the UI).

import { call } from "../api.js";
import { bootstrap } from "../store.js";
import { clientBuild, describeBuild } from "../buildInfo.js";
import { clear, el, emptyState, skeleton, statusPill, toast } from "../ui.js";

export async function renderSettings(main, _params, ctx) {
  main.append(
    el("h1", {}, "Settings"),
    el("p", { class: "page-sub" }, "Graph defaults and connection status."),
  );

  const host = el("div", {});
  main.append(host);
  // Placeholder form until api_getSettings resolves; paint() clears the host.
  host.append(el("div", {
    class: "card", role: "status", "aria-label": "Loading settings",
    style: "display:flex; flex-direction:column; gap:16px",
  },
    skeleton("line", { width: "140px" }),
    skeleton("pill", { width: "200px" }),
    skeleton("line", { width: "140px" }),
    skeleton("pill", { width: "200px" }),
    skeleton("pill", { width: "120px" })));

  let settings;
  let boot = null;
  try {
    boot = await bootstrap();
  } catch (e) {
    boot = null; // the build card degrades to client-only rather than failing the page
  }
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
      type: "number",
      min: String(s.maxNodesFloor || 30),
      max: String(s.maxNodesCeiling || 400),
      step: "10",
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
          "Depth bounds how far the graph walks from its seeds; the node budget is a " +
          "hard ceiling on one view — 100 by default, counting the “+N more” stubs. A " +
          "view that hits it says so with a ⚠ capped pill and offers “Load more”, which " +
          "widens that one view without touching this default. Both keep server payloads " +
          "light; raise them only if views feel too shallow."),
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

    host.append(buildCard());
  }

  /**
   * Which build is actually running.
   *
   * An Apps Script deployment can be stale three ways at once — an old file in the
   * project, a web app pinned to an old VERSION so `clasp push` changes nothing at
   * /exec, or a copy-paste deploy that updated some files and not others. None of it is
   * visible from the running app, so this states it outright.
   *
   * Client and server are stamped separately because they ship as separate files:
   * js_app.html and server.js. A project holding a new client and an old server looks
   * healthy right up until an RPC answers a shape the client no longer expects.
   */
  function buildCard() {
    const client = clientBuild();
    const server = (boot && boot.build) || null;
    // Only compare two REAL stamps. "dev" means "built without the define step" (vitest,
    // or a dev server that skipped it), not "a different build" — treating it as a
    // mismatch reported a deployment fault that did not exist.
    const stamped = (b) => !!b && !!b.id && b.id !== "dev";
    const mismatch = stamped(client) && stamped(server) && client.id !== server.id;

    return el("div", { class: "card", style: "margin-top:14px" },
      el("h3", {}, "Build"),
      el("dl", { class: "kv" },
        el("dt", {}, "Client"), el("dd", {}, describeBuild(client)),
        el("dt", {}, "Server"),
        el("dd", {}, server ? describeBuild(server) : "unavailable"),
      ),
      mismatch
        ? el("p", { class: "small", style: "margin:10px 0 0; color:var(--bad)" },
            "The client and server bundles came from different builds. The Apps Script " +
            "project has js_app.html and server.js from different pushes — re-deploy " +
            "everything in dist/, then create a NEW version so /exec serves it.")
        : null,
      el("p", { class: "small muted", style: "margin:10px 0 0" },
        "A content hash of the source this bundle was built from — the same source always " +
        "gives the same stamp. To turn it into commits, run npm run which-build with the " +
        "id above; it replays the hash across history and names every commit that " +
        "produces this build, and prints the ancestry check for asking whether a " +
        "particular change is live. Remember that clasp push updates the code but not the " +
        "deployed version: /exec keeps serving the version it was pinned to until you " +
        "deploy a new one."),
    );
  }
}
