// Settings: default graph depth, node budget, and credential status (read-only —
// secrets are set as Script Properties in the GAS editor, never through the UI).

import { call } from "../api.js";
import { bootstrap } from "../store.js";
import { clientBuild, describeBuild } from "../buildInfo.js";
import {
  clear, debounce, el, emptyState, segmented, sevBadge, skeleton, statusPill, toast,
} from "../ui.js";

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
  // Closed over by fiveRsCard() below, the same way `boot` is closed over by buildCard().
  let fiveRsState = { scope: null, error: "" };
  try {
    boot = await bootstrap();
  } catch (e) {
    boot = null; // the build card degrades to client-only rather than failing the page
  }

  // The 5Rs policy list belongs to api_getCompliance, not api_getSettings — computing it
  // needs posture, findings and assets, which api_getSettings has no business loading. So
  // the two RPCs are fetched side by side (scans.js:80-106's idiom) and degraded on their
  // own terms: losing settings fails the whole page, since nothing below can render
  // without it, but losing compliance only costs the 5Rs card its rule list, which says so
  // in a line of its own instead of taking the rest of Settings down with it.
  const settled = await Promise.allSettled([
    call("api_getSettings", {}),
    call("api_getCompliance", {}),
  ]);

  if (settled[0].status === "rejected") {
    const e = settled[0].reason;
    host.append(emptyState("Couldn't load settings.", String((e && e.message) || e)));
    return;
  }
  settings = settled[0].value;

  if (settled[1].status === "fulfilled") {
    // A stale payload cached from before fiveRsScope shipped carries no such key at all —
    // that degrades to "no 5Rs framework collected" below, not to an error.
    fiveRsState = { scope: (settled[1].value && settled[1].value.fiveRsScope) || null, error: "" };
  } else {
    const e = settled[1].reason;
    fiveRsState = { scope: null, error: String((e && e.message) || e) };
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

    // Connection status, and the one behaviour that depends on it.
    //
    // This toggle saves on change, unlike the two fields above it, which batch behind one
    // Save button. That is a choice, not an oversight: a second Save button on one page
    // reads as ambiguous scope, and a control in this card driven by a button in that one
    // is worse. A single binary with an immediately reversible effect is the case where
    // save-on-change is the honest model.
    const autoExpandToggle = segmented({
      options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      value: s.autoExpand === false ? "off" : "on",
      ariaLabel: "Expand agent neighbourhoods from Wiz automatically",
      onChange: async (v) => {
        try {
          const fresh = await call("api_setSettings", { autoExpand: v === "on" });
          autoExpandToggle.set(fresh.autoExpand === false ? "off" : "on");
          toast("Settings saved.");
          // Bootstrap carries this flag to the detail sheet, so it has to be re-read
          // before an already-open sheet consults it again.
          ctx.refresh();
        } catch (e) {
          // Snap back to the stored value: the control must never show a state the
          // server did not accept.
          autoExpandToggle.set(s.autoExpand === false ? "off" : "on");
          toast(String(e.message || e), "error");
        }
      },
    });
    if (!s.hasCredentials) {
      // Inert without credentials — the expansion is a live read. The pill beside it
      // already says why, so this does not repeat the reason in different words.
      for (const btn of autoExpandToggle.querySelectorAll("button")) btn.disabled = true;
    }

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
        el("div", { class: "field", style: "margin:14px 0 0" },
          el("label", { class: "field-label" }, "Expand agent neighbourhoods automatically"),
          autoExpandToggle),
        el("p", { class: "small muted", style: "margin:8px 0 0" },
          "An AI agent's detail sheet shows the connections the last sync collected, which " +
          "is only what the scan's fixed traversals asked for. With this on, opening an " +
          "agent also asks Wiz for its full neighbourhood — guardrails, endpoints, MCP " +
          "servers and the agents it invokes — and folds anything new into the connection " +
          "map, saying so beneath it. One API call per agent per scan, reused for the rest " +
          "of the day. Turn it off to read only what the last sync stored."),
      ),
    );

    host.append(fiveRsCard(s));

    host.append(buildCard());
  }

  /**
   * The 5Rs — Wiz for Data Security scope card: which of that framework's policies count
   * as AI-relevant, edited here as a batch of pins, not saved on change like the toggle
   * above — see this file's own rule at the top: a second Save button on one page reads as
   * ambiguous scope, and a control in this card driven by a button in another one is worse.
   *
   * The dirty/Save/Revert vocabulary below is scanSheet.js's varsEditor, copied on purpose:
   * a stable `box` container whose `.draft` property is reassigned (never `box` itself, so
   * every row/group control below keeps reading and writing the same live value instead of
   * a snapshot), an "Unsaved" `pill warn`, and Save that stays enabled even though there is
   * nothing here to invalidate — a disabled control cannot explain itself.
   *
   * THE CORE IDEA, which every row's toggle and the group bulk-toggle both funnel through:
   * editing a rule changes the PIN, never the derived value directly. Turning a
   * derived-out rule ON adds its id to `in`; turning a derived-in rule OFF adds it to
   * `out`; and putting a rule back to whatever its own derivation already says removes it
   * from both lists, rather than leaving a pin that merely restates the default. That keeps
   * the stored decision exactly as large as the real overrides, and it is what lets the
   * derivation keep tracking the landscape afterwards: a rule pinned in because it once had AI
   * findings falls back out of the pin set the instant someone returns it to "as derived",
   * instead of staying stuck at whatever was true on the day someone touched it. A flat
   * "here is every rule's chosen state" list could not do that — it would have to be pinned
   * to KEEP tracking the landscape, which is exactly backwards.
   */
  function fiveRsCard(s) {
    const scope = fiveRsState.scope;
    const scopeError = fiveRsState.error;

    if (scopeError) {
      return el("div", { class: "card", style: "margin-top:14px" },
        el("h3", {}, "5Rs — Wiz for Data Security"),
        el("p", { class: "small muted", style: "margin:10px 0 0" },
          "Couldn't load the 5Rs rules. " + scopeError));
    }
    if (!scope || !scope.frameworkId) {
      // Covers both a tenant with no 5Rs framework collected and the stale-payload case —
      // the two are indistinguishable here and both get the same one-line card rather
      // than an empty control with nothing to operate on.
      return el("div", { class: "card", style: "margin-top:14px" },
        el("h3", {}, "5Rs — Wiz for Data Security"),
        el("p", { class: "small muted", style: "margin:10px 0 0" },
          "No 5Rs framework is collected."));
    }
    if (!scope.policies || !scope.policies.length) {
      return el("div", { class: "card", style: "margin-top:14px" },
        el("h3", {}, "5Rs — Wiz for Data Security"),
        el("p", { class: "small muted", style: "margin:10px 0 0" },
          `${scope.frameworkName} has no policies mapped yet.`));
    }

    // Grouped by subcategory, in first-seen order — the payload does not promise the list
    // arrives pre-grouped, only that every row carries its subcategory's id and title.
    const groups = [];
    const byKey = new Map();
    for (const row of scope.policies) {
      const key = row.categoryExternalId + " " + row.subcategoryExternalId;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          subcategoryExternalId: row.subcategoryExternalId,
          subcategoryTitle: row.subcategoryTitle,
          rows: [],
        };
        byKey.set(key, g);
        groups.push(g);
      }
      g.rows.push(row);
    }
    // The GROUPS sort by external id; the ROWS inside them do not. The two orders answer
    // different questions and neither should borrow the other's. Rows arrive
    // out-of-scope-first, which is what an operator reviewing a derivation wants to read
    // — but letting the groups inherit that emits them in whatever sequence the first
    // out-of-scope rule happened to fall in (4.1, 5.1, 3.1, 2.1 on the seeded landscape),
    // which reads as arbitrary and does not match the register on the Compliance page, so
    // the same framework would have two different shapes in two places. Sorted on the
    // composite key so the category orders before the subcategory within it.
    groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const savedPins = s.fiveRsPins || { in: [], out: [] };
    const saved = { in: [...(savedPins.in || [])], out: [...(savedPins.out || [])] };
    // NOT a reassignable local — see the comment above fiveRsCard(). Every row and group
    // control closes over `box` and reads/writes `box.draft`, so Revert and Reset only ever
    // replace the property's value, never this container.
    const box = { draft: { in: [...saved.in], out: [...saved.out] } };
    let busy = false;

    const normPins = (p) => JSON.stringify({ in: [...p.in].sort(), out: [...p.out].sort() });
    const dirty = () => normPins(box.draft) !== normPins(saved);

    /** What this rule would be with no pin at all — the value setDraft() diffs against. */
    function derivedSelected(row) {
      if (row.reason === "pinnedIn") return false;
      if (row.reason === "pinnedOut") return true;
      return row.selected;
    }

    function draftSelected(row) {
      if (box.draft.in.indexOf(row.policyId) >= 0) return true;
      if (box.draft.out.indexOf(row.policyId) >= 0) return false;
      return derivedSelected(row);
    }

    /** The diff-against-derived write described in the comment above fiveRsCard(). */
    function setDraft(row, value) {
      const derived = derivedSelected(row);
      const addTo = value ? box.draft.in : box.draft.out;
      const removeFrom = value ? box.draft.out : box.draft.in;
      const ri = removeFrom.indexOf(row.policyId);
      if (ri >= 0) removeFrom.splice(ri, 1);
      const ai = addTo.indexOf(row.policyId);
      if (value === derived) {
        if (ai >= 0) addTo.splice(ai, 1);
      } else if (ai === -1) {
        addTo.push(row.policyId);
      }
    }

    // 120 rules across six subcategories, and no way to find one by name before this.
    const scopeSearch = el("input", {
      type: "search",
      placeholder: "Search " + scope.total + " rules",
      "aria-label": "Search the 5Rs rules",
    });
    const scopeSearchCount = el("span", { class: "count", role: "status" });
    const scopeQuery = () => scopeSearch.value.trim().toLowerCase();
    const rowHay = (r) =>
      [r.name, r.shortId, r.policyKind].filter(Boolean).join(" ").toLowerCase();

    const stateEl = el("span", { class: "scope-state" });
    const saveBtn = el("button", { class: "primary" }, "Save");
    const revertBtn = el("button", {}, "Revert");
    const resetBtn = el("button", {}, "Reset to derived");
    const bar = el("div", { class: "scope-bar" }, stateEl, resetBtn, revertBtn, saveBtn);

    function buildRow(row) {
      const boxGlyph = el("span", { class: "scope-box", "aria-hidden": "true" });
      const labelEl = el("span", {}, "");
      const toggle = el("button", { type: "button", class: "scope-toggle" }, boxGlyph, labelEl);
      toggle.addEventListener("click", () => {
        setDraft(row, !draftSelected(row));
        syncAll();
      });

      // "pinned" here means a human chose this, not that this app derived it — that is a
      // different kind of fact from crossMapped/linkedFindings/noAiLink, and the row says
      // so with its own tint rather than folding both into one grey "reason" line.
      const pinned = row.reason === "pinnedIn" || row.reason === "pinnedOut";
      const reasonEl = el("span", {
        class: "scope-reason" + (pinned ? " scope-reason--pinned" : ""),
      }, reasonText(row));

      const node = el("div", { class: "scope-row" },
        el("div", { class: "scope-row-main" },
          el("div", { class: "scope-row-name" }, row.name),
          el("div", { class: "scope-row-meta small muted" },
            [row.shortId, policyKindLabel(row.policyKind)].filter(Boolean).join(" · "))),
        sevBadge(row.severity),
        reasonEl,
        toggle);

      function sync() {
        const sel = draftSelected(row);
        node.setAttribute("data-selected", sel ? "true" : "false");
        toggle.setAttribute("aria-pressed", sel ? "true" : "false");
        toggle.setAttribute("aria-label", `${row.name} — ${sel ? "Selected" : "Not selected"}`);
        labelEl.textContent = sel ? "Selected" : "Not selected";
      }

      return { node, sync };
    }

    function buildGroup(group) {
      const rowCtrls = group.rows.map(buildRow);
      const countEl = el("span", { class: "scope-group-count" });
      const bulkBtn = el("button", { type: "button", class: "scope-bulk" });
      bulkBtn.addEventListener("click", () => {
        const allIn = group.rows.every((r) => draftSelected(r));
        for (const r of group.rows) setDraft(r, !allIn);
        syncAll();
      });

      const rowsEl = el("div", { class: "scope-rows" }, ...rowCtrls.map((c) => c.node));

      // COLLAPSED BY DEFAULT, because this one card was 7,909px of an 8,912px page: 120 rule
      // rows in six groups, every one of them expanded, with no way to skip a subcategory you
      // did not come for. The head already carries everything a summary needs — the
      // subcategory, "N of M in scope", and the bulk action — so the rows are what folds.
      //
      // `userOpen` is null until a human touches the toggle. Until then the group opens
      // itself whenever it holds a pin or a search hit, so an unsaved change can never be
      // hidden behind a fold; after that the reader's choice wins.
      let userOpen = null;
      const toggle = el("button", {
        type: "button", class: "scope-disclose", "aria-expanded": "false",
        "aria-controls": rowsEl.id || undefined,
      });
      function applyOpen(open) {
        rowsEl.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "Hide" : "Show";
        toggle.setAttribute("aria-label",
          (open ? "Hide " : "Show ") + group.rows.length + " rules in "
          + group.subcategoryTitle);
      }
      toggle.addEventListener("click", () => {
        userOpen = rowsEl.hidden;
        applyOpen(userOpen);
      });
      applyOpen(false);

      const node = el("div", { class: "scope-group" },
        el("div", { class: "scope-group-head" },
          el("div", { class: "scope-group-title" },
            el("span", { class: "comp-ext" }, group.subcategoryExternalId),
            group.subcategoryTitle),
          countEl,
          bulkBtn,
          toggle),
        rowsEl);

      function sync() {
        const n = group.rows.filter((r) => draftSelected(r)).length;
        countEl.textContent = `${n} of ${group.rows.length} in scope`;
        // A row the reader is searching for, or has pinned, must not sit behind a fold.
        const q = scopeQuery();
        let hits = 0;
        group.rows.forEach((r, i) => {
          const hit = !q || rowHay(r).includes(q);
          rowCtrls[i].node.hidden = !hit;
          if (hit) hits++;
        });
        const pinned = group.rows.some(
          (r) => box.draft.in.indexOf(r.policyId) >= 0 || box.draft.out.indexOf(r.policyId) >= 0,
        );
        node.hidden = q ? hits === 0 : false;
        applyOpen(userOpen !== null ? userOpen : (pinned || (!!q && hits > 0)));
        const allIn = n === group.rows.length;
        bulkBtn.textContent = allIn ? "Deselect all" : "Select all";
        bulkBtn.setAttribute("aria-label",
          `${allIn ? "Deselect" : "Select"} all — ${group.subcategoryTitle}`);
        for (const c of rowCtrls) c.sync();
      }

      return { node, sync, group };
    }

    const groupCtrls = groups.map(buildGroup);

    function syncAll() {
      for (const g of groupCtrls) g.sync();
      const q = scopeQuery();
      const shown = groupCtrls.reduce(
        (n, g) => n + g.group.rows.filter((r) => !q || rowHay(r).includes(q)).length, 0);
      scopeSearchCount.textContent = q
        ? shown + " of " + scope.total + " rules"
        : scope.total + " rules";
      clear(stateEl);
      if (busy) stateEl.append(el("span", { class: "pill neutral" }, "Working…"));
      else if (dirty()) stateEl.append(el("span", { class: "pill warn" }, "Unsaved"));
      revertBtn.disabled = !dirty() || busy;
      // Save stays enabled regardless: there is no invalid state here for a disabled
      // button to be silently protecting the reader from.
      saveBtn.disabled = busy;
      resetBtn.disabled = busy;
    }

    saveBtn.addEventListener("click", async () => {
      busy = true; syncAll();
      try {
        await call("api_setSettings", {
          fiveRsPins: { in: [...box.draft.in], out: [...box.draft.out] },
        });
        toast("5Rs scope saved.");
        busy = false;
        // swrCall's in-page cache is not version-aware — without this, navigating back to
        // Compliance would still serve the payload computed against the pins just replaced.
        ctx.refresh();
      } catch (e) {
        busy = false; syncAll();
        toast(String((e && e.message) || e), "error");
      }
    });

    revertBtn.addEventListener("click", () => {
      box.draft = { in: [...saved.in], out: [...saved.out] };
      syncAll();
    });

    resetBtn.addEventListener("click", () => {
      box.draft = { in: [], out: [] };
      syncAll();
    });

    scopeSearch.addEventListener("input", debounce(() => syncAll(), 120));

    syncAll();

    return el("div", { class: "card", style: "margin-top:14px" },
      el("h3", {}, "5Rs — Wiz for Data Security"),
      el("p", { class: "small muted", style: "margin:6px 0 14px" },
        `${scope.frameworkName} · ${scope.selected} of ${scope.total} rules in scope now. ` +
        "Toggling a rule pins it; toggling it back to what is shown below clears the pin " +
        "and lets the landscape keep deciding it."),
      el("div", { class: "toolbar" },
        el("div", { class: "field" }, scopeSearch), scopeSearchCount),
      el("div", { class: "scope-groups" }, ...groupCtrls.map((g) => g.node)),
      bar);
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

