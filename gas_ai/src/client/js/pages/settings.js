// Settings: five task tabs (Graph / Register / Compliance / Access / System) over ONE batched
// save bar.
//
// THIS PAGE USED TO ARGUE WITH ITSELF, and the argument is why it now looks like this. Every
// card saved on its own, and two comments in the old file explained why that was the least-bad
// option available at the time: "a second Save button on one page reads as ambiguous scope, and
// a control in this card driven by a button in that one is worse." True — but the premise was
// that a page can only have one save affordance if it has only one card. A page-level save bar
// is the third option. It owns every knob that writes the settings tab, names each pending
// change together with the tab that holds it, and lets a control live wherever it reads best
// instead of wherever its Save button is.
//
// What did NOT fold in, and why each is a different form rather than an exception:
//   * The access roster writes Script Properties through its own endpoints and its own
//     validation, so it keeps its own Save — the same split the OS tool draws.
//   * "Show experimental content" writes localStorage and reshapes the nav rail on the spot.
//     There is no server to reject it and nothing to batch it against, so it saves on change.
//
// settingsModel.js owns the draft/dirty/validate model (DOM-free, so it is the half vitest can
// hold — there is no jsdom in this suite); this file wires DOM controls to that draft and
// repaints from it. Controls are built ONCE and repainted, never rebuilt: the old full-repaint
// paint() is what forced the stable-accessHost workaround and the 5Rs card's box.draft
// indirection, both of which existed to keep a rebuild from eating unsaved edits.

import { call } from "../../../../../gas_shared/api.js";
import { setShowExperimental, showExperimental } from "../experimental.js";
import { bootstrap, invalidateBootstrap, invalidateRpcCache, setParams, swrCall } from "../../../../../gas_shared/store.js";
import { clientBuild } from "../buildInfo.js";
import {
  categoryDraftPatch, changeCountText, changeSummary, changedFields, dirtyTabs, draftWarnings,
  normalizeTab, rankDraftFromPreset, rankDraftPatch, rankShareTotal, SETTINGS_TABS,
  settingsDraft, settingsPatch, validateDraft,
} from "../settingsModel.js";
import { renderAccessPanel } from "./accessEditor.js";
import { staleNotices } from "../staleness.js";
import {
  clear, confirmDialog, debounce, diagnosticsPanel, disclosure, el, emptyState, errorState,
  field, heroLines,
  pageHeader, saveBar, select, settingRow,
  settingsPanel, sevBadge, skeleton, statusPill, switchToggle, tabList, toast,
} from "../ui.js";

