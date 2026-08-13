// The inventory's filter surface: a trigger button carrying an applied-count badge, a row
// of dismissible applied-filter chips, and the live-apply drawer the two belong to.
//
// This began as an extraction of the graph page's drawer, so the inventory would not get a
// second, worse copy of the best interaction in the app. The graph has since moved on: it
// docks its filters beside the canvas rather than over it, and keeps its own chip layer in
// pages/graphChips.js. So this has one consumer today. It stays a module rather than
// folding back into the page because the two halves it owns — a drawer that syncs in place
// instead of rebuilding, and chips that hand focus to their neighbour on removal — are the
// parts that are easy to get wrong and worth keeping named.
//
// If the inventory ever earns a docked panel too, the thing to share is graph.js's
// dock/modal re-hosting, not this.
//
// Live-apply throughout: there is no Apply button, every control writes straight through,
// and the drawer stays open while the results change behind it. That is why the drawer is
// deliberately NOT closeOnRouteChange — it rewrites its own query params on every toggle
// and would otherwise close itself (see the comment on the route hook in ui.js).

import { clear, el, meter, openSheet } from "./ui.js";

/**
 * @param opts.entries      () => [{key, label, sev?, patch}] — what is applied right now.
 *                          `patch` is the params patch that clears just that one entry.
 * @param opts.onPatch      (patch) => void — the page's own update()/param writer.
 * @param opts.onClearAll   () => void — clears every dimension at once.
 * @param opts.buildBody    (body, ctx) => sync|void — renders the drawer body; the returned
 *                          function is called on every external change so the open drawer
 *                          updates in place instead of being rebuilt (which would move
 *                          focus off the control the user just used).
 * @param opts.onPanelChange (name) => void — writes the `panel` param so an open drawer is
 *                          shareable and survives a reload.
 */
export function filterUI(opts) {
  const {
    entries, onPatch, onClearAll, buildBody, onPanelChange = null,
    title = "Filters", subtitle = "Changes apply immediately", width = "min(400px, 92vw)",
  } = opts;

  // The number is the signal — aria-hidden here because the button's own aria-label
  // states it in words, and reading "Filters 3" as two separate things is worse.
  const count = el("span", { class: "filter-count", "aria-hidden": "true" });
  const trigger = el("button", {
    class: "filter-trigger",
    "aria-haspopup": "dialog",
    onclick: () => open(true),
  }, "Filters", count);

  const chips = el("div", {
    class: "filter-chips", role: "group", "aria-label": "Applied filters",
  });

  let sheet = null;
  let bodySync = null;

  function open(takeFocus) {
    if (sheet) return;
    if (onPanelChange) onPanelChange("filters");
    sheet = openSheet((body, _close, ctx) => {
      bodySync = buildBody(body, ctx) || null;
    }, {
      title,
      subtitle,
      width,
      autoFocus: !!takeFocus,
      onClose: () => {
        sheet = null;
        bodySync = null;
        if (onPanelChange) onPanelChange("");
      },
    });
  }

  function close() {
    if (sheet) sheet.close();
  }

  function sync() {
    const list = entries() || [];
    count.textContent = list.length ? String(list.length) : "";
    trigger.setAttribute("aria-label",
      list.length ? `Filters, ${list.length} applied` : "Filters");

    clear(chips);
    chips.hidden = !list.length;
    for (const e of list) {
      chips.append(el("button", {
        class: "filter-chip" + (e.sev ? " sev-" + e.sev : ""),
        "aria-label": "Clear filter: " + e.label,
        onclick: () => {
          onPatch(e.patch);
          // The chip that was clicked no longer exists; hand focus to the next one, or
          // back to the trigger when that was the last filter.
          const next = chips.querySelector(".filter-chip");
          (next || trigger).focus();
        },
      },
        e.sev ? el("span", { class: "sev-dot", "aria-hidden": "true" }) : null,
        e.label,
        el("span", { class: "filter-chip-x", "aria-hidden": "true" }, "✕"),
      ));
    }
    if (list.length) {
      chips.append(el("button", {
        class: "link filter-clear-all",
        onclick: () => {
          onClearAll();
          trigger.focus();
        },
      }, "Clear all"));
    }

    if (bodySync) bodySync();
  }

  return { trigger, chips, sync, open, close, isOpen: () => !!sheet };
}

// ------------------------------------------------------------------- facet group

/**
 * One filter dimension in the drawer: a labelled group of toggle rows, each carrying how
 * many rows it would still leave and a proportion bar for that count.
 *
 * Toggle buttons with aria-pressed rather than checkboxes, because the stylesheet defines
 * no checkbox vocabulary at all and every binary control in both apps is a pressed
 * button — a lone checkbox here would read as a different kind of control. The drawn box
 * glyph supplies the checkbox affordance and doubles as the non-color state cue.
 *
 * `update()` reconciles by value so the rows the user is tabbing through survive a
 * recount; only genuinely new/gone options are added or removed.
 *
 * @param spec.options [{value, label, count, sev?, group?}]
 * @param spec.onToggle (value) => void
 */