// --------------------------------------------------------- 5Rs scope card: pure helpers

/**
 * Labels the PolicyScope.policyKind carries — the same three-way split complianceOverview.js
 * and complianceShared.js already spell out for the same reason each time: a Control is a
 * graph query over the landscape, a cloud rule a Rego evaluation against one resource type, and
 * a host rule something that runs on the machine, so presenting them as one kind of thing
 * would misdescribe what a row actually checks. Kept local rather than shared because it is
 * three lines of presentation, not logic — duplicating it costs less than a shared import
 * across three files that would otherwise need to agree on nothing beyond these three labels.
 */
function policyKindLabel(kind) {
  if (kind === "CONTROL") return "Control";
  if (kind === "HOST_RULE") return "Host rule";
  return "Cloud rule";
}

/**
 * The reason gloss for one PolicyScope row. `crossMapped` and `linkedFindings` are Wiz's own
 * derivation talking; `pinnedIn`/`pinnedOut` are this reader's own choice talking, and say so
 * in those words rather than reusing "selected"/"not selected" a second time in the same row.
 */
function reasonText(row) {
  if (row.reason === "crossMapped") {
    const names = (row.mappedBy || []).filter(Boolean);
    return `Mapped by ${names.length ? names.join(", ") : "another AI framework"}`;
  }
  if (row.reason === "linkedFindings") {
    const n = row.aiFindingCount || 0;
    return `${n} ${n === 1 ? "finding" : "findings"} on AI assets`;
  }
  if (row.reason === "pinnedIn") return "Pinned in";
  if (row.reason === "pinnedOut") return "Pinned out";
  return "No AI link"; // noAiLink
}