export async function renderSettings(main, params, ctx) {
  main.append(
    pageHeader({
      route: "settings",
      lede: heroLines(
        "Graph, register scope and ranking, compliance, access, system",
        "Grouped by task; one save bar covers the tabs that share a draft.",
      ),
    }),
  );

  const host = el("div", {});
  main.append(host);
  host.append(el("div", {
    class: "card", role: "status", "aria-label": "Loading settings",
    style: "display:flex; flex-direction:column; gap:16px",
  },
    skeleton("line", { width: "140px" }),
    skeleton("pill", { width: "200px" }),
    skeleton("line", { width: "140px" }),
    skeleton("pill", { width: "200px" }),
    skeleton("pill", { width: "120px" })));

  let boot = null;
  try {
    boot = await bootstrap();
  } catch (e) {
    boot = null; // the build panel degrades to client-only rather than failing the page
  }

  // THREE RPCs, ONE ROUND TRIP. The 5Rs scope belongs to the compliance read-model rather than
  // api_getSettings (computing it needs posture, findings and assets), and the access roster
  // has its own endpoint and its own permission answer — so all three are fetched side by side
  // and degraded on their own terms. Losing settings fails the page, since nothing below can
  // render without it; losing the scope costs the Compliance panel its rule list; losing access
  // costs the Access tab, which is already a normal outcome for anyone who may not edit it.
  //
  // renderAccessPanel() is in here rather than awaited first (the OS tool's shape) because
  // awaiting it serially would add a whole round trip to first paint for a panel most readers
  // never see. It swallows its own errors and answers null, so allSettled is belt and braces.
  const settled = await Promise.allSettled([
    call("api_getSettings", {}),
    swrCall("api_getFiveRsScope", {}),
    renderAccessPanel(),
  ]);

  if (settled[0].status === "rejected") {
    const e = settled[0].reason;
    clear(host);
    host.append(errorState("Couldn't load settings.", { detail: String((e && e.message) || e) }));
    return;
  }
  const settings = settled[0].value;

  let fiveRsState = settled[1].status === "fulfilled"
    // A stale payload cached from before fiveRsScope shipped carries no such key at all — that
    // degrades to "no 5Rs framework collected" below, not to an error.
    ? { scope: (settled[1].value && settled[1].value.fiveRsScope) || null, error: "" }
    : {
      scope: null,
      error: String((settled[1].reason && settled[1].reason.message) || settled[1].reason),
    };

  const accessPanelNode = settled[2].status === "fulfilled" ? settled[2].value : null;

  clear(host);

  // ------------------------------------------------------------------------ draft model
  // `savedShape` is the payload settingsDraft() reads (api_getSettings, or api_setSettings's
  // echo after a save) — kept separately from `saved` so a later Discard can rebuild a fresh
  // draft exactly the way a save does.
  let savedShape = settings;
  const saved = settingsDraft(savedShape);
  let draft = settingsDraft(savedShape);

  const bounds = {
    nodesFloor: Number(settings.maxNodesFloor) || 30,
    nodesCeiling: Number(settings.maxNodesCeiling) || 400,
  };

  // ================================================================================ GRAPH TAB
  const depthSel = el("select", {
    id: "set-depth",
    onchange: () => { draft.defaultDepth = Number(depthSel.value); onEdit(); },
  }, ...[1, 2, 3].map((d) => el("option", { value: String(d) }, "Depth " + d)));

  const nodesInput = el("input", {
    id: "set-nodes", type: "number",
    min: String(bounds.nodesFloor), max: String(bounds.nodesCeiling), step: "10",
    oninput: () => { draft.maxNodes = Number(nodesInput.value); onEdit(); },
  });

  const graphPanel = settingsPanel({
    title: "Security graph defaults",
    description: "How far the graph walks from its seeds, and how much of one view it will draw.",
    body: [
      disclosure("Why this matters", el("p", {},
        "Depth bounds how far the graph walks from its seeds; the node budget is a hard ceiling "
        + "on one view, counting the +N more stubs it also draws. A view that hits it says so "
        + "with a capped pill and offers Load more, which widens that one view without touching "
        + "this default. Both keep server payloads light; raise them only if views feel too "
        + "shallow.")),
      settingRow({
        label: "Default depth", htmlFor: "set-depth",
        description: "How many hops out from a seed a new view walks.",
        control: depthSel,
      }),
      settingRow({
        label: "Node budget per view", htmlFor: "set-nodes",
        description: "A hard ceiling on one view, between " + bounds.nodesFloor
          + " and " + bounds.nodesCeiling + ".",
        control: nodesInput,
      }),
    ],
  });

  // The switch is disabled without credentials, because the expansion is a live read. Saying
  // why — and where to check — turns a dead control into a stated rule; the pill carries the
  // reason in words rather than leaving the greyed switch to imply it.
  const autoExpandSwitch = switchToggle({
    id: "set-autoexpand",
    checked: draft.autoExpand,
    disabled: !settings.hasCredentials,
    onChange: (v) => { draft.autoExpand = v; onEdit(); },
  });

  const autoExpandControl = el("div", { class: "setting-row__control" },
    settings.hasCredentials ? null : statusPill("neutral", "Needs credentials"),
    autoExpandSwitch.node);

  const expandPanel = settingsPanel({
    title: "Agent neighbourhoods",
    description: "Whether opening an AI agent asks Wiz for its full neighbourhood, or reads "
      + "only what the last sync stored.",
    body: [
      disclosure("Why this matters", el("p", {},
        "An agent's detail sheet shows the connections the last sync collected, which is only "
        + "what the scan's fixed traversals asked for. With this on, opening an agent also asks "
        + "Wiz for its guardrails, endpoints, MCP servers and the agents it invokes, and folds "
        + "anything new into the connection map, saying so beneath it. One API call per agent "
        + "per scan, reused for the rest of the day.")),
      settingRow({
        label: "Expand agent neighbourhoods automatically", htmlFor: "set-autoexpand",
        description: settings.hasCredentials
          ? "Costs one Wiz API call per agent per scan."
          : "Unavailable in dry-run — see Wiz connection on the System tab.",
        control: autoExpandControl,
      }),
    ],
  });

  // =========================================================================== COMPLIANCE TAB
  const fiveRsHost = el("div", {});
  let fiveRs = null; // { sync, count, total } once a real scope is drawn; null when degraded
  buildFiveRs();

  /**
   * The 5Rs — Wiz for Data Security scope: which of that framework's policies count as
   * AI-relevant.
   *
   * THE CORE IDEA, which every row toggle and the group bulk-toggle both funnel through:
   * editing a rule changes the PIN, never the derived value directly. Turning a derived-out
   * rule ON adds its id to `in`; turning a derived-in rule OFF adds it to `out`; and putting a
   * rule back to whatever its own derivation already says removes it from both lists, rather
   * than leaving a pin that merely restates the default. That keeps the stored decision exactly
   * as large as the real overrides, and it is what lets the derivation keep tracking the
   * landscape afterwards: a rule pinned in because it once had AI findings falls back out of
   * the pin set the instant someone returns it to "as derived", instead of staying stuck at
   * whatever was true on the day someone touched it. A flat "here is every rule's chosen state"
   * list could not do that — it would have to be pinned to KEEP tracking the landscape, which
   * is exactly backwards.
   *
   * WHAT CHANGED WHEN THIS FOLDED INTO THE PAGE SAVE BAR. Save, Revert and the "Unsaved" pill
   * are gone: the bar and the tab's dirty dot say all three, and a second dirty vocabulary
   * beside them would be worse than the ambiguity the bar was built to remove. "Reset to
   * derived" STAYS, in the panel footer, because it is not a save — it is a bulk edit that
   * empties both pin lists and makes the page dirty like any other edit.
   */
  function buildFiveRs() {
    clear(fiveRsHost);
    fiveRs = null;
    const scope = fiveRsState.scope;

    if (fiveRsState.error) {
      fiveRsHost.append(settingsPanel({
        title: "5Rs — Wiz for Data Security",
        description: "Couldn't load the 5Rs rules. " + fiveRsState.error,
        body: [],
      }));
      return;
    }
    if (!scope || !scope.frameworkId) {
      // Covers both a tenant with no 5Rs framework collected and the stale-payload case — the
      // two are indistinguishable here and both get the same one-line panel rather than an
      // empty control with nothing to operate on.
      fiveRsHost.append(settingsPanel({
        title: "5Rs — Wiz for Data Security",
        description: "No 5Rs framework is collected.",
        body: [],
      }));
      return;
    }
    if (!scope.policies || !scope.policies.length) {
      fiveRsHost.append(settingsPanel({
        title: "5Rs — Wiz for Data Security",
        description: "No policies are mapped to it yet.",
        body: [],
      }));
      return;
    }

    // Grouped by subcategory, in first-seen order — the payload does not promise the list
    // arrives pre-grouped, only that every row carries its subcategory's id and title.
    const groups = [];
    const byKey = new Map();
    for (const row of scope.policies) {
      // NUL as the separator, not "" and not a printable character. This key is also what
      // the groups sort on below, so the separator decides the order wherever one external
      // id is a prefix of another: with "" the pairs ("1","1") and ("1","01") collide
      // outright, and with a printable separator like "|" (124) they sort the opposite way
      // round to the register on the Compliance page, because NUL is below the digits and
      // "|" is above them. Written as an escape, never as a raw byte in the source.
      const key = row.categoryExternalId + "\u0000" + row.subcategoryExternalId;
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
    // out-of-scope-first, which is what an operator reviewing a derivation wants to read — but
    // letting the groups inherit that emits them in whatever sequence the first out-of-scope
    // rule happened to fall in, which reads as arbitrary and does not match the register on the
    // Compliance page, so the same framework would have two different shapes in two places.
    groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    /** What this rule would be with no pin at all — the value setPin() diffs against. */
    function derivedSelected(row) {
      if (row.reason === "pinnedIn") return false;
      if (row.reason === "pinnedOut") return true;
      return row.selected;
    }

    // Reads `draft` fresh on every call rather than closing over a snapshot, so a Discard that
    // reassigns `draft` to a brand-new object is picked up with no rebinding step here.
    function draftSelected(row) {
      const pins = draft.fiveRsPins;
      if (pins.in.indexOf(row.policyId) >= 0) return true;
      if (pins.out.indexOf(row.policyId) >= 0) return false;
      return derivedSelected(row);
    }

    /** The diff-against-derived write described in the comment above buildFiveRs(). */
    function setPin(row, value) {
      const pins = draft.fiveRsPins;
      const derived = derivedSelected(row);
      const addTo = value ? pins.in : pins.out;
      const removeFrom = value ? pins.out : pins.in;
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

    function buildRow(row) {
      const boxGlyph = el("span", { class: "scope-box", "aria-hidden": "true" });
      const labelEl = el("span", {}, "");
      const toggle = el("button", { type: "button", class: "scope-toggle" }, boxGlyph, labelEl);
      toggle.addEventListener("click", () => {
        setPin(row, !draftSelected(row));
        syncAll();
        onEdit();
      });

      // "pinned" here means a human chose this, not that this app derived it — that is a
      // different kind of fact from crossMapped/linkedFindings/noAiLink, and the row says so
      // with its own tint rather than folding both into one grey "reason" line.
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
        toggle.setAttribute("aria-label", row.name + " — " + (sel ? "Selected" : "Not selected"));
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
        for (const r of group.rows) setPin(r, !allIn);
        syncAll();
        onEdit();
      });

      const rowsEl = el("div", { class: "scope-rows" }, ...rowCtrls.map((c) => c.node));

      // COLLAPSED BY DEFAULT, because this one card was 7,909px of an 8,912px page: 120 rule
      // rows in six groups, every one of them expanded, with no way to skip a subcategory you
      // did not come for. The head already carries everything a summary needs — the
      // subcategory, "N of M in scope", and the bulk action — so the rows are what folds.
      //
      // `userOpen` is null until a human touches the toggle. Until then the group opens itself
      // whenever it holds a pin or a search hit, so an unsaved change can never be hidden
      // behind a fold; after that the reader's choice wins.
      let userOpen = null;
      const toggle = el("button", {
        type: "button", class: "scope-disclose", "aria-expanded": "false",
      });
      function applyOpen(open) {
        rowsEl.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "Hide" : "Show";
        toggle.setAttribute("aria-label",
          (open ? "Hide " : "Show ") + group.rows.length + " rules in " + group.subcategoryTitle);
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
        countEl.textContent = n + " of " + group.rows.length + " in scope";
        // A row the reader is searching for, or has pinned, must not sit behind a fold.
        const q = scopeQuery();
        let hits = 0;
        group.rows.forEach((r, i) => {
          const hit = !q || rowHay(r).includes(q);
          rowCtrls[i].node.hidden = !hit;
          if (hit) hits++;
        });
        const pins = draft.fiveRsPins;
        const anyPinned = group.rows.some(
          (r) => pins.in.indexOf(r.policyId) >= 0 || pins.out.indexOf(r.policyId) >= 0);
        node.hidden = q ? hits === 0 : false;
        applyOpen(userOpen !== null ? userOpen : (anyPinned || (!!q && hits > 0)));
        const allIn = n === group.rows.length;
        bulkBtn.textContent = allIn ? "Deselect all" : "Select all";
        bulkBtn.setAttribute("aria-label",
          (allIn ? "Deselect" : "Select") + " all — " + group.subcategoryTitle);
        for (const c of rowCtrls) c.sync();
      }

      return { node, sync, group };
    }

    const groupCtrls = groups.map(buildGroup);

    function selectedCount() {
      return groupCtrls.reduce(
        (n, g) => n + g.group.rows.filter((r) => draftSelected(r)).length, 0);
    }

    function syncAll() {
      for (const g of groupCtrls) g.sync();
      const q = scopeQuery();
      const shown = groupCtrls.reduce(
        (n, g) => n + g.group.rows.filter((r) => !q || rowHay(r).includes(q)).length, 0);
      scopeSearchCount.textContent = q
        ? shown + " of " + scope.total + " rules"
        : scope.total + " rules";
    }

    // Not a save, so it is not the save bar's job: it empties both pin lists, which is an edit
    // like any other and goes dirty like any other. It is also the ONLY way back to a pure
    // derivation once rules have been pinned — Discard returns to what was last saved, which is
    // a different question.
    const resetBtn = el("button", {
      type: "button",
      onclick: () => {
        draft.fiveRsPins = { in: [], out: [] };
        syncAll();
        onEdit();
      },
    }, "Reset to derived");

    fiveRsHost.append(settingsPanel({
      title: "5Rs — Wiz for Data Security",
      // The title already names the framework, so the description opens on the count instead of
      // repeating it. "as saved" is doing real work: that figure comes from the payload and does
      // not move as you edit, while the per-group counts below it do.
      description: scope.selected + " of " + scope.total + " rules in scope as saved. Toggling "
        + "a rule pins it; toggling it back to what the derivation says clears the pin and lets "
        + "the landscape keep deciding it.",
      body: [
        el("div", { class: "toolbar" },
          el("div", { class: "field" }, scopeSearch), scopeSearchCount),
        el("div", { class: "scope-groups" }, ...groupCtrls.map((g) => g.node)),
      ],
      footer: resetBtn,
    }));

    scopeSearch.addEventListener("input", debounce(() => syncAll(), 120));
    syncAll();
    fiveRs = { sync: syncAll, count: selectedCount, total: scope.total };
  }

  // ============================================================================== REGISTER TAB
  //
  // Two questions about the same register, neither of which Graph (traversal defaults) or
  // Compliance (the 5Rs framework) already answers: which Wiz risk categories the issue
  // register collects (issueCategories), and how the rows it collects are ordered
  // (rankRule / rankLeadsSort, src/domain/rank.ts's minimal model). Both feed the same
  // downstream pages — Priorities, AARS, Toxic Combinations — so both live on one tab.

  const candidateCategories = settings.candidateCategories || [];
  // The category the register cannot run without. First in the list BY CONSTRUCTION
  // (domain/registerScope.ts's CANDIDATE_CATEGORIES puts the AI category first) — read
  // positionally rather than repeating its id here, so this file names no category itself.
  const requiredCategoryId = candidateCategories.length ? candidateCategories[0].id : null;

  const categoryRows = candidateCategories.map((c) => {
    const required = c.id === requiredCategoryId;
    const inputId = "set-cat-" + c.id.replace(/[^a-zA-Z0-9]+/g, "-");
    const sw = switchToggle({
      id: inputId,
      checked: draft.issueCategories.indexOf(c.id) >= 0,
      disabled: required,
      onChange: (v) => {
        draft.issueCategories =
          categoryDraftPatch(draft.issueCategories, c.id, v, requiredCategoryId);
        onEdit();
      },
    });
    return {
      id: c.id,
      sw,
      row: settingRow({
        label: c.name,
        htmlFor: inputId,
        description: required
          ? "Always collected — this is what makes the register an AI register."
          : "Include this category's open issues and findings in the register.",
        control: sw.node,
      }),
    };
  });

  // The one live signal this tab can show for free: bootstrap already carries whether the
  // STORED register was collected under a different scope than the one below holds right
  // now. staleNotices() is the shared derivation (staleness.js) rather than a second
  // re-reading of boot.registerScope, so the wording here can never drift from what the
  // rest of the app would say about the same fact.
  const scopeNotices = boot ? staleNotices(boot).filter((n) => n.id === "registerScope") : [];

  const registerPanel = settingsPanel({
    title: "Register scope",
    description: "Which Wiz risk categories the issue register collects.",
    body: [
      disclosure("Why this matters", el("p", {},
        "Every issue-shaped figure this app publishes — the Priorities queue, AARS "
        + "pillar A, the Toxic Combinations page, the ai_issues tab itself — counts "
        + "only the rows one frameworkCategory filter returned. Widening this list does not "
        + "extend the register, it changes what every one of those figures counts: a total "
        + "of 6,073 beside a total of 99 is not growth, it is a different question being "
        + "answered. Nothing on an issue names which category fetched it, so a row is only "
        + "ever counted under a category selected here at the time of the sync that "
        + "collected it.")),
      // THE STANDING NOTICE. Always shown, never gated behind a colour: the words carry the
      // claim (bold, not tinted), and it says what to do about it in the same sentence.
      el("p", { class: "small", style: "margin:0 0 4px" },
        el("strong", {}, "Changing this changes what every published figure counts. "),
        "The stored register keeps counting the OLD categories until the next sync applies "
        + "the new scope — nothing here takes effect on its own."),
      ...scopeNotices.map((n) => el("div", { class: "notice warn", role: "status" },
        n.text + " ", el("a", { href: n.href }, n.link))),
      ...categoryRows.map((c) => c.row),
    ],
  });

  // ---------------------------------------------------------------- priorities ranking

  const rankPresets = settings.rankPresets || {};

  /** Read/write one top-level field of draft.rankRule without hand-rolling the pair twice. */
  function rankField(key) {
    return {
      get: () => draft.rankRule[key],
      set: (v) => { draft.rankRule = rankDraftPatch(draft.rankRule, { [key]: v }); },
    };
  }
  /** Same, one level into a nested table (shares / exploitationWeights / adjacencyWeights). */
  function rankLeaf(table, key) {
    return {
      get: () => (draft.rankRule[table] || {})[key],
      set: (v) => { draft.rankRule = rankDraftPatch(draft.rankRule, { [table]: { [key]: v } }); },
    };
  }

  const shareTotalOut = el("p", { class: "small muted", role: "status", style: "margin:4px 0 0" });
  function syncShareTotal() {
    const total = rankShareTotal(draft.rankRule.shares);
    shareTotalOut.textContent = "Shares total " + total.toFixed(2) + ". They need not sum to "
      + "1 — the blend renormalises over whichever terms a given row actually measured.";
  }

  /** One 0..1 number field bound to a rank-rule leaf, repaintable from `rankInputs[id]`. */
  const rankInputs = {};
  function rankNumber(id, labelText, leaf, { step = "0.05", min = "0", max = "1" } = {}) {
    const eltId = "set-rank-" + id;
    const input = el("input", {
      type: "number", id: eltId, min, max, step,
      oninput: () => {
        const v = Number(input.value);
        leaf.set(Number.isFinite(v) ? v : 0);
        onEdit();
        syncShareTotal();
      },
    });
    rankInputs[id] = { input, leaf };
    return field(eltId, labelText, input).node;
  }

  const presetSelect = select({
    options: Object.keys(rankPresets).map((k) => ({
      value: k, label: k === "v1" ? "v1 (today)" : k === "v2" ? "v2 (four terms)" : k,
    })),
    value: "",
    placeholder: "Load a preset…",
    ariaLabel: "Load a ranking preset",
    onChange: (v) => {
      if (!v || !rankPresets[v]) return;
      draft.rankRule = rankDraftFromPreset(rankPresets[v]);
      presetSelect.value = ""; // an action fired once, not a state this control keeps echoing
      repaintRankControls();
      onEdit();
    },
  });
  presetSelect.id = "set-rank-preset";

  const timeSourceSelect = select({
    options: [
      { value: "dueAtOnly", label: "Due date only (v1)" },
      { value: "dueAtElseAge", label: "Due date, falling back to age" },
    ],
    value: "dueAtOnly",
    ariaLabel: "Which clock the ranking reads",
    onChange: (v) => { rankField("timeSource").set(v); onEdit(); },
  });
  timeSourceSelect.id = "set-rank-time";

  const rankLeadsSwitch = switchToggle({
    id: "set-rank-leads",
    checked: draft.rankLeadsSort,
    onChange: (v) => { draft.rankLeadsSort = v; onEdit(); },
  });

  const rankPanel = settingsPanel({
    title: "Priorities ranking",
    description: "The minimal model that scores every row in the Priorities queue.",
    body: [
      disclosure("Why this matters", el("p", {},
        "Four terms, blended: the operator's own rule judgement, a clock (due date, or age "
        + "once a preset turns on the fallback), exploitation evidence folded up from an "
        + "issue's linked findings, and how close the row sits to the AI estate. A term "
        + "nobody could measure on a given row is dropped from BOTH sides of the blend "
        + "rather than counted as zero — an unmeasured exploitation must never read as "
        + "“we looked and found nothing.” Presets are a starting point for a "
        + "future evaluation harness to move, not a final answer.")),
      settingRow({
        label: "Load a preset", htmlFor: "set-rank-preset",
        description: "Replaces every number below. Save afterwards like any other edit.",
        control: presetSelect,
      }),
      el("div", { class: "rank-inputs" },
        el("span", { class: "rank-inputs__title" }, "Term shares"),
        rankNumber("share-rule", "Rule judgement", rankLeaf("shares", "rule")),
        rankNumber("share-time", "Clock", rankLeaf("shares", "time")),
        rankNumber("share-exploit", "Exploitation", rankLeaf("shares", "exploitation")),
        rankNumber("share-adjacency", "AI adjacency", rankLeaf("shares", "adjacency"))),
      shareTotalOut,
      settingRow({
        label: "Clock source", htmlFor: "set-rank-time",
        description: "dueAtOnly is v1 exactly. dueAtElseAge reads a row's age once it has no "
          + "deadline set.",
        control: timeSourceSelect,
      }),
      el("div", { class: "rank-inputs" },
        el("span", { class: "rank-inputs__title" }, "Exploitation ladder"),
        rankNumber("expl-kev", "On CISA KEV", rankLeaf("exploitationWeights", "kev")),
        rankNumber("expl-exploit", "Exploit available", rankLeaf("exploitationWeights", "exploit")),
        rankNumber("expl-epss", "EPSS over threshold", rankLeaf("exploitationWeights", "epss")),
        rankNumber("expl-none", "No exploit observed", rankLeaf("exploitationWeights", "none")),
        rankNumber("expl-threshold", "EPSS threshold", rankField("epssThreshold"),
          { step: "0.01" })),
      el("div", { class: "rank-inputs" },
        el("span", { class: "rank-inputs__title" }, "AI adjacency"),
        rankNumber("adj-direct", "On an AI asset", rankLeaf("adjacencyWeights", "DIRECT")),
        rankNumber("adj-adjacent", "Adjacent to one", rankLeaf("adjacencyWeights", "ADJACENT")),
        rankNumber("adj-unlinked", "No known link", rankLeaf("adjacencyWeights", "UNLINKED"))),
      settingRow({
        label: "Rank leads the Priorities order", htmlFor: "set-rank-leads",
        description: "Off: the Priorities page keeps Wiz severity → due date → age. "
          + "On: rank leads.",
        control: rankLeadsSwitch.node,
      }),
    ],
  });

  /** Repaint every rank control from `draft.rankRule` / `draft.rankLeadsSort`. */
  function repaintRankControls() {
    const r = draft.rankRule || {};
    for (const id of Object.keys(rankInputs)) {
      const { input, leaf } = rankInputs[id];
      if (document.activeElement !== input) {
        const v = leaf.get();
        input.value = Number.isFinite(Number(v)) ? String(v) : "";
      }
    }
    timeSourceSelect.value = r.timeSource === "dueAtElseAge" ? "dueAtElseAge" : "dueAtOnly";
    setSwitch(rankLeadsSwitch, !!draft.rankLeadsSort);
    syncShareTotal();
  }

  // =============================================================================== SYSTEM TAB
  // TWO of the three panels on this tab are diagnostics and go through
  // gas_shared/ui/diagnostics.js; the experimental toggle between them is a preference and
  // stays exactly where it is, on its own self-saving control. So this app takes the shared
  // module's `sections` rather than its `node` — the grid would put the two cards side by side
  // and push the toggle below both, which is a different page.
  //
  // `titleTag: "h2"` because these two panels each carried an h2 title. A read-out card labels
  // itself with a span by default (gas has one h2 above its whole grid instead); taking the
  // default here would silently delete two headings a screen-reader user navigates by.
  //
  // WHAT THIS APP DOES NOT PASS: no storage section (its `getStorageStats` publishes no
  // `cellLimit`, so there is no ratio to draw a meter from, and what it does publish is on the
  // Data page), no last-sync line (the field exists but only the nav rail reads it), and — the
  // one that matters most — NO ERRORS SECTION. This app has no recent-errors mechanism at all,
  // and an empty-state card would claim a log exists and happens to be quiet.
  const diagnostics = diagnosticsPanel({
    titleTag: "h2",
    credentials: {
      label: "Wiz connection",
      description: "Whether this workbook is reading a live tenant or the bundled sample data.",
      present: settings.hasCredentials,
      okLabel: "Credentials loaded — live sync enabled",
      missingLabel: "Dry-run — no credentials configured",
      // NEUTRAL, NOT BAD. Running this workbook against the bundled sample data is a
      // legitimate mode, not a fault — gas_devsecops draws the same boolean `bad` because a
      // register with nothing to sync there really is broken. The shared section refuses to
      // default this, so the difference has to be stated rather than inherited.
      missingTone: "neutral",
      note: "Credentials are Script Properties (WIZ_API_URL plus WIZ_API_TOKEN, or WIZ_CLIENT_ID "
        + "+ WIZ_CLIENT_SECRET), set in the Apps Script editor under Project Settings. They are "
        + "never entered or shown here. Run wizDiagnostic() in the editor to validate them.",
    },
    /**
     * Which build is actually running.
     *
     * An Apps Script deployment can be stale three ways at once — an old file in the project, a
     * web app pinned to an old VERSION so `clasp push` changes nothing at /exec, or a
     * copy-paste deploy that updated some files and not others. None of it is visible from the
     * running app, so this states it outright. Client and server are stamped separately
     * because they ship as separate files: a project holding a new client and an old server
     * looks healthy right up until an RPC answers a shape the client no longer expects.
     *
     * PASSING BOTH STAMPS is what selects the comparison form and the mismatch warning. The two
     * apps that publish one stamp pass only `server` and get the id, with no comparison and no
     * warning — gas_devsecops has this identical buildInfo.js module in its client, imported by
     * nothing, and wiring it up from here would be a new claim about that register rather than
     * the same claim expressed once. The shared section also refuses to compare a "dev" stamp
     * against a real one: "dev" means "built without the define step" (vitest, or a dev server
     * that skipped it), not "a different build", and treating it as a mismatch reported a
     * deployment fault that did not exist.
     */
    build: {
      label: "Build",
      description: "A content hash of the source each bundle was built from — the same source "
        + "always gives the same stamp.",
      client: clientBuild(),
      server: (boot && boot.build) || null,
      mismatchNote: "The client and server bundles came from different builds. The Apps Script "
        + "project has js_app.html and server.js from different pushes — re-deploy everything in "
        + "dist/, then create a NEW version so /exec serves it.",
      note: "To turn a stamp into commits, run npm run which-build with the id above; it replays "
        + "the hash across history and names every commit that produces this build. Remember "
        + "that clasp push updates the code but not the deployed version: /exec keeps serving "
        + "the version it was pinned to until you deploy a new one.",
    },
  });

  // The one control on this page that saves nothing to the ledger, and the reason it keeps
  // saving on change while everything else batches: there is no server to reject it, nothing to
  // validate it against, and its whole effect is to rebuild the nav rail — which a reader
  // expects to happen when they flip it, not when they press Save somewhere else. What it does
  // not copy from the batched controls is any snap-back: a control that reverted itself would
  // be inventing a failure that cannot happen here.
  const expSwitch = switchToggle({
    id: "set-experimental",
    checked: showExperimental(),
    onChange: (v) => {
      setShowExperimental(v);
      // Read back from the flag rather than echoing `v`, so the control can never show a state
      // that was not actually taken.
      setSwitch(expSwitch, showExperimental());
      toast("Settings saved.");
    },
  });

  const experimentalPanel = settingsPanel({
    title: "Experimental content",
    description: "Remembered in this browser only, like the sidebar's collapse. Other people "
      + "opening this workbook are unaffected.",
    body: [
      disclosure("Why this matters", el("p", {},
        "Off by default. On, the sidebar gains Labs, then Scoring Models — the findings score, "
        + "the problem cascade and the posture tiers, all three under calibration — and the Help "
        + "key sheet regains the definitions that are only ever drawn there. Nothing else in "
        + "this app reads those models either way, so this changes what you can open and never "
        + "what anything computes.")),
      settingRow({
        label: "Show experimental content", htmlFor: "set-experimental",
        description: "Saved as soon as you flip it — this one is not batched.",
        control: expSwitch.node,
      }),
    ],
  });

  // ================================================================ tabs, save bar, assembly
  function tabPanel(key, ...children) {
    return el("div", {
      id: "settings-panel-" + key, class: "settings-tabpanel", role: "tabpanel",
      "aria-labelledby": "settings-" + key, tabindex: "0",
    }, ...children);
  }

  const panels = {
    graph: tabPanel("graph", graphPanel, expandPanel),
    register: tabPanel("register", registerPanel, rankPanel),
    compliance: tabPanel("compliance", fiveRsHost),
    system: tabPanel(
      "system", diagnostics.sections.credentials, experimentalPanel, diagnostics.sections.build,
    ),
  };
  // THE ONE SECTION THAT MAY LEGITIMATELY VANISH. renderAccessPanel() answers null both for a
  // reader who may not edit the roster and for a failed fetch, and its own rule is that a
  // non-editor gets no section at all rather than a disabled one. Everywhere else an empty
  // section is drawn dimmed and counted zero, because an omission would read as "we don't check
  // that" — but this section is not empty, it is not yours, and there is nothing to count.
  if (accessPanelNode) panels.access = tabPanel("access", accessPanelNode);

  const tabDefs = SETTINGS_TABS.filter((t) => panels[t.key]);
  const tabKeys = tabDefs.map((t) => t.key);

  const tabs = tabList({
    tabs: tabDefs.map((t) => ({ key: t.key, label: t.label })),
    // Deep-linkable via `#/settings?tab=compliance`, not a sub-path (parseHash splits on "?" and
    // looks up PAGES[pathPart], so a sub-path would fall through to a different page). A stale
    // `?tab=access` on a workbook where Access is not drawn falls back rather than selecting a
    // tab that was never built.
    active: normalizeTab(params.tab, tabKeys),
    ariaLabel: "Settings sections",
    idPrefix: "settings",
    onSelect: (key) => {
      for (const k of tabKeys) panels[k].hidden = k !== key;
      // history.replaceState — does not fire hashchange, does not re-render.
      setParams({ tab: key });
    },
  });

  const bar = saveBar({ onSave, onDiscard, onJump: (tab) => tabs.select(tab) });

  host.append(tabs.node, ...tabKeys.map((k) => panels[k]), bar.node);

  // ------------------------------------------------------------------------ shared repainting
  function syncDirty() {
    const changed = changedFields(saved, draft);
    bar.update(changeCountText(changed), changeSummary(changed));
    const dt = new Set(dirtyTabs(changed));
    for (const k of tabKeys) tabs.setDirty(k, dt.has(k));
  }

  function onEdit() {
    syncDirty();
  }

  /**
   * Assigning `input.checked` does NOT fire "change", so switchToggle's own listener never runs
   * and aria-checked would keep announcing the old state. Every programmatic write goes through
   * here for that reason.
   */
  function setSwitch(sw, val) {
    sw.input.checked = val;
    sw.input.setAttribute("aria-checked", val ? "true" : "false");
  }

  function repaintControlsFromDraft() {
    depthSel.value = String(draft.defaultDepth);
    if (document.activeElement !== nodesInput) nodesInput.value = String(draft.maxNodes);
    setSwitch(autoExpandSwitch, draft.autoExpand);
    if (fiveRs) fiveRs.sync();
    for (const c of categoryRows) setSwitch(c.sw, draft.issueCategories.indexOf(c.id) >= 0);
    repaintRankControls();
    onEdit();
  }

  async function onSave() {
    const v = validateDraft(draft, bounds);
    if (!v.ok) {
      toast(v.message, "warn");
      tabs.select(v.tab);
      return;
    }
    // The resolved 5Rs selection, which a pin list alone cannot state: a pin is a diff against a
    // derivation this page holds and settingsModel does not.
    const scopeCount = fiveRs ? { selected: fiveRs.count(), total: fiveRs.total } : null;
    for (const w of draftWarnings(saved, draft, scopeCount)) {
      const ok = await confirmDialog({
        title: w.title, body: w.body, confirmLabel: w.confirmLabel, danger: true,
      });
      if (!ok) return;
    }

    bar.setBusy(true);
    try {
      const patch = settingsPatch(saved, draft);
      const pinsChanged = Object.prototype.hasOwnProperty.call(patch, "fiveRsPins");
      const res = await call("api_setSettings", patch);
      savedShape = { ...savedShape, ...res };
      Object.assign(saved, settingsDraft(savedShape));
      // Nothing on this page is torn down: every other page refetches on its own next visit,
      // which is what these two arrange. No ctx.refresh(), so no discarded draft and no lost
      // tab. invalidateRpcCache() is what the 5Rs card used to reach for ctx.refresh() to get —
      // it clears the same swr entry api_getFiveRsScope is cached under.
      invalidateBootstrap();
      invalidateRpcCache();
      syncDirty();
      toast("Settings saved.");
      // The scope payload is pin-aware: every row carries "pinnedIn"/"pinnedOut" as its reason
      // where a pin applied. Saving new pins leaves those glosses describing the pins we just
      // replaced. The SELECTION stays right either way (derivedSelected un-applies the old pin
      // before draftSelected applies the new one), so this is about the reason column telling
      // the truth, and it is a background repaint rather than a reason to block the save.
      if (pinsChanged) await reloadFiveRs();
    } catch (e) {
      toast("Save failed: " + String((e && e.message) || e), "error");
    } finally {
      bar.setBusy(false);
    }
  }

  async function reloadFiveRs() {
    let fresh;
    try {
      fresh = await swrCall("api_getFiveRsScope", {});
    } catch (e) {
      // Keep the rules the reader can already see rather than replacing a working panel with an
      // error: the save succeeded, and this refetch is cosmetic.
      return;
    }
    fiveRsState = { scope: (fresh && fresh.fiveRsScope) || null, error: "" };
    buildFiveRs();
    syncDirty();
  }

  function onDiscard() {
    draft = settingsDraft(savedShape);
    repaintControlsFromDraft();
  }

  // ------------------------------------------------------------------------------ first paint
  repaintControlsFromDraft();
}