export function facetGroup(spec) {
  const { label, hint = "", searchThreshold = 8, onToggle } = spec;
  const labelId = "facet-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const head = el("div", { class: "facet-group-head" },
    el("span", { class: "facet-group-label", id: labelId }, label),
    hint ? el("span", { class: "facet-group-hint" }, hint) : null,
  );
  const list = el("div", { class: "facet-list" });
  const searchInput = el("input", {
    type: "search",
    class: "facet-search",
    placeholder: `Filter ${label.toLowerCase()}…`,
    "aria-label": `Search ${label.toLowerCase()} options`,
  });
  const searchWrap = el("div", { class: "facet-search-wrap" }, searchInput);
  searchWrap.hidden = true;
  searchInput.addEventListener("input", () => applySearch());

  const root = el("div", { class: "facet-group", role: "group", "aria-labelledby": labelId },
    head, searchWrap, list);

  const rows = new Map(); // value -> {btn, countEl, fillEl, text, groupLabel}
  const empty = el("p", { class: "facet-empty small muted" }, "No options match.");
  empty.hidden = true;
  root.append(empty); // outside `list` so it never takes part in row reconciliation

  function applySearch() {
    const q = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const [, row] of rows) {
      const hit = !q || row.text.toLowerCase().includes(q);
      row.btn.hidden = !hit;
      if (hit) visible++;
      if (row.groupLabel) row.groupLabel.hidden = true;
    }
    // Group headings only earn their line when something under them survived the search.
    for (const [, row] of rows) {
      if (row.groupLabel && !row.btn.hidden) row.groupLabel.hidden = false;
    }
    empty.hidden = visible > 0;
  }

  function buildRow(opt) {
    const dot = opt.sev ? el("span", { class: "sev-dot", "aria-hidden": "true" }) : null;
    const labelEl = el("span", { class: "facet-label" }, dot, el("span", {}, opt.label));
    const countEl = el("span", { class: "facet-count num" }, String(opt.count));
    // Decorative: the count sits next to it as text. Neutral on purpose — a facet count is
    // a quantity, not a severity, and the Rationed Ink Rule spends colour only on risk.
    const bar = meter(0, { decorative: true, className: "meter--facet" });
    const fillEl = bar.fill;
    const btn = el("button", {
      class: "facet-row" + (opt.sev ? " sev-" + opt.sev : ""),
      "aria-pressed": "false",
      onclick: () => {
        // A zero-yield option is announced as disabled but still focusable, so clicking
        // it must be a no-op rather than a filter that empties the table.
        if (btn.getAttribute("aria-disabled") === "true") return;
        onToggle(opt.value);
      },
    },
      el("span", { class: "facet-box", "aria-hidden": "true" }),
      labelEl, bar, countEl,
    );
    return { btn, countEl, fillEl, text: opt.label, groupLabel: null };
  }

  /** @param selected string[] */
  function update(options, selected) {
    const opts = options || [];
    const picked = selected || [];
    const max = opts.reduce((m, o) => Math.max(m, Number(o.count) || 0), 0);
    const seen = new Set();

    // Place nodes in order but move only the ones actually out of place: re-inserting a
    // node that already sits where it belongs still detaches it, which blurs it — and the
    // whole point of syncing in place is that the option you just pressed keeps focus.
    let cursor = list.firstChild;
    const place = (node) => {
      if (node === cursor) {
        cursor = cursor.nextSibling;
        return;
      }
      list.insertBefore(node, cursor);
    };

    let lastGroup = null;
    for (const opt of opts) {
      seen.add(opt.value);
      let row = rows.get(opt.value);
      if (!row) {
        row = buildRow(opt);
        rows.set(opt.value, row);
      }
      row.text = opt.label;
      row.countEl.textContent = String(opt.count);
      // Bars are scaled within their own group: against the whole estate every option in
      // a narrow dimension would be a stub, which tells you nothing about their relation.
      row.fillEl.style.width = max > 0 ? `${Math.round((opt.count / max) * 100)}%` : "0%";

      const on = picked.indexOf(opt.value) >= 0;
      row.btn.setAttribute("aria-pressed", on ? "true" : "false");
      // Never disable something that is switched on, however low its count — the control
      // it would be switched off from has to stay live.
      const dead = !on && !opt.count;
      row.btn.setAttribute("aria-disabled", dead ? "true" : "false");
      row.btn.setAttribute("aria-label",
        `${opt.label}, ${opt.count} asset${opt.count === 1 ? "" : "s"}` +
        (dead ? ", no matches" : ""));

      if (opt.group && opt.group !== lastGroup) {
        if (!row.groupLabel) {
          row.groupLabel = el("div", { class: "facet-subhead" }, opt.group);
        }
        row.groupLabel.textContent = opt.group;
        place(row.groupLabel);
        lastGroup = opt.group;
      } else if (row.groupLabel) {
        row.groupLabel.remove();
        row.groupLabel = null;
      }
      place(row.btn);
    }

    for (const [value, row] of rows) {
      if (seen.has(value)) continue;
      if (row.groupLabel) row.groupLabel.remove();
      row.btn.remove();
      rows.delete(value);
    }
    // Anything left past the cursor is a node no option claimed this round.
    while (cursor) {
      const next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }

    searchWrap.hidden = opts.length < searchThreshold;
    if (searchWrap.hidden) searchInput.value = "";
    applySearch();
    root.hidden = opts.length === 0;
  }

  return { root, update };
}