// --------------------------------------------------------- 5Rs scope panel: pure helpers

/**
 * Labels the PolicyScope.policyKind carries — the same three-way split complianceOverview.js
 * and complianceShared.js already spell out for the same reason each time: a Control is a graph
 * query over the landscape, a cloud rule a Rego evaluation against one resource type, and a
 * host rule something that runs on the machine, so presenting them as one kind of thing would
 * misdescribe what a row actually checks. Kept local rather than shared because it is three
 * lines of presentation, not logic.
 */
function policyKindLabel(kind) {
  if (kind === "CONTROL") return "Control";
  if (kind === "HOST_RULE") return "Host rule";
  return "Cloud rule";
}

/**
 * The reason gloss for one PolicyScope row. `crossMapped` and `linkedFindings` are Wiz's own
 * derivation talking; `pinnedIn`/`pinnedOut` are this reader's own choice talking, and say so in
 * those words rather than reusing "selected"/"not selected" a second time in the same row.
 */
function reasonText(row) {
  if (row.reason === "crossMapped") {
    const names = (row.mappedBy || []).filter(Boolean);
    return "Mapped by " + (names.length ? names.join(", ") : "another AI framework");
  }
  if (row.reason === "linkedFindings") {
    const n = row.aiFindingCount || 0;
    return n + " " + (n === 1 ? "finding" : "findings") + " on AI assets";
  }
  if (row.reason === "pinnedIn") return "Pinned in";
  if (row.reason === "pinnedOut") return "Pinned out";
  return "No AI link"; // noAiLink
}
